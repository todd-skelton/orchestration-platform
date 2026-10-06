import { execFile } from "node:child_process";
import { channel, hasSubscribers } from "node:diagnostics_channel";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  cases,
  casePattern,
  createCapture,
  diagnosticOnlyPatch,
  installIss221Timing,
  TIMING_LIMIT,
  MEASURED_FILES,
  PAIR_BUDGET_MS,
  PAIR_WALL_LIMIT_MS,
  boundedProcess,
  hasFixtureRemedy,
  pairAccepted,
  summarizeCapture,
  parseCaptureStream,
  reportPassed,
} from "./fixtures/iss221-timing.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function output() {
  const root = await mkdtemp(resolve(tmpdir(), "iss221-control-"));
  roots.push(root);
  return resolve(root, "timing.jsonl");
}
const channels = [
  "child_process",
  "tracing:child_process.spawn:start",
  "tracing:child_process.spawn:end",
];

it("selects nine exact cases without the sibling pending-publication or spent=false cases", () => {
  expect(Object.keys(cases)).toHaveLength(9);
  expect(new RegExp(casePattern("pending")).test(cases.pending.name)).toBe(true);
  expect(
    new RegExp(casePattern("pending")).test(
      "reconciles pending publication with sibling receipts before newer main without duplicate writes",
    ),
  ).toBe(false);
  expect(new RegExp(casePattern("integration")).test(cases.integration.name)).toBe(true);
  expect(
    new RegExp(casePattern("integration")).test(
      cases.integration.name.replace("spent=true", "spent=false"),
    ),
  ).toBe(false);
  expect(
    new RegExp(casePattern("candidate")).test(
      cases.candidate.name.replace("afterMirror=true", "afterMirror=false"),
    ),
  ).toBe(false);
});

it("is inert by default and installs no diagnostic subscriptions", async () => {
  vi.stubEnv("ISS221_TIMING", undefined);
  const before = channels.map(hasSubscribers);
  await installIss221Timing();
  expect(channels.map(hasSubscribers)).toEqual(before);
});

it("flushes partial phases and child lifecycles and retains a failing case before validation", async () => {
  const file = await output();
  const capture = createCapture(file, { case: "synthetic" });
  let result;
  try {
    await capture.control();
    capture.phase("lifecycle");
    await expect(
      execute(process.execPath, ["-e", "process.exit(7)", "private-argument"]),
    ).rejects.toMatchObject({ code: 7 });
    capture.phase("re-entry");
    const partial = await readFile(file, "utf8");
    expect(partial).toContain('["close",');
    expect(partial).not.toContain('"event":"finished"');
    capture.phase("assertion");
    capture.phase("cleanup");
  } finally {
    result = capture.finish("fail");
  }
  expect(result).toMatchObject({ completeness: "complete", outcome: "fail", pending: 0 });
  expect(result.operations.map(({ operation, count }) => ({ operation, count }))).toEqual([
    { operation: "git --version", count: 1 },
    { operation: "node", count: 1 },
  ]);
  const bytes = await readFile(file, "utf8");
  expect(bytes).toContain(",7,null]");
  expect(bytes).not.toContain("private-argument");
  expect(bytes).not.toContain(process.cwd());
  expect(bytes).not.toContain("process.exit");
  expect(Buffer.byteLength(bytes)).toBeLessThan(TIMING_LIMIT);
  expect(channels.map(hasSubscribers)).toEqual([false, false, false]);
});

it("marks missing phases and a pending child unknown while preserving the partial stream", async () => {
  const file = await output();
  const capture = createCapture(file, {});
  await capture.control();
  const child = execute(process.execPath, ["-e", "process.exit(0)"]);
  const result = capture.finish("fail");
  await child;
  expect(result.completeness).toBe("unknown");
  expect(result.errors).toContain("pending-children");
  expect(result.errors).toContain("missing-phase:re-entry");
  expect(result.errors).toContain("incomplete-child");
  expect(await readFile(file, "utf8")).toContain('"outcome":"fail"');
});

it("fails explicitly on overflow without exceeding the byte bound", async () => {
  const file = await output();
  const capture = createCapture(file, {}, 1024);
  await capture.control();
  for (let i = 0; i < 40; i++) capture.phase("assertion");
  const result = capture.finish("pass");
  expect(result.completeness).toBe("unknown");
  expect(result.errors).toContain("overflow");
  const bytes = await readFile(file);
  expect(bytes.byteLength).toBeLessThanOrEqual(1024);
  expect(bytes.toString()).toContain('"event":"overflow"');
});

it("detects a dropped tracing pair even when spawn/exit/close and the live control agree", async () => {
  const capture = createCapture(await output(), {});
  await capture.control();
  capture.phase("lifecycle");
  const child = Object.assign(new EventEmitter(), { spawnargs: ["git", "status"] });
  channel("child_process").publish({ process: child });
  child.emit("spawn");
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  for (const phase of ["re-entry", "assertion", "cleanup"] as const) capture.phase(phase);
  const result = capture.finish("pass");
  expect(result.pending).toBe(0);
  expect(result.errors).toEqual(["incomplete-child"]);
  expect(result.completeness).toBe("unknown");
});

it("keeps remedies and assertion changes out of the committed diagnostic-only baseline patch", async () => {
  const addition = await readFile("test/dogfood/fixtures/iss221-baseline.patch", "utf8");
  expect(() => diagnosticOnlyPatch(addition)).not.toThrow();
  expect(() => diagnosticOnlyPatch(addition + "-  await fixture();\n")).toThrow("removes source");
  expect(() => diagnosticOnlyPatch(addition + "+  await cachedFixture();\n")).toThrow(
    "non-diagnostic",
  );
  expect(() => diagnosticOnlyPatch(addition + "+  expect(true).toBe(true);\n")).toThrow(
    "non-diagnostic",
  );
});

it("parses the committed plumbing without requiring Git history in ordinary shallow checkouts", async () => {
  const root = dirname(await output());
  const patch = resolve("test/dogfood/fixtures/iss221-baseline.patch");
  // Actual application to BASE belongs to the opt-in runner's git apply --check.
  // Git still parses every hunk here, including the truncated-tail regression.
  const parsed = (await execute("git", ["apply", "--numstat", patch], { cwd: root })).stdout;
  const rows = parsed
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  expect(rows.map((row) => row[2]).sort()).toEqual([...MEASURED_FILES.slice(0, 3)].sort());
  expect(rows.every((row) => Number(row[0]) > 0 && row[1] === "0")).toBe(true);
});

it("distinguishes existing hook windows from nested phases and reports partial streams unknown", async () => {
  const file = await output();
  const capture = createCapture(file, {});
  await capture.control();
  capture.phase("hook-1");
  await execute(process.execPath, ["-e", "process.exit(0)"]);
  capture.phase("hook-2");
  capture.phase("lifecycle");
  await execute(process.execPath, ["-e", "process.exit(0)"]);
  capture.phase("body");
  capture.phase("re-entry");
  capture.phase("assertion");
  capture.phase("cleanup");
  const partial = summarizeCapture(
    (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  );
  expect(partial.errors).toContain("missing-finish");
  expect(partial.childCount).toBe(3);
  const result = capture.finish("pass");
  expect(result.completeness).toBe("complete");
  expect(result.windows.map((row) => row.phase)).toEqual([
    "timing-hook",
    "hook-1",
    "hook-2",
    "body",
    "cleanup",
  ]);
  expect(
    result.operations.filter((row) => row.operation === "node").map((row) => row.phase),
  ).toEqual(["setup", "lifecycle"]);
  expect(result.windows.every((row) => row.end >= row.start)).toBe(true);
});

it("cannot accept diagnostic-only or missing/red/incomplete/overflow candidate pairs", async () => {
  const file = await output();
  const capture = createCapture(file, {});
  await capture.control();
  for (const phase of ["lifecycle", "re-entry", "assertion", "cleanup"] as const)
    capture.phase(phase);
  const green = {
    code: 0,
    signal: null,
    launchError: false,
    timedOut: false,
    overflow: false,
    capture: capture.finish("pass"),
  };
  const patch = await readFile("test/dogfood/fixtures/iss221-baseline.patch", "utf8");
  expect(hasFixtureRemedy(patch)).toBe(false);
  expect(hasFixtureRemedy("")).toBe(false);
  expect(hasFixtureRemedy(patch + "-  await fixture();\n+  await privateSeed();\n")).toBe(true);
  expect(pairAccepted(false, [green], 1)).toBe(false);
  expect(pairAccepted(true, [green], 1)).toBe(true);
  expect(pairAccepted(true, [green], 2)).toBe(false);
  for (const mutation of [
    { code: 1 },
    { signal: "SIGTERM" },
    { launchError: true },
    { timedOut: true },
    { overflow: true },
    { capture: null },
    { capture: { ...green.capture, outcome: "fail" } },
    { capture: { ...green.capture, completeness: "unknown" } },
  ])
    expect(pairAccepted(true, [{ ...green, ...mutation }], 1)).toBe(false);
});

it("retains real child exits and enforces its own wall deadline before the step limit", async () => {
  expect(PAIR_BUDGET_MS).toBeLessThan(15 * 60 * 1000 - 10_000);
  expect(PAIR_WALL_LIMIT_MS).toBeLessThan(15 * 60 * 1000);
  const cwd = dirname(await output());
  expect(
    await boundedProcess(process.execPath, ["-e", "process.exit(7)"], {
      cwd,
      deadline: performance.now() + 10_000,
    }),
  ).toMatchObject({ code: 7, timedOut: false });
  const stopped = await boundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd,
    deadline: performance.now() + 250,
  });
  expect(stopped.timedOut).toBe(true);
  expect(stopped.code !== 0 || stopped.signal !== null).toBe(true);
  await expect(
    boundedProcess(process.execPath, [], { cwd, deadline: performance.now() - 1 }),
  ).rejects.toThrow("wall budget exhausted");
});

it("retains an actual failed Vitest case and its counts without assertion values or paths", async () => {
  const timing = await output();
  const cwd = resolve(dirname(timing), "case");
  await mkdir(resolve(cwd, "test"), { recursive: true });
  await symlink(resolve("node_modules"), resolve(cwd, "node_modules"), "junction");
  await writeFile(resolve(cwd, "package.json"), '{"type":"module"}\n');
  const helper = resolve("test/dogfood/fixtures/iss221-timing.ts");
  await writeFile(
    resolve(cwd, "test/failure.test.ts"),
    [
      'import { afterEach, expect, it } from "vitest";',
      'import { execFile } from "node:child_process";',
      'import { promisify } from "node:util";',
      "import { installIss221Timing, iss221Phase } from " +
        JSON.stringify(helper.replaceAll("\\", "/")) +
        ";",
      "await installIss221Timing();",
      'afterEach(() => iss221Phase("cleanup"));',
      "it(" + JSON.stringify(cases.pending.name) + ", async () => {",
      '  iss221Phase("body");',
      '  iss221Phase("lifecycle");',
      '  await promisify(execFile)(process.execPath, ["-e", "process.exit(0)"]);',
      '  iss221Phase("re-entry");',
      '  iss221Phase("assertion");',
      '  expect("private-assertion-value").toBe("different-private-value");',
      "});",
    ].join("\n"),
  );
  const result = await boundedProcess(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      resolve("vitest.config.ts"),
      "--reporter=" + helper,
    ],
    {
      cwd,
      deadline: performance.now() + 15_000,
      env: { ...process.env, ISS221_TIMING: timing, ISS221_CASE: "pending", ISS212_TIMING: "" },
    },
  );
  expect(result).toMatchObject({ code: 1, timedOut: false });
  const rows = parseCaptureStream(await readFile(timing, "utf8"));
  expect(summarizeCapture(rows)).toMatchObject({
    outcome: "fail",
    completeness: "complete",
    pending: 0,
  });
  const bytes = await readFile(timing + ".result.json", "utf8");
  const report = JSON.parse(bytes);
  expect(report).toMatchObject({
    reason: "failed",
    files: 1,
    counts: { passed: 0, failed: 1, pending: 0, skipped: 0 },
    selected: [{ matches: true, state: "failed", failures: ["failure"] }],
  });
  expect(reportPassed(report)).toBe(false);
  expect(bytes).not.toContain("private-");
  expect(bytes).not.toContain(cwd);
  expect(bytes).not.toContain(process.cwd());
  // Removing a whole child's events must fail too, not just a missing close.
  expect(summarizeCapture(rows.filter((row) => row.id !== 2)).errors).toEqual(["dropped-records"]);
  expect(summarizeCapture([...rows, ...parseCaptureStream('{"event":')]).errors).toContain(
    "truncated-record",
  );
});
