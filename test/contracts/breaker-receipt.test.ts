import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as c from "../../packages/contracts/src/index.js";

// Stdlib-only external generator: literal shapes, JSON sort, Buffer framing and SHA-256.
// No production parser/canonicalizer/digest was used to produce these pinned values.
const goldens = [
  {
    text: '{"adapterConfigurationDigest":"1111111111111111111111111111111111111111111111111111111111111111","cycleId":"01900000-0000-7000-8000-000000000002","cycleRequestDigest":"2222222222222222222222222222222222222222222222222222222222222222","operations":[{"capabilityName":"cap.b","kind":"REQUEST_RECOVERY","observation":{"adapterConfigurationDigest":"1111111111111111111111111111111111111111111111111111111111111111","capabilityName":"cap.b","decision":"KEEP_HOLD","observationId":"01900000-0000-7000-8000-000000000016","observedAt":"2026-08-31T01:00:01.000Z","openReceiptDigest":"4444444444444444444444444444444444444444444444444444444444444444","policyIdentity":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","policyVersion":"1.2.3"},"projectFactsDigest":"5555555555555555555555555555555555555555555555555555555555555555","transactionId":"01900000-0000-7000-8000-000000000020"}},{"capabilityName":"cap.d","kind":"START_PROBE","observation":{"probeId":"01900000-0000-7000-8000-00000000002c","recoveryDigest":"44363788cdb91f6f610b8a9977e15e13efcc00fb416bea4f9e87e6d31ffa5755","startedAt":"2026-08-31T01:00:02.000Z"}},{"capabilityName":"cap.e","kind":"FINISH_PROBE","observation":{"finishedAt":"2026-08-31T01:00:03.000Z","outcome":"SUCCEEDED","probeId":"01900000-0000-7000-8000-00000000002d","recoveryDigest":"c39564101ffe8a97a32feff1db616280257c9841220d2048874d968606e58dc1","startedAt":"2026-08-31T01:00:02.000Z"}}],"policyFactsDigest":"3333333333333333333333333333333333333333333333333333333333333333","policyIdentity":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","policyVersion":"1.2.3"},"priorReceiptDigest":"4444444444444444444444444444444444444444444444444444444444444444","result":{"capabilities":[{"capabilityName":"cap.a","state":"CLOSED"},{"capabilityName":"cap.b","opening":{"cycleRequestDigest":"2222222222222222222222222222222222222222222222222222222222222222","policyFactsDigest":"3333333333333333333333333333333333333333333333333333333333333333"},"state":"OPEN"},{"capabilityName":"cap.c","opening":{"cycleRequestDigest":"2222222222222222222222222222222222222222222222222222222222222222","policyFactsDigest":"3333333333333333333333333333333333333333333333333333333333333333"},"recovery":{"adapterConfigurationDigest":"1111111111111111111111111111111111111111111111111111111111111111","capabilityName":"cap.c","decision":"ALLOW_RECOVERY","observationId":"01900000-0000-7000-8000-000000000017","observedAt":"2026-08-31T01:00:01.000Z","openReceiptDigest":"4444444444444444444444444444444444444444444444444444444444444444","policyIdentity":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","policyVersion":"1.2.3"},"projectFactsDigest":"5555555555555555555555555555555555555555555555555555555555555555","transactionId":"01900000-0000-7000-8000-000000000021"},"state":"RECOVERY_PENDING"},{"capabilityName":"cap.d","opening":{"cycleRequestDigest":"2222222222222222222222222222222222222222222222222222222222222222","policyFactsDigest":"3333333333333333333333333333333333333333333333333333333333333333"},"probe":{"probeId":"01900000-0000-7000-8000-00000000002c","recoveryDigest":"44363788cdb91f6f610b8a9977e15e13efcc00fb416bea4f9e87e6d31ffa5755","startedAt":"2026-08-31T01:00:02.000Z"},"recovery":{"adapterConfigurationDigest":"1111111111111111111111111111111111111111111111111111111111111111","capabilityName":"cap.d","decision":"ALLOW_RECOVERY","observationId":"01900000-0000-7000-8000-000000000018","observedAt":"2026-08-31T01:00:01.000Z","openReceiptDigest":"4444444444444444444444444444444444444444444444444444444444444444","policyIdentity":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","policyVersion":"1.2.3"},"projectFactsDigest":"5555555555555555555555555555555555555555555555555555555555555555","transactionId":"01900000-0000-7000-8000-000000000022"},"state":"PROBE_IN_FLIGHT"},{"capabilityName":"cap.e","completion":{"finishedAt":"2026-08-31T01:00:03.000Z","outcome":"SUCCEEDED","probeId":"01900000-0000-7000-8000-00000000002d","recoveryDigest":"c39564101ffe8a97a32feff1db616280257c9841220d2048874d968606e58dc1","startedAt":"2026-08-31T01:00:02.000Z"},"opening":{"cycleRequestDigest":"2222222222222222222222222222222222222222222222222222222222222222","policyFactsDigest":"3333333333333333333333333333333333333333333333333333333333333333"},"probe":{"probeId":"01900000-0000-7000-8000-00000000002d","recoveryDigest":"c39564101ffe8a97a32feff1db616280257c9841220d2048874d968606e58dc1","startedAt":"2026-08-31T01:00:02.000Z"},"recovery":{"adapterConfigurationDigest":"1111111111111111111111111111111111111111111111111111111111111111","capabilityName":"cap.e","decision":"ALLOW_RECOVERY","observationId":"01900000-0000-7000-8000-000000000019","observedAt":"2026-08-31T01:00:01.000Z","openReceiptDigest":"4444444444444444444444444444444444444444444444444444444444444444","policyIdentity":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","policyVersion":"1.2.3"},"projectFactsDigest":"5555555555555555555555555555555555555555555555555555555555555555","transactionId":"01900000-0000-7000-8000-000000000023"},"state":"CLOSED_RECOVERED"}],"kind":"KNOWN"},"schemaVersion":"breaker-receipt/v1","sessionId":"01900000-0000-7000-8000-000000000003"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00627265616b65722d726563656970742f763100000000010700000000000014447b2261646170746572436f6e66696775726174696f6e446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c226379636c6552657175657374446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c226f7065726174696f6e73223a5b7b226361706162696c6974794e616d65223a226361702e62222c226b696e64223a22524551554553545f5245434f56455259222c226f62736572766174696f6e223a7b2261646170746572436f6e66696775726174696f6e446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c226361706162696c6974794e616d65223a226361702e62222c226465636973696f6e223a224b4545505f484f4c44222c226f62736572766174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303136222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f70656e52656365697074446967657374223a2234343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434222c22706f6c6963794964656e74697479223a7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c22706f6c69637956657273696f6e223a22312e322e33227d2c2270726f6a6563744661637473446967657374223a2235353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535222c227472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303230227d7d2c7b226361706162696c6974794e616d65223a226361702e64222c226b696e64223a2253544152545f50524f4245222c226f62736572766174696f6e223a7b2270726f62654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303263222c227265636f76657279446967657374223a2234343336333738386364623931663666363130623861393937376531356531336566636330306662343136626561346639653837653664333166666135373535222c22737461727465644174223a22323032362d30382d33315430313a30303a30322e3030305a227d7d2c7b226361706162696c6974794e616d65223a226361702e65222c226b696e64223a2246494e4953485f50524f4245222c226f62736572766174696f6e223a7b2266696e69736865644174223a22323032362d30382d33315430313a30303a30332e3030305a222c226f7574636f6d65223a22535543434545444544222c2270726f62654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303264222c227265636f76657279446967657374223a2263333935363431303166666538613937613332666566663164623631363238303235376339383431323230643230343838373464393638363036653538646331222c22737461727465644174223a22323032362d30382d33315430313a30303a30322e3030305a227d7d5d2c22706f6c6963794661637473446967657374223a2233333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333222c22706f6c6963794964656e74697479223a7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c22706f6c69637956657273696f6e223a22312e322e33227d2c227072696f7252656365697074446967657374223a2234343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434222c22726573756c74223a7b226361706162696c6974696573223a5b7b226361706162696c6974794e616d65223a226361702e61222c227374617465223a22434c4f534544227d2c7b226361706162696c6974794e616d65223a226361702e62222c226f70656e696e67223a7b226379636c6552657175657374446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c22706f6c6963794661637473446967657374223a2233333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333227d2c227374617465223a224f50454e227d2c7b226361706162696c6974794e616d65223a226361702e63222c226f70656e696e67223a7b226379636c6552657175657374446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c22706f6c6963794661637473446967657374223a2233333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333227d2c227265636f76657279223a7b2261646170746572436f6e66696775726174696f6e446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c226361706162696c6974794e616d65223a226361702e63222c226465636973696f6e223a22414c4c4f575f5245434f56455259222c226f62736572766174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303137222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f70656e52656365697074446967657374223a2234343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434222c22706f6c6963794964656e74697479223a7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c22706f6c69637956657273696f6e223a22312e322e33227d2c2270726f6a6563744661637473446967657374223a2235353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535222c227472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303231227d2c227374617465223a225245434f564552595f50454e44494e47227d2c7b226361706162696c6974794e616d65223a226361702e64222c226f70656e696e67223a7b226379636c6552657175657374446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c22706f6c6963794661637473446967657374223a2233333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333227d2c2270726f6265223a7b2270726f62654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303263222c227265636f76657279446967657374223a2234343336333738386364623931663666363130623861393937376531356531336566636330306662343136626561346639653837653664333166666135373535222c22737461727465644174223a22323032362d30382d33315430313a30303a30322e3030305a227d2c227265636f76657279223a7b2261646170746572436f6e66696775726174696f6e446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c226361706162696c6974794e616d65223a226361702e64222c226465636973696f6e223a22414c4c4f575f5245434f56455259222c226f62736572766174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303138222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f70656e52656365697074446967657374223a2234343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434222c22706f6c6963794964656e74697479223a7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c22706f6c69637956657273696f6e223a22312e322e33227d2c2270726f6a6563744661637473446967657374223a2235353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535222c227472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303232227d2c227374617465223a2250524f42455f494e5f464c49474854227d2c7b226361706162696c6974794e616d65223a226361702e65222c22636f6d706c6574696f6e223a7b2266696e69736865644174223a22323032362d30382d33315430313a30303a30332e3030305a222c226f7574636f6d65223a22535543434545444544222c2270726f62654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303264222c227265636f76657279446967657374223a2263333935363431303166666538613937613332666566663164623631363238303235376339383431323230643230343838373464393638363036653538646331222c22737461727465644174223a22323032362d30382d33315430313a30303a30322e3030305a227d2c226f70656e696e67223a7b226379636c6552657175657374446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c22706f6c6963794661637473446967657374223a2233333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333227d2c2270726f6265223a7b2270726f62654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303264222c227265636f76657279446967657374223a2263333935363431303166666538613937613332666566663164623631363238303235376339383431323230643230343838373464393638363036653538646331222c22737461727465644174223a22323032362d30382d33315430313a30303a30322e3030305a227d2c227265636f76657279223a7b2261646170746572436f6e66696775726174696f6e446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c226361706162696c6974794e616d65223a226361702e65222c226465636973696f6e223a22414c4c4f575f5245434f56455259222c226f62736572766174696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303139222c226f627365727665644174223a22323032362d30382d33315430313a30303a30312e3030305a222c226f70656e52656365697074446967657374223a2234343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434343434222c22706f6c6963794964656e74697479223a7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c22706f6c69637956657273696f6e223a22312e322e33227d2c2270726f6a6563744661637473446967657374223a2235353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535353535222c227472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303233227d2c227374617465223a22434c4f5345445f5245434f5645524544227d5d2c226b696e64223a224b4e4f574e227d2c22736368656d6156657273696f6e223a22627265616b65722d726563656970742f7631222c2273657373696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033227d0a",
    digest: "8dbf5e8dbbaf7a5ed802de63ed446f9b056e79e2ab1f31073a367d318268f988",
  },
  {
    text: '{"adapterConfigurationDigest":"1111111111111111111111111111111111111111111111111111111111111111","cycleId":"01900000-0000-7000-8000-000000000002","cycleRequestDigest":"2222222222222222222222222222222222222222222222222222222222222222","operations":[],"policyFactsDigest":"3333333333333333333333333333333333333333333333333333333333333333","policyIdentity":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","policyVersion":"1.2.3"},"priorReceiptDigest":null,"result":{"blockedCapabilityNames":["cap.a","cap.b","cap.c","cap.d","cap.e"],"kind":"UNKNOWN","reason":"HISTORY_UNPROVEN"},"schemaVersion":"breaker-receipt/v1","sessionId":"01900000-0000-7000-8000-000000000003"}\n',
    frameHex:
      "6f726368657374726174696f6e2d706c6174666f726d00627265616b65722d726563656970742f763100000000010700000000000002a17b2261646170746572436f6e66696775726174696f6e446967657374223a2231313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131222c226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c226379636c6552657175657374446967657374223a2232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232222c226f7065726174696f6e73223a5b5d2c22706f6c6963794661637473446967657374223a2233333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333222c22706f6c6963794964656e74697479223a7b22616461707465724964223a22666978747572652e61646170746572222c226164617074657256657273696f6e223a22312e322e33222c22706f6c69637956657273696f6e223a22312e322e33227d2c227072696f7252656365697074446967657374223a6e756c6c2c22726573756c74223a7b22626c6f636b65644361706162696c6974794e616d6573223a5b226361702e61222c226361702e62222c226361702e63222c226361702e64222c226361702e65225d2c226b696e64223a22554e4b4e4f574e222c22726561736f6e223a22484953544f52595f554e50524f56454e227d2c22736368656d6156657273696f6e223a22627265616b65722d726563656970742f7631222c2273657373696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303033227d0a",
    digest: "e3b3e322d81e9f0cf4b715be7a209c0c2115ff1bcfde7d52b14dd2b9d6b3a514",
  },
] as const;
const recoveryGolden = {
  text: '{"adapterConfigurationDigest":"1111111111111111111111111111111111111111111111111111111111111111","capabilityName":"cap.c","decision":"ALLOW_RECOVERY","observationId":"01900000-0000-7000-8000-000000000017","observedAt":"2026-08-31T01:00:01.000Z","openReceiptDigest":"4444444444444444444444444444444444444444444444444444444444444444","policyIdentity":{"adapterId":"fixture.adapter","adapterVersion":"1.2.3","policyVersion":"1.2.3"},"projectFactsDigest":"5555555555555555555555555555555555555555555555555555555555555555","transactionId":"01900000-0000-7000-8000-000000000021"}\n',
  digest: "34ca1e9625e752124fb2aca5722a9389d864f41db1b2c7ccc61a2187ded2261e",
} as const;
const base = {
  provenance: {
    adapterId: "fixture.adapter",
    capabilityNames: ["work.read"],
    fieldSources: {
      adapterId: "PROJECT",
      capabilityNames: "PROJECT",
      leaseFreshnessMs: "PROJECT",
      maximumSessionMs: "PROJECT",
      projectId: "PROJECT",
      stateRoot: "DEFAULT",
      wallClockSkewMs: "PROJECT",
    },
    leaseFreshnessMs: 30000,
    maximumSessionMs: 3600000,
    projectId: "01900000-0000-7000-8000-000000000001",
    projectRoot: "<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>",
    schemaVersion: "configuration-provenance/v1",
    stateRoot: "<redacted:path:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc>",
    wallClockSkewMs: 1000,
  },
  config: {
    adapterId: "fixture.adapter",
    adapterVersion: "1.2.3",
    capabilityNames: ["work.read"],
    engineVersion: "0.0.0",
    projectId: "01900000-0000-7000-8000-000000000001",
    schemaVersion: "adapter-configuration/v1",
  },
  cycle: {
    adapterId: "fixture.adapter",
    allowedModuleIds: ["fixture.module"],
    cycleId: "01900000-0000-7000-8000-000000000002",
    schemaVersion: "cycle-request/v1",
    sessionRequest: {
      configurationPathsDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      configurationProvenanceDigest:
        "6cb88ecc36a83f0d147de82f0d55aa9c92ad9d39f743ab8698cf943fdaf99e81",
      configurationSourceDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      schemaVersion: "session-acquire-request/v1",
      sessionId: "01900000-0000-7000-8000-000000000003",
    },
  },
  facts: {
    adapterConfigurationDigest: "fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e",
    frontier: [
      {
        capabilityNames: ["work.read"],
        immutableSubjectDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        readiness: "READY",
        workId: "01900000-0000-7000-8000-000000000006",
      },
    ],
    frontierDigest: "be1257aa95540aa8705749b0f9fa957ab0c48423edfb1f38ceb2d8cdcc13b208",
    observationId: "01900000-0000-7000-8000-000000000004",
    observedAt: "2026-08-31T01:00:00.000Z",
    projectId: "01900000-0000-7000-8000-000000000001",
    schemaVersion: "project-facts/v1",
    state: "COMPLETE",
  },
  policy: {
    adapterConfigurationDigest: "fdb2763d47c9b45410b5520d9dc61152a19ac4a23f65c4468d4e15bfc969cd8e",
    decisions: [
      {
        capabilityName: "work.read",
        trip: "NO_TRIP",
      },
    ],
    observationId: "01900000-0000-7000-8000-000000000005",
    observedAt: "2026-08-31T01:00:00.001Z",
    policyVersion: "1.2.3",
    projectFactsDigest: "e14233846527d3cb531b6937e555caa53cdbfc410909ce5da5579c5caf2e550d",
    projectId: "01900000-0000-7000-8000-000000000001",
    schemaVersion: "project-breaker-facts/v1",
    state: "COMPLETE",
  },
};

const schema = "breaker-receipt/v1";
const fresh = () => JSON.parse(JSON.stringify(base));
const literal = () => JSON.parse(goldens[0].text);
const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function refresh(v: ReturnType<typeof fresh>) {
  const digest = c.canonicalDigest(v.config);
  v.facts.adapterConfigurationDigest = digest;
  v.facts.projectId = v.config.projectId;
  v.facts.frontierDigest = c.canonicalDigest(v.facts.frontier);
  v.policy.adapterConfigurationDigest = digest;
  v.policy.projectId = v.config.projectId;
  v.policy.projectFactsDigest = c.canonicalDigest(v.facts);
  v.cycle.adapterId = v.config.adapterId;
  v.cycle.sessionRequest.configurationProvenanceDigest = c.canonicalDigest(v.provenance);
  return v;
}
function context(n = 20, names = ["work.read"], trip = "NO_TRIP") {
  const v = fresh();
  v.config.capabilityNames = [...names];
  v.provenance.capabilityNames = [...names];
  v.facts.frontier[0].capabilityNames = [...names];
  v.policy.decisions = names.map((capabilityName) => ({ capabilityName, trip }));
  v.cycle.cycleId = id(n);
  v.facts.observationId = id(n + 100);
  v.policy.observationId = id(n + 200);
  return refresh(v);
}
function receipt(
  v: ReturnType<typeof fresh>,
  prior: ReturnType<typeof literal> | null,
  capabilities: unknown[],
  operations: unknown[] = [],
): ReturnType<typeof literal> {
  return {
    adapterConfigurationDigest: c.canonicalDigest(v.config),
    cycleId: v.cycle.cycleId,
    cycleRequestDigest: c.computeCycleRequestDigest(v.cycle),
    operations,
    policyFactsDigest: c.canonicalDigest(v.policy),
    policyIdentity: {
      adapterId: v.config.adapterId,
      adapterVersion: v.config.adapterVersion,
      policyVersion: v.policy.policyVersion,
    },
    priorReceiptDigest: prior === null ? null : c.computeBreakerReceiptDigest(prior),
    result: { capabilities, kind: "KNOWN" },
    schemaVersion: schema,
    sessionId: v.cycle.sessionRequest.sessionId,
  };
}
function unknownReceipt(
  v: ReturnType<typeof fresh>,
  prior: ReturnType<typeof literal> | null,
  reason: string,
  operations: unknown[] = [],
) {
  const names: string[] = [
    ...v.config.capabilityNames,
    ...(prior?.result.kind === "KNOWN"
      ? prior.result.capabilities.map((row: { capabilityName: string }) => row.capabilityName)
      : []),
  ];
  return {
    ...receipt(v, prior, [], operations),
    result: { blockedCapabilityNames: [...new Set(names)].sort(), kind: "UNKNOWN", reason },
  };
}
const opening = (v: ReturnType<typeof fresh>) => ({
  cycleRequestDigest: c.computeCycleRequestDigest(v.cycle),
  policyFactsDigest: c.canonicalDigest(v.policy),
});
function initial(v: ReturnType<typeof fresh>) {
  return receipt(
    v,
    null,
    v.policy.decisions.map((row: { capabilityName: string; trip: string }) =>
      row.trip === "TRIP"
        ? { capabilityName: row.capabilityName, opening: opening(v), state: "OPEN" }
        : { capabilityName: row.capabilityName, state: "CLOSED" },
    ),
  );
}
function bind(
  v: ReturnType<typeof fresh>,
  prior: ReturnType<typeof literal> | null,
  value: unknown,
) {
  return c.validateBreakerReceiptBinding(
    v.provenance,
    v.config,
    v.cycle,
    v.facts,
    v.policy,
    prior,
    value,
  );
}
function permission(
  v: ReturnType<typeof fresh>,
  prior: ReturnType<typeof literal>,
  decision = "ALLOW_RECOVERY",
) {
  return {
    adapterConfigurationDigest: c.canonicalDigest(v.config),
    capabilityName: "work.read",
    decision,
    observationId: id(500),
    observedAt: "2026-08-31T01:00:01.000Z",
    openReceiptDigest: c.computeBreakerReceiptDigest(prior),
    policyIdentity: {
      adapterId: v.config.adapterId,
      adapterVersion: v.config.adapterVersion,
      policyVersion: v.policy.policyVersion,
    },
    projectFactsDigest: c.canonicalDigest(v.facts),
    transactionId: id(1000),
  };
}
const operation = (kind: string, observation: unknown, capabilityName = "work.read") => ({
  capabilityName,
  kind,
  observation,
});
function scenario() {
  const startContext = context(20, ["work.read"], "TRIP");
  const open = initial(startContext);
  const recoveryContext = context(21);
  const recovery = permission(recoveryContext, open);
  const pending = receipt(
    recoveryContext,
    open,
    [
      {
        capabilityName: "work.read",
        opening: opening(startContext),
        recovery,
        state: "RECOVERY_PENDING",
      },
    ],
    [operation("REQUEST_RECOVERY", recovery)],
  );
  const probeContext = context(22);
  const probe = {
    probeId: id(2000),
    recoveryDigest: c.computeBreakerRecoveryDigest(recovery),
    startedAt: "2026-08-31T01:00:02.000Z",
  };
  const flight = receipt(
    probeContext,
    pending,
    [{ ...(pending.result.capabilities[0] as object), probe, state: "PROBE_IN_FLIGHT" }],
    [operation("START_PROBE", probe)],
  );
  const finishContext = context(23);
  const completion = { ...probe, finishedAt: "2026-08-31T01:00:03.000Z", outcome: "SUCCEEDED" };
  const recovered = receipt(
    finishContext,
    flight,
    [{ ...(flight.result.capabilities[0] as object), completion, state: "CLOSED_RECOVERED" }],
    [operation("FINISH_PROBE", completion)],
  );
  return {
    startContext,
    open,
    recoveryContext,
    recovery,
    pending,
    probeContext,
    probe,
    flight,
    finishContext,
    completion,
    recovered,
  };
}
function rejectsKnown(
  v: ReturnType<typeof fresh>,
  prior: ReturnType<typeof literal> | null,
  value: unknown,
) {
  expect(c.parseBreakerReceipt(value).ok).toBe(true);
  expect(bind(v, prior, value).ok).toBe(false);
}
function at(value: ReturnType<typeof literal>, path: readonly (string | number)[]) {
  for (const key of path) value = value[key];
  return value;
}

test("pins KNOWN with all five checkpoints/three operations and global UNKNOWN bytes, frames and identities", () => {
  expect(c.breakerReceiptSchemaVersions).toEqual([schema]);
  expect(c.parseBreakerReceiptContract("breaker-receipt/v2", literal())).toBeNull();
  for (const golden of goldens) {
    const value = JSON.parse(golden.text);
    const bytes = new TextEncoder().encode(golden.text);
    expect(c.parseBreakerReceipt(value)).toEqual({ ok: true, value });
    expect(c.parseContract(schema, value)).toEqual({ ok: true, value });
    expect(c.parseBreakerReceiptContract(schema, value)).toEqual({ ok: true, value });
    expect(c.serializeContract(schema, value)).toEqual({ ok: true, bytes, digest: golden.digest });
    expect(c.computeBreakerReceiptDigest(value)).toBe(golden.digest);
    expect(Buffer.from(c.framedBytes(schema, [c.frame.canonical(value)]))).toEqual(
      Buffer.from(golden.frameHex, "hex"),
    );
    expect(hash(Buffer.from(golden.frameHex, "hex"))).toBe(golden.digest);
    expect(hash(golden.text)).not.toBe(golden.digest);
    expect(c.parseCanonicalContractBytes(schema, bytes)).toEqual({ ok: true, value });
    expect(
      c.serializeContract(schema, Object.fromEntries(Object.entries(value).reverse())),
    ).toEqual({ ok: true, bytes, digest: golden.digest });
    for (const bad of [
      golden.text.trimEnd(),
      golden.text.replace(/\n$/, "\r\n"),
      "\ufeff" + golden.text,
      JSON.stringify(Object.fromEntries(Object.entries(value).reverse())) + "\n",
    ])
      expect(c.parseCanonicalContractBytes(schema, new TextEncoder().encode(bad)).ok).toBe(false);
    expect(c.parseBreakerReceipt({ ...value, schemaVersion: "breaker-receipt/v2" }).ok).toBe(false);
    const frame = Buffer.from(golden.frameHex, "hex"),
      prefix = Buffer.byteLength("orchestration-platform\0breaker-receipt/v1\0");
    for (const offset of [0, prefix + 3, prefix + 4, frame.length - 1]) {
      const bad = Buffer.from(frame);
      bad[offset] = bad[offset]! ^ 1;
      expect(hash(bad)).not.toBe(golden.digest);
    }
  }
  const recovery = JSON.parse(recoveryGolden.text);
  expect(c.canonicalJson(recovery)).toBe(recoveryGolden.text);
  expect(c.computeBreakerRecoveryDigest(recovery)).toBe(recoveryGolden.digest);
  expect(hash(recoveryGolden.text)).toBe(recoveryGolden.digest);
});

test("closed member/type/null census covers envelope, every checkpoint and nested operation record", () => {
  const paths: Array<readonly (string | number)[]> = [
    [],
    ["policyIdentity"],
    ["result"],
    ...[0, 1, 2, 3, 4].map((n) => ["result", "capabilities", n] as const),
    ["result", "capabilities", 1, "opening"],
    ["result", "capabilities", 2, "recovery"],
    ["result", "capabilities", 2, "recovery", "policyIdentity"],
    ["result", "capabilities", 3, "probe"],
    ["result", "capabilities", 4, "completion"],
    ["operations", 0],
    ["operations", 0, "observation"],
    ["operations", 1, "observation"],
    ["operations", 2, "observation"],
  ];
  for (const path of paths) {
    const seed = literal();
    const row = at(seed, path);
    const extra = structuredClone(seed);
    at(extra, path).extra = true;
    expect(c.parseBreakerReceipt(extra).ok, `${path.join(".")}:extra`).toBe(false);
    for (const key of Object.keys(row))
      for (const mode of ["missing", "null", "type"] as const) {
        if (path.length === 0 && key === "priorReceiptDigest" && mode === "null") continue;
        const changed = structuredClone(seed);
        const target = at(changed, path);
        if (mode === "missing") delete target[key];
        if (mode === "null") target[key] = null;
        if (mode === "type") target[key] = typeof target[key] === "string" ? 42 : "wrong-type";
        expect(c.parseBreakerReceipt(changed).ok, `${path.join(".")}:${key}:${mode}`).toBe(false);
      }
  }
  const unknown = JSON.parse(goldens[1].text);
  for (const key of Object.keys(unknown.result)) {
    const bad = structuredClone(unknown);
    delete bad.result[key];
    expect(c.parseBreakerReceipt(bad).ok).toBe(false);
  }
  for (const extra of [
    { ...unknown.result, capabilities: [] },
    { ...literal().result, blockedCapabilityNames: [] },
    { ...unknown.result, reason: "PROBE_FAILED" },
    { ...unknown.result, blockedCapabilityNames: null },
  ])
    expect(c.parseBreakerReceipt({ ...unknown, result: extra }).ok).toBe(false);
  expect(c.parseBreakerReceipt({ ...unknown, priorReceiptDigest: null }).ok).toBe(true);
});

test("bounded sorted capability, operation and blocked-name censuses refuse duplicates and holes", () => {
  for (const count of [0, 1, 256, 257]) {
    const value = literal();
    value.result.capabilities = Array.from({ length: count }, (_, n) => ({
      capabilityName: `cap.a${String(n).padStart(3, "0")}`,
      state: "CLOSED",
    }));
    value.operations = [];
    expect(c.parseBreakerReceipt(value).ok, `checkpoints:${count}`).toBe(count <= 256);
    value.result.capabilities = [];
    value.operations = Array.from({ length: count }, (_, n) =>
      operation(
        "START_PROBE",
        literal().operations[1].observation,
        `cap.a${String(n).padStart(3, "0")}`,
      ),
    );
    expect(c.parseBreakerReceipt(value).ok, `operations:${count}`).toBe(count <= 256);
  }
  for (const count of [0, 1, 256, 512, 513]) {
    const value = JSON.parse(goldens[1].text);
    value.result.blockedCapabilityNames = Array.from(
      { length: count },
      (_, n) => `cap.a${String(n).padStart(3, "0")}`,
    );
    expect(c.parseBreakerReceipt(value).ok, `unknown:${count}`).toBe(count <= 512);
  }
  for (const field of ["operations", "capabilities", "blockedCapabilityNames"]) {
    const value = field === "blockedCapabilityNames" ? JSON.parse(goldens[1].text) : literal();
    const parent = field === "operations" ? value : value.result;
    parent[field].reverse();
    expect(c.parseBreakerReceipt(value).ok).toBe(false);
    parent[field].reverse();
    parent[field].push(parent[field][0]);
    expect(c.parseBreakerReceipt(value).ok).toBe(false);
    parent[field] = new Array(1);
    expect(c.parseBreakerReceipt(value).ok).toBe(false);
  }
  const empty = context(20, []);
  expect(bind(empty, null, initial(empty)).ok).toBe(true);
  const full = context(
    20,
    Array.from({ length: 256 }, (_, n) => `cap.a${String(n).padStart(3, "0")}`),
  );
  expect(bind(full, null, initial(full)).ok).toBe(true);
  const missing = initial(full);
  missing.result.capabilities.pop();
  rejectsKnown(full, null, missing);
});

test("closed observation decisions, probe outcomes, scalar bounds and inclusive times", () => {
  const s = scenario();
  for (const decision of ["ALLOW_RECOVERY", "KEEP_HOLD", "UNAVAILABLE", "UNKNOWN"])
    expect(c.parseBreakerRecoveryObservation({ ...s.recovery, decision }).ok).toBe(true);
  for (const decision of ["NO_TRIP", "ALLOW", null, true])
    expect(c.parseBreakerRecoveryObservation({ ...s.recovery, decision }).ok).toBe(false);
  expect(() => c.computeBreakerRecoveryDigest({ ...s.recovery, decision: "KEEP_HOLD" })).toThrow();
  for (const outcome of ["SUCCEEDED", "FAILED", "UNKNOWN"])
    expect(c.parseBreakerProbeCompletion({ ...s.completion, outcome }).ok).toBe(true);
  expect(
    c.parseBreakerProbeCompletion({ ...s.completion, finishedAt: s.completion.startedAt }).ok,
  ).toBe(true);
  for (const bad of [
    { ...s.completion, outcome: "SUCCESS" },
    { ...s.completion, finishedAt: "2026-08-31T01:00:01.999Z" },
    { ...s.completion, finishedAt: null },
    { ...s.completion, startedAt: "2026-02-30T00:00:00.000Z" },
    { ...s.completion, probeId: "not-a-uuid" },
  ])
    expect(c.parseBreakerProbeCompletion(bad).ok).toBe(false);
  for (const length of [1, 64, 65, 0]) {
    const value = literal();
    value.operations = [];
    value.result.capabilities = [{ capabilityName: "a".repeat(length), state: "CLOSED" }];
    expect(c.parseBreakerReceipt(value).ok).toBe(length > 0 && length <= 64);
  }
  for (const bad of ["fixture.adapter\n", "a".repeat(129), ""]) {
    const value = literal();
    value.policyIdentity.adapterId = bad;
    expect(c.parseBreakerReceipt(value).ok).toBe(false);
  }
  const maxId = literal();
  maxId.policyIdentity.adapterId = "a".repeat(128);
  expect(c.parseBreakerReceipt(maxId).ok).toBe(true);
  for (const bad of ["01.2.3", "1.2.3\n", "1.2." + "1".repeat(60)]) {
    const value = literal();
    value.policyIdentity.policyVersion = bad;
    expect(c.parseBreakerReceipt(value).ok).toBe(false);
  }
  for (const key of [
    "adapterConfigurationDigest",
    "cycleRequestDigest",
    "policyFactsDigest",
    "priorReceiptDigest",
  ]) {
    const value = literal();
    value[key] = "a".repeat(63);
    expect(c.parseBreakerReceipt(value).ok).toBe(false);
  }
  const openRequest = {
    adapterConfiguration: s.recoveryContext.config,
    capabilityName: "work.read",
    observationId: s.recovery.observationId,
    openReceipt: s.open,
    policyIdentity: s.recovery.policyIdentity,
    projectFacts: s.recoveryContext.facts,
    transactionId: s.recovery.transactionId,
  };
  expect(c.parseBreakerRecoveryRequest(openRequest).ok).toBe(true);
  expect(c.parseBreakerRecoveryRequest({ ...openRequest, openReceipt: s.pending }).ok).toBe(false);
  expect(c.parseBreakerRecoveryRequest({ ...openRequest, capabilityName: "work.other" }).ok).toBe(
    false,
  );
  expect(c.parseBreakerRecoveryRequest({ ...openRequest, permission: true }).ok).toBe(false);
});

test("every known checkpoint advances one recovery phase and a recovered capability waits for a fresh cycle", () => {
  const s = scenario();
  for (const [v, prior, result] of [
    [s.startContext, null, s.open],
    [s.recoveryContext, s.open, s.pending],
    [s.probeContext, s.pending, s.flight],
    [s.finishContext, s.flight, s.recovered],
  ] as const)
    expect(bind(v, prior, result)).toEqual({ ok: true, value: result });
  for (const trip of ["TRIP", "NO_TRIP"]) {
    const next = context(24, ["work.read"], trip);
    const output = receipt(next, s.recovered, [
      trip === "TRIP"
        ? { capabilityName: "work.read", opening: opening(next), state: "OPEN" }
        : { capabilityName: "work.read", state: "CLOSED" },
    ]);
    expect(bind(next, s.recovered, output).ok).toBe(true);
    const sameCycle = context(23, ["work.read"], trip);
    rejectsKnown(
      sameCycle,
      s.recovered,
      receipt(sameCycle, s.recovered, output.result.capabilities),
    );
  }
  const premature = receipt(
    s.finishContext,
    s.flight,
    [{ capabilityName: "work.read", state: "CLOSED" }],
    s.recovered.operations,
  );
  rejectsKnown(s.finishContext, s.flight, premature);
  const inclusive = structuredClone(s.flight);
  inclusive.result.capabilities[0].probe.startedAt = s.recovery.observedAt;
  inclusive.operations[0].observation.startedAt = s.recovery.observedAt;
  expect(bind(s.probeContext, s.pending, inclusive).ok).toBe(true);
});

test("NO_TRIP never clears held phases; failed completion reopens with the original opening", () => {
  const s = scenario();
  for (const prior of [s.open, s.pending, s.flight])
    for (const trip of ["TRIP", "NO_TRIP"]) {
      const v = context(30, ["work.read"], trip);
      expect(bind(v, prior, receipt(v, prior, prior.result.capabilities)).ok).toBe(true);
      rejectsKnown(v, prior, receipt(v, prior, [{ capabilityName: "work.read", state: "CLOSED" }]));
    }
  const closedContext = context(10),
    closed = initial(closedContext);
  for (const trip of ["TRIP", "NO_TRIP"]) {
    const v = context(11, ["work.read"], trip);
    const output = initial(v);
    output.priorReceiptDigest = c.computeBreakerReceiptDigest(closed);
    expect(bind(v, closed, output).ok).toBe(true);
  }
  const failed = { ...s.completion, outcome: "FAILED" };
  const reopened = receipt(s.finishContext, s.flight, s.open.result.capabilities, [
    operation("FINISH_PROBE", failed),
  ]);
  expect(bind(s.finishContext, s.flight, reopened).ok).toBe(true);
  expect(reopened.operations).toEqual([operation("FINISH_PROBE", failed)]);
  const changed = structuredClone(reopened);
  (changed.result.capabilities[0] as ReturnType<typeof literal>).opening.policyFactsDigest =
    "9".repeat(64);
  rejectsKnown(s.finishContext, s.flight, changed);
  const hold = permission(s.recoveryContext, s.open, "KEEP_HOLD");
  expect(
    bind(
      s.recoveryContext,
      s.open,
      receipt(s.recoveryContext, s.open, s.open.result.capabilities, [
        operation("REQUEST_RECOVERY", hold),
      ]),
    ).ok,
  ).toBe(true);
});

test("UNKNOWN reason matrix and precedence retain all known affected capabilities", () => {
  const s = scenario();
  const history = unknownReceipt(s.recoveryContext, s.open, "HISTORY_UNPROVEN");
  expect(bind(s.recoveryContext, s.open, history).ok).toBe(true);
  const changed = context(21, ["work.other"]);
  const configUnknown = unknownReceipt(changed, s.open, "CONFIGURATION_CHANGED");
  expect(bind(changed, s.open, configUnknown).ok).toBe(true);
  expect(configUnknown.result.blockedCapabilityNames).toEqual(["work.other", "work.read"]);
  const lost = structuredClone(configUnknown);
  lost.result.blockedCapabilityNames = ["work.other"];
  expect(bind(changed, s.open, lost).ok).toBe(false);
  changed.policy.policyVersion = "2.0.0";
  expect(bind(changed, s.open, unknownReceipt(changed, s.open, "CONFIGURATION_CHANGED")).ok).toBe(
    true,
  );
  expect(bind(changed, s.open, unknownReceipt(changed, s.open, "POLICY_CHANGED")).ok).toBe(false);
  for (const field of ["adapterId", "adapterVersion", "policyVersion"]) {
    const prior = structuredClone(s.open);
    prior.policyIdentity[field] = field === "adapterId" ? "fixture.other" : "2.0.0";
    expect(
      bind(s.recoveryContext, prior, unknownReceipt(s.recoveryContext, prior, "POLICY_CHANGED")).ok,
      field,
    ).toBe(true);
  }
  for (const [state, reason, expected] of [
    ["UNAVAILABLE", "SOURCE_UNAVAILABLE", "INPUT_UNAVAILABLE"],
    ["UNKNOWN", "SOURCE_UNKNOWN", "INPUT_UNKNOWN"],
  ]) {
    const v = context(21);
    delete v.policy.decisions;
    v.policy.state = state;
    v.policy.reason = reason;
    expect(bind(v, s.open, unknownReceipt(v, s.open, expected!)).ok).toBe(true);
  }
  for (const [decision, reason] of [
    ["UNAVAILABLE", "RECOVERY_UNAVAILABLE"],
    ["UNKNOWN", "RECOVERY_UNKNOWN"],
  ]) {
    const observations = [
      operation("REQUEST_RECOVERY", permission(s.recoveryContext, s.open, decision)),
    ];
    expect(
      bind(
        s.recoveryContext,
        s.open,
        unknownReceipt(s.recoveryContext, s.open, reason!, observations),
      ).ok,
    ).toBe(true);
  }
  const unknownProbe = [operation("FINISH_PROBE", { ...s.completion, outcome: "UNKNOWN" })];
  expect(
    bind(
      s.finishContext,
      s.flight,
      unknownReceipt(s.finishContext, s.flight, "PROBE_UNKNOWN", unknownProbe),
    ).ok,
  ).toBe(true);
  expect(
    bind(s.finishContext, s.flight, unknownReceipt(s.finishContext, s.flight, "PROBE_UNKNOWN")).ok,
  ).toBe(true);
  const later = context(40);
  expect(bind(later, history, unknownReceipt(later, history, "HISTORY_UNPROVEN")).ok).toBe(false);
  expect(
    bind(s.startContext, null, unknownReceipt(s.startContext, null, "HISTORY_UNPROVEN")).ok,
  ).toBe(true);
  const falseInput = unknownReceipt(s.recoveryContext, s.open, "INPUT_UNKNOWN");
  expect(bind(s.recoveryContext, s.open, falseInput).ok).toBe(false);
});

test("wrong phase, wrong capability and mismatched recovery/probe observations become global UNKNOWN", () => {
  const s = scenario();
  const closed = initial(context(10));
  const current = context(50);
  const possible = {
    REQUEST_RECOVERY: s.recovery,
    START_PROBE: s.probe,
    FINISH_PROBE: s.completion,
  };
  const allowed: Record<string, string> = {
    OPEN: "REQUEST_RECOVERY",
    RECOVERY_PENDING: "START_PROBE",
    PROBE_IN_FLIGHT: "FINISH_PROBE",
  };
  for (const prior of [closed, s.open, s.pending, s.flight, s.recovered])
    for (const kind of Object.keys(possible) as Array<keyof typeof possible>) {
      const state = (prior.result.capabilities[0] as ReturnType<typeof literal>).state;
      if (allowed[state] === kind) continue;
      const observation = kind === "REQUEST_RECOVERY" ? permission(current, prior) : possible[kind];
      const ops = [operation(kind, observation)];
      expect(
        bind(current, prior, unknownReceipt(current, prior, "INVALID_TRANSITION", ops)).ok,
        `${state}:${kind}`,
      ).toBe(true);
    }
  const wrongCapability = [operation("START_PROBE", s.probe, "work.other")];
  expect(
    bind(
      current,
      s.pending,
      unknownReceipt(current, s.pending, "INVALID_TRANSITION", wrongCapability),
    ).ok,
  ).toBe(true);
  const changes: Array<[string, (value: ReturnType<typeof literal>) => void]> = [
    [
      "configuration",
      (v) => {
        v.adapterConfigurationDigest = "9".repeat(64);
      },
    ],
    [
      "capability",
      (v) => {
        v.capabilityName = "work.other";
      },
    ],
    [
      "opening",
      (v) => {
        v.openReceiptDigest = "9".repeat(64);
      },
    ],
    [
      "snapshot",
      (v) => {
        v.projectFactsDigest = "9".repeat(64);
      },
    ],
    [
      "adapter",
      (v) => {
        v.policyIdentity.adapterId = "fixture.other";
      },
    ],
    [
      "adapter version",
      (v) => {
        v.policyIdentity.adapterVersion = "2.0.0";
      },
    ],
    [
      "policy version",
      (v) => {
        v.policyIdentity.policyVersion = "2.0.0";
      },
    ],
    [
      "snapshot observation",
      (v) => {
        v.observationId = s.recoveryContext.facts.observationId;
      },
    ],
    [
      "policy observation",
      (v) => {
        v.observationId = s.recoveryContext.policy.observationId;
      },
    ],
  ];
  for (const [name, change] of changes) {
    const observed = structuredClone(s.recovery);
    change(observed);
    const output = unknownReceipt(s.recoveryContext, s.open, "INVALID_TRANSITION", [
      operation("REQUEST_RECOVERY", observed),
    ]);
    expect(c.parseBreakerReceipt(output).ok, name).toBe(true);
    expect(bind(s.recoveryContext, s.open, output).ok, name).toBe(true);
  }
  for (const change of [
    (v: ReturnType<typeof literal>) => {
      v.recoveryDigest = "9".repeat(64);
    },
    (v: ReturnType<typeof literal>) => {
      v.startedAt = "2026-08-31T01:00:00.999Z";
    },
  ]) {
    const start = structuredClone(s.probe);
    change(start);
    expect(
      bind(
        s.probeContext,
        s.pending,
        unknownReceipt(s.probeContext, s.pending, "INVALID_TRANSITION", [
          operation("START_PROBE", start),
        ]),
      ).ok,
    ).toBe(true);
  }
  for (const field of ["probeId", "recoveryDigest", "startedAt"]) {
    const completion = {
      ...s.completion,
      [field]:
        field === "probeId"
          ? id(999)
          : field === "recoveryDigest"
            ? "9".repeat(64)
            : "2026-08-31T01:00:02.001Z",
    };
    expect(
      bind(
        s.finishContext,
        s.flight,
        unknownReceipt(s.finishContext, s.flight, "INVALID_TRANSITION", [
          operation("FINISH_PROBE", completion),
        ]),
      ).ok,
      field,
    ).toBe(true);
  }
});

test("receipt/preimage/cycle/step joins and retained transaction/opening bytes resist substitution", () => {
  const s = scenario();
  for (const field of [
    "adapterConfigurationDigest",
    "cycleRequestDigest",
    "policyFactsDigest",
    "priorReceiptDigest",
    "cycleId",
    "sessionId",
  ]) {
    const output = structuredClone(s.pending);
    output[field] = field.endsWith("Id") ? id(999) : "9".repeat(64);
    rejectsKnown(s.recoveryContext, s.open, output);
  }
  for (const field of ["adapterId", "adapterVersion", "policyVersion"]) {
    const output = structuredClone(s.pending);
    output.policyIdentity[field] = field === "adapterId" ? "fixture.other" : "2.0.0";
    rejectsKnown(s.recoveryContext, s.open, output);
  }
  expect(bind(s.recoveryContext, null, s.pending).ok).toBe(false);
  const alias = structuredClone(s.open);
  alias.result.capabilities[0].opening.policyFactsDigest = "9".repeat(64);
  expect(bind(s.recoveryContext, alias, s.pending).ok).toBe(false);
  const changes: Array<[string, (value: ReturnType<typeof literal>) => void]> = [
    [
      "cycle adapter",
      (v) => {
        v.cycle.adapterId = "fixture.other";
      },
    ],
    [
      "cycle provenance",
      (v) => {
        v.cycle.sessionRequest.configurationProvenanceDigest = "9".repeat(64);
      },
    ],
    [
      "provenance",
      (v) => {
        v.provenance.projectId = id(999);
        v.cycle.sessionRequest.configurationProvenanceDigest = c.canonicalDigest(v.provenance);
      },
    ],
    [
      "snapshot identity",
      (v) => {
        v.facts.observedAt = "2026-08-31T01:00:00.002Z";
      },
    ],
    [
      "policy decisions",
      (v) => {
        v.policy.decisions = [];
      },
    ],
  ];
  for (const [name, change] of changes) {
    const v = context(21);
    change(v);
    const output = receipt(v, s.open, s.pending.result.capabilities, s.pending.operations);
    expect(bind(v, s.open, output).ok, name).toBe(false);
  }
  for (const field of ["transactionId", "observationId", "observedAt"]) {
    const output = structuredClone(s.pending);
    (output.result.capabilities[0] as ReturnType<typeof literal>).recovery[field] =
      field === "observedAt" ? "2026-08-31T01:00:01.001Z" : id(999);
    rejectsKnown(s.recoveryContext, s.open, output);
  }
  const movedStart = structuredClone(s.flight);
  (movedStart.result.capabilities[0] as ReturnType<typeof literal>).probe.probeId = id(999);
  rejectsKnown(s.probeContext, s.pending, movedStart);
  const movedCompletion = structuredClone(s.recovered);
  (movedCompletion.result.capabilities[0] as ReturnType<typeof literal>).completion.finishedAt =
    "2026-08-31T01:00:03.001Z";
  rejectsKnown(s.finishContext, s.flight, movedCompletion);
});

test("intrinsic recovery/probe checkpoints enforce permission and exact inline identities", () => {
  for (const change of [
    (v: ReturnType<typeof literal>) => {
      v.result.capabilities[2].recovery.decision = "KEEP_HOLD";
    },
    (v: ReturnType<typeof literal>) => {
      v.result.capabilities[2].recovery.capabilityName = "cap.other";
    },
    (v: ReturnType<typeof literal>) => {
      v.result.capabilities[3].probe.recoveryDigest = "9".repeat(64);
    },
    (v: ReturnType<typeof literal>) => {
      v.result.capabilities[4].completion.outcome = "FAILED";
    },
    (v: ReturnType<typeof literal>) => {
      v.result.capabilities[4].completion.probeId = id(999);
    },
    (v: ReturnType<typeof literal>) => {
      v.result.capabilities[4].completion.recoveryDigest = "9".repeat(64);
    },
    (v: ReturnType<typeof literal>) => {
      v.result.capabilities[4].completion.startedAt = "2026-08-31T01:00:02.001Z";
    },
  ]) {
    const value = literal();
    change(value);
    expect(c.parseBreakerReceipt(value).ok).toBe(false);
  }
});

test("coherent supplied claims cannot prove genesis, full history or non-adjacent reuse", () => {
  const s = scenario();
  // Both known genesis and a history-unproven diagnostic can be structurally bound.
  expect(bind(s.startContext, null, s.open).ok).toBe(true);
  expect(
    bind(s.startContext, null, unknownReceipt(s.startContext, null, "HISTORY_UNPROVEN")).ok,
  ).toBe(true);
  const failed = receipt(s.finishContext, s.flight, s.open.result.capabilities, [
    operation("FINISH_PROBE", { ...s.completion, outcome: "FAILED" }),
  ]);
  const v = context(24),
    reused = permission(v, failed);
  expect(reused.transactionId).toBe(s.recovery.transactionId);
  const claim = receipt(
    v,
    failed,
    [
      {
        capabilityName: "work.read",
        opening: s.open.result.capabilities[0].opening,
        recovery: reused,
        state: "RECOVERY_PENDING",
      },
    ],
    [operation("REQUEST_RECOVERY", reused)],
  );
  expect(bind(v, failed, claim).ok).toBe(true); // Seven supplied records contain no complete-history census.
  const guarded = unknownReceipt(v, failed, "HISTORY_UNPROVEN", claim.operations);
  expect(bind(v, failed, guarded).ok).toBe(true); // The runtime must retain unknown until actual history admission.
  expect(c.parseBreakerReceipt({ ...guarded, historyComplete: true }).ok).toBe(false);
});

test("hostile nested values refuse without invoking input code", () => {
  let calls = 0;
  const values: unknown[] = [];
  const root = literal();
  Object.defineProperty(root, "cycleId", {
    enumerable: true,
    get() {
      calls++;
      return id(2);
    },
  });
  values.push(root);
  const nested = literal();
  Object.defineProperty(nested.result.capabilities[2].recovery, "decision", {
    enumerable: true,
    get() {
      calls++;
      return "ALLOW_RECOVERY";
    },
  });
  values.push(nested);
  const proxy = literal();
  proxy.operations = new Proxy([], {
    ownKeys() {
      calls++;
      return [];
    },
  });
  values.push(proxy);
  const holes = literal();
  holes.result.capabilities = new Array(1);
  values.push(holes);
  const symbol = literal();
  symbol[Symbol("extra")] = true;
  values.push(symbol);
  const exotic = literal();
  exotic.policyIdentity = new Date();
  values.push(exotic);
  for (const value of values) expect(c.parseBreakerReceipt(value).ok).toBe(false);
  expect(calls).toBe(0);
});
