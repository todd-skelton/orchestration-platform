import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  computeConformanceRecordDigest,
  parseConformanceCandidateSubject,
  sha256Bytes,
} from "../../packages/conformance/src/contracts.js";
import type { NativeLockPendingPreparation } from "../../scripts/build/native-lock-inputs.mjs";
import type {
  HostedNativeLockAcquisitionBoundary,
  HostedNativeLockAcquisitionResult,
  NativeLockCommandResult,
} from "../../scripts/conformance/hosted-native-lock-acquisition.mjs";
import {
  censusHostedNativeLockArchive,
  checkCandidateSubjectBinding,
  checkPreLoadBuildBinding,
  hostedNativeLockCandidateSourcePath,
  prepareHostedNativeLockTransaction,
  type HostedNativeLockPreparationBoundary,
  type HostedNativeLockPreparationInput,
} from "../../scripts/conformance/hosted-native-lock-preparation.mjs";
import type {
  HostedCandidateSnapshot,
  HostedNativeLockPlanContext,
} from "../../scripts/conformance/hosted-plan.mjs";

/**
 * ISS-048 stage-three sub-slice 3.1. Synthetic vectors only, driven through the
 * landed mockable process and acquisition boundaries. No real network, no real
 * compiler, no addon load, no `.node` require, no fixture spawn, no case,
 * control, report, archive, workflow, runner-token branch or provider call, and
 * no filesystem access outside a fresh temporary base plus the read-only stable
 * checkout the landed builder censuses. Nothing here is executable evidence
 * outside the hosted three-OS bootstrap.
 */

type Call = {
  file: string;
  argv: string[];
  options: { cwd: string; env: Record<string, string>; shell: boolean; windowsHide: boolean };
};

const faults = vi.hoisted(() => ({
  archiveRoot: "",
  armArchiveFaultOnCandidateRoot: false,
  calls: [] as Call[],
  candidateRoots: [] as string[],
  caseReads: 0,
  caseRoot: "",
  onCaseCensus: null as (() => Promise<void>) | null,
  onCompile: null as ((call: Call) => Promise<void>) | null,
  throwOnArchiveRead: false,
}));

// Synthetic compiler outputs only. The real builder owns argv and environment;
// these bytes are never loaded, required, or executed by anything.
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const { writeFile: write } = await import("node:fs/promises");
  return {
    execFile: Object.assign(
      () => {
        throw new Error("unexpected command");
      },
      {
        [promisify.custom]: async (file: string, argv: string[], options: Call["options"]) => {
          const call = { file, argv: [...argv], options };
          faults.calls.push(call);
          await write(argv.at(-1)!.replace(/^\/OUT:/, ""), "synthetic output; never load");
          if (faults.onCompile) await faults.onCompile(call);
          return { stdout: Buffer.from("synthetic compiler output"), stderr: Buffer.alloc(0) };
        },
      },
    ),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: async (...args: Parameters<typeof actual.mkdtemp>) => {
      const created = await actual.mkdtemp(...(args as [string]));
      if (String(args[0]).includes("orchestration-hosted-candidate-")) {
        faults.candidateRoots.push(String(created));
        if (faults.armArchiveFaultOnCandidateRoot) faults.throwOnArchiveRead = true;
      }
      return created;
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      if (faults.throwOnArchiveRead && String(args[0]) === faults.archiveRoot) {
        faults.throwOnArchiveRead = false;
        throw Object.assign(new Error("synthetic read fault"), { code: "EIO" });
      }
      const rows = await actual.readdir(...(args as Parameters<typeof actual.readdir>));
      if (String(args[0]) === faults.caseRoot) {
        faults.caseReads += 1;
        if (faults.caseReads === 2 && faults.onCaseCensus) await faults.onCaseCensus();
      }
      return rows;
    },
  };
});

const roots: string[] = [];
// Host isolation measured ~6s for the landed builder's real executable
// retention and readback (no C execution). Only the full-transaction vectors
// use this deadline; production and global timing stay unchanged.
const integrationTimeout = 60_000;
const revision = (value: string) => value.repeat(40).slice(0, 40);
const digest64 = (value: string) => value.repeat(64).slice(0, 64);
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function exactResponse(body: Uint8Array, url: string, status = 200): Response {
  const response = new Response(status === 200 ? body : null, {
    headers: status === 200 ? { "content-length": String(body.byteLength) } : {},
    status,
  });
  Object.defineProperty(response, "url", { configurable: false, value: url });
  return response;
}

function command(
  stdout = "synthetic exact hosted version\n",
  changes: Partial<NativeLockCommandResult> = {},
): NativeLockCommandResult {
  return {
    errorCode: null,
    exitCode: 0,
    signal: null,
    stderr: new Uint8Array(),
    stdout: new TextEncoder().encode(stdout),
    ...changes,
  };
}

function tarRecord(path: string, payload: string | null) {
  const bytes = Buffer.from(payload ?? ""),
    header = Buffer.alloc(512);
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

function headerArchive() {
  const root = `node-${process.version}`,
    include = `${root}/include/node`,
    parts = process.version.slice(1).split(".");
  const payloads = [
    "node_api.h",
    "node_api_types.h",
    "js_native_api.h",
    "js_native_api_types.h",
    "config.gypi",
  ].map((name) => tarRecord(`${include}/${name}`, "/* synthetic input */"));
  payloads.push(
    tarRecord(
      `${include}/node_version.h`,
      `#define NODE_MAJOR_VERSION ${parts[0]}\n#define NODE_MINOR_VERSION ${parts[1]}\n#define NODE_PATCH_VERSION ${parts[2]}\n#define NODE_MODULE_VERSION ${process.versions.modules}\n`,
    ),
  );
  const zipped = gzipSync(
    Buffer.concat([
      ...[root, `${root}/include`, include].map((path) => tarRecord(path, null)),
      ...payloads,
      Buffer.alloc(1024),
    ]),
  );
  zipped[3] = 8;
  return Buffer.concat([
    zipped.subarray(0, 10),
    Buffer.from(`${root}-headers.tar\0`),
    zipped.subarray(10),
  ]);
}

function candidateSnapshot(source: string): HostedCandidateSnapshot {
  const bytes = new TextEncoder().encode(source);
  const subject = Object.freeze({
    files: Object.freeze([
      Object.freeze({
        byteLength: String(bytes.byteLength),
        executable: false,
        path: hostedNativeLockCandidateSourcePath,
        sha256Digest: sha256Bytes(bytes),
      }),
    ]),
    schemaVersion: "conformance-candidate-subject/v1",
  });
  const parsed = parseConformanceCandidateSubject(subject);
  if (!parsed.ok) throw new Error(parsed.issues.join(","));
  return Object.freeze({
    digest: computeConformanceRecordDigest("conformance-candidate-subject/v1", parsed.value),
    files: Object.freeze([
      Object.freeze({ bytes, executable: false, path: hostedNativeLockCandidateSourcePath }),
    ]),
    subject: parsed.value,
  });
}

function planContext(candidateSubjectDigest: string): HostedNativeLockPlanContext {
  return Object.freeze({
    action: "iss022_native_lock_experiment",
    candidateRevision: revision("b"),
    candidateSubjectDigest,
    caseCensusDigest: digest64("1"),
    controlCensusDigest: digest64("2"),
    event: "repository_dispatch",
    harnessBundleDigest: digest64("3"),
    prerequisiteCensusDigest: digest64("4"),
    protectedRefDigest: digest64("5"),
    providerRunDigest: digest64("6"),
    repository: "todd-skelton/orchestration-platform",
    repositoryId: "1",
    requiredJobRegistryDigest: digest64("7"),
    runAttempt: "1",
    runId: "2",
    schemaVersion: "hosted-native-lock-plan-context/v1",
    testBundleDigest: digest64("8"),
    vectorCensusDigest: digest64("9"),
    workflowPath: ".github/workflows/conformance.yml",
    workflowRef:
      "todd-skelton/orchestration-platform/.github/workflows/conformance.yml@refs/heads/main",
    workflowRevision: revision("a"),
  });
}

async function fixture() {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), "native-lock-preparation-")));
  roots.push(base);
  const runnerTemp = resolve(base, "runner");
  const sdk = resolve(base, "sdk");
  const macSdk = resolve(base, "MacOSX15.4.sdk");
  await Promise.all([runnerTemp, sdk, macSdk].map((path) => mkdir(path)));
  faults.archiveRoot = resolve(runnerTemp, "preparation");
  faults.caseRoot = resolve(runnerTemp, "case");
  const archiveBytes = headerArchive();
  const libraryBytes = Buffer.from("synthetic import library");
  const sumsBytes = Buffer.from(
    `${hash(archiveBytes)}  node-${process.version}-headers.tar.gz\n` +
      (process.platform === "win32" ? `${hash(libraryBytes)}  win-${process.arch}/node.lib\n` : ""),
  );
  const candidate = candidateSnapshot("/* distinct synthetic candidate C */\n");
  const environment: Record<string, string> = {
    CANDIDATE_INJECTION: "must-not-reach-command",
    PATH: dirname(process.execPath),
  };
  if (process.platform === "win32")
    Object.assign(environment, {
      INCLUDE: sdk,
      LIB: sdk,
      SystemRoot: sdk,
      WindowsSDKVersion: "10.0.26100.0\\",
    });
  const input: HostedNativeLockPreparationInput = {
    candidate,
    context: planContext(candidate.digest),
    environment,
    runnerTemp,
    stableRoot: resolve(import.meta.dirname, "../.."),
  };
  return { archiveBytes, base, input, libraryBytes, macSdk, runnerTemp, sdk, sumsBytes };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function acquisition(
  value: Fixture,
  overrides: Partial<HostedNativeLockAcquisitionBoundary> = {},
): HostedNativeLockPreparationBoundary {
  return {
    acquisition: {
      async fetch(url) {
        const bytes = url.endsWith("SHASUMS256.txt")
          ? value.sumsBytes
          : url.endsWith("node.lib")
            ? value.libraryBytes
            : value.archiveBytes;
        return exactResponse(Uint8Array.from(bytes), url);
      },
      async resolveExecutable() {
        return { path: process.execPath, state: "FOUND" };
      },
      async execute(_file, argv) {
        return command(
          process.platform === "darwin" && argv.includes("--show-sdk-path")
            ? `${value.macSdk}\n`
            : undefined,
        );
      },
      ...overrides,
    },
  };
}

beforeEach(() => {
  faults.archiveRoot = "";
  faults.armArchiveFaultOnCandidateRoot = false;
  faults.calls.length = 0;
  faults.candidateRoots.length = 0;
  faults.caseReads = 0;
  faults.caseRoot = "";
  faults.onCaseCensus = null;
  faults.onCompile = null;
  faults.throwOnArchiveRead = false;
});

afterEach(async () => {
  faults.onCaseCensus = null;
  faults.onCompile = null;
  faults.throwOnArchiveRead = false;
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

describe("hosted native-lock preparation transaction", () => {
  test(
    "allocates the ledger roots and seals two non-loadable built rows against the actual tree",
    async () => {
      const value = await fixture();
      const result = await prepareHostedNativeLockTransaction(value.input, acquisition(value));
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result.state).toBe("AVAILABLE");
      if (result.state !== "AVAILABLE") return;

      expect(result.roots).toEqual({
        acquisitionRoot: resolve(value.runnerTemp, "acquisition"),
        archiveRoot: resolve(value.runnerTemp, "preparation"),
        artifactRoot: resolve(value.runnerTemp, "preparation", "build"),
        caseRoot: resolve(value.runnerTemp, "case"),
        runnerTemp: value.runnerTemp,
      });
      expect(result.preparation.status).toBe("PENDING_CANDIDATE_CONSUME");
      expect(result.preparation.buildRoot).toBe(result.roots.artifactRoot);
      expect(result.preparation.buildPathPrefix).toBe("build/");
      expect(
        result.preparation.helper.builds.map((row) => [row.role, row.result, row.loaded]),
      ).toEqual([
        ["STABLE_WITNESS", "BUILT", null],
        ["CANDIDATE_BINDING", "BUILT", null],
      ]);
      expect(checkPreLoadBuildBinding(result.preparation)).toEqual([]);
      expect(checkCandidateSubjectBinding(value.input.context, value.input.candidate)).toEqual([]);

      // The synthetic compiler wrote a non-loadable placeholder; nothing loads it.
      const output = resolve(
        result.roots.artifactRoot,
        "builds/CANDIDATE_BINDING/native-lock-candidate.node",
      );
      expect(await readFile(output, "utf8")).toBe("synthetic output; never load");
      expect(faults.calls).toHaveLength(2);
      for (const call of faults.calls) {
        expect(call.file).toBe(process.execPath);
        expect(Object.values(call.options.env)).not.toContain("must-not-reach-command");
      }

      // The sealed census equals the post-builder census equals the actual tree.
      expect(result.archiveFiles).toEqual(
        [...result.preparation.retainedFiles].sort((a, b) =>
          a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
        ),
      );
      expect(result.archiveFiles.length).toBeGreaterThan(0);
      for (const row of result.archiveFiles) {
        const bytes = await readFile(resolve(result.roots.archiveRoot, ...row.path.split("/")));
        expect([String(bytes.byteLength), hash(bytes)]).toEqual([row.byteLength, row.sha256]);
        expect(row.path).toMatch(/^(?:build|preparation)\//);
      }
      expect(result.acquisitionFiles.map((row) => row.path)).toContain("capture.json");

      // The candidate root lived only inside the consume; the case root is untouched.
      expect(faults.candidateRoots).toHaveLength(1);
      expect(await exists(faults.candidateRoots[0]!)).toBe(false);
      expect((await readdir(result.roots.caseRoot)).length).toBe(0);
      expect((await readdir(value.runnerTemp)).sort()).toEqual([
        "acquisition",
        "case",
        "preparation",
      ]);
    },
    integrationTimeout,
  );

  test("keeps an unsupported acquisition unsupported and never invokes preparation", async () => {
    const value = await fixture();
    const result = await prepareHostedNativeLockTransaction(
      value.input,
      acquisition(value, {
        async fetch(url) {
          return url.endsWith("SHASUMS256.txt")
            ? exactResponse(new Uint8Array(), url, 404)
            : exactResponse(Uint8Array.from(value.archiveBytes), url);
        },
      }),
    );
    expect(result).toMatchObject({ ok: true, state: "UNSUPPORTED" });
    if (!result.ok || result.state === "AVAILABLE") return;
    expect(result.reason).toBe("distribution:SHASUMS256.txt:missing");
    expect(faults.calls).toHaveLength(0);
    expect(faults.candidateRoots).toHaveLength(0);
    expect(await readdir(result.roots.archiveRoot)).toEqual([]);
  });

  test("classifies malformed, redirected and oversize acquisition responses as unknown", async () => {
    const oversize = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 33; index += 1)
            controller.enqueue(new Uint8Array(1024 * 1024));
          controller.close();
        },
      });
    const mutants: ReadonlyArray<readonly [string, (url: string) => Response]> = [
      [
        "redirected",
        (url) => {
          const response = exactResponse(new TextEncoder().encode("retained"), url);
          Object.defineProperty(response, "redirected", { value: true });
          return response;
        },
      ],
      [
        "malformed-length",
        (url) => {
          const response = new Response("retained", {
            headers: { "content-length": "01" },
            status: 200,
          });
          Object.defineProperty(response, "url", { value: url });
          return response;
        },
      ],
      [
        "oversize",
        (url) => {
          const response = new Response(oversize(), { status: 200 });
          Object.defineProperty(response, "url", { value: url });
          return response;
        },
      ],
    ];
    for (const [name, respond] of mutants) {
      const value = await fixture();
      const result = await prepareHostedNativeLockTransaction(
        value.input,
        acquisition(value, {
          async fetch(url) {
            return respond(url);
          },
        }),
      );
      expect(result, name).toMatchObject({ ok: true, state: "UNKNOWN" });
      expect(faults.calls, name).toHaveLength(0);
      expect(faults.candidateRoots, name).toHaveLength(0);
    }
  });

  test("separates an unavailable toolchain from an ambiguous capture", async () => {
    for (const [mode, state, reason] of [
      ["UNAVAILABLE", "UNSUPPORTED", "toolchain:unavailable"],
      ["UNKNOWN", "UNKNOWN", "toolchain:unknown"],
    ] as const) {
      const value = await fixture();
      const result = await prepareHostedNativeLockTransaction(
        value.input,
        acquisition(value, {
          async resolveExecutable() {
            return { errorCode: mode === "UNAVAILABLE" ? "ENOENT" : "EIO", state: mode };
          },
        }),
      );
      expect(result, mode).toMatchObject({ ok: true, reason, state });
      expect(faults.calls, mode).toHaveLength(0);
      expect(faults.candidateRoots, mode).toHaveLength(0);
    }
  });

  test("refuses a substituted candidate subject and still deletes the candidate root", async () => {
    const value = await fixture();
    const substituted = candidateSnapshot("/* substituted range and flags */\n");
    expect(substituted.digest).not.toBe(value.input.candidate.digest);
    const result = await prepareHostedNativeLockTransaction(
      { ...value.input, candidate: substituted },
      acquisition(value),
    );
    expect(result).toEqual({
      issues: ["native-lock-preparation:candidate-subject-substituted"],
      ok: false,
    });
    expect(faults.candidateRoots).toHaveLength(1);
    expect(await exists(faults.candidateRoots[0]!)).toBe(false);
    expect(faults.calls).toHaveLength(0);
  });

  test("refuses a self-inconsistent candidate subject digest before any candidate root", async () => {
    const value = await fixture();
    const tampered = {
      ...value.input.candidate,
      digest: digest64("f"),
    } as HostedCandidateSnapshot;
    const result = await prepareHostedNativeLockTransaction(
      { ...value.input, candidate: tampered, context: planContext(tampered.digest) },
      acquisition(value),
    );
    expect(result).toEqual({
      issues: [
        "candidate-source:input-refused",
        "native-lock-preparation:candidate-consume-refused",
      ],
      ok: false,
    });
    expect(faults.candidateRoots).toHaveLength(0);
  });

  test("still deletes the candidate root when the consumer throws mid-build", async () => {
    const value = await fixture();
    faults.armArchiveFaultOnCandidateRoot = true;
    const result = await prepareHostedNativeLockTransaction(value.input, acquisition(value));
    expect(result).toEqual({
      issues: [
        "candidate-source:consumer-failed",
        "native-lock-preparation:candidate-consume-refused",
      ],
      ok: false,
    });
    expect(faults.candidateRoots).toHaveLength(1);
    expect(await exists(faults.candidateRoots[0]!)).toBe(false);
  });

  test(
    "refuses a candidate root moved during the consume",
    async () => {
      const value = await fixture();
      faults.onCompile = async () => {
        faults.onCompile = null;
        await rename(faults.candidateRoots[0]!, `${faults.candidateRoots[0]!}-moved`);
      };
      const result = await prepareHostedNativeLockTransaction(value.input, acquisition(value));
      expect(result).toEqual({
        issues: [
          "candidate-source:cleanup-refused",
          "native-lock-preparation:candidate-consume-refused",
        ],
        ok: false,
      });
      expect(faults.calls.length).toBeGreaterThan(0);
      expect(await exists(faults.candidateRoots[0]!)).toBe(false);
    },
    integrationTimeout,
  );

  test("refuses a non-empty acquisition or preparation root", async () => {
    for (const name of ["acquisition", "preparation"] as const) {
      const value = await fixture();
      const root = resolve(value.runnerTemp, name);
      await mkdir(root);
      await writeFile(resolve(root, "residue"), "prior attempt", "utf8");
      const result = await prepareHostedNativeLockTransaction(
        value.input,
        acquisition(value, {
          async fetch() {
            throw new Error("must not fetch");
          },
        }),
      );
      expect(result, name).toEqual({
        issues: ["native-lock-preparation:root-not-empty"],
        ok: false,
      });
    }
  });

  test("refuses overlapping roots", async () => {
    const outer = await fixture();
    expect(
      await prepareHostedNativeLockTransaction(
        { ...outer.input, stableRoot: outer.base },
        acquisition(outer),
      ),
    ).toEqual({ issues: ["native-lock-preparation:roots-overlap"], ok: false });

    const linked = await fixture();
    await mkdir(resolve(linked.runnerTemp, "acquisition"));
    await symlink(
      resolve(linked.runnerTemp, "acquisition"),
      resolve(linked.runnerTemp, "preparation"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await prepareHostedNativeLockTransaction(linked.input, acquisition(linked))).toEqual({
      issues: ["native-lock-preparation:roots-overlap"],
      ok: false,
    });
    expect(faults.candidateRoots).toHaveLength(0);
  });

  test("refuses an acquisition output written inside the preparation root", async () => {
    const value = await fixture();
    const acquisitionRoot = resolve(value.runnerTemp, "acquisition");
    const inside = resolve(value.runnerTemp, "preparation", "smuggled.tar.gz");
    const acquired: HostedNativeLockAcquisitionResult = {
      archivePath: inside,
      capturePath: resolve(acquisitionRoot, "capture.json"),
      importLibraryPath: process.platform === "win32" ? resolve(acquisitionRoot, "node.lib") : null,
      ok: true,
      retainedFiles: [],
      shasumsPath: resolve(acquisitionRoot, "SHASUMS256.txt"),
      state: "AVAILABLE",
    };
    const result = await prepareHostedNativeLockTransaction(value.input, {
      acquire: async () => acquired,
    });
    expect(result).toEqual({
      issues: ["native-lock-preparation:acquisition-output-not-external"],
      ok: false,
    });
    expect(faults.candidateRoots).toHaveLength(0);

    expect(
      await prepareHostedNativeLockTransaction(value.input, {
        acquire: async () => ({ issues: ["native-lock-acquisition:root-refused"], ok: false }),
      }),
    ).toEqual({
      issues: [
        "native-lock-acquisition:root-refused",
        "native-lock-preparation:acquisition-refused",
      ],
      ok: false,
    });
  });

  test(
    "refuses a file added under the archive root after the builder returns",
    async () => {
      const value = await fixture();
      const late = resolve(value.runnerTemp, "preparation", "build", "late-extra");
      faults.onCaseCensus = async () => {
        faults.onCaseCensus = null;
        await writeFile(late, "late diagnostic bytes", "utf8");
      };
      const result = await prepareHostedNativeLockTransaction(value.input, acquisition(value));
      expect(result).toEqual({
        issues: ["native-lock-preparation:archive-census-refused"],
        ok: false,
      });
      expect(faults.caseReads).toBe(2);
      // The refusal is a finding: retained diagnostics are never force-deleted.
      expect(await readFile(late, "utf8")).toBe("late diagnostic bytes");
      expect(await exists(faults.candidateRoots[0]!)).toBe(false);
    },
    integrationTimeout,
  );

  test("binds the archive census to the sealed census row for row", async () => {
    const base = await realpath(await mkdtemp(resolve(tmpdir(), "native-lock-archive-")));
    roots.push(base);
    const archiveRoot = resolve(base, "preparation");
    await mkdir(resolve(archiveRoot, "build/inputs"), { recursive: true });
    await mkdir(resolve(archiveRoot, "preparation"), { recursive: true });
    const rows: Array<{ path: string; byteLength: string; sha256: string }> = [];
    for (const [path, body] of [
      ["build/inputs/source.c", "/* retained */"],
      ["preparation/capture.json", "{}"],
    ] as const) {
      await writeFile(resolve(archiveRoot, ...path.split("/")), body, "utf8");
      rows.push({ byteLength: String(Buffer.byteLength(body)), path, sha256: hash(body) });
    }
    expect(await censusHostedNativeLockArchive(archiveRoot, rows)).toEqual({
      files: rows,
      ok: true,
    });

    const changed = rows.map((row, index) =>
      index === 0 ? { ...row, sha256: digest64("a") } : row,
    );
    expect(await censusHostedNativeLockArchive(archiveRoot, changed)).toEqual({
      issues: ["native-lock-preparation:archive-census-refused"],
      ok: false,
    });
    expect(await censusHostedNativeLockArchive(archiveRoot, [rows[0]!])).toEqual({
      issues: ["native-lock-preparation:archive-census-refused"],
      ok: false,
    });
    expect(
      await censusHostedNativeLockArchive(archiveRoot, [
        ...rows,
        {
          byteLength: "0",
          path: "transcripts/NATIVE_NORMAL_RELEASE/actor.out",
          sha256: digest64("b"),
        },
      ]),
    ).toEqual({ issues: ["native-lock-preparation:sealed-census-refused"], ok: false });
    await mkdir(resolve(archiveRoot, "controls"));
    expect(await censusHostedNativeLockArchive(archiveRoot, rows)).toEqual({
      issues: ["native-lock-preparation:archive-children-refused"],
      ok: false,
    });
  });

  test("refuses a filled loaded member and a substituted build output before any load", () => {
    expect(checkPreLoadBuildBinding(pending())).toEqual([]);
    expect(checkPreLoadBuildBinding(pending({ loaded: { module: "already-required" } }))).toEqual([
      "native-lock-preparation:loaded-before-collection",
    ]);
    expect(checkPreLoadBuildBinding(pending({ sha256: digest64("c") }))).toEqual([
      "native-lock-preparation:build-output-substituted",
    ]);
    expect(checkPreLoadBuildBinding(pending({ drop: true }))).toEqual([
      "native-lock-preparation:build-row-census-refused",
    ]);
  });

  test("keeps every committed deletion mutant discriminating", () => {
    const honest = candidateSnapshot("/* reviewed candidate */\n");
    const substituted = candidateSnapshot("/* substituted range and flags */\n");
    const context = planContext(honest.digest);
    // Each mutant deletes exactly one guard: `real` is the landed guard, which
    // refuses; `ungated` is the downstream step composed without that guard,
    // whose unsafe value the transaction would otherwise carry forward.
    const deletionMutants = [
      {
        control: "WRONG_RANGE_OR_FLAGS",
        gate: "checkCandidateSubjectBinding: authenticated candidate-subject digest gate",
        accepted: () => checkCandidateSubjectBinding(context, honest),
        real: () => checkCandidateSubjectBinding(context, substituted),
        refused: ["native-lock-preparation:candidate-subject-substituted"],
        ungated: () => subjectSourceDigest(substituted),
        unsafe: subjectSourceDigest(substituted),
      },
      {
        control: "BUILD_OR_LOADER_SUBSTITUTION",
        gate: "checkPreLoadBuildBinding: null loaded member and retained build-output gate",
        accepted: () => checkPreLoadBuildBinding(pending()),
        real: () => checkPreLoadBuildBinding(pending({ loaded: { module: "already-required" } })),
        refused: ["native-lock-preparation:loaded-before-collection"],
        ungated: () =>
          pending({ loaded: { module: "already-required" } })
            .helper.builds.map((row) => row.loaded)
            .filter((row) => row !== null),
        unsafe: [{ module: "already-required" }, { module: "already-required" }],
      },
    ] as const;

    expect(new Set(deletionMutants.map((mutant) => mutant.control)).size).toBe(2);
    for (const mutant of deletionMutants) {
      expect(mutant.real(), mutant.gate).toEqual(mutant.refused);
      expect(mutant.accepted(), mutant.gate).toEqual([]);
      expect(mutant.ungated(), mutant.gate).toEqual(mutant.unsafe);
      expect(mutant.ungated(), mutant.gate).not.toEqual(subjectSourceDigest(honest));
    }
    expect(subjectSourceDigest(honest)).not.toBe(subjectSourceDigest(substituted));
  });
});

/** Downstream composition over landed exports only; never a copy of the guard. */
function subjectSourceDigest(candidate: HostedCandidateSnapshot): string | undefined {
  const parsed = parseConformanceCandidateSubject(candidate.subject);
  const files = parsed.ok ? parsed.value.files : [];
  const rows = (Array.isArray(files) ? files : []) as ReadonlyArray<Record<string, unknown>>;
  const row = rows.find((value) => value.path === hostedNativeLockCandidateSourcePath);
  return typeof row?.sha256Digest === "string" ? row.sha256Digest : undefined;
}

function pending(
  change: { loaded?: unknown; sha256?: string; drop?: boolean } = {},
): NativeLockPendingPreparation {
  const outputs = ["STABLE_WITNESS", "CANDIDATE_BINDING"].map((role) => ({
    byteLength: "28",
    path: `builds/${role}/${role === "STABLE_WITNESS" ? "native-lock-witness" : "native-lock-candidate"}.node`,
    sha256: hash("synthetic output; never load"),
  }));
  const builds = outputs.map((output, index) => ({
    argv: [],
    inputs: [],
    loaded: (change.loaded ?? null) as null,
    outputs: [change.sha256 && index === 1 ? { ...output, sha256: change.sha256 } : output],
    result: "BUILT" as const,
    revision: index === 0 ? revision("a") : revision("b"),
    role: (index === 0 ? "STABLE_WITNESS" : "CANDIDATE_BINDING") as
      "STABLE_WITNESS" | "CANDIDATE_BINDING",
    toolchain: null,
  }));
  return {
    buildPathPrefix: "build/",
    buildRoot: resolve(tmpdir(), "unused"),
    candidateFile: {
      byteLength: "1",
      executable: false,
      path: hostedNativeLockCandidateSourcePath,
      sha256Digest: digest64("d"),
    },
    capture: {
      architecture: process.arch,
      nodeVersion: process.version,
      observations: [],
      platform: process.platform,
      state: "AVAILABLE",
      toolchain: null,
    },
    extraction: { distribution: null, headers: [] },
    helper: { builds: change.drop ? builds.slice(0, 1) : builds, node: null },
    retainedFiles: outputs.map((output) => ({ ...output, path: `build/${output.path}` })),
    stableFiles: [],
    status: "PENDING_CANDIDATE_CONSUME",
  } as unknown as NativeLockPendingPreparation;
}
