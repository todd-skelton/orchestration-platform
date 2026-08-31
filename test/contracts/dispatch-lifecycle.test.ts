import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as c from "../../packages/contracts/src/index.js";

const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fresh = () => JSON.parse(inputLiteral);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const subject = (index: number) => JSON.parse(subjectLiterals[index]!);
const targetDigest = (value: ReturnType<typeof fresh>) =>
  value.schemaVersion === "worker-result-subject/v1"
    ? c.computeWorkerResultSubjectDigest(value)
    : c.computeReleaseCandidateSubjectDigest(value);
function upstream(
  worker = true,
  review: unknown = null,
  input = fresh(),
  declaredRole = "observer",
) {
  input.reviewSubject = copy(review);
  const role = review === null ? declaredRole : "review";
  input.descriptor.actions[1].requestedRole = role;
  input.descriptor.dispatchCatalog = c.dispatchDirectiveKinds
    .filter((kind) => kind !== "OPERATOR_ACTION")
    .map((directiveKind) => ({
      actionKind: "fixture.inspect",
      capabilityName: "work.read",
      code: directiveKind.toLowerCase(),
      directiveKind,
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: `template.${directiveKind.toLowerCase()}`,
    }));
  const core = {
    actionKind: worker ? "fixture.inspect" : "fixture.direct",
    capabilityName: "work.read",
    immutableSubjectDigest:
      review === null
        ? input.projectFacts.frontier[0].immutableSubjectDigest
        : targetDigest(review),
    moduleDescriptorDigest: c.computeModuleDescriptorDigest(input.descriptor),
    requestedRole: role,
    schemaVersion: "dispatch-action-core/v1",
  };
  const plan = {
    actionCore: core,
    inputDigest: c.computeModulePlanInputDigest(input),
    schemaVersion: "module-action-plan/v1",
    workId: review === null ? input.projectFacts.frontier[0].workId : null,
    dispatchBrief: worker
      ? {
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
          role,
          schemaVersion: "dispatch-brief/v1",
        }
      : null,
  };
  const identity = {
    capabilityNames: ["work.read"],
    hostRendererArtifactDigest: "1".repeat(64),
    schemaVersion: "worker-host-identity/v1",
  };
  const mapping = worker
    ? [
        {
          ...identity,
          schemaVersion: "worker-host-renderer-artifact/v1",
          workerHostIdentityDigest: c.computeWorkerHostIdentityDigest(identity),
        },
      ]
    : null;
  const route = {
    actionPlanDigest: c.computeModuleActionPlanDigest(plan),
    hostMappingDigest: mapping === null ? null : c.computeRouteMappingDigest(mapping),
    outcome:
      mapping === null
        ? { kind: "NO_WORKER" }
        : { kind: "SELECTED", workerHostIdentityDigest: mapping[0]!.workerHostIdentityDigest },
    schemaVersion: "route-selection/v1",
  };
  expect(c.validateRouteSelectionBinding(input, plan, mapping, route).ok).toBe(true);
  return { input, plan, mapping, route };
}

const literal = (index = 0) => JSON.parse(goldens[index]!.text);
const processCensus = (state = "LIVE") => ({
  completeness: "COMPLETE",
  entries: [{ parentProcessId: null, processId: id(50), state }],
});
const emptyProcesses = () => ({ completeness: "COMPLETE", entries: [] });
const raw = () => Uint8Array.from([0, 255, 65]);
const ref = (bytes: Uint8Array) => ({
  byteLength: String(bytes.byteLength),
  contentDigest: hash(bytes),
});
function fixture(role = "observer", review: unknown = null): ReturnType<typeof fresh> {
  const a = upstream(true, review, fresh(), role);
  const observation =
    review === null
      ? { kind: "PROJECT", facts: { ...copy(a.input.projectFacts), observationId: id(90) } }
      : {
          kind: "REVIEW",
          adapterConfigurationDigest: c.canonicalDigest(a.input.adapterConfiguration),
          observationId: id(90),
          observedAt: "2026-08-31T01:00:00.000Z",
          result: { kind: "AVAILABLE", subject: copy(review) },
        };
  const preflight = {
    actionPlanDigest: c.computeModuleActionPlanDigest(a.plan),
    observationDigest: c.computeProjectPreflightObservationDigest(observation),
    outcome: { kind: "ELIGIBLE" },
    routeDigest: c.computeRouteSelectionDigest(a.route),
    schemaVersion: "project-preflight/v1",
  };
  const cyclePlan = {
    schemaVersion: "cycle-plan/v1",
    protocol: "routine-cycle/v1",
    request: copy(a.input.cycleRequest),
  };
  const sessionId = a.input.cycleRequest.sessionRequest.sessionId;
  const health = {
    schemaVersion: "session-health/v1",
    step: null,
    targetSessionId: sessionId,
    holderSessionId: sessionId,
    leaseState: "HELD_FRESH",
    observedAt: "2026-08-31T01:00:00.000Z",
    outcome: "HEALTHY",
    reason: null,
  };
  const request =
    review === null
      ? null
      : {
          packet: { brief: copy(a.plan.dispatchBrief), evidence: [], subject: copy(review) },
          reviewCycleId: a.input.cycleRequest.cycleId,
          schemaVersion: "review-request/v1",
        };
  const rendered = raw(),
    plan = literal();
  plan.actionPlanDigest = c.computeModuleActionPlanDigest(a.plan);
  plan.preflightDigest = c.computeProjectPreflightDigest(preflight);
  plan.routeDigest = c.computeRouteSelectionDigest(a.route);
  plan.sessionHealthDigest = c.computeSessionHealthDigest(health);
  plan.reviewRequestDigest = request === null ? null : c.computeReviewRequestDigest(request);
  plan.outcome.credentials = { kind: "NONE" };
  plan.outcome.hostRendererArtifactDigest = a.mapping![0]!.hostRendererArtifactDigest;
  plan.outcome.workerHostIdentityDigest = a.mapping![0]!.workerHostIdentityDigest;
  plan.outcome.renderedInput = ref(rendered);
  expect(
    c.validateProjectPreflightBinding(a.input, a.plan, a.mapping, a.route, observation, preflight)
      .ok,
  ).toBe(true);
  expect(c.parseCyclePlan(cyclePlan).ok).toBe(true);
  expect(c.parseSessionHealth(health).ok).toBe(true);
  return { a, observation, preflight, cyclePlan, health, request, rendered, plan };
}
const planBind = (f: ReturnType<typeof fixture>, plan: unknown = f.plan, ...bytes: unknown[]) =>
  c.validateDispatchPlanBinding(
    f.a.input,
    f.a.plan,
    f.a.mapping,
    f.a.route,
    f.observation,
    f.preflight,
    f.cyclePlan,
    f.health,
    f.request,
    bytes.length ? bytes[0] : f.rendered,
    plan,
  );
function launch(
  plan: ReturnType<typeof literal>,
  reason: string | null = null,
): ReturnType<typeof literal> {
  const value = literal(
    reason === null
      ? 8
      : 9 +
          ["ALLOCATION_REFUSED", "OWNERSHIP_REFUSED", "SPAWN_REFUSED", "STARTUP_EXITED"].indexOf(
            reason,
          ),
  );
  value.attemptId = plan.attemptId;
  value.dispatchPlanDigest = c.computeDispatchPlanDigest(plan);
  value.resources = plan.outcome.resourceIntents.map(
    (intent: ReturnType<typeof literal>, index: number) => ({
      ...copy(intent),
      allocationId: reason === "ALLOCATION_REFUSED" && index > 0 ? null : id(30 + index),
      ownerTransactionId: plan.attemptId,
      state: reason === "ALLOCATION_REFUSED" && index > 0 ? "NOT_ALLOCATED" : "ALLOCATED",
    }),
  );
  return value;
}
function terminal(
  plan: ReturnType<typeof literal>,
  started: ReturnType<typeof literal>,
  kind = "EXITED",
): ReturnType<typeof literal> {
  const value = literal(18);
  value.attemptId = plan.attemptId;
  value.dispatchPlanDigest = c.computeDispatchPlanDigest(plan);
  value.launchReceiptDigest = c.computeWorkerLaunchReceiptDigest(started);
  value.processes = copy(started.processes);
  for (const entry of value.processes.entries) entry.state = "DEAD";
  if (kind === "START_FAILED") {
    value.outcome = {
      kind,
      exit: started.outcome.reason === "STARTUP_EXITED" ? { kind: "EXIT_CODE", value: "1" } : null,
    };
    if (value.outcome.exit === null)
      value.capture = { stderr: { kind: "UNAVAILABLE" }, stdout: { kind: "UNAVAILABLE" } };
  }
  return value;
}
const stdout = () => Uint8Array.from([255, 0]),
  stderr = () => Uint8Array.from([97]);
const terminalBind = (plan: unknown, started: unknown, value: unknown, ...streams: unknown[]) =>
  c.validateWorkerTerminalReceiptBinding(
    plan,
    started,
    streams.length ? streams[0] : stdout(),
    streams.length ? streams[1] : stderr(),
    value,
  );
const parsers = {
  "dispatch-plan/v1": (value: unknown) => c.parseDispatchPlan(value),
  "worker-launch-receipt/v1": (value: unknown) => c.parseWorkerLaunchReceipt(value),
  "worker-terminal-receipt/v1": (value: unknown) => c.parseWorkerTerminalReceipt(value),
};
const digests = {
  "dispatch-plan/v1": (value: unknown) => c.computeDispatchPlanDigest(value),
  "worker-launch-receipt/v1": (value: unknown) => c.computeWorkerLaunchReceiptDigest(value),
  "worker-terminal-receipt/v1": (value: unknown) => c.computeWorkerTerminalReceiptDigest(value),
};

test("pins every plan/launch/terminal outcome cell to independent canonical bytes, full frames and hashes", () => {
  for (const golden of goldens) {
    const value = JSON.parse(golden.text),
      bytes = new TextEncoder().encode(golden.text);
    expect(parsers[golden.schema](value)).toEqual({ ok: true, value });
    expect(c.parseContract(golden.schema, value)).toEqual({ ok: true, value });
    expect(c.parseDispatchLifecycleContract(golden.schema, value)).toEqual({ ok: true, value });
    expect(c.serializeContract(golden.schema, value)).toEqual({
      ok: true,
      bytes,
      digest: golden.digest,
    });
    expect(digests[golden.schema](value)).toBe(golden.digest);
    expect(
      Buffer.from(c.framedBytes(golden.schema, [c.frame.canonical(value)])).toString("hex"),
    ).toBe(golden.frameHex);
    expect(hash(Buffer.from(golden.frameHex, "hex"))).toBe(golden.digest);
    expect(hash(golden.text)).not.toBe(golden.digest);
    expect(c.parseCanonicalContractBytes(golden.schema, bytes)).toEqual({ ok: true, value });
    expect(
      c.serializeContract(golden.schema, Object.fromEntries(Object.entries(value).reverse())),
    ).toEqual({ ok: true, bytes, digest: golden.digest });
    for (const text of [
      golden.text.trimEnd(),
      golden.text.replace(/\n$/, "\r\n"),
      "\ufeff" + golden.text,
      JSON.stringify(Object.fromEntries(Object.entries(value).reverse())) + "\n",
    ])
      expect(c.parseCanonicalContractBytes(golden.schema, new TextEncoder().encode(text)).ok).toBe(
        false,
      );
    const frame = Buffer.from(golden.frameHex, "hex"),
      prefix = Buffer.byteLength(`orchestration-platform\0${golden.schema}\0`);
    for (const offset of [0, prefix + 3, prefix + 4, frame.length - 1]) {
      const bad = Buffer.from(frame);
      bad[offset] = bad[offset]! ^ 1;
      expect(hash(bad)).not.toBe(golden.digest);
    }
  }
});

test("every new nested record closes required fields, enums, types and back-references", () => {
  const paths: Array<[number, readonly (string | number)[]]> = [
    ...[0, 1, 5, 8, 9, 13, 18, 20, 23, 24].flatMap(
      (index) =>
        [
          [index, []],
          [index, ["outcome"]],
        ] as Array<[number, readonly (string | number)[]]>,
    ),
    [0, ["outcome", "credentials"]],
    [0, ["outcome", "credentials", "references", 0]],
    [0, ["outcome", "renderedInput"]],
    [0, ["outcome", "resourceIntents", 0]],
    [8, ["processes"]],
    [8, ["processes", "entries", 0]],
    [8, ["resources", 0]],
    [18, ["capture"]],
    [18, ["capture", "stdout"]],
    [18, ["capture", "stdout", "content"]],
    [18, ["outcome", "exit"]],
    [23, ["outcome", "termination"]],
  ];
  const at = (value: ReturnType<typeof literal>, path: readonly (string | number)[]) => {
    for (const key of path) value = value[key];
    return value;
  };
  for (const [index, path] of paths) {
    const seed = literal(index),
      parse = parsers[goldens[index]!.schema];
    const extra = copy(seed);
    at(extra, path).extra = true;
    expect(parse(extra).ok).toBe(false);
    for (const key of Object.keys(at(seed, path))) {
      const missing = copy(seed);
      delete at(missing, path)[key];
      expect(parse(missing).ok).toBe(false);
      const wrong = copy(seed);
      at(wrong, path)[key] = true;
      expect(parse(wrong).ok).toBe(false);
      if (at(seed, path)[key] !== null) {
        const nil = copy(seed);
        at(nil, path)[key] = null;
        expect(parse(nil).ok).toBe(false);
      }
    }
  }
  for (const golden of goldens) {
    const value = JSON.parse(golden.text);
    expect(
      parsers[golden.schema]({ ...value, schemaVersion: golden.schema.replace("/v1", "/v2") }).ok,
    ).toBe(false);
    expect(parsers[golden.schema]({ ...value, terminalReceiptDigest: "a".repeat(64) }).ok).toBe(
      false,
    );
    expect(parsers[golden.schema]({ ...value, workerResultSubjectDigest: "a".repeat(64) }).ok).toBe(
      false,
    );
    for (const suffix of ["\n", "\r", "\u2028", "\u2029"])
      expect(parsers[golden.schema]({ ...value, attemptId: value.attemptId + suffix }).ok).toBe(
        false,
      );
    expect(
      parsers[golden.schema]({ ...value, outcome: { ...value.outcome, kind: "SUCCESS" } }).ok,
    ).toBe(false);
  }
});

test("all preparation roles bind actual eligible upstream records, inspection health and raw rendered bytes", () => {
  for (const [role, target] of [
    ["observer", null],
    ["implementation", null],
    ["review", subject(0)],
    ["review", subject(2)],
  ] as const) {
    const f = fixture(role, target);
    expect(planBind(f)).toEqual({ ok: true, value: f.plan });
    if (target !== null) {
      const sameAttempt = copy(f.plan);
      sameAttempt.attemptId = id(1);
      expect(planBind(f, sameAttempt).ok).toBe(
        target.schemaVersion === "release-candidate-subject/v1",
      );
    }
    for (const golden of goldens.slice(1, 8)) {
      const value = { ...f.plan, outcome: JSON.parse(golden.text).outcome };
      expect(planBind(f, value, null)).toEqual({ ok: true, value });
      expect(planBind(f, value, undefined).ok).toBe(false);
      expect(planBind(f, value, f.rendered).ok).toBe(false);
    }
  }
  const f = fixture();
  const inspection = copy(f.health);
  inspection.step = {
    cycleId: f.a.input.cycleRequest.cycleId,
    ordinal: "1",
    kind: "session.verify",
    inputDigest: c.computeCycleRequestDigest(f.a.input.cycleRequest),
    predecessorJournalDigest: null,
  };
  expect(c.parseSessionHealth(inspection).ok).toBe(true);
  expect(
    planBind(
      { ...f, health: inspection },
      { ...f.plan, sessionHealthDigest: c.computeSessionHealthDigest(inspection) },
    ).ok,
  ).toBe(false);
  for (const health of [
    { ...f.health, targetSessionId: null },
    { ...f.health, holderSessionId: id(99), targetSessionId: id(99) },
    { ...f.health, leaseState: "HELD_STALE", outcome: "REFUSED", reason: "FRESHNESS_EXPIRED" },
  ]) {
    expect(c.parseSessionHealth(health).ok).toBe(true);
    expect(
      planBind(
        { ...f, health },
        { ...f.plan, sessionHealthDigest: c.computeSessionHealthDigest(health) },
      ).ok,
    ).toBe(false);
  }
  const cyclePlan = copy(f.cyclePlan);
  cyclePlan.request.cycleId = id(98);
  expect(c.parseCyclePlan(cyclePlan).ok).toBe(true);
  expect(planBind({ ...f, cyclePlan }).ok).toBe(false);
  for (const field of ["actionPlanDigest", "preflightDigest", "routeDigest", "sessionHealthDigest"])
    expect(planBind(f, { ...f.plan, [field]: "9".repeat(64) }).ok).toBe(false);
  for (const field of ["hostRendererArtifactDigest", "workerHostIdentityDigest"]) {
    const value = copy(f.plan);
    value.outcome[field] = "9".repeat(64);
    expect(c.parseDispatchPlan(value).ok).toBe(true);
    expect(planBind(f, value).ok).toBe(false);
  }
});

test("preflight/route failure, workerless and substituted review requests cannot enter preparation", () => {
  const f = fixture();
  const reobserved = copy(f.observation);
  reobserved.facts.observationId = id(91);
  expect(c.parseProjectPreflightObservation(reobserved).ok).toBe(true);
  expect(planBind({ ...f, observation: reobserved }).ok).toBe(false);
  const staleAction = copy(f.a);
  staleAction.input.cycleRequest.cycleId = id(99);
  expect(c.parseModulePlanInput(staleAction.input).ok).toBe(true);
  expect(
    planBind({
      ...f,
      a: staleAction,
      cyclePlan: { ...f.cyclePlan, request: copy(staleAction.input.cycleRequest) },
    }).ok,
  ).toBe(false);
  const unavailable = {
    ...f.preflight,
    observationDigest: null,
    outcome: { kind: "UNKNOWN", reason: "OBSERVATION_UNAVAILABLE" },
  };
  expect(
    c.validateProjectPreflightBinding(
      f.a.input,
      f.a.plan,
      f.a.mapping,
      f.a.route,
      null,
      unavailable,
    ).ok,
  ).toBe(true);
  expect(
    planBind(
      { ...f, observation: null, preflight: unavailable },
      { ...f.plan, preflightDigest: c.computeProjectPreflightDigest(unavailable) },
    ).ok,
  ).toBe(false);
  const direct = upstream(false),
    observation = {
      kind: "PROJECT",
      facts: { ...copy(direct.input.projectFacts), observationId: id(90) },
    };
  const preflight = {
    ...f.preflight,
    actionPlanDigest: c.computeModuleActionPlanDigest(direct.plan),
    routeDigest: c.computeRouteSelectionDigest(direct.route),
    observationDigest: c.computeProjectPreflightObservationDigest(observation),
  };
  expect(
    c.validateProjectPreflightBinding(
      direct.input,
      direct.plan,
      null,
      direct.route,
      observation,
      preflight,
    ).ok,
  ).toBe(true);
  expect(
    planBind(
      {
        ...f,
        a: direct,
        observation,
        preflight,
        cyclePlan: { ...f.cyclePlan, request: direct.input.cycleRequest },
      },
      {
        ...f.plan,
        actionPlanDigest: c.computeModuleActionPlanDigest(direct.plan),
        routeDigest: c.computeRouteSelectionDigest(direct.route),
        preflightDigest: c.computeProjectPreflightDigest(preflight),
      },
    ).ok,
  ).toBe(false);
  const review = fixture("review", subject(0));
  const otherReview = fixture("review", subject(1));
  expect(c.parseReviewRequest(otherReview.request).ok).toBe(true);
  expect(
    planBind(
      { ...review, request: otherReview.request },
      { ...review.plan, reviewRequestDigest: c.computeReviewRequestDigest(otherReview.request) },
    ).ok,
  ).toBe(false);
  expect(
    planBind({ ...review, request: null }, { ...review.plan, reviewRequestDigest: null }).ok,
  ).toBe(false);
  expect(
    planBind(
      { ...f, request: review.request },
      { ...f.plan, reviewRequestDigest: c.computeReviewRequestDigest(review.request) },
    ).ok,
  ).toBe(false);
  for (const mutate of [
    (request: ReturnType<typeof literal>) => {
      request.reviewCycleId = id(99);
    },
    (request: ReturnType<typeof literal>) => {
      request.packet.brief.footprint[0].resourceIdentityDigest = "9".repeat(64);
    },
  ]) {
    const request = copy(review.request);
    mutate(request);
    expect(c.parseReviewRequest(request).ok).toBe(true);
    expect(
      planBind(
        { ...review, request },
        { ...review.plan, reviewRequestDigest: c.computeReviewRequestDigest(request) },
      ).ok,
    ).toBe(false);
  }
  expect(planBind(review, { ...review.plan, reviewRequestDigest: "9".repeat(64) }).ok).toBe(false);
});

test("credential claims and resource intents keep closed role/access, scalar and full census bounds", () => {
  const row = literal().outcome.credentials.references[0];
  expect(c.parseDispatchCredentialClaims({ kind: "NONE" }).ok).toBe(true);
  for (const role of ["observer", "review", "implementation"])
    for (const access of ["READ_ONLY", "PROJECT_MUTATION"])
      expect(
        c.parseDispatchCredentialClaims({
          kind: "REFERENCES",
          references: [{ ...row, role, access }],
        }).ok,
      ).toBe(access === "READ_ONLY" || role === "implementation");
  for (const generation of ["0", "9007199254740991", "9007199254740992", "00", "-1", "1.0", "1\n"])
    expect(
      c.parseDispatchCredentialClaims({ kind: "REFERENCES", references: [{ ...row, generation }] })
        .ok,
    ).toBe(["0", "9007199254740991"].includes(generation));
  for (const count of [0, 1, 256, 257]) {
    const references = Array.from({ length: count }, (_, index) => ({
      ...copy(row),
      credentialId: id(index + 100),
    }));
    expect(c.parseDispatchCredentialClaims({ kind: "REFERENCES", references }).ok).toBe(
      count > 0 && count <= 256,
    );
    const capabilityNames = Array.from(
      { length: count },
      (_, index) => `cap.a${String(index).padStart(3, "0")}`,
    );
    expect(
      c.parseDispatchCredentialClaims({
        kind: "REFERENCES",
        references: [{ ...row, capabilityNames }],
      }).ok,
    ).toBe(count > 0 && count <= 256);
    const value = literal();
    value.outcome.resourceIntents = Array.from({ length: count }, (_, index) => ({
      owner: "ADAPTER",
      resourceIdentityDigest: index.toString(16).padStart(64, "0"),
    }));
    expect(c.parseDispatchPlan(value).ok).toBe(count <= 256);
  }
  for (const capabilityNames of [
    ["work.read", "work.read"],
    ["work.write", "work.read"],
    ["A"],
    ["a".repeat(65)],
    ["work.read\n"],
  ])
    expect(
      c.parseDispatchCredentialClaims({
        kind: "REFERENCES",
        references: [{ ...row, capabilityNames }],
      }).ok,
    ).toBe(false);
  expect(c.parseDispatchCredentialClaims({ kind: "REFERENCES", references: [row, row] }).ok).toBe(
    false,
  );
  expect(c.parseDispatchCredentialClaims({ kind: "NONE", references: [] }).ok).toBe(false);
  const malformed = literal();
  malformed.outcome.resourceIntents.reverse();
  expect(c.parseDispatchPlan(malformed).ok).toBe(false);
  malformed.outcome.resourceIntents = [
    { owner: "HOST", resourceIdentityDigest: "1".repeat(64) },
    { owner: "HOST", resourceIdentityDigest: "1".repeat(64) },
  ];
  expect(c.parseDispatchPlan(malformed).ok).toBe(false);
  for (const role of ["observer", "implementation", "review"]) {
    const f = fixture(role, role === "review" ? subject(0) : null),
      value = copy(f.plan);
    value.outcome.credentials = { kind: "REFERENCES", references: [{ ...row, role }] };
    expect(planBind(f, value).ok).toBe(true); // Supplied reference consistency is not ISS-032 admission.
    value.outcome.credentials.references[0].role = role === "observer" ? "review" : "observer";
    expect(c.parseDispatchPlan(value).ok).toBe(true);
    expect(planBind(f, value).ok).toBe(false);
  }
});

test("raw content length/hash and byte identity are distinct from briefs, decoded text and absent input", () => {
  const f = fixture();
  for (const length of [0, 1, 1048576, 1048577]) {
    const bytes = new Uint8Array(length),
      reference = ref(bytes),
      value = copy(f.plan);
    value.outcome.renderedInput = reference;
    expect(c.parseDispatchContentReference(reference).ok).toBe(length <= 1048576);
    expect(c.parseDispatchPlan(value).ok).toBe(length > 0 && length <= 1048576);
    if (length <= 1048576) expect(c.computeDispatchContentReference(bytes)).toEqual(reference);
    else expect(() => c.computeDispatchContentReference(bytes)).toThrow();
    expect(planBind(f, value, bytes).ok).toBe(length > 0 && length <= 1048576);
  }
  for (const bytes of [null, undefined, [], new DataView(new ArrayBuffer(3)), new Uint16Array(3)])
    expect(planBind(f, f.plan, bytes).ok).toBe(false);
  const changed = raw();
  changed[0] = 1;
  expect(planBind(f, f.plan, changed).ok).toBe(false);
  const recoded = new TextEncoder().encode(new TextDecoder().decode(f.rendered));
  expect(planBind(f, f.plan, recoded).ok).toBe(false);
  const subset = copy(f.plan);
  subset.outcome.renderedInput.contentDigest = c.canonicalDigest(f.a.plan.dispatchBrief);
  expect(planBind(f, subset).ok).toBe(false);
  for (const byteLength of ["00", "-1", "1.0", "1\n", "1048577"])
    expect(c.parseDispatchContentReference({ byteLength, contentDigest: "a".repeat(64) }).ok).toBe(
      false,
    );
});

test("launch preserves every requested allocation and the allocate-publish-spawn failure chronology", () => {
  const f = fixture();
  expect(planBind(f).ok).toBe(true);
  for (const reason of [
    null,
    "ALLOCATION_REFUSED",
    "OWNERSHIP_REFUSED",
    "SPAWN_REFUSED",
    "STARTUP_EXITED",
  ]) {
    const value = launch(f.plan, reason);
    expect(c.validateWorkerLaunchReceiptBinding(f.plan, value)).toEqual({ ok: true, value });
    for (const field of ["attemptId", "dispatchPlanDigest"])
      expect(
        c.validateWorkerLaunchReceiptBinding(f.plan, {
          ...value,
          [field]: field === "attemptId" ? id(99) : "9".repeat(64),
        }).ok,
      ).toBe(false);
    const missing = copy(value);
    missing.resources.pop();
    expect(c.parseWorkerLaunchReceipt(missing).ok).toBe(reason !== "ALLOCATION_REFUSED");
    expect(c.validateWorkerLaunchReceiptBinding(f.plan, missing).ok).toBe(false);
    const transaction = copy(value);
    transaction.resources[0].ownerTransactionId = id(99);
    expect(c.parseWorkerLaunchReceipt(transaction).ok).toBe(true);
    expect(c.validateWorkerLaunchReceiptBinding(f.plan, transaction).ok).toBe(false);
  }
  const live = launch(f.plan);
  for (const mutate of [
    (v: ReturnType<typeof literal>) => {
      v.ownership = "UNPUBLISHED";
    },
    (v: ReturnType<typeof literal>) => {
      v.resources[0].state = "UNKNOWN";
    },
    (v: ReturnType<typeof literal>) => {
      v.processes = emptyProcesses();
    },
    (v: ReturnType<typeof literal>) => {
      v.processes.entries[0].state = "DEAD";
    },
    (v: ReturnType<typeof literal>) => {
      v.processes.completeness = "UNKNOWN";
    },
  ]) {
    const value = copy(live);
    mutate(value);
    expect(c.parseWorkerLaunchReceipt(value).ok).toBe(false);
  }
  const prefix = launch(f.plan, "ALLOCATION_REFUSED");
  const firstRefusal = copy(prefix);
  firstRefusal.resources = firstRefusal.resources.map((row: ReturnType<typeof literal>) => ({
    ...row,
    state: "NOT_ALLOCATED",
    allocationId: null,
  }));
  expect(c.validateWorkerLaunchReceiptBinding(f.plan, firstRefusal).ok).toBe(true);
  prefix.resources[0].state = "NOT_ALLOCATED";
  prefix.resources[0].allocationId = null;
  prefix.resources[1].state = "ALLOCATED";
  prefix.resources[1].allocationId = id(31);
  expect(c.parseWorkerLaunchReceipt(prefix).ok).toBe(false);
  for (const reason of [
    "ALLOCATION_REFUSED",
    "OWNERSHIP_REFUSED",
    "SPAWN_REFUSED",
    "STARTUP_EXITED",
  ]) {
    const value = launch(f.plan, reason);
    value.ownership =
      reason === "ALLOCATION_REFUSED" || reason === "OWNERSHIP_REFUSED"
        ? "PUBLISHED"
        : "UNPUBLISHED";
    expect(c.parseWorkerLaunchReceipt(value).ok).toBe(false);
  }
  const none = copy(f.plan);
  none.outcome.resourceIntents = [];
  expect(c.validateWorkerLaunchReceiptBinding(none, launch(none)).ok).toBe(true);
  const noAlloc = launch(none, "ALLOCATION_REFUSED");
  expect(c.parseWorkerLaunchReceipt(noAlloc).ok).toBe(false);
});

test("allocation unknowns retain known IDs without inventing absence or dropping the intent census", () => {
  const f = fixture(),
    value = literal(13);
  value.dispatchPlanDigest = c.computeDispatchPlanDigest(f.plan);
  expect(c.validateWorkerLaunchReceiptBinding(f.plan, value).ok).toBe(true);
  for (const state of ["NOT_ALLOCATED", "ALLOCATED", "UNKNOWN"])
    for (const allocationId of [null, id(80)]) {
      const changed = copy(value);
      changed.resources[0] = { ...changed.resources[0], state, allocationId };
      expect(c.parseWorkerLaunchReceipt(changed).ok).toBe(
        state === "UNKNOWN" ||
          (state === "NOT_ALLOCATED" ? allocationId === null : allocationId !== null),
      );
    }
  const duplicate = launch(f.plan);
  duplicate.resources[1].allocationId = duplicate.resources[0].allocationId;
  expect(c.parseWorkerLaunchReceipt(duplicate).ok).toBe(false);
  for (const field of ["owner", "resourceIdentityDigest"]) {
    const changed = copy(value);
    changed.resources[0][field] = field === "owner" ? "HOST" : "9".repeat(64);
    changed.resources.sort((a: ReturnType<typeof literal>, b: ReturnType<typeof literal>) =>
      `${a.owner}:${a.resourceIdentityDigest}` < `${b.owner}:${b.resourceIdentityDigest}` ? -1 : 1,
    );
    expect(c.parseWorkerLaunchReceipt(changed).ok).toBe(true);
    expect(c.validateWorkerLaunchReceiptBinding(f.plan, changed).ok).toBe(false);
  }
  for (const count of [0, 1, 256, 257]) {
    const plan = copy(f.plan);
    plan.outcome.resourceIntents = Array.from({ length: Math.min(count, 256) }, (_, n) => ({
      owner: "HOST",
      resourceIdentityDigest: n.toString(16).padStart(64, "0"),
    }));
    const started = launch(plan);
    started.resources = Array.from({ length: count }, (_, n) => ({
      allocationId: id(n + 100),
      owner: "HOST",
      ownerTransactionId: plan.attemptId,
      resourceIdentityDigest: n.toString(16).padStart(64, "0"),
      state: "ALLOCATED",
    }));
    expect(c.parseWorkerLaunchReceipt(started).ok).toBe(count <= 256);
    if (count <= 256) expect(c.validateWorkerLaunchReceiptBinding(plan, started).ok).toBe(true);
  }
});

test("process censuses enforce rooted acyclic identities, closed states and 0/1/256/257 bounds", () => {
  for (const count of [0, 1, 256, 257]) {
    const value = {
      completeness: "COMPLETE",
      entries: Array.from({ length: count }, (_, n) => ({
        parentProcessId: n === 0 ? null : id(100),
        processId: id(n + 100),
        state: "LIVE",
      })),
    };
    expect(c.parseDispatchProcessCensus(value).ok).toBe(count <= 256);
  }
  for (const completeness of ["COMPLETE", "UNKNOWN"])
    for (const state of ["LIVE", "DEAD", "UNKNOWN"])
      expect(c.parseDispatchProcessCensus({ ...processCensus(state), completeness }).ok).toBe(
        completeness === "UNKNOWN" || state !== "UNKNOWN",
      );
  const base = literal(8).processes;
  for (const mutate of [
    (v: ReturnType<typeof literal>) => {
      v.entries.push(copy(v.entries[0]));
    },
    (v: ReturnType<typeof literal>) => {
      v.entries.reverse();
    },
    (v: ReturnType<typeof literal>) => {
      v.entries[1].parentProcessId = null;
    },
    (v: ReturnType<typeof literal>) => {
      v.entries[0].parentProcessId = id(51);
    },
    (v: ReturnType<typeof literal>) => {
      v.entries[1].parentProcessId = id(99);
    },
    (v: ReturnType<typeof literal>) => {
      v.entries[1].parentProcessId = id(51);
    },
    (v: ReturnType<typeof literal>) => {
      v.entries = new Array(1);
    },
  ]) {
    const value = copy(base);
    mutate(value);
    expect(c.parseDispatchProcessCensus(value).ok).toBe(false);
  }
  const cycle = {
    completeness: "UNKNOWN",
    entries: [
      { processId: id(50), parentProcessId: null, state: "UNKNOWN" },
      { processId: id(51), parentProcessId: id(52), state: "UNKNOWN" },
      { processId: id(52), parentProcessId: id(51), state: "UNKNOWN" },
    ],
  };
  expect(c.parseDispatchProcessCensus(cycle).ok).toBe(false);
});

test("known startup failures bind an acyclic launch/terminal pair and never smuggle a created child into no-child captures", () => {
  const f = fixture();
  for (const reason of [
    "ALLOCATION_REFUSED",
    "OWNERSHIP_REFUSED",
    "SPAWN_REFUSED",
    "STARTUP_EXITED",
  ]) {
    const started = launch(f.plan, reason),
      ended = terminal(f.plan, started, "START_FAILED"),
      noChild = reason !== "STARTUP_EXITED";
    expect(
      terminalBind(f.plan, started, ended, noChild ? null : stdout(), noChild ? null : stderr()),
    ).toEqual({ ok: true, value: ended });
    const wrongExit = copy(ended);
    wrongExit.outcome.exit = noChild ? { kind: "EXIT_CODE", value: "0" } : null;
    expect(
      terminalBind(f.plan, started, wrongExit, noChild ? null : stdout(), noChild ? null : stderr())
        .ok,
    ).toBe(false);
    if (noChild) {
      const captured = copy(ended);
      captured.capture.stdout = { kind: "COMPLETE", content: ref(new Uint8Array()) };
      expect(terminalBind(f.plan, started, captured, new Uint8Array(), null).ok).toBe(false);
      const invented = copy(ended);
      invented.processes = processCensus("DEAD");
      expect(terminalBind(f.plan, started, invented, null, null).ok).toBe(false);
    } else {
      const extra = copy(ended);
      extra.processes.entries.push({ parentProcessId: id(51), processId: id(52), state: "DEAD" });
      expect(c.parseWorkerTerminalReceipt(extra).ok).toBe(true);
      expect(terminalBind(f.plan, started, extra).ok).toBe(false);
    }
    const premature = copy(ended);
    premature.outcome = { kind: "EXITED", exit: { kind: "EXIT_CODE", value: "0" } };
    expect(
      terminalBind(f.plan, started, premature, noChild ? null : stdout(), noChild ? null : stderr())
        .ok,
    ).toBe(false);
  }
});

test("exit and failed-live termination preserve the original process graph and conservative chronology", () => {
  const f = fixture(),
    started = launch(f.plan),
    ended = terminal(f.plan, started);
  expect(terminalBind(f.plan, started, ended)).toEqual({ ok: true, value: ended });
  const descendant = copy(ended);
  descendant.processes.entries.push({ parentProcessId: id(51), processId: id(52), state: "DEAD" });
  expect(terminalBind(f.plan, started, descendant).ok).toBe(true);
  const alive = copy(ended);
  alive.outcome = {
    kind: "TERMINATION_FAILED_LIVE",
    termination: { elapsedMilliseconds: "1000", limitMilliseconds: "1000" },
  };
  alive.processes.entries[1].state = "LIVE";
  expect(terminalBind(f.plan, started, alive).ok).toBe(true); // A dead root with a live retained child is not vacancy.
  for (const mutate of [
    (v: ReturnType<typeof literal>) => {
      v.processes.entries.pop();
    },
    (v: ReturnType<typeof literal>) => {
      v.processes.entries[0].processId = id(49);
      v.processes.entries[1].parentProcessId = id(49);
    },
    (v: ReturnType<typeof literal>) => {
      v.processes.entries[1].parentProcessId = null;
      v.processes.entries[0].parentProcessId = id(51);
    },
  ]) {
    const changed = copy(ended);
    mutate(changed);
    expect(c.parseWorkerTerminalReceipt(changed).ok).toBe(true);
    expect(terminalBind(f.plan, started, changed).ok).toBe(false);
  }
  const partiallyDead = copy(started);
  partiallyDead.processes.entries[1].state = "DEAD";
  const revived = copy(alive);
  revived.launchReceiptDigest = c.computeWorkerLaunchReceiptDigest(partiallyDead);
  expect(terminalBind(f.plan, partiallyDead, revived).ok).toBe(false);
  const early = copy(ended);
  early.observedAt = "2026-08-31T00:59:59.999Z";
  expect(terminalBind(f.plan, started, early).ok).toBe(false);
  early.outcome = { kind: "UNKNOWN", reason: "OBSERVATION_INVALID" };
  expect(terminalBind(f.plan, started, early).ok).toBe(true);
  for (const reason of [
    "OBSERVATION_UNAVAILABLE",
    "IDENTITY_CONFLICT",
    "HANDLE_LOST",
    "PROCESS_TREE_UNPROVEN",
    "EXIT_UNPROVEN",
  ]) {
    const contradicted = { ...early, outcome: { kind: "UNKNOWN", reason } };
    expect(c.parseWorkerTerminalReceipt(contradicted).ok).toBe(true);
    expect(terminalBind(f.plan, started, contradicted).ok).toBe(false);
  }
  for (const field of ["attemptId", "dispatchPlanDigest", "launchReceiptDigest"])
    expect(
      terminalBind(f.plan, started, {
        ...ended,
        [field]: field === "attemptId" ? id(99) : "9".repeat(64),
      }).ok,
    ).toBe(false);
  for (const [elapsedMilliseconds, limitMilliseconds, ok] of [
    ["1", "1", true],
    ["86400000", "60000", true],
    ["0", "1", false],
    ["86400001", "1", false],
    ["1", "0", false],
    ["60001", "60001", false],
    ["9", "10", false],
  ] as const) {
    const value = copy(alive);
    value.outcome.termination = { elapsedMilliseconds, limitMilliseconds };
    expect(c.parseWorkerTerminalReceipt(value).ok).toBe(ok);
  }
});

test("separate capture arms bind actual raw streams and preserve exit despite incomplete capture", () => {
  const f = fixture(),
    started = launch(f.plan),
    ended = terminal(f.plan, started);
  for (const out of ["COMPLETE", "TRUNCATED", "UNAVAILABLE"])
    for (const err of ["COMPLETE", "TRUNCATED", "UNAVAILABLE"]) {
      const value = copy(ended);
      value.capture = {
        stdout: out === "UNAVAILABLE" ? { kind: out } : { kind: out, content: ref(stdout()) },
        stderr: err === "UNAVAILABLE" ? { kind: err } : { kind: err, content: ref(stderr()) },
      };
      expect(
        terminalBind(
          f.plan,
          started,
          value,
          out === "UNAVAILABLE" ? null : stdout(),
          err === "UNAVAILABLE" ? null : stderr(),
        ).ok,
      ).toBe(true);
      if (out === "UNAVAILABLE")
        expect(
          terminalBind(f.plan, started, value, undefined, err === "UNAVAILABLE" ? null : stderr())
            .ok,
        ).toBe(false);
    }
  expect(terminalBind(f.plan, started, ended, stderr(), stdout()).ok).toBe(false);
  for (const stream of ["stdout", "stderr"])
    for (const field of ["byteLength", "contentDigest"]) {
      const value = copy(ended);
      value.capture[stream].content[field] = field === "byteLength" ? "0" : "9".repeat(64);
      expect(terminalBind(f.plan, started, value).ok).toBe(false);
    }
  for (const length of [0, 1, 1048576, 1048577]) {
    const bytes = new Uint8Array(length),
      value = copy(ended);
    value.capture.stdout = { kind: "COMPLETE", content: ref(bytes) };
    expect(terminalBind(f.plan, started, value, bytes, stderr()).ok).toBe(length <= 1048576);
  }
  for (const [kind, value, ok] of [
    ["EXIT_CODE", "0", true],
    ["EXIT_CODE", "4294967295", true],
    ["EXIT_CODE", "4294967296", false],
    ["EXIT_CODE", "00", false],
    ["SIGNAL", "SIGA", true],
    ["SIGNAL", "SIG" + "A".repeat(16), true],
    ["SIGNAL", "SIG" + "A".repeat(17), false],
    ["SIGNAL", "SIGTERM\n", false],
    ["SIGNAL", "sigterm", false],
  ] as const)
    expect(c.parseWorkerExitCause({ kind, value }).ok).toBe(ok);
});

test("unknown launch/terminal retains claims without granting finality or process absence", () => {
  const f = fixture(),
    unknown = literal(13);
  unknown.dispatchPlanDigest = c.computeDispatchPlanDigest(f.plan);
  expect(c.validateWorkerLaunchReceiptBinding(f.plan, unknown).ok).toBe(true);
  const ended = terminal(f.plan, unknown);
  ended.outcome = { kind: "UNKNOWN", reason: "HANDLE_LOST" };
  ended.observedAt = null;
  ended.processes = copy(unknown.processes);
  expect(terminalBind(f.plan, unknown, ended).ok).toBe(true);
  const falseDeath = copy(ended);
  falseDeath.outcome = { kind: "EXITED", exit: { kind: "EXIT_CODE", value: "0" } };
  falseDeath.observedAt = "2026-08-31T01:00:01.000Z";
  falseDeath.processes = processCensus("DEAD");
  expect(terminalBind(f.plan, unknown, falseDeath).ok).toBe(false);
  const noChild = launch(f.plan, "SPAWN_REFUSED"),
    uncertain = terminal(f.plan, noChild, "START_FAILED");
  uncertain.outcome = { kind: "UNKNOWN", reason: "PROCESS_TREE_UNPROVEN" };
  uncertain.processes = { ...processCensus("UNKNOWN"), completeness: "UNKNOWN" };
  expect(terminalBind(f.plan, noChild, uncertain, null, null).ok).toBe(true);
  const lost = literal(24);
  lost.dispatchPlanDigest = c.computeDispatchPlanDigest(f.plan);
  lost.launchReceiptDigest = c.computeWorkerLaunchReceiptDigest(launch(f.plan));
  lost.processes = { completeness: "UNKNOWN", entries: [] };
  expect(terminalBind(f.plan, launch(f.plan), lost, null, null).ok).toBe(false); // Known process IDs cannot disappear even under UNKNOWN.
});

test("hostile records and raw byte impostors refuse without invoking supplied code", () => {
  let calls = 0;
  for (const [index, parse] of [
    [0, c.parseDispatchPlan],
    [8, c.parseWorkerLaunchReceipt],
    [18, c.parseWorkerTerminalReceipt],
  ] as const) {
    const getter = literal(index);
    Object.defineProperty(getter, "attemptId", {
      enumerable: true,
      get() {
        calls++;
        return id(9);
      },
    });
    expect(parse(getter).ok).toBe(false);
    const proxy = new Proxy(literal(index), {
      ownKeys() {
        calls++;
        return [];
      },
    });
    expect(parse(proxy).ok).toBe(false);
    const symbol = literal(index);
    symbol[Symbol("extra")] = true;
    expect(parse(symbol).ok).toBe(false);
  }
  const f = fixture();
  const fake = Object.create(Uint8Array.prototype);
  Object.defineProperty(fake, "byteLength", {
    get() {
      calls++;
      return 3;
    },
  });
  const shared = new Uint8Array(new SharedArrayBuffer(3)),
    proxy = new Proxy(raw(), {
      get() {
        calls++;
        return undefined;
      },
    });
  for (const bytes of [fake, shared, proxy]) {
    expect(() => c.computeDispatchContentReference(bytes)).toThrow();
    expect(planBind(f, f.plan, bytes).ok).toBe(false);
    const started = launch(f.plan);
    expect(terminalBind(f.plan, started, terminal(f.plan, started), bytes, stderr()).ok).toBe(
      false,
    );
  }
  const backing = new ArrayBuffer(3),
    detached = new Uint8Array(backing);
  structuredClone(backing, { transfer: [backing] });
  expect(() => c.computeDispatchContentReference(detached)).toThrow();
  expect(calls).toBe(0);
});

// Independent stdlib-only canonical bytes, full frames and hashes for 8/10/12 outcome cells.
const goldens = [
  {
    schema: "dispatch-plan/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"credentials":{"kind":"REFERENCES","references":[{"access":"READ_ONLY","capabilityNames":["work.read"],"credentialId":"01900000-0000-7000-8000-00000000000a","generation":"0","referenceDigest":"3333333333333333333333333333333333333333333333333333333333333333","role":"observer"}]},"hostRendererArtifactDigest":"4444444444444444444444444444444444444444444444444444444444444444","kind":"PLANNED","renderedInput":{"byteLength":"3","contentDigest":"a90a10503fbfc95789ff38a1bb5039cb71869ab9c0eb1cb51c4a9099f2933c6b"},"resourceIntents":[{"owner":"ADAPTER","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111"},{"owner":"HOST","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222"}],"workerHostIdentityDigest":"5555555555555555555555555555555555555555555555555555555555555555"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0064697370617463682d706c616e2f763100000000010700000000000005227b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226f7574636f6d65223a7b2263726564656e7469616c73223a7b226b696e64223a225245464552454e434553222c227265666572656e636573223a5b7b22616363657373223a22524541445f4f4e4c59222c226361706162696c6974794e616d6573223a5b22776f726b2e72656164225d2c2263726564656e7469616c4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303061222c2267656e65726174696f6e223a2230222c227265666572656e6365446967657374223a2233333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333222c22726f6c65223a226f62736572766572227d5d7d2c22686f737452656e64657265724172746966616374446967657374223a2234343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434222c226b696e64223a22504c414e4e4544222c2272656e6465726564496e707574223a7b22627974654c656e677468223a2233222c22636f6e74656e74446967657374223a2261393061313035303366626663393537383966663338613162623530333963623731383639616239633065623163623531633461393039396632393333633662227d2c227265736f75726365496e74656e7473223a5b7b226f776e6572223a2241444150544552222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131227d2c7b226f776e6572223a22484f5354222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232227d5d2c22776f726b6572486f73744964656e74697479446967657374223a2235353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535227d2c22707265666c69676874446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657669657752657175657374446967657374223a6e756c6c2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2264697370617463682d706c616e2f7631222c2273657373696f6e4865616c7468446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d0a",
    digest: "a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742",
  },
  {
    schema: "dispatch-plan/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"kind":"REFUSED","reason":"PRECONDITION_MOVED"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0064697370617463682d706c616e2f763100000000010700000000000002037b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a22505245434f4e444954494f4e5f4d4f564544227d2c22707265666c69676874446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657669657752657175657374446967657374223a6e756c6c2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2264697370617463682d706c616e2f7631222c2273657373696f6e4865616c7468446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d0a",
    digest: "5ab04444808c92224c8cd5cd4b00d7d0175d3bb7a62cc0bb52b8fab5f6d3648b",
  },
  {
    schema: "dispatch-plan/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"kind":"REFUSED","reason":"RENDERING_REFUSED"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0064697370617463682d706c616e2f763100000000010700000000000002027b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a2252454e444552494e475f52454655534544227d2c22707265666c69676874446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657669657752657175657374446967657374223a6e756c6c2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2264697370617463682d706c616e2f7631222c2273657373696f6e4865616c7468446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d0a",
    digest: "4cf47eeeb9d56c6f84aac541a1f8f9ec739459518d06d257089e8273bb76d930",
  },
  {
    schema: "dispatch-plan/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"kind":"REFUSED","reason":"CREDENTIALS_REFUSED"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0064697370617463682d706c616e2f763100000000010700000000000002047b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a2243524544454e5449414c535f52454655534544227d2c22707265666c69676874446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657669657752657175657374446967657374223a6e756c6c2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2264697370617463682d706c616e2f7631222c2273657373696f6e4865616c7468446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d0a",
    digest: "428e2e3d9aadadd81222277ae43f0ae0c24f7e6b7062e8324b218befe471a207",
  },
  {
    schema: "dispatch-plan/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"kind":"REFUSED","reason":"RESOURCES_REFUSED"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0064697370617463682d706c616e2f763100000000010700000000000002027b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a225245534f55524345535f52454655534544227d2c22707265666c69676874446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657669657752657175657374446967657374223a6e756c6c2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2264697370617463682d706c616e2f7631222c2273657373696f6e4865616c7468446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d0a",
    digest: "6d36aa84b901809fe99da505658c898ec55bbae3f6bb07181488c16e4ff5af70",
  },
  {
    schema: "dispatch-plan/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"kind":"UNKNOWN","reason":"OBSERVATION_UNAVAILABLE"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0064697370617463682d706c616e2f763100000000010700000000000002087b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224f42534552564154494f4e5f554e415641494c41424c45227d2c22707265666c69676874446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657669657752657175657374446967657374223a6e756c6c2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2264697370617463682d706c616e2f7631222c2273657373696f6e4865616c7468446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d0a",
    digest: "609fc43230eac2396a0fde4ea979ce8cbc76cdfda144c0dc8525fc93b6922e9c",
  },
  {
    schema: "dispatch-plan/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"kind":"UNKNOWN","reason":"OBSERVATION_INVALID"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0064697370617463682d706c616e2f763100000000010700000000000002047b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224f42534552564154494f4e5f494e56414c4944227d2c22707265666c69676874446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657669657752657175657374446967657374223a6e756c6c2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2264697370617463682d706c616e2f7631222c2273657373696f6e4865616c7468446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d0a",
    digest: "d948f5021ff91eb6ad24748af2d81ff085124da02ed281764fe96844b45089e3",
  },
  {
    schema: "dispatch-plan/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"kind":"UNKNOWN","reason":"ADMISSION_UNPROVEN"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0064697370617463682d706c616e2f763100000000010700000000000002037b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a2241444d495353494f4e5f554e50524f56454e227d2c22707265666c69676874446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c2272657669657752657175657374446967657374223a6e756c6c2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2264697370617463682d706c616e2f7631222c2273657373696f6e4865616c7468446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d0a",
    digest: "9b096c0bca41fe1a8730b012481950f6492db20adb201a979219e7a35f4a9b0f",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":"2026-08-31T01:00:00.000Z","outcome":{"kind":"LIVE"},"ownership":"PUBLISHED","processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"LIVE"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"LIVE"}]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"ALLOCATED"},{"allocationId":"01900000-0000-7000-8000-00000000001f","owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"ALLOCATED"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f763100000000010700000000000004157b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a22323032362d30382d33315430313a30303a30302e3030305a222c226f7574636f6d65223a7b226b696e64223a224c495645227d2c226f776e657273686970223a225055424c4953484544222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a224c495645227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a224c495645227d5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22414c4c4f4341544544227d2c7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303166222c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22414c4c4f4341544544227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":"2026-08-31T01:00:00.000Z","outcome":{"kind":"START_FAILED","reason":"ALLOCATION_REFUSED"},"ownership":"UNPUBLISHED","processes":{"completeness":"COMPLETE","entries":[]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"ALLOCATED"},{"allocationId":null,"owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"NOT_ALLOCATED"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f763100000000010700000000000003487b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a22323032362d30382d33315430313a30303a30302e3030305a222c226f7574636f6d65223a7b226b696e64223a2253544152545f4641494c4544222c22726561736f6e223a22414c4c4f434154494f4e5f52454655534544227d2c226f776e657273686970223a22554e5055424c4953484544222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22414c4c4f4341544544227d2c7b22616c6c6f636174696f6e4964223a6e756c6c2c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a224e4f545f414c4c4f4341544544227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "f0e37ba3ba026065407c7ccfe0505928dac6ce66260f31a3a834f112c88e9b43",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":"2026-08-31T01:00:00.000Z","outcome":{"kind":"START_FAILED","reason":"OWNERSHIP_REFUSED"},"ownership":"UNPUBLISHED","processes":{"completeness":"COMPLETE","entries":[]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"ALLOCATED"},{"allocationId":"01900000-0000-7000-8000-00000000001f","owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"ALLOCATED"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f763100000000010700000000000003657b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a22323032362d30382d33315430313a30303a30302e3030305a222c226f7574636f6d65223a7b226b696e64223a2253544152545f4641494c4544222c22726561736f6e223a224f574e4552534849505f52454655534544227d2c226f776e657273686970223a22554e5055424c4953484544222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22414c4c4f4341544544227d2c7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303166222c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22414c4c4f4341544544227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "176dd1295240de3002c0781a8094d0a0bc886b69c92cb78e475fe52db367218e",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":"2026-08-31T01:00:00.000Z","outcome":{"kind":"START_FAILED","reason":"SPAWN_REFUSED"},"ownership":"PUBLISHED","processes":{"completeness":"COMPLETE","entries":[]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"ALLOCATED"},{"allocationId":"01900000-0000-7000-8000-00000000001f","owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"ALLOCATED"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f7631000000000107000000000000035f7b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a22323032362d30382d33315430313a30303a30302e3030305a222c226f7574636f6d65223a7b226b696e64223a2253544152545f4641494c4544222c22726561736f6e223a22535041574e5f52454655534544227d2c226f776e657273686970223a225055424c4953484544222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22414c4c4f4341544544227d2c7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303166222c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22414c4c4f4341544544227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "220072ea0d7d846a904cd611887b79113fc2333dc06fb8f8323e2f84eb735c10",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":"2026-08-31T01:00:00.000Z","outcome":{"kind":"START_FAILED","reason":"STARTUP_EXITED"},"ownership":"PUBLISHED","processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"DEAD"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"DEAD"}]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"ALLOCATED"},{"allocationId":"01900000-0000-7000-8000-00000000001f","owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"ALLOCATED"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f763100000000010700000000000004377b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a22323032362d30382d33315430313a30303a30302e3030305a222c226f7574636f6d65223a7b226b696e64223a2253544152545f4641494c4544222c22726561736f6e223a22535441525455505f455849544544227d2c226f776e657273686970223a225055424c4953484544222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a2244454144227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a2244454144227d5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22414c4c4f4341544544227d2c7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303166222c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22414c4c4f4341544544227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "f42257622810cddf068c2cf2aad41c74573826d5ac53a4f541e50efb5aa0bda6",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"OBSERVATION_UNAVAILABLE"},"ownership":"UNKNOWN","processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"}]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"UNKNOWN"},{"allocationId":null,"owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"UNKNOWN"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f763100000000010700000000000003827b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224f42534552564154494f4e5f554e415641494c41424c45227d2c226f776e657273686970223a22554e4b4e4f574e222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22554e4b4e4f574e227d2c7b22616c6c6f636174696f6e4964223a6e756c6c2c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22554e4b4e4f574e227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "5108becb457ae231144ea36c69c573a55ae396ab7d6cbc5fa9bfd57676793f55",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"OBSERVATION_INVALID"},"ownership":"UNKNOWN","processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"}]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"UNKNOWN"},{"allocationId":null,"owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"UNKNOWN"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f7631000000000107000000000000037e7b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224f42534552564154494f4e5f494e56414c4944227d2c226f776e657273686970223a22554e4b4e4f574e222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22554e4b4e4f574e227d2c7b22616c6c6f636174696f6e4964223a6e756c6c2c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22554e4b4e4f574e227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "19fba380cc52ea0940069550152b63faa205e6525007071e4bf0af3059ffd89b",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"IDENTITY_CONFLICT"},"ownership":"UNKNOWN","processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"}]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"UNKNOWN"},{"allocationId":null,"owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"UNKNOWN"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f7631000000000107000000000000037c7b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224944454e544954595f434f4e464c494354227d2c226f776e657273686970223a22554e4b4e4f574e222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22554e4b4e4f574e227d2c7b22616c6c6f636174696f6e4964223a6e756c6c2c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22554e4b4e4f574e227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "213b49dc2eb78e048d0322d3eec1859cac58655678e5fc35f893f95503d31adb",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"STARTUP_UNPROVEN"},"ownership":"UNKNOWN","processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"}]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"UNKNOWN"},{"allocationId":null,"owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"UNKNOWN"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f7631000000000107000000000000037b7b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22535441525455505f554e50524f56454e227d2c226f776e657273686970223a22554e4b4e4f574e222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22554e4b4e4f574e227d2c7b22616c6c6f636174696f6e4964223a6e756c6c2c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22554e4b4e4f574e227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "6ebdd25f0b70c2a0392ddb1859dfba2724317ae2b3ab9e0fdffc876867209178",
  },
  {
    schema: "worker-launch-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"HANDLE_LOST"},"ownership":"UNKNOWN","processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"}]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"UNKNOWN"},{"allocationId":null,"owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"UNKNOWN"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d6c61756e63682d726563656970742f763100000000010700000000000003767b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a2248414e444c455f4c4f5354227d2c226f776e657273686970223a22554e4b4e4f574e222c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d5d7d2c227265736f7572636573223a5b7b22616c6c6f636174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303165222c226f776e6572223a2241444150544552222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c227374617465223a22554e4b4e4f574e227d2c7b22616c6c6f636174696f6e4964223a6e756c6c2c226f776e6572223a22484f5354222c226f776e65725472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c227265736f757263654964656e74697479446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c227374617465223a22554e4b4e4f574e227d5d2c22736368656d6156657273696f6e223a22776f726b65722d6c61756e63682d726563656970742f7631227d0a",
    digest: "efcd3777bc91f5c1bc768c2a61bd9a996a48fd412c28839b47649f86ffccab12",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"content":{"byteLength":"1","contentDigest":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"},"kind":"TRUNCATED"},"stdout":{"content":{"byteLength":"2","contentDigest":"ea5dbf9596d187e9500f23e9a680109475341cf4e81f7e043f7d97152c10772f"},"kind":"COMPLETE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":"2026-08-31T01:00:01.000Z","outcome":{"exit":{"kind":"EXIT_CODE","value":"0"},"kind":"EXITED"},"processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"DEAD"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"DEAD"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000003b27b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b22636f6e74656e74223a7b22627974654c656e677468223a2231222c22636f6e74656e74446967657374223a2263613937383131326361316262646361666163323331623339613233646334646137383665666638313437633465373262393830373738356166656534386262227d2c226b696e64223a225452554e4341544544227d2c227374646f7574223a7b22636f6e74656e74223a7b22627974654c656e677468223a2232222c22636f6e74656e74446967657374223a2265613564626639353936643138376539353030663233653961363830313039343735333431636634653831663765303433663764393731353263313037373266227d2c226b696e64223a22434f4d504c455445227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f7574636f6d65223a7b2265786974223a7b226b696e64223a22455849545f434f4445222c2276616c7565223a2230227d2c226b696e64223a22455849544544227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a2244454144227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a2244454144227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "a5048514bb524f709b3eb4454f7bf7ab893981505c8accd05291f3a7487bce34",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"content":{"byteLength":"1","contentDigest":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"},"kind":"COMPLETE"},"stdout":{"kind":"UNAVAILABLE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":"2026-08-31T01:00:01.000Z","outcome":{"exit":{"kind":"SIGNAL","value":"SIGTERM"},"kind":"EXITED"},"processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"DEAD"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"DEAD"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000003477b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b22636f6e74656e74223a7b22627974654c656e677468223a2231222c22636f6e74656e74446967657374223a2263613937383131326361316262646361666163323331623339613233646334646137383665666638313437633465373262393830373738356166656534386262227d2c226b696e64223a22434f4d504c455445227d2c227374646f7574223a7b226b696e64223a22554e415641494c41424c45227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f7574636f6d65223a7b2265786974223a7b226b696e64223a225349474e414c222c2276616c7565223a225349475445524d227d2c226b696e64223a22455849544544227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a2244454144227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a2244454144227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "edd93fb3d10c3c993301c35d1ea997ca1eadef018e23b81d21395b5fea174bc0",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"kind":"UNAVAILABLE"},"stdout":{"kind":"UNAVAILABLE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"220072ea0d7d846a904cd611887b79113fc2333dc06fb8f8323e2f84eb735c10","observedAt":"2026-08-31T01:00:01.000Z","outcome":{"exit":null,"kind":"START_FAILED"},"processes":{"completeness":"COMPLETE","entries":[]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000001ea7b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b226b696e64223a22554e415641494c41424c45227d2c227374646f7574223a7b226b696e64223a22554e415641494c41424c45227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2232323030373265613064376438343661393034636436313138383762373931313366633233333364633036666238663833323365326638346562373335633130222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f7574636f6d65223a7b2265786974223a6e756c6c2c226b696e64223a2253544152545f4641494c4544227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "f218f3ea42aa532f1b95a4bb42211475899d2dd5d3b4e6159638504b48288140",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"content":{"byteLength":"1","contentDigest":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"},"kind":"TRUNCATED"},"stdout":{"content":{"byteLength":"2","contentDigest":"ea5dbf9596d187e9500f23e9a680109475341cf4e81f7e043f7d97152c10772f"},"kind":"COMPLETE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"f42257622810cddf068c2cf2aad41c74573826d5ac53a4f541e50efb5aa0bda6","observedAt":"2026-08-31T01:00:01.000Z","outcome":{"exit":{"kind":"EXIT_CODE","value":"1"},"kind":"START_FAILED"},"processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"DEAD"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"DEAD"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000003b87b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b22636f6e74656e74223a7b22627974654c656e677468223a2231222c22636f6e74656e74446967657374223a2263613937383131326361316262646361666163323331623339613233646334646137383665666638313437633465373262393830373738356166656534386262227d2c226b696e64223a225452554e4341544544227d2c227374646f7574223a7b22636f6e74656e74223a7b22627974654c656e677468223a2232222c22636f6e74656e74446967657374223a2265613564626639353936643138376539353030663233653961363830313039343735333431636634653831663765303433663764393731353263313037373266227d2c226b696e64223a22434f4d504c455445227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2266343232353736323238313063646466303638633263663261616434316337343537333832366435616335336134663534316535306566623561613062646136222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f7574636f6d65223a7b2265786974223a7b226b696e64223a22455849545f434f4445222c2276616c7565223a2231227d2c226b696e64223a2253544152545f4641494c4544227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a2244454144227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a2244454144227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "ee2b45028f893b126dd5330510377f01001221f1af982fcd7ca907d06e83108d",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"content":{"byteLength":"1","contentDigest":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"},"kind":"TRUNCATED"},"stdout":{"content":{"byteLength":"2","contentDigest":"ea5dbf9596d187e9500f23e9a680109475341cf4e81f7e043f7d97152c10772f"},"kind":"COMPLETE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"f42257622810cddf068c2cf2aad41c74573826d5ac53a4f541e50efb5aa0bda6","observedAt":"2026-08-31T01:00:01.000Z","outcome":{"exit":{"kind":"SIGNAL","value":"SIGKILL"},"kind":"START_FAILED"},"processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"DEAD"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"DEAD"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000003bb7b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b22636f6e74656e74223a7b22627974654c656e677468223a2231222c22636f6e74656e74446967657374223a2263613937383131326361316262646361666163323331623339613233646334646137383665666638313437633465373262393830373738356166656534386262227d2c226b696e64223a225452554e4341544544227d2c227374646f7574223a7b22636f6e74656e74223a7b22627974654c656e677468223a2232222c22636f6e74656e74446967657374223a2265613564626639353936643138376539353030663233653961363830313039343735333431636634653831663765303433663764393731353263313037373266227d2c226b696e64223a22434f4d504c455445227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2266343232353736323238313063646466303638633263663261616434316337343537333832366435616335336134663534316535306566623561613062646136222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f7574636f6d65223a7b2265786974223a7b226b696e64223a225349474e414c222c2276616c7565223a225349474b494c4c227d2c226b696e64223a2253544152545f4641494c4544227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a2244454144227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a2244454144227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "5cc4716595c5f355d418915c6229175b805f0e256e8bb73a5cd3d5870bfb0fa6",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"content":{"byteLength":"1","contentDigest":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"},"kind":"TRUNCATED"},"stdout":{"content":{"byteLength":"2","contentDigest":"ea5dbf9596d187e9500f23e9a680109475341cf4e81f7e043f7d97152c10772f"},"kind":"COMPLETE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":"2026-08-31T01:00:01.000Z","outcome":{"kind":"TERMINATION_FAILED_LIVE","termination":{"elapsedMilliseconds":"1000","limitMilliseconds":"1000"}},"processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"DEAD"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"LIVE"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000003e37b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b22636f6e74656e74223a7b22627974654c656e677468223a2231222c22636f6e74656e74446967657374223a2263613937383131326361316262646361666163323331623339613233646334646137383665666638313437633465373262393830373738356166656534386262227d2c226b696e64223a225452554e4341544544227d2c227374646f7574223a7b22636f6e74656e74223a7b22627974654c656e677468223a2232222c22636f6e74656e74446967657374223a2265613564626639353936643138376539353030663233653961363830313039343735333431636634653831663765303433663764393731353263313037373266227d2c226b696e64223a22434f4d504c455445227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f7574636f6d65223a7b226b696e64223a225445524d494e4154494f4e5f4641494c45445f4c495645222c227465726d696e6174696f6e223a7b22656c61707365644d696c6c697365636f6e6473223a2231303030222c226c696d69744d696c6c697365636f6e6473223a2231303030227d7d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22434f4d504c455445222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a2244454144227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a224c495645227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "4afaba0c33f806c856aaad334a6a7032c8e0451b0db4a2933e8585932ef99853",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"kind":"UNAVAILABLE"},"stdout":{"kind":"UNAVAILABLE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"OBSERVATION_UNAVAILABLE"},"processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"UNKNOWN"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000002c27b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b226b696e64223a22554e415641494c41424c45227d2c227374646f7574223a7b226b696e64223a22554e415641494c41424c45227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224f42534552564154494f4e5f554e415641494c41424c45227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a22554e4b4e4f574e227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "ed0f1fc6c7d315e6430ca3f430045f2bfe73d3891710b0d065b86c5858416fae",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"kind":"UNAVAILABLE"},"stdout":{"kind":"UNAVAILABLE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"OBSERVATION_INVALID"},"processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"UNKNOWN"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000002be7b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b226b696e64223a22554e415641494c41424c45227d2c227374646f7574223a7b226b696e64223a22554e415641494c41424c45227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224f42534552564154494f4e5f494e56414c4944227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a22554e4b4e4f574e227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "f2169d1242087d4b11499677fe360a5c4cea149a88b88dfb5b730fd0106b39a3",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"kind":"UNAVAILABLE"},"stdout":{"kind":"UNAVAILABLE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"IDENTITY_CONFLICT"},"processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"UNKNOWN"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000002bc7b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b226b696e64223a22554e415641494c41424c45227d2c227374646f7574223a7b226b696e64223a22554e415641494c41424c45227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224944454e544954595f434f4e464c494354227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a22554e4b4e4f574e227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "a9b2980f35e81cc6537c084b18f2f4eed47303e89818029cf3d6d2bb29c1a6b0",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"kind":"UNAVAILABLE"},"stdout":{"kind":"UNAVAILABLE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"HANDLE_LOST"},"processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"UNKNOWN"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000002b67b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b226b696e64223a22554e415641494c41424c45227d2c227374646f7574223a7b226b696e64223a22554e415641494c41424c45227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a2248414e444c455f4c4f5354227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a22554e4b4e4f574e227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "898e1ca2bd81781ffacb854ef5ef4d9aa50dc7ba7c8fbd45348df9bd7a30d7cd",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"kind":"UNAVAILABLE"},"stdout":{"kind":"UNAVAILABLE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"PROCESS_TREE_UNPROVEN"},"processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"UNKNOWN"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000002c07b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b226b696e64223a22554e415641494c41424c45227d2c227374646f7574223a7b226b696e64223a22554e415641494c41424c45227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a2250524f434553535f545245455f554e50524f56454e227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a22554e4b4e4f574e227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "8ca7dacd1c624561fd37f777314b09e47c00ce33654594c35862efde119d4ce7",
  },
  {
    schema: "worker-terminal-receipt/v1",
    text: '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"kind":"UNAVAILABLE"},"stdout":{"kind":"UNAVAILABLE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":null,"outcome":{"kind":"UNKNOWN","reason":"EXIT_UNPROVEN"},"processes":{"completeness":"UNKNOWN","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"UNKNOWN"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"UNKNOWN"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d7465726d696e616c2d726563656970742f763100000000010700000000000002b87b22617474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303039222c2263617074757265223a7b22737464657272223a7b226b696e64223a22554e415641494c41424c45227d2c227374646f7574223a7b226b696e64223a22554e415641494c41424c45227d7d2c226469737061746368506c616e446967657374223a2261353930633331636135653665326533303532653839313565643533313865363765323035656364646539333630623365343962313062316435306532373432222c226c61756e636852656365697074446967657374223a2262343661653130393164366330646663306466396431613135613561653663313633666365653233613762393165643634653438363032343230613935633830222c226f627365727665644174223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22455849545f554e50524f56454e227d2c2270726f636573736573223a7b22636f6d706c6574656e657373223a22554e4b4e4f574e222c22656e7472696573223a5b7b22706172656e7450726f636573734964223a6e756c6c2c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c227374617465223a22554e4b4e4f574e227d2c7b22706172656e7450726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303332222c2270726f636573734964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303333222c227374617465223a22554e4b4e4f574e227d5d7d2c22736368656d6156657273696f6e223a22776f726b65722d7465726d696e616c2d726563656970742f7631227d0a",
    digest: "6df2b8206e69eaeb2cd8f7c0070d472f622b111d7bbb880e5cb1e126eeafa14e",
  },
] as const;
const inputLiteral =
  '{"adapterConfiguration":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","capabilityNames":["work.read"],"engineVersion":"0.0.0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"adapter-configuration/v1"},"configurationProvenance":{"adapterId":"fixture.adapter","capabilityNames":["work.read"],"fieldSources":{"adapterId":"PROJECT","capabilityNames":"PROJECT","leaseFreshnessMs":"PROJECT","maximumSessionMs":"PROJECT","projectId":"PROJECT","stateRoot":"DEFAULT","wallClockSkewMs":"PROJECT"},"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"01900000-0000-7000-8000-000000000001","projectRoot":"<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>","schemaVersion":"configuration-provenance/v1","stateRoot":"<redacted:path:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc>","wallClockSkewMs":1000},"cycleRequest":{"adapterId":"fixture.adapter","allowedModuleIds":["fixture.module"],"cycleId":"01900000-0000-7000-8000-000000000003","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","configurationProvenanceDigest":"6cb88ecc36a83f0d147de82f0d55aa9c92ad9d39f743ab8698cf943fdaf99e81","configurationSourceDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000006"}},"descriptor":{"abi":"orchestration-module/v1","actions":[{"actionKind":"fixture.direct","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":false},{"actionKind":"fixture.inspect","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":true}],"compatibility":[{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","engineVersion":"0.0.0","policyVersion":"1.2.3"}],"dispatchCatalog":[{"actionKind":"fixture.inspect","capabilityName":"work.read","code":"verify","directiveKind":"VERIFICATION","planAccessor":"IMMUTABLE_SUBJECT_DIGEST","templateId":"template.verify"}],"dispositionCodes":[],"inputSchemas":["module-plan-input/v1"],"moduleId":"fixture.module","moduleVersion":"1.0.0","outputSchemas":["module-action-plan/v1","module-no-action/v1"],"schemaVersion":"module-descriptor/v1"},"policyFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","decisions":[{"capabilityName":"work.read","trip":"TRIP"}],"observationId":"01900000-0000-7000-8000-000000000005","observedAt":"2026-08-31T01:00:00.001Z","policyVersion":"1.2.3","projectFactsDigest":"850e033912e587726788238a4c80a9caea6fe605e7c951232bc84e0900f851e0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-breaker-facts/v1","state":"COMPLETE"},"projectFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","frontier":[{"capabilityNames":["work.read"],"immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","readiness":"READY","workId":"01900000-0000-7000-8000-000000000002"}],"frontierDigest":"e1fd114d0aa64349f2ff70dc4f4e8e3b15a6a16d0380524937ed4ba09ed483d2","observationId":"01900000-0000-7000-8000-000000000004","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-facts/v1","state":"COMPLETE"},"reviewSubject":null,"schemaVersion":"module-plan-input/v1"}\n';
const subjectLiterals = [
  '{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"kind":"TREE","treeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n',
  '{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"entries":[{"contentDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","kind":"PATCH"},{"contentDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","kind":"ARTIFACT"}],"kind":"ORDERED_PATCH_ARTIFACTS"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n',
  '{"assemblyCycleId":"01900000-0000-7000-8000-000000000004","candidateDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","certificationDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","landedSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"landedTreeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","manifestDigest":"1111111111111111111111111111111111111111111111111111111111111111","schemaVersion":"release-candidate-subject/v1","testBundleDigest":"2222222222222222222222222222222222222222222222222222222222222222"}\n',
] as const;
