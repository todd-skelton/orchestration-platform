import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const catalogUrl = new URL("../config/model-options.json", import.meta.url);
const purposes = ["task", "orchestration"];

export async function readModelOptions() {
  const { models } = JSON.parse(await readFile(catalogUrl, "utf8"));
  if (
    !Array.isArray(models) ||
    new Set(models.map((model) => model.selector)).size !== models.length
  ) {
    throw new Error("Model options must contain unique selectors");
  }
  return models;
}

export function listModelOptions(models, purpose) {
  if (!purposes.includes(purpose)) throw new Error(`Unknown selection purpose: ${purpose}`);
  return models.filter((model) => model.purposes.includes(purpose));
}

export function selectModelOption(models, purpose, selector, effort) {
  const option = listModelOptions(models, purpose).find((model) => model.selector === selector);
  if (!option) throw new Error(`Model is not selectable for ${purpose}: ${selector}`);
  if (!option.efforts.includes(effort)) {
    throw new Error(`Unsupported effort for ${selector}: ${effort}`);
  }
  return {
    provider: option.provider,
    harness: option.harness,
    modelSelector: option.selector,
    effort,
    purpose,
    identityStatus: "selector-only",
  };
}

export async function runModelOptions(args) {
  const [command, purpose, selector, effort] = args;
  if (command === "list" && args.length === 2) {
    return listModelOptions(await readModelOptions(), purpose);
  }
  if (command === "select" && args.length === 4) {
    return selectModelOption(await readModelOptions(), purpose, selector, effort);
  }
  throw new Error(
    "Usage: model-options.mjs list <task|orchestration> | select <task|orchestration> <selector> <effort>",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runModelOptions(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
