import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const DELIVERY_AUTHORITY_SCHEMA = "dogfood-delivery-authority/v1" as const;
const ACTIONS = ["gates", "mirror", "publish", "merge", "cleanup"] as const;
const SHA = /^[a-f0-9]{40}$/;

export interface DeliveryAuthority {
  schemaVersion: typeof DELIVERY_AUTHORITY_SCHEMA;
  controller: string;
  run: string;
  repository: string;
  controllerRevision: string;
  head: string;
  actions: (typeof ACTIONS)[number][];
}

export interface DeliveryConfig {
  run: string;
  issue: string;
  repository: string;
  controllerRoot: string;
  controllerRevision: string;
  worktree: string;
  reviewWorktree: string;
  stateDirectory: string;
  candidateHead: string;
  requiredChecks: string[];
  authority: DeliveryAuthority;
  policy: unknown;
}

export interface DraftPlan {
  key: string;
  issue: number;
  title: string;
  body: string;
  attributes: Record<string, unknown>;
}

export interface PublicationPlan {
  sourceBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  draft: true;
}

export interface CleanupPlan {
  worktrees: string[];
  branch: string;
}

export interface DeliveryPlan {
  gates: { beforeMirror: string[]; afterMirror: string[] };
  drafts: DraftPlan[];
  publication: PublicationPlan;
  mergePolicy: unknown;
  cleanup: CleanupPlan;
}

export interface SourceEvidence {
  head: string;
  reviewId: string;
}

export interface PublicationEvidence {
  number: number;
  url: string;
  head: string;
}

export interface MergeEvidence {
  number: number;
  head: string;
  mergeCommit: string;
}

export interface CheckEvidence {
  name: string;
  bucket: "pass" | "pending" | "fail" | "cancel" | "skipping";
  link: string;
}

export type Observation<T> =
  { state: "confirmed"; value: T } | { state: "needs-mutation" } | { state: "unknown" };

export interface DeliveryPolicyAdapter {
  plan(config: DeliveryConfig): Promise<DeliveryPlan>;
}

export interface DeliveryAdapter {
  source(config: DeliveryConfig): Promise<SourceEvidence>;
  verifyWorkspace(config: DeliveryConfig, head: string): Promise<boolean>;
  runGate(config: DeliveryConfig, name: string, head: string): Promise<"passed" | "failed">;
  observeDraft(config: DeliveryConfig, draft: DraftPlan): Promise<Observation<{ issue: number }>>;
  applyDraft(config: DeliveryConfig, draft: DraftPlan): Promise<void>;
  observePublication(
    config: DeliveryConfig,
    plan: PublicationPlan,
  ): Promise<Observation<PublicationEvidence>>;
  publish(config: DeliveryConfig, plan: PublicationPlan): Promise<void>;
  checks(
    config: DeliveryConfig,
    publication: PublicationEvidence,
  ): Promise<{
    head: string;
    checks: CheckEvidence[];
  }>;
  observeMerge(
    config: DeliveryConfig,
    publication: PublicationEvidence,
  ): Promise<Observation<MergeEvidence>>;
  merge(config: DeliveryConfig, publication: PublicationEvidence, policy: unknown): Promise<void>;
  observeCleanup(
    config: DeliveryConfig,
    plan: CleanupPlan,
    merge: MergeEvidence,
  ): Promise<Observation<{ worktrees: string[]; branch: string }>>;
  cleanup(config: DeliveryConfig, plan: CleanupPlan, merge: MergeEvidence): Promise<void>;
}

export class DeliveryBlocked extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function demand(value: unknown, reason: string): asserts value {
  if (!value) throw new DeliveryBlocked(reason);
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

function scalarObject(value: unknown): value is Record<string, string | null> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string" || item === null)
  );
}

function exactUniqueStringSet(value: unknown, expected: string[]) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length &&
    value.every((item) => expected.includes(item)) &&
    expected.every((item) => value.includes(item))
  );
}

function outside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function optionalRecord(directory: string, name: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DeliveryBlocked(`malformed-record:${name}`);
  }
}

async function record(directory: string, name: string, value: unknown) {
  try {
    await writeFile(resolve(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      flush: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await optionalRecord(directory, name);
    demand(JSON.stringify(existing) === JSON.stringify(value), `conflicting-record:${name}`);
  }
}

function validateConfig(config: DeliveryConfig) {
  demand(
    exactKeys(config, [
      "run",
      "issue",
      "repository",
      "controllerRoot",
      "controllerRevision",
      "worktree",
      "reviewWorktree",
      "stateDirectory",
      "candidateHead",
      "requiredChecks",
      "authority",
      "policy",
    ]),
    "malformed-delivery-config",
  );
  demand(/^[\w.-]{1,80}$/.test(config.run), "invalid-run");
  demand(
    typeof config.issue === "string" && /^[\w:/.#-]{1,500}$/.test(config.issue),
    "invalid-issue",
  );
  demand(/^[^/\s]+\/[^/\s]+$/.test(config.repository), "invalid-repository");
  for (const name of ["controllerRoot", "worktree", "reviewWorktree", "stateDirectory"] as const)
    demand(typeof config[name] === "string" && isAbsolute(config[name]), `invalid-${name}`);
  demand(SHA.test(config.candidateHead), "invalid-candidate-head");
  demand(SHA.test(config.controllerRevision), "invalid-controller-revision");
  demand(
    Array.isArray(config.requiredChecks) &&
      config.requiredChecks.length >= 3 &&
      config.requiredChecks.every(
        (name) => typeof name === "string" && /^[^\r\n]{1,200}$/.test(name),
      ) &&
      new Set(config.requiredChecks).size === config.requiredChecks.length,
    "invalid-required-checks",
  );
  const authority = config.authority;
  demand(
    authority &&
      exactKeys(authority, [
        "schemaVersion",
        "controller",
        "run",
        "repository",
        "controllerRevision",
        "head",
        "actions",
      ]) &&
      authority.schemaVersion === DELIVERY_AUTHORITY_SCHEMA &&
      typeof authority.controller === "string" &&
      authority.controller.length > 0 &&
      authority.run === config.run &&
      authority.repository === config.repository &&
      authority.controllerRevision === config.controllerRevision &&
      authority.head === config.candidateHead &&
      Array.isArray(authority.actions) &&
      authority.actions.length === ACTIONS.length &&
      ACTIONS.every((action) => authority.actions.filter((item) => item === action).length === 1),
    "unauthorized-delivery",
  );
}

export async function assertControllerRequest(config: DeliveryConfig, requestPath: string) {
  validateConfig(config);
  demand(isAbsolute(requestPath), "request-path-not-absolute");
  const [request, directory] = await Promise.all([
    realpath(requestPath),
    realpath(config.stateDirectory),
  ]);
  demand(
    dirname(request) === directory && basename(request) === "delivery-request.json",
    "request-outside-controller-state",
  );
}

function validatePlan(config: DeliveryConfig, plan: DeliveryPlan) {
  demand(
    plan && exactKeys(plan, ["gates", "drafts", "publication", "mergePolicy", "cleanup"]),
    "malformed-policy-plan",
  );
  const gates = plan.gates;
  demand(
    gates &&
      exactKeys(gates, ["beforeMirror", "afterMirror"]) &&
      Array.isArray(gates.beforeMirror) &&
      gates.beforeMirror.length > 0 &&
      Array.isArray(gates.afterMirror) &&
      gates.afterMirror.length > 0,
    "malformed-gate-plan",
  );
  const gateNames = [...gates.beforeMirror, ...gates.afterMirror];
  demand(
    gateNames.length === 4 &&
      gateNames.every((gate) => typeof gate === "string" && /^[a-z0-9:-]{1,80}$/.test(gate)) &&
      new Set(gateNames).size === gateNames.length,
    "malformed-gate-plan",
  );
  demand(
    Array.isArray(plan.drafts) &&
      plan.drafts.length > 0 &&
      plan.drafts.every(
        (draft) =>
          exactKeys(draft, ["key", "issue", "title", "body", "attributes"]) &&
          /^[A-Z]+-[A-Z0-9-]+$/.test(draft.key) &&
          Number.isSafeInteger(draft.issue) &&
          draft.issue > 0 &&
          typeof draft.title === "string" &&
          draft.title.length > 0 &&
          typeof draft.body === "string" &&
          draft.body.length > 0 &&
          scalarObject(draft.attributes),
      ) &&
      new Set(plan.drafts.map((draft) => draft.issue)).size === plan.drafts.length,
    "malformed-draft-plan",
  );
  demand(
    plan.publication &&
      exactKeys(plan.publication, ["sourceBranch", "baseBranch", "title", "body", "draft"]) &&
      [plan.publication.sourceBranch, plan.publication.baseBranch].every(
        (branch) => typeof branch === "string" && /^[A-Za-z0-9._/-]+$/.test(branch),
      ) &&
      plan.publication.sourceBranch !== plan.publication.baseBranch &&
      typeof plan.publication.title === "string" &&
      plan.publication.title.length > 0 &&
      typeof plan.publication.body === "string" &&
      plan.publication.body.length > 0 &&
      plan.publication.draft === true,
    "malformed-publication-plan",
  );
  demand(plan.mergePolicy !== undefined, "malformed-merge-policy");
  demand(
    plan.cleanup &&
      exactKeys(plan.cleanup, ["worktrees", "branch"]) &&
      Array.isArray(plan.cleanup.worktrees) &&
      plan.cleanup.worktrees.length === 2 &&
      new Set(plan.cleanup.worktrees).size === 2 &&
      plan.cleanup.worktrees.every((path) => isAbsolute(path)) &&
      plan.cleanup.worktrees.includes(config.worktree) &&
      plan.cleanup.worktrees.includes(config.reviewWorktree) &&
      plan.cleanup.branch === plan.publication.sourceBranch,
    "malformed-cleanup-plan",
  );
}

async function confirmMutation<T>(
  directory: string,
  name: string,
  head: string,
  observe: () => Promise<Observation<T>>,
  mutate: () => Promise<void>,
  project: (value: T) => object,
) {
  const receipt = await optionalRecord(directory, name);
  if (receipt) return receipt;
  let observation = await observe();
  if (observation.state === "confirmed") {
    const value = { head, ...project(observation.value) };
    await record(directory, name, value);
    return value;
  }
  demand(observation.state === "needs-mutation", `${name}-state-unknown`);
  await record(directory, `${name}-intent`, { head, operation: digest({ name, head }) });
  try {
    await mutate();
  } catch {}
  observation = await observe();
  demand(observation.state !== "unknown", `${name}-outcome-unknown`);
  demand(observation.state === "confirmed", `${name}-unconfirmed-reconcile-before-retry`);
  const value = { head, ...project(observation.value) };
  await record(directory, name, value);
  return value;
}

function validateChecks(config: DeliveryConfig, head: string, checks: CheckEvidence[]) {
  demand(head === config.candidateHead, "hosted-head-drift");
  demand(Array.isArray(checks) && checks.length > 0, "empty-hosted-checks");
  const projected: CheckEvidence[] = [];
  for (const name of config.requiredChecks) {
    const matches = checks.filter((check) => check?.name === name);
    demand(matches.length === 1, `missing-or-duplicate-check:${name}`);
    const check = matches[0]!;
    demand(
      ["pass", "pending", "fail", "cancel", "skipping"].includes(check.bucket) &&
        typeof check.link === "string" &&
        check.link.startsWith("https://"),
      `malformed-check:${name}`,
    );
    demand(!["fail", "cancel", "skipping"].includes(check.bucket), `hosted-check-failed:${name}`);
    projected.push({ name, bucket: check.bucket, link: check.link });
  }
  return projected;
}

export async function deliveryStep(
  config: DeliveryConfig,
  adapter: DeliveryAdapter,
  policy: DeliveryPolicyAdapter,
) {
  validateConfig(config);
  const directory = await realpath(config.stateDirectory);
  const fingerprint = digest(config);
  const pinned = await optionalRecord(directory, "delivery-config");
  if (pinned)
    demand(
      exactKeys(pinned, ["fingerprint"]) && pinned.fingerprint === fingerprint,
      "conflicting-delivery-config",
    );
  else {
    const roots = await Promise.all(
      [config.controllerRoot, config.worktree, config.reviewWorktree].map((path) => realpath(path)),
    );
    demand(
      roots.every(
        (root, index) =>
          root ===
            resolve([config.controllerRoot, config.worktree, config.reviewWorktree][index]!) &&
          roots.every((other, otherIndex) => index === otherIndex || outside(root, other)),
      ),
      "delivery-worktree-overlap",
    );
    demand(
      roots.every((root) => outside(root, directory) && outside(directory, root)),
      "delivery-state-inside-checkout",
    );
    await record(directory, "delivery-config", { fingerprint });
  }

  const completed = await optionalRecord(directory, "cleanup");
  const savedSource = await optionalRecord(directory, "delivery-source");
  const savedPublication = await optionalRecord(directory, "publication");
  const savedChecks = await optionalRecord(directory, "hosted-checks");
  const savedMerge = await optionalRecord(directory, "merge");
  const savedPlan = await optionalRecord(directory, "delivery-plan");
  if (completed) {
    demand(
      exactKeys(savedPlan, ["head", "digest", "plan"]) &&
        savedPlan.head === config.candidateHead &&
        savedPlan.digest === digest(savedPlan.plan),
      "malformed-delivery-plan-record",
    );
    validatePlan(config, savedPlan.plan as DeliveryPlan);
    const completedPlan = savedPlan.plan as DeliveryPlan;
    const checks =
      exactKeys(savedChecks, ["head", "checks"]) && savedChecks.head === config.candidateHead
        ? validateChecks(config, savedChecks.head, savedChecks.checks as CheckEvidence[])
        : undefined;
    demand(
      exactKeys(savedSource, ["head", "reviewId"]) &&
        savedSource.head === config.candidateHead &&
        typeof savedSource.reviewId === "string" &&
        /^[A-Za-z0-9._:-]{1,128}$/.test(savedSource.reviewId) &&
        exactKeys(savedPublication, ["head", "number", "url"]) &&
        savedPublication.head === config.candidateHead &&
        Number.isSafeInteger(savedPublication.number) &&
        (savedPublication.number as number) > 0 &&
        typeof savedPublication.url === "string" &&
        savedPublication.url.startsWith("https://") &&
        exactKeys(savedMerge, ["head", "number", "mergeCommit"]) &&
        savedMerge.head === config.candidateHead &&
        savedMerge.number === savedPublication.number &&
        typeof savedMerge.mergeCommit === "string" &&
        SHA.test(savedMerge.mergeCommit) &&
        exactKeys(completed, ["head", "worktrees", "branch"]) &&
        completed.head === config.candidateHead &&
        exactUniqueStringSet(completed.worktrees, completedPlan.cleanup.worktrees) &&
        completed.branch === completedPlan.cleanup.branch &&
        checks?.every((check) => check.bucket === "pass"),
      "malformed-completed-delivery",
    );
    return {
      status: "complete",
      run: config.run,
      issue: config.issue,
      head: config.candidateHead,
      reviewId: savedSource.reviewId,
      publication: { number: savedPublication.number, url: savedPublication.url },
      checks,
      mergeCommit: savedMerge.mergeCommit,
      cleanup: { status: "confirmed", branch: completed.branch },
    };
  }

  if (savedPlan)
    demand(
      exactKeys(savedPlan, ["head", "digest", "plan"]) && savedPlan.head === config.candidateHead,
      "malformed-delivery-plan-record",
    );
  const plan = savedPlan ? savedPlan.plan : await policy.plan(config);
  validatePlan(config, plan);
  demand(!savedPlan || savedPlan.digest === digest(plan), "malformed-delivery-plan-record");
  await record(directory, "delivery-plan", {
    head: config.candidateHead,
    digest: digest(plan),
    plan,
  });

  let source = savedSource;
  if (!source) {
    source = await adapter.source(config);
    demand(
      source &&
        source.head === config.candidateHead &&
        typeof source.reviewId === "string" &&
        /^[A-Za-z0-9._:-]{1,128}$/.test(source.reviewId),
      "unreviewed-delivery-source",
    );
    await record(directory, "delivery-source", source);
  }
  demand(
    exactKeys(source, ["head", "reviewId"]) &&
      source.head === config.candidateHead &&
      typeof source.reviewId === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(source.reviewId),
    "delivery-source-head-drift",
  );

  if (!savedMerge) {
    demand(
      await adapter.verifyWorkspace(config, config.candidateHead),
      "candidate-workspace-drift",
    );
    const runGates = async (gates: string[], offset: number) => {
      for (const [index, gate] of gates.entries()) {
        const name = `gate-${offset + index + 1}`;
        const receipt = await optionalRecord(directory, name);
        if (receipt) {
          demand(
            exactKeys(receipt, ["head", "name"]) &&
              receipt.head === config.candidateHead &&
              receipt.name === gate,
            `malformed-record:${name}`,
          );
          continue;
        }
        await record(directory, `${name}-intent`, { head: config.candidateHead, name: gate });
        demand(
          await adapter.verifyWorkspace(config, config.candidateHead),
          "candidate-workspace-drift",
        );
        demand(
          (await adapter.runGate(config, gate, config.candidateHead)) === "passed",
          `gate-failed:${gate}`,
        );
        await record(directory, name, { head: config.candidateHead, name: gate });
      }
    };
    await runGates(plan.gates.beforeMirror, 0);

    for (const draft of plan.drafts) {
      demand(
        await adapter.verifyWorkspace(config, config.candidateHead),
        "candidate-workspace-drift",
      );
      const receipt = await confirmMutation(
        directory,
        `draft-${draft.key}`,
        config.candidateHead,
        () => adapter.observeDraft(config, draft),
        () => adapter.applyDraft(config, draft),
        (value) => value,
      );
      demand(
        exactKeys(receipt, ["head", "issue"]) &&
          receipt.head === config.candidateHead &&
          receipt.issue === draft.issue,
        `malformed-record:draft-${draft.key}`,
      );
    }
    await runGates(plan.gates.afterMirror, plan.gates.beforeMirror.length);
  }

  const publication = (savedPublication ??
    (await confirmMutation(
      directory,
      "publication",
      config.candidateHead,
      () => adapter.observePublication(config, plan.publication),
      () => adapter.publish(config, plan.publication),
      (value) => value,
    ))) as PublicationEvidence;
  demand(
    exactKeys(publication, ["head", "number", "url"]) &&
      publication.head === config.candidateHead &&
      Number.isSafeInteger(publication.number) &&
      publication.number > 0 &&
      typeof publication.url === "string" &&
      publication.url.startsWith("https://"),
    "malformed-publication-receipt",
  );

  let merge = savedMerge;
  if (savedChecks)
    demand(exactKeys(savedChecks, ["head", "checks"]), "malformed-hosted-checks-record");
  let checks = savedChecks
    ? validateChecks(config, savedChecks.head as string, savedChecks.checks as CheckEvidence[])
    : undefined;
  if (!merge) {
    demand(
      await adapter.verifyWorkspace(config, config.candidateHead),
      "candidate-workspace-drift",
    );
    const observed = await adapter.checks(config, publication);
    checks = validateChecks(config, observed.head, observed.checks);
    if (checks.some((check) => check.bucket === "pending")) {
      return {
        status: "observing-hosted-checks",
        run: config.run,
        issue: config.issue,
        head: config.candidateHead,
        reviewId: source.reviewId,
        publication: { number: publication.number, url: publication.url },
        checks,
      };
    }
    await record(directory, "hosted-checks", { head: config.candidateHead, checks });
    merge = await confirmMutation(
      directory,
      "merge",
      config.candidateHead,
      () => adapter.observeMerge(config, publication),
      () => adapter.merge(config, publication, plan.mergePolicy),
      (value) => value,
    );
  }
  demand(
    exactKeys(merge, ["head", "number", "mergeCommit"]) &&
      merge.head === config.candidateHead &&
      merge.number === publication.number &&
      typeof merge.mergeCommit === "string" &&
      SHA.test(merge.mergeCommit) &&
      checks?.every((check) => check.bucket === "pass"),
    "malformed-merge-receipt",
  );
  const confirmedMerge = merge as unknown as MergeEvidence;

  const cleanup = await confirmMutation(
    directory,
    "cleanup",
    config.candidateHead,
    () => adapter.observeCleanup(config, plan.cleanup, confirmedMerge),
    () => adapter.cleanup(config, plan.cleanup, confirmedMerge),
    (value) => value,
  );
  demand(
    exactKeys(cleanup, ["head", "worktrees", "branch"]) &&
      cleanup.head === config.candidateHead &&
      cleanup.branch === plan.cleanup.branch &&
      exactUniqueStringSet(cleanup.worktrees, plan.cleanup.worktrees),
    "malformed-cleanup-receipt",
  );
  return {
    status: "complete",
    run: config.run,
    issue: config.issue,
    head: config.candidateHead,
    reviewId: source.reviewId,
    publication: { number: publication.number, url: publication.url },
    checks,
    mergeCommit: confirmedMerge.mergeCommit,
    cleanup: { status: "confirmed", branch: cleanup.branch },
  };
}
