import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as c from "../../packages/contracts/src/index.js";

const schema = "project-preflight/v1";
const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fresh = () => JSON.parse(inputLiteral);
const inline = (index: number) => JSON.parse(inlineGoldens[index]!.text);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const subject = (index: number) => inline(index + 3).result.subject;
const targetDigest = (value: ReturnType<typeof fresh>) =>
  value.schemaVersion === "worker-result-subject/v1"
    ? c.computeWorkerResultSubjectDigest(value)
    : c.computeReleaseCandidateSubjectDigest(value);
function refresh(input: ReturnType<typeof fresh>) {
  const digest = c.canonicalDigest(input.adapterConfiguration);
  input.projectFacts.adapterConfigurationDigest = digest;
  input.policyFacts.adapterConfigurationDigest = digest;
  input.projectFacts.frontierDigest = c.canonicalDigest(input.projectFacts.frontier);
  input.policyFacts.projectFactsDigest = c.canonicalDigest(input.projectFacts);
  input.cycleRequest.sessionRequest.configurationProvenanceDigest = c.canonicalDigest(
    input.configurationProvenance,
  );
}
function context(worker = true, review: unknown = null, input = fresh()) {
  input.reviewSubject = copy(review);
  const role = review === null ? "observer" : "review";
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
function observation(a: ReturnType<typeof context>): ReturnType<typeof fresh> {
  return a.input.reviewSubject === null
    ? { kind: "PROJECT", facts: { ...copy(a.input.projectFacts), observationId: id(90) } }
    : {
        kind: "REVIEW",
        adapterConfigurationDigest: c.canonicalDigest(a.input.adapterConfiguration),
        observationId: id(90),
        observedAt: a.input.projectFacts.observedAt,
        result: { kind: "AVAILABLE", subject: copy(a.input.reviewSubject) },
      };
}
const outcome = (kind: string, reason?: string) =>
  reason === undefined ? { kind } : { kind, reason };
function record(a: ReturnType<typeof context>, obs: unknown, result = outcome("ELIGIBLE")) {
  return {
    actionPlanDigest: c.computeModuleActionPlanDigest(a.plan),
    observationDigest:
      result.reason === "OBSERVATION_UNAVAILABLE" || result.reason === "OBSERVATION_INVALID"
        ? null
        : c.computeProjectPreflightObservationDigest(obs),
    outcome: result,
    routeDigest: c.computeRouteSelectionDigest(a.route),
    schemaVersion: schema,
  };
}
const bind = (a: ReturnType<typeof context>, obs: unknown, value: unknown) =>
  c.validateProjectPreflightBinding(a.input, a.plan, a.mapping, a.route, obs, value);
function valid(a: ReturnType<typeof context>, obs: unknown, result = outcome("ELIGIBLE")) {
  const value = record(a, obs, result);
  expect(bind(a, obs, value)).toEqual({ ok: true, value });
  return value;
}
function refrontier(obs: ReturnType<typeof inline>) {
  obs.facts.frontierDigest = c.canonicalDigest(obs.facts.frontier);
  return obs;
}

test("pins all eleven public outcome cells and eight full inline observation hashes independently", () => {
  for (const golden of goldens) {
    const value = JSON.parse(golden.text),
      bytes = new TextEncoder().encode(golden.text);
    expect(c.parseProjectPreflight(value)).toEqual({ ok: true, value });
    expect(c.parseContract(schema, value)).toEqual({ ok: true, value });
    expect(c.serializeContract(schema, value)).toEqual({ ok: true, bytes, digest: golden.digest });
    expect(c.computeProjectPreflightDigest(value)).toBe(golden.digest);
    expect(Buffer.from(c.framedBytes(schema, [c.frame.canonical(value)])).toString("hex")).toBe(
      golden.frameHex,
    );
    expect(hash(Buffer.from(golden.frameHex, "hex"))).toBe(golden.digest);
    expect(hash(golden.text)).not.toBe(golden.digest);
    expect(c.parseCanonicalContractBytes(schema, bytes)).toEqual({ ok: true, value });
    expect(
      c.serializeContract(schema, Object.fromEntries(Object.entries(value).reverse())),
    ).toEqual({ ok: true, bytes, digest: golden.digest });
    for (const text of [
      golden.text.trimEnd(),
      golden.text.replace(/\n$/, "\r\n"),
      "\ufeff" + golden.text,
      JSON.stringify(Object.fromEntries(Object.entries(value).reverse())) + "\n",
    ])
      expect(c.parseCanonicalContractBytes(schema, new TextEncoder().encode(text)).ok).toBe(false);
    const frame = Buffer.from(golden.frameHex, "hex"),
      prefix = Buffer.byteLength("orchestration-platform\0project-preflight/v1\0");
    for (const offset of [0, prefix + 3, prefix + 4, frame.length - 1]) {
      const changed = Buffer.from(frame);
      changed[offset] = changed[offset]! ^ 1;
      expect(hash(changed)).not.toBe(golden.digest);
    }
  }
  for (const golden of inlineGoldens) {
    const value = JSON.parse(golden.text);
    expect(c.parseProjectPreflightObservation(value)).toEqual({ ok: true, value });
    expect(c.computeProjectPreflightObservationDigest(value)).toBe(golden.digest);
    expect(c.canonicalJson(value)).toBe(golden.text);
    expect(hash(golden.text)).toBe(golden.digest);
    const nested = value.kind === "PROJECT" ? value.facts : value.result;
    expect(c.canonicalDigest(nested)).not.toBe(golden.digest);
    expect(
      c.computeProjectPreflightObservationDigest(
        Object.fromEntries(Object.entries(value).reverse()),
      ),
    ).toBe(golden.digest);
  }
});

test("new records close every member, reason and null cell without creating an observation schema", () => {
  for (const golden of goldens) {
    const value = JSON.parse(golden.text);
    for (const path of [[], ["outcome"]]) {
      const original = path.length ? value.outcome : value;
      const extra = copy(value);
      (path.length ? extra.outcome : extra).extra = true;
      expect(c.parseProjectPreflight(extra).ok).toBe(false);
      for (const key of Object.keys(original)) {
        const missing = copy(value);
        delete (path.length ? missing.outcome : missing)[key];
        expect(c.parseProjectPreflight(missing).ok).toBe(false);
        const bad = copy(value);
        (path.length ? bad.outcome : bad)[key] = 7;
        expect(c.parseProjectPreflight(bad).ok).toBe(false);
      }
    }
    const opposite = {
      ...value,
      observationDigest: value.observationDigest === null ? "b".repeat(64) : null,
    };
    expect(c.parseProjectPreflight(opposite).ok).toBe(false);
    for (const bad of [
      { ...value, schemaVersion: "project-preflight/v2" },
      { ...value, actionPlanDigest: "A".repeat(64) },
      { ...value, routeDigest: "a".repeat(63) },
      { ...value, outcome: { kind: "ELIGIBLE", reason: null } },
      { ...value, outcome: { kind: "UNKNOWN", reason: "WORK_MISSING" } },
    ])
      expect(c.parseProjectPreflight(bad).ok).toBe(false);
  }
  for (let index = 0; index < inlineGoldens.length; index++) {
    const original = inline(index),
      paths = original.kind === "PROJECT" ? [[], ["facts"]] : [[], ["result"]];
    for (const path of paths) {
      const row = path.length ? original[path[0]!] : original;
      const extra = copy(original);
      (path.length ? extra[path[0]!] : extra).extra = true;
      expect(c.parseProjectPreflightObservation(extra).ok).toBe(false);
      for (const key of Object.keys(row)) {
        const missing = copy(original);
        delete (path.length ? missing[path[0]!] : missing)[key];
        expect(c.parseProjectPreflightObservation(missing).ok).toBe(false);
        const bad = copy(original);
        (path.length ? bad[path[0]!] : bad)[key] = null;
        expect(c.parseProjectPreflightObservation(bad).ok).toBe(false);
      }
    }
    expect(
      c.parseProjectPreflightObservation({
        ...original,
        schemaVersion: "project-preflight-observation/v1",
      }).ok,
    ).toBe(false);
  }
  const alias = inline(3);
  alias.result.subject.schemaVersion = "review-subject/v1";
  expect(c.parseProjectPreflightObservation(alias).ok).toBe(false);
  const bare = inline(3);
  bare.result.subject = c.computeWorkerResultSubjectDigest(bare.result.subject);
  expect(c.parseProjectPreflightObservation(bare).ok).toBe(false);
  for (const bad of ["2026-02-30T00:00:00.000Z", "2026-08-31T00:00:00Z", null])
    expect(c.parseProjectPreflightObservation({ ...inline(3), observedAt: bad }).ok).toBe(false);
  for (const observationId of [
    "not-uuid",
    ...["\n", "\r", "\u2028", "\u2029"].map((end) => id(90) + end),
    id(90).toUpperCase(),
    null,
  ])
    expect(c.parseProjectPreflightObservation({ ...inline(3), observationId }).ok).toBe(false);
});

test("worker and workerless actions bind a distinct observation without pretending it proves freshness", () => {
  for (const worker of [true, false]) {
    const a = context(worker),
      obs = observation(a);
    const eligible = valid(a, obs);
    expect(obs.facts.observedAt).toBe(a.input.projectFacts.observedAt);
    expect(obs.facts.frontierDigest).toBe(a.input.projectFacts.frontierDigest);
    expect(obs.facts.observationId).not.toBe(a.input.projectFacts.observationId);
    valid(a, obs, outcome("UNKNOWN", "ADMISSION_UNPROVEN"));
    const next = copy(obs);
    next.facts.observationId = id(91);
    expect(record(a, next).observationDigest).not.toBe(eligible.observationDigest);
    valid(a, next);
    const time = copy(obs);
    time.facts.observedAt = "2000-01-01T00:00:00.000Z";
    valid(a, time); // No added timestamp ordering or live-currentness claim.
    expect(bind(a, next, eligible).ok).toBe(false);
    const parsed = c.parseProjectPreflightObservation(obs);
    const before = copy(obs);
    obs.facts.frontier[0].readiness = "NOT_READY";
    expect(parsed).toEqual({ ok: true, value: before });
  }
});

test("null, invalid, well-formed source failure and external admission uncertainty are distinct", () => {
  for (const review of [null, subject(0)]) {
    const a = context(true, review);
    valid(a, null, outcome("UNKNOWN", "OBSERVATION_UNAVAILABLE"));
    for (const value of [undefined, {}, []])
      expect(
        bind(a, value, record(a, null, outcome("UNKNOWN", "OBSERVATION_UNAVAILABLE"))).ok,
      ).toBe(false);
    for (const value of [{}, [], "invalid", { ...observation(a), extra: true }])
      valid(a, value, outcome("UNKNOWN", "OBSERVATION_INVALID"));
    for (const value of [undefined, null, observation(a)])
      expect(bind(a, value, record(a, {}, outcome("UNKNOWN", "OBSERVATION_INVALID"))).ok).toBe(
        false,
      );
    for (const state of ["UNAVAILABLE", "UNKNOWN"]) {
      const obs = observation(a);
      if (review === null) {
        delete obs.facts.frontier;
        delete obs.facts.frontierDigest;
        obs.facts.state = state;
        obs.facts.reason = state === "UNAVAILABLE" ? "SOURCE_UNAVAILABLE" : "SOURCE_UNKNOWN";
      } else obs.result = { kind: state };
      valid(
        a,
        obs,
        outcome("UNKNOWN", state === "UNAVAILABLE" ? "SOURCE_UNAVAILABLE" : "SOURCE_UNKNOWN"),
      );
      valid(a, obs, outcome("UNKNOWN", "ADMISSION_UNPROVEN"));
      expect(bind(a, obs, record(a, obs)).ok).toBe(false);
    }
  }
});

test("bound observation checks reject wrong context, configuration, project, capability census and IDs", () => {
  for (const review of [null, subject(0)]) {
    const a = context(true, review),
      seed = observation(a);
    const changed: ReturnType<typeof inline>[] = [review === null ? inline(3) : inline(0)];
    for (const observationId of [
      a.input.projectFacts.observationId,
      a.input.policyFacts.observationId,
    ]) {
      const obs = copy(seed);
      (review === null ? obs.facts : obs).observationId = observationId;
      changed.push(obs);
    }
    const config = copy(seed);
    (review === null ? config.facts : config).adapterConfigurationDigest = "9".repeat(64);
    changed.push(config);
    if (review === null) {
      const project = copy(seed);
      project.facts.projectId = id(999);
      changed.push(project);
      const census = copy(seed);
      census.facts.frontier[0].capabilityNames = ["work.other"];
      changed.push(refrontier(census));
      for (const state of ["UNAVAILABLE", "UNKNOWN"]) {
        const failure = copy(project);
        delete failure.facts.frontier;
        delete failure.facts.frontierDigest;
        failure.facts.state = state;
        failure.facts.reason = state === "UNAVAILABLE" ? "SOURCE_UNAVAILABLE" : "SOURCE_UNKNOWN";
        changed.push(failure);
      }
    }
    for (const obs of changed) {
      expect(c.parseProjectPreflightObservation(obs).ok).toBe(true);
      valid(a, obs, outcome("UNKNOWN", "OBSERVATION_INVALID"));
      expect(bind(a, obs, record(a, obs)).ok).toBe(false);
      expect(bind(a, obs, record(a, obs, outcome("UNKNOWN", "ADMISSION_UNPROVEN"))).ok).toBe(false);
    }
  }
});

test("ordinary refusal priority includes complete frontier changes outside the chosen row", () => {
  const input = fresh();
  input.projectFacts.frontier.push({ ...copy(input.projectFacts.frontier[0]), workId: id(20) });
  refresh(input);
  const a = context(true, null, input),
    base = observation(a);
  const changes: Array<[string, (obs: ReturnType<typeof inline>) => void]> = [
    [
      "WORK_MISSING",
      (obs) => {
        obs.facts.frontier.shift();
      },
    ],
    [
      "TARGET_CHANGED",
      (obs) => {
        obs.facts.frontier[0].immutableSubjectDigest = "9".repeat(64);
      },
    ],
    [
      "CAPABILITY_REMOVED",
      (obs) => {
        obs.facts.frontier[0].capabilityNames = [];
      },
    ],
    [
      "NOT_READY",
      (obs) => {
        obs.facts.frontier[0].readiness = "NOT_READY";
      },
    ],
    [
      "FRONTIER_CHANGED",
      (obs) => {
        obs.facts.frontier[1].readiness = "NOT_READY";
      },
    ],
  ];
  valid(a, base);
  for (let first = 0; first < changes.length; first++) {
    const obs = copy(base);
    // Apply lower-priority changes first, then the selected first applicable condition.
    for (let index = changes.length - 1; index >= first; index--) changes[index]![1](obs);
    refrontier(obs);
    valid(a, obs, outcome("REFUSED", changes[first]![0]));
    for (const [reason] of changes)
      if (reason !== changes[first]![0])
        expect(bind(a, obs, record(a, obs, outcome("REFUSED", reason))).ok).toBe(false);
  }
  for (const mutate of [
    (obs: ReturnType<typeof inline>) => {
      obs.facts.frontier.pop();
    },
    (obs: ReturnType<typeof inline>) => {
      obs.facts.frontier.push({ ...copy(obs.facts.frontier[1]), workId: id(21) });
    },
    (obs: ReturnType<typeof inline>) => {
      obs.facts.frontier[1].immutableSubjectDigest = "8".repeat(64);
    },
  ]) {
    const obs = copy(base);
    mutate(obs);
    refrontier(obs);
    valid(a, obs, outcome("REFUSED", "FRONTIER_CHANGED"));
  }
  const emptyInput = copy(a);
  emptyInput.input.projectFacts.frontier = [];
  refresh(emptyInput.input);
  emptyInput.plan.inputDigest = c.computeModulePlanInputDigest(emptyInput.input);
  emptyInput.route.actionPlanDigest = c.computeModuleActionPlanDigest(emptyInput.plan);
  expect(bind(emptyInput, base, record(emptyInput, base)).ok).toBe(false);
});

test("all six supplied preimages remain joined, including rejected routes and workerless substitutions", () => {
  const a = context(),
    obs = observation(a),
    value = valid(a, obs);
  for (const field of ["actionPlanDigest", "routeDigest", "observationDigest"] as const)
    expect(bind(a, obs, { ...value, [field]: "9".repeat(64) }).ok).toBe(false);
  const changes: Array<(v: ReturnType<typeof inline>) => void> = [
    (v) => {
      v.input.cycleRequest.cycleId = id(80);
    },
    (v) => {
      v.input.descriptor.moduleVersion = "2.0.0";
    },
    (v) => {
      v.plan.workId = id(81);
    },
    (v) => {
      v.plan.actionCore.capabilityName = "work.other";
    },
    (v) => {
      v.plan.actionCore.requestedRole = "review";
    },
    (v) => {
      v.plan.actionCore.immutableSubjectDigest = "9".repeat(64);
    },
    (v) => {
      v.mapping[0].hostRendererArtifactDigest = "9".repeat(64);
    },
  ];
  for (const change of changes) {
    const changed = copy(a);
    change(changed);
    const core = changed.plan.actionCore,
      brief = changed.plan.dispatchBrief!;
    Object.assign(brief.action, {
      actionCoreDigest: c.computeDispatchActionCoreDigest(core),
      actionKind: core.actionKind,
      capabilityName: core.capabilityName,
      immutableSubjectDigest: core.immutableSubjectDigest,
      moduleDescriptorDigest: core.moduleDescriptorDigest,
    });
    brief.role = core.requestedRole;
    for (const directive of brief.directives) directive.subjectDigest = core.immutableSubjectDigest;
    const artifact = changed.mapping![0]!;
    artifact.workerHostIdentityDigest = c.computeWorkerHostIdentityDigest({
      capabilityNames: artifact.capabilityNames,
      hostRendererArtifactDigest: artifact.hostRendererArtifactDigest,
      schemaVersion: "worker-host-identity/v1",
    });
    changed.route.actionPlanDigest = c.computeModuleActionPlanDigest(changed.plan);
    changed.route.hostMappingDigest = c.computeRouteMappingDigest(changed.mapping);
    expect(c.parseModulePlanInput(changed.input).ok).toBe(true);
    expect(c.parseModuleActionPlan(changed.plan).ok).toBe(true);
    expect(c.parseWorkerHostRendererArtifacts(changed.mapping).ok).toBe(true);
    expect(c.parseRouteSelection(changed.route).ok).toBe(true);
    // Rehashed downstream claims cannot repair the deliberately broken upstream relation.
    expect(bind(changed, obs, record(changed, obs)).ok).toBe(false);
  }
  const extraHost = copy(a);
  const identity = {
    capabilityNames: ["work.read"],
    hostRendererArtifactDigest: "2".repeat(64),
    schemaVersion: "worker-host-identity/v1",
  };
  extraHost.mapping!.push({
    ...identity,
    schemaVersion: "worker-host-renderer-artifact/v1",
    workerHostIdentityDigest: c.computeWorkerHostIdentityDigest(identity),
  });
  expect(c.parseWorkerHostRendererArtifacts(extraHost.mapping).ok).toBe(true);
  expect(bind(extraHost, obs, value).ok).toBe(false);
  const refused = copy(a);
  const unsupportedIdentity = { ...identity, capabilityNames: ["work.other"] };
  const unsupported = [
    {
      ...unsupportedIdentity,
      schemaVersion: "worker-host-renderer-artifact/v1",
      workerHostIdentityDigest: c.computeWorkerHostIdentityDigest(unsupportedIdentity),
    },
  ];
  const noHost = {
    ...refused.route,
    hostMappingDigest: c.computeRouteMappingDigest(unsupported),
    outcome: { kind: "REFUSED", reason: "NO_SUPPORTED_HOST" },
  };
  expect(c.validateRouteSelectionBinding(refused.input, refused.plan, unsupported, noHost).ok).toBe(
    true,
  );
  expect(
    c.validateProjectPreflightBinding(refused.input, refused.plan, unsupported, noHost, obs, {
      ...value,
      routeDigest: c.computeRouteSelectionDigest(noHost),
    }).ok,
  ).toBe(false);
  const unknown = { ...a.route, outcome: { kind: "UNKNOWN", reason: "ADMISSION_UNPROVEN" } };
  expect(c.validateRouteSelectionBinding(a.input, a.plan, a.mapping, unknown).ok).toBe(true);
  expect(
    c.validateProjectPreflightBinding(a.input, a.plan, a.mapping, unknown, obs, {
      ...value,
      routeDigest: c.computeRouteSelectionDigest(unknown),
    }).ok,
  ).toBe(false);
  const direct = context(false),
    directObs = observation(direct);
  valid(direct, directObs);
  expect(
    c.validateProjectPreflightBinding(direct.input, direct.plan, a.mapping, a.route, directObs, {
      ...record(direct, directObs),
      routeDigest: c.computeRouteSelectionDigest(a.route),
    }).ok,
  ).toBe(false);
  expect(
    c.validateProjectPreflightBinding(a.input, a.plan, null, direct.route, obs, {
      ...value,
      routeDigest: c.computeRouteSelectionDigest(direct.route),
    }).ok,
  ).toBe(false);
  const opposite = context(true, subject(0));
  expect(bind(opposite, obs, record(opposite, obs)).ok).toBe(false);
});

test("all concrete review subjects retain namespace, ordering and every immutable identity member", () => {
  for (let index = 0; index < 3; index++) {
    const a = context(true, subject(index)),
      obs = observation(a);
    valid(a, obs);
    const key = index === 2 ? "landedSource" : "baseSource";
    expect(obs.result.subject[key].adapterId).not.toBe(a.input.adapterConfiguration.adapterId);
    valid(a, obs, outcome("UNKNOWN", "ADMISSION_UNPROVEN"));
    const replacements = [subject((index + 1) % 3)];
    for (const field of Object.keys(obs.result.subject).filter(
      (field) => !["schemaVersion", key, "result"].includes(field),
    )) {
      const changed = copy(obs.result.subject);
      changed[field] = field.endsWith("Id") ? id(95) : "9".repeat(64);
      replacements.push(changed);
    }
    for (const field of ["adapterId", "projectId", "revision"]) {
      const changed = copy(obs.result.subject);
      changed[key][field] =
        field === "adapterId" ? "source.other" : field === "projectId" ? id(96) : "9".repeat(40);
      replacements.push(changed);
    }
    if (index === 0) {
      const changed = copy(obs.result.subject);
      changed.result.treeDigest = "9".repeat(64);
      replacements.push(changed);
    }
    if (index === 1) {
      const changed = copy(obs.result.subject);
      changed.result.entries.reverse();
      replacements.push(changed);
      const content = copy(obs.result.subject);
      content.result.entries[0].contentDigest = "9".repeat(64);
      replacements.push(content);
    }
    for (const replacement of replacements) {
      expect(c.parseReviewSubject(replacement).ok).toBe(true);
      expect(targetDigest(replacement)).not.toBe(targetDigest(a.input.reviewSubject));
      const changed = copy(obs);
      changed.result.subject = replacement;
      valid(a, changed, outcome("REFUSED", "TARGET_CHANGED"));
      expect(bind(a, changed, record(a, changed)).ok).toBe(false);
    }
    // Only observation metadata changes: its commitment changes, while target stays eligible.
    const metadata = copy(obs);
    metadata.observedAt = "2026-08-31T00:59:59.999Z";
    metadata.observationId = id(92);
    expect(record(a, metadata).observationDigest).not.toBe(record(a, obs).observationDigest);
    valid(a, metadata);
  }
});

test("full reused frontier, capability and ordered-subject bounds have positive relation witnesses", () => {
  const a = context(false);
  for (const count of [0, 1, 4096, 4097]) {
    const obs = observation(a);
    obs.facts.frontier = Array.from({ length: count }, (_, n) => ({
      ...copy(a.input.projectFacts.frontier[0]),
      workId: id(n + 2),
    }));
    // Construct these trusted fixture rows in literal canonical key order using stdlib only;
    // the production canonicalizer correctly refuses the 4097-row negative before hashing.
    obs.facts.frontierDigest = hash(
      JSON.stringify(
        obs.facts.frontier.map((row: ReturnType<typeof fresh>) => ({
          capabilityNames: row.capabilityNames,
          immutableSubjectDigest: row.immutableSubjectDigest,
          readiness: row.readiness,
          workId: row.workId,
        })),
      ) + "\n",
    );
    expect(c.parseProjectPreflightObservation(obs).ok, `frontier:${count}`).toBe(count <= 4096);
    if (count <= 4096)
      valid(
        a,
        obs,
        count === 0
          ? outcome("REFUSED", "WORK_MISSING")
          : count === 1
            ? outcome("ELIGIBLE")
            : outcome("REFUSED", "FRONTIER_CHANGED"),
      );
  }
  for (const count of [0, 1, 256, 257]) {
    // Current configuration admits the full valid 256-name census: a parser failure must not mask it.
    const input = fresh(),
      names = [
        ...Array.from({ length: 255 }, (_, n) => `cap.a${String(n).padStart(3, "0")}`),
        "work.read",
      ];
    input.adapterConfiguration.capabilityNames = names;
    input.configurationProvenance.capabilityNames = names;
    input.policyFacts.decisions = names.map((capabilityName) => ({
      capabilityName,
      trip: "NO_TRIP",
    }));
    refresh(input);
    const current = context(false, null, input),
      obs = observation(current);
    obs.facts.frontier[0].capabilityNames =
      count === 0
        ? []
        : count === 1
          ? ["work.read"]
          : count === 256
            ? names
            : ["cap.000", ...names];
    refrontier(obs);
    expect(c.parseProjectPreflightObservation(obs).ok, `capability:${count}`).toBe(count <= 256);
    if (count <= 256)
      valid(
        current,
        obs,
        count === 0
          ? outcome("REFUSED", "CAPABILITY_REMOVED")
          : count === 1
            ? outcome("ELIGIBLE")
            : outcome("REFUSED", "FRONTIER_CHANGED"),
      );
  }
  for (const count of [0, 1, 4096, 4097]) {
    const target = subject(1);
    target.result.entries = Array.from({ length: count }, () => ({
      kind: "PATCH",
      contentDigest: "c".repeat(64),
    }));
    const obs = inline(4);
    obs.result.subject = target;
    expect(c.parseProjectPreflightObservation(obs).ok, `ordered:${count}`).toBe(
      count > 0 && count <= 4096,
    );
    if (count > 0 && count <= 4096) {
      const review = context(true, target);
      valid(review, observation(review));
      const repeated = observation(review);
      repeated.result.subject.result.entries.reverse();
      valid(review, repeated);
    }
  }
  const duplicate = observation(a);
  duplicate.facts.frontier.push(copy(duplicate.facts.frontier[0]));
  refrontier(duplicate);
  expect(c.parseProjectPreflightObservation(duplicate).ok).toBe(false);
  const unsorted = observation(a);
  unsorted.facts.frontier.unshift({ ...copy(unsorted.facts.frontier[0]), workId: id(99) });
  refrontier(unsorted);
  expect(c.parseProjectPreflightObservation(unsorted).ok).toBe(false);
  const sparse = inline(4);
  sparse.result.subject.result.entries = new Array(1);
  expect(c.parseProjectPreflightObservation(sparse).ok).toBe(false);
});

test("hostile inline values and six-input relations invoke no supplied code", () => {
  const a = context(),
    good = observation(a);
  let calls = 0;
  const getter = copy(good);
  Object.defineProperty(getter.facts.frontier[0], "immutableSubjectDigest", {
    enumerable: true,
    get() {
      calls++;
      return "a".repeat(64);
    },
  });
  const proxy = copy(good);
  proxy.facts.frontier = new Proxy([], {
    ownKeys() {
      calls++;
      return [];
    },
  });
  const symbol = copy(good);
  symbol[Symbol("hidden")] = true;
  const exotic = copy(good);
  exotic.facts = new Date();
  for (const obs of [getter, proxy, symbol, exotic]) {
    expect(c.parseProjectPreflightObservation(obs).ok).toBe(false);
    expect(() => c.computeProjectPreflightObservationDigest(obs)).toThrow();
    valid(a, obs, outcome("UNKNOWN", "OBSERVATION_INVALID"));
  }
  const receipt = record(a, good);
  Object.defineProperty(receipt, "actionPlanDigest", {
    enumerable: true,
    get() {
      calls++;
      return "a".repeat(64);
    },
  });
  expect(c.parseProjectPreflight(receipt).ok).toBe(false);
  expect(bind(a, good, receipt).ok).toBe(false);
  for (const key of ["input", "plan", "mapping", "route"] as const) {
    const changed = copy(a);
    const value = new Proxy(
      {},
      {
        ownKeys() {
          calls++;
          return [];
        },
      },
    );
    expect(
      c.validateProjectPreflightBinding(
        key === "input" ? value : changed.input,
        key === "plan" ? value : changed.plan,
        key === "mapping" ? value : changed.mapping,
        key === "route" ? value : changed.route,
        good,
        record(a, good),
      ).ok,
    ).toBe(false);
  }
  expect(calls).toBe(0);
});

// Stdlib-only JSON sorting, binary framing and SHA-256; no implementation oracle.
const goldens = [
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"ELIGIBLE"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f763100000000010700000000000001457b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22454c494749424c45227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "3c02711154e95bc2758cfd7040f611a954d9bc0e6335f681d285adf11ca00314",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"REFUSED","reason":"WORK_MISSING"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f7631000000000107000000000000015c7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a22574f524b5f4d495353494e47227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "bb574b2eaccdcb390dcea71331693c165b553445150feba1a1a7c4007b00b070",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"REFUSED","reason":"TARGET_CHANGED"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f7631000000000107000000000000015e7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a225441524745545f4348414e474544227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "019d684d4484c89463a925683361a2fd289a98a52d7c82d2768e112e722c1d49",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"REFUSED","reason":"CAPABILITY_REMOVED"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f763100000000010700000000000001627b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a224341504142494c4954595f52454d4f564544227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "219e06da1d9e653c2f20e3425010e847e845438394ffb2377128bcf63ad46b23",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"REFUSED","reason":"NOT_READY"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f763100000000010700000000000001597b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a224e4f545f5245414459227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "10bd859e9b11ddcf93918304fe93d8781ad8f13800f6e8de30f7a1ddb82d05b3",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"REFUSED","reason":"FRONTIER_CHANGED"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f763100000000010700000000000001607b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a2246524f4e544945525f4348414e474544227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "3470422fe90ca25ea9f0af54d7d3d6c3f0d5a742295e93c107b8fe1dc0fc71cc",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":null,"outcome":{"kind":"UNKNOWN","reason":"OBSERVATION_UNAVAILABLE"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f763100000000010700000000000001297b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224f42534552564154494f4e5f554e415641494c41424c45227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "11c66961e8cd5bfbba2ed241e4ca4032a146376ba06d9321d661a8b42c0f409d",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":null,"outcome":{"kind":"UNKNOWN","reason":"OBSERVATION_INVALID"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f763100000000010700000000000001257b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224f42534552564154494f4e5f494e56414c4944227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "24c25ecfd2fe37c19145010d7668a7fd1a8e1c35683fa9d6ac6d0f2a7773f4e0",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"UNKNOWN","reason":"SOURCE_UNAVAILABLE"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f763100000000010700000000000001627b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22534f555243455f554e415641494c41424c45227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "8aec295a3611cb48999770d4b6afd324328138848a9927d9958fef380ae54f05",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"UNKNOWN","reason":"SOURCE_UNKNOWN"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f7631000000000107000000000000015e7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22534f555243455f554e4b4e4f574e227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "bea2ea1ad5dadb91eb786098647ed31d1238ec6c74198e582a39419ee459a1d2",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"UNKNOWN","reason":"ADMISSION_UNPROVEN"},"routeDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","schemaVersion":"project-preflight/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0070726f6a6563742d707265666c696768742f763100000000010700000000000001627b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226f62736572766174696f6e446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a2241444d495353494f4e5f554e50524f56454e227d2c22726f757465446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22736368656d6156657273696f6e223a2270726f6a6563742d707265666c696768742f7631227d0a",
    digest: "3448f3eca99a9b155089ccd48e50f5248bc7a7e374b0539c9f30358e325d17a4",
  },
] as const;
const inlineGoldens = [
  {
    text: '{"facts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","frontier":[{"capabilityNames":["work.read"],"immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","readiness":"READY","workId":"01900000-0000-7000-8000-000000000002"}],"frontierDigest":"e1fd114d0aa64349f2ff70dc4f4e8e3b15a6a16d0380524937ed4ba09ed483d2","observationId":"01900000-0000-7000-8000-000000000090","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-facts/v1","state":"COMPLETE"},"kind":"PROJECT"}\n',
    digest: "fa6c8bec8bb8d53ae2e1f2ace298d851f2f32d65947abbd90c9484173db3af67",
  },
  {
    text: '{"facts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","observationId":"01900000-0000-7000-8000-000000000090","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","reason":"SOURCE_UNAVAILABLE","schemaVersion":"project-facts/v1","state":"UNAVAILABLE"},"kind":"PROJECT"}\n',
    digest: "cc8b5f2a787ac037c4196bce682ebc2a739827b89bc9366838a72caf9d2c7538",
  },
  {
    text: '{"facts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","observationId":"01900000-0000-7000-8000-000000000090","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","reason":"SOURCE_UNKNOWN","schemaVersion":"project-facts/v1","state":"UNKNOWN"},"kind":"PROJECT"}\n',
    digest: "197223285447216d6f4af63f503a5803b9c09eeb87ea33ca9db15a919ae950db",
  },
  {
    text: '{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","kind":"REVIEW","observationId":"01900000-0000-7000-8000-000000000090","observedAt":"2026-08-31T01:00:00.000Z","result":{"kind":"AVAILABLE","subject":{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"kind":"TREE","treeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}}\n',
    digest: "f4adc806f5aa970096ed7e5a711e07a3769692723b9345906e9809b97027e775",
  },
  {
    text: '{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","kind":"REVIEW","observationId":"01900000-0000-7000-8000-000000000090","observedAt":"2026-08-31T01:00:00.000Z","result":{"kind":"AVAILABLE","subject":{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"entries":[{"contentDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","kind":"PATCH"},{"contentDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","kind":"ARTIFACT"}],"kind":"ORDERED_PATCH_ARTIFACTS"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}}\n',
    digest: "85daf1bd1fa286167b098f447ba3caaba06ce9e13b0dcc978af634acd10e2a98",
  },
  {
    text: '{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","kind":"REVIEW","observationId":"01900000-0000-7000-8000-000000000090","observedAt":"2026-08-31T01:00:00.000Z","result":{"kind":"AVAILABLE","subject":{"assemblyCycleId":"01900000-0000-7000-8000-000000000004","candidateDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","certificationDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","landedSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"landedTreeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","manifestDigest":"1111111111111111111111111111111111111111111111111111111111111111","schemaVersion":"release-candidate-subject/v1","testBundleDigest":"2222222222222222222222222222222222222222222222222222222222222222"}}}\n',
    digest: "a61edf539a8785b3c940cbde4a8c72d84fb07a1c171df57483eea6559584ecce",
  },
  {
    text: '{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","kind":"REVIEW","observationId":"01900000-0000-7000-8000-000000000090","observedAt":"2026-08-31T01:00:00.000Z","result":{"kind":"UNAVAILABLE"}}\n',
    digest: "5cc3fd5d3a482c855727b622feca12597850df23ea49a1f5cffbc3b57c829b8c",
  },
  {
    text: '{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","kind":"REVIEW","observationId":"01900000-0000-7000-8000-000000000090","observedAt":"2026-08-31T01:00:00.000Z","result":{"kind":"UNKNOWN"}}\n',
    digest: "b8ee838a48ed281257c1682160a9a025c9ffa0fc138c5f855e329556a5edc749",
  },
] as const;
// Fixed previously reviewed module input and concrete subject literals.
const inputLiteral =
  '{"adapterConfiguration":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","capabilityNames":["work.read"],"engineVersion":"0.0.0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"adapter-configuration/v1"},"configurationProvenance":{"adapterId":"fixture.adapter","capabilityNames":["work.read"],"fieldSources":{"adapterId":"PROJECT","capabilityNames":"PROJECT","leaseFreshnessMs":"PROJECT","maximumSessionMs":"PROJECT","projectId":"PROJECT","stateRoot":"DEFAULT","wallClockSkewMs":"PROJECT"},"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"01900000-0000-7000-8000-000000000001","projectRoot":"<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>","schemaVersion":"configuration-provenance/v1","stateRoot":"<redacted:path:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc>","wallClockSkewMs":1000},"cycleRequest":{"adapterId":"fixture.adapter","allowedModuleIds":["fixture.module"],"cycleId":"01900000-0000-7000-8000-000000000003","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","configurationProvenanceDigest":"6cb88ecc36a83f0d147de82f0d55aa9c92ad9d39f743ab8698cf943fdaf99e81","configurationSourceDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000006"}},"descriptor":{"abi":"orchestration-module/v1","actions":[{"actionKind":"fixture.direct","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":false},{"actionKind":"fixture.inspect","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":true}],"compatibility":[{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","engineVersion":"0.0.0","policyVersion":"1.2.3"}],"dispatchCatalog":[{"actionKind":"fixture.inspect","capabilityName":"work.read","code":"verify","directiveKind":"VERIFICATION","planAccessor":"IMMUTABLE_SUBJECT_DIGEST","templateId":"template.verify"}],"dispositionCodes":[],"inputSchemas":["module-plan-input/v1"],"moduleId":"fixture.module","moduleVersion":"1.0.0","outputSchemas":["module-action-plan/v1","module-no-action/v1"],"schemaVersion":"module-descriptor/v1"},"policyFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","decisions":[{"capabilityName":"work.read","trip":"TRIP"}],"observationId":"01900000-0000-7000-8000-000000000005","observedAt":"2026-08-31T01:00:00.001Z","policyVersion":"1.2.3","projectFactsDigest":"850e033912e587726788238a4c80a9caea6fe605e7c951232bc84e0900f851e0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-breaker-facts/v1","state":"COMPLETE"},"projectFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","frontier":[{"capabilityNames":["work.read"],"immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","readiness":"READY","workId":"01900000-0000-7000-8000-000000000002"}],"frontierDigest":"e1fd114d0aa64349f2ff70dc4f4e8e3b15a6a16d0380524937ed4ba09ed483d2","observationId":"01900000-0000-7000-8000-000000000004","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-facts/v1","state":"COMPLETE"},"reviewSubject":null,"schemaVersion":"module-plan-input/v1"}\n';
