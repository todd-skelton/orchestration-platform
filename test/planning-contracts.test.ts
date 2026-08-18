import { beforeAll, describe, expect, test } from "vitest";
import {
  loadPlanningSnapshot,
  validatePlanningSnapshot,
  type PlanningSnapshot,
} from "../scripts/planning/check.mjs";

let baseline: PlanningSnapshot;

function mutant(): PlanningSnapshot {
  return structuredClone(baseline);
}

function issue(snapshot: PlanningSnapshot, key: string): Record<string, any> {
  return snapshot.roadmap.issues.find((row: Record<string, any>) => row.key === key);
}

beforeAll(async () => {
  baseline = await loadPlanningSnapshot();
});

describe("planning contract", () => {
  test("accepts the authoritative roadmap and generated DAG mirrors", () => {
    expect(() => validatePlanningSnapshot(baseline)).not.toThrow();
  });

  test.each([
    ["missing draft", (snapshot: PlanningSnapshot) => delete snapshot.issueDrafts["ISS-000"]],
    [
      "frontmatter key",
      (snapshot: PlanningSnapshot) => {
        snapshot.issueDrafts["ISS-000"] = snapshot.issueDrafts["ISS-000"]!.replace(
          "key: ISS-000",
          "key: ISS-999",
        );
      },
    ],
    [
      "parent",
      (snapshot: PlanningSnapshot) => {
        issue(snapshot, "ISS-000").parent = "EPIC-KERNEL";
      },
    ],
    [
      "milestone",
      (snapshot: PlanningSnapshot) => {
        issue(snapshot, "ISS-000").milestone = "MISSING";
      },
    ],
    [
      "direct blocked-by edge",
      (snapshot: PlanningSnapshot) => {
        issue(snapshot, "ISS-001").blockedBy = [];
      },
    ],
    [
      "cycle",
      (snapshot: PlanningSnapshot) => {
        issue(snapshot, "ISS-000").blockedBy = ["ISS-001"];
        snapshot.issueDrafts["ISS-000"] = snapshot.issueDrafts["ISS-000"]!.replace(
          "blocked_by: []",
          "blocked_by: [ISS-001]",
        );
      },
    ],
    [
      "epic membership",
      (snapshot: PlanningSnapshot) => {
        snapshot.epicDrafts["EPIC-RUNTIME"] = snapshot.epicDrafts["EPIC-RUNTIME"]!.replace(
          /\s+ISS-000,\r?\n/,
          "\n",
        );
      },
    ],
    [
      "generated DAG",
      (snapshot: PlanningSnapshot) => {
        snapshot.epicDrafts["EPIC-RUNTIME"] = snapshot.epicDrafts["EPIC-RUNTIME"]!.replace(
          "`ISS-000 → ISS-001`",
          "`ISS-002 → ISS-001`",
        );
      },
    ],
    [
      "missing verification wrapper",
      (snapshot: PlanningSnapshot) => {
        delete snapshot.rootPackage.scripts["inventory:check"];
      },
    ],
    [
      "wrong placeholder owner",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["inventory:check"] =
          "node scripts/capability-not-implemented.mjs ISS-999 inventory:check";
      },
    ],
    [
      "wrapper defaults",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts.bootstrap += " --state-root .state";
      },
    ],
    [
      "extra root wrapper",
      (snapshot: PlanningSnapshot) => {
        snapshot.rootPackage.scripts["unowned:command"] = "node nowhere.mjs";
      },
    ],
    [
      "extra capability slot",
      (snapshot: PlanningSnapshot) => {
        snapshot.capabilitySlots.push({
          issue: "ISS-001",
          name: "extra.mjs",
          isDirectory: true,
          directorySymlink: false,
          isFile: true,
          isSymbolicLink: false,
        });
      },
    ],
    [
      "migration source coverage gap",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.ownershipGroups[0].sourceIssueNumbers.pop();
      },
    ],
    [
      "migration duplicate ownership",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.ownershipGroups[1].sourceIssueNumbers.push(
          snapshot.migration.ownershipGroups[0].sourceIssueNumbers[0],
        );
      },
    ],
    [
      "migration unknown destination",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.ownershipGroups[0].destinationKeys = ["ISS-999"];
      },
    ],
    [
      "migration exclusion with a non-issue identity",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.explicitExclusions.issueNumbers = ["not-an-issue"];
      },
    ],
    [
      "migration exclusion outside the safe integer domain",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.explicitExclusions.issueNumbers = [Number.MAX_SAFE_INTEGER + 1];
      },
    ],
    [
      "captured migration owned only by an epic",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.ownershipGroups.find(
          (group: Record<string, any>) => group.disposition === "CAPTURED",
        ).destinationKeys = ["EPIC-KERNEL"];
      },
    ],
    [
      "parked migration owned only by an epic",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.ownershipGroups.find(
          (group: Record<string, any>) => group.disposition === "PARKED",
        ).destinationKeys = ["EPIC-KERNEL"];
      },
    ],
    [
      "parked migration without unpark condition",
      (snapshot: PlanningSnapshot) => {
        delete snapshot.migration.ownershipGroups.find(
          (group: Record<string, any>) => group.disposition === "PARKED",
        ).unparkCondition;
      },
    ],
    [
      "post-census addendum total",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.totalProvenanceRecordCount = 183;
      },
    ],
    [
      "post-census source absence target total",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.sourceAbsenceTargetRecordCount = 185;
      },
    ],
    [
      "post-census addendum duplicate identity",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[1].sourceIssueNumber = 6999;
      },
    ],
    [
      "post-census addendum overlap with the historical base",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].sourceIssueNumber =
          snapshot.migration.sourceIssueNumbers[0];
      },
    ],
    [
      "post-census addendum noncanonical destination",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].destinationKey = "ISS-040";
      },
    ],
    [
      "post-census addendum destination absent from the canonical table",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.canonicalDestinations["simplification-and-evidence-proportionality"] = [
          "ISS-040",
        ];
      },
    ],
    [
      "post-census addendum source state",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].sourceState = "CLOSED";
      },
    ],
    [
      "post-census addendum disposition",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].disposition = "MIGRATED_PLATFORM";
      },
    ],
    [
      "post-census consumer-policy decision issue",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].authorityDecisionIssueNumber = 7008;
      },
    ],
    [
      "post-census consumer-policy decision comment",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].authorityDecisionCommentId = 1;
      },
    ],
    [
      "post-census unrelated exclusion widening",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[1].disposition = "EXCLUDED_CONSUMER_POLICY";
      },
    ],
    [
      "post-census addendum source state reason",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[1].sourceStateReason = "REOPENED";
      },
    ],
    [
      "post-census addendum provenance",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].provenanceStatement = "";
      },
    ],
    [
      "post-census addendum board role",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[1].sourceBoardRole = "SUPERSEDED_REMOVED";
      },
    ],
    [
      "post-census addendum board presence",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].sourceBoardPresence = "ABSENT";
      },
    ],
    [
      "post-census required source state",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].requiredSourceState = "OPEN";
      },
    ],
    [
      "post-census required source state reason",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[1].requiredSourceStateReason = null;
      },
    ],
    [
      "post-census required board presence",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].requiredSourceBoardPresence = "PRESENT";
      },
    ],
    [
      "post-census required board role",
      (snapshot: PlanningSnapshot) => {
        snapshot.migration.postCensusAddendum.records[0].requiredSourceBoardRole =
          "PENDING_CLEANUP";
      },
    ],
    [
      "duplicate verification capability owner",
      (snapshot: PlanningSnapshot) => {
        snapshot.issueDrafts["ISS-040"] = snapshot.issueDrafts["ISS-040"]!.replace(
          "test:planning-module-proportionality",
          "test:module-simplification-findings",
        );
      },
    ],
  ])("rejects the %s mutant", (_name, mutate) => {
    const snapshot = mutant();
    mutate(snapshot);
    expect(() => validatePlanningSnapshot(snapshot)).toThrow(/PLANNING_CONTRACT_MISMATCH/);
  });
});

describe("ISS-002 public schema disposition ledger", () => {
  test("accepts the exact one-status public census and 11/11/10 registry", () => {
    expect(() => validatePlanningSnapshot(baseline)).not.toThrow();
    expect(baseline.schemaDisposition.alreadyExactGeneral).toHaveLength(25);
    expect(baseline.schemaDisposition.alreadyExactAuthority).toHaveLength(8);
    expect(baseline.schemaDisposition.inheritedExact).toHaveLength(24);
    expect(Object.keys(baseline.schemaDisposition.newlyPinned)).toHaveLength(45);
    expect(baseline.schemaDisposition.pointerRegistry).toHaveLength(11);
    expect(
      baseline.schemaDisposition.pointerRegistry.filter((row: unknown[]) => row[10] !== null),
    ).toHaveLength(10);
    expect(baseline.schemaDisposition.pointerRegistryContract).toMatchObject({
      ordinaryPositionCount: 11,
      packetSlotCount: 11,
      packetTargetSlotCount: 1,
      packetRemainingSlotCount: 10,
      retention: "FULL_REQUIRED",
      tombstoneFamilyCount: 10,
      tombstonePositionCount: 10,
    });
  });

  test.each([
    [
      "status removal",
      (snapshot: PlanningSnapshot) => snapshot.schemaDisposition.alreadyExactGeneral.pop(),
    ],
    [
      "status duplication",
      (snapshot: PlanningSnapshot) =>
        snapshot.schemaDisposition.alreadyExactAuthority.push(
          snapshot.schemaDisposition.alreadyExactGeneral[0][0],
        ),
    ],
    [
      "status rename",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-current-tip-renamed/v1"] =
          snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"];
        delete snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"];
      },
    ],
    [
      "exact-base commit",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.exactBase.commit = "0".repeat(40);
      },
    ],
    [
      "exact-base blob",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.exactBase.sources.approved.blob = "0".repeat(40);
      },
    ],
    [
      "exact-base path",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.exactBase.sources.approved.path = "somewhere.ts";
      },
    ],
    [
      "exact-base public schema total",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.exactBase.publicSchemaCount = 154;
      },
    ],
    [
      "exact-base public schema census digest",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.exactBase.publicSchemaCensusDigest = "0".repeat(64);
      },
    ],
    [
      "inherited definition identity",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.inheritedExact[0][2] = "0".repeat(64);
      },
    ],
    [
      "inherited golden identity",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.inheritedExact[0][3] = "0".repeat(64);
      },
    ],
    [
      "field removal",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"] =
          "pathInstanceDigest:sha256|pointerKind:pointer-kind|proposalReceiptDigest:sha256|schemaVersion:literal(pointer-current-tip/v1)";
      },
    ],
    [
      "field addition",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"] += "|zExtra:sha256";
      },
    ],
    [
      "field rename",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"] =
          snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"].replace(
            "valueDigest",
            "selectedValueDigest",
          );
      },
    ],
    [
      "field nullability",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"] =
          snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"].replace(
            "valueDigest:sha256",
            "valueDigest:nullable(sha256)",
          );
      },
    ],
    [
      "field scalar type",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"] =
          snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"].replace(
            "valueDigest:sha256",
            "valueDigest:token",
          );
      },
    ],
    [
      "field canonical order",
      (snapshot: PlanningSnapshot) => {
        const fields = snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"].split("|");
        [fields[0], fields[1]] = [fields[1], fields[0]];
        snapshot.schemaDisposition.newlyPinned["pointer-current-tip/v1"] = fields.join("|");
      },
    ],
    [
      "closed enum",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-conflict-receipt/v1"] =
          snapshot.schemaDisposition.newlyPinned["pointer-conflict-receipt/v1"].replace(
            "VALUE_CONFLICT)",
            "VALUE_CONFLICT,OTHER)",
          );
      },
    ],
    [
      "nested unknown field",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.nestedDefinitions["selected-evidence"] += "|zExtra:sha256";
      },
    ],
    [
      "missing persistence disposition",
      (snapshot: PlanningSnapshot) => {
        delete snapshot.schemaDisposition.operationalBindings.persistence["dispatch-brief/v1"];
      },
    ],
    [
      "persisted path alias",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.operationalBindings.persistence[
          "activation-cleanup-gate-root/v1"
        ] = "somewhere.json";
      },
    ],
    [
      "digest domain or part order",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.operationalBindings.digestProfiles.TIP =
          "pointer-tip/v1|value-digest,path-instance-digest";
      },
    ],
    [
      "selecting-field exclusion",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.operationalBindings.exclusions[
          "pointer-mutation-run-checkpoint-core/v1"
        ].pop();
      },
    ],
    [
      "registry missing row",
      (snapshot: PlanningSnapshot) => snapshot.schemaDisposition.pointerRegistry.pop(),
    ],
    [
      "registry extra row",
      (snapshot: PlanningSnapshot) =>
        snapshot.schemaDisposition.pointerRegistry.push(
          structuredClone(snapshot.schemaDisposition.pointerRegistry[0]),
        ),
    ],
    [
      "registry value schema",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistry[0][2] = "active-release/v2";
      },
    ],
    [
      "registry root",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistry[0][7] = [];
      },
    ],
    [
      "registry archive",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistry[0][8] = [];
      },
    ],
    [
      "registry source",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistry[3][6] = ["none"];
      },
    ],
    [
      "registry genesis",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistry[0][3] = "ABSENT";
      },
    ],
    [
      "registry transaction policy",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistry[0][4] = "NULL";
      },
    ],
    [
      "registry ordinary position count",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistryContract.ordinaryPositionCount = 10;
      },
    ],
    [
      "registry tombstone position count",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistry[0][10] = null;
      },
    ],
    [
      "registry preservation policy",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistryContract.retention =
          "TERMINAL_CHECKPOINT_ALLOWED";
      },
    ],
    [
      "packet total slot count",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistryContract.packetSlotCount = 10;
      },
    ],
    [
      "packet remaining slot count",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.pointerRegistryContract.packetRemainingSlotCount = 11;
      },
    ],
    [
      "UNKNOWN arbitrary JSON",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-mutation-unknown-evidence/v1"] +=
          "|zObservation:json";
      },
    ],
    [
      "UNKNOWN native message",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-mutation-unknown-evidence/v1"] +=
          "|zMessage:bounded-string";
      },
    ],
    [
      "UNKNOWN host path",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-mutation-unknown-evidence/v1"] +=
          "|zPath:relative-path";
      },
    ],
    [
      "UNKNOWN variable array",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-mutation-unknown-evidence/v1"] +=
          "|zItems:array(token)";
      },
    ],
    [
      "UNKNOWN unsafe length",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["pointer-mutation-unknown-evidence/v1"] =
          snapshot.schemaDisposition.newlyPinned["pointer-mutation-unknown-evidence/v1"].replace(
            "observedByteLength:safe-decimal",
            "observedByteLength:decimal",
          );
      },
    ],
    [
      "UNKNOWN category/reason mismatch",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.unknownEvidenceReasons.UNREADABLE[0] = "EPOCH_MISMATCH";
      },
    ],
    [
      "deleted API restored",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.deletedPublicSymbols.pop();
      },
    ],
    [
      "deleted schema restored",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.deletedSchemaVersions.pop();
      },
    ],
    [
      "dispatch brief free prose",
      (snapshot: PlanningSnapshot) => {
        snapshot.schemaDisposition.newlyPinned["dispatch-brief/v1"] += "|zPrompt:bounded-string";
      },
    ],
  ])("rejects the schema ledger %s mutant", (_name, mutate) => {
    const snapshot = mutant();
    mutate(snapshot);
    expect(() => validatePlanningSnapshot(snapshot)).toThrow(/PLANNING_CONTRACT_MISMATCH/);
  });
});
