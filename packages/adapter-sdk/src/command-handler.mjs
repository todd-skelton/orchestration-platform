export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "project",
  owner: "@orchestration-platform/adapter-sdk",
  issue: "ISS-013",
  implementation: "implemented",
  handler: async (input) => {
    const { projectSnapshotCommandHandler } = await import("./project-command.ts");
    return projectSnapshotCommandHandler(input);
  },
  commands: [
    {
      argv: ["project", "snapshot"],
      resultSchema: "project-facts/v1",
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
