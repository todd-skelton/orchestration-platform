// @ts-expect-error Node 24 executes the private TypeScript composition directly.
import { step } from "./flow.ts";
import type { Adapter, Attempt, Config, Role } from "./flow.js";
import type { ReviewFinding } from "./repair-policy.mjs";

export interface RepairHandoff {
  mainBase: string;
  correctiveBase: string;
  acceptanceCriteria: string[];
  sourcePaths: string[];
  failedReview: { findings: ReviewFinding[] };
  predecessorCompleteSweep: string;
  implementation: { attempts: number; ceiling: number };
}

export type RepairConfig = Config;

export interface RepairAdapter {
  dispatch(
    config: RepairConfig,
    handoff: RepairHandoff,
  ): Promise<{ status: string; retries?: number }>;
}

const reviewLocationContract = (reviewPaths: string[]) =>
  `Only findings in changed files drawn from these exact authorized review paths are admissible: ${JSON.stringify(reviewPaths)}. Each path must exist at the reviewed Git head and each line is a valid one-based line at that head.`;

export function sourceReviewerReportPrompt(reviewPaths: string[]) {
  return (
    "The final reviewer report has exactly run, role, head, verdict, findings and g0. " +
    'Use verdict "PASS" or "FAIL" and findings shaped exactly {file,line,severity,text}, where severity is "blocking" or "note". ' +
    'Answer G0, "is there a simpler way?", with a string. A blocking finding requires FAIL; notes never block. ' +
    reviewLocationContract(reviewPaths) +
    " Keep the complete JSON report within 2000 characters."
  );
}

function reviewerReportPrompt(handoff: RepairHandoff) {
  return (
    `This is a DELTA review inheriting complete predecessor ${handoff.predecessorCompleteSweep}. ` +
    `Inspect only the prescribed remedies ${JSON.stringify(handoff.failedReview.findings)} and their direct callers; preserve all acceptance criteria and assertions.\n` +
    "The final reviewer report has exactly run, role, head, verdict, findings and g0. " +
    'Use verdict "PASS" or "FAIL" and findings shaped exactly {file,line,severity,text}, where severity is "blocking" or "note". ' +
    'Answer G0, "is there a simpler way?", with a string. A blocking finding requires FAIL; notes never block. ' +
    reviewLocationContract(handoff.sourcePaths) +
    " Keep the complete JSON report within 2000 characters."
  );
}

function repairPromptAdapter(handoff: RepairHandoff, native: Adapter): Adapter {
  return {
    ...native,
    async launch(role: Role, config: Config, prompt: string): Promise<Attempt> {
      const suffix =
        role === "author"
          ? `Correct only these validated source findings: ${JSON.stringify(handoff.failedReview.findings)}. Start from corrective base ${handoff.correctiveBase}; the distinct delivery main base remains ${handoff.mainBase}. Preserve these acceptance criteria verbatim: ${JSON.stringify(handoff.acceptanceCriteria)}. Authorized exact review paths are ${JSON.stringify(handoff.sourcePaths)}. This is implementation candidate ${handoff.implementation.attempts} of ${handoff.implementation.ceiling}. Author PASS uses an empty summary. On FAIL, use a short actionable summary; never include raw output or environment data.`
          : reviewerReportPrompt(handoff);
      return native.launch(role, config, `${prompt}\n\n${suffix}\n`);
    },
  };
}

export function reviewedRepairAdapter(native: Adapter, controllerRoot: string): RepairAdapter {
  return {
    async dispatch(config, handoff) {
      return step(config, repairPromptAdapter(handoff, native), controllerRoot);
    },
  };
}
