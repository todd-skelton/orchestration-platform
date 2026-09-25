import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { SELF_ROUTING } from "../../../scripts/dogfood/routing.mjs";
import { expect } from "vitest";
import { QueueBlocked, queueStep } from "../../../scripts/dogfood/queue.js";
import {
  persistCycle,
  startCycle,
  stopCycle,
  type SupervisedCycle,
} from "../../../scripts/dogfood/supervision.js";
import { sourceFailureFixture, snapshot } from "./source-failure.js";
import type { PhaseTiming } from "./iss212-timing.js";

// Private synthetic reconstruction of the ISS-187 incident, read on 2026-09-17:
// ISS-180 attempt/config/terminal SHA256 f6ecb1b2 / bf75832e / ee440beb.
// fixture-110 = ISS-180; fixture-159 = ISS-182. No retained run is executed.
// The host artifact m1-182-pilot-stop-2337.md describes 652 retained rows + two
// stop rows, not 654 immutable blocked-issue files. Fixture manifests cover the
// entire synthetic run and separately cover worktrees/traces.
export async function prerequisiteFixture(timing?: PhaseTiming) {
  const partials = [
    "docs/loop.md",
    "scripts/dogfood/queue.ts",
    "test/dogfood/queue-adapter.test.ts",
    "test/dogfood/queue.test.ts",
  ];
  const f = await sourceFailureFixture(5, partials, timing);
  // Match the retained role/stage/outcome sequence, including the refresh
  // reviewer and dead launch; identities and usage are synthetic fixture data.
  for (const [index, participant] of f.current.config.initialHistory.entries()) {
    participant.item = index < 3 ? "fixture-178:1" : "fixture-179:1";
    participant.role = [1, 2, 4].includes(index) ? "reviewer" : "author";
    participant.placement = SELF_ROUTING[participant.role][0]!;
    participant.stage = index === 2 ? "refresh" : "source";
    participant.outcome = "passed";
  }
  f.loop.nativeLaunchCeiling = 64;
  await f.fail();
  const history = [
    ...f.cycle.initialHistory,
    ...f.cycle.initialHistory.map((p, i) => ({
      ...p,
      ordinal: i + 7,
      id: `later-${p.id}`,
      item: i < 2 ? "fixture-181:1" : "fixture-181:2",
      role: ([1, 4, 5].includes(i) ? "reviewer" : "author") as "reviewer" | "author",
      stage: (i === 5 ? "refresh" : "source") as "refresh" | "source",
      outcome: (i === 2 ? "dead" : "passed") as "dead" | "passed",
      rung: i === 3 ? 1 : 0,
      placement: SELF_ROUTING[[1, 4, 5].includes(i) ? "reviewer" : "author"][i === 3 ? 1 : 0]!,
    })),
  ];
  for (const [cycle, key, number, participants] of [
    [1, "fixture-prior-a", 107, history.slice(0, 3)],
    [2, "fixture-prior-b", 108, history.slice(0, 5)],
    [3, "fixture-110", 110, history.slice(0, 6)],
    [4, "fixture-later", 109, history],
  ] as const) {
    const selection = { cycle, key, number, base: f.base };
    await writeFile(resolve(f.runState, `cycle-${cycle}-selected.json`), JSON.stringify(selection));
    if (cycle !== 3)
      await writeFile(
        resolve(f.runState, `cycle-${cycle}-complete.json`),
        JSON.stringify({ selection, history: participants }),
      );
  }
  await stopCycle(
    f.loop,
    {
      selection: { cycle: 3, key: "fixture-110", number: 110, base: f.base },
      initialHistory: f.cycle.initialHistory,
    },
    "author-failed",
    1,
    f.host,
    f.policy,
  );
  for (const partial of partials)
    await writeFile(
      resolve(f.current.config.items[0]!.source.worktree, partial),
      "retained dirty partial\n",
    );
  const blocked: SupervisedCycle = {
    selection: {
      cycle: 5,
      key: "fixture-159",
      number: 159,
      base: f.base,
      planningRevision: f.base,
    },
    initialHistory: history,
  };
  await persistCycle(f.loop, blocked);
  const launch = f.native.launch;
  const observe = f.native.observe;
  f.native.launch = async (role, config, prompt) => {
    if (config.issue.endsWith("/159") && role === "author" && config.author.rung! < 2)
      throw new QueueBlocked("provider-model-refused");
    return launch(role, config, prompt);
  };
  f.native.observe = async (role, config, attempt) =>
    config.issue.endsWith("/159")
      ? { id: attempt.id, status: "running" }
      : observe(role, config, attempt);
  const blockedQueue = await f.compose(blocked);
  await startCycle(f.loop, blocked, f.host);
  await queueStep(blockedQueue.config, blockedQueue.adapter);
  await stopCycle(f.loop, blocked, "malformed-worker-verdict", 1, f.host, f.policy);
  timing?.phase("setup");
  const remote = resolve(f.root, "remote.git");
  await f.git(f.repository, ["clone", "--bare", f.repository, remote]);
  await f.git(f.repository, ["remote", "add", "origin", remote]);
  await f.upgrade();
  timing?.phase("queue");
  const replay = await f.compose(blocked);
  // ISS-187's historical stop predates ISS-180. Reconstruct the old composition
  // explicitly; ordinary composition now keeps the saved pilot at its old head.
  const replayItem = replay.config.items[0]!;
  expect(replayItem.source.pilotRevision).toBe(blockedQueue.config.items[0]!.source.pilotRevision);
  replayItem.setup.pilotRevision = replay.config.controllerRevision;
  replayItem.source.pilotRevision = replay.config.controllerRevision;
  try {
    await queueStep(replay.config, replay.adapter);
    throw new Error("missing saved pilot obstruction");
  } catch (error) {
    if (!(error instanceof QueueBlocked) || error.reason !== "pilot-revision-moved") throw error;
    await stopCycle(f.loop, blocked, error.reason, 1, f.host, f.policy);
  }
  f.loop.prerequisite = {
    blockedCycle: 5,
    blockedKey: blocked.selection.key,
    blockedNumber: blocked.selection.number,
    stop: 2,
    key: "fixture-110",
    number: 110,
    authorityUrl: "https://github.com/fixture/repository/issues/1#issuecomment-1",
  };
  f.host.prerequisiteOwners = async () => "absent";
  f.rows[0]!.ready = true;
  const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
  return { ...f, blocked, blockedQueue, history, partials, json };
}

// Test proof only: each added FILE must have an identified producer. There is
// no production manifest protocol or directory-wide write exemption.
export async function prerequisiteProof(
  f: Awaited<ReturnType<typeof prerequisiteFixture>>,
  before: Map<string, string>,
  trees: Map<string, string>,
  name: string,
) {
  const after = await snapshot(f.runState);
  const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
  const manifest = (files: Map<string, string>) =>
    [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes) }));
  const fields = (bytes: string) => {
    const names = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, child]) => {
            const path = prefix ? `${prefix}.${key}` : key;
            return [path, ...names(child, path)];
          })
        : [];
    try {
      return names(JSON.parse(bytes));
    } catch {
      return ["bytes"];
    }
  };
  const table = [];
  const oldAttemptPath = resolve(f.current.config.stateDirectory, "attempt.json");
  for (const [path, bytes] of before) {
    const current = after.get(path);
    expect(current, `deleted old record ${path}`).toBeDefined();
    if (path !== oldAttemptPath) expect(current, path).toBe(bytes);
    if (current === bytes) continue;
    const old = JSON.parse(bytes);
    const updated = JSON.parse(current!);
    expect(updated).toEqual({
      ...old,
      phase: "failed",
      reviewId: "",
      rebasedBase: updated.rebasedBase,
      rebasedMainBase: updated.rebasedMainBase,
    });
    expect(updated.history).toEqual(old.history); // retention, never an append
    table.push({
      path,
      fields: Object.keys(updated).filter(
        (key) => JSON.stringify(old[key]) !== JSON.stringify(updated[key]),
      ),
      cause: "queue pinned source FAIL projection and pending rebase; history retained",
    });
  }
  for (const [path, bytes] of after) {
    if (before.has(path)) continue;
    const relative = path.slice(f.runState.length + 1).replaceAll("\\", "/");
    let cause: string | undefined;
    if (
      /^prerequisite\/(admission|cycle-5-(selected|complete|stop-\d+(-complete)?))\.json$/.test(
        relative,
      )
    )
      cause = "detour supervision admission, selection, stop or completion";
    const own = /^fixture-110-attempt-(2|4)\/(.+)$/.exec(relative);
    const file = own?.[2];
    if (file === "attempt.json") cause = "native queue lifecycle";
    if (file && /^participant-\d+-terminal\.json$/.test(file)) {
      const participant = JSON.parse(bytes);
      const seedCount = own![1] === "2" ? 12 : 16;
      cause =
        participant.ordinal <= seedCount
          ? "native seedHistory copy, no new charge"
          : "native worker terminal observation";
    }
    if (
      file &&
      /^setup\/(setup-plan|(worktree|dependency)-(pilot|source|review)(-intent)?)\.json$/.test(file)
    )
      cause = "native setup plan, worktree or dependency transition";
    if (
      file &&
      /^(source|repair)\/(config|candidate|commit-intent|(author|reviewer)-(intent|attempt|terminal))\.json$/.test(
        file,
      )
    )
      cause = "native flow configuration, dispatch, observation or commit reconciliation";
    if (file && /^(source|repair)\/(author|reviewer|command-worker-\d+)\.jsonl$/.test(file))
      cause = "deterministic worker trace double";
    expect(cause, `unlisted added path ${relative}`).toBeDefined();
    table.push({ path, fields: fields(bytes), cause });
  }
  for (const [path, bytes] of trees) expect(await readFile(path, "utf8"), path).toBe(bytes);
  const traces = new Map<string, string>();
  for (const [path, bytes] of before)
    if (/(author|reviewer)-attempt\.json$/.test(path)) {
      const trace = JSON.parse(bytes).trace;
      if (trace) traces.set(trace, await readFile(trace, "utf8"));
    }
  const proof = {
    before: manifest(before),
    after: manifest(after),
    worktreePartials: manifest(trees),
    externalTraces: manifest(traces),
    table,
  };
  await writeFile(resolve(f.root, `${name}-proof.json`), JSON.stringify(proof, null, 2));
  // The author can retain the same successful test output outside the checkout
  // after fixture cleanup. This is evidence output, never loop runtime input.
  if (process.env.ISS187_PROOF_DIRECTORY) {
    await mkdir(process.env.ISS187_PROOF_DIRECTORY, { recursive: true });
    await writeFile(
      resolve(process.env.ISS187_PROOF_DIRECTORY, `${name}.json`),
      JSON.stringify(proof, null, 2),
    );
  }
  return proof;
}
