import { types } from "node:util";
import { checkAddon } from "./io.mjs";
import {
  decimal,
  identity,
  lockDisposition,
  openOperations,
  operationsAre,
  parseFacts,
  record,
  refuse,
  requireLiveFacts,
  sameIdentity,
  successful,
} from "./facts.mjs";

export function parseCommand(value, ready = false) {
  // Wire sequence correlates a parent-issued command (gaps are expected). It is
  // not a report event sequence: the coordinator assigns those to all retained
  // commands, calls and terminal events, including the forwarded default child.
  const command = record(
    value,
    ready ? ["sequence", "name", "configuration"] : ["sequence", "name"],
  );
  decimal(command.sequence);
  if (
    BigInt(command.sequence) > BigInt(Number.MAX_SAFE_INTEGER) ||
    !(ready ? ["READY"] : ["ACQUIRE", "RELEASE", "SPAWN_DEFAULT_CHILD", "CLOSE"]).includes(
      command.name,
    )
  )
    refuse();
  return command;
}

// Local fixture state is only a claim. HELD is deliberately absent: only the
// stable parent's independent witness challenge may establish that barrier.
// Tests may pass a visibly synthetic addon to this exact command guard; the
// executable fixture always obtains its addon from loadNative's checked .node.
export function candidateSession(addon, fixedPath, expectedIdentity) {
  checkAddon(addon, "CANDIDATE_BINDING");
  identity(expectedIdentity);
  let state = "UNOPENED",
    handle = null,
    nativeHandle = null,
    attempted = false,
    previous = -1n;
  function run(command) {
    command = parseCommand(command, state === "UNOPENED");
    if (BigInt(command.sequence) <= previous || state === "FAILED" || state === "CLOSED") refuse();
    previous = BigInt(command.sequence);
    let facts;
    try {
      if (command.name === "READY" && state === "UNOPENED") {
        state = "FAILED";
        const result = addon.openFixedLock(fixedPath);
        if (
          !result ||
          typeof result !== "object" ||
          types.isProxy(result) ||
          Object.getPrototypeOf(result) !== Object.prototype
        )
          refuse();
        const fields = Object.getOwnPropertyDescriptors(result);
        if (
          Reflect.ownKeys(fields).length !== 2 ||
          !fields.handle ||
          !fields.facts ||
          !("value" in fields.handle) ||
          !("value" in fields.facts) ||
          !fields.handle.enumerable ||
          !fields.facts.enumerable
        )
          refuse();
        facts = parseFacts(fields.facts.value);
        handle = fields.handle.value;
        if (handle !== null) {
          if (typeof handle !== "object" || types.isProxy(handle)) refuse();
          nativeHandle = requireLiveFacts(facts, openOperations, expectedIdentity);
          state = "OPEN";
        }
      } else if (command.name === "ACQUIRE" && state === "OPEN" && !attempted) {
        attempted = true;
        state = "FAILED";
        facts = parseFacts(addon.tryLock(handle));
        const disposition = lockDisposition(facts);
        const fact = facts[0];
        if (
          fact.identity === null ||
          !sameIdentity(fact.identity, expectedIdentity) ||
          fact.nativeHandle !== nativeHandle ||
          fact.nonInheritable !== true
        )
          refuse();
        if (disposition === "ACQUIRED") state = "LOCKED";
        else if (disposition === "CONTENDED") state = "OPEN";
      } else if (command.name === "RELEASE" && state === "LOCKED") {
        state = "FAILED";
        facts = parseFacts(addon.release(handle));
        if (!operationsAre(facts, ["UNLOCK"])) refuse();
        if (facts.every(successful)) {
          requireLiveFacts(facts, ["UNLOCK"], expectedIdentity, nativeHandle);
          state = "OPEN";
        }
      } else if (command.name === "CLOSE" && state === "OPEN") {
        state = "FAILED";
        const closing = handle;
        handle = null;
        facts = parseFacts(addon.close(closing));
        if (!operationsAre(facts, ["CLOSE"])) refuse();
        if (facts.every(successful)) {
          if (facts[0].identity === null || !sameIdentity(facts[0].identity, expectedIdentity))
            refuse();
          state = "CLOSED";
        }
      } else refuse();
      return Object.freeze({ sequence: command.sequence, name: command.name, facts, state });
    } catch (error) {
      state = "FAILED";
      throw error;
    }
  }
  return Object.freeze({
    run,
    get state() {
      return state;
    },
    get nativeHandle() {
      return nativeHandle;
    },
  });
}
