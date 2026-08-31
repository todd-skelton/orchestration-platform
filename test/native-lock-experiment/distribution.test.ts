import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { readNativeLockHeaders } from "../../scripts/build/native-lock-distribution.mjs";

// Generated synthetic GNU records only. No official archive, extraction, native
// execution, acquisition/provenance assertion, or filesystem test adapter.
const version = "v24.15.0";
const root = `node-${version}`;
const include = `${root}/include/node`;
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function octal(header: Buffer, offset: number, width: number, value: number) {
  header.write(value.toString(8).padStart(width - 1, "0") + "\0", offset, width, "ascii");
}
function checksum(header: Buffer) {
  header.fill(32, 148, 156);
  header.write(
    header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
    8,
    "ascii",
  );
}
function record(name: string, kind = "0", payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "ascii");
  for (const [offset, width, value] of [
    [100, 8, kind === "5" ? 0o755 : 0o644],
    [108, 8, 0],
    [116, 8, 0],
    [124, 12, payload.length],
    [136, 12, 1700000000],
  ] as const)
    octal(header, offset, width, value);
  header.write(kind, 156, "ascii");
  header.write("ustar  \0", 257, "ascii");
  header.write("root", 265, "ascii");
  header.write("root", 297, "ascii");
  checksum(header);
  return Buffer.concat([header, payload, Buffer.alloc((512 - (payload.length % 512)) % 512)]);
}
const directory = (path: string) => record(`${path}/`, "5");
const data = Buffer.from("/* synthetic Node-API header */\n");
function members() {
  return [
    directory(root),
    directory(`${root}/include`),
    directory(include),
    record(`${include}/node_api.h`, "0", data),
    record(`${include}/config.gypi`, "0", Buffer.from("{'variables': {}}\n")),
  ];
}
function tar(records = members(), terminal = Buffer.alloc(1536)) {
  return Buffer.concat([...records, terminal]);
}
function gzip(bytes: Buffer) {
  const zipped = gzipSync(bytes);
  zipped[3] = 8; // Observed official form: one bounded, NUL-terminated FNAME.
  return Buffer.concat([
    zipped.subarray(0, 10),
    Buffer.from(`${root}-headers.tar\0`),
    zipped.subarray(10),
  ]);
}
const read = (bytes: Buffer) => readNativeLockHeaders(gzip(bytes), version);
const refused = (bytes: Buffer) =>
  expect(() => read(bytes)).toThrow("native-lock-distribution:refused");
function changed(offset: number, value: number, recalculate = true) {
  const file = record(`${include}/other.h`, "0", data);
  file[offset] = value;
  if (recalculate) checksum(file.subarray(0, 512));
  return tar([...members(), file]);
}
function longFixture() {
  const parent = `${include}/openssl/archs/linux64-riscv64/asm_avx2/include/openssl`;
  const path = `${parent}/configuration_generated.h`;
  const directories = [];
  let current = include;
  for (const part of parent.slice(include.length + 1).split("/")) {
    current += `/${part}`;
    directories.push(directory(current));
  }
  const metadata = record("././@LongLink", "L", Buffer.from(`${path}\0`));
  const file = record(path, "0", data);
  return { path, metadata, file, prefix: [...members(), ...directories] };
}

describe("private retained Node 24 GNU header archive input", () => {
  test("classifies every logical member and returns complete detached payload bytes", () => {
    const raw = tar();
    const archive = gzip(raw);
    const result = readNativeLockHeaders(archive, version);
    expect(result.archive).toEqual({
      path: `${root}-headers.tar.gz`,
      byteLength: archive.length,
      sha256: hash(archive),
    });
    expect(result.tar).toMatchObject({
      byteLength: raw.length,
      sha256: hash(raw),
      recordCount: 5,
      terminalZeroBytes: 1536,
      payloadBytes: data.length + 18,
      headerBytes: data.length + 18,
    });
    expect(result.entries.map(({ kind, path }) => [kind, path])).toEqual([
      ["DIRECTORY", root],
      ["DIRECTORY", `${root}/include`],
      ["DIRECTORY", include],
      ["CONFIGURATION", `${include}/config.gypi`],
      ["HEADER", `${include}/node_api.h`],
    ]);
    const files = result.entries.filter((entry) => entry.kind !== "DIRECTORY");
    expect(files.map((entry) => entry.headerPath)).toEqual(["config.gypi", "node_api.h"]);
    expect(Buffer.from(files[1]!.bytes)).toEqual(data);
    expect(files.every((entry) => entry.sha256 === hash(entry.bytes))).toBe(true);
    const snapshot = Buffer.from(files[1]!.bytes);
    archive.fill(0);
    new Uint8Array(files[0]!.bytes.buffer).fill(0);
    expect(Buffer.from(files[1]!.bytes)).toEqual(snapshot);
    expect(Object.isFrozen(result.entries)).toBe(true);
    expect(result.longNames).toEqual([]);
  });

  test("accounts for GNU long-name payload and binds it to precisely the next record", () => {
    const { path, metadata, file, prefix } = longFixture();
    // The inspected archive also has ordinary full-width 100-byte names.
    const exact100 = `${include}/${"a".repeat(100 - include.length - 3)}.h`;
    prefix.push(record(exact100, "0", data));
    const result = read(tar([...prefix, metadata, file]));
    expect(result.entries.some((entry) => entry.path === exact100)).toBe(true);
    const entry = result.entries.find((item) => item.path === path)!;
    expect(result.longNames).toEqual([
      {
        kind: "GNU_LONG_NAME",
        path,
        recordOffset: Buffer.concat(prefix).length,
        targetRecordOffset: entry.recordOffset,
        byteLength: path.length + 1,
        sha256: hash(Buffer.from(`${path}\0`)),
      },
    ]);
    expect(result.tar.recordCount).toBe(result.entries.length + result.longNames.length);
    expect(result.tar.payloadBytes - result.tar.headerBytes).toBe(path.length + 1);
    expect(entry.kind).toBe("HEADER");
  });

  test.each(["v22.15.0", "v24", "v24.015.0", "v24.15.0-rc.1", "v24.15.1", {}, null])(
    "refuses an inexact or different version %j",
    (wrong) => {
      expect(() => readNativeLockHeaders(gzip(tar()), wrong)).toThrow();
    },
  );

  test("uses byte intrinsics without executing coercions/getters or proxy traps", () => {
    const archive = new Uint8Array(gzip(tar()));
    let calls = 0;
    const hostile = () => {
      calls++;
      throw new Error("must not run");
    };
    for (const key of ["buffer", "byteLength", "byteOffset", Symbol.iterator])
      Object.defineProperty(archive, key, { get: hostile });
    expect(readNativeLockHeaders(archive, version).entries).toHaveLength(5);
    for (const input of [
      Object.create(Uint8Array.prototype),
      { valueOf: hostile },
      new Proxy(archive, { get: hostile, getPrototypeOf: hostile }),
      new DataView(new ArrayBuffer(20)),
      new Uint8Array(new SharedArrayBuffer(20)),
      new Uint8Array(new ArrayBuffer(20, { maxByteLength: 40 })),
      new Uint8Array(17),
      new Uint8Array(16 * 1024 * 1024 + 1),
    ])
      expect(() => readNativeLockHeaders(input, version)).toThrow();
    const detached = new Uint8Array(20);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => readNativeLockHeaders(detached, version)).toThrow();
    expect(calls).toBe(0);
  });

  test.each([
    [0, 0],
    [2, 0],
    [3, 0],
    [3, 9],
    [3, 24],
    [10, 0],
    [10, 47],
  ])("refuses unsupported gzip header/name %i=%i", (offset, value) => {
    const bytes = gzip(tar());
    bytes[offset!] = value!;
    expect(() => readNativeLockHeaders(bytes, version)).toThrow();
  });
  test("refuses gzip checksum/size/truncation, concatenation and unexplained trailing bytes", () => {
    const bytes = gzip(tar());
    const crc = Buffer.from(bytes);
    crc[crc.length - 8] = crc[crc.length - 8]! ^ 1;
    const length = Buffer.from(bytes);
    length[length.length - 4] = length[length.length - 4]! ^ 1;
    for (const mutant of [
      crc,
      length,
      bytes.subarray(0, -1),
      Buffer.concat([bytes, bytes]),
      Buffer.concat([bytes, Buffer.alloc(1)]),
      Buffer.concat([bytes, Buffer.from("extra")]),
      // Keep the valid footer: only complete DEFLATE consumption rejects this.
      Buffer.concat([bytes.subarray(0, -8), Buffer.alloc(1), bytes.subarray(-8)]),
    ])
      expect(() => readNativeLockHeaders(mutant, version)).toThrow();
  });
  test("bounds expansion even when gzip output is small", () => {
    // Otherwise valid members: removing the expansion bound would accept them.
    const payload = Buffer.alloc(14 * 1024 * 1024);
    const records = members().slice(0, 3);
    for (let index = 0; index < 7; index++)
      records.push(record(`${include}/large${index}.h`, "0", payload));
    const bytes = gzip(tar(records));
    expect(() => readNativeLockHeaders(bytes, version)).toThrow();
  });

  test.each(["1", "2", "3", "4", "6", "7", "S", "x", "g", "K", "\0"])(
    "refuses unsupported tar record type %j",
    (kind) => {
      refused(tar([...members(), record(`${include}/extra.h`, kind, data)]));
    },
  );
  test.each([
    [257, 0],
    [264, 48],
    [157, 120],
    [345, 120],
    [482, 1],
    [511, 1],
    [100, 128],
    [108, 56],
    [124, 128],
    [125, 32],
    [135, 32],
    [148, 32],
    [329, 49],
    [270, 120],
    [45, 120],
    [512 + data.length, 1],
  ])("refuses malformed tar field/padding %i=%i", (offset, value) => {
    refused(changed(offset!, value!, offset !== 148));
  });
  test("checks header checksum and size bounds independent of gzip checksum", () => {
    refused(changed(100, 49, false));
    const oversize = record(`${include}/extra.h`, "0", Buffer.alloc(16 * 1024 * 1024 + 1));
    refused(tar([...members(), oversize]));
    refused(tar([...members(), record(`${include}/bad/`, "5", data)]));
    refused(tar([...members(), record(`${include}/truncated.h`, "0", data)]).subarray(0, -1537));
  });

  test.each([
    "/absolute.h",
    "C:/drive.h",
    `${include}/..\\escape.h`,
    `${include}/../escape.h`,
    `${include}//empty.h`,
    `${include}/./dot.h`,
    `${include}/CON.h`,
    `${include}/com1.h`,
    `${include}/alias.h.`,
    `${include}/name:stream.h`,
    `${include}/white space.h`,
    `${include}/short~1.h`,
    `${include}/.hidden.h`,
    `${include}/extra.mjs`,
    `${root}/outside.h`,
    `${include}/other.gypi`,
    `${include}/node_api.h/`,
    "node-v24.15.1/include/node/extra.h",
  ])("refuses path/layout alias %s", (path) =>
    refused(tar([...members(), record(path, "0", data)])),
  );
  test("refuses duplicate/case-colliding paths, missing directories and file-directory conflicts", () => {
    for (const extra of [
      record(`${include}/node_api.h`),
      record(`${include}/NODE_API.h`),
      directory(`${include}/node_api.h`),
      record(`${include}/node_api.h/child.h`),
      record(`${include}/missing/child.h`),
    ])
      refused(tar([...members(), extra]));
    refused(tar(members().slice(1)));
    refused(tar(members().slice(0, 3)));
  });
  test("refuses malformed, orphaned, nested and short or mismatched GNU long names", () => {
    const { path, metadata, file, prefix } = longFixture();
    const short = record("././@LongLink", "L", Buffer.from(`${include}/short.h\0`));
    for (const records of [
      [metadata],
      [metadata, metadata, file],
      [short, file],
      [record("wrong", "L", Buffer.from(`${path}\0`)), file],
      [record("././@LongLink", "L", Buffer.from(path)), file],
      [record("././@LongLink", "L", Buffer.from(`${path}\0\0`)), file],
      [record("././@LongLink", "L", Buffer.from(`${path.slice(0, -1)}\0h\0`)), file],
      [metadata, record(`${include}/different.h`, "0", data)],
    ])
      refused(tar([...prefix, ...records]));
    for (const path of [
      `${include}/${"a".repeat(256)}.h`,
      `${include}/${"a/".repeat(25)}b.h`,
      `${include}/${("a".repeat(60) + "/").repeat(18)}b.h`,
    ]) {
      refused(
        tar([
          ...members(),
          record("././@LongLink", "L", Buffer.from(`${path}\0`)),
          record(path, "0", data),
        ]),
      );
    }
  });
  test("requires complete zero terminal blocks and refuses all trailing data", () => {
    for (const tail of [
      Buffer.alloc(0),
      Buffer.alloc(512),
      Buffer.alloc(1025),
      Buffer.alloc(10752),
      Buffer.concat([Buffer.alloc(1024), record(`${include}/hidden.h`)]),
    ])
      refused(tar(members(), tail));
    const nonzero = Buffer.alloc(1536);
    nonzero[511] = 1;
    refused(tar(members(), nonzero));
    expect(read(tar(members(), Buffer.alloc(1024))).entries).toHaveLength(5);
  });
  test("bounds the raw-record census rather than just the regular-file count", () => {
    const records = members().slice(0, 3);
    for (let index = 0; index < 8190; index++) records.push(record(`${include}/h${index}.h`));
    expect(read(tar(records.slice(0, 8192))).tar.recordCount).toBe(8192);
    refused(tar(records));
  });
});
