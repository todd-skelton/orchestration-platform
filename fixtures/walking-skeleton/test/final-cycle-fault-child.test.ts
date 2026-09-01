import { writeSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
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
  consumeFinalReviewCycle,
  type SkeletonBoundary,
  type SkeletonBoundarySnapshot,
} from "../src/final-cycle.js";

const disposableRoot = process.env.ORCHESTRATION_ISS041_FAULT_ROOT;
const target = process.env.ORCHESTRATION_ISS041_FAULT_BOUNDARY as SkeletonBoundary | undefined;
const sessionId = process.env.ORCHESTRATION_ISS041_FAULT_SESSION;
const cycleId = process.env.ORCHESTRATION_ISS041_FAULT_CYCLE;
const projectId = process.env.ORCHESTRATION_ISS041_FAULT_PROJECT;
const enabled = Boolean(disposableRoot && target && sessionId && cycleId && projectId);
const selectedTest = enabled ? test : test.skip;
const marker = "@@ORCHESTRATION_ISS041_BOUNDARY@@";

function notify(value: unknown) {
  writeSync(1, `${marker}${JSON.stringify(value)}\n`);
}

function reallyExit(code: number): never {
  const runtime = process as NodeJS.Process & { reallyExit(exitCode: number): never };
  return runtime.reallyExit(code);
}

selectedTest(
  "terminates only after the selected physical boundary read-back",
  async () => {
    const os =
      process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
    const adapter =
      os === "WINDOWS"
        ? createWindowsConfigurationHostAdapter()
        : createPortableConfigurationHostAdapter(os);
    const projectRoot = join(disposableRoot!, "project"),
      stateRoot = join(disposableRoot!, "state"),
      configPath = join(projectRoot, ".orchestration", "project.json");
    const work = [
      {
        blocked: false,
        branch: "fixture/opaque",
        capabilityNames: ["work.read"],
        revisionDigest: "a".repeat(64),
        workId: "01900000-0000-7000-8000-000000000004",
      },
    ];
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
    await consumeFinalReviewCycle({
      adapter,
      adapterConfiguration: {
        adapterId: "fixture.branches",
        adapterVersion: "1.0.0",
        capabilityNames: ["work.read"],
        engineVersion: "0.0.0",
        projectId: projectId!,
        schemaVersion: "adapter-configuration/v1",
      },
      boundary: async (snapshot: SkeletonBoundarySnapshot) => {
        await notify({ kind: "BOUNDARY", snapshot });
        if (snapshot.boundary !== target) return;
        await notify({ kind: "TARGET", snapshot });
        reallyExit(86);
      },
      clocks: { wallNow: () => "2026-08-31T01:00:00.000Z", monotonicNow: () => 0 },
      currentPolicy: createBranchFixtureCurrentPolicy(() => work),
      cycleId: cycleId!,
      disposableRoot: disposableRoot!,
      invocation,
      sessionId: sessionId!,
      snapshot: createBranchFixtureSnapshot(() => work),
    });
    throw new Error(`selected boundary was not reached: ${target}`);
  },
  30_000,
);
