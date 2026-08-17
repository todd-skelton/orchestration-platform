import { createHash } from "node:crypto";
import {
  canonicalBytes,
  canonicalDigest,
  isCanonicalTimestamp,
  isContractRelativePath,
  snapshotClosedArray,
  snapshotClosedRecord,
  validateAgainstSchema,
  type ContractRecord,
  type FieldRule,
  type JsonValue,
  type SchemaDefinition,
} from "./runtime.js";
import {
  isCleanupLifecyclePublicationPair,
  isCleanupLifecyclePublicationTransition,
} from "./definitions.js";

const field = (kind: FieldRule["kind"], options: Omit<FieldRule, "kind"> = {}): FieldRule =>
  Object.freeze({ kind, ...options });
const enumeration = (...values: readonly string[]): FieldRule =>
  field("opaque", { values: Object.freeze([...values]) });
const nullable = (kind: FieldRule["kind"]): FieldRule => field(kind, { nullable: true });
const array = (kind: FieldRule["kind"]): FieldRule => field(kind, { array: true });
const define = (
  schemaVersion: string,
  fields: Readonly<Record<string, FieldRule>>,
  validate?: SchemaDefinition["validate"],
): SchemaDefinition =>
  Object.freeze({
    schemaVersion,
    authority: true as const,
    fields: Object.freeze({ schemaVersion: field("schema-id"), ...fields }),
    ...(validate ? { validate } : {}),
  });

const sha = field("sha256");
const nullableSha = nullable("sha256");
const uuid = field("uuid-v7");
const timestamp = field("timestamp");
const path = field("relative-path");
const opaque = field("opaque");
const integer = field("integer");
const value = (record: ContractRecord, name: string): JsonValue => record[name]!;
const nullGroup = (record: ContractRecord, names: readonly string[]): boolean =>
  names.every((name) => value(record, name) === null);
const presentGroup = (record: ContractRecord, names: readonly string[]): boolean =>
  names.every((name) => value(record, name) !== null);
const exactOptionalGroup = (record: ContractRecord, names: readonly string[]): readonly string[] =>
  nullGroup(record, names) || presentGroup(record, names)
    ? []
    : [`${names.join("+")}:partial-group`];

export const pointerKinds = Object.freeze([
  "ACTIVE_RELEASE",
  "ACTIVATION_CLEANUP_GATE",
  "ACTIVATION_RECOVERY_FENCE",
  "ACTIVATION_RECOVERY_LAUNCH",
  "RECOVERY_AUTHORIZATION_STATE",
  "RECOVERY_AUTHORIZATION_ATTACHMENT",
  "RECOVERY_ATTEMPT_ACCUMULATOR",
  "ACTIVATION_CLEANUP_ARCHIVE_HEAD",
  "AUTHORITY_RETENTION",
  "RECOVERY_ATTEMPT_RESERVATION",
  "STATE_MUTATION_AUTHORITY_ROTATION",
] as const);
export type PointerKind = (typeof pointerKinds)[number];
export const stateMutationLockPath = "installation/state-mutation.lock";
export const stateMutationAuthorityPath = "installation/state-mutation-authority.json";
export const stateMutationRegistry = Object.freeze({
  lock: Object.freeze({ path: stateMutationLockPath, singleton: true, symlinkAllowed: false }),
  authority: Object.freeze({ path: stateMutationAuthorityPath, singleton: true }),
});

export interface PointerRegistryRow {
  readonly kind: PointerKind;
  readonly singleton: boolean;
  readonly pathTemplate: string;
  readonly sourceTokens: readonly string[];
  readonly retention: "FULL_REQUIRED" | "TERMINAL_CHECKPOINT_ALLOWED";
  readonly valueSchemas: readonly string[];
  readonly rootTemplates: readonly string[];
  readonly archiveTemplates: readonly string[];
  readonly genesis: "REVIEWED_BOOTSTRAP" | "TRANSACTION_CREATE_ONCE" | "PREDECESSOR_TRIPLE";
  readonly transactionPolicy: "REQUIRED" | "NULL";
  readonly sourcePolicy: "NONE" | "RECOVERY_SOURCE";
  readonly positionDomain: string;
  readonly tombstonePositionDomain: string | null;
}

const pointerRows: readonly PointerRegistryRow[] = [
  {
    kind: "ACTIVE_RELEASE",
    singleton: true,
    pathTemplate: "installation/active-release.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["active-release/v2", "pointer-tombstone-value/v1"],
    rootTemplates: ["releases/<release-digest>/"],
    archiveTemplates: ["installation/active-release-archives/<transaction>.json"],
    genesis: "REVIEWED_BOOTSTRAP",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "NONE",
    positionDomain: "active-release-position/v1",
    tombstonePositionDomain: "active-release-position-tombstone/v1",
  },
  {
    kind: "ACTIVATION_CLEANUP_GATE",
    singleton: true,
    pathTemplate: "installation/activation-cleanup-gate.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["activation-cleanup-gate-head/v2", "pointer-tombstone-value/v1"],
    rootTemplates: ["installation/activation-cleanup-gate-roots/<transaction>.json"],
    archiveTemplates: ["installation/activation-cleanup-gates/<transaction>.json"],
    genesis: "TRANSACTION_CREATE_ONCE",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "NONE",
    positionDomain: "cleanup-gate-position/v1",
    tombstonePositionDomain: "cleanup-gate-position-tombstone/v1",
  },
  {
    kind: "ACTIVATION_RECOVERY_FENCE",
    singleton: true,
    pathTemplate: "installation/activation-recovery-fence.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["activation-recovery-fence-head/v2", "pointer-tombstone-value/v1"],
    rootTemplates: ["installation/activation-recovery-fence-roots/<transaction>.json"],
    archiveTemplates: ["installation/activation-recovery-fences/<transaction>.json"],
    genesis: "TRANSACTION_CREATE_ONCE",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "NONE",
    positionDomain: "recovery-fence-position/v1",
    tombstonePositionDomain: "recovery-fence-position-tombstone/v1",
  },
  {
    kind: "ACTIVATION_RECOVERY_LAUNCH",
    singleton: false,
    pathTemplate: "installation/activation-recovery-launches/<transaction>/<source>/current.json",
    sourceTokens: ["recovery-fence-v2", "cleanup-gate-pre-fence-v2"],
    retention: "TERMINAL_CHECKPOINT_ALLOWED",
    valueSchemas: ["activation-recovery-launch/v2", "pointer-tombstone-value/v1"],
    rootTemplates: ["installation/activation-recovery-launches/<transaction>/<source>/attempts/"],
    archiveTemplates: [
      "installation/activation-recovery-launches/<transaction>/<source>/archive.json",
    ],
    genesis: "PREDECESSOR_TRIPLE",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "RECOVERY_SOURCE",
    positionDomain: "recovery-launch-position/v1",
    tombstonePositionDomain: "recovery-launch-position-tombstone/v1",
  },
  {
    kind: "RECOVERY_AUTHORIZATION_STATE",
    singleton: false,
    pathTemplate: "installation/recovery-authorizations/<transaction>/state.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["recovery-authorization-state/v2", "pointer-tombstone-value/v1"],
    rootTemplates: ["installation/recovery-authorizations/<transaction>/core.json"],
    archiveTemplates: ["installation/recovery-authorizations/<transaction>/archive.json"],
    genesis: "TRANSACTION_CREATE_ONCE",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "NONE",
    positionDomain: "authorization-state-position/v1",
    tombstonePositionDomain: "authorization-state-position-tombstone/v1",
  },
  {
    kind: "RECOVERY_AUTHORIZATION_ATTACHMENT",
    singleton: false,
    pathTemplate: "installation/recovery-authorizations/<transaction>/attachment.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["recovery-authorization-attachment/v1", "pointer-tombstone-value/v1"],
    rootTemplates: ["installation/recovery-authorizations/<transaction>/state.json"],
    archiveTemplates: [
      "installation/recovery-authorizations/<transaction>/attachment-archive.json",
    ],
    genesis: "TRANSACTION_CREATE_ONCE",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "NONE",
    positionDomain: "authorization-attachment-position/v1",
    tombstonePositionDomain: "authorization-attachment-position-tombstone/v1",
  },
  {
    kind: "RECOVERY_ATTEMPT_ACCUMULATOR",
    singleton: false,
    pathTemplate:
      "installation/activation-recovery-launches/<transaction>/<source>/accumulator.json",
    sourceTokens: ["recovery-fence-v2", "cleanup-gate-pre-fence-v2"],
    retention: "TERMINAL_CHECKPOINT_ALLOWED",
    valueSchemas: ["recovery-attempt-accumulator/v1", "pointer-tombstone-value/v1"],
    rootTemplates: ["installation/activation-recovery-launches/<transaction>/<source>/attempts/"],
    archiveTemplates: [
      "installation/activation-recovery-launches/<transaction>/<source>/accumulator-checkpoints/",
    ],
    genesis: "PREDECESSOR_TRIPLE",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "RECOVERY_SOURCE",
    positionDomain: "attempt-accumulator-position/v1",
    tombstonePositionDomain: "attempt-accumulator-position-tombstone/v1",
  },
  {
    kind: "ACTIVATION_CLEANUP_ARCHIVE_HEAD",
    singleton: true,
    pathTemplate: "installation/activation-cleanup/archive-head.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["activation-cleanup-archive-head/v2", "pointer-tombstone-value/v1"],
    rootTemplates: ["installation/activation-cleanup-gates/"],
    archiveTemplates: ["installation/activation-cleanup/archive-head-history/"],
    genesis: "REVIEWED_BOOTSTRAP",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "NONE",
    positionDomain: "cleanup-archive-position/v1",
    tombstonePositionDomain: "cleanup-archive-position-tombstone/v1",
  },
  {
    kind: "AUTHORITY_RETENTION",
    singleton: false,
    pathTemplate: "installation/authority-retention/<pointer-instance-digest>.json",
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["authority-retention/v1"],
    rootTemplates: ["installation/pointer-cas/<pointer-instance-digest>/"],
    archiveTemplates: ["installation/authority-retention-archives/<pointer-instance-digest>.json"],
    genesis: "TRANSACTION_CREATE_ONCE",
    transactionPolicy: "NULL",
    sourcePolicy: "NONE",
    positionDomain: "authority-retention-position/v1",
    tombstonePositionDomain: null,
  },
  {
    kind: "RECOVERY_ATTEMPT_RESERVATION",
    singleton: false,
    pathTemplate:
      "installation/activation-recovery-launches/<transaction>/<source>/reservations/<predecessor-key>.json",
    sourceTokens: ["recovery-fence-v2", "cleanup-gate-pre-fence-v2"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["recovery-attempt-reservation/v1", "pointer-tombstone-value/v1"],
    rootTemplates: [
      "installation/activation-recovery-launches/<transaction>/<source>/reservations/",
    ],
    archiveTemplates: [
      "installation/activation-recovery-launches/<transaction>/<source>/reservation-archives/",
    ],
    genesis: "PREDECESSOR_TRIPLE",
    transactionPolicy: "REQUIRED",
    sourcePolicy: "RECOVERY_SOURCE",
    positionDomain: "attempt-reservation-position/v1",
    tombstonePositionDomain: "attempt-reservation-position-tombstone/v1",
  },
  {
    kind: "STATE_MUTATION_AUTHORITY_ROTATION",
    singleton: true,
    pathTemplate: stateMutationAuthorityPath,
    sourceTokens: ["none"],
    retention: "FULL_REQUIRED",
    valueSchemas: ["state-mutation-authority-value/v1"],
    rootTemplates: ["installation/state-mutation.lock"],
    archiveTemplates: ["installation/state-mutation-authority-history/"],
    genesis: "REVIEWED_BOOTSTRAP",
    transactionPolicy: "NULL",
    sourcePolicy: "NONE",
    positionDomain: "authority-rotation-position/v1",
    tombstonePositionDomain: null,
  },
];
export const pointerRegistry: readonly PointerRegistryRow[] = Object.freeze(
  pointerRows.map((row) =>
    Object.freeze({
      ...row,
      sourceTokens: Object.freeze(row.sourceTokens),
      valueSchemas: Object.freeze(row.valueSchemas),
      rootTemplates: Object.freeze(row.rootTemplates),
      archiveTemplates: Object.freeze(row.archiveTemplates),
    }),
  ),
);

function safeUuid(value: string, label: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new TypeError(`${label}:invalid`);
  return value;
}
function safeDigest(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label}:invalid`);
  return value;
}
function validateIdentityPolicy(
  row: PointerRegistryRow,
  transactionId: unknown,
  sourceToken: unknown,
): void {
  if (row.transactionPolicy === "REQUIRED") safeUuid(String(transactionId), "transactionId");
  else if (transactionId !== null) throw new TypeError("transactionId:must-be-null");
  if (row.sourcePolicy === "NONE") {
    if (sourceToken !== "none") throw new TypeError("sourceToken:must-be-none");
  } else if (typeof sourceToken !== "string" || !row.sourceTokens.includes(sourceToken))
    throw new TypeError("sourceToken:invalid");
}
export function recoveryAuthorizationCorePath(transactionId: string): string {
  return `installation/recovery-authorizations/${safeUuid(transactionId, "transactionId")}/core.json`;
}
export function nativeConsumePath(transactionId: string, operationId: string): string {
  return `installation/recovery-authorizations/${safeUuid(transactionId, "transactionId")}/native/${safeUuid(operationId, "operationId")}.json`;
}

export interface PointerPathBindings {
  readonly transactionId?: string;
  readonly sourceToken?: string;
  readonly predecessorKey?: string;
  readonly pointerInstanceDigest?: string;
  readonly releaseDigest?: string;
}

const templateBindings = Object.freeze({
  "<transaction>": "transactionId",
  "<source>": "sourceToken",
  "<predecessor-key>": "predecessorKey",
  "<pointer-instance-digest>": "pointerInstanceDigest",
  "<release-digest>": "releaseDigest",
} as const);

function expectedTemplateBindings(templates: readonly string[]): readonly string[] {
  return Object.freeze(
    Object.entries(templateBindings)
      .filter(([placeholder]) => templates.some((template) => template.includes(placeholder)))
      .map(([, binding]) => binding)
      .sort(),
  );
}

function expandTemplate(row: PointerRegistryRow, template: string, bindings: unknown): string {
  const expected = expectedTemplateBindings([template]);
  const closed = snapshotClosedRecord(bindings, expected);
  if (!closed.ok) throw new TypeError(`bindings:${closed.issues.join(",")}`);
  let expanded = template;
  for (const [placeholder, binding] of Object.entries(templateBindings)) {
    if (!expanded.includes(placeholder)) continue;
    const raw = closed.value[binding];
    let replacement: string;
    if (binding === "transactionId") replacement = safeUuid(String(raw), binding);
    else if (binding === "sourceToken") {
      replacement = String(raw);
      if (!row.sourceTokens.includes(replacement)) throw new TypeError("sourceToken:invalid");
    } else replacement = safeDigest(String(raw), binding);
    expanded = expanded.replaceAll(placeholder, replacement);
  }
  const pathForValidation = expanded.endsWith("/") ? expanded.slice(0, -1) : expanded;
  if (!isContractRelativePath(pathForValidation)) throw new TypeError("expandedPath:invalid");
  return expanded;
}

export function pointerPath(kind: PointerKind, bindings: PointerPathBindings = {}): string {
  const row = pointerRegistry.find((entry) => entry.kind === kind);
  if (!row) throw new TypeError("pointer-kind:unsupported");
  return expandTemplate(row, row.pathTemplate, bindings);
}

export function pointerRootPaths(
  kind: PointerKind,
  bindings: PointerPathBindings,
): readonly string[] {
  const row = pointerRegistry.find((entry) => entry.kind === kind);
  if (!row) throw new TypeError("pointer-kind:unsupported");
  return Object.freeze(
    row.rootTemplates.map((template) => expandTemplate(row, template, bindings)),
  );
}

export function pointerArchivePaths(
  kind: PointerKind,
  bindings: PointerPathBindings,
): readonly string[] {
  const row = pointerRegistry.find((entry) => entry.kind === kind);
  if (!row) throw new TypeError("pointer-kind:unsupported");
  return Object.freeze(
    row.archiveTemplates.map((template) => expandTemplate(row, template, bindings)),
  );
}

export function pointerGenesisRule(kind: PointerKind): PointerRegistryRow["genesis"] {
  const row = pointerRegistry.find((entry) => entry.kind === kind);
  if (!row) throw new TypeError("pointer-kind:unsupported");
  return row.genesis;
}

export function validatePointerTemplateDispatch(
  kind: PointerKind,
  family: "ROOT" | "ARCHIVE",
  observedPaths: unknown,
  bindings: PointerPathBindings,
): readonly string[] {
  if (family !== "ROOT" && family !== "ARCHIVE") return ["template-family:unsupported"];
  const observed = snapshotClosedArray(observedPaths);
  if (!observed.ok) return observed.issues;
  try {
    const expected =
      family === "ROOT" ? pointerRootPaths(kind, bindings) : pointerArchivePaths(kind, bindings);
    return canonicalDigest(observed.value) === canonicalDigest(expected)
      ? []
      : [`${family.toLowerCase()}:path-mismatch`];
  } catch {
    return [`${family.toLowerCase()}:invalid-bindings`];
  }
}

export function validatePointerGenesisDispatch(
  kind: PointerKind,
  observed: unknown,
): readonly string[] {
  try {
    return observed === pointerGenesisRule(kind) ? [] : ["genesis:mismatch"];
  } catch {
    return ["pointerKind:unsupported"];
  }
}

export function validatePointerDispatch(
  kind: PointerKind,
  observedPath: string,
  schemaVersion: string,
  bindings: Parameters<typeof pointerPath>[1] = {},
): readonly string[] {
  const row = pointerRegistry.find((entry) => entry.kind === kind);
  if (!row) return ["pointerKind:unsupported"];
  let expectedPath: string;
  try {
    expectedPath = pointerPath(kind, bindings);
  } catch {
    return ["pointerPath:invalid-bindings"];
  }
  const issues: string[] = [];
  if (observedPath !== expectedPath) issues.push("pointerPath:mismatch");
  if (!row.valueSchemas.includes(schemaVersion)) issues.push("schemaVersion:wrong-pointer-family");
  return Object.freeze(issues);
}

export type FramePart =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "nullable-text"; readonly value: string | null }
  | { readonly type: "raw32"; readonly value: string }
  | { readonly type: "nullable-raw32"; readonly value: string | null }
  | { readonly type: "raw-fixed"; readonly value: string }
  | { readonly type: "canonical"; readonly value: JsonValue };

const encoder = new TextEncoder();
function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}
function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}
function hexBytes(value: string): Uint8Array {
  safeDigest(value, "digest");
  return Uint8Array.from(value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function framedBytes(domainTag: string, parts: readonly FramePart[]): Uint8Array {
  if (!/^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/.test(domainTag)) throw new TypeError("domainTag:invalid");
  const partSnapshot = snapshotClosedArray(parts);
  if (!partSnapshot.ok) throw new TypeError(`parts:${partSnapshot.issues.join(",")}`);
  const chunks: Uint8Array[] = [
    encoder.encode("orchestration-platform\0"),
    encoder.encode(`${domainTag}\0`),
    u32(partSnapshot.value.length),
  ];
  for (const rawPartValue of partSnapshot.value) {
    const closedPart = snapshotClosedRecord(rawPartValue, ["type", "value"]);
    if (!closedPart.ok) throw new TypeError(`part:${closedPart.issues.join(",")}`);
    const part = closedPart.value as unknown as FramePart;
    let tag: number;
    let bytes: Uint8Array;
    if (part.type === "text") {
      if (typeof part.value !== "string") throw new TypeError("text:invalid");
      tag = 1;
      bytes = encoder.encode(part.value);
    } else if (part.type === "nullable-text") {
      if (part.value !== null && typeof part.value !== "string")
        throw new TypeError("nullable-text:invalid");
      tag = part.value === null ? 6 : 7;
      bytes = part.value === null ? new Uint8Array() : encoder.encode(part.value);
    } else if (part.type === "raw32") {
      if (typeof part.value !== "string") throw new TypeError("raw32:invalid");
      tag = 2;
      bytes = hexBytes(part.value);
    } else if (part.type === "nullable-raw32") {
      if (part.value !== null && typeof part.value !== "string")
        throw new TypeError("nullable-raw32:invalid");
      tag = part.value === null ? 3 : 4;
      bytes = part.value === null ? new Uint8Array() : hexBytes(part.value);
    } else if (part.type === "raw-fixed") {
      tag = 8;
      if (typeof part.value !== "string" || !/^(?:[0-9a-f]{2}){1,64}$/.test(part.value))
        throw new TypeError("raw-fixed:invalid");
      bytes = Uint8Array.from(part.value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
    } else if (part.type === "canonical") {
      tag = 5;
      bytes = canonicalBytes(part.value);
    } else throw new TypeError("part:type-unsupported");
    chunks.push(Uint8Array.of(tag), u64(bytes.length), bytes);
  }
  return concat(chunks);
}
function hashFrame(domain: string, parts: readonly FramePart[]): string {
  return createHash("sha256").update(framedBytes(domain, parts)).digest("hex");
}
const textPart = (value: string): FramePart => ({ type: "text", value });
const rawPart = (value: string): FramePart => ({ type: "raw32", value });
const nullableTextPart = (value: string | null): FramePart => ({ type: "nullable-text", value });
const nullableRawPart = (value: string | null): FramePart => ({ type: "nullable-raw32", value });
const canonicalPart = (value: JsonValue): FramePart => ({ type: "canonical", value });
const rawFixedPart = (value: string): FramePart => ({ type: "raw-fixed", value });

function requireClosedInput(input: unknown, fields: readonly string[]): ContractRecord {
  const closed = snapshotClosedRecord(input, fields);
  if (!closed.ok) throw new TypeError(`input:${closed.issues.join(",")}`);
  return closed.value;
}
function requirePointerKind(value: unknown): PointerKind {
  if (typeof value !== "string" || !pointerKinds.includes(value as PointerKind))
    throw new TypeError("pointerKind:invalid");
  return value as PointerKind;
}
function requireSchemaRecord(schemaVersion: string, input: unknown): ContractRecord {
  const definition = v2Definitions[schemaVersion];
  if (!definition) throw new TypeError("schemaVersion:unsupported");
  const parsed = validateAgainstSchema(definition, input);
  if (!parsed.ok) throw new TypeError(`${schemaVersion}:${parsed.issues.join(",")}`);
  return parsed.value;
}
function requirePointerValueRecord(kind: PointerKind, input: unknown): ContractRecord {
  const row = pointerRegistry.find((candidate) => candidate.kind === kind)!;
  for (const schemaVersion of row.valueSchemas) {
    const parsed = validateAgainstSchema(v2Definitions[schemaVersion]!, input);
    if (parsed.ok) {
      if (schemaVersion === "pointer-tombstone-value/v1" && parsed.value.pointerKind !== kind)
        throw new TypeError("pointerKind:tombstone-dispatch-mismatch");
      return parsed.value;
    }
  }
  throw new TypeError("value:wrong-pointer-family-or-invalid");
}

function isTerminalPointerValue(kind: PointerKind, record: ContractRecord): boolean {
  switch (kind) {
    case "ACTIVE_RELEASE":
    case "ACTIVATION_CLEANUP_ARCHIVE_HEAD":
      return true;
    case "ACTIVATION_CLEANUP_GATE":
      return record.lifecycle === "COMPLETE";
    case "ACTIVATION_RECOVERY_FENCE":
      return record.lifecycle === "POST_ACTIVATION";
    case "ACTIVATION_RECOVERY_LAUNCH":
      return typeof record.lifecycle === "string" && record.lifecycle.startsWith("TERMINAL_");
    case "RECOVERY_AUTHORIZATION_STATE":
      return record.lifecycle === "REVOKED" || record.lifecycle === "REMOVED";
    case "RECOVERY_AUTHORIZATION_ATTACHMENT":
      return record.lifecycle === "TERMINAL" || record.lifecycle === "REMOVED";
    case "RECOVERY_ATTEMPT_ACCUMULATOR":
      return record.lifecycle === "TERMINAL";
    case "RECOVERY_ATTEMPT_RESERVATION":
      return record.lifecycle === "TERMINAL" || record.lifecycle === "TOMBSTONE";
    case "AUTHORITY_RETENTION":
    case "STATE_MUTATION_AUTHORITY_ROTATION":
      return false;
  }
}
function requireEqualBinding(
  record: ContractRecord,
  recordField: string,
  expected: JsonValue,
): void {
  if (record[recordField] !== expected) throw new TypeError(`${recordField}:binding-mismatch`);
}
function pointerPathMatches(
  kind: PointerKind,
  value: unknown,
  bindings: PointerPathBindings,
): value is string {
  if (typeof value !== "string") return false;
  try {
    return value === pointerPath(kind, bindings);
  } catch {
    return false;
  }
}

export function computePointerValueDigest(
  kind: PointerKind,
  pathInstanceDigest: string,
  value: JsonValue,
): string {
  requirePointerKind(kind);
  safeDigest(pathInstanceDigest, "pathInstanceDigest");
  const record = requirePointerValueRecord(kind, value);
  return hashFrame("pointer-value/v2", [
    textPart(kind),
    rawPart(pathInstanceDigest),
    canonicalPart(record),
  ]);
}

export function computeRecoveryAuthorizationCoreDigest(core: JsonValue): string {
  const record = requireSchemaRecord("recovery-authorization-core/v1", core);
  return hashFrame("recovery-authorization-core/v1", [canonicalPart(record)]);
}

export function computeReservationPredecessorKey(input: unknown): string {
  const closed = requireClosedInput(input, [
    "priorDr",
    "priorDt",
    "priorDv",
    "sourceToken",
    "transactionId",
  ]);
  safeUuid(String(closed.transactionId), "transactionId");
  if (!["recovery-fence-v2", "cleanup-gate-pre-fence-v2"].includes(String(closed.sourceToken)))
    throw new TypeError("sourceToken:invalid");
  const prior = [closed.priorDt, closed.priorDv, closed.priorDr];
  const genesis = prior.every((digest) => digest === null);
  if (
    !genesis &&
    !prior.every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest))
  )
    throw new TypeError("predecessor:partial-or-invalid");
  return hashFrame("recovery-attempt-reservation-predecessor/v1", [
    textPart(closed.transactionId as string),
    textPart(closed.sourceToken as string),
    rawFixedPart(genesis ? "00" : "01"),
    ...(genesis
      ? []
      : [
          rawPart(closed.priorDt as string),
          rawPart(closed.priorDv as string),
          rawPart(closed.priorDr as string),
        ]),
  ]);
}

const positionFields: Readonly<Record<PointerKind, readonly string[]>> = Object.freeze({
  ACTIVE_RELEASE: ["cleanupTransactionId", "releaseDigest", "valueDigest"],
  ACTIVATION_CLEANUP_GATE: ["headDigest", "ordinal", "rootDigest"],
  ACTIVATION_RECOVERY_FENCE: ["headDigest", "ordinal", "rootDigest"],
  ACTIVATION_RECOVERY_LAUNCH: ["attemptId", "ordinal", "stateDigest"],
  RECOVERY_AUTHORIZATION_STATE: ["lifecycle", "stateDigest", "transactionId"],
  RECOVERY_AUTHORIZATION_ATTACHMENT: ["attachmentDigest", "lifecycle", "transactionId"],
  RECOVERY_ATTEMPT_ACCUMULATOR: ["accumulatorDigest", "lifecycle", "sourceToken", "transactionId"],
  ACTIVATION_CLEANUP_ARCHIVE_HEAD: ["archiveDigest", "previousArchiveHeadDigest", "transactionId"],
  AUTHORITY_RETENTION: ["pathInstanceDigest", "phase", "retentionDigest"],
  RECOVERY_ATTEMPT_RESERVATION: [
    "attemptId",
    "predecessorKey",
    "reservationDigest",
    "sourceToken",
    "transactionId",
  ],
  STATE_MUTATION_AUTHORITY_ROTATION: [
    "activeReleaseValueDigest",
    "authorityDigest",
    "rotationKind",
  ],
});

type PositionScalarRule =
  | "SHA256"
  | "NULLABLE_SHA256"
  | "UUID_V7"
  | "NON_NEGATIVE_INTEGER"
  | { readonly enum: readonly string[] };

const positionRules: Readonly<Record<PointerKind, Readonly<Record<string, PositionScalarRule>>>> =
  Object.freeze({
    ACTIVE_RELEASE: Object.freeze({
      cleanupTransactionId: "UUID_V7",
      releaseDigest: "SHA256",
      valueDigest: "SHA256",
    }),
    ACTIVATION_CLEANUP_GATE: Object.freeze({
      headDigest: "SHA256",
      ordinal: "NON_NEGATIVE_INTEGER",
      rootDigest: "SHA256",
    }),
    ACTIVATION_RECOVERY_FENCE: Object.freeze({
      headDigest: "SHA256",
      ordinal: "NON_NEGATIVE_INTEGER",
      rootDigest: "SHA256",
    }),
    ACTIVATION_RECOVERY_LAUNCH: Object.freeze({
      attemptId: "UUID_V7",
      ordinal: "NON_NEGATIVE_INTEGER",
      stateDigest: "SHA256",
    }),
    RECOVERY_AUTHORIZATION_STATE: Object.freeze({
      lifecycle: { enum: Object.freeze(["CREATED", "CONSUMED", "REVOKED", "REMOVED"]) },
      stateDigest: "SHA256",
      transactionId: "UUID_V7",
    }),
    RECOVERY_AUTHORIZATION_ATTACHMENT: Object.freeze({
      attachmentDigest: "SHA256",
      lifecycle: { enum: Object.freeze(["UNATTACHED", "ATTACHED", "TERMINAL", "REMOVED"]) },
      transactionId: "UUID_V7",
    }),
    RECOVERY_ATTEMPT_ACCUMULATOR: Object.freeze({
      accumulatorDigest: "SHA256",
      lifecycle: { enum: Object.freeze(["IN_PROGRESS", "TERMINAL"]) },
      sourceToken: {
        enum: Object.freeze(["recovery-fence-v2", "cleanup-gate-pre-fence-v2"]),
      },
      transactionId: "UUID_V7",
    }),
    ACTIVATION_CLEANUP_ARCHIVE_HEAD: Object.freeze({
      archiveDigest: "SHA256",
      previousArchiveHeadDigest: "NULLABLE_SHA256",
      transactionId: "UUID_V7",
    }),
    AUTHORITY_RETENTION: Object.freeze({
      pathInstanceDigest: "SHA256",
      phase: {
        enum: Object.freeze([
          "CURRENT",
          "CHECKPOINTED",
          "COMPACTION_PLANNED",
          "COMPACTED",
          "AUDIT_DEGRADED",
          "UNKNOWN",
        ]),
      },
      retentionDigest: "SHA256",
    }),
    RECOVERY_ATTEMPT_RESERVATION: Object.freeze({
      attemptId: "UUID_V7",
      predecessorKey: "SHA256",
      reservationDigest: "SHA256",
      sourceToken: {
        enum: Object.freeze(["recovery-fence-v2", "cleanup-gate-pre-fence-v2"]),
      },
      transactionId: "UUID_V7",
    }),
    STATE_MUTATION_AUTHORITY_ROTATION: Object.freeze({
      activeReleaseValueDigest: "SHA256",
      authorityDigest: "SHA256",
      rotationKind: { enum: Object.freeze(["GENESIS", "ROTATION"]) },
    }),
  });

const tombstonePositionRules = Object.freeze({
  archiveDigest: "SHA256",
  priorDr: "SHA256",
  priorDt: "SHA256",
  priorDv: "SHA256",
  terminalProofDigest: "SHA256",
} as const);

export const pointerPositionContracts = Object.freeze(
  Object.fromEntries(
    pointerRegistry.map((row) => [
      row.kind,
      Object.freeze({
        ordinaryDomain: row.positionDomain,
        ordinaryFields: Object.freeze(positionFields[row.kind]),
        tombstoneDomain: row.tombstonePositionDomain,
        tombstoneFields:
          row.tombstonePositionDomain === null
            ? null
            : Object.freeze(Object.keys(tombstonePositionRules).sort()),
      }),
    ]),
  ) as Readonly<
    Record<
      PointerKind,
      {
        readonly ordinaryDomain: string;
        readonly ordinaryFields: readonly string[];
        readonly tombstoneDomain: string | null;
        readonly tombstoneFields: readonly string[] | null;
      }
    >
  >,
);

function validatePositionScalar(rule: PositionScalarRule, value: unknown): boolean {
  if (rule === "SHA256") return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  if (rule === "NULLABLE_SHA256")
    return value === null || (typeof value === "string" && /^[0-9a-f]{64}$/.test(value));
  if (rule === "UUID_V7")
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    );
  if (rule === "NON_NEGATIVE_INTEGER") return Number.isSafeInteger(value) && Number(value) >= 0;
  return typeof value === "string" && rule.enum.includes(value);
}

export function validatePointerPositionEvidence(
  kind: PointerKind,
  evidence: unknown,
): readonly string[] {
  const row = pointerRegistry.find((candidate) => candidate.kind === kind);
  if (!row) return Object.freeze(["pointerKind:invalid"]);
  const ordinaryFields = ["pointerKind", "variant", ...positionFields[kind]];
  const tombstoneFields = [
    "archiveDigest",
    "pointerKind",
    "priorDr",
    "priorDt",
    "priorDv",
    "terminalProofDigest",
    "variant",
  ];
  const ordinary = snapshotClosedRecord(evidence, ordinaryFields);
  const tombstone = snapshotClosedRecord(evidence, tombstoneFields);
  if (!ordinary.ok && !tombstone.ok) return Object.freeze(["position:shape-invalid"]);
  const isTombstone = !ordinary.ok;
  if (isTombstone && row.tombstonePositionDomain === null)
    return Object.freeze(["position:tombstone-disabled"]);
  const record = ordinary.ok ? ordinary.value : tombstone.ok ? tombstone.value : undefined;
  if (!record) return Object.freeze(["position:shape-invalid"]);
  const issues: string[] = [];
  if (record.pointerKind !== kind) issues.push("pointerKind:position-mismatch");
  if (record.variant !== (isTombstone ? "TOMBSTONE" : "ORDINARY")) issues.push("variant:mismatch");
  const rules = isTombstone ? tombstonePositionRules : positionRules[kind];
  for (const [name, rule] of Object.entries(rules))
    if (!validatePositionScalar(rule, record[name])) issues.push(`${name}:invalid`);
  return Object.freeze(issues);
}

export function derivePointerPositionEvidence(
  kind: PointerKind,
  valueInput: JsonValue,
  pathBindings: PointerPathBindings = {},
): ContractRecord {
  const value = requirePointerValueRecord(kind, valueInput);
  const digestValue = canonicalDigest(value);
  if (value.schemaVersion === "pointer-tombstone-value/v1")
    return Object.freeze({
      pointerKind: kind,
      variant: "TOMBSTONE",
      archiveDigest: value.archiveDigest!,
      priorDr: value.priorReceiptDigest!,
      priorDt: value.priorTipDigest!,
      priorDv: value.priorValueDigest!,
      terminalProofDigest: value.terminalProofDigest!,
    });
  switch (kind) {
    case "ACTIVE_RELEASE":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        cleanupTransactionId: value.cleanupTransactionId!,
        releaseDigest: value.releaseDigest!,
        valueDigest: digestValue,
      });
    case "ACTIVATION_CLEANUP_GATE":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        headDigest: digestValue,
        ordinal: value.ordinal!,
        rootDigest: value.rootDigest!,
      });
    case "ACTIVATION_RECOVERY_FENCE":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        headDigest: digestValue,
        ordinal: value.ordinal!,
        rootDigest: value.rootDigest!,
      });
    case "ACTIVATION_RECOVERY_LAUNCH":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        attemptId: value.attemptId!,
        ordinal: value.ordinal!,
        stateDigest: digestValue,
      });
    case "RECOVERY_AUTHORIZATION_STATE":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        lifecycle: value.lifecycle!,
        stateDigest: digestValue,
        transactionId: value.transactionId!,
      });
    case "RECOVERY_AUTHORIZATION_ATTACHMENT":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        attachmentDigest: digestValue,
        lifecycle: value.lifecycle!,
        transactionId: value.transactionId!,
      });
    case "RECOVERY_ATTEMPT_ACCUMULATOR":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        accumulatorDigest: digestValue,
        lifecycle: value.lifecycle!,
        sourceToken: value.sourceToken!,
        transactionId: value.transactionId!,
      });
    case "ACTIVATION_CLEANUP_ARCHIVE_HEAD":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        archiveDigest: value.archiveDigest!,
        previousArchiveHeadDigest: value.previousArchiveHeadDigest!,
        transactionId: value.transactionId!,
      });
    case "AUTHORITY_RETENTION":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        pathInstanceDigest: value.pathInstanceDigest!,
        phase: value.phase!,
        retentionDigest: digestValue,
      });
    case "RECOVERY_ATTEMPT_RESERVATION":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        attemptId: value.attemptId!,
        predecessorKey: pathBindings.predecessorKey!,
        reservationDigest: digestValue,
        sourceToken: value.sourceToken!,
        transactionId: value.transactionId!,
      });
    case "STATE_MUTATION_AUTHORITY_ROTATION":
      return Object.freeze({
        pointerKind: kind,
        variant: "ORDINARY",
        activeReleaseValueDigest: value.activeReleaseValueDigest!,
        authorityDigest: digestValue,
        rotationKind: value.rotationKind!,
      });
  }
}

export function computePointerPositionDigest(kind: PointerKind, evidence: unknown): string {
  const row = pointerRegistry.find((candidate) => candidate.kind === kind);
  if (!row) throw new TypeError("pointerKind:invalid");
  const issues = validatePointerPositionEvidence(kind, evidence);
  if (issues.length > 0) throw new TypeError(issues.join(","));
  const ordinary = snapshotClosedRecord(evidence, [
    "pointerKind",
    "variant",
    ...positionFields[kind],
  ]);
  const tombstoneFields = [
    "archiveDigest",
    "pointerKind",
    "priorDr",
    "priorDt",
    "priorDv",
    "terminalProofDigest",
    "variant",
  ];
  const tombstoneResult = snapshotClosedRecord(evidence, tombstoneFields);
  const tombstone = !ordinary.ok && tombstoneResult.ok;
  if (!ordinary.ok && !tombstoneResult.ok) throw new TypeError("position:shape-invalid");
  const closed = ordinary.ok
    ? ordinary.value
    : tombstoneResult.ok
      ? tombstoneResult.value
      : (() => {
          throw new TypeError("position:shape-invalid");
        })();
  return hashFrame(tombstone ? row.tombstonePositionDomain! : row.positionDomain, [
    canonicalPart(closed),
  ]);
}
export interface PointerInstanceDigestInput {
  pointerKind: PointerKind;
  canonicalPointerPath: string;
  installationId: string;
  projectId: string;
  stateRootDigest: string;
  transactionId: string | null;
  sourceToken: string;
  predecessorKey?: string;
  retainedPointerInstanceDigest?: string;
}
export function computePointerInstanceDigest(input: PointerInstanceDigestInput): string {
  const kindInput = requirePointerKind(input.pointerKind);
  const rowInput = pointerRegistry.find((candidate) => candidate.kind === kindInput)!;
  const closed = requireClosedInput(input, [
    "canonicalPointerPath",
    "installationId",
    "pointerKind",
    ...(rowInput.pathTemplate.includes("<predecessor-key>") ? ["predecessorKey"] : []),
    "projectId",
    ...(rowInput.pathTemplate.includes("<pointer-instance-digest>")
      ? ["retainedPointerInstanceDigest"]
      : []),
    "sourceToken",
    "stateRootDigest",
    "transactionId",
  ]);
  const kind = requirePointerKind(closed.pointerKind);
  safeUuid(String(closed.installationId), "installationId");
  safeUuid(String(closed.projectId), "projectId");
  safeDigest(String(closed.stateRootDigest), "stateRootDigest");
  const row = pointerRegistry.find((candidate) => candidate.kind === kind)!;
  validateIdentityPolicy(row, closed.transactionId, closed.sourceToken);
  if (row.pathTemplate.includes("<predecessor-key>"))
    safeDigest(String(closed.predecessorKey), "predecessorKey");
  if (row.pathTemplate.includes("<pointer-instance-digest>"))
    safeDigest(String(closed.retainedPointerInstanceDigest), "retainedPointerInstanceDigest");
  const pathBindings: PointerPathBindings = {
    ...(row.pathTemplate.includes("<transaction>")
      ? { transactionId: closed.transactionId as string }
      : {}),
    ...(row.pathTemplate.includes("<source>") ? { sourceToken: closed.sourceToken as string } : {}),
    ...(row.pathTemplate.includes("<predecessor-key>")
      ? { predecessorKey: closed.predecessorKey as string }
      : {}),
    ...(row.pathTemplate.includes("<pointer-instance-digest>")
      ? { pointerInstanceDigest: closed.retainedPointerInstanceDigest as string }
      : {}),
  };
  if (!pointerPathMatches(kind, closed.canonicalPointerPath, pathBindings))
    throw new TypeError("canonicalPointerPath:mismatch");
  return hashFrame("pointer-instance/v2", [
    textPart(kind),
    textPart(closed.canonicalPointerPath as string),
    textPart(closed.installationId as string),
    textPart(closed.projectId as string),
    rawPart(closed.stateRootDigest as string),
    nullableTextPart(closed.transactionId as string | null),
    textPart(closed.sourceToken as string),
  ]);
}
export interface ProposalDigestInput {
  pointerKind: PointerKind;
  pathInstanceDigest: string;
  mutationId: string;
  priorDt: string | null;
  priorDv: string | null;
  priorDr: string | null;
  successorDv: string;
  positionDigest: string;
  intent: "VALUE_PROPOSED" | "TOMBSTONE_PROPOSED";
  outcome: "SELECT" | "REMOVE";
  authorityEpochDt: string;
  authorityEpochDv: string;
  authorityEpochDr: string;
  receipt: JsonValue;
}
export function computeProposalReceiptDigest(input: ProposalDigestInput): string {
  const closed = requireClosedInput(input, [
    "authorityEpochDr",
    "authorityEpochDt",
    "authorityEpochDv",
    "intent",
    "mutationId",
    "outcome",
    "pathInstanceDigest",
    "pointerKind",
    "positionDigest",
    "priorDr",
    "priorDt",
    "priorDv",
    "receipt",
    "successorDv",
  ]);
  const kind = requirePointerKind(closed.pointerKind);
  for (const name of [
    "authorityEpochDr",
    "authorityEpochDt",
    "authorityEpochDv",
    "mutationId",
    "pathInstanceDigest",
    "positionDigest",
    "successorDv",
  ])
    safeDigest(String(closed[name]), name);
  for (const name of ["priorDr", "priorDt", "priorDv"])
    if (closed[name] !== null) safeDigest(String(closed[name]), name);
  if (closed.intent !== "VALUE_PROPOSED" && closed.intent !== "TOMBSTONE_PROPOSED")
    throw new TypeError("intent:invalid");
  if (closed.outcome !== "SELECT" && closed.outcome !== "REMOVE")
    throw new TypeError("outcome:invalid");
  const receipt = requireSchemaRecord("pointer-cas-proposal-receipt/v1", closed.receipt);
  for (const [fieldName, expected] of [
    ["pointerKind", kind],
    ["pathInstanceDigest", closed.pathInstanceDigest],
    ["mutationId", closed.mutationId],
    ["priorTipDigest", closed.priorDt],
    ["priorValueDigest", closed.priorDv],
    ["priorReceiptDigest", closed.priorDr],
    ["successorValueDigest", closed.successorDv],
    ["positionDigest", closed.positionDigest],
    ["intent", closed.intent],
    ["outcome", closed.outcome],
    ["authorityEpochTipDigest", closed.authorityEpochDt],
    ["authorityEpochValueDigest", closed.authorityEpochDv],
    ["authorityEpochReceiptDigest", closed.authorityEpochDr],
  ] as const)
    requireEqualBinding(receipt, fieldName, expected as JsonValue);
  return hashFrame("pointer-receipt/v2", [
    textPart(kind),
    rawPart(closed.pathInstanceDigest as string),
    rawPart(closed.mutationId as string),
    nullableRawPart(closed.priorDt as string | null),
    nullableRawPart(closed.priorDv as string | null),
    nullableRawPart(closed.priorDr as string | null),
    rawPart(closed.successorDv as string),
    rawPart(closed.positionDigest as string),
    textPart(closed.intent as string),
    textPart(closed.outcome as string),
    canonicalPart(receipt),
  ]);
}
export function computeCurrentTipDigest(
  kind: PointerKind,
  pathInstanceDigest: string,
  dv: string,
  dr: string,
  tip: JsonValue,
): string {
  requirePointerKind(kind);
  safeDigest(pathInstanceDigest, "pathInstanceDigest");
  safeDigest(dv, "dv");
  safeDigest(dr, "dr");
  const record = requireSchemaRecord("pointer-current-tip/v1", tip);
  requireEqualBinding(record, "pointerKind", kind);
  requireEqualBinding(record, "pathInstanceDigest", pathInstanceDigest);
  requireEqualBinding(record, "valueDigest", dv);
  requireEqualBinding(record, "proposalReceiptDigest", dr);
  return hashFrame("pointer-tip/v2", [
    textPart(kind),
    rawPart(pathInstanceDigest),
    rawPart(dv),
    rawPart(dr),
    canonicalPart(record),
  ]);
}
export interface MutationDigestInput {
  pointerKind: PointerKind;
  canonicalPointerPath: string;
  pathInstanceDigest: string;
  transactionId: string | null;
  sourceToken: string;
  positionEvidence: ContractRecord;
  priorDt: string | null;
  priorDv: string | null;
  priorDr: string | null;
  successorDv: string;
  outcome: string;
  intent: string;
  predecessorKey?: string;
  retainedPointerInstanceDigest?: string;
}
export function computeMutationId(input: MutationDigestInput): string {
  const kindInput = requirePointerKind(input.pointerKind);
  const rowInput = pointerRegistry.find((candidate) => candidate.kind === kindInput)!;
  const closed = requireClosedInput(input, [
    "canonicalPointerPath",
    "intent",
    "outcome",
    "pathInstanceDigest",
    "pointerKind",
    ...(rowInput.pathTemplate.includes("<predecessor-key>") ? ["predecessorKey"] : []),
    "positionEvidence",
    "priorDr",
    "priorDt",
    "priorDv",
    ...(rowInput.pathTemplate.includes("<pointer-instance-digest>")
      ? ["retainedPointerInstanceDigest"]
      : []),
    "sourceToken",
    "successorDv",
    "transactionId",
  ]);
  const kind = requirePointerKind(closed.pointerKind);
  const row = pointerRegistry.find((candidate) => candidate.kind === kind)!;
  if (row.pathTemplate.includes("<predecessor-key>"))
    safeDigest(String(closed.predecessorKey), "predecessorKey");
  if (row.pathTemplate.includes("<pointer-instance-digest>"))
    safeDigest(String(closed.retainedPointerInstanceDigest), "retainedPointerInstanceDigest");
  const pathBindings: PointerPathBindings = {
    ...(row.pathTemplate.includes("<transaction>")
      ? { transactionId: closed.transactionId as string }
      : {}),
    ...(row.pathTemplate.includes("<source>") ? { sourceToken: closed.sourceToken as string } : {}),
    ...(row.pathTemplate.includes("<predecessor-key>")
      ? { predecessorKey: closed.predecessorKey as string }
      : {}),
    ...(row.pathTemplate.includes("<pointer-instance-digest>")
      ? { pointerInstanceDigest: closed.retainedPointerInstanceDigest as string }
      : {}),
  };
  if (!pointerPathMatches(kind, closed.canonicalPointerPath, pathBindings))
    throw new TypeError("canonicalPointerPath:mismatch");
  for (const name of ["pathInstanceDigest", "successorDv"]) safeDigest(String(closed[name]), name);
  for (const name of ["priorDr", "priorDt", "priorDv"])
    if (closed[name] !== null) safeDigest(String(closed[name]), name);
  validateIdentityPolicy(row, closed.transactionId, closed.sourceToken);
  const positionDigest = computePointerPositionDigest(kind, closed.positionEvidence);
  if (closed.intent !== "VALUE_PROPOSED" && closed.intent !== "TOMBSTONE_PROPOSED")
    throw new TypeError("intent:invalid");
  if (closed.outcome !== "SELECT" && closed.outcome !== "REMOVE")
    throw new TypeError("outcome:invalid");
  return hashFrame("pointer-mutation-id/v2", [
    textPart(kind),
    textPart(closed.canonicalPointerPath as string),
    rawPart(closed.pathInstanceDigest as string),
    nullableTextPart(closed.transactionId as string | null),
    textPart(closed.sourceToken as string),
    rawPart(positionDigest),
    nullableRawPart(closed.priorDt as string | null),
    nullableRawPart(closed.priorDv as string | null),
    nullableRawPart(closed.priorDr as string | null),
    rawPart(closed.successorDv as string),
    textPart(closed.outcome as string),
    textPart(closed.intent as string),
  ]);
}
export interface ConflictDigestInput {
  pathInstanceDigest: string;
  mutationId: string;
  losingDr: string;
  losingDv: string;
  winningDt: string;
  winningDv: string;
  winningDr: string;
  conflictKind: string;
  authorityEpochDt: string;
  authorityEpochDv: string;
  authorityEpochDr: string;
  conflictAt: string;
  receipt: JsonValue;
}
export function computeConflictDigest(input: ConflictDigestInput): string {
  const closed = requireClosedInput(input, [
    "authorityEpochDr",
    "authorityEpochDt",
    "authorityEpochDv",
    "conflictAt",
    "conflictKind",
    "losingDr",
    "losingDv",
    "mutationId",
    "pathInstanceDigest",
    "receipt",
    "winningDr",
    "winningDt",
    "winningDv",
  ]);
  for (const name of [
    "authorityEpochDr",
    "authorityEpochDt",
    "authorityEpochDv",
    "losingDr",
    "losingDv",
    "mutationId",
    "pathInstanceDigest",
    "winningDr",
    "winningDt",
    "winningDv",
  ])
    safeDigest(String(closed[name]), name);
  if (!isCanonicalTimestamp(closed.conflictAt)) throw new TypeError("conflictAt:invalid");
  if (
    !["VALUE_CONFLICT", "TOMBSTONE_CONFLICT", "EPOCH_CONFLICT"].includes(
      String(closed.conflictKind),
    )
  )
    throw new TypeError("conflictKind:invalid");
  const receipt = requireSchemaRecord("pointer-conflict-receipt/v1", closed.receipt);
  for (const [fieldName, expected] of [
    ["pathInstanceDigest", closed.pathInstanceDigest],
    ["mutationId", closed.mutationId],
    ["losingProposalReceiptDigest", closed.losingDr],
    ["losingSuccessorValueDigest", closed.losingDv],
    ["winningTipDigest", closed.winningDt],
    ["winningValueDigest", closed.winningDv],
    ["winningReceiptDigest", closed.winningDr],
    ["conflictKind", closed.conflictKind],
    ["authorityEpochTipDigest", closed.authorityEpochDt],
    ["authorityEpochValueDigest", closed.authorityEpochDv],
    ["authorityEpochReceiptDigest", closed.authorityEpochDr],
    ["conflictAt", closed.conflictAt],
  ] as const)
    requireEqualBinding(receipt, fieldName, expected as JsonValue);
  return hashFrame("pointer-conflict-receipt/v1", [
    rawPart(closed.pathInstanceDigest as string),
    rawPart(closed.mutationId as string),
    rawPart(closed.losingDr as string),
    rawPart(closed.losingDv as string),
    rawPart(closed.winningDt as string),
    rawPart(closed.winningDv as string),
    rawPart(closed.winningDr as string),
    textPart(closed.conflictKind as string),
    rawPart(closed.authorityEpochDt as string),
    rawPart(closed.authorityEpochDv as string),
    rawPart(closed.authorityEpochDr as string),
    textPart(closed.conflictAt as string),
    canonicalPart(receipt),
  ]);
}

export type ProposalClassification =
  "PENDING" | "SELECTED" | "LOST_CONFLICT" | "COMPACTED" | "UNKNOWN";
export function classifyProposal(input: unknown): ProposalClassification {
  const closed = snapshotClosedRecord(input, [
    "checkpointSelected",
    "compacted",
    "completionSelected",
    "conflictMatchesWinner",
    "malformed",
    "pending",
    "planSelected",
    "selectedTipMatches",
  ]);
  if (!closed.ok) return "UNKNOWN";
  for (const name of [
    "checkpointSelected",
    "compacted",
    "completionSelected",
    "conflictMatchesWinner",
    "malformed",
    "pending",
    "planSelected",
    "selectedTipMatches",
  ])
    if (typeof closed.value[name] !== "boolean") return "UNKNOWN";
  if (closed.value.malformed === true) return "UNKNOWN";
  const selected = closed.value.selectedTipMatches === true;
  const lost = closed.value.conflictMatchesWinner === true;
  const compacted = closed.value.compacted === true;
  const pending = closed.value.pending === true;
  if ([selected, lost, compacted, pending].filter(Boolean).length !== 1) return "UNKNOWN";
  if (selected) return "SELECTED";
  if (lost) return "LOST_CONFLICT";
  if (compacted)
    return closed.value.checkpointSelected === true &&
      closed.value.planSelected === true &&
      closed.value.completionSelected === true
      ? "COMPACTED"
      : "UNKNOWN";
  if (pending) return "PENDING";
  return "UNKNOWN";
}

export type RetentionOperation =
  | "EXISTING_RECOVERY"
  | "EXISTING_RETRY"
  | "EXISTING_CLEANUP"
  | "SELECTED_ATTACHMENT"
  | "ORDINARY_NON_RELEASE_TICK"
  | "NEW_PROMOTION"
  | "NEW_BOOTSTRAP"
  | "CERTIFICATION"
  | "UNRELATED_AUTHORIZATION"
  | "UNRELATED_ATTACHMENT"
  | "COMPACTION"
  | "AUDIT_FINALIZATION";
const degradedAllowed = new Set<RetentionOperation>([
  "EXISTING_RECOVERY",
  "EXISTING_RETRY",
  "EXISTING_CLEANUP",
  "SELECTED_ATTACHMENT",
  "ORDINARY_NON_RELEASE_TICK",
]);
export function retentionAllows(
  status:
    "CURRENT" | "CHECKPOINTED" | "COMPACTION_PLANNED" | "COMPACTED" | "AUDIT_DEGRADED" | "UNKNOWN",
  operation: RetentionOperation,
): boolean {
  if (
    ![
      "CURRENT",
      "CHECKPOINTED",
      "COMPACTION_PLANNED",
      "COMPACTED",
      "AUDIT_DEGRADED",
      "UNKNOWN",
    ].includes(status) ||
    ![
      "EXISTING_RECOVERY",
      "EXISTING_RETRY",
      "EXISTING_CLEANUP",
      "SELECTED_ATTACHMENT",
      "ORDINARY_NON_RELEASE_TICK",
      "NEW_PROMOTION",
      "NEW_BOOTSTRAP",
      "CERTIFICATION",
      "UNRELATED_AUTHORIZATION",
      "UNRELATED_ATTACHMENT",
      "COMPACTION",
      "AUDIT_FINALIZATION",
    ].includes(operation)
  )
    return false;
  if (status === "UNKNOWN") return false;
  if (status === "AUDIT_DEGRADED") return degradedAllowed.has(operation);
  return true;
}

export function validateRetentionTransition(input: unknown): boolean {
  const closed = snapshotClosedRecord(input, [
    "checkpointDigest",
    "completionReceiptDigest",
    "lossProofDigest",
    "nextPhase",
    "planDigest",
    "previousPhase",
    "proposalClassification",
    "recordClass",
  ]);
  if (!closed.ok || closed.value.recordClass !== "TERMINAL_ATTEMPT_HISTORY") return false;
  if (
    !["SELECTED", "LOST_CONFLICT", "COMPACTED"].includes(
      String(closed.value.proposalClassification),
    )
  )
    return false;
  for (const name of [
    "checkpointDigest",
    "completionReceiptDigest",
    "lossProofDigest",
    "planDigest",
  ])
    if (closed.value[name] !== null && !/^[0-9a-f]{64}$/.test(String(closed.value[name])))
      return false;
  const allowed = new Set([
    "CURRENT>CHECKPOINTED",
    "CHECKPOINTED>COMPACTION_PLANNED",
    "COMPACTION_PLANNED>COMPACTED",
    "COMPACTED>AUDIT_DEGRADED",
  ]);
  const edge = `${closed.value.previousPhase}>${closed.value.nextPhase}`;
  if (!allowed.has(edge)) return false;
  const checkpoint = closed.value.checkpointDigest !== null;
  const plan = closed.value.planDigest !== null;
  const completion = closed.value.completionReceiptDigest !== null;
  const loss = closed.value.lossProofDigest !== null;
  if (edge === "CURRENT>CHECKPOINTED") return checkpoint && !plan && !completion && !loss;
  if (edge === "CHECKPOINTED>COMPACTION_PLANNED") return checkpoint && plan && !completion && !loss;
  if (edge === "COMPACTION_PLANNED>COMPACTED") return checkpoint && plan && completion && !loss;
  return checkpoint && plan && completion && loss;
}

export const v2Definitions = Object.freeze(
  Object.fromEntries(
    [
      define("pointer-current-tip/v1", {
        pointerKind: enumeration(...pointerKinds),
        pathInstanceDigest: sha,
        valueDigest: sha,
        proposalReceiptDigest: sha,
      }),
      define(
        "pointer-cas-proposal-receipt/v1",
        {
          pointerKind: enumeration(...pointerKinds),
          pathInstanceDigest: sha,
          mutationId: sha,
          priorTipDigest: nullableSha,
          priorValueDigest: nullableSha,
          priorReceiptDigest: nullableSha,
          successorValueDigest: sha,
          positionDigest: sha,
          intent: enumeration("VALUE_PROPOSED", "TOMBSTONE_PROPOSED"),
          outcome: enumeration("SELECT", "REMOVE"),
          authorityEpochTipDigest: sha,
          authorityEpochValueDigest: sha,
          authorityEpochReceiptDigest: sha,
          proposedAt: timestamp,
        },
        (record) =>
          exactOptionalGroup(record, ["priorTipDigest", "priorValueDigest", "priorReceiptDigest"]),
      ),
      define("pointer-conflict-receipt/v1", {
        pathInstanceDigest: sha,
        mutationId: sha,
        losingProposalReceiptDigest: sha,
        losingSuccessorValueDigest: sha,
        winningTipDigest: sha,
        winningValueDigest: sha,
        winningReceiptDigest: sha,
        conflictKind: enumeration("VALUE_CONFLICT", "TOMBSTONE_CONFLICT", "EPOCH_CONFLICT"),
        authorityEpochTipDigest: sha,
        authorityEpochValueDigest: sha,
        authorityEpochReceiptDigest: sha,
        conflictAt: timestamp,
      }),
      define("pointer-tombstone-value/v1", {
        pointerKind: enumeration(...pointerKinds),
        priorTipDigest: sha,
        priorValueDigest: sha,
        priorReceiptDigest: sha,
        archiveDigest: sha,
        terminalProofDigest: sha,
        tombstonedAt: timestamp,
      }),
      define(
        "pointer-terminal-proof/v1",
        {
          pointerKind: enumeration(...pointerKinds),
          canonicalPointerPath: path,
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          pathInstanceDigest: sha,
          transactionId: uuid,
          sourceToken: enumeration("none", "recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          authorityEpochTipDigest: sha,
          authorityEpochValueDigest: sha,
          authorityEpochReceiptDigest: sha,
          priorAuthorityEpochTipDigest: sha,
          priorAuthorityEpochValueDigest: sha,
          priorAuthorityEpochReceiptDigest: sha,
          terminalTipDigest: sha,
          terminalValueDigest: sha,
          terminalReceiptDigest: sha,
          terminalPositionDigest: sha,
          terminalValueSchemaVersion: field("schema-id"),
        },
        (record) =>
          String(value(record, "terminalValueSchemaVersion")) === "pointer-tombstone-value/v1"
            ? ["terminalValueSchemaVersion:tombstone-refused"]
            : [],
      ),
      define(
        "pointer-archive-record/v1",
        {
          pointerKind: enumeration(...pointerKinds),
          canonicalPointerPath: path,
          archivePath: field("bounded-string"),
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          pathInstanceDigest: sha,
          transactionId: uuid,
          sourceToken: enumeration("none", "recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          authorityEpochTipDigest: sha,
          authorityEpochValueDigest: sha,
          authorityEpochReceiptDigest: sha,
          priorAuthorityEpochTipDigest: sha,
          priorAuthorityEpochValueDigest: sha,
          priorAuthorityEpochReceiptDigest: sha,
          priorTipDigest: sha,
          priorValueDigest: sha,
          priorReceiptDigest: sha,
          priorPositionDigest: sha,
          priorValueSchemaVersion: field("schema-id"),
          terminalProofDigest: sha,
          archivedAt: timestamp,
        },
        (record) => {
          const archivePath = String(value(record, "archivePath"));
          const normalized = archivePath.endsWith("/") ? archivePath.slice(0, -1) : archivePath;
          return isContractRelativePath(normalized) ? [] : ["archivePath:invalid"];
        },
      ),
      define(
        "authority-retention/v1",
        {
          pointerKind: enumeration(...pointerKinds),
          pathInstanceDigest: sha,
          recordClass: enumeration("CURRENT_AUTHORITY", "TERMINAL_ATTEMPT_HISTORY"),
          phase: enumeration(
            "CURRENT",
            "CHECKPOINTED",
            "COMPACTION_PLANNED",
            "COMPACTED",
            "AUDIT_DEGRADED",
            "UNKNOWN",
          ),
          checkpointDigest: nullableSha,
          compactionPlanDigest: nullableSha,
          completionReceiptDigest: nullableSha,
          lossProofDigest: nullableSha,
          degradedAt: nullable("timestamp"),
          updatedAt: timestamp,
        },
        (record) => {
          const checkpoint = value(record, "checkpointDigest") !== null;
          const plan = value(record, "compactionPlanDigest") !== null;
          const completion = value(record, "completionReceiptDigest") !== null;
          const loss = value(record, "lossProofDigest") !== null;
          const degradedAt = value(record, "degradedAt") !== null;
          if (value(record, "recordClass") === "CURRENT_AUTHORITY")
            return value(record, "phase") === "CURRENT" &&
              !checkpoint &&
              !plan &&
              !completion &&
              !loss &&
              !degradedAt
              ? []
              : ["recordClass:current-authority-retention-mismatch"];
          switch (value(record, "phase")) {
            case "CURRENT":
              return !checkpoint && !plan && !completion && !loss && !degradedAt
                ? []
                : ["phase:current-fields-mismatch"];
            case "CHECKPOINTED":
              return checkpoint && !plan && !completion && !loss && !degradedAt
                ? []
                : ["phase:checkpoint-fields-mismatch"];
            case "COMPACTION_PLANNED":
              return checkpoint && plan && !completion && !loss && !degradedAt
                ? []
                : ["phase:plan-fields-mismatch"];
            case "COMPACTED":
              return checkpoint && plan && completion && !loss && !degradedAt
                ? []
                : ["phase:completion-fields-mismatch"];
            case "AUDIT_DEGRADED":
              return checkpoint && plan && completion && loss && degradedAt
                ? []
                : ["phase:degraded-fields-mismatch"];
            default:
              return [];
          }
        },
      ),
      define(
        "state-mutation-authority-value/v1",
        {
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          helperPath: path,
          helperDigest: sha,
          helperProfileDigest: sha,
          helperAbi: enumeration("portable-state-cas/v2"),
          lockPath: enumeration(stateMutationLockPath),
          lockProfileDigest: sha,
          custodyPrincipalDigest: sha,
          custodyReceiptDigest: sha,
          handleInheritance: enumeration("DENY"),
          activeReleaseTipDigest: sha,
          activeReleaseValueDigest: sha,
          activeReleaseReceiptDigest: sha,
          priorAuthorityTipDigest: nullableSha,
          priorAuthorityValueDigest: nullableSha,
          priorAuthorityReceiptDigest: nullableSha,
          priorHelperDigest: nullableSha,
          priorHelperProfileDigest: nullableSha,
          priorHelperAbiDigest: nullableSha,
          priorCustodyReceiptDigest: nullableSha,
          rotationKind: enumeration("GENESIS", "ROTATION"),
          producerKind: enumeration("REVIEWED_BOOTSTRAP", "SELECTED_STABLE"),
          producerDigest: sha,
          producerExecutableDigest: sha,
          producerProfileDigest: sha,
          producerAbiDigest: sha,
          producerCustodyDigest: sha,
          selectedAt: timestamp,
        },
        (record) => {
          const predecessors = [
            "priorAuthorityTipDigest",
            "priorAuthorityValueDigest",
            "priorAuthorityReceiptDigest",
            "priorHelperDigest",
            "priorHelperProfileDigest",
            "priorHelperAbiDigest",
            "priorCustodyReceiptDigest",
          ];
          const genesis = value(record, "rotationKind") === "GENESIS";
          if (genesis)
            return value(record, "producerKind") === "REVIEWED_BOOTSTRAP" &&
              nullGroup(record, predecessors)
              ? []
              : ["rotation:genesis-authority-mismatch"];
          return value(record, "producerKind") === "SELECTED_STABLE" &&
            presentGroup(record, predecessors)
            ? []
            : ["rotation:predecessor-authority-mismatch"];
        },
      ),
      define("active-release/v2", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        releaseDigest: sha,
        executablePath: path,
        executableDigest: sha,
        operationManifestDigest: sha,
        cleanupTransactionId: uuid,
        cleanupArchivePath: path,
        cleanupArchiveDigest: nullableSha,
        activatedAt: timestamp,
      }),
      define(
        "activation-cleanup-gate-root/v2",
        {
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          transactionId: uuid,
          mode: enumeration("BOOTSTRAP", "SUCCESSOR"),
          candidateDigest: sha,
          grantDigest: nullableSha,
          installerDigest: nullableSha,
          destinationDigest: nullableSha,
          cycleId: nullable("uuid-v7"),
          admissionDigest: nullableSha,
          priorBrokerGeneration: nullable("integer"),
          successorBrokerGeneration: nullable("integer"),
          expectedActiveGeneration: nullable("integer"),
          predecessorReleaseDigest: nullableSha,
          successorReleaseDigest: nullableSha,
          predecessorExecutableDigest: nullableSha,
          successorExecutableDigest: nullableSha,
          predecessorOperationManifestDigest: nullableSha,
          successorOperationManifestDigest: nullableSha,
          fencePath: nullable("relative-path"),
          authorizationCoreDigest: sha,
          authorizationCorePath: path,
          authorizationCreatedTipDigest: sha,
          authorizationCreatedValueDigest: sha,
          authorizationCreatedReceiptDigest: sha,
          consumeOperationId: uuid,
          nativeConsumeReceiptPath: path,
          expectedActiveReleaseDigest: sha,
          expectedFenceRootDigest: nullableSha,
          priorCleanupArchiveHeadDigest: nullableSha,
          createdAt: timestamp,
        },
        (record) => {
          const bootstrap = ["grantDigest", "installerDigest", "destinationDigest"];
          const successor = [
            "cycleId",
            "admissionDigest",
            "priorBrokerGeneration",
            "successorBrokerGeneration",
            "expectedActiveGeneration",
            "predecessorReleaseDigest",
            "successorReleaseDigest",
            "predecessorExecutableDigest",
            "successorExecutableDigest",
            "predecessorOperationManifestDigest",
            "successorOperationManifestDigest",
            "fencePath",
          ];
          if (value(record, "mode") === "BOOTSTRAP")
            return presentGroup(record, bootstrap) &&
              nullGroup(record, successor) &&
              value(record, "expectedFenceRootDigest") === null
              ? []
              : ["mode:bootstrap-fields-mismatch"];
          const issues =
            nullGroup(record, bootstrap) &&
            presentGroup(record, successor) &&
            value(record, "expectedFenceRootDigest") !== null
              ? []
              : ["mode:successor-fields-mismatch"];
          if (
            presentGroup(record, ["priorBrokerGeneration", "successorBrokerGeneration"]) &&
            value(record, "successorBrokerGeneration") !==
              (value(record, "priorBrokerGeneration") as number) + 1
          )
            issues.push("brokerGeneration:not-adjacent");
          return issues;
        },
      ),
      define(
        "activation-cleanup-gate-head/v2",
        {
          rootDigest: sha,
          ordinal: integer,
          previousHeadDigest: nullableSha,
          lifecycle: enumeration("PENDING", "ACTIVATING", "ABORTING", "COMPLETE"),
          publication: enumeration("NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"),
          fenceDigest: nullableSha,
          abortRevocationReceiptDigest: nullableSha,
          terminalRevocationReceiptDigest: nullableSha,
          terminalProofDigest: nullableSha,
          archiveOutcomeDigest: nullableSha,
          recordedAt: timestamp,
        },
        (record) => {
          const issues: string[] = [];
          if (
            !isCleanupLifecyclePublicationPair(
              value(record, "lifecycle"),
              value(record, "publication"),
            )
          )
            issues.push("lifecycle+publication:inadmissible");
          if ((value(record, "ordinal") === 0) !== (value(record, "previousHeadDigest") === null))
            issues.push("previousHeadDigest:ordinal-mismatch");
          const lifecycle = value(record, "lifecycle");
          const publication = value(record, "publication");
          const fenceRequired = publication === "PUBLISHING" || publication === "PUBLISHED";
          if (fenceRequired !== (value(record, "fenceDigest") !== null))
            issues.push("fenceDigest:publication-mismatch");
          if (lifecycle === "PENDING" || lifecycle === "ACTIVATING") {
            if (
              !nullGroup(record, [
                "abortRevocationReceiptDigest",
                "terminalRevocationReceiptDigest",
                "terminalProofDigest",
                "archiveOutcomeDigest",
              ])
            )
              issues.push("lifecycle:preterminal-proof-mismatch");
          } else if (lifecycle === "COMPLETE") {
            if (
              !presentGroup(record, [
                "terminalRevocationReceiptDigest",
                "terminalProofDigest",
                "archiveOutcomeDigest",
              ]) ||
              value(record, "abortRevocationReceiptDigest") !== null
            )
              issues.push("lifecycle:complete-proof-mismatch");
          }
          return issues;
        },
      ),
      define("activation-recovery-fence-root/v2", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        transactionId: uuid,
        predecessorReleaseDigest: sha,
        successorReleaseDigest: sha,
        predecessorExecutableDigest: sha,
        successorExecutableDigest: sha,
        predecessorOperationManifestDigest: sha,
        successorOperationManifestDigest: sha,
        pendingAdmissionDigest: sha,
        expectedActiveReleaseDigest: sha,
        createdAt: timestamp,
      }),
      define(
        "activation-recovery-fence-head/v2",
        {
          rootDigest: sha,
          ordinal: integer,
          previousHeadDigest: nullableSha,
          lifecycle: enumeration("PREPARED", "POST_ACTIVATION"),
          recordedAt: timestamp,
        },
        (record) =>
          (value(record, "ordinal") === 0) === (value(record, "previousHeadDigest") === null)
            ? []
            : ["previousHeadDigest:ordinal-mismatch"],
      ),
      define(
        "activation-recovery-launch/v2",
        {
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          transactionId: uuid,
          sourceToken: enumeration("recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          attemptId: uuid,
          ordinal: integer,
          previousRecordDigest: nullableSha,
          lifecycle: enumeration(
            "READY",
            "LIVE",
            "TERMINAL_RETRYABLE",
            "TERMINAL_HANDOFF",
            "TERMINAL_ABORTED",
            "TERMINAL_COMPLETE",
            "UNKNOWN",
          ),
          gateRootDigest: sha,
          gateHeadDigest: sha,
          fenceRootDigest: nullableSha,
          fenceHeadDigest: nullableSha,
          activeReleaseDigest: sha,
          argvDigest: sha,
          processIdentityDigest: nullableSha,
          terminalProofDigest: nullableSha,
          failureProofDigest: nullableSha,
          idempotencyKeyDigest: sha,
          recordedAt: timestamp,
        },
        (record) => {
          const issues: string[] = [];
          const ordinalZero = value(record, "ordinal") === 0;
          if (ordinalZero !== (value(record, "previousRecordDigest") === null))
            issues.push("previousRecordDigest:ordinal-mismatch");
          const fenceBacked = value(record, "sourceToken") === "recovery-fence-v2";
          if (fenceBacked !== presentGroup(record, ["fenceRootDigest", "fenceHeadDigest"]))
            issues.push("sourceToken:fence-fields-mismatch");
          const lifecycle = value(record, "lifecycle");
          if (
            lifecycle === "READY" &&
            !nullGroup(record, [
              "processIdentityDigest",
              "terminalProofDigest",
              "failureProofDigest",
            ])
          )
            issues.push("lifecycle:ready-fields-mismatch");
          if (
            lifecycle === "LIVE" &&
            (!presentGroup(record, ["processIdentityDigest"]) ||
              !nullGroup(record, ["terminalProofDigest", "failureProofDigest"]))
          )
            issues.push("lifecycle:live-fields-mismatch");
          if (
            String(lifecycle).startsWith("TERMINAL_") &&
            value(record, "terminalProofDigest") === null
          )
            issues.push("lifecycle:terminal-proof-missing");
          if (lifecycle === "UNKNOWN" && value(record, "failureProofDigest") === null)
            issues.push("lifecycle:unknown-proof-missing");
          return issues;
        },
      ),
      define(
        "recovery-attempt-reservation/v1",
        {
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          transactionId: uuid,
          sourceToken: enumeration("recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          predecessorAccumulatorTipDigest: nullableSha,
          predecessorAccumulatorValueDigest: nullableSha,
          predecessorAccumulatorReceiptDigest: nullableSha,
          attemptId: uuid,
          descriptorInputsDigest: sha,
          consumedDescriptorDigest: nullableSha,
          terminalSummaryDigest: nullableSha,
          tombstoneArchiveDigest: nullableSha,
          lifecycle: enumeration("RESERVED", "CONSUMED", "TERMINAL", "TOMBSTONE"),
          selectedAt: timestamp,
        },
        (record) => {
          const issues = [
            ...exactOptionalGroup(record, [
              "predecessorAccumulatorTipDigest",
              "predecessorAccumulatorValueDigest",
              "predecessorAccumulatorReceiptDigest",
            ]),
          ];
          const lifecycle = value(record, "lifecycle");
          const consumed = value(record, "consumedDescriptorDigest") !== null;
          const terminal = value(record, "terminalSummaryDigest") !== null;
          const tombstone = value(record, "tombstoneArchiveDigest") !== null;
          if (
            (lifecycle === "RESERVED" && (consumed || terminal || tombstone)) ||
            (lifecycle === "CONSUMED" && (!consumed || terminal || tombstone)) ||
            (lifecycle === "TERMINAL" && (!consumed || !terminal || tombstone)) ||
            (lifecycle === "TOMBSTONE" && (!consumed || !terminal || !tombstone))
          )
            issues.push("lifecycle:reservation-fields-mismatch");
          return issues;
        },
      ),
      define(
        "recovery-attempt-descriptor/v1",
        {
          attemptId: uuid,
          transactionId: uuid,
          sourceToken: enumeration("recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          reservationTipDigest: sha,
          reservationValueDigest: sha,
          reservationReceiptDigest: sha,
          lifecycle: enumeration("READY_ONLY", "LIVE"),
          readyRecordDigest: sha,
          initialLiveRecordDigest: nullableSha,
          gateRootDigest: sha,
          gateHeadDigest: sha,
          fenceRootDigest: nullableSha,
          fenceHeadDigest: nullableSha,
          activeReleaseDigest: sha,
          argvDigest: sha,
          processIdentityDigest: nullableSha,
          startedAt: nullable("timestamp"),
        },
        (record) => {
          const live = value(record, "lifecycle") === "LIVE";
          const sourceMatches =
            (value(record, "sourceToken") === "recovery-fence-v2") ===
            presentGroup(record, ["fenceRootDigest", "fenceHeadDigest"]);
          return live ===
            presentGroup(record, [
              "initialLiveRecordDigest",
              "processIdentityDigest",
              "startedAt",
            ]) && sourceMatches
            ? []
            : ["lifecycle:descriptor-fields-mismatch"];
        },
      ),
      define(
        "recovery-attempt-terminal-summary/v1",
        {
          attemptId: uuid,
          descriptorDigest: sha,
          reservationTipDigest: sha,
          reservationValueDigest: sha,
          reservationReceiptDigest: sha,
          attachmentTipDigest: nullableSha,
          attachmentValueDigest: nullableSha,
          attachmentReceiptDigest: nullableSha,
          terminalRecordDigest: sha,
          transactionId: uuid,
          sourceToken: enumeration("recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          argvDigest: sha,
          processIdentityDigest: sha,
          priorAccumulatorTipDigest: nullableSha,
          priorAccumulatorValueDigest: nullableSha,
          priorAccumulatorReceiptDigest: nullableSha,
          terminalLifecycle: enumeration(
            "TERMINAL_RETRYABLE",
            "TERMINAL_HANDOFF",
            "TERMINAL_ABORTED",
            "TERMINAL_COMPLETE",
          ),
          processExitProofDigest: sha,
          channelDenialProofDigest: sha,
          revocationProofDigest: nullableSha,
          terminalAt: timestamp,
        },
        (record) => [
          ...exactOptionalGroup(record, [
            "attachmentTipDigest",
            "attachmentValueDigest",
            "attachmentReceiptDigest",
          ]),
          ...exactOptionalGroup(record, [
            "priorAccumulatorTipDigest",
            "priorAccumulatorValueDigest",
            "priorAccumulatorReceiptDigest",
          ]),
        ],
      ),
      define(
        "recovery-attempt-accumulator/v1",
        {
          transactionId: uuid,
          sourceToken: enumeration("recovery-fence-v2", "cleanup-gate-pre-fence-v2"),
          lifecycle: enumeration("IN_PROGRESS", "TERMINAL"),
          reservationTipDigest: sha,
          reservationValueDigest: sha,
          reservationReceiptDigest: sha,
          attemptId: uuid,
          descriptorDigest: sha,
          attachmentDigest: nullableSha,
          priorTerminalAccumulatorTipDigest: nullableSha,
          priorTerminalAccumulatorValueDigest: nullableSha,
          priorTerminalAccumulatorReceiptDigest: nullableSha,
          priorTerminalSummaryDigest: nullableSha,
          terminalSummaryDigest: nullableSha,
          rollingDigest: nullableSha,
          updatedAt: timestamp,
        },
        (record) => {
          const issues = [
            ...exactOptionalGroup(record, [
              "priorTerminalAccumulatorTipDigest",
              "priorTerminalAccumulatorValueDigest",
              "priorTerminalAccumulatorReceiptDigest",
              "priorTerminalSummaryDigest",
            ]),
          ];
          const terminal = value(record, "lifecycle") === "TERMINAL";
          if (
            (terminal && !presentGroup(record, ["terminalSummaryDigest", "rollingDigest"])) ||
            (!terminal && !nullGroup(record, ["terminalSummaryDigest", "rollingDigest"]))
          )
            issues.push("lifecycle:terminal-fields-mismatch");
          return issues;
        },
      ),
      define("activation-cleanup-archive-head/v2", {
        installationId: uuid,
        projectId: uuid,
        stateRootDigest: sha,
        transactionId: uuid,
        archivePath: path,
        archiveDigest: sha,
        activeReleaseDigest: sha,
        previousArchiveHeadDigest: nullableSha,
        selectedAt: timestamp,
      }),
      define(
        "recovery-authorization-core/v1",
        {
          transactionId: uuid,
          installationId: uuid,
          projectId: uuid,
          stateRootDigest: sha,
          hostDigest: sha,
          userDigest: sha,
          issuedAt: timestamp,
          expiresAt: timestamp,
          capabilityReferenceDigest: sha,
          capabilityDigest: sha,
          nativeGeneration: integer,
          mode: enumeration("BOOTSTRAP", "SUCCESSOR"),
          producerDigest: sha,
          grantDigest: nullableSha,
          installerDigest: nullableSha,
          candidateDigest: sha,
          destinationDigest: nullableSha,
          cycleId: nullable("uuid-v7"),
          admissionDigest: nullableSha,
          priorBrokerGeneration: nullable("integer"),
          successorBrokerGeneration: nullable("integer"),
          expectedActiveGeneration: nullable("integer"),
          predecessorReleaseDigest: nullableSha,
          successorReleaseDigest: nullableSha,
          predecessorExecutableDigest: nullableSha,
          successorExecutableDigest: nullableSha,
          predecessorOperationManifestDigest: nullableSha,
          successorOperationManifestDigest: nullableSha,
          fencePath: nullable("relative-path"),
          fenceDigest: nullableSha,
        },
        (record) => {
          const issues: string[] = [];
          if ((value(record, "issuedAt") as string) >= (value(record, "expiresAt") as string))
            issues.push("issuedAt+expiresAt:not-increasing");
          const bootstrap = ["grantDigest", "installerDigest", "destinationDigest"];
          const successor = [
            "cycleId",
            "admissionDigest",
            "priorBrokerGeneration",
            "successorBrokerGeneration",
            "expectedActiveGeneration",
            "predecessorReleaseDigest",
            "successorReleaseDigest",
            "predecessorExecutableDigest",
            "successorExecutableDigest",
            "predecessorOperationManifestDigest",
            "successorOperationManifestDigest",
            "fencePath",
            "fenceDigest",
          ];
          if (value(record, "mode") === "BOOTSTRAP")
            return presentGroup(record, bootstrap) && nullGroup(record, successor)
              ? issues
              : [...issues, "mode:bootstrap-fields-mismatch"];
          if (!nullGroup(record, bootstrap) || !presentGroup(record, successor))
            issues.push("mode:successor-fields-mismatch");
          if (
            presentGroup(record, ["priorBrokerGeneration", "successorBrokerGeneration"]) &&
            value(record, "successorBrokerGeneration") !==
              (value(record, "priorBrokerGeneration") as number) + 1
          )
            issues.push("brokerGeneration:not-adjacent");
          return issues;
        },
      ),
      define(
        "recovery-authorization-state/v2",
        {
          transactionId: uuid,
          coreDigest: sha,
          gateRootDigest: nullableSha,
          lifecycle: enumeration("CREATED", "CONSUMED", "REVOKED", "REMOVED"),
          consumeOperationId: uuid,
          nativeConsumeReceiptPath: path,
          nativeConsumeReceiptDigest: nullableSha,
          nativeRemovalReceiptDigest: nullableSha,
          selectedAt: timestamp,
        },
        (record) => {
          const expectedNativePath = nativeConsumePath(
            value(record, "transactionId") as string,
            value(record, "consumeOperationId") as string,
          );
          if (value(record, "nativeConsumeReceiptPath") !== expectedNativePath)
            return ["nativeConsumeReceiptPath:not-canonical"];
          const consumed = ["nativeConsumeReceiptDigest"];
          const revoked = ["nativeRemovalReceiptDigest"];
          switch (value(record, "lifecycle")) {
            case "CREATED":
              return nullGroup(record, ["gateRootDigest", ...consumed, ...revoked])
                ? []
                : ["lifecycle:created-fields-mismatch"];
            case "CONSUMED":
              return presentGroup(record, ["gateRootDigest", ...consumed]) &&
                nullGroup(record, revoked)
                ? []
                : ["lifecycle:consumed-fields-mismatch"];
            default:
              return presentGroup(record, ["gateRootDigest", ...consumed, ...revoked])
                ? []
                : ["lifecycle:revoked-fields-mismatch"];
          }
        },
      ),
      define("native-consume-receipt/v1", {
        transactionId: uuid,
        operationId: uuid,
        coreDigest: sha,
        capabilityReferenceDigest: sha,
        capabilityDigest: sha,
        nativeGeneration: integer,
        custodyPrincipalDigest: sha,
        brokerServiceDigest: sha,
        brokerProfileDigest: sha,
        brokerClientGeneration: integer,
        nativeReadbackDigest: sha,
        consumedAt: timestamp,
      }),
      define("recovery-authorization-consume-receipt/v1", {
        transactionId: uuid,
        operationId: uuid,
        authorizationTipDigest: sha,
        authorizationValueDigest: sha,
        authorizationReceiptDigest: sha,
        nativeConsumeReceiptDigest: sha,
        coreDigest: sha,
        gateRootDigest: sha,
        capabilityReferenceDigest: sha,
        capabilityDigest: sha,
        nativeGeneration: integer,
        custodyPrincipalDigest: sha,
        brokerServiceDigest: sha,
        brokerProfileDigest: sha,
        brokerClientGeneration: integer,
        nativeReadbackDigest: sha,
        selectedReadbackDigest: sha,
        consumedAt: timestamp,
      }),
      define("native-removal-receipt/v1", {
        transactionId: uuid,
        operationId: uuid,
        capabilityReferenceDigest: sha,
        capabilityDigest: sha,
        nativeGeneration: integer,
        custodyPrincipalDigest: sha,
        brokerServiceDigest: sha,
        brokerProfileDigest: sha,
        brokerClientGeneration: integer,
        nativeConsumeReceiptDigest: sha,
        nativeAbsenceReadbackDigest: sha,
        removedAt: timestamp,
      }),
      define("recovery-authorization-revoke-receipt/v1", {
        transactionId: uuid,
        operationId: uuid,
        authorizationTipDigest: sha,
        authorizationValueDigest: sha,
        authorizationReceiptDigest: sha,
        nativeRemovalReceiptDigest: sha,
        coreDigest: sha,
        gateRootDigest: sha,
        capabilityReferenceDigest: sha,
        capabilityDigest: sha,
        nativeGeneration: integer,
        custodyPrincipalDigest: sha,
        brokerServiceDigest: sha,
        brokerProfileDigest: sha,
        brokerClientGeneration: integer,
        nativeAbsenceReadbackDigest: sha,
        selectedReadbackDigest: sha,
        revokedAt: timestamp,
      }),
      define(
        "recovery-authorization-attachment/v1",
        {
          transactionId: uuid,
          lifecycle: enumeration("UNATTACHED", "ATTACHED", "TERMINAL", "REMOVED"),
          authorizationTipDigest: sha,
          authorizationValueDigest: sha,
          authorizationReceiptDigest: sha,
          consumeReceiptDigest: sha,
          reservationTipDigest: nullableSha,
          reservationValueDigest: nullableSha,
          reservationReceiptDigest: nullableSha,
          descriptorDigest: nullableSha,
          readyRecordDigest: nullableSha,
          initialLiveRecordDigest: nullableSha,
          gateHeadDigest: nullableSha,
          fenceHeadDigest: nullableSha,
          activeReleaseDigest: nullableSha,
          brokerClientDigest: nullableSha,
          argvDigest: nullableSha,
          processIdentityDigest: nullableSha,
          priorTerminalAccumulatorTipDigest: nullableSha,
          priorTerminalAccumulatorValueDigest: nullableSha,
          priorTerminalAccumulatorReceiptDigest: nullableSha,
          priorTerminalSummaryDigest: nullableSha,
          priorAttachmentTipDigest: nullableSha,
          priorAttachmentValueDigest: nullableSha,
          priorAttachmentReceiptDigest: nullableSha,
          terminalSummaryDigest: nullableSha,
          selectedAt: timestamp,
        },
        (record) => {
          const attached = [
            "reservationTipDigest",
            "reservationValueDigest",
            "reservationReceiptDigest",
            "descriptorDigest",
            "readyRecordDigest",
            "initialLiveRecordDigest",
            "gateHeadDigest",
            "fenceHeadDigest",
            "activeReleaseDigest",
            "brokerClientDigest",
            "argvDigest",
            "processIdentityDigest",
          ];
          const predecessor = [
            "priorTerminalAccumulatorTipDigest",
            "priorTerminalAccumulatorValueDigest",
            "priorTerminalAccumulatorReceiptDigest",
            "priorTerminalSummaryDigest",
            "priorAttachmentTipDigest",
            "priorAttachmentValueDigest",
            "priorAttachmentReceiptDigest",
          ];
          const predecessorExact =
            nullGroup(record, predecessor) || presentGroup(record, predecessor);
          switch (value(record, "lifecycle")) {
            case "UNATTACHED":
              return nullGroup(record, [...attached, ...predecessor, "terminalSummaryDigest"])
                ? []
                : ["lifecycle:unattached-fields-mismatch"];
            case "ATTACHED":
              return presentGroup(record, attached) &&
                predecessorExact &&
                value(record, "terminalSummaryDigest") === null
                ? []
                : ["lifecycle:attached-fields-mismatch"];
            default:
              return presentGroup(record, [...attached, "terminalSummaryDigest"]) &&
                predecessorExact
                ? []
                : ["lifecycle:terminal-fields-mismatch"];
          }
        },
      ),
    ].map((definition) => [definition.schemaVersion, definition]),
  ) as Readonly<Record<string, SchemaDefinition>>,
);

export const v2SchemaVersions = Object.freeze(Object.keys(v2Definitions).sort());

interface SelectedPointerEvidence {
  readonly canonicalPointerPath: string;
  readonly pathInstanceDigest: string;
  readonly positionDigest: string;
  readonly valueDigest: string;
  readonly proposalReceiptDigest: string;
  readonly tipDigest: string;
  readonly value: ContractRecord;
  readonly proposal: ContractRecord;
  readonly tip: ContractRecord;
  readonly installationId: string;
  readonly projectId: string;
  readonly stateRootDigest: string;
  readonly transactionId: string | null;
  readonly sourceToken: string;
}

function resolveSelectedPointerEvidence(
  input: unknown,
):
  | { readonly ok: true; readonly value: SelectedPointerEvidence }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const closed = snapshotClosedRecord(input, [
    "canonicalPointerPath",
    "installationId",
    "pathBindings",
    "pointerKind",
    "positionEvidence",
    "projectId",
    "proposal",
    "sourceToken",
    "stateRootDigest",
    "tip",
    "tombstoneEvidence",
    "transactionId",
    "value",
  ]);
  if (!closed.ok) return { ok: false, issues: closed.issues };
  try {
    const kind = requirePointerKind(closed.value.pointerKind);
    const row = pointerRegistry.find((candidate) => candidate.kind === kind)!;
    const expectedBindings = expectedTemplateBindings([row.pathTemplate]);
    const bindings = snapshotClosedRecord(closed.value.pathBindings, expectedBindings);
    if (!bindings.ok) return { ok: false, issues: bindings.issues };
    const canonicalPointerPath = pointerPath(kind, bindings.value as PointerPathBindings);
    if (canonicalPointerPath !== closed.value.canonicalPointerPath)
      return { ok: false, issues: ["canonicalPointerPath:mismatch"] };
    if (
      row.pathTemplate.includes("<transaction>") &&
      bindings.value.transactionId !== closed.value.transactionId
    )
      return { ok: false, issues: ["transactionId:path-binding-mismatch"] };
    if (
      row.pathTemplate.includes("<source>") &&
      bindings.value.sourceToken !== closed.value.sourceToken
    )
      return { ok: false, issues: ["sourceToken:path-binding-mismatch"] };
    const pointerInput: PointerInstanceDigestInput = {
      pointerKind: kind,
      canonicalPointerPath,
      installationId: closed.value.installationId as string,
      projectId: closed.value.projectId as string,
      stateRootDigest: closed.value.stateRootDigest as string,
      transactionId: closed.value.transactionId as string | null,
      sourceToken: closed.value.sourceToken as string,
      ...(row.pathTemplate.includes("<predecessor-key>")
        ? { predecessorKey: bindings.value.predecessorKey as string }
        : {}),
      ...(row.pathTemplate.includes("<pointer-instance-digest>")
        ? { retainedPointerInstanceDigest: bindings.value.pointerInstanceDigest as string }
        : {}),
    };
    const pathInstanceDigest = computePointerInstanceDigest(pointerInput);
    const value = requirePointerValueRecord(kind, closed.value.value);
    const isTombstone = value.schemaVersion === "pointer-tombstone-value/v1";
    if (!isTombstone && closed.value.tombstoneEvidence !== null)
      return { ok: false, issues: ["tombstoneEvidence:ordinary-present"] };
    for (const name of [
      "installationId",
      "projectId",
      "stateRootDigest",
      "transactionId",
      "sourceToken",
    ] as const)
      if (Object.hasOwn(value, name) && value[name] !== closed.value[name])
        return { ok: false, issues: [`value:${name}-mismatch`] };
    if (
      kind === "ACTIVE_RELEASE" &&
      !isTombstone &&
      value.cleanupTransactionId !== closed.value.transactionId
    )
      return { ok: false, issues: ["value:cleanupTransactionId-mismatch"] };
    if (
      kind === "AUTHORITY_RETENTION" &&
      bindings.value.pointerInstanceDigest !== value.pathInstanceDigest
    )
      return { ok: false, issues: ["value:pathInstanceDigest-mismatch"] };
    if (kind === "RECOVERY_ATTEMPT_RESERVATION" && !isTombstone) {
      const expectedPredecessorKey = computeReservationPredecessorKey({
        transactionId: value.transactionId,
        sourceToken: value.sourceToken,
        priorDt: value.predecessorAccumulatorTipDigest,
        priorDv: value.predecessorAccumulatorValueDigest,
        priorDr: value.predecessorAccumulatorReceiptDigest,
      });
      if (bindings.value.predecessorKey !== expectedPredecessorKey)
        return { ok: false, issues: ["predecessorKey:value-mismatch"] };
    }
    const valueDigest = computePointerValueDigest(kind, pathInstanceDigest, value);
    const expectedPosition = derivePointerPositionEvidence(
      kind,
      value,
      bindings.value as PointerPathBindings,
    );
    if (
      canonicalDigest(expectedPosition) !==
      canonicalDigest(closed.value.positionEvidence as JsonValue)
    )
      return { ok: false, issues: ["positionEvidence:value-mismatch"] };
    const positionDigest = computePointerPositionDigest(kind, expectedPosition);
    const proposal = requireSchemaRecord("pointer-cas-proposal-receipt/v1", closed.value.proposal);
    if (
      (!isTombstone && (proposal.intent !== "VALUE_PROPOSED" || proposal.outcome !== "SELECT")) ||
      (isTombstone && (proposal.intent !== "TOMBSTONE_PROPOSED" || proposal.outcome !== "REMOVE"))
    )
      return { ok: false, issues: ["proposal:intent-outcome-value-mismatch"] };
    if (isTombstone) {
      if (!presentGroup(proposal, ["priorTipDigest", "priorValueDigest", "priorReceiptDigest"]))
        return { ok: false, issues: ["tombstone:genesis-refused"] };
      for (const [valueName, proposalName] of [
        ["priorTipDigest", "priorTipDigest"],
        ["priorValueDigest", "priorValueDigest"],
        ["priorReceiptDigest", "priorReceiptDigest"],
      ] as const)
        if (value[valueName] !== proposal[proposalName])
          return { ok: false, issues: [`tombstone:${valueName}-mismatch`] };
      const tombstoneEvidence = snapshotClosedRecord(closed.value.tombstoneEvidence, [
        "archiveBindings",
        "archivePath",
        "archiveRecord",
        "priorSelection",
        "terminalProof",
      ]);
      if (!tombstoneEvidence.ok) return { ok: false, issues: tombstoneEvidence.issues };
      const expectedArchives = pointerArchivePaths(
        kind,
        tombstoneEvidence.value.archiveBindings as PointerPathBindings,
      );
      if (
        expectedArchives.length !== 1 ||
        expectedArchives[0] !== tombstoneEvidence.value.archivePath
      )
        return { ok: false, issues: ["tombstone:archivePath-mismatch"] };
      const priorEnvelope = snapshotClosedRecord(tombstoneEvidence.value.priorSelection, [
        "canonicalPointerPath",
        "installationId",
        "pathBindings",
        "pointerKind",
        "positionEvidence",
        "projectId",
        "proposal",
        "sourceToken",
        "stateRootDigest",
        "tip",
        "tombstoneEvidence",
        "transactionId",
        "value",
      ]);
      if (!priorEnvelope.ok) return { ok: false, issues: priorEnvelope.issues };
      const priorRawValue = requirePointerValueRecord(kind, priorEnvelope.value.value);
      if (priorRawValue.schemaVersion === "pointer-tombstone-value/v1")
        return { ok: false, issues: ["tombstone:prior-tombstone-refused"] };
      const prior = resolveSelectedPointerEvidence(tombstoneEvidence.value.priorSelection);
      if (!prior.ok)
        return { ok: false, issues: prior.issues.map((issue) => `tombstone:prior:${issue}`) };
      if (!isTerminalPointerValue(kind, prior.value.value))
        return { ok: false, issues: ["tombstone:prior-not-terminal"] };
      const terminalProof = validateAgainstSchema(
        v2Definitions["pointer-terminal-proof/v1"]!,
        tombstoneEvidence.value.terminalProof,
      );
      if (!terminalProof.ok) return { ok: false, issues: terminalProof.issues };
      const archiveRecord = validateAgainstSchema(
        v2Definitions["pointer-archive-record/v1"]!,
        tombstoneEvidence.value.archiveRecord,
      );
      if (!archiveRecord.ok) return { ok: false, issues: archiveRecord.issues };
      const terminalProofDigest = canonicalDigest(terminalProof.value);
      const archiveDigest = canonicalDigest(archiveRecord.value);
      if (
        archiveDigest !== value.archiveDigest ||
        terminalProofDigest !== value.terminalProofDigest
      )
        return { ok: false, issues: ["tombstone:archive-proof-digest-mismatch"] };
      for (const record of [terminalProof.value, archiveRecord.value]) {
        for (const name of [
          "pointerKind",
          "canonicalPointerPath",
          "installationId",
          "projectId",
          "stateRootDigest",
          "transactionId",
          "sourceToken",
        ])
          if (record[name] !== closed.value[name])
            return { ok: false, issues: [`tombstone:${name}-mismatch`] };
        if (record.pathInstanceDigest !== pathInstanceDigest)
          return { ok: false, issues: ["tombstone:pathInstanceDigest-mismatch"] };
        for (const [recordName, proposalName] of [
          ["authorityEpochTipDigest", "authorityEpochTipDigest"],
          ["authorityEpochValueDigest", "authorityEpochValueDigest"],
          ["authorityEpochReceiptDigest", "authorityEpochReceiptDigest"],
        ] as const)
          if (record[recordName] !== proposal[proposalName])
            return { ok: false, issues: [`tombstone:${recordName}-mismatch`] };
      }
      for (const name of [
        "canonicalPointerPath",
        "installationId",
        "projectId",
        "stateRootDigest",
        "transactionId",
        "sourceToken",
        "pathInstanceDigest",
      ] as const)
        if (
          prior.value[name] !==
          (name === "canonicalPointerPath"
            ? canonicalPointerPath
            : name === "pathInstanceDigest"
              ? pathInstanceDigest
              : closed.value[name])
        )
          return { ok: false, issues: [`tombstone:prior:${name}-mismatch`] };
      for (const record of [terminalProof.value, archiveRecord.value])
        for (const [recordName, proposalName] of [
          ["priorAuthorityEpochTipDigest", "authorityEpochTipDigest"],
          ["priorAuthorityEpochValueDigest", "authorityEpochValueDigest"],
          ["priorAuthorityEpochReceiptDigest", "authorityEpochReceiptDigest"],
        ] as const)
          if (record[recordName] !== prior.value.proposal[proposalName])
            return { ok: false, issues: [`tombstone:${recordName}-prior-mismatch`] };
      if (
        archiveRecord.value.archivePath !== tombstoneEvidence.value.archivePath ||
        archiveRecord.value.terminalProofDigest !== terminalProofDigest
      )
        return { ok: false, issues: ["tombstone:archive-record-mismatch"] };
      for (const [archiveName, proposalName] of [
        ["priorTipDigest", "priorTipDigest"],
        ["priorValueDigest", "priorValueDigest"],
        ["priorReceiptDigest", "priorReceiptDigest"],
      ] as const)
        if (archiveRecord.value[archiveName] !== proposal[proposalName])
          return { ok: false, issues: [`tombstone:${archiveName}-archive-mismatch`] };
      if (
        archiveRecord.value.priorPositionDigest !== prior.value.positionDigest ||
        archiveRecord.value.priorValueSchemaVersion !== prior.value.value.schemaVersion
      )
        return { ok: false, issues: ["tombstone:archive-family-position-mismatch"] };
      for (const [proofName, proposalName] of [
        ["terminalTipDigest", "priorTipDigest"],
        ["terminalValueDigest", "priorValueDigest"],
        ["terminalReceiptDigest", "priorReceiptDigest"],
      ] as const)
        if (terminalProof.value[proofName] !== proposal[proposalName])
          return { ok: false, issues: [`tombstone:${proofName}-mismatch`] };
      if (
        terminalProof.value.terminalPositionDigest !== prior.value.positionDigest ||
        terminalProof.value.terminalValueSchemaVersion !== prior.value.value.schemaVersion
      )
        return { ok: false, issues: ["tombstone:terminal-family-position-mismatch"] };
      for (const [proposalName, digestName] of [
        ["priorTipDigest", "tipDigest"],
        ["priorValueDigest", "valueDigest"],
        ["priorReceiptDigest", "proposalReceiptDigest"],
      ] as const)
        if (
          proposal[proposalName] !== prior.value[digestName] ||
          value[proposalName] !== prior.value[digestName]
        )
          return { ok: false, issues: [`tombstone:${proposalName}-selected-prior-mismatch`] };
      const archiveBindings = tombstoneEvidence.value.archiveBindings as ContractRecord;
      if (
        row.archiveTemplates.some((template) => template.includes("<transaction>")) &&
        archiveBindings.transactionId !== closed.value.transactionId
      )
        return { ok: false, issues: ["tombstone:archive-transaction-mismatch"] };
      if (
        row.archiveTemplates.some((template) => template.includes("<source>")) &&
        archiveBindings.sourceToken !== closed.value.sourceToken
      )
        return { ok: false, issues: ["tombstone:archive-source-mismatch"] };
    }
    const mutationInput: MutationDigestInput = {
      pointerKind: kind,
      canonicalPointerPath,
      pathInstanceDigest,
      transactionId: closed.value.transactionId as string | null,
      sourceToken: closed.value.sourceToken as string,
      positionEvidence: expectedPosition,
      priorDt: proposal.priorTipDigest as string | null,
      priorDv: proposal.priorValueDigest as string | null,
      priorDr: proposal.priorReceiptDigest as string | null,
      successorDv: valueDigest,
      outcome: proposal.outcome as string,
      intent: proposal.intent as string,
      ...(row.pathTemplate.includes("<predecessor-key>")
        ? { predecessorKey: bindings.value.predecessorKey as string }
        : {}),
      ...(row.pathTemplate.includes("<pointer-instance-digest>")
        ? { retainedPointerInstanceDigest: bindings.value.pointerInstanceDigest as string }
        : {}),
    };
    const mutationId = computeMutationId(mutationInput);
    if (proposal.positionDigest !== positionDigest)
      return { ok: false, issues: ["proposal:positionDigest:mismatch"] };
    if (proposal.mutationId !== mutationId)
      return { ok: false, issues: ["proposal:mutationId:mismatch"] };
    const proposalReceiptDigest = computeProposalReceiptDigest({
      pointerKind: kind,
      pathInstanceDigest,
      mutationId,
      priorDt: mutationInput.priorDt,
      priorDv: mutationInput.priorDv,
      priorDr: mutationInput.priorDr,
      successorDv: valueDigest,
      positionDigest,
      intent: mutationInput.intent as "VALUE_PROPOSED" | "TOMBSTONE_PROPOSED",
      outcome: mutationInput.outcome as "SELECT" | "REMOVE",
      authorityEpochDt: proposal.authorityEpochTipDigest as string,
      authorityEpochDv: proposal.authorityEpochValueDigest as string,
      authorityEpochDr: proposal.authorityEpochReceiptDigest as string,
      receipt: proposal,
    });
    const tip = requireSchemaRecord("pointer-current-tip/v1", closed.value.tip);
    const tipDigest = computeCurrentTipDigest(
      kind,
      pathInstanceDigest,
      valueDigest,
      proposalReceiptDigest,
      tip,
    );
    return {
      ok: true,
      value: Object.freeze({
        canonicalPointerPath,
        pathInstanceDigest,
        positionDigest,
        valueDigest,
        proposalReceiptDigest,
        tipDigest,
        value,
        proposal,
        tip,
        installationId: closed.value.installationId as string,
        projectId: closed.value.projectId as string,
        stateRootDigest: closed.value.stateRootDigest as string,
        transactionId: closed.value.transactionId as string | null,
        sourceToken: closed.value.sourceToken as string,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? `selection:${error.message}` : "selection:invalid"],
    };
  }
}

export function validateSelectedPointerEvidence(input: unknown): readonly string[] {
  const result = resolveSelectedPointerEvidence(input);
  return result.ok ? [] : Object.freeze(result.issues);
}

function selectedAuthorizationEvidence(
  core: ContractRecord,
  state: ContractRecord,
  proposalInput: unknown,
  tipInput: unknown,
):
  | { readonly ok: true; readonly value: SelectedPointerEvidence }
  | {
      readonly ok: false;
      readonly issues: readonly string[];
    } {
  return resolveSelectedPointerEvidence({
    pointerKind: "RECOVERY_AUTHORIZATION_STATE",
    canonicalPointerPath: pointerPath("RECOVERY_AUTHORIZATION_STATE", {
      transactionId: core.transactionId as string,
    }),
    installationId: core.installationId,
    projectId: core.projectId,
    stateRootDigest: core.stateRootDigest,
    transactionId: core.transactionId,
    sourceToken: "none",
    pathBindings: { transactionId: core.transactionId },
    positionEvidence: derivePointerPositionEvidence("RECOVERY_AUTHORIZATION_STATE", state, {
      transactionId: core.transactionId as string,
    }),
    value: state,
    proposal: proposalInput,
    tip: tipInput,
    tombstoneEvidence: null,
  });
}

export function validateCleanupHeadHistory(input: unknown): readonly string[] {
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok) return snapshot.issues;
  if (
    snapshot.value.length === 0 ||
    snapshot.value.length > fixedEvidencePacketLimits.maximumGateHeads
  )
    return ["cleanup-history:length-refused"];
  const issues: string[] = [];
  let previous: ContractRecord | undefined;
  for (let index = 0; index < snapshot.value.length; index += 1) {
    const parsed = validateAgainstSchema(
      v2Definitions["activation-cleanup-gate-head/v2"]!,
      snapshot.value[index],
    );
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    const record = parsed.value;
    if (record.ordinal !== index) issues.push(`${index}:ordinal-mismatch`);
    if (index === 0) {
      if (record.previousHeadDigest !== null) issues.push("0:non-null-predecessor");
    } else if (previous) {
      if (record.previousHeadDigest !== canonicalDigest(previous))
        issues.push(`${index}:previous-digest-mismatch`);
      if (
        !isCleanupLifecyclePublicationTransition(
          previous.lifecycle,
          previous.publication,
          record.lifecycle,
          record.publication,
        )
      )
        issues.push(`${index}:invalid-edge`);
    }
    previous = record;
  }
  return Object.freeze(issues);
}

export function validateFenceHeadHistory(input: unknown): readonly string[] {
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok) return snapshot.issues;
  if (snapshot.value.length < 1 || snapshot.value.length > 2)
    return ["fence-history:length-refused"];
  const issues: string[] = [];
  let previous: ContractRecord | undefined;
  for (let index = 0; index < snapshot.value.length; index += 1) {
    const parsed = validateAgainstSchema(
      v2Definitions["activation-recovery-fence-head/v2"]!,
      snapshot.value[index],
    );
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((issue) => `${index}:${issue}`));
      continue;
    }
    const record = parsed.value;
    if (record.ordinal !== index) issues.push(`${index}:ordinal-mismatch`);
    if (index === 0 && record.lifecycle !== "PREPARED") issues.push("0:initial-lifecycle");
    if (
      index === 1 &&
      (record.lifecycle !== "POST_ACTIVATION" ||
        !previous ||
        record.previousHeadDigest !== canonicalDigest(previous))
    )
      issues.push("1:transition-mismatch");
    previous = record;
  }
  return Object.freeze(issues);
}

export function validateAuthorizationReceiptChain(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "core",
    "createdProposal",
    "createdState",
    "createdTip",
    "gateRoot",
    "nativeConsume",
    "postConsume",
    "selectedProposal",
    "selectedTip",
    "state",
  ]);
  if (!closed.ok) return closed.issues;
  const gateBindingIssues = validateGateAuthorizationBinding({
    core: closed.value.core,
    createdProposal: closed.value.createdProposal,
    createdState: closed.value.createdState,
    createdTip: closed.value.createdTip,
    gateRoot: closed.value.gateRoot,
  });
  if (gateBindingIssues.length > 0)
    return Object.freeze(gateBindingIssues.map((issue) => `gateBinding:${issue}`));
  const core = validateAgainstSchema(
    v2Definitions["recovery-authorization-core/v1"]!,
    closed.value.core,
  );
  const state = validateAgainstSchema(
    v2Definitions["recovery-authorization-state/v2"]!,
    closed.value.state,
  );
  const gate = validateAgainstSchema(
    v2Definitions["activation-cleanup-gate-root/v2"]!,
    closed.value.gateRoot,
  );
  const nativeReceipt = validateAgainstSchema(
    v2Definitions["native-consume-receipt/v1"]!,
    closed.value.nativeConsume,
  );
  const postReceipt = validateAgainstSchema(
    v2Definitions["recovery-authorization-consume-receipt/v1"]!,
    closed.value.postConsume,
  );
  if (!core.ok || !gate.ok || !state.ok || !nativeReceipt.ok || !postReceipt.ok)
    return Object.freeze([
      ...(!core.ok ? core.issues.map((issue) => `core:${issue}`) : []),
      ...(!gate.ok ? gate.issues.map((issue) => `gate:${issue}`) : []),
      ...(!state.ok ? state.issues.map((issue) => `state:${issue}`) : []),
      ...(!nativeReceipt.ok ? nativeReceipt.issues.map((issue) => `native:${issue}`) : []),
      ...(!postReceipt.ok ? postReceipt.issues.map((issue) => `post:${issue}`) : []),
    ]);
  const selection = selectedAuthorizationEvidence(
    core.value,
    state.value,
    closed.value.selectedProposal,
    closed.value.selectedTip,
  );
  if (!selection.ok) return Object.freeze(selection.issues);
  const coreDigest = computeRecoveryAuthorizationCoreDigest(core.value);
  const issues: string[] = [];
  if (state.value.lifecycle !== "CONSUMED") issues.push("state:lifecycle-not-consumed");
  for (const [proposalName, gateName] of [
    ["priorTipDigest", "authorizationCreatedTipDigest"],
    ["priorValueDigest", "authorizationCreatedValueDigest"],
    ["priorReceiptDigest", "authorizationCreatedReceiptDigest"],
  ] as const)
    if (selection.value.proposal[proposalName] !== gate.value[gateName])
      issues.push(`${proposalName}:created-predecessor-mismatch`);
  if (state.value.transactionId !== core.value.transactionId)
    issues.push("transactionId:core-state-mismatch");
  for (const name of ["transactionId", "consumeOperationId", "nativeConsumeReceiptPath"] as const)
    if (state.value[name] !== gate.value[name]) issues.push(`${name}:gate-state-mismatch`);
  for (const [postName, envelopeName] of [
    ["authorizationTipDigest", "tipDigest"],
    ["authorizationValueDigest", "valueDigest"],
    ["authorizationReceiptDigest", "proposalReceiptDigest"],
  ] as const) {
    if (postReceipt.value[postName] !== selection.value[envelopeName])
      issues.push(`${postName}:selected-mismatch`);
  }
  for (const name of ["transactionId", "coreDigest", "operationId"] as const) {
    const stateName = name === "operationId" ? "consumeOperationId" : name;
    if (postReceipt.value[name] !== nativeReceipt.value[name])
      issues.push(`${name}:native-post-mismatch`);
    if (name !== "operationId" && postReceipt.value[name] !== state.value[stateName])
      issues.push(`${name}:state-post-mismatch`);
    if (name === "operationId" && nativeReceipt.value[name] !== state.value[stateName])
      issues.push(`${name}:state-native-mismatch`);
  }
  if (state.value.coreDigest !== coreDigest) issues.push("coreDigest:state-mismatch");
  if (nativeReceipt.value.coreDigest !== coreDigest) issues.push("coreDigest:native-mismatch");
  if (postReceipt.value.coreDigest !== coreDigest) issues.push("coreDigest:post-mismatch");
  if (postReceipt.value.gateRootDigest !== state.value.gateRootDigest)
    issues.push("gateRootDigest:state-post-mismatch");
  if (state.value.gateRootDigest !== canonicalDigest(gate.value))
    issues.push("gateRootDigest:record-mismatch");
  for (const name of [
    "capabilityReferenceDigest",
    "capabilityDigest",
    "nativeGeneration",
  ] as const) {
    if (nativeReceipt.value[name] !== core.value[name]) issues.push(`${name}:core-native-mismatch`);
    if (postReceipt.value[name] !== core.value[name]) issues.push(`${name}:core-post-mismatch`);
  }
  if (postReceipt.value.nativeReadbackDigest !== nativeReceipt.value.nativeReadbackDigest)
    issues.push("nativeReadbackDigest:native-post-mismatch");
  if (postReceipt.value.selectedReadbackDigest !== selection.value.tipDigest)
    issues.push("selectedReadbackDigest:tip-mismatch");
  if (
    (nativeReceipt.value.consumedAt as string) < (core.value.issuedAt as string) ||
    (nativeReceipt.value.consumedAt as string) >= (core.value.expiresAt as string)
  )
    issues.push("consumedAt:outside-core-window");
  if (
    (nativeReceipt.value.consumedAt as string) > (state.value.selectedAt as string) ||
    (state.value.selectedAt as string) > (postReceipt.value.consumedAt as string)
  )
    issues.push("consume-order:mismatch");
  for (const name of [
    "custodyPrincipalDigest",
    "brokerServiceDigest",
    "brokerProfileDigest",
    "brokerClientGeneration",
  ] as const) {
    if (postReceipt.value[name] !== nativeReceipt.value[name])
      issues.push(`${name}:native-post-mismatch`);
  }
  if (state.value.nativeConsumeReceiptDigest !== canonicalDigest(nativeReceipt.value))
    issues.push("nativeConsumeReceiptDigest:mismatch");
  if (postReceipt.value.nativeConsumeReceiptDigest !== canonicalDigest(nativeReceipt.value))
    issues.push("post:nativeConsumeReceiptDigest:mismatch");
  return Object.freeze(issues);
}

export function validateGateAuthorizationBinding(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "core",
    "createdProposal",
    "createdState",
    "createdTip",
    "gateRoot",
  ]);
  if (!closed.ok) return closed.issues;
  const core = validateAgainstSchema(
    v2Definitions["recovery-authorization-core/v1"]!,
    closed.value.core,
  );
  const state = validateAgainstSchema(
    v2Definitions["recovery-authorization-state/v2"]!,
    closed.value.createdState,
  );
  const gate = validateAgainstSchema(
    v2Definitions["activation-cleanup-gate-root/v2"]!,
    closed.value.gateRoot,
  );
  if (!core.ok || !state.ok || !gate.ok)
    return Object.freeze([
      ...(!core.ok ? core.issues.map((issue) => `core:${issue}`) : []),
      ...(!state.ok ? state.issues.map((issue) => `state:${issue}`) : []),
      ...(!gate.ok ? gate.issues.map((issue) => `gate:${issue}`) : []),
    ]);
  const selection = selectedAuthorizationEvidence(
    core.value,
    state.value,
    closed.value.createdProposal,
    closed.value.createdTip,
  );
  if (!selection.ok) return Object.freeze(selection.issues);
  const coreDigest = computeRecoveryAuthorizationCoreDigest(core.value);
  const issues: string[] = [];
  if (state.value.lifecycle !== "CREATED") issues.push("state:lifecycle-not-created");
  if (
    !nullGroup(selection.value.proposal, [
      "priorTipDigest",
      "priorValueDigest",
      "priorReceiptDigest",
    ])
  )
    issues.push("created:predecessor-must-be-null");
  if (gate.value.authorizationCoreDigest !== coreDigest)
    issues.push("authorizationCoreDigest:mismatch");
  if (
    gate.value.authorizationCorePath !==
    recoveryAuthorizationCorePath(core.value.transactionId as string)
  )
    issues.push("authorizationCorePath:mismatch");
  if (state.value.coreDigest !== coreDigest) issues.push("state:coreDigest-mismatch");
  for (const [gateName, envelopeName] of [
    ["authorizationCreatedTipDigest", "tipDigest"],
    ["authorizationCreatedValueDigest", "valueDigest"],
    ["authorizationCreatedReceiptDigest", "proposalReceiptDigest"],
  ] as const)
    if (gate.value[gateName] !== selection.value[envelopeName]) issues.push(`${gateName}:mismatch`);
  for (const name of ["installationId", "projectId", "stateRootDigest", "transactionId"] as const)
    if (gate.value[name] !== core.value[name]) issues.push(`${name}:core-gate-mismatch`);
  for (const name of ["transactionId", "consumeOperationId", "nativeConsumeReceiptPath"] as const)
    if (gate.value[name] !== state.value[name]) issues.push(`${name}:state-gate-mismatch`);
  for (const name of [
    "mode",
    "candidateDigest",
    "grantDigest",
    "installerDigest",
    "destinationDigest",
    "cycleId",
    "admissionDigest",
    "priorBrokerGeneration",
    "successorBrokerGeneration",
    "expectedActiveGeneration",
    "predecessorReleaseDigest",
    "successorReleaseDigest",
    "predecessorExecutableDigest",
    "successorExecutableDigest",
    "predecessorOperationManifestDigest",
    "successorOperationManifestDigest",
    "fencePath",
  ] as const)
    if (gate.value[name] !== core.value[name]) issues.push(`${name}:core-gate-mismatch`);
  if (gate.value.expectedFenceRootDigest !== core.value.fenceDigest)
    issues.push("expectedFenceRootDigest:core-gate-mismatch");
  const expectedActive =
    core.value.mode === "BOOTSTRAP"
      ? core.value.destinationDigest
      : core.value.predecessorReleaseDigest;
  if (gate.value.expectedActiveReleaseDigest !== expectedActive)
    issues.push("expectedActiveReleaseDigest:core-gate-mismatch");
  return Object.freeze(issues);
}

export function validateAuthorizationRevokeReceiptChain(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "consumedProposal",
    "consumedState",
    "consumedTip",
    "core",
    "createdProposal",
    "createdState",
    "createdTip",
    "gateRoot",
    "nativeConsume",
    "nativeRemoval",
    "postConsume",
    "postRevoke",
    "selectedProposal",
    "selectedTip",
    "state",
  ]);
  if (!closed.ok) return closed.issues;
  const consumeIssues = validateAuthorizationReceiptChain({
    core: closed.value.core,
    createdProposal: closed.value.createdProposal,
    createdState: closed.value.createdState,
    createdTip: closed.value.createdTip,
    gateRoot: closed.value.gateRoot,
    nativeConsume: closed.value.nativeConsume,
    postConsume: closed.value.postConsume,
    selectedProposal: closed.value.consumedProposal,
    selectedTip: closed.value.consumedTip,
    state: closed.value.consumedState,
  });
  if (consumeIssues.length > 0)
    return Object.freeze(consumeIssues.map((issue) => `consume:${issue}`));
  const definitions = {
    core: "recovery-authorization-core/v1",
    nativeConsume: "native-consume-receipt/v1",
    nativeRemoval: "native-removal-receipt/v1",
    postConsume: "recovery-authorization-consume-receipt/v1",
    postRevoke: "recovery-authorization-revoke-receipt/v1",
    state: "recovery-authorization-state/v2",
  } as const;
  const parsed = Object.fromEntries(
    Object.entries(definitions).map(([name, schema]) => [
      name,
      validateAgainstSchema(v2Definitions[schema]!, closed.value[name]),
    ]),
  ) as Record<keyof typeof definitions, ReturnType<typeof validateAgainstSchema>>;
  const parseIssues = Object.entries(parsed).flatMap(([name, result]) =>
    result.ok ? [] : result.issues.map((issue) => `${name}:${issue}`),
  );
  if (parseIssues.length > 0) return Object.freeze(parseIssues);
  const parsedValue = (result: ReturnType<typeof validateAgainstSchema>): ContractRecord => {
    if (!result.ok) throw new TypeError("validated-result-required");
    return result.value;
  };
  const core = parsedValue(parsed.core);
  const state = parsedValue(parsed.state);
  const nativeConsume = parsedValue(parsed.nativeConsume);
  const nativeRemoval = parsedValue(parsed.nativeRemoval);
  const postRevoke = parsedValue(parsed.postRevoke);
  const postConsume = parsedValue(parsed.postConsume);
  const selection = selectedAuthorizationEvidence(
    core,
    state,
    closed.value.selectedProposal,
    closed.value.selectedTip,
  );
  if (!selection.ok) return Object.freeze(selection.issues);
  const consumedStateResult = validateAgainstSchema(
    v2Definitions["recovery-authorization-state/v2"]!,
    closed.value.consumedState,
  );
  if (!consumedStateResult.ok) return Object.freeze(consumedStateResult.issues);
  const consumedSelection = selectedAuthorizationEvidence(
    core,
    consumedStateResult.value,
    closed.value.consumedProposal,
    closed.value.consumedTip,
  );
  if (!consumedSelection.ok) return Object.freeze(consumedSelection.issues);
  const coreDigest = computeRecoveryAuthorizationCoreDigest(core);
  const issues: string[] = [];
  if (state.lifecycle !== "REVOKED") issues.push("state:lifecycle-not-revoked");
  for (const [proposalName, digestName] of [
    ["priorTipDigest", "tipDigest"],
    ["priorValueDigest", "valueDigest"],
    ["priorReceiptDigest", "proposalReceiptDigest"],
  ] as const)
    if (selection.value.proposal[proposalName] !== consumedSelection.value[digestName])
      issues.push(`${proposalName}:consumed-predecessor-mismatch`);
  for (const name of [
    "transactionId",
    "coreDigest",
    "gateRootDigest",
    "consumeOperationId",
    "nativeConsumeReceiptPath",
    "nativeConsumeReceiptDigest",
  ] as const)
    if (state[name] !== consumedStateResult.value[name]) issues.push(`${name}:state-changed`);
  for (const [postName, envelopeName] of [
    ["authorizationTipDigest", "tipDigest"],
    ["authorizationValueDigest", "valueDigest"],
    ["authorizationReceiptDigest", "proposalReceiptDigest"],
  ] as const)
    if (postRevoke[postName] !== selection.value[envelopeName])
      issues.push(`${postName}:selected-mismatch`);
  for (const name of [
    "transactionId",
    "capabilityReferenceDigest",
    "capabilityDigest",
    "nativeGeneration",
    "custodyPrincipalDigest",
    "brokerServiceDigest",
    "brokerProfileDigest",
    "brokerClientGeneration",
  ] as const)
    if (nativeRemoval[name] !== nativeConsume[name] || postRevoke[name] !== nativeConsume[name])
      issues.push(`${name}:chain-mismatch`);
  if (postRevoke.operationId !== nativeRemoval.operationId)
    issues.push("operationId:removal-post-mismatch");
  if (nativeRemoval.nativeConsumeReceiptDigest !== canonicalDigest(nativeConsume))
    issues.push("nativeRemoval:consume-mismatch");
  if (postRevoke.nativeAbsenceReadbackDigest !== nativeRemoval.nativeAbsenceReadbackDigest)
    issues.push("nativeAbsenceReadbackDigest:mismatch");
  if (postRevoke.selectedReadbackDigest !== selection.value.tipDigest)
    issues.push("selectedReadbackDigest:tip-mismatch");
  if (
    state.nativeRemovalReceiptDigest !== canonicalDigest(nativeRemoval) ||
    postRevoke.nativeRemovalReceiptDigest !== canonicalDigest(nativeRemoval)
  )
    issues.push("nativeRemovalReceiptDigest:mismatch");
  if (postRevoke.coreDigest !== coreDigest || state.coreDigest !== coreDigest)
    issues.push("coreDigest:mismatch");
  if (postRevoke.gateRootDigest !== state.gateRootDigest) issues.push("gateRootDigest:mismatch");
  if (
    (postConsume.consumedAt as string) > (nativeRemoval.removedAt as string) ||
    (nativeRemoval.removedAt as string) > (state.selectedAt as string) ||
    (state.selectedAt as string) > (postRevoke.revokedAt as string)
  )
    issues.push("revoke-order:mismatch");
  return Object.freeze(issues);
}

export const fixedEvidencePacketLimits = Object.freeze({
  maximumGateHeads: 64,
  maximumFenceHeads: 2,
  maximumLaunchRecords: 64,
  maximumPriorTerminalSummaries: 1,
  maximumPointerProposalsPerBucket: 16,
  maximumAuthorityHistorySelections: 16,
  maximumHistoricalSelections: 16,
});

export function validateEvidencePacket(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "accumulator",
    "accumulatorSelection",
    "attachment",
    "attachmentSelection",
    "authorityHistory",
    "currentCommit",
    "descriptor",
    "fenceHistory",
    "fenceSelection",
    "gateHistory",
    "gateSelection",
    "launchHistory",
    "launchSelection",
    "postConsume",
    "currentAccumulatorPredecessorSelection",
    "priorTerminalAccumulatorSelection",
    "priorTerminalSummaries",
    "reservation",
    "reservationSelection",
  ]);
  if (!closed.ok) return closed.issues;
  const issues: string[] = [];
  const selectionInputs = {
    accumulator: closed.value.accumulatorSelection,
    attachment: closed.value.attachmentSelection,
    fence: closed.value.fenceSelection,
    gate: closed.value.gateSelection,
    launch: closed.value.launchSelection,
    reservation: closed.value.reservationSelection,
  } as const;
  const selections = Object.fromEntries(
    Object.entries(selectionInputs).map(([name, selectionInput]) => {
      const selected = resolveSelectedPointerEvidence(selectionInput);
      if (!selected.ok) issues.push(...selected.issues.map((issue) => `${name}Selection:${issue}`));
      return [name, selected];
    }),
  ) as Record<keyof typeof selectionInputs, ReturnType<typeof resolveSelectedPointerEvidence>>;
  const expectedKinds = {
    accumulator: "RECOVERY_ATTEMPT_ACCUMULATOR",
    attachment: "RECOVERY_AUTHORIZATION_ATTACHMENT",
    fence: "ACTIVATION_RECOVERY_FENCE",
    gate: "ACTIVATION_CLEANUP_GATE",
    launch: "ACTIVATION_RECOVERY_LAUNCH",
    reservation: "RECOVERY_ATTEMPT_RESERVATION",
  } as const;
  for (const name of Object.keys(expectedKinds) as (keyof typeof expectedKinds)[]) {
    const selected = selections[name];
    if (selected?.ok && selected.value.tip.pointerKind !== expectedKinds[name])
      issues.push(`${name}Selection:pointer-kind-mismatch`);
  }
  if (closed.value.currentCommit !== null)
    issues.push(
      ...validateCurrentCommitEpochComposition(closed.value.currentCommit).map(
        (issue) => `currentCommit:${issue}`,
      ),
    );
  const historicalSelectionInputs = [
    ...Object.values(selectionInputs),
    ...(closed.value.currentAccumulatorPredecessorSelection === null
      ? []
      : [closed.value.currentAccumulatorPredecessorSelection]),
    ...(closed.value.priorTerminalAccumulatorSelection === null
      ? []
      : [closed.value.priorTerminalAccumulatorSelection]),
  ];
  issues.push(
    ...validateHistoricalAuthorityAuthentication({
      authorityHistory: closed.value.authorityHistory,
      historicalSelections: historicalSelectionInputs,
    }).map((issue) => `authorityHistory:${issue}`),
  );
  if (selections.reservation?.ok) {
    for (const name of ["accumulator", "attachment", "fence", "gate", "launch"] as const) {
      const selected = selections[name];
      if (
        selected?.ok &&
        selected.value.transactionId !== selections.reservation.value.transactionId
      )
        issues.push(`${name}Selection:transactionId-mismatch`);
    }
  }
  issues.push(
    ...validateCleanupHeadHistory(closed.value.gateHistory).map((issue) => `gateHistory:${issue}`),
  );
  issues.push(
    ...validateFenceHeadHistory(closed.value.fenceHistory).map((issue) => `fenceHistory:${issue}`),
  );
  for (const [name, limit] of Object.entries({
    gateHistory: fixedEvidencePacketLimits.maximumGateHeads,
    fenceHistory: fixedEvidencePacketLimits.maximumFenceHeads,
    launchHistory: fixedEvidencePacketLimits.maximumLaunchRecords,
    priorTerminalSummaries: fixedEvidencePacketLimits.maximumPriorTerminalSummaries,
  })) {
    const arrayResult = snapshotClosedArray(closed.value[name]);
    if (!arrayResult.ok) issues.push(...arrayResult.issues.map((issue) => `${name}:${issue}`));
    else if (arrayResult.value.length > limit) issues.push(`${name}:limit-exceeded`);
  }
  const singletons = {
    accumulator: "recovery-attempt-accumulator/v1",
    attachment: "recovery-authorization-attachment/v1",
    descriptor: "recovery-attempt-descriptor/v1",
    postConsume: "recovery-authorization-consume-receipt/v1",
    reservation: "recovery-attempt-reservation/v1",
  } as const;
  const parsedSingletons = Object.fromEntries(
    Object.entries(singletons).map(([name, schema]) => {
      const parsed = validateAgainstSchema(v2Definitions[schema]!, closed.value[name]);
      if (!parsed.ok) issues.push(...parsed.issues.map((issue) => `${name}:${issue}`));
      return [name, parsed];
    }),
  ) as Record<keyof typeof singletons, ReturnType<typeof validateAgainstSchema>>;
  const launchHistory = snapshotClosedArray(closed.value.launchHistory);
  if (launchHistory.ok) {
    let prior: ContractRecord | undefined;
    for (let index = 0; index < launchHistory.value.length; index += 1) {
      const parsed = validateAgainstSchema(
        v2Definitions["activation-recovery-launch/v2"]!,
        launchHistory.value[index],
      );
      if (!parsed.ok) {
        issues.push(...parsed.issues.map((issue) => `launchHistory:${index}:${issue}`));
        continue;
      }
      if (parsed.value.ordinal !== index) issues.push(`launchHistory:${index}:ordinal-mismatch`);
      if (index > 0 && prior) {
        if (parsed.value.previousRecordDigest !== canonicalDigest(prior))
          issues.push(`launchHistory:${index}:previous-digest-mismatch`);
        for (const name of [
          "activeReleaseDigest",
          "argvDigest",
          "attemptId",
          "gateRootDigest",
          "sourceToken",
          "stateRootDigest",
          "transactionId",
        ] as const)
          if (parsed.value[name] !== prior[name])
            issues.push(`launchHistory:${index}:${name}-changed`);
      }
      prior = parsed.value;
    }
  }
  const summaries = snapshotClosedArray(closed.value.priorTerminalSummaries);
  if (summaries.ok)
    for (let index = 0; index < summaries.value.length; index += 1) {
      const parsed = validateAgainstSchema(
        v2Definitions["recovery-attempt-terminal-summary/v1"]!,
        summaries.value[index],
      );
      if (!parsed.ok)
        issues.push(...parsed.issues.map((issue) => `priorTerminalSummaries:${index}:${issue}`));
    }
  if (Object.values(parsedSingletons).every((parsed) => parsed.ok)) {
    const reservation = parsedSingletons.reservation;
    const descriptor = parsedSingletons.descriptor;
    const accumulator = parsedSingletons.accumulator;
    const attachment = parsedSingletons.attachment;
    const postConsume = parsedSingletons.postConsume;
    if (reservation.ok && descriptor.ok && accumulator.ok && attachment.ok && postConsume.ok) {
      if (accumulator.value.lifecycle !== "IN_PROGRESS")
        issues.push("accumulator:lifecycle-not-in-progress");
      const priorTerminalSummary =
        summaries.ok && summaries.value.length === 1 ? summaries.value[0] : null;
      issues.push(
        ...validateRecoveryAccumulatorFormula({
          accumulator: accumulator.value,
          accumulatorSelection: closed.value.accumulatorSelection,
          currentAccumulatorPredecessorSelection:
            closed.value.currentAccumulatorPredecessorSelection,
          descriptor: descriptor.value,
          priorTerminalAccumulatorSelection: closed.value.priorTerminalAccumulatorSelection,
          priorTerminalSummary,
          reservation: reservation.value,
          reservationSelection: closed.value.reservationSelection,
          terminalSummary: null,
        }).map((issue) => `accumulatorFormula:${issue}`),
      );
      for (const [name, record] of [
        ["accumulator", accumulator.value],
        ["attachment", attachment.value],
        ["reservation", reservation.value],
      ] as const) {
        const selected = selections[name];
        if (selected?.ok && canonicalDigest(selected.value.value) !== canonicalDigest(record))
          issues.push(`${name}Selection:value-mismatch`);
      }
      for (const name of ["transactionId", "sourceToken"] as const)
        if (
          reservation.value[name] !== descriptor.value[name] ||
          reservation.value[name] !== accumulator.value[name]
        )
          issues.push(`${name}:singleton-mismatch`);
      if (
        reservation.value.attemptId !== descriptor.value.attemptId ||
        reservation.value.attemptId !== accumulator.value.attemptId
      )
        issues.push("attemptId:singleton-mismatch");
      for (const name of [
        "reservationTipDigest",
        "reservationValueDigest",
        "reservationReceiptDigest",
      ] as const)
        if (descriptor.value[name] !== accumulator.value[name])
          issues.push(`${name}:singleton-mismatch`);
      if (accumulator.value.descriptorDigest !== canonicalDigest(descriptor.value))
        issues.push("descriptorDigest:accumulator-mismatch");
      if (descriptor.value.lifecycle !== "LIVE") issues.push("descriptor:lifecycle-not-live");
      if (attachment.value.lifecycle !== "ATTACHED" && attachment.value.lifecycle !== "TERMINAL")
        issues.push("attachment:lifecycle-not-attached");
      for (const name of [
        "reservationTipDigest",
        "reservationValueDigest",
        "reservationReceiptDigest",
      ] as const)
        if (
          attachment.value[name] !== descriptor.value[name] ||
          attachment.value[name] !== accumulator.value[name]
        )
          issues.push(`${name}:attachment-singleton-mismatch`);
      if (attachment.value.descriptorDigest !== canonicalDigest(descriptor.value))
        issues.push("descriptorDigest:attachment-mismatch");
      if (attachment.value.transactionId !== descriptor.value.transactionId)
        issues.push("transactionId:attachment-descriptor-mismatch");
      for (const [attachmentName, postName] of [
        ["authorizationTipDigest", "authorizationTipDigest"],
        ["authorizationValueDigest", "authorizationValueDigest"],
        ["authorizationReceiptDigest", "authorizationReceiptDigest"],
      ] as const)
        if (attachment.value[attachmentName] !== postConsume.value[postName])
          issues.push(`${attachmentName}:attachment-consume-mismatch`);
      if (attachment.value.consumeReceiptDigest !== canonicalDigest(postConsume.value))
        issues.push("consumeReceiptDigest:attachment-mismatch");
      for (const name of [
        "argvDigest",
        "processIdentityDigest",
        "readyRecordDigest",
        "initialLiveRecordDigest",
      ] as const)
        if (attachment.value[name] !== descriptor.value[name])
          issues.push(`${name}:attachment-descriptor-mismatch`);
      for (const [attachmentName, descriptorName] of [
        ["gateHeadDigest", "gateHeadDigest"],
        ["fenceHeadDigest", "fenceHeadDigest"],
        ["activeReleaseDigest", "activeReleaseDigest"],
      ] as const)
        if (attachment.value[attachmentName] !== descriptor.value[descriptorName])
          issues.push(`${attachmentName}:attachment-descriptor-mismatch`);
      if (reservation.value.lifecycle !== "RESERVED")
        issues.push("reservation:lifecycle-not-reserved");
      if (launchHistory.ok && launchHistory.value.length >= 2) {
        const ready = validateAgainstSchema(
          v2Definitions["activation-recovery-launch/v2"]!,
          launchHistory.value[0],
        );
        const live = validateAgainstSchema(
          v2Definitions["activation-recovery-launch/v2"]!,
          launchHistory.value[1],
        );
        if (!ready.ok || !live.ok) return Object.freeze(issues);
        if (
          selections.launch?.ok &&
          canonicalDigest(selections.launch.value.value) !== canonicalDigest(live.value)
        )
          issues.push("launchSelection:value-mismatch");
        if (ready.value.lifecycle !== "READY" || live.value.lifecycle !== "LIVE")
          issues.push("launchHistory:ready-live-lifecycle-mismatch");
        if (descriptor.value.readyRecordDigest !== canonicalDigest(ready.value))
          issues.push("readyRecordDigest:launch-mismatch");
        if (descriptor.value.initialLiveRecordDigest !== canonicalDigest(live.value))
          issues.push("initialLiveRecordDigest:launch-mismatch");
        for (const name of [
          "activeReleaseDigest",
          "argvDigest",
          "attemptId",
          "fenceHeadDigest",
          "fenceRootDigest",
          "gateHeadDigest",
          "gateRootDigest",
          "sourceToken",
          "transactionId",
        ] as const)
          if (descriptor.value[name] !== ready.value[name])
            issues.push(`${name}:descriptor-launch-mismatch`);
      } else issues.push("launchHistory:ready-live-required");
      const selectedGateHistory = snapshotClosedArray(closed.value.gateHistory);
      if (
        selectedGateHistory.ok &&
        selectedGateHistory.value.length > 0 &&
        selections.gate?.ok &&
        canonicalDigest(selections.gate.value.value) !==
          canonicalDigest(selectedGateHistory.value.at(-1) as JsonValue)
      )
        issues.push("gateSelection:value-mismatch");
      if (
        selectedGateHistory.ok &&
        selectedGateHistory.value.length > 0 &&
        descriptor.value.gateHeadDigest !==
          canonicalDigest(selectedGateHistory.value.at(-1) as JsonValue)
      )
        issues.push("gateHeadDigest:history-mismatch");
      const selectedFenceHistory = snapshotClosedArray(closed.value.fenceHistory);
      if (
        selectedFenceHistory.ok &&
        selectedFenceHistory.value.length > 0 &&
        selections.fence?.ok &&
        canonicalDigest(selections.fence.value.value) !==
          canonicalDigest(selectedFenceHistory.value.at(-1) as JsonValue)
      )
        issues.push("fenceSelection:value-mismatch");
      if (
        selectedFenceHistory.ok &&
        selectedFenceHistory.value.length > 0 &&
        descriptor.value.fenceHeadDigest !==
          canonicalDigest(selectedFenceHistory.value.at(-1) as JsonValue)
      )
        issues.push("fenceHeadDigest:history-mismatch");
      const predecessorFields = [
        "priorTerminalAccumulatorTipDigest",
        "priorTerminalAccumulatorValueDigest",
        "priorTerminalAccumulatorReceiptDigest",
        "priorTerminalSummaryDigest",
      ] as const;
      for (const name of predecessorFields)
        if (attachment.value[name] !== accumulator.value[name])
          issues.push(`${name}:attachment-accumulator-mismatch`);
      if (summaries.ok) {
        const expectedSummaryDigest =
          summaries.value.length === 0 ? null : canonicalDigest(summaries.value[0] as JsonValue);
        if (accumulator.value.priorTerminalSummaryDigest !== expectedSummaryDigest)
          issues.push("priorTerminalSummaryDigest:packet-mismatch");
      }
    }
  }
  return Object.freeze(issues);
}

export type EpochSequenceStep =
  | "LOCK_ACQUIRED"
  | "AUTHORITY_READ"
  | "TARGET_RECONCILED"
  | "VALUE_PROPOSAL_WRITTEN"
  | "AUTHORITY_REREAD_PRE_CAS"
  | "TARGET_CAS_READBACK"
  | "PROPOSAL_CLASSIFIED"
  | "AUTHORITY_REREAD_POST_CAS"
  | "LOCK_RELEASED";
export const ordinaryEpochSequence: readonly EpochSequenceStep[] = Object.freeze([
  "LOCK_ACQUIRED",
  "AUTHORITY_READ",
  "TARGET_RECONCILED",
  "VALUE_PROPOSAL_WRITTEN",
  "AUTHORITY_REREAD_PRE_CAS",
  "TARGET_CAS_READBACK",
  "PROPOSAL_CLASSIFIED",
  "AUTHORITY_REREAD_POST_CAS",
  "LOCK_RELEASED",
]);
export function validateEpochSequence(input: unknown): boolean {
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok || snapshot.value.length !== ordinaryEpochSequence.length) return false;
  let selected: readonly string[] | undefined;
  for (let index = 0; index < snapshot.value.length; index += 1) {
    const entry = snapshotClosedRecord(snapshot.value[index], [
      "authorityEpochDigest",
      "authorityEpochReceiptDigest",
      "authorityEpochTipDigest",
      "authorityEpochValueDigest",
      "step",
    ]);
    if (!entry.ok || entry.value.step !== ordinaryEpochSequence[index]) return false;
    const triple = [
      entry.value.authorityEpochDigest,
      entry.value.authorityEpochTipDigest,
      entry.value.authorityEpochValueDigest,
      entry.value.authorityEpochReceiptDigest,
    ];
    if (triple.some((digest) => typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)))
      return false;
    if (entry.value.authorityEpochDigest !== entry.value.authorityEpochValueDigest) return false;
    if (selected && triple.some((digest, digestIndex) => digest !== selected![digestIndex]))
      return false;
    selected = triple as readonly string[];
  }
  return true;
}

export function validateCurrentCommitEpochComposition(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "authorityEpochSelection",
    "epochSequence",
    "mutation",
  ]);
  if (!closed.ok) return closed.issues;
  const issues: string[] = [];
  const authority = resolveSelectedPointerEvidence(closed.value.authorityEpochSelection);
  if (!authority.ok)
    issues.push(...authority.issues.map((issue) => `authorityEpochSelection:${issue}`));
  else if (authority.value.tip.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION")
    issues.push("authorityEpochSelection:pointer-kind-mismatch");
  if (!validateEpochSequence(closed.value.epochSequence)) issues.push("epochSequence:invalid");
  const mutation = snapshotClosedRecord(closed.value.mutation, [
    "disposition",
    "evidence",
    "readbackTipDigest",
  ]);
  if (!mutation.ok) return Object.freeze([...issues, ...mutation.issues]);
  if (mutation.value.disposition !== "PROPOSED" && mutation.value.disposition !== "SELECTED")
    issues.push("mutation:disposition-invalid");
  const selectedMutation = resolveSelectedPointerEvidence(mutation.value.evidence);
  if (!selectedMutation.ok)
    issues.push(...selectedMutation.issues.map((issue) => `mutation:${issue}`));
  if (authority.ok) {
    const sequence = snapshotClosedArray(closed.value.epochSequence);
    if (sequence.ok)
      for (const entryInput of sequence.value) {
        const entry = snapshotClosedRecord(entryInput, [
          "authorityEpochDigest",
          "authorityEpochReceiptDigest",
          "authorityEpochTipDigest",
          "authorityEpochValueDigest",
          "step",
        ]);
        if (
          !entry.ok ||
          entry.value.authorityEpochDigest !== authority.value.valueDigest ||
          entry.value.authorityEpochTipDigest !== authority.value.tipDigest ||
          entry.value.authorityEpochValueDigest !== authority.value.valueDigest ||
          entry.value.authorityEpochReceiptDigest !== authority.value.proposalReceiptDigest
        )
          issues.push("epochSequence:authority-selection-mismatch");
      }
    if (selectedMutation.ok) {
      for (const identity of ["installationId", "projectId", "stateRootDigest"] as const)
        if (selectedMutation.value[identity] !== authority.value[identity])
          issues.push(`mutation:${identity}-authority-mismatch`);
      for (const [proposalName, digestName] of [
        ["authorityEpochTipDigest", "tipDigest"],
        ["authorityEpochValueDigest", "valueDigest"],
        ["authorityEpochReceiptDigest", "proposalReceiptDigest"],
      ] as const)
        if (selectedMutation.value.proposal[proposalName] !== authority.value[digestName])
          issues.push(`mutation:${proposalName}-mismatch`);
    }
  }
  if (selectedMutation.ok) {
    if (mutation.value.disposition === "PROPOSED" && mutation.value.readbackTipDigest !== null)
      issues.push("mutation:proposed-readback-present");
    if (
      mutation.value.disposition === "SELECTED" &&
      mutation.value.readbackTipDigest !== selectedMutation.value.tipDigest
    )
      issues.push("mutation:selected-readback-mismatch");
  }
  return Object.freeze(issues);
}

export function validateHistoricalAuthorityAuthentication(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["authorityHistory", "historicalSelections"]);
  if (!closed.ok) return closed.issues;
  const authorityHistory = snapshotClosedArray(closed.value.authorityHistory);
  const historicalSelections = snapshotClosedArray(closed.value.historicalSelections);
  if (!authorityHistory.ok || !historicalSelections.ok)
    return Object.freeze([
      ...(!authorityHistory.ok
        ? authorityHistory.issues.map((issue) => `authorityHistory:${issue}`)
        : []),
      ...(!historicalSelections.ok
        ? historicalSelections.issues.map((issue) => `historicalSelections:${issue}`)
        : []),
    ]);
  const issues: string[] = [];
  if (authorityHistory.value.length > fixedEvidencePacketLimits.maximumAuthorityHistorySelections)
    issues.push("authorityHistory:limit-exceeded");
  if (historicalSelections.value.length > fixedEvidencePacketLimits.maximumHistoricalSelections)
    issues.push("historicalSelections:limit-exceeded");
  const authorityByTriple = new Map<string, SelectedPointerEvidence>();
  let priorAuthorityKey = "";
  for (const authorityInput of authorityHistory.value) {
    const authority = resolveSelectedPointerEvidence(authorityInput);
    if (!authority.ok) {
      issues.push(...authority.issues.map((issue) => `authority:${issue}`));
      continue;
    }
    if (authority.value.tip.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION") {
      issues.push("authority:pointer-kind-mismatch");
      continue;
    }
    const key = `${authority.value.tipDigest}/${authority.value.valueDigest}/${authority.value.proposalReceiptDigest}`;
    if (key <= priorAuthorityKey) issues.push("authorityHistory:not-strictly-sorted");
    if (authorityByTriple.has(key)) issues.push("authorityHistory:duplicate");
    priorAuthorityKey = key;
    authorityByTriple.set(key, authority.value);
  }
  const requiredKeys = new Set<string>();
  const pendingHistorical = [...historicalSelections.value];
  const observedHistorical = new Set<string>();
  let expandedHistoricalCount = 0;
  while (pendingHistorical.length > 0) {
    const historicalInput = pendingHistorical.shift();
    const historical = resolveSelectedPointerEvidence(historicalInput);
    if (!historical.ok) {
      issues.push(...historical.issues.map((issue) => `historical:${issue}`));
      continue;
    }
    const historicalKey = `${historical.value.tipDigest}/${historical.value.valueDigest}/${historical.value.proposalReceiptDigest}`;
    if (observedHistorical.has(historicalKey)) continue;
    observedHistorical.add(historicalKey);
    expandedHistoricalCount += 1;
    if (expandedHistoricalCount > fixedEvidencePacketLimits.maximumHistoricalSelections) {
      issues.push("historicalSelections:expanded-limit-exceeded");
      break;
    }
    if (historical.value.tip.pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION") {
      issues.push("historical:authority-row-must-use-history-table");
      continue;
    }
    const key = `${historical.value.proposal.authorityEpochTipDigest}/${historical.value.proposal.authorityEpochValueDigest}/${historical.value.proposal.authorityEpochReceiptDigest}`;
    requiredKeys.add(key);
    const authority = authorityByTriple.get(key);
    if (!authority) {
      issues.push("historical:producer-authority-missing");
      continue;
    }
    for (const identity of ["installationId", "projectId", "stateRootDigest"] as const)
      if (historical.value[identity] !== authority[identity])
        issues.push(`historical:${identity}-authority-mismatch`);
    if (historical.value.value.schemaVersion === "pointer-tombstone-value/v1") {
      const envelope = snapshotClosedRecord(historicalInput, [
        "canonicalPointerPath",
        "installationId",
        "pathBindings",
        "pointerKind",
        "positionEvidence",
        "projectId",
        "proposal",
        "sourceToken",
        "stateRootDigest",
        "tip",
        "tombstoneEvidence",
        "transactionId",
        "value",
      ]);
      const tombstoneEvidence = envelope.ok
        ? snapshotClosedRecord(envelope.value.tombstoneEvidence, [
            "archiveBindings",
            "archivePath",
            "archiveRecord",
            "priorSelection",
            "terminalProof",
          ])
        : null;
      if (!tombstoneEvidence?.ok) issues.push("historical:tombstone-prior-missing");
      else pendingHistorical.push(tombstoneEvidence.value.priorSelection as JsonValue);
    }
  }
  for (const key of authorityByTriple.keys())
    if (!requiredKeys.has(key)) issues.push("authorityHistory:unused-entry");
  return Object.freeze(issues);
}

export function validateRotationCensus(input: unknown): boolean {
  const snapshot = snapshotClosedRecord(input, ["authorityEpochDigest", "entries"]);
  if (!snapshot.ok || !/^[0-9a-f]{64}$/.test(String(snapshot.value.authorityEpochDigest)))
    return false;
  const entries = snapshotClosedArray(snapshot.value.entries);
  if (!entries.ok || entries.value.length < 10) return false;
  const expected = pointerKinds
    .filter((kind) => kind !== "STATE_MUTATION_AUTHORITY_ROTATION")
    .sort();
  const observedKinds = new Set<string>();
  const observedKeys = new Set<string>();
  let priorKey = "";
  for (const entry of entries.value) {
    const closed = snapshotClosedRecord(entry, [
      "classification",
      "pathInstanceDigest",
      "pointerKind",
      "proposalReceiptDigest",
      "tipDigest",
      "valueDigest",
    ]);
    if (!closed.ok) return false;
    const kind = closed.value.pointerKind;
    const dp = closed.value.pathInstanceDigest;
    const classification = closed.value.classification;
    if (typeof kind !== "string" || !expected.some((expectedKind) => expectedKind === kind))
      return false;
    if (typeof dp !== "string" || !/^[0-9a-f]{64}$/.test(dp)) return false;
    if (!["SELECTED", "LOST_CONFLICT", "COMPACTED"].includes(String(classification))) return false;
    for (const digestName of ["proposalReceiptDigest", "tipDigest", "valueDigest"])
      if (!/^[0-9a-f]{64}$/.test(String(closed.value[digestName]))) return false;
    const key = `${kind}/${dp}`;
    if (key <= priorKey || observedKeys.has(key)) return false;
    priorKey = key;
    observedKeys.add(key);
    observedKinds.add(kind);
  }
  return expected.every((kind) => observedKinds.has(kind));
}

export function validateRecoveryAccumulatorFormula(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, [
    "accumulator",
    "accumulatorSelection",
    "currentAccumulatorPredecessorSelection",
    "descriptor",
    "priorTerminalAccumulatorSelection",
    "priorTerminalSummary",
    "reservation",
    "reservationSelection",
    "terminalSummary",
  ]);
  if (!closed.ok) return closed.issues;
  const accumulator = validateAgainstSchema(
    v2Definitions["recovery-attempt-accumulator/v1"]!,
    closed.value.accumulator,
  );
  const descriptor = validateAgainstSchema(
    v2Definitions["recovery-attempt-descriptor/v1"]!,
    closed.value.descriptor,
  );
  const reservation = validateAgainstSchema(
    v2Definitions["recovery-attempt-reservation/v1"]!,
    closed.value.reservation,
  );
  if (!accumulator.ok || !descriptor.ok || !reservation.ok)
    return Object.freeze([
      ...(!accumulator.ok ? accumulator.issues.map((issue) => `accumulator:${issue}`) : []),
      ...(!descriptor.ok ? descriptor.issues.map((issue) => `descriptor:${issue}`) : []),
      ...(!reservation.ok ? reservation.issues.map((issue) => `reservation:${issue}`) : []),
    ]);
  const issues: string[] = [];
  const currentAccumulator = resolveSelectedPointerEvidence(closed.value.accumulatorSelection);
  const currentReservation = resolveSelectedPointerEvidence(closed.value.reservationSelection);
  if (!currentAccumulator.ok)
    issues.push(...currentAccumulator.issues.map((issue) => `accumulatorSelection:${issue}`));
  if (!currentReservation.ok)
    issues.push(...currentReservation.issues.map((issue) => `reservationSelection:${issue}`));
  if (currentAccumulator.ok) {
    if (currentAccumulator.value.tip.pointerKind !== "RECOVERY_ATTEMPT_ACCUMULATOR")
      issues.push("accumulatorSelection:pointer-kind-mismatch");
    if (canonicalDigest(currentAccumulator.value.value) !== canonicalDigest(accumulator.value))
      issues.push("accumulatorSelection:value-mismatch");
  }
  if (currentReservation.ok) {
    if (currentReservation.value.tip.pointerKind !== "RECOVERY_ATTEMPT_RESERVATION")
      issues.push("reservationSelection:pointer-kind-mismatch");
    if (canonicalDigest(currentReservation.value.value) !== canonicalDigest(reservation.value))
      issues.push("reservationSelection:value-mismatch");
    if (
      !nullGroup(currentReservation.value.proposal, [
        "priorTipDigest",
        "priorValueDigest",
        "priorReceiptDigest",
      ])
    )
      issues.push("reservationSelection:create-once-predecessor-not-null");
  }
  if (currentAccumulator.ok && currentReservation.ok)
    for (const name of [
      "installationId",
      "projectId",
      "stateRootDigest",
      "transactionId",
      "sourceToken",
    ] as const)
      if (currentAccumulator.value[name] !== currentReservation.value[name])
        issues.push(`${name}:selected-identity-mismatch`);
  for (const name of ["attemptId", "transactionId", "sourceToken"] as const)
    if (
      accumulator.value[name] !== descriptor.value[name] ||
      accumulator.value[name] !== reservation.value[name]
    )
      issues.push(`${name}:mismatch`);
  for (const name of [
    "reservationTipDigest",
    "reservationValueDigest",
    "reservationReceiptDigest",
  ] as const)
    if (accumulator.value[name] !== descriptor.value[name]) issues.push(`${name}:mismatch`);
  if (currentReservation.ok)
    for (const [name, digestName] of [
      ["reservationTipDigest", "tipDigest"],
      ["reservationValueDigest", "valueDigest"],
      ["reservationReceiptDigest", "proposalReceiptDigest"],
    ] as const)
      if (
        accumulator.value[name] !== currentReservation.value[digestName] ||
        descriptor.value[name] !== currentReservation.value[digestName]
      )
        issues.push(`${name}:selected-reservation-mismatch`);
  if (accumulator.value.descriptorDigest !== canonicalDigest(descriptor.value))
    issues.push("descriptorDigest:mismatch");
  if (reservation.value.lifecycle !== "RESERVED") issues.push("reservation:lifecycle-not-reserved");

  const lineageAbsent =
    closed.value.priorTerminalAccumulatorSelection === null &&
    closed.value.priorTerminalSummary === null;
  const lineagePresent =
    closed.value.priorTerminalAccumulatorSelection !== null &&
    closed.value.priorTerminalSummary !== null;
  if (!lineageAbsent && !lineagePresent) issues.push("lineage:partial");
  const currentPredecessor =
    closed.value.currentAccumulatorPredecessorSelection === null
      ? null
      : resolveSelectedPointerEvidence(closed.value.currentAccumulatorPredecessorSelection);
  if (currentPredecessor && !currentPredecessor.ok)
    issues.push(...currentPredecessor.issues.map((issue) => `currentPredecessor:${issue}`));
  const lineage = lineagePresent
    ? resolveSelectedPointerEvidence(closed.value.priorTerminalAccumulatorSelection)
    : null;
  const priorSummary = lineagePresent
    ? validateAgainstSchema(
        v2Definitions["recovery-attempt-terminal-summary/v1"]!,
        closed.value.priorTerminalSummary,
      )
    : null;
  if (lineage && !lineage.ok)
    issues.push(...lineage.issues.map((issue) => `priorTerminal:${issue}`));
  if (priorSummary && !priorSummary.ok)
    issues.push(...priorSummary.issues.map((issue) => `priorTerminalSummary:${issue}`));

  const samePointerIdentity = (
    role: string,
    selected: SelectedPointerEvidence,
    current: SelectedPointerEvidence,
  ): void => {
    for (const name of [
      "canonicalPointerPath",
      "pathInstanceDigest",
      "installationId",
      "projectId",
      "stateRootDigest",
      "transactionId",
      "sourceToken",
    ] as const)
      if (selected[name] !== current[name]) issues.push(`${role}:${name}-mismatch`);
  };
  const exactSelectedTriple = (
    left: SelectedPointerEvidence,
    right: SelectedPointerEvidence,
  ): boolean =>
    left.tipDigest === right.tipDigest &&
    left.valueDigest === right.valueDigest &&
    left.proposalReceiptDigest === right.proposalReceiptDigest;
  const proposalMatches = (
    proposal: ContractRecord,
    predecessor: SelectedPointerEvidence | null,
  ): boolean =>
    predecessor === null
      ? nullGroup(proposal, ["priorTipDigest", "priorValueDigest", "priorReceiptDigest"])
      : proposal.priorTipDigest === predecessor.tipDigest &&
        proposal.priorValueDigest === predecessor.valueDigest &&
        proposal.priorReceiptDigest === predecessor.proposalReceiptDigest;
  if (currentAccumulator.ok) {
    const currentPredecessorValue = currentPredecessor?.ok ? currentPredecessor.value : null;
    if (!proposalMatches(currentAccumulator.value.proposal, currentPredecessorValue))
      issues.push("accumulatorSelection:current-predecessor-mismatch");
    if (currentPredecessorValue) {
      if (currentPredecessorValue.tip.pointerKind !== "RECOVERY_ATTEMPT_ACCUMULATOR")
        issues.push("currentPredecessor:pointer-kind-mismatch");
      samePointerIdentity("currentPredecessor", currentPredecessorValue, currentAccumulator.value);
    }
    if (lineage?.ok) {
      if (lineage.value.tip.pointerKind !== "RECOVERY_ATTEMPT_ACCUMULATOR")
        issues.push("priorTerminal:pointer-kind-mismatch");
      if (lineage.value.value.lifecycle !== "TERMINAL") issues.push("priorTerminal:not-terminal");
      samePointerIdentity("priorTerminal", lineage.value, currentAccumulator.value);
    }
    const terminalCurrent = accumulator.value.lifecycle === "TERMINAL";
    if (!terminalCurrent && lineageAbsent) {
      if (currentPredecessorValue !== null) issues.push("case:r0-in-progress-current-not-null");
    } else if (terminalCurrent && lineageAbsent) {
      if (!currentPredecessorValue || currentPredecessorValue.value.lifecycle !== "IN_PROGRESS")
        issues.push("case:r0-terminal-current-not-in-progress");
    } else if (!terminalCurrent && lineagePresent) {
      if (
        !currentPredecessorValue ||
        !lineage?.ok ||
        !exactSelectedTriple(currentPredecessorValue, lineage.value)
      )
        issues.push("case:rn-in-progress-role-mismatch");
    } else if (terminalCurrent && lineagePresent) {
      if (!currentPredecessorValue || currentPredecessorValue.value.lifecycle !== "IN_PROGRESS")
        issues.push("case:rn-terminal-current-not-in-progress");
      if (
        currentPredecessorValue &&
        lineage?.ok &&
        exactSelectedTriple(currentPredecessorValue, lineage.value)
      )
        issues.push("case:rn-terminal-roles-collapsed");
    }
    if (
      terminalCurrent &&
      currentPredecessorValue?.value.lifecycle === "IN_PROGRESS" &&
      !proposalMatches(currentPredecessorValue.proposal, lineage?.ok ? lineage.value : null)
    )
      issues.push("currentPredecessor:in-progress-ancestry-mismatch");
    if (currentPredecessorValue?.value.lifecycle === "IN_PROGRESS") {
      for (const name of [
        "attemptId",
        "transactionId",
        "sourceToken",
        "reservationTipDigest",
        "reservationValueDigest",
        "reservationReceiptDigest",
        "descriptorDigest",
        "attachmentDigest",
        "priorTerminalAccumulatorTipDigest",
        "priorTerminalAccumulatorValueDigest",
        "priorTerminalAccumulatorReceiptDigest",
        "priorTerminalSummaryDigest",
      ] as const)
        if (currentPredecessorValue.value[name] !== accumulator.value[name])
          issues.push(`currentPredecessor:${name}-same-attempt-mismatch`);
    }
  }

  let priorValueDigest: string | null = null;
  if (lineage?.ok && priorSummary?.ok) {
    priorValueDigest = lineage.value.valueDigest;
    for (const [accumulatorName, digestName] of [
      ["priorTerminalAccumulatorTipDigest", "tipDigest"],
      ["priorTerminalAccumulatorValueDigest", "valueDigest"],
      ["priorTerminalAccumulatorReceiptDigest", "proposalReceiptDigest"],
    ] as const)
      if (accumulator.value[accumulatorName] !== lineage.value[digestName])
        issues.push(`${accumulatorName}:lineage-mismatch`);
    for (const [reservationName, digestName] of [
      ["predecessorAccumulatorTipDigest", "tipDigest"],
      ["predecessorAccumulatorValueDigest", "valueDigest"],
      ["predecessorAccumulatorReceiptDigest", "proposalReceiptDigest"],
    ] as const)
      if (reservation.value[reservationName] !== lineage.value[digestName])
        issues.push(`${reservationName}:reservation-lineage-mismatch`);
    const summaryDigest = canonicalDigest(priorSummary.value);
    if (accumulator.value.priorTerminalSummaryDigest !== summaryDigest)
      issues.push("priorTerminalSummaryDigest:mismatch");
    if (lineage.value.value.terminalSummaryDigest !== summaryDigest)
      issues.push("priorTerminal:summary-mismatch");
  } else {
    if (
      !nullGroup(accumulator.value, [
        "priorTerminalAccumulatorTipDigest",
        "priorTerminalAccumulatorValueDigest",
        "priorTerminalAccumulatorReceiptDigest",
        "priorTerminalSummaryDigest",
      ])
    )
      issues.push("lineage:genesis-fields-not-null");
    if (
      !nullGroup(reservation.value, [
        "predecessorAccumulatorTipDigest",
        "predecessorAccumulatorValueDigest",
        "predecessorAccumulatorReceiptDigest",
      ])
    )
      issues.push("reservation:genesis-lineage-not-null");
  }

  if (accumulator.value.lifecycle === "IN_PROGRESS") {
    if (closed.value.terminalSummary !== null) issues.push("terminalSummary:in-progress-present");
  } else {
    const summary = validateAgainstSchema(
      v2Definitions["recovery-attempt-terminal-summary/v1"]!,
      closed.value.terminalSummary,
    );
    if (!summary.ok) issues.push(...summary.issues.map((issue) => `terminalSummary:${issue}`));
    else {
      const summaryDigest = canonicalDigest(summary.value);
      if (accumulator.value.terminalSummaryDigest !== summaryDigest)
        issues.push("terminalSummaryDigest:mismatch");
      if (
        accumulator.value.rollingDigest !==
        recoveryAccumulatorDigest(priorValueDigest, summaryDigest)
      )
        issues.push("rollingDigest:mismatch");
      for (const name of ["attemptId", "transactionId", "sourceToken"] as const)
        if (summary.value[name] !== accumulator.value[name])
          issues.push(`summary:${name}-mismatch`);
      if (summary.value.descriptorDigest !== accumulator.value.descriptorDigest)
        issues.push("summary:descriptorDigest-mismatch");
      for (const [summaryName, accumulatorName] of [
        ["priorAccumulatorTipDigest", "priorTerminalAccumulatorTipDigest"],
        ["priorAccumulatorValueDigest", "priorTerminalAccumulatorValueDigest"],
        ["priorAccumulatorReceiptDigest", "priorTerminalAccumulatorReceiptDigest"],
      ] as const)
        if (summary.value[summaryName] !== accumulator.value[accumulatorName])
          issues.push(`${summaryName}:accumulator-mismatch`);
      for (const name of [
        "reservationTipDigest",
        "reservationValueDigest",
        "reservationReceiptDigest",
      ] as const)
        if (summary.value[name] !== accumulator.value[name])
          issues.push(`summary:${name}-mismatch`);
    }
  }
  return Object.freeze(issues);
}

export function recoveryAccumulatorDigest(
  priorValueDigest: string | null,
  terminalSummaryDigest: string,
): string {
  return priorValueDigest === null
    ? hashFrame("recovery-attempt-accumulator/v1", [
        rawFixedPart("00"),
        rawPart(terminalSummaryDigest),
      ])
    : hashFrame("recovery-attempt-accumulator/v1", [
        rawFixedPart("01"),
        rawPart(priorValueDigest),
        rawPart(terminalSummaryDigest),
      ]);
}
