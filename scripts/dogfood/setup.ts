import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const SETUP_AUTHORITY_SCHEMA = "dogfood-setup-authority/v1" as const;
export const SETUP_ROLES = ["pilot", "source", "review"] as const;
const SETUP_ACTIONS = ["worktrees", "dependencies"] as const;
const SHA = /^[a-f0-9]{40}$/;
const ABSENT = Symbol("absent");

export type SetupRole = (typeof SETUP_ROLES)[number];

export interface SetupAuthority {
  schemaVersion: typeof SETUP_AUTHORITY_SCHEMA;
  controller: string;
  run: string;
  issue: string;
  repository: string;
  controllerRevision: string;
  pilotRevision: string;
  base: string;
  baseBranch: string;
  sourceBranch: string;
  repositoryRoot: string;
  controllerRoot: string;
  pilotWorktree: string;
  sourceWorktree: string;
  reviewWorktree: string;
  stateDirectory: string;
  actions: (typeof SETUP_ACTIONS)[number][];
}

export interface SetupConfig {
  run: string;
  issue: string;
  repository: string;
  repositoryRoot: string;
  controllerRoot: string;
  controllerRevision: string;
  pilotRevision: string;
  base: string;
  baseBranch: string;
  sourceBranch: string;
  pilotWorktree: string;
  sourceWorktree: string;
  reviewWorktree: string;
  stateDirectory: string;
  authority: SetupAuthority;
}

export interface WorktreeObservation {
  state: "absent" | "confirmed" | "collision" | "unknown";
  head?: string;
  branch?: string | null;
}

export interface SetupAdapter {
  assertAuthority(config: SetupConfig, executingRoot: string): Promise<void>;
  observeWorktree(
    config: SetupConfig,
    role: SetupRole,
    owned: boolean,
  ): Promise<WorktreeObservation>;
  createWorktree(config: SetupConfig, role: SetupRole): Promise<void>;
  observeDependencies(
    config: SetupConfig,
    role: SetupRole,
  ): Promise<"present" | "absent" | "unknown">;
  installDependencies(
    config: SetupConfig,
    role: SetupRole,
  ): Promise<"succeeded" | "failed" | "unknown">;
}

export interface SetupResult {
  status: "ready" | "incomplete";
  reason?: "worktree-unconfirmed" | "dependency-install-failed" | "dependency-install-unknown";
  run: string;
  issue: string;
  heads: { pilot: string; source: string; review: string };
  worktrees: { pilot: string; source: string; review: string };
  phase: "worktrees" | "dependencies" | "complete";
}

export class SetupBlocked extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function demand(value: unknown, reason: string): asserts value {
  if (!value) throw new SetupBlocked(reason);
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function exactOrderedSet(value: unknown, expected: readonly string[]) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rolePath(config: SetupConfig, role: SetupRole) {
  if (role === "pilot") return config.pilotWorktree;
  if (role === "source") return config.sourceWorktree;
  return config.reviewWorktree;
}

function roleHead(config: SetupConfig, role: SetupRole) {
  return role === "pilot" ? config.pilotRevision : config.base;
}

function roleBranch(config: SetupConfig, role: SetupRole) {
  return role === "source" ? config.sourceBranch : null;
}

function configKeys() {
  return [
    "run",
    "issue",
    "repository",
    "repositoryRoot",
    "controllerRoot",
    "controllerRevision",
    "pilotRevision",
    "base",
    "baseBranch",
    "sourceBranch",
    "pilotWorktree",
    "sourceWorktree",
    "reviewWorktree",
    "stateDirectory",
    "authority",
  ];
}

function authorityKeys() {
  return [
    "schemaVersion",
    "controller",
    "run",
    "issue",
    "repository",
    "controllerRevision",
    "pilotRevision",
    "base",
    "baseBranch",
    "sourceBranch",
    "repositoryRoot",
    "controllerRoot",
    "pilotWorktree",
    "sourceWorktree",
    "reviewWorktree",
    "stateDirectory",
    "actions",
  ];
}

function validateConfig(config: SetupConfig) {
  demand(exactKeys(config, configKeys()), "malformed-setup-config");
  demand(typeof config.run === "string" && /^[\w.-]{1,80}$/.test(config.run), "invalid-run");
  demand(
    typeof config.issue === "string" && /^[\w:/.#-]{1,500}$/.test(config.issue),
    "invalid-issue",
  );
  demand(
    typeof config.repository === "string" && /^[^/\s]+\/[^/\s]+$/.test(config.repository),
    "invalid-repository",
  );
  for (const name of ["controllerRevision", "pilotRevision", "base"] as const)
    demand(typeof config[name] === "string" && SHA.test(config[name]), `invalid-${name}`);
  demand(config.controllerRevision === config.pilotRevision, "unreviewed-pilot-selection");
  demand(config.pilotRevision !== config.base, "candidate-as-pilot-selection");
  for (const name of ["baseBranch", "sourceBranch"] as const)
    demand(
      typeof config[name] === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(config[name]),
      `invalid-${name}`,
    );
  demand(config.baseBranch !== config.sourceBranch, "source-branch-is-base");
  for (const name of [
    "repositoryRoot",
    "controllerRoot",
    "pilotWorktree",
    "sourceWorktree",
    "reviewWorktree",
    "stateDirectory",
  ] as const)
    demand(typeof config[name] === "string" && isAbsolute(config[name]), `invalid-${name}`);

  const authority = config.authority;
  demand(
    exactKeys(authority, authorityKeys()) &&
      authority.schemaVersion === SETUP_AUTHORITY_SCHEMA &&
      typeof authority.controller === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(authority.controller) &&
      authority.run === config.run &&
      authority.issue === config.issue &&
      authority.repository === config.repository &&
      authority.controllerRevision === config.controllerRevision &&
      authority.pilotRevision === config.pilotRevision &&
      authority.base === config.base &&
      authority.baseBranch === config.baseBranch &&
      authority.sourceBranch === config.sourceBranch &&
      authority.repositoryRoot === config.repositoryRoot &&
      authority.controllerRoot === config.controllerRoot &&
      authority.pilotWorktree === config.pilotWorktree &&
      authority.sourceWorktree === config.sourceWorktree &&
      authority.reviewWorktree === config.reviewWorktree &&
      authority.stateDirectory === config.stateDirectory &&
      exactOrderedSet(authority.actions, SETUP_ACTIONS),
    "unauthorized-setup",
  );
}

function alternateAsciiCase(value: string) {
  return value.replace(/[A-Za-z]/g, (character) =>
    character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase(),
  );
}

async function pathIsCaseSensitive(existingPath: string) {
  let cursor = await realpath(existingPath);
  for (;;) {
    const name = basename(cursor);
    const alternateName = alternateAsciiCase(name);
    if (alternateName !== name) {
      const actual = await lstat(cursor);
      try {
        const alternate = await lstat(resolve(dirname(cursor), alternateName));
        return actual.dev !== alternate.dev || actual.ino !== alternate.ino;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        throw new SetupBlocked("unresolved-setup-path-case");
      }
    }
    const parent = dirname(cursor);
    demand(parent !== cursor, "unresolved-setup-path-case");
    cursor = parent;
  }
}

async function futureRealpath(path: string) {
  let cursor = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    try {
      const existing = await realpath(cursor);
      return {
        path: resolve(existing, ...suffix.reverse()),
        caseSensitive: await pathIsCaseSensitive(existing),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      demand(parent !== cursor, "unresolved-setup-path");
      suffix.push(basename(cursor));
      cursor = parent;
    }
  }
}

function comparable(path: string, caseSensitive: boolean) {
  const resolved = resolve(path);
  return caseSensitive ? resolved : resolved.toLowerCase();
}

function overlaps(left: string, right: string) {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  const outside = (value: string) =>
    value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
  return !outside(fromLeft) || !outside(fromRight);
}

async function assertSafePaths(config: SetupConfig) {
  const existing = await Promise.all(
    [config.repositoryRoot, config.controllerRoot, config.stateDirectory].map(async (path) => {
      const resolved = await realpath(path);
      demand((await stat(resolved)).isDirectory(), "setup-root-not-directory");
      return comparable(resolved, await pathIsCaseSensitive(resolved));
    }),
  );
  const requested = await Promise.all(
    [config.pilotWorktree, config.sourceWorktree, config.reviewWorktree].map(async (path) => {
      const facts = await futureRealpath(path);
      return comparable(facts.path, facts.caseSensitive);
    }),
  );
  const protectedRoots = [...existing, ...requested];
  for (let left = 0; left < protectedRoots.length; left++)
    for (let right = left + 1; right < protectedRoots.length; right++)
      demand(!overlaps(protectedRoots[left]!, protectedRoots[right]!), "overlapping-setup-paths");
}

async function optionalRecord(directory: string, name: string): Promise<unknown | typeof ABSENT> {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw new SetupBlocked(`malformed-record:${name}`);
  }
}

async function record(directory: string, name: string, value: unknown) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(resolve(directory, `${name}.json`), contents, { flag: "wx", flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let existing: string;
    try {
      existing = await readFile(resolve(directory, `${name}.json`), "utf8");
    } catch {
      throw new SetupBlocked(`malformed-record:${name}`);
    }
    demand(existing === contents, `conflicting-record:${name}`);
  }
}

function allowedStateNames() {
  return new Set([
    "setup-request.json",
    "setup-plan.json",
    ...SETUP_ROLES.flatMap((role) => [
      `worktree-${role}-intent.json`,
      `worktree-${role}.json`,
      `dependency-${role}-intent.json`,
      `dependency-${role}.json`,
    ]),
  ]);
}

async function assertStateCensus(config: SetupConfig) {
  const allowed = allowedStateNames();
  const entries = await readdir(config.stateDirectory, { withFileTypes: true });
  demand(
    entries.every((entry) => entry.isFile() && allowed.has(entry.name)),
    "unexpected-setup-state",
  );
}

function worktreeRecord(config: SetupConfig, role: SetupRole) {
  return {
    schemaVersion: "dogfood-setup-worktree/v1",
    run: config.run,
    role,
    path: rolePath(config, role),
    head: roleHead(config, role),
    branch: roleBranch(config, role),
  };
}

function dependencyRecord(config: SetupConfig, role: SetupRole) {
  return {
    schemaVersion: "dogfood-setup-dependency/v1",
    run: config.run,
    role,
    head: roleHead(config, role),
    launcher: "pnpm",
    offline: true,
    frozenLockfile: true,
    ignoreScripts: true,
    status: "complete",
  };
}

function dependencyIntent(config: SetupConfig, role: SetupRole) {
  return {
    schemaVersion: "dogfood-setup-dependency-intent/v1",
    run: config.run,
    role,
    head: roleHead(config, role),
    launcher: "pnpm",
    args: ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
  };
}

function exactRecord(actual: unknown, expected: unknown, reason: string) {
  demand(JSON.stringify(actual) === JSON.stringify(expected), reason);
}

function matchesObservation(
  config: SetupConfig,
  role: SetupRole,
  observation: WorktreeObservation,
) {
  return (
    observation.state === "confirmed" &&
    observation.head === roleHead(config, role) &&
    observation.branch === roleBranch(config, role)
  );
}

function result(
  config: SetupConfig,
  status: SetupResult["status"],
  phase: SetupResult["phase"],
  reason?: SetupResult["reason"],
): SetupResult {
  return {
    status,
    ...(reason ? { reason } : {}),
    run: config.run,
    issue: config.issue,
    heads: { pilot: config.pilotRevision, source: config.base, review: config.base },
    worktrees: {
      pilot: config.pilotWorktree,
      source: config.sourceWorktree,
      review: config.reviewWorktree,
    },
    phase,
  };
}

export async function assertSetupRequest(config: SetupConfig, requestPath: string) {
  validateConfig(config);
  demand(isAbsolute(requestPath), "request-path-not-absolute");
  const [request, directory] = await Promise.all([
    realpath(requestPath),
    realpath(config.stateDirectory),
  ]);
  demand(
    dirname(request) === directory && basename(request) === "setup-request.json",
    "request-outside-controller-state",
  );
}

export async function setupStep(
  config: SetupConfig,
  adapter: SetupAdapter,
  executingRoot = resolve(import.meta.dirname, "../.."),
): Promise<SetupResult> {
  validateConfig(config);
  await assertSafePaths(config);
  await adapter.assertAuthority(config, executingRoot);
  await assertStateCensus(config);

  const observations = new Map<SetupRole, WorktreeObservation>();
  for (const role of SETUP_ROLES) {
    const receipt = await optionalRecord(config.stateDirectory, `worktree-${role}`);
    if (receipt !== ABSENT)
      exactRecord(receipt, worktreeRecord(config, role), `malformed-worktree-receipt:${role}`);
    const intent = await optionalRecord(config.stateDirectory, `worktree-${role}-intent`);
    if (intent !== ABSENT)
      exactRecord(
        intent,
        {
          schemaVersion: "dogfood-setup-intent/v1",
          run: config.run,
          role,
          operation: digest(worktreeRecord(config, role)),
        },
        `malformed-worktree-intent:${role}`,
      );
    const observation = await adapter.observeWorktree(
      config,
      role,
      receipt !== ABSENT || intent !== ABSENT,
    );
    demand(observation.state !== "collision", `worktree-collision:${role}`);
    demand(observation.state !== "unknown", `worktree-state-unknown:${role}`);
    if (receipt !== ABSENT)
      demand(matchesObservation(config, role, observation), `worktree-state-drift:${role}`);
    if (observation.state === "confirmed")
      demand(receipt !== ABSENT || intent !== ABSENT, `unowned-worktree:${role}`);
    observations.set(role, observation);
  }
  for (const role of SETUP_ROLES) {
    const receipt = await optionalRecord(config.stateDirectory, `dependency-${role}`);
    if (receipt !== ABSENT) {
      exactRecord(receipt, dependencyRecord(config, role), `malformed-dependency-receipt:${role}`);
      demand(
        (await adapter.observeDependencies(config, role)) === "present",
        `dependency-state-drift:${role}`,
      );
    }
    const intent = await optionalRecord(config.stateDirectory, `dependency-${role}-intent`);
    if (intent !== ABSENT)
      exactRecord(intent, dependencyIntent(config, role), `malformed-dependency-intent:${role}`);
  }

  await record(config.stateDirectory, "setup-plan", {
    schemaVersion: "dogfood-setup-plan/v1",
    run: config.run,
    issue: config.issue,
    repository: config.repository,
    repositoryRoot: config.repositoryRoot,
    controllerRoot: config.controllerRoot,
    stateDirectory: config.stateDirectory,
    controller: config.authority.controller,
    authorityDigest: digest(config.authority),
    controllerRevision: config.controllerRevision,
    pilotRevision: config.pilotRevision,
    base: config.base,
    baseBranch: config.baseBranch,
    sourceBranch: config.sourceBranch,
    worktrees: SETUP_ROLES.map((role) => worktreeRecord(config, role)),
    dependencies: { launcher: "pnpm", offline: true, frozenLockfile: true, ignoreScripts: true },
  });

  for (const role of SETUP_ROLES) {
    let observation = observations.get(role)!;
    if (observation.state === "absent") {
      await record(config.stateDirectory, `worktree-${role}-intent`, {
        schemaVersion: "dogfood-setup-intent/v1",
        run: config.run,
        role,
        operation: digest(worktreeRecord(config, role)),
      });
      try {
        await adapter.createWorktree(config, role);
      } catch {}
      observation = await adapter.observeWorktree(config, role, true);
      demand(observation.state !== "collision", `worktree-collision:${role}`);
      demand(observation.state !== "unknown", `worktree-state-unknown:${role}`);
      if (observation.state === "absent")
        return result(config, "incomplete", "worktrees", "worktree-unconfirmed");
    }
    demand(matchesObservation(config, role, observation), `worktree-state-drift:${role}`);
    await record(config.stateDirectory, `worktree-${role}`, worktreeRecord(config, role));
  }

  for (const role of SETUP_ROLES) {
    const receipt = await optionalRecord(config.stateDirectory, `dependency-${role}`);
    if (receipt !== ABSENT) {
      exactRecord(receipt, dependencyRecord(config, role), `malformed-dependency-receipt:${role}`);
      demand(
        (await adapter.observeDependencies(config, role)) === "present",
        `dependency-state-drift:${role}`,
      );
      continue;
    }
    const intentValue = dependencyIntent(config, role);
    const intent = await optionalRecord(config.stateDirectory, `dependency-${role}-intent`);
    if (intent !== ABSENT) exactRecord(intent, intentValue, `malformed-dependency-intent:${role}`);
    else await record(config.stateDirectory, `dependency-${role}-intent`, intentValue);

    if (intent !== ABSENT) {
      const dependencies = await adapter.observeDependencies(config, role);
      if (dependencies !== "absent")
        return result(config, "incomplete", "dependencies", "dependency-install-unknown");
    }

    const outcome = await adapter.installDependencies(config, role);
    const worktree = await adapter.observeWorktree(config, role, true);
    demand(matchesObservation(config, role, worktree), `worktree-state-drift:${role}`);
    if (outcome !== "succeeded")
      return result(
        config,
        "incomplete",
        "dependencies",
        outcome === "failed" ? "dependency-install-failed" : "dependency-install-unknown",
      );
    const dependencies = await adapter.observeDependencies(config, role);
    demand(dependencies === "present", `dependency-state-unconfirmed:${role}`);
    await record(config.stateDirectory, `dependency-${role}`, dependencyRecord(config, role));
  }

  return result(config, "ready", "complete");
}
