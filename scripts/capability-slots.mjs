import { lstat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export function capabilitySlotName(capability) {
  return `${encodeURIComponent(capability)}.mjs`;
}

export function capabilitySlotPath(root, issue, capability) {
  return resolve(root, "test/capability-slots", issue, capabilitySlotName(capability));
}

export async function regularCapabilitySlot(root, issue, capability) {
  const path = capabilitySlotPath(root, issue, capability);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) return undefined;
    return path;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export function pathBelow(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}
