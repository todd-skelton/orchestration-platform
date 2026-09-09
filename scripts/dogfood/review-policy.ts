export const SOURCE_REVIEW_BINDING_SCHEMA = "dogfood-source-review-binding/v1" as const;
export const REVIEW_RECOVERY_AUTHORITY_SCHEMA = "dogfood-review-recovery-authority/v1" as const;

export type SelectedReviewDisposition = "passed" | "failed";

export interface SourceReviewBinding {
  schemaVersion: typeof SOURCE_REVIEW_BINDING_SCHEMA;
  source: {
    run: string;
    stateDirectory: string;
    configFingerprint: string;
    authorAttempt: string;
    candidateHead: string;
  };
  originalReview: { attempt: string; disposition: "malformed" | "incomplete" };
  selectedReview: { attempt: string; disposition: SelectedReviewDisposition };
}

export interface SourceReviewBindingInput {
  run: string;
  stateDirectory: string;
  configFingerprint: string;
  authorAttempt: string;
  candidateHead: string;
  originalReview: string;
  originalDisposition?: "malformed" | "incomplete";
  selectedReview: string;
  selectedDisposition: SelectedReviewDisposition;
}

export interface ReviewRecoveryAuthorityInput {
  controller: string;
  run: string;
  stateDirectory: string;
  configFingerprint: string;
  authorAttempt: string;
  candidateHead: string;
  originalReview: string;
  reviewer: { model: string; effort: string; promptFile: string };
}

export function reviewRecoveryAuthority(input: ReviewRecoveryAuthorityInput) {
  if (
    !IDENTITY.test(input.controller) ||
    !/^[\w.-]{1,64}$/.test(input.run) ||
    typeof input.stateDirectory !== "string" ||
    input.stateDirectory.length === 0 ||
    !DIGEST.test(input.configFingerprint) ||
    !SHA.test(input.candidateHead) ||
    ![input.authorAttempt, input.originalReview].every((value) => IDENTITY.test(value)) ||
    input.authorAttempt === input.originalReview ||
    !exactKeys(input.reviewer, ["model", "effort", "promptFile"]) ||
    ![input.reviewer.model, input.reviewer.effort, input.reviewer.promptFile].every(
      (value) => typeof value === "string" && value.length > 0,
    )
  )
    throw new Error("invalid-review-recovery-authority-input");
  return {
    schemaVersion: REVIEW_RECOVERY_AUTHORITY_SCHEMA,
    controller: input.controller,
    run: input.run,
    stateDirectory: input.stateDirectory,
    sourceConfigFingerprint: input.configFingerprint,
    sourceAuthor: input.authorAttempt,
    candidateHead: input.candidateHead,
    originalReview: input.originalReview,
    reviewer: input.reviewer,
    action: "replace-malformed-review" as const,
  };
}

export function validateReviewRecoveryAuthority(
  value: unknown,
  expected: ReviewRecoveryAuthorityInput,
) {
  const authority = reviewRecoveryAuthority(expected);
  if (
    !exactKeys(value, [
      "schemaVersion",
      "controller",
      "run",
      "stateDirectory",
      "sourceConfigFingerprint",
      "sourceAuthor",
      "candidateHead",
      "originalReview",
      "reviewer",
      "action",
    ]) ||
    !exactKeys(value.reviewer, ["model", "effort", "promptFile"]) ||
    value.schemaVersion !== authority.schemaVersion ||
    value.controller !== authority.controller ||
    value.run !== authority.run ||
    value.stateDirectory !== authority.stateDirectory ||
    value.sourceConfigFingerprint !== authority.sourceConfigFingerprint ||
    value.sourceAuthor !== authority.sourceAuthor ||
    value.candidateHead !== authority.candidateHead ||
    value.originalReview !== authority.originalReview ||
    value.reviewer.model !== authority.reviewer.model ||
    value.reviewer.effort !== authority.reviewer.effort ||
    value.reviewer.promptFile !== authority.reviewer.promptFile ||
    value.action !== authority.action
  )
    throw new Error("invalid-review-recovery-authority");
}

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const IDENTITY = /^[A-Za-z0-9._:-]{1,128}$/;
const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function exactKeys(value: unknown, keys: string[]): value is Record<string, any> {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

export function sourceReviewBinding(input: SourceReviewBindingInput): SourceReviewBinding {
  const originalDisposition = input.originalDisposition ?? "malformed";
  if (
    !/^[\w.-]{1,64}$/.test(input.run) ||
    typeof input.stateDirectory !== "string" ||
    input.stateDirectory.length === 0 ||
    !DIGEST.test(input.configFingerprint) ||
    !SHA.test(input.candidateHead) ||
    ![input.authorAttempt, input.originalReview, input.selectedReview].every((value) =>
      IDENTITY.test(value),
    ) ||
    new Set([input.authorAttempt, input.originalReview, input.selectedReview]).size !== 3 ||
    !["malformed", "incomplete"].includes(originalDisposition) ||
    !["passed", "failed"].includes(input.selectedDisposition)
  )
    throw new Error("invalid-source-review-binding-input");
  return {
    schemaVersion: SOURCE_REVIEW_BINDING_SCHEMA,
    source: {
      run: input.run,
      stateDirectory: input.stateDirectory,
      configFingerprint: input.configFingerprint,
      authorAttempt: input.authorAttempt,
      candidateHead: input.candidateHead,
    },
    originalReview: { attempt: input.originalReview, disposition: originalDisposition },
    selectedReview: {
      attempt: input.selectedReview,
      disposition: input.selectedDisposition,
    },
  };
}

export function validateSourceReviewBinding(
  value: unknown,
  expected: SourceReviewBindingInput,
): asserts value is SourceReviewBinding {
  const expectedBinding = sourceReviewBinding(expected);
  if (
    !exactKeys(value, ["schemaVersion", "source", "originalReview", "selectedReview"]) ||
    value.schemaVersion !== SOURCE_REVIEW_BINDING_SCHEMA ||
    !exactKeys(value.source, [
      "run",
      "stateDirectory",
      "configFingerprint",
      "authorAttempt",
      "candidateHead",
    ]) ||
    !exactKeys(value.originalReview, ["attempt", "disposition"]) ||
    !exactKeys(value.selectedReview, ["attempt", "disposition"]) ||
    value.source.run !== expectedBinding.source.run ||
    value.source.stateDirectory !== expectedBinding.source.stateDirectory ||
    value.source.configFingerprint !== expectedBinding.source.configFingerprint ||
    value.source.authorAttempt !== expectedBinding.source.authorAttempt ||
    value.source.candidateHead !== expectedBinding.source.candidateHead ||
    value.originalReview.attempt !== expectedBinding.originalReview.attempt ||
    value.originalReview.disposition !== expectedBinding.originalReview.disposition ||
    value.selectedReview.attempt !== expectedBinding.selectedReview.attempt ||
    value.selectedReview.disposition !== expectedBinding.selectedReview.disposition
  )
    throw new Error("invalid-source-review-binding");
}
