import { expect, test, vi } from "vitest";
import * as c from "../../packages/contracts/src/index.js";
import { observeProjectPreflight } from "../../packages/adapter-sdk/src/preflight.js";
import type { SnapshotReader } from "../../packages/adapter-sdk/src/snapshot.js";

const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const configuration = {
  adapterId: "fixture.adapter",
  adapterVersion: "1.2.3",
  capabilityNames: ["work.read"],
  engineVersion: "0.0.0",
  projectId: id(1),
  schemaVersion: "adapter-configuration/v1",
} as const;
const provenance = {
  adapterId: configuration.adapterId,
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
  projectId: configuration.projectId,
  projectRoot: `<redacted:path:${"b".repeat(64)}>`,
  schemaVersion: "configuration-provenance/v1",
  stateRoot: `<redacted:path:${"c".repeat(64)}>`,
  wallClockSkewMs: 1_000,
} as const;
const clocks = { wallNow: () => "2026-09-01T01:00:00.000Z", monotonicNow: () => 0 };
const initialRow = {
  capabilityNames: ["work.read"],
  immutableSubjectDigest: "a".repeat(64),
  readiness: "READY",
  workId: id(2),
} as const;
const descriptor = {
  abi: "orchestration-module/v1",
  actions: [
    {
      actionKind: "fixture.direct",
      capabilityName: "work.read",
      requestedRole: "observer",
      reviewRequired: false,
      workerRequired: false,
    },
    {
      actionKind: "fixture.inspect",
      capabilityName: "work.read",
      requestedRole: "observer",
      reviewRequired: false,
      workerRequired: true,
    },
  ],
  compatibility: [
    {
      adapterId: configuration.adapterId,
      adapterVersion: configuration.adapterVersion,
      engineVersion: configuration.engineVersion,
      policyVersion: "1.2.3",
    },
  ],
  dispatchCatalog: [
    {
      actionKind: "fixture.inspect",
      capabilityName: "work.read",
      code: "verify",
      directiveKind: "VERIFICATION",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "template.verify",
    },
  ],
  dispositionCodes: [],
  inputSchemas: ["module-plan-input/v1"],
  moduleId: "fixture.module",
  moduleVersion: "1.0.0",
  outputSchemas: ["module-action-plan/v1", "module-no-action/v1"],
  schemaVersion: "module-descriptor/v1",
} as const;
function facts(
  state: "COMPLETE" | "UNKNOWN" | "UNAVAILABLE" = "COMPLETE",
  frontier: readonly c.ProjectFrontierRow[] = [initialRow],
): c.ProjectFacts {
  const common = {
    adapterConfigurationDigest: c.canonicalDigest(configuration),
    observationId: id(40),
    observedAt: "2026-09-01T01:00:00.000Z",
    projectId: configuration.projectId,
    schemaVersion: "project-facts/v1" as const,
  };
  if (state === "UNKNOWN") return { ...common, state, reason: "SOURCE_UNKNOWN" };
  if (state === "UNAVAILABLE") return { ...common, state, reason: "SOURCE_UNAVAILABLE" };
  return {
    ...common,
    state,
    frontier,
    frontierDigest: c.canonicalDigest(frontier),
  };
}
function context(worker = false) {
  const admittedFacts = { ...facts(), observationId: id(4) };
  const selectedDescriptor = worker
    ? {
        ...descriptor,
        dispatchCatalog: c.dispatchDirectiveKinds
          .filter((kind) => kind !== "OPERATOR_ACTION")
          .map((directiveKind) => ({
            actionKind: "fixture.inspect",
            capabilityName: "work.read",
            code: directiveKind.toLowerCase(),
            directiveKind,
            planAccessor: "IMMUTABLE_SUBJECT_DIGEST" as const,
            templateId: `template.${directiveKind.toLowerCase()}`,
          })),
      }
    : descriptor;
  const input = {
    adapterConfiguration: configuration,
    configurationProvenance: provenance,
    cycleRequest: {
      adapterId: configuration.adapterId,
      allowedModuleIds: [descriptor.moduleId],
      cycleId: id(3),
      schemaVersion: "cycle-request/v1",
      sessionRequest: {
        configurationPathsDigest: "d".repeat(64),
        configurationProvenanceDigest: c.canonicalDigest(provenance),
        configurationSourceDigest: "e".repeat(64),
        schemaVersion: "session-acquire-request/v1",
        sessionId: id(6),
      },
    },
    descriptor: selectedDescriptor,
    policyFacts: {
      adapterConfigurationDigest: c.canonicalDigest(configuration),
      decisions: [{ capabilityName: "work.read", trip: "NO_TRIP" }],
      observationId: id(5),
      observedAt: "2026-09-01T01:00:00.001Z",
      policyVersion: "1.2.3",
      projectFactsDigest: c.canonicalDigest(admittedFacts),
      projectId: configuration.projectId,
      schemaVersion: "project-breaker-facts/v1",
      state: "COMPLETE",
    },
    projectFacts: admittedFacts,
    reviewSubject: null,
    schemaVersion: "module-plan-input/v1",
  } as const;
  const actionCore = {
    actionKind: worker ? "fixture.inspect" : "fixture.direct",
    capabilityName: "work.read",
    immutableSubjectDigest: initialRow.immutableSubjectDigest,
    moduleDescriptorDigest: c.computeModuleDescriptorDigest(selectedDescriptor),
    requestedRole: "observer",
    schemaVersion: "dispatch-action-core/v1",
  } as const;
  const action = {
    actionCore,
    dispatchBrief: worker
      ? {
          action: {
            actionCoreDigest: c.computeDispatchActionCoreDigest(actionCore),
            actionKind: actionCore.actionKind,
            capabilityName: actionCore.capabilityName,
            immutableSubjectDigest: actionCore.immutableSubjectDigest,
            moduleDescriptorDigest: actionCore.moduleDescriptorDigest,
            schemaVersion: "dispatch-brief-action/v1",
          },
          directives: c.dispatchDirectiveKinds.map((directiveKind) => ({
            code: directiveKind === "OPERATOR_ACTION" ? null : directiveKind.toLowerCase(),
            directiveKind,
            presence: directiveKind === "OPERATOR_ACTION" ? "ABSENT" : "PRESENT",
            schemaVersion: "dispatch-brief-directive/v1",
            subjectDigest: actionCore.immutableSubjectDigest,
          })),
          footprint: [
            {
              access: "READ",
              resourceIdentityDigest: actionCore.immutableSubjectDigest,
              schemaVersion: "dispatch-brief-resource/v1",
            },
          ],
          role: "observer",
          schemaVersion: "dispatch-brief/v1",
        }
      : null,
    inputDigest: c.computeModulePlanInputDigest(input),
    schemaVersion: "module-action-plan/v1",
    workId: initialRow.workId,
  } as const;
  const identity = {
    capabilityNames: ["work.read"],
    hostRendererArtifactDigest: "1".repeat(64),
    schemaVersion: "worker-host-identity/v1",
  } as const;
  const mapping = worker
    ? [
        {
          ...identity,
          schemaVersion: "worker-host-renderer-artifact/v1" as const,
          workerHostIdentityDigest: c.computeWorkerHostIdentityDigest(identity),
        },
      ]
    : null;
  const route = {
    actionPlanDigest: c.computeModuleActionPlanDigest(action),
    hostMappingDigest: mapping === null ? null : c.computeRouteMappingDigest(mapping),
    outcome:
      mapping === null
        ? ({ kind: "NO_WORKER" } as const)
        : ({
            kind: "SELECTED",
            workerHostIdentityDigest: mapping[0]!.workerHostIdentityDigest,
          } as const),
    schemaVersion: "route-selection/v1",
  } as const;
  expect(c.validateRouteSelectionBinding(input, action, mapping, route).ok).toBe(true);
  return { input, action, mapping, route };
}
const reader = (value: unknown) => vi.fn(async () => value) as unknown as SnapshotReader;

test("fresh project facts produce one fully bound preflight without granting authority", async () => {
  const { input, action, route } = context();
  const snapshot = reader({ ok: true, facts: facts() });
  const result = await observeProjectPreflight(input, action, null, route, snapshot, clocks);
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(snapshot).toHaveBeenCalledWith(configuration, provenance, clocks);
  expect(result).toMatchObject({ ok: true, preflight: { outcome: { kind: "ELIGIBLE" } } });
  if (!result.ok) throw new Error(result.code);
  expect(
    c.validateProjectPreflightBinding(
      input,
      action,
      null,
      route,
      result.observation,
      result.preflight,
    ),
  ).toEqual({ ok: true, value: result.preflight });
  expect(result.preflight).not.toHaveProperty("authority");
});

test.each([
  ["SOURCE_UNAVAILABLE", facts("UNAVAILABLE"), { kind: "UNKNOWN", reason: "SOURCE_UNAVAILABLE" }],
  ["SOURCE_UNKNOWN", facts("UNKNOWN"), { kind: "UNKNOWN", reason: "SOURCE_UNKNOWN" }],
  ["WORK_MISSING", facts("COMPLETE", []), { kind: "REFUSED", reason: "WORK_MISSING" }],
  [
    "TARGET_CHANGED",
    facts("COMPLETE", [{ ...initialRow, immutableSubjectDigest: "b".repeat(64) }]),
    { kind: "REFUSED", reason: "TARGET_CHANGED" },
  ],
  [
    "CAPABILITY_REMOVED",
    facts("COMPLETE", [{ ...initialRow, capabilityNames: [] }]),
    { kind: "REFUSED", reason: "CAPABILITY_REMOVED" },
  ],
  [
    "NOT_READY",
    facts("COMPLETE", [{ ...initialRow, readiness: "NOT_READY" }]),
    { kind: "REFUSED", reason: "NOT_READY" },
  ],
  [
    "FRONTIER_CHANGED",
    facts("COMPLETE", [initialRow, { ...initialRow, workId: id(9) }]),
    { kind: "REFUSED", reason: "FRONTIER_CHANGED" },
  ],
] as const)(
  "%s is derived from the complete fresh observation",
  async (_name, current, outcome) => {
    const { input, action, route } = context();
    const result = await observeProjectPreflight(
      input,
      action,
      null,
      route,
      reader({ ok: true, facts: current }),
      clocks,
    );
    expect(result).toMatchObject({ ok: true, preflight: { outcome } });
  },
);

test.each([
  ["WORK_MISSING", []],
  [
    "TARGET_CHANGED",
    [
      {
        ...initialRow,
        immutableSubjectDigest: "b".repeat(64),
        capabilityNames: [],
        readiness: "NOT_READY",
      },
      { ...initialRow, workId: id(9) },
    ],
  ],
  [
    "CAPABILITY_REMOVED",
    [
      { ...initialRow, capabilityNames: [], readiness: "NOT_READY" },
      { ...initialRow, workId: id(9) },
    ],
  ],
  [
    "NOT_READY",
    [
      { ...initialRow, readiness: "NOT_READY" },
      { ...initialRow, workId: id(9) },
    ],
  ],
] as const)("combined source faults preserve %s priority", async (reason, frontier) => {
  const { input, action, route } = context();
  const result = await observeProjectPreflight(
    input,
    action,
    null,
    route,
    reader({ ok: true, facts: facts("COMPLETE", frontier) }),
    clocks,
  );
  expect(result).toMatchObject({
    ok: true,
    preflight: { outcome: { kind: "REFUSED", reason } },
  });
});

test("invalid admission refuses before source observation", async () => {
  const { input, action, route } = context();
  for (const tuple of [
    [null, action, route],
    [input, { ...action, workId: id(99) }, route],
    [input, action, { ...route, actionPlanDigest: "f".repeat(64) }],
  ] as const) {
    const snapshot = reader({ ok: true, facts: facts() });
    expect(
      await observeProjectPreflight(tuple[0], tuple[1], null, tuple[2], snapshot, clocks),
    ).toEqual({
      ok: false,
      code: "PREFLIGHT_ADMISSION_REFUSED",
      observation: null,
    });
    expect(snapshot).not.toHaveBeenCalled();
  }
});

test("throwing, malformed, failed, foreign and reused source results fail closed", async () => {
  const { input, action, route } = context();
  const throwing = vi.fn(async () => {
    throw new Error("private source failure");
  }) as SnapshotReader;
  const cases: SnapshotReader[] = [
    throwing,
    reader(null),
    reader({ ok: true, facts: { ...facts(), extra: true } }),
    reader({ ok: true, facts: { ...facts(), projectId: id(99) } }),
    reader({ ok: true, facts: { ...facts(), observationId: id(4) } }),
    reader({ ok: true, facts: { ...facts(), observationId: id(5) } }),
    reader({ ok: false, code: "INTERNAL_ERROR" }),
  ];
  for (const snapshot of cases)
    expect(
      await observeProjectPreflight(input, action, null, route, snapshot, clocks),
    ).toMatchObject({ ok: false, code: "PREFLIGHT_OBSERVATION_REFUSED" });
});

test("selected mapping is retained before the source await", async () => {
  const { input, action, mapping, route } = context(true);
  if (mapping === null) throw new Error("selected mapping required");
  let settle!: (value: unknown) => void;
  const snapshot = vi.fn(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  ) as SnapshotReader;
  const pending = observeProjectPreflight(input, action, mapping, route, snapshot, clocks);
  const mutableMapping = mapping as unknown as Array<{ capabilityNames: string[] }>;
  mutableMapping[0]!.capabilityNames.length = 0;
  settle({ ok: true, facts: facts() });
  await expect(pending).resolves.toMatchObject({
    ok: true,
    preflight: { outcome: { kind: "ELIGIBLE" } },
  });
});

test("admitted module and action inputs are detached before the source await", async () => {
  const original = context();
  const input = structuredClone(original.input),
    action = structuredClone(original.action);
  let settle!: (value: unknown) => void;
  const snapshot = vi.fn(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  ) as SnapshotReader;
  const pending = observeProjectPreflight(input, action, null, original.route, snapshot, clocks);
  const mutableInput = input as unknown as {
      projectFacts: { frontier: Array<{ immutableSubjectDigest: string }> };
    },
    mutableAction = action as unknown as { actionCore: { immutableSubjectDigest: string } };
  mutableInput.projectFacts.frontier[0]!.immutableSubjectDigest = "b".repeat(64);
  mutableAction.actionCore.immutableSubjectDigest = "b".repeat(64);
  settle({ ok: true, facts: facts() });
  await expect(pending).resolves.toMatchObject({
    ok: true,
    preflight: { outcome: { kind: "ELIGIBLE" } },
  });
});
