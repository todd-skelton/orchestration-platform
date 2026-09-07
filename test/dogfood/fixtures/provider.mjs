import { readFileSync, writeFileSync } from "node:fs";
const prompt = readFileSync(0, "utf8");
const assertion = JSON.parse(readFileSync(process.argv[2], "utf8"));
const allowed = new Set(assertion.allowed);
const names = Object.keys(process.env);
const runtimeName = (name) => process.platform === "darwin" && name === "__CF_USER_TEXT_ENCODING";
const checks = {
  locationsMatch: Object.entries(assertion.locations).every(
    ([name, value]) => process.env[name] === value,
  ),
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
setTimeout(() => process.stdout.write(prompt + "\n"), 100);
