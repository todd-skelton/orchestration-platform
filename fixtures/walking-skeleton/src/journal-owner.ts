import { createHash } from "node:crypto";
import { type BigIntStats } from "node:fs";
import { open, readFile, type FileHandle } from "node:fs/promises";
import {
  computeCyclePlanDigest,
  computeEventJournalGenesisDigest,
  computeEventJournalPrefixDigest,
  computeOrchestrationEventDigest,
  inspectEventJournalBytes,
  parseEventJournal,
  parseEventJournalBytes,
  parseOrchestrationEvent,
  parseRoutineStepIdentity,
  planEventJournalAppend,
  reduceEventJournal,
  routineStepKinds,
  serializeEventJournal,
  validateOrchestrationEventBinding,
  type ContractRecord,
  type CyclePlan,
  type EventJournal,
  type ReducedState,
  type RetainedEvidenceInput,
  type RetainedEvidenceKind,
  type RoutineStepIdentity,
} from "@orchestration-platform/contracts";

export type SkeletonJournalBoundary = "JOURNAL_HEADER" | `STARTED:${number}` | `TERMINAL:${number}`;
export type SkeletonBoundaryObserver = (
  boundary: SkeletonJournalBoundary,
  state: Readonly<{
    byteLength: number;
    journal: EventJournal;
    prefixDigest: string;
    reduced: ReducedState | null;
  }>,
) => void | Promise<void>;

const sameFile = (left: BigIntStats, right: BigIntStats) =>
  left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;

async function writeAll(handle: FileHandle, bytes: Uint8Array, position: number) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
    if (written.bytesWritten <= 0) throw new Error("fixture journal short write");
    offset += written.bytesWritten;
  }
}

async function readHandle(handle: FileHandle, maximum = 16 * 1024 * 1024) {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum))
    throw new Error("fixture journal file refused");
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.byteLength) {
    const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
    if (read.bytesRead <= 0) throw new Error("fixture journal short read");
    offset += read.bytesRead;
  }
  const after = await handle.stat({ bigint: true });
  if (!sameFile(before, after) || before.size !== after.size)
    throw new Error("fixture journal identity changed");
  return { bytes, identity: after };
}

function evidenceReferences(evidence: readonly RetainedEvidenceInput[]) {
  return [...evidence]
    .sort((left, right) => left.kind.localeCompare(right.kind))
    .map(({ bytes, kind }) => ({
      byteLength: String(bytes.byteLength),
      contentDigest: createHash("sha256").update(bytes).digest("hex"),
      encoding: new Set<RetainedEvidenceKind>([
        "MAPPING_OBSERVATION",
        "MUTATION_OBSERVATION",
        "PREFLIGHT_OBSERVATION",
      ]).has(kind)
        ? ("CANONICAL_JSON" as const)
        : ("RAW_BYTES" as const),
      kind,
    }));
}

function exactEvidence(evidence: readonly RetainedEvidenceInput[]) {
  return [...evidence]
    .sort((left, right) => left.kind.localeCompare(right.kind))
    .map((row) => ({ bytes: Uint8Array.from(row.bytes), kind: row.kind }));
}

/** Fixture-only retained-handle OPJ1 writer. It grants no production append authority. */
export class FixtureJournalOwner {
  readonly #handle: FileHandle;
  readonly #identity: BigIntStats;
  readonly #observe: SkeletonBoundaryObserver | null;
  #bytes: Uint8Array;
  #journal: EventJournal;
  #evidence: RetainedEvidenceInput[][] = [];
  #pending: RoutineStepIdentity | null = null;
  #closed = false;

  private constructor(
    handle: FileHandle,
    identity: BigIntStats,
    bytes: Uint8Array,
    journal: EventJournal,
    observe: SkeletonBoundaryObserver | null,
  ) {
    this.#handle = handle;
    this.#identity = identity;
    this.#bytes = Uint8Array.from(bytes);
    this.#journal = journal;
    this.#observe = observe;
  }

  static async create(
    path: string,
    cyclePlan: CyclePlan,
    observe: SkeletonBoundaryObserver | null = null,
  ) {
    const cyclePlanDigest = computeCyclePlanDigest(cyclePlan);
    const header = {
      cycleId: cyclePlan.request.cycleId,
      cyclePlan,
      cyclePlanDigest,
      sessionId: cyclePlan.request.sessionRequest.sessionId,
    };
    const parsed = parseEventJournal({
      ...header,
      events: [],
      genesisDigest: computeEventJournalGenesisDigest(header),
      schemaVersion: "event-journal/v1",
    });
    if (!parsed.ok) throw new Error(parsed.issues.join(","));
    const bytes = serializeEventJournal(parsed.value);
    const handle = await open(path, "wx+", 0o600);
    try {
      await writeAll(handle, bytes, 0);
      await handle.sync();
      const readback = await readHandle(handle);
      if (!Buffer.from(readback.bytes).equals(Buffer.from(bytes)))
        throw new Error("fixture journal header read-back mismatch");
      const physical = parseEventJournalBytes(readback.bytes);
      if (!physical.ok) throw new Error(physical.issues.join(","));
      const owner = new FixtureJournalOwner(
        handle,
        readback.identity,
        readback.bytes,
        physical.value,
        observe,
      );
      await owner.#notify("JOURNAL_HEADER");
      return owner;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  get journal() {
    return this.#journal;
  }

  get bytes() {
    return Uint8Array.from(this.#bytes);
  }

  get evidence() {
    return this.#evidence.map((rows) => exactEvidence(rows));
  }

  step(ordinal: number, inputDigest: string) {
    const parsed = parseRoutineStepIdentity({
      cycleId: this.#journal.cycleId,
      inputDigest,
      kind: routineStepKinds[String(ordinal) as keyof typeof routineStepKinds],
      ordinal: String(ordinal),
      predecessorJournalDigest: ordinal === 1 ? null : computeEventJournalPrefixDigest(this.#bytes),
    });
    if (!parsed.ok) throw new Error(parsed.issues.join(","));
    return parsed.value;
  }

  async start(step: RoutineStepIdentity) {
    if (this.#pending !== null) throw new Error("fixture journal pending step conflict");
    const event = await this.#append("STARTED", step, null, []);
    this.#pending = step;
    return event;
  }

  async terminal(
    step: RoutineStepIdentity,
    output: ContractRecord,
    evidence: readonly RetainedEvidenceInput[] = [],
  ) {
    if (this.#pending === null || JSON.stringify(this.#pending) !== JSON.stringify(step))
      throw new Error("fixture journal terminal step mismatch");
    const event = await this.#append("TERMINAL", step, output, evidence);
    this.#pending = null;
    return event;
  }

  replay() {
    return reduceEventJournal(this.#journal, this.#evidence);
  }

  /** Lost-ack check: the exact last event must plan idempotently and write nothing. */
  async verifyLastEventIdempotent() {
    if (this.#closed) throw new Error("fixture journal owner closed");
    const event = this.#journal.events[this.#journal.events.length - 1];
    if (!event) throw new Error("fixture journal has no event");
    const physical = await readHandle(this.#handle);
    if (!Buffer.from(physical.bytes).equals(Buffer.from(this.#bytes)))
      throw new Error("fixture journal prefix changed");
    const planned = planEventJournalAppend(this.#bytes, event);
    if (
      !planned.ok ||
      planned.value.status !== "IDEMPOTENT" ||
      !Buffer.from(planned.value.bytes).equals(Buffer.from(this.#bytes))
    )
      throw new Error("fixture journal idempotent read-back refused");
    return {
      byteLength: this.#bytes.byteLength,
      prefixDigest: planned.value.resultingPrefixDigest,
      status: planned.value.status,
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle.close();
  }

  async #append(
    phase: "STARTED" | "TERMINAL",
    step: RoutineStepIdentity,
    output: ContractRecord | null,
    evidenceInput: readonly RetainedEvidenceInput[],
  ) {
    if (this.#closed) throw new Error("fixture journal owner closed");
    const physical = await readHandle(this.#handle);
    if (
      !sameFile(this.#identity, physical.identity) ||
      !Buffer.from(physical.bytes).equals(Buffer.from(this.#bytes))
    )
      throw new Error("fixture journal prefix changed");
    const evidence = exactEvidence(evidenceInput);
    const prior = this.#journal.events[this.#journal.events.length - 1] ?? null;
    const parsed = parseOrchestrationEvent({
      cycleId: this.#journal.cycleId,
      output,
      phase,
      position: String(this.#journal.events.length),
      previousEventDigest: prior === null ? null : computeOrchestrationEventDigest(prior),
      previousPrefixDigest: computeEventJournalPrefixDigest(this.#bytes),
      retainedEvidence: evidenceReferences(evidence),
      schemaVersion: "orchestration-event/v1",
      step,
    });
    if (!parsed.ok) throw new Error(parsed.issues.join(","));
    const binding = validateOrchestrationEventBinding(parsed.value, evidence);
    if (!binding.ok) throw new Error(binding.issues.join(","));
    const planned = planEventJournalAppend(this.#bytes, parsed.value);
    if (!planned.ok || planned.value.status !== "APPEND")
      throw new Error(planned.ok ? "fixture journal append not new" : planned.issues.join(","));
    const suffix = planned.value.bytes.slice(this.#bytes.byteLength);
    await writeAll(this.#handle, suffix, this.#bytes.byteLength);
    await this.#handle.sync();
    const readback = await readHandle(this.#handle);
    if (
      !sameFile(this.#identity, readback.identity) ||
      !Buffer.from(readback.bytes).equals(Buffer.from(planned.value.bytes)) ||
      computeEventJournalPrefixDigest(readback.bytes) !== planned.value.resultingPrefixDigest
    )
      throw new Error("fixture journal append read-back mismatch");
    const journal = parseEventJournalBytes(readback.bytes);
    if (!journal.ok) throw new Error(journal.issues.join(","));
    this.#bytes = Uint8Array.from(readback.bytes);
    this.#journal = journal.value;
    this.#evidence.push(evidence);
    await this.#notify(`${phase}:${step.ordinal}` as SkeletonJournalBoundary);
    return parsed.value;
  }

  async #notify(boundary: SkeletonJournalBoundary) {
    if (!this.#observe) return;
    const reduced = this.replay();
    await this.#observe(boundary, {
      byteLength: this.#bytes.byteLength,
      journal: this.#journal,
      prefixDigest: computeEventJournalPrefixDigest(this.#bytes),
      reduced: reduced.ok ? reduced.value : null,
    });
  }
}

export type FixtureEvidenceFiles = Partial<Readonly<Record<RetainedEvidenceKind, string>>>;

/** Read-only restart evidence; it never appends or selects runtime authority. */
export async function replayFixtureJournal(path: string, files: FixtureEvidenceFiles) {
  const bytes = await readFile(path);
  const inspected = inspectEventJournalBytes(bytes);
  if (!inspected.ok || inspected.value.partialSuffix)
    return inspected.ok
      ? { ok: false as const, issues: ["journal:partial-final-frame"] }
      : inspected;
  const evidence: RetainedEvidenceInput[][] = [];
  for (const event of inspected.value.journal.events) {
    const rows: RetainedEvidenceInput[] = [];
    for (const reference of event.retainedEvidence) {
      const source = files[reference.kind];
      if (!source) return { ok: false as const, issues: [`evidence.${reference.kind}:missing`] };
      rows.push({ bytes: await readFile(source), kind: reference.kind });
    }
    evidence.push(rows);
  }
  const reduced = reduceEventJournal(inspected.value.journal, evidence);
  return reduced.ok
    ? {
        ok: true as const,
        value: {
          bytes: Uint8Array.from(bytes),
          evidence,
          journal: inspected.value.journal,
          reduced: reduced.value,
        },
      }
    : reduced;
}
