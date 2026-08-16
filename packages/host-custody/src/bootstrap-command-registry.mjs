export const hostCustodyBootstrapCommandRegistry = Object.freeze([
  Object.freeze({
    schemaVersion: "orchestration-command-handler-registration/v1",
    family: "host-custody-bootstrap",
    owner: "@orchestration-platform/host-custody",
    issue: "ISS-038",
    implementation: "placeholder",
    commands: Object.freeze([
      { argv: ["service-plan"], required: ["--request", "--output"], optional: [] },
      {
        argv: ["service-install"],
        required: ["--plan", "--plan-id", "--output"],
        optional: [],
      },
      { argv: ["service-verify"], required: ["--receipt", "--output"], optional: [] },
      { argv: ["enroll"], required: ["--request", "--output"], optional: [] },
      { argv: ["challenge"], required: ["--request", "--output"], optional: [] },
      { argv: ["verify-reentry"], required: ["--request", "--output"], optional: [] },
      { argv: ["teardown"], required: ["--request", "--output"], optional: [] },
    ]),
  }),
]);
