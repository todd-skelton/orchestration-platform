import { createHash } from "node:crypto";
import {
  canonicalJson,
  isSha256,
  type ContractRecord,
} from "../../packages/contracts/src/index.js";
import { sha256Bytes } from "../../packages/conformance/src/contracts.js";
import {
  computeGithubPortablePrimitivesIndependentReviewDigest,
  parseGithubPortablePrimitivesIndependentReview,
} from "../../packages/conformance/src/github-portable-primitives-review.js";
import { projectGithubProtectionSnapshot } from "../../packages/conformance/src/github-protection.js";
import { serializePortablePrimitivesCapabilityDecisionCore } from "../../packages/conformance/src/portable-primitives-decision.js";
import { readGithubProtection } from "./hosted-plan.mjs";
import {
  canonicalGithubDateHeader,
  type GithubFetch,
  type HostedRecordApiResult,
} from "./hosted-record-api.mjs";

export interface HostedReviewExpected {
  readonly repositoryId: string;
  readonly pullRequestNumber: string;
  readonly decisionCoreDigest: string;
  readonly mergeCommitRevision: string;
}

function requireFact(condition: unknown): asserts condition {
  if (!condition) throw new TypeError("reviewProvider:refused");
}

function record(input: unknown): Record<string, unknown> {
  requireFact(
    input !== null &&
      typeof input === "object" &&
      Object.getPrototypeOf(input) === Object.prototype,
  );
  requireFact(
    Object.values(Object.getOwnPropertyDescriptors(input)).every(
      (d) => "value" in d && d.enumerable,
    ),
  );
  return input as Record<string, unknown>;
}

function decimal(input: unknown): string {
  requireFact(typeof input === "number" && Number.isSafeInteger(input) && input > 0);
  return String(input);
}

function revision(input: unknown): string {
  requireFact(typeof input === "string" && /^[0-9a-f]{40}$/.test(input));
  return input;
}

function timestamp(input: unknown): string {
  requireFact(
    typeof input === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input),
  );
  const canonical = new Date(input).toISOString();
  requireFact(input === canonical || input === canonical.replace(".000Z", "Z"));
  return canonical;
}

// Links are evidence of completeness, never destinations for credentialed reads.
function pagination(response: Response, url: string, count: number): void {
  const current = new URL(url);
  const page = Number(current.searchParams.get("page"));
  const relations = new Set<string>();
  for (const entry of response.headers.get("link")?.split(",") ?? []) {
    const match = entry.trim().match(/^<([^>]+)>; rel="(next|prev|first|last)"$/);
    requireFact(match && !relations.has(match[2]!));
    relations.add(match[2]!);
    const target = new URL(match[1]!);
    const targetPage = target.searchParams.get("page");
    requireFact(targetPage && /^[1-9][0-9]*$/.test(targetPage));
    const expected = new URL(current);
    expected.searchParams.set("page", targetPage);
    requireFact(target.href === expected.href);
    if (match[2] === "next") requireFact(Number(targetPage) === page + 1 && count === 100);
    if (match[2] === "last")
      requireFact(Number(targetPage) >= page && (count === 100 || Number(targetPage) === page));
  }
}

/** Read-only review authentication, not certification of the core's run evidence or writer.
 * The later stable terminal must supply its independently authenticated run/candidate bindings.
 */
export async function readGithubHostedPortablePrimitivesReview(input: {
  readonly expected: HostedReviewExpected;
  readonly bindings: {
    readonly candidateSubjectDigest: string;
    readonly providerRunDigest: string;
  };
  readonly token: string;
  readonly fetcher?: GithubFetch;
}): Promise<
  HostedRecordApiResult<{
    readonly providerReview: ContractRecord;
    readonly digest: string;
    readonly core: ContractRecord;
    readonly coreBytes: Uint8Array;
  }>
> {
  try {
    const { expected, bindings, token } = input;
    requireFact(
      typeof token === "string" &&
        token.length > 0 &&
        [expected.repositoryId, expected.pullRequestNumber].every(
          (v) =>
            typeof v === "string" && /^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v)),
        ),
    );
    revision(expected.mergeCommitRevision);
    requireFact(
      isSha256(expected.decisionCoreDigest) &&
        isSha256(bindings.candidateSubjectDigest) &&
        isSha256(bindings.providerRunDigest),
    );
    const fetcher = input.fetcher ?? fetch;
    let repository = "";
    const guardedFetch: GithubFetch = async (url, init) => {
      const target = new URL(url);
      requireFact(
        target.origin === "https://api.github.com" &&
          !target.username &&
          !target.password &&
          !target.hash,
      );
      // Reused protection reads may follow only this repository's page links.
      requireFact(
        url === `https://api.github.com/repositories/${expected.repositoryId}` ||
          (repository &&
            (target.pathname.startsWith(`/repos/${repository}/`) ||
              (target.pathname.startsWith(`/orgs/${repository.split("/")[0]}/rulesets/`) &&
                /^[1-9][0-9]*$/.test(target.pathname.split("/").at(-1)!)))),
      );
      const response = await fetcher(url, { ...init, method: "GET", redirect: "error" });
      requireFact(!response.redirected && (!response.url || response.url === url));
      if (target.searchParams.has("page") && response.ok) {
        const rows: unknown = await response.clone().json();
        requireFact(Array.isArray(rows) && rows.length <= 100);
        pagination(response, url, rows.length);
        // readGithubProtection follows Link; require a terminal short page.
        if (target.pathname.endsWith("/rulesets") && rows.length === 100)
          requireFact(response.headers.get("link")?.includes('rel="next"'));
      }
      return response;
    };
    const request = async (path: string): Promise<Response> => {
      const response = await guardedFetch(`https://api.github.com${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      requireFact(response.status === 200);
      return response;
    };
    const json = async (path: string): Promise<Record<string, unknown>> =>
      record(await (await request(path)).json());
    const repo = await json(`/repositories/${expected.repositoryId}`);
    requireFact(
      decimal(repo.id) === expected.repositoryId && record(repo.permissions).admin === true,
    );
    requireFact(
      typeof repo.full_name === "string" &&
        /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repo.full_name),
    );
    repository = repo.full_name;
    const root = `/repos/${repository}`;
    const prPath = `${root}/pulls/${expected.pullRequestNumber}`;
    const corePath = `planning/decisions/ISS-022/${expected.decisionCoreDigest}/decision-core.json`;
    const protection = async (): Promise<string> => {
      const projected = projectGithubProtectionSnapshot(
        await readGithubProtection(repository, token, guardedFetch),
      );
      requireFact(projected.ok);
      return projected.digest;
    };
    const initialProtection = await protection();
    const prIdentity = (pr: Record<string, unknown>) => {
      const base = record(pr.base);
      const head = record(pr.head);
      requireFact(
        decimal(pr.number) === expected.pullRequestNumber &&
          pr.state === "closed" &&
          pr.merged === true &&
          pr.draft === false,
      );
      requireFact(pr.merge_commit_sha === expected.mergeCommitRevision && pr.changed_files === 1);
      requireFact(base.ref === "main" && decimal(record(base.repo).id) === expected.repositoryId);
      return {
        author: decimal(record(pr.user).id),
        head: revision(head.sha),
        headRepository: decimal(record(head.repo).id),
        mergedAt: timestamp(pr.merged_at),
      };
    };
    const pr = prIdentity(await json(prPath));
    const fileResponse = await request(`${prPath}/files?per_page=100&page=1`);
    const files: unknown = await fileResponse.json();
    requireFact(Array.isArray(files) && files.length === 1);
    const file = record(files[0]);
    requireFact(file.filename === corePath && file.status === "added");
    const blobSha = revision(file.sha);

    // Non-recursive trees avoid GitHub's recursive-tree truncation limit and prove file mode.
    const readCore = async (commit: string): Promise<Uint8Array> => {
      const commitRow = await json(`${root}/git/commits/${commit}`);
      requireFact(commitRow.sha === commit);
      let treeSha = revision(record(commitRow.tree).sha);
      const parts = corePath.split("/");
      for (const [index, part] of parts.entries()) {
        const tree = await json(`${root}/git/trees/${treeSha}`);
        requireFact(
          tree.sha === treeSha &&
            tree.truncated === false &&
            Array.isArray(tree.tree) &&
            tree.tree.length <= 4096,
        );
        const matches = tree.tree.map(record).filter((row) => row.path === part);
        requireFact(matches.length === 1);
        const row = matches[0]!;
        const leaf = index === parts.length - 1;
        requireFact(
          row.type === (leaf ? "blob" : "tree") && row.mode === (leaf ? "100644" : "040000"),
        );
        treeSha = revision(row.sha);
      }
      requireFact(treeSha === blobSha);
      const blob = await json(`${root}/git/blobs/${treeSha}`);
      requireFact(
        blob.sha === blobSha &&
          blob.encoding === "base64" &&
          typeof blob.content === "string" &&
          Number.isSafeInteger(blob.size) &&
          Number(blob.size) > 0 &&
          Number(blob.size) <= 65536,
      );
      const encoded = blob.content.replace(/\n/g, "");
      const bytes = Buffer.from(encoded, "base64");
      requireFact(bytes.toString("base64") === encoded && bytes.byteLength === blob.size);
      requireFact(
        createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex") ===
          blobSha,
      );
      return new Uint8Array(bytes);
    };
    const coreBytes = await readCore(pr.head);
    requireFact(
      Buffer.from(coreBytes).equals(Buffer.from(await readCore(expected.mergeCommitRevision))),
    );
    const core = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(coreBytes)));
    const serialized = serializePortablePrimitivesCapabilityDecisionCore(core);
    requireFact(
      serialized.ok &&
        serialized.digest === expected.decisionCoreDigest &&
        Buffer.from(serialized.bytes).equals(Buffer.from(coreBytes)),
    );
    requireFact(
      core.candidateSubjectDigest === bindings.candidateSubjectDigest &&
        core.providerRunDigest === bindings.providerRunDigest,
    );

    const reviews = async () => {
      const rows: Array<{
        id: string;
        reviewer: string;
        state: string;
        commit: string;
        at: string | null;
      }> = [];
      const seen = new Set<string>();
      // Ten pages including the short terminal page; a missing terminal refuses.
      for (let page = 1; page <= 10; page += 1) {
        const response = await request(`${prPath}/reviews?per_page=100&page=${page}`);
        const items: unknown = await response.json();
        requireFact(Array.isArray(items) && items.length <= 100);
        for (const item of items) {
          const row = record(item);
          const id = decimal(row.id);
          requireFact(!seen.has(id) && row.pull_request_url === `https://api.github.com${prPath}`);
          seen.add(id);
          requireFact(
            typeof row.state === "string" &&
              ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"].includes(
                row.state,
              ),
          );
          const at = row.state === "PENDING" ? null : timestamp(row.submitted_at);
          rows.push({
            id,
            reviewer: decimal(record(row.user).id),
            state: row.state,
            commit: revision(row.commit_id),
            at,
          });
        }
        if (items.length < 100) return rows;
      }
      throw new TypeError("reviewProvider:pagination-over-bound");
    };
    const initialReviews = await reviews();
    const latest = new Map<string, (typeof initialReviews)[number]>();
    // GitHub lists reviews chronologically. Conservatively require the actor's
    // last visible review itself to be APPROVED, including any later draft/comment.
    for (const row of initialReviews) latest.set(row.reviewer, row);
    const approved = [...latest.values()]
      .reverse()
      .find(
        (row) =>
          row.state === "APPROVED" &&
          row.reviewer !== pr.author &&
          row.commit === pr.head &&
          row.at !== null &&
          row.at <= pr.mergedAt,
      );
    requireFact(approved && approved.at);
    const main = await json(`${root}/branches/main`);
    requireFact(main.name === "main" && main.protected === true);
    const mainRevision = revision(record(main.commit).sha);
    const comparison = await json(
      `${root}/compare/${expected.mergeCommitRevision}...${mainRevision}`,
    );
    requireFact(
      ["ahead", "identical"].includes(String(comparison.status)) &&
        record(comparison.base_commit).sha === expected.mergeCommitRevision &&
        record(comparison.merge_base_commit).sha === expected.mergeCommitRevision,
    );
    requireFact(canonicalJson(initialReviews) === canonicalJson(await reviews()));
    requireFact(initialProtection === (await protection()));
    const finalResponse = await request(prPath);
    const verifiedAt = canonicalGithubDateHeader(finalResponse.headers.get("date"));
    requireFact(
      verifiedAt &&
        pr.mergedAt <= verifiedAt &&
        canonicalJson(pr) === canonicalJson(prIdentity(record(await finalResponse.json()))),
    );
    const finalRepo = await json(`/repositories/${expected.repositoryId}`);
    requireFact(
      decimal(finalRepo.id) === expected.repositoryId &&
        finalRepo.full_name === repository &&
        record(finalRepo.permissions).admin === true,
    );
    const provider = parseGithubPortablePrimitivesIndependentReview({
      candidateSubjectDigest: core.candidateSubjectDigest,
      coreBytesDigest: sha256Bytes(coreBytes),
      corePath,
      corePullRequestAuthorId: pr.author,
      decisionCoreDigest: expected.decisionCoreDigest,
      mergeCommitRevision: expected.mergeCommitRevision,
      providerRunDigest: core.providerRunDigest,
      pullRequestNumber: expected.pullRequestNumber,
      repositoryId: expected.repositoryId,
      reviewCommitRevision: pr.head,
      reviewId: approved.id,
      reviewedAt: approved.at,
      reviewerId: approved.reviewer,
      schemaVersion: "github-portable-primitives-independent-review/v1",
      state: "APPROVED",
    });
    requireFact(provider.ok);
    return {
      ok: true,
      value: {
        providerReview: provider.value,
        digest: computeGithubPortablePrimitivesIndependentReviewDigest(provider.value),
        core: core as ContractRecord,
        coreBytes,
      },
    };
  } catch {
    return { ok: false, issues: ["reviewProvider:refused"] };
  }
}
