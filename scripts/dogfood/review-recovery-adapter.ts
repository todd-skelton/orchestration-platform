import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { sha, workerPrompt } from "./flow.ts";
import type { Adapter, Attempt, Config, Terminal } from "./flow.js";
import { classifyReview } from "./repair-policy.mjs";
import {
  sourceReviewBinding,
  validateSourceReviewAuthority,
  validateReviewRecoveryAuthority,
  validateSourceReviewBinding,
  type ValidatedSourceReviewContract,
  type SourceReviewBinding,
} from "./review-policy.mjs";

const ABSENT = Symbol("absent");
const IDENTITY = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA = /^[a-f0-9]{40}$/;

export class ReviewRecoveryBlocked extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function demand(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new ReviewRecoveryBlocked(reason);
}

async function optional(directory: string, name: string): Promise<any | typeof ABSENT> {
  try {
    return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw new ReviewRecoveryBlocked(`malformed-review-recovery-record:${name}`);
  }
}

async function required(directory: string, name: string): Promise<any> {
  const value = await optional(directory, name);
  demand(value !== ABSENT, `missing-review-recovery-source:${name}`);
  return value;
}

async function writeOnce(directory: string, name: string, value: unknown) {
  const path = resolve(directory, `${name}.json`);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(path, bytes, { flag: "wx", flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    demand((await readFile(path, "utf8")) === bytes, `conflicting-review-recovery-record:${name}`);
  }
}

function validAttempt(attempt: any) {
  return (
    attempt !== null &&
    typeof attempt === "object" &&
    !Array.isArray(attempt) &&
    Object.keys(attempt).length === 3 &&
    IDENTITY.test(attempt.id) &&
    Number.isSafeInteger(attempt.pid) &&
    attempt.pid > 0 &&
    typeof attempt.trace === "string" &&
    isAbsolute(attempt.trace)
  );
}

function samePath(left: string, right: string) {
  const normalize = (value: string) =>
    process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

export interface SourceReviewContractSelection {
  contract: ValidatedSourceReviewContract;
  authority?: Record<string, any>;
}

export async function sourceReviewContract(
  config: Config,
  known?: { configFingerprint: string; sourceAuthor: string; candidateHead: string },
  expectedExecutorRevision?: string,
): Promise<SourceReviewContractSelection> {
  const [pin, candidate, author, authority, reviewerIntent] = await Promise.all([
    required(config.stateDirectory, "config"),
    required(config.stateDirectory, "candidate"),
    required(config.stateDirectory, "author-attempt"),
    optional(config.stateDirectory, "source-review-authority"),
    optional(config.stateDirectory, "reviewer-intent"),
  ]);
  const prompts = await Promise.all(
    [config.author.promptFile, config.reviewer.promptFile].map((path) => readFile(path, "utf8")),
  );
  demand(
    pin?.config &&
      JSON.stringify(pin.config) === JSON.stringify(config) &&
      pin.fingerprint === sha(JSON.stringify({ config, prompts })) &&
      SHA.test(candidate?.head) &&
      validAttempt(author) &&
      (known === undefined ||
        (known.configFingerprint === pin.fingerprint &&
          known.sourceAuthor === author.id &&
          known.candidateHead === candidate.head)),
    "source-review-contract-lineage-mismatch",
  );
  if (authority === ABSENT) {
    demand(
      expectedExecutorRevision === undefined || expectedExecutorRevision === config.pilotRevision,
      "source-review-adoption-authority-required",
    );
    demand(
      known !== undefined ||
        reviewerIntent === ABSENT ||
        !Object.hasOwn(reviewerIntent, "reviewAuthority"),
      "source-review-intent-contract-mismatch",
    );
    return { contract: { scope: "complete", inheritance: null } };
  }
  let contract: ValidatedSourceReviewContract;
  try {
    contract = validateSourceReviewAuthority(authority, {
      controller: config.owner,
      run: config.run,
      stateDirectory: config.stateDirectory,
      configFingerprint: pin.fingerprint,
      authorAttempt: author.id,
      candidateHead: candidate.head,
      comparisonBase: config.base,
      executorRevision: expectedExecutorRevision ?? authority.executorRevision,
      scope: authority.scope,
      inheritance: authority.inheritance,
    });
  } catch {
    throw new ReviewRecoveryBlocked("unauthorized-source-review-contract");
  }
  demand(
    known !== undefined ||
      authority.executorRevision !== config.pilotRevision ||
      (reviewerIntent !== ABSENT &&
        JSON.stringify(reviewerIntent.reviewAuthority) === JSON.stringify(authority)),
    "source-review-intent-contract-mismatch",
  );
  return { contract, authority };
}

async function sourceIdentity(
  config: Config,
  originalDisposition: "malformed" | "incomplete" = "malformed",
) {
  const directory = config.stateDirectory;
  const [pin, candidate, author, authorTerminal, original, originalTerminal, originalIntent] =
    await Promise.all([
      required(directory, "config"),
      required(directory, "candidate"),
      required(directory, "author-attempt"),
      required(directory, "author-terminal"),
      required(directory, "reviewer-attempt"),
      required(directory, "reviewer-terminal"),
      required(directory, "reviewer-intent"),
    ]);
  const prompts = await Promise.all(
    [config.author.promptFile, config.reviewer.promptFile].map((path) => readFile(path, "utf8")),
  );
  const reviewSelection = await sourceReviewContract(config);
  const classifiedOriginal =
    candidate && SHA.test(candidate.head)
      ? classifyReview(originalTerminal?.summary, candidate.head, reviewSelection.contract.scope)
          .disposition
      : "malformed";
  const originalMatchesDisposition =
    originalDisposition === "malformed"
      ? originalTerminal?.status === "malformed" ||
        (["passed", "failed"].includes(originalTerminal?.status) &&
          classifiedOriginal === "malformed")
      : originalTerminal?.status === "failed" && classifiedOriginal === "incomplete";
  demand(
    pin?.config &&
      JSON.stringify(pin.config) === JSON.stringify(config) &&
      pin.fingerprint === sha(JSON.stringify({ config, prompts })),
    "review-recovery-source-config-mismatch",
  );
  demand(
    candidate &&
      SHA.test(candidate.head) &&
      validAttempt(author) &&
      authorTerminal?.status === "passed" &&
      authorTerminal.id === author.id &&
      authorTerminal.head === config.base &&
      samePath(author.trace, resolve(directory, "author.jsonl")) &&
      validAttempt(original) &&
      original.id !== author.id &&
      samePath(original.trace, resolve(directory, "reviewer.jsonl")) &&
      originalMatchesDisposition &&
      originalTerminal.id === original.id &&
      originalTerminal.head === candidate.head &&
      originalIntent?.fingerprint === pin.fingerprint &&
      originalIntent.role === "reviewer" &&
      originalIntent.head === candidate.head &&
      (reviewSelection.authority === undefined
        ? !Object.hasOwn(originalIntent, "reviewAuthority")
        : reviewSelection.authority.executorRevision !== config.pilotRevision ||
          JSON.stringify(originalIntent.reviewAuthority) ===
            JSON.stringify(reviewSelection.authority)),
    "review-recovery-source-lineage-mismatch",
  );
  if (originalDisposition === "malformed") {
    const authority = await required(directory, "review-recovery-authority");
    const expectedAuthority = {
      controller: config.owner,
      run: config.run,
      stateDirectory: config.stateDirectory,
      configFingerprint: pin.fingerprint,
      authorAttempt: author.id,
      candidateHead: candidate.head,
      originalReview: original.id,
      reviewer: config.reviewer,
    };
    try {
      validateReviewRecoveryAuthority(authority, expectedAuthority);
    } catch {
      throw new ReviewRecoveryBlocked("unauthorized-review-recovery");
    }
  }
  return { pin, candidate, author, original, originalTerminal, reviewSelection };
}

export interface SelectedSourceReview {
  attempt: Attempt;
  terminal: Terminal;
  binding?: SourceReviewBinding;
}

export async function selectedSourceReview(
  config: Config,
  selectedStateDirectory = config.stateDirectory,
): Promise<SelectedSourceReview> {
  demand(isAbsolute(selectedStateDirectory), "selected-review-state-invalid");
  const externalSelection = !samePath(selectedStateDirectory, config.stateDirectory);
  const savedBinding = await optional(selectedStateDirectory, "source-review-binding");
  if (savedBinding === ABSENT) {
    demand(!externalSelection, "missing-selected-review-binding");
    return {
      attempt: await required(config.stateDirectory, "reviewer-attempt"),
      terminal: await required(config.stateDirectory, "reviewer-terminal"),
    };
  }
  const originalDisposition = savedBinding?.originalReview?.disposition;
  demand(
    originalDisposition === "malformed" || originalDisposition === "incomplete",
    "selected-review-binding-mismatch",
  );
  demand(
    externalSelection ? originalDisposition === "incomplete" : originalDisposition === "malformed",
    "selected-review-binding-mismatch",
  );
  const source = await sourceIdentity(config, originalDisposition);
  const attemptName = externalSelection ? "reviewer-attempt" : "review-recovery-attempt";
  const terminalName = externalSelection ? "reviewer-terminal" : "review-recovery-terminal";
  const [attempt, terminal] = await Promise.all([
    required(selectedStateDirectory, attemptName),
    required(selectedStateDirectory, terminalName),
  ]);
  const selectedTrace = resolve(
    selectedStateDirectory,
    externalSelection ? "reviewer.jsonl" : "review-recovery.reviewer.jsonl",
  );
  demand(
    validAttempt(attempt) &&
      samePath(attempt.trace, selectedTrace) &&
      ![source.author.id, source.original.id].includes(attempt.id) &&
      terminal &&
      terminal.id === attempt.id &&
      terminal.head === source.candidate.head &&
      ["passed", "failed"].includes(terminal.status) &&
      classifyReview(terminal.summary, source.candidate.head, source.reviewSelection.contract.scope)
        .disposition === "complete",
    "selected-review-record-mismatch",
  );
  const expected = {
    run: config.run,
    stateDirectory: config.stateDirectory,
    configFingerprint: source.pin.fingerprint,
    authorAttempt: source.author.id,
    candidateHead: source.candidate.head,
    originalReview: source.original.id,
    originalDisposition,
    selectedReview: attempt.id,
    selectedDisposition: terminal.status as "passed" | "failed",
    ...(source.reviewSelection.authority === undefined
      ? {}
      : { reviewContract: source.reviewSelection.contract }),
  };
  try {
    validateSourceReviewBinding(savedBinding, expected);
  } catch {
    throw new ReviewRecoveryBlocked("selected-review-binding-mismatch");
  }
  return { attempt, terminal, binding: savedBinding };
}

export type ReviewRecoveryResult =
  | { status: "observing-reviewer" }
  | {
      status: "selected";
      attempt: Attempt;
      terminal: Terminal & { status: "passed" | "failed"; head: string };
      binding: SourceReviewBinding;
    };

export function reviewedReviewRecoveryAdapter(native: Adapter) {
  return {
    async recover(config: Config): Promise<ReviewRecoveryResult> {
      const source = await sourceIdentity(config);
      const verifyWorkspaces = async () =>
        (await native.git(config.worktree, ["rev-parse", "HEAD"])) === source.candidate.head &&
        (await native.git(config.worktree, ["status", "--porcelain"])) === "" &&
        (await native.git(config.reviewWorktree, ["rev-parse", "HEAD"])) ===
          source.candidate.head &&
        (await native.git(config.reviewWorktree, ["status", "--porcelain"])) === "";
      demand(await verifyWorkspaces(), "review-recovery-workspace-mismatch");
      const intent = {
        schemaVersion: "dogfood-review-recovery-intent/v1",
        run: config.run,
        head: source.candidate.head,
        sourceConfigFingerprint: source.pin.fingerprint,
        sourceAuthor: source.author.id,
        originalReview: source.original.id,
        reviewer: config.reviewer,
        ...(source.reviewSelection.authority === undefined
          ? {}
          : { reviewContract: source.reviewSelection.contract }),
      };
      let savedIntent = await optional(config.stateDirectory, "review-recovery-intent");
      const savedAttempt = await optional(config.stateDirectory, "review-recovery-attempt");
      if (savedIntent === ABSENT) {
        demand(savedAttempt === ABSENT, "review-recovery-attempt-without-intent");
        await writeOnce(config.stateDirectory, "review-recovery-intent", intent);
        savedIntent = intent;
      } else {
        demand(
          JSON.stringify(savedIntent) === JSON.stringify(intent),
          "review-recovery-intent-drift",
        );
        demand(savedAttempt !== ABSENT, "review-recovery-launch-identity-unknown-reconcile");
      }

      const recoveryConfig: Config = { ...config, artifactPrefix: "review-recovery" };
      let attempt = savedAttempt as Attempt | typeof ABSENT;
      if (attempt === ABSENT) {
        const basePrompt = await readFile(config.reviewer.promptFile, "utf8");
        const inheritance = source.reviewSelection.contract.inheritance;
        const scopeInstruction =
          source.reviewSelection.contract.scope === "complete"
            ? 'Return the authorized COMPLETE contract with scope "complete".'
            : `Return only the authorized DELTA contract with scope "delta", inheriting completed independent sweep ${inheritance!.review} at ${inheritance!.head}.`;
        const prompt = `${workerPrompt(config, "reviewer", source.candidate.head, basePrompt)}\nThis is the sole authority-bound replacement for malformed transport from reviewer ${source.original.id}. ${scopeInstruction} Review the unchanged exact candidate independently. Do not infer or copy any lost finding and do not change source to obtain a verdict.\n`;
        attempt = await native.launch("reviewer", recoveryConfig, prompt);
        demand(
          validAttempt(attempt) && ![source.author.id, source.original.id].includes(attempt.id),
          "review-recovery-participant-mismatch",
        );
        await writeOnce(config.stateDirectory, "review-recovery-attempt", attempt);
      }
      demand(
        validAttempt(attempt) && ![source.author.id, source.original.id].includes(attempt.id),
        "review-recovery-participant-mismatch",
      );
      let terminal = await optional(config.stateDirectory, "review-recovery-terminal");
      if (terminal === ABSENT) {
        terminal = await native.observe("reviewer", recoveryConfig, attempt);
        demand(
          terminal &&
            terminal.id === attempt.id &&
            ["running", "passed", "failed", "malformed"].includes(terminal.status),
          "review-recovery-terminal-mismatch",
        );
        if (terminal.status === "running") return { status: "observing-reviewer" };
        demand(terminal.head === source.candidate.head, "review-recovery-head-mismatch");
        demand(
          terminal.status === "malformed" ||
            classifyReview(
              terminal.summary,
              source.candidate.head,
              source.reviewSelection.contract.scope,
            ).disposition === "complete",
          "replacement-review-malformed",
        );
        await writeOnce(config.stateDirectory, "review-recovery-terminal", terminal);
      }
      demand(terminal.status !== "malformed", "replacement-review-malformed");
      demand(
        classifyReview(
          terminal.summary,
          source.candidate.head,
          source.reviewSelection.contract.scope,
        ).disposition === "complete",
        "replacement-review-malformed",
      );
      demand(
        ["passed", "failed"].includes(terminal.status) &&
          terminal.id === attempt.id &&
          terminal.head === source.candidate.head,
        "review-recovery-terminal-mismatch",
      );
      demand(await verifyWorkspaces(), "review-recovery-workspace-mismatch");
      const binding = sourceReviewBinding({
        run: config.run,
        stateDirectory: config.stateDirectory,
        configFingerprint: source.pin.fingerprint,
        authorAttempt: source.author.id,
        candidateHead: source.candidate.head,
        originalReview: source.original.id,
        selectedReview: attempt.id,
        selectedDisposition: terminal.status,
        ...(source.reviewSelection.authority === undefined
          ? {}
          : { reviewContract: source.reviewSelection.contract }),
      });
      await writeOnce(config.stateDirectory, "source-review-binding", binding);
      return {
        status: "selected",
        attempt,
        terminal: terminal as Terminal & { status: "passed" | "failed"; head: string },
        binding,
      };
    },
  };
}

export type ReviewRecoveryAdapter = ReturnType<typeof reviewedReviewRecoveryAdapter>;
