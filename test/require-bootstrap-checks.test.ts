import { describe, expect, test, vi } from "vitest";
import { requireBootstrapChecks } from "../scripts/planning/require-bootstrap-checks.mjs";
import { requiredChecks } from "../adapters/self.mjs";

const endpoint = "repos/todd-skelton/orchestration-platform/rulesets/21694457";
const contexts = requiredChecks({ repository: "todd-skelton/orchestration-platform" }) as string[];
const bootstrapRule = {
  type: "required_status_checks",
  parameters: {
    required_status_checks: contexts.map((context) => ({ context })),
    strict_required_status_checks_policy: false,
  },
};

function fixture(extraRules: object[] = []) {
  const writable = {
    name: "protected-main-conformance",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      ...extraRules,
    ],
  };
  let observed = { id: 21694457, source: "todd-skelton/orchestration-platform", ...writable };
  const gh = vi.fn((args: string[], input?: string): string => {
    if (input !== undefined) {
      expect(args).toEqual(["api", "--method", "PUT", endpoint, "--input", "-"]);
      observed = { ...observed, ...JSON.parse(input) };
    } else {
      expect(args).toEqual(["api", endpoint]);
    }
    return JSON.stringify(observed);
  });
  return { gh, writable };
}

describe("ISS-175 bootstrap ruleset", () => {
  test("the required contexts are the adapter's REQUIRED_CHECKS", () => {
    expect(contexts).toEqual([
      "Node 24 / ubuntu-latest",
      "Node 24 / windows-latest",
      "Node 24 / macos-latest",
    ]);
  });

  test("check refuses an absent rule without writing", () => {
    const { gh } = fixture();
    expect(() => requireBootstrapChecks("check", gh)).toThrow(/must require exactly/);
    expect(gh.mock.calls).toEqual([[["api", endpoint]]]);
  });

  test("apply adds only the bootstrap rule and sends everything else back unchanged", () => {
    const foreignRule = { type: "required_signatures" };
    const { gh, writable } = fixture([foreignRule]);
    expect(requireBootstrapChecks("apply", gh)).toContain("added bootstrap contexts");
    expect(gh).toHaveBeenCalledTimes(2);
    expect(JSON.parse(gh.mock.calls[1]![1]!)).toEqual({
      ...writable,
      rules: [...writable.rules, bootstrapRule],
    });
    gh.mockClear();
    expect(requireBootstrapChecks("check", gh)).toContain("bootstrap contexts required");
    expect(requireBootstrapChecks("apply", gh)).toContain("unchanged");
    expect(gh.mock.calls).toEqual([[["api", endpoint]], [["api", endpoint]]]);
  });

  test("check accepts the same contexts in any order and apply is a no-op", () => {
    const rule = structuredClone(bootstrapRule);
    rule.parameters.required_status_checks.reverse();
    const { gh } = fixture([rule]);
    expect(requireBootstrapChecks("check", gh)).toContain("bootstrap contexts required");
    expect(requireBootstrapChecks("apply", gh)).toContain("unchanged");
    expect(gh.mock.calls).toEqual([[["api", endpoint]], [["api", endpoint]]]);
  });

  test.each([
    ["foreign context", [{ context: "foreign check" }], false],
    ["missing context", bootstrapRule.parameters.required_status_checks.slice(1), false],
    [
      "extra context",
      [...bootstrapRule.parameters.required_status_checks, { context: "extra" }],
      false,
    ],
    ["duplicate context", Array(3).fill({ context: "Node 24 / ubuntu-latest" }), false],
    ["strict policy", bootstrapRule.parameters.required_status_checks, true],
    ["missing strict policy", bootstrapRule.parameters.required_status_checks, undefined],
  ])("leaves a %s status-check rule untouched and fails check", (_name, checks, strict) => {
    const { gh } = fixture([
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: checks,
          strict_required_status_checks_policy: strict,
        },
      },
    ]);
    expect(requireBootstrapChecks("apply", gh)).toContain("unchanged");
    expect(() => requireBootstrapChecks("check", gh)).toThrow(/must require exactly/);
    expect(gh.mock.calls).toEqual([[["api", endpoint]], [["api", endpoint]]]);
  });

  test("propagates gh failures without reporting success", () => {
    const { gh } = fixture();
    gh.mockImplementationOnce(() => {
      throw new Error("read failed");
    });
    expect(() => requireBootstrapChecks("apply", gh)).toThrow("read failed");
    expect(gh).toHaveBeenCalledTimes(1);
    gh.mockClear();
    gh.mockImplementationOnce(() => JSON.stringify(fixture().writable));
    gh.mockImplementationOnce(() => {
      throw new Error("write failed");
    });
    expect(() => requireBootstrapChecks("apply", gh)).toThrow("write failed");
    expect(gh).toHaveBeenCalledTimes(2);
  });

  test("rejects unknown modes before calling gh", () => {
    const { gh } = fixture();
    expect(() => requireBootstrapChecks("other", gh)).toThrow(/usage:/);
    expect(() => requireBootstrapChecks(undefined, gh)).toThrow(/usage:/);
    expect(gh).not.toHaveBeenCalled();
  });
});
