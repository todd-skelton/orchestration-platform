import type { commandHandlerRegistration } from "@orchestration-platform/config";
import type { commandHandlerRegistration as project } from "@orchestration-platform/adapter-sdk";
import type { commandHandlerRegistration as placeholder } from "@orchestration-platform/session";

export declare const commandRegistry: readonly (
  typeof commandHandlerRegistration | typeof project | typeof placeholder
)[];
