import { readFileSync } from "node:fs";
const prompt = readFileSync(0, "utf8");
const excludedDeliveryCredentials = [
  "GH_TOKEN",
  "gh_token",
  "GITHUB_TOKEN",
  "github_token",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "github_personal_access_token",
  "GH_ENTERPRISE_TOKEN",
  "gh_enterprise_token",
  "GITHUB_ENTERPRISE_TOKEN",
  "github_enterprise_token",
];
if (
  process.env.DOGFOOD_VERIFY_ENV === "1" &&
  (process.env.CODEX_PERMISSION_PROFILE !== undefined ||
    process.env.CODEX_APP_TOOLS_PIPE_PATH !== undefined ||
    process.env.CODEX_HOME !== "synthetic-auth-home" ||
    excludedDeliveryCredentials.some((key) => process.env[key] !== undefined))
)
  process.exit(9);
setTimeout(() => process.stdout.write(prompt + "\n"), 100);
