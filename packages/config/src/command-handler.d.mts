import type { CommandHandler } from "./config-command.js";

export interface CommandShape {
  readonly argv: readonly [string, string];
  readonly required: readonly string[];
  readonly optional: readonly { readonly name: string; readonly takesValue: boolean }[];
  readonly resultSchema: "configuration-provenance/v1" | "configuration-paths/v1";
}

export declare const commandHandlerRegistration: Readonly<{
  schemaVersion: "orchestration-command-handler-registration/v1";
  family: string;
  owner: string;
  issue: string;
  implementation: "implemented";
  handler: CommandHandler;
  commands: readonly CommandShape[];
}>;
