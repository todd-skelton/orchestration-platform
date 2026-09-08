import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { codexAdapter } from "./dispatch-adapter.ts";
import { reviewedRepairAdapter } from "./repair-adapter.mjs";
import { assertRepairRequest, repairStep } from "./repair.mjs";
import { RepairBlocked, repairPolicy } from "./repair-policy.mjs";

try {
  if (process.argv.length !== 3) throw new RepairBlocked("usage");
  const request = resolve(process.argv[2]);
  const config = JSON.parse(await readFile(request, "utf8"));
  await assertRepairRequest(config, request);
  const adapter = reviewedRepairAdapter(codexAdapter());
  const policy = repairPolicy();
  for (;;) {
    const result = await repairStep(config, adapter, policy);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.status.startsWith("observing-")) break;
    await new Promise((done) => setTimeout(done, 10_000));
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: "blocked",
      reason: error instanceof RepairBlocked ? error.reason : "repair-internal-error",
    })}\n`,
  );
  process.exitCode = 1;
}
