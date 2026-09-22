import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  WORKER_ENVIRONMENT_ALLOWLIST,
  WINDOWS_WORKER_ENVIRONMENT_ALLOWLIST,
  MAX_VERDICT_EXCERPT_LENGTH,
  authorTemporaryRoot,
  admitLaunch,
  codexAdapter,
  launchArguments,
  outputSchema,
  parseTrace,
  probePoolModel,
  probeProvider,
  verdictExcerpt,
  waitForProvider,
  DEFAULT_PROVIDER_OUTAGE_CEILING_MS,
  workerEnvironment,
} from "../../scripts/dogfood/dispatch-adapter.js";
import type { Adapter, Config, NativeDbIdentity } from "../../scripts/dogfood/flow.js";
import { QueueBlocked, workerPrompt } from "../../scripts/dogfood/flow.js";
import { queueStep } from "../../scripts/dogfood/queue.js";
import { sourceFailureFixture } from "./fixtures/source-failure.js";
import { parseReview } from "../../scripts/dogfood/repair-policy.mjs";
import { sourceReviewerReportPrompt } from "../../scripts/dogfood/repair-adapter.js";
import { MAX_TERMINAL_SUMMARY_LENGTH } from "../../scripts/dogfood/terminal-summary.mjs";
import overlengthReview from "./fixtures/iss-150-overlength.json" with { type: "json" };
import prefixedReview from "./fixtures/iss-150-prefixed.json" with { type: "json" };
import prefixedAuthor from "./fixtures/iss-177-prefixed-author.json" with { type: "json" };
import overlengthAuthor from "./fixtures/iss-183-overlength-author.json" with { type: "json" };
import fencedReview from "./fixtures/iss-198-fenced-review.json" with { type: "json" };
import longReview from "./fixtures/iss-198-overlength-review.json" with { type: "json" };
import {
  NATIVE_DB_REPLY_LIMIT,
  NATIVE_DB_REQUEST_LIMIT,
  createNativeDbAdmission,
  nativeDbProfileAdapter,
  validateNativeDbReply,
  validateNativeDbRequest,
} from "../../scripts/dogfood/supervise.mjs";

const id = "01a048fe-90c8-7cb3-8da5-938c1f5cb5f0",
  head = "b".repeat(40);
const config = {
  run: "trial",
  stateDirectory: resolve(tmpdir(), "unused-trial"),
  worktree: "/author",
  reviewWorktree: "/reviewer",
  author: { model: "test", effort: "low" },
  reviewer: { model: "test", effort: "high" },
  adapter: { kind: "codex-exec", executable: process.execPath },
} as Config;
const rows = [
  { type: "thread.started", thread_id: id },
  {
    type: "item.completed",
    item: {
      type: "agent_message",
      text: JSON.stringify({
        run: "trial",
        role: "reviewer",
        head,
        verdict: "PASS",
        findings: [],
        g0: "No simpler change is available.",
      }),
    },
  },
  { type: "turn.completed", usage: { input_tokens: 12, output_tokens: 8 } },
];
const trace = (events: unknown[] = rows) =>
  events.map((row) => JSON.stringify(row)).join("\n") + "\n";
type MutableFixture<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends object
        ? { -readonly [K in keyof T]: MutableFixture<T[K]> } & { extra?: unknown }
        : T;
it.each(["win32", "linux", "darwin"] as const)(
  "selects the observed native backend only on Windows (%s argument fixture)",
  (platform) => {
    for (const role of ["author", "reviewer"] as const) {
      const args = launchArguments(config, role, platform);
      expect(args.includes('windows.sandbox="elevated"')).toBe(platform === "win32");
      expect(args[args.indexOf("-s") + 1]).toBe(
        role === "author" ? "workspace-write" : "read-only",
      );
      expect(args).not.toContain("--add-dir");
    }
  },
);
const locationNames = [
  "APPDATA",
  "CODEX_HOME",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;
const startupNames = [
  "COMSPEC",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
  ...(process.platform === "win32" ? WINDOWS_WORKER_ENVIRONMENT_ALLOWLIST : []),
] as const;
const forbiddenNames = [
  "ANTHROPIC_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "AZURE_CLIENT_SECRET",
  "CODEX_APP_TOOLS_PIPE_PATH",
  "CODEX_CI",
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  "CODEX_PERMISSION_PROFILE",
  "CODEX_SESSION_ID",
  "CODEX_SHELL",
  "CODEX_THREAD_ID",
  "GH_ENTERPRISE_TOKEN",
  "GH_TOKEN",
  "GIT_ASKPASS",
  "GITHUB_ENTERPRISE_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "GITHUB_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NODE_OPTIONS",
  "NODE_V8_COVERAGE",
  "OPENAI_API_KEY",
  "SSH_AUTH_SOCK",
  "UNRELATED_CONTROLLER_SECRET",
];
const syntheticLocations = Object.fromEntries(
  locationNames.map((name) => [name, `synthetic-${name.toLowerCase()}-location`]),
);
function hostedParent() {
  const startup = Object.fromEntries(
    startupNames.flatMap((name) => {
      const source = Object.keys(process.env).find(
        (candidate) =>
          candidate === name || (process.platform === "win32" && candidate.toUpperCase() === name),
      );
      return source && process.env[source] !== undefined ? [[name, process.env[source]]] : [];
    }),
  );
  return {
    ...startup,
    ...syntheticLocations,
    ...Object.fromEntries(forbiddenNames.map((name) => [name, `synthetic-${name.toLowerCase()}`])),
    ...Object.fromEntries(
      forbiddenNames.map((name) => [name.toLowerCase(), `synthetic-${name.toLowerCase()}-alias`]),
    ),
    NODE_OPTIONS: "",
  };
}
function fixtureAssertion(parent: NodeJS.ProcessEnv, result?: string) {
  return {
    allowed: [
      ...WORKER_ENVIRONMENT_ALLOWLIST,
      ...(process.platform === "win32" ? WINDOWS_WORKER_ENVIRONMENT_ALLOWLIST : []),
    ],
    forbidden: forbiddenNames,
    locations: syntheticLocations,
    present: [...startupNames, ...locationNames].filter((name) => parent[name] !== undefined),
    ...(result ? { result } : {}),
  };
}
async function eventuallyRead(path: string) {
  for (let count = 0; count < 100; count++) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error("fixture-result-timeout");
}
async function assertFixture(path: string, boundary: "observer" | "worker") {
  const checks = JSON.parse(await eventuallyRead(path));
  // Only fixed boolean fields reach hosted logs, including evidence of the
  // single OS-generated macOS name. No environment keys or values are dumped.
  expect(checks).toEqual({
    locationsMatch: true,
    requiredNamesPresent: true,
    onlyAllowlistedNames: process.platform === "darwin" ? expect.any(Boolean) : true,
    onlyExpectedNames: true,
    forbiddenAbsent: true,
    runtimeMetadataPresent: process.platform === "darwin" ? expect.any(Boolean) : false,
  });
  console.log(JSON.stringify({ dogfoodEnvironmentFixture: { boundary, ...checks } }));
}
it("builds a new environment from the exact portable allowlist without changing its parent", () => {
  const allAllowed = Object.fromEntries(
    WORKER_ENVIRONMENT_ALLOWLIST.map((name) => [name, `synthetic-${name.toLowerCase()}`]),
  );
  const parent = {
    ...allAllowed,
    PATH: "synthetic-canonical-path",
    path: "synthetic-path-case-alias",
    home: "synthetic-home-case-alias",
    CODEX_HOME: "synthetic-codex-home",
    GH_TOKEN: "synthetic-gh-token",
    gh_token: "synthetic-gh-token-case-alias",
    GITHUB_TOKEN: "synthetic-github-token",
    github_token: "synthetic-github-token-case-alias",
    HTTP_PROXY: "synthetic-http-proxy",
    UNRELATED_CONTROLLER_SECRET: "synthetic-controller-secret",
    NODE_V8_COVERAGE: "synthetic-coverage",
    __CF_USER_TEXT_ENCODING: "synthetic-metadata-not-to-copy",
    LOGONSERVER: "synthetic-logonserver",
    SYSTEMDRIVE: "synthetic-systemdrive",
    USERDOMAIN: "synthetic-userdomain",
    USERNAME: "synthetic-username",
  };
  const before = { ...parent };
  expect(WORKER_ENVIRONMENT_ALLOWLIST).toEqual([
    "APPDATA",
    "CODEX_HOME",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "WINDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ]);
  expect(workerEnvironment(parent, "linux")).toEqual({
    ...allAllowed,
    CODEX_HOME: "synthetic-codex-home",
    PATH: "synthetic-canonical-path",
  });
  expect(workerEnvironment(parent, "darwin")).toEqual(workerEnvironment(parent, "linux"));
  expect(workerEnvironment(parent, "win32")).toEqual({
    ...allAllowed,
    CODEX_HOME: "synthetic-codex-home",
    PATH: "synthetic-canonical-path",
    LOGONSERVER: "synthetic-logonserver",
    SYSTEMDRIVE: "synthetic-systemdrive",
    USERDOMAIN: "synthetic-userdomain",
    USERNAME: "synthetic-username",
  });
  expect(WINDOWS_WORKER_ENVIRONMENT_ALLOWLIST).toEqual([
    "LOGONSERVER",
    "SYSTEMDRIVE",
    "USERDOMAIN",
    "USERNAME",
  ]);
  const child = workerEnvironment(parent);
  expect(child.NODE_V8_COVERAGE).toBeUndefined();
  expect(Object.keys(child)).not.toContain("NODE_V8_COVERAGE");
  expect(Object.getPrototypeOf(child)).toBeNull();
  expect(Object.isFrozen(child)).toBe(true);
  expect(workerEnvironment({ path: "synthetic-only-alias" }, "linux")).toEqual({});
  expect(workerEnvironment({ path: "synthetic-only-alias" }, "win32")).toEqual({
    PATH: "synthetic-only-alias",
  });
  expect(parent).toEqual(before);
});
it("uses distinct sandbox roles, finite stdin and exact output shape without ambient configuration", () => {
  const author = launchArguments(config, "author"),
    reviewer = launchArguments(config, "reviewer");
  expect(author).toContain("workspace-write");
  expect(author).not.toContain("--add-dir");
  expect(author).toContain("sandbox_workspace_write.exclude_slash_tmp=true");
  expect(author).toContain("sandbox_workspace_write.exclude_tmpdir_env_var=true");
  expect(author).toContain(
    `sandbox_workspace_write.writable_roots=[${JSON.stringify(authorTemporaryRoot(config))}]`,
  );
  expect(author.join("\n")).toContain(`TEMP=${JSON.stringify(authorTemporaryRoot(config))}`);
  expect(author.join("\n")).toContain(`TMP=${JSON.stringify(authorTemporaryRoot(config))}`);
  expect(author.join("\n")).toContain(`TMPDIR=${JSON.stringify(authorTemporaryRoot(config))}`);
  expect(author.join("\n")).toContain('COREPACK_ENABLE_NETWORK="0"');
  expect(author.join("\n").match(/TEMP=/g)).toHaveLength(1);
  expect(author.join("\n").match(/TMP=/g)).toHaveLength(1);
  expect(author.join("\n").match(/TMPDIR=/g)).toHaveLength(1);
  expect(author.join("\n").match(/COREPACK_ENABLE_NETWORK=/g)).toHaveLength(1);
  expect(author.join("\n")).not.toContain("PATH=");
  expect(reviewer).toContain("read-only");
  expect(reviewer).not.toContain("--add-dir");
  expect(reviewer).not.toContain("--ignore-user-config");
  expect(reviewer).toContain("--ignore-rules");
  expect(reviewer).toContain("--output-schema");
  expect(reviewer).toContain("sandbox_workspace_write.writable_roots=[]");
  expect(reviewer.some((argument) => argument.startsWith("shell_environment_policy.set="))).toBe(
    false,
  );
  expect(reviewer.at(-1)).toBe("-");
  expect(reviewer).not.toContain("--dangerously-bypass-approvals-and-sandbox");
});
it("rejects obsolete extra Git write configuration instead of exposing hooks/config to the source worker", () => {
  const unsafe = { ...config, adapter: { ...config.adapter, authorGitDirectory: "/shared/.git" } };
  expect(() => launchArguments(unsafe, "author")).toThrow("unsupported-adapter-configuration");
});
it("reads actual Codex event shape and retains usage as advisory data", () => {
  expect(parseTrace(trace(), true, "reviewer", config, id)).toEqual({
    id,
    head,
    status: "passed",
    usage: { input_tokens: 12, output_tokens: 8 },
    summary: JSON.stringify({
      run: "trial",
      role: "reviewer",
      head,
      verdict: "PASS",
      findings: [],
      g0: "No simpler change is available.",
    }),
  });
  expect(parseTrace(trace() + '{"partial":', false, "reviewer", config, id).status).toBe("running");
});
it.each(["PASS", "FAIL"])(
  "reads a completed %s report after transient reconnect errors",
  (verdict) => {
    // ISS-127 / #418: the reviewer recovered after five reconnect errors and returned FAIL.
    const report = { ...rows[1]!, item: { ...rows[1]!.item! } };
    report.item.text = JSON.stringify({ ...JSON.parse(report.item.text!), verdict });
    const recovered = [
      rows[0]!,
      ...Array.from({ length: 5 }, (_, index) => ({
        type: "error",
        message: `Reconnecting... ${index + 1}/5`,
      })),
      report,
      rows[2]!,
    ];
    expect(parseTrace(trace(recovered), true, "reviewer", config, id)).toMatchObject({
      id,
      head,
      status: verdict === "PASS" ? "passed" : "failed",
      summary: report.item.text,
      usage: rows[2]!.usage,
    });
    expect(parseTrace(trace(recovered), true, "reviewer", config, id, true).status).toBe("dead");
    expect(() =>
      parseTrace(trace([...recovered, { type: "turn.failed" }]), true, "reviewer", config, id),
    ).toThrow("missing-successful-terminal");
    expect(() =>
      parseTrace(trace(recovered.filter((row) => row !== report)), true, "reviewer", config, id),
    ).toThrow("malformed-worker-verdict");
    expect(() =>
      parseTrace(trace(recovered.filter((row) => row !== rows[2])), true, "reviewer", config, id),
    ).toThrow("missing-successful-terminal");
    expect(() => parseTrace(trace(recovered), true, "reviewer", config, "other")).toThrow(
      "attempt-identity-changed",
    );
    expect(() =>
      parseTrace(trace(recovered), true, "reviewer", { ...config, run: "other" }, id),
    ).toThrow("worker-verdict-identity-mismatch");
  },
);
it("classifies a failed turn or non-zero launcher exit as dead and keeps the last trace error", () => {
  const failed = trace([
    rows[0]!,
    { type: "turn.failed", error: { message: "upstream TLS handshake timed out" } },
  ] as typeof rows);
  expect(parseTrace(failed, true, "author", config, id)).toEqual({
    id,
    status: "dead",
    summary: "upstream TLS handshake timed out",
  });
  expect(parseTrace(failed, false, "author", config, id).status).toBe("dead");
  expect(
    parseTrace(
      trace([rows[0]!, { type: "error", message: "provider returned 503" }] as typeof rows),
      true,
      "author",
      config,
      id,
      true,
    ),
  ).toEqual({ id, status: "dead", summary: "provider returned 503", providerFailure: true });
  expect(parseTrace("", true, "author", config, id, true)).toEqual({ id, status: "dead" });
});
it.each([
  ["request to http://pool.test/v1/responses failed", true],
  ["provider returned HTTP 502", true],
  ["provider returned 5xx", true],
  ["stream disconnected before completion", true],
  ["process crashed", false],
  ["revoked token", false],
  ["HTTP 401", false],
  ["HTTP 429", false],
] as const)("classifies only the final error message: %s", (message, outage) => {
  const terminal = parseTrace(
    trace([
      rows[0],
      { type: "error", message: "HTTP 503" },
      { type: "turn.failed", error: { message } },
      { type: "progress", message: "HTTP 500 in an unrelated event" },
    ]),
    true,
    "author",
    config,
    id,
    true,
    "http://pool.test/v1",
  );
  expect(terminal.summary).toBe(message);
  expect(terminal.providerFailure ?? false).toBe(outage);
});
it("classifies an outage before bounding the diagnostic summary", () => {
  const terminal = parseTrace(
    trace([
      rows[0],
      {
        type: "error",
        message: `${"x".repeat(MAX_TERMINAL_SUMMARY_LENGTH + 100)} http://pool.test/v1/responses`,
      },
    ]),
    true,
    "author",
    config,
    id,
    true,
    "http://pool.test/v1",
  );
  expect(terminal.summary).toHaveLength(MAX_TERMINAL_SUMMARY_LENGTH);
  expect(terminal.providerFailure).toBe(true);
});
it("defaults provider waiting to thirty minutes", async () => {
  let now = 0;
  const statuses: object[] = [];
  await expect(
    waitForProvider(
      config,
      async () => {
        throw new Error("offline");
      },
      {
        now: () => now,
        pause: async (ms) => {
          now += ms;
        },
      },
      (status) => {
        statuses.push(status);
      },
    ),
  ).rejects.toMatchObject({ reason: "provider-unavailable", diagnostics: "offline" });
  expect(now).toBe(30 * 60_000);
  expect(DEFAULT_PROVIDER_OUTAGE_CEILING_MS).toBe(now);
  expect(statuses).toHaveLength(180);
});
it("aborts a hanging probe at the outage ceiling", async () => {
  vi.useFakeTimers();
  try {
    const pending = waitForProvider(
      { ...config, providerOutageCeilingMs: 20 },
      async (signal) => {
        await new Promise((_done, reject) =>
          signal.addEventListener("abort", () => reject(new Error("probe timed out")), {
            once: true,
          }),
        );
      },
      { now: Date.now, pause: async () => {} },
      () => {},
    );
    // AbortSignal.timeout uses native timers; leave the ceiling clock advanced.
    vi.setSystemTime(Date.now() + 20);
    await expect(pending).rejects.toMatchObject({
      reason: "provider-unavailable",
      diagnostics: "probe timed out",
    });
  } finally {
    vi.useRealTimers();
  }
});
it("admits a launch only when the pool has a ready account for the model", async () => {
  const signal = new AbortController().signal;
  const now = () => Date.parse("2026-09-16T19:00:00Z");
  const deadline = now() + 30 * 60_000;
  const status = (...accounts: unknown[]) =>
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ accounts }));
  const blocked = (until?: string) => ({ status: "blocked", next_retry_after: until });
  const probe = (request: typeof fetch) =>
    probePoolModel(
      "http://pool.test:8318/api/status",
      "gpt-6-astra",
      signal,
      deadline,
      request,
      now,
    );
  await expect(
    probe(
      status(
        { routingModels: { "gpt-6-astra": blocked("2026-09-19T08:13:52Z") } },
        { routingModels: { "gpt-6-astra": { status: "ready" } } },
      ),
    ),
  ).resolves.toBe(true);
  // A disabled account's readiness does not admit a launch.
  await expect(
    probe(
      status(
        { disabled: true, routingModels: { "gpt-6-astra": { status: "ready" } } },
        { routingModels: { "gpt-6-astra": blocked("2026-09-16T19:05:00Z") } },
      ),
    ),
  ).rejects.toThrow("pool blocks gpt-6-astra at every account until 2026-09-16T19:05:00.000Z");
  // Mentioned only by disabled accounts: no eligible account admits and no
  // known end exists, so the ordinary wait path, never success (review r2).
  for (const disabledOnly of [
    [{ disabled: true, routingModels: { "gpt-6-astra": { status: "ready" } } }],
    [
      { disabled: true, routingModels: { "gpt-6-astra": { status: "ready" } } },
      { disabled: true, routingModels: { "gpt-6-astra": blocked("2026-09-19T08:13:52Z") } },
      { routingModels: {} },
    ],
  ]) {
    let observed: unknown;
    await probe(status(...disabledOnly)).catch((error: unknown) => {
      observed = error;
    });
    expect(observed).toBeInstanceOf(Error);
    expect(observed).not.toMatchObject({ reason: "provider-model-refused" });
    expect((observed as Error).message).toBe("pool has no enabled account for gpt-6-astra");
  }
  // Unknown to the pool, or stale observations: the models probe alone decides.
  await expect(
    probe(
      status(
        { routingModels: {} },
        { disabled: false },
        { routingModels: { "gpt-5.6-sol": blocked("2026-09-19T08:13:52Z") } },
      ),
    ),
  ).resolves.toBeUndefined();
  await expect(probe(status())).resolves.toBeUndefined();
  // Inside the deadline the block waits like an outage; beyond it, a refusal.
  await expect(
    probe(
      status(
        { routingModels: { "gpt-6-astra": blocked("2026-09-16T19:29:59Z") } },
        { routingModels: { "gpt-6-astra": blocked("2026-09-19T08:13:52Z") } },
      ),
    ),
  ).rejects.toThrow("until 2026-09-16T19:29:59.000Z");
  await expect(
    probe(
      status(
        { routingModels: { "gpt-6-astra": blocked("2026-09-16T19:30:01Z") } },
        { routingModels: { "gpt-6-astra": blocked("2026-09-19T08:13:52Z") } },
      ),
    ),
  ).rejects.toMatchObject({
    reason: "provider-model-refused",
    diagnostics: "pool blocks gpt-6-astra at every account until 2026-09-16T19:30:01.000Z",
  });
  // A past, absent or unparsable reset is a block without a known end. Even
  // beside a long known one it is uncertainty, never a refusal (review F1).
  for (const uncertain of [blocked("2026-09-16T18:00:00Z"), blocked(), blocked("soon")]) {
    let observed: unknown;
    await probe(
      status(
        { routingModels: { "gpt-6-astra": uncertain } },
        { routingModels: { "gpt-6-astra": blocked("2026-09-19T08:13:52Z") } },
      ),
    ).catch((error: unknown) => {
      observed = error;
    });
    expect(observed).toBeInstanceOf(Error);
    expect(observed).not.toMatchObject({ reason: "provider-model-refused" });
    expect((observed as Error).message).toBe("pool blocks gpt-6-astra at every account");
  }
  // Every consumed field is validated; a malformed row waits rather than
  // admitting as "unmentioned" (review F1).
  for (const payload of [
    null,
    {},
    { accounts: {} },
    "accounts",
    { accounts: [42] },
    { accounts: [null] },
    { accounts: [[]] },
    { accounts: [{ disabled: "yes" }] },
    { accounts: [{ routingModels: [] }] },
    { accounts: [{ routingModels: { "gpt-6-astra": "ready" } }] },
    { accounts: [{ routingModels: { "gpt-6-astra": { status: "idle" } } }] },
    {
      accounts: [{ routingModels: { "gpt-6-astra": { status: "blocked", next_retry_after: 5 } } }],
    },
    { accounts: [{ disabled: true, routingModels: { "gpt-6-astra": { status: "later" } } }] },
    { accounts: [{ routingModels: { "gpt-6-astra": { status: "ready" } } }, 42] },
  ]) {
    await expect(
      probe(vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))),
    ).rejects.toThrow("malformed pool status response");
  }
  const failing = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
  await expect(probe(failing)).rejects.toThrow("pool status probe returned HTTP 503");
  expect(failing).toHaveBeenCalledWith("http://pool.test:8318/api/status", { signal });
});
it.skipIf(process.platform === "win32")(
  "composes the models and pool probes under one wait deadline",
  async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "launch-admission-")));
    cleanup.push(root);
    const helper = resolve(root, "auth.sh");
    await writeFile(helper, '#!/bin/sh\nprintf "test-provider-key\\n"\n', { mode: 0o700 });
    const environment = {
      CODEX_PROVIDER_BASE_URL: "http://pool.test/v1",
      CODEX_PROVIDER_AUTH_COMMAND: helper,
      CODEX_POOL_STATUS_URL: "http://pool.test:8318/api/status",
    };
    const start = Date.parse("2026-09-16T19:00:00Z");
    const admission = { ...config, providerOutageCeilingMs: 30 * 60_000 };
    const models = Response.json({ data: [{ id: "test" }] });
    const blockedUntil = (until: string) =>
      Response.json({
        accounts: [{ routingModels: { test: { status: "blocked", next_retry_after: until } } }],
      });
    const run = (respond: (url: string, elapsedMs: number) => Response) => {
      let now = start;
      const statuses: object[] = [];
      const request = vi.fn<typeof fetch>(async (input) => respond(String(input), now - start));
      return {
        request,
        statuses,
        done: admitLaunch(
          admission,
          "author",
          environment,
          request,
          {
            now: () => now,
            pause: async (ms) => {
              now += ms;
            },
          },
          (status) => {
            statuses.push(status);
          },
        ),
      };
    };
    // Status unavailable for twenty minutes, then a reset outside the original
    // thirty-minute deadline: a refusal, not a second timeout (review F2).
    const late = run((url, elapsed) =>
      url.endsWith("/models")
        ? models.clone()
        : elapsed < 20 * 60_000
          ? new Response(null, { status: 503 })
          : blockedUntil("2026-09-16T19:45:00Z"),
    );
    await expect(late.done).rejects.toMatchObject({
      reason: "provider-model-refused",
      diagnostics: "pool blocks test at every account until 2026-09-16T19:45:00.000Z",
    });
    expect(late.statuses.length).toBe(120);
    expect(late.request.mock.calls.map(([url]) => String(url)).slice(0, 2)).toEqual([
      "http://pool.test:8318/api/status",
      "http://pool.test:8318/api/status",
    ]);
    // A reset just inside the remaining deadline waits, then admits once ready.
    const early = run((url, elapsed) =>
      url.endsWith("/models")
        ? models.clone()
        : elapsed < 20 * 60_000
          ? new Response(null, { status: 503 })
          : elapsed < 29 * 60_000
            ? blockedUntil("2026-09-16T19:29:00Z")
            : Response.json({ accounts: [{ routingModels: { test: { status: "ready" } } }] }),
    );
    await expect(early.done).resolves.toBeUndefined();
    expect(early.statuses.at(-1)).toMatchObject({
      status: "waiting-provider",
      diagnostics: "pool blocks test at every account until 2026-09-16T19:29:00.000Z",
    });
    // The ceiling itself is unchanged: never-ready status exhausts it.
    const never = run((url) =>
      url.endsWith("/models") ? models.clone() : blockedUntil("2026-09-16T19:10:00Z"),
    );
    await expect(never.done).rejects.toMatchObject({ reason: "provider-unavailable" });
    // Pool status is read first; an unmentioned model still lets the catalog refuse.
    const refused = run((url) =>
      url.endsWith("/models")
        ? Response.json({ data: [{ id: "other" }] })
        : Response.json({ accounts: [{ routingModels: {} }] }),
    );
    await expect(refused.done).rejects.toMatchObject({
      reason: "provider-model-refused",
      diagnostics: "models catalog omitted test; catalog head: other",
    });
    expect(refused.request.mock.calls.map(([url]) => String(url))).toEqual([
      "http://pool.test:8318/api/status",
      "http://pool.test/v1/models",
    ]);
    // Without a status URL the models probe alone admits.
    const { CODEX_POOL_STATUS_URL: _unused, ...withoutStatus } = environment;
    const request = vi.fn<typeof fetch>(async () => models.clone());
    await expect(admitLaunch(admission, "author", withoutStatus, request)).resolves.toBeUndefined();
    expect(request.mock.calls.every(([url]) => String(url).endsWith("/models"))).toBe(true);
    // Without provider configuration nothing is probed.
    const idle = vi.fn<typeof fetch>();
    await expect(admitLaunch(admission, "author", {}, idle)).resolves.toBeUndefined();
    expect(idle).not.toHaveBeenCalled();
  },
);
it.skipIf(process.platform === "win32").each(["ready", "unmentioned", "blocked"])(
  "ISS-197 retains native admission and refusal accounting when the pool model is %s",
  async (poolVerdict) => {
    const f = await sourceFailureFixture();
    cleanup.push(f.root);
    const helper = resolve(f.root, "auth.sh");
    await writeFile(helper, '#!/bin/sh\nprintf "test-provider-key\\n"\n', { mode: 0o700 });
    const environment = {
      CODEX_PROVIDER_BASE_URL: "http://pool.test/v1",
      CODEX_PROVIDER_AUTH_COMMAND: helper,
      CODEX_POOL_STATUS_URL: "http://pool.test:8318/api/status",
    };
    // Captured shape: the only non-image OpenAI entries omit Astra; three
    // Codex accounts block it and one enabled account can still serve it.
    const catalog = [
      { id: "gpt-5.5", owned_by: "openai" },
      { id: "codex-auto-review", owned_by: "openai" },
      { id: "claude-fable-5-1", owned_by: "anthropic" },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `fixture-${i}`, owned_by: "anthropic" })),
    ];
    const blockedAccounts = [22, 23, 24].map((day) => ({
      disabled: false,
      routingModels: {
        "gpt-6-astra": { status: "blocked", next_retry_after: `2026-09-${day}T00:00:00Z` },
      },
    }));
    const request = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/models")
        ? Response.json({ data: catalog })
        : Response.json({
            accounts:
              poolVerdict === "unmentioned"
                ? [{ routingModels: {} }]
                : [
                    ...blockedAccounts,
                    ...(poolVerdict === "ready"
                      ? [{ disabled: false, routingModels: { "gpt-6-astra": { status: "ready" } } }]
                      : []),
                  ],
          }),
    );
    const clock = { now: () => Date.parse("2026-09-20T16:53:19Z"), pause: vi.fn() };
    const report = vi.fn();
    const launch = f.native.launch;
    const launchedRungs: number[] = [];
    f.native.launch = async (role, current, prompt) => {
      await admitLaunch(current, role, environment, request, clock, report);
      launchedRungs.push(current.author.rung!);
      return launch(role, current, prompt);
    };
    f.setAuthorStatus("running");
    const q = await f.compose(f.cycle);
    await expect(queueStep(q.config, q.adapter)).resolves.toMatchObject({
      status: "observing-author",
    });
    const path = resolve(q.config.stateDirectory, "attempt.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    const source = q.config.items[0]!.source.stateDirectory;
    const ids = [`${source}:probe:0`, `${source}:probe:1`];
    expect(launchedRungs).toEqual([poolVerdict === "ready" ? 0 : 2]);
    if (poolVerdict === "ready") {
      expect(saved.authorFailures).toEqual({ count: 0, ids: [] });
      expect(request.mock.calls.map(([url]) => String(url))).toEqual([
        environment.CODEX_POOL_STATUS_URL,
        `${environment.CODEX_PROVIDER_BASE_URL}/models`,
      ]);
      expect(request.mock.calls[1]![1]).toEqual({
        headers: { Authorization: "Bearer test-provider-key" },
        signal: request.mock.calls[0]![1]!.signal,
      });
    } else {
      expect(saved.authorFailures.count).toBe(2);
      expect(saved.authorFailures.ids).toEqual(ids);
      expect(Object.keys(saved.authorFailures.diagnostics)).toEqual(ids);
      for (const id of ids) {
        const diagnostic = saved.authorFailures.diagnostics[id] as string;
        expect(diagnostic.length).toBeLessThanOrEqual(200);
        if (poolVerdict === "unmentioned") {
          expect(diagnostic).toMatch(/^models catalog omitted gpt-6-astra; catalog head: /);
          expect(diagnostic).toContain("gpt-5.5, codex-auto-review, claude-fable-5-1");
          expect(diagnostic.split("catalog head: ")[1]!.split(", ")).toHaveLength(10);
          expect(diagnostic).toContain("fixture-6");
          expect(diagnostic).not.toContain("fixture-7");
        } else {
          expect(diagnostic).toBe(
            "pool blocks gpt-6-astra at every account until 2026-09-22T00:00:00.000Z",
          );
        }
      }
    }
    expect(clock.pause).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    // Resume keeps each diagnostic with its identity, without charging or probing again.
    const requests = request.mock.calls.length;
    const resumed = await f.compose(f.cycle);
    await expect(queueStep(resumed.config, resumed.adapter)).resolves.toMatchObject({
      status: "observing-author",
    });
    expect(JSON.parse(await readFile(path, "utf8")).authorFailures).toEqual(saved.authorFailures);
    expect(request).toHaveBeenCalledTimes(requests);
  },
);
it.skipIf(process.platform === "win32")(
  "keeps pool-ready admissions authenticated and validates the catalog body for both roles",
  async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "pool-ready-auth-")));
    cleanup.push(root);
    const helper = resolve(root, "auth.sh");
    const environment = {
      CODEX_PROVIDER_BASE_URL: "http://pool.test/v1/",
      CODEX_PROVIDER_AUTH_COMMAND: helper,
      CODEX_POOL_STATUS_URL: "http://pool.test:8318/api/status",
    };
    for (const role of ["author", "reviewer"] as const) {
      for (const failure of ["none", "auth", "http", "body", "entry"]) {
        await writeFile(
          helper,
          failure === "auth" ? "#!/bin/sh\nexit 1\n" : '#!/bin/sh\nprintf "fresh-key\\n"\n',
          { mode: 0o700 },
        );
        const request = vi.fn<typeof fetch>(async (input) => {
          if (String(input).endsWith("/api/status"))
            return Response.json({ accounts: [{ routingModels: { test: { status: "ready" } } }] });
          if (failure === "http") return new Response(null, { status: 503 });
          return Response.json(
            failure === "body" ? {} : failure === "entry" ? { data: [{}] } : { data: [] },
          );
        });
        let now = 0;
        const pauses: number[] = [];
        const statuses: object[] = [];
        const admission = admitLaunch(
          { ...config, providerOutageCeilingMs: 10_000 },
          role,
          environment,
          request,
          {
            now: () => now,
            pause: async (ms) => {
              pauses.push(ms);
              now += ms;
            },
          },
          (status) => {
            statuses.push(status);
          },
        );
        if (failure === "none") {
          await expect(admission).resolves.toBeUndefined();
          expect(pauses).toEqual([]);
          expect(statuses).toEqual([]);
        } else {
          const diagnostics =
            failure === "auth"
              ? "provider authentication command failed"
              : failure === "http"
                ? "provider models probe returned HTTP 503"
                : "malformed provider models response";
          await expect(admission).rejects.toMatchObject({
            reason: "provider-unavailable",
            diagnostics,
          });
          expect(pauses).toEqual([10_000]);
          expect(statuses).toEqual([
            { status: "waiting-provider", run: config.run, issue: config.issue, diagnostics },
          ]);
        }
        expect(request).toHaveBeenCalledTimes(failure === "auth" ? 1 : 2);
        if (failure !== "auth")
          expect(request.mock.calls[1]).toEqual([
            "http://pool.test/v1/models",
            {
              headers: { Authorization: "Bearer fresh-key" },
              signal: request.mock.calls[0]![1]!.signal,
            },
          ]);
      }
    }
    // Refusal diagnostics bound both the count of ids and the total text.
    for (const ids of [Array.from({ length: 12 }, (_, i) => `m${i}`), ["x".repeat(300)]]) {
      const request = vi.fn<typeof fetch>(async () =>
        Response.json({ data: ids.map((id) => ({ id })) }),
      );
      const error = (await probeProvider(
        "http://pool.test/v1",
        helper,
        new AbortController().signal,
        request,
        "test",
      ).catch((error: unknown) => error)) as { reason: string; diagnostics: string };
      expect(error.reason).toBe("provider-model-refused");
      expect(error.diagnostics.length).toBeLessThanOrEqual(200);
      expect(error.diagnostics.split("catalog head: ")[1]!.split(", ").length).toBeLessThanOrEqual(
        10,
      );
      if (ids.length === 12) {
        expect(error.diagnostics).toBe(
          "models catalog omitted test; catalog head: m0, m1, m2, m3, m4, m5, m6, m7, m8, m9",
        );
      } else expect(error.diagnostics).toHaveLength(200);
    }
  },
);
it.skipIf(process.platform === "win32")(
  "uses the worker auth helper for every models probe and rejects HTTP errors",
  async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "provider-probe-")));
    cleanup.push(root);
    const helper = resolve(root, "auth.sh");
    for (const name of [
      ...forbiddenNames,
      "CODEX_PROVIDER_BASE_URL",
      "CODEX_PROVIDER_AUTH_COMMAND",
    ])
      vi.stubEnv(name, undefined);
    await writeFile(
      helper,
      '#!/bin/sh\nprintf "test-provider-key\\n" >> "$0.invoked"\nprintf "test-provider-key\\n"\n',
      { mode: 0o700 },
    );
    let requests = 0;
    const request = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      // A normally exiting child must run before HTTP, without a timing budget.
      expect(await readFile(`${helper}.invoked`, "utf8")).toBe("test-provider-key\n");
      expect(requests).toBe(0);
      requests += 1;
      return new Response(null, { status: 503 });
    });
    const signal = new AbortController().signal;
    await expect(probeProvider("http://pool.test/v1/", helper, signal, request)).rejects.toThrow(
      "HTTP 503",
    );
    expect(request).toHaveBeenCalledWith("http://pool.test/v1/models", {
      headers: { Authorization: "Bearer test-provider-key" },
      signal,
    });
    expect(requests).toBe(1);
    await writeFile(
      helper,
      '#!/bin/sh\nprintf "refreshed-key\\n" >> "$0.invoked"\nprintf "refreshed-key\\n"\n',
    );
    request.mockResolvedValue(new Response(null, { status: 200 }));
    await probeProvider("http://pool.test/v1", helper, signal, request);
    expect(request).toHaveBeenLastCalledWith("http://pool.test/v1/models", {
      headers: { Authorization: "Bearer refreshed-key" },
      signal,
    });
    request.mockResolvedValueOnce(Response.json({ data: [{ id: "claude-opus-5" }] }));
    await expect(
      probeProvider("http://pool.test/v1", helper, signal, request, "claude-opus-5"),
    ).resolves.toBeUndefined();
    request.mockResolvedValueOnce(Response.json({ data: [{ id: "gpt-5.6-sol" }] }));
    await expect(
      probeProvider("http://pool.test/v1", helper, signal, request, "claude-opus-5"),
    ).rejects.toMatchObject({ reason: "provider-model-refused" });
    request.mockResolvedValueOnce(Response.json({ error: "temporary provider failure" }));
    await expect(
      probeProvider("http://pool.test/v1", helper, signal, request, "claude-opus-5"),
    ).rejects.toThrow("malformed provider models response");
    for (const payload of [
      null,
      { data: [{}] },
      { data: [null] },
      { data: ["gpt-5.6-sol"] },
      { data: [{ id: 42 }] },
      { data: [{ id: "" }] },
      { data: [{ id: "   " }] },
      { data: [{ id: "gpt-5.6-sol" }, {}] },
      { data: [{ id: "claude-opus-5" }, {}] },
    ]) {
      request.mockResolvedValueOnce(Response.json(payload));
      await expect(
        probeProvider("http://pool.test/v1", helper, signal, request, "claude-opus-5"),
      ).rejects.toThrow("malformed provider models response");
    }
    request.mockResolvedValueOnce(Response.json({ data: [] }));
    await expect(
      probeProvider("http://pool.test/v1", helper, signal, request, "claude-opus-5"),
    ).rejects.toMatchObject({ reason: "provider-model-refused" });
    request.mockResolvedValueOnce(Response.json({ data: [{}] }));
    const requestsBeforeMalformed = request.mock.calls.length;
    const malformed = await probeProvider(
      "http://pool.test/v1",
      helper,
      signal,
      request,
      "claude-opus-5",
    ).catch((error: unknown) => error);
    expect(malformed).toEqual(new Error("malformed provider models response"));
    expect(request.mock.calls.length - requestsBeforeMalformed).toBe(1);
    expect(await readFile(`${helper}.invoked`, "utf8")).toBe(
      "test-provider-key\n" + "refreshed-key\n".repeat(request.mock.calls.length - 1),
    );
    for (const [, options] of request.mock.calls.slice(1)) {
      expect(options).toEqual({ headers: { Authorization: "Bearer refreshed-key" }, signal });
    }
    // ISS-156: replay the observed error through the existing probe seam. The
    // logical outage clock must not impose a real deadline on auth startup.
    let now = 0;
    const waits: number[] = [];
    await expect(
      waitForProvider(
        { ...config, providerOutageCeilingMs: 10 },
        async () => {
          throw malformed;
        },
        {
          now: () => now,
          pause: async (ms) => {
            waits.push(ms);
            now += ms;
          },
        },
        () => {},
      ),
    ).rejects.toMatchObject({
      reason: "provider-unavailable",
      diagnostics: "malformed provider models response",
    });
    expect(waits).toEqual([10]);
    expect(request.mock.calls.length - requestsBeforeMalformed).toBe(1);
  },
);
it("retains exact reviewer reports and rejects oversized or obsolete output", () => {
  const verdict = (g0: unknown, extra: Record<string, unknown> = {}) =>
    trace([
      rows[0]!,
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: JSON.stringify({
            run: "trial",
            role: "reviewer",
            head,
            verdict: "PASS",
            findings: [],
            g0,
            ...extra,
          }),
        },
      },
      rows[2]!,
    ]);
  expect(
    JSON.parse(parseTrace(verdict("simplest"), true, "reviewer", config, id).summary!),
  ).toEqual({
    run: "trial",
    role: "reviewer",
    head,
    verdict: "PASS",
    findings: [],
    g0: "simplest",
  });
  expect(() => parseTrace(verdict(7), true, "reviewer", config, id)).toThrow(
    "malformed-worker-verdict",
  );
  expect(() =>
    parseTrace(verdict("x".repeat(MAX_TERMINAL_SUMMARY_LENGTH)), true, "reviewer", config, id),
  ).toThrow("malformed-worker-verdict");
  expect(() =>
    parseTrace(verdict("simplest", { summary: "obsolete" }), true, "reviewer", config, id),
  ).toThrow("malformed-worker-verdict");
});
it("requests the exact verdict, findings and G0 reviewer shape", () => {
  const schema = outputSchema(config, "reviewer");
  expect(schema.required).toEqual(["run", "role", "head", "verdict", "findings", "g0"]);
  expect(schema.properties.findings).toMatchObject({ type: "array" });
  expect(schema.properties.g0).toEqual({ type: "string" });
  expect(schema.additionalProperties).toBe(false);
});
// Final agent messages and terminal events copied verbatim from ISS-147's
// reviewer-725338a3 and reviewer-e6dc02bc traces in m1-intake-refresh-20260914T1635.
// The preserved first verdict measures 2276, despite ISS-150's stated 2302.
const preservedConfig = { ...config, run: "m1-intake-refresh-20260914T1635" };
const preservedHead = "e535d57f413db9c07556af53f61389053aedffd1";
it("accepts the preserved prose-prefixed final message by its sole verdict object", () => {
  const message = prefixedReview[1]!.item!.text;
  expect(message.length).toBe(2143);
  const terminal = parseTrace(trace(prefixedReview), true, "reviewer", preservedConfig);
  expect(terminal).toMatchObject({ status: "passed", head: preservedHead });
  expect(terminal.summary).toHaveLength(1621);
  expect(parseReview(terminal.summary, preservedConfig.run, preservedHead)).toEqual(
    JSON.parse(message.slice(message.indexOf("{"))),
  );
});
// ISS-198 raised the shared bound above ISS-150's 2276 and 2302, so those
// recorded lengths now pass; refusal is exercised one character above the bound.
it.each([2276, 2302, MAX_TERMINAL_SUMMARY_LENGTH + 1])(
  "rejects an otherwise valid %i-character verdict only above the shared bound and records the diagnostic",
  async (length) => {
    const captured = JSON.parse(overlengthReview[1]!.item!.text);
    expect(JSON.stringify(captured)).toHaveLength(2276);
    // Keep the captured fixture unchanged; cover the issue's stated length separately.
    const verdict = { ...captured, g0: captured.g0 + "x".repeat(length - 2276) };
    // Removing only the excess G0 text satisfies all existing semantic checks.
    expect(
      parseReview(
        JSON.stringify({ ...verdict, g0: "No simpler change." }),
        preservedConfig.run,
        preservedHead,
      ).verdict,
    ).toBe("PASS");
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-review-length-")));
    cleanup.push(root);
    const events = structuredClone(overlengthReview);
    events[1]!.item!.text = JSON.stringify(verdict);
    const attempt = {
      id: events[0]!.thread_id!,
      pid: 999_999,
      trace: resolve(root, "reviewer.jsonl"),
      launchedAt: 1,
    };
    await writeFile(attempt.trace, trace(events));
    await writeFile(resolve(root, "reviewer.exit.json"), JSON.stringify({ code: 0 }));
    const observed = codexAdapter().observe(
      "reviewer",
      { ...preservedConfig, reviewWorktree: resolve(import.meta.dirname, "../..") },
      attempt,
    );
    if (length <= MAX_TERMINAL_SUMMARY_LENGTH) {
      expect(parseTrace(trace(events), true, "reviewer", preservedConfig)).toMatchObject({
        status: "passed",
        head: preservedHead,
        summary: JSON.stringify(verdict),
      });
      await expect(observed).resolves.toMatchObject({ status: "passed", head: preservedHead });
      return;
    }
    const diagnostic = `Reviewer verdict serialized length is ${length} characters; maximum is ${MAX_TERMINAL_SUMMARY_LENGTH}. Shorten findings and G0 to fit.`;
    expect(() => parseTrace(trace(events), true, "reviewer", preservedConfig)).toThrow(
      "malformed-worker-verdict",
    );
    await expect(observed).resolves.toMatchObject({
      status: "malformed",
      summary: expect.stringContaining(diagnostic),
    });
  },
);
it.each([MAX_TERMINAL_SUMMARY_LENGTH, MAX_TERMINAL_SUMMARY_LENGTH + 1])(
  "enforces the serialized review boundary at %i characters",
  (length) => {
    const verdict = JSON.parse(rows[1]!.item!.text);
    verdict.g0 = "";
    verdict.g0 = "x".repeat(length - JSON.stringify(verdict).length);
    const events = structuredClone(rows);
    // Message whitespace is excluded from the serialized-object limit.
    events[1]!.item!.text = `Review complete.\n${JSON.stringify(verdict, null, 2)}\n`;
    const parse = () => parseTrace(trace(events), true, "reviewer", config);
    if (length === MAX_TERMINAL_SUMMARY_LENGTH) expect(parse().summary).toHaveLength(length);
    else expect(parse).toThrow("malformed-worker-verdict");
  },
);
it.each([
  "I inspected call({ option: true })",
  'I inspected call({ option: {"nested":true} })',
  "I inspected the opening { brace.",
  'I inspected { option: "a } brace" } and { another: true }.',
  'I inspected { an unfinished "quote.',
])("accepts a sole reviewer object after non-JSON brace text: %s", (prefix) => {
  const events = structuredClone(rows);
  const verdict = JSON.parse(events[1]!.item!.text);
  events[1]!.item!.text = `${prefix}\n${JSON.stringify(verdict)}\n`;
  const terminal = parseTrace(trace(events), true, "reviewer", config);
  expect(terminal.status).toBe("passed");
  expect(JSON.parse(terminal.summary!)).toEqual(verdict);
});
it.each([
  ["trailing prose", (object: string) => `${object}\nDone.`],
  ["two objects", (object: string) => `${object}\n${object}`],
  ["an earlier non-verdict object", (object: string) => `{}\nReview complete.\n${object}`],
  [
    "two objects after non-JSON brace text",
    (object: string) => `I inspected call({ option: true })\n${object}\n${object}`,
  ],
  ["an earlier nested object", (object: string) => `{"review":${object}}\n${object}`],
  [
    "trailing prose after brace-prefixed JSON",
    (object: string) => `I inspected call({ option: true })\n${object}\nDone.`,
  ],
  ["no object", () => "Review complete. PASS."],
  ["only non-JSON brace text", () => "I inspected call({ option: true })"],
  ["array wrapper", (object: string) => `[${object}]`],
  ["nested verdict", (object: string) => `{"review":${object}}`],
] as const)("rejects reviewer framing with %s", (_name, frame) => {
  const events = structuredClone(rows);
  events[1]!.item!.text = frame(events[1]!.item!.text);
  expect(() => parseTrace(trace(events), true, "reviewer", config)).toThrow(
    "malformed-worker-verdict",
  );
});
it("parses nested findings and escaped braces and quotes without changing the verdict", () => {
  const verdict = {
    ...JSON.parse(rows[1]!.item!.text),
    findings: [{ file: "file.ts", line: 1, severity: "note", text: 'Check {x: "a\\b"} and }.' }],
  };
  const events = structuredClone(rows);
  events[1]!.item!.text = `Review complete.\n${JSON.stringify(verdict)}\n`;
  expect(JSON.parse(parseTrace(trace(events), true, "reviewer", config).summary!)).toEqual(verdict);
});
it.each([
  { extra: true },
  { run: "other" },
  { role: "author" },
  { head: "invalid" },
  { verdict: "MAYBE" },
  { findings: "none" },
  { g0: 1 },
])("retains existing reviewer validation with a prose prefix (%j)", (invalid) => {
  const events = structuredClone(rows);
  events[1]!.item!.text = `Review complete.\n${JSON.stringify({ ...JSON.parse(events[1]!.item!.text), ...invalid })}`;
  expect(() => parseTrace(trace(events), true, "reviewer", config)).toThrow(
    "malformed-worker-verdict",
  );
});
it("accepts plain and prefixed author verdicts", () => {
  const events = structuredClone(rows);
  const verdict = { run: config.run, role: "author", head, verdict: "PASS", summary: "" };
  events[1]!.item!.text = JSON.stringify(verdict);
  expect(parseTrace(trace(events), true, "author", config).status).toBe("passed");
  events[1]!.item!.text = `Work complete.\n${JSON.stringify(verdict)}`;
  expect(parseTrace(trace(events), true, "author", config).status).toBe("passed");
});
// Minimal verbatim events from the ISS-177 retained author trace, SHA-256
// ba416b2bb60792af25adca761ca6f8426861377515442491cd30e116eda6f37c.
it("parses the recorded 2560-character author message through the real observer", async () => {
  const message = prefixedAuthor[1]!.item!.text;
  const verdict = JSON.parse(message.slice(message.indexOf("{")));
  const recordedConfig = { ...config, run: verdict.run };
  expect(message).toHaveLength(2560);
  expect(verdict.summary).toHaveLength(1068);
  const terminal = parseTrace(trace(prefixedAuthor), true, "author", recordedConfig);
  expect(terminal).toEqual({
    id: prefixedAuthor[0]!.thread_id,
    status: "passed",
    head: "804e9357a88868daab31b211966f645baeca6c02",
    summary: verdict.summary,
    usage: prefixedAuthor[2]!.usage,
  });
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-author-prefix-")));
  cleanup.push(root);
  const attempt = {
    id: terminal.id,
    pid: 999_999,
    trace: resolve(root, "author.jsonl"),
    launchedAt: 1,
  };
  await writeFile(attempt.trace, trace(prefixedAuthor));
  await writeFile(resolve(root, "author.exit.json"), JSON.stringify({ code: 0 }));
  await expect(codexAdapter().observe("author", recordedConfig, attempt)).resolves.toEqual(
    terminal,
  );
});

const authorVerdict = { run: config.run, role: "author", head, verdict: "PASS", summary: "" };
// Minimal verbatim events from author-dc931f49 in ISS-182, trace SHA-256
// 54596454139b7ffe47f52d9459c9f0a6a4e3c71e0f31ef46745abe3f6c307d5e.
// ISS-198 raised the shared bound, so the recorded 2079-character summary now
// passes; refusal is exercised one character above the bound.
it.each([2079, MAX_TERMINAL_SUMMARY_LENGTH, MAX_TERMINAL_SUMMARY_LENGTH + 1])(
  "observes the author summary boundary: %i",
  async (length) => {
    const events = structuredClone(overlengthAuthor);
    const verdict = JSON.parse(events[1]!.item!.text);
    expect(events[1]!.item!.text).toHaveLength(2225);
    expect(verdict.summary).toHaveLength(2079);
    if (length !== 2079) {
      events[0]!.thread_id = "00000000-0000-4000-8000-000000000183";
      Object.assign(verdict, { run: "synthetic-author-length", head, summary: "x".repeat(length) });
      events[1]!.item!.text = `Synthetic prefix.\n${JSON.stringify(verdict)}`;
    }
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-author-length-")));
    cleanup.push(root);
    const attempt = {
      id: events[0]!.thread_id!,
      pid: process.pid,
      trace: resolve(root, "author.jsonl"),
      launchedAt: 1,
    };
    const current = {
      ...config,
      run: verdict.run,
      worktree: resolve(import.meta.dirname, "../.."),
    };
    await writeFile(attempt.trace, trace(events));
    await writeFile(resolve(root, "author.exit.json"), JSON.stringify({ code: 0 }));
    if (length <= MAX_TERMINAL_SUMMARY_LENGTH) {
      await expect(codexAdapter().observe("author", current, attempt)).resolves.toMatchObject({
        status: "passed",
        summary: verdict.summary,
        head: verdict.head,
      });
    } else {
      const diagnostic = `Author summary length is ${length} characters; maximum is ${MAX_TERMINAL_SUMMARY_LENGTH}. Inspect and verify the work, then return a valid verdict with a shorter summary.`;
      expect(() => parseTrace(trace(events), true, "author", current, attempt.id)).toThrow(
        "malformed-worker-verdict",
      );
      await expect(codexAdapter().observe("author", current, attempt)).resolves.toMatchObject({
        id: attempt.id,
        status: "malformed",
        summary: expect.stringContaining(diagnostic),
        usage: events[2]!.usage,
      });
      expect(diagnostic.length).toBeLessThan(MAX_TERMINAL_SUMMARY_LENGTH);
    }
  },
);
it.each([
  "thread",
  "run",
  "role",
  "incomplete",
  "failed-turn",
  "no-completion",
  "FAIL",
  "wrong-head",
])("keeps real author observation distinct from malformed transport: %s", async (mode) => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-author-control-")));
  cleanup.push(root);
  const syntheticId = "00000000-0000-4000-8000-000000000183";
  const verdict = { ...authorVerdict, summary: "x".repeat(MAX_TERMINAL_SUMMARY_LENGTH + 1) };
  if (mode === "run") verdict.run = "synthetic-wrong-run";
  if (mode === "role") verdict.role = "reviewer";
  if (mode === "FAIL" || mode === "wrong-head") {
    verdict.summary = "Synthetic valid verdict.";
    if (mode === "FAIL") verdict.verdict = "FAIL";
    else verdict.head = "e".repeat(40);
  }
  const events: unknown[] = [
    { type: "thread.started", thread_id: syntheticId },
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(verdict) } },
  ];
  if (mode === "failed-turn") events.push({ type: "turn.failed" });
  else if (mode !== "no-completion") events.push({ type: "turn.completed" });
  const attempt = {
    id: mode === "thread" ? id : syntheticId,
    pid: process.pid,
    trace: resolve(root, "author.jsonl"),
    launchedAt: Date.now(),
  };
  await writeFile(attempt.trace, trace(events));
  if (mode !== "incomplete")
    await writeFile(resolve(root, "author.exit.json"), JSON.stringify({ code: 0 }));
  const observed = codexAdapter().observe("author", config, attempt);
  if (mode === "thread") await expect(observed).rejects.toThrow("attempt-identity-changed");
  else if (mode === "run" || mode === "role")
    await expect(observed).rejects.toThrow("worker-verdict-identity-mismatch");
  else if (mode === "no-completion")
    await expect(observed).rejects.toThrow("missing-successful-terminal");
  else
    await expect(observed).resolves.toMatchObject({
      status:
        mode === "incomplete"
          ? "running"
          : mode === "failed-turn"
            ? "dead"
            : mode === "FAIL"
              ? "failed"
              : "passed",
      ...(mode === "wrong-head" ? { head: verdict.head } : {}),
    });
});
function authorEvents(message = `Work complete.\n${JSON.stringify(authorVerdict)}`) {
  const events = structuredClone(rows);
  events[1]!.item!.text = message;
  return events;
}
it.each([
  ["two verdicts", (object: string) => `${object}\n${object}`],
  ["earlier non-verdict object", (object: string) => `{}\nWork complete.\n${object}`],
  ["trailing prose", (object: string) => `${object}\nDone.`],
  ["absent verdict", () => "Work complete. PASS."],
  ["malformed JSON", (object: string) => object.slice(0, -1)],
] as const)("rejects author framing with %s", (_name, frame) => {
  expect(() =>
    parseTrace(trace(authorEvents(frame(JSON.stringify(authorVerdict)))), true, "author", config),
  ).toThrow("malformed-worker-verdict");
});
it.each([
  { extra: true },
  ...Object.keys(authorVerdict).map((key) => ({ [key]: undefined })),
  { run: 1 },
  { run: "other" },
  { role: 1 },
  { role: "reviewer" },
  { head: 1 },
  { head: null },
  { head: "invalid" },
  { verdict: 1 },
  { verdict: "MAYBE" },
  { summary: 1 },
  { summary: null },
  { summary: [] },
])("retains strict author validation with a prefix (%j)", (invalid) => {
  const events = authorEvents(
    `Work complete.\n${JSON.stringify({ ...authorVerdict, ...invalid })}`,
  );
  expect(() => parseTrace(trace(events), true, "author", config)).toThrow(
    "malformed-worker-verdict",
  );
});
it.each([MAX_TERMINAL_SUMMARY_LENGTH, MAX_TERMINAL_SUMMARY_LENGTH + 1])(
  "enforces only the author summary cap at %i characters",
  (length) => {
    const events = authorEvents(
      `Work complete.\n${JSON.stringify({ ...authorVerdict, summary: "x".repeat(length) })}`,
    );
    const parse = () => parseTrace(trace(events), true, "author", config);
    if (length === MAX_TERMINAL_SUMMARY_LENGTH) expect(parse().summary).toBe("x".repeat(length));
    else expect(parse).toThrow("malformed-worker-verdict");
  },
);
it("retains completion, identity, last-message and FAIL semantics for prefixed authors", () => {
  const events = authorEvents();
  expect(parseTrace(trace(events), false, "author", config, id).status).toBe("running");
  expect(parseTrace(trace(events), true, "author", config, id, true).status).toBe("dead");
  expect(() => parseTrace(trace(events), true, "author", config, "other")).toThrow(
    "attempt-identity-changed",
  );
  for (const invalid of [
    events.slice(0, 2),
    [...events, events[2]],
    [...events, { type: "turn.failed" }],
  ])
    expect(() => parseTrace(trace(invalid), true, "author", config, id)).toThrow(
      "missing-successful-terminal",
    );
  for (const invalid of [events.slice(1), [events[0], ...events]])
    expect(() => parseTrace(trace(invalid), true, "author", config, id)).toThrow(
      "missing-or-ambiguous-thread-identity",
    );
  expect(
    parseTrace(trace([events[0], { type: "turn.failed" }]), true, "author", config, id).status,
  ).toBe("dead");
  const fail = authorEvents(
    `Work complete.\n${JSON.stringify({ ...authorVerdict, verdict: "FAIL", summary: "Unfinished." })}`,
  )[1]!;
  expect(
    parseTrace(trace([events[0], events[1], fail, events[2]]), true, "author", config, id),
  ).toMatchObject({ status: "failed", summary: "Unfinished." });
  expect(
    parseTrace(trace([events[0], fail, events[1], events[2]]), true, "author", config, id).status,
  ).toBe("passed");
  expect(() =>
    parseTrace(
      trace([
        events[0],
        events[1],
        { type: "item.completed", item: { type: "agent_message", text: "Unfinished." } },
        events[2],
      ]),
      true,
      "author",
      config,
      id,
    ),
  ).toThrow("malformed-worker-verdict");
});
it.skipIf(process.env.GITHUB_ACTIONS !== "true")(
  "loads the adapter in a hosted child Node process with its native TypeScript imports",
  async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const adapter = await import("./scripts/dogfood/dispatch-adapter.ts"); process.stdout.write(JSON.stringify(adapter.outputSchema({ run: "native-smoke", base: "a".repeat(40) }, "author").required));',
      ],
      { cwd: resolve(import.meta.dirname, "../.."), windowsHide: true },
    );
    expect(JSON.parse(stdout)).toEqual(["run", "role", "head", "verdict", "summary"]);
  },
);
it("rejects missing/duplicate identities, missing completion, changed session, wrong role and prose verdicts", () => {
  expect(() => parseTrace(trace(rows.slice(1)), true, "reviewer", config)).toThrow();
  expect(() => parseTrace(trace([rows[0]!, ...rows]), true, "reviewer", config)).toThrow();
  expect(() => parseTrace(trace(rows.slice(0, 2)), true, "reviewer", config)).toThrow();
  expect(() => parseTrace(trace(), true, "reviewer", config, "other")).toThrow(
    "attempt-identity-changed",
  );
  expect(() => parseTrace(trace(), true, "author", config)).toThrow("malformed-worker-verdict");
  expect(() =>
    parseTrace(
      trace([
        rows[0]!,
        { type: "item.completed", item: { type: "agent_message", text: "PASS" } },
        rows[2]!,
      ]),
      true,
      "reviewer",
      config,
    ),
  ).toThrow();
});
it("distinguishes malformed verdict transport from a valid verdict with substituted identity", () => {
  const message = (value: unknown) =>
    trace([
      rows[0]!,
      { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(value) } },
      rows[2]!,
    ]);
  expect(() =>
    parseTrace(
      message({
        run: "other-run",
        role: "reviewer",
        head,
        verdict: "PASS",
        findings: [],
        g0: "simplest",
      }),
      true,
      "reviewer",
      config,
      id,
    ),
  ).toThrow("worker-verdict-identity-mismatch");
  expect(() =>
    parseTrace(
      message({ run: config.run, role: "reviewer", head: "not-a-head", verdict: "PASS" }),
      true,
      "reviewer",
      config,
      id,
    ),
  ).toThrow("malformed-worker-verdict");
});
it("refuses a CLI without the observed native interface before launching", async () => {
  await expect(codexAdapter().preflight(config)).rejects.toThrow();
});
it("observes a terminal failed trace as dead before its exit receipt arrives", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-dead-trace-")));
  cleanup.push(root);
  const current = { ...config, stateDirectory: root };
  const attempt = { id, pid: 999_999, trace: resolve(root, "author.jsonl"), launchedAt: 1_000 };
  await writeFile(
    attempt.trace,
    trace([
      rows[0]!,
      { type: "turn.failed", error: { message: "stream disconnected" } },
    ] as typeof rows),
  );

  await expect(codexAdapter().observe("author", current, attempt)).resolves.toEqual({
    id,
    status: "dead",
    summary: "stream disconnected",
    providerFailure: true,
  });
});
it("treats a non-zero exit as dead when the trace ends with partial JSON", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-dead-partial-trace-")));
  cleanup.push(root);
  const current = { ...config, stateDirectory: root };
  const attempt = { id, pid: 999_999, trace: resolve(root, "author.jsonl"), launchedAt: 1_000 };
  await writeFile(
    attempt.trace,
    `${trace([
      rows[0]!,
      { type: "error", message: "provider returned 503" },
    ] as typeof rows)}{"type":"turn.failed"`,
  );
  await writeFile(resolve(root, "author.exit.json"), JSON.stringify({ code: 1 }));

  await expect(codexAdapter().observe("author", current, attempt)).resolves.toEqual({
    id,
    status: "dead",
    summary: "provider returned 503",
    providerFailure: true,
  });
});
it("observes a missing exit receipt for the module window before a dead author retry", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-exit-wait-")));
  cleanup.push(root);
  let now = 1_000;
  const current = { ...config, stateDirectory: root };
  const attempt = { id, pid: 999_999, trace: resolve(root, "author.jsonl"), launchedAt: 1_000 };
  await writeFile(attempt.trace, trace([rows[0]!]));
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  try {
    const adapter = codexAdapter("git", () => now);
    await expect(adapter.observe("author", current, attempt)).resolves.toEqual({
      id,
      status: "running",
    });
    now = 30_999;
    await expect(adapter.observe("author", current, attempt)).resolves.toMatchObject({
      status: "running",
    });
    now = 31_000;
    await expect(adapter.observe("author", current, attempt)).resolves.toMatchObject({
      id,
      status: "dead",
      summary: "Author process exited without an exit receipt or terminal turn.",
    });
  } finally {
    kill.mockRestore();
  }
});
it.each([
  "live",
  "unknown process",
  "unknown thread",
  "changed thread",
  "completed turn",
  "delayed receipt",
])("does not turn a receiptless author into a dead retry for %s", async (mode) => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-receiptless-")));
  cleanup.push(root);
  const current = { ...config, stateDirectory: root };
  const attempt = { id, pid: process.pid, trace: resolve(root, "author.jsonl"), launchedAt: 1_000 };
  const authorRows = [
    rows[0]!,
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({
          run: current.run,
          role: "author",
          head,
          verdict: "PASS",
          summary: "",
        }),
      },
    },
    { type: "turn.completed" },
  ];
  await writeFile(
    attempt.trace,
    trace(
      mode === "unknown thread"
        ? []
        : mode === "changed thread"
          ? [{ type: "thread.started", thread_id: "01a048fe-90c8-7cb3-8da5-938c1f5cb5f1" }]
          : mode === "completed turn" || mode === "delayed receipt"
            ? authorRows
            : [rows[0]!],
    ),
  );
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    if (mode === "live") return true;
    throw Object.assign(new Error("process probe"), {
      code: mode === "unknown process" ? "EPERM" : "ESRCH",
    });
  });
  try {
    let now = mode === "delayed receipt" ? 30_999 : 60_000;
    const adapter = codexAdapter("git", () => now);
    if (mode === "live" || mode === "delayed receipt") {
      await expect(adapter.observe("author", current, attempt)).resolves.toMatchObject({
        status: "running",
      });
      if (mode === "delayed receipt") {
        await writeFile(resolve(root, "author.exit.json"), JSON.stringify({ code: 0 }));
        now = 60_000;
        await expect(adapter.observe("author", current, attempt)).resolves.toMatchObject({
          status: "passed",
          head,
        });
      }
    } else {
      await expect(adapter.observe("author", current, attempt)).rejects.toThrow(
        mode === "unknown process"
          ? "process probe"
          : mode === "unknown thread"
            ? "missing-or-ambiguous-thread-identity"
            : mode === "changed thread"
              ? "attempt-identity-changed"
              : "exit-receipt-timeout",
      );
    }
  } finally {
    kill.mockRestore();
  }
});
const cleanup: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of cleanup.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
it("filters the actual controller-to-observer child environment", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-process-")));
  cleanup.push(root);
  const assertion = resolve(root, "observer-assertion.json"),
    result = resolve(root, "observer-result.txt"),
    parent = { ...hostedParent(), NODE_V8_COVERAGE: resolve(root, "synthetic-coverage") },
    before = { ...parent };
  await writeFile(assertion, JSON.stringify(fixtureAssertion(parent, result)));
  await promisify(execFile)(
    process.execPath,
    [resolve(import.meta.dirname, "fixtures/controller.mjs"), "launch-observer", assertion],
    { windowsHide: true, env: parent },
  );
  await assertFixture(result, "observer");
  expect(parent).toEqual(before);
});
it("filters the actual observer-to-worker child environment", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-process-")));
  cleanup.push(root);
  const request = resolve(root, "request.json"),
    stdin = resolve(root, "prompt.txt"),
    assertion = resolve(root, "worker-assertion.json"),
    result = resolve(root, "worker-result.json"),
    parent = { ...hostedParent(), NODE_V8_COVERAGE: resolve(root, "synthetic-coverage") },
    before = { ...parent };
  await writeFile(stdin, "finite prompt");
  await writeFile(assertion, JSON.stringify(fixtureAssertion(parent, result)));
  await writeFile(
    request,
    JSON.stringify({
      executable: process.execPath,
      args: [resolve(import.meta.dirname, "fixtures/provider.mjs"), assertion],
      stdin,
      stdout: resolve(root, "trace.jsonl"),
      stderr: resolve(root, "stderr.log"),
      identity: resolve(root, "identity.json"),
      done: resolve(root, "exit.json"),
    }),
  );
  await promisify(execFile)(
    process.execPath,
    [resolve(import.meta.dirname, "../../scripts/dogfood/observe-process.mjs"), request],
    { windowsHide: true, env: parent },
  );
  const exit = JSON.parse(await eventuallyRead(resolve(root, "exit.json")));
  await assertFixture(result, "worker");
  expect(exit).toEqual({ code: 0, signal: null });
  expect(JSON.parse(await readFile(resolve(root, "identity.json"), "utf8")).pid).toBeGreaterThan(0);
  expect(await readFile(resolve(root, "trace.jsonl"), "utf8")).toBe("finite prompt\n");
  expect(parent).toEqual(before);
});

// ISS-164: closed-schema shallow validation and the private request stream.
// Every object is closed; bounds are the incumbent's; v1 carries no instant,
// so a date-only value can only arrive as a key v1 does not have.
const nativeRun = "m1-iss164-20260921T0423";
const approved = "/root/orchestration-m1/runtime";
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
type Request = {
  schemaVersion: string;
  correlation: number;
  profile: string;
  run: string;
  issue: number;
  attempt: number;
  executorHead: string;
  product: { repository: string; head: string; tree: string };
  declaration: {
    version: number;
    profile: string;
    files: { file: string; cases: string[] }[];
    mutants: { id: string; file: string; cases: string[]; assertion: string }[];
  };
  patchDigests: { id: string; digest: string }[];
  stagedInputDirectory: string;
};
const minimalRequest = (): Request => ({
  schemaVersion: "dogfood-native-db-request/v1",
  correlation: 1,
  profile: "reconciliation-pg16/v1",
  run: nativeRun,
  issue: 1,
  attempt: 1,
  executorHead: "0".repeat(40),
  product: { repository: "o/n", head: "1".repeat(40), tree: "2".repeat(40) },
  declaration: {
    version: 1,
    profile: "reconciliation-pg16/v1",
    files: ["a", "b", "c"].map((file) => ({ file, cases: ["c"] })),
    mutants: [],
  },
  patchDigests: [],
  stagedInputDirectory: `${approved}/s`,
});
// Every scalar at its bound and every list at its count; the byte cap is a
// separate control because 3 x 256 x 512-character cases alone exceed it.
const maximalRequest = (): Request => {
  const cases = (prefix: string) => Array.from({ length: 256 }, (_, index) => `${prefix}-${index}`);
  return {
    schemaVersion: "dogfood-native-db-request/v1",
    correlation: Number.MAX_SAFE_INTEGER,
    profile: "reconciliation-pg16/v1",
    run: "R".repeat(128),
    issue: 2147483647,
    attempt: 2147483647,
    executorHead: "f".repeat(40),
    product: {
      repository: `${"o".repeat(100)}/${"n".repeat(100)}`,
      head: "e".repeat(40),
      tree: "d".repeat(40),
    },
    declaration: {
      version: 1,
      profile: "reconciliation-pg16/v1",
      files: ["one", "two", "three"].map((name) => ({
        file: `${name}/`.repeat(200).slice(0, 1023) + "t",
        cases: [name.padEnd(512, "x")],
      })),
      mutants: ["m1", "m2", "m3"].map((id) => ({
        id: id.padEnd(128, "."),
        file: "one",
        cases: cases(id),
        assertion: "a".repeat(2048),
      })),
    },
    patchDigests: ["p1", "p2", "p3"].map((id) => ({
      id: id.padEnd(128, ":"),
      digest: "9".repeat(64),
    })),
    stagedInputDirectory: `${approved}/${"s".repeat(1023 - approved.length)}`,
  };
};
// Fills the third file's cases until the request measures exactly `target` bytes.
const sizedRequest = (target: number) => {
  const request = minimalRequest();
  const cases = request.declaration.files[2]!.cases;
  cases.length = 0;
  for (let index = 0; bytes(request) < target; index += 1) {
    const room = target - bytes(request) - (cases.length === 0 ? 2 : 3);
    const label = `${index}-`;
    if (room < label.length) {
      cases[cases.length - 1] += "y".repeat(target - bytes(request));
      break;
    }
    cases.push(label.padEnd(Math.min(512, room), "x"));
  }
  expect(bytes(request)).toBe(target);
  return request;
};
const minimalReply = () => ({
  schemaVersion: "dogfood-native-db-reply/v1",
  correlation: 1,
  status: "refused",
  owner: null,
  evidencePath: null,
  diagnostic: "d",
});
const completedReply = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "dogfood-native-db-reply/v1",
  correlation: 1,
  status: "completed",
  owner: { lockId: "3".repeat(32), head: "4".repeat(40), lane: nativeRun },
  evidencePath: "C:\\root\\anchor\\.orchestrator\\native-db\\evidence-1",
  diagnostic: null,
  ...overrides,
});
// Every field within its character bound, three UTF-8 bytes per character.
const oversizeReply = () =>
  completedReply({
    evidencePath: `/${"\u4e00".repeat(1023)}`,
    diagnostic: "\u4e00".repeat(2048),
  });
const options = { run: nativeRun, approvedParents: [approved] };

it("accepts the minimum, maximum and exact-size native-db messages", () => {
  expect(validateNativeDbRequest(minimalRequest(), options)).toBeUndefined();
  const maximal = maximalRequest();
  expect(bytes(maximal)).toBeLessThanOrEqual(NATIVE_DB_REQUEST_LIMIT);
  expect(validateNativeDbRequest(maximal, { ...options, run: maximal.run })).toBeUndefined();
  expect(validateNativeDbRequest(sizedRequest(NATIVE_DB_REQUEST_LIMIT), options)).toBeUndefined();
  expect(validateNativeDbRequest(sizedRequest(NATIVE_DB_REQUEST_LIMIT + 1), options)).toBe(
    `request exceeds ${NATIVE_DB_REQUEST_LIMIT} UTF-8 bytes`,
  );
  expect(validateNativeDbReply(minimalReply())).toBeUndefined();
  const maximalReply = completedReply({
    correlation: Number.MAX_SAFE_INTEGER,
    owner: { lockId: "a".repeat(32), head: "b".repeat(40), lane: "L".repeat(128) },
    evidencePath: `/${"e".repeat(1023)}`,
    diagnostic: "\u{1F600}".repeat(1024),
  });
  expect(bytes(maximalReply)).toBeLessThanOrEqual(NATIVE_DB_REPLY_LIMIT);
  expect(validateNativeDbReply(maximalReply)).toBeUndefined();
  expect(validateNativeDbReply(oversizeReply())).toBe(
    `reply exceeds ${NATIVE_DB_REPLY_LIMIT} UTF-8 bytes`,
  );
  expect(validateNativeDbReply({ ...minimalReply(), status: "unknown" })).toBeUndefined();
  expect(validateNativeDbReply(completedReply())).toBeUndefined();
  expect(
    validateNativeDbReply(completedReply({ evidencePath: "/posix/anchor/e" })),
  ).toBeUndefined();
});

it.each<[string, (request: Request) => unknown, string]>([
  [
    "nested unknown key",
    (r) => ({ ...r, product: { ...r.product, extra: 1 } }),
    "request.product.extra is not a v1 key",
  ],
  [
    "nested unknown key in a file entry",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        files: [{ ...r.declaration.files[0], generated: true }, ...r.declaration.files.slice(1)],
      },
    }),
    "request.declaration.files[0].generated is not a v1 key",
  ],
  [
    "date-only instant as an extra key",
    (r) => ({ ...r, requestedAt: "2026-09-20" }),
    "request.requestedAt is not a v1 key",
  ],
  ["missing required key", ({ attempt: _, ...r }) => r, "request.attempt is required"],
  [
    "missing nested required key",
    (r) => ({ ...r, product: { repository: r.product.repository, head: r.product.head } }),
    "request.product.tree is required",
  ],
  [
    "wrong schema",
    (r) => ({ ...r, schemaVersion: "dogfood-native-db-request/v2" }),
    "request.schemaVersion must be dogfood-native-db-request/v1",
  ],
  [
    "wrong profile",
    (r) => ({ ...r, profile: "reconciliation-pg17/v1" }),
    "request.profile must be reconciliation-pg16/v1",
  ],
  [
    "string correlation",
    (r) => ({ ...r, correlation: "1" }),
    "request.correlation must be a safe integer",
  ],
  [
    "zero correlation",
    (r) => ({ ...r, correlation: 0 }),
    "request.correlation must be 1..9007199254740991",
  ],
  [
    "unsafe correlation",
    (r) => ({ ...r, correlation: 2 ** 53 }),
    "request.correlation must be a safe integer",
  ],
  ["foreign run", (r) => ({ ...r, run: "other-run" }), "request.run is not the bound run"],
  ["run shape", (r) => ({ ...r, run: "bad run" }), "request.run has an unsupported shape"],
  ["issue below range", (r) => ({ ...r, issue: 0 }), "request.issue must be 1..2147483647"],
  [
    "issue above range",
    (r) => ({ ...r, issue: 2147483648 }),
    "request.issue must be 1..2147483647",
  ],
  ["attempt as float", (r) => ({ ...r, attempt: 1.5 }), "request.attempt must be a safe integer"],
  [
    "uppercase head",
    (r) => ({ ...r, executorHead: "A".repeat(40) }),
    "request.executorHead has an unsupported shape",
  ],
  [
    "short head",
    (r) => ({ ...r, executorHead: "a".repeat(39) }),
    "request.executorHead must be 40..40 characters",
  ],
  ["product as list", (r) => ({ ...r, product: [] }), "request.product must be an object"],
  [
    "repository with three segments",
    (r) => ({ ...r, product: { ...r.product, repository: "a/b/c" } }),
    "request.product.repository must be owner/name",
  ],
  [
    "repository segment too long",
    (r) => ({ ...r, product: { ...r.product, repository: `${"o".repeat(101)}/n` } }),
    "request.product.repository must be owner/name",
  ],
  [
    "declaration version",
    (r) => ({ ...r, declaration: { ...r.declaration, version: 2 } }),
    "request.declaration.version must be 1",
  ],
  [
    "two files",
    (r) => ({ ...r, declaration: { ...r.declaration, files: r.declaration.files.slice(0, 2) } }),
    "request.declaration.files must have 3..3 entries",
  ],
  [
    "repeated file",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        files: [r.declaration.files[0], r.declaration.files[0], r.declaration.files[2]],
      },
    }),
    'request.declaration.files repeats "a"',
  ],
  [
    "traversing file",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        files: [{ file: "../a", cases: ["c"] }, ...r.declaration.files.slice(1)],
      },
    }),
    "request.declaration.files[0].file must be a relative path without traversal",
  ],
  [
    "backslash file",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        files: [{ file: "a\\b", cases: ["c"] }, ...r.declaration.files.slice(1)],
      },
    }),
    "request.declaration.files[0].file must be a relative path without traversal",
  ],
  [
    "empty cases",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        files: [{ file: "a", cases: [] }, ...r.declaration.files.slice(1)],
      },
    }),
    "request.declaration.files[0].cases must have 1..256 entries",
  ],
  [
    "257 cases",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        files: [
          { file: "a", cases: Array.from({ length: 257 }, (_, i) => `c${i}`) },
          ...r.declaration.files.slice(1),
        ],
      },
    }),
    "request.declaration.files[0].cases must have 1..256 entries",
  ],
  [
    "repeated case",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        files: [{ file: "a", cases: ["c", "c"] }, ...r.declaration.files.slice(1)],
      },
    }),
    'request.declaration.files[0].cases repeats "c"',
  ],
  [
    "long case",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        files: [{ file: "a", cases: ["c".repeat(513)] }, ...r.declaration.files.slice(1)],
      },
    }),
    "request.declaration.files[0].cases[0] must be 1..512 characters",
  ],
  [
    "four mutants",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        mutants: ["1", "2", "3", "4"].map((id) => ({
          id,
          file: "a",
          cases: ["c"],
          assertion: "x",
        })),
      },
    }),
    "request.declaration.mutants must have 0..3 entries",
  ],
  [
    "mutant assertion too long",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        mutants: [{ id: "m", file: "a", cases: ["c"], assertion: "x".repeat(2049) }],
      },
    }),
    "request.declaration.mutants[0].assertion must be 1..2048 characters",
  ],
  [
    "mutant with a command",
    (r) => ({
      ...r,
      declaration: {
        ...r.declaration,
        mutants: [{ id: "m", file: "a", cases: ["c"], assertion: "x", command: "psql" }],
      },
    }),
    "request.declaration.mutants[0].command is not a v1 key",
  ],
  [
    "patch digests as object",
    (r) => ({ ...r, patchDigests: {} }),
    "request.patchDigests must be a list",
  ],
  [
    "short digest",
    (r) => ({ ...r, patchDigests: [{ id: "p", digest: "9".repeat(63) }] }),
    "request.patchDigests[0].digest must be 64..64 characters",
  ],
  [
    "repeated digest id",
    (r) => ({
      ...r,
      patchDigests: [
        { id: "p", digest: "9".repeat(64) },
        { id: "p", digest: "8".repeat(64) },
      ],
    }),
    'request.patchDigests repeats "p"',
  ],
  [
    "relative staged directory",
    (r) => ({ ...r, stagedInputDirectory: "runtime/s" }),
    "request.stagedInputDirectory must be absolute",
  ],
  [
    "traversing staged directory",
    (r) => ({ ...r, stagedInputDirectory: `${approved}/../s` }),
    "request.stagedInputDirectory must be normalized without traversal",
  ],
  [
    "staged directory outside approved parents",
    (r) => ({ ...r, stagedInputDirectory: "/root/elsewhere/s" }),
    "request.stagedInputDirectory is not under an approved parent",
  ],
  [
    "approved parent itself",
    (r) => ({ ...r, stagedInputDirectory: approved }),
    "request.stagedInputDirectory is not under an approved parent",
  ],
  [
    "runner path field",
    (r) => ({ ...r, runnerPath: "C:\\wrapper.ps1" }),
    "request.runnerPath is not a v1 key",
  ],
  ["not an object", () => "request", "request must be an object"],
])("refuses a request with %s", (_, mutate, diagnostic) => {
  expect(validateNativeDbRequest(minimalRequest(), options)).toBeUndefined();
  expect(validateNativeDbRequest(mutate(minimalRequest()), options)).toBe(diagnostic);
});

it.each<[string, Record<string, unknown>, string]>([
  [
    "unknown key",
    { ...minimalReply(), executedAt: "2026-09-20T00:00:00Z" },
    "reply.executedAt is not a v1 key",
  ],
  [
    "missing diagnostic key",
    (({ diagnostic: _, ...r }) => r)(minimalReply()),
    "reply.diagnostic is required",
  ],
  [
    "wrong schema",
    { ...minimalReply(), schemaVersion: "dogfood-native-db-request/v1" },
    "reply.schemaVersion must be dogfood-native-db-reply/v1",
  ],
  [
    "verdict status",
    { ...minimalReply(), status: "PASS" },
    "reply.status must be completed, refused or unknown",
  ],
  [
    "owner date-only key",
    completedReply({ owner: { ...completedReply().owner, acquiredAt: "2026-09-20" } }),
    "reply.owner.acquiredAt is not a v1 key",
  ],
  [
    "owner missing lane",
    completedReply({ owner: { lockId: "3".repeat(32), head: "4".repeat(40) } }),
    "reply.owner.lane is required",
  ],
  [
    "owner lock id",
    completedReply({ owner: { ...completedReply().owner, lockId: "3".repeat(31) } }),
    "reply.owner.lockId must be 32..32 characters",
  ],
  [
    "owner head",
    completedReply({ owner: { ...completedReply().owner, head: "G".repeat(40) } }),
    "reply.owner.head has an unsupported shape",
  ],
  [
    "relative evidence",
    completedReply({ evidencePath: "anchor/evidence" }),
    "reply.evidencePath must be absolute",
  ],
  [
    "traversing evidence",
    completedReply({ evidencePath: "C:\\anchor\\..\\evidence" }),
    "reply.evidencePath must be normalized without traversal",
  ],
  [
    "completed without owner",
    completedReply({ owner: null }),
    "reply.status completed requires owner and evidencePath",
  ],
  [
    "completed without evidence",
    completedReply({ evidencePath: null }),
    "reply.status completed requires owner and evidencePath",
  ],
  [
    "refused with owner",
    { ...minimalReply(), owner: completedReply().owner },
    "reply.status refused carries no owner or evidencePath",
  ],
  [
    "unknown without diagnostic",
    { ...minimalReply(), status: "unknown", diagnostic: null },
    "reply.status unknown requires a diagnostic",
  ],
  [
    "empty diagnostic",
    { ...minimalReply(), diagnostic: "" },
    "reply.diagnostic must be 1..2048 characters",
  ],
  [
    "worker event",
    { type: "item.completed", item: { type: "agent_message", text: "{}" } },
    "reply.schemaVersion is required",
  ],
])("refuses a reply with %s", (_, reply, diagnostic) => {
  expect(validateNativeDbReply(reply)).toBe(diagnostic);
});

function channel(run = nativeRun) {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: string[] = [];
  output.on("data", (chunk) => written.push(String(chunk)));
  const admission = createNativeDbAdmission(run, input, output, { approvedParents: [approved] });
  const body = (): Omit<Request, "schemaVersion" | "correlation"> => {
    const { schemaVersion: _s, correlation: _c, ...rest } = minimalRequest();
    return rest;
  };
  const flush = () => new Promise((done) => setImmediate(done));
  return { input, output, written, admission, body, flush };
}

it("routes one request through the stream and refuses invalid or concurrent requests locally", async () => {
  const c = channel();
  expect(await c.admission.request({ ...c.body(), issue: 0 })).toEqual({
    correlation: null,
    status: "refused",
    owner: null,
    evidencePath: null,
    diagnostic: "native-db-request-invalid: request.issue must be 1..2147483647",
  });
  expect(await c.admission.request({ ...c.body(), run: "other-run" })).toMatchObject({
    status: "refused",
    diagnostic: "native-db-request-invalid: request.run is not the bound run",
  });
  expect(c.written).toEqual([]);
  // The channel owns schema and correlation; a caller cannot choose them.
  const first = c.admission.request({ ...c.body(), correlation: 7, schemaVersion: "v9" });
  const second = c.admission.request(c.body());
  expect(await second).toMatchObject({
    status: "refused",
    diagnostic: "native-db-request-pending",
  });
  await c.flush();
  expect(c.written).toHaveLength(1);
  const sent = JSON.parse(c.written[0]!);
  expect(c.written[0]!.endsWith("\n")).toBe(true);
  expect(sent).toEqual({ ...minimalRequest(), correlation: 1 });
  // A foreign correlation is not this request's reply.
  c.input.write(`${JSON.stringify(completedReply({ correlation: 2 }))}\n`);
  await c.flush();
  c.input.write(`${JSON.stringify(completedReply())}\r\n`);
  expect(await first).toEqual({
    correlation: 1,
    status: "completed",
    owner: completedReply().owner,
    evidencePath: completedReply().evidencePath,
    diagnostic: null,
  });
  // A duplicate reply after resolution is ignored; the next correlation increases.
  c.input.write(`${JSON.stringify(completedReply())}\n`);
  await c.flush();
  const third = c.admission.request(c.body());
  await c.flush();
  expect(JSON.parse(c.written[1]!).correlation).toBe(2);
  c.input.write(`${JSON.stringify({ ...minimalReply(), correlation: 2 })}\n`);
  expect(await third).toMatchObject({ correlation: 2, status: "refused", diagnostic: "d" });
  c.admission.close();
  expect(await c.admission.request(c.body())).toMatchObject({
    correlation: null,
    status: "refused",
    diagnostic: "native-db-channel-closed",
  });
  expect(c.written).toHaveLength(2);
});

it.each<[string, (c: ReturnType<typeof channel>) => void, string]>([
  [
    "a partial reply before EOF",
    (c) => c.input.end(JSON.stringify(completedReply()).slice(0, 20)),
    "native-db-channel-closed",
  ],
  ["an empty EOF", (c) => c.input.end(), "native-db-channel-closed"],
  ["close while pending", (c) => c.admission.close(), "native-db-channel-closed"],
  ["malformed JSON", (c) => c.input.write("{not json}\n"), "native-db-reply-malformed"],
  [
    "worker JSON",
    (c) => c.input.write('{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}\n'),
    "native-db-reply-invalid: reply.schemaVersion is required",
  ],
  [
    "a wrong-shape reply",
    (c) => c.input.write(`${JSON.stringify(completedReply({ owner: null }))}\n`),
    "native-db-reply-invalid: reply.status completed requires owner and evidencePath",
  ],
  [
    "an oversize reply line",
    (c) => c.input.write(`${JSON.stringify(oversizeReply())}\n`),
    `native-db-reply-oversize: ${NATIVE_DB_REPLY_LIMIT} bytes`,
  ],
  [
    "an oversize partial reply",
    (c) => c.input.write("x".repeat(NATIVE_DB_REPLY_LIMIT + 1)),
    `native-db-reply-oversize: ${NATIVE_DB_REPLY_LIMIT} bytes`,
  ],
])("resolves unknown, never completion, on %s", async (_, act, diagnostic) => {
  const c = channel();
  const pending = c.admission.request(c.body());
  await c.flush();
  expect(c.written).toHaveLength(1);
  act(c);
  expect(await pending).toEqual({
    correlation: 1,
    status: "unknown",
    owner: null,
    evidencePath: null,
    diagnostic,
  });
});

// ISS-165: the same stream boundary behind the composed optional adapter method.
// The harness is the only caller; the parser, correlation and typed results are
// the channel's own, and no adapter member is lost or reinterpreted.
function composed(run = nativeRun) {
  const c = channel(run);
  const base = codexAdapter(process.execPath);
  const native = nativeDbProfileAdapter(base, c.admission);
  // The test's Request type keeps loose strings for its negatives; the closed
  // identity type is what a caller supplies.
  const identity = () => c.body() as NativeDbIdentity;
  return { ...c, base, native, identity };
}
const refusedLocally = (diagnostic: string) => ({
  correlation: null,
  status: "refused",
  owner: null,
  evidencePath: null,
  diagnostic,
});

it("composes the channel onto codexAdapter and carries minimum and maximum identities unchanged", async () => {
  const c = composed();
  // Legacy shape: without the supervisor's composition there is no method at all.
  expect("nativeDbProfile" in codexAdapter(process.execPath)).toBe(false);
  expect(Object.keys(c.native)).toEqual([...Object.keys(c.base), "nativeDbProfile"]);
  for (const name of Object.keys(c.base) as (keyof Adapter)[])
    expect(c.native[name], name).toBe(c.base[name]);
  const minimal = c.native.nativeDbProfile(c.identity());
  await c.flush();
  expect(c.written).toHaveLength(1);
  expect(JSON.parse(c.written[0]!)).toEqual({ ...minimalRequest(), correlation: 1 });
  c.input.write(`${JSON.stringify(completedReply())}\n`);
  expect(await minimal).toEqual({
    correlation: 1,
    status: "completed",
    owner: completedReply().owner,
    evidencePath: completedReply().evidencePath,
    diagnostic: null,
  });
  // A refused lifecycle reply and a duplicate reply line propagate unchanged.
  c.input.write(`${JSON.stringify(completedReply())}\n`);
  await c.flush();
  const refused = c.native.nativeDbProfile({ ...c.identity(), correlation: 1 } as never);
  await c.flush();
  expect(JSON.parse(c.written[1]!).correlation).toBe(2);
  c.input.write(`${JSON.stringify({ ...minimalReply(), correlation: 2 })}\n`);
  expect(await refused).toEqual({
    correlation: 2,
    status: "refused",
    owner: null,
    evidencePath: null,
    diagnostic: "d",
  });
  const m = composed(maximalRequest().run);
  const { schemaVersion: _schema, correlation: _correlation, ...maximal } = maximalRequest();
  const unknown = m.native.nativeDbProfile(maximal as NativeDbIdentity);
  await m.flush();
  expect(JSON.parse(m.written[0]!)).toEqual({ ...maximalRequest(), correlation: 1 });
  m.input.write(`${JSON.stringify({ ...minimalReply(), status: "unknown" })}\n`);
  expect(await unknown).toEqual({
    correlation: 1,
    status: "unknown",
    owner: null,
    evidencePath: null,
    diagnostic: "d",
  });
  expect(m.written).toHaveLength(1);
});

it.each<[string, (identity: Request) => unknown, string]>([
  [
    "a nested unknown key",
    (r) => ({ ...r, product: { ...r.product, extra: 1 } }),
    "request.product.extra is not a v1 key",
  ],
  ["a missing key", ({ attempt: _, ...r }) => r, "request.attempt is required"],
  ["a wrong shape", (r) => ({ ...r, product: [] }), "request.product must be an object"],
  [
    "a date-only instant",
    (r) => ({ ...r, requestedAt: "2026-09-21" }),
    "request.requestedAt is not a v1 key",
  ],
  ["a range violation", (r) => ({ ...r, issue: 0 }), "request.issue must be 1..2147483647"],
  ["a foreign run", (r) => ({ ...r, run: "other-run" }), "request.run is not the bound run"],
  [
    "an oversize request",
    () => sizedRequest(NATIVE_DB_REQUEST_LIMIT + 1),
    `request exceeds ${NATIVE_DB_REQUEST_LIMIT} UTF-8 bytes`,
  ],
])("refuses %s locally through the composed method", async (_, mutate, diagnostic) => {
  const c = composed();
  const {
    schemaVersion: _schema,
    correlation: _correlation,
    ...identity
  } = mutate(minimalRequest()) as Request;
  expect(await c.native.nativeDbProfile(identity as never)).toEqual(
    refusedLocally(`native-db-request-invalid: ${diagnostic}`),
  );
  await c.flush();
  expect(c.written).toEqual([]);
});

it("refuses a pending duplicate and two closed-state replays without reaching the stream", async () => {
  const c = composed();
  const first = c.native.nativeDbProfile(c.identity());
  expect(await c.native.nativeDbProfile(c.identity())).toEqual(
    refusedLocally("native-db-request-pending"),
  );
  await c.flush();
  expect(c.written).toHaveLength(1);
  c.admission.close();
  expect(await first).toEqual({
    correlation: 1,
    status: "unknown",
    owner: null,
    evidencePath: null,
    diagnostic: "native-db-channel-closed",
  });
  for (let replay = 0; replay < 2; replay += 1)
    expect(await c.native.nativeDbProfile(c.identity())).toEqual(
      refusedLocally("native-db-channel-closed"),
    );
  await c.flush();
  expect(c.written).toHaveLength(1);
});

// ISS-198: final agent messages and terminal events copied verbatim from the
// m1-iss167-20260921T1457 reviewer traces 75f8e370 (attempt 1, trace SHA-256
// 9931b66657035883bdc833a8953e865fb6cb2c634f04b695ba55e09186c68770) and
// 12ba7a5d (attempt 2, trace SHA-256
// 2ed56fa9a05269f7218368ab13f70eb4245b015755b979987216292ef1aedb85). Both
// exited {"code":0,"signal":null} with schema-valid PASS verdicts and were
// discarded as malformed: the first for its closing fence, the second for
// measuring 2036 characters against the old 2000-character bound.
const iss167Config = { ...config, run: "m1-iss167-20260921T1457" };
const fencedMessage = fencedReview[1]!.item!.text;
const fencedPayload = fencedMessage.slice(
  fencedMessage.indexOf("{"),
  fencedMessage.lastIndexOf("}") + 1,
);
const longMessage = longReview[1]!.item!.text;
const reviewerEvents = (events: typeof fencedReview, text: string) => {
  const copy = structuredClone(events);
  copy[1]!.item!.text = text;
  return copy;
};
async function observeReviewer(
  events: typeof fencedReview,
  current: Config = iss167Config,
  pid = 999_999,
) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-iss198-")));
  cleanup.push(root);
  const attempt = {
    id: events[0]!.thread_id!,
    pid,
    trace: resolve(root, "reviewer.jsonl"),
    launchedAt: 1,
  };
  await writeFile(attempt.trace, trace(events));
  await writeFile(resolve(root, "reviewer.exit.json"), JSON.stringify({ code: 0 }));
  return codexAdapter().observe(
    "reviewer",
    { ...current, reviewWorktree: resolve(import.meta.dirname, "../..") },
    attempt,
  );
}
it("accepts the verbatim fenced 75f8e370 report exactly as its unfenced payload", async () => {
  expect(fencedMessage).toHaveLength(1376);
  expect(fencedMessage).toContain("\n\n```json\n{");
  expect(fencedMessage.endsWith("}\n```")).toBe(true);
  const verdict = JSON.parse(fencedPayload);
  const expected = {
    id: fencedReview[0]!.thread_id,
    status: "passed",
    head: "fc58af568f759ca45ca184734d272177f28a6077",
    summary: JSON.stringify(verdict),
    usage: fencedReview[2]!.usage,
  };
  expect(parseTrace(trace(fencedReview), true, "reviewer", iss167Config)).toEqual(expected);
  await expect(observeReviewer(fencedReview)).resolves.toEqual(expected);
  expect(parseReview(expected.summary, iss167Config.run, expected.head)).toEqual(verdict);
  // The identical payload without its fence, with its prose, and alone.
  const unfenced = fencedMessage.replace("```json\n", "").replace(/\n```$/, "");
  expect(unfenced).toBe(
    `${fencedMessage.slice(0, fencedMessage.indexOf("```json"))}${fencedPayload}`,
  );
  for (const text of [unfenced, fencedPayload, `\`\`\`json\n${fencedPayload}\n\`\`\``])
    expect(
      parseTrace(trace(reviewerEvents(fencedReview, text)), true, "reviewer", iss167Config),
    ).toEqual(expected);
});
it("accepts the verbatim 2036-character 12ba7a5d report and refuses one character above the bound", async () => {
  expect(longMessage).toHaveLength(2036);
  const verdict = JSON.parse(longMessage);
  expect(JSON.stringify(verdict)).toBe(longMessage);
  // The stated bound admits the recorded report with stated headroom and stays finite.
  expect(MAX_TERMINAL_SUMMARY_LENGTH).toBe(4000);
  expect(MAX_TERMINAL_SUMMARY_LENGTH - longMessage.length).toBe(1964);
  const expected = {
    id: longReview[0]!.thread_id,
    status: "passed",
    head: "6730bbb7346893872bc49d41ddb42d4b506f8912",
    summary: longMessage,
    usage: longReview[2]!.usage,
  };
  expect(parseTrace(trace(longReview), true, "reviewer", iss167Config)).toEqual(expected);
  await expect(observeReviewer(longReview)).resolves.toEqual(expected);
  expect(parseReview(longMessage, iss167Config.run, expected.head)).toEqual(verdict);
  const padded = JSON.stringify({
    ...verdict,
    g0: verdict.g0 + "x".repeat(MAX_TERMINAL_SUMMARY_LENGTH + 1 - longMessage.length),
  });
  expect(padded).toHaveLength(MAX_TERMINAL_SUMMARY_LENGTH + 1);
  const events = reviewerEvents(longReview, padded);
  const diagnostic = `Reviewer verdict serialized length is ${MAX_TERMINAL_SUMMARY_LENGTH + 1} characters; maximum is ${MAX_TERMINAL_SUMMARY_LENGTH}. Shorten findings and G0 to fit.`;
  expect(() => parseTrace(trace(events), true, "reviewer", iss167Config)).toThrow(
    "malformed-worker-verdict",
  );
  await expect(observeReviewer(events)).resolves.toMatchObject({
    status: "malformed",
    summary: expect.stringContaining(diagnostic),
  });
});
it("bounds the discarded-message excerpt to its stated length", () => {
  expect(MAX_VERDICT_EXCERPT_LENGTH).toBe(600);
  const short = 'short "quoted"\nmessage';
  expect(JSON.parse(verdictExcerpt(short))).toBe(short);
  expect(JSON.parse(verdictExcerpt("x".repeat(MAX_VERDICT_EXCERPT_LENGTH)))).toHaveLength(
    MAX_VERDICT_EXCERPT_LENGTH,
  );
  const long = Array.from({ length: 10_000 }, (_, index) => String(index % 10)).join("");
  const [headPart, tailPart, ...rest] = verdictExcerpt(long).split(" ... ");
  expect(rest).toEqual([]);
  expect(JSON.parse(headPart!)).toBe(long.slice(0, MAX_VERDICT_EXCERPT_LENGTH / 2));
  expect(JSON.parse(tailPart!)).toBe(long.slice(-MAX_VERDICT_EXCERPT_LENGTH / 2));
});
// Red before: the preserved iss-167-attempt-1 reviewer-attempt.json retry
// context carried only "(malformed-worker-verdict)" with no diagnostics, and the
// iss-167-attempt-2 record carried the length diagnostic with no excerpt.
it.each([
  [
    "oversized",
    () =>
      JSON.stringify({
        ...JSON.parse(longMessage),
        g0:
          JSON.parse(longMessage).g0 +
          "x".repeat(MAX_TERMINAL_SUMMARY_LENGTH + 1 - longMessage.length),
      }),
    `Reviewer verdict serialized length is ${MAX_TERMINAL_SUMMARY_LENGTH + 1} characters; maximum is ${MAX_TERMINAL_SUMMARY_LENGTH}. Shorten findings and G0 to fit.`,
  ],
  [
    "unparseable",
    () => `${fencedMessage}\nDone.`,
    "The final message does not end with exactly one JSON object, optionally inside one fenced block.",
  ],
] as const)(
  "retains the reason and a bounded excerpt of the discarded %s reviewer message",
  async (_name, message, reason) => {
    const text = message();
    const events = reviewerEvents(longReview, text);
    const terminal = await observeReviewer(events);
    expect(terminal).toMatchObject({ id: longReview[0]!.thread_id, status: "malformed" });
    expect(terminal.summary).toBe(
      `${reason} Discarded reviewer message excerpt (at most ${MAX_VERDICT_EXCERPT_LENGTH} characters, JSON-quoted): ${verdictExcerpt(text)}`,
    );
    expect(terminal.summary!.length).toBeLessThanOrEqual(MAX_TERMINAL_SUMMARY_LENGTH);
    expect(terminal.summary).toContain(JSON.stringify(text.slice(0, 40)).slice(0, -1));
    expect(terminal.summary).toContain(JSON.stringify(text.slice(-40)).slice(1));
    expect(terminal.summary).not.toContain(text.slice(200, 1800));
  },
);
const fencedBlock = fencedMessage.slice(fencedMessage.indexOf("```json"));
const reviewerWith = (patch: object) => JSON.stringify({ ...JSON.parse(longMessage), ...patch });
it.each([
  ["non-JSON prose", "Review complete. PASS.", "malformed-worker-verdict"],
  ["a truncated JSON object", longMessage.slice(0, -1), "malformed-worker-verdict"],
  ["an unknown extra key", reviewerWith({ extra: true }), "malformed-worker-verdict"],
  ["a bad head", reviewerWith({ head: "invalid" }), "malformed-worker-verdict"],
  ["a verdict outside the enum", reviewerWith({ verdict: "MAYBE" }), "malformed-worker-verdict"],
  [
    "a finding with line 0",
    reviewerWith({
      findings: [{ file: "scripts/dogfood/conflict.ts", line: 0, severity: "note", text: "x" }],
    }),
    "malformed-source-finding",
  ],
  ["two fenced blocks", `${fencedMessage}\n${fencedBlock}`, "malformed-worker-verdict"],
  ["a fenced block then trailing text", `${fencedMessage}\nDone.`, "malformed-worker-verdict"],
  ["a nested closing fence", `${fencedMessage}\n\`\`\``, "malformed-worker-verdict"],
  [
    "a closing fence without an opening fence",
    `${fencedPayload}\n\`\`\``,
    "malformed-worker-verdict",
  ],
  [
    "an opening fence beside the object",
    `\`\`\`json ${fencedPayload}\n\`\`\``,
    "malformed-worker-verdict",
  ],
])("still refuses a reviewer message with %s", async (_name, text, reason) => {
  const events = reviewerEvents(longReview, text);
  const observed = await observeReviewer(events);
  if (reason === "malformed-worker-verdict") {
    expect(() => parseTrace(trace(events), true, "reviewer", iss167Config)).toThrow(reason);
    expect(observed).toMatchObject({ status: "malformed" });
    expect(observed.summary).toContain("Discarded reviewer message excerpt");
    return;
  }
  // Transport-valid but schema-invalid: the flow's parseReview refuses it.
  expect(observed).toMatchObject({ status: "passed", head: JSON.parse(text).head });
  expect(() => parseReview(observed.summary, iss167Config.run, observed.head!)).toThrow(reason);
});
it.each([
  ["the raw payload alone", longMessage],
  ["leading prose then raw JSON with no fence", `Review complete.\n${longMessage}`],
  ["leading prose then one fenced block", `Review complete.\n\n\`\`\`json\n${longMessage}\n\`\`\``],
  ["one fenced block without prose", `\`\`\`\n${longMessage}\n\`\`\`\n`],
  ["prose, an opening fence and no closing fence", `Review complete.\n\`\`\`json\n${longMessage}`],
])("keeps accepting a reviewer message with %s", async (_name, text) => {
  const expected = parseTrace(trace(longReview), true, "reviewer", iss167Config);
  const events = reviewerEvents(longReview, text);
  expect(parseTrace(trace(events), true, "reviewer", iss167Config)).toEqual(expected);
  await expect(observeReviewer(events)).resolves.toEqual(expected);
});
it("drives every length consumer and reviewer prompt from the one exported constant", () => {
  const bound = MAX_TERMINAL_SUMMARY_LENGTH;
  expect(Number.isSafeInteger(bound) && bound > 0).toBe(true);
  expect(outputSchema(config, "author").properties.summary).toMatchObject({ maxLength: bound });
  for (const role of ["author", "reviewer"] as const)
    expect(workerPrompt(config, role, head, "brief")).toContain(`at most ${bound} characters`);
  expect(sourceReviewerReportPrompt(["a.ts"])).toContain(
    `Keep the complete JSON report within ${bound} characters.`,
  );
  // The fully assembled source-stage reviewer prompt is the flow report text
  // plus the queue's suffix; every stated length in it is the constant.
  const assembled = `${workerPrompt(config, "reviewer", head, "brief")}\n\n${sourceReviewerReportPrompt(["a.ts"])}\n`;
  const stated = [...assembled.matchAll(/(\d+) characters/g)].map((match) => Number(match[1]));
  expect(stated).toEqual([bound, bound]);
  const review = JSON.parse(rows[1]!.item!.text);
  const fitted = {
    ...review,
    g0: "x".repeat(bound - JSON.stringify({ ...review, g0: "" }).length),
  };
  expect(JSON.stringify(fitted)).toHaveLength(bound);
  expect(parseReview(JSON.stringify(fitted), config.run, head)).toEqual(fitted);
  expect(() =>
    parseReview(JSON.stringify({ ...fitted, g0: `${fitted.g0}x` }), config.run, head),
  ).toThrow("source-review-summary-out-of-bounds");
  const author = parseTrace(
    trace(
      authorEvents(
        `Work complete.\n${JSON.stringify({ ...authorVerdict, summary: "x".repeat(bound) })}`,
      ),
    ),
    true,
    "author",
    config,
  );
  expect(author.summary).toHaveLength(bound);
  expect(() =>
    parseTrace(
      trace(
        authorEvents(
          `Work complete.\n${JSON.stringify({ ...authorVerdict, summary: "x".repeat(bound + 1) })}`,
        ),
      ),
      true,
      "author",
      config,
    ),
  ).toThrow(QueueBlocked);
});
it("leaves no superseded 2000-character literal under scripts/ or docs/", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const { readdir } = await import("node:fs/promises");
  const files = (
    await Promise.all(
      ["scripts", "docs"].map((directory) =>
        readdir(resolve(root, directory), { recursive: true, withFileTypes: true }),
      ),
    )
  )
    .flat()
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
  expect(files.some((file) => file.endsWith("terminal-summary.d.mts"))).toBe(true);
  const offenders: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const [index, line] of text.split("\n").entries())
      if (/(?<![\d_.])2_?000(?![\d_])/.test(line))
        offenders.push(`${file.slice(root.length + 1)}:${index + 1}: ${line.trim()}`);
  }
  expect(offenders).toEqual([]);
  expect(await readFile(resolve(root, "scripts/dogfood/terminal-summary.d.mts"), "utf8")).toContain(
    "export const MAX_TERMINAL_SUMMARY_LENGTH: number;",
  );
});
