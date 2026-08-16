import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "orchestration-capability-slots-"));
  roots.push(root);
  await mkdir(resolve(root, "scripts"), { recursive: true });
  for (const name of ["capability-not-implemented.mjs", "capability-slots.mjs"]) {
    await writeFile(
      resolve(root, "scripts", name),
      await readFile(resolve(import.meta.dirname, "../scripts", name)),
    );
  }
  return root;
}

async function slot(root: string, source: string) {
  const path = resolve(root, "test/capability-slots/ISS-001/inventory%3Acheck.mjs");
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, source);
  return path;
}

function invoke(root: string) {
  return spawnSync(
    process.execPath,
    [resolve(root, "scripts/capability-not-implemented.mjs"), "ISS-001", "inventory:check"],
    { cwd: root, encoding: "utf8" },
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("capability slots", () => {
  test("runs an exact implemented slot with forwarded argv and exit status", async () => {
    const root = await fixture();
    await slot(
      root,
      "process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(17);\n",
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/capability-not-implemented.mjs"),
        "ISS-001",
        "inventory:check",
        "--one",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(17);
    expect(result.stdout).toBe('["--one"]');
  });

  test("keeps missing slots as the exact placeholder", async () => {
    const root = await fixture();
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/capability-not-implemented.mjs"),
        "ISS-001",
        "inventory:check",
        "--one",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(5);
    expect(JSON.parse(result.stderr)).toMatchObject({
      owner: "ISS-001",
      capability: "inventory:check",
      forwardedArguments: ["--one"],
    });
  });

  test("refuses a symlinked slot", async () => {
    const root = await fixture();
    const target = await slot(root, "process.exit(0);\n");
    const link = resolve(root, "test/capability-slots/ISS-001/inventory%3Aredaction-check.mjs");
    await symlink(target, link, "file");
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/capability-not-implemented.mjs"),
        "ISS-001",
        "inventory:redaction-check",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(5);
  });

  test.each([
    ["lowercase owner", "iss-001", "inventory%3Acheck.mjs"],
    ["lowercase encoding", "ISS-001", "inventory%3acheck.mjs"],
    ["uppercase extension", "ISS-001", "inventory%3Acheck.MJS"],
  ])("refuses a noncanonical %s slot", async (_name, owner, name) => {
    const root = await fixture();
    const path = resolve(root, "test/capability-slots", owner, name);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, "process.exit(0);\n");
    expect(invoke(root).status).toBe(5);
  });

  test("refuses a symlinked owner directory", async () => {
    const root = await fixture();
    const target = resolve(root, "external");
    await mkdir(target, { recursive: true });
    await writeFile(resolve(target, "inventory%3Acheck.mjs"), "process.exit(0);\n");
    await mkdir(resolve(root, "test/capability-slots"), { recursive: true });
    await symlink(target, resolve(root, "test/capability-slots/ISS-001"), "dir");
    expect(invoke(root).status).toBe(5);
  });
});
