import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { build } from "esbuild";
import { runIss002WalkIntervals } from "../../packages/conformance/src/index.js";

const temporaryRoots: string[] = [];
const childScriptPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/iss002-walk-child.mjs",
);

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-iss002-walk-"));
  temporaryRoots.push(root);
  return root;
}

async function bundledModules(
  root: string,
): Promise<{ readonly candidateModuleUrl: string; readonly stableModuleUrl: string }> {
  const stable = resolve(root, "stable-contracts.mjs");
  const candidate = resolve(root, "candidate-contracts.mjs");
  await build({
    bundle: true,
    entryPoints: [resolve(import.meta.dirname, "../../packages/contracts/src/index.ts")],
    external: ["node:*"],
    format: "esm",
    minify: false,
    outfile: stable,
    platform: "node",
    sourcemap: false,
    target: "node24",
    treeShaking: false,
  });
  await copyFile(stable, candidate);
  return {
    candidateModuleUrl: pathToFileURL(candidate).href,
    stableModuleUrl: pathToFileURL(stable).href,
  };
}

async function child(root: string, source: string): Promise<string> {
  const path = resolve(root, `child-${Math.random().toString(16).slice(2)}.mjs`);
  await writeFile(path, source, "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("ISS-002 1,000-record walk", () => {
  test("runs parse, full validation, and selected-head equality in three fresh processes", async () => {
    const root = await temporaryRoot();
    const modules = await bundledModules(root);
    const result = await runIss002WalkIntervals({
      ...modules,
      childScriptPath,
      workingDirectory: root,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.durationsNanoseconds).toHaveLength(3);
    expect(
      result.durationsNanoseconds.every((duration) => BigInt(duration) <= 5_000_000_000n),
    ).toBe(true);
    expect(result.maximumWalkDurationNanoseconds).toBe(
      result.durationsNanoseconds.reduce((maximum, duration) =>
        BigInt(duration) > BigInt(maximum) ? duration : maximum,
      ),
    );
  });

  test("proves three distinct children and the exact child environment allowlist", async () => {
    const root = await temporaryRoot();
    const audit = resolve(root, "pids.txt");
    const expectedEnvironment = Object.fromEntries(
      Object.entries({
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
        LANG: "C",
        LC_ALL: "C",
        TEMP: root,
        TMP: root,
        TMPDIR: root,
        TZ: "UTC",
      }).sort(([left], [right]) => left.localeCompare(right)),
    );
    const script = await child(
      root,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(audit)}, String(process.pid) + "\\n");
const observed = Object.fromEntries(Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)));
const issues = JSON.stringify(observed) === ${JSON.stringify(JSON.stringify(expectedEnvironment))} ? [] : ["environment:census-mismatch"];
if (process.cwd() !== ${JSON.stringify(root)}) issues.push("cwd:mismatch");
process.stdout.write(JSON.stringify({durationNanoseconds:"1",issues,recordCount:"1000"}));
`,
    );
    const ambientKeys = [
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "CI",
      "GITHUB_TOKEN",
      "NODE_OPTIONS",
      "ORCHESTRATION_SECRET",
      "PATH",
      "RUNNER_OS",
    ] as const;
    const prior = new Map(ambientKeys.map((key) => [key, process.env[key]]));
    let result: Awaited<ReturnType<typeof runIss002WalkIntervals>> | undefined;
    try {
      for (const key of ambientKeys) process.env[key] = `poison-${key}`;
      result = await runIss002WalkIntervals({
        candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
        childScriptPath: script,
        stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
        workingDirectory: root,
      });
    } finally {
      for (const [key, value] of prior)
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    expect(result?.ok).toBe(true);
    const pids = (await readFile(audit, "utf8")).trim().split("\n");
    expect(pids).toHaveLength(3);
    expect(new Set(pids).size).toBe(3);
  });

  test("refuses a relative child working directory", async () => {
    const root = await temporaryRoot();
    const result = await runIss002WalkIntervals({
      candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
      childScriptPath: await child(root, "process.exit(0);"),
      stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
      workingDirectory: ".",
    });
    expect(result).toEqual({ issues: ["workingDirectory:absolute-required"], ok: false });
  });

  test("publishes the exact maximum and keeps parse and validation inside the interval", async () => {
    const root = await temporaryRoot();
    const audit = resolve(root, "interval.txt");
    const script = await child(
      root,
      `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const path = ${JSON.stringify(audit)};
const index = existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
writeFileSync(path, String(index + 1));
const values = ["1", "10", "100"];
process.stdout.write(JSON.stringify({durationNanoseconds:values[index],issues:[],recordCount:"1000"}));
`,
    );
    const result = await runIss002WalkIntervals({
      candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
      childScriptPath: script,
      stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
      workingDirectory: root,
    });
    expect(result).toMatchObject({
      durationsNanoseconds: ["1", "10", "100"],
      maximumWalkDurationNanoseconds: "100",
      ok: true,
    });
    const source = await readFile(childScriptPath, "utf8");
    expect(source.indexOf("const started = monotonicNanoseconds()")).toBeLessThan(
      source.indexOf("const parsed = parseJson(inputText)"),
    );
    expect(source.indexOf("const parsed = parseJson(inputText)")).toBeLessThan(
      source.lastIndexOf("candidate.validateAuthorityHistoryChain"),
    );
    expect(source.lastIndexOf("candidate.validateAuthorityHistoryChain")).toBeLessThan(
      source.indexOf("const durationNanoseconds"),
    );
  });

  test("keeps stable and candidate bytes separate and captures timing intrinsics", async () => {
    const root = await temporaryRoot();
    const modules = await bundledModules(root);
    expect(
      (
        await runIss002WalkIntervals({
          candidateModuleUrl: modules.stableModuleUrl,
          childScriptPath,
          stableModuleUrl: modules.stableModuleUrl,
          workingDirectory: root,
        })
      ).ok,
    ).toBe(false);
    const tamperingCandidate = resolve(root, "tampering-candidate.mjs");
    await writeFile(
      tamperingCandidate,
      `process.hrtime.bigint = () => 0n;
globalThis.String = () => "0";
export function validateAuthorityHistoryChain() { return []; }
`,
      "utf8",
    );
    expect(
      (
        await runIss002WalkIntervals({
          candidateModuleUrl: pathToFileURL(tamperingCandidate).href,
          childScriptPath,
          stableModuleUrl: modules.stableModuleUrl,
          workingDirectory: root,
        })
      ).ok,
    ).toBe(true);
  });

  test("independently refuses candidate mutations of every selected-head equality input", async () => {
    const root = await temporaryRoot();
    const modules = await bundledModules(root);
    for (const mutation of [
      'records[999].ordinal = "998";',
      'records[999] = { ...records[999], retiringAuthorityTipDigest: "0".repeat(64) };',
      'selectedAuthorityValue.headRecordDigest = "0".repeat(64);',
    ]) {
      const candidate = resolve(root, `mutating-candidate-${Math.random().toString(16)}.mjs`);
      await writeFile(
        candidate,
        `export function validateAuthorityHistoryChain(records, selectedAuthorityValue) {
  ${mutation}
  return [];
}
`,
        "utf8",
      );
      const result = await runIss002WalkIntervals({
        candidateModuleUrl: pathToFileURL(candidate).href,
        childScriptPath,
        stableModuleUrl: modules.stableModuleUrl,
        workingDirectory: root,
      });
      expect(result.ok).toBe(false);
    }
  });

  test("refuses over-budget, stderr, semantic issues, and malformed output", async () => {
    const root = await temporaryRoot();
    for (const source of [
      'process.stdout.write(JSON.stringify({durationNanoseconds:"5000000001",issues:[],recordCount:"1000"}));',
      'process.stderr.write("diagnostic"); process.stdout.write(JSON.stringify({durationNanoseconds:"1",issues:[],recordCount:"1000"}));',
      'process.stdout.write(JSON.stringify({durationNanoseconds:"1",issues:["bad"],recordCount:"1000"}));',
      'process.stdout.write("not-json");',
    ]) {
      const result = await runIss002WalkIntervals({
        candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
        childScriptPath: await child(root, source),
        stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
        workingDirectory: root,
      });
      expect(result.ok).toBe(false);
    }
  });

  test("does not retry a failed interval", async () => {
    const root = await temporaryRoot();
    const audit = resolve(root, "attempts.txt");
    const script = await child(
      root,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(audit)}, "attempt\\n");
process.exit(1);
`,
    );
    const result = await runIss002WalkIntervals({
      candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
      childScriptPath: script,
      stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
      workingDirectory: root,
    });
    expect(result.ok).toBe(false);
    expect((await readFile(audit, "utf8")).trim().split("\n")).toHaveLength(1);
  });
});
