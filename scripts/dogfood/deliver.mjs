import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertControllerExecutor, githubDeliveryAdapter } from "./delivery-adapter.mjs";
import { DeliveryBlocked, assertControllerRequest, deliveryStep } from "./delivery.mjs";
import { selfDeliveryPolicy } from "./self-delivery-policy.mjs";

try {
  if (process.argv.length !== 3) throw new DeliveryBlocked("usage");
  const request = resolve(process.argv[2]);
  const config = JSON.parse(await readFile(request, "utf8"));
  await assertControllerRequest(config, request);
  const adapter = githubDeliveryAdapter();
  await assertControllerExecutor(config, resolve(import.meta.dirname, "../.."));
  const policy = selfDeliveryPolicy();
  for (;;) {
    const result = await deliveryStep(config, adapter, policy);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "observing-hosted-checks") break;
    await new Promise((done) => setTimeout(done, 10000));
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: "blocked",
      reason: error instanceof DeliveryBlocked ? error.reason : "delivery-internal-error",
    })}\n`,
  );
  process.exitCode = 1;
}
