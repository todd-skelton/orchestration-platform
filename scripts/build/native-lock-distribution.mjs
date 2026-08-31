import { createHash } from "node:crypto";
import { types } from "node:util";
import { crc32, inflateRawSync } from "node:zlib";

// Private Node 24 header input reader, not an extractor or a general archive API.
// Limits leave room above the inspected v24.15.0 archive (9,958,714 compressed,
// 61,675,520 expanded bytes; 3,639 raw records). New formats require review.
const maximumArchiveBytes = 16 * 1024 * 1024;
const maximumTarBytes = 96 * 1024 * 1024;
const maximumFileBytes = 16 * 1024 * 1024;
const maximumRecords = 8192;
const maximumPathBytes = 1024;
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, "byteLength").get;
const backingBuffer = Object.getOwnPropertyDescriptor(typedArray, "buffer").get;
const setBytes = Uint8Array.prototype.set;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable").get;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = () => {
  throw new TypeError("native-lock-distribution:refused");
};

function retainedCopy(input) {
  // Intrinsic brand/getters/set avoid caller iterators, property accessors and
  // Buffer.from coercion. Shared/resizable stores cannot supply a stable snapshot.
  if (types.isProxy(input) || !types.isUint8Array(input)) refuse();
  const backing = backingBuffer.call(input);
  if (!types.isArrayBuffer(backing) || resizable.call(backing)) refuse();
  const length = byteLength.call(input);
  if (length < 18 || length > maximumArchiveBytes) refuse();
  const copy = new Uint8Array(length);
  setBytes.call(copy, input);
  return Buffer.from(copy.buffer);
}

function unpackGzip(bytes, root) {
  // One gzip member with exactly the observed FNAME form. MTIME/XFL/OS are data;
  // the OS byte cannot identify the current host or grant platform authority.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8 || bytes[3] !== 8) refuse();
  const name = Buffer.from(`${root}-headers.tar\0`, "ascii");
  if (!bytes.subarray(10, 10 + name.length).equals(name)) refuse();
  const compressed = bytes.subarray(10 + name.length, -8);
  if (compressed.length === 0) refuse();
  const decoded = inflateRawSync(compressed, { maxOutputLength: maximumTarBytes, info: true });
  const tar = decoded.buffer;
  if (
    decoded.engine.bytesWritten !== compressed.length ||
    tar.length !== bytes.readUInt32LE(bytes.length - 4) ||
    crc32(tar) !== bytes.readUInt32LE(bytes.length - 8) ||
    tar.length < 1024 ||
    tar.length % 512 !== 0
  )
    refuse();
  return tar;
}

function zero(bytes) {
  if (bytes.some((value) => value !== 0)) refuse();
}

function ascii(bytes) {
  if (bytes.some((value) => value < 0x20 || value > 0x7e)) refuse();
  return bytes.toString("ascii");
}

function field(bytes) {
  const end = bytes.indexOf(0);
  if (end === -1) return ascii(bytes);
  zero(bytes.subarray(end));
  return ascii(bytes.subarray(0, end));
}

function octal(bytes) {
  // No base-256, signed values, empty numbers or embedded padding.
  const value = bytes.toString("latin1");
  if (!/^[0-7]+\0$/.test(value)) refuse();
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number)) refuse();
  return number;
}

function headerAt(tar, offset) {
  const header = tar.subarray(offset, offset + 512);
  if (!header.subarray(257, 265).equals(Buffer.from("ustar  \0", "ascii"))) refuse();
  const checksum = header.subarray(148, 156).toString("latin1");
  if (!/^[0-7]{6}\0 $/.test(checksum)) refuse();
  let sum = 8 * 32;
  for (let index = 0; index < 512; index++) if (index < 148 || index >= 156) sum += header[index];
  if (sum !== Number.parseInt(checksum, 8)) refuse();
  const kind = header[156];
  if (![48, 53, 76].includes(kind)) refuse(); // Only GNU regular/directory/long name.
  zero(header.subarray(157, 257)); // No link target, even on a regular record.
  zero(header.subarray(345)); // No GNU time/offset/sparse data or alternate prefix.
  for (const [start, end] of [
    [100, 108],
    [108, 116],
    [116, 124],
    [136, 148],
  ])
    octal(header.subarray(start, end));
  zero(header.subarray(329, 345)); // Observed GNU non-device records use all NULs.
  field(header.subarray(265, 297)); // Owner names are validated data, never applied.
  field(header.subarray(297, 329));
  const name = field(header.subarray(0, 100));
  const size = octal(header.subarray(124, 136));
  if (size > (kind === 76 ? maximumPathBytes + 1 : maximumFileBytes)) refuse();
  if (kind === 53 && size !== 0) refuse();
  const payloadOffset = offset + 512;
  const next = payloadOffset + Math.ceil(size / 512) * 512;
  if (next > tar.length) refuse();
  zero(tar.subarray(payloadOffset + size, next));
  return { name, kind, size, payloadOffset, next };
}

function portablePath(raw, directory) {
  if (raw.length > maximumPathBytes || directory !== raw.endsWith("/")) refuse();
  const path = directory ? raw.slice(0, -1) : raw;
  const parts = path.split("/");
  if (parts.length > 24) refuse();
  for (const part of parts) {
    if (
      part.length > 255 ||
      !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) ||
      part.endsWith(".") ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
    )
      refuse();
  }
  return path;
}

function classification(path, directory, root) {
  if (directory && [root, `${root}/include`, `${root}/include/node`].includes(path))
    return "DIRECTORY";
  const prefix = `${root}/include/node/`;
  if (!path.startsWith(prefix)) refuse();
  const headerPath = path.slice(prefix.length);
  if (directory) return "DIRECTORY";
  if (["config.gypi", "common.gypi"].includes(headerPath)) return "CONFIGURATION";
  if (headerPath.endsWith(".h")) return "HEADER";
  refuse(); // Never silently filter non-header archive payloads.
}

/**
 * Validate retained bytes as data; returns no official-origin, extraction,
 * revision, OS/ABI, build or load attestation. The stable coordinator must bind
 * version to its actual process, verify retained SHASUMS/acquisition, and prove
 * complete extraction plus custody. Output payloads are independent mutable
 * copies: recompute equality/hashes at that boundary, never trust this census
 * as authority. GNU metadata is separately retained in the raw-record census.
 */
export function readNativeLockHeaders(archiveBytes, exactNodeVersion) {
  try {
    if (
      typeof exactNodeVersion !== "string" ||
      !/^v24\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/.test(exactNodeVersion)
    )
      refuse();
    const archive = retainedCopy(archiveBytes);
    const root = `node-${exactNodeVersion}`;
    const tar = unpackGzip(archive, root);
    const entries = [];
    const longNames = [];
    const paths = new Map();
    const folded = new Set();
    let offset = 0;
    let records = 0;
    let payloadBytes = 0;
    let headerBytes = 0;
    let pending = null;
    while (offset < tar.length && tar[offset] !== 0) {
      if (++records > maximumRecords) refuse();
      const recordOffset = offset;
      const header = headerAt(tar, offset);
      const payload = tar.subarray(header.payloadOffset, header.payloadOffset + header.size);
      payloadBytes += payload.length;
      offset = header.next;
      if (header.kind === 76) {
        if (
          pending ||
          header.name !== "././@LongLink" ||
          payload.length <= 101 ||
          payload[payload.length - 1] !== 0 ||
          payload.subarray(0, -1).includes(0)
        )
          refuse();
        pending = {
          rawPath: ascii(payload.subarray(0, -1)),
          recordOffset,
          targetRecordOffset: offset,
          byteLength: payload.length,
          sha256: digest(payload),
        };
        continue;
      }
      const directory = header.kind === 53;
      const rawPath = pending ? pending.rawPath : header.name;
      if (pending && header.name !== rawPath.slice(0, 100)) refuse();
      const path = portablePath(rawPath, directory);
      const kind = classification(path, directory, root);
      const lower = path.toLowerCase();
      if (paths.has(path) || folded.has(lower)) refuse();
      paths.set(path, kind);
      folded.add(lower);
      if (pending) {
        const { rawPath: unused, ...metadata } = pending;
        longNames.push(Object.freeze({ kind: "GNU_LONG_NAME", path, ...metadata }));
        pending = null;
      }
      const entry = {
        kind,
        path,
        recordOffset,
        byteLength: payload.length,
        sha256: digest(payload),
      };
      if (!directory) {
        headerBytes += payload.length;
        entry.headerPath = path.slice(`${root}/include/node/`.length);
        // Each output owns its buffer; exposing .buffer cannot mutate siblings,
        // the retained snapshot, or the expanded tar used for validation.
        entry.bytes = new Uint8Array(payload);
      }
      entries.push(Object.freeze(entry));
    }
    if (pending || tar.length - offset < 1024 || tar.length - offset > 10240) refuse();
    zero(tar.subarray(offset));
    for (const path of [root, `${root}/include`, `${root}/include/node`])
      if (paths.get(path) !== "DIRECTORY") refuse();
    if (!entries.some((entry) => entry.kind === "HEADER")) refuse();
    for (const entry of entries) {
      if (entry.path === root) continue;
      const parent = entry.path.slice(0, entry.path.lastIndexOf("/"));
      if (paths.get(parent) !== "DIRECTORY") refuse();
    }
    entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return Object.freeze({
      version: exactNodeVersion,
      archive: Object.freeze({
        path: `node-${exactNodeVersion}-headers.tar.gz`,
        byteLength: archive.length,
        sha256: digest(archive),
      }),
      tar: Object.freeze({
        byteLength: tar.length,
        sha256: digest(tar),
        recordCount: records,
        payloadBytes,
        headerBytes,
        terminalZeroBytes: tar.length - offset,
      }),
      entries: Object.freeze(entries),
      longNames: Object.freeze(longNames),
    });
  } catch {
    refuse();
  }
}
