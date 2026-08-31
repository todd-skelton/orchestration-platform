import {
  canonicalDigest,
  snapshotJson,
  type ProjectFrontierRow,
} from "@orchestration-platform/contracts";
import {
  createProjectSnapshotReader,
  type SnapshotReadPage,
  type SnapshotReader,
} from "./snapshot.js";

export type BranchFixtureWork = Readonly<{
  workId: string;
  branch: string;
  revisionDigest: string;
  blocked: boolean;
}>;
export type QueueFixtureTicket = Readonly<{
  ticketId: string;
  documentDigest: string;
  admitted: boolean;
}>;

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
      fixturePages(
        () =>
          immutableInput(currentInput()).map((work) => ({
            workId: work.workId,
            immutableSubjectDigest: work.revisionDigest,
            readiness: work.blocked ? "NOT_READY" : "READY",
            capabilityNames: ["work.read"],
          })),
        2,
      ),
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
      fixturePages(
        () =>
          immutableInput(currentInput()).map((ticket) => ({
            workId: ticket.ticketId,
            immutableSubjectDigest: ticket.documentDigest,
            readiness: ticket.admitted ? "READY" : "NOT_READY",
            capabilityNames: ["work.read"],
          })),
        1,
      ),
      "fixture.queue",
      "1.0.0",
      ["0.0.0"],
      ["adapter-configuration/v1", "project-facts/v1"],
      ["work.read"],
    )(config, provenance, clocks);
}
