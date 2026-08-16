export const formatterTargets: readonly string[];

export function validateFormatterInputs(paths: readonly string[]): Promise<void>;

export function runPinnedPrettier(
  mode: "check" | "write",
  targets?: readonly string[],
): Promise<{ stdout: string; stderr: string }>;
