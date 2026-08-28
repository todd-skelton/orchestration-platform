import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
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
  readonly exitCode: number | null;
  readonly normalizedBytesMatch: boolean;
  readonly normalizedDigest: string | null;
  readonly outputAccepted: boolean;
  readonly signal: NodeJS.Signals | null;
}

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
  let byteLength = 0;
  let response: Uint8Array | null = null;
  let messages = 0;
  child.stderr!.on("data", (chunk: Buffer) => {
    byteLength += chunk.byteLength;
    if (byteLength > 64 * 1024) child.kill("SIGKILL");
  });
  child.on("message", (message) => {
    messages += 1;
    response = messages === 1 ? parseChildResponse(message) : null;
  });
  child.send(
    Object.freeze({
      corpus: portablePrimitiveParserCorpus,
      schemaVersion: "portable-primitives-parser-child-request/v1",
    }),
  );
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  const completion = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (accept, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => accept({ code, signal }));
    },
  );
  clearTimeout(timeout);
  const accepted =
    completion.code === 0 &&
    completion.signal === null &&
    messages === 1 &&
    byteLength <= 64 * 1024 &&
    response !== null;
  return Object.freeze({
    exitCode: completion.code,
    normalizedBytesMatch:
      accepted && Buffer.compare(Buffer.from(response!), Buffer.from(parentNormalizedBytes)) === 0,
    normalizedDigest: accepted ? digest(response!) : null,
    outputAccepted: accepted,
    signal: completion.signal,
  });
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
          child.signal === null &&
          child.normalizedBytesMatch &&
          child.normalizedDigest === parentNormalizedDigest,
      ),
    schemaVersion: "portable-primitives-parser-equivalence-raw/v1",
  });
}

export async function executePortablePrimitiveParserEquivalenceProbe(
  stableRoot: string,
): Promise<PortablePrimitiveParserEquivalenceRawFacts> {
  if (!isAbsolute(stableRoot) || resolve(stableRoot) !== stableRoot)
    throw new TypeError("stableRoot:absolute-normalized-required");
  const parentNormalizedBytes = normalizePortablePrimitiveParserCorpus(
    portablePrimitiveParserCorpus,
  );
  const parentNormalizedDigest = digest(parentNormalizedBytes);
  const temporaryParent =
    process.env.RUNNER_TEMP && isAbsolute(process.env.RUNNER_TEMP)
      ? resolve(process.env.RUNNER_TEMP)
      : resolve(tmpdir());
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
