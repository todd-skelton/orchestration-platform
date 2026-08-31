import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalDigest,
  parseCanonicalContractBytes,
  parseContract,
  serializeContract,
  validateAdapterConfigurationBinding,
  validateProjectFactsBinding,
} from "@orchestration-platform/contracts";
import type { SnapshotClocks, SnapshotReader } from "../../../packages/adapter-sdk/src/snapshot.js";
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
  adapterConfiguration: unknown,
  snapshot: SnapshotReader,
  clocks: SnapshotClocks,
) {
  const loaded = await createConfigurationLoader(adapter)(invocation);
  if (!loaded.ok) return loaded;
  const provenance = projectConfigurationProvenance(loaded.value);
  if (!provenance.ok) return provenance;
  const configuration = validateAdapterConfigurationBinding(adapterConfiguration, provenance.value);
  if (!configuration.ok) return configuration;
  const observed = await snapshot(configuration.value, provenance.value, clocks);
  if (!observed.ok) return observed;
  const facts = validateProjectFactsBinding(observed.facts, configuration.value);
  if (!facts.ok) return facts;
  if (facts.value.state !== "COMPLETE")
    return { ok: false as const, issues: [`fixture:snapshot:${facts.value.state}`] };
  // Fixture policy only: choose the first eligible row in the validated, work-ID-sorted frontier.
  const selected = facts.value.frontier.find(
    (row) => row.readiness === "READY" && row.capabilityNames.includes(descriptor.capabilityName),
  );
  if (!selected) return { ok: false as const, issues: ["fixture:no-eligible-work"] };
  const retainedAction = parseContract(descriptor.inputSchema, {
    actionKind: descriptor.actionKind,
    capabilityName: selected.capabilityNames.find((name) => name === descriptor.capabilityName),
    immutableSubjectDigest: selected.immutableSubjectDigest,
    moduleDescriptorDigest: canonicalDigest(descriptor),
    requestedRole: "observer",
    schemaVersion: descriptor.inputSchema,
  });
  if (!retainedAction.ok) return retainedAction;
  const planned = await plan(retainedAction.value);
  if (!planned.ok) return planned;
  const records = [
    ["configuration.json", "configuration-provenance/v1", provenance.value],
    ["adapter-configuration.json", "adapter-configuration/v1", configuration.value],
    ["project-facts.json", "project-facts/v1", facts.value],
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
