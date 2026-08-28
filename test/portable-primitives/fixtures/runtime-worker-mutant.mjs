const mode = process.argv[2];

function valid(nonce) {
  return {
    event: "READY",
    grandchildClaim: "1",
    nonce,
    schemaVersion: "portable-primitive-process-child-event/v1",
  };
}

process.once("message", (message) => {
  const nonce = message?.nonce;
  if (mode === "NONCE_MISMATCH") {
    process.send(valid("0".repeat(64)));
  } else if (mode === "MALFORMED") {
    process.send({ event: "READY" });
  } else if (mode === "MULTIPLE") {
    process.send(valid(nonce));
    process.send(valid(nonce));
  } else if (mode === "OVERFLOW") {
    process.stderr.write("x".repeat(64 * 1024 + 1));
  } else if (mode !== "TIMEOUT") {
    throw new Error("mode:invalid");
  }
  setInterval(() => undefined, 1_000);
});
