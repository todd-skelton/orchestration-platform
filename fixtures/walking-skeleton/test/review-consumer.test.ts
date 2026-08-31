import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as c from "@orchestration-platform/contracts";
import {
  createBranchFixtureCurrentPolicy,
  createBranchFixtureSnapshot,
} from "../../../packages/adapter-sdk/src/fixtures.js";
import {
  createPortableConfigurationHostAdapter,
  createWindowsConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import { consumeEcho, consumeReview } from "../src/echo-consumer.js";
import * as echoWorker from "../src/echo-worker.js";
import * as reviewModule from "../src/review-module.js";
import { acquireFixtureSession } from "../src/session.js";

const roots: string[] = [],
  leases: Array<{ close(): Promise<unknown> }> = [];
const uuid = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const os =
  process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
const adapter =
  os === "WINDOWS"
    ? createWindowsConfigurationHostAdapter()
    : createPortableConfigurationHostAdapter(os);
const clocks = { wallNow: () => "2026-08-31T01:00:00.000Z", monotonicNow: () => 0 };
async function fixture(artifact = Buffer.from("fixture reviewed artifact v1\n")) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "walking-review-")));
  roots.push(root);
  const projectRoot = join(root, "project"),
    stateRoot = join(root, "state"),
    configPath = join(projectRoot, ".orchestration", "project.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    c.canonicalJson({
      adapterId: "fixture.branches",
      capabilityNames: ["work.read"],
      leaseFreshnessMs: 30000,
      maximumSessionMs: 3600000,
      projectId: uuid(1),
      schemaVersion: "platform-configuration-source/v1",
      stateRoot: null,
      wallClockSkewMs: 1000,
    }),
  );
  const invocation: ConfigurationLoaderInvocation = {
    cwd: projectRoot,
    operatingSystem: os,
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
    adapterId: "fixture.branches",
    adapterVersion: "1.0.0",
    capabilityNames: ["work.read"],
    engineVersion: "0.0.0",
    projectId: uuid(1),
    schemaVersion: "adapter-configuration/v1",
  };
  const rows: c.ProjectFrontierRow[] = [
    {
      workId: uuid(4),
      immutableSubjectDigest: "a".repeat(64),
      capabilityNames: ["work.read"],
      readiness: "READY",
    },
  ];
  const raw = () =>
    rows.map((row) => ({
      workId: row.workId,
      branch: "fixture/opaque",
      revisionDigest: row.immutableSubjectDigest,
      blocked: row.readiness !== "READY",
      capabilityNames: row.capabilityNames,
    }));
  const snapshot = vi.fn(createBranchFixtureSnapshot(raw)),
    policy = vi.fn(createBranchFixtureCurrentPolicy(raw));
  const subject = parsed(
    c.parseWorkerResultSubject({
      authorAttemptId: uuid(90),
      authorCycleId: uuid(91),
      baseSource: {
        adapterId: configuration.adapterId,
        projectId: configuration.projectId,
        revision: "fixture.seed.v1",
      },
      result: {
        kind: "ORDERED_PATCH_ARTIFACTS",
        entries: [
          { kind: "ARTIFACT", contentDigest: createHash("sha256").update(artifact).digest("hex") },
        ],
      },
      schemaVersion: "worker-result-subject/v1",
      terminalReceiptDigest: "b".repeat(64),
    }),
  );
  const subjectPath = join(projectRoot, "fixture-review-subject.json"),
    artifactPath = join(projectRoot, "fixture-review-artifact.bin");
  await writeFile(subjectPath, c.canonicalJson(subject));
  await writeFile(artifactPath, artifact);
  const run = () =>
    consumeReview(adapter, invocation, configuration, snapshot, policy, clocks, uuid(2), uuid(3));
  return {
    root,
    projectRoot,
    configuration,
    subject,
    subjectPath,
    artifactPath,
    stateRoot,
    invocation,
    rows,
    snapshot,
    policy,
    run,
    claim: join(stateRoot, "session-claim.json"),
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const lease of leases.splice(0)) await lease.close();
  const parent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (dirname(root) !== parent || !root.startsWith(join(parent, "walking-review-")))
      throw new Error("cleanup outside echo fixture");
    await rm(root, { recursive: true, force: true });
  }
});
async function manifest(root: string, excluded: string | null = null): Promise<string[]> {
  const entries: string[] = [];
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name),
        name = `${prefix}/${entry.name}`;
      if (absolute === excluded) continue;
      if (entry.isDirectory()) {
        entries.push(`directory:${name}`);
        await visit(absolute, name);
      } else if (entry.isFile())
        entries.push(
          `${name}:${createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex")}`,
        );
      else throw new Error("unexpected echo fixture path kind");
    }
  }
  await visit(root, "");
  return entries.sort();
}
function parsed<T extends c.ContractRecord>(value: c.ParseResult<T>): T {
  if (!value.ok) throw new Error(value.issues.join(","));
  return value.value;
}
async function record(f: Awaited<ReturnType<typeof fixture>>, name: string) {
  const bytes = await readFile(join(f.stateRoot, name)),
    schema = JSON.parse(bytes.toString("utf8")).schemaVersion;
  const value =
    name === "preflight-review-observation.json"
      ? parsed(c.parseProjectPreflightObservation(JSON.parse(bytes.toString("utf8"))))
      : parsed(c.parseCanonicalContractBytes(schema, bytes));
  expect(c.canonicalJson(value)).toBe(bytes.toString("utf8"));
  expect(bytes.toString("utf8")).not.toContain(f.root);
  return value;
}
async function noEcho(f: Awaited<ReturnType<typeof fixture>>) {
  if (!existsSync(f.stateRoot)) return;
  const names = await readdir(f.stateRoot);
  for (const name of [
    "echo-input.bin",
    "echo-ownership.json",
    "dispatch-plan.json",
    "worker-launch.json",
    "worker-terminal.json",
    "stdout.bin",
    "stderr.bin",
  ])
    expect(names).not.toContain(name);
  expect(names).not.toContain("session-claim.json");
}

const reference = (bytes: Uint8Array) => ({
  byteLength: String(bytes.byteLength),
  contentDigest: createHash("sha256").update(bytes).digest("hex"),
});
async function tuple(f: Awaited<ReturnType<typeof fixture>>) {
  const input = parsed(c.parseModulePlanInput(await record(f, "module-input.json"))),
    action = parsed(c.parseModuleActionPlan(await record(f, "module-result.json"))),
    route = parsed(c.parseRouteSelection(await record(f, "route-selection.json"))),
    preflight = parsed(c.parseProjectPreflight(await record(f, "project-preflight.json"))),
    observation = parsed(
      c.parseProjectPreflightObservation(await record(f, "preflight-review-observation.json")),
    ),
    dispatch = parsed(c.parseDispatchPlan(await record(f, "dispatch-plan.json"))),
    request = parsed(c.parseReviewRequest(await record(f, "review-request.json"))),
    launch = parsed(c.parseWorkerLaunchReceipt(await record(f, "worker-launch.json"))),
    terminal = parsed(c.parseWorkerTerminalReceipt(await record(f, "worker-terminal.json"))),
    stdout = await readFile(join(f.stateRoot, "stdout.bin")),
    stderr = await readFile(join(f.stateRoot, "stderr.bin")),
    rendered = await readFile(join(f.stateRoot, "echo-input.bin"));
  expect(c.validateModulePlanBinding(input, action).ok).toBe(true);
  expect(c.validateRouteSelectionBinding(input, action, echoWorker.echoMapping, route).ok).toBe(
    true,
  );
  expect(
    c.validateProjectPreflightBinding(
      input,
      action,
      echoWorker.echoMapping,
      route,
      observation,
      preflight,
    ).ok,
  ).toBe(true);
  expect(
    c.validateDispatchPlanBinding(
      input,
      action,
      echoWorker.echoMapping,
      route,
      observation,
      preflight,
      await record(f, "cycle-plan.json"),
      await record(f, "dispatch-session-health.json"),
      request,
      rendered,
      dispatch,
    ),
  ).toEqual({ ok: true, value: dispatch });
  expect(c.validateWorkerLaunchReceiptBinding(dispatch, launch).ok).toBe(true);
  expect(
    c.validateWorkerTerminalReceiptBinding(dispatch, launch, stdout, stderr, terminal),
  ).toEqual({ ok: true, value: terminal });
  expect(stdout).toEqual(rendered);
  expect(stderr).toEqual(Buffer.alloc(0));
  expect(rendered.toString("utf8")).toBe(c.canonicalJson(request.packet));
  expect(launch).toMatchObject({
    outcome: { kind: "LIVE" },
    ownership: "PUBLISHED",
    resources: [{ owner: "HOST", ownerTransactionId: dispatch.attemptId, state: "ALLOCATED" }],
  });
  expect(launch.processes.entries).toHaveLength(1);
  expect(terminal.processes.entries).toEqual([{ ...launch.processes.entries[0], state: "DEAD" }]);
  expect(terminal.outcome).toEqual({ kind: "EXITED", exit: { kind: "EXIT_CODE", value: "0" } });
  expect(terminal.capture).toMatchObject({
    stdout: { kind: "COMPLETE" },
    stderr: { kind: "COMPLETE" },
  });
  return {
    input,
    action,
    route,
    preflight,
    observation,
    dispatch,
    request,
    launch,
    terminal,
    stdout,
    stderr,
  };
}

test.each([true, false])(
  "actual seeded review accepted=%s binds every retained public tuple and raw finding byte",
  async (accepted) => {
    const artifact = accepted
      ? Buffer.from("fixture reviewed artifact v1\n")
      : Buffer.from([255, 0, 1]);
    const f = await fixture(artifact),
      outside = await manifest(f.root, f.stateRoot),
      decision = vi.spyOn(reviewModule, "disposition");
    const realEcho = echoWorker.runEcho,
      execution = vi.spyOn(echoWorker, "runEcho").mockImplementation(async (...args) => {
        expect(await readFile(join(f.stateRoot, "seed-artifact.bin"))).toEqual(artifact);
        expect(await readFile(join(f.stateRoot, "review-expected.bin"))).toEqual(
          Buffer.from("fixture reviewed artifact v1\n"),
        );
        expect(await readFile(join(f.stateRoot, "review-procedure.bin"), "utf8")).toBe(
          "fixture-only review: compare the retained artifact with the fixed expected bytes\n",
        );
        return realEcho(...args);
      });
    const result = await f.run();
    expect(result).toMatchObject({
      ok: accepted,
      ...(accepted ? {} : { reason: "REVIEW_REJECTED" }),
      acquisition: { outcome: "ACQUIRED" },
      health: { outcome: "HEALTHY", step: null },
      cleanup: "REMOVED",
      review: { authority: { outcome: { kind: accepted ? "accepted" : "rejected" } } },
    });
    expect(decision).not.toHaveBeenCalled();
    expect(execution).toHaveBeenCalledTimes(1);
    expect(f.snapshot).toHaveBeenCalledTimes(1);
    expect(f.policy).toHaveBeenCalledTimes(1);
    expect(f.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
      f.policy.mock.invocationCallOrder[0]!,
    );
    const names = (await readdir(f.stateRoot)).sort();
    expect(names).toEqual(
      [
        "platform-configuration-source.json",
        "configuration-provenance.json",
        "configuration-paths.json",
        "session-acquire-request.json",
        "cycle-request.json",
        "cycle-plan.json",
        "session-receipt.json",
        "session-health.json",
        "adapter-configuration.json",
        "project-facts.json",
        "project-breaker-facts.json",
        "breaker-receipt.json",
        "module-descriptor.json",
        "module-input.json",
        "module-result.json",
        "route-selection.json",
        "worker-host.json",
        "preflight-review-subject.json",
        "preflight-review-observation.json",
        "project-preflight.json",
        "review-request.json",
        "dispatch-session-health.json",
        "dispatch-plan.json",
        "echo-input.bin",
        "echo-ownership.json",
        "worker-launch.json",
        "worker-terminal.json",
        "stdout.bin",
        "stderr.bin",
        "review-attempt.json",
        "review-authority.json",
        "seed-artifact.bin",
        "review-expected.bin",
        "review-procedure.bin",
      ].sort(),
    );
    for (const name of names.filter((name) => name.endsWith(".json"))) await record(f, name);
    const t = await tuple(f);
    expect(t.input.descriptor).toEqual(reviewModule.descriptor);
    expect(t.input.cycleRequest.allowedModuleIds).toEqual([reviewModule.descriptor.moduleId]);
    expect(t.input.reviewSubject).toEqual(f.subject);
    expect(t.action.workId).toBeNull();
    expect(t.action.actionCore.requestedRole).toBe("review");
    expect(t.request.packet.brief).toEqual(t.action.dispatchBrief);
    expect(t.request.packet.subject).toEqual(f.subject);
    expect(t.request.reviewCycleId).toBe(uuid(3));
    expect(t.request.reviewCycleId).not.toBe(f.subject.authorCycleId);
    expect(t.dispatch.attemptId).not.toBe(f.subject.authorAttemptId);
    expect(t.observation).toMatchObject({
      kind: "REVIEW",
      observedAt: clocks.wallNow(),
      result: { kind: "AVAILABLE", subject: f.subject },
    });
    if (t.observation.kind !== "REVIEW") throw new Error("review observation required");
    expect(t.observation.observationId).not.toBe(t.input.projectFacts.observationId);
    expect(t.observation.observationId).not.toBe(t.input.policyFacts.observationId);
    expect(t.preflight.observationDigest).toBe(
      c.computeProjectPreflightObservationDigest(t.observation),
    );
    expect(await record(f, "preflight-review-subject.json")).toEqual(f.subject);
    expect(await record(f, "echo-ownership.json")).toEqual(t.dispatch);
    expect(
      c.validateBreakerReceiptBinding(
        t.input.configurationProvenance,
        t.input.adapterConfiguration,
        t.input.cycleRequest,
        t.input.projectFacts,
        t.input.policyFacts,
        null,
        await record(f, "breaker-receipt.json"),
      ).ok,
    ).toBe(true);
    const attempt = parsed(c.parseReviewAttemptResult(await record(f, "review-attempt.json"))),
      authority = parsed(c.parseReviewAuthority(await record(f, "review-authority.json")));
    expect(c.validateReviewResultBinding(t.request, attempt, authority)).toEqual({
      ok: true,
      value: authority,
    });
    expect(attempt).toMatchObject({
      attemptId: t.dispatch.attemptId,
      cycleId: uuid(3),
      dispatchPlanDigest: c.computeDispatchPlanDigest(t.dispatch),
      launchReceiptDigest: c.computeWorkerLaunchReceiptDigest(t.launch),
      terminalReceiptDigest: c.computeWorkerTerminalReceiptDigest(t.terminal),
      subjectDigest: c.computeWorkerResultSubjectDigest(f.subject),
      result: { kind: accepted ? "SWEEP_COMPLETE" : "BLOCKED" },
    });
    const expected = await readFile(join(f.stateRoot, "review-expected.bin")),
      procedure = await readFile(join(f.stateRoot, "review-procedure.bin"));
    expect(await readFile(join(f.stateRoot, "seed-artifact.bin"))).toEqual(artifact);
    expect(expected).toEqual(Buffer.from("fixture reviewed artifact v1\n"));
    expect(procedure.toString("utf8")).toBe(
      "fixture-only review: compare the retained artifact with the fixed expected bytes\n",
    );
    expect(attempt.result.evidence).toEqual([artifact, expected, procedure].map(reference));
    expect(t.request.packet.evidence).toEqual(attempt.result.evidence);
    if (!accepted) {
      if (attempt.result.kind !== "BLOCKED") throw new Error("blocked finding required");
      expect(attempt.result.findings).toEqual([
        {
          findingId: "fixture.artifact-mismatch",
          disposition: {
            code: "review.reject",
            moduleDescriptorDigest: c.computeModuleDescriptorDigest(reviewModule.descriptor),
          },
          evidence: {
            expected: reference(expected),
            observed: reference(artifact),
            procedure: reference(procedure),
          },
        },
      ]);
    }
    // Unit composition only: the consumer above must not pretend it executed journal step 11.
    expect(Object.keys(reviewModule).sort()).toEqual(["descriptor", "disposition", "plan"]);
    const input = parsed(
      c.parseDispositionInput({
        actionPlan: t.action,
        moduleInput: t.input,
        route: t.route,
        preflight: t.preflight,
        skips: [],
        worker: { plan: t.dispatch, launch: t.launch, terminal: t.terminal, resultSubject: null },
        review: { request: t.request, attempt, authority },
      }),
    );
    const before = c.canonicalJson(input),
      promise = reviewModule.disposition(input);
    expect(promise).toBeInstanceOf(Promise);
    const disposition = await promise;
    expect(c.validateActionDispositionBinding(input, t.stdout, t.stderr, disposition)).toEqual({
      ok: true,
      value: disposition,
    });
    expect(disposition.outcome.kind).toBe(accepted ? "COMPLETE" : "FOLLOW_UP");
    expect(c.canonicalJson(input)).toBe(before);
    expect(await manifest(f.root, f.stateRoot)).toEqual(outside);
    const retained = await manifest(f.root);
    expect(await f.run()).toMatchObject({
      ok: false,
      reason: "HISTORY_UNPROVEN",
      cleanup: "REMOVED",
    });
    expect(await manifest(f.root)).toEqual(retained);
  },
  30000,
);

test.each([
  "missing",
  "noncanonical",
  "artifact",
  "adapter",
  "project",
  "cycle",
  "revision",
  "tree",
  "patch",
] as const)("seed %s refuses before any worker effect", async (control) => {
  const f = await fixture(),
    seed = JSON.parse(c.canonicalJson(f.subject));
  if (control === "missing") await rm(f.subjectPath);
  else if (control === "artifact") await writeFile(f.artifactPath, "bytes not bound by the seed\n");
  else {
    if (control === "adapter") seed.baseSource.adapterId = "other.adapter";
    if (control === "project") seed.baseSource.projectId = uuid(99);
    if (control === "cycle") seed.authorCycleId = uuid(3);
    if (control === "revision") seed.baseSource.revision = "fixture.seed.v2";
    if (control === "tree")
      seed.result = {
        kind: "TREE",
        treeDigest: reference(Buffer.from("fixture reviewed artifact v1\n")).contentDigest,
      };
    if (control === "patch") seed.result.entries[0].kind = "PATCH";
    await writeFile(
      f.subjectPath,
      control === "noncanonical" ? JSON.stringify(seed) : c.canonicalJson(seed),
    );
  }
  const outside = await manifest(f.root, f.stateRoot),
    execution = vi.spyOn(echoWorker, "runEcho"),
    planning = vi.spyOn(reviewModule, "plan");
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: ["adapter", "project"].includes(control)
      ? "REVIEW_SOURCE_REFUSED"
      : "OBSERVATION_REFUSED",
    cleanup: "REMOVED",
  });
  expect(execution).not.toHaveBeenCalled();
  expect(planning).not.toHaveBeenCalled();
  await noEcho(f);
  expect(existsSync(f.stateRoot) ? await readdir(f.stateRoot) : []).toEqual([]);
  expect(await manifest(f.root, f.stateRoot)).toEqual(outside);
});

test("a seed moved after initial SDK observation becomes real refused preflight without allocation", async () => {
  const f = await fixture(),
    original = f.policy.getMockImplementation()!,
    execution = vi.spyOn(echoWorker, "runEcho");
  let changed: string[] = [];
  f.policy.mockImplementation(async (...args) => {
    const result = await original(...args);
    await writeFile(
      f.subjectPath,
      c.canonicalJson({ ...f.subject, terminalReceiptDigest: "c".repeat(64) }),
    );
    changed = await manifest(f.root, f.stateRoot);
    return result;
  });
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "PREFLIGHT_NOT_ELIGIBLE",
    preflight: { outcome: { kind: "REFUSED", reason: "TARGET_CHANGED" } },
    cleanup: "REMOVED",
  });
  expect(execution).not.toHaveBeenCalled();
  await noEcho(f);
  const input = await record(f, "module-input.json"),
    action = await record(f, "module-result.json"),
    route = await record(f, "route-selection.json"),
    observation = await record(f, "preflight-review-observation.json"),
    preflight = await record(f, "project-preflight.json");
  expect(
    c.validateProjectPreflightBinding(
      input,
      action,
      echoWorker.echoMapping,
      route,
      observation,
      preflight,
    ).ok,
  ).toBe(true);
  expect(await manifest(f.root, f.stateRoot)).toEqual(changed);
  expect(await readdir(f.stateRoot)).not.toContain("review-authority.json");
});

test("a seed moved after the real child exits retains only unknown review authority", async () => {
  const f = await fixture(),
    original = echoWorker.runEcho;
  let changed: string[] = [];
  const execution = vi.spyOn(echoWorker, "runEcho").mockImplementation(async (...args) => {
    const result = await original(...args);
    expect(result.terminal?.outcome).toEqual({
      kind: "EXITED",
      exit: { kind: "EXIT_CODE", value: "0" },
    });
    await writeFile(
      f.subjectPath,
      c.canonicalJson({ ...f.subject, terminalReceiptDigest: "d".repeat(64) }),
    );
    changed = await manifest(f.root, f.stateRoot);
    return result;
  });
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "REVIEW_TARGET_CHANGED",
    cleanup: "REMOVED",
    authority: {
      outcome: { kind: "unknown", reason: "TARGET_CHANGED", attemptResultDigest: null },
    },
  });
  expect(execution).toHaveBeenCalledTimes(1);
  const t = await tuple(f),
    authority = await record(f, "review-authority.json");
  expect(c.validateReviewResultBinding(t.request, null, authority).ok).toBe(true);
  for (const name of ["review-attempt.json", "session-claim.json"])
    expect(await readdir(f.stateRoot)).not.toContain(name);
  expect(await readFile(join(f.stateRoot, "seed-artifact.bin"))).toEqual(
    Buffer.from("fixture reviewed artifact v1\n"),
  );
  expect(await readFile(join(f.stateRoot, "review-expected.bin"))).toEqual(
    Buffer.from("fixture reviewed artifact v1\n"),
  );
  expect(await readFile(join(f.stateRoot, "review-procedure.bin"), "utf8")).toBe(
    "fixture-only review: compare the retained artifact with the fixed expected bytes\n",
  );
  expect(await manifest(f.root, f.stateRoot)).toEqual(changed);
}, 30000);

test("held session refuses review before SDK callbacks and preserves every existing byte", async () => {
  const f = await fixture(),
    held = await acquireFixtureSession(adapter, f.invocation, uuid(20), uuid(21), clocks);
  if (!held.ok || !held.lease) throw new Error("actual holder required");
  leases.push(held.lease);
  const before = await manifest(f.root),
    planning = vi.spyOn(reviewModule, "plan"),
    execution = vi.spyOn(echoWorker, "runEcho");
  expect(await f.run()).toMatchObject({
    ok: false,
    reason: "SESSION_NOT_ACQUIRED",
    acquisition: { outcome: "REFUSED", reason: "SESSION_HELD" },
  });
  expect(f.snapshot).not.toHaveBeenCalled();
  expect(f.policy).not.toHaveBeenCalled();
  expect(planning).not.toHaveBeenCalled();
  expect(execution).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
  expect(await held.lease.inspect()).toMatchObject({ outcome: "HEALTHY", step: null });
});

test("ordinary consumeEcho still ignores seeded-review files and preserves its original observer contract", async () => {
  const f = await fixture();
  await writeFile(f.subjectPath, "deliberately malformed optional seed\n");
  const before = await manifest(f.root, f.stateRoot),
    planning = vi.spyOn(reviewModule, "plan"),
    decision = vi.spyOn(reviewModule, "disposition");
  expect(
    await consumeEcho(
      adapter,
      f.invocation,
      f.configuration,
      f.snapshot,
      f.policy,
      clocks,
      uuid(2),
      uuid(3),
    ),
  ).toMatchObject({ ok: true, cleanup: "REMOVED", worker: { retained: false } });
  expect(planning).not.toHaveBeenCalled();
  expect(decision).not.toHaveBeenCalled();
  expect(f.snapshot).toHaveBeenCalledTimes(2);
  expect(await record(f, "module-input.json")).toMatchObject({
    reviewSubject: null,
    descriptor: { moduleId: "fixture.contract-consumer" },
  });
  expect(await record(f, "dispatch-plan.json")).toMatchObject({ reviewRequestDigest: null });
  const names = await readdir(f.stateRoot);
  expect(names).toContain("preflight-project-facts.json");
  for (const name of [
    "review-request.json",
    "review-attempt.json",
    "review-authority.json",
    "preflight-review-observation.json",
  ])
    expect(names).not.toContain(name);
  expect(await manifest(f.root, f.stateRoot)).toEqual(before);
}, 30000);
