import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as c from "../../packages/contracts/src/index.js";

// Independently generated with Node stdlib JSON/Buffer/crypto from the reviewed ledger.
// No production canonicalizer, frame, digest, parser or module was imported by the generator.
const goldens = [
  {
    schema: "module-descriptor/v1",
    text: '{"abi":"orchestration-module/v1","actions":[{"actionKind":"fixture.direct","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":false},{"actionKind":"fixture.inspect","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":true}],"compatibility":[{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","engineVersion":"0.0.0","policyVersion":"1.2.3"}],"dispatchCatalog":[{"actionKind":"fixture.inspect","capabilityName":"work.read","code":"verify","directiveKind":"VERIFICATION","planAccessor":"IMMUTABLE_SUBJECT_DIGEST","templateId":"template.verify"}],"dispositionCodes":[],"inputSchemas":["module-plan-input/v1"],"moduleId":"fixture.module","moduleVersion":"1.0.0","outputSchemas":["module-action-plan/v1","module-no-action/v1"],"schemaVersion":"module-descriptor/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d006d6f64756c652d64657363726970746f722f763100000000010700000000000003587b22616269223a226f726368657374726174696f6e2d6d6f64756c652f7631222c22616374696f6e73223a5b7b22616374696f6e4b696e64223a22666978747572652e646972656374222c226361706162696c6974794e616d65223a22776f726b2e72656164222c22726571756573746564526f6c65223a226f62736572766572222c227265766965775265717569726564223a66616c73652c22776f726b65725265717569726564223a66616c73657d2c7b22616374696f6e4b696e64223a22666978747572652e696e7370656374222c226361706162696c6974794e616d65223a22776f726b2e72656164222c22726571756573746564526f6c65223a226f62736572766572222c227265766965775265717569726564223a66616c73652c22776f726b65725265717569726564223a747275657d5d2c22636f6d7061746962696c697479223a5b7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c22656e67696e6556657273696f6e223a22302e302e30222c22706f6c69637956657273696f6e223a22312e322e33227d5d2c226469737061746368436174616c6f67223a5b7b22616374696f6e4b696e64223a22666978747572652e696e7370656374222c226361706162696c6974794e616d65223a22776f726b2e72656164222c22636f6465223a22766572696679222c226469726563746976654b696e64223a22564552494649434154494f4e222c22706c616e4163636573736f72223a22494d4d555441424c455f5355424a4543545f444947455354222c2274656d706c6174654964223a2274656d706c6174652e766572696679227d5d2c22646973706f736974696f6e436f646573223a5b5d2c22696e707574536368656d6173223a5b226d6f64756c652d706c616e2d696e7075742f7631225d2c226d6f64756c654964223a22666978747572652e6d6f64756c65222c226d6f64756c6556657273696f6e223a22312e302e30222c226f7574707574536368656d6173223a5b226d6f64756c652d616374696f6e2d706c616e2f7631222c226d6f64756c652d6e6f2d616374696f6e2f7631225d2c22736368656d6156657273696f6e223a226d6f64756c652d64657363726970746f722f7631227d0a",
    digest: "fd280389762593c6a09d1f75928088369b7d46c074d3eed1b9af57181d714260",
  },
  {
    schema: "module-plan-input/v1",
    text: '{"adapterConfiguration":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","capabilityNames":["work.read"],"engineVersion":"0.0.0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"adapter-configuration/v1"},"configurationProvenance":{"adapterId":"fixture.adapter","capabilityNames":["work.read"],"fieldSources":{"adapterId":"PROJECT","capabilityNames":"PROJECT","leaseFreshnessMs":"PROJECT","maximumSessionMs":"PROJECT","projectId":"PROJECT","stateRoot":"DEFAULT","wallClockSkewMs":"PROJECT"},"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"01900000-0000-7000-8000-000000000001","projectRoot":"<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>","schemaVersion":"configuration-provenance/v1","stateRoot":"<redacted:path:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc>","wallClockSkewMs":1000},"cycleRequest":{"adapterId":"fixture.adapter","allowedModuleIds":["fixture.module"],"cycleId":"01900000-0000-7000-8000-000000000003","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","configurationProvenanceDigest":"6cb88ecc36a83f0d147de82f0d55aa9c92ad9d39f743ab8698cf943fdaf99e81","configurationSourceDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000006"}},"descriptor":{"abi":"orchestration-module/v1","actions":[{"actionKind":"fixture.direct","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":false},{"actionKind":"fixture.inspect","capabilityName":"work.read","requestedRole":"observer","reviewRequired":false,"workerRequired":true}],"compatibility":[{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","engineVersion":"0.0.0","policyVersion":"1.2.3"}],"dispatchCatalog":[{"actionKind":"fixture.inspect","capabilityName":"work.read","code":"verify","directiveKind":"VERIFICATION","planAccessor":"IMMUTABLE_SUBJECT_DIGEST","templateId":"template.verify"}],"dispositionCodes":[],"inputSchemas":["module-plan-input/v1"],"moduleId":"fixture.module","moduleVersion":"1.0.0","outputSchemas":["module-action-plan/v1","module-no-action/v1"],"schemaVersion":"module-descriptor/v1"},"policyFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","decisions":[{"capabilityName":"work.read","trip":"TRIP"}],"observationId":"01900000-0000-7000-8000-000000000005","observedAt":"2026-08-31T01:00:00.001Z","policyVersion":"1.2.3","projectFactsDigest":"850e033912e587726788238a4c80a9caea6fe605e7c951232bc84e0900f851e0","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-breaker-facts/v1","state":"COMPLETE"},"projectFacts":{"adapterConfigurationDigest":"fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e","frontier":[{"capabilityNames":["work.read"],"immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","readiness":"READY","workId":"01900000-0000-7000-8000-000000000002"}],"frontierDigest":"e1fd114d0aa64349f2ff70dc4f4e8e3b15a6a16d0380524937ed4ba09ed483d2","observationId":"01900000-0000-7000-8000-000000000004","observedAt":"2026-08-31T01:00:00.000Z","projectId":"01900000-0000-7000-8000-000000000001","schemaVersion":"project-facts/v1","state":"COMPLETE"},"reviewSubject":null,"schemaVersion":"module-plan-input/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d006d6f64756c652d706c616e2d696e7075742f76310000000001070000000000000d977b2261646170746572436f6e66696775726174696f6e223a7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c226361706162696c6974794e616d6573223a5b22776f726b2e72656164225d2c22656e67696e6556657273696f6e223a22302e302e30222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22736368656d6156657273696f6e223a22616461707465722d636f6e66696775726174696f6e2f7631227d2c22636f6e66696775726174696f6e50726f76656e616e6365223a7b22616461707465724964223a22666978747572652e61646170746572222c226361706162696c6974794e616d6573223a5b22776f726b2e72656164225d2c226669656c64536f7572636573223a7b22616461707465724964223a2250524f4a454354222c226361706162696c6974794e616d6573223a2250524f4a454354222c226c6561736546726573686e6573734d73223a2250524f4a454354222c226d6178696d756d53657373696f6e4d73223a2250524f4a454354222c2270726f6a6563744964223a2250524f4a454354222c227374617465526f6f74223a2244454641554c54222c2277616c6c436c6f636b536b65774d73223a2250524f4a454354227d2c226c6561736546726573686e6573734d73223a33303030302c226d6178696d756d53657373696f6e4d73223a333630303030302c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c2270726f6a656374526f6f74223a223c72656461637465643a706174683a626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262623e222c22736368656d6156657273696f6e223a22636f6e66696775726174696f6e2d70726f76656e616e63652f7631222c227374617465526f6f74223a223c72656461637465643a706174683a636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363633e222c2277616c6c436c6f636b536b65774d73223a313030307d2c226379636c6552657175657374223a7b22616461707465724964223a22666978747572652e61646170746572222c22616c6c6f7765644d6f64756c65496473223a5b22666978747572652e6d6f64756c65225d2c226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033222c22736368656d6156657273696f6e223a226379636c652d726571756573742f7631222c2273657373696f6e52657175657374223a7b22636f6e66696775726174696f6e5061746873446967657374223a2263636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363222c22636f6e66696775726174696f6e50726f76656e616e6365446967657374223a2236636238386563633336613833663064313437646538326630643535616139633932616439643339663734336162383639386366393433666461663939653831222c22636f6e66696775726174696f6e536f75726365446967657374223a2262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262222c22736368656d6156657273696f6e223a2273657373696f6e2d616371756972652d726571756573742f7631222c2273657373696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303036227d7d2c2264657363726970746f72223a7b22616269223a226f726368657374726174696f6e2d6d6f64756c652f7631222c22616374696f6e73223a5b7b22616374696f6e4b696e64223a22666978747572652e646972656374222c226361706162696c6974794e616d65223a22776f726b2e72656164222c22726571756573746564526f6c65223a226f62736572766572222c227265766965775265717569726564223a66616c73652c22776f726b65725265717569726564223a66616c73657d2c7b22616374696f6e4b696e64223a22666978747572652e696e7370656374222c226361706162696c6974794e616d65223a22776f726b2e72656164222c22726571756573746564526f6c65223a226f62736572766572222c227265766965775265717569726564223a66616c73652c22776f726b65725265717569726564223a747275657d5d2c22636f6d7061746962696c697479223a5b7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c22656e67696e6556657273696f6e223a22302e302e30222c22706f6c69637956657273696f6e223a22312e322e33227d5d2c226469737061746368436174616c6f67223a5b7b22616374696f6e4b696e64223a22666978747572652e696e7370656374222c226361706162696c6974794e616d65223a22776f726b2e72656164222c22636f6465223a22766572696679222c226469726563746976654b696e64223a22564552494649434154494f4e222c22706c616e4163636573736f72223a22494d4d555441424c455f5355424a4543545f444947455354222c2274656d706c6174654964223a2274656d706c6174652e766572696679227d5d2c22646973706f736974696f6e436f646573223a5b5d2c22696e707574536368656d6173223a5b226d6f64756c652d706c616e2d696e7075742f7631225d2c226d6f64756c654964223a22666978747572652e6d6f64756c65222c226d6f64756c6556657273696f6e223a22312e302e30222c226f7574707574536368656d6173223a5b226d6f64756c652d616374696f6e2d706c616e2f7631222c226d6f64756c652d6e6f2d616374696f6e2f7631225d2c22736368656d6156657273696f6e223a226d6f64756c652d64657363726970746f722f7631227d2c22706f6c6963794661637473223a7b2261646170746572436f6e66696775726174696f6e446967657374223a2266646232373633643437633962343534313062353532306439646336313135326131396163346132336636356334343638643465313562666339363963643865222c226465636973696f6e73223a5b7b226361706162696c6974794e616d65223a22776f726b2e72656164222c2274726970223a2254524950227d5d2c226f62736572766174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303035222c226f627365727665644174223a22323032362d30382d33315430313a30303a30302e3030315a222c22706f6c69637956657273696f6e223a22312e322e33222c2270726f6a6563744661637473446967657374223a2238353065303333393132653538373732363738383233386134633830613963616561366665363035653763393531323332626338346530393030663835316530222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22736368656d6156657273696f6e223a2270726f6a6563742d627265616b65722d66616374732f7631222c227374617465223a22434f4d504c455445227d2c2270726f6a6563744661637473223a7b2261646170746572436f6e66696775726174696f6e446967657374223a2266646232373633643437633962343534313062353532306439646336313135326131396163346132336636356334343638643465313562666339363963643865222c2266726f6e74696572223a5b7b226361706162696c6974794e616d6573223a5b22776f726b2e72656164225d2c22696d6d757461626c655375626a656374446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c2272656164696e657373223a225245414459222c22776f726b4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032227d5d2c2266726f6e74696572446967657374223a2265316664313134643061613634333439663266663730646334663465386533623135613661313664303338303532343933376564346261303965643438336432222c226f62736572766174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303034222c226f627365727665644174223a22323032362d30382d33315430313a30303a30302e3030305a222c2270726f6a6563744964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c22736368656d6156657273696f6e223a2270726f6a6563742d66616374732f7631222c227374617465223a22434f4d504c455445227d2c227265766965775375626a656374223a6e756c6c2c22736368656d6156657273696f6e223a226d6f64756c652d706c616e2d696e7075742f7631227d0a",
    digest: "6e21596d2dd9d338cd81664b0f39c1869d527c1e67253137bd61985c39dea90d",
  },
  {
    schema: "module-action-plan/v1",
    text: '{"actionCore":{"actionKind":"fixture.direct","capabilityName":"work.read","immutableSubjectDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","moduleDescriptorDigest":"fd280389762593c6a09d1f75928088369b7d46c074d3eed1b9af57181d714260","requestedRole":"observer","schemaVersion":"dispatch-action-core/v1"},"dispatchBrief":null,"inputDigest":"6e21596d2dd9d338cd81664b0f39c1869d527c1e67253137bd61985c39dea90d","schemaVersion":"module-action-plan/v1","workId":"01900000-0000-7000-8000-000000000002"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d006d6f64756c652d616374696f6e2d706c616e2f763100000000010700000000000002077b22616374696f6e436f7265223a7b22616374696f6e4b696e64223a22666978747572652e646972656374222c226361706162696c6974794e616d65223a22776f726b2e72656164222c22696d6d757461626c655375626a656374446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226d6f64756c6544657363726970746f72446967657374223a2266643238303338393736323539336336613039643166373539323830383833363962376434366330373464336565643162396166353731383164373134323630222c22726571756573746564526f6c65223a226f62736572766572222c22736368656d6156657273696f6e223a2264697370617463682d616374696f6e2d636f72652f7631227d2c2264697370617463684272696566223a6e756c6c2c22696e707574446967657374223a2236653231353936643264643964333338636438313636346230663339633138363964353237633165363732353331333762643631393835633339646561393064222c22736368656d6156657273696f6e223a226d6f64756c652d616374696f6e2d706c616e2f7631222c22776f726b4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032227d0a",
    digest: "52e0841a44474f148d58713a683055de1c7033c3f5b7ffa1f4f0310732dbfdb2",
  },
  {
    schema: "module-no-action/v1",
    text: '{"inputDigest":"6e21596d2dd9d338cd81664b0f39c1869d527c1e67253137bd61985c39dea90d","outcome":"NO_ACTION","reason":"NO_ELIGIBLE_ACTION","schemaVersion":"module-no-action/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d006d6f64756c652d6e6f2d616374696f6e2f763100000000010700000000000000ad7b22696e707574446967657374223a2236653231353936643264643964333338636438313636346230663339633138363964353237633165363732353331333762643631393835633339646561393064222c226f7574636f6d65223a224e4f5f414354494f4e222c22726561736f6e223a224e4f5f454c494749424c455f414354494f4e222c22736368656d6156657273696f6e223a226d6f64756c652d6e6f2d616374696f6e2f7631227d0a",
    digest: "0bb3302ad417264b13b9f8d7c2ec0eed27dfbee81cea4494819f72630a5a8f7f",
  },
  {
    schema: "module-no-action/v1",
    text: '{"inputDigest":"6e21596d2dd9d338cd81664b0f39c1869d527c1e67253137bd61985c39dea90d","outcome":"REFUSED","reason":"INPUT_REFUSED","schemaVersion":"module-no-action/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d006d6f64756c652d6e6f2d616374696f6e2f763100000000010700000000000000a67b22696e707574446967657374223a2236653231353936643264643964333338636438313636346230663339633138363964353237633165363732353331333762643631393835633339646561393064222c226f7574636f6d65223a2252454655534544222c22726561736f6e223a22494e5055545f52454655534544222c22736368656d6156657273696f6e223a226d6f64756c652d6e6f2d616374696f6e2f7631227d0a",
    digest: "8e4269552f34dc92b6dee6201180e7f7873661503e2f5a08be4f5c762fd4c9d7",
  },
  {
    schema: "module-no-action/v1",
    text: '{"inputDigest":"6e21596d2dd9d338cd81664b0f39c1869d527c1e67253137bd61985c39dea90d","outcome":"REFUSED","reason":"PLANNING_FAILED","schemaVersion":"module-no-action/v1"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d006d6f64756c652d6e6f2d616374696f6e2f763100000000010700000000000000a87b22696e707574446967657374223a2236653231353936643264643964333338636438313636346230663339633138363964353237633165363732353331333762643631393835633339646561393064222c226f7574636f6d65223a2252454655534544222c22726561736f6e223a22504c414e4e494e475f4641494c4544222c22736368656d6156657273696f6e223a226d6f64756c652d6e6f2d616374696f6e2f7631227d0a",
    digest: "f06252f14132f7fdf1c8ddd8b04cc7e8ae2b3b04661730d2a5d8b107128680af",
  },
] as const;

const fresh = () => JSON.parse(goldens[1].text);
const descriptor = () => JSON.parse(goldens[0].text);
const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const textBytes = (text: string) => new TextEncoder().encode(text);
const parse = (schema: string, value: unknown) => c.parseContract(schema, value);
function atPath(value: ReturnType<typeof fresh>, path: readonly (string | number)[]) {
  for (const key of path) value = value[key];
  return value;
}

function direct(input = fresh()) {
  const output = JSON.parse(goldens[2].text);
  output.inputDigest = c.computeModulePlanInputDigest(input);
  output.actionCore.moduleDescriptorDigest = c.computeModuleDescriptorDigest(input.descriptor);
  return output;
}
function refreshFacts(input: ReturnType<typeof fresh>) {
  input.projectFacts.frontierDigest = c.canonicalDigest(input.projectFacts.frontier);
  input.policyFacts.projectFactsDigest = c.canonicalDigest(input.projectFacts);
}
function worker(input = fresh(), role = "observer") {
  input.descriptor.actions[1].requestedRole = role;
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
  const output = direct(input);
  output.actionCore.actionKind = "fixture.inspect";
  output.actionCore.requestedRole = role;
  rebrief(output);
  return { input, output };
}
function rebrief(output: ReturnType<typeof direct>) {
  const core = output.actionCore;
  output.dispatchBrief = {
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
        resourceIdentityDigest: "d".repeat(64),
        schemaVersion: "dispatch-brief-resource/v1",
      },
    ],
    role: core.requestedRole,
    schemaVersion: "dispatch-brief/v1",
  };
}
function review(candidate: boolean) {
  const { input, output } = worker(fresh(), "review");
  const source = { adapterId: "fixture.adapter", projectId: id(1), revision: "a".repeat(40) };
  input.reviewSubject = candidate
    ? {
        assemblyCycleId: id(7),
        candidateDigest: "1".repeat(64),
        certificationDigest: "2".repeat(64),
        landedSource: source,
        landedTreeDigest: "3".repeat(64),
        manifestDigest: "4".repeat(64),
        schemaVersion: "release-candidate-subject/v1",
        testBundleDigest: "5".repeat(64),
      }
    : {
        authorAttemptId: id(8),
        authorCycleId: id(7),
        baseSource: source,
        result: { kind: "TREE", treeDigest: "3".repeat(64) },
        schemaVersion: "worker-result-subject/v1",
        terminalReceiptDigest: "6".repeat(64),
      };
  output.inputDigest = c.computeModulePlanInputDigest(input);
  output.workId = null;
  output.actionCore.immutableSubjectDigest = candidate
    ? c.computeReleaseCandidateSubjectDigest(input.reviewSubject)
    : c.computeWorkerResultSubjectDigest(input.reviewSubject);
  rebrief(output);
  return { input, output };
}
function refusedBinding(input: ReturnType<typeof fresh>, output: ReturnType<typeof direct>) {
  // Keep the constituent structures valid, so rejection discriminates a supplied relation.
  expect(c.parseModulePlanInput(input).ok).toBe(true);
  expect(c.parseModulePlanResult(output).ok).toBe(true);
  expect(c.validateModulePlanBinding(input, output).ok).toBe(false);
}

test("pins canonical bytes, full frames and hashes for all four families and every result cell", () => {
  const digests = {
    "module-descriptor/v1": c.computeModuleDescriptorDigest,
    "module-plan-input/v1": c.computeModulePlanInputDigest,
    "module-action-plan/v1": c.computeModuleActionPlanDigest,
    "module-no-action/v1": c.computeModuleNoActionDigest,
  };
  for (const golden of goldens) {
    const value = JSON.parse(golden.text);
    const expected = { ok: true, bytes: textBytes(golden.text), digest: golden.digest };
    expect(
      parse(golden.schema, { ...value, schemaVersion: golden.schema.replace("/v1", "/v2") }).ok,
    ).toBe(false);
    expect(c.canonicalJson(value)).toBe(golden.text);
    expect(Buffer.from(c.framedBytes(golden.schema, [c.frame.canonical(value)]))).toEqual(
      Buffer.from(golden.frameHex, "hex"),
    );
    expect(hash(Buffer.from(golden.frameHex, "hex"))).toBe(golden.digest);
    expect(digests[golden.schema](value)).toBe(golden.digest);
    expect(c.serializeContract(golden.schema, value)).toEqual(expected);
    expect(
      c.serializeContract(golden.schema, Object.fromEntries(Object.entries(value).reverse())),
    ).toEqual(expected);
    expect(c.parseCanonicalContractBytes(golden.schema, textBytes(golden.text))).toEqual({
      ok: true,
      value,
    });
    for (const changed of [
      golden.text.trimEnd(),
      golden.text.replace(/\n$/, "\r\n"),
      "\ufeff" + golden.text,
      " " + golden.text,
      JSON.stringify(Object.fromEntries(Object.entries(value).reverse())) + "\n",
    ])
      expect(c.parseCanonicalContractBytes(golden.schema, textBytes(changed)).ok).toBe(false);
    expect(hash(golden.text)).not.toBe(golden.digest);
    const frame = Buffer.from(golden.frameHex, "hex");
    for (const offset of [
      0,
      Buffer.byteLength("orchestration-platform\0" + golden.schema + "\0") + 3,
      Buffer.byteLength("orchestration-platform\0" + golden.schema + "\0") + 4,
      frame.length - 1,
    ]) {
      const changed = Buffer.from(frame);
      changed[offset] = changed[offset]! ^ 1;
      expect(hash(changed)).not.toBe(golden.digest);
    }
    if (golden.schema === "module-action-plan/v1" || golden.schema === "module-no-action/v1") {
      expect(c.parseModulePlanResult(value)).toEqual({ ok: true, value });
      expect(
        c.parseCanonicalContractBytes("module-plan-result/v1", textBytes(golden.text)),
      ).toEqual({ ok: true, value });
      expect(c.serializeContract("module-plan-result/v1", value)).toEqual(expected);
      expect(c.compatibilityDisposition("module-plan-result/v1", golden.schema)).toBe("readable");
    }
  }
  expect(
    c.parseModulePlanResult({ schemaVersion: "module-plan-result/v1", result: direct() }).ok,
  ).toBe(false);
  expect(c.parseModulePlanResult({ ...direct(), schemaVersion: "module-action-plan/v2" }).ok).toBe(
    false,
  );
  expect(c.parseModuleActionPlan(JSON.parse(goldens[3].text)).ok).toBe(false);
  expect(c.parseModuleNoAction(direct()).ok).toBe(false);
  expect(Object.hasOwn(c.schemaDefinitions, "module-plan-result/v1")).toBe(false);
});

test("the mixed descriptor binds a workerless action without a synthetic brief and preserves TRIP", () => {
  const input = fresh();
  const output = direct(input);
  expect(c.validateModulePlanBinding(input, output)).toEqual({ ok: true, value: output });
  const parsed = c.parseModulePlanInput(input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("expected complete input");
  const retainedPolicy = parsed.value.policyFacts;
  if (retainedPolicy.state !== "COMPLETE") throw new Error("expected complete retained policy");
  expect(retainedPolicy.decisions).toEqual([{ capabilityName: "work.read", trip: "TRIP" }]);
  input.policyFacts.decisions[0].trip = "NO_TRIP";
  expect(c.validateModulePlanBinding(input, direct(input)).ok).toBe(true);
  expect(retainedPolicy.decisions).toEqual([{ capabilityName: "work.read", trip: "TRIP" }]);
  for (const golden of goldens.slice(3)) {
    const result = JSON.parse(golden.text);
    result.inputDigest = c.computeModulePlanInputDigest(input);
    expect(c.validateModulePlanBinding(input, result).ok).toBe(true);
  }
});

test("worker and both review target paths retain reused ABSENT operator nulls", () => {
  for (const { input, output } of [worker(), review(false), review(true)]) {
    expect(c.validateModulePlanBinding(input, output).ok).toBe(true);
    expect(
      output.dispatchBrief.directives.find(
        (row: { directiveKind: string }) => row.directiveKind === "OPERATOR_ACTION",
      ),
    ).toMatchObject({ code: null, presence: "ABSENT" });
  }
});

test("every new record/row member is required, closed and typed; only declared outer nulls survive", () => {
  const shapes = [
    ["module-descriptor/v1", descriptor(), []],
    ["module-descriptor/v1", descriptor(), ["actions", 0]],
    ["module-descriptor/v1", descriptor(), ["compatibility", 0]],
    ["module-descriptor/v1", descriptor(), ["dispatchCatalog", 0]],
    ["module-plan-input/v1", fresh(), []],
    ["module-action-plan/v1", direct(), []],
    ["module-no-action/v1", JSON.parse(goldens[3].text), []],
  ] as const;
  for (const [schema, seed, path] of shapes) {
    const target = atPath(seed, path);
    const nullable =
      schema === "module-plan-input/v1"
        ? ["reviewSubject"]
        : schema === "module-action-plan/v1"
          ? ["dispatchBrief", "workId"]
          : [];
    for (const key of Object.keys(target)) {
      for (const mode of ["missing", "extra", "wrong-type", "null"] as const) {
        if (mode === "null" && nullable.includes(key)) continue;
        const changed = structuredClone(seed);
        const row = atPath(changed, path);
        if (mode === "missing") delete row[key];
        if (mode === "extra") row[`${key}Extra`] = row[key];
        if (mode === "wrong-type") row[key] = typeof row[key] === "string" ? 42 : "wrong-type";
        if (mode === "null") row[key] = null;
        expect(parse(schema, changed).ok, `${schema}:${path.join(".")}:${key}:${mode}`).toBe(false);
      }
    }
  }
  expect(c.parseModuleActionPlan({ ...direct(), workId: null }).ok).toBe(true);
  for (const [outcome, reason] of [
    ["NO_ACTION", "INPUT_REFUSED"],
    ["REFUSED", "NO_ELIGIBLE_ACTION"],
    ["COMPLETED", "PLANNING_FAILED"],
    ["REFUSED", null],
  ])
    expect(c.parseModuleNoAction({ ...JSON.parse(goldens[3].text), outcome, reason }).ok).toBe(
      false,
    );
});

test("descriptor admits exactly the six worker/role/review cells", () => {
  for (const workerRequired of [false, true])
    for (const requestedRole of ["observer", "implementation", "review"])
      for (const reviewRequired of [false, true]) {
        const value = descriptor();
        value.actions = [
          { ...value.actions[1], requestedRole, reviewRequired, workerRequired },
          { ...value.actions[1], actionKind: "fixture.spare" },
        ];
        value.dispatchCatalog = [
          ...(workerRequired ? [value.dispatchCatalog[0]] : []),
          { ...value.dispatchCatalog[0], actionKind: "fixture.spare" },
        ];
        const allowed = workerRequired
          ? requestedRole !== "review" || !reviewRequired
          : requestedRole === "observer" && !reviewRequired;
        expect(
          c.parseModuleDescriptor(value).ok,
          `${workerRequired}:${requestedRole}:${reviewRequired}`,
        ).toBe(allowed);
      }
});

test("descriptor bounds, exact schema arrays and tuple/pair/resolver censuses stay closed", () => {
  for (const count of [0, 1, 256, 257]) {
    const cases = [descriptor(), descriptor(), descriptor(), descriptor()];
    cases[0].actions = Array.from({ length: count }, (_, i) => ({
      ...cases[0].actions[1],
      actionKind: `fixture.a${String(i).padStart(3, "0")}`,
      workerRequired: i === 0,
    }));
    cases[0].dispatchCatalog[0].actionKind = "fixture.a000";
    cases[1].compatibility = Array.from({ length: count }, (_, i) => ({
      ...cases[1].compatibility[0],
      adapterId: `fixture.a${String(i).padStart(3, "0")}`,
    }));
    cases[2].dispatchCatalog = Array.from({ length: count }, (_, i) => ({
      ...cases[2].dispatchCatalog[0],
      code: `c${String(i).padStart(3, "0")}`,
    }));
    cases[3].dispositionCodes = Array.from(
      { length: count },
      (_, i) => `c${String(i).padStart(3, "0")}`,
    );
    cases.forEach((value, i) =>
      expect(c.parseModuleDescriptor(value).ok, `${i}:${count}`).toBe(
        count <= 256 && (i === 3 || count > 0),
      ),
    );
  }
  const changes: Array<(value: ReturnType<typeof descriptor>) => void> = [
    (v) => v.actions.reverse(),
    (v) => v.actions.push(v.actions[0]),
    (v) => v.compatibility.push(v.compatibility[0]),
    (v) => {
      v.dispositionCodes = ["z", "a"];
    },
    (v) => {
      v.dispositionCodes = ["a", "a"];
    },
    (v) => {
      v.inputSchemas = ["module-plan-result/v1"];
    },
    (v) => v.outputSchemas.reverse(),
    (v) => {
      v.actions = [v.actions[0]];
      v.dispatchCatalog = [];
    },
    (v) => {
      v.dispatchCatalog[0].actionKind = "fixture.direct";
    },
    (v) => {
      v.dispatchCatalog.push({ ...v.dispatchCatalog[0], planAccessor: "REQUESTED_ROLE" });
    },
    (v) => {
      v.dispatchCatalog.push({ ...v.dispatchCatalog[0], templateId: "template.other" });
    },
  ];
  for (const change of changes) {
    const value = descriptor();
    change(value);
    expect(c.parseModuleDescriptor(value).ok).toBe(false);
  }
  const ordered = descriptor();
  ordered.compatibility.push({ ...ordered.compatibility[0], adapterVersion: "1.2.4" });
  expect(c.parseModuleDescriptor(ordered).ok).toBe(true);
  ordered.compatibility.reverse();
  expect(c.parseModuleDescriptor(ordered).ok).toBe(false);
});

test("input joins reject independently substituted supplied records and component-mixed compatibility", () => {
  const changes: Array<[string, (input: ReturnType<typeof fresh>) => void]> = [
    [
      "configuration/provenance",
      (v) => {
        v.configurationProvenance.projectId = id(19);
        v.cycleRequest.sessionRequest.configurationProvenanceDigest = c.canonicalDigest(
          v.configurationProvenance,
        );
      },
    ],
    [
      "project/configuration",
      (v) => {
        v.projectFacts.adapterConfigurationDigest = "9".repeat(64);
        refreshFacts(v);
      },
    ],
    [
      "snapshot metadata",
      (v) => {
        v.projectFacts.observedAt = "2026-08-31T01:00:00.002Z";
      },
    ],
    [
      "frontier content",
      (v) => {
        v.projectFacts.frontier[0].immutableSubjectDigest = "9".repeat(64);
      },
    ],
    [
      "policy configuration",
      (v) => {
        v.policyFacts.adapterConfigurationDigest = "9".repeat(64);
      },
    ],
    [
      "policy decision census",
      (v) => {
        v.policyFacts.decisions = [];
      },
    ],
    [
      "policy tuple",
      (v) => {
        v.policyFacts.policyVersion = "1.2.4";
      },
    ],
    [
      "cycle adapter",
      (v) => {
        v.cycleRequest.adapterId = "fixture.other";
      },
    ],
    [
      "cycle provenance",
      (v) => {
        v.cycleRequest.sessionRequest.configurationProvenanceDigest = "9".repeat(64);
      },
    ],
    [
      "module intent",
      (v) => {
        v.cycleRequest.allowedModuleIds = [];
      },
    ],
    [
      "declared capability",
      (v) => {
        v.descriptor.actions.unshift({
          ...v.descriptor.actions[0],
          actionKind: "fixture.another",
          capabilityName: "work.other",
        });
      },
    ],
    [
      "policy COMPLETE",
      (v) => {
        delete v.policyFacts.decisions;
        v.policyFacts.state = "UNKNOWN";
        v.policyFacts.reason = "SOURCE_UNKNOWN";
      },
    ],
    [
      "project COMPLETE",
      (v) => {
        delete v.projectFacts.frontier;
        delete v.projectFacts.frontierDigest;
        v.projectFacts.state = "UNAVAILABLE";
        v.projectFacts.reason = "SOURCE_UNAVAILABLE";
        v.policyFacts.projectFactsDigest = c.canonicalDigest(v.projectFacts);
      },
    ],
  ];
  for (const [name, change] of changes) {
    const value = fresh();
    change(value);
    expect(c.parseModulePlanInput(value).ok, name).toBe(false);
  }
  for (const field of ["adapterId", "adapterVersion", "engineVersion", "policyVersion"]) {
    const value = fresh();
    value.descriptor.compatibility[0][field] = field === "adapterId" ? "fixture.other" : "9.0.0";
    expect(c.parseModuleDescriptor(value.descriptor).ok).toBe(true);
    expect(c.parseModulePlanInput(value).ok, field).toBe(false);
  }
  const mixed = fresh();
  mixed.descriptor.compatibility = [
    { ...mixed.descriptor.compatibility[0], engineVersion: "9.0.0" },
    { ...mixed.descriptor.compatibility[0], adapterVersion: "9.0.0" },
  ];
  expect(c.parseModuleDescriptor(mixed.descriptor).ok).toBe(true);
  expect(c.parseModulePlanInput(mixed).ok).toBe(false);
});

test("result bindings reject mismatched input, descriptor, declared action, work and target", () => {
  const outputChanges: Array<[string, (output: ReturnType<typeof direct>) => void]> = [
    [
      "input identity",
      (v) => {
        v.inputDigest = "9".repeat(64);
      },
    ],
    [
      "descriptor identity",
      (v) => {
        v.actionCore.moduleDescriptorDigest = "9".repeat(64);
      },
    ],
    [
      "declared action",
      (v) => {
        v.actionCore.actionKind = "fixture.unknown";
      },
    ],
    [
      "capability",
      (v) => {
        v.actionCore.capabilityName = "work.other";
      },
    ],
    [
      "work required",
      (v) => {
        v.workId = null;
      },
    ],
    [
      "actual work",
      (v) => {
        v.workId = id(19);
      },
    ],
    [
      "immutable target",
      (v) => {
        v.actionCore.immutableSubjectDigest = "9".repeat(64);
      },
    ],
  ];
  for (const [name, change] of outputChanges) {
    const input = fresh();
    const output = direct(input);
    change(output);
    expect(c.parseModuleActionPlan(output).ok, name).toBe(true);
    refusedBinding(input, output);
  }
  for (const change of [
    (v: ReturnType<typeof fresh>) => {
      v.projectFacts.frontier[0].readiness = "NOT_READY";
    },
    (v: ReturnType<typeof fresh>) => {
      v.projectFacts.frontier[0].capabilityNames = [];
    },
  ]) {
    const input = fresh();
    change(input);
    refreshFacts(input);
    refusedBinding(input, direct(input));
  }
  const noAction = JSON.parse(goldens[3].text);
  noAction.inputDigest = "9".repeat(64);
  refusedBinding(fresh(), noAction);
});

test("worker requirement, requested role and each intrinsic brief/core equality have discriminators", () => {
  const absent = worker();
  absent.output.dispatchBrief = null;
  refusedBinding(absent.input, absent.output);
  const present = fresh();
  const output = direct(present);
  rebrief(output);
  refusedBinding(present, output);
  const role = worker();
  role.output.actionCore.requestedRole = "implementation";
  rebrief(role.output);
  refusedBinding(role.input, role.output);
  for (const field of [
    "actionKind",
    "capabilityName",
    "immutableSubjectDigest",
    "moduleDescriptorDigest",
    "actionCoreDigest",
  ]) {
    const sample = worker();
    sample.output.dispatchBrief.action[field] = field.endsWith("Digest")
      ? "9".repeat(64)
      : "fixture.other";
    if (field === "immutableSubjectDigest")
      sample.output.dispatchBrief.directives.forEach((row: { subjectDigest: string }) => {
        row.subjectDigest = "9".repeat(64);
      });
    expect(c.parseDispatchBrief(sample.output.dispatchBrief).ok).toBe(true);
    expect(c.parseModuleActionPlan(sample.output).ok, field).toBe(false);
  }
  const mismatch = worker();
  mismatch.output.dispatchBrief.role = "implementation";
  expect(c.parseModuleActionPlan(mismatch.output).ok).toBe(false);
  const catalog = worker();
  catalog.input.descriptor.dispatchCatalog[0].code = "other";
  catalog.output.inputDigest = c.computeModulePlanInputDigest(catalog.input);
  catalog.output.actionCore.moduleDescriptorDigest = c.computeModuleDescriptorDigest(
    catalog.input.descriptor,
  );
  rebrief(catalog.output);
  refusedBinding(catalog.input, catalog.output);
});

test("review target nullability, role, family and later-cycle joins cannot be bypassed", () => {
  const ordinary = worker(fresh(), "review");
  refusedBinding(ordinary.input, ordinary.output);
  for (const candidate of [false, true]) {
    const sameCycle = review(candidate);
    sameCycle.input.cycleRequest.cycleId = id(7);
    expect(c.parseModulePlanInput(sameCycle.input).ok).toBe(false);
    const work = review(candidate);
    work.output.workId = id(2);
    refusedBinding(work.input, work.output);
    const target = review(candidate);
    target.output.actionCore.immutableSubjectDigest = "9".repeat(64);
    rebrief(target.output);
    refusedBinding(target.input, target.output);
    const role = review(candidate);
    role.input.descriptor.actions[1].requestedRole = "observer";
    role.output.inputDigest = c.computeModulePlanInputDigest(role.input);
    role.output.actionCore.moduleDescriptorDigest = c.computeModuleDescriptorDigest(
      role.input.descriptor,
    );
    role.output.actionCore.requestedRole = "observer";
    rebrief(role.output);
    refusedBinding(role.input, role.output);
    const family = review(candidate);
    family.input.reviewSubject = review(!candidate).input.reviewSubject;
    family.output.inputDigest = c.computeModulePlanInputDigest(family.input);
    refusedBinding(family.input, family.output);
  }
});

test("hostile records and arrays refuse without running supplied code", () => {
  let calls = 0;
  const values: unknown[] = [];
  const root = descriptor();
  Object.defineProperty(root, "moduleId", {
    enumerable: true,
    get() {
      calls++;
      return "fixture.module";
    },
  });
  values.push(root);
  const nested = descriptor();
  Object.defineProperty(nested.actions[0], "requestedRole", {
    enumerable: true,
    get() {
      calls++;
      return "observer";
    },
  });
  values.push(nested);
  const proxy = descriptor();
  proxy.dispatchCatalog = new Proxy([], {
    ownKeys() {
      calls++;
      return [];
    },
  });
  values.push(proxy);
  const hole = descriptor();
  hole.actions = new Array(2);
  values.push(hole);
  const symbol = descriptor();
  symbol[Symbol("extra")] = 1;
  values.push(symbol);
  const exotic = descriptor();
  exotic.compatibility = new Date();
  values.push(exotic);
  for (const value of values) expect(c.parseModuleDescriptor(value).ok).toBe(false);
  const input = fresh();
  input.policyFacts = new Proxy(
    {},
    {
      ownKeys() {
        calls++;
        return [];
      },
    },
  );
  expect(c.parseModulePlanInput(input).ok).toBe(false);
  const output = direct();
  Object.defineProperty(output, "workId", {
    enumerable: true,
    get() {
      calls++;
      return id(2);
    },
  });
  expect(c.parseModulePlanResult(output).ok).toBe(false);
  expect(calls).toBe(0);
});

test("new lookup scalar boundaries and catalog order keep their literal meanings", () => {
  for (const [length, allowed] of [
    [1, true],
    [128, true],
    [129, false],
    [0, false],
  ] as const) {
    const value = descriptor();
    value.moduleId = "a".repeat(length);
    expect(c.parseModuleDescriptor(value).ok).toBe(allowed);
  }
  for (const [length, allowed] of [
    [1, true],
    [64, true],
    [65, false],
    [0, false],
  ] as const) {
    const value = descriptor();
    value.dispositionCodes = ["a".repeat(length)];
    expect(c.parseModuleDescriptor(value).ok).toBe(allowed);
  }
  for (const [version, allowed] of [
    ["1.0." + "1".repeat(59), true],
    ["1.0." + "1".repeat(60), false],
    ["01.0.0", false],
    ["1.0.0\n", false],
  ] as const) {
    const value = descriptor();
    value.moduleVersion = version;
    expect(c.parseModuleDescriptor(value).ok).toBe(allowed);
  }
  const value = descriptor();
  value.dispatchCatalog.push({ ...value.dispatchCatalog[0], code: "other" });
  expect(c.parseModuleDescriptor(value).ok).toBe(true);
  const before = c.computeModuleDescriptorDigest(value);
  value.dispatchCatalog.reverse();
  expect(c.parseModuleDescriptor(value).ok).toBe(true);
  expect(c.computeModuleDescriptorDigest(value)).not.toBe(before);
});
