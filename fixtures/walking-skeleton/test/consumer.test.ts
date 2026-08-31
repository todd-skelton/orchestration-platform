import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  canonicalDigest,
  canonicalJson,
  computeDispatchActionCoreDigest,
  dispatchDirectiveKinds,
  parseCanonicalContractBytes,
  parseContract,
  validateDispatchBriefBinding,
  validateAdapterConfigurationBinding,
  validateProjectFactsBinding,
  type ProjectFrontierRow,
} from "@orchestration-platform/contracts";
import {
  createBranchFixtureSnapshot,
  createQueueFixtureSnapshot,
} from "../../../packages/adapter-sdk/src/fixtures.js";
import {
  createProjectSnapshotReader,
  type SnapshotReadPage,
} from "../../../packages/adapter-sdk/src/snapshot.js";
import {
  createPortableConfigurationHostAdapter,
  createWindowsConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import { consume } from "../src/consume.js";
import { descriptor } from "../src/index.js";
import * as fixtureModule from "../src/index.js";

const checkout = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];
const source = {
  adapterId: "fixture.branches",
  capabilityNames: ["work.read"],
  leaseFreshnessMs: 30_000,
  maximumSessionMs: 3_600_000,
  projectId: "018f0f4d-7b2d-7a11-8a2b-123456789abc",
  schemaVersion: "platform-configuration-source/v1",
  stateRoot: null,
  wallClockSkewMs: 1_000,
};
const operatingSystem =
  process.platform === "win32" ? "WINDOWS" : process.platform === "darwin" ? "MACOS" : "LINUX";
const adapter =
  operatingSystem === "WINDOWS"
    ? createWindowsConfigurationHostAdapter()
    : createPortableConfigurationHostAdapter(operatingSystem);
const action = {
  actionKind: descriptor.actionKind,
  capabilityName: descriptor.capabilityName,
  immutableSubjectDigest: "a".repeat(64),
  moduleDescriptorDigest: canonicalDigest(descriptor),
  requestedRole: "observer",
  schemaVersion: "dispatch-action-core/v1",
};

const uuid = (index: number) => `018f0f4d-7b2d-7a11-8a2b-${index.toString(16).padStart(12, "0")}`;
const clocks = { wallNow: () => "2026-08-30T01:02:03.004Z", monotonicNow: () => 0 };
const frontier = (): ProjectFrontierRow[] => [
  {
    workId: uuid(4),
    immutableSubjectDigest: "b".repeat(64),
    readiness: "READY",
    capabilityNames: ["work.read"],
  },
  {
    workId: uuid(2),
    immutableSubjectDigest: "c".repeat(64),
    readiness: "NOT_READY",
    capabilityNames: ["work.read"],
  },
  {
    workId: uuid(3),
    immutableSubjectDigest: action.immutableSubjectDigest,
    readiness: "READY",
    capabilityNames: ["work.read"],
  },
];
const sdk = (read: SnapshotReadPage) =>
  createProjectSnapshotReader(
    read,
    "fixture.branches",
    "1.0.0",
    ["0.0.0"],
    ["adapter-configuration/v1", "project-facts/v1"],
    ["work.read"],
  );

async function fixture(kind: "branches" | "queue" = "branches", rows = frontier()) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "walking-skeleton-")));
  roots.push(root);
  const projectRoot = join(root, "project");
  const configPath = join(projectRoot, ".orchestration", "project.json");
  const stateRoot = join(root, "state");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, canonicalJson({ ...source, adapterId: `fixture.${kind}` }));
  const invocation: ConfigurationLoaderInvocation = {
    cwd: projectRoot,
    operatingSystem,
    flags: { configPath, projectRoot, stateRoot },
    environment: {
      HOME: null,
      LOCALAPPDATA: null,
      ORCHESTRATION_CONFIG: null,
      ORCHESTRATION_PROJECT_ROOT: null,
      ORCHESTRATION_STATE_ROOT: null,
      XDG_STATE_HOME: null,
    },
  };
  const configuration = {
    adapterId: `fixture.${kind}`,
    adapterVersion: "1.0.0",
    capabilityNames: ["work.read"],
    engineVersion: "0.0.0",
    projectId: source.projectId,
    schemaVersion: "adapter-configuration/v1",
  };
  const snapshot =
    kind === "branches"
      ? createBranchFixtureSnapshot(() =>
          rows.map((row) => ({
            workId: row.workId,
            branch: "fixture/opaque",
            revisionDigest: row.immutableSubjectDigest,
            blocked: row.readiness !== "READY",
          })),
        )
      : createQueueFixtureSnapshot(() =>
          rows.map((row) => ({
            ticketId: row.workId,
            documentDigest: row.immutableSubjectDigest,
            admitted: row.readiness === "READY",
          })),
        );
  return { root, configPath, stateRoot, invocation, configuration, snapshot };
}

afterEach(async () => {
  vi.restoreAllMocks();
  const temporaryParent = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (
      dirname(root) !== temporaryParent ||
      !root.startsWith(join(temporaryParent, "walking-skeleton-"))
    ) {
      throw new Error("fixture cleanup escaped its disposable root");
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function manifest(root: string, excluded?: string): Promise<string[]> {
  const rows: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (path === excluded) continue;
    rows.push(
      entry.name +
        (entry.isDirectory()
          ? "/"
          : ":" +
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex")),
    );
    if (entry.isDirectory())
      rows.push(...(await manifest(path)).map((row) => `${entry.name}/${row}`));
  }
  return rows.sort();
}

async function checkoutManifest() {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: checkout,
    encoding: "utf8",
    windowsHide: true,
  })
    .split("\0")
    .filter(Boolean);
  return Promise.all(
    files.map(
      async (file) =>
        `${file}:${createHash("sha256")
          .update(await readFile(join(checkout, file)))
          .digest("hex")}`,
    ),
  );
}

async function output(f: Awaited<ReturnType<typeof fixture>>, file: string, schema: string) {
  const bytes = await readFile(join(f.stateRoot, file));
  const parsed = parseCanonicalContractBytes(schema, bytes);
  if (!parsed.ok) throw new Error("public parser refused output");
  expect(canonicalJson(parsed.value)).toBe(bytes.toString("utf8"));
  expect(bytes.toString("utf8")).not.toContain(f.root);
  return parsed.value;
}

test("both real SDK fixtures bind equivalent opaque work to the same canonical brief", async () => {
  const sourceBefore = await checkoutManifest();
  const briefs: unknown[] = [];
  for (const kind of ["branches", "queue"] as const) {
    const f = await fixture(kind);
    const outsideBefore = await manifest(f.root, f.stateRoot);
    expect(await consume(adapter, f.invocation, f.configuration, f.snapshot, clocks)).toEqual({
      ok: true,
      files: [
        "configuration.json",
        "adapter-configuration.json",
        "project-facts.json",
        "action.json",
        "brief.json",
      ],
    });
    expect((await readdir(f.stateRoot)).sort()).toEqual([
      "action.json",
      "adapter-configuration.json",
      "brief.json",
      "configuration.json",
      "project-facts.json",
    ]);
    const provenance = await output(f, "configuration.json", "configuration-provenance/v1");
    const configuration = await output(f, "adapter-configuration.json", "adapter-configuration/v1");
    const facts = await output(f, "project-facts.json", "project-facts/v1");
    const core = await output(f, "action.json", "dispatch-action-core/v1");
    const brief = await output(f, "brief.json", "dispatch-brief/v1");
    expect(validateAdapterConfigurationBinding(configuration, provenance).ok).toBe(true);
    expect(validateProjectFactsBinding(facts, configuration).ok).toBe(true);
    expect(core).toEqual(action);
    expect(core.immutableSubjectDigest).not.toBe(facts.frontierDigest);
    expect(brief.action).toMatchObject({ actionCoreDigest: computeDispatchActionCoreDigest(core) });
    briefs.push(canonicalJson(brief));
    expect(await manifest(f.root, f.stateRoot)).toEqual(outsideBefore);
  }
  expect(briefs[0]).toEqual(briefs[1]);
  expect(await checkoutManifest()).toEqual(sourceBefore);
}, 30_000);

test("fresh changed subjects change both core and brief without using the frontier digest", async () => {
  const results = [];
  for (const digest of ["a".repeat(64), "d".repeat(64)]) {
    const rows = frontier();
    rows[2] = { ...rows[2]!, immutableSubjectDigest: digest };
    const f = await fixture("branches", rows);
    expect((await consume(adapter, f.invocation, f.configuration, f.snapshot, clocks)).ok).toBe(
      true,
    );
    const core = await output(f, "action.json", "dispatch-action-core/v1");
    const brief = await output(f, "brief.json", "dispatch-brief/v1");
    expect(core.immutableSubjectDigest).toBe(digest);
    expect(brief.action).toMatchObject({
      immutableSubjectDigest: digest,
      actionCoreDigest: computeDispatchActionCoreDigest(core),
    });
    results.push([canonicalJson(core), canonicalJson(brief)]);
  }
  expect(results[0]![0]).not.toBe(results[1]![0]);
  expect(results[0]![1]).not.toBe(results[1]![1]);
});

test("retains the selected action when source work changes across the plan await", async () => {
  const rows = frontier();
  const f = await fixture("branches", rows);
  const originalPlan = fixtureModule.plan;
  const spy = vi.spyOn(fixtureModule, "plan").mockImplementation(async (input) => {
    expect(Object.isFrozen(input)).toBe(true);
    const result = await originalPlan(input);
    rows[2] = { ...rows[2]!, immutableSubjectDigest: "f".repeat(64) };
    return result;
  });
  expect((await consume(adapter, f.invocation, f.configuration, f.snapshot, clocks)).ok).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
  const core = await output(f, "action.json", "dispatch-action-core/v1");
  const brief = await output(f, "brief.json", "dispatch-brief/v1");
  expect(core).toEqual(action);
  expect(core.immutableSubjectDigest).not.toBe(rows[2]!.immutableSubjectDigest);
  const pair = { actionKind: descriptor.actionKind, capabilityName: descriptor.capabilityName };
  const catalog = dispatchDirectiveKinds
    .filter((kind) => kind !== "OPERATOR_ACTION")
    .map((directiveKind) => ({
      ...pair,
      code: directiveKind.toLowerCase(),
      directiveKind,
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: `fixture.${directiveKind.toLowerCase()}`,
    }));
  expect(validateDispatchBriefBinding(brief, core, catalog, [pair])).toEqual([]);
});

test.each(["UNKNOWN", "UNAVAILABLE", "NO_READY", "NO_CAPABILITY"] as const)(
  "%s never plans or writes",
  async (state) => {
    const f = await fixture();
    const before = await manifest(f.root);
    const spy = vi.spyOn(fixtureModule, "plan");
    const snapshot = sdk(async (request) => {
      if (state === "UNKNOWN" || state === "UNAVAILABLE")
        return {
          state,
          observationId: request.observationId,
          reason: state === "UNKNOWN" ? "SOURCE_UNKNOWN" : "SOURCE_UNAVAILABLE",
        };
      const rows = [
        {
          ...frontier()[2]!,
          readiness: state === "NO_READY" ? "NOT_READY" : "READY",
          capabilityNames: state === "NO_CAPABILITY" ? [] : ["work.read"],
        },
      ];
      return {
        ...request,
        state: "COMPLETE",
        nextCursor: null,
        frontier: rows,
        frontierDigest: canonicalDigest(rows),
      };
    });
    expect(await consume(adapter, f.invocation, f.configuration, snapshot, clocks)).toEqual({
      ok: false,
      issues: [state.startsWith("NO_") ? "fixture:no-eligible-work" : `fixture:snapshot:${state}`],
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await manifest(f.root)).toEqual(before);
  },
);

test("config and facts binding failures never plan or write", async () => {
  const f = await fixture();
  const before = await manifest(f.root);
  const spy = vi.spyOn(fixtureModule, "plan");
  const read = vi.fn(f.snapshot);
  expect(
    (
      await consume(
        adapter,
        f.invocation,
        { ...f.configuration, projectId: uuid(99) },
        read,
        clocks,
      )
    ).ok,
  ).toBe(false);
  expect(read).not.toHaveBeenCalled();
  const moved: typeof f.snapshot = async (...args) => {
    const result = await f.snapshot(...args);
    if (!result.ok) return result;
    return { ok: true, facts: { ...result.facts, adapterConfigurationDigest: "f".repeat(64) } };
  };
  expect(await consume(adapter, f.invocation, f.configuration, moved, clocks)).toEqual({
    ok: false,
    issues: ["adapterConfigurationDigest:binding-mismatch"],
  });
  expect(spy).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
});

test("malformed config preserves the loader refusal with no output", async () => {
  const f = await fixture();
  await writeFile(f.configPath, canonicalJson({ ...source, extra: true }));
  const before = await manifest(f.root);
  const read = vi.fn(f.snapshot);
  const spy = vi.spyOn(fixtureModule, "plan");
  expect(await consume(adapter, f.invocation, f.configuration, read, clocks)).toEqual({
    ok: false,
    error: {
      code: "CONFIG_REFUSED",
      exitCode: 2,
      message: "configuration refused",
      outcome: "invalid-input",
    },
  });
  expect(read).not.toHaveBeenCalled();
  expect(spy).not.toHaveBeenCalled();
  expect(await manifest(f.root)).toEqual(before);
});

test.each([
  "event-journal/v1",
  "worker-result-subject/v1",
  "review-request/v1",
  "review-attempt-result/v1",
  "review-authority/v1",
  "routine-step-skip/v1",
  "cycle-receipt/v1",
])("keeps missing %s visible instead of fabricating full-cycle evidence", (schemaVersion) => {
  expect(parseContract(schemaVersion, { schemaVersion })).toEqual({
    ok: false,
    issues: ["schemaVersion:unsupported"],
  });
});
