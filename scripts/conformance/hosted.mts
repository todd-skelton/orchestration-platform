const modes = new Set(["aggregate", "observation", "plan-finalize", "plan-select", "record"]);

const mode = process.argv[2];
if (process.argv.length !== 3 || !mode || !modes.has(mode)) {
  throw new Error("HOSTED_CONFORMANCE_MODE_REFUSED");
}

try {
  if (mode === "plan-select" || mode === "plan-finalize") {
    const plan = await import("./hosted-plan.mjs");
    if (mode === "plan-select") await plan.runHostedPlanSelect();
    else await plan.runHostedPlanFinalize();
  } else if (mode === "observation") {
    const observation = await import("./hosted-observation.mjs");
    await observation.runHostedObservation();
  } else if (mode === "aggregate") {
    const aggregate = await import("./hosted-aggregate.mjs");
    await aggregate.runHostedAggregate();
  } else if (mode === "record") {
    const record = await import("./hosted-record.mjs");
    await record.runHostedRecord();
  } else {
    throw new Error(`HOSTED_CONFORMANCE_PENDING:${mode}`);
  }
} catch (error) {
  if (error instanceof Error && error.message === `HOSTED_CONFORMANCE_PENDING:${mode}`) throw error;
  throw new Error(`HOSTED_CONFORMANCE_REFUSED:${mode}`);
}
