import type { ContractRecord } from "@orchestration-platform/contracts";

import type { ConfigurationLoadResult } from "./loader.js";
import {
  projectConfigurationPaths,
  projectConfigurationProvenance,
  type ConfigurationResolutionSuccess,
} from "./resolver.js";

export interface CommandHandlerInput {
  readonly command: string;
  readonly configuration: ConfigurationResolutionSuccess;
  readonly options: Readonly<Record<string, string | boolean | null>>;
}

export type CommandFailure =
  | Extract<ConfigurationLoadResult, { ok: false }>["error"]
  | Readonly<{
      code: "ADAPTER_CONFIGURATION_REFUSED";
      exitCode: 2;
      message: "adapter configuration refused";
      outcome: "invalid-input";
    }>
  | Readonly<{
      code: "ADAPTER_BINDING_REFUSED";
      exitCode: 3;
      message: "adapter binding refused";
      outcome: "authority-refused";
    }>
  | Readonly<{
      code: "ADAPTER_COMPATIBILITY_REFUSED";
      exitCode: 3;
      message: "adapter compatibility refused";
      outcome: "authority-refused";
    }>
  | Readonly<{
      code: "PROJECT_SNAPSHOT_UNAVAILABLE";
      exitCode: 4;
      message: "project snapshot unavailable";
      outcome: "external-unavailable";
    }>
  | Readonly<{
      code: "PROJECT_SNAPSHOT_UNKNOWN";
      exitCode: 3;
      message: "project snapshot unknown";
      outcome: "authority-unknown";
    }>;
export type CommandHandlerResult =
  Readonly<{ ok: true; result: ContractRecord }> | Readonly<{ ok: false; error: CommandFailure }>;
export type CommandHandler = (input: CommandHandlerInput) => Promise<CommandHandlerResult>;

/** Consumed by the ISS-003 CLI composition; neither discovers paths nor owns output. */
export const configCommandHandler: CommandHandler = async (input) => {
  const projected =
    input.command === "config validate"
      ? projectConfigurationProvenance(input.configuration)
      : input.command === "config paths"
        ? projectConfigurationPaths(input.configuration)
        : null;
  return projected?.ok
    ? Object.freeze({ ok: true, result: projected.value })
    : Object.freeze({
        ok: false,
        error: Object.freeze({
          code: "INTERNAL_ERROR",
          exitCode: 70,
          message: "internal error",
          outcome: "internal-error",
        }),
      });
};
