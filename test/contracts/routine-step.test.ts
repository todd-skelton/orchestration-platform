import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as routine from "../../packages/contracts/src/routine-step.js";

const schema = "routine-step-skip/v1";
const cycleId = "01900000-0000-7000-8000-000000000001";
const inputDigest = "a".repeat(64);
const prefixDigest = "b".repeat(64);
const kinds = [
  "session.verify",
  "project.snapshot",
  "breaker.reduce",
  "module.plan",
  "route.select",
  "project.preflight",
  "dispatch.plan",
  "worker.dispatch",
  "worker.observe",
  "review.reduce",
  "disposition.plan",
  "mutation.plan",
  "action.apply",
  "resource.reclaim",
  "cycle.terminal",
] as const;
const routes = {
  "prior-known-terminal": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  "no-allocation": [7],
  "no-worker": [8, 9],
  "no-review": [10],
  "no-mutation": [12, 13],
};
const step = (ordinal = 2) => ({
  cycleId,
  inputDigest,
  kind: kinds[ordinal - 1]!,
  ordinal: String(ordinal),
  predecessorJournalDigest: ordinal === 1 ? null : prefixDigest,
});
const skip = (ordinal = 2, reason = "prior-known-terminal") => ({
  reason,
  schemaVersion: schema,
  step: step(ordinal),
});
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const literalStep = (ordinal: number): string =>
  `{"cycleId":"${cycleId}","inputDigest":"${inputDigest}","kind":"${kinds[ordinal - 1]}","ordinal":"${ordinal}","predecessorJournalDigest":${ordinal === 1 ? "null" : `"${prefixDigest}"`}}`;
const literalSkip = (ordinal: number, reason: string): string =>
  `{"reason":"${reason}","schemaVersion":"routine-step-skip/v1","step":${literalStep(ordinal)}}\n`;

// Independent literal-byte SHA-256 vectors; no contract serializer or framing helper generated them.
// reason, ordinal, untagged Dstep, one-canonical-part Dskip
const goldens = [
  [
    "prior-known-terminal",
    "2",
    "91c6f9ee667ac26b7c74b167d27f5b27a7a7558b1e3615d9846deb325596e082",
    "1fef8ec1bd2ada48f4aeb29f3adf5c0481189ba022a9e3f9c1209cbd9bdaf3ee",
  ],
  [
    "prior-known-terminal",
    "3",
    "c8a8df97e1a5bc6120930380d9476bdb1cf6f117a757aa7932bf608fc8e44ae5",
    "7f7131b4b95eeb726808b3d709cb99d75b2a94d53f518ca1f2628c620deb2535",
  ],
  [
    "prior-known-terminal",
    "4",
    "6cff8d3b06aeed416041a25e08c075c3132ec5d00713eb3cefd0460f4e4ca30c",
    "3b74c671e1487e4e08985845074fe73f3626f7f6a15ff8d9eb106fa85877131e",
  ],
  [
    "prior-known-terminal",
    "5",
    "f2ef5cfa9328726d480ff2221fde55aaf393b08cf85888d4a8a8dbec9785735d",
    "8f234dc6d5fe5f74c0f91785fde2d4990f6206f5332434a5d695baf600fdd9c8",
  ],
  [
    "prior-known-terminal",
    "6",
    "1b698c87b573fb3914e94783bedaade107d81b298069b99757c60d7851600126",
    "d8ea7c5690f7b3ccb5a082e5c15eed8139774a80b1208d16f4d634cd818dbf1c",
  ],
  [
    "prior-known-terminal",
    "7",
    "d033809ebb4ed1de00dcc0e0ccaefb52664a4bda45b446a7c1cfb925e6e449ff",
    "f8cd1cb104e3980ae34868fc310e06913560470793ddf20deab9b3d072e85955",
  ],
  [
    "prior-known-terminal",
    "8",
    "00c267d62e834903428082636f1d4b20eb309fdc38b1c3e960a0f3a4eaa45d01",
    "975acd03d526555bee9e0b87a65b52663130128c434e2f6ae139662add30c9b8",
  ],
  [
    "prior-known-terminal",
    "9",
    "292d43b4a53bd1907b1b29636d1825a1d5b0c736d73ec9f8c97b10c6304a4f1d",
    "89705a480b166a0d7f1a80a82067907434f6cb5b8c39b6aa66805155ab5c3f02",
  ],
  [
    "prior-known-terminal",
    "10",
    "ab59b0a1d7ce3969c0d868b860ef1d8ec57944d2bedd2270fbdb771acdfd955d",
    "7247fd7d59fde616796f34dc706afd39e93529239db2a9c3410855a74a14b378",
  ],
  [
    "prior-known-terminal",
    "11",
    "1c78e590c673d25f6ccb648054a6b25fb9409a6ab711b24b7b32004101963a19",
    "682c2c4a2f52ff3c6ca8e6787d18cf372ad4d6cc34e06e7cd78dc0b9fe1963c7",
  ],
  [
    "prior-known-terminal",
    "12",
    "c64d3248fe5fc0e300d2c08a3f8c7ac6a68253bc539b755aa3fdd782d1a7a031",
    "199856ae19e0447265a33a19fb797360be85ce1f2102c4bcdb41491a752e8137",
  ],
  [
    "prior-known-terminal",
    "13",
    "31d80355e989baaae9b3abf8c8fa9c40e5fa36eb3caa5892f30851ac4bf63f5a",
    "d8c4c883fad566181bed67de1977a1ad0d78a74a13180797de59b98c42af8b24",
  ],
  [
    "no-allocation",
    "7",
    "d033809ebb4ed1de00dcc0e0ccaefb52664a4bda45b446a7c1cfb925e6e449ff",
    "5144f8982c419da474166ddd8bea8b288356b93be657139da288261954b3bae7",
  ],
  [
    "no-worker",
    "8",
    "00c267d62e834903428082636f1d4b20eb309fdc38b1c3e960a0f3a4eaa45d01",
    "48c623e0095353dc3ce92b513343415890a64657e9e385d3561fb67881e45924",
  ],
  [
    "no-worker",
    "9",
    "292d43b4a53bd1907b1b29636d1825a1d5b0c736d73ec9f8c97b10c6304a4f1d",
    "18ff454a17b810a65544111267a22ac1b7079f1e6850c02217b8cb977b61b709",
  ],
  [
    "no-review",
    "10",
    "ab59b0a1d7ce3969c0d868b860ef1d8ec57944d2bedd2270fbdb771acdfd955d",
    "b9d809f57d01313218af9d1319b0f4544cc0a703f5be7520452373fd473d06a2",
  ],
  [
    "no-mutation",
    "12",
    "c64d3248fe5fc0e300d2c08a3f8c7ac6a68253bc539b755aa3fdd782d1a7a031",
    "1770605a3fd89b223b74562a95c32eabf8357f70bed729969fc66c339fb046f0",
  ],
  [
    "no-mutation",
    "13",
    "31d80355e989baaae9b3abf8c8fa9c40e5fa36eb3caa5892f30851ac4bf63f5a",
    "e9cc23b72efced2b45bd1fd8e8d265d9f54ef404daf09b122aeb40a75c21618e",
  ],
] as const;

function refuseIdentity(input: unknown): void {
  expect(contracts.parseRoutineStepIdentity(input).ok).toBe(false);
  expect(() => contracts.computeRoutineStepDigest(input)).toThrow(TypeError);
  refuseSkip({ ...skip(), step: input });
}
function refuseSkip(input: unknown): void {
  expect(contracts.parseRoutineStepSkip(input).ok).toBe(false);
  expect(contracts.parseContract(schema, input).ok).toBe(false);
  expect(contracts.serializeContract(schema, input).ok).toBe(false);
  expect(() => contracts.computeRoutineStepSkipDigest(input)).toThrow(TypeError);
}

describe("routine inline step identity and skip", () => {
  test("pins all 15 identity pairs, initial null and every negative kind/ordinal pairing", () => {
    expect(contracts.routineStepKinds).toEqual(
      Object.fromEntries(kinds.map((kind, i) => [String(i + 1), kind])),
    );
    for (let ordinal = 1; ordinal <= 15; ordinal++) {
      const identity = step(ordinal);
      expect(contracts.parseRoutineStepIdentity(identity)).toEqual({ ok: true, value: identity });
      expect(contracts.canonicalJson(identity)).toBe(`${literalStep(ordinal)}\n`);
      expect(contracts.computeRoutineStepDigest(identity)).toBe(sha(`${literalStep(ordinal)}\n`));
      for (const kind of kinds) if (kind !== identity.kind) refuseIdentity({ ...identity, kind });
      refuseIdentity({
        ...identity,
        predecessorJournalDigest: ordinal === 1 ? prefixDigest : null,
      });
    }
    for (const ordinal of [
      1,
      2,
      15,
      0,
      "0",
      "16",
      "01",
      "02",
      "1.0",
      "1e0",
      "+1",
      "-1",
      "2\n",
      " 2",
      "9007199254740991",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ])
      refuseIdentity({ ...step(), ordinal });
  });

  test("pins every reason/ordinal route and refuses every other pairing, including reclamation", () => {
    expect(contracts.routineStepSkipOrdinals).toEqual(
      Object.fromEntries(
        Object.entries(routes).map(([reason, ordinals]) => [reason, ordinals.map(String)]),
      ),
    );
    expect(goldens.map(([reason, ordinal]) => `${reason}:${ordinal}`)).toEqual(
      Object.entries(routes).flatMap(([reason, ordinals]) =>
        ordinals.map((ordinal) => `${reason}:${ordinal}`),
      ),
    );
    for (const [reason, allowed] of Object.entries(routes))
      for (let ordinal = 1; ordinal <= 15; ordinal++) {
        const value = skip(ordinal, reason);
        if (allowed.includes(ordinal)) expect(contracts.parseRoutineStepSkip(value).ok).toBe(true);
        else refuseSkip(value);
      }
    for (const reason of [
      "UNKNOWN",
      "known-terminal",
      "no-resources",
      "NO-WORKER",
      "no-worker\n",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ])
      refuseSkip({ ...skip(), reason });
  });

  test("pins literal bytes, Dstep and Dskip for all 18 admitted reason/ordinal cells", () => {
    for (const [reason, ordinal, dstep, dskip] of goldens) {
      const value = skip(Number(ordinal), reason);
      const text = literalSkip(Number(ordinal), reason);
      expect(contracts.computeRoutineStepDigest(value.step)).toBe(dstep);
      expect(contracts.computeRoutineStepSkipDigest(value)).toBe(dskip);
      expect(contracts.serializeContract(schema, value)).toEqual({
        ok: true,
        bytes: encode(text),
        digest: dskip,
      });
      expect(contracts.parseCanonicalContractBytes(schema, encode(text))).toEqual({
        ok: true,
        value,
      });
      const shuffled = {
        step: Object.fromEntries(Object.entries(value.step).reverse()),
        schemaVersion: schema,
        reason,
      };
      expect(contracts.serializeContract(schema, shuffled)).toEqual(
        contracts.serializeContract(schema, value),
      );
      expect(contracts.computeRoutineStepDigest(shuffled.step)).toBe(dstep);
      expect(sha(text)).not.toBe(dskip);
      expect(
        contracts.framedDigest("routine-step-skip/v1", [contracts.frame.raw32(dstep)]),
      ).not.toBe(dskip);
      expect(
        contracts.framedDigest("routine-step-skip/v1", [contracts.frame.canonical(value.step)]),
      ).not.toBe(dstep);
      expect(contracts.framedDigest("other/v1", [contracts.frame.canonical(value)])).not.toBe(
        dskip,
      );
    }
  });

  test("closes every field, scalar, exact grammar and nullability", () => {
    for (const [record, refuse] of [
      [step(), refuseIdentity],
      [skip(), refuseSkip],
    ] as const) {
      for (const [field, value] of Object.entries(record)) {
        const removed: Record<string, unknown> = { ...record };
        delete removed[field];
        refuse(removed);
        refuse({ ...removed, [field.toUpperCase()]: value });
        for (const wrong of [null, undefined, true, 1, "", [], {}])
          refuse({ ...record, [field]: wrong });
      }
      for (const field of [
        "schemaVersion",
        "Dstep",
        "Dskip",
        "result",
        "attempt",
        "timestamp",
        "extension",
        "manifest",
        "authority",
        "__proto__",
      ])
        if (!Object.hasOwn(record, field)) refuse({ ...record, [field]: "extra" });
    }
    for (const cycle of [
      cycleId.replace("000001", "ABCDEF"),
      cycleId.replace("7000", "4000"),
      cycleId.replace("8000", "7000"),
      `${cycleId}\n`,
      `${cycleId}\r`,
      cycleId.slice(1),
      `${cycleId}0`,
    ])
      refuseIdentity({ ...step(), cycleId: cycle });
    for (const field of ["inputDigest", "predecessorJournalDigest"])
      for (const digest of [
        "A".repeat(64),
        "a".repeat(63),
        "a".repeat(65),
        `${inputDigest}\n`,
        `${inputDigest}\r`,
        "g".repeat(64),
      ])
        refuseIdentity({ ...step(), [field]: digest });
    for (const kind of [
      "PROJECT.SNAPSHOT",
      "project.snapshot\n",
      "project.snapshot ",
      "worker.terminal",
      "constructor",
    ])
      refuseIdentity({ ...step(), kind });
    for (const version of [
      "routine-step-skip/v0",
      "routine-step-skip/v2",
      "routine-step-skip/v999",
      `${schema}\n`,
    ])
      refuseSkip({ ...skip(), schemaVersion: version });
  });

  test("persisted bytes refuse noncanonical spelling and malformed content", () => {
    const text = literalSkip(2, "prior-known-terminal");
    for (const bad of [
      text.trimEnd(),
      `${text}\n`,
      ` ${text}`,
      text.replace(/\n$/, "\r\n"),
      `\ufeff${text}`,
      text.replace('"reason":', '"reason": '),
      text.replace('"reason":', '"reason":"no-worker","reason":'),
      `${JSON.stringify({ step: step(), schemaVersion: schema, reason: "prior-known-terminal" })}\n`,
      text.replace("project.snapshot", "project\\u002esnapshot"),
      text.replace('"ordinal":"2"', '"ordinal":2'),
      text.replace('"step":{', '"step":{"extra":1,'),
      text.replace('"step":{', '"step":{"cycleId":"wrong",'),
      text.replace('"reason":"prior-known-terminal"', '"reason":"UNKNOWN"'),
      "{}\n",
      "null\n",
      "[]\n",
      "{",
      "",
    ])
      expect(contracts.parseCanonicalContractBytes(schema, encode(bad)).ok).toBe(false);
    expect(contracts.parseCanonicalContractBytes(schema, new Uint8Array([0xff, 0xfe])).ok).toBe(
      false,
    );
  });

  test("snapshots outer/nested records without executing input code and detaches accepted values", () => {
    let calls = 0;
    const called = (): never => {
      calls++;
      throw new Error("input code executed");
    };
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const [value, refuse] of [
      [step(), refuseIdentity],
      [skip(), refuseSkip],
    ] as const) {
      const cyclic: Record<string, unknown> = { ...value };
      cyclic.loop = cyclic;
      const field = Object.keys(value)[0]!;
      for (const bad of [
        null,
        undefined,
        Symbol("record"),
        1n,
        true,
        1,
        "record",
        [],
        called,
        new Date(),
        new Map(),
        Object.create(value),
        Object.assign(Object.create({ inherited: true }), value),
        new Proxy(value, { get: called, ownKeys: called, getPrototypeOf: called }),
        new Proxy(value, {}),
        revoked.proxy,
        cyclic,
        { ...value, toJSON: called },
        { ...value, [Symbol("extra")]: 1 },
        Object.defineProperty({ ...value }, field, { get: called }),
        Object.defineProperty({ ...value }, field, { enumerable: false }),
      ])
        refuse(bad);
    }
    const input = skip();
    const parsed = contracts.parseRoutineStepSkip(input);
    const serialized = contracts.serializeContract(schema, input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("fixture refused");
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.step)).toBe(true);
    input.step.inputDigest = "c".repeat(64);
    input.reason = "UNKNOWN";
    expect(parsed.value).toEqual(skip());
    expect(contracts.serializeContract(schema, parsed.value)).toEqual(serialized);
    expect(contracts.parseRoutineStepSkip(Object.assign(Object.create(null), skip())).ok).toBe(
      true,
    );
    expect(calls).toBe(0);
  });

  test("admits native Uint8Array and Buffer with intrinsic byte access, refusing spoofed views", () => {
    let calls = 0;
    const called = (): never => {
      calls++;
      throw new Error("byte input code executed");
    };
    const bytes = encode(literalSkip(2, "prior-known-terminal"));
    const hostile = new Uint8Array();
    Object.setPrototypeOf(
      hostile,
      new Proxy(Uint8Array.prototype, { getPrototypeOf: called, get: called }),
    );
    const revoked = Proxy.revocable(bytes, {});
    revoked.revoke();
    class Derived extends Uint8Array {}
    for (const bad of [
      hostile,
      new Derived(bytes),
      Object.setPrototypeOf(new Uint16Array(), Uint8Array.prototype),
      new Proxy(bytes, { get: called, getPrototypeOf: called }),
      new Proxy(bytes, {}),
      revoked.proxy,
      Object.create(Uint8Array.prototype),
      new DataView(new ArrayBuffer(8)),
      new Uint16Array(),
      new ArrayBuffer(8),
      null,
      {},
      [],
      "bytes",
    ])
      expect(contracts.parseCanonicalContractBytes(schema, bad as Uint8Array)).toEqual({
        ok: false,
        issues: ["encoding:bytes-required"],
      });
    for (const field of ["length", "byteLength", "buffer", "byteOffset", Symbol.iterator])
      Object.defineProperty(bytes, field, { get: called });
    expect(contracts.parseCanonicalContractBytes(schema, bytes).ok).toBe(true);
    expect(
      contracts.parseCanonicalContractBytes(
        schema,
        Buffer.from(literalSkip(2, "prior-known-terminal")),
      ).ok,
    ).toBe(true);
    const detached = encode(literalSkip(2, "prior-known-terminal"));
    const detachedBuffer = detached.buffer as ArrayBuffer;
    structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
    expect(contracts.parseCanonicalContractBytes(schema, detached).ok).toBe(false);
    expect(calls).toBe(0);
  });

  test("content identity retains resume bytes and distinguishes changed preimages without asserting route authority", () => {
    const original = skip();
    const dstep = contracts.computeRoutineStepDigest(original.step);
    const dskip = contracts.computeRoutineStepSkipDigest(original);
    expect(
      contracts.computeRoutineStepSkipDigest(JSON.parse(literalSkip(2, "prior-known-terminal"))),
    ).toBe(dskip);
    for (const change of [
      { cycleId: "01900000-0000-7000-8000-000000000002" },
      { inputDigest: "c".repeat(64) },
      { predecessorJournalDigest: "c".repeat(64) },
      { ordinal: "3", kind: "breaker.reduce" },
    ]) {
      const changed = { ...original, step: { ...original.step, ...change } };
      expect(contracts.parseRoutineStepSkip(changed).ok).toBe(true);
      expect(contracts.computeRoutineStepDigest(changed.step)).not.toBe(dstep);
      expect(contracts.computeRoutineStepSkipDigest(changed)).not.toBe(dskip);
    }
    const next = { ...skip(3), step: { ...step(3), inputDigest: dskip } };
    expect(contracts.parseRoutineStepSkip(next).ok).toBe(true);
    // Only a later composed validator can refuse the reused stop digest or prove the journal.
    expect(contracts.parseRoutineStepSkip(skip(3)).ok).toBe(true);
    expect(contracts.computeRoutineStepSkipDigest(next)).not.toBe(
      contracts.computeRoutineStepSkipDigest(skip(3)),
    );
    for (const [reason, ordinal] of [
      ["no-allocation", 7],
      ["no-worker", 9],
      ["no-review", 10],
      ["no-mutation", 13],
    ] as const)
      expect(contracts.parseRoutineStepSkip(skip(ordinal, reason)).ok).toBe(true);
    // These structural successes did not supply a manifest, prior terminal, review or disposition.
    for (const authority of [
      "manifest",
      "priorTerminal",
      "journal",
      "reviewAuthority",
      "resourcesAbsent",
    ])
      refuseSkip({ ...skip(7, "no-allocation"), [authority]: true });
  });

  test("publishes exactly one family, inline vocabulary, compatibility and pure exports", () => {
    expect(Object.keys(routine).sort()).toEqual([
      "computeRoutineStepDigest",
      "computeRoutineStepSkipDigest",
      "parseRoutineStepIdentity",
      "parseRoutineStepSkip",
      "parseRoutineStepSkipContract",
      "routineStepKinds",
      "routineStepSchemaFields",
      "routineStepSkipOrdinals",
      "routineStepSkipSchemaVersions",
    ]);
    for (const [name, value] of Object.entries(routine))
      expect(Object.entries(contracts).find(([key]) => key === name)?.[1]).toBe(value);
    expect(contracts.routineStepSkipSchemaVersions).toEqual([schema]);
    expect(contracts.schemaVersions.filter((name) => name.startsWith("routine-"))).toEqual([
      schema,
    ]);
    expect(contracts.routineStepSchemaFields).toEqual({
      identity: ["cycleId", "inputDigest", "kind", "ordinal", "predecessorJournalDigest"],
      skip: ["reason", "schemaVersion", "step"],
    });
    expect(contracts.schemaVocabularyDefinitions[schema]?.fields).toEqual(
      contracts.routineStepSchemaFields.skip,
    );
    expect(contracts.schemaVocabularyDefinitions[schema]?.closedValues).toEqual(
      Object.keys(routes),
    );
    expect(contracts.schemaVocabularyDefinitions[`${schema}#step`]?.fields).toEqual(
      contracts.routineStepSchemaFields.identity,
    );
    expect(contracts.schemaVocabularyDefinitions[`${schema}#step`]?.closedValues).toEqual([
      ...kinds.map((_, i) => String(i + 1)),
      ...kinds,
    ]);
    expect(
      contracts.compatibilityMatrix.filter((row) => row.expectedSchemaVersion === schema),
    ).toEqual(
      [schema, "routine-step-skip/v0-fixture", "routine-step-skip/v999", null].map(
        (observedSchemaVersion) => ({
          expectedSchemaVersion: schema,
          observedSchemaVersion,
          disposition: observedSchemaVersion === schema ? "readable" : "refused",
        }),
      ),
    );
    for (const family of [
      "routine-step/v1",
      "routine-step-identity/v1",
      "routine-cycle/v1",
      "orchestration-module/v1",
      "routine-step-skip/v2",
      "orchestration-event/v1",
      "event-journal/v1",
      "reduced-state/v1",
      "cycle-receipt/v1",
      "breaker-receipt/v1",
      "module-descriptor/v1",
      "module-plan-input/v1",
      "module-plan-result/v1",
      "module-action-plan/v1",
      "module-no-action/v1",
      "route-selection/v1",
      "dispatch-plan/v1",
      "worker-launch-receipt/v1",
      "worker-terminal-receipt/v1",
      "worker-result-subject/v1",
      "review-subject/v1",
      "release-candidate-subject/v1",
      "review-request/v1",
      "review-attempt-result/v1",
      "review-authority/v1",
      "action-disposition/v1",
      "follow-up-cycle-request/v1",
      "resource-reclaim-receipt/v1",
    ]) {
      expect(contracts.schemaVersions).not.toContain(family);
      expect(contracts.parseRoutineStepSkipContract(family, skip())).toBeNull();
      expect(contracts.parseContract(family, skip()).ok).toBe(false);
      expect(
        contracts.parseCanonicalContractBytes(
          family,
          encode(literalSkip(2, "prior-known-terminal")),
        ).ok,
      ).toBe(false);
      expect(contracts.serializeContract(family, skip()).ok).toBe(false);
      expect(contracts.compatibilityDisposition(family, family)).toBe("refused");
    }
  });
});
