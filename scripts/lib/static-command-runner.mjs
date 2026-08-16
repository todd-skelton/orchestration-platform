const GLOBAL_FLAGS = Object.freeze({
  "--project-root": true,
  "--state-root": true,
  "--config": true,
  "--output": true,
  "--no-color": false,
});

function invalid(command, message) {
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: "orchestration-command-result/v1",
      command,
      outcome: "invalid-input",
      result: {},
      diagnostics: [{ code: "INVALID_COMMAND_LINE", message }],
    })}\n`,
  );
  return 2;
}

function placeholder(command, issue) {
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: "orchestration-command-result/v1",
      command,
      outcome: "operation-failed",
      result: {},
      diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: issue }],
    })}\n`,
  );
  return 5;
}

function parseFlags(tokens, shape) {
  const allowed = new Map([
    ...shape.required.map((name) => [name, true]),
    ...shape.optional.map(({ name, takesValue }) => [name, takesValue]),
  ]);
  const seen = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const flag = tokens[index];
    if (!allowed.has(flag) || seen.has(flag))
      return `unknown or duplicate flag: ${flag ?? "<missing>"}`;
    seen.add(flag);
    if (allowed.get(flag)) {
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) return `missing value for ${flag}`;
      index += 1;
    }
  }
  const missing = shape.required.find((flag) => !seen.has(flag));
  return missing ? `missing required flag: ${missing}` : undefined;
}

export function runStaticCommandRegistry({
  argv,
  registrations,
  allowGlobalFlags = false,
  commandDepth = 2,
}) {
  const families = new Set();
  const commands = new Map();
  for (const registration of registrations) {
    if (families.has(registration.family))
      throw new Error(`duplicate command family: ${registration.family}`);
    families.add(registration.family);
    for (const shape of registration.commands) {
      const key = shape.argv.join(" ");
      if (commands.has(key)) throw new Error(`duplicate command: ${key}`);
      commands.set(key, { ...shape, issue: registration.issue });
    }
  }

  const tokens = [...argv];
  if (allowGlobalFlags) {
    const seen = new Set();
    while (tokens[0]?.startsWith("--") && GLOBAL_FLAGS[tokens[0]] !== undefined) {
      const flag = tokens.shift();
      if (seen.has(flag)) return invalid("", `duplicate global flag: ${flag}`);
      seen.add(flag);
      if (GLOBAL_FLAGS[flag]) {
        const value = tokens.shift();
        if (!value || value.startsWith("--")) return invalid("", `missing value for ${flag}`);
        if (flag === "--output" && value !== "json" && value !== "text") {
          return invalid("", "--output must be json or text");
        }
      }
    }
  }

  const key = tokens.slice(0, commandDepth).join(" ");
  const shape = commands.get(key);
  if (!shape) return invalid(key, "unknown command");
  const error = parseFlags(tokens.slice(commandDepth), shape);
  if (error) return invalid(key, error);
  return placeholder(key, shape.issue);
}
