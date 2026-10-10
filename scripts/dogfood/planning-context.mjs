import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// ISS-237: one complete read-only census, including closed siblings and native
// dependency intent. An incomplete nested connection cannot supply context.
export async function planningAuthority(
  repository,
  request = async (args) =>
    JSON.parse((await exec("gh", args, { maxBuffer: 32 * 1024 * 1024 })).stdout),
) {
  const [owner, name] = repository.split("/");
  const issues = [];
  const fields = {
    subIssues: "number state",
    blockedBy: "number state",
    blocking: "number state",
    comments: "id url body updatedAt author { login }",
  };
  let after;
  do {
    const query = `query($owner:String!, $name:String!, $after:String) {
      repository(owner:$owner, name:$name) {
        issues(first:100, after:$after, states:[OPEN,CLOSED]) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number url title body updatedAt state
            milestone { number title description state }
            parent { number }
            subIssues(first:100) { pageInfo { hasNextPage endCursor } nodes { number state } }
            blockedBy(first:100) { pageInfo { hasNextPage endCursor } nodes { number state } }
            blocking(first:100) { pageInfo { hasNextPage endCursor } nodes { number state } }
            comments(first:100) { pageInfo { hasNextPage endCursor } nodes { id url body updatedAt author { login } } }
          }
        }
      }
    }`;
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
    ];
    if (after) args.push("-F", `after=${after}`);
    const response = await request(args);
    const page = response?.data?.repository?.issues;
    if (
      response.errors ||
      !Array.isArray(page?.nodes) ||
      typeof page.pageInfo?.hasNextPage !== "boolean"
    )
      throw new Error("incomplete planning authority");
    for (const row of page.nodes) {
      if (
        !Number.isSafeInteger(row.number) ||
        typeof row.body !== "string" ||
        typeof row.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(row.updatedAt)) ||
        typeof row.url !== "string" ||
        typeof row.title !== "string" ||
        !["OPEN", "CLOSED"].includes(row.state)
      )
        throw new Error("malformed planning issue");
      for (const [field, selection] of Object.entries(fields)) {
        let page = row[field];
        const nodes = [];
        const cursors = new Set();
        for (;;) {
          if (typeof page?.pageInfo?.hasNextPage !== "boolean" || !Array.isArray(page?.nodes))
            throw new Error(`incomplete planning ${field} for #${row.number}`);
          nodes.push(...page.nodes);
          if (!page.pageInfo.hasNextPage) break;
          const cursor = page.pageInfo.endCursor;
          if (!cursor || cursors.has(cursor))
            throw new Error("incomplete nested planning pagination");
          cursors.add(cursor);
          const query = `query($owner:String!, $name:String!, $number:Int!, $after:String) {
            repository(owner:$owner, name:$name) { issue(number:$number) {
              ${field}(first:100, after:$after) { pageInfo { hasNextPage endCursor } nodes { ${selection} } }
            } }
          }`;
          const next = await request([
            "api",
            "graphql",
            "-f",
            `query=${query}`,
            "-F",
            `owner=${owner}`,
            "-F",
            `name=${name}`,
            "-F",
            `number=${row.number}`,
            "-F",
            `after=${cursor}`,
          ]);
          if (next.errors) throw new Error("incomplete nested planning authority");
          page = next?.data?.repository?.issue?.[field];
        }
        row[field] = { pageInfo: { hasNextPage: false }, nodes };
      }
      if (issues.some((issue) => issue.number === row.number))
        throw new Error("duplicate planning issue");
      issues.push(row);
    }
    const next = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
    if (page.pageInfo.hasNextPage && (!next || next === after))
      throw new Error("incomplete planning pagination");
    after = next;
  } while (after);
  const known = new Set(issues.map((row) => row.number));
  for (const row of issues) {
    const relations = [
      row.parent,
      ...row.subIssues.nodes,
      ...row.blockedBy.nodes,
      ...row.blocking.nodes,
    ].filter(Boolean);
    if (relations.some((relation) => !known.has(relation.number)))
      throw new Error("incomplete planning lineage");
  }
  return issues.sort((a, b) => a.number - b.number);
}
