const modes = new Set(["aggregate", "observation", "plan-finalize", "plan-select", "record"]);

const mode = process.argv[2];
if (process.argv.length !== 3 || !mode || !modes.has(mode)) {
  throw new Error("HOSTED_CONFORMANCE_MODE_REFUSED");
}

throw new Error(`HOSTED_CONFORMANCE_PENDING:${mode}`);
