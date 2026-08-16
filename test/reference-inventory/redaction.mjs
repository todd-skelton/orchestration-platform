import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { resolvePnpmLauncher } from "../../scripts/pnpm-launcher.mjs";
import {
  buildPublicationFingerprints,
  loadInventory,
  publicationValueFingerprints,
  validateInventory,
} from "./inventory.mjs";
import { parseLiveArguments } from "./source-evidence.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);
const publicDigest = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;
const sourceMarkers = [
  "reference-source-census/",
  "reference-artifact-inventory/",
  "reference-behavior-families/",
  "reference-entrypoint-census/",
  "reference-mutation-census/",
  "reference-authority-inventory/",
  "reference-recovery-transitions/",
  "reference-assumption-inventory/",
  "reference-forbidden-vocabulary/",
];
const sourceContentMarkers = [
  /"artifactId"\s*:\s*"artifact-\d{3}"/,
  /"familyRoot"\s*:/,
  /"behaviorFamilyIds"\s*:/,
  /"mutationGroupId"\s*:/,
  /"authorityRoot"\s*:/,
  /"requiredObservation"\s*:/,
  /"transitionRoot"\s*:/,
  /"recoveryTransitionId"\s*:/,
  /"assumptionRoot"\s*:/,
  /"vocabularyRoot"\s*:/,
  /"sourcePathCensus"\s*:/,
];
const copyWindow = 160;
const backslash = String.fromCharCode(92);
const uncClass = `[a-z0-9][a-z0-9._-]*`;
const uncSeparator = `[${backslash.repeat(2)}/]`;
const uncPathPattern = new RegExp(
  `(?:^|[${backslash}s"'(=])${backslash.repeat(4)}${uncClass}${uncSeparator}${uncClass}`,
  "im",
);

function fail(message) {
  throw new Error(`REFERENCE_REDACTION_MISMATCH: ${message}`);
}

function forbiddenDigest(value) {
  return createHash("sha256")
    .update("forbidden-vocabulary/v1\0")
    .update(value.normalize("NFKC").toLowerCase())
    .update("\0")
    .digest("hex");
}

function tokenCandidates(value) {
  const normalized = value.normalize("NFKC").toLowerCase();
  const result = new Set();
  for (const match of normalized.matchAll(/[a-z0-9]+(?:[._:@/-][a-z0-9]+)*/g)) {
    result.add(match[0]);
  }
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 1; length <= 4 && start + length <= words.length; length += 1) {
      const span = words.slice(start, start + length);
      for (const separator of [" ", "-", ""]) result.add(span.join(separator));
    }
  }
  return result;
}

function pathDigest(domain, value) {
  return createHash("sha256").update(`${domain}\0`).update(value).update("\0").digest("hex");
}

function sourcePathFindings(value, oracle) {
  if (!oracle) return [];
  const findings = new Set();
  const normalizedText = value.normalize("NFKC").toLowerCase();
  const textComponents = new Set(normalizedText.match(/[a-z0-9_.-]*[a-z0-9][a-z0-9_.-]*/g) ?? []);
  for (const component of [...textComponents]) {
    const punctuationTrimmed = component.replace(/^[._-]+|[._-]+$/g, "");
    if (punctuationTrimmed) textComponents.add(punctuationTrimmed);
  }
  for (const component of textComponents) {
    if (oracle.sensitiveComponents.has(pathDigest("reference-source-path-component/v1", component)))
      findings.add("source-path-component");
  }
  for (const token of normalizedText.match(/[a-z0-9]+/g) ?? []) {
    if (oracle.sensitiveTokens.has(pathDigest("reference-source-path-token/v1", token)))
      findings.add("source-path-token");
  }
  const candidates = [
    ...(normalizedText.match(/[a-z0-9_.-]+(?:[\\/][a-z0-9_.-]+)+/g) ?? []),
    ...(normalizedText.match(/\b[a-z0-9][a-z0-9._-]*\.[a-z0-9]{1,8}\b/g) ?? []),
  ];
  for (const candidate of candidates) {
    const components = candidate.replaceAll("\\", "/").split("/").filter(Boolean);
    const tokens = components.flatMap((component) => component.match(/[a-z0-9]+/g) ?? []);
    for (let start = 0; start < components.length; start += 1) {
      for (let length = 1; start + length <= components.length; length += 1) {
        const span = components.slice(start, start + length).join("/");
        if (
          oracle.rawPaths.has(pathDigest("reference-artifact-path/v1", span)) ||
          oracle.normalizedPaths.has(pathDigest("reference-source-path-normalized/v1", span))
        ) {
          findings.add("source-relative-path");
        }
      }
    }
    for (const component of components) {
      if (
        oracle.sensitiveComponents.has(pathDigest("reference-source-path-component/v1", component))
      )
        findings.add("source-path-component");
    }
    for (const token of tokens) {
      if (oracle.sensitiveTokens.has(pathDigest("reference-source-path-token/v1", token)))
        findings.add("source-path-token");
    }
    for (let start = 0; start < tokens.length; start += 1) {
      for (let length = 2; length <= 4 && start + length <= tokens.length; length += 1) {
        const ngram = tokens.slice(start, start + length).join("/");
        if (oracle.ngrams.has(pathDigest("reference-source-path-ngram/v1", ngram))) {
          findings.add("source-path-ngram");
        }
      }
    }
  }
  return [...findings];
}

function textFindings(value, forbiddenDigests, pathOracle) {
  const findings = [];
  for (const candidate of tokenCandidates(value)) {
    if (forbiddenDigests.has(forbiddenDigest(candidate))) findings.push("forbidden-vocabulary");
  }
  if (
    /(?:^|[^a-z])[a-z]:[\\/][^\s"'`]+/im.test(value) ||
    /(?:^|[^a-z])\/(?:users|home)\/[^\s/]+\//im.test(value) ||
    /(?:^|[\s"'(=])\/(?:etc|mnt|opt|private|root|srv|tmp|usr|var)(?:\/[a-z0-9._-]+)+/im.test(
      value,
    ) ||
    uncPathPattern.test(value) ||
    /(?:^|[\s"'(=])(?:~|\$(?:home|userprofile)|\$\{(?:home|userprofile)\}|\$env:(?:home|userprofile)|%(?:home|userprofile)%)(?:[\\/][^\s"'`]+)+/im.test(
      value,
    )
  ) {
    findings.push("absolute-local-path");
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
    /\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|AKIA[A-Z0-9]{16})\b/.test(value) ||
    /\b(?:password|secret|credential|access(?:[\s._-]*token)|api(?:[\s._-]*key)|client(?:[\s._-]*secret)|bearer)(?:\s*[:=._-]\s*|\s+)["']?[a-z0-9][a-z0-9._~+/=-]{11,}["']?(?=$|[^a-z0-9._~+/=-])/i.test(
      value,
    )
  ) {
    findings.push("credential-or-secret");
  }
  const highEntropy = value.match(/[A-Za-z0-9+/=_-]{48,}/g) ?? [];
  if (
    highEntropy.some(
      (candidate) =>
        !publicDigest.test(candidate.toLowerCase()) &&
        /[A-Z]/.test(candidate) &&
        /[a-z]/.test(candidate) &&
        /\d/.test(candidate),
    )
  ) {
    findings.push("high-entropy-canary");
  }
  findings.push(...sourcePathFindings(value, pathOracle));
  return [...new Set(findings)];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalTokensFromText(value) {
  return value.match(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null/gi) ?? [];
}

function digestParts(domain, parts) {
  const hash = createHash("sha256").update(`${domain}\0`);
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

function collectJsonObjects(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (!Array.isArray(value)) result.push(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectJsonObjects(child, result);
  }
  return result;
}

function publicationFingerprintFinding(text, oracle) {
  if (!oracle) return false;
  try {
    const parsed = JSON.parse(text);
    for (const row of collectJsonObjects(parsed)) {
      const canonical = JSON.stringify(stableValue(row));
      if (oracle.rowDigests.has(pathDigest("reference-publication-row/v1", canonical))) return true;
      const fingerprints = publicationValueFingerprints(row);
      if (
        oracle.valueRowDigests.has(fingerprints.valueRowDigest) ||
        fingerprints.relationshipDigests.some((digestValue) =>
          oracle.relationshipDigests.has(digestValue),
        ) ||
        fingerprints.strongScalarDigests.some((digestValue) =>
          oracle.strongScalarDigests.has(digestValue),
        )
      )
        return true;
    }
  } catch {
    // Canonical chunks below intentionally cover valid fragments and non-JSON bundles.
  }
  const tokens = canonicalTokensFromText(text);
  for (let offset = 0; offset + 6 <= tokens.length; offset += 1) {
    if (
      oracle.chunkDigests.has(
        digestParts("reference-publication-chunk/v1", tokens.slice(offset, offset + 6)),
      )
    )
      return true;
  }
  return false;
}

function containsInventoryMaterial(value, publicationOracle) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  return (
    sourceMarkers.some((marker) => text.includes(marker)) ||
    sourceContentMarkers.some((pattern) => pattern.test(text)) ||
    publicationFingerprintFinding(text, publicationOracle)
  );
}

function buildPublicationOracle(snapshot) {
  const { rowDigests, chunkDigests, valueRowDigests, relationshipDigests, strongScalarDigests } =
    buildPublicationFingerprints(snapshot);
  return {
    rowDigests,
    chunkDigests,
    valueRowDigests,
    relationshipDigests,
    strongScalarDigests,
  };
}

async function collectFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) fail("ISS-001 surface contains a symbolic link");
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    if (entry.isFile()) files.push(child);
  }
  return files;
}

async function runPnpm(args, cwd) {
  const launcher = await resolvePnpmLauncher();
  return execFileAsync(launcher.executable, [...launcher.prefixArgs, ...args], {
    cwd,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function parsePackResult(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) fail("package pack did not emit JSON");
  return JSON.parse(stdout.slice(start));
}

async function readTarball(path) {
  const archive = gunzipSync(await readFile(path));
  const files = [];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const type = text(156, 1);
    if (!Number.isSafeInteger(size) || size < 0) fail("package archive size is malformed");
    offset += 512;
    if (type === "" || type === "0")
      files.push([name.replace(/^package\//, ""), archive.subarray(offset, offset + size)]);
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function validatePackedFile(path, bytes, forbiddenDigests, pathOracle, publicationOracle) {
  if (/^(?:reference|test)\//.test(path)) fail("package archive contains reference/test evidence");
  const findings = textFindings(`${path}\n${bytes.toString("utf8")}`, forbiddenDigests, pathOracle);
  if (findings.length > 0) fail(`package archive ${path} contains ${findings.join(",")}`);
  if (containsInventoryMaterial(bytes, publicationOracle)) {
    fail("package archive contains reference inventory material");
  }
}

async function packageManifests(root) {
  const result = [];
  for (const base of ["packages", "adapters"]) {
    for (const entry of await readdir(resolve(root, base), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(
        await readFile(resolve(root, base, entry.name, "package.json"), "utf8"),
      );
      result.push(manifest.name);
    }
  }
  return result.sort();
}

async function scanPackedSurfaces(root, forbiddenDigests, pathOracle, publicationOracle) {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "orchestration-reference-pack-"));
  let fileCount = 0;
  try {
    for (const name of await packageManifests(root)) {
      const destination = resolve(temporaryRoot, createHash("sha256").update(name).digest("hex"));
      const packed = parsePackResult(
        (
          await runPnpm(
            ["--filter", name, "pack", "--pack-destination", destination, "--json"],
            root,
          )
        ).stdout,
      );
      for (const [path, bytes] of await readTarball(packed.filename)) {
        fileCount += 1;
        validatePackedFile(path, bytes, forbiddenDigests, pathOracle, publicationOracle);
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return fileCount;
}

async function scanBuiltSurfaces(
  root,
  forbiddenDigests,
  pathOracle,
  artifactDigests,
  publicationOracle,
) {
  await runPnpm(["run", "build"], root);
  const configuration = JSON.parse(
    await readFile(resolve(root, "config/private-compositions.json"), "utf8"),
  );
  const paths = [
    ...configuration.targets.map(({ output }) => output),
    "modules/.generated/registry.ts",
  ];
  for (const path of paths) {
    const bytes = await readFile(resolve(root, path));
    const text = bytes.toString("utf8");
    validateBuiltText(text, forbiddenDigests, pathOracle, artifactDigests, publicationOracle);
  }
  return paths.length;
}

function validateBuiltText(
  text,
  forbiddenDigests,
  pathOracle,
  artifactDigests = [],
  publicationOracle,
) {
  const findings = textFindings(text, forbiddenDigests, pathOracle);
  if (findings.length > 0) fail(`built surface contains ${findings.join(",")}`);
  if (
    containsInventoryMaterial(text, publicationOracle) ||
    artifactDigests.some((value) => text.includes(value))
  ) {
    fail("built surface contains reference inventory material");
  }
}

function normalizedCopyText(text) {
  return Buffer.from(
    text.normalize("NFKC").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim(),
    "utf8",
  );
}

function overlappingChunks(text) {
  const normalized = normalizedCopyText(text);
  const result = new Set();
  for (let offset = 0; offset + copyWindow <= normalized.length; offset += 1) {
    result.add(
      createHash("sha256")
        .update(normalized.subarray(offset, offset + copyWindow))
        .digest("hex"),
    );
  }
  return result;
}

function copiedSourceBytes(sourceTexts, targetTexts) {
  const targetChunks = new Set(targetTexts.flatMap((text) => [...overlappingChunks(text)]));
  return sourceTexts.some((text) =>
    [...overlappingChunks(text)].some((digest) => targetChunks.has(digest)),
  );
}

async function git(repository, args, encoding = "utf8") {
  return (
    await execFileAsync("git", ["-C", repository, ...args], {
      encoding,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;
}

function verifyLivePathProbes(sourcePaths, oracle) {
  const fullPaths = new Map();
  const components = new Map();
  const tokens = new Map();
  const ngrams = new Map();
  for (const sourcePath of sourcePaths) {
    const normalized = sourcePath.normalize("NFKC").toLowerCase().replaceAll("\\", "/");
    const pathComponents = normalized.split("/").filter(Boolean);
    const pathTokens = pathComponents.flatMap((component) => component.match(/[a-z0-9]+/g) ?? []);
    fullPaths.set(pathDigest("reference-artifact-path/v1", normalized), normalized);
    for (const component of pathComponents)
      components.set(pathDigest("reference-source-path-component/v1", component), component);
    for (const token of pathTokens)
      tokens.set(pathDigest("reference-source-path-token/v1", token), token);
    for (let start = 0; start < pathTokens.length; start += 1) {
      for (let length = 2; length <= 4 && start + length <= pathTokens.length; length += 1) {
        const ngram = pathTokens.slice(start, start + length).join("/");
        ngrams.set(pathDigest("reference-source-path-ngram/v1", ngram), ngram);
      }
    }
  }
  for (const value of fullPaths.values()) {
    if (!sourcePathFindings(value.toUpperCase(), oracle).includes("source-relative-path"))
      fail("live full source-path probe evaded the hashed oracle");
  }
  for (const digestValue of oracle.sensitiveComponents) {
    const value = components.get(digestValue);
    if (!value) fail("live sensitive component probe is absent from source evidence");
    for (const probe of [value, value.toUpperCase(), `ordinary ${value} text`]) {
      if (!textFindings(probe, new Set(), oracle).includes("source-path-component"))
        fail("live sensitive component probe evaded the hashed oracle");
    }
  }
  for (const digestValue of oracle.sensitiveTokens) {
    const value = tokens.get(digestValue);
    if (!value) fail("live sensitive token probe is absent from source evidence");
    for (const probe of [value, value.toUpperCase(), `ordinary ${value} text`]) {
      if (!textFindings(probe, new Set(), oracle).includes("source-path-token"))
        fail("live sensitive token probe evaded the hashed oracle");
    }
  }
  for (const value of ngrams.values()) {
    if (
      !sourcePathFindings(`boundary/${value.toUpperCase()}/boundary`, oracle).includes(
        "source-path-ngram",
      )
    )
      fail("live source-path ngram probe evaded the hashed oracle");
  }
  return {
    liveFullPathProbeCount: fullPaths.size,
    liveSensitiveComponentProbeCount: oracle.sensitiveComponents.size,
    liveComponentCollisionCount: oracle.componentCollisions.size,
    liveSensitiveTokenProbeCount: oracle.sensitiveTokens.size,
    liveTokenCollisionCount: oracle.tokenCollisions.size,
    liveNgramProbeCount: ngrams.size,
  };
}

async function compareSourceChunks(live, targetTexts, pathOracle) {
  const exact = (await git(live.repository, ["rev-parse", `${live.commit}^{commit}`])).trim();
  if (exact !== live.commit) fail("redaction source commit did not resolve exactly");
  const raw = await git(
    live.repository,
    ["ls-tree", "-r", "-z", live.commit, "--", live.subtree],
    "buffer",
  );
  const targetChunks = new Set(targetTexts.flatMap((text) => [...overlappingChunks(text)]));
  let sourceChunkCount = 0;
  const sourcePaths = [];
  const prefix = `${live.subtree.replace(/\/$/, "")}/`;
  for (const record of raw.subarray(0, -1).toString("utf8").split("\0")) {
    const tab = record.indexOf("\t");
    const header = record.slice(0, tab).split(" ");
    if (header[1] !== "blob") continue;
    const sourcePath = record.slice(tab + 1);
    if (!sourcePath.startsWith(prefix)) fail("live redaction tree escaped its selected subtree");
    sourcePaths.push(sourcePath.slice(prefix.length));
    const bytes = await git(live.repository, ["cat-file", "blob", header[2]], "buffer");
    for (const digest of overlappingChunks(bytes.toString("utf8"))) {
      sourceChunkCount += 1;
      if (targetChunks.has(digest)) fail("ISS-001 surface contains copied source bytes");
    }
  }
  return {
    liveSourceChunkCount: sourceChunkCount,
    ...verifyLivePathProbes(sourcePaths, pathOracle),
  };
}

function buildPathOracle(snapshot) {
  const entries = snapshot["redaction-oracle"].sourcePathCensus.entries;
  const sensitivity = snapshot["redaction-oracle"].sourcePathCensus.sensitivity;
  const arbitraryTextComponentCollisions = new Set(
    sensitivity.arbitraryTextComponentCollisionDigests,
  );
  const arbitraryTextTokenCollisions = new Set(sensitivity.arbitraryTextTokenCollisionDigests);
  return {
    rawPaths: new Set(entries.map(({ pathDigest: value }) => value)),
    normalizedPaths: new Set(entries.map(({ normalizedPathDigest }) => normalizedPathDigest)),
    sensitiveComponents: new Set(
      sensitivity.sensitiveComponentDigests.filter(
        (value) => !arbitraryTextComponentCollisions.has(value),
      ),
    ),
    componentCollisions: new Set([
      ...sensitivity.componentCollisionDigests,
      ...arbitraryTextComponentCollisions,
    ]),
    sensitiveTokens: new Set(
      sensitivity.sensitiveTokenDigests.filter((value) => !arbitraryTextTokenCollisions.has(value)),
    ),
    tokenCollisions: new Set([
      ...sensitivity.tokenCollisionDigests,
      ...arbitraryTextTokenCollisions,
    ]),
    ngrams: new Set(entries.flatMap(({ ngramDigests }) => ngramDigests)),
  };
}

export async function runRedaction(root = defaultRoot, live) {
  const snapshot = await loadInventory(root);
  validateInventory(snapshot);
  const forbiddenDigests = new Set(
    snapshot["redaction-oracle"].entries.map(({ digest }) => digest),
  );
  const pathOracle = buildPathOracle(snapshot);
  const publicationOracle = buildPublicationOracle(snapshot);
  const surfaceRoots = [
    resolve(root, "reference/manifest"),
    resolve(root, "test/reference-inventory"),
    resolve(root, "test/capability-slots/ISS-001"),
  ];
  const surfaceFiles = [];
  for (const path of surfaceRoots) surfaceFiles.push(...(await collectFiles(path)));
  const targetTexts = [];
  for (const path of surfaceFiles) {
    const text = await readFile(path, "utf8");
    targetTexts.push(text);
    const findings = textFindings(`${relative(root, path)}\n${text}`, forbiddenDigests, pathOracle);
    if (findings.length > 0) {
      fail(`ISS-001 surface ${relative(root, path)} contains ${findings.join(",")}`);
    }
  }
  const artifactDigests = snapshot.artifacts.artifacts.flatMap(({ pathDigest, contentDigest }) => [
    pathDigest,
    contentDigest,
  ]);
  const packageFileCount = await scanPackedSurfaces(
    root,
    forbiddenDigests,
    pathOracle,
    publicationOracle,
  );
  const builtSurfaceCount = await scanBuiltSurfaces(
    root,
    forbiddenDigests,
    pathOracle,
    artifactDigests,
    publicationOracle,
  );
  const liveEvidence = live ? await compareSourceChunks(live, targetTexts, pathOracle) : {};
  return {
    scannedSurfaceFiles: surfaceFiles.length,
    packageFileCount,
    builtSurfaceCount,
    ...liveEvidence,
  };
}

export async function runRedactionCli(argv, root = defaultRoot) {
  const live = parseLiveArguments(argv);
  const summary = await runRedaction(root, live);
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: "reference-redaction-check/v1", outcome: "success", ...summary })}\n`,
  );
}

export const redactionTestApi = Object.freeze({
  buildPathOracle,
  buildPublicationOracle,
  containsInventoryMaterial,
  copiedSourceBytes,
  forbiddenDigest,
  pathDigest,
  textFindings,
  tokenCandidates,
  validatePackedFile,
  validateBuiltText,
});
