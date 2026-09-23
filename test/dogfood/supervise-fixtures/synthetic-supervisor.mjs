// ISS-164 TEST-ONLY trigger. Copied beside the copied supervise.mjs, this entry
// replaces the supervisor in a disposable runtime and requests once through
// the actual createNativeDbAdmission stream. Production main never requests.
import { writeFile } from "node:fs/promises";
import { createNativeDbAdmission, nativeDbProfileAdapter } from "./supervise.mjs";

const control = JSON.parse(process.env.SYNTHETIC_CONTROL);
const status = (row) => process.stdout.write(`${JSON.stringify(row)}\n`);
const admission = createNativeDbAdmission(control.run, process.stdin, process.stdout, {
  approvedParents: control.approvedParents,
});
status({ status: "observing-author", cursor: 0 });
if (control.workerJson) process.stdout.write(`${JSON.stringify(control.workerJson)}\n`);
const results = [];
if (control.mode === "hold") {
  await new Promise((done) => process.stdin.once("end", done));
  results.push({ status: "unknown", diagnostic: "native-db-channel-closed" });
} else if (control.mode === "after-close") {
  admission.close();
  results.push(await admission.request(control.body));
} else if (control.mode === "composed") {
  // ISS-165: the same request through the composed optional adapter method.
  // External execution is a stub; the spread and stream wiring are the real ones.
  const unused = async () => {
    throw new Error("synthetic native adapter performs no external execution");
  };
  const composed = nativeDbProfileAdapter(
    { git: unused, preflight: unused, launch: unused, observe: unused, checks: unused },
    admission,
  );
  results.push(await composed.nativeDbProfile(control.body));
  results.push({ methods: Object.keys(composed) });
} else if (control.mode === "concurrent") {
  results.push(
    ...(await Promise.all([admission.request(control.body), admission.request(control.body)])),
  );
} else {
  results.push(await admission.request(control.body));
  if (control.mode === "twice") results.push(await admission.request(control.body));
}
await writeFile(control.results, `${JSON.stringify(results, null, 2)}\n`);
status({ status: "idle", run: control.run });
admission.close();
