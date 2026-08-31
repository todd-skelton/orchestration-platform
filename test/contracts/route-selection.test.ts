import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as c from "../../packages/contracts/src/index.js";
// Stdlib-generated literal bytes/frames/digests; no route implementation was an oracle.
const goldens = [
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hostMappingDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"SELECTED","workerHostIdentityDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"schemaVersion":"route-selection/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00726f7574652d73656c656374696f6e2f763100000000010700000000000001507b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22686f73744d617070696e67446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a2253454c4543544544222c22776f726b6572486f73744964656e74697479446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363227d2c22736368656d6156657273696f6e223a22726f7574652d73656c656374696f6e2f7631227d0a",
    digest: "79f4ebdf93de244c250d49e1259ec10878d742306576ff59e934e65f36b20098",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hostMappingDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"REFUSED","reason":"NO_SUPPORTED_HOST"},"schemaVersion":"route-selection/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00726f7574652d73656c656374696f6e2f7631000000000107000000000000010e7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22686f73744d617070696e67446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a2252454655534544222c22726561736f6e223a224e4f5f535550504f525445445f484f5354227d2c22736368656d6156657273696f6e223a22726f7574652d73656c656374696f6e2f7631227d0a",
    digest: "562e0d086e18532dcc04989f119391a8df5811b3092417b4e9c104b264a680b0",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hostMappingDigest":null,"outcome":{"kind":"UNKNOWN","reason":"MAPPING_UNAVAILABLE"},"schemaVersion":"route-selection/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00726f7574652d73656c656374696f6e2f763100000000010700000000000000d27b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22686f73744d617070696e67446967657374223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224d415050494e475f554e415641494c41424c45227d2c22736368656d6156657273696f6e223a22726f7574652d73656c656374696f6e2f7631227d0a",
    digest: "7b78f55173b8b4c16af154a18bff62a2d583463a0dc9889c5457f1755f992127",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hostMappingDigest":null,"outcome":{"kind":"UNKNOWN","reason":"MAPPING_INVALID"},"schemaVersion":"route-selection/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00726f7574652d73656c656374696f6e2f763100000000010700000000000000ce7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22686f73744d617070696e67446967657374223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a224d415050494e475f494e56414c4944227d2c22736368656d6156657273696f6e223a22726f7574652d73656c656374696f6e2f7631227d0a",
    digest: "1c00956ec89c0f8ad858af604548cd0a26e946cbc56c26ba1461e29e40363f46",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hostMappingDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","outcome":{"kind":"UNKNOWN","reason":"ADMISSION_UNPROVEN"},"schemaVersion":"route-selection/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00726f7574652d73656c656374696f6e2f7631000000000107000000000000010f7b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22686f73744d617070696e67446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c226f7574636f6d65223a7b226b696e64223a22554e4b4e4f574e222c22726561736f6e223a2241444d495353494f4e5f554e50524f56454e227d2c22736368656d6156657273696f6e223a22726f7574652d73656c656374696f6e2f7631227d0a",
    digest: "cea39d2136f3e4004137132c38bf6764f93f9aea15975185931291f9358bbb46",
  },
  {
    text: '{"actionPlanDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hostMappingDigest":null,"outcome":{"kind":"NO_WORKER"},"schemaVersion":"route-selection/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00726f7574652d73656c656374696f6e2f763100000000010700000000000000b57b22616374696f6e506c616e446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22686f73744d617070696e67446967657374223a6e756c6c2c226f7574636f6d65223a7b226b696e64223a224e4f5f574f524b4552227d2c22736368656d6156657273696f6e223a22726f7574652d73656c656374696f6e2f7631227d0a",
    digest: "3490db8b855121b038afd8196f6f65445e5609c84187510e8d9f729fa9723dc3",
  },
] as const;
// Reuses the independently pinned complete module input fixture.
const inputLiteral =
  '{"adapterConfiguration":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","capabilityNames":["work.read"],"engineVersion":"0.0.0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"adapter-configuration/v1"},"configurationProvenance":{"adapterId":"fixture.adapter","capabilityNames":["work.read"],"fieldSources":{"adapterId":"PROJECT","capabilityNames":"PROJECT","leaseFreshnessMs":"PROJECT","maximumSessionMs":"PROJECT","projectId":"PROJECT","stateRoot":"DEFAULT","wallClockSkewMs":"PROJECT"},"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"01900000-0000-7000-8000-000000000001","projectRoot":"<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>","schemaVersion":"configuration-provenance/v1","stateRoot":"<redacted:path:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc>","wallClockSkewMs":1000},"cycleRequest":{"adapterId":"fixture.adapter","allowedModuleIds":["fixture.module"],"cycleId":"01900000-0000-7000-8000-000000000003","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","configurationProvenanceDigest":"6cb88ecc36a83f0d147de82f0d55aa9c92ad9d39f743ab8698cf943fdaf99e81","configurationSourceDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000006"}},"descriptor":{"abi":"orchestration-module/v1","actions":[{"actionKind":"fixture.direct","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":false},{"actionKind":"fixture.inspect","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":true}],"compatibility":[{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","engineVersion":"0.0.0","policyVersion":"1.2.3"}],"dispatchCatalog":[{"actionKind":"fixture.inspect","capabilityName":"work.read","code":"verify","directiveKind":"VERIFICATION","planAccessor":"IMMUTABLE_SUBJECT_DIGEST","templateId":"template.verify"}],"dispositionCodes":[],"inputSchemas":["module-plan-input/v1"],"moduleId":"fixture.module","moduleVersion":"1.0.0","outputSchemas":["module-action-plan/v1","module-no-action/v1"],"schemaVersion":"module-descriptor/v1"},"policyFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","decisions":[{"capabilityName":"work.read","trip":"TRIP"}],"observationId":"01900000-0000-7000-8000-000000000005","observedAt":"2026-08-31T01:00:00.001Z","policyVersion":"1.2.3","projectFactsDigest":"850e033912e587726788238a4c80a9caea6fe605e7c951232bc84e0900f851e0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-breaker-facts/v1","state":"COMPLETE"},"projectFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","frontier":[{"capabilityNames":["work.read"],"immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","readiness":"READY","workId":"01900000-0000-7000-8000-000000000002"}],"frontierDigest":"e1fd114d0aa64349f2ff70dc4f4e8e3b15a6a16d0380524937ed4ba09ed483d2","observationId":"01900000-0000-7000-8000-000000000004","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-facts/v1","state":"COMPLETE"},"reviewSubject":null,"schemaVersion":"module-plan-input/v1"}\n';

const fresh = () => JSON.parse(inputLiteral);
const bytes = (text: string) => new TextEncoder().encode(text);
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const schema = "route-selection/v1";
function action(worker = true) {
  const input = fresh();
  input.descriptor.dispatchCatalog = c.dispatchDirectiveKinds
    .filter((kind) => kind !== "OPERATOR_ACTION")
    .map((directiveKind) => ({
      actionKind: "fixture.inspect",
      capabilityName: "work.read",
      code: directiveKind.toLowerCase(),
      directiveKind,
      planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
      templateId: `template.${directiveKind.toLowerCase()}`,
    }));
  const core = {
    actionKind: worker ? "fixture.inspect" : "fixture.direct",
    capabilityName: "work.read",
    immutableSubjectDigest: input.projectFacts.frontier[0].immutableSubjectDigest,
    moduleDescriptorDigest: c.computeModuleDescriptorDigest(input.descriptor),
    requestedRole: "observer",
    schemaVersion: "dispatch-action-core/v1",
  };
  const plan = {
    actionCore: core,
    dispatchBrief: worker
      ? {
          action: {
            actionCoreDigest: c.computeDispatchActionCoreDigest(core),
            actionKind: core.actionKind,
            capabilityName: core.capabilityName,
            immutableSubjectDigest: core.immutableSubjectDigest,
            moduleDescriptorDigest: core.moduleDescriptorDigest,
            schemaVersion: "dispatch-brief-action/v1",
          },
          directives: c.dispatchDirectiveKinds.map((directiveKind) => ({
            code: directiveKind === "OPERATOR_ACTION" ? null : directiveKind.toLowerCase(),
            directiveKind,
            presence: directiveKind === "OPERATOR_ACTION" ? "ABSENT" : "PRESENT",
            schemaVersion: "dispatch-brief-directive/v1",
            subjectDigest: core.immutableSubjectDigest,
          })),
          footprint: [
            {
              access: "READ",
              resourceIdentityDigest: core.immutableSubjectDigest,
              schemaVersion: "dispatch-brief-resource/v1",
            },
          ],
          role: "observer",
          schemaVersion: "dispatch-brief/v1",
        }
      : null,
    inputDigest: c.computeModulePlanInputDigest(input),
    schemaVersion: "module-action-plan/v1",
    workId: input.projectFacts.frontier[0].workId,
  };
  expect(c.validateModulePlanBinding(input, plan).ok).toBe(true);
  return { input, plan };
}
function host(n = 1, capabilityNames = ["work.read"]) {
  const identity = {
    capabilityNames,
    hostRendererArtifactDigest: n.toString(16).padStart(64, "0"),
    schemaVersion: "worker-host-identity/v1",
  };
  return {
    ...identity,
    schemaVersion: "worker-host-renderer-artifact/v1",
    workerHostIdentityDigest: c.computeWorkerHostIdentityDigest(identity),
  };
}
function route(
  plan: unknown,
  outcome: c.RouteSelection["outcome"],
  mapping: unknown = null,
): c.RouteSelection {
  return {
    actionPlanDigest: c.computeModuleActionPlanDigest(plan),
    hostMappingDigest: mapping === null ? null : c.computeRouteMappingDigest(mapping),
    outcome,
    schemaVersion: schema,
  };
}
function bound(a: ReturnType<typeof action>, mapping: unknown, record: unknown) {
  return c.validateRouteSelectionBinding(a.input, a.plan, mapping, record);
}

test("pins all six canonical route arms and full one-record framed identities", () => {
  for (const golden of goldens) {
    const value = JSON.parse(golden.text);
    expect(c.parseRouteSelection(value).ok).toBe(true);
    expect(c.parseContract(schema, value).ok).toBe(true);
    expect(c.parseCanonicalContractBytes(schema, bytes(golden.text)).ok).toBe(true);
    expect(c.canonicalJson(value)).toBe(golden.text);
    expect(Buffer.from(c.framedBytes(schema, [c.frame.canonical(value)])).toString("hex")).toBe(
      golden.frameHex,
    );
    expect(c.computeRouteSelectionDigest(value)).toBe(golden.digest);
    expect(c.serializeContract(schema, value)).toEqual({
      ok: true,
      bytes: bytes(golden.text),
      digest: golden.digest,
    });
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    expect(c.serializeContract(schema, reordered)).toEqual(c.serializeContract(schema, value));
    for (const text of [
      golden.text.trimEnd(),
      ` ${golden.text}`,
      golden.text.replace(/\n$/, "\r\n"),
      JSON.stringify(value, null, 2) + "\n",
      golden.text.replace('"actionPlanDigest":', '"extra":1,"actionPlanDigest":'),
    ])
      expect(c.parseCanonicalContractBytes(schema, bytes(text)).ok).toBe(false);
    for (const index of [0, 24, 44, 45, 46, golden.frameHex.length / 2 - 1]) {
      const wrong = Buffer.from(golden.frameHex, "hex");
      wrong[index] = wrong[index]! ^ 1;
      expect(hash(wrong)).not.toBe(golden.digest);
    }
    expect(c.computeRouteSelectionDigest(value)).not.toBe(c.canonicalDigest(value));
  }
  expect(c.schemaVersions).toContain(schema);
  expect(c.parseRouteSelectionContract("route-selection/v2", {})).toBeNull();
  expect(c.parseContract("route-selection/v2", JSON.parse(goldens[0].text)).ok).toBe(false);
});

test("each arm is closed and only its specified mapping null cell is valid", () => {
  for (const golden of goldens) {
    const original = JSON.parse(golden.text);
    for (const location of ["outer", "outcome"] as const) {
      const keys = Object.keys(location === "outer" ? original : original.outcome);
      for (const key of keys) {
        for (const mutation of ["delete", "rename", "type"] as const) {
          const value = structuredClone(original),
            target = location === "outer" ? value : value.outcome;
          if (mutation === "delete") delete target[key];
          else if (mutation === "rename") {
            target[`other_${key}`] = target[key];
            delete target[key];
          } else target[key] = 17;
          expect(c.parseRouteSelection(value).ok, `${location}.${key}:${mutation}`).toBe(false);
        }
      }
      const extra = structuredClone(original);
      (location === "outer" ? extra : extra.outcome).extra = true;
      expect(c.parseRouteSelection(extra).ok).toBe(false);
    }
    const changedNull = {
      ...original,
      hostMappingDigest: original.hostMappingDigest === null ? "e".repeat(64) : null,
    };
    expect(c.parseRouteSelection(changedNull).ok).toBe(false);
    for (const bad of [null, "a".repeat(63), "a".repeat(65), "A".repeat(64), "a".repeat(64) + "\n"])
      expect(c.parseRouteSelection({ ...original, actionPlanDigest: bad }).ok).toBe(false);
    for (const outcome of [
      { kind: "FUTURE" },
      { kind: "REFUSED", reason: "MAPPING_INVALID" },
      { kind: "UNKNOWN", reason: "NO_SUPPORTED_HOST" },
      { kind: "NO_WORKER", reason: null },
      { kind: "SELECTED", workerHostIdentityDigest: null },
    ])
      expect(c.parseRouteSelection({ ...original, outcome }).ok).toBe(false);
  }
});

test("selects any supported row while committing to the entire ordered mapping", () => {
  const a = action(),
    mapping = [host(1, ["work.write"]), host(2)];
  const chosen = {
    kind: "SELECTED",
    workerHostIdentityDigest: mapping[1]!.workerHostIdentityDigest,
  } as const;
  const r = route(a.plan, chosen, mapping);
  expect(bound(a, mapping, r).ok).toBe(true);
  expect(c.computeRouteMappingDigest(mapping)).toBe(c.canonicalDigest(mapping));
  expect(bound(a, [...mapping].reverse(), r).ok).toBe(false);
  expect(bound(a, [mapping[1]], r).ok).toBe(false);
  expect(bound(a, mapping, { ...r, hostMappingDigest: c.canonicalDigest(mapping[1]!) }).ok).toBe(
    false,
  );
  expect(
    bound(
      a,
      mapping,
      route(
        a.plan,
        { ...chosen, workerHostIdentityDigest: mapping[0]!.workerHostIdentityDigest },
        mapping,
      ),
    ).ok,
  ).toBe(false);
  expect(
    bound(
      a,
      mapping,
      route(a.plan, { ...chosen, workerHostIdentityDigest: "f".repeat(64) }, mapping),
    ).ok,
  ).toBe(false);
  const reversed = [...mapping].reverse();
  expect(bound(a, reversed, route(a.plan, chosen, reversed)).ok).toBe(true);
  const single = [mapping[1]!];
  // Coherently supplied smaller data is not proof that the installed census is complete.
  expect(bound(a, single, route(a.plan, chosen, single)).ok).toBe(true);
});

test("keeps unsupported, unavailable, invalid and admission-unproven mapping claims distinct", () => {
  const a = action(),
    supported = [host()],
    unsupported = [host(2, ["work.write"])];
  const noHost = { kind: "REFUSED", reason: "NO_SUPPORTED_HOST" } as const;
  expect(bound(a, unsupported, route(a.plan, noHost, unsupported)).ok).toBe(true);
  expect(bound(a, supported, route(a.plan, noHost, supported)).ok).toBe(false);
  const unavailable = route(a.plan, { kind: "UNKNOWN", reason: "MAPPING_UNAVAILABLE" });
  expect(bound(a, null, unavailable).ok).toBe(true);
  for (const value of [undefined, [], supported, {}])
    expect(bound(a, value, unavailable).ok).toBe(false);
  const invalid = route(a.plan, { kind: "UNKNOWN", reason: "MAPPING_INVALID" });
  for (const value of [[], {}, false, [{ ...host(), extra: true }]])
    expect(bound(a, value, invalid).ok).toBe(true);
  for (const value of [null, undefined, supported]) expect(bound(a, value, invalid).ok).toBe(false);
  const unproven = route(a.plan, { kind: "UNKNOWN", reason: "ADMISSION_UNPROVEN" }, supported);
  expect(bound(a, supported, unproven).ok).toBe(true);
  for (const value of [null, [], unsupported]) expect(bound(a, value, unproven).ok).toBe(false);
  expect(bound(a, unsupported, route(a.plan, unproven.outcome, unsupported)).ok).toBe(true);
});

test("requires actual module input/action joins and never routes module no-action", () => {
  const a = action(),
    mapping = [host()];
  const r = route(
    a.plan,
    { kind: "SELECTED", workerHostIdentityDigest: mapping[0]!.workerHostIdentityDigest },
    mapping,
  );
  expect(bound(a, mapping, { ...r, actionPlanDigest: "e".repeat(64) }).ok).toBe(false);
  const changedInput = structuredClone(a.input);
  changedInput.cycleRequest.cycleId = "01900000-0000-7000-8000-000000000099";
  expect(c.parseModulePlanInput(changedInput).ok).toBe(true);
  expect(c.validateRouteSelectionBinding(changedInput, a.plan, mapping, r).ok).toBe(false);
  const changed = { ...a.plan, inputDigest: "f".repeat(64) };
  expect(c.parseModuleActionPlan(changed).ok).toBe(true);
  expect(bound({ ...a, plan: changed }, mapping, route(changed, r.outcome, mapping)).ok).toBe(
    false,
  );
  const noAction = {
    inputDigest: c.computeModulePlanInputDigest(a.input),
    outcome: "NO_ACTION",
    reason: "NO_ELIGIBLE_ACTION",
    schemaVersion: "module-no-action/v1",
  };
  expect(c.validateModulePlanBinding(a.input, noAction).ok).toBe(true);
  expect(c.validateRouteSelectionBinding(a.input, noAction, mapping, r).ok).toBe(false);
  const direct = action(false);
  const n = route(direct.plan, { kind: "NO_WORKER" });
  expect(bound(direct, null, n).ok).toBe(true);
  for (const value of [undefined, [], mapping]) expect(bound(direct, value, n).ok).toBe(false);
  expect(bound(a, null, route(a.plan, { kind: "NO_WORKER" })).ok).toBe(false);
  expect(bound(direct, mapping, route(direct.plan, r.outcome, mapping)).ok).toBe(false);
  expect(
    bound(direct, null, route(direct.plan, { kind: "UNKNOWN", reason: "MAPPING_UNAVAILABLE" })).ok,
  ).toBe(false);
});

test("retains complete host bounds, identity derivation and capability census", () => {
  const a = action();
  for (const count of [1, 16]) {
    const mapping = Array.from({ length: count }, (_unused, n) => host(n + 1));
    expect(
      bound(
        a,
        mapping,
        route(
          a.plan,
          { kind: "SELECTED", workerHostIdentityDigest: mapping.at(-1)!.workerHostIdentityDigest },
          mapping,
        ),
      ).ok,
    ).toBe(true);
  }
  for (const value of [
    [],
    Array.from({ length: 17 }, (_unused, n) => host(n + 1)),
    [host(), host()],
    [{ ...host(), workerHostIdentityDigest: "f".repeat(64) }],
    [{ ...host(), capabilityNames: [] }],
    [{ ...host(), capabilityNames: ["work.Read"] }],
  ]) {
    expect(() => c.computeRouteMappingDigest(value)).toThrow();
    expect(bound(a, value, route(a.plan, { kind: "UNKNOWN", reason: "MAPPING_INVALID" })).ok).toBe(
      true,
    );
  }
  const capabilities = Array.from(
    { length: 255 },
    (_unused, n) => `cap.${n.toString().padStart(3, "0")}`,
  ).concat("work.read");
  const full = [host(1, capabilities)];
  const r = route(
    a.plan,
    { kind: "SELECTED", workerHostIdentityDigest: full[0]!.workerHostIdentityDigest },
    full,
  );
  expect(bound(a, full, r).ok).toBe(true);
  const extra = [{ ...full[0], capabilityNames: ["additional", ...capabilities] }];
  expect(c.parseWorkerHostRendererArtifacts(extra).ok).toBe(false);
  const changed = [host(2, capabilities)];
  expect(bound(a, changed, r).ok).toBe(false);
  expect(bound(a, changed, route(a.plan, r.outcome, changed)).ok).toBe(false);
});

test("hostile records and unknown mapping observations never execute supplied code", () => {
  let calls = 0;
  const trap = () => {
    calls++;
    throw new Error("input code ran");
  };
  const proxy = new Proxy(
    {},
    { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap },
  );
  const accessor = Object.defineProperty({}, "schemaVersion", { enumerable: true, get: trap });
  const a = action();
  for (const value of [
    proxy,
    accessor,
    new Date(),
    Object.create({ inherited: true }),
    Object.assign(JSON.parse(goldens[0].text), { [Symbol("extra")]: true }),
  ]) {
    expect(() => c.parseRouteSelection(value)).not.toThrow();
    expect(c.parseRouteSelection(value).ok).toBe(false);
  }
  const invalid = route(a.plan, { kind: "UNKNOWN", reason: "MAPPING_INVALID" });
  for (const value of [
    proxy,
    [proxy],
    Object.defineProperty([], "0", { enumerable: true, get: trap }),
  ])
    expect(bound(a, value, invalid).ok).toBe(true);
  const byteProxy = new Proxy(bytes(goldens[0].text), { get: trap, getPrototypeOf: trap });
  expect(c.parseCanonicalContractBytes(schema, byteProxy).ok).toBe(false);
  expect(calls).toBe(0);
});
