import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  evaluatePortablePrimitiveParserEquivalence,
  executePortablePrimitiveParserEquivalenceProbeInTemporaryParent,
  normalizePortablePrimitiveParserCorpus,
  observePortablePrimitiveParserChild,
  type PortablePrimitiveParserChildProvider,
  type PortablePrimitiveParserDeadlineFactory,
} from "../../probes/portable-primitives/src/parser-equivalence.js";
import type { ContractRecord } from "../../packages/contracts/src/index.js";
import * as portable from "../../probes/portable-primitives/src/index.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function manualDeadlines(): {
  readonly create: PortablePrimitiveParserDeadlineFactory;
  fire(ms: number): Promise<void>;
} {
  const waiting = new Map<number, { cancelled: boolean; elapsed: () => void }[]>();
  return {
    create(milliseconds) {
      let elapsed!: () => void;
      const item = { cancelled: false, elapsed: () => elapsed() };
      const promise = new Promise<void>((accept) => (elapsed = accept));
      waiting.set(milliseconds, [...(waiting.get(milliseconds) ?? []), item]);
      return { cancel: () => (item.cancelled = true), elapsed: promise };
    },
    async fire(milliseconds) {
      let item = waiting.get(milliseconds)?.find((candidate) => !candidate.cancelled);
      for (let attempt = 0; !item && attempt < 10; attempt += 1) {
        await Promise.resolve();
        item = waiting.get(milliseconds)?.find((candidate) => !candidate.cancelled);
      }
      if (!item) throw new Error(`deadline:${milliseconds}:missing`);
      item.elapsed();
    },
  };
}

function fakeChild() {
  let close: (code: number | null, signal: NodeJS.Signals | null) => void = () => undefined;
  let error: () => void = () => undefined;
  let exit: (code: number | null, signal: NodeJS.Signals | null) => void = () => undefined;
  let message: (value: unknown) => void = () => undefined;
  let stderr: (chunk: Uint8Array) => void = () => undefined;
  const state = { signalCalls: 0, signalResult: true };
  const provider: PortablePrimitiveParserChildProvider = {
    onClose: (listener) => (close = listener),
    onError: (listener) => (error = listener),
    onExit: (listener) => (exit = listener),
    onMessage: (listener) => (message = listener),
    onStderr: (listener) => (stderr = listener),
    send: (_request: ContractRecord) => undefined,
    signal: () => ++state.signalCalls > 0 && state.signalResult,
  };
  return {
    provider,
    state,
    close: (code: number | null, signal: NodeJS.Signals | null) => close(code, signal),
    error: () => error(),
    exit: (code: number | null, signal: NodeJS.Signals | null) => exit(code, signal),
    message: (value: unknown) => message(value),
    stderr: (bytes: number) => stderr(new Uint8Array(bytes)),
  };
}

function normalizedFixture(): { readonly bytes: Uint8Array; readonly response: ContractRecord } {
  const bytes = normalizePortablePrimitiveParserCorpus(portable.portablePrimitiveParserCorpus);
  return Object.freeze({
    bytes,
    response: Object.freeze({
      normalizedBytesBase64url: Buffer.from(bytes).toString("base64url"),
      schemaVersion: "portable-primitives-parser-child-response/v1",
    }),
  });
}

describe("ISS-022 stable parser equivalence probe", () => {
  test("pins one canonical and seven hostile ISS-002 byte cases", () => {
    expect(portable.portablePrimitiveParserCorpus.map((row) => row.caseId)).toEqual([
      "CANONICAL",
      "MISSING_FINAL_LF",
      "NONCANONICAL_KEY_ORDER",
      "UTF8_BOM",
      "INVALID_UTF8",
      "INVALID_JSON",
      "UNKNOWN_FIELD",
      "SCHEMA_MISMATCH",
    ]);
    const normalized = JSON.parse(
      new TextDecoder().decode(
        normalizePortablePrimitiveParserCorpus(portable.portablePrimitiveParserCorpus),
      ),
    ) as { results: readonly { caseId: string; issues: readonly string[]; result: string }[] };
    expect(normalized.results.map(({ caseId, result }) => ({ caseId, result }))).toEqual([
      { caseId: "CANONICAL", result: "READABLE" },
      { caseId: "MISSING_FINAL_LF", result: "REFUSED" },
      { caseId: "NONCANONICAL_KEY_ORDER", result: "REFUSED" },
      { caseId: "UTF8_BOM", result: "REFUSED" },
      { caseId: "INVALID_UTF8", result: "REFUSED" },
      { caseId: "INVALID_JSON", result: "REFUSED" },
      { caseId: "UNKNOWN_FIELD", result: "REFUSED" },
      { caseId: "SCHEMA_MISMATCH", result: "REFUSED" },
    ]);
    expect(normalized.results.map((row) => row.issues)).toEqual([
      [],
      ["encoding:noncanonical"],
      ["encoding:noncanonical"],
      ["encoding:bom-refused"],
      ["encoding:invalid-utf8"],
      ["encoding:invalid-json"],
      ["extra:unknown-field"],
      ["schemaVersion:mismatch"],
    ]);
  });

  test("runs the same exact corpus in the parent and three fresh children", async () => {
    const result = await portable.executePortablePrimitiveParserEquivalenceProbe(repositoryRoot);
    expect(result.caseId).toBe("PARSER_EQUIVALENCE");
    expect(result.childCount).toBe("3");
    expect(result.children).toHaveLength(3);
    expect(result.resultsMatch).toBe(true);
    expect(result.children.every((child) => child.outputAccepted)).toBe(true);
    expect(result.children.every((child) => child.normalizedBytesMatch)).toBe(true);
    expect(result.children.map((child) => child.normalizedDigest)).toEqual(
      Array(3).fill(result.parentNormalizedDigest),
    );
    const accepted = result.children[0]!;
    expect(
      evaluatePortablePrimitiveParserEquivalence(result.parentNormalizedDigest, [
        accepted,
        accepted,
      ]).resultsMatch,
    ).toBe(false);
    expect(
      evaluatePortablePrimitiveParserEquivalence(result.parentNormalizedDigest, [
        accepted,
        accepted,
        { ...accepted, normalizedBytesMatch: false },
      ]).resultsMatch,
    ).toBe(false);
    expect(JSON.stringify(result)).not.toContain(repositoryRoot);
    expect(JSON.stringify(result)).not.toMatch(/"pid"|"PASS"/);
  }, 60_000);

  test("refuses corpus movement", () => {
    expect(() =>
      normalizePortablePrimitiveParserCorpus([
        ...portable.portablePrimitiveParserCorpus.slice(0, -1),
      ]),
    ).toThrow("parserCorpus:census");
    expect(() =>
      normalizePortablePrimitiveParserCorpus([
        { ...portable.portablePrimitiveParserCorpus[0], bytesBase64url: "e30K" },
        ...portable.portablePrimitiveParserCorpus.slice(1),
      ]),
    ).toThrow("parserCorpus:literal-row-mismatch");
  });

  test("latches timeout and stderr overflow before a code-zero terminal race", async () => {
    const fixture = normalizedFixture();
    for (const failure of ["TIMEOUT", "STDERR"] as const) {
      const child = fakeChild();
      const clock = manualDeadlines();
      const pending = observePortablePrimitiveParserChild(
        child.provider,
        fixture.bytes,
        clock.create,
      );
      child.message(fixture.response);
      if (failure === "TIMEOUT") await clock.fire(10_000);
      else child.stderr(64 * 1024 + 1);
      child.exit(0, null);
      child.close(0, null);
      const observation = await pending;
      expect(observation.outputAccepted).toBe(false);
      expect(observation.terminalEventsMatch).toBe(true);
      expect(observation.timedOut).toBe(failure === "TIMEOUT");
      expect(observation.stderrOverflow).toBe(failure === "STDERR");
      expect(child.state.signalCalls).toBe(1);
    }
  });

  test("bounds missing close and records kill refusal without hanging", async () => {
    const fixture = normalizedFixture();
    const child = fakeChild();
    child.state.signalResult = false;
    const clock = manualDeadlines();
    const pending = observePortablePrimitiveParserChild(
      child.provider,
      fixture.bytes,
      clock.create,
    );
    child.message(fixture.response);
    await clock.fire(10_000);
    child.exit(0, null);
    await clock.fire(1_000);
    const observation = await pending;
    expect(observation).toMatchObject({
      closeEventCount: 0,
      exitCode: 0,
      exitEventCount: 1,
      killRefused: true,
      outputAccepted: false,
      postSignalDeadlineExpired: true,
      terminalEventsMatch: false,
      timedOut: true,
    });
  });

  test("refuses duplicate and mismatched provider terminal tuples", async () => {
    const fixture = normalizedFixture();
    const duplicate = fakeChild();
    const duplicatePending = observePortablePrimitiveParserChild(
      duplicate.provider,
      fixture.bytes,
      manualDeadlines().create,
    );
    duplicate.message(fixture.response);
    duplicate.exit(0, null);
    duplicate.exit(0, null);
    duplicate.close(0, null);
    await expect(duplicatePending).resolves.toMatchObject({
      exitEventCount: 2,
      outputAccepted: false,
      terminalEventsMatch: false,
    });

    const mismatched = fakeChild();
    const mismatchPending = observePortablePrimitiveParserChild(
      mismatched.provider,
      fixture.bytes,
      manualDeadlines().create,
    );
    mismatched.message(fixture.response);
    mismatched.exit(0, null);
    mismatched.close(1, null);
    await expect(mismatchPending).resolves.toMatchObject({
      closeCode: 1,
      exitCode: 0,
      outputAccepted: false,
      terminalEventsMatch: false,
    });
  });

  test("deletes the temporary child bundle after all fresh children close", async () => {
    const temporaryParent = await mkdtemp(resolve(tmpdir(), "parser-probe-cleanup-test-"));
    try {
      const result = await executePortablePrimitiveParserEquivalenceProbeInTemporaryParent(
        repositoryRoot,
        temporaryParent,
      );
      expect(result.resultsMatch).toBe(true);
      expect(await readdir(temporaryParent)).toEqual([]);
    } finally {
      await rm(temporaryParent, { force: true, recursive: true });
    }
  }, 60_000);
});
