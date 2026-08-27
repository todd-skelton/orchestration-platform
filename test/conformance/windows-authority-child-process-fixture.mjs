export function spawn(...arguments_) {
  const factory = globalThis.__orchestrationWindowsAuthoritySpawn;
  if (typeof factory !== "function") throw new TypeError("test spawn factory missing");
  return factory(...arguments_);
}
