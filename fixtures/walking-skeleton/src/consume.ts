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
  type AdapterConfiguration,
  type ContractRecord,
  type CycleRequest,
  type ModuleDescriptor,
  type ProjectBreakerFacts,
  type ProjectFacts,
  type ReviewSubject,
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
import { descriptor as reviewDescriptor } from "./review-module.js";

// Matches the two statically composed SDK fixture policies, never input JSON.
const currentPolicyVersion = "1.0.0";

export type FixtureConfiguration = Readonly<{
  configuration: AdapterConfiguration;
  cycleRequest: CycleRequest;
  provenance: ContractRecord;
  stateRoot: string;
}>;

/** Staged fixture-only configuration admission used by the complete cycle. */
export async function loadFixtureConfiguration(
  adapter: ConfigurationHostAdapter,
  invocation: ConfigurationLoaderInvocation,
  adapterConfiguration: unknown,
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
  return {
    ok: true as const,
    value: {
      configuration: configuration.value,
      cycleRequest: request.value,
      provenance: provenance.value,
      stateRoot: loaded.value.stateRoot,
    },
  };
}

/** One actual step-2 observation; UNKNOWN/UNAVAILABLE stays typed for the caller. */
export async function observeFixtureSnapshot(
  context: FixtureConfiguration,
  snapshot: SnapshotReader,
  clocks: SnapshotClocks,
) {
  const observed = await snapshot(context.configuration, context.provenance, clocks);
  if (!observed.ok) return observed;
  return validateProjectFactsBinding(observed.facts, context.configuration);
}

/** One actual step-3 policy observation over the retained complete snapshot. */
export async function observeFixturePolicy(
  context: FixtureConfiguration,
  facts: ProjectFacts,
  currentPolicy: CurrentPolicyReader,
  clocks: SnapshotClocks,
) {
  if (facts.state !== "COMPLETE")
    return { ok: false as const, issues: [`fixture:snapshot:${facts.state}`] };
  const observed = await currentPolicy(context.configuration, context.provenance, facts, clocks);
  if (!observed.ok) return observed;
  const breakerFacts = validateProjectBreakerFactsBinding(
    observed.facts,
    context.configuration,
    facts,
    currentPolicyVersion,
  );
  if (!breakerFacts.ok) return breakerFacts;
  return breakerFacts.value.state === "COMPLETE"
    ? breakerFacts
    : {
        ok: false as const,
        issues: [`fixture:current-policy:${breakerFacts.value.state}:${breakerFacts.value.reason}`],
      };
}

/** Pure construction after the distinct step-2/3 observations have been admitted. */
export function composeFixtureModuleInput(
  descriptor: ModuleDescriptor,
  reviewSubject: ReviewSubject | null,
  context: FixtureConfiguration,
  projectFacts: ProjectFacts,
  policyFacts: ProjectBreakerFacts,
) {
  return parseModulePlanInput({
    adapterConfiguration: context.configuration,
    configurationProvenance: context.provenance,
    cycleRequest: context.cycleRequest,
    descriptor,
    policyFacts,
    projectFacts,
    reviewSubject,
    schemaVersion: "module-plan-input/v1",
  });
}

// Invoked only by the quarantined fixture. No process globals or package-export changes.
async function prepareInput(
  selectedDescriptor: ModuleDescriptor,
  reviewSubject: ReviewSubject | null,
  adapter: ConfigurationHostAdapter,
  invocation: ConfigurationLoaderInvocation,
  adapterConfiguration: unknown,
  snapshot: SnapshotReader,
  currentPolicy: CurrentPolicyReader,
  clocks: SnapshotClocks,
  cycleRequest: unknown,
) {
  const context = await loadFixtureConfiguration(
    adapter,
    invocation,
    adapterConfiguration,
    cycleRequest,
  );
  if (!context.ok) return context;
  const facts = await observeFixtureSnapshot(context.value, snapshot, clocks);
  if (!facts.ok) return facts;
  if (facts.value.state !== "COMPLETE")
    return { ok: false as const, issues: [`fixture:snapshot:${facts.value.state}`] };
  const breakerFacts = await observeFixturePolicy(
    context.value,
    facts.value,
    currentPolicy,
    clocks,
  );
  if (!breakerFacts.ok) return breakerFacts;
  // Retain the exact public input across the call. Both trip arms remain observations only.
  const retainedInput = composeFixtureModuleInput(
    selectedDescriptor,
    reviewSubject,
    context.value,
    facts.value,
    breakerFacts.value,
  );
  if (!retainedInput.ok) return retainedInput;
  return { ok: true as const, input: retainedInput.value, stateRoot: context.value.stateRoot };
}

type PreparationArgs = [
  adapter: ConfigurationHostAdapter,
  invocation: ConfigurationLoaderInvocation,
  adapterConfiguration: unknown,
  snapshot: SnapshotReader,
  currentPolicy: CurrentPolicyReader,
  clocks: SnapshotClocks,
  cycleRequest: unknown,
];

export async function prepareModuleInput(...args: PreparationArgs) {
  return prepareInput(descriptor, null, ...args);
}

// Statically composed second fixture module; no caller-selectable descriptor or module resolver.
export async function prepareReviewModuleInput(subject: ReviewSubject, ...args: PreparationArgs) {
  return prepareInput(reviewDescriptor, subject, ...args);
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
