#!/usr/bin/env node
import { runStaticCommandRegistry } from "../../scripts/lib/static-command-runner.mjs";
import { bootstrapCommandRegistry } from "../src/command-registry.mjs";

process.exitCode = runStaticCommandRegistry({
  argv: process.argv.slice(2),
  registrations: bootstrapCommandRegistry,
  commandDepth: 1,
});
