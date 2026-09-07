import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as builder from "../../probes/self-host-github/src/anchor/build.js";

// ISS-056: the pure builder over the closed `bootstrap-verifier-anchor/v1`
// family. Every accepted input, the canonical output order, and every refusal
// below is re-derived from the ledger
// (`docs/architecture/contract-decisions.md:7000-7065`) and from the landed
// parser/digest (`packages/contracts/src/verifier-anchor.ts`), which remain the
// authority. This file is local structural evidence only: it does not claim
// that any GitHub CLI 2.93.0 asset digest is real, that an operator comparison
// occurred, or that an anchor was published on any host.

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

type Mutable = Record<string | number, unknown>;
type Path = readonly (string | number)[];
function facts(): Mutable {
  return structuredClone(golden.facts) as Mutable;
}
function at(root: unknown, path: Path): Mutable {
  let current = root;
  for (const key of path) current = (current as Mutable)[key];
  return current as Mutable;
}
function changed(path: Path, value: unknown): Mutable {
  const root = facts();
  at(root, path.slice(0, -1))[path[path.length - 1]!] = value;
  return root;
}
function assets(root: Mutable): Mutable[] {
  return root.assets as Mutable[];
}
function built(input: unknown): builder.BuiltBootstrapVerifierAnchor {
  const result = builder.buildBootstrapVerifierAnchor(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`fixture refused: ${result.issues.join(",")}`);
  return result.value;
}
function refuses(input: unknown, issues: readonly string[]): void {
  expect(builder.buildBootstrapVerifierAnchor(input)).toEqual({ ok: false, issues });
}
/** Mirrors `snapshotValue`'s nesting so hostile vectors assert an exact code. */
function boundary(path: Path): string {
  return path.length === 0
    ? "facts."
    : `facts.${path.map((key) => (typeof key === "number" ? `array:${key}` : key)).join(":")}:`;
}
const records: Path[] = [
  [],
  ["assets", 0],
  ["assets", 1],
  ["assets", 2],
  ["operatorConfirmation"],
  ["signerWorkflow"],
];
const literalFields = [
  "cliVersion",
  "expectedOidcIssuer",
  "releaseTag",
  "schemaVersion",
  "trustBootstrap",
] as const;
const digestFields = ["archiveSha256", "checksumManifestSha256", "executableSha256"] as const;

describe("bootstrap verifier anchor builder: operator facts only", () => {
  test("assembles the exact ten-member anchor from supplied facts and fixed literals", () => {
    const value = built(facts());
    const supplied = facts();
    expect(Object.keys(value.anchor).sort()).toEqual([
      ...contracts.verifierAnchorSchemaFields.anchor,
    ]);
    expect(Object.keys(value.anchor)).toHaveLength(10);

    // The five ledger literals plus the confirmation claim are supplied here,
    // never by the operator.
    expect(value.anchor.cliVersion).toBe("2.93.0");
    expect(value.anchor.releaseTag).toBe("v2.93.0");
    expect(value.anchor.schemaVersion).toBe(schema);
    expect(value.anchor.expectedOidcIssuer).toBe("https://token.actions.githubusercontent.com");
    expect(value.anchor.trustBootstrap).toBe("GITHUB_CLI_DEFAULT_ONLINE_SIGSTORE_TUF");
    expect(value.anchor.operatorConfirmation.claim).toBe(
      "OFFICIAL_RELEASE_ASSETS_AND_CHECKSUMS_MATCH",
    );

    // Every remaining member is the operator's fact, copied unchanged.
    expect(value.anchor.assets).toEqual(supplied.assets);
    expect(value.anchor.createdAt).toBe(supplied.createdAt);
    expect(value.anchor.repositoryId).toBe(supplied.repositoryId);
    expect(value.anchor.operatorConfirmation.actorId).toBe(
      at(supplied, ["operatorConfirmation"]).actorId,
    );
    expect(value.anchor.operatorConfirmation.confirmedAt).toBe(
      at(supplied, ["operatorConfirmation"]).confirmedAt,
    );
    expect(value.anchor.signerWorkflow).toEqual(supplied.signerWorkflow);
    expect(value.anchor).toEqual(JSON.parse(golden.canonicalJson));
  });

  test("canonicalizes to the committed golden bytes and to Danchor", () => {
    const value = built(facts());
    expect(new TextDecoder().decode(value.bytes)).toBe(golden.canonicalJson);
    expect(value.bytes.byteLength).toBe(golden.byteLength);
    expect(value.bytes.byteLength).toBe(1856);
    expect(value.digest).toBe(golden.digest);
    expect(value.digest).toBe("70be486e417574fa4e1211828b7e3028c7b1b8583f42d440772d514b669e2bd5");
    expect(value.digest).toBe(contracts.computeBootstrapVerifierAnchorDigest(value.anchor));
    expect(value.digest).toBe(
      contracts.framedDigest(schema, [contracts.frame.canonical(value.anchor)]),
    );
    // Domain separation: the family identity is not the bare canonical digest.
    expect(value.digest).not.toBe(contracts.canonicalDigest(value.anchor));
    expect(contracts.serializeContract(schema, value.anchor)).toEqual({
      ok: true,
      bytes: value.bytes,
      digest: value.digest,
    });
    expect(contracts.parseCanonicalContractBytes(schema, value.bytes)).toEqual({
      ok: true,
      value: value.anchor,
    });
    // The identity is a function of the facts alone, never of the wall clock.
    expect(built(facts()).digest).toBe(value.digest);
    expect(new TextDecoder().decode(built(facts()).bytes)).toBe(golden.canonicalJson);
  });

  test("orders the three OS rows canonically whatever order the operator supplies", () => {
    const rows = assets(facts());
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of permutations) {
      const supplied = facts();
      supplied.assets = order.map((index) => rows[index]!);
      const value = built(supplied);
      expect(value.anchor.assets.map((row) => row.osKind)).toEqual(["LINUX", "MACOS", "WINDOWS"]);
      expect(value.digest).toBe(golden.digest);
      expect(new TextDecoder().decode(value.bytes)).toBe(golden.canonicalJson);
    }
  });

  test("freezes and detaches the built anchor from the supplied facts", () => {
    const supplied = facts();
    const value = built(supplied);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.anchor)).toBe(true);
    expect(Object.isFrozen(value.anchor.assets)).toBe(true);
    expect(Object.isFrozen(value.anchor.operatorConfirmation)).toBe(true);
    expect(Object.isFrozen(value.anchor.signerWorkflow)).toBe(true);
    for (const row of value.anchor.assets) expect(Object.isFrozen(row)).toBe(true);
    expect(value.anchor.assets).not.toBe(supplied.assets);
    expect(value.anchor.signerWorkflow).not.toBe(supplied.signerWorkflow);
    assets(supplied)[0]!.executableSha256 = "9".repeat(64);
    at(supplied, ["signerWorkflow"]).repositoryId = "99";
    supplied.createdAt = "2030-01-01T00:00:00.000Z";
    expect(value.anchor.assets[0]!.executableSha256).toBe("3".repeat(64));
    expect(value.anchor.signerWorkflow.repositoryId).toBe("1234");
    expect(value.anchor.createdAt).toBe("2026-09-02T00:00:01.000Z");
    expect(value.digest).toBe(golden.digest);
  });

  test("accepts the same-realm mutable, sealed, frozen and null-prototype corpus", () => {
    const freezeDeep = (value: unknown, seal: boolean): void => {
      if (value !== null && typeof value === "object") {
        for (const nested of Object.values(value)) freezeDeep(nested, seal);
        if (seal) Object.seal(value);
        else Object.freeze(value);
      }
    };
    for (const mode of ["mutable", "sealed", "frozen"]) {
      const supplied = facts();
      if (mode !== "mutable") freezeDeep(supplied, mode === "sealed");
      const value = built(supplied);
      expect(value.digest).toBe(golden.digest);
      expect(value.anchor.assets).not.toBe(supplied.assets);
    }
    const nullPrototype = Object.assign(Object.create(null) as Mutable, facts());
    nullPrototype.signerWorkflow = Object.assign(
      Object.create(null) as Mutable,
      at(facts(), ["signerWorkflow"]),
    );
    assets(nullPrototype)[0] = Object.assign(
      Object.create(null) as Mutable,
      assets(facts())[0] as Mutable,
    );
    expect(built(nullPrototype).digest).toBe(golden.digest);
  });

  test("refuses absent, duplicate and substituted OS rows with the exact census code", () => {
    const rows = assets(facts());
    for (const value of [
      [],
      [rows[0], rows[1]],
      [rows[0], rows[1], rows[2], rows[0]],
      {},
      null,
      "LINUX",
      1,
    ])
      refuses(changed(["assets"], value), ["facts.assets:os-census-required"]);
    // A substituted row is one OS twice and another absent.
    refuses(changed(["assets"], [rows[0], rows[0], rows[2]]), [
      "facts.assets.LINUX:duplicated",
      "facts.assets.MACOS:missing",
    ]);
    refuses(changed(["assets"], [rows[0], rows[1], rows[1]]), [
      "facts.assets.MACOS:duplicated",
      "facts.assets.WINDOWS:missing",
    ]);
    refuses(changed(["assets"], [rows[2], rows[2], rows[2]]), [
      "facts.assets.LINUX:missing",
      "facts.assets.MACOS:missing",
      "facts.assets.WINDOWS:duplicated",
    ]);
    // Paired control: the same three rows in any order are accepted, so the
    // census gate above is the only thing those vectors trip.
    expect(built(changed(["assets"], [rows[2], rows[0], rows[1]])).digest).toBe(golden.digest);
  });

  test("refuses a substituted or malformed osKind and reports the OS it leaves absent", () => {
    for (const value of ["DARWIN", "linux", "", "LINUX\n", 1, null, "WINDOWS "])
      refuses(changed(["assets", 1, "osKind"], value), [
        "facts.assets.1.osKind:invalid",
        "facts.assets.MACOS:missing",
      ]);
    const missing = facts();
    delete assets(missing)[0]!.osKind;
    refuses(missing, ["facts.assets.0.osKind:missing", "facts.assets.LINUX:missing"]);
    // Swapping two rows' osKind keeps the census whole and is accepted as a
    // different anchor: the builder orders rows, it cannot attest their content.
    const swapped = facts();
    assets(swapped)[0]!.osKind = "MACOS";
    assets(swapped)[1]!.osKind = "LINUX";
    expect(built(swapped).digest).not.toBe(golden.digest);
  });

  test("refuses a mutable selector, a download URL, a custom root and an executable path", () => {
    for (const field of [
      ...literalFields,
      "latest",
      "selector",
      "downloadUrl",
      "releaseUrl",
      "customTrustRoot",
      "trustRoot",
      "sigstoreBundle",
      "attestationBundle",
      "verifierDigest",
      "candidateDigest",
      "kitDigest",
      "token",
      "artifactId",
      "archiveDigest",
      "executablePath",
      "installDirectory",
    ]) {
      const supplied = facts();
      supplied[field] = field === "cliVersion" ? "latest" : "untrusted";
      refuses(supplied, [`facts.${field}:unknown-field`]);
    }
    for (const field of [
      "latest",
      "downloadUrl",
      "url",
      "executablePath",
      "installDirectory",
      "fallbackAsset",
      "alternateBinary",
    ]) {
      const supplied = facts();
      assets(supplied)[0]![field] = "untrusted";
      refuses(supplied, [`facts.assets.0.${field}:unknown-field`, "facts.assets.LINUX:missing"]);
    }
    for (const field of ["token", "downloadUrl", "latest"]) {
      const supplied = facts();
      at(supplied, ["signerWorkflow"])[field] = "untrusted";
      refuses(supplied, [`facts.signerWorkflow.${field}:unknown-field`]);
    }
    // The claim literal is not the operator's to restate, even correctly.
    for (const value of ["OFFICIAL_RELEASE_ASSETS_AND_CHECKSUMS_MATCH", "CONFIRMED"]) {
      const supplied = facts();
      at(supplied, ["operatorConfirmation"]).claim = value;
      refuses(supplied, ["facts.operatorConfirmation.claim:unknown-field"]);
    }
    // Deletion mutant for the whole gate: every literal the facts census
    // excludes still lands on the built anchor with its ledger value.
    expect(builder.verifierAnchorFixedLiterals).toEqual({
      cliVersion: "2.93.0",
      expectedOidcIssuer: "https://token.actions.githubusercontent.com",
      operatorConfirmationClaim: "OFFICIAL_RELEASE_ASSETS_AND_CHECKSUMS_MATCH",
      releaseTag: "v2.93.0",
      schemaVersion: "bootstrap-verifier-anchor/v1",
      trustBootstrap: "GITHUB_CLI_DEFAULT_ONLINE_SIGSTORE_TUF",
    });
    for (const field of literalFields)
      expect(builder.verifierAnchorFactFields.facts).not.toContain(field);
  });

  test("requires every accepted fact and every nested member", () => {
    for (const field of builder.verifierAnchorFactFields.facts) {
      const supplied = facts();
      delete supplied[field];
      refuses(supplied, [`facts.${field}:missing`]);
    }
    for (const field of builder.verifierAnchorFactFields.confirmation) {
      const supplied = facts();
      delete at(supplied, ["operatorConfirmation"])[field];
      refuses(supplied, [`facts.operatorConfirmation.${field}:missing`]);
    }
    for (const field of builder.verifierAnchorFactFields.signer) {
      const supplied = facts();
      delete at(supplied, ["signerWorkflow"])[field];
      refuses(supplied, [`facts.signerWorkflow.${field}:missing`]);
    }
    for (const field of builder.verifierAnchorFactFields.asset) {
      if (field === "osKind") continue;
      const supplied = facts();
      delete assets(supplied)[2]![field];
      refuses(supplied, [`facts.assets.2.${field}:missing`, "facts.assets.WINDOWS:missing"]);
    }
    for (const value of [null, [], true, 0, "anchor"])
      refuses(value, ["facts.record:object-required"]);
    refuses(undefined, ["facts.value:non-json"]);
    refuses(new Date(), ["facts.record:plain-object-required"]);
    refuses(new Map(), ["facts.record:plain-object-required"]);
  });

  test("takes the operator's confirmation instant and never computes one", () => {
    for (const confirmedAt of [
      "1970-01-01T00:00:00.000Z",
      "2026-09-02T00:00:00.999Z",
      "2026-09-02T00:00:01.000Z",
    ]) {
      const value = built(changed(["operatorConfirmation", "confirmedAt"], confirmedAt));
      expect(value.anchor.operatorConfirmation.confirmedAt).toBe(confirmedAt);
      expect(value.anchor.createdAt).toBe("2026-09-02T00:00:01.000Z");
    }
    refuses(changed(["operatorConfirmation", "confirmedAt"], "2026-09-02T00:00:01.001Z"), [
      "operatorConfirmation.confirmedAt:after-creation",
    ]);
    refuses(changed(["createdAt"], "2026-09-01T23:59:59.999Z"), [
      "operatorConfirmation.confirmedAt:after-creation",
    ]);
    const absent = facts();
    delete at(absent, ["operatorConfirmation"]).confirmedAt;
    refuses(absent, ["facts.operatorConfirmation.confirmedAt:missing"]);
    for (const value of [
      "",
      "2026-09-02",
      "2026-09-02T00:00:00Z",
      "2026-09-02T00:00:00.000+00:00",
      "2026-02-30T00:00:00.000Z",
      "2026-09-02T00:00:00.000Z\n",
    ])
      refuses(changed(["operatorConfirmation", "confirmedAt"], value), [
        "operatorConfirmation.confirmedAt:invalid",
      ]);
  });

  test("surfaces the landed parser's grammar codes for supplied values unchanged", () => {
    refuses(changed(["createdAt"], "2026-09-02"), ["createdAt:invalid"]);
    for (const value of ["0", "01", "-1", "+1", "1.0", "1e2", "1\n", "9007199254740992", "", 1])
      refuses(changed(["repositoryId"], value), [
        "repositoryId:invalid",
        "signerWorkflow.repositoryId:mismatch",
      ]);
    refuses(changed(["operatorConfirmation", "actorId"], "0"), [
      "operatorConfirmation.actorId:invalid",
    ]);
    refuses(changed(["signerWorkflow", "repositoryId"], "4321"), [
      "signerWorkflow.repositoryId:mismatch",
    ]);
    for (const value of ["", "/a", "a\\b", "a//b", "./a", "a/../b", "C:/a", "file:a"])
      refuses(changed(["signerWorkflow", "path"], value), ["signerWorkflow.path:invalid"]);
    for (const value of ["main", "refs/tags/v1", "refs/heads/", "refs/heads/a..b", "refs/heads/a."])
      refuses(changed(["signerWorkflow", "ref"], value), ["signerWorkflow.ref:invalid"]);
    for (const value of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
      refuses(changed(["signerWorkflow", "digest"], value), ["signerWorkflow.digest:invalid"]);
      refuses(changed(["assets", 0, "archiveSha256"], value), ["assets.0.archiveSha256:invalid"]);
    }
    for (const value of ["", ".", "..", "../gh", "C:\\gh.exe", "path/name", "gh\u0000"])
      refuses(changed(["assets", 2, "executableName"], value), ["assets.2.executableName:invalid"]);
    for (const value of ["arm64", "x64", "IA32", "", "X64\n"])
      refuses(changed(["assets", 1, "architecture"], value), ["assets.1.architecture:invalid"]);
    // Facts-boundary codes are namespaced; grammar codes are the parser's own.
    const boundaryResult = builder.buildBootstrapVerifierAnchor(changed(["latest"], "x"));
    const grammarResult = builder.buildBootstrapVerifierAnchor(
      changed(["createdAt"], "2026-09-02"),
    );
    expect(boundaryResult.ok).toBe(false);
    expect(grammarResult.ok).toBe(false);
    if (boundaryResult.ok || grammarResult.ok) throw new Error("vector accepted");
    expect(boundaryResult.issues.every((issue) => issue.startsWith("facts."))).toBe(true);
    expect(grammarResult.issues.some((issue) => issue.startsWith("facts."))).toBe(false);
  });

  test("refuses hostile reflection before assembling any member", () => {
    const trap = vi.fn(() => {
      throw new Error("must not run");
    });
    for (const path of records) {
      const prefix = boundary(path);
      const first = Object.keys(at(facts(), path))[0]!;
      const accessor = facts();
      Object.defineProperty(at(accessor, path), first, { enumerable: true, get: trap });
      refuses(accessor, [`${prefix}${first}:accessor-refused`]);
      const symbol = facts();
      Object.defineProperty(at(symbol, path), Symbol("extra"), { value: 1 });
      refuses(symbol, [`${prefix}value:symbol-field-refused`]);
      const hidden = facts();
      Object.defineProperty(at(hidden, path), "hidden", { value: 1 });
      refuses(hidden, [`${prefix}hidden:non-enumerable-refused`]);
      const proto = facts();
      Object.setPrototypeOf(at(proto, path), {});
      refuses(proto, [`${prefix}record:plain-object-required`]);
      const proxy = new Proxy(at(facts(), path), {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      });
      refuses(path.length ? changed(path, proxy) : proxy, [`${prefix}value:proxy-refused`]);
    }
    const rows = assets(facts());
    const hole = [...rows];
    delete hole[1];
    refuses(changed(["assets"], hole), ["facts.assets:array:keys-refused"]);
    refuses(changed(["assets"], Object.assign([...rows], { extra: true })), [
      "facts.assets:array:keys-refused",
    ]);
    refuses(
      changed(["assets"], Object.defineProperty([...rows], Symbol.iterator, { value: trap })),
      ["facts.assets:value:symbol-field-refused"],
    );
    refuses(changed(["assets"], Object.defineProperty([...rows], "0", { get: trap })), [
      "facts.assets:array:0:descriptor-refused",
    ]);
    refuses(changed(["assets"], new Proxy([...rows], { get: trap, ownKeys: trap })), [
      "facts.assets:value:proxy-refused",
    ]);
    class Rows extends Array<unknown> {}
    refuses(changed(["assets"], new Rows(...rows)), [
      "facts.assets:array:exact-prototype-required",
    ]);
    refuses(changed(["assets"], runInNewContext(JSON.stringify(rows))), [
      "facts.assets:array:exact-prototype-required",
    ]);
    refuses(runInNewContext(`(${JSON.stringify(facts())})`), [
      "facts.record:plain-object-required",
    ]);
    const cyclic = facts();
    cyclic.signerWorkflow = cyclic;
    refuses(cyclic, ["facts.signerWorkflow:value:cycle-refused"]);
    expect(trap).not.toHaveBeenCalled();
  });

  test("builds a consistently substituted anchor as a different identity, never a trusted one", () => {
    const substituted = facts();
    for (const row of assets(substituted))
      for (const field of digestFields) row[field] = "a".repeat(64);
    at(substituted, ["signerWorkflow"]).digest = "b".repeat(64);
    at(substituted, ["signerWorkflow"]).path = ".github/workflows/substituted.yml";
    at(substituted, ["signerWorkflow"]).ref = "refs/heads/substituted";
    const value = built(substituted);
    // Structurally valid and internally consistent, yet a different Danchor:
    // the builder cannot detect a substitution, only refuse to hide it. Only
    // ISS-036's operator action O7 — independent acquisition and comparison —
    // decides whether the supplied facts are the official ones, and the
    // attestation bundle and verifier executable are not members of this
    // family at all, so this file makes no claim about them.
    expect(value.digest).not.toBe(golden.digest);
    expect(new TextDecoder().decode(value.bytes)).not.toBe(golden.canonicalJson);
    expect(contracts.parseBootstrapVerifierAnchor(value.anchor).ok).toBe(true);
    // One axis at a time: each supplied identity moves the anchor identity.
    const moved = new Set<string>([golden.digest]);
    for (const index of [0, 1, 2])
      for (const field of digestFields) {
        const one = built(changed(["assets", index, field], "9".repeat(64)));
        expect(one.digest).not.toBe(golden.digest);
        moved.add(one.digest);
      }
    for (const field of ["digest", "ref", "path"] as const) {
      const replacement = { digest: "c".repeat(64), path: "a/b.yml", ref: "refs/heads/other" };
      const one = built(changed(["signerWorkflow", field], replacement[field]));
      expect(one.digest).not.toBe(golden.digest);
      moved.add(one.digest);
    }
    expect(moved.size).toBe(13);
  });

  test("pins the module's public export census and its shared field sources", () => {
    expect(Object.keys(builder).sort()).toEqual([
      "buildBootstrapVerifierAnchor",
      "verifierAnchorFactFields",
      "verifierAnchorFixedLiterals",
      "verifierAnchorOsOrder",
    ]);
    expect(builder.verifierAnchorOsOrder).toEqual(["LINUX", "MACOS", "WINDOWS"]);
    expect(Object.isFrozen(builder.verifierAnchorOsOrder)).toBe(true);
    expect(Object.isFrozen(builder.verifierAnchorFixedLiterals)).toBe(true);
    expect(Object.isFrozen(builder.verifierAnchorFactFields)).toBe(true);
    expect(builder.verifierAnchorFactFields.facts).toEqual([
      "assets",
      "createdAt",
      "operatorConfirmation",
      "repositoryId",
      "signerWorkflow",
    ]);
    expect(builder.verifierAnchorFactFields.confirmation).toEqual(["actorId", "confirmedAt"]);
    // Asset and signer censuses are the ledger's own objects, not copies.
    expect(builder.verifierAnchorFactFields.asset).toBe(contracts.verifierAnchorSchemaFields.asset);
    expect(builder.verifierAnchorFactFields.signer).toBe(
      contracts.verifierAnchorSchemaFields.signer,
    );
    expect(builder.verifierAnchorFactFields.confirmation).not.toEqual(
      contracts.verifierAnchorSchemaFields.confirmation,
    );
    expect(contracts.verifierAnchorSchemaVersions).toEqual([schema]);
    expect(contracts.compatibilityDisposition(schema, schema)).toBe("readable");
    // No acquisition, verification, installation or authority verb is exported.
    expect(
      Object.keys(builder).some((name) =>
        /Download|Fetch|Acquire|Install|Verify|Authorize|Certify|Trust/.test(name),
      ),
    ).toBe(false);
  });
});
