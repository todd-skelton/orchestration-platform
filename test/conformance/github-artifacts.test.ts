import { describe, expect, test } from "vitest";
import { deflateRawSync } from "node:zlib";
import * as core from "../../packages/conformance/src/index.js";
import * as github from "../../packages/conformance/src/github-actions/index.js";

const d = (value: string): string => value.repeat(64);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

let table: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1)
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  readonly bytes: Uint8Array;
  readonly centralExtra?: Uint8Array;
  readonly centralVersionNeeded?: number;
  readonly descriptor?: boolean;
  readonly descriptorLocal?: Readonly<{
    crc?: number;
    compressedSize?: number;
    uncompressedSize?: number;
  }>;
  readonly flags?: number;
  readonly localExtra?: Uint8Array;
  readonly localVersionNeeded?: number;
  readonly method?: number;
  readonly mode?: number;
  readonly name: string;
}

function zip(entries: readonly ZipEntry[]): Uint8Array {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const localExtra = Buffer.from(entry.localExtra ?? new Uint8Array());
    const centralExtra = Buffer.from(entry.centralExtra ?? new Uint8Array());
    const rawPayload = Buffer.from(entry.bytes);
    const checksum = crc32(entry.bytes);
    const flags = entry.flags ?? (entry.descriptor ? 0x0808 : 0x0800);
    const method = entry.method ?? 0;
    const payload = method === 8 ? deflateRawSync(rawPayload) : rawPayload;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.localVersionNeeded ?? 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(entry.descriptor ? (entry.descriptorLocal?.crc ?? 0) : checksum, 14);
    local.writeUInt32LE(
      entry.descriptor ? (entry.descriptorLocal?.compressedSize ?? 0) : payload.byteLength,
      18,
    );
    local.writeUInt32LE(
      entry.descriptor ? (entry.descriptorLocal?.uncompressedSize ?? 0) : rawPayload.byteLength,
      22,
    );
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(localExtra.byteLength, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(entry.centralVersionNeeded ?? 20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.byteLength, 20);
    central.writeUInt32LE(rawPayload.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(centralExtra.byteLength, 30);
    central.writeUInt32LE((entry.mode ?? 0o100644) * 65_536, 38);
    central.writeUInt32LE(localOffset, 42);
    const descriptor = entry.descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (entry.descriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(payload.byteLength, 8);
      descriptor.writeUInt32LE(rawPayload.byteLength, 12);
    }
    localChunks.push(local, name, localExtra, payload, descriptor);
    centralChunks.push(central, name, centralExtra);
    localOffset +=
      local.byteLength +
      name.byteLength +
      localExtra.byteLength +
      payload.byteLength +
      descriptor.byteLength;
  }
  const central = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  return Uint8Array.from(Buffer.concat([...localChunks, central, end]));
}

function canonical(schemaVersion: core.ConformanceSchemaVersion, value: unknown): Uint8Array {
  const serialized = core.serializeConformanceContract(schemaVersion, value);
  if (!serialized.ok) throw new Error(serialized.issues.join(","));
  return serialized.bytes;
}

const raw = Object.freeze({
  environment: text('{"image":"ubuntu-24.04"}\n'),
  report: text('{"executed":["authority-history-linear"]}\n'),
  stderr: new Uint8Array(),
  stdout: text("ok\n"),
});
const environment = Object.freeze({
  abiDigest: d("1"),
  architecture: "X64",
  custodyObservationDigest: null,
  filesystemProfileDigest: d("2"),
  helperProfileDigest: null,
  nodeVersion: "24.15.0",
  operatingSystem: "LINUX",
  osImageDigest: core.sha256Bytes(raw.environment),
  packageManagerVersion: "11.22.0",
  runnerClass: "EPHEMERAL_HOSTED",
  schemaVersion: "conformance-environment/v1",
});
const registry = Object.freeze({
  jobs: Object.freeze([
    Object.freeze({
      environmentFamily: "LINUX",
      jobId: "iss002-contracts-linux",
      requirement: "REQUIRED",
      suiteId: "iss002-contracts",
    }),
  ]),
  schemaVersion: "conformance-required-job-registry/v1",
  suites: Object.freeze([
    Object.freeze({
      custodyRequirement: "UNUSED",
      helperRequirement: "UNUSED",
      ownerPackage: "@orchestration-platform/contracts",
      runnerToken: "ISS002_CONTRACTS",
      suiteId: "iss002-contracts",
      vectorCensusDigest: d("3"),
      walkRequirement: "WALK_1000",
    }),
  ]),
});
const evidence = core.createConformanceJobEvidence({
  candidateSubjectDigest: d("4"),
  contractVersionsDigest: d("5"),
  environment,
  harnessBundleDigest: d("6"),
  jobId: "iss002-contracts-linux",
  maximumWalkDurationNanoseconds: "1000",
  normalizedResult: "PASS",
  providerRunDigest: d("7"),
  rawArtifacts: raw,
  registry,
  testBundleDigest: d("8"),
});
if (!evidence.ok) throw new Error(evidence.issues.join(","));
const aggregateResult = core.reduceConformanceAggregate(registry, [
  {
    environment: evidence.environment,
    rawArtifactManifest: evidence.rawArtifactManifest,
    receipt: evidence.receipt,
  },
]);
if (!aggregateResult.ok) throw new Error(aggregateResult.issues.join(","));

const observationEntries = Object.freeze([
  { bytes: raw.environment, name: "environment" },
  {
    bytes: canonical("conformance-environment/v1", evidence.environment),
    name: "environment-record.json",
  },
  {
    bytes: canonical("conformance-raw-artifact-manifest/v1", evidence.rawArtifactManifest),
    name: "raw-manifest.json",
  },
  { bytes: raw.report, name: "report" },
  { bytes: raw.stderr, name: "stderr" },
  { bytes: raw.stdout, name: "stdout" },
]);
const observationZip = zip(observationEntries);
const aggregateZip = zip([
  { bytes: canonical("conformance-aggregate/v1", aggregateResult.value), name: "aggregate.json" },
  {
    bytes: canonical("conformance-job-receipt/v1", evidence.receipt),
    name: "receipts/iss002-contracts-linux.json",
  },
]);

describe("GitHub artifact archives", () => {
  test("extracts and binds the exact observation layout", () => {
    const extracted = github.extractGithubArtifactZip(observationZip);
    expect(extracted.ok).toBe(true);
    expect(github.verifyGithubObservationArchive(observationZip).ok).toBe(true);
    expect(
      github.verifyGithubArtifactIdentity(
        observationZip,
        core.sha256Bytes(observationZip),
        String(observationZip.byteLength),
      ).ok,
    ).toBe(true);
    const deflated = github.extractGithubArtifactZip(
      zip([{ bytes: text("deflated-with-descriptor"), descriptor: true, method: 8, name: "file" }]),
    );
    expect(deflated.ok).toBe(true);
    if (deflated.ok)
      expect(new TextDecoder().decode(deflated.files.get("file"))).toBe("deflated-with-descriptor");
  });

  test("verifies aggregate and receipt bytes in stable registry order", () => {
    const verified = github.verifyGithubAggregateArchive(aggregateZip, registry);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.aggregate).toEqual(aggregateResult.value);
    expect(verified.receipts).toEqual([evidence.receipt]);
  });

  test("refuses unsafe ZIP structure and payload substitutions", () => {
    const corrupted = observationZip.slice();
    corrupted[40] = corrupted[40]! ^ 0xff;
    for (const [index, archive] of [
      zip([{ bytes: text("escape"), name: "../escape" }]),
      zip([{ bytes: text("link"), mode: 0o120777, name: "link" }]),
      zip([{ bytes: text("unsupported"), method: 99, name: "file" }]),
      zip([{ bytes: text("secret"), flags: 0x0801, name: "file" }]),
      zip([{ bytes: text("zip64-central-version"), centralVersionNeeded: 45, name: "file" }]),
      zip([{ bytes: text("zip64-local-version"), localVersionNeeded: 45, name: "file" }]),
      zip([
        {
          bytes: text("zip64-central-extra"),
          centralExtra: new Uint8Array([1, 0, 0, 0]),
          name: "file",
        },
      ]),
      zip([
        {
          bytes: text("zip64-local-extra"),
          localExtra: new Uint8Array([1, 0, 0, 0]),
          name: "file",
        },
      ]),
      zip([
        {
          bytes: text("descriptor-crc"),
          descriptor: true,
          descriptorLocal: { crc: 1 },
          method: 8,
          name: "file",
        },
      ]),
      zip([
        {
          bytes: text("descriptor-compressed"),
          descriptor: true,
          descriptorLocal: { compressedSize: 1 },
          method: 8,
          name: "file",
        },
      ]),
      zip([
        {
          bytes: text("descriptor-uncompressed"),
          descriptor: true,
          descriptorLocal: { uncompressedSize: 1 },
          method: 8,
          name: "file",
        },
      ]),
      zip([
        { bytes: text("one"), name: "same" },
        { bytes: text("two"), name: "same" },
      ]),
      corrupted,
    ].entries())
      expect(github.extractGithubArtifactZip(archive).ok, String(index)).toBe(false);
  });

  test("refuses inner layout, manifest, receipt, and outer identity mutations", () => {
    expect(
      github.verifyGithubObservationArchive(
        zip(observationEntries.filter((entry) => entry.name !== "stderr")),
      ).ok,
    ).toBe(false);
    expect(
      github.verifyGithubObservationArchive(
        zip([...observationEntries, { bytes: text("extra"), name: "extra" }]),
      ).ok,
    ).toBe(false);
    expect(
      github.verifyGithubObservationArchive(
        zip(
          observationEntries.map((entry) =>
            entry.name === "stdout" ? { ...entry, bytes: text("moved") } : entry,
          ),
        ),
      ).ok,
    ).toBe(false);
    expect(
      github.verifyGithubAggregateArchive(
        zip([
          {
            bytes: canonical("conformance-aggregate/v1", aggregateResult.value),
            name: "aggregate.json",
          },
        ]),
        registry,
      ).ok,
    ).toBe(false);
    expect(github.verifyGithubArtifactIdentity(observationZip, d("9"), "1").ok).toBe(false);
    expect(github.extractGithubArtifactZip(Buffer.from(observationZip)).ok).toBe(false);
  });

  test("is total for hostile archive inputs", () => {
    const hostile = new Proxy(new Uint8Array(), {});
    const throwingPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [null, undefined, [], hostile, throwingPrototype]) {
      expect(() => github.extractGithubArtifactZip(input)).not.toThrow();
      expect(() => github.verifyGithubObservationArchive(input)).not.toThrow();
      expect(() => github.verifyGithubAggregateArchive(input, registry)).not.toThrow();
      expect(() => github.verifyGithubArtifactIdentity(input, d("1"), "0")).not.toThrow();
    }
  });
});
