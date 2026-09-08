import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gitSetupAdapter } from "./setup-adapter.mjs";
import { SetupBlocked, assertSetupRequest, setupStep } from "./setup.mjs";

try {
  if (process.argv.length !== 3) throw new SetupBlocked("usage");
  const request = resolve(process.argv[2]);
  const config = JSON.parse(await readFile(request, "utf8"));
  await assertSetupRequest(config, request);
  const result = await setupStep(config, gitSetupAdapter());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "ready") process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: "blocked",
      reason: error instanceof SetupBlocked ? error.reason : "setup-internal-error",
    })}\n`,
  );
  process.exitCode = 1;
}
