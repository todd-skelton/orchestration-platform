export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "supervisor",
  owner: "@orchestration-platform/supervisor",
  issue: "ISS-030",
  implementation: "placeholder",
  commands: [
    {
      argv: ["supervisor", "plan"],
      required: ["--request"],
      optional: [],
    },
    {
      argv: ["supervisor", "install"],
      required: ["--plan", "--plan-id"],
      optional: [],
    },
    {
      argv: ["supervisor", "tick"],
      required: ["--installation"],
      optional: [],
    },
    {
      argv: ["supervisor", "inspect"],
      required: ["--installation"],
      optional: [],
    },
    {
      argv: ["supervisor", "uninstall"],
      required: ["--installation"],
      optional: [],
    },
  ],
});
