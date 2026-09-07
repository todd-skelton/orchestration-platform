import {
  canonicalBytes,
  computeBootstrapVerifierAnchorDigest,
  parseBootstrapVerifierAnchor,
  snapshotClosedRecord,
  verifierAnchorSchemaFields,
  type BootstrapVerifierAnchor,
  type ContractRecord,
  type VerifierAnchorAsset,
} from "../../../../packages/contracts/src/index.js";

/**
 * Pure assembly of `bootstrap-verifier-anchor/v1` from operator-supplied facts.
 *
 * The builder supplies only the values the ledger fixes as literals
 * (`docs/architecture/contract-decisions.md:7011-7017,7044-7047`) and the
 * ascending `LINUX|MACOS|WINDOWS` row order (`:7020-7034`). Every other member
 * is copied from the operator's facts unchanged: it computes no instant, no
 * identity, and no digest claim of its own. Real acquisition of the official
 * GitHub CLI 2.93.0 assets and the independent checksum comparison behind
 * `operatorConfirmation` are operator actions (`ISS-036` O7); this module
 * "cannot prove who supplied it or that the comparison occurred"
 * (`contract-decisions.md:7044-7045`).
 */
export const verifierAnchorOsOrder = Object.freeze(["LINUX", "MACOS", "WINDOWS"] as const);

/** The closed literals the ledger fixes; none of them is an accepted fact. */
export const verifierAnchorFixedLiterals = Object.freeze({
  cliVersion: "2.93.0",
  expectedOidcIssuer: "https://token.actions.githubusercontent.com",
  operatorConfirmationClaim: "OFFICIAL_RELEASE_ASSETS_AND_CHECKSUMS_MATCH",
  releaseTag: "v2.93.0",
  schemaVersion: "bootstrap-verifier-anchor/v1",
  trustBootstrap: "GITHUB_CLI_DEFAULT_ONLINE_SIGSTORE_TUF",
} as const);

/**
 * The accepted fact census. Asset and signer rows reuse the ledger's own field
 * lists; the confirmation drops `claim` because the literal is not the
 * operator's to choose. Anything else — a `latest` selector, a download URL, an
 * executable path, an install directory, a custom trust root, a token — is an
 * unknown field and refuses here, before any member is assembled.
 */
export const verifierAnchorFactFields = Object.freeze({
  asset: verifierAnchorSchemaFields.asset,
  confirmation: Object.freeze(["actorId", "confirmedAt"] as const),
  facts: Object.freeze([
    "assets",
    "createdAt",
    "operatorConfirmation",
    "repositoryId",
    "signerWorkflow",
  ] as const),
  signer: verifierAnchorSchemaFields.signer,
});

export type VerifierAnchorAssetFacts = VerifierAnchorAsset;
export type BootstrapVerifierAnchorFacts = Readonly<{
  assets: readonly VerifierAnchorAssetFacts[];
  createdAt: string;
  operatorConfirmation: Readonly<{ actorId: string; confirmedAt: string }>;
  repositoryId: string;
  signerWorkflow: Readonly<{ digest: string; path: string; ref: string; repositoryId: string }>;
}>;

export type BuiltBootstrapVerifierAnchor = Readonly<{
  anchor: BootstrapVerifierAnchor;
  bytes: Uint8Array;
  digest: string;
}>;
export type BuildBootstrapVerifierAnchorResult =
  | { readonly ok: true; readonly value: BuiltBootstrapVerifierAnchor }
  | { readonly ok: false; readonly issues: readonly string[] };

function refused(...issues: readonly string[]): {
  readonly ok: false;
  readonly issues: readonly string[];
} {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function projected(row: ContractRecord, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

/**
 * Total over `unknown`. Facts-boundary refusals carry a `facts.` prefix; the
 * remaining issue codes are `parseBootstrapVerifierAnchor`'s own, verbatim.
 */
export function buildBootstrapVerifierAnchor(facts: unknown): BuildBootstrapVerifierAnchorResult {
  const snapshot = snapshotClosedRecord(facts, verifierAnchorFactFields.facts);
  if (!snapshot.ok) return refused(...snapshot.issues.map((issue) => `facts.${issue}`));
  const supplied = snapshot.value;
  const issues: string[] = [];
  const rows = new Map<string, ContractRecord>();
  const assets = supplied.assets;
  if (!Array.isArray(assets) || assets.length !== verifierAnchorOsOrder.length) {
    issues.push("facts.assets:os-census-required");
  } else {
    for (const [index, asset] of assets.entries()) {
      const parsed = snapshotClosedRecord(asset, verifierAnchorFactFields.asset);
      if (!parsed.ok) {
        issues.push(...parsed.issues.map((issue) => `facts.assets.${index}.${issue}`));
        continue;
      }
      const osKind = parsed.value.osKind;
      if (
        typeof osKind !== "string" ||
        !(verifierAnchorOsOrder as readonly string[]).includes(osKind)
      ) {
        issues.push(`facts.assets.${index}.osKind:invalid`);
        continue;
      }
      if (rows.has(osKind)) issues.push(`facts.assets.${osKind}:duplicated`);
      else rows.set(osKind, parsed.value);
    }
    for (const osKind of verifierAnchorOsOrder)
      if (!rows.has(osKind)) issues.push(`facts.assets.${osKind}:missing`);
  }
  const confirmation = snapshotClosedRecord(
    supplied.operatorConfirmation,
    verifierAnchorFactFields.confirmation,
  );
  if (!confirmation.ok)
    issues.push(...confirmation.issues.map((issue) => `facts.operatorConfirmation.${issue}`));
  const signer = snapshotClosedRecord(supplied.signerWorkflow, verifierAnchorFactFields.signer);
  if (!signer.ok) issues.push(...signer.issues.map((issue) => `facts.signerWorkflow.${issue}`));
  if (issues.length || !confirmation.ok || !signer.ok) return refused(...issues);

  const assembled = {
    assets: verifierAnchorOsOrder.map((osKind) =>
      projected(rows.get(osKind)!, verifierAnchorFactFields.asset),
    ),
    cliVersion: verifierAnchorFixedLiterals.cliVersion,
    createdAt: supplied.createdAt,
    expectedOidcIssuer: verifierAnchorFixedLiterals.expectedOidcIssuer,
    operatorConfirmation: {
      actorId: confirmation.value.actorId,
      claim: verifierAnchorFixedLiterals.operatorConfirmationClaim,
      confirmedAt: confirmation.value.confirmedAt,
    },
    releaseTag: verifierAnchorFixedLiterals.releaseTag,
    repositoryId: supplied.repositoryId,
    schemaVersion: verifierAnchorFixedLiterals.schemaVersion,
    signerWorkflow: projected(signer.value, verifierAnchorFactFields.signer),
    trustBootstrap: verifierAnchorFixedLiterals.trustBootstrap,
  };
  const parsed = parseBootstrapVerifierAnchor(assembled);
  if (!parsed.ok) return refused(...parsed.issues);
  return {
    ok: true,
    value: Object.freeze({
      anchor: parsed.value,
      bytes: canonicalBytes(parsed.value),
      digest: computeBootstrapVerifierAnchorDigest(parsed.value),
    }),
  };
}
