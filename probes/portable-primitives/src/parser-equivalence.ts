import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { setTimeout as nodeDelay } from "node:timers/promises";
import { build } from "esbuild";
import {
  canonicalBytes,
  canonicalJson,
  parseCanonicalContractBytes,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
} from "@orchestration-platform/contracts";

const parserCorpusFields = Object.freeze([
  "bytesBase64url",
  "caseId",
  "expectedSchemaVersion",
] as const);
const parserResultFields = Object.freeze([
  "caseId",
  "issues",
  "normalizedRecordBase64url",
  "result",
  "schemaVersion",
] as const);
const childResponseFields = Object.freeze(["normalizedBytesBase64url", "schemaVersion"] as const);
const base64url = /^(?:[A-Za-z0-9_-]{2,4})+$/;

const validConfiguration = Object.freeze({
  adapterId: "portable.parser",
  capabilityNames: Object.freeze(["canonical", "hostile"]),
  leaseFreshnessMs: 1_000,
  maximumSessionMs: 10_000,
  projectId: "018f0c72-9f62-7cc5-8000-000000000022",
  schemaVersion: "platform-configuration/v1",
  stateRoot: "file:///portable-primitives",
  wallClockSkewMs: 0,
});
const canonicalConfigurationBytes = canonicalBytes(validConfiguration);
const encoder = new TextEncoder();

function encoded(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function corpusRow(caseId: string, bytes: Uint8Array): ContractRecord {
  return Object.freeze({
    bytesBase64url: encoded(bytes),
    caseId,
    expectedSchemaVersion: "platform-configuration/v1",
  });
}

export const portablePrimitiveParserCorpus = Object.freeze([
  corpusRow("CANONICAL", canonicalConfigurationBytes),
  corpusRow("MISSING_FINAL_LF", canonicalConfigurationBytes.subarray(0, -1)),
  corpusRow(
    "NONCANONICAL_KEY_ORDER",
    encoder.encode(
      `${JSON.stringify({
        schemaVersion: validConfiguration.schemaVersion,
        adapterId: validConfiguration.adapterId,
        capabilityNames: validConfiguration.capabilityNames,
        leaseFreshnessMs: validConfiguration.leaseFreshnessMs,
        maximumSessionMs: validConfiguration.maximumSessionMs,
        projectId: validConfiguration.projectId,
        stateRoot: validConfiguration.stateRoot,
        wallClockSkewMs: validConfiguration.wallClockSkewMs,
      })}\n`,
    ),
  ),
  corpusRow("UTF8_BOM", Uint8Array.from([0xef, 0xbb, 0xbf, ...canonicalConfigurationBytes])),
  corpusRow("INVALID_UTF8", Uint8Array.from([0xff])),
  corpusRow("INVALID_JSON", encoder.encode("{\n")),
  corpusRow("UNKNOWN_FIELD", canonicalBytes({ ...validConfiguration, extra: true })),
  corpusRow(
    "SCHEMA_MISMATCH",
    canonicalBytes({ ...validConfiguration, schemaVersion: "platform-configuration/v999" }),
  ),
]);

function decodeBase64url(value: JsonValue | undefined): Uint8Array | null {
  if (typeof value !== "string" || !base64url.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
}

export function normalizePortablePrimitiveParserCorpus(input: unknown): Uint8Array {
  const corpus = snapshotClosedArray(input);
  if (!corpus.ok || corpus.value.length !== portablePrimitiveParserCorpus.length)
    throw new TypeError("parserCorpus:census");
  const results: ContractRecord[] = [];
  for (let index = 0; index < corpus.value.length; index += 1) {
    const parsedRow = snapshotClosedRecord(corpus.value[index], parserCorpusFields);
    if (!parsedRow.ok) throw new TypeError("parserCorpus:row");
    const expectedRow = portablePrimitiveParserCorpus[index]!;
    if (canonicalJson(parsedRow.value) !== canonicalJson(expectedRow))
      throw new TypeError("parserCorpus:literal-row-mismatch");
    if (typeof parsedRow.value.caseId !== "string") throw new TypeError("parserCorpus:caseId");
    const bytes = decodeBase64url(parsedRow.value.bytesBase64url);
    if (bytes === null) throw new TypeError("parserCorpus:bytes");
    const parsed = parseCanonicalContractBytes(
      String(parsedRow.value.expectedSchemaVersion),
      bytes,
    );
    results.push(
      Object.freeze({
        caseId: parsedRow.value.caseId,
        issues: Object.freeze(parsed.ok ? [] : [...new Set(parsed.issues)].sort()),
        normalizedRecordBase64url: parsed.ok ? encoded(canonicalBytes(parsed.value)) : null,
        result: parsed.ok ? "READABLE" : "REFUSED",
        schemaVersion: "portable-primitives-parser-result/v1",
      }),
    );
  }
  return canonicalBytes(
    Object.freeze({
      results: Object.freeze(results),
      schemaVersion: "portable-primitives-parser-normalized/v1",
    }),
  );
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface PortablePrimitiveParserChildObservation {
  readonly closeCode: number | null;
  readonly closeEventCount: number;
  readonly closeSignal: NodeJS.Signals | null;
  readonly errorEventCount: number;
  readonly exitCode: number | null;
  readonly exitEventCount: number;
  readonly exitSignal: NodeJS.Signals | null;
  readonly killRefused: boolean;
  readonly messageCount: number;
  readonly normalizedBytesMatch: boolean;
  readonly normalizedDigest: string | null;
  readonly outputAccepted: boolean;
  readonly postSignalDeadlineExpired: boolean;
  readonly stderrOverflow: boolean;
  readonly terminalEventsMatch: boolean;
  readonly timedOut: boolean;
}

export interface PortablePrimitiveParserChildProvider {
  readonly onClose: (
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => void;
  readonly onError: (listener: () => void) => void;
  readonly onExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
  readonly onMessage: (listener: (message: unknown) => void) => void;
  readonly onStderr: (listener: (chunk: Uint8Array) => void) => void;
  readonly send: (message: ContractRecord) => void;
  readonly signal: () => boolean;
}

export interface PortablePrimitiveParserDeadline {
  readonly cancel: () => void;
  readonly elapsed: Promise<void>;
}
export type PortablePrimitiveParserDeadlineFactory = (
  milliseconds: number,
) => PortablePrimitiveParserDeadline;

export interface PortablePrimitiveParserEquivalenceRawFacts {
  readonly caseId: "PARSER_EQUIVALENCE";
  readonly childCount: "3";
  readonly children: readonly PortablePrimitiveParserChildObservation[];
  readonly parentNormalizedDigest: string;
  readonly resultsMatch: boolean;
  readonly schemaVersion: "portable-primitives-parser-equivalence-raw/v1";
}

function parseChildResponse(input: unknown): Uint8Array | null {
  const parsed = snapshotClosedRecord(input, childResponseFields);
  if (!parsed.ok || parsed.value.schemaVersion !== "portable-primitives-parser-child-response/v1")
    return null;
  const bytes = decodeBase64url(parsed.value.normalizedBytesBase64url);
  if (bytes === null) return null;
  try {
    const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const record = snapshotClosedRecord(decoded, ["results", "schemaVersion"]);
    if (!record.ok || record.value.schemaVersion !== "portable-primitives-parser-normalized/v1")
      return null;
    const results = snapshotClosedArray(record.value.results);
    if (!results.ok || results.value.length !== portablePrimitiveParserCorpus.length) return null;
    for (const result of results.value) {
      const row = snapshotClosedRecord(result, parserResultFields);
      if (!row.ok) return null;
    }
    return canonicalJson(record.value) === new TextDecoder().decode(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

const parserDeadline: PortablePrimitiveParserDeadlineFactory = (milliseconds) => {
  const cancellation = new AbortController();
  return Object.freeze({
    cancel: () => cancellation.abort(),
    elapsed: nodeDelay(milliseconds, undefined, { signal: cancellation.signal }).catch(
      (error: unknown) => {
        if (!(error instanceof Error) || error.name !== "AbortError") throw error;
      },
    ),
  });
};

export async function observePortablePrimitiveParserChild(
  provider: PortablePrimitiveParserChildProvider,
  parentNormalizedBytes: Uint8Array,
  deadline: PortablePrimitiveParserDeadlineFactory = parserDeadline,
): Promise<PortablePrimitiveParserChildObservation> {
  let closeCode: number | null = null;
  let closeEventCount = 0;
  let closeSignal: NodeJS.Signals | null = null;
  let errorEventCount = 0;
  let exitCode: number | null = null;
  let exitEventCount = 0;
  let exitSignal: NodeJS.Signals | null = null;
  let killRefused = false;
  let messageCount = 0;
  let postSignalDeadlineExpired = false;
  let response: Uint8Array | null = null;
  let stderrByteLength = 0;
  let stderrOverflow = false;
  let timedOut = false;
  let terminalQueued = false;
  let resolveTerminal!: () => void;
  let resolveFailure!: () => void;
  const terminal = new Promise<void>((accept) => (resolveTerminal = accept));
  const failure = new Promise<void>((accept) => (resolveFailure = accept));
  const maybeTerminal = () => {
    if (!terminalQueued && exitEventCount > 0 && closeEventCount > 0) {
      terminalQueued = true;
      queueMicrotask(resolveTerminal);
    }
  };
  provider.onMessage((message) => {
    messageCount += 1;
    response = messageCount === 1 ? parseChildResponse(message) : null;
  });
  provider.onStderr((chunk) => {
    stderrByteLength = Math.min(64 * 1024 + 1, stderrByteLength + chunk.byteLength);
    if (stderrByteLength > 64 * 1024 && !stderrOverflow) {
      stderrOverflow = true;
      resolveFailure();
    }
  });
  provider.onError(() => {
    errorEventCount += 1;
    resolveFailure();
  });
  provider.onExit((code, signal) => {
    exitEventCount += 1;
    if (exitEventCount === 1) [exitCode, exitSignal] = [code, signal];
    maybeTerminal();
  });
  provider.onClose((code, signal) => {
    closeEventCount += 1;
    if (closeEventCount === 1) [closeCode, closeSignal] = [code, signal];
    maybeTerminal();
  });
  try {
    provider.send(
      Object.freeze({
        corpus: portablePrimitiveParserCorpus,
        schemaVersion: "portable-primitives-parser-child-request/v1",
      }),
    );
  } catch {
    errorEventCount += 1;
    resolveFailure();
  }
  const executionDeadline = deadline(10_000);
  const first = await Promise.race([
    terminal.then(() => "TERMINAL" as const),
    failure.then(() => "FAILURE" as const),
    executionDeadline.elapsed.then(() => "TIMEOUT" as const),
  ]);
  executionDeadline.cancel();
  timedOut = first === "TIMEOUT";
  if (first !== "TERMINAL") {
    try {
      if (!provider.signal()) killRefused = true;
    } catch {
      killRefused = true;
    }
    const postSignalDeadline = deadline(1_000);
    postSignalDeadlineExpired = !(await Promise.race([
      terminal.then(() => true),
      postSignalDeadline.elapsed.then(() => false),
    ]));
    postSignalDeadline.cancel();
  }
  const terminalEventsMatch =
    errorEventCount === 0 &&
    exitEventCount === 1 &&
    closeEventCount === 1 &&
    exitCode === closeCode &&
    exitSignal === closeSignal;
  const accepted =
    terminalEventsMatch &&
    exitCode === 0 &&
    exitSignal === null &&
    messageCount === 1 &&
    response !== null &&
    !timedOut &&
    !stderrOverflow &&
    !killRefused &&
    !postSignalDeadlineExpired;
  return Object.freeze({
    closeCode,
    closeEventCount,
    closeSignal,
    errorEventCount,
    exitCode,
    exitEventCount,
    exitSignal,
    killRefused,
    messageCount,
    normalizedBytesMatch:
      accepted && Buffer.compare(Buffer.from(response!), Buffer.from(parentNormalizedBytes)) === 0,
    normalizedDigest: accepted ? digest(response!) : null,
    outputAccepted: accepted,
    postSignalDeadlineExpired,
    stderrOverflow,
    terminalEventsMatch,
    timedOut,
  });
}

async function executeChild(
  childPath: string,
  parentNormalizedBytes: Uint8Array,
): Promise<PortablePrimitiveParserChildObservation> {
  const child = spawn(process.execPath, [childPath], {
    cwd: dirname(process.execPath),
    env: Object.freeze({
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
    }),
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  const provider: PortablePrimitiveParserChildProvider = {
    onClose: (listener) => void child.on("close", listener),
    onError: (listener) => void child.on("error", listener),
    onExit: (listener) => void child.on("exit", listener),
    onMessage: (listener) => void child.on("message", listener),
    onStderr: (listener) => void child.stderr!.on("data", listener),
    send: (message) => void child.send(message),
    signal: () => child.kill("SIGKILL"),
  };
  return await observePortablePrimitiveParserChild(Object.freeze(provider), parentNormalizedBytes);
}

export function evaluatePortablePrimitiveParserEquivalence(
  parentNormalizedDigest: string,
  children: readonly PortablePrimitiveParserChildObservation[],
): PortablePrimitiveParserEquivalenceRawFacts {
  const detached = children.map((child) => Object.freeze({ ...child }));
  return Object.freeze({
    caseId: "PARSER_EQUIVALENCE",
    childCount: "3",
    children: Object.freeze(detached),
    parentNormalizedDigest,
    resultsMatch:
      detached.length === 3 &&
      detached.every(
        (child) =>
          child.outputAccepted &&
          child.exitCode === 0 &&
          child.exitSignal === null &&
          child.normalizedBytesMatch &&
          child.normalizedDigest === parentNormalizedDigest,
      ),
    schemaVersion: "portable-primitives-parser-equivalence-raw/v1",
  });
}

export async function executePortablePrimitiveParserEquivalenceProbe(
  stableRoot: string,
): Promise<PortablePrimitiveParserEquivalenceRawFacts> {
  const temporaryParent =
    process.env.RUNNER_TEMP && isAbsolute(process.env.RUNNER_TEMP)
      ? resolve(process.env.RUNNER_TEMP)
      : resolve(tmpdir());
  return await executePortablePrimitiveParserEquivalenceProbeInTemporaryParent(
    stableRoot,
    temporaryParent,
  );
}

export async function executePortablePrimitiveParserEquivalenceProbeInTemporaryParent(
  stableRoot: string,
  temporaryParent: string,
): Promise<PortablePrimitiveParserEquivalenceRawFacts> {
  if (!isAbsolute(stableRoot) || resolve(stableRoot) !== stableRoot)
    throw new TypeError("stableRoot:absolute-normalized-required");
  if (!isAbsolute(temporaryParent) || resolve(temporaryParent) !== temporaryParent)
    throw new TypeError("temporaryParent:absolute-normalized-required");
  const parentNormalizedBytes = normalizePortablePrimitiveParserCorpus(
    portablePrimitiveParserCorpus,
  );
  const parentNormalizedDigest = digest(parentNormalizedBytes);
  await mkdir(temporaryParent, { recursive: true });
  const temporaryRoot = await mkdtemp(resolve(temporaryParent, "orchestration-parser-probe-"));
  try {
    const result = await build({
      absWorkingDir: stableRoot,
      bundle: true,
      entryPoints: [resolve(stableRoot, "probes/portable-primitives/src/parser-child.ts")],
      external: ["node:*"],
      format: "esm",
      logLevel: "silent",
      minify: false,
      packages: "bundle",
      platform: "node",
      sourcemap: false,
      splitting: false,
      target: "node24",
      treeShaking: false,
      write: false,
    });
    if (result.outputFiles.length !== 1) throw new Error("parser-child:bundle-census");
    const childPath = resolve(temporaryRoot, "parser-child.mjs");
    await writeFile(childPath, result.outputFiles[0]!.contents, { flag: "wx" });
    const children = await Promise.all(
      Array.from({ length: 3 }, () => executeChild(childPath, parentNormalizedBytes)),
    );
    return evaluatePortablePrimitiveParserEquivalence(parentNormalizedDigest, children);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}
