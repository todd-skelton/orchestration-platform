export type FaultClass = "attempt" | "replan" | "retry" | "wait" | "halt";

type StopRule =
  | {
      rule: "exact" | "prefix";
      faultClass: FaultClass;
      legacyParking: boolean;
      reasons: readonly string[];
    }
  | {
      rule: "family";
      faultClass: "halt";
      legacyParking: false;
      match: "prefix" | "suffix";
      reasons: readonly string[];
    };

// ISS-225: this table owns classification and the unchanged park decision.
// Legacy parking records backlog, not permission to retry or wait automatically.
// Exported for the inventory and halt-only family ratchets.
export const stopRules: readonly StopRule[] = [
  {
    rule: "exact",
    faultClass: "attempt",
    legacyParking: false,
    reasons: [
      "author-failed",
      "author-malformed",
      "operator-evidence-failed",
      "continuation-failed",
      "implementation-attempt-ceiling-exhausted",
      "rebase-conflict",
      "refresh-review-failed",
      "gate-correction-failed",
      "gate-correction-review-failed",
      "verification-only-candidate-failed",
      "conflict-resolution-failed",
      "conflict-resolution-exhausted",
      "conflict-resolution-scope-escape",
      "source-finding-location-outside-candidate",
    ],
  },
  {
    rule: "exact",
    faultClass: "replan",
    legacyParking: false,
    reasons: [
      "conflict-resolution-unsupported",
      "gate-correction-not-authorized",
      "continuation-repair-not-authorized",
      "terminal-attempt-admission-mismatch",
    ],
  },
  {
    rule: "exact",
    faultClass: "retry",
    legacyParking: false,
    reasons: [
      "issue-observation-unavailable",
      "current-main-unavailable",
      "current-main-moved",
      "verification-only-refresh-conflict",
      "verification-only-authority-unavailable",
      "verification-only-execution-unknown",
      "verification-only-focused-test-unavailable",
      "hosted-observation-unavailable",
      "hosted-check-never-executed",
      "provider-unavailable",
      "learning-note-state-unknown",
      "stopped-issue-state-unknown",
      "working-label-state-unknown",
      "publication-outcome-unknown",
      "merge-outcome-unknown",
      "publication-unconfirmed-reconcile-before-retry",
      "merge-unconfirmed-reconcile-before-retry",
      "terminal-attempt-admission-authority-unavailable",
      "integration-continuation-authority-unavailable",
    ],
  },
  {
    rule: "exact",
    faultClass: "wait",
    legacyParking: false,
    reasons: [
      "provider-model-refused",
      "executor-busy",
      "upgrade-requires-restart",
      "operator-evidence-required",
      "operator-evidence-authority",
      "native-launch-ceiling-exhausted",
      "accepted-replan-required",
      "integration-continuation-required",
      "prerequisite-held",
      "merge-queue-removed",
      // Recovery needs issue/admission inspection, not just another read.
      "completed-issue-state-unknown",
      "merge-queue-admission-unconfirmed",
    ],
  },
  {
    rule: "exact",
    faultClass: "retry",
    legacyParking: true,
    reasons: ["exit-receipt-timeout", "launcher-failed", "reviewer-malformed"],
  },
  {
    rule: "exact",
    faultClass: "wait",
    legacyParking: true,
    reasons: ["deploy-not-verified"],
  },
  {
    rule: "exact",
    faultClass: "halt",
    legacyParking: false,
    reasons: [
      "executor-install-failed",
      "invalid-verification-only-grant",
      "verification-only-mismatch",
      "verification-only-spent",
      "The JSON object is not a run, role, 40-hex head and PASS/FAIL verdict.",
      "The author object must have exactly run, role, head, verdict and summary (string).",
      "The reviewer object must have exactly run, role, head, verdict, findings (array) and g0 (string).",
      "accepted-replan-already-consumed",
      "accepted-replan-history-unavailable",
      "accepted-replan-path-widened",
      "ambiguous-local-cleanup-branch",
      "ambiguous-remote-cleanup-branch",
      "author-head-moved",
      "author-is-reviewer",
      "author-wrong-head",
      "candidate-as-pilot-selection",
      "candidate-head-moved",
      "changed-base",
      "chase-sets-publication-diff-unavailable",
      "ci-head-moved",
      "cleanup-dirty-worktree",
      "closed-finite-input-required",
      "closed-issue-without-delivery",
      // Ordinary flow retains the intent and refuses replay without a candidate.
      "commit-result-unknown-reconcile",
      "controller-executor-not-repository-root",
      "controller-executor-revision-moved",
      "controller-executor-unverified",
      "current-main-incompatible",
      "delivery-repository-not-root",
      "delivery-repository-unverified",
      "delivery-state-inside-checkout",
      "delivery-state-unknown",
      "delivery-worktree-overlap",
      "dependency-install-unknown",
      "dirty-author",
      "dirty-controller-executor",
      "dirty-pilot",
      "dirty-reviewer",
      "dirty-setup-repository",
      "empty-ci-checks",
      "empty-footprint",
      "empty-hosted-checks",
      "empty-prompt",
      "gate-stop-not-delivery",
      "gate-stop-repair-not-applicable",
      "gate-stop-review-unavailable",
      "hosted-failure-evidence-unavailable",
      "incompatible-git",
      "incomplete-check-prerequisites",
      "incomplete-completed-delivery",
      "incomplete-merge-prerequisites",
      "incomplete-publication-prerequisites",
      "incomplete-retained-post-merge",
      "inconsistent-source-review-verdict",
      "integration-continuation-already-consumed",
      "integration-continuation-history-unavailable",
      // The worker intent survives; no attempt identity exists to resume.
      "launch-identity-timeout-reconcile",
      "loop-roots-overlap",
      "merge-queue-admission-failed",
      "merge-state-unknown",
      "missing-candidate-commit",
      "missing-chase-sets-delivery-skill",
      "missing-queue-item",
      "orphaned-delivery-plan-authorization",
      "outside-footprint",
      "overlapping-setup-paths",
      "participant-history-gap",
      "participant-history-truncated",
      "participant-history-unobserved",
      "pilot-revision-moved",
      "prerequisite-executor-moved",
      // The declared prerequisite and retained admission do not agree.
      "prerequisite-not-admitted",
      // Retain the literal inventory stem; only live/unknown are thrown.
      "prerequisite-owner-",
      "prerequisite-owner-live",
      "prerequisite-owner-unknown",
      "publication-refresh-lease-unverified",
      "publication-refresh-not-forward",
      "publication-state-unknown",
      "published-candidate-conflict",
      "queue-state-inside-checkout",
      "queue-state-overlap",
      "repair-history-state-unknown",
      "repair-state-unknown",
      "repository-adapter-unavailable",
      "reused-participant-identity",
      "review-head-identity-unknown",
      "reviewer-modified-worktree",
      "reviewer-state-incomplete",
      "routing-marker-absent",
      "routing-marker-duplicate",
      "routing-marker-malformed",
      "routing-reviewer-not-independent",
      "routing-row-unconfigured",
      "routing-table-required",
      "selected-base-unavailable",
      "selected-ops-not-runnable",
      "self-planning-invalid",
      "self-publication-diff-unavailable",
      "setup-path-inside-existing-checkout",
      "setup-path-overlaps-existing-checkout",
      "setup-root-not-directory",
      "setup-state-unknown",
      "setup-state-unverified",
      "source-branch-is-base",
      "source-cannot-publish",
      "source-flow-state-unknown",
      "source-review-state-unknown",
      "source-review-summary-out-of-bounds",
      "state-inside-checkout",
      "target-milestone-unsupported-adapter",
      "unauthorized-delivery",
      "unauthorized-delivery-plan",
      "unresolved-setup-path",
      "unresolved-setup-path-case",
      "unreviewed-delivery-source",
      "unstable-delivery-repository",
      "unstable-executor",
      "unsupported-adapter-configuration",
      "unsupported-chase-sets-delivery-policy",
      "unsupported-self-merge-policy",
      "usage",
      "worktree-isolation",
      "worktree-must-be-repository-root",
    ],
  },
  {
    rule: "prefix",
    faultClass: "attempt",
    legacyParking: false,
    reasons: ["gate-retry-exhausted:", "gate-correction-exhausted:", "hosted-check-failed:"],
  },
  {
    rule: "prefix",
    faultClass: "retry",
    legacyParking: true,
    reasons: ["hosted-check-log-unavailable:"],
  },
  {
    rule: "prefix",
    faultClass: "wait",
    legacyParking: false,
    // ISS-157 requires a landed repair and explicit gateStopAuthorization.
    reasons: ["gate-host-failed:"],
  },
  {
    rule: "prefix",
    faultClass: "halt",
    legacyParking: false,
    reasons: [
      "ci-failed:",
      "dependency-state-drift:",
      "dependency-state-unconfirmed:",
      "gate-attribution-unknown:",
      "gate-base-failed:",
      "missing-or-ambiguous-check:",
      "missing-or-duplicate-check:",
      "self-sibling-refused:",
      "unowned-worktree:",
      "worktree-collision:",
      "worktree-state-drift:",
      "worktree-state-unknown:",
    ],
  },
  {
    rule: "family",
    faultClass: "halt",
    legacyParking: false,
    match: "prefix",
    reasons: ["invalid-", "malformed-", "conflicting-", "duplicate-", "unexpected-"],
  },
  {
    rule: "family",
    faultClass: "halt",
    legacyParking: false,
    match: "suffix",
    reasons: ["-drift", "-mismatch"],
  },
];

export function classifyStop(reason: string): {
  faultClass: FaultClass;
  legacyParking: boolean;
  rule: StopRule["rule"] | "unclassified";
} {
  for (const kind of ["exact", "prefix", "family"] as const) {
    for (const entry of stopRules) {
      if (entry.rule !== kind) continue;
      const matches = entry.reasons.some((pattern) =>
        entry.rule === "exact"
          ? reason === pattern
          : entry.rule === "family" && entry.match === "suffix"
            ? reason.endsWith(pattern)
            : reason.startsWith(pattern),
      );
      if (matches)
        return {
          faultClass: entry.faultClass,
          legacyParking: entry.legacyParking,
          rule: entry.rule,
        };
    }
  }
  return { faultClass: "halt", legacyParking: false, rule: "unclassified" };
}

export function parksItem(reason: string): boolean {
  const { faultClass, legacyParking } = classifyStop(reason);
  return faultClass === "attempt" || faultClass === "replan" || legacyParking;
}
