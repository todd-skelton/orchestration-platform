export const SOURCE_REVIEW_BINDING_SCHEMA = "dogfood-source-review-binding/v1" as const;
export const SOURCE_REVIEW_BINDING_V2_SCHEMA = "dogfood-source-review-binding/v2" as const;
export const REVIEW_RECOVERY_AUTHORITY_SCHEMA = "dogfood-review-recovery-authority/v1" as const;
export const SOURCE_REVIEW_AUTHORITY_SCHEMA = "dogfood-source-review-authority/v1" as const;

export type ReviewScope = "complete" | "delta";
export interface ReviewInheritance {
  run: string;
  author: string;
  review: string;
  head: string;
  scope: "complete";
  complete: true;
}
export interface ValidatedSourceReviewContract {
  scope: ReviewScope;
  inheritance: ReviewInheritance | null;
}

export interface SourceReviewAuthorityInput {
  controller: string;
  run: string;
  stateDirectory: string;
  configFingerprint: string;
  authorAttempt: string;
  candidateHead: string;
  comparisonBase: string;
  executorRevision: string;
  scope: ReviewScope;
  inheritance?: ReviewInheritance | null;
}

export function sourceReviewAuthority(input: SourceReviewAuthorityInput) {
  const inheritance = input.inheritance ?? null;
  if (
    !IDENTITY.test(input.controller) ||
    !/^[\w.-]{1,64}$/.test(input.run) ||
    typeof input.stateDirectory !== "string" ||
    input.stateDirectory.length === 0 ||
    !DIGEST.test(input.configFingerprint) ||
    !IDENTITY.test(input.authorAttempt) ||
    !SHA.test(input.candidateHead) ||
    !SHA.test(input.comparisonBase) ||
    !SHA.test(input.executorRevision) ||
    !["complete", "delta"].includes(input.scope) ||
    (input.scope === "complete" && inheritance !== null) ||
    (input.scope === "delta" &&
      (!exactKeys(inheritance, ["run", "author", "review", "head", "scope", "complete"]) ||
        !/^[\w.-]{1,64}$/.test(inheritance.run) ||
        !IDENTITY.test(inheritance.author) ||
        !IDENTITY.test(inheritance.review) ||
        !SHA.test(inheritance.head) ||
        inheritance.head !== input.comparisonBase ||
        inheritance.scope !== "complete" ||
        inheritance.complete !== true ||
        inheritance.author === inheritance.review ||
        inheritance.review === input.authorAttempt ||
        input.candidateHead === input.comparisonBase))
  )
    throw new Error("invalid-source-review-authority-input");
  return {
    schemaVersion: SOURCE_REVIEW_AUTHORITY_SCHEMA,
    controller: input.controller,
    run: input.run,
    stateDirectory: input.stateDirectory,
    sourceConfigFingerprint: input.configFingerprint,
    sourceAuthor: input.authorAttempt,
    candidateHead: input.candidateHead,
    comparisonBase: input.comparisonBase,
    executorRevision: input.executorRevision,
    scope: input.scope,
    inheritance,
    action: "authorize-source-review" as const,
  };
}

export function validateSourceReviewAuthority(
  value: unknown,
  expected: SourceReviewAuthorityInput,
): ValidatedSourceReviewContract {
  const authority = sourceReviewAuthority(expected);
  const sameInheritance =
    authority.inheritance === null
      ? value !== null && typeof value === "object" && (value as any).inheritance === null
      : exactKeys(
          value !== null && typeof value === "object" ? (value as any).inheritance : undefined,
          ["run", "author", "review", "head", "scope", "complete"],
        ) &&
        (value as any).inheritance.run === authority.inheritance.run &&
        (value as any).inheritance.author === authority.inheritance.author &&
        (value as any).inheritance.review === authority.inheritance.review &&
        (value as any).inheritance.head === authority.inheritance.head &&
        (value as any).inheritance.scope === authority.inheritance.scope &&
        (value as any).inheritance.complete === authority.inheritance.complete;
  if (
    !exactKeys(value, [
      "schemaVersion",
      "controller",
      "run",
      "stateDirectory",
      "sourceConfigFingerprint",
      "sourceAuthor",
      "candidateHead",
      "comparisonBase",
      "executorRevision",
      "scope",
      "inheritance",
      "action",
    ]) ||
    value.schemaVersion !== authority.schemaVersion ||
    value.controller !== authority.controller ||
    value.run !== authority.run ||
    value.stateDirectory !== authority.stateDirectory ||
    value.sourceConfigFingerprint !== authority.sourceConfigFingerprint ||
    value.sourceAuthor !== authority.sourceAuthor ||
    value.candidateHead !== authority.candidateHead ||
    value.comparisonBase !== authority.comparisonBase ||
    value.executorRevision !== authority.executorRevision ||
    value.scope !== authority.scope ||
    !sameInheritance ||
    value.action !== authority.action
  )
    throw new Error("invalid-source-review-authority");
  return { scope: authority.scope, inheritance: authority.inheritance };
}

export type SelectedReviewDisposition = "passed" | "failed";

export interface SourceReviewBinding {
  schemaVersion: typeof SOURCE_REVIEW_BINDING_SCHEMA | typeof SOURCE_REVIEW_BINDING_V2_SCHEMA;
  source: {
    run: string;
    stateDirectory: string;
    configFingerprint: string;
    authorAttempt: string;
    candidateHead: string;
  };
  originalReview: { attempt: string; disposition: "malformed" | "incomplete" };
  selectedReview: { attempt: string; disposition: SelectedReviewDisposition };
  reviewContract?: ValidatedSourceReviewContract;
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
  reviewContract?: ValidatedSourceReviewContract;
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
  if (
    input.reviewContract !== undefined &&
    !(
      ["complete", "delta"].includes(input.reviewContract.scope) &&
      ((input.reviewContract.scope === "complete" && input.reviewContract.inheritance === null) ||
        (input.reviewContract.scope === "delta" &&
          exactKeys(input.reviewContract.inheritance, [
            "run",
            "author",
            "review",
            "head",
            "scope",
            "complete",
          ]) &&
          /^[\w.-]{1,64}$/.test(input.reviewContract.inheritance.run) &&
          IDENTITY.test(input.reviewContract.inheritance.author) &&
          IDENTITY.test(input.reviewContract.inheritance.review) &&
          SHA.test(input.reviewContract.inheritance.head) &&
          input.reviewContract.inheritance.scope === "complete" &&
          input.reviewContract.inheritance.complete === true &&
          input.reviewContract.inheritance.author !== input.reviewContract.inheritance.review &&
          input.reviewContract.inheritance.review !== input.authorAttempt))
    )
  )
    throw new Error("invalid-source-review-binding-input");
  return {
    schemaVersion:
      input.reviewContract === undefined
        ? SOURCE_REVIEW_BINDING_SCHEMA
        : SOURCE_REVIEW_BINDING_V2_SCHEMA,
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
    ...(input.reviewContract === undefined ? {} : { reviewContract: input.reviewContract }),
  };
}

export function validateSourceReviewBinding(
  value: unknown,
  expected: SourceReviewBindingInput,
): asserts value is SourceReviewBinding {
  const expectedBinding = sourceReviewBinding(expected);
  const sameContract =
    expectedBinding.reviewContract === undefined
      ? (value as any)?.reviewContract === undefined
      : exactKeys((value as any)?.reviewContract, ["scope", "inheritance"]) &&
        (value as any).reviewContract.scope === expectedBinding.reviewContract.scope &&
        (expectedBinding.reviewContract.inheritance === null
          ? (value as any).reviewContract.inheritance === null
          : exactKeys((value as any).reviewContract.inheritance, [
              "run",
              "author",
              "review",
              "head",
              "scope",
              "complete",
            ]) &&
            (value as any).reviewContract.inheritance.run ===
              expectedBinding.reviewContract.inheritance.run &&
            (value as any).reviewContract.inheritance.author ===
              expectedBinding.reviewContract.inheritance.author &&
            (value as any).reviewContract.inheritance.review ===
              expectedBinding.reviewContract.inheritance.review &&
            (value as any).reviewContract.inheritance.head ===
              expectedBinding.reviewContract.inheritance.head &&
            (value as any).reviewContract.inheritance.scope ===
              expectedBinding.reviewContract.inheritance.scope &&
            (value as any).reviewContract.inheritance.complete ===
              expectedBinding.reviewContract.inheritance.complete);
  if (
    !exactKeys(value, [
      "schemaVersion",
      "source",
      "originalReview",
      "selectedReview",
      ...(expected.reviewContract === undefined ? [] : ["reviewContract"]),
    ]) ||
    value.schemaVersion !== expectedBinding.schemaVersion ||
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
    value.selectedReview.disposition !== expectedBinding.selectedReview.disposition ||
    !sameContract
  )
    throw new Error("invalid-source-review-binding");
}
