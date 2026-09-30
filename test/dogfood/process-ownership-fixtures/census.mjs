// Runs the actual collector in a fresh process with exactly one perturbation
// injected around the census through the module's own fs/promises binding.
// Success controls use the unmodified reader and real kernel stat bytes.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, packetPath, output] = process.argv.slice(2);
const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
const original = fs.readFile;
let reads = 0;
let membershipReads = 0;
fs.readFile = async function (path, ...rest) {
  const value = await original.call(this, path, ...rest);
  if (
    packet.change === "membership" &&
    String(path) === resolve(packet.cgroupPath, "cgroup.procs")
  ) {
    // Churn between samples: a live outsider joins for the second sample only.
    membershipReads += 1;
    return membershipReads === 2 ? `${value}${packet.outsider}\n` : value;
  }
  if (String(path) !== `/proc/${packet.pid}/stat`) return value;
  reads += 1;
  if (packet.change === "record-omission" && reads === 1)
    await fs.rename(packet.bindingPath, `${packet.bindingPath}.omitted`);
  if (packet.change === "unreadable" && reads === 1) {
    fs.readFile = async function (next, ...more) {
      if (String(next) === String(path))
        throw Object.assign(new Error("fixture secret never published"), { code: "EACCES" });
      return original.call(this, next, ...more);
    };
    syncBuiltinESMExports();
  }
  if (packet.change === "starttime" && reads === 2) {
    // Same PID, next sample: a reused PID with another start tick.
    const close = value.lastIndexOf(")");
    const fields = value
      .slice(close + 1)
      .trim()
      .split(/\s+/);
    fields[19] = String(BigInt(fields[19]) + 1n);
    return `${value.slice(0, close + 1)} ${fields.join(" ")}\n`;
  }
  return value;
};
syncBuiltinESMExports();
const { observeProcessOwnership } = await import(pathToFileURL(modulePath));
const observation = await observeProcessOwnership(packet.stateRoot, packet.run);
await fs.writeFile(output, JSON.stringify({ change: packet.change, reads, observation }));
