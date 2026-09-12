// Forwards TCP from the WSL-facing host address to the local subscription pool,
// which listens on 127.0.0.1 only. Runs on the Windows host; see docs/loop.md.
import { connect, createServer } from "node:net";

const address = process.argv[2];
const port = 8317;
if (!address) throw new Error("usage: node scripts/executor/pool-bridge.mjs <wsl-host-address>");

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
