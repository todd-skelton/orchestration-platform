// Four observation rows only. Even four OBSERVED rows are missing the twelve
// controls, complete build census, diagnostic reducer and provider evidence.
import { candidateReply, childClosed, defaultReply, expectLock } from "./capture.mjs";
import { requireCaseContext } from "./case-context.mjs";

export const caseIds = Object.freeze([
  "NATIVE_UNRELATED_EXCLUSION",
  "NATIVE_NORMAL_RELEASE",
  "NATIVE_DEFAULT_NON_INHERITANCE",
  "NATIVE_HOLDER_DEATH_ONCE",
]);

export async function runCases(value) {
  const context = requireCaseContext(value);
  context.beginCases();
  const cases = [],
    diagnostics = [];
  let stopped = null;
  for (const [index, caseId] of caseIds.entries()) {
    if (stopped) {
      cases.push(
        Object.freeze({
          caseId,
          events: Object.freeze([]),
          result: stopped === "UNSUPPORTED" ? "UNSUPPORTED" : "UNKNOWN",
        }),
      );
      continue;
    }
    const journal = context.newCase();
    const actors = {},
      processes = [];
    let commandSequence = 0;
    const started = process.hrtime.bigint();
    let watchdog;
    const deadline = new Promise((_, reject) => {
      watchdog = setTimeout(() => {
        journal.emit("PARENT", "WATCHDOG", {
          limitMilliseconds: "10000",
          elapsedNanoseconds: String(process.hrtime.bigint() - started),
        });
        journal.fail("UNKNOWN", "row watchdog expired");
        for (const captured of processes) captured.abort();
        reject(new Error("native-lock-cases:watchdog"));
      }, 10000);
    });
    function launch(actor) {
      context.barrier(journal);
      const instance = context.spawn(actor, journal);
      actors[actor] = instance.captured.output;
      processes.push(instance.captured);
      return { ...instance, actor, nativeHandle: null };
    }
    async function command(instance, name, closeTerminal = false) {
      context.barrier(journal);
      const command = {
        sequence: String(commandSequence++),
        name,
        ...(name === "READY" ? { configuration: instance.configuration } : {}),
      };
      const reply = await instance.captured.exchange(command, closeTerminal);
      journal.assert();
      return { command, reply };
    }
    async function ready(instance) {
      const { command: issued, reply } = await command(instance, "READY");
      instance.nativeHandle = candidateReply(
        journal,
        instance.actor,
        reply,
        issued,
        context.identity,
      );
      instance.captured.assertLive();
      context.barrier(journal);
    }
    async function acquire(instance, expected) {
      const { command: issued, reply } = await command(instance, "ACQUIRE");
      const facts = candidateReply(
        journal,
        instance.actor,
        reply,
        issued,
        context.identity,
        instance.nativeHandle,
      );
      expectLock(journal, instance.actor, facts, context.identity, instance.nativeHandle, expected);
      instance.captured.assertLive();
      context.barrier(journal);
    }
    function challenge(holder, expected) {
      context.barrier(journal);
      holder.captured.assertLive();
      const facts = context.tryWitness(journal);
      expectLock(journal, "PARENT", facts, context.identity, context.nativeHandle, expected);
      holder.captured.assertLive();
      context.barrier(journal);
    }
    async function release(holder) {
      const { command: issued, reply } = await command(holder, "RELEASE");
      candidateReply(journal, holder.actor, reply, issued, context.identity, holder.nativeHandle);
      holder.captured.assertLive();
      context.barrier(journal);
    }
    async function close(instance) {
      const { command: issued, reply } = await command(instance, "CLOSE", true);
      candidateReply(
        journal,
        instance.actor,
        reply,
        issued,
        context.identity,
        instance.nativeHandle,
      );
      await instance.captured.closed;
      journal.assert();
      context.barrier(journal);
    }
    async function row() {
      const holder = launch("HOLDER");
      const contender = index === 0 ? launch("CONTENDER") : null;
      await ready(holder);
      if (contender) await ready(contender);
      await acquire(holder, "ACQUIRED");
      challenge(holder, "CONTENDED"); // Only this real witness establishes HELD.
      if (index === 0) {
        await acquire(contender, "CONTENDED");
        holder.captured.assertLive();
        contender.captured.assertLive();
        await close(contender);
        await release(holder);
        await close(holder);
      } else if (index === 1) {
        await release(holder);
        challenge(holder, "ACQUIRED"); // Holder has not received CLOSE.
        context.releaseWitness(journal);
        await close(holder);
      } else if (index === 2) {
        const spawned = await command(holder, "SPAWN_DEFAULT_CHILD");
        defaultReply(
          journal,
          spawned.reply,
          spawned.command,
          context.identity,
          holder.nativeHandle,
        );
        // The stable holder owns the child's exact handle and forbids its
        // terminal events until the parent commands CLOSE below.
        challenge(holder, "CONTENDED");
        const child = await command(holder, "CLOSE");
        actors.DEFAULT_CHILD = childClosed(journal, child.reply, child.command);
        holder.captured.assertLive();
        context.barrier(journal);
        await release(holder);
        await close(holder);
      } else {
        context.barrier(journal);
        holder.captured.assertLive();
        let attempted = false,
          facts;
        await holder.captured.terminateOnce(() => {
          // The callback is invoked synchronously by that handle's CLOSE.
          facts = context.tryWitness(journal);
          attempted = true;
        });
        journal.assert();
        if (!attempted) journal.stop("UNKNOWN", "missing post-death attempt");
        // Custody is deliberately after the single native attempt. Preserve
        // both a custody failure and the native result if they coexist.
        try {
          context.barrier(journal);
        } catch {
          journal.fail("UNKNOWN", "post-death custody refused");
        }
        expectLock(journal, "PARENT", facts, context.identity, context.nativeHandle, "ACQUIRED");
        context.releaseWitness(journal);
        context.finishCustody(journal);
      }
    }
    try {
      await Promise.race([row(), deadline]);
    } catch {
      if (!journal.failures.length) journal.fail("UNKNOWN", "missing or malformed case evidence");
    }
    const result = journal.freeze();
    cases.push(Object.freeze({ caseId, events: journal.events, result }));
    if (result !== "OBSERVED") {
      stopped = result;
      // Measurement is frozen before cleanup. No retry/acquisition can run:
      // every resumed command checks the now-inactive journal.
      const closed = Promise.all(processes.map((captured) => captured.cleanup()));
      // Spend only what remains of this row's existing watchdog on cleanup.
      // Its deadline cannot trigger another measurement or alter frozen rows.
      await Promise.race([closed, deadline.catch(() => undefined)]);
    }
    clearTimeout(watchdog);
    diagnostics.push(context.retain(caseId, actors, journal));
  }
  context.endCases();
  return Object.freeze({ cases: Object.freeze(cases), diagnostics: Object.freeze(diagnostics) });
}
