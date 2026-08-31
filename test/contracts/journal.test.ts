import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  iss002HarnessPaths,
  iss002TestBundlePaths,
} from "../../packages/conformance/src/stable-bundles.js";
import * as c from "../../packages/contracts/src/index.js";

type Row = Record<string, any>;

const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const enc = new TextEncoder();
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const concat = (...parts: readonly Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};
const uint = (value: number | bigint, width: 4 | 8) => {
  const bytes = new Uint8Array(width);
  const view = new DataView(bytes.buffer);
  if (width === 4) view.setUint32(0, Number(value), false);
  else view.setBigUint64(0, BigInt(value), false);
  return bytes;
};
const ordered = (value: any): any => {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  return value;
};
const canonical = (value: unknown) => enc.encode(`${JSON.stringify(ordered(value))}\n`);
const domain = (name: string, suffix: Uint8Array) =>
  hash(concat(enc.encode("orchestration-platform\0"), enc.encode(`${name}\0`), suffix));
const framed = (name: string, value: unknown) => {
  const payload = canonical(value);
  return concat(
    enc.encode("orchestration-platform\0"),
    enc.encode(`${name}\0`),
    uint(1, 4),
    Uint8Array.of(7),
    uint(payload.byteLength, 8),
    payload,
  );
};
const framedHash = (name: string, value: unknown) => hash(framed(name, value));
const prefixHash = (bytes: Uint8Array) =>
  domain("event-journal-prefix/v1", concat(uint(bytes.byteLength, 8), bytes));
const eventHash = (event: unknown) => framedHash("orchestration-event/v1", event);

// Authored with a standalone node:crypto/TextEncoder generator in TEMP. These
// literals do not call the contract serializer or digest implementation.
const goldens = {
  event: {
    text: `{"cycleId":"01900000-0000-7000-8000-000000000002","output":null,"phase":"STARTED","position":"0","previousEventDigest":null,"previousPrefixDigest":"${"b".repeat(64)}","retainedEvidence":[],"schemaVersion":"orchestration-event/v1","step":{"cycleId":"01900000-0000-7000-8000-000000000002","inputDigest":"${"a".repeat(64)}","kind":"session.verify","ordinal":"1","predecessorJournalDigest":null}}\n`,
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d006f726368657374726174696f6e2d6576656e742f763100000000010700000000000001e77b226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c226f7574707574223a6e756c6c2c227068617365223a2253544152544544222c22706f736974696f6e223a2230222c2270726576696f75734576656e74446967657374223a6e756c6c2c2270726576696f7573507265666978446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657461696e656445766964656e6365223a5b5d2c22736368656d6156657273696f6e223a226f726368657374726174696f6e2d6576656e742f7631222c2273746570223a7b226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c22696e707574446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226b696e64223a2273657373696f6e2e766572696679222c226f7264696e616c223a2231222c227072656465636573736f724a6f75726e616c446967657374223a6e756c6c7d7d0a",
    digest: "c4faff8f920a216f3514f2d8087139e6ac85d852f362a4e4b72affd14bca373b",
  },
  reduced: {
    text: `{"bindings":{"actionDigest":null,"applyDigest":null,"followUpDigest":null,"mutationPlanDigest":null,"reclaimDigest":null,"reviewAuthorityDigest":null,"subjectDigest":null},"cycleId":"01900000-0000-7000-8000-000000000002","cyclePlanDigest":"${"a".repeat(64)}","journalPrefixDigest":"${"b".repeat(64)}","outcome":{"kind":"RUNNING"},"pendingStep":null,"schemaVersion":"reduced-state/v1","steps":[]}\n`,
    digest: "1e50c72717c6c4ccce7b5d44ad71d40e658f44568d6928c4d353f27838e5d599",
  },
} as const;

const kinds = [
  "session.verify",
  "project.snapshot",
  "breaker.reduce",
  "module.plan",
  "route.select",
  "project.preflight",
  "dispatch.plan",
  "worker.dispatch",
  "worker.observe",
  "review.reduce",
  "disposition.plan",
  "mutation.plan",
  "action.apply",
  "resource.reclaim",
  "cycle.terminal",
] as const;

function base() {
  const configurationProvenance = {
    adapterId: "fixture.adapter",
    capabilityNames: ["work.read"],
    fieldSources: {
      adapterId: "PROJECT",
      capabilityNames: "PROJECT",
      leaseFreshnessMs: "PROJECT",
      maximumSessionMs: "PROJECT",
      projectId: "PROJECT",
      stateRoot: "DEFAULT",
      wallClockSkewMs: "PROJECT",
    },
    leaseFreshnessMs: 30_000,
    maximumSessionMs: 3_600_000,
    projectId: id(1),
    projectRoot: `<redacted:path:${"a".repeat(64)}>`,
    schemaVersion: "configuration-provenance/v1",
    stateRoot: `<redacted:path:${"b".repeat(64)}>`,
    wallClockSkewMs: 1_000,
  };
  const configuration = {
    adapterId: "fixture.adapter",
    adapterVersion: "1.2.3",
    capabilityNames: ["work.read"],
    engineVersion: "0.0.0",
    projectId: id(1),
    schemaVersion: "adapter-configuration/v1",
  };
  const request = {
    adapterId: configuration.adapterId,
    allowedModuleIds: ["fixture.module"],
    cycleId: id(2),
    schemaVersion: "cycle-request/v1",
    sessionRequest: {
      configurationPathsDigest: "c".repeat(64),
      configurationProvenanceDigest: c.canonicalDigest(configurationProvenance),
      configurationSourceDigest: "d".repeat(64),
      schemaVersion: "session-acquire-request/v1",
      sessionId: id(3),
    },
  };
  const cyclePlan = { protocol: "routine-cycle/v1", request, schemaVersion: "cycle-plan/v1" };
  return { configuration, configurationProvenance, cyclePlan };
}

function step(ordinal: number, inputDigest: string, predecessorJournalDigest: string | null) {
  return {
    cycleId: id(2),
    inputDigest,
    kind: kinds[ordinal - 1]!,
    ordinal: String(ordinal),
    predecessorJournalDigest,
  };
}

function fixture() {
  const b = base();
  const cyclePlanDigest = c.computeCyclePlanDigest(b.cyclePlan);
  const genesisInput = {
    cycleId: id(2),
    cyclePlan: b.cyclePlan,
    cyclePlanDigest,
    sessionId: id(3),
  };
  const genesisDigest = domain("event-journal-genesis/v1", canonical(genesisInput));
  const physicalHeader = { ...genesisInput, genesisDigest, schemaVersion: "event-journal/v1" };
  let bytes = concat(
    enc.encode("OPJ1"),
    Uint8Array.of(0),
    uint(canonical(physicalHeader).byteLength, 4),
    canonical(physicalHeader),
  );
  const events: Row[] = [];
  const evidence: Row[][] = [];
  let priorEvent: Row | null = null;

  const add = (phase: "STARTED" | "TERMINAL", currentStep: Row, output: Row | null) => {
    const event = {
      cycleId: id(2),
      output,
      phase,
      position: String(events.length),
      previousEventDigest: priorEvent === null ? null : eventHash(priorEvent),
      previousPrefixDigest: prefixHash(bytes),
      retainedEvidence: [],
      schemaVersion: "orchestration-event/v1",
      step: copy(currentStep),
    };
    const eventBytes = canonical(event);
    events.push(event);
    evidence.push([]);
    bytes = concat(bytes, uint(eventBytes.byteLength, 4), eventBytes);
    priorEvent = event;
    return event;
  };

  const step1 = step(1, c.computeCycleRequestDigest(b.cyclePlan.request), null);
  const health = {
    holderSessionId: id(3),
    leaseState: "HELD_FRESH",
    observedAt: "2026-08-31T01:00:00.000Z",
    outcome: "REFUSED",
    reason: "CONFIGURATION_MISMATCH",
    schemaVersion: "session-health/v1",
    step: copy(step1),
    targetSessionId: id(3),
  };
  add("STARTED", step1, null);
  add("TERMINAL", step1, { cyclePlan: b.cyclePlan, health, kind: "SESSION" });

  const skips: Row[] = [];
  let priorPrimary = c.computeSessionHealthDigest(health);
  for (let ordinal = 2; ordinal <= 13; ordinal += 1) {
    const current = step(ordinal, priorPrimary, prefixHash(bytes));
    const skip = {
      reason: "prior-known-terminal",
      schemaVersion: "routine-step-skip/v1",
      step: copy(current),
    };
    add("STARTED", current, null);
    add("TERMINAL", current, { kind: "SKIP", skip });
    skips.push(skip);
    priorPrimary = c.computeRoutineStepSkipDigest(skip);
  }

  const inspectionHealth = { ...health, step: null };
  const context = {
    adapterConfiguration: b.configuration,
    configurationProvenance: b.configurationProvenance,
    cyclePlan: b.cyclePlan,
    origin: { health: copy(health), kind: "SESSION" },
    sessionHealth: inspectionHealth,
    skips: copy(skips),
  };
  const reclaim = {
    contextDigest: c.computeResourceReclaimContextDigest(context),
    cycleId: id(2),
    observations: [],
    outcome: { kind: "NO_ALLOCATION" },
    process: { kind: "NOT_LAUNCHED" },
    reclaimTransactionId: id(4),
    schemaVersion: "resource-reclaim-receipt/v1",
  };
  const step14 = step(14, c.computeResourceReclaimContextDigest(context), prefixHash(bytes));
  add("STARTED", step14, null);
  add("TERMINAL", step14, { context, kind: "RECLAIM", receipt: reclaim });
  const journal = {
    ...genesisInput,
    events,
    genesisDigest,
    schemaVersion: "event-journal/v1",
  };
  return { add, b, bytes, evidence, health, journal, reclaim, skips, step1 };
}

function terminalCycle() {
  const f = fixture();
  const pre15 = c.reduceEventJournal(f.journal, f.evidence);
  expect(pre15.ok).toBe(true);
  if (!pre15.ok) throw new Error(pre15.issues.join(","));
  const step15 = step(15, c.computeReducedStateDigest(pre15.value), prefixHash(f.bytes));
  f.add("STARTED", step15, null);
  const startedJournal = { ...f.journal, events: copy(f.journal.events) };
  const terminalizing = c.reduceEventJournal(startedJournal, f.evidence);
  expect(terminalizing.ok).toBe(true);
  if (!terminalizing.ok) throw new Error(terminalizing.issues.join(","));
  const receipt = {
    bindings: copy(terminalizing.value.bindings),
    cycleId: id(2),
    cyclePlanDigest: f.journal.cyclePlanDigest,
    outcome: "FAILED_KNOWN",
    reclaimOutcome: "NO_ALLOCATION",
    reducedStateDigest: c.computeReducedStateDigest(terminalizing.value),
    schemaVersion: "cycle-receipt/v1",
    sessionId: id(3),
    startedJournalPrefixDigest: terminalizing.value.journalPrefixDigest,
    steps: copy(terminalizing.value.steps),
    terminalStepDigest: c.computeRoutineStepDigest(step15),
  };
  f.add("TERMINAL", step15, { kind: "CYCLE_TERMINAL", receipt });
  return { ...f, receipt, startedJournal, step15, terminalizing };
}

const emptyBindings = () => ({
  actionDigest: null,
  applyDigest: null,
  followUpDigest: null,
  mutationPlanDigest: null,
  reclaimDigest: null,
  reviewAuthorityDigest: null,
  subjectDigest: null,
});

test("publishes only the four Round408 families and their closed event census", () => {
  expect(c.journalSchemaVersions).toEqual([
    "orchestration-event/v1",
    "event-journal/v1",
    "reduced-state/v1",
    "cycle-receipt/v1",
  ]);
  expect(c.eventOutputKinds).toEqual([
    "SESSION",
    "PROJECT_FACTS",
    "BREAKER",
    "MODULE",
    "ROUTE",
    "PREFLIGHT",
    "DISPATCH_PLAN",
    "LAUNCH",
    "WORKER_TERMINAL",
    "REVIEW_AUTHORITY",
    "DISPOSITION",
    "MUTATION_PLAN",
    "PROJECT_APPLY",
    "RECLAIM",
    "CYCLE_TERMINAL",
    "SKIP",
  ]);
  expect(c.retainedEvidenceKinds).toEqual([
    "MAPPING_OBSERVATION",
    "MUTATION_OBSERVATION",
    "PREFLIGHT_OBSERVATION",
    "RENDERED_INPUT",
    "STDERR",
    "STDOUT",
  ]);
  expect(c.journalSchemaFields).toMatchObject({
    session: ["cyclePlan", "health", "kind"],
    facts: ["configuration", "facts", "kind"],
    breaker: [
      "configuration",
      "cycleRequest",
      "kind",
      "policyFacts",
      "prior",
      "projectFacts",
      "provenance",
      "receipt",
    ],
    module: ["input", "kind", "result"],
    route: ["action", "input", "kind", "mapping", "route"],
    preflight: ["action", "input", "kind", "mapping", "observation", "preflight", "route"],
    dispatchPlan: [
      "action",
      "cyclePlan",
      "health",
      "input",
      "kind",
      "mapping",
      "observation",
      "plan",
      "preflight",
      "reviewRequest",
      "route",
    ],
    launch: ["kind", "launch", "plan", "terminal"],
    workerTerminal: ["attempt", "kind", "launch", "plan", "resultSubject", "terminal"],
    review: ["attempt", "authority", "kind", "request"],
    disposition: ["disposition", "followUp", "input", "kind"],
    mutationPlan: ["disposition", "dispositionInput", "kind", "observation", "plan", "request"],
    apply: [
      "afterObservation",
      "beforeObservation",
      "disposition",
      "dispositionInput",
      "dryObservation",
      "expectedPlanDigest",
      "kind",
      "plan",
      "receipt",
      "request",
    ],
    reclaim: ["context", "kind", "receipt"],
    cycleTerminal: ["kind", "receipt"],
    skip: ["kind", "skip"],
  });
  expect(c.parseJournalContract("release-receipt/v1", {})).toBeNull();
  expect(iss002HarnessPaths).toContain("packages/contracts/src/journal.ts");
  expect(iss002TestBundlePaths).toContain("test/contracts/journal.test.ts");
});

test("pins independent canonical bytes, one-part frames and hashes", () => {
  const fixedEvent = JSON.parse(goldens.event.text);
  const fixedReduced = JSON.parse(goldens.reduced.text);
  expect(new TextDecoder().decode(canonical(fixedEvent))).toBe(goldens.event.text);
  expect(Buffer.from(framed("orchestration-event/v1", fixedEvent)).toString("hex")).toBe(
    goldens.event.frameHex,
  );
  expect(c.computeOrchestrationEventDigest(fixedEvent)).toBe(goldens.event.digest);
  expect(c.serializeContract("orchestration-event/v1", fixedEvent)).toEqual({
    bytes: enc.encode(goldens.event.text),
    digest: goldens.event.digest,
    ok: true,
  });
  expect(new TextDecoder().decode(canonical(fixedReduced))).toBe(goldens.reduced.text);
  expect(c.computeReducedStateDigest(fixedReduced)).toBe(goldens.reduced.digest);

  const f = fixture();
  const event = f.journal.events[0]!;
  const reduced = c.reduceEventJournal({ ...f.journal, events: f.journal.events.slice(0, 2) }, [
    [],
    [],
  ]);
  expect(reduced.ok).toBe(true);
  if (!reduced.ok) throw new Error(reduced.issues.join(","));
  for (const [schema, value, compute] of [
    ["orchestration-event/v1", event, c.computeOrchestrationEventDigest],
    ["reduced-state/v1", reduced.value, c.computeReducedStateDigest],
  ] as const) {
    expect(c.serializeContract(schema, value)).toEqual({
      bytes: canonical(value),
      digest: framedHash(schema, value),
      ok: true,
    });
    expect(Buffer.from(framed(schema, value)).toString("hex")).toMatch(/^[0-9a-f]+$/);
  }
  expect(
    c.computeEventJournalGenesisDigest({
      cycleId: f.journal.cycleId,
      cyclePlan: f.journal.cyclePlan,
      cyclePlanDigest: f.journal.cyclePlanDigest,
      sessionId: f.journal.sessionId,
    }),
  ).toBe(f.journal.genesisDigest);
  expect(c.computeEventJournalPrefixDigest(f.bytes)).toBe(prefixHash(f.bytes));
  expect(c.computeEventJournalDigest(f.journal)).toBe(
    domain("event-journal/v1", concat(uint(f.bytes.byteLength, 8), f.bytes)),
  );
});

test("uses authentic OPJ1 header and strict length-delimited physical bytes", () => {
  const f = fixture();
  expect(Buffer.from(f.bytes.slice(0, 5)).toString("hex")).toBe("4f504a3100");
  expect(c.serializeEventJournal(f.journal)).toEqual(f.bytes);
  expect(c.parseEventJournalBytes(f.bytes).ok).toBe(true);
  expect(c.inspectEventJournalBytes(f.bytes)).toMatchObject({
    ok: true,
    value: { authoritativeByteLength: f.bytes.byteLength, partialSuffix: false },
  });

  for (const mutant of [
    Uint8Array.of(...f.bytes.slice(0, 4), 1, ...f.bytes.slice(5)),
    Uint8Array.of(0x58, ...f.bytes.slice(1)),
    Uint8Array.of(0xef, 0xbb, 0xbf, ...f.bytes),
  ]) {
    expect(c.inspectEventJournalBytes(mutant).ok).toBe(false);
    expect(c.parseEventJournalBytes(mutant).ok).toBe(false);
  }
  const wrongHeaderLength = f.bytes.slice();
  new DataView(wrongHeaderLength.buffer).setUint32(5, 0xffffffff, false);
  expect(c.inspectEventJournalBytes(wrongHeaderLength).ok).toBe(false);

  const crlfHeader = f.bytes.slice();
  const headerLength = new DataView(crlfHeader.buffer).getUint32(5, false);
  crlfHeader[9 + headerLength - 1] = 0x0d;
  expect(c.inspectEventJournalBytes(crlfHeader).ok).toBe(false);
});

test("enforces genesis, cycle, position, event and prefix identities over the logical sequence", () => {
  const f = fixture();
  expect(c.parseEventJournal({ ...f.journal, events: [] }).ok).toBe(true);
  expect(c.parseEventJournal({ ...f.journal, events: [f.journal.events[0]] }).ok).toBe(true);
  for (const journal of [
    { ...f.journal, cycleId: id(90) },
    { ...f.journal, sessionId: id(90) },
    { ...f.journal, cyclePlanDigest: "0".repeat(64) },
    { ...f.journal, genesisDigest: "0".repeat(64) },
    { ...f.journal, events: [f.journal.events[1], f.journal.events[0]] },
    { ...f.journal, events: [f.journal.events[0], f.journal.events[0]] },
    {
      ...f.journal,
      events: f.journal.events.map((row, index) =>
        index === 2 ? { ...row, previousPrefixDigest: "0".repeat(64) } : row,
      ),
    },
    {
      ...f.journal,
      events: f.journal.events.map((row, index) =>
        index === 2 ? { ...row, previousEventDigest: "0".repeat(64) } : row,
      ),
    },
    {
      ...f.journal,
      events: f.journal.events.map((row, index) =>
        index === 2 ? { ...row, cycleId: id(90), step: { ...row.step, cycleId: id(90) } } : row,
      ),
    },
  ])
    expect(c.parseEventJournal(journal).ok).toBe(false);

  const overCapacity = {
    ...f.journal,
    events: Array.from({ length: 4097 }, () => f.journal.events[0]),
  };
  expect(c.parseEventJournal(overCapacity).ok).toBe(false);
  // A caller can present a structurally authentic empty journal. Fresh-root and
  // session admission remain external and are deliberately not inferred here.
  const empty = { ...f.journal, events: [] };
  expect(c.parseEventJournal(empty).ok).toBe(true);
  expect(
    c.computeEventJournalGenesisDigest({
      cycleId: empty.cycleId,
      cyclePlan: empty.cyclePlan,
      cyclePlanDigest: empty.cyclePlanDigest,
      sessionId: empty.sessionId,
    }),
  ).toBe(empty.genesisDigest);
});

test("inspects a partial final suffix but strict parsing and append planning refuse it", () => {
  const f = fixture();
  for (const tail of [Uint8Array.of(0), Uint8Array.of(0, 0, 0), Uint8Array.of(0, 0, 0, 12, 0x7b)]) {
    const partial = concat(f.bytes, tail);
    const inspected = c.inspectEventJournalBytes(partial);
    expect(inspected).toMatchObject({
      ok: true,
      value: { authoritativeByteLength: f.bytes.byteLength, partialSuffix: true },
    });
    expect(c.parseEventJournalBytes(partial).ok).toBe(false);
    expect(c.planEventJournalAppend(partial, f.journal.events.at(-1)).ok).toBe(false);
  }
  const truncatedCompleteFrame = f.bytes.slice(0, -1);
  expect(c.inspectEventJournalBytes(truncatedCompleteFrame)).toMatchObject({
    ok: true,
    value: { partialSuffix: true },
  });
  expect(c.parseEventJournalBytes(truncatedCompleteFrame).ok).toBe(false);
});

test("plans APPEND and exact sole-next IDEMPOTENT while refusing conflicts and moved prefixes", () => {
  const f = fixture();
  const exact = c.planEventJournalAppend(f.bytes, f.journal.events.at(-1));
  expect(exact).toMatchObject({ ok: true, value: { status: "IDEMPOTENT" } });
  if (exact.ok) expect(exact.value.bytes).toEqual(f.bytes);

  const pre15 = c.reduceEventJournal(f.journal, f.evidence);
  expect(pre15.ok).toBe(true);
  if (!pre15.ok) throw new Error(pre15.issues.join(","));
  const inputDigest = c.computeReducedStateDigest(pre15.value);
  const nextStep = step(15, inputDigest, prefixHash(f.bytes));
  const next = {
    cycleId: id(2),
    output: null,
    phase: "STARTED",
    position: String(f.journal.events.length),
    previousEventDigest: eventHash(f.journal.events.at(-1)),
    previousPrefixDigest: prefixHash(f.bytes),
    retainedEvidence: [],
    schemaVersion: "orchestration-event/v1",
    step: nextStep,
  };
  const appended = c.planEventJournalAppend(f.bytes, next);
  expect(appended).toMatchObject({ ok: true, value: { status: "APPEND" } });
  if (!appended.ok) throw new Error(appended.issues.join(","));
  expect(appended.value.resultingPrefixDigest).toBe(prefixHash(appended.value.bytes));
  expect(c.parseEventJournalBytes(appended.value.bytes).ok).toBe(true);
  expect(c.planEventJournalAppend(appended.value.bytes, next)).toMatchObject({
    ok: true,
    value: { status: "IDEMPOTENT" },
  });

  expect(
    c.planEventJournalAppend(f.bytes, { ...next, previousPrefixDigest: "0".repeat(64) }).ok,
  ).toBe(false);
  expect(
    c.planEventJournalAppend(f.bytes, { ...next, previousEventDigest: "0".repeat(64) }).ok,
  ).toBe(false);
  expect(c.planEventJournalAppend(f.bytes, { ...next, position: "0" }).ok).toBe(false);
  expect(c.planEventJournalAppend(f.bytes.slice(0, -1), next).ok).toBe(false);
});

test("refuses a second terminal, a complete suffix conflict and append after cycle terminal", () => {
  const f = terminalCycle();
  const finalBytes = c.serializeEventJournal(f.journal);
  const prior = f.journal.events.at(-1)!;
  const after = {
    ...copy(prior),
    position: String(f.journal.events.length),
    previousEventDigest: eventHash(prior),
    previousPrefixDigest: prefixHash(finalBytes),
  };
  expect(c.parseOrchestrationEvent(after).ok).toBe(true);
  expect(c.planEventJournalAppend(finalBytes, after).ok).toBe(false);

  const conflicting = copy(f.journal);
  conflicting.events.at(-1)!.output.receipt.outcome = "COMPLETED";
  expect(c.parseEventJournal(conflicting).ok).toBe(false);
  const duplicated = { ...f.journal, events: [...f.journal.events, copy(prior)] };
  expect(c.parseEventJournal(duplicated).ok).toBe(false);
});

test("binds STARTED and the actual SESSION and RECLAIM evidence tuples", () => {
  const f = fixture();
  expect(c.validateOrchestrationEventBinding(f.journal.events[0], []).ok).toBe(true);
  expect(c.validateOrchestrationEventBinding(f.journal.events[1], []).ok).toBe(true);
  expect(c.validateOrchestrationEventBinding(f.journal.events.at(-1), []).ok).toBe(true);
  expect(
    c.validateOrchestrationEventBinding(f.journal.events[0], [
      { kind: "STDOUT", bytes: new Uint8Array() },
    ]).ok,
  ).toBe(false);

  const moved = copy(f.journal.events[1]!);
  moved.output.health.step.inputDigest = "0".repeat(64);
  expect(c.parseOrchestrationEvent(moved).ok).toBe(true);
  expect(c.validateOrchestrationEventBinding(moved, []).ok).toBe(false);

  const movedContext = copy(f.journal.events.at(-1)!);
  movedContext.output.context.cyclePlan.request.cycleId = id(90);
  expect(c.validateOrchestrationEventBinding(movedContext, []).ok).toBe(false);
});

test("closes event phase/output/null matrices, evidence rows, ordinals and fields", () => {
  const f = fixture();
  const started = f.journal.events[0]!;
  const terminal = f.journal.events[1]!;
  for (const mutant of [
    { ...started, output: terminal.output },
    {
      ...started,
      retainedEvidence: [
        { byteLength: "0", contentDigest: hash(""), encoding: "RAW_BYTES", kind: "STDOUT" },
      ],
    },
    { ...terminal, output: null },
    { ...terminal, phase: "OTHER" },
    { ...terminal, position: "01" },
    { ...terminal, position: "4096" },
    { ...terminal, extra: null },
    { ...terminal, step: { ...terminal.step, kind: "project.snapshot" } },
    { ...terminal, output: { ...terminal.output, extra: null } },
  ])
    expect(c.parseOrchestrationEvent(mutant).ok).toBe(false);

  const evidence = Array.from({ length: 7 }, (_, index) => ({
    byteLength: "0",
    contentDigest: hash(String(index)),
    encoding: "RAW_BYTES",
    kind: "STDOUT",
  }));
  expect(c.parseOrchestrationEvent({ ...terminal, retainedEvidence: evidence }).ok).toBe(false);
  expect(
    c.parseOrchestrationEvent({
      ...terminal,
      retainedEvidence: [
        { byteLength: "1048577", contentDigest: hash("x"), encoding: "RAW_BYTES", kind: "STDOUT" },
      ],
    }).ok,
  ).toBe(false);
});

test("reduces deterministic complete preimages and refuses missing, substituted or invalid evidence members", () => {
  const f = fixture();
  const a = c.reduceEventJournal(f.journal, f.evidence);
  const b = c.reduceEventJournal(copy(f.journal), copy(f.evidence));
  expect(a).toEqual(b);
  expect(a).toMatchObject({
    ok: true,
    value: {
      cycleId: id(2),
      outcome: { kind: "RUNNING" },
      pendingStep: null,
      schemaVersion: "reduced-state/v1",
      steps: expect.arrayContaining([
        expect.objectContaining({ ordinal: "1", state: "TERMINAL" }),
        expect.objectContaining({ ordinal: "13", state: "SKIPPED" }),
        expect.objectContaining({ ordinal: "14", state: "TERMINAL" }),
      ]),
    },
  });
  expect(c.reduceEventJournal(f.journal, f.evidence.slice(1)).ok).toBe(false);
  const substituted = copy(f.evidence);
  substituted[0] = [{ kind: "STDOUT", bytes: Uint8Array.of(1) }];
  expect(c.reduceEventJournal(f.journal, substituted).ok).toBe(false);

  const broken = copy(f.journal);
  broken.events[3]!.output.skip.step.inputDigest = "0".repeat(64);
  expect(c.parseEventJournal(broken).ok).toBe(true);
  const unknown = c.reduceEventJournal(broken, f.evidence);
  expect(unknown).toMatchObject({ ok: true, value: { outcome: { kind: "UNKNOWN" } } });
});

test("represents JOURNAL_ONLY restart evidence without inventing rerun authority", () => {
  const f = fixture();
  const startedOnly = { ...f.journal, events: f.journal.events.slice(0, 1) };
  const state = c.reduceEventJournal(startedOnly, [[]]);
  expect(state).toMatchObject({
    ok: true,
    value: {
      outcome: { kind: "RUNNING" },
      pendingStep: expect.objectContaining({ ordinal: "1" }),
      steps: [expect.objectContaining({ ordinal: "1", primaryDigest: null, state: "STARTED" })],
    },
  });
  const bytes = c.serializeEventJournal(startedOnly);
  const suffix = concat(bytes, Uint8Array.of(0, 0, 0, 9, 0x7b));
  const inspection = c.inspectEventJournalBytes(suffix);
  expect(inspection).toMatchObject({ ok: true, value: { partialSuffix: true } });
  if (!inspection.ok) throw new Error(inspection.issues.join(","));
  expect(c.reduceEventJournal(inspection.value.journal, [[]])).toEqual(state);
  expect(c.planEventJournalAppend(suffix, f.journal.events[1]).ok).toBe(false);
});

test("closes reduced outcome cells, nulls, exact density and 1-15 bounds", () => {
  const f = fixture();
  const baseState = {
    bindings: emptyBindings(),
    cycleId: id(2),
    cyclePlanDigest: f.journal.cyclePlanDigest,
    journalPrefixDigest: prefixHash(f.bytes),
    outcome: { kind: "RUNNING" },
    pendingStep: null,
    schemaVersion: "reduced-state/v1",
    steps: [],
  };
  expect(c.parseReducedState(baseState).ok).toBe(true);
  for (const reason of [
    "EARLIER_UNKNOWN",
    "PREFIX_CONFLICT",
    "OUTPUT_CONFLICT",
    "RESOURCE_UNKNOWN",
    "HISTORY_UNPROVEN",
  ])
    expect(c.parseReducedState({ ...baseState, outcome: { kind: "UNKNOWN", reason } }).ok).toBe(
      true,
    );

  const rows = (count: number, started = count) =>
    Array.from({ length: count }, (_, index) => ({
      dependentDigests: index === 8 ? ["c".repeat(64), "d".repeat(64)] : [],
      ordinal: String(index + 1),
      primaryDigest: index + 1 === started ? null : "a".repeat(64),
      state: index + 1 === started ? "STARTED" : index === 1 ? "SKIPPED" : "TERMINAL",
      stepDigest: "b".repeat(64),
    }));
  const pendingState = (ordinal: number, outcome: Row) => {
    const pending = step(ordinal, "e".repeat(64), "f".repeat(64));
    const values = rows(ordinal, ordinal);
    values[ordinal - 1]!.stepDigest = c.computeRoutineStepDigest(pending);
    return { ...baseState, outcome, pendingStep: pending, steps: values };
  };
  expect(
    c.parseReducedState(pendingState(8, { attemptId: id(50), kind: "WAITING_WORKER" })).ok,
  ).toBe(true);
  expect(
    c.parseReducedState(pendingState(10, { kind: "WAITING_REVIEW", requestDigest: "a".repeat(64) }))
      .ok,
  ).toBe(true);
  expect(
    c.parseReducedState(pendingState(11, { dispositionDigest: null, kind: "WAITING_ACTION" })).ok,
  ).toBe(true);
  expect(
    c.parseReducedState(pendingState(10, { attemptId: id(50), kind: "WAITING_WORKER" })).ok,
  ).toBe(false);
  expect(
    c.parseReducedState(pendingState(8, { kind: "WAITING_REVIEW", requestDigest: "a".repeat(64) }))
      .ok,
  ).toBe(false);
  expect(
    c.parseReducedState(pendingState(10, { dispositionDigest: null, kind: "WAITING_ACTION" })).ok,
  ).toBe(false);
  const terminalStep = step(15, "e".repeat(64), "f".repeat(64));
  const terminalizing = pendingState(15, {
    kind: "TERMINALIZING",
    terminalStepDigest: c.computeRoutineStepDigest(terminalStep),
  });
  expect(c.parseReducedState(terminalizing).ok).toBe(true);
  expect(
    c.parseReducedState({
      ...terminalizing,
      outcome: { kind: "TERMINALIZING", terminalStepDigest: "a".repeat(64) },
    }).ok,
  ).toBe(false);
  for (const kind of ["COMPLETED", "COMPLETED_NO_WORK", "FAILED_KNOWN"])
    expect(
      c.parseReducedState({
        ...baseState,
        outcome: { cycleReceiptDigest: "c".repeat(64), kind },
        steps: rows(15, 0).map((row) => ({
          ...row,
          primaryDigest: "a".repeat(64),
          state: "TERMINAL",
        })),
      }).ok,
    ).toBe(true);

  // Waiting is restart evidence for an exact in-flight STARTED step, never a
  // free-standing advisory cell.
  expect(
    c.parseReducedState({ ...baseState, outcome: { attemptId: id(50), kind: "WAITING_WORKER" } })
      .ok,
  ).toBe(false);
  expect(
    c.parseReducedState({
      ...baseState,
      outcome: { kind: "WAITING_REVIEW", requestDigest: "a".repeat(64) },
    }).ok,
  ).toBe(false);
  expect(
    c.parseReducedState({
      ...baseState,
      outcome: { dispositionDigest: null, kind: "WAITING_ACTION" },
    }).ok,
  ).toBe(false);
  expect(
    c.parseReducedState({ ...baseState, outcome: { kind: "UNKNOWN", reason: "OTHER" } }).ok,
  ).toBe(false);
  expect(c.parseReducedState({ ...baseState, outcome: { kind: "RUNNING", extra: null } }).ok).toBe(
    false,
  );

  const pending = step(1, c.computeCycleRequestDigest(f.b.cyclePlan.request), null);
  const pendingRow = {
    dependentDigests: [],
    ordinal: "1",
    primaryDigest: null,
    state: "STARTED",
    stepDigest: c.computeRoutineStepDigest(pending),
  };
  expect(c.parseReducedState({ ...baseState, pendingStep: pending, steps: [pendingRow] }).ok).toBe(
    true,
  );
  expect(
    c.parseReducedState({
      ...baseState,
      pendingStep: pending,
      steps: [{ ...pendingRow, primaryDigest: "a".repeat(64) }],
    }).ok,
  ).toBe(false);
  expect(
    c.parseReducedState({
      ...baseState,
      steps: Array.from({ length: 16 }, (_, i) => ({
        dependentDigests: [],
        ordinal: String(i + 1),
        primaryDigest: "a".repeat(64),
        state: "TERMINAL",
        stepDigest: "b".repeat(64),
      })),
    }).ok,
  ).toBe(false);
});

test("constructs receipt only from STARTED15 terminalizing state and final replay stays acyclic", () => {
  const f = terminalCycle();
  expect(c.parseCycleReceipt(f.receipt).ok).toBe(true);
  expect(c.serializeContract("cycle-receipt/v1", f.receipt)).toEqual({
    bytes: canonical(f.receipt),
    digest: framedHash("cycle-receipt/v1", f.receipt),
    ok: true,
  });
  expect(c.serializeContract("reduced-state/v1", f.terminalizing.value)).toEqual({
    bytes: canonical(f.terminalizing.value),
    digest: framedHash("reduced-state/v1", f.terminalizing.value),
    ok: true,
  });
  expect(c.parseCycleReceipt({ ...f.receipt, steps: [] }).ok).toBe(false);
  expect(
    c.parseCycleReceipt({
      ...f.receipt,
      steps: f.receipt.steps.map((row: Row, index: number) =>
        index === 14 ? { ...row, state: "TERMINAL", primaryDigest: "a".repeat(64) } : row,
      ),
    }).ok,
  ).toBe(false);
  expect(
    c.parseCycleReceipt({
      ...f.receipt,
      steps: f.receipt.steps.map((row: Row, index: number) =>
        index === 0 ? { ...row, state: "SKIPPED" } : row,
      ),
    }).ok,
  ).toBe(false);
  expect(
    c.parseCycleReceipt({
      ...f.receipt,
      steps: f.receipt.steps.map((row: Row, index: number) =>
        index === 13 ? { ...row, state: "SKIPPED" } : row,
      ),
    }).ok,
  ).toBe(false);
  expect(c.validateCycleReceiptBinding(f.startedJournal, f.terminalizing.value, f.receipt).ok).toBe(
    true,
  );
  expect(f.receipt.reducedStateDigest).toBe(c.computeReducedStateDigest(f.terminalizing.value));
  expect(f.receipt.startedJournalPrefixDigest).toBe(f.terminalizing.value.journalPrefixDigest);
  expect(f.receipt.terminalStepDigest).toBe(c.computeRoutineStepDigest(f.step15));
  expect(JSON.stringify(f.receipt)).not.toContain(
    c.computeOrchestrationEventDigest(f.journal.events.at(-1)),
  );
  expect(JSON.stringify(f.receipt)).not.toContain(prefixHash(f.bytes));

  const final = c.reduceEventJournal(f.journal, f.evidence);
  expect(final).toMatchObject({
    ok: true,
    value: {
      outcome: { cycleReceiptDigest: c.computeCycleReceiptDigest(f.receipt), kind: "FAILED_KNOWN" },
      pendingStep: null,
      steps: expect.arrayContaining([
        expect.objectContaining({ ordinal: "15", state: "TERMINAL" }),
      ]),
    },
  });
  for (const mutant of [
    { ...f.receipt, cycleId: id(90) },
    { ...f.receipt, sessionId: id(90) },
    { ...f.receipt, reducedStateDigest: "0".repeat(64) },
    { ...f.receipt, startedJournalPrefixDigest: "0".repeat(64) },
    { ...f.receipt, terminalStepDigest: "0".repeat(64) },
    { ...f.receipt, outcome: "COMPLETED" },
    { ...f.receipt, reclaimOutcome: "RECLAIMED" },
    { ...f.receipt, steps: f.receipt.steps.slice(0, 14) },
  ])
    expect(c.validateCycleReceiptBinding(f.startedJournal, f.terminalizing.value, mutant).ok).toBe(
      false,
    );
});

test("routes all four families through generic parse, canonical bytes and serialization", () => {
  const f = terminalCycle();
  const reduced = f.terminalizing.value;
  const rows = [
    ["orchestration-event/v1", f.journal.events[0]],
    ["event-journal/v1", f.journal],
    ["reduced-state/v1", reduced],
    ["cycle-receipt/v1", f.receipt],
  ] as const;
  for (const [schema, value] of rows) {
    expect(c.parseContract(schema, value).ok).toBe(true);
    expect(c.parseJournalContract(schema, value)?.ok).toBe(true);
    const serialized = c.serializeContract(schema, value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error(serialized.issues.join(","));
    expect(c.parseCanonicalContractBytes(schema, serialized.bytes).ok).toBe(true);
    const shared = new Uint8Array(new SharedArrayBuffer(serialized.bytes.byteLength));
    shared.set(serialized.bytes);
    expect(c.parseCanonicalContractBytes(schema, shared).ok).toBe(false);
  }
});

test("refuses malformed JSON, duplicate keys, BOM, CRLF, truncation and hostile inputs", () => {
  const f = terminalCycle();
  const eventText = new TextDecoder().decode(canonical(f.journal.events[0]));
  const duplicate = enc.encode(
    eventText.replace("{", '{"cycleId":"01900000-0000-7000-8000-000000000002",'),
  );
  for (const bytes of [
    enc.encode("{"),
    enc.encode(eventText.replace("\n", "\r\n")),
    concat(Uint8Array.of(0xef, 0xbb, 0xbf), canonical(f.journal.events[0])),
    duplicate,
  ])
    expect(c.parseCanonicalContractBytes("orchestration-event/v1", bytes).ok).toBe(false);
  expect(c.parseEventJournalBytes(f.bytes.slice(0, -1)).ok).toBe(false);

  let executed = 0;
  const trap = () => {
    executed += 1;
    throw new Error("caller code executed");
  };
  const hostile = new Proxy({}, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  for (const parse of [
    c.parseOrchestrationEvent,
    c.parseEventJournal,
    c.parseReducedState,
    c.parseCycleReceipt,
  ])
    expect(parse(hostile).ok).toBe(false);
  expect(c.inspectEventJournalBytes(hostile).ok).toBe(false);
  expect(c.planEventJournalAppend(hostile, hostile).ok).toBe(false);
  expect(executed).toBe(0);
});
