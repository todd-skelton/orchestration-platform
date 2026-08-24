import { types as nodeTypes } from "node:util";
import {
  computeAuthorityHistoryRecordDigest,
  type ContractRecord,
} from "@orchestration-platform/contracts";

export interface Iss002WalkChallenge {
  readonly inputText: string;
}

export interface Iss002IsolatedProcessObservation {
  readonly durationNanoseconds: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly stdout: string;
}

export type Iss002IsolatedWalkEvaluation =
  | { readonly ok: true; readonly durationNanoseconds: string }
  | { readonly ok: false; readonly issues: readonly string[] };

function refusal(...issues: readonly string[]): Iss002IsolatedWalkEvaluation {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function digest(digit: string): string {
  return digit.repeat(64);
}

export function createIss002WalkChallenge(): Iss002WalkChallenge {
  const globalIdentityDigest = digest("a");
  const records: ContractRecord[] = [
    {
      genesisBootstrapInputDigest: digest("1"),
      globalIdentityDigest,
      ordinal: "0",
      predecessorKind: "GENESIS_LITERAL",
      recordKind: "GENESIS",
      schemaVersion: "authority-history-record/v1",
      successorCoreDigest: digest("2"),
    },
  ];
  let priorDigest = computeAuthorityHistoryRecordDigest(records[0]);
  for (let index = 1; index < 1000; index += 1) {
    const record: ContractRecord = {
      globalIdentityDigest,
      ordinal: String(index),
      predecessorKind: "RECORD",
      priorHeadOrdinal: String(index - 1),
      priorRecordDigest: priorDigest,
      recordKind: "ROTATION",
      retiringAuthorityPathInstanceDigest: digest("3"),
      retiringAuthorityReceiptDigest: digest("4"),
      retiringAuthorityTipDigest: digest("5"),
      retiringAuthorityValueDigest: digest("6"),
      rotationInputDigest: digest("7"),
      schemaVersion: "authority-history-record/v1",
      successorCoreDigest: digest("8"),
    };
    records.push(record);
    priorDigest = computeAuthorityHistoryRecordDigest(record);
  }
  const selectedAuthorityValue: ContractRecord = {
    activeReleasePathInstanceDigest: digest("1"),
    activeReleaseReceiptDigest: digest("2"),
    activeReleaseTipDigest: digest("3"),
    activeReleaseValueDigest: digest("4"),
    admittedCustodyObservationDigest: digest("5"),
    authorityOrdinal: "999",
    custodyInstanceDigest: digest("6"),
    globalIdentityDigest,
    headOrdinal: "999",
    headRecordDigest: priorDigest,
    helperAbiDigest: digest("7"),
    helperDigest: digest("8"),
    helperProfileDigest: digest("9"),
    installationId: "018f0f4d-7b2d-7a11-aa2b-123456789abc",
    lockProfileDigest: digest("a"),
    priorAuthorityReceiptDigest: digest("b"),
    priorAuthorityTipDigest: digest("c"),
    priorAuthorityValueDigest: digest("d"),
    projectId: "018f0f4d-7b2d-7a11-ba2b-123456789abc",
    schemaVersion: "state-mutation-authority-value/v1",
    stateComponentProfileDigest: digest("e"),
    stateRootDigest: digest("f"),
  };
  return Object.freeze({
    inputText: JSON.stringify({ records, selectedAuthorityValue }),
  });
}

function detachedObservation(input: unknown): Iss002IsolatedProcessObservation | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ["durationNanoseconds", "exitCode", "signal", "stderr", "stdout"] as const;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    values[field] = descriptor.value;
  }
  if (
    typeof values.durationNanoseconds !== "string" ||
    !(values.exitCode === null || typeof values.exitCode === "number") ||
    !(values.signal === null || typeof values.signal === "string") ||
    typeof values.stderr !== "string" ||
    typeof values.stdout !== "string"
  )
    return undefined;
  return Object.freeze({
    durationNanoseconds: values.durationNanoseconds,
    exitCode: values.exitCode,
    signal: values.signal,
    stderr: values.stderr,
    stdout: values.stdout,
  }) as Iss002IsolatedProcessObservation;
}

export function evaluateIss002IsolatedWalk(
  observationInput: unknown,
): Iss002IsolatedWalkEvaluation {
  try {
    const observation = detachedObservation(observationInput);
    if (!observation) return refusal("isolated-walk:observation-refused");
    if (
      !/^(?:0|[1-9][0-9]*)$/.test(observation.durationNanoseconds) ||
      !Number.isSafeInteger(Number(observation.durationNanoseconds))
    )
      return refusal("isolated-walk:duration-refused");
    if (BigInt(observation.durationNanoseconds) > 5_000_000_000n)
      return refusal("isolated-walk:duration-limit-exceeded");
    if (observation.exitCode !== 0 || observation.signal !== null)
      return refusal("isolated-walk:terminal-status-refused");
    if (Buffer.byteLength(observation.stderr, "utf8") > 4 * 1024 * 1024)
      return refusal("isolated-walk:stderr-length-refused");
    if (observation.stderr !== "") return refusal("isolated-walk:stderr-nonempty");
    const stdoutByteLength = Buffer.byteLength(observation.stdout, "utf8");
    if (stdoutByteLength === 0 || stdoutByteLength > 4 * 1024 * 1024)
      return refusal("isolated-walk:stdout-length-refused");
    const response = JSON.parse(observation.stdout) as unknown;
    if (response === null || typeof response !== "object" || Array.isArray(response))
      return refusal("isolated-walk:response-record-required");
    const record = response as Readonly<Record<string, unknown>>;
    if (Object.keys(record).sort().join("\0") !== "issues")
      return refusal("isolated-walk:response-field-census-refused");
    if (JSON.stringify(response) !== observation.stdout)
      return refusal("isolated-walk:response-canonical-refused");
    if (!Array.isArray(record.issues) || record.issues.some((issue) => typeof issue !== "string"))
      return refusal("isolated-walk:issues-refused");
    if (record.issues.length !== 0) return refusal("isolated-walk:semantic-failure");
    return { ok: true, durationNanoseconds: observation.durationNanoseconds };
  } catch {
    return refusal("isolated-walk:response-unreadable");
  }
}
