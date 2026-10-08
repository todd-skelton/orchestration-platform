// ISS-245: observation only. This module never composes a queue or reserves it.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadPlanningSnapshot, validatePlanningSnapshot } from "../planning/check.mjs";
import { issueContext } from "../../adapters/self.mjs";
import {
  evaluateTerminalAttempt,
  queueDigest,
  validateLoopConfig,
  validateLoopExecutor,
} from "./queue.ts";

const exec = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function admissionPreflight(configPath) {
  const receipt = {
    schemaVersion: "dogfood-terminal-admission-preflight/v1",
    observedAt: new Date().toISOString(),
    executorHead: null,
    configPath: resolve(configPath),
    configSha256: null,
    configDigest: null,
    packetDigest: null,
    repository: null,
    run: null,
    issue: null,
    selection: null,
    evidence: [],
    probes: [],
    disposition: "refused",
    reason: null,
  };
  const audit = { evidence: receipt.evidence, probes: receipt.probes };
  try {
    const bytes = await readFile(receipt.configPath);
    receipt.configSha256 = hash(bytes);
    const config = JSON.parse(bytes);
    receipt.configDigest = queueDigest(config);
    receipt.packetDigest = queueDigest(config.terminalAttemptAdmission ?? null);
    receipt.repository = config.repository;
    receipt.run = config.run;
    receipt.issue = config.terminalAttemptAdmission?.issueUrl ?? null;
    validateLoopConfig(config);
    if (config.terminalAttemptAdmission?.schemaVersion !== "dogfood-terminal-attempt-admission/v2")
      throw new Error("invalid-terminal-attempt-admission");
    const executingRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const git = async (root, args) =>
      (
        await exec(config.gitExecutable, ["--no-optional-locks", "-C", root, ...args], {
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
        })
      ).stdout;
    receipt.executorHead = (await git(executingRoot, ["rev-parse", "HEAD"])).trim();
    await validateLoopExecutor(config, executingRoot, true);
    let base;
    try {
      base = (await git(config.stableExecutorRoot, ["ls-remote", "origin", "refs/heads/main"]))
        .trim()
        .split(/\s+/)[0];
      if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("absent main");
      await git(config.stableExecutorRoot, ["cat-file", "-e", `${base}^{commit}`]);
    } catch {
      throw new Error("current-main-unavailable");
    }
    const pinned = {
      revision: base,
      async git(args) {
        let value;
        try {
          value = await git(config.stableExecutorRoot, args);
        } catch {
          throw new Error("current-main-unavailable");
        }
        receipt.evidence.push({ repository: config.stableExecutorRoot, args, sha256: hash(value) });
        return value;
      },
    };
    let planning;
    try {
      planning = await loadPlanningSnapshot(config.stableExecutorRoot, pinned);
      validatePlanningSnapshot(planning);
    } catch (error) {
      if (error.message === "current-main-unavailable") throw error;
      throw new Error("queue-internal-error");
    }
    // Prove the remaining context object local before the shared context reader.
    await pinned.git(["show", `${base}:docs/loop.md`]);
    const packet = config.terminalAttemptAdmission;
    if (!planning.roadmap.issues.some((row) => row.key === packet.issueKey))
      throw new Error("selected-issue-unregistered");
    const selection = {
      key: packet.issueKey,
      number: Number(packet.issueUrl.split("/").at(-1)),
      base,
      planningRevision: base,
    };
    receipt.selection = selection;
    await issueContext({
      repository: config.repository,
      executorRoot: config.stableExecutorRoot,
      ...selection,
      gitExecutable: config.gitExecutable,
    });
    const evaluated = await evaluateTerminalAttempt(
      config,
      selection,
      [],
      undefined,
      undefined,
      undefined,
      audit,
    );
    const reservation = evaluated.reservation;
    const history = reservation.initialHistory;
    receipt.accounting = {
      rawTerminalHistoryDigest: packet.terminalHistoryDigest,
      effectiveHistoryDigest: queueDigest(history),
      restored: reservation.historyAccounting ?? [],
      count: history.length,
      counts: Object.fromEntries(
        [...new Set(history.map((p) => p.item.replace(/:[1-9]\d*$/, "")))].map((key) => [
          key,
          history.filter((p) => p.item.replace(/:[1-9]\d*$/, "") === key).length,
        ]),
      ),
      authorFailures: reservation.authorFailures,
      inheritedWorkerRetry: reservation.inheritedWorkerRetry,
      correctionUsed: reservation.correctionUsed,
      resolutionUsed: reservation.resolutionUsed,
      reviewerRung: reservation.reviewerRung,
    };
    // Replay captures are historical, explicitly distinct from fresh probes.
    receipt.reservation = {
      path: resolve(config.stateRoot, `${evaluated.name}.json`),
      digest: queueDigest(reservation),
      authority: reservation.authority,
      receipt: reservation.receipt,
      issue: reservation.issue,
    };
    receipt.disposition = evaluated.replay ? "replay" : "eligible";
  } catch (error) {
    receipt.reason = error.reason ?? error.message;
  }
  if (audit.accounting) receipt.retainedHistory = audit.accounting;
  receipt.observationEnd = new Date().toISOString();
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt =
    process.argv.length === 3
      ? await admissionPreflight(process.argv[2])
      : {
          schemaVersion: "dogfood-terminal-admission-preflight/v1",
          observedAt: new Date().toISOString(),
          disposition: "refused",
          reason: "expected one loop config path",
        };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.disposition === "refused" ? 1 : 0;
}
