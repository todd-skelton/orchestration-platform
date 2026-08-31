import type { commandHandlerRegistration } from "@orchestration-platform/config";
import type { commandHandlerRegistration as placeholder } from "@orchestration-platform/session";

export declare const commandRegistry: readonly (
  typeof commandHandlerRegistration | typeof placeholder
)[];
