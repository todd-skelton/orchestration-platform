import { readFileSync } from "node:fs";
const prompt = readFileSync(0, "utf8");
if (
  process.env.DOGFOOD_VERIFY_ENV === "1" &&
  (process.env.CODEX_PERMISSION_PROFILE !== undefined ||
    process.env.CODEX_APP_TOOLS_PIPE_PATH !== undefined ||
    process.env.CODEX_HOME !== "synthetic-auth-home")
)
  process.exit(9);
setTimeout(() => process.stdout.write(prompt + "\n"), 100);
