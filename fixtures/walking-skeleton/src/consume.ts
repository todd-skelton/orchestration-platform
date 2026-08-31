import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseCanonicalContractBytes,
  parseCycleRequest,
  parseModulePlanInput,
  serializeContract,
  validateAdapterConfigurationBinding,
  validateProjectBreakerFactsBinding,
  validateProjectFactsBinding,
  validateModulePlanBinding,
} from "@orchestration-platform/contracts";
import type { CurrentPolicyReader } from "../../../packages/adapter-sdk/src/current-policy.js";
import type { SnapshotClocks, SnapshotReader } from "../../../packages/adapter-sdk/src/snapshot.js";
import {
  createConfigurationLoader,
  type ConfigurationHostAdapter,
  type ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import { projectConfigurationProvenance } from "../../../packages/config/src/resolver.js";
import { descriptor, plan } from "./index.js";

// Matches the two statically composed SDK fixture policies, never input JSON.
const currentPolicyVersion = "1.0.0";

// Invoked only by the quarantined fixture. No process globals or package-export changes.
export async function prepareModuleInput(
  adapter: ConfigurationHostAdapter,
  invocation: ConfigurationLoaderInvocation,
  adapterConfiguration: unknown,
  snapshot: SnapshotReader,
  currentPolicy: CurrentPolicyReader,
  clocks: SnapshotClocks,
  cycleRequest: unknown,
) {
  const request = parseCycleRequest(cycleRequest);
  if (!request.ok) return request;
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
  const policyObserved = await currentPolicy(
    configuration.value,
    provenance.value,
    facts.value,
    clocks,
  );
  if (!policyObserved.ok) return policyObserved;
  const breakerFacts = validateProjectBreakerFactsBinding(
    policyObserved.facts,
    configuration.value,
    facts.value,
    currentPolicyVersion,
  );
  if (!breakerFacts.ok) return breakerFacts;
  if (breakerFacts.value.state !== "COMPLETE")
    return {
      ok: false as const,
      issues: [`fixture:current-policy:${breakerFacts.value.state}:${breakerFacts.value.reason}`],
    };
  // Retain the exact public input across the call. Both trip arms remain observations only.
  const retainedInput = parseModulePlanInput({
    adapterConfiguration: configuration.value,
    configurationProvenance: provenance.value,
    cycleRequest: request.value,
    descriptor,
    policyFacts: breakerFacts.value,
    projectFacts: facts.value,
    reviewSubject: null,
    schemaVersion: "module-plan-input/v1",
  });
  if (!retainedInput.ok) return retainedInput;
  return { ok: true as const, input: retainedInput.value, stateRoot: loaded.value.stateRoot };
}

export async function prepareObservation(...args: Parameters<typeof prepareModuleInput>) {
  const prepared = await prepareModuleInput(...args);
  if (!prepared.ok) return prepared;
  const retainedInput = { value: prepared.input };
  const provenance = { value: prepared.input.configurationProvenance };
  const configuration = { value: prepared.input.adapterConfiguration };
  const facts = { value: prepared.input.projectFacts };
  const breakerFacts = { value: prepared.input.policyFacts };
  const request = { value: prepared.input.cycleRequest };
  let planned: unknown;
  try {
    planned = await plan(retainedInput.value);
  } catch {
    return { ok: false as const, issues: ["fixture:planning-failed"] };
  }
  // Recheck even this fixed fixture function's returned binding across an await.
  const result = validateModulePlanBinding(retainedInput.value, planned);
  if (!result.ok) return result;
  const records = [
    ["configuration.json", "configuration-provenance/v1", provenance.value],
    ["adapter-configuration.json", "adapter-configuration/v1", configuration.value],
    ["project-facts.json", "project-facts/v1", facts.value],
    ["project-breaker-facts.json", "project-breaker-facts/v1", breakerFacts.value],
    ["cycle-request.json", "cycle-request/v1", request.value],
    ["module-descriptor.json", "module-descriptor/v1", descriptor],
    ["module-input.json", "module-plan-input/v1", retainedInput.value],
    ["module-result.json", "module-plan-result/v1", result.value],
    ...(result.value.schemaVersion === "module-action-plan/v1"
      ? ([
          ["action.json", "dispatch-action-core/v1", result.value.actionCore],
          ["brief.json", "dispatch-brief/v1", result.value.dispatchBrief],
        ] as const)
      : []),
  ] as const;
  const output = records.map(([name, schema, value]) => {
    const encoded = serializeContract(schema, value);
    if (!encoded.ok) throw new Error("fixture serialization refused");
    const decoded = parseCanonicalContractBytes(schema, encoded.bytes);
    if (!decoded.ok) throw new Error("fixture round-trip refused");
    return { name, bytes: encoded.bytes };
  });
  return { ok: true as const, output, stateRoot: prepared.stateRoot };
}

// The original standalone observer continues to require an absent output directory.
export async function consume(...input: Parameters<typeof prepareObservation>) {
  const prepared = await prepareObservation(...input);
  if (!prepared.ok) return prepared;
  // mkdir without recursive/force also refuses reuse; this is not a lease protocol.
  await mkdir(prepared.stateRoot);
  for (const { name, bytes } of prepared.output) {
    await writeFile(join(prepared.stateRoot, name), bytes, { flag: "wx" });
  }
  return { ok: true as const, files: prepared.output.map(({ name }) => name) };
}
