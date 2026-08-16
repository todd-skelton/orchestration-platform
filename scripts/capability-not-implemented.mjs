const [issue, capability, ...forwardedArguments] = process.argv.slice(2);

if (!/^ISS-\d{3}$/.test(issue ?? "") || !capability) {
  process.stderr.write("invalid CAPABILITY_NOT_IMPLEMENTED placeholder declaration\n");
  process.exit(70);
}

process.stderr.write(
  `${JSON.stringify({
    schemaVersion: "orchestration-capability-result/v1",
    outcome: "CAPABILITY_NOT_IMPLEMENTED",
    capability,
    owner: issue,
    forwardedArguments,
  })}\n`,
);
process.exit(5);
