import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { canonicalJson, type ContractRecord } from "../../packages/contracts/src/index.js";
import {
  normalizeIss022LockProbe,
  runIss022LockStableHandler,
} from "../../packages/conformance/src/index.js";
import type {
  PortablePrimitiveChildExecution,
  PortablePrimitiveLockHolderDeathRawFacts,
  PortablePrimitiveLockNonInheritanceRawFacts,
} from "../../probes/portable-primitives/src/index.js";

const roots: string[] = [];

async function custodyRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-iss022-lock-"));
  roots.push(root);
  return root;
}

function event(
  mode: "LOCK_ATTEMPT" | "LOCK_HOLDER",
  name: "ACQUIRED" | "ERROR",
  errorCode: string | null = null,
): ContractRecord {
  return {
    barrier: null,
    errorCode,
    event: name,
    headPlusOneCode: null,
    headPlusTwoCode: null,
    mode,
    readbackHex: null,
    schemaVersion: "portable-primitives-raw-child-event/v1",
  };
}

function child(
  childEvent: ContractRecord | null = event("LOCK_ATTEMPT", "ERROR", "EEXIST"),
  mutation: Partial<PortablePrimitiveChildExecution> = {},
): PortablePrimitiveChildExecution {
  return {
    event: childEvent,
    exitCode: 0,
    outputLimitExceeded: false,
    signal: null,
    stderr: "",
    stdout: childEvent === null ? "" : canonicalJson(childEvent),
    timedOut: false,
    ...mutation,
  };
}

function descriptorEvent(
  accessResult: "ACCESSED" | "REFUSED" = "REFUSED",
  errorCode: string | null = "EBADF",
  readbackHex: string | null = null,
): ContractRecord {
  return {
    accessResult,
    errorCode,
    readbackHex,
    schemaVersion: "portable-primitives-lock-descriptor-child-event/v1",
  };
}

function rows() {
  const holderEvent = event("LOCK_HOLDER", "ACQUIRED");
  const probeNonceHex = "ab".repeat(32);
  return [
    {
      caseId: "LOCK_TWO_UNRELATED_PROCESSES",
      contender: child(),
      holderCloseObserved: true,
      holderEvent,
      schemaVersion: "portable-primitives-lock-contention-raw/v1",
    },
    {
      acquisitionAttemptCount: "1",
      caseId: "LOCK_HOLDER_DEATH",
      holderCloseObserved: true,
      holderEvent,
      postDeathAttempt: child(),
      prohibitedActions: [],
      schemaVersion: "portable-primitives-lock-holder-death-raw/v1",
    },
    {
      caseId: "LOCK_DEFAULT_NON_INHERITANCE",
      child: child(descriptorEvent()),
      parentReadbackHex: probeNonceHex,
      probeNonceHex,
      schemaVersion: "portable-primitives-lock-non-inheritance-raw/v1",
    },
  ] as const;
}

function mutate(input: readonly unknown[], index: number, fields: Record<string, unknown>) {
  const mutant = [...input];
  mutant[index] = { ...(mutant[index] as object), ...fields };
  return mutant;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("stable ISS-022 lock handler", () => {
  test("executes the exact provider-owned three-row lock census", async () => {
    const result = await runIss022LockStableHandler(await custodyRoot());
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(
      result.vectorExecutions.map(({ caseId, normalizedResult }) => ({
        caseId,
        normalizedResult,
      })),
    ).toEqual([
      { caseId: "LOCK_TWO_UNRELATED_PROCESSES", normalizedResult: "PASS" },
      { caseId: "LOCK_HOLDER_DEATH", normalizedResult: "UNSUPPORTED" },
      { caseId: "LOCK_DEFAULT_NON_INHERITANCE", normalizedResult: "PASS" },
    ]);
    const death = result.vectorExecutions[1]!.rawFacts as PortablePrimitiveLockHolderDeathRawFacts;
    expect(death).toMatchObject({
      acquisitionAttemptCount: "1",
      holderCloseObserved: true,
      prohibitedActions: [],
    });
    const inheritance = result.vectorExecutions[2]!
      .rawFacts as PortablePrimitiveLockNonInheritanceRawFacts;
    expect(inheritance.parentReadbackHex).toBe(inheritance.probeNonceHex);
    expect(inheritance.child.event).toMatchObject({ accessResult: "REFUSED", errorCode: "EBADF" });
    expect(
      result.vectorExecutions.every(({ rawFacts }) => !JSON.stringify(rawFacts).includes("PASS")),
    ).toBe(true);
  }, 30_000);

  test("snapshots the complete closed census before disposition", () => {
    const base = rows();
    const mutableContender = { ...base[0].contender };
    const input = [{ ...base[0], contender: mutableContender }, base[1], base[2]];
    const result = normalizeIss022LockProbe(input);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions[0]!.rawFacts).not.toBe(input[0]);
    mutableContender.stdout = "PASS\n";
    expect(result.vectorExecutions.map(({ normalizedResult }) => normalizedResult)).toEqual([
      "PASS",
      "UNSUPPORTED",
      "PASS",
    ]);
  });

  test("refuses malformed, expanded, proxied, reordered, and typed rows", () => {
    const input = rows();
    const accessor = { ...input[0] };
    Object.defineProperty(accessor, "holderCloseObserved", { enumerable: true, get: () => true });
    const actionAccessor = ["DELETE"];
    Object.defineProperty(actionAccessor, "0", { enumerable: true, get: () => "DELETE" });
    for (const mutant of [
      input.slice(0, -1),
      [...input, input[2]],
      [input[1], input[0], input[2]],
      new Proxy([...input], {}),
      [new Proxy(input[0], {}), ...input.slice(1)],
      [accessor, input[1], input[2]],
      mutate(input, 0, { extra: true }),
      mutate(input, 0, { holderCloseObserved: "true" }),
      mutate(input, 1, { acquisitionAttemptCount: "2" }),
      mutate(input, 1, { prohibitedActions: ["DELETE", "DELETE"] }),
      mutate(input, 1, { prohibitedActions: ["UNKNOWN"] }),
      mutate(input, 1, { prohibitedActions: new Proxy(["DELETE"], {}) }),
      mutate(input, 1, { prohibitedActions: actionAccessor }),
      mutate(input, 1, { prohibitedActions: "DELETE" }),
      mutate(input, 2, { parentReadbackHex: "ab" }),
    ])
      expect(normalizeIss022LockProbe(mutant).ok).toBe(false);
  });

  test("requires exact holder, terminal, contention, and no-transfer facts", () => {
    const input = rows();
    const mutants: unknown[] = [
      mutate(input, 0, { holderCloseObserved: false }),
      mutate(input, 0, { holderEvent: event("LOCK_HOLDER", "ERROR", "EIO") }),
      mutate(input, 0, { contender: child(null, { timedOut: true }) }),
      mutate(input, 0, { contender: child(event("LOCK_ATTEMPT", "ERROR", "EIO")) }),
      mutate(input, 1, { acquisitionAttemptCount: "0" }),
      mutate(input, 1, { postDeathAttempt: child(null, { outputLimitExceeded: true }) }),
      ...["DELETE", "RETRY", "PID", "AGE", "LEASE", "STALE_OWNER_INFERENCE"].map((action) =>
        mutate(input, 1, { prohibitedActions: [action] }),
      ),
      mutate(input, 2, { parentReadbackHex: "cd".repeat(32) }),
      mutate(input, 2, { child: child(null) }),
      mutate(input, 2, { child: child(null, { stdout: "REFUSED\n" }) }),
      mutate(input, 2, { child: child(null, { signal: "SIGKILL" }) }),
      mutate(input, 2, {
        child: child(descriptorEvent("ACCESSED", null, input[2].probeNonceHex)),
      }),
      mutate(input, 2, { child: child(descriptorEvent("ACCESSED", null, "ef".repeat(32))) }),
      mutate(input, 2, { child: child(descriptorEvent("REFUSED", "EIO")) }),
    ];
    for (const mutant of mutants) {
      const result = normalizeIss022LockProbe(mutant);
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(
        result.vectorExecutions.some(({ normalizedResult }) => normalizedResult === "UNKNOWN"),
      ).toBe(true);
    }
  });

  test("admits only coherent exact unsupported operations", () => {
    const input = rows();
    const unsupported = child(event("LOCK_ATTEMPT", "ERROR", "EPERM"));
    const result = normalizeIss022LockProbe([
      { ...input[0], contender: unsupported },
      { ...input[1], postDeathAttempt: unsupported },
      { ...input[2], child: child(descriptorEvent("REFUSED", "EPERM")) },
    ]);
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.vectorExecutions.map(({ normalizedResult }) => normalizedResult)).toEqual([
      "UNSUPPORTED",
      "UNSUPPORTED",
      "UNSUPPORTED",
    ]);
  });
});
