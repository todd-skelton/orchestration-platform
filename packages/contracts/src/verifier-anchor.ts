import {
  frame,
  framedDigest,
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  snapshotClosedRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const verifierAnchorSchemaVersions = Object.freeze([
  "bootstrap-verifier-anchor/v1",
] as const);
export const verifierAnchorSchemaFields = Object.freeze({
  anchor: Object.freeze([
    "assets",
    "cliVersion",
    "createdAt",
    "expectedOidcIssuer",
    "operatorConfirmation",
    "releaseTag",
    "repositoryId",
    "schemaVersion",
    "signerWorkflow",
    "trustBootstrap",
  ] as const),
  asset: Object.freeze([
    "architecture",
    "archiveSha256",
    "assetName",
    "checksumManifestName",
    "checksumManifestSha256",
    "executableName",
    "executableSha256",
    "osKind",
  ] as const),
  confirmation: Object.freeze(["actorId", "claim", "confirmedAt"] as const),
  signer: Object.freeze(["digest", "path", "ref", "repositoryId"] as const),
});

export type VerifierAnchorAsset = Readonly<{
  architecture: "ARM64" | "X64";
  archiveSha256: string;
  assetName: string;
  checksumManifestName: string;
  checksumManifestSha256: string;
  executableName: string;
  executableSha256: string;
  osKind: "LINUX" | "MACOS" | "WINDOWS";
}>;
export type BootstrapVerifierAnchor = Readonly<{
  assets: readonly VerifierAnchorAsset[];
  cliVersion: "2.93.0";
  createdAt: string;
  expectedOidcIssuer: "https://token.actions.githubusercontent.com";
  operatorConfirmation: Readonly<{
    actorId: string;
    claim: "OFFICIAL_RELEASE_ASSETS_AND_CHECKSUMS_MATCH";
    confirmedAt: string;
  }>;
  releaseTag: "v2.93.0";
  repositoryId: string;
  schemaVersion: "bootstrap-verifier-anchor/v1";
  signerWorkflow: Readonly<{ digest: string; path: string; ref: string; repositoryId: string }>;
  trustBootstrap: "GITHUB_CLI_DEFAULT_ONLINE_SIGSTORE_TUF";
}>;

const osOrder = ["LINUX", "MACOS", "WINDOWS"] as const;
const positiveId = (value: JsonValue | undefined): value is string =>
  isCanonicalDecimal(value) && /^[1-9][0-9]*(?![\s\S])/.test(value);
const digest = (value: JsonValue | undefined): value is string =>
  isSha256(value) && value.length === 64;
const boundedText = (value: JsonValue | undefined, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= maximum;
const safeName = (value: JsonValue | undefined): value is string =>
  boundedText(value, 256) &&
  !/[\u0000-\u001f\u007f-\u009f/\\]/.test(value) &&
  value !== "." &&
  value !== "..";
const relativePath = (value: JsonValue | undefined): value is string =>
  isContractRelativePath(value) && Buffer.byteLength(value, "utf8") <= 512;
function branchRef(value: JsonValue | undefined): value is string {
  if (!boundedText(value, 512) || !value.startsWith("refs/heads/")) return false;
  const name = value.slice("refs/heads/".length);
  if (
    !name ||
    /[\u0000-\u0020\u007f-\u009f~^:?*\[\\]/.test(name) ||
    name.includes("..") ||
    name.includes("@{") ||
    name.endsWith(".")
  )
    return false;
  return name
    .split("/")
    .every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"));
}

/** Structural supplied-value validation only; it proves neither official assets nor operator action. */
export function parseBootstrapVerifierAnchor(input: unknown): ParseResult<BootstrapVerifierAnchor> {
  const snapshot = snapshotClosedRecord(input, verifierAnchorSchemaFields.anchor);
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value;
  const issues: string[] = [];
  const literals = {
    cliVersion: "2.93.0",
    expectedOidcIssuer: "https://token.actions.githubusercontent.com",
    releaseTag: "v2.93.0",
    schemaVersion: "bootstrap-verifier-anchor/v1",
    trustBootstrap: "GITHUB_CLI_DEFAULT_ONLINE_SIGSTORE_TUF",
  } as const;
  for (const [field, expected] of Object.entries(literals))
    if (record[field] !== expected) issues.push(`${field}:mismatch`);
  if (!positiveId(record.repositoryId)) issues.push("repositoryId:invalid");
  if (!isCanonicalTimestamp(record.createdAt)) issues.push("createdAt:invalid");

  if (!Array.isArray(record.assets) || record.assets.length !== osOrder.length) {
    issues.push("assets:os-census-required");
  } else {
    for (const [index, asset] of record.assets.entries()) {
      const prefix = `assets.${index}`;
      const parsed = snapshotClosedRecord(asset, verifierAnchorSchemaFields.asset);
      if (!parsed.ok) {
        issues.push(...parsed.issues.map((issue) => `${prefix}.${issue}`));
        continue;
      }
      const row = parsed.value;
      if (row.osKind !== osOrder[index]) issues.push(`${prefix}.osKind:ordered-census-required`);
      if (row.architecture !== "ARM64" && row.architecture !== "X64")
        issues.push(`${prefix}.architecture:invalid`);
      for (const field of ["archiveSha256", "checksumManifestSha256", "executableSha256"] as const)
        if (!digest(row[field])) issues.push(`${prefix}.${field}:invalid`);
      for (const field of ["assetName", "checksumManifestName", "executableName"] as const)
        if (!safeName(row[field])) issues.push(`${prefix}.${field}:invalid`);
    }
  }

  const signer = snapshotClosedRecord(record.signerWorkflow, verifierAnchorSchemaFields.signer);
  if (!signer.ok) issues.push(...signer.issues.map((issue) => `signerWorkflow.${issue}`));
  else {
    const row = signer.value;
    if (!digest(row.digest)) issues.push("signerWorkflow.digest:invalid");
    if (!relativePath(row.path)) issues.push("signerWorkflow.path:invalid");
    if (!branchRef(row.ref)) issues.push("signerWorkflow.ref:invalid");
    if (!positiveId(row.repositoryId)) issues.push("signerWorkflow.repositoryId:invalid");
    if (row.repositoryId !== record.repositoryId)
      issues.push("signerWorkflow.repositoryId:mismatch");
  }
  const confirmation = snapshotClosedRecord(
    record.operatorConfirmation,
    verifierAnchorSchemaFields.confirmation,
  );
  if (!confirmation.ok)
    issues.push(...confirmation.issues.map((issue) => `operatorConfirmation.${issue}`));
  else {
    const row = confirmation.value;
    if (!positiveId(row.actorId)) issues.push("operatorConfirmation.actorId:invalid");
    if (row.claim !== "OFFICIAL_RELEASE_ASSETS_AND_CHECKSUMS_MATCH")
      issues.push("operatorConfirmation.claim:mismatch");
    if (!isCanonicalTimestamp(row.confirmedAt))
      issues.push("operatorConfirmation.confirmedAt:invalid");
    else if (isCanonicalTimestamp(record.createdAt) && row.confirmedAt > record.createdAt)
      issues.push("operatorConfirmation.confirmedAt:after-creation");
  }
  return issues.length
    ? { ok: false, issues: Object.freeze([...new Set(issues)].sort()) }
    : { ok: true, value: record as BootstrapVerifierAnchor };
}

export function computeBootstrapVerifierAnchorDigest(input: unknown): string {
  const parsed = parseBootstrapVerifierAnchor(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("bootstrap-verifier-anchor/v1", [frame.canonical(parsed.value)]);
}

export function parseVerifierAnchorContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  return schemaVersion === "bootstrap-verifier-anchor/v1"
    ? parseBootstrapVerifierAnchor(input)
    : null;
}
