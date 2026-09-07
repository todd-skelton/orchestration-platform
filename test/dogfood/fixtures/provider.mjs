import { readFileSync } from "node:fs";
const prompt = readFileSync(0, "utf8");
const assertion = JSON.parse(readFileSync(process.argv[2], "utf8"));
const allowed = new Set(assertion.allowed);
const names = Object.keys(process.env);
if (
  !Object.entries(assertion.locations).every(([name, value]) => process.env[name] === value) ||
  !assertion.present.every((name) => process.env[name] !== undefined) ||
  !names.every((name) => allowed.has(name)) ||
  names.some((name) => assertion.forbidden.includes(name.toUpperCase()))
)
  process.exit(9);
setTimeout(() => process.stdout.write(prompt + "\n"), 100);
