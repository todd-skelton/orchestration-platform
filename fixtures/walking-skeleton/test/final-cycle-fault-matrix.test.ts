import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
import { runSkeletonRestartCommand } from "../src/final-cycle-cli.js";
import type { FinalCycleInvocation, SkeletonBoundary } from "../src/final-cycle.js";

type Message = Readonly<{
  kind: "BOUNDARY" | "TARGET";
  snapshot: Readonly<{
    boundary: SkeletonBoundary;
    journalByteLength: number | null;
    journalPrefixDigest: string | null;
    reducedOutcome: string | null;
    stateFiles: readonly string[];
  }>;
}>;
const checkout = resolve(import.meta.dirname, "../../.."),
  childFile = resolve(import.meta.dirname, "final-cycle-fault-child.test.ts"),
  vitest = resolve(checkout, "node_modules/vitest/vitest.mjs"),
  roots: string[] = [];
const marker = "@@ORCHESTRATION_ISS041_BOUNDARY@@";
const uuid = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const boundaries: SkeletonBoundary[] = [
  "JOURNAL_HEADER",
  ...Array.from({ length: 15 }, (_, index) => [
    `STARTED:${index + 1}` as SkeletonBoundary,
    `TERMINAL:${index + 1}` as SkeletonBoundary,
  ]).flat(),
  "INPUT_ALLOCATED",
  "OWNERSHIP_PUBLISHED",
  "CHILD_SPAWNED",
  "CHILD_TERMINAL_OBSERVED",
  "RECLAIM_BEFORE_DELETE",
  "RECLAIM_AFTER_DELETE",
  "SESSION_CLOSED",
];

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
      } else if (entry.isFile()) rows.push(`file:${name}:${hash(await readFile(absolute))}`);
      else throw new Error("unexpected fault path kind");
    }
  }
  await visit(root, "");
  return rows.sort();
}

async function setup(index: number) {
  const disposableRoot = await realpath(await mkdtemp(join(tmpdir(), "walking-final-fault-")));
  roots.push(disposableRoot);
  const projectRoot = join(disposableRoot, "project"),
    stateRoot = join(disposableRoot, "state"),
    configPath = join(projectRoot, ".orchestration", "project.json"),
    projectId = uuid(1000 + index),
    sessionId = uuid(2000 + index),
    cycleId = uuid(3000 + index),
    artifact = Buffer.from("fixture reviewed artifact v1\n");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    c.canonicalJson({
      adapterId: "fixture.branches",
      capabilityNames: ["work.read"],
      leaseFreshnessMs: 30000,
      maximumSessionMs: 3600000,
      projectId,
      schemaVersion: "platform-configuration-source/v1",
      stateRoot: null,
      wallClockSkewMs: 1000,
    }),
  );
  const subject = c.parseWorkerResultSubject({
    authorAttemptId: uuid(4000 + index),
    authorCycleId: uuid(5000 + index),
    baseSource: { adapterId: "fixture.branches", projectId, revision: "fixture.seed.v1" },
    result: {
      entries: [{ contentDigest: hash(artifact), kind: "ARTIFACT" }],
      kind: "ORDERED_PATCH_ARTIFACTS",
    },
    schemaVersion: "worker-result-subject/v1",
    terminalReceiptDigest: "b".repeat(64),
  });
  if (!subject.ok) throw new Error(subject.issues.join(","));
  await writeFile(join(projectRoot, "fixture-review-subject.json"), c.canonicalJson(subject.value));
  await writeFile(join(projectRoot, "fixture-review-artifact.bin"), artifact);
  const os =
      process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX",
    adapter =
      os === "WINDOWS"
        ? createWindowsConfigurationHostAdapter()
        : createPortableConfigurationHostAdapter(os),
    invocation: ConfigurationLoaderInvocation = {
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
  const work = [
    {
      blocked: false,
      branch: "fixture/opaque",
      capabilityNames: ["work.read"],
      revisionDigest: "a".repeat(64),
      workId: uuid(6000 + index),
    },
  ];
  const snapshot = vi.fn(createBranchFixtureSnapshot(() => work)),
    currentPolicy = vi.fn(createBranchFixtureCurrentPolicy(() => work));
  const input: FinalCycleInvocation = {
    adapter,
    adapterConfiguration: {
      adapterId: "fixture.branches",
      adapterVersion: "1.0.0",
      capabilityNames: ["work.read"],
      engineVersion: "0.0.0",
      projectId,
      schemaVersion: "adapter-configuration/v1",
    },
    clocks: { wallNow: () => "2026-08-31T01:00:00.000Z", monotonicNow: () => 0 },
    currentPolicy,
    cycleId,
    disposableRoot,
    invocation,
    sessionId,
    snapshot,
  };
  return {
    currentPolicy,
    cycleId,
    disposableRoot,
    input,
    projectId,
    sessionId,
    snapshot,
    stateRoot,
  };
}

function runChild(
  row: Awaited<ReturnType<typeof setup>>,
  boundary: SkeletonBoundary,
): Promise<{ code: number | null; messages: Message[]; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    const child = spawn(
      process.execPath,
      [vitest, "run", childFile, "--reporter=dot", "--pool=threads", "--maxWorkers=1"],
      {
        cwd: checkout,
        env: {
          ...process.env,
          ORCHESTRATION_ISS041_FAULT_BOUNDARY: boundary,
          ORCHESTRATION_ISS041_FAULT_CYCLE: row.cycleId,
          ORCHESTRATION_ISS041_FAULT_PROJECT: row.projectId,
          ORCHESTRATION_ISS041_FAULT_ROOT: row.disposableRoot,
          ORCHESTRATION_ISS041_FAULT_SESSION: row.sessionId,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.stdout!.on("data", (bytes: Buffer) => stdout.push(Buffer.from(bytes)));
    child.stderr!.on("data", (bytes: Buffer) => stderr.push(Buffer.from(bytes)));
    child.once("error", reject);
    child.once("close", (code) => {
      const messages = Buffer.concat(stdout)
        .toString("utf8")
        .split(/\r?\n/)
        .filter((line) => line.startsWith(marker))
        .map((line) => JSON.parse(line.slice(marker.length)) as Message);
      resolveRun({ code, messages, stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  const parent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (dirname(root) !== parent || !root.startsWith(join(parent, "walking-final-fault-")))
      throw new Error("cleanup outside final fault fixture");
    await rm(root, { force: true, recursive: true });
  }
});

test("every physical boundary kills once and restart is read-only SESSION_HELD or terminal completion", async () => {
  expect(boundaries).toHaveLength(38);
  for (const [index, boundary] of boundaries.entries()) {
    const row = await setup(index),
      outsideBefore = await manifest(row.disposableRoot, row.stateRoot),
      child = await runChild(row, boundary);
    expect(child.code, `${boundary}: ${child.stderr}`).toBe(86);
    const targets = child.messages.filter((message) => message.kind === "TARGET");
    expect(targets, boundary).toHaveLength(1);
    expect(targets[0]!.snapshot.boundary).toBe(boundary);
    const launches = child.messages.filter(
      (message) => message.kind === "BOUNDARY" && message.snapshot.boundary === "CHILD_SPAWNED",
    );
    expect(launches.length, boundary).toBeLessThanOrEqual(1);

    const journalPath = join(row.stateRoot, "cycle.opj"),
      beforeJournal = await readFile(journalPath),
      beforeState = await manifest(row.stateRoot),
      restart = await runSkeletonRestartCommand(row.input);
    expect(restart).toMatchObject({ command: "skeleton:restart", exitCode: 0 });
    if (boundary === "SESSION_CLOSED") {
      expect(restart.result).toMatchObject({
        acquisition: null,
        ok: true,
        reason: "CYCLE_ALREADY_TERMINAL",
        replay: { ok: true, value: { reduced: { outcome: { kind: "COMPLETED" } } } },
      });
    } else {
      expect(restart.result).toMatchObject({
        ok: false,
        reason: "SESSION_HELD",
      });
    }
    expect(await readFile(journalPath)).toEqual(beforeJournal);
    expect(await manifest(row.stateRoot)).toEqual(beforeState);
    expect(await manifest(row.disposableRoot, row.stateRoot)).toEqual(outsideBefore);
    expect(row.snapshot).not.toHaveBeenCalled();
    expect(row.currentPolicy).not.toHaveBeenCalled();

    const observed = targets[0]!.snapshot.reducedOutcome;
    if (boundary === "STARTED:8" || boundary === "STARTED:9")
      expect(observed).toBe("WAITING_WORKER");
    else if (boundary === "STARTED:10") expect(observed).toBe("WAITING_REVIEW");
    else if (boundary === "STARTED:11") expect(observed).toBe("WAITING_ACTION");
    else if (boundary === "STARTED:15") expect(observed).toBe("TERMINALIZING");
    else if (boundary === "TERMINAL:15" || boundary === "SESSION_CLOSED")
      expect(observed).toBe("COMPLETED");
  }
}, 300_000);
