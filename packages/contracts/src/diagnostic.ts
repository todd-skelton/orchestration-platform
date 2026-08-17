import {
  cleanupGateArchivePath,
  cleanupGateCurrentPath,
  cleanupGateHeadPath,
  cleanupGateRootPath,
  cleanupHeadCurrentPath,
  recoveryAuthorizationPath,
  recoveryFenceCurrentPath,
  recoveryFenceHeadPath,
  recoveryFenceRootPath,
  recoveryLaunchCurrentPath,
  recoveryLaunchPath,
  reduceInitializationCensus,
  validateCleanupAuthorityBinding,
  validateCleanupHeadTransition,
  validateFenceAuthorityBinding,
  validateFenceHeadTransition,
  validateRecoveryAuthorityAlignment,
  validateRecoveryAuthorizationAttachment,
  validateRecoveryLaunchTransition,
} from "./definitions.js";
import { diagnosticSchemaDefinitions, diagnosticSchemaVersions } from "./registry.js";
import { validateAgainstSchema, type ParseResult } from "./runtime.js";

function parseContract(expectedSchemaVersion: string, input: unknown): ParseResult {
  const definition = diagnosticSchemaDefinitions[expectedSchemaVersion];
  if (!definition) return { ok: false, issues: ["schemaVersion:not-diagnostic"] };
  try {
    return validateAgainstSchema(definition, input);
  } catch {
    return { ok: false, issues: ["record:unreadable"] };
  }
}

export const diagnostic = Object.freeze({
  parseContract,
  schemaDefinitions: diagnosticSchemaDefinitions,
  schemaVersions: diagnosticSchemaVersions,
  paths: Object.freeze({
    cleanupGateArchivePath,
    cleanupGateCurrentPath,
    cleanupGateHeadPath,
    cleanupGateRootPath,
    cleanupHeadCurrentPath,
    recoveryAuthorizationPath,
    recoveryFenceCurrentPath,
    recoveryFenceHeadPath,
    recoveryFenceRootPath,
    recoveryLaunchCurrentPath,
    recoveryLaunchPath,
  }),
  validators: Object.freeze({
    reduceInitializationCensus,
    validateCleanupAuthorityBinding,
    validateCleanupHeadTransition,
    validateFenceAuthorityBinding,
    validateFenceHeadTransition,
    validateRecoveryAuthorityAlignment,
    validateRecoveryAuthorizationAttachment,
    validateRecoveryLaunchTransition,
  }),
});
