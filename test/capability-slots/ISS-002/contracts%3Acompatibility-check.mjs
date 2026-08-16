import { runContractsTests } from "../../contracts/run-tests.mjs";

await runContractsTests("compatibility", process.argv.slice(2));
