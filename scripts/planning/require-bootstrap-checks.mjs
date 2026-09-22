import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredChecks } from "../../adapters/self.mjs";

const repository = "todd-skelton/orchestration-platform";
const RULESET_ID = 21694457;
const endpoint = `repos/${repository}/rulesets/${RULESET_ID}`;

function runGh(args, input) {
  return execFileSync("gh", args, { input, encoding: "utf8", windowsHide: true });
}

function matchesBootstrapRule(rule, contexts) {
  const checks = rule.parameters?.required_status_checks;
  return (
    rule.parameters?.strict_required_status_checks_policy === false &&
    Array.isArray(checks) &&
    checks.length === contexts.length &&
    contexts.every((context) => checks.filter((check) => check.context === context).length === 1)
  );
}

// ISS-175: reports or adds the one required_status_checks rule on the main
// ruleset. The loop's own REQUIRED_CHECKS observation before merge is separate.
export function requireBootstrapChecks(mode, gh = runGh) {
  if (mode !== "check" && mode !== "apply") {
    throw new Error("usage: node scripts/planning/require-bootstrap-checks.mjs check|apply");
  }
  const ruleset = JSON.parse(gh(["api", endpoint]));
  const existing = ruleset.rules.filter((rule) => rule.type === "required_status_checks");
  const contexts = requiredChecks({ repository });
  if (mode === "check") {
    if (!existing.some((rule) => matchesBootstrapRule(rule, contexts))) {
      throw new Error(
        `ruleset ${RULESET_ID} must require exactly ${contexts.join(", ")} with strict policy false`,
      );
    }
    return `ruleset ${RULESET_ID}: bootstrap contexts required; strict policy false`;
  }
  if (existing.length > 0) {
    return `ruleset ${RULESET_ID}: required_status_checks already present; unchanged (run check to verify)`;
  }
  // Read-modify-write: everything read is sent back as is, plus the one rule.
  const { name, target, enforcement, bypass_actors, conditions, rules } = ruleset;
  gh(
    ["api", "--method", "PUT", endpoint, "--input", "-"],
    JSON.stringify({
      name,
      target,
      enforcement,
      bypass_actors,
      conditions,
      rules: [
        ...rules,
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: contexts.map((context) => ({ context })),
            strict_required_status_checks_policy: false,
          },
        },
      ],
    }),
  );
  return `ruleset ${RULESET_ID}: added bootstrap contexts with strict policy false; existing rules unchanged`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(requireBootstrapChecks(process.argv.length === 3 ? process.argv[2] : undefined));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
