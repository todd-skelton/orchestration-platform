export const commandHandlerRegistration = Object.freeze({
  schemaVersion: "orchestration-command-handler-registration/v1",
  family: "release",
  owner: "@orchestration-platform/release",
  issue: "ISS-014",
  implementation: "placeholder",
  commands: [
    {
      argv: ["release", "assemble"],
      required: ["--source-revision", "--output"],
      optional: [],
    },
    {
      argv: ["release", "certify"],
      required: ["--candidate", "--output"],
      optional: [],
    },
    {
      argv: ["release", "promote"],
      required: ["--input"],
      optional: [],
    },
    {
      argv: ["release", "recover"],
      required: ["--input"],
      optional: [],
    },
  ],
});
