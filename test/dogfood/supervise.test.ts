import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
let runOrdinal = 0;
const command = resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs");
const hook = resolve(import.meta.dirname, "supervise-fixtures/hook.mjs");

async function fixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "supervise-command-fixture-")));
  roots.push(root);
  const stateRoot = resolve(root, "state");
  const worktreeRoot = resolve(root, "worktrees");
  await Promise.all([stateRoot, worktreeRoot].map((path) => mkdir(path)));
  const config = {
    schemaVersion: "dogfood-loop/v1",
    run: "synthetic-command-run",
    repository: "fixture/repository",
    stableExecutorRoot: resolve(import.meta.dirname, "../.."),
    stateRoot,
    worktreeRoot,
    author: { model: "gpt-5.6-sol", effort: "high" },
    reviewer: { model: "gpt-5.6-sol", effort: "high" },
    codexExecutable: process.execPath,
    gitExecutable: process.execPath,
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
  const request = resolve(root, "loop.json");
  const runState = resolve(stateRoot, config.run);
  await Promise.all([
    writeFile(request, `${JSON.stringify(config)}\n`),
    mkdir(runState, { recursive: true }).then(() =>
      Promise.all([
        writeFile(
          resolve(runState, "command-controls.json"),
          `${JSON.stringify({ main: "a".repeat(40) })}\n`,
        ),
        writeFile(
          resolve(runState, "command-issue.json"),
          `${JSON.stringify({
            state: "OPEN",
            key: "ISS-105",
            labels: ["ready"],
            comments: [],
          })}\n`,
        ),
      ]),
    ),
  ]);
  return { request };
}

async function run(request: string) {
  const token = `command-${++runOrdinal}`;
  const stdoutPath = resolve(dirname(request), `${token}.stdout`);
  const stderrPath = resolve(dirname(request), `${token}.stderr`);
  const [stdoutFile, stderrFile] = await Promise.all([
    open(stdoutPath, "w"),
    open(stderrPath, "w"),
  ]);
  let code: number;
  try {
    code = await new Promise<number>((done, reject) => {
      let timedOut = false;
      const child = spawn(
        process.execPath,
        ["--import", pathToFileURL(hook).href, command, request],
        {
          windowsHide: true,
          stdio: ["ignore", stdoutFile.fd, stderrFile.fd],
          env: {
            ...process.env,
            SUPERVISE_FIXTURE_STATE: resolve(request, "../state/synthetic-command-run"),
          },
        },
      );
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 25_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (status) => {
        clearTimeout(timer);
        done(timedOut ? 124 : (status ?? 1));
      });
    });
  } finally {
    await Promise.all([stdoutFile.close(), stderrFile.close()]);
  }
  return {
    code,
    stdout: await readFile(stdoutPath, "utf8"),
    stderr: await readFile(stderrPath, "utf8"),
  };
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

it("runs one selected issue through observation, completion and the next selection", async () => {
  const current = await fixture();
  const result = await run(current.request);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    result.stdout
      .trim()
      .split(/\r?\n/)
      .map((row) => JSON.parse(row)),
  ).toMatchObject([
    { status: "observing-author", cursor: 0 },
    { status: "complete", cursor: 1, participants: 2 },
    { status: "idle", run: "synthetic-command-run" },
  ]);
}, 30_000);
