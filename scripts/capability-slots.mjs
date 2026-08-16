import { lstat, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export function capabilitySlotName(capability) {
  return `${encodeURIComponent(capability)}.mjs`;
}

export function capabilitySlotPath(root, issue, capability) {
  return resolve(root, "test/capability-slots", issue, capabilitySlotName(capability));
}

async function exactRegularChild(parent, name, directory) {
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  if (!entries.some((entry) => entry.name === name)) return undefined;
  const path = resolve(parent, name);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile())) {
    return undefined;
  }
  return path;
}

export async function regularCapabilitySlot(root, issue, capability) {
  const testDirectory = await exactRegularChild(root, "test", true);
  const slotsDirectory =
    testDirectory && (await exactRegularChild(testDirectory, "capability-slots", true));
  const ownerDirectory = slotsDirectory && (await exactRegularChild(slotsDirectory, issue, true));
  return ownerDirectory && exactRegularChild(ownerDirectory, capabilitySlotName(capability), false);
}

export function pathBelow(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}
