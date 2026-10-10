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
import {
  validDefect,
  retainWorkerOutcome,
  retainGateOutcome,
} from "../../scripts/dogfood/outcome.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = resolve(root, "test/dogfood/fault-class.fixture.mjs");

it("ISS-250 wrapper stops have explicit non-parking classes", () => {
  for (const [reason, faultClass] of [
    ["executor-busy", "wait"],
    ["upgrade-requires-restart", "wait"],
    ["executor-install-failed", "halt"],
  ]) {
    expect(classifyStop(reason!)).toEqual({ faultClass, legacyParking: false, rule: "exact" });
    expect(parksItem(reason!)).toBe(false);
  }
});

it("ISS-230 narrows only proved non-execution without clearing the missing-log backlog", () => {
  expect(classifyStop("hosted-check-never-executed")).toEqual({
    faultClass: "retry",
    legacyParking: false,
    rule: "exact",
  });
  expect(parksItem("hosted-check-never-executed")).toBe(false);
  expect(classifyStop("hosted-check-log-unavailable:macos")).toEqual({
    faultClass: "retry",
    legacyParking: true,
    rule: "prefix",
  });
  expect(parksItem("hosted-check-log-unavailable:macos")).toBe(true);
});

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

// Enumerate executable object producers, including conditional worker verdicts,
// separately from the stop-reason inventory. Types are not executable producers.
function outcomeProducers(tree: any, dynamic = false) {
  const found: Record<string, string[]> = {};
  const visit = (node: any, parents: any[]) => {
    if (!node || typeof node !== "object") return;
    const assigned = node.type === "AssignmentExpression" && node.left?.type === "MemberExpression";
    const key = assigned ? node.left.property : node.key;
    if (
      (assigned || (node.type === "Property" && parents.at(-1)?.type === "ObjectExpression")) &&
      ["status", "outcome", "bucket", "verdict", "phase"].includes(key.name ?? key.value)
    ) {
      const values: string[] = [];
      const collect = (value: any) => {
        if (value?.type === "Literal" && typeof value.value === "string") values.push(value.value);
        else if (value?.type === "ConditionalExpression") {
          collect(value.consequent);
          collect(value.alternate);
        } else if (dynamic) values.push("<dynamic>");
      };
      // Enumerate every spelling: a newly named failure must fail the ratchet.
      collect(assigned ? node.right : node.value);
      if (values.length && (!dynamic || values.includes("<dynamic>"))) {
        const owner = [...parents]
          .reverse()
          .find(
            (parent) =>
              [
                "FunctionDeclaration",
                "MethodDefinition",
                "Property",
                "VariableDeclarator",
              ].includes(parent.type) &&
              (parent.id?.name || parent.key?.name),
          );
        const name = owner?.id?.name ?? owner?.key?.name ?? "<module>";
        (found[name] ??= []).push(`${key.name ?? key.value}=${values.join("|")}`);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, [...parents, node]));
      else if (value && typeof value === "object") visit(value, [...parents, node]);
    }
  };
  visit(tree, []);
  return found;
}

it("ISS-236 derives the non-PASS producer ratchet from implementation sources", async () => {
  const observed: Record<string, string[]> = {};
  const dynamic: Record<string, string[]> = {};
  const callsByFile = new Map<string, string[]>();
  for (const file of await sourceFiles()) {
    const tree = await parse(await readFile(file, "utf8"), file);
    const short = file.split(/[\\/]/).at(-1)!;
    expect(callsByFile.has(short), "inventory file identities must be distinct").toBe(false);
    const calls: string[] = [];
    walk(tree, (node) => {
      if (node.type === "CallExpression" && node.callee?.type === "Identifier")
        calls.push(node.callee.name);
    });
    callsByFile.set(short, calls);
    const producers = outcomeProducers(tree);
    for (const [owner, values] of Object.entries(producers))
      observed[`${file.split(/[\\/]/).at(-1)}:${owner}`] = values;
    for (const [owner, values] of Object.entries(outcomeProducers(tree, true)))
      dynamic[`${file.split(/[\\/]/).at(-1)}:${owner}`] = values;
  }
  // Every entry names its class-producing boundary or a non-execution exclusion.
  // Counts retain distinct producers in the same function: adding one is a ratchet failure.
  const coverage: Record<string, { values: string[]; boundary: string }> = {
    "planning-repair.ts:planningStep": {
      values: ["status=planning-pending-host-review", "status=malformed"],
      boundary: "planning-repair.ts:retainWorkerOutcome",
    },
    "planning-repair.ts:unavailable": {
      values: ["status=planning-pending-host-review"],
      boundary: "excluded: unavailable external planning authority, no new execution",
    },
    "planning-repair.ts:result": {
      values: [
        "status=planning-accepted|planning-rejected|planning-pending-host-review|observing-planning-reviewer|observing-planning-author",
      ],
      boundary: "excluded: unapplied planning handoff, retaining native worker outcomes",
    },
    "chase-sets.mjs:candidatesFromAuthority": {
      values: ["status=not-runnable"],
      boundary: "excluded: pre-selection eligibility",
    },
    "chase-sets.mjs:deployObservation": {
      values: [
        "status=pending",
        "status=pending",
        "status=failed",
        "status=pending",
        "status=verified|failed",
        "status=failed",
        "status=not-required",
      ],
      boundary: "supervision.ts:retainStopOutcome",
    },
    "delivery-adapter.ts:runGate": {
      values: ["status=failed", "status=passed", "status=passed", "status=failed"],
      boundary: "queue.ts:retainGateOutcome",
    },
    "delivery.ts:failedResult": {
      values: ["status=failed"],
      boundary: "delivery.ts:retainOutcome",
    },
    "dispatch-adapter.ts:parseTrace": {
      values: ["status=dead", "status=running", "status=passed|failed"],
      boundary: "flow.ts:retainWorkerOutcome",
    },
    "dispatch-adapter.ts:observe": {
      values: ["status=malformed", "status=running", "status=dead", "status=running"],
      boundary: "flow.ts:retainWorkerOutcome",
    },
    "flow.ts:runStep": {
      values: ["status=malformed", "status=malformed"],
      boundary: "flow.ts:retainWorkerOutcome",
    },
    "queue.ts:queueConfigFromLoop": {
      values: Array(4).fill("phase=failed"),
      boundary: "supervision.ts:retainStopOutcome",
    },
    "queue.ts:attemptFailureRecord": {
      values: ["phase=failed"],
      boundary: "supervision.ts:retainStopOutcome",
    },
    "queue.ts:observed": { values: ["status=malformed"], boundary: "flow.ts:retainWorkerOutcome" },
    "queue.ts:syncParticipants": {
      values: ["status=malformed"],
      boundary: "queue.ts:retainWorkerOutcome",
    },
    "queue.ts:source": {
      values: ["status=accepted", "status=accepted", "status=fixable-review"],
      boundary: "flow.ts:retainWorkerOutcome",
    },
    "queue.ts:repair": {
      values: ["status=accepted", "status=failed"],
      boundary: "flow.ts:retainWorkerOutcome",
    },
    "status.mjs:observeSupervisor": {
      values: ["status=paused|running", "status=unavailable|exited", "status=unavailable"],
      boundary: "excluded: read-only status observation, not an unsuccessful execution",
    },
    "control.mjs:controlLoop": {
      values: ["status=pause-requested"],
      boundary: "excluded: operator intent",
    },
    "delivery.ts:deliveryStep": {
      values: [
        "status=complete",
        "status=observing-hosted-checks",
        "status=observing-hosted-checks",
        "status=observing-hosted-checks",
        "status=complete",
      ],
      boundary: "excluded: completion or pending hosted observation",
    },
    "delivery.ts:cleanup": {
      values: ["status=confirmed", "status=confirmed"],
      boundary: "excluded: confirmed cleanup",
    },
    "dispatch-adapter.ts:waitForProvider": {
      values: ["status=waiting-provider"],
      boundary: "excluded: pending provider admission",
    },
    "process-ownership.mjs:unavailable": {
      values: ["status=unavailable"],
      boundary: "excluded: read-only ownership observation",
    },
    "process-ownership.mjs:observeProcessOwnership": {
      values: ["status=observed"],
      boundary: "excluded: read-only ownership observation",
    },
    "queue.ts:initialAttempt": {
      values: ["phase=setup"],
      boundary: "excluded: reserved initial phase",
    },
    "queue.ts:runQueueStep": {
      values: [
        "phase=delivery",
        "status=advancing-attempt",
        "status=complete",
        "phase=source",
        "phase=delivery",
        "phase=repair",
        "phase=delivery",
        "status=advancing-attempt",
        "phase=delivery",
        "status=advancing-attempt",
        "phase=complete",
        "status=complete",
      ],
      boundary:
        "excluded: cursor transitions; failures belong to their source, repair or delivery producers",
    },
    "queue.ts:unavailable": {
      values: ["status=unavailable"],
      boundary: "excluded: advisory usage accounting",
    },
    "queue.ts:measured": {
      values: ["status=known"],
      boundary: "excluded: advisory usage accounting",
    },
    "queue.ts:delivery": {
      values: ["status=observing-author", "status=observing-hosted-checks"],
      boundary: "excluded: pending worker and hosted observation",
    },
    "refresh.ts:refreshDelivery": {
      values: ["status=ready", "status=awaiting-publication", "status=ready"],
      boundary:
        "excluded: accepted or pending refresh; thrown refusals participate in the stop inventory",
    },
    "setup.ts:dependencyRecord": {
      values: ["status=complete"],
      boundary: "excluded: completed dependency setup",
    },
    "status.mjs:publicationObservation": {
      values: ["status=observed"],
      boundary: "excluded: read-only publication observation",
    },
    "status.mjs:observeStatus": {
      values: [
        "status=unavailable",
        "status=observed",
        "status=unavailable",
        "status=observed",
        "status=unavailable",
      ],
      boundary: "excluded: read-only status observation",
    },
    "status.mjs:links": {
      values: ["status=unavailable"],
      boundary: "excluded: read-only link observation",
    },
    "status.mjs:value": {
      values: ["status=unavailable"],
      boundary: "excluded: read-only observation",
    },
    "supervise.mjs:row": {
      values: ["status=upgrade-deferred"],
      boundary: "excluded: deferred upgrade, existing executor continues",
    },
    "supervise.mjs:line": {
      values: ["status=blocked"],
      boundary: "supervision.ts:retainStopOutcome",
    },
    "supervise.mjs:main": {
      values: ["status=supervisor-started", "status=idle", "status=upgrade-ready", "status=paused"],
      boundary: "excluded: supervisor lifecycle, not a failed selected execution",
    },
  };
  expect(observed).toEqual(
    Object.fromEntries(Object.entries(coverage).map(([key, row]) => [key, row.values])),
  );
  // Dynamic reports, adapter results and continuation forwarding are inventoried
  // as expressions too; a variable-valued new producer cannot evade the ratchet.
  const dynamicCoverage: Record<string, { values: string[]; boundary: string }> = {
    "planning-repair.ts:planningStep": {
      values: ["outcome=<dynamic>"],
      boundary: "excluded: retained causal input, not another failure",
    },
    "queue.ts:acquire": {
      values: ["outcome=<dynamic>"],
      boundary: "excluded: retained causal input, not another failure",
    },
    "queue.ts:stopped": {
      values: ["outcome=<dynamic>", "outcome=<dynamic>"],
      boundary: "excluded: retained sibling lineage causes, not another failure",
    },
    "queue.ts:planning": {
      values: ["outcome=<dynamic>"],
      boundary: "excluded: retained causal input, not another failure",
    },
    "control.mjs:controlLoop": {
      values: ["status=<dynamic>"],
      boundary: "excluded: operator intent",
    },
    "delivery-adapter.ts:check": {
      values: ["bucket=<dynamic>"],
      boundary: "delivery.ts:retainOutcome",
    },
    "delivery.ts:validateChecks": {
      values: ["bucket=<dynamic>"],
      boundary: "delivery.ts:retainOutcome",
    },
    "dispatch-adapter.ts:properties": {
      values: ["verdict=<dynamic>", "verdict=<dynamic>"],
      boundary: "excluded: output schemas are not executions",
    },
    "flow.ts:finish": { values: ["status=<dynamic>"], boundary: "flow.ts:retainWorkerOutcome" },
    "queue.ts:participantWithoutUsage": {
      values: ["outcome=<dynamic>"],
      boundary: "excluded: retained accounting projection",
    },
    "queue.ts:runQueueStep": {
      values: Array(4).fill("status=<dynamic>"),
      boundary: "supervision.ts:retainStopOutcome",
    },
    "queue.ts:participant": {
      values: ["outcome=<dynamic>"],
      boundary: "queue.ts:retainWorkerOutcome",
    },
    "queue.ts:source": { values: ["status=<dynamic>"], boundary: "flow.ts:retainWorkerOutcome" },
    "queue.ts:repair": { values: ["status=<dynamic>"], boundary: "flow.ts:retainWorkerOutcome" },
    "queue.ts:delivery": {
      values: ["status=<dynamic>", "status=<dynamic>"],
      boundary: "delivery.ts:retainOutcome",
    },
    "refresh.ts:refreshDelivery": {
      values: ["status=<dynamic>", "status=<dynamic>"],
      boundary: "flow.ts:retainWorkerOutcome",
    },
    "setup-adapter.ts:defaultInstall": {
      values: ["status=<dynamic>", "status=<dynamic>"],
      boundary: "supervision.ts:retainStopOutcome",
    },
    "setup.ts:result": {
      values: ["status=<dynamic>", "phase=<dynamic>"],
      boundary: "supervision.ts:retainStopOutcome",
    },
    "status.mjs:checks": {
      values: ["status=<dynamic>"],
      boundary: "excluded: read-only check observation",
    },
    "status.mjs:observeStatus": {
      values: ["status=<dynamic>", "status=<dynamic>", "phase=<dynamic>"],
      boundary: "excluded: read-only status observation",
    },
    "status.mjs:lastLogObservation": {
      values: ["status=<dynamic>"],
      boundary: "excluded: read-only log observation",
    },
    "supervise.mjs:result": {
      values: ["status=<dynamic>"],
      boundary: "excluded: native DB request lifecycle, not execution verdict",
    },
    "supervise.mjs:receive": {
      values: ["status=<dynamic>"],
      boundary: "excluded: native DB reply lifecycle, not execution verdict",
    },
    "supervision.ts:startCycle": {
      values: ["status=<dynamic>", "status=<dynamic>"],
      boundary: "excluded: scheduling lifecycle",
    },
    "supervision.ts:placements": {
      values: ["outcome=<dynamic>"],
      boundary: "excluded: retained placement history",
    },
  };
  expect(dynamic).toEqual(
    Object.fromEntries(Object.entries(dynamicCoverage).map(([key, row]) => [key, row.values])),
  );
  for (const { boundary } of [...Object.values(coverage), ...Object.values(dynamicCoverage)]) {
    if (boundary.startsWith("excluded:")) continue;
    const [file, name] = boundary.split(":");
    expect(callsByFile.get(file!), boundary).toContain(name);
  }
  // NC-new-producer: unlike a hand-picked enum fixture, an executable new site
  // changes the inventory even inside an already covered function.
  expect(
    outcomeProducers(await parse('function newProducer() { return {status: "failed"}; }')),
  ).toEqual({ newProducer: ["status=failed"] });
  expect(
    outcomeProducers(await parse('function newProducer(result) { result.status = "failed"; }')),
  ).toEqual({ newProducer: ["status=failed"] });
});

it("ISS-236 refuses absent or multiple primary classes and excludes pending, PASS and exit 73", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "outcome-record-"));
  try {
    const context = {
      repository: "owner/repo",
      run: "run",
      issue: "ISS-236:1",
      stateDirectory: directory,
    };
    const defect = {
      defectClass: "brief" as const,
      explanation: "Incompatible criteria.",
      rootCause: "criteria-conflict",
      evidenceStatus: "established" as const,
      evidence: ["brief.md:1"],
    };
    expect(validDefect(defect)).toBe(true);
    for (const invalid of [
      { ...defect, defectClass: undefined },
      { ...defect, defectClass: ["brief", "design"] },
      { ...defect, evidence: [{ nested: ["brief.md"] }] },
    ])
      expect(validDefect(invalid)).toBe(false);
    for (const status of ["running", "passed"])
      await retainWorkerOutcome(
        context,
        "author",
        { id: "worker", trace: "/trace" },
        { status, defect },
      );
    expect(await readdir(directory)).toEqual([]); // NC-pending-as-failure
    const terminal = { status: "failed", head: "a".repeat(40), defect };
    const path = await retainWorkerOutcome(
      context,
      "author",
      { id: "worker", trace: "/trace" },
      terminal,
    );
    const before = await readFile(path!, "utf8");
    expect(JSON.parse(before)).toMatchObject({ defectClass: "brief", stage: directory, terminal }); // NC-persistence-field-omitted
    expect(
      await retainWorkerOutcome(context, "author", { id: "worker", trace: "/trace" }, terminal),
    ).toBe(path);
    expect(await readFile(path!, "utf8")).toBe(before);
    expect((await readdir(directory)).filter((file) => file.startsWith("outcome-"))).toHaveLength(
      1,
    );
    const gate = resolve(directory, "gate");
    await mkdir(gate);
    await writeFile(resolve(gate, "candidate-terminal.json"), JSON.stringify({ code: 73 }));
    expect(
      await retainGateOutcome(context, "test", "a".repeat(40), {
        log: resolve(gate, "candidate.log"),
        diagnostics: [],
      }),
    ).toBeUndefined();
    expect((await readdir(directory)).filter((file) => file.startsWith("outcome-"))).toHaveLength(
      1,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("ISS-236 named one-variable mutants fail their classification and persistence assertions", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "outcome-mutants-"));
  try {
    const original = await readFile(resolve(root, "scripts/dogfood/outcome.ts"), "utf8");
    const cases = [
      {
        name: "NC-producer-class-removed",
        pattern: /return retainOutcome\(context, \{\r?\n    kind: "worker",[\s\S]*?\r?\n  \}\);/,
        replacement: "return undefined;",
        assertion: "persisted",
      },
      {
        name: "NC-two-classes-accepted",
        pattern: /defectClasses\.includes\(row\.defectClass as DefectClass\)/,
        replacement:
          "(Array.isArray(row.defectClass) || defectClasses.includes(row.defectClass as DefectClass))",
        assertion: "two",
      },
      {
        name: "NC-pending-as-failure",
        pattern: /\["failed", "malformed", "dead"\]\.includes\(terminal\.status\)/,
        replacement: '["failed", "malformed", "dead", "running"].includes(terminal.status)',
        assertion: "pending",
      },
      {
        name: "NC-persistence-field-omitted",
        pattern: /\.\.\.outcome\.defect,/,
        replacement: "...{},",
        assertion: "persisted",
      },
    ];
    for (const [index, control] of cases.entries()) {
      expect(original.match(new RegExp(control.pattern.source, "g")), control.name).toHaveLength(1);
      expect(
        original.replace(/\r?\n/g, "\r\n").match(new RegExp(control.pattern.source, "g")),
        `${control.name}: Windows checkout`,
      ).toHaveLength(1);
      for (const mutant of [false, true]) {
        const path = resolve(directory, `${index}-${mutant}.ts`);
        const state = resolve(directory, `${index}-${mutant}`);
        await mkdir(state);
        await writeFile(
          path,
          mutant ? original.replace(control.pattern, control.replacement) : original,
        );
        const program = `
          import assert from 'node:assert/strict';
          import {readdir, readFile} from 'node:fs/promises';
          import {resolve} from 'node:path';
          const {validDefect, retainWorkerOutcome} = await import(${JSON.stringify(pathToFileURL(path).href)});
          const state = ${JSON.stringify(state)};
          const defect = {defectClass:'brief', explanation:'Conflicting criteria.', rootCause:'criteria', evidenceStatus:'established', evidence:['brief.md:1']};
          const mode = ${JSON.stringify(control.assertion)};
          if (mode === 'two') assert.equal(validDefect({...defect, defectClass:['brief','design']}), false);
          else {
            await retainWorkerOutcome({repository:'owner/repo',run:'run',issue:'ISS-236',stateDirectory:state}, 'author', {id:'worker',trace:'/trace'}, {status:mode==='pending'?'running':'failed',defect});
            const files = await readdir(state);
            assert.equal(files.length, mode==='pending'?0:1);
            if(mode!=='pending') assert.equal(JSON.parse(await readFile(resolve(state,files[0]),'utf8')).defectClass,'brief');
          }
        `;
        const execute = promisify(execFile)(
          process.execPath,
          ["--input-type=module", "--eval", program],
          { windowsHide: true },
        );
        if (mutant)
          await expect(execute, control.name).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining("AssertionError"),
          });
        else await expect(execute, control.name).resolves.toMatchObject({ stderr: "" });
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
  "executor-busy",
  "executor-install-failed",
  "upgrade-requires-restart",
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
        expect(["exact", "prefix", "family"], reason).toContain(classified.rule);
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
      if (reason === "verification-only-candidate-failed") {
        expect(classifyStop(reason)).toEqual({
          faultClass: "attempt",
          legacyParking: false,
          rule: "exact",
        });
        expect(parksItem(reason)).toBe(true);
        continue;
      }
      expect(isItemStopReason(reason), reason).toBe(frozenItemStopReason(reason));
      expect(parksItem(reason), reason).toBe(frozenItemStopReason(reason));
    }
  });

  it("classifies suffixed halt reasons through prefix rules", () => {
    const samples = new Set([
      "ci-failed:bootstrap",
      "dependency-state-drift:source",
      "dependency-state-unconfirmed:source",
      "gate-attribution-unknown:test",
      "missing-or-ambiguous-check:bootstrap",
      "missing-or-duplicate-check:bootstrap",
      "self-sibling-refused:ISS-225",
      "unowned-worktree:source",
      "worktree-collision:source",
      "worktree-state-drift:source",
      "worktree-state-unknown:source",
      ...stopRules.flatMap((entry) =>
        entry.rule === "prefix" && entry.faultClass === "halt"
          ? entry.reasons.map((prefix) => prefix + "sample")
          : [],
      ),
    ]);
    for (const reason of samples) {
      expect(classifyStop(reason), reason).toEqual({
        faultClass: "halt",
        legacyParking: false,
        rule: "prefix",
      });
      expect(isItemStopReason(reason), reason).toBe(frozenItemStopReason(reason));
    }
  });

  it("classifies both refused prerequisite owner outcomes exactly", () => {
    for (const reason of ["prerequisite-owner-live", "prerequisite-owner-unknown"]) {
      expect(classifyStop(reason), reason).toEqual({
        faultClass: "halt",
        legacyParking: false,
        rule: "exact",
      });
      expect(isItemStopReason(reason), reason).toBe(frozenItemStopReason(reason));
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
