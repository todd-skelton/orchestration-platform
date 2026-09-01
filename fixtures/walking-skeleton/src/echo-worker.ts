import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalDigest,
  computeDispatchContentReference,
  computeDispatchPlanDigest,
  computeWorkerHostIdentityDigest,
  computeWorkerLaunchReceiptDigest,
  serializeContract,
  validateWorkerLaunchReceiptBinding,
  validateWorkerTerminalReceiptBinding,
  type DispatchAllocationClaim,
  type DispatchPlan,
  type DispatchProcessCensus,
  type WorkerLaunchReceipt,
  type WorkerTerminalReceipt,
  type ReclaimProcessObservation,
} from "@orchestration-platform/contracts";

// No imports, shell, descendants, credentials, filesystem or arbitrary input execution.
const source =
  'process.stdin.on("data",b=>process.stdout.write(b));process.stdin.on("end",()=>process.stdout.end());';
const artifactDigest = canonicalDigest({
  source,
  nodeVersion: process.versions.node,
  argumentPolicy: "commonjs-eval-fixed-source",
  environmentPolicy: "windows-systemroot-only",
});
const identity = {
  capabilityNames: ["work.read"],
  hostRendererArtifactDigest: artifactDigest,
  schemaVersion: "worker-host-identity/v1",
};
export const echoMapping = Object.freeze([
  Object.freeze({
    ...identity,
    capabilityNames: Object.freeze(identity.capabilityNames),
    schemaVersion: "worker-host-renderer-artifact/v1",
    workerHostIdentityDigest: computeWorkerHostIdentityDigest(identity),
  }),
]);

export function fixtureId() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const echoResource = (attemptId: string) => ({
  owner: "HOST" as const,
  resourceIdentityDigest: canonicalDigest({ attemptId, resource: "fixture.echo.input" }),
});

async function createOnce(path: string, bytes: Uint8Array) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
const empty: DispatchProcessCensus = { completeness: "COMPLETE", entries: [] };
const unavailable = { stdout: { kind: "UNAVAILABLE" }, stderr: { kind: "UNAVAILABLE" } } as const;

export type EchoBoundary =
  "INPUT_ALLOCATED" | "OWNERSHIP_PUBLISHED" | "CHILD_SPAWNED" | "CHILD_TERMINAL_OBSERVED";
export type EchoLifecycleHooks = Readonly<{
  boundary?: (boundary: EchoBoundary) => void | Promise<void>;
  launched?: (launch: WorkerLaunchReceipt) => void | Promise<void>;
  terminal?: (
    terminal: WorkerTerminalReceipt,
    stdout: Uint8Array,
    stderr: Uint8Array,
    process: ReclaimProcessObservation,
  ) => void | Promise<void>;
}>;

// Private fixed host. Its sole caller owns the full preparation tuple and actual live lease.
// A retained handle/source proves only this direct child, never generic descendant absence.
export async function runEcho(
  root: string,
  plan: DispatchPlan,
  rendered: Uint8Array,
  now: () => string,
  inspect: () => Promise<boolean>,
  hooks: EchoLifecycleHooks = {},
) {
  const resource = echoResource(plan.attemptId);
  if (
    plan.outcome.kind !== "PLANNED" ||
    plan.outcome.credentials.kind !== "NONE" ||
    plan.outcome.hostRendererArtifactDigest !== artifactDigest ||
    plan.outcome.workerHostIdentityDigest !== echoMapping[0]!.workerHostIdentityDigest ||
    canonicalDigest(plan.outcome.resourceIntents) !== canonicalDigest([resource]) ||
    canonicalDigest(plan.outcome.renderedInput) !==
      canonicalDigest(computeDispatchContentReference(rendered))
  )
    throw new Error("fixed echo admission refused");
  const rows: DispatchAllocationClaim[] = [
    { ...resource, allocationId: null, ownerTransactionId: plan.attemptId, state: "NOT_ALLOCATED" },
  ];
  let ownership: WorkerLaunchReceipt["ownership"] = "UNPUBLISHED";
  const launchRecord = (
    outcome: WorkerLaunchReceipt["outcome"],
    processes: DispatchProcessCensus,
    observedAt: string | null,
  ) => {
    const checked = validateWorkerLaunchReceiptBinding(plan, {
      attemptId: plan.attemptId,
      dispatchPlanDigest: computeDispatchPlanDigest(plan),
      observedAt,
      outcome,
      ownership,
      processes,
      resources: rows,
      schemaVersion: "worker-launch-receipt/v1",
    });
    if (!checked.ok) throw new Error(checked.issues.join(","));
    return checked.value;
  };
  const unknownLaunch = () => ({
    launch: launchRecord({ kind: "UNKNOWN", reason: "STARTUP_UNPROVEN" }, empty, null),
    terminal: null,
    stdout: null,
    stderr: null,
    process: null,
    retained: true as const,
  });
  try {
    if (!(await inspect())) return unknownLaunch();
    // The one host allocation is the actual input file, not the read-only project footprint.
    rows[0] = { ...rows[0]!, state: "UNKNOWN" };
    await createOnce(join(root, "echo-input.bin"), rendered);
    rows[0] = { ...rows[0]!, state: "ALLOCATED", allocationId: fixtureId() };
  } catch {
    return unknownLaunch();
  }
  await hooks.boundary?.("INPUT_ALLOCATED");
  try {
    if (!(await inspect())) return unknownLaunch();
    const encoded = serializeContract("dispatch-plan/v1", plan);
    if (!encoded.ok) throw new Error("ownership encoding refused");
    ownership = "UNKNOWN";
    await createOnce(join(root, "echo-ownership.json"), encoded.bytes);
    ownership = "PUBLISHED";
  } catch {
    return unknownLaunch();
  }
  await hooks.boundary?.("OWNERSHIP_PUBLISHED");
  try {
    if (!(await inspect())) return unknownLaunch();
  } catch {
    return unknownLaunch();
  }

  const environment: NodeJS.ProcessEnv = {};
  if (process.platform === "win32" && process.env.SystemRoot)
    environment.SystemRoot = process.env.SystemRoot;
  const processId = fixtureId();
  const census = (state: "LIVE" | "DEAD" | "UNKNOWN"): DispatchProcessCensus => ({
    completeness: state === "UNKNOWN" ? "UNKNOWN" : "COMPLETE",
    entries: [{ parentProcessId: null, processId, state }],
  });
  // Source and arguments are constants; caller bytes go only to stdin.
  const child = spawn(process.execPath, ["--input-type=commonjs", "--eval", source], {
    cwd: root,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return await new Promise<{
    launch: WorkerLaunchReceipt;
    terminal: WorkerTerminalReceipt | null;
    stdout: Uint8Array | null;
    stderr: Uint8Array | null;
    process: ReclaimProcessObservation | null;
    retained: boolean;
  }>((resolve, reject) => {
    let launch: WorkerLaunchReceipt | null = null;
    let settled = false;
    let streamFailure = false;
    const streams = {
      stdout: { parts: [] as Buffer[], length: 0, truncated: false },
      stderr: { parts: [] as Buffer[], length: 0, truncated: false },
    };
    const finish = (value: Parameters<typeof resolve>[0]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(abandon);
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(abandon);
      reject(error);
    };
    const unknownTerminal = () => {
      const prior =
        launch ??
        launchRecord({ kind: "UNKNOWN", reason: "STARTUP_UNPROVEN" }, census("UNKNOWN"), null);
      const checked = validateWorkerTerminalReceiptBinding(plan, prior, null, null, {
        attemptId: plan.attemptId,
        capture: unavailable,
        dispatchPlanDigest: computeDispatchPlanDigest(plan),
        launchReceiptDigest: computeWorkerLaunchReceiptDigest(prior),
        observedAt: null,
        outcome: { kind: "UNKNOWN", reason: "EXIT_UNPROVEN" },
        processes: census("UNKNOWN"),
        schemaVersion: "worker-terminal-receipt/v1",
      });
      finish({
        launch: prior,
        terminal: checked.ok ? checked.value : null,
        stdout: null,
        stderr: null,
        process: null,
        retained: true,
      });
    };
    let abandon: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      child.kill();
      abandon = setTimeout(unknownTerminal, 1000);
    }, 10000);
    for (const key of ["stdout", "stderr"] as const) {
      child[key].on("error", () => {
        streamFailure = true;
      });
      child[key].on("data", (bytes: Buffer) => {
        const stream = streams[key],
          remaining = 1048576 - stream.length;
        const part = Buffer.from(bytes.subarray(0, remaining));
        stream.parts.push(part);
        stream.length += part.length;
        if (bytes.length > remaining) stream.truncated = true;
      });
    }
    child.stdin.on("error", () => {
      streamFailure = true;
    });
    child.once("spawn", () => {
      void (async () => {
        try {
          launch = launchRecord({ kind: "LIVE" }, census("LIVE"), now());
          await hooks.boundary?.("CHILD_SPAWNED");
          await hooks.launched?.(launch);
          child.stdin.end(Buffer.from(rendered));
        } catch (error) {
          child.kill();
          fail(error);
        }
      })();
    });
    child.once("error", () => {
      child.kill();
      unknownTerminal();
    });
    child.once("close", async (code, signal) => {
      if (settled) return;
      clearTimeout(timeout);
      clearTimeout(abandon);
      if (!launch || (code === null) === (signal === null)) {
        unknownTerminal();
        return;
      }
      try {
        const stdout = Buffer.concat(streams.stdout.parts),
          stderr = Buffer.concat(streams.stderr.parts);
        const observedAt = now();
        const clockInvalid = launch.observedAt !== null && observedAt < launch.observedAt;
        const checked = validateWorkerTerminalReceiptBinding(
          plan,
          launch,
          streamFailure ? null : stdout,
          streamFailure ? null : stderr,
          {
            attemptId: plan.attemptId,
            capture: streamFailure
              ? unavailable
              : Object.fromEntries(
                  ["stdout", "stderr"].map((key) => {
                    const stream = streams[key as "stdout" | "stderr"];
                    return [
                      key,
                      {
                        kind: stream.truncated ? "TRUNCATED" : "COMPLETE",
                        content: computeDispatchContentReference(
                          key === "stdout" ? stdout : stderr,
                        ),
                      },
                    ];
                  }),
                ),
            dispatchPlanDigest: computeDispatchPlanDigest(plan),
            launchReceiptDigest: computeWorkerLaunchReceiptDigest(launch),
            observedAt,
            outcome: clockInvalid
              ? { kind: "UNKNOWN", reason: "OBSERVATION_INVALID" }
              : {
                  kind: "EXITED",
                  exit: {
                    kind: code === null ? "SIGNAL" : "EXIT_CODE",
                    value: String(code ?? signal),
                  },
                },
            processes: census("DEAD"),
            schemaVersion: "worker-terminal-receipt/v1",
          },
        );
        if (!checked.ok) {
          unknownTerminal();
          return;
        }
        if (streamFailure || clockInvalid) {
          finish({
            launch,
            terminal: checked.value,
            stdout: null,
            stderr: null,
            process: null,
            retained: true,
          });
          return;
        }
        const process: ReclaimProcessObservation = {
          handles: {
            process: "CLOSED",
            stderr: "CLOSED",
            stdin: "CLOSED",
            stdout: "CLOSED",
          },
          kind: "OBSERVED",
          observationId: fixtureId(),
          observedAt,
          processes: checked.value.processes,
        };
        try {
          await hooks.boundary?.("CHILD_TERMINAL_OBSERVED");
          await hooks.terminal?.(checked.value, stdout, stderr, process);
        } catch (error) {
          fail(error);
          return;
        }
        finish({
          launch,
          terminal: checked.value,
          stdout,
          stderr,
          process,
          retained: false,
        });
      } catch {
        unknownTerminal();
      }
    });
  });
}
