import { runFirstConsumerScaffoldCheck } from "../../adapter-first-consumer/scaffold-check.mjs";

await runFirstConsumerScaffoldCheck();
process.stdout.write("first-consumer package scaffold verified\n");
