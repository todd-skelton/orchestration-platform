export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "credential",
  owner: "@orchestration-platform/credentials",
  issue: "ISS-032",
  implementation: "placeholder",
  commands: [
    {
      argv: ["credential", "bind"],
      required: ["--request"],
      optional: [],
    },
    {
      argv: ["credential", "inspect"],
      required: ["--credential"],
      optional: [],
    },
    {
      argv: ["credential", "revoke"],
      required: ["--credential"],
      optional: [],
    },
  ],
});
