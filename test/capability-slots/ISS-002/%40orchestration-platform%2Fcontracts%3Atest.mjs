import { runContractsTests } from "../../contracts/run-tests.mjs";

await runContractsTests("all", process.argv.slice(2));
