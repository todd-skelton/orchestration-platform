import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { githubDeliveryAdapter } from "../../scripts/dogfood/delivery-adapter.mjs";
import {
  assertControllerRequest,
  deliveryStep,
  type DeliveryAdapter,
  type DeliveryConfig,
  type DeliveryPlan,
  type PublicationObservation,
  type PublicationEvidence,
} from "../../scripts/dogfood/delivery.mjs";

const head = "a".repeat(40);
const mergeCommit = "b".repeat(40);
const roots: string[] = [];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function fixture() {
  const parent = await realpath(await mkdtemp(resolve(tmpdir(), "delivery-fixture-")));
  roots.push(parent);
  const paths = await Promise.all(
    ["controller-", "author-", "reviewer-", "state-"].map((name) => mkdtemp(resolve(parent, name))),
  );
  const config: DeliveryConfig = {
    run: "delivery-fixture",
    issue: "fixture-issue",
    repository: "fixture/repository",
    controllerRoot: paths[0]!,
    controllerRevision: "c".repeat(40),
    worktree: paths[1]!,
    reviewWorktree: paths[2]!,
    stateDirectory: paths[3]!,
    candidateHead: head,
    requiredChecks: ["linux", "windows", "macos"],
    authority: {
      schemaVersion: "dogfood-delivery-authority/v1",
      controller: "fixture-controller",
      run: "delivery-fixture",
      repository: "fixture/repository",
      controllerRevision: "c".repeat(40),
      head,
      actions: ["gates", "mirror", "publish", "merge", "cleanup"],
    },
    policy: { kind: "fixture" },
  };
  const plan: DeliveryPlan = {
    gates: {
      beforeMirror: ["typecheck", "format:check", "planning:check"],
      afterMirror: ["planning:board-check"],
    },
    drafts: [
      {
        key: "EPIC-FIXTURE",
        issue: 2,
        title: "epic",
        body: "epic body",
        attributes: { milestone: null },
      },
      {
        key: "ISS-074",
        issue: 332,
        title: "issue",
        body: "issue body",
        attributes: { milestone: "M2" },
      },
    ],
    publication: {
      sourceBranch: "codex/fixture",
      baseBranch: "main",
      title: "fixture PR",
      body: "fixture body",
      draft: true,
    },
    mergePolicy: { method: "squash" },
    cleanup: { worktrees: [paths[1]!, paths[2]!], branch: "codex/fixture" },
  };
  const calls: string[] = [];
  const publication: PublicationEvidence = {
    number: 44,
    url: "https://example.test/pull/44",
    head,
    repository: config.repository,
    sourceBranch: plan.publication.sourceBranch,
    baseBranch: plan.publication.baseBranch,
    title: plan.publication.title,
    body: plan.publication.body,
    planDigest: digest(plan),
  };
  const state = {
    workspace: true,
    drafts: new Set<number>(),
    publication: undefined as PublicationEvidence | undefined,
    merged: false,
    cleanup: "present" as "present" | "partial" | "complete",
    publicationOutcome: "confirmed" as "confirmed" | "unknown",
    checks: "pass" as "pass" | "pending" | "duplicate" | "missing" | "skipping",
  };
  const adapter: DeliveryAdapter = {
    publicationUrl(_config, number) {
      return `https://example.test/pull/${number}`;
    },
    async source() {
      calls.push("source");
      return {
        head,
        reviewId: "review-fixture",
        controller: "fixture-controller",
        run: config.run,
        issue: config.issue,
        repository: config.repository,
        controllerRevision: config.controllerRevision,
        worktree: config.worktree,
        reviewWorktree: config.reviewWorktree,
        stateDirectory: config.stateDirectory,
        requiredChecks: [...config.requiredChecks],
      };
    },
    async verifyWorkspace() {
      calls.push("verify");
      return state.workspace;
    },
    async runGate(_config, name) {
      calls.push(`gate:${name}`);
      return "passed";
    },
    async observeDraft(_config, draft) {
      calls.push(`observe-draft:${draft.issue}`);
      return state.drafts.has(draft.issue)
        ? { state: "confirmed", value: { issue: draft.issue } }
        : { state: "needs-mutation" };
    },
    async applyDraft(_config, draft) {
      calls.push(`draft:${draft.issue}`);
      state.drafts.add(draft.issue);
    },
    async observePublication(): Promise<PublicationObservation> {
      calls.push("observe-publication");
      if (state.publicationOutcome === "unknown") return { state: "unknown" };
      return state.publication
        ? { state: "confirmed", value: state.publication }
        : { state: "needs-mutation", target: "fixture-absent" };
    },
    async publish() {
      calls.push("publish");
      state.publication = publication;
    },
    async checks() {
      calls.push("checks");
      const values = config.requiredChecks.map((name) => ({
        name,
        bucket: (state.checks === "pending" && name === "macos" ? "pending" : "pass") as
          "pass" | "pending",
        link: `https://example.test/check/${name}`,
      }));
      if (state.checks === "duplicate") values.push({ ...values[0]! });
      if (state.checks === "missing") values.pop();
      if (state.checks === "skipping") values[0]!.bucket = "skipping" as never;
      return { head, checks: values };
    },
    async observeMerge() {
      calls.push("observe-merge");
      return state.merged
        ? {
            state: "confirmed" as const,
            value: { number: publication.number, head, mergeCommit },
          }
        : { state: "needs-mutation" as const };
    },
    async merge() {
      calls.push("merge");
      state.merged = true;
    },
    async observeCleanup() {
      calls.push("observe-cleanup");
      if (state.cleanup === "partial") return { state: "unknown" };
      return state.cleanup === "complete"
        ? {
            state: "confirmed" as const,
            value: { worktrees: [...plan.cleanup.worktrees], branch: plan.cleanup.branch },
          }
        : { state: "needs-mutation" as const };
    },
    async cleanup() {
      calls.push("cleanup");
      state.cleanup = "complete";
    },
  };
  const policy = {
    async plan() {
      calls.push("policy");
      return plan;
    },
  };
  return { config, plan, publication, adapter, policy, calls, state };
}

async function writeState(config: DeliveryConfig, name: string, value: unknown) {
  await writeFile(resolve(config.stateDirectory, `${name}.json`), `${JSON.stringify(value)}\n`);
}

function expectNoProviderAction(calls: string[]) {
  expect(calls).not.toContain("verify");
  expect(calls.filter((call) => call.startsWith("gate:"))).toEqual([]);
  expect(calls.filter((call) => call.startsWith("observe-draft:"))).toEqual([]);
  expect(calls.filter((call) => call.startsWith("draft:"))).toEqual([]);
  expect(calls).not.toContain("observe-publication");
  expect(calls).not.toContain("publish");
  expect(calls).not.toContain("checks");
  expect(calls).not.toContain("observe-merge");
  expect(calls).not.toContain("merge");
  expect(calls).not.toContain("observe-cleanup");
  expect(calls).not.toContain("cleanup");
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("completes the authorized normal path once with intent-backed mutations", async () => {
  const f = await fixture();
  const result = await deliveryStep(f.config, f.adapter, f.policy);
  expect(result).toMatchObject({
    status: "complete",
    head,
    reviewId: "review-fixture",
    publication: { number: 44, url: "https://example.test/pull/44" },
    checks: [
      { name: "linux", bucket: "pass" },
      { name: "windows", bucket: "pass" },
      { name: "macos", bucket: "pass" },
    ],
    mergeCommit,
  });
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "cleanup")).toHaveLength(1);
  expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
  expect(f.calls.filter((call) => call.startsWith("draft:"))).toEqual(["draft:2", "draft:332"]);
  expect(f.calls.indexOf("gate:planning:check")).toBeLessThan(f.calls.indexOf("draft:2"));
  expect(f.calls.indexOf("draft:332")).toBeLessThan(f.calls.indexOf("gate:planning:board-check"));
});

it("resumes completed delivery after deleted candidate worktrees without consulting source or policy", async () => {
  const f = await fixture();
  await deliveryStep(f.config, f.adapter, f.policy);
  await Promise.all([
    rm(f.config.worktree, { recursive: true }),
    rm(f.config.reviewWorktree, { recursive: true }),
  ]);
  f.calls.length = 0;
  const result = await deliveryStep(f.config, f.adapter, {
    async plan() {
      throw new Error("must not be called");
    },
  });
  expect(result.status).toBe("complete");
  expect(f.calls).toEqual([]);
});

it("rejects an unknown issuer when resuming completed state without provider access", async () => {
  const f = await fixture();
  await deliveryStep(f.config, f.adapter, f.policy);
  f.config.authority.controller = "unknown-controller";
  await writeState(f.config, "delivery-config", { fingerprint: digest(f.config) });
  f.calls.length = 0;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "unauthorized-delivery",
  );
  expect(f.calls).toEqual([]);
  expectNoProviderAction(f.calls);
});

it("rejects a self-consistent saved plan that was not authorized by policy", async () => {
  const f = await fixture();
  const offPolicy = structuredClone(f.plan);
  offPolicy.publication.baseBranch = "release";
  await writeState(f.config, "delivery-plan", {
    head,
    digest: digest(offPolicy),
    plan: offPolicy,
  });
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "unauthorized-delivery-plan",
  );
  expect(f.calls).toEqual(["source", "policy"]);
});

it("observes pending hosted checks without merging or cleanup and resumes without republishing", async () => {
  const f = await fixture();
  f.state.checks = "pending";
  expect(await deliveryStep(f.config, f.adapter, f.policy)).toMatchObject({
    status: "observing-hosted-checks",
  });
  expect(f.calls).not.toContain("merge");
  f.state.checks = "pass";
  await deliveryStep(f.config, f.adapter, f.policy);
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
});

it.each([
  ["duplicate", "missing-or-duplicate-check:linux"],
  ["missing", "missing-or-duplicate-check:macos"],
  ["skipping", "hosted-check-failed:linux"],
] as const)("fails closed for %s required hosted checks", async (mode, reason) => {
  const f = await fixture();
  f.state.checks = mode;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(reason);
  expect(f.calls).not.toContain("merge");
});

it("invalidates readiness when hosted observation moves from the reviewed head", async () => {
  const f = await fixture();
  f.adapter.checks = async () => ({ head: "c".repeat(40), checks: [] });
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow("hosted-head-drift");
  expect(f.calls).not.toContain("merge");
});

it("does not retry an uncertain publication and reconciles it on restart", async () => {
  const f = await fixture();
  let observations = 0;
  f.adapter.observePublication = async () => {
    observations += 1;
    if (observations === 1) return { state: "needs-mutation", target: "fixture-absent" };
    if (observations === 2) return { state: "unknown" };
    return { state: "confirmed", value: f.publication };
  };
  f.adapter.publish = async () => {
    f.calls.push("publish");
    throw new Error("synthetic lost response");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "publication-outcome-unknown",
  );
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
  await deliveryStep(f.config, f.adapter, f.policy);
  expect(f.calls.filter((call) => call === "publish")).toHaveLength(1);
});

it("reconciles a delayed reviewed refresh without repeating its publication effect", async () => {
  const f = await fixture();
  const refresh = {
    number: f.publication.number,
    url: f.publication.url,
    head: "d".repeat(40),
  };
  f.config.refresh = refresh;
  f.config.authority.refresh = refresh;
  let visible = false;
  let publications = 0;
  f.adapter.observePublication = async (_config, _plan, _digest, target) => {
    if (visible) return { state: "confirmed", value: f.publication };
    return target === undefined
      ? { state: "needs-mutation", target: `pr:${refresh.number}` }
      : { state: "unknown" };
  };
  f.adapter.publish = async () => {
    publications += 1;
  };

  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "publication-outcome-unknown",
  );
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "publication-state-unknown",
  );
  expect(publications).toBe(1);
  visible = true;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).resolves.toMatchObject({
    status: "complete",
    head,
    reviewId: "review-fixture",
  });
  expect(publications).toBe(1);
  expect(f.calls.filter((call) => call.startsWith("gate:"))).toHaveLength(4);
});

it("rejects refresh authority substitution before source or provider access", async () => {
  const f = await fixture();
  f.config.refresh = {
    number: 44,
    url: "https://example.test/pull/44",
    head: "d".repeat(40),
  };
  f.config.authority.refresh = { ...f.config.refresh, number: 45 };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "unauthorized-delivery",
  );
  expect(f.calls).toEqual([]);
  expectNoProviderAction(f.calls);
});

it("persists a selected publication target and rejects its replacement on restart", async () => {
  const f = await fixture();
  const provider = githubDeliveryAdapter({
    async gh() {
      throw new Error("unexpected provider effect");
    },
    async ghJson() {
      if (uncertain) throw new Error("uncertain provider response");
      return [
        {
          number,
          url: `https://github.com/${f.config.repository}/pull/${number}`,
          headRefOid: head,
          headRefName: f.plan.publication.sourceBranch,
          baseRefName: f.plan.publication.baseBranch,
          state: "OPEN",
          isDraft: true,
          title: number === 44 ? "old title" : f.plan.publication.title,
          body: f.plan.publication.body,
        },
      ];
    },
  });
  let number = 44,
    uncertain = false;
  f.adapter.publicationUrl = provider.publicationUrl;
  f.adapter.observePublication = provider.observePublication;
  const targets: string[] = [];
  f.adapter.publish = async (_config, _plan, target) => {
    targets.push(target);
    uncertain = true;
    throw new Error("lost response");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "publication-outcome-unknown",
  );
  expect(
    JSON.parse(await readFile(resolve(f.config.stateDirectory, "publication-intent.json"), "utf8")),
  ).toMatchObject({ head, target: "pr:44" });
  number = 45;
  uncertain = false;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "publication-state-unknown",
  );
  expect(targets).toEqual(["pr:44"]);
  expect(f.calls).not.toContain("checks");
});

it("refuses a legacy unbound publication intent before observing the provider", async () => {
  const f = await fixture();
  await writeState(f.config, "publication-intent", {
    head,
    operation: digest({ name: "publication", head }),
  });
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-publication-intent",
  );
  expect(f.calls).not.toContain("observe-publication");
  expect(f.calls).not.toContain("publish");
});

it("rejects a same-head publication receipt whose approved base identity changed", async () => {
  const f = await fixture();
  f.state.checks = "pending";
  await deliveryStep(f.config, f.adapter, f.policy);
  await writeState(f.config, "publication", {
    ...f.publication,
    baseBranch: "release",
  });
  f.calls.length = 0;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-publication-receipt",
  );
  expect(f.calls).toEqual([]);
  expectNoProviderAction(f.calls);
});

it("rejects a receipt URL outside the adapter identity before provider effects", async () => {
  const f = await fixture();
  f.state.checks = "pending";
  await deliveryStep(f.config, f.adapter, f.policy);
  await writeState(f.config, "publication", {
    ...f.publication,
    url: "https://foreign.example/pull/44",
  });
  f.calls.length = 0;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-publication-receipt",
  );
  expect(f.calls).toEqual([]);
});

it("does not double merge after a lost provider response", async () => {
  const f = await fixture();
  let observations = 0;
  f.adapter.observeMerge = async () => {
    observations += 1;
    if (observations === 1) return { state: "needs-mutation" };
    if (observations === 2) return { state: "unknown" };
    return {
      state: "confirmed",
      value: { number: 44, head, mergeCommit },
    };
  };
  f.adapter.merge = async () => {
    f.calls.push("merge");
    throw new Error("synthetic lost response");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "merge-outcome-unknown",
  );
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
  await deliveryStep(f.config, f.adapter, f.policy);
  expect(f.calls.filter((call) => call === "merge")).toHaveLength(1);
});

it("refuses partial cleanup and never starts a second cleanup mutation", async () => {
  const f = await fixture();
  f.adapter.cleanup = async () => {
    f.calls.push("cleanup");
    f.state.cleanup = "partial";
    throw new Error("synthetic partial cleanup");
  };
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "cleanup-outcome-unknown",
  );
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "cleanup-state-unknown",
  );
  expect(f.calls.filter((call) => call === "cleanup")).toHaveLength(1);
  expect(f.calls.filter((call) => call === "policy")).toHaveLength(1);
});

it.each(["gate-4", "draft-ISS-074"])(
  "refuses a saved merge when the %s prerequisite receipt is absent",
  async (missing) => {
    const f = await fixture();
    await deliveryStep(f.config, f.adapter, f.policy);
    await Promise.all([
      rm(resolve(f.config.stateDirectory, "cleanup.json")),
      rm(resolve(f.config.stateDirectory, `${missing}.json`)),
    ]);
    f.calls.length = 0;
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "incomplete-merge-prerequisites",
    );
    expect(f.calls).toEqual([]);
    expectNoProviderAction(f.calls);
  },
);

it("refuses completed status when a required phase receipt is absent", async () => {
  const f = await fixture();
  await deliveryStep(f.config, f.adapter, f.policy);
  await rm(resolve(f.config.stateDirectory, "gate-2.json"));
  f.calls.length = 0;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "incomplete-completed-delivery",
  );
  expect(f.calls).toEqual([]);
  expectNoProviderAction(f.calls);
});

it.each(["duplicate", "omitted"] as const)(
  "rejects a newly observed cleanup receipt with %s targets",
  async (mode) => {
    const f = await fixture();
    f.adapter.observeCleanup = async () => ({
      state: "confirmed",
      value: {
        worktrees:
          mode === "duplicate"
            ? [f.plan.cleanup.worktrees[0]!, f.plan.cleanup.worktrees[0]!]
            : [f.plan.cleanup.worktrees[0]!],
        branch: f.plan.cleanup.branch,
      },
    });
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "malformed-cleanup-receipt",
    );
  },
);

it.each(["duplicate", "omitted"] as const)(
  "rejects a restarted completed delivery with %s cleanup targets",
  async (mode) => {
    const f = await fixture();
    await deliveryStep(f.config, f.adapter, f.policy);
    await writeFile(
      resolve(f.config.stateDirectory, "cleanup.json"),
      JSON.stringify({
        head,
        worktrees:
          mode === "duplicate"
            ? [f.plan.cleanup.worktrees[0]!, f.plan.cleanup.worktrees[0]!]
            : [f.plan.cleanup.worktrees[0]!],
        branch: f.plan.cleanup.branch,
      }),
    );
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
      "malformed-completed-delivery",
    );
  },
);

it("rejects cleanup plans that include the surviving controller checkout", async () => {
  const f = await fixture();
  f.plan.cleanup.worktrees = [f.config.controllerRoot, f.config.worktree];
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-cleanup-plan",
  );
  expect(f.calls.some((call) => call === "cleanup" || call === "publish")).toBe(false);
});

it.each([
  undefined,
  {},
  { schemaVersion: "unknown" },
  {
    schemaVersion: "dogfood-delivery-authority/v1",
    controller: "fixture-controller",
    run: "delivery-fixture",
    repository: "fixture/repository",
    controllerRevision: "c".repeat(40),
    head,
    actions: ["gates", "mirror", "publish", "merge"],
  },
  {
    schemaVersion: "dogfood-delivery-authority/v1",
    controller: "unknown-controller",
    run: "delivery-fixture",
    repository: "fixture/repository",
    controllerRevision: "c".repeat(40),
    head,
    actions: ["gates", "mirror", "publish", "merge", "cleanup"],
  },
  {
    schemaVersion: "dogfood-delivery-authority/v1",
    controller: "   ",
    run: "delivery-fixture",
    repository: "fixture/repository",
    controllerRevision: "c".repeat(40),
    head,
    actions: ["gates", "mirror", "publish", "merge", "cleanup"],
  },
])("rejects unknown or malformed controller authority", async (authority) => {
  const f = await fixture();
  f.config.authority = authority as never;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "unauthorized-delivery",
  );
  expect(f.calls.filter((call) => call !== "source")).toEqual([]);
  await expect(
    readFile(resolve(f.config.stateDirectory, "delivery-config.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  ["null run", "run", "run", null, "invalid-run"],
  ["false run", "run", "run", false, "invalid-run"],
  ["true run", "run", "run", true, "invalid-run"],
  ["numeric run", "run", "run", 42, "invalid-run"],
  ["array repository", "repository", "repository", ["fixture/repository"], "invalid-repository"],
  ["array candidate head", "candidateHead", "head", [head], "invalid-candidate-head"],
  [
    "array controller revision",
    "controllerRevision",
    "controllerRevision",
    ["c".repeat(40)],
    "invalid-controller-revision",
  ],
] as const)(
  "rejects %s despite matching authority",
  async (_case, field, authorityField, value, reason) => {
    const f = await fixture();
    (f.config as unknown as Record<string, unknown>)[field] = value;
    (f.config.authority as unknown as Record<string, unknown>)[authorityField] = value;
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(reason);
    expect(f.calls).toEqual([]);
  },
);

it("rejects authority issued for a different stable controller revision", async () => {
  const f = await fixture();
  f.config.authority.controllerRevision = "d".repeat(40);
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "unauthorized-delivery",
  );
  expect(f.calls).toEqual([]);
});

it("refuses candidate workspace drift before any gate or provider mutation", async () => {
  const f = await fixture();
  f.state.workspace = false;
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "candidate-workspace-drift",
  );
  expect(f.calls.some((call) => call.startsWith("gate:") || call === "publish")).toBe(false);
});

it("fails closed on a malformed external delivery record", async () => {
  const f = await fixture();
  await writeFile(resolve(f.config.stateDirectory, "delivery-config.json"), "not-json\n");
  await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(
    "malformed-record:delivery-config",
  );
  expect(f.calls).toEqual([]);
});

it.each([
  ["publication", "null", null, "malformed-publication-receipt"],
  ["publication", "false", false, "malformed-publication-receipt"],
  ["publication", "object-shape-invalid", {}, "malformed-publication-receipt"],
  ["hosted-checks", "null", null, "malformed-hosted-checks-record"],
  ["hosted-checks", "false", false, "malformed-hosted-checks-record"],
  ["hosted-checks", "object-shape-invalid", {}, "malformed-hosted-checks-record"],
  ["merge", "null", null, "malformed-merge-receipt"],
  ["merge", "false", false, "malformed-merge-receipt"],
  ["merge", "object-shape-invalid", {}, "malformed-merge-receipt"],
] as const)(
  "rejects present %s state containing %s before any provider action",
  async (name, _shape, value, reason) => {
    const f = await fixture();
    await writeState(f.config, name, value);
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(reason);
    expect(f.calls).toEqual([]);
    expectNoProviderAction(f.calls);
  },
);

it.each([
  ["gate-4", "null", null, "malformed-record:gate-4"],
  ["gate-4", "false", false, "malformed-record:gate-4"],
  ["gate-4", "object-shape-invalid", {}, "malformed-record:gate-4"],
  ["draft-ISS-074", "null", null, "malformed-record:draft-ISS-074"],
  ["draft-ISS-074", "false", false, "malformed-record:draft-ISS-074"],
  ["draft-ISS-074", "object-shape-invalid", {}, "malformed-record:draft-ISS-074"],
] as const)(
  "prevalidates a present %s %s receipt before gates, mirrors, or publication",
  async (name, _shape, value, reason) => {
    const f = await fixture();
    await writeState(f.config, name, value);
    await expect(deliveryStep(f.config, f.adapter, f.policy)).rejects.toThrow(reason);
    expect(f.calls).toEqual(["source", "policy"]);
    expectNoProviderAction(f.calls);
  },
);

it("accepts controller authority only from the external state directory", async () => {
  const f = await fixture();
  const external = resolve(f.config.stateDirectory, "delivery-request.json");
  const worker = resolve(f.config.worktree, "delivery-request.json");
  await Promise.all([writeFile(external, "{}\n"), writeFile(worker, "{}\n")]);
  await expect(assertControllerRequest(f.config, external)).resolves.toBeUndefined();
  await expect(assertControllerRequest(f.config, worker)).rejects.toThrow(
    "request-outside-controller-state",
  );
});

it("imports the portable delivery composition directly in Node 24", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import("./scripts/dogfood/delivery.mjs").then(m=>process.stdout.write(JSON.stringify([typeof m.deliveryStep,m.DELIVERY_AUTHORITY_SCHEMA])))',
    ],
    { cwd: resolve(import.meta.dirname, "../.."), windowsHide: true },
  );
  expect(JSON.parse(stdout)).toEqual(["function", "dogfood-delivery-authority/v1"]);
});
