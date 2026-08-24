import { inflateRawSync } from "node:zlib";
import { types as nodeTypes } from "node:util";
import {
  computeConformanceRecordDigest,
  parseCanonicalConformanceBytes,
  parseConformanceAggregate,
  parseConformanceJobReceipt,
  parseConformanceRequiredJobRegistry,
  sha256Bytes,
} from "./contracts.js";
import type { ContractRecord } from "@orchestration-platform/contracts";

const maximumEntries = 1024;
const maximumFileBytes = 16 * 1024 * 1024;
const maximumArchiveBytes = 64 * 1024 * 1024;
const encoder = new TextEncoder();

export type GithubZipResult =
  | { readonly ok: true; readonly files: ReadonlyMap<string, Uint8Array> }
  | { readonly ok: false; readonly issues: readonly string[] };

export type GithubArtifactVerificationResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] };

export type GithubObservationArchiveResult =
  | {
      readonly ok: true;
      readonly environment: ContractRecord;
      readonly rawArtifactManifest: ContractRecord;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

export type GithubAggregateArchiveResult =
  | {
      readonly ok: true;
      readonly aggregate: ContractRecord;
      readonly receipts: readonly ContractRecord[];
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function refusal(...issues: readonly string[]): {
  readonly ok: false;
  readonly issues: readonly string[];
} {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactBytes(input: unknown): Uint8Array | undefined {
  return input instanceof Uint8Array &&
    !nodeTypes.isProxy(input) &&
    Object.getPrototypeOf(input) === Uint8Array.prototype
    ? input
    : undefined;
}

function u16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new RangeError("zip:u16-bound");
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new RangeError("zip:u32-bound");
  return view.getUint32(offset, true);
}

function checkedEnd(offset: number, length: number, bound: number): number {
  const end = offset + length;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    end > bound
  )
    throw new RangeError("zip:range-refused");
  return end;
}

function decodeName(bytes: Uint8Array): string {
  const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new TypeError("zip:path-refused");
  return value;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1)
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (u32(view, offset) !== 0x06054b50) continue;
    const commentLength = u16(view, offset + 20);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw new TypeError("zip:eocd-refused");
}

interface CentralEntry {
  readonly compressedSize: number;
  readonly compression: number;
  readonly crc: number;
  readonly flags: number;
  readonly localOffset: number;
  readonly name: string;
  readonly nameBytes: Uint8Array;
  readonly uncompressedSize: number;
  readonly directory: boolean;
}

function centralEntries(bytes: Uint8Array, view: DataView, eocd: number): readonly CentralEntry[] {
  const disk = u16(view, eocd + 4);
  const centralDisk = u16(view, eocd + 6);
  const entriesOnDisk = u16(view, eocd + 8);
  const entryCount = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12);
  const centralOffset = u32(view, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount)
    throw new TypeError("zip:multi-disk-refused");
  if (entryCount === 0 || entryCount > maximumEntries || entryCount === 0xffff)
    throw new TypeError("zip:entry-count-refused");
  if (centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new TypeError("zip:zip64-refused");
  if (checkedEnd(centralOffset, centralSize, bytes.byteLength) !== eocd)
    throw new TypeError("zip:central-range-refused");
  const entries: CentralEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(view, offset) !== 0x02014b50) throw new TypeError("zip:central-signature-refused");
    const versionMadeBy = u16(view, offset + 4);
    const flags = u16(view, offset + 8);
    const compression = u16(view, offset + 10);
    const crc = u32(view, offset + 16);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const startDisk = u16(view, offset + 34);
    const externalAttributes = u32(view, offset + 38);
    const localOffset = u32(view, offset + 42);
    if (startDisk !== 0 || [compressedSize, uncompressedSize, localOffset].includes(0xffffffff))
      throw new TypeError("zip:zip64-refused");
    if ((flags & 0x0001) !== 0 || (flags & ~0x0808) !== 0) throw new TypeError("zip:flags-refused");
    if (!(compression === 0 || compression === 8)) throw new TypeError("zip:compression-refused");
    if (uncompressedSize > maximumFileBytes || compressedSize > maximumArchiveBytes)
      throw new TypeError("zip:file-bound-refused");
    const nameStart = offset + 46;
    const nameEnd = checkedEnd(nameStart, nameLength, eocd);
    const next = checkedEnd(nameEnd, extraLength + commentLength, eocd);
    const nameBytes = bytes.slice(nameStart, nameEnd);
    const rawName = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    const directory = rawName.endsWith("/");
    const pathName = directory ? rawName.slice(0, -1) : rawName;
    const name = decodeName(encoder.encode(pathName));
    const unixMode = versionMadeBy >>> 8 === 3 ? externalAttributes >>> 16 : 0;
    const fileType = unixMode & 0o170000;
    if (fileType === 0o120000) throw new TypeError("zip:symlink-refused");
    if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000)
      throw new TypeError("zip:file-type-refused");
    if (directory !== (fileType === 0o040000 || (fileType === 0 && directory)))
      throw new TypeError("zip:directory-metadata-mismatch");
    entries.push({
      compressedSize,
      compression,
      crc,
      directory,
      flags,
      localOffset,
      name,
      nameBytes,
      uncompressedSize,
    });
    offset = next;
  }
  if (offset !== eocd) throw new TypeError("zip:central-census-refused");
  return entries;
}

function extractEntry(
  bytes: Uint8Array,
  view: DataView,
  entry: CentralEntry,
  centralStart: number,
): { readonly end: number; readonly output: Uint8Array } {
  const offset = entry.localOffset;
  if (u32(view, offset) !== 0x04034b50) throw new TypeError("zip:local-signature-refused");
  const flags = u16(view, offset + 6);
  const compression = u16(view, offset + 8);
  const localCrc = u32(view, offset + 14);
  const localCompressed = u32(view, offset + 18);
  const localUncompressed = u32(view, offset + 22);
  const nameLength = u16(view, offset + 26);
  const extraLength = u16(view, offset + 28);
  if (flags !== entry.flags || compression !== entry.compression)
    throw new TypeError("zip:local-metadata-mismatch");
  if (
    (flags & 0x0008) === 0 &&
    (localCrc !== entry.crc ||
      localCompressed !== entry.compressedSize ||
      localUncompressed !== entry.uncompressedSize)
  )
    throw new TypeError("zip:local-size-or-crc-mismatch");
  const nameStart = offset + 30;
  const nameEnd = checkedEnd(nameStart, nameLength, centralStart);
  if (!Buffer.from(bytes.slice(nameStart, nameEnd)).equals(Buffer.from(entry.nameBytes)))
    throw new TypeError("zip:local-name-mismatch");
  const dataStart = checkedEnd(nameEnd, extraLength, centralStart);
  const dataEnd = checkedEnd(dataStart, entry.compressedSize, centralStart);
  const compressed = bytes.slice(dataStart, dataEnd);
  let output: Uint8Array;
  if (entry.compression === 0) output = compressed.slice();
  else {
    const inflated = inflateRawSync(compressed, { maxOutputLength: maximumFileBytes });
    output = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength).slice();
  }
  if (output.byteLength !== entry.uncompressedSize || crc32(output) !== entry.crc)
    throw new TypeError("zip:payload-identity-mismatch");
  let end = dataEnd;
  if ((flags & 0x0008) !== 0) {
    const hasSignature = u32(view, end) === 0x08074b50;
    const values = hasSignature ? end + 4 : end;
    if (
      u32(view, values) !== entry.crc ||
      u32(view, values + 4) !== entry.compressedSize ||
      u32(view, values + 8) !== entry.uncompressedSize
    )
      throw new TypeError("zip:data-descriptor-mismatch");
    end = checkedEnd(values, 12, centralStart);
  }
  return { end, output };
}

export function extractGithubArtifactZip(input: unknown): GithubZipResult {
  try {
    const bytes = exactBytes(input);
    if (!bytes || bytes.byteLength < 22 || bytes.byteLength > maximumArchiveBytes)
      return refusal("zip:exact-bounded-bytes-required");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEndOfCentralDirectory(bytes, view);
    const centralStart = u32(view, eocd + 16);
    const entries = centralEntries(bytes, view, eocd);
    const localOffsets = entries.map((entry) => entry.localOffset);
    if (new Set(localOffsets).size !== localOffsets.length || Math.min(...localOffsets) !== 0)
      return refusal("zip:local-offset-census-refused");
    const files = new Map<string, Uint8Array>();
    let total = 0;
    const localOrder = [...entries].sort((left, right) => left.localOffset - right.localOffset);
    for (let index = 0; index < localOrder.length; index += 1) {
      const entry = localOrder[index]!;
      const extracted = extractEntry(bytes, view, entry, centralStart);
      const nextOffset = localOrder[index + 1]?.localOffset ?? centralStart;
      if (extracted.end !== nextOffset) return refusal("zip:local-layout-gap-or-overlap");
      if (entry.directory) continue;
      if (files.has(entry.name)) return refusal("zip:duplicate-path-refused");
      total += extracted.output.byteLength;
      if (total > maximumArchiveBytes) return refusal("zip:expanded-bound-refused");
      files.set(entry.name, extracted.output);
    }
    if (files.size === 0) return refusal("zip:empty-refused");
    return { ok: true, files };
  } catch {
    return refusal("zip:unreadable-or-unsafe");
  }
}

export function verifyGithubArtifactIdentity(
  input: unknown,
  expectedDigest: string,
  expectedByteLength: string,
): GithubArtifactVerificationResult {
  const bytes = exactBytes(input);
  if (!bytes) return refusal("artifact:exact-bytes-required");
  if (String(bytes.byteLength) !== expectedByteLength)
    return refusal("artifact:byte-length-mismatch");
  if (sha256Bytes(bytes) !== expectedDigest) return refusal("artifact:digest-mismatch");
  return { ok: true };
}

function exactFileCensus(
  files: ReadonlyMap<string, Uint8Array>,
  expected: readonly string[],
): boolean {
  return (
    files.size === expected.length &&
    expected.every((name) => files.has(name)) &&
    [...files.keys()].every((name) => expected.includes(name))
  );
}

export function verifyGithubObservationArchive(input: unknown): GithubObservationArchiveResult {
  const archive = extractGithubArtifactZip(input);
  if (!archive.ok) return archive;
  const expected = Object.freeze([
    "environment",
    "environment-record.json",
    "raw-manifest.json",
    "report",
    "stderr",
    "stdout",
  ]);
  if (!exactFileCensus(archive.files, expected)) return refusal("observation:file-census-mismatch");
  const environmentBytes = archive.files.get("environment-record.json")!;
  const manifestBytes = archive.files.get("raw-manifest.json")!;
  const environment = parseCanonicalConformanceBytes(
    "conformance-environment/v1",
    environmentBytes,
  );
  const manifest = parseCanonicalConformanceBytes(
    "conformance-raw-artifact-manifest/v1",
    manifestBytes,
  );
  if (!environment.ok) return refusal(...environment.issues.map((issue) => `environment.${issue}`));
  if (!manifest.ok) return refusal(...manifest.issues.map((issue) => `manifest.${issue}`));
  const rawEntries = manifest.value.entries as readonly ContractRecord[];
  for (const name of ["environment", "report", "stderr", "stdout"] as const) {
    const row = rawEntries.find((entry) => entry.name === name);
    const value = archive.files.get(name)!;
    if (
      !row ||
      row.byteLength !== String(value.byteLength) ||
      row.sha256Digest !== sha256Bytes(value)
    )
      return refusal(`observation.${name}:raw-identity-mismatch`);
  }
  if (rawEntries[0]?.sha256Digest !== environment.value.osImageDigest)
    return refusal("observation:environment-inventory-mismatch");
  return { ok: true, environment: environment.value, rawArtifactManifest: manifest.value };
}

export function verifyGithubAggregateArchive(
  input: unknown,
  registryInput: unknown,
): GithubAggregateArchiveResult {
  const archive = extractGithubArtifactZip(input);
  if (!archive.ok) return archive;
  const registry = parseConformanceRequiredJobRegistry(registryInput);
  if (!registry.ok) return refusal(...registry.issues.map((issue) => `registry.${issue}`));
  const jobs = registry.value.jobs as readonly ContractRecord[];
  const expected = Object.freeze([
    "aggregate.json",
    ...jobs.map((job) => `receipts/${String(job.jobId)}.json`),
  ]);
  if (!exactFileCensus(archive.files, expected)) return refusal("aggregate:file-census-mismatch");
  const aggregate = parseCanonicalConformanceBytes(
    "conformance-aggregate/v1",
    archive.files.get("aggregate.json")!,
  );
  if (!aggregate.ok) return refusal(...aggregate.issues.map((issue) => `aggregate.${issue}`));
  if (!parseConformanceAggregate(aggregate.value).ok) return refusal("aggregate:invalid");
  const registryDigest = computeConformanceRecordDigest(
    "conformance-required-job-registry/v1",
    registry.value,
  );
  if (aggregate.value.requiredJobRegistryDigest !== registryDigest)
    return refusal("aggregate:registry-digest-mismatch");
  const receipts: ContractRecord[] = [];
  const expectedDigests = aggregate.value.jobReceiptDigests as readonly string[];
  if (expectedDigests.length !== jobs.length) return refusal("aggregate:receipt-census-mismatch");
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    const jobId = String(job.jobId);
    const parsed = parseCanonicalConformanceBytes(
      "conformance-job-receipt/v1",
      archive.files.get(`receipts/${jobId}.json`)!,
    );
    if (!parsed.ok) return refusal(...parsed.issues.map((issue) => `receipt.${jobId}.${issue}`));
    if (!parseConformanceJobReceipt(parsed.value).ok || parsed.value.jobId !== jobId)
      return refusal(`receipt.${jobId}:identity-mismatch`);
    const suites = registry.value.suites as readonly ContractRecord[];
    const suite = suites.find((candidate) => candidate.suiteId === job.suiteId);
    if (
      !suite ||
      parsed.value.suiteId !== suite.suiteId ||
      parsed.value.vectorCensusDigest !== suite.vectorCensusDigest ||
      parsed.value.normalizedResult !== "PASS"
    )
      return refusal(`receipt.${jobId}:suite-or-result-mismatch`);
    if (
      (suite.walkRequirement === "NONE" && parsed.value.maximumWalkDurationNanoseconds !== null) ||
      (suite.walkRequirement === "WALK_1000" &&
        parsed.value.maximumWalkDurationNanoseconds === null)
    )
      return refusal(`receipt.${jobId}:walk-arm-mismatch`);
    if (
      computeConformanceRecordDigest("conformance-job-receipt/v1", parsed.value) !==
      expectedDigests[index]
    )
      return refusal(`receipt.${jobId}:digest-mismatch`);
    for (const field of [
      "candidateSubjectDigest",
      "contractVersionsDigest",
      "harnessBundleDigest",
      "providerRunDigest",
      "requiredJobRegistryDigest",
      "testBundleDigest",
    ] as const)
      if (parsed.value[field] !== aggregate.value[field])
        return refusal(`receipt.${jobId}.${field}:aggregate-mismatch`);
    receipts.push(parsed.value);
  }
  return { ok: true, aggregate: aggregate.value, receipts: Object.freeze(receipts) };
}
