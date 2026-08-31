import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  canonicalDigest,
  canonicalJson,
  validateProjectBreakerFactsBinding,
  type AdapterConfiguration,
  type ProjectFrontierRow,
} from "../../packages/contracts/src/index.js";
import { createProjectCurrentPolicyReader } from "../../packages/adapter-sdk/src/current-policy.js";
import {
  createBranchFixtureCurrentPolicy,
  createBranchFixtureSnapshot,
  createQueueFixtureCurrentPolicy,
  createQueueFixtureSnapshot,
} from "../../packages/adapter-sdk/src/fixtures.js";
import type {
  CurrentPolicyRead,
  CurrentPolicyRequest,
  CurrentPolicyResult,
  FixturePolicySourceFailure,
  SnapshotClocks,
} from "../../packages/adapter-sdk/src/index.js";

const uuid = (index: number) => `018f0f4d-7b2d-7a11-8a2b-${index.toString(16).padStart(12, "0")}`;
const observedAt = "2026-08-30T01:02:03.004Z";
const config = {
  adapterId: "fixture.branches",
  adapterVersion: "1.0.0",
  capabilityNames: ["work.read"],
  engineVersion: "0.0.0",
  projectId: uuid(1),
  schemaVersion: "adapter-configuration/v1",
} satisfies AdapterConfiguration;
const provenance = (configuration = config) => ({
  adapterId: configuration.adapterId,
  capabilityNames: [...configuration.capabilityNames],
  projectId: configuration.projectId,
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
  wallClockSkewMs: 1_000,
  projectRoot: `<redacted:path:${"b".repeat(64)}>`,
  stateRoot: `<redacted:path:${"c".repeat(64)}>`,
  schemaVersion: "configuration-provenance/v1",
});
const clocks: SnapshotClocks = { wallNow: () => observedAt, monotonicNow: () => 0 };
const row = (
  index = 2,
  readiness: ProjectFrontierRow["readiness"] = "READY",
  capabilityNames = ["work.read"],
): ProjectFrontierRow => ({
  workId: uuid(index),
  immutableSubjectDigest: "a".repeat(64),
  readiness,
  capabilityNames,
});
const snapshot = (configuration = config, frontier: readonly ProjectFrontierRow[] = [row()]) => ({
  adapterConfigurationDigest: canonicalDigest(configuration),
  observationId: uuid(90),
  observedAt,
  projectId: configuration.projectId,
  schemaVersion: "project-facts/v1" as const,
  state: "COMPLETE" as const,
  frontier,
  frontierDigest: canonicalDigest(frontier),
});
const echo = (request: CurrentPolicyRequest) => ({
  observationId: request.observationId,
  policyVersion: request.policyVersion,
  projectFactsDigest: canonicalDigest(request.projectFacts),
});
const reply = (request: CurrentPolicyRequest) => ({
  ...echo(request),
  state: "COMPLETE",
  frontier: request.projectFacts.frontier,
  decisions: request.capabilityNames.map((capabilityName) => ({ capabilityName, trip: "NO_TRIP" })),
});
const schemas = ["adapter-configuration/v1", "project-facts/v1", "project-breaker-facts/v1"];
const bind = (read: CurrentPolicyRead) =>
  createProjectCurrentPolicyReader(
    read,
    config.adapterId,
    "1.0.0",
    "1.0.0",
    ["0.0.0"],
    schemas,
    ["work.read"],
    ["1.0.0"],
  );
const invoke = (read: CurrentPolicyRead, clock = clocks) =>
  bind(read)(config, provenance(), snapshot(), clock);
const failure = (state: string, reason: string) => ({
  ok: true,
  facts: expect.objectContaining({ state, reason }),
});
function facts(
  result: CurrentPolicyResult,
  configuration = config,
  retained = snapshot(configuration),
) {
  if (!result.ok) throw new Error(result.code);
  expect(
    validateProjectBreakerFactsBinding(result.facts, configuration, retained, "1.0.0").ok,
  ).toBe(true);
  expect(Object.isFrozen(result.facts)).toBe(true);
  return result.facts;
}

afterEach(() => vi.useRealTimers());

describe("ISS-013 private current policy reader; no history, recovery or AC7 authority", () => {
  test("ordered admission failures invoke neither adapter nor clocks", async () => {
    const read = vi.fn(async (request: CurrentPolicyRequest) => reply(request));
    const clock = { wallNow: vi.fn(), monotonicNow: vi.fn() };
    const { frontier, frontierDigest, ...snapshotCommon } = snapshot();
    const cases: [unknown, unknown, unknown, string][] = [
      [null, null, null, "ADAPTER_CONFIGURATION_REFUSED"],
      [{ ...config, extra: true }, provenance(), snapshot(), "ADAPTER_CONFIGURATION_REFUSED"],
      [config, null, null, "ADAPTER_BINDING_REFUSED"],
      [config, { ...provenance(), projectId: uuid(3) }, null, "ADAPTER_BINDING_REFUSED"],
      [{ ...config, adapterVersion: "2.0.0" }, provenance(), null, "ADAPTER_COMPATIBILITY_REFUSED"],
      [
        { ...config, adapterId: "other" },
        provenance({ ...config, adapterId: "other" }),
        null,
        "ADAPTER_COMPATIBILITY_REFUSED",
      ],
      [{ ...config, engineVersion: "0.0.1" }, provenance(), null, "ADAPTER_COMPATIBILITY_REFUSED"],
      [config, provenance(), null, "PROJECT_SNAPSHOT_REFUSED"],
      [
        config,
        provenance(),
        { ...snapshot(), frontierDigest: "b".repeat(64) },
        "PROJECT_SNAPSHOT_REFUSED",
      ],
      [
        config,
        provenance(),
        snapshot(config, [row(2, "READY", ["unconfigured"])]),
        "PROJECT_SNAPSHOT_REFUSED",
      ],
      [config, provenance(), { ...snapshot(), projectId: uuid(3) }, "PROJECT_SNAPSHOT_REFUSED"],
      [
        config,
        provenance(),
        { ...snapshot(), adapterConfigurationDigest: "b".repeat(64) },
        "PROJECT_SNAPSHOT_REFUSED",
      ],
      [
        config,
        provenance(),
        { ...snapshotCommon, state: "UNKNOWN", reason: "SOURCE_UNKNOWN" },
        "PROJECT_SNAPSHOT_REFUSED",
      ],
      [
        config,
        provenance(),
        { ...snapshotCommon, state: "UNAVAILABLE", reason: "SOURCE_UNAVAILABLE" },
        "PROJECT_SNAPSHOT_REFUSED",
      ],
    ];
    for (const [configuration, source, retained, code] of cases)
      expect(await bind(read)(configuration, source, retained, clock)).toEqual({ ok: false, code });
    expect(read).not.toHaveBeenCalled();
    expect(clock.wallNow).not.toHaveBeenCalled();
    expect(clock.monotonicNow).not.toHaveBeenCalled();
  });

  test("static support admits no missing schemas/policy or duplicate constants", async () => {
    const read = vi.fn(async (request: CurrentPolicyRequest) => reply(request));
    const supports: [string[], string[], string[], string[]][] = [
      [[], schemas, ["work.read"], ["1.0.0"]],
      ...schemas.map((removed): [string[], string[], string[], string[]] => [
        ["0.0.0"],
        schemas.filter((name) => name !== removed),
        ["work.read"],
        ["1.0.0"],
      ]),
      [["0.0.0"], schemas, [], ["1.0.0"]],
      [["0.0.0"], schemas, ["work.read"], ["2.0.0"]],
      [["0.0.0", "0.0.0"], schemas, ["work.read"], ["1.0.0"]],
      [["0.0.0"], [...schemas, schemas[0]!], ["work.read"], ["1.0.0"]],
      [["0.0.0"], schemas, ["work.read", "work.read"], ["1.0.0"]],
      [["0.0.0"], schemas, ["work.read"], ["1.0.0", "1.0.0"]],
    ];
    for (const support of supports)
      expect(
        await createProjectCurrentPolicyReader(
          read,
          config.adapterId,
          "1.0.0",
          "1.0.0",
          ...support,
        )(config, provenance(), snapshot(), clocks),
      ).toEqual({ ok: false, code: "ADAPTER_COMPATIBILITY_REFUSED" });
    expect(read).not.toHaveBeenCalled();
  });

  test("all public arms have SDK-owned bindings and canonical full-content bytes", async () => {
    let elapsed = 0;
    const cases: [CurrentPolicyRead, string, string?][] = [
      [async (request) => reply(request), "COMPLETE"],
      [
        async (request) => ({ ...echo(request), state: "UNKNOWN", reason: "SOURCE_UNKNOWN" }),
        "UNKNOWN",
        "SOURCE_UNKNOWN",
      ],
      [
        async (request) => ({
          ...echo(request),
          state: "UNAVAILABLE",
          reason: "SOURCE_UNAVAILABLE",
        }),
        "UNAVAILABLE",
        "SOURCE_UNAVAILABLE",
      ],
      [async () => null, "UNKNOWN", "MALFORMED_OBSERVATION"],
      [
        async (request) => ({ ...reply(request), observationId: uuid(99) }),
        "UNKNOWN",
        "CHANGED_BINDING",
      ],
      [async (request) => ({ ...reply(request), frontier: [] }), "UNKNOWN", "CHANGED_SOURCE"],
      [
        async (request) => ({ ...reply(request), decisions: [] }),
        "UNKNOWN",
        "INCOMPLETE_CAPABILITIES",
      ],
      [
        async (request) => {
          elapsed = 5000;
          return reply(request);
        },
        "UNAVAILABLE",
        "OBSERVATION_TIMEOUT",
      ],
    ];
    for (const [read, state, reason] of cases) {
      elapsed = 0;
      const value = facts(await invoke(read, { ...clocks, monotonicNow: () => elapsed }));
      expect(value.state).toBe(state);
      const arm =
        state === "COMPLETE"
          ? '"decisions":[{"capabilityName":"work.read","trip":"NO_TRIP"}],'
          : "";
      const tail = reason ? `"reason":"${reason}",` : "";
      const expected = `{"adapterConfigurationDigest":"${canonicalDigest(config)}",${arm}"observationId":"${value.observationId}","observedAt":"${observedAt}","policyVersion":"1.0.0","projectFactsDigest":"${canonicalDigest(snapshot())}","projectId":"${config.projectId}",${tail}"schemaVersion":"project-breaker-facts/v1","state":"${state}"}\n`;
      expect(canonicalJson(value)).toBe(expected);
      expect(canonicalDigest(value)).toBe(createHash("sha256").update(expected).digest("hex"));
      if (reason) expect(value).not.toHaveProperty("decisions");
    }
  });

  test("shape precedes binding, source precedes census; every arm must echo every binding", async () => {
    for (const state of ["COMPLETE", "UNKNOWN", "UNAVAILABLE"]) {
      for (const moved of [
        { observationId: uuid(99) },
        { policyVersion: "2.0.0" },
        { projectFactsDigest: "b".repeat(64) },
      ])
        expect(
          await invoke(async (request) => ({
            ...(state === "COMPLETE"
              ? { ...reply(request), frontier: [], decisions: [] }
              : { ...echo(request), state, reason: `SOURCE_${state}` }),
            ...moved,
          })),
        ).toEqual(failure("UNKNOWN", "CHANGED_BINDING"));
    }
    expect(
      await invoke(async (request) => ({
        ...reply(request),
        observationId: uuid(99),
        frontier: [],
        decisions: [],
        extra: true,
      })),
    ).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
    expect(
      await invoke(async (request) => ({ ...reply(request), frontier: [], decisions: [] })),
    ).toEqual(failure("UNKNOWN", "CHANGED_SOURCE"));
    for (const decisions of [
      [
        { capabilityName: "work.read", trip: "TRIP" },
        { capabilityName: "work.read", trip: "NO_TRIP" },
      ],
      [
        { capabilityName: "z", trip: "TRIP" },
        { capabilityName: "a", trip: "TRIP" },
      ],
      [{ capabilityName: "work.read", trip: "RECOVER" }],
    ])
      expect(
        await invoke(async (request) => ({
          ...reply(request),
          observationId: uuid(99),
          decisions,
        })),
      ).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
    expect(
      await invoke(async (request) => ({
        ...reply(request),
        decisions: [{ capabilityName: "extra", trip: "NO_TRIP" }, ...reply(request).decisions],
      })),
    ).toEqual(failure("UNKNOWN", "INCOMPLETE_CAPABILITIES"));
    for (const frontier of [
      [row(3)],
      [row(2, "NOT_READY")],
      [{ ...row(), immutableSubjectDigest: "b".repeat(64) }],
      [row(2, "READY", [])],
    ])
      expect(await invoke(async (request) => ({ ...reply(request), frontier }))).toEqual(
        failure("UNKNOWN", "CHANGED_SOURCE"),
      );
  });

  test("requests retain detached snapshot and exact configured census across await", async () => {
    const mutableConfig = structuredClone(config);
    const mutableProvenance = provenance();
    const retained = structuredClone(snapshot());
    let request!: CurrentPolicyRequest;
    let settle!: (value: unknown) => void;
    const pending = bind((input) => {
      request = input;
      return new Promise((resolve) => {
        settle = resolve;
      });
    })(mutableConfig, mutableProvenance, retained, clocks);
    expect(Object.keys(request).sort()).toEqual([
      "capabilityNames",
      "observationId",
      "policyVersion",
      "projectFacts",
    ]);
    expect(request.projectFacts).not.toBe(retained);
    for (const value of [
      request,
      request.capabilityNames,
      request.projectFacts,
      request.projectFacts.frontier,
      request.projectFacts.frontier[0]!.capabilityNames,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    mutableConfig.projectId = uuid(70);
    mutableProvenance.capabilityNames.length = 0;
    retained.frontier = [];
    const response = structuredClone(reply(request));
    settle(response);
    const result = facts(await pending);
    response.decisions[0]!.trip = "TRIP";
    expect(result).toMatchObject({ decisions: [{ capabilityName: "work.read", trip: "NO_TRIP" }] });
    expect(result.observationId).not.toBe(snapshot().observationId);
    const second = facts(await invoke(async (input) => reply(input)));
    expect(second.observationId).not.toBe(result.observationId);
  });

  test("empty frontier uses configured census, and swapped empty/nonempty decisions refuse", async () => {
    for (const names of [[], ["work.read"]]) {
      const configuration = { ...config, capabilityNames: names };
      const retained = snapshot(configuration, []);
      for (const swap of [false, true]) {
        const read = vi.fn(async (request: CurrentPolicyRequest) => {
          expect(request.capabilityNames).toEqual(names);
          return {
            ...reply(request),
            decisions: (swap ? (names.length ? [] : ["work.read"]) : names).map(
              (capabilityName) => ({ capabilityName, trip: "NO_TRIP" }),
            ),
          };
        });
        const result = await bind(read)(configuration, provenance(configuration), retained, clocks);
        if (swap) expect(result).toEqual(failure("UNKNOWN", "INCOMPLETE_CAPABILITIES"));
        else
          expect(facts(result, configuration, retained)).toMatchObject({
            state: "COMPLETE",
            decisions: names.map((capabilityName) => ({ capabilityName, trip: "NO_TRIP" })),
          });
        expect(read).toHaveBeenCalledTimes(1);
      }
    }
  });

  test("older identical frontier may bind fresh policy, but snapshot metadata moves its required echo", async () => {
    const older = { ...snapshot(), observedAt: "2025-01-01T00:00:00.000Z" };
    const result = await bind(async (request) => reply(request))(
      config,
      provenance(),
      older,
      clocks,
    );
    expect(facts(result, config, older)).toMatchObject({
      state: "COMPLETE",
      projectFactsDigest: canonicalDigest(older),
    });
    expect(
      await bind(async (request) => ({
        ...reply(request),
        projectFactsDigest: canonicalDigest(snapshot()),
      }))(config, provenance(), older, clocks),
    ).toEqual(failure("UNKNOWN", "CHANGED_BINDING"));
  });

  test("nested hostile output and thenables never run input accessors", async () => {
    const getter = vi.fn();
    const then = vi.fn();
    for (const read of [
      () => ({ then }),
      async (request: CurrentPolicyRequest) => ({
        ...reply(request),
        decisions: [
          {
            capabilityName: "work.read",
            get trip() {
              return getter();
            },
          },
        ],
      }),
      async (request: CurrentPolicyRequest) => ({
        ...reply(request),
        frontier: new Proxy([], {
          ownKeys() {
            getter();
            return [];
          },
        }),
      }),
    ])
      expect(await invoke(read)).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
    expect(then).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  test("only exact native promises enter settlement; their own then is never consulted", async () => {
    const getter = vi.fn();
    class OtherPromise extends Promise<unknown> {}
    for (const read of [
      (request: CurrentPolicyRequest) => new OtherPromise((resolve) => resolve(reply(request))),
      (request: CurrentPolicyRequest) =>
        Object.defineProperty(Promise.resolve(reply(request)), "constructor", { get: getter }),
    ])
      expect(await invoke(read)).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
    const result = await invoke((request) =>
      Object.defineProperty(Promise.resolve(reply(request)), "then", { get: getter }),
    );
    expect(facts(result).state).toBe("COMPLETE");
    expect(getter).not.toHaveBeenCalled();
  });

  test.each(["throw", "reject"])(
    "source %s is unavailable but deadline takes precedence",
    async (mode) => {
      for (const elapsed of [4999, 5000]) {
        let now = 0;
        const result = await invoke(
          () => {
            now = elapsed;
            if (mode === "throw") throw new Error("private");
            return Promise.reject(new Error("private"));
          },
          { ...clocks, monotonicNow: () => now },
        );
        expect(result).toEqual(
          failure("UNAVAILABLE", elapsed === 5000 ? "OBSERVATION_TIMEOUT" : "SOURCE_UNAVAILABLE"),
        );
      }
    },
  );

  test.each([4999, 5000])("result admission at %i milliseconds", async (elapsed) => {
    let now = 0;
    const result = await invoke(
      async (request) => {
        now = elapsed;
        return reply(request);
      },
      { ...clocks, monotonicNow: () => now },
    );
    if (elapsed === 4999) expect(facts(result).state).toBe("COMPLETE");
    else expect(result).toEqual(failure("UNAVAILABLE", "OBSERVATION_TIMEOUT"));
  });

  test("the deadline includes final public binding validation", async () => {
    let now = 0;
    const result = await invoke(
      async (request) => {
        now = 4997;
        return reply(request);
      },
      { ...clocks, monotonicNow: () => (now >= 4997 ? now++ : 0) },
    );
    expect(result).toEqual(failure("UNAVAILABLE", "OBSERVATION_TIMEOUT"));
  });

  test.each(["resolve", "reject"])(
    "timeout remains terminal after late native %s",
    async (late) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      let request!: CurrentPolicyRequest;
      let resolve!: (value: unknown) => void;
      let reject!: (value: unknown) => void;
      const read = vi.fn((input: CurrentPolicyRequest) => {
        request = input;
        return new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        });
      });
      const pending = invoke(read, { ...clocks, monotonicNow: () => Date.now() });
      let completed = false;
      void pending.then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(4999);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const terminal = await pending;
      expect(terminal).toEqual(failure("UNAVAILABLE", "OBSERVATION_TIMEOUT"));
      facts(terminal);
      if (late === "resolve") resolve(reply(request));
      else reject(new Error("late"));
      await vi.advanceTimersByTimeAsync(0);
      expect(await pending).toBe(terminal);
      expect(read).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test("clock faults are INTERNAL_ERROR, initial expiry invokes zero callbacks", async () => {
    const read = vi.fn(async (request: CurrentPolicyRequest) => reply(request));
    for (const monotonic of [NaN, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(await invoke(read, { ...clocks, monotonicNow: () => monotonic })).toEqual({
        ok: false,
        code: "INTERNAL_ERROR",
      });
    for (const wall of ["bad", "1969-12-31T23:59:59.999Z"])
      expect(await invoke(read, { ...clocks, wallNow: () => wall })).toEqual({
        ok: false,
        code: "INTERNAL_ERROR",
      });
    for (const second of ["throw", "regress", "expired"]) {
      let calls = 0;
      const result = await invoke(read, {
        ...clocks,
        monotonicNow: () => {
          if (++calls === 1) return 1;
          if (second === "throw") throw new Error("clock");
          return second === "regress" ? 0 : 5001;
        },
      });
      expect(result).toEqual(
        second === "expired"
          ? failure("UNAVAILABLE", "OBSERVATION_TIMEOUT")
          : { ok: false, code: "INTERNAL_ERROR" },
      );
    }
    expect(read).not.toHaveBeenCalled();
    let bad = false;
    expect(
      await invoke(
        async () => {
          bad = true;
          throw new Error("source");
        },
        { ...clocks, monotonicNow: () => (bad ? NaN : 0) },
      ),
    ).toEqual({ ok: false, code: "INTERNAL_ERROR" });
    vi.useFakeTimers();
    let ticks = 0;
    const pending = invoke(() => new Promise(() => {}), {
      ...clocks,
      monotonicNow: () => (++ticks <= 3 ? 0 : NaN),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ ok: false, code: "INTERNAL_ERROR" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("reviewed branch and document queue fixture policies", () => {
  test("0/1/2 NOT_READY rows contrast policies; READY and missing capability rows never count", async () => {
    for (const rows of [
      [],
      [row()],
      [row(2, "NOT_READY")],
      [row(2, "NOT_READY"), row(3, "NOT_READY")],
      [row(2, "NOT_READY", [])],
    ]) {
      const frontiers: string[] = [];
      const outputs: string[] = [];
      for (const adapter of ["branches", "queue"] as const) {
        const configuration = { ...config, adapterId: `fixture.${adapter}` };
        const branchInput = () =>
          rows.map((item) => ({
            workId: item.workId,
            branch: "feature/fixture",
            revisionDigest: item.immutableSubjectDigest,
            blocked: item.readiness === "NOT_READY",
            capabilityNames: item.capabilityNames,
          }));
        const queueInput = () =>
          rows.map((item) => ({
            ticketId: item.workId,
            documentDigest: item.immutableSubjectDigest,
            admitted: item.readiness === "READY",
            capabilityNames: item.capabilityNames,
          }));
        const observe =
          adapter === "branches"
            ? createBranchFixtureSnapshot(branchInput)
            : createQueueFixtureSnapshot(queueInput);
        const policy =
          adapter === "branches"
            ? createBranchFixtureCurrentPolicy(branchInput)
            : createQueueFixtureCurrentPolicy(queueInput);
        const retained = await observe(configuration, provenance(configuration), clocks);
        if (!retained.ok || retained.facts.state !== "COMPLETE") throw new Error("snapshot failed");
        frontiers.push(canonicalJson(retained.facts.frontier));
        expect(retained.facts.frontier).toEqual(rows);
        const result = await policy(
          configuration,
          provenance(configuration),
          retained.facts,
          clocks,
        );
        if (!result.ok || result.facts.state !== "COMPLETE") throw new Error("policy failed");
        expect(
          validateProjectBreakerFactsBinding(result.facts, configuration, retained.facts, "1.0.0")
            .ok,
        ).toBe(true);
        outputs.push(result.facts.decisions[0]!.trip);
      }
      expect(frontiers[0]).toBe(frontiers[1]);
      const count = rows.filter(
        (item) => item.readiness === "NOT_READY" && item.capabilityNames.includes("work.read"),
      ).length;
      expect(outputs).toEqual([count >= 1 ? "TRIP" : "NO_TRIP", count >= 2 ? "TRIP" : "NO_TRIP"]);
    }
  });

  test.each(["branches", "queue"] as const)(
    "%s reads fresh once per policy call, source movement refuses, old source inputs preserve snapshot",
    async (adapter) => {
      const configuration = { ...config, adapterId: `fixture.${adapter}` };
      let rows = [row()];
      let sourceFailure: FixturePolicySourceFailure | undefined;
      let reads = 0;
      // These old private inputs omit the new optional field, preserving work.read.
      const branchInput = () =>
        rows.map((item) => ({
          workId: item.workId,
          branch: "feature/fixture",
          revisionDigest: item.immutableSubjectDigest,
          blocked: item.readiness === "NOT_READY",
        }));
      const queueInput = () =>
        rows.map((item) => ({
          ticketId: item.workId,
          documentDigest: item.immutableSubjectDigest,
          admitted: item.readiness === "READY",
        }));
      const observe =
        adapter === "branches"
          ? createBranchFixtureSnapshot(branchInput)
          : createQueueFixtureSnapshot(queueInput);
      const policy =
        adapter === "branches"
          ? createBranchFixtureCurrentPolicy(() => {
              reads++;
              return sourceFailure ?? branchInput();
            })
          : createQueueFixtureCurrentPolicy(() => {
              reads++;
              return sourceFailure ?? queueInput();
            });
      const retained = await observe(configuration, provenance(configuration), clocks);
      if (!retained.ok || retained.facts.state !== "COMPLETE") throw new Error("snapshot failed");
      expect(retained.facts.frontier).toEqual([row()]);
      expect(retained.facts.frontierDigest).toBe(canonicalDigest([row()]));
      for (let count = 1; count <= 2; count++) {
        expect(
          await policy(configuration, provenance(configuration), retained.facts, clocks),
        ).toMatchObject({ ok: true, facts: { state: "COMPLETE" } });
        expect(reads).toBe(count);
      }
      rows = [row(2, "NOT_READY")];
      expect(
        await policy(configuration, provenance(configuration), retained.facts, clocks),
      ).toEqual(failure("UNKNOWN", "CHANGED_SOURCE"));
      for (const state of ["UNKNOWN", "UNAVAILABLE"] as const) {
        sourceFailure =
          state === "UNKNOWN"
            ? { state, reason: "SOURCE_UNKNOWN" }
            : { state, reason: "SOURCE_UNAVAILABLE" };
        expect(
          await policy(configuration, provenance(configuration), retained.facts, clocks),
        ).toEqual(failure(state, sourceFailure.reason));
      }
      expect(reads).toBe(5);
      expect(await policy(null, null, null, clocks)).toEqual({
        ok: false,
        code: "ADAPTER_CONFIGURATION_REFUSED",
      });
      expect(reads).toBe(5);
      sourceFailure = undefined;
      rows = [];
      for (const capabilityNames of [[], ["work.read"]]) {
        const emptyConfig = { ...configuration, capabilityNames };
        const empty = await observe(emptyConfig, provenance(emptyConfig), clocks);
        if (!empty.ok) throw new Error("snapshot failed");
        expect(
          await policy(emptyConfig, provenance(emptyConfig), empty.facts, clocks),
        ).toMatchObject({
          ok: true,
          facts: {
            state: "COMPLETE",
            decisions: capabilityNames.map((capabilityName) => ({
              capabilityName,
              trip: "NO_TRIP",
            })),
          },
        });
      }
      expect(reads).toBe(7);
    },
  );
});
