export interface CommandShape {
  readonly argv: readonly [string, string];
  readonly required: readonly string[];
  readonly optional: readonly { readonly name: string; readonly takesValue: boolean }[];
}

export declare const commandHandlerRegistration: Readonly<{
  schemaVersion: "orchestration-command-handler-registration/v1";
  family: string;
  owner: string;
  issue: string;
  implementation: "placeholder" | "implemented";
  commands: readonly CommandShape[];
}>;
