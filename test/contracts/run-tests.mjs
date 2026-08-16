import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { resolvePnpmLauncher } from "../../scripts/pnpm-launcher.mjs";

const root = resolve(import.meta.dirname, "../..");

export async function runContractsTests(kind, forwardedArguments = []) {
  if (!["all", "compatibility"].includes(kind)) throw new Error("unknown contract test kind");
  const launcher = await resolvePnpmLauncher();
  const target = kind === "all" ? "test/contracts" : "test/contracts/compatibility.test.ts";
  const child = spawn(
    launcher.executable,
    [...launcher.prefixArgs, "exec", "vitest", "run", target, ...forwardedArguments],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  child.once("error", (error) => {
    throw error;
  });
  const [code, signal] = await new Promise((resolveClose) =>
    child.once("close", (...result) => resolveClose(result)),
  );
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
}
