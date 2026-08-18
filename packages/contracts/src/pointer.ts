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
  "AUTHORITY_RETENTION",
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

type RawPointerRow = readonly [
  PointerKind,
  string,
  PointerRegistryRow["retention"],
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
    "TERMINAL_CHECKPOINT_ALLOWED",
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
    "TERMINAL_CHECKPOINT_ALLOWED",
    ["attempt-log/v1", "pointer-tombstone-value/v1"],
    ["installation/activation-recovery-launches/<transaction>/<source>/attempts/"],
    ["installation/activation-recovery-launches/<transaction>/<source>/attempt-log-checkpoints/"],
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
    "AUTHORITY_RETENTION",
    "installation/authority-retention/<pointer-instance-digest>.json",
    "FULL_REQUIRED",
    ["authority-retention/v1"],
    ["installation/pointer-cas/<pointer-instance-digest>/"],
    ["installation/authority-retention-archives/<pointer-instance-digest>.json"],
    "TRANSACTION_CREATE_ONCE",
    "NULL",
    "NONE",
    "authority-retention-position/v1",
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
    "installation/pointer-cas/<pointer-instance-digest>/commits/<target-mutation-id>/current-run.json",
    "FULL_REQUIRED",
    ["pointer-mutation-run-current-value/v1", "pointer-tombstone-value/v1"],
    ["installation/pointer-cas/<pointer-instance-digest>/commits/<target-mutation-id>/"],
    ["installation/pointer-cas/<pointer-instance-digest>/commits/<target-mutation-id>/runs/"],
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
    retention,
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
      retention,
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
  readonly releaseDigest?: string;
  readonly targetMutationId?: string;
}

const placeholders = Object.freeze({
  "<transaction>": "transactionId",
  "<source>": "sourceToken",
  "<predecessor-key>": "predecessorKey",
  "<pointer-instance-digest>": "pointerInstanceDigest",
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
    frame.raw32(computePointerPositionDigest(input.pointerKind, input.positionEvidence)),
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

export function computePointerValueDigest(value: unknown): string {
  return framedDigest("pointer-value/v1", [frame.canonical(snapshotRecord(value))]);
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
  "schemaVersion",
  "intent",
  "pointerKind",
  "pathInstanceDigest",
  "mutationId",
  "priorTipDigest",
  "priorValueDigest",
  "priorReceiptDigest",
  "successorValueDigest",
  "producerAuthorityTipDigest",
  "producerAuthorityValueDigest",
  "producerAuthorityReceiptDigest",
  "createdAt",
] as const;
export function computeProposalReceiptDigest(input: unknown): string {
  const record = requireProposal(input);
  return framedDigest("pointer-receipt/v1", [
    frame.text("pointer-cas-proposal-receipt/v1"),
    frame.text(String(record.intent)),
    frame.text(String(record.pointerKind)),
    frame.raw32(String(record.pathInstanceDigest)),
    frame.raw32(String(record.mutationId)),
    frame.nullableRaw32(record.priorTipDigest as string | null),
    frame.nullableRaw32(record.priorValueDigest as string | null),
    frame.nullableRaw32(record.priorReceiptDigest as string | null),
    frame.raw32(String(record.successorValueDigest)),
    frame.raw32(String(record.producerAuthorityTipDigest)),
    frame.raw32(String(record.producerAuthorityValueDigest)),
    frame.raw32(String(record.producerAuthorityReceiptDigest)),
    frame.text(String(record.createdAt)),
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
  if (!pointerKinds.includes(record.pointerKind as PointerKind))
    throw new TypeError("pointerKind:invalid");
  for (const name of [
    "pathInstanceDigest",
    "mutationId",
    "successorValueDigest",
    "producerAuthorityTipDigest",
    "producerAuthorityValueDigest",
    "producerAuthorityReceiptDigest",
  ] as const)
    if (!isSha256(record[name])) throw new TypeError(`${name}:invalid`);
  const prior = [record.priorTipDigest, record.priorValueDigest, record.priorReceiptDigest];
  if (!(prior.every((item) => item === null) || prior.every((item) => isSha256(item))))
    throw new TypeError("priorTriple:partial");
  if (!isCanonicalTimestamp(record.createdAt)) throw new TypeError("createdAt:invalid");
  return record;
}
export function computeCurrentTipDigest(input: unknown): string {
  const closed = snapshotClosedRecord(input, [
    "schemaVersion",
    "pointerKind",
    "pathInstanceDigest",
    "valueDigest",
    "proposalReceiptDigest",
  ]);
  if (!closed.ok || closed.value.schemaVersion !== "pointer-current-tip/v1")
    throw new TypeError("tip:invalid");
  if (
    !pointerKinds.includes(closed.value.pointerKind as PointerKind) ||
    !isSha256(closed.value.pathInstanceDigest) ||
    !isSha256(closed.value.valueDigest) ||
    !isSha256(closed.value.proposalReceiptDigest)
  )
    throw new TypeError("tip:invalid-fields");
  return framedDigest("pointer-tip/v1", [
    frame.text(String(closed.value.pointerKind)),
    frame.raw32(String(closed.value.pathInstanceDigest)),
    frame.raw32(String(closed.value.valueDigest)),
    frame.raw32(String(closed.value.proposalReceiptDigest)),
    frame.canonical(closed.value),
  ]);
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
  return framedDigest("pointer-mutation-id/v1", [
    frame.raw32(dp),
    frame.nullableRaw32(r.priorTipDigest as string | null),
    frame.nullableRaw32(r.priorValueDigest as string | null),
    frame.nullableRaw32(r.priorReceiptDigest as string | null),
    frame.raw32(String(r.successorValueDigest)),
    frame.text(String(r.outcome)),
    frame.canonical(r),
  ]);
}
export function computeConflictDigest(input: unknown): string {
  const closed = snapshotClosedRecord(input, [
    "schemaVersion",
    "pathInstanceDigest",
    "loserMutationId",
    "loserValueDigest",
    "winnerTipDigest",
    "winnerValueDigest",
    "winnerReceiptDigest",
  ]);
  if (!closed.ok || closed.value.schemaVersion !== "pointer-conflict-receipt/v1")
    throw new TypeError("conflict:invalid");
  const names = [
    "pathInstanceDigest",
    "loserMutationId",
    "loserValueDigest",
    "winnerTipDigest",
    "winnerValueDigest",
    "winnerReceiptDigest",
  ] as const;
  if (names.some((name) => !isSha256(closed.value[name])))
    throw new TypeError("conflict:invalid-digest");
  return framedDigest(
    "pointer-conflict-receipt/v1",
    names
      .map((name) => frame.raw32(String(closed.value[name])))
      .concat([frame.canonical(closed.value)]),
  );
}

export type ProposalClassification =
  "PENDING" | "SELECTED" | "LOST_CONFLICT" | "COMPACTED" | "UNKNOWN";
export function classifyProposal(input: unknown): ProposalClassification {
  const closed = snapshotClosedRecord(input, [
    "proposal",
    "selectedTip",
    "selectedValue",
    "selectedProposal",
    "conflictReceipt",
    "retention",
  ]);
  if (!closed.ok) return "UNKNOWN";
  try {
    const proposal = requireProposal(closed.value.proposal);
    const expectedDr = computeProposalReceiptDigest(proposal);
    const tip = closed.value.selectedTip;
    if (tip === null) return closed.value.retention === null ? "PENDING" : "UNKNOWN";
    const selected = validateSelectedPointerEvidence({
      value: closed.value.selectedValue,
      proposal: closed.value.selectedProposal,
      tip,
    });
    if (selected.length > 0) return "UNKNOWN";
    const selectedProposal = requireProposal(closed.value.selectedProposal);
    if (computeProposalReceiptDigest(selectedProposal) === expectedDr) return "SELECTED";
    if (selectedProposal.pathInstanceDigest !== proposal.pathInstanceDigest) return "UNKNOWN";
    if (closed.value.conflictReceipt === null) return "PENDING";
    return computeConflictDigest(closed.value.conflictReceipt) ? "LOST_CONFLICT" : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export function validateSelectedPointerEvidence(input: unknown): readonly string[] {
  const closed = snapshotClosedRecord(input, ["value", "proposal", "tip"]);
  if (!closed.ok) return closed.issues;
  try {
    const valueDigest = computePointerValueDigest(closed.value.value);
    const proposal = requireProposal(closed.value.proposal);
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
  if (pointerRegistry.length !== 12 || new Set(pointerRegistry.map((row) => row.kind)).size !== 12)
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
