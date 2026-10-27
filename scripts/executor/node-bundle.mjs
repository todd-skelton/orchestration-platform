// ISS-272: offline verification only. Installation remains host-owned.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const staging = "/root/orchestration-m1/staging/iss-272-node-v24.16.0";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const checkedBundle = JSON.parse(await readFile(new URL("./node-bundle.json", import.meta.url)));

// The explicit directory and bundle arguments support synthetic, offline fixtures.
export async function verifyNodeBundle(directory, bundle) {
  const receiptPath = resolve(directory, "receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  for (const [field, expected] of [
    ["schema", "iss-272-node-receipt/v1"],
    ["version", bundle.version],
    ["archive", bundle.archive],
    ["manifest", "SHASUMS256.txt"],
    ["archiveSha256", bundle.archiveSha256],
  ]) {
    if (receipt[field] !== expected) throw new Error(`${receiptPath}: ${field} mismatch`);
  }
  const manifestPath = resolve(directory, "SHASUMS256.txt");
  const manifest = await readFile(manifestPath);
  if (sha256(manifest) !== receipt.manifestSha256)
    throw new Error(`${manifestPath}: receipt digest mismatch`);
  const matching = manifest
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => /^([a-f0-9]{64})  (\S+)$/.exec(line))
    .filter((line) => line?.[2] === bundle.archive);
  if (matching.length !== 1 || matching[0][1] !== bundle.archiveSha256)
    throw new Error(`${manifestPath}: expected one matching archive digest`);
  const archivePath = resolve(directory, bundle.archive);
  if (sha256(await readFile(archivePath)) !== bundle.archiveSha256)
    throw new Error(`${archivePath}: archive digest mismatch`);
  return { version: bundle.version, archive: archivePath, archiveSha256: bundle.archiveSha256 };
}

// Named real-staging evidence command (not part of the committed test suite):
// node scripts/executor/node-bundle.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("node-bundle.mjs accepts no arguments");
  console.log(JSON.stringify(await verifyNodeBundle(staging, checkedBundle)));
}
