import { spawn } from "node:child_process";
import { dirname } from "node:path";

const mode = process.argv[2];

function send(value) {
  if (typeof process.send !== "function") throw new Error("ipc:required");
  process.send(value);
}

function receiveNonce(callback) {
  process.once("message", (message) => {
    if (
      message === null ||
      typeof message !== "object" ||
      Object.keys(message).length !== 1 ||
      !/^[0-9a-f]{64}$/.test(message.nonce ?? "")
    )
      throw new Error("nonce:invalid");
    callback(message.nonce);
  });
}

if (mode === "GRANDCHILD") {
  setTimeout(() => process.exit(0), 100);
} else if (mode === "PROCESS_TARGET") {
  receiveNonce((nonce) => {
    const grandchild = spawn(process.execPath, [import.meta.filename, "GRANDCHILD"], {
      cwd: dirname(process.execPath),
      detached: false,
      stdio: "ignore",
      windowsHide: true,
    });
    send({
      event: "READY",
      grandchildClaim: String(grandchild.pid),
      nonce,
      schemaVersion: "portable-primitive-process-child-event/v1",
    });
    setInterval(() => undefined, 1_000);
  });
} else if (mode === "HANDLE_REPLAY") {
  receiveNonce((nonce) => {
    process.stdout.write(
      `${JSON.stringify({
        nonce,
        schemaVersion: "portable-primitive-handle-replay/v1",
      })}\n`,
    );
    process.disconnect();
  });
} else {
  throw new Error("mode:invalid");
}
