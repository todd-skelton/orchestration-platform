import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  canonicalDigest,
  canonicalJson,
  computeDispatchActionCoreDigest,
  computeModuleDescriptorDigest,
  computeModulePlanInputDigest,
  dispatchDirectiveKinds,
  parseModuleDescriptor,
  parseCanonicalContractBytes,
  parseContract,
  parseCycleRequest,
  parseModulePlanInput,
  validateModulePlanBinding,
  validateDispatchBriefBinding,
  validateAdapterConfigurationBinding,
  validateProjectBreakerFactsBinding,
  validateProjectFactsBinding,
  type ModuleDescriptor,
  type ProjectBreakerFacts,
  type ProjectFrontierRow,
  type ReviewSubject,
} from "@orchestration-platform/contracts";
import { normalizeTrackedText } from "../../../scripts/tracked-text.mjs";
import {
  createBranchFixtureCurrentPolicy,
  createBranchFixtureSnapshot,
  createQueueFixtureCurrentPolicy,
  createQueueFixtureSnapshot,
  type FixturePolicySourceFailure,
} from "../../../packages/adapter-sdk/src/fixtures.js";
import type { CurrentPolicyReader } from "../../../packages/adapter-sdk/src/current-policy.js";
import {
  createProjectSnapshotReader,
  type SnapshotReadPage,
} from "../../../packages/adapter-sdk/src/snapshot.js";
import {
  createPortableConfigurationHostAdapter,
  createConfigurationLoader,
  createWindowsConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import {
  projectConfigurationPaths,
  projectConfigurationProvenance,
} from "../../../packages/config/src/resolver.js";
import * as planningModule from "../../../modules/planning/src/index.js";
import {
  composeFixtureModuleInput,
  consume,
  loadFixtureConfiguration,
  observeFixturePolicy,
  observeFixtureSnapshot,
} from "../src/consume.js";
import { descriptor } from "../src/index.js";
import * as fixtureModule from "../src/index.js";

const checkout = resolve(import.meta.dirname, "../../..");
const planningSourceUrl = new URL("../../../modules/planning/src/index.ts", import.meta.url);
const planningSourceDigest = "522964281992bdb3239b0db140a7efc82ca13ea53eb1c922745c2aee49d8f1d0";
const actionPair = { actionKind: "fixture.inspect", capabilityName: "work.read" };
const roots: string[] = [];
const source = {
  adapterId: "fixture.branches",
  capabilityNames: ["work.read"],
  leaseFreshnessMs: 30_000,
  maximumSessionMs: 3_600_000,
  projectId: "018f0f4d-7b2d-7a11-8a2b-123456789abc",
  schemaVersion: "platform-configuration-source/v1",
  stateRoot: null,
  wallClockSkewMs: 1_000,
};
const operatingSystem =
  process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
const adapter =
  operatingSystem === "WINDOWS"
    ? createWindowsConfigurationHostAdapter()
    : createPortableConfigurationHostAdapter(operatingSystem);
const action = {
  ...actionPair,
  immutableSubjectDigest: "a".repeat(64),
  moduleDescriptorDigest: computeModuleDescriptorDigest(descriptor),
  requestedRole: "observer",
  schemaVersion: "dispatch-action-core/v1",
};

const planningDescriptorGolden = {
  abi: "orchestration-module/v1",
  actions: [
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      requestedRole: "implementation",
      reviewRequired: true,
      workerRequired: true,
    },
  ],
  compatibility: [
    {
      adapterId: "fixture.branches",
      adapterVersion: "1.0.0",
      engineVersion: "0.0.0",
      policyVersion: "1.0.0",
    },
    {
      adapterId: "fixture.queue",
      adapterVersion: "1.0.0",
      engineVersion: "0.0.0",
      policyVersion: "1.0.0",
    },
  ],
  dispatchCatalog: [
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      code: "planning.acceptance-evidence",
      directiveKind: "ACCEPTANCE_EVIDENCE",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "planning.acceptance-evidence",
    },
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      code: "planning.constraint",
      directiveKind: "CONSTRAINT",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "planning.constraint",
    },
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      code: "planning.decision",
      directiveKind: "DECISION",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "planning.decision",
    },
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      code: "planning.non-goal",
      directiveKind: "NON_GOAL",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "planning.non-goal",
    },
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      code: "planning.review-attack",
      directiveKind: "REVIEW_ATTACK",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "planning.review-attack",
    },
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      code: "planning.scope-exclude",
      directiveKind: "SCOPE_EXCLUDE",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "planning.scope-exclude",
    },
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      code: "planning.scope-include",
      directiveKind: "SCOPE_INCLUDE",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "planning.scope-include",
    },
    {
      actionKind: "planning.implement",
      capabilityName: "work.read",
      code: "planning.verification",
      directiveKind: "VERIFICATION",
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: "planning.verification",
    },
  ],
  dispositionCodes: [],
  inputSchemas: ["module-plan-input/v1"],
  moduleId: "planning",
  moduleVersion: "0.0.0",
  outputSchemas: ["module-action-plan/v1", "module-no-action/v1"],
  schemaVersion: "module-descriptor/v1",
} as const;

const planningDirectiveCodes = [
  ["ACCEPTANCE_EVIDENCE", "planning.acceptance-evidence"],
  ["CONSTRAINT", "planning.constraint"],
  ["DECISION", "planning.decision"],
  ["NON_GOAL", "planning.non-goal"],
  ["OPERATOR_ACTION", null],
  ["REVIEW_ATTACK", "planning.review-attack"],
  ["SCOPE_EXCLUDE", "planning.scope-exclude"],
  ["SCOPE_INCLUDE", "planning.scope-include"],
  ["VERIFICATION", "planning.verification"],
] as const;

const uuid = (index: number) => `018f0f4d-7b2d-7a11-8a2b-${index.toString(16).padStart(12, "0")}`;
const clocks = { wallNow: () => "2026-08-30T01:02:03.004Z", monotonicNow: () => 0 };
const frontier = (): ProjectFrontierRow[] => [
  {
    workId: uuid(4),
    immutableSubjectDigest: "b".repeat(64),
    readiness: "READY",
    capabilityNames: ["work.read"],
  },
  {
    workId: uuid(2),
    immutableSubjectDigest: "c".repeat(64),
    readiness: "NOT_READY",
    capabilityNames: ["work.read"],
  },
  {
    workId: uuid(3),
    immutableSubjectDigest: action.immutableSubjectDigest,
    readiness: "READY",
    capabilityNames: ["work.read"],
  },
];
const sdk = (read: SnapshotReadPage) =>
  createProjectSnapshotReader(
    read,
    "fixture.branches",
    "1.0.0",
    ["0.0.0"],
    ["adapter-configuration/v1", "project-facts/v1"],
    ["work.read"],
  );

async function fixture(kind: "branches" | "queue" = "branches", rows = frontier()) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "walking-skeleton-")));
  roots.push(root);
  const projectRoot = join(root, "project");
  const configPath = join(projectRoot, ".orchestration", "project.json");
  const stateRoot = join(root, "state");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, canonicalJson({ ...source, adapterId: `fixture.${kind}` }));
  const invocation: ConfigurationLoaderInvocation = {
    cwd: projectRoot,
    operatingSystem,
    flags: { configPath, projectRoot, stateRoot },
    environment: {
      HOME: null,
      LOCALAPPDATA: null,
      ORCHESTRATION_CONFIG: null,
      ORCHESTRATION_PROJECT_ROOT: null,
      ORCHESTRATION_STATE_ROOT: null,
      XDG_STATE_HOME: null,
    },
  };
  const configuration = {
    adapterId: `fixture.${kind}`,
    adapterVersion: "1.0.0",
    capabilityNames: ["work.read"],
    engineVersion: "0.0.0",
    projectId: source.projectId,
    schemaVersion: "adapter-configuration/v1",
  };
  const branchInput = (input: readonly ProjectFrontierRow[]) =>
    input.map((row) => ({
      workId: row.workId,
      branch: "fixture/opaque",
      revisionDigest: row.immutableSubjectDigest,
      blocked: row.readiness !== "READY",
      capabilityNames: row.capabilityNames,
    }));
  const queueInput = (input: readonly ProjectFrontierRow[]) =>
    input.map((row) => ({
      ticketId: row.workId,
      documentDigest: row.immutableSubjectDigest,
      admitted: row.readiness === "READY",
      capabilityNames: row.capabilityNames,
    }));
  const snapshotSource = vi.fn(() => rows);
  const policySource = vi.fn<() => readonly ProjectFrontierRow[] | FixturePolicySourceFailure>(
    () => rows,
  );
  const snapshot = vi.fn(
    kind === "branches"
      ? createBranchFixtureSnapshot(() => branchInput(snapshotSource()))
      : createQueueFixtureSnapshot(() => queueInput(snapshotSource())),
  );
  const currentPolicy = vi.fn(
    kind === "branches"
      ? createBranchFixtureCurrentPolicy(() => {
          const input = policySource();
          return "state" in input ? input : branchInput(input);
        })
      : createQueueFixtureCurrentPolicy(() => {
          const input = policySource();
          return "state" in input ? input : queueInput(input);
        }),
  );
  const loaded = await createConfigurationLoader(adapter)(invocation);
  if (!loaded.ok) throw new Error("fixture setup configuration refused");
  const provenance = projectConfigurationProvenance(loaded.value);
  const paths = projectConfigurationPaths(loaded.value);
  if (!provenance.ok || !paths.ok) throw new Error("fixture setup projection refused");
  const request = parseCycleRequest({
    adapterId: configuration.adapterId,
    allowedModuleIds: [descriptor.moduleId],
    cycleId: uuid(10),
    schemaVersion: "cycle-request/v1",
    sessionRequest: {
      configurationPathsDigest: canonicalDigest(paths.value),
      configurationProvenanceDigest: canonicalDigest(provenance.value),
      configurationSourceDigest: canonicalDigest({ ...source, adapterId: configuration.adapterId }),
      schemaVersion: "session-acquire-request/v1",
      sessionId: uuid(11),
    },
  });
  if (!request.ok) throw new Error("fixture setup request refused");
  return {
    cycleRequest: request.value,
    root,
    configPath,
    stateRoot,
    invocation,
    configuration,
    snapshot,
    currentPolicy,
    snapshotSource,
    policySource,
  };
}

async function preparedPlanningInput(
  kind: "branches" | "queue",
  rows: readonly ProjectFrontierRow[],
  selectedDescriptor: ModuleDescriptor = planningModule.descriptor,
  reviewSubject: ReviewSubject | null = null,
) {
  const f = await fixture(kind, [...rows]);
  const cycleRequest = {
    ...f.cycleRequest,
    allowedModuleIds: [selectedDescriptor.moduleId],
  };
  const context = await loadFixtureConfiguration(
    adapter,
    f.invocation,
    f.configuration,
    cycleRequest,
  );
  if (!context.ok) throw new Error("planning fixture configuration refused");
  const facts = await observeFixtureSnapshot(context.value, f.snapshot, clocks);
  if (!facts.ok || facts.value.state !== "COMPLETE")
    throw new Error("planning fixture snapshot refused");
  const policy = await observeFixturePolicy(context.value, facts.value, f.currentPolicy, clocks);
  if (!policy.ok || policy.value.state !== "COMPLETE")
    throw new Error("planning fixture policy refused");
  const composed = composeFixtureModuleInput(
    selectedDescriptor,
    reviewSubject,
    context.value,
    facts.value,
    policy.value,
  );
  if (!composed.ok) throw new Error("planning fixture input refused");
  return { input: composed.value, policy: policy.value };
}

async function preparedPlanning(
  kind: "branches" | "queue",
  rows: readonly ProjectFrontierRow[],
  selectedDescriptor: ModuleDescriptor = planningModule.descriptor,
  reviewSubject: ReviewSubject | null = null,
) {
  const prepared = await preparedPlanningInput(kind, rows, selectedDescriptor, reviewSubject);
  const { input } = prepared;
  const promise = invokeAdmittedPlanning(input);
  expect(promise).toBeInstanceOf(Promise);
  const returned = await promise;
  const result = validateModulePlanBinding(input, returned);
  if (!result.ok) throw new Error("planning fixture result refused");
  return { ...prepared, result: result.value };
}

async function admittedPlanningSource(): Promise<string> {
  const sourceText = normalizeTrackedText(await readFile(planningSourceUrl, "utf8"));
  expect(createHash("sha256").update(sourceText).digest("hex")).toBe(planningSourceDigest);
  return sourceText;
}

async function invokeAdmittedPlanning(
  input: Parameters<typeof planningModule.plan>[0],
): ReturnType<typeof planningModule.plan> {
  await admittedPlanningSource();
  return planningModule.plan(input);
}

afterEach(async () => {
  vi.restoreAllMocks();
  const temporaryParent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (
      dirname(root) !== temporaryParent ||
      !root.startsWith(join(temporaryParent, "walking-skeleton-"))
    ) {
      throw new Error("fixture cleanup escaped its disposable root");
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function manifest(root: string, excluded?: string): Promise<string[]> {
  const rows: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (path === excluded) continue;
    rows.push(
      entry.name +
        (entry.isDirectory()
          ? "/"
          : ":" +
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex")),
    );
    if (entry.isDirectory())
      rows.push(...(await manifest(path)).map((row) => `${entry.name}/${row}`));
  }
  return rows.sort();
}

async function checkoutManifest() {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: checkout,
    encoding: "utf8",
    windowsHide: true,
  })
    .split("\0")
    .filter(Boolean);
  return Promise.all(
    files.map(
      async (file) =>
        `${file}:${createHash("sha256")
          .update(await readFile(join(checkout, file)))
          .digest("hex")}`,
    ),
  );
}

async function output(f: Awaited<ReturnType<typeof fixture>>, file: string, schema: string) {
  const bytes = await readFile(join(f.stateRoot, file));
  const parsed = parseCanonicalContractBytes(schema, bytes);
  if (!parsed.ok) throw new Error("public parser refused output");
  expect(canonicalJson(parsed.value)).toBe(bytes.toString("utf8"));
  expect(bytes.toString("utf8")).not.toContain(f.root);
  return parsed.value;
}

test("both real SDK policies retain contrasting facts with the same observer brief", async () => {
  const sourceBefore = await checkoutManifest();
  const briefs: unknown[] = [];
  for (const kind of ["branches", "queue"] as const) {
    const f = await fixture(kind);
    const outsideBefore = await manifest(f.root, f.stateRoot);
    expect(
      await consume(
        adapter,
        f.invocation,
        f.configuration,
        f.snapshot,
        f.currentPolicy,
        clocks,
        f.cycleRequest,
      ),
    ).toEqual({
      ok: true,
      files: [
        "configuration.json",
        "adapter-configuration.json",
        "project-facts.json",
        "project-breaker-facts.json",
        "cycle-request.json",
        "module-descriptor.json",
        "module-input.json",
        "module-result.json",
        "action.json",
        "brief.json",
      ],
    });
    expect((await readdir(f.stateRoot)).sort()).toEqual([
      "action.json",
      "adapter-configuration.json",
      "brief.json",
      "configuration.json",
      "cycle-request.json",
      "module-descriptor.json",
      "module-input.json",
      "module-result.json",
      "project-breaker-facts.json",
      "project-facts.json",
    ]);
    const provenance = await output(f, "configuration.json", "configuration-provenance/v1");
    const configuration = await output(f, "adapter-configuration.json", "adapter-configuration/v1");
    const facts = await output(f, "project-facts.json", "project-facts/v1");
    const breakerFacts = await output(f, "project-breaker-facts.json", "project-breaker-facts/v1");
    const core = await output(f, "action.json", "dispatch-action-core/v1");
    const brief = await output(f, "brief.json", "dispatch-brief/v1");
    const input = await output(f, "module-input.json", "module-plan-input/v1");
    const result = await output(f, "module-result.json", "module-plan-result/v1");
    expect(await output(f, "module-descriptor.json", "module-descriptor/v1")).toEqual(descriptor);
    expect(await output(f, "cycle-request.json", "cycle-request/v1")).toEqual(f.cycleRequest);
    expect(input).toMatchObject({
      configurationProvenance: provenance,
      adapterConfiguration: configuration,
      projectFacts: facts,
      policyFacts: breakerFacts,
      descriptor,
      cycleRequest: f.cycleRequest,
      reviewSubject: null,
    });
    expect(result).toEqual({
      actionCore: core,
      dispatchBrief: brief,
      inputDigest: computeModulePlanInputDigest(input),
      schemaVersion: "module-action-plan/v1",
      workId: uuid(3),
    });
    expect(validateModulePlanBinding(input, result).ok).toBe(true);
    expect(validateAdapterConfigurationBinding(configuration, provenance).ok).toBe(true);
    expect(validateProjectFactsBinding(facts, configuration).ok).toBe(true);
    expect(validateProjectBreakerFactsBinding(breakerFacts, configuration, facts, "1.0.0").ok).toBe(
      true,
    );
    expect(f.currentPolicy).toHaveBeenCalledTimes(1);
    expect(f.currentPolicy.mock.calls[0]).toEqual([configuration, provenance, facts, clocks]);
    expect(f.snapshotSource).toHaveBeenCalledTimes(1);
    expect(f.policySource).toHaveBeenCalledTimes(1);
    expect(f.snapshotSource.mock.invocationCallOrder[0]).toBeLessThan(
      f.policySource.mock.invocationCallOrder[0]!,
    );
    const observed = await f.currentPolicy.mock.results[0]!.value;
    if (!observed.ok) throw new Error("real SDK policy refused");
    expect(canonicalJson(breakerFacts)).toBe(canonicalJson(observed.facts));
    expect(breakerFacts.projectFactsDigest).toBe(canonicalDigest(facts));
    expect(breakerFacts.observationId).not.toBe(facts.observationId);
    expect(breakerFacts).toMatchObject({
      state: "COMPLETE",
      decisions: [{ capabilityName: "work.read", trip: kind === "branches" ? "TRIP" : "NO_TRIP" }],
    });
    expect(core).toEqual(action);
    expect(core.immutableSubjectDigest).not.toBe(facts.frontierDigest);
    expect(brief.action).toMatchObject({ actionCoreDigest: computeDispatchActionCoreDigest(core) });
    briefs.push(canonicalJson(brief));
    expect(await manifest(f.root, f.stateRoot)).toEqual(outsideBefore);
  }
  expect(briefs[0]).toEqual(briefs[1]);
  expect(await checkoutManifest()).toEqual(sourceBefore);
}, 30_000);

test("fresh changed subjects change both core and brief without using the frontier digest", async () => {
  const results = [];
  for (const digest of ["a".repeat(64), "d".repeat(64)]) {
    const rows = frontier();
    rows[2] = { ...rows[2]!, immutableSubjectDigest: digest };
    const f = await fixture("branches", rows);
    expect(
      (
        await consume(
          adapter,
          f.invocation,
          f.configuration,
          f.snapshot,
          f.currentPolicy,
          clocks,
          f.cycleRequest,
        )
      ).ok,
    ).toBe(true);
    const core = await output(f, "action.json", "dispatch-action-core/v1");
    const brief = await output(f, "brief.json", "dispatch-brief/v1");
    expect(core.immutableSubjectDigest).toBe(digest);
    expect(brief.action).toMatchObject({
      immutableSubjectDigest: digest,
      actionCoreDigest: computeDispatchActionCoreDigest(core),
    });
    results.push([canonicalJson(core), canonicalJson(brief)]);
  }
  expect(results[0]![0]).not.toBe(results[1]![0]);
  expect(results[0]![1]).not.toBe(results[1]![1]);
});

test("retains policy facts and selected action across the plan await", async () => {
  const rows = frontier();
  const f = await fixture("branches", rows);
  const originalPlan = fixtureModule.plan;
  let returnedFacts: ProjectBreakerFacts | undefined;
  let retainedPolicyBytes: string | undefined;
  const currentPolicy: CurrentPolicyReader = async (...args) => {
    const result = await f.currentPolicy(...args);
    if (!result.ok) return result;
    returnedFacts = structuredClone(result.facts);
    retainedPolicyBytes = canonicalJson(returnedFacts);
    return { ok: true, facts: returnedFacts };
  };
  const spy = vi.spyOn(fixtureModule, "plan").mockImplementation(async (input) => {
    expect(Object.isFrozen(input)).toBe(true);
    const result = await originalPlan(input);
    rows[2] = { ...rows[2]!, immutableSubjectDigest: "f".repeat(64) };
    if (returnedFacts?.state !== "COMPLETE") throw new Error("policy must precede plan");
    Object.assign(returnedFacts.decisions[0]!, { trip: "NO_TRIP" });
    Object.assign(returnedFacts, { projectFactsDigest: "f".repeat(64) });
    return result;
  });
  expect(
    (
      await consume(
        adapter,
        f.invocation,
        f.configuration,
        f.snapshot,
        currentPolicy,
        clocks,
        f.cycleRequest,
      )
    ).ok,
  ).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
  const core = await output(f, "action.json", "dispatch-action-core/v1");
  const brief = await output(f, "brief.json", "dispatch-brief/v1");
  const facts = await output(f, "project-facts.json", "project-facts/v1");
  const breakerFacts = await output(f, "project-breaker-facts.json", "project-breaker-facts/v1");
  expect(canonicalJson(breakerFacts)).toBe(retainedPolicyBytes);
  expect(canonicalJson(breakerFacts)).not.toBe(canonicalJson(returnedFacts!));
  expect(breakerFacts.projectFactsDigest).toBe(canonicalDigest(facts));
  expect(validateProjectBreakerFactsBinding(breakerFacts, f.configuration, facts, "1.0.0").ok).toBe(
    true,
  );
  expect(f.policySource).toHaveBeenCalledTimes(1);
  expect(core).toEqual(action);
  expect(core.immutableSubjectDigest).not.toBe(rows[2]!.immutableSubjectDigest);
  const pair = actionPair;
  const catalog = dispatchDirectiveKinds
    .filter((kind) => kind !== "OPERATOR_ACTION")
    .map((directiveKind) => ({
      ...pair,
      code: directiveKind.toLowerCase(),
      directiveKind,
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: `fixture.${directiveKind.toLowerCase()}`,
    }));
  expect(validateDispatchBriefBinding(brief, core, catalog, [pair])).toEqual([]);
});

test.each(["UNKNOWN", "UNAVAILABLE"] as const)("%s never plans or writes", async (state) => {
  const rows: ProjectFrontierRow[] = [
    {
      ...frontier()[2]!,
      readiness: "READY",
      capabilityNames: ["work.read"],
    },
  ];
  const f = await fixture("branches", rows);
  const before = await manifest(f.root);
  const spy = vi.spyOn(fixtureModule, "plan");
  const snapshot = sdk(async (request) => {
    if (state === "UNKNOWN" || state === "UNAVAILABLE")
      return {
        state,
        observationId: request.observationId,
        reason: state === "UNKNOWN" ? "SOURCE_UNKNOWN" : "SOURCE_UNAVAILABLE",
      };
    return {
      ...request,
      state: "COMPLETE",
      nextCursor: null,
      frontier: rows,
      frontierDigest: canonicalDigest(rows),
    };
  });
  expect(
    await consume(
      adapter,
      f.invocation,
      f.configuration,
      snapshot,
      f.currentPolicy,
      clocks,
      f.cycleRequest,
    ),
  ).toEqual({
    ok: false,
    issues: [`fixture:snapshot:${state}`],
  });
  expect(spy).not.toHaveBeenCalled();
  expect(f.policySource).toHaveBeenCalledTimes(0);
  expect(await manifest(f.root)).toEqual(before);
});

test("config and facts binding failures never plan or write", async () => {
  const f = await fixture();
  const before = await manifest(f.root);
  const spy = vi.spyOn(fixtureModule, "plan");
  const read = vi.fn(f.snapshot);
  expect(
    await consume(
      adapter,
      f.invocation,
      { ...f.configuration, projectId: uuid(99) },
      read,
      f.currentPolicy,
      clocks,
      f.cycleRequest,
    ),
  ).toEqual({ ok: false, issues: ["projectId:binding-mismatch"] });
  expect(read).not.toHaveBeenCalled();
  const moved: Parameters<typeof consume>[3] = async (...args) => {
    const result = await f.snapshot(...args);
    if (!result.ok) return result;
    return { ok: true, facts: { ...result.facts, adapterConfigurationDigest: "f".repeat(64) } };
  };
  expect(
    await consume(
      adapter,
      f.invocation,
      f.configuration,
      moved,
      f.currentPolicy,
      clocks,
      f.cycleRequest,
    ),
  ).toEqual({
    ok: false,
    issues: ["adapterConfigurationDigest:binding-mismatch"],
  });
  expect(spy).not.toHaveBeenCalled();
  expect(f.currentPolicy).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
});

test("malformed config preserves the loader refusal with no output", async () => {
  const f = await fixture();
  await writeFile(f.configPath, canonicalJson({ ...source, extra: true }));
  const before = await manifest(f.root);
  const read = vi.fn(f.snapshot);
  const spy = vi.spyOn(fixtureModule, "plan");
  expect(
    await consume(
      adapter,
      f.invocation,
      f.configuration,
      read,
      f.currentPolicy,
      clocks,
      f.cycleRequest,
    ),
  ).toEqual({
    ok: false,
    error: {
      code: "CONFIG_REFUSED",
      exitCode: 2,
      message: "configuration refused",
      outcome: "invalid-input",
    },
  });
  expect(read).not.toHaveBeenCalled();
  expect(f.currentPolicy).not.toHaveBeenCalled();
  expect(spy).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
});

test.each(["branches", "queue"] as const)(
  "%s freshly rereads policy source and refuses changed or unresolved evidence before plan/state",
  async (kind) => {
    for (const state of ["CHANGED_SOURCE", "UNKNOWN", "UNAVAILABLE"] as const) {
      const rows = frontier();
      const f = await fixture(kind, rows);
      const before = await manifest(f.root);
      const spy = vi.spyOn(fixtureModule, "plan");
      const snapshot: Parameters<typeof consume>[3] = async (...args) => {
        const result = await f.snapshot(...args);
        if (state === "CHANGED_SOURCE")
          rows[2] = { ...rows[2]!, immutableSubjectDigest: "f".repeat(64) };
        else
          f.policySource.mockReturnValue(
            state === "UNKNOWN"
              ? { state, reason: "SOURCE_UNKNOWN" }
              : { state, reason: "SOURCE_UNAVAILABLE" },
          );
        return result;
      };
      expect(
        await consume(
          adapter,
          f.invocation,
          f.configuration,
          snapshot,
          f.currentPolicy,
          clocks,
          f.cycleRequest,
        ),
      ).toEqual({
        ok: false,
        issues: [
          state === "CHANGED_SOURCE"
            ? "fixture:current-policy:UNKNOWN:CHANGED_SOURCE"
            : `fixture:current-policy:${state}:SOURCE_${state}`,
        ],
      });
      expect(f.snapshotSource).toHaveBeenCalledTimes(1);
      expect(f.policySource).toHaveBeenCalledTimes(1);
      expect(f.snapshotSource.mock.invocationCallOrder[0]).toBeLessThan(
        f.policySource.mock.invocationCallOrder[0]!,
      );
      expect(spy).not.toHaveBeenCalled();
      expect(await manifest(f.root)).toEqual(before);
    }
  },
);

test("preserves a real policy SDK admission refusal before plan/state", async () => {
  const f = await fixture("branches");
  const before = await manifest(f.root);
  const spy = vi.spyOn(fixtureModule, "plan");
  const sourceRead = vi.fn(() => []);
  const wrongAdapterPolicy = createQueueFixtureCurrentPolicy(sourceRead);
  expect(
    await consume(
      adapter,
      f.invocation,
      f.configuration,
      f.snapshot,
      wrongAdapterPolicy,
      clocks,
      f.cycleRequest,
    ),
  ).toEqual({ ok: false, code: "ADAPTER_COMPATIBILITY_REFUSED" });
  expect(sourceRead).not.toHaveBeenCalled();
  expect(spy).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
});

test.each([
  ["CONFIGURATION", "adapterConfigurationDigest:binding-mismatch"],
  ["SNAPSHOT_METADATA", "projectFactsDigest:binding-mismatch"],
  ["POLICY_VERSION", "policyVersion:binding-mismatch"],
] as const)("refuses substituted %s policy binding before plan/state", async (field, issue) => {
  const f = await fixture();
  const before = await manifest(f.root);
  const spy = vi.spyOn(fixtureModule, "plan");
  const currentPolicy: CurrentPolicyReader = async (configuration, provenance, facts, clock) => {
    const snapshot = parseContract("project-facts/v1", facts);
    if (!snapshot.ok) throw new Error("snapshot required");
    // A real SDK result bound to different snapshot metadata must not bind the retained snapshot.
    const result = await f.currentPolicy(
      configuration,
      provenance,
      field === "SNAPSHOT_METADATA"
        ? { ...snapshot.value, observedAt: "2026-08-30T01:02:04.004Z" }
        : facts,
      clock,
    );
    if (!result.ok || field === "SNAPSHOT_METADATA") return result;
    return {
      ok: true,
      facts: {
        ...result.facts,
        ...(field === "CONFIGURATION"
          ? {
              adapterConfigurationDigest: canonicalDigest({
                ...f.configuration,
                adapterVersion: "2.0.0",
              }),
            }
          : { policyVersion: "2.0.0" }),
      },
    };
  };
  expect(
    await consume(
      adapter,
      f.invocation,
      f.configuration,
      f.snapshot,
      currentPolicy,
      clocks,
      f.cycleRequest,
    ),
  ).toEqual({
    ok: false,
    issues: [issue],
  });
  expect(f.policySource).toHaveBeenCalledTimes(1);
  expect(spy).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
});

test.each(["event-journal/v1", "cycle-receipt/v1"])(
  "routes public %s without treating a fixture record as runtime evidence",
  (schemaVersion) => {
    const parsed = parseContract(schemaVersion, { schemaVersion });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).not.toContain("schemaVersion:unsupported");
  },
);

test.each(["NO_READY", "NO_CAPABILITY"] as const)(
  "%s records a bound public no-action without a fabricated core or brief",
  async (kind) => {
    const rows = [
      {
        ...frontier()[2]!,
        readiness: kind === "NO_READY" ? ("NOT_READY" as const) : ("READY" as const),
        capabilityNames: kind === "NO_CAPABILITY" ? [] : ["work.read"],
      },
    ];
    const f = await fixture("branches", rows);
    const before = await manifest(f.root, f.stateRoot);
    const spy = vi.spyOn(fixtureModule, "plan");
    const run = await consume(
      adapter,
      f.invocation,
      f.configuration,
      f.snapshot,
      f.currentPolicy,
      clocks,
      f.cycleRequest,
    );
    expect(run.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const input = await output(f, "module-input.json", "module-plan-input/v1");
    const result = await output(f, "module-result.json", "module-plan-result/v1");
    expect(result).toEqual({
      inputDigest: computeModulePlanInputDigest(input),
      outcome: "NO_ACTION",
      reason: "NO_ELIGIBLE_ACTION",
      schemaVersion: "module-no-action/v1",
    });
    expect(validateModulePlanBinding(input, result).ok).toBe(true);
    expect((await readdir(f.stateRoot)).sort()).toEqual([
      "adapter-configuration.json",
      "configuration.json",
      "cycle-request.json",
      "module-descriptor.json",
      "module-input.json",
      "module-result.json",
      "project-breaker-facts.json",
      "project-facts.json",
    ]);
    expect(await manifest(f.root, f.stateRoot)).toEqual(before);
  },
);

test.each(["PROVENANCE", "ADAPTER", "MODULE_INTENT"] as const)(
  "refuses substituted %s cycle intent before invoking the module or writing",
  async (kind) => {
    const f = await fixture();
    const before = await manifest(f.root);
    const request = structuredClone(f.cycleRequest);
    const changed =
      kind === "PROVENANCE"
        ? {
            ...request,
            sessionRequest: {
              ...request.sessionRequest,
              configurationProvenanceDigest: "f".repeat(64),
            },
          }
        : kind === "ADAPTER"
          ? { ...request, adapterId: "fixture.queue" }
          : { ...request, allowedModuleIds: [] };
    const spy = vi.spyOn(fixtureModule, "plan");
    expect(
      (
        await consume(
          adapter,
          f.invocation,
          f.configuration,
          f.snapshot,
          f.currentPolicy,
          clocks,
          changed,
        )
      ).ok,
    ).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(await manifest(f.root)).toEqual(before);
  },
);

test.each(["INPUT_DIGEST", "OTHER_WORK", "MALFORMED"] as const)(
  "rejects %s returned across the module await before any output write",
  async (kind) => {
    const f = await fixture();
    const before = await manifest(f.root);
    const original = fixtureModule.plan;
    vi.spyOn(fixtureModule, "plan").mockImplementation(async (input) => {
      const result = await original(input);
      if (result.schemaVersion !== "module-action-plan/v1")
        throw new Error("fixture action required");
      return {
        ...result,
        ...(kind === "INPUT_DIGEST"
          ? { inputDigest: "f".repeat(64) }
          : kind === "OTHER_WORK"
            ? { workId: uuid(4) }
            : { extra: true }),
      };
    });
    expect(
      (
        await consume(
          adapter,
          f.invocation,
          f.configuration,
          f.snapshot,
          f.currentPolicy,
          clocks,
          f.cycleRequest,
        )
      ).ok,
    ).toBe(false);
    expect(await manifest(f.root)).toEqual(before);
  },
);

test("detaches cycle intent before asynchronous observation and binds the retained input used by the module", async () => {
  const f = await fixture();
  const request = structuredClone(f.cycleRequest);
  const before = canonicalJson(request);
  const snapshot: Parameters<typeof consume>[3] = async (...args) => {
    Object.assign(request, { adapterId: "fixture.queue", allowedModuleIds: [] });
    return f.snapshot(...args);
  };
  expect(
    (
      await consume(
        adapter,
        f.invocation,
        f.configuration,
        snapshot,
        f.currentPolicy,
        clocks,
        request,
      )
    ).ok,
  ).toBe(true);
  const persisted = await output(f, "cycle-request.json", "cycle-request/v1");
  expect(canonicalJson(persisted)).toBe(before);
  expect(canonicalJson(persisted)).not.toBe(canonicalJson(request));
  const input = await output(f, "module-input.json", "module-plan-input/v1");
  const result = await output(f, "module-result.json", "module-plan-result/v1");
  expect(input.cycleRequest).toEqual(persisted);
  expect(validateModulePlanBinding(input, result).ok).toBe(true);
});

test("runs the quarantined planning module through actual branch and queue preparation", async () => {
  expect(Object.keys(planningModule).sort()).toEqual(["descriptor", "plan"]);
  expect(planningModule.descriptor).toEqual(planningDescriptorGolden);
  expect(computeModuleDescriptorDigest(planningModule.descriptor)).toBe(
    "a91ffba1f6adfb694e13bd30d488b5d7df7c3032f152cabbe203fdac3c7de582",
  );

  const branch = await preparedPlanning("branches", frontier());
  expect(branch.policy.decisions).toEqual([{ capabilityName: "work.read", trip: "TRIP" }]);
  expect(branch.result).toEqual({
    inputDigest: computeModulePlanInputDigest(branch.input),
    outcome: "NO_ACTION",
    reason: "NO_ELIGIBLE_ACTION",
    schemaVersion: "module-no-action/v1",
  });

  const queueRows = frontier().filter((row) => row.workId !== uuid(4));
  const queue = await preparedPlanning("queue", queueRows);
  expect(queue.policy.decisions).toEqual([{ capabilityName: "work.read", trip: "NO_TRIP" }]);
  const descriptorDigest = computeModuleDescriptorDigest(planningDescriptorGolden);
  const expectedCore = {
    actionKind: "planning.implement",
    capabilityName: "work.read",
    immutableSubjectDigest: "a".repeat(64),
    moduleDescriptorDigest: descriptorDigest,
    requestedRole: "implementation",
    schemaVersion: "dispatch-action-core/v1",
  };
  expect(queue.result).toEqual({
    actionCore: expectedCore,
    dispatchBrief: {
      action: {
        actionCoreDigest: computeDispatchActionCoreDigest(expectedCore),
        actionKind: "planning.implement",
        capabilityName: "work.read",
        immutableSubjectDigest: "a".repeat(64),
        moduleDescriptorDigest: descriptorDigest,
        schemaVersion: "dispatch-brief-action/v1",
      },
      directives: planningDirectiveCodes.map(([directiveKind, code]) => ({
        code,
        directiveKind,
        presence: code === null ? "ABSENT" : "PRESENT",
        schemaVersion: "dispatch-brief-directive/v1",
        subjectDigest: "a".repeat(64),
      })),
      footprint: [
        {
          access: "READ",
          resourceIdentityDigest: "a".repeat(64),
          schemaVersion: "dispatch-brief-resource/v1",
        },
      ],
      role: "implementation",
      schemaVersion: "dispatch-brief/v1",
    },
    inputDigest: computeModulePlanInputDigest(queue.input),
    schemaVersion: "module-action-plan/v1",
    workId: uuid(3),
  });
  expect(canonicalJson(await invokeAdmittedPlanning(queue.input))).toBe(
    canonicalJson(await invokeAdmittedPlanning(queue.input)),
  );

  const alternate = parseModuleDescriptor({
    ...planningDescriptorGolden,
    moduleVersion: "0.0.1",
  });
  if (!alternate.ok) throw new Error("alternate planning descriptor refused");
  const substituted = await preparedPlanning("queue", queueRows, alternate.value);
  expect(substituted.result).toEqual({
    inputDigest: computeModulePlanInputDigest(substituted.input),
    outcome: "REFUSED",
    reason: "INPUT_REFUSED",
    schemaVersion: "module-no-action/v1",
  });

  const reviewSubject: ReviewSubject = {
    authorAttemptId: uuid(90),
    authorCycleId: uuid(91),
    baseSource: {
      adapterId: "fixture.queue",
      projectId: source.projectId,
      revision: "review-source",
    },
    result: { kind: "TREE", treeDigest: "e".repeat(64) },
    schemaVersion: "worker-result-subject/v1",
    terminalReceiptDigest: "f".repeat(64),
  };
  const reviewInput = await preparedPlanning(
    "queue",
    queueRows,
    planningModule.descriptor,
    reviewSubject,
  );
  expect(reviewInput.result).toEqual({
    inputDigest: computeModulePlanInputDigest(reviewInput.input),
    outcome: "REFUSED",
    reason: "INPUT_REFUSED",
    schemaVersion: "module-no-action/v1",
  });

  const notReady = await preparedPlanning(
    "queue",
    queueRows.map((row) => ({ ...row, readiness: "NOT_READY" })),
  );
  expect(notReady.policy.decisions).toEqual([{ capabilityName: "work.read", trip: "TRIP" }]);
  expect(notReady.result).toEqual({
    inputDigest: computeModulePlanInputDigest(notReady.input),
    outcome: "NO_ACTION",
    reason: "NO_ELIGIBLE_ACTION",
    schemaVersion: "module-no-action/v1",
  });

  const missingCapability = await preparedPlanning(
    "queue",
    queueRows.map((row) => ({ ...row, capabilityNames: [] })),
  );
  expect(missingCapability.policy.decisions).toEqual([
    { capabilityName: "work.read", trip: "NO_TRIP" },
  ]);
  expect(missingCapability.result).toEqual({
    inputDigest: computeModulePlanInputDigest(missingCapability.input),
    outcome: "NO_ACTION",
    reason: "NO_ELIGIBLE_ACTION",
    schemaVersion: "module-no-action/v1",
  });

  const allReady = frontier().map((row) => ({ ...row, readiness: "READY" as const }));
  const [readyBranch, readyQueue] = await Promise.all([
    preparedPlanning("branches", allReady),
    preparedPlanning("queue", allReady),
  ]);
  if (
    readyBranch.result.schemaVersion !== "module-action-plan/v1" ||
    readyQueue.result.schemaVersion !== "module-action-plan/v1"
  )
    throw new Error("planning fixture action required");
  const decisionProjection = ({
    inputDigest: _inputDigest,
    ...result
  }: typeof readyBranch.result) => result;
  expect(decisionProjection(readyBranch.result)).toEqual(decisionProjection(readyQueue.result));
  expect(readyBranch.result.inputDigest).not.toBe(readyQueue.result.inputDigest);
  expect(readyBranch.result.workId).toBe(uuid(2));
  expect(readyQueue.result.workId).toBe(uuid(2));
});

test("keeps quarantined planning source effect-free and outside manifest activation", async () => {
  const sourceText = await admittedPlanningSource();
  for (const mutant of [
    "import fs from 'node:fs';",
    "export * from 'node:fs';",
    "void import('node:fs');",
    "void import(dependencyName);",
    "require('node:fs');",
    "require(dependencyName);",
    "const load = require;",
    "Date.now();",
    "Math.random();",
    "process.cwd();",
    "fetch('https://invalid.example');",
    "navigator.platform;",
    "new WebSocket('ws://invalid.example');",
    "structuredClone({});",
  ]) {
    const mutatedSource = `${sourceText}${mutant}\n`;
    expect(createHash("sha256").update(mutatedSource).digest("hex")).not.toBe(planningSourceDigest);
  }
  expect(
    normalizeTrackedText(
      await readFile(new URL("../../../modules/manifest.json", import.meta.url), "utf8"),
    ),
  ).toBe("[]\n");
  const generatorSource = await readFile(
    new URL("../../../modules/build/generate-registry.mjs", import.meta.url),
    "utf8",
  );
  expect(createHash("sha256").update(normalizeTrackedText(generatorSource)).digest("hex")).toBe(
    "0dc6c3fd2e002d90b25bfe3e14b8529cda315555a1c82e029fc08bc212e4cb51",
  );
});

test.each(["THROWN", "WRAPPED"] as const)(
  "%s module return refuses without creating state",
  async (kind) => {
    const f = await fixture();
    const before = await manifest(f.root);
    const original = fixtureModule.plan;
    vi.spyOn(fixtureModule, "plan").mockImplementation(async (input) => {
      if (kind === "THROWN") throw new Error("fixture injected module failure");
      return { ok: true, value: await original(input) } as unknown as Awaited<
        ReturnType<typeof fixtureModule.plan>
      >;
    });
    const result = await consume(
      adapter,
      f.invocation,
      f.configuration,
      f.snapshot,
      f.currentPolicy,
      clocks,
      f.cycleRequest,
    );
    expect(result.ok).toBe(false);
    if (kind === "THROWN")
      expect(result).toEqual({ ok: false, issues: ["fixture:planning-failed"] });
    expect(await manifest(f.root)).toEqual(before);
  },
);

test("exports only the ABI descriptor and native-Promise plan with a concrete result", async () => {
  expect(Object.keys(fixtureModule).sort()).toEqual(["descriptor", "plan"]);
  const f = await fixture();
  let actualReturn: Awaited<ReturnType<typeof fixtureModule.plan>> | undefined;
  const original = fixtureModule.plan;
  vi.spyOn(fixtureModule, "plan").mockImplementation((input) => {
    const promise = original(input);
    expect(promise).toBeInstanceOf(Promise);
    return promise.then((value) => {
      actualReturn = value;
      return value;
    });
  });
  expect(
    (
      await consume(
        adapter,
        f.invocation,
        f.configuration,
        f.snapshot,
        f.currentPolicy,
        clocks,
        f.cycleRequest,
      )
    ).ok,
  ).toBe(true);
  const persisted = await output(f, "module-result.json", "module-plan-result/v1");
  expect(actualReturn).toEqual(persisted);
  expect(actualReturn).not.toHaveProperty("ok");
  expect(actualReturn).not.toHaveProperty("value");
  const input = await output(f, "module-input.json", "module-plan-input/v1");
  const changed = parseModulePlanInput({
    ...input,
    descriptor: { ...descriptor, moduleVersion: "2.0.0" },
  });
  if (!changed.ok) throw new Error("valid alternate descriptor required");
  expect(await original(changed.value)).toEqual({
    inputDigest: computeModulePlanInputDigest(changed.value),
    outcome: "REFUSED",
    reason: "INPUT_REFUSED",
    schemaVersion: "module-no-action/v1",
  });
});
