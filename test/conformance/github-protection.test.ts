import { describe, expect, test } from "vitest";
import * as github from "../../packages/conformance/src/github-actions/index.js";

const branchProtection = Object.freeze({
  allow_deletions: Object.freeze({ enabled: false }),
  allow_force_pushes: Object.freeze({ enabled: false }),
  enforce_admins: Object.freeze({ enabled: true }),
  required_pull_request_reviews: Object.freeze({ bypass_pull_request_allowances: null }),
});

function ruleset(
  rules: readonly string[],
  options: Readonly<{
    bypass?: readonly unknown[];
    enforcement?: string;
    exclude?: readonly string[];
    include?: readonly string[];
  }> = {},
) {
  return Object.freeze({
    bypass_actors: Object.freeze([...(options.bypass ?? [])]),
    conditions: Object.freeze({
      ref_name: Object.freeze({
        exclude: Object.freeze([...(options.exclude ?? [])]),
        include: Object.freeze([...(options.include ?? ["~DEFAULT_BRANCH"])]),
      }),
    }),
    enforcement: options.enforcement ?? "active",
    rules: Object.freeze(rules.map((type) => Object.freeze({ type }))),
    target: "branch",
  });
}

function project(overrides: Readonly<Record<string, unknown>> = {}) {
  return github.projectGithubProtectionSnapshot({
    branchProtection,
    branchProtectionStatus: "FOUND",
    rulesetPages: [[]],
    rulesetPaginationTerminal: true,
    targetRef: "refs/heads/main",
    ...overrides,
  });
}

describe("GitHub protection projection", () => {
  test("accepts the exact zero-bypass branch-protection layer", () => {
    const projected = project();
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.value).toEqual({
      bypassActorCount: "0",
      deletionBlocked: true,
      enforcement: "ACTIVE",
      nonFastForwardBlocked: true,
      pullRequestRequired: true,
      schemaVersion: "github-conformance-protection-snapshot/v1",
      targetRef: "refs/heads/main",
    });
    expect(projected.digest).toBe(github.computeGithubConformanceProtectionDigest(projected.value));
  });

  test("reduces the effective union of active applicable rulesets", () => {
    const projected = project({
      branchProtection: null,
      branchProtectionStatus: "NOT_FOUND",
      rulesetPages: [
        [
          ruleset(["deletion"]),
          ruleset(["non_fast_forward"], { include: ["refs/heads/main"] }),
          ruleset(["pull_request"]),
          ruleset(["deletion"], { exclude: ["refs/heads/main"] }),
        ],
      ],
    });
    expect(projected.ok).toBe(true);
    const branchWithoutPullRequests = {
      allow_deletions: branchProtection.allow_deletions,
      allow_force_pushes: branchProtection.allow_force_pushes,
      enforce_admins: branchProtection.enforce_admins,
    };
    expect(
      project({
        branchProtection: branchWithoutPullRequests,
        rulesetPages: [[ruleset(["pull_request"])]],
      }).ok,
    ).toBe(true);
  });

  test("refuses missing protection, bypass, inactive, incomplete, and unknown layers", () => {
    const allowance = { apps: [], teams: [], users: [{ id: 1 }] };
    for (const mutation of [
      {
        branchProtection: null,
        branchProtectionStatus: "NOT_FOUND",
        rulesetPages: [[]],
      },
      { branchProtection: { ...branchProtection, enforce_admins: { enabled: false } } },
      {
        branchProtection: {
          ...branchProtection,
          required_pull_request_reviews: { bypass_pull_request_allowances: allowance },
        },
      },
      { rulesetPages: [[ruleset(["deletion"], { bypass: [{ actor_id: 1 }] })]] },
      {
        rulesetPages: [
          [
            {
              conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
              enforcement: "active",
              rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "pull_request" }],
              target: "branch",
            },
          ],
        ],
      },
      { rulesetPages: [[ruleset(["deletion"], { enforcement: "evaluate" })]] },
      { rulesetPages: [[ruleset(["deletion"], { include: ["refs/heads/ma*"] })]] },
      { rulesetPaginationTerminal: false },
      { rulesetPaginationTerminal: "yes" },
      { branchProtectionStatus: "UNREADABLE" },
      {
        branchProtection: null,
        branchProtectionStatus: "TIMEOUT",
        rulesetPages: [[ruleset(["deletion", "non_fast_forward", "pull_request"])]],
      },
      {
        branchProtection: null,
        branchProtectionStatus: undefined,
        rulesetPages: [[ruleset(["deletion", "non_fast_forward", "pull_request"])]],
      },
      { targetRef: "refs/heads/candidate" },
    ])
      expect(project(mutation).ok).toBe(false);
  });

  test("requires the complete restriction union", () => {
    for (const rules of [
      ["deletion", "non_fast_forward"],
      ["deletion", "pull_request"],
      ["non_fast_forward", "pull_request"],
    ])
      expect(
        project({
          branchProtection: null,
          branchProtectionStatus: "NOT_FOUND",
          rulesetPages: [[ruleset(rules)]],
        }).ok,
      ).toBe(false);
  });

  test("is total for hostile provider responses", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    for (const mutation of [
      { branchProtection: hostile },
      { rulesetPages: hostile },
      { rulesetPages: [[hostile]] },
    ])
      expect(() => project(mutation)).not.toThrow();
    expect(() => github.projectGithubProtectionSnapshot(null as never)).not.toThrow();
  });
});
