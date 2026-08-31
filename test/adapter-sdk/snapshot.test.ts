import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  canonicalDigest,
  canonicalJson,
  parseProjectFacts,
  validateProjectFactsBinding,
  type ProjectFacts,
} from "../../packages/contracts/src/index.js";
import {
  createProjectSnapshotReader,
  createBranchFixtureSnapshot,
  createQueueFixtureSnapshot,
  type SnapshotClocks,
  type SnapshotReadPage,
  type SnapshotRequest,
  type SnapshotResult,
} from "../../packages/adapter-sdk/src/index.js";

const uuid = (index: number) => `018f0f4d-7b2d-7a11-8a2b-${index.toString(16).padStart(12, "0")}`;
const projectId = uuid(1);
const observedAt = "2026-08-30T01:02:03.004Z";
const config = {
  adapterId: "fixture.branches",
  adapterVersion: "1.0.0",
  capabilityNames: ["work.read"],
  engineVersion: "0.0.0",
  projectId,
  schemaVersion: "adapter-configuration/v1",
};
const provenance = (adapterId = config.adapterId) => ({
  adapterId,
  capabilityNames: ["work.read"],
  projectId,
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
const row = (index = 2, readiness = "READY") => ({
  workId: uuid(index),
  immutableSubjectDigest: "a".repeat(64),
  capabilityNames: ["work.read"],
  readiness,
});
const page = (
  request: SnapshotRequest,
  frontier = [row()],
  nextCursor: string | null = null,
  digest = canonicalDigest(frontier),
) => ({
  ...request,
  state: "COMPLETE",
  frontier,
  nextCursor,
  frontierDigest: digest,
});
const bind = (readPage: SnapshotReadPage) =>
  createProjectSnapshotReader(
    readPage,
    "fixture.branches",
    "1.0.0",
    ["0.0.0"],
    ["adapter-configuration/v1", "project-facts/v1"],
    ["work.read"],
  );
function facts(result: SnapshotResult): ProjectFacts {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(parseProjectFacts(result.facts).ok).toBe(true);
  expect(validateProjectFactsBinding(result.facts, config).ok).toBe(true);
  return result.facts;
}
const failure = (state: string, reason: string) => ({
  ok: true,
  facts: expect.objectContaining({ state, reason }),
});

afterEach(() => vi.useRealTimers());

describe("ISS-013 read-only SDK snapshot subset, not full adapter conformance", () => {
  test("both fixtures produce sorted complete observations from new input on every invocation", async () => {
    for (const adapter of ["branches", "queue"] as const) {
      let rows = [row(4), row(2, "NOT_READY"), row(3)];
      let reads = 0;
      const branch = createBranchFixtureSnapshot(() => {
        reads++;
        return rows.map((item) => ({
          workId: item.workId,
          branch: "feature/opaque",
          revisionDigest: item.immutableSubjectDigest,
          blocked: item.readiness === "NOT_READY",
        }));
      });
      const queue = createQueueFixtureSnapshot(() => {
        reads++;
        return rows.map((item) => ({
          ticketId: item.workId,
          documentDigest: item.immutableSubjectDigest,
          admitted: item.readiness === "READY",
        }));
      });
      const invoke = adapter === "branches" ? branch : queue;
      const configuration = { ...config, adapterId: `fixture.${adapter}` };
      const first = await invoke(configuration, provenance(configuration.adapterId), clocks);
      if (!first.ok || first.facts.state !== "COMPLETE") throw new Error("fixture failed");
      const sorted = [row(2, "NOT_READY"), row(3), row(4)];
      expect(first.facts.frontier).toEqual(sorted);
      expect(first.facts.frontierDigest).toBe(canonicalDigest(sorted));
      expect(validateProjectFactsBinding(first.facts, configuration).ok).toBe(true);
      expect(Object.isFrozen(first.facts.frontier[0]!.capabilityNames)).toBe(true);
      rows = [];
      const second = await invoke(configuration, provenance(configuration.adapterId), clocks);
      if (!second.ok || second.facts.state !== "COMPLETE") throw new Error("fixture failed");
      expect(second.facts.frontier).toEqual([]);
      expect(second.facts.frontierDigest).toBe(
        "37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570",
      );
      expect(second.facts.observationId).not.toBe(first.facts.observationId);
      expect(reads).toBe(2);
    }
  });

  test("config and loaded provenance refuse before any callback", async () => {
    const read = vi.fn(async (request: SnapshotRequest) => page(request));
    for (const input of [
      null,
      { ...config, extra: 1 },
      { ...config, schemaVersion: "adapter-configuration/v9" },
      { ...config, capabilityNames: ["work.read", "work.read"] },
    ])
      expect(await bind(read)(input, provenance(), clocks)).toEqual({
        ok: false,
        code: "ADAPTER_CONFIGURATION_REFUSED",
      });
    for (const changed of [
      null,
      { ...provenance(), projectId: uuid(99) },
      { ...provenance(), adapterId: "other" },
      { ...provenance(), capabilityNames: [] },
    ])
      expect(await bind(read)(config, changed, clocks)).toEqual({
        ok: false,
        code: "ADAPTER_BINDING_REFUSED",
      });
    expect(read).not.toHaveBeenCalled();
  });

  test("static callback identity/version/engine/schema/capability support is exact", async () => {
    const read = vi.fn(async (request: SnapshotRequest) => page(request));
    const supported = ["adapter-configuration/v1", "project-facts/v1"];
    const cases: [string, string, string[], string[], string[]][] = [
      ["other", "1.0.0", ["0.0.0"], supported, ["work.read"]],
      [config.adapterId, "1.0.1", ["0.0.0"], supported, ["work.read"]],
      [config.adapterId, "1.0.0", ["0.0.1"], supported, ["work.read"]],
      [config.adapterId, "1.0.0", ["0.0.0"], [supported[0]!], ["work.read"]],
      [config.adapterId, "1.0.0", ["0.0.0"], [supported[1]!], ["work.read"]],
      [config.adapterId, "1.0.0", ["0.0.0"], supported, []],
      [config.adapterId, "1.0.0", ["0.0.0", "0.0.0"], supported, ["work.read"]],
      [config.adapterId, "1.0.0", ["0.0.0"], [...supported, supported[0]!], ["work.read"]],
      [config.adapterId, "1.0.0", ["0.0.0"], supported, ["work.read", "work.read"]],
    ];
    for (const support of cases)
      expect(
        await createProjectSnapshotReader(read, ...support)(config, provenance(), clocks),
      ).toEqual({ ok: false, code: "ADAPTER_COMPATIBILITY_REFUSED" });
    expect(await bind(read)({ ...config, engineVersion: "0.0.1" }, provenance(), clocks)).toEqual({
      ok: false,
      code: "ADAPTER_COMPATIBILITY_REFUSED",
    });
    expect(read).not.toHaveBeenCalled();
  });

  test("admitted config/provenance and requests are immutable across awaits", async () => {
    const mutableConfig = structuredClone(config);
    const mutableProvenance = provenance();
    let settle!: (value: unknown) => void;
    let request!: SnapshotRequest;
    const result = bind((input) => {
      request = input;
      return new Promise((resolve) => {
        settle = resolve;
      });
    })(mutableConfig, mutableProvenance, clocks);
    expect(Object.isFrozen(request)).toBe(true);
    mutableConfig.projectId = uuid(90);
    mutableConfig.capabilityNames.length = 0;
    mutableProvenance.projectId = uuid(91);
    settle(page(request));
    expect(facts(await result)).toMatchObject({
      projectId,
      adapterConfigurationDigest: canonicalDigest(config),
    });
  });

  test.each([
    ["UNKNOWN", "SOURCE_UNKNOWN"],
    ["UNAVAILABLE", "SOURCE_UNAVAILABLE"],
  ])("source %s discards accumulated rows", async (state, reason) => {
    const read = vi.fn(async (request: SnapshotRequest) =>
      request.cursor === null
        ? page(request, [row()], "a")
        : { observationId: request.observationId, state, reason },
    );
    const result = await bind(read)(config, provenance(), clocks);
    expect(result).toEqual(failure(state, reason));
    expect(facts(result)).not.toHaveProperty("frontier");
    expect(read).toHaveBeenCalledTimes(2);
  });

  test.each([
    [[row(2, "UNKNOWN"), row(3, "UNAVAILABLE")], "UNKNOWN", "SOURCE_UNKNOWN"],
    [[row(2, "UNAVAILABLE")], "UNAVAILABLE", "SOURCE_UNAVAILABLE"],
  ])("readiness fails the whole observation", async (rows, state, reason) => {
    const read = vi.fn(async (request: SnapshotRequest) => page(request, rows));
    expect(await bind(read)(config, provenance(), clocks)).toEqual(failure(state, reason));
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("64 pages of 64 rows succeed; nonterminal page 64 never fetches page 65", async () => {
    const rows = Array.from({ length: 4096 }, (_, index) => row(index + 2));
    const digest = canonicalDigest(rows);
    for (const terminal of [true, false]) {
      let count = 0;
      const read = vi.fn(async (request: SnapshotRequest) => {
        const frontier = rows.slice(count * 64, ++count * 64);
        return page(request, frontier, terminal && count === 64 ? null : `p${count}`, digest);
      });
      const result = await bind(read)(config, provenance(), clocks);
      expect(read).toHaveBeenCalledTimes(64);
      if (terminal) expect(facts(result)).toMatchObject({ state: "COMPLETE", frontier: rows });
      else expect(result).toEqual(failure("UNKNOWN", "INCOMPLETE_FRONTIER"));
    }
  });

  test.each([
    [
      "repeat cursor",
      "INCOMPLETE_FRONTIER",
      (request: SnapshotRequest) => page(request, [row(3)], "a"),
    ],
    [
      "changed digest",
      "CHANGED_FRONTIER",
      (request: SnapshotRequest) => page(request, [row(3)], null, "b".repeat(64)),
    ],
    ["duplicate work", "CHANGED_FRONTIER", (request: SnapshotRequest) => page(request, [row()])],
    [
      "wrong cursor",
      "CHANGED_FRONTIER",
      (request: SnapshotRequest) => ({ ...page(request, [row(3)]), cursor: "other" }),
    ],
    [
      "wrong observation plus repeated cursor",
      "CHANGED_FRONTIER",
      (request: SnapshotRequest) => ({ ...page(request, [row(3)], "a"), observationId: uuid(99) }),
    ],
    ["missing page", "MALFORMED_OBSERVATION", () => undefined],
  ])("%s has fixed precedence with no later reads", async (label, reason, next) => {
    const digest = canonicalDigest([row(3)]);
    const read = vi.fn(async (request: SnapshotRequest) => {
      if (request.cursor === null) return page(request, [row()], "a", digest);
      const result = next(request);
      if (result && label !== "changed digest") result.frontierDigest = digest;
      return result;
    });
    const result = await bind(read)(config, provenance(), clocks);
    expect(result).toEqual(failure("UNKNOWN", reason));
    expect(read).toHaveBeenCalledTimes(2);
    const value = facts(result);
    const bytes = `{"adapterConfigurationDigest":"${canonicalDigest(config)}","observationId":"${value.observationId}","observedAt":"${observedAt}","projectId":"${projectId}","reason":"${reason}","schemaVersion":"project-facts/v1","state":"UNKNOWN"}\n`;
    expect(canonicalJson(value)).toBe(bytes);
    expect(canonicalDigest(value)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  test("shape/scalars precede relations, relations precede readiness", async () => {
    const cases = [
      { ...page({ cursor: null, observationId: uuid(99) }), extra: true },
      {
        ...page({ cursor: null, observationId: uuid(99) }),
        frontier: Array.from({ length: 65 }, (_, i) => row(i + 2)),
      },
      { ...page({ cursor: null, observationId: uuid(99) }), nextCursor: "a\n" },
    ];
    for (const value of cases)
      expect(await bind(async () => value)(config, provenance(), clocks)).toEqual(
        failure("UNKNOWN", "MALFORMED_OBSERVATION"),
      );
    expect(
      await bind(async (request) => page(request, [row(2, "UNKNOWN")], null, "b".repeat(64)))(
        config,
        provenance(),
        clocks,
      ),
    ).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
    expect(
      await bind(async (request) =>
        page(request, [{ ...row(), capabilityNames: ["unrequested"] }]),
      )(config, provenance(), clocks),
    ).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
  });

  test("every page arm is closed and row scalars are bounded", async () => {
    for (const state of ["COMPLETE", "UNKNOWN", "UNAVAILABLE"]) {
      const create = (request: SnapshotRequest): Record<string, unknown> =>
        state === "COMPLETE"
          ? page(request)
          : { state, observationId: request.observationId, reason: `SOURCE_${state}` };
      for (const field of Object.keys(create({ cursor: null, observationId: uuid(99) }))) {
        expect(
          await bind(async (request) => {
            const value = create(request);
            delete value[field];
            return value;
          })(config, provenance(), clocks),
        ).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
      }
      expect(
        await bind(async (request) => ({ ...create(request), extra: true }))(
          config,
          provenance(),
          clocks,
        ),
      ).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
    }
    for (const mutation of [
      { workId: "not-a-uuid" },
      { immutableSubjectDigest: "A".repeat(64) },
      { readiness: "MAYBE" },
      { capabilityNames: ["work.read", "work.read"] },
      { capabilityNames: ["work.read\n"] },
      { capabilityNames: Array.from({ length: 257 }, () => "work.read") },
    ])
      expect(
        await bind(async (request) => page(request, [{ ...row(), ...mutation }]))(
          config,
          provenance(),
          clocks,
        ),
      ).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
    expect(
      await bind(async (request) => page(request, [row(), row()]))(config, provenance(), clocks),
    ).toEqual(failure("UNKNOWN", "CHANGED_FRONTIER"));
    expect(
      await bind(async (request) => page(request, [], null, "b".repeat(64)))(
        config,
        provenance(),
        clocks,
      ),
    ).toEqual(failure("UNKNOWN", "MALFORMED_OBSERVATION"));
  });

  test("hostile pages and thenables refuse without invoking input code", async () => {
    const getter = vi.fn(() => []);
    const then = vi.fn();
    for (const value of [
      null,
      new Proxy(
        {},
        {
          ownKeys() {
            getter();
            return [];
          },
        },
      ),
      {
        state: "COMPLETE",
        get frontier() {
          return getter();
        },
      },
      { ...page({ cursor: null, observationId: uuid(99) }), frontier: new Array(1) },
    ])
      expect(await bind(async () => value)(config, provenance(), clocks)).toEqual(
        failure("UNKNOWN", "MALFORMED_OBSERVATION"),
      );
    expect(await bind(() => ({ then }))(config, provenance(), clocks)).toEqual(
      failure("UNKNOWN", "MALFORMED_OBSERVATION"),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(then).not.toHaveBeenCalled();
  });

  test.each(["throw", "reject"])("callback %s is unavailable", async (mode) => {
    const read = vi.fn(() => {
      if (mode === "throw") throw new Error("private input");
      return Promise.reject(new Error("private input"));
    });
    expect(await bind(read)(config, provenance(), clocks)).toEqual(
      failure("UNAVAILABLE", "SOURCE_UNAVAILABLE"),
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  test.each(["resolve", "reject"])(
    "whole deadline ignores late %s of pending continuation",
    async (late) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      let finalRequest!: SnapshotRequest;
      const read = vi.fn((request: SnapshotRequest) => {
        if (request.cursor === null)
          return new Promise((yes) =>
            setTimeout(() => yes(page(request, [], "a", canonicalDigest([]))), 4000),
          );
        finalRequest = request;
        return new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        });
      });
      const result = bind(read)(config, provenance(), {
        ...clocks,
        monotonicNow: () => Date.now(),
      });
      await vi.advanceTimersByTimeAsync(4000);
      expect(read).toHaveBeenCalledTimes(2);
      let completed = false;
      void result.then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(completed).toBe(true);
      const terminal = await result;
      expect(terminal).toEqual(failure("UNAVAILABLE", "OBSERVATION_TIMEOUT"));
      if (late === "resolve") resolve(page(finalRequest, []));
      else reject(new Error("late"));
      await vi.advanceTimersByTimeAsync(0);
      expect(await result).toBe(terminal);
      expect(read).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test("initial deadline clock failure is INTERNAL_ERROR before any adapter callback", async () => {
    let clockCalls = 0;
    const read = vi.fn(() => {
      throw new Error("adapter must not run");
    });
    const result = await bind(read)(config, provenance(), {
      ...clocks,
      monotonicNow: () => {
        if (++clockCalls === 2) throw new Error("initial deadline check failed");
        return 0;
      },
    });
    expect(result).toEqual({ ok: false, code: "INTERNAL_ERROR" });
    expect(read).not.toHaveBeenCalled();
  });

  test("synchronous elapsed deadline and invalid clocks cannot produce COMPLETE", async () => {
    let now = 0;
    expect(
      await bind(async (request) => {
        now = 5000;
        return page(request);
      })(config, provenance(), { ...clocks, monotonicNow: () => now }),
    ).toEqual(failure("UNAVAILABLE", "OBSERVATION_TIMEOUT"));
    const read = vi.fn(async (request: SnapshotRequest) => page(request));
    for (const clock of [NaN, -1, 0.5])
      expect(
        await bind(read)(config, provenance(), { ...clocks, monotonicNow: () => clock }),
      ).toEqual({ ok: false, code: "INTERNAL_ERROR" });
    expect(read).not.toHaveBeenCalled();
  });
});
