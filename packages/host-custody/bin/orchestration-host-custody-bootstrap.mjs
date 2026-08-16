#!/usr/bin/env node
import { runStaticCommandRegistry } from "../../../scripts/lib/static-command-runner.mjs";
import { hostCustodyBootstrapCommandRegistry } from "../src/bootstrap-command-registry.mjs";

process.exitCode = runStaticCommandRegistry({
  argv: process.argv.slice(2),
  registrations: hostCustodyBootstrapCommandRegistry,
  commandDepth: 1,
});
