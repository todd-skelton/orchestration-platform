import { execFile } from "node:child_process";
import { hasSubscribers, subscribe, unsubscribe } from "node:diagnostics_channel";
import { promisify } from "node:util";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { createTimingCapture, startCaseTiming, validateTiming } from "./fixtures/iss212-timing.js";

const execute = promisify(execFile);
let teardownCapture: ReturnType<typeof createTimingCapture> | undefined;
afterEach(async () => {
  if (!teardownCapture) return;
  teardownCapture.phase("cleanup");
  await execute(process.execPath, ["-e", "process.exit(0)"]);
});
afterEach(() => vi.unstubAllEnvs());

// Cheap deterministic controls only: no repository construction or owning case.
async function completeSample() {
  const capture = createTimingCapture();
  let sample;
  try {
    await capture.control(); // Exactly one git --version.
    for (const phase of ["setup", "queue", "proof", "cleanup"] as const) {
      capture.phase(phase);
      if (phase !== "proof") await execute(process.execPath, ["-e", "process.exit(0)"]);
    }
  } finally {
    sample = capture.finish();
  }
  return sample;
}

it("counts one Git control and three Node children through afterEach teardown with complete lifecycles", async () => {
  const capture = createTimingCapture();
  teardownCapture = capture;
  onTestFinished(() => {
    teardownCapture = undefined;
    const sample = capture.finish();
    validateTiming(sample);
    expect(sample.pending).toBe(0);
    expect(sample.children.map(({ phase, family, code }) => ({ phase, family, code }))).toEqual([
      { phase: "control", family: "git --version", code: 0 },
      { phase: "setup", family: "Node launcher", code: 0 },
      { phase: "queue", family: "Node launcher", code: 0 },
      { phase: "cleanup", family: "Node launcher", code: 0 },
    ]);
    expect(JSON.stringify(sample)).not.toContain("process.exit");
  });
  await capture.control();
  capture.phase("setup");
  await execute(process.execPath, ["-e", "process.exit(0)"]);
  capture.phase("queue");
  await execute(process.execPath, ["-e", "process.exit(0)"]);
  capture.phase("proof");
});

it("rejects a missing proof phase with child and live-control inputs held valid", async () => {
  const sample = await completeSample();
  validateTiming(sample);
  sample.phases = sample.phases.filter(({ phase }) => phase !== "proof");
  expect(() => validateTiming(sample)).toThrow("ISS212 missing-phase:proof");
});

it("guard-bypass mutant: dropped non-control tracing pair fails despite a passing one-child control", async () => {
  const sample = await completeSample();
  validateTiming(sample);
  // Removing BOTH trace events evades a start/end count-equality guard, and
  // occurs after the live control. The independent constructor census remains.
  delete sample.children[2]!.start;
  delete sample.children[2]!.end;
  expect(sample.children[0]).toMatchObject({ phase: "control", family: "git --version", code: 0 });
  expect(() => validateTiming(sample)).toThrow("ISS212 incomplete-child:3");
});

it("rejects a dropped close and an unmatched event without losing other valid phases", async () => {
  const sample = await completeSample();
  validateTiming(sample);
  const dropped = structuredClone(sample);
  delete dropped.children[3]!.close;
  expect(() => validateTiming(dropped)).toThrow("ISS212 incomplete-child:4");
  sample.errors.push("unmatched-end");
  expect(() => validateTiming(sample)).toThrow("ISS212 unmatched-end");
});

it("observer-disabled control subscribes to nothing, registers no finish hook and launches no control", async () => {
  vi.stubEnv("ISS212_TIMING", undefined);
  const names = [
    "child_process",
    "tracing:child_process.spawn:start",
    "tracing:child_process.spawn:end",
  ];
  expect(names.map(hasSubscribers)).toEqual([false, false, false]);
  let children = 0;
  const count = () => {
    children++;
  };
  subscribe("child_process", count);
  try {
    expect(await startCaseTiming("source4")).toBeUndefined();
    expect(children).toBe(0);
    await execute(process.execPath, ["-e", "process.exit(0)"]);
    expect(children).toBe(1);
  } finally {
    unsubscribe("child_process", count);
  }
  expect(names.map(hasSubscribers)).toEqual([false, false, false]);
});
