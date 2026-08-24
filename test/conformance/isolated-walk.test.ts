import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, test } from "vitest";
import { computeAuthorityHistoryRecordDigest } from "../../packages/contracts/src/index.js";
import {
  createIss002WalkChallenge,
  evaluateIss002IsolatedWalk,
  runIss002IsolatedWalk,
  type Iss002IsolatedProcessObservation,
  type Iss002IsolationLaunchRequest,
  type Iss002StableIsolationAuthority,
} from "../../packages/conformance/src/isolated-walk.js";
import { verifyLinuxCredentialStatus } from "../../packages/conformance/src/linux-credential-status.mjs";

const temporaryRoots: string[] = [];
const childScript = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/iss002-isolated-walk-child.mjs",
);

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-isolated-walk-"));
  temporaryRoots.push(root);
  return root;
}

function responseText(challenge = createIss002WalkChallenge()): string {
  void challenge;
  return JSON.stringify({ issues: [] });
}

function observation(
  overrides: Partial<Iss002IsolatedProcessObservation> = {},
): Iss002IsolatedProcessObservation {
  return {
    durationNanoseconds: "1",
    exitCode: 0,
    signal: null,
    stderr: "",
    stdout: responseText(),
    ...overrides,
  };
}

async function runChild(moduleSource: string, extraArguments: readonly string[] = []) {
  const root = await temporaryRoot();
  const candidateModule = resolve(root, "candidate.mjs");
  await writeFile(candidateModule, moduleSource, "utf8");
  const challenge = createIss002WalkChallenge();
  const child = spawn(
    process.execPath,
    [childScript, pathToFileURL(candidateModule).href, ...extraArguments],
    {
      cwd: root,
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  child.stdout.on("data", (chunk: Uint8Array) => stdout.push(Uint8Array.from(chunk)));
  child.stderr.on("data", (chunk: Uint8Array) => stderr.push(Uint8Array.from(chunk)));
  child.stdin.on("error", () => {});
  child.stdin.end(challenge.inputText);
  const terminal = await new Promise<{
    readonly code: number | null;
    readonly signal: string | null;
  }>((complete) => child.once("close", (code, signal) => complete({ code, signal })));
  return {
    challenge,
    observation: {
      durationNanoseconds: "1",
      exitCode: terminal.code,
      signal: terminal.signal,
      stderr: Buffer.concat(stderr).toString("utf8"),
      stdout: Buffer.concat(stdout).toString("utf8"),
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("ISS-002 isolated walk protocol", () => {
  test("requires every Linux kernel credential and capability relation", () => {
    const uid = 1_000_001;
    const gid = 1_000_002;
    const statusText = [
      `Uid:\t${uid}\t${uid}\t${uid}\t${uid}`,
      `Gid:\t${gid}\t${gid}\t${gid}\t${gid}`,
      "Groups:\t",
      "NoNewPrivs:\t1",
      ...["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].map(
        (field) => `${field}:\t0000000000000000`,
      ),
      "",
    ].join("\n");
    const valid = {
      effectiveGid: gid,
      effectiveUid: uid,
      expectedGid: String(gid),
      expectedUid: String(uid),
      groups: [gid],
      realGid: gid,
      realUid: uid,
      statusText,
    };
    expect(verifyLinuxCredentialStatus(valid)).toBe(true);
    const mutations = [
      { ...valid, expectedUid: "0" },
      { ...valid, expectedGid: "0" },
      { ...valid, expectedUid: "2147483647" },
      { ...valid, realUid: uid + 1 },
      { ...valid, effectiveUid: uid + 1 },
      { ...valid, realGid: gid + 1 },
      { ...valid, effectiveGid: gid + 1 },
      { ...valid, groups: [] },
      { ...valid, groups: [gid, gid + 1] },
      { ...valid, statusText: statusText.replace(`${uid}\t${uid}`, `${uid + 1}\t${uid}`) },
      { ...valid, statusText: statusText.replace(`${gid}\t${gid}`, `${gid + 1}\t${gid}`) },
      { ...valid, statusText: statusText.replace("Groups:\t", `Groups:\t${gid}`) },
      { ...valid, statusText: statusText.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0") },
      { ...valid, statusText: statusText.replace("CapInh:\t0", "CapInh:\t1") },
      { ...valid, statusText: statusText.replace("CapPrm:\t0", "CapPrm:\t1") },
      { ...valid, statusText: statusText.replace("CapEff:\t0", "CapEff:\t1") },
      { ...valid, statusText: statusText.replace("CapBnd:\t0", "CapBnd:\t1") },
      { ...valid, statusText: statusText.replace("CapAmb:\t0", "CapAmb:\t1") },
      { ...valid, statusText: statusText.replace("Uid:", "MissingUid:") },
      { ...valid, statusText: `${statusText}Uid:\t${uid}\t${uid}\t${uid}\t${uid}\n` },
    ];
    for (const mutation of mutations) expect(verifyLinuxCredentialStatus(mutation)).toBe(false);
    const extended = [gid];
    extended.length = 2;
    const hole = new Array<number>(1);
    const accessor: number[] = [];
    Object.defineProperty(accessor, "0", { enumerable: true, get: () => gid });
    const symbol = [gid];
    Object.defineProperty(symbol, Symbol("extra"), { value: true });
    const extra = [gid] as number[] & { extra?: boolean };
    extra.extra = true;
    for (const groups of [extended, hole, accessor, new Proxy([gid], {}), symbol, extra])
      expect(verifyLinuxCredentialStatus({ ...valid, groups })).toBe(false);
  });

  test("constructs the fixed complete challenge and accepts only stable-timed exact output", () => {
    const challenge = createIss002WalkChallenge();
    const input = JSON.parse(challenge.inputText) as {
      records: readonly Readonly<Record<string, unknown>>[];
      selectedAuthorityValue: Readonly<Record<string, unknown>>;
    };
    expect(input.records).toHaveLength(1000);
    expect(input.records[999]?.ordinal).toBe("999");
    expect(input.selectedAuthorityValue.headOrdinal).toBe("999");
    expect(input.selectedAuthorityValue.headRecordDigest).toBe(
      computeAuthorityHistoryRecordDigest(input.records[999]),
    );
    expect(evaluateIss002IsolatedWalk(observation())).toEqual({
      durationNanoseconds: "1",
      ok: true,
    });
  });

  test("refuses candidate PASS/time fields, mutations, diagnostics, and terminal ambiguity", () => {
    const challenge = createIss002WalkChallenge();
    const valid = JSON.parse(responseText(challenge)) as Record<string, unknown>;
    for (const value of [
      observation({ durationNanoseconds: "5000000001" }),
      observation({ durationNanoseconds: "01" }),
      observation({ exitCode: 1 }),
      observation({ signal: "SIGKILL" }),
      observation({ stderr: "candidate diagnostic" }),
      observation({ stdout: JSON.stringify({ ...valid, pass: true }) }),
      observation({ stdout: JSON.stringify({ ...valid, durationNanoseconds: "0" }) }),
      observation({ stdout: JSON.stringify({ ...valid, issues: ["candidate issue"] }) }),
      observation({ stdout: ` ${responseText(challenge)}` }),
      observation({ stdout: "not-json" }),
    ])
      expect(evaluateIss002IsolatedWalk(value).ok).toBe(false);
  });

  test("detaches hostile observation records without invoking accessors", () => {
    const base = observation();
    let getterCalls = 0;
    let proxyCalls = 0;
    const accessor = { ...base };
    Object.defineProperty(accessor, "stdout", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return base.stdout;
      },
    });
    const proxy = new Proxy(base, {
      ownKeys() {
        proxyCalls += 1;
        throw new Error("trap");
      },
    });
    for (const value of [
      null,
      undefined,
      [],
      { ...base, extra: true },
      Object.assign(Object.create({ inherited: true }) as object, base),
      vm.runInNewContext(`(${JSON.stringify(base)})`),
      accessor,
      proxy,
    ])
      expect(evaluateIss002IsolatedWalk(value).ok).toBe(false);
    expect(getterCalls).toBe(0);
    expect(proxyCalls).toBe(0);
  });

  test("candidate-side runner returns only hostile semantic data", async () => {
    const pass = await runChild("export function validateAuthorityHistoryChain() { return []; }\n");
    expect(evaluateIss002IsolatedWalk(pass.observation).ok).toBe(true);

    const mutation = await runChild(`
export function validateAuthorityHistoryChain(records) {
  records[999].ordinal = "998";
  return [];
}
`);
    expect(evaluateIss002IsolatedWalk(mutation.observation).ok).toBe(false);

    for (const source of [
      'export function validateAuthorityHistoryChain() { return ""; }',
      `export function validateAuthorityHistoryChain() {
  const issues = ["hidden failure"];
  issues[Symbol.iterator] = function* () {};
  return issues;
}`,
      `Object.defineProperty(Object.prototype, "toJSON", { value() { return {}; } });
export function validateAuthorityHistoryChain() { return []; }`,
    ]) {
      const reflective = await runChild(`${source}\n`);
      expect(evaluateIss002IsolatedWalk(reflective.observation).ok).toBe(false);
    }

    const noise = await runChild(`
process.stdout.write("candidate-noise");
export function validateAuthorityHistoryChain() { return []; }
`);
    expect(evaluateIss002IsolatedWalk(noise.observation).ok).toBe(false);
  });

  test("refuses Linux credential ambiguity before importing candidate code", async () => {
    const refused = await runChild(
      'process.stdout.write("candidate-imported"); export function validateAuthorityHistoryChain() { return []; }\n',
      ["--linux-principal", "0", "0"],
    );
    expect(refused.observation.stdout).toBe("");
    expect(refused.observation.stderr).toContain("candidate-principal:");
    expect(evaluateIss002IsolatedWalk(refused.observation).ok).toBe(false);
  });

  test("stable lifecycle owns three launch-to-parse intervals and tears each principal down", async () => {
    const calls: string[] = [];
    const principals: object[] = [];
    const authority: Iss002StableIsolationAuthority = {
      async createPrincipal() {
        const principal = Object.freeze({ ordinal: principals.length });
        principals.push(principal);
        calls.push(`create:${principals.length - 1}`);
        return principal;
      },
      async prepare(principal: unknown) {
        calls.push(`prepare:${principals.indexOf(principal as object)}`);
      },
      async launch(principal: unknown, request: Iss002IsolationLaunchRequest) {
        const ordinal = principals.indexOf(principal as object);
        calls.push(`launch:${ordinal}`);
        expect(Object.isFrozen(request)).toBe(true);
        expect(request.candidateArtifactPath).toBe(resolve("C:/candidate/contracts.mjs"));
        expect(request.rpcRunnerPath).toBe(resolve("C:/stable/isolated-child.mjs"));
        expect(request.timeoutMilliseconds).toBe(5000);
        expect(JSON.parse(request.inputText)).toMatchObject({
          records: expect.any(Array),
          selectedAuthorityValue: expect.any(Object),
        });
        return { exitCode: 0, signal: null, stderr: "", stdout: responseText() };
      },
      async teardownPrincipal(principal: unknown) {
        calls.push(`teardown:${principals.indexOf(principal as object)}`);
      },
    };
    const result = await runIss002IsolatedWalk(
      {
        candidateArtifactPath: resolve("C:/candidate/contracts.mjs"),
        rpcRunnerPath: resolve("C:/stable/isolated-child.mjs"),
      },
      authority,
    );
    if (!result.ok) throw new Error(result.issues.join(","));
    expect(result.durationsNanoseconds).toHaveLength(3);
    expect(result.maximumWalkDurationNanoseconds).toBe(
      result.durationsNanoseconds.reduce((maximum, value) =>
        BigInt(value) > BigInt(maximum) ? value : maximum,
      ),
    );
    expect(new Set(principals).size).toBe(3);
    expect(calls).toEqual([
      "create:0",
      "prepare:0",
      "launch:0",
      "teardown:0",
      "create:1",
      "prepare:1",
      "launch:1",
      "teardown:1",
      "create:2",
      "prepare:2",
      "launch:2",
      "teardown:2",
    ]);
  });

  test("stable lifecycle fails closed and tears down after hostile launch outcomes", async () => {
    let teardownCount = 0;
    const preparationFailure: Iss002StableIsolationAuthority = {
      async createPrincipal() {
        return Object.freeze({});
      },
      async launch() {
        throw new Error("launch must not run");
      },
      async prepare() {
        throw new Error("candidate preparation failed");
      },
      async teardownPrincipal() {
        teardownCount += 1;
      },
    };
    const preparationResult = await runIss002IsolatedWalk(
      {
        candidateArtifactPath: resolve("C:/candidate/contracts.mjs"),
        rpcRunnerPath: resolve("C:/stable/isolated-child.mjs"),
      },
      preparationFailure,
    );
    expect(preparationResult).toEqual({
      issues: ["isolated-walk.0:preparation-refused"],
      ok: false,
    });
    expect(teardownCount).toBe(1);

    const launchFailure: Iss002StableIsolationAuthority = {
      async createPrincipal() {
        return Object.freeze({});
      },
      async prepare() {},
      async launch() {
        throw new Error("candidate launch failed");
      },
      async teardownPrincipal() {
        teardownCount += 1;
      },
    };
    expect(
      (
        await runIss002IsolatedWalk(
          {
            candidateArtifactPath: resolve("C:/candidate/contracts.mjs"),
            rpcRunnerPath: resolve("C:/stable/isolated-child.mjs"),
          },
          launchFailure,
        )
      ).ok,
    ).toBe(false);
    expect(teardownCount).toBe(2);

    const teardownFailure: Iss002StableIsolationAuthority = {
      async createPrincipal() {
        return Object.freeze({});
      },
      async prepare() {},
      async launch() {
        return { exitCode: 0, signal: null, stderr: "", stdout: responseText() };
      },
      async teardownPrincipal() {
        throw new Error("principal residue");
      },
    };
    expect(
      (
        await runIss002IsolatedWalk(
          {
            candidateArtifactPath: resolve("C:/candidate/contracts.mjs"),
            rpcRunnerPath: resolve("C:/stable/isolated-child.mjs"),
          },
          teardownFailure,
        )
      ).ok,
    ).toBe(false);
  });

  test("keeps principal authority and the lifecycle coordinator off the package root", async () => {
    const publicSurface = await import("../../packages/conformance/src/index.js");
    expect(publicSurface).not.toHaveProperty("runIss002IsolatedWalk");
  });
});
