export function capabilitySlotName(capability: string): string;
export function capabilitySlotPath(root: string, issue: string, capability: string): string;
export function regularCapabilitySlot(
  root: string,
  issue: string,
  capability: string,
): Promise<string | undefined>;
