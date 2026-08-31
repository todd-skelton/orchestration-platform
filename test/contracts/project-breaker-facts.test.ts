import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";

const schema = "project-breaker-facts/v1";
const projectId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const workId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const snapshotId = "018f0f4d-7b2d-7a13-8a2b-123456789abc";
const observationId = "018f0f4d-7b2d-7a14-8a2b-123456789abc";
const configuration = {
  adapterId: "fixture.adapter",
  adapterVersion: "1.2.3",
  capabilityNames: ["cap.read", "cap.write"],
  engineVersion: "0.0.0",
  projectId,
  schemaVersion: "adapter-configuration/v1",
};
const configDigest = "d881028d480c58860c87325c757bd5047a6ac1a5d0cbab48facc2a0218876d4a";
const row = {
  capabilityNames: ["cap.read"],
  immutableSubjectDigest: "a".repeat(64),
  readiness: "READY",
  workId,
};
const projectFacts = {
  adapterConfigurationDigest: configDigest,
  observationId: snapshotId,
  observedAt: "2026-08-30T01:02:03.004Z",
  projectId,
  schemaVersion: "project-facts/v1",
  state: "COMPLETE",
  frontier: [row],
  frontierDigest: "76eef5fd00f4cce7080f3a9c25dfc0a0f195c17b02f5456259dccc686be9fdab",
};
const snapshotDigest = "7e6e0d39463ba457ea8d869e5185cbee2d0b8f636744aafb55be91d4370b272b";
const common = {
  adapterConfigurationDigest: configDigest,
  observationId,
  observedAt: "2026-08-31T01:02:03.004Z",
  policyVersion: "1.2.3",
  projectFactsDigest: snapshotDigest,
  projectId,
  schemaVersion: schema,
};
const decisions = [
  { capabilityName: "cap.read", trip: "TRIP" },
  { capabilityName: "cap.write", trip: "NO_TRIP" },
];
const complete = { ...common, state: "COMPLETE", decisions };
const failures = [
  [
    "UNAVAILABLE",
    "SOURCE_UNAVAILABLE",
    "bfa9412c4715f9a96e9564f5205f38276c34a45ba9184cc1477064fd57aeb8c7",
  ],
  [
    "UNAVAILABLE",
    "OBSERVATION_TIMEOUT",
    "66d39eda30296844d9ba5557ccfb7331d65a89c28f3a6cf7de5b53b9e1d5b9b3",
  ],
  ["UNKNOWN", "SOURCE_UNKNOWN", "3fecc3d2c54d272cc917a51036426ed4adf053edf00b00924fb4ff579f00c867"],
  [
    "UNKNOWN",
    "MALFORMED_OBSERVATION",
    "e0779462f36ce2a6f759f8ce2b7384c7b3638721ac1bcd9d7c536713d8272f00",
  ],
  [
    "UNKNOWN",
    "CHANGED_BINDING",
    "b5f8c5b00cfeda0f78ef72839e95a64cc150401f9048edf2e92ff28f70ba570e",
  ],
  ["UNKNOWN", "CHANGED_SOURCE", "77bf77dff3b222d0c9fa0280b9f1e98f0aaad8560a3f0625377feb3751877ec9"],
  [
    "UNKNOWN",
    "INCOMPLETE_CAPABILITIES",
    "2f5890615c3ef50c176558af6c701ef14fee8e3d3e20b0504d4de1fb01960b5b",
  ],
] as const;
const arms = [complete, ...failures.map(([state, reason]) => ({ ...common, state, reason }))];
const parse = contracts.parseProjectBreakerFacts;
const bind = (
  facts: unknown,
  config: unknown = configuration,
  snapshot: unknown = projectFacts,
  policy: unknown = common.policyVersion,
) => contracts.validateProjectBreakerFactsBinding(facts, config, snapshot, policy);
const encode = (text: string) => new TextEncoder().encode(text);

function golden(value: unknown, text: string, digest: string) {
  const serialized = { ok: true, bytes: encode(text), digest };
  expect(contracts.serializeContract(schema, value)).toEqual(serialized);
  expect(
    contracts.serializeContract(
      schema,
      Object.fromEntries(Object.entries(value as object).reverse()),
    ),
  ).toEqual(serialized);
  expect(contracts.parseCanonicalContractBytes(schema, encode(text))).toEqual({ ok: true, value });
  expect(contracts.parseCanonicalContractBytes(schema, Buffer.from(text))).toEqual({
    ok: true,
    value,
  });
}

describe("ISS-013 pure project current-policy/trip facts", () => {
  test("pins canonical bytes and content digests for every public arm", () => {
    expect(contracts.canonicalDigest(configuration)).toBe(configDigest);
    expect(contracts.canonicalDigest(projectFacts)).toBe(snapshotDigest);
    const prefix = `{"adapterConfigurationDigest":"${configDigest}",`;
    const metadata = `"observationId":"${observationId}","observedAt":"2026-08-31T01:02:03.004Z","policyVersion":"1.2.3","projectFactsDigest":"${snapshotDigest}","projectId":"${projectId}",`;
    golden(
      complete,
      `${prefix}"decisions":[{"capabilityName":"cap.read","trip":"TRIP"},{"capabilityName":"cap.write","trip":"NO_TRIP"}],${metadata}"schemaVersion":"${schema}","state":"COMPLETE"}\n`,
      "6dc77f15de657140a86b705baae0d6ddae0ad2a80fc8aaa30d09d6e052364db7",
    );
    for (const [state, reason, digest] of failures)
      golden(
        { ...common, state, reason },
        `${prefix}${metadata}"reason":"${reason}","schemaVersion":"${schema}","state":"${state}"}\n`,
        digest,
      );
    for (const change of [
      { adapterConfigurationDigest: "b".repeat(64) },
      { observationId: workId },
      { observedAt: "2026-08-31T01:02:03.005Z" },
      { policyVersion: "1.2.4" },
      { projectFactsDigest: "c".repeat(64) },
      { projectId: workId },
      { decisions: [{ ...decisions[0], trip: "NO_TRIP" }, decisions[1]] },
      { decisions: [{ ...decisions[0], capabilityName: "cap.other" }, decisions[1]] },
      { decisions: [] },
    ]) {
      const result = contracts.serializeContract(schema, { ...complete, ...change });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.digest).not.toBe(contracts.canonicalDigest(complete));
    }
  });

  test("closes every arm and nested row; rejects malformed and noncanonical encodings", () => {
    for (const value of arms) {
      for (const key of Object.keys(value)) {
        const missing: Record<string, unknown> = { ...value };
        delete missing[key];
        for (const input of [missing, { ...value, [key]: null }, { ...value, [key]: true }]) {
          expect(parse(input).ok, key).toBe(false);
          expect(contracts.serializeContract(schema, input).ok, key).toBe(false);
        }
      }
      for (const change of [
        { extra: true },
        { schemaVersion: "project-breaker-facts/v999" },
        { state: "CLOSED" },
        { state: "CLOSED_RECOVERED" },
        { state: "RECOVERY" },
      ])
        expect(parse({ ...value, ...change }).ok).toBe(false);
      const text = contracts.canonicalJson(value);
      for (const malformed of [
        text.trimEnd(),
        ` ${text}`,
        `\ufeff${text}`,
        text.replace("{", '{"state":"duplicate",'),
        text.replace(/\n$/, "\r\n"),
        JSON.stringify(Object.fromEntries(Object.entries(value).reverse())) + "\n",
      ])
        expect(contracts.parseCanonicalContractBytes(schema, encode(malformed)).ok).toBe(false);
    }
    expect(contracts.parseCanonicalContractBytes(schema, new Uint8Array([0xff])).ok).toBe(false);
    for (const input of [null, [], 0, "COMPLETE", {}]) expect(parse(input).ok).toBe(false);
    for (const failure of arms.slice(1))
      for (const decisions of [null, []]) expect(parse({ ...failure, decisions }).ok).toBe(false);
    expect(parse({ ...complete, reason: "SOURCE_UNKNOWN" }).ok).toBe(false);
    for (const state of ["UNAVAILABLE", "UNKNOWN"])
      for (const reason of [
        "RECOVERED",
        ...failures.filter(([other]) => other !== state).map(([, reason]) => reason),
      ])
        expect(parse({ ...common, state, reason }).ok).toBe(false);
    for (const key of Object.keys(decisions[0]!)) {
      const missing: Record<string, unknown> = { ...decisions[0] };
      delete missing[key];
      expect(parse({ ...complete, decisions: [missing] }).ok).toBe(false);
    }
    for (const decision of [
      null,
      [],
      {},
      { ...decisions[0], extra: true },
      { capabilityName: null, trip: "TRIP" },
      { capabilityName: "cap.read", trip: null },
    ])
      expect(parse({ ...complete, decisions: [decision] }).ok).toBe(false);
  });

  test("enforces Name, Version, Time, Digest, UUID and sorted 0–256 decision bounds", () => {
    const names = Array.from(
      { length: 256 },
      (_, i) => `c${String(i).padStart(3, "0")}${"a".repeat(60)}`,
    );
    const maximum = names.map((capabilityName) => ({ capabilityName, trip: "TRIP" }));
    expect(
      parse({ ...complete, decisions: maximum, policyVersion: `${"9".repeat(59)}.0.0` }).ok,
    ).toBe(true);
    expect(parse({ ...complete, decisions: [], policyVersion: "0.0.0" }).ok).toBe(true);
    for (const rows of [
      null,
      {},
      [decisions[0], decisions[0]],
      [...decisions].reverse(),
      [...maximum, { capabilityName: "z", trip: "TRIP" }],
    ])
      expect(parse({ ...complete, decisions: rows }).ok).toBe(false);
    for (const capabilityName of [1, "", "A", "a/", "é", "a\n", "a\r", "a".repeat(65)])
      expect(parse({ ...complete, decisions: [{ capabilityName, trip: "TRIP" }] }).ok).toBe(false);
    for (const trip of [1, "trip", "RECOVER", "CLOSED", "OPEN", "HOLD", false])
      expect(parse({ ...complete, decisions: [{ capabilityName: "a", trip }] }).ok).toBe(false);
    for (const policyVersion of [
      1,
      "",
      "01.0.0",
      "0.01.0",
      "0.0.01",
      "1.2",
      "1.2.3.4",
      "1.2.3-beta",
      "1.2.3+build",
      "^1.2.3",
      "1.2.3\n",
      "１.2.3",
      `${"9".repeat(60)}.0.0`,
    ]) {
      expect(parse({ ...complete, policyVersion }).ok).toBe(false);
      expect(bind(complete, configuration, projectFacts, policyVersion).ok).toBe(false);
    }
    for (const field of ["projectId", "observationId"])
      for (const value of [
        projectId.toUpperCase(),
        projectId.replace("7a11", "4a11"),
        `${projectId}\n`,
        1,
      ])
        expect(parse({ ...complete, [field]: value }).ok).toBe(false);
    for (const field of ["adapterConfigurationDigest", "projectFactsDigest"])
      for (const value of ["A".repeat(64), "a".repeat(63), "a".repeat(65), `${configDigest}\n`, 1])
        expect(parse({ ...complete, [field]: value }).ok).toBe(false);
    for (const observedAt of [
      "2026-08-31T01:02:03Z",
      "2026-02-30T01:02:03.004Z",
      "2026-08-31T01:02:03.004+00:00",
      `${common.observedAt}\n`,
      1,
    ])
      expect(parse({ ...complete, observedAt }).ok).toBe(false);
  });

  test("binds every arm to actual supplied configuration, COMPLETE snapshot and current policy", () => {
    for (const facts of arms) {
      expect(bind(facts)).toEqual({ ok: true, value: facts });
      for (const change of [
        { adapterConfigurationDigest: "b".repeat(64) },
        { projectFactsDigest: "b".repeat(64) },
        { projectId: workId },
        { observationId: snapshotId },
        { policyVersion: "1.2.4" },
      ]) {
        expect(parse({ ...facts, ...change }).ok).toBe(true);
        expect(bind({ ...facts, ...change }).ok).toBe(false);
      }
      expect(bind(facts, configuration, projectFacts, "1.2.4").ok).toBe(false);
      for (const change of [
        { adapterId: "fixture.other" },
        { adapterVersion: "1.2.4" },
        { engineVersion: "0.0.1" },
        { capabilityNames: ["cap.read"] },
        { projectId: workId },
      ]) {
        const config = { ...configuration, ...change };
        expect(bind(facts, config).ok).toBe(false);
        // A coordinated valid snapshot must not bypass the result's independent Dconfig binding.
        const snapshot = {
          ...projectFacts,
          projectId: config.projectId,
          adapterConfigurationDigest: contracts.canonicalDigest(config),
        };
        expect(
          bind(
            {
              ...facts,
              projectId: config.projectId,
              projectFactsDigest: contracts.canonicalDigest(snapshot),
            },
            config,
            snapshot,
          ).ok,
        ).toBe(false);
      }
      for (const change of [
        { observationId: workId },
        { observedAt: "2026-08-30T01:02:03.005Z" },
      ]) {
        const snapshot = { ...projectFacts, ...change };
        expect(bind(facts, configuration, snapshot).ok).toBe(false);
        // Rebound content is valid even with older metadata: no age-based freshness claim.
        expect(
          bind(
            { ...facts, projectFactsDigest: contracts.canonicalDigest(snapshot) },
            configuration,
            snapshot,
          ).ok,
        ).toBe(true);
      }
      for (const state of ["UNKNOWN", "UNAVAILABLE"]) {
        const { frontier: _frontier, frontierDigest: _digest, ...metadata } = projectFacts;
        const snapshot = {
          ...metadata,
          state,
          reason: state === "UNKNOWN" ? "SOURCE_UNKNOWN" : "SOURCE_UNAVAILABLE",
        };
        expect(contracts.parseProjectFacts(snapshot).ok).toBe(true);
        expect(
          bind(
            { ...facts, projectFactsDigest: contracts.canonicalDigest(snapshot) },
            configuration,
            snapshot,
          ).ok,
        ).toBe(false);
      }
    }
    for (const change of [
      { projectId: workId },
      { adapterConfigurationDigest: "b".repeat(64) },
      { frontierDigest: "b".repeat(64) },
      { extra: true },
    ]) {
      const snapshot = { ...projectFacts, ...change };
      expect(
        bind(
          { ...complete, projectFactsDigest: contracts.canonicalDigest(snapshot) },
          configuration,
          snapshot,
        ).ok,
      ).toBe(false);
    }
    const frontier = [{ ...row, capabilityNames: ["cap.other"] }];
    const snapshot = {
      ...projectFacts,
      frontier,
      frontierDigest: contracts.canonicalDigest(frontier),
    };
    expect(contracts.parseProjectFacts(snapshot).ok).toBe(true);
    expect(
      bind(
        { ...complete, projectFactsDigest: contracts.canonicalDigest(snapshot) },
        configuration,
        snapshot,
      ).ok,
    ).toBe(false);
    expect(bind(complete, { ...configuration, extra: true }).ok).toBe(false);
    for (const frontier of [
      [],
      [{ ...row, workId: projectId }],
      [{ ...row, immutableSubjectDigest: "b".repeat(64) }],
      [{ ...row, readiness: "NOT_READY" }],
      [{ ...row, capabilityNames: ["cap.write"] }],
    ]) {
      const snapshot = {
        ...projectFacts,
        frontier,
        frontierDigest: contracts.canonicalDigest(frontier),
      };
      expect(bind(complete, configuration, snapshot).ok).toBe(false);
      // Content rebinding is possible; only the later SDK can reject changed live source.
      expect(
        bind(
          { ...complete, projectFactsDigest: contracts.canonicalDigest(snapshot) },
          configuration,
          snapshot,
        ).ok,
      ).toBe(true);
    }
    const config = { ...configuration, adapterId: "other.adapter", adapterVersion: "9.0.0" };
    const snapshotForConfig = {
      ...projectFacts,
      adapterConfigurationDigest: contracts.canonicalDigest(config),
    };
    expect(
      bind(
        {
          ...complete,
          adapterConfigurationDigest: contracts.canonicalDigest(config),
          projectFactsDigest: contracts.canonicalDigest(snapshotForConfig),
        },
        config,
        snapshotForConfig,
      ).ok,
    ).toBe(true);
  });

  test("requires exactly the configured census even with an identical empty frontier", () => {
    for (const names of [[], ["cap.read"], configuration.capabilityNames]) {
      const config = { ...configuration, capabilityNames: names };
      const snapshot = {
        ...projectFacts,
        adapterConfigurationDigest: contracts.canonicalDigest(config),
        frontier: [],
        frontierDigest: contracts.canonicalDigest([]),
      };
      const facts = {
        ...complete,
        adapterConfigurationDigest: contracts.canonicalDigest(config),
        projectFactsDigest: contracts.canonicalDigest(snapshot),
        decisions: names.map((capabilityName) => ({ capabilityName, trip: "NO_TRIP" })),
      };
      expect(bind(facts, config, snapshot).ok).toBe(true);
      for (const wrong of [
        [],
        [{ capabilityName: "cap.read", trip: "NO_TRIP" }],
        decisions,
        [...facts.decisions, { capabilityName: "cap.zz", trip: "TRIP" }],
      ]) {
        if (wrong.length === names.length) continue;
        expect(parse({ ...facts, decisions: wrong }).ok).toBe(true);
        expect(bind({ ...facts, decisions: wrong }, config, snapshot)).toEqual({
          ok: false,
          issues: ["decisions:capability-census-mismatch"],
        });
      }
    }
    // Same-length, sorted substitutions fail even though no duplicate/count check catches them.
    expect(
      bind({
        ...complete,
        decisions: [{ capabilityName: "cap.other", trip: "TRIP" }, decisions[1]],
      }).ok,
    ).toBe(false);
    expect(bind({ ...complete, decisions: decisions.slice(0, 1) }).ok).toBe(false);
  });

  test("snapshots hostile inputs without executing getters, proxy traps or coercion", () => {
    let calls = 0;
    const called = () => {
      calls += 1;
      throw new Error("caller code");
    };
    const proxy = (value: object) =>
      new Proxy(value, {
        get: called,
        getPrototypeOf: called,
        ownKeys: called,
        getOwnPropertyDescriptor: called,
      });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hostileRecords = [
      proxy(complete),
      new Proxy(complete, {}),
      revoked.proxy,
      Object.create(complete),
      Object.defineProperty({ ...complete }, "state", { get: called }),
      { ...complete, [Symbol("extra")]: true },
      Object.defineProperty({ ...complete }, "hidden", { value: 1 }),
      { ...complete, toJSON: called },
      { ...complete, decisions: [proxy(decisions[0]!)] },
      {
        ...complete,
        decisions: [Object.defineProperty({ ...decisions[0] }, "trip", { get: called })],
      },
    ];
    class DecisionArray extends Array {}
    const hostileArrays = [
      proxy(decisions),
      new Proxy(decisions, {}),
      new Array(1),
      Object.assign([...decisions], { extra: true }),
      Object.assign([...decisions], { [Symbol.iterator]: called }),
      Object.defineProperty([...decisions], "0", { get: called }),
      new DecisionArray(),
      runInNewContext("[]"),
      Object.setPrototypeOf([], null),
    ];
    for (const input of [
      ...hostileRecords,
      ...hostileArrays.map((decisions) => ({ ...complete, decisions })),
    ]) {
      expect(parse(input).ok).toBe(false);
      expect(contracts.parseContract(schema, input).ok).toBe(false);
      expect(contracts.serializeContract(schema, input).ok).toBe(false);
      expect(bind(input).ok).toBe(false);
    }
    expect(bind(complete, proxy(configuration)).ok).toBe(false);
    expect(bind(complete, configuration, proxy(projectFacts)).ok).toBe(false);
    expect(bind(complete, configuration, { ...projectFacts, frontier: [proxy(row)] }).ok).toBe(
      false,
    );
    expect(bind(complete, configuration, projectFacts, proxy({ toString: called })).ok).toBe(false);
    expect(calls).toBe(0);
    for (const array of [
      [...decisions],
      Object.seal([...decisions]),
      Object.freeze([...decisions]),
    ]) {
      const result = parse(Object.assign(Object.create(null), { ...complete, decisions: array }));
      expect(result.ok).toBe(true);
      if (result.ok && result.value.state === "COMPLETE") {
        expect(Object.isFrozen(result.value)).toBe(true);
        expect(Object.isFrozen(result.value.decisions)).toBe(true);
        expect(result.value.decisions).not.toBe(array);
        expect(result.value.decisions[0]).not.toBe(decisions[0]);
        expect(Object.isFrozen(result.value.decisions[0])).toBe(true);
      }
    }
  });

  test("admits only native Uint8Array/Buffer bytes without prototype traps", () => {
    let calls = 0;
    const called = () => {
      calls += 1;
      throw new Error("caller code");
    };
    const bytes = encode(contracts.canonicalJson(complete));
    const hostile = new Uint8Array();
    Object.setPrototypeOf(hostile, new Proxy(Uint8Array.prototype, { getPrototypeOf: called }));
    const forged = Object.setPrototypeOf(new Uint16Array(), Uint8Array.prototype);
    class ByteSubclass extends Uint8Array {}
    for (const input of [
      hostile,
      forged,
      new ByteSubclass(),
      runInNewContext("new Uint8Array()"),
      new Proxy(bytes, { get: called, getPrototypeOf: called }),
      new Proxy(bytes, {}),
      Object.create(Uint8Array.prototype),
      new DataView(new ArrayBuffer(1)),
      "bytes",
    ])
      expect(contracts.parseCanonicalContractBytes(schema, input as Uint8Array)).toEqual({
        ok: false,
        issues: ["encoding:bytes-required"],
      });
    Object.defineProperty(bytes, "byteLength", { get: called });
    Object.defineProperty(bytes, "length", { get: called });
    expect(contracts.parseCanonicalContractBytes(schema, bytes).ok).toBe(true);
    expect(calls).toBe(0);
  });

  test("registers one family and all inline vocabulary censuses without callback/recovery schemas", () => {
    expect(contracts.projectBreakerFactsSchemaVersions).toEqual([schema]);
    expect(contracts.schemaVersions.filter((entry) => entry === schema)).toHaveLength(1);
    expect(contracts.compatibilityDisposition(schema, schema)).toBe("readable");
    expect(
      contracts.compatibilityMatrix.filter((row) => row.expectedSchemaVersion === schema),
    ).toHaveLength(4);
    for (const [arm, value, closedValues] of [
      ["COMPLETE", complete, ["COMPLETE"]],
      ["UNAVAILABLE", arms[1]!, ["UNAVAILABLE", "SOURCE_UNAVAILABLE", "OBSERVATION_TIMEOUT"]],
      [
        "UNKNOWN",
        arms[3]!,
        [
          "UNKNOWN",
          "SOURCE_UNKNOWN",
          "MALFORMED_OBSERVATION",
          "CHANGED_BINDING",
          "CHANGED_SOURCE",
          "INCOMPLETE_CAPABILITIES",
        ],
      ],
      ["decision-row", decisions[0]!, ["TRIP", "NO_TRIP"]],
    ] as const) {
      expect(contracts.schemaVocabularyDefinitions[`${schema}#${arm}`]).toEqual({
        schemaVersion: schema,
        fields: Object.keys(value).sort(),
        closedValues,
      });
    }
    for (const unsupported of [
      "project-breaker-facts/v0-fixture",
      "project-breaker-facts/v999",
      "project-breaker-decision/v1",
      "project-current-policy-request/v1",
      "project-current-policy-response/v1",
      "project-recovery-facts/v1",
    ]) {
      expect(contracts.compatibilityDisposition(unsupported, unsupported)).toBe("refused");
      expect(contracts.parseContract(unsupported, complete)).toEqual({
        ok: false,
        issues: ["schemaVersion:unsupported"],
      });
      expect(
        contracts.parseCanonicalContractBytes(
          unsupported,
          encode(contracts.canonicalJson(complete)),
        ).ok,
      ).toBe(false);
      expect(contracts.serializeContract(unsupported, complete).ok).toBe(false);
    }
    expect(contracts.compatibilityDisposition(schema, null)).toBe("refused");
    // Public facts do not become an executable CLI result or replace snapshot success.
    for (const result of arms)
      expect(
        contracts.parseContract("orchestration-command-result/v1", {
          command: "project snapshot",
          diagnostics: [],
          outcome: "success",
          result,
          schemaVersion: "orchestration-command-result/v1",
        }).ok,
      ).toBe(false);
  });
});
