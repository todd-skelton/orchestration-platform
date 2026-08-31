import { types as nodeTypes } from "node:util";

import {
  canonicalJson,
  orchestrationCommandCensus,
  snapshotClosedArray,
  snapshotClosedRecord,
} from "@orchestration-platform/contracts";

import type { CommandHandler } from "../../config/src/config-command.js";
import type { ConfigurationLoaderInvocation, LoadConfiguration } from "../../config/src/loader.js";
import {
  prepareArgvRefusal,
  prepareCommandResult,
  preparePlaceholderResult,
  type PreparedCommandEmission,
} from "./command-result.js";
import { commandRegistry } from "./registry.mjs";

export type CommandDispatchContext = Omit<ConfigurationLoaderInvocation, "flags">;

const globalFlags = new Map([
  ["--config", true],
  ["--project-root", true],
  ["--state-root", true],
  ["--output", true],
  ["--no-color", false],
]);
const registrationFields = [
  "commands",
  "family",
  "implementation",
  "issue",
  "owner",
  "schemaVersion",
];
const environmentFields = [
  "HOME",
  "LOCALAPPDATA",
  "ORCHESTRATION_CONFIG",
  "ORCHESTRATION_PROJECT_ROOT",
  "ORCHESTRATION_STATE_ROOT",
  "XDG_STATE_HOME",
];
const resultSchemas = new Map([
  ["config validate", "configuration-provenance/v1"],
  ["config paths", "configuration-paths/v1"],
]);

// Static registration remains the sole owner/option registry; detach only the
// handler and result schema for the common command-shape comparison.
const metadata = commandRegistry.map((registration) => {
  const { handler: _handler, ...data } = { handler: null, ...registration };
  const snapshot = snapshotClosedRecord(
    {
      ...data,
      commands: data.commands.map((shape) => {
        const { resultSchema: _schema, ...command } = { resultSchema: null, ...shape };
        return command;
      }),
    },
    registrationFields,
  );
  if (!snapshot.ok) throw new Error("dispatcher:static-registration-drift");
  return snapshot.value;
});
const commandShapes = new Map(
  metadata.flatMap((registration) =>
    (registration.commands as readonly { argv: readonly string[] }[]).map((shape) => {
      const snapshot = snapshotClosedRecord(shape, ["argv", "optional", "required"]);
      if (!snapshot.ok) throw new Error("dispatcher:static-command-drift");
      return [shape.argv.join(" "), snapshot.value] as const;
    }),
  ),
);

function refusal(command: string, code: "ARGV_REFUSED" | "CONFIG_REFUSED" | "INTERNAL_ERROR") {
  const rows = {
    ARGV_REFUSED: { code, exitCode: 2, message: "command line refused", outcome: "invalid-input" },
    CONFIG_REFUSED: {
      code,
      exitCode: 2,
      message: "configuration refused",
      outcome: "invalid-input",
    },
    INTERNAL_ERROR: { code, exitCode: 70, message: "internal error", outcome: "internal-error" },
  };
  return prepareCommandResult(command, { ok: false, error: rows[code] });
}

// Shallow inspection is needed only for the function-bearing registration and
// the invocation shell, whose environment defects have a different failure row.
function ownData(input: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || nodeTypes.isProxy(input)) return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  )
    return null;
  const copy: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    copy[field] = descriptor.value;
  }
  return copy;
}

interface RegisteredCommand {
  readonly issue: string;
  readonly handler: CommandHandler | null;
}

function admitRegistry(input: unknown): ReadonlyMap<string, RegisteredCommand> | null {
  try {
    if (
      !Array.isArray(input) ||
      nodeTypes.isProxy(input) ||
      Object.getPrototypeOf(input) !== Array.prototype
    )
      return null;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(input);
    if (
      descriptors.length?.value !== metadata.length ||
      Reflect.ownKeys(descriptors).length !== metadata.length + 1
    )
      return null;
    const commands = new Map<string, RegisteredCommand>();
    const families = new Set<string>();
    for (let index = 0; index < metadata.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      const placeholder = ownData(descriptor.value, registrationFields);
      const implementation = ownData(descriptor.value, [...registrationFields, "handler"]);
      const record = placeholder ?? implementation;
      if (!record || typeof record.family !== "string" || families.has(record.family)) return null;
      families.add(record.family);
      const expected = metadata.find((row) => row.family === record.family);
      if (!expected) return null;
      const implemented = record.family === "config";
      if (
        record.implementation !== (implemented ? "implemented" : "placeholder") ||
        (implemented
          ? !implementation ||
            typeof record.handler !== "function" ||
            nodeTypes.isProxy(record.handler)
          : !placeholder)
      )
        return null;
      const parsed = snapshotClosedRecord({ ...record, handler: null }, [
        ...registrationFields,
        "handler",
      ]);
      if (!parsed.ok) return null;
      const observedCommands = snapshotClosedArray(parsed.value.commands);
      if (!observedCommands.ok) return null;
      const strippedCommands = [];
      for (const candidate of observedCommands.value) {
        const shape = snapshotClosedRecord(
          candidate,
          implemented
            ? ["argv", "optional", "required", "resultSchema"]
            : ["argv", "optional", "required"],
        );
        if (!shape.ok || !Array.isArray(shape.value.argv)) return null;
        const command = shape.value.argv.join(" ");
        if (
          commands.has(command) ||
          (implemented && shape.value.resultSchema !== resultSchemas.get(command))
        )
          return null;
        const { resultSchema: _schema, ...stripped } = shape.value;
        strippedCommands.push(stripped);
        commands.set(
          command,
          Object.freeze({
            issue: String(record.issue),
            handler: implemented ? (record.handler as CommandHandler) : null,
          }),
        );
      }
      const { handler: _handler, ...data } = parsed.value;
      if (
        canonicalJson({
          ...data,
          commands: strippedCommands,
          implementation: expected.implementation,
        }) !== canonicalJson(expected)
      )
        return null;
    }
    if (
      commands.size !== orchestrationCommandCensus.length ||
      orchestrationCommandCensus.some((row) => !commands.has(row.command))
    )
      return null;
    return commands;
  } catch {
    return null;
  }
}

function parseOptions(tokens: readonly string[], allowed: ReadonlyMap<string, boolean>) {
  const values: Record<string, string | boolean | null> = {};
  for (const [name, takesValue] of allowed) values[name] = takesValue ? null : false;
  const seen = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const name = tokens[index]!;
    if (!allowed.has(name) || seen.has(name)) return null;
    seen.add(name);
    if (allowed.get(name)) {
      const value = tokens[++index];
      if (!value || value.startsWith("--")) return null;
      values[name] = value;
    } else values[name] = true;
  }
  return Object.freeze(values);
}

/** Pure dispatch; the same-issue CLI composition owns process snapshots and one stdout write. */
export function createCommandDispatcher(
  registrations: unknown,
  loadConfiguration: LoadConfiguration,
) {
  const registry = admitRegistry(registrations);
  return async (argvInput: unknown, contextInput: unknown): Promise<PreparedCommandEmission> => {
    let command = "";
    try {
      const argv = snapshotClosedArray(argvInput);
      if (!argv.ok || argv.value.some((token) => typeof token !== "string"))
        return prepareArgvRefusal();
      const tokens = argv.value as readonly string[];
      let offset = 0;
      while (globalFlags.has(tokens[offset] ?? ""))
        offset += globalFlags.get(tokens[offset]!) ? 2 : 1;
      const globals = parseOptions(tokens.slice(0, offset), globalFlags);
      if (!globals || (globals["--output"] !== null && globals["--output"] !== "json"))
        return prepareArgvRefusal();
      const commandTokens = tokens.slice(offset, offset + 2);
      const selected = commandTokens.join(" ");
      const shape = commandShapes.get(selected);
      if (!shape) return prepareArgvRefusal();
      const expectedTokens = shape.argv as readonly string[];
      if (
        commandTokens.length !== expectedTokens.length ||
        commandTokens.some((token, index) => token !== expectedTokens[index])
      )
        return prepareArgvRefusal();
      command = selected;
      const required = shape.required as readonly string[];
      const optional = shape.optional as readonly { name: string; takesValue: boolean }[];
      const options = parseOptions(
        tokens.slice(offset + 2),
        new Map([
          ...required.map((name) => [name, true] as const),
          ...optional.map(({ name, takesValue }) => [name, takesValue] as const),
        ]),
      );
      if (!options || required.some((name) => options[name] === null))
        return refusal(command, "ARGV_REFUSED");
      const context = ownData(contextInput, ["cwd", "environment", "operatingSystem"]);
      if (
        !context ||
        typeof context.cwd !== "string" ||
        (context.operatingSystem !== "WINDOWS" &&
          context.operatingSystem !== "MACOS" &&
          context.operatingSystem !== "LINUX")
      )
        return refusal(command, "ARGV_REFUSED");
      const environment = ownData(context.environment, environmentFields);
      if (
        !environment ||
        environmentFields.some(
          (name) =>
            environment[name] !== null &&
            (typeof environment[name] !== "string" || environment[name] === ""),
        )
      )
        return refusal(command, "CONFIG_REFUSED");
      const invocation = Object.freeze({
        cwd: context.cwd,
        operatingSystem: context.operatingSystem,
        environment: Object.freeze(environment),
        flags: Object.freeze({
          configPath: globals["--config"],
          projectRoot: globals["--project-root"],
          stateRoot: globals["--state-root"],
        }),
      }) as ConfigurationLoaderInvocation;
      const loaded = await loadConfiguration(invocation);
      if (!loaded.ok) return prepareCommandResult(command, loaded);
      const registration = registry?.get(command);
      if (!registration) return refusal(command, "INTERNAL_ERROR");
      if (registration.handler === null)
        return preparePlaceholderResult(command, registration.issue);
      const pending: unknown = registration.handler(
        Object.freeze({ command, configuration: loaded.value, options }),
      );
      if (!nodeTypes.isPromise(pending) || Object.getPrototypeOf(pending) !== Promise.prototype)
        return refusal(command, "INTERNAL_ERROR");
      return prepareCommandResult(command, await pending);
    } catch {
      return command === "" ? prepareArgvRefusal() : refusal(command, "INTERNAL_ERROR");
    }
  };
}
