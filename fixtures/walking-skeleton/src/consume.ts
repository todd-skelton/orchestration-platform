import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseCanonicalContractBytes,
  parseContract,
  serializeContract,
} from "@orchestration-platform/contracts";
import {
  createConfigurationLoader,
  type ConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import { projectConfigurationProvenance } from "../../../packages/config/src/resolver.js";
import { descriptor, plan } from "./index.js";

// Invoked only by the quarantined fixture. No process globals or package-export changes.
export async function consume(
  adapter: ConfigurationHostAdapter,
  invocation: ConfigurationLoaderInvocation,
  action: unknown,
) {
  const loaded = await createConfigurationLoader(adapter)(invocation);
  if (!loaded.ok) return loaded;
  const retainedAction = parseContract(descriptor.inputSchema, action);
  if (!retainedAction.ok) return retainedAction;
  const planned = await plan(retainedAction.value);
  if (!planned.ok) return planned;
  const provenance = projectConfigurationProvenance(loaded.value);
  if (!provenance.ok) return provenance;
  const records = [
    ["configuration.json", "configuration-provenance/v1", provenance.value],
    ["action.json", descriptor.inputSchema, retainedAction.value],
    ["brief.json", descriptor.outputSchema, planned.value],
  ] as const;
  const output = records.map(([name, schema, value]) => {
    const encoded = serializeContract(schema, value);
    if (!encoded.ok) throw new Error("fixture serialization refused");
    const decoded = parseCanonicalContractBytes(schema, encoded.bytes);
    if (!decoded.ok) throw new Error("fixture round-trip refused");
    return { name, bytes: encoded.bytes };
  });
  // mkdir without recursive/force also refuses reuse; this is not a lease protocol.
  await mkdir(loaded.value.stateRoot);
  for (const { name, bytes } of output) {
    await writeFile(join(loaded.value.stateRoot, name), bytes, { flag: "wx" });
  }
  return { ok: true as const, files: output.map(({ name }) => name) };
}
