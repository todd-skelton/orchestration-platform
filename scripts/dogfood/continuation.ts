import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, win32 } from "node:path";
// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked } from "./flow.ts";

type Command = { executable: string; args: string[] };
export interface PreReviewEvidence {
  receiptSchema: "dogfood-host-verification/v1";
  workspace: string;
  gate: string;
  command: Command;
  bundle: { receipt: string; runMetadata: string; preflightLog: string; verifierLog: string };
  files: number;
  tests: number;
  skips: 0;
  requiredCases: string[];
}
export interface AcceptedReplan {
  schemaVersion: "dogfood-accepted-replan/v1";
  repository: string;
  issueKey: string;
  issueUrl: string;
  priorRun: string;
  priorAttemptDirectory: string;
  priorAbsoluteAttempt: number;
  priorHistoryDigest: string;
  candidateHead: string;
  targetRun: string;
  attemptSlug: string;
  nextAbsoluteAttempt: number;
  absoluteCeiling: number;
  authorityUrl: string;
  scope: string;
  allowedPaths: string[];
  publication: { number: number; url: string; head: string; sourceBranch: string } | null;
  preReviewEvidence: PreReviewEvidence | null;
}

function requireThat(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new QueueBlocked(reason);
}
function exact(value: unknown, keys: string): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.split(" ").length &&
    keys.split(" ").every((key) => Object.hasOwn(value, key))
  );
}
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
const name = (value: unknown): value is string =>
  typeof value === "string" && /^[\w.-]{1,64}$/.test(value) && ![".", ".."].includes(value);
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const absolute = (value: unknown): value is string =>
  text(value) && isAbsolute(value) && resolve(value) === value;
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
function command(value: unknown): value is Command {
  return (
    exact(value, "executable args") &&
    text(value.executable) &&
    Array.isArray(value.args) &&
    value.args.every((arg: unknown) => typeof arg === "string" && !arg.includes("\0"))
  );
}
export function validateCorrectionPaths(value: unknown): asserts value is string[] {
  requireThat(
    strings(value) &&
      value.length > 0 &&
      value.every(
        (path) =>
          !isAbsolute(path) &&
          !win32.isAbsolute(path) &&
          !/[\\:*?\[\]{}\x00-\x1f]/.test(path) &&
          path
            .split("/")
            .every(
              (part) =>
                part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git",
            ),
      ),
    "invalid-accepted-replan-paths",
  );
}
export function validatePreReviewEvidence(value: unknown): asserts value is PreReviewEvidence {
  const reason = "invalid-accepted-replan-evidence";
  requireThat(
    exact(value, "receiptSchema workspace gate command bundle files tests skips requiredCases"),
    reason,
  );
  requireThat(
    value.receiptSchema === "dogfood-host-verification/v1" &&
      text(value.workspace) &&
      text(value.gate) &&
      command(value.command) &&
      exact(value.bundle, "receipt runMetadata preflightLog verifierLog") &&
      Object.values(value.bundle).every(absolute) &&
      new Set(Object.values(value.bundle)).size === 4 &&
      count(value.files) &&
      value.files > 0 &&
      count(value.tests) &&
      value.tests > 0 &&
      value.skips === 0 &&
      strings(value.requiredCases) &&
      value.requiredCases.length > 0 &&
      value.requiredCases.length <= value.tests,
    reason,
  );
}
export function validateAcceptedReplan(value: unknown): asserts value is AcceptedReplan {
  const reason = "invalid-accepted-replan";
  requireThat(
    exact(
      value,
      "schemaVersion repository issueKey issueUrl priorRun priorAttemptDirectory priorAbsoluteAttempt priorHistoryDigest candidateHead targetRun attemptSlug nextAbsoluteAttempt absoluteCeiling authorityUrl scope allowedPaths publication preReviewEvidence",
    ),
    reason,
  );
  requireThat(
    value.schemaVersion === "dogfood-accepted-replan/v1" &&
      typeof value.repository === "string" &&
      /^[\w.-]+\/[\w.-]+$/.test(value.repository) &&
      name(value.issueKey) &&
      typeof value.issueUrl === "string" &&
      value.issueUrl.startsWith(`https://github.com/${value.repository}/issues/`) &&
      /^[1-9]\d*$/.test(value.issueUrl.split("/").at(-1)!) &&
      name(value.priorRun) &&
      absolute(value.priorAttemptDirectory) &&
      name(value.targetRun) &&
      value.targetRun !== value.priorRun &&
      name(value.attemptSlug) &&
      value.attemptSlug.endsWith("-attempt-5") &&
      value.priorAbsoluteAttempt === 4 &&
      value.nextAbsoluteAttempt === value.priorAbsoluteAttempt + 1 &&
      value.absoluteCeiling === value.nextAbsoluteAttempt &&
      sha(value.candidateHead) &&
      digest(value.priorHistoryDigest) &&
      text(value.scope) &&
      typeof value.authorityUrl === "string" &&
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/[1-9]\d*#issuecomment-[1-9]\d*$/.test(
        value.authorityUrl,
      ),
    reason,
  );
  validateCorrectionPaths(value.allowedPaths);
  if (value.publication !== null) {
    const p = value.publication;
    requireThat(
      exact(p, "number url head sourceBranch") &&
        count(p.number) &&
        p.number > 0 &&
        p.url === `https://github.com/${value.repository}/pull/${p.number}` &&
        p.head === value.candidateHead &&
        text(p.sourceBranch),
      reason,
    );
  }
  if (value.preReviewEvidence !== null) validatePreReviewEvidence(value.preReviewEvidence);
}
export function continuationSlug(packet: AcceptedReplan) {
  return packet.attemptSlug;
}

// ISS-167: one same-run integration of an exhausted reviewed source. The packet names
// the retained attempt, its terminal marker, the reviewed head/review and the ruled fence.
export interface IntegrationContinuation {
  schemaVersion: "dogfood-integration-continuation/v1";
  repository: string;
  issueKey: string;
  issueUrl: string;
  run: string;
  attemptDirectory: string;
  absoluteAttempt: number;
  stopMarker: string;
  candidateHead: string;
  reviewId: string;
  authorityUrl: string;
  allowedPaths: string[];
}
export function validateIntegrationContinuation(
  value: unknown,
): asserts value is IntegrationContinuation {
  const reason = "invalid-integration-continuation";
  requireThat(
    exact(
      value,
      "schemaVersion repository issueKey issueUrl run attemptDirectory absoluteAttempt stopMarker candidateHead reviewId authorityUrl allowedPaths",
    ),
    reason,
  );
  requireThat(
    value.schemaVersion === "dogfood-integration-continuation/v1" &&
      typeof value.repository === "string" &&
      /^[\w.-]+\/[\w.-]+$/.test(value.repository) &&
      name(value.issueKey) &&
      typeof value.issueUrl === "string" &&
      value.issueUrl.startsWith(`https://github.com/${value.repository}/issues/`) &&
      /^[1-9]\d*$/.test(value.issueUrl.split("/").at(-1)!) &&
      name(value.run) &&
      absolute(value.attemptDirectory) &&
      count(value.absoluteAttempt) &&
      value.absoluteAttempt > 0 &&
      typeof value.stopMarker === "string" &&
      /^loop-stop:[\w.-]{1,64}:[1-9]\d*:[1-9]\d*$/.test(value.stopMarker) &&
      value.stopMarker.split(":")[1] === value.run &&
      sha(value.candidateHead) &&
      typeof value.reviewId === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(value.reviewId) &&
      typeof value.authorityUrl === "string" &&
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/[1-9]\d*#issuecomment-[1-9]\d*$/.test(
        value.authorityUrl,
      ),
    reason,
  );
  try {
    validateCorrectionPaths(value.allowedPaths);
  } catch {
    throw new QueueBlocked(reason);
  }
}

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
// JSON.parse alone silently accepts duplicated authority fields. Check each object,
// including escaped key spellings, before consuming an external host receipt.
function parseHostJson(bytes: Buffer) {
  const source = bytes.toString("utf8");
  const result = JSON.parse(source);
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g) ?? [];
  const stack: (Set<string> | null)[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const keys = stack.at(-1)!;
      const key = JSON.parse(token);
      requireThat(keys && !keys.has(key), "operator-evidence-authority");
      keys.add(key);
    }
  }
  return result;
}
const resultKeys = "repository head workspace gate command runId exitCode files tests skips cases";
function validResult(value: Record<string, any>) {
  return (
    text(value.repository) &&
    sha(value.head) &&
    text(value.workspace) &&
    text(value.gate) &&
    command(value.command) &&
    text(value.runId) &&
    Number.isSafeInteger(value.exitCode) &&
    count(value.files) &&
    count(value.tests) &&
    count(value.skips) &&
    strings(value.cases)
  );
}
function sameCommand(a: Command, b: Command) {
  return a.executable === b.executable && JSON.stringify(a.args) === JSON.stringify(b.args);
}

export async function retainPreReviewEvidence(
  directory: string,
  repository: string,
  head: string,
  descriptor: PreReviewEvidence,
): Promise<string> {
  const snapshot = resolve(directory, "pre-review-evidence");
  const acceptancePath = resolve(snapshot, "acceptance.json");
  let acceptance: any;
  try {
    acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!acceptance) {
    let bundle: Record<string, Buffer>;
    try {
      bundle = Object.fromEntries(
        await Promise.all(
          Object.entries(descriptor.bundle).map(async ([name, path]) => [
            name,
            await readFile(path),
          ]),
        ),
      );
    } catch (error) {
      throw new QueueBlocked(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "operator-evidence-required"
          : "operator-evidence-authority",
      );
    }
    try {
      const receipt = parseHostJson(bundle.receipt!);
      const metadata = parseHostJson(bundle.runMetadata!);
      requireThat(
        exact(receipt, `schemaVersion ${resultKeys} artifacts`) &&
          receipt.schemaVersion === descriptor.receiptSchema &&
          validResult(receipt) &&
          exact(metadata, `schemaVersion ${resultKeys}`) &&
          metadata.schemaVersion === "dogfood-host-verification-run/v1" &&
          validResult(metadata),
        "operator-evidence-authority",
      );
      requireThat(
        receipt.repository === repository &&
          receipt.head === head &&
          receipt.workspace === descriptor.workspace &&
          receipt.gate === descriptor.gate &&
          sameCommand(receipt.command, descriptor.command),
        "operator-evidence-authority",
      );
      for (const key of resultKeys.split(" "))
        requireThat(
          key === "command"
            ? sameCommand(receipt.command, metadata.command)
            : JSON.stringify(receipt[key]) === JSON.stringify(metadata[key]),
          "operator-evidence-authority",
        );
      requireThat(
        exact(receipt.artifacts, "runMetadata preflightLog verifierLog") &&
          Object.entries(receipt.artifacts).every(
            ([name, value]) => value === hash(bundle[name]!),
          ) &&
          bundle.preflightLog!.toString("utf8").trim().length > 0 &&
          bundle.verifierLog!.toString("utf8").trim().length > 0,
        "operator-evidence-authority",
      );
      const passed =
        receipt.exitCode === 0 &&
        receipt.files === descriptor.files &&
        receipt.tests === descriptor.tests &&
        receipt.skips === 0 &&
        descriptor.requiredCases.every((identity) => receipt.cases.includes(identity));
      acceptance = {
        schemaVersion: "dogfood-pre-review-acceptance/v1",
        repository,
        head,
        descriptor,
        passed,
        result: Object.fromEntries(resultKeys.split(" ").map((key) => [key, receipt[key]])),
        digests: Object.fromEntries(
          Object.entries(bundle).map(([name, bytes]) => [name, hash(bytes)]),
        ),
      };
    } catch (error) {
      if (error instanceof QueueBlocked) throw error;
      throw new QueueBlocked("operator-evidence-authority");
    }
    await mkdir(directory, { recursive: true });
    const temporary = await mkdtemp(resolve(directory, "pre-review-evidence-"));
    try {
      for (const [name, bytes] of Object.entries(bundle))
        await writeFile(resolve(temporary, name), bytes, { flush: true });
      await writeFile(resolve(temporary, "acceptance.json"), JSON.stringify(acceptance), {
        flush: true,
      });
      await rename(temporary, snapshot);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  requireThat(
    acceptance.head === head && acceptance.repository === repository,
    "operator-evidence-authority",
  );
  requireThat(acceptance.passed, "operator-evidence-failed");
  return `\nExact-head host verification retained at ${acceptancePath}. Inspect this acceptance record and its immutable receipt, runMetadata, preflightLog and verifierLog in ${snapshot}. These are current execution evidence, not a review verdict.\n`;
}
