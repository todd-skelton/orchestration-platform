import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test } from "vitest";

import { runIss002IsolatedWalk } from "../../packages/conformance/src/isolated-walk.js";
import {
  createLinuxIsolationAuthority,
  type LinuxIsolationAuthority,
} from "../../packages/conformance/src/linux-isolation-authority.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const configuredAuthorityRoot = process.env.ORCHESTRATION_LINUX_STABLE_AUTHORITY_ROOT;
const hostedDiagnostic =
  process.platform === "linux" && process.env.ORCHESTRATION_LINUX_HOSTED_ISOLATION === "1";

test.runIf(hostedDiagnostic)(
  "executes three fresh walks through production transient-UID custody without emitting authority",
  async () => {
    expect(process.getuid?.()).toBeGreaterThan(0);
    expect(process.getgid?.()).toBeGreaterThan(0);
    const stableUid = process.getuid!();
    const stableGid = process.getgid!();
    if (!configuredAuthorityRoot) throw new Error("stable authority root required");
    const authorityRoot = await realpath(configuredAuthorityRoot);
    expect(authorityRoot).toBe(configuredAuthorityRoot);
    expect(await readdir(authorityRoot)).toEqual([]);
    const root = await mkdtemp(resolve(tmpdir(), "orchestration-linux-hosted-isolation-"));
    const executionParent = await mkdtemp(
      resolve(tmpdir(), "orchestration-linux-execution-parent-"),
    );
    expect(resolve(executionParent, "..")).toBe(await realpath(tmpdir()));
    let authority: LinuxIsolationAuthority | undefined;
    try {
      const accountStateRoot = resolve(root, "account-state");
      const dacStateRoot = resolve(root, "dac-state");
      const executionStateRoot = resolve(root, "execution-state");
      for (const path of [accountStateRoot, dacStateRoot, executionStateRoot]) {
        await mkdir(path, { mode: 0o700 });
        await chmod(path, 0o700);
      }
      await chmod(executionParent, 0o700);

      const sources = {
        account: "linux-principal-account.py",
        cleanup: "linux-execution-cleanup.py",
        dac: "linux-principal-dac.py",
        process: "linux-pidfd-quiesce.py",
      } as const;
      const retained: Record<keyof typeof sources | "rpc", string> = Object.create(null) as Record<
        keyof typeof sources | "rpc",
        string
      >;
      for (const [name, source] of Object.entries(sources) as Array<
        [keyof typeof sources, string]
      >) {
        const destination = resolve(authorityRoot, source);
        await copyFile(
          resolve(repositoryRoot, "packages/conformance/src", source),
          destination,
          constants.COPYFILE_EXCL,
        );
        await chmod(destination, 0o500);
        retained[name] = destination;
      }
      const runtimePath = resolve(authorityRoot, "node");
      await copyFile(process.execPath, runtimePath, constants.COPYFILE_EXCL);
      await chmod(runtimePath, 0o500);
      const candidateArtifactPath = resolve(authorityRoot, "candidate-contracts.mjs");
      await build({
        absWorkingDir: repositoryRoot,
        bundle: true,
        entryPoints: [resolve(repositoryRoot, "packages/contracts/src/index.ts")],
        external: [],
        format: "esm",
        logLevel: "silent",
        minify: false,
        outfile: candidateArtifactPath,
        platform: "node",
        sourcemap: false,
        target: "node24",
        treeShaking: false,
      });
      await chmod(candidateArtifactPath, 0o400);
      const rpcRunnerPath = resolve(authorityRoot, "iss002-isolated-walk-child.mjs");
      await build({
        absWorkingDir: repositoryRoot,
        bundle: true,
        entryPoints: [
          resolve(repositoryRoot, "packages/conformance/src/iss002-isolated-walk-child.mjs"),
        ],
        external: ["node:*"],
        format: "esm",
        logLevel: "silent",
        minify: false,
        outfile: rpcRunnerPath,
        platform: "node",
        sourcemap: false,
        target: "node24",
        treeShaking: false,
      });
      await chmod(rpcRunnerPath, 0o500);
      retained.rpc = rpcRunnerPath;

      authority = await createLinuxIsolationAuthority({
        account: { accountHelperPath: retained.account, stateRoot: accountStateRoot },
        dac: { dacHelperPath: retained.dac, stateRoot: dacStateRoot },
        execution: {
          accountStateRoot,
          cleanupHelperPath: retained.cleanup,
          executionParent,
          stateRoot: executionStateRoot,
        },
        process: { pidfdHelperPath: retained.process, stateRoot: accountStateRoot },
        runtimePath,
      });
      const result = await runIss002IsolatedWalk(
        { candidateArtifactPath, rpcRunnerPath: retained.rpc },
        authority,
      );
      if (!result.ok) throw new Error(result.issues.join(","));
      expect(result).toMatchObject({ ok: true });
      expect(result.durationsNanoseconds).toHaveLength(3);
      for (const duration of result.durationsNanoseconds)
        expect(BigInt(duration)).toBeLessThanOrEqual(5_000_000_000n);
      await authority.close();
      authority = undefined;

      expect(await readdir(executionParent)).toEqual([]);
      const parentProfile = await lstat(executionParent, { bigint: true });
      expect(parentProfile.isDirectory()).toBe(true);
      expect(parentProfile.isSymbolicLink()).toBe(false);
      expect(parentProfile.uid).toBe(BigInt(stableUid));
      expect(parentProfile.gid).toBe(BigInt(stableGid));
      expect(parentProfile.mode & 0o7777n).toBe(0o700n);

      for (const inaccessibleRoot of [
        root,
        accountStateRoot,
        dacStateRoot,
        executionStateRoot,
        authorityRoot,
      ]) {
        const profile = await lstat(inaccessibleRoot, { bigint: true });
        expect(profile.isDirectory()).toBe(true);
        expect(profile.isSymbolicLink()).toBe(false);
        expect(profile.uid).toBe(BigInt(stableUid));
        expect(profile.gid).toBe(BigInt(stableGid));
        expect(profile.mode & 0o7777n).toBe(0o700n);
      }

      const stateEntries = (
        await Promise.all(
          [accountStateRoot, dacStateRoot, executionStateRoot].map(
            async (path) => await readdir(path),
          ),
        )
      ).flat();
      expect(stateEntries.some((entry) => entry.includes("intent"))).toBe(false);
      const [passwordRows, groupRows] = await Promise.all([
        readFile("/etc/passwd", "utf8"),
        readFile("/etc/group", "utf8"),
      ]);
      expect(`${passwordRows}\n${groupRows}`).not.toMatch(/^orch6-/m);
    } finally {
      if (authority) await authority.close().catch(() => {});
      await rm(root, { force: true, recursive: true });
      await rm(executionParent, { force: true, recursive: true });
    }
  },
  120_000,
);
