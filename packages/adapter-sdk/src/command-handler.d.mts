import type { CommandHandler } from "../../config/src/config-command.js";

export type CommandShape =
  | Readonly<{
      argv: readonly ["project", "snapshot"];
      required: readonly ["--adapter"];
      optional: readonly [];
      resultSchema: "project-facts/v1";
    }>
  | Readonly<{
      argv: readonly ["project", "plan"] | readonly ["project", "apply"];
      required: readonly string[];
      optional: readonly [];
    }>;

export declare const commandHandlerRegistration: Readonly<{
  schemaVersion: "orchestration-command-handler-registration/v1";
  family: "project";
  owner: "@orchestration-platform/adapter-sdk";
  issue: "ISS-013";
  implementation: "implemented";
  handler: CommandHandler;
  commands: readonly CommandShape[];
}>;
