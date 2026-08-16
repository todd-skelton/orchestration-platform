export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "worker",
  owner: "@orchestration-platform/dispatch",
  issue: "ISS-008",
  implementation: "placeholder",
  commands: [
    {
      argv: ["worker", "dispatch"],
      required: ["--plan"],
      optional: [],
    },
    {
      argv: ["worker", "inspect"],
      required: ["--launch"],
      optional: [],
    },
    {
      argv: ["worker", "terminate"],
      required: ["--launch"],
      optional: [],
    },
  ],
});
