export function capabilitySlotName(capability: string): string;
export function capabilitySlotPath(root: string, issue: string, capability: string): string;
export function capabilitySlotRoot(root: string): Promise<string | undefined>;
export function regularCapabilitySlot(
  root: string,
  issue: string,
  capability: string,
): Promise<string | undefined>;
