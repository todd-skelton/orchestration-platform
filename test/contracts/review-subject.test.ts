import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as subjects from "../../packages/contracts/src/review-subject.js";

const workerSchema = "worker-result-subject/v1";
const candidateSchema = "release-candidate-subject/v1";
const union = "review-subject/v1";
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
const changedDigest = "9876543210abcdef".repeat(4);
const changedUuid = "01900000-0000-7000-8000-000000000099";

// Literal JSON, frame hex and SHA-256 constants were computed independently with
// PowerShell/.NET UTF-8, big-endian length bytes and SHA256.HashData, without contracts code.
const goldens = [
  {
    schema: workerSchema,
    text: '{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"kind":"TREE","treeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d726573756c742d7375626a6563742f763100000000010700000000000001eb7b22617574686f72417474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22617574686f724379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c2262617365536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c22726573756c74223a7b226b696e64223a2254524545222c2274726565446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161227d2c22736368656d6156657273696f6e223a22776f726b65722d726573756c742d7375626a6563742f7631222c227465726d696e616c52656365697074446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262227d0a",
    digest: "dfe5185c271a55670354b7668f858857757220534a3ef8fb9bfe77d84e6bbd7d",
  },
  {
    schema: workerSchema,
    text: '{"authorAttemptId":"01900000-0000-7000-8000-000000000001","authorCycleId":"01900000-0000-7000-8000-000000000002","baseSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"result":{"entries":[{"contentDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","kind":"PATCH"},{"contentDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","kind":"ARTIFACT"}],"kind":"ORDERED_PATCH_ARTIFACTS"},"schemaVersion":"worker-result-subject/v1","terminalReceiptDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00776f726b65722d726573756c742d7375626a6563742f763100000000010700000000000002857b22617574686f72417474656d70744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22617574686f724379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c2262617365536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c22726573756c74223a7b22656e7472696573223a5b7b22636f6e74656e74446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c226b696e64223a225041544348227d2c7b22636f6e74656e74446967657374223a2264646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464222c226b696e64223a224152544946414354227d5d2c226b696e64223a224f5244455245445f50415443485f415254494641435453227d2c22736368656d6156657273696f6e223a22776f726b65722d726573756c742d7375626a6563742f7631222c227465726d696e616c52656365697074446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262227d0a",
    digest: "697f7bb2bb7022c3bf82b59faf50894517237537da503af96f3483eea1dc7963",
  },
  {
    schema: candidateSchema,
    text: '{"assemblyCycleId":"01900000-0000-7000-8000-000000000004","candidateDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","certificationDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","landedSource":{"adapterId":"git","projectId":"01900000-0000-7000-8000-000000000003","revision":"abcdef0123456789abcdef0123456789abcdef01"},"landedTreeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","manifestDigest":"1111111111111111111111111111111111111111111111111111111111111111","schemaVersion":"release-candidate-subject/v1","testBundleDigest":"2222222222222222222222222222222222222222222222222222222222222222"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d0072656c656173652d63616e6469646174652d7375626a6563742f763100000000010700000000000002a47b22617373656d626c794379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303034222c2263616e646964617465446967657374223a2265656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565222c2263657274696669636174696f6e446967657374223a2266666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666222c226c616e646564536f75726365223a7b22616461707465724964223a22676974222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c227265766973696f6e223a2261626364656630313233343536373839616263646566303132333435363738396162636465663031227d2c226c616e64656454726565446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226d616e6966657374446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c22736368656d6156657273696f6e223a2272656c656173652d63616e6469646174652d7375626a6563742f7631222c227465737442756e646c65446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232227d0a",
    digest: "c78904448ccbd9e67f80b8ad5e0afee305e3eaa5328f1d24441970b37496b65b",
  },
] as const;

type MutableRecord = Record<string, unknown>;
const fixture = (index = 0): MutableRecord => JSON.parse(goldens[index]!.text) as MutableRecord;
const source = (index = 0): MutableRecord =>
  fixture(index)[index === 2 ? "landedSource" : "baseSource"] as MutableRecord;
const result = (index = 0): MutableRecord => fixture(index).result as MutableRecord;
const entries = (): MutableRecord[] => result(1).entries as MutableRecord[];

function parse(schema: string, input: unknown): contracts.ParseResult {
  return schema === workerSchema
    ? subjects.parseWorkerResultSubject(input)
    : subjects.parseReleaseCandidateSubject(input);
}
function compute(schema: string, input: unknown): string {
  return schema === workerSchema
    ? subjects.computeWorkerResultSubjectDigest(input)
    : subjects.computeReleaseCandidateSubjectDigest(input);
}
function refuse(schema: string, input: unknown): void {
  expect(parse(schema, input).ok).toBe(false);
  expect(subjects.parseReviewSubject(input).ok).toBe(false);
  for (const expected of [schema, union]) {
    expect(contracts.parseContract(expected, input).ok).toBe(false);
    expect(contracts.serializeContract(expected, input).ok).toBe(false);
  }
  expect(() => compute(schema, input)).toThrow(TypeError);
}
function shuffle(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(shuffle);
  if (input === null || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input)
      .reverse()
      .map(([key, value]) => [key, shuffle(value)]),
  );
}

describe("immutable review subjects", () => {
  test("pins complete literal bytes, frames and concrete identities through specialized, union and generic APIs", () => {
    for (const [index, golden] of goldens.entries()) {
      const input = fixture(index);
      expect(parse(golden.schema, input)).toEqual({ ok: true, value: input });
      expect(subjects.parseReviewSubject(input)).toEqual({ ok: true, value: input });
      expect(contracts.canonicalJson(input)).toBe(golden.text);
      expect(
        Buffer.from(
          contracts.framedBytes(golden.schema, [
            contracts.frame.canonical(input as contracts.ContractRecord),
          ]),
        ).toString("hex"),
      ).toBe(golden.frameHex);
      expect(sha(Buffer.from(golden.frameHex, "hex"))).toBe(golden.digest);
      expect(compute(golden.schema, input)).toBe(golden.digest);
      for (const expected of [golden.schema, union]) {
        expect(subjects.parseReviewSubjectContract(expected, input)).toEqual({
          ok: true,
          value: input,
        });
        expect(contracts.parseContract(expected, input)).toEqual({ ok: true, value: input });
        expect(contracts.parseCanonicalContractBytes(expected, encode(golden.text))).toEqual({
          ok: true,
          value: input,
        });
        const serialized = { ok: true, bytes: encode(golden.text), digest: golden.digest };
        expect(contracts.serializeContract(expected, input)).toEqual(serialized);
        expect(contracts.serializeContract(expected, shuffle(input))).toEqual(serialized);
        expect(contracts.compatibilityDisposition(expected, golden.schema)).toBe("readable");
      }
      // These are complete preimage frames, not identities of nested digests or a union rehash.
      expect(sha(golden.text)).not.toBe(golden.digest);
      for (const domain of [union, golden.schema === workerSchema ? candidateSchema : workerSchema])
        expect(
          contracts.framedDigest(domain, [
            contracts.frame.canonical(input as contracts.ContractRecord),
          ]),
        ).not.toBe(golden.digest);
      expect(
        contracts.framedDigest(golden.schema, [contracts.frame.raw32(sha(golden.text))]),
      ).not.toBe(golden.digest);
      const frame = Buffer.from(golden.frameHex, "hex");
      const prefixLength = Buffer.byteLength(`orchestration-platform\0${golden.schema}\0`);
      for (const [offset, replacement] of [
        [prefixLength + 3, 2],
        [prefixLength + 4, 1],
        [prefixLength + 12, 0],
      ] as const) {
        const changed = Buffer.from(frame);
        changed[offset] = replacement;
        expect(sha(changed)).not.toBe(golden.digest);
      }
      expect(sha(frame.subarray(0, frame.length - 1))).not.toBe(golden.digest);
    }
  });

  test("closes both concrete shapes and refuses alias envelopes, hybrid members and unknown versions", () => {
    for (const [expected, opposite] of [
      [workerSchema, fixture(2)],
      [candidateSchema, fixture()],
    ] as const) {
      expect(parse(expected, opposite).ok).toBe(false);
      expect(contracts.parseContract(expected, opposite).ok).toBe(false);
      expect(contracts.serializeContract(expected, opposite).ok).toBe(false);
      expect(
        contracts.parseCanonicalContractBytes(expected, encode(contracts.canonicalJson(opposite)))
          .ok,
      ).toBe(false);
      expect(() => compute(expected, opposite)).toThrow(TypeError);
      expect(contracts.compatibilityDisposition(expected, opposite.schemaVersion as string)).toBe(
        "refused",
      );
    }
    for (const [index, golden] of goldens.entries()) {
      for (const schemaVersion of [
        union,
        "unknown/v1",
        `${golden.schema}extra`,
        `${golden.schema}\n`,
        golden.schema.replace("/v1", "/v0"),
        golden.schema.replace("/v1", "/v2"),
        null,
      ])
        refuse(golden.schema, { ...fixture(index), schemaVersion });
      for (const input of [
        { schemaVersion: union },
        { schemaVersion: union, kind: golden.schema, subject: fixture(index) },
        { kind: golden.schema, subject: fixture(index) },
        { ...fixture(index), subjectDigest: golden.digest },
        { ...fixture(index), authority: "ACCEPTED" },
        { ...fixture(), ...fixture(2) },
      ])
        refuse(golden.schema, input);
    }
  });

  test("deletion, rename, addition, null and wrong types refuse at every record depth", () => {
    const cases: readonly [MutableRecord, (record: unknown) => void][] = [
      [fixture(), (input) => refuse(workerSchema, input)],
      [fixture(1), (input) => refuse(workerSchema, input)],
      [fixture(2), (input) => refuse(candidateSchema, input)],
      [source(), (input) => refuse(workerSchema, { ...fixture(), baseSource: input })],
      [source(2), (input) => refuse(candidateSchema, { ...fixture(2), landedSource: input })],
      [result(), (input) => refuse(workerSchema, { ...fixture(), result: input })],
      [result(1), (input) => refuse(workerSchema, { ...fixture(1), result: input })],
      [
        entries()[0]!,
        (input) =>
          refuse(workerSchema, { ...fixture(1), result: { ...result(1), entries: [input] } }),
      ],
    ];
    for (const [record, check] of cases) {
      for (const [field, value] of Object.entries(record)) {
        const removed = { ...record };
        delete removed[field];
        check(removed);
        check({ ...removed, [field.toUpperCase()]: value });
        for (const wrong of [null, undefined, true, 1, "", [], {}])
          check({ ...record, [field]: wrong });
      }
      for (const extra of [
        "extra",
        "schema",
        "schemaVersion",
        "path",
        "url",
        "timestamp",
        "review",
        "journalDigest",
        "verified",
        "__proto__",
      ])
        if (!Object.hasOwn(record, extra)) check({ ...record, [extra]: "forbidden" });
    }
  });

  test("UUID, digest and Id grammar are exact, bounded and namespace preserving", () => {
    const invalidIds = [
      "",
      "A",
      "Git",
      "_git",
      "-git",
      ".git",
      ":git",
      "git/branch",
      "git\\branch",
      "git branch",
      "file:///repo",
      "é",
      "a\u0000",
      "a\u007f",
      "a\ud800",
      "a\n",
      "a\r",
      "a\r\n",
      "a\u2028",
      "a".repeat(129),
    ];
    for (const index of [0, 2]) {
      const schema = goldens[index]!.schema;
      const sourceField = index === 2 ? "landedSource" : "baseSource";
      for (const field of ["adapterId", "revision"])
        for (const value of invalidIds)
          refuse(schema, {
            ...fixture(index),
            [sourceField]: { ...source(index), [field]: value },
          });
      for (const value of [
        "a",
        "0",
        "a".repeat(128),
        "0._:@+-",
        "main",
        "constructor",
        "__proto__".slice(2),
      ]) {
        const record = {
          ...fixture(index),
          [sourceField]: { ...source(index), adapterId: value, revision: value },
        };
        expect(parse(schema, record).ok).toBe(true);
      }
      const uuidFields = index === 2 ? ["assemblyCycleId"] : ["authorAttemptId", "authorCycleId"];
      for (const field of [...uuidFields, "projectId"])
        for (const value of [
          changedUuid.toUpperCase().replace("019", "ABC"),
          changedUuid.replace("7000", "4000"),
          changedUuid.replace("8000", "7000"),
          changedUuid.slice(1),
          `${changedUuid}0`,
          `${changedUuid}\n`,
          `${changedUuid}\r`,
        ]) {
          const record =
            field === "projectId"
              ? { ...fixture(index), [sourceField]: { ...source(index), projectId: value } }
              : { ...fixture(index), [field]: value };
          refuse(schema, record);
        }
    }
    const replaceDigests: readonly [string, (digest: string) => unknown][] = [
      [workerSchema, (digest) => ({ ...fixture(), terminalReceiptDigest: digest })],
      [workerSchema, (digest) => ({ ...fixture(), result: { kind: "TREE", treeDigest: digest } })],
      [
        workerSchema,
        (digest) => ({
          ...fixture(1),
          result: { ...result(1), entries: [{ kind: "PATCH", contentDigest: digest }] },
        }),
      ],
      ...[
        "candidateDigest",
        "certificationDigest",
        "landedTreeDigest",
        "manifestDigest",
        "testBundleDigest",
      ].map((field): [string, (digest: string) => unknown] => [
        candidateSchema,
        (digest) => ({ ...fixture(2), [field]: digest }),
      ]),
    ];
    for (const [schema, replace] of replaceDigests)
      for (const value of [
        "a".repeat(40),
        "a".repeat(63),
        "a".repeat(65),
        "A".repeat(64),
        "g".repeat(64),
        `${changedDigest}\n`,
        `${changedDigest}\r`,
        ` ${changedDigest}`,
      ])
        refuse(schema, replace(value));
  });

  test("TREE and ordered PATCH/ARTIFACT form a closed union with semantic order and multiplicity", () => {
    for (const changed of [
      { kind: "TREE", entries: entries() },
      { ...result(), entries: null },
      { ...result(1), treeDigest: null },
      { ...result(), ...result(1) },
      { kind: "PATCH", contentDigest: changedDigest },
      { kind: "ARTIFACT", contentDigest: changedDigest },
      { kind: "tree", treeDigest: changedDigest },
      { kind: "TREE\n", treeDigest: changedDigest },
      { kind: "ORDERED_PATCH_ARTIFACTS\n", entries: entries() },
      { kind: "constructor" },
      { kind: "__proto__" },
    ])
      refuse(workerSchema, { ...fixture(), result: changed });
    for (const kind of [
      "TREE",
      "ORDERED_PATCH_ARTIFACTS",
      "patch",
      "artifact",
      "PATCH\n",
      "constructor",
      "__proto__",
    ])
      refuse(workerSchema, {
        ...fixture(1),
        result: { ...result(1), entries: [{ contentDigest: changedDigest, kind }] },
      });
    const withEntries = (values: unknown) => ({
      ...fixture(1),
      result: { ...result(1), entries: values },
    });
    for (const length of [1, 4096]) {
      const record = withEntries(Array.from({ length }, () => entries()[0]!));
      expect(subjects.parseWorkerResultSubject(record).ok).toBe(true);
      const serialized = contracts.serializeContract(union, record);
      expect(serialized.ok).toBe(true);
      if (serialized.ok)
        expect(contracts.parseCanonicalContractBytes(union, serialized.bytes).ok).toBe(true);
    }
    for (const length of [0, 4097])
      refuse(workerSchema, withEntries(Array.from({ length }, () => entries()[0]!)));
    const original = compute(workerSchema, fixture(1));
    expect(compute(workerSchema, withEntries(entries().reverse()))).not.toBe(original);
    expect(compute(workerSchema, withEntries(entries().slice(0, 1)))).not.toBe(original);
    expect(compute(workerSchema, withEntries([...entries(), entries()[0]]))).not.toBe(original);
    expect(
      compute(workerSchema, withEntries([{ ...entries()[0], kind: "ARTIFACT" }, entries()[1]])),
    ).not.toBe(original);
    expect(
      compute(
        workerSchema,
        withEntries([{ ...entries()[0], contentDigest: changedDigest }, entries()[1]]),
      ),
    ).not.toBe(original);
    const repeated = [entries()[0]!, entries()[0]!];
    expect(subjects.parseWorkerResultSubject(withEntries(repeated)).ok).toBe(true);
    expect(compute(workerSchema, withEntries(repeated))).toBe(
      compute(workerSchema, withEntries([...repeated].reverse())),
    );
    expect(compute(workerSchema, withEntries(repeated))).not.toBe(
      compute(workerSchema, withEntries(repeated.slice(1))),
    );
  });

  test("reports detached deterministic issues for independently invalid nested references", () => {
    const input = {
      ...fixture(1),
      authorAttemptId: "invalid",
      baseSource: { ...source(), projectId: "invalid" },
      result: { ...result(1), entries: [entries()[0], { ...entries()[1], kind: "invalid" }] },
      terminalReceiptDigest: "invalid",
    };
    const expected = {
      ok: false,
      issues: [
        "authorAttemptId:invalid",
        "baseSource.projectId:invalid",
        "result.entries.1.kind:invalid",
        "terminalReceiptDigest:invalid",
      ],
    };
    expect(subjects.parseWorkerResultSubject(input)).toEqual(expected);
    expect(subjects.parseReviewSubject(input)).toEqual(expected);
    expect(contracts.serializeContract(union, input)).toEqual(expected);
    expect(subjects.parseReviewSubject({ schemaVersion: union })).toEqual({
      ok: false,
      issues: ["schemaVersion:unsupported"],
    });
  });

  test("every scalar preimage contributes to subject identity without claiming authentic upstream joins", () => {
    for (const [index, golden] of goldens.entries()) {
      const original = fixture(index);
      const sourceField = index === 2 ? "landedSource" : "baseSource";
      for (const [field, value] of Object.entries(original)) {
        if (field === "schemaVersion" || typeof value !== "string") continue;
        const changed = {
          ...original,
          [field]: field.endsWith("Id") ? changedUuid : changedDigest,
        };
        expect(parse(golden.schema, changed).ok).toBe(true);
        expect(compute(golden.schema, changed)).not.toBe(golden.digest);
      }
      for (const [field, value] of [
        ["adapterId", "other-adapter"],
        ["projectId", changedUuid],
        ["revision", "other-revision"],
      ]) {
        const changed = { ...original, [sourceField]: { ...source(index), [field!]: value } };
        expect(parse(golden.schema, changed).ok).toBe(true);
        expect(compute(golden.schema, changed)).not.toBe(golden.digest);
      }
    }
    expect(
      compute(workerSchema, { ...fixture(), result: { kind: "TREE", treeDigest: changedDigest } }),
    ).not.toBe(goldens[0].digest);
    // A branch-shaped token or copied reference has valid shape. No actual adapter,
    // terminal receipt, role, producer, candidate or certification was supplied here.
    expect(
      subjects.parseWorkerResultSubject({
        ...fixture(),
        baseSource: { ...source(), revision: "main" },
      }).ok,
    ).toBe(true);
    expect(
      subjects.parseWorkerResultSubject({ ...fixture(), authorCycleId: fixture().authorAttemptId })
        .ok,
    ).toBe(true);
    expect(
      subjects.parseReleaseCandidateSubject({ ...fixture(2), certificationDigest: changedDigest })
        .ok,
    ).toBe(true);
    for (const field of [
      "terminalReceipt",
      "role",
      "sourceVerified",
      "materialized",
      "accepted",
      "certified",
      "promotionAuthority",
      "producerIdentities",
      "reviewer",
    ])
      for (const index of [0, 2])
        refuse(goldens[index]!.schema, { ...fixture(index), [field]: true });
  });

  test("canonical byte parsing refuses alternate spellings, duplicate members and malformed encoding", () => {
    for (const golden of goldens) {
      for (const text of [
        golden.text.trimEnd(),
        `${golden.text}\n`,
        ` ${golden.text}`,
        golden.text.replace(/\n$/, "\r\n"),
        `\ufeff${golden.text}`,
        golden.text.replace('"schemaVersion":', '"schemaVersion": '),
        golden.text.replace('"adapterId":', '"adapterId":"other","adapterId":'),
        golden.text.replace('"schemaVersion":', '"schemaVersion":"unknown/v1","schemaVersion":'),
        golden.text.replace('"git"', '"g\\u0069t"'),
        `${JSON.stringify(shuffle(JSON.parse(golden.text)))}\n`,
        "null\n",
        "[]\n",
        "{}\n",
        "{",
        "",
      ])
        for (const expected of [golden.schema, union])
          expect(contracts.parseCanonicalContractBytes(expected, encode(text)).ok).toBe(false);
      for (const expected of [golden.schema, union]) {
        expect(
          contracts.parseCanonicalContractBytes(expected, new Uint8Array([0xff, 0xfe])).ok,
        ).toBe(false);
        expect(contracts.parseCanonicalContractBytes(expected, Buffer.from(golden.text)).ok).toBe(
          true,
        );
      }
    }
  });

  test("hostile records at every depth refuse without input code and accepted snapshots detach", () => {
    let calls = 0;
    const called = (): never => {
      calls++;
      throw new Error("input code executed");
    };
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const cases: readonly [MutableRecord, (input: unknown) => unknown, string][] = [
      [fixture(), (input) => input, workerSchema],
      [fixture(1), (input) => input, workerSchema],
      [fixture(2), (input) => input, candidateSchema],
      [source(), (input) => ({ ...fixture(), baseSource: input }), workerSchema],
      [source(2), (input) => ({ ...fixture(2), landedSource: input }), candidateSchema],
      [result(), (input) => ({ ...fixture(), result: input }), workerSchema],
      [result(1), (input) => ({ ...fixture(1), result: input }), workerSchema],
      [
        entries()[0]!,
        (input) => ({ ...fixture(1), result: { ...result(1), entries: [input] } }),
        workerSchema,
      ],
    ];
    for (const [record, wrap, schema] of cases) {
      const first = Object.keys(record)[0]!;
      const cyclic: MutableRecord = { ...record };
      cyclic.loop = cyclic;
      class Derived {
        constructor() {
          Object.assign(this, record);
        }
      }
      for (const bad of [
        null,
        undefined,
        true,
        0,
        1n,
        Symbol("record"),
        "record",
        [],
        called,
        new Date(),
        new Map(),
        new Derived(),
        Object.create(record),
        Object.assign(Object.create({ inherited: true }), record),
        new Proxy(record, {}),
        new Proxy(record, {
          get: called,
          ownKeys: called,
          getPrototypeOf: called,
          getOwnPropertyDescriptor: called,
        }),
        revoked.proxy,
        cyclic,
        { ...record, toJSON: called },
        { ...record, [Symbol("extra")]: true },
        Object.defineProperty({ ...record }, first, { get: called }),
        Object.defineProperty({ ...record }, first, { enumerable: false }),
        runInNewContext(`(${JSON.stringify(record)})`),
      ])
        refuse(schema, wrap(bad));
      expect(parse(schema, wrap(Object.assign(Object.create(null), record))).ok).toBe(true);
    }
    const input = fixture(1);
    const parsed = subjects.parseReviewSubject(input);
    expect(parsed.ok).toBe(true);
    if (
      !parsed.ok ||
      parsed.value.schemaVersion !== workerSchema ||
      parsed.value.result.kind !== "ORDERED_PATCH_ARTIFACTS"
    )
      throw new Error("fixture refused");
    for (const value of [
      parsed.value,
      parsed.value.baseSource,
      parsed.value.result,
      parsed.value.result.entries,
      ...parsed.value.result.entries,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    (input.baseSource as MutableRecord).revision = "moved";
    const inputEntries = (input.result as MutableRecord).entries as MutableRecord[];
    inputEntries[0]!.contentDigest = changedDigest;
    inputEntries.reverse();
    expect(contracts.serializeContract(union, parsed.value)).toEqual({
      ok: true,
      bytes: encode(goldens[1].text),
      digest: goldens[1].digest,
    });
    expect(calls).toBe(0);
  });

  test("hostile arrays, entries and reflective byte views invoke no input code", () => {
    let calls = 0;
    const called = (): never => {
      calls++;
      throw new Error("input code executed");
    };
    const values = entries();
    const revokedArray = Proxy.revocable(values, {});
    revokedArray.revoke();
    class DerivedArray extends Array<unknown> {}
    const wrap = (input: unknown) => ({ ...fixture(1), result: { ...result(1), entries: input } });
    for (const bad of [
      null,
      {},
      "entries",
      new Array(1),
      new DerivedArray(...values),
      Object.assign([...values], { extra: true }),
      Object.assign([...values], { [Symbol("extra")]: true }),
      Object.defineProperty([...values], Symbol.iterator, { value: called }),
      Object.defineProperty([...values], "0", { get: called }),
      Object.defineProperty([...values], "0", { enumerable: false }),
      Object.setPrototypeOf([...values], null),
      Object.setPrototypeOf([...values], new Proxy(Array.prototype, { get: called })),
      new Proxy(values, {}),
      new Proxy(values, { get: called, ownKeys: called, getPrototypeOf: called }),
      revokedArray.proxy,
      runInNewContext(JSON.stringify(values)),
    ])
      refuse(workerSchema, wrap(bad));
    for (const accepted of [
      [...values],
      Object.seal([...values]),
      Object.freeze([...values]),
      Object.defineProperty([...values], "length", { writable: false }),
    ])
      expect(subjects.parseWorkerResultSubject(wrap(accepted)).ok).toBe(true);
    for (const golden of goldens) {
      const bytes = encode(golden.text);
      const revokedBytes = Proxy.revocable(bytes, {});
      revokedBytes.revoke();
      class DerivedBytes extends Uint8Array {}
      for (const bad of [
        null,
        {},
        [],
        golden.text,
        new DerivedBytes(bytes),
        new Uint16Array(),
        new DataView(new ArrayBuffer(8)),
        new ArrayBuffer(8),
        Object.create(Uint8Array.prototype),
        Object.setPrototypeOf(new Uint16Array(), Uint8Array.prototype),
        Object.setPrototypeOf(
          new Uint8Array(),
          new Proxy(Uint8Array.prototype, { get: called, getPrototypeOf: called }),
        ),
        new Proxy(bytes, {}),
        new Proxy(bytes, { get: called, getPrototypeOf: called }),
        revokedBytes.proxy,
      ])
        for (const expected of [golden.schema, union])
          expect(contracts.parseCanonicalContractBytes(expected, bad as Uint8Array)).toEqual({
            ok: false,
            issues: ["encoding:bytes-required"],
          });
      for (const field of ["length", "byteLength", "buffer", "byteOffset", Symbol.iterator])
        Object.defineProperty(bytes, field, { get: called });
      for (const expected of [golden.schema, union])
        expect(contracts.parseCanonicalContractBytes(expected, bytes).ok).toBe(true);
      const detached = encode(golden.text);
      const detachedBuffer = detached.buffer as ArrayBuffer;
      structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
      for (const expected of [golden.schema, union])
        expect(contracts.parseCanonicalContractBytes(expected, detached).ok).toBe(false);
    }
    expect(calls).toBe(0);
  });

  test("public census contains two concrete families, complete alias dispatch and no invented authority", () => {
    expect(Object.keys(subjects).sort()).toEqual([
      "computeReleaseCandidateSubjectDigest",
      "computeWorkerResultSubjectDigest",
      "parseReleaseCandidateSubject",
      "parseReviewSubject",
      "parseReviewSubjectContract",
      "parseWorkerResultSubject",
      "reviewSubjectSchemaFields",
      "reviewSubjectSchemaVersions",
    ]);
    for (const [name, value] of Object.entries(subjects))
      expect(Object.entries(contracts).find(([key]) => key === name)?.[1]).toBe(value);
    expect(subjects.reviewSubjectSchemaVersions).toEqual([workerSchema, candidateSchema]);
    expect(contracts.schemaVersions.filter((name) => name.endsWith("-subject/v1"))).toEqual([
      candidateSchema,
      workerSchema,
    ]);
    expect(contracts.schemaVersions).not.toContain(union);
    expect(contracts.schemaDefinitions[union]).toBeUndefined();
    expect(contracts.schemaVocabularyDefinitions[union]).toBeUndefined();
    expect(subjects.reviewSubjectSchemaFields).toEqual({
      source: ["adapterId", "projectId", "revision"],
      worker: [
        "authorAttemptId",
        "authorCycleId",
        "baseSource",
        "result",
        "schemaVersion",
        "terminalReceiptDigest",
      ],
      tree: ["kind", "treeDigest"],
      ordered: ["entries", "kind"],
      entry: ["contentDigest", "kind"],
      candidate: [
        "assemblyCycleId",
        "candidateDigest",
        "certificationDigest",
        "landedSource",
        "landedTreeDigest",
        "manifestDigest",
        "schemaVersion",
        "testBundleDigest",
      ],
    });
    for (const [key, fields, closedValues] of [
      [workerSchema, subjects.reviewSubjectSchemaFields.worker, undefined],
      [`${workerSchema}#source`, subjects.reviewSubjectSchemaFields.source, undefined],
      [`${workerSchema}#TREE`, subjects.reviewSubjectSchemaFields.tree, ["TREE"]],
      [
        `${workerSchema}#ORDERED_PATCH_ARTIFACTS`,
        subjects.reviewSubjectSchemaFields.ordered,
        ["ORDERED_PATCH_ARTIFACTS"],
      ],
      [`${workerSchema}#entry`, subjects.reviewSubjectSchemaFields.entry, ["PATCH", "ARTIFACT"]],
      [candidateSchema, subjects.reviewSubjectSchemaFields.candidate, undefined],
      [`${candidateSchema}#source`, subjects.reviewSubjectSchemaFields.source, undefined],
    ] as const) {
      expect(contracts.schemaVocabularyDefinitions[key]?.fields).toEqual(fields);
      expect(contracts.schemaVocabularyDefinitions[key]?.closedValues).toEqual(closedValues);
    }
    expect(
      contracts.compatibilityMatrix.filter(
        ({ expectedSchemaVersion }) => expectedSchemaVersion === union,
      ),
    ).toEqual(
      [
        workerSchema,
        candidateSchema,
        union,
        "review-subject/v0-fixture",
        "review-subject/v999",
        null,
      ].map((observedSchemaVersion) => ({
        expectedSchemaVersion: union,
        observedSchemaVersion,
        disposition:
          observedSchemaVersion === workerSchema || observedSchemaVersion === candidateSchema
            ? "readable"
            : "refused",
      })),
    );
    for (const schema of [
      "source-reference/v1",
      "worker-result/v1",
      "worker-result-entry/v1",
      "result-tree/v1",
      "orchestration-event/v1",
      "event-journal/v1",
      "reduced-state/v1",
      "cycle-receipt/v1",
      "worker-terminal-receipt/v1",
      "review-attempt-result/v1",
      "review-authority/v1",
      "worker-result-subject/v2",
      "release-candidate-subject/v2",
      "review-subject/v2",
    ]) {
      expect(contracts.schemaVersions).not.toContain(schema);
      expect(subjects.parseReviewSubjectContract(schema, fixture())).toBeNull();
      expect(contracts.parseContract(schema, fixture()).ok).toBe(false);
      expect(contracts.parseCanonicalContractBytes(schema, encode(goldens[0].text)).ok).toBe(false);
      expect(contracts.serializeContract(schema, fixture()).ok).toBe(false);
      expect(contracts.compatibilityDisposition(schema, schema)).toBe("refused");
    }
    // The old private prototype's empty record must not become a public subject.
    refuse(workerSchema, { schemaVersion: workerSchema });
  });
});
