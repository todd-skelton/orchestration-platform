export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "project",
  owner: "@orchestration-platform/adapter-sdk",
  issue: "ISS-013",
  implementation: "placeholder",
  commands: [
    {
      argv: ["project", "snapshot"],
      required: ["--adapter"],
      optional: [],
    },
    {
      argv: ["project", "plan"],
      required: ["--request"],
      optional: [],
    },
    {
      argv: ["project", "apply"],
      required: ["--plan", "--plan-id"],
      optional: [],
    },
  ],
});
