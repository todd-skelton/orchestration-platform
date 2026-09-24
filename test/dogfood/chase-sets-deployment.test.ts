import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { afterMerge } from "../../adapters/chase-sets.mjs";
import type { DeliveryConfig } from "../../scripts/dogfood/delivery.js";

const transport = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => {
  const { promisify } = await import("node:util");
  return {
    ...(await original<typeof import("node:child_process")>()),
    execFile: Object.assign(() => {}, {
      [promisify.custom]: async (file: string, args: string[]) => ({
        stdout: transport(file, args),
        stderr: "",
      }),
    }),
  };
});

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "fixtures/iss184", name), "utf8");
const noDeployId = 35252785218;
const previousId = 35146653520;
const latestId = 35928467557;
const mergeCommit = "8a423dc955640fbd7f5075c8ea7de196a21da524";
const config = {
  repository: "chase-sets/chase-sets",
  issue: "https://github.com/chase-sets/chase-sets/issues/8041",
  requiredChecks: ["PR Required"],
  policy: {
    key: "cs-8041",
    number: 8041,
    title: "Recorded script delivery",
    sourceBranch: "codex/8041-script-delivery-g1",
  },
} as DeliveryConfig;
let runs: Record<number, any>;
let jobs: Record<number, any>;
let logs: Record<number, string>;
let selected: number[];
let historical: number[];
let stderr: ReturnType<typeof vi.spyOn>;
const hook = async (head = mergeCommit) =>
  afterMerge({ config, delivery: { mergeCommit: head } as never });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T04:08:17.687Z"));
  runs = {};
  jobs = {};
  for (const id of [noDeployId, previousId, latestId]) {
    runs[id] = JSON.parse(fixture(`run-${id}.json`));
    jobs[id] = JSON.parse(fixture(`run-${id}-attempt-1-jobs.json`));
  }
  logs = {
    105308935683: fixture("job-105308935683-resolve-release.log"),
    104965862128: fixture("job-104965862128-deploy-staging.log"),
    107410573331: fixture("job-107410573331-deploy-staging.log"),
  };
  selected = [noDeployId];
  historical = [latestId, noDeployId, previousId];
  transport.mockReset().mockImplementation((file: string, args: string[]) => {
    expect(file).toBe("gh");
    expect(args[0]).toBe("api");
    expect(args).toHaveLength(2); // Raw API, no --repo or gh run view transformation.
    const path = args[1]!;
    expect(path.startsWith("repos/chase-sets/chase-sets/actions/")).toBe(true);
    if (path.includes("/workflows/"))
      return JSON.stringify({
        total_count: (path.includes("head_sha=") ? selected : historical).length,
        workflow_runs: (path.includes("head_sha=") ? selected : historical).map((id) => runs[id]),
      });
    const job = /\/jobs\/(\d+)\/logs$/.exec(path);
    if (job) {
      if (!logs[Number(job[1])]) throw new Error("synthetic unavailable job log");
      return logs[Number(job[1])];
    }
    const run = /\/runs\/(\d+)(.*)$/.exec(path)!;
    const id = Number(run[1]);
    if (run[2]) {
      expect(run[2]).toBe(`/attempts/${runs[id].run_attempt}/jobs?per_page=100`);
      return JSON.stringify(jobs[id]);
    }
    return JSON.stringify(runs[id]);
  });
  stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("completes the recorded no-deploy run with all five cumulative paths and separately timestamped latest executed digest", async () => {
  const completion = hook().catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  expect(await completion).toBeUndefined();
  expect(new Date().toISOString()).toBe("2026-09-24T04:08:17.687Z");
  expect(vi.getTimerCount()).toBe(0);
  const accounting = JSON.parse(String(stderr.mock.calls[0]![0]));
  expect(accounting).toMatchObject({
    status: "not-required",
    deploymentLeg: "unexercised",
    reason: "scoped",
    mergeCommit,
    workflowId: 274293633,
    run: noDeployId,
    attempt: 1,
    job: 105308935683,
    step: { number: 7, name: "Resolve deployment scope" },
    scope: {
      deploy: "false",
      changed_files_json: JSON.stringify([
        "scripts/check-design-system-export-coverage.mjs",
        "scripts/check-design-system-export-coverage.test.mjs",
        "scripts/managed-postgres-authority-guard.mjs",
        "scripts/managed-postgres-authority-guard.test.mjs",
        "scripts/public-web-route-smoke-workflows.test.mjs",
      ]),
    },
    skipped: [
      { id: 105309304655, name: "Deploy Staging" },
      { id: 105309305484, name: "Build Release Image" },
      { id: 105309305553, name: "Deploy Production" },
    ],
    latestDeployment: {
      run: latestId,
      attempt: 1,
      job: 107410573331,
      step: 20,
      commit: "018aa861ae8809749cea1e44df6ca1c1e7ebe402",
      digest: "sha256:98449f54f521ecb7d00247c5531d5685910700e055ca0c5236ff9b039d3c4302",
      verifiedAt: "2026-09-23T22:33:33.3380581Z",
    },
  });
  expect(accounting.changedFiles).toHaveLength(5);
  expect(accounting.accounting).toContain("Historical workflow evidence");
});

it("reads the recorded previous executed deployment without attributing the script merge to that image", async () => {
  historical = [noDeployId, previousId];
  await hook();
  expect(JSON.parse(String(stderr.mock.calls[0]![0])).latestDeployment).toMatchObject({
    run: previousId,
    job: 104965862128,
    commit: "27b8602b2c007d9ead3ee87de86e3008c8d746d5",
    digest: "sha256:acbef604cbc01becdb7c308ba26f78731f8f4ea367ff11c47b6cdc9debf02fde",
  });
});

it("orders synthetic historical reruns by actual staging completion, not workflow creation", async () => {
  runs[latestId].created_at = "2026-09-15T00:00:00Z";
  await hook();
  expect(JSON.parse(String(stderr.mock.calls[0]![0])).latestDeployment.run).toBe(latestId);
});

it("finishes the synthetic historical census across pages without fetching obsolete job logs", async () => {
  const ordinary = transport.getMockImplementation()!;
  const census = [
    runs[latestId],
    ...Array.from({ length: 100 }, (_, index) => ({
      ...runs[previousId],
      id: index + 1,
    })),
  ];
  transport.mockImplementation((file, args) => {
    const path = args[1];
    if (path.includes("/workflows/") && !path.includes("head_sha=")) {
      const page = Number(/page=(\d+)$/.exec(path)![1]);
      return JSON.stringify({
        total_count: census.length,
        workflow_runs: census.slice((page - 1) * 100, page * 100),
      });
    }
    return ordinary(file, args);
  });
  await hook();
  expect(transport.mock.calls.some(([, args]) => args[1].endsWith("&page=2"))).toBe(true);
  expect(JSON.parse(String(stderr.mock.calls[0]![0])).latestDeployment.run).toBe(latestId);
});

// Every mutation below is synthetic; the recorded positive facts stay immutable.
const resolver = () => jobs[noDeployId].jobs.find((job: any) => job.name === "Resolve Release");
const staging = (id = noDeployId) =>
  jobs[id].jobs.find((job: any) => job.name === "Deploy Staging");
async function unresolved(diagnostic: string) {
  const result = hook().catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({
    reason: "deploy-not-verified",
    diagnostics: expect.stringContaining(diagnostic),
  });
  expect(stderr).not.toHaveBeenCalled();
}

it.each([
  [
    "skip-only missing resolver",
    () => {
      resolver().name = "Synthetic unrelated trigger";
    },
    "missing or duplicate Resolve Release",
  ],
  [
    "wrong scope step",
    () => {
      resolver().steps[0].name = "Synthetic unrelated step";
    },
    "Resolve deployment scope",
  ],
  [
    "failed scope step",
    () => {
      resolver().steps[0].conclusion = "failure";
    },
    "scope step did not succeed",
  ],
  [
    "wrong workflow",
    () => {
      runs[noDeployId].path = ".github/workflows/synthetic.yml";
    },
    "workflow/run identity",
  ],
  [
    "wrong repository",
    () => {
      runs[noDeployId].repository.full_name = "synthetic/foreign";
    },
    "workflow/run identity",
  ],
  [
    "wrong commit",
    () => {
      runs[noDeployId].head_sha = "f".repeat(40);
    },
    "release commit mismatch",
  ],
  [
    "mixed rerun job",
    () => {
      resolver().run_attempt = 2;
    },
    "mixed-attempt",
  ],
  [
    "missing build",
    () => {
      jobs[noDeployId].jobs.find((job: any) => job.name === "Build Release Image").name =
        "Synthetic unrelated skip";
    },
    "Build Release Image",
  ],
  [
    "inconsistent production",
    () => {
      jobs[noDeployId].jobs.find((job: any) => job.name === "Deploy Production").conclusion =
        "success";
    },
    "inconsistent no-deploy",
  ],
  [
    "unavailable log",
    () => {
      delete logs[105308935683];
    },
    "unavailable job log",
  ],
  [
    "unrelated JSON",
    () => {
      logs[105308935683] = logs[105308935683]!.replace(
        "node ./scripts/release-deployment-scope.mjs",
        "node ./scripts/synthetic-unrelated.mjs",
      );
    },
    "step log",
  ],
  [
    "wrong release argument",
    () => {
      logs[105308935683] = logs[105308935683]!.replace(
        `--release-commit "${mergeCommit}"`,
        `--release-commit "${"f".repeat(40)}"`,
      );
    },
    "scope release commit",
  ],
  [
    "truncated JSON",
    () => {
      logs[105308935683] = logs[105308935683]!.replace(/.*Z }\n/, "");
    },
    "JSON",
  ],
  [
    "duplicate JSON",
    () => {
      logs[105308935683] = logs[105308935683]!.replace(/(.*Z }\n)/, "$1$1");
    },
    "JSON",
  ],
  [
    "duplicate resolver key",
    () => {
      logs[105308935683] = logs[105308935683]!.replace(
        /^(.+Z   )"deploy": "false",/m,
        '$1"deploy": "true",\n$1"deploy": "false",',
      );
    },
    "ambiguous scope resolver JSON",
  ],
  [
    "missing latest staging job",
    () => {
      staging(latestId).name = "Synthetic unrelated job";
    },
    "historical staging job missing",
  ],
  [
    "missing latest digest",
    () => {
      logs[107410573331] = logs[107410573331]!.replace(
        "Z Verified immutable active release",
        "Z Synthetic unverified image",
      );
    },
    "executed digest",
  ],
  [
    "wrong latest digest commit",
    () => {
      logs[107410573331] = logs[107410573331]!.replace(
        /:018aa861ae8809749cea1e44df6ca1c1e7ebe402@/,
        `:${"f".repeat(40)}@`,
      );
    },
    "executed digest",
  ],
  [
    "missing latest image step",
    () => {
      staging(latestId).steps = [];
    },
    "latest staging image verification",
  ],
] as const)(
  "keeps synthetic %s unresolved for its own cause",
  async (_name, mutate, diagnostic) => {
    mutate();
    await unresolved(diagnostic);
  },
);

it("rejects a synthetic deploy=true resolver with skipped staging for that contradiction", async () => {
  logs[105308935683] = logs[105308935683]!.replace('"deploy": "false"', '"deploy": "true"');
  await expect(hook()).rejects.toMatchObject({ reason: "deploy-not-verified" });
  expect(vi.getTimerCount()).toBe(0);
  expect(transport.mock.calls.some(([, args]) => args[1].includes("jobs/105308935683/logs"))).toBe(
    true,
  );
});

it.each(["pending", "failure", "cancelled"])(
  "does not borrow an older green run for synthetic newer %s",
  async (status) => {
    const newer = structuredClone(runs[noDeployId]);
    newer.id = 999;
    newer.created_at = "2026-09-24T00:00:00Z";
    newer.status = status === "pending" ? "in_progress" : "completed";
    newer.conclusion = status === "pending" ? null : status;
    runs[999] = newer;
    selected.push(999);
    if (status === "pending") await unresolved("pending or absent");
    else await expect(hook()).rejects.toMatchObject({ reason: "deploy-not-verified" });
    expect(transport.mock.calls.some(([, args]) => args[1].includes("/logs"))).toBe(false);
  },
);

it.each(["success", "missing", "skipped", "failure"])(
  "retains executed-deploy verification behavior: %s",
  async (conclusion) => {
    selected = [previousId];
    if (conclusion === "missing") staging(previousId).steps = [];
    else staging(previousId).steps[0].conclusion = conclusion;
    if (conclusion === "success")
      await expect(hook(runs[previousId].head_sha)).resolves.toBeUndefined();
    else
      await expect(hook(runs[previousId].head_sha)).rejects.toMatchObject({
        reason: "deploy-not-verified",
      });
    expect(stderr).not.toHaveBeenCalled();
  },
);

it("rechecks the run attempt after acquiring raw scope evidence", async () => {
  const ordinary = transport.getMockImplementation()!;
  let observed = false;
  transport.mockImplementation((file, args) => {
    const result = ordinary(file, args);
    if (args[1].includes("jobs/105308935683/logs") && !observed) {
      observed = true;
      runs[noDeployId].run_attempt = 2;
    }
    return result;
  });
  const result = hook().catch((error: unknown) => error);
  // First observation cannot complete by mixing attempt-1 logs with attempt 2.
  await vi.advanceTimersByTimeAsync(0);
  expect(stderr).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ reason: "deploy-not-verified" });
});

it("refuses a synthetic pending rerun first seen in the final workflow selection", async () => {
  const ordinary = transport.getMockImplementation()!;
  let selections = 0;
  transport.mockImplementation((file, args) => {
    if (args[1].includes("head_sha=") && ++selections === 2) {
      runs[noDeployId].run_attempt = 2;
      runs[noDeployId].status = "in_progress";
      runs[noDeployId].conclusion = null;
    }
    return ordinary(file, args);
  });
  await unresolved("newer release run or attempt appeared");
});
