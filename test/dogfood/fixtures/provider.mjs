import { readFileSync } from "node:fs";
const prompt = readFileSync(0, "utf8");
setTimeout(() => process.stdout.write(prompt + "\n"), 100);
