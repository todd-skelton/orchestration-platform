import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { build } from "esbuild";
import {
  runIss002CrossRootWalk,
  runIss002WalkIntervals,
  runIss002WalkObservation,
} from "../../packages/conformance/src/index.js";

const walkIo = vi.hoisted(() => ({ refuseExecutionCleanup: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    async rm(...arguments_: Parameters<typeof original.rm>) {
      if (
        walkIo.refuseExecutionCleanup &&
        String(arguments_[0]).includes("orchestration-iss002-execution-")
      )
        throw new Error("injected execution cleanup refusal");
      return original.rm(...arguments_);
    },
  };
});

const temporaryRoots: string[] = [];
const childScriptPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/iss002-walk-child.mjs",
);

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-iss002-walk-"));
  const canonicalRoot = await realpath(root);
  temporaryRoots.push(canonicalRoot);
  return canonicalRoot;
}

async function candidateRoot(): Promise<string> {
  const root = await temporaryRoot();
  await mkdir(resolve(root, "packages"));
  await cp(
    resolve(import.meta.dirname, "../../packages/contracts"),
    resolve(root, "packages/contracts"),
    { recursive: true },
  );
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
  walkIo.refuseExecutionCleanup = false;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("ISS-002 1,000-record walk", () => {
  test("builds stable and candidate contracts from separate roots into an external execution root", async () => {
    const candidate = await candidateRoot();
    const executionParent = await temporaryRoot();
    const result = await runIss002CrossRootWalk({
      candidateRoot: candidate,
      executionParent,
      stableRoot: resolve(import.meta.dirname, "../.."),
    });
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.ok).toBe(true);
    expect(await readdir(executionParent)).toEqual([]);
  }, 600_000);

  test("refuses equal, nested, escaping-import, and symlinked candidate roots", async () => {
    const stableRoot = resolve(import.meta.dirname, "../..");
    const executionParent = await temporaryRoot();
    expect(
      (await runIss002CrossRootWalk({ candidateRoot: stableRoot, executionParent, stableRoot })).ok,
    ).toBe(false);
    const candidate = await candidateRoot();
    expect(
      (
        await runIss002CrossRootWalk({
          candidateRoot: resolve(candidate, "packages"),
          executionParent,
          stableRoot: candidate,
        })
      ).ok,
    ).toBe(false);
    await writeFile(resolve(candidate, "outside.mjs"), "export const outside = true;\n", "utf8");
    await writeFile(
      resolve(candidate, "packages/contracts/src/index.ts"),
      'export * from "../../../outside.mjs";\n',
      "utf8",
    );
    expect(
      (await runIss002CrossRootWalk({ candidateRoot: candidate, executionParent, stableRoot })).ok,
    ).toBe(false);
    await writeFile(
      resolve(candidate, "packages/contracts/src/index.ts"),
      'import "node:child_process";\nexport * from "./authority.js";\n',
      "utf8",
    );
    expect(
      (await runIss002CrossRootWalk({ candidateRoot: candidate, executionParent, stableRoot })).ok,
    ).toBe(false);
    const linkedCandidate = await temporaryRoot();
    await mkdir(resolve(linkedCandidate, "packages"));
    await symlink(
      resolve(stableRoot, "packages/contracts"),
      resolve(linkedCandidate, "packages/contracts"),
      "junction",
    );
    expect(
      (
        await runIss002CrossRootWalk({
          candidateRoot: linkedCandidate,
          executionParent,
          stableRoot,
        })
      ).ok,
    ).toBe(false);
    expect(await readdir(executionParent)).toEqual([]);
  });

  test("refuses hostile cross-root inputs without invoking candidate reflection", async () => {
    const base = {
      candidateRoot: await candidateRoot(),
      executionParent: await temporaryRoot(),
      stableRoot: resolve(import.meta.dirname, "../.."),
    };
    let getterCalls = 0;
    let proxyTrapCalls = 0;
    const accessor = {
      candidateRoot: base.candidateRoot,
      executionParent: base.executionParent,
    };
    Object.defineProperty(accessor, "stableRoot", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return base.stableRoot;
      },
    });
    const throwingProxy = new Proxy(base, {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error("proxy trap must not run");
      },
    });
    const nonenumerable = { ...base };
    Object.defineProperty(nonenumerable, "candidate", { value: true });
    for (const input of [
      undefined,
      null,
      { ...base, candidateRoot: 1 },
      { ...base, candidate: true },
      { ...base, [Symbol("candidate")]: true },
      nonenumerable,
      Object.assign(Object.create({ candidate: true }) as object, base),
      vm.runInNewContext(`(${JSON.stringify(base)})`),
      new Proxy(base, {}),
      throwingProxy,
      accessor,
    ])
      await expect(
        runIss002CrossRootWalk(input as Parameters<typeof runIss002CrossRootWalk>[0]),
      ).resolves.toEqual({ issues: ["walk:cross-root-input-refused"], ok: false });
    expect(getterCalls).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  test("refuses computed dynamic import and require dependencies before candidate execution", async () => {
    const stableRoot = resolve(import.meta.dirname, "../..");
    const candidate = await candidateRoot();
    const executionParent = await temporaryRoot();
    const candidateIndex = resolve(candidate, "packages/contracts/src/index.ts");
    const stableIndex = await readFile(
      resolve(stableRoot, "packages/contracts/src/index.ts"),
      "utf8",
    );
    for (const dynamicSource of [
      `const specifier = "node:" + "fs";
const dynamicModule = await import(specifier);
dynamicModule.writeFileSync(${JSON.stringify(resolve(candidate, "dynamic-import-executed"))}, "executed");
`,
      `process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(resolve(candidate, "get-builtin-executed"))}, "executed");
`,
      `const load = process.getBuiltinModule("node:module").createRequire(import.meta.url);
load("node:fs").writeFileSync(${JSON.stringify(resolve(candidate, "dynamic-require-executed"))}, "executed");
`,
      `process.get\\u0042uiltinModule("node:fs").writeFileSync(${JSON.stringify(resolve(candidate, "escaped-builtin-executed"))}, "executed");
`,
    ]) {
      await writeFile(candidateIndex, `${dynamicSource}${stableIndex}`, "utf8");
      expect(
        (await runIss002CrossRootWalk({ candidateRoot: candidate, executionParent, stableRoot }))
          .ok,
      ).toBe(false);
    }
    await expect(readFile(resolve(candidate, "dynamic-import-executed"))).rejects.toThrow();
    await expect(readFile(resolve(candidate, "get-builtin-executed"))).rejects.toThrow();
    await expect(readFile(resolve(candidate, "dynamic-require-executed"))).rejects.toThrow();
    await expect(readFile(resolve(candidate, "escaped-builtin-executed"))).rejects.toThrow();
    expect(await readdir(executionParent)).toEqual([]);
  });

  test("fails closed when the external execution root cannot be removed", async () => {
    const candidate = await candidateRoot();
    const executionParent = await temporaryRoot();
    walkIo.refuseExecutionCleanup = true;
    const result = await runIss002CrossRootWalk({
      candidateRoot: candidate,
      executionParent,
      stableRoot: resolve(import.meta.dirname, "../.."),
    });
    walkIo.refuseExecutionCleanup = false;
    expect(result).toEqual({ issues: ["walk:execution-root-cleanup-refused"], ok: false });
    expect(
      (await readdir(executionParent)).some((name) =>
        name.startsWith("orchestration-iss002-execution-"),
      ),
    ).toBe(true);
  });

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

  test("retains exact child stream bytes without changing the semantic result", async () => {
    const root = await temporaryRoot();
    const stdout = '{"issues":[],"recordCount":"1000"}';
    const script = await child(root, `process.stdout.write(${JSON.stringify(stdout)});`);
    const input = {
      candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
      childScriptPath: script,
      stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
      workingDirectory: root,
    };
    const observed = await runIss002WalkObservation(input);
    expect(observed.ok).toBe(true);
    expect(Buffer.from(observed.stdoutBytes).equals(Buffer.from(stdout.repeat(3), "utf8"))).toBe(
      true,
    );
    expect(observed.stderrBytes.byteLength).toBe(0);
    const semantic = await runIss002WalkIntervals(input);
    expect(semantic.ok).toBe(true);
    expect(semantic).not.toHaveProperty("stdoutBytes");
    expect(semantic).not.toHaveProperty("stderrBytes");
  });

  test("retains exact failed child streams and refuses invalid UTF-8", async () => {
    const root = await temporaryRoot();
    const script = await child(
      root,
      "process.stdout.write(Buffer.from([0xff])); process.stderr.write(Buffer.from([0x00,0xfe])); process.exit(1);",
    );
    const observed = await runIss002WalkObservation({
      candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
      childScriptPath: script,
      stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
      workingDirectory: root,
    });
    expect(observed).toMatchObject({ issues: ["walk.0:child-failed"], ok: false });
    expect([...observed.stdoutBytes]).toEqual([0xff]);
    expect([...observed.stderrBytes]).toEqual([0x00, 0xfe]);

    const invalidUtf8 = await runIss002WalkObservation({
      candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
      childScriptPath: await child(root, "process.stdout.write(Buffer.from([0xff]));"),
      stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
      workingDirectory: root,
    });
    expect(invalidUtf8).toMatchObject({ issues: ["walk.0:json-refused"], ok: false });
    expect([...invalidUtf8.stdoutBytes]).toEqual([0xff]);
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
process.stdout.write(JSON.stringify({issues,recordCount:"1000"}));
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

  test("refuses malformed and reflective walk input without invoking accessors", async () => {
    const root = await temporaryRoot();
    const base = {
      candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
      childScriptPath: await child(root, "process.exit(0);"),
      stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
      workingDirectory: root,
    };
    let getterCalls = 0;
    const accessor = { ...base };
    Object.defineProperty(accessor, "workingDirectory", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return root;
      },
    });
    const nonenumerable = { ...base };
    Object.defineProperty(nonenumerable, "candidate", { value: true });
    const symbolic = { ...base, [Symbol("candidate")]: true };
    const exotic = Object.assign(Object.create({ candidate: true }) as object, base);
    const crossRealm = vm.runInNewContext(`(${JSON.stringify(base)})`) as unknown;
    let proxyTrapCalls = 0;
    const throwingProxy = new Proxy(base, {
      getPrototypeOf() {
        proxyTrapCalls += 1;
        throw new Error("proxy trap must not run");
      },
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error("proxy trap must not run");
      },
    });
    for (const input of [
      undefined,
      null,
      1,
      { ...base, workingDirectory: undefined },
      { ...base, candidate: true },
      nonenumerable,
      symbolic,
      exotic,
      crossRealm,
      new Proxy(base, {}),
      throwingProxy,
      accessor,
    ])
      await expect(
        runIss002WalkIntervals(input as unknown as Parameters<typeof runIss002WalkIntervals>[0]),
      ).resolves.toEqual({ issues: ["walk:input-refused"], ok: false });
    expect(getterCalls).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  test("publishes the stable-parent maximum over complete launch-to-terminal intervals", async () => {
    const root = await temporaryRoot();
    const audit = resolve(root, "interval.txt");
    const script = await child(
      root,
      `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const path = ${JSON.stringify(audit)};
const index = existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
writeFileSync(path, String(index + 1));
process.stdout.write(JSON.stringify({issues:[],recordCount:"1000"}));
`,
    );
    const result = await runIss002WalkIntervals({
      candidateModuleUrl: pathToFileURL(resolve(root, "unused.mjs")).href,
      childScriptPath: script,
      stableModuleUrl: pathToFileURL(resolve(root, "stable-unused.mjs")).href,
      workingDirectory: root,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.durationsNanoseconds).toHaveLength(3);
    expect(result.durationsNanoseconds.every((value) => BigInt(value) > 0n)).toBe(true);
    expect(result.maximumWalkDurationNanoseconds).toBe(
      result.durationsNanoseconds.reduce((maximum, value) =>
        BigInt(value) > BigInt(maximum) ? value : maximum,
      ),
    );
    const parentSource = await readFile(
      resolve(import.meta.dirname, "../../packages/conformance/src/walk.ts"),
      "utf8",
    );
    expect(parentSource.indexOf("const started = monotonicNanoseconds()")).toBeLessThan(
      parentSource.indexOf("const result = await execFileAsync"),
    );
    expect(parentSource.indexOf("const result = await execFileAsync")).toBeLessThan(
      parentSource.indexOf("const durationNanoseconds = monotonicNanoseconds() - started"),
    );
    expect(await readFile(childScriptPath, "utf8")).not.toContain("durationNanoseconds");
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

  test("refuses forged duration, stderr, semantic issues, and malformed output", async () => {
    const root = await temporaryRoot();
    for (const source of [
      'process.stdout.write(JSON.stringify({durationNanoseconds:"5000000001",issues:[],recordCount:"1000"}));',
      'process.stderr.write("diagnostic"); process.stdout.write(JSON.stringify({issues:[],recordCount:"1000"}));',
      'process.stdout.write(JSON.stringify({issues:["bad"],recordCount:"1000"}));',
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
