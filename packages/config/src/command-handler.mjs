export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "config",
  owner: "@orchestration-platform/config",
  issue: "ISS-003",
  implementation: "placeholder",
  commands: [
    {
      argv: ["config", "validate"],
      required: [],
      optional: [],
    },
    {
      argv: ["config", "paths"],
      required: [],
      optional: [
        {
          name: "--reveal",
          takesValue: false,
        },
      ],
    },
  ],
});
