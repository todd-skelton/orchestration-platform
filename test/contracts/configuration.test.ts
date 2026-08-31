import { describe, expect, test } from "vitest";
import {
  compatibilityDisposition,
  computeConfigurationPathToken,
  configurationSchemaFields,
  frame,
  framedDigest,
  orchestrationCommandCensus,
  parseCanonicalContractBytes,
  parseConfigurationPaths,
  parseConfigurationProvenance,
  parseContract,
  parseOrchestrationCommandResult,
  parsePlatformConfigurationSource,
  schemaVersions,
  schemaVocabularyDefinitions,
  serializeContract,
} from "../../packages/contracts/src/index.js";
import { commandHandlerRegistration as configRegistration } from "../../packages/config/src/command-handler.mjs";
import { commandHandlerRegistration as sessionRegistration } from "../../packages/session/src/command-handler.mjs";
import { commandHandlerRegistration as workerRegistration } from "../../packages/dispatch/src/command-handler.mjs";
import { commandHandlerRegistration as reviewRegistration } from "../../packages/review/src/command-handler.mjs";
import { commandHandlerRegistration as journalRegistration } from "../../packages/journal/src/command-handler.mjs";
import { commandHandlerRegistration as projectRegistration } from "../../packages/adapter-sdk/src/command-handler.mjs";
import { commandHandlerRegistration as releaseRegistration } from "../../packages/release/src/command-handler.mjs";
import { commandHandlerRegistration as cycleRegistration } from "../../packages/engine/src/command-handler.mjs";
import { commandHandlerRegistration as supervisorRegistration } from "../../packages/supervisor/src/command-handler.mjs";
import { commandHandlerRegistration as credentialRegistration } from "../../packages/credentials/src/command-handler.mjs";

const projectId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const token = (value: string) => `<redacted:path:${value.repeat(64)}>`;

function source() {
  return {
    adapterId: "fixture.adapter",
    capabilityNames: ["cap.read", "cap.write"],
    leaseFreshnessMs: 30_000,
    maximumSessionMs: 3_600_000,
    projectId,
    schemaVersion: "platform-configuration-source/v1",
    stateRoot: "file:///var/lib/orchestration-platform/fixture",
    wallClockSkewMs: 1_000,
  };
}

function provenance() {
  return {
    adapterId: "fixture.adapter",
    capabilityNames: ["cap.read", "cap.write"],
    fieldSources: {
      adapterId: "PROJECT",
      capabilityNames: "PROJECT",
      leaseFreshnessMs: "PROJECT",
      maximumSessionMs: "PROJECT",
      projectId: "PROJECT",
      stateRoot: "ENVIRONMENT",
      wallClockSkewMs: "PROJECT",
    },
    leaseFreshnessMs: 30_000,
    maximumSessionMs: 3_600_000,
    projectId,
    projectRoot: token("a"),
    schemaVersion: "configuration-provenance/v1",
    stateRoot: token("b"),
    wallClockSkewMs: 1_000,
  };
}

function paths() {
  return {
    configPath: token("c"),
    projectRoot: token("a"),
    schemaVersion: "configuration-paths/v1",
    stateRoot: token("b"),
  };
}

function success(command: "config paths" | "config validate") {
  return {
    command,
    diagnostics: [],
    outcome: "success",
    result: command === "config paths" ? paths() : provenance(),
    schemaVersion: "orchestration-command-result/v1",
  };
}

function accessor<T extends object>(input: T, name: keyof T): T {
  const copy = { ...input };
  const value = input[name];
  Object.defineProperty(copy, name, { enumerable: true, get: () => value });
  return copy;
}

describe("ISS-003 public configuration contracts", () => {
  test("registers exactly the four readable v1 families and refuses future or unknown versions", () => {
    const versions = [
      "platform-configuration-source/v1",
      "configuration-provenance/v1",
      "configuration-paths/v1",
      "orchestration-command-result/v1",
    ];
    for (const version of versions) {
      expect(schemaVersions).toContain(version);
      expect(compatibilityDisposition(version, version)).toBe("readable");
      expect(compatibilityDisposition(version, version.replace("/v1", "/v999"))).toBe("refused");
      expect(compatibilityDisposition(version, null)).toBe("refused");
    }
    expect(compatibilityDisposition("configuration-private/v1", "configuration-private/v1")).toBe(
      "refused",
    );
    expect(
      parseContract("platform-configuration-source/v1", {
        ...source(),
        schemaVersion: "platform-configuration-source/v999",
      }).ok,
    ).toBe(false);
    for (const [version, value] of [
      ["configuration-provenance/v1", provenance()],
      ["configuration-paths/v1", paths()],
      ["orchestration-command-result/v1", success("config paths")],
    ] as const)
      expect(
        parseContract(version, { ...value, schemaVersion: version.replace("/v1", "/v999") }).ok,
        version,
      ).toBe(false);
    expect(parseContract("configuration-private/v1", {}).ok).toBe(false);
  });

  test("closes the source record and reuses the platform configuration scalar bounds", () => {
    const value = source();
    const parsed = parsePlatformConfigurationSource(value);
    expect(parsed.ok).toBe(true);
    expect(parseContract("platform-configuration-source/v1", value).ok).toBe(true);
    expect(configurationSchemaFields.source).toEqual(Object.keys(value).sort());
    for (const name of Object.keys(value)) {
      const mutant = { ...value } as Record<string, unknown>;
      delete mutant[name];
      expect(parsePlatformConfigurationSource(mutant).ok, `missing:${name}`).toBe(false);
    }
    expect(parsePlatformConfigurationSource({ ...value, extra: true }).ok).toBe(false);
    expect(parsePlatformConfigurationSource(new Proxy(value, {})).ok).toBe(false);
    expect(parsePlatformConfigurationSource(accessor(value, "adapterId")).ok).toBe(false);
    expect(parsePlatformConfigurationSource({ ...value, adapterId: "Adapter" }).ok).toBe(false);
    expect(parsePlatformConfigurationSource({ ...value, capabilityNames: [""] }).ok).toBe(false);
    expect(
      parsePlatformConfigurationSource({ ...value, capabilityNames: ["cap.read", "cap.read"] }).ok,
    ).toBe(false);
    expect(
      parsePlatformConfigurationSource({ ...value, capabilityNames: ["cap.write", "cap.read"] }).ok,
    ).toBe(false);
    expect(parsePlatformConfigurationSource({ ...value, leaseFreshnessMs: 0 }).ok).toBe(false);
    expect(
      parsePlatformConfigurationSource({
        ...value,
        leaseFreshnessMs: 30_001,
        maximumSessionMs: 30_000,
      }).ok,
    ).toBe(false);
    expect(parsePlatformConfigurationSource({ ...value, maximumSessionMs: 86_400_001 }).ok).toBe(
      false,
    );
    expect(parsePlatformConfigurationSource({ ...value, wallClockSkewMs: 300_001 }).ok).toBe(false);
    expect(parsePlatformConfigurationSource({ ...value, stateRoot: null }).ok).toBe(true);
    for (const stateRoot of [
      "relative/path",
      "file://server/share",
      "file:///var/lib/path with space",
      "file:///var/lib/path?query=1",
      "file:///var/lib/path#fragment",
    ])
      expect(parsePlatformConfigurationSource({ ...value, stateRoot }).ok, stateRoot).toBe(false);
  });

  test("closes provenance, its seven field sources, and both redacted roots", () => {
    const value = provenance();
    const parsed = parseConfigurationProvenance(value);
    expect(parsed.ok).toBe(true);
    expect(parseContract("configuration-provenance/v1", value).ok).toBe(true);
    expect(configurationSchemaFields.provenance).toEqual(Object.keys(value).sort());
    for (const name of Object.keys(value)) {
      const mutant = { ...value } as Record<string, unknown>;
      delete mutant[name];
      expect(parseConfigurationProvenance(mutant).ok, `missing:${name}`).toBe(false);
    }
    expect(parseConfigurationProvenance({ ...value, extra: null }).ok).toBe(false);
    expect(parseConfigurationProvenance(new Proxy(value, {})).ok).toBe(false);
    expect(parseConfigurationProvenance(accessor(value, "fieldSources")).ok).toBe(false);
    expect(parseConfigurationProvenance({ ...value, projectRoot: "file:///secret" }).ok).toBe(
      false,
    );
    expect(parseConfigurationProvenance({ ...value, stateRoot: token("A") }).ok).toBe(false);
    expect(
      parseConfigurationProvenance({
        ...value,
        fieldSources: { ...value.fieldSources, projectId: "FILESYSTEM" },
      }).ok,
    ).toBe(false);
    const missingSource = { ...value.fieldSources } as Record<string, unknown>;
    delete missingSource.projectId;
    expect(parseConfigurationProvenance({ ...value, fieldSources: missingSource }).ok).toBe(false);
    expect(
      parseConfigurationProvenance({
        ...value,
        fieldSources: { ...value.fieldSources, extra: "PROJECT" },
      }).ok,
    ).toBe(false);
    expect(
      parseConfigurationProvenance({ ...value, fieldSources: new Proxy(value.fieldSources, {}) })
        .ok,
    ).toBe(false);
    for (const name of [
      "adapterId",
      "capabilityNames",
      "leaseFreshnessMs",
      "maximumSessionMs",
      "projectId",
      "wallClockSkewMs",
    ] as const)
      for (const sourceValue of ["CLI", "ENVIRONMENT", "DEFAULT"] as const)
        expect(
          parseConfigurationProvenance({
            ...value,
            fieldSources: { ...value.fieldSources, [name]: sourceValue },
          }).ok,
          `${name}:${sourceValue}`,
        ).toBe(false);
    for (const stateRoot of ["CLI", "ENVIRONMENT", "PROJECT", "DEFAULT"] as const)
      expect(
        parseConfigurationProvenance({
          ...value,
          fieldSources: { ...value.fieldSources, stateRoot },
        }).ok,
        `stateRoot:${stateRoot}`,
      ).toBe(true);
  });

  test("closes the three-token path result", () => {
    const value = paths();
    expect(parseConfigurationPaths(value).ok).toBe(true);
    expect(parseContract("configuration-paths/v1", value).ok).toBe(true);
    expect(configurationSchemaFields.paths).toEqual(Object.keys(value).sort());
    for (const name of Object.keys(value)) {
      const mutant = { ...value } as Record<string, unknown>;
      delete mutant[name];
      expect(parseConfigurationPaths(mutant).ok, `missing:${name}`).toBe(false);
    }
    for (const name of ["configPath", "projectRoot", "stateRoot"] as const)
      expect(parseConfigurationPaths({ ...value, [name]: `/unredacted/${name}` }).ok).toBe(false);
    expect(parseConfigurationPaths({ ...value, extra: token("d") }).ok).toBe(false);
    expect(parseConfigurationPaths(new Proxy(value, {})).ok).toBe(false);
    expect(parseConfigurationPaths(accessor(value, "configPath")).ok).toBe(false);
  });

  test("derives path tokens from one fixed framed canonical-file-URL part", () => {
    const value = "file:///var/lib/orchestration-platform/fixture";
    const fixedBytes = Buffer.from(value, "utf8").toString("hex");
    expect(computeConfigurationPathToken(value)).toBe(
      `<redacted:path:${framedDigest("configuration-path/v1", [frame.fixed(fixedBytes)])}>`,
    );
    expect(computeConfigurationPathToken(value)).not.toBe(
      `<redacted:path:${framedDigest("configuration-path/v1", [frame.text(value)])}>`,
    );
    expect(computeConfigurationPathToken(value)).not.toBe(
      `<redacted:path:${framedDigest("other-path/v1", [frame.fixed(fixedBytes)])}>`,
    );
    expect(() => computeConfigurationPathToken("C:\\secret\\state")).toThrow();
    expect(() => computeConfigurationPathToken("file:///path with space")).toThrow();
  });

  test("binds each success command to its one public result schema", () => {
    for (const command of ["config validate", "config paths"] as const) {
      const value = success(command);
      const parsed = parseOrchestrationCommandResult(value);
      expect(parsed.ok, command).toBe(true);
      expect(parseContract("orchestration-command-result/v1", value).ok).toBe(true);
      if (parsed.ok) {
        expect(Object.isFrozen(parsed.value)).toBe(true);
        expect(Object.isFrozen(parsed.value.result)).toBe(true);
        expect(Object.isFrozen(parsed.value.diagnostics)).toBe(true);
      }
    }
    for (const name of Object.keys(success("config validate"))) {
      const mutant = { ...success("config validate") } as Record<string, unknown>;
      delete mutant[name];
      expect(parseOrchestrationCommandResult(mutant).ok, `missing:${name}`).toBe(false);
    }
    expect(parseOrchestrationCommandResult({ ...success("config validate"), extra: null }).ok).toBe(
      false,
    );
    expect(
      parseOrchestrationCommandResult({ ...success("config paths"), result: provenance() }).ok,
    ).toBe(false);
    expect(
      parseOrchestrationCommandResult({ ...success("config validate"), command: "session acquire" })
        .ok,
    ).toBe(false);
    expect(
      parseOrchestrationCommandResult({ ...success("config validate"), diagnostics: [{}] }).ok,
    ).toBe(false);
    expect(parseOrchestrationCommandResult(new Proxy(success("config validate"), {})).ok).toBe(
      false,
    );
    expect(parseOrchestrationCommandResult(accessor(success("config validate"), "result")).ok).toBe(
      false,
    );
  });

  test("accepts only the exact failure diagnostic rows", () => {
    const rows = [
      ["", "invalid-input", "ARGV_REFUSED", "command line refused"],
      ["config validate", "invalid-input", "CONFIG_REFUSED", "configuration refused"],
      ["config validate", "authority-refused", "PROJECT_ROOT_REFUSED", "project root refused"],
      ["config paths", "authority-refused", "PATH_REFUSED", "path refused"],
      [
        "config paths",
        "operation-failed",
        "FILESYSTEM_OPERATION_FAILED",
        "filesystem operation failed",
      ],
      ["config validate", "internal-error", "INTERNAL_ERROR", "internal error"],
    ] as const;
    for (const [command, outcome, code, message] of rows) {
      const value = {
        command,
        diagnostics: [{ code, message }],
        outcome,
        result: null,
        schemaVersion: "orchestration-command-result/v1",
      };
      expect(parseOrchestrationCommandResult(value).ok, code).toBe(true);
      expect(
        parseOrchestrationCommandResult({
          ...value,
          diagnostics: [{ code, message: `${message}!` }],
        }).ok,
      ).toBe(false);
      expect(parseOrchestrationCommandResult({ ...value, outcome: "operation-failed" }).ok).toBe(
        outcome === "operation-failed",
      );
    }
    const placeholder = {
      command: "project snapshot",
      diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: "ISS-013" }],
      outcome: "operation-failed",
      result: null,
      schemaVersion: "orchestration-command-result/v1",
    };
    expect(parseOrchestrationCommandResult(placeholder).ok).toBe(true);
    expect(
      parseOrchestrationCommandResult({
        ...placeholder,
        diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: "project" }],
      }).ok,
    ).toBe(false);
    expect(
      parseOrchestrationCommandResult({ ...placeholder, diagnostics: new Proxy([], {}) }).ok,
    ).toBe(false);
    expect(
      parseOrchestrationCommandResult({
        ...placeholder,
        diagnostics: [accessor({ code: "CAPABILITY_NOT_IMPLEMENTED", owner: "ISS-013" }, "owner")],
      }).ok,
    ).toBe(false);
    expect(parseOrchestrationCommandResult({ ...placeholder, result: {} }).ok).toBe(false);
    expect(parseOrchestrationCommandResult({ ...placeholder, command: "" }).ok).toBe(false);
    expect(
      parseOrchestrationCommandResult({
        ...placeholder,
        command: "config validate",
        diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: "ISS-003" }],
      }).ok,
    ).toBe(false);
    expect(
      parseOrchestrationCommandResult({
        ...placeholder,
        diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: "ISS-999" }],
      }).ok,
    ).toBe(false);
    for (const command of ["git push", "unknown command"])
      expect(parseOrchestrationCommandResult({ ...placeholder, command }).ok, command).toBe(false);
    expect(
      parseOrchestrationCommandResult({
        command: "config validate",
        diagnostics: [
          { code: "CONFIG_REFUSED", message: "configuration refused", owner: "ISS-003" },
        ],
        outcome: "invalid-input",
        result: null,
        schemaVersion: "orchestration-command-result/v1",
      }).ok,
    ).toBe(false);
  });

  test("uses one exact command and placeholder-owner census", () => {
    const registrations = [
      configRegistration,
      sessionRegistration,
      workerRegistration,
      reviewRegistration,
      journalRegistration,
      projectRegistration,
      releaseRegistration,
      cycleRegistration,
      supervisorRegistration,
      credentialRegistration,
    ];
    const observed = registrations.flatMap((registration) =>
      registration.commands.map((command) => ({
        command: command.argv.join(" "),
        placeholderOwner:
          registration.family === "config" || command.argv.join(" ") === "project snapshot"
            ? null
            : registration.issue,
      })),
    );
    expect(orchestrationCommandCensus).toEqual(observed);
    const definition = schemaVocabularyDefinitions["orchestration-command-result/v1"]!;
    expect(definition.closedValues).toEqual(
      expect.arrayContaining([
        "authority-unknown",
        "external-unavailable",
        "ADAPTER_CONFIGURATION_REFUSED",
        "ADAPTER_BINDING_REFUSED",
        "ADAPTER_COMPATIBILITY_REFUSED",
        "PROJECT_SNAPSHOT_UNAVAILABLE",
        "PROJECT_SNAPSHOT_UNKNOWN",
      ]),
    );
    const censusCommands = orchestrationCommandCensus.map(({ command }) => command);
    expect(definition.closedValues?.filter((value) => value.includes(" "))).toEqual(censusCommands);
    for (const row of orchestrationCommandCensus) {
      if (row.placeholderOwner === null) continue;
      expect(
        parseOrchestrationCommandResult({
          command: row.command,
          diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: row.placeholderOwner }],
          outcome: "operation-failed",
          result: null,
          schemaVersion: "orchestration-command-result/v1",
        }).ok,
        row.command,
      ).toBe(true);
    }
    const vocabularyOnlyMutant = {
      ...definition,
      closedValues: [...(definition.closedValues ?? []), "git push"],
    };
    expect(vocabularyOnlyMutant.closedValues).toContain("git push");
    expect(
      parseOrchestrationCommandResult({
        command: "git push",
        diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: "ISS-999" }],
        outcome: "operation-failed",
        result: null,
        schemaVersion: "orchestration-command-result/v1",
      }).ok,
    ).toBe(false);
  });

  test("pins canonical bytes for all four v1 records", () => {
    const fixtures = [
      [
        "platform-configuration-source/v1",
        source(),
        `{"adapterId":"fixture.adapter","capabilityNames":["cap.read","cap.write"],"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"${projectId}","schemaVersion":"platform-configuration-source/v1","stateRoot":"file:///var/lib/orchestration-platform/fixture","wallClockSkewMs":1000}\n`,
      ],
      [
        "configuration-provenance/v1",
        provenance(),
        `{"adapterId":"fixture.adapter","capabilityNames":["cap.read","cap.write"],"fieldSources":{"adapterId":"PROJECT","capabilityNames":"PROJECT","leaseFreshnessMs":"PROJECT","maximumSessionMs":"PROJECT","projectId":"PROJECT","stateRoot":"ENVIRONMENT","wallClockSkewMs":"PROJECT"},"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"${projectId}","projectRoot":"${token("a")}","schemaVersion":"configuration-provenance/v1","stateRoot":"${token("b")}","wallClockSkewMs":1000}\n`,
      ],
      [
        "configuration-paths/v1",
        paths(),
        `{"configPath":"${token("c")}","projectRoot":"${token("a")}","schemaVersion":"configuration-paths/v1","stateRoot":"${token("b")}"}\n`,
      ],
      [
        "orchestration-command-result/v1",
        success("config paths"),
        `{"command":"config paths","diagnostics":[],"outcome":"success","result":{"configPath":"${token("c")}","projectRoot":"${token("a")}","schemaVersion":"configuration-paths/v1","stateRoot":"${token("b")}"},"schemaVersion":"orchestration-command-result/v1"}\n`,
      ],
      [
        "orchestration-command-result/v1",
        {
          command: "project plan",
          diagnostics: [{ code: "CAPABILITY_NOT_IMPLEMENTED", owner: "ISS-013" }],
          outcome: "operation-failed",
          result: null,
          schemaVersion: "orchestration-command-result/v1",
        },
        `{"command":"project plan","diagnostics":[{"code":"CAPABILITY_NOT_IMPLEMENTED","owner":"ISS-013"}],"outcome":"operation-failed","result":null,"schemaVersion":"orchestration-command-result/v1"}\n`,
      ],
    ] as const;
    for (const [version, value, golden] of fixtures) {
      const serialized = serializeContract(version, value);
      expect(serialized.ok, version).toBe(true);
      if (!serialized.ok) continue;
      expect(new TextDecoder().decode(serialized.bytes)).toBe(golden);
      expect(parseCanonicalContractBytes(version, serialized.bytes).ok).toBe(true);
      expect(
        parseCanonicalContractBytes(version, new TextEncoder().encode(golden.trimEnd())).ok,
      ).toBe(false);
      expect(
        parseCanonicalContractBytes(
          version,
          new Uint8Array([0xef, 0xbb, 0xbf, ...serialized.bytes]),
        ).ok,
      ).toBe(false);
    }
  });
});
