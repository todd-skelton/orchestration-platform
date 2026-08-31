import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "..");
const temporaryRoots: string[] = [];
const stages = ["contracts", "format:check", "typecheck", "test", "build", "planning:check"];
const outputs = Object.fromEntries(
  stages.map((stage) => [
    stage,
    {
      stdout: `stdout:${stage}\n${stage === "test" ? "synthetic stdout line\n".repeat(4096) : ""}stdout:${stage}:tail\n`,
      stderr: `stderr:${stage}\n${stage === "test" ? "synthetic stderr line\n".repeat(4096) : ""}stderr:${stage}:tail\n`,
    },
  ]),
);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(fail: boolean) {
  const temporary = await realpath(await mkdtemp(resolve(tmpdir(), "op-bootstrap-output-")));
  temporaryRoots.push(temporary);
  const repository = resolve(temporary, "repository");
  const ledger = resolve(temporary, "commands.log");
  const launcher = resolve(repository, "scripts/synthetic-pnpm.mjs");
  const fatalError = resolve(temporary, "fatal-error.json");
  const monitor = resolve(temporary, "observe-fatal.mjs");
  await mkdir(resolve(repository, "scripts/verify"), { recursive: true });
  // Exercise the production wrapper and launcher unchanged, with real synthetic children.
  for (const file of ["scripts/verify/bootstrap.mjs", "scripts/pnpm-launcher.mjs"]) {
    await copyFile(resolve(sourceRoot, file), resolve(repository, file));
  }
  const child = `
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
assert.equal(process.cwd(), ${JSON.stringify(repository)});
const args = process.argv.slice(2);
const stage = args.length === 0 ? "contracts" : args[1];
assert.deepEqual(args, stage === "contracts" ? [] : ["run", stage]);
const output = ${JSON.stringify(outputs)}[stage];
assert.ok(output);
appendFileSync(${JSON.stringify(ledger)}, stage + "\\n");
process.stdout.write(output.stdout);
process.stderr.write(output.stderr);
process.exitCode = ${fail} && stage === "test" ? 23 : 0;
`;
  await writeFile(launcher, child);
  await writeFile(resolve(repository, "scripts/verify/bootstrap-contracts.mjs"), child);
  // Observe the original error without handling it or relying on fatal-error rendering.
  await writeFile(
    monitor,
    `import { writeFileSync } from "node:fs";
process.on("uncaughtExceptionMonitor", (error) => {
  const { code, signal, cmd, stdout, stderr } = error;
  writeFileSync(${JSON.stringify(fatalError)}, JSON.stringify({ code, signal, cmd, stdout, stderr }), { flag: "wx" });
});
`,
  );
  const initialized = spawnSync("git", ["init", "--quiet", repository], {
    encoding: "utf8",
    windowsHide: true,
  });
  expect(initialized.error).toBeUndefined();
  expect(initialized.status).toBe(0);
  return { temporary, repository, ledger, launcher, fatalError, monitor };
}

describe("bootstrap child output", () => {
  test.each([false, true])("preserves complete streams with failing child=%s", async (fail) => {
    const { temporary, repository, ledger, launcher, fatalError, monitor } = await fixture(fail);
    // Windows selects the first case-insensitive key; remove inherited aliases before overriding.
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_execpath"),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(monitor).href,
        resolve(repository, "scripts/verify/bootstrap.mjs"),
      ],
      {
        // The wrapper must choose its own repository cwd, not inherit this directory.
        cwd: temporary,
        env: { ...environment, npm_execpath: launcher },
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(fail ? 1 : 0);
    const executed = fail ? stages.slice(0, 4) : stages;
    expect(await readFile(ledger, "utf8"), result.stderr).toBe(executed.join("\n") + "\n");
    const stdout = executed.map((stage) => outputs[stage]!.stdout).join("");
    const stderr = executed.map((stage) => outputs[stage]!.stderr).join("");
    expect(result.stdout).toBe(
      stdout +
        (fail ? "" : "complete bootstrap suite verified without source-tree status changes\n"),
    );
    if (fail) {
      // Both raw streams exceed Node's error-inspection limit and typical pipe capacity.
      expect(outputs.test!.stdout.length).toBeGreaterThan(65_536);
      expect(outputs.test!.stderr.length).toBeGreaterThan(65_536);
      expect(result.stderr.slice(0, stderr.length)).toBe(stderr);
      // The original error remains diagnostic output after the complete raw stderr.
      const diagnostic = result.stderr.slice(stderr.length);
      expect(diagnostic).toContain(`Command failed: ${process.execPath} ${launcher} run test`);
      expect(JSON.parse(await readFile(fatalError, "utf8"))).toEqual({
        code: 23,
        signal: null,
        cmd: `${process.execPath} ${launcher} run test`,
        stdout: outputs.test!.stdout,
        stderr: outputs.test!.stderr,
      });
    } else {
      expect(result.stderr).toBe(stderr);
      await expect(readFile(fatalError, "utf8")).rejects.toHaveProperty("code", "ENOENT");
    }
  });
});
