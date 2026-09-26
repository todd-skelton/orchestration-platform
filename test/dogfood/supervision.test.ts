import { execFile, spawn, type ExecFileOptions } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectedBoardItems, type BoardSnapshot } from "../../scripts/planning/board-check.mjs";
import { loadPlanningSnapshot, type PlanningSnapshot } from "../../scripts/planning/check.mjs";
import * as planningLoader from "../../scripts/planning/check.mjs";
import {
  QueueBlocked,
  queueStep,
  validateLoopConfig,
  type LoopConfig,
} from "../../scripts/dogfood/queue.js";
import { prerequisiteFixture, prerequisiteProof } from "./fixtures/prerequisite.js";
import { ACCEPTED_REPLAN, replanPacket } from "./fixtures/continuation.js";
import { sourceFailureFixture, historicalStops, snapshot } from "./fixtures/source-failure.js";
import { selectCandidates } from "../../adapters/self.mjs";
import * as boardLoader from "../../scripts/planning/board-check.mjs";
import { planningSelectionFixture, retainedFiles } from "./fixtures/planning-selection.js";
import {
  loadRepositoryAdapter,
  type RepositoryAdapter,
} from "../../scripts/dogfood/repository-adapter.js";
import {
  completeCycle,
  prerequisiteOwners,
  isItemStopReason,
  nextCycle as nativeNextCycle,
  persistCycle,
  reconcilePendingStop,
  repositorySupervisionAdapter,
  startCycle,
  stopCycle,
  type IssueObservation,
  type SelectedIssue,
  type SupervisionAdapter,
  type SupervisedCycle,
} from "../../scripts/dogfood/supervision.js";

const roots: string[] = [];
const nextCycle: typeof nativeNextCycle = (config, root, adapter, repository) =>
  nativeNextCycle(config, root, adapter, repository, async () => {});

function noteTransport(
  stderr = 'Post "https://api.github.com/graphql": net/http: TLS handshake timeout',
) {
  return Object.assign(new Error("command echo authorization Bearer SECRET"), {
    code: 1,
    stdout: "",
    stderr,
  });
}

async function noteFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-note-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  cycle.initialHistory = [
    {
      ordinal: 1,
      id: "retained-author",
      item: "ISS-105:1",
      stage: "source",
      role: "author",
      outcome: "dead",
      usage: {
        inputTokens: { status: "unavailable" },
        outputTokens: { status: "unavailable" },
        costUsd: { status: "unavailable" },
      },
    },
  ];
  await persistCycle(config, cycle);
  const row = {
    number: 362,
    state: "OPEN",
    body: "<!-- planning-key: ISS-105 -->",
    labels: [{ name: "ready" }],
    comments: [] as { body: string }[],
  };
  const events: string[] = [];
  const probe = vi.fn(async () => JSON.stringify(row));
  const post = vi.fn(async (body: string) => {
    row.comments.push({ body });
  });
  const run = vi.fn(async (_executable: string, args: string[], _cwd: string) => {
    events.push(args[1]!);
    if (args[1] === "view") return { stdout: await probe(), stderr: "" };
    if (args[1] === "comment") {
      await post(args[args.indexOf("--body") + 1]!);
      return {
        stdout: "https://github.com/fixture/repository/issues/362#issuecomment-1",
        stderr: "",
      };
    }
    throw new Error(`unexpected mutation: ${args.join(" ")}`);
  });
  const pause = vi.fn(async (_ms: number) => {});
  const adapter = repositorySupervisionAdapter({ run }, pause);
  const park = vi.fn(() => {
    throw new Error("run stop must not park");
  });
  const policy = { ...repositoryPolicy, park };
  const directory = resolve(config.stateRoot, config.run);
  const stop = () => stopCycle(config, cycle, "provider-unavailable", 2, adapter, policy);
  const reconcile = () => reconcilePendingStop(config, cycle, adapter, policy);
  return {
    config,
    cycle,
    row,
    events,
    probe,
    post,
    run,
    pause,
    adapter,
    park,
    policy,
    directory,
    stop,
    reconcile,
  };
}

it.each([
  "before",
  "after",
  "lost-success",
  "lost-success-5xx",
  "existing",
  "pre-send",
  "pre-send-twice",
])(
  "ISS-211 actual note adapter reconciles %s with fresh probes and bounded writes",
  async (mode) => {
    const f = await noteFixture();
    if (mode === "existing")
      f.row.comments.push({ body: "<!-- loop-stop:selection-run:1:1 --> retained note" });
    if (mode === "before") f.probe.mockRejectedValueOnce(noteTransport());
    if (mode === "after")
      f.probe.mockResolvedValueOnce(JSON.stringify(f.row)).mockRejectedValueOnce(noteTransport());
    if (mode.startsWith("lost-success"))
      f.post.mockImplementationOnce(async (body) => {
        f.row.comments.push({ body });
        f.probe.mockRejectedValueOnce(noteTransport());
        throw noteTransport(
          mode === "lost-success-5xx"
            ? "gh: Bad Gateway (HTTP 502)"
            : 'Post "https://api.github.com/graphql": EOF',
        );
      });
    if (mode.startsWith("pre-send")) f.post.mockRejectedValueOnce(noteTransport());
    if (mode === "pre-send-twice") f.post.mockRejectedValueOnce(noteTransport());
    if (mode === "pre-send-twice") {
      await expect(f.stop()).rejects.toMatchObject({ reason: "learning-note-state-unknown" });
      expect(f.events).toEqual(["view", "comment", "view", "comment", "view"]);
      expect(f.row.comments).toEqual([]);
      await expect(
        readFile(resolve(f.directory, "cycle-1-stop-1-complete.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      await expect(f.stop()).resolves.toBe("run");
      expect(f.row.comments).toHaveLength(1);
      expect(
        JSON.parse(await readFile(resolve(f.directory, "cycle-1-stop-1-complete.json"), "utf8")),
      ).toEqual({ selection: f.cycle.selection, stop: 1, history: f.cycle.initialHistory });
      expect(f.events).toEqual(
        mode === "existing"
          ? ["view"]
          : mode === "before"
            ? ["view", "view", "comment", "view"]
            : mode === "pre-send"
              ? ["view", "comment", "view", "comment", "view"]
              : ["view", "comment", "view", "view"],
      );
    }
    expect(f.post).toHaveBeenCalledTimes(
      mode === "existing" ? 0 : mode.startsWith("pre-send") ? 2 : 1,
    );
    expect(f.pause.mock.calls).toEqual(
      ["before", "after", "lost-success", "lost-success-5xx"].includes(mode) ? [[1000]] : [],
    );
    expect(f.park).not.toHaveBeenCalled();
    expect(f.row.labels).toEqual([{ name: "ready" }]);
    await expect(readFile(resolve(f.directory, "cycle-1-complete.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each([
  "read-exhaustion",
  "post-probe-exhaustion",
  "uncertain-5xx",
  "uncertain-eof",
  "unclassified-post",
])(
  "ISS-211 pending run-stop %s retains legacy records across first and second invocation",
  async (mode) => {
    const f = await noteFixture();
    const selection = await readFile(resolve(f.directory, "cycle-1-selected.json"));
    if (mode === "read-exhaustion") f.probe.mockRejectedValue(noteTransport());
    else
      f.post.mockImplementationOnce(async (body) => {
        if (mode === "post-probe-exhaustion") {
          f.row.comments.push({ body });
          f.probe.mockRejectedValue(noteTransport());
        }
        throw mode === "unclassified-post"
          ? new Error("unknown provenance SECRET")
          : noteTransport(
              mode === "uncertain-5xx"
                ? "gh: Bad Gateway (HTTP 502)"
                : 'Post "https://api.github.com/graphql": EOF',
            );
      });
    await expect(f.stop()).rejects.toMatchObject({ reason: "learning-note-state-unknown" });
    expect(f.post).toHaveBeenCalledTimes(mode === "read-exhaustion" ? 0 : 1);
    expect(f.probe).toHaveBeenCalledTimes(
      mode === "read-exhaustion" ? 3 : mode === "post-probe-exhaustion" ? 4 : 2,
    );
    expect(f.pause.mock.calls).toEqual(mode.includes("exhaustion") ? [[1000], [2000]] : []);
    expect(f.park).not.toHaveBeenCalled();
    const intent = await readFile(resolve(f.directory, "cycle-1-stop-1.json"));
    expect(JSON.parse(intent.toString())).toMatchObject({
      attempts: 2,
      history: f.cycle.initialHistory,
      marker: "loop-stop:selection-run:1:1",
    });
    await expect(
      readFile(resolve(f.directory, "cycle-1-stop-1-complete.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    f.probe.mockImplementation(async () => JSON.stringify(f.row));
    // Restart retains its existing marker-first rule; an accepted note is no-op.
    await expect(f.reconcile()).resolves.toEqual({ scope: "run", reason: "provider-unavailable" });
    expect(f.row.comments).toHaveLength(1);
    expect(f.post).toHaveBeenCalledTimes(
      mode === "read-exhaustion" || mode === "post-probe-exhaustion" ? 1 : 2,
    );
    expect(await readFile(resolve(f.directory, "cycle-1-stop-1.json"))).toEqual(intent);
    expect(await readFile(resolve(f.directory, "cycle-1-selected.json"))).toEqual(selection);
    await expect(f.reconcile()).resolves.toBeUndefined();
    expect(f.park).not.toHaveBeenCalled();
    await expect(readFile(resolve(f.directory, "cycle-1-complete.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each([
  "401",
  "403",
  "malformed-json",
  "wrong-number",
  "wrong-key",
  "closed",
  "malformed-comment",
  "duplicate",
  "post-duplicate",
  "post-wrong-key",
  "post-closed",
])("ISS-211 note %s refuses authoritative data without transport retry", async (mode) => {
  const f = await noteFixture();
  const corrupt = () => {
    if (mode.includes("duplicate"))
      f.row.comments = Array.from({ length: 2 }, () => ({
        body: "<!-- loop-stop:selection-run:1:1 -->",
      }));
    if (mode.includes("wrong-key")) f.row.body = "<!-- planning-key: ISS-999 -->";
    if (mode.includes("closed")) f.row.state = "CLOSED";
  };
  if (mode.startsWith("post-"))
    f.post.mockImplementationOnce(async () => {
      corrupt();
    });
  else corrupt();
  if (mode === "401" || mode === "403")
    f.probe.mockRejectedValue(noteTransport(`gh: Forbidden (HTTP ${mode})`));
  if (mode === "malformed-json") f.probe.mockResolvedValue("not JSON: TLS handshake timeout");
  if (mode === "wrong-number") f.row.number = 999;
  if (mode === "malformed-comment")
    f.probe.mockResolvedValue(JSON.stringify({ ...f.row, comments: [{}] }));
  const reason = mode.includes("duplicate")
    ? "duplicate-learning-note"
    : mode.includes("wrong-key")
      ? "selected-issue-identity-drift"
      : mode.includes("closed")
        ? "stopped-issue-state-unknown"
        : mode === "401" || mode === "403"
          ? "learning-note-state-unknown"
          : "issue-observation-unavailable";
  await expect(f.stop()).rejects.toMatchObject({ reason });
  expect(f.probe).toHaveBeenCalledTimes(mode.startsWith("post-") ? 2 : 1);
  expect(f.post).toHaveBeenCalledTimes(mode.startsWith("post-") ? 1 : 0);
  expect(f.pause).not.toHaveBeenCalled();
  expect(f.park).not.toHaveBeenCalled();
  await expect(
    readFile(resolve(f.directory, "cycle-1-stop-1-complete.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["start", "complete"])(
  "ISS-211 non-note %s observation stays single-shot",
  async (mode) => {
    const f = await noteFixture();
    f.probe.mockRejectedValue(noteTransport());
    const operation =
      mode === "start"
        ? startCycle(f.config, f.cycle, f.adapter)
        : completeCycle(f.config, f.cycle, [], f.adapter);
    await expect(operation).rejects.toMatchObject({
      reason: "issue-observation-unavailable",
      diagnostics: undefined,
    });
    expect(f.probe).toHaveBeenCalledTimes(1);
    expect(f.pause).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
  },
);

it.each(["gh: Service Unavailable (HTTP 503)", 'Post "https://api.github.com/graphql": EOF'])(
  "ISS-211 note read recovers transport %s with the actual CLI boundary",
  async (stderr) => {
    const f = await noteFixture();
    f.probe.mockRejectedValueOnce(noteTransport(stderr));
    await expect(f.stop()).resolves.toBe("run");
    expect(f.probe).toHaveBeenCalledTimes(3);
    expect(f.post).toHaveBeenCalledTimes(1);
    expect(f.pause.mock.calls).toEqual([[1000]]);
    expect(f.events).toEqual(["view", "view", "comment", "view"]);
  },
);

it("ISS-187 observes live process identity, excludes itself and defers unknown owners", async () => {
  const f = await prerequisiteFixture();
  roots.push(f.root);
  const workerPath = resolve(
    f.blockedQueue.config.items[0]!.source.stateDirectory,
    "author-attempt.json",
  );
  const worker = await f.json(workerPath);
  await writeFile(workerPath, JSON.stringify({ ...worker, pid: 2147483647 }));
  if (process.platform !== "linux") {
    expect(await prerequisiteOwners(f.loop, f.blocked.selection)).toBe("unknown");
    return;
  }
  const config = resolve(f.root, "process-config.json");
  await writeFile(config, JSON.stringify(f.loop));
  const entry = resolve(f.root, "supervise.mjs");
  const module = pathToFileURL(
    resolve(import.meta.dirname, "../../scripts/dogfood/supervision.ts"),
  ).href;
  await writeFile(
    entry,
    `import {readFileSync, writeFileSync} from 'node:fs';\nimport {prerequisiteOwners} from ${JSON.stringify(module)};\nconst config = JSON.parse(readFileSync(process.argv[2], 'utf8'));\nwriteFileSync(process.argv[3], await prerequisiteOwners(config, ${JSON.stringify(f.blocked.selection)}));\n`,
  );
  const output = resolve(f.root, "self-observation.txt");
  await execute(process.execPath, [entry, config, output], { cwd: f.root });
  expect(await readFile(output, "utf8")).toBe("absent");
  await writeFile(entry, "setInterval(() => {}, 1000);\n");
  const other = spawn(process.execPath, [entry, config], { cwd: f.root, stdio: "ignore" });
  try {
    await once(other, "spawn");
    expect(await prerequisiteOwners(f.loop, f.blocked.selection)).toBe("live");
  } finally {
    const exited = once(other, "exit");
    other.kill();
    await exited;
  }
  // A PID belonging to this test process is not a worker identity.
  await writeFile(workerPath, JSON.stringify({ ...worker, pid: process.pid }));
  expect(await prerequisiteOwners(f.loop, f.blocked.selection)).toBe("unknown");
  const liveWorkerScript = resolve(f.root, "synthetic-process.mjs");
  await writeFile(liveWorkerScript, "setInterval(() => {}, 1000);\n");
  const child = spawn(process.execPath, [liveWorkerScript], {
    cwd: f.blockedQueue.config.items[0]!.source.worktree,
    stdio: "ignore",
  });
  try {
    await once(child, "spawn");
    await writeFile(workerPath, JSON.stringify({ ...worker, pid: child.pid }));
    expect(await prerequisiteOwners(f.loop, f.blocked.selection)).toBe("live");
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
});

it("ISS-187 admission refusals leave the whole run, labels, traces and partials untouched", async () => {
  const f = await prerequisiteFixture();
  roots.push(f.root);
  const declaration = structuredClone(f.loop.prerequisite!);
  const rows = structuredClone(f.rows);
  const loop = structuredClone(f.loop);
  const files = await snapshot(f.runState);
  const context = f.policy.issueContext;
  const candidates = f.policy.selectCandidates;
  const attemptPath = resolve(f.current.config.stateDirectory, "attempt.json");
  const terminalPath = resolve(
    f.current.config.items[0]!.source.stateDirectory,
    "author-terminal.json",
  );
  const stopPath = resolve(f.runState, "cycle-5-stop-2.json");
  const completionPath = resolve(f.runState, "cycle-5-stop-2-complete.json");
  const changes: Array<[string, () => void | Promise<void>]> = [
    [
      "same issue",
      () => {
        f.loop.prerequisite = {
          ...declaration,
          key: declaration.blockedKey,
          number: declaration.blockedNumber,
        };
      },
    ],
    [
      "wrong cycle",
      () => {
        f.loop.prerequisite!.blockedCycle = 4;
      },
    ],
    [
      "wrong key",
      () => {
        f.loop.prerequisite!.blockedKey = "fixture-other";
      },
    ],
    [
      "wrong number",
      () => {
        f.loop.prerequisite!.blockedNumber = 999;
      },
    ],
    [
      "missing stop",
      () => {
        f.loop.prerequisite!.stop = 3;
      },
    ],
    [
      "wrong stop",
      () => {
        f.loop.prerequisite!.stop = 1;
      },
    ],
    ["missing completion", () => rm(completionPath)],
    [
      "wrong stop binding",
      () =>
        writeFile(
          stopPath,
          JSON.stringify({
            ...JSON.parse(files.get(stopPath)!),
            selection: { ...f.blocked.selection, key: "fixture-other" },
          }),
        ),
    ],
    [
      "wrong completion binding",
      () =>
        writeFile(
          completionPath,
          JSON.stringify({ ...JSON.parse(files.get(completionPath)!), stop: 1 }),
        ),
    ],
    [
      "would be attempt1",
      () => {
        f.loop.prerequisite = { ...declaration, key: "fixture-160", number: 160 };
      },
    ],
    ["missing pinned FAIL", () => rm(terminalPath)],
    [
      "non-FAIL terminal",
      () =>
        writeFile(
          terminalPath,
          JSON.stringify({ ...JSON.parse(files.get(terminalPath)!), status: "passed" }),
        ),
    ],
    [
      "wrong terminal identity",
      () =>
        writeFile(
          terminalPath,
          JSON.stringify({ ...JSON.parse(files.get(terminalPath)!), id: "unknown-worker" }),
        ),
    ],
    [
      "wrong terminal head",
      () =>
        writeFile(
          terminalPath,
          JSON.stringify({ ...JSON.parse(files.get(terminalPath)!), head: "a".repeat(40) }),
        ),
    ],
    [
      "wrong pinned run",
      () =>
        writeFile(
          attemptPath,
          JSON.stringify({ ...JSON.parse(files.get(attemptPath)!), run: "another-run" }),
        ),
    ],
    [
      "changed worktree root",
      () => {
        f.loop.worktreeRoot = resolve(f.root, "other-worktrees");
      },
    ],
    [
      "changed ceiling",
      () => {
        f.loop.nativeLaunchCeiling = 32;
      },
    ],
    [
      "not ready",
      () => {
        f.rows[0]!.ready = false;
      },
    ],
    [
      "ineligible",
      () => {
        f.rows[0]!.blocked = true;
      },
    ],
    [
      "closed prerequisite",
      () => {
        f.rows[0]!.state = "CLOSED";
      },
    ],
    [
      "closed blocked cycle",
      () => {
        f.rows[1]!.state = "CLOSED";
      },
    ],
    [
      "live owner",
      () => {
        f.host.prerequisiteOwners = async () => "live";
      },
    ],
    [
      "unknown owner",
      () => {
        f.host.prerequisiteOwners = async () => "unknown";
      },
    ],
    [
      "planning or board mismatch",
      () => {
        f.policy.selectCandidates = () => {
          throw new QueueBlocked("queue-internal-error");
        };
      },
    ],
    [
      "unconfigured routing",
      () => {
        delete f.loop.author;
        delete f.loop.reviewer;
        f.policy.issueContext = async (input) => {
          const { routing: _routing, ...brief } = await context(input);
          return brief;
        };
      },
    ],
  ];
  for (const [name, change] of changes) {
    await change();
    const before = await snapshot(f.runState);
    const trees = await snapshot(loop.worktreeRoot);
    const labels = structuredClone(f.rows);
    const effects = f.calls.filter((call) =>
      /^(launch|probe|install|park|note|delivery):/.test(call),
    );
    await expect(
      (async () => {
        validateLoopConfig(f.loop);
        return f.advance();
      })(),
      name,
    ).rejects.toThrow();
    expect(await snapshot(f.runState), name).toEqual(before);
    expect(await snapshot(loop.worktreeRoot), name).toEqual(trees);
    expect(f.rows, name).toEqual(labels);
    expect(
      f.calls.filter((call) => /^(launch|probe|install|park|note|delivery):/.test(call)),
      name,
    ).toEqual(effects);
    Object.assign(f.loop, structuredClone(loop));
    f.rows.splice(0, f.rows.length, ...structuredClone(rows));
    f.policy.issueContext = context;
    f.policy.selectCandidates = candidates;
    f.host.prerequisiteOwners = async () => "absent";
    for (const [path, bytes] of files) await writeFile(path, bytes);
  }
});

it("ISS-187 leaves ordinary saved selection and item-stop advancement in their native paths", async () => {
  const f = await prerequisiteFixture();
  roots.push(f.root);
  const declaration = f.loop.prerequisite!;
  delete f.loop.prerequisite;
  const before = await snapshot(f.runState);
  const launches = f.calls.filter((call) => call.startsWith("launch:"));
  expect(await f.advance()).toMatchObject({ selection: f.blocked.selection });
  const q = await f.compose((await f.advance())!);
  await expect(queueStep(q.config, q.adapter)).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(f.calls.filter((call) => call.startsWith("launch:"))).toEqual(launches);
  expect(await snapshot(f.runState)).toEqual(before);
  f.loop.prerequisite = declaration;
  // An ordinary completed work stop remains advanceable with a declaration.
  await stopCycle(f.loop, f.blocked, "launcher-failed", 1, f.host, f.policy);
  expect((await f.advance())!.selection.key).toBe("fixture-110");
  expect((await f.advance())!.prerequisite).toBeUndefined();
  await expect(readFile(resolve(f.runState, "prerequisite/admission.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("ISS-187 does not freeze ordinary source-FAIL parking or its completed replay", async () => {
  const f = await sourceFailureFixture(5);
  roots.push(f.root);
  await f.fail();
  await historicalStops(f, "complete");
  f.loop.nativeLaunchCeiling = 64;
  f.loop.prerequisite = {
    blockedCycle: f.cycle.selection.cycle,
    blockedKey: "fixture-110",
    blockedNumber: 110,
    stop: 1,
    key: "fixture-159",
    number: 159,
    authorityUrl: "https://github.com/fixture/repository/issues/1#issuecomment-1",
  };
  for (let replay = 0; replay < 2; replay++) {
    const selected = (await f.advance())!;
    expect(selected.selection.key).toBe("fixture-159");
    expect(selected.prerequisite).toBeUndefined();
    expect(f.rows[0]!.ready).toBe(false);
  }
});

it("ISS-187 keeps the real self planning, dependency, milestone and board admission", async () => {
  const f = await planningSelectionFixture();
  roots.push(f.root);
  f.loop.nativeLaunchCeiling = 64;
  const run = resolve(f.loop.stateRoot, f.loop.run);
  const blocked = { cycle: 5, key: "ISS-003", number: 3, base: f.old };
  for (let cycle = 1; cycle <= 4; cycle++) {
    const selection = {
      cycle,
      key: cycle === 3 ? "ISS-002" : "ISS-001",
      number: cycle === 3 ? 2 : 1,
      base: f.old,
    };
    await persistCycle(f.loop, { selection, initialHistory: [] });
    await writeFile(
      resolve(run, `cycle-${cycle}-complete.json`),
      JSON.stringify({ selection, history: [] }),
    );
  }
  await persistCycle(f.loop, { selection: blocked, initialHistory: [] });
  const intent = {
    selection: blocked,
    stop: 1,
    reason: "pilot-revision-moved",
    attempts: 1,
    history: [],
    marker: "synthetic-stop",
    body: "Synthetic host stop",
  };
  await writeFile(resolve(run, "cycle-5-stop-1.json"), JSON.stringify(intent));
  await writeFile(
    resolve(run, "cycle-5-stop-1-complete.json"),
    JSON.stringify({ selection: blocked, stop: 1, history: [] }),
  );
  const prior = resolve(run, "iss-002-attempt-1");
  const source = resolve(prior, "source");
  const setup = resolve(prior, "setup");
  await Promise.all([mkdir(source, { recursive: true }), mkdir(setup, { recursive: true })]);
  const issue = `https://github.com/${f.loop.repository}/issues/2`;
  await writeFile(
    resolve(prior, "attempt.json"),
    JSON.stringify({
      run: f.loop.run,
      item: "ISS-002:1",
      issue,
      phase: "source",
      base: f.old,
      candidateAttempt: 1,
      acceptedStage: null,
    }),
  );
  await writeFile(
    resolve(source, "config.json"),
    JSON.stringify({
      config: {
        run: f.loop.run,
        issue,
        repository: f.loop.repository,
        base: f.old,
        stateDirectory: source,
      },
    }),
  );
  await writeFile(
    resolve(source, "author-attempt.json"),
    JSON.stringify({ id: "synthetic-prior-author" }),
  );
  await writeFile(
    resolve(source, "author-terminal.json"),
    JSON.stringify({ id: "synthetic-prior-author", status: "failed", head: f.old }),
  );
  await writeFile(
    resolve(setup, "setup-plan.json"),
    JSON.stringify({
      worktrees: ["source", "pilot", "review"].map((role) => ({
        path: resolve(f.loop.worktreeRoot, `iss-002-attempt-1-${role}`),
      })),
    }),
  );
  f.loop.prerequisite = {
    blockedCycle: 5,
    blockedKey: "ISS-003",
    blockedNumber: 3,
    stop: 1,
    key: "ISS-002",
    number: 2,
    authorityUrl: "https://github.com/fixture/repository/issues/1#issuecomment-1",
  };
  f.host.prerequisiteOwners = async () => "absent";
  f.host.issue = async (_config, number) => ({
    state: "OPEN",
    key: number === 2 ? "ISS-002" : "ISS-003",
    labels: ["ready"],
    comments: [],
  });
  const board = await f.board();
  const census = vi.spyOn(boardLoader, "loadBoardSnapshot").mockResolvedValue(board);
  const before = await snapshot(run);
  const selected = (await nativeNextCycle(f.loop, f.executor, f.host, f.policy))!;
  expect(selected.selection).toEqual({
    cycle: 5,
    key: "ISS-002",
    number: 2,
    base: f.current,
    planningRevision: f.current,
  });
  for (const kind of ["unready", "body", "milestone", "dependency"] as const) {
    const changed = structuredClone(board);
    if (kind === "unready") changed.issues[1]!.labels = [];
    if (kind === "body") changed.issues[1]!.body += "\nUnmirrored content";
    if (kind === "milestone") changed.issues[1]!.milestone = "Second";
    if (kind === "dependency") {
      // ISS-003 remains blocked by the open ISS-002 and cannot preempt it.
      const candidates = await f.policy.selectCandidates({
        repository: f.loop.repository,
        executorRoot: f.executor,
        planningRevision: f.current,
        gitExecutable: f.loop.gitExecutable,
      });
      expect(candidates.map((row) => row.key)).toEqual(["ISS-002"]);
      continue;
    }
    census.mockResolvedValue(changed);
    await expect(nativeNextCycle(f.loop, f.executor, f.host, f.policy), kind).rejects.toThrow();
    census.mockResolvedValue(board);
    expect(await snapshot(run)).toEqual(before);
  }
  expect(await snapshot(run)).toEqual(before);
});

it.each(["host-stop", "dispatch-interruption", "author-fail", "park-completion", "external-close"])(
  "ISS-187 resumes only its existing lineage at %s",
  async (boundary) => {
    const f = await prerequisiteFixture();
    roots.push(f.root);
    const before = await snapshot(f.runState);
    const trees = await snapshot(f.loop.worktreeRoot);
    const selected = (await f.advance())!;
    await persistCycle(f.loop, selected);
    // A crash after selection must not mistake the old attempt1 FAIL for a
    // terminal result of the detour itself.
    expect(await f.advance()).toEqual(selected);
    const q = await f.compose(selected);
    await startCycle(f.loop, selected, f.host);
    if (boundary === "host-stop" || boundary === "dispatch-interruption") {
      f.setAuthorStatus("running");
      if (boundary === "dispatch-interruption") {
        const observe = f.native.observe;
        f.native.observe = async () => {
          throw new QueueBlocked("provider-unavailable");
        };
        await expect(queueStep(q.config, q.adapter)).rejects.toMatchObject({
          reason: "provider-unavailable",
        });
        f.native.observe = observe;
      } else await queueStep(q.config, q.adapter);
      await stopCycle(f.loop, selected, "provider-unavailable", 2, f.host, f.policy);
      const launches = f.calls.filter((c) => c.startsWith("launch:"));
      expect(await f.advance()).toEqual(selected);
      const resumed = await f.compose((await f.advance())!);
      expect(await reconcilePendingStop(f.loop, selected, f.host, f.policy)).toBeUndefined();
      expect(await queueStep(resumed.config, resumed.adapter)).toMatchObject({
        status: "observing-author",
      });
      expect(f.calls.filter((c) => c.startsWith("launch:"))).toEqual(launches);
    } else {
      if (boundary === "external-close") f.rows[0]!.state = "CLOSED";
      else {
        await expect(queueStep(q.config, q.adapter)).rejects.toMatchObject({
          reason: "author-failed",
        });
        if (boundary === "park-completion") {
          await stopCycle(
            f.loop,
            { ...selected, initialHistory: await q.adapter.history() },
            "author-failed",
            2,
            f.host,
            f.policy,
          );
          // Interruption after the native note receipt but before cycle completion.
          await rm(resolve(f.runState, "prerequisite/cycle-5-complete.json"));
        }
      }
      await expect(f.advance()).rejects.toMatchObject({ reason: "prerequisite-held" });
      const terminal = await snapshot(f.runState);
      await expect(f.advance()).rejects.toMatchObject({ reason: "prerequisite-held" });
      expect(await snapshot(f.runState)).toEqual(terminal);
      await expect(
        readFile(resolve(f.runState, "fixture-110-attempt-3/attempt.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    await prerequisiteProof(f, before, trees, boundary);
  },
);

it("fresh FAIL parks and selects next ready", async () => {
  const f = await sourceFailureFixture();
  roots.push(f.root);
  await f.fail();
  expect(await f.stop()).toBe("item");
  expect(f.rows[0]).toMatchObject({ state: "OPEN", ready: false });
  expect(f.rows[0]!.comments).toHaveLength(1);
  expect(f.rows[0]!.comments[0]).toContain("author-failed");
  expect(f.rows[0]!.comments[0]).toContain("1 implementation attempt");
  expect(f.rows[0]!.comments[0]).toContain("To unpark");
  expect(await f.drain()).toEqual(["fixture-159", "fixture-160"]);
  expect(
    f.calls.filter((call) => call.startsWith("launch:") && call.endsWith("/110")),
  ).toHaveLength(1);
  expect(f.calls).not.toContain("delivery:fixture-110:1");
  expect(f.cycle.initialHistory).toMatchObject([{ role: "author", outcome: "failed" }]);
});

it.each(["park", "note", "completion"])(
  "replayed failed source stop preserves history and spent allowances: %s",
  async (interruption) => {
    const f = await sourceFailureFixture(5);
    roots.push(f.root);
    await f.fail();
    const directory = f.current.config.stateDirectory;
    const attemptPath = resolve(directory, "attempt.json");
    const attempt = JSON.parse(await readFile(attemptPath, "utf8"));
    expect(attempt).toMatchObject({
      phase: "source",
      candidateAttempt: 1,
      head: f.base,
      reviewId: null,
      acceptedStage: null,
    });
    await writeFile(attemptPath, JSON.stringify({ ...attempt, retries: 1 }));
    const source = f.current.config.items[0]!.source.stateDirectory;
    const authorPath = resolve(source, "author-attempt.json");
    const author = JSON.parse(await readFile(authorPath, "utf8"));
    await writeFile(authorPath, JSON.stringify({ ...author, retries: 1 }));
    for (const [name, value] of Object.entries({
      "gate-correction": { failedHead: f.base },
      "native-refresh": { resolutionUsed: true, flowRetried: true, retries: 2 },
    }))
      await writeFile(
        resolve(f.current.config.items[0]!.source.stateDirectory, `${name}.json`),
        JSON.stringify(value),
      );
    await historicalStops(f, "pilot-complete");
    const prior = await snapshot(f.runState);
    const priorTrees = await snapshot(f.loop.worktreeRoot);
    const expectedHistory = structuredClone(f.cycle.initialHistory);
    expect(expectedHistory).toHaveLength(6);
    expect(attempt.authorFailures).toEqual({ count: 1, ids: [expectedHistory[5]!.id] });
    const park = f.policy.park;
    const comment = f.host.comment;
    if (interruption === "park")
      f.policy.park = async (input) => {
        await park(input);
        throw new Error("synthetic park interruption");
      };
    if (interruption === "note") {
      // A historical note may be absent even though the old completion exists.
      f.rows[0]!.comments = [];
      f.host.comment = async (...args) => {
        await comment(...args);
        throw new Error("synthetic note interruption");
      };
    }
    if (interruption === "completion") {
      // Exclusive cycle completion write fails after parking/notes have reconciled.
      f.policy.park = async (input) => {
        const result = await park(input);
        await mkdir(resolve(f.runState, `cycle-${f.cycle.selection.cycle}-complete.json`));
        return result;
      };
    }
    await expect(f.advance()).rejects.toThrow();
    f.policy.park = park;
    f.host.comment = comment;
    if (interruption === "completion")
      await rm(resolve(f.runState, `cycle-${f.cycle.selection.cycle}-complete.json`), {
        recursive: true,
      });
    expect(await f.advance()).toMatchObject({
      selection: { key: "fixture-159" },
      initialHistory: expectedHistory,
    });
    const parks = f.calls.filter((call) => call.startsWith("park:")).length;
    expect(await f.advance()).toMatchObject({
      selection: { key: "fixture-159" },
      initialHistory: expectedHistory,
    });
    expect(f.calls.filter((call) => call.startsWith("park:"))).toHaveLength(parks);
    for (const [path, bytes] of prior) expect(await readFile(path, "utf8"), path).toBe(bytes);
    for (const [path, bytes] of priorTrees) expect(await readFile(path, "utf8"), path).toBe(bytes);
    expect(
      f.rows[0]!.comments.filter((body) => body.includes(`:${f.cycle.selection.cycle}:1 -->`)),
    ).toHaveLength(1);
    f.loop.nativeLaunchCeiling = 8;
    const next = (await f.advance())!;
    await persistCycle(f.loop, next);
    const q = await f.compose(next);
    await startCycle(f.loop, next, f.host);
    const { queueStep } = await import("../../scripts/dogfood/queue.js");
    await queueStep(q.config, q.adapter);
    await completeCycle(f.loop, next, await q.adapter.history(), f.host);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
    let later: SupervisedCycle;
    try {
      later = (await f.advance())!;
    } finally {
      clock.mockRestore();
    }
    expect(later.initialHistory.slice(0, 6)).toEqual(expectedHistory);
    expect(later.initialHistory).toHaveLength(8);
    await persistCycle(f.loop, later);
    const exhausted = await f.compose(later);
    await expect(queueStep(exhausted.config, exhausted.adapter)).rejects.toMatchObject({
      reason: "native-launch-ceiling-exhausted",
    });
    expect((await f.advance())!.initialHistory).toEqual(later.initialHistory);
    expect(
      f.calls.filter((call) => call.startsWith("launch:") && call.endsWith("/110")),
    ).toHaveLength(1);
    expect(await readFile(attemptPath, "utf8")).toBe(prior.get(attemptPath));
    for (const name of [
      "candidate",
      "reviewer-attempt",
      "reviewer-terminal",
      "publication",
      "ready",
    ])
      await expect(readFile(resolve(source, `${name}.json`))).rejects.toMatchObject({
        code: "ENOENT",
      });
  },
);
const execute = (file: string, args: string[], options: ExecFileOptions) =>
  new Promise<void>((resolvePromise, reject) => {
    execFile(file, args, { ...options, encoding: "utf8" }, (error, _stdout, stderr) => {
      if (error) reject({ code: error.code, stderr });
      else resolvePromise();
    });
  });
const supervisorCommand = resolve(import.meta.dirname, "../../scripts/dogfood/supervise.mjs");
const supervisorHook = resolve(import.meta.dirname, "supervise-fixtures/hook.mjs");
const repositoryPolicy: RepositoryAdapter = {
  selectCandidates: () => [{ key: "ISS-105", number: 362 }],
  issueContext: async () => {
    throw new Error("unused");
  },
  branchName: () => "codex/iss-105",
  pullRequest: async () => {
    throw new Error("unused pullRequest");
  },
  requiredChecks: () => ["linux", "windows", "macos"],
  park: () => "add the `ready` label after acting on the note",
  mergeMethod: () => ({ method: "squash" }),
  afterMerge: () => {},
};

function draft(key: string, milestone: string, blockedBy: string[] = []) {
  return `---
key: ${key}
title: "Do ${key}"
labels: ["type:slice"]
milestone: "${milestone}"
blocked_by: [${blockedBy.join(", ")}]
---

## Why

Because.

## Done when

- Preserve behavior.
`;
}

function planning(): PlanningSnapshot {
  return {
    roadmap: {
      schemaVersion: "orchestration-roadmap/v1",
      repository: "todd-skelton/orchestration-platform",
      project: {
        id: "project-1",
        number: 1,
        title: "Delivery",
        url: "https://example.test/project",
      },
      milestones: [
        { key: "M1", title: "First" },
        { key: "M2", title: "Second" },
      ],
      issues: [
        { key: "ISS-100", file: "planning/drafts/ISS-100.md", milestone: "M1", blockedBy: [] },
        {
          key: "ISS-105",
          file: "planning/drafts/ISS-105.md",
          milestone: "M1",
          blockedBy: ["ISS-100"],
        },
        {
          key: "ISS-106",
          file: "planning/drafts/ISS-106.md",
          milestone: "M1",
          blockedBy: ["ISS-100"],
        },
        { key: "ISS-200", file: "planning/drafts/ISS-200.md", milestone: "M2", blockedBy: [] },
      ],
    },
    issueDrafts: {
      "ISS-100": draft("ISS-100", "First"),
      "ISS-105": draft("ISS-105", "First", ["ISS-100"]),
      "ISS-106": draft("ISS-106", "First", ["ISS-100"]),
      "ISS-200": draft("ISS-200", "Second"),
    },
  };
}

function board(
  source: PlanningSnapshot,
  rows: Record<string, { state: "OPEN" | "CLOSED"; ready?: boolean }>,
): BoardSnapshot {
  const expected = expectedBoardItems(source);
  return {
    repository: source.roadmap.repository,
    totalCount: expected.length,
    issues: expected.map((item, index) => ({
      number: index + 1,
      title: item.title,
      body: item.body,
      milestone: item.milestone,
      state: rows[item.key]!.state,
      labels: rows[item.key]!.ready ? ["ready"] : [],
    })),
  };
}

function loop(root: string): LoopConfig {
  return {
    schemaVersion: "dogfood-loop/v1",
    run: "selection-run",
    adapter: "self",
    repository: "fixture/repository",
    stableExecutorRoot: root,
    stateRoot: resolve(root, "state"),
    worktreeRoot: resolve(root, "worktrees"),
    author: { model: "author", effort: "high" },
    reviewer: { model: "reviewer", effort: "high" },
    codexExecutable: resolve(root, "codex"),
    gitExecutable: resolve(root, "git"),
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
}

function selected(): SupervisedCycle {
  const selection: SelectedIssue = {
    cycle: 1,
    key: "ISS-105",
    number: 362,
    base: "a".repeat(40),
  };
  return { selection, initialHistory: [] };
}

function fakeAdapter(observation: IssueObservation): SupervisionAdapter {
  return {
    async currentMain() {
      throw new Error("main must not be read while a selected cycle is active");
    },
    async issue() {
      return structuredClone(observation);
    },
    async removeReady() {
      observation.labels = observation.labels.filter((label) => label !== "ready");
    },
    async close() {
      observation.state = "CLOSED";
    },
    async comment(_config, _number, body) {
      observation.comments.push(body);
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

describe("ready issue selection", () => {
  it("orders by the earliest open milestone and key while skipping blocked work", async () => {
    const source = planning();
    const snapshot = board(source, {
      "ISS-100": { state: "CLOSED" },
      "ISS-105": { state: "OPEN", ready: true },
      "ISS-106": { state: "OPEN", ready: true },
      "ISS-200": { state: "OPEN", ready: true },
    });
    expect(
      (
        await selectCandidates({
          repository: source.roadmap.repository,
          planning: source,
          board: snapshot,
        })
      )[0],
    ).toEqual({ key: "ISS-105", number: 2 });

    snapshot.issues[1]!.labels = [];
    expect(
      (
        await selectCandidates({
          repository: source.roadmap.repository,
          planning: source,
          board: snapshot,
        })
      )[0],
    ).toEqual({ key: "ISS-106", number: 3 });

    snapshot.issues[0]!.state = "OPEN";
    expect(
      await selectCandidates({
        repository: source.roadmap.repository,
        planning: source,
        board: snapshot,
      }),
    ).toEqual([]);

    snapshot.issues[0]!.state = "CLOSED";
    snapshot.issues[1]!.state = "CLOSED";
    snapshot.issues[2]!.state = "CLOSED";
    expect(
      (
        await selectCandidates({
          repository: source.roadmap.repository,
          planning: source,
          board: snapshot,
        })
      )[0],
    ).toEqual({ key: "ISS-200", number: 4 });
  });
});

it("removes ready and resumes the selected cycle", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-selection-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  };
  const adapter = fakeAdapter(observation);

  await persistCycle(config, cycle);
  await startCycle(config, cycle, adapter);
  expect(observation.labels).not.toContain("ready");
  await expect(nextCycle(config, root, adapter, repositoryPolicy)).resolves.toEqual(cycle);
});

it("selects candidates and main from the configured repository root", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-split-roots-"));
  roots.push(root);
  const repositoryRoot = resolve(root, "repository");
  const controllerRoot = resolve(root, "controller");
  await Promise.all([repositoryRoot, controllerRoot].map((path) => mkdir(path)));
  await Promise.all(
    [repositoryRoot, controllerRoot].map((cwd) =>
      execute("git", ["init", "-b", "main", "--quiet"], { cwd, windowsHide: true }),
    ),
  );
  const config = { ...loop(root), stableExecutorRoot: repositoryRoot };
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  };
  const adapter = fakeAdapter(observation);
  let mainRoot = "";
  adapter.currentMain = async (_config, selectedRoot) => {
    mainRoot = selectedRoot;
    return "a".repeat(40);
  };
  let candidateRoot = "";
  const repository: RepositoryAdapter = {
    ...repositoryPolicy,
    selectCandidates: ({ executorRoot }) => {
      candidateRoot = executorRoot;
      return [{ key: "ISS-105", number: 362 }];
    },
  };

  await expect(nextCycle(config, controllerRoot, adapter, repository)).resolves.toMatchObject({
    selection: { key: "ISS-105", base: "a".repeat(40) },
  });
  expect({ candidateRoot, mainRoot }).toEqual({
    candidateRoot: repositoryRoot,
    mainRoot: repositoryRoot,
  });
});

it("refuses unavailable self main before selection persistence without an issue note", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-main-stop-"));
  roots.push(root);
  const repository = resolve(import.meta.dirname, "../..");
  const source = await loadPlanningSnapshot(repository);
  const config = { ...loop(root), repository: source.roadmap.repository };
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  };
  const adapter = fakeAdapter(observation);
  adapter.currentMain = async () => {
    throw new QueueBlocked("current-main-unavailable");
  };

  await expect(nextCycle(config, repository, adapter, repositoryPolicy)).rejects.toThrow(
    "current-main-unavailable",
  );
  await expect(nextCycle(config, repository, adapter, repositoryPolicy)).rejects.toThrow(
    "current-main-unavailable",
  );
  expect(observation.comments).toEqual([]);
  expect(observation.labels).toContain("ready");
});

it("fresh self selection sees later registration", async () => {
  const f = await planningSelectionFixture();
  roots.push(f.root);
  const before = await f.installed();
  const board = await f.board();
  const census = vi.spyOn(boardLoader, "loadBoardSnapshot").mockResolvedValue(board);
  const fetch = vi.spyOn(f.host, "currentMain");
  // The old checkout cannot reconcile the new board registration.
  await expect(
    f.policy.selectCandidates({ repository: f.loop.repository, executorRoot: f.executor }),
  ).rejects.toThrow("unregistered planning key ISS-002");
  const cycle = (await nativeNextCycle(f.loop, f.executor, f.host, f.policy))!;
  expect(cycle.selection).toEqual({
    cycle: 1,
    key: "ISS-002",
    number: 2,
    base: f.current,
    planningRevision: f.current,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(census).toHaveBeenCalledTimes(2);
  // Before persistence a new call reobserves; same-main ordering remains stable.
  expect(await nativeNextCycle(f.loop, f.executor, f.host, f.policy)).toEqual(cycle);
  await persistCycle(f.loop, cycle);
  const selectedBytes = await retainedFiles(resolve(f.loop.stateRoot, f.loop.run));
  f.host.issue = async () => ({ key: "ISS-002", state: "OPEN", labels: [], comments: [] });
  expect(await nativeNextCycle(f.loop, f.executor, f.host, f.policy)).toEqual(cycle);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await retainedFiles(resolve(f.loop.stateRoot, f.loop.run))).toEqual(selectedBytes);
  // External closure advances once, then respects the same-main dependency and milestone.
  board.issues[1]!.state = "CLOSED";
  f.host.issue = async () => ({ key: "ISS-002", state: "CLOSED", labels: [], comments: [] });
  const successor = (await nativeNextCycle(f.loop, f.executor, f.host, f.policy))!;
  expect(successor.selection).toMatchObject({
    cycle: 2,
    key: "ISS-003",
    base: f.current,
    planningRevision: f.current,
  });
  await persistCycle(f.loop, successor);
  f.host.issue = async () => ({ key: "ISS-003", state: "OPEN", labels: [], comments: [] });
  expect(await nativeNextCycle(f.loop, f.executor, f.host, f.policy)).toEqual(successor);
  board.issues[2]!.labels = [];
  const stopComments: string[] = [];
  await stopCycle(
    f.loop,
    successor,
    "gate-correction-failed",
    1,
    {
      ...f.host,
      issue: async () => ({ key: "ISS-003", state: "OPEN", labels: [], comments: stopComments }),
      comment: async (_config, _number, body) => {
        stopComments.push(body);
      },
    },
    { ...f.policy, park: () => "synthetic unpark" },
  );
  // An open, unready earliest milestone must not select M2.
  expect(await nativeNextCycle(f.loop, f.executor, f.host, f.policy)).toBeUndefined();
  expect(await nativeNextCycle(f.loop, f.executor, f.host, f.policy)).toBeUndefined();
  await f.add("ISS-005");
  const newer = await f.commit("Synthetic successor registration");
  const laterBoard = await f.board();
  laterBoard.issues[1]!.state = "CLOSED";
  laterBoard.issues[2]!.labels = [];
  census.mockResolvedValue(laterBoard);
  expect(await nativeNextCycle(f.loop, f.executor, f.host, f.policy)).toMatchObject({
    selection: { cycle: 3, key: "ISS-005", base: newer, planningRevision: newer },
  });
  expect(await f.installed()).toEqual(before);
});

it.each([
  "fetch",
  "git read",
  "partial Git read",
  "incomplete census",
  "failed fetch command",
  "orphan draft",
  "unknown key",
  "malformed key",
  "wrong body",
  "wrong milestone",
  "duplicate key",
  "registration ahead",
])("selection authority failure refuses: %s", async (failure) => {
  const f = await planningSelectionFixture();
  roots.push(f.root);
  const before = await f.installed();
  const board = await f.board();
  const loader = vi.spyOn(boardLoader, "loadBoardSnapshot").mockResolvedValue(board);
  let reason = "queue-internal-error";
  let diagnostics: string;
  const acquiredPaths: string[] = [];
  if (failure === "fetch") {
    reason = "current-main-unavailable";
    // A BOARD-shaped message at the fetch site is still an acquisition failure.
    diagnostics = "Error: BOARD_CONTRACT_MISMATCH: synthetic fetch denied\nfull original detail";
    f.host.currentMain = async () => {
      throw new Error(diagnostics.slice(7));
    };
  } else if (failure === "failed fetch command") {
    reason = "current-main-unavailable";
    await f.git(f.executor, ["remote", "set-url", "origin", resolve(f.root, "missing-origin")]);
    let original: unknown;
    try {
      await f.git(f.executor, [
        "fetch",
        "--no-tags",
        "origin",
        "refs/heads/main:refs/remotes/origin/main",
      ]);
    } catch (error) {
      original = error;
    }
    expect(original).toBeInstanceOf(Error);
    diagnostics = String(original);
  } else if (failure === "partial Git read") {
    reason = "current-main-unavailable";
    await f.host.currentMain(f.loop, f.executor);
    const missing = `${f.current}:planning/drafts/missing.md`;
    let original: unknown;
    try {
      await f.git(f.executor, ["show", missing]);
    } catch (error) {
      original = error;
    }
    expect(original).toBeInstanceOf(Error);
    diagnostics = String(original);
    const load = planningLoader.loadPlanningSnapshot;
    vi.spyOn(planningLoader, "loadPlanningSnapshot").mockImplementation((root, pinned) =>
      load(
        root,
        pinned && {
          ...pinned,
          git: async (args) => {
            acquiredPaths.push(args[1]!);
            return pinned.git(
              args[1] === `${f.current}:planning/drafts/ISS-003.md` ? ["show", missing] : args,
            );
          },
        },
      ),
    );
  } else if (failure === "git read") {
    reason = "current-main-unavailable";
    f.loop.gitExecutable = resolve(f.root, "missing-git");
    f.host.currentMain = async () => f.current;
    diagnostics = ""; // Assert the full native child error below, not only its reason.
  } else if (failure === "incomplete census") {
    reason = "issue-observation-unavailable";
    let original: unknown;
    try {
      boardLoader.boardSnapshotFromGraphqlPages(f.loop.repository, [
        {
          data: {
            repository: {
              issues: {
                totalCount: 179,
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "synthetic-first-page" },
              },
            },
          },
        },
      ]);
    } catch (error) {
      original = error;
    }
    expect(original).toBeInstanceOf(Error);
    loader.mockRejectedValue(original);
    diagnostics = String(original);
  } else {
    if (failure === "orphan draft") {
      await writeFile(resolve(f.remote, "planning/drafts/ISS-099.md"), "orphan\n");
      await f.commit("Synthetic orphan");
    }
    if (failure === "unknown key")
      board.issues[1]!.body = board.issues[1]!.body.replaceAll("ISS-002", "ISS-999");
    if (failure === "malformed key")
      board.issues[1]!.body = board.issues[1]!.body.replaceAll("ISS-002", "ISS-malformed");
    if (failure === "wrong body") board.issues[1]!.body += "\nwrong body";
    if (failure === "wrong milestone") board.issues[1]!.milestone = "Wrong";
    if (failure === "duplicate key") board.issues[2]!.body = board.issues[1]!.body;
    if (failure === "registration ahead") {
      board.issues.splice(1, 1);
      board.totalCount--;
    }
    // Independently obtain the validator's full message, outside acquisition.
    const planning = await loadPlanningSnapshot(f.remote);
    let original: unknown;
    try {
      const { validatePlanningSnapshot } = await import("../../scripts/planning/check.mjs");
      validatePlanningSnapshot(planning);
      boardLoader.validateBoardSnapshot(planning, board);
    } catch (error) {
      original = error;
    }
    expect(original).toBeInstanceOf(Error);
    diagnostics = (original as Error).message;
  }
  for (let retry = 0; retry < 2; retry++) {
    let caught: unknown;
    try {
      await nativeNextCycle(f.loop, f.executor, f.host, f.policy);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const actual =
      caught instanceof QueueBlocked
        ? { reason: caught.reason, diagnostics: caught.diagnostics }
        : { reason: "queue-internal-error", diagnostics: (caught as Error).message };
    expect(actual.reason).toBe(reason);
    if (failure === "git read") {
      expect(actual.diagnostics).toContain(f.loop.gitExecutable);
      expect(actual.diagnostics).toContain("ENOENT");
    } else expect(actual.diagnostics).toBe(diagnostics);
  }
  expect(await f.installed()).toEqual(before);
  if (failure === "partial Git read") {
    expect(acquiredPaths).toContain(`${f.current}:planning/roadmap.json`);
    expect(acquiredPaths).toContain(`${f.current}:planning/drafts/ISS-002.md`);
    expect(acquiredPaths).toContain(`${f.current}:planning/drafts/ISS-003.md`);
  }
  await expect(
    readFile(resolve(f.loop.stateRoot, f.loop.run, "cycle-1-selected.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(retainedFiles(f.loop.stateRoot)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["open", "closed", "completed", "item-stopped"])(
  "selection refresh preserves legacy resume and M2: %s",
  async (state) => {
    const f = await planningSelectionFixture();
    roots.push(f.root);
    const cycle = {
      selection: { cycle: 1, key: "ISS-001", number: 1, base: f.old },
      initialHistory: [],
    };
    await persistCycle(f.loop, cycle);
    const run = resolve(f.loop.stateRoot, f.loop.run);
    // Byte-sensitive retained evidence includes a spent allowance and participant records.
    const history = [
      {
        ordinal: 1,
        id: "prior-author",
        item: "ISS-001:1",
        stage: "source" as const,
        role: "author" as const,
        outcome: "failed" as const,
        usage: {
          inputTokens: { status: "unavailable" as const },
          outputTokens: { status: "unavailable" as const },
          costUsd: { status: "unavailable" as const },
        },
      },
    ];
    const attempt = resolve(run, "iss-001-attempt-1");
    await mkdir(attempt);
    await writeFile(
      resolve(attempt, "participant-1-terminal.json"),
      JSON.stringify(history[0], null, 3),
    );
    await writeFile(
      resolve(attempt, "attempt.json"),
      JSON.stringify({ candidateAttempt: 1, retries: 1, history }, null, 3),
    );
    const sentinel = resolve(f.root, "synthetic-m2");
    await mkdir(sentinel);
    await writeFile(resolve(sentinel, "runtime.json"), '{ "spent": 4, "running": true }\n');
    f.host.issue = async () => ({
      key: "ISS-001",
      state: state === "closed" ? "CLOSED" : "OPEN",
      labels: [],
      comments: [],
    });
    if (state === "completed")
      await writeFile(
        resolve(run, "cycle-1-complete.json"),
        JSON.stringify({ selection: cycle.selection, history }, null, 3),
      );
    if (state === "item-stopped") {
      const comments: string[] = [];
      await stopCycle(
        f.loop,
        { ...cycle, initialHistory: history },
        "gate-correction-failed",
        1,
        {
          ...f.host,
          issue: async () => ({ key: "ISS-001", state: "OPEN", labels: [], comments }),
          comment: async (_config, _number, body) => {
            comments.push(body);
          },
        },
        { ...f.policy, park: () => "synthetic unpark" },
      );
    }
    const retained = await retainedFiles(run);
    const m2 = await retainedFiles(sentinel);
    const installed = await f.installed();
    vi.spyOn(boardLoader, "loadBoardSnapshot").mockResolvedValue(await f.board());
    const fetch = vi.spyOn(f.host, "currentMain");
    const select = vi.spyOn(f.policy, "selectCandidates");
    for (let repeat = 0; repeat < 2; repeat++) {
      const resumed = (await nativeNextCycle(f.loop, f.executor, f.host, f.policy))!;
      if (state === "open") expect(resumed).toEqual(cycle);
      else {
        expect(resumed.selection).toMatchObject({
          cycle: 2,
          key: "ISS-002",
          planningRevision: f.current,
        });
        expect(resumed.initialHistory).toEqual(history);
        await persistCycle(f.loop, resumed);
        f.host.issue = async () => ({ key: "ISS-002", state: "OPEN", labels: [], comments: [] });
      }
      const now = await retainedFiles(run);
      for (const [path, evidence] of retained) expect(now.get(path), path).toEqual(evidence);
    }
    expect(fetch).toHaveBeenCalledTimes(state === "open" ? 0 : 1);
    expect(select).toHaveBeenCalledTimes(state === "open" ? 0 : 1);
    expect(await retainedFiles(sentinel)).toEqual(m2);
    expect(await f.installed()).toEqual(installed);
  },
);

it.each(["current-main-unavailable", "routing-row-unconfigured"])(
  "retains the selected routing row in a %s note without an attempt record",
  async (reason) => {
    const root = await mkdtemp(resolve(tmpdir(), "supervision-routing-selection-"));
    roots.push(root);
    const config = { ...loop(root), adapter: "chase-sets", routingRows: [] };
    const observation: IssueObservation = {
      state: "OPEN",
      key: "cs-105",
      labels: ["ready"],
      comments: [],
    };
    const adapter = fakeAdapter(observation);
    const repository: RepositoryAdapter = {
      ...repositoryPolicy,
      selectCandidates: () => [{ key: "cs-105", number: 105, routing: { row: 7, review: 11 } }],
    };
    if (reason === "current-main-unavailable") {
      for (let scan = 0; scan < 2; scan++)
        await expect(nextCycle(config, root, adapter, repository)).rejects.toThrow(reason);
    } else {
      adapter.currentMain = async () => "a".repeat(40);
      const cycle = (await nextCycle(config, root, adapter, repository))!;
      await persistCycle(config, cycle);
      const resumed = (await nextCycle(config, root, adapter, repository))!;
      expect(resumed).toEqual(cycle);
      await stopCycle(config, resumed, reason, 0, adapter, repository);
      await expect(
        readFile(resolve(config.stateRoot, config.run, "cs-105-attempt-1", "attempt.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(observation.comments).toHaveLength(1);
    expect(observation.comments[0]).toContain('Routing: {"row":7,"review":11}');
    expect(observation.comments[0]).toContain("no recorded author or reviewer launches");
    expect(observation.comments[0]).toContain("after 0 implementation attempts");
    expect(observation.labels).toContain("ready");
  },
);

it("keeps a complete delivery gate artifact path beyond the old stop excerpt limit", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-gate-log-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  };
  const artifact = resolve(
    root,
    ...Array<string>(24).fill("long-runtime-directory-name"),
    "source",
    "delivery-gate-check-structure.log",
  );
  const diagnostic = `Complete delivery gate command and diagnostic: ${JSON.stringify(artifact)}`;
  expect(diagnostic.length).toBeGreaterThan(500);
  await persistCycle(config, cycle);
  await stopCycle(
    config,
    cycle,
    "gate-failed:check:structure",
    1,
    fakeAdapter(observation),
    repositoryPolicy,
    diagnostic,
  );
  expect(observation.comments[0]).toContain(JSON.stringify(diagnostic));
});

it("retains actual routing and refused primary/fallback launches in a learning note", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-routing-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const usage = {
    inputTokens: { status: "unavailable" as const },
    outputTokens: { status: "unavailable" as const },
    costUsd: { status: "unavailable" as const },
  };
  cycle.initialHistory = [
    {
      ordinal: 1,
      id: "author",
      item: "ISS-105:1",
      stage: "source",
      role: "author",
      outcome: "passed",
      routing: { row: "self" },
      placement: { model: "gpt-6-astra", effort: "high" },
      usage,
    },
    {
      ordinal: 2,
      id: "primary",
      item: "ISS-105:1",
      stage: "source",
      role: "reviewer",
      outcome: "dead",
      routing: { row: "self" },
      placement: { model: "claude-opus-5", effort: "high" },
      usage,
    },
    {
      ordinal: 3,
      id: "fallback",
      item: "ISS-105:1",
      stage: "source",
      role: "reviewer",
      outcome: "failed",
      routing: { row: "self" },
      placement: { model: "gpt-5.6-sol", effort: "high" },
      rung: 1,
      usage,
    },
  ];
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  };
  await persistCycle(config, cycle);
  await stopCycle(
    config,
    cycle,
    "provider-model-refused",
    1,
    fakeAdapter(observation),
    repositoryPolicy,
  );
  expect(observation.comments).toHaveLength(1);
  for (const model of ["gpt-6-astra", "claude-opus-5", "gpt-5.6-sol"])
    expect(observation.comments[0]).toContain(`"model":"${model}"`);
  expect(observation.comments[0]).toContain('"row":"self"');
  expect(observation.comments[0]).toContain('"rung":1');
  expect(observation.comments[0]).toContain('"outcome":"dead"');
});

it("includes the selected routing row in a setup stop before worker launches", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-routing-setup-"));
  roots.push(root);
  const config = { ...loop(root), adapter: "chase-sets", routingRows: [] };
  const cycle = selected();
  await persistCycle(config, cycle);
  const directory = resolve(config.stateRoot, config.run, "iss-105-attempt-1");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "attempt.json"),
    JSON.stringify({ routing: { row: 7, review: 11 } }),
  );
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: ["ready"],
    comments: [],
  };
  await stopCycle(
    config,
    cycle,
    "worktree-collision:source",
    1,
    fakeAdapter(observation),
    repositoryPolicy,
  );
  expect(observation.comments[0]).toContain('Routing: {"row":7,"review":11}');
  expect(observation.comments[0]).toContain("no recorded author or reviewer launches");
});

it.each(["operator-evidence-required", "operator-evidence-authority", "operator-evidence-failed"])(
  "resumes the %s stop with the ruled parking policy",
  async (reason) => {
    const root = await mkdtemp(resolve(tmpdir(), "supervision-evidence-"));
    roots.push(root);
    const config = loop(root);
    config.acceptedReplan = replanPacket(config.stateRoot);
    const cycle = selected();
    const observation: IssueObservation = {
      state: "OPEN",
      key: "ISS-105",
      labels: [],
      comments: [],
    };
    let parks = 0;
    const repository = {
      ...repositoryPolicy,
      park() {
        parks++;
        return "obtain new authority before unparking";
      },
    };
    const adapter = fakeAdapter(observation);
    await persistCycle(config, cycle);
    const comment = adapter.comment;
    adapter.comment = async (...args) => {
      await comment(...args);
      throw new Error("interrupted receipt");
    };
    await expect(stopCycle(config, cycle, reason, 5, adapter, repository)).rejects.toThrow(
      "interrupted receipt",
    );
    adapter.comment = comment;
    const resumed = await reconcilePendingStop(config, cycle, adapter, repository);
    expect(resumed).toEqual({
      scope: reason === "operator-evidence-failed" ? "item" : "run",
      reason,
    });
    expect(parks).toBe(reason === "operator-evidence-failed" ? 2 : 0);
    expect(observation.comments).toHaveLength(1);
    expect(observation.comments[0]).toContain("after 5 implementation attempts");
    if (reason !== "operator-evidence-failed")
      expect(observation.comments[0]).toContain("resume this same run");
    await expect(reconcilePendingStop(config, cycle, adapter, repository)).resolves.toBeUndefined();
  },
);

it.each(["pending", "complete", "absent", "wrong-directory", "work"])(
  "replays the saved selection and %s learning note before native gate-stop admission",
  async (mode) => {
    const root = await mkdtemp(resolve(tmpdir(), "supervision-gate-recovery-"));
    roots.push(root);
    const config = loop(root);
    const cycle = selected();
    const directory = resolve(config.stateRoot, config.run, "iss-105-attempt-2");
    const source = resolve(directory, "repair");
    await mkdir(source, { recursive: true });
    const reason = mode === "work" ? "gate-base-failed:test" : "gate-attribution-unknown:test";
    await writeFile(
      resolve(directory, "attempt.json"),
      JSON.stringify({
        run: config.run,
        phase: "delivery",
        stateDirectory: source,
        issue: `https://github.com/${config.repository}/issues/362`,
      }),
    );
    await writeFile(resolve(source, "gate-stop.json"), JSON.stringify({ reason }));
    config.gateStopAuthorization = {
      stateDirectory: source,
      candidateHead: "b".repeat(40),
      repairSha: "c".repeat(40),
      authorityUrl: "https://github.com/fixture/repository/issues/494#issuecomment-5687186310",
    };
    const observation: IssueObservation = {
      state: "OPEN",
      key: "ISS-105",
      labels: [],
      comments: [],
    };
    const adapter = fakeAdapter(observation);
    const comment = adapter.comment;
    await persistCycle(config, cycle);
    if (mode !== "complete")
      adapter.comment = async (...args) => {
        await comment(...args);
        throw new Error("lost receipt");
      };
    const stopping = stopCycle(config, cycle, reason, 2, adapter, repositoryPolicy);
    if (mode !== "complete") await expect(stopping).rejects.toThrow("lost receipt");
    else await expect(stopping).resolves.toBe("run");
    adapter.comment = comment;
    const originalNote = await readFile(
      resolve(config.stateRoot, config.run, "cycle-1-stop-1.json"),
    );
    if (mode === "absent") delete config.gateStopAuthorization;
    if (mode === "wrong-directory")
      config.gateStopAuthorization!.stateDirectory = resolve(directory, "source");
    const resumed = await nextCycle(config, root, adapter, repositoryPolicy);
    expect(resumed).toEqual(cycle);
    const result = await reconcilePendingStop(config, resumed!, adapter, repositoryPolicy);
    if (mode === "absent" || mode === "wrong-directory" || mode === "work")
      expect(result).toEqual({ scope: "run", reason });
    else expect(result).toBeUndefined();
    expect(observation.comments).toHaveLength(1);
    expect(await readFile(resolve(config.stateRoot, config.run, "cycle-1-stop-1.json"))).toEqual(
      originalNote,
    );
    expect(JSON.parse(await readFile(resolve(source, "gate-stop.json"), "utf8"))).toEqual({
      reason,
    });
    await expect(
      reconcilePendingStop(config, resumed!, adapter, repositoryPolicy),
    ).resolves.toBeUndefined();
  },
);

it("posts one learning note after an interrupted comment and parks an item stop", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  const adapter = fakeAdapter(observation);
  const comment = adapter.comment;
  let interrupted = true;
  adapter.comment = async (...args) => {
    await comment(...args);
    if (interrupted) {
      interrupted = false;
      throw new Error("lost comment receipt");
    }
  };

  await persistCycle(config, cycle);
  await expect(
    stopCycle(config, cycle, "launcher-failed", 2, adapter, repositoryPolicy),
  ).rejects.toThrow("lost comment receipt");
  await stopCycle(config, cycle, "launcher-failed", 2, adapter, repositoryPolicy);

  expect(observation.comments).toHaveLength(1);
  expect(observation.comments[0]).toContain("launcher-failed");
  expect(observation.comments[0]).toContain("2 implementation attempts");
  expect(observation.comments[0]).toContain(
    "To unpark, add the `ready` label after acting on the note.",
  );
  expect(observation.labels).not.toContain("ready");
});

it("parks an item stop and advances selection to a different issue", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-park-next-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  const adapter = fakeAdapter(observation);
  adapter.currentMain = async () => "b".repeat(40);
  const parked: Array<{ number: number; reason: string }> = [];
  const candidates = [
    { key: "ISS-105", number: 362 },
    { key: "ISS-106", number: 363 },
  ];
  const repository: RepositoryAdapter = {
    ...repositoryPolicy,
    selectCandidates: () =>
      candidates.filter(({ number }) => !parked.some((row) => row.number === number)),
    park: ({ number, reason }) => {
      parked.push({ number, reason });
      return "add the `ready` label after acting on the note";
    },
  };

  await persistCycle(config, cycle);
  await expect(
    stopCycle(config, cycle, "implementation-attempt-ceiling-exhausted", 4, adapter, repository),
  ).resolves.toBe("item");
  await expect(nextCycle(config, root, adapter, repository)).resolves.toMatchObject({
    selection: { cycle: 2, key: "ISS-106", number: 363, base: "b".repeat(40) },
  });
  expect(parked).toEqual([{ number: 362, reason: "implementation-attempt-ceiling-exhausted" }]);
  expect(observation.comments[0]).toContain(
    "apply the final blocking findings before unparking the issue",
  );
  expect(observation.comments[0]).not.toContain("restart");
  expect(observation.comments[0]).not.toContain("\n");
});

it("parks only the explicit item stop reasons", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-run-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  let parks = 0;
  const repository: RepositoryAdapter = {
    ...repositoryPolicy,
    park: () => {
      parks += 1;
      return "unpark fixture";
    },
  };

  await persistCycle(config, cycle);
  await expect(
    stopCycle(
      config,
      cycle,
      "native-launch-ceiling-exhausted",
      2,
      fakeAdapter(observation),
      repository,
    ),
  ).resolves.toBe("run");
  expect(
    [
      "implementation-attempt-ceiling-exhausted",
      "gate-retry-exhausted:typecheck",
      "reviewer-malformed",
      "author-malformed",
      "exit-receipt-timeout",
      "launcher-failed",
      "rebase-conflict",
      "refresh-review-failed",
      "hosted-check-failed:linux",
      "hosted-check-log-unavailable:windows",
      "deploy-not-verified",
      "source-finding-location-outside-candidate",
    ].every(isItemStopReason),
  ).toBe(true);
  expect(isItemStopReason("native-launch-ceiling-exhausted")).toBe(false);
  expect(isItemStopReason("unstable-executor")).toBe(false);
  expect(parks).toBe(0);
  expect(observation.comments[0]).not.toContain("To unpark");
  await expect(nextCycle(config, root, fakeAdapter(observation), repository)).resolves.toEqual(
    cycle,
  );
});

it.each([
  ["author-malformed", true],
  ["worker-verdict-identity-mismatch:malformed-worker-verdict-compatibility", false],
  ["gate-base-failed:test", false],
  ["gate-host-failed:test", false],
  ["gate-attribution-unknown:test", false],
  ["gate-correction-exhausted:test", true],
  ["gate-correction-failed", true],
  ["gate-correction-review-failed", true],
] as const)("retains one learning note and the parking policy for %s", async (reason, parked) => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-gate-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = { state: "OPEN", key: "ISS-105", labels: [], comments: [] };
  let parks = 0;
  const repository: RepositoryAdapter = {
    ...repositoryPolicy,
    park: () => {
      parks++;
      return "restore readiness after addressing the diagnostic";
    },
  };
  const adapter = fakeAdapter(observation);
  await persistCycle(config, cycle);
  await expect(
    stopCycle(
      config,
      cycle,
      reason,
      1,
      adapter,
      repository,
      "full candidate and base logs in runtime",
    ),
  ).resolves.toBe(parked ? "item" : "run");
  await expect(reconcilePendingStop(config, cycle, adapter, repository)).resolves.toBeUndefined();
  expect(parks).toBe(parked ? 1 : 0);
  expect(observation.comments).toHaveLength(1);
  expect(observation.comments[0]).toContain(reason);
  expect(observation.comments[0]).toContain("1 implementation attempt");
});

it.each(
  ["controller-executor-mismatch", "unstable-executor", "provider-unavailable"].flatMap((reason) =>
    ["fresh", "saved", "pending-item-stop", "completed-item-stop"].map((shape) => ({
      reason,
      shape,
    })),
  ),
)(
  "exits on $reason from $shape with a host note without parking or selecting again",
  async ({ reason, shape }) => {
    const root = await mkdtemp(resolve(tmpdir(), "supervision-command-run-stop-"));
    roots.push(root);
    const config = loop(root);
    const runState = resolve(config.stateRoot, config.run);
    const fixtureState = resolve(root, "fixture-state");
    const request = resolve(root, "loop.json");
    const controlsPath = resolve(fixtureState, "command-controls.json");
    const issuePath = resolve(fixtureState, "command-issue.json");
    const observation: IssueObservation = {
      state: "OPEN",
      key: "ISS-105",
      labels: ["ready"],
      comments: [],
    };
    await mkdir(fixtureState, { recursive: true });
    if (shape !== "fresh") await persistCycle(config, selected());
    if (shape.endsWith("item-stop"))
      await stopCycle(
        config,
        selected(),
        "gate-correction-failed",
        1,
        fakeAdapter(observation),
        repositoryPolicy,
      );
    if (shape === "pending-item-stop") {
      await rm(resolve(runState, "cycle-1-stop-1-complete.json"));
      observation.comments = [];
    }
    const prior = shape === "fresh" ? new Map<string, string>() : await snapshot(runState);
    const priorNotes = [...observation.comments];
    await Promise.all([
      writeFile(request, `${JSON.stringify(config)}\n`),
      writeFile(
        controlsPath,
        `${JSON.stringify({
          main: "a".repeat(40),
          validationStopReason: reason,
          parkCalls: 0,
        })}\n`,
      ),
      writeFile(issuePath, `${JSON.stringify(observation)}\n`),
    ]);

    let failure: { code?: number | string; stderr?: string } | undefined;
    try {
      await execute(
        process.execPath,
        ["--import", pathToFileURL(supervisorHook).href, supervisorCommand, request],
        {
          env: { ...process.env, SUPERVISE_FIXTURE_STATE: fixtureState },
          timeout: 10_000,
          windowsHide: true,
        },
      );
    } catch (error) {
      failure = error as { code?: number | string; stderr?: string };
    }

    expect(failure).toMatchObject({ code: 1 });
    const controls = JSON.parse(await readFile(controlsPath, "utf8"));
    expect(controls.parkCalls).toBe(0);
    expect(controls.selectCalls ?? 0).toBe(shape === "fresh" ? 1 : 0);
    const issue = JSON.parse(await readFile(issuePath, "utf8"));
    expect(issue.state).toBe("OPEN");
    expect(issue.labels).toEqual(observation.labels);
    expect(issue.comments.slice(0, priorNotes.length)).toEqual(priorNotes);
    expect(issue.comments).toHaveLength(priorNotes.length + 1);
    expect(issue.comments.at(-1)).toContain(reason);
    expect(issue.comments.at(-1)).not.toContain("To unpark");
    expect(failure?.stderr).toContain(`"reason":"${reason}"`);
    for (const [path, bytes] of prior) expect(await readFile(path, "utf8"), path).toBe(bytes);
    expect(await readFile(resolve(fixtureState, "command-calls.log"), "utf8")).not.toContain(
      "workspace:",
    );
    if (shape === "pending-item-stop")
      await expect(
        readFile(resolve(runState, "cycle-1-stop-1-complete.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    const ordinal = shape.endsWith("item-stop") ? 2 : 1;
    await expect(
      readFile(resolve(runState, `cycle-1-stop-${ordinal}-complete.json`), "utf8"),
    ).resolves.toEqual(expect.any(String));
  },
);

it("exits an accepted corrective run on an item stop and asks Todd before further work", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-accepted-replan-stop-"));
  roots.push(root);
  const config: LoopConfig = {
    ...loop(root),
    run: ACCEPTED_REPLAN.run,
    adapter: "chase-sets",
    routingRows: [],
    repository: "chase-sets/chase-sets",
    targetMilestone: 158,
    acceptedReplan: replanPacket(loop(root).stateRoot),
  };
  const runState = resolve(config.stateRoot, config.run);
  const request = resolve(root, "loop.json");
  await mkdir(runState, { recursive: true });
  await persistCycle(config, {
    selection: { cycle: 1, key: "cs-7766", number: 7766, base: "a".repeat(40) },
    initialHistory: [],
  });
  await writeFile(request, JSON.stringify(config));
  await writeFile(
    resolve(runState, "command-controls.json"),
    JSON.stringify({
      workspaceStops: { "cs-7766": "implementation-attempt-ceiling-exhausted" },
      parkCalls: 0,
    }),
  );
  await writeFile(
    resolve(runState, "command-issue.json"),
    JSON.stringify({
      state: "OPEN",
      key: "cs-7766",
      labels: [],
      comments: [],
    }),
  );
  await expect(
    execute(
      process.execPath,
      ["--import", pathToFileURL(supervisorHook).href, supervisorCommand, request],
      {
        env: { ...process.env, SUPERVISE_FIXTURE_STATE: runState },
        timeout: 10_000,
        windowsHide: true,
      },
    ),
  ).rejects.toMatchObject({ code: 1 });
  const controls = JSON.parse(await readFile(resolve(runState, "command-controls.json"), "utf8"));
  expect(controls.parkCalls).toBe(1);
  expect(controls.selectCalls).toBeUndefined();
  const issue = JSON.parse(await readFile(resolve(runState, "command-issue.json"), "utf8"));
  expect(issue.comments).toHaveLength(1);
  expect(issue.comments[0]).toContain("propose rollback, and wait for Todd");
  expect(issue.comments[0]).toContain("do not start another corrective cycle");
});

it("exits after one selection when a stop happens before a cycle is active", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-command-pre-cycle-stop-"));
  roots.push(root);
  const config = loop(root);
  const runState = resolve(config.stateRoot, config.run);
  const request = resolve(root, "loop.json");
  const controlsPath = resolve(runState, "command-controls.json");
  const issuePath = resolve(runState, "command-issue.json");
  await mkdir(runState, { recursive: true });
  await Promise.all([
    writeFile(request, `${JSON.stringify(config)}\n`),
    writeFile(
      controlsPath,
      `${JSON.stringify({ selectionReason: "malformed-repository-candidates", selectCalls: 0 })}\n`,
    ),
    writeFile(
      issuePath,
      `${JSON.stringify({ state: "OPEN", key: "ISS-105", labels: ["ready"], comments: [] })}\n`,
    ),
  ]);

  let failure: { code?: number | string; stderr?: string } | undefined;
  try {
    await execute(
      process.execPath,
      ["--import", pathToFileURL(supervisorHook).href, supervisorCommand, request],
      {
        env: { ...process.env, SUPERVISE_FIXTURE_STATE: runState },
        timeout: 10_000,
        windowsHide: true,
      },
    );
  } catch (error) {
    failure = error as { code?: number | string; stderr?: string };
  }

  expect(failure).toMatchObject({ code: 1 });
  expect(failure?.stderr).toContain('"reason":"malformed-repository-candidates"');
  expect(JSON.parse(await readFile(controlsPath, "utf8"))).toMatchObject({ selectCalls: 1 });
  expect(JSON.parse(await readFile(issuePath, "utf8")).comments).toEqual([]);
});

it.each([
  {
    reason: "queue-internal-error",
    diagnostics: "PLANNING_CONTRACT_MISMATCH: orphan draft\n  full validation detail",
  },
  {
    reason: "queue-internal-error",
    diagnostics: "BOARD_CONTRACT_MISMATCH: unregistered key\n  full board detail",
  },
  {
    reason: "current-main-unavailable",
    diagnostics: "Error: BOARD_CONTRACT_MISMATCH: fetch failed\n  full acquisition detail",
  },
  {
    reason: "issue-observation-unavailable",
    diagnostics: "Error: BOARD_CONTRACT_MISMATCH: incomplete census\n  full pagination detail",
  },
])(
  "prints full pre-cycle $reason diagnostics without an issue note",
  async ({ reason, diagnostics }) => {
    const root = await mkdtemp(resolve(tmpdir(), "supervision-command-pre-cycle-error-"));
    roots.push(root);
    const config = loop(root);
    const runState = resolve(config.stateRoot, config.run);
    const request = resolve(root, "loop.json");
    await mkdir(runState, { recursive: true });
    await Promise.all([
      writeFile(request, `${JSON.stringify(config)}\n`),
      writeFile(
        resolve(runState, "command-controls.json"),
        `${JSON.stringify(
          reason === "queue-internal-error"
            ? { selectionMessage: diagnostics }
            : { selectionReason: reason, selectionDiagnostics: diagnostics },
        )}\n`,
      ),
      writeFile(
        resolve(runState, "command-issue.json"),
        `${JSON.stringify({ state: "OPEN", key: "ISS-105", labels: ["ready"], comments: [] })}\n`,
      ),
    ]);

    let failure: { code?: number | string; stderr?: string } | undefined;
    try {
      await execute(
        process.execPath,
        ["--import", pathToFileURL(supervisorHook).href, supervisorCommand, request],
        {
          env: { ...process.env, SUPERVISE_FIXTURE_STATE: runState },
          timeout: 10_000,
          windowsHide: true,
        },
      );
    } catch (error) {
      failure = error as { code?: number | string; stderr?: string };
    }

    expect(failure).toMatchObject({ code: 1 });
    expect(failure?.stderr).toContain(`"reason":${JSON.stringify(reason)}`);
    expect(failure?.stderr).toContain(`"diagnostics":${JSON.stringify(diagnostics)}`);
    expect(
      JSON.parse(await readFile(resolve(runState, "command-issue.json"), "utf8")).comments,
    ).toEqual([]);
    await expect(readFile(resolve(runState, "cycle-1-selected.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each(["main", "b".repeat(40), "", null])(
  "rejects malformed or unequal saved planningRevision: %s",
  async (planningRevision) => {
    const root = await mkdtemp(resolve(tmpdir(), "invalid-planning-revision-"));
    roots.push(root);
    const config = loop(root);
    const directory = resolve(config.stateRoot, config.run);
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "cycle-1-selected.json"),
      JSON.stringify({ ...selected().selection, planningRevision }),
    );
    const retained = await retainedFiles(directory);
    const host = fakeAdapter({ key: "ISS-105", state: "OPEN", labels: [], comments: [] });
    const issue = vi.spyOn(host, "issue");
    await expect(nextCycle(config, root, host, repositoryPolicy)).rejects.toMatchObject({
      reason: "malformed-supervision-record:cycle-1-selected",
    });
    expect(issue).not.toHaveBeenCalled();
    expect(await retainedFiles(directory)).toEqual(retained);
  },
);

it("preserves adapter reasons in stop notes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-adapter-reason-"));
  roots.push(root);
  const adapterRoot = resolve(root, "adapter-root");
  await mkdir(resolve(adapterRoot, "adapters"), { recursive: true });
  await writeFile(
    resolve(adapterRoot, "adapters", "fixture.mjs"),
    `export const selectCandidates=()=>[];
export const issueContext=()=>{throw {reason:"missing-fixture-delivery-skill"}};
export const branchName=()=>"fixture";
export const pullRequest=()=>({});
export const requiredChecks=()=>[];
export const park=()=>{throw {reason:"fixture-park-unavailable"}};
export const mergeMethod=()=>({});
export const afterMerge=()=>{};\n`,
  );
  const repository = await loadRepositoryAdapter("fixture", adapterRoot);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  await persistCycle(config, cycle);

  let reason = "queue-internal-error";
  try {
    await repository.issueContext({
      repository: config.repository,
      key: cycle.selection.key,
      number: cycle.selection.number,
      executorRoot: root,
    });
  } catch (error) {
    if (error instanceof QueueBlocked) reason = error.reason;
  }
  await expect(
    stopCycle(config, cycle, reason, 0, fakeAdapter(observation), repository),
  ).resolves.toBe("run");
  expect(observation.comments[0]).toContain("missing-fixture-delivery-skill");
  expect(observation.comments[0]).not.toContain("queue-internal-error");
  await expect(
    stopCycle(
      config,
      cycle,
      "implementation-attempt-ceiling-exhausted",
      1,
      fakeAdapter(observation),
      repository,
    ),
  ).rejects.toMatchObject({ reason: "fixture-park-unavailable" });
  expect(observation.comments[1]).toContain("fixture-park-unavailable");
  expect(observation.comments[1]).not.toContain("To unpark");
});

it("uses the generic fallback with the evidence directory and verbatim reason", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-generic-stop-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  await persistCycle(config, cycle);
  await stopCycle(
    config,
    cycle,
    "synthetic-unmapped-reason",
    1,
    fakeAdapter(observation),
    repositoryPolicy,
    "provider refused the observation",
  );
  expect(observation.comments[0]).toContain("synthetic-unmapped-reason");
  expect(observation.comments[0]).toContain(resolve(config.stateRoot, config.run));
  expect(observation.comments[0]).toContain('Diagnostic: "provider refused the observation".');
});

it("gives the three prescribed stops exact actions without forbidden advice", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-prescribed-stops-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  const adapter = fakeAdapter(observation);
  await persistCycle(config, cycle);
  for (const reason of [
    "completed-issue-state-unknown",
    "issue-observation-unavailable",
    "selected-base-unavailable",
  ])
    await stopCycle(config, cycle, reason, 1, adapter, repositoryPolicy);

  const [completed, unavailable, selectedBase] = observation.comments;
  expect(completed).toContain("if the PR merged, close the issue by hand and restart");
  expect(completed).not.toMatch(/reopen/i);
  expect(unavailable).toContain("restore `gh` authentication or network access and restart");
  expect(unavailable).not.toMatch(/edit (?:the )?issue/i);
  expect(selectedBase).toContain("fetch origin or otherwise restore its pinned base commit");
  expect(selectedBase).not.toMatch(/change (?:the )?selection/i);
});

it.each(["selected-ops-not-admitted", "selected-ops-not-runnable"])(
  "%s retains a pending native stop and never parks or consumes another attempt",
  async (reason) => {
    const root = await mkdtemp(resolve(tmpdir(), "supervision-ops-stop-"));
    roots.push(root);
    const config = {
      ...loop(root),
      adapter: "chase-sets",
      repository: "chase-sets/chase-sets",
      targetMilestone: 155,
    };
    const cycle = selected();
    const observation: IssueObservation = {
      state: "OPEN",
      key: cycle.selection.key,
      labels: ["kind:ops"],
      comments: [],
    };
    const host = fakeAdapter(observation);
    const park = vi.fn(() => {
      throw new Error("ops refusal must not park");
    });
    const policy = { ...repositoryPolicy, park };
    await persistCycle(config, cycle);
    const runState = resolve(config.stateRoot, config.run);
    const selectedBytes = await readFile(resolve(runState, "cycle-1-selected.json"));
    expect(isItemStopReason(reason)).toBe(false);
    const interrupted = {
      ...host,
      comment: async (...args: Parameters<SupervisionAdapter["comment"]>) => {
        await host.comment(...args);
        throw new Error("lost receipt");
      },
    };
    await expect(
      stopCycle(
        config,
        cycle,
        reason,
        3,
        interrupted,
        policy,
        "Issue #9001; target 155; admission-required.",
      ),
    ).rejects.toThrow("lost receipt");
    const stopBytes = await readFile(resolve(runState, "cycle-1-stop-1.json"));
    await expect(reconcilePendingStop(config, cycle, host, policy)).resolves.toEqual({
      scope: "run",
      reason,
    });
    await expect(reconcilePendingStop(config, cycle, host, policy)).resolves.toBeUndefined();
    expect(park).not.toHaveBeenCalled();
    expect(observation.labels).toEqual(["kind:ops"]);
    expect(observation.state).toBe("OPEN");
    expect(observation.comments).toHaveLength(1);
    expect(observation.comments[0]).toContain("after 3 implementation attempts");
    expect(observation.comments[0]).not.toContain("To unpark");
    expect(await readFile(resolve(runState, "cycle-1-selected.json"))).toEqual(selectedBytes);
    expect(await readFile(resolve(runState, "cycle-1-stop-1.json"))).toEqual(stopBytes);
    await expect(readFile(resolve(runState, "cycle-1-complete.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("closes a completed issue without restoring ready", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-complete-"));
  roots.push(root);
  const config = loop(root);
  const cycle = selected();
  const observation: IssueObservation = {
    state: "OPEN",
    key: "ISS-105",
    labels: [],
    comments: [],
  };
  await persistCycle(config, cycle);
  await completeCycle(config, cycle, [], fakeAdapter(observation));
  expect(observation.state).toBe("CLOSED");
  expect(observation.labels).not.toContain("ready");
});
