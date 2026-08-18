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

function boardCensusProblems(board) {
  const problems = [];
  if (!Number.isSafeInteger(board.totalCount) || board.totalCount < 0) {
    problems.push("board totalCount is not a nonnegative safe integer");
  }
  if (!Array.isArray(board.issues) || board.issues.length !== board.totalCount) {
    problems.push(
      `board issue census has ${Array.isArray(board.issues) ? board.issues.length : "invalid"} rows but totalCount is ${board.totalCount}`,
    );
    return problems;
  }
  const numbers = new Set();
  for (const item of board.issues) {
    if (!Number.isSafeInteger(item.number) || item.number <= 0 || numbers.has(item.number)) {
      problems.push(`board issue number ${String(item.number)} is malformed or duplicated`);
    }
    numbers.add(item.number);
  }
  return problems;
}

export function boardMismatches(planning, board) {
  const { roadmap } = planning;
  const problems = boardCensusProblems(board);
  if (problems.length > 0) return problems;
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

export function boardSnapshotFromGraphqlPages(repository, pages) {
  if (!Array.isArray(pages) || pages.length === 0) fail("board query returned no pages");
  let totalCount;
  const issues = [];
  const cursors = new Set();
  for (let index = 0; index < pages.length; index += 1) {
    const connection = pages[index]?.data?.repository?.issues;
    if (
      !connection ||
      !Number.isSafeInteger(connection.totalCount) ||
      connection.totalCount < 0 ||
      !Array.isArray(connection.nodes) ||
      typeof connection.pageInfo?.hasNextPage !== "boolean"
    ) {
      fail(`board query page ${index + 1} is malformed`);
    }
    if (totalCount === undefined) totalCount = connection.totalCount;
    if (connection.totalCount !== totalCount) {
      fail("board totalCount moved during pagination");
    }
    const isLast = index === pages.length - 1;
    if (connection.pageInfo.hasNextPage === isLast) {
      fail(
        isLast
          ? "board pagination stopped before the final page"
          : "board query returned rows after its final page",
      );
    }
    if (connection.pageInfo.hasNextPage) {
      const cursor = connection.pageInfo.endCursor;
      if (typeof cursor !== "string" || cursor === "" || cursors.has(cursor)) {
        fail("board pagination cursor is missing or repeated");
      }
      cursors.add(cursor);
    }
    for (const node of connection.nodes) {
      issues.push({
        number: node?.number,
        title: node?.title,
        body: node?.body,
        milestone: node?.milestone?.title ?? null,
        state: node?.state,
        stateReason: node?.stateReason ?? null,
      });
    }
  }
  const snapshot = { repository, totalCount, issues };
  const problems = boardCensusProblems(snapshot);
  if (problems.length > 0) fail(problems.join("; "));
  return snapshot;
}

export function validateBoardSnapshot(planning, board) {
  const problems = boardMismatches(planning, board);
  if (problems.length > 0) {
    fail(`${problems.length} board mismatch(es)\n  - ${problems.join("\n  - ")}`);
  }
}

export function projectSnapshotFromGraphqlPages(project, pages) {
  if (!Array.isArray(pages) || pages.length === 0) fail(`${project.title} query returned no pages`);
  let totalCount;
  const items = [];
  const cursors = new Set();
  for (let index = 0; index < pages.length; index += 1) {
    const observedProject = pages[index]?.data?.node;
    const connection = observedProject?.items;
    if (
      observedProject?.id !== project.id ||
      observedProject?.title !== project.title ||
      !connection ||
      !Number.isSafeInteger(connection.totalCount) ||
      connection.totalCount < 0 ||
      !Array.isArray(connection.nodes) ||
      typeof connection.pageInfo?.hasNextPage !== "boolean"
    ) {
      fail(`${project.title} query page ${index + 1} is malformed or names the wrong project`);
    }
    if (totalCount === undefined) totalCount = connection.totalCount;
    if (connection.totalCount !== totalCount)
      fail(`${project.title} totalCount moved during pagination`);
    const isLast = index === pages.length - 1;
    if (connection.pageInfo.hasNextPage === isLast) {
      fail(
        isLast
          ? `${project.title} pagination stopped before the final page`
          : `${project.title} returned rows after its final page`,
      );
    }
    if (connection.pageInfo.hasNextPage) {
      const cursor = connection.pageInfo.endCursor;
      if (typeof cursor !== "string" || cursor === "" || cursors.has(cursor)) {
        fail(`${project.title} pagination cursor is missing or repeated`);
      }
      cursors.add(cursor);
    }
    for (const node of connection.nodes) {
      items.push({
        id: node?.id,
        repository: node?.content?.repository?.nameWithOwner,
        number: node?.content?.number,
      });
    }
  }
  if (items.length !== totalCount) {
    fail(`${project.title} item census has ${items.length} rows but totalCount is ${totalCount}`);
  }
  const itemIds = new Set();
  for (const item of items) {
    if (typeof item.id !== "string" || item.id === "" || itemIds.has(item.id)) {
      fail(`${project.title} item identity is missing or duplicated`);
    }
    itemIds.add(item.id);
  }
  return { id: project.id, title: project.title, totalCount, items };
}

export function planningProjectMismatches(
  planning,
  board,
  destinationProject,
  sourceProject,
  sourceBoard,
) {
  const problems = [];
  const byKey = indexBoardByKey(board);
  const destinationIdentityCounts = new Map();
  for (const item of destinationProject.items) {
    if (
      typeof item.repository !== "string" ||
      !Number.isSafeInteger(item.number) ||
      item.number <= 0
    ) {
      continue;
    }
    const identity = `${item.repository}#${item.number}`;
    destinationIdentityCounts.set(identity, (destinationIdentityCounts.get(identity) ?? 0) + 1);
  }
  for (const registered of [...planning.roadmap.epics, ...planning.roadmap.issues]) {
    const boardItem = byKey.get(registered.key);
    if (!boardItem) continue;
    const identity = `${planning.roadmap.repository}#${boardItem.number}`;
    const projectItems = destinationProject.items.filter(
      (item) => `${item.repository}#${item.number}` === identity,
    );
    if (projectItems.length !== 1) {
      problems.push(`${registered.key} has ${projectItems.length} destination project items`);
    }
  }
  for (const [identity, count] of destinationIdentityCounts) {
    if (count > 1) problems.push(`${identity} is duplicated on the destination project`);
  }
  const migratedSourceIssueNumbers = [
    ...planning.migration.sourceIssueNumbers,
    ...planning.migration.postCensusAddendum.records.map((record) => record.sourceIssueNumber),
  ];
  for (const sourceIssueNumber of migratedSourceIssueNumbers) {
    const matches = sourceProject.items.filter(
      (item) =>
        item.repository === planning.migration.sourceRepository &&
        item.number === sourceIssueNumber,
    );
    if (matches.length !== 0) {
      problems.push(`migrated #${sourceIssueNumber} remains on ${sourceProject.title}`);
    }
  }
  for (const record of planning.migration.postCensusAddendum.records) {
    const matches = sourceBoard.issues.filter((item) => item.number === record.sourceIssueNumber);
    if (matches.length !== 1) {
      problems.push(`source issue #${record.sourceIssueNumber} census has ${matches.length} rows`);
      continue;
    }
    if (matches[0].state !== record.requiredSourceState) {
      problems.push(
        `source issue #${record.sourceIssueNumber} state is ${String(matches[0].state)} instead of ${record.requiredSourceState}`,
      );
    }
    if (matches[0].stateReason !== record.requiredSourceStateReason) {
      problems.push(
        `source issue #${record.sourceIssueNumber} stateReason is ${String(matches[0].stateReason)} instead of ${record.requiredSourceStateReason}`,
      );
    }
  }
  return problems;
}

export function validatePlanningProjects(
  planning,
  board,
  destinationProject,
  sourceProject,
  sourceBoard,
) {
  const problems = planningProjectMismatches(
    planning,
    board,
    destinationProject,
    sourceProject,
    sourceBoard,
  );
  if (problems.length > 0) {
    fail(`${problems.length} project mismatch(es)\n  - ${problems.join("\n  - ")}`);
  }
}

export async function loadBoardSnapshot(repository) {
  const repositoryParts = repository.split("/");
  if (repositoryParts.length !== 2 || repositoryParts.some((part) => part === "")) {
    fail(`repository identity ${repository} is malformed`);
  }
  const [owner, name] = repositoryParts;
  let stdout;
  try {
    ({ stdout } = await runFile(
      "gh",
      [
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-f",
        "query=query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){issues(first:100,after:$endCursor,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){totalCount nodes{number title body state stateReason milestone{title}} pageInfo{hasNextPage endCursor}}}}",
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    ));
  } catch (error) {
    fail(
      `gh could not read the ${repository} issue census: ${String(error?.stderr ?? error?.message ?? error).trim()}`,
    );
  }
  let pages;
  try {
    pages = JSON.parse(stdout);
  } catch {
    fail(`gh returned malformed JSON for the ${repository} issue census`);
  }
  return boardSnapshotFromGraphqlPages(repository, pages);
}

export async function loadProjectSnapshot(project) {
  let stdout;
  try {
    ({ stdout } = await runFile(
      "gh",
      [
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "-F",
        `projectId=${project.id}`,
        "-f",
        "query=query($projectId:ID!,$endCursor:String){node(id:$projectId){... on ProjectV2{id title items(first:100,after:$endCursor){totalCount nodes{id content{... on Issue{number repository{nameWithOwner}}}} pageInfo{hasNextPage endCursor}}}}}",
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    ));
  } catch (error) {
    fail(
      `gh could not read ${project.title}: ${String(error?.stderr ?? error?.message ?? error).trim()}`,
    );
  }
  let pages;
  try {
    pages = JSON.parse(stdout);
  } catch {
    fail(`gh returned malformed JSON for ${project.title}`);
  }
  return projectSnapshotFromGraphqlPages(project, pages);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) fail("board checker accepts no arguments");
  const planning = await loadPlanningSnapshot();
  const board = await loadBoardSnapshot(planning.roadmap.repository);
  const destinationProject = await loadProjectSnapshot(planning.migration.destinationProject);
  const sourceProject = await loadProjectSnapshot(planning.migration.sourceProject);
  const sourceBoard = await loadBoardSnapshot(planning.migration.sourceRepository);
  const issueProblems = boardMismatches(planning, board);
  const projectProblems = planningProjectMismatches(
    planning,
    board,
    destinationProject,
    sourceProject,
    sourceBoard,
  );
  const problems = [...issueProblems, ...projectProblems];
  if (problems.length > 0) {
    fail(`${problems.length} board/project mismatch(es)\n  - ${problems.join("\n  - ")}`);
  }
  process.stdout.write("board contracts verified\n");
}
