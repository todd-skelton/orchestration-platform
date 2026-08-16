import { commandHandlerRegistration as config } from "@orchestration-platform/config";
import { commandHandlerRegistration as session } from "@orchestration-platform/session";
import { commandHandlerRegistration as worker } from "@orchestration-platform/dispatch";
import { commandHandlerRegistration as review } from "@orchestration-platform/review";
import { commandHandlerRegistration as journal } from "@orchestration-platform/journal";
import { commandHandlerRegistration as project } from "@orchestration-platform/adapter-sdk";
import { commandHandlerRegistration as release } from "@orchestration-platform/release";
import { commandHandlerRegistration as cycle } from "@orchestration-platform/engine";
import { commandHandlerRegistration as supervisor } from "@orchestration-platform/supervisor";
import { commandHandlerRegistration as credential } from "@orchestration-platform/credentials";

export const commandRegistry = Object.freeze([
  config,
  session,
  worker,
  review,
  journal,
  project,
  release,
  cycle,
  supervisor,
  credential,
]);
