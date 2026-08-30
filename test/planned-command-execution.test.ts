import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  loadPlanningSnapshot,
  verificationCommands,
  type PlanningSnapshot,
} from "../scripts/planning/check.mjs";
import { resolvePnpmLauncher } from "../scripts/pnpm-launcher.mjs";
import { regularCapabilitySlot } from "../scripts/capability-slots.mjs";

const root = resolve(import.meta.dirname, "..");
const placeholder = resolve(root, "scripts/capability-not-implemented.mjs");
let snapshot: PlanningSnapshot;
let pnpmLauncher: Awaited<ReturnType<typeof resolvePnpmLauncher>>;

beforeAll(async () => {
  snapshot = await loadPlanningSnapshot();
  pnpmLauncher = await resolvePnpmLauncher();
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

  test("every unimplemented planned wrapper emits its fixed owner and forwarded argv", async () => {
    let executed = 0;
    let implemented = 0;
    let declared = 0;
    for (const [issue, source] of Object.entries(snapshot.issueDrafts)) {
      if (issue === "ISS-000") continue;
      for (const command of verificationCommands(source)) {
        const rootCommand = command.match(/^pnpm run ([a-z0-9:-]+)/);
        const filteredCommand = command.match(/^pnpm --filter (\S+) (\S+)/);
        const capability =
          rootCommand?.[1] ??
          (filteredCommand ? `${filteredCommand[1]}:${filteredCommand[2]}` : undefined);
        if (!capability) continue;
        declared += 1;
        if (
          (issue === "ISS-002" &&
            [
              "pnpm --filter @orchestration-platform/contracts test",
              "pnpm run contracts:compatibility-check",
            ].includes(command)) ||
          (issue === "ISS-003" &&
            command === "pnpm --filter @orchestration-platform/config test") ||
          (issue === "ISS-006" &&
            ["pnpm run harness:test", "pnpm run test:harness-workflow-mutations"].includes(command))
        ) {
          implemented += 1;
          continue;
        }
        if (await regularCapabilitySlot(root, issue, capability)) {
          implemented += 1;
          continue;
        }

        const forwardedTail = rootCommand ? command.slice(rootCommand[0].length).trim() : "";
        const forwardedArguments = forwardedTail ? forwardedTail.split(/\s+/) : [];
        const result = spawnSync(
          pnpmLauncher.executable,
          [...pnpmLauncher.prefixArgs, ...command.split(/\s+/).slice(1)],
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
      }
    }
    expect(executed + implemented).toBe(declared);
  }, 600_000);
});
