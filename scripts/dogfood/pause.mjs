// ISS-137: operator intent is separate from supervisor scheduling records.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function pausePaths(loop) {
  const directory = resolve(loop.stateRoot, loop.run);
  return {
    request: resolve(directory, "operator", "pause.json"),
    acknowledgement: resolve(directory, "pause-acknowledgement.json"),
  };
}

async function read(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Publish complete JSON to the other process. Each file has one writer.
async function save(path, value) {
  await writeFile(`${path}.tmp`, JSON.stringify(value) + "\n");
  await rename(`${path}.tmp`, path);
}

export async function observePause(loop) {
  const paths = pausePaths(loop);
  const request = await read(paths.request);
  const acknowledgement = await read(paths.acknowledgement);
  return {
    ...paths,
    requestedAt: request?.requestedAt ?? null,
    requestId: request?.id ?? null,
    acknowledgedAt:
      request && acknowledgement?.requestId === request.id ? acknowledgement.at : null,
  };
}

export async function requestPause(loop) {
  const { request } = pausePaths(loop);
  await mkdir(dirname(request), { recursive: true });
  if (!(await read(request)))
    await save(request, { id: randomUUID(), requestedAt: new Date().toISOString() });
  return observePause(loop);
}

// Only the operator's explicit resume removes intent; acknowledgement is history.
export async function clearPause(loop) {
  await rm(pausePaths(loop).request, { force: true });
}

export class PauseRequested extends Error {
  constructor(pause) {
    super("pause-after-current");
    this.pause = pause;
  }
}

export async function pauseBeforeSelection(loop) {
  const pause = await observePause(loop);
  if (!pause.requestId) return;
  if (!pause.acknowledgedAt) {
    pause.acknowledgedAt = new Date().toISOString();
    await save(pause.acknowledgement, { requestId: pause.requestId, at: pause.acknowledgedAt });
  }
  throw new PauseRequested(pause);
}
