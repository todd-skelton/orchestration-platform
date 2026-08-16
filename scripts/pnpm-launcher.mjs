import { access } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

export async function resolvePnpmLauncher(npmExecpath = process.env.npm_execpath) {
  if (npmExecpath) {
    if (extname(npmExecpath).toLowerCase() === ".exe") {
      return { executable: npmExecpath, prefixArgs: [] };
    }
    return { executable: process.execPath, prefixArgs: [npmExecpath] };
  }

  for (const candidate of [
    resolve(dirname(process.execPath), "node_modules/corepack/dist/corepack.js"),
    resolve(dirname(process.execPath), "../lib/node_modules/corepack/dist/corepack.js"),
  ]) {
    try {
      await access(candidate);
      return { executable: process.execPath, prefixArgs: [candidate, "pnpm"] };
    } catch {}
  }

  throw new Error("cannot locate pnpm launcher");
}
