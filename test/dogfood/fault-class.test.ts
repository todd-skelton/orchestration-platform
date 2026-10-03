import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParserOptions } from "prettier";
import { parsers } from "prettier/plugins/typescript";
import { beforeAll, describe, expect, it } from "vitest";
import {
  classifyStop,
  parksItem,
  stopRules,
  type FaultClass,
} from "../../scripts/dogfood/fault-class.js";
import { isItemStopReason } from "../../scripts/dogfood/supervision.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = resolve(root, "test/dogfood/fault-class.fixture.mjs");

// Body copied verbatim from supervision.ts at
// 61e58474ba9b6ab6318f1707d7ce5b1134a670ef. Do not update with the implementation.
function frozenItemStopReason(reason: string) {
  return (
    [
      "author-failed",
      "author-malformed",
      "operator-evidence-failed",
      "continuation-failed",
      "terminal-attempt-admission-mismatch",
      "continuation-repair-not-authorized",
      "implementation-attempt-ceiling-exhausted",
      "reviewer-malformed",
      "exit-receipt-timeout",
      "launcher-failed",
      "rebase-conflict",
      "refresh-review-failed",
      "gate-correction-failed",
      "gate-correction-review-failed",
      "gate-correction-not-authorized",
      "conflict-resolution-failed",
      "conflict-resolution-exhausted",
      "conflict-resolution-scope-escape",
      "conflict-resolution-unsupported",
      "deploy-not-verified",
      "source-finding-location-outside-candidate",
    ].includes(reason) ||
    reason.startsWith("gate-retry-exhausted:") ||
    reason.startsWith("gate-correction-exhausted:") ||
    reason.startsWith("hosted-check-failed:") ||
    reason.startsWith("hosted-check-log-unavailable:")
  );
}

function walk(node: any, visit: (node: any) => void) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

function parse(source: string, filepath = "fixture.ts") {
  // Use the parser shipped by pinned Prettier, also for .mjs; no new dependency.
  return parsers.typescript.parse(source, { filepath } as ParserOptions);
}

async function extractReasons(source: string, filepath?: string): Promise<string[]> {
  const reasons: string[] = [];
  const collect = (argument: any) => {
    if (argument?.type === "Literal" && typeof argument.value === "string")
      reasons.push(argument.value);
    else if (argument?.type === "TemplateLiteral") {
      const head = argument.quasis[0].value.cooked;
      if (head) reasons.push(head);
    } else if (argument?.type === "ConditionalExpression") {
      collect(argument.consequent);
      collect(argument.alternate);
    }
  };
  walk(await parse(source, filepath), (node) => {
    if (node.callee?.type !== "Identifier") return;
    if (
      node.type === "NewExpression" &&
      ["QueueBlocked", "DeliveryBlocked", "SetupBlocked", "RepairBlocked"].includes(
        node.callee.name,
      )
    )
      collect(node.arguments[0]);
    if (node.type === "CallExpression" && ["demand", "requireThat"].includes(node.callee.name))
      collect(node.arguments[1]);
  });
  return reasons;
}

async function sourceFiles() {
  const dogfood = resolve(root, "scripts/dogfood");
  const adapters = resolve(root, "adapters");
  return [
    ...(await readdir(dogfood, { recursive: true }))
      .filter((file) => /\.(ts|mjs)$/.test(file) && !file.endsWith(".d.mts"))
      .map((file) => resolve(dogfood, file)),
    ...(await readdir(adapters))
      .filter((file) => file.endsWith(".mjs"))
      .map((file) => resolve(adapters, file)),
  ].sort();
}

function unclassified(reasons: Iterable<string>) {
  return [...new Set(reasons)].filter((reason) => classifyStop(reason).rule === "unclassified");
}

const builtElsewhere = [
  "author-failed",
  "author-malformed",
  "reviewer-malformed",
  "gate-correction-not-authorized",
  "operator-evidence-required",
  "merge-queue-removed",
];
let inventory: string[];
let frozenReasons: string[];

beforeAll(async () => {
  const reasons = [...builtElsewhere];
  for (const file of await sourceFiles())
    reasons.push(...(await extractReasons(await readFile(file, "utf8"), file)));
  inventory = [...new Set(reasons)].sort();
  frozenReasons = [];
  walk(await parse(frozenItemStopReason.toString()), (node) => {
    if (node.type === "Literal" && typeof node.value === "string") frozenReasons.push(node.value);
  });
});

describe("fault classification", () => {
  it("classifies every inventoried reason", async () => {
    // The fixture participates in the same ratchet: adding an unclassified
    // literal here must fail, just as adding one to production must.
    const fixtureReasons = await extractReasons(await readFile(fixture, "utf8"), fixture);
    expect(unclassified([...inventory, ...fixtureReasons])).toEqual([]);
    const counts: Record<FaultClass, number> = {
      attempt: 0,
      replan: 0,
      retry: 0,
      wait: 0,
      halt: 0,
    };
    for (const reason of inventory) {
      const classified = classifyStop(reason);
      counts[classified.faultClass]++;
      if (classified.faultClass === "halt")
        expect(["exact", "family"], reason).toContain(classified.rule);
    }
    process.stdout.write(`Stop inventory: ${inventory.length}; ${JSON.stringify(counts)}\n`);
  });

  it("preserves the frozen parking predicate", () => {
    expect(frozenReasons.filter((reason) => !reason.endsWith(":"))).toHaveLength(21);
    expect(frozenReasons.filter((reason) => reason.endsWith(":"))).toHaveLength(4);
    const cases = new Set([
      ...inventory,
      ...frozenReasons,
      ...frozenReasons.filter((reason) => reason.endsWith(":")).map((prefix) => prefix + "sample"),
      "gate-retry-exhausted:typecheck",
      "hosted-check-failed:bootstrap (windows-latest)",
      "gate-host-failed:test",
      "gate-attribution-unknown:test",
      "",
      "unknown-stop-reason",
      ...stopRules.flatMap((entry) =>
        entry.rule === "prefix"
          ? entry.reasons.flatMap((prefix) => [prefix, prefix + "test", prefix.slice(0, -1)])
          : entry.reasons,
      ),
    ]);
    for (const reason of cases) {
      expect(isItemStopReason(reason), reason).toBe(frozenItemStopReason(reason));
      expect(parksItem(reason), reason).toBe(frozenItemStopReason(reason));
    }
  });

  it("retains the explicit legacy parking backlog", () => {
    const expected = [
      ["exit-receipt-timeout", "retry", "exact"],
      ["launcher-failed", "retry", "exact"],
      ["reviewer-malformed", "retry", "exact"],
      ["hosted-check-log-unavailable:", "retry", "prefix"],
      ["deploy-not-verified", "wait", "exact"],
    ];
    expect(
      stopRules
        .flatMap((entry) =>
          entry.legacyParking
            ? entry.reasons.map((reason) => [reason, entry.faultClass, entry.rule])
            : [],
        )
        .sort(),
    ).toEqual(expected.sort());
    for (const [reason, faultClass, rule] of expected) {
      expect(classifyStop(reason!)).toEqual({ faultClass, legacyParking: true, rule });
      expect(parksItem(reason!)).toBe(true);
    }
  });

  it("allows only halt families and colon-terminated explicit prefixes", () => {
    const families = stopRules.filter((entry) => entry.rule === "family");
    expect(families.length).toBeGreaterThan(0);
    for (const entry of families) {
      expect(entry.faultClass).toBe("halt");
      expect(entry.legacyParking).toBe(false);
      for (const pattern of entry.reasons) {
        const reason = entry.match === "prefix" ? pattern + "fixture" : "fixture" + pattern;
        expect(classifyStop(reason)).toEqual({
          faultClass: "halt",
          legacyParking: false,
          rule: "family",
        });
        expect(parksItem(reason)).toBe(false);
      }
    }
    for (const entry of stopRules) {
      expect(entry.reasons).not.toContain("");
      if (entry.rule === "prefix")
        for (const prefix of entry.reasons) expect(prefix.endsWith(":")).toBe(true);
    }
  });

  it("resolves exact exceptions before families and unknown reasons to halt", () => {
    expect(classifyStop("terminal-attempt-admission-mismatch")).toEqual({
      faultClass: "replan",
      legacyParking: false,
      rule: "exact",
    });
    expect(classifyStop("hosted-check-failed:fixture-drift")).toEqual({
      faultClass: "attempt",
      legacyParking: false,
      rule: "prefix",
    });
    for (const reason of ["", "unknown-stop-reason"])
      expect(classifyStop(reason)).toEqual({
        faultClass: "halt",
        legacyParking: false,
        rule: "unclassified",
      });
  });

  it("records recovery actors without changing non-parking stops", () => {
    const expectations: Record<"retry" | "wait" | "halt", string[]> = {
      retry: [
        "issue-observation-unavailable",
        "current-main-unavailable",
        "current-main-moved",
        "hosted-observation-unavailable",
        "provider-unavailable",
        "learning-note-state-unknown",
        "stopped-issue-state-unknown",
        "working-label-state-unknown",
        "publication-outcome-unknown",
        "merge-outcome-unknown",
        "publication-unconfirmed-reconcile-before-retry",
        "merge-unconfirmed-reconcile-before-retry",
        "terminal-attempt-admission-authority-unavailable",
        "integration-continuation-authority-unavailable",
      ],
      wait: [
        "provider-model-refused",
        "operator-evidence-required",
        "operator-evidence-authority",
        "native-launch-ceiling-exhausted",
        "accepted-replan-required",
        "integration-continuation-required",
        "prerequisite-held",
        "merge-queue-removed",
        "completed-issue-state-unknown",
        "merge-queue-admission-unconfirmed",
        "gate-host-failed:test",
      ],
      halt: [
        "commit-result-unknown-reconcile",
        "launch-identity-timeout-reconcile",
        "prerequisite-not-admitted",
      ],
    };
    for (const [faultClass, reasons] of Object.entries(expectations))
      for (const reason of reasons) {
        expect(classifyStop(reason), reason).toEqual({
          faultClass,
          legacyParking: false,
          rule: reason === "gate-host-failed:test" ? "prefix" : "exact",
        });
        expect(isItemStopReason(reason), reason).toBe(false);
      }
  });

  it("reads only reason argument positions through nested and split key lists", async () => {
    expect(await extractReasons(await readFile(fixture, "utf8"), fixture)).toEqual([
      "author-failed",
      "author-malformed",
      "gate-host-failed:",
      "issue-observation-unavailable",
      "hosted-check-failed:",
      "invalid-setup-fixture",
      "operator-evidence-failed",
      "merge-queue-removed",
      "merge-queue-admission-unconfirmed",
    ]);
  });

  it("omits interpolation-first templates without losing adjacent reasons", async () => {
    const source = [
      "new QueueBlocked(`${role}-failed`);",
      "demand(ok, `${role}-malformed`);",
      "requireThat(ok, `${role}-state-incomplete`);",
      "new DeliveryBlocked(`${kind}:detail`);",
      "new SetupBlocked(`${role}-setup`);",
      "new RepairBlocked(`${role}-repair`);",
      "new QueueBlocked(`author-failed`);",
      'requireThat(ok, "issue-observation-unavailable");',
    ].join("\n");
    expect(await extractReasons(source)).toEqual([
      "author-failed",
      "issue-observation-unavailable",
    ]);
  });
});
