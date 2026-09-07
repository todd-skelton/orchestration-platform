import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { step } from "./flow.ts";
import { codexAdapter } from "./dispatch-adapter.ts";

try {
  if (process.argv.length !== 3)
    throw new Error("usage: node scripts/dogfood/run.mjs <config.json>");
  const config = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
  const adapter = codexAdapter();
  for (;;) {
    const result = await step(config, adapter, resolve(import.meta.dirname, "../.."));
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
    if (!result.status.startsWith("observing-")) break;
    await new Promise((done) => setTimeout(done, 10000));
  }
} catch (error) {
  console.error(JSON.stringify({ status: "blocked", reason: error.message }));
  process.exitCode = 1;
}
