import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../../../scripts/dogfood/observe-process.mjs", import.meta.url)),
    process.argv[2],
  ],
  {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  },
);
child.unref();
