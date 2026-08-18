import {
  canonicalBytes,
  canonicalDigest,
  closedRecord,
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const pointerKinds = Object.freeze([
  "ACTIVE_RELEASE",
  "ACTIVATION_CLEANUP_GATE",
  "ACTIVATION_RECOVERY_FENCE",
  "ACTIVATION_RECOVERY_LAUNCH",
  "RECOVERY_AUTHORIZATION_STATE",
  "RECOVERY_AUTHORIZATION_ATTACHMENT",
  "RECOVERY_ATTEMPT_LOG",
  "ACTIVATION_CLEANUP_ARCHIVE_HEAD",
  "RECOVERY_ATTEMPT_RESERVATION",
  "STATE_MUTATION_AUTHORITY_ROTATION",
  "POINTER_MUTATION_RUN_CURRENT",
] as const);
export type PointerKind = (typeof pointerKinds)[number];
export const stateMutationLockPath = "installation/state-mutation.lock";
export const stateMutationAuthorityPath = "installation/state-mutation-authority.json";

export interface PointerRegistryRow {
  readonly kind: PointerKind;
  readonly pathTemplate: string;
  readonly sourceTokens: readonly string[];
  readonly recordClass: "FULL_REQUIRED";
  readonly valueSchemas: readonly string[];
  readonly rootTemplates: readonly string[];
  readonly archiveTemplates: readonly string[];
  readonly genesis: "REVIEWED_BOOTSTRAP" | "TRANSACTION_CREATE_ONCE" | "PREDECESSOR_TRIPLE";
  readonly transactionPolicy: "REQUIRED" | "NULL";
  readonly sourcePolicy: "NONE" | "RECOVERY_SOURCE";
  readonly positionDomain: string;
  readonly tombstonePositionDomain: string | null;
}

type RawPointerRow = readonly [
  PointerKind,
  string,
  PointerRegistryRow["recordClass"],
  readonly string[],
  readonly string[],
  readonly string[],
  PointerRegistryRow["genesis"],
  PointerRegistryRow["transactionPolicy"],
  PointerRegistryRow["sourcePolicy"],
  string,
];
const rawRows: readonly RawPointerRow[] = [
  [
    "ACTIVE_RELEASE",
    "installation/active-release.json",
    "FULL_REQUIRED",
    ["active-release/v1", "pointer-tombstone-value/v1"],
    ["releases/<release-digest>/"],
    ["installation/active-release-archives/<transaction>.json"],
    "REVIEWED_BOOTSTRAP",
    "REQUIRED",
    "NONE",
    "active-release-position/v1",
  ],
  [
    "ACTIVATION_CLEANUP_GATE",
    "installation/activation-cleanup-gate.json",
    "FULL_REQUIRED",
    ["activation-cleanup-gate-head/v1", "pointer-tombstone-value/v1"],
    ["installation/activation-cleanup-gate-roots/<transaction>.json"],
    ["installation/activation-cleanup-gates/<transaction>.json"],
    "TRANSACTION_CREATE_ONCE",
    "REQUIRED",
    "NONE",
    "cleanup-gate-position/v1",
  ],
  [
    "ACTIVATION_RECOVERY_FENCE",
    "installation/activation-recovery-fence.json",
    "FULL_REQUIRED",
    ["activation-recovery-fence-head/v1", "pointer-tombstone-value/v1"],
    ["installation/activation-recovery-fence-roots/<transaction>.json"],
    ["installation/activation-recovery-fences/<transaction>.json"],
    "TRANSACTION_CREATE_ONCE",
    "REQUIRED",
    "NONE",
    "recovery-fence-position/v1",
  ],
  [
    "ACTIVATION_RECOVERY_LAUNCH",
    "installation/activation-recovery-launches/<transaction>/<source>/current.json",
    "FULL_REQUIRED",
    ["activation-recovery-launch/v1", "pointer-tombstone-value/v1"],
    ["installation/activation-recovery-launches/<transaction>/<source>/attempts/"],
    ["installation/activation-recovery-launches/<transaction>/<source>/archive.json"],
    "PREDECESSOR_TRIPLE",
    "REQUIRED",
    "RECOVERY_SOURCE",
    "recovery-launch-position/v1",
  ],
  [
    "RECOVERY_AUTHORIZATION_STATE",
    "installation/recovery-authorizations/<transaction>/state.json",
    "FULL_REQUIRED",
    ["recovery-authorization-state/v1", "pointer-tombstone-value/v1"],
    ["installation/recovery-authorizations/<transaction>/core.json"],
    ["installation/recovery-authorizations/<transaction>/archive.json"],
    "TRANSACTION_CREATE_ONCE",
    "REQUIRED",
    "NONE",
    "authorization-state-position/v1",
  ],
  [
    "RECOVERY_AUTHORIZATION_ATTACHMENT",
    "installation/recovery-authorizations/<transaction>/attachment.json",
    "FULL_REQUIRED",
    ["recovery-authorization-attachment/v1", "pointer-tombstone-value/v1"],
    ["installation/recovery-authorizations/<transaction>/state.json"],
    ["installation/recovery-authorizations/<transaction>/attachment-archive.json"],
    "TRANSACTION_CREATE_ONCE",
    "REQUIRED",
    "NONE",
    "authorization-attachment-position/v1",
  ],
  [
    "RECOVERY_ATTEMPT_LOG",
    "installation/activation-recovery-launches/<transaction>/<source>/attempt-log.json",
    "FULL_REQUIRED",
    ["attempt-log/v1", "pointer-tombstone-value/v1"],
    ["installation/activation-recovery-launches/<transaction>/<source>/attempts/"],
    ["installation/activation-recovery-launches/<transaction>/<source>/attempt-log-archive.json"],
    "PREDECESSOR_TRIPLE",
    "REQUIRED",
    "RECOVERY_SOURCE",
    "attempt-log-position/v1",
  ],
  [
    "ACTIVATION_CLEANUP_ARCHIVE_HEAD",
    "installation/activation-cleanup/archive-head.json",
    "FULL_REQUIRED",
    ["activation-cleanup-archive-head/v1", "pointer-tombstone-value/v1"],
    ["installation/activation-cleanup-gates/"],
    ["installation/activation-cleanup/archive-head-history/"],
    "REVIEWED_BOOTSTRAP",
    "REQUIRED",
    "NONE",
    "cleanup-archive-position/v1",
  ],
  [
    "RECOVERY_ATTEMPT_RESERVATION",
    "installation/activation-recovery-launches/<transaction>/<source>/reservations/<predecessor-key>.json",
    "FULL_REQUIRED",
    ["recovery-attempt-reservation/v1", "pointer-tombstone-value/v1"],
    ["installation/activation-recovery-launches/<transaction>/<source>/reservations/"],
    ["installation/activation-recovery-launches/<transaction>/<source>/reservation-archives/"],
    "PREDECESSOR_TRIPLE",
    "REQUIRED",
    "RECOVERY_SOURCE",
    "attempt-reservation-position/v1",
  ],
  [
    "STATE_MUTATION_AUTHORITY_ROTATION",
    stateMutationAuthorityPath,
    "FULL_REQUIRED",
    ["state-mutation-authority-value/v1"],
    [stateMutationLockPath],
    ["installation/state-mutation-authority-history/"],
    "REVIEWED_BOOTSTRAP",
    "NULL",
    "NONE",
    "authority-rotation-position/v1",
  ],
  [
    "POINTER_MUTATION_RUN_CURRENT",
    "installation/pointer-cas/<target-instance-digest>/commits/<target-mutation-id>/current-run.json",
    "FULL_REQUIRED",
    ["pointer-mutation-run-current-value/v1", "pointer-tombstone-value/v1"],
    ["installation/pointer-cas/<target-instance-digest>/commits/<target-mutation-id>/"],
    ["installation/pointer-cas/<target-instance-digest>/commits/<target-mutation-id>/runs/"],
    "PREDECESSOR_TRIPLE",
    "NULL",
    "NONE",
    "pointer-mutation-run-current-position/v1",
  ],
];
const rows: readonly PointerRegistryRow[] = rawRows.map(
  ([
    kind,
    pathTemplate,
    recordClass,
    valueSchemas,
    rootTemplates,
    archiveTemplates,
    genesis,
    transactionPolicy,
    sourcePolicy,
    positionDomain,
  ]) =>
    Object.freeze({
      kind,
      pathTemplate,
      sourceTokens: Object.freeze(
        sourcePolicy === "RECOVERY_SOURCE"
          ? ["recovery-fence", "cleanup-gate-pre-fence"]
          : ["none"],
      ),
      recordClass,
      valueSchemas: Object.freeze(valueSchemas),
      rootTemplates: Object.freeze(rootTemplates),
      archiveTemplates: Object.freeze(archiveTemplates),
      genesis,
      transactionPolicy,
      sourcePolicy,
      positionDomain,
      tombstonePositionDomain: valueSchemas.includes("pointer-tombstone-value/v1")
        ? `${positionDomain.slice(0, -3)}-tombstone/v1`
        : null,
    } as PointerRegistryRow),
);
export const pointerRegistry = Object.freeze(rows);

export interface PointerPathBindings {
  readonly transactionId?: string;
  readonly sourceToken?: string;
  readonly predecessorKey?: string;
  readonly pointerInstanceDigest?: string;
  readonly targetInstanceDigest?: string;
  readonly releaseDigest?: string;
  readonly targetMutationId?: string;
}

const placeholders = Object.freeze({
  "<transaction>": "transactionId",
  "<source>": "sourceToken",
  "<predecessor-key>": "predecessorKey",
  "<pointer-instance-digest>": "pointerInstanceDigest",
  "<target-instance-digest>": "targetInstanceDigest",
  "<release-digest>": "releaseDigest",
  "<target-mutation-id>": "targetMutationId",
} as const);

function rowFor(kind: PointerKind): PointerRegistryRow {
  const row = pointerRegistry.find((candidate) => candidate.kind === kind);
  if (!row) throw new TypeError("pointerKind:unsupported");
  return row;
}

function expectedBindings(template: string): readonly string[] {
  return Object.entries(placeholders)
    .filter(([token]) => template.includes(token))
    .map(([, name]) => name)
    .sort();
}

function expand(row: PointerRegistryRow, template: string, bindings: PointerPathBindings): string {
  const expected = expectedBindings(template);
  const closed = snapshotClosedRecord(bindings, expected);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  let result = template;
  for (const [token, name] of Object.entries(placeholders)) {
    if (!result.includes(token)) continue;
    const value = closed.value[name];
    if (name === "transactionId") {
      if (!isUuidV7(value)) throw new TypeError(`${name}:invalid`);
    } else if (name === "sourceToken") {
      if (typeof value !== "string" || !row.sourceTokens.includes(value))
        throw new TypeError(`${name}:invalid`);
    } else if (!isSha256(value)) throw new TypeError(`${name}:invalid`);
    result = result.replaceAll(token, String(value));
  }
  const checked = result.endsWith("/") ? result.slice(0, -1) : result;
  if (!isContractRelativePath(checked)) throw new TypeError("path:invalid");
  return result;
}

export function pointerPath(kind: PointerKind, bindings: PointerPathBindings = {}): string {
  const row = rowFor(kind);
  return expand(row, row.pathTemplate, bindings);
}
export function pointerRootPaths(
  kind: PointerKind,
  bindings: PointerPathBindings = {},
): readonly string[] {
  const row = rowFor(kind);
  return Object.freeze(row.rootTemplates.map((template) => expand(row, template, bindings)));
}
export function pointerArchivePaths(
  kind: PointerKind,
  bindings: PointerPathBindings = {},
): readonly string[] {
  const row = rowFor(kind);
  return Object.freeze(row.archiveTemplates.map((template) => expand(row, template, bindings)));
}
export function pointerGenesisRule(kind: PointerKind): PointerRegistryRow["genesis"] {
  return rowFor(kind).genesis;
}
export function validatePointerTemplateDispatch(
  kind: PointerKind,
  family: "ROOT" | "ARCHIVE",
  observedPaths: unknown,
  bindings: PointerPathBindings = {},
): readonly string[] {
  if (family !== "ROOT" && family !== "ARCHIVE") return ["templateFamily:unsupported"];
  if (!Array.isArray(observedPaths)) return ["observedPaths:array-required"];
  try {
    const expected =
      family === "ROOT" ? pointerRootPaths(kind, bindings) : pointerArchivePaths(kind, bindings);
    return canonicalDigest(observedPaths) === canonicalDigest(expected)
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
    return pointerGenesisRule(kind) === observed ? [] : ["genesis:mismatch"];
  } catch {
    return ["pointerKind:unsupported"];
  }
}
export function validatePointerDispatch(
  kind: PointerKind,
  observedPath: string,
  schemaVersion: string,
  bindings: PointerPathBindings = {},
): readonly string[] {
  try {
    const row = rowFor(kind);
    const issues: string[] = [];
    if (observedPath !== pointerPath(kind, bindings)) issues.push("pointerPath:mismatch");
    if (!row.valueSchemas.includes(schemaVersion))
      issues.push("schemaVersion:wrong-pointer-family");
    return Object.freeze(issues);
  } catch {
    return ["pointer:invalid-bindings"];
  }
}

export interface PointerIdentity {
  readonly pointerKind: PointerKind;
  readonly canonicalPointerPath: string;
  readonly installationId: string;
  readonly projectId: string;
  readonly stateRootDigest: string;
  readonly transactionId: string | null;
  readonly sourceToken: string;
  readonly positionEvidence: JsonValue;
}
export interface SelectedPointerEvidence extends PointerIdentity {
  readonly pathInstanceDigest: string;
  readonly mutationId: string;
  readonly value: ContractRecord;
  readonly valueDigest: string;
  readonly proposal: ContractRecord;
  readonly proposalReceiptDigest: string;
  readonly tip: ContractRecord;
  readonly tipDigest: string;
}

export function computePointerPositionDigest(kind: PointerKind, evidence: unknown): string {
  const row = rowFor(kind);
  const snapshot = snapshotClosedRecord(evidence, ["mode", "parts"]);
  if (!snapshot.ok) throw new TypeError(snapshot.issues.join(","));
  const mode = snapshot.value.mode;
  if (mode !== "VALUE" && mode !== "TOMBSTONE") throw new TypeError("mode:invalid");
  if (mode === "TOMBSTONE" && row.tombstonePositionDomain === null)
    throw new TypeError("mode:tombstone-refused");
  const domain = mode === "VALUE" ? row.positionDomain : row.tombstonePositionDomain!;
  return framedDigest(domain, [frame.canonical(snapshot.value)]);
}

export function computePointerInstanceDigest(input: PointerIdentity): string {
  const row = rowFor(input.pointerKind);
  const expectedPath = pointerPath(input.pointerKind, pathBindingsFor(row, input));
  if (input.canonicalPointerPath !== expectedPath)
    throw new TypeError("canonicalPointerPath:mismatch");
  if (
    !isUuidV7(input.installationId) ||
    !isUuidV7(input.projectId) ||
    !isSha256(input.stateRootDigest)
  )
    throw new TypeError("identity:invalid");
  if (
    row.transactionPolicy === "REQUIRED"
      ? !isUuidV7(input.transactionId ?? undefined)
      : input.transactionId !== null
  )
    throw new TypeError("transactionId:invalid");
  if (!row.sourceTokens.includes(input.sourceToken)) throw new TypeError("sourceToken:invalid");
  return framedDigest("pointer-instance/v1", [
    frame.text(input.pointerKind),
    frame.text(input.canonicalPointerPath),
    frame.text(input.installationId),
    frame.text(input.projectId),
    frame.raw32(input.stateRootDigest),
    frame.nullableText(input.transactionId),
    frame.text(input.sourceToken),
  ]);
}

function pathBindingsFor(row: PointerRegistryRow, input: PointerIdentity): PointerPathBindings {
  const bindings: Record<string, string> = {};
  for (const name of expectedBindings(row.pathTemplate)) {
    if (name === "transactionId" && input.transactionId) bindings[name] = input.transactionId;
    else if (name === "sourceToken") bindings[name] = input.sourceToken;
    else {
      const parts = input.positionEvidence as Readonly<Record<string, JsonValue>>;
      const nested = parts?.parts as Readonly<Record<string, JsonValue>> | undefined;
      const value = nested?.[name];
      if (typeof value === "string") bindings[name] = value;
    }
  }
  return bindings;
}

export function computePointerValueDigest(
  kind: PointerKind,
  pathInstanceDigest: string,
  value: unknown,
): string {
  rowFor(kind);
  if (!isSha256(pathInstanceDigest)) throw new TypeError("pathInstanceDigest:invalid");
  return framedDigest("pointer-value/v1", [
    frame.text(kind),
    frame.raw32(pathInstanceDigest),
    frame.canonical(snapshotRecord(value)),
  ]);
}
function snapshotRecord(input: unknown): ContractRecord {
  const raw = input as Record<string, unknown>;
  const closed = snapshotClosedRecord(
    input,
    input && typeof input === "object" && !Array.isArray(input) ? Object.keys(raw) : [],
  );
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  return closed.value;
}

const proposalFields = [
  "authorityEpochReceiptDigest",
  "authorityEpochTipDigest",
  "authorityEpochValueDigest",
  "intent",
  "mutationId",
  "outcome",
  "pathInstanceDigest",
  "pointerKind",
  "positionDigest",
  "priorReceiptDigest",
  "priorTipDigest",
  "priorValueDigest",
  "producerDigest",
  "producerKind",
  "proposedAt",
  "schemaVersion",
  "successorValueDigest",
] as const;
const currentTipFields = Object.freeze([
  "pathInstanceDigest",
  "pointerKind",
  "proposalReceiptDigest",
  "schemaVersion",
  "valueDigest",
] as const);
const conflictFields = Object.freeze([
  "authorityEpochReceiptDigest",
  "authorityEpochTipDigest",
  "authorityEpochValueDigest",
  "conflictAt",
  "conflictKind",
  "losingProposalReceiptDigest",
  "losingSuccessorValueDigest",
  "mutationId",
  "pathInstanceDigest",
  "schemaVersion",
  "winningReceiptDigest",
  "winningTipDigest",
  "winningValueDigest",
] as const);
const tombstoneFields = Object.freeze([
  "archiveDigest",
  "pointerKind",
  "priorReceiptDigest",
  "priorTipDigest",
  "priorValueDigest",
  "schemaVersion",
  "terminalProofDigest",
  "tombstonedAt",
] as const);
export const pointerGraphSchemaFields = Object.freeze({
  currentTip: currentTipFields,
  proposal: Object.freeze(proposalFields),
  conflict: conflictFields,
  tombstone: tombstoneFields,
});
export const pointerGraphSchemaVersions = Object.freeze([
  "pointer-cas-proposal-receipt/v1",
  "pointer-conflict-receipt/v1",
  "pointer-current-tip/v1",
  "pointer-tombstone-value/v1",
] as const);

function pointerParseFailure(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function storageDigest(value: string, name: string): string {
  if (!isSha256(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

function pointerPriorBucket(priorTipDigest: string | null): string {
  return priorTipDigest === null ? "genesis" : storageDigest(priorTipDigest, "priorTipDigest");
}

export const pointerStoragePaths = Object.freeze({
  value: (pathInstanceDigest: string, mutationId: string): string =>
    `installation/pointer-cas/${storageDigest(pathInstanceDigest, "pathInstanceDigest")}/values/${storageDigest(mutationId, "mutationId")}.json`,
  proposal: (
    pathInstanceDigest: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `installation/pointer-cas/${storageDigest(pathInstanceDigest, "pathInstanceDigest")}/proposals/${pointerPriorBucket(priorTipDigest)}/${storageDigest(mutationId, "mutationId")}.json`,
  conflict: (
    pathInstanceDigest: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `installation/pointer-cas/${storageDigest(pathInstanceDigest, "pathInstanceDigest")}/conflicts/${pointerPriorBucket(priorTipDigest)}/${storageDigest(mutationId, "mutationId")}.json`,
});

export function parsePointerProposal(input: unknown): ParseResult {
  try {
    return { ok: true, value: requireProposal(input) };
  } catch (error) {
    return pointerParseFailure(String((error as Error)?.message ?? error));
  }
}

export function computeProposalReceiptDigest(input: unknown): string {
  const record = requireProposal(input);
  return framedDigest("pointer-receipt/v1", [
    frame.text(String(record.pointerKind)),
    frame.raw32(String(record.pathInstanceDigest)),
    frame.raw32(String(record.mutationId)),
    frame.nullableRaw32(record.priorTipDigest as string | null),
    frame.nullableRaw32(record.priorValueDigest as string | null),
    frame.nullableRaw32(record.priorReceiptDigest as string | null),
    frame.raw32(String(record.successorValueDigest)),
    frame.raw32(String(record.positionDigest)),
    frame.text(String(record.intent)),
    frame.text(String(record.outcome)),
    frame.canonical(record),
  ]);
}
function requireProposal(input: unknown): ContractRecord {
  const closed = snapshotClosedRecord(input, proposalFields);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  const record = closed.value;
  if (
    record.schemaVersion !== "pointer-cas-proposal-receipt/v1" ||
    !["VALUE_PROPOSED", "TOMBSTONE_PROPOSED"].includes(String(record.intent))
  )
    throw new TypeError("proposal:invalid");
  if (!["SELECT", "REMOVE"].includes(String(record.outcome)))
    throw new TypeError("outcome:invalid");
  if (!pointerKinds.includes(record.pointerKind as PointerKind))
    throw new TypeError("pointerKind:invalid");
  for (const name of [
    "pathInstanceDigest",
    "mutationId",
    "successorValueDigest",
    "positionDigest",
    "producerDigest",
  ] as const)
    if (!isSha256(record[name])) throw new TypeError(`${name}:invalid`);
  const prior = [record.priorTipDigest, record.priorValueDigest, record.priorReceiptDigest];
  if (!(prior.every((item) => item === null) || prior.every((item) => isSha256(item))))
    throw new TypeError("priorTriple:partial");
  const epoch = [
    record.authorityEpochTipDigest,
    record.authorityEpochValueDigest,
    record.authorityEpochReceiptDigest,
  ];
  const bootstrap = record.producerKind === "REVIEWED_BOOTSTRAP_GENESIS";
  if (!bootstrap && record.producerKind !== "SELECTED_EPOCH")
    throw new TypeError("producerKind:invalid");
  if (bootstrap ? !epoch.every((item) => item === null) : !epoch.every((item) => isSha256(item)))
    throw new TypeError("producerKind:epoch-mismatch");
  if (
    bootstrap &&
    (record.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION" ||
      record.intent !== "VALUE_PROPOSED" ||
      record.outcome !== "SELECT" ||
      !prior.every((item) => item === null))
  )
    throw new TypeError("producerKind:bootstrap-selection-mismatch");
  if (!isCanonicalTimestamp(record.proposedAt)) throw new TypeError("proposedAt:invalid");
  return record;
}
export function computeCurrentTipDigest(input: unknown): string {
  const parsed = parsePointerCurrentTip(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const tip = parsed.value;
  return framedDigest("pointer-tip/v1", [
    frame.text(String(tip.pointerKind)),
    frame.raw32(String(tip.pathInstanceDigest)),
    frame.raw32(String(tip.valueDigest)),
    frame.raw32(String(tip.proposalReceiptDigest)),
    frame.canonical(tip),
  ]);
}
export function parsePointerCurrentTip(input: unknown): ParseResult {
  const closed = snapshotClosedRecord(input, currentTipFields);
  if (!closed.ok) return closed;
  if (closed.value.schemaVersion !== "pointer-current-tip/v1")
    return pointerParseFailure("schemaVersion:mismatch");
  if (!pointerKinds.includes(closed.value.pointerKind as PointerKind))
    return pointerParseFailure("pointerKind:invalid");
  const issues = ["pathInstanceDigest", "valueDigest", "proposalReceiptDigest"]
    .filter((field) => !isSha256(closed.value[field]))
    .map((field) => `${field}:invalid`);
  return issues.length === 0 ? closed : pointerParseFailure(...issues);
}
export function computeMutationId(input: unknown): string {
  const closed = snapshotClosedRecord(input, [
    "pointerKind",
    "canonicalPointerPath",
    "installationId",
    "projectId",
    "stateRootDigest",
    "transactionId",
    "sourceToken",
    "positionEvidence",
    "priorTipDigest",
    "priorValueDigest",
    "priorReceiptDigest",
    "successorValueDigest",
    "outcome",
  ]);
  if (!closed.ok) throw new TypeError(closed.issues.join(","));
  const r = closed.value;
  const dp = computePointerInstanceDigest(r as unknown as PointerIdentity);
  const prior = [r.priorTipDigest, r.priorValueDigest, r.priorReceiptDigest];
  if (!(prior.every((item) => item === null) || prior.every((item) => isSha256(item))))
    throw new TypeError("priorTriple:partial");
  if (!isSha256(r.successorValueDigest)) throw new TypeError("successorValueDigest:invalid");
  if (r.outcome !== "SELECT" && r.outcome !== "REMOVE") throw new TypeError("outcome:invalid");
  return framedDigest("pointer-mutation-id/v1", [
    frame.text(String(r.pointerKind)),
    frame.text(String(r.canonicalPointerPath)),
    frame.raw32(dp),
    frame.nullableText(r.transactionId as string | null),
    frame.text(String(r.sourceToken)),
    frame.raw32(computePointerPositionDigest(r.pointerKind as PointerKind, r.positionEvidence)),
    frame.nullableRaw32(r.priorTipDigest as string | null),
    frame.nullableRaw32(r.priorValueDigest as string | null),
    frame.nullableRaw32(r.priorReceiptDigest as string | null),
    frame.raw32(String(r.successorValueDigest)),
    frame.text(String(r.outcome)),
  ]);
}
export function computeConflictDigest(input: unknown): string {
  const parsed = parsePointerConflict(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  const conflict = parsed.value;
  return framedDigest("pointer-conflict-receipt/v1", [
    frame.raw32(String(conflict.pathInstanceDigest)),
    frame.raw32(String(conflict.mutationId)),
    frame.raw32(String(conflict.losingProposalReceiptDigest)),
    frame.raw32(String(conflict.losingSuccessorValueDigest)),
    frame.raw32(String(conflict.winningTipDigest)),
    frame.raw32(String(conflict.winningValueDigest)),
    frame.raw32(String(conflict.winningReceiptDigest)),
    frame.text(String(conflict.conflictKind)),
    frame.raw32(String(conflict.authorityEpochTipDigest)),
    frame.raw32(String(conflict.authorityEpochValueDigest)),
    frame.raw32(String(conflict.authorityEpochReceiptDigest)),
    frame.text(String(conflict.conflictAt)),
    frame.canonical(conflict),
  ]);
}
export function parsePointerConflict(input: unknown): ParseResult {
  const closed = snapshotClosedRecord(input, conflictFields);
  if (!closed.ok) return closed;
  if (closed.value.schemaVersion !== "pointer-conflict-receipt/v1")
    return pointerParseFailure("schemaVersion:mismatch");
  const digestFields = conflictFields.filter((field) => field.endsWith("Digest"));
  const issues = digestFields
    .filter((field) => !isSha256(closed.value[field]))
    .map((field) => `${field}:invalid`);
  if (
    !["VALUE_CONFLICT", "TOMBSTONE_CONFLICT", "EPOCH_CONFLICT"].includes(
      String(closed.value.conflictKind),
    )
  )
    issues.push("conflictKind:invalid");
  if (!isCanonicalTimestamp(closed.value.conflictAt)) issues.push("conflictAt:invalid");
  return issues.length === 0 ? closed : pointerParseFailure(...issues);
}

export function parsePointerTombstoneValue(input: unknown): ParseResult {
  const closed = snapshotClosedRecord(input, tombstoneFields);
  if (!closed.ok) return closed;
  const record = closed.value;
  const issues: string[] = [];
  if (record.schemaVersion !== "pointer-tombstone-value/v1") issues.push("schemaVersion:mismatch");
  if (
    !pointerKinds.includes(record.pointerKind as PointerKind) ||
    record.pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION"
  )
    issues.push("pointerKind:invalid");
  for (const field of [
    "archiveDigest",
    "priorReceiptDigest",
    "priorTipDigest",
    "priorValueDigest",
    "terminalProofDigest",
  ] as const)
    if (!isSha256(record[field])) issues.push(`${field}:invalid`);
  if (!isCanonicalTimestamp(record.tombstonedAt)) issues.push("tombstonedAt:invalid");
  return issues.length === 0 ? closed : pointerParseFailure(...issues);
}

export function parsePointerGraphContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  switch (expectedSchemaVersion) {
    case "pointer-cas-proposal-receipt/v1":
      return parsePointerProposal(input);
    case "pointer-conflict-receipt/v1":
      return parsePointerConflict(input);
    case "pointer-current-tip/v1":
      return parsePointerCurrentTip(input);
    case "pointer-tombstone-value/v1":
      return parsePointerTombstoneValue(input);
    default:
      return undefined;
  }
}

export type ProposalClassification = "PENDING" | "SELECTED" | "LOST_CONFLICT" | "UNKNOWN";
export function classifyProposal(input: unknown): ProposalClassification {
  const closed = snapshotClosedRecord(input, [
    "proposal",
    "selectedTip",
    "selectedValue",
    "selectedProposal",
    "conflictReceipt",
  ]);
  if (!closed.ok) return "UNKNOWN";
  try {
    const proposal = requireProposal(closed.value.proposal);
    const expectedDr = computeProposalReceiptDigest(proposal);
    const tip = closed.value.selectedTip;
    if (tip === null)
      return closed.value.selectedValue === null &&
        closed.value.selectedProposal === null &&
        closed.value.conflictReceipt === null
        ? "PENDING"
        : "UNKNOWN";
    const selected = validateSelectedPointerEvidence({
      value: closed.value.selectedValue,
      proposal: closed.value.selectedProposal,
      tip,
    });
    if (selected.length > 0) return "UNKNOWN";
    const selectedProposal = requireProposal(closed.value.selectedProposal);
    const selectedDr = computeProposalReceiptDigest(selectedProposal);
    if (selectedDr === expectedDr)
      return closed.value.conflictReceipt === null ? "SELECTED" : "UNKNOWN";
    if (selectedProposal.pathInstanceDigest !== proposal.pathInstanceDigest) return "UNKNOWN";
    if (closed.value.conflictReceipt === null) return "PENDING";
    const conflict = snapshotClosedRecord(closed.value.conflictReceipt, [
      "authorityEpochReceiptDigest",
      "authorityEpochTipDigest",
      "authorityEpochValueDigest",
      "conflictAt",
      "conflictKind",
      "losingProposalReceiptDigest",
      "losingSuccessorValueDigest",
      "mutationId",
      "pathInstanceDigest",
      "schemaVersion",
      "winningReceiptDigest",
      "winningTipDigest",
      "winningValueDigest",
    ]);
    if (!conflict.ok) return "UNKNOWN";
    computeConflictDigest(conflict.value);
    return conflict.value.pathInstanceDigest === proposal.pathInstanceDigest &&
      conflict.value.mutationId === proposal.mutationId &&
      conflict.value.losingProposalReceiptDigest === expectedDr &&
      conflict.value.losingSuccessorValueDigest === proposal.successorValueDigest &&
      conflict.value.winningTipDigest === computeCurrentTipDigest(closed.value.selectedTip) &&
      conflict.value.winningValueDigest ===
        computePointerValueDigest(
          selectedProposal.pointerKind as PointerKind,
          String(selectedProposal.pathInstanceDigest),
          closed.value.selectedValue,
        ) &&
      conflict.value.winningReceiptDigest === selectedDr
      ? "LOST_CONFLICT"
      : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export function validateSelectedPointerEvidence(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["value", "proposal", "tip"]);
  if (!closed.ok) return closed.issues;
  try {
    const proposal = requireProposal(closed.value.proposal);
    const valueDigest = computePointerValueDigest(
      proposal.pointerKind as PointerKind,
      String(proposal.pathInstanceDigest),
      closed.value.value,
    );
    const receiptDigest = computeProposalReceiptDigest(proposal);
    const tip = snapshotRecord(closed.value.tip);
    const issues: string[] = [];
    if (proposal.successorValueDigest !== valueDigest)
      issues.push("proposal:value-digest-mismatch");
    if (tip.valueDigest !== valueDigest) issues.push("tip:value-digest-mismatch");
    if (tip.proposalReceiptDigest !== receiptDigest) issues.push("tip:receipt-digest-mismatch");
    if (
      tip.pathInstanceDigest !== proposal.pathInstanceDigest ||
      tip.pointerKind !== proposal.pointerKind
    )
      issues.push("tip:identity-mismatch");
    return Object.freeze(issues);
  } catch {
    return ["selectedEvidence:invalid"];
  }
}

export function validatePointerRegistry(): readonly string[] {
  const issues: string[] = [];
  if (pointerRegistry.length !== 11 || new Set(pointerRegistry.map((row) => row.kind)).size !== 11)
    issues.push("registry:census");
  if (new Set(pointerRegistry.map((row) => row.pathTemplate)).size !== pointerRegistry.length)
    issues.push("registry:path-collision");
  const tokens = pointerRegistry.flatMap((row) =>
    row.sourceTokens
      .filter((token) => token !== "none")
      .map((token) => `${row.sourcePolicy}/${token}`),
  );
  if (new Set(tokens).size !== 2) issues.push("registry:source-token-collision");
  for (const row of pointerRegistry) {
    if (row.valueSchemas.some((version) => !version.endsWith("/v1")))
      issues.push(`${row.kind}:non-v1-schema`);
    if (row.recordClass !== "FULL_REQUIRED") issues.push(`${row.kind}:record-class`);
    if (row.pathTemplate.includes("node-inventory") || row.pathTemplate.includes("coordinator"))
      issues.push(`${row.kind}:obsolete-path`);
    const expectedTokens =
      row.sourcePolicy === "RECOVERY_SOURCE"
        ? ["recovery-fence", "cleanup-gate-pre-fence"]
        : ["none"];
    if (canonicalDigest(row.sourceTokens) !== canonicalDigest(expectedTokens))
      issues.push(`${row.kind}:source-tokens`);
  }
  return Object.freeze(issues);
}

export const pointerGraphFields = Object.freeze({ proposalFields });
