export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "journal",
  owner: "@orchestration-platform/journal",
  issue: "ISS-010",
  implementation: "placeholder",
  commands: [
    {
      argv: ["journal", "append"],
      required: ["--event"],
      optional: [],
    },
    {
      argv: ["journal", "reduce"],
      required: ["--journal"],
      optional: [],
    },
    {
      argv: ["journal", "snapshot"],
      required: ["--journal", "--output"],
      optional: [],
    },
  ],
});
