// The absolute inert executable on the real spawn paths. As the adapter's Git
// executable it receives `-C <worktree>` exactly as codexAdapter(...).git sends
// it; as the observed worker it receives only the dispatch allowlist. It never
// contacts GitHub, a provider or credentials.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { identity, peer } from "./peer.mjs";

const argv = process.argv.slice(2);
const args = argv[0] === "-C" ? argv.slice(2) : argv;
const [mode, address, name = mode] = args;
const channel = await peer(address, name, {
  sentinel: "ISS-219-inert-actor",
  argv,
  // Proves the worker allowlist and the wrapper's injection never reach here.
  forbiddenPresent: [
    "ORCHESTRATION_CGROUP_ROOT",
    "BASH_ENV",
    "OWNERSHIP_TEST_RECORDS",
    "OWNERSHIP_TEST_WITNESS",
    "CODEX_PROVIDER_AUTH_COMMAND",
  ].some((key) => key in process.env),
});
if (mode === "helper" || mode === "worker") {
  // helper: a held grandchild in the inherited group, orphaned when the helper
  // exits on handshake. worker: a held descendant in its own session (setsid).
  spawn(process.execPath, [fileURLToPath(import.meta.url), "held", address, `${name}-grandchild`], {
    detached: mode === "worker",
    stdio: "ignore",
  }).unref();
}
for (;;) {
  const command = await channel.next();
  if (command === "identity") channel.send("identity", { identity: await identity() });
  if (command === "parent") channel.send("parent", { identity: await identity(process.ppid) });
  if (command === "exit") {
    channel.send("exiting");
    process.exit(0);
  }
}
