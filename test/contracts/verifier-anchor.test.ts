import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import * as c from "../../packages/contracts/src/index.js";
import * as anchor from "../../packages/contracts/src/verifier-anchor.js";

const schema = "bootstrap-verifier-anchor/v1";
function fixture() {
  return {
    assets: [
      {
        architecture: "X64",
        archiveSha256: "1".repeat(64),
        assetName: "gh_2.93.0_linux_amd64.tar.gz",
        checksumManifestName: "gh_2.93.0_checksums.txt",
        checksumManifestSha256: "2".repeat(64),
        executableName: "gh",
        executableSha256: "3".repeat(64),
        osKind: "LINUX",
      },
      {
        architecture: "ARM64",
        archiveSha256: "1".repeat(64),
        assetName: "gh_2.93.0_macOS_arm64.zip",
        checksumManifestName: "gh_2.93.0_checksums.txt",
        checksumManifestSha256: "2".repeat(64),
        executableName: "gh",
        executableSha256: "3".repeat(64),
        osKind: "MACOS",
      },
      {
        architecture: "X64",
        archiveSha256: "1".repeat(64),
        assetName: "gh_2.93.0_windows_amd64.zip",
        checksumManifestName: "gh_2.93.0_checksums.txt",
        checksumManifestSha256: "2".repeat(64),
        executableName: "gh.exe",
        executableSha256: "3".repeat(64),
        osKind: "WINDOWS",
      },
    ],
    cliVersion: "2.93.0",
    createdAt: "2026-09-02T00:00:01.000Z",
    expectedOidcIssuer: "https://token.actions.githubusercontent.com",
    operatorConfirmation: {
      actorId: "5678",
      claim: "OFFICIAL_RELEASE_ASSETS_AND_CHECKSUMS_MATCH",
      confirmedAt: "2026-09-02T00:00:00.000Z",
    },
    releaseTag: "v2.93.0",
    repositoryId: "1234",
    schemaVersion: schema,
    signerWorkflow: {
      digest: "4".repeat(64),
      path: ".github/workflows/review.yml",
      ref: "refs/heads/main",
      repositoryId: "1234",
    },
    trustBootstrap: "GITHUB_CLI_DEFAULT_ONLINE_SIGSTORE_TUF",
  };
}
type Path = readonly (string | number)[];
function at(root: unknown, path: Path): Record<string | number, unknown> {
  let current = root;
  for (const key of path) current = (current as Record<string | number, unknown>)[key];
  return current as Record<string | number, unknown>;
}
function changed(path: Path, value: unknown) {
  const root = fixture();
  at(root, path.slice(0, -1))[path[path.length - 1]!] = value;
  return root;
}
function refused(value: unknown) {
  expect(anchor.parseBootstrapVerifierAnchor(value).ok).toBe(false);
  expect(c.parseContract(schema, value).ok).toBe(false);
  expect(c.serializeContract(schema, value).ok).toBe(false);
  expect(() => anchor.computeBootstrapVerifierAnchorDigest(value)).toThrow(TypeError);
}
const records: Path[] = [
  [],
  ["assets", 0],
  ["assets", 1],
  ["assets", 2],
  ["operatorConfirmation"],
  ["signerWorkflow"],
];
function freezeDeep(value: unknown, seal = false): void {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) freezeDeep(nested, seal);
    if (seal) Object.seal(value);
    else Object.freeze(value);
  }
}

describe("bootstrap verifier anchor: supplied value only", () => {
  test("accepts mutable/sealed/frozen values and detaches the entire successful snapshot", () => {
    for (const mode of ["mutable", "sealed", "frozen"]) {
      const input = fixture();
      if (mode !== "mutable") freezeDeep(input, mode === "sealed");
      const parsed = anchor.parseBootstrapVerifierAnchor(input);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("fixture refused");
      expect(parsed.value).toEqual(input);
      expect(parsed.value).not.toBe(input);
      expect(parsed.value.assets).not.toBe(input.assets);
      for (const path of [...records, ["assets"]])
        expect(Object.isFrozen(at(parsed.value, path))).toBe(true);
      if (mode === "mutable") {
        input.assets[0]!.executableSha256 = "9".repeat(64);
        input.signerWorkflow.repositoryId = "99";
        expect(parsed.value.assets[0]!.executableSha256).toBe("3".repeat(64));
        expect(parsed.value.signerWorkflow.repositoryId).toBe("1234");
      }
    }
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, fixture());
    expect(anchor.parseBootstrapVerifierAnchor(nullPrototype).ok).toBe(true);
  });

  test("requires every member at every nested record, with no null/extra/renamed member", () => {
    for (const path of records) {
      for (const field of Object.keys(at(fixture(), path))) {
        const missing = fixture();
        delete at(missing, path)[field];
        refused(missing);
        refused(changed([...path, field], null));
        refused(
          changed(
            [...path, field],
            typeof at(fixture(), path)[field] === "string" ? 1 : "wrong type",
          ),
        );
        const renamed = fixture();
        const row = at(renamed, path);
        row[`${field}Other`] = row[field];
        delete row[field];
        refused(renamed);
      }
      const extra = fixture();
      at(extra, path).unexpected = true;
      refused(extra);
    }
    for (const value of [undefined, null, [], true, 0, "anchor", new Date()]) refused(value);
  });

  test("pins the complete public field, schema, compatibility and export census", () => {
    const f = fixture();
    const locations = {
      anchor: f,
      asset: f.assets[0]!,
      confirmation: f.operatorConfirmation,
      signer: f.signerWorkflow,
    };
    for (const [kind, row] of Object.entries(locations)) {
      const key = kind as keyof typeof anchor.verifierAnchorSchemaFields;
      expect(anchor.verifierAnchorSchemaFields[key]).toEqual(Object.keys(row).sort());
      const registryKey = kind === "anchor" ? schema : `${schema}#${kind}`;
      expect(c.schemaVocabularyDefinitions[registryKey]!.fields).toEqual(Object.keys(row).sort());
    }
    expect(c.schemaVersions.filter((s) => s === schema)).toHaveLength(1);
    expect(c.compatibilityMatrix).toContainEqual({
      expectedSchemaVersion: schema,
      observedSchemaVersion: schema,
      disposition: "readable",
    });
    for (const version of [
      null,
      "bootstrap-verifier-anchor/v0",
      "bootstrap-verifier-anchor/v2",
      "repository-protection-receipt/v1",
    ])
      expect(c.compatibilityDisposition(schema, version)).toBe("refused");
    expect(anchor.parseVerifierAnchorContract("unknown/v1", f)).toBeNull();
    expect(Object.keys(anchor).sort()).toEqual([
      "computeBootstrapVerifierAnchorDigest",
      "parseBootstrapVerifierAnchor",
      "parseVerifierAnchorContract",
      "verifierAnchorSchemaFields",
      "verifierAnchorSchemaVersions",
    ]);
    for (const [name, value] of Object.entries(anchor))
      expect((c as Record<string, unknown>)[name]).toBe(value);
  });

  test("pins literals and retains the three OS rows in fixed order for either architecture", () => {
    for (const key of [
      "schemaVersion",
      "cliVersion",
      "releaseTag",
      "expectedOidcIssuer",
      "trustBootstrap",
    ])
      for (const value of ["", "latest", "alternate", `${at(fixture(), [])[key]}\n`])
        refused(changed([key], value));
    refused(changed(["operatorConfirmation", "claim"], "CONFIRMED"));
    for (const index of [0, 1, 2]) {
      for (const architecture of ["ARM64", "X64"])
        expect(
          anchor.parseBootstrapVerifierAnchor(
            changed(["assets", index, "architecture"], architecture),
          ).ok,
        ).toBe(true);
      for (const architecture of ["arm64", "x64", "IA32", "", "X64\n"])
        refused(changed(["assets", index, "architecture"], architecture));
      for (const os of ["linux", "OTHER", "", "LINUX\n"])
        refused(changed(["assets", index, "osKind"], os));
    }
    const f = fixture();
    for (const rows of [
      [],
      f.assets.slice(0, 2),
      [...f.assets, f.assets[0]],
      [...f.assets].reverse(),
      [f.assets[0], f.assets[0], f.assets[2]],
    ])
      refused(changed(["assets"], rows));
  });

  test("rejects malformed numeric identities including unsafe values and final newlines", () => {
    for (const path of [
      ["repositoryId"],
      ["signerWorkflow", "repositoryId"],
      ["operatorConfirmation", "actorId"],
    ]) {
      for (const value of [
        0,
        1,
        "0",
        "01",
        "-1",
        "+1",
        "1.0",
        "1e2",
        "1\n",
        "9007199254740992",
        "",
        " ",
      ])
        refused(changed(path, value));
    }
    for (const id of ["1", "9007199254740991"]) {
      const f = fixture();
      f.repositoryId = id;
      f.signerWorkflow.repositoryId = id;
      f.operatorConfirmation.actorId = id;
      expect(anchor.parseBootstrapVerifierAnchor(f).ok).toBe(true);
    }
    refused(changed(["signerWorkflow", "repositoryId"], "1235"));
  });

  test("validates every content identity independently", () => {
    const paths: Path[] = [["signerWorkflow", "digest"]];
    for (const i of [0, 1, 2])
      for (const field of ["archiveSha256", "checksumManifestSha256", "executableSha256"])
        paths.push(["assets", i, field]);
    for (const path of paths) {
      for (const value of [
        "",
        "a".repeat(63),
        "a".repeat(65),
        "A".repeat(64),
        "g".repeat(64),
        `${"a".repeat(64)}\n`,
      ])
        refused(changed(path, value));
      const altered = changed(path, "9".repeat(64));
      expect(anchor.parseBootstrapVerifierAnchor(altered).ok).toBe(true);
      expect(anchor.computeBootstrapVerifierAnchorDigest(altered)).not.toBe(
        anchor.computeBootstrapVerifierAnchorDigest(fixture()),
      );
    }
  });

  test("bounds safe names in UTF-8 bytes and refuses path/control substitutions", () => {
    for (const i of [0, 1, 2])
      for (const field of ["assetName", "checksumManifestName", "executableName"]) {
        const path = ["assets", i, field];
        for (const value of ["x", "x".repeat(256), "é".repeat(128)])
          expect(anchor.parseBootstrapVerifierAnchor(changed(path, value)).ok).toBe(true);
        for (const value of [
          "",
          ".",
          "..",
          "../gh",
          "C:\\gh.exe",
          "path/name",
          "x\n",
          "x\u0085",
          "x\u0000",
          "x".repeat(257),
          "é".repeat(129),
          "\ud800",
        ])
          refused(changed(path, value));
      }
  });

  test("closes repository path and Git branch ref grammars and byte bounds", () => {
    for (const path of ["a", "a".repeat(512), "é".repeat(256), ".github/workflows/review.yml"])
      expect(
        anchor.parseBootstrapVerifierAnchor(changed(["signerWorkflow", "path"], path)).ok,
      ).toBe(true);
    for (const path of [
      "",
      "/a",
      "a\\b",
      "a//b",
      "./a",
      "a/../b",
      "a/",
      "file:a",
      "C:/a",
      "a\n",
      "a".repeat(513),
      "é".repeat(257),
    ])
      refused(changed(["signerWorkflow", "path"], path));
    for (const ref of [
      "refs/heads/a",
      "refs/heads/topic/é",
      "refs/heads/" + "x".repeat(501),
      "refs/heads/" + "é".repeat(250) + "x",
    ])
      expect(anchor.parseBootstrapVerifierAnchor(changed(["signerWorkflow", "ref"], ref)).ok).toBe(
        true,
      );
    for (const ref of [
      "main",
      "refs/tags/v1",
      "refs/heads/",
      "refs/heads/.hidden",
      "refs/heads/a..b",
      "refs/heads/a.lock/b",
      "refs/heads/a.lock",
      "refs/heads/a.",
      "refs/heads/a//b",
      "refs/heads/a/../b",
      "refs/heads/a@{b",
      "refs/heads/a b",
      "refs/heads/a:b",
      "refs/heads/a*",
      "refs/heads/a[",
      "refs/heads/a?",
      "refs/heads/a~",
      "refs/heads/a^",
      "refs/heads/a\\b",
      "refs/heads/a\n",
      "refs/heads/" + "x".repeat(502),
      "refs/heads/" + "é".repeat(251),
    ])
      refused(changed(["signerWorkflow", "ref"], ref));
  });

  test("checks canonical instants and confirmation-before-creation including equality", () => {
    for (const path of [["createdAt"], ["operatorConfirmation", "confirmedAt"]])
      for (const value of [
        "",
        "2026-09-02",
        "2026-09-02T00:00:00Z",
        "2026-09-02T00:00:00.000+00:00",
        "2026-02-30T00:00:00.000Z",
        "2026-09-02T00:00:00.000Z\n",
      ])
        refused(changed(path, value));
    expect(
      anchor.parseBootstrapVerifierAnchor(
        changed(["operatorConfirmation", "confirmedAt"], fixture().createdAt),
      ).ok,
    ).toBe(true);
    refused(changed(["operatorConfirmation", "confirmedAt"], "2026-09-02T00:00:01.001Z"));
    refused(changed(["createdAt"], "2026-09-01T23:59:59.999Z"));
  });

  test("refuses hostile reflection without invoking accessors, iterators, or proxy traps", () => {
    const trap = vi.fn(() => {
      throw new Error("must not run");
    });
    for (const path of records) {
      const accessor = fixture();
      Object.defineProperty(at(accessor, path), Object.keys(at(accessor, path))[0]!, {
        enumerable: true,
        get: trap,
      });
      refused(accessor);
      const symbol = fixture();
      Object.defineProperty(at(symbol, path), Symbol("extra"), { value: 1 });
      refused(symbol);
      const hidden = fixture();
      Object.defineProperty(at(hidden, path), "hidden", { value: 1 });
      refused(hidden);
      const proto = fixture();
      Object.setPrototypeOf(at(proto, path), {});
      refused(proto);
      const proxy = new Proxy(at(fixture(), path), {
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        get: trap,
      });
      refused(path.length ? changed(path, proxy) : proxy);
    }
    const rows = fixture().assets;
    for (const make of [
      () => {
        const a = [...rows];
        delete a[1];
        return a;
      },
      () => Object.assign([...rows], { extra: true }),
      () => Object.defineProperty([...rows], Symbol.iterator, { value: trap }),
      () => Object.defineProperty([...rows], "0", { get: trap }),
      () => new Proxy([...rows], { ownKeys: trap, get: trap }),
      () => {
        class Rows extends Array<(typeof rows)[number]> {}
        return new Rows(...rows);
      },
      () => runInNewContext(JSON.stringify(rows)),
    ])
      refused(changed(["assets"], make()));
    refused(runInNewContext(`(${JSON.stringify(fixture())})`));
    const cyclic = fixture();
    (cyclic as unknown as Record<string, unknown>).signerWorkflow = cyclic;
    refused(cyclic);
    expect(trap).not.toHaveBeenCalled();
  });

  test("rejects authority, post-upload and executable-path additions", () => {
    for (const field of [
      "candidateDigest",
      "kitDigest",
      "customTrustRoot",
      "trustRoot",
      "token",
      "executablePath",
      "artifactId",
      "archiveDigest",
      "latest",
    ])
      for (const path of [[], ["signerWorkflow"], ["assets", 0]]) {
        const f = fixture();
        at(f, path)[field] = "untrusted";
        refused(f);
      }
    // A consistently changed supplied identity is only another structural claim.
    const f = fixture();
    f.repositoryId = "900";
    f.signerWorkflow.repositoryId = "900";
    expect(anchor.parseBootstrapVerifierAnchor(f).ok).toBe(true);
    expect(
      Object.keys(anchor).some((name) => /Authorize|VerifyOfficial|Install|Select|Bind/.test(name)),
    ).toBe(false);
  });

  test("round-trips canonical bytes and refuses alternative encodings or malformed snapshots", () => {
    const f = fixture();
    const serialized = c.serializeContract(schema, f);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error("serialization refused");
    const canonical = new TextDecoder().decode(serialized.bytes);
    expect(canonical).toBe(JSON.stringify(f) + "\n");
    expect(serialized.bytes.byteLength).toBe(1856);
    expect(serialized.digest).toBe(
      "70be486e417574fa4e1211828b7e3028c7b1b8583f42d440772d514b669e2bd5",
    );
    expect(serialized.digest).toBe(anchor.computeBootstrapVerifierAnchorDigest(f));
    expect(serialized.digest).not.toBe(c.canonicalDigest(f));
    expect(c.parseCanonicalContractBytes(schema, serialized.bytes)).toEqual({ ok: true, value: f });
    const bytes = (value: string) => new TextEncoder().encode(value);
    for (const bad of [
      canonical.trimEnd(),
      canonical + "\n",
      " " + canonical,
      "\ufeff" + canonical,
      JSON.stringify(f, null, 2) + "\n",
      canonical.replace('"cliVersion":"2.93.0"', '"cliVersion":"latest"'),
    ])
      expect(c.parseCanonicalContractBytes(schema, bytes(bad)).ok).toBe(false);
    expect(c.parseCanonicalContractBytes(schema, new Uint8Array([255, 10])).ok).toBe(false);
    expect(c.parseCanonicalContractBytes(schema, new Uint8Array(new SharedArrayBuffer(1))).ok).toBe(
      false,
    );
    const reversed = Object.fromEntries(Object.entries(f).reverse());
    expect(c.serializeContract(schema, reversed)).toEqual(serialized);
  });
});
