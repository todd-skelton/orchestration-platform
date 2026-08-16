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

async function requiredCanonicalDirectory(parent, name) {
  const entries = await readdir(parent, { withFileTypes: true });
  const exact = entries.find((entry) => entry.name === name);
  if (!exact) {
    if (entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`capability slot path has noncanonical spelling for ${name}`);
    }
    return undefined;
  }
  const path = resolve(parent, name);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`capability slot path has unsafe directory ${name}`);
  }
  return path;
}

export async function capabilitySlotRoot(root) {
  const testDirectory = await requiredCanonicalDirectory(root, "test");
  return testDirectory && requiredCanonicalDirectory(testDirectory, "capability-slots");
}

export async function regularCapabilitySlot(root, issue, capability) {
  try {
    const slotsDirectory = await capabilitySlotRoot(root);
    const ownerDirectory = slotsDirectory && (await exactRegularChild(slotsDirectory, issue, true));
    return (
      ownerDirectory && exactRegularChild(ownerDirectory, capabilitySlotName(capability), false)
    );
  } catch {
    return undefined;
  }
}

export function pathBelow(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}
