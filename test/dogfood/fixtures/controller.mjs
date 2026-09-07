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
const clean =
  locationsMatch &&
  assertion.present.every((name) => process.env[name] !== undefined) &&
  names.every((name) => allowed.has(name)) &&
  !names.some((name) => assertion.forbidden.includes(name.toUpperCase()));
if (!clean) process.exit(9);
writeFileSync(assertion.result, "observer-environment-ok");
