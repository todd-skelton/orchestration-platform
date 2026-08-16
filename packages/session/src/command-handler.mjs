export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "session",
  owner: "@orchestration-platform/session",
  issue: "ISS-007",
  implementation: "placeholder",
  commands: [
    {
      argv: ["session", "acquire"],
      required: ["--request"],
      optional: [],
    },
    {
      argv: ["session", "renew"],
      required: ["--session"],
      optional: [],
    },
    {
      argv: ["session", "inspect"],
      required: [],
      optional: [
        {
          name: "--session",
          takesValue: true,
        },
      ],
    },
    {
      argv: ["session", "release"],
      required: ["--session"],
      optional: [],
    },
    {
      argv: ["session", "handoff"],
      required: ["--predecessor", "--successor"],
      optional: [],
    },
  ],
});
