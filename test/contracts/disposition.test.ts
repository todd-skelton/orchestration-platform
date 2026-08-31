import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as c from "../../packages/contracts/src/index.js";

const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fresh = () => {
  const input = JSON.parse(inputLiteral);
  input.descriptor.dispositionCodes = ["decision.done", "finding.blocked"];
  return input;
};
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

const literal = (index = 0) => JSON.parse(dispatchLiterals[index]!);
const raw = () => Uint8Array.from([0, 255, 65]);
const ref = (bytes: Uint8Array) => ({
  byteLength: String(bytes.byteLength),
  contentDigest: hash(bytes),
});
function fixture(
  role = "observer",
  review: unknown = null,
  input = fresh(),
): ReturnType<typeof fresh> {
  const a = upstream(true, review, input, role);
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
  const value = literal(reason === null ? 8 : 11);
  value.attemptId = plan.attemptId;
  value.dispatchPlanDigest = c.computeDispatchPlanDigest(plan);
  value.resources = plan.outcome.resourceIntents.map(
    (intent: ReturnType<typeof literal>, index: number) => ({
      ...copy(intent),
      allocationId: id(30 + index),
      ownerTransactionId: plan.attemptId,
      state: "ALLOCATED",
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
      exit: null,
    };
    value.capture = { stderr: { kind: "UNAVAILABLE" }, stdout: { kind: "UNAVAILABLE" } };
  }
  return value;
}
const stdout = () => Uint8Array.from([255, 0]),
  stderr = () => Uint8Array.from([97]);

type Mutable = ReturnType<typeof fresh>;
const unknown = (reason = "RESULT_UNPROVEN") => ({ kind: "UNKNOWN", reason });
const apply = (operation = "PROJECT") => ({ kind: "APPLY", operation });
const ordinaryIntent = (input: Mutable, kind = "REPAIR") => ({
  kind,
  moduleId: "fixture.next",
  ...derivedTarget(input),
});
function derivedTarget(input: Mutable) {
  const value = input.moduleInput.reviewSubject ?? input.worker?.resultSubject;
  return value
    ? {
        subjectKind:
          value.schemaVersion === "worker-result-subject/v1"
            ? "WORKER_RESULT"
            : "RELEASE_CANDIDATE",
        subjectDigest: targetDigest(value),
      }
    : { subjectKind: "ACTION", subjectDigest: input.actionPlan.actionCore.immutableSubjectDigest };
}
function disposition(input: Mutable, outcome: unknown = apply()) {
  return {
    actionPlanDigest: c.computeModuleActionPlanDigest(input.actionPlan),
    code: "decision.done",
    inputDigest: c.computeDispositionInputDigest(input),
    outcome: copy(outcome),
    schemaVersion: "action-disposition/v1",
    ...derivedTarget(input),
  };
}
function makeSkips(input: Mutable, path: number[], first: string) {
  let digest = first;
  return path.map((ordinal) => {
    const skip = {
      reason: ordinal === 7 ? "no-allocation" : ordinal === 10 ? "no-review" : "no-worker",
      schemaVersion: "routine-step-skip/v1",
      step: {
        cycleId: input.moduleInput.cycleRequest.cycleId,
        inputDigest: digest,
        kind: (
          {
            7: "dispatch.plan",
            8: "worker.dispatch",
            9: "worker.observe",
            10: "review.reduce",
          } as Record<number, string>
        )[ordinal],
        ordinal: String(ordinal),
        predecessorJournalDigest: "f".repeat(64),
      },
    };
    digest = c.computeRoutineStepSkipDigest(skip);
    return skip;
  });
}
function findings(input: Mutable) {
  const reference = { byteLength: "0", contentDigest: hash("") };
  return ["finding.one", "finding.two"].map((findingId) => ({
    findingId,
    disposition: {
      code: "finding.blocked",
      moduleDescriptorDigest: c.computeModuleDescriptorDigest(input.moduleInput.descriptor),
    },
    evidence: { expected: copy(reference), observed: copy(reference), procedure: copy(reference) },
  }));
}
function authority(input: Mutable, kind = "accepted", selected = true) {
  const review = input.review,
    worker = input.worker;
  const identities = {
    packetDigest: c.computeReviewPacketDigest(review.request.packet),
    requestDigest: c.computeReviewRequestDigest(review.request),
    subjectDigest: targetDigest(review.request.packet.subject),
  };
  const evidence = [{ byteLength: "0", contentDigest: hash("") }];
  review.attempt = selected
    ? {
        ...identities,
        attemptId: worker.plan.attemptId,
        cycleId: input.moduleInput.cycleRequest.cycleId,
        dispatchPlanDigest: c.computeDispatchPlanDigest(worker.plan),
        launchReceiptDigest: c.computeWorkerLaunchReceiptDigest(worker.launch),
        terminalReceiptDigest: c.computeWorkerTerminalReceiptDigest(worker.terminal),
        schemaVersion: "review-attempt-result/v1",
        result:
          kind === "rejected"
            ? { evidence: copy(evidence), findings: findings(input), kind: "BLOCKED" }
            : { evidence: copy(evidence), kind: "SWEEP_COMPLETE" },
      }
    : null;
  review.authority = {
    ...identities,
    schemaVersion: "review-authority/v1",
    outcome: {
      kind,
      attemptResultDigest:
        review.attempt === null ? null : c.computeReviewAttemptResultDigest(review.attempt),
      ...(kind === "unknown" ? { evidence: copy(evidence), reason: "EVIDENCE_UNPROVEN" } : {}),
    },
  };
  expect(c.validateReviewResultBinding(review.request, review.attempt, review.authority).ok).toBe(
    true,
  );
}
function rechainWorker(input: Mutable) {
  const worker = input.worker;
  worker.launch.dispatchPlanDigest = c.computeDispatchPlanDigest(worker.plan);
  worker.terminal.dispatchPlanDigest = c.computeDispatchPlanDigest(worker.plan);
  worker.terminal.launchReceiptDigest = c.computeWorkerLaunchReceiptDigest(worker.launch);
  if (worker.resultSubject)
    worker.resultSubject.terminalReceiptDigest = c.computeWorkerTerminalReceiptDigest(
      worker.terminal,
    );
}
function context(
  options: {
    worker?: boolean;
    role?: string;
    reviewIndex?: number | undefined;
    reviewKind?: string;
    selectedAttempt?: boolean;
    required?: boolean;
    result?: boolean;
    ordered?: boolean;
    failure?: string;
    diagnostic?: string;
  } = {},
): Mutable {
  if (options.worker === false) {
    const input = JSON.parse(inlineGolden.text);
    expect(c.validateModulePlanBinding(input.moduleInput, input.actionPlan).ok).toBe(true);
    return { input, out: null, err: null };
  }
  const seed = fresh();
  seed.descriptor.actions[1].reviewRequired = options.required ?? false;
  const review = options.reviewIndex === undefined ? null : subject(options.reviewIndex);
  const f = fixture(options.role ?? "observer", review, seed);
  expect(planBind(f).ok).toBe(true);
  const started = launch(f.plan, options.failure === "START_FAILED" ? "SPAWN_REFUSED" : null);
  const ended = terminal(
    f.plan,
    started,
    options.failure === "START_FAILED" ? "START_FAILED" : "EXITED",
  );
  let out: Uint8Array | null = stdout(),
    err: Uint8Array | null = stderr();
  if (options.failure === "START_FAILED") out = err = null;
  else if (options.failure)
    ended.outcome.exit =
      options.failure === "SIGNAL"
        ? { kind: "SIGNAL", value: "SIGTERM" }
        : { kind: "EXIT_CODE", value: options.failure };
  if (options.diagnostic) {
    if (options.diagnostic === "LAUNCH")
      started.outcome = { kind: "UNKNOWN", reason: "STARTUP_UNPROVEN" };
    ended.outcome =
      options.diagnostic === "LIVE"
        ? {
            kind: "TERMINATION_FAILED_LIVE",
            termination: { elapsedMilliseconds: "1000", limitMilliseconds: "1000" },
          }
        : { kind: "UNKNOWN", reason: "HANDLE_LOST" };
    ended.processes = copy(started.processes);
    for (const row of ended.processes.entries)
      row.state = options.diagnostic === "LIVE" ? "LIVE" : "UNKNOWN";
    if (options.diagnostic !== "LIVE") {
      ended.observedAt = null;
      ended.processes.completeness = "UNKNOWN";
    }
    ended.launchReceiptDigest = c.computeWorkerLaunchReceiptDigest(started);
  }
  const input: Mutable = {
    actionPlan: copy(f.a.plan),
    moduleInput: copy(f.a.input),
    preflight: copy(f.preflight),
    review: null,
    route: copy(f.a.route),
    skips: [],
    worker: { launch: started, plan: copy(f.plan), resultSubject: null, terminal: ended },
  };
  if (review === null && options.result !== false && options.failure !== "START_FAILED") {
    const result = subject(options.ordered ? 1 : 0);
    result.authorCycleId = input.moduleInput.cycleRequest.cycleId;
    result.authorAttemptId = f.plan.attemptId;
    result.baseSource.adapterId = input.moduleInput.adapterConfiguration.adapterId;
    result.baseSource.projectId = input.moduleInput.adapterConfiguration.projectId;
    result.terminalReceiptDigest = c.computeWorkerTerminalReceiptDigest(ended);
    input.worker.resultSubject = result;
  }
  if (review !== null && !options.failure) {
    input.review = { request: copy(f.request), attempt: null, authority: null };
    authority(input, options.reviewKind ?? "accepted", options.selectedAttempt ?? true);
  }
  const path = options.diagnostic
    ? []
    : options.failure === "START_FAILED"
      ? [9, 10]
      : review === null || options.failure
        ? [10]
        : [];
  input.skips = makeSkips(
    input,
    path,
    options.failure === "START_FAILED"
      ? c.computeWorkerLaunchReceiptDigest(started)
      : c.computeWorkerTerminalReceiptDigest(ended),
  );
  expect(
    c.validateWorkerTerminalReceiptBinding(input.worker.plan, started, out, err, ended).ok,
  ).toBe(true);
  expect(c.parseDispositionInput(input).ok).toBe(true);
  return { input, out, err };
}
const bind = (
  f: Mutable,
  outcome: unknown = apply(),
  result: unknown = disposition(f.input, outcome),
) => c.validateActionDispositionBinding(f.input, f.out, f.err, result);
const followRequest = (input: Mutable, result: Mutable) => ({
  cause: { digest: c.computeActionDispositionDigest(result), kind: "DISPOSITION" },
  intent: copy(result.outcome.followUp),
  schemaVersion: "follow-up-cycle-request/v1",
  sourceCycleId: input.moduleInput.cycleRequest.cycleId,
});
function rejection(f: Mutable, mutate: (input: Mutable) => void, outcome: unknown = apply()) {
  const input = copy(f.input);
  mutate(input);
  expect(c.parseDispositionInput(input).ok).toBe(true);
  expect(
    c.validateActionDispositionBinding(input, f.out, f.err, disposition(input, outcome)).ok,
  ).toBe(false);
}
const publicParsers = {
  "action-disposition/v1": c.parseActionDisposition,
  "follow-up-cycle-request/v1": c.parseFollowUpCycleRequest,
};
const publicDigests = {
  "action-disposition/v1": c.computeActionDispositionDigest,
  "follow-up-cycle-request/v1": c.computeFollowUpCycleRequestDigest,
};

test("pins complete disposition/intent/cause cells to independent bytes, full frames and digests", () => {
  for (const golden of goldens) {
    const value = JSON.parse(golden.text),
      bytes = new TextEncoder().encode(golden.text);
    expect(publicParsers[golden.schema](value)).toEqual({ ok: true, value });
    expect(c.parseContract(golden.schema, value)).toEqual({ ok: true, value });
    expect(c.parseDispositionContract(golden.schema, value)).toEqual({ ok: true, value });
    expect(c.serializeContract(golden.schema, value)).toEqual({
      ok: true,
      bytes,
      digest: golden.digest,
    });
    expect(publicDigests[golden.schema](value)).toBe(golden.digest);
    expect(
      Buffer.from(c.framedBytes(golden.schema, [c.frame.canonical(value)])).toString("hex"),
    ).toBe(golden.frameHex);
    expect(hash(Buffer.from(golden.frameHex, "hex"))).toBe(golden.digest);
    expect(hash(golden.text)).not.toBe(golden.digest);
    expect(c.parseCanonicalContractBytes(golden.schema, bytes)).toEqual({ ok: true, value });
    expect(
      c.serializeContract(golden.schema, Object.fromEntries(Object.entries(value).reverse())),
    ).toEqual({ ok: true, bytes, digest: golden.digest });
    for (const bad of [
      golden.text.trimEnd(),
      golden.text.replace(/\n$/, "\r\n"),
      "\ufeff" + golden.text,
    ])
      expect(c.parseCanonicalContractBytes(golden.schema, new TextEncoder().encode(bad)).ok).toBe(
        false,
      );
  }
  const input = JSON.parse(inlineGolden.text);
  expect(c.parseDispositionInput(input)).toEqual({ ok: true, value: input });
  expect(c.canonicalJson(input)).toBe(inlineGolden.text);
  expect(c.computeDispositionInputDigest(input)).toBe(inlineGolden.digest);
  expect(hash(inlineGolden.text)).toBe(inlineGolden.digest);
  expect(c.computeDispositionInputDigest(Object.fromEntries(Object.entries(input).reverse()))).toBe(
    inlineGolden.digest,
  );
  expect(bind({ input, out: null, err: null }, apply("ASSEMBLE_CERTIFY")).ok).toBe(true);
  expect(c.dispositionSchemaVersions).toEqual([
    "action-disposition/v1",
    "follow-up-cycle-request/v1",
  ]);
  for (const schema of [
    "action-disposition/v2",
    "follow-up-cycle-request/v2",
    "disposition-input/v1",
    "follow-up-intent/v1",
  ]) {
    expect(c.parseContract(schema, input).ok).toBe(false);
    expect(c.parseDispositionContract(schema, input)).toBeNull();
  }
});

test("closes every owned record and outcome arm without collapsing null or adding schema wrappers", () => {
  const close = (
    seed: Mutable,
    parse: (value: unknown) => { ok: boolean },
    paths: Array<Array<string | number>>,
  ) => {
    const at = (value: Mutable, path: Array<string | number>) =>
      path.reduce((row, key) => row[key], value);
    expect(parse(seed).ok).toBe(true);
    for (const path of paths) {
      const extra = copy(seed);
      at(extra, path).extra = true;
      expect(parse(extra).ok).toBe(false);
      for (const key of Object.keys(at(seed, path))) {
        const missing = copy(seed);
        delete at(missing, path)[key];
        expect(parse(missing).ok).toBe(false);
        const wrong = copy(seed);
        at(wrong, path)[key] = false;
        expect(parse(wrong).ok).toBe(false);
      }
    }
  };
  for (const golden of goldens) {
    const value = JSON.parse(golden.text);
    close(
      value,
      publicParsers[golden.schema],
      golden.schema === "action-disposition/v1"
        ? [[], ["outcome"], ...(value.outcome.followUp ? [["outcome", "followUp"]] : [])]
        : [[], ["cause"], ["intent"]],
    );
  }
  const f = context({ reviewIndex: 0 });
  close(f.input, c.parseDispositionInput, [[], ["worker"], ["review"]]);
  expect(c.parseDispositionInput({ ...f.input, schemaVersion: "disposition-input/v1" }).ok).toBe(
    false,
  );
  const nils = context({ worker: false });
  for (const field of ["review", "worker"])
    expect(c.parseDispositionInput({ ...nils.input, [field]: {} }).ok).toBe(false);
  for (const kind of ["REVIEW_NEEDED", "FOLLOW_UP"])
    expect(c.parseActionDisposition(disposition(nils.input, { kind, followUp: null })).ok).toBe(
      false,
    );
  const ordinary = ordinaryIntent(nils.input),
    review = { kind: "REVIEW", moduleId: "fixture.review", subject: subject(0) };
  for (const [kind, followUp] of [
    ["REVIEW_NEEDED", ordinary],
    ["FOLLOW_UP", review],
    ["FAILURE", review],
  ])
    expect(c.parseActionDisposition(disposition(nils.input, { kind, followUp })).ok).toBe(false);
  for (const outcome of [
    { kind: "APPLY", operation: "DELETE" },
    { kind: "UNKNOWN", reason: "OTHER" },
    { kind: "COMPLETE", followUp: null },
    { kind: "FAILED" },
  ])
    expect(c.parseActionDisposition(disposition(nils.input, outcome)).ok).toBe(false);
  for (const input of [
    null,
    [],
    true,
    "REPAIR",
    { ...ordinary, kind: "PROMOTE" },
    { ...ordinary, subjectKind: "CANDIDATE" },
  ])
    expect(c.parseFollowUpIntent(input).ok).toBe(false);
});

test("keeps exact scalar bounds, spelling and promotion/disposition cause-intent separation", () => {
  const f = context({ worker: false }),
    base = disposition(f.input),
    ordinary = ordinaryIntent(f.input);
  for (const code of ["a", "a".repeat(64), "a._:-09"])
    expect(c.parseActionDisposition({ ...base, code }).ok).toBe(true);
  for (const code of [
    "",
    "a".repeat(65),
    "A",
    "0code",
    "a+",
    "a@",
    "a ",
    ...["\n", "\r", "\u2028", "\u2029"].map((end) => "code" + end),
  ])
    expect(c.parseActionDisposition({ ...base, code }).ok).toBe(false);
  for (const moduleId of ["a", "0", "a".repeat(128), "a._:@+-09"])
    expect(c.parseFollowUpIntent({ ...ordinary, moduleId }).ok).toBe(true);
  for (const moduleId of [
    "",
    "a".repeat(129),
    "A",
    "-a",
    ...["\n", "\r", "\u2028", "\u2029"].map((end) => "module" + end),
  ])
    expect(c.parseFollowUpIntent({ ...ordinary, moduleId }).ok).toBe(false);
  for (const field of ["actionPlanDigest", "inputDigest", "subjectDigest"])
    for (const value of [
      null,
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
      ...["\n", "\r", "\u2028", "\u2029"].map((end) => "a".repeat(64) + end),
    ])
      expect(c.parseActionDisposition({ ...base, [field]: value }).ok).toBe(false);
  const promotion = JSON.parse(goldens.at(-1)!.text);
  expect(c.parseFollowUpCycleRequest(promotion).ok).toBe(true);
  for (const field of ["installationId", "promotionTransactionId"])
    for (const value of [
      null,
      id(1).toUpperCase().replace("000000000001", "ABCDEF123456"),
      id(1).replace("7000", "6000"),
      ...["\n", "\r", "\u2028", "\u2029"].map((end) => id(1) + end),
    ])
      expect(c.parseFollowUpIntent({ ...promotion.intent, [field]: value }).ok).toBe(false);
  for (const value of [null, id(1).replace("8000", "7000"), id(1) + "\n"])
    expect(c.parseFollowUpCycleRequest({ ...promotion, sourceCycleId: value }).ok).toBe(false);
  expect(
    c.parseFollowUpCycleRequest({
      ...promotion,
      cause: { ...promotion.cause, kind: "DISPOSITION" },
    }).ok,
  ).toBe(false);
  const requested = followRequest(
    f.input,
    disposition(f.input, { kind: "FOLLOW_UP", followUp: ordinary }),
  );
  expect(
    c.parseFollowUpCycleRequest({ ...requested, cause: { ...requested.cause, kind: "PROMOTION" } })
      .ok,
  ).toBe(false);
  for (const subjectKind of ["ACTION", "WORKER_RESULT", "RELEASE_CANDIDATE"])
    expect(c.parseFollowUpIntent({ ...ordinary, subjectKind }).ok).toBe(true);
});

test("materialized ordinary results differ from the old action target and obey role/review-required gates", () => {
  for (const role of ["implementation", "observer"])
    for (const ordered of [false, true]) {
      const f = context({ role, ordered });
      expect(derivedTarget(f.input).subjectDigest).not.toBe(
        f.input.actionPlan.actionCore.immutableSubjectDigest,
      );
      expect(bind(f).ok).toBe(true);
      expect(bind(f, { kind: "COMPLETE" }).ok).toBe(role === "observer");
      expect(bind(f, apply("ASSEMBLE_CERTIFY")).ok).toBe(false);
      expect(bind(f, apply("PROMOTE")).ok).toBe(false);
      for (const kind of ["NO_ACTION", "FAILURE", "FOLLOW_UP"])
        expect(
          bind(
            f,
            kind === "NO_ACTION"
              ? { kind }
              : { kind, followUp: kind === "FAILURE" ? null : ordinaryIntent(f.input) },
          ).ok,
        ).toBe(true);
      const required = context({ role, ordered, required: true });
      const reviewNeeded = {
        kind: "REVIEW_NEEDED",
        followUp: {
          kind: "REVIEW",
          moduleId: "fixture.review",
          subject: copy(required.input.worker.resultSubject),
        },
      };
      expect(bind(required, reviewNeeded).ok).toBe(true);
      expect(bind(required, unknown()).ok).toBe(true);
      for (const outcome of [
        apply(),
        { kind: "COMPLETE" },
        { kind: "NO_ACTION" },
        { kind: "FAILURE", followUp: null },
        { kind: "FOLLOW_UP", followUp: ordinaryIntent(required.input) },
      ])
        expect(bind(required, outcome).ok).toBe(false);
      expect(
        bind(f, {
          ...reviewNeeded,
          followUp: { ...reviewNeeded.followUp, subject: copy(f.input.worker.resultSubject) },
        }).ok,
      ).toBe(false);
      const old = disposition(f.input);
      old.subjectKind = "ACTION";
      old.subjectDigest = f.input.actionPlan.actionCore.immutableSubjectDigest;
      expect(bind(f, apply(), old).ok).toBe(false);
    }
  for (const required of [false, true]) {
    const missing = context({ result: false, required });
    expect(bind(missing, unknown()).ok).toBe(true);
    for (const outcome of [
      apply(),
      { kind: "NO_ACTION" },
      { kind: "COMPLETE" },
      unknown("INPUT_UNPROVEN"),
      unknown("AUTHORITY_UNPROVEN"),
      unknown("DISPOSITION_FAILED"),
    ])
      expect(bind(missing, outcome).ok).toBe(false);
  }
});

test("all concrete reviewed subjects keep accepted/rejected/unknown authority distinct", () => {
  for (const reviewIndex of [0, 1, 2]) {
    const accepted = context({ reviewIndex });
    expect(bind(accepted, { kind: "COMPLETE" }).ok).toBe(true);
    expect(bind(accepted, apply(reviewIndex === 2 ? "PROMOTE" : "PROJECT")).ok).toBe(true);
    expect(bind(accepted, apply(reviewIndex === 2 ? "PROJECT" : "PROMOTE")).ok).toBe(false);
    expect(bind(accepted, apply("ASSEMBLE_CERTIFY")).ok).toBe(false);
    const rejected = context({ reviewIndex, reviewKind: "rejected" });
    for (const kind of ["REPAIR", "REPLAN", "RETRY"])
      expect(
        bind(rejected, { kind: "FOLLOW_UP", followUp: ordinaryIntent(rejected.input, kind) }).ok,
      ).toBe(true);
    expect(bind(rejected, unknown()).ok).toBe(true);
    for (const outcome of [
      apply(),
      { kind: "COMPLETE" },
      { kind: "NO_ACTION" },
      { kind: "FAILURE", followUp: null },
    ])
      expect(bind(rejected, outcome).ok).toBe(false);
    for (const selectedAttempt of [false, true]) {
      const unproven = context({ reviewIndex, reviewKind: "unknown", selectedAttempt });
      for (const reason of [
        "INPUT_UNPROVEN",
        "RESULT_UNPROVEN",
        "AUTHORITY_UNPROVEN",
        "DISPOSITION_FAILED",
      ])
        expect(bind(unproven, unknown(reason)).ok).toBe(true);
      expect(bind(unproven, { kind: "COMPLETE" }).ok).toBe(false);
      expect(
        bind(unproven, { kind: "FOLLOW_UP", followUp: ordinaryIntent(unproven.input) }).ok,
      ).toBe(false);
    }
  }
});

test("workerless, known start/process failures and unknown/live observations select their exact skip paths", () => {
  const workerless = context({ worker: false });
  for (const outcome of [
    apply(),
    apply("ASSEMBLE_CERTIFY"),
    { kind: "COMPLETE" },
    { kind: "NO_ACTION" },
    unknown(),
  ])
    expect(bind(workerless, outcome).ok).toBe(true);
  expect(bind(workerless, apply("PROMOTE")).ok).toBe(false);
  for (const bad of [undefined, new Uint8Array(), "", false])
    expect(
      c.validateActionDispositionBinding(workerless.input, bad, null, disposition(workerless.input))
        .ok,
    ).toBe(false);
  for (const failure of ["START_FAILED", "1", "SIGNAL"])
    for (const reviewIndex of [undefined, 0, 2]) {
      const f = context({ failure, reviewIndex });
      expect(bind(f, { kind: "FAILURE", followUp: null }).ok).toBe(true);
      expect(bind(f, { kind: "FAILURE", followUp: ordinaryIntent(f.input, "RETRY") }).ok).toBe(
        true,
      );
      expect(bind(f, unknown()).ok).toBe(true);
      for (const outcome of [
        apply(),
        { kind: "COMPLETE" },
        { kind: "NO_ACTION" },
        { kind: "FOLLOW_UP", followUp: ordinaryIntent(f.input) },
      ])
        expect(bind(f, outcome).ok).toBe(false);
      expect(f.input.skips.map((s: Mutable) => s.step.ordinal)).toEqual(
        failure === "START_FAILED" ? ["9", "10"] : ["10"],
      );
      if (failure === "START_FAILED")
        expect(f.input.skips[0].step.inputDigest).toBe(
          c.computeWorkerLaunchReceiptDigest(f.input.worker.launch),
        );
    }
  for (const diagnostic of ["UNKNOWN", "LIVE", "LAUNCH"]) {
    const f = context({ diagnostic });
    expect(bind(f, unknown()).ok).toBe(true);
    expect(f.input.skips).toEqual([]);
    for (const outcome of [apply(), { kind: "COMPLETE" }, { kind: "FAILURE", followUp: null }])
      expect(bind(f, outcome).ok).toBe(false);
    rejection(
      f,
      (input) => {
        input.skips = makeSkips(
          input,
          [10],
          c.computeWorkerTerminalReceiptDigest(input.worker.terminal),
        );
      },
      unknown(),
    );
  }
});

test("every skip ordinal, reason, current cycle and primary/predecessor digest remains binding", () => {
  for (const f of [
    context({ worker: false }),
    context(),
    context({ failure: "START_FAILED" }),
    context({ reviewIndex: 0, failure: "1" }),
  ]) {
    const outcome =
      f.input.worker?.terminal.outcome.kind === "START_FAILED" ||
      f.input.worker?.terminal.outcome.exit?.value === "1"
        ? { kind: "FAILURE", followUp: null }
        : apply();
    expect(bind(f, outcome).ok).toBe(true);
    for (let index = 0; index < f.input.skips.length; index++) {
      rejection(
        f,
        (input) => {
          input.skips.splice(index, 1);
        },
        outcome,
      );
      for (const field of ["cycleId", "inputDigest"])
        rejection(
          f,
          (input) => {
            input.skips[index].step[field] = field === "cycleId" ? id(98) : "9".repeat(64);
          },
          outcome,
        );
      rejection(
        f,
        (input) => {
          input.skips[index].reason = "prior-known-terminal";
          for (let i = index + 1; i < input.skips.length; i++)
            input.skips[i].step.inputDigest = c.computeRoutineStepSkipDigest(input.skips[i - 1]);
        },
        outcome,
      );
    }
    const moved = copy(f.input);
    moved.skips[0].step.predecessorJournalDigest = "8".repeat(64);
    for (let i = 1; i < moved.skips.length; i++)
      moved.skips[i].step.inputDigest = c.computeRoutineStepSkipDigest(moved.skips[i - 1]);
    // Prefix authority is external: a coherent supplied prefix is a valid claim, not proof of append.
    expect(
      c.validateActionDispositionBinding(moved, f.out, f.err, disposition(moved, outcome)).ok,
    ).toBe(true);
  }
  const f = context({ worker: false });
  for (const skips of [
    [...f.input.skips].reverse(),
    [f.input.skips[0], f.input.skips[0]],
    Array(5).fill(f.input.skips[0]),
    new Array(1),
  ])
    expect(c.parseDispositionInput({ ...f.input, skips }).ok).toBe(false);
  for (const ordinal of ["6", "11"]) {
    const bad = copy(f.input);
    bad.skips = [
      {
        reason: "prior-known-terminal",
        schemaVersion: "routine-step-skip/v1",
        step: {
          ...bad.skips[0].step,
          ordinal,
          kind: ordinal === "6" ? "project.preflight" : "disposition.plan",
        },
      },
    ];
    expect(c.parseRoutineStepSkip(bad.skips[0]).ok).toBe(true);
    expect(c.parseDispositionInput(bad).ok).toBe(false);
  }
  const changed = copy(f.input);
  changed.skips[0].reason = "no-worker";
  expect(c.parseDispositionInput(changed).ok).toBe(false);
  const start = context({ failure: "START_FAILED" });
  rejection(
    start,
    (input) => {
      input.skips[0].step.inputDigest = c.computeWorkerTerminalReceiptDigest(input.worker.terminal);
      input.skips[1].step.inputDigest = c.computeRoutineStepSkipDigest(input.skips[0]);
    },
    { kind: "FAILURE", followUp: null },
  );
});

test("actual preparation, dispatch, materialized subject and raw streams cannot be substituted", () => {
  const f = context();
  expect(bind(f).ok).toBe(true);
  const workerless = context({ worker: false });
  rejection(workerless, (input) => {
    input.actionPlan.inputDigest = "9".repeat(64);
    input.route.actionPlanDigest = c.computeModuleActionPlanDigest(input.actionPlan);
    input.preflight.actionPlanDigest = c.computeModuleActionPlanDigest(input.actionPlan);
    input.preflight.routeDigest = c.computeRouteSelectionDigest(input.route);
    input.skips = makeSkips(input, [7, 8, 9, 10], c.computeProjectPreflightDigest(input.preflight));
  });
  for (const [part, field] of [
    ["route", "actionPlanDigest"],
    ["preflight", "actionPlanDigest"],
    ["preflight", "routeDigest"],
  ])
    rejection(workerless, (input) => {
      input[part!][field!] = "9".repeat(64);
      if (part === "route")
        input.preflight.routeDigest = c.computeRouteSelectionDigest(input.route);
      input.skips = makeSkips(
        input,
        [7, 8, 9, 10],
        c.computeProjectPreflightDigest(input.preflight),
      );
    });
  for (const field of ["actionPlanDigest", "preflightDigest", "routeDigest"])
    rejection(f, (input) => {
      input.worker.plan[field] = "9".repeat(64);
      rechainWorker(input);
      input.skips = makeSkips(
        input,
        [10],
        c.computeWorkerTerminalReceiptDigest(input.worker.terminal),
      );
    });
  rejection(workerless, (input) => {
    input.preflight.outcome = { kind: "REFUSED", reason: "TARGET_CHANGED" };
    input.skips = makeSkips(input, [7, 8, 9, 10], c.computeProjectPreflightDigest(input.preflight));
  });
  rejection(f, (input) => {
    input.route.hostMappingDigest = null;
    input.route.outcome = { kind: "NO_WORKER" };
    input.preflight.routeDigest = c.computeRouteSelectionDigest(input.route);
    input.worker.plan.routeDigest = c.computeRouteSelectionDigest(input.route);
    input.worker.plan.preflightDigest = c.computeProjectPreflightDigest(input.preflight);
    rechainWorker(input);
    input.skips = makeSkips(
      input,
      [10],
      c.computeWorkerTerminalReceiptDigest(input.worker.terminal),
    );
  });
  rejection(f, (input) => {
    input.worker = null;
  });
  for (const field of ["authorCycleId", "authorAttemptId", "terminalReceiptDigest"])
    rejection(f, (input) => {
      input.worker.resultSubject[field] =
        field === "terminalReceiptDigest" ? "9".repeat(64) : id(98);
    });
  for (const field of ["adapterId", "projectId"])
    rejection(f, (input) => {
      input.worker.resultSubject.baseSource[field] =
        field === "adapterId" ? "other.adapter" : id(98);
    });
  const candidate = copy(f.input);
  candidate.worker.resultSubject = subject(2);
  expect(c.parseDispositionInput(candidate).ok).toBe(false);
  for (const field of ["inputDigest", "actionPlanDigest", "subjectDigest"]) {
    const output = disposition(f.input);
    output[field as keyof typeof output] = "9".repeat(64);
    expect(bind(f, apply(), output).ok).toBe(false);
  }
  expect(bind(f, apply(), { ...disposition(f.input), code: "undeclared" }).ok).toBe(false);
  expect(bind(f, apply(), { ...disposition(f.input), subjectKind: "RELEASE_CANDIDATE" }).ok).toBe(
    false,
  );
  for (const [out, err] of [
    [null, f.err],
    [f.out, null],
    [stderr(), f.err],
    [f.out, stdout()],
    [new Uint8Array(), f.err],
  ])
    expect(c.validateActionDispositionBinding(f.input, out, err, disposition(f.input)).ok).toBe(
      false,
    );
  const pad = (bytes: Uint8Array) => {
    const all = Buffer.alloc(bytes.length + 7, 17);
    all.set(bytes, 3);
    return all.subarray(3, 3 + bytes.length);
  };
  expect(
    c.validateActionDispositionBinding(f.input, pad(f.out), pad(f.err), disposition(f.input)).ok,
  ).toBe(true);
  const required = context({ required: true });
  const needed = {
    kind: "REVIEW_NEEDED",
    followUp: {
      kind: "REVIEW",
      moduleId: "fixture.review",
      subject: copy(required.input.worker.resultSubject),
    },
  };
  const moved = copy(needed);
  moved.followUp.subject.result.treeDigest = "7".repeat(64);
  expect(bind(required, moved).ok).toBe(false);
});

test("review request, attempt and every finding retain actual descriptor and worker identities", () => {
  const accepted = context({ reviewIndex: 0 });
  expect(bind(accepted, { kind: "COMPLETE" }).ok).toBe(true);
  for (const mutation of ["brief", "subject", "planRequest"])
    rejection(
      accepted,
      (input) => {
        if (mutation === "brief")
          input.review.request.packet.brief.footprint[0].resourceIdentityDigest = "9".repeat(64);
        if (mutation === "subject") {
          const packet = input.review.request.packet;
          packet.subject.result.treeDigest = "8".repeat(64);
          packet.brief.action.immutableSubjectDigest = targetDigest(packet.subject);
          for (const directive of packet.brief.directives)
            directive.subjectDigest = targetDigest(packet.subject);
        }
        input.worker.plan.reviewRequestDigest =
          mutation === "planRequest"
            ? "9".repeat(64)
            : c.computeReviewRequestDigest(input.review.request);
        rechainWorker(input);
        authority(input);
        expect(
          c.validateWorkerTerminalReceiptBinding(
            input.worker.plan,
            input.worker.launch,
            accepted.out,
            accepted.err,
            input.worker.terminal,
          ).ok,
        ).toBe(true);
      },
      { kind: "COMPLETE" },
    );
  for (const field of [
    "attemptId",
    "dispatchPlanDigest",
    "launchReceiptDigest",
    "terminalReceiptDigest",
  ])
    rejection(
      accepted,
      (input) => {
        input.review.attempt[field] = field === "attemptId" ? id(98) : "9".repeat(64);
        input.review.authority.outcome.attemptResultDigest = c.computeReviewAttemptResultDigest(
          input.review.attempt,
        );
        expect(
          c.validateReviewResultBinding(
            input.review.request,
            input.review.attempt,
            input.review.authority,
          ).ok,
        ).toBe(true);
      },
      { kind: "COMPLETE" },
    );
  rejection(
    accepted,
    (input) => {
      input.review.request.reviewCycleId = id(98);
      input.review.attempt.cycleId = id(98);
      const identities = { requestDigest: c.computeReviewRequestDigest(input.review.request) };
      Object.assign(input.review.attempt, identities);
      Object.assign(input.review.authority, identities);
      input.review.authority.outcome.attemptResultDigest = c.computeReviewAttemptResultDigest(
        input.review.attempt,
      );
      expect(
        c.validateReviewResultBinding(
          input.review.request,
          input.review.attempt,
          input.review.authority,
        ).ok,
      ).toBe(true);
    },
    { kind: "COMPLETE" },
  );
  for (const field of ["packetDigest", "requestDigest", "subjectDigest"])
    rejection(
      accepted,
      (input) => {
        input.review.authority[field] = "9".repeat(64);
      },
      { kind: "COMPLETE" },
    );
  rejection(
    accepted,
    (input) => {
      input.review = null;
    },
    { kind: "COMPLETE" },
  );
  const rejected = context({ reviewIndex: 1, reviewKind: "rejected" });
  for (const index of [0, 1])
    rejection(
      rejected,
      (input) => {
        input.review.attempt.result.findings[index].disposition.code = "undeclared";
        input.review.authority.outcome.attemptResultDigest = c.computeReviewAttemptResultDigest(
          input.review.attempt,
        );
        expect(
          c.validateReviewResultBinding(
            input.review.request,
            input.review.attempt,
            input.review.authority,
          ).ok,
        ).toBe(true);
      },
      { kind: "FOLLOW_UP", followUp: ordinaryIntent(rejected.input) },
    );
  for (const index of [0, 1])
    rejection(
      rejected,
      (input) => {
        input.review.attempt.result.findings[index].disposition.moduleDescriptorDigest = "9".repeat(
          64,
        );
        input.review.authority.outcome.attemptResultDigest = c.computeReviewAttemptResultDigest(
          input.review.attempt,
        );
      },
      { kind: "FOLLOW_UP", followUp: ordinaryIntent(rejected.input) },
    );
  const ordinary = context();
  rejection(ordinary, (input) => {
    input.worker.plan.reviewRequestDigest = "9".repeat(64);
    rechainWorker(input);
    input.skips = makeSkips(
      input,
      [10],
      c.computeWorkerTerminalReceiptDigest(input.worker.terminal),
    );
  });
  rejection(ordinary, (input) => {
    input.review = copy(accepted.input.review);
  });
  const noWorker = context({ worker: false });
  rejection(noWorker, (input) => {
    input.worker = copy(ordinary.input.worker);
  });
  const failure = context({ reviewIndex: 0, failure: "1" });
  rejection(
    failure,
    (input) => {
      input.review = copy(accepted.input.review);
    },
    { kind: "FAILURE", followUp: null },
  );
  const unselected = context({ reviewIndex: 0, reviewKind: "unknown", selectedAttempt: false });
  rejection(
    unselected,
    (input) => {
      input.review.request.reviewCycleId = id(98);
      input.worker.plan.reviewRequestDigest = c.computeReviewRequestDigest(input.review.request);
      rechainWorker(input);
      authority(input, "unknown", false);
    },
    unknown(),
  );
  // Preserve independence even when a failed review has no request/attempt preimage here.
  for (const [reviewIndex, field] of [
    [0, "authorCycleId"],
    [0, "authorAttemptId"],
    [2, "assemblyCycleId"],
  ] as const) {
    const failed = context({ reviewIndex, failure: "1" });
    rejection(
      failed,
      (input) => {
        const target = copy(input.moduleInput.reviewSubject);
        target[field] =
          field === "authorAttemptId"
            ? input.worker.plan.attemptId
            : input.moduleInput.cycleRequest.cycleId;
        const a = upstream(true, target, copy(input.moduleInput));
        input.moduleInput = a.input;
        input.actionPlan = a.plan;
        input.route = a.route;
        input.preflight.actionPlanDigest = c.computeModuleActionPlanDigest(a.plan);
        input.preflight.routeDigest = c.computeRouteSelectionDigest(a.route);
        input.worker.plan.actionPlanDigest = c.computeModuleActionPlanDigest(a.plan);
        input.worker.plan.routeDigest = c.computeRouteSelectionDigest(a.route);
        input.worker.plan.preflightDigest = c.computeProjectPreflightDigest(input.preflight);
        rechainWorker(input);
        input.skips = makeSkips(
          input,
          [10],
          c.computeWorkerTerminalReceiptDigest(input.worker.terminal),
        );
        expect(c.validateModulePlanBinding(input.moduleInput, input.actionPlan).ok).toBe(true);
        expect(
          c.validateWorkerTerminalReceiptBinding(
            input.worker.plan,
            input.worker.launch,
            failed.out,
            failed.err,
            input.worker.terminal,
          ).ok,
        ).toBe(true);
      },
      { kind: "FAILURE", followUp: null },
    );
  }
});

test("follow-up binds the full validated disposition, current cause cycle and exact intent without scheduling authority", () => {
  const f = context();
  for (const kind of ["REPAIR", "REPLAN", "RETRY"])
    for (const dispositionKind of ["FOLLOW_UP", "FAILURE"]) {
      const result = disposition(f.input, {
          kind: dispositionKind,
          followUp: ordinaryIntent(f.input, kind),
        }),
        request = followRequest(f.input, result);
      expect(c.validateFollowUpCycleRequestBinding(f.input, f.out, f.err, result, request)).toEqual(
        { ok: true, value: request },
      );
      for (const mutate of [
        (r: Mutable) => {
          r.sourceCycleId = id(98);
        },
        (r: Mutable) => {
          r.cause.digest = "9".repeat(64);
        },
        (r: Mutable) => {
          r.intent.moduleId = "fixture.other";
        },
        (r: Mutable) => {
          r.intent.kind = kind === "RETRY" ? "REPAIR" : "RETRY";
        },
        (r: Mutable) => {
          r.intent.subjectKind = "ACTION";
        },
        (r: Mutable) => {
          r.intent.subjectDigest = "9".repeat(64);
        },
      ]) {
        const bad = copy(request);
        mutate(bad);
        expect(c.parseFollowUpCycleRequest(bad).ok).toBe(true);
        expect(c.validateFollowUpCycleRequestBinding(f.input, f.out, f.err, result, bad).ok).toBe(
          false,
        );
      }
      expect(
        c.validateFollowUpCycleRequestBinding(f.input, stderr(), f.err, result, request).ok,
      ).toBe(false);
      expect(
        c.validateFollowUpCycleRequestBinding(
          f.input,
          f.out,
          f.err,
          { ...result, code: "undeclared" },
          request,
        ).ok,
      ).toBe(false);
    }
  const required = context({ required: true });
  const result = disposition(required.input, {
    kind: "REVIEW_NEEDED",
    followUp: {
      kind: "REVIEW",
      moduleId: "fixture.review",
      subject: copy(required.input.worker.resultSubject),
    },
  });
  expect(
    c.validateFollowUpCycleRequestBinding(
      required.input,
      required.out,
      required.err,
      result,
      followRequest(required.input, result),
    ).ok,
  ).toBe(true);
  for (const outcome of [
    apply(),
    { kind: "COMPLETE" },
    { kind: "NO_ACTION" },
    { kind: "FAILURE", followUp: null },
    unknown(),
  ]) {
    const value = disposition(f.input, outcome),
      request = JSON.parse(goldens.at(-1)!.text);
    expect(c.parseFollowUpCycleRequest(request).ok).toBe(true);
    expect(c.validateFollowUpCycleRequestBinding(f.input, f.out, f.err, value, request).ok).toBe(
      false,
    );
  }
  const ordinary = disposition(f.input, { kind: "FOLLOW_UP", followUp: ordinaryIntent(f.input) }),
    promotion = JSON.parse(goldens.at(-1)!.text);
  promotion.sourceCycleId = f.input.moduleInput.cycleRequest.cycleId;
  promotion.cause.digest = c.computeActionDispositionDigest(ordinary);
  expect(c.validateFollowUpCycleRequestBinding(f.input, f.out, f.err, ordinary, promotion).ok).toBe(
    false,
  );
});

test("reused subject, skip and terminal boundaries remain closed through the complete inline input", () => {
  const f = context({ ordered: true });
  for (const length of [1, 4096]) {
    const input = copy(f.input);
    input.worker.resultSubject.result.entries = Array.from({ length }, (_, i) => ({
      contentDigest: i.toString(16).padStart(64, "0"),
      kind: i % 2 ? "ARTIFACT" : "PATCH",
    }));
    expect(c.parseDispositionInput(input).ok).toBe(true);
    expect(c.validateActionDispositionBinding(input, f.out, f.err, disposition(input)).ok).toBe(
      true,
    );
  }
  for (const length of [0, 4097]) {
    const input = copy(f.input);
    input.worker.resultSubject.result.entries = Array.from({ length }, () => ({
      contentDigest: "a".repeat(64),
      kind: "PATCH",
    }));
    expect(c.parseDispositionInput(input).ok).toBe(false);
  }
  for (const path of [
    ["actionPlan"],
    ["moduleInput"],
    ["preflight"],
    ["route"],
    ["worker", "plan"],
    ["worker", "launch"],
    ["worker", "terminal"],
    ["worker", "resultSubject"],
  ]) {
    const input = copy(f.input);
    let row = input;
    for (const key of path) row = row[key];
    row.extra = true;
    expect(c.parseDispositionInput(input).ok).toBe(false);
  }
  const reviewed = context({ reviewIndex: 0 });
  for (const part of ["request", "attempt", "authority"]) {
    const input = copy(reviewed.input);
    input.review[part].extra = true;
    expect(c.parseDispositionInput(input).ok).toBe(false);
  }
  const blocked = context({ reviewIndex: 0, reviewKind: "rejected" });
  for (const length of [1, 256]) {
    const input = copy(blocked.input),
      seed = input.review.attempt.result.findings[0];
    input.review.attempt.result.findings = Array.from({ length }, (_, i) => ({
      ...copy(seed),
      findingId: `finding.${String(i).padStart(3, "0")}`,
    }));
    input.review.attempt.result.evidence = Array.from({ length }, () => ({
      byteLength: "9007199254740991",
      contentDigest: "a".repeat(64),
    }));
    input.review.authority.outcome.attemptResultDigest = c.computeReviewAttemptResultDigest(
      input.review.attempt,
    );
    expect(
      c.validateActionDispositionBinding(
        input,
        blocked.out,
        blocked.err,
        disposition(input, { kind: "FOLLOW_UP", followUp: ordinaryIntent(input) }),
      ).ok,
    ).toBe(true);
  }
  for (const field of ["findings", "evidence"])
    for (const length of [0, 257]) {
      const input = copy(blocked.input),
        seed = input.review.attempt.result[field][0];
      input.review.attempt.result[field] = Array.from({ length }, (_, i) => ({
        ...copy(seed),
        ...(field === "findings" ? { findingId: `finding.${String(i).padStart(3, "0")}` } : {}),
      }));
      expect(c.parseDispositionInput(input).ok).toBe(false);
    }
  const workerless = context({ worker: false });
  expect(c.parseDispositionInput({ ...workerless.input, skips: [] }).ok).toBe(true);
  expect(bind({ ...workerless, input: { ...workerless.input, skips: [] } }).ok).toBe(false);
});

test("hostile records and raw-byte impostors are refused without executing supplied input code", () => {
  let calls = 0;
  const f = context(),
    value = disposition(f.input),
    intent = ordinaryIntent(f.input),
    request = followRequest(f.input, disposition(f.input, { kind: "FOLLOW_UP", followUp: intent }));
  const hostile = [
    new Proxy(
      {},
      {
        ownKeys() {
          calls++;
          throw Error("trap");
        },
      },
    ),
    Object.defineProperty({}, "outcome", {
      enumerable: true,
      get() {
        calls++;
        throw Error("getter");
      },
    }),
    {
      ...value,
      toJSON() {
        calls++;
        throw Error("toJSON");
      },
    },
    Object.create({ inherited: true }),
  ];
  for (const input of hostile)
    for (const parse of [
      c.parseDispositionInput,
      c.parseFollowUpIntent,
      c.parseActionDisposition,
      c.parseFollowUpCycleRequest,
    ])
      expect(parse(input).ok).toBe(false);
  const badInput = {
    ...f.input,
    worker: {
      ...f.input.worker,
      terminal: new Proxy(f.input.worker.terminal, {
        get() {
          calls++;
          throw Error("nested");
        },
      }),
    },
  };
  expect(c.validateActionDispositionBinding(badInput, f.out, f.err, value).ok).toBe(false);
  expect(c.validateFollowUpCycleRequestBinding(badInput, f.out, f.err, value, request).ok).toBe(
    false,
  );
  const fake = Object.create(Uint8Array.prototype);
  Object.defineProperty(fake, "byteLength", {
    get() {
      calls++;
      return 2;
    },
  });
  for (const bytes of [
    fake,
    new Proxy(stdout(), {
      get() {
        calls++;
        throw Error("bytes");
      },
    }),
    new Uint8Array(new SharedArrayBuffer(2)),
    [255, 0],
    "ÿ\0",
  ])
    expect(c.validateActionDispositionBinding(f.input, bytes, f.err, value).ok).toBe(false);
  expect(calls).toBe(0);
});

// Fixed data copied from independently generated upstream compatibility vectors.
const dispatchLiterals: Record<number, string> = {
  "0": '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","attemptId":"01900000-0000-7000-8000-000000000009","outcome":{"credentials":{"kind":"REFERENCES","references":[{"access":"READ_ONLY","capabilityNames":["work.read"],"credentialId":"01900000-0000-7000-8000-00000000000a","generation":"0","referenceDigest":"3333333333333333333333333333333333333333333333333333333333333333","role":"observer"}]},"hostRendererArtifactDigest":"4444444444444444444444444444444444444444444444444444444444444444","kind":"PLANNED","renderedInput":{"byteLength":"3","contentDigest":"a90a10503fbfc95789ff38a1bb5039cb71869ab9c0eb1cb51c4a9099f2933c6b"},"resourceIntents":[{"owner":"ADAPTER","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111"},{"owner":"HOST","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222"}],"workerHostIdentityDigest":"5555555555555555555555555555555555555555555555555555555555555555"},"preflightDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewRequestDigest":null,"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"dispatch-plan/v1","sessionHealthDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}\n',
  "8": '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":"2026-08-31T01:00:00.000Z","outcome":{"kind":"LIVE"},"ownership":"PUBLISHED","processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"LIVE"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"LIVE"}]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"ALLOCATED"},{"allocationId":"01900000-0000-7000-8000-00000000001f","owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"ALLOCATED"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
  "11": '{"attemptId":"01900000-0000-7000-8000-000000000009","dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","observedAt":"2026-08-31T01:00:00.000Z","outcome":{"kind":"START_FAILED","reason":"SPAWN_REFUSED"},"ownership":"PUBLISHED","processes":{"completeness":"COMPLETE","entries":[]},"resources":[{"allocationId":"01900000-0000-7000-8000-00000000001e","owner":"ADAPTER","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"1111111111111111111111111111111111111111111111111111111111111111","state":"ALLOCATED"},{"allocationId":"01900000-0000-7000-8000-00000000001f","owner":"HOST","ownerTransactionId":"01900000-0000-7000-8000-000000000009","resourceIdentityDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"ALLOCATED"}],"schemaVersion":"worker-launch-receipt/v1"}\n',
  "18": '{"attemptId":"01900000-0000-7000-8000-000000000009","capture":{"stderr":{"content":{"byteLength":"1","contentDigest":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"},"kind":"TRUNCATED"},"stdout":{"content":{"byteLength":"2","contentDigest":"ea5dbf9596d187e9500f23e9a680109475341cf4e81f7e043f7d97152c10772f"},"kind":"COMPLETE"}},"dispatchPlanDigest":"a590c31ca5e6e2e3052e8915ed5318e67e205ecdde9360b3e49b10b1d50e2742","launchReceiptDigest":"b46ae1091d6c0dfc0df9d1a15a5ae6c163fcee23a7b91ed64e48602420a95c80","observedAt":"2026-08-31T01:00:01.000Z","outcome":{"exit":{"kind":"EXIT_CODE","value":"0"},"kind":"EXITED"},"processes":{"completeness":"COMPLETE","entries":[{"parentProcessId":null,"processId":"01900000-0000-7000-8000-000000000032","state":"DEAD"},{"parentProcessId":"01900000-0000-7000-8000-000000000032","processId":"01900000-0000-7000-8000-000000000033","state":"DEAD"}]},"schemaVersion":"worker-terminal-receipt/v1"}\n',
};
const inputLiteral =
  '{"adapterConfiguration":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","capabilityNames":["work.read"],"engineVersion":"0.0.0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"adapter-configuration/v1"},"configurationProvenance":{"adapterId":"fixture.adapter","capabilityNames":["work.read"],"fieldSources":{"adapterId":"PROJECT","capabilityNames":"PROJECT","leaseFreshnessMs":"PROJECT","maximumSessionMs":"PROJECT","projectId":"PROJECT","stateRoot":"DEFAULT","wallClockSkewMs":"PROJECT"},"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"01900000-0000-7000-8000-000000000001","projectRoot":"<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>","schemaVersion":"configuration-provenance/v1","stateRoot":"<redacted:path:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc>","wallClockSkewMs":1000},"cycleRequest":{"adapterId":"fixture.adapter","allowedModuleIds":["fixture.module"],"cycleId":"01900000-0000-7000-8000-000000000003","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","configurationProvenanceDigest":"6cb88ecc36a83f0d147de82f0d55aa9c92ad9d39f743ab8698cf943fdaf99e81","configurationSourceDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000006"}},"descriptor":{"abi":"orchestration-module/v1","actions":[{"actionKind":"fixture.direct","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":false},{"actionKind":"fixture.inspect","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":true}],"compatibility":[{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","engineVersion":"0.0.0","policyVersion":"1.2.3"}],"dispatchCatalog":[{"actionKind":"fixture.inspect","capabilityName":"work.read","code":"verify","directiveKind":"VERIFICATION","planAccessor":"IMMUTABLE_SUBJECT_DIGEST","templateId":"template.verify"}],"dispositionCodes":[],"inputSchemas":["module-plan-input/v1"],"moduleId":"fixture.module","moduleVersion":"1.0.0","outputSchemas":["module-action-plan/v1","module-no-action/v1"],"schemaVersion":"module-descriptor/v1"},"policyFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","decisions":[{"capabilityName":"work.read","trip":"TRIP"}],"observationId":"01900000-0000-7000-8000-000000000005","observedAt":"2026-08-31T01:00:00.001Z","policyVersion":"1.2.3","projectFactsDigest":"850e033912e587726788238a4c80a9caea6fe605e7c951232bc84e0900f851e0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-breaker-facts/v1","state":"COMPLETE"},"projectFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","frontier":[{"capabilityNames":["work.read"],"immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","readiness":"READY","workId":"01900000-0000-7000-8000-000000000002"}],"frontierDigest":"e1fd114d0aa64349f2ff70dc4f4e8e3b15a6a16d0380524937ed4ba09ed483d2","observationId":"01900000-0000-7000-8000-000000000004","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-facts/v1","state":"COMPLETE"},"reviewSubject":null,"schemaVersion":"module-plan-input/v1"}\n';
const subjectLiterals = [
  '{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"kind":"TREE","treeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n',
  '{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"entries":[{"contentDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","kind":"PATCH"},{"contentDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","kind":"ARTIFACT"}],"kind":"ORDERED_PATCH_ARTIFACTS"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n',
  '{"assemblyCycleId":"01900000-0000-7000-8000-000000000004","candidateDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","certificationDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","landedSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"landedTreeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","manifestDigest":"1111111111111111111111111111111111111111111111111111111111111111","schemaVersion":"release-candidate-subject/v1","testBundleDigest":"2222222222222222222222222222222222222222222222222222222222222222"}\n',
] as const;
// stdlib-only source: TEMP/orchestration-disposition-goldens-20260831.mjs.
const goldens = [
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"APPLY","operation":"PROJECT"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000001837b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a224150504c59222c226f7065726174696f6e223a2250524f4a454354227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "2dddf5572480d054736bfb3341334c893cca213d13ff7b034142e5edaf8aa2f1",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"APPLY","operation":"ASSEMBLE_CERTIFY"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f7631000000000107000000000000018c7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a224150504c59222c226f7065726174696f6e223a22415353454d424c455f43455254494659227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "0cf38600e65991086671aa3f60383c65b5786a0df14251f2a002fa5baa93e204",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"APPLY","operation":"PROMOTE"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000001837b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a224150504c59222c226f7065726174696f6e223a2250524f4d4f5445227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "3eb008b27fe8885c61fe724d187d3a0a643701b295a5312ee82f1c33bca29ac2",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"REVIEW","moduleId":"fixture.review","subject":{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"kind":"TREE","treeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}},"kind":"REVIEW_NEEDED"},"schemaVersion":"action-disposition/v1","subjectDigest":"dfe5185c271a55670354b7668f858857757220534a3ef8fb9bfe77d84e6bbd7d","subjectKind":"WORKER_RESULT"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000003aa7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a22524556494557222c226d6f64756c654964223a22666978747572652e726576696577222c227375626a656374223a7b22617574686f72417474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22617574686f724379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c2262617365536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c22726573756c74223a7b226b696e64223a2254524545222c2274726565446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161227d2c22736368656d6156657273696f6e223a22776f726b65722d726573756c742d7375626a6563742f7631222c227465726d696e616c52656365697074446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262227d7d2c226b696e64223a225245564945575f4e4545444544227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2264666535313835633237316135353637303335346237363638663835383835373735373232303533346133656638666239626665373764383465366262643764222c227375626a6563744b696e64223a22574f524b45525f524553554c54227d0a",
    digest: "8a7ada60acd7a77fd0f6cdcaa6fe669a1dd69e7498e0f7d509def14bbf62d9ae",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"REVIEW","moduleId":"fixture.review","subject":{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"entries":[{"contentDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","kind":"PATCH"},{"contentDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","kind":"ARTIFACT"}],"kind":"ORDERED_PATCH_ARTIFACTS"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}},"kind":"REVIEW_NEEDED"},"schemaVersion":"action-disposition/v1","subjectDigest":"697f7bb2bb7022c3bf82b59faf50894517237537da503af96f3483eea1dc7963","subjectKind":"WORKER_RESULT"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000004447b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a22524556494557222c226d6f64756c654964223a22666978747572652e726576696577222c227375626a656374223a7b22617574686f72417474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22617574686f724379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c2262617365536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c22726573756c74223a7b22656e7472696573223a5b7b22636f6e74656e74446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c226b696e64223a225041544348227d2c7b22636f6e74656e74446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464222c226b696e64223a224152544946414354227d5d2c226b696e64223a224f5244455245445f50415443485f415254494641435453227d2c22736368656d6156657273696f6e223a22776f726b65722d726573756c742d7375626a6563742f7631222c227465726d696e616c52656365697074446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262227d7d2c226b696e64223a225245564945575f4e4545444544227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2236393766376262326262373032326333626638326235396661663530383934353137323337353337646135303361663936663334383365656131646337393633222c227375626a6563744b696e64223a22574f524b45525f524553554c54227d0a",
    digest: "98d2877c93447b456038fbce5dcfe154d2283f43d498b930a470e44baff3e488",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"REVIEW","moduleId":"fixture.review","subject":{"assemblyCycleId":"01900000-0000-7000-8000-000000000004","candidateDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","certificationDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","landedSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"landedTreeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","manifestDigest":"1111111111111111111111111111111111111111111111111111111111111111","schemaVersion":"release-candidate-subject/v1","testBundleDigest":"2222222222222222222222222222222222222222222222222222222222222222"}},"kind":"REVIEW_NEEDED"},"schemaVersion":"action-disposition/v1","subjectDigest":"c78904448ccbd9e67f80b8ad5e0afee305e3eaa5328f1d24441970b37496b65b","subjectKind":"RELEASE_CANDIDATE"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000004677b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a22524556494557222c226d6f64756c654964223a22666978747572652e726576696577222c227375626a656374223a7b22617373656d626c794379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303034222c2263616e646964617465446967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c2263657274696669636174696f6e446967657374223a2266666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666222c226c616e646564536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c226c616e64656454726565446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226d616e6966657374446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c22736368656d6156657273696f6e223a2272656c656173652d63616e6469646174652d7375626a6563742f7631222c227465737442756e646c65446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232227d7d2c226b696e64223a225245564945575f4e4545444544227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263373839303434343863636264396536376638306238616435653061666565333035653365616135333238663164323434343139373062333734393662363562222c227375626a6563744b696e64223a2252454c454153455f43414e444944415445227d0a",
    digest: "0b2aecf3d1da761160b5807908c8c8036f9a8b144b56560549b8a0fd75b6ab8e",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"REPAIR","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"kind":"FOLLOW_UP"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000002127b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a22524550414952222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c226b696e64223a22464f4c4c4f575f5550227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "4da0604622a70ff8280ca07b8f86999a82bd5c831c2f025423a743da98784637",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"REPLAN","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"kind":"FOLLOW_UP"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000002127b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a225245504c414e222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c226b696e64223a22464f4c4c4f575f5550227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "92f16c73640f6b411eb27684e5c324872d3af350e8ee0ab25ea01e0fef141a40",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"RETRY","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"kind":"FOLLOW_UP"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000002117b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a225245545259222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c226b696e64223a22464f4c4c4f575f5550227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "28157170136fc61f5c2fceef78bc77ffcb83c4980ce82d4197958c76827a9f24",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":null,"kind":"FAILURE"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f7631000000000107000000000000017f7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a6e756c6c2c226b696e64223a224641494c555245227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "8ad841efa3b1a30c500c554e410900f2cbf253c11c0f9664960823073aa4d7e0",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"REPAIR","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"kind":"FAILURE"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000002107b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a22524550414952222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c226b696e64223a224641494c555245227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "4d0591a9526dbb86a43510ca4865edf702ada6f19e2d05b268e07c43b03036a0",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"REPLAN","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"kind":"FAILURE"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000002107b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a225245504c414e222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c226b696e64223a224641494c555245227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "4104f3c1ed7c2a938ce6a4f205809128aba6c6ec423397bb99439397e68265fd",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"followUp":{"kind":"RETRY","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"kind":"FAILURE"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f7631000000000107000000000000020f7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b22666f6c6c6f775570223a7b226b696e64223a225245545259222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c226b696e64223a224641494c555245227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "a2290321c433b40d19ef2d2fbbb6e0d6fa5bb221e3cd289a91f1c78aa6ef2f49",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"NO_ACTION"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000001717b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a224e4f5f414354494f4e227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "3893632cb9edb0f884c05275fb88aa5472043493c70dc87db5fc793fb4f7fdf8",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"COMPLETE"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000001707b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22434f4d504c455445227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "643474fc7d97ec3fbe70d1ad5c170487e348f3f37f7493c6e1ae956b133fdc68",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"UNKNOWN","reason":"INPUT_UNPROVEN"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f763100000000010700000000000001897b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22494e5055545f554e50524f56454e227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "937ea1b5f903d737754b70b188d95f6e453c0105f22288d74bf50ccf8db0dd98",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"UNKNOWN","reason":"RESULT_UNPROVEN"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f7631000000000107000000000000018a7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22524553554c545f554e50524f56454e227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "c1516bce7e8eea9c1c7626f6a62177dbd5df4218e27492d0aee9d32bcdd9bc2e",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"UNKNOWN","reason":"AUTHORITY_UNPROVEN"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f7631000000000107000000000000018d7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22415554484f524954595f554e50524f56454e227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "beda04001b60801ececb9ebf9de7fa52998b28a53db52dfb2cd5b0827bdab08e",
  },
  {
    schema: "action-disposition/v1",
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","code":"decision.done","inputDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"UNKNOWN","reason":"DISPOSITION_FAILED"},"schemaVersion":"action-disposition/v1","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00616374696f6e2d646973706f736974696f6e2f7631000000000107000000000000018d7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22636f6465223a226465636973696f6e2e646f6e65222c22696e707574446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22444953504f534954494f4e5f4641494c4544227d2c22736368656d6156657273696f6e223a22616374696f6e2d646973706f736974696f6e2f7631222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d0a",
    digest: "8247a63d34f0481614fa9967aca987b28b16ee4adc54bc33048c6d2781d9612f",
  },
  {
    schema: "follow-up-cycle-request/v1",
    text: '{"cause":{"digest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","kind":"DISPOSITION"},"intent":{"kind":"REVIEW","moduleId":"fixture.review","subject":{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"kind":"TREE","treeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}},"schemaVersion":"follow-up-cycle-request/v1","sourceCycleId":"01900000-0000-7000-8000-000000000008"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00666f6c6c6f772d75702d6379636c652d726571756573742f763100000000010700000000000002fd7b226361757365223a7b22646967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c226b696e64223a22444953504f534954494f4e227d2c22696e74656e74223a7b226b696e64223a22524556494557222c226d6f64756c654964223a22666978747572652e726576696577222c227375626a656374223a7b22617574686f72417474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22617574686f724379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c2262617365536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c22726573756c74223a7b226b696e64223a2254524545222c2274726565446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161227d2c22736368656d6156657273696f6e223a22776f726b65722d726573756c742d7375626a6563742f7631222c227465726d696e616c52656365697074446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262227d7d2c22736368656d6156657273696f6e223a22666f6c6c6f772d75702d6379636c652d726571756573742f7631222c22736f757263654379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303038227d0a",
    digest: "1b462912d0b7e7173aa513ac38c4ffd2fbfc11116e45e169acb92ff12042a4bd",
  },
  {
    schema: "follow-up-cycle-request/v1",
    text: '{"cause":{"digest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","kind":"DISPOSITION"},"intent":{"kind":"REVIEW","moduleId":"fixture.review","subject":{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"entries":[{"contentDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","kind":"PATCH"},{"contentDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","kind":"ARTIFACT"}],"kind":"ORDERED_PATCH_ARTIFACTS"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}},"schemaVersion":"follow-up-cycle-request/v1","sourceCycleId":"01900000-0000-7000-8000-000000000008"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00666f6c6c6f772d75702d6379636c652d726571756573742f763100000000010700000000000003977b226361757365223a7b22646967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c226b696e64223a22444953504f534954494f4e227d2c22696e74656e74223a7b226b696e64223a22524556494557222c226d6f64756c654964223a22666978747572652e726576696577222c227375626a656374223a7b22617574686f72417474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22617574686f724379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c2262617365536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c22726573756c74223a7b22656e7472696573223a5b7b22636f6e74656e74446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c226b696e64223a225041544348227d2c7b22636f6e74656e74446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464222c226b696e64223a224152544946414354227d5d2c226b696e64223a224f5244455245445f50415443485f415254494641435453227d2c22736368656d6156657273696f6e223a22776f726b65722d726573756c742d7375626a6563742f7631222c227465726d696e616c52656365697074446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262227d7d2c22736368656d6156657273696f6e223a22666f6c6c6f772d75702d6379636c652d726571756573742f7631222c22736f757263654379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303038227d0a",
    digest: "d381eb0cd479ee190ac43f43fd43742324a955a770c004eb306a658783d1d0a7",
  },
  {
    schema: "follow-up-cycle-request/v1",
    text: '{"cause":{"digest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","kind":"DISPOSITION"},"intent":{"kind":"REVIEW","moduleId":"fixture.review","subject":{"assemblyCycleId":"01900000-0000-7000-8000-000000000004","candidateDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","certificationDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","landedSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"landedTreeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","manifestDigest":"1111111111111111111111111111111111111111111111111111111111111111","schemaVersion":"release-candidate-subject/v1","testBundleDigest":"2222222222222222222222222222222222222222222222222222222222222222"}},"schemaVersion":"follow-up-cycle-request/v1","sourceCycleId":"01900000-0000-7000-8000-000000000008"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00666f6c6c6f772d75702d6379636c652d726571756573742f763100000000010700000000000003b67b226361757365223a7b22646967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c226b696e64223a22444953504f534954494f4e227d2c22696e74656e74223a7b226b696e64223a22524556494557222c226d6f64756c654964223a22666978747572652e726576696577222c227375626a656374223a7b22617373656d626c794379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303034222c2263616e646964617465446967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c2263657274696669636174696f6e446967657374223a2266666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666222c226c616e646564536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c226c616e64656454726565446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226d616e6966657374446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c22736368656d6156657273696f6e223a2272656c656173652d63616e6469646174652d7375626a6563742f7631222c227465737442756e646c65446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232227d7d2c22736368656d6156657273696f6e223a22666f6c6c6f772d75702d6379636c652d726571756573742f7631222c22736f757263654379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303038227d0a",
    digest: "ef567196622c08a1324891671ca9fdd94d8feda51aaa091f0994b4d2229f3f02",
  },
  {
    schema: "follow-up-cycle-request/v1",
    text: '{"cause":{"digest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","kind":"DISPOSITION"},"intent":{"kind":"REPAIR","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"schemaVersion":"follow-up-cycle-request/v1","sourceCycleId":"01900000-0000-7000-8000-000000000008"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00666f6c6c6f772d75702d6379636c652d726571756573742f763100000000010700000000000001707b226361757365223a7b22646967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c226b696e64223a22444953504f534954494f4e227d2c22696e74656e74223a7b226b696e64223a22524550414952222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c22736368656d6156657273696f6e223a22666f6c6c6f772d75702d6379636c652d726571756573742f7631222c22736f757263654379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303038227d0a",
    digest: "5860cb8abe70b176105ba4cfa61d8c964d44191ced24581f657d40cc11389e49",
  },
  {
    schema: "follow-up-cycle-request/v1",
    text: '{"cause":{"digest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","kind":"DISPOSITION"},"intent":{"kind":"REPLAN","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"schemaVersion":"follow-up-cycle-request/v1","sourceCycleId":"01900000-0000-7000-8000-000000000008"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00666f6c6c6f772d75702d6379636c652d726571756573742f763100000000010700000000000001707b226361757365223a7b22646967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c226b696e64223a22444953504f534954494f4e227d2c22696e74656e74223a7b226b696e64223a225245504c414e222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c22736368656d6156657273696f6e223a22666f6c6c6f772d75702d6379636c652d726571756573742f7631222c22736f757263654379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303038227d0a",
    digest: "a3084b125ed39965b0c08ca089517c314df0947922501f77da9af3fdd8e04779",
  },
  {
    schema: "follow-up-cycle-request/v1",
    text: '{"cause":{"digest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","kind":"DISPOSITION"},"intent":{"kind":"RETRY","moduleId":"fixture.next","subjectDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","subjectKind":"ACTION"},"schemaVersion":"follow-up-cycle-request/v1","sourceCycleId":"01900000-0000-7000-8000-000000000008"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00666f6c6c6f772d75702d6379636c652d726571756573742f7631000000000107000000000000016f7b226361757365223a7b22646967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c226b696e64223a22444953504f534954494f4e227d2c22696e74656e74223a7b226b696e64223a225245545259222c226d6f64756c654964223a22666978747572652e6e657874222c227375626a656374446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c227375626a6563744b696e64223a22414354494f4e227d2c22736368656d6156657273696f6e223a22666f6c6c6f772d75702d6379636c652d726571756573742f7631222c22736f757263654379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303038227d0a",
    digest: "b0a5d2978b349f57acf0777962b5b98296170dfc42486019e90c40c4240d4046",
  },
  {
    schema: "follow-up-cycle-request/v1",
    text: '{"cause":{"digest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","kind":"PROMOTION"},"intent":{"installationId":"01900000-0000-7000-8000-000000000006","kind":"SUCCESSOR_VERIFICATION","promotionTransactionId":"01900000-0000-7000-8000-000000000007","successorReleaseDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"},"schemaVersion":"follow-up-cycle-request/v1","sourceCycleId":"01900000-0000-7000-8000-000000000008"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00666f6c6c6f772d75702d6379636c652d726571756573742f763100000000010700000000000001ce7b226361757365223a7b22646967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c226b696e64223a2250524f4d4f54494f4e227d2c22696e74656e74223a7b22696e7374616c6c6174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303036222c226b696e64223a22535543434553534f525f564552494649434154494f4e222c2270726f6d6f74696f6e5472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303037222c22737563636573736f7252656c65617365446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464227d2c22736368656d6156657273696f6e223a22666f6c6c6f772d75702d6379636c652d726571756573742f7631222c22736f757263654379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303038227d0a",
    digest: "e3ff3dbbd10801604c552ca1003708b1701a0a4cd62b58f1be542a9c677fbf64",
  },
] as const;
const inlineGolden = {
  text: '{"actionPlan":{"actionCore":{"actionKind":"fixture.direct","capabilityName":"work.read","immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","moduleDescriptorDigest":"e88f6d5ce2cf76af2fb9ecdaf3bcd136b575af956588d3a5aa47be8f31b0a5be","requestedRole":"observer","schemaVersion":"dispatch-action-core/v1"},"dispatchBrief":null,"inputDigest":"6f72e36bf22a727da07465fa147a92e69a9c79a4900b4bc11d8155ee50d912e5","schemaVersion":"module-action-plan/v1","workId":"01900000-0000-7000-8000-000000000002"},"moduleInput":{"adapterConfiguration":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","capabilityNames":["work.read"],"engineVersion":"0.0.0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"adapter-configuration/v1"},"configurationProvenance":{"adapterId":"fixture.adapter","capabilityNames":["work.read"],"fieldSources":{"adapterId":"PROJECT","capabilityNames":"PROJECT","leaseFreshnessMs":"PROJECT","maximumSessionMs":"PROJECT","projectId":"PROJECT","stateRoot":"DEFAULT","wallClockSkewMs":"PROJECT"},"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"01900000-0000-7000-8000-000000000001","projectRoot":"<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>","schemaVersion":"configuration-provenance/v1","stateRoot":"<redacted:path:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc>","wallClockSkewMs":1000},"cycleRequest":{"adapterId":"fixture.adapter","allowedModuleIds":["fixture.module"],"cycleId":"01900000-0000-7000-8000-000000000003","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","configurationProvenanceDigest":"6cb88ecc36a83f0d147de82f0d55aa9c92ad9d39f743ab8698cf943fdaf99e81","configurationSourceDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000006"}},"descriptor":{"abi":"orchestration-module/v1","actions":[{"actionKind":"fixture.direct","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":false},{"actionKind":"fixture.inspect","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":true}],"compatibility":[{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","engineVersion":"0.0.0","policyVersion":"1.2.3"}],"dispatchCatalog":[{"actionKind":"fixture.inspect","capabilityName":"work.read","code":"verify","directiveKind":"VERIFICATION","planAccessor":"IMMUTABLE_SUBJECT_DIGEST","templateId":"template.verify"}],"dispositionCodes":["decision.done","finding.blocked"],"inputSchemas":["module-plan-input/v1"],"moduleId":"fixture.module","moduleVersion":"1.0.0","outputSchemas":["module-action-plan/v1","module-no-action/v1"],"schemaVersion":"module-descriptor/v1"},"policyFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","decisions":[{"capabilityName":"work.read","trip":"TRIP"}],"observationId":"01900000-0000-7000-8000-000000000005","observedAt":"2026-08-31T01:00:00.001Z","policyVersion":"1.2.3","projectFactsDigest":"850e033912e587726788238a4c80a9caea6fe605e7c951232bc84e0900f851e0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-breaker-facts/v1","state":"COMPLETE"},"projectFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","frontier":[{"capabilityNames":["work.read"],"immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","readiness":"READY","workId":"01900000-0000-7000-8000-000000000002"}],"frontierDigest":"e1fd114d0aa64349f2ff70dc4f4e8e3b15a6a16d0380524937ed4ba09ed483d2","observationId":"01900000-0000-7000-8000-000000000004","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-facts/v1","state":"COMPLETE"},"reviewSubject":null,"schemaVersion":"module-plan-input/v1"},"preflight":{"actionPlanDigest":"8033fd5f2d80676b3df533ee4dcef3dede307298155a9651720698bf1c2c9b06","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"ELIGIBLE"},"routeDigest":"8d027c53eaa8826c7660c8929ff362240b1d81b5e9f588165ce1a0e18d344682","schemaVersion":"project-preflight/v1"},"review":null,"route":{"actionPlanDigest":"8033fd5f2d80676b3df533ee4dcef3dede307298155a9651720698bf1c2c9b06","hostMappingDigest":null,"outcome":{"kind":"NO_WORKER"},"schemaVersion":"route-selection/v1"},"skips":[{"reason":"no-allocation","schemaVersion":"routine-step-skip/v1","step":{"cycleId":"01900000-0000-7000-8000-000000000003","inputDigest":"82607cb841f96ddcec7d55bf36cd2ba1c02909b29f81cc9733c8d4380a46b19b","kind":"dispatch.plan","ordinal":"7","predecessorJournalDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}},{"reason":"no-worker","schemaVersion":"routine-step-skip/v1","step":{"cycleId":"01900000-0000-7000-8000-000000000003","inputDigest":"e4fc89037af561e40739a5c4ce14958afee1082b4ef345b0869399bda7fc0ecb","kind":"worker.dispatch","ordinal":"8","predecessorJournalDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}},{"reason":"no-worker","schemaVersion":"routine-step-skip/v1","step":{"cycleId":"01900000-0000-7000-8000-000000000003","inputDigest":"f2a37d412f52fc0435130cb8551b1940684d39e2abd3aebe7f7fb54b4416d4e8","kind":"worker.observe","ordinal":"9","predecessorJournalDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}},{"reason":"no-review","schemaVersion":"routine-step-skip/v1","step":{"cycleId":"01900000-0000-7000-8000-000000000003","inputDigest":"831d42c500915a8fffceba9aec29c9778c116665cbfdafd4eaeb6ea6c82abe50","kind":"review.reduce","ordinal":"10","predecessorJournalDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}}],"worker":null}\n',
  digest: "919d4e8961ac7fa53c6e9d76b458e9315e92814f9b7488a481c4f9788bd61abd",
} as const;
