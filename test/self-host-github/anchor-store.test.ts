import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as builder from "../../probes/self-host-github/src/anchor/build.js";
import * as store from "../../probes/self-host-github/src/anchor/store.js";

// ISS-056: the canonical-path read/write helper for
// `<state-root>/bootstrap/verifier-anchor.json`
// (`docs/architecture/contract-decisions.md:7063-7065`). Every scratch root is
// `realpath(await mkdtemp(...))`, and the round trip is exercised on a
// canonical root and on a root reached through a symlinked parent. Nothing here
// downloads, verifies, installs, or authorizes anything: the bytes are the
// synthetic fixture's, and no claim is made that any anchor was published on a
// target host.

const schema = "bootstrap-verifier-anchor/v1";
type Golden = Readonly<{
  byteLength: number;
  canonicalJson: string;
  digest: string;
  facts: Readonly<Record<string, unknown>>;
  note: string;
}>;
const golden = JSON.parse(
  await readFile(
    resolve(import.meta.dirname, "fixtures/anchor/canonical-anchor.golden.json"),
    "utf8",
  ),
) as Golden;

function build(facts: unknown): builder.BuiltBootstrapVerifierAnchor {
  const result = builder.buildBootstrapVerifierAnchor(facts);
  if (!result.ok) throw new Error(`fixture refused: ${result.issues.join(",")}`);
  return result.value;
}
const anchor = build(structuredClone(golden.facts)).anchor;
const substituted = build(
  (() => {
    const facts = structuredClone(golden.facts) as Record<string, unknown>;
    for (const row of facts.assets as Record<string, unknown>[]) row.archiveSha256 = "a".repeat(64);
    (facts.signerWorkflow as Record<string, unknown>).digest = "b".repeat(64);
    return facts;
  })(),
);
const goldenBytes = new TextEncoder().encode(golden.canonicalJson);

const scratchRoots: string[] = [];
async function scratch(): Promise<string> {
  const value = await realpath(await mkdtemp(resolve(tmpdir(), "iss056-anchor-")));
  scratchRoots.push(value);
  return value;
}
async function link(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
}
async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch {
    return true;
  }
}
function refusal(issues: readonly string[]): { ok: false; issues: readonly string[] } {
  return { ok: false, issues };
}

afterEach(async () => {
  await Promise.all(
    scratchRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bootstrap verifier anchor store: one canonical path", () => {
  test("constructs exactly the ledger's canonical path and refuses any other root spelling", async () => {
    const root = await scratch();
    expect(store.verifierAnchorPathSegments).toEqual(["bootstrap", "verifier-anchor.json"]);
    expect(Object.isFrozen(store.verifierAnchorPathSegments)).toBe(true);
    expect(store.canonicalBootstrapVerifierAnchorPath(root)).toBe(
      resolve(root, "bootstrap", "verifier-anchor.json"),
    );
    for (const stateRoot of ["", "relative/state", `${root}${sep}state${sep}..`, `${root}${sep}`]) {
      expect(() => store.canonicalBootstrapVerifierAnchorPath(stateRoot)).toThrow(TypeError);
      expect(await store.writeBootstrapVerifierAnchorFile(stateRoot, `${root}/x`, anchor)).toEqual(
        refusal(["stateRoot:absolute-normalized-required"]),
      );
      expect(
        await store.readBootstrapVerifierAnchorFile(stateRoot, `${root}/x`, golden.digest),
      ).toEqual(refusal(["stateRoot:absolute-normalized-required"]));
    }
    // A root that exists but is not a directory, is absent, or is itself a
    // symlink is refused rather than guessed at.
    const file = resolve(root, "not-a-directory");
    await writeFile(file, "x", "utf8");
    const missing = resolve(root, "absent-root");
    const aliasBase = await scratch();
    const aliasTarget = resolve(aliasBase, "target");
    const alias = resolve(aliasBase, "alias-root");
    await mkdir(aliasTarget);
    const linked = await link(aliasTarget, alias);
    if (!linked) expect(process.platform).toBe("win32");
    for (const stateRoot of [file, missing, ...(linked ? [alias] : [])]) {
      expect(
        await store.writeBootstrapVerifierAnchorFile(
          stateRoot,
          store.canonicalBootstrapVerifierAnchorPath(stateRoot),
          anchor,
        ),
      ).toEqual(refusal(["stateRoot:directory-required"]));
      expect(
        await store.readBootstrapVerifierAnchorFile(
          stateRoot,
          store.canonicalBootstrapVerifierAnchorPath(stateRoot),
          golden.digest,
        ),
      ).toEqual(refusal(["stateRoot:directory-required"]));
    }
    expect(await absent(resolve(root, "bootstrap"))).toBe(true);
  });

  test("round-trips byte-identical goldens on a canonical root and a symlinked-parent root", async () => {
    const base = await scratch();
    const real = resolve(base, "real");
    const aliasParent = resolve(base, "alias");
    await mkdir(resolve(real, "state"), { recursive: true });
    const linked = await link(real, aliasParent);
    if (!linked) expect(process.platform).toBe("win32");
    const canonicalRoot = await scratch();
    const roots = [canonicalRoot, ...(linked ? [resolve(aliasParent, "state")] : [])];
    expect(roots.length).toBe(linked ? 2 : 1);
    for (const root of roots) {
      const path = store.canonicalBootstrapVerifierAnchorPath(root);
      const written = await store.writeBootstrapVerifierAnchorFile(root, path, anchor);
      expect(written.ok).toBe(true);
      if (!written.ok) throw new Error(written.issues.join(","));
      expect(written.digest).toBe(golden.digest);
      expect(new TextDecoder().decode(written.bytes)).toBe(golden.canonicalJson);
      expect(written.bytes.byteLength).toBe(golden.byteLength);
      expect(written.value).toEqual(anchor);
      expect(written.path).toBe(await realpath(path));

      // Criterion 1: the bytes on disk are the canonical bytes, byte for byte.
      const onDisk = await readFile(path);
      expect(new Uint8Array(onDisk)).toEqual(new Uint8Array(written.bytes));
      expect(onDisk.byteLength).toBe(golden.byteLength);

      // Criterion 2: Danchor recomputed from the written bytes is the same
      // identity the digest function gives for the same canonical record.
      const read = await store.readBootstrapVerifierAnchorFile(root, path, golden.digest);
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error(read.issues.join(","));
      expect(read.value).toEqual(anchor);
      expect(read.digest).toBe(golden.digest);
      expect(read.digest).toBe(contracts.computeBootstrapVerifierAnchorDigest(read.value));
      expect(new Uint8Array(read.bytes)).toEqual(new Uint8Array(written.bytes));
      expect(read.path).toBe(written.path);
      const reparsed = contracts.parseCanonicalContractBytes(schema, read.bytes);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) throw new Error(reparsed.issues.join(","));
      expect(contracts.computeBootstrapVerifierAnchorDigest(reparsed.value)).toBe(golden.digest);
    }
  });

  test("refuses every non-canonical spelling of the anchor path", async () => {
    const root = await scratch();
    const path = store.canonicalBootstrapVerifierAnchorPath(root);
    const written = await store.writeBootstrapVerifierAnchorFile(root, path, anchor);
    expect(written.ok).toBe(true);

    // Probe the filesystem before using any spelling variant: the uppercase
    // directory only exists when the filesystem is case-insensitive, and the
    // helper must refuse the variant on either kind of filesystem.
    let caseInsensitive: boolean;
    try {
      caseInsensitive = (await lstat(resolve(root, "BOOTSTRAP"))).isDirectory();
    } catch {
      caseInsensitive = false;
    }
    if (caseInsensitive)
      expect((await realpath(resolve(root, "BOOTSTRAP"))).toLowerCase()).toBe(
        resolve(root, "bootstrap").toLowerCase(),
      );
    // A case-sensitive filesystem is expected only on hosted Linux; if this
    // ever held on Windows or macOS the probe above would be wrong.
    else expect(process.platform).toBe("linux");

    const drives = [
      path.replace(/^([A-Za-z]):/, (_match, drive: string) => `${drive.toLowerCase()}:`),
      path.replace(/^([A-Za-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`),
    ].filter((variant) => variant !== path);
    expect(drives).toHaveLength(process.platform === "win32" ? 1 : 0);
    for (const anchorPath of [
      resolve(root, "BOOTSTRAP", "verifier-anchor.json"),
      resolve(root, "bootstrap", "VERIFIER-ANCHOR.JSON"),
      resolve(root, "verifier-anchor.json"),
      resolve(root, "bootstrap", "bootstrap", "verifier-anchor.json"),
      resolve(root, "..", "verifier-anchor.json"),
      ...drives,
    ]) {
      expect(await store.writeBootstrapVerifierAnchorFile(root, anchorPath, anchor)).toEqual(
        refusal(["anchorPath:canonical-path-required"]),
      );
      expect(await store.readBootstrapVerifierAnchorFile(root, anchorPath, golden.digest)).toEqual(
        refusal(["anchorPath:canonical-path-required"]),
      );
    }
    for (const anchorPath of [
      `${path}${sep}.`,
      `${root}${sep}bootstrap${sep}..${sep}bootstrap${sep}verifier-anchor.json`,
      "bootstrap/verifier-anchor.json",
      "",
    ]) {
      expect(await store.writeBootstrapVerifierAnchorFile(root, anchorPath, anchor)).toEqual(
        refusal(["anchorPath:absolute-normalized-required"]),
      );
      expect(await store.readBootstrapVerifierAnchorFile(root, anchorPath, golden.digest)).toEqual(
        refusal(["anchorPath:absolute-normalized-required"]),
      );
    }
    // Nothing above moved the anchor that is already on disk.
    expect(new Uint8Array(await readFile(path))).toEqual(goldenBytes);
    expect(await readdir(resolve(root, "bootstrap"))).toEqual(["verifier-anchor.json"]);
  });

  test("refuses a bootstrap directory or anchor file redirected to a custom root", async () => {
    const decoyRoot = await scratch();
    const decoyDirectory = resolve(decoyRoot, "decoy");
    const decoyFile = resolve(decoyRoot, "decoy.json");
    await mkdir(decoyDirectory);
    await writeFile(decoyFile, "decoy\n", "utf8");

    const directoryRoot = await scratch();
    const redirected = await link(decoyDirectory, resolve(directoryRoot, "bootstrap"));
    if (!redirected) expect(process.platform).toBe("win32");
    if (redirected) {
      const path = store.canonicalBootstrapVerifierAnchorPath(directoryRoot);
      expect(await store.writeBootstrapVerifierAnchorFile(directoryRoot, path, anchor)).toEqual(
        refusal(["anchorDirectory:custom-root-refused"]),
      );
      expect(
        await store.readBootstrapVerifierAnchorFile(directoryRoot, path, golden.digest),
      ).toEqual(refusal(["anchorDirectory:custom-root-refused"]));
      expect(await readdir(decoyDirectory)).toEqual([]);
    }

    // A `bootstrap` entry that exists but is not a directory at all is the
    // same custody failure, and the entry that is there is left alone.
    const plainRoot = await scratch();
    const plainDirectory = resolve(plainRoot, "bootstrap");
    await writeFile(plainDirectory, "not a directory\n", "utf8");
    const plainPath = store.canonicalBootstrapVerifierAnchorPath(plainRoot);
    expect(await store.writeBootstrapVerifierAnchorFile(plainRoot, plainPath, anchor)).toEqual(
      refusal(["anchorDirectory:custom-root-refused"]),
    );
    expect(
      await store.readBootstrapVerifierAnchorFile(plainRoot, plainPath, golden.digest),
    ).toEqual(refusal(["anchorDirectory:custom-root-refused"]));
    expect(await readFile(plainDirectory, "utf8")).toBe("not a directory\n");

    const fileRoot = await scratch();
    const path = store.canonicalBootstrapVerifierAnchorPath(fileRoot);
    await mkdir(resolve(fileRoot, "bootstrap"));
    let fileLinked = true;
    try {
      await symlink(decoyFile, path, "file");
    } catch {
      fileLinked = false;
    }
    if (!fileLinked) expect(process.platform).toBe("win32");
    else {
      expect(await store.writeBootstrapVerifierAnchorFile(fileRoot, path, anchor)).toEqual(
        refusal(["anchorFile:custom-root-refused"]),
      );
      expect(await store.readBootstrapVerifierAnchorFile(fileRoot, path, golden.digest)).toEqual(
        refusal(["anchorFile:custom-root-refused"]),
      );
      expect(await readFile(decoyFile, "utf8")).toBe("decoy\n");
    }
  });

  test("parses the anchor before touching the filesystem and creates nothing when it refuses", async () => {
    const root = await scratch();
    const path = store.canonicalBootstrapVerifierAnchorPath(root);
    const vectors: readonly (readonly [unknown, readonly string[]])[] = [
      [
        { ...(anchor as unknown as Record<string, unknown>), cliVersion: "latest" },
        ["cliVersion:mismatch"],
      ],
      [
        { ...(anchor as unknown as Record<string, unknown>), releaseTag: "latest" },
        ["releaseTag:mismatch"],
      ],
      [
        { ...(anchor as unknown as Record<string, unknown>), trustBootstrap: "CUSTOM_ROOT" },
        ["trustBootstrap:mismatch"],
      ],
      [
        { ...(anchor as unknown as Record<string, unknown>), executablePath: "C:/gh.exe" },
        ["executablePath:unknown-field"],
      ],
      [null, ["record:object-required"]],
      [[], ["record:object-required"]],
      ["anchor", ["record:object-required"]],
      [
        new Proxy({ ...(anchor as unknown as Record<string, unknown>) }, {}),
        ["value:proxy-refused"],
      ],
    ];
    for (const [value, issues] of vectors) {
      expect(await store.writeBootstrapVerifierAnchorFile(root, path, value)).toEqual(
        refusal(issues),
      );
      expect(await absent(resolve(root, "bootstrap"))).toBe(true);
    }
    // Paired control: the same call with the accepted anchor writes.
    expect((await store.writeBootstrapVerifierAnchorFile(root, path, anchor)).ok).toBe(true);
    expect(new Uint8Array(await readFile(path))).toEqual(goldenBytes);
  });

  test("writes the anchor exactly once and never silently replaces or re-times it", async () => {
    const root = await scratch();
    const path = store.canonicalBootstrapVerifierAnchorPath(root);
    expect((await store.writeBootstrapVerifierAnchorFile(root, path, anchor)).ok).toBe(true);
    expect(await store.writeBootstrapVerifierAnchorFile(root, path, anchor)).toEqual(
      refusal(["anchorFile:already-exists"]),
    );
    expect(await store.writeBootstrapVerifierAnchorFile(root, path, substituted.anchor)).toEqual(
      refusal(["anchorFile:already-exists"]),
    );
    expect(new Uint8Array(await readFile(path))).toEqual(goldenBytes);
    expect((await store.readBootstrapVerifierAnchorFile(root, path, golden.digest)).ok).toBe(true);
    // Removing the anchor is an explicit operator action, and only then may a
    // different anchor take its place.
    await rm(path);
    const rewritten = await store.writeBootstrapVerifierAnchorFile(root, path, substituted.anchor);
    expect(rewritten.ok).toBe(true);
    if (!rewritten.ok) throw new Error(rewritten.issues.join(","));
    expect(rewritten.digest).toBe(substituted.digest);
    expect(rewritten.digest).not.toBe(golden.digest);
  });

  test("binds the read anchor to the caller's expected identity", async () => {
    const root = await scratch();
    const path = store.canonicalBootstrapVerifierAnchorPath(root);
    expect((await store.writeBootstrapVerifierAnchorFile(root, path, anchor)).ok).toBe(true);
    for (const expected of [
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
      `${"a".repeat(64)}\n`,
    ])
      expect(await store.readBootstrapVerifierAnchorFile(root, path, expected)).toEqual(
        refusal(["expectedDigest:invalid"]),
      );
    for (const expected of [substituted.digest, "0".repeat(64), "f".repeat(64)])
      expect(await store.readBootstrapVerifierAnchorFile(root, path, expected)).toEqual(
        refusal(["anchor:digest-mismatch"]),
      );
    expect((await store.readBootstrapVerifierAnchorFile(root, path, golden.digest)).ok).toBe(true);

    // The combined substitution this family can express: every supplied asset
    // and signer identity replaced consistently. The bytes still parse, but the
    // identity moved, so a reader holding the operator's Danchor refuses. The
    // attestation bundle and the verifier executable are not members of this
    // family, so no claim is made about them here.
    const other = await scratch();
    const otherPath = store.canonicalBootstrapVerifierAnchorPath(other);
    expect(
      (await store.writeBootstrapVerifierAnchorFile(other, otherPath, substituted.anchor)).ok,
    ).toBe(true);
    expect(await store.readBootstrapVerifierAnchorFile(other, otherPath, golden.digest)).toEqual(
      refusal(["anchor:digest-mismatch"]),
    );
    const bound = await store.readBootstrapVerifierAnchorFile(other, otherPath, substituted.digest);
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error(bound.issues.join(","));
    expect(bound.value).toEqual(substituted.anchor);
    expect(bound.digest).not.toBe(golden.digest);
  });

  test("refuses non-canonical, mutated and unreadable anchor bytes with the landed codes", async () => {
    const root = await scratch();
    const path = store.canonicalBootstrapVerifierAnchorPath(root);
    await mkdir(resolve(root, "bootstrap"));
    const encoder = new TextEncoder();
    const vectors: readonly (readonly [Uint8Array, readonly string[]])[] = [
      [encoder.encode(golden.canonicalJson.trimEnd()), ["encoding:noncanonical"]],
      [encoder.encode(`${golden.canonicalJson}\n`), ["encoding:noncanonical"]],
      [encoder.encode(` ${golden.canonicalJson}`), ["encoding:noncanonical"]],
      [
        encoder.encode(`${JSON.stringify(JSON.parse(golden.canonicalJson), null, 2)}\n`),
        ["encoding:noncanonical"],
      ],
      [encoder.encode(`\ufeff${golden.canonicalJson}`), ["encoding:bom-refused"]],
      [new Uint8Array([255, 10]), ["encoding:invalid-utf8"]],
      [encoder.encode("{\n"), ["encoding:invalid-json"]],
      [
        encoder.encode(
          golden.canonicalJson.replace('"cliVersion":"2.93.0"', '"cliVersion":"latest"'),
        ),
        ["cliVersion:mismatch"],
      ],
      [
        encoder.encode(golden.canonicalJson.replace('"osKind":"LINUX"', '"osKind":"MACOS"')),
        ["assets.0.osKind:ordered-census-required"],
      ],
    ];
    for (const [bytes, issues] of vectors) {
      await writeFile(path, bytes);
      expect(await store.readBootstrapVerifierAnchorFile(root, path, golden.digest)).toEqual(
        refusal(issues),
      );
      // The helper's encoding and family verdicts are the registry's own, not a
      // second grammar maintained here.
      expect(contracts.parseCanonicalContractBytes(schema, bytes)).toEqual(refusal(issues));
      await rm(path);
    }
    expect(await store.readBootstrapVerifierAnchorFile(root, path, golden.digest)).toEqual(
      refusal(["anchorFile:unreadable"]),
    );
    await mkdir(path);
    expect(await store.readBootstrapVerifierAnchorFile(root, path, golden.digest)).toEqual(
      refusal(["anchorFile:unreadable"]),
    );
    await rm(path, { recursive: true });
    await writeFile(path, goldenBytes);
    expect((await store.readBootstrapVerifierAnchorFile(root, path, golden.digest)).ok).toBe(true);
  });

  test("pins the module's public export census", async () => {
    expect(Object.keys(store).sort()).toEqual([
      "canonicalBootstrapVerifierAnchorPath",
      "readBootstrapVerifierAnchorFile",
      "verifierAnchorPathSegments",
      "writeBootstrapVerifierAnchorFile",
    ]);
    // No acquisition, credential, or authority verb is exported here either.
    expect(
      Object.keys(store).some((name) =>
        /Download|Fetch|Acquire|Install|Verify|Authorize|Certify|Token|Trust/.test(name),
      ),
    ).toBe(false);
    const root = await scratch();
    expect(
      store
        .canonicalBootstrapVerifierAnchorPath(root)
        .endsWith(`${sep}bootstrap${sep}verifier-anchor.json`),
    ).toBe(true);
  });
});
