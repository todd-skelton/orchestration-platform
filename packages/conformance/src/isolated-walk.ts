import { types as nodeTypes } from "node:util";
import { isAbsolute } from "node:path";
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

export interface Iss002IsolatedTerminalObservation {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly stdout: string;
}

export interface Iss002IsolationLaunchRequest {
  readonly candidateArtifactPath: string;
  readonly inputText: string;
  readonly rpcRunnerPath: string;
  readonly timeoutMilliseconds: 5000;
}

export interface Iss002StableIsolationAuthority {
  createPrincipal(): Promise<unknown>;
  prepare(principal: unknown, request: Iss002IsolationLaunchRequest): Promise<void>;
  launch(principal: unknown, request: Iss002IsolationLaunchRequest): Promise<unknown>;
  teardownPrincipal(principal: unknown): Promise<void>;
}

export interface Iss002IsolatedWalkRunInput {
  readonly candidateArtifactPath: string;
  readonly rpcRunnerPath: string;
}

export type Iss002IsolatedWalkEvaluation =
  | { readonly ok: true; readonly durationNanoseconds: string }
  | { readonly ok: false; readonly issues: readonly string[] };

export type Iss002IsolatedWalkRunResult =
  | {
      readonly ok: true;
      readonly durationsNanoseconds: readonly string[];
      readonly maximumWalkDurationNanoseconds: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

const monotonicNanoseconds = process.hrtime.bigint.bind(process.hrtime);

function refusal(...issues: readonly string[]): {
  readonly ok: false;
  readonly issues: readonly string[];
} {
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

function detachedTerminalObservation(
  input: unknown,
): Iss002IsolatedTerminalObservation | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ["exitCode", "signal", "stderr", "stdout"] as const;
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
    !(values.exitCode === null || typeof values.exitCode === "number") ||
    !(values.signal === null || typeof values.signal === "string") ||
    typeof values.stderr !== "string" ||
    typeof values.stdout !== "string"
  )
    return undefined;
  return Object.freeze({
    exitCode: values.exitCode,
    signal: values.signal,
    stderr: values.stderr,
    stdout: values.stdout,
  }) as Iss002IsolatedTerminalObservation;
}

function evaluateTerminalObservation(
  observation: Iss002IsolatedTerminalObservation,
): { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] } {
  try {
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
    return { ok: true };
  } catch {
    return refusal("isolated-walk:response-unreadable");
  }
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
    const terminal = evaluateTerminalObservation(observation);
    if (!terminal.ok) return terminal;
    return { ok: true, durationNanoseconds: observation.durationNanoseconds };
  } catch {
    return refusal("isolated-walk:response-unreadable");
  }
}

function detachedRunInput(input: unknown): Iss002IsolatedWalkRunInput | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ["candidateArtifactPath", "rpcRunnerPath"] as const;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string" ||
      !isAbsolute(descriptor.value)
    )
      return undefined;
    values[field] = descriptor.value;
  }
  return Object.freeze({
    candidateArtifactPath: values.candidateArtifactPath,
    rpcRunnerPath: values.rpcRunnerPath,
  }) as Iss002IsolatedWalkRunInput;
}

export async function runIss002IsolatedWalk(
  input: Iss002IsolatedWalkRunInput,
  authority: Iss002StableIsolationAuthority,
): Promise<Iss002IsolatedWalkRunResult> {
  const detached = detachedRunInput(input);
  if (!detached) return refusal("isolated-walk:run-input-refused");
  if (
    authority === null ||
    typeof authority !== "object" ||
    typeof authority.createPrincipal !== "function" ||
    typeof authority.prepare !== "function" ||
    typeof authority.launch !== "function" ||
    typeof authority.teardownPrincipal !== "function"
  )
    return refusal("isolated-walk:authority-refused");
  const createPrincipal = authority.createPrincipal.bind(authority);
  const launch = authority.launch.bind(authority);
  const prepare = authority.prepare.bind(authority);
  const teardownPrincipal = authority.teardownPrincipal.bind(authority);
  const challenge = createIss002WalkChallenge();
  const request = Object.freeze({
    candidateArtifactPath: detached.candidateArtifactPath,
    inputText: challenge.inputText,
    rpcRunnerPath: detached.rpcRunnerPath,
    timeoutMilliseconds: 5000 as const,
  });
  const durations: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    let principal: unknown;
    try {
      principal = await createPrincipal();
    } catch {
      return refusal(`isolated-walk.${index}:principal-create-refused`);
    }
    try {
      await prepare(principal, request);
    } catch {
      try {
        await teardownPrincipal(principal);
      } catch {
        return refusal(`isolated-walk.${index}:principal-teardown-refused`);
      }
      return refusal(`isolated-walk.${index}:preparation-refused`);
    }
    let semantic:
      { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] };
    let durationNanoseconds: string;
    const startedAt = monotonicNanoseconds();
    try {
      const observation = detachedTerminalObservation(await launch(principal, request));
      semantic = observation
        ? evaluateTerminalObservation(observation)
        : refusal(`isolated-walk.${index}:observation-refused`);
    } catch {
      semantic = refusal(`isolated-walk.${index}:launch-refused`);
    }
    durationNanoseconds = (monotonicNanoseconds() - startedAt).toString();
    try {
      await teardownPrincipal(principal);
    } catch {
      return refusal(`isolated-walk.${index}:principal-teardown-refused`);
    }
    if (!semantic.ok)
      return refusal(...semantic.issues.map((issue) => `isolated-walk.${index}.${issue}`));
    if (BigInt(durationNanoseconds) > 5_000_000_000n)
      return refusal(`isolated-walk.${index}:duration-limit-exceeded`);
    durations.push(durationNanoseconds);
  }
  return {
    durationsNanoseconds: Object.freeze(durations),
    maximumWalkDurationNanoseconds: durations.reduce((maximum, value) =>
      BigInt(value) > BigInt(maximum) ? value : maximum,
    ),
    ok: true,
  };
}
