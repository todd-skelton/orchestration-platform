import {
  canonicalDigest,
  parseProjectFacts,
  snapshotJson,
  type ProjectFrontierRow,
} from "@orchestration-platform/contracts";
import {
  createProjectSnapshotReader,
  type SnapshotReadPage,
  type SnapshotReader,
} from "./snapshot.js";
import {
  createProjectCurrentPolicyReader,
  type CurrentPolicyReader,
  type CurrentPolicyRequest,
} from "./current-policy.js";

export type BranchFixtureWork = Readonly<{
  workId: string;
  branch: string;
  revisionDigest: string;
  blocked: boolean;
  capabilityNames?: readonly string[];
}>;
export type QueueFixtureTicket = Readonly<{
  ticketId: string;
  documentDigest: string;
  admitted: boolean;
  capabilityNames?: readonly string[];
}>;

// Private fixture source outcomes, not engine schemas or provider attestations.
export type FixturePolicySourceFailure =
  | Readonly<{ state: "UNKNOWN"; reason: "SOURCE_UNKNOWN" }>
  | Readonly<{ state: "UNAVAILABLE"; reason: "SOURCE_UNAVAILABLE" }>;

const branchRow = (work: BranchFixtureWork): ProjectFrontierRow => ({
  workId: work.workId,
  immutableSubjectDigest: work.revisionDigest,
  readiness: work.blocked ? "NOT_READY" : "READY",
  capabilityNames: work.capabilityNames ?? ["work.read"],
});
const queueRow = (ticket: QueueFixtureTicket): ProjectFrontierRow => ({
  workId: ticket.ticketId,
  immutableSubjectDigest: ticket.documentDigest,
  readiness: ticket.admitted ? "READY" : "NOT_READY",
  capabilityNames: ticket.capabilityNames ?? ["work.read"],
});

function immutableInput<T>(input: T): T {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) throw new Error("fixture input refused");
  return snapshot.value as T;
}

// Continuation state exists only inside one invocation. Initial read takes a
// detached immutable source snapshot; it is neither cached nor loaded from disk.
function fixturePages(
  currentRows: () => readonly ProjectFrontierRow[],
  pageSize: number,
): SnapshotReadPage {
  let rows: readonly ProjectFrontierRow[] = [];
  let digest = "";
  let offset = 0;
  return async (request) => {
    if (request.cursor === null) {
      const snapshot = snapshotJson(currentRows());
      if (!snapshot.ok) throw new Error("fixture input refused");
      rows = snapshot.value as readonly ProjectFrontierRow[];
      digest = canonicalDigest(
        [...rows].sort((a, b) => (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0)),
      );
    }
    const frontier = rows.slice(offset, offset + pageSize);
    offset += frontier.length;
    return {
      cursor: request.cursor,
      observationId: request.observationId,
      state: "COMPLETE",
      frontier,
      frontierDigest: digest,
      nextCursor: offset < rows.length ? `page:${offset}` : null,
    };
  };
}

/** Fixture source may use branches; those details never cross the SDK boundary. */
export function createBranchFixtureSnapshot(
  currentInput: () => readonly BranchFixtureWork[],
): SnapshotReader {
  return (config, provenance, clocks) =>
    createProjectSnapshotReader(
      fixturePages(() => immutableInput(currentInput()).map(branchRow), 2),
      "fixture.branches",
      "1.0.0",
      ["0.0.0"],
      ["adapter-configuration/v1", "project-facts/v1"],
      ["work.read"],
    )(config, provenance, clocks);
}

/** Document queue has no repository, branch or worktree model. */
export function createQueueFixtureSnapshot(
  currentInput: () => readonly QueueFixtureTicket[],
): SnapshotReader {
  return (config, provenance, clocks) =>
    createProjectSnapshotReader(
      fixturePages(() => immutableInput(currentInput()).map(queueRow), 1),
      "fixture.queue",
      "1.0.0",
      ["0.0.0"],
      ["adapter-configuration/v1", "project-facts/v1"],
      ["work.read"],
    )(config, provenance, clocks);
}

function fixturePolicyResponse(
  request: CurrentPolicyRequest,
  input: readonly ProjectFrontierRow[] | FixturePolicySourceFailure,
  threshold: 1 | 2,
): unknown {
  const common = {
    observationId: request.observationId,
    policyVersion: request.policyVersion,
    projectFactsDigest: canonicalDigest(request.projectFacts),
  };
  if (!Array.isArray(input)) return { ...common, ...input };
  const frontier = [...input].sort((a, b) =>
    a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0,
  );
  const parsed = parseProjectFacts({
    ...request.projectFacts,
    frontier,
    frontierDigest: canonicalDigest(frontier),
  });
  // Let the SDK classify malformed source rows; never count unvalidated work.
  if (!parsed.ok || parsed.value.state !== "COMPLETE")
    return { ...common, state: "COMPLETE", frontier, decisions: [] };
  const current = parsed.value.frontier;
  return {
    ...common,
    state: "COMPLETE",
    frontier: current,
    decisions: request.capabilityNames.map((capabilityName) => ({
      capabilityName,
      trip:
        current.filter(
          (row) => row.readiness === "NOT_READY" && row.capabilityNames.includes(capabilityName),
        ).length >= threshold
          ? "TRIP"
          : "NO_TRIP",
    })),
  };
}

/** Policy 1.0.0 trips on at least ONE current NOT_READY work row per capability. */
export function createBranchFixtureCurrentPolicy(
  currentInput: () => readonly BranchFixtureWork[] | FixturePolicySourceFailure,
): CurrentPolicyReader {
  return createProjectCurrentPolicyReader(
    async (request) => {
      const input = immutableInput(currentInput());
      return fixturePolicyResponse(
        request,
        Array.isArray(input) ? input.map(branchRow) : (input as FixturePolicySourceFailure),
        1,
      );
    },
    "fixture.branches",
    "1.0.0",
    "1.0.0",
    ["0.0.0"],
    ["adapter-configuration/v1", "project-facts/v1", "project-breaker-facts/v1"],
    ["work.read"],
    ["1.0.0"],
  );
}

/** Policy 1.0.0 trips on at least TWO current NOT_READY work rows per capability. */
export function createQueueFixtureCurrentPolicy(
  currentInput: () => readonly QueueFixtureTicket[] | FixturePolicySourceFailure,
): CurrentPolicyReader {
  return createProjectCurrentPolicyReader(
    async (request) => {
      const input = immutableInput(currentInput());
      return fixturePolicyResponse(
        request,
        Array.isArray(input) ? input.map(queueRow) : (input as FixturePolicySourceFailure),
        2,
      );
    },
    "fixture.queue",
    "1.0.0",
    "1.0.0",
    ["0.0.0"],
    ["adapter-configuration/v1", "project-facts/v1", "project-breaker-facts/v1"],
    ["work.read"],
    ["1.0.0"],
  );
}
