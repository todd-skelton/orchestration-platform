export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "cycle",
  owner: "@orchestration-platform/engine",
  issue: "ISS-026",
  implementation: "placeholder",
  commands: [
    {
      argv: ["cycle", "plan"],
      required: ["--request"],
      optional: [],
    },
    {
      argv: ["cycle", "run"],
      required: ["--plan", "--plan-id"],
      optional: [],
    },
    {
      argv: ["cycle", "resume"],
      required: ["--cycle"],
      optional: [],
    },
    {
      argv: ["cycle", "inspect"],
      required: ["--cycle"],
      optional: [],
    },
  ],
});
