import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  currentCandidateAttempt,
  QueueBlocked,
  queueConfigFromLoop,
  repositoryQueueAdapter,
  queueStep,
  retainedSourceFailure,
  validateLoopExecutor,
  validateLoopConfig,
  validateQueueConfig,
  type LoopConfig,
  type QueueAdapter,
  type QueueConfig,
  type QueueDeliveryResult,
  type QueueItem,
  type QueueParticipant,
} from "../../scripts/dogfood/queue.js";
import {
  ACCEPTED_REPLAN,
  evidenceDescriptor,
  replanPacket,
  writeEvidence,
} from "./fixtures/continuation.js";
import type { Adapter, Attempt } from "../../scripts/dogfood/flow.js";
import { step as sourceStep, workerPrompt } from "../../scripts/dogfood/flow.js";
import { codexAdapter } from "../../scripts/dogfood/dispatch-adapter.js";
import { MAX_TERMINAL_SUMMARY_LENGTH } from "../../scripts/dogfood/terminal-summary.mjs";
import prefixedAuthor from "./fixtures/iss-177-prefixed-author.json" with { type: "json" };
import * as selfAdapter from "../../adapters/self.mjs";
import type { RepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.js";
import { setupStep } from "../../scripts/dogfood/setup.js";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import {
  nextCycle,
  persistCycle,
  reconcilePendingStop,
  startCycle,
  stopCycle,
  type SupervisedCycle,
  type SupervisionAdapter,
} from "../../scripts/dogfood/supervision.js";
import { SELF_ROUTING, type RoutingRow } from "../../scripts/dogfood/routing.mjs";
import { sourceFailureFixture, repairFailureFixture, snapshot } from "./fixtures/source-failure.js";
import { startCaseTiming, type CaseTiming } from "./fixtures/iss212-timing.js";

let timing: CaseTiming | undefined;

it("binds repair FAIL to its retained setup, source, review, author and complete history", async () => {
  const f = await repairFailureFixture();
  roots.push(f.root);
  await f.fail();
  const directory = f.current.config.stateDirectory;
  const selected = f.cycle.selection;
  const original = await snapshot(directory);
  const observe = () => retainedSourceFailure(f.loop, selected);
  expect(await observe()).toMatchObject({ attempts: 3, history: f.cycle.initialHistory });
  const change = async (name: string, mutate: (record: any) => void) => {
    const path = resolve(directory, `${name}.json`);
    const value = JSON.parse(original.get(path)!);
    mutate(value);
    await writeFile(path, JSON.stringify(value));
  };
  const controls: [string, (value: any) => void][] = [
    [
      "attempt",
      (r) => {
        r.run = "other";
      },
    ],
    [
      "attempt",
      (r) => {
        r.issue += "9";
      },
    ],
    [
      "attempt",
      (r) => {
        r.item = "fixture-110:3";
      },
    ],
    [
      "attempt",
      (r) => {
        r.candidateAttempt = 2;
      },
    ],
    [
      "attempt",
      (r) => {
        r.candidateAttempt = 5;
      },
    ],
    [
      "attempt",
      (r) => {
        r.acceptedStage = "repair";
      },
    ],
    [
      "attempt",
      (r) => {
        r.stateDirectory = resolve(directory, "repair");
      },
    ],
    [
      "attempt",
      (r) => {
        r.head = f.base;
      },
    ],
    [
      "attempt",
      (r) => {
        r.reviewId = "other";
      },
    ],
    [
      "attempt",
      (r) => {
        r.history.pop();
      },
    ],
    [
      "setup/setup-plan",
      (r) => {
        r.run = "other";
      },
    ],
    [
      "setup/setup-plan",
      (r) => {
        r.repository = "fixture/other";
      },
    ],
    [
      "setup/setup-plan",
      (r) => {
        r.issue += "9";
      },
    ],
    [
      "setup/setup-plan",
      (r) => {
        r.stateDirectory = directory;
      },
    ],
    [
      "setup/setup-plan",
      (r) => {
        r.base = "e".repeat(40);
      },
    ],
    [
      "setup/setup-plan",
      (r) => {
        r.sourceBranch = "other";
      },
    ],
    [
      "setup/setup-plan",
      (r) => {
        r.worktrees[1].path = directory;
      },
    ],
    [
      "source/candidate",
      (r) => {
        r.head = f.base;
      },
    ],
    [
      "source/reviewer-attempt",
      (r) => {
        r.id = "other";
      },
    ],
    [
      "source/reviewer-terminal",
      (r) => {
        r.id = "other";
      },
    ],
    [
      "source/reviewer-terminal",
      (r) => {
        r.head = f.base;
      },
    ],
    [
      "source/reviewer-terminal",
      (r) => {
        r.status = "passed";
      },
    ],
    [
      "repair/author-attempt",
      (r) => {
        r.id = "other";
      },
    ],
    [
      "repair/author-terminal",
      (r) => {
        r.id = "other";
      },
    ],
    [
      "repair/author-terminal",
      (r) => {
        r.head = f.base;
      },
    ],
    ...["passed", "running", "dead", "malformed"].map((status): [string, (r: any) => void] => [
      "repair/author-terminal",
      (r) => {
        r.status = status;
      },
    ]),
    ...["source", "repair"].flatMap((stage): [string, (r: any) => void][] => [
      [
        `${stage}/config`,
        (r) => {
          r.config.run = "other";
        },
      ],
      [
        `${stage}/config`,
        (r) => {
          r.config.repository = "fixture/other";
        },
      ],
      [
        `${stage}/config`,
        (r) => {
          r.config.issue += "9";
        },
      ],
      [
        `${stage}/config`,
        (r) => {
          r.config.stateDirectory = directory;
        },
      ],
      [
        `${stage}/config`,
        (r) => {
          r.config.base = "e".repeat(40);
        },
      ],
      [
        `${stage}/config`,
        (r) => {
          r.config.mainBase = "e".repeat(40);
        },
      ],
      [
        `${stage}/config`,
        (r) => {
          r.config.worktree = directory;
        },
      ],
    ]),
  ];
  for (const [name, mutate] of controls) {
    await change(name, mutate);
    expect(await observe(), name).toBeUndefined();
    expect(await f.stop(), name).toBe("run");
    await writeFile(
      resolve(directory, `${name}.json`),
      original.get(resolve(directory, `${name}.json`))!,
    );
  }
  // Binding checks still matter when the queue history and its reduction agree.
  for (const ordinal of [5, 6]) {
    for (const field of ["id", "item", "stage", "role", "outcome"]) {
      const mutate = (p: any) => {
        p[field] = {
          id: "other",
          item: "other:2",
          stage: "refresh",
          role: ordinal === 5 ? "author" : "reviewer",
          outcome: "passed",
        }[field];
      };
      await change(`participant-${ordinal}-terminal`, mutate);
      await change("attempt", (r) => mutate(r.history[ordinal - 1]));
      expect(await observe(), `${ordinal}:${field}`).toBeUndefined();
      for (const name of ["attempt", `participant-${ordinal}-terminal`])
        await writeFile(
          resolve(directory, `${name}.json`),
          original.get(resolve(directory, `${name}.json`))!,
        );
    }
  }
  const terminal = resolve(directory, "repair/author-terminal.json");
  await rm(terminal);
  expect(await observe()).toBeUndefined();
  expect(await f.stop()).toBe("run");
  await writeFile(terminal, original.get(terminal)!);
  f.loop.nativeLaunchCeiling = 5;
  await expect(observe()).rejects.toMatchObject({ reason: "native-launch-ceiling-exhausted" });
  f.loop.nativeLaunchCeiling = 16;
  expect(await observe()).toMatchObject({ attempts: 3, history: f.cycle.initialHistory });
  expect(await f.stop()).toBe("item");
  expect(await snapshot(directory)).toEqual(original);
});

async function unparkedRepairFailure(intervening = false, capture?: CaseTiming) {
  const f = await repairFailureFixture(capture);
  roots.push(f.root);
  await f.fail();
  expect(await f.stop()).toBe("item");
  expect((await f.advance())!.selection.key).toBe("fixture-159");
  if (intervening) expect(await f.drain()).toEqual(["fixture-159", "fixture-160"]);
  await writeFile(resolve(f.repository, "main.txt"), "later main\n");
  await f.git(f.repository, ["add", "main.txt"]);
  await f.git(f.repository, ["commit", "-m", "synthetic later main"]);
  await f.git(f.repository, ["push", "origin", "main"]);
  f.rows[0]!.ready = true; // External acceptance plus explicit planning unpark.
  const context = f.policy.issueContext;
  f.policy.issueContext = async (input) => ({
    ...(await context(input)),
    body: "Accepted brief repair: use fixture mode current. Preserve the invariant.",
    acceptanceCriteria: ["Use fixture mode current", "Preserve the invariant"],
  });
  const next = (await f.advance())!;
  return { f, next };
}

it("unparks only attempt 4 with current guidance, full diff, history and fresh review", async () => {
  timing = await startCaseTiming("unpark");
  const { f, next } = await unparkedRepairFailure(true, timing);
  timing?.phase("proof");
  const prior = await snapshot(f.runState);
  const trees = await snapshot(f.loop.worktreeRoot);
  timing?.phase("queue");
  const path = resolve(f.current.config.stateDirectory, "attempt.json");
  const old = JSON.parse(prior.get(path)!);
  expect(old).toMatchObject({ phase: "repair", candidateAttempt: 3, retries: 1 });
  expect(old.authorFailures).toEqual({
    count: 3,
    ids: ["synthetic-worker-1", "synthetic-worker-2", "synthetic-worker-5"],
  });
  expect(await f.git(f.current.config.items[0]!.source.worktree, ["status", "--porcelain"])).toBe(
    "M product.txt",
  );
  expect(next.initialHistory).toHaveLength(10);
  const q = await f.compose(next);
  const item = q.config.items[0]!;
  expect(item).toMatchObject({
    id: "fixture-110:4",
    implementationAttempt: 4,
    source: { mainBase: next.selection.base, authorFailures: old.authorFailures },
  });
  expect(item.source.base).not.toBe(old.head);
  expect(
    await f.git(f.repository, ["diff", "--name-only", item.source.mainBase!, item.source.base]),
  ).toBe("product.txt");
  expect(q.config.initialHistory).toEqual(next.initialHistory);
  expect(item.source.author.rung).toBe(2);
  expect(item.source.reviewer.rung).toBe(0);
  for (const prompt of [item.source.author.prompt, item.source.reviewer.prompt]) {
    expect(prompt).toContain("Accepted brief repair: use fixture mode current");
    expect(prompt).toContain("Use fixture mode legacy.");
    expect(prompt).toContain("Preserve the invariant.");
    expect(prompt).toContain("unchanged requirements and still-applicable findings remain binding");
    expect(prompt).toContain("resolved or superseded");
    expect(prompt).toContain(f.current.config.stateDirectory);
    expect(prompt).toContain(resolve(f.current.config.stateDirectory, "source"));
    expect(prompt).toContain(resolve(f.current.config.stateDirectory, "repair"));
    expect(prompt).not.toContain("Apply these reviewer-prescribed fixes verbatim");
  }
  const advanced = await readFile(path, "utf8");
  expect(JSON.parse(advanced)).toEqual({
    ...old,
    phase: "failed",
    rebasedBase: item.base,
    rebasedMainBase: next.selection.base,
  });
  expect((await f.compose(next)).config).toEqual(q.config);
  expect(await readFile(path, "utf8")).toBe(advanced);
  await persistCycle(f.loop, next);
  const launches: string[] = [];
  const launch = f.native.launch;
  f.native.launch = async (role, config, prompt) => {
    launches.push(role);
    if (role === "author") {
      expect(prompt).toContain("Prior failed attempt fixture-110:2 records");
      expect(prompt).toContain("still-applicable findings");
    }
    const result = await launch(role, config, prompt);
    if (role === "author")
      await writeFile(
        resolve(config.worktree, "product.txt"),
        "mode current; invariant preserved\n",
      );
    return result;
  };
  const observe = f.native.observe;
  let running = true;
  f.native.observe = async (role, config, attempt) => {
    const result = await observe(role, config, attempt);
    if (role === "author") return { ...result, status: running ? "running" : "passed" };
    return {
      ...result,
      status: "passed",
      summary: JSON.stringify({
        run: config.run,
        role,
        head: result.head,
        verdict: "PASS",
        findings: [],
        g0: "No; the accepted brief and invariant both hold.",
      }),
    };
  };
  await expect(queueStep(q.config, q.adapter)).resolves.toMatchObject({
    status: "observing-author",
  });
  const pinPath = resolve(item.source.stateDirectory, "config.json");
  const pin = await readFile(pinPath, "utf8");
  const resumed = await f.compose((await f.advance())!);
  await queueStep(resumed.config, resumed.adapter);
  expect(launches).toEqual(["author"]);
  const context = f.policy.issueContext;
  f.policy.issueContext = async (input) => ({
    ...(await context(input)),
    body: "Later unaccepted prose",
  });
  const drift = await f.compose(next);
  await expect(queueStep(drift.config, drift.adapter)).rejects.toMatchObject({
    reason: "conflicting-run-configuration",
  });
  expect(await readFile(pinPath, "utf8")).toBe(pin);
  f.policy.issueContext = context;
  running = false;
  await expect(queueStep(resumed.config, resumed.adapter)).resolves.toMatchObject({
    status: "complete",
  });
  expect(launches).toEqual(["author", "reviewer"]);
  timing?.phase("proof");
  for (const [file, bytes] of prior)
    if (file !== path) expect(await readFile(file, "utf8"), file).toBe(bytes);
  for (const [file, bytes] of trees) expect(await readFile(file, "utf8"), file).toBe(bytes);
});

it("re-derives repair FAIL after interrupted projection before successor setup", async () => {
  const { f, next } = await unparkedRepairFailure();
  const path = resolve(f.current.config.stateDirectory, "attempt.json");
  const old = JSON.parse(await readFile(path, "utf8"));
  await f.git(f.repository, ["remote", "set-url", "origin", resolve(f.root, "absent.git")]);
  await expect(f.compose(next)).rejects.toMatchObject({ reason: "current-main-unavailable" });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...old, phase: "failed" });
  await f.git(f.repository, ["remote", "set-url", "origin", resolve(f.root, "remote.git")]);
  const q = await f.compose(next);
  expect(q.config.items[0]!.source.author.prompt).toContain(
    "Do not restore a superseded prescription",
  );
  const terminalPath = resolve(f.current.config.stateDirectory, "repair/author-terminal.json");
  const terminal = await readFile(terminalPath, "utf8");
  await rm(terminalPath);
  const ordinary = await f.compose(next);
  expect(ordinary.config.items[0]!.source.author.prompt).toContain(
    "Apply these reviewer-prescribed fixes verbatim",
  );
  expect(ordinary.config.items[0]!.source.author.prompt).not.toContain(
    "Do not restore a superseded prescription",
  );
  await writeFile(terminalPath, terminal);
  expect((await f.compose(next)).config).toEqual(q.config);
});

it.each([0, 1])(
  "admits each successor launch independently with %i remaining slots",
  async (slots) => {
    const { f, next } = await unparkedRepairFailure();
    f.loop.nativeLaunchCeiling = next.initialHistory.length + slots;
    const q = await f.compose(next);
    const calls = f.calls.length;
    await expect(queueStep(q.config, q.adapter)).rejects.toMatchObject({
      reason: "native-launch-ceiling-exhausted",
    });
    expect(f.calls.slice(calls).filter((c) => c.startsWith("launch:"))).toHaveLength(slots);
    expect((await q.adapter.history()).length).toBe(f.loop.nativeLaunchCeiling);
  },
);

it("charges repair candidate 3 and the failed fourth successor to the existing ceiling", async () => {
  const { f, next } = await unparkedRepairFailure();
  f.loop.attemptCeiling = 3;
  await expect(f.compose(next)).rejects.toMatchObject({
    reason: "implementation-attempt-ceiling-exhausted",
  });
  f.loop.attemptCeiling = 4;
  const q = await f.compose(next);
  await expect(queueStep(q.config, q.adapter)).rejects.toMatchObject({
    reason: "implementation-attempt-ceiling-exhausted",
  });
  await expect(f.compose(next)).rejects.toMatchObject({
    reason: "implementation-attempt-ceiling-exhausted",
  });
  expect(
    JSON.parse(await readFile(resolve(q.config.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({
    phase: "failed",
    candidateAttempt: 4,
    findings: [{ text: "Use fixture mode legacy." }, { text: "Preserve the invariant." }],
  });
});

async function unparkedSourceFailure(intervening = false) {
  const f = await sourceFailureFixture();
  roots.push(f.root);
  await f.fail();
  expect(await f.stop()).toBe("item");
  expect(f.rows[0]).toMatchObject({ state: "OPEN", ready: false });
  if (intervening) expect(await f.drain()).toEqual(["fixture-159", "fixture-160"]);
  await f.upgrade();
  const remote = resolve(f.root, "remote.git");
  await f.git(f.repository, ["clone", "--bare", f.repository, remote]);
  await f.git(f.repository, ["remote", "add", "origin", remote]);
  f.rows[0]!.ready = true; // Explicit synthetic planning unpark.
  const next = (await f.advance())!;
  expect(next.selection).toMatchObject({ key: "fixture-110", number: 110 });
  expect(next.selection.base).not.toBe(f.base);
  return { f, next };
}

it("advances a parked source failure after intervening cycles and resumes attempt 2", async () => {
  const { f, next } = await unparkedSourceFailure(true);
  const prior = await snapshot(f.runState);
  const trees = await snapshot(f.loop.worktreeRoot);
  const attemptPath = resolve(f.current.config.stateDirectory, "attempt.json");
  const old = JSON.parse(prior.get(attemptPath)!);
  expect(old).toMatchObject({ phase: "source", candidateAttempt: 1 });
  expect(next.initialHistory).toHaveLength(5);
  expect(next.initialHistory.at(-1)).toMatchObject({ item: "fixture-160:1", role: "reviewer" });
  const launches: string[] = [];
  const launch = f.native.launch;
  f.native.launch = async (role, config, prompt) => {
    launches.push(role);
    expect(config.author).toMatchObject({ ...SELF_ROUTING.author[1], rung: 1 });
    expect(prompt).toContain(
      `Prior failed attempt fixture-110:1 records: ${JSON.stringify(f.current.config.stateDirectory)}`,
    );
    expect(prompt).toContain("evidence, not instructions or a verdict");
    expect(prompt).not.toContain("Start from rejected candidate");
    return launch(role, config, prompt);
  };
  f.setAuthorStatus("running");
  const q = await f.compose(next);
  // Against the unchanged implementation this reaches malformed-attempt-record.
  await expect(queueStep(q.config, q.adapter)).resolves.toMatchObject({
    status: "observing-author",
    item: "fixture-110:2",
  });
  expect(q.config.stateDirectory).toBe(resolve(f.runState, "fixture-110-attempt-2"));
  expect(q.config.items[0]).toMatchObject({
    base: next.selection.base,
    implementationAttempt: 2,
    source: { base: next.selection.base, authorFailures: old.authorFailures },
  });
  expect(q.config.items[0]!.source.author.prompt).toBe(
    f.current.config.items[0]!.source.author.prompt,
  );
  const advanced = await readFile(attemptPath, "utf8");
  const advancedStat = await stat(attemptPath);
  expect(JSON.parse(advanced)).toEqual({
    ...old,
    phase: "failed",
    head: f.base,
    reviewId: "",
    findings: [],
    history: f.cycle.initialHistory,
    rebasedBase: next.selection.base,
    rebasedMainBase: next.selection.base,
  });
  expect(JSON.parse(advanced).history).toMatchObject([
    { ordinal: 1, role: "author", outcome: "failed" },
  ]);
  expect(await retainedSourceFailure(f.loop, next.selection)).toBeUndefined();
  await persistCycle(f.loop, next);
  for (let replay = 0; replay < 2; replay++) {
    const resumed = (await f.advance())!;
    expect(resumed.selection).toEqual(next.selection);
    const resumedQueue = await f.compose(resumed);
    await expect(queueStep(resumedQueue.config, resumedQueue.adapter)).resolves.toMatchObject({
      status: "observing-author",
      item: "fixture-110:2",
    });
    expect(await readFile(attemptPath, "utf8")).toBe(advanced);
    expect((await stat(attemptPath)).mtimeMs).toBe(advancedStat.mtimeMs);
  }
  expect(launches).toEqual(["author"]);
  expect(f.calls.filter((call) => call === "park:110")).toHaveLength(1);
  for (const [path, bytes] of prior)
    if (path !== attemptPath) expect(await readFile(path, "utf8"), path).toBe(bytes);
  for (const [path, bytes] of trees) expect(await readFile(path, "utf8"), path).toBe(bytes);
});

it.each([
  "in-flight author",
  "PASS terminal",
  "wrong terminal head",
  "wrong terminal identity",
  "wrong pinned base",
  "wrong pinned run",
  "wrong pinned issue",
  "wrong pinned repository",
  "wrong pinned directory",
  "accepted stage",
  "different run",
])("does not advance a retained source failure with %s", async (control) => {
  const { f, next } = await unparkedSourceFailure();
  const directory = f.current.config.stateDirectory;
  const terminalPath = resolve(directory, "source/author-terminal.json");
  const attemptPath = resolve(directory, "attempt.json");
  const configPath = resolve(directory, "source/config.json");
  const terminal = JSON.parse(await readFile(terminalPath, "utf8"));
  const attempt = JSON.parse(await readFile(attemptPath, "utf8"));
  const pinned = JSON.parse(await readFile(configPath, "utf8"));
  switch (control) {
    case "in-flight author":
      await rm(terminalPath);
      break;
    case "PASS terminal":
      terminal.status = "passed";
      break;
    case "wrong terminal head":
      terminal.head = next.selection.base;
      break;
    case "wrong terminal identity":
      terminal.id = "synthetic-unrelated-author";
      break;
    case "wrong pinned base":
      pinned.config.base = next.selection.base;
      break;
    case "wrong pinned run":
      pinned.config.run = "synthetic-other-run";
      break;
    case "wrong pinned issue":
      pinned.config.issue = "https://github.com/fixture/repository/issues/999";
      break;
    case "wrong pinned repository":
      pinned.config.repository = "fixture/other";
      break;
    case "wrong pinned directory":
      pinned.config.stateDirectory = resolve(directory, "unrelated-source");
      break;
    case "accepted stage":
      attempt.acceptedStage = "source";
      break;
    case "different run":
      attempt.run = "synthetic-other-run";
      break;
  }
  if (control !== "in-flight author") await writeFile(terminalPath, JSON.stringify(terminal));
  await writeFile(attemptPath, JSON.stringify(attempt));
  await writeFile(configPath, JSON.stringify(pinned));
  const prior = await snapshot(f.runState);
  const trees = await snapshot(f.loop.worktreeRoot);
  expect(await retainedSourceFailure(f.loop, next.selection)).toBeUndefined();
  const q = await f.compose(next);
  expect(q.config.stateDirectory).toBe(directory);
  expect(q.config.items[0]!.implementationAttempt).toBe(1);
  await expect(queueStep(q.config, q.adapter)).rejects.toMatchObject({
    reason: "malformed-attempt-record",
  });
  expect(await snapshot(f.runState)).toEqual(prior);
  expect(await snapshot(f.loop.worktreeRoot)).toEqual(trees);
});

it("resumes an interruption after source failure advancement and before attempt 2 setup", async () => {
  const { f, next } = await unparkedSourceFailure();
  const attemptPath = resolve(f.current.config.stateDirectory, "attempt.json");
  const before = JSON.parse(await readFile(attemptPath, "utf8"));
  const prior = await snapshot(f.runState);
  const trees = await snapshot(f.loop.worktreeRoot);
  // Fail the existing current-main observation, after the failed receipt is written.
  await f.git(f.repository, ["remote", "set-url", "origin", resolve(f.root, "absent.git")]);
  await expect(f.compose(next)).rejects.toMatchObject({ reason: "current-main-unavailable" });
  const advanced = {
    ...before,
    phase: "failed",
    head: f.base,
    reviewId: "",
    findings: [],
    history: f.cycle.initialHistory,
  };
  expect(JSON.parse(await readFile(attemptPath, "utf8"))).toEqual(advanced);
  expect(await retainedSourceFailure(f.loop, next.selection)).toBeUndefined();
  await f.git(f.repository, ["remote", "set-url", "origin", resolve(f.root, "remote.git")]);
  await persistCycle(f.loop, next);
  expect((await f.advance())!.selection).toEqual(next.selection);
  const q = await f.compose(next);
  expect(q.config.items[0]).toMatchObject({ id: "fixture-110:2", base: next.selection.base });
  const rebased = await readFile(attemptPath, "utf8");
  expect(JSON.parse(rebased)).toEqual({
    ...advanced,
    rebasedBase: next.selection.base,
    rebasedMainBase: next.selection.base,
  });
  const timestamp = (await stat(attemptPath)).mtimeMs;
  expect((await f.compose(next)).config).toEqual(q.config);
  expect(await readFile(attemptPath, "utf8")).toBe(rebased);
  expect((await stat(attemptPath)).mtimeMs).toBe(timestamp);
  for (const [path, bytes] of prior)
    if (path !== attemptPath) expect(await readFile(path, "utf8"), path).toBe(bytes);
  expect(await snapshot(f.loop.worktreeRoot)).toEqual(trees);
  expect(f.calls.filter((call) => call.startsWith("launch:"))).toHaveLength(1);
});

it("charges a parked source failure against the implementation ceiling", async () => {
  const { f, next } = await unparkedSourceFailure();
  f.loop.attemptCeiling = 1;
  for (let replay = 0; replay < 2; replay++)
    await expect(f.compose(next)).rejects.toMatchObject({
      reason: "implementation-attempt-ceiling-exhausted",
    });
  expect(
    JSON.parse(await readFile(resolve(f.current.config.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({
    phase: "failed",
    candidateAttempt: 1,
    authorFailures: { count: 1 },
    head: f.base,
    reviewId: "",
  });
  await expect(stat(resolve(f.runState, "fixture-110-attempt-2"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(f.calls.filter((call) => call.startsWith("launch:"))).toHaveLength(1);
});

// ISS-195: a real native source pair, then a real delivery refresh whose DELTA reviewer
// FAILs at one of the three refresh origins, parked through ordinary supervision.
async function refreshFailureFixture(origin: "ordinary" | "continuation" | "correction") {
  const f = await loopFixture();
  const git = async (tree: string, args: string[]) =>
    (await execute(f.gitExecutable, ["-C", tree, ...args])).stdout.trim();
  const remote = resolve(f.repository, "..", "remote.git");
  await execute(f.gitExecutable, ["clone", "--bare", f.repository, remote]);
  await git(f.repository, ["remote", "add", "origin", remote]);
  // Main moves through a separate clone; the executor checkout only advances between cycles.
  const updater = resolve(f.repository, "..", "updater");
  await execute(f.gitExecutable, ["clone", remote, updater]);
  await appendFile(
    resolve(updater, ".git/config"),
    "[user]\n\tname = Fixture\n\temail = fixture@example.test\n",
  );
  const advanceMain = async (name: string) => {
    await git(updater, ["fetch", "origin"]);
    await git(updater, ["merge", "--ff-only", "origin/main"]);
    await writeFile(resolve(updater, name), `${name}\n`);
    await git(updater, ["add", name]);
    await git(updater, ["commit", "-m", name]);
    await git(updater, ["push", "origin", "main"]);
    return git(updater, ["rev-parse", "HEAD"]);
  };
  const advanceExecutor = async (name: string) => {
    const head = await advanceMain(name);
    await git(f.repository, ["fetch", "origin"]);
    await git(f.repository, ["merge", "--ff-only", "origin/main"]);
    return head;
  };
  const row = { ready: true, comments: [] as string[] };
  const calls: string[] = [];
  const policy: RepositoryAdapter = {
    ...repositoryPolicy,
    selectCandidates: () => (row.ready ? [{ key: f.selected.key, number: f.selected.number }] : []),
    issueContext: async (input) => ({
      ...(await repositoryPolicy.issueContext(input)),
      routing: { row: "self" },
    }),
    park: ({ number }) => {
      calls.push(`park:${number}`);
      row.ready = false;
      return "restore planning readiness after acting on the findings";
    },
  };
  const host: SupervisionAdapter = {
    currentMain: () => git(f.repository, ["rev-parse", "HEAD"]),
    async issue() {
      return {
        state: "OPEN",
        key: f.selected.key,
        labels: row.ready ? ["ready"] : [],
        comments: [...row.comments],
      };
    },
    async removeReady() {
      row.ready = false;
    },
    async close() {
      throw new Error("no completion in the refresh failure fixture");
    },
    async comment(_config, _number, body) {
      row.comments.push(body);
    },
  };
  const findings = [
    { file: "feature.txt", line: 1, severity: "blocking", text: "Delete the superseded line." },
  ];
  const launches: { role: string; directory: string; prompt: string; rung: number | undefined }[] =
    [];
  const native: Adapter = {
    async preflight() {},
    git,
    async launch(role, config, prompt) {
      launches.push({ role, directory: config.stateDirectory, prompt, rung: config[role].rung });
      if (role === "author" && /attempt-1[\\/]source$/.test(config.stateDirectory))
        await writeFile(resolve(config.worktree, "feature.txt"), "reviewed feature\n");
      if (role === "author" && /gate-correction$/.test(config.stateDirectory))
        await writeFile(resolve(config.worktree, "feature.txt"), "corrected feature\n");
      const trace = resolve(config.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, "synthetic native worker execution\n");
      return { id: randomUUID(), pid: 111, trace, launchedAt: 1 };
    },
    async observe(role, config, attempt) {
      if (role === "author")
        return /attempt-2[\\/]source$/.test(config.stateDirectory)
          ? { id: attempt.id, status: "running" }
          : { id: attempt.id, status: "passed", head: config.base };
      const head = await git(config.worktree, ["rev-parse", "HEAD"]);
      const fail = /[\\/]refresh-[0-9a-f]{40}$/.test(config.stateDirectory);
      return {
        id: attempt.id,
        status: fail ? "failed" : "passed",
        head,
        summary: JSON.stringify({
          run: config.run,
          role,
          head,
          verdict: fail ? "FAIL" : "PASS",
          findings: fail ? findings : [],
          g0: "Fixture delta review",
        }),
      };
    },
    async checks() {
      throw new Error("no hosted observation before publication");
    },
  };
  const delivery = githubDeliveryAdapter();
  delivery.verifyWorkspace = async (config, head) =>
    (await git(config.worktree, ["rev-parse", "HEAD"])) === head &&
    (await git(config.worktree, ["status", "--porcelain"])) === "";
  let gateFailed = false;
  delivery.runGate = async (config, _name, head) => {
    if (origin === "ordinary" || gateFailed) return "passed";
    gateFailed = true;
    if (origin === "continuation") return "failed";
    return {
      status: "failed",
      output: "attributed assertion",
      evidence: {
        head,
        log: resolve(config.stateDirectory, "candidate.log"),
        cause: "diagnostic",
        diagnostics: ["feature.txt:1: failed assertion"],
        command: { executable: process.execPath, argv: ["fixture"], cwd: config.worktree },
      },
    };
  };
  delivery.attributeGate = async (_config, _name, _evidence, main) => ({
    cause: "candidate",
    main,
    log: resolve(f.stateRoot, "base-control.log"),
  });
  const loop: LoopConfig = f.loop;
  const compose = (cycle: SupervisedCycle) => {
    const { key, number, base, planningRevision } = cycle.selection;
    return queueConfigFromLoop(
      loop,
      f.repository,
      { key, number, base, ...(planningRevision === undefined ? {} : { planningRevision }) },
      policy,
      cycle.initialHistory,
    );
  };
  const adapter = (config: QueueConfig) =>
    repositoryQueueAdapter(config, f.repository, {
      native,
      delivery,
      gitExecutable: f.gitExecutable,
      async assertExecutor() {},
      setup: gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, tree) {
          await mkdir(resolve(tree, "node_modules"), { recursive: true });
          await writeFile(resolve(tree, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
      deliveryPolicy: {
        async plan(current) {
          return {
            gates: { beforeMirror: ["test"], afterMirror: [] },
            drafts: [],
            publication: {
              sourceBranch: "codex/iss-104",
              baseBranch: "main",
              title: "fixture",
              body: "fixture",
              draft: true,
            },
            cleanup: {
              worktrees: [current.worktree, current.reviewWorktree],
              branch: current.localBranch!,
            },
            mergePolicy: {},
          };
        },
      },
    });
  let cycle = (await nextCycle(loop, f.repository, host, policy))!;
  await persistCycle(loop, cycle);
  await startCycle(loop, cycle, host);
  let q = await compose(cycle);
  const attemptDirectory = q.stateDirectory;
  const runState = resolve(attemptDirectory, "..");
  const sourceDirectory = resolve(attemptDirectory, "source");
  await expect(
    queueStep(q, {
      ...adapter(q),
      async delivery() {
        throw new Error("fresh delivery reached");
      },
    }),
  ).rejects.toThrow("fresh delivery reached");
  const candidateHead = JSON.parse(
    await readFile(resolve(sourceDirectory, "candidate.json"), "utf8"),
  ).head as string;
  let refreshOrigin = sourceDirectory;
  if (origin === "ordinary") {
    await advanceMain("main.txt");
    await expect(queueStep(q, adapter(q))).rejects.toMatchObject({
      reason: "refresh-review-failed",
    });
  } else if (origin === "correction") {
    await expect(queueStep(q, adapter(q))).resolves.toMatchObject({ status: "observing-author" });
    await advanceMain("main.txt");
    await expect(queueStep(q, adapter(q))).rejects.toMatchObject({
      reason: "refresh-review-failed",
    });
    refreshOrigin = resolve(sourceDirectory, "gate-correction");
  } else {
    await expect(queueStep(q, adapter(q))).rejects.toMatchObject({
      reason: "gate-attribution-unknown:test",
    });
    cycle.initialHistory = await adapter(q).history();
    expect(await stopCycle(loop, cycle, "gate-attribution-unknown:test", 1, host, policy)).toBe(
      "run",
    );
    const repairSha = await advanceMain("landed-repair.txt");
    loop.gateStopAuthorization = {
      stateDirectory: sourceDirectory,
      candidateHead,
      repairSha,
      authorityUrl: "https://github.com/fixture/repository/issues/361#issuecomment-5748812816",
    };
    cycle = (await nextCycle(loop, f.repository, host, policy))!;
    expect(cycle.selection.cycle).toBe(1);
    await expect(reconcilePendingStop(loop, cycle, host, policy)).resolves.toBeUndefined();
    q = await compose(cycle);
    await expect(queueStep(q, adapter(q))).rejects.toMatchObject({
      reason: "refresh-review-failed",
    });
    refreshOrigin = resolve(sourceDirectory, "gate-stop-continuation");
    expect(
      JSON.parse(await readFile(resolve(refreshOrigin, "gate-stop.json"), "utf8")),
    ).toMatchObject({ reason: "refresh-review-failed" });
  }
  cycle.initialHistory = await adapter(q).history();
  expect(await stopCycle(loop, cycle, "refresh-review-failed", 1, host, policy)).toBe("item");
  expect(calls).toEqual([`park:${f.selected.number}`]);
  const refresh = JSON.parse(await readFile(resolve(refreshOrigin, "native-refresh.json"), "utf8"));
  const reviewer = JSON.parse(
    await readFile(resolve(refresh.directory, "reviewer-attempt.json"), "utf8"),
  );
  expect(
    JSON.parse(await readFile(resolve(refresh.directory, "reviewer-terminal.json"), "utf8")),
  ).toMatchObject({ id: reviewer.id, status: "failed", head: refresh.head });
  const moved = await advanceExecutor("later-main.txt");
  row.ready = true; // Explicit synthetic planning unpark.
  const next = (await nextCycle(loop, f.repository, host, policy))!;
  expect(next.selection).toMatchObject({ cycle: 2, key: f.selected.key, base: moved });
  return {
    ...f,
    loop,
    git,
    host,
    policy,
    row,
    calls,
    launches,
    findings,
    compose,
    adapter,
    advanceMain,
    runState,
    attemptDirectory,
    sourceDirectory,
    refreshOrigin,
    candidateHead,
    refresh: { ...refresh, reviewerId: reviewer.id as string },
    moved,
    next,
  };
}

it.each(["ordinary", "continuation", "correction"] as const)(
  "advances a parked %s-origin refresh-review failure to attempt 2 at the reviewed head",
  async (origin) => {
    const f = await refreshFailureFixture(origin);
    const attemptPath = resolve(f.attemptDirectory, "attempt.json");
    const prior = await snapshot(f.runState);
    const trees = await snapshot(f.loop.worktreeRoot);
    const old = JSON.parse(prior.get(attemptPath)!);
    expect(old).toMatchObject({
      phase: "delivery",
      candidateAttempt: 1,
      head: f.candidateHead,
      acceptedStage: "source",
      stateDirectory: f.sourceDirectory,
    });
    expect(old.authorFailures.count).toBe(origin === "correction" ? 2 : 1);
    expect(f.next.initialHistory).toHaveLength(origin === "correction" ? 5 : 3);
    expect(f.next.initialHistory.at(-1)).toMatchObject({
      id: f.refresh.reviewerId,
      item: "ISS-104:1",
      stage: "refresh",
      role: "reviewer",
      outcome: "failed",
    });
    // Against the unchanged implementation this reaches malformed-attempt-record.
    const q = await f.compose(f.next);
    const item = q.items[0]!;
    expect(q.stateDirectory).toBe(resolve(f.runState, "iss-104-attempt-2"));
    expect(item).toMatchObject({
      id: "ISS-104:2",
      implementationAttempt: 2,
      source: { mainBase: f.moved, authorFailures: old.authorFailures },
    });
    const rung = Math.min(old.authorFailures.count, SELF_ROUTING.author.length - 1);
    expect(item.source.author).toMatchObject({ ...SELF_ROUTING.author[rung], rung });
    expect(item.source.reviewer).toMatchObject({ ...SELF_ROUTING.reviewer[0], rung: 0 });
    expect(item.base).not.toBe(f.refresh.head);
    expect(await f.git(f.repository, ["merge-base", f.moved, item.base])).toBe(f.moved);
    expect(await f.git(f.repository, ["diff", "--name-only", f.moved, item.base])).toBe(
      "feature.txt",
    );
    expect(await f.git(f.repository, ["diff", f.moved, item.base, "--", "feature.txt"])).toBe(
      await f.git(f.repository, ["diff", f.refresh.main, f.refresh.head, "--", "feature.txt"]),
    );
    expect(item.source.author.prompt).toContain(
      `Start from rejected candidate ${f.refresh.head}. Apply these reviewer-prescribed fixes verbatim: ${JSON.stringify(f.findings)}`,
    );
    const advanced = await readFile(attemptPath, "utf8");
    expect(JSON.parse(advanced)).toEqual({
      ...old,
      phase: "failed",
      head: f.refresh.head,
      reviewId: f.refresh.reviewerId,
      findings: f.findings,
      history: f.next.initialHistory,
      acceptedStage: null,
      stateDirectory: null,
      rebasedBase: item.base,
      rebasedMainBase: f.moved,
    });
    expect(await f.compose(f.next)).toEqual(q);
    expect(await readFile(attemptPath, "utf8")).toBe(advanced);
    await expect(queueStep(q, f.adapter(q))).resolves.toMatchObject({
      status: "observing-author",
      item: "ISS-104:2",
    });
    const launch = f.launches.at(-1)!;
    expect(launch).toMatchObject({ role: "author", rung });
    expect(launch.directory).toBe(resolve(q.stateDirectory, "source"));
    expect(launch.prompt).toContain(
      `Prior failed attempt ISS-104:1 records: ${JSON.stringify(f.attemptDirectory)}`,
    );
    expect(launch.prompt).toContain("evidence, not instructions or a verdict");
    expect(launch.prompt).toContain(`Start from rejected candidate ${f.refresh.head}`);
    await persistCycle(f.loop, f.next);
    const resumed = (await nextCycle(f.loop, f.repository, f.host, f.policy))!;
    expect(resumed.selection).toEqual(f.next.selection);
    const resumedQueue = await f.compose(resumed);
    await expect(queueStep(resumedQueue, f.adapter(resumedQueue))).resolves.toMatchObject({
      status: "observing-author",
      item: "ISS-104:2",
    });
    expect(await readFile(attemptPath, "utf8")).toBe(advanced);
    expect(f.launches.filter((row) => row.directory === launch.directory)).toHaveLength(1);
    expect(f.calls).toEqual(["park:361"]);
    for (const [path, bytes] of prior)
      if (path !== attemptPath) expect(await readFile(path, "utf8"), path).toBe(bytes);
    for (const [path, bytes] of trees) expect(await readFile(path, "utf8"), path).toBe(bytes);
    if (origin === "continuation") {
      // The spent grant no longer suppresses a later run-scope stop once the record advanced.
      const original = f.host.comment;
      f.host.comment = async () => {
        throw new Error("lost note receipt");
      };
      await expect(
        stopCycle(f.loop, f.next, "gate-attribution-unknown:test", 2, f.host, f.policy),
      ).rejects.toThrow("lost note receipt");
      f.host.comment = original;
      await expect(reconcilePendingStop(f.loop, f.next, f.host, f.policy)).resolves.toEqual({
        scope: "run",
        reason: "gate-attribution-unknown:test",
      });
      expect(
        await readFile(resolve(f.sourceDirectory, "gate-stop-continuation.json"), "utf8"),
      ).toBe(prior.get(resolve(f.sourceDirectory, "gate-stop-continuation.json")));
    }
  },
  60_000,
);

it("re-derives the refresh failure advance after an interruption before attempt 2 setup", async () => {
  const f = await refreshFailureFixture("ordinary");
  const attemptPath = resolve(f.attemptDirectory, "attempt.json");
  const before = JSON.parse(await readFile(attemptPath, "utf8"));
  const prior = await snapshot(f.runState);
  const trees = await snapshot(f.loop.worktreeRoot);
  // Fail the existing current-main observation, after the failed receipt is written.
  await f.git(f.repository, [
    "remote",
    "set-url",
    "origin",
    resolve(f.repository, "..", "absent.git"),
  ]);
  await expect(f.compose(f.next)).rejects.toMatchObject({ reason: "current-main-unavailable" });
  const advanced = {
    ...before,
    phase: "failed",
    head: f.refresh.head,
    reviewId: f.refresh.reviewerId,
    findings: f.findings,
    history: f.next.initialHistory,
    acceptedStage: null,
    stateDirectory: null,
  };
  expect(JSON.parse(await readFile(attemptPath, "utf8"))).toEqual(advanced);
  expect(await retainedSourceFailure(f.loop, f.next.selection)).toBeUndefined();
  await f.git(f.repository, [
    "remote",
    "set-url",
    "origin",
    resolve(f.repository, "..", "remote.git"),
  ]);
  await persistCycle(f.loop, f.next);
  expect((await nextCycle(f.loop, f.repository, f.host, f.policy))!.selection).toEqual(
    f.next.selection,
  );
  const q = await f.compose(f.next);
  expect(q.items[0]).toMatchObject({ id: "ISS-104:2", source: { mainBase: f.moved } });
  const rebased = await readFile(attemptPath, "utf8");
  expect(JSON.parse(rebased)).toEqual({
    ...advanced,
    rebasedBase: q.items[0]!.base,
    rebasedMainBase: f.moved,
  });
  const timestamp = (await stat(attemptPath)).mtimeMs;
  expect(await f.compose(f.next)).toEqual(q);
  expect(await readFile(attemptPath, "utf8")).toBe(rebased);
  expect((await stat(attemptPath)).mtimeMs).toBe(timestamp);
  for (const [path, bytes] of prior)
    if (path !== attemptPath) expect(await readFile(path, "utf8"), path).toBe(bytes);
  expect(await snapshot(f.loop.worktreeRoot)).toEqual(trees);
}, 60_000);

it("charges a parked refresh-review failure against the implementation ceiling", async () => {
  const f = await refreshFailureFixture("ordinary");
  f.loop.attemptCeiling = 1;
  for (let replay = 0; replay < 2; replay++)
    await expect(f.compose(f.next)).rejects.toMatchObject({
      reason: "implementation-attempt-ceiling-exhausted",
    });
  expect(
    JSON.parse(await readFile(resolve(f.attemptDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({
    phase: "failed",
    candidateAttempt: 1,
    head: f.refresh.head,
    reviewId: f.refresh.reviewerId,
    findings: f.findings,
    authorFailures: { count: 1 },
  });
  await expect(stat(resolve(f.runState, "iss-104-attempt-2"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(f.launches.map((row) => row.role)).toEqual(["author", "reviewer", "reviewer"]);
}, 60_000);

it.each([
  "in-flight reviewer",
  "PASS terminal",
  "PASS verdict",
  "wrong terminal head",
  "wrong terminal identity",
  "excluded conflict-resolution shape",
  "stale origin gate-stop",
  "foreign-run stop",
  "other-key stop",
  "other-attempts stop",
  "missing stop completion",
  "prerequisite-scope stop",
  "wrong pinned run",
  "wrong pinned issue",
  "wrong pinned base",
  "wrong pinned directory",
  "publication at accepted stage",
  "publication-intent at refresh directory",
  "setup phase",
  "source phase",
  "repair phase",
  "complete phase",
])(
  "does not advance a retained refresh-review failure with %s",
  async (control) => {
    const f = await refreshFailureFixture("ordinary");
    const attemptPath = resolve(f.attemptDirectory, "attempt.json");
    const refreshPath = resolve(f.refreshOrigin, "native-refresh.json");
    const terminalPath = resolve(f.refresh.directory, "reviewer-terminal.json");
    const stopPath = resolve(f.runState, "cycle-1-stop-1.json");
    const configPath = resolve(f.sourceDirectory, "config.json");
    const edit = async (path: string, mutate: (value: any) => void) => {
      const value = JSON.parse(await readFile(path, "utf8"));
      mutate(value);
      await writeFile(path, JSON.stringify(value));
    };
    const summary = (verdict: string) =>
      JSON.stringify({
        run: f.loop.run,
        role: "reviewer",
        head: f.refresh.head,
        verdict,
        findings: verdict === "PASS" ? [] : f.findings,
        g0: "Fixture delta review",
      });
    switch (control) {
      case "in-flight reviewer":
        await rm(terminalPath);
        break;
      case "PASS terminal":
        await edit(terminalPath, (t) => {
          t.status = "passed";
          t.summary = summary("PASS");
        });
        break;
      case "PASS verdict":
        await edit(terminalPath, (t) => {
          t.summary = summary("PASS");
        });
        break;
      case "wrong terminal head":
        await edit(terminalPath, (t) => {
          t.head = f.candidateHead;
        });
        break;
      case "wrong terminal identity":
        await edit(terminalPath, (t) => {
          t.id = "synthetic-other-reviewer";
        });
        await edit(resolve(f.refresh.directory, "reviewer-attempt.json"), (a) => {
          a.id = "synthetic-other-reviewer";
        });
        break;
      case "excluded conflict-resolution shape":
        await edit(refreshPath, (r) => {
          delete r.head;
          r.resolutionUsed = true;
          r.conflict = { seed: f.candidateHead, files: {} };
        });
        break;
      case "stale origin gate-stop":
        await writeFile(
          resolve(f.refreshOrigin, "gate-stop.json"),
          JSON.stringify({ reason: "gate-host-failed:test" }),
        );
        break;
      case "foreign-run stop":
        await edit(stopPath, (s) => {
          s.marker = "loop-stop:synthetic-other-run:1:1";
        });
        break;
      case "other-key stop":
        await edit(stopPath, (s) => {
          s.selection.key = "ISS-999";
        });
        break;
      case "other-attempts stop":
        await edit(stopPath, (s) => {
          s.attempts = 2;
        });
        break;
      case "missing stop completion":
        await rm(resolve(f.runState, "cycle-1-stop-1-complete.json"));
        break;
      case "prerequisite-scope stop":
        await mkdir(resolve(f.runState, "prerequisite"));
        for (const name of ["cycle-1-stop-1.json", "cycle-1-stop-1-complete.json"]) {
          await writeFile(
            resolve(f.runState, "prerequisite", name),
            await readFile(resolve(f.runState, name), "utf8"),
          );
          await rm(resolve(f.runState, name));
        }
        break;
      case "wrong pinned run":
        await edit(configPath, (c) => {
          c.config.run = "synthetic-other-run";
        });
        break;
      case "wrong pinned issue":
        await edit(configPath, (c) => {
          c.config.issue = "https://github.com/fixture/repository/issues/999";
        });
        break;
      case "wrong pinned base":
        await edit(configPath, (c) => {
          c.config.base = f.next.selection.base;
        });
        break;
      case "wrong pinned directory":
        await edit(configPath, (c) => {
          c.config.stateDirectory = resolve(f.attemptDirectory, "unrelated-source");
        });
        break;
      case "publication at accepted stage":
        await writeFile(
          resolve(f.sourceDirectory, "publication.json"),
          JSON.stringify({
            number: 1,
            url: "https://github.com/fixture/repository/pull/1",
            head: f.candidateHead,
          }),
        );
        break;
      case "publication-intent at refresh directory":
        await writeFile(
          resolve(f.refresh.directory, "publication-intent.json"),
          JSON.stringify({ target: "absent" }),
        );
        break;
      default:
        await edit(attemptPath, (a) => {
          a.phase = control.replace(" phase", "");
        });
    }
    const prior = await snapshot(f.runState);
    const trees = await snapshot(f.loop.worktreeRoot);
    const q = await f.compose(f.next);
    expect(q.items[0]!.implementationAttempt).toBe(1);
    await expect(queueStep(q, f.adapter(q))).rejects.toMatchObject({
      reason: "malformed-attempt-record",
    });
    expect(await retainedSourceFailure(f.loop, f.next.selection)).toBeUndefined();
    expect(await snapshot(f.runState)).toEqual(prior);
    expect(await snapshot(f.loop.worktreeRoot)).toEqual(trees);
    expect(f.launches.map((row) => row.role)).toEqual(["author", "reviewer", "reviewer"]);
  },
  60_000,
);

it("refuses a stale continuation gate-stop and advances once it is the recorded refresh stop", async () => {
  const f = await refreshFailureFixture("continuation");
  const attemptPath = resolve(f.attemptDirectory, "attempt.json");
  const stopPath = resolve(f.refreshOrigin, "gate-stop.json");
  const recorded = await readFile(stopPath, "utf8");
  await writeFile(stopPath, JSON.stringify({ reason: "gate-correction-exhausted:test" }));
  const prior = await snapshot(f.runState);
  const q = await f.compose(f.next);
  expect(q.items[0]!.implementationAttempt).toBe(1);
  await expect(queueStep(q, f.adapter(q))).rejects.toMatchObject({
    reason: "malformed-attempt-record",
  });
  expect(await snapshot(f.runState)).toEqual(prior);
  await writeFile(stopPath, recorded);
  const advanced = await f.compose(f.next);
  expect(advanced.items[0]).toMatchObject({ id: "ISS-104:2", source: { mainBase: f.moved } });
  expect(JSON.parse(await readFile(attemptPath, "utf8"))).toMatchObject({
    phase: "failed",
    head: f.refresh.head,
    reviewId: f.refresh.reviewerId,
    findings: f.findings,
  });
  for (const [path, bytes] of prior)
    if (path !== attemptPath && path !== stopPath)
      expect(await readFile(path, "utf8"), path).toBe(bytes);
}, 60_000);

const roots: string[] = [];
const repositoryPolicy: RepositoryAdapter = {
  selectCandidates: () => [],
  issueContext: async ({ key, executorRoot }) => {
    const body = await readFile(resolve(executorRoot, `planning/drafts/${key}.md`), "utf8");
    const section = /\n## Done when\s*\n([\s\S]*?)(?=\n## |$)/.exec(body)?.[1]?.trim() ?? body;
    return {
      title: /^title:\s*"([^"]+)"\s*$/m.exec(body)?.[1] ?? key,
      body,
      acceptanceCriteria: [section],
      rules: await readFile(resolve(executorRoot, "docs/loop.md"), "utf8"),
    };
  },
  branchName: ({ key, attempt }) =>
    `codex/${key.toLowerCase()}${attempt === 1 ? "" : `-attempt-${attempt}`}`,
  pullRequest: async () => {
    throw new Error("unused pullRequest");
  },
  requiredChecks: () => [
    "Node 24 / ubuntu-latest",
    "Node 24 / windows-latest",
    "Node 24 / macos-latest",
  ],
  park: () => "add the `ready` label after acting on the note",
  mergeMethod: () => ({ method: "squash" }),
  afterMerge: () => {},
};
const execute = promisify(execFile);
let fixtureGit: Promise<string> | undefined;
const unavailable = { status: "unavailable" as const };
const usage = (input: number, output: number) => ({
  inputTokens: { status: "known" as const, value: input },
  outputTokens: { status: "known" as const, value: output },
  costUsd: unavailable,
});

it.each(
  [499, 500, 501].flatMap((length) => ["native", "windows"].map((style) => ({ length, style }))),
)(
  "forwards a $length-character $style setup path intact or uses the supervisor's run-state anchor",
  async ({ length, style }) => {
    const f = await loopFixture();
    const q = await queueConfigFromLoop(f.loop, f.repository, f.selected, repositoryPolicy);
    const prefix = style === "windows" ? "C:\\synthetic\\setup\\" : resolve(f.stateRoot) + "/";
    const diagnostics = (prefix + "x".repeat(length)).slice(0, length);
    const adapter: QueueAdapter = {
      async assertExecutor() {},
      async history() {
        return [];
      },
      async setup() {
        return { status: "incomplete", reason: "dependency-install-failed", diagnostics };
      },
      async source() {
        throw new Error("no worker on setup failure");
      },
      async repair() {
        throw new Error("no repair on setup failure");
      },
      async delivery() {
        throw new Error("no delivery on setup failure");
      },
    };
    let failure: QueueBlocked | undefined;
    try {
      await queueStep(q, adapter);
    } catch (error) {
      failure = error as QueueBlocked;
    }
    expect(failure).toMatchObject({ reason: "dependency-install-failed" });
    expect(failure!.diagnostics).toBe(length <= 500 ? diagnostics : undefined);
    const comments: string[] = [];
    const supervisor: SupervisionAdapter = {
      async currentMain() {
        return f.selected.base;
      },
      async issue() {
        return { state: "OPEN", key: f.selected.key, labels: ["ready"], comments };
      },
      async comment(_config, _number, body) {
        comments.push(body);
      },
      async removeReady() {
        throw new Error("no parking");
      },
      async close() {
        throw new Error("no closure");
      },
    };
    await stopCycle(
      f.loop,
      { selection: { cycle: 1, ...f.selected }, initialHistory: [] },
      failure!.reason,
      1,
      supervisor,
      repositoryPolicy,
      failure!.diagnostics,
    );
    // Stop notes JSON-quote diagnostics, including Windows path separators.
    if (length <= 500) expect(comments[0]).toContain(`Diagnostic: ${JSON.stringify(diagnostics)}.`);
    else {
      expect(comments[0]).not.toContain(" Diagnostic:");
      expect(comments[0]).toContain(resolve(f.loop.stateRoot, f.loop.run));
    }
  },
);

function participant(
  ordinal: number,
  item: string,
  stage: QueueParticipant["stage"],
  role: "author" | "reviewer",
  outcome: QueueParticipant["outcome"],
): QueueParticipant {
  return {
    ordinal,
    id: `${item}-${stage}-${role}`,
    item,
    stage,
    role,
    outcome,
    usage: usage(ordinal, 1),
  };
}

function deliveryCompletion(
  item: QueueItem,
  head: string,
  reviewId: string,
  number = 1,
  branch = `codex/${item.id}`,
): Extract<QueueDeliveryResult, { status: "complete" }> {
  return {
    status: "complete",
    run: item.source.run,
    issue: item.issue,
    head,
    reviewId,
    publication: {
      number,
      url: item.delivery.refresh?.url ?? `https://example.test/pull/${number}`,
    },
    checks: item.delivery.requiredChecks.map((name) => ({
      name,
      bucket: "pass",
      link: `https://example.test/check/${name}`,
    })),
    mergeCommit: "d".repeat(40),
    cleanup: { status: "confirmed", branch },
    retries: 0,
  };
}

async function fixture(itemCount = 1) {
  const root = await mkdtemp(resolve(tmpdir(), "bounded-queue-fixture-"));
  roots.push(root);
  const stateDirectory = resolve(root, "queue");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(stateDirectory));
  const items = Array.from({ length: itemCount }, (_, index) => {
    const id = `synthetic-${index + 1}`;
    const base = String(index + 1).repeat(40);
    const run = `synthetic-item-run-${index + 1}`;
    const requiredChecks = ["linux", "windows", "macos"];
    const controller = "synthetic-controller";
    const controllerRoot = resolve(root, "controller");
    const sourceWorktree = resolve(root, `${id}-source-worktree`);
    const reviewWorktree = resolve(root, `${id}-review-worktree`);
    return {
      id,
      issue: `fixture-${index + 1}`,
      base,
      implementationAttempt: index + 1,
      implementationAttemptCeiling: 4,
      setup: {
        controller,
        run,
        issue: `fixture-${index + 1}`,
        repository: "fixture/repository",
        repositoryRoot: controllerRoot,
        controllerRoot,
        controllerRevision: "a".repeat(40),
        pilotRevision: "a".repeat(40),
        base,
        baseBranch: "main",
        sourceBranch: `codex/${id}`,
        pilotWorktree: resolve(root, `${id}-pilot`),
        sourceWorktree,
        reviewWorktree,
        stateDirectory: resolve(root, `${id}-setup`),
      },
      source: {
        owner: controller,
        run,
        issue: `fixture-${index + 1}`,
        pilotRevision: "a".repeat(40),
        base,
        worktree: sourceWorktree,
        reviewWorktree,
        stateDirectory: resolve(root, `${id}-source`),
        allowedPaths: ["scripts/dogfood/queue.ts"],
        repository: "fixture/repository",
        requiredChecks,
        author: { model: "author-model", effort: "high", prompt: "author prompt" },
        reviewer: { model: "reviewer-model", effort: "high", prompt: "reviewer prompt" },
        adapter: { kind: "codex-exec", executable: process.execPath },
      },
      repair: {
        stateDirectory: resolve(root, `${id}-repair`),
        acceptanceCriteria: ["one preserved criterion"],
        author: { model: "author-model", effort: "high", prompt: "author prompt" },
        reviewer: {
          model: "reviewer-model",
          effort: "high",
          prompt: "reviewer prompt",
        },
      },
      delivery: { requiredChecks: [...requiredChecks], policy: { kind: "fixture" } },
    } as unknown as QueueItem;
  });
  const config: QueueConfig = {
    schemaVersion: "dogfood-bounded-queue-config/v1",
    controller: "synthetic-controller",
    run: "synthetic-bounded-queue",
    controllerRoot: resolve(root, "controller"),
    controllerRevision: "a".repeat(40),
    stateDirectory,
    limit: itemCount,
    nativeLaunchCeiling: 8,
    initialHistory: [],
    items,
  };
  return { root, stateDirectory, config, items };
}

async function loopFixture(
  withRuntime = false,
  acceptanceCriteria = "- One file drives the run.\n- Preserve the Markdown list.\n  Keep this continuation intact.",
) {
  const root = await mkdtemp(resolve(tmpdir(), "loop-config-fixture-"));
  roots.push(root);
  const repository = resolve(root, "repository");
  const stateRoot = resolve(root, "state");
  const worktreeRoot = resolve(root, "worktrees");
  await Promise.all([
    mkdir(resolve(repository, "docs"), { recursive: true }),
    mkdir(resolve(repository, "planning/drafts"), { recursive: true }),
    ...(withRuntime
      ? [
          cp(resolve(import.meta.dirname, "../../scripts"), resolve(repository, "scripts"), {
            recursive: true,
          }),
        ]
      : []),
  ]);
  await Promise.all([
    writeFile(resolve(repository, ".gitignore"), "node_modules/\n"),
    writeFile(resolve(repository, "docs/loop.md"), "# The loop\n\nKeep it small.\n"),
    writeFile(
      resolve(repository, "planning/roadmap.json"),
      JSON.stringify({
        repository: "fixture/repository",
        issues: [{ key: "ISS-104", file: "planning/drafts/ISS-104.md" }],
      }),
    ),
    writeFile(
      resolve(repository, "planning/drafts/ISS-104.md"),
      `---\nkey: ISS-104\ntitle: "One config"\n---\n\n## Done when\n\n${acceptanceCriteria}\n\n## Out of scope\n`,
    ),
  ]);
  const gitExecutable = await (fixtureGit ??= execute(
    process.platform === "win32" ? "where.exe" : "which",
    ["git"],
  ).then((found) => found.stdout.trim().split(/\r?\n/)[0]!));
  await execute(gitExecutable, ["init", "-b", "main", repository]);
  // ISS-171: the bytes `git config user.name` and `user.email` would append, without two processes.
  await appendFile(
    resolve(repository, ".git/config"),
    "[user]\n\tname = Fixture\n\temail = fixture@example.test\n",
  );
  await execute(gitExecutable, ["-C", repository, "add", "."]);
  await execute(gitExecutable, ["-C", repository, "commit", "-m", "fixture"]);
  const base = (
    await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  const loop = {
    schemaVersion: "dogfood-loop/v1" as const,
    run: "iss-104-run",
    adapter: "self",
    repository: "fixture/repository",
    stableExecutorRoot: repository,
    stateRoot,
    worktreeRoot,
    author: { model: "gpt-5.6-sol", effort: "high" },
    reviewer: { model: "claude-opus-5", effort: "high" },
    codexExecutable: process.execPath,
    gitExecutable,
    nativeLaunchCeiling: 8,
    attemptCeiling: 4,
  };
  return {
    repository,
    stateRoot,
    loop,
    gitExecutable,
    acceptanceCriteria,
    selected: { key: "ISS-104", number: 361, base },
  };
}

afterEach(async () => {
  timing?.phase("cleanup");
  timing = undefined;
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
});

it.each(["pass", "saved-candidate", "lost-commit-inherited-retry", "review-fail", "malformed"])(
  "resumes a saved prefixed author through the real observer and Git: %s",
  async (mode) => {
    const f = await loopFixture();
    const inherited = [
      participant(1, "ISS-100:1", "source", "author", "passed"),
      participant(2, "ISS-100:1", "source", "reviewer", "failed"),
    ];
    const q = await queueConfigFromLoop(
      f.loop,
      f.repository,
      f.selected,
      repositoryPolicy,
      inherited,
    );
    const item = q.items[0]!;
    // This sibling source shape already supports reconciliation of a lost commit
    // response. Ordinary sources also resume a durably recorded candidate below.
    if (mode === "lost-commit-inherited-retry") item.source.inheritedWorkerRetry = true;
    const setup = gitSetupAdapter({
      gitExecutable: f.gitExecutable,
      async install(_launcher, _args, cwd) {
        await mkdir(resolve(cwd, "node_modules"), { recursive: true });
        await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
        return "succeeded";
      },
    });
    // Persist the ordinary setup-to-source transition before restoring the
    // saved worker artifacts and its dirty permitted work.
    await queueStep(q, {
      ...repositoryQueueAdapter(q, f.repository, { setup, gitExecutable: f.gitExecutable }),
      async source() {
        return { status: "observing-author" };
      },
    });
    await mkdir(item.source.stateDirectory, { recursive: true });
    const path = (name: string) => resolve(item.source.stateDirectory, name);
    const read = (name: string) => readFile(path(name), "utf8");
    const author: Attempt = {
      id: randomUUID(),
      pid: process.pid,
      trace: path("author.jsonl"),
      launchedAt: 1,
      retries: 1,
    };
    const recorded = prefixedAuthor[1]!.item!.text;
    // Only synthetic identities and summary enter lifecycle controls. The
    // separate adapter fixture preserves the original final message verbatim.
    const message =
      recorded.slice(0, recorded.indexOf("{")) +
      JSON.stringify({
        run: item.source.run,
        role: "author",
        head: item.source.base,
        verdict: "PASS",
        summary: "Synthetic implementation completed.",
      }) +
      (mode === "malformed" ? "\nTrailing prose." : "");
    const trace = (id: string, text?: string) =>
      [
        { type: "thread.started", thread_id: id },
        ...(text === undefined
          ? []
          : [
              { type: "item.completed", item: { type: "agent_message", text } },
              { type: "turn.completed", usage: { input_tokens: 12, output_tokens: 8 } },
            ]),
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n";
    await writeFile(path("author-attempt.json"), JSON.stringify(author));
    await writeFile(author.trace, trace(author.id, message));
    await writeFile(path("author.exit.json"), JSON.stringify({ code: 0 }));
    await writeFile(
      path("prior-stop.json"),
      JSON.stringify({ reason: "source-flow-state-unknown", ordinal: 1 }),
    );
    await writeFile(
      resolve(item.source.worktree, "docs/loop.md"),
      "# Synthetic permitted implementation\n",
    );
    const preservedNames = [
      "author-attempt.json",
      "author.jsonl",
      "author.exit.json",
      "prior-stop.json",
    ];
    const preserved = await Promise.all(preservedNames.map(read));
    const unchanged = async () => {
      expect(await Promise.all(preservedNames.map(read))).toEqual(preserved);
      await expect(read("publication.json")).rejects.toMatchObject({ code: "ENOENT" });
    };
    await expect(read("author-terminal.json")).rejects.toMatchObject({ code: "ENOENT" });
    const real = codexAdapter(f.gitExecutable);
    const launches: string[] = [];
    let commits = 0;
    let interrupted = false;
    let reviewer: Attempt | undefined;
    let candidateHead = "";
    const native: Adapter = {
      ...real,
      async waitForProvider() {},
      async preflight() {},
      async git(tree, args) {
        const result = await real.git(tree, args);
        if (args[0] === "commit") {
          commits++;
          if (mode === "lost-commit-inherited-retry" && !interrupted) {
            interrupted = true;
            throw new Error("lost commit response");
          }
        }
        if (
          mode === "saved-candidate" &&
          !interrupted &&
          commits === 1 &&
          (await read("candidate.json").then(
            () => true,
            () => false,
          ))
        ) {
          interrupted = true;
          throw new Error("interrupted after durable candidate");
        }
        return result;
      },
      async launch(role, config, prompt) {
        launches.push(role);
        expect(role).toBe("reviewer");
        candidateHead = await real.git(config.worktree, ["rev-parse", "HEAD"]);
        expect(candidateHead).not.toBe(config.base);
        expect(await real.git(config.reviewWorktree, ["rev-parse", "HEAD"])).toBe(candidateHead);
        expect(prompt).toContain(candidateHead);
        expect(prompt).toContain(JSON.stringify(author.trace));
        expect(prompt).toContain(JSON.stringify(path("author-terminal.json")));
        reviewer = {
          id: randomUUID(),
          pid: process.pid,
          trace: path("reviewer.jsonl"),
          launchedAt: 1,
        };
        expect(reviewer.id).not.toBe(author.id);
        await writeFile(reviewer.trace, trace(reviewer.id));
        return reviewer;
      },
    };
    const adapter = () =>
      repositoryQueueAdapter(q, f.repository, { native, setup, gitExecutable: f.gitExecutable });
    const run = () =>
      queueStep(q, {
        ...adapter(),
        async delivery() {
          throw new Error("independent review reached delivery boundary");
        },
        async repair() {
          throw new Error("blocking review reached repair boundary");
        },
      });
    if (mode === "malformed") {
      for (let replay = 0; replay < 2; replay++)
        await expect(run()).rejects.toMatchObject({ reason: "author-malformed", retries: 1 });
      expect(launches).toEqual([]);
      expect(commits).toBe(0);
      expect(JSON.parse(await read("author-terminal.json"))).toMatchObject({
        id: author.id,
        status: "malformed",
      });
      await expect(read("candidate.json")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await real.git(item.source.worktree, ["status", "--porcelain"])).toContain(
        "docs/loop.md",
      );
      await unchanged();
      return;
    }
    if (mode === "saved-candidate" || mode === "lost-commit-inherited-retry") {
      await expect(run()).rejects.toThrow("source-flow-state-unknown");
      expect(commits).toBe(1);
      expect(launches).toEqual([]);
    }
    await expect(run()).resolves.toMatchObject({ status: "observing-reviewer" });
    const candidate = await read("candidate.json");
    const terminal = await read("author-terminal.json");
    expect(JSON.parse(terminal)).toMatchObject({
      id: author.id,
      status: "passed",
      head: item.base,
    });
    expect(JSON.parse(candidate)).toMatchObject({ head: candidateHead, changed: ["docs/loop.md"] });
    expect(await real.git(item.source.worktree, ["rev-parse", `${candidateHead}^`])).toBe(
      item.base,
    );
    const queuePath = resolve(q.stateDirectory, "attempt.json");
    const pending = JSON.parse(await readFile(queuePath, "utf8"));
    expect(pending.retries).toBe(1);
    expect(pending.history.slice(0, inherited.length)).toEqual(inherited);
    expect(pending.history.find((p: QueueParticipant) => p.id === author.id)).toMatchObject({
      outcome: "passed",
      role: "author",
    });
    for (let replay = 0; replay < 2; replay++)
      await expect(run()).resolves.toMatchObject({ status: "observing-reviewer" });
    expect(JSON.parse(await readFile(queuePath, "utf8"))).toEqual(pending);
    const reviewerBytes = await read("reviewer-attempt.json");
    await writeFile(
      reviewer!.trace,
      trace(
        reviewer!.id,
        JSON.stringify({
          run: item.source.run,
          role: "reviewer",
          head: candidateHead,
          verdict: mode === "review-fail" ? "FAIL" : "PASS",
          findings:
            mode === "review-fail"
              ? [
                  {
                    file: "docs/loop.md",
                    line: 1,
                    severity: "blocking",
                    text: "Synthetic missing acceptance behavior.",
                  },
                ]
              : [],
          g0: "No; the existing extractor satisfies the framing requirement.",
        }),
      ),
    );
    await writeFile(path("reviewer.exit.json"), JSON.stringify({ code: 0 }));
    const reason =
      mode === "review-fail"
        ? "blocking review reached repair boundary"
        : "independent review reached delivery boundary";
    await expect(run()).rejects.toThrow(reason);
    const finished = await readFile(queuePath, "utf8");
    for (let replay = 0; replay < 2; replay++) await expect(run()).rejects.toThrow(reason);
    expect(await readFile(queuePath, "utf8")).toBe(finished);
    expect(JSON.parse(finished)).toMatchObject({
      phase: mode === "review-fail" ? "repair" : "delivery",
      head: candidateHead,
      reviewId: reviewer!.id,
      retries: 1,
      acceptedStage: mode === "review-fail" ? null : "source",
    });
    expect(JSON.parse(finished).history.slice(0, inherited.length)).toEqual(inherited);
    expect(JSON.parse(finished).history).toHaveLength(inherited.length + 2);
    expect(launches).toEqual(["reviewer"]);
    expect(commits).toBe(1);
    expect(await read("candidate.json")).toBe(candidate);
    expect(await read("author-terminal.json")).toBe(terminal);
    expect(await read("reviewer-attempt.json")).toBe(reviewerBytes);
    await unchanged();
  },
);

it.each([
  "pass",
  "before-replacement",
  "after-persistence",
  "second-malformed",
  "spent",
  "inherited",
  "ceiling",
  "wrong-identity",
  "moved-head",
  "wrong-verdict-head",
  "review-fail",
])("recovers saved malformed author transport with real observation and Git: %s", async (mode) => {
  const f = await loopFixture();
  f.loop.nativeLaunchCeiling = mode === "ceiling" ? 13 : 20;
  const inherited = Array.from({ length: 12 }, (_, i) =>
    participant(
      i + 1,
      `ISS-synthetic-${Math.floor(i / 2)}:1`,
      "source",
      i % 2 ? "reviewer" : "author",
      i % 2 ? "failed" : "passed",
    ),
  );
  const q = await queueConfigFromLoop(
    f.loop,
    f.repository,
    f.selected,
    repositoryPolicy,
    inherited,
  );
  const item = q.items[0]!;
  item.source.author = {
    ...item.source.author,
    ...SELF_ROUTING.author[0]!,
    ladder: SELF_ROUTING.author,
    rung: 0,
  };
  item.source.authorFailures = { count: 2, ids: ["synthetic-probe-0", "synthetic-probe-1"] };
  if (mode === "inherited") item.source.inheritedWorkerRetry = true;
  const setup = gitSetupAdapter({
    gitExecutable: f.gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  await queueStep(q, {
    ...repositoryQueueAdapter(q, f.repository, { setup, gitExecutable: f.gitExecutable }),
    async source() {
      return { status: "observing-author" };
    },
  });
  await mkdir(item.source.stateDirectory, { recursive: true });
  const path = (name: string) => resolve(item.source.stateDirectory, name);
  const read = (name: string) => readFile(path(name), "utf8");
  const real = codexAdapter(f.gitExecutable);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        config: item.source,
        prompts: [item.source.author.prompt, item.source.reviewer.prompt],
      }),
    )
    .digest("hex");
  await writeFile(
    path("config.json"),
    JSON.stringify({ fingerprint, config: item.source, host: process.platform }),
  );
  await writeFile(
    path("author-intent.json"),
    JSON.stringify({ fingerprint, role: "author", head: item.base }),
  );
  const pinnedConfig = await read("config.json");
  const author: Attempt = {
    id: "00000000-0000-4000-8000-000000000183",
    pid: process.pid,
    trace: path("synthetic-author.jsonl"),
    launchedAt: 1,
    placement: SELF_ROUTING.author[0]!,
    rung: 0,
    ...(mode === "spent" ? { retries: 1 as const } : {}),
  };
  const trace = (id: string, verdict?: object) =>
    [
      { type: "thread.started", thread_id: id },
      ...(verdict
        ? [
            {
              type: "item.completed",
              item: { type: "agent_message", text: JSON.stringify(verdict) },
            },
            { type: "turn.completed", usage: { input_tokens: 12, output_tokens: 8 } },
          ]
        : []),
    ]
      .map((event) => JSON.stringify(event))
      .join("\n") + "\n";
  const verdict = {
    run: mode === "wrong-identity" ? "synthetic-wrong-run" : item.source.run,
    role: "author",
    head: item.base,
    verdict: "PASS",
    summary: "x".repeat(MAX_TERMINAL_SUMMARY_LENGTH + 79),
  };
  await writeFile(path("author-attempt.json"), JSON.stringify(author));
  await writeFile(author.trace, trace(author.id, verdict));
  await writeFile(path("synthetic-author.exit.json"), JSON.stringify({ code: 0 }));
  const file = resolve(item.source.worktree, "docs/loop.md");
  await writeFile(file, "# Synthetic staged partial\n");
  await real.git(item.source.worktree, ["add", "docs/loop.md"]);
  await writeFile(file, "# Synthetic unstaged partial\r\nWith retained bytes.\r\n");
  const untracked = resolve(item.source.worktree, "synthetic-partial.txt");
  await writeFile(untracked, Buffer.from([0, 1, 2, 255, 13, 10]));
  const partials = async () => ({
    index: (await execute(f.gitExecutable, ["-C", item.source.worktree, "show", ":docs/loop.md"]))
      .stdout,
    work: await readFile(file),
    untracked: await readFile(untracked),
    status: await real.git(item.source.worktree, ["status", "--porcelain"]),
  });
  const bytes = await partials();
  const evidence = await Promise.all([
    read("synthetic-author.jsonl"),
    read("synthetic-author.exit.json"),
  ]);
  if (mode === "moved-head")
    await real.git(item.source.worktree, ["commit", "-m", "synthetic forbidden head change"]);
  const launches: string[] = [];
  const authorLaunches = mode === "before-replacement" ? ["author", "author"] : ["author"];
  let interrupted = false;
  let retry: Attempt | undefined;
  let reviewer: Attempt | undefined;
  let commits = 0;
  const native: Adapter = {
    ...real,
    async preflight() {},
    async waitForProvider() {},
    async git(tree, args) {
      expect(["reset", "clean"]).not.toContain(args[0]);
      if (args[0] === "commit") commits++;
      return real.git(tree, args);
    },
    async launch(role, config, prompt) {
      if (role === "author") {
        expect(await partials()).toEqual(bytes);
        expect(await real.git(config.worktree, ["rev-parse", "HEAD"])).toBe(item.base);
        expect(prompt).toContain(
          `Author summary length is ${MAX_TERMINAL_SUMMARY_LENGTH + 79} characters; maximum is ${MAX_TERMINAL_SUMMARY_LENGTH}`,
        );
        expect(prompt).toContain(JSON.stringify(author.trace));
        expect(prompt).toContain("Inspect and verify");
        expect(prompt).toContain(JSON.stringify(path("author-retry-discard.json")));
        expect(JSON.parse(await read("author-retry-discard.json"))).toMatchObject({
          attempt: author,
          terminal: { id: author.id, status: "malformed" },
          base: item.base,
        });
        expect(config.author).toMatchObject({ ...SELF_ROUTING.author[2]!, rung: 2 });
      }
      launches.push(role);
      const attempt = {
        id: randomUUID(),
        pid: process.pid,
        trace: path(`synthetic-${role}-retry-${launches.length}.jsonl`),
        launchedAt: Date.now(),
      };
      await writeFile(attempt.trace, trace(attempt.id));
      if (mode === "before-replacement" && !interrupted) {
        interrupted = true;
        throw new Error("synthetic interruption after worker launch, before attempt replacement");
      }
      if (role === "author") retry = attempt;
      else {
        reviewer = attempt;
        expect(prompt).toContain(JSON.stringify(retry!.trace));
        expect(await real.git(config.reviewWorktree, ["rev-parse", "HEAD"])).toBe(
          await real.git(config.worktree, ["rev-parse", "HEAD"]),
        );
      }
      return attempt;
    },
    async observe(role, config, attempt) {
      if (mode === "after-persistence" && attempt.id !== author.id && !interrupted) {
        interrupted = true;
        expect(JSON.parse(await read("author-attempt.json"))).toMatchObject({
          id: attempt.id,
          retries: 1,
        });
        throw new Error("synthetic interruption after retry persistence");
      }
      return real.observe(role, config, attempt);
    },
  };
  const compose = () =>
    repositoryQueueAdapter(q, f.repository, { native, setup, gitExecutable: f.gitExecutable });
  const run = () =>
    queueStep(q, {
      ...compose(),
      async delivery() {
        throw new Error("synthetic reviewed delivery boundary");
      },
      async repair() {
        throw new Error("synthetic rejected review boundary");
      },
    });
  const queueRecord = async () =>
    JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"));
  const noAcceptance = async () => {
    await expect(read("candidate.json")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(read("publication.json")).rejects.toMatchObject({ code: "ENOENT" });
    expect(commits).toBe(0);
    expect(launches).not.toContain("reviewer");
  };
  if (["spent", "inherited", "ceiling", "wrong-identity", "moved-head"].includes(mode)) {
    const reason =
      mode === "ceiling"
        ? "native-launch-ceiling-exhausted"
        : mode === "wrong-identity"
          ? "worker-verdict-identity-mismatch"
          : mode === "moved-head"
            ? "changed-base"
            : "author-malformed";
    for (let i = 0; i < 2; i++) await expect(run()).rejects.toThrow(reason);
    expect(launches).toEqual([]);
    if (mode !== "moved-head") expect(await partials()).toEqual(bytes);
    await noAcceptance();
  } else {
    if (mode === "before-replacement") {
      await expect(run()).rejects.toThrow("source-flow-state-unknown");
      expect(JSON.parse(await read("author-attempt.json"))).toEqual(author);
      expect(await partials()).toEqual(bytes);
    }
    if (mode === "after-persistence")
      await expect(run()).rejects.toThrow("source-flow-state-unknown");
    await expect(run()).resolves.toMatchObject({ status: "observing-author" });
    const persisted = await read("author-attempt.json");
    expect(JSON.parse(persisted)).toMatchObject({ id: retry!.id, retries: 1, rung: 2 });
    expect(JSON.parse(persisted).retryContext).toContain(JSON.stringify(author.trace));
    for (let i = 0; i < 2; i++)
      await expect(run()).resolves.toMatchObject({ status: "observing-author" });
    expect(await read("author-attempt.json")).toBe(persisted);
    expect(launches).toEqual(authorLaunches);
    expect(await partials()).toEqual(bytes);
    expect((await queueRecord()).authorFailures).toEqual({
      count: 3,
      ids: ["synthetic-probe-0", "synthetic-probe-1", author.id],
    });
    await writeFile(
      retry!.trace,
      trace(retry!.id, {
        ...verdict,
        head: mode === "wrong-verdict-head" ? "f".repeat(40) : item.base,
        summary:
          mode === "second-malformed"
            ? "x".repeat(MAX_TERMINAL_SUMMARY_LENGTH + 1)
            : "Synthetic verified work.",
      }),
    );
    await writeFile(retry!.trace.replace(/\.jsonl$/, ".exit.json"), JSON.stringify({ code: 0 }));
    if (mode === "second-malformed" || mode === "wrong-verdict-head") {
      for (let i = 0; i < 2; i++)
        await expect(run()).rejects.toMatchObject({
          reason: mode === "second-malformed" ? "author-malformed" : "author-wrong-head",
          ...(mode === "second-malformed"
            ? {
                retries: 1,
                diagnostics: expect.stringContaining(`${MAX_TERMINAL_SUMMARY_LENGTH + 1}`),
              }
            : {}),
        });
      expect(launches).toEqual(["author"]);
      if (mode === "second-malformed") expect((await queueRecord()).authorFailures.count).toBe(4);
      await noAcceptance();
    } else {
      await expect(run()).resolves.toMatchObject({ status: "observing-reviewer" });
      const candidate = JSON.parse(await read("candidate.json"));
      expect(commits).toBe(1);
      expect(await real.git(item.source.worktree, ["rev-parse", `${candidate.head}^`])).toBe(
        item.base,
      );
      expect(await readFile(file)).toEqual(bytes.work);
      expect(await readFile(untracked)).toEqual(bytes.untracked);
      await writeFile(
        reviewer!.trace,
        trace(reviewer!.id, {
          run: item.source.run,
          role: "reviewer",
          head: candidate.head,
          verdict: mode === "review-fail" ? "FAIL" : "PASS",
          findings:
            mode === "review-fail"
              ? [
                  {
                    file: "docs/loop.md",
                    line: 1,
                    severity: "blocking",
                    text: "Synthetic acceptance defect.",
                  },
                ]
              : [],
          g0: "No; shared transport retry preserves the existing boundaries.",
        }),
      );
      await writeFile(
        reviewer!.trace.replace(/\.jsonl$/, ".exit.json"),
        JSON.stringify({ code: 0 }),
      );
      for (let i = 0; i < 3; i++)
        await expect(run()).rejects.toThrow(
          mode === "review-fail"
            ? "synthetic rejected review boundary"
            : "synthetic reviewed delivery boundary",
        );
      expect(launches).toEqual([...authorLaunches, "reviewer"]);
      const saved = await queueRecord();
      expect(saved).toMatchObject({
        retries: 1,
        head: candidate.head,
        acceptedStage: mode === "review-fail" ? null : "source",
      });
      expect(saved.history.slice(12).map((p: QueueParticipant) => [p.role, p.outcome])).toEqual([
        ["author", "malformed"],
        ["author", "passed"],
        ["reviewer", mode === "review-fail" ? "failed" : "passed"],
      ]);
      expect(saved.authorFailures.count).toBe(mode === "review-fail" ? 4 : 3);
    }
  }
  const saved = await queueRecord();
  expect(saved.candidateAttempt).toBe(mode === "review-fail" ? 2 : 1);
  expect(saved.history.slice(0, 12)).toEqual(inherited);
  if (mode !== "wrong-identity") {
    expect(saved.history[12]).toMatchObject({
      id: author.id,
      role: "author",
      outcome: "malformed",
      placement: SELF_ROUTING.author[0]!,
      rung: 0,
    });
  }
  expect(
    await Promise.all([read("synthetic-author.jsonl"), read("synthetic-author.exit.json")]),
  ).toEqual(evidence);
  await expect(read("publication.json")).rejects.toMatchObject({ code: "ENOENT" });
  expect(await read("config.json")).toBe(pinnedConfig);
});

it("composes a four-input saved-stop grant outside immutable source and delivery inputs", async () => {
  const f = await loopFixture();
  const original = await queueConfigFromLoop(f.loop, f.repository, f.selected, repositoryPolicy);
  const grant = {
    stateDirectory: original.items[0]!.source.stateDirectory,
    candidateHead: f.selected.base,
    repairSha: "b".repeat(40),
    authorityUrl: "https://github.com/fixture/repository/issues/494#issuecomment-5687186310",
  };
  const resumed = await queueConfigFromLoop(
    { ...f.loop, gateStopAuthorization: grant },
    f.repository,
    f.selected,
    repositoryPolicy,
  );
  expect(resumed.gateStopAuthorization).toEqual(grant);
  const { gateStopAuthorization: _grant, ...unchanged } = resumed;
  expect(unchanged).toEqual(original);
  for (const invalid of [
    null,
    { ...grant, id: "another-recovery" },
    { ...grant, authorityUrl: "" },
    { ...grant, stateDirectory: "relative" },
  ])
    expect(() =>
      validateLoopConfig({ ...f.loop, gateStopAuthorization: invalid } as LoopConfig),
    ).toThrow("invalid-gate-stop-authorization");
});

it("recomposes a saved selection after its pending gate-stop note and admits one native DELTA", async () => {
  const f = await loopFixture();
  const git = async (tree: string, args: string[]) =>
    (
      await execute(f.gitExecutable, [
        "-C",
        tree,
        ...(args[0] === "fetch"
          ? args.map((arg) => (arg === "origin" ? f.repository : arg))
          : args),
      ])
    ).stdout.trim();
  await git(f.repository, [
    "remote",
    "add",
    "origin",
    `https://github.com/${f.loop.repository}.git`,
  ]);
  const cycle = { selection: { cycle: 1, ...f.selected }, initialHistory: [] };
  await persistCycle(f.loop, cycle);
  let q = await queueConfigFromLoop(f.loop, f.repository, f.selected, repositoryPolicy);
  const item = q.items[0]!;
  const launches: { role: string; directory: string; prompt: string }[] = [];
  let refreshObservations = 0;
  const native: Adapter = {
    async preflight() {},
    git,
    async launch(role, current, prompt) {
      launches.push({ role, directory: current.stateDirectory, prompt });
      expect(current.pilotRevision).toBe(f.selected.base);
      if (role === "author")
        await writeFile(resolve(current.worktree, "feature.txt"), "reviewed feature\n");
      const trace = resolve(current.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, "synthetic native worker execution\n");
      return { id: randomUUID(), pid: 111, trace, launchedAt: 1 };
    },
    async observe(role, current, attempt) {
      if (current.stateDirectory !== item.source.stateDirectory) {
        refreshObservations++;
        expect(current.pilotRevision).toBe(f.selected.base);
        return { id: attempt.id, status: "running" };
      }
      const head =
        role === "author" ? current.base : await git(current.worktree, ["rev-parse", "HEAD"]);
      return {
        id: attempt.id,
        status: "passed",
        head,
        ...(role === "reviewer"
          ? {
              summary: JSON.stringify({
                run: current.run,
                role,
                head,
                verdict: "PASS",
                findings: [],
                g0: "Small fixture",
              }),
            }
          : {}),
      };
    },
    async checks() {
      throw new Error("No hosted observation before fresh review");
    },
  };
  const delivery = githubDeliveryAdapter();
  const sourceEvidence = delivery.source;
  delivery.source = async (current) => {
    expect(current).not.toHaveProperty("pilotRevision");
    return sourceEvidence(current);
  };
  delivery.runGate = async (current, gate, head) => {
    const path = resolve(
      current.stateDirectory,
      `gate-${createHash("sha256").update(gate).digest("hex")}`,
    );
    await mkdir(path, { recursive: true });
    await writeFile(resolve(path, "candidate.log"), "Synthetic unknown failure\n");
    await writeFile(resolve(path, "candidate-terminal.json"), JSON.stringify({ head, code: 1 }));
    return "failed";
  };
  const adapter = () =>
    repositoryQueueAdapter(q, f.repository, {
      native,
      delivery,
      gitExecutable: f.gitExecutable,
      async assertExecutor() {},
      setup: gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, tree) {
          await mkdir(resolve(tree, "node_modules"), { recursive: true });
          await writeFile(resolve(tree, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
      deliveryPolicy: {
        async plan(current) {
          return {
            gates: { beforeMirror: ["test"], afterMirror: [] },
            drafts: [],
            publication: {
              sourceBranch: "codex/iss-104",
              baseBranch: "main",
              title: "fixture",
              body: "fixture",
              draft: true,
            },
            cleanup: {
              worktrees: [current.worktree, current.reviewWorktree],
              branch: current.localBranch!,
            },
            mergePolicy: {},
          };
        },
      },
    });
  await expect(queueStep(q, adapter())).rejects.toThrow("gate-attribution-unknown:test");
  const candidate = JSON.parse(
    await readFile(resolve(item.source.stateDirectory, "candidate.json"), "utf8"),
  );
  const oldConfig = await readFile(resolve(item.source.stateDirectory, "config.json"));
  const oldSetup = await snapshot(item.setup.stateDirectory);
  const oldAuthor = await readFile(resolve(item.source.stateDirectory, "author-attempt.json"));
  const oldStop = await readFile(resolve(item.source.stateDirectory, "gate-stop.json"));
  const comments: string[] = [];
  const supervisor: SupervisionAdapter = {
    async issue() {
      return { state: "OPEN", key: f.selected.key, labels: [], comments };
    },
    async currentMain() {
      throw new Error("Saved selection must keep its pinned base");
    },
    async removeReady() {},
    async close() {},
    async comment(_config, _number, body) {
      comments.push(body);
      throw new Error("lost note receipt");
    },
  };
  const history = await adapter().history();
  await expect(
    stopCycle(
      f.loop,
      { ...cycle, initialHistory: history },
      "gate-attribution-unknown:test",
      1,
      supervisor,
      repositoryPolicy,
    ),
  ).rejects.toThrow("lost note receipt");
  await writeFile(resolve(f.repository, "landed-repair.txt"), "landed repair\n");
  await git(f.repository, ["add", "."]);
  await git(f.repository, ["commit", "-m", "landed repair"]);
  const repairSha = await git(f.repository, ["rev-parse", "HEAD"]);
  const loop = {
    ...f.loop,
    gateStopAuthorization: {
      stateDirectory: item.source.stateDirectory,
      candidateHead: candidate.head,
      repairSha,
      authorityUrl: "https://github.com/fixture/repository/issues/494#issuecomment-5687186310",
    },
  };
  const resumed = (await nextCycle(loop, f.repository, supervisor, repositoryPolicy))!;
  expect(resumed.selection.base).toBe(f.selected.base);
  await expect(
    reconcilePendingStop(loop, resumed, supervisor, repositoryPolicy),
  ).resolves.toBeUndefined();
  for (let replay = 0; replay < 2; replay++) {
    q = await queueConfigFromLoop(loop, f.repository, f.selected, repositoryPolicy);
    expect(q.controllerRevision).toBe(repairSha);
    expect(q.items[0]!.setup.pilotRevision).toBe(f.selected.base);
    expect(q.items[0]!.source.pilotRevision).toBe(f.selected.base);
    await expect(queueStep(q, adapter())).resolves.toMatchObject({ status: "observing-reviewer" });
  }
  expect(refreshObservations).toBe(2);
  expect(await snapshot(item.setup.stateDirectory)).toEqual(oldSetup);
  expect(await readFile(resolve(item.source.stateDirectory, "author-attempt.json"))).toEqual(
    oldAuthor,
  );
  expect(launches.map((row) => row.role)).toEqual(["author", "reviewer", "reviewer"]);
  expect(launches.at(-1)!.prompt).toContain("independent DELTA");
  const reservation = JSON.parse(
    await readFile(resolve(item.source.stateDirectory, "gate-stop-continuation.json"), "utf8"),
  );
  expect(reservation.context).toContain(
    resolve(
      item.source.stateDirectory,
      `gate-${createHash("sha256").update("test").digest("hex")}/candidate-terminal.json`,
    ),
  );
  expect(reservation.main).toBe(repairSha);
  expect(comments).toHaveLength(1);
  expect(await readFile(resolve(item.source.stateDirectory, "config.json"))).toEqual(oldConfig);
  expect(await readFile(resolve(item.source.stateDirectory, "gate-stop.json"))).toEqual(oldStop);
});

async function acceptedReplanFixture() {
  const f = await loopFixture();
  const git = async (args: string[]) =>
    (await execute(f.gitExecutable, ["-C", f.repository, ...args])).stdout.trim();
  await git(["checkout", "-b", "codex/7766-jpeg-g4"]);
  await writeFile(resolve(f.repository, "jpeg.txt"), "preserved JPEG implementation\n");
  await git(["add", "."]);
  await git(["commit", "-m", "rejected candidate"]);
  const head = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "main"]);
  const loop: LoopConfig = {
    ...f.loop,
    run: ACCEPTED_REPLAN.run,
    adapter: "chase-sets",
    routingRows: [{ ...SELF_ROUTING, row: 7, review: 11 }],
    repository: "chase-sets/chase-sets",
    targetMilestone: 158,
    acceptedReplan: replanPacket(f.loop.stateRoot, head),
    nativeLaunchCeiling: 16,
  };
  const selected = { ...f.selected, key: "cs-7766", number: 7766 };
  const policy: RepositoryAdapter = {
    ...repositoryPolicy,
    issueContext: () => ({
      title: "JPEG",
      routing: { row: 7, review: 11 },
      body: "Repair JPEG",
      acceptanceCriteria: ["JPEG"],
      rules: "Keep scope",
    }),
    branchName: ({ attempt }) => `codex/7766-jpeg-g${attempt}`,
    requiredChecks: () => ["PR Required"],
  };
  const history = [
    participant(1, "cs-7766:1", "source", "author", "passed"),
    participant(2, "cs-7766:1", "source", "reviewer", "failed"),
    participant(3, "cs-7766:1", "repair", "author", "passed"),
    participant(4, "cs-7766:1", "repair", "reviewer", "failed"),
    participant(5, "cs-7766:3", "source", "author", "passed"),
    participant(6, "cs-7766:3", "source", "reviewer", "passed"),
    { ...participant(7, "cs-7766:4", "source", "author", "dead"), id: "dead-author" },
    participant(8, "cs-7766:4", "source", "author", "passed"),
    participant(9, "cs-7766:4", "source", "reviewer", "passed"),
  ];
  const priorDirectory = resolve(loop.stateRoot, ACCEPTED_REPLAN.priorRun, "cs-7766-attempt-4");
  loop.acceptedReplan = replanPacket(loop.stateRoot, head, history);
  const priorSource = resolve(priorDirectory, "source");
  await mkdir(priorSource, { recursive: true });
  const prior = {
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    phase: "failed",
    run: ACCEPTED_REPLAN.priorRun,
    index: 0,
    item: "cs-7766:4",
    issue: "https://github.com/chase-sets/chase-sets/issues/7766",
    base: selected.base,
    candidateAttempt: 4,
    head,
    reviewId: history[8]!.id,
    findings: [
      { file: "PR Required", line: 1, severity: "blocking", text: "route-collision inventory" },
    ],
    history,
    retries: 1,
    acceptedStage: null,
    stateDirectory: null,
  };
  const publication = {
    number: 8005,
    url: "https://github.com/chase-sets/chase-sets/pull/8005",
    head,
    repository: loop.repository,
    sourceBranch: "codex/7766-jpeg-g4",
  };
  const preserved = new Map<string, string>([
    [resolve(priorDirectory, "attempt.json"), JSON.stringify(prior)],
    [resolve(priorSource, "publication.json"), JSON.stringify(publication)],
    [
      resolve(priorSource, "config.json"),
      JSON.stringify({
        config: { mainBase: selected.base, repository: loop.repository, issue: prior.issue },
      }),
    ],
    [
      resolve(priorSource, "hosted-failure.log"),
      "Original failed run: route-collision inventory\n",
    ],
  ]);
  // The fresh run already stopped in setup, while old attempt-1 worktrees exist.
  const freshAttempt = resolve(loop.stateRoot, loop.run, "cs-7766-attempt-1", "attempt.json");
  await mkdir(resolve(freshAttempt, ".."), { recursive: true });
  preserved.set(
    freshAttempt,
    JSON.stringify({
      ...prior,
      phase: "setup",
      run: loop.run,
      candidateAttempt: 1,
      head: selected.base,
      history: [],
      findings: [],
    }),
  );
  for (const [path, value] of preserved) await writeFile(path, value);
  for (const role of ["pilot", "source", "review"]) {
    const path = resolve(loop.worktreeRoot, `cs-7766-attempt-1-${role}`);
    await git(["worktree", "add", "--detach", path, selected.base]);
  }
  const oldSource = resolve(loop.worktreeRoot, "cs-7766-attempt-4-source");
  await git(["worktree", "add", oldSource, publication.sourceBranch]);
  const compose = (config = loop) => queueConfigFromLoop(config, f.repository, selected, policy);
  const setup = gitSetupAdapter({
    gitExecutable: f.gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  return { ...f, loop, selected, head, history, preserved, oldSource, git, compose, setup, policy };
}

async function unpublishedReplanFixture() {
  const f = await acceptedReplanFixture();
  const key = "cs-7844";
  const number = 7844;
  const priorRun = "m2-ordering-prior";
  const run = "m2-ordering-final";
  const file = "bounded-contexts/ordering/features/orders/api/purchase-limits.db.test.ts";
  await f.git(["checkout", "--detach", f.head]);
  await mkdir(resolve(f.repository, file, ".."), { recursive: true });
  await writeFile(resolve(f.repository, file), "prior two unsupported reads\n");
  await f.git(["add", file]);
  await f.git(["commit", "-m", "unpublished ordering candidate"]);
  const head = await f.git(["rev-parse", "HEAD"]);
  await f.git(["checkout", "main"]);
  const packet = replanPacket(f.loop.stateRoot, head);
  const history = f.history.slice(0, 8).map((p, index) => ({
    ...p,
    item: `${key}:${index < 4 ? 1 : 3}`,
    stage: index % 4 >= 2 ? ("repair" as const) : ("source" as const),
    role: index % 2 ? ("reviewer" as const) : ("author" as const),
    outcome: index % 2 ? ("failed" as const) : ("passed" as const),
  }));
  Object.assign(packet, {
    issueKey: key,
    issueUrl: `https://github.com/${f.loop.repository}/issues/${number}`,
    priorRun,
    priorAttemptDirectory: resolve(f.loop.stateRoot, priorRun, `${key}-attempt-3`),
    priorHistoryDigest: createHash("sha256").update(JSON.stringify(history)).digest("hex"),
    targetRun: run,
    attemptSlug: `${key}-final-attempt-5`,
    publication: null,
    allowedPaths: [file],
    preReviewEvidence: evidenceDescriptor(resolve(f.loop.stateRoot, "host-evidence")),
    scope:
      "Correct only the two unsupported event-store reads before the day +0/+1 cancellation proof",
  });
  const priorSource = resolve(packet.priorAttemptDirectory, "repair");
  await mkdir(priorSource, { recursive: true });
  const old = JSON.parse(
    await readFile(resolve(f.loop.acceptedReplan!.priorAttemptDirectory, "attempt.json"), "utf8"),
  );
  const prior = {
    ...old,
    run: priorRun,
    issue: packet.issueUrl,
    item: `${key}:3`,
    head,
    history,
    reviewId: history.at(-1)!.id,
    findings: [
      { file, line: 340, severity: "blocking", text: "Missing PostgreSQL cancellation proof" },
    ],
  };
  await writeFile(resolve(packet.priorAttemptDirectory, "attempt.json"), JSON.stringify(prior));
  await writeFile(
    resolve(priorSource, "config.json"),
    JSON.stringify({
      config: { mainBase: f.selected.base, repository: f.loop.repository, issue: packet.issueUrl },
    }),
  );
  const loop = { ...f.loop, run, acceptedReplan: packet };
  const selected = { ...f.selected, key, number };
  const policy = {
    ...f.policy,
    branchName: ({ attempt }: { attempt: number }) => `codex/ordering-g${attempt}`,
  };
  const compose = (config = loop) => queueConfigFromLoop(config, f.repository, selected, policy);
  return { ...f, loop, selected, head, history, prior, priorSource, file, compose, policy };
}

it("composes an unpublished repair-attempt lineage without importing publication or PASS", async () => {
  const f = await unpublishedReplanFixture();
  const q = await f.compose();
  const item = q.items[0]!;
  expect(q.initialHistory).toEqual(f.history);
  expect(item).toMatchObject({
    base: f.head,
    implementationAttempt: 5,
    implementationAttemptCeiling: 5,
    source: { mainBase: f.selected.base, correctionPaths: [f.file] },
  });
  expect(item.delivery.refresh).toBeUndefined();
  for (const role of ["author", "reviewer"] as const) {
    expect(item.source[role].prompt).toContain(f.priorSource);
    expect(item.source[role].prompt).toContain("Missing PostgreSQL cancellation proof");
  }
  for (const name of ["publication", "author-terminal", "reviewer-terminal"])
    await expect(
      readFile(resolve(item.source.stateDirectory, `${name}.json`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await f.compose()).toEqual(q);
  const renewed = {
    ...f.loop,
    run: "second-final",
    acceptedReplan: { ...f.loop.acceptedReplan, targetRun: "second-final" },
  };
  await expect(f.compose(renewed)).rejects.toThrow("accepted-replan-already-consumed");
}, 30_000);

it.each([
  "missing",
  "phase",
  "issue",
  "item",
  "head",
  "attempt",
  "history",
  "repository",
  "publication",
])(
  "refuses a %s mismatch in the named prior lineage before setup",
  async (mode) => {
    const f = await unpublishedReplanFixture();
    const path = resolve(f.loop.acceptedReplan.priorAttemptDirectory, "attempt.json");
    if (mode === "missing") await rm(path);
    else if (mode === "repository")
      await writeFile(
        resolve(f.priorSource, "config.json"),
        JSON.stringify({
          config: { mainBase: f.selected.base, repository: "borrowed/repo", issue: f.prior.issue },
        }),
      );
    else if (mode === "publication")
      await writeFile(resolve(f.priorSource, "publication.json"), "{}");
    else {
      const value = { ...f.prior };
      if (mode === "phase") value.phase = "delivery";
      if (mode === "issue") value.issue = "https://github.com/chase-sets/chase-sets/issues/999";
      if (mode === "item") value.item = "borrowed:3";
      if (mode === "head") value.head = f.selected.base;
      if (mode === "attempt") value.candidateAttempt = 3;
      if (mode === "history") value.history = value.history.slice(0, 7);
      await writeFile(path, JSON.stringify(value));
    }
    await expect(f.compose()).rejects.toThrow();
    await expect(
      readFile(
        resolve(
          f.loop.stateRoot,
          f.loop.run,
          f.loop.acceptedReplan.attemptSlug,
          "setup/setup-plan.json",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
  30_000,
);

it.each(["absent", "invalid", "fail", "pass", "author-fail"])(
  "runs the real composed source lifecycle through %s operator evidence and restart",
  async (mode) => {
    const f = await unpublishedReplanFixture();
    const q = await f.compose();
    const item = q.items[0]!;
    const launches: string[] = [];
    const git = async (cwd: string, args: string[]) =>
      (await execute(f.gitExecutable, ["-C", cwd, ...args])).stdout.trim();
    const native: Adapter = {
      async preflight() {},
      git,
      async launch(role, config) {
        launches.push(role);
        if (role === "author")
          await writeFile(resolve(config.worktree, f.file), "two corrected production reads\n");
        return {
          id: randomUUID(),
          pid: 111,
          trace: resolve(q.stateDirectory, `${role}.trace`),
          launchedAt: Date.now(),
        };
      },
      async observe(role, config, attempt) {
        if (role === "reviewer") return { id: attempt.id, status: "running" };
        return {
          id: attempt.id,
          status: mode === "author-fail" ? "failed" : "passed",
          head: config.base,
        };
      },
      async checks() {
        throw new Error("No publication before review");
      },
    };
    const adapter = repositoryQueueAdapter(q, f.repository, {
      native,
      setup: f.setup,
      gitExecutable: f.gitExecutable,
      async assertExecutor() {},
    });
    if (mode === "author-fail") {
      await expect(queueStep(q, adapter)).rejects.toThrow("continuation-failed");
      await expect(queueStep(await f.compose(), adapter)).rejects.toThrow(
        "implementation-attempt-ceiling-exhausted",
      );
      const saved = JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"));
      expect(saved).toMatchObject({ phase: "failed", candidateAttempt: 5, head: f.head });
      expect(saved.history.at(-1)).toMatchObject({ role: "author", outcome: "failed" });
      expect(launches).toEqual(["author"]);
      return;
    }
    await expect(queueStep(q, adapter)).rejects.toThrow("operator-evidence-required");
    const candidate = JSON.parse(
      await readFile(resolve(item.source.stateDirectory, "candidate.json"), "utf8"),
    );
    expect(candidate.changed).toEqual([f.file, "jpeg.txt"]);
    const descriptor = f.loop.acceptedReplan.preReviewEvidence!;
    if (mode !== "absent")
      await writeEvidence(
        descriptor,
        f.loop.repository,
        mode === "invalid" ? f.head : candidate.head,
        mode === "fail" ? { exitCode: 1 } : {},
      );
    const resume = async () => {
      const replay = await f.compose();
      return queueStep(
        replay,
        repositoryQueueAdapter(replay, f.repository, {
          native,
          setup: f.setup,
          gitExecutable: f.gitExecutable,
          async assertExecutor() {},
        }),
      );
    };
    if (mode === "pass") {
      await expect(resume()).resolves.toMatchObject({ status: "observing-reviewer" });
      await Promise.all(Object.values(descriptor.bundle).map((path) => rm(path)));
      await expect(resume()).resolves.toMatchObject({ status: "observing-reviewer" });
      expect(launches).toEqual(["author", "reviewer"]);
    } else {
      await expect(resume()).rejects.toThrow(
        mode === "absent"
          ? "operator-evidence-required"
          : mode === "invalid"
            ? "operator-evidence-authority"
            : "operator-evidence-failed",
      );
      if (mode === "fail") {
        await writeEvidence(descriptor, f.loop.repository, candidate.head);
        await expect(resume()).rejects.toThrow("implementation-attempt-ceiling-exhausted");
        const saved = JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"));
        expect(saved).toMatchObject({ phase: "failed", candidateAttempt: 5, head: candidate.head });
        expect(saved.history).toHaveLength(f.history.length + 1);
      }
      expect(launches).toEqual(["author"]);
    }
  },
  30_000,
);

it("validates the closed packet before any setup, including its evidence descriptor", async () => {
  const f = await loopFixture();
  const packet = replanPacket(f.loop.stateRoot);
  const config = {
    ...f.loop,
    repository: packet.repository,
    run: packet.targetRun,
    acceptedReplan: packet,
  };
  validateLoopConfig(config);
  const negatives: Record<string, unknown>[] = [
    { extra: true },
    { schemaVersion: "future" },
    { priorAbsoluteAttempt: 3 },
    { priorAbsoluteAttempt: 5, nextAbsoluteAttempt: 6, absoluteCeiling: 6 },
    { nextAbsoluteAttempt: 6 },
    { absoluteCeiling: 6 },
    { priorHistoryDigest: "missing" },
    { candidateHead: "main" },
    { targetRun: "renewed" },
    { priorRun: "../prior" },
    { priorAttemptDirectory: "relative/attempt" },
    { attemptSlug: "../attempt-5" },
    { authorityUrl: "issue prose" },
    { publication: {} },
    ...[
      [],
      ["."],
      ["/absolute"],
      ["C:\\absolute"],
      ["../escape"],
      ["a/../b"],
      ["a//b"],
      ["a/"],
      ["a", "a"],
      ["a/*"],
      [".git/config"],
    ].map((allowedPaths) => ({ allowedPaths })),
    {
      preReviewEvidence: {
        ...evidenceDescriptor(resolve(f.loop.stateRoot, "evidence")),
        extra: true,
      },
    },
    {
      preReviewEvidence: { ...evidenceDescriptor(resolve(f.loop.stateRoot, "evidence")), skips: 1 },
    },
    {
      preReviewEvidence: {
        ...evidenceDescriptor(resolve(f.loop.stateRoot, "evidence")),
        receiptSchema: "unknown",
      },
    },
    {
      preReviewEvidence: {
        ...evidenceDescriptor(resolve(f.loop.stateRoot, "evidence")),
        command: { executable: "pnpm" },
      },
    },
  ];
  for (const delta of negatives)
    expect(
      () =>
        validateLoopConfig({ ...config, acceptedReplan: { ...packet, ...delta } } as LoopConfig),
      JSON.stringify(delta),
    ).toThrow();
  expect(() => validateLoopConfig({ ...f.loop, attemptCeiling: 5 })).toThrow(
    "invalid-attempt-ceiling",
  );
});

it("refuses widened directory authority and a packet whose source paths changed on replay", async () => {
  const f = await unpublishedReplanFixture();
  await expect(
    f.compose({
      ...f.loop,
      acceptedReplan: { ...f.loop.acceptedReplan, allowedPaths: ["bounded-contexts"] },
    }),
  ).rejects.toThrow("accepted-replan-path-widened");
  const q = await f.compose();
  q.items[0]!.source.correctionPaths = ["."];
  expect(() => validateQueueConfig(q)).toThrow("accepted-replan-binding-mismatch");
}, 30_000);

it("admits only the accepted replan beside preserved workspaces and refuses renewal by run name", async () => {
  const f = await acceptedReplanFixture();
  const { acceptedReplan: _accepted, ...absent } = f.loop;
  await expect(f.compose(absent)).rejects.toThrow("accepted-replan-required");
  await expect(f.compose({ ...f.loop, run: "another-fresh-run" })).rejects.toThrow(
    "invalid-accepted-replan",
  );
  await expect(f.compose({ ...f.loop, repository: "other/repository" })).rejects.toThrow(
    "invalid-accepted-replan",
  );
  const queue = await f.compose();
  validateQueueConfig(queue);
  const item = queue.items[0]!;
  expect(item).toMatchObject({
    implementationAttempt: 5,
    implementationAttemptCeiling: 5,
    base: f.head,
    source: { base: f.head, mainBase: f.selected.base },
    delivery: {
      refresh: { number: 8005, head: f.head, localBranch: "codex/7766-jpeg-g5" },
      policy: { sourceBranch: "codex/7766-jpeg-g4" },
    },
  });
  expect(queue.initialHistory).toEqual(f.history);
  for (const actor of [item.source.author, item.source.reviewer]) {
    expect(actor.prompt).toContain("route-collision inventory");
    expect(actor.prompt).toContain("hosted-failure.log");
    expect(actor.prompt).toContain("5665159522");
    expect(actor.prompt).toContain("cs-7766-attempt-4");
  }
  await expect(setupStep(item.setup, f.setup, f.repository)).resolves.toMatchObject({
    status: "ready",
  });
  expect(await f.compose()).toEqual(queue);
  for (const [path, value] of f.preserved) expect(await readFile(path, "utf8")).toBe(value);
  expect(await f.git(["rev-parse", "codex/7766-jpeg-g4"])).toBe(f.head);
  expect(await readFile(resolve(item.source.worktree, "jpeg.txt"), "utf8")).toBe(
    "preserved JPEG implementation\n",
  );
  expect(await f.git(["status", "--porcelain"])).toBe("");
}, 30_000);

it.each(["pilot", "source", "review", "branch"])(
  "refuses an unrelated accepted-replan %s collision",
  async (role) => {
    const f = await acceptedReplanFixture();
    const item = (await f.compose()).items[0]!;
    if (role === "branch") await f.git(["branch", item.setup.sourceBranch, f.head]);
    else {
      const path =
        role === "pilot"
          ? item.setup.pilotWorktree
          : role === "source"
            ? item.source.worktree
            : item.source.reviewWorktree;
      await mkdir(path, { recursive: true });
      await writeFile(resolve(path, "unrelated.txt"), "preserve me\n");
    }
    await expect(setupStep(item.setup, f.setup, f.repository)).rejects.toThrow(
      `worktree-collision:${role === "branch" ? "source" : role}`,
    );
    for (const [path, value] of f.preserved) expect(await readFile(path, "utf8")).toBe(value);
  },
  30_000,
);

it("stops accepted correction before setup when its original failed log is unavailable", async () => {
  const f = await acceptedReplanFixture();
  const evidence = [...f.preserved.keys()].find((path) => path.endsWith("hosted-failure.log"))!;
  await rm(evidence);
  await expect(f.compose()).rejects.toThrow("hosted-failure-evidence-unavailable");
  await expect(
    readFile(resolve(f.loop.stateRoot, f.loop.run, ACCEPTED_REPLAN.slug, "attempt.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);

it.each([false, true])(
  "retains accepted lineage on external closure (current participants: %s)",
  async (launched) => {
    const f = await acceptedReplanFixture();
    const cycle = { selection: { ...f.selected, cycle: 1 }, initialHistory: [] };
    await persistCycle(f.loop, cycle);
    const queue = await f.compose();
    const history = launched
      ? [
          ...f.history,
          participant(10, queue.items[0]!.id, "source", "author", "passed"),
          participant(11, queue.items[0]!.id, "source", "reviewer", "failed"),
        ]
      : f.history;
    if (launched)
      for (const value of history)
        await writeFile(
          resolve(queue.stateDirectory, `participant-${value.ordinal}-terminal.json`),
          JSON.stringify(value),
        );
    const adapter = {
      async issue() {
        return { number: 7766, key: "cs-7766", state: "CLOSED" as const, labels: [], comments: [] };
      },
      async currentMain(): Promise<string> {
        throw new Error("No successor");
      },
      async removeReady() {
        throw new Error("Already closed");
      },
      async close() {
        throw new Error("Already closed");
      },
      async comment() {
        throw new Error("No stop");
      },
    };
    const policy = { ...repositoryPolicy, selectCandidates: () => [] };
    await expect(nextCycle(f.loop, f.repository, adapter, policy)).resolves.toBeUndefined();
    await expect(nextCycle(f.loop, f.repository, adapter, policy)).resolves.toBeUndefined();
    const completed = JSON.parse(
      await readFile(resolve(f.loop.stateRoot, f.loop.run, "cycle-1-complete.json"), "utf8"),
    );
    expect(completed.history).toEqual(history);
    for (const [path, value] of f.preserved) expect(await readFile(path, "utf8")).toBe(value);
  },
  30_000,
);

it.each(["review-failure", "hosted-failure", "complete"])(
  "consumes one accepted correction through %s and restart",
  async (outcome) => {
    const f = await acceptedReplanFixture();
    const queue = await f.compose();
    const history = structuredClone(f.history);
    const calls: string[] = [];
    let observing = true;
    const findings = [
      { file: "jpeg.txt", line: 1, severity: "blocking" as const, text: "Fix route inventory" },
    ];
    const adapter: QueueAdapter = {
      async assertExecutor() {},
      async history() {
        return history;
      },
      async setup() {
        calls.push("setup");
        return { status: "ready" };
      },
      async source(item) {
        if (observing) return { status: "observing-author" };
        calls.push("current-author-and-review");
        history.push(
          participant(10, item.id, "source", "author", "passed"),
          participant(
            11,
            item.id,
            "source",
            "reviewer",
            outcome === "review-failure" ? "failed" : "passed",
          ),
        );
        return outcome === "review-failure"
          ? { status: "fixable-review", head: "b".repeat(40), reviewId: history[10]!.id, findings }
          : {
              status: "accepted",
              head: "b".repeat(40),
              reviewId: history[10]!.id,
              stateDirectory: item.source.stateDirectory,
            };
      },
      async repair() {
        throw new Error("No second correction authorized");
      },
      async delivery(item, accepted) {
        calls.push("current-delivery");
        return outcome === "hosted-failure"
          ? { status: "failed", head: accepted.head, reviewId: accepted.reviewId, findings }
          : deliveryCompletion(
              item,
              accepted.head,
              accepted.reviewId,
              8005,
              item.setup.sourceBranch,
            );
      },
    };
    await expect(queueStep(queue, adapter)).resolves.toMatchObject({ status: "observing-author" });
    expect(calls).toEqual(["setup"]);
    observing = false;
    const finish = async () => queueStep(await f.compose(), adapter);
    if (outcome === "complete") {
      await expect(finish()).resolves.toMatchObject({ status: "complete", participants: 11 });
      await expect(finish()).resolves.toMatchObject({ status: "complete", participants: 11 });
    } else {
      await expect(finish()).rejects.toThrow("implementation-attempt-ceiling-exhausted");
      await expect(finish()).rejects.toThrow("implementation-attempt-ceiling-exhausted");
    }
    expect(calls).toEqual([
      "setup",
      "current-author-and-review",
      ...(outcome === "review-failure" ? [] : ["current-delivery"]),
    ]);
    const saved = JSON.parse(await readFile(resolve(queue.stateDirectory, "attempt.json"), "utf8"));
    expect(saved.candidateAttempt).toBe(5);
    expect(saved.history.slice(0, 9)).toEqual(f.history);
    for (const [path, value] of f.preserved) expect(await readFile(path, "utf8")).toBe(value);
  },
  30_000,
);

it("validates an optional Chase Sets milestone number and keeps self runs unscoped", async () => {
  const { loop } = await loopFixture();
  expect(() => validateLoopConfig(loop)).not.toThrow();
  expect(() =>
    validateLoopConfig({ ...loop, adapter: "chase-sets", targetMilestone: 155, routingRows: [] }),
  ).not.toThrow();
  for (const targetMilestone of [
    0,
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "155",
    null,
  ]) {
    expect(() =>
      validateLoopConfig({
        ...loop,
        adapter: "chase-sets",
        targetMilestone,
      } as unknown as LoopConfig),
    ).toThrow("invalid-target-milestone");
  }
  expect(() => validateLoopConfig({ ...loop, targetMilestone: 155 })).toThrow(
    "target-milestone-unsupported-adapter",
  );
});

it("validates the singleton ops admission at the config boundary", async () => {
  const { loop } = await loopFixture();
  const opsAdmission = {
    issueNumber: 9001,
    authorityUrl: "https://github.com/chase-sets/chase-sets/issues/4388#issuecomment-5707757731",
  };
  const config: LoopConfig = {
    ...loop,
    adapter: "chase-sets",
    repository: "chase-sets/chase-sets",
    targetMilestone: 155,
    routingRows: [],
    opsAdmission,
  };
  const selectionInput: Parameters<RepositoryAdapter["selectCandidates"]>[0] = {
    repository: config.repository,
    executorRoot: config.stableExecutorRoot,
    targetMilestone: 155,
    opsAdmission,
  };
  const contextInput: Parameters<RepositoryAdapter["issueContext"]>[0] = {
    ...selectionInput,
    key: "cs-9001",
    number: 9001,
  };
  expect(contextInput.opsAdmission).toEqual(opsAdmission);
  expect(() => validateLoopConfig(config)).not.toThrow();
  expect(() =>
    validateLoopConfig({
      ...config,
      opsAdmission: { ...opsAdmission, issueNumber: Number.MAX_SAFE_INTEGER },
    }),
  ).not.toThrow();
  const prefix = "https://github.com/chase-sets/chase-sets/issues/1#issuecomment-";
  for (const length of [499, 500, 501]) {
    const check = () =>
      validateLoopConfig({
        ...config,
        opsAdmission: {
          ...opsAdmission,
          authorityUrl: prefix + "1".repeat(length - prefix.length),
        },
      });
    if (length <= 500) expect(check).not.toThrow();
    else expect(check).toThrow("invalid-ops-admission");
  }
  expect(() => validateLoopConfig(loop)).not.toThrow();
  const { opsAdmission: omitted, ...legacy } = config;
  expect(omitted).toEqual(opsAdmission);
  expect(() => validateLoopConfig(legacy)).not.toThrow();
  const { targetMilestone: target, ...unscoped } = legacy;
  expect(target).toBe(155);
  expect(() => validateLoopConfig(unscoped)).not.toThrow();
  expect(() => validateLoopConfig({ ...unscoped, opsAdmission })).toThrow("invalid-ops-admission");
  expect(() => validateLoopConfig({ ...loop, opsAdmission })).toThrow("invalid-ops-admission");
  expect(() => validateLoopConfig({ ...config, repository: "other/repo" })).toThrow(
    "invalid-ops-admission",
  );
  expect(() => validateLoopConfig({ ...config, targetMilestone: 0 })).toThrow(
    "invalid-target-milestone",
  );
  for (const value of [
    null,
    [],
    [opsAdmission],
    "9001",
    {},
    { issueNumber: 9001 },
    { ...opsAdmission, milestone: 155 },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "9001", [9001], "*"].map((issueNumber) => ({
      ...opsAdmission,
      issueNumber,
    })),
    ...[
      null,
      1,
      "http://github.com/chase-sets/chase-sets/issues/1#issuecomment-2",
      "https://github.com/other/repo/issues/1#issuecomment-2",
      "https://user@github.com/chase-sets/chase-sets/issues/1#issuecomment-2",
      "https://github.com/chase-sets/chase-sets/issues/0#issuecomment-2",
      "https://github.com/chase-sets/chase-sets/issues/1#issuecomment-0",
      `${opsAdmission.authorityUrl}?x=1`,
      `${opsAdmission.authorityUrl}\n`,
      opsAdmission.authorityUrl.replace("4388", "1".repeat(500)),
    ].map((authorityUrl) => ({ ...opsAdmission, authorityUrl })),
  ]) {
    // Exercise the same untyped JSON boundary as a loaded loop config.
    const parsed: LoopConfig = JSON.parse(JSON.stringify({ ...config, opsAdmission: value }));
    expect(() => validateLoopConfig(parsed), JSON.stringify(value)).toThrow(
      "invalid-ops-admission",
    );
  }
});

it("validates and carries the provider outage ceiling into worker configuration", async () => {
  const { loop, repository, selected } = await loopFixture();
  for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    expect(() => validateLoopConfig({ ...loop, providerOutageCeilingMs: value })).toThrow(
      "invalid-provider-outage-ceiling",
    );
  }
  const queue = await queueConfigFromLoop(
    { ...loop, providerOutageCeilingMs: 12_345 },
    repository,
    selected,
    repositoryPolicy,
  );
  expect(queue.items[0]!.source.providerOutageCeilingMs).toBe(12_345);
});

it("binds a refresh to a later attempt whose exact prior head is its source base", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  item.implementationAttempt = 1;
  item.delivery.refresh = {
    number: 341,
    url: "https://example.test/pull/341",
    head: item.base,
  };
  expect(() => validateQueueConfig(current.config)).toThrow("malformed-publication-refresh");

  item.implementationAttempt = 2;
  expect(() => validateQueueConfig(current.config)).not.toThrow();

  item.delivery.refresh.head = "f".repeat(40);
  expect(() => validateQueueConfig(current.config)).toThrow("malformed-publication-refresh");
});

it("admits repository-wide source scope without a pre-authored repair path list", async () => {
  const current = await fixture();
  current.items[0]!.source.allowedPaths = ["."];
  expect(() => validateQueueConfig(current.config)).not.toThrow();
});

it("resolves ladders before setup and rejects the old fixed-seat config", async () => {
  const f = await loopFixture();
  const rows: RoutingRow[] = JSON.parse(
    await readFile(new URL("../../adapters/chase-sets-routing.json", import.meta.url), "utf8"),
  );
  const row = rows.find((row) => row.row === 7 && row.review === 11)!;
  const policy: RepositoryAdapter = {
    ...repositoryPolicy,
    issueContext: async (input) => ({
      ...(await repositoryPolicy.issueContext(input)),
      routing: { row: 7, review: 11 },
    }),
  };
  const config = { ...f.loop, adapter: "chase-sets", routingRows: [] };
  expect(() =>
    validateLoopConfig({
      ...config,
      routingRows: [
        {
          row: 7,
          review: 11,
          author: SELF_ROUTING.author[0],
          reviewer: { ...SELF_ROUTING.reviewer[0], fallback: SELF_ROUTING.reviewer[1] },
          repair: SELF_ROUTING.author[0],
        },
      ],
    } as unknown as LoopConfig),
  ).toThrow("invalid-routing-row");
  await expect(queueConfigFromLoop(config, f.repository, f.selected, policy)).rejects.toThrow(
    "routing-row-unconfigured",
  );
  await expect(
    readFile(resolve(f.stateRoot, config.run, "iss-104-attempt-1/setup/config.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const queue = await queueConfigFromLoop(
    { ...config, routingRows: rows },
    f.repository,
    f.selected,
    policy,
  );
  expect(queue.items[0]?.source).toMatchObject({
    routing: { row: 7, review: 11 },
    author: { model: "gpt-6-astra", effort: "high", ladder: row.author },
    reviewer: { model: "claude-opus-5-5", effort: "high", ladder: row.reviewer },
  });
  expect(queue.items[0]?.repair.author).toMatchObject({ ...row.author[0], ladder: row.author });
  const self = await queueConfigFromLoop(
    { ...f.loop, repository: "todd-skelton/orchestration-platform", routingRows: rows },
    f.repository,
    f.selected,
    selfAdapter,
  );
  expect(self.items[0]?.source).toMatchObject({
    routing: { row: "self" },
    author: { model: "gpt-6-astra", effort: "high", ladder: SELF_ROUTING.author },
    reviewer: { model: "claude-opus-5-5", effort: "high", ladder: SELF_ROUTING.reviewer },
  });
  const {
    author: _author,
    reviewer: _reviewer,
    ...withoutStatic
  } = { ...config, routingRows: [row] };
  expect(() => validateLoopConfig(withoutStatic)).not.toThrow();
  expect(() => validateLoopConfig({ ...f.loop, adapter: "chase-sets" })).toThrow(
    "routing-table-required",
  );
});

it("composes all shipped Chase pairs before setup and reconstructs the same selection", async () => {
  const f = await loopFixture();
  const rows: RoutingRow[] = JSON.parse(
    await readFile(new URL("../../adapters/chase-sets-routing.json", import.meta.url), "utf8"),
  );
  const expected = [
    [2, "gpt-6-luna", "high", "claude-opus-5-5"],
    [3, "claude-opus-5-5", "medium", "gpt-6-sol"],
    [4, "gpt-6-astra", "medium", "claude-opus-5-5"],
    [7, "gpt-6-astra", "high", "claude-opus-5-5"],
    [10, "gpt-6-sol", "high", "claude-opus-5-5"],
    [14, "claude-opus-5-5", "medium", "gpt-6-sol"],
    [15, "claude-opus-5-5", "high", "gpt-6-sol"],
  ] as const;
  for (const [row, author, effort, reviewer] of expected) {
    for (const review of [11, 12] as const) {
      const routing = { row, review };
      const selected = f.selected;
      const loop = {
        ...f.loop,
        run: `shipped-${row}-${review}`,
        adapter: "chase-sets",
        routingRows: rows,
      };
      const policy: RepositoryAdapter = {
        ...repositoryPolicy,
        issueContext: async (input) => ({
          ...(await repositoryPolicy.issueContext(input)),
          routing,
        }),
      };
      const queue = await queueConfigFromLoop(loop, f.repository, selected, policy);
      expect(queue.items[0]!.source).toMatchObject({
        routing,
        author: { model: author, effort, rung: 0 },
        reviewer: { model: reviewer, effort: review === 11 ? "high" : "medium", rung: 0 },
      });
      const shipped = rows.find((entry) => entry.row === row && entry.review === review)!;
      expect(queue.items[0]!.source.author.ladder).toEqual(shipped.author);
      expect(queue.items[0]!.source.reviewer.ladder).toEqual(shipped.reviewer);
      expect(await queueConfigFromLoop(loop, f.repository, selected, policy)).toEqual(queue);
      await expect(
        readFile(resolve(queue.items[0]!.setup.stateDirectory, "config.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  }
});

it("derives the complete internal queue from one compact loop config and selected issue", async () => {
  const { loop, repository, stateRoot, selected } = await loopFixture();
  await expect(
    queueConfigFromLoop({ ...loop, run: ".." }, repository, selected, repositoryPolicy),
  ).rejects.toThrow("invalid-run");
  const queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);

  expect(queue.items).toHaveLength(1);
  expect(queue.controller).toBe(`loop:${loop.run}`);
  expect(queue.items[0]).toMatchObject({
    id: "ISS-104:1",
    implementationAttempt: 1,
    implementationAttemptCeiling: 4,
    source: {
      allowedPaths: ["."],
      author: { model: "gpt-5.6-sol", effort: "high" },
      reviewer: { model: "claude-opus-5", effort: "high" },
    },
    delivery: {
      policy: {
        key: "ISS-104",
        number: 361,
        title: "One config",
      },
    },
  });
  expect(queue.stateDirectory).toBe(
    resolve(await realpath(stateRoot), loop.run, "iss-104-attempt-1"),
  );
  expect(queue.items[0]!.setup.stateDirectory).toBe(resolve(queue.stateDirectory, "setup"));
  expect(queue.items[0]!.source.stateDirectory).toBe(resolve(queue.stateDirectory, "source"));
  expect(queue.items[0]!.repair.stateDirectory).toBe(resolve(queue.stateDirectory, "repair"));
  expect(queue.items[0]!.source.author.prompt).toContain("Keep it small.");
  expect(queue.items[0]!.source.author.prompt).toContain("One file drives the run.");
  expect(queue.items[0]!.repair).not.toHaveProperty("sourcePaths");
}, 30_000);

it("keeps the real self adapter's configured author gates mandatory before reporting", async () => {
  const { loop, repository, selected } = await loopFixture();
  const queue = await queueConfigFromLoop(
    { ...loop, repository: "todd-skelton/orchestration-platform" },
    repository,
    selected,
    selfAdapter,
  );
  const source = queue.items[0]!.source;
  expect(source.localGates).toEqual(["typecheck", "format:check", "test"]);
  const prompt = workerPrompt(source, "author", source.base, source.author.prompt);
  expect(prompt).toContain(
    "Before reporting, run `pnpm typecheck`, `pnpm format:check` and `pnpm test` in this worktree, and fix what fails.",
  );
  expect(prompt).not.toContain("are not prerequisites for your source report");
  const { localGates: _gates, ...implicitDefaults } = source;
  expect(prompt).toBe(workerPrompt(implicitDefaults, "author", source.base, source.author.prompt));
});

it("recomposes a polled attempt and resumes its recorded phase", async () => {
  const { loop, repository, selected } = await loopFixture();
  const first = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
  const history: QueueParticipant[] = [];
  let setupCalls = 0;
  let sourceCalls = 0;
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      setupCalls += 1;
      return { status: "ready" };
    },
    async source(item) {
      sourceCalls += 1;
      if (sourceCalls === 1) return { status: "observing-author" };
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(item, accepted) {
      return deliveryCompletion(item, accepted.head, accepted.reviewId, 1, "codex/iss-104");
    },
  };

  await expect(queueStep(first, adapter)).resolves.toMatchObject({
    status: "observing-author",
  });
  const restarted = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
  expect(restarted.stateDirectory).toBe(first.stateDirectory);
  await expect(queueStep(restarted, adapter)).resolves.toMatchObject({
    status: "complete",
  });
  expect({ setupCalls, sourceCalls }).toEqual({ setupCalls: 1, sourceCalls: 2 });
}, 30_000);

it("counts dead launches while excluding them from the accepted author-review pair", async () => {
  const current = await fixture();
  current.config.nativeLaunchCeiling = 4;
  const item = current.config.items[0]!;
  const history = [
    { ...participant(1, item.id, "source", "author", "dead"), id: "dead-author" },
    participant(2, item.id, "source", "author", "passed"),
    { ...participant(3, item.id, "source", "reviewer", "dead"), id: "dead-reviewer" },
    participant(4, item.id, "source", "reviewer", "passed"),
  ];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source() {
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[3]!.id,
        stateDirectory: item.source.stateDirectory,
        retries: 1,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(_item, accepted) {
      return deliveryCompletion(item, accepted.head, accepted.reviewId);
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "complete",
    participants: 4,
  });
});

it("runs the composed self-repository setup through the real Git adapter", async () => {
  const { loop, repository, gitExecutable, selected } = await loopFixture();
  const queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
  const setup = queue.items[0]!.setup;
  expect(setup.repositoryRoot).toBe(setup.controllerRoot);

  const adapter = gitSetupAdapter({
    gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  await expect(setupStep(setup, adapter, repository)).resolves.toMatchObject({
    status: "ready",
    phase: "complete",
  });
  await expect(
    execute(gitExecutable, ["-C", setup.sourceWorktree, "rev-parse", "HEAD"]),
  ).resolves.toMatchObject({ stdout: `${selected.base}\n` });
}, 30_000);

const freshRuns = ["fresh-one", "fresh-two", "fresh..three.lock"];

it.each(freshRuns)(
  "authors fresh run %s beside a preserved issue worktree and reuses it on resume",
  async (run) => {
    const f = await loopFixture();
    const git = async (args: string[], cwd = f.repository) =>
      (await execute(f.gitExecutable, ["-C", cwd, ...args])).stdout.trim();
    const preserved = resolve(f.repository, "..", "preserved-source");
    await git(["worktree", "add", "-b", "codex/iss-104", preserved, f.selected.base]);
    await writeFile(resolve(preserved, "unfinished.txt"), "preserved work\n");
    const preservedStatus = await git(["status", "--porcelain"], preserved);
    let installs = 0;
    const setupAdapter = gitSetupAdapter({
      async install(_launcher, _args, cwd) {
        installs++;
        await mkdir(resolve(cwd, "node_modules"), { recursive: true });
        await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
        return "succeeded";
      },
    });
    const loop = { ...f.loop, run, worktreeRoot: resolve(f.loop.worktreeRoot, run) };
    const queue = await queueConfigFromLoop(loop, f.repository, f.selected, repositoryPolicy);
    const item = queue.items[0]!;
    expect(item.delivery.policy).toMatchObject({ sourceBranch: "codex/iss-104" });
    expect(item.delivery.localBranch).toBe(item.setup.sourceBranch);
    const adapter = repositoryQueueAdapter(queue, f.repository, { setup: setupAdapter });
    let authors = 0;
    const toAuthor = {
      ...adapter,
      async source() {
        authors++;
        return { status: "observing-author" as const };
      },
    };
    await expect(queueStep(queue, toAuthor)).resolves.toMatchObject({ status: "observing-author" });
    expect(authors).toBe(1);
    expect(installs).toBe(3);
    const before = await git(["worktree", "list", "--porcelain"]);
    const resumed = await queueConfigFromLoop(loop, f.repository, f.selected, repositoryPolicy);
    expect(resumed).toEqual(queue);
    await expect(
      setupStep(resumed.items[0]!.setup, setupAdapter, f.repository),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(queueStep(resumed, toAuthor)).resolves.toMatchObject({
      status: "observing-author",
    });
    expect(authors).toBe(2);
    expect(installs).toBe(3);
    expect(await git(["worktree", "list", "--porcelain"])).toBe(before);
    expect(await git(["branch", "--show-current"], item.setup.sourceWorktree)).toBe(
      item.setup.sourceBranch,
    );
    for (const path of [item.setup.pilotWorktree, item.setup.reviewWorktree])
      expect(await git(["branch", "--show-current"], path)).toBe("");
    expect(await git(["branch", "--show-current"], preserved)).toBe("codex/iss-104");
    expect(await git(["rev-parse", "HEAD"], preserved)).toBe(f.selected.base);
    expect(await git(["status", "--porcelain"], preserved)).toBe(preservedStatus);
    expect(await readFile(resolve(preserved, "unfinished.txt"), "utf8")).toBe("preserved work\n");
  },
  30_000,
);

it("composes distinct Git-safe source branches across coexisting fresh runs without installs", async () => {
  const f = await loopFixture();
  const git = async (args: string[], cwd = f.repository) =>
    (await execute(f.gitExecutable, ["-C", cwd, ...args])).stdout.trim();
  const preserved = resolve(f.repository, "..", "preserved-source");
  await git(["worktree", "add", "-b", "codex/iss-104", preserved, f.selected.base]);
  await writeFile(resolve(preserved, "unfinished.txt"), "preserved work\n");
  const preservedStatus = await git(["status", "--porcelain"], preserved);
  const adapter = gitSetupAdapter({ gitExecutable: f.gitExecutable });
  const branches = new Set<string>();
  const sources: QueueItem["setup"][] = [];
  for (const run of freshRuns) {
    const loop = { ...f.loop, run, worktreeRoot: resolve(f.loop.worktreeRoot, run) };
    const queue = await queueConfigFromLoop(loop, f.repository, f.selected, repositoryPolicy);
    const item = queue.items[0]!;
    const branch = item.setup.sourceBranch;
    branches.add(branch);
    await expect(
      execute(f.gitExecutable, ["-C", f.repository, "check-ref-format", "--branch", branch]),
    ).resolves.toMatchObject({ stdout: `${branch}\n` });
    await adapter.assertExecutor(item.setup, f.repository);
    await expect(adapter.observeWorktree(item.setup, "source", false)).resolves.toEqual({
      state: "absent",
    });
    await adapter.createWorktree(item.setup, "source");
    await expect(adapter.observeWorktree(item.setup, "source", true)).resolves.toEqual({
      state: "confirmed",
      head: f.selected.base,
      branch,
    });
    sources.push(item.setup);
  }
  expect(branches.size).toBe(3);
  const registered = (await git(["worktree", "list", "--porcelain"])).split("\n\n");
  for (const { sourceWorktree, sourceBranch } of sources)
    expect(registered).toContain(
      `worktree ${sourceWorktree.replaceAll("\\", "/")}\nHEAD ${f.selected.base}\nbranch refs/heads/${sourceBranch}`,
    );
  expect(registered).toContain(
    `worktree ${(await realpath(preserved)).replaceAll("\\", "/")}\nHEAD ${f.selected.base}\nbranch refs/heads/codex/iss-104`,
  );
  expect(await git(["branch", "--show-current"], preserved)).toBe("codex/iss-104");
  expect(await git(["rev-parse", "HEAD"], preserved)).toBe(f.selected.base);
  expect(await git(["status", "--porcelain"], preserved)).toBe(preservedStatus);
  expect(await readFile(resolve(preserved, "unfinished.txt"), "utf8")).toBe("preserved work\n");
}, 30_000);

it("retains a legacy attempt's published local branch from its saved setup plan", async () => {
  const f = await loopFixture();
  const queue = await queueConfigFromLoop(f.loop, f.repository, f.selected, repositoryPolicy);
  const setup = { ...queue.items[0]!.setup, sourceBranch: "codex/iss-104" };
  const adapter = gitSetupAdapter({
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  await setupStep(setup, adapter, f.repository);
  const resumed = await queueConfigFromLoop(f.loop, f.repository, f.selected, repositoryPolicy);
  expect(resumed.items[0]!.setup).toEqual(setup);
  expect(resumed.items[0]!.delivery).not.toHaveProperty("localBranch");
  await expect(setupStep(resumed.items[0]!.setup, adapter, f.repository)).resolves.toMatchObject({
    status: "ready",
  });
}, 30_000);

async function retainedPilotFixture(partialWork = false) {
  const f = await loopFixture();
  const selected = { ...f.selected, planningRevision: f.selected.base };
  const compose = () => queueConfigFromLoop(f.loop, f.repository, selected, repositoryPolicy);
  const first = await compose();
  const item = first.items[0]!;
  const real = codexAdapter(f.gitExecutable);
  let launches = 0;
  let observations = 0;
  const native: Adapter = {
    ...real,
    async preflight() {},
    async waitForProvider() {},
    async launch(role, config) {
      launches++;
      const id = randomUUID();
      const trace = resolve(config.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, JSON.stringify({ type: "thread.started", thread_id: id }) + "\n");
      return { id, pid: process.pid, trace, launchedAt: Date.now() };
    },
    async observe(...args) {
      observations++;
      return real.observe(...args);
    },
  };
  const setup = gitSetupAdapter({
    gitExecutable: f.gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  const adapter = (q: QueueConfig) =>
    repositoryQueueAdapter(q, f.repository, { native, setup, gitExecutable: f.gitExecutable });
  await expect(queueStep(first, adapter(first))).resolves.toMatchObject({
    status: "observing-author",
  });
  if (partialWork)
    await writeFile(resolve(item.source.worktree, "docs/loop.md"), "Synthetic partial work\n");
  await writeFile(resolve(f.repository, "executor-upgrade.txt"), "Synthetic executor B\n");
  await real.git(f.repository, ["add", "."]);
  await real.git(f.repository, ["commit", "-m", "synthetic executor upgrade"]);
  const upgraded = await real.git(f.repository, ["rev-parse", "HEAD"]);
  expect(upgraded).not.toBe(selected.base);
  return {
    ...f,
    selected,
    first,
    item,
    compose,
    native,
    setup,
    adapter,
    upgraded,
    counts: () => ({ launches, observations }),
  };
}

it.each([false, true])(
  "resumes a saved pilot at A under executor B (partial source: %s)",
  async (partialWork) => {
    const f = await retainedPilotFixture(partialWork);
    const records = await snapshot(f.first.stateDirectory);
    const trees = await snapshot(f.loop.worktreeRoot);
    const before = f.counts();
    const resumed = await f.compose();
    const item = resumed.items[0]!;
    // Run the real flow first: the unchanged base fails here with pilot-revision-moved.
    await expect(
      sourceStep(item.source, f.native, item.setup.pilotWorktree),
    ).resolves.toMatchObject({
      status: "observing-author",
    });
    expect(resumed.controllerRevision).toBe(f.upgraded);
    expect(item.setup.controllerRevision).toBe(f.upgraded);
    expect(item.setup.pilotRevision).toBe(f.selected.base);
    expect(item.source).toEqual(f.item.source);
    if (!partialWork)
      await expect(setupStep(item.setup, f.setup, f.repository)).resolves.toMatchObject({
        status: "ready",
      });
    for (let replay = 0; replay < 2; replay++)
      await expect(queueStep(resumed, f.adapter(resumed))).resolves.toMatchObject({
        status: "observing-author",
      });
    expect(f.counts()).toEqual({
      launches: before.launches,
      observations: before.observations + 3,
    });
    for (const [path, bytes] of records) expect(await readFile(path, "utf8"), path).toBe(bytes);
    expect(await snapshot(f.loop.worktreeRoot)).toEqual(trees);
    await expect(
      readFile(resolve(item.source.stateDirectory, "author-terminal.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const fresh = await queueConfigFromLoop(
      { ...f.loop, run: "synthetic-fresh-after-upgrade" },
      f.repository,
      f.selected,
      repositoryPolicy,
    );
    expect(fresh.items[0]!.setup.pilotRevision).toBe(f.upgraded);
    expect(fresh.items[0]!.source.pilotRevision).toBe(f.upgraded);
  },
);

it("replays real setup explicitly pinned to pilot A at live checkout B", async () => {
  const f = await retainedPilotFixture();
  const records = await snapshot(f.first.stateDirectory);
  const trees = await snapshot(f.loop.worktreeRoot);
  // Isolate the adapter discriminator from queue composition: this fails on
  // both the unchanged base and the queue-only partial with setup-head-drift.
  const setup = { ...f.item.setup, controllerRevision: f.upgraded };
  await expect(setupStep(setup, f.setup, f.repository)).resolves.toMatchObject({
    status: "ready",
    heads: { pilot: f.selected.base },
  });
  await expect(sourceStep(f.item.source, f.native, setup.pilotWorktree)).resolves.toMatchObject({
    status: "observing-author",
  });
  expect(f.counts()).toEqual({ launches: 1, observations: 2 });
  expect(await snapshot(f.first.stateDirectory)).toEqual(records);
  expect(await snapshot(f.loop.worktreeRoot)).toEqual(trees);
});

it.each(["not-a-sha", "f".repeat(40)])(
  "refuses an unresolved saved pilot %s before setup",
  async (pilotRevision) => {
    const f = await retainedPilotFixture();
    const path = resolve(f.item.setup.stateDirectory, "setup-plan.json");
    const plan = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...plan, pilotRevision }));
    const records = await snapshot(f.first.stateDirectory);
    const trees = await snapshot(f.loop.worktreeRoot);
    await expect(f.compose()).rejects.toThrow("invalid-saved-pilot-revision");
    expect(await snapshot(f.first.stateDirectory)).toEqual(records);
    expect(await snapshot(f.loop.worktreeRoot)).toEqual(trees);
    expect(f.counts().launches).toBe(1);
  },
);

it.each(["moved", "dirty"])(
  "still refuses a %s retained pilot after an executor upgrade",
  async (mode) => {
    const f = await retainedPilotFixture();
    const q = await f.compose();
    const item = q.items[0]!;
    if (mode === "moved")
      await f.native.git(item.setup.pilotWorktree, ["checkout", "--detach", f.upgraded]);
    else await writeFile(resolve(item.setup.pilotWorktree, "dirty.txt"), "synthetic drift\n");
    await expect(sourceStep(item.source, f.native, item.setup.pilotWorktree)).rejects.toThrow(
      mode === "moved" ? "pilot-revision-moved" : "dirty-pilot",
    );
    expect(f.counts().launches).toBe(1);
  },
);

it("retains controller, pilot-selection and base drift refusals after an executor upgrade", async () => {
  const f = await retainedPilotFixture();
  await expect(setupStep(f.item.setup, f.setup, f.repository)).rejects.toThrow("setup-head-drift");
  await expect(queueStep(f.first, f.adapter(f.first))).rejects.toThrow(
    "controller-executor-revision-moved",
  );
  const q = await f.compose();
  const item = q.items[0]!;
  item.setup.controllerRevision = f.selected.base;
  expect(() => validateQueueConfig(q)).toThrow("queue-executor-drift");
  item.setup.controllerRevision = f.upgraded;
  item.source.pilotRevision = f.upgraded;
  expect(() => validateQueueConfig(q)).toThrow("candidate-as-pilot-selection");
  item.source.pilotRevision = f.selected.base;
  item.source.base = f.upgraded;
  expect(() => validateQueueConfig(q)).toThrow("queue-base-drift");
});

it("derives and prepares a repository cycle without modifying the controller repository", async () => {
  const { loop, repository, gitExecutable, selected } = await loopFixture();
  const controller = resolve(repository, "..", "controller");
  await mkdir(controller);
  await execute(gitExecutable, ["init", "-b", "main", controller]);
  await execute(gitExecutable, ["-C", controller, "config", "user.name", "Fixture"]);
  await execute(gitExecutable, ["-C", controller, "config", "user.email", "fixture@example.test"]);
  await writeFile(resolve(controller, "controller.txt"), "platform controller\n");
  await execute(gitExecutable, ["-C", controller, "add", "."]);
  await execute(gitExecutable, ["-C", controller, "commit", "-m", "controller"]);
  const controllerRevision = (
    await execute(gitExecutable, ["-C", controller, "rev-parse", "HEAD"])
  ).stdout.trim();
  const [canonicalController, canonicalRepository] = await Promise.all([
    realpath(controller),
    realpath(repository),
  ]);

  const validated = await validateLoopExecutor(loop, controller);
  const queue = await queueConfigFromLoop(
    loop,
    controller,
    selected,
    repositoryPolicy,
    [],
    validated,
  );
  const setup = queue.items[0]!.setup;
  expect(queue).toMatchObject({ controllerRoot: canonicalController, controllerRevision });
  expect(setup).toMatchObject({
    controllerRoot: canonicalController,
    repositoryRoot: canonicalRepository,
    controllerRevision,
    pilotRevision: selected.base,
    base: selected.base,
  });

  await setupStep(
    setup,
    gitSetupAdapter({
      gitExecutable,
      async install(_launcher, _args, cwd) {
        await mkdir(resolve(cwd, "node_modules"), { recursive: true });
        await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
        return "succeeded";
      },
    }),
    controller,
  );
  const repositoryWorktrees = (
    await execute(gitExecutable, ["-C", repository, "worktree", "list", "--porcelain"])
  ).stdout;
  const controllerWorktrees = (
    await execute(gitExecutable, ["-C", controller, "worktree", "list", "--porcelain"])
  ).stdout;
  const comparablePath = (path: string) => {
    const absolute = resolve(path);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  };
  const worktreePaths = (output: string) =>
    output
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => comparablePath(line.slice(9)));
  expect(worktreePaths(repositoryWorktrees)).toContain(comparablePath(setup.sourceWorktree));
  expect(worktreePaths(repositoryWorktrees)).toContain(comparablePath(setup.reviewWorktree));
  expect(worktreePaths(controllerWorktrees)).not.toContain(comparablePath(setup.sourceWorktree));
  expect(await execute(gitExecutable, ["-C", controller, "status", "--porcelain"])).toMatchObject({
    stdout: "",
  });
  expect(
    (await execute(gitExecutable, ["-C", controller, "rev-parse", "HEAD"])).stdout.trim(),
  ).toBe(controllerRevision);
  for (const [field, path] of [
    ["stateRoot", resolve(controller, "runtime-state")],
    ["worktreeRoot", resolve(controller, "runtime-worktrees")],
    ["stateRoot", resolve(repository, "runtime-state")],
    ["worktreeRoot", resolve(repository, "runtime-worktrees")],
  ] as const)
    await expect(validateLoopExecutor({ ...loop, [field]: path }, controller)).rejects.toThrow(
      "loop-roots-overlap",
    );
}, 30_000);

it.each([true, false])(
  "uses real self criteria before setup for a valid selection (supported items: %s)",
  async (supported) => {
    const { loop, repository, gitExecutable, selected } = await loopFixture(
      false,
      supported
        ? "1. First criterion\n   Continued detail\n2. Second criterion"
        : "   Orphan continuation without an item.",
    );
    const queue = queueConfigFromLoop(
      { ...loop, repository: "todd-skelton/orchestration-platform" },
      repository,
      selected,
      selfAdapter,
    );
    if (supported) {
      const item = (await queue).items[0]!;
      expect(item.repair.acceptanceCriteria).toEqual([
        "First criterion\nContinued detail",
        "Second criterion",
      ]);
      expect(item.implementationAttempt).toBe(1);
      expect(item.implementationAttemptCeiling).toBe(4);
    } else {
      await expect(queue).rejects.toMatchObject({ reason: "selected-issue-criteria-missing" });
      expect(await readdir(loop.stateRoot)).toEqual([]);
    }
    expect(await readdir(loop.worktreeRoot)).toEqual([]);
    expect((await execute(gitExecutable, ["-C", repository, "status", "--porcelain"])).stdout).toBe(
      "",
    );
    expect(
      (await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])).stdout.trim(),
    ).toBe(selected.base);
  },
);

it("preserves registered multiline criteria and the pilot through repair resume after upgrade", async () => {
  const { loop, repository, gitExecutable, acceptanceCriteria, selected } = await loopFixture(true);
  let queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
  const item = queue.items[0]!;
  const fixtureQueue = (await import(
    /* @vite-ignore */ pathToFileURL(resolve(repository, "scripts/dogfood/queue.ts")).href
  )) as { repositoryQueueAdapter: typeof repositoryQueueAdapter };
  let repairPrompt = "";
  let pid = 1;
  let repairObservations = 0;
  const native: Adapter = {
    async preflight() {},
    async git(worktree, args) {
      const result = await execute(gitExecutable, ["-C", worktree, ...args]);
      return args.includes("-z") ? result.stdout : result.stdout.trim();
    },
    async launch(role, config, prompt): Promise<Attempt> {
      const repair = config.stateDirectory === item.repair.stateDirectory;
      if (repair) repairPrompt = prompt;
      else if (role === "author")
        await writeFile(resolve(config.worktree, "repair-target.txt"), "repair me\n");
      return {
        id: `${repair ? "repair" : "source"}-${role}`,
        pid: pid++,
        trace: resolve(queue.stateDirectory, `${repair ? "repair" : "source"}-${role}.jsonl`),
        launchedAt: 1,
      };
    },
    async observe(role, config, attempt) {
      if (config.stateDirectory === item.repair.stateDirectory) {
        repairObservations++;
        expect(config.pilotRevision).toBe(selected.base);
        return { status: "running", id: attempt.id, head: config.base };
      }
      if (role === "author") return { status: "passed", id: attempt.id, head: config.base };
      const head = await native.git(config.reviewWorktree, ["rev-parse", "HEAD"]);
      return {
        status: "failed",
        id: attempt.id,
        head,
        summary: JSON.stringify({
          run: config.run,
          role: "reviewer",
          head,
          verdict: "FAIL",
          findings: [
            {
              file: "repair-target.txt",
              line: 1,
              severity: "blocking",
              text: "Repair the recorded source defect.",
            },
          ],
          g0: "The source line requires this repair.",
        }),
      };
    },
    async checks() {
      return { head: selected.base, checks: [] };
    },
  };
  const adapter = () =>
    fixtureQueue.repositoryQueueAdapter(queue, repository, {
      gitExecutable,
      native,
      setup: gitSetupAdapter({
        gitExecutable,
        async install(_launcher, _args, cwd) {
          await mkdir(resolve(cwd, "node_modules"), { recursive: true });
          await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
    });

  await expect(queueStep(queue, adapter())).resolves.toMatchObject({ status: "observing-author" });
  expect(item.repair.acceptanceCriteria).toEqual([acceptanceCriteria]);
  const encodedCriteria = repairPrompt
    .split("Preserve these acceptance criteria verbatim: ")[1]
    ?.split(". Authorized exact review paths are ")[0];
  expect(encodedCriteria).toBeDefined();
  expect(JSON.parse(encodedCriteria!)).toEqual(item.repair.acceptanceCriteria);
  const retained = await snapshot(queue.stateDirectory);
  const trees = await snapshot(loop.worktreeRoot);
  const launchCount = pid;
  const observationCount = repairObservations;
  await writeFile(resolve(repository, "executor-upgrade.txt"), "Synthetic executor B\n");
  await native.git(repository, ["add", "."]);
  await native.git(repository, ["commit", "-m", "synthetic executor upgrade"]);
  const upgraded = await native.git(repository, ["rev-parse", "HEAD"]);
  for (let replay = 0; replay < 2; replay++) {
    queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
    expect(queue.controllerRevision).toBe(upgraded);
    await expect(queueStep(queue, adapter())).resolves.toMatchObject({
      status: "observing-author",
    });
  }
  expect(pid).toBe(launchCount);
  expect(repairObservations).toBe(observationCount + 2);
  for (const [path, bytes] of retained) expect(await readFile(path, "utf8"), path).toBe(bytes);
  expect(await snapshot(loop.worktreeRoot)).toEqual(trees);
}, 30_000);

it.each(["author", "reviewer"] as const)(
  "resumes a running %s retry through the composed queue without recording a stale dead terminal",
  async (deadRole) => {
    const { loop, repository, gitExecutable, selected } = await loopFixture(true);
    const queue = await queueConfigFromLoop(loop, repository, selected, repositoryPolicy);
    const item = queue.items[0]!;
    const fixtureQueue = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(repository, "scripts/dogfood/queue.ts")).href
    )) as { repositoryQueueAdapter: typeof repositoryQueueAdapter };
    const launches = { author: 0, reviewer: 0 };
    let retryRunning = true;
    const native: Adapter = {
      async preflight() {},
      async git(worktree, args) {
        const result = await execute(gitExecutable, ["-C", worktree, ...args]);
        return args.includes("-z") ? result.stdout : result.stdout.trim();
      },
      async launch(role, config) {
        launches[role] += 1;
        if (role === "author")
          await writeFile(resolve(config.worktree, "change.txt"), "candidate change\n");
        return {
          id: `${role}-${launches[role]}`,
          pid: launches.author + launches.reviewer,
          trace: resolve(queue.stateDirectory, `${role}-${launches[role]}.jsonl`),
          launchedAt: 1,
        };
      },
      async observe(role, config, attempt) {
        if (role === deadRole && attempt.id === `${role}-1`)
          return { id: attempt.id, status: "dead", summary: "provider disconnected" };
        if (role === deadRole && retryRunning) return { id: attempt.id, status: "running" };
        const head =
          role === "author"
            ? config.base
            : await native.git(config.reviewWorktree, ["rev-parse", "HEAD"]);
        return {
          id: attempt.id,
          status: "passed",
          head,
          ...(role === "reviewer"
            ? {
                summary: JSON.stringify({
                  run: config.run,
                  role,
                  head,
                  verdict: "PASS",
                  findings: [],
                  g0: "The change is already minimal.",
                }),
              }
            : {}),
        };
      },
      async checks() {
        return { head: selected.base, checks: [] };
      },
    };
    const compose = () => ({
      ...fixtureQueue.repositoryQueueAdapter(queue, repository, {
        gitExecutable,
        native,
        setup: gitSetupAdapter({
          gitExecutable,
          async install(_launcher, _args, cwd) {
            await mkdir(resolve(cwd, "node_modules"), { recursive: true });
            await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
            return "succeeded";
          },
        }),
      }),
      async delivery(current: QueueItem, accepted: { head: string; reviewId: string }) {
        return deliveryCompletion(current, accepted.head, accepted.reviewId);
      },
    });
    const adapter = compose();
    await expect(queueStep(queue, adapter)).resolves.toMatchObject({
      status: `observing-${deadRole}`,
    });
    const readState = async (name: string) =>
      JSON.parse(
        await readFile(resolve(item.source.stateDirectory, `${deadRole}-${name}.json`), "utf8"),
      );
    expect(await readState("attempt")).toMatchObject({ id: `${deadRole}-2`, retries: 1 });
    expect(await readState("terminal")).toMatchObject({ id: `${deadRole}-1`, status: "dead" });
    expect((await adapter.history()).map(({ id, outcome }) => ({ id, outcome }))).toEqual([
      ...(deadRole === "reviewer" ? [{ id: "author-1", outcome: "passed" }] : []),
      { id: `${deadRole}-1`, outcome: "dead" },
    ]);

    retryRunning = false;
    const resumed = compose();
    await expect(queueStep(queue, resumed)).resolves.toMatchObject({
      status: "complete",
      participants: 3,
    });
    expect((await resumed.history()).map(({ id, outcome }) => ({ id, outcome }))).toEqual(
      deadRole === "author"
        ? [
            { id: "author-1", outcome: "dead" },
            { id: "author-2", outcome: "passed" },
            { id: "reviewer-1", outcome: "passed" },
          ]
        : [
            { id: "author-1", outcome: "passed" },
            { id: "reviewer-1", outcome: "dead" },
            { id: "reviewer-2", outcome: "passed" },
          ],
    );
    expect(launches).toEqual(
      deadRole === "author" ? { author: 2, reviewer: 1 } : { author: 1, reviewer: 2 },
    );
  },
  30_000,
);

it("keeps the executor pinned while starting a cycle from the selected main commit", async () => {
  const { loop, repository, gitExecutable, selected } = await loopFixture();
  await execute(gitExecutable, ["-C", repository, "checkout", "-b", "fresh-main"]);
  await writeFile(resolve(repository, "fresh.txt"), "next cycle\n");
  await execute(gitExecutable, ["-C", repository, "add", "."]);
  await execute(gitExecutable, ["-C", repository, "commit", "-m", "next cycle"]);
  const fresh = (
    await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  await execute(gitExecutable, ["-C", repository, "checkout", "main"]);
  const inherited = [participant(1, "ISS-100:1", "source", "author", "passed")];

  const queue = await queueConfigFromLoop(
    loop,
    repository,
    { ...selected, base: fresh },
    repositoryPolicy,
    inherited,
  );
  expect(queue.controllerRevision).toBe(selected.base);
  expect(queue.items[0]).toMatchObject({
    base: fresh,
    setup: { controllerRevision: selected.base, pilotRevision: selected.base, base: fresh },
    source: { pilotRevision: selected.base, base: fresh },
  });
  expect(queue.initialHistory).toEqual(inherited);
  await expect(
    gitSetupAdapter({ gitExecutable }).assertExecutor(queue.items[0]!.setup, repository),
  ).resolves.toBeUndefined();
}, 15_000);

it("counts a genuine repair as the next candidate without a new counter", async () => {
  const current = await fixture();
  current.items[0]!.implementationAttempt = 2;
  await expect(currentCandidateAttempt(current.config)).resolves.toBe(2);
  const item = current.items[0]!;
  await writeFile(
    resolve(current.stateDirectory, "attempt.json"),
    `${JSON.stringify({
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      phase: "repair",
      run: current.config.run,
      index: 0,
      item: item.id,
      issue: item.issue,
      base: item.base,
      candidateAttempt: 3,
      head: "b".repeat(40),
      reviewId: "source-reviewer",
      findings: [],
      history: [],
      retries: 0,
      acceptedStage: null,
      stateDirectory: null,
    })}\n`,
  );
  await expect(currentCandidateAttempt(current.config)).resolves.toBe(3);
});

it.each([false, true])(
  "rebased attempt 3 (changed: %s)",
  async (correctiveChanges) => {
    const { loop, repository, stateRoot, gitExecutable, selected } = await loopFixture();
    const policy: RepositoryAdapter = {
      ...repositoryPolicy,
      issueContext: async (input) => ({
        ...(await repositoryPolicy.issueContext(input)),
        routing: { row: "self" },
      }),
    };
    await execute(gitExecutable, ["-C", repository, "checkout", "-b", "rejected"]);
    await writeFile(resolve(repository, "rejected.txt"), "candidate two\n");
    await execute(gitExecutable, ["-C", repository, "add", "."]);
    await execute(gitExecutable, ["-C", repository, "commit", "-m", "candidate two"]);
    const rejectedHead = (
      await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
    ).stdout.trim();
    await execute(gitExecutable, ["-C", repository, "checkout", "main"]);
    const remote = resolve(repository, "..", "remote.git");
    const updater = resolve(repository, "..", "updater");
    await execute(gitExecutable, ["clone", "--bare", repository, remote]);
    await execute(gitExecutable, ["-C", repository, "remote", "add", "origin", remote]);
    await execute(gitExecutable, ["clone", remote, updater]);
    await execute(gitExecutable, ["-C", updater, "config", "user.name", "Fixture"]);
    await execute(gitExecutable, ["-C", updater, "config", "user.email", "fixture@example.test"]);
    await writeFile(resolve(updater, "main.txt"), "new main\n");
    await execute(gitExecutable, ["-C", updater, "add", "."]);
    await execute(gitExecutable, ["-C", updater, "commit", "-m", "advance main"]);
    await execute(gitExecutable, ["-C", updater, "push", "origin", "main"]);
    const currentMain = (
      await execute(gitExecutable, ["-C", updater, "rev-parse", "HEAD"])
    ).stdout.trim();
    const main = (
      await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
    ).stdout.trim();
    const prescribed = [
      {
        file: "scripts/dogfood/queue.ts",
        line: 1,
        severity: "blocking" as const,
        text: "Preserve the rejected candidate and apply this exact fix.",
      },
    ];
    const firstHistory = [
      participant(1, "ISS-104:1", "source", "author", "passed"),
      participant(2, "ISS-104:1", "source", "reviewer", "failed"),
      participant(3, "ISS-104:1", "repair", "author", "passed"),
      { ...participant(4, "ISS-104:1", "repair", "reviewer", "failed"), rung: 1 },
    ];
    const queueState = resolve(stateRoot, loop.run, "iss-104-attempt-1");
    await mkdir(queueState, { recursive: true });
    await writeFile(
      resolve(queueState, "attempt.json"),
      `${JSON.stringify({
        schemaVersion: "dogfood-bounded-queue-attempt/v1",
        phase: "failed",
        run: loop.run,
        index: 0,
        item: "ISS-104:1",
        issue: "https://github.com/fixture/repository/issues/361",
        base: main,
        candidateAttempt: 2,
        head: rejectedHead,
        reviewId: firstHistory[3]!.id,
        findings: prescribed,
        history: firstHistory,
        authorFailures: { count: 2, ids: [firstHistory[0]!.id, firstHistory[2]!.id] },
        retries: 0,
        acceptedStage: null,
        stateDirectory: null,
      })}\n`,
    );
    const third = await queueConfigFromLoop(loop, repository, selected, policy);
    const rebasedBase = third.items[0]!.base;
    expect(third.items[0]!.source.author).toMatchObject({ ...SELF_ROUTING.author[2], rung: 2 });
    expect(third.items[0]!.source.authorFailures?.count).toBe(2);
    expect(third.items[0]!.source.reviewer).toMatchObject({ ...SELF_ROUTING.reviewer[1], rung: 1 });
    expect(third.items[0]).toMatchObject({
      id: "ISS-104:3",
      base: rebasedBase,
      implementationAttempt: 3,
      source: { base: rebasedBase, mainBase: currentMain, pilotRevision: main },
      setup: { base: rebasedBase },
    });
    expect(rebasedBase).not.toBe(rejectedHead);
    await expect(
      execute(gitExecutable, [
        "-C",
        repository,
        "merge-base",
        "--is-ancestor",
        currentMain,
        rebasedBase,
      ]),
    ).resolves.toMatchObject({ stdout: "" });
    await expect(
      execute(gitExecutable, ["-C", repository, "show", `${rebasedBase}:rejected.txt`]),
    ).resolves.toMatchObject({ stdout: "candidate two\n" });
    await expect(
      readFile(resolve(queueState, "attempt.json"), "utf8").then(JSON.parse),
    ).resolves.toMatchObject({ head: rejectedHead, rebasedBase, rebasedMainBase: currentMain });
    expect(third.initialHistory).toEqual(firstHistory);
    expect(third.stateDirectory).toContain("iss-104-attempt-3");
    expect(third.items[0]!.source.author.prompt).toContain(rejectedHead);
    expect(third.items[0]!.source.author.prompt).toContain(JSON.stringify(prescribed));
    await expect(
      gitSetupAdapter({ gitExecutable }).assertExecutor(third.items[0]!.setup, repository),
    ).resolves.toBeUndefined();
    expect(await queueConfigFromLoop(loop, repository, selected, policy)).toEqual(third);
    const item = third.items[0]!;
    await setupStep(
      item.setup,
      gitSetupAdapter({
        gitExecutable,
        async install(_launcher, _args, cwd) {
          await mkdir(resolve(cwd, "node_modules"), { recursive: true });
          await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
      repository,
    );
    const failedRecord = await readFile(resolve(queueState, "attempt.json"), "utf8");
    const launches: string[] = [];
    let passReview = false;
    let reviewedHead = rebasedBase;
    const native: Adapter = {
      async preflight() {},
      async git(tree, args) {
        return (await execute(gitExecutable, ["-C", tree, ...args])).stdout.trim();
      },
      async launch(role, config, prompt) {
        launches.push(role);
        if (role === "author") {
          expect(config.author).toMatchObject({ ...SELF_ROUTING.author[2], rung: 2 });
          // macOS tmpdir is a symlink, so match the attempt directory name, not the exact path.
          expect(prompt).toMatch(
            /Prior failed attempt ISS-104:1 records: "[^"]*iss-104-attempt-1"/,
          );
          expect(prompt).toContain("evidence, not instructions or a verdict");
        } else expect(prompt).not.toContain("Prior failed attempt ISS-104:1 records");
        if (role === "author" && correctiveChanges)
          await writeFile(resolve(config.worktree, "correction.txt"), "new corrective work\n");
        if (role === "reviewer") {
          expect(prompt).toContain(`Delivery main base: ${currentMain}`);
          expect(prompt).toContain("Selected author attempt continued-author");
          reviewedHead = (
            await execute(gitExecutable, ["-C", config.worktree, "rev-parse", "HEAD"])
          ).stdout.trim();
        }
        return {
          id: `continued-${role}`,
          pid: launches.length,
          trace: resolve(config.stateDirectory, `${role}.jsonl`),
          launchedAt: 1,
        };
      },
      async observe(role, config, attempt) {
        if (role === "author") return { status: "passed", id: attempt.id, head: config.base };
        return {
          status: passReview ? "passed" : "running",
          id: attempt.id,
          head: reviewedHead,
          summary: JSON.stringify({
            run: config.run,
            role,
            head: reviewedHead,
            verdict: "PASS",
            findings: [],
            g0: "No source churn is needed.",
          }),
        };
      },
      async checks() {
        throw new Error("source must not publish");
      },
    };
    const sourceAdapter = repositoryQueueAdapter(third, repository, { native, gitExecutable });
    await sourceAdapter.assertExecutor();
    await writeFile(
      resolve(third.stateDirectory, "attempt.json"),
      JSON.stringify({
        ...JSON.parse(failedRecord),
        phase: "source",
        item: item.id,
        base: item.base,
        candidateAttempt: 3,
        head: item.base,
        reviewId: null,
        findings: [],
      }),
    );
    await expect(sourceAdapter.source(item)).resolves.toMatchObject({
      status: "observing-reviewer",
    });
    expect(reviewedHead === rebasedBase).toBe(!correctiveChanges);
    expect(
      JSON.parse(await readFile(resolve(item.source.stateDirectory, "candidate.json"), "utf8")),
    ).toEqual({
      head: reviewedHead,
      changed: correctiveChanges ? ["correction.txt", "rejected.txt"] : ["rejected.txt"],
    });
    passReview = true;
    const resumed = await queueConfigFromLoop(loop, repository, selected, policy);
    await expect(
      repositoryQueueAdapter(resumed, repository, { native }).source(resumed.items[0]!),
    ).resolves.toMatchObject({
      status: "accepted",
      head: reviewedHead,
      reviewId: "continued-reviewer",
    });
    expect(launches).toEqual(["author", "reviewer"]);
    expect(await currentCandidateAttempt(resumed)).toBe(3);
    expect(
      (await repositoryQueueAdapter(resumed, repository, { native }).history()).map(
        (row) => row.outcome,
      ),
    ).toEqual(["passed", "failed", "passed", "failed", "passed", "passed"]);
    expect(await readFile(resolve(queueState, "attempt.json"), "utf8")).toBe(failedRecord);
  },
  30_000,
);

async function stoppedConflictFixture(status = "failed", spent = false, legacy = false) {
  const f = await loopFixture();
  const git = async (args: string[], tree = f.repository) =>
    (await execute(f.gitExecutable, ["-C", tree, ...args])).stdout.trim();
  const original = await queueConfigFromLoop(f.loop, f.repository, f.selected, repositoryPolicy);
  const old = original.items[0]!;
  await git(["checkout", "-b", "reviewed"]);
  await writeFile(resolve(f.repository, "docs/loop.md"), "# Reviewed feature\n");
  await git(["commit", "-am", "feature"]);
  const reviewed = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "main"]);
  await writeFile(resolve(f.repository, "docs/loop.md"), "# Integration main\n");
  await git(["commit", "-am", "main"]);
  const main = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "reviewed"]);
  await expect(git(["merge", "--no-commit", "main"])).rejects.toThrow();
  await git(["add", "docs/loop.md"]);
  await git(["commit", "-m", "unaccepted marker seed"]);
  const seed = await git(["rev-parse", "HEAD"]);
  await git(["checkout", "main"]);
  const preservedTree = resolve(f.loop.worktreeRoot, "preserved-source");
  await git(["worktree", "add", "--detach", preservedTree, seed]);
  const remote = resolve(f.repository, "..", "remote.git");
  await execute(f.gitExecutable, ["clone", "--bare", f.repository, remote]);
  await git(["remote", "add", "origin", remote]);
  const directory = resolve(old.source.stateDirectory, `refresh-${main}`);
  await mkdir(directory, { recursive: true });
  const history = [
    participant(1, old.id, "source", "author", "passed"),
    participant(2, old.id, "source", "reviewer", "passed"),
    { ...participant(3, old.id, "refresh", "author", "failed"), id: "failed-resolution" },
  ];
  const projection = {
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    phase: "delivery",
    run: f.loop.run,
    index: 0,
    item: old.id,
    issue: old.issue,
    base: f.selected.base,
    candidateAttempt: 1,
    head: reviewed,
    reviewId: history[1]!.id,
    findings: [],
    history: history.slice(0, 2),
    retries: spent && !legacy ? 2 : 0,
    acceptedStage: "source",
    stateDirectory: old.source.stateDirectory,
  };
  const retained = new Map<string, string>();
  const put = async (path: string, value: unknown) => {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    await writeFile(path, bytes);
    retained.set(path, bytes);
  };
  await writeFile(resolve(original.stateDirectory, "attempt.json"), JSON.stringify(projection));
  for (const p of history)
    await put(resolve(original.stateDirectory, `participant-${p.ordinal}-terminal.json`), p);
  await put(resolve(old.source.stateDirectory, "native-refresh.json"), {
    main,
    previousHead: reviewed,
    previousReview: projection.reviewId,
    previousDirectory: old.source.stateDirectory,
    directory,
    resolutionUsed: true,
    flowRetried: spent,
    retries: spent ? 2 : 0,
    conflict: { seed, files: { "docs/loop.md": await git(["show", `${seed}:docs/loop.md`]) } },
  });
  for (const role of ["author", "reviewer"])
    await put(resolve(old.source.stateDirectory, `${role}-attempt.json`), {
      id: `source-${role}`,
      trace: resolve(old.source.stateDirectory, `${role}.jsonl`),
    });
  await put(resolve(old.source.stateDirectory, "reviewer-terminal.json"), {
    id: projection.reviewId,
    head: reviewed,
    status: "passed",
  });
  await put(resolve(old.source.stateDirectory, "candidate.json"), {
    head: reviewed,
    changed: ["docs/loop.md"],
  });
  await put(resolve(old.source.stateDirectory, "gate-1.json"), {
    head: reviewed,
    name: "typecheck",
  });
  await put(resolve(old.source.stateDirectory, "author.jsonl"), {
    type: "turn.completed",
    head: reviewed,
  });
  await put(resolve(directory, "author.jsonl"), {
    type: "turn.completed",
    head: seed,
    verdict: "FAIL",
  });
  await put(resolve(directory, "author-attempt.json"), {
    id: "failed-resolution",
    trace: resolve(directory, "author.jsonl"),
    ...(spent ? { retries: 1 } : {}),
  });
  await put(resolve(directory, "author-terminal.json"), {
    id: "failed-resolution",
    status,
    head: seed,
  });
  if (spent && !legacy)
    await put(resolve(old.source.stateDirectory, "gate-correction.json"), { failedHead: reviewed });
  const selection = { ...f.selected, cycle: 1 };
  const runState = resolve(f.loop.stateRoot, f.loop.run);
  await put(resolve(runState, "cycle-1-selected.json"), selection);
  await put(resolve(runState, "cycle-1-stop-1.json"), {
    selection,
    stop: 1,
    reason: "conflict-resolution-failed",
    attempts: 1,
  });
  await put(resolve(runState, "cycle-1-stop-1-complete.json"), { selection, stop: 1, history });
  const compose = (prior: QueueParticipant[] = []) =>
    queueConfigFromLoop(
      f.loop,
      f.repository,
      { ...f.selected, base: main },
      repositoryPolicy,
      prior,
    );
  const unchanged = async () => {
    for (const [path, bytes] of retained) expect(await readFile(path, "utf8")).toBe(bytes);
    expect(await git(["rev-parse", "HEAD"], preservedTree)).toBe(seed);
    expect(await git(["status", "--porcelain"], preservedTree)).toBe("");
  };
  return {
    ...f,
    git,
    original,
    old,
    projection,
    history,
    seed,
    main,
    reviewed,
    compose,
    unchanged,
  };
}

it.each(["running", "passed", "dead"])("does not advance a %s conflict author", async (status) => {
  const f = await stoppedConflictFixture(status);
  const before = await readFile(resolve(f.original.stateDirectory, "attempt.json"), "utf8");
  expect((await f.compose()).items[0]!.implementationAttempt).toBe(1);
  expect(await readFile(resolve(f.original.stateDirectory, "attempt.json"), "utf8")).toBe(before);
  await f.unchanged();
});

it("projects the retained failure once and selects attempt 2 only after unpark, retaining later launches", async () => {
  const f = await stoppedConflictFixture();
  let unparked = false;
  const policy = {
    ...repositoryPolicy,
    selectCandidates: () => (unparked ? [{ key: f.selected.key, number: f.selected.number }] : []),
  };
  const host: SupervisionAdapter = {
    currentMain: async () => f.main,
    issue: async () => ({ state: "OPEN", key: f.selected.key, labels: [], comments: [] }),
    removeReady: async () => {
      throw new Error("must not mutate readiness");
    },
    close: async () => {
      throw new Error("must not close");
    },
    comment: async () => {
      throw new Error("completed note must not repeat");
    },
  };
  expect(await nextCycle(f.loop, f.repository, host, policy)).toBeUndefined();
  // A later completed issue is part of this run's launch budget too.
  const later = [
    ...f.history,
    participant(4, "ISS-105:1", "source", "author", "passed"),
    participant(5, "ISS-105:1", "source", "reviewer", "passed"),
  ];
  const selection = { cycle: 2, key: "ISS-105", number: 362, base: f.main };
  const state = resolve(f.loop.stateRoot, f.loop.run);
  await writeFile(resolve(state, "cycle-2-selected.json"), JSON.stringify(selection));
  await writeFile(
    resolve(state, "cycle-2-complete.json"),
    JSON.stringify({ selection, history: later }),
  );
  unparked = true;
  const cycle = await nextCycle(f.loop, f.repository, host, policy);
  expect(cycle).toEqual({
    selection: { cycle: 3, ...f.selected, base: f.main, planningRevision: f.main },
    initialHistory: later,
  });
  // An interrupted atomic projection write is not a completed transition.
  await writeFile(
    resolve(f.original.stateDirectory, "attempt.json.tmp"),
    "interrupted projection\n",
  );
  const q = await f.compose(cycle!.initialHistory);
  expect(q.initialHistory).toEqual(later);
  expect(q.items[0]).toMatchObject({
    id: "ISS-104:2",
    implementationAttempt: 2,
    base: f.seed,
    source: { base: f.seed, mainBase: f.main, inheritedWorkerRetry: false },
    conflictContinuation: { directory: f.old.source.stateDirectory, correctionUsed: false },
  });
  expect(q.items[0]!.setup.sourceWorktree).toContain("iss-104-attempt-2-source");
  expect(q.items[0]!.source.reviewer.prompt).toContain("Independent DELTA");
  for (const value of [
    f.seed,
    f.main,
    f.reviewed,
    f.projection.reviewId,
    "author.jsonl",
    "One file drives the run.",
  ])
    expect(q.items[0]!.source.reviewer.prompt).toContain(value);
  const failed = JSON.parse(
    await readFile(resolve(f.original.stateDirectory, "attempt.json"), "utf8"),
  );
  expect(failed).toEqual({
    ...f.projection,
    phase: "failed",
    head: f.seed,
    history: f.history,
    acceptedStage: null,
    stateDirectory: null,
  });
  for (let replay = 0; replay < 2; replay++) expect(await f.compose(later)).toEqual(q);
  await f.unchanged();
});

it.each([
  "pass",
  "author-fail",
  "review-fail",
  "spent-retry",
  "lost-commit",
  "no-change",
  "delivery",
  "moved-main",
  "new-conflict",
  "spent-correction",
  "spent-legacy-correction",
  "correction",
  "stale-review",
  "stale-receipt",
  "spent-refresh-retry",
  "refresh-review-fail",
])("runs the unresolved-seed successor through native lifecycle: %s", async (mode) => {
  const f = await stoppedConflictFixture(
    "failed",
    ["spent-retry", "spent-correction", "spent-legacy-correction", "spent-refresh-retry"].includes(
      mode,
    ),
    mode === "spent-legacy-correction",
  );
  const q = await f.compose();
  expect(await f.compose()).toEqual(q);
  const item = q.items[0]!;
  const launches: string[] = [];
  let ready = false;
  let lost = false;
  const deliver = [
    "delivery",
    "moved-main",
    "new-conflict",
    "spent-correction",
    "spent-legacy-correction",
    "correction",
    "stale-review",
    "stale-receipt",
    "spent-refresh-retry",
    "refresh-review-fail",
  ].includes(mode);
  const effects: string[] = [];
  const setup = gitSetupAdapter({
    gitExecutable: f.gitExecutable,
    async install(_launcher, _args, cwd) {
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return "succeeded";
    },
  });
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      const result = await f.git(args, tree);
      if (mode === "lost-commit" && args[0] === "commit" && !lost) {
        lost = true;
        throw new Error("lost commit response");
      }
      return result;
    },
    async launch(role, config, prompt) {
      const stage =
        config.stateDirectory === item.source.stateDirectory
          ? ""
          : config.stateDirectory.endsWith("gate-correction")
            ? "correction-"
            : "refresh-";
      launches.push(`${stage}${role}`);
      if (role === "author" && mode !== "no-change")
        await writeFile(
          resolve(config.worktree, "docs/loop.md"),
          `# Reviewed feature and integration main${stage ? " corrected" : ""}\n`,
        );
      if (role === "reviewer") {
        expect(prompt.toLowerCase()).toContain("independent delta");
        if (!stage || mode !== "new-conflict") expect(prompt).toContain(f.reviewed);
        if (!stage) expect(prompt).toContain(`Delivery main base: ${f.main}`);
      }
      return {
        id: randomUUID(),
        pid: launches.length,
        trace: resolve(config.stateDirectory, `${role}.jsonl`),
        launchedAt: 1,
      };
    },
    async observe(role, config, attempt) {
      if (!ready) return { status: "running", id: attempt.id };
      if (role === "author")
        return {
          status: mode === "author-fail" ? "failed" : mode === "spent-retry" ? "dead" : "passed",
          id: attempt.id,
          head: config.base,
        };
      const head = await f.git(["rev-parse", "HEAD"], config.worktree);
      if (mode === "spent-refresh-retry" && config.stateDirectory !== item.source.stateDirectory)
        return { id: attempt.id, status: "malformed", summary: "invalid JSON" };
      const fail =
        mode === "review-fail" ||
        (mode === "refresh-review-fail" && config.stateDirectory !== item.source.stateDirectory);
      return {
        status: fail ? "failed" : "passed",
        id: attempt.id,
        head,
        summary: JSON.stringify({
          run: config.run,
          role,
          head,
          verdict: fail ? "FAIL" : "PASS",
          findings: fail
            ? [{ file: "docs/loop.md", line: 1, severity: "blocking", text: "Lost behavior." }]
            : [],
          g0: "Preserve both behaviors.",
        }),
      };
    },
    async checks() {
      throw new Error("no source publication");
    },
  };
  const delivery = githubDeliveryAdapter();
  delivery.verifyWorkspace = async (config, head) =>
    (await f.git(["rev-parse", "HEAD"], config.worktree)) === head &&
    (await f.git(["status", "--porcelain"], config.worktree)) === "";
  delivery.runGate = async (config, name, head) => {
    effects.push(`gate:${name}:${head}`);
    if (
      ["spent-correction", "spent-legacy-correction", "correction"].includes(mode) &&
      !config.stateDirectory.endsWith("gate-correction")
    ) {
      return {
        status: "failed",
        output: "attributed assertion",
        evidence: {
          head,
          log: resolve(config.stateDirectory, "candidate.log"),
          cause: "diagnostic",
          diagnostics: ["docs/loop.md:1: failed assertion"],
          command: { executable: process.execPath, argv: ["fixture"], cwd: config.worktree },
        },
      };
    }
    return "passed";
  };
  delivery.attributeGate = async (_config, _name, _evidence, main) => ({
    cause: "candidate",
    main,
    log: resolve(item.source.stateDirectory, "base-control.log"),
  });
  let draft = false;
  let published = false;
  let merged = false;
  let cleaned = false;
  let publishedHead = "";
  delivery.observeDraft = async () =>
    draft ? { state: "confirmed", value: { issue: 361 } } : { state: "needs-mutation" };
  delivery.applyDraft = async () => {
    draft = true;
    effects.push("draft");
  };
  delivery.observePublication = async (config, plan, planDigest) =>
    published
      ? {
          state: "confirmed",
          value: {
            number: 400,
            url: "https://github.com/fixture/repository/pull/400",
            head: publishedHead,
            repository: config.repository,
            sourceBranch: plan.sourceBranch,
            baseBranch: plan.baseBranch,
            title: plan.title,
            body: plan.body,
            planDigest,
          },
        }
      : { state: "needs-mutation", target: "absent" };
  delivery.publish = async (config) => {
    published = true;
    publishedHead = config.candidateHead;
    effects.push("publish");
    throw new Error("lost publish response");
  };
  delivery.checks = async (config) => ({
    head: publishedHead,
    checks: config.requiredChecks.map((name) => ({
      name,
      bucket: "pass",
      link: `https://example.test/check/${encodeURIComponent(name)}`,
    })),
  });
  delivery.observeMerge = async () =>
    merged
      ? {
          state: "confirmed",
          value: { number: 400, head: publishedHead, mergeCommit: "e".repeat(40) },
        }
      : { state: "needs-mutation" };
  delivery.merge = async () => {
    merged = true;
    effects.push("merge");
    throw new Error("lost merge response");
  };
  delivery.observeCleanup = async (_config, plan) =>
    cleaned ? { state: "confirmed", value: plan } : { state: "needs-mutation" };
  delivery.cleanup = async () => {
    cleaned = true;
    effects.push("cleanup");
  };
  const adapter = () =>
    repositoryQueueAdapter(q, f.repository, {
      native,
      setup,
      delivery,
      gitExecutable: f.gitExecutable,
      async assertExecutor() {},
      repository: {
        ...repositoryPolicy,
        async afterMerge() {
          effects.push("deployment");
        },
      },
      deliveryPolicy: {
        async plan(config) {
          return {
            gates: {
              beforeMirror: ["typecheck", "format:check", "planning:check", "test"],
              afterMirror: ["planning:board-check"],
            },
            drafts: [
              { key: "ISS-104", issue: 361, title: "fixture", body: "fixture", attributes: {} },
            ],
            publication: {
              sourceBranch: "codex/iss-104",
              baseBranch: "main",
              title: "fixture",
              body: "fixture",
              draft: true,
            },
            mergePolicy: {},
            cleanup: {
              worktrees: [config.worktree, config.reviewWorktree],
              branch: config.localBranch!,
            },
          };
        },
      },
    });
  const run = () =>
    queueStep(q, {
      ...adapter(),
      async delivery() {
        throw new Error("fresh delivery reached");
      },
      async repair() {
        throw new Error("repair forbidden");
      },
    });
  for (let replay = 0; replay < 2; replay++)
    await expect(run()).resolves.toMatchObject({ status: "observing-author" });
  expect(launches).toEqual(["author"]);
  ready = true;
  if (deliver) {
    await expect(run()).rejects.toThrow("fresh delivery reached");
    if (
      ["moved-main", "new-conflict", "spent-refresh-retry", "refresh-review-fail"].includes(mode)
    ) {
      const updater = resolve(f.repository, "..", "updater");
      await execute(f.gitExecutable, ["clone", resolve(f.repository, "..", "remote.git"), updater]);
      await f.git(["config", "user.name", "Fixture"], updater);
      await f.git(["config", "user.email", "fixture@example.test"], updater);
      await writeFile(
        resolve(updater, mode === "new-conflict" ? "docs/loop.md" : "main.txt"),
        "new main behavior\n",
      );
      await f.git(["add", "."], updater);
      await f.git(["commit", "-m", "advance main before delivery"], updater);
      await f.git(["push", "origin", "main"], updater);
    }
    if (mode === "stale-review") {
      const path = resolve(item.source.stateDirectory, "reviewer-terminal.json");
      const terminal = JSON.parse(await readFile(path, "utf8"));
      terminal.head = f.reviewed;
      await writeFile(path, JSON.stringify(terminal));
    }
    if (mode === "stale-receipt")
      await writeFile(
        resolve(item.source.stateDirectory, "gate-1.json"),
        JSON.stringify({ head: f.reviewed, name: "typecheck" }),
      );
    const workFailure = [
      "new-conflict",
      "spent-correction",
      "spent-legacy-correction",
      "spent-refresh-retry",
      "refresh-review-fail",
    ].includes(mode);
    if (workFailure || ["stale-review", "stale-receipt"].includes(mode)) {
      for (let replay = 0; replay < 2; replay++)
        await expect(queueStep(q, adapter())).rejects.toThrow(
          workFailure
            ? "continuation-failed"
            : mode === "stale-review"
              ? "unreviewed-delivery-source"
              : "malformed-record:gate-1",
        );
      expect(launches).toEqual(
        ["spent-refresh-retry", "refresh-review-fail"].includes(mode)
          ? ["author", "reviewer", "refresh-reviewer"]
          : ["author", "reviewer"],
      );
      expect(effects.filter((e) => ["publish", "merge"].includes(e))).toEqual([]);
      if (mode === "new-conflict") {
        const refresh = JSON.parse(
          await readFile(resolve(item.source.stateDirectory, "native-refresh.json"), "utf8"),
        );
        expect(refresh.resolutionUsed).toBe(true);
        expect(refresh.conflict).toBeUndefined();
      }
    } else {
      let completed = false;
      for (let poll = 0; poll < 8 && !completed; poll++) {
        try {
          completed = (await queueStep(q, adapter())).status === "complete";
        } catch (error) {
          expect(String(error)).toMatch(/publication-outcome-unknown|merge-outcome-unknown/);
        }
      }
      expect(completed).toBe(true);
      const after = [...effects];
      for (let replay = 0; replay < 2; replay++)
        await expect(queueStep(q, adapter())).resolves.toMatchObject({ status: "complete" });
      expect(effects).toEqual(after);
      expect(effects.filter((e) => ["publish", "merge", "deployment"].includes(e))).toEqual([
        "publish",
        "merge",
        "deployment",
      ]);
      expect(
        effects
          .filter((e) => e.startsWith("gate:") && e.endsWith(publishedHead))
          .map((e) => e.split(":").slice(1, -1).join(":")),
      ).toEqual(["typecheck", "format:check", "planning:check", "test", "planning:board-check"]);
      expect(launches).toEqual(
        mode === "moved-main"
          ? ["author", "reviewer", "refresh-reviewer"]
          : mode === "correction"
            ? ["author", "reviewer", "correction-author", "correction-reviewer"]
            : ["author", "reviewer"],
      );
    }
    await f.unchanged();
    return;
  }
  if (mode === "lost-commit") await expect(run()).rejects.toThrow("source-flow-state-unknown");
  const success = ["pass", "lost-commit"].includes(mode);
  for (let replay = 0; replay < 2; replay++)
    await expect(run()).rejects.toThrow(success ? "fresh delivery reached" : "continuation-failed");
  expect(launches).toEqual(
    ["pass", "lost-commit", "review-fail"].includes(mode) ? ["author", "reviewer"] : ["author"],
  );
  if (success) {
    const candidate = JSON.parse(
      await readFile(resolve(item.source.stateDirectory, "candidate.json"), "utf8"),
    );
    expect(candidate.head).not.toBe(f.seed);
    expect(candidate.changed).toEqual(["docs/loop.md"]);
    expect(await f.git(["rev-parse", `${candidate.head}^`], item.source.worktree)).toBe(f.seed);
    expect(await f.compose()).toEqual(q);
  } else await expect(f.compose()).rejects.toThrow("continuation-failed");
  if (mode === "spent-retry") expect(item.conflictContinuation!.correctionUsed).toBe(true);
  await f.unchanged();
});

it("stops with rebase-conflict before launching the next author", async () => {
  const { loop, repository, stateRoot, gitExecutable, selected } = await loopFixture();
  const remote = resolve(repository, "..", "remote.git");
  const updater = resolve(repository, "..", "updater");
  await execute(gitExecutable, ["clone", "--bare", repository, remote]);
  await execute(gitExecutable, ["-C", repository, "remote", "add", "origin", remote]);

  await execute(gitExecutable, ["-C", repository, "checkout", "-b", "rejected"]);
  await writeFile(resolve(repository, "docs/loop.md"), "# The rejected loop\n");
  await execute(gitExecutable, ["-C", repository, "add", "."]);
  await execute(gitExecutable, ["-C", repository, "commit", "-m", "rejected change"]);
  const rejectedHead = (
    await execute(gitExecutable, ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  await execute(gitExecutable, ["-C", repository, "checkout", "main"]);

  await execute(gitExecutable, ["clone", remote, updater]);
  await execute(gitExecutable, ["-C", updater, "config", "user.name", "Fixture"]);
  await execute(gitExecutable, ["-C", updater, "config", "user.email", "fixture@example.test"]);
  await writeFile(resolve(updater, "docs/loop.md"), "# The current loop\n");
  await execute(gitExecutable, ["-C", updater, "add", "."]);
  await execute(gitExecutable, ["-C", updater, "commit", "-m", "current main change"]);
  await execute(gitExecutable, ["-C", updater, "push", "origin", "main"]);

  const history = [
    participant(1, "ISS-104:1", "source", "author", "passed"),
    participant(2, "ISS-104:1", "source", "reviewer", "failed"),
  ];
  const queueState = resolve(stateRoot, loop.run, "iss-104-attempt-1");
  await mkdir(queueState, { recursive: true });
  await writeFile(
    resolve(queueState, "attempt.json"),
    `${JSON.stringify({
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      phase: "failed",
      run: loop.run,
      index: 0,
      item: "ISS-104:1",
      issue: "https://github.com/fixture/repository/issues/361",
      base: selected.base,
      candidateAttempt: 1,
      head: rejectedHead,
      reviewId: history[1]!.id,
      findings: [{ file: "linux", line: 1, severity: "blocking", text: "fix the hosted failure" }],
      history,
      retries: 0,
      acceptedStage: null,
      stateDirectory: null,
    })}\n`,
  );

  await expect(queueConfigFromLoop(loop, repository, selected, repositoryPolicy)).rejects.toThrow(
    "rebase-conflict",
  );
  await expect(
    readFile(resolve(queueState, "attempt.json"), "utf8").then(JSON.parse),
  ).resolves.not.toHaveProperty("rebasedBase");
}, 15_000);

it("advances every finite item and completed restart repeats no effects", async () => {
  const current = await fixture(2);
  const first = current.items[0]!;
  const priorHistory = [
    {
      ...participant(1, first.id, "source", "author", "passed"),
      id: "prior-source-author",
    },
    {
      ...participant(2, first.id, "source", "reviewer", "failed"),
      id: "prior-source-reviewer",
      usage: {
        inputTokens: { status: "known" as const, value: 8 },
        outputTokens: { status: "known" as const, value: 3 },
        costUsd: { status: "known" as const, value: 1.25 },
      },
    },
  ];
  first.implementationAttempt = 2;
  first.delivery.refresh = {
    number: 341,
    url: "https://example.test/pull/341",
    head: first.base,
  };
  current.config.initialHistory = priorHistory;
  const history: QueueParticipant[] = structuredClone(priorHistory);
  const calls: string[] = [];
  const deliveryEffects = new Set<string>();
  const adapter: QueueAdapter = {
    async assertExecutor() {
      calls.push("executor");
    },
    async history() {
      return [...history];
    },
    async setup(item) {
      calls.push(`setup:${item.id}`);
      return { status: "ready" };
    },
    async source(item) {
      calls.push(`source:${item.id}`);
      history.push(
        participant(history.length + 1, item.id, "source", "author", "passed"),
        participant(history.length + 2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: item.id === "synthetic-1" ? "e".repeat(40) : "c".repeat(40),
        reviewId: `${item.id}-source-reviewer`,
        stateDirectory: resolve(current.root, `${item.id}-source`),
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(item, accepted) {
      calls.push(`delivery:${item.id}`);
      deliveryEffects.add(item.id);
      return deliveryCompletion(
        item,
        accepted.head,
        accepted.reviewId,
        item.delivery.refresh?.number ?? Number(item.id.at(-1)),
      );
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toEqual({
    status: "complete",
    run: current.config.run,
    cursor: 2,
    items: 2,
    participants: 6,
  });
  expect(calls).toEqual([
    "executor",
    "setup:synthetic-1",
    "source:synthetic-1",
    "delivery:synthetic-1",
    "setup:synthetic-2",
    "source:synthetic-2",
    "delivery:synthetic-2",
  ]);
  expect([...deliveryEffects]).toEqual(["synthetic-1", "synthetic-2"]);
  const firstComplete = await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8");

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "complete",
    participants: 6,
  });
  expect(calls.slice(7)).toEqual(["executor"]);
  expect([...deliveryEffects]).toEqual(["synthetic-1", "synthetic-2"]);
  expect(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")).toBe(
    firstComplete,
  );
  expect(JSON.parse(firstComplete).history.slice(0, 2)).toEqual(priorHistory);
});

it.each([
  [
    "an unsupported top-level field",
    (result: Record<string, any>) => (result.syntheticExtra = true),
  ],
  [
    "an unsupported publication field",
    (result: Record<string, any>) => (result.publication.syntheticExtra = true),
  ],
  [
    "an unsupported cleanup field",
    (result: Record<string, any>) => (result.cleanup.syntheticExtra = true),
  ],
  ["malformed cleanup", (result: Record<string, any>) => (result.cleanup.branch = "")],
])("rejects a delivery completion result with %s before completion", async (_name, mutate) => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  let deliveryCalls = 0;
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(item) {
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery(item, accepted) {
      deliveryCalls += 1;
      const result = deliveryCompletion(item, accepted.head, accepted.reviewId) as Record<
        string,
        any
      >;
      mutate(result);
      return result as Extract<QueueDeliveryResult, { status: "complete" }>;
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow("malformed-delivery-completion");
  expect(deliveryCalls).toBe(1);
  await expect(
    readFile(resolve(current.stateDirectory, "attempt.json"), "utf8"),
  ).resolves.toContain('"phase": "delivery"');
});

it("hands a genuine failed source review to repair without losing participants or usage", async () => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  const calls: string[] = [];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(item) {
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "failed"),
      );
      return {
        status: "fixable-review",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        findings: [
          {
            file: "scripts/dogfood/queue.ts",
            line: 1,
            severity: "blocking",
            text: "repair this",
          },
        ],
      };
    },
    async repair(item) {
      calls.push("repair");
      expect(
        JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
      ).toMatchObject({
        phase: "repair",
        history: [
          {
            ordinal: 1,
            outcome: "passed",
            usage: {
              inputTokens: { status: "known", value: 1 },
              costUsd: { status: "unavailable" },
            },
          },
          { ordinal: 2, outcome: "failed" },
        ],
      });
      history.push(
        participant(3, item.id, "repair", "author", "passed"),
        participant(4, item.id, "repair", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "c".repeat(40),
        reviewId: history[3]!.id,
        stateDirectory: item.repair.stateDirectory,
      };
    },
    async delivery(item, accepted) {
      return deliveryCompletion(item, accepted.head, accepted.reviewId, 1, "codex/repair");
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "complete",
    participants: 4,
  });
  expect(calls).toEqual(["repair"]);
  expect(
    JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({
    phase: "complete",
    head: "c".repeat(40),
    history: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }, { ordinal: 4 }],
  });
});

it.each([
  [1, 1],
  [4, 4],
])(
  "stops candidate %i at ceiling %i without launching another author",
  async (attempt, ceiling) => {
    const current = await fixture();
    const item = current.items[0]!;
    item.implementationAttempt = attempt;
    item.implementationAttemptCeiling = ceiling;
    const history: QueueParticipant[] = [];
    let sourceCalls = 0;
    let repairCalls = 0;
    const findings = [
      {
        file: "scripts/dogfood/queue.ts",
        line: 1,
        severity: "blocking" as const,
        text: "source remains blocked",
      },
    ];
    const adapter: QueueAdapter = {
      async assertExecutor() {},
      async history() {
        return [...history];
      },
      async setup() {
        return { status: "ready" };
      },
      async source(selected) {
        sourceCalls += 1;
        history.push(
          participant(1, selected.id, "source", "author", "passed"),
          participant(2, selected.id, "source", "reviewer", "failed"),
        );
        return {
          status: "fixable-review",
          head: "b".repeat(40),
          reviewId: history[1]!.id,
          findings,
        };
      },
      async repair() {
        repairCalls += 1;
        throw new Error("repair must not run");
      },
      async delivery() {
        throw new Error("delivery must not run");
      },
    };

    await expect(queueStep(current.config, adapter)).rejects.toThrow(
      "implementation-attempt-ceiling-exhausted",
    );
    expect({ sourceCalls, repairCalls }).toEqual({ sourceCalls: 1, repairCalls: 0 });
    expect(
      JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
    ).toMatchObject({ candidateAttempt: attempt, head: "b".repeat(40), findings });
    await expect(queueStep(current.config, adapter)).rejects.toThrow(
      "implementation-attempt-ceiling-exhausted",
    );
    expect({ sourceCalls, repairCalls }).toEqual({ sourceCalls: 1, repairCalls: 0 });
  },
);

it("counts a failed genuine repair as candidate two and stops at ceiling two", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  item.implementationAttemptCeiling = 2;
  const history: QueueParticipant[] = [];
  const findings = [
    {
      file: "scripts/dogfood/queue.ts",
      line: 1,
      severity: "blocking" as const,
      text: "repair remains blocked",
    },
  ];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(selected) {
      history.push(
        participant(1, selected.id, "source", "author", "passed"),
        participant(2, selected.id, "source", "reviewer", "failed"),
      );
      return {
        status: "fixable-review",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        findings,
      };
    },
    async repair(selected) {
      history.push(
        participant(3, selected.id, "repair", "author", "passed"),
        participant(4, selected.id, "repair", "reviewer", "failed"),
      );
      return {
        status: "failed",
        head: "c".repeat(40),
        reviewId: history[3]!.id,
        findings,
      };
    },
    async delivery() {
      throw new Error("delivery must not run");
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow(
    "implementation-attempt-ceiling-exhausted",
  );
  expect(
    JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({ candidateAttempt: 2, head: "c".repeat(40), findings });
});

it("keeps a gate correction on repaired candidate two and stops at that ceiling", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  item.implementationAttemptCeiling = 2;
  const history: QueueParticipant[] = [];
  const findings = [
    {
      file: "scripts/dogfood/queue.ts",
      line: 1,
      severity: "blocking" as const,
      text: "gate correction remains blocked",
    },
  ];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source(selected) {
      history.push(
        participant(1, selected.id, "source", "author", "passed"),
        participant(2, selected.id, "source", "reviewer", "failed"),
      );
      return {
        status: "fixable-review",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        findings,
      };
    },
    async repair(selected) {
      history.push(
        participant(3, selected.id, "repair", "author", "passed"),
        participant(4, selected.id, "repair", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "c".repeat(40),
        reviewId: history[3]!.id,
        stateDirectory: selected.repair.stateDirectory,
      };
    },
    async delivery(selected) {
      history.push(
        { ...participant(5, selected.id, "repair", "author", "passed"), id: "gate-author" },
        { ...participant(6, selected.id, "repair", "reviewer", "failed"), id: "gate-reviewer" },
      );
      return {
        status: "failed",
        head: "e".repeat(40),
        reviewId: "gate-reviewer",
        findings,
      };
    },
  };

  await expect(queueStep(current.config, adapter)).rejects.toThrow(
    "implementation-attempt-ceiling-exhausted",
  );
  expect(
    JSON.parse(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({ candidateAttempt: 2, head: "e".repeat(40), reviewId: "gate-reviewer" });
});

it("restarts a persisted candidate-two failure by advancing to candidate three", async () => {
  const current = await fixture();
  const item = current.items[0]!;
  const history = [
    participant(1, item.id, "source", "author", "passed"),
    participant(2, item.id, "source", "reviewer", "failed"),
    participant(3, item.id, "repair", "author", "passed"),
    participant(4, item.id, "repair", "reviewer", "failed"),
  ];
  const findings = [
    {
      file: "scripts/dogfood/queue.ts",
      line: 1,
      severity: "blocking" as const,
      text: "apply this on candidate three",
    },
  ];
  await writeFile(
    resolve(current.stateDirectory, "attempt.json"),
    `${JSON.stringify({
      schemaVersion: "dogfood-bounded-queue-attempt/v1",
      phase: "failed",
      run: current.config.run,
      index: 0,
      item: item.id,
      issue: item.issue,
      base: item.base,
      candidateAttempt: 2,
      head: "c".repeat(40),
      reviewId: history[3]!.id,
      findings,
      history,
      retries: 0,
      acceptedStage: null,
      stateDirectory: null,
    })}\n`,
  );
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      throw new Error("setup must not repeat");
    },
    async source() {
      throw new Error("source must not repeat");
    },
    async repair() {
      throw new Error("repair must not repeat");
    },
    async delivery() {
      throw new Error("delivery must not run");
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "advancing-attempt",
    cursor: 2,
  });
});

it("retains an interrupted wait target and refuses a moved delivery identity", async () => {
  const current = await fixture();
  const history: QueueParticipant[] = [];
  let sourceCalls = 0;
  let setupCalls = 0;
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      setupCalls += 1;
      return { status: "ready" };
    },
    async source(item) {
      sourceCalls += 1;
      if (sourceCalls === 1) return { status: "observing-author" };
      history.push(
        participant(1, item.id, "source", "author", "passed"),
        participant(2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: "b".repeat(40),
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("unexpected repair");
    },
    async delivery(item, accepted) {
      return deliveryCompletion(item, "c".repeat(40), accepted.reviewId, 1, "codex/moved");
    },
  };
  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({
    status: "observing-author",
    cursor: 0,
  });
  expect(await readFile(resolve(current.stateDirectory, "attempt.json"), "utf8")).toContain(
    '"phase": "source"',
  );
  await expect(queueStep(current.config, adapter)).rejects.toThrow("delivery-identity-drift");
  expect(setupCalls).toBe(1);
  await expect(
    readFile(resolve(current.stateDirectory, "attempt.json"), "utf8"),
  ).resolves.toContain('"phase": "delivery"');
});

it.each(["forged-review", "failed-author", "malformed-pair"])(
  "refuses invalid accepted review history: %s",
  async (mode) => {
    const current = await fixture();
    const history: QueueParticipant[] = [];
    let deliveryCalls = 0;
    const adapter: QueueAdapter = {
      async assertExecutor() {},
      async history() {
        return [...history];
      },
      async setup() {
        return { status: "ready" };
      },
      async source(item) {
        history.push(
          participant(
            1,
            item.id,
            "source",
            "author",
            mode === "failed-author"
              ? "failed"
              : mode === "malformed-pair"
                ? "malformed"
                : "passed",
          ),
          participant(2, item.id, "source", "reviewer", "passed"),
        );
        return {
          status: "accepted",
          head: "b".repeat(40),
          reviewId: mode === "forged-review" ? "forged-review" : history.at(-1)!.id,
          stateDirectory: resolve(current.root, "source"),
        };
      },
      async repair() {
        throw new Error("repair must not run");
      },
      async delivery() {
        deliveryCalls += 1;
        throw new Error("delivery must not run");
      },
    };

    await expect(queueStep(current.config, adapter)).rejects.toThrow(
      "item-review-history-mismatch",
    );
    expect(deliveryCalls).toBe(0);
    await expect(
      readFile(resolve(current.stateDirectory, "attempt.json"), "utf8"),
    ).resolves.toContain('"phase": "source"');
  },
);

it.each([
  [
    "malformed controller",
    (config: QueueConfig) => {
      config.controller = "   ";
    },
    "malformed-queue-config",
  ],
  [
    "drifted item base",
    (config: QueueConfig) => {
      config.items[0]!.base = "e".repeat(40);
    },
    "queue-base-drift",
  ],
  [
    "exhausted finite input",
    (config: QueueConfig) => {
      config.limit = 0;
    },
    "invalid-queue-limit",
  ],
  [
    "wrong controller revision",
    (config: QueueConfig) => {
      config.controllerRevision = "f".repeat(40);
    },
    "queue-executor-drift",
  ],
  [
    "drifted item run binding",
    (config: QueueConfig) => {
      config.items[0]!.source.run = "synthetic-substituted-run";
    },
    "queue-run-drift",
  ],
  [
    "drifted item issue binding",
    (config: QueueConfig) => {
      config.items[0]!.source.issue = "synthetic-substituted-issue";
    },
    "queue-issue-drift",
  ],
  [
    "drifted hosted-check binding",
    (config: QueueConfig) => {
      config.items[0]!.source.requiredChecks = ["linux", "windows", "synthetic-other-check"];
    },
    "queue-hosted-check-drift",
  ],
])("fails closed for %s", async (_name, mutate, reason) => {
  const current = await fixture();
  mutate(current.config);
  let adapterEntries = 0;
  const adapter = {
    assertExecutor: async () => {
      adapterEntries += 1;
    },
    history: async () => [],
    setup: async () => ({ status: "ready" as const }),
    source: async () => ({ status: "observing-author" as const }),
    repair: async () => ({ status: "observing-author" as const }),
    delivery: async () => ({
      status: "observing-hosted-checks" as const,
      head: "b".repeat(40),
      reviewId: "review",
    }),
  };
  await expect(queueStep(current.config, adapter)).rejects.toThrow(reason);
  expect(adapterEntries).toBe(0);
});

it("stores an inline gate retry count in the single attempt record", async () => {
  const current = await fixture();
  const item = current.config.items[0]!;
  const acceptedHead = "b".repeat(40);
  const history = [
    participant(1, item.id, "source", "author", "passed"),
    participant(2, item.id, "source", "reviewer", "passed"),
  ];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return [...history];
    },
    async setup() {
      return { status: "ready" };
    },
    async source() {
      return {
        status: "accepted",
        head: acceptedHead,
        reviewId: history[1]!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("repair must not run");
    },
    async delivery() {
      history.push(participant(3, item.id, "source", "author", "passed"));
      return { ...deliveryCompletion(item, "c".repeat(40), history[1]!.id), retries: 1 };
    },
  };

  await expect(queueStep(current.config, adapter)).resolves.toMatchObject({ status: "complete" });
  expect(
    JSON.parse(await readFile(resolve(current.config.stateDirectory, "attempt.json"), "utf8")),
  ).toMatchObject({ phase: "complete", retries: 1 });
});
