import { readFile, realpath } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import {
  currentCandidateAttempt,
  hasStartedDelivery,
  queueConfigFromLoop,
  QueueBlocked,
  queueStep,
  repositoryQueueAdapter,
  validateLoopExecutor,
  validateLoopConfig,
} from "./queue.ts";
import {
  completeCycle,
  nextCycle,
  persistCycle,
  reconcilePendingStop,
  repositorySupervisionAdapter,
  startCycle,
  stopCycle,
} from "./supervision.ts";

let active;
let config;
let loop;
try {
  if (process.argv.length !== 3) throw new QueueBlocked("usage");
  const executingRoot = await realpath(resolve(import.meta.dirname, "../.."));
  loop = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
  validateLoopConfig(loop);
  process.env.PATH = `${dirname(loop.gitExecutable)}${delimiter}${process.env.PATH ?? ""}`;
  await validateLoopExecutor(loop, executingRoot);
  const supervisor = repositorySupervisionAdapter();
  for (;;) {
    if (!active) {
      active = await nextCycle(loop, executingRoot, supervisor);
      if (!active) {
        process.stdout.write(`${JSON.stringify({ status: "idle", run: loop.run })}\n`);
        break;
      }
      await persistCycle(loop, active);
      await reconcilePendingStop(loop, active, supervisor);
    }
    config = await queueConfigFromLoop(
      loop,
      executingRoot,
      {
        key: active.selection.key,
        number: active.selection.number,
        base: active.selection.base,
      },
      active.initialHistory,
    );
    const adapter = repositoryQueueAdapter(config, executingRoot, {
      gitExecutable: loop.gitExecutable,
    });
    const started = await startCycle(loop, active, supervisor);
    if (started.status === "closed" && !(await hasStartedDelivery(config)))
      throw new QueueBlocked("closed-issue-without-delivery");
    const result = await queueStep(config, adapter);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "advancing-attempt") continue;
    if (result.status.startsWith("observing-")) {
      await new Promise((done) => setTimeout(done, 10_000));
      continue;
    }
    await completeCycle(loop, active, await adapter.history(), supervisor);
    active = undefined;
    config = undefined;
  }
} catch (error) {
  const reason = error instanceof QueueBlocked ? error.reason : "queue-internal-error";
  let lifecycleReason;
  if (active && loop) {
    const attempts = config ? await currentCandidateAttempt(config) : 0;
    try {
      await stopCycle(loop, active, reason, attempts, repositorySupervisionAdapter());
    } catch (stopError) {
      lifecycleReason =
        stopError instanceof QueueBlocked ? stopError.reason : "learning-note-state-unknown";
    }
  }
  process.stderr.write(
    `${JSON.stringify({
      status: "blocked",
      reason,
      ...(lifecycleReason ? { lifecycleReason } : {}),
    })}\n`,
  );
  process.exitCode = 1;
}
