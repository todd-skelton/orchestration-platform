import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PLANNING_REPOSITORY = "todd-skelton/orchestration-platform";
const ISSUE_KEY = /^ISS-\d{3}$/;

function fail(message) {
  throw new Error(`PLANNING_CONTRACT_MISMATCH: ${message}`);
}

function parseArray(value) {
  const body = value.trim().slice(1, -1).trim();
  if (!body) return [];
  return body
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export function parseFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) fail(`${file} has no closed frontmatter`);
  const result = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const separator = line.indexOf(":");
    if (separator < 1) fail(`${file} has malformed frontmatter line`);
    const key = line.slice(0, separator).trim();
    let raw = line.slice(separator + 1).trim();
    if (!raw && lines[index + 1]?.trim().startsWith("[")) {
      const parts = [];
      do {
        index += 1;
        if (index >= lines.length) fail(`${file} has unterminated frontmatter array ${key}`);
        parts.push(lines[index].trim());
      } while (!lines[index].trim().endsWith("]"));
      raw = parts.join(" ");
    }
    if (!raw) fail(`${file} has empty frontmatter field ${key}`);
    if (Object.hasOwn(result, key)) fail(`${file} repeats frontmatter field ${key}`);
    result[key] = raw.startsWith("[") ? parseArray(raw) : raw.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function validateAcyclic(issues) {
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  const visiting = new Set();
  const visited = new Set();
  function visit(key) {
    if (visiting.has(key)) fail(`dependency cycle includes ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key).blockedBy) {
      if (!byKey.has(dependency)) fail(`${key} has unknown dependency ${dependency}`);
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of byKey.keys()) visit(key);
}

export function validatePlanningSnapshot(snapshot) {
  const { roadmap } = snapshot;
  if (roadmap.schemaVersion !== "orchestration-roadmap/v1") fail("unknown roadmap schema");
  if (roadmap.repository !== PLANNING_REPOSITORY) fail("roadmap repository mismatch");
  const project = roadmap.project;
  if (
    !nonEmptyString(project?.id) ||
    !Number.isSafeInteger(project.number) ||
    project.number <= 0 ||
    !nonEmptyString(project.title) ||
    typeof project.url !== "string" ||
    !project.url.startsWith("https://")
  ) {
    fail("roadmap delivery project registration is malformed");
  }
  if (!Array.isArray(roadmap.milestones) || !Array.isArray(roadmap.issues)) {
    fail("roadmap milestones and issues must be arrays");
  }

  const milestoneTitles = new Map();
  const seenTitles = new Set();
  for (const milestone of roadmap.milestones) {
    if (!nonEmptyString(milestone?.key) || !nonEmptyString(milestone?.title)) {
      fail("milestone key and title must be non-empty strings");
    }
    if (milestoneTitles.has(milestone.key)) fail(`duplicate milestone key ${milestone.key}`);
    if (seenTitles.has(milestone.title)) fail(`duplicate milestone title ${milestone.title}`);
    milestoneTitles.set(milestone.key, milestone.title);
    seenTitles.add(milestone.title);
  }

  const issueKeys = new Set();
  for (const issue of roadmap.issues) {
    if (!ISSUE_KEY.test(issue?.key ?? "")) fail(`malformed issue key ${String(issue?.key)}`);
    if (issueKeys.has(issue.key)) fail(`duplicate issue key ${issue.key}`);
    issueKeys.add(issue.key);
  }
  if (!sameArray(Object.keys(snapshot.issueDrafts).sort(), [...issueKeys].sort())) {
    fail("registered issue drafts and filesystem issue drafts differ");
  }

  for (const issue of roadmap.issues) {
    if (issue.file !== `planning/drafts/${issue.key}.md`) {
      fail(`${issue.key} file must be planning/drafts/${issue.key}.md`);
    }
    if (!milestoneTitles.has(issue.milestone)) {
      fail(`${issue.key} has unknown milestone ${issue.milestone}`);
    }
    if (
      !Array.isArray(issue.blockedBy) ||
      issue.blockedBy.some((dependency) => !ISSUE_KEY.test(dependency)) ||
      new Set(issue.blockedBy).size !== issue.blockedBy.length ||
      issue.blockedBy.includes(issue.key)
    ) {
      fail(`${issue.key} blockedBy must list distinct other issue keys`);
    }
    const frontmatter = parseFrontmatter(snapshot.issueDrafts[issue.key], issue.file);
    if (frontmatter.key !== issue.key) fail(`${issue.key} frontmatter key mismatch`);
    if (!nonEmptyString(frontmatter.title)) fail(`${issue.key} frontmatter title missing`);
    if (frontmatter.milestone !== milestoneTitles.get(issue.milestone)) {
      fail(`${issue.key} frontmatter milestone mismatch`);
    }
    if (!sameArray(frontmatter.blocked_by ?? [], issue.blockedBy)) {
      fail(`${issue.key} blocked-by edges mismatch`);
    }
    if (frontmatter.labels !== undefined && !Array.isArray(frontmatter.labels)) {
      fail(`${issue.key} frontmatter labels must be an array`);
    }
  }
  validateAcyclic(roadmap.issues);
}

export async function loadPlanningSnapshot(root = defaultRoot) {
  const roadmap = JSON.parse(await readFile(resolve(root, "planning/roadmap.json"), "utf8"));
  const issueDrafts = {};
  for (const name of (await readdir(resolve(root, "planning/drafts"))).sort()) {
    if (!name.endsWith(".md")) continue;
    const key = name.slice(0, -3);
    if (!ISSUE_KEY.test(key)) fail(`unexpected file planning/drafts/${name}`);
    issueDrafts[key] = await readFile(resolve(root, "planning/drafts", name), "utf8");
  }
  return { roadmap, issueDrafts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) fail("planning checker accepts no arguments");
  validatePlanningSnapshot(await loadPlanningSnapshot());
  process.stdout.write("planning contracts verified\n");
}
