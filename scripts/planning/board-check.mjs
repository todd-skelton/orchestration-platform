import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { loadPlanningSnapshot, parseFrontmatter } from "./check.mjs";

const runFile = promisify(execFile);

const draftBase =
  "https://github.com/todd-skelton/orchestration-platform/blob/main/planning/drafts";

function fail(message) {
  throw new Error(`BOARD_CONTRACT_MISMATCH: ${message}`);
}

export function normalizeBody(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

export function planningKeyOf(body) {
  const match = String(body ?? "").match(/^<!-- planning-key: (EPIC-[A-Z]+|ISS-\d{3}) -->/m);
  return match ? match[1] : undefined;
}

export function expectedBoardItems(planning, epicNumbers) {
  const { roadmap } = planning;
  const milestoneTitles = new Map(roadmap.milestones.map((row) => [row.key, row.title]));
  const items = [];
  for (const epic of roadmap.epics) {
    const source = planning.epicDrafts[epic.key];
    const frontmatter = parseFrontmatter(source, epic.file);
    items.push({
      key: epic.key,
      isEpic: true,
      title: frontmatter.title,
      milestone: null,
      body: [
        `<!-- planning-key: ${epic.key} -->`,
        "",
        `Source draft: [\`planning/drafts/${epic.key}.md\`](${draftBase}/${epic.key}.md)`,
        "",
        source,
      ].join("\n"),
    });
  }
  for (const issue of roadmap.issues) {
    const source = planning.issueDrafts[issue.key];
    const frontmatter = parseFrontmatter(source, issue.file);
    const epicNumber = epicNumbers.get(issue.parent);
    if (!epicNumber) fail(`${issue.key} parent ${issue.parent} has no board number`);
    items.push({
      key: issue.key,
      isEpic: false,
      title: `[${issue.key}] ${frontmatter.title}`,
      milestone: milestoneTitles.get(issue.milestone) ?? null,
      body: [
        `<!-- planning-key: ${issue.key} -->`,
        "",
        `Parent epic: #${epicNumber} (\`${issue.parent}\`)`,
        "",
        `Source draft: [\`planning/drafts/${issue.key}.md\`](${draftBase}/${issue.key}.md)`,
        "",
        source,
      ].join("\n"),
    });
  }
  return items;
}

export function indexBoardByKey(board) {
  const byKey = new Map();
  for (const item of board.issues) {
    const key = planningKeyOf(item.body);
    if (!key) continue;
    if (byKey.has(key)) {
      fail(`planning key ${key} is claimed by #${byKey.get(key).number} and #${item.number}`);
    }
    byKey.set(key, item);
  }
  return byKey;
}

export function boardMismatches(planning, board) {
  const { roadmap } = planning;
  const problems = [];
  let byKey;
  try {
    byKey = indexBoardByKey(board);
  } catch (error) {
    return [String(error?.message ?? error).replace(/^BOARD_CONTRACT_MISMATCH: /, "")];
  }
  const registered = new Set([
    ...roadmap.epics.map((row) => row.key),
    ...roadmap.issues.map((row) => row.key),
  ]);
  for (const [key, item] of byKey) {
    if (!registered.has(key)) {
      problems.push(`#${item.number} carries unregistered planning key ${key}`);
    }
  }
  const epicNumbers = new Map();
  for (const epic of roadmap.epics) {
    const item = byKey.get(epic.key);
    if (!item) {
      problems.push(`${epic.key} has no registered board item`);
      continue;
    }
    epicNumbers.set(epic.key, item.number);
  }
  for (const expected of expectedBoardItems(planning, epicNumbers)) {
    const item = byKey.get(expected.key);
    if (!item) {
      problems.push(`${expected.key} has no registered board item`);
      continue;
    }
    if (item.title !== expected.title) {
      problems.push(
        `${expected.key} title is "${item.title}" but its draft declares "${expected.title}"`,
      );
    }
    const observedMilestone = item.milestone ?? null;
    const expectedMilestone = expected.milestone ?? null;
    if (observedMilestone !== expectedMilestone) {
      problems.push(
        `${expected.key} milestone is ${observedMilestone ?? "none"} but the roadmap declares ${expectedMilestone ?? "none"}`,
      );
    }
    if (normalizeBody(item.body) !== normalizeBody(expected.body)) {
      problems.push(`${expected.key} body does not match its source draft`);
    }
  }
  return problems;
}

export function validateBoardSnapshot(planning, board) {
  const problems = boardMismatches(planning, board);
  if (problems.length > 0) {
    fail(`${problems.length} board mismatch(es)\n  - ${problems.join("\n  - ")}`);
  }
}

export async function loadBoardSnapshot(repository) {
  let stdout;
  try {
    ({ stdout } = await runFile(
      "gh",
      [
        "api",
        "--paginate",
        `repos/${repository}/issues?state=all&per_page=100`,
        "--jq",
        '.[] | select(has("pull_request") | not) | {number, title, body, milestone: (.milestone.title // null)}',
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    ));
  } catch (error) {
    fail(
      `gh could not read the ${repository} issue census: ${String(error?.stderr ?? error?.message ?? error).trim()}`,
    );
  }
  const issues = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
  return { repository, issues };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) fail("board checker accepts no arguments");
  const planning = await loadPlanningSnapshot();
  const board = await loadBoardSnapshot(planning.roadmap.repository);
  validateBoardSnapshot(planning, board);
  process.stdout.write("board contracts verified\n");
}
