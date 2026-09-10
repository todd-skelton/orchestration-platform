import { readFile, realpath } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { queueConfigFromLoop, QueueBlocked, queueStep, repositoryQueueAdapter } from "./queue.ts";

try {
  if (process.argv.length !== 3) throw new QueueBlocked("usage");
  const executingRoot = await realpath(resolve(import.meta.dirname, "../.."));
  const loop = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
  const config = await queueConfigFromLoop(loop, executingRoot);
  process.env.PATH = `${dirname(loop.gitExecutable)}${delimiter}${process.env.PATH ?? ""}`;
  const adapter = repositoryQueueAdapter(config, executingRoot, {
    gitExecutable: loop.gitExecutable,
  });
  for (;;) {
    const result = await queueStep(config, adapter);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.status.startsWith("observing-")) break;
    await new Promise((done) => setTimeout(done, 10_000));
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: "blocked",
      reason: error instanceof QueueBlocked ? error.reason : "queue-internal-error",
    })}\n`,
  );
  process.exitCode = 1;
}
