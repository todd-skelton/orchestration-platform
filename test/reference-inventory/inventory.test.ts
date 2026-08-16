import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { regularCapabilitySlot } from "../../scripts/capability-slots.mjs";
import { inventoryTestApi, loadInventory, validateInventory } from "./inventory.mjs";
import { redactionTestApi } from "./redaction.mjs";
import { parseLiveArguments } from "./source-evidence.mjs";

const root = resolve(import.meta.dirname, "../..");
let baseline: any;

function mutant(): any {
  return structuredClone(baseline);
}

beforeAll(async () => {
  baseline = await loadInventory();
});

describe("sanitized reference inventory", () => {
  test("binds every artifact, entrypoint, semantic mutation, path, and linked uncertainty", () => {
    expect(validateInventory(baseline)).toEqual({
      artifactCount: 112,
      entrypointCount: 79,
      effectCandidateCount: 887,
      mutationGroupCount: 10,
      sourcePathCount: 112,
      sensitiveComponentCount: 116,
      sensitiveTokenCount: 110,
      unresolved: 2,
    });
  });

  test("semantically partitions the broad local-write signal by independently classified artifacts", () => {
    const writes = baseline.mutations.callsites.filter(
      ({ signalKind }: any) => signalKind === "fixture-local-write",
    );
    const count = (classification: string) =>
      writes.filter((row: any) => row.classification === classification).length;
    const artifacts = (classification: string) =>
      new Set(
        writes
          .filter((row: any) => row.classification === classification)
          .map(({ artifactId }: any) => artifactId),
      ).size;
    expect({
      platform: [count("platform-mechanism"), artifacts("platform-mechanism")],
      compatibility: [count("historical-compatibility"), artifacts("historical-compatibility")],
      adapter: [count("adapter-policy"), artifacts("adapter-policy")],
    }).toEqual({ platform: [387, 44], compatibility: [52, 11], adapter: [4, 1] });
  });

  test.each([
    ["missing artifact", (snapshot: any) => snapshot.artifacts.artifacts.pop()],
    [
      "duplicate artifact",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[1] = structuredClone(snapshot.artifacts.artifacts[0]);
      },
    ],
    [
      "extra artifact",
      (snapshot: any) =>
        snapshot.artifacts.artifacts.push(structuredClone(snapshot.artifacts.artifacts[0])),
    ],
    [
      "moved artifact digest",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[0].pathDigest = "0".repeat(64);
      },
    ],
    [
      "changed content evidence",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[0].contentDigest = "0".repeat(64);
      },
    ],
    [
      "semantic artifact relabel",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[0].classification = "adapter-policy";
      },
    ],
    [
      "obsolete disposition without issue evidence",
      (snapshot: any) => {
        snapshot.artifacts.artifacts[0].classification = "obsolete";
        snapshot.artifacts.artifacts[0].disposition = "obsolete";
      },
    ],
    [
      "extension census mismatch",
      (snapshot: any) => {
        snapshot.source.extensionCensus.ps1 -= 1;
      },
    ],
    [
      "empty behavior capability",
      (snapshot: any) => {
        snapshot.behaviors.families[0].capabilities = [];
      },
    ],
    ["missing entrypoint", (snapshot: any) => snapshot.entrypoints.entrypoints.pop()],
    [
      "dangling entrypoint",
      (snapshot: any) => {
        snapshot.entrypoints.entrypoints[0].artifactId = "artifact-999";
      },
    ],
    [
      "empty entrypoint behavior family",
      (snapshot: any) => {
        snapshot.entrypoints.entrypoints[0].behaviorFamilyIds = [];
      },
    ],
    [
      "substituted entrypoint behavior family",
      (snapshot: any) => {
        snapshot.entrypoints.entrypoints[0].behaviorFamilyIds = ["behavior-worker-lifecycle"];
      },
    ],
    [
      "entrypoint semantic reroot",
      (snapshot: any) => {
        snapshot.entrypoints.entrypoints[0].behaviorFamilyIds = ["behavior-worker-lifecycle"];
        const rootValue = inventoryTestApi.aggregateRows(
          "reference-entrypoint-semantic-root/v1",
          snapshot.entrypoints.entrypoints.map(inventoryTestApi.entrypointEvidence),
        );
        snapshot.entrypoints.semanticRoot = rootValue;
        snapshot.source.semanticRoots.entrypoints = rootValue;
      },
    ],
    ["missing mutation callsite", (snapshot: any) => snapshot.mutations.callsites.pop()],
    [
      "duplicate mutation callsite",
      (snapshot: any) => {
        snapshot.mutations.callsites[1] = structuredClone(snapshot.mutations.callsites[0]);
      },
    ],
    [
      "callsite artifact substitution",
      (snapshot: any) => {
        snapshot.mutations.callsites[0].artifactId = snapshot.mutations.callsites[1].artifactId;
      },
    ],
    [
      "callsite mutation-class relabel",
      (snapshot: any) => {
        snapshot.mutations.callsites[0].mutationClass = "repository";
      },
    ],
    [
      "cross-classification callsite move",
      (snapshot: any) => {
        const row = snapshot.mutations.callsites.find(
          ({ signalKind, classification }: any) =>
            signalKind === "fixture-local-write" && classification === "platform-mechanism",
        );
        row.classification = "historical-compatibility";
        row.mutationGroupId = "mutation-compatibility-filesystem";
      },
    ],
    [
      "semantic mutation reroot",
      (snapshot: any) => {
        snapshot.mutations.callsites[0].mutationClass = "repository";
        const rootValue = inventoryTestApi.aggregateRows(
          "reference-semantic-mutation-root/v1",
          snapshot.mutations.callsites.map(inventoryTestApi.callsiteEvidence),
        );
        snapshot.mutations.semanticRoot = rootValue;
        snapshot.source.semanticRoots.mutations = rootValue;
      },
    ],
    ["missing semantic group", (snapshot: any) => snapshot.mutations.mutationGroups.pop()],
    [
      "arbitrary extra semantic group",
      (snapshot: any) =>
        snapshot.mutations.mutationGroups.push(
          structuredClone(snapshot.mutations.mutationGroups[0]),
        ),
    ],
    [
      "wrong group callsite count",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].callsiteCount += 1;
      },
    ],
    [
      "wrong group callsite root",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].callsiteRoot = "0".repeat(64);
      },
    ],
    [
      "fixture authority substituted onto platform writes",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups.find(
          ({ mutationGroupId }: any) => mutationGroupId === "mutation-platform-filesystem",
        ).authorityId = "authority-test-fixture";
      },
    ],
    [
      "mismatched authorizing observation",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].authorizingObservationId =
          "observation-fixture-confinement";
      },
    ],
    [
      "unbounded extra failure mode",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].failureModes.push("arbitrary-failure");
      },
    ],
    [
      "incompatible recovery",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].recoveryTransitionId = "transition-remove-fixture";
      },
    ],
    [
      "arbitrary idempotency phrase",
      (snapshot: any) => {
        snapshot.mutations.mutationGroups[0].idempotency = "retry-sometimes";
      },
    ],
    [
      "arbitrary extra authority",
      (snapshot: any) =>
        snapshot.authorities.authorities.push({
          id: "authority-extra",
          kind: "host-state",
          requiredObservation: "observation-path-confinement",
        }),
    ],
    [
      "arbitrary extra transition",
      (snapshot: any) =>
        snapshot.transitions.transitions.push({
          id: "transition-extra",
          from: "partial-write",
          to: "terminal",
          preserves: ["evidence"],
        }),
    ],
    [
      "resolution issue substitution",
      (snapshot: any) => {
        snapshot.assumptions.assumptions.at(-1).resolution.issue = "ISS-022";
      },
    ],
    [
      "resolution kind substitution",
      (snapshot: any) => {
        snapshot.assumptions.assumptions.at(-1).resolution.kind = "decision";
      },
    ],
    [
      "extra linked resolution",
      (snapshot: any) => {
        snapshot.assumptions.assumptions[0].disposition = "linked-probe";
        snapshot.assumptions.assumptions[0].resolution = { kind: "probe", issue: "ISS-024" };
      },
    ],
    [
      "unlinked uncertainty",
      (snapshot: any) => {
        delete snapshot.assumptions.assumptions.at(-1).resolution;
      },
    ],
    [
      "missing source path",
      (snapshot: any) => snapshot["redaction-oracle"].sourcePathCensus.entries.pop(),
    ],
    [
      "extra source path",
      (snapshot: any) =>
        snapshot["redaction-oracle"].sourcePathCensus.entries.push(
          structuredClone(snapshot["redaction-oracle"].sourcePathCensus.entries[0]),
        ),
    ],
    [
      "source path component digest change",
      (snapshot: any) => {
        snapshot["redaction-oracle"].sourcePathCensus.entries[0].componentDigests[0] = "0".repeat(
          64,
        );
      },
    ],
    [
      "missing source path token evidence",
      (snapshot: any) => {
        snapshot["redaction-oracle"].sourcePathCensus.entries[0].tokenDigests = [];
      },
    ],
    [
      "missing source path ngram evidence",
      (snapshot: any) => {
        snapshot["redaction-oracle"].sourcePathCensus.entries[0].ngramDigests = [];
      },
    ],
    [
      "missing sensitive component",
      (snapshot: any) => {
        snapshot["redaction-oracle"].sourcePathCensus.sensitivity.sensitiveComponentDigests.pop();
      },
    ],
    [
      "overlapping token sensitivity partitions",
      (snapshot: any) => {
        const sensitivity = snapshot["redaction-oracle"].sourcePathCensus.sensitivity;
        sensitivity.tokenCollisionDigests.push(sensitivity.sensitiveTokenDigests[0]);
        sensitivity.tokenCollisionDigests.sort();
      },
    ],
    [
      "changed copied-source byte boundary",
      (snapshot: any) => {
        snapshot["redaction-oracle"].copyPolicy.minimumNormalizedBytes = 159;
      },
    ],
    [
      "missing publication fingerprint family",
      (snapshot: any) => {
        snapshot["redaction-oracle"].publicationFingerprintCensus.families.pop();
      },
    ],
    [
      "raw redaction oracle row",
      (snapshot: any) => {
        snapshot["redaction-oracle"].entries[0].digest = "consumer-brand-canary";
      },
    ],
  ])("rejects the %s mutant", (_name, mutate) => {
    const snapshot = mutant();
    mutate(snapshot);
    expect(() => validateInventory(snapshot)).toThrow(/REFERENCE_INVENTORY_MISMATCH/);
  });

  test("both exact capability slots own only the declared ISS-001 commands", async () => {
    await expect(regularCapabilitySlot(root, "ISS-001", "inventory:check")).resolves.toBe(
      resolve(root, "test/capability-slots/ISS-001/inventory%3Acheck.mjs"),
    );
    await expect(regularCapabilitySlot(root, "ISS-001", "inventory:redaction-check")).resolves.toBe(
      resolve(root, "test/capability-slots/ISS-001/inventory%3Aredaction-check.mjs"),
    );
    await expect(
      regularCapabilitySlot(root, "ISS-001", "inventory:extra"),
    ).resolves.toBeUndefined();
  });
});

describe("reference redaction controls", () => {
  test("hashed vocabulary rejects normalized token and n-gram variants", () => {
    const synthetic = "consumer-brand-canary";
    const forbidden = new Set([redactionTestApi.forbiddenDigest(synthetic)]);
    expect(redactionTestApi.textFindings(`prefix ${synthetic} suffix`, forbidden)).toContain(
      "forbidden-vocabulary",
    );
  });

  test("hashed source-path evidence detects paths and leaf components without retaining them", () => {
    const syntheticPath = ["neutral", "deep-source-file.ps1"].join("/");
    const component = syntheticPath.split("/").at(-1)!;
    const token = "deep";
    const shortComponent = "x";
    const oracle = {
      rawPaths: new Set([redactionTestApi.pathDigest("reference-artifact-path/v1", syntheticPath)]),
      normalizedPaths: new Set([
        redactionTestApi.pathDigest("reference-source-path-normalized/v1", syntheticPath),
      ]),
      sensitiveComponents: new Set([
        redactionTestApi.pathDigest("reference-source-path-component/v1", component),
        redactionTestApi.pathDigest("reference-source-path-component/v1", shortComponent),
      ]),
      componentCollisions: new Set<string>(),
      sensitiveTokens: new Set([
        redactionTestApi.pathDigest("reference-source-path-token/v1", token),
      ]),
      tokenCollisions: new Set<string>(),
      ngrams: new Set<string>(),
    };
    expect(redactionTestApi.textFindings(syntheticPath.toUpperCase(), new Set(), oracle)).toContain(
      "source-relative-path",
    );
    expect(redactionTestApi.textFindings(component, new Set(), oracle)).toContain(
      "source-path-component",
    );
    expect(
      redactionTestApi.textFindings(`boundary/${token}/boundary`, new Set(), oracle),
    ).toContain("source-path-token");
    expect(
      redactionTestApi.textFindings(`boundary/${shortComponent}/boundary`, new Set(), oracle),
    ).toContain("source-path-component");
  });

  test("committed collision partitions are disjoint exhaustive self-scan negatives", () => {
    const oracle = redactionTestApi.buildPathOracle(baseline);
    expect({
      sensitiveComponents: oracle.sensitiveComponents.size,
      componentCollisions: oracle.componentCollisions.size,
      sensitiveTokens: oracle.sensitiveTokens.size,
      tokenCollisions: oracle.tokenCollisions.size,
    }).toEqual({
      sensitiveComponents: 116,
      componentCollisions: 2,
      sensitiveTokens: 110,
      tokenCollisions: 29,
    });
    expect(
      [...oracle.sensitiveComponents].some((value) => oracle.componentCollisions.has(value)),
    ).toBe(false);
    expect([...oracle.sensitiveTokens].some((value) => oracle.tokenCollisions.has(value))).toBe(
      false,
    );
    expect(
      redactionTestApi.textFindings("reference/manifest/neutral.json", new Set(), oracle),
    ).toEqual([]);
  });

  test("rejects root leaf paths and common credential forms", () => {
    const driveLeaf = ["Z:", "leaf.txt"].join("\\");
    const posixLeaf = ["", "private", "leaf.txt"].join("/");
    const token = ["Ab3d", "Ef6h", "Ij9l", "Mn2p", "Qr5t", "Uv8x"].join("");
    const api = `${["api", "key"].join("_")} = "${token}"`;
    const dottedApi = `${["API", "KEY"].join(".")}: "${token}"`;
    const client = `${["client", "secret"].join("-")}='${token}'`;
    const dottedClient = `${["Client", "Secret"].join(".")} = '${token}'`;
    const credential = `${["creden", "tial"].join("")}=${token}`;
    const bearer = ["bEaReR", token].join(" ");
    for (const value of [
      driveLeaf,
      posixLeaf,
      api,
      dottedApi,
      client,
      dottedClient,
      credential,
      bearer,
    ]) {
      expect(redactionTestApi.textFindings(value, new Set())).toEqual(
        expect.arrayContaining([
          value === driveLeaf || value === posixLeaf
            ? "absolute-local-path"
            : "credential-or-secret",
        ]),
      );
    }
  });

  test("rejects shifted 200-byte and boundary-overlapping 160-byte source slices", () => {
    const alphabet = [
      "abcdefghijklmnopqrstuvwxyz",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "0123456789",
    ].join("");
    const source = Array.from(
      { length: 640 },
      (_, index) => alphabet[(index * 17 + Math.floor(index / 13)) % alphabet.length],
    ).join("");
    expect(
      redactionTestApi.copiedSourceBytes([source], [`prefix-${source.slice(37, 237)}-suffix`]),
    ).toBe(true);
    expect(
      redactionTestApi.copiedSourceBytes([source], [`offset-${source.slice(79, 239)}-boundary`]),
    ).toBe(true);
    expect(
      redactionTestApi.copiedSourceBytes([source], [`offset-${source.slice(113, 273)}-boundary`]),
    ).toBe(true);
    expect(
      redactionTestApi.copiedSourceBytes([source], [`offset-${source.slice(113, 272)}-boundary`]),
    ).toBe(false);
    expect(redactionTestApi.copiedSourceBytes([source], ["independent neutral evidence"])).toBe(
      false,
    );
  });

  test("all manifest schema families are excluded from package and built surfaces", () => {
    const schemas = [
      "reference-source-census/v9",
      "reference-artifact-inventory/v9",
      "reference-behavior-families/v9",
      "reference-entrypoint-census/v9",
      "reference-mutation-census/v9",
      "reference-authority-inventory/v9",
      "reference-recovery-transitions/v9",
      "reference-assumption-inventory/v9",
      "reference-forbidden-vocabulary/v9",
    ];
    for (const schema of schemas) {
      expect(() =>
        redactionTestApi.validatePackedFile("src/index.js", Buffer.from(schema), new Set()),
      ).toThrow(/inventory material/);
      expect(() => redactionTestApi.validateBuiltText(schema, new Set())).toThrow(
        /inventory material/,
      );
    }
  });

  test("renamed behavior, authority, transition, assumption, and oracle schemas remain excluded", () => {
    const renamed = [
      '{"schemaVersion":"renamed/v9","familyRoot":"x"}',
      '{"schemaVersion":"renamed/v9","authorityRoot":"x"}',
      '{"schemaVersion":"renamed/v9","transitionRoot":"x"}',
      '{"schemaVersion":"renamed/v9","assumptionRoot":"x"}',
      '{"schemaVersion":"renamed/v9","vocabularyRoot":"x"}',
    ];
    for (const content of renamed) {
      expect(() =>
        redactionTestApi.validatePackedFile("src/index.js", Buffer.from(content), new Set()),
      ).toThrow(/inventory material/);
      expect(() => redactionTestApi.validateBuiltText(content, new Set())).toThrow(
        /inventory material/,
      );
    }
  });

  test("canonical rows and six-token fragments exclude every manifest family after metadata renames", () => {
    const publication = redactionTestApi.buildPublicationOracle(baseline);
    const stable = (value: any): any =>
      Array.isArray(value)
        ? value.map(stable)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, stable(value[key])]),
            )
          : value;
    const rows = [
      baseline.source.source,
      baseline.artifacts.artifacts[0],
      baseline.behaviors.families[0],
      baseline.entrypoints.entrypoints[0],
      baseline.mutations.mutationGroups[0],
      baseline.authorities.authorities[0],
      baseline.transitions.transitions[0],
      baseline.assumptions.assumptions[0],
      baseline["redaction-oracle"].entries[0],
    ];
    for (const row of rows) {
      const canonical = JSON.stringify(stable(row));
      const renamedWrapper = JSON.stringify({ renamedSchema: "neutral/v9", payload: row });
      const rootStrippedFragment = canonical.slice(1, -1);
      for (const content of [renamedWrapper, rootStrippedFragment]) {
        expect(() =>
          redactionTestApi.validatePackedFile(
            "src/index.js",
            Buffer.from(content),
            new Set(),
            undefined,
            publication,
          ),
        ).toThrow(/inventory material/);
        expect(() =>
          redactionTestApi.validateBuiltText(content, new Set(), undefined, [], publication),
        ).toThrow(/inventory material/);
      }
    }
    const neutral = JSON.stringify({ id: "independent-row", kind: "neutral", value: "safe" });
    expect(() =>
      redactionTestApi.validatePackedFile(
        "src/index.js",
        Buffer.from(neutral),
        new Set(),
        undefined,
        publication,
      ),
    ).not.toThrow();
    expect(() =>
      redactionTestApi.validateBuiltText(neutral, new Set(), undefined, [], publication),
    ).not.toThrow();
  });

  test("live comparison flags are exact, complete, and duplicate-free", () => {
    expect(parseLiveArguments([])).toBeUndefined();
    expect(
      parseLiveArguments([
        "--",
        "--source-repository",
        "fixture",
        "--source-commit",
        "0".repeat(40),
        "--source-subtree",
        "controller",
      ]),
    ).toEqual({ repository: "fixture", commit: "0".repeat(40), subtree: "controller" });
    expect(() => parseLiveArguments(["--source-repository", "fixture"])).toThrow(
      /requires all source flags/,
    );
    expect(() =>
      parseLiveArguments([
        "--source-repository",
        "fixture-a",
        "--source-repository",
        "fixture-b",
        "--source-commit",
        "0".repeat(40),
      ]),
    ).toThrow(/duplicate live comparison flag/);
  });
});
