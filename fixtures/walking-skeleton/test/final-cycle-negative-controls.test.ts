import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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
import {
  runSkeletonNegativeControlsCommand,
  type SkeletonNegativeControlInput,
} from "../src/final-cycle-cli.js";
import { consumeFinalReviewCycle } from "../src/final-cycle.js";
import { FixtureJournalOwner, replayFixtureJournal } from "../src/journal-owner.js";

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
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const parsed = <T extends c.ContractRecord>(result: c.ParseResult<T>): T => {
  if (!result.ok) throw new Error(result.issues.join(","));
  return result.value;
};

async function fixture(options: { artifact?: Buffer; malformed?: boolean; id: number }) {
  const disposableRoot = await realpath(
    await mkdtemp(join(tmpdir(), `walking-final-control-${options.id}-`)),
  );
  roots.push(disposableRoot);
  const projectRoot = join(disposableRoot, "project"),
    stateRoot = join(disposableRoot, "state"),
    configPath = join(projectRoot, ".orchestration", "project.json"),
    artifact = options.artifact ?? Buffer.from("fixture reviewed artifact v1\n");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    c.canonicalJson({
      adapterId: "fixture.branches",
      capabilityNames: ["work.read"],
      leaseFreshnessMs: 30000,
      maximumSessionMs: 3600000,
      projectId: uuid(options.id),
      schemaVersion: "platform-configuration-source/v1",
      stateRoot: null,
      wallClockSkewMs: 1000,
    }),
  );
  const work = [
    {
      blocked: false,
      branch: "fixture/opaque",
      capabilityNames: ["work.read"],
      revisionDigest: options.malformed ? "not-a-digest" : "a".repeat(64),
      workId: uuid(options.id + 100),
    },
  ];
  const snapshot = vi.fn(createBranchFixtureSnapshot(() => work));
  const currentPolicy = vi.fn(createBranchFixtureCurrentPolicy(() => work));
  const subject = parsed(
    c.parseWorkerResultSubject({
      authorAttemptId: uuid(options.id + 200),
      authorCycleId: uuid(options.id + 201),
      baseSource: {
        adapterId: "fixture.branches",
        projectId: uuid(options.id),
        revision: "fixture.seed.v1",
      },
      result: {
        entries: [{ contentDigest: hash(artifact), kind: "ARTIFACT" }],
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
    currentPolicy,
    disposableRoot,
    input: {
      adapter,
      adapterConfiguration: {
        adapterId: "fixture.branches",
        adapterVersion: "1.0.0",
        capabilityNames: ["work.read"],
        engineVersion: "0.0.0",
        projectId: uuid(options.id),
        schemaVersion: "adapter-configuration/v1",
      },
      clocks,
      currentPolicy,
      cycleId: uuid(options.id + 2),
      disposableRoot,
      invocation,
      sessionId: uuid(options.id + 1),
      snapshot,
    },
    snapshot,
    stateRoot,
    subject,
  };
}

async function manifest(root: string): Promise<string[]> {
  const rows: string[] = [];
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name),
        name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        rows.push(`directory:${name}`);
        await visit(absolute, name);
      } else if (entry.isFile()) rows.push(`file:${name}:${hash(await readFile(absolute))}`);
      else throw new Error("unexpected control path kind");
    }
  }
  await visit(root, "");
  return rows.sort();
}

async function physical(stateRoot: string) {
  const bytes = await readFile(join(stateRoot, "cycle.opj"));
  const journal = parsed(c.parseEventJournalBytes(bytes));
  const evidence = await Promise.all(
    journal.events.map((event) =>
      Promise.all(
        event.retainedEvidence.map(async (reference) => ({
          bytes: await readFile(
            join(
              stateRoot,
              reference.kind === "RENDERED_INPUT"
                ? "rendered-input.bin"
                : reference.kind === "STDERR"
                  ? "stderr.bin"
                  : "stdout.bin",
            ),
          ),
          kind: reference.kind,
        })),
      ),
    ),
  );
  return { bytes, evidence, journal };
}

afterEach(async () => {
  vi.restoreAllMocks();
  const parent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (dirname(root) !== parent || !root.startsWith(join(parent, "walking-final-control-")))
      throw new Error("cleanup outside final control fixture");
    await rm(root, { force: true, recursive: true });
  }
});

test("reserved negative command runs malformed, rejected and concurrent controls without authority leakage", async () => {
  const malformed = await fixture({ id: 10, malformed: true }),
    rejected = await fixture({ artifact: Buffer.from("mismatching reviewed artifact\n"), id: 20 }),
    concurrent = await fixture({ id: 30 });
  const malformedBefore = await manifest(malformed.disposableRoot),
    concurrentBefore = await manifest(concurrent.disposableRoot);
  const input: SkeletonNegativeControlInput = {
    concurrent: {
      contender: { cycleId: uuid(333), sessionId: uuid(332) },
      holder: concurrent.input,
    },
    malformed: malformed.input,
    rejected: rejected.input,
  };
  const command = await runSkeletonNegativeControlsCommand(input);
  expect(command).toMatchObject({ command: "skeleton:negative-controls", exitCode: 0, ok: true });
  const malformedControl = command.controls.malformed;
  expect(malformedControl).toMatchObject({
    cleanup: "REMOVED",
    facts: { reason: "MALFORMED_OBSERVATION", state: "UNKNOWN" },
    ok: false,
    reason: "MALFORMED_FRONTIER",
  });
  if (!("files" in malformedControl)) throw new Error("typed malformed control required");
  expect(malformedControl.files).not.toContain("cycle.opj");
  expect(malformedControl.files).not.toContain("session-claim.json");
  expect(malformed.snapshot).toHaveBeenCalledTimes(1);
  expect(malformed.currentPolicy).not.toHaveBeenCalled();
  expect(await manifest(malformed.disposableRoot)).toEqual(malformedBefore);

  expect(command.controls.concurrent).toMatchObject({
    cleanup: "REMOVED",
    holder: { outcome: "ACQUIRED" },
    ok: false,
    reason: "SESSION_HELD",
    refused: { outcome: "REFUSED", reason: "SESSION_HELD" },
  });
  expect(concurrent.snapshot).not.toHaveBeenCalled();
  expect(concurrent.currentPolicy).not.toHaveBeenCalled();
  expect(await manifest(concurrent.disposableRoot)).toEqual(concurrentBefore);

  const result = command.controls.rejected;
  expect(result).toMatchObject({
    cleanup: "REMOVED",
    ok: false,
    outcome: "FAILED_KNOWN",
    reason: "REVIEW_REJECTED",
  });
  if (!("cycleReceipt" in result)) throw new Error("complete rejected cycle required");
  const p = await physical(rejected.stateRoot);
  expect(p.journal.events).toHaveLength(30);
  const reduced = parsed(c.reduceEventJournal(p.journal, p.evidence));
  expect(reduced).toEqual(result.reduced);
  expect(reduced.outcome).toMatchObject({ kind: "FAILED_KNOWN" });
  const terminal = (ordinal: number) => p.journal.events[(ordinal - 1) * 2 + 1]!.output as Row;
  expect(terminal(9).attempt.result).toMatchObject({ kind: "BLOCKED" });
  expect(terminal(10).authority.outcome).toMatchObject({ kind: "rejected" });
  expect(terminal(11)).toMatchObject({
    disposition: { code: "review.reject", outcome: { kind: "FOLLOW_UP" } },
    followUp: { cause: { kind: "DISPOSITION" }, intent: { kind: "REPLAN" } },
  });
  expect(
    c.validateFollowUpCycleRequestBinding(
      terminal(11).input,
      await readFile(join(rejected.stateRoot, "stdout.bin")),
      await readFile(join(rejected.stateRoot, "stderr.bin")),
      terminal(11).disposition,
      terminal(11).followUp,
    ).ok,
  ).toBe(true);
  expect(terminal(12).skip.reason).toBe("no-mutation");
  expect(terminal(13).skip.reason).toBe("no-mutation");
  expect(terminal(14).receipt.outcome.kind).toBe("RECLAIMED");
  expect(terminal(15).receipt.outcome).toBe("FAILED_KNOWN");
  expect(terminal(11).disposition.outcome.kind).not.toBe("APPLY");
  const names = await readdir(rejected.stateRoot);
  expect(names).toContain("follow-up-cycle-request.json");
  for (const name of [
    "project-mutation-request.json",
    "project-mutation-plan.json",
    "project-apply-receipt.json",
    "echo-input.bin",
    "session-claim.json",
  ])
    expect(names).not.toContain(name);
  expect(rejected.subject.authorCycleId).not.toBe(rejected.input.cycleId);
  expect(terminal(9).attempt.attemptId).not.toBe(rejected.subject.authorAttemptId);
});

test("fixture journal owner proves idempotence and refuses retained partial or conflicting physical history", async () => {
  const disposableRoot = await realpath(
    await mkdtemp(join(tmpdir(), "walking-final-control-physical-")),
  );
  roots.push(disposableRoot);
  const stateRoot = join(disposableRoot, "state");
  await mkdir(stateRoot);
  const plan = parsed(
    c.parseCyclePlan({
      protocol: "routine-cycle/v1",
      request: {
        adapterId: "fixture.branches",
        allowedModuleIds: ["fixture.review-consumer"],
        cycleId: uuid(502),
        schemaVersion: "cycle-request/v1",
        sessionRequest: {
          configurationPathsDigest: "a".repeat(64),
          configurationProvenanceDigest: "b".repeat(64),
          configurationSourceDigest: "c".repeat(64),
          schemaVersion: "session-acquire-request/v1",
          sessionId: uuid(501),
        },
      },
      schemaVersion: "cycle-plan/v1",
    }),
  );
  const path = join(stateRoot, "cycle.opj"),
    owner = await FixtureJournalOwner.create(path, plan);
  const header = owner.bytes,
    step = owner.step(1, c.computeCycleRequestDigest(plan.request));
  await owner.start(step);
  const complete = owner.bytes,
    idempotent = await owner.verifyLastEventIdempotent();
  expect(idempotent).toEqual({
    byteLength: complete.byteLength,
    prefixDigest: c.computeEventJournalPrefixDigest(complete),
    status: "IDEMPOTENT",
  });
  expect(await readFile(path)).toEqual(complete);
  const last = owner.journal.events.at(-1)!;
  expect(
    c.planEventJournalAppend(complete, {
      ...last,
      step: { ...last.step, inputDigest: "0".repeat(64) },
    }).ok,
  ).toBe(false);
  expect(await readFile(path)).toEqual(complete);
  await owner.close();

  const earlierPath = join(stateRoot, "earlier.opj");
  await writeFile(earlierPath, header);
  const earlier = await replayFixtureJournal(earlierPath, {});
  expect(earlier).toMatchObject({
    ok: true,
    value: { journal: { events: [] }, reduced: { outcome: { kind: "RUNNING" } } },
  });

  const partial = Buffer.from([0, 0, 0, 12, 0x7b]);
  await appendFile(path, partial);
  const retained = await readFile(path);
  expect(c.inspectEventJournalBytes(retained)).toMatchObject({
    ok: true,
    value: { authoritativeByteLength: complete.byteLength, partialSuffix: true },
  });
  expect(c.parseEventJournalBytes(retained).ok).toBe(false);
  expect(c.planEventJournalAppend(retained, last).ok).toBe(false);
  expect(await replayFixtureJournal(path, {})).toEqual({
    issues: ["journal:partial-final-frame"],
    ok: false,
  });
  expect(await readFile(path)).toEqual(retained);
});

test("post-child target mutation records only UNKNOWN authority and cannot use the stale accepted seed", async () => {
  const f = await fixture({ id: 40 });
  const changed = Buffer.from("changed after the actual child terminal observation\n");
  const result = await consumeFinalReviewCycle({
    ...f.input,
    boundary: async ({ boundary }) => {
      if (boundary === "CHILD_TERMINAL_OBSERVED")
        await writeFile(
          join(f.input.invocation.flags.projectRoot!, "fixture-review-artifact.bin"),
          changed,
        );
    },
  });
  expect(result).toMatchObject({
    authority: {
      outcome: { attemptResultDigest: null, kind: "unknown", reason: "TARGET_CHANGED" },
    },
    cleanup: "RETAINED_UNKNOWN",
    ok: false,
    reason: "REVIEW_TARGET_CHANGED",
    reduced: { outcome: { kind: "UNKNOWN" } },
  });
  if (!("authority" in result)) throw new Error("typed changed-target authority required");
  const p = await physical(f.stateRoot);
  expect(p.journal.events).toHaveLength(20);
  expect(p.journal.events.at(-1)!.output).toMatchObject({
    attempt: null,
    authority: result.authority,
    kind: "REVIEW_AUTHORITY",
  });
  expect(
    c.validateReviewResultBinding(
      p.journal.events[13]!.output!.reviewRequest,
      null,
      result.authority,
    ).ok,
  ).toBe(true);
  const names = await readdir(f.stateRoot);
  expect(names).not.toContain("review-attempt.json");
  for (const name of [
    "action-disposition.json",
    "follow-up-cycle-request.json",
    "routine-step-skip-12.json",
    "routine-step-skip-13.json",
    "resource-reclaim-receipt.json",
    "cycle-receipt.json",
  ])
    expect(names).not.toContain(name);
});
