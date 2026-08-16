export const bootstrapCommandRegistry = Object.freeze([
  Object.freeze({
    schemaVersion: "orchestration-command-handler-registration/v1",
    family: "bootstrap",
    owner: "orchestration-bootstrap",
    issue: "ISS-020",
    implementation: "placeholder",
    commands: Object.freeze([
      { argv: ["candidate"], required: ["--source", "--output"], optional: [] },
      { argv: ["certify"], required: ["--candidate", "--output"], optional: [] },
      { argv: ["broker-plan"], required: ["--request", "--output"], optional: [] },
      { argv: ["broker-install"], required: ["--plan", "--output"], optional: [] },
      { argv: ["broker-verify"], required: ["--receipt"], optional: [] },
      { argv: ["broker-remove"], required: ["--receipt", "--output"], optional: [] },
      { argv: ["bind-credentials"], required: ["--request", "--output"], optional: [] },
      {
        argv: ["authorize"],
        required: ["--candidate", "--certification", "--review", "--grant", "--output"],
        optional: [],
      },
      { argv: ["install"], required: ["--input", "--output"], optional: [] },
      { argv: ["abort"], required: ["--input", "--output"], optional: [] },
      { argv: ["recover"], required: ["--transaction", "--output"], optional: [] },
      { argv: ["verify"], required: ["--receipt"], optional: [] },
    ]),
  }),
]);
