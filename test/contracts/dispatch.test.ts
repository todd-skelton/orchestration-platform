import { describe, expect, test } from "vitest";
import {
  computeDispatchActionCoreDigest,
  computeWorkerHostIdentityDigest,
  dispatchDirectiveKinds,
  engineVocabularyValueFindings,
  parseContract,
  parseDispatchActionCore,
  parseDispatchBrief,
  parseWorkerHostIdentity,
  parseWorkerHostRendererArtifact,
  parseWorkerHostRendererArtifacts,
  selectWorkerHostForCapability,
  validateDispatchBriefBinding,
  validateDispatchCatalog,
} from "../../packages/contracts/src/index.js";

const d = (value: string): string => value.repeat(64);

const actionCore = Object.freeze({
  actionKind: "repair.plan",
  capabilityName: "workspace.modify",
  immutableSubjectDigest: d("1"),
  moduleDescriptorDigest: d("2"),
  requestedRole: "implementation",
  schemaVersion: "dispatch-action-core/v1",
});

const action = Object.freeze({
  actionCoreDigest: computeDispatchActionCoreDigest(actionCore),
  actionKind: actionCore.actionKind,
  capabilityName: actionCore.capabilityName,
  immutableSubjectDigest: actionCore.immutableSubjectDigest,
  moduleDescriptorDigest: actionCore.moduleDescriptorDigest,
  schemaVersion: "dispatch-brief-action/v1",
});

const presentKinds = dispatchDirectiveKinds.filter((kind) => kind !== "OPERATOR_ACTION");
const directives = Object.freeze([
  ...presentKinds.map((directiveKind) =>
    Object.freeze({
      code: directiveKind.toLowerCase(),
      directiveKind,
      presence: "PRESENT",
      schemaVersion: "dispatch-brief-directive/v1",
      subjectDigest: actionCore.immutableSubjectDigest,
    }),
  ),
  Object.freeze({
    code: null,
    directiveKind: "OPERATOR_ACTION",
    presence: "ABSENT",
    schemaVersion: "dispatch-brief-directive/v1",
    subjectDigest: actionCore.immutableSubjectDigest,
  }),
]);

const brief = Object.freeze({
  action,
  directives,
  footprint: Object.freeze([
    Object.freeze({
      access: "MODIFY",
      resourceIdentityDigest: d("3"),
      schemaVersion: "dispatch-brief-resource/v1",
    }),
  ]),
  role: actionCore.requestedRole,
  schemaVersion: "dispatch-brief/v1",
});

const catalog = Object.freeze(
  presentKinds.map((directiveKind) =>
    Object.freeze({
      actionKind: actionCore.actionKind,
      capabilityName: actionCore.capabilityName,
      code: directiveKind.toLowerCase(),
      directiveKind,
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: `template.${directiveKind.toLowerCase()}`,
    }),
  ),
);
const declaredPairs = Object.freeze([
  Object.freeze({ actionKind: actionCore.actionKind, capabilityName: actionCore.capabilityName }),
]);

function hostIdentity(capabilityNames: readonly string[] = ["workspace.modify"]) {
  return {
    capabilityNames,
    hostRendererArtifactDigest: d("a"),
    schemaVersion: "worker-host-identity/v1",
  };
}

function hostRow(capabilityNames: readonly string[] = ["workspace.modify"]) {
  const identity = hostIdentity(capabilityNames);
  return {
    capabilityNames,
    hostRendererArtifactDigest: identity.hostRendererArtifactDigest,
    schemaVersion: "worker-host-renderer-artifact/v1",
    workerHostIdentityDigest: computeWorkerHostIdentityDigest(identity),
  };
}

describe("dispatch action and brief contracts", () => {
  test("pins the exact action-core schema and digest framing", () => {
    expect(parseDispatchActionCore(actionCore).ok).toBe(true);
    expect(computeDispatchActionCoreDigest(actionCore)).toBe(
      "0a143702ba0f936c1743928e766b2b5c8d039c2302fbd3bfa301a9175cb7c9df",
    );
    for (const mutation of [
      { ...actionCore, schemaVersion: "dispatch-action-core/v2" },
      { ...actionCore, requestedRole: "IMPLEMENTATION" },
      { ...actionCore, capabilityName: "branch" },
      { ...actionCore, extra: true },
    ])
      expect(parseDispatchActionCore(mutation).ok).toBe(false);
  });

  test("parses one envelope plus exactly three nested record kinds", () => {
    expect(parseDispatchBrief(brief).ok).toBe(true);
    expect(parseContract("dispatch-brief/v1", brief).ok).toBe(true);
    expect(
      parseDispatchBrief({
        ...brief,
        action: { ...brief.action, schemaVersion: "dispatch-brief-action/v2" },
      }).ok,
    ).toBe(false);
    expect(
      parseDispatchBrief({
        ...brief,
        directives: [
          { ...brief.directives[0]!, schemaVersion: "dispatch-brief-directive/v2" },
          ...brief.directives.slice(1),
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseDispatchBrief({
        ...brief,
        footprint: [{ ...brief.footprint[0]!, schemaVersion: "dispatch-brief-resource/v2" }],
      }).ok,
    ).toBe(false);
    expect(parseDispatchBrief({ ...brief, resourceKind: "branch" }).ok).toBe(false);
  });

  test("enforces every directive kind and the operator-action XOR", () => {
    for (const kind of presentKinds) {
      const mutation = {
        ...brief,
        directives: directives.filter((row) => row.directiveKind !== kind),
      };
      expect(parseDispatchBrief(mutation).ok).toBe(false);
    }
    expect(
      parseDispatchBrief({
        ...brief,
        directives: directives.filter((row) => row.directiveKind !== "OPERATOR_ACTION"),
      }).ok,
    ).toBe(false);
    const presentOperator = {
      code: "operator.required",
      directiveKind: "OPERATOR_ACTION",
      presence: "PRESENT",
      schemaVersion: "dispatch-brief-directive/v1",
      subjectDigest: actionCore.immutableSubjectDigest,
    };
    expect(parseDispatchBrief({ ...brief, directives: [...directives, presentOperator] }).ok).toBe(
      false,
    );
    expect(
      parseDispatchBrief({
        ...brief,
        directives: [
          ...directives.filter((row) => row.directiveKind !== "OPERATOR_ACTION"),
          presentOperator,
        ],
      }).ok,
    ).toBe(true);
    expect(parseDispatchBrief({ ...brief, directives: [...directives, directives[0]!] }).ok).toBe(
      false,
    );
  });

  test("binds action, role, subject, catalog resolver, and descriptor pair census", () => {
    expect(validateDispatchCatalog(catalog, declaredPairs)).toEqual([]);
    expect(validateDispatchBriefBinding(brief, actionCore, catalog, declaredPairs)).toEqual([]);
    expect(validateDispatchCatalog(catalog, [])).toContain("declaredPairs:mismatch");
    expect(
      validateDispatchBriefBinding(
        { ...brief, role: "review" },
        actionCore,
        catalog,
        declaredPairs,
      ),
    ).toContain("binding:role");
    expect(
      validateDispatchBriefBinding(
        { ...brief, action: { ...action, actionCoreDigest: d("f") } },
        actionCore,
        catalog,
        declaredPairs,
      ),
    ).toContain("binding:actionCoreDigest");
  });

  test("censuses catalog resolver keys and declared action-capability pairs at the direct seam", () => {
    expect(validateDispatchCatalog(catalog, declaredPairs)).toEqual([]);

    for (const sameResolverKey of [
      { ...catalog[0]!, planAccessor: "MODULE_DESCRIPTOR_DIGEST" },
      { ...catalog[0]!, templateId: "template.changed" },
      {
        ...catalog[0]!,
        planAccessor: "MODULE_DESCRIPTOR_DIGEST",
        templateId: "template.changed",
      },
    ])
      expect(validateDispatchCatalog([sameResolverKey, ...catalog], declaredPairs)).toEqual([
        "catalog:resolver-key:duplicate",
      ]);

    expect(
      validateDispatchCatalog(
        [...catalog, { ...catalog[0]!, code: "directive.alternate" }],
        declaredPairs,
      ),
    ).toEqual([]);

    expect(validateDispatchCatalog(catalog, [...declaredPairs, declaredPairs[0]!])).toEqual([
      "declaredPairs:duplicate",
    ]);

    const addedPair = Object.freeze({
      actionKind: "review.inspect",
      capabilityName: "workspace.read",
    });
    expect(validateDispatchCatalog(catalog, [...declaredPairs, addedPair])).toEqual([
      "declaredPairs:mismatch",
    ]);
    expect(
      validateDispatchCatalog([...catalog, { ...catalog[0]!, ...addedPair }], declaredPairs),
    ).toEqual(["declaredPairs:mismatch"]);
  });

  test("is total for hostile brief and catalog inputs", () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    expect(() => parseDispatchBrief(proxy)).not.toThrow();
    expect(parseDispatchBrief(proxy).ok).toBe(false);
    expect(() => validateDispatchCatalog(proxy, proxy)).not.toThrow();
    expect(validateDispatchCatalog(proxy, proxy).length).toBeGreaterThan(0);
  });
});

describe("worker-host identity and mapping contracts", () => {
  test("pins the provider-neutral host identity framing", () => {
    const identity = hostIdentity();
    expect(parseWorkerHostIdentity(identity).ok).toBe(true);
    expect(computeWorkerHostIdentityDigest(identity)).toBe(
      "89564cdd358ccb9a1358343c18e73809514004fb22a69bcee39e91aa1f59a4a5",
    );
    expect(parseWorkerHostIdentity({ ...identity, capabilityNames: [] }).ok).toBe(false);
    expect(
      parseWorkerHostIdentity({
        ...identity,
        capabilityNames: ["workspace.modify", "workspace.modify"],
      }).ok,
    ).toBe(false);
    expect(
      parseWorkerHostIdentity({ ...identity, capabilityNames: ["workspace.modify", "branch"] }).ok,
    ).toBe(false);
    const maximum = Array.from(
      { length: 256 },
      (_, index) => `capability.${String(index).padStart(3, "0")}`,
    );
    expect(parseWorkerHostIdentity(hostIdentity(maximum)).ok).toBe(true);
    expect(parseWorkerHostIdentity(hostIdentity([...maximum, "capability.zzz"])).ok).toBe(false);
  });

  test("admits only a total unique mapping with recomputed identities", () => {
    const row = hostRow();
    expect(parseWorkerHostRendererArtifact(row).ok).toBe(true);
    expect(parseWorkerHostRendererArtifacts([row]).ok).toBe(true);
    expect(parseWorkerHostRendererArtifacts([]).ok).toBe(false);
    expect(parseWorkerHostRendererArtifacts(Array.from({ length: 17 }, () => row)).ok).toBe(false);
    expect(parseWorkerHostRendererArtifacts([row, row]).ok).toBe(false);
    expect(
      parseWorkerHostRendererArtifacts([{ ...row, workerHostIdentityDigest: d("b") }]).ok,
    ).toBe(false);
    expect(parseWorkerHostRendererArtifacts([row, { unreadable: true }]).ok).toBe(false);
  });

  test("selects one exact route identity with case-sensitive capability membership", () => {
    const row = hostRow();
    expect(
      selectWorkerHostForCapability([row], row.workerHostIdentityDigest, "workspace.modify").ok,
    ).toBe(true);
    expect(
      selectWorkerHostForCapability([row], row.workerHostIdentityDigest, "workspace.read").ok,
    ).toBe(false);
    expect(
      selectWorkerHostForCapability([row], row.workerHostIdentityDigest, "Workspace.modify").ok,
    ).toBe(false);
    expect(selectWorkerHostForCapability([row], d("c"), "workspace.modify").ok).toBe(false);
  });

  test("checks admitted runtime lookup values against adapter vocabulary", () => {
    expect(engineVocabularyValueFindings(["workspace.modify"])).toEqual([]);
    expect(engineVocabularyValueFindings(["branch"]).join("\n")).toMatch(/adapter:branch/);
  });
});
