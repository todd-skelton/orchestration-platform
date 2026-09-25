import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  bootstrap,
  discover,
  parseShard,
  partition,
  validatePartition,
  validateSelection,
} from "../scripts/verify/bootstrap.mjs";
import { aggregate, shards } from "../scripts/verify/windows-aggregate.mjs";
import { normalizeTrackedText } from "../scripts/tracked-text.mjs";

async function readSource(url: URL) {
  return normalizeTrackedText(await readFile(url, "utf8"));
}

const root = fileURLToPath(new URL("..", import.meta.url));
const workflow = await readSource(new URL("../.github/workflows/bootstrap.yml", import.meta.url));
const bootstrapSource = await readSource(
  new URL("../scripts/verify/bootstrap.mjs", import.meta.url),
);
const aggregateSource = await readSource(
  new URL("../scripts/verify/windows-aggregate.mjs", import.meta.url),
);
const roots: string[] = [];
const full = [
  "test/dogfood/refresh.test.ts",
  "test/dogfood/queue.test.ts",
  "test/dogfood/queue-adapter.test.ts",
  "test/dogfood/queue-post-merge.test.ts",
  "test/new.test.ts",
];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of roots.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function temporary() {
  const directory = await mkdtemp(resolve(tmpdir(), "bootstrap-control-"));
  roots.push(directory);
  return directory;
}

function jobBlock(text: string, key: string) {
  const block = text.match(new RegExp(`^  ${key}:\\r?\\n((?: {4}[^\\n]*\\n|\\r?\\n)*)`, "m"))?.[1];
  expect(block, key).toBeDefined();
  return block!;
}

function assertWorkflow(text: string) {
  const smoke = jobBlock(text, "smoke");
  expect(smoke).toContain("os: [ubuntu-latest, macos-latest]");
  expect(smoke).toContain("fail-fast: false");
  expect(smoke).toContain("name: Node 24 / ${{ matrix.os }}");
  expect(smoke).toMatch(/run: pnpm run verify:bootstrap\r?$/m);
  expect(smoke).not.toContain("--windows-shard");
  expect(text.match(/runs-on: windows-latest/g)).toHaveLength(3);
  expect(text.match(/name: Node 24 \/ windows-latest/g)).toHaveLength(1);
  expect(text).not.toMatch(
    /continue-on-error|maxWorkers|testTimeout|hookTimeout|workflow_dispatch/,
  );
  expect(text.split("jobs:")[0]).toContain("permissions:\n  contents: read");
  expect(text.match(/actions: read/g)).toHaveLength(1);
  for (const [key, name] of Object.entries(shards)) {
    const block = jobBlock(text, key);
    expect(block).toContain(`name: ${name}`);
    expect(block).toMatch(/^ {4}timeout-minutes: 100\r?$/m);
    expect(block).toContain(
      `run: pnpm run verify:bootstrap --windows-shard ${key.replace("windows_", "")}`,
    );
    for (const setup of [
      "actions/checkout@",
      "actions/setup-node@",
      "node-version: 24",
      "corepack enable",
      "corepack prepare pnpm@11.22.0 --activate",
      "corepack pnpm install --frozen-lockfile",
    ])
      expect(block).toContain(setup);
    expect(block).not.toContain("permissions:");
    expect(block).toContain("actions/upload-artifact@");
    expect(block).toContain("${{ github.run_id }}-${{ github.run_attempt }}");
    expect(block).toContain("${{ runner.temp }}/bootstrap-");
  }
  const windows = jobBlock(text, "windows");
  expect(windows).toContain(`needs: [${Object.keys(shards).join(", ")}]`);
  expect(windows).toContain("if: ${{ always() }}");
  expect(windows).toContain("runs-on: ubuntu-latest");
  expect(windows).toContain("timeout-minutes: 5");
  expect(windows).toContain("permissions:\n      actions: read\n      contents: read");
  expect(windows).toContain("run: node scripts/verify/windows-aggregate.mjs");
  expect(windows).toContain("GH_TOKEN: ${{ github.token }}");
  expect(windows).toContain(
    "BOOTSTRAP_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}",
  );
  expect(windows).toContain("WINDOWS_NEEDS: ${{ toJSON(needs) }}");
}

it("bounds each bootstrap smoke matrix job to 100 minutes (ISS-206)", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/bootstrap.yml", import.meta.url),
    "utf8",
  );
  const smoke = workflow.match(/^  smoke:\r?\n((?: {4}[^\n]*\n|\r?\n)*)/m)?.[1];
  expect(smoke).toBeDefined();
  expect(smoke).toMatch(/^ {4}runs-on: .+\r?$/m);
  expect(smoke).toMatch(/^ {4}timeout-minutes: 100\r?$/m);
});

it("composes exactly three isolated Windows runners and one unchanged required aggregate", () => {
  assertWorkflow(workflow);
});

it("normalizes CRLF source reads for the same workflow and guard-bypass controls on Windows", async () => {
  const directory = await temporary();
  for (const [name, source] of [
    ["workflow.yml", workflow],
    ["bootstrap.mjs", bootstrapSource],
    ["aggregate.mjs", aggregateSource],
  ] as const) {
    const path = resolve(directory, name);
    await writeFile(path, source.replaceAll("\n", "\r\n"));
    const normalized = await readSource(pathToFileURL(path));
    expect(normalized).toBe(source);
    if (name === "workflow.yml") assertWorkflow(normalized);
  }
});

it.each([
  ["actions-read-removal", "      actions: read\n", ""],
  ["dependency-omission", "windows_queue, ", ""],
  ["always-removal", "\n    if: ${{ always() }}\n", "\n"],
  ["token-removal", "GH_TOKEN: ${{ github.token }}", "GH_TOKEN: absent"],
] as const)("kills workflow mutant %s", (_name, before, after) => {
  expect(workflow).toContain(before);
  expect(() => assertWorkflow(workflow.replace(before, after))).toThrow();
});

it("preserves no-argument defaults and rejects selectors rather than ignoring them", () => {
  expect(parseShard([])).toBeUndefined();
  for (const name of ["refresh", "queue", "remainder"])
    expect(parseShard(["--windows-shard", name])).toBe(name);
  for (const args of [
    ["queue"],
    ["--windows-shard"],
    ["--windows-shard", "unknown"],
    ["--windows-shard", "queue", "extra"],
  ])
    expect(() => parseShard(args)).toThrow("expected no arguments");
});

it.each([undefined, "refresh", "queue", "remainder"])(
  "bootstrap %s keeps ordered gates and before/after status",
  async (shard) => {
    vi.stubEnv("RUNNER_TEMP", "");
    const execute = vi.fn(async () => "");
    const sourceStatus = vi.fn(async () => "unchanged");
    const list = vi.fn(async (filters?: string[]) => filters ?? full);
    await bootstrap(shard ? ["--windows-shard", shard] : [], {
      execute,
      sourceStatus,
      list,
      launcher: { executable: "synthetic-pnpm", prefixArgs: ["prefix"] },
    });
    expect(execute.mock.calls).toEqual(
      ["format:check", "typecheck", "test", "planning:check"].map((gate) => [
        "synthetic-pnpm",
        [
          "prefix",
          "run",
          gate,
          ...(gate === "test" && shard
            ? partition(full)[shard as keyof ReturnType<typeof partition>]
            : []),
        ],
      ]),
    );
    expect(sourceStatus).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(shard ? 2 : 0);
  },
);

it("propagates gate/discovery failures and still checks source status", async () => {
  const launcher = { executable: "synthetic", prefixArgs: [] };
  const sourceStatus = vi.fn(async () => "same");
  await expect(
    bootstrap([], {
      launcher,
      sourceStatus,
      execute: async () => {
        throw new Error("gate failed");
      },
    }),
  ).rejects.toThrow("gate failed");
  expect(sourceStatus).toHaveBeenCalledTimes(2);
  await expect(
    bootstrap([], {
      launcher,
      execute: async () => "",
      sourceStatus: vi.fn().mockResolvedValueOnce("before").mockResolvedValueOnce("after"),
    }),
  ).rejects.toThrow("source status");
  await expect(
    bootstrap(["--windows-shard", "queue"], {
      launcher,
      sourceStatus,
      execute: async () => "",
      list: async () => {
        throw new Error("discovery failed");
      },
    }),
  ).rejects.toThrow("discovery failed");
});

// Mutate the actual source, never a second implementation of the guard.
async function mutant(source: string, before: string, after: string) {
  expect(source).toContain(before);
  const directory = await temporary();
  const file = resolve(directory, "mutant.mjs");
  await writeFile(
    file,
    source
      .replace(before, after)
      .replace(
        '"../pnpm-launcher.mjs"',
        JSON.stringify(pathToFileURL(resolve(root, "scripts/pnpm-launcher.mjs")).href),
      )
      .replace('resolve(dirname(fileURLToPath(import.meta.url)), "../..")', JSON.stringify(root)),
  );
  return import(/* @vite-ignore */ pathToFileURL(file).href);
}

it("kills each named partition guard bypass with unrelated inputs held valid", async () => {
  const controls = [
    {
      name: "unknown-selector",
      guard: '!["refresh", "queue", "remainder"].includes(args[1])',
      bypass: "false",
      check: (m: typeof import("../scripts/verify/bootstrap.mjs")) =>
        m.parseShard(["--windows-shard", "unknown"]),
    },
    {
      name: "missing-singleton",
      guard: "!files.includes(file)",
      bypass: "false",
      check: (m: typeof import("../scripts/verify/bootstrap.mjs")) =>
        m.partition(full.filter((f) => !f.endsWith("/queue.test.ts"))),
    },
    {
      name: "overlap",
      guard: "seen.has(file)",
      bypass: "false",
      check: (m: typeof import("../scripts/verify/bootstrap.mjs")) =>
        m.validatePartition(full, {
          ...partition(full),
          remainder: [...partition(full).remainder, full[1]!],
        }),
    },
    {
      name: "omission",
      guard: "seen.size !== full.length || full.some((file) => !seen.has(file))",
      bypass: "false",
      check: (m: typeof import("../scripts/verify/bootstrap.mjs")) =>
        m.validatePartition(full, {
          ...partition(full),
          remainder: partition(full).remainder.slice(1),
        }),
    },
    {
      name: "empty-selection",
      guard: "files.length === 0",
      bypass: "false",
      check: (m: typeof import("../scripts/verify/bootstrap.mjs")) =>
        m.validatePartition(full.slice(0, 2), partition(full.slice(0, 2))),
    },
    {
      name: "substring-filter",
      guard: "actual.length !== expected.length || actual.some((file) => !expected.includes(file))",
      bypass: "false",
      check: (m: typeof import("../scripts/verify/bootstrap.mjs")) =>
        m.validateSelection(
          [full[1]!],
          full.filter((f) => f.includes("queue")),
        ),
    },
  ];
  const original = { parseShard, partition, validatePartition, validateSelection };
  for (const control of controls) {
    expect(
      () => control.check(original as typeof import("../scripts/verify/bootstrap.mjs")),
      control.name,
    ).toThrow();
    const changed = await mutant(bootstrapSource, control.guard, control.bypass);
    // Removing this guard alone must admit the invalid input, not hit another refusal.
    expect(() => control.check(changed), control.name).not.toThrow();
    console.log(`killed partition mutant: ${control.name}`);
  }
});

it.each([false, true])(
  "derives new-file remainder and exclusions from real Vitest discovery, excluding queue substring siblings (directory alias: %s)",
  async (alias) => {
    const parent = await temporary();
    const target = resolve(parent, "target");
    await mkdir(target);
    const directory = alias ? resolve(parent, "alias") : target;
    if (alias) await symlink(target, directory, process.platform === "win32" ? "junction" : "dir");
    const config = (await readFile(resolve(root, "vitest.config.ts"), "utf8"))
      .replace(
        'import { defineConfig } from "vitest/config";',
        "const defineConfig = (value) => value;",
      )
      .replace(
        'include: ["test/**/*.test.ts"],',
        'include: ["test/**/*.test.ts"], exclude: ["**/excluded.test.ts"],',
      );
    await writeFile(resolve(directory, "vitest.config.mjs"), config);
    for (const file of [...full, "test/excluded.test.ts", "outside.test.ts"]) {
      await mkdir(dirname(resolve(directory, file)), { recursive: true });
      await writeFile(resolve(directory, file), "// discovery fixture\n");
    }
    const files = await discover([], directory);
    expect(files.sort()).toEqual([...full].sort());
    const selections = partition(files);
    validatePartition(files, selections);
    expect(selections.remainder).toContain("test/new.test.ts");
    const exactQueue = await discover(selections.queue, directory);
    expect(exactQueue).toEqual(["test/dogfood/queue.test.ts"]);
    validateSelection(selections.queue, exactQueue);
    const broadQueue = await discover(["queue"], directory);
    expect(broadQueue.sort()).toEqual(full.filter((file) => file.includes("queue")).sort());
    expect(() => validateSelection(selections.queue, broadQueue)).toThrow("exact shard selection");
  },
);

// Explicitly synthetic Actions identities throughout these composition controls.
function aggregateFixture(key?: string, outcome = "success", token = "synthetic-token") {
  assertWorkflow(workflow);
  const repository = "synthetic/bootstrap";
  const run = 710;
  const head = "a".repeat(40);
  const needs = Object.fromEntries(
    Object.keys(shards).map((id) => [id, { result: id === key ? outcome : "success" }]),
  );
  const jobs = Object.entries(shards).flatMap(([id, name], index) => {
    if (id === key && outcome === "missing") return [];
    return [
      {
        id: 810 + index,
        run_id: run,
        run_attempt: 2,
        head_sha: head,
        name,
        html_url: `https://github.com/${repository}/actions/runs/${run}/job/${810 + index}`,
        status: id === key && outcome === "pending" ? "in_progress" : "completed",
        conclusion: id === key ? (outcome === "pending" ? null : outcome) : "success",
      },
    ];
  });
  const logs: string[] = [];
  const requests: string[] = [];
  let unavailable = false;
  const request: typeof fetch = async (url, init) => {
    requests.push(String(url));
    if (String(url).includes("/jobs?")) return Response.json({ total_count: jobs.length, jobs });
    expect(new Headers(init?.headers).get("Authorization")).toBe(token ? `Bearer ${token}` : null);
    return unavailable || !token
      ? new Response("unavailable", { status: 403 })
      : new Response(
          "SYNTHETIC cancelled child progress and test diagnostic\n::warning::untrusted test output",
        );
  };
  return {
    jobs,
    needs,
    logs,
    requests,
    setUnavailable: () => {
      unavailable = true;
    },
    options: {
      env: {
        GITHUB_REPOSITORY: repository,
        GITHUB_RUN_ID: String(run),
        GITHUB_RUN_ATTEMPT: "2",
        BOOTSTRAP_HEAD: head,
        GH_TOKEN: token,
        WINDOWS_NEEDS: JSON.stringify(needs),
      },
      request,
      log: (line: string) => {
        logs.push(line);
      },
      pause: vi.fn(async () => {}),
    },
  };
}

it("accepts only all-green effective jobs, including retained successful failed-only-rerun shards", async () => {
  const f = aggregateFixture();
  f.jobs[0]!.run_attempt = 1;
  expect(await aggregate(f.options)).toBe(0);
  expect(f.requests).toEqual([
    "https://api.github.com/repos/synthetic/bootstrap/actions/runs/710/jobs?filter=latest&per_page=100&page=1",
  ]);
});

it.each(
  Object.keys(shards).flatMap((key) =>
    ["failure", "cancelled", "timed_out", "skipped", "missing", "pending"].map(
      (outcome) => [key, outcome] as const,
    ),
  ),
)("SYNTHETIC %s %s cannot certify Windows green and retains diagnostics", async (key, outcome) => {
  const f = aggregateFixture(key, outcome);
  expect(await aggregate(f.options)).toBe(1);
  const output = f.logs.join("\n");
  expect(output).toContain(
    `${shards[key]}: conclusion=${outcome === "pending" ? "in_progress" : outcome}`,
  );
  if (outcome === "missing") expect(output).toContain("job=missing url=unavailable");
  else {
    const job = f.jobs.find((job) => job.name === shards[key])!;
    expect(output).toContain(`job=${job.id} url=${job.html_url}`);
  }
  if (["cancelled", "timed_out"].includes(outcome)) {
    expect(output).toContain("SYNTHETIC cancelled child progress and test diagnostic");
    expect(output).toMatch(/::stop-commands::[^\n]+\nSYNTHETIC/);
  } else expect(f.requests).toHaveLength(1);
});

it.each(Object.keys(shards))(
  "SYNTHETIC %s unavailable/withheld-token cancelled logs remain explicit failures",
  async (key) => {
    for (const token of ["synthetic-token", ""]) {
      const f = aggregateFixture(key, "cancelled", token);
      f.setUnavailable();
      expect(await aggregate(f.options)).toBe(1);
      const job = f.jobs.find((job) => job.name === shards[key])!;
      expect(f.logs).toContain(`shard-log-unavailable:${shards[key]} job=${job.id}`);
      expect(f.requests.filter((url) => url.endsWith("/logs"))).toHaveLength(3);
      expect(f.options.pause).toHaveBeenCalledTimes(2);
    }
  },
);

it("kills named aggregate success and embedding bypass mutants independently", async () => {
  const ignoreNeeds = await mutant(
    aggregateSource,
    'needs[key]?.result === "success" &&\n      valid &&',
    "valid &&",
  );
  const ignoreJob = await mutant(
    aggregateSource,
    'job.status === "completed" &&\n      job.conclusion === "success"',
    "true",
  );
  const ignoreIdentity = await mutant(
    aggregateSource,
    'needs[key]?.result === "success" &&\n      valid &&',
    'needs[key]?.result === "success" &&',
  );
  const noEmbedding = await mutant(aggregateSource, "log(body);", 'log("embedding removed");');
  const missingAsSuccess = await mutant(
    aggregateSource,
    "if (green) continue;",
    "if (green || !job) continue;",
  );
  for (const key of Object.keys(shards)) {
    for (const outcome of ["failure", "cancelled", "timed_out", "skipped", "missing", "pending"]) {
      // Hold Actions jobs green to isolate needs; hold needs green to isolate jobs.
      const needsControl = aggregateFixture();
      needsControl.options.env.WINDOWS_NEEDS = JSON.stringify({
        ...needsControl.needs,
        [key]: { result: outcome },
      });
      expect(await aggregate(needsControl.options)).toBe(1);
      expect(await ignoreNeeds.aggregate(needsControl.options)).toBe(0);
      if (outcome !== "missing") {
        const jobControl = aggregateFixture(key, outcome);
        jobControl.options.env.WINDOWS_NEEDS = JSON.stringify(aggregateFixture().needs);
        expect(await aggregate(jobControl.options)).toBe(1);
        expect(await ignoreJob.aggregate(jobControl.options)).toBe(0);
      } else {
        const missing = aggregateFixture(key, "missing");
        missing.options.env.WINDOWS_NEEDS = JSON.stringify(aggregateFixture().needs);
        expect(await aggregate(missing.options)).toBe(1);
        expect(await missingAsSuccess.aggregate(missing.options)).toBe(0);
      }
    }
    const stale = aggregateFixture();
    stale.jobs.find((job) => job.name === shards[key])!.run_attempt = 3;
    expect(await aggregate(stale.options)).toBe(1);
    expect(await ignoreIdentity.aggregate(stale.options)).toBe(0);
    const f = aggregateFixture(key, "cancelled");
    expect(await noEmbedding.aggregate(f.options)).toBe(1);
    expect(() =>
      expect(f.logs.join("\n")).toContain("SYNTHETIC cancelled child progress and test diagnostic"),
    ).toThrow();
  }
  console.log(
    "killed aggregate mutants: needs-success-removal, job-success-removal, missing-job-as-success, identity-removal, embedding-removal",
  );
});

it("refuses incomplete job acquisition even when the first page contains all green shards", async () => {
  const f = aggregateFixture();
  let pages = 0;
  f.options.request = async () => {
    if (++pages === 1) return Response.json({ total_count: 1000, jobs: f.jobs });
    return new Response("SYNTHETIC acquisition failure", { status: 503 });
  };
  expect(await aggregate(f.options)).toBe(1);
  expect(f.logs.join("\n")).toContain("shard-jobs-unavailable");
});

it("kills a frozen remainder mutant when a newly discoverable file appears", async () => {
  const changed = await mutant(
    bootstrapSource,
    "remainder: files.filter((file) => !Object.values(singletons).includes(file))",
    'remainder: files.filter((file) => !Object.values(singletons).includes(file) && file !== "test/new.test.ts")',
  );
  expect(partition(full).remainder).toContain("test/new.test.ts");
  expect(() => expect(changed.partition(full).remainder).toContain("test/new.test.ts")).toThrow();
});

it("early workflow cancellation supplies no success; missing jobs cannot borrow old successes", async () => {
  for (const result of ["missing", "cancelled"]) {
    const f = aggregateFixture();
    f.jobs.length = 0;
    f.options.env.WINDOWS_NEEDS = JSON.stringify(
      Object.fromEntries(Object.keys(shards).map((key) => [key, { result }])),
    );
    expect(await aggregate(f.options)).toBe(1);
    for (const name of Object.values(shards))
      expect(f.logs.join("\n")).toContain(`${name}: conclusion=missing`);
  }
});

async function killedProgress(modulePath: string) {
  const directory = await temporary();
  const childFile = resolve(directory, "child.mjs");
  const markerFile = resolve(directory, "ready");
  await writeFile(
    childFile,
    `import { writeFileSync, writeSync } from 'node:fs';\nwriteSync(1, 'SYNTHETIC live progress\\n'); writeFileSync(${JSON.stringify(markerFile)}, 'ready');\nsetInterval(() => {}, 1000);`,
  );
  const parent = resolve(directory, "parent.mjs");
  await writeFile(
    parent,
    `import { run } from ${JSON.stringify(pathToFileURL(modulePath).href)}; await run(process.execPath, [${JSON.stringify(childFile)}]);`,
  );
  const child = spawn(process.execPath, [parent], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = once(child, "close");
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  try {
    // Readiness comes from the grandchild, not from output that a mutant buffers.
    await vi.waitFor(
      async () => {
        expect(await readFile(markerFile, "utf8")).toBe("ready");
      },
      { timeout: 10_000, interval: 25 },
    );
    await new Promise((done) => setTimeout(done, 100));
  } finally {
    if (process.platform === "win32")
      await promisify(execFile)("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid!, "SIGKILL");
    await closed;
  }
  return output;
}

it("streams progress before tree-kill; buffered-execFile mutant loses that same evidence", async () => {
  expect(await killedProgress(resolve(root, "scripts/verify/bootstrap.mjs"))).toContain(
    "SYNTHETIC live progress",
  );
  const directory = await temporary();
  const file = resolve(directory, "buffered-execFile.mjs");
  const start = bootstrapSource.indexOf("export function run(");
  const end = bootstrapSource.indexOf("export async function discover", start);
  expect(start).toBeGreaterThan(0);
  await writeFile(
    file,
    bootstrapSource
      .slice(0, start)
      .replace(
        '"../pnpm-launcher.mjs"',
        JSON.stringify(pathToFileURL(resolve(root, "scripts/pnpm-launcher.mjs")).href),
      ) +
      `export async function run(executable, args) { const result = await execFileAsync(executable, args); process.stdout.write(result.stdout); }\n` +
      bootstrapSource.slice(end),
  );
  expect(await killedProgress(file)).not.toContain("SYNTHETIC live progress");
  console.log("killed streaming mutant: buffered-execFile");
});
