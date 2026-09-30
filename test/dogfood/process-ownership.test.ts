// ISS-219 composition evidence. Real run-loop.sh, wrapper, collector,
// codexAdapter(...).git, launchObserver and observe-process.mjs run with
// absolute inert executables under an injected plain cgroup root. That fork,
// reparenting and setsid retain real cgroup membership is host kernel
// qualification, never proven here or by a fabricated /proc tuple.
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  observeProcessOwnership,
  parseProcStat,
  readCgroupMembership,
} from "../../scripts/dogfood/process-ownership.mjs";
import type { ProcessOwnershipObservation } from "../../scripts/dogfood/process-ownership.mjs";
import { formatStatus, observeStatus } from "../../scripts/dogfood/status.mjs";
import {
  fixtures,
  ownershipHarness,
  procIdentity,
  repository,
} from "./process-ownership-fixtures/harness.js";

const exec = promisify(execFile);
const linux = it.skipIf(process.platform !== "linux");
const production = resolve(repository, "scripts/dogfood/process-ownership.mjs");
const preview = async () => ({ candidates: [], outstanding: [], scope: null });
const exited = async () => ({ status: "exited", pid: null });
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean();
});
const harness = async (...args: Parameters<typeof ownershipHarness>) => {
  const f = await ownershipHarness(...args);
  cleanup.push(() => f.close());
  return f;
};
const observe = (f: Awaited<ReturnType<typeof harness>>) =>
  observeProcessOwnership(f.stateRoot, f.run);
const pids = (value: ProcessOwnershipObservation) =>
  value.invocations
    .flatMap((row) => row.members ?? [])
    .map((row) => row.pid)
    .sort((a, b) => a - b);
let evidenceRoot: string | undefined;
async function evidence(name: string, value: unknown) {
  evidenceRoot ??= await mkdtemp(resolve(tmpdir(), "iss219-evidence-"));
  const path = resolve(evidenceRoot, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`ISS-219 composition evidence (not kernel proof): ${path}`);
}
// A disposable copy of the wrapper module beside a copy of the launcher, so a
// mutant runs through the same canonical entry and relative module path.
async function mutant(name: string, transform: (source: string) => string) {
  const root = await mkdtemp(resolve(tmpdir(), `iss219-mutant-${name}-`));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const module = resolve(root, "scripts/dogfood/process-ownership.mjs");
  const launcher = resolve(root, "scripts/executor/run-loop.sh");
  await mkdir(dirname(module), { recursive: true });
  await mkdir(dirname(launcher), { recursive: true });
  const source = await readFile(production, "utf8");
  const changed = transform(source);
  expect(changed, `mutant ${name} applies`).not.toBe(source);
  await writeFile(module, changed);
  await cp(resolve(repository, "scripts/executor/run-loop.sh"), launcher);
  return { module, launcher };
}
// The collector in a fresh process, optionally a mutant module, with one
// perturbation injected around the census (see census.mjs).
async function census(
  f: Awaited<ReturnType<typeof harness>>,
  packet: Record<string, unknown>,
  module = production,
) {
  const packetPath = resolve(f.root, "census-packet.json");
  const output = resolve(f.root, "census-output.json");
  await writeFile(packetPath, JSON.stringify({ stateRoot: f.stateRoot, run: f.run, ...packet }));
  await exec(process.execPath, [resolve(fixtures, "census.mjs"), module, packetPath, output], {
    env: { PATH: f.env.PATH },
  });
  return JSON.parse(await readFile(output, "utf8")) as {
    change: string;
    reads: number;
    observation: ProcessOwnershipObservation;
  };
}

it("parses stat rows with parenthesized names and rejects missing or nondecimal fields", () => {
  const tail = Array(15).fill("0").join(" ");
  expect(parseProcStat(`42 (helper (x) y) S 1 2 3 ${tail} 12345 7\n`)).toEqual({
    pid: 42,
    ppid: 1,
    pgid: 2,
    sid: 3,
    state: "S",
    starttime: "12345",
  });
  expect(() => parseProcStat("42 (helper) S 1 2")).toThrow("ownership-proc-malformed");
  expect(() => parseProcStat(`42 (helper) S 1 2 3 ${tail} 1e4`)).toThrow(
    "ownership-proc-malformed",
  );
  expect(() => parseProcStat(`x (helper) S 1 2 3 ${tail} 5`)).toThrow("ownership-proc-malformed");
  expect(() => parseProcStat("")).toThrow("ownership-proc-malformed");
});

linux("reads membership tokens only from cgroup.procs and refuses malformed rows", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "iss219-procs-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, "cgroup.procs"), "30\n7\n30\n");
  expect(await readCgroupMembership(root)).toEqual([7, 30]);
  await writeFile(resolve(root, "cgroup.procs"), "");
  expect(await readCgroupMembership(root)).toEqual([]);
  await writeFile(resolve(root, "cgroup.procs"), "7\n0x1f\n");
  await expect(readCgroupMembership(root)).rejects.toThrow("ownership-membership-malformed");
  await rm(resolve(root, "cgroup.procs"));
  await expect(readCgroupMembership(root)).rejects.toThrow("ownership-membership-unreadable");
});

linux(
  "enrolls and publishes before the first launcher child, then keeps real adapter and observer descendants owned after reparenting while same-group outsiders never are",
  async () => {
    const f = await harness();
    // Control (a): forked before the launcher, in the launcher's SID/PGID.
    f.outsider("same-group-outsider", false);
    const sameGroup = await f.take("same-group-outsider");
    const { completion } = f.launch();
    const supervisor = await f.take("supervisor");
    expect(supervisor.sentinel).toBe("ISS-219-inert-pnpm");
    const witness = await f.witness();
    expect(witness.enrolled, "wrapper enrolled before its first child").toBe(true);
    expect(witness.published, "binding published before its first child").toBe(true);
    expect(witness.binding!.substrate).toBe("injected-directory");
    expect(witness.binding!.wrapper.starttime).toMatch(/^\d+$/);
    const firstChild = await procIdentity(witness.firstChildPid);
    expect(firstChild.ppid).toBe(witness.binding!.wrapper.pid);
    expect(
      (await readFile(resolve(witness.binding!.cgroupPath, "cgroup.procs"), "utf8")).trim(),
    ).toBe(String(witness.binding!.wrapper.pid));
    // Real codexAdapter(...).git with the absolute inert executable.
    f.send("supervisor", "helper");
    await f.take("supervisor", "adapter-called");
    const helper = await f.take("helper");
    const grandchild = await f.take("helper-grandchild");
    expect(helper.sentinel).toBe("ISS-219-inert-actor");
    // codexAdapter(...).git supplied `-C <worktree>` to the inert executable.
    expect(helper.argv).toEqual(["-C", f.worktree, "helper", f.address, "helper"]);
    expect(helper.identity.ppid).toBe(supervisor.identity.pid);
    expect(grandchild.identity.ppid).toBe(helper.identity.pid);
    // Control (b): another session, outside the membership.
    f.outsider("other-group-outsider", true);
    const otherGroup = await f.take("other-group-outsider");
    expect(sameGroup.identity.pgid).toBe(grandchild.identity.pgid);
    expect(sameGroup.identity.sid).toBe(grandchild.identity.sid);
    expect(otherGroup.identity.sid).toBe(otherGroup.identity.pid);
    await f.standIn([grandchild.identity]);
    const held = await observe(f);
    expect(held.status).toBe("observed");
    expect(pids(held)).toEqual([grandchild.identity.pid]);
    // Helper exits on handshake and is reaped by the adapter call; the held
    // grandchild is reparented with the same starttime.
    f.send("helper", "exit");
    const reaped = await f.take("supervisor", "helper-reaped");
    expect(reaped.stdout).toBe("");
    f.send("helper-grandchild", "identity");
    const reparented = (await f.take("helper-grandchild", "identity")).identity;
    expect(reparented.ppid).not.toBe(helper.identity.pid);
    expect(reparented).toMatchObject({
      pid: grandchild.identity.pid,
      starttime: grandchild.identity.starttime,
      pgid: grandchild.identity.pgid,
      sid: grandchild.identity.sid,
    });
    const afterReparent = await observe(f);
    expect(afterReparent.invocations[0]!.members).toEqual([reparented]);
    // Real launchObserver -> observe-process.mjs -> synthetic worker with a
    // detached (setsid) descendant, under the dispatch environment allowlist.
    f.send("supervisor", "observer");
    await f.take("supervisor", "observer-called");
    const worker = await f.take("worker");
    const detached = await f.take("worker-grandchild");
    expect(worker.argv).toEqual(["worker", f.address, "worker"]);
    expect(worker.forbiddenPresent).toBe(false);
    expect(detached.forbiddenPresent).toBe(false);
    expect(detached.identity.sid).toBe(detached.identity.pid);
    expect(detached.identity.pgid).not.toBe(grandchild.identity.pgid);
    expect(JSON.parse(await readFile(resolve(f.root, f.run, "process.json"), "utf8"))).toEqual({
      pid: worker.identity.pid,
    });
    // Control (c): the different-group descendant inside the membership is reported.
    await f.standIn([grandchild.identity, detached.identity]);
    expect(pids(await observe(f))).toEqual(
      [grandchild.identity.pid, detached.identity.pid].sort((a, b) => a - b),
    );
    // Observer loss: SIGKILL our exact inert observer PID; the worker and its
    // detached descendant survive with unchanged starttimes.
    f.send("worker", "parent");
    const observer = (await f.take("worker", "parent")).identity;
    expect(observer.pid).toBe(worker.identity.ppid);
    process.kill(observer.pid, "SIGKILL");
    f.send("worker", "identity");
    const survivingWorker = (await f.take("worker", "identity")).identity;
    expect(survivingWorker.starttime).toBe(worker.identity.starttime);
    f.send("worker", "exit");
    await f.take("worker", "exiting");
    f.send("worker-grandchild", "identity");
    const survivor = (await f.take("worker-grandchild", "identity")).identity;
    expect(survivor.starttime).toBe(detached.identity.starttime);
    // Normal exit: the supervisor's code propagates; the binding is immutable.
    const bindingPath = resolve(f.records, witness.binding!.invocation, "binding.json");
    const bindingBytes = await readFile(bindingPath, "utf8");
    f.send("supervisor", "exit");
    expect(await completion).toMatchObject({ code: 0, stdout: "", stderr: "" });
    const after = await observeStatus(f.config, { preview, supervisor: exited });
    expect(after.processOwnership.status).toBe("observed");
    expect(pids(after.processOwnership)).toEqual(
      [grandchild.identity.pid, detached.identity.pid].sort((a, b) => a - b),
    );
    const human = formatStatus(after);
    expect(human).toContain(
      `Process ownership observed; census ${after.processOwnership.observationStart}`,
    );
    expect(human).toContain(
      `Invocation ${witness.binding!.invocation} (injected-directory) boot ${witness.binding!.bootId}`,
    );
    // The survivor was orphaned when its worker exited; identity is unchanged.
    const observedSurvivor = after.processOwnership.invocations[0].members.find(
      (row: { pid: number }) => row.pid === survivor.pid,
    );
    expect(observedSurvivor).toMatchObject({
      starttime: survivor.starttime,
      pgid: survivor.pgid,
      sid: survivor.sid,
    });
    expect(observedSurvivor.ppid).not.toBe(worker.identity.pid);
    expect(human).toContain(
      `PID ${observedSurvivor.pid} starttime ${observedSurvivor.starttime} PPID ${observedSurvivor.ppid} PGID ${observedSurvivor.pgid} SID ${observedSurvivor.sid} state ${observedSurvivor.state}`,
    );
    expect(human).not.toContain(`PID ${sameGroup.identity.pid} `);
    expect(human).not.toContain(`PID ${otherGroup.identity.pid} `);
    expect(JSON.parse(JSON.stringify(after)).processOwnership).toEqual(after.processOwnership);
    expect(await readFile(bindingPath, "utf8")).toBe(bindingBytes);
    expect((await procIdentity(sameGroup.identity.pid)).starttime).toBe(
      sameGroup.identity.starttime,
    );
    expect((await procIdentity(otherGroup.identity.pid)).starttime).toBe(
      otherGroup.identity.starttime,
    );
    await evidence("candidate-green", {
      witness,
      supervisor: supervisor.identity,
      helper: helper.identity,
      grandchildBeforeReparent: grandchild.identity,
      grandchildAfterReparent: reparented,
      observer,
      worker: worker.identity,
      detached: detached.identity,
      detachedSurvivor: survivor,
      sameGroupOutsider: sameGroup.identity,
      otherGroupOutsider: otherGroup.identity,
      observation: after.processOwnership,
      human,
    });
  },
);

linux(
  "fails distinct assertions when enrollment is removed, moved after the first child, or publication is moved after the first child",
  async () => {
    const source = await readFile(production, "utf8");
    const enrollment = source.slice(
      source.indexOf("  const procs = await open("),
      source.indexOf("  const binding = {"),
    );
    const publication = '  await rename(temporary, resolve(directory, "binding.json"));\n';
    const exit = source.slice(
      source.indexOf('    child.once("exit", (code, signal) =>'),
      source.indexOf("\n  });", source.indexOf('    child.once("exit"')),
    );
    expect(enrollment).toContain("ownership-enrollment-failed");
    expect(source).toContain(publication);
    expect(exit).toContain("done(code ??");
    // Causally after the first child: the moved step runs when that child exits.
    const afterFirstChild = (text: string, moved: string) =>
      text
        .replace(moved, "")
        .replace(
          exit,
          `    child.once("exit", async (code, signal) => {\n${moved}      done(code ?? (signal ? 128 + osConstants.signals[signal] : 1));\n    });`,
        );
    const variants = [
      { name: "enrollment-removed", transform: (text: string) => text.replace(enrollment, "") },
      {
        name: "enrollment-after-first-child",
        transform: (text: string) => afterFirstChild(text, enrollment),
      },
      {
        name: "publication-after-first-child",
        transform: (text: string) => afterFirstChild(text, publication),
      },
    ];
    for (const variant of variants) {
      const copy = await mutant(variant.name, variant.transform);
      const f = await harness(variant.name, { launcher: copy.launcher });
      const { completion } = f.launch();
      await f.take("supervisor");
      const witness = await f.witness();
      const enrolledAssertion = () =>
        expect(witness.enrolled, "wrapper enrolled before its first child").toBe(true);
      const publishedAssertion = () =>
        expect(witness.published, "binding published before its first child").toBe(true);
      if (variant.name === "publication-after-first-child") {
        enrolledAssertion();
        expect(publishedAssertion).toThrow("binding published before its first child");
        expect(witness.prepared).toBe(true);
      } else {
        publishedAssertion();
        expect(enrolledAssertion).toThrow("wrapper enrolled before its first child");
      }
      await expect(f.standIn([])).rejects.toThrow("first-child-ordering-witness-failed");
      f.send("supervisor", "exit");
      await completion;
      await evidence(`mutant-${variant.name}`, { witness, red: true });
      await f.close();
    }
  },
);

linux(
  "is unavailable for one-input record, boot, namespace, leaf, membership and identity changes, with members null, and those guards' bypass mutants go red",
  async () => {
    const f = await harness();
    const { completion } = f.launch();
    await f.take("supervisor");
    f.send("supervisor", "helper");
    await f.take("supervisor", "adapter-called");
    await f.take("helper");
    const held = (await f.take("helper-grandchild")).identity;
    f.outsider("other-group-outsider", true);
    const outsider = (await f.take("other-group-outsider")).identity;
    await f.standIn([held]);
    const binding = (await f.bindings())[0]!;
    const bindingPath = resolve(f.records, binding.invocation, "binding.json");
    const bindingBytes = await readFile(bindingPath, "utf8");
    const leaf = binding.cgroupPath;
    expect(await observe(f)).toMatchObject({ status: "observed" });
    const restore = async () => {
      await writeFile(bindingPath, bindingBytes);
      await f.standIn([held]);
      expect((await observe(f)).status).toBe("observed");
    };
    // Between-observation perturbations, each varied alone against a fixed binding.
    const changes: Array<[string, () => Promise<void>, () => Promise<void>, string]> = [
      [
        "record-omission",
        () => rename(bindingPath, `${bindingPath}.omitted`),
        () => rename(`${bindingPath}.omitted`, bindingPath),
        "ownership-invocation-unresolved",
      ],
      [
        "binding-malformed",
        () => writeFile(bindingPath, "{"),
        async () => {},
        "ownership-invocation-unresolved",
      ],
      [
        "wrong-run",
        () => writeFile(bindingPath, JSON.stringify({ ...binding, run: "other" })),
        async () => {},
        "ownership-invocation-unresolved",
      ],
      [
        "different-boot",
        () => writeFile(bindingPath, JSON.stringify({ ...binding, bootId: "0".repeat(36) })),
        async () => {},
        "ownership-boot-mismatch",
      ],
      [
        "different-pid-namespace",
        () =>
          writeFile(
            bindingPath,
            JSON.stringify({ ...binding, namespaces: { ...binding.namespaces, pid: "pid:[1]" } }),
          ),
        async () => {},
        "ownership-namespace-mismatch",
      ],
      [
        "unsupported-substrate",
        () => writeFile(bindingPath, JSON.stringify({ ...binding, substrate: "cgroup-v2" })),
        async () => {},
        "ownership-cgroup-unsupported",
      ],
      [
        "cgroup-object-replaced",
        async () => {
          await rename(leaf, `${leaf}.old`);
          await mkdir(leaf);
          await writeFile(resolve(leaf, "cgroup.procs"), `${held.pid}\n`);
        },
        async () => {
          await rm(leaf, { recursive: true });
          await rename(`${leaf}.old`, leaf);
        },
        "ownership-cgroup-changed",
      ],
      [
        "not-a-leaf",
        () => mkdir(resolve(leaf, "child")),
        () => rm(resolve(leaf, "child"), { recursive: true }),
        "ownership-not-a-leaf",
      ],
      [
        "membership-source-missing",
        () => rename(resolve(leaf, "cgroup.procs"), resolve(leaf, "saved.procs")),
        () => rename(resolve(leaf, "saved.procs"), resolve(leaf, "cgroup.procs")),
        "ownership-membership-unreadable",
      ],
      [
        "stale-member-pid",
        () => writeFile(resolve(leaf, "cgroup.procs"), `${held.pid}\n${2 ** 22 - 1}\n`),
        async () => {},
        "ownership-member-unreadable",
      ],
      [
        "unresolved-sibling-invocation",
        () => mkdir(resolve(f.records, "preparing")),
        () => rm(resolve(f.records, "preparing"), { recursive: true }),
        "ownership-invocation-unresolved",
      ],
      [
        "stray-file-in-records",
        () => writeFile(resolve(f.records, "note.txt"), "x"),
        () => rm(resolve(f.records, "note.txt")),
        "ownership-invocation-unresolved",
      ],
    ];
    for (const [name, apply, revert, diagnostic] of changes) {
      await apply();
      const result = await observe(f);
      expect(result, name).toMatchObject({ status: "unavailable", diagnostic });
      expect(
        result.invocations.every((row) => row.members === null),
        name,
      ).toBe(true);
      await revert();
      await restore();
      await evidence(`unavailable-${name}`, result);
    }
    // Historical bindings stay readable while ownership is unavailable.
    await mkdir(resolve(f.records, "preparing"));
    const partial = await observe(f);
    expect(
      partial.invocations.find((row) => row.invocation === binding.invocation)?.binding,
    ).toEqual(binding);
    expect(partial.invocations.find((row) => row.invocation === "preparing")).toEqual({
      invocation: "preparing",
      binding: null,
      members: null,
    });
    await rm(resolve(f.records, "preparing"), { recursive: true });
    // During-census perturbations through the collector's own reads.
    const packet = { pid: held.pid, outsider: outsider.pid, bindingPath, cgroupPath: leaf };
    expect((await census(f, { ...packet, change: "none" })).observation.status).toBe("observed");
    const during = {
      membership: "ownership-census-changed",
      starttime: "ownership-census-changed",
      "record-omission": "ownership-invocation-unresolved",
      unreadable: "ownership-member-unreadable",
    };
    for (const [change, diagnostic] of Object.entries(during)) {
      await restore();
      const result = await census(f, { ...packet, change });
      expect(result.observation, change).toMatchObject({ status: "unavailable", diagnostic });
      expect(result.observation.invocations.every((row) => row.members === null)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("fixture secret");
      await evidence(`during-census-${change}`, result);
    }
    // Bypass mutants: each removes exactly one guard and turns the intended
    // unavailable result into an observed one.
    const noSecondSample = (text: string) =>
      text.replace("const second = await capture();", "const second = first;");
    const bypasses: Array<[string, string, (text: string) => string]> = [
      ["no-second-sample-membership", "membership", noSecondSample],
      ["no-second-sample-starttime", "starttime", noSecondSample],
      [
        "no-record-reread",
        "record-omission",
        (text) =>
          text.replace(
            "const binding = await readBinding(directory, run, invocation);",
            "const binding = invocations.find((row) => row.invocation === invocation).binding;",
          ),
      ],
      [
        "no-namespace-check",
        "namespace",
        (text) =>
          text.replace(
            'if (!same(binding.namespaces, kernel.namespaces)) fail("ownership-namespace-mismatch");',
            "",
          ),
      ],
      [
        "no-boot-check",
        "boot",
        (text) =>
          text.replace(
            'if (binding.bootId !== kernel.bootId) fail("ownership-boot-mismatch");',
            "",
          ),
      ],
    ];
    for (const [name, change, transform] of bypasses) {
      await restore();
      const copy = await mutant(name, transform);
      if (change === "namespace")
        await writeFile(
          bindingPath,
          JSON.stringify({ ...binding, namespaces: { ...binding.namespaces, pid: "pid:[1]" } }),
        );
      if (change === "boot")
        await writeFile(bindingPath, JSON.stringify({ ...binding, bootId: "0".repeat(36) }));
      const result = await census(f, { ...packet, change }, copy.module);
      expect(
        () => expect(result.observation.status, name).toBe("unavailable"),
        `bypass mutant ${name} must be red`,
      ).toThrow();
      await evidence(`killed-${name}`, result);
    }
    await restore();
    f.send("helper", "exit");
    await f.take("supervisor", "helper-reaped");
    f.send("supervisor", "exit");
    await completion;
  },
);

linux(
  "goes red when the membership source is removed or the collector adds SID/PGID neighbours, against real outsiders",
  async () => {
    const f = await harness();
    f.outsider("same-group-outsider", false);
    const outsider = (await f.take("same-group-outsider")).identity;
    const { completion } = f.launch();
    await f.take("supervisor");
    f.send("supervisor", "helper");
    await f.take("supervisor", "adapter-called");
    await f.take("helper");
    const held = (await f.take("helper-grandchild")).identity;
    expect(outsider.pgid).toBe(held.pgid);
    expect(outsider.sid).toBe(held.sid);
    await f.standIn([held]);
    const removed = await mutant("membership-source-removed", (text) =>
      text.replace(
        "for (const pid of await readCgroupMembership(binding.cgroupPath))",
        "for (const pid of [])",
      ),
    );
    const expanded = await mutant("sid-pgid-expanded", (text) =>
      text.replace(
        "return [...new Set(tokens.map(Number))].sort((a, b) => a - b);",
        `const owned = await readProcIdentity(Number(tokens[0]));
         const neighbour = await readProcIdentity(${outsider.pid});
         if (owned.pgid === neighbour.pgid && owned.sid === neighbour.sid) tokens.push(String(neighbour.pid));
         return [...new Set(tokens.map(Number))].sort((a, b) => a - b);`,
      ),
    );
    for (const [name, module] of [
      ["control", production],
      ["membership-source-removed", removed.module],
      ["sid-pgid-expanded", expanded.module],
    ] as const) {
      const result = await census(f, { pid: held.pid, change: "none" }, module);
      const assertion = () => expect(pids(result.observation), name).toEqual([held.pid]);
      if (name === "control") assertion();
      else expect(assertion, `mutant ${name} must be red`).toThrow();
      await evidence(`membership-${name}`, result);
    }
    f.send("helper", "exit");
    await f.take("supervisor", "helper-reaped");
    f.send("supervisor", "exit");
    await completion;
  },
);

linux(
  "reports a real zombie distinctly from live membership and empty only with complete evidence",
  async () => {
    const f = await harness();
    const { completion } = f.launch();
    await f.take("supervisor");
    const parent = spawn("/bin/sh", [resolve(fixtures, "zombie.sh"), f.address], {
      stdio: "ignore",
      env: { PATH: f.env.PATH },
    });
    const parentExit = new Promise<void>((done) => parent.once("exit", () => done()));
    // Open the life pipe before the child holds its write end; EOF is the
    // kernel's exit barrier for the only writer.
    const life = open(resolve(f.address, "zombie-life"), "r");
    const childPid = Number((await readFile(resolve(f.address, "zombie-child"), "utf8")).trim());
    const parentPid = Number((await readFile(resolve(f.address, "zombie-parent"), "utf8")).trim());
    const child = await procIdentity(childPid);
    expect(child.ppid).toBe(parentPid);
    expect(child.state).not.toBe("Z");
    await f.standIn([child]);
    expect((await observe(f)).invocations[0]!.members![0]).toMatchObject({
      pid: childPid,
      state: "S",
    });
    await writeFile(resolve(f.address, "zombie-release"), "go\n");
    const handle = await life;
    expect(await handle.readFile("utf8")).toBe("");
    await handle.close();
    // The parent never waits, so the child remains a zombie with its starttime.
    let zombie = await procIdentity(childPid);
    for (let count = 0; zombie.state !== "Z" && count < 200; count++) {
      await new Promise((ok) => setTimeout(ok, 10));
      zombie = await procIdentity(childPid);
    }
    expect(zombie).toMatchObject({ pid: childPid, state: "Z", starttime: child.starttime });
    const status = await observeStatus(f.config, { preview, supervisor: exited });
    expect(status.processOwnership.invocations[0].members[0]).toMatchObject({
      pid: childPid,
      state: "Z",
      starttime: child.starttime,
    });
    expect(formatStatus(status)).toContain(`PID ${childPid} starttime ${child.starttime}`);
    expect(formatStatus(status)).toContain("state Z (zombie/exited, not live)");
    await evidence("zombie", { before: child, zombie, observation: status.processOwnership });
    await writeFile(resolve(f.address, "zombie-parent-release"), "go\n");
    await parentExit;
    // The kernel would drop a reaped PID from cgroup.procs; a stand-in that
    // still lists it is an unreadable member, never an empty set.
    expect(await observe(f)).toMatchObject({
      status: "unavailable",
      diagnostic: "ownership-member-unreadable",
    });
    await f.standIn([]);
    expect(await observe(f)).toMatchObject({ status: "observed", invocations: [{ members: [] }] });
    expect(formatStatus(await observeStatus(f.config, { preview, supervisor: exited }))).toContain(
      "Current membership empty (complete kernel evidence)",
    );
    f.send("supervisor", "exit");
    await completion;
  },
);

linux(
  "keeps survivors and bindings through wrapper loss, a second invocation of the same run and a concurrent other run",
  async () => {
    const f = await harness("lifecycle", { exitCode: 3 });
    const first = f.launch();
    await f.take("supervisor");
    f.send("supervisor", "helper");
    await f.take("supervisor", "adapter-called");
    await f.take("helper");
    const orphan = (await f.take("helper-grandchild")).identity;
    f.send("helper", "exit");
    await f.take("supervisor", "helper-reaped");
    await f.standIn([orphan]);
    const old = (await f.bindings())[0]!;
    const oldPath = resolve(f.records, old.invocation, "binding.json");
    const oldBytes = await readFile(oldPath, "utf8");
    // Wrapper loss: SIGKILL our exact wrapper PID. The body keeps running, the
    // orphan stays owned and the binding is untouched.
    expect(first.child.pid).toBeDefined();
    const wrapper = await procIdentity(old.wrapper.pid);
    expect(wrapper.starttime).toBe(old.wrapper.starttime);
    process.kill(old.wrapper.pid, "SIGKILL");
    for (let count = 0; count < 200; count++) {
      const row = await procIdentity(old.wrapper.pid).catch(() => null);
      if (!row || row.state === "Z") break;
      await new Promise((ok) => setTimeout(ok, 10));
    }
    expect(pids(await observe(f))).toEqual([orphan.pid]);
    expect(await readFile(oldPath, "utf8")).toBe(oldBytes);
    f.send("supervisor", "exit");
    const lost = await first.completion;
    expect(lost.signal ?? lost.code).not.toBe(null);
    // Second invocation of the same run: a new leaf and binding, old retained.
    const second = f.launch();
    const supervisor2 = await f.take("supervisor");
    const bindings = await f.bindings();
    expect(bindings).toHaveLength(2);
    expect(bindings.find((row) => row.invocation === old.invocation)).toEqual(old);
    const current = bindings.find((row) => row.invocation !== old.invocation)!;
    expect(current.cgroupPath).not.toBe(old.cgroupPath);
    expect(current.cgroupIdentity).not.toEqual(old.cgroupIdentity);
    expect(await readFile(resolve(old.cgroupPath, "cgroup.procs"), "utf8")).toBe(`${orphan.pid}\n`);
    await f.standIn([supervisor2.identity], current);
    // Concurrent different run in another state root: never mixed in.
    const other = await harness("other");
    const otherLaunch = other.launch();
    const otherSupervisor = await other.take("supervisor");
    await other.standIn([otherSupervisor.identity]);
    const result = await observe(f);
    expect(result.status).toBe("observed");
    expect(result.invocations.map((row) => row.invocation).sort()).toEqual(
      [old.invocation, current.invocation].sort(),
    );
    expect(
      result.invocations
        .find((row) => row.invocation === old.invocation)!
        .members!.map((m) => m.pid),
    ).toEqual([orphan.pid]);
    expect(
      result.invocations
        .find((row) => row.invocation === current.invocation)!
        .members!.map((m) => m.pid),
    ).toEqual([supervisor2.identity.pid]);
    expect(pids(result)).not.toContain(otherSupervisor.identity.pid);
    expect(pids(await observe(other))).toEqual([otherSupervisor.identity.pid]);
    const human = formatStatus(await observeStatus(f.config, { preview, supervisor: exited }));
    expect(human).toContain("2 retained invocation(s)");
    expect(human).toContain(`Invocation ${old.invocation}`);
    expect(human).toContain(`Invocation ${current.invocation}`);
    await evidence("lifecycle", {
      old,
      current,
      other: await other.bindings(),
      observation: result,
    });
    // Exit code propagation through the wrapper.
    f.send("supervisor", "exit");
    other.send("supervisor", "exit");
    expect((await second.completion).code).toBe(3);
    expect((await otherLaunch.completion).code).toBe(0);
  },
);

linux("refuses a live supervisor outside every bound membership", async () => {
  const f = await harness();
  const { completion } = f.launch();
  const supervisor = await f.take("supervisor");
  f.outsider("same-group-outsider", false);
  const outsider = (await f.take("same-group-outsider")).identity;
  expect(outsider.pgid).toBe(supervisor.identity.pgid);
  expect(outsider.sid).toBe(supervisor.identity.sid);
  await f.standIn([supervisor.identity]);
  const status = (pid: number) =>
    observeStatus(f.config, { preview, supervisor: async () => ({ status: "running", pid }) });
  expect((await status(supervisor.identity.pid)).processOwnership.status).toBe("observed");
  expect((await status(supervisor.identity.pid)).status).toBe("running");
  const unbound = await status(outsider.pid);
  expect(unbound.processOwnership).toMatchObject({
    status: "unavailable",
    diagnostic: "ownership-supervisor-outside-boundary",
    invocations: [{ members: null }],
  });
  expect(unbound.processOwnership.invocations[0].binding).not.toBeNull();
  expect(unbound.status).toBe("running");
  expect(formatStatus(unbound)).toContain(
    "Process ownership unavailable (ownership-supervisor-outside-boundary)",
  );
  expect((await observe(f)).status).toBe("observed");
  await evidence("unbound-supervisor", unbound.processOwnership);
  f.send("supervisor", "exit");
  await completion;
});

linux(
  "refuses launch before any child when preparation fails and never reports absence as emptiness",
  async () => {
    const f = await harness();
    expect(await observe(f)).toMatchObject({
      status: "unavailable",
      diagnostic: "ownership-record-missing",
      invocations: [],
    });
    await mkdir(f.records, { recursive: true });
    expect(await observe(f)).toMatchObject({
      status: "unavailable",
      diagnostic: "ownership-record-missing",
    });
    await writeFile(f.cgroupRoot, "not a directory");
    const refusal = await f.launch().completion;
    expect(refusal.code).toBe(1);
    expect(refusal.stdout).toBe("");
    expect(refusal.stderr).toContain("ownership-launch-refused");
    expect(refusal.stderr).not.toContain(f.root);
    await expect(f.witness()).rejects.toMatchObject({ code: "ENOENT" });
    // The reserved invocation directory stays unresolved, never empty or reused.
    const result = await observe(f);
    expect(result).toMatchObject({
      status: "unavailable",
      diagnostic: "ownership-invocation-unresolved",
    });
    expect(result.invocations).toHaveLength(1);
    expect(result.invocations[0]).toMatchObject({ binding: null, members: null });
    await rm(f.cgroupRoot);
    const invalid = f.launch();
    await writeFile(f.config, "{}");
    const config = await invalid.completion;
    expect(config.code).toBe(1);
    expect(config.stderr).toContain("ownership-config-invalid");
  },
);
