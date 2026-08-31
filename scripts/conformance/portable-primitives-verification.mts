import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
export const portablePrimitivesVerificationTests = Object.freeze({
  probe: Object.freeze([
    "test/portable-primitives",
    "test/conformance/iss022-handler.test.ts",
    "test/conformance/iss022-lock-handler.test.ts",
    "test/conformance/iss022-suite.test.ts",
  ]),
  receipts: Object.freeze([
    "test/conformance/contracts.test.ts",
    "test/conformance/iss022-profile.test.ts",
    "test/conformance/observation.test.ts",
    "test/conformance/portable-primitives-decision.test.ts",
    "test/conformance/portable-primitives-publication.test.ts",
    "test/conformance/portable-primitives-verification.test.ts",
    "test/conformance/github-artifacts.test.ts",
    "test/conformance/github-terminal.test.ts",
    "test/conformance/github-portable-primitives-review.test.ts",
    "test/conformance/hosted-observation.test.ts",
    "test/conformance/hosted-review-api.test.ts",
    "test/conformance/hosted-terminal-api.test.ts",
  ]),
});

async function executeTests(paths: readonly string[]): Promise<number> {
  const child = spawn(
    process.execPath,
    [resolve(root, "node_modules/vitest/vitest.mjs"), "run", ...paths],
    { cwd: root, env: process.env, stdio: "inherit", windowsHide: true },
  );
  return await new Promise<number>((accept) => {
    child.once("error", () => accept(1));
    child.once("close", (code, signal) => accept(signal === null && code === 0 ? 0 : 1));
  });
}

/** ISS-022's two zero-argument local verification wrappers; never publication. */
export async function runPortablePrimitivesVerification(
  arguments_: readonly string[],
  execute: (paths: readonly string[]) => Promise<number> = executeTests,
  write: (text: string) => unknown = (text) => process.stdout.write(text),
): Promise<0 | 1> {
  const mode = arguments_[0];
  if (arguments_.length !== 1 || (mode !== "probe" && mode !== "receipts")) {
    write("REFUSED: portable primitives verification accepts no user arguments\n");
    return 1;
  }
  write(
    "ADVISORY LOCAL VERIFICATION — test success grants no capability or publication authority\n",
  );
  try {
    return (await execute(portablePrimitivesVerificationTests[mode])) === 0 ? 0 : 1;
  } catch {
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await runPortablePrimitivesVerification(process.argv.slice(2));
