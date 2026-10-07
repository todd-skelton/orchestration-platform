import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentCandidateAttempt,
  QueueBlocked,
  queueConfigFromLoop,
  repositoryQueueAdapter,
  queueStep,
  readQueueHistory,
  validateHistory,
  retainedSourceFailure,
  retainedPostMergeDelivery,
  validateLoopExecutor,
  validateLoopConfig,
  validateQueueConfig,
  verificationStop,
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
import {
  CHASE_REVIEW_DELIVERY_BOUNDARY,
  step as sourceStep,
  workerPrompt,
} from "../../scripts/dogfood/flow.js";
import { codexAdapter } from "../../scripts/dogfood/dispatch-adapter.js";
import { MAX_TERMINAL_SUMMARY_LENGTH } from "../../scripts/dogfood/terminal-summary.mjs";
import prefixedAuthor from "./fixtures/iss-177-prefixed-author.json" with { type: "json" };
import * as selfAdapter from "../../adapters/self.mjs";
import * as chaseAdapter from "../../adapters/chase-sets.mjs";
import { repositoryDeliveryPolicy } from "../../scripts/dogfood/repository-adapter.js";
import type { RepositoryAdapter } from "../../scripts/dogfood/repository-adapter.js";
import { gitSetupAdapter } from "../../scripts/dogfood/setup-adapter.js";
import { setupStep } from "../../scripts/dogfood/setup.js";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import { DeliveryBlocked, type PublicationEvidence } from "../../scripts/dogfood/delivery.mjs";
import {
  completeCycle,
  nextCycle,
  persistCycle,
  reconcilePendingStop,
  startCycle,
  stopCycle,
  type SupervisedCycle,
  type SupervisionAdapter,
} from "../../scripts/dogfood/supervision.js";
import {
  parseRoutingMarker,
  SELF_ROUTING,
  type RoutingRow,
} from "../../scripts/dogfood/routing.mjs";
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
  f.loop.nativeLaunchCeiling = 4;
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
    f.loop.nativeLaunchCeiling =
      next.initialHistory.filter((p) => p.item.startsWith(`${next.selection.key}:`)).length + slots;
    const q = await f.compose(next);
    const calls = f.calls.length;
    await expect(queueStep(q.config, q.adapter)).rejects.toMatchObject({
      reason: "native-launch-ceiling-exhausted",
    });
    expect(f.calls.slice(calls).filter((c) => c.startsWith("launch:"))).toHaveLength(slots);
    expect((await q.adapter.history()).length).toBe(next.initialHistory.length + slots);
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

async function verificationOnlyFixture(cycleNumber = 1) {
  const focused =
    "pnpm --filter @chase-sets/app-platform-worker exec vitest run --config ./vitest.config.ts __tests__/projection-wake-interest-graph.test.ts";
  // Like ISS-228/229, keep the refreshed immutable-base checkout within Windows'
  // path limit while still exercising the real Git worktree and native runner.
  const f = await loopFixture(
    false,
    `- Execute ${focused}`,
    "q-",
    process.platform === "win32" ? (process.env.RUNNER_TEMP ?? tmpdir()) : tmpdir(),
  );
  f.selected.key = "cs-361";
  f.loop.repository = "chase-sets/chase-sets";
  f.loop.nativeLaunchCeiling = 64;
  const git = async (tree: string, args: string[]) =>
    (await execute(f.gitExecutable, ["-C", tree, ...args])).stdout.trim();
  await mkdir(resolve(f.repository, "worker/__tests__"), { recursive: true });
  await writeFile(
    resolve(f.repository, "planning/drafts/cs-361.md"),
    (await readFile(resolve(f.repository, "planning/drafts/ISS-104.md"), "utf8")).replaceAll(
      "ISS-104",
      "cs-361",
    ),
  );
  await writeFile(
    resolve(f.repository, "package.json"),
    JSON.stringify({
      scripts: { "verify:static:scoped": "node gate.mjs", typecheck: "node gate.mjs" },
    }),
  );
  await writeFile(resolve(f.repository, "pnpm-lock.yaml"), "synthetic lock\n");
  await writeFile(resolve(f.repository, "vitest.scripts.config.mjs"), "export default {};\n");
  await mkdir(resolve(f.repository, "scripts/check-structure"), { recursive: true });
  await writeFile(
    resolve(f.repository, "scripts/check-structure/synthetic.test.mjs"),
    "// fixture\n",
  );
  await writeFile(
    resolve(f.repository, "worker/package.json"),
    '{"name":"@chase-sets/app-platform-worker"}',
  );
  await writeFile(resolve(f.repository, "worker/vitest.config.ts"), "export default {};\n");
  await writeFile(
    resolve(f.repository, "worker/__tests__/projection-wake-interest-graph.test.ts"),
    "// Synthetic retained focused-test identity.\n",
  );
  await git(f.repository, ["add", "."]);
  await git(f.repository, ["commit", "-m", "synthetic focused-test manifest"]);
  f.selected.base = await git(f.repository, ["rev-parse", "HEAD"]);
  const policy: RepositoryAdapter = {
    ...repositoryPolicy,
    branchName: chaseAdapter.branchName,
    requiredChecks: chaseAdapter.requiredChecks,
    localGates: chaseAdapter.localGates,
    pullRequest: chaseAdapter.pullRequest,
    mergeMethod: chaseAdapter.mergeMethod,
  };
  const original = await queueConfigFromLoop(f.loop, f.repository, f.selected, policy);
  const attemptDirectory = resolve(f.loop.stateRoot, f.loop.run, "cs-361-attempt-4");
  const sourceDirectory = resolve(attemptDirectory, "source");
  await mkdir(sourceDirectory, { recursive: true });
  const oldTree = resolve(f.loop.worktreeRoot, "retained-source");
  const oldReview = resolve(f.loop.worktreeRoot, "retained-review");
  await git(f.repository, ["worktree", "add", "--detach", oldTree, f.selected.base]);
  await writeFile(resolve(oldTree, "feature.ts"), "export const feature = true;\n");
  await git(oldTree, ["add", "."]);
  await git(oldTree, ["commit", "-m", "synthetic retained unverified candidate"]);
  const candidateHead = await git(oldTree, ["rev-parse", "HEAD"]);
  await git(f.repository, ["worktree", "add", "--detach", oldReview, candidateHead]);
  const history = Array.from({ length: 8 }, (_, index) => ({
    ...participant(
      index + 1,
      `cs-361:${Math.floor(index / 2) + 1}`,
      "source",
      index % 2 ? "reviewer" : "author",
      index % 2 ? "failed" : "passed",
    ),
    id: randomUUID(),
    placement: index % 2 ? f.loop.reviewer : f.loop.author,
  }));
  const source = {
    ...original.items[0]!.source,
    routing: { row: 2, review: 11 as const },
    stateDirectory: sourceDirectory,
    worktree: oldTree,
    reviewWorktree: oldReview,
  };
  const findings = [
    {
      file: "feature.ts",
      line: 1,
      severity: "blocking",
      text: "Synthetic missing native execution evidence, not a quality verdict.",
    },
  ];
  const put = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));
  const author = {
    id: history[6]!.id,
    pid: 1,
    trace: resolve(sourceDirectory, "author.jsonl"),
    launchedAt: 1,
    placement: f.loop.author,
  };
  const reviewer = {
    id: history[7]!.id,
    pid: 2,
    trace: resolve(sourceDirectory, "reviewer.jsonl"),
    launchedAt: 1,
    placement: f.loop.reviewer,
  };
  await put(resolve(sourceDirectory, "config.json"), {
    config: source,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({ config: source, prompts: [source.author.prompt, source.reviewer.prompt] }),
      )
      .digest("hex"),
  });
  await put(resolve(sourceDirectory, "candidate.json"), {
    head: candidateHead,
    changed: ["feature.ts"],
  });
  await put(resolve(sourceDirectory, "author-attempt.json"), author);
  await put(resolve(sourceDirectory, "author-terminal.json"), {
    id: author.id,
    status: "passed",
    head: source.base,
  });
  await put(resolve(sourceDirectory, "reviewer-attempt.json"), reviewer);
  await put(resolve(sourceDirectory, "reviewer-terminal.json"), {
    id: reviewer.id,
    status: "failed",
    head: candidateHead,
    summary: JSON.stringify({
      run: f.loop.run,
      role: "reviewer",
      head: candidateHead,
      verdict: "FAIL",
      findings,
      g0: "Synthetic historical failed review.",
    }),
  });
  await writeFile(author.trace, "synthetic author evidence\n");
  await writeFile(reviewer.trace, "synthetic failed-review evidence\n");
  await put(resolve(attemptDirectory, "attempt.json"), {
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    run: f.loop.run,
    phase: "failed",
    index: 0,
    item: "cs-361:4",
    issue: source.issue,
    base: source.base,
    head: candidateHead,
    reviewId: reviewer.id,
    candidateAttempt: 4,
    findings,
    history,
    retries: 1,
    acceptedStage: null,
    stateDirectory: null,
    authorFailures: { count: 4, ids: history.filter((p) => p.role === "author").map((p) => p.id) },
  });
  const cycle = { selection: { cycle: cycleNumber, ...f.selected }, initialHistory: history };
  const comments: string[] = [];
  const supervisor: SupervisionAdapter = {
    async currentMain() {
      return f.selected.base;
    },
    async issue() {
      return { state: "OPEN", key: f.selected.key, labels: ["status:needs-replan"], comments };
    },
    async comment(_config, _number, body) {
      comments.push(body);
    },
    async removeReady() {
      throw new Error("The synthetic held issue is not ready");
    },
    async close() {
      throw new Error("no external closure");
    },
  };
  await persistCycle(f.loop, cycle);
  await stopCycle(
    f.loop,
    cycle,
    "implementation-attempt-ceiling-exhausted",
    4,
    supervisor,
    repositoryPolicy,
  );
  const grant = {
    run: f.loop.run,
    issueKey: f.selected.key,
    attemptDirectory,
    candidateHead,
    priorReviewId: reviewer.id,
    authorityUrl: `${source.issue}#issuecomment-9001`,
  };
  const loop: LoopConfig = {
    ...f.loop,
    adapter: "chase-sets",
    verificationOnly: grant,
    routingRows: [{ row: 2, review: 11, author: [f.loop.author], reviewer: [f.loop.reviewer] }],
  };
  const remote = resolve(f.repository, "..", "remote.git");
  await execute(f.gitExecutable, ["clone", "--bare", f.repository, remote]);
  await git(f.repository, [
    "remote",
    "add",
    "origin",
    "https://github.com/chase-sets/chase-sets.git",
  ]);
  const launcher = resolve(f.stateRoot, "verification-pnpm.mjs");
  const gateCalls = resolve(f.stateRoot, "verification-gates.txt");
  await writeFile(
    launcher,
    `import {appendFileSync} from 'node:fs'; if(process.argv[2] === 'install') process.exit(0); appendFileSync(${JSON.stringify(gateCalls)}, JSON.stringify({cwd:process.cwd(),argv:process.argv.slice(2)})+'\\n'); console.log('[VERIFY_STATIC_RUN] check:structure');`,
  );
  vi.stubEnv("npm_execpath", launcher);
  const old = await snapshot(resolve(f.loop.stateRoot, f.loop.run));
  let captures = 0;
  const authority = async () => {
    captures++;
    return {
      id: "9001",
      url: grant.authorityUrl,
      author: "todd-skelton",
      body: `Synthetic explicit host grant\n${Object.entries(grant)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")}`,
      capturedAt: "2026-10-05T23:30:00.000Z",
    };
  };
  const observeIssue = vi.fn(async () => ({
    number: f.selected.number,
    url: source.issue,
    state: "OPEN",
    title: "Synthetic verification-only candidate",
  }));
  const compose = (current = loop, observeGrant = authority) =>
    queueConfigFromLoop(
      current,
      f.repository,
      f.selected,
      policy,
      history,
      undefined,
      observeGrant,
      undefined,
      observeIssue,
    );
  const launches: string[] = [];
  const prompts: string[] = [];
  const observations: { event: string; head: string }[] = [];
  let focusedArgv = focused.split(" ").slice(1);
  let reviewRunning = true;
  let rejectReview = false;
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      const result = await git(
        tree,
        args[0] === "fetch" ? args.map((arg) => (arg === "origin" ? remote : arg)) : args,
      );
      if (args[0] === "fetch")
        observations.push({
          event: "fetch",
          head: await git(tree, ["rev-parse", "refs/remotes/origin/main"]),
        });
      return result;
    },
    async launch(role, current, prompt) {
      expect(role).toBe("reviewer");
      launches.push(role);
      prompts.push(prompt);
      expect(prompt.split(CHASE_REVIEW_DELIVERY_BOUNDARY)).toHaveLength(2);
      expect(prompt).toContain(grant.priorReviewId);
      expect(prompt).toContain(JSON.stringify(author.trace));
      const calls = (await readFile(gateCalls, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls.slice(-3).map((call) => call.argv)).toEqual([
        ["run", "verify:static:scoped"],
        ["run", "typecheck"],
        focusedArgv,
      ]);
      return {
        id: randomUUID(),
        pid: 3,
        trace: resolve(current.stateDirectory, "new-review.jsonl"),
        launchedAt: 1,
      };
    },
    async observe(role, current, attempt) {
      if (reviewRunning) return { id: attempt.id, status: "running" };
      const head = await git(current.worktree, ["rev-parse", "HEAD"]);
      observations.push({ event: rejectReview ? "FAIL" : "PASS", head });
      return {
        id: attempt.id,
        status: rejectReview ? "failed" : "passed",
        head,
        summary: JSON.stringify({
          run: current.run,
          role,
          head,
          verdict: rejectReview ? "FAIL" : "PASS",
          findings: rejectReview ? findings : [],
          g0: "Synthetic fresh review after native execution.",
        }),
      };
    },
    async checks() {
      throw new Error("no worker hosted checks");
    },
  };
  const effects: string[] = [];
  let publication: PublicationEvidence | undefined;
  let green = false,
    merged = false,
    cleaned = false;
  const delivery = githubDeliveryAdapter(undefined, f.gitExecutable);
  delivery.observePublication = async () =>
    publication
      ? { state: "confirmed", value: publication }
      : { state: "needs-mutation", target: "absent" };
  delivery.publish = async (current, plan) => {
    effects.push("publish");
    publication = {
      ...plan,
      number: 9002,
      url: "https://github.com/chase-sets/chase-sets/pull/9002",
      repository: current.repository,
      head: current.candidateHead,
      planDigest: createHash("sha256")
        .update(
          JSON.stringify(
            JSON.parse(
              await readFile(resolve(current.stateDirectory, "delivery-plan.json"), "utf8"),
            ).plan,
          ),
        )
        .digest("hex"),
    };
    delete (publication as unknown as Record<string, unknown>).draft;
  };
  delivery.checks = async (current) => ({
    head: current.candidateHead,
    checks: current.requiredChecks.map((name) => ({
      name,
      bucket: green ? "pass" : "pending",
      link: `https://example.test/check/${encodeURIComponent(name)}`,
    })),
  });
  delivery.observeMerge = async (_current, published) =>
    merged
      ? {
          state: "confirmed",
          value: { number: published.number, head: published.head, mergeCommit: published.head },
        }
      : { state: "needs-mutation" };
  delivery.merge = async () => {
    effects.push("merge");
    merged = true;
  };
  delivery.observeCleanup = async (_current, plan) =>
    cleaned ? { state: "confirmed", value: plan } : { state: "needs-mutation" };
  delivery.cleanup = async () => {
    effects.push("cleanup");
    cleaned = true;
  };
  const adapter = (q: QueueConfig, worker = native) => {
    return repositoryQueueAdapter(q, f.repository, {
      native: worker,
      delivery,
      gitExecutable: f.gitExecutable,
      setup: gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, tree) {
          await mkdir(resolve(tree, "node_modules"));
          await writeFile(resolve(tree, "node_modules/.modules.yaml"), "synthetic\n");
          return "succeeded";
        },
      }),
      repository: {
        ...policy,
        async afterMerge() {
          effects.push("deployment");
        },
      },
      deliveryPolicy: repositoryDeliveryPolicy(policy, f.gitExecutable),
    });
  };
  return {
    ...f,
    loop,
    policy,
    observeIssue,
    prompts,
    observations,
    grant,
    compose,
    supervisor,
    cycle,
    old,
    git,
    remote,
    captures: () => captures,
    authority,
    launcher,
    original,
    native,
    launches,
    adapter,
    delivery,
    effects,
    gateCalls,
    waitReview: () => {
      reviewRunning = true;
    },
    focusedArgv: (argv: string[]) => {
      focusedArgv = argv;
    },
    hostedGreen: () => {
      green = true;
    },
    finish: (fail = false) => {
      reviewRunning = false;
      rejectReview = fail;
    },
  };
}

async function verificationMovementFixture(
  fixture?: Awaited<ReturnType<typeof verificationOnlyFixture>>,
) {
  const f = fixture ?? (await verificationOnlyFixture());
  const q = await f.compose();
  const updater = resolve(f.loop.worktreeRoot, "main-updater");
  await f.git(f.repository, ["worktree", "add", "--detach", updater, f.selected.base]);
  const read = async (directory: string, name: string) =>
    JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  const move = async (file = "main.ts") => {
    await writeFile(
      resolve(updater, file),
      `export const main = ${JSON.stringify(randomUUID())};\n`,
    );
    await f.git(updater, ["add", "."]);
    await f.git(updater, ["commit", "-m", "compatible synthetic main"]);
    const head = await f.git(updater, ["rev-parse", "HEAD"]);
    await f.git(f.remote, ["fetch", updater, "HEAD:refs/heads/main"]);
    return head;
  };
  const resume = async () => {
    const cycle = await nextCycle(f.loop, f.repository, f.supervisor, repositoryPolicy);
    expect(cycle?.selection).toEqual(f.cycle.selection);
    expect(
      await reconcilePendingStop(f.loop, cycle!, f.supervisor, repositoryPolicy),
    ).toBeUndefined();
    expect(await retainedPostMergeDelivery(f.loop, f.selected)).toBeUndefined();
    const current = await f.compose();
    return queueStep(current, f.adapter(current));
  };
  const accept = async () => {
    await resume();
    f.finish();
    const adapter = f.adapter(q);
    await queueStep(q, {
      ...adapter,
      async delivery() {
        return { status: "observing-reviewer" };
      },
    });
    return read(q.stateDirectory, "attempt");
  };
  return { ...f, q, read, move, resume, accept, updater };
}

it.each(["during-review", "accepted", "retained-stop", "pending-stop"])(
  "ISS-234 integrates moving main through production replay: %s",
  async (mode) => {
    const f = await verificationMovementFixture();
    const { q } = f;
    const reservation = await readFile(
      resolve(f.grant.attemptDirectory, "verification-only.json"),
      "utf8",
    );
    const configBytes = JSON.stringify(f.loop);
    const mainA = await f.move("a.ts");
    expect((await f.resume()).status).toBe("observing-reviewer");
    const first = await f.read(q.items[0]!.source.stateDirectory, "native-refresh");
    expect(first.main).toBe(mainA);
    f.finish();
    if (mode === "accepted") {
      const adapter = f.adapter(q);
      await queueStep(q, {
        ...adapter,
        async delivery() {
          return { status: "observing-reviewer" };
        },
      });
      expect((await f.read(q.stateDirectory, "attempt")).phase).toBe("delivery");
    } else if (mode !== "during-review") {
      // Stop exactly after native source PASS but before the queue accepts it,
      // reproducing the pre-ISS-234 persisted incident without editing live state.
      const adapter = f.adapter(q);
      await adapter.source(q.items[0]!);
      await writeFile(
        resolve(q.stateDirectory, "verification-stop.json"),
        JSON.stringify({ reason: "current-main-moved" }),
      );
      await stopCycle(
        f.loop,
        { ...f.cycle, initialHistory: await adapter.history() },
        "current-main-moved",
        4,
        f.supervisor,
        repositoryPolicy,
      );
      if (mode === "pending-stop")
        await rm(resolve(f.loop.stateRoot, f.loop.run, "cycle-1-stop-2-complete.json"));
    }
    const mainB = await f.move("b.ts");
    if (mode === "during-review") {
      expect((await f.resume()).status).toBe("observing-reviewer");
      expect(f.launches).toHaveLength(1);
    }
    f.waitReview();
    expect((await f.resume()).status).toBe("observing-reviewer");
    expect((await f.resume()).status).toBe("observing-reviewer");
    expect(f.launches).toHaveLength(2);
    expect(f.effects).toEqual([]);
    const origin = mode === "accepted" ? first.directory : q.items[0]!.source.stateDirectory;
    const second = await f.read(origin, "native-refresh");
    expect(second).toMatchObject({
      main: mainB,
      previousHead: first.head,
      previousDirectory: first.directory,
    });
    expect(second.head).not.toBe(first.head);
    expect(f.observations.filter((row) => row.event === "fetch").map((row) => row.head)).toContain(
      mainA,
    );
    const passed = f.observations.findIndex(
      (row) => row.event === "PASS" && row.head === first.head,
    );
    const fetched = f.observations.findIndex((row) => row.event === "fetch" && row.head === mainB);
    expect(passed).toBeGreaterThanOrEqual(0);
    // Native refresh brackets review with fresh remote observations, not selection's pin.
    // During-review movement may first be observed before the terminal is collected;
    // its post-review recheck must still observe exactly B before yielding.
    expect(f.observations.slice(passed + 1)).toContainEqual({ event: "fetch", head: mainB });
    expect(fetched).toBeGreaterThanOrEqual(0);
    for (const gate of ["verify:static:scoped", "typecheck", "test"]) {
      const relative = `gate-${createHash("sha256").update(gate).digest("hex")}`;
      for (const refresh of [first, second])
        expect(
          await f.read(resolve(refresh.directory, relative), "candidate-terminal"),
        ).toMatchObject({ head: refresh.head, code: 0 });
    }
    expect(f.prompts[1]).toContain(second.previousReview);
    expect(f.prompts[1]).toContain(first.directory);
    f.finish();
    expect((await f.resume()).status).toBe("observing-hosted-checks");
    expect(f.effects).toEqual(["publish"]);
    // Once publication exists, moving main is ordinary publication reconciliation.
    await f.move("after-publication.ts");
    expect((await f.resume()).status).toBe("observing-hosted-checks");
    f.hostedGreen();
    expect((await f.resume()).status).toBe("complete");
    expect((await queueStep(await f.compose(), f.adapter(q))).status).toBe("complete");
    expect(await retainedPostMergeDelivery(f.loop, f.selected)).toBeDefined();
    expect(f.effects).toEqual(["publish", "merge", "cleanup", "deployment"]);
    expect(f.launches).toHaveLength(2);
    expect(
      await readFile(resolve(f.grant.attemptDirectory, "verification-only.json"), "utf8"),
    ).toBe(reservation);
    expect(JSON.stringify(f.loop)).toBe(configBytes);
    for (const [path, bytes] of f.old) expect(await readFile(path, "utf8"), path).toBe(bytes);
    expect(f.captures()).toBe(1);
  },
);

it.each(["missing", "malformed", "wrong-head", "wrong-id", "failed", "foreign-issue"])(
  "ISS-234 retained movement requires a complete bound PASS: %s",
  async (mode) => {
    const f = await verificationMovementFixture();
    await f.accept();
    const active = await f.read(f.q.items[0]!.source.stateDirectory, "native-refresh");
    const terminalPath = resolve(active.directory, "reviewer-terminal.json");
    const terminal = await f.read(active.directory, "reviewer-terminal");
    if (mode === "missing") await rm(terminalPath);
    else if (mode === "malformed") await writeFile(terminalPath, "{");
    else if (mode === "foreign-issue") {
      const pinned = await f.read(active.directory, "config");
      pinned.config.issue += "1";
      await writeFile(resolve(active.directory, "config.json"), JSON.stringify(pinned));
    } else {
      if (mode === "wrong-head") terminal.head = "a".repeat(40);
      if (mode === "wrong-id") terminal.id = "foreign-review";
      if (mode === "failed") terminal.status = "failed";
      await writeFile(terminalPath, JSON.stringify(terminal));
    }
    await writeFile(
      resolve(f.q.stateDirectory, "verification-stop.json"),
      JSON.stringify({ reason: "current-main-moved" }),
    );
    await f.move();
    await expect(queueStep(f.q, f.adapter(f.q))).rejects.toBeInstanceOf(QueueBlocked);
    expect(f.launches).toHaveLength(1);
    expect(f.effects).toEqual([]);
  },
);

it.each([
  "incompatible-main",
  "source-head",
  "source-review",
  "spent-stop",
  "delta-fail",
  "conflict",
  "gate-fail",
])("ISS-234 protection %s is load-bearing before publication", async (mode) => {
  const f = await verificationMovementFixture();
  const accepted = await f.accept();
  if (mode === "source-head" || mode === "source-review") {
    accepted[mode === "source-head" ? "head" : "reviewId"] =
      mode === "source-head" ? "a".repeat(40) : "foreign-review";
    await writeFile(resolve(f.q.stateDirectory, "attempt.json"), JSON.stringify(accepted));
  } else if (mode === "spent-stop") {
    await writeFile(
      resolve(f.q.stateDirectory, "verification-stop.json"),
      JSON.stringify({ reason: "gate-host-failed:typecheck" }),
    );
  }
  if (mode === "incompatible-main") {
    // Keep a shared Git ancestor but remove the recorded delivery-main base.
    const old = await f.git(f.updater, ["rev-parse", `${f.selected.base}^`]);
    await f.git(f.remote, ["update-ref", "refs/heads/main", old]);
    // Acquire that actual remote commit rather than testing Git's non-fast-forward
    // transport refusal against an already populated tracking ref.
    await f.git(f.q.items[0]!.source.worktree, ["update-ref", "-d", "refs/remotes/origin/main"]);
  } else await f.move(mode === "conflict" ? "feature.ts" : "main.ts");
  if (mode === "gate-fail") vi.stubEnv("npm_execpath", resolve(f.stateRoot, "missing-pnpm.mjs"));
  f.waitReview();
  const reason =
    mode === "incompatible-main"
      ? "current-main-incompatible"
      : mode.startsWith("source-")
        ? "delivery-source-drift"
        : mode === "spent-stop"
          ? "gate-host-failed:typecheck"
          : mode === "conflict"
            ? "verification-only-refresh-conflict"
            : mode === "gate-fail"
              ? "gate-attribution-unknown:verify:static:scoped"
              : "refresh-review-failed";
  if (mode === "delta-fail") {
    expect((await f.resume()).status).toBe("observing-reviewer");
    f.finish(true);
  }
  await expect(queueStep(f.q, f.adapter(f.q))).rejects.toMatchObject({ reason });
  await f.move("later.ts");
  await expect(queueStep(await f.compose(), f.adapter(f.q))).rejects.toMatchObject({ reason });
  expect(f.effects).toEqual([]);
  expect(f.launches).toHaveLength(mode === "delta-fail" ? 2 : 1);
});

it.each([false, true])(
  "ISS-234 a later failure supersedes the preserved movement stop in every reader (interrupted: %s)",
  async (interrupted) => {
    const f = await verificationMovementFixture();
    const accepted = await f.accept();
    const stoppedPath = resolve(f.q.stateDirectory, "verification-stop.json");
    await writeFile(stoppedPath, JSON.stringify({ reason: "current-main-moved" }));
    await stopCycle(
      f.loop,
      { ...f.cycle, initialHistory: await f.adapter(f.q).history() },
      "current-main-moved",
      4,
      f.supervisor,
      repositoryPolicy,
    );
    const bytes = await readFile(stoppedPath, "utf8");
    await f.move();
    f.waitReview();
    expect((await f.resume()).status).toBe("observing-reviewer");
    f.finish(true);
    await expect(
      interrupted ? f.adapter(f.q).delivery(f.q.items[0]!, accepted) : f.resume(),
    ).rejects.toMatchObject({ reason: "refresh-review-failed" });
    for (const observe of [
      () => queueStep(f.q, f.adapter(f.q)),
      () => nextCycle(f.loop, f.repository, f.supervisor, repositoryPolicy),
      () => retainedPostMergeDelivery(f.loop, f.selected),
    ])
      await expect(observe()).rejects.toMatchObject({ reason: "refresh-review-failed" });
    expect(await readFile(stoppedPath, "utf8")).toBe(bytes);
    expect(f.launches).toHaveLength(2);
    await stopCycle(
      f.loop,
      { ...f.cycle, initialHistory: await f.adapter(f.q).history() },
      "refresh-review-failed",
      4,
      f.supervisor,
      repositoryPolicy,
    );
    expect(await nextCycle(f.loop, f.repository, f.supervisor, repositoryPolicy)).toBeUndefined();
  },
);

it("ISS-234 repeated movement charges reviewers and stops at the existing native ceiling", async () => {
  const f = await verificationOnlyFixture();
  // Sixty-one retained launches plus three reviews; the configured 64 stays fixed.
  for (let index = 0; index < 53; index++)
    f.cycle.initialHistory.push({
      ...participant(index + 9, `cs-${800 + index}:1`, "source", "author", "failed"),
      id: randomUUID(),
      placement: f.loop.author!,
    });
  for (const path of [
    resolve(f.grant.attemptDirectory, "attempt.json"),
    resolve(f.loop.stateRoot, f.loop.run, "cycle-1-stop-1.json"),
    resolve(f.loop.stateRoot, f.loop.run, "cycle-1-stop-1-complete.json"),
  ]) {
    const saved = JSON.parse(await readFile(path, "utf8"));
    saved.history = f.cycle.initialHistory;
    await writeFile(path, JSON.stringify(saved));
  }
  const q = await f.compose();
  const updater = resolve(f.loop.worktreeRoot, "moving-main");
  await f.git(f.repository, ["worktree", "add", "--detach", updater, f.selected.base]);
  for (let index = 0; index < 3; index++) {
    f.waitReview();
    expect((await queueStep(q, f.adapter(q))).status).toBe("observing-reviewer");
    expect((await queueStep(await f.compose(), f.adapter(q))).status).toBe("observing-reviewer");
    expect(f.launches).toHaveLength(index + 1);
    await writeFile(resolve(updater, `main-${index}.ts`), "// main\n");
    await f.git(updater, ["add", "."]);
    await f.git(updater, ["commit", "-m", "move during review"]);
    await f.git(f.remote, ["fetch", updater, "HEAD:refs/heads/main"]);
    f.finish();
    expect((await queueStep(q, f.adapter(q))).status).toBe("observing-reviewer");
  }
  await expect(queueStep(q, f.adapter(q))).rejects.toMatchObject({
    reason: "native-launch-ceiling-exhausted",
  });
  await expect(queueStep(await f.compose(), f.adapter(q))).rejects.toMatchObject({
    reason: "native-launch-ceiling-exhausted",
  });
  expect(await f.adapter(q).history()).toHaveLength(64);
  expect(f.launches).toHaveLength(3);
  expect(f.effects).toEqual([]);
});

it("ISS-234 retained post-merge reconciliation accepts completion before the queue result write", async () => {
  const f = await verificationMovementFixture();
  const accepted = await f.accept();
  await f.move();
  f.waitReview();
  await f.resume();
  f.finish();
  f.hostedGreen();
  const before = await readFile(resolve(f.q.stateDirectory, "attempt.json"), "utf8");
  expect(await f.adapter(f.q).delivery(f.q.items[0]!, accepted)).toMatchObject({
    status: "complete",
  });
  const refresh = await f.read(accepted.stateDirectory, "native-refresh");
  expect(refresh.head).not.toBe(accepted.head);
  expect(await retainedPostMergeDelivery(f.loop, f.selected)).toBeDefined();
  expect(await readFile(resolve(f.q.stateDirectory, "attempt.json"), "utf8")).toBe(before);
  expect((await queueStep(await f.compose(), f.adapter(f.q))).status).toBe("complete");
  expect(await retainedPostMergeDelivery(f.loop, f.selected)).toBeDefined();
  expect(f.effects.filter((effect) => ["publish", "merge", "cleanup"].includes(effect))).toEqual([
    "publish",
    "merge",
    "cleanup",
  ]);
  expect(f.launches).toHaveLength(2);
});

it("ISS-234 retains the pinned brief and focused execution at the successor head", async () => {
  const pinned = await pinnedVerificationFixture();
  const body = pinned.brief.body;
  const f = await verificationMovementFixture(pinned);
  const accepted = await f.accept();
  await f.move();
  pinned.brief.body = "Unrelated later live edit";
  f.waitReview();
  expect((await f.resume()).status).toBe("observing-reviewer");
  const active = await f.read(accepted.stateDirectory, "native-refresh");
  expect(f.prompts[1]).toContain(body);
  expect(f.prompts[1]).toContain(JSON.stringify(pinned.pin));
  const directory = resolve(
    active.directory,
    `gate-${createHash("sha256").update("test").digest("hex")}`,
  );
  expect(await f.read(directory, "candidate-terminal")).toMatchObject({
    head: active.head,
    code: 0,
  });
  expect(pinned.policy.verificationBrief).toHaveBeenCalledTimes(1);
  expect(f.effects).toEqual([]);
});

it("ISS-234 resumes the integration before launch without another verification reservation", async () => {
  const f = await verificationMovementFixture();
  await f.resume();
  f.finish();
  await f.move();
  expect((await f.resume()).status).toBe("observing-reviewer");
  f.native.waitForProvider = async () => {
    throw new QueueBlocked("provider-unavailable");
  };
  await expect(f.adapter(f.q).source(f.q.items[0]!)).rejects.toMatchObject({
    reason: "provider-unavailable",
  });
  const active = await f.read(f.q.items[0]!.source.stateDirectory, "native-refresh");
  await expect(readFile(resolve(active.directory, "reviewer-attempt.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  delete f.native.waitForProvider;
  f.waitReview();
  expect((await f.resume()).status).toBe("observing-reviewer");
  expect(f.launches).toHaveLength(2);
  expect(f.captures()).toBe(1);
  expect(f.effects).toEqual([]);
});

it("ISS-234 a malformed integration reviewer cannot renew the consumed worker retry", async () => {
  const f = await verificationMovementFixture();
  await f.accept();
  await f.move();
  f.waitReview();
  await f.resume();
  f.native.observe = async (_role, _current, attempt) => ({ id: attempt.id, status: "malformed" });
  await expect(f.resume()).rejects.toBeInstanceOf(QueueBlocked);
  await expect(queueStep(f.q, f.adapter(f.q))).rejects.toBeInstanceOf(QueueBlocked);
  expect(f.launches).toHaveLength(2);
  expect(f.effects).toEqual([]);
});

it.each(["intent", "published", "cleanup", "published-conflict"])(
  "ISS-234 publication protection preserves %s across main movement",
  async (mode) => {
    const f = await verificationMovementFixture();
    const accepted = await f.accept();
    if (mode === "intent") {
      const publish = f.delivery.publish;
      const observe = f.delivery.observePublication;
      let uncertain = false;
      f.delivery.observePublication = async (...args) =>
        uncertain ? { state: "unknown" } : observe(...args);
      f.delivery.publish = async (...args) => {
        await publish(...args);
        uncertain = true;
        throw new Error("lost response");
      };
      await expect(f.adapter(f.q).delivery(f.q.items[0]!, accepted)).rejects.toBeDefined();
      f.delivery.publish = publish;
      f.delivery.observePublication = observe;
      expect(await f.read(accepted.stateDirectory, "publication-intent")).toBeDefined();
    } else {
      if (mode === "cleanup") f.hostedGreen();
      await queueStep(f.q, f.adapter(f.q));
    }
    const before = await snapshot(accepted.stateDirectory);
    await f.move();
    if (mode === "published-conflict")
      f.delivery.checks = async () => {
        throw new DeliveryBlocked("published-candidate-conflict");
      };
    const resumed = await queueStep(f.q, f.adapter(f.q)).catch((error: unknown) => error);
    expect(f.launches).toHaveLength(1);
    expect(f.effects.filter((effect) => effect === "publish")).toHaveLength(1);
    for (const [path, bytes] of before) expect(await readFile(path, "utf8"), path).toBe(bytes);
    if (mode === "published-conflict")
      expect(resumed).toMatchObject({ reason: "verification-only-refresh-conflict" });
    else expect(resumed).not.toBeInstanceOf(Error);
  },
);

// ISS-233 fixtures retain completed stops, not completed cycles: the latter
// bypass completedItemStop and cannot reproduce VO-HISTORY-1.
async function mixedVerificationHistory(targetCycle = 3) {
  const f = await verificationOnlyFixture(targetCycle);
  const directory = resolve(f.loop.stateRoot, f.loop.run);
  // Retain charged participants from both unrelated issues. The original
  // fixture's composition closure shares this accumulated history array.
  for (const participant of f.cycle.initialHistory) participant.ordinal++;
  f.cycle.initialHistory.unshift({
    ...participant(1, "cs-360:1", "source", "author", "failed"),
    id: randomUUID(),
    placement: f.loop.author!,
  });
  for (const name of [
    "cs-361-attempt-4/attempt",
    `cycle-${targetCycle}-stop-1`,
    `cycle-${targetCycle}-stop-1-complete`,
  ]) {
    const path = resolve(directory, `${name}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.history = f.cycle.initialHistory;
    await writeFile(path, JSON.stringify(record));
  }
  const host: SupervisionAdapter = {
    ...f.supervisor,
    async issue(config, number, purpose) {
      return { ...(await f.supervisor.issue(config, number, purpose)), key: `cs-${number}` };
    },
  };
  const laterHistory = [
    ...f.cycle.initialHistory,
    { ...participant(10, "cs-362:1", "source", "author", "failed"), id: randomUUID() },
  ];
  // Create the target first and the other cycles in reverse order. Cycle 10
  // additionally sorts before cycle 2 in a lexical directory enumeration.
  for (let cycle = targetCycle + 1; cycle >= 1; cycle--) {
    if (cycle === targetCycle) continue;
    const sameKey = cycle === 2;
    const retained = {
      selection: {
        cycle,
        key: sameKey ? f.selected.key : `cs-${cycle === 1 ? 360 : 362}`,
        number: sameKey ? f.selected.number : cycle === 1 ? 360 : 362,
        base: f.selected.base,
      },
      initialHistory:
        cycle > targetCycle ? laterHistory : f.cycle.initialHistory.slice(0, cycle === 1 ? 1 : 7),
    };
    await persistCycle(f.loop, retained);
    for (const reason of sameKey
      ? [
          "current-main-unavailable",
          "issue-observation-unavailable",
          "provider-unavailable",
          "refresh-review-failed",
        ]
      : ["implementation-attempt-ceiling-exhausted"])
      await stopCycle(f.loop, retained, reason, 3, host, repositoryPolicy);
  }
  const resume = (loop = f.loop) => nextCycle(loop, f.repository, host, repositoryPolicy);
  const authority = async () => {
    await expect(
      readFile(resolve(f.grant.attemptDirectory, "verification-only.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    return f.authority();
  };
  return {
    ...f,
    directory,
    host,
    laterHistory,
    resume,
    compose: (loop = f.loop) => f.compose(loop, authority),
    before: await snapshot(directory),
    change: async (name: string, mutate: (record: any) => void) => {
      const path = resolve(directory, `${name}.json`);
      const record = JSON.parse(await readFile(path, "utf8"));
      mutate(record);
      await writeFile(path, JSON.stringify(record));
    },
  };
}

it.each([3, 10])(
  "ISS-233 mixed stopped history reaches only cycle %s and preserves replay accounting",
  async (targetCycle) => {
    const f = await mixedVerificationHistory(targetCycle);
    for (let replay = 0; replay < 2; replay++) {
      expect((await f.resume())?.selection).toEqual(f.cycle.selection);
      expect((await verificationStop(f.loop, f.cycle.selection))?.stop.marker).toBe(
        `loop-stop:${f.loop.run}:${targetCycle}:1`,
      );
    }
    const configBytes = JSON.stringify(f.loop);
    const q = await f.compose();
    expect(q.initialHistory).toEqual(f.laterHistory);
    expect(q.items[0]!.implementationAttempt).toBe(4);
    expect(q.nativeLaunchCeiling).toBe(64);
    const reservationPath = resolve(f.grant.attemptDirectory, "verification-only.json");
    const reservation = await readFile(reservationPath, "utf8");
    expect(JSON.parse(reservation).stop.marker).toBe(`loop-stop:${f.loop.run}:${targetCycle}:1`);
    const adapter = f.adapter(q);
    for (let replay = 0; replay < 2; replay++) {
      expect((await f.resume())?.selection).toEqual(f.cycle.selection);
      expect((await queueStep(await f.compose(), adapter)).status).toBe("observing-reviewer");
      expect(await readFile(reservationPath, "utf8")).toBe(reservation);
    }
    expect(f.launches).toEqual(["reviewer"]);
    expect(f.captures()).toBe(1);
    f.finish(true);
    await expect(queueStep(q, adapter)).rejects.toMatchObject({ reason: "refresh-review-failed" });
    await stopCycle(
      f.loop,
      { ...f.cycle, initialHistory: await adapter.history() },
      "refresh-review-failed",
      4,
      f.host,
      repositoryPolicy,
    );
    for (let replay = 0; replay < 2; replay++) {
      await expect(queueStep(await f.compose(), adapter)).rejects.toMatchObject({
        reason: "refresh-review-failed",
      });
      expect(await f.resume()).toBeUndefined();
    }
    const attempt = JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"));
    expect(attempt).toMatchObject({
      candidateAttempt: 4,
      retries: 1,
      authorFailures: { count: 4 },
    });
    const charged = await adapter.history();
    expect(charged.slice(0, 10)).toEqual(f.laterHistory);
    expect(charged).toHaveLength(11);
    expect(charged[10]).toMatchObject({ ordinal: 11, role: "reviewer", item: "cs-361:4" });
    await expect(
      f.compose({
        ...f.loop,
        verificationOnly: {
          ...f.grant,
          authorityUrl: f.grant.authorityUrl.replace("9001", "9002"),
        },
      }),
    ).rejects.toMatchObject({ reason: "verification-only-mismatch" });
    const { verificationOnly: _grant, ...ordinary } = f.loop;
    await expect(f.resume(ordinary)).rejects.toMatchObject({ reason: "verification-only-spent" });
    expect(f.launches).toEqual(["reviewer"]);
    expect(f.effects).toEqual([]);
    expect(JSON.stringify(f.loop)).toBe(configBytes);
    for (const [path, bytes] of f.before) expect(await readFile(path, "utf8"), path).toBe(bytes);
  },
);

it("ISS-233 orders stop ordinals numerically within the latest cycle", async () => {
  const f = await mixedVerificationHistory();
  for (const suffix of ["", "-complete"])
    await rm(resolve(f.directory, `cycle-3-stop-1${suffix}.json`));
  for (let stop = 1; stop <= 10; stop++)
    await stopCycle(
      f.loop,
      f.cycle,
      stop === 10 ? "reviewer-failed" : "current-main-unavailable",
      4,
      f.host,
      repositoryPolicy,
    );
  expect((await f.resume())?.selection).toEqual(f.cycle.selection);
  const q = await f.compose();
  const saved = JSON.parse(
    await readFile(resolve(f.grant.attemptDirectory, "verification-only.json"), "utf8"),
  );
  expect(saved.stop.marker).toBe(`loop-stop:${f.loop.run}:3:10`);
  expect(q.items[0]!.implementationAttempt).toBe(4);
  expect(f.launches).toEqual([]);
});

it.each([
  "head",
  "review",
  "run",
  "review-status",
  "absolute-attempt",
  "attempt",
  "marker",
  "completion",
  "key",
  "number",
  "reason",
  "older-match",
])("ISS-233 rejects target %s before reservation without falling back", async (mode) => {
  const f = await mixedVerificationHistory();
  if (mode === "run")
    await f.change("cs-361-attempt-4/attempt", (r) => {
      r.run = "foreign-run";
    });
  if (mode === "review-status")
    await f.change("cs-361-attempt-4/source/reviewer-terminal", (r) => {
      r.status = "passed";
    });
  if (mode === "absolute-attempt")
    await f.change("cs-361-attempt-4/attempt", (r) => {
      r.candidateAttempt = 3;
    });
  if (mode === "head")
    await f.change("cs-361-attempt-4/attempt", (r) => {
      r.head = "f".repeat(40);
    });
  if (mode === "review")
    await f.change("cs-361-attempt-4/attempt", (r) => {
      r.reviewId = randomUUID();
    });
  if (mode === "attempt")
    await f.change("cycle-3-stop-1", (r) => {
      r.attempts = 3;
    });
  if (mode === "marker")
    await f.change("cycle-3-stop-1", (r) => {
      r.marker += ":foreign";
    });
  if (mode === "completion")
    await f.change("cycle-3-stop-1-complete", (r) => {
      r.history = [];
    });
  if (mode === "key")
    await f.change("cycle-3-stop-1", (r) => {
      r.selection.key = "cs-999";
    });
  if (mode === "number")
    await f.change("cycle-3-stop-1", (r) => {
      r.selection.number = 999;
    });
  if (mode === "reason" || mode === "older-match")
    await f.change("cycle-3-stop-1", (r) => {
      r.reason = "author-failed";
    });
  if (mode === "older-match")
    await f.change("cycle-2-stop-4", (r) => {
      r.reason = "implementation-attempt-ceiling-exhausted";
      r.attempts = 4;
    });
  const before = await snapshot(f.directory);
  if (mode === "completion") {
    expect((await f.resume())?.selection).toEqual(f.cycle.selection);
    await expect(f.compose()).rejects.toMatchObject({ reason: "verification-only-mismatch" });
  } else {
    // A malformed target must refuse discovery, not quietly become idle.
    await expect(f.resume()).rejects.toMatchObject({ reason: "verification-only-mismatch" });
  }
  expect(await snapshot(f.directory)).toEqual(before);
  expect(f.captures()).toBe(0);
  expect(f.launches).toEqual([]);
  expect(f.effects).toEqual([]);
});

it.each([true, false])(
  "ISS-233 reconciles pending notes with historical applicability (target: %s)",
  async (target) => {
    const f = await mixedVerificationHistory();
    const cycle = target
      ? f.cycle
      : {
          selection: JSON.parse(
            await readFile(resolve(f.directory, "cycle-2-selected.json"), "utf8"),
          ),
          initialHistory: f.cycle.initialHistory.slice(0, 7),
        };
    const number = target ? 1 : 4;
    await rm(resolve(f.directory, `cycle-${cycle.selection.cycle}-stop-${number}-complete.json`));
    expect((await f.resume())?.selection).toEqual(cycle.selection);
    const outcome = await reconcilePendingStop(f.loop, cycle, f.host, repositoryPolicy);
    expect(outcome).toEqual(
      target ? undefined : { scope: "item", reason: "refresh-review-failed" },
    );
    expect(
      JSON.parse(
        await readFile(
          resolve(f.directory, `cycle-${cycle.selection.cycle}-stop-${number}-complete.json`),
          "utf8",
        ),
      ).selection,
    ).toEqual(cycle.selection);
    expect((await f.resume())?.selection).toEqual(f.cycle.selection);
    await f.compose();
    expect(f.captures()).toBe(1);
    expect(f.launches).toEqual([]);
  },
);

it("ISS-233 leaves no-grant and foreign-key history ordinary", async () => {
  const f = await mixedVerificationHistory();
  const { verificationOnly: _grant, ...ordinary } = f.loop;
  expect(await f.resume(ordinary)).toBeUndefined();
  expect(await verificationStop(f.loop, { key: "cs-362", number: 362, cycle: 4 })).toBeUndefined();
  expect(await snapshot(f.directory)).toEqual(f.before);
  expect(f.captures()).toBe(0);
  expect(f.launches).toEqual([]);
});

it.each(["malformed", "unreadable"])(
  "ISS-233 does not suppress %s historical records",
  async (mode) => {
    const f = await mixedVerificationHistory();
    const path = resolve(f.directory, "cycle-2-stop-1.json");
    if (mode === "malformed") await writeFile(path, "{");
    else {
      await rm(path);
      await mkdir(path);
    }
    await expect(f.resume()).rejects.toThrow();
    await expect(
      readFile(resolve(f.grant.attemptDirectory, "verification-only.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.launches).toEqual([]);
  },
);

async function pinnedVerificationFixture() {
  const f = await verificationOnlyFixture();
  const focused =
    "pnpm exec vitest run --config ./vitest.scripts.config.mjs scripts/check-structure/synthetic.test.mjs";
  const body = ` \r\n<!-- routing: {"version":1,"row":2,"review":11} -->\n## Acceptance\n- Execute ${focused}\n- Repaired synthetic acceptance: café.\n\r\n \t`;
  const brief = {
    number: f.selected.number,
    url: `https://github.com/chase-sets/chase-sets/issues/${f.selected.number}`,
    title: "Synthetic repaired brief",
    state: "OPEN",
    body,
    updatedAt: "2026-10-06T02:14:02Z",
    observedAt: "2026-10-06T02:20:00.000Z",
    routing: { row: 2, review: 11 as const },
    refined: true,
  };
  const pin = {
    sha256: createHash("sha256").update(body).digest("hex"),
    updatedAt: brief.updatedAt,
  };
  f.loop.verificationOnly = { ...f.grant, briefRevision: pin };
  f.policy.verificationBrief = vi.fn(async () => ({ ...brief }));
  const grantObservation = async () => {
    const observation = await f.authority();
    return { ...observation, body: `${observation.body}\n${pin.sha256}\n${pin.updatedAt}` };
  };
  f.focusedArgv(focused.split(" ").slice(1));
  return { ...f, brief, pin, compose: (loop = f.loop) => f.compose(loop, grantObservation) };
}

it.each([
  "body",
  "time",
  "unreadable",
  "routing",
  "refinement",
  "nested-key",
  "instant",
  "calendar",
  "digest",
])("ISS-232 rejects the %s brief-pin bypass before reservation", async (mode) => {
  const f = await pinnedVerificationFixture();
  if (mode === "body") f.brief.body += "\n";
  if (mode === "time") f.brief.updatedAt = "2026-10-06T02:14:03Z";
  if (mode === "routing") f.brief.routing.row = 3;
  if (mode === "refinement") f.brief.refined = false;
  if (mode === "unreadable")
    f.policy.verificationBrief = async () => {
      throw new Error("synthetic transport failure");
    };
  if (mode === "nested-key") Object.assign(f.pin, { unknown: true });
  if (mode === "instant") f.pin.updatedAt = "2026-10-06T02:14:02";
  if (mode === "calendar") f.pin.updatedAt = "2026-02-30T02:14:02Z";
  if (mode === "digest") f.pin.sha256 = "A".repeat(64);
  const before = await snapshot(resolve(f.loop.stateRoot, f.loop.run));
  await expect(f.compose()).rejects.toBeInstanceOf(QueueBlocked);
  expect(await snapshot(resolve(f.loop.stateRoot, f.loop.run))).toEqual(before);
  expect(f.launches).toEqual([]);
  expect(f.effects).toEqual([]);
});

it.skipIf(process.platform === "win32")(
  "ISS-232 carries the real adapter issue observation through admission to review launch",
  async () => {
    const f = await pinnedVerificationFixture();
    // Only GitHub transport and the product's imported reader implementations
    // are synthetic; use the shipped adapter, admission and prompt consumers.
    const scripts = resolve(f.repository, "scripts");
    await writeFile(
      resolve(scripts, "dispatch-window.mjs"),
      'export const derivePullWindow = () => [];\nexport const isRunnableRefined = (issue) => issue.state === "open" && issue.labels.some(x => x.name === "kind:slice") && issue.blockedBy.length === 0;\n',
    );
    await writeFile(
      resolve(scripts, "milestone-policy.mjs"),
      "export const isExecutableOutcome = () => true;\n",
    );
    await writeFile(
      resolve(scripts, "backlog-classify.mjs"),
      "export const classified = () => true;\n",
    );
    await f.git(f.repository, ["add", "."]);
    await f.git(f.repository, ["commit", "-m", "synthetic product readers"]);
    await f.git(f.remote, ["fetch", f.repository, "main:main"]);
    const tools = resolve(f.stateRoot, "tools");
    await mkdir(tools);
    const provider = resolve(tools, "issue.json");
    const calls = resolve(tools, "calls.jsonl");
    await writeFile(
      provider,
      JSON.stringify({
        data: {
          repository: {
            issue: {
              ...f.brief,
              labels: { pageInfo: { hasNextPage: false }, nodes: [{ name: "kind:slice" }] },
              blockedBy: { pageInfo: { hasNextPage: false }, nodes: [] },
            },
          },
        },
      }),
    );
    const gh = resolve(tools, "gh");
    await writeFile(
      gh,
      `#!${process.execPath}\nconst {appendFileSync,readFileSync,writeFileSync} = require('node:fs');\nappendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');\nwriteFileSync(process.stdout.fd,readFileSync(${JSON.stringify(provider)}));\n`,
    );
    await chmod(gh, 0o755);
    vi.stubEnv("PATH", `${tools}${delimiter}${process.env.PATH}`);
    f.policy.verificationBrief = chaseAdapter.verificationBrief;
    const q = await f.compose();
    const saved = JSON.parse(
      await readFile(resolve(f.grant.attemptDirectory, "verification-only.json"), "utf8"),
    );
    expect(saved.issue).toMatchObject({
      body: f.brief.body,
      updatedAt: f.pin.updatedAt,
      refined: true,
      routing: { row: 2, review: 11 },
    });
    expect(Number.isFinite(Date.parse(saved.issue.observedAt))).toBe(true);
    expect((await readFile(calls, "utf8")).trim().split("\n")).toHaveLength(1);
    expect(await readFile(calls, "utf8")).toContain("body updatedAt");
    await rm(provider);
    await queueStep(q, f.adapter(q));
    await queueStep(await f.compose(), f.adapter(q));
    expect(f.prompts).toHaveLength(1);
    expect(f.prompts[0]).toContain(f.brief.body);
    expect(f.prompts[0]).toContain(JSON.stringify(f.pin));
    expect((await readFile(calls, "utf8")).trim().split("\n")).toHaveLength(1);
  },
);

it.each([false, true])(
  "ISS-232 binds exact brief bytes through native launch and next-day replay (refresh: %s)",
  async (refresh) => {
    const f = await pinnedVerificationFixture();
    if (refresh) {
      await writeFile(resolve(f.repository, "later-main.ts"), "export const later = true;\n");
      await f.git(f.repository, ["add", "."]);
      await f.git(f.repository, ["commit", "-m", "synthetic later main"]);
      await f.git(f.remote, ["fetch", f.repository, "main:main"]);
    }
    const q = await f.compose();
    const saved = JSON.parse(
      await readFile(resolve(f.grant.attemptDirectory, "verification-only.json"), "utf8"),
    );
    expect(saved.issue).toEqual(f.brief);
    const oldPrompt = f.original.items[0]!.source.reviewer.prompt;
    const marker = `Selected issue ${f.selected.key} (#${f.selected.number}):\n\n`;
    expect(q.items[0]!.source.reviewer.prompt).toBe(
      oldPrompt.slice(0, oldPrompt.indexOf(marker) + marker.length) +
        f.brief.body +
        `\nOne verification-only DELTA against failed review ${f.grant.priorReviewId}. Retained records: ${resolve(f.grant.attemptDirectory, "source")}. Challenge all findings and every original acceptance criterion. Historical FAIL remains unchanged and no author or correction is authorized. Retained brief revision: ${JSON.stringify(f.pin)}; exact bytes and observation: ${resolve(f.grant.attemptDirectory, "verification-only.json")}.`,
    );
    const pinnedBody = f.brief.body;
    f.brief.body = "Next-day edited live body must never be read.";
    f.brief.updatedAt = "2026-10-07T02:14:02Z";
    expect((await queueStep(q, f.adapter(q))).status).toBe("observing-reviewer");
    const resumed = await f.compose();
    expect((await queueStep(resumed, f.adapter(resumed))).status).toBe("observing-reviewer");
    expect(f.prompts).toHaveLength(1);
    expect(f.prompts[0]).toContain(marker + pinnedBody + "\nOne verification-only DELTA");
    expect(f.prompts[0]).not.toContain("projection-wake-interest-graph");
    expect(f.prompts[0]).toContain(f.pin.sha256);
    expect(f.prompts[0]).toContain("Delivery main base:");
    const refreshRecord = JSON.parse(
      await readFile(resolve(q.items[0]!.source.stateDirectory, "native-refresh.json"), "utf8"),
    );
    const reviewConfig = JSON.parse(
      await readFile(resolve(refreshRecord.directory, "config.json"), "utf8"),
    );
    expect(reviewConfig.config.reviewer.prompt).toContain(marker + pinnedBody);
    expect(reviewConfig.config.reviewer.prompt).toContain(JSON.stringify(f.pin));
    expect(reviewConfig.fingerprint).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            config: reviewConfig.config,
            prompts: [reviewConfig.config.author.prompt, reviewConfig.config.reviewer.prompt],
          }),
        )
        .digest("hex"),
    );
    expect(reviewConfig.config.mainBase).toBe(refreshRecord.main);
    expect(refreshRecord.main === f.selected.base).toBe(!refresh);
    expect(f.policy.verificationBrief).toHaveBeenCalledTimes(1);
    expect(f.observeIssue).not.toHaveBeenCalled();
    f.finish();
    expect((await queueStep(q, f.adapter(q))).status).toBe("observing-hosted-checks");
    const terminal = JSON.parse(
      await readFile(resolve(refreshRecord.directory, "reviewer-terminal.json"), "utf8"),
    );
    expect(terminal.head).toBe(refreshRecord.head);
    expect(JSON.parse(terminal.summary)).toMatchObject({
      head: refreshRecord.head,
      verdict: "PASS",
    });
    f.hostedGreen();
    expect((await queueStep(q, f.adapter(q))).status).toBe("complete");
    expect((await queueStep(await f.compose(), f.adapter(await f.compose()))).status).toBe(
      "complete",
    );
    expect(f.effects).toEqual(["publish", "merge", "cleanup", "deployment"]);
    expect(f.launches).toEqual(["reviewer"]);
    for (const [path, bytes] of f.old) expect(await readFile(path, "utf8"), path).toBe(bytes);
    await expect(
      f.compose({
        ...f.loop,
        verificationOnly: {
          ...f.loop.verificationOnly!,
          briefRevision: { ...f.pin, sha256: "a".repeat(64) },
        },
      }),
    ).rejects.toMatchObject({ reason: "verification-only-mismatch" });
  },
);

it("ISS-232 preserves retained repair context outside the selected brief", async () => {
  const f = await pinnedVerificationFixture();
  const path = resolve(f.grant.attemptDirectory, "source/config.json");
  const record = JSON.parse(await readFile(path, "utf8"));
  const suffix =
    "\n\nContinue from rejected candidate " +
    f.grant.candidateHead +
    " after terminal repair-author FAIL. Synthetic retained trace context.\n";
  record.config.reviewer.prompt += suffix;
  record.fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        config: record.config,
        prompts: [record.config.author.prompt, record.config.reviewer.prompt],
      }),
    )
    .digest("hex");
  await writeFile(path, JSON.stringify(record));
  const before = await readFile(path, "utf8");
  const q = await f.compose();
  await queueStep(q, f.adapter(q));
  expect(f.prompts[0]).toContain(f.brief.body + suffix + "\nOne verification-only DELTA");
  expect(await readFile(path, "utf8")).toBe(before);
});

it("ISS-232 leaves unpinned saved prompt bytes and ISS-231 issue observation unchanged", async () => {
  const f = await verificationOnlyFixture();
  f.policy.verificationBrief = vi.fn(async () => {
    throw new Error("no optional fetch");
  });
  const q = await f.compose();
  const original = f.original.items[0]!.source.reviewer.prompt;
  expect(q.items[0]!.source.reviewer.prompt).toBe(
    `${original}\nOne verification-only DELTA against failed review ${f.grant.priorReviewId}. Retained records: ${resolve(f.grant.attemptDirectory, "source")}. Challenge all findings and every original acceptance criterion. Historical FAIL remains unchanged and no author or correction is authorized.`,
  );
  expect(f.observeIssue).toHaveBeenCalledTimes(1);
  expect(f.policy.verificationBrief).not.toHaveBeenCalled();
  await queueStep(q, f.adapter(q));
  expect(f.prompts[0]).toContain(q.items[0]!.source.reviewer.prompt);
  expect(f.prompts[0]!.split(CHASE_REVIEW_DELIVERY_BOUNDARY)).toHaveLength(2);
  await f.compose();
  expect(f.observeIssue).toHaveBeenCalledTimes(1);
});

it.each(["red", "wrong-head", "missing"])(
  "ISS-232 retains the post-PASS hosted %s refusal and zero merges",
  async (mode) => {
    const f = await pinnedVerificationFixture();
    const q = await f.compose();
    await queueStep(q, f.adapter(q));
    f.finish();
    await queueStep(q, f.adapter(q));
    f.delivery.checks = async (current) => ({
      head: mode === "wrong-head" ? "f".repeat(40) : current.candidateHead,
      checks:
        mode === "missing"
          ? []
          : [
              {
                name: "PR Required",
                bucket: mode === "red" ? "fail" : "pass",
                link: "https://github.com/chase-sets/chase-sets/actions/runs/9003/job/9004",
                actions: { run: 9003, attempt: 1, job: 9004, workflow: 9005 },
              },
            ],
    });
    f.delivery.failedCheckLog = vi.fn(
      async () => "Synthetic exact-head candidate assertion failed\n",
    );
    const reason =
      mode === "red"
        ? "verification-only-candidate-failed"
        : mode === "wrong-head"
          ? "hosted-head-drift"
          : "missing-or-duplicate-check:PR Required";
    await expect(queueStep(q, f.adapter(q))).rejects.toMatchObject({ reason });
    await expect(queueStep(await f.compose(), f.adapter(await f.compose()))).rejects.toMatchObject({
      reason,
    });
    expect(f.delivery.failedCheckLog).toHaveBeenCalledTimes(mode === "red" ? 1 : 0);
    if (mode === "red") {
      const refresh = JSON.parse(
        await readFile(resolve(q.items[0]!.source.stateDirectory, "native-refresh.json"), "utf8"),
      );
      const failureLog = await readFile(resolve(refresh.directory, "hosted-failure.log"), "utf8");
      expect(JSON.parse(failureLog.split("\n")[0]!)).toMatchObject({
        head: refresh.head,
        publication: { head: refresh.head },
        checks: [{ actions: { run: 9003, attempt: 1, job: 9004, workflow: 9005 } }],
      });
      expect(failureLog).toContain("Synthetic exact-head candidate assertion failed");
    }
    expect(f.effects).toEqual(["publish"]);
    expect(f.launches).toEqual(["reviewer"]);
  },
);

it.each(["old-review", "malformed", "blocking-review"])(
  "ISS-232 retains the brief pin on stopped %s replay without renewing review",
  async (mode) => {
    const f = await pinnedVerificationFixture();
    const q = await f.compose();
    await queueStep(q, f.adapter(q));
    if (mode === "blocking-review") f.finish(true);
    else
      f.native.observe = async (_role, current, attempt) => ({
        id: attempt.id,
        status: mode === "malformed" ? "malformed" : "passed",
        head: f.selected.base,
        summary: JSON.stringify({
          run: current.run,
          role: "reviewer",
          head: f.selected.base,
          verdict: "PASS",
          findings: [],
          g0: "Synthetic stale review; never current authority.",
        }),
      });
    await expect(queueStep(q, f.adapter(q))).rejects.toBeInstanceOf(QueueBlocked);
    const stopped = await snapshot(q.stateDirectory);
    f.brief.body = "Later live brief";
    await expect(queueStep(await f.compose(), f.adapter(q))).rejects.toBeInstanceOf(QueueBlocked);
    expect(await snapshot(q.stateDirectory)).toEqual(stopped);
    expect(f.launches).toEqual(["reviewer"]);
    expect(f.effects).toEqual([]);
    expect(f.policy.verificationBrief).toHaveBeenCalledTimes(1);
  },
);

it.each(["pass", "review-fail", "host-fail", "refresh", "conflict", "pending-note"])(
  "ISS-231 enters the completed-stop supervisor route once and retains attempt four: %s",
  async (mode) => {
    const f = await verificationOnlyFixture();
    const { verificationOnly: _grant, ...ordinary } = f.loop;
    expect(await nextCycle(ordinary, f.repository, f.supervisor, repositoryPolicy)).toBeUndefined();
    if (mode === "pending-note")
      await rm(resolve(f.loop.stateRoot, f.loop.run, "cycle-1-stop-1-complete.json"));
    const resumed = (await nextCycle(f.loop, f.repository, f.supervisor, repositoryPolicy))!;
    expect(resumed.selection).toEqual(f.cycle.selection);
    expect(
      await reconcilePendingStop(f.loop, resumed, f.supervisor, repositoryPolicy),
    ).toBeUndefined();
    if (["refresh", "conflict"].includes(mode)) {
      await writeFile(
        resolve(f.repository, mode === "conflict" ? "feature.ts" : "main.ts"),
        "export const main = true;\n",
      );
      await f.git(f.repository, ["add", "."]);
      await f.git(f.repository, ["commit", "-m", "synthetic later main"]);
      await f.git(f.remote, ["fetch", f.repository, "main:main"]);
    }
    const q = await f.compose();
    expect(q.items[0]!.implementationAttempt).toBe(4);
    expect(q.nativeLaunchCeiling).toBe(64);
    if (mode === "host-fail")
      vi.stubEnv("npm_execpath", resolve(f.stateRoot, "missing-native-pnpm.exe"));
    const adapter = f.adapter(q);
    if (["host-fail", "conflict"].includes(mode)) {
      const reason =
        mode === "host-fail"
          ? "gate-host-failed:verify:static:scoped"
          : "verification-only-refresh-conflict";
      await expect(queueStep(q, adapter)).rejects.toMatchObject({ reason });
      await expect(
        queueStep(await f.compose(), f.adapter(await f.compose())),
      ).rejects.toMatchObject({ reason });
      expect(f.launches).toEqual([]);
      await stopCycle(
        f.loop,
        { ...f.cycle, initialHistory: await adapter.history() },
        reason,
        4,
        f.supervisor,
        repositoryPolicy,
      );
      await expect(
        nextCycle(f.loop, f.repository, f.supervisor, repositoryPolicy),
      ).rejects.toMatchObject({ reason });
    } else {
      expect((await queueStep(q, adapter)).status).toBe("observing-reviewer");
      expect((await queueStep(await f.compose(), f.adapter(await f.compose()))).status).toBe(
        "observing-reviewer",
      );
      expect(f.launches).toEqual(["reviewer"]);
      f.finish(mode === "review-fail");
      if (mode === "review-fail") {
        await expect(queueStep(q, adapter)).rejects.toMatchObject({
          reason: "refresh-review-failed",
        });
        await expect(queueStep(q, adapter)).rejects.toMatchObject({
          reason: "refresh-review-failed",
        });
      } else {
        expect((await queueStep(q, adapter)).status).toBe("observing-hosted-checks");
        const current = JSON.parse(
          await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"),
        );
        expect(current).toMatchObject({
          candidateAttempt: 4,
          retries: 1,
          authorFailures: { count: 4 },
        });
        expect(current.head === f.grant.candidateHead).toBe(mode !== "refresh");
        f.hostedGreen();
        expect((await queueStep(q, adapter)).status).toBe("complete");
        expect((await queueStep(await f.compose(), f.adapter(await f.compose()))).status).toBe(
          "complete",
        );
        expect(f.effects).toEqual(["publish", "merge", "cleanup", "deployment"]);
        expect(await retainedPostMergeDelivery(f.loop, f.selected)).toBeDefined();
        expect(f.launches).toEqual(["reviewer"]);
        expect(f.effects).toEqual(["publish", "merge", "cleanup", "deployment"]);
      }
    }
    expect(f.captures()).toBe(1);
    await expect(
      nextCycle(ordinary, f.repository, f.supervisor, repositoryPolicy),
    ).rejects.toMatchObject({ reason: "verification-only-spent" });
    for (const [path, bytes] of f.old) expect(await readFile(path, "utf8"), path).toBe(bytes);
    await expect(
      f.compose({
        ...f.loop,
        verificationOnly: {
          ...f.grant,
          authorityUrl: f.grant.authorityUrl.replace("9001", "9002"),
        },
      }),
    ).rejects.toMatchObject({ reason: "verification-only-mismatch" });
  },
);

it.each([
  ["complete", "item-stop"],
  ["review-fail", "item-stop"],
  ["complete", "complete"],
  ["review-fail", "complete"],
])(
  "ISS-235 / ISS-231 carries the verification charge past later cycles above 64: %s then retained %s",
  async (outcome, laterOutcome) => {
    const f = await verificationOnlyFixture(3);
    const closed = new Set<number>();
    const host: SupervisionAdapter = {
      ...f.supervisor,
      async issue(config, number, purpose) {
        return {
          ...(await f.supervisor.issue(config, number, purpose)),
          key: `cs-${number}`,
          state: closed.has(number) ? "CLOSED" : "OPEN",
        };
      },
      async close(_config, number) {
        closed.add(number);
      },
    };
    for (const cycle of [1, 2]) {
      const earlier = {
        selection: { cycle, key: `cs-${358 + cycle}`, number: 358 + cycle, base: f.selected.base },
        initialHistory: [],
      };
      await persistCycle(f.loop, earlier);
      await completeCycle(f.loop, earlier, [], host);
    }
    const retainedHistory = [
      ...f.cycle.initialHistory,
      ...Array.from({ length: 70 }, (_, index) => ({
        ...participant(
          index + 9,
          `cs-${362 + Math.floor(index / 12)}:${Math.floor((index % 12) / 4) + 1}`,
          index % 4 < 2 ? "source" : "repair",
          index % 2 ? "reviewer" : "author",
          index % 2 ? "failed" : "passed",
        ),
        placement: index % 2 ? f.loop.reviewer! : f.loop.author!,
      })),
    ];
    const later = {
      selection: { cycle: 4, key: "cs-362", number: 362, base: f.selected.base },
      initialHistory: retainedHistory,
    };
    await persistCycle(f.loop, later);
    if (laterOutcome === "item-stop")
      expect(
        await stopCycle(
          f.loop,
          later,
          "implementation-attempt-ceiling-exhausted",
          4,
          host,
          repositoryPolicy,
        ),
      ).toBe("item");
    else await completeCycle(f.loop, later, retainedHistory, host);
    const before = await snapshot(resolve(f.loop.stateRoot, f.loop.run));

    const resumed = (await nextCycle(f.loop, f.repository, host, repositoryPolicy))!;
    expect(resumed.selection).toEqual(f.cycle.selection);
    const q = await f.compose();
    expect(q.initialHistory).toEqual(retainedHistory);
    const adapter = f.adapter(q);
    expect((await queueStep(q, adapter)).status).toBe("observing-reviewer");
    expect((await queueStep(await f.compose(), f.adapter(await f.compose()))).status).toBe(
      "observing-reviewer",
    );
    f.finish(outcome === "review-fail");
    if (outcome === "review-fail") {
      await expect(queueStep(q, adapter)).rejects.toMatchObject({
        reason: "refresh-review-failed",
      });
      expect(
        await stopCycle(
          f.loop,
          { ...resumed, initialHistory: await adapter.history() },
          "refresh-review-failed",
          4,
          host,
          repositoryPolicy,
        ),
      ).toBe("item");
    } else {
      f.hostedGreen();
      expect((await queueStep(q, adapter)).status).toBe("complete");
      await completeCycle(f.loop, resumed, await adapter.history(), host);
    }
    const charged = await adapter.history();
    expect(charged).toHaveLength(79);
    expect(charged.slice(0, 78)).toEqual(retainedHistory);
    expect(charged[78]).toMatchObject({ ordinal: 79, role: "reviewer", item: "cs-361:4" });

    const policy: RepositoryAdapter = {
      ...repositoryPolicy,
      selectCandidates: () => [{ key: "cs-363", number: 363 }],
      issueContext: () => ({
        title: "Synthetic successor",
        body: "Unrelated work after verification.",
        rules: "Preserve every charged launch.",
        acceptanceCriteria: ["Keep the next launch ordinal."],
        routing: { row: 2, review: 11 },
      }),
    };
    for (let replay = 0; replay < 2; replay++) {
      const next = (await nextCycle(f.loop, f.repository, host, policy))!;
      expect(next.selection).toMatchObject({ cycle: 5, key: "cs-363" });
      expect(next.initialHistory).toEqual(charged);
    }
    const next = (await nextCycle(f.loop, f.repository, host, policy))!;
    await persistCycle(f.loop, next);
    const { cycle: _cycle, ...selection } = next.selection;
    const successor = await queueConfigFromLoop(
      f.loop,
      f.repository,
      selection,
      policy,
      next.initialHistory,
    );
    let successorRunning = true;
    const worker: Adapter = {
      ...f.native,
      async launch(role, current) {
        expect(role).toBe("author");
        return {
          id: randomUUID(),
          pid: 4,
          trace: resolve(current.stateDirectory, "author.jsonl"),
          launchedAt: 1,
        };
      },
      async observe(role, current, attempt) {
        return successorRunning
          ? { id: attempt.id, status: "running" }
          : {
              id: attempt.id,
              status: "failed",
              head: current.base,
              summary: JSON.stringify({
                run: current.run,
                role,
                head: current.base,
                verdict: "FAIL",
                summary: "Synthetic successor terminal to record its launch charge.",
              }),
            };
      },
    };
    const successorAdapter = f.adapter(successor, worker);
    expect((await queueStep(successor, successorAdapter)).status).toBe("observing-author");
    successorRunning = false;
    await expect(queueStep(successor, successorAdapter)).rejects.toMatchObject({
      reason: "author-failed",
    });
    const successorHistory = await successorAdapter.history();
    expect(successorHistory.slice(0, 79)).toEqual(charged);
    expect(successorHistory).toHaveLength(80);
    expect(successorHistory[79]).toMatchObject({ ordinal: 80, role: "author", item: "cs-363:1" });
    expect(f.launches).toEqual(["reviewer"]);
    expect(f.captures()).toBe(1);
    for (const [path, bytes] of before) expect(await readFile(path, "utf8"), path).toBe(bytes);
  },
);

it.each(["current-main-unavailable", "deploy-not-verified"])(
  "ISS-231 retains a post-reservation supervisor stop before queue setup: %s",
  async (stoppedReason) => {
    const f = await verificationOnlyFixture();
    const q = await f.compose();
    const reason =
      stoppedReason === "deploy-not-verified"
        ? "verification-only-execution-unknown"
        : stoppedReason;
    expect(await stopCycle(f.loop, f.cycle, stoppedReason, 4, f.supervisor, repositoryPolicy)).toBe(
      "run",
    );
    await expect(
      nextCycle(f.loop, f.repository, f.supervisor, repositoryPolicy),
    ).rejects.toMatchObject({ reason });
    await expect(queueStep(q, f.adapter(q))).rejects.toMatchObject({ reason });
    expect(f.launches).toEqual([]);
    expect(f.captures()).toBe(1);
  },
);

it.each(["source", "refresh"])(
  "ISS-231 delivers a pre-review %s correction and resumes its retained post-merge records",
  async (mode) => {
    const f = await verificationOnlyFixture();
    const q = f.original;
    const item = q.items[0]!;
    await writeFile(
      f.launcher,
      `import {existsSync,readFileSync} from 'node:fs'; if (process.argv[3] === 'typecheck' && existsSync('feature.ts') && readFileSync('feature.ts','utf8').includes('wrongType') && (${mode === "source"} || existsSync('main-feature.ts'))) { console.log('feature.ts(1,1): error TS2322: Synthetic candidate defect.'); process.exit(1); } console.log('[VERIFY_STATIC_RUN] check:structure');`,
    );
    const launches: string[] = [];
    const native: Adapter = {
      ...f.native,
      async launch(role, current, prompt) {
        launches.push(role);
        if (role === "author")
          await writeFile(
            resolve(current.worktree, "feature.ts"),
            current.stateDirectory === item.source.stateDirectory
              ? "export const wrongType = true;\n"
              : "export const corrected = true;\n",
          );
        else {
          if (current.stateDirectory !== item.source.stateDirectory)
            expect(prompt).toContain(
              mode === "source"
                ? "No predecessor reviewer or PASS exists"
                : "No predecessor PASS is assumed",
            );
          expect(prompt).toContain("candidate-terminal.json");
        }
        const trace = resolve(current.stateDirectory, `${role}.jsonl`);
        await writeFile(trace, "Synthetic correction lifecycle evidence\n");
        return { id: randomUUID(), pid: 3, trace, launchedAt: 1 };
      },
      async observe(role, current, attempt) {
        const head =
          role === "author" ? current.base : await f.git(current.worktree, ["rev-parse", "HEAD"]);
        if (
          role === "reviewer" &&
          current.stateDirectory === item.source.stateDirectory &&
          mode === "refresh"
        ) {
          const writer = resolve(f.stateRoot, "main-writer");
          await f.git(f.repository, ["worktree", "add", "--detach", writer, f.selected.base]);
          await writeFile(resolve(writer, "main-feature.ts"), "export const mainFeature = true;\n");
          await f.git(writer, ["add", "."]);
          await f.git(writer, ["commit", "-m", "synthetic integration gate trigger"]);
          await f.git(f.remote, ["fetch", writer, "HEAD:main"]);
        }
        return {
          id: attempt.id,
          status: "passed",
          head,
          summary: JSON.stringify(
            role === "author"
              ? { run: current.run, role, head, verdict: "PASS", summary: "" }
              : {
                  run: current.run,
                  role,
                  head,
                  verdict: "PASS",
                  findings: [],
                  g0: "Synthetic corrected full review.",
                },
          ),
        };
      },
    };
    const adapter = f.adapter(q, native);
    expect((await queueStep(q, adapter)).status).toBe("observing-hosted-checks");
    expect(launches).toEqual(
      mode === "source"
        ? ["author", "author", "reviewer"]
        : ["author", "reviewer", "author", "reviewer"],
    );
    f.hostedGreen();
    expect((await queueStep(q, adapter)).status).toBe("complete");
    await f.git(f.repository, ["worktree", "remove", "--force", item.source.worktree]);
    await f.git(f.repository, ["worktree", "remove", "--force", item.source.reviewWorktree]);
    // macOS exposes its temporary root through /var -> /private/var. Composition
    // resolves that alias; post-merge replay must read the same retained identity.
    const alias = resolve(f.stateRoot, "..", "state-alias");
    await symlink(await realpath(f.stateRoot), alias, "junction");
    const retainedBytes = await snapshot(q.stateDirectory);
    const retained = await retainedPostMergeDelivery(f.loop, f.selected);
    expect(retained).toBeDefined();
    expect(await retainedPostMergeDelivery({ ...f.loop, stateRoot: alias }, f.selected)).toEqual(
      retained,
    );
    expect(await snapshot(q.stateDirectory)).toEqual(retainedBytes);
    expect((await queueStep(q, f.adapter(q, native))).status).toBe("complete");
    expect(launches).toEqual(
      mode === "source"
        ? ["author", "author", "reviewer"]
        : ["author", "reviewer", "author", "reviewer"],
    );
    expect(f.effects).toEqual(["publish", "merge", "cleanup", "deployment"]);
  },
);

it("ISS-231 attributes native candidate failure without authoring or review", async () => {
  const f = await verificationOnlyFixture();
  await writeFile(
    f.launcher,
    `import {existsSync} from 'node:fs'; if (process.argv[3] === 'typecheck' && existsSync('feature.ts')) { console.log('feature.ts(1,1): error TS2322: Synthetic candidate defect.'); process.exit(1); } console.log('[VERIFY_STATIC_RUN] check:structure');`,
  );
  const q = await f.compose();
  const adapter = f.adapter(q);
  await expect(queueStep(q, adapter)).rejects.toMatchObject({
    reason: "verification-only-candidate-failed",
  });
  await expect(queueStep(await f.compose(), f.adapter(await f.compose()))).rejects.toMatchObject({
    reason: "verification-only-candidate-failed",
  });
  expect(f.launches).toEqual([]);
  expect(f.effects).toEqual([]);
  expect(await currentCandidateAttempt(q)).toBe(4);
});

it.each(["unavailable", "author", "body"])(
  "ISS-231 refuses %s authority before reservation",
  async (mode) => {
    const f = await verificationOnlyFixture();
    await expect(
      f.compose(f.loop, async () => {
        if (mode === "unavailable") throw new Error("synthetic provider unavailable");
        const observation = await f.authority();
        return mode === "author"
          ? { ...observation, author: "synthetic-other-user" }
          : { ...observation, body: "Synthetic unrelated ruling" };
      }),
    ).rejects.toMatchObject({
      reason:
        mode === "unavailable"
          ? "verification-only-authority-unavailable"
          : "verification-only-mismatch",
    });
    await expect(
      readFile(resolve(f.grant.attemptDirectory, "verification-only.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.launches).toEqual([]);
  },
);

it("ISS-231 refuses single-identity changes before any reservation", async () => {
  const f = await verificationOnlyFixture();
  expect(() => validateLoopConfig(f.loop)).not.toThrow();
  expect((await verificationStop(f.loop, f.cycle.selection))?.prior.head).toBe(
    f.grant.candidateHead,
  );
  for (const field of [
    "run",
    "issueKey",
    "attemptDirectory",
    "candidateHead",
    "priorReviewId",
    "authorityUrl",
  ] as const) {
    const grant = {
      ...f.grant,
      [field]: field === "candidateHead" ? "f".repeat(40) : f.grant[field] + "x",
    };
    await expect(f.compose({ ...f.loop, verificationOnly: grant })).rejects.toBeInstanceOf(
      QueueBlocked,
    );
    await expect(
      readFile(resolve(f.grant.attemptDirectory, "verification-only.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
  await expect(
    f.compose({
      ...f.loop,
      verificationOnly: { ...f.grant, authorityUrl: f.grant.authorityUrl.replace("9001", "9002") },
    }),
  ).rejects.toMatchObject({ reason: "verification-only-mismatch" });
  const original = JSON.parse(
    await readFile(resolve(f.grant.attemptDirectory, "source/config.json"), "utf8"),
  ).config;
  const feature = resolve(original.worktree, "feature.ts");
  const bytes = await readFile(feature, "utf8");
  await writeFile(feature, "export const feature = false;\n");
  await expect(f.compose()).rejects.toMatchObject({ reason: "verification-only-mismatch" });
  await writeFile(feature, bytes);
  await f.git(original.worktree, [
    "commit",
    "--allow-empty",
    "-m",
    "synthetic wrong-head same-tree",
  ]);
  await expect(f.compose()).rejects.toMatchObject({ reason: "verification-only-mismatch" });
  await expect(
    readFile(resolve(f.grant.attemptDirectory, "verification-only.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const path = resolve(f.loop.stateRoot, f.loop.run, "cycle-1-stop-1.json");
  const stop = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...stop, reason: "author-failed" }));
  await expect(verificationStop(f.loop, f.cycle.selection)).rejects.toMatchObject({
    reason: "verification-only-mismatch",
  });
  expect(f.launches).toEqual([]);
});

it.each(["red", "unknown", "missing-log"])(
  "ISS-231 spends the continuation on hosted %s without another author",
  async (outcome) => {
    const f = await verificationOnlyFixture();
    const q = await f.compose();
    const adapter = f.adapter(q);
    expect((await queueStep(q, adapter)).status).toBe("observing-reviewer");
    f.finish();
    expect((await queueStep(q, adapter)).status).toBe("observing-hosted-checks");
    f.delivery.checks = async (current) => {
      if (outcome === "unknown") throw new DeliveryBlocked("hosted-observation-unavailable");
      return {
        head: current.candidateHead,
        checks: [
          {
            name: "PR Required",
            bucket: "fail",
            link: "https://github.com/chase-sets/chase-sets/actions/runs/9003/job/9004",
          },
        ],
      };
    };
    f.delivery.failedCheckLog = async () => {
      if (outcome === "missing-log")
        throw new DeliveryBlocked("hosted-check-log-unavailable:PR Required");
      return "Synthetic executed candidate assertion failed\n";
    };
    const reason =
      outcome === "red"
        ? "verification-only-candidate-failed"
        : outcome === "missing-log"
          ? "verification-only-execution-unknown"
          : "hosted-observation-unavailable";
    await expect(queueStep(q, adapter)).rejects.toMatchObject({ reason });
    await expect(queueStep(await f.compose(), f.adapter(await f.compose()))).rejects.toMatchObject({
      reason,
    });
    expect(f.launches).toEqual(["reviewer"]);
    expect(f.effects).toEqual(["publish"]);
    expect(await currentCandidateAttempt(q)).toBe(4);
  },
);

it.each([
  "green",
  "correction",
  "typecheck",
  "second-failure",
  "base",
  "unknown",
  "retry",
  "repair",
  "missing-focused",
  "missing-focused-retry",
])(
  "ISS-231 runs native gates before reviewer intent, including first-review correction: %s",
  async (mode) => {
    const missingFocused = mode.startsWith("missing-focused");
    const focusedCriterion =
      "Execute pnpm exec vitest run test/focused.test.ts and retain its passing result.";
    const f = await loopFixture(false, missingFocused ? `- ${focusedCriterion}` : undefined);
    f.loop.repository = "chase-sets/chase-sets";
    const git = async (tree: string, args: string[]) =>
      (await execute(f.gitExecutable, ["-C", tree, ...args])).stdout.trim();
    await writeFile(
      resolve(f.repository, "package.json"),
      JSON.stringify({
        scripts: { "verify:static:scoped": "node gate.mjs", typecheck: "node gate.mjs" },
        ...(missingFocused ? { devDependencies: { vitest: "4.1.10" } } : {}),
      }),
    );
    if (missingFocused) {
      await mkdir(resolve(f.repository, "test"));
      await writeFile(
        resolve(f.repository, "test/focused.test.ts"),
        'import { it, expect } from "vitest";\nit("synthetic focus", () => expect(1 + 1).toBe(2));\n',
      );
    }
    await writeFile(resolve(f.repository, "pnpm-lock.yaml"), "synthetic lock\n");
    await git(f.repository, ["add", "."]);
    await git(f.repository, ["commit", "-m", "synthetic gate toolchain"]);
    f.selected.base = await git(f.repository, ["rev-parse", "HEAD"]);
    await git(f.repository, [
      "remote",
      "add",
      "origin",
      "https://github.com/chase-sets/chase-sets.git",
    ]);
    await mkdir(f.stateRoot, { recursive: true });
    const launcher = resolve(f.stateRoot, "native-pnpm.mjs");
    const calls = resolve(f.stateRoot, "gate-calls.txt");
    const structure = `[VERIFY_STATIC_RUN] check:structure\n$ node ./scripts/check-structure.mjs && node ./scripts/check-structure/brand-foil-proof.mjs\nBrand foil: {"tracked":2,"scanned":2,"bytes":40,"readFailures":0,"nul":0,"literal":0,"raw":0,"constructor":0,"token":0,"union":0,"allowed":0,"violations":0,"roles":{}}; allowed + violations = union: 0 + 0 = 0\nStructure check failed:\n\n- synthetic.ts: synthetic deployable relative import (./context.json)\n\nSee docs/architecture/bounded-context-structure.md#rules-the-structure-gate-enforces for the enforced rules and fixes.\n[ELIFECYCLE] Command failed with exit code 1.\n[ELIFECYCLE] Command failed with exit code 1.\n`;
    await writeFile(
      launcher,
      `import {appendFileSync,existsSync,readFileSync} from 'node:fs';
      if (process.argv[2] === 'install') process.exit(0);
      appendFileSync(${JSON.stringify(calls)}, process.cwd() + ':' + process.argv[3] + '\\n');
      if (process.argv[3] === 'verify:static:scoped' && process.env.CHANGED_FILES_JSON !== '["synthetic.ts"]') throw new Error('ambient scope was not pinned');
      const broken = existsSync('synthetic.ts') && readFileSync('synthetic.ts','utf8').includes('bounded-contexts/');
      if (process.argv[3] === 'typecheck' && existsSync('synthetic.ts') && readFileSync('synthetic.ts','utf8').includes('wrongType')) { console.log('synthetic.ts(1,1): error TS2322: Synthetic wrong type.'); process.exit(1); }
      if (process.argv[3] === 'verify:static:scoped' && (broken || ${mode === "base"})) {
        console.log(${JSON.stringify(structure)});
        if (${mode === "unknown"}) console.log('unaccounted second failure');
        process.exit(1);
      }
      console.log('[VERIFY_STATIC_RUN] check:structure');
    `,
    );
    vi.stubEnv("npm_execpath", launcher);
    vi.stubEnv("CHANGED_FILES_JSON", '["ambient-unrelated.ts"]');
    const q = await queueConfigFromLoop(f.loop, f.repository, f.selected, {
      ...repositoryPolicy,
      localGates: () => ["verify:static:scoped", "typecheck"],
    });
    const item = q.items[0]!;
    const launches: string[] = [];
    const prompts: string[] = [];
    let malformed = mode === "retry" || mode === "missing-focused-retry";
    let reviewing = missingFocused;
    const missingFinding = {
      file: "synthetic.ts",
      line: 1,
      severity: "blocking",
      text: "Synthetic NC3 case: the required focused-test result is missing. Successful native gates do not supply it (ISS-139).",
    };
    const native: Adapter = {
      async preflight() {},
      git,
      async launch(role, current, prompt) {
        const correction = current.stateDirectory !== item.source.stateDirectory;
        launches.push(
          `${correction ? (current.stateDirectory === item.repair.stateDirectory ? "repair-" : "correction-") : ""}${role}`,
        );
        if (role === "author")
          await writeFile(
            resolve(current.worktree, "synthetic.ts"),
            (!correction && ["correction", "base", "unknown"].includes(mode)) ||
              mode === "second-failure"
              ? `import '../../../bounded-contexts/orders/api';\n${correction ? "// Synthetic ineffective correction.\n" : ""}`
              : !correction && mode === "typecheck"
                ? "export const wrongType = true;\n"
                : correction && mode === "repair"
                  ? "export const feature = 2;\n"
                  : "export const feature = true;\n",
          );
        else {
          prompts.push(prompt);
          expect(prompt.split(CHASE_REVIEW_DELIVERY_BOUNDARY)).toHaveLength(2);
          const head = await git(current.worktree, ["rev-parse", "HEAD"]);
          for (const gate of current.localGates!) {
            const directory = resolve(
              current.stateDirectory,
              `gate-${createHash("sha256").update(gate).digest("hex")}`,
            );
            const terminal = JSON.parse(
              await readFile(resolve(directory, "candidate-terminal.json"), "utf8"),
            );
            expect(terminal).toMatchObject({
              head,
              code: 0,
              signal: null,
              command: {
                cwd: current.worktree,
                executable: process.execPath,
                argv: [launcher, "run", gate],
              },
            });
            expect(prompt).toContain(JSON.stringify(resolve(directory, "candidate.log")));
            expect(prompt).toContain(JSON.stringify(resolve(directory, "candidate-terminal.json")));
          }
        }
        const trace = resolve(current.stateDirectory, `${role}-${launches.length}.jsonl`);
        await writeFile(trace, "synthetic worker trace\n");
        return { id: randomUUID(), pid: 1, trace, launchedAt: 1 };
      },
      async observe(role, current, attempt) {
        const head =
          role === "author" ? current.base : await git(current.worktree, ["rev-parse", "HEAD"]);
        if (role === "reviewer" && reviewing) return { id: attempt.id, status: "running" };
        if (role === "reviewer" && malformed) {
          malformed = false;
          return { id: attempt.id, status: "malformed", summary: "synthetic truncated reply" };
        }
        const reject =
          role === "reviewer" &&
          (mode === "repair" || missingFocused) &&
          current.stateDirectory === item.source.stateDirectory;
        return {
          id: attempt.id,
          head,
          status: reject ? "failed" : "passed",
          ...(role === "reviewer"
            ? {
                summary: JSON.stringify({
                  run: current.run,
                  role,
                  head,
                  verdict: reject ? "FAIL" : "PASS",
                  findings: reject
                    ? missingFocused
                      ? [missingFinding]
                      : [
                          {
                            file: "synthetic.ts",
                            line: 1,
                            severity: "blocking",
                            text: "Synthetic semantic correction requested.",
                          },
                        ]
                    : [],
                  g0: "Synthetic independent reviewer after real native gate execution.",
                }),
              }
            : {}),
        };
      },
      async checks() {
        throw new Error("no source publication");
      },
    };
    const delivery = githubDeliveryAdapter(undefined, f.gitExecutable);
    const publish = vi.spyOn(delivery, "publish");
    const merge = vi.spyOn(delivery, "merge");
    const runGate = delivery.runGate;
    delivery.runGate = async (...args) => {
      if (
        !(await readFile(resolve(args[0].stateDirectory, "reviewer-attempt.json"), "utf8").catch(
          () => "",
        ))
      )
        await expect(
          readFile(resolve(args[0].stateDirectory, "reviewer-intent.json")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      return runGate(...args);
    };
    const adapter = repositoryQueueAdapter(q, f.repository, {
      native,
      delivery,
      gitExecutable: f.gitExecutable,
      setup: gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, tree) {
          await mkdir(resolve(tree, "node_modules"));
          await writeFile(resolve(tree, "node_modules/.modules.yaml"), "synthetic\n");
          return "succeeded";
        },
      }),
    });
    adapter.delivery = async (_item, accepted) => ({
      status: "observing-hosted-checks",
      head: accepted.head,
      reviewId: accepted.reviewId,
      retries: accepted.retries ?? 0,
    });
    if (missingFocused) {
      // ISS-232 NC3: actual queue composition, native gate execution and flow.
      // The scripted FAIL is explicitly synthetic, never semantic review authority.
      expect((await queueStep(q, adapter)).status).toBe("observing-reviewer");
      expect((await queueStep(q, adapter)).status).toBe("observing-reviewer");
      expect(prompts).toHaveLength(1);
      reviewing = false;
      if (mode === "missing-focused")
        await expect(
          sourceStep(item.source, native, item.setup.pilotWorktree),
        ).rejects.toMatchObject({
          reason: "reviewer-failed",
        });
      const result = await adapter.source(item);
      expect(result).toMatchObject({ status: "fixable-review", findings: [missingFinding] });
      expect(prompts).toHaveLength(mode === "missing-focused-retry" ? 2 : 1);
      for (const prompt of prompts) {
        expect(prompt).toContain(focusedCriterion);
        expect(prompt).toContain("missing or inadequate test results remain findings");
        expect(prompt).toContain("ISS-139");
        expect(prompt.split(CHASE_REVIEW_DELIVERY_BOUNDARY)).toHaveLength(2);
      }
      const terminal = JSON.parse(
        await readFile(resolve(item.source.stateDirectory, "reviewer-terminal.json"), "utf8"),
      );
      const head = await git(item.source.worktree, ["rev-parse", "HEAD"]);
      expect(terminal).toMatchObject({ status: "failed", head });
      expect(JSON.parse(terminal.summary)).toMatchObject({
        head,
        verdict: "FAIL",
        findings: [missingFinding],
      });
      // Test the flow barrier itself as well as its queue consumer. A bypass
      // must not be hidden by the queue's additional exact-PASS checks.
      await expect(sourceStep(item.source, native, item.setup.pilotWorktree)).rejects.toMatchObject(
        {
          reason: "reviewer-failed",
          diagnostics: terminal.summary,
        },
      );
      expect((await readFile(calls, "utf8")).trim().split("\n")).toHaveLength(2);
      expect(publish).not.toHaveBeenCalled();
      expect(merge).not.toHaveBeenCalled();
      await expect(
        readFile(resolve(item.source.stateDirectory, "publication.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const evidence = process.env.ISS232_EVIDENCE_DIRECTORY;
      if (evidence) {
        // Optional author evidence capture retains this disposable fixture so
        // every absolute artifact path in the effective prompt remains readable.
        const root = resolve(f.repository, "..");
        roots.splice(roots.indexOf(root), 1);
        await mkdir(evidence, { recursive: true });
        await writeFile(
          resolve(evidence, `${mode}.json`),
          JSON.stringify(
            {
              fixture: "ISS-232 NC3 synthetic missing focused-test result",
              root,
              source: item.source,
              prompts,
              result,
              terminal,
              gateCalls: calls,
              publicationCalls: publish.mock.calls.length,
              mergeCalls: merge.mock.calls.length,
              semanticJudgment:
                "Reserved for the ordinary independent implementation reviewer; this fixture verdict is synthetic.",
            },
            null,
            2,
          ),
        );
      }
      return;
    }
    if (["base", "unknown", "second-failure"].includes(mode)) {
      await expect(queueStep(q, adapter)).rejects.toMatchObject({
        reason:
          mode === "second-failure"
            ? "gate-correction-exhausted:verify:static:scoped"
            : mode === "base"
              ? "gate-base-failed:verify:static:scoped"
              : "gate-attribution-unknown:verify:static:scoped",
      });
      expect(launches).toEqual(
        mode === "second-failure" ? ["author", "correction-author"] : ["author"],
      );
      await expect(
        readFile(resolve(item.source.stateDirectory, "reviewer-intent.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect((await queueStep(q, adapter)).status).toBe("observing-hosted-checks");
      expect(launches).toEqual(
        mode === "repair"
          ? ["author", "reviewer", "repair-author", "repair-reviewer"]
          : ["correction", "typecheck"].includes(mode)
            ? ["author", "correction-author", "correction-reviewer"]
            : mode === "retry"
              ? ["author", "reviewer", "reviewer"]
              : ["author", "reviewer"],
      );
      const count = (await readFile(calls, "utf8")).split("\n").length;
      await queueStep(q, adapter);
      expect((await readFile(calls, "utf8")).split("\n").length).toBe(count);
      expect(prompts[0]).toContain("never a review verdict");
      if (["correction", "typecheck"].includes(mode)) {
        await expect(
          readFile(resolve(item.source.stateDirectory, "reviewer-attempt.json")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(prompts[0]).toContain("No predecessor reviewer or PASS exists");
      }
    }
    expect(
      JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"))
        .candidateAttempt,
    ).toBe(mode === "repair" ? 2 : 1);
  },
);
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

function budgetHistory(count: number, item: (index: number) => string): QueueParticipant[] {
  return Array.from({ length: count }, (_, index) => ({
    ...participant(
      index + 1,
      item(index),
      ["source", "repair", "refresh"][index % 3] as QueueParticipant["stage"],
      index % 2 ? "reviewer" : "author",
      ["passed", "failed", "malformed", "dead", "unknown"][
        index % 5
      ] as QueueParticipant["outcome"],
    ),
    id: `budget-worker-${index + 1}`,
  }));
}

const budgetPolicy: RepositoryAdapter = {
  ...repositoryPolicy,
  issueContext: (input) => repositoryPolicy.issueContext({ ...input, key: "ISS-104" }),
};

it("ISS-235 retains distinct opaque repository identities and exact keys in a bounded queue", async () => {
  const f = await fixture(2);
  f.config.nativeLaunchCeiling = 64;
  f.config.initialHistory = budgetHistory(64, (i) => `repo-one:ISS-234:${1 + (i % 4)}`);
  f.items[0]!.id = "repo-two:ISS-234:1";
  f.items[1]!.id = "repo-one:ISS-2340:1";
  f.items[0]!.source.repository = f.items[0]!.setup.repository = "fixture/other-repository";
  const history = [...f.config.initialHistory];
  const calls: string[] = [];
  const adapter: QueueAdapter = {
    async assertExecutor() {},
    async history() {
      return history;
    },
    async setup() {
      return { status: "ready" };
    },
    async source(item) {
      calls.push(item.id);
      history.push(
        participant(history.length + 1, item.id, "source", "author", "passed"),
        participant(history.length + 2, item.id, "source", "reviewer", "passed"),
      );
      return {
        status: "accepted",
        head: item.base,
        reviewId: history.at(-1)!.id,
        stateDirectory: item.source.stateDirectory,
      };
    },
    async repair() {
      throw new Error("repair not expected");
    },
    async delivery(item, accepted) {
      return deliveryCompletion(item, accepted.head, accepted.reviewId);
    },
  };
  for (let restart = 0; restart < 2; restart++)
    await expect(queueStep(f.config, adapter)).resolves.toMatchObject({
      status: "complete",
      participants: 68,
    });
  expect(calls).toEqual(f.items.map((item) => item.id));
  expect(() => validateHistory(history, 64)).not.toThrow();
  // A suffix change alone keeps the same canonical issue and exhausts its cap.
  const extra = {
    ...participant(69, "repo-one:ISS-234:4", "refresh", "reviewer", "unknown"),
    id: "extra-charge",
  };
  expect(() => validateHistory([...history, extra], 64)).toThrow("native-launch-ceiling-exhausted");
});

it("ISS-235 reads every ordinal, retaining legacy usage and rejecting gaps, duplicates and malformed records above 64", async () => {
  const f = await fixture();
  f.config.nativeLaunchCeiling = 64;
  const history = budgetHistory(130, (i) => `ISS-${Math.floor(i / 50)}:${1 + (i % 4)}`);
  for (const p of history)
    await writeFile(
      resolve(f.stateDirectory, `participant-${p.ordinal}-terminal.json`),
      JSON.stringify(p),
    );
  expect(await readQueueHistory(f.config)).toEqual(history);
  expect(await readQueueHistory(f.config)).toEqual(history);
  const path = resolve(f.stateDirectory, "participant-65-terminal.json");
  const original = await readFile(path, "utf8");
  await writeFile(path, JSON.stringify({ ...history[64], usage: undefined }));
  expect((await readQueueHistory(f.config))[64]!.usage).toEqual({
    inputTokens: { status: "unavailable" },
    outputTokens: { status: "unavailable" },
    costUsd: { status: "unavailable" },
  });
  await writeFile(path, JSON.stringify({ ...history[64], outcome: "invented" }));
  await expect(readQueueHistory(f.config)).rejects.toThrow("malformed-participant-history");
  await writeFile(path, JSON.stringify({ ...history[64], id: history[0]!.id }));
  await expect(readQueueHistory(f.config)).rejects.toThrow("reused-participant-identity");
  await rm(path);
  await expect(readQueueHistory(f.config)).rejects.toThrow("participant-history-gap");
  await writeFile(path, original);
  expect(await readQueueHistory(f.config)).toEqual(history);
});

it.each([
  ["ISS-234:1", false],
  ["ISS-234:4", false],
  ["ISS-234:4", true],
] as const)(
  "ISS-235 refuses own launch 65 across attempts and stages for %s (counter removed: %s)",
  async (id, bypass) => {
    const f = await loopFixture(bypass);
    let factory = repositoryQueueAdapter;
    if (bypass) {
      const path = resolve(f.repository, "scripts/dogfood/queue.ts");
      const original = await readFile(path, "utf8");
      const mutated = original.replace(
        "return history.filter((participant) => issues.has(participantIssue(participant.item))).length;",
        "return 0;",
      );
      expect(mutated).not.toBe(original);
      await writeFile(path, mutated);
      await execute(f.gitExecutable, ["-C", f.repository, "add", "."]);
      await execute(f.gitExecutable, [
        "-C",
        f.repository,
        "commit",
        "-m",
        "Synthetic counter removal",
      ]);
      factory = (await import(/* @vite-ignore */ pathToFileURL(path).href)).repositoryQueueAdapter;
    }
    f.loop.nativeLaunchCeiling = 64;
    const history = budgetHistory(64, (i) => `ISS-234:${1 + (i % 4)}`);
    const q = await queueConfigFromLoop(
      f.loop,
      f.repository,
      { ...f.selected, key: "ISS-234" },
      budgetPolicy,
      history,
    );
    const item = q.items[0]!;
    item.id = id;
    const launch = vi.fn(async () => {
      throw new Error("native launch reached");
    });
    const adapter = factory(q, f.repository, {
      native: {
        ...codexAdapter(f.gitExecutable),
        async preflight() {},
        async waitForProvider() {},
        launch,
      },
      setup: gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, cwd) {
          await mkdir(resolve(cwd, "node_modules"), { recursive: true });
          await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
      gitExecutable: f.gitExecutable,
    });
    await expect(queueStep(q, adapter)).rejects.toThrow(
      bypass ? "source-flow-state-unknown" : "native-launch-ceiling-exhausted",
    );
    if (bypass) {
      expect(launch).toHaveBeenCalledTimes(1);
      return;
    }
    await expect(queueStep(q, adapter)).rejects.toThrow("author-launch-identity-unknown-reconcile");
    expect(launch).not.toHaveBeenCalled();
    expect(await adapter.history()).toEqual(history);
    // Vary only the owning identity: confusable keys spend no selected allowance.
    const path = resolve(q.stateDirectory, "participant-64-terminal.json");
    const other = { ...history[63]!, item: "ISS-2340:1" };
    await writeFile(path, JSON.stringify(other));
    q.initialHistory[63] = other;
    // A separate disposable dispatch with the changed identity, not re-entry past
    // the retained uncertain-intent boundary of the preceding refusal.
    await rm(resolve(item.source.stateDirectory, "author-intent.json"));
    await expect(queueStep(q, adapter)).rejects.toThrow("source-flow-state-unknown");
    expect(launch).toHaveBeenCalledTimes(1);
  },
);

it("ISS-235 resumes the baseline-exhausted attempt-2 candidate with only reviewer ordinal 65", async () => {
  const f = await loopFixture(true);
  f.loop.nativeLaunchCeiling = 64;
  const baselinePath = resolve(f.repository, "scripts/dogfood/queue.ts");
  const fixedCode = await readFile(baselinePath, "utf8");
  // Historical admission negative control; no other gate or lifecycle is bypassed.
  const baselineCode = fixedCode.replace(
    "issueLaunches(priorHistory, item.id, item.acceptedReplan?.issueKey)",
    "priorHistory.length",
  );
  expect(baselineCode).not.toBe(fixedCode);
  await writeFile(baselinePath, baselineCode);
  await execute(f.gitExecutable, ["-C", f.repository, "add", "."]);
  await execute(f.gitExecutable, [
    "-C",
    f.repository,
    "commit",
    "-m",
    "Synthetic historical admission",
  ]);
  const old = (await import(/* @vite-ignore */ pathToFileURL(baselinePath).href)) as {
    repositoryQueueAdapter: typeof repositoryQueueAdapter;
  };
  const selected = { ...f.selected, key: "ISS-234" };
  const history = budgetHistory(61, (i) => `ISS-${i === 0 ? "2340" : 1000 + i}:1`);
  const firstAuthor = participant(62, "ISS-234:1", "source", "author", "passed");
  const firstReviewer = participant(63, "ISS-234:1", "source", "reviewer", "passed");
  history.push(firstAuthor, firstReviewer);
  const runState = resolve(f.stateRoot, f.loop.run);
  const priorDirectory = resolve(runState, "iss-234-attempt-1");
  await mkdir(resolve(priorDirectory, "source"), { recursive: true });
  const prior = {
    schemaVersion: "dogfood-bounded-queue-attempt/v1",
    phase: "failed",
    run: f.loop.run,
    index: 0,
    item: "ISS-234:1",
    issue: `https://github.com/${f.loop.repository}/issues/${selected.number}`,
    base: selected.base,
    candidateAttempt: 1,
    head: selected.base,
    reviewId: firstReviewer.id,
    findings: [
      {
        file: "docs/loop.md",
        line: 1,
        severity: "blocking",
        text: "Synthetic hosted assertion failure",
      },
    ],
    history,
    retries: 0,
    acceptedStage: null,
    stateDirectory: null,
    rebasedBase: selected.base,
    rebasedMainBase: selected.base,
  };
  await writeFile(resolve(priorDirectory, "attempt.json"), JSON.stringify(prior));
  const priorSource = resolve(priorDirectory, "source");
  const publication = {
    number: 234,
    url: `https://github.com/${f.loop.repository}/pull/234`,
    head: selected.base,
    repository: f.loop.repository,
    sourceBranch: "codex/iss-234",
    baseBranch: "main",
    title: "Synthetic prior candidate",
    body: "Synthetic prior delivery",
    planDigest: "a".repeat(64),
  };
  for (const worker of [firstAuthor, firstReviewer]) {
    const trace = resolve(priorSource, `${worker.role}.jsonl`);
    await writeFile(trace, JSON.stringify({ type: "thread.started", thread_id: worker.id }) + "\n");
    await writeFile(
      resolve(priorSource, `${worker.role}-attempt.json`),
      JSON.stringify({ id: worker.id, pid: 1, trace, launchedAt: 1 }),
    );
    await writeFile(
      resolve(priorSource, `${worker.role}-terminal.json`),
      JSON.stringify({
        id: worker.id,
        status: "passed",
        head: selected.base,
        summary: JSON.stringify({
          run: f.loop.run,
          role: worker.role,
          head: selected.base,
          verdict: "PASS",
          ...(worker.role === "reviewer"
            ? { findings: [], g0: "Historical synthetic review, not authority for attempt two" }
            : { summary: "Synthetic earlier implementation" }),
        }),
      }),
    );
  }
  await writeFile(resolve(priorSource, "publication.json"), JSON.stringify(publication));
  await writeFile(
    resolve(priorSource, "delivery-source.json"),
    JSON.stringify({
      repository: f.loop.repository,
      head: selected.base,
      reviewId: firstReviewer.id,
    }),
  );
  await writeFile(
    resolve(priorSource, "hosted-failure.log"),
    JSON.stringify({
      repository: f.loop.repository,
      head: selected.base,
      publication,
      checks: [
        {
          name: "Node 24 / windows-latest",
          bucket: "fail",
          link: `https://github.com/${f.loop.repository}/actions/runs/234/job/235`,
          actions: { run: 234, attempt: 1, job: 235, workflow: 1 },
        },
      ],
    }) + "\nSynthetic retained hosted assertion failure\n",
  );
  const priorBytes = await snapshot(priorDirectory);
  let q = await queueConfigFromLoop(f.loop, f.repository, selected, budgetPolicy, history);
  const item = q.items[0]!;
  expect(item.implementationAttempt).toBe(2);
  const real = codexAdapter(f.gitExecutable);
  const launches: string[] = [];
  let reviewReady = false;
  const native: Adapter = {
    ...real,
    async preflight() {},
    async waitForProvider() {},
    async launch(role, config, prompt) {
      launches.push(role);
      expect(prompt).toContain(
        JSON.stringify(await realpath(resolve(priorSource, "hosted-failure.log"))),
      );
      if (role === "author")
        await writeFile(resolve(config.worktree, "docs/loop.md"), "# ISS-235 synthetic partial\n");
      return {
        id: `partial-${role}`,
        pid: 111,
        trace: resolve(config.stateDirectory, `${role}.jsonl`),
        launchedAt: 1,
      };
    },
    async observe(role, config, attempt) {
      if (role === "author") return { id: attempt.id, status: "passed", head: config.base };
      if (!reviewReady) return { id: attempt.id, status: "running" };
      const head = await real.git(config.reviewWorktree, ["rev-parse", "HEAD"]);
      return {
        id: attempt.id,
        status: "passed",
        head,
        summary: JSON.stringify({
          run: config.run,
          role,
          head,
          verdict: "PASS",
          findings: [],
          g0: "Synthetic independent exact-head review",
        }),
      };
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
  let deliveries = 0;
  const adapter = (factory = repositoryQueueAdapter) => ({
    ...factory(q, f.repository, {
      native,
      setup,
      gitExecutable: f.gitExecutable,
      async assertExecutor() {},
    }),
    async delivery(current: QueueItem, accepted: { head: string; reviewId: string }) {
      deliveries++;
      expect(accepted.reviewId).toBe("partial-reviewer");
      expect(accepted.head).toBe(
        JSON.parse(await readFile(resolve(item.source.stateDirectory, "candidate.json"), "utf8"))
          .head,
      );
      return deliveryCompletion(current, accepted.head, accepted.reviewId);
    },
  });
  // Baseline admission stops after the author terminal and commit, before reviewer launch.
  await expect(queueStep(q, adapter(old.repositoryQueueAdapter))).rejects.toThrow(
    "native-launch-ceiling-exhausted",
  );
  expect(launches).toEqual(["author"]);
  const attemptPath = resolve(q.stateDirectory, "attempt.json");
  expect(JSON.parse(await readFile(attemptPath, "utf8")).history).toHaveLength(63);
  expect(await adapter().history()).toHaveLength(64);
  await expect(
    readFile(resolve(item.source.stateDirectory, "reviewer-terminal.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const preserved = await snapshot(item.source.stateDirectory);
  const setupBytes = await snapshot(item.setup.stateDirectory);
  const head = await real.git(item.source.worktree, ["rev-parse", "HEAD"]);
  const cycle = { selection: { cycle: 1, ...selected }, initialHistory: await adapter().history() };
  const comments: string[] = [];
  const host: SupervisionAdapter = {
    async currentMain() {
      throw new Error("saved selection must not fetch");
    },
    async issue() {
      return { key: selected.key, state: "OPEN", labels: ["ready"], comments };
    },
    async comment(_config, _number, body) {
      comments.push(body);
    },
    async close() {},
    async removeReady() {
      throw new Error("budget stop must not park");
    },
  };
  await persistCycle(f.loop, cycle);
  await stopCycle(f.loop, cycle, "native-launch-ceiling-exhausted", 2, host, repositoryPolicy);
  const stopBytes = await readFile(resolve(runState, "cycle-1-stop-1-complete.json"));
  // A real executor revision change must keep saved setup/source fingerprints usable.
  await writeFile(baselinePath, fixedCode);
  await real.git(f.repository, ["add", "."]);
  await real.git(f.repository, ["commit", "-m", "ISS-235 synthetic executor upgrade"]);
  q = await queueConfigFromLoop(f.loop, f.repository, selected, budgetPolicy, history);
  for (const mode of ["dispatch-artifact", "pending-stop", "wrong-head"] as const) {
    const path =
      mode === "dispatch-artifact"
        ? resolve(item.source.stateDirectory, "reviewer-uncertain.request.json")
        : mode === "pending-stop"
          ? resolve(runState, "cycle-1-stop-1-complete.json")
          : resolve(item.source.stateDirectory, "reviewer-intent.json");
    const before = mode === "dispatch-artifact" ? undefined : await readFile(path);
    if (mode === "dispatch-artifact") await writeFile(path, "{}");
    else if (mode === "pending-stop") await rm(path);
    else
      await writeFile(
        path,
        JSON.stringify({ ...JSON.parse(before!.toString()), head: selected.base }),
      );
    await expect(queueStep(q, adapter())).rejects.toThrow(
      "reviewer-launch-identity-unknown-reconcile",
    );
    expect(launches).toEqual(["author"]);
    if (before) await writeFile(path, before);
    else await rm(path);
  }
  for (let restart = 0; restart < 2; restart++) {
    const resumed = (await nextCycle(
      f.loop,
      f.repository,
      host,
      repositoryPolicy,
      async () => {},
    ))!;
    expect(resumed.selection).toEqual(cycle.selection);
    const { cycle: _cycle, ...selection } = resumed.selection;
    q = await queueConfigFromLoop(
      f.loop,
      f.repository,
      selection,
      budgetPolicy,
      resumed.initialHistory,
    );
    expect(q.stateDirectory).toBe(await realpath(resolve(priorDirectory, "../iss-234-attempt-2")));
    expect(q.items[0]!.implementationAttempt).toBe(2);
    await expect(queueStep(q, adapter())).resolves.toMatchObject({ status: "observing-reviewer" });
    expect(deliveries).toBe(0);
  }
  expect(launches).toEqual(["author", "reviewer"]);
  reviewReady = true;
  for (let restart = 0; restart < 2; restart++)
    await expect(queueStep(q, adapter())).resolves.toMatchObject({
      status: "complete",
      participants: 65,
    });
  const charged = await adapter().history();
  expect(charged.slice(0, 63)).toEqual(history);
  expect(charged.slice(61).map((p) => p.id)).toEqual([
    firstAuthor.id,
    firstReviewer.id,
    "partial-author",
    "partial-reviewer",
  ]);
  expect(charged.at(-1)).toMatchObject({ ordinal: 65, item: "ISS-234:2", role: "reviewer" });
  const participantPath = resolve(q.stateDirectory, "participant-65-terminal.json");
  const participantBytes = await readFile(participantPath);
  await writeFile(participantPath, JSON.stringify({ ...charged[64], outcome: "failed" }));
  await expect(adapter().source(q.items[0]!)).rejects.toThrow("participant-terminal-drift");
  await writeFile(participantPath, participantBytes);
  expect(await adapter().history()).toEqual(charged);
  expect(deliveries).toBe(1);
  expect(await real.git(item.source.worktree, ["rev-parse", "HEAD"])).toBe(head);
  for (const [path, bytes] of preserved) expect(await readFile(path, "utf8"), path).toBe(bytes);
  expect(await snapshot(item.setup.stateDirectory)).toEqual(setupBytes);
  expect(await snapshot(priorDirectory)).toEqual(priorBytes);
  expect(await readFile(resolve(runState, "cycle-1-stop-1-complete.json"))).toEqual(stopBytes);
  expect(comments).toHaveLength(1);
  console.info(
    JSON.stringify({
      fixture: "ISS-235 synthetic saved-source replay",
      baselineAdmission: "native-launch-ceiling-exhausted",
      candidate: head,
      attempt: 2,
      resultingOrdinal: 65,
      ownCharges: 4,
      launches,
      result: "fresh exact-head review before delivery; repeated replay has no effects",
    }),
  );
});

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

describe.each([
  [false, false, "candidate"],
  [false, true, "candidate"],
  [true, false, "candidate"],
  [true, true, "candidate"],
  [false, false, "base"],
  [false, false, "unknown"],
  [false, false, "unchanged"],
  [false, false, "vacuous"],
  [false, false, "spent"],
  [true, true, "second failure"],
] as const)(
  "ISS-228 native structure correction refreshed=%s afterMirror=%s outcome=%s",
  (refresh, afterMirror, mode) => {
    let fixture: AsyncGenerator<void, void>;
    // Source, retained stop and recovery each keep the ordinary 30-second
    // hook/test bound. None of these phases skips native lifecycle work.
    beforeEach(async () => {
      fixture = prepareStructureCorrection(refresh, afterMirror, mode);
      expect((await fixture.next()).done).toBe(false);
    });
    beforeEach(async () => {
      expect((await fixture.next()).done).toBe(false);
    });
    it("attributes and resumes through the real adapter without renewing the allowance", async () => {
      expect((await fixture.next()).done).toBe(true);
    });
  },
);

describe.each([
  [false, false, "candidate"],
  [true, true, "candidate"],
  [false, true, "base"],
  [false, false, "vacuous"],
  [false, false, "spent"],
  [false, false, "second failure"],
  [false, false, "interrupted"],
  [false, false, "host"],
  [false, false, "review-fail"],
  [false, false, "review-repaired"],
  [true, true, "corrected source"],
  [false, true, "published"],
  ...[
    "four-key",
    "absent repair",
    "included repair",
    "nonancestor repair",
    "missing witness",
    "older witness",
    "divergent witness",
    "missing setup",
    "malformed setup",
    "wrong head",
    "wrong command",
    "wrong terminal head",
    "missing terminal",
    "signal",
    "partial",
    "unknown",
    "unchanged",
    "resource",
    "other stop",
  ].map((mode) => [false, false, mode] as const),
] as const)(
  "ISS-229 executor recovery refreshed=%s afterMirror=%s control=%s",
  (refresh, afterMirror, mode) => {
    let fixture: AsyncGenerator<void, void>;
    beforeEach(async () => {
      fixture = prepareStructureCorrection(refresh, afterMirror, mode, true);
      expect((await fixture.next()).done).toBe(false);
    });
    beforeEach(async () => {
      expect((await fixture.next()).done).toBe(false);
    });
    if (mode === "published") {
      // ISS-235 attempt 2 timed out on Windows while this final phase combined
      // admission, correction and delivery. Keep one lineage and every assertion,
      // with the existing hook/test bound applied at reviewer observations.
      beforeEach(async () => {
        expect((await fixture.next()).done).toBe(false); // recovery DELTA pending
      });
      beforeEach(async () => {
        expect((await fixture.next()).done).toBe(false); // correction DELTA pending
      });
    }
    it("retains one native lineage through admission, review, attribution and terminal replay", async () => {
      expect((await fixture.next()).done).toBe(true);
    });
  },
);

async function* prepareStructureCorrection(
  refresh: boolean,
  afterMirror: boolean,
  mode: string,
  executorRecovery = false,
) {
  // Keep the synthetic refreshed base checkout below Windows' path limit;
  // core.longpaths alone did not fix the attempt-2 hosted control failures.
  // Hosted Windows' user TEMP adds roughly 30 characters over RUNNER_TEMP.
  // The continuation adds another directory below the ISS-228 fixture, so use
  // the runner's disposable root for its real Git base checkout as well.
  const f = await loopFixture(
    false,
    undefined,
    "q-",
    process.platform === "win32" ? (process.env.RUNNER_TEMP ?? tmpdir()) : tmpdir(),
  );
  f.loop.run = executorRecovery ? "r" : "iss228";
  if (executorRecovery) {
    // The extra continuation segment must still leave the native base control
    // below Windows' path limit (the same constraint as ISS-228's fixture).
    f.loop.stateRoot = resolve(f.repository, "..", "s");
    f.loop.worktreeRoot = resolve(f.repository, "..", "w");
  }
  const git = async (tree: string, args: string[]) =>
    (await execute(f.gitExecutable, ["-C", tree, ...args])).stdout.trim();
  await writeFile(
    resolve(f.repository, "package.json"),
    '{"scripts":{"verify:static:scoped":"node synthetic.mjs"}}',
  );
  await writeFile(resolve(f.repository, "pnpm-lock.yaml"), "synthetic lock\n");
  await git(f.repository, ["add", "."]);
  await git(f.repository, ["commit", "-m", "synthetic structure toolchain"]);
  f.selected.base = await git(f.repository, ["rev-parse", "HEAD"]);
  const remote = resolve(f.repository, "..", "remote.git");
  await execute(f.gitExecutable, ["clone", "--bare", f.repository, remote]);
  await git(f.repository, ["remote", "add", "origin", "https://github.com/fixture/repository.git"]);
  const executor = executorRecovery ? resolve(f.repository, "..", "executor") : f.repository;
  if (executorRecovery) {
    await mkdir(executor);
    await execute(f.gitExecutable, ["init", "-b", "main", executor]);
    await appendFile(
      resolve(executor, ".git/config"),
      "[user]\n\tname = Fixture\n\temail = fixture@example.test\n",
    );
    await writeFile(resolve(executor, "executor.txt"), "synthetic independent executor\n");
    await git(executor, ["add", "."]);
    await git(executor, ["commit", "-m", "synthetic initial executor"]);
    // Distinguish a stop witness older than setup from an unresolvable SHA.
    await git(executor, ["commit", "--allow-empty", "-m", "synthetic setup executor"]);
  }
  const stoppedExecutorHead = await git(executor, ["rev-parse", "HEAD"]);
  vi.stubEnv("GIT_ALLOW_PROTOCOL", "file");
  const launcher = resolve(f.stateRoot, "synthetic-pnpm.mjs");
  await mkdir(f.stateRoot, { recursive: true });
  const block = `[VERIFY_STATIC_RUN] check:structure
$ node ./scripts/check-structure.mjs && node ./scripts/check-structure/brand-foil-proof.mjs
Brand foil: {"tracked":2,"scanned":2,"bytes":40,"readFailures":0,"nul":0,"literal":0,"raw":0,"constructor":0,"token":0,"union":0,"allowed":0,"violations":0,"roles":{}}; allowed + violations = union: 0 + 0 = 0
Structure check failed:

- ${mode === "unchanged" ? "docs/loop.md" : "synthetic.ts"}: synthetic package boundary (./context.json)

See docs/architecture/bounded-context-structure.md#rules-the-structure-gate-enforces for the enforced rules and fixes.
[ELIFECYCLE] Command failed with exit code 1.
[ELIFECYCLE] Command failed with exit code 1.
`;
  await writeFile(
    launcher,
    `
    import {existsSync, readFileSync} from "node:fs";
    if (process.argv[2] === "install") process.exit(${mode === "host" ? 1 : 0});
    if (process.argv[3] !== "verify:static:scoped") process.exit(0);
    if (${mode === "published"} && !existsSync(${JSON.stringify(resolve(f.stateRoot, "published-conflict"))})) {
      console.log("[VERIFY_STATIC_RUN] check:structure"); process.exit(0);
    }
    const candidate = existsSync("synthetic.ts");
    const broken = candidate && (readFileSync("synthetic.ts", "utf8").includes("broken") || ${mode === "second failure"});
    if (broken || ${mode === "base"}) {
      console.log(${JSON.stringify(block)});
      if (${mode === "unknown"}) console.log("unexpected synthetic failure");
      process.exit(1);
    }
    if (!candidate && process.env.CHANGED_FILES_JSON !== '["synthetic.ts"]') throw new Error("base scope was not candidate-derived");
    console.log(${JSON.stringify(mode === "vacuous" ? "[SKIPPED-BY-SCOPE] check:structure: empty scope" : "[VERIFY_STATIC_RUN] check:structure")});
  `,
  );
  vi.stubEnv("npm_execpath", launcher);
  vi.stubEnv("CHANGED_FILES_JSON", executorRecovery ? undefined : '["SYNTHETIC_AMBIENT_ONLY.ts"]');
  let q = await queueConfigFromLoop(f.loop, executor, f.selected, repositoryPolicy);
  const item = q.items[0]!;
  const launches: { stage: string; head: string; prompt: string }[] = [];
  let authorRunning = false,
    reviewRunning = false,
    deltaRunning = false,
    stoppedRun = executorRecovery;
  let interruptIntegration = false;
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      const result = await git(
        tree,
        args[0] === "fetch" ? args.map((arg) => (arg === "origin" ? remote : arg)) : args,
      );
      if (interruptIntegration && args[0] === "rebase") {
        interruptIntegration = false;
        throw new QueueBlocked("rebase-conflict"); // lost native integration response
      }
      return result;
    },
    async launch(role, config, prompt) {
      const correction = config.stateDirectory.endsWith("gate-correction");
      launches.push({
        stage: `${correction ? "correction-" : config.stateDirectory.includes("refresh-") ? "refresh-" : ""}${role}`,
        head: config.base,
        prompt,
      });
      if (role === "author")
        await writeFile(
          resolve(config.worktree, "synthetic.ts"),
          correction
            ? mode === "corrected source"
              ? "still broken synthetic feature\n"
              : "corrected synthetic feature\n"
            : config.stateDirectory === item.repair.stateDirectory
              ? "repaired broken synthetic feature\n"
              : "broken synthetic feature\n",
        );
      const trace = resolve(config.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, "synthetic execution evidence\n");
      return { id: randomUUID(), pid: 111, trace, launchedAt: 1 };
    },
    async observe(role, config, attempt) {
      if (deltaRunning && /gate-stop-continuation[\\/]refresh-/.test(config.stateDirectory))
        return { id: attempt.id, status: "running" };
      if (
        config.stateDirectory.endsWith("gate-correction") &&
        (role === "author" ? authorRunning : reviewRunning)
      )
        return { id: attempt.id, status: "running" };
      const head =
        role === "author" ? config.base : await git(config.worktree, ["rev-parse", "HEAD"]);
      const reject =
        (mode === "review-fail" &&
          /gate-stop-continuation[\\/]refresh-/.test(config.stateDirectory)) ||
        (mode === "review-repaired" &&
          role === "reviewer" &&
          config.stateDirectory === item.source.stateDirectory);
      return {
        id: attempt.id,
        status: reject ? "failed" : "passed",
        head,
        ...(role === "reviewer"
          ? {
              summary: JSON.stringify({
                run: config.run,
                role,
                head,
                verdict: reject ? "FAIL" : "PASS",
                findings: reject
                  ? [
                      {
                        file: "synthetic.ts",
                        line: 1,
                        severity: "blocking",
                        text: "Synthetic rejected integration.",
                      },
                    ]
                  : [],
                g0: "Synthetic independent exact-head review.",
              }),
            }
          : {}),
      };
    },
    async checks() {
      throw new Error("source must not publish");
    },
  };
  const delivery = githubDeliveryAdapter(undefined, f.gitExecutable);
  const effects: string[] = [];
  const realGate = delivery.runGate;
  delivery.runGate = async (config, name, head) => {
    effects.push(`gate:${name}:${head}`);
    const result = await realGate(config, name, head);
    // Historical pre-ISS-228 recognition: actual command/terminal/full log, but
    // cached unknown. Never fabricate candidate causality or a passing control.
    if (
      stoppedRun &&
      (mode !== "corrected source" || config.stateDirectory.endsWith("gate-correction")) &&
      typeof result === "object" &&
      result.status === "failed" &&
      result.evidence
    )
      return {
        ...result,
        evidence: { ...result.evidence, cause: "unknown" as const, diagnostics: [] },
      };
    return result;
  };
  const realAttribute = delivery.attributeGate!;
  delivery.attributeGate = async (...args) => {
    const result = await realAttribute(...args);
    effects.push(`attribution:${result.cause}`);
    if (result.cause === "host" && mode !== "host") {
      const directory = resolve(result.log, "..");
      const evidence = await Promise.all(
        (await readdir(directory))
          .filter((name) => name.startsWith("base") && /\.(log|json)$/.test(name))
          .map(async (name) => `${name}: ${await readFile(resolve(directory, name), "utf8")}`),
      );
      throw new Error(`Synthetic base control failed at ${directory}\n${evidence.join("\n")}`);
    }
    return result;
  };
  let mirrored = false,
    merged = false,
    cleaned = false,
    checksGreen = false;
  let publication: PublicationEvidence | undefined;
  let publicationConflict = false;
  delivery.observeDraft = async () =>
    mirrored ? { state: "confirmed", value: { issue: 361 } } : { state: "needs-mutation" };
  delivery.applyDraft = async () => {
    mirrored = true;
    effects.push("mirror");
  };
  delivery.observePublication = async (config) =>
    publication
      ? publication.head === config.candidateHead
        ? { state: "confirmed", value: publication }
        : { state: "needs-mutation", target: `pr:${publication.number}` }
      : { state: "needs-mutation", target: "absent" };
  if (executorRecovery) delivery.conflictingPublication = async () => publicationConflict;
  delivery.publish = async (config, plan) => {
    if (mode === "published" && publication) {
      expect(config.refresh).toMatchObject({ number: publication.number, head: publication.head });
      expect(
        await git(config.worktree, ["merge-base", publication.head, config.candidateHead]),
      ).toBe(publication.head);
      expect(plan.sourceBranch).toBe(publication.sourceBranch);
    }
    effects.push("publish");
    publication = {
      number: 400,
      url: "https://github.com/fixture/repository/pull/400",
      repository: config.repository,
      head: config.candidateHead,
      sourceBranch: plan.sourceBranch,
      baseBranch: plan.baseBranch,
      title: plan.title,
      body: plan.body,
      planDigest: createHash("sha256")
        .update(
          JSON.stringify(
            JSON.parse(await readFile(resolve(config.stateDirectory, "delivery-plan.json"), "utf8"))
              .plan,
          ),
        )
        .digest("hex"),
    };
  };
  delivery.checks = async (config) => {
    if (publicationConflict) throw new DeliveryBlocked("published-candidate-conflict");
    effects.push(`checks:${config.candidateHead}`);
    return {
      head: config.candidateHead,
      checks: config.requiredChecks.map((name) => ({
        name,
        bucket: checksGreen ? "pass" : "pending",
        link: `https://example.test/${name}`,
      })),
    };
  };
  delivery.observeMerge = async () =>
    merged
      ? {
          state: "confirmed",
          value: { number: 400, head: publication!.head, mergeCommit: "e".repeat(40) },
        }
      : { state: "needs-mutation" };
  delivery.merge = async () => {
    merged = true;
    effects.push("merge");
  };
  delivery.observeCleanup = async (_config, plan) =>
    cleaned ? { state: "confirmed", value: plan } : { state: "needs-mutation" };
  delivery.cleanup = async () => {
    cleaned = true;
    effects.push("cleanup");
  };
  const adapter = () =>
    repositoryQueueAdapter(q, executor, {
      native,
      delivery,
      gitExecutable: f.gitExecutable,
      ...(executorRecovery ? {} : { async assertExecutor() {} }),
      setup: gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, tree) {
          await mkdir(resolve(tree, "node_modules"), { recursive: true });
          await writeFile(resolve(tree, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
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
              beforeMirror: [
                ...(afterMirror ? [] : ["verify:static:scoped"]),
                "typecheck",
                "format:check",
                "test",
              ],
              afterMirror: afterMirror ? ["verify:static:scoped"] : [],
            },
            drafts: [
              {
                key: "ISS-104",
                issue: 361,
                title: "synthetic",
                body: "synthetic",
                attributes: {},
              },
            ],
            publication: {
              sourceBranch: "codex/synthetic-structure",
              baseBranch: "main",
              title: "synthetic",
              body: "synthetic",
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
  await expect(
    queueStep(q, {
      ...adapter(),
      async delivery() {
        throw new Error("synthetic source accepted");
      },
    }),
  ).rejects.toThrow("synthetic source accepted");
  const acceptedDirectory = JSON.parse(
    await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"),
  ).stateDirectory as string;
  let original = await snapshot(acceptedDirectory);
  if (mode === "spent") {
    const path = resolve(q.stateDirectory, "attempt.json");
    const retained = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...retained, retries: 1 }));
  }
  yield;
  const advanceMain = async () => {
    const updater = resolve(f.repository, "..", "updater");
    await execute(f.gitExecutable, ["clone", remote, updater]);
    await writeFile(resolve(updater, "main.txt"), "synthetic later main\n");
    await git(updater, ["add", "."]);
    await git(updater, [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "synthetic main",
    ]);
    await git(updater, ["push", "origin", "main"]);
  };
  if (refresh) await advanceMain();
  const recoveryRoot = resolve(acceptedDirectory, "gate-stop-continuation");
  const correctionRoot = executorRecovery ? recoveryRoot : acceptedDirectory;
  let oldSetup: Map<string, string> | undefined;
  let retainedHistory: QueueParticipant[] = [];
  let retainedStages: string[] = [];
  let retainedCandidateAttempt = 1;
  let grantLoop: LoopConfig | undefined;
  if (executorRecovery) {
    if (mode === "published") {
      await expect(queueStep(q, adapter())).resolves.toMatchObject({
        status: "observing-hosted-checks",
      });
      publicationConflict = true;
      await expect(queueStep(q, adapter())).resolves.toMatchObject({
        status: "observing-hosted-checks",
      });
      await advanceMain();
      await writeFile(resolve(f.stateRoot, "published-conflict"), "synthetic conflict observed\n");
    }
    if (mode === "corrected source")
      await expect(queueStep(q, adapter())).resolves.toMatchObject({ status: "observing-author" });
    await expect(queueStep(q, adapter())).rejects.toMatchObject({
      reason: "gate-attribution-unknown:verify:static:scoped",
    });
    publicationConflict = false;
    stoppedRun = false;
    const saved = JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"));
    retainedHistory = saved.history;
    retainedStages = launches.map((launch) => launch.stage);
    retainedCandidateAttempt = saved.candidateAttempt;
    const priorRefresh =
      refresh || mode === "published"
        ? JSON.parse(await readFile(resolve(acceptedDirectory, "native-refresh.json"), "utf8"))
        : undefined;
    const priorCorrection =
      mode === "corrected source"
        ? JSON.parse(
            await readFile(resolve(acceptedDirectory, "gate-correction-result.json"), "utf8"),
          )
        : undefined;
    const stoppedDirectory = priorCorrection
      ? resolve(acceptedDirectory, "gate-correction")
      : (priorRefresh?.directory ?? acceptedDirectory);
    const head = priorCorrection?.head ?? priorRefresh?.head ?? saved.head;
    const artifacts = resolve(
      stoppedDirectory,
      `gate-${createHash("sha256").update("verify:static:scoped").digest("hex")}`,
    );
    const terminalPath = resolve(artifacts, "candidate-terminal.json");
    const terminal = JSON.parse(await readFile(terminalPath, "utf8"));
    if (mode === "wrong terminal head") terminal.head = f.selected.base;
    if (mode === "wrong command") terminal.command.argv[terminal.command.argv.length - 1] = "test";
    if (mode === "signal") {
      terminal.code = null;
      terminal.signal = "SIGTERM";
    }
    await writeFile(terminalPath, JSON.stringify(terminal));
    if (mode === "missing terminal") await rm(terminalPath);
    if (mode === "partial")
      await writeFile(
        resolve(artifacts, "candidate.log"),
        block.slice(0, block.lastIndexOf("[ELIFECYCLE]")),
      );
    if (mode === "resource") await appendFile(resolve(artifacts, "candidate.log"), "ENOMEM\n");
    if (mode === "other stop")
      await writeFile(
        resolve(acceptedDirectory, "gate-stop.json"),
        JSON.stringify({ reason: "gate-host-failed:verify:static:scoped" }),
      );
    const setupPath = resolve(item.setup.stateDirectory, "setup-plan.json");
    if (mode === "missing setup") await rm(setupPath);
    if (mode === "malformed setup") {
      const plan = JSON.parse(await readFile(setupPath, "utf8"));
      delete plan.dependencies;
      await writeFile(setupPath, JSON.stringify(plan));
    }
    original = await snapshot(acceptedDirectory);
    oldSetup = await snapshot(item.setup.stateDirectory);
    await writeFile(resolve(executor, "repair.txt"), "synthetic executor-only repair\n");
    await git(executor, ["add", "."]);
    await git(executor, ["commit", "-m", "synthetic landed executor repair"]);
    const repairSha = await git(executor, ["rev-parse", "HEAD"]);
    let divergent = "";
    if (mode === "nonancestor repair" || mode === "divergent witness") {
      await git(executor, ["checkout", "--detach", `${stoppedExecutorHead}^`]);
      await git(executor, ["commit", "--allow-empty", "-m", "synthetic divergent executor"]);
      divergent = await git(executor, ["rev-parse", "HEAD"]);
      await git(executor, ["checkout", "main"]);
    }
    grantLoop = {
      ...f.loop,
      gateStopAuthorization: {
        stateDirectory: acceptedDirectory,
        candidateHead: mode === "wrong head" ? f.selected.base : head,
        repairSha:
          mode === "absent repair"
            ? "f".repeat(40)
            : mode === "included repair"
              ? stoppedExecutorHead
              : mode === "nonancestor repair"
                ? divergent
                : repairSha,
        authorityUrl: "https://github.com/fixture/repository/issues/361#issuecomment-229",
        ...(mode === "four-key"
          ? {}
          : {
              executorRepair: {
                stoppedExecutorHead:
                  mode === "missing witness"
                    ? "e".repeat(40)
                    : mode === "older witness"
                      ? await git(executor, ["rev-parse", `${stoppedExecutorHead}^`])
                      : mode === "divergent witness"
                        ? divergent
                        : stoppedExecutorHead,
              },
            }),
      },
    };
    q = await queueConfigFromLoop(grantLoop, executor, f.selected, repositoryPolicy);
    const cycle = { selection: { cycle: 1, ...f.selected }, initialHistory: retainedHistory };
    await persistCycle(f.loop, cycle);
    const comments: string[] = [];
    const supervisor: SupervisionAdapter = {
      async issue() {
        return { state: "OPEN", key: f.selected.key, labels: [], comments };
      },
      async currentMain() {
        throw new Error("saved selection must retain its pin");
      },
      async removeReady() {
        throw new Error("host stop must not park");
      },
      async close() {
        throw new Error("host stop must not close");
      },
      async comment(_config, _number, body) {
        comments.push(body);
        throw new Error("lost synthetic note response");
      },
    };
    const stopReason =
      mode === "other stop"
        ? "gate-host-failed:verify:static:scoped"
        : "gate-attribution-unknown:verify:static:scoped";
    await expect(
      stopCycle(f.loop, cycle, stopReason, 1, supervisor, repositoryPolicy),
    ).rejects.toThrow("lost synthetic note response");
    for (let replay = 0; replay < 2; replay++) {
      const resumed = (await nextCycle(grantLoop, executor, supervisor, repositoryPolicy))!;
      await expect(
        reconcilePendingStop(grantLoop, resumed, supervisor, repositoryPolicy),
      ).resolves.toBeUndefined();
    }
    expect(comments).toHaveLength(1);
    q = await queueConfigFromLoop(grantLoop, executor, f.selected, repositoryPolicy);
  }
  yield;
  {
    const run = () => queueStep(q, adapter());
    if (executorRecovery) {
      const admitted = [
        "candidate",
        "second failure",
        "base",
        "vacuous",
        "spent",
        "interrupted",
        "host",
        "review-fail",
        "review-repaired",
        "corrected source",
        "published",
      ].includes(mode);
      if (!admitted) {
        const reason =
          mode === "wrong head"
            ? "gate-stop-head-mismatch"
            : [
                  "wrong command",
                  "wrong terminal head",
                  "missing terminal",
                  "signal",
                  "partial",
                  "unknown",
                  "unchanged",
                  "resource",
                ].includes(mode)
              ? "gate-attribution-unknown:verify:static:scoped"
              : mode === "other stop"
                ? "gate-host-failed:verify:static:scoped"
                : "gate-stop-repair-not-applicable";
        const stoppedEffects = [...effects];
        for (let replay = 0; replay < 2; replay++)
          await expect(run()).rejects.toMatchObject({ reason });
        expect(effects).toEqual(stoppedEffects);
        expect(launches).toHaveLength(2 + (refresh ? 1 : 0));
        await expect(
          readFile(resolve(acceptedDirectory, "gate-stop-continuation.json")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(await snapshot(acceptedDirectory)).toEqual(original);
        expect(await snapshot(item.setup.stateDirectory)).toEqual(oldSetup);
        return;
      }
      deltaRunning = true;
      const beforeReview = [...effects];
      if (mode === "interrupted") {
        interruptIntegration = true;
        await expect(run()).rejects.toMatchObject({ reason: "rebase-conflict" });
        expect(launches).toHaveLength(2);
        await expect(
          readFile(resolve(acceptedDirectory, "gate-stop-continuation.json")),
        ).resolves.toBeDefined();
      }
      for (let replay = 0; replay < 2; replay++) {
        // JSON round trip also proves nested grant replay compares values.
        q = await queueConfigFromLoop(
          JSON.parse(JSON.stringify(grantLoop)),
          executor,
          f.selected,
          repositoryPolicy,
        );
        await expect(run()).resolves.toMatchObject({ status: "observing-reviewer" });
      }
      expect(effects).toEqual(beforeReview);
      const reservation = JSON.parse(
        await readFile(resolve(acceptedDirectory, "gate-stop-continuation.json"), "utf8"),
      );
      const integrated = JSON.parse(
        await readFile(resolve(recoveryRoot, "native-refresh.json"), "utf8"),
      );
      expect(integrated.head).toBe(reservation.delivery.candidateHead); // actual no-op integration
      expect(integrated.previousReview).toBe(reservation.sourceEvidence.reviewId);
      expect(launches.at(-1)!.stage).toBe("refresh-reviewer");
      expect(launches.at(-1)!.prompt).toContain("independent DELTA");
      if (mode === "published") yield;
      deltaRunning = false;
      if (mode === "review-fail") {
        for (let replay = 0; replay < 2; replay++)
          await expect(run()).rejects.toMatchObject({ reason: "refresh-review-failed" });
        expect(effects).toEqual(beforeReview);
        expect(launches).toHaveLength(3);
        return;
      }
    }
    if (
      !["candidate", "second failure", "interrupted", "review-repaired", "published"].includes(mode)
    ) {
      const reason =
        mode === "base"
          ? "gate-base-failed"
          : mode === "host"
            ? "gate-host-failed"
            : mode === "spent" || mode === "corrected source"
              ? "gate-correction-exhausted"
              : "gate-attribution-unknown";
      for (let replay = 0; replay < 2; replay++)
        await expect(run()).rejects.toMatchObject({ reason: `${reason}:verify:static:scoped` });
      expect(launches.map((l) => l.stage)).toEqual([
        ...(executorRecovery ? [...retainedStages, "refresh-reviewer"] : ["author", "reviewer"]),
      ]);
      expect(effects).not.toContain("publish");
      await expect(readFile(resolve(correctionRoot, "gate-correction.json"))).rejects.toMatchObject(
        { code: "ENOENT" },
      );
      expect(effects.filter((e) => e.startsWith("attribution:"))).toEqual(
        mode === "unknown"
          ? []
          : [
              ...(mode === "corrected source" ? ["attribution:candidate"] : []),
              `attribution:${mode === "spent" || mode === "corrected source" ? "candidate" : mode === "unchanged" || mode === "vacuous" ? "unknown" : mode}`,
            ],
      );
      if (executorRecovery) {
        const stoppedEffects = [...effects];
        const stoppedHistory = await readFile(resolve(q.stateDirectory, "attempt.json"));
        for (let replay = 0; replay < 2; replay++)
          await expect(run()).rejects.toMatchObject({ reason: `${reason}:verify:static:scoped` });
        expect(effects).toEqual(stoppedEffects);
        expect(await readFile(resolve(q.stateDirectory, "attempt.json"))).toEqual(stoppedHistory);
        for (const [path, bytes] of original)
          expect(await readFile(path, "utf8"), path).toBe(bytes);
        expect(await snapshot(item.setup.stateDirectory)).toEqual(oldSetup);
      }
      return;
    }
    await expect(run()).resolves.toMatchObject({ status: "observing-author" });
    const capture = JSON.parse(
      await readFile(resolve(correctionRoot, "gate-correction.json"), "utf8"),
    );
    expect(capture.gate).toBe("verify:static:scoped");
    authorRunning = true;
    for (let replay = 0; replay < 2; replay++)
      await expect(run()).resolves.toMatchObject({ status: "observing-author" });
    const correction = launches.find((l) => l.stage === "correction-author")!;
    expect(correction.head).toBe(capture.failedHead);
    for (const text of [
      capture.failedHead,
      capture.main,
      "full implementation diff",
      "only this failure and its direct causes",
      "candidate.log",
    ])
      expect(correction.prompt).toContain(text);
    authorRunning = false;
    reviewRunning = true;
    for (let replay = 0; replay < 2; replay++)
      await expect(run()).resolves.toMatchObject({ status: "observing-reviewer" });
    if (executorRecovery && mode === "published") yield;
    reviewRunning = false;
    if (mode === "second failure") {
      for (let replay = 0; replay < 2; replay++)
        await expect(run()).rejects.toMatchObject({
          reason: "gate-correction-exhausted:verify:static:scoped",
        });
      expect(effects).not.toContain("publish");
    } else {
      await expect(run()).resolves.toMatchObject({ status: "observing-hosted-checks" });
      expect(effects).not.toContain("merge");
      checksGreen = true;
      await expect(run()).resolves.toMatchObject({ status: "complete" });
      const completedEffects = [...effects];
      for (let replay = 0; replay < 2; replay++)
        await expect(run()).resolves.toMatchObject({ status: "complete" });
      expect(effects).toEqual(completedEffects);
      const finalGates = effects.filter(
        (e) => e.startsWith("gate:") && e.endsWith(publication!.head),
      );
      expect(finalGates).toHaveLength(4);
      expect(effects.filter((e) => e === "publish" || e === "merge" || e === "deployment")).toEqual(
        [...(mode === "published" ? ["publish"] : []), "publish", "merge", "deployment"],
      );
    }
    expect(launches.map((l) => l.stage)).toEqual([
      ...(executorRecovery
        ? [...retainedStages, "refresh-reviewer"]
        : ["author", "reviewer", ...(refresh ? ["refresh-reviewer"] : [])]),
      "correction-author",
      "correction-reviewer",
    ]);
    expect(launches.at(-1)!.prompt).toContain("Independent DELTA");
    const result = JSON.parse(
      await readFile(resolve(correctionRoot, "gate-correction-result.json"), "utf8"),
    );
    expect(result.head).not.toBe(capture.failedHead);
    expect(
      await git(item.source.worktree, ["diff", "--name-only", `${capture.main}...${result.head}`]),
    ).toBe("synthetic.ts");
    for (const [path, bytes] of original) expect(await readFile(path, "utf8"), path).toBe(bytes);
    if (executorRecovery) {
      expect(await snapshot(item.setup.stateDirectory)).toEqual(oldSetup);
      const final = JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"));
      expect(final.history.slice(0, retainedHistory.length)).toEqual(retainedHistory);
      expect(final.candidateAttempt).toBe(retainedCandidateAttempt);
    }
  }
}

async function loopFixture(
  withRuntime = false,
  acceptanceCriteria = "- One file drives the run.\n- Preserve the Markdown list.\n  Keep this continuation intact.",
  prefix = "loop-config-fixture-",
  temporaryRoot = tmpdir(),
) {
  const root = await mkdtemp(resolve(temporaryRoot, prefix));
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
          cp(resolve(import.meta.dirname, "../../adapters"), resolve(repository, "adapters"), {
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
  vi.unstubAllEnvs();
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
  f.loop.nativeLaunchCeiling = mode === "ceiling" ? 2 : 20;
  const inherited = Array.from({ length: 12 }, (_, i) =>
    participant(
      i + 1,
      `ISS-synthetic-${Math.floor(i / 2)}:1`,
      "source",
      i % 2 ? "reviewer" : "author",
      i % 2 ? "failed" : "passed",
    ),
  );
  if (mode === "ceiling") inherited[0] = { ...inherited[0]!, item: `${f.selected.key}:4` };
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
  const extended = { ...grant, executorRepair: { stoppedExecutorHead: "a".repeat(40) } };
  expect(() => validateLoopConfig({ ...f.loop, gateStopAuthorization: extended })).not.toThrow();
  const hosted = {
    cycle: 13,
    stop: 1,
    actionsRun: 123,
    runAttempt: 1,
    job: 455,
    stoppedExecutorHead: "a".repeat(40),
  };
  expect(() =>
    validateLoopConfig({
      ...f.loop,
      gateStopAuthorization: { ...grant, hostedNonExecution: hosted },
    }),
  ).not.toThrow();
  for (const hostedNonExecution of [
    null,
    {},
    { ...hosted, extra: true },
    { ...hosted, stoppedExecutorHead: undefined },
    { ...hosted, stoppedExecutorHead: "A".repeat(40) },
    ...["cycle", "stop", "actionsRun", "runAttempt", "job"].flatMap((key) =>
      [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"].map((value) => ({ ...hosted, [key]: value })),
    ),
  ])
    expect(() =>
      validateLoopConfig({
        ...f.loop,
        gateStopAuthorization: { ...grant, hostedNonExecution },
      } as LoopConfig),
    ).toThrow("invalid-gate-stop-authorization");
  expect(() =>
    validateLoopConfig({
      ...f.loop,
      gateStopAuthorization: { ...extended, hostedNonExecution: hosted },
    }),
  ).toThrow("invalid-gate-stop-authorization");
  for (const executorRepair of [
    null,
    {},
    { stoppedExecutorHead: "a".repeat(40), extra: true },
    { stoppedExecutorHead: 1 },
    { stoppedExecutorHead: "A".repeat(40) },
    { stoppedExecutorHead: "a".repeat(39) },
  ])
    expect(() =>
      validateLoopConfig({
        ...f.loop,
        gateStopAuthorization: { ...grant, executorRepair },
      } as LoopConfig),
    ).toThrow("invalid-gate-stop-authorization");
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

it.each([
  "completed",
  "pending",
  "replay",
  "interrupted",
  "unresolvable witness",
  "refreshed source",
  "corrected source",
  "retained count",
  "all non-execution",
  "no grant",
  "wrong receipt",
  "missing witness",
  "older witness",
  "divergent witness",
  "included repair",
  "absent repair",
  "missing setup",
  "malformed setup",
  "moved head",
])("ISS-230 SYNTHETIC hosted completed-stop continuation: %s", async (mode) => {
  const f = await loopFixture();
  const git = async (tree: string, args: string[]) =>
    (
      await execute(f.gitExecutable, [
        "-C",
        tree,
        ...args.map((arg) => (args[0] === "fetch" && arg === "origin" ? f.repository : arg)),
      ])
    ).stdout.trim();
  await git(f.repository, ["remote", "add", "origin", "https://github.com/fixture/repository.git"]);
  await git(f.repository, ["commit", "--allow-empty", "-m", "synthetic setup witness"]);
  let stoppedExecutorHead = await git(f.repository, ["rev-parse", "HEAD"]);
  f.selected.base = stoppedExecutorHead;
  const cycle = {
    selection: { cycle: 1, ...f.selected },
    initialHistory: [] as QueueParticipant[],
  };
  await persistCycle(f.loop, cycle);
  let q = await queueConfigFromLoop(f.loop, f.repository, f.selected, repositoryPolicy);
  const item = q.items[0]!;
  const launches: string[] = [],
    logs: string[][] = [];
  const native: Adapter = {
    async preflight() {},
    async git(tree, args) {
      if (
        mode === "unresolvable witness" &&
        !stopped &&
        args[0] === "rev-parse" &&
        args[1] === `${stoppedExecutorHead}^{commit}`
      )
        throw new Error("synthetic witness lookup unavailable; all other ancestry inputs frozen");
      return git(tree, args);
    },
    async launch(role, current) {
      launches.push(role);
      if (role === "author")
        await writeFile(
          resolve(current.worktree, "feature.txt"),
          `synthetic feature from ${current.base}\n`,
        );
      const trace = resolve(current.stateDirectory, `${role}.jsonl`);
      await writeFile(trace, "synthetic execution\n");
      return { id: randomUUID(), pid: 111, trace, launchedAt: 1 };
    },
    async observe(role, current, attempt) {
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
                g0: "No; synthetic native lifecycle.",
              }),
            }
          : {}),
      };
    },
    async checks() {
      throw new Error("unexpected source checks");
    },
  };
  let publication: PublicationEvidence;
  let stopped = true,
    publications = 0;
  const delivery = githubDeliveryAdapter({
    async gh(_config, args) {
      logs.push(args);
      if (mode === "interrupted" && logs.length === 1)
        throw new Error("synthetic interrupted log acquisition");
      expect(args).not.toContain("--job");
      return "SYNTHETIC executed Windows failure";
    },
    async ghJson(current, args) {
      if (args[0] === "pr")
        return {
          number: publication.number,
          url: publication.url,
          headRefOid: publication.head,
          headRefName: publication.sourceBranch,
          baseRefName: "main",
          state: "OPEN",
          title: publication.title,
          body: publication.body,
        };
      const repo = { full_name: current.repository, id: 10 };
      const run = {
        id: 123,
        workflow_id: 7,
        run_number: 1,
        run_attempt: 1,
        path: ".github/workflows/bootstrap.yml",
        event: "pull_request",
        head_sha: publication.head,
        head_branch: publication.sourceBranch,
        repository: repo,
        head_repository: repo,
        status: "completed",
        pull_requests: [
          {
            number: publication.number,
            url: `https://api.github.com/repos/${current.repository}/pulls/${publication.number}`,
            head: { ref: publication.sourceBranch, sha: publication.head, repo },
            base: { ref: "main", repo },
          },
        ],
      };
      if (args[1]!.includes("/jobs?"))
        return [
          {
            total_count: current.requiredChecks.length,
            jobs: current.requiredChecks.map((name, i) => ({
              id: 455 + i,
              run_id: 123,
              run_attempt: 1,
              head_sha: publication.head,
              name,
              html_url: `https://github.com/${current.repository}/actions/runs/123/job/${455 + i}`,
              status: "completed",
              conclusion: i === 0 || mode === "all non-execution" ? "cancelled" : "failure",
              runner_id: i === 0 || mode === "all non-execution" ? 0 : 42,
              steps: i === 0 || mode === "all non-execution" ? [] : [{ name: "executed" }],
              started_at: "2026-10-05T20:00:25Z",
              completed_at: "2026-10-05T20:15:26Z",
            })),
          },
        ];
      if (args[1]!.endsWith("/123")) return run;
      return [{ total_count: 1, workflow_runs: [run] }];
    },
  });
  const checks = delivery.checks.bind(delivery);
  delivery.checks = async (...args) => {
    if (stopped)
      throw new DeliveryBlocked(
        `hosted-check-log-unavailable:${item.delivery.requiredChecks[0]}`,
        "SYNTHETIC old observer: log not found: 455",
      );
    return checks(...args);
  };
  let gateFailed = false;
  delivery.runGate = async (current, _gate, head) => {
    if (mode === "corrected source" && !gateFailed) {
      gateFailed = true;
      const log = resolve(current.stateDirectory, "synthetic-gate.log");
      await writeFile(log, "SYNTHETIC assertion feature.txt\n");
      return {
        status: "failed",
        output: "SYNTHETIC assertion",
        evidence: {
          head,
          command: { executable: "pnpm", argv: ["test"], cwd: current.worktree },
          log,
          cause: "diagnostic",
          diagnostics: ["feature.txt"],
        },
      };
    }
    return "passed";
  };
  delivery.attributeGate = async (_current, _gate, evidence, main) => ({
    cause: "candidate",
    log: evidence.log,
    main,
  });
  delivery.observePublication = async () =>
    publication
      ? { state: "confirmed", value: publication }
      : { state: "needs-mutation", target: "absent" };
  delivery.publish = async (current, plan) => {
    publications++;
    const saved = JSON.parse(
      await readFile(resolve(current.stateDirectory, "delivery-plan.json"), "utf8"),
    );
    publication = {
      number: 400,
      url: "https://github.com/fixture/repository/pull/400",
      repository: current.repository,
      head: current.candidateHead,
      sourceBranch: plan.sourceBranch,
      baseBranch: "main",
      title: plan.title,
      body: plan.body,
      planDigest: saved.digest,
    };
  };
  delivery.merge = async () => {
    throw new Error("unauthorized merge");
  };
  const comments: string[] = [];
  const supervisor: SupervisionAdapter = {
    async issue() {
      return { state: "OPEN", key: f.selected.key, labels: [], comments };
    },
    async currentMain() {
      if (mode !== "no grant") throw new Error("saved selection");
      return repairSha;
    },
    async removeReady() {},
    async close() {},
    async comment(_config, _number, body) {
      comments.push(body);
    },
  };
  let authorityBody = "";
  const adapter = () =>
    repositoryQueueAdapter(q, f.repository, {
      native,
      delivery,
      gitExecutable: f.gitExecutable,
      async observeHostedIssue() {
        return { state: "OPEN", comments: comments.map((body) => ({ body })) };
      },
      async observeAuthority(url) {
        return {
          url,
          id: "230",
          author: "todd-skelton",
          body: authorityBody,
          capturedAt: new Date().toISOString(),
        };
      },
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
              title: "synthetic",
              body: "synthetic",
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
  const reason = `hosted-check-log-unavailable:${item.delivery.requiredChecks[0]}`;
  if (mode === "refreshed source") {
    await expect(
      queueStep(q, {
        ...adapter(),
        async delivery() {
          throw new Error("synthetic accepted source");
        },
      }),
    ).rejects.toThrow("synthetic accepted source");
    await git(f.repository, ["commit", "--allow-empty", "-m", "synthetic intervening main"]);
    stoppedExecutorHead = await git(f.repository, ["rev-parse", "HEAD"]);
    q = await queueConfigFromLoop(f.loop, f.repository, f.selected, repositoryPolicy);
  }
  if (mode === "corrected source")
    await expect(queueStep(q, adapter())).resolves.toMatchObject({ status: "observing-author" });
  await expect(queueStep(q, adapter())).rejects.toMatchObject({ reason });
  const attempt = JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"));
  if (mode === "retained count") {
    attempt.candidateAttempt = 2;
    await writeFile(resolve(q.stateDirectory, "attempt.json"), JSON.stringify(attempt));
  }
  // Native refresh/correction terminals may be newer than the delivery attempt's
  // history snapshot when observation throws. Supervision retains those charges.
  cycle.initialHistory = await adapter().history();
  await stopCycle(f.loop, cycle, reason, attempt.candidateAttempt, supervisor, {
    ...repositoryPolicy,
    async park() {
      return selfAdapter.unparkInstructions;
    },
  });
  const stopPath = resolve(f.loop.stateRoot, f.loop.run, "cycle-1-stop-1-complete.json");
  const oldStop = await readFile(stopPath);
  if (mode === "pending") await rm(stopPath);
  await git(f.repository, ["commit", "--allow-empty", "-m", "synthetic landed observer repair"]);
  const repairSha = await git(f.repository, ["rev-parse", "HEAD"]);
  let witness = stoppedExecutorHead;
  if (mode === "older witness") witness = await git(f.repository, ["rev-parse", `${witness}^`]);
  if (mode === "missing witness") witness = "e".repeat(40);
  if (mode === "divergent witness") {
    await git(f.repository, ["checkout", "--detach", `${stoppedExecutorHead}^`]);
    await git(f.repository, ["commit", "--allow-empty", "-m", "synthetic divergent witness"]);
    witness = await git(f.repository, ["rev-parse", "HEAD"]);
    await git(f.repository, ["checkout", "main"]);
  }
  const grant = {
    stateDirectory: item.source.stateDirectory,
    candidateHead: publication!.head,
    repairSha:
      mode === "included repair"
        ? stoppedExecutorHead
        : mode === "absent repair"
          ? "f".repeat(40)
          : repairSha,
    authorityUrl: "https://github.com/fixture/repository/issues/361#issuecomment-230",
    hostedNonExecution: {
      cycle: 1,
      stop: 1,
      actionsRun: 123,
      runAttempt: 1,
      job: 455,
      stoppedExecutorHead: witness,
    },
  };
  authorityBody = `Host-authorized synthetic invocation witness ${witness}; ${grant.repairSha}; ${grant.candidateHead}; ${publication!.url}; loop-stop:${f.loop.run}:1:1; 123:1/455`;
  const loop = { ...f.loop, ...(mode === "no grant" ? {} : { gateStopAuthorization: grant }) };
  if (mode === "wrong receipt") comments[0] += "different";
  if (mode === "moved head") publication!.head = "e".repeat(40);
  if (mode === "missing setup") await rm(resolve(item.setup.stateDirectory, "setup-plan.json"));
  if (mode === "malformed setup") {
    const path = resolve(item.setup.stateDirectory, "setup-plan.json");
    const setup = JSON.parse(await readFile(path, "utf8"));
    delete setup.dependencies;
    await writeFile(path, JSON.stringify(setup));
  }
  const before = await snapshot(item.source.stateDirectory);
  stopped = false;
  const resumed = await nextCycle(loop, f.repository, supervisor, {
    ...repositoryPolicy,
    async selectCandidates() {
      return [];
    },
  });
  if (mode === "no grant") {
    expect(resumed).toBeUndefined();
    expect(logs).toEqual([]);
    return;
  }
  expect(resumed?.selection).toEqual(cycle.selection);
  await reconcilePendingStop(loop, resumed!, supervisor, {
    ...repositoryPolicy,
    async park() {
      return selfAdapter.unparkInstructions;
    },
  });
  q = await queueConfigFromLoop(loop, f.repository, f.selected, repositoryPolicy);
  if (
    ![
      "completed",
      "pending",
      "replay",
      "interrupted",
      "refreshed source",
      "corrected source",
      "retained count",
    ].includes(mode)
  ) {
    const result = queueStep(q, adapter());
    await expect(result).rejects.toBeInstanceOf(QueueBlocked);
    if (mode === "all non-execution")
      await expect(result).rejects.toMatchObject({ reason: "hosted-check-never-executed" });
    await expect(
      readFile(resolve(item.source.stateDirectory, "gate-stop-continuation.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(logs).toEqual([]);
  } else {
    if (mode === "interrupted")
      await expect(queueStep(q, adapter())).rejects.toMatchObject({
        reason: `hosted-check-log-unavailable:${item.delivery.requiredChecks[1]}`,
      });
    if (mode === "replay") {
      for (let replay = 0; replay < 2; replay++) {
        await expect(
          adapter().delivery(item, {
            head: attempt.head,
            reviewId: attempt.reviewId,
            stateDirectory: attempt.stateDirectory,
            retries: attempt.retries,
          }),
        ).resolves.toMatchObject({ status: "failed" });
      }
    }
    await expect(queueStep(q, adapter())).resolves.toMatchObject({
      status: "advancing-attempt",
      cursor: mode === "retained count" ? 2 : 1,
    });
    expect(logs).toEqual(
      Array.from({ length: mode === "interrupted" ? 2 : 1 }, () => [
        "run",
        "view",
        "123",
        "--attempt",
        "1",
        "--log-failed",
      ]),
    );
    const after = JSON.parse(await readFile(resolve(q.stateDirectory, "attempt.json"), "utf8"));
    expect(after.history).toEqual(cycle.initialHistory);
    expect(after.candidateAttempt).toBe(mode === "retained count" ? 2 : 1);
    expect(await readFile(stopPath)).toEqual(oldStop);
    for (const [path, bytes] of before) expect(await readFile(path, "utf8")).toBe(bytes);
    await expect(
      readFile(resolve(item.source.stateDirectory, "gate-stop.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
  expect(launches).toEqual([
    "author",
    "reviewer",
    ...(mode === "refreshed source"
      ? ["reviewer"]
      : mode === "corrected source"
        ? ["author", "reviewer"]
        : []),
  ]);
  expect(publications).toBe(1);
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

it("ISS-235 a granted replan's custom slug cannot renew its inherited issue allowance", async () => {
  const f = await acceptedReplanFixture();
  f.loop.nativeLaunchCeiling = 9;
  const q = await f.compose();
  expect(q.items[0]!.id).toBe("cs-7766-replan-8014:5");
  expect(q.initialHistory).toHaveLength(9);
  validateQueueConfig(q);
  const launch = vi.fn(async () => {
    throw new Error("native launch must remain refused");
  });
  const adapter = repositoryQueueAdapter(q, f.repository, {
    gitExecutable: f.gitExecutable,
    setup: f.setup,
    native: {
      ...codexAdapter(f.gitExecutable),
      async preflight() {},
      async waitForProvider() {},
      launch,
    },
  });
  await expect(queueStep(q, adapter)).rejects.toThrow("native-launch-ceiling-exhausted");
  expect(launch).not.toHaveBeenCalled();
  expect(await adapter.history()).toEqual(f.history);
  for (const [path, bytes] of f.preserved) expect(await readFile(path, "utf8"), path).toBe(bytes);
});

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
    await f.git(["remote", "add", "origin", "https://github.com/chase-sets/chase-sets.git"]);
    const launcher = resolve(f.loop.stateRoot, "replan-native-pnpm.mjs");
    const gateCalls = resolve(f.loop.stateRoot, "replan-native-gates.txt");
    await writeFile(
      launcher,
      `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(gateCalls)}, process.argv[3] + '\\n'); console.log('Synthetic accepted-replan native gate execution');`,
    );
    vi.stubEnv("npm_execpath", launcher);
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
    await expect(readFile(gateCalls)).rejects.toMatchObject({ code: "ENOENT" });
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
      expect((await readFile(gateCalls, "utf8")).trim().split("\n")).toEqual([
        "verify:static:scoped",
        "typecheck",
      ]);
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
    [3, "claude-opus-5-5", "medium", "gpt-6.1-sol"],
    [4, "gpt-6-astra", "medium", "claude-opus-5-5"],
    [7, "gpt-6-astra", "high", "claude-opus-5-5"],
    [10, "gpt-6.1-sol", "high", "claude-opus-5-5"],
    [14, "claude-opus-5-5", "medium", "gpt-6.1-sol"],
    [15, "claude-opus-5-5", "high", "gpt-6.1-sol"],
  ] as const;
  for (const [row, author, effort, reviewer] of expected) {
    for (const review of [11, 12] as const) {
      const routing = parseRoutingMarker(
        `<!-- routing: ${JSON.stringify({ version: 1, row, review })} -->`,
      );
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

it.each([
  ...([11, 12] as const).flatMap((review) => [
    { row: 2, review, rung: 2, author: "gpt-6.1-sol", effort: "medium", reviewer: "gpt-6-astra" },
    {
      row: 2,
      review,
      rung: 3,
      author: "claude-sonnet-5-5",
      effort: "medium",
      reviewer: "gpt-6-astra",
    },
    {
      row: 10,
      review,
      rung: 0,
      author: "gpt-6.1-sol",
      effort: "high",
      reviewer: "claude-sonnet-5-5",
    },
    {
      row: 3,
      review,
      rung: 0,
      author: "claude-opus-5-5",
      effort: "medium",
      reviewer: "claude-sonnet-5-5",
    },
  ]),
  {
    row: "self" as const,
    review: 11,
    rung: 0,
    author: "gpt-6-astra",
    effort: "high",
    reviewer: "gpt-6.1-sol",
  },
])(
  "ISS-218 composes and launches successors at $row/$review author rung $rung and refused review tail",
  async ({ row, review, rung, author, effort, reviewer }) => {
    const f = await loopFixture();
    const rows: RoutingRow[] = JSON.parse(
      await readFile(new URL("../../adapters/chase-sets-routing.json", import.meta.url), "utf8"),
    );
    const routing =
      row === "self"
        ? { row: "self" as const }
        : parseRoutingMarker(`<!-- routing: ${JSON.stringify({ version: 1, row, review })} -->`);
    const policy: RepositoryAdapter = {
      ...repositoryPolicy,
      issueContext: async (input) => ({ ...(await repositoryPolicy.issueContext(input)), routing }),
    };
    const loop = { ...f.loop, adapter: row === "self" ? "self" : "chase-sets", routingRows: rows };
    const queue = await queueConfigFromLoop(loop, f.repository, f.selected, policy);
    const item = queue.items[0]!;
    expect(await queueConfigFromLoop(loop, f.repository, f.selected, policy)).toEqual(queue);
    await setupStep(
      item.setup,
      gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, cwd) {
          await mkdir(resolve(cwd, "node_modules"), { recursive: true });
          await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
      f.repository,
    );
    const real = codexAdapter(f.gitExecutable);
    const launches: string[] = [];
    const requested: { model: string; effort: string; rung: number | undefined }[] = [];
    const admitted: { model: string; effort: string; rung: number | undefined }[] = [];
    const native: Adapter = {
      ...real,
      async preflight() {},
      async waitForProvider() {},
      async authorRung() {
        return rung;
      },
      async launch(role, config) {
        const placement = config[role];
        const identity = { model: placement.model, effort: placement.effort, rung: placement.rung };
        requested.push(identity);
        if (role === "reviewer" && placement.rung === 0)
          throw new QueueBlocked("provider-model-refused");
        admitted.push(identity);
        launches.push(role);
        if (role === "author")
          await writeFile(resolve(config.worktree, "docs/loop.md"), "Synthetic implementation\n");
        return {
          id: randomUUID(),
          pid: 111,
          trace: resolve(config.stateDirectory, `${role}.jsonl`),
          launchedAt: 1,
        };
      },
      async observe(role, config, attempt) {
        return role === "author"
          ? { id: attempt.id, status: "passed", head: config.base }
          : { id: attempt.id, status: "running" };
      },
    };
    for (let replay = 0; replay < 2; replay++)
      await expect(
        sourceStep(item.source, native, item.setup.pilotWorktree),
      ).resolves.toMatchObject({ status: "observing-reviewer" });
    expect(launches).toEqual(["author", "reviewer"]);
    expect(admitted).toEqual([
      { model: author, effort, rung },
      { model: reviewer, effort: review === 11 ? "high" : "medium", rung: 1 },
    ]);
    for (const placement of requested)
      expect(["gpt-6-sol", "claude-sonnet-5"]).not.toContain(placement.model);
  },
);

it.each([false, true])(
  "ISS-218 preserves literal pre-cutover workers and participants (review refusal: %s)",
  async (refusal) => {
    const f = await loopFixture();
    // Literal row 10 from d9a78e0b3e237736d4e3d5bd5d2cf48aaae1ba11;
    // independent of the defaults and the successor table under test.
    const legacy: RoutingRow = {
      row: 10,
      review: 11,
      author: [
        { model: "gpt-6-sol", effort: "high" },
        { model: "gpt-6-astra", effort: "high" },
        { model: "claude-fable-5-1", effort: "high" },
      ],
      reviewer: [
        { model: "claude-opus-5-5", effort: "high" },
        { model: "claude-sonnet-5", effort: "high" },
      ],
    };
    const loop = { ...f.loop, adapter: "chase-sets", routingRows: [legacy] };
    const policy: RepositoryAdapter = {
      ...repositoryPolicy,
      issueContext: async (input) => ({
        ...(await repositoryPolicy.issueContext(input)),
        routing: parseRoutingMarker('<!-- routing: {"version":1,"row":10,"review":11} -->'),
      }),
    };
    const queue = await queueConfigFromLoop(loop, f.repository, f.selected, policy);
    const item = queue.items[0]!;
    item.source.inheritedWorkerRetry = true;
    const real = codexAdapter(f.gitExecutable);
    const launches: string[] = [];
    let observations = 0;
    let launchCalls = 0;
    let reviewComplete = false;
    const native: Adapter = {
      ...real,
      async preflight() {},
      async waitForProvider() {},
      async launch(role, config) {
        launchCalls++;
        if (refusal && role === "reviewer" && config.reviewer.rung === 0)
          throw new QueueBlocked("provider-model-refused");
        launches.push(role);
        if (role === "author")
          await writeFile(
            resolve(config.worktree, "docs/loop.md"),
            "Synthetic retained implementation\n",
          );
        return {
          id: randomUUID(),
          pid: 111,
          trace: resolve(config.stateDirectory, `${role}.jsonl`),
          launchedAt: 1,
        };
      },
      async observe(role, config, attempt) {
        observations++;
        expect(config[role]).toMatchObject(
          role === "author"
            ? { model: "gpt-6-sol", effort: "high", rung: 0 }
            : {
                model: refusal ? "claude-sonnet-5" : "claude-opus-5-5",
                effort: "high",
                rung: refusal ? 1 : 0,
              },
        );
        if (role === "author") return { id: attempt.id, status: "passed", head: config.base };
        if (!reviewComplete) return { id: attempt.id, status: "running" };
        const head = await real.git(config.worktree, ["rev-parse", "HEAD"]);
        return {
          id: attempt.id,
          status: "passed",
          head,
          summary: JSON.stringify({
            run: config.run,
            role,
            head,
            verdict: "PASS",
            findings: [],
            g0: "Synthetic retained review",
          }),
        };
      },
    };
    const adapter = repositoryQueueAdapter(queue, f.repository, {
      native,
      gitExecutable: f.gitExecutable,
      setup: gitSetupAdapter({
        gitExecutable: f.gitExecutable,
        async install(_launcher, _args, cwd) {
          await mkdir(resolve(cwd, "node_modules"), { recursive: true });
          await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
          return "succeeded";
        },
      }),
    });
    await expect(queueStep(queue, adapter)).resolves.toMatchObject({
      status: "observing-reviewer",
    });
    const refuseChangedSelectors = async (retained: Map<string, string>) => {
      const participants = await adapter.history();
      const observed = observations;
      const launched = launchCalls;
      // Only the selector changes, including Sonnet's unused rung without refusal.
      for (const [role, index, successor] of [
        ["author", 0, "gpt-6.1-sol"],
        ["reviewer", 1, "claude-sonnet-5-5"],
      ] as const) {
        const placement = item.source[role].ladder![index]!;
        const predecessor = placement.model;
        placement.model = successor;
        await expect(sourceStep(item.source, native, item.setup.pilotWorktree)).rejects.toThrow(
          "conflicting-run-configuration",
        );
        expect(await snapshot(queue.stateDirectory)).toEqual(retained);
        expect(await adapter.history()).toEqual(participants);
        placement.model = predecessor;
      }
      expect(observations).toBe(observed);
      expect(launchCalls).toBe(launched);
    };
    const observing = await snapshot(queue.stateDirectory);
    for (let replay = 0; replay < 2; replay++) {
      await expect(queueStep(queue, adapter)).resolves.toMatchObject({
        status: "observing-reviewer",
      });
      expect(await snapshot(queue.stateDirectory)).toEqual(observing);
    }
    await refuseChangedSelectors(observing);
    reviewComplete = true;
    await expect(adapter.source(item)).resolves.toMatchObject({ status: "accepted", retries: 1 });
    const retained = await snapshot(queue.stateDirectory);
    const participants = await adapter.history();
    expect(participants).toHaveLength(2);
    expect(participants.map(({ placement, rung }) => ({ ...placement, rung }))).toEqual([
      { model: "gpt-6-sol", effort: "high", rung: 0 },
      {
        model: refusal ? "claude-sonnet-5" : "claude-opus-5-5",
        effort: "high",
        rung: refusal ? 1 : 0,
      },
    ]);
    for (let replay = 0; replay < 2; replay++) {
      await expect(adapter.source(item)).resolves.toMatchObject({ status: "accepted", retries: 1 });
      expect(await snapshot(queue.stateDirectory)).toEqual(retained);
      expect(await adapter.history()).toEqual(participants);
    }
    await refuseChangedSelectors(retained);
    expect(launches).toEqual(["author", "reviewer"]);
  },
);

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
