import { writeFileSync } from "node:fs";
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
import { loadRepositoryAdapter } from "./repository-adapter.mjs";

let active;
let config;
let loop;
let validatedExecutor;
let repositoryAdapter;
let queueAdapter;
let supervisor;

function blocked(error, lifecycleReason) {
  const reason = error instanceof QueueBlocked ? error.reason : "queue-internal-error";
  writeFileSync(
    process.stderr.fd,
    `${JSON.stringify({
      status: "blocked",
      reason,
      ...(lifecycleReason ? { lifecycleReason } : {}),
    })}\n`,
  );
  process.exitCode = 1;
}

async function stop(error) {
  const reason = error instanceof QueueBlocked ? error.reason : "queue-internal-error";
  const diagnostics = error instanceof QueueBlocked ? error.diagnostics : undefined;
  if (!active || !loop) return { reason };
  const attempts = config ? await currentCandidateAttempt(config) : 0;
  try {
    const history = queueAdapter ? await queueAdapter.history() : active.initialHistory;
    const scope = await stopCycle(
      loop,
      { ...active, initialHistory: history },
      reason,
      attempts,
      supervisor,
      repositoryAdapter,
      diagnostics,
    );
    return { reason, scope };
  } catch (stopError) {
    return {
      reason,
      lifecycleReason:
        stopError instanceof QueueBlocked ? stopError.reason : "learning-note-state-unknown",
    };
  }
}

try {
  if (process.argv.length !== 3) throw new QueueBlocked("usage");
  const executingRoot = await realpath(resolve(import.meta.dirname, "../.."));
  loop = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
  validateLoopConfig(loop);
  repositoryAdapter = await loadRepositoryAdapter(loop.adapter, executingRoot);
  process.env.PATH = `${dirname(loop.gitExecutable)}${delimiter}${process.env.PATH ?? ""}`;
  supervisor = repositorySupervisionAdapter();
  for (;;) {
    try {
      if (!active) {
        active = await nextCycle(loop, executingRoot, supervisor, repositoryAdapter);
        if (!active) {
          process.stdout.write(`${JSON.stringify({ status: "idle", run: loop.run })}\n`);
          break;
        }
        await persistCycle(loop, active);
        validatedExecutor = await validateLoopExecutor(loop, executingRoot);
        const pending = await reconcilePendingStop(loop, active, supervisor, repositoryAdapter);
        if (pending?.scope === "run") {
          blocked(new QueueBlocked(pending.reason));
          break;
        }
        if (pending?.scope === "item") {
          active = undefined;
          validatedExecutor = undefined;
          continue;
        }
      }
      config = await queueConfigFromLoop(
        loop,
        executingRoot,
        {
          key: active.selection.key,
          number: active.selection.number,
          base: active.selection.base,
        },
        repositoryAdapter,
        active.initialHistory,
        validatedExecutor,
      );
      queueAdapter = repositoryQueueAdapter(config, executingRoot, {
        gitExecutable: loop.gitExecutable,
        repository: repositoryAdapter,
      });
      const started = await startCycle(loop, active, supervisor);
      if (started.status === "closed" && !(await hasStartedDelivery(config)))
        throw new QueueBlocked("closed-issue-without-delivery");
      const result = await queueStep(config, queueAdapter);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status === "advancing-attempt") continue;
      if (result.status.startsWith("observing-")) {
        await new Promise((done) => setTimeout(done, 10_000));
        continue;
      }
      await completeCycle(loop, active, await queueAdapter.history(), supervisor);
      active = undefined;
      config = undefined;
      queueAdapter = undefined;
      validatedExecutor = undefined;
    } catch (error) {
      const outcome = await stop(error);
      if (outcome.scope === "item") {
        active = undefined;
        config = undefined;
        queueAdapter = undefined;
        validatedExecutor = undefined;
        continue;
      }
      blocked(error, outcome.lifecycleReason);
      break;
    }
  }
} catch (error) {
  const outcome = await stop(error);
  blocked(error, outcome.lifecycleReason);
}
