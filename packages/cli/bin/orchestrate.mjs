#!/usr/bin/env node
import { runStaticCommandRegistry } from "../../../scripts/lib/static-command-runner.mjs";
import { commandRegistry } from "../src/registry.mjs";

process.exitCode = runStaticCommandRegistry({
  argv: process.argv.slice(2),
  registrations: commandRegistry,
  allowGlobalFlags: true,
});
