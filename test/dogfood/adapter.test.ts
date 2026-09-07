import { execFile } from "node:child_process";
import { mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
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
      text: JSON.stringify({ run: "trial", role: "reviewer", head, verdict: "PASS" }),
    },
  },
  { type: "turn.completed", usage: { input_tokens: 12, output_tokens: 8 } },
];
const trace = (events = rows) => events.map((row) => JSON.stringify(row)).join("\n") + "\n";
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
it("drops parent Desktop context and delivery credentials without changing auth location or the parent environment", () => {
  const parent = {
    CODEX_APP_TOOLS_PIPE_PATH: "synthetic-pipe",
    CODEX_PERMISSION_PROFILE: "synthetic-parent-permissions",
    CODEX_THREAD_ID: "synthetic-thread",
    CODEX_SESSION_ID: "synthetic-session",
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "synthetic-desktop",
    CODEX_CI: "1",
    CODEX_SHELL: "1",
    codex_permission_profile: "synthetic-case-alias",
    GH_TOKEN: "synthetic-gh-token",
    gh_token: "synthetic-gh-token-case-alias",
    GITHUB_TOKEN: "synthetic-github-token",
    github_token: "synthetic-github-token-case-alias",
    GITHUB_PERSONAL_ACCESS_TOKEN: "synthetic-github-personal-access-token",
    github_personal_access_token: "synthetic-github-personal-access-token-case-alias",
    GH_ENTERPRISE_TOKEN: "synthetic-gh-enterprise-token",
    gh_enterprise_token: "synthetic-gh-enterprise-token-case-alias",
    GITHUB_ENTERPRISE_TOKEN: "synthetic-github-enterprise-token",
    github_enterprise_token: "synthetic-github-enterprise-token-case-alias",
    CODEX_HOME: "synthetic-auth-home",
    APPDATA: "synthetic-appdata",
    PATH: "synthetic-bin",
    UNRELATED: "synthetic-value",
  };
  const before = { ...parent };
  expect(workerEnvironment(parent)).toEqual({
    CODEX_HOME: "synthetic-auth-home",
    APPDATA: "synthetic-appdata",
    PATH: "synthetic-bin",
    UNRELATED: "synthetic-value",
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
  });
  expect(parseTrace(trace() + '{"partial":', false, "reviewer", config, id).status).toBe("running");
});
it("accepts legacy verdicts and bounds optional advisory summaries", () => {
  expect(parseTrace(trace(), true, "reviewer", config, id)).not.toHaveProperty("summary");
  const verdict = (summary: unknown) =>
    trace([
      rows[0]!,
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: JSON.stringify({ run: "trial", role: "reviewer", head, verdict: "PASS", summary }),
        },
      },
      rows[2]!,
    ]);
  expect(parseTrace(verdict("actionable finding"), true, "reviewer", config, id).summary).toBe(
    "actionable finding",
  );
  expect(parseTrace(verdict(7), true, "reviewer", config, id)).not.toHaveProperty("summary");
  expect(parseTrace(verdict("x".repeat(2100)), true, "reviewer", config, id).summary).toBe(
    "x".repeat(2000),
  );
});
it("requests a bounded summary for new outputs without changing verdict authority fields", () => {
  const schema = outputSchema(config, "reviewer");
  expect(schema.required).toEqual(["run", "role", "head", "verdict", "summary"]);
  expect(schema.properties.summary).toMatchObject({ type: "string", maxLength: 2000 });
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
it("refuses a CLI without the observed native interface before launching", async () => {
  await expect(codexAdapter().preflight(config)).rejects.toThrow();
});
const cleanup: string[] = [];
afterEach(async () => {
  for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true });
});
it("keeps fake provider observation alive after controller exit and filters its parent context", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "dogfood-process-")));
  cleanup.push(root);
  const request = resolve(root, "request.json"),
    stdin = resolve(root, "prompt.txt");
  await writeFile(stdin, "finite prompt");
  await writeFile(
    request,
    JSON.stringify({
      executable: process.execPath,
      args: [resolve(import.meta.dirname, "fixtures/provider.mjs")],
      stdin,
      stdout: resolve(root, "trace.jsonl"),
      stderr: resolve(root, "stderr.log"),
      identity: resolve(root, "identity.json"),
      done: resolve(root, "exit.json"),
    }),
  );
  await promisify(execFile)(
    process.execPath,
    [resolve(import.meta.dirname, "fixtures/controller.mjs"), request],
    {
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_HOME: "synthetic-auth-home",
        CODEX_PERMISSION_PROFILE: "synthetic-parent-permissions",
        CODEX_APP_TOOLS_PIPE_PATH: "synthetic-pipe",
        GH_TOKEN: "synthetic-gh-token",
        gh_token: "synthetic-gh-token-case-alias",
        GITHUB_TOKEN: "synthetic-github-token",
        github_token: "synthetic-github-token-case-alias",
        GITHUB_PERSONAL_ACCESS_TOKEN: "synthetic-github-personal-access-token",
        github_personal_access_token: "synthetic-github-personal-access-token-case-alias",
        GH_ENTERPRISE_TOKEN: "synthetic-gh-enterprise-token",
        gh_enterprise_token: "synthetic-gh-enterprise-token-case-alias",
        GITHUB_ENTERPRISE_TOKEN: "synthetic-github-enterprise-token",
        github_enterprise_token: "synthetic-github-enterprise-token-case-alias",
        DOGFOOD_VERIFY_ENV: "1",
      },
    },
  );
  let exit;
  for (let count = 0; count < 100; count++) {
    try {
      exit = JSON.parse(await readFile(resolve(root, "exit.json"), "utf8"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  expect(exit).toEqual({ code: 0, signal: null });
  expect(JSON.parse(await readFile(resolve(root, "identity.json"), "utf8")).pid).toBeGreaterThan(0);
  expect(await readFile(resolve(root, "trace.jsonl"), "utf8")).toBe("finite prompt\n");
});
