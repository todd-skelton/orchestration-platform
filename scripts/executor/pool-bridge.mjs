// Forwards TCP from the WSL-facing host address to the local subscription pool,
// which listens on 127.0.0.1 only. Runs on the Windows host; see docs/loop.md.
// One bridge per port: 8317 carries inference, 8318 the read-only pool status
// the loop consults before each launch (ISS-162).
import { connect, createServer } from "node:net";

const address = process.argv[2];
const port = Number(process.argv[3] ?? 8317);
if (!address || !Number.isInteger(port) || port <= 0)
  throw new Error("usage: node scripts/executor/pool-bridge.mjs <wsl-host-address> [port]");

createServer((client) => {
  const upstream = connect({ host: "127.0.0.1", port }, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const drop = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", drop);
  upstream.on("error", drop);
}).listen(port, address, () => {
  console.log(`pool bridge ${address}:${port} -> 127.0.0.1:${port}`);
});
