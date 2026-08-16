import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function digest(domain, ...parts) {
  const hash = createHash("sha256").update(`${domain}\0`);
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

async function git(repository, args, encoding = "utf8") {
  const result = await execFileAsync("git", ["-C", repository, ...args], {
    encoding,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout;
}

function parseTree(bytes, subtree) {
  const prefix = Buffer.from(`${subtree.replace(/\/$/, "")}/`, "utf8");
  const rows = [];
  for (const record of bytes.subarray(0, -1).toString("binary").split("\0")) {
    const raw = Buffer.from(record, "binary");
    const tab = raw.indexOf(0x09);
    if (tab < 0) throw new Error("source tree contains a malformed row");
    const header = raw.subarray(0, tab).toString("ascii").split(" ");
    const path = raw.subarray(tab + 1);
    if (header.length !== 3 || !path.subarray(0, prefix.length).equals(prefix)) {
      throw new Error("source tree row is outside the selected subtree");
    }
    const relativePath = path.subarray(prefix.length);
    if (relativePath.length === 0 || relativePath.includes(0)) {
      throw new Error("source tree contains an empty or malformed path");
    }
    rows.push({
      mode: header[0],
      type: header[1],
      objectId: header[2],
      relativePath,
    });
  }
  return rows;
}

function extension(pathBytes) {
  const leaf = pathBytes.toString("utf8").split("/").at(-1) ?? "";
  const dot = leaf.lastIndexOf(".");
  return dot < 0 ? "none" : leaf.slice(dot + 1).toLowerCase();
}

function uniqueDigests(domain, values) {
  return [...new Set(values.map((value) => digest(domain, value)))].sort();
}

function pathEvidence(artifactId, pathDigest, pathBytes) {
  const normalized = pathBytes
    .toString("utf8")
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("\\", "/");
  const components = normalized.split("/").filter(Boolean);
  const tokens = components.flatMap((component) => component.match(/[a-z0-9]+/g) ?? []);
  const ngrams = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = 2; length <= 4 && start + length <= tokens.length; length += 1) {
      ngrams.push(tokens.slice(start, start + length).join("/"));
    }
  }
  return {
    artifactId,
    pathDigest,
    normalizedPathDigest: digest("reference-source-path-normalized/v1", normalized),
    componentDigests: uniqueDigests("reference-source-path-component/v1", components),
    tokenDigests: uniqueDigests("reference-source-path-token/v1", tokens),
    ngramDigests: uniqueDigests("reference-source-path-ngram/v1", ngrams),
  };
}

const signalPatterns = Object.freeze([
  [
    "fixture-local-write",
    /\b(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item)\b/i,
  ],
  ["process-lifecycle", /\b(?:Start-Process|Stop-Process|Start-Job|Stop-Job|taskkill)\b/i],
  [
    "version-control",
    /(?:^|[\s;&|])git(?:\.exe)?\s+(?:add|commit|push|merge|rebase|switch|checkout|worktree|branch|tag|update-ref)\b/i,
  ],
  ["provider-control-plane", /(?:^|[\s;&|])(?:gh|doctl|docker)(?:\.exe)?\s+/i],
  ["network-control-plane", /\b(?:Invoke-RestMethod|Invoke-WebRequest)\b/i],
  [
    "member-mutation",
    /\.(?:Write|WriteAllText|WriteAllBytes|AppendAllText|Delete|Move|Copy|Create|Kill|Start)\s*\(/i,
  ],
  ["dynamic-invocation", /(?:^|[\s;(])&\s*(?:\(|\$|['"])/],
  ["stream-redirection", /(?:^|\s)(?:>>?|[2-6]>>?)\s*[^=&]/],
]);

function effectCandidates(artifactId, bytes) {
  const text = bytes.toString("utf8").replace(/\r\n/g, "\n");
  const result = [];
  let offset = 0;
  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//")) {
      for (const [kind, pattern] of signalPatterns) {
        if (pattern.test(line)) {
          result.push({
            artifactId,
            kind,
            digest: digest(
              "reference-effect-candidate/v1",
              artifactId,
              String(index + 1),
              String(offset),
              createHash("sha256").update(line).digest("hex"),
            ),
          });
          break;
        }
      }
    }
    offset += Buffer.byteLength(line, "utf8") + 1;
  }
  return result;
}

function aggregateRows(domain, rows) {
  return digest(domain, ...rows.map((row) => JSON.stringify(row)));
}

export async function extractSourceEvidence({ repository, commit, subtree }) {
  if (!repository || !/^[a-f0-9]{40}$/.test(commit ?? "") || !subtree) {
    throw new Error("live comparison requires repository, exact commit, and subtree");
  }
  const exactCommit = (await git(repository, ["rev-parse", `${commit}^{commit}`])).trim();
  if (exactCommit !== commit) throw new Error("source commit did not resolve exactly");
  const treeObject = (await git(repository, ["rev-parse", `${commit}:${subtree}`])).trim();
  if (!/^[a-f0-9]{40}$/.test(treeObject)) throw new Error("source subtree is not a Git tree");
  const treeBytes = await git(repository, ["ls-tree", "-r", "-z", commit, "--", subtree], "buffer");
  const sourceRows = parseTree(treeBytes, subtree);
  const artifacts = [];
  const candidates = [];
  const sourcePaths = [];
  for (const row of sourceRows) {
    if (row.mode !== "100644" || row.type !== "blob") {
      throw new Error("source subtree contains a non-regular blob");
    }
    const bytes = await git(repository, ["cat-file", "blob", row.objectId], "buffer");
    const pathDigest = digest("reference-artifact-path/v1", row.relativePath);
    const artifact = {
      pathDigest,
      objectId: row.objectId,
      contentDigest: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
      mode: row.mode,
      type: row.type,
      extension: extension(row.relativePath),
    };
    artifacts.push(artifact);
  }
  artifacts.sort((left, right) => left.pathDigest.localeCompare(right.pathDigest));
  artifacts.forEach((artifact, index) => {
    artifact.artifactId = `artifact-${String(index + 1).padStart(3, "0")}`;
  });
  for (const row of sourceRows) {
    const pathDigest = digest("reference-artifact-path/v1", row.relativePath);
    const artifact = artifacts.find((candidate) => candidate.pathDigest === pathDigest);
    if (!artifact) throw new Error("source path lacks an artifact identity");
    sourcePaths.push(pathEvidence(artifact.artifactId, pathDigest, row.relativePath));
  }
  sourcePaths.sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  for (const artifact of artifacts) {
    if (!new Set(["ps1", "psm1", "cjs", "sh", "vbs"]).has(artifact.extension)) continue;
    const bytes = await git(repository, ["cat-file", "blob", artifact.objectId], "buffer");
    candidates.push(...effectCandidates(artifact.artifactId, bytes));
  }
  candidates.sort((left, right) => left.digest.localeCompare(right.digest));
  const extensionCensus = Object.fromEntries(
    [...new Set(artifacts.map(({ extension: value }) => value))]
      .sort()
      .map((value) => [value, artifacts.filter((row) => row.extension === value).length]),
  );
  const candidateCensus = Object.fromEntries(
    [...new Set(candidates.map(({ kind }) => kind))]
      .sort()
      .map((kind) => [kind, candidates.filter((row) => row.kind === kind).length]),
  );
  const candidateGroups = Object.fromEntries(
    Object.keys(candidateCensus).map((kind) => {
      const rows = candidates.filter((row) => row.kind === kind);
      return [
        kind,
        {
          count: rows.length,
          root: aggregateRows(
            "reference-effect-group/v1",
            rows.map(({ kind: signalKind, digest: callsiteDigest }) => ({
              kind: signalKind,
              digest: callsiteDigest,
            })),
          ),
        },
      ];
    }),
  );
  const entrypoints = artifacts
    .filter(({ extension: value }) => new Set(["ps1", "cjs", "sh", "vbs"]).has(value))
    .map(({ artifactId, pathDigest, extension: kind }) => ({ artifactId, pathDigest, kind }));
  return {
    schemaVersion: "reference-source-evidence/v1",
    commit,
    treeObject,
    artifactCount: artifacts.length,
    artifactRoot: aggregateRows("reference-artifact-root/v1", artifacts),
    sourcePathRoot: aggregateRows("reference-source-path-census/v1", sourcePaths),
    entrypointCount: entrypoints.length,
    entrypointRoot: aggregateRows("reference-entrypoint-root/v1", entrypoints),
    effectCandidateCount: candidates.length,
    effectCandidateRoot: aggregateRows(
      "reference-effect-root/v1",
      candidates.map(({ kind: signalKind, digest: callsiteDigest }) => ({
        kind: signalKind,
        digest: callsiteDigest,
      })),
    ),
    effectCandidateMappingRoot: aggregateRows("reference-effect-mapping/v1", candidates),
    extensionCensus,
    candidateCensus,
    candidateGroups,
    artifacts,
    sourcePaths,
    entrypoints,
    candidates,
  };
}

export function parseLiveArguments(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 0) return undefined;
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--source-repository", "--source-commit", "--source-subtree"].includes(flag)) {
      throw new Error(
        "live comparison accepts only exact source repository, commit, and subtree flags",
      );
    }
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(result, key)) throw new Error(`duplicate live comparison flag ${flag}`);
    result[key] = value;
  }
  if (Object.keys(result).length !== 3)
    throw new Error("live comparison requires all source flags");
  return {
    repository: result.sourceRepository,
    commit: result.sourceCommit,
    subtree: result.sourceSubtree,
  };
}
