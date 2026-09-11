import { execFile } from "node:child_process";
import { mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  WORKER_ENVIRONMENT_ALLOWLIST,
  WINDOWS_WORKER_ENVIRONMENT_ALLOWLIST,
  codexAdapter,
  launchArguments,
  outputSchema,
  parseTrace,
  workerEnvironment,
} from "../../scripts/dogfood/dispatch-adapter.js";
import type { Config } from "../../scripts/dogfood/flow.js";

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
const trace = (events = rows) => events.map((row) => JSON.stringify(row)).join("\n") + "\n";
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
      expect(args.includes('windows.sandbox="unelevated"')).toBe(platform === "win32");
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
  expect(author).toContain("sandbox_workspace_write.writable_roots=[]");
  expect(reviewer).toContain("read-only");
  expect(reviewer).not.toContain("--add-dir");
  expect(reviewer).toContain("--ignore-user-config");
  expect(reviewer).toContain("--ignore-rules");
  expect(reviewer).toContain("--output-schema");
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
it("observes a missing exit receipt for one configured window before a typed stop", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-exit-wait-")));
  cleanup.push(root);
  let now = 1_000;
  const current = {
    ...config,
    stateDirectory: root,
    exitReceiptWindowMs: 500,
  };
  const attempt = { id, pid: 999_999, trace: resolve(root, "author.jsonl") };
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  try {
    const adapter = codexAdapter("git", () => now);
    await expect(adapter.observe("author", current, attempt)).resolves.toEqual({
      id,
      status: "running",
    });
    expect(JSON.parse(await readFile(resolve(root, "author.exit-wait.json"), "utf8"))).toEqual({
      reason: "delayed-exit-receipt",
      count: 1,
      attempt: id,
      observedAt: 1_000,
    });
    now = 1_499;
    await expect(adapter.observe("author", current, attempt)).resolves.toMatchObject({
      status: "running",
    });
    now = 1_500;
    await expect(adapter.observe("author", current, attempt)).rejects.toThrow(
      "exit-receipt-timeout",
    );
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
