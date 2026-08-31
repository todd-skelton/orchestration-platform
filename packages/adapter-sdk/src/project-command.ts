import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  parseCanonicalContractBytes,
  validateAdapterConfigurationBinding,
  type AdapterConfiguration,
} from "@orchestration-platform/contracts";
import { projectConfigurationProvenance } from "../../config/src/resolver.js";
import type {
  CommandFailure,
  CommandHandler,
  CommandHandlerResult,
} from "../../config/src/config-command.js";
import { createBranchFixtureSnapshot, createQueueFixtureSnapshot } from "./fixtures.js";

const failures = Object.freeze({
  ADAPTER_CONFIGURATION_REFUSED: {
    code: "ADAPTER_CONFIGURATION_REFUSED",
    exitCode: 2,
    message: "adapter configuration refused",
    outcome: "invalid-input",
  },
  ADAPTER_BINDING_REFUSED: {
    code: "ADAPTER_BINDING_REFUSED",
    exitCode: 3,
    message: "adapter binding refused",
    outcome: "authority-refused",
  },
  ADAPTER_COMPATIBILITY_REFUSED: {
    code: "ADAPTER_COMPATIBILITY_REFUSED",
    exitCode: 3,
    message: "adapter compatibility refused",
    outcome: "authority-refused",
  },
  PROJECT_SNAPSHOT_UNAVAILABLE: {
    code: "PROJECT_SNAPSHOT_UNAVAILABLE",
    exitCode: 4,
    message: "project snapshot unavailable",
    outcome: "external-unavailable",
  },
  PROJECT_SNAPSHOT_UNKNOWN: {
    code: "PROJECT_SNAPSHOT_UNKNOWN",
    exitCode: 3,
    message: "project snapshot unknown",
    outcome: "authority-unknown",
  },
  FILESYSTEM_OPERATION_FAILED: {
    code: "FILESYSTEM_OPERATION_FAILED",
    exitCode: 5,
    message: "filesystem operation failed",
    outcome: "operation-failed",
  },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    exitCode: 70,
    message: "internal error",
    outcome: "internal-error",
  },
} as const satisfies Record<string, CommandFailure>);
function failure(code: keyof typeof failures): CommandHandlerResult {
  return Object.freeze({ ok: false, error: Object.freeze(failures[code]) });
}

// These are current immutable fixture inputs, not provider observations. Each
// invocation's initial page takes a new detached snapshot through the SDK.
const branchInput = Object.freeze([
  Object.freeze({
    workId: "018f0f4d-7b2d-7a11-8a2b-000000000011",
    branch: "fixture-alpha",
    revisionDigest: "a".repeat(64),
    blocked: false,
  }),
  Object.freeze({
    workId: "018f0f4d-7b2d-7a11-8a2b-000000000012",
    branch: "fixture-beta",
    revisionDigest: "b".repeat(64),
    blocked: true,
  }),
  Object.freeze({
    workId: "018f0f4d-7b2d-7a11-8a2b-000000000013",
    branch: "fixture-gamma",
    revisionDigest: "c".repeat(64),
    blocked: false,
  }),
]);
const queueInput = Object.freeze([
  Object.freeze({
    ticketId: "018f0f4d-7b2d-7a11-8a2b-000000000021",
    documentDigest: "d".repeat(64),
    admitted: true,
  }),
  Object.freeze({
    ticketId: "018f0f4d-7b2d-7a11-8a2b-000000000022",
    documentDigest: "e".repeat(64),
    admitted: false,
  }),
]);
const branches = createBranchFixtureSnapshot(() => branchInput);
const queue = createQueueFixtureSnapshot(() => queueInput);

/** Reads bounded data only. No adapter code or fixture path comes from this file. */
async function readConfiguration(
  path: string,
): Promise<AdapterConfiguration | keyof typeof failures> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!(await handle.stat()).isFile()) return "FILESYSTEM_OPERATION_FAILED";
    const bytes = Buffer.alloc(65537);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > 65536) return "ADAPTER_CONFIGURATION_REFUSED";
    const parsed = parseCanonicalContractBytes(
      "adapter-configuration/v1",
      bytes.subarray(0, length),
    );
    return parsed.ok ? (parsed.value as AdapterConfiguration) : "ADAPTER_CONFIGURATION_REFUSED";
  } catch {
    return "FILESYSTEM_OPERATION_FAILED";
  } finally {
    try {
      await handle?.close();
    } catch {
      return "FILESYSTEM_OPERATION_FAILED";
    }
  }
}

export const projectSnapshotCommandHandler: CommandHandler = async (input) => {
  try {
    if (input.command !== "project snapshot" || typeof input.options["--adapter"] !== "string")
      return failure("INTERNAL_ERROR");
    const configuration = await readConfiguration(input.options["--adapter"]);
    if (typeof configuration === "string") return failure(configuration);
    const provenance = projectConfigurationProvenance(input.configuration);
    if (!provenance.ok) return failure("INTERNAL_ERROR");
    if (!validateAdapterConfigurationBinding(configuration, provenance.value).ok)
      return failure("ADAPTER_BINDING_REFUSED");
    const reader =
      configuration.adapterId === "fixture.branches"
        ? branches
        : configuration.adapterId === "fixture.queue"
          ? queue
          : null;
    if (reader === null) return failure("ADAPTER_COMPATIBILITY_REFUSED");
    const snapshot = await reader(configuration, provenance.value, {
      wallNow: () => new Date().toISOString(),
      monotonicNow: () => Math.floor(performance.now()),
    });
    if (!snapshot.ok) return failure(snapshot.code);
    if (snapshot.facts.state === "UNAVAILABLE") return failure("PROJECT_SNAPSHOT_UNAVAILABLE");
    if (snapshot.facts.state === "UNKNOWN") return failure("PROJECT_SNAPSHOT_UNKNOWN");
    return Object.freeze({ ok: true, result: snapshot.facts });
  } catch {
    return failure("INTERNAL_ERROR");
  }
};
