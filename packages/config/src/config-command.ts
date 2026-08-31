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

export type CommandFailure = Extract<ConfigurationLoadResult, { ok: false }>["error"];
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
