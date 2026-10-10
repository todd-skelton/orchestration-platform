import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
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
export async function retainOutcome(context: OutcomeContext, outcome: Outcome): Promise<string> {
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
  const path = resolve(context.stateDirectory, `outcome-${hash}.json`);
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
  context: OutcomeContext,
  identity: string,
  reason: string,
  terminal: unknown,
  evidence: string,
  head: string | null = null,
) {
  if (reason === "hosted-check-never-executed") return;
  return retainOutcome(context, {
    kind: "stop",
    identity,
    head,
    terminal,
    defect: unresolved(
      `stop:${reason}`,
      "This stop records an unsuccessful stage; its retained evidence does not independently establish a semantic cause. Worker and gate outcome records retain their own causal judgments. No disposition is inferred from the stop reason.",
      [evidence],
    ),
  });
}
