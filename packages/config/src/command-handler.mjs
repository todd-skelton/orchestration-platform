export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "config",
  owner: "@orchestration-platform/config",
  issue: "ISS-003",
  implementation: "implemented",
  handler: async (input) => {
    const { configCommandHandler } = await import("./config-command.ts");
    return configCommandHandler(input);
  },
  commands: [
    {
      argv: ["config", "validate"],
      required: [],
      optional: [],
      resultSchema: "configuration-provenance/v1",
    },
    {
      argv: ["config", "paths"],
      required: [],
      optional: [],
      resultSchema: "configuration-paths/v1",
    },
  ],
});
