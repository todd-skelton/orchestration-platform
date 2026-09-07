import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "launch-observer") {
  const { launchObserver } = await import("../../../scripts/dogfood/dispatch-adapter.ts");
  await launchObserver(process.argv[3], fileURLToPath(import.meta.url));
  process.exit(0);
}
const assertion = JSON.parse(readFileSync(process.argv[2], "utf8"));
const allowed = new Set(assertion.allowed);
const names = Object.keys(process.env);
const locationsMatch = Object.entries(assertion.locations).every(
  ([name, value]) => process.env[name] === value,
);
// CoreFoundation may generate this one field after exec on macOS; it is not
// copied by either production allowlist. No runtime prefixes are exempted.
const runtimeName = (name) => process.platform === "darwin" && name === "__CF_USER_TEXT_ENCODING";
const checks = {
  locationsMatch,
  requiredNamesPresent: assertion.present.every((name) => process.env[name] !== undefined),
  onlyAllowlistedNames: names.every((name) => allowed.has(name)),
  onlyExpectedNames: names.every((name) => allowed.has(name) || runtimeName(name)),
  forbiddenAbsent: !names.some((name) => assertion.forbidden.includes(name.toUpperCase())),
  runtimeMetadataPresent: process.env.__CF_USER_TEXT_ENCODING !== undefined,
};
writeFileSync(assertion.result, JSON.stringify(checks));
if (
  !checks.locationsMatch ||
  !checks.requiredNamesPresent ||
  !checks.onlyExpectedNames ||
  !checks.forbiddenAbsent
)
  process.exit(9);
