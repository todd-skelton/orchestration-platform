import { types as nodeTypes } from "node:util";
import type { ContractRecord } from "@orchestration-platform/contracts";
import {
  computeGithubConformanceProtectionDigest,
  parseGithubConformanceProtectionSnapshot,
} from "./github-actions.js";

export type GithubProtectionProjectionResult =
  | { readonly ok: true; readonly value: ContractRecord; readonly digest: string }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface GithubProtectionApiInput {
  readonly branchProtection: unknown;
  readonly branchProtectionStatus: "FOUND" | "NOT_FOUND" | "UNREADABLE";
  readonly rulesetPages: unknown;
  readonly rulesetPaginationTerminal: boolean;
  readonly targetRef: string;
}

function refusal(...issues: readonly string[]): GithubProtectionProjectionResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function dataRecord(input: unknown): Readonly<Record<string, unknown>> | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  return input as Readonly<Record<string, unknown>>;
}

function dataValue(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
    throw new TypeError(`provider:${key}:data-field-required`);
  return descriptor.value;
}

function optionalDataValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): { readonly present: boolean; readonly value?: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false };
  if (!("value" in descriptor) || descriptor.enumerable !== true)
    throw new TypeError(`provider:${key}:data-field-required`);
  return { present: true, value: descriptor.value };
}

function exactArray(input: unknown, maximum = 4096): readonly unknown[] | undefined {
  if (
    !Array.isArray(input) ||
    nodeTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > maximum
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const expected = new Set([
    ...Array.from({ length: input.length }, (_, index) => String(index)),
    "length",
  ]);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).some((key) => !expected.has(key)) ||
    keys.length !== expected.size
  )
    return undefined;
  const values: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    values.push(descriptor.value);
  }
  return values;
}

function enabled(record: Readonly<Record<string, unknown>>, key: string): boolean {
  const nested = dataRecord(dataValue(record, key));
  if (!nested) throw new TypeError(`provider:${key}:record-required`);
  const value = dataValue(nested, "enabled");
  if (typeof value !== "boolean") throw new TypeError(`provider:${key}.enabled:boolean-required`);
  return value;
}

function actorArrayLength(input: unknown): number {
  const value = exactArray(input, 4096);
  if (!value) throw new TypeError("provider:bypass-array-refused");
  return value.length;
}

function branchLayer(input: unknown): {
  readonly bypass: boolean;
  readonly deletionBlocked: boolean;
  readonly nonFastForwardBlocked: boolean;
  readonly pullRequestRequired: boolean;
} {
  const record = dataRecord(input);
  if (!record) throw new TypeError("provider:branch-protection-record-required");
  const enforceAdmins = enabled(record, "enforce_admins");
  let bypass = !enforceAdmins;
  const pullRequestField = optionalDataValue(record, "required_pull_request_reviews");
  let pullRequestRequired = false;
  if (pullRequestField.present && pullRequestField.value !== null) {
    const pullRequests = dataRecord(pullRequestField.value);
    if (!pullRequests) throw new TypeError("provider:pull-request-protection-record-required");
    pullRequestRequired = true;
    const allowanceField = optionalDataValue(pullRequests, "bypass_pull_request_allowances");
    if (allowanceField.present && allowanceField.value !== null) {
      const allowanceRecord = dataRecord(allowanceField.value);
      if (!allowanceRecord) throw new TypeError("provider:bypass-allowances-record-required");
      for (const key of ["apps", "teams", "users"])
        bypass ||= actorArrayLength(dataValue(allowanceRecord, key)) > 0;
    }
  }
  return {
    bypass,
    deletionBlocked: !enabled(record, "allow_deletions"),
    nonFastForwardBlocked: !enabled(record, "allow_force_pushes"),
    pullRequestRequired,
  };
}

function stringArray(input: unknown): readonly string[] {
  const values = exactArray(input, 4096);
  if (!values || values.some((value) => typeof value !== "string"))
    throw new TypeError("provider:string-array-refused");
  return values as readonly string[];
}

function refPatternDisposition(
  pattern: string,
  targetRef: string,
): "MATCH" | "NO_MATCH" | "UNKNOWN" {
  if (pattern === "~ALL" || pattern === "~DEFAULT_BRANCH" || pattern === targetRef) return "MATCH";
  if (!pattern.includes("*") && !pattern.includes("?") && !pattern.includes("[")) return "NO_MATCH";
  return "UNKNOWN";
}

function rulesetApplies(record: Readonly<Record<string, unknown>>, targetRef: string): boolean {
  if (dataValue(record, "target") !== "branch") return false;
  const conditions = dataRecord(dataValue(record, "conditions"));
  const refName = conditions && dataRecord(dataValue(conditions, "ref_name"));
  if (!refName) throw new TypeError("provider:ruleset-ref-condition-required");
  const includes = stringArray(dataValue(refName, "include"));
  const excludes = stringArray(dataValue(refName, "exclude"));
  const includeDispositions = includes.map((pattern) => refPatternDisposition(pattern, targetRef));
  const excludeDispositions = excludes.map((pattern) => refPatternDisposition(pattern, targetRef));
  if (includeDispositions.includes("UNKNOWN") || excludeDispositions.includes("UNKNOWN"))
    throw new TypeError("provider:ruleset-ref-pattern-unsupported");
  return includeDispositions.includes("MATCH") && !excludeDispositions.includes("MATCH");
}

function rulesetLayer(
  input: unknown,
  targetRef: string,
):
  | {
      readonly applies: false;
    }
  | {
      readonly applies: true;
      readonly bypass: boolean;
      readonly deletionBlocked: boolean;
      readonly nonFastForwardBlocked: boolean;
      readonly pullRequestRequired: boolean;
    } {
  const record = dataRecord(input);
  if (!record) throw new TypeError("provider:ruleset-record-required");
  if (!rulesetApplies(record, targetRef)) return { applies: false };
  if (dataValue(record, "enforcement") !== "active")
    throw new TypeError("provider:ruleset-enforcement-refused");
  const bypassActors = exactArray(dataValue(record, "bypass_actors"), 4096);
  if (!bypassActors) throw new TypeError("provider:ruleset-bypass-array-refused");
  const rules = exactArray(dataValue(record, "rules"), 4096);
  if (!rules) throw new TypeError("provider:ruleset-rules-array-refused");
  const types = new Set<string>();
  for (const inputRule of rules) {
    const rule = dataRecord(inputRule);
    if (!rule) throw new TypeError("provider:ruleset-rule-record-required");
    const type = dataValue(rule, "type");
    if (typeof type !== "string") throw new TypeError("provider:ruleset-rule-type-required");
    types.add(type);
  }
  return {
    applies: true,
    bypass: bypassActors.length > 0,
    deletionBlocked: types.has("deletion"),
    nonFastForwardBlocked: types.has("non_fast_forward"),
    pullRequestRequired: types.has("pull_request"),
  };
}

export function projectGithubProtectionSnapshot(
  input: GithubProtectionApiInput,
): GithubProtectionProjectionResult {
  try {
    if (input.targetRef !== "refs/heads/main") return refusal("targetRef:mismatch");
    if (!input.rulesetPaginationTerminal) return refusal("rulesets:pagination-incomplete");
    if (input.branchProtectionStatus === "UNREADABLE")
      return refusal("branchProtection:unreadable");
    const pages = exactArray(input.rulesetPages, 1024);
    if (!pages) return refusal("rulesets:pages-refused");
    const rulesets: unknown[] = [];
    for (const pageInput of pages) {
      const page = exactArray(pageInput, 100);
      if (!page) return refusal("rulesets:page-refused");
      rulesets.push(...page);
    }
    let deletionBlocked = false;
    let nonFastForwardBlocked = false;
    let pullRequestRequired = false;
    let bypass = false;
    let applicableLayers = 0;
    if (input.branchProtectionStatus === "FOUND") {
      const layer = branchLayer(input.branchProtection);
      deletionBlocked ||= layer.deletionBlocked;
      nonFastForwardBlocked ||= layer.nonFastForwardBlocked;
      pullRequestRequired ||= layer.pullRequestRequired;
      bypass ||= layer.bypass;
      applicableLayers += 1;
    } else if (input.branchProtection !== null)
      return refusal("branchProtection:not-found-payload");
    for (const ruleset of rulesets) {
      const layer = rulesetLayer(ruleset, input.targetRef);
      if (!layer.applies) continue;
      deletionBlocked ||= layer.deletionBlocked;
      nonFastForwardBlocked ||= layer.nonFastForwardBlocked;
      pullRequestRequired ||= layer.pullRequestRequired;
      bypass ||= layer.bypass;
      applicableLayers += 1;
    }
    if (applicableLayers === 0) return refusal("protection:no-applicable-layer");
    if (bypass) return refusal("protection:bypass-refused");
    const snapshot = Object.freeze({
      bypassActorCount: "0",
      deletionBlocked,
      enforcement: "ACTIVE",
      nonFastForwardBlocked,
      pullRequestRequired,
      schemaVersion: "github-conformance-protection-snapshot/v1",
      targetRef: input.targetRef,
    });
    const parsed = parseGithubConformanceProtectionSnapshot(snapshot);
    if (!parsed.ok) return refusal(...parsed.issues);
    return {
      ok: true,
      value: parsed.value,
      digest: computeGithubConformanceProtectionDigest(parsed.value),
    };
  } catch {
    return refusal("protection:unreadable-or-unsupported-provider-response");
  }
}
