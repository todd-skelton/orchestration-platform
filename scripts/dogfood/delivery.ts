import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const SHA = /^[a-f0-9]{40}$/;
const ABSENT_RECORD = Symbol("absent-record");

export interface DeliveryConfig {
  controller: string;
  run: string;
  issue: string;
  repository: string;
  controllerRoot: string;
  controllerRevision: string;
  worktree: string;
  reviewWorktree: string;
  stateDirectory: string;
  candidateHead: string;
  retries: number;
  refresh?: PublicationRefresh;
  requiredChecks: string[];
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

export interface PublicationRefresh {
  number: number;
  url: string;
  head: string;
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
  controller: string;
  run: string;
  issue: string;
  repository: string;
  controllerRevision: string;
  worktree: string;
  reviewWorktree: string;
  stateDirectory: string;
  requiredChecks: string[];
}

export interface PublicationEvidence {
  number: number;
  url: string;
  head: string;
  repository: string;
  sourceBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  planDigest: string;
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

export type DeliveryResult =
  | {
      status: "observing-hosted-checks";
      run: string;
      issue: string;
      head: string;
      reviewId: string;
      publication: { number: number; url: string };
      checks: CheckEvidence[];
      retries: number;
    }
  | {
      status: "complete";
      run: string;
      issue: string;
      head: string;
      reviewId: string;
      publication: { number: number; url: string };
      checks: CheckEvidence[];
      mergeCommit: string;
      cleanup: { status: "confirmed"; branch: string };
      retries: number;
    };

export type Observation<T> =
  { state: "confirmed"; value: T } | { state: "needs-mutation" } | { state: "unknown" };

export type PublicationObservation =
  | { state: "confirmed"; value: PublicationEvidence }
  | { state: "needs-mutation"; target: string }
  | { state: "unknown" };

export interface DeliveryPolicyAdapter {
  plan(config: DeliveryConfig): Promise<DeliveryPlan>;
}

export interface DeliveryAdapter {
  /** Pure provider identity formatting; this method must not perform I/O. */
  publicationUrl(config: DeliveryConfig, number: number): string;
  source(config: DeliveryConfig): Promise<SourceEvidence>;
  verifyWorkspace(config: DeliveryConfig, head: string): Promise<boolean>;
  runGate(
    config: DeliveryConfig,
    name: string,
    head: string,
  ): Promise<"passed" | "failed" | { status: "passed" } | { status: "failed"; output: string }>;
  correctGate?(
    config: DeliveryConfig,
    name: string,
    output: string,
  ): Promise<{ head: string; retries?: number }>;
  observeDraft(config: DeliveryConfig, draft: DraftPlan): Promise<Observation<{ issue: number }>>;
  applyDraft(config: DeliveryConfig, draft: DraftPlan): Promise<void>;
  observePublication(
    config: DeliveryConfig,
    plan: PublicationPlan,
    planDigest: string,
    target?: string,
  ): Promise<PublicationObservation>;
  publish(config: DeliveryConfig, plan: PublicationPlan, target: string): Promise<void>;
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
  readonly diagnostics: string | undefined;

  constructor(reason: string, diagnostics?: string) {
    super(reason);
    this.reason = reason;
    this.diagnostics = diagnostics;
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

async function optionalRecord(directory: string, name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT_RECORD;
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
    demand(
      existing !== ABSENT_RECORD && JSON.stringify(existing) === JSON.stringify(value),
      `conflicting-record:${name}`,
    );
  }
}

const gateOutput = (value: string) => value.trim().slice(0, 4_000);

function validateConfig(config: DeliveryConfig) {
  const hasRefresh =
    typeof config === "object" && config !== null && Object.hasOwn(config, "refresh");
  demand(
    exactKeys(config, [
      "controller",
      "run",
      "issue",
      "repository",
      "controllerRoot",
      "controllerRevision",
      "worktree",
      "reviewWorktree",
      "stateDirectory",
      "candidateHead",
      "retries",
      ...(hasRefresh ? ["refresh"] : []),
      "requiredChecks",
      "policy",
    ]),
    "malformed-delivery-config",
  );
  demand(/^[A-Za-z0-9._:-]{1,128}$/.test(config.controller), "invalid-controller");
  demand(typeof config.run === "string" && /^[\w.-]{1,80}$/.test(config.run), "invalid-run");
  demand(
    typeof config.issue === "string" && /^[\w:/.#-]{1,500}$/.test(config.issue),
    "invalid-issue",
  );
  demand(
    typeof config.repository === "string" && /^[^/\s]+\/[^/\s]+$/.test(config.repository),
    "invalid-repository",
  );
  for (const name of ["controllerRoot", "worktree", "reviewWorktree", "stateDirectory"] as const)
    demand(typeof config[name] === "string" && isAbsolute(config[name]), `invalid-${name}`);
  demand(
    typeof config.candidateHead === "string" && SHA.test(config.candidateHead),
    "invalid-candidate-head",
  );
  demand(Number.isSafeInteger(config.retries) && config.retries >= 0, "invalid-retries");
  demand(
    typeof config.controllerRevision === "string" && SHA.test(config.controllerRevision),
    "invalid-controller-revision",
  );
  if (hasRefresh)
    demand(
      exactKeys(config.refresh, ["number", "url", "head"]) &&
        Number.isSafeInteger(config.refresh.number) &&
        config.refresh.number > 0 &&
        typeof config.refresh.url === "string" &&
        config.refresh.url.startsWith("https://") &&
        typeof config.refresh.head === "string" &&
        SHA.test(config.refresh.head) &&
        config.refresh.head !== config.candidateHead,
      "malformed-publication-refresh",
    );
  demand(
    Array.isArray(config.requiredChecks) &&
      config.requiredChecks.length >= 3 &&
      config.requiredChecks.every(
        (name) => typeof name === "string" && /^[^\r\n]{1,200}$/.test(name),
      ) &&
      new Set(config.requiredChecks).size === config.requiredChecks.length,
    "invalid-required-checks",
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
  validate: (value: unknown) => void,
) {
  const receipt = await optionalRecord(directory, name);
  if (receipt !== ABSENT_RECORD) {
    validate(receipt);
    return receipt;
  }
  let observation = await observe();
  if (observation.state === "confirmed") {
    const value = { head, ...project(observation.value) };
    validate(value);
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
  validate(value);
  await record(directory, name, value);
  return value;
}

async function confirmPublication(
  config: DeliveryConfig,
  adapter: DeliveryAdapter,
  plan: DeliveryPlan,
  planDigest: string,
  directory: string,
) {
  // The adapter owns the opaque target; the engine durably binds it before any effect.
  const intent = await optionalRecord(directory, "publication-intent");
  const operation = digest({
    name: "publication",
    head: config.candidateHead,
    planDigest,
    ...(config.refresh ? { refresh: config.refresh } : {}),
  });
  let target: string | undefined;
  if (intent !== ABSENT_RECORD) {
    demand(
      exactKeys(intent, ["head", "operation", "target"]) &&
        intent.head === config.candidateHead &&
        intent.operation === operation &&
        typeof intent.target === "string" &&
        intent.target.length > 0 &&
        intent.target.length <= 1000,
      "malformed-publication-intent",
    );
    target = intent.target;
  }
  let observation = await adapter.observePublication(config, plan.publication, planDigest, target);
  if (observation.state !== "confirmed") {
    demand(observation.state === "needs-mutation", "publication-state-unknown");
    demand(
      typeof observation.target === "string" &&
        observation.target.length > 0 &&
        observation.target.length <= 1000 &&
        (target === undefined || target === observation.target),
      "publication-target-drift",
    );
    target = observation.target;
    await record(directory, "publication-intent", {
      head: config.candidateHead,
      operation,
      target,
    });
    try {
      await adapter.publish(config, plan.publication, target);
    } catch {}
    observation = await adapter.observePublication(config, plan.publication, planDigest, target);
    demand(observation.state !== "unknown", "publication-outcome-unknown");
    demand(observation.state === "confirmed", "publication-unconfirmed-reconcile-before-retry");
  }
  validatePublicationRecord(config, plan, planDigest, observation.value, adapter);
  await record(directory, "publication", observation.value);
  return observation.value;
}

function validateSourceRecord(
  config: DeliveryConfig,
  source: unknown,
): asserts source is SourceEvidence {
  demand(
    exactKeys(source, [
      "head",
      "reviewId",
      "controller",
      "run",
      "issue",
      "repository",
      "controllerRevision",
      "worktree",
      "reviewWorktree",
      "stateDirectory",
      "requiredChecks",
    ]) &&
      source.head === config.candidateHead &&
      typeof source.reviewId === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(source.reviewId) &&
      typeof source.controller === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(source.controller) &&
      source.run === config.run &&
      source.issue === config.issue &&
      source.repository === config.repository &&
      source.controllerRevision === config.controllerRevision &&
      source.worktree === config.worktree &&
      source.reviewWorktree === config.reviewWorktree &&
      source.stateDirectory === config.stateDirectory &&
      exactUniqueStringSet(source.requiredChecks, config.requiredChecks),
    "delivery-source-head-drift",
  );
  demand(source.controller === config.controller, "unauthorized-delivery");
}

function validatePublicationShape(
  config: DeliveryConfig,
  publication: unknown,
  adapter: DeliveryAdapter,
): asserts publication is PublicationEvidence {
  demand(
    exactKeys(publication, [
      "head",
      "number",
      "url",
      "repository",
      "sourceBranch",
      "baseBranch",
      "title",
      "body",
      "planDigest",
    ]) &&
      publication.head === config.candidateHead &&
      Number.isSafeInteger(publication.number) &&
      (publication.number as number) > 0 &&
      typeof publication.url === "string" &&
      publication.url.startsWith("https://") &&
      publication.url === adapter.publicationUrl(config, publication.number as number) &&
      publication.repository === config.repository &&
      typeof publication.sourceBranch === "string" &&
      typeof publication.baseBranch === "string" &&
      typeof publication.title === "string" &&
      typeof publication.body === "string" &&
      typeof publication.planDigest === "string" &&
      /^[a-f0-9]{64}$/.test(publication.planDigest),
    "malformed-publication-receipt",
  );
}

function validatePublicationRecord(
  config: DeliveryConfig,
  plan: DeliveryPlan,
  planDigest: string,
  publication: unknown,
  adapter: DeliveryAdapter,
): asserts publication is PublicationEvidence {
  validatePublicationShape(config, publication, adapter);
  demand(
    publication.sourceBranch === plan.publication.sourceBranch &&
      publication.baseBranch === plan.publication.baseBranch &&
      publication.title === plan.publication.title &&
      publication.body === plan.publication.body &&
      publication.planDigest === planDigest,
    "malformed-publication-receipt",
  );
}

function validatePlanAuthorization(
  config: DeliveryConfig,
  authorization: unknown,
): asserts authorization is {
  head: string;
  digest: string;
  policyDigest: string;
  controller: string;
} {
  demand(
    exactKeys(authorization, ["head", "digest", "policyDigest", "controller"]) &&
      authorization.head === config.candidateHead &&
      typeof authorization.digest === "string" &&
      /^[a-f0-9]{64}$/.test(authorization.digest) &&
      authorization.policyDigest === digest(config.policy) &&
      authorization.controller === config.controller,
    "malformed-delivery-plan-authorization",
  );
}

function validateMergeRecord(
  config: DeliveryConfig,
  merge: unknown,
): asserts merge is MergeEvidence {
  demand(
    exactKeys(merge, ["head", "number", "mergeCommit"]) &&
      merge.head === config.candidateHead &&
      Number.isSafeInteger(merge.number) &&
      (merge.number as number) > 0 &&
      typeof merge.mergeCommit === "string" &&
      SHA.test(merge.mergeCommit),
    "malformed-merge-receipt",
  );
}

function validateCleanupRecord(
  config: DeliveryConfig,
  plan: CleanupPlan,
  cleanup: unknown,
): asserts cleanup is { head: string; worktrees: string[]; branch: string } {
  demand(
    exactKeys(cleanup, ["head", "worktrees", "branch"]) &&
      cleanup.head === config.candidateHead &&
      cleanup.branch === plan.branch &&
      exactUniqueStringSet(cleanup.worktrees, plan.worktrees),
    "malformed-cleanup-receipt",
  );
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
): Promise<DeliveryResult> {
  validateConfig(config);
  if (config.refresh)
    demand(
      config.refresh.url === adapter.publicationUrl(config, config.refresh.number),
      "malformed-publication-refresh",
    );
  const directory = await realpath(config.stateDirectory);
  let fingerprint = digest(config);
  const pinned = await optionalRecord(directory, "delivery-config");
  const needsConfigRecord = pinned === ABSENT_RECORD;
  if (pinned !== ABSENT_RECORD)
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
  }

  const completed = await optionalRecord(directory, "cleanup");
  const savedSource = await optionalRecord(directory, "delivery-source");
  const savedPublication = await optionalRecord(directory, "publication");
  const savedChecks = await optionalRecord(directory, "hosted-checks");
  const savedMerge = await optionalRecord(directory, "merge");
  const savedPlan = await optionalRecord(directory, "delivery-plan");
  const savedPlanAuthorization = await optionalRecord(directory, "delivery-plan-authorization");
  if (savedSource !== ABSENT_RECORD) validateSourceRecord(config, savedSource);
  if (savedPublication !== ABSENT_RECORD)
    validatePublicationShape(config, savedPublication, adapter);
  let checks: CheckEvidence[] | undefined;
  if (savedChecks !== ABSENT_RECORD) {
    demand(exactKeys(savedChecks, ["head", "checks"]), "malformed-hosted-checks-record");
    checks = validateChecks(
      config,
      savedChecks.head as string,
      savedChecks.checks as CheckEvidence[],
    );
  }
  if (savedMerge !== ABSENT_RECORD) validateMergeRecord(config, savedMerge);
  if (savedPlan !== ABSENT_RECORD) {
    demand(
      exactKeys(savedPlan, ["head", "digest", "plan"]) &&
        savedPlan.head === config.candidateHead &&
        savedPlan.digest === digest(savedPlan.plan),
      "malformed-delivery-plan-record",
    );
    validatePlan(config, savedPlan.plan as DeliveryPlan);
  }
  if (savedPlanAuthorization !== ABSENT_RECORD) {
    validatePlanAuthorization(config, savedPlanAuthorization);
    demand(savedPlan !== ABSENT_RECORD, "orphaned-delivery-plan-authorization");
    demand(savedPlanAuthorization.digest === savedPlan.digest, "unauthorized-delivery-plan");
  }

  const receiptValidators = (plan: DeliveryPlan) => [
    ...[...plan.gates.beforeMirror, ...plan.gates.afterMirror].map((name, index) => ({
      file: `gate-${index + 1}`,
      validate(value: unknown) {
        demand(
          exactKeys(value, ["head", "name"]) &&
            value.head === config.candidateHead &&
            value.name === name,
          `malformed-record:gate-${index + 1}`,
        );
      },
    })),
    ...plan.drafts.map((draft) => ({
      file: `draft-${draft.key}`,
      validate(value: unknown) {
        demand(
          exactKeys(value, ["head", "issue"]) &&
            value.head === config.candidateHead &&
            value.issue === draft.issue,
          `malformed-record:draft-${draft.key}`,
        );
      },
    })),
  ];

  if (completed !== ABSENT_RECORD) {
    demand(
      pinned !== ABSENT_RECORD &&
        savedPlan !== ABSENT_RECORD &&
        savedPlanAuthorization !== ABSENT_RECORD &&
        savedPlanAuthorization.digest === savedPlan.digest,
      "malformed-completed-delivery",
    );
    const completedPlan = savedPlan.plan as DeliveryPlan;
    const completedPlanDigest = savedPlan.digest as string;
    validateSourceRecord(config, savedSource);
    validatePublicationRecord(
      config,
      completedPlan,
      completedPlanDigest,
      savedPublication,
      adapter,
    );
    validateMergeRecord(config, savedMerge);
    const requiredReceipts = await Promise.all(
      receiptValidators(completedPlan).map(async ({ file, validate }) => {
        const value = await optionalRecord(directory, file);
        demand(value !== ABSENT_RECORD, "incomplete-completed-delivery");
        validate(value);
        return value;
      }),
    );
    demand(
      requiredReceipts.length === 4 + completedPlan.drafts.length &&
        savedMerge.number === savedPublication.number &&
        exactKeys(completed, ["head", "worktrees", "branch"]) &&
        completed.head === config.candidateHead &&
        exactUniqueStringSet(completed.worktrees, completedPlan.cleanup.worktrees) &&
        completed.branch === completedPlan.cleanup.branch &&
        checks !== undefined &&
        checks.every((check) => check.bucket === "pass"),
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
      retries: config.retries,
    };
  }

  if (savedMerge !== ABSENT_RECORD)
    demand(
      savedSource !== ABSENT_RECORD &&
        savedPublication !== ABSENT_RECORD &&
        savedChecks !== ABSENT_RECORD &&
        savedPlan !== ABSENT_RECORD &&
        savedPlanAuthorization !== ABSENT_RECORD &&
        !needsConfigRecord,
      "incomplete-merge-prerequisites",
    );
  if (savedChecks !== ABSENT_RECORD)
    demand(savedPublication !== ABSENT_RECORD, "incomplete-check-prerequisites");

  let source = savedSource;
  if (source === ABSENT_RECORD) {
    source = await adapter.source(config);
    validateSourceRecord(config, source);
  }
  validateSourceRecord(config, source);

  let plan: DeliveryPlan;
  if (savedPlan === ABSENT_RECORD) {
    plan = await policy.plan(config);
    validatePlan(config, plan);
  } else if (savedPlanAuthorization === ABSENT_RECORD) {
    const authorizedPlan = await policy.plan(config);
    validatePlan(config, authorizedPlan);
    demand(digest(authorizedPlan) === savedPlan.digest, "unauthorized-delivery-plan");
    plan = savedPlan.plan as DeliveryPlan;
  } else {
    plan = savedPlan.plan as DeliveryPlan;
  }
  const planDigest = digest(plan);
  if (!needsConfigRecord) {
    await record(directory, "delivery-plan", {
      head: config.candidateHead,
      digest: planDigest,
      plan,
    });
    await record(directory, "delivery-plan-authorization", {
      head: config.candidateHead,
      digest: planDigest,
      policyDigest: digest(config.policy),
      controller: config.controller,
    });
  }

  if (savedPublication !== ABSENT_RECORD)
    validatePublicationRecord(config, plan, planDigest, savedPublication, adapter);
  if (savedMerge !== ABSENT_RECORD) {
    demand(
      savedPublication !== ABSENT_RECORD &&
        savedChecks !== ABSENT_RECORD &&
        savedMerge.number === savedPublication.number &&
        checks?.every((check) => check.bucket === "pass"),
      "malformed-merge-receipt",
    );
  }

  const plannedReceipts = receiptValidators(plan);
  await Promise.all(
    plannedReceipts.map(async ({ file, validate }) => {
      const value = await optionalRecord(directory, file);
      if (value !== ABSENT_RECORD) validate(value);
    }),
  );

  if (savedPublication !== ABSENT_RECORD) {
    for (const { file, validate } of plannedReceipts) {
      const value = await optionalRecord(directory, file);
      demand(
        value !== ABSENT_RECORD,
        savedMerge === ABSENT_RECORD
          ? "incomplete-publication-prerequisites"
          : "incomplete-merge-prerequisites",
      );
      validate(value);
    }
  }

  if (savedMerge === ABSENT_RECORD) {
    demand(
      await adapter.verifyWorkspace(config, config.candidateHead),
      "candidate-workspace-drift",
    );
    const runGates = async (gates: string[], offset: number, transient: boolean) => {
      for (let run = 0; run < (transient ? 2 : 1); run += 1) {
        const passedReceipts: { name: string; gate: string }[] = [];
        let corrected = false;
        for (const [index, gate] of gates.entries()) {
          const name = `gate-${offset + index + 1}`;
          const receipt = await optionalRecord(directory, name);
          if (receipt !== ABSENT_RECORD) {
            demand(
              exactKeys(receipt, ["head", "name"]) &&
                receipt.head === config.candidateHead &&
                receipt.name === gate,
              `malformed-record:${name}`,
            );
            continue;
          }
          demand(
            await adapter.verifyWorkspace(config, config.candidateHead),
            "candidate-workspace-drift",
          );
          const observed = await adapter.runGate(config, gate, config.candidateHead);
          const passed =
            observed === "passed" || (typeof observed === "object" && observed.status === "passed");
          if (passed) {
            passedReceipts.push({ name, gate });
            continue;
          }
          const output =
            typeof observed === "object" &&
            observed.status === "failed" &&
            typeof observed.output === "string"
              ? gateOutput(observed.output)
              : "gate exited without output";
          if (!transient || !["typecheck", "format:check"].includes(gate))
            throw new DeliveryBlocked(`gate-failed:${gate}`, output);
          if (run === 1) throw new DeliveryBlocked(`gate-retry-exhausted:${gate}`, output);
          demand(adapter.correctGate, "gate-correction-unavailable");
          const correction = await adapter.correctGate(config, gate, output);
          demand(
            SHA.test(correction.head) && correction.head !== config.candidateHead,
            "gate-correction-failed",
          );
          config = {
            ...config,
            candidateHead: correction.head,
            retries: correction.retries ?? config.retries + 1,
          };
          source = { ...(source as SourceEvidence), head: correction.head };
          fingerprint = digest(config);
          corrected = true;
          break;
        }
        if (corrected) continue;
        for (const passed of passedReceipts)
          await record(directory, passed.name, {
            head: config.candidateHead,
            name: passed.gate,
          });
        return;
      }
    };
    await runGates(plan.gates.beforeMirror, 0, true);
    if (needsConfigRecord) {
      await record(directory, "delivery-source", source);
      await record(directory, "delivery-config", { fingerprint });
      await record(directory, "delivery-plan", {
        head: config.candidateHead,
        digest: planDigest,
        plan,
      });
      await record(directory, "delivery-plan-authorization", {
        head: config.candidateHead,
        digest: planDigest,
        policyDigest: digest(config.policy),
        controller: config.controller,
      });
    }

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
        (value) =>
          demand(
            exactKeys(value, ["head", "issue"]) &&
              value.head === config.candidateHead &&
              value.issue === draft.issue,
            `malformed-record:draft-${draft.key}`,
          ),
      );
      demand(
        exactKeys(receipt, ["head", "issue"]) &&
          receipt.head === config.candidateHead &&
          receipt.issue === draft.issue,
        `malformed-record:draft-${draft.key}`,
      );
    }
    await runGates(plan.gates.afterMirror, plan.gates.beforeMirror.length, false);
  }

  const publication =
    savedPublication !== ABSENT_RECORD
      ? savedPublication
      : await confirmPublication(config, adapter, plan, planDigest, directory);
  validatePublicationRecord(config, plan, planDigest, publication, adapter);

  let merge = savedMerge;
  if (merge === ABSENT_RECORD && checks?.every((check) => check.bucket === "pass")) {
    // A successful remote merge may have lost both its response and local receipt.
    // Reconcile that outcome before the OPEN-only checks path, using saved proof.
    const observed = await adapter.observeMerge(config, publication);
    demand(observed.state !== "unknown", "merge-state-unknown");
    if (observed.state === "confirmed") {
      validateMergeRecord(config, observed.value);
      demand(observed.value.number === publication.number, "malformed-merge-receipt");
      await record(directory, "merge", observed.value);
      merge = observed.value;
    }
  }
  if (merge === ABSENT_RECORD) {
    demand(
      await adapter.verifyWorkspace(config, config.candidateHead),
      "candidate-workspace-drift",
    );
    const observed = await adapter.checks(config, publication);
    if (observed.checks.length === 0) {
      demand(observed.head === config.candidateHead, "hosted-head-drift");
      checks = [];
    } else checks = validateChecks(config, observed.head, observed.checks);
    if (checks.length === 0 || checks.some((check) => check.bucket === "pending")) {
      return {
        status: "observing-hosted-checks",
        run: config.run,
        issue: config.issue,
        head: config.candidateHead,
        reviewId: source.reviewId,
        publication: { number: publication.number, url: publication.url },
        checks,
        retries: config.retries,
      };
    }
    await record(directory, "hosted-checks", { head: config.candidateHead, checks });
    const reconciledMerge = await confirmMutation(
      directory,
      "merge",
      config.candidateHead,
      () => adapter.observeMerge(config, publication),
      () => adapter.merge(config, publication, plan.mergePolicy),
      (value) => value,
      (value) => {
        validateMergeRecord(config, value);
        demand(value.number === publication.number, "malformed-merge-receipt");
      },
    );
    validateMergeRecord(config, reconciledMerge);
    merge = reconciledMerge;
  }
  validateMergeRecord(config, merge);
  demand(
    merge.number === publication.number &&
      checks !== undefined &&
      checks.every((check) => check.bucket === "pass"),
    "malformed-merge-receipt",
  );
  const confirmedMerge = merge;

  const cleanup = await confirmMutation(
    directory,
    "cleanup",
    config.candidateHead,
    () => adapter.observeCleanup(config, plan.cleanup, confirmedMerge),
    () => adapter.cleanup(config, plan.cleanup, confirmedMerge),
    (value) => value,
    (value) => validateCleanupRecord(config, plan.cleanup, value),
  );
  validateCleanupRecord(config, plan.cleanup, cleanup);
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
    retries: config.retries,
  };
}
