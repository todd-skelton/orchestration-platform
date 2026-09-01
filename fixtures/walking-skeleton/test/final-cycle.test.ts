import { createHash } from "node:crypto";
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
import { runSkeletonCycleCommand } from "../src/final-cycle-cli.js";
import { replayFixtureJournal } from "../src/journal-owner.js";

type Row = Record<string, any>;
const roots: string[] = [];
const uuid = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const os =
  process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
const adapter =
  os === "WINDOWS"
    ? createWindowsConfigurationHostAdapter()
    : createPortableConfigurationHostAdapter(os);
const clocks = { wallNow: () => "2026-08-31T01:00:00.000Z", monotonicNow: () => 0 };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const parsed = <T extends c.ContractRecord>(result: c.ParseResult<T>): T => {
  if (!result.ok) throw new Error(result.issues.join(","));
  return result.value;
};

async function fixture(artifact = Buffer.from("fixture reviewed artifact v1\n")) {
  const disposableRoot = await realpath(await mkdtemp(join(tmpdir(), "walking-final-cycle-")));
  roots.push(disposableRoot);
  const projectRoot = join(disposableRoot, "project"),
    stateRoot = join(disposableRoot, "state"),
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
  const rows = [
    {
      blocked: false,
      branch: "fixture/opaque",
      capabilityNames: ["work.read"],
      revisionDigest: "a".repeat(64),
      workId: uuid(4),
    },
  ];
  const snapshot = vi.fn(createBranchFixtureSnapshot(() => rows));
  const currentPolicy = vi.fn(createBranchFixtureCurrentPolicy(() => rows));
  const subject = parsed(
    c.parseWorkerResultSubject({
      authorAttemptId: uuid(90),
      authorCycleId: uuid(91),
      baseSource: {
        adapterId: "fixture.branches",
        projectId: uuid(1),
        revision: "fixture.seed.v1",
      },
      result: {
        entries: [{ contentDigest: digest(artifact), kind: "ARTIFACT" }],
        kind: "ORDERED_PATCH_ARTIFACTS",
      },
      schemaVersion: "worker-result-subject/v1",
      terminalReceiptDigest: "b".repeat(64),
    }),
  );
  await writeFile(join(projectRoot, "fixture-review-subject.json"), c.canonicalJson(subject));
  await writeFile(join(projectRoot, "fixture-review-artifact.bin"), artifact);
  const invocation: ConfigurationLoaderInvocation = {
    cwd: projectRoot,
    environment: {
      HOME: null,
      LOCALAPPDATA: null,
      ORCHESTRATION_CONFIG: null,
      ORCHESTRATION_PROJECT_ROOT: null,
      ORCHESTRATION_STATE_ROOT: null,
      XDG_STATE_HOME: null,
    },
    flags: { configPath, projectRoot, stateRoot },
    operatingSystem: os,
  };
  return {
    artifact,
    currentPolicy,
    disposableRoot,
    input: {
      adapter,
      adapterConfiguration: {
        adapterId: "fixture.branches",
        adapterVersion: "1.0.0",
        capabilityNames: ["work.read"],
        engineVersion: "0.0.0",
        projectId: uuid(1),
        schemaVersion: "adapter-configuration/v1",
      },
      clocks,
      currentPolicy,
      cycleId: uuid(3),
      disposableRoot,
      invocation,
      sessionId: uuid(2),
      snapshot,
    },
    projectRoot,
    snapshot,
    stateRoot,
    subject,
  };
}

async function manifest(root: string, excluded: string | null = null): Promise<string[]> {
  const rows: string[] = [];
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name),
        name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (absolute === excluded) continue;
      if (entry.isDirectory()) {
        rows.push(`directory:${name}`);
        await visit(absolute, name);
      } else if (entry.isFile()) rows.push(`file:${name}:${digest(await readFile(absolute))}`);
      else throw new Error("unexpected fixture path kind");
    }
  }
  await visit(root, "");
  return rows.sort();
}

async function record(stateRoot: string, name: string) {
  const bytes = await readFile(join(stateRoot, name));
  const json = JSON.parse(bytes.toString("utf8"));
  const value =
    name === "preflight-review-observation.json"
      ? parsed(c.parseProjectPreflightObservation(json))
      : parsed(c.parseCanonicalContractBytes(json.schemaVersion, bytes));
  expect(c.canonicalJson(value)).toBe(bytes.toString("utf8"));
  return value as Row;
}

function evidenceFor(stateRoot: string, journal: c.EventJournal) {
  const files: Partial<Record<c.RetainedEvidenceKind, string>> = {
    RENDERED_INPUT: "rendered-input.bin",
    STDERR: "stderr.bin",
    STDOUT: "stdout.bin",
  };
  return Promise.all(
    journal.events.map(async (event) =>
      Promise.all(
        event.retainedEvidence.map(async (reference) => ({
          bytes: await readFile(join(stateRoot, files[reference.kind]!)),
          kind: reference.kind,
        })),
      ),
    ),
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  const parent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (dirname(root) !== parent || !root.startsWith(join(parent, "walking-final-cycle-")))
      throw new Error("cleanup outside final cycle fixture");
    await rm(root, { force: true, recursive: true });
  }
});

test("executes one distinct-author accepted cycle as an exact physical 15-step OPJ1 replay", async () => {
  const f = await fixture();
  const outsideBefore = await manifest(f.disposableRoot, f.stateRoot);
  const command = await runSkeletonCycleCommand(f.input);
  expect(command.command).toBe("skeleton:cycle");
  expect(command.exitCode).toBe(0);
  expect(command.result).toMatchObject({
    cleanup: "REMOVED",
    ok: true,
    outcome: "COMPLETED",
    reason: null,
  });
  if (!command.result.ok) throw new Error("accepted cycle required");
  expect(command.result.outsideBefore).toEqual(outsideBefore);
  expect(command.result.outsideAfter).toEqual(outsideBefore);
  expect(await manifest(f.disposableRoot, f.stateRoot)).toEqual(outsideBefore);
  expect(f.snapshot).toHaveBeenCalledTimes(1);
  expect(f.currentPolicy).toHaveBeenCalledTimes(1);

  const journalBytes = await readFile(join(f.stateRoot, "cycle.opj"));
  expect(journalBytes.subarray(0, 5)).toEqual(Buffer.from([0x4f, 0x50, 0x4a, 0x31, 0]));
  const inspected = c.inspectEventJournalBytes(journalBytes);
  expect(inspected).toMatchObject({ ok: true, value: { partialSuffix: false } });
  const physical = parsed(c.parseEventJournalBytes(journalBytes));
  expect(Buffer.from(c.serializeEventJournal(physical)).equals(journalBytes)).toBe(true);
  expect(c.computeEventJournalDigest(physical)).toBe(command.result.journalDigest);
  expect(physical.events).toHaveLength(30);
  const retained = await evidenceFor(f.stateRoot, physical);
  const outputKinds = [
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
    "SKIP",
    "SKIP",
    "RECLAIM",
    "CYCLE_TERMINAL",
  ];
  const expectedEvidence = new Map<number, string[]>([
    [7, ["RENDERED_INPUT"]],
    [9, ["STDERR", "STDOUT"]],
    [11, ["STDERR", "STDOUT"]],
    [14, ["STDERR", "STDOUT"]],
  ]);
  for (let ordinal = 1; ordinal <= 15; ordinal += 1) {
    const started = physical.events[(ordinal - 1) * 2]!,
      terminal = physical.events[(ordinal - 1) * 2 + 1]!;
    expect(started).toMatchObject({
      cycleId: f.input.cycleId,
      output: null,
      phase: "STARTED",
      position: String((ordinal - 1) * 2),
      step: {
        kind: c.routineStepKinds[String(ordinal) as keyof typeof c.routineStepKinds],
        ordinal: String(ordinal),
      },
    });
    expect(terminal).toMatchObject({
      cycleId: f.input.cycleId,
      phase: "TERMINAL",
      position: String((ordinal - 1) * 2 + 1),
      output: { kind: outputKinds[ordinal - 1] },
      step: started.step,
    });
    expect(started.step.predecessorJournalDigest === null).toBe(ordinal === 1);
    expect(terminal.retainedEvidence.map((row) => row.kind)).toEqual(
      expectedEvidence.get(ordinal) ?? [],
    );
    for (const [index, reference] of terminal.retainedEvidence.entries()) {
      const bytes = retained[(ordinal - 1) * 2 + 1]![index]!.bytes;
      expect(reference.byteLength).toBe(String(bytes.byteLength));
      expect(reference.contentDigest).toBe(digest(bytes));
      expect(reference.encoding).toBe("RAW_BYTES");
    }
    expect(c.validateOrchestrationEventBinding(started, retained[(ordinal - 1) * 2]).ok).toBe(true);
    expect(c.validateOrchestrationEventBinding(terminal, retained[(ordinal - 1) * 2 + 1]).ok).toBe(
      true,
    );
  }

  const terminal = (ordinal: number) => physical.events[(ordinal - 1) * 2 + 1]!.output as Row;
  const expectedInputs = [
    c.computeCycleRequestDigest(physical.cyclePlan.request),
    c.canonicalDigest(terminal(2).configuration),
    c.canonicalDigest(terminal(2).facts),
    c.computeModulePlanInputDigest(terminal(4).input),
    c.computeModuleActionPlanDigest(terminal(5).action),
    c.computeRouteSelectionDigest(terminal(6).route),
    c.computeProjectPreflightDigest(terminal(7).preflight),
    c.computeDispatchPlanDigest(terminal(8).plan),
    c.computeWorkerLaunchReceiptDigest(terminal(9).launch),
    c.computeReviewAttemptResultDigest(terminal(10).attempt),
    c.computeDispositionInputDigest(terminal(11).input),
    c.computeActionDispositionDigest(terminal(11).disposition),
    c.computeRoutineStepSkipDigest(terminal(12).skip),
    c.computeResourceReclaimContextDigest(terminal(14).context),
  ];
  for (let ordinal = 1; ordinal <= 14; ordinal += 1)
    expect(physical.events[(ordinal - 1) * 2]!.step.inputDigest).toBe(expectedInputs[ordinal - 1]);

  for (let eventCount = 1; eventCount <= 30; eventCount += 1) {
    const replay = c.reduceEventJournal(
      { ...physical, events: physical.events.slice(0, eventCount) },
      retained.slice(0, eventCount),
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.issues.join(","));
    const event = physical.events[eventCount - 1]!;
    if (event.phase === "STARTED") {
      const ordinal = Number(event.step.ordinal);
      const kind =
        ordinal === 8 || ordinal === 9
          ? "WAITING_WORKER"
          : ordinal === 10
            ? "WAITING_REVIEW"
            : ordinal === 11
              ? "WAITING_ACTION"
              : ordinal === 15
                ? "TERMINALIZING"
                : "RUNNING";
      expect(replay.value.outcome.kind).toBe(kind);
      expect(replay.value.pendingStep).toEqual(event.step);
    }
  }
  const pre15 = parsed(
    c.reduceEventJournal(
      { ...physical, events: physical.events.slice(0, 28) },
      retained.slice(0, 28),
    ),
  );
  expect(physical.events[28]!.step.inputDigest).toBe(c.computeReducedStateDigest(pre15));
  const terminalizing = parsed(
    c.reduceEventJournal(
      { ...physical, events: physical.events.slice(0, 29) },
      retained.slice(0, 29),
    ),
  );
  expect(terminalizing.outcome.kind).toBe("TERMINALIZING");
  const receipt = terminal(15).receipt;
  expect(
    c.validateCycleReceiptBinding(
      { ...physical, events: physical.events.slice(0, 29) },
      terminalizing,
      receipt,
      retained.slice(0, 29),
    ).ok,
  ).toBe(true);
  expect(c.reduceEventJournal(physical, retained)).toEqual({
    ok: true,
    value: command.result.reduced,
  });
  expect(command.result.reduced).toMatchObject({
    outcome: { kind: "COMPLETED", cycleReceiptDigest: c.computeCycleReceiptDigest(receipt) },
    pendingStep: null,
  });

  const request = terminal(7).reviewRequest,
    attempt = terminal(9).attempt,
    authority = terminal(10).authority,
    disposition = terminal(11).disposition;
  expect(f.subject.authorCycleId).not.toBe(f.input.cycleId);
  expect(f.subject.authorAttemptId).not.toBe(terminal(7).plan.attemptId);
  expect(attempt.attemptId).toBe(terminal(7).plan.attemptId);
  expect(attempt.attemptId).not.toBe(f.subject.authorAttemptId);
  expect(authority.outcome.kind).toBe("accepted");
  expect(c.validateReviewResultBinding(request, attempt, authority).ok).toBe(true);
  expect(disposition).toMatchObject({ code: "review.complete", outcome: { kind: "COMPLETE" } });
  expect(terminal(11).followUp).toBeNull();
  expect(
    c.validateActionDispositionBinding(
      terminal(11).input,
      await readFile(join(f.stateRoot, "stdout.bin")),
      await readFile(join(f.stateRoot, "stderr.bin")),
      disposition,
    ).ok,
  ).toBe(true);
  expect(terminal(12).skip).toMatchObject({
    reason: "no-mutation",
    step: { inputDigest: c.computeActionDispositionDigest(disposition) },
  });
  expect(terminal(13).skip).toMatchObject({
    reason: "no-mutation",
    step: { inputDigest: c.computeRoutineStepSkipDigest(terminal(12).skip) },
  });

  const reclaim = terminal(14);
  expect(reclaim.context.origin).toMatchObject({ kind: "ACTION", followUp: null, mutation: null });
  expect(reclaim.receipt).toMatchObject({
    outcome: { kind: "RECLAIMED" },
    process: {
      handles: { process: "CLOSED", stderr: "CLOSED", stdin: "CLOSED", stdout: "CLOSED" },
      kind: "OBSERVED",
    },
  });
  expect(reclaim.receipt.observations).toHaveLength(1);
  expect(reclaim.receipt.observations[0]).toMatchObject({
    allocation: { owner: "HOST", state: "ALLOCATED" },
    before: { result: { kind: "COMPLETE", value: { kind: "PRESENT" } } },
    after: { result: { kind: "COMPLETE", value: { kind: "ABSENT" } } },
    outcome: { kind: "RECLAIMED" },
    source: "DISPATCH",
  });
  expect(reclaim.receipt.reclaimTransactionId).not.toBe(terminal(7).plan.attemptId);
  expect(
    c.validateResourceReclaimReceiptBinding(
      reclaim.context,
      null,
      await readFile(join(f.stateRoot, "stdout.bin")),
      await readFile(join(f.stateRoot, "stderr.bin")),
      reclaim.receipt,
    ).ok,
  ).toBe(true);
  await expect(readFile(join(f.stateRoot, "echo-input.bin"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(readFile(join(f.stateRoot, "session-claim.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });

  const names = (await readdir(f.stateRoot)).sort();
  expect(names).toEqual(
    [
      "action-disposition.json",
      "adapter-configuration.json",
      "breaker-receipt.json",
      "configuration-paths.json",
      "configuration-provenance.json",
      "cycle-plan.json",
      "cycle-receipt.json",
      "cycle-request.json",
      "cycle.opj",
      "dispatch-plan.json",
      "dispatch-session-health.json",
      "echo-ownership.json",
      "module-descriptor.json",
      "module-input.json",
      "module-result.json",
      "platform-configuration-source.json",
      "preflight-review-observation.json",
      "preflight-review-subject.json",
      "project-breaker-facts.json",
      "project-facts.json",
      "project-preflight.json",
      "rendered-input.bin",
      "resource-reclaim-receipt.json",
      "review-attempt.json",
      "review-authority.json",
      "review-expected.bin",
      "review-procedure.bin",
      "review-request.json",
      "route-selection.json",
      "routine-step-skip-12.json",
      "routine-step-skip-13.json",
      "seed-artifact.bin",
      "session-acquire-request.json",
      "session-health.json",
      "session-receipt.json",
      "stderr.bin",
      "stdout.bin",
      "worker-host.json",
      "worker-launch.json",
      "worker-terminal.json",
    ].sort(),
  );
  for (const name of names.filter((name) => name.endsWith(".json")))
    await record(f.stateRoot, name);
  for (const absent of [
    "reduced-state.json",
    "resource-reclaim-context.json",
    "journal.json",
    "cycle.opj.tmp",
    "credentials.json",
    "worker.pid",
    "project-mutation-request.json",
    "project-mutation-plan.json",
    "project-apply-receipt.json",
  ])
    expect(names).not.toContain(absent);
  const closed = await replayFixtureJournal(join(f.stateRoot, "cycle.opj"), {
    RENDERED_INPUT: join(f.stateRoot, "rendered-input.bin"),
    STDERR: join(f.stateRoot, "stderr.bin"),
    STDOUT: join(f.stateRoot, "stdout.bin"),
  });
  expect(closed).toMatchObject({ ok: true, value: { reduced: command.result.reduced } });
}, 30_000);
