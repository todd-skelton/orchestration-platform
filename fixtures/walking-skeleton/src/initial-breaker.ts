import {
  canonicalDigest,
  computeCycleRequestDigest,
  validateBreakerReceiptBinding,
  type ModulePlanInput,
} from "@orchestration-platform/contracts";

// Pure construction only. Callers must first consume the actual lease's one-shot fresh-root gate.
export function initialBreaker(input: ModulePlanInput) {
  const cycleRequestDigest = computeCycleRequestDigest(input.cycleRequest);
  const policyFactsDigest = canonicalDigest(input.policyFacts);
  if (input.policyFacts.state !== "COMPLETE") throw new Error("fixture policy not complete");
  return validateBreakerReceiptBinding(
    input.configurationProvenance,
    input.adapterConfiguration,
    input.cycleRequest,
    input.projectFacts,
    input.policyFacts,
    null,
    {
      adapterConfigurationDigest: canonicalDigest(input.adapterConfiguration),
      cycleId: input.cycleRequest.cycleId,
      cycleRequestDigest,
      operations: [],
      policyFactsDigest,
      policyIdentity: {
        adapterId: input.adapterConfiguration.adapterId,
        adapterVersion: input.adapterConfiguration.adapterVersion,
        policyVersion: input.policyFacts.policyVersion,
      },
      priorReceiptDigest: null,
      result: {
        kind: "KNOWN",
        capabilities: input.policyFacts.decisions.map((decision) =>
          decision.trip === "TRIP"
            ? {
                capabilityName: decision.capabilityName,
                opening: { cycleRequestDigest, policyFactsDigest },
                state: "OPEN",
              }
            : { capabilityName: decision.capabilityName, state: "CLOSED" },
        ),
      },
      schemaVersion: "breaker-receipt/v1",
      sessionId: input.cycleRequest.sessionRequest.sessionId,
    },
  );
}
