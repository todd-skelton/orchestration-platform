import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilitySlotName, capabilitySlotRoot } from "../capability-slots.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message) {
  throw new Error(`PLANNING_CONTRACT_MISMATCH: ${message}`);
}

function parseArray(value) {
  const body = value.trim().slice(1, -1).trim();
  if (!body) return [];
  return body.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, ""));
}

export function parseFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) fail(`${file} has no closed frontmatter`);
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) fail(`${file} has malformed frontmatter line`);
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (Object.hasOwn(result, key)) fail(`${file} repeats frontmatter field ${key}`);
    result[key] = raw.startsWith("[") ? parseArray(raw) : raw.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueRows(rows, kind) {
  const keys = new Set();
  const files = new Set();
  for (const row of rows) {
    if (keys.has(row.key)) fail(`duplicate ${kind} key ${row.key}`);
    if (row.file && files.has(row.file)) fail(`duplicate ${kind} file ${row.file}`);
    keys.add(row.key);
    if (row.file) files.add(row.file);
  }
}

function validateAcyclic(issues) {
  const issueKeys = new Set(issues.map(({ key }) => key));
  const visiting = new Set();
  const visited = new Set();
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  function visit(key) {
    if (visiting.has(key)) fail(`dependency cycle includes ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key).blockedBy) {
      if (!issueKeys.has(dependency)) fail(`${key} has unknown dependency ${dependency}`);
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of issueKeys) visit(key);
}

function parseDag(source, epicKey) {
  const block = source.match(
    /- Direct-edge DAG \(generated from `planning\/roadmap\.json`\):([\s\S]*?)(?=\r?\n- )/,
  );
  if (!block) fail(`${epicKey} has no generated direct-edge DAG block`);
  const text = block[1]
    .replace(/`/g, "")
    .replace(/\r?\n\s*/g, " ")
    .trim();
  const clauses = text
    .split(";")
    .map((clause) => clause.trim().replace(/\.$/, ""))
    .filter(Boolean);
  const result = new Map();
  for (const clause of clauses) {
    const parts = clause.split("→").map((part) => part.trim());
    if (parts.length !== 2 || !/^ISS-\d{3}$/.test(parts[1])) {
      fail(`${epicKey} has malformed DAG clause ${clause}`);
    }
    if (result.has(parts[1])) fail(`${epicKey} repeats DAG target ${parts[1]}`);
    const dependencies = parts[0].split(",").map((item) => item.trim());
    if (dependencies.some((key) => !/^ISS-\d{3}$/.test(key))) {
      fail(`${epicKey} has malformed DAG dependency list for ${parts[1]}`);
    }
    result.set(parts[1], dependencies);
  }
  return result;
}

export function verificationCommands(source) {
  const section = source.match(/## Verification plan\r?\n([\s\S]*?)(?=\r?\n## |$)/)?.[1] ?? "";
  const commands = [];
  for (const match of section.matchAll(/`([^`]*pnpm[^`]*)`/g)) commands.push(match[1].trim());
  return commands;
}

function validateCommandCensus(snapshot) {
  const rootScripts = snapshot.rootPackage.scripts ?? {};
  const expectedRootScripts = new Set([
    "build",
    "format",
    "format:check",
    "typecheck",
    "test",
    "verify:bootstrap",
    "planning:check",
    "bootstrap",
    "host-custody:bootstrap",
  ]);
  for (const [key, source] of Object.entries(snapshot.issueDrafts)) {
    for (const command of verificationCommands(source)) {
      const root = command.match(/^pnpm run ([a-z0-9:-]+)/);
      if (root) {
        const scriptName = root[1];
        expectedRootScripts.add(scriptName);
        const observed = rootScripts[scriptName];
        if (!observed) fail(`${key} verification command ${scriptName} does not resolve`);
        if (key !== "ISS-000") {
          const expected = `node scripts/capability-not-implemented.mjs ${key} ${scriptName}`;
          if (observed !== expected) fail(`${scriptName} is not the exact ${key} placeholder`);
        }
        continue;
      }
      const filtered = command.match(/^pnpm --filter (\S+) (\S+)/);
      if (filtered) {
        const manifest = snapshot.packageManifests[filtered[1]];
        if (!manifest?.scripts?.[filtered[2]]) {
          fail(`${key} filtered command ${filtered[1]} ${filtered[2]} does not resolve`);
        }
        const expected = `node ../../scripts/capability-not-implemented.mjs ${key} ${filtered[1]}:${filtered[2]}`;
        if (manifest.scripts[filtered[2]] !== expected) {
          fail(`${filtered[1]} ${filtered[2]} is not the exact ${key} placeholder`);
        }
      }
    }
  }

  if (rootScripts.bootstrap !== "node bootstrap/bin/orchestration-bootstrap.mjs") {
    fail("bootstrap wrapper is not literal argument forwarding");
  }
  if (
    rootScripts["host-custody:bootstrap"] !==
    "node packages/host-custody/bin/orchestration-host-custody-bootstrap.mjs"
  ) {
    fail("host-custody bootstrap wrapper is not literal argument forwarding");
  }
  if (!sameArray(Object.keys(rootScripts).sort(), [...expectedRootScripts].sort())) {
    fail("root script census contains a missing or extra wrapper");
  }
}

function declaredCapabilities(issueDrafts) {
  const declared = new Map();
  for (const [issue, source] of Object.entries(issueDrafts)) {
    for (const command of verificationCommands(source)) {
      const root = command.match(/^pnpm run ([a-z0-9:-]+)/);
      const filtered = command.match(/^pnpm --filter (\S+) (\S+)/);
      const capability = root?.[1] ?? (filtered ? `${filtered[1]}:${filtered[2]}` : undefined);
      if (!capability || issue === "ISS-000") continue;
      if (declared.has(capability)) fail(`duplicate declared capability ${capability}`);
      declared.set(capability, issue);
    }
  }
  return declared;
}

function validateCapabilitySlots(snapshot) {
  const declared = declaredCapabilities(snapshot.issueDrafts);
  const seen = new Set();
  for (const slot of snapshot.capabilitySlots) {
    if (!/^ISS-\d{3}$/.test(slot.issue) || !slot.isDirectory || slot.directorySymlink) {
      fail(`malformed capability slot owner ${slot.issue}`);
    }
    if (!slot.isFile || slot.isSymbolicLink || !slot.name.endsWith(".mjs")) {
      fail(`malformed capability slot ${slot.issue}/${slot.name}`);
    }
    const encoded = slot.name.slice(0, -4);
    let capability;
    try {
      capability = decodeURIComponent(encoded);
    } catch {
      fail(`malformed capability slot encoding ${slot.name}`);
    }
    if (!capability || capabilitySlotName(capability) !== slot.name) {
      fail(`capability slot encoding collision ${slot.name}`);
    }
    if (declared.get(capability) !== slot.issue) {
      fail(`capability slot has wrong owner or is extra ${slot.issue}/${slot.name}`);
    }
    if (seen.has(capability)) fail(`duplicate capability slot ${capability}`);
    seen.add(capability);
  }
}

export function validatePlanningSnapshot(snapshot) {
  const { roadmap } = snapshot;
  if (roadmap.schemaVersion !== "orchestration-roadmap/v1") fail("unknown roadmap schema");
  if (roadmap.repository !== "todd-skelton/orchestration-platform")
    fail("roadmap repository mismatch");
  uniqueRows(roadmap.milestones, "milestone");
  uniqueRows(roadmap.epics, "epic");
  uniqueRows(roadmap.issues, "issue");

  const milestoneTitles = new Map(roadmap.milestones.map((row) => [row.key, row.title]));
  const epicKeys = new Set(roadmap.epics.map((row) => row.key));
  const issueKeys = new Set(roadmap.issues.map((row) => row.key));
  if (!sameArray(Object.keys(snapshot.issueDrafts).sort(), [...issueKeys].sort())) {
    fail("registered issue drafts and filesystem issue drafts differ");
  }
  if (!sameArray(Object.keys(snapshot.epicDrafts).sort(), [...epicKeys].sort())) {
    fail("registered epic drafts and filesystem epic drafts differ");
  }

  for (const issue of roadmap.issues) {
    if (!milestoneTitles.has(issue.milestone))
      fail(`${issue.key} has unknown milestone ${issue.milestone}`);
    if (!epicKeys.has(issue.parent)) fail(`${issue.key} has unknown parent ${issue.parent}`);
    const frontmatter = parseFrontmatter(snapshot.issueDrafts[issue.key], issue.file);
    if (frontmatter.key !== issue.key) fail(`${issue.key} frontmatter key mismatch`);
    if (frontmatter.parent !== issue.parent) fail(`${issue.key} frontmatter parent mismatch`);
    if (frontmatter.milestone !== milestoneTitles.get(issue.milestone)) {
      fail(`${issue.key} frontmatter milestone mismatch`);
    }
    if (!sameArray(frontmatter.blocked_by ?? [], issue.blockedBy)) {
      fail(`${issue.key} direct blocked-by edges mismatch`);
    }
  }
  validateAcyclic(roadmap.issues);

  for (const epic of roadmap.epics) {
    const source = snapshot.epicDrafts[epic.key];
    const frontmatter = parseFrontmatter(source, epic.file);
    if (frontmatter.key !== epic.key) fail(`${epic.key} frontmatter key mismatch`);
    const expectedChildren = roadmap.issues
      .filter((issue) => issue.parent === epic.key)
      .map((issue) => issue.key);
    if (!sameArray([...(frontmatter.children ?? [])].sort(), [...expectedChildren].sort())) {
      fail(`${epic.key} child membership mismatch`);
    }
    const dag = parseDag(source, epic.key);
    for (const child of expectedChildren) {
      const dependencies = roadmap.issues.find((issue) => issue.key === child).blockedBy;
      const observed = dag.get(child);
      if (dependencies.length === 0) {
        if (observed) fail(`${epic.key} has an extra zero-dependency DAG row for ${child}`);
      } else if (!observed || !sameArray(observed, dependencies)) {
        fail(`${epic.key} generated DAG row mismatch for ${child}`);
      }
    }
    for (const target of dag.keys()) {
      if (!expectedChildren.includes(target)) fail(`${epic.key} has extra DAG target ${target}`);
    }
  }

  validateCommandCensus(snapshot);
  validateCapabilitySlots(snapshot);
}

async function loadCapabilitySlots(root) {
  const slotsRoot = await capabilitySlotRoot(root);
  if (!slotsRoot) return [];
  try {
    const owners = await readdir(slotsRoot, { withFileTypes: true });
    const slots = [];
    for (const owner of owners) {
      const ownerPath = resolve(slotsRoot, owner.name);
      const ownerMetadata = await lstat(ownerPath);
      if (!ownerMetadata.isDirectory() || ownerMetadata.isSymbolicLink()) {
        slots.push({
          issue: owner.name,
          name: "",
          isDirectory: false,
          directorySymlink: ownerMetadata.isSymbolicLink(),
          isFile: false,
          isSymbolicLink: false,
        });
        continue;
      }
      for (const entry of await readdir(ownerPath, { withFileTypes: true })) {
        const metadata = await lstat(resolve(ownerPath, entry.name));
        slots.push({
          issue: owner.name,
          name: entry.name,
          isDirectory: true,
          directorySymlink: false,
          isFile: metadata.isFile(),
          isSymbolicLink: metadata.isSymbolicLink(),
        });
      }
    }
    return slots;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadPlanningSnapshot(root = defaultRoot) {
  const roadmap = JSON.parse(await readFile(resolve(root, "planning/roadmap.json"), "utf8"));
  const draftNames = (await readdir(resolve(root, "planning/drafts"))).filter((name) =>
    name.endsWith(".md"),
  );
  const issueDrafts = {};
  const epicDrafts = {};
  for (const name of draftNames) {
    const source = await readFile(resolve(root, "planning/drafts", name), "utf8");
    const key = name.slice(0, -3);
    if (key.startsWith("ISS-")) issueDrafts[key] = source;
    if (key.startsWith("EPIC-")) epicDrafts[key] = source;
  }
  const packageManifests = {};
  for (const issue of roadmap.issues) {
    for (const command of verificationCommands(issueDrafts[issue.key])) {
      const match = command.match(/^pnpm --filter (\S+) /);
      if (!match || packageManifests[match[1]]) continue;
      const packagePath = match[1].replace("@orchestration-platform/", "");
      const adapterDirectory =
        match[1] === "@orchestration-platform/adapter-self"
          ? "self"
          : match[1] === "@orchestration-platform/adapter-first-consumer"
            ? "first-consumer"
            : undefined;
      const base = adapterDirectory
        ? resolve(root, "adapters", adapterDirectory)
        : resolve(root, "packages", packagePath);
      packageManifests[match[1]] = JSON.parse(
        await readFile(resolve(base, "package.json"), "utf8"),
      );
    }
  }
  return {
    roadmap,
    issueDrafts,
    epicDrafts,
    rootPackage: JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
    packageManifests,
    capabilitySlots: await loadCapabilitySlots(root),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) fail("planning checker accepts no arguments");
  validatePlanningSnapshot(await loadPlanningSnapshot());
  process.stdout.write("planning contracts verified\n");
}
