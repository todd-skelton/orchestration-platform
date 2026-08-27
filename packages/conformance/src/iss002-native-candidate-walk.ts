import { lstat, mkdtemp, readdir, rm, rmdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { types as nodeTypes } from "node:util";
import { consumeConformanceCandidateMaterialization } from "./candidate-materialization.js";
import {
  bundleIss002ContractsCandidate,
  runIss002WalkIntervals,
  type Iss002WalkResult,
} from "./walk.js";

const stableRoot = resolve(import.meta.dirname, "../../..");
const childScriptPath = resolve(import.meta.dirname, "iss002-walk-child.mjs");

export interface Iss002NativeCandidateWalkInput {
  readonly candidateSourceRoot: string;
  readonly candidateSubject: unknown;
  readonly executionParent: string;
  readonly materializationParent: string;
}

function refusal(issue: string): Iss002WalkResult {
  return Object.freeze({ issues: Object.freeze([issue]), ok: false as const });
}

function detached(input: unknown): Iss002NativeCandidateWalkInput | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const fields = [
    "candidateSourceRoot",
    "candidateSubject",
    "executionParent",
    "materializationParent",
  ] as const;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).sort().join("\0") !== [...fields].sort().join("\0"))
    return undefined;
  const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    value[field] = descriptor.value;
  }
  if (
    typeof value.candidateSourceRoot !== "string" ||
    typeof value.executionParent !== "string" ||
    typeof value.materializationParent !== "string" ||
    !isAbsolute(value.candidateSourceRoot) ||
    !isAbsolute(value.executionParent) ||
    !isAbsolute(value.materializationParent)
  )
    return undefined;
  return Object.freeze({
    candidateSourceRoot: value.candidateSourceRoot,
    candidateSubject: value.candidateSubject,
    executionParent: value.executionParent,
    materializationParent: value.materializationParent,
  });
}

export async function runIss002NativeCandidateWalk(
  inputValue: Iss002NativeCandidateWalkInput,
): Promise<Iss002WalkResult> {
  const input = detached(inputValue);
  if (!input) return refusal("candidate-walk:input-refused");
  let executionRoot: string | undefined;
  let candidateModule: string | undefined;
  let stableModule: string | undefined;
  let result: Iss002WalkResult = refusal("candidate-walk:preparation-refused");
  try {
    const parent = await lstat(input.executionParent);
    if (!parent.isDirectory() || parent.isSymbolicLink()) return result;
    executionRoot = await mkdtemp(resolve(input.executionParent, "orchestration-candidate-walk-"));
    candidateModule = resolve(executionRoot, "candidate-contracts.mjs");
    stableModule = resolve(executionRoot, "stable-contracts.mjs");
    await bundleIss002ContractsCandidate(stableRoot, stableModule);
    const materialized = await consumeConformanceCandidateMaterialization(
      input.candidateSourceRoot,
      input.materializationParent,
      input.candidateSubject,
      async (root) => await bundleIss002ContractsCandidate(root, candidateModule!),
    );
    if (!materialized.ok) result = refusal("candidate-walk:materialization-refused");
    else if (
      (await readdir(executionRoot)).sort().join("\0") !==
      "candidate-contracts.mjs\0stable-contracts.mjs"
    )
      result = refusal("candidate-walk:artifact-census-refused");
    else
      result = await runIss002WalkIntervals({
        candidateModuleUrl: pathToFileURL(candidateModule).href,
        childScriptPath,
        stableModuleUrl: pathToFileURL(stableModule).href,
        workingDirectory: executionRoot,
      });
  } catch {
    result = refusal("candidate-walk:preparation-refused");
  }
  if (candidateModule && stableModule && executionRoot)
    try {
      await rm(candidateModule, { force: true });
      await rm(stableModule, { force: true });
      await rmdir(executionRoot);
    } catch {
      return refusal("candidate-walk:cleanup-refused");
    }
  return result;
}
