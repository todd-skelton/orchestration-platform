import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { regularCapabilitySlot } from "./capability-slots.mjs";

const [issue, capability, ...forwardedArguments] = process.argv.slice(2);

if (!/^ISS-\d{3}$/.test(issue ?? "") || !capability) {
  process.stderr.write("invalid CAPABILITY_NOT_IMPLEMENTED placeholder declaration\n");
  process.exit(70);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slot = await regularCapabilitySlot(repositoryRoot, issue, capability);
if (slot) {
  const child = spawn(process.execPath, [slot, ...forwardedArguments], {
    cwd: repositoryRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", (error) => {
    throw error;
  });
  const [code, signal] = await new Promise((resolveClose) =>
    child.once("close", (...result) => resolveClose(result)),
  );
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
}

process.stderr.write(
  `${JSON.stringify({
    schemaVersion: "orchestration-capability-result/v1",
    outcome: "CAPABILITY_NOT_IMPLEMENTED",
    capability,
    owner: issue,
    forwardedArguments,
  })}\n`,
);
process.exit(5);
