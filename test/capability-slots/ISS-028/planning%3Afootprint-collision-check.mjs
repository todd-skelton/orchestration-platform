import { runFirstConsumerFootprintCollisionCheck } from "../../adapter-first-consumer/scaffold-check.mjs";

await runFirstConsumerFootprintCollisionCheck();
process.stdout.write("first-consumer extension footprints verified disjoint\n");
