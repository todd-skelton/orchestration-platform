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
} from "@orchestration-platform/contracts";
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
  adapterId: "fixture.adapter",
  capabilityNames: ["fixture.read"],
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
  immutableSubjectDigest: canonicalDigest(source),
  moduleDescriptorDigest: canonicalDigest(descriptor),
  requestedRole: "observer",
  schemaVersion: "dispatch-action-core/v1",
};

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "walking-skeleton-")));
  roots.push(root);
  const projectRoot = join(root, "project");
  const configPath = join(projectRoot, ".orchestration", "project.json");
  const stateRoot = join(root, "state");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, canonicalJson(source));
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
  return { root, configPath, stateRoot, invocation };
}

afterEach(async () => {
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

test("consumes real contracts and pure configuration without writing outside admitted state", async () => {
  const f = await fixture();
  const outsideBefore = await manifest(f.root, f.stateRoot);
  const sourceBefore = await checkoutManifest();
  expect(parseContract("platform-configuration-source/v1", source).ok).toBe(true);
  expect(await consume(adapter, f.invocation, action)).toEqual({
    ok: true,
    files: ["configuration.json", "action.json", "brief.json"],
  });
  expect((await readdir(f.stateRoot)).sort()).toEqual([
    "action.json",
    "brief.json",
    "configuration.json",
  ]);
  for (const [file, schema] of [
    ["action.json", "dispatch-action-core/v1"],
    ["brief.json", "dispatch-brief/v1"],
    ["configuration.json", "configuration-provenance/v1"],
  ] as const) {
    const bytes = await readFile(join(f.stateRoot, file));
    const parsed = parseCanonicalContractBytes(schema, bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("public parser refused output");
    expect(canonicalJson(parsed.value)).toBe(bytes.toString("utf8"));
    expect(bytes.toString("utf8")).not.toContain(f.root);
    if (file === "brief.json")
      expect(parsed.value.action).toMatchObject({
        actionCoreDigest: computeDispatchActionCoreDigest(action),
        immutableSubjectDigest: action.immutableSubjectDigest,
      });
  }
  expect(await manifest(f.root, f.stateRoot)).toEqual(outsideBefore);
  expect(await checkoutManifest()).toEqual(sourceBefore);
}, 30_000);

test("retains action-brief binding when the caller mutates its action across plan await", async () => {
  const f = await fixture();
  const callerAction = { ...action };
  const originalPlan = fixtureModule.plan;
  const spy = vi.spyOn(fixtureModule, "plan").mockImplementation(async (input) => {
    const result = await originalPlan(input);
    callerAction.immutableSubjectDigest = "f".repeat(64);
    return result;
  });
  try {
    expect((await consume(adapter, f.invocation, callerAction)).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(callerAction.immutableSubjectDigest).not.toBe(action.immutableSubjectDigest);
    const persistedAction = parseCanonicalContractBytes(
      "dispatch-action-core/v1",
      await readFile(join(f.stateRoot, "action.json")),
    );
    const persistedBrief = parseCanonicalContractBytes(
      "dispatch-brief/v1",
      await readFile(join(f.stateRoot, "brief.json")),
    );
    expect(persistedAction.ok && persistedBrief.ok).toBe(true);
    if (!persistedAction.ok || !persistedBrief.ok) throw new Error("public parser refused output");
    expect(persistedAction.value).toEqual(action);
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
    expect(
      validateDispatchBriefBinding(persistedBrief.value, persistedAction.value, catalog, [pair]),
    ).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

test("malformed action and changed descriptor refuse before state creation", async () => {
  const f = await fixture();
  const before = await manifest(f.root);
  for (const invalid of [
    { ...action, extra: true },
    { ...action, moduleDescriptorDigest: "f".repeat(64) },
  ]) {
    const result = await consume(adapter, f.invocation, invalid);
    expect(result.ok).toBe(false);
    expect(await manifest(f.root)).toEqual(before);
  }
});

test("malformed config preserves the loader refusal with no output", async () => {
  const f = await fixture();
  await writeFile(f.configPath, canonicalJson({ ...source, extra: true }));
  const before = await manifest(f.root);
  expect(await consume(adapter, f.invocation, action)).toEqual({
    ok: false,
    error: {
      code: "CONFIG_REFUSED",
      exitCode: 2,
      message: "configuration refused",
      outcome: "invalid-input",
    },
  });
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
