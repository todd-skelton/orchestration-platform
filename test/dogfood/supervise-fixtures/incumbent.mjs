// ISS-164 inert copied incumbent seam. Stands in for
// `invoke-heavy-verifier.ps1 -NativeDbProfile 'reconciliation-pg16/v1'
// -NativeRequestPath <request> -Worktree <anchor> -Lane <lane> -Branch <branch>
// -ClaimedHead <head>` and answers through `<request>.reply.json`. It never
// acquires an owner, runs PostgreSQL or produces executed evidence.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [requestPath, worktree, lane, , head] = process.argv.slice(2);
const request = JSON.parse(await readFile(requestPath, "utf8"));
const mode = process.env.INCUMBENT_MODE ?? "completed";
if (mode === "crash") {
  process.stderr.write("synthetic incumbent crashed\n");
  process.exit(7);
}
if (mode === "no-reply") process.exit(0);
const reply = {
  schemaVersion: "dogfood-native-db-reply/v1",
  correlation: mode === "foreign-correlation" ? request.correlation + 1 : request.correlation,
  status: mode === "unknown" ? "unknown" : "completed",
  owner: mode === "unknown" ? null : { lockId: "0123456789abcdef0123456789abcdef", head, lane },
  evidencePath:
    mode === "unknown"
      ? null
      : mode === "outside-anchor"
        ? resolve(worktree, "..", "elsewhere", "evidence")
        : resolve(worktree, ".orchestrator", "native-db", `evidence-${request.correlation}`),
  diagnostic: mode === "unknown" ? "synthetic incumbent could not determine the outcome" : null,
};
await writeFile(`${requestPath}.reply.json`, `${JSON.stringify(reply)}\n`);
