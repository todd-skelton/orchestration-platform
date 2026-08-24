import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Iss002WalkInput {
  readonly candidateModuleUrl: string;
  readonly childScriptPath: string;
  readonly stableModuleUrl: string;
  readonly workingDirectory: string;
}

export type Iss002WalkResult =
  | {
      readonly ok: true;
      readonly durationsNanoseconds: readonly string[];
      readonly maximumWalkDurationNanoseconds: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function refusal(...issues: readonly string[]): Iss002WalkResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function childEnvironment(workingDirectory: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  for (const key of ["SystemRoot", "WINDIR"])
    if (process.env[key]) environment[key] = process.env[key];
  environment.TEMP = workingDirectory;
  environment.TMP = workingDirectory;
  environment.TMPDIR = workingDirectory;
  environment.LANG = "C";
  environment.LC_ALL = "C";
  environment.TZ = "UTC";
  return environment;
}

function environmentScrubber(environment: NodeJS.ProcessEnv): string {
  const expected = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const source = `const expected=${JSON.stringify(expected)};
for (const key of Object.keys(process.env)) delete process.env[key];
for (const [key,value] of Object.entries(expected)) process.env[key]=value;
`;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function parseChildOutput(
  stdout: string,
  stderr: string,
  index: number,
):
  | { readonly ok: true; readonly duration: string }
  | { readonly ok: false; readonly issues: readonly string[] } {
  if (stderr !== "") return { ok: false, issues: [`walk.${index}:stderr-nonempty`] };
  let input: unknown;
  try {
    input = JSON.parse(stdout);
  } catch {
    return { ok: false, issues: [`walk.${index}:json-refused`] };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return { ok: false, issues: [`walk.${index}:record-required`] };
  const record = input as Readonly<Record<string, unknown>>;
  if (Object.keys(record).sort().join("\0") !== "durationNanoseconds\0issues\0recordCount")
    return { ok: false, issues: [`walk.${index}:field-census-refused`] };
  if (
    record.recordCount !== "1000" ||
    typeof record.durationNanoseconds !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/.test(record.durationNanoseconds) ||
    !Number.isSafeInteger(Number(record.durationNanoseconds)) ||
    !Array.isArray(record.issues) ||
    record.issues.length !== 0
  )
    return { ok: false, issues: [`walk.${index}:result-refused`] };
  if (BigInt(record.durationNanoseconds) > 5_000_000_000n)
    return { ok: false, issues: [`walk.${index}:duration-limit-exceeded`] };
  return { ok: true, duration: record.durationNanoseconds };
}

export async function runIss002WalkIntervals(input: Iss002WalkInput): Promise<Iss002WalkResult> {
  if (!isAbsolute(input.workingDirectory)) return refusal("workingDirectory:absolute-required");
  const durations: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    try {
      const environment = childEnvironment(input.workingDirectory);
      const result = await execFileAsync(
        process.execPath,
        [
          `--import=${environmentScrubber(environment)}`,
          input.childScriptPath,
          input.stableModuleUrl,
          input.candidateModuleUrl,
        ],
        {
          cwd: input.workingDirectory,
          encoding: "utf8",
          env: environment,
          maxBuffer: 1024 * 1024,
          timeout: 15_000,
          windowsHide: true,
        },
      );
      const parsed = parseChildOutput(result.stdout, result.stderr, index);
      if (!parsed.ok) return refusal(...parsed.issues);
      durations.push(parsed.duration);
    } catch {
      return refusal(`walk.${index}:child-failed`);
    }
  }
  return {
    ok: true,
    durationsNanoseconds: Object.freeze(durations),
    maximumWalkDurationNanoseconds: durations.reduce((maximum, value) =>
      BigInt(value) > BigInt(maximum) ? value : maximum,
    ),
  };
}
