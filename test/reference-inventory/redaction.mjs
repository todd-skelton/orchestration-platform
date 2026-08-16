import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { resolvePnpmLauncher } from "../../scripts/pnpm-launcher.mjs";
import { loadInventory, validateInventory } from "./inventory.mjs";
import { parseLiveArguments } from "./source-evidence.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);
const publicDigest = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;
const sourceMarkers = [
  "reference-source-census/v1",
  "reference-artifact-inventory/v1",
  "reference-entrypoint-census/v1",
  "reference-mutation-census/v1",
];
const backslash = String.fromCharCode(92);
const uncClass = `[^${backslash}s${backslash.repeat(2)}/]+`;
const uncSeparator = `[${backslash.repeat(2)}/]`;
const uncPathPattern = new RegExp(
  `${backslash.repeat(4)}${uncClass}${uncSeparator}${uncClass}`,
  "m",
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

function textFindings(value, forbiddenDigests) {
  const findings = [];
  for (const candidate of tokenCandidates(value)) {
    if (forbiddenDigests.has(forbiddenDigest(candidate))) findings.push("forbidden-vocabulary");
  }
  if (
    /(?:^|[^a-z])[a-z]:[\\/](?:[^\s"'`]+[\\/])+/im.test(value) ||
    /(?:^|[^a-z])\/(?:users|home)\/[^\s/]+\//im.test(value) ||
    uncPathPattern.test(value)
  ) {
    findings.push("absolute-local-path");
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
    /\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|AKIA[A-Z0-9]{16})\b/.test(value) ||
    /\b(?:password|secret|access[_-]?token)\s*[:=]\s*["'][^"']{12,}["']/i.test(value)
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
  return [...new Set(findings)];
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

function validatePackedFile(path, bytes, forbiddenDigests) {
  if (/^(?:reference|test)\//.test(path)) fail("package archive contains reference/test evidence");
  const findings = textFindings(`${path}\n${bytes.toString("utf8")}`, forbiddenDigests);
  if (findings.length > 0) fail(`package archive contains ${findings.join(",")}`);
  if (sourceMarkers.some((marker) => bytes.includes(marker))) {
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

async function scanPackedSurfaces(root, forbiddenDigests) {
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
        validatePackedFile(path, bytes, forbiddenDigests);
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return fileCount;
}

async function scanBuiltSurfaces(root, forbiddenDigests, artifactDigests) {
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
    const findings = textFindings(text, forbiddenDigests);
    if (findings.length > 0) fail(`built surface contains ${findings.join(",")}`);
    if (
      sourceMarkers.some((marker) => text.includes(marker)) ||
      artifactDigests.some((value) => text.includes(value))
    ) {
      fail("built surface contains reference inventory material");
    }
  }
  return paths.length;
}

function normalizedChunks(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  const result = new Set();
  for (let offset = 0; offset + 160 <= normalized.length; offset += 80) {
    result.add(
      createHash("sha256")
        .update(normalized.slice(offset, offset + 160))
        .digest("hex"),
    );
  }
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const compact = line.replace(/\s+/g, " ").trim();
    if (compact.length >= 96) result.add(createHash("sha256").update(compact).digest("hex"));
  }
  const words = normalized.split(" ");
  for (let offset = 0; offset + 24 <= words.length; offset += 1) {
    result.add(
      createHash("sha256")
        .update(words.slice(offset, offset + 24).join(" "))
        .digest("hex"),
    );
  }
  return result;
}

function copiedSourceBytes(sourceTexts, targetTexts) {
  const sourceChunks = new Set(sourceTexts.flatMap((text) => [...normalizedChunks(text)]));
  return targetTexts.some((text) =>
    [...normalizedChunks(text)].some((digest) => sourceChunks.has(digest)),
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

async function compareSourceChunks(live, targetTexts) {
  const exact = (await git(live.repository, ["rev-parse", `${live.commit}^{commit}`])).trim();
  if (exact !== live.commit) fail("redaction source commit did not resolve exactly");
  const raw = await git(
    live.repository,
    ["ls-tree", "-r", "-z", live.commit, "--", live.subtree],
    "buffer",
  );
  const sourceChunks = new Set();
  for (const record of raw.subarray(0, -1).toString("utf8").split("\0")) {
    const header = record.slice(0, record.indexOf("\t")).split(" ");
    if (header[1] !== "blob") continue;
    const bytes = await git(live.repository, ["cat-file", "blob", header[2]], "buffer");
    for (const digest of normalizedChunks(bytes.toString("utf8"))) sourceChunks.add(digest);
  }
  for (const text of targetTexts) {
    for (const digest of normalizedChunks(text)) {
      if (sourceChunks.has(digest)) fail("ISS-001 surface contains copied source bytes");
    }
  }
  return sourceChunks.size;
}

export async function runRedaction(root = defaultRoot, live) {
  const snapshot = await loadInventory(root);
  validateInventory(snapshot);
  const forbiddenDigests = new Set(
    snapshot["redaction-oracle"].entries.map(({ digest }) => digest),
  );
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
    const findings = textFindings(`${relative(root, path)}\n${text}`, forbiddenDigests);
    if (findings.length > 0) fail(`ISS-001 surface contains ${findings.join(",")}`);
  }
  const artifactDigests = snapshot.artifacts.artifacts.flatMap(({ pathDigest, contentDigest }) => [
    pathDigest,
    contentDigest,
  ]);
  const packageFileCount = await scanPackedSurfaces(root, forbiddenDigests);
  const builtSurfaceCount = await scanBuiltSurfaces(root, forbiddenDigests, artifactDigests);
  const sourceChunkCount = live ? await compareSourceChunks(live, targetTexts) : undefined;
  return {
    scannedSurfaceFiles: surfaceFiles.length,
    packageFileCount,
    builtSurfaceCount,
    liveSourceChunkCount: sourceChunkCount,
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
  copiedSourceBytes,
  forbiddenDigest,
  textFindings,
  tokenCandidates,
  validatePackedFile,
});
