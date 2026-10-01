// Independent /proc oracle and named-pipe barrier for inert fixture processes.
// It never imports the collector under test, so captured identities are never
// derived from the code they are used to check.
import { constants, openSync, read, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function identity(pid = process.pid) {
  const text = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = text
    .slice(text.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  return {
    pid,
    starttime: fields[19],
    ppid: Number(fields[1]),
    pgid: Number(fields[2]),
    sid: Number(fields[3]),
    state: fields[0],
  };
}

// Every fixture process announces itself once on the shared events pipe and
// then blocks on its own command pipe; the harness releases it explicitly.
export async function peer(address, name, extra = {}) {
  const events = openSync(resolve(address, "events"), constants.O_RDWR);
  const inbox = openSync(resolve(address, name), constants.O_RDWR);
  const send = (event, data = {}) =>
    writeSync(events, `${JSON.stringify({ name, event, ...data })}\n`);
  send("ready", { identity: await identity(), ...extra });
  let buffer = "";
  return {
    send,
    async next() {
      while (!buffer.includes("\n")) {
        const bytes = Buffer.alloc(4096);
        const length = await new Promise((done, reject) =>
          read(inbox, bytes, 0, bytes.length, null, (error, count) =>
            error ? reject(error) : done(count),
          ),
        );
        buffer += bytes.subarray(0, length).toString("utf8");
      }
      const end = buffer.indexOf("\n");
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      return message;
    },
  };
}
