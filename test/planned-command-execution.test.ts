import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  loadPlanningSnapshot,
  verificationCommands,
  type PlanningSnapshot,
} from "../scripts/planning/check.mjs";

const root = resolve(import.meta.dirname, "..");
const placeholder = resolve(root, "scripts/capability-not-implemented.mjs");
let snapshot: PlanningSnapshot;

function pnpmEntrypoint(): string[] {
  if (process.env.npm_execpath) return [process.env.npm_execpath];
  for (const candidate of [
    resolve(dirname(process.execPath), "node_modules/corepack/dist/corepack.js"),
    resolve(dirname(process.execPath), "../lib/node_modules/corepack/dist/corepack.js"),
  ]) {
    if (existsSync(candidate)) return [candidate, "pnpm"];
  }
  throw new Error("cannot locate pnpm entrypoint");
}

beforeAll(async () => {
  snapshot = await loadPlanningSnapshot();
});

describe("planned verification command execution census", () => {
  test("the generic placeholder preserves arbitrary argv and exits with the fixed status", () => {
    const result = spawnSync(
      process.execPath,
      [placeholder, "ISS-017", "shadow:preflight", "--", "--consumer", "first"],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    expect(result.status).toBe(5);
    expect(JSON.parse(result.stderr.trim())).toEqual({
      schemaVersion: "orchestration-capability-result/v1",
      outcome: "CAPABILITY_NOT_IMPLEMENTED",
      capability: "shadow:preflight",
      owner: "ISS-017",
      forwardedArguments: ["--", "--consumer", "first"],
    });
  });

  test("every unimplemented planned wrapper emits its fixed owner and forwarded argv", () => {
    let executed = 0;
    let argumentBearing = 0;
    for (const [issue, source] of Object.entries(snapshot.issueDrafts)) {
      if (issue === "ISS-000") continue;
      for (const command of verificationCommands(source)) {
        const rootCommand = command.match(/^pnpm run ([a-z0-9:-]+)/);
        const filteredCommand = command.match(/^pnpm --filter (\S+) (\S+)/);
        const capability =
          rootCommand?.[1] ??
          (filteredCommand ? `${filteredCommand[1]}:${filteredCommand[2]}` : undefined);
        if (!capability) continue;

        const forwardedTail = rootCommand ? command.slice(rootCommand[0].length).trim() : "";
        const forwardedArguments = forwardedTail ? forwardedTail.split(/\s+/) : [];
        const result = spawnSync(
          process.execPath,
          [...pnpmEntrypoint(), ...command.split(/\s+/).slice(1)],
          {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
          },
        );
        expect(result.status, command).not.toBe(0);
        const transcript = `${result.stdout}\n${result.stderr}`;
        const recordLine = transcript
          .split(/\r?\n/)
          .find((line) => line.startsWith('{"schemaVersion":"orchestration-capability-result/v1"'));
        expect(recordLine, command).toBeTruthy();
        const record = JSON.parse(recordLine!);
        expect(record, command).toEqual({
          schemaVersion: "orchestration-capability-result/v1",
          outcome: "CAPABILITY_NOT_IMPLEMENTED",
          capability,
          owner: issue,
          forwardedArguments,
        });
        executed += 1;
        if (forwardedArguments.length > 0) argumentBearing += 1;
      }
    }
    expect(executed).toBeGreaterThan(80);
    expect(argumentBearing).toBeGreaterThan(10);
  }, 120_000);
});
