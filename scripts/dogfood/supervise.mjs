import { readFile, realpath } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import {
  currentCandidateAttempt,
  queueConfigFromLoop,
  QueueBlocked,
  queueStep,
  repositoryQueueAdapter,
} from "./queue.ts";

let activeConfig;
try {
  if (process.argv.length !== 3) throw new QueueBlocked("usage");
  const executingRoot = await realpath(resolve(import.meta.dirname, "../.."));
  const loop = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
  process.env.PATH = `${dirname(loop.gitExecutable)}${delimiter}${process.env.PATH ?? ""}`;
  let config = await queueConfigFromLoop(loop, executingRoot);
  activeConfig = config;
  let adapter = repositoryQueueAdapter(config, executingRoot, {
    gitExecutable: loop.gitExecutable,
  });
  for (;;) {
    const result = await queueStep(config, adapter);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "advancing-attempt") {
      config = await queueConfigFromLoop(loop, executingRoot);
      activeConfig = config;
      adapter = repositoryQueueAdapter(config, executingRoot, {
        gitExecutable: loop.gitExecutable,
      });
      continue;
    }
    if (!result.status.startsWith("observing-")) break;
    await new Promise((done) => setTimeout(done, 10_000));
  }
} catch (error) {
  const reason = error instanceof QueueBlocked ? error.reason : "queue-internal-error";
  const transientStop =
    ["reviewer-retry-exhausted", "exit-receipt-timeout"].includes(reason) ||
    reason.startsWith("gate-retry-exhausted:");
  const attempts = activeConfig ? await currentCandidateAttempt(activeConfig) : undefined;
  process.stderr.write(
    `${JSON.stringify({
      status: "blocked",
      reason,
      ...(transientStop
        ? {
            attempts,
            learningNote: `The loop stopped on ${reason} during candidate ${attempts}. A person should inspect the recorded transient failure${error instanceof QueueBlocked && error.diagnostics ? `: ${error.diagnostics}` : ""} before retrying.`,
          }
        : {}),
    })}\n`,
  );
  process.exitCode = 1;
}
