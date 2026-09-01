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

function rechain(journal: Row) {
  const header = {
    cycleId: journal.cycleId,
    cyclePlan: journal.cyclePlan,
    cyclePlanDigest: journal.cyclePlanDigest,
    genesisDigest: journal.genesisDigest,
    schemaVersion: journal.schemaVersion,
    sessionId: journal.sessionId,
  };
  let bytes = concat(
    enc.encode("OPJ1"),
    Uint8Array.of(0),
    uint(canonical(header).byteLength, 4),
    canonical(header),
  );
  let prior: Row | null = null;
  let pending: Row | null = null;
  for (const [index, event] of journal.events.entries()) {
    if (event.phase === "STARTED") {
      event.step.predecessorJournalDigest = event.step.ordinal === "1" ? null : prefixHash(bytes);
      pending = copy(event.step);
    } else {
      event.step = copy(pending);
      if (event.output.kind === "SKIP") event.output.skip.step = copy(pending);
      if (event.output.kind === "SESSION") event.output.health.step = copy(pending);
      pending = null;
    }
    event.position = String(index);
    event.previousEventDigest = prior === null ? null : eventHash(prior);
    event.previousPrefixDigest = prefixHash(bytes);
    const eventBytes = canonical(event);
    bytes = concat(bytes, uint(eventBytes.byteLength, 4), eventBytes);
    prior = event;
  }
  return bytes;
}

function producerRecords() {
  const b = base();
  const facts = {
    adapterConfigurationDigest: c.canonicalDigest(b.configuration),
    frontier: [
      {
        capabilityNames: ["work.read"],
        immutableSubjectDigest: "a".repeat(64),
        readiness: "READY",
        workId: id(10),
      },
    ],
    frontierDigest: "",
    observationId: id(11),
    observedAt: "2026-08-31T01:00:00.000Z",
    projectId: b.configuration.projectId,
    schemaVersion: "project-facts/v1",
    state: "COMPLETE",
  };
  facts.frontierDigest = c.canonicalDigest(facts.frontier);
  const policyFacts = {
    adapterConfigurationDigest: c.canonicalDigest(b.configuration),
    decisions: [{ capabilityName: "work.read", trip: "NO_TRIP" }],
    observationId: id(12),
    observedAt: "2026-08-31T01:00:00.001Z",
    policyVersion: "1.2.3",
    projectFactsDigest: c.canonicalDigest(facts),
    projectId: b.configuration.projectId,
    schemaVersion: "project-breaker-facts/v1",
    state: "COMPLETE",
  };
  const descriptor = {
    abi: "orchestration-module/v1",
    actions: [
      {
        actionKind: "fixture.inspect",
        capabilityName: "work.read",
        requestedRole: "review",
        reviewRequired: false,
        workerRequired: true,
      },
    ],
    compatibility: [
      {
        adapterId: b.configuration.adapterId,
        adapterVersion: b.configuration.adapterVersion,
        engineVersion: b.configuration.engineVersion,
        policyVersion: policyFacts.policyVersion,
      },
    ],
    dispatchCatalog: c.dispatchDirectiveKinds
      .filter((kind) => kind !== "OPERATOR_ACTION")
      .map((directiveKind) => ({
        actionKind: "fixture.inspect",
        capabilityName: "work.read",
        code: directiveKind.toLowerCase(),
        directiveKind,
        planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
        templateId: `template.${directiveKind.toLowerCase()}`,
      })),
    dispositionCodes: ["decision.done"],
    inputSchemas: ["module-plan-input/v1"],
    moduleId: "fixture.module",
    moduleVersion: "1.0.0",
    outputSchemas: ["module-action-plan/v1", "module-no-action/v1"],
    schemaVersion: "module-descriptor/v1",
  };
  const reviewSubject = {
    authorAttemptId: id(13),
    authorCycleId: id(14),
    baseSource: {
      adapterId: b.configuration.adapterId,
      projectId: b.configuration.projectId,
      revision: "fixture.seed.v1",
    },
    result: { kind: "TREE", treeDigest: "b".repeat(64) },
    schemaVersion: "worker-result-subject/v1",
    terminalReceiptDigest: "c".repeat(64),
  };
  const input = {
    adapterConfiguration: b.configuration,
    configurationProvenance: b.configurationProvenance,
    cycleRequest: b.cyclePlan.request,
    descriptor,
    policyFacts,
    projectFacts: facts,
    reviewSubject,
    schemaVersion: "module-plan-input/v1",
  };
  const core = {
    actionKind: "fixture.inspect",
    capabilityName: "work.read",
    immutableSubjectDigest: c.computeWorkerResultSubjectDigest(reviewSubject),
    moduleDescriptorDigest: c.computeModuleDescriptorDigest(descriptor),
    requestedRole: "review",
    schemaVersion: "dispatch-action-core/v1",
  };
  const action = {
    actionCore: core,
    dispatchBrief: {
      action: {
        actionCoreDigest: c.computeDispatchActionCoreDigest(core),
        actionKind: core.actionKind,
        capabilityName: core.capabilityName,
        immutableSubjectDigest: core.immutableSubjectDigest,
        moduleDescriptorDigest: core.moduleDescriptorDigest,
        schemaVersion: "dispatch-brief-action/v1",
      },
      directives: c.dispatchDirectiveKinds.map((directiveKind) => ({
        code: directiveKind === "OPERATOR_ACTION" ? null : directiveKind.toLowerCase(),
        directiveKind,
        presence: directiveKind === "OPERATOR_ACTION" ? "ABSENT" : "PRESENT",
        schemaVersion: "dispatch-brief-directive/v1",
        subjectDigest: core.immutableSubjectDigest,
      })),
      footprint: [
        {
          access: "READ",
          resourceIdentityDigest: core.immutableSubjectDigest,
          schemaVersion: "dispatch-brief-resource/v1",
        },
      ],
      role: "review",
      schemaVersion: "dispatch-brief/v1",
    },
    inputDigest: c.computeModulePlanInputDigest(input),
    schemaVersion: "module-action-plan/v1",
    workId: null,
  };
  const identity = {
    capabilityNames: ["work.read"],
    hostRendererArtifactDigest: "d".repeat(64),
    schemaVersion: "worker-host-identity/v1",
  };
  const mapping = [
    {
      ...identity,
      schemaVersion: "worker-host-renderer-artifact/v1",
      workerHostIdentityDigest: c.computeWorkerHostIdentityDigest(identity),
    },
  ];
  const route = {
    actionPlanDigest: c.computeModuleActionPlanDigest(action),
    hostMappingDigest: c.computeRouteMappingDigest(mapping),
    outcome: { kind: "SELECTED", workerHostIdentityDigest: mapping[0]!.workerHostIdentityDigest },
    schemaVersion: "route-selection/v1",
  };
  const observation = {
    adapterConfigurationDigest: c.canonicalDigest(b.configuration),
    kind: "REVIEW",
    observationId: id(15),
    observedAt: "2026-08-31T01:00:00.002Z",
    result: { kind: "AVAILABLE", subject: copy(reviewSubject) },
  };
  const preflight = {
    actionPlanDigest: c.computeModuleActionPlanDigest(action),
    observationDigest: c.computeProjectPreflightObservationDigest(observation),
    outcome: { kind: "ELIGIBLE" },
    routeDigest: c.computeRouteSelectionDigest(route),
    schemaVersion: "project-preflight/v1",
  };
  const planHealth = {
    holderSessionId: b.cyclePlan.request.sessionRequest.sessionId,
    leaseState: "HELD_FRESH",
    observedAt: "2026-08-31T01:00:00.003Z",
    outcome: "HEALTHY",
    reason: null,
    schemaVersion: "session-health/v1",
    step: null,
    targetSessionId: b.cyclePlan.request.sessionRequest.sessionId,
  };
  const reviewRequest = {
    packet: { brief: copy(action.dispatchBrief), evidence: [], subject: copy(reviewSubject) },
    reviewCycleId: b.cyclePlan.request.cycleId,
    schemaVersion: "review-request/v1",
  };
  const rendered = Uint8Array.from([0, 255, 65]);
  const streamOut = Uint8Array.from([255, 0]);
  const streamErr = Uint8Array.from([97]);
  const reference = (bytes: Uint8Array) => ({
    byteLength: String(bytes.byteLength),
    contentDigest: hash(bytes),
  });
  const dispatch = {
    actionPlanDigest: c.computeModuleActionPlanDigest(action),
    attemptId: id(16),
    outcome: {
      credentials: { kind: "NONE" },
      hostRendererArtifactDigest: mapping[0]!.hostRendererArtifactDigest,
      kind: "PLANNED",
      renderedInput: reference(rendered),
      resourceIntents: [],
      workerHostIdentityDigest: mapping[0]!.workerHostIdentityDigest,
    },
    preflightDigest: c.computeProjectPreflightDigest(preflight),
    reviewRequestDigest: c.computeReviewRequestDigest(reviewRequest),
    routeDigest: c.computeRouteSelectionDigest(route),
    schemaVersion: "dispatch-plan/v1",
    sessionHealthDigest: c.computeSessionHealthDigest(planHealth),
  };
  const launch = {
    attemptId: dispatch.attemptId,
    dispatchPlanDigest: c.computeDispatchPlanDigest(dispatch),
    observedAt: "2026-08-31T01:00:00.004Z",
    outcome: { kind: "LIVE" },
    ownership: "PUBLISHED",
    processes: {
      completeness: "COMPLETE",
      entries: [{ parentProcessId: null, processId: id(17), state: "LIVE" }],
    },
    resources: [],
    schemaVersion: "worker-launch-receipt/v1",
  };
  const terminal = {
    attemptId: dispatch.attemptId,
    capture: {
      stderr: { content: reference(streamErr), kind: "TRUNCATED" },
      stdout: { content: reference(streamOut), kind: "COMPLETE" },
    },
    dispatchPlanDigest: c.computeDispatchPlanDigest(dispatch),
    launchReceiptDigest: c.computeWorkerLaunchReceiptDigest(launch),
    observedAt: "2026-08-31T01:00:00.005Z",
    outcome: { exit: { kind: "EXIT_CODE", value: "0" }, kind: "EXITED" },
    processes: {
      completeness: "COMPLETE",
      entries: [{ parentProcessId: null, processId: id(17), state: "DEAD" }],
    },
    schemaVersion: "worker-terminal-receipt/v1",
  };
  const reviewIds = {
    packetDigest: c.computeReviewPacketDigest(reviewRequest.packet),
    requestDigest: c.computeReviewRequestDigest(reviewRequest),
    subjectDigest: c.computeWorkerResultSubjectDigest(reviewSubject),
  };
  const attempt = {
    ...reviewIds,
    attemptId: dispatch.attemptId,
    cycleId: b.cyclePlan.request.cycleId,
    dispatchPlanDigest: c.computeDispatchPlanDigest(dispatch),
    launchReceiptDigest: c.computeWorkerLaunchReceiptDigest(launch),
    result: {
      evidence: [{ byteLength: "0", contentDigest: hash("") }],
      kind: "SWEEP_COMPLETE",
    },
    schemaVersion: "review-attempt-result/v1",
    terminalReceiptDigest: c.computeWorkerTerminalReceiptDigest(terminal),
  };
  const authority = {
    ...reviewIds,
    outcome: {
      attemptResultDigest: c.computeReviewAttemptResultDigest(attempt),
      kind: "accepted",
    },
    schemaVersion: "review-authority/v1",
  };
  const dispositionInput = {
    actionPlan: copy(action),
    moduleInput: copy(input),
    preflight: copy(preflight),
    review: { attempt: copy(attempt), authority: copy(authority), request: copy(reviewRequest) },
    route: copy(route),
    skips: [],
    worker: {
      launch: copy(launch),
      plan: copy(dispatch),
      resultSubject: null,
      terminal: copy(terminal),
    },
  };
  const disposition = {
    actionPlanDigest: c.computeModuleActionPlanDigest(action),
    code: "decision.done",
    inputDigest: c.computeDispositionInputDigest(dispositionInput),
    outcome: { kind: "APPLY", operation: "PROJECT" },
    schemaVersion: "action-disposition/v1",
    subjectDigest: reviewIds.subjectDigest,
    subjectKind: "WORKER_RESULT",
  };
  const request = {
    actionPlanDigest: c.computeModuleActionPlanDigest(action),
    adapterConfigurationDigest: c.canonicalDigest(b.configuration),
    dispositionDigest: c.computeActionDispositionDigest(disposition),
    schemaVersion: "project-mutation-request/v1",
    sourceCycleId: b.cyclePlan.request.cycleId,
    subjectDigest: disposition.subjectDigest,
    subjectKind: disposition.subjectKind,
    transactionId: id(18),
  };
  const value = (bytes: string | null) =>
    bytes === null ? { kind: "ABSENT" } : { bytes, kind: "PRESENT" };
  const effects = [
    {
      after: value("00ff"),
      before: value(null),
      kind: "COMPARE_REPLACE",
      resourceId: "fixture.resource",
    },
  ];
  const observed = (n: number, values: Row[]) => ({
    adapterConfigurationDigest: c.canonicalDigest(b.configuration),
    observationId: id(20 + n),
    observedAt: `2026-08-31T01:00:0${6 + n}.000Z`,
    result: {
      kind: "COMPLETE",
      projectFacts: {
        ...copy(facts),
        observationId: id(30 + n),
        observedAt: `2026-08-31T01:00:0${6 + n}.000Z`,
      },
      resources: [{ resourceId: "fixture.resource", value: copy(values[0]) }],
    },
  });
  const dry = observed(1, [effects[0]!.before]);
  const before = observed(2, [effects[0]!.before]);
  const after = observed(3, [effects[0]!.after]);
  const intents = [{ owner: "ADAPTER", resourceIdentityDigest: "e".repeat(64) }];
  const mutationPlan = {
    observationDigest: c.computeProjectMutationObservationDigest(dry),
    outcome: { effects, kind: "PLANNED", resourceIntents: intents },
    requestDigest: c.computeProjectMutationRequestDigest(request),
    schemaVersion: "project-mutation-plan/v1",
    transactionId: request.transactionId,
  };
  const applyReceipt = {
    afterObservationDigest: c.computeProjectMutationObservationDigest(after),
    beforeObservationDigest: c.computeProjectMutationObservationDigest(before),
    completedEffectCount: "1",
    outcome: { kind: "APPLIED" },
    phase: "AFTER_WRITE",
    planDigest: c.computeProjectMutationPlanDigest(mutationPlan),
    requestDigest: c.computeProjectMutationRequestDigest(request),
    resources: [
      {
        ...intents[0],
        allocationId: id(40),
        ownerTransactionId: request.transactionId,
        state: "ALLOCATED",
      },
    ],
    schemaVersion: "project-apply-receipt/v1",
    transactionId: request.transactionId,
  };
  const breaker = {
    adapterConfigurationDigest: c.canonicalDigest(b.configuration),
    cycleId: b.cyclePlan.request.cycleId,
    cycleRequestDigest: c.computeCycleRequestDigest(b.cyclePlan.request),
    operations: [],
    policyFactsDigest: c.canonicalDigest(policyFacts),
    policyIdentity: {
      adapterId: b.configuration.adapterId,
      adapterVersion: b.configuration.adapterVersion,
      policyVersion: policyFacts.policyVersion,
    },
    priorReceiptDigest: null,
    result: { capabilities: [{ capabilityName: "work.read", state: "CLOSED" }], kind: "KNOWN" },
    schemaVersion: "breaker-receipt/v1",
    sessionId: b.cyclePlan.request.sessionRequest.sessionId,
  };
  return {
    action,
    after,
    applyReceipt,
    attempt,
    authority,
    b,
    before,
    breaker,
    dispatch,
    disposition,
    dispositionInput,
    dry,
    facts,
    input,
    launch,
    mapping,
    mutationPlan,
    observation,
    planHealth,
    policyFacts,
    preflight,
    rendered,
    request,
    reviewRequest,
    route,
    streamErr,
    streamOut,
    terminal,
  };
}

function producerJournal() {
  const p = producerRecords();
  const cyclePlanDigest = c.computeCyclePlanDigest(p.b.cyclePlan);
  const genesisInput = {
    cycleId: id(2),
    cyclePlan: p.b.cyclePlan,
    cyclePlanDigest,
    sessionId: id(3),
  };
  const genesisDigest = domain("event-journal-genesis/v1", canonical(genesisInput));
  const header = { ...genesisInput, genesisDigest, schemaVersion: "event-journal/v1" };
  let bytes = concat(
    enc.encode("OPJ1"),
    Uint8Array.of(0),
    uint(canonical(header).byteLength, 4),
    canonical(header),
  );
  const events: Row[] = [],
    evidence: Row[][] = [];
  let prior: Row | null = null;
  const reference = (kind: string, raw: Uint8Array) => ({
    byteLength: String(raw.byteLength),
    contentDigest: hash(raw),
    encoding: "RAW_BYTES",
    kind,
  });
  const add = (
    phase: "STARTED" | "TERMINAL",
    current: Row,
    output: Row | null,
    suppliedEvidence: Row[] = [],
  ) => {
    const retainedEvidence = suppliedEvidence
      .map((entry) => reference(entry.kind, entry.bytes))
      .sort((left, right) => left.kind.localeCompare(right.kind));
    const supplied = suppliedEvidence
      .map((entry) => ({ bytes: entry.bytes, kind: entry.kind }))
      .sort((left, right) => left.kind.localeCompare(right.kind));
    const event = {
      cycleId: id(2),
      output,
      phase,
      position: String(events.length),
      previousEventDigest: prior === null ? null : eventHash(prior),
      previousPrefixDigest: prefixHash(bytes),
      retainedEvidence,
      schemaVersion: "orchestration-event/v1",
      step: copy(current),
    };
    const eventBytes = canonical(event);
    events.push(event);
    evidence.push(supplied);
    bytes = concat(bytes, uint(eventBytes.byteLength, 4), eventBytes);
    prior = event;
  };
  const outputs: Array<Row | null> = [
    null,
    {
      cyclePlan: p.b.cyclePlan,
      health: {
        ...copy(p.planHealth),
        step: step(1, c.computeCycleRequestDigest(p.b.cyclePlan.request), null),
      },
      kind: "SESSION",
    },
    { configuration: p.b.configuration, facts: p.facts, kind: "PROJECT_FACTS" },
    {
      configuration: p.b.configuration,
      cycleRequest: p.b.cyclePlan.request,
      kind: "BREAKER",
      policyFacts: p.policyFacts,
      prior: null,
      projectFacts: p.facts,
      provenance: p.b.configurationProvenance,
      receipt: p.breaker,
    },
    { input: p.input, kind: "MODULE", result: p.action },
    { action: p.action, input: p.input, kind: "ROUTE", mapping: p.mapping, route: p.route },
    {
      action: p.action,
      input: p.input,
      kind: "PREFLIGHT",
      mapping: p.mapping,
      observation: p.observation,
      preflight: p.preflight,
      route: p.route,
    },
    {
      action: p.action,
      cyclePlan: p.b.cyclePlan,
      health: p.planHealth,
      input: p.input,
      kind: "DISPATCH_PLAN",
      mapping: p.mapping,
      observation: p.observation,
      plan: p.dispatch,
      preflight: p.preflight,
      reviewRequest: p.reviewRequest,
      route: p.route,
    },
    { kind: "LAUNCH", launch: p.launch, plan: p.dispatch, terminal: null },
    {
      attempt: p.attempt,
      kind: "WORKER_TERMINAL",
      launch: p.launch,
      plan: p.dispatch,
      resultSubject: null,
      terminal: p.terminal,
    },
    {
      attempt: p.attempt,
      authority: p.authority,
      kind: "REVIEW_AUTHORITY",
      request: p.reviewRequest,
    },
    {
      disposition: p.disposition,
      followUp: null,
      input: p.dispositionInput,
      kind: "DISPOSITION",
    },
    {
      disposition: p.disposition,
      dispositionInput: p.dispositionInput,
      kind: "MUTATION_PLAN",
      observation: p.dry,
      plan: p.mutationPlan,
      request: p.request,
    },
    {
      afterObservation: p.after,
      beforeObservation: p.before,
      disposition: p.disposition,
      dispositionInput: p.dispositionInput,
      dryObservation: p.dry,
      expectedPlanDigest: c.computeProjectMutationPlanDigest(p.mutationPlan),
      kind: "PROJECT_APPLY",
      plan: p.mutationPlan,
      receipt: p.applyReceipt,
      request: p.request,
    },
  ];
  const inputs = [
    "",
    c.computeCycleRequestDigest(p.b.cyclePlan.request),
    c.canonicalDigest(p.b.configuration),
    c.canonicalDigest(p.facts),
    c.computeModulePlanInputDigest(p.input),
    c.computeModuleActionPlanDigest(p.action),
    c.computeRouteSelectionDigest(p.route),
    c.computeProjectPreflightDigest(p.preflight),
    c.computeDispatchPlanDigest(p.dispatch),
    c.computeWorkerLaunchReceiptDigest(p.launch),
    c.computeReviewAttemptResultDigest(p.attempt),
    c.computeDispositionInputDigest(p.dispositionInput),
    c.computeProjectMutationRequestDigest(p.request),
    c.computeProjectMutationPlanDigest(p.mutationPlan),
  ];
  const retained = (ordinal: number) => {
    if (ordinal === 7) return [{ bytes: p.rendered, kind: "RENDERED_INPUT" }];
    if ([9, 11, 12, 13].includes(ordinal))
      return [
        { bytes: p.streamErr, kind: "STDERR" },
        { bytes: p.streamOut, kind: "STDOUT" },
      ];
    return [];
  };
  for (let ordinal = 1; ordinal <= 13; ordinal += 1) {
    const current = step(ordinal, inputs[ordinal]!, ordinal === 1 ? null : prefixHash(bytes));
    if (ordinal === 1) outputs[1]!.health.step = copy(current);
    add("STARTED", current, null);
    add("TERMINAL", current, outputs[ordinal]!, retained(ordinal));
  }
  return {
    ...p,
    evidence,
    journal: { ...header, events },
    outputs,
  };
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
  expect(c.parseEventJournal(conflicting).ok).toBe(true);
  expect(c.reduceEventJournal(conflicting, f.evidence)).toMatchObject({
    ok: true,
    value: { outcome: { kind: "UNKNOWN", reason: "OUTPUT_CONFLICT" } },
  });
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

test("replays every concrete producer from PROJECT_FACTS through PROJECT_APPLY", () => {
  const p = producerJournal();
  expect(c.validateProjectFactsBinding(p.facts, p.b.configuration).ok).toBe(true);
  expect(
    c.validateBreakerReceiptBinding(
      p.b.configurationProvenance,
      p.b.configuration,
      p.b.cyclePlan.request,
      p.facts,
      p.policyFacts,
      null,
      p.breaker,
    ).ok,
  ).toBe(true);
  expect(c.validateModulePlanBinding(p.input, p.action).ok).toBe(true);
  expect(c.validateRouteSelectionBinding(p.input, p.action, p.mapping, p.route).ok).toBe(true);
  expect(
    c.validateProjectPreflightBinding(
      p.input,
      p.action,
      p.mapping,
      p.route,
      p.observation,
      p.preflight,
    ).ok,
  ).toBe(true);
  expect(
    c.validateDispatchPlanBinding(
      p.input,
      p.action,
      p.mapping,
      p.route,
      p.observation,
      p.preflight,
      p.b.cyclePlan,
      p.planHealth,
      p.reviewRequest,
      p.rendered,
      p.dispatch,
    ).ok,
  ).toBe(true);
  expect(c.validateWorkerLaunchReceiptBinding(p.dispatch, p.launch).ok).toBe(true);
  expect(
    c.validateWorkerTerminalReceiptBinding(
      p.dispatch,
      p.launch,
      p.streamOut,
      p.streamErr,
      p.terminal,
    ).ok,
  ).toBe(true);
  expect(c.validateReviewResultBinding(p.reviewRequest, p.attempt, p.authority).ok).toBe(true);
  expect(
    c.validateActionDispositionBinding(p.dispositionInput, p.streamOut, p.streamErr, p.disposition)
      .ok,
  ).toBe(true);
  expect(
    c.validateProjectMutationRequestBinding(
      p.dispositionInput,
      p.streamOut,
      p.streamErr,
      p.disposition,
      p.request,
    ).ok,
  ).toBe(true);
  expect(
    c.validateProjectMutationPlanBinding(
      p.dispositionInput,
      p.streamOut,
      p.streamErr,
      p.disposition,
      p.request,
      p.dry,
      p.mutationPlan,
    ).ok,
  ).toBe(true);
  expect(
    c.validateProjectApplyReceiptBinding(
      p.dispositionInput,
      p.streamOut,
      p.streamErr,
      p.disposition,
      p.request,
      p.dry,
      p.mutationPlan,
      c.computeProjectMutationPlanDigest(p.mutationPlan),
      p.before,
      p.after,
      p.applyReceipt,
    ).ok,
  ).toBe(true);

  expect(
    p.journal.events.filter((row) => row.phase === "TERMINAL").map((row) => row.output.kind),
  ).toEqual(c.eventOutputKinds.slice(0, 13));
  for (const [index, event] of p.journal.events.entries())
    expect(c.validateOrchestrationEventBinding(event, p.evidence[index]).ok).toBe(true);
  expect(c.reduceEventJournal(p.journal, p.evidence)).toMatchObject({
    ok: true,
    value: {
      bindings: {
        actionDigest: c.computeModuleActionPlanDigest(p.action),
        applyDigest: c.computeProjectApplyReceiptDigest(p.applyReceipt),
        mutationPlanDigest: c.computeProjectMutationPlanDigest(p.mutationPlan),
        reviewAuthorityDigest: c.computeReviewAuthorityDigest(p.authority),
        subjectDigest: p.authority.subjectDigest,
      },
      outcome: { kind: "RUNNING" },
      steps: expect.arrayContaining([
        expect.objectContaining({ ordinal: "2", state: "TERMINAL" }),
        expect.objectContaining({ ordinal: "13", state: "TERMINAL" }),
      ]),
    },
  });
});

test("derives WAITING states only from real dispatch, launch and review preimages", () => {
  const p = producerJournal();
  for (const [ordinal, outcome] of [
    [8, { attemptId: p.dispatch.attemptId, kind: "WAITING_WORKER" }],
    [9, { attemptId: p.dispatch.attemptId, kind: "WAITING_WORKER" }],
    [10, { kind: "WAITING_REVIEW", requestDigest: c.computeReviewRequestDigest(p.reviewRequest) }],
  ] as const) {
    const length = (ordinal - 1) * 2 + 1;
    expect(
      c.reduceEventJournal(
        { ...p.journal, events: p.journal.events.slice(0, length) },
        p.evidence.slice(0, length),
      ),
    ).toMatchObject({
      ok: true,
      value: { outcome, pendingStep: { ordinal: String(ordinal) } },
    });
  }
});

test("binds retained producer bytes and refuses byte, reference and encoding substitutions", () => {
  const p = producerJournal();
  for (const ordinal of [7, 9, 11, 12, 13]) {
    const index = ordinal * 2 - 1,
      event = p.journal.events[index]!,
      supplied = p.evidence[index]!;
    expect(c.validateOrchestrationEventBinding(event, supplied).ok).toBe(true);
    const movedBytes = copy(supplied);
    movedBytes[0]!.bytes = Uint8Array.of(88);
    expect(c.validateOrchestrationEventBinding(event, movedBytes).ok).toBe(false);

    const movedLength = copy(event);
    movedLength.retainedEvidence[0].byteLength = "0";
    expect(c.validateOrchestrationEventBinding(movedLength, supplied).ok).toBe(false);
    const movedDigest = copy(event);
    movedDigest.retainedEvidence[0].contentDigest = "0".repeat(64);
    expect(c.validateOrchestrationEventBinding(movedDigest, supplied).ok).toBe(false);
    const movedEncoding = copy(event);
    movedEncoding.retainedEvidence[0].encoding = "CANONICAL_JSON";
    expect(c.parseOrchestrationEvent(movedEncoding).ok).toBe(false);
  }
});

test("refuses individually valid producer substitutions that sever prior-output continuity", () => {
  const attacks = [
    {
      ordinal: 4,
      mutate(output: Row) {
        output.input.projectFacts.observationId = id(70);
        output.input.policyFacts.projectFactsDigest = c.canonicalDigest(output.input.projectFacts);
        output.result.inputDigest = c.computeModulePlanInputDigest(output.input);
      },
    },
    {
      ordinal: 5,
      mutate(output: Row) {
        output.input.descriptor.moduleVersion = "1.0.1";
        output.action.actionCore.moduleDescriptorDigest = c.computeModuleDescriptorDigest(
          output.input.descriptor,
        );
        output.action.dispatchBrief.action.moduleDescriptorDigest =
          output.action.actionCore.moduleDescriptorDigest;
        output.action.dispatchBrief.action.actionCoreDigest = c.computeDispatchActionCoreDigest(
          output.action.actionCore,
        );
        output.action.inputDigest = c.computeModulePlanInputDigest(output.input);
        output.route.actionPlanDigest = c.computeModuleActionPlanDigest(output.action);
      },
    },
    {
      ordinal: 7,
      mutate(output: Row) {
        output.observation.observationId = id(71);
        output.preflight.observationDigest = c.computeProjectPreflightObservationDigest(
          output.observation,
        );
        output.plan.preflightDigest = c.computeProjectPreflightDigest(output.preflight);
      },
    },
    {
      ordinal: 13,
      mutate(output: Row) {
        output.request.transactionId = id(72);
        output.plan.transactionId = output.request.transactionId;
        output.plan.requestDigest = c.computeProjectMutationRequestDigest(output.request);
        output.expectedPlanDigest = c.computeProjectMutationPlanDigest(output.plan);
        output.receipt.transactionId = output.request.transactionId;
        output.receipt.requestDigest = c.computeProjectMutationRequestDigest(output.request);
        output.receipt.planDigest = output.expectedPlanDigest;
        for (const resource of output.receipt.resources)
          resource.ownerTransactionId = output.request.transactionId;
      },
    },
  ];
  for (const attack of attacks) {
    const p = producerJournal();
    const startIndex = (attack.ordinal - 1) * 2,
      terminalIndex = startIndex + 1,
      output = p.journal.events[terminalIndex]!.output;
    attack.mutate(output);
    const inputDigests: Record<number, string> = {
      4: c.computeModulePlanInputDigest(output.input),
      5: c.computeModuleActionPlanDigest(output.action),
      7: c.computeProjectPreflightDigest(output.preflight),
      13: c.computeProjectMutationPlanDigest(output.plan),
    };
    p.journal.events[startIndex]!.step.inputDigest = inputDigests[attack.ordinal]!;
    rechain(p.journal);
    expect(
      c.validateOrchestrationEventBinding(
        p.journal.events[terminalIndex],
        p.evidence[terminalIndex],
      ).ok,
    ).toBe(true);
    expect(c.reduceEventJournal(p.journal, p.evidence)).toMatchObject({
      ok: true,
      value: { outcome: { kind: "UNKNOWN", reason: "OUTPUT_CONFLICT" } },
    });
  }
});

test("binds malformed mapping, preflight and mutation observations only through canonical evidence", () => {
  const p = producerJournal();
  const malformed = canonical({ unexpected: true });
  const observationCases = [
    {
      evidenceIndex: 0,
      event: {
        ...copy(p.journal.events[9]),
        output: {
          ...copy(p.outputs[5]!),
          mapping: null,
          route: {
            ...copy(p.route),
            hostMappingDigest: null,
            outcome: { kind: "UNKNOWN", reason: "MAPPING_INVALID" },
          },
        },
        retainedEvidence: [
          {
            byteLength: String(malformed.byteLength),
            contentDigest: hash(malformed),
            encoding: "CANONICAL_JSON",
            kind: "MAPPING_OBSERVATION",
          },
        ],
      },
      evidence: [{ bytes: malformed, kind: "MAPPING_OBSERVATION" }],
    },
    {
      evidenceIndex: 0,
      event: {
        ...copy(p.journal.events[11]),
        output: {
          ...copy(p.outputs[6]!),
          observation: null,
          preflight: {
            ...copy(p.preflight),
            observationDigest: null,
            outcome: { kind: "UNKNOWN", reason: "OBSERVATION_INVALID" },
          },
        },
        retainedEvidence: [
          {
            byteLength: String(malformed.byteLength),
            contentDigest: hash(malformed),
            encoding: "CANONICAL_JSON",
            kind: "PREFLIGHT_OBSERVATION",
          },
        ],
      },
      evidence: [{ bytes: malformed, kind: "PREFLIGHT_OBSERVATION" }],
    },
    {
      evidenceIndex: 0,
      event: {
        ...copy(p.journal.events[23]),
        output: {
          ...copy(p.outputs[12]!),
          observation: null,
          plan: {
            ...copy(p.mutationPlan),
            observationDigest: null,
            outcome: { kind: "UNKNOWN", reason: "OBSERVATION_INVALID" },
          },
        },
        retainedEvidence: [
          {
            byteLength: String(malformed.byteLength),
            contentDigest: hash(malformed),
            encoding: "CANONICAL_JSON",
            kind: "MUTATION_OBSERVATION",
          },
          ...copy(p.journal.events[23]!.retainedEvidence),
        ],
      },
      evidence: [
        { bytes: malformed, kind: "MUTATION_OBSERVATION" },
        ...p.evidence[23]!.map((entry) => ({ bytes: entry.bytes, kind: entry.kind })),
      ],
    },
  ];
  for (const row of observationCases) {
    expect(c.parseOrchestrationEvent(row.event).ok).toBe(true);
    expect(c.validateOrchestrationEventBinding(row.event, row.evidence).ok).toBe(true);
    const moved = copy(row.evidence);
    moved[row.evidenceIndex]!.bytes = canonical({ different: true });
    expect(c.validateOrchestrationEventBinding(row.event, moved).ok).toBe(false);
  }
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
  expect(c.reduceEventJournal(f.journal, substituted)).toMatchObject({
    ok: true,
    value: { outcome: { kind: "UNKNOWN", reason: "OUTPUT_CONFLICT" } },
  });

  const broken = copy(f.journal);
  broken.events[3]!.output.skip.step.inputDigest = "0".repeat(64);
  expect(c.parseEventJournal(broken).ok).toBe(false);
});

test("rejects a self-consistent skip chain whose input no longer names the prior terminal", () => {
  const f = fixture();
  const journal = copy(f.journal);
  journal.events[24]!.step.inputDigest = "0".repeat(64);
  rechain(journal);
  const reclaimOutput = journal.events[27]!.output;
  reclaimOutput.context.skips[11] = copy(journal.events[25]!.output.skip);
  reclaimOutput.receipt.contextDigest = c.computeResourceReclaimContextDigest(
    reclaimOutput.context,
  );
  journal.events[26]!.step.inputDigest = c.computeResourceReclaimContextDigest(
    reclaimOutput.context,
  );
  rechain(journal);
  expect(c.parseEventJournal(journal).ok).toBe(true);
  expect(c.reduceEventJournal(journal, f.evidence)).toMatchObject({
    ok: true,
    value: { outcome: { kind: "UNKNOWN", reason: "OUTPUT_CONFLICT" } },
  });
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

test("keeps early-terminal skip STARTED8, STARTED9 and STARTED10 prefixes RUNNING", () => {
  const f = fixture();
  for (const ordinal of [8, 9, 10]) {
    const eventCount = (ordinal - 1) * 2 + 1;
    const prefix = {
      ...f.journal,
      events: f.journal.events.slice(0, eventCount),
    };
    expect(c.reduceEventJournal(prefix, f.evidence.slice(0, eventCount))).toMatchObject({
      ok: true,
      value: {
        outcome: { kind: "RUNNING" },
        pendingStep: { ordinal: String(ordinal) },
        steps: expect.arrayContaining([
          expect.objectContaining({ ordinal: String(ordinal), state: "STARTED" }),
        ]),
      },
    });
  }
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
  const completeRows = rows(15, 0).map((row) => ({
    ...row,
    primaryDigest: "a".repeat(64),
    state: "TERMINAL",
  }));
  for (const ordinal of [1, 14, 15]) {
    const impossible = copy(completeRows);
    impossible[ordinal - 1]!.state = "SKIPPED";
    expect(c.parseReducedState({ ...baseState, steps: impossible }).ok).toBe(false);
  }
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
  expect(
    c.validateCycleReceiptBinding(f.startedJournal, f.terminalizing.value, f.receipt, f.evidence)
      .ok,
  ).toBe(true);
  const substitutedReplayEvidence = f.evidence.map((rows) => [...rows]);
  substitutedReplayEvidence[0] = [{ bytes: Uint8Array.of(1), kind: "STDOUT" }];
  expect(
    c.validateCycleReceiptBinding(
      f.startedJournal,
      f.terminalizing.value,
      f.receipt,
      substitutedReplayEvidence,
    ).ok,
  ).toBe(false);
  const stateMutants = [
    { ...f.terminalizing.value, cyclePlanDigest: "0".repeat(64) },
    { ...f.terminalizing.value, journalPrefixDigest: "0".repeat(64) },
    {
      ...f.terminalizing.value,
      bindings: { ...f.terminalizing.value.bindings, actionDigest: "0".repeat(64) },
    },
    {
      ...f.terminalizing.value,
      steps: f.terminalizing.value.steps.map((row: Row, index: number) =>
        index === 1 ? { ...row, primaryDigest: "0".repeat(64) } : row,
      ),
    },
  ];
  const movedPending = copy(f.terminalizing.value);
  movedPending.pendingStep.inputDigest = "0".repeat(64);
  movedPending.steps[14].stepDigest = c.computeRoutineStepDigest(movedPending.pendingStep);
  movedPending.outcome.terminalStepDigest = c.computeRoutineStepDigest(movedPending.pendingStep);
  stateMutants.push(movedPending);
  const foreignCycle = copy(f.terminalizing.value);
  foreignCycle.cycleId = id(90);
  foreignCycle.pendingStep.cycleId = id(90);
  foreignCycle.steps[14].stepDigest = c.computeRoutineStepDigest(foreignCycle.pendingStep);
  foreignCycle.outcome.terminalStepDigest = c.computeRoutineStepDigest(foreignCycle.pendingStep);
  stateMutants.push(foreignCycle);
  for (const state of stateMutants) {
    expect(c.parseReducedState(state).ok).toBe(true);
    const matching = {
      ...f.receipt,
      bindings: copy(state.bindings),
      reducedStateDigest: c.computeReducedStateDigest(state),
      startedJournalPrefixDigest: state.journalPrefixDigest,
      steps: copy(state.steps),
      terminalStepDigest: c.computeRoutineStepDigest(state.pendingStep),
    };
    expect(c.validateCycleReceiptBinding(f.startedJournal, state, matching, f.evidence).ok).toBe(
      false,
    );
  }
  const withoutStarted15 = {
    ...f.startedJournal,
    events: f.startedJournal.events.slice(0, -1),
  };
  expect(c.parseEventJournal(withoutStarted15).ok).toBe(true);
  expect(
    c.validateCycleReceiptBinding(withoutStarted15, f.terminalizing.value, f.receipt, f.evidence)
      .ok,
  ).toBe(false);

  const forgedStarted = copy(f.startedJournal);
  forgedStarted.events.at(-1)!.step.inputDigest = "0".repeat(64);
  const forgedBytes = rechain(forgedStarted);
  const forgedState = copy(f.terminalizing.value);
  forgedState.pendingStep = copy(forgedStarted.events.at(-1)!.step);
  forgedState.steps[14].stepDigest = c.computeRoutineStepDigest(forgedState.pendingStep);
  forgedState.outcome.terminalStepDigest = c.computeRoutineStepDigest(forgedState.pendingStep);
  forgedState.journalPrefixDigest = prefixHash(forgedBytes);
  const forgedReceipt = {
    ...f.receipt,
    bindings: copy(forgedState.bindings),
    reducedStateDigest: c.computeReducedStateDigest(forgedState),
    startedJournalPrefixDigest: forgedState.journalPrefixDigest,
    steps: copy(forgedState.steps),
    terminalStepDigest: c.computeRoutineStepDigest(forgedState.pendingStep),
  };
  expect(c.parseEventJournal(forgedStarted).ok).toBe(true);
  expect(c.parseReducedState(forgedState).ok).toBe(true);
  expect(c.parseCycleReceipt(forgedReceipt).ok).toBe(true);
  expect(
    c.validateCycleReceiptBinding(forgedStarted, forgedState, forgedReceipt, f.evidence).ok,
  ).toBe(false);

  const forgedFinal = copy(f.journal);
  forgedFinal.events[28]!.step = copy(forgedState.pendingStep);
  forgedFinal.events[29]!.step = copy(forgedState.pendingStep);
  forgedFinal.events[29]!.output.receipt = copy(forgedReceipt);
  rechain(forgedFinal);
  expect(c.parseEventJournal(forgedFinal).ok).toBe(true);
  const forgedReplay = c.reduceEventJournal(forgedFinal, f.evidence);
  expect(
    forgedReplay.ok &&
      ["COMPLETED", "COMPLETED_NO_WORK", "FAILED_KNOWN"].includes(forgedReplay.value.outcome.kind),
  ).toBe(false);
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
    expect(
      c.validateCycleReceiptBinding(f.startedJournal, f.terminalizing.value, mutant, f.evidence).ok,
    ).toBe(false);
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
