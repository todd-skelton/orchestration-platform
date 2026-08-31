import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as snapshot from "../../packages/contracts/src/project-snapshot.js";

const projectId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const workId = "018f0f4d-7b2d-7a12-8a2b-123456789abc";
const observationId = "018f0f4d-7b2d-7a13-8a2b-123456789abc";
const configuration = {
  adapterId: "fixture.adapter",
  adapterVersion: "1.2.3",
  capabilityNames: ["cap.read", "cap.write"],
  engineVersion: "0.0.0",
  projectId,
  schemaVersion: "adapter-configuration/v1",
};
const configBytes =
  '{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","capabilityNames":["cap.read","cap.write"],"engineVersion":"0.0.0","projectId":"018f0f4d-7b2d-7a11-8a2b-123456789abc","schemaVersion":"adapter-configuration/v1"}\n';
const configDigest = "d881028d480c58860c87325c757bd5047a6ac1a5d0cbab48facc2a0218876d4a";
const row = {
  capabilityNames: ["cap.read"],
  immutableSubjectDigest: "a".repeat(64),
  readiness: "READY",
  workId,
};
const frontierBytes =
  '[{"capabilityNames":["cap.read"],"immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","readiness":"READY","workId":"018f0f4d-7b2d-7a12-8a2b-123456789abc"}]\n';
const frontierDigest = "76eef5fd00f4cce7080f3a9c25dfc0a0f195c17b02f5456259dccc686be9fdab";
const common = {
  adapterConfigurationDigest: configDigest,
  observationId,
  observedAt: "2026-08-30T01:02:03.004Z",
  projectId,
  schemaVersion: "project-facts/v1",
};
const complete = { ...common, state: "COMPLETE", frontier: [row], frontierDigest };
const failures = [
  [
    "UNAVAILABLE",
    "SOURCE_UNAVAILABLE",
    "1cfac82e2e91ab01b9d83db08ee83564516c15f7dfbabc9dee0f765fe97fc62b",
  ],
  [
    "UNAVAILABLE",
    "OBSERVATION_TIMEOUT",
    "1d64012cc55a883794cc7e0d0969142399bab239b41f847c8acde9b36105e38a",
  ],
  ["UNKNOWN", "SOURCE_UNKNOWN", "fdbb0f7e3293afb223985818db73cee2651d0447a520a6e6ac96e19680c1bdfe"],
  [
    "UNKNOWN",
    "MALFORMED_OBSERVATION",
    "c37c391b5d668135653414df96d8a72ce6c9163471c519aa7ef78ff32d75e0b6",
  ],
  [
    "UNKNOWN",
    "INCOMPLETE_FRONTIER",
    "c16df566b9cd29d9907f09e1b6e643fc5a0989f084753f41941bb95509186a70",
  ],
  [
    "UNKNOWN",
    "CHANGED_FRONTIER",
    "3e37cdfac34269758fb60ace10de345c24c97f5c7698fc6ab80161040ce4d2e0",
  ],
] as const;
const factArms = [complete, ...failures.map(([state, reason]) => ({ ...common, state, reason }))];
const provenance = {
  adapterId: configuration.adapterId,
  capabilityNames: configuration.capabilityNames,
  fieldSources: {
    adapterId: "PROJECT",
    capabilityNames: "PROJECT",
    leaseFreshnessMs: "PROJECT",
    maximumSessionMs: "PROJECT",
    projectId: "PROJECT",
    stateRoot: "DEFAULT",
    wallClockSkewMs: "PROJECT",
  },
  leaseFreshnessMs: 30_000,
  maximumSessionMs: 3_600_000,
  projectId,
  projectRoot: `<redacted:path:${"b".repeat(64)}>`,
  schemaVersion: "configuration-provenance/v1",
  stateRoot: `<redacted:path:${"c".repeat(64)}>`,
  wallClockSkewMs: 1_000,
};
const withFrontier = (frontier: unknown) => ({
  ...complete,
  frontier,
  frontierDigest: contracts.canonicalDigest(frontier as contracts.JsonValue),
});

function golden(schema: string, value: unknown, bytes: string, digest: string) {
  expect(contracts.serializeContract(schema, value)).toEqual({
    ok: true,
    bytes: new TextEncoder().encode(bytes),
    digest,
  });
  expect(contracts.parseCanonicalContractBytes(schema, new TextEncoder().encode(bytes))).toEqual({
    ok: true,
    value,
  });
  expect(
    contracts.serializeContract(
      schema,
      Object.fromEntries(Object.entries(value as object).reverse()),
    ),
  ).toEqual({ ok: true, bytes: new TextEncoder().encode(bytes), digest });
}

describe("ISS-013 pure project snapshot contracts", () => {
  test("pins both canonical content families and every failure arm", () => {
    golden(configuration.schemaVersion, configuration, configBytes, configDigest);
    expect(contracts.canonicalJson([row])).toBe(frontierBytes);
    expect(contracts.canonicalDigest([row])).toBe(frontierDigest);
    const tail = `"observationId":"${observationId}","observedAt":"2026-08-30T01:02:03.004Z","projectId":"${projectId}"`;
    golden(
      common.schemaVersion,
      complete,
      `{"adapterConfigurationDigest":"${configDigest}","frontier":${frontierBytes.trim()},"frontierDigest":"${frontierDigest}",${tail},"schemaVersion":"project-facts/v1","state":"COMPLETE"}\n`,
      "7e6e0d39463ba457ea8d869e5185cbee2d0b8f636744aafb55be91d4370b272b",
    );
    for (const [state, reason, digest] of failures)
      golden(
        common.schemaVersion,
        { ...common, state, reason },
        `{"adapterConfigurationDigest":"${configDigest}",${tail},"reason":"${reason}","schemaVersion":"project-facts/v1","state":"${state}"}\n`,
        digest,
      );
    const empty = withFrontier([]);
    expect(empty.frontierDigest).toBe(
      "37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570",
    );
    expect(snapshot.parseProjectFacts(empty).ok).toBe(true);
    expect(snapshot.parseProjectFacts({ ...empty, frontierDigest }).ok).toBe(false);
    for (const field of [
      "adapterConfigurationDigest",
      "observationId",
      "observedAt",
      "projectId",
    ] as const) {
      const moved = {
        ...complete,
        [field]:
          field === "observedAt"
            ? "2026-08-30T01:02:03.005Z"
            : field === "adapterConfigurationDigest"
              ? "b".repeat(64)
              : projectId === complete[field]
                ? workId
                : projectId,
      };
      const result = contracts.serializeContract(common.schemaVersion, moved);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.digest).not.toBe(
          "7e6e0d39463ba457ea8d869e5185cbee2d0b8f636744aafb55be91d4370b272b",
        );
    }
  });

  test("requires every literal member and refuses unknown/future schemas and noncanonical bytes", () => {
    for (const value of [configuration, ...factArms]) {
      for (const field of Object.keys(value)) {
        const missing = { ...value } as Record<string, unknown>;
        delete missing[field];
        expect(contracts.parseContract(value.schemaVersion, missing).ok, `missing:${field}`).toBe(
          false,
        );
        expect(
          contracts.parseContract(value.schemaVersion, { ...value, [field]: null }).ok,
          `null:${field}`,
        ).toBe(false);
      }
      expect(contracts.parseContract(value.schemaVersion, { ...value, extra: true }).ok).toBe(
        false,
      );
      expect(
        contracts.parseContract(value.schemaVersion, {
          ...value,
          schemaVersion: value.schemaVersion.replace("v1", "v999"),
        }).ok,
      ).toBe(false);
      expect(contracts.parseContract(value.schemaVersion.replace("v1", "v999"), value)).toEqual({
        ok: false,
        issues: ["schemaVersion:unsupported"],
      });
      const bytes = contracts.canonicalJson(value);
      for (const text of [
        bytes.trimEnd(),
        ` ${bytes}`,
        `\ufeff${bytes}`,
        bytes.replace("{", '{"schemaVersion":"duplicate",'),
      ])
        expect(
          contracts.parseCanonicalContractBytes(value.schemaVersion, new TextEncoder().encode(text))
            .ok,
        ).toBe(false);
      expect(
        contracts.parseCanonicalContractBytes(value.schemaVersion, new Uint8Array([0xff])).ok,
      ).toBe(false);
      expect(contracts.serializeContract(value.schemaVersion, { ...value, extra: true }).ok).toBe(
        false,
      );
    }
    for (const value of [null, [], 1, "COMPLETE", { ...common, state: "FAILED" }])
      expect(snapshot.parseProjectFacts(value).ok).toBe(false);
    for (const state of ["UNKNOWN", "UNAVAILABLE"])
      for (const reason of [
        "READY",
        null,
        ...failures.filter((entry) => entry[0] !== state).map((entry) => entry[1]),
      ])
        expect(snapshot.parseProjectFacts({ ...common, state, reason }).ok).toBe(false);
    for (const failure of factArms.slice(1))
      for (const addition of [
        { frontier: [] },
        { frontier: null },
        { frontierDigest },
        { frontierDigest: null },
      ])
        expect(snapshot.parseProjectFacts({ ...failure, ...addition }).ok).toBe(false);
    expect(snapshot.parseProjectFacts({ ...complete, reason: "SOURCE_UNKNOWN" }).ok).toBe(false);
  });

  test("enforces actual name, version, identifier, and byte limits", () => {
    const names = Array.from(
      { length: 256 },
      (_, index) => `c${String(index).padStart(3, "0")}${"a".repeat(60)}`,
    );
    const maximum = {
      ...configuration,
      capabilityNames: names,
      adapterId: "a".repeat(128),
      adapterVersion: `${"9".repeat(59)}.0.0`,
      engineVersion: `0.${"9".repeat(59)}.0`,
    };
    expect(snapshot.parseAdapterConfiguration(maximum).ok).toBe(true);
    expect(snapshot.parseAdapterConfiguration({ ...configuration, capabilityNames: [] }).ok).toBe(
      true,
    );
    const maxBytes = contracts.canonicalBytes(maximum);
    expect(maxBytes.length).toBeLessThanOrEqual(65536);
    expect(contracts.parseCanonicalContractBytes(configuration.schemaVersion, maxBytes).ok).toBe(
      true,
    );
    expect(
      contracts.parseCanonicalContractBytes(configuration.schemaVersion, new Uint8Array(65536)),
    ).toEqual({ ok: false, issues: ["encoding:invalid-json"] });
    expect(
      contracts.parseCanonicalContractBytes(configuration.schemaVersion, new Uint8Array(65537)),
    ).toEqual({ ok: false, issues: ["encoding:limit-exceeded"] });
    for (const capabilityNames of [
      null,
      {},
      [null],
      [{}],
      [1],
      [""],
      ["A"],
      ["a/"],
      ["a\n"],
      ["é"],
      ["a".repeat(65)],
      ["z", "a"],
      ["a", "a"],
      [...names, "z"],
    ])
      expect(snapshot.parseAdapterConfiguration({ ...configuration, capabilityNames }).ok).toBe(
        false,
      );
    for (const field of ["adapterVersion", "engineVersion"])
      for (const version of [
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
      ])
        expect(
          snapshot.parseAdapterConfiguration({ ...configuration, [field]: version }).ok,
          `${field}:${version}`,
        ).toBe(false);
    for (const adapterId of ["", "A", "a/", "a\n", "a".repeat(129), 1])
      expect(snapshot.parseAdapterConfiguration({ ...configuration, adapterId }).ok).toBe(false);
    for (const invalid of [
      projectId.toUpperCase(),
      projectId.replace("7a11", "4a11"),
      `${projectId}\n`,
    ]) {
      expect(snapshot.parseAdapterConfiguration({ ...configuration, projectId: invalid }).ok).toBe(
        false,
      );
      for (const field of ["projectId", "observationId"])
        expect(snapshot.parseProjectFacts({ ...complete, [field]: invalid }).ok).toBe(false);
    }
    for (const observedAt of [
      "2026-08-30T01:02:03Z",
      "2026-02-30T01:02:03.004Z",
      "2026-08-30T01:02:03.004+00:00",
      `${common.observedAt}\n`,
    ])
      expect(snapshot.parseProjectFacts({ ...complete, observedAt }).ok).toBe(false);
    for (const field of ["adapterConfigurationDigest", "frontierDigest"])
      for (const invalid of ["A".repeat(64), "a".repeat(63), `${configDigest}\n`, 1])
        expect(snapshot.parseProjectFacts({ ...complete, [field]: invalid }).ok).toBe(false);
  });

  test("closes frontier rows, retains NOT_READY, and enforces 4096 sorted unique rows and their digest", () => {
    const frontier = Array.from({ length: 4096 }, (_, index) => ({
      ...row,
      capabilityNames: [],
      readiness: index % 2 ? "READY" : "NOT_READY",
      workId: `018f0f4d-7b2d-7a12-8a2b-${index.toString(16).padStart(12, "0")}`,
    }));
    expect(snapshot.parseProjectFacts(withFrontier(frontier)).ok).toBe(true);
    expect(snapshot.parseProjectFacts({ ...complete, frontier: [...frontier, row] }).ok).toBe(
      false,
    );
    for (const rows of [
      [row, row],
      [row, { ...row, workId: projectId }],
      [{ ...row, readiness: "UNKNOWN" }],
      [{ ...row, readiness: "UNAVAILABLE" }],
      [{ ...row, readiness: "ready" }],
      [{ ...row, workId: "opaque" }],
      [{ ...row, immutableSubjectDigest: `${"a".repeat(64)}\n` }],
      [{ ...row, capabilityNames: ["x", "x"] }],
      [
        {
          ...row,
          capabilityNames: Array.from({ length: 257 }, (_, i) => `c${String(i).padStart(3, "0")}`),
        },
      ],
      [{ ...row, extra: true }],
    ])
      expect(snapshot.parseProjectFacts(withFrontier(rows)).ok).toBe(false);
    for (const field of Object.keys(row)) {
      const missing = { ...row } as Record<string, unknown>;
      delete missing[field];
      expect(snapshot.parseProjectFacts(withFrontier([missing])).ok).toBe(false);
      expect(snapshot.parseProjectFacts(withFrontier([{ ...row, [field]: null }])).ok).toBe(false);
    }
    expect(
      snapshot.parseProjectFacts({ ...complete, frontier: [{ ...row, readiness: "NOT_READY" }] })
        .ok,
    ).toBe(false);
    const changed = withFrontier([{ ...row, readiness: "NOT_READY" }]);
    expect(snapshot.parseProjectFacts(changed).ok).toBe(true);
    expect(snapshot.parseProjectFacts({ ...complete, frontier: null }).ok).toBe(false);
  });

  test("binds supplied config/project/capabilities without claiming fresh observation or static compatibility", () => {
    expect(snapshot.validateAdapterConfigurationBinding(configuration, provenance).ok).toBe(true);
    for (const changed of [
      { adapterId: "other" },
      { projectId: workId },
      { capabilityNames: ["cap.read"] },
      { capabilityNames: [...configuration.capabilityNames, "cap.zz"] },
    ])
      expect(
        snapshot.validateAdapterConfigurationBinding(configuration, { ...provenance, ...changed })
          .ok,
      ).toBe(false);
    expect(
      snapshot.validateAdapterConfigurationBinding(configuration, { ...provenance, extra: true })
        .ok,
    ).toBe(false);
    expect(
      snapshot.validateAdapterConfigurationBinding(configuration, {
        ...provenance,
        capabilityNames: [{}, "a"],
      }).ok,
    ).toBe(false);
    for (const facts of factArms) {
      expect(snapshot.validateProjectFactsBinding(facts, configuration).ok).toBe(true);
      expect(
        snapshot.validateProjectFactsBinding({ ...facts, projectId: workId }, configuration).ok,
      ).toBe(false);
      for (const changed of [
        { adapterId: "other" },
        { adapterVersion: "1.2.4" },
        { engineVersion: "0.0.1" },
        { projectId: workId },
        { capabilityNames: ["cap.read"] },
      ])
        expect(
          snapshot.validateProjectFactsBinding(facts, { ...configuration, ...changed }).ok,
        ).toBe(false);
      expect(
        snapshot.validateProjectFactsBinding(
          { ...facts, adapterConfigurationDigest: "b".repeat(64) },
          configuration,
        ).ok,
      ).toBe(false);
    }
    const substituted = withFrontier([{ ...row, capabilityNames: ["cap.other"] }]);
    expect(snapshot.parseProjectFacts(substituted).ok).toBe(true);
    expect(snapshot.validateProjectFactsBinding(substituted, configuration)).toEqual({
      ok: false,
      issues: ["frontier.0.capabilityNames:not-subset"],
    });
    const noCapabilities = { ...configuration, capabilityNames: [] };
    expect(
      snapshot.validateProjectFactsBinding(
        {
          ...withFrontier([{ ...row, capabilityNames: [] }]),
          adapterConfigurationDigest: contracts.canonicalDigest(noCapabilities),
        },
        noCapabilities,
      ).ok,
    ).toBe(true);
    expect(
      snapshot.validateProjectFactsBinding(
        { ...complete, adapterConfigurationDigest: contracts.canonicalDigest(noCapabilities) },
        noCapabilities,
      ).ok,
    ).toBe(false);
    expect(
      snapshot.validateProjectFactsBinding(complete, { ...configuration, extra: true }).ok,
    ).toBe(false);
  });

  test("refuses hostile records and arrays without invoking caller code", () => {
    let calls = 0;
    const called = () => {
      calls += 1;
      throw new Error("caller code");
    };
    const proxy = (input: object) =>
      new Proxy(input, {
        get: called,
        getPrototypeOf: called,
        ownKeys: called,
        getOwnPropertyDescriptor: called,
      });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const accessor = Object.defineProperty({ ...configuration }, "adapterId", { get: called });
    const arrayAccessor = Object.defineProperty([row], "0", { get: called });
    const sparse = new Array(1);
    const extraArray = Object.assign([row], { extra: true });
    const symbolRecord = { ...configuration, [Symbol("extra")]: true };
    const hidden = Object.defineProperty({ ...configuration }, "extra", { value: true });
    const toJson = { ...configuration, toJSON: called };
    for (const input of [
      accessor,
      proxy(configuration),
      revoked.proxy,
      symbolRecord,
      hidden,
      toJson,
      Object.create(configuration),
      { ...configuration, capabilityNames: proxy([]) },
      { ...configuration, capabilityNames: sparse },
    ]) {
      expect(snapshot.parseAdapterConfiguration(input).ok).toBe(false);
      expect(snapshot.validateAdapterConfigurationBinding(input, provenance).ok).toBe(false);
      expect(snapshot.validateProjectFactsBinding(complete, input).ok).toBe(false);
    }
    for (const input of [
      proxy(complete),
      revoked.proxy,
      { ...complete, frontier: arrayAccessor },
      { ...complete, frontier: sparse },
      { ...complete, frontier: extraArray },
      { ...complete, frontier: [proxy(row)] },
      { ...complete, frontier: [{ ...row, capabilityNames: proxy([]) }] },
    ]) {
      expect(snapshot.parseProjectFacts(input).ok).toBe(false);
      expect(snapshot.validateProjectFactsBinding(input, configuration).ok).toBe(false);
    }
    expect(snapshot.validateAdapterConfigurationBinding(configuration, proxy(provenance)).ok).toBe(
      false,
    );
    for (const schema of snapshot.projectSnapshotSchemaVersions)
      expect(
        contracts.parseCanonicalContractBytes(schema, proxy(new Uint8Array()) as Uint8Array).ok,
      ).toBe(false);
    expect(calls).toBe(0);
    const parsed = snapshot.parseProjectFacts(complete);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.state === "COMPLETE") {
      expect(Object.isFrozen(parsed.value)).toBe(true);
      expect(Object.isFrozen(parsed.value.frontier[0]!.capabilityNames)).toBe(true);
      expect(parsed.value.frontier[0]).not.toBe(row);
    }
  });

  test.each([configuration, complete])(
    "refuses unsafe typed-byte prototypes for $schemaVersion",
    (value) => {
      let calls = 0;
      const bytes = new Uint8Array();
      Object.setPrototypeOf(
        bytes,
        new Proxy(Uint8Array.prototype, {
          getPrototypeOf() {
            calls += 1;
            throw new Error("caller code");
          },
        }),
      );
      expect(contracts.parseCanonicalContractBytes(value.schemaVersion, bytes)).toEqual({
        ok: false,
        issues: ["encoding:bytes-required"],
      });
      expect(calls).toBe(0);
      const forged = new Uint16Array();
      Object.setPrototypeOf(forged, Uint8Array.prototype);
      expect(
        contracts.parseCanonicalContractBytes(value.schemaVersion, forged as unknown as Uint8Array),
      ).toEqual({
        ok: false,
        issues: ["encoding:bytes-required"],
      });
      expect(
        contracts.parseCanonicalContractBytes(
          value.schemaVersion,
          Buffer.from(contracts.canonicalJson(value)),
        ),
      ).toEqual({ ok: true, value });
    },
  );

  test("registers exactly two public families and keeps project command success unavailable", () => {
    expect(snapshot.projectSnapshotSchemaVersions).toEqual([
      "adapter-configuration/v1",
      "project-facts/v1",
    ]);
    for (const schema of snapshot.projectSnapshotSchemaVersions) {
      expect(contracts.schemaVersions.filter((entry) => entry === schema)).toHaveLength(1);
      expect(contracts.compatibilityDisposition(schema, schema)).toBe("readable");
      expect(contracts.compatibilityDisposition(schema, schema.replace("v1", "v999"))).toBe(
        "refused",
      );
      expect(
        contracts.compatibilityMatrix.filter((entry) => entry.expectedSchemaVersion === schema),
      ).toHaveLength(4);
    }
    for (const [key, value] of [
      ["adapter-configuration/v1", configuration],
      ["project-facts/v1#COMPLETE", complete],
      ["project-facts/v1#UNAVAILABLE", factArms[1]!],
      ["project-facts/v1#UNKNOWN", factArms[3]!],
      ["project-facts/v1#frontier-row", row],
    ] as const)
      expect(contracts.schemaVocabularyDefinitions[key]!.fields).toEqual(Object.keys(value).sort());
    for (const schema of ["project-frontier-row/v1", "project-page/v1", "project-plan/v1"])
      expect(contracts.parseContract(schema, {})).toEqual({
        ok: false,
        issues: ["schemaVersion:unsupported"],
      });
    for (const result of factArms)
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
