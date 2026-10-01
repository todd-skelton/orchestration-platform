// Inert `ip` and `pnpm` reached through the real run-loop.sh body. The pnpm
// stand-in is the supervisor: on command it calls the real codexAdapter(...).git
// and launchObserver from the configured dispatch adapter, so every fixture
// process below it enters through production spawn code.
import { writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { peer } from "./peer.mjs";

const [mode, packetPath] = process.argv.slice(2);
const packet = JSON.parse(await readFile(packetPath, "utf8"));
if (mode === "ip") {
  writeSync(1, "default via 127.0.0.1 dev inert\n");
} else {
  const channel = await peer(packet.address, "supervisor", { sentinel: "ISS-219-inert-pnpm" });
  const { codexAdapter, launchObserver } = await import(pathToFileURL(packet.adapter));
  const pending = [];
  for (;;) {
    const command = await channel.next();
    if (command === "helper") {
      pending.push(
        codexAdapter(packet.gitExecutable)
          .git(packet.worktree, ["helper", packet.address, "helper"])
          .then((stdout) => channel.send("helper-reaped", { stdout })),
      );
      channel.send("adapter-called");
    }
    if (command === "observer") {
      await launchObserver(packet.request);
      channel.send("observer-called");
    }
    if (command === "exit") {
      await Promise.all(pending);
      channel.send("exiting");
      process.exit(packet.exitCode ?? 0);
    }
  }
}
