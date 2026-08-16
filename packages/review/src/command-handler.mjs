export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "review",
  owner: "@orchestration-platform/review",
  issue: "ISS-009",
  implementation: "placeholder",
  commands: [
    {
      argv: ["review", "reduce"],
      required: ["--subject", "--journal"],
      optional: [],
    },
  ],
});
