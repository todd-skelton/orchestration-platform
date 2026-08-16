export const formatterTargets: readonly string[];

export interface FormatterInputOptions {
  ignorePath?: string | readonly string[];
}

export function validateFormatterInputs(
  paths: readonly string[],
  options?: FormatterInputOptions,
): Promise<void>;

export function runPinnedPrettier(
  mode: "check" | "write",
  targets?: readonly string[],
): Promise<{ stdout: string; stderr: string }>;
