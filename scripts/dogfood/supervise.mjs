import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { repositoryQueueAdapter } from "./queue-adapter.ts";
import { assertQueueRequest, QueueBlocked, queueStep } from "./queue.ts";

try {
  if (process.argv.length !== 3) throw new QueueBlocked("usage");
  const request = resolve(process.argv[2]);
  const config = JSON.parse(await readFile(request, "utf8"));
  await assertQueueRequest(config, request);
  const adapter = repositoryQueueAdapter(config);
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
