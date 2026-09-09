import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
export { assertQueueRequest, QueueBlocked, queueStep } from "../../../scripts/dogfood/queue.ts";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function repositoryQueueAdapter(config) {
  const callsPath = resolve(dirname(config.stateDirectory), "command-calls.json");
  const controlsPath = resolve(dirname(config.stateDirectory), "command-controls.json");
  const changeCalls = async (name) => {
    const calls = await readJson(callsPath, { setup: 0, source: 0, delivery: 0 });
    calls[name] += 1;
    await writeFile(callsPath, `${JSON.stringify(calls)}\n`);
    return calls;
  };
  const history = async () => {
    const participants = [];
    for (let ordinal = 1; ordinal <= config.nativeLaunchCeiling; ordinal += 1) {
      const participant = await readJson(
        resolve(config.stateDirectory, `participant-${ordinal}-terminal.json`),
        undefined,
      );
      if (participant === undefined) break;
      participants.push(participant);
    }
    return participants;
  };
  const accept = async (item) => {
    const usage = {
      inputTokens: { status: "known", value: 3 },
      outputTokens: { status: "known", value: 2 },
      costUsd: { status: "unavailable" },
    };
    const participants = [
      {
        ordinal: 1,
        id: `${item.id}-source-author`,
        item: item.id,
        stage: "source",
        role: "author",
        outcome: "passed",
        usage,
      },
      {
        ordinal: 2,
        id: `${item.id}-source-reviewer`,
        item: item.id,
        stage: "source",
        role: "reviewer",
        outcome: "passed",
        usage,
      },
    ];
    await Promise.all(
      participants.map((participant) =>
        writeFile(
          resolve(config.stateDirectory, `participant-${participant.ordinal}-terminal.json`),
          `${JSON.stringify(participant)}\n`,
        ),
      ),
    );
    return {
      status: "accepted",
      head: "b".repeat(40),
      reviewId: participants[1].id,
      stateDirectory: item.source.stateDirectory,
    };
  };
  return {
    async assertAuthority() {},
    history,
    async setup() {
      await changeCalls("setup");
      return { status: "ready" };
    },
    async source(item) {
      const calls = await changeCalls("source");
      const controls = await readJson(controlsPath, { mode: "complete" });
      if (controls.mode === "wait" && calls.source === 1) return { status: "observing-author" };
      return accept(item);
    },
    async repair() {
      throw new Error("fixture repair must not run");
    },
    async delivery(_item, accepted) {
      await changeCalls("delivery");
      return {
        status: "complete",
        head: accepted.head,
        reviewId: accepted.reviewId,
        publication: { number: 338, url: "https://example.test/338" },
        mergeCommit: "c".repeat(40),
        cleanup: { status: "confirmed", branch: "codex/synthetic-338" },
      };
    },
  };
}
