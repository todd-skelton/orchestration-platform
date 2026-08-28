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
      sensitiveTokenCount: 55,
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
      "missing arbitrary-text collision exclusion",
      (snapshot: any) => {
        snapshot[
          "redaction-oracle"
        ].sourcePathCensus.sensitivity.arbitraryTextTokenCollisionDigests.pop();
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
    for (const value of [token, token.toUpperCase(), `ordinary ${token} text`]) {
      expect(redactionTestApi.textFindings(value, new Set(), oracle)).toContain(
        "source-path-token",
      );
    }
    for (const value of [
      shortComponent,
      shortComponent.toUpperCase(),
      `ordinary ${shortComponent} text`,
    ]) {
      expect(redactionTestApi.textFindings(value, new Set(), oracle)).toContain(
        "source-path-component",
      );
    }
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
      sensitiveTokens: 55,
      tokenCollisions: 84,
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

  test("rejects root, portable home paths, and common credential forms", () => {
    const driveLeaf = ["Z:", "leaf.txt"].join("\\");
    const posixLeaf = ["", "private", "leaf.txt"].join("/");
    const tildeHome = ["~", "private", "file"].join("/");
    const shellHome = [["$", "HOME"].join(""), "private", "file"].join("/");
    const profileHome = [["%", "USERPROFILE", "%"].join(""), "private", "file"].join("\\");
    const token = ["Ab3d", "Ef6h", "Ij9l", "Mn2p", "Qr5t", "Uv8x"].join("");
    const api = `${["api", "key"].join("_")} = "${token}"`;
    const dottedApi = `${["API", "KEY"].join(".")}: "${token}"`;
    const spacedApi = `${["API", "KEY"].join(" ")}: "${token}"`;
    const client = `${["client", "secret"].join("-")}='${token}'`;
    const dottedClient = `${["Client", "Secret"].join(".")} = '${token}'`;
    const credential = `${["creden", "tial"].join("")}=${token}`;
    const dottedCredential = `${["creden", "tial"].join("")}.${token}`;
    const access = `${["access", "token"].join(" ")}=${token}`;
    const bearer = ["bEaReR", token].join(" ");
    for (const value of [
      driveLeaf,
      posixLeaf,
      tildeHome,
      shellHome,
      profileHome,
      api,
      dottedApi,
      spacedApi,
      client,
      dottedClient,
      credential,
      dottedCredential,
      access,
      bearer,
    ]) {
      expect(redactionTestApi.textFindings(value, new Set())).toEqual(
        expect.arrayContaining([
          [driveLeaf, posixLeaf, tildeHome, shellHome, profileHome].includes(value)
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

  test("key-independent value relationships exclude all renamed, reordered, wrapped, and substantive one-field-deleted rows", () => {
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
    const pathCensus = baseline["redaction-oracle"].sourcePathCensus;
    const families = new Map([
      [
        "source",
        [
          baseline.source.source,
          baseline.source.extensionCensus,
          baseline.source.effectCandidateCensus,
        ],
      ],
      ["artifacts", baseline.artifacts.artifacts],
      ["behaviors", baseline.behaviors.families],
      ["entrypoints", baseline.entrypoints.entrypoints],
      ["mutations", [...baseline.mutations.mutationGroups, ...baseline.mutations.callsites]],
      ["authorities", [...baseline.authorities.authorities, ...baseline.authorities.observations]],
      ["transitions", baseline.transitions.transitions],
      ["assumptions", baseline.assumptions.assumptions],
      [
        "redaction-oracle",
        [
          ...baseline["redaction-oracle"].entries,
          ...pathCensus.entries,
          pathCensus.sensitivity,
          baseline["redaction-oracle"].copyPolicy,
        ],
      ],
    ]);
    const excluded = (content: string) => {
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
    };
    const encodedJsLiteral = (value: any): string => {
      if (typeof value === "string") {
        return `"${[...value]
          .map((character) => `\\u{${character.codePointAt(0)!.toString(16)}}`)
          .join("")}"`;
      }
      if (Array.isArray(value)) return `[${value.map(encodedJsLiteral).join(",")}]`;
      if (value && typeof value === "object") {
        return `{${Object.entries(value)
          .map(([key, child]) => `${encodedJsLiteral(key)}:${encodedJsLiteral(child)}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    const propertyKeyLiteral = (value: any): string =>
      typeof value === "string" || (value && typeof value === "object")
        ? JSON.stringify(typeof value === "string" ? value : JSON.stringify(value))
        : String(value);
    let transformedRowCount = 0;
    let arbitraryStreamTransformCount = 0;
    let substantiveDeletionCount = 0;
    let belowMinimumDeletionCount = 0;
    for (const rows of families.values()) {
      for (const row of rows as any[]) {
        transformedRowCount += 1;
        const renamed = Object.fromEntries(
          Object.values(row)
            .reverse()
            .map((value, index) => [`renamed-${String(index).padStart(2, "0")}`, value]),
        );
        excluded(JSON.stringify({ neutralWrapper: [renamed] }));
        const reversedValues = Object.values(row).reverse();
        for (const content of [
          `export default ${JSON.stringify(renamed)};`,
          JSON.stringify(reversedValues),
          reversedValues.map((value) => JSON.stringify(value)).join(","),
          reversedValues.map((value) => JSON.stringify(value)).join(",0,"),
          `({${reversedValues.map((value) => `${propertyKeyLiteral(value)}:0`).join(",")}})`,
          reversedValues.map(encodedJsLiteral).join(",0,"),
        ]) {
          arbitraryStreamTransformCount += 1;
          excluded(content);
        }
        for (const deletedKey of Object.keys(row)) {
          const deleted = Object.fromEntries(
            Object.entries(row)
              .filter(([key]) => key !== deletedKey)
              .reverse()
              .map(([, value], index) => [`renamed-${String(index).padStart(2, "0")}`, value]),
          );
          const fingerprints = inventoryTestApi.publicationValueFingerprints(deleted);
          if (
            fingerprints.relationshipDigests.length > 0 ||
            fingerprints.strongScalarDigests.length > 0
          ) {
            substantiveDeletionCount += 1;
            excluded(JSON.stringify({ neutralWrapper: deleted }));
          } else {
            belowMinimumDeletionCount += 1;
          }
        }
      }
    }
    expect(transformedRowCount).toBe(1240);
    expect(arbitraryStreamTransformCount).toBe(7440);
    expect(substantiveDeletionCount).toBe(9012);
    expect(belowMinimumDeletionCount).toBe(1);

    const representativeRows = [...families.values()].map((rows) => (rows as any[])[0]);
    for (const [index, row] of representativeRows.entries()) {
      const canonical = JSON.stringify(stable(row));
      const rootStrippedFragment = canonical.slice(1, -1);
      excluded(rootStrippedFragment);
      const next = representativeRows[(index + 1) % representativeRows.length];
      const renamed = (value: any) =>
        Object.fromEntries(
          Object.values(value).map((child, childIndex) => [`field-${childIndex}`, child]),
        );
      excluded(`${JSON.stringify(renamed(row))}${JSON.stringify(renamed(next))}`);
      excluded(
        Object.values(row)
          .slice(1)
          .reverse()
          .map((value) => JSON.stringify(value))
          .join(","),
      );
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
  }, 120_000);

  test("enumerates bounded template alternatives and fails closed at every scalar bound", () => {
    const publication = redactionTestApi.buildPublicationOracle(baseline);
    const protectedValue = baseline.artifacts.artifacts[0].contentDigest as string;
    const pieces = protectedValue.match(/.{1,5}/g)!;
    const rejected = (content: string) => {
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
    };
    const accepted = (content: string) => {
      expect(() =>
        redactionTestApi.validatePackedFile(
          "src/index.js",
          Buffer.from(content),
          new Set(),
          undefined,
          publication,
        ),
      ).not.toThrow();
      expect(() =>
        redactionTestApi.validateBuiltText(content, new Set(), undefined, [], publication),
      ).not.toThrow();
    };

    for (const [quote, newline] of [
      ['"', "\n"],
      ['"', "\r\n"],
      ["'", "\n"],
      ["'", "\r\n"],
    ]) {
      rejected(`${quote}${pieces.join(`\\${newline}`)}${quote}`);
    }

    const template = (interpolation: string) => ["`", pieces.join(interpolation), "`"].join("");
    rejected(template("${''}"));
    rejected(template('${""}'));
    rejected(template("${unknown}"));
    const escapedPieces = [...protectedValue].map(
      (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
    );
    rejected(["`", escapedPieces.join("${''}"), "`"].join(""));

    const [prefix, middle, suffix] = [
      protectedValue.slice(0, 20),
      protectedValue.slice(20, 44),
      protectedValue.slice(44),
    ];
    const branch = (expression: string) => `\`${prefix}\${${expression}}${suffix}\``;
    rejected(branch(`flag ? ${JSON.stringify(middle)} : "neutral"`));
    rejected(branch(`flag ? "neutral" : ${JSON.stringify(middle)}`));
    rejected(branch(`flag && ${JSON.stringify(middle)}`));
    rejected(branch(`candidate ?? ${JSON.stringify(middle)}`));
    rejected(branch(`["neutral", ${JSON.stringify(middle)}][choice]`));
    rejected(branch(`"" || "neutral" || ${JSON.stringify(middle)}`));
    rejected(branch(`"" || ${JSON.stringify(middle)} || ${JSON.stringify(middle)}`));

    const middleA = middle.slice(0, 12);
    const middleB = middle.slice(12);
    rejected(branch(`${JSON.stringify(middleA)} + ${JSON.stringify(middleB)}`));
    rejected(branch(`(${JSON.stringify(middleA)} + ${JSON.stringify(middleB)})`));
    const middleParts = [middle.slice(0, 8), middle.slice(8, 16), middle.slice(16)];
    rejected(branch(middleParts.map((part) => JSON.stringify(part)).join(" + ")));
    rejected(branch(`"" + ${JSON.stringify(middleA)} + "" + ${JSON.stringify(middleB)} + ""`));
    rejected(
      branch(`${JSON.stringify(middleA)} + (flag ? "noise" : "") + ${JSON.stringify(middleB)}`),
    );
    rejected(
      branch(
        `${JSON.stringify(middleA)} + (left ? "noise-left" : "") + (right ? "noise-right" : "") + ${JSON.stringify(middleB)}`,
      ),
    );
    rejected(
      branch(
        `${JSON.stringify(middleA)} + (outer ? (inner ? "noise-a" : "noise-b") : "") + ${JSON.stringify(middleB)}`,
      ),
    );
    rejected(
      branch(`flag ? (${JSON.stringify(middleA)} + ${JSON.stringify(middleB)}) : "neutral"`),
    );
    rejected(
      branch(`flag ? "neutral" : (${JSON.stringify(middleA)} + ${JSON.stringify(middleB)})`),
    );
    rejected(
      branch(`["neutral", ${JSON.stringify(middleA)} + ${JSON.stringify(middleB)}][choice]`),
    );

    const segments = [
      protectedValue.slice(0, 12),
      protectedValue.slice(12, 24),
      protectedValue.slice(24, 36),
      protectedValue.slice(36, 48),
      protectedValue.slice(48),
    ];
    rejected(
      `\`${segments[0]}\${left ? ${JSON.stringify(segments[1])} : "left-neutral"}${segments[2]}\${right ? "right-neutral" : ${JSON.stringify(segments[3])}}${segments[4]}\``,
    );
    const concatenatedSegments = [
      protectedValue.slice(0, 10),
      protectedValue.slice(10, 18),
      protectedValue.slice(18, 26),
      protectedValue.slice(26, 36),
      protectedValue.slice(36, 44),
      protectedValue.slice(44, 52),
      protectedValue.slice(52),
    ];
    rejected(
      `\`${concatenatedSegments[0]}\${${JSON.stringify(concatenatedSegments[1])} + ${JSON.stringify(concatenatedSegments[2])}}${concatenatedSegments[3]}\${${JSON.stringify(concatenatedSegments[4])} + ${JSON.stringify(concatenatedSegments[5])}}${concatenatedSegments[6]}\``,
    );

    const encodedMiddle = [...middle]
      .map((character) => `\\u{${character.codePointAt(0)!.toString(16)}}`)
      .join("");
    rejected(branch(`flag ? '${encodedMiddle}' : "neutral"`));
    rejected(branch(`flag ? '${middle.match(/.{1,5}/g)!.join("\\\n")}' : "neutral"`));
    rejected(branch(`flag ? '${middle.match(/.{1,5}/g)!.join("\\\r\n")}' : "neutral"`));
    const encodedMiddleB = [...middleB]
      .map((character) => `\\u{${character.codePointAt(0)!.toString(16)}}`)
      .join("");
    rejected(branch(`"${middleA.match(/.{1,4}/g)!.join("\\\n")}" + '${encodedMiddleB}'`));

    rejected(["`", prefix, "` + (`", middleA, "` + `", middleB, "`) + `", suffix, "`"].join(""));
    rejected(branch(`\`${middleA}\` + \`${middleB}\``));
    const commentPieces = Array.from({ length: 8 }, (_, index) =>
      protectedValue.slice(
        Math.floor((protectedValue.length * index) / 8),
        Math.floor((protectedValue.length * (index + 1)) / 8),
      ),
    );
    rejected(commentPieces.map((piece) => JSON.stringify(piece)).join(" + /* neutral */ "));
    rejected(commentPieces.map((piece) => JSON.stringify(piece)).join(" + // neutral\n"));
    const quotedCommentPieces = commentPieces.map((piece) => JSON.stringify(piece));
    rejected(`${quotedCommentPieces[0]}.concat(${quotedCommentPieces.slice(1).join(",")})`);
    rejected(`${quotedCommentPieces[0]}.con\\u0063at(${quotedCommentPieces.slice(1).join(",")})`);
    for (let index = 0; index < "concat".length; index += 1) {
      const codePoint = "concat".codePointAt(index)!.toString(16);
      for (const escaped of [`\\u${codePoint.padStart(4, "0")}`, `\\u{${codePoint}}`]) {
        const method = `${"concat".slice(0, index)}${escaped}${"concat".slice(index + 1)}`;
        rejected(`${quotedCommentPieces[0]}.${method}(${quotedCommentPieces.slice(1).join(",")})`);
      }
    }
    for (const malformedMethod of [
      "\\u{110000}oncat",
      "\\ud800oncat",
      "\\u{d800}oncat",
      "\\udfffoncat",
      "\\u00g0oncat",
      "\\u{63oncat",
    ]) {
      rejected(
        `${quotedCommentPieces[0]}.${malformedMethod}(${quotedCommentPieces.slice(1).join(",")})`,
      );
    }
    rejected(
      `${quotedCommentPieces[0]}.concat(${quotedCommentPieces.slice(1, 4).join(",")}).concat(${quotedCommentPieces.slice(4).join(",")})`,
    );
    rejected(
      `${quotedCommentPieces[0]} . /* receiver */ con\\u{63}at /* call */ ( (${quotedCommentPieces[1]}), /* argument */ ${quotedCommentPieces.slice(2).join(",")} )`,
    );
    rejected(
      `\`${commentPieces[0]}\`.concat(${commentPieces
        .slice(1)
        .map((piece) => `\`${piece}\``)
        .join(",")})`,
    );
    const mixedConcatPieces = [...quotedCommentPieces];
    mixedConcatPieces[1] = `"${commentPieces[1]!.match(/.{1,3}/g)!.join("\\\n")}"`;
    mixedConcatPieces[2] = `'${[...commentPieces[2]!]
      .map((character) => `\\u{${character.codePointAt(0)!.toString(16)}}`)
      .join("")}'`;
    rejected(`${mixedConcatPieces[0]}.concat(${mixedConcatPieces.slice(1).join(",")})`);
    rejected(
      `${JSON.stringify(prefix)}.concat(dynamic,${JSON.stringify(middle)},${JSON.stringify(suffix)})`,
    );
    rejected(
      `${JSON.stringify(prefix)}.concat(${JSON.stringify(middle)},${JSON.stringify(suffix)}`,
    );
    accepted('"safe".concatenate("neutral")');
    accepted('"safe".con\\u0063atenate("neutral")');
    accepted('"safe".\\u0063oncatValue("neutral")');
    accepted('"safe".concatValue("neutral")');
    accepted(`"safe".concat(${Array.from({ length: 15 }, (_, index) => `"n${index}"`).join(",")})`);
    rejected(`"safe".concat(${Array.from({ length: 16 }, (_, index) => `"n${index}"`).join(",")})`);
    accepted('"/* neutral */" + "// neutral"');
    rejected(
      [
        JSON.stringify(prefix),
        " + /* unterminated ",
        JSON.stringify(middle),
        " + ",
        JSON.stringify(suffix),
      ].join(""),
    );
    rejected(
      [
        JSON.stringify(prefix),
        " + // unterminated ",
        JSON.stringify(middle),
        " + ",
        JSON.stringify(suffix),
      ].join(""),
    );
    rejected(`"safe" + /*${"x".repeat(4097)}*/ "neutral"`);

    const alternatives = (prefixValue: string, count: number) =>
      Array.from({ length: count }, (_, index) => JSON.stringify(`${prefixValue}${index}`)).join(
        ",",
      );
    accepted(
      `\`safe\${[${alternatives("left-neutral-", 4)}][left]}center\${[${alternatives("right-neutral-", 4)}][right]}tail\``,
    );
    rejected(`\`safe\${[${alternatives("overflow-neutral-", 5)}][choice]}tail\``);
    accepted(`\`${"${'x'}".repeat(16)}\``);
    rejected(`\`${"${'x'}".repeat(17)}\``);

    const encodedBoundary = ["`", "safe", "\\\n".repeat(16_381), "`"].join("");
    expect(encodedBoundary.length).toBe(32_768);
    accepted(encodedBoundary);
    rejected(["`", "safe", "\\\n".repeat(16_382), "`"].join(""));

    accepted(`"${"a".repeat(4096)}"`);
    rejected(`"${"a".repeat(4097)}"`);
    rejected(["`", "neutral${'value'", "`"].join(""));
    for (const malformed of ['"unterminated', "`unterminated${", '"\\u{110000}"']) {
      accepted(malformed);
    }
    accepted("`safe${(() => { throw new Error('neutral'); })()}tail`");
    accepted("`neutral${unknown}text`");
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
