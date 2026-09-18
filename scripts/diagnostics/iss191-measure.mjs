// ISS-191 source-review checkpoint. This driver and workflow must never land.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// Kept local so loading the CLI reporter cannot initialize the worker observer.
function sanitize(value) {
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/"'<>]+/gi, "scheme://[authority-redacted]")
    .replace(/\b[^\s/@:]+@[^\s/:]+:/g, "[authority-redacted]:")
    .replace(
      /[^\r\n]*(?:authorization|password|passwd|token|secret|credential|extraheader)[^\r\n]*/gi,
      "[credential-bearing text redacted]",
    );
}

const self = fileURLToPath(import.meta.url);
const repository = resolve(self, "../../..");
const base = "53187f9d093a819377d71e76dedeb894d4b0d11a";
const exactName = (slots) =>
  `admits each successor launch independently with ${slots} remaining slots`;
const declared = Array.from({ length: 5 }, (_, pair) =>
  [0, 1].map((slots) => ({
    id: `pair-${pair + 1}-slots-${slots}`,
    name: exactName(slots),
  })),
).flat();

// Loaded by Vitest in the CLI process; the observer is imported by queue.test.ts
// in its normal worker. Neither NODE_OPTIONS nor the worker profile is changed.
export default class DiagnosticReporter {
  onTestCaseResult(test) {
    if (test.fullName !== process.env.ISS191_NAME) return;
    appendFileSync(
      process.env.ISS191_RESULTS,
      JSON.stringify({
        name: sanitize(test.fullName),
        state: test.result().state,
        at: performance.now(),
      }) + "\n",
    );
  }
}

function rows(path) {
  const text = readFileSync(path, "utf8");
  if (!text.endsWith("\n")) throw new Error("missing or truncated evidence");
  return text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

async function main() {
  const output = resolve(process.env.RUNNER_TEMP, "iss191-measurement");
  await mkdir(output, { recursive: true });
  const ledger = resolve(output, "sequence.jsonl");
  let evidenceError = false;
  const log = (event, fields = {}) => {
    const line = JSON.stringify({ event, at: performance.now(), ...fields });
    try {
      appendFileSync(ledger, line + "\n");
    } catch {
      evidenceError = true;
    }
    console.log(line);
  };
  let stickyFailure = false;
  log("declaration", { base, samples: declared, controls: ["held", "plumbing", "unresolved"] });
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 15) {
    log("unsupported-observer-node", { node: process.version });
    process.exitCode = 1;
    return;
  }

  async function sample(spec) {
    const events = resolve(output, `${spec.id}.events.jsonl`);
    const results = resolve(output, `${spec.id}.results.jsonl`);
    const stdout = resolve(output, `${spec.id}.stdout.log`);
    const stderr = resolve(output, `${spec.id}.stderr.log`);
    for (const path of [events, results, stdout, stderr]) writeFileSync(path, "");
    log("sample-start", { id: spec.id, name: spec.name, control: spec.control ?? null });
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [
        resolve(repository, "node_modules/vitest/vitest.mjs"),
        "run",
        "test/dogfood/queue.test.ts",
        "--testNamePattern",
        `^${spec.name}$`,
        "--reporter=default",
        `--reporter=${self}`,
      ],
      {
        cwd: repository,
        env: {
          ...process.env,
          ISS191_EVENTS: events,
          ISS191_RESULTS: results,
          ISS191_CONTROL: spec.control ?? "",
          ISS191_NAME: spec.name,
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let streamError = false;
    const streams = [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ].map(([stream, path]) => {
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      stream.on("error", () => {
        streamError = true;
      });
      lines.on("line", (line) => {
        const safe = sanitize(line);
        try {
          appendFileSync(path, safe + "\n");
        } catch {
          streamError = true;
        }
        console.log(
          JSON.stringify({
            id: spec.id,
            stream: path === stdout ? "stdout" : "stderr",
            text: safe,
          }),
        );
      });
      return new Promise((done) => lines.once("close", done));
    });
    child.once("error", () => {
      streamError = true;
      log("vitest-spawn-error", { id: spec.id });
    });
    child.once("exit", (code, signal) => log("vitest-exit", { id: spec.id, code, signal }));
    // This timer observes only. It cannot resolve the close promise or advance
    // the sequence. A nonclosing Vitest stays foreground with incomplete evidence.
    const timer = setTimeout(
      () =>
        log("vitest-still-awaiting-close", {
          id: spec.id,
          elapsedMs: performance.now() - started,
          latenessMs: performance.now() - started - 25_000,
        }),
      25_000,
    );
    const terminal = await new Promise((done) =>
      child.once("close", (code, signal) => done({ code, signal })),
    );
    clearTimeout(timer);
    await Promise.all(streams);
    log("vitest-close", { id: spec.id, ...terminal, elapsedMs: performance.now() - started });
    if (terminal.code !== 0 || terminal.signal !== null) stickyFailure = true;

    let observed = [];
    let evidenceComplete = false;
    let complete = false;
    try {
      observed = rows(events);
      const result = rows(results);
      const final = observed.at(-1);
      const starts = observed.filter((row) => row.event === "command-start");
      const closes = observed.filter((row) => row.event === "command-close");
      evidenceComplete =
        !streamError &&
        !evidenceError &&
        terminal.code !== null &&
        terminal.signal === null &&
        result.length === 1 &&
        result[0].name === spec.name &&
        ["passed", "failed"].includes(result[0].state) &&
        observed.every((row, index) => row.n === index + 1) &&
        observed.filter((row) => row.event === "case-entry").length === 1 &&
        final.event === "worker-terminal" &&
        final.commandCount === starts.length &&
        starts.length > 0 &&
        starts.every((start) => closes.filter((close) => close.id === start.id).length === 1);
      complete = evidenceComplete && final.complete === true;
    } catch {
      log("missing-or-truncated-evidence", { id: spec.id });
    }
    log("transition", {
      id: spec.id,
      evidenceComplete,
      complete,
      rawExit: terminal,
      stickyFailure,
    });
    return { complete: complete && !evidenceError, evidenceComplete, observed, terminal };
  }

  async function sequence(specs) {
    const completed = [];
    for (const spec of specs) {
      const result = await sample(spec);
      completed.push({ id: spec.id, ...result });
      if (!result.complete) {
        log("sequence-incomplete", { stoppedAt: spec.id, started: completed.map((row) => row.id) });
        break;
      }
    }
    return completed;
  }

  // Same real transition function for controls and samples, including sticky exits.
  const held = await sequence([
    { id: "control-held", name: "ISS191 synthetic plumbing", control: "held" },
    { id: "control-following", name: "ISS191 synthetic plumbing", control: "plumbing" },
  ]);
  const heldEvents = held[0]?.observed ?? [];
  const resultIndex = heldEvents.findIndex(
    (row) => row.event === "synthetic-result" && row.state === "pass" && row.open === 1,
  );
  const heldClose = heldEvents.findIndex(
    (row, index) => index > resultIndex && row.event === "command-close",
  );
  if (
    held.length !== 2 ||
    held.some((row) => !row.complete || row.terminal.code !== 0) ||
    resultIndex < 0 ||
    heldClose <= resultIndex
  ) {
    log("controls-failed", { control: "held-or-propagation" });
    process.exitCode = 1;
    return;
  }
  const unresolved = await sequence([
    { id: "control-unresolved", name: "ISS191 synthetic plumbing", control: "unresolved" },
    { id: "control-must-not-start", name: "ISS191 synthetic plumbing", control: "plumbing" },
  ]);
  if (
    unresolved.length !== 1 ||
    unresolved[0].complete ||
    !unresolved[0].evidenceComplete ||
    unresolved[0].terminal.code !== 0 ||
    unresolved[0].observed.at(-1).observerIncomplete !== true ||
    !unresolved[0].observed.some((row) => row.event === "synthetic-unresolved-observer") ||
    evidenceError
  ) {
    log("controls-failed", { control: "unresolved" });
    process.exitCode = 1;
    return;
  }
  log("controls-complete");
  const measured = await sequence(declared);
  const complete = measured.length === declared.length && measured.every((row) => row.complete);
  log("measurement-end", { complete, sampleCount: measured.length, stickyFailure });
  process.exitCode = complete && !stickyFailure && !evidenceError ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === self) {
  await main().catch(() => {
    console.error("ISS191 driver incomplete; retain all partial artifacts and raw exits.");
    process.exitCode = 1;
  });
}
