import {
  runFirstConsumerPackageBoundaryCheck,
  runFirstConsumerScaffoldCheck,
} from "../../adapter-first-consumer/scaffold-check.mjs";

await runFirstConsumerScaffoldCheck();
await runFirstConsumerPackageBoundaryCheck();
process.stdout.write("first-consumer package scaffold verified\n");
