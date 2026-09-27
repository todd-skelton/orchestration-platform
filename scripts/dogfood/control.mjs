// ISS-137: the launcher calls this before starting bridges or another supervisor.
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clearPause, requestPause } from "./pause.mjs";
import { observeSupervisor } from "./status.mjs";

export async function controlLoop(configPath, action, observe = observeSupervisor) {
  if (!["pause", "resume", "start"].includes(action))
    throw new Error("usage: control <config> pause|resume|start");
  const loop = JSON.parse(await readFile(configPath, "utf8"));
  if (loop.schemaVersion !== "dogfood-loop/v1" || !loop.run || !loop.stateRoot)
    throw new Error("invalid-loop-control-config");
  if (action === "pause")
    return { status: "pause-requested", run: loop.run, pause: await requestPause(loop) };
  const supervisor = await observe(configPath);
  if (supervisor.status !== "exited")
    throw new Error(
      `supervisor-${supervisor.status}: inspect status and wait for exit before ${action}`,
    );
  if (action === "resume") await clearPause(loop);
  return { status: `${action}-ready`, run: loop.run };
}

if (
  process.argv[1] &&
  (await realpath(process.argv[1]).catch(() => "")) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4) throw new Error("usage: control <config> pause|resume|start");
    console.log(JSON.stringify(await controlLoop(resolve(process.argv[2]), process.argv[3])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
