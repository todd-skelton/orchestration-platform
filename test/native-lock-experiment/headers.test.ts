import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  materializeNativeLockHeaders,
  type NativeLockHeaderMaterializationRequest,
} from "../../scripts/build/native-lock-headers.mjs";

const faults = vi.hoisted(() => ({
  mkdir: null as ((path: string) => Promise<void>) | null,
  readdir: null as ((path: string) => Promise<void>) | null,
  corruptRead: false,
}));
// Scoped I/O faults only; production always calls the real archive reader and disk API.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      if (faults.mkdir) await faults.mkdir(String(args[0]));
      return actual.mkdir(...args);
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      const result = await actual.readdir(...args);
      if (faults.readdir) await faults.readdir(String(args[0]));
      return result;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (args[1] === "r" && faults.corruptRead) {
        const original = handle.read.bind(handle);
        handle.read = (async (...readArgs: Parameters<typeof original>) => {
          const result = await original(...readArgs);
          if (result.bytesRead) (result.buffer as Buffer)[0] = (result.buffer as Buffer)[0]! ^ 1;
          return result;
        }) as typeof handle.read;
      }
      return handle;
    },
  };
});

// Tiny synthetic GNU distribution: binary payload, configuration, empty file and
// empty/nested directories. None of these bytes asserts official provenance.
const version = "v24.15.0";
const root = `node-${version}`;
const include = `${root}/include/node`;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const payloads = new Map([
  ["config.gypi", Buffer.from("{'variables': {}}\n")],
  ["nested/a.h", Buffer.from([0, 255, 1, 10, 13, 128])],
  ["node_api.h", Buffer.from("/* synthetic */\n")],
  ["zero.h", Buffer.alloc(0)],
]);
function record(path: string, payload: Buffer | null) {
  const bytes = payload ?? Buffer.alloc(0);
  const header = Buffer.alloc(512);
  header.write(path + (payload === null ? "/" : ""), 0, 100, "ascii");
  for (const [offset, width, value] of [
    [100, 8, 0o755],
    [108, 8, 0],
    [116, 8, 0],
    [124, 12, bytes.length],
    [136, 12, 0],
  ] as const)
    header.write(value.toString(8).padStart(width - 1, "0") + "\0", offset, width, "ascii");
  header.write(payload === null ? "5" : "0", 156, "ascii");
  header.write("ustar  \0", 257, "ascii");
  header.fill(32, 148, 156);
  header.write(
    header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
    "ascii",
  );
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);
}
function archive(extra: Buffer[] = []) {
  const tar = Buffer.concat([
    ...[root, `${root}/include`, include, `${include}/empty`, `${include}/nested`].map((path) =>
      record(path, null),
    ),
    ...[...payloads].map(([path, bytes]) => record(`${include}/${path}`, bytes)),
    ...extra,
    Buffer.alloc(1024),
  ]);
  const zipped = gzipSync(tar);
  zipped[3] = 8;
  return Buffer.concat([
    zipped.subarray(0, 10),
    Buffer.from(`${root}-headers.tar\0`),
    zipped.subarray(10),
  ]);
}
const roots: string[] = [];
async function fixture(): Promise<NativeLockHeaderMaterializationRequest> {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), "native-headers-synthetic-")));
  roots.push(base);
  const runnerTemp = resolve(base, "runner");
  const stableRoot = resolve(base, "stable");
  const candidateRoot = resolve(base, "candidate");
  for (const path of [runnerTemp, stableRoot, candidateRoot]) await mkdir(path);
  return {
    archiveBytes: archive(),
    exactNodeVersion: version,
    runnerTemp,
    headerRoot: resolve(runnerTemp, "headers"),
    stableRoot,
    candidateRoot,
  };
}
const missing = (path: string) => expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
beforeEach(() => {
  faults.mkdir = null;
  faults.readdir = null;
  faults.corruptRead = false;
});
afterEach(async () => {
  faults.mkdir = null;
  faults.readdir = null;
  faults.corruptRead = false;
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("private archive-to-disk header custody", () => {
  test("reads back every payload and classifies the complete tree without exposing mutable bytes", async () => {
    const request = await fixture();
    const result = await materializeNativeLockHeaders(request);
    expect(result.distribution.archive.sha256).toBe(hash(request.archiveBytes));
    expect(result.distribution.entries).toHaveLength(9);
    expect(result.distribution.entries.filter((entry) => entry.kind === "DIRECTORY")).toHaveLength(
      5,
    );
    expect(result.distribution.entries.every((entry) => !("bytes" in entry))).toBe(true);
    expect(result.distribution.longNames).toEqual([]);
    expect(result.headers).toEqual(
      [...payloads].map(([path, bytes]) => ({
        path,
        byteLength: String(bytes.length),
        sha256: hash(bytes),
      })),
    );
    for (const [path, bytes] of payloads)
      expect(await readFile(resolve(result.includeRoot, path))).toEqual(bytes);
    expect(await readdir(resolve(result.includeRoot, "empty"))).toEqual([]);
    request.archiveBytes.fill(0); // Private reader snapshot outlives caller buffers and fields.
    request.headerRoot = resolve(request.runnerTemp, "different");
    expect(await result.revalidate()).toEqual({
      distribution: result.distribution,
      headers: result.headers,
    });
    expect(Object.isFrozen(result.headers[0])).toBe(true);
    expect(Object.isFrozen(result.distribution.entries)).toBe(true);
    await result.dispose();
    await missing(result.headerRoot);
    await expect(result.revalidate()).rejects.toThrow("native-lock-headers:refused");
  });

  test.each([
    "extra-file",
    "extra-directory",
    "missing-file",
    "missing-directory",
    "changed-file",
    "replaced-file",
    "case-name",
  ])("refuses complete census/custody mutation %s", async (mutation) => {
    const result = await materializeNativeLockHeaders(await fixture());
    const path = resolve(result.includeRoot, "node_api.h");
    if (mutation === "extra-file") await writeFile(resolve(result.includeRoot, "extra.h"), "extra");
    if (mutation === "extra-directory") await mkdir(resolve(result.includeRoot, "extra"));
    if (mutation === "missing-file") await rm(path);
    if (mutation === "missing-directory")
      await rm(resolve(result.includeRoot, "empty"), { recursive: true });
    if (mutation === "changed-file") await writeFile(path, "/* different */\n");
    if (mutation === "replaced-file") {
      await rename(path, `${path}.old`);
      await writeFile(path, payloads.get("node_api.h")!);
    }
    if (mutation === "case-name") {
      await rename(path, `${path}.tmp`);
      await rename(`${path}.tmp`, resolve(result.includeRoot, "NODE_API.h"));
    }
    await expect(result.revalidate()).rejects.toThrow("native-lock-headers:refused");
  });
  test("compares read payload bytes even when file metadata remains unchanged", async () => {
    const result = await materializeNativeLockHeaders(await fixture());
    faults.corruptRead = true;
    await expect(result.revalidate()).rejects.toThrow("native-lock-headers:refused");
    faults.corruptRead = false;
    await expect(result.revalidate()).rejects.toThrow(); // Failure is terminal, not repairable evidence.
    await result.dispose();
  });
  test("checks the full readback before initial return and removes owned files on refusal", async () => {
    const request = await fixture();
    faults.corruptRead = true;
    await expect(materializeNativeLockHeaders(request)).rejects.toThrow(
      "native-lock-headers:refused",
    );
    await missing(request.headerRoot);
  });
  test("detects a late addition after directory enumeration and refuses recursive cleanup", async () => {
    const request = await fixture();
    faults.readdir = async (path) => {
      if (path !== request.headerRoot) return;
      faults.readdir = null;
      await writeFile(resolve(path, "unexpected"), "keep this foreign file");
    };
    await expect(materializeNativeLockHeaders(request)).rejects.toThrow(
      "native-lock-headers:cleanup-refused",
    );
    expect(await readFile(resolve(request.headerRoot, "unexpected"), "utf8")).toBe(
      "keep this foreign file",
    );
  });
  test.each(["runnerTemp", "stableRoot", "candidateRoot"] as const)(
    "refuses changed %s custody",
    async (key) => {
      const request = await fixture();
      const result = await materializeNativeLockHeaders(request);
      await rename(request[key], `${request[key]}-moved`);
      await mkdir(request[key]);
      await expect(result.revalidate()).rejects.toThrow();
      if (key === "runnerTemp") await expect(result.dispose()).rejects.toThrow("cleanup-refused");
      else await result.dispose();
    },
  );
  test("rechecks source roots during preparation and cleans an unaffected output tree", async () => {
    const request = await fixture();
    faults.readdir = async () => {
      faults.readdir = null;
      await rename(request.stableRoot, `${request.stableRoot}-moved`);
      await mkdir(request.stableRoot);
    };
    await expect(materializeNativeLockHeaders(request)).rejects.toThrow(
      "native-lock-headers:refused",
    );
    await missing(request.headerRoot);
  });
  test("rolls back a partial creation without touching preexisting source files", async () => {
    const request = await fixture();
    const sentinel = resolve(request.stableRoot, "sentinel");
    await writeFile(sentinel, "source");
    faults.mkdir = async (path) => {
      if (path.endsWith("nested")) throw new Error("synthetic disk failure");
    };
    await expect(materializeNativeLockHeaders(request)).rejects.toThrow(
      "native-lock-headers:refused",
    );
    expect(await readFile(sentinel, "utf8")).toBe("source");
    await missing(request.headerRoot);
  });
  test("refuses reused roots without deleting them", async () => {
    const request = await fixture();
    await mkdir(request.headerRoot);
    await expect(materializeNativeLockHeaders(request)).rejects.toThrow();
    expect(await readdir(request.headerRoot)).toEqual([]);
  });
  test.each(["overlap", "ancestor", "nested-output", "dot", "alias", "relative"])(
    "refuses unsafe roots %s before writing",
    async (mode) => {
      const request = await fixture();
      if (mode === "overlap") request.stableRoot = request.runnerTemp;
      if (mode === "ancestor") request.stableRoot = dirname(request.runnerTemp);
      if (mode === "nested-output")
        request.headerRoot = resolve(request.runnerTemp, "missing/headers");
      if (mode === "dot") request.headerRoot += ".";
      if (mode === "alias") request.headerRoot = resolve(request.runnerTemp, "CON");
      if (mode === "relative") request.headerRoot = "headers";
      await expect(materializeNativeLockHeaders(request)).rejects.toThrow();
      expect(await readdir(request.runnerTemp)).toEqual([]);
    },
  );
  test("refuses linked ancestors and hard-linked extracted files", async () => {
    const request = await fixture();
    const alias = resolve(dirname(request.runnerTemp), "alias");
    await symlink(request.runnerTemp, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(
      materializeNativeLockHeaders({
        ...request,
        runnerTemp: alias,
        headerRoot: resolve(alias, "headers"),
      }),
    ).rejects.toThrow();
    const result = await materializeNativeLockHeaders(request);
    await link(resolve(result.includeRoot, "node_api.h"), resolve(request.runnerTemp, "linked.h"));
    await expect(result.revalidate()).rejects.toThrow();
    await expect(result.dispose()).rejects.toThrow("cleanup-refused");
  });
  test("rejects forged parsed entries and hostile request accessors without invoking them", async () => {
    const request = await fixture();
    let calls = 0;
    const hostile = () => {
      calls++;
      throw new Error("must not execute");
    };
    const getter = { ...request };
    Object.defineProperty(getter, "headerRoot", { get: hostile });
    for (const input of [
      getter,
      new Proxy(request, { getPrototypeOf: hostile }),
      { ...request, entries: [] },
      { ...request, archiveBytes: { entries: [] } },
    ])
      await expect(
        materializeNativeLockHeaders(input as NativeLockHeaderMaterializationRequest),
      ).rejects.toThrow();
    expect(calls).toBe(0);
    expect(await readdir(request.runnerTemp)).toEqual([]);
  });
  test("uses the real reader for wrong version, extra archive content and case collisions", async () => {
    const request = await fixture();
    for (const input of [
      { ...request, exactNodeVersion: "v24.15.1" },
      { ...request, archiveBytes: archive([record(`${root}/outside.h`, Buffer.alloc(0))]) },
      { ...request, archiveBytes: archive([record(`${include}/NODE_API.h`, Buffer.alloc(0))]) },
    ])
      await expect(materializeNativeLockHeaders(input)).rejects.toThrow();
    expect(await readdir(request.runnerTemp)).toEqual([]);
  });
});
