import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// ISS-236 / JR-1: descriptive cause only. Nothing here chooses a disposition.
export const defectClasses = [
  "mechanical",
  "environment-tooling",
  "implementation-known-remedy",
  "brief",
  "slice",
  "design",
  "product-scope",
  "external-dependency",
] as const;
export type DefectClass = (typeof defectClasses)[number];
export interface Defect {
  defectClass: DefectClass;
  explanation: string;
  rootCause: string;
  evidenceStatus: "established" | "unresolved";
  evidence: string[];
}

const bounded = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= limit;

export function validDefect(value: unknown): value is Defect {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).length === 5 &&
    defectClasses.includes(row.defectClass as DefectClass) &&
    bounded(row.explanation, 1000) &&
    bounded(row.rootCause, 200) &&
    ["established", "unresolved"].includes(row.evidenceStatus as string) &&
    Array.isArray(row.evidence) &&
    row.evidence.length > 0 &&
    row.evidence.length <= 16 &&
    row.evidence.every((entry) => bounded(entry, 1024)) &&
    (row.evidenceStatus !== "unresolved" || row.defectClass === "environment-tooling")
  );
}

export const defectSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["defectClass", "explanation", "rootCause", "evidenceStatus", "evidence"],
      properties: {
        defectClass: { type: "string", enum: defectClasses },
        explanation: { type: "string", minLength: 1, maxLength: 1000 },
        rootCause: { type: "string", minLength: 1, maxLength: 200 },
        evidenceStatus: { type: "string", enum: ["established", "unresolved"] },
        evidence: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          items: { type: "string", minLength: 1, maxLength: 1024 },
        },
      },
    },
  ],
};

export const defectPrompt =
  `Include one additional field "defect": null on PASS; on FAIL, exactly ` +
  `{"defectClass":"<one of ${defectClasses.join(" | ")}>","explanation":"<at most 1000 characters>","rootCause":"<stable causal identity, at most 200 characters>","evidenceStatus":"established|unresolved","evidence":["<source evidence reference, at most 1024 characters>"]}. ` +
  "Use 1..16 evidence references. Retain all findings in a mixed failure, and select the primary cause determining the next step. Judge the cause from evidence, not words in the issue or stop reason. Unresolved attribution must use environment-tooling with evidenceStatus unresolved; that is neither candidate exoneration nor retry authority. A gate timeout or passing subset proves no environment attribution. No extra launch or diagnostic gate is authorized to populate this field. The existing report length bounds include this field.";

export function validReportDefect(report: Record<string, any>, required = false): boolean {
  if (!Object.hasOwn(report, "defect")) return !required;
  return report.verdict === "FAIL" ? validDefect(report.defect) : report.defect === null;
}

export interface OutcomeContext {
  repository: string;
  run: string;
  issue: string;
  stateDirectory: string;
}
export interface Outcome {
  kind: "worker" | "local-gate" | "hosted-gate" | "stop";
  identity: string;
  head: string | null;
  terminal: unknown;
  defect: Defect;
}

export function unresolved(rootCause: string, explanation: string, evidence: string[]): Defect {
  return {
    defectClass: "environment-tooling",
    evidenceStatus: "unresolved",
    rootCause: rootCause.slice(0, 200),
    explanation: explanation.slice(0, 1000),
    evidence,
  };
}

// One writer, one occurrence. Replay uses the first observation; old terminal,
// configuration, prompt and stop bytes are never backfilled. The stage directory
// is also the attempt/stage identity (including special continuation directories).
export async function retainOutcome(
  context: OutcomeContext,
  outcome: Outcome,
  storageDirectory = context.stateDirectory,
): Promise<string> {
  const identity = {
    repository: context.repository,
    issue: context.issue,
    run: context.run,
    stage: context.stateDirectory,
    kind: outcome.kind,
    identity: outcome.identity,
    head: outcome.head,
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        ...identity,
        // Worker IDs and stop markers already identify occurrences. A later cursor
        // must not turn recovery of one old occurrence into a new classification.
        head: outcome.kind === "worker" || outcome.kind === "stop" ? null : outcome.head,
      }),
    )
    .digest("hex");
  const path = resolve(storageDirectory, `outcome-${hash}.json`);
  try {
    await readFile(path);
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(
    `${path}.next`,
    JSON.stringify(
      {
        schemaVersion: "dogfood-outcome/v1",
        ...identity,
        terminal: outcome.terminal,
        ...outcome.defect,
      },
      null,
      2,
    ) + "\n",
    { flush: true },
  );
  await rename(`${path}.next`, path);
  return path;
}

export async function retainWorkerOutcome(
  context: OutcomeContext,
  role: string,
  attempt: { id: string; trace: string },
  terminal: {
    status: string;
    head?: string;
    summary?: string;
    defect?: Defect;
    providerFailure?: boolean;
    modelRefused?: boolean;
  },
) {
  if (!["failed", "malformed", "dead"].includes(terminal.status)) return;
  const evidence = [attempt.trace, resolve(context.stateDirectory, `${role}-terminal.json`)];
  let reported = terminal.defect;
  if (!reported && role === "reviewer" && terminal.status === "failed" && terminal.summary) {
    try {
      const review = JSON.parse(terminal.summary);
      if (review.verdict === "FAIL" && validDefect(review.defect)) reported = review.defect;
    } catch {
      // The protocol boundary decides malformed reports, never this projection.
    }
  }
  const defect =
    terminal.status === "failed" && reported
      ? reported
      : terminal.status === "malformed"
        ? {
            defectClass: "mechanical" as const,
            evidenceStatus: "established" as const,
            rootCause: "worker-report-protocol",
            explanation:
              "The worker report did not satisfy its launch protocol. The original trace is retained verbatim; no semantic verdict is inferred.",
            evidence,
          }
        : terminal.providerFailure
          ? {
              defectClass: "environment-tooling" as const,
              evidenceStatus: "established" as const,
              rootCause: "worker-provider-transport",
              explanation:
                "The existing worker transport discriminator reported provider failure. This describes the transport outcome, not candidate correctness or retry authority.",
              evidence,
            }
          : unresolved(
              terminal.modelRefused
                ? "worker-model-refused"
                : terminal.status === "dead"
                  ? "worker-exit"
                  : "legacy-worker-cause-unresolved",
              "Retained worker evidence does not establish a semantic cause. No exoneration, retry or disposition follows from this classification.",
              evidence,
            );
  return retainOutcome(context, {
    kind: "worker",
    identity: `${role}:${attempt.id}`,
    head: terminal.head ?? null,
    terminal,
    defect,
  });
}

export async function retainGateOutcome(
  context: OutcomeContext,
  gate: string,
  head: string,
  evidence: { log: string; diagnostics: string[] } | undefined,
  attribution?: { cause: "candidate" | "base" | "host" | "unknown"; log: string; main: string },
) {
  if (evidence) {
    try {
      const execution = JSON.parse(
        await readFile(resolve(evidence.log, "..", "candidate-terminal.json"), "utf8"),
      );
      // The verifier's explicit non-execution result is not a failed gate.
      // The caller retains its existing stop and accounting behavior.
      if (execution.code === 73) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const references = [evidence?.log ?? resolve(context.stateDirectory, "gate-stop.json")];
  if (attribution) references.push(attribution.log);
  const defect =
    attribution?.cause === "candidate"
      ? {
          defectClass: "implementation-known-remedy" as const,
          evidenceStatus: "established" as const,
          rootCause: `gate:${gate}:${createHash("sha256")
            .update(JSON.stringify(evidence?.diagnostics ?? []))
            .digest("hex")}`.slice(0, 200),
          explanation:
            "Committed candidate diagnostics failed while the existing same-command immutable-base control passed. Retain the complete diagnostics for correction.",
          evidence: references,
        }
      : unresolved(
          `gate:${gate}`,
          `Gate cause remains unresolved for semantic classification (existing attribution: ${attribution?.cause ?? "unavailable"}). This does not exonerate the candidate or authorize retry.`,
          references,
        );
  return retainOutcome(context, {
    kind: "local-gate",
    identity: gate,
    head,
    terminal: { evidence: evidence ?? null, attribution: attribution ?? null },
    defect,
  });
}

export async function retainStopOutcome(
  context: OutcomeContext & { attemptDirectory?: string },
  identity: string,
  reason: string,
  terminal: unknown,
  evidence: string,
  head: string | null = null,
  diagnostics?: string,
  history?: { item: string; stage: string; role: string; id: string; outcome?: string }[],
) {
  if (reason === "hosted-check-never-executed") return;
  const read = async (directory: string, name: string): Promise<any> => {
    try {
      return JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
  const attemptDirectory = context.attemptDirectory ?? context.stateDirectory;
  const storageDirectory = resolve(evidence, "..");
  const attempt = await read(attemptDirectory, "attempt");
  const participants = (history ?? attempt?.history ?? []).filter(
    (participant: { item: string }) => participant.item === attempt?.item,
  );
  const last = participants.at(-1);
  const stage =
    attempt?.stateDirectory ??
    (context.attemptDirectory
      ? context.stateDirectory
      : attempt
        ? resolve(
            attemptDirectory,
            attempt.phase === "setup"
              ? "setup"
              : attempt.phase === "repair" ||
                  participants.findLast((p: { stage: string }) => p.stage !== "refresh")?.stage ===
                    "repair"
                ? "repair"
                : "source",
          )
        : attemptDirectory);
  const references = [evidence];
  if (attempt) references.push(resolve(attemptDirectory, "attempt.json"));
  let directory = stage;
  let stageHead = attempt?.head ?? head;
  let stagePath = attempt ? resolve(attemptDirectory, "attempt.json") : evidence;
  // Follow the lifecycle's retained pointers, including in-flight correction and
  // conflict stages. Directory order or a later attempt is not failure identity.
  const stages = new Set([storageDirectory, attemptDirectory]);
  for (;;) {
    stages.add(directory);
    const correction = await read(directory, "gate-correction");
    const recovery = await read(directory, "gate-stop-continuation");
    const refresh = await read(directory, "native-refresh");
    if (
      recovery?.delivery &&
      !recovery.authorization?.hostedNonExecution &&
      !recovery.authorization?.hostedExecutedFailure
    ) {
      references.push(resolve(directory, "gate-stop-continuation.json"));
      directory = resolve(directory, "gate-stop-continuation");
      stageHead = recovery.delivery.candidateHead;
      stagePath = references.at(-1)!;
    } else if (correction?.directory) {
      references.push(resolve(directory, "gate-correction.json"));
      directory = correction.directory;
      stageHead = correction.failedHead ?? stageHead;
      stagePath = references.at(-1)!;
    } else if (refresh?.directory) {
      references.push(resolve(directory, "native-refresh.json"));
      directory = refresh.reviewDirectory ?? refresh.directory;
      stageHead = refresh.head ?? refresh.conflict?.seed ?? refresh.previousHead;
      stagePath = references.at(-1)!;
    } else break;
  }
  const records: { path: string; value: any }[] = [];
  for (const state of stages) {
    const names = await readdir(state).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const name of names.filter((name) => /^outcome-[a-f0-9]{64}\.json$/.test(name)))
      records.push({ path: resolve(state, name), value: await read(state, name.slice(0, -5)) });
  }
  // A retained stop remains bound to its first observation, even if its cursor
  // subsequently advanced. Worker/gate propagation below reuses that occurrence.
  const existing = records.find(
    (row) => row.value.kind === "stop" && row.value.identity === identity,
  );
  if (existing) return existing.path;
  const candidate = await read(directory, "candidate");
  const reviewer = await read(directory, "reviewer-terminal");
  const author = await read(directory, "author-terminal");
  const exactTerminal = reviewer ?? author;
  stageHead = candidate?.head ?? exactTerminal?.head ?? stageHead;
  if (exactTerminal) {
    references.push(resolve(directory, `${reviewer ? "reviewer" : "author"}-terminal.json`));
    stagePath = references.at(-1)!;
  }
  const wrapped = [
    "continuation-failed",
    "implementation-attempt-ceiling-exhausted",
    "verification-only-candidate-failed",
  ].includes(reason);
  const workerRole = [
    "author-failed",
    "author-malformed",
    "conflict-resolution-failed",
    "gate-correction-failed",
  ].includes(reason)
    ? "author"
    : [
          "reviewer-failed",
          "review-failed",
          "reviewer-malformed",
          "refresh-review-failed",
          "gate-correction-review-failed",
        ].includes(reason)
      ? "reviewer"
      : ["launcher-failed", "exit-receipt-timeout"].includes(reason) || wrapped
        ? last?.role
        : undefined;
  if (workerRole) {
    const participant = participants.findLast((row: { role: string }) => row.role === workerRole);
    const retained = records.find(
      (row) =>
        row.value.kind === "worker" && row.value.identity === `${workerRole}:${participant?.id}`,
    );
    if (retained) return retained.path;
    const worker = await read(directory, `${workerRole}-attempt`);
    const result = workerRole === "reviewer" ? reviewer : author;
    if (worker && result?.id === worker.id && (!wrapped || last?.id === worker.id)) {
      const prior = records.find(
        (row) => row.value.kind === "worker" && row.value.identity === `${workerRole}:${worker.id}`,
      );
      if (prior) return prior.path;
      const saved = await read(directory, "config");
      const path = await retainWorkerOutcome(
        {
          ...context,
          issue: attempt?.issue ?? context.issue,
          ...saved?.config,
          stateDirectory: directory,
        },
        workerRole,
        worker,
        result,
      );
      if (path) return path;
    }
  }
  // Special continuations wrap the original typed failure. Reuse the outcome
  // captured before that wrapping, rather than inventing a second primary cause.
  if (wrapped) {
    const prior = records.findLast(
      (row) =>
        row.value.kind === "stop" && row.value.stage === directory && row.value.head === stageHead,
    );
    if (prior) return prior.path;
  }
  let gateStop;
  for (const state of [...stages].toReversed()) {
    gateStop = await read(state, "gate-stop");
    if (gateStop) break;
  }
  const effectiveReason = wrapped && gateStop ? gateStop.reason : reason;
  if (effectiveReason === "hosted-check-never-executed") return;
  const gate =
    /^(?:gate-failed|gate-base-failed|gate-host-failed|gate-attribution-unknown|gate-correction-exhausted):(.+)$/.exec(
      effectiveReason,
    )?.[1];
  const hosted =
    effectiveReason === "hosted-check-failed" ||
    effectiveReason.startsWith("hosted-check-failed:") ||
    effectiveReason.startsWith("hosted-check-log-unavailable:");
  const priorHosted = records.findLast(
    (row) =>
      row.value.stage === directory &&
      row.value.head === stageHead &&
      row.value.kind === "hosted-gate" &&
      (hosted || wrapped),
  );
  if (priorHosted) return priorHosted.path;
  const gateFailure = wrapped || effectiveReason === "gate-correction-not-authorized";
  const priorGate = records.findLast(
    (row) =>
      row.value.stage === directory &&
      row.value.head === stageHead &&
      row.value.kind === "local-gate" &&
      (row.value.identity === gate || (gateFailure && !gate)),
  );
  if (priorGate) return priorGate.path;
  const attribution = await read(directory, "gate-attribution");
  if (gate || (gateFailure && attribution)) {
    const gateName = gate ?? attribution.gate;
    const artifacts = resolve(
      directory,
      `gate-${createHash("sha256").update(gateName).digest("hex")}`,
    );
    const execution = await read(artifacts, "candidate-terminal");
    if (execution?.code === 73) return;
    return retainGateOutcome(
      { ...context, issue: attempt?.issue ?? context.issue, stateDirectory: directory },
      gateName,
      stageHead!,
      attribution?.evidence ??
        (execution ? { log: resolve(artifacts, "candidate.log"), diagnostics: [] } : undefined),
      attribution,
    );
  }

  const established = (
    defectClass: DefectClass,
    rootCause: string,
    explanation: string,
  ): Defect => ({
    defectClass,
    rootCause,
    explanation,
    evidenceStatus: "established",
    evidence: references,
  });
  let defect: Defect;
  switch (effectiveReason) {
    case "conflict-resolution-scope-escape":
      defect = established(
        "mechanical",
        "conflict-resolution-boundary",
        "The conflict validator rejected a captured path or changes outside its permitted text boundary. The retained conflict inputs and terminal identify the rejected resolution; this supplies no wider edit permission.",
      );
      break;
    case "conflict-resolution-unsupported":
      defect = established(
        "environment-tooling",
        "unsupported-conflict-shape",
        "Native conflict capture found a shape the text-only resolver does not support. This identifies the tooling limitation, not a semantic verdict on either parent.",
      );
      break;
    case "conflict-resolution-exhausted":
      defect = established(
        "mechanical",
        "conflict-resolution-allowance",
        "Native integration encountered another conflict after the retained resolution allowance was consumed. Classification does not renew it.",
      );
      break;
    case "rebase-conflict":
      defect = diagnostics
        ? established(
            "mechanical",
            "git-integration-conflict",
            "The native integration failure retained conflict diagnostics. Both parents and the failed integration remain evidence; no semantic resolution is inferred.",
          )
        : unresolved(
            "git-integration-failure",
            "The Git integration failed without captured conflict paths. Its semantic cause is unresolved.",
            references,
          );
      break;
    case "provider-unavailable":
    case "provider-model-refused":
      defect = established(
        "environment-tooling",
        effectiveReason,
        "The existing provider admission discriminator refused launch. This describes provider availability, not a failed candidate execution or candidate exoneration.",
      );
      break;
    case "author-malformed":
    case "reviewer-malformed":
      defect = established(
        "mechanical",
        "worker-report-protocol",
        "The worker protocol rejected the retained report; no semantic verdict is inferred.",
      );
      break;
    case "author-wrong-head":
    case "author-head-moved":
    case "missing-candidate-commit":
    case "dirty-author":
    case "outside-footprint":
    case "reviewer-wrong-head":
    case "reviewer-modified-worktree":
    case "source-finding-location-outside-candidate":
      defect = established(
        "mechanical",
        effectiveReason,
        `The existing worker/candidate validator rejected its ${effectiveReason} contract. The retained terminal and stage evidence identify the rejected output; no semantic worker verdict is invented.`,
      );
      break;
    case "issue-observation-unavailable":
    case "hosted-observation-unavailable":
    case "learning-note-state-unknown":
      defect =
        diagnostics === "GitHub connection failed before send" ||
        diagnostics === "GitHub transport response unavailable"
          ? established(
              "environment-tooling",
              diagnostics === "GitHub connection failed before send"
                ? "github-connection-before-send"
                : "github-transport-response",
              "The retained GithubCommandFailure category establishes transport failure, not a semantic candidate failure.",
            )
          : diagnostics === "malformed issue observation"
            ? established(
                "mechanical",
                "github-issue-response-protocol",
                "The acquired issue response failed the existing parser or shape checks.",
              )
            : unresolved(
                `stop:${effectiveReason}`,
                "The retained typed outcome and source evidence do not establish a semantic cause. This unresolved classification neither exonerates the candidate nor changes disposition.",
                references,
              );
      break;
    default:
      defect = unresolved(
        hosted ? "hosted-gate-cause-unresolved" : `stop:${effectiveReason}`,
        "The retained typed outcome and source evidence do not establish a semantic cause. This unresolved classification neither exonerates the candidate nor changes disposition.",
        references,
      );
  }
  const binding = async (path: string) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  });
  return retainOutcome(
    { ...context, issue: attempt?.issue ?? context.issue, stateDirectory: directory },
    {
      kind: "stop",
      identity,
      head: stageHead ?? null,
      terminal: {
        stop: terminal,
        attempt: attempt ? await binding(resolve(attemptDirectory, "attempt.json")) : null,
        stage: await binding(stagePath),
        diagnostics: diagnostics?.slice(0, 1000) ?? null,
      },
      defect,
    },
    // Keep the record beside the owning stop/cursor, while binding the actual
    // stage above. Setup's closed inventory and completed attempts stay intact.
    storageDirectory,
  );
}
