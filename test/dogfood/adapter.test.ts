import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  WORKER_ENVIRONMENT_ALLOWLIST,
  WINDOWS_WORKER_ENVIRONMENT_ALLOWLIST,
  authorTemporaryRoot,
  codexAdapter,
  launchArguments,
  outputSchema,
  parseTrace,
  probeProvider,
  waitForProvider,
  DEFAULT_PROVIDER_OUTAGE_CEILING_MS,
  workerEnvironment,
} from "../../scripts/dogfood/dispatch-adapter.js";
import type { Config } from "../../scripts/dogfood/flow.js";
import { parseReview } from "../../scripts/dogfood/repair-policy.mjs";
import overlengthReview from "./fixtures/iss-150-overlength.json" with { type: "json" };
import prefixedReview from "./fixtures/iss-150-prefixed.json" with { type: "json" };

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
      { type: "error", message: `${"x".repeat(2100)} http://pool.test/v1/responses` },
    ]),
    true,
    "author",
    config,
    id,
    true,
    "http://pool.test/v1",
  );
  expect(terminal.summary).toHaveLength(2000);
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
it.skipIf(process.platform === "win32")(
  "uses the worker auth helper for every models probe and rejects HTTP errors",
  async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "provider-probe-")));
    cleanup.push(root);
    const helper = resolve(root, "auth.sh");
    await writeFile(helper, "#!/bin/sh\nprintf 'test-provider-key\\n'\n", { mode: 0o700 });
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const signal = AbortSignal.timeout(5_000);
    await expect(probeProvider("http://pool.test/v1/", helper, signal, request)).rejects.toThrow(
      "HTTP 503",
    );
    expect(request).toHaveBeenCalledWith("http://pool.test/v1/models", {
      headers: { Authorization: "Bearer test-provider-key" },
      signal,
    });
    await writeFile(helper, "#!/bin/sh\nprintf 'refreshed-key\\n'\n");
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
    let now = 0;
    const waits: number[] = [];
    await expect(
      waitForProvider(
        { ...config, providerOutageCeilingMs: 10 },
        (probeSignal) =>
          probeProvider("http://pool.test/v1", helper, probeSignal, request, "claude-opus-5"),
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
  expect(() => parseTrace(verdict("x".repeat(2000)), true, "reviewer", config, id)).toThrow(
    "malformed-worker-verdict",
  );
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
it.each([2276, 2302])(
  "rejects an otherwise valid %i-character verdict only for length and records the diagnostic",
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
    const diagnostic = `Reviewer verdict serialized length is ${length} characters; maximum is 2000. Shorten findings and G0 to fit.`;
    expect(() => parseTrace(trace(events), true, "reviewer", preservedConfig)).toThrow(
      "malformed-worker-verdict",
    );
    await writeFile(attempt.trace, trace(events));
    await writeFile(resolve(root, "reviewer.exit.json"), JSON.stringify({ code: 0 }));
    await expect(
      codexAdapter().observe(
        "reviewer",
        { ...preservedConfig, reviewWorktree: resolve(import.meta.dirname, "../..") },
        attempt,
      ),
    ).resolves.toMatchObject({ status: "malformed", summary: diagnostic });
  },
);
it.each([2000, 2001])("enforces the serialized review boundary at %i characters", (length) => {
  const verdict = JSON.parse(rows[1]!.item!.text);
  verdict.g0 = "";
  verdict.g0 = "x".repeat(length - JSON.stringify(verdict).length);
  const events = structuredClone(rows);
  // Message whitespace is excluded from the serialized-object limit.
  events[1]!.item!.text = `Review complete.\n${JSON.stringify(verdict, null, 2)}\n`;
  const parse = () => parseTrace(trace(events), true, "reviewer", config);
  if (length === 2000) expect(parse().summary).toHaveLength(2000);
  else expect(parse).toThrow("malformed-worker-verdict");
});
it.each([
  "I inspected call({ option: true })",
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
it("continues requiring an author verdict to occupy the whole final message", () => {
  const events = structuredClone(rows);
  const verdict = { run: config.run, role: "author", head, verdict: "PASS", summary: "" };
  events[1]!.item!.text = JSON.stringify(verdict);
  expect(parseTrace(trace(events), true, "author", config).status).toBe("passed");
  events[1]!.item!.text = `Work complete.\n${JSON.stringify(verdict)}`;
  expect(() => parseTrace(trace(events), true, "author", config)).toThrow(
    "malformed-worker-verdict",
  );
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
  for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true });
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
