import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import * as contracts from "../../packages/contracts/src/index.js";
import * as entry from "../../packages/contracts/src/cycle-entry.js";
// Each matrix row pins its literal bytes below and the independently authored digest here.
// Authored constants: independent literal UTF-8/.NET SHA256 preparation; no candidate code executed.
const configLiterals = [
  '{"adapterId":"fixture.adapter","capabilityNames":["cap.read"],"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"01900000-0000-7000-8000-000000000004","schemaVersion":"platform-configuration-source/v1","stateRoot":null,"wallClockSkewMs":1000}\n',
  '{"adapterId":"fixture.adapter","capabilityNames":["cap.read"],"fieldSources":{"adapterId":"PROJECT","capabilityNames":"PROJECT","leaseFreshnessMs":"PROJECT","maximumSessionMs":"PROJECT","projectId":"PROJECT","stateRoot":"DEFAULT","wallClockSkewMs":"PROJECT"},"leaseFreshnessMs":30000,"maximumSessionMs":3600000,"projectId":"01900000-0000-7000-8000-000000000004","projectRoot":"<redacted:path:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>","schemaVersion":"configuration-provenance/v1","stateRoot":"<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>","wallClockSkewMs":1000}\n',
  '{"configPath":"<redacted:path:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc>","projectRoot":"<redacted:path:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>","schemaVersion":"configuration-paths/v1","stateRoot":"<redacted:path:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>"}\n',
] as const;
const inputGoldens = [
  [
    "session-acquire-request/v1",
    '{"configurationPathsDigest":"7834e7450cf229794a95eca85c63b00e2147b9dc04e5b15936c26e6421b7735a","configurationProvenanceDigest":"68f259a032cd1ee5067a1701c07edc10e8dea60ed75358803d96f23103bdaac4","configurationSourceDigest":"d344533a93e761fe0422eb3ab275f5183581975bcf1a38bbee38fe5d009c7c88","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000001"}\n',
    "9ec11476d90b556a9826cc3ad2149a7ad8446579009c8b17df1c0d543bc483b7",
    "6f726368657374726174696f6e2d706c6174666f726d0073657373696f6e2d616371756972652d726571756573742f763100000000010700000000000001827b22636f6e66696775726174696f6e5061746873446967657374223a2237383334653734353063663232393739346139356563613835633633623030653231343762396463303465356231353933366332366536343231623737333561222c22636f6e66696775726174696f6e50726f76656e616e6365446967657374223a2236386632353961303332636431656535303637613137303163303765646331306538646561363065643735333538383033643936663233313033626461616334222c22636f6e66696775726174696f6e536f75726365446967657374223a2264333434353333613933653736316665303432326562336162323735663531383335383139373562636631613338626265653338666535643030396337633838222c22736368656d6156657273696f6e223a2273657373696f6e2d616371756972652d726571756573742f7631222c2273657373696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031227d0a",
  ],
  [
    "cycle-request/v1",
    '{"adapterId":"fixture.adapter","allowedModuleIds":["module.a"],"cycleId":"01900000-0000-7000-8000-000000000002","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"7834e7450cf229794a95eca85c63b00e2147b9dc04e5b15936c26e6421b7735a","configurationProvenanceDigest":"68f259a032cd1ee5067a1701c07edc10e8dea60ed75358803d96f23103bdaac4","configurationSourceDigest":"d344533a93e761fe0422eb3ab275f5183581975bcf1a38bbee38fe5d009c7c88","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000001"}}\n',
    "2d631096f04539fb3e08fd52c9af4f8a755ad375db369e9bf5b9e7a44eba43f6",
    "6f726368657374726174696f6e2d706c6174666f726d006379636c652d726571756573742f763100000000010700000000000002277b22616461707465724964223a22666978747572652e61646170746572222c22616c6c6f7765644d6f64756c65496473223a5b226d6f64756c652e61225d2c226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c22736368656d6156657273696f6e223a226379636c652d726571756573742f7631222c2273657373696f6e52657175657374223a7b22636f6e66696775726174696f6e5061746873446967657374223a2237383334653734353063663232393739346139356563613835633633623030653231343762396463303465356231353933366332366536343231623737333561222c22636f6e66696775726174696f6e50726f76656e616e6365446967657374223a2236386632353961303332636431656535303637613137303163303765646331306538646561363065643735333538383033643936663233313033626461616334222c22636f6e66696775726174696f6e536f75726365446967657374223a2264333434353333613933653736316665303432326562336162323735663531383335383139373562636631613338626265653338666535643030396337633838222c22736368656d6156657273696f6e223a2273657373696f6e2d616371756972652d726571756573742f7631222c2273657373696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031227d7d0a",
  ],
  [
    "cycle-plan/v1",
    '{"protocol":"routine-cycle/v1","request":{"adapterId":"fixture.adapter","allowedModuleIds":["module.a"],"cycleId":"01900000-0000-7000-8000-000000000002","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"7834e7450cf229794a95eca85c63b00e2147b9dc04e5b15936c26e6421b7735a","configurationProvenanceDigest":"68f259a032cd1ee5067a1701c07edc10e8dea60ed75358803d96f23103bdaac4","configurationSourceDigest":"d344533a93e761fe0422eb3ab275f5183581975bcf1a38bbee38fe5d009c7c88","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000001"}},"schemaVersion":"cycle-plan/v1"}\n',
    "062fe695522820f449f89876d7f6cc99368417a70f784f3c419f3faec1d5d17a",
    "6f726368657374726174696f6e2d706c6174666f726d006379636c652d706c616e2f763100000000010700000000000002717b2270726f746f636f6c223a22726f7574696e652d6379636c652f7631222c2272657175657374223a7b22616461707465724964223a22666978747572652e61646170746572222c22616c6c6f7765644d6f64756c65496473223a5b226d6f64756c652e61225d2c226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c22736368656d6156657273696f6e223a226379636c652d726571756573742f7631222c2273657373696f6e52657175657374223a7b22636f6e66696775726174696f6e5061746873446967657374223a2237383334653734353063663232393739346139356563613835633633623030653231343762396463303465356231353933366332366536343231623737333561222c22636f6e66696775726174696f6e50726f76656e616e6365446967657374223a2236386632353961303332636431656535303637613137303163303765646331306538646561363065643735333538383033643936663233313033626461616334222c22636f6e66696775726174696f6e536f75726365446967657374223a2264333434353333613933653736316665303432326562336162323735663531383335383139373562636631613338626265653338666535643030396337633838222c22736368656d6156657273696f6e223a2273657373696f6e2d616371756972652d726571756573742f7631222c2273657373696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031227d7d2c22736368656d6156657273696f6e223a226379636c652d706c616e2f7631227d0a",
  ],
  [
    "cycle-request/v1",
    '{"adapterId":"fixture.adapter","allowedModuleIds":[],"cycleId":"01900000-0000-7000-8000-000000000002","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"7834e7450cf229794a95eca85c63b00e2147b9dc04e5b15936c26e6421b7735a","configurationProvenanceDigest":"68f259a032cd1ee5067a1701c07edc10e8dea60ed75358803d96f23103bdaac4","configurationSourceDigest":"d344533a93e761fe0422eb3ab275f5183581975bcf1a38bbee38fe5d009c7c88","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000001"}}\n',
    "7cb150622fe40d00fa7dba572d9f01950979cb543c2603d6bd15033775bbc60e",
    "6f726368657374726174696f6e2d706c6174666f726d006379636c652d726571756573742f7631000000000107000000000000021d7b22616461707465724964223a22666978747572652e61646170746572222c22616c6c6f7765644d6f64756c65496473223a5b5d2c226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c22736368656d6156657273696f6e223a226379636c652d726571756573742f7631222c2273657373696f6e52657175657374223a7b22636f6e66696775726174696f6e5061746873446967657374223a2237383334653734353063663232393739346139356563613835633633623030653231343762396463303465356231353933366332366536343231623737333561222c22636f6e66696775726174696f6e50726f76656e616e6365446967657374223a2236386632353961303332636431656535303637613137303163303765646331306538646561363065643735333538383033643936663233313033626461616334222c22636f6e66696775726174696f6e536f75726365446967657374223a2264333434353333613933653736316665303432326562336162323735663531383335383139373562636631613338626265653338666535643030396337633838222c22736368656d6156657273696f6e223a2273657373696f6e2d616371756972652d726571756573742f7631222c2273657373696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031227d7d0a",
  ],
  [
    "cycle-plan/v1",
    '{"protocol":"routine-cycle/v1","request":{"adapterId":"fixture.adapter","allowedModuleIds":[],"cycleId":"01900000-0000-7000-8000-000000000002","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"7834e7450cf229794a95eca85c63b00e2147b9dc04e5b15936c26e6421b7735a","configurationProvenanceDigest":"68f259a032cd1ee5067a1701c07edc10e8dea60ed75358803d96f23103bdaac4","configurationSourceDigest":"d344533a93e761fe0422eb3ab275f5183581975bcf1a38bbee38fe5d009c7c88","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000001"}},"schemaVersion":"cycle-plan/v1"}\n',
    "ef7967978041d9bf06ad1500e616ff48af9111a133abaf316fc292684f8f53bc",
    "6f726368657374726174696f6e2d706c6174666f726d006379636c652d706c616e2f763100000000010700000000000002677b2270726f746f636f6c223a22726f7574696e652d6379636c652f7631222c2272657175657374223a7b22616461707465724964223a22666978747572652e61646170746572222c22616c6c6f7765644d6f64756c65496473223a5b5d2c226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c22736368656d6156657273696f6e223a226379636c652d726571756573742f7631222c2273657373696f6e52657175657374223a7b22636f6e66696775726174696f6e5061746873446967657374223a2237383334653734353063663232393739346139356563613835633633623030653231343762396463303465356231353933366332366536343231623737333561222c22636f6e66696775726174696f6e50726f76656e616e6365446967657374223a2236386632353961303332636431656535303637613137303163303765646331306538646561363065643735333538383033643936663233313033626461616334222c22636f6e66696775726174696f6e536f75726365446967657374223a2264333434353333613933653736316665303432326562336162323735663531383335383139373562636631613338626265653338666535643030396337633838222c22736368656d6156657273696f6e223a2273657373696f6e2d616371756972652d726571756573742f7631222c2273657373696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031227d7d2c22736368656d6156657273696f6e223a226379636c652d706c616e2f7631227d0a",
  ],
] as const;
const receiptGoldens = [
  ["ACQUIRE", "ACQUIRED", null, "58f178823aba333fb345e687a361abbad5d387c0da83a112de242d5183b06592"],
  [
    "ACQUIRE",
    "REFUSED",
    "SESSION_HELD",
    "9a58a0dfe029c1ef0fe2013d2389aa0578085b848dae2955f50464c149112e0b",
  ],
  [
    "ACQUIRE",
    "REFUSED",
    "SESSION_STALE",
    "f4d1720911bfc41c4dea01cc0fe86d982351471ac32db2761e05dc40c1be39ac",
  ],
  [
    "ACQUIRE",
    "REFUSED",
    "HANDOFF_PENDING",
    "a5b59bd0db0082c590595c4e174c4912f8f7dfcec3001523d347a77aec7dcf48",
  ],
  [
    "ACQUIRE",
    "REFUSED",
    "CONFIGURATION_MISMATCH",
    "5bb88706fe1210b706bb0168a5c5760775ca9122aaeae7acf83c92cd8bf7c345",
  ],
  [
    "ACQUIRE",
    "UNKNOWN",
    "STATE_UNREADABLE",
    "d0c02d13ff76c8f9fcf1ac1e7bde3ad8389cbef92a3402c0b0f48fd7300abc09",
  ],
  [
    "ACQUIRE",
    "UNKNOWN",
    "IDENTITY_CONFLICT",
    "1371bdd95846ac35a46d5577df96badf4570e562bcde6898e9195636e98c2ded",
  ],
  [
    "ACQUIRE",
    "UNKNOWN",
    "CLOCK_ROLLBACK",
    "ff558163c50b8d87ff8f3b23bb9c9b583be90d1d178f9b04d96c389a9c09a2b5",
  ],
  [
    "ACQUIRE",
    "UNKNOWN",
    "CLOCK_SKEW",
    "eab1203e904f36e39b4fe818b8b352004be49adfa8e161142119bb3776291b51",
  ],
  [
    "ACQUIRE",
    "UNKNOWN",
    "MONOTONIC_UNAVAILABLE",
    "6f0db9781f4723be8cde58d341abf1341a6eeb3bb1389352a1a4541735faac1d",
  ],
  ["RENEW", "RENEWED", null, "0fe1038193dbec8ce50f6cdb0bfb545bcbc7aeaa3b1c0656b855fda31879a282"],
  [
    "RENEW",
    "REFUSED",
    "SESSION_NOT_FOUND",
    "9b88bce699dbf2ca6da00c758bce65c022471af5e13d984749cf78621c3ad4bf",
  ],
  [
    "RENEW",
    "REFUSED",
    "SESSION_MISMATCH",
    "8654eae5345605888fd7ec00cd317ed3963f3a15fde66ea59e28884faa9c3ae1",
  ],
  [
    "RENEW",
    "REFUSED",
    "SESSION_RELEASED",
    "b331a359402a847c9dd8be19baf5b0fd0857023de6483c6d09f05bfbcf2cbc92",
  ],
  [
    "RENEW",
    "REFUSED",
    "SESSION_STALE",
    "33f5769071079b9a1837ea004c8945bcc45fc4092f50a136b616d6ec187acb53",
  ],
  [
    "RENEW",
    "REFUSED",
    "DURATION_EXCEEDED",
    "9f3f2c4726faa2f61306fdf6df67dc68ff8a0f1621560b4c47665f13e9b902c2",
  ],
  [
    "RENEW",
    "REFUSED",
    "HANDOFF_PENDING",
    "e1ed54c49a78ed9904312e218e59adf8fd0dc7c26a8d4c5617c3a1c13a13ab9b",
  ],
  [
    "RENEW",
    "REFUSED",
    "CONFIGURATION_MISMATCH",
    "50bbf701c40dfd99aa47558f8854853e07f496ab19537f69921ac1c593b14c02",
  ],
  [
    "RENEW",
    "UNKNOWN",
    "STATE_UNREADABLE",
    "13eab603eb867d7cfd8614c5353761d3b4d80ed6d92e1b6c82f71f3c65c7676f",
  ],
  [
    "RENEW",
    "UNKNOWN",
    "IDENTITY_CONFLICT",
    "cf6687addb34e4f64ca8fd74b0a541a67fab8d5cffe2f45eee55f26c3863d4fe",
  ],
  [
    "RENEW",
    "UNKNOWN",
    "CLOCK_ROLLBACK",
    "d67642055e0e291b2f8eb20fbc2573fe1a1c8071900d288fb3c4e162d7395f87",
  ],
  [
    "RENEW",
    "UNKNOWN",
    "CLOCK_SKEW",
    "60efd4d273fa9e4ce1483fc14593a8cbc9f1fda974ac6268a6e47d8e31088cbd",
  ],
  [
    "RENEW",
    "UNKNOWN",
    "MONOTONIC_UNAVAILABLE",
    "8487aceba4d0adb0164430c3734b619afc760c9d28c2ad02c34ce6ad8cdc46a2",
  ],
  ["RELEASE", "RELEASED", null, "2ae23f4d771f37c7e150661137c41dc52fbd821bc961c6f2e40651861e39445d"],
  [
    "RELEASE",
    "REFUSED",
    "SESSION_NOT_FOUND",
    "41b6bb5f8f45870a461606426f6e09deff0d8da111fb4db987a9c0c55fd09d88",
  ],
  [
    "RELEASE",
    "REFUSED",
    "SESSION_MISMATCH",
    "1c2f94de98832f1abd47d393ffd4e555539a9c1945d8a104b6f14d5d6566f2cf",
  ],
  [
    "RELEASE",
    "REFUSED",
    "HANDOFF_PENDING",
    "6ad3a3a440650044a5151d380050fa20c7b3955a948b7b32950a72764dbf75d6",
  ],
  [
    "RELEASE",
    "REFUSED",
    "CONFIGURATION_MISMATCH",
    "ad42248dd49eee55c0db6b52f3175d36a991e740ec5e01c345a2ec41e07ad50c",
  ],
  [
    "RELEASE",
    "UNKNOWN",
    "STATE_UNREADABLE",
    "45f6f6a03c3b185e48b75a642cba63b4f51c36b74c1d31ef88d9f7f2445ccfad",
  ],
  [
    "RELEASE",
    "UNKNOWN",
    "IDENTITY_CONFLICT",
    "2962c172f468e1f48a34365fcbfc9876538972e53bfb3215fb04cfe21adce8fc",
  ],
  [
    "RELEASE",
    "UNKNOWN",
    "CLOCK_ROLLBACK",
    "3757ed0145c955a947465e902f835be5b1f3183fe3e3f20a94e5e51bd1da64d5",
  ],
  [
    "RELEASE",
    "UNKNOWN",
    "CLOCK_SKEW",
    "174dcd1e1aded06ef9777cef9aa6dee24c2b6d75ce1b4df955ce149c453828c1",
  ],
  [
    "RELEASE",
    "UNKNOWN",
    "MONOTONIC_UNAVAILABLE",
    "d6a8cbc9f3e98a69071b38ac6426db7f5491cf4c3c283f78861e65072eeb1510",
  ],
] as const;
const healthGoldens = [
  [
    "AVAILABLE",
    "REFUSED",
    "SESSION_NOT_FOUND",
    "none",
    "e5107425481cf5c5e673f9a6a38f4e89195e09337fc3aae39a5146cdccb07c6f",
  ],
  [
    "HELD_FRESH",
    "HEALTHY",
    null,
    "none",
    "88015499adfc50605e6c3e106e0e70a6959cac55ed720d06667f79dadaecb74e",
  ],
  [
    "HELD_FRESH",
    "REFUSED",
    "CONFIGURATION_MISMATCH",
    "none",
    "47957feca543f0f278e28b21e259084c562004a5c6b2fb6153496b98b4dcca73",
  ],
  [
    "HELD_STALE",
    "REFUSED",
    "FRESHNESS_EXPIRED",
    "none",
    "2bf9df0e764d757be7af575453b6dfbd01cb3fb71998f49cf255aae9c5f63671",
  ],
  [
    "HELD_STALE",
    "REFUSED",
    "DURATION_EXCEEDED",
    "none",
    "cf7e9488a9838048596b366d0252040c0f48910f1fc4ccb1e70aa88a86e1e3d2",
  ],
  [
    "HANDOFF_PREPARED",
    "REFUSED",
    "HANDOFF_PENDING",
    "none",
    "ea4762998f7409d0af94d05426a2a8e588db00426032755d48280bc365d76d30",
  ],
  [
    "RELEASED",
    "REFUSED",
    "SESSION_RELEASED",
    "none",
    "bff47597c517cbfe99c41adc82b3121715b9af48cd7dfd1e490bcc6bf48f5d42",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "STATE_UNREADABLE",
    "none",
    "020950808940c3e9dfdb0226c3ccff9d945c7fbfee6bfdba980a6f56b922db9f",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "IDENTITY_CONFLICT",
    "none",
    "f3f9457f8f5c239968fae78fa9f7c9d78006779504084a51abfa84b2b88408e5",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "CLOCK_ROLLBACK",
    "none",
    "1b67a1968b973ace899db7511e49b72c0d0b5cb90506eeba2e568a1184b6f401",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "CLOCK_SKEW",
    "none",
    "13eee277dc5dc33192a31e7e8f5204c245404ee5cf1981c32e76975e8100bb53",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "MONOTONIC_UNAVAILABLE",
    "none",
    "ad30753b29448b4d0d22c808a3844372cbcb3ee74196225e537cb91eb78d8aa6",
  ],
  [
    "AVAILABLE",
    "REFUSED",
    "SESSION_NOT_FOUND",
    "same",
    "78cf9b9d4901dbf443837816bc672d330fed7c96f5079df7c676ed9e8489dcde",
  ],
  [
    "HELD_FRESH",
    "HEALTHY",
    null,
    "same",
    "9ecfa71dbec0b313c4fde0d26ad77150fd173815926737cdd3ff45f884244996",
  ],
  [
    "HELD_FRESH",
    "REFUSED",
    "CONFIGURATION_MISMATCH",
    "same",
    "f18405f658952adc7de02a27da81bbe011de891acbeb8000ad8ba20681a2484a",
  ],
  [
    "HELD_STALE",
    "REFUSED",
    "FRESHNESS_EXPIRED",
    "same",
    "fa3baf98e4c4b0fd2539ffb44f7e876d7d8fc6f23842cbf8192d8555e492f24c",
  ],
  [
    "HELD_STALE",
    "REFUSED",
    "DURATION_EXCEEDED",
    "same",
    "6826682e41e84328b77fed03c101e0bffb5c4578926254543eb828bb5bde2aa1",
  ],
  [
    "HANDOFF_PREPARED",
    "REFUSED",
    "HANDOFF_PENDING",
    "same",
    "17ba76fccdfcb291792af59c8aed05eb6814753a8a3b308095733ce4f35c8951",
  ],
  [
    "RELEASED",
    "REFUSED",
    "SESSION_RELEASED",
    "same",
    "66c7d65c0addb37f2de858cf7a04647e4894b103df539d246b666f46035b1002",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "STATE_UNREADABLE",
    "same",
    "54ac455f00add741c0db8a2700c32f0cc82afcb6cdedaf44a16ddf6eee9d3b4f",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "IDENTITY_CONFLICT",
    "same",
    "28bea81874b16a0430c92b3fb2a8df72f8c4eda5c587cfbe769a5ef7d1b08ff2",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "CLOCK_ROLLBACK",
    "same",
    "7e8fd57c35f50e4f63754a5f68026561025da54276adbba371e54f32fdb29414",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "CLOCK_SKEW",
    "same",
    "064cf13f156788f025964ae012a3491272e4b8ce3c1aaeb02a2657e0e3d7d26c",
  ],
  [
    "UNKNOWN",
    "UNKNOWN",
    "MONOTONIC_UNAVAILABLE",
    "same",
    "c621b12e80756640b09914b4cf157a93bb6acba3124fe84715fc404fc6663b09",
  ],
  [
    "HELD_FRESH",
    "REFUSED",
    "SESSION_MISMATCH",
    "different",
    "f27a69cdc5458bedb99002436c8008576c2294b0ee598b7daeae4440d7690c88",
  ],
  [
    "HELD_STALE",
    "REFUSED",
    "SESSION_MISMATCH",
    "different",
    "1376a4799481c5168c557997a833ecd6d558eb14891cf213d0f67c891619b752",
  ],
  [
    "HANDOFF_PREPARED",
    "REFUSED",
    "SESSION_MISMATCH",
    "different",
    "11d5d3184b322c7355a20b70b91246d9d055de61d9af8ee93288a4805f74d705",
  ],
  [
    "RELEASED",
    "REFUSED",
    "SESSION_MISMATCH",
    "different",
    "98f8ba37832bcb52b57167d5a023987218648cda76fa1319b9ce9e98189f9143",
  ],
] as const;

const sessionId = "01900000-0000-7000-8000-000000000001";
const cycleId = "01900000-0000-7000-8000-000000000002";
const otherId = "01900000-0000-7000-8000-000000000003";
const instant = "2026-08-31T12:00:00.000Z";
const sha = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const source = (): contracts.ContractRecord =>
  JSON.parse(configLiterals[0]) as contracts.ContractRecord;
const provenance = (): contracts.ContractRecord =>
  JSON.parse(configLiterals[1]) as contracts.ContractRecord;
const paths = (): contracts.ContractRecord =>
  JSON.parse(configLiterals[2]) as contracts.ContractRecord;
const acquire = (): contracts.SessionAcquireRequest =>
  JSON.parse(inputGoldens[0][1]) as contracts.SessionAcquireRequest;
const request = (): contracts.CycleRequest =>
  JSON.parse(inputGoldens[1][1]) as contracts.CycleRequest;
const plan = (): contracts.CyclePlan => JSON.parse(inputGoldens[2][1]) as contracts.CyclePlan;
const stepLiteral = `{"cycleId":"${cycleId}","inputDigest":"${inputGoldens[1][2]}","kind":"session.verify","ordinal":"1","predecessorJournalDigest":null}`;
type ReceiptRow = (typeof receiptGoldens)[number];
type HealthRow = (typeof healthGoldens)[number];
function receiptLiteral(row: ReceiptRow): string {
  return `{"acquireRequestDigest":${row[0] === "ACQUIRE" ? JSON.stringify(inputGoldens[0][2]) : "null"},"operation":"${row[0]}","outcome":"${row[1]}","reason":${JSON.stringify(row[2])},"recordedAt":"${instant}","schemaVersion":"session-receipt/v1","sessionId":"${sessionId}"}\n`;
}
function healthLiteral(row: HealthRow): string {
  const holder = row[0] === "AVAILABLE" || row[0] === "UNKNOWN" ? null : sessionId;
  const target = row[3] === "none" ? null : row[3] === "same" ? sessionId : otherId;
  return `{"holderSessionId":${JSON.stringify(holder)},"leaseState":"${row[0]}","observedAt":"${instant}","outcome":"${row[1]}","reason":${JSON.stringify(row[2])},"schemaVersion":"session-health/v1","step":${row[3] === "none" ? "null" : stepLiteral},"targetSessionId":${JSON.stringify(target)}}\n`;
}
const receipt = (row: ReceiptRow = receiptGoldens[0]): contracts.SessionReceipt =>
  JSON.parse(receiptLiteral(row)) as contracts.SessionReceipt;
const health = (
  row: HealthRow = healthGoldens.find((row) => row[1] === "HEALTHY" && row[3] === "same")!,
): contracts.SessionHealth => JSON.parse(healthLiteral(row)) as contracts.SessionHealth;
const apis = [
  [
    "session-acquire-request/v1",
    entry.parseSessionAcquireRequest,
    entry.computeSessionAcquireRequestDigest,
    acquire,
  ],
  ["cycle-request/v1", entry.parseCycleRequest, entry.computeCycleRequestDigest, request],
  ["cycle-plan/v1", entry.parseCyclePlan, entry.computeCyclePlanDigest, plan],
  ["session-receipt/v1", entry.parseSessionReceipt, entry.computeSessionReceiptDigest, receipt],
  ["session-health/v1", entry.parseSessionHealth, entry.computeSessionHealthDigest, health],
] as const;
function refuse(schema: string, input: unknown): void {
  expect(contracts.parseContract(schema, input).ok).toBe(false);
  expect(contracts.serializeContract(schema, input).ok).toBe(false);
  const api = apis.find(([name]) => name === schema)!;
  expect(api[1](input).ok).toBe(false);
  expect(() => api[2](input)).toThrow(TypeError);
}
function golden(schema: string, text: string, digest: string): void {
  const input: unknown = JSON.parse(text);
  const serialized = contracts.serializeContract(schema, input);
  expect(serialized.ok).toBe(true);
  if (!serialized.ok) throw new Error(serialized.issues.join(","));
  expect(serialized.bytes).toEqual(encode(text));
  expect(serialized.digest).toBe(digest);
  expect(contracts.parseCanonicalContractBytes(schema, encode(text)).ok).toBe(true);
  expect(contracts.parseCanonicalContractBytes(schema, Buffer.from(text)).ok).toBe(true);
  expect(apis.find(([name]) => name === schema)![2](input)).toBe(digest);
}
function replaceAt(
  input: unknown,
  path: readonly string[],
  value: unknown,
  remove = false,
): unknown {
  const copy = structuredClone(input) as Record<string, unknown>;
  let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  if (remove) delete parent[path.at(-1)!];
  else parent[path.at(-1)!] = value;
  return copy;
}
function recordPaths(
  input: unknown,
  prefix: readonly string[] = [],
): readonly (readonly string[])[] {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return [];
  return [
    prefix,
    ...Object.entries(input).flatMap(([key, value]) => recordPaths(value, [...prefix, key])),
  ];
}
function at(input: unknown, path: readonly string[]): Record<string, unknown> {
  let value = input;
  for (const key of path) value = (value as Record<string, unknown>)[key];
  return value as Record<string, unknown>;
}

describe("cycle entry and session structural contracts", () => {
  test("pins input bytes, full frame hex, hashes, empty lists, nested requests and existing config preimages", () => {
    for (const [schema, text, digest, hex] of inputGoldens) {
      golden(schema, text, digest);
      expect(
        Buffer.from(
          contracts.framedBytes(schema, [
            contracts.frame.canonical(JSON.parse(text) as contracts.ContractRecord),
          ]),
        ).toString("hex"),
      ).toBe(hex);
      expect(sha(Buffer.from(hex, "hex"))).toBe(digest);
      expect(sha(text)).not.toBe(digest);
    }
    for (const [index, schema, field] of [
      [0, "platform-configuration-source/v1", "configurationSourceDigest"],
      [1, "configuration-provenance/v1", "configurationProvenanceDigest"],
      [2, "configuration-paths/v1", "configurationPathsDigest"],
    ] as const) {
      const result = contracts.serializeContract(schema, JSON.parse(configLiterals[index]));
      expect(result).toEqual({
        ok: true,
        bytes: encode(configLiterals[index]),
        digest: acquire()[field],
      });
      expect(sha(configLiterals[index])).toBe(acquire()[field]);
    }
    expect(source().stateRoot).toBeNull();
    expect(plan().request).toEqual(request());
    expect(request().sessionRequest).toEqual(acquire());
    expect(contracts.computeRoutineStepDigest(JSON.parse(stepLiteral))).toBe(
      sha(`${stepLiteral}\n`),
    );
  });

  test("pins all 33 receipt operation/outcome/reason arms and all 28 health target relations", () => {
    expect(receiptGoldens).toHaveLength(33);
    expect(healthGoldens).toHaveLength(28);
    for (const row of receiptGoldens) golden("session-receipt/v1", receiptLiteral(row), row[3]);
    for (const row of healthGoldens) golden("session-health/v1", healthLiteral(row), row[4]);
  });

  test("refuses every crossed operation/outcome/reason and every operation/input-digest nullability cell", () => {
    const outcomes = ["ACQUIRED", "RENEWED", "RELEASED", "REFUSED", "UNKNOWN", "HEALTHY"];
    const reasons = [...new Set(receiptGoldens.map((row) => row[2])), "INVENTED"];
    for (const operation of ["ACQUIRE", "RENEW", "RELEASE", "HANDOFF", "acquire", "toString"]) {
      for (const outcome of outcomes)
        for (const reason of reasons) {
          const value = {
            ...receipt(),
            operation,
            outcome,
            reason,
            acquireRequestDigest: operation === "ACQUIRE" ? inputGoldens[0][2] : null,
          };
          const expected = receiptGoldens.some(
            (row) => row[0] === operation && row[1] === outcome && row[2] === reason,
          );
          expect(entry.parseSessionReceipt(value).ok, `${operation}/${outcome}/${reason}`).toBe(
            expected,
          );
        }
    }
    for (const row of receiptGoldens) {
      const value = receipt(row);
      refuse("session-receipt/v1", {
        ...value,
        acquireRequestDigest: row[0] === "ACQUIRE" ? null : inputGoldens[0][2],
      });
      for (const wrong of [0, false, {}, [], "", "A".repeat(64), `${"a".repeat(64)}\n`])
        refuse("session-receipt/v1", { ...value, acquireRequestDigest: wrong });
      expect(entry.parseSessionReceipt({ ...value, recordedAt: null }).ok).toBe(
        row[1] === "UNKNOWN",
      );
    }
  });

  test("refuses every crossed health state/outcome/reason/target cell and holder nullability", () => {
    const states = [
      "AVAILABLE",
      "HELD_FRESH",
      "HELD_STALE",
      "HANDOFF_PREPARED",
      "RELEASED",
      "UNKNOWN",
      "ACQUIRED",
    ];
    const reasons = [...new Set(healthGoldens.map((row) => row[2])), "INVENTED"];
    for (const leaseState of states)
      for (const outcome of ["HEALTHY", "REFUSED", "UNKNOWN", "ACQUIRED"]) {
        for (const reason of reasons)
          for (const relation of ["none", "same", "different"]) {
            const unheld = leaseState === "AVAILABLE" || leaseState === "UNKNOWN";
            const value = {
              ...health(),
              leaseState,
              outcome,
              reason,
              holderSessionId: unheld ? null : sessionId,
              targetSessionId:
                relation === "none" ? null : relation === "same" ? sessionId : otherId,
              step: relation === "none" ? null : health().step,
            };
            // With no trusted holder, any syntactically valid non-null target is the same relation.
            const normalized = unheld && relation === "different" ? "same" : relation;
            const expected = healthGoldens.some(
              (row) =>
                row[0] === leaseState &&
                row[1] === outcome &&
                row[2] === reason &&
                row[3] === normalized,
            );
            expect(
              entry.parseSessionHealth(value).ok,
              `${leaseState}/${outcome}/${reason}/${relation}`,
            ).toBe(expected);
          }
      }
    for (const row of healthGoldens) {
      const value = health(row);
      refuse("session-health/v1", {
        ...value,
        holderSessionId: value.holderSessionId === null ? sessionId : null,
      });
      expect(entry.parseSessionHealth({ ...value, observedAt: null }).ok).toBe(
        row[0] === "UNKNOWN",
      );
      if (value.step !== null) refuse("session-health/v1", { ...value, targetSessionId: null });
      expect(entry.parseSessionHealth({ ...value, step: null }).ok).toBe(true);
    }
    for (const step of [
      {
        ...health().step!,
        ordinal: "2",
        kind: "project.snapshot",
        predecessorJournalDigest: "a".repeat(64),
      },
      { ...health().step!, ordinal: 1 },
      { ...health().step!, kind: "project.snapshot" },
      { ...health().step!, predecessorJournalDigest: "a".repeat(64) },
    ])
      refuse("session-health/v1", { ...health(), step });
  });

  test("checks Time as an exact real UTC Gregorian instant with 0001–9999 years", () => {
    for (const value of [
      "0001-01-01T00:00:00.000Z",
      "9999-12-31T23:59:59.999Z",
      "2000-02-29T12:30:59.999Z",
      "2024-02-29T00:00:00.000Z",
    ]) {
      expect(entry.parseSessionReceipt({ ...receipt(), recordedAt: value }).ok).toBe(true);
      expect(entry.parseSessionHealth({ ...health(), observedAt: value }).ok).toBe(true);
    }
    for (const value of [
      null,
      undefined,
      0,
      {},
      [],
      true,
      "0000-01-01T00:00:00.000Z",
      "1900-02-29T00:00:00.000Z",
      "2026-02-29T00:00:00.000Z",
      "2026-04-31T00:00:00.000Z",
      "2026-13-01T00:00:00.000Z",
      "2026-01-00T00:00:00.000Z",
      "2026-01-01T24:00:00.000Z",
      "2026-01-01T00:60:00.000Z",
      "2026-01-01T00:00:60.000Z",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00.0000Z",
      "2026-01-01T00:00:00.000+00:00",
      "10000-01-01T00:00:00.000Z",
      `${instant}\n`,
    ]) {
      refuse("session-receipt/v1", { ...receipt(), recordedAt: value });
      refuse("session-health/v1", { ...health(), observedAt: value });
      if (value !== null) {
        refuse("session-receipt/v1", {
          ...receipt(receiptGoldens.find((row) => row[1] === "UNKNOWN")!),
          recordedAt: value,
        });
        refuse("session-health/v1", {
          ...health(healthGoldens.find((row) => row[0] === "UNKNOWN")!),
          observedAt: value,
        });
      }
    }
  });

  test("enforces exact Id/Uuid/Digest grammar and module 0/1/64/65, ordering and density bounds", () => {
    for (const allowedModuleIds of [
      [],
      ["a"],
      Array.from({ length: 64 }, (_, i) => `m${String(i).padStart(2, "0")}`),
    ])
      expect(entry.parseCycleRequest({ ...request(), allowedModuleIds }).ok).toBe(true);
    for (const allowedModuleIds of [
      Array.from({ length: 65 }, (_, i) => `m${String(i).padStart(2, "0")}`),
      ["b", "a"],
      ["a", "a"],
      [null],
      new Array(1),
      ["m"][Symbol.iterator](),
      null,
      {},
      "a",
    ])
      refuse("cycle-request/v1", { ...request(), allowedModuleIds });
    for (const value of ["a", "0", `a${"z".repeat(127)}`, "a._:@+-9"]) {
      expect(
        entry.parseCycleRequest({ ...request(), adapterId: value, allowedModuleIds: [value] }).ok,
      ).toBe(true);
    }
    for (const value of [
      null,
      undefined,
      0,
      false,
      [],
      {},
      "",
      "A",
      "é",
      "a/b",
      " a",
      "a ",
      "_a",
      "-a",
      `a${"z".repeat(128)}`,
      "a\n",
      "a\r",
      "a\0",
      "a\ud800",
    ]) {
      refuse("cycle-request/v1", { ...request(), adapterId: value });
      refuse("cycle-request/v1", { ...request(), allowedModuleIds: [value] });
    }
    for (const value of [
      null,
      0,
      false,
      [],
      {},
      "",
      sessionId.toUpperCase().replace("7000", "7ABC"),
      sessionId.replace("7000", "4000"),
      sessionId.replace("8000", "c000"),
      `${sessionId}\n`,
    ]) {
      refuse("session-acquire-request/v1", { ...acquire(), sessionId: value });
      refuse("cycle-request/v1", { ...request(), cycleId: value });
      refuse("session-receipt/v1", { ...receipt(), sessionId: value });
      refuse("session-health/v1", { ...health(), targetSessionId: value });
      refuse("session-health/v1", { ...health(), holderSessionId: value });
    }
    for (const field of [
      "configurationPathsDigest",
      "configurationProvenanceDigest",
      "configurationSourceDigest",
    ])
      for (const value of [
        null,
        0,
        false,
        [],
        {},
        "",
        "a".repeat(63),
        "a".repeat(65),
        "A".repeat(64),
        `${"a".repeat(64)}\n`,
      ])
        refuse("session-acquire-request/v1", { ...acquire(), [field]: value });
  });

  test("closes and detaches every nested record, and never evaluates hostile caller code", () => {
    let executed = 0;
    const trap = () => {
      executed += 1;
      throw new Error("caller code executed");
    };
    for (const [schema, parse, , make] of apis) {
      const original = make();
      for (const path of recordPaths(original)) {
        const current = at(original, path);
        for (const key of Object.keys(current)) {
          refuse(schema, replaceAt(original, [...path, key], null, true));
          refuse(schema, replaceAt(original, [...path, key], undefined));
          for (const wrong of [false, 0, {}])
            refuse(schema, replaceAt(original, [...path, key], wrong));
          if (!Array.isArray(current[key])) refuse(schema, replaceAt(original, [...path, key], []));
          if (current[key] !== null && !(schema === "session-health/v1" && key === "step"))
            refuse(schema, replaceAt(original, [...path, key], null));
          const renamed = { ...current, [`renamed_${key}`]: current[key] };
          delete renamed[key];
          refuse(schema, path.length ? replaceAt(original, path, renamed) : renamed);
        }
        const accessor = { ...current };
        Object.defineProperty(accessor, Object.keys(current)[0]!, { enumerable: true, get: trap });
        const hidden = { ...current };
        Object.defineProperty(hidden, "hidden", { value: true });
        const revoked = Proxy.revocable(current, {});
        revoked.revoke();
        const cyclic: Record<string, unknown> = { ...current };
        cyclic.loop = cyclic;
        for (const bad of [
          null,
          undefined,
          Symbol("record"),
          1n,
          trap,
          [],
          0,
          true,
          "record",
          new Date(instant),
          new Map(),
          Object.create(current) as object,
          { ...current, extra: null },
          { ...current, toJSON: trap },
          { ...current, [Symbol("extra")]: true },
          accessor,
          hidden,
          new Proxy(current, { get: trap, ownKeys: trap, getPrototypeOf: trap }),
          revoked.proxy,
          cyclic,
        ]) {
          if (bad === null && schema === "session-health/v1" && path.join(".") === "step") continue;
          refuse(schema, path.length ? replaceAt(original, path, bad) : bad);
        }
        const nullPrototype = Object.assign(
          Object.create(null) as Record<string, unknown>,
          current,
        );
        expect(
          parse(path.length ? replaceAt(original, path, nullPrototype) : nullPrototype).ok,
        ).toBe(true);
      }
      const parsed = parse(original);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("fixture refused");
      expect(parsed.value).not.toBe(original);
      for (const path of recordPaths(original)) {
        expect(Object.isFrozen(at(parsed.value, path))).toBe(true);
        expect(at(parsed.value, path)).not.toBe(at(original, path));
      }
      if (schema === "cycle-request/v1")
        expect(Object.isFrozen((parsed.value as contracts.CycleRequest).allowedModuleIds)).toBe(
          true,
        );
      const before = contracts.canonicalJson(parsed.value);
      (original as Record<string, unknown>).schemaVersion = "mutated/v1";
      expect(contracts.canonicalJson(parsed.value)).toBe(before);
    }
    const accessorArray = ["a"];
    Object.defineProperty(accessorArray, "0", { enumerable: true, get: trap });
    const extraArray = Object.assign(["a"], { extra: true });
    class ExoticArray extends Array<string> {}
    for (const allowedModuleIds of [
      accessorArray,
      extraArray,
      new ExoticArray("a"),
      new Proxy(["a"], { get: trap, ownKeys: trap, getPrototypeOf: trap }),
    ])
      refuse("cycle-request/v1", { ...request(), allowedModuleIds });
    expect(executed).toBe(0);
  });

  test("rejects persisted noncanonical encodings, hostile byte containers, and non-current versions", () => {
    let executed = 0;
    const trap = () => {
      executed += 1;
      throw new Error("byte hook executed");
    };
    class ExoticBytes extends Uint8Array {}
    for (const [schema, parse, compute, make] of apis) {
      const value = make();
      const text = contracts.canonicalJson(value);
      const reversed = Object.fromEntries(Object.entries(value).reverse());
      expect(compute(reversed)).toBe(compute(value));
      expect(contracts.serializeContract(schema, reversed)).toEqual(
        contracts.serializeContract(schema, value),
      );
      for (const bytes of [
        encode(text.trimEnd()),
        encode(`${text}\n`),
        encode(` ${text}`),
        encode(text.replace(/\n$/, "\r\n")),
        encode(`\ufeff${text}`),
        encode(`${JSON.stringify(reversed)}\n`),
        encode(text.replace("{", '{"schemaVersion":"duplicate",')),
        Uint8Array.of(0xff),
        Uint8Array.of(0xc0, 0xaf),
      ])
        expect(contracts.parseCanonicalContractBytes(schema, bytes).ok).toBe(false);
      const fake = { length: encode(text).length, [Symbol.iterator]: trap };
      for (const bytes of [
        fake,
        [],
        text,
        null,
        new Uint16Array(4),
        new DataView(new ArrayBuffer(8)),
        new ExoticBytes(encode(text)),
        new Proxy(encode(text), { get: trap, getPrototypeOf: trap }),
      ])
        expect(contracts.parseCanonicalContractBytes(schema, bytes as Uint8Array).ok).toBe(false);
      const native = encode(text);
      Object.defineProperties(native, {
        length: { get: trap },
        byteLength: { get: trap },
        [Symbol.iterator]: { value: trap },
      });
      expect(contracts.parseCanonicalContractBytes(schema, native).ok).toBe(true);
      for (const version of [
        schema.replace("/v1", "/v0-fixture"),
        schema.replace("/v1", "/v2"),
        schema.replace("/v1", "/v999"),
      ]) {
        refuse(schema, { ...value, schemaVersion: version });
        expect(entry.parseCycleEntryContract(version, value)).toBeNull();
        expect(contracts.parseCanonicalContractBytes(version, encode(text)).ok).toBe(false);
        expect(contracts.serializeContract(version, value).ok).toBe(false);
        expect(contracts.compatibilityDisposition(schema, version)).toBe("refused");
      }
      expect(parse(value).ok).toBe(true);
    }
    expect(executed).toBe(0);
  });

  test("keeps one canonical part and domain separation; identity changes propagate through nesting", () => {
    for (const [schema, , compute, make] of apis) {
      const value = make();
      const actual = compute(value);
      expect(actual).not.toBe(contracts.canonicalDigest(value));
      expect(actual).not.toBe(
        contracts.framedDigest("wrong/v1", [contracts.frame.canonical(value)]),
      );
      expect(actual).not.toBe(
        contracts.framedDigest(schema, [contracts.frame.raw32(contracts.canonicalDigest(value))]),
      );
      expect(actual).not.toBe(contracts.framedDigest(schema, []));
      expect(actual).not.toBe(
        contracts.framedDigest(schema, [
          contracts.frame.canonical(value),
          contracts.frame.canonical(value),
        ]),
      );
      expect(actual).not.toBe(
        contracts.framedDigest(schema, [
          contracts.frame.fixed(Buffer.from(contracts.canonicalBytes(value)).toString("hex")),
        ]),
      );
    }
    for (const mutant of [
      { ...acquire(), sessionId: otherId },
      { ...acquire(), configurationPathsDigest: "d".repeat(64) },
      { ...acquire(), configurationProvenanceDigest: "d".repeat(64) },
      { ...acquire(), configurationSourceDigest: "d".repeat(64) },
    ]) {
      expect(entry.computeSessionAcquireRequestDigest(mutant)).not.toBe(inputGoldens[0][2]);
      const nextRequest = { ...request(), sessionRequest: mutant };
      expect(entry.computeCycleRequestDigest(nextRequest)).not.toBe(inputGoldens[1][2]);
      expect(entry.computeCyclePlanDigest({ ...plan(), request: nextRequest })).not.toBe(
        inputGoldens[2][2],
      );
    }
    for (const mutant of [
      { ...request(), adapterId: "other.adapter" },
      { ...request(), cycleId: otherId },
      { ...request(), allowedModuleIds: [] },
    ]) {
      expect(entry.computeCycleRequestDigest(mutant)).not.toBe(inputGoldens[1][2]);
      expect(entry.computeCyclePlanDigest({ ...plan(), request: mutant })).not.toBe(
        inputGoldens[2][2],
      );
    }
    for (const mutant of [
      { ...receipt(), sessionId: otherId },
      { ...receipt(), acquireRequestDigest: "d".repeat(64) },
      { ...receipt(), recordedAt: "2026-09-01T12:00:00.000Z" },
      ...receiptGoldens.slice(1).map((row) => receipt(row)),
    ])
      expect(entry.computeSessionReceiptDigest(mutant)).not.toBe(
        entry.computeSessionReceiptDigest(receipt()),
      );
    for (const mutant of [
      { ...health(), observedAt: "2026-09-01T12:00:00.000Z" },
      { ...health(), targetSessionId: otherId, holderSessionId: otherId },
      { ...health(), step: null },
      { ...health(), step: { ...health().step!, cycleId: otherId } },
      { ...health(), step: { ...health().step!, inputDigest: "d".repeat(64) } },
      ...healthGoldens
        .filter((row) => row[1] !== "HEALTHY" || row[3] !== "same")
        .map((row) => health(row)),
    ])
      expect(entry.computeSessionHealthDigest(mutant)).not.toBe(
        entry.computeSessionHealthDigest(health()),
      );
  });

  test("binds all three actual configuration preimages and plan adapter/module/identity without resolving paths", () => {
    const bindAcquire = (
      input: unknown = acquire(),
      s: unknown = source(),
      p: unknown = provenance(),
      pathsInput: unknown = paths(),
    ) => entry.validateSessionAcquireRequestBinding(input, s, p, pathsInput);
    const bindPlan = (
      input: unknown = plan(),
      s: unknown = source(),
      p: unknown = provenance(),
      pathsInput: unknown = paths(),
      modules: unknown = ["module.a"],
      digest: unknown = inputGoldens[2][2],
    ) => entry.validateCyclePlanBinding(input, s, p, pathsInput, modules, digest);
    expect(bindAcquire().ok).toBe(true);
    expect(bindPlan().ok).toBe(true);
    expect(bindAcquire(acquire(), { ...source(), leaseFreshnessMs: 1000 }).ok).toBe(false);
    expect(bindPlan(plan(), { ...source(), leaseFreshnessMs: 1000 }).ok).toBe(false);
    expect(bindPlan(plan(), source(), { ...provenance(), leaseFreshnessMs: 1000 }).ok).toBe(false);
    expect(
      bindPlan(plan(), source(), provenance(), {
        ...paths(),
        configPath: `<redacted:path:${"d".repeat(64)}>`,
      }).ok,
    ).toBe(false);
    expect(bindAcquire(acquire(), source(), { ...provenance(), leaseFreshnessMs: 1000 }).ok).toBe(
      false,
    );
    for (const field of ["configPath", "projectRoot", "stateRoot"])
      expect(
        bindAcquire(acquire(), source(), provenance(), {
          ...paths(),
          [field]: `<redacted:path:${"d".repeat(64)}>`,
        }).ok,
      ).toBe(false);
    for (const field of ["projectRoot", "stateRoot"])
      expect(
        bindAcquire(acquire(), source(), {
          ...provenance(),
          [field]: `<redacted:path:${"d".repeat(64)}>`,
        }).ok,
      ).toBe(false);
    expect(
      bindAcquire(acquire(), {
        ...source(),
        schemaVersion: "platform-configuration/v1",
        stateRoot: "file:///state",
      }).ok,
    ).toBe(false);
    for (const slot of [0, 1, 2]) {
      const inputs: unknown[] = [source(), provenance(), paths()];
      inputs[slot] = null;
      expect(bindAcquire(acquire(), ...(inputs as [unknown, unknown, unknown])).ok).toBe(false);
    }
    const wrongAdapter = { ...plan(), request: { ...request(), adapterId: "other.adapter" } };
    expect(
      bindPlan(
        wrongAdapter,
        source(),
        provenance(),
        paths(),
        ["module.a"],
        entry.computeCyclePlanDigest(wrongAdapter),
      ).ok,
    ).toBe(false);
    for (const modules of [
      [],
      ["other.module"],
      ["module.a", "module.a"],
      [null],
      new Array(1),
      null,
    ])
      expect(bindPlan(plan(), source(), provenance(), paths(), modules).ok).toBe(false);
    expect(bindPlan(plan(), source(), provenance(), paths(), ["module.z", "module.a"]).ok).toBe(
      true,
    );
    for (const digest of [null, {}, "", "d".repeat(64)])
      expect(bindPlan(plan(), source(), provenance(), paths(), ["module.a"], digest).ok).toBe(
        false,
      );
    for (const changedRequest of [
      { ...request(), cycleId: otherId },
      { ...request(), sessionRequest: { ...acquire(), sessionId: otherId } },
      { ...request(), allowedModuleIds: [] },
    ])
      expect(bindPlan({ ...plan(), request: changedRequest }).ok).toBe(false);
    expect(
      entry.validateCyclePlanBinding(
        JSON.parse(inputGoldens[4][1]),
        source(),
        provenance(),
        paths(),
        [],
        inputGoldens[4][2],
      ).ok,
    ).toBe(true);
    const framedConfig = {
      ...acquire(),
      configurationSourceDigest: contracts.framedDigest("platform-configuration-source/v1", [
        contracts.frame.canonical(source()),
      ]),
    };
    expect(bindAcquire(framedConfig).ok).toBe(false);
  });

  test("binds receipt command/request preimages and refuses borrowed health or inspector output", () => {
    for (const row of receiptGoldens) {
      const value = receipt(row);
      const input = row[0] === "ACQUIRE" ? acquire() : null;
      expect(entry.validateSessionReceiptBinding(value, row[0], sessionId, input).ok).toBe(true);
      expect(entry.validateSessionReceiptBinding(value, "other", sessionId, input).ok).toBe(false);
      expect(entry.validateSessionReceiptBinding(value, row[0], otherId, input).ok).toBe(false);
      if (row[0] === "ACQUIRE") {
        expect(
          entry.validateSessionReceiptBinding(value, row[0], sessionId, {
            ...acquire(),
            configurationSourceDigest: "d".repeat(64),
          }).ok,
        ).toBe(false);
        const changed = { ...acquire(), sessionId: otherId };
        expect(
          entry.validateSessionReceiptBinding(
            { ...value, acquireRequestDigest: entry.computeSessionAcquireRequestDigest(changed) },
            row[0],
            sessionId,
            changed,
          ).ok,
        ).toBe(false);
        expect(entry.validateSessionReceiptBinding(value, row[0], sessionId, null).ok).toBe(false);
      } else
        expect(entry.validateSessionReceiptBinding(value, row[0], sessionId, acquire()).ok).toBe(
          false,
        );
    }
    for (const row of healthGoldens) {
      const value = health(row);
      expect(entry.validateSessionHealthBinding(value, plan()).ok).toBe(row[3] === "same");
      if (row[3] === "same")
        expect(entry.validateSessionHealthBinding({ ...value, step: null }, plan()).ok).toBe(false);
    }
    for (const value of [
      { ...health(), step: { ...health().step!, cycleId: otherId } },
      { ...health(), step: { ...health().step!, inputDigest: inputGoldens[2][2] } },
      { ...health(), targetSessionId: otherId, holderSessionId: otherId },
    ]) {
      expect(entry.parseSessionHealth(value).ok).toBe(true);
      expect(entry.validateSessionHealthBinding(value, plan()).ok).toBe(false);
    }
    expect(
      entry.validateSessionHealthBinding(health(), {
        ...plan(),
        request: { ...request(), allowedModuleIds: [] },
      }).ok,
    ).toBe(false);
    expect(entry.validateSessionHealthBinding(health(), null).ok).toBe(false);
  });

  test("keeps parsing/equality separate from current lease, configuration resolution and stable authority", () => {
    // These internally consistent claims may be fabricated or ancient. Passing is deliberately structural.
    const ancient = { ...health(), observedAt: "0001-01-01T00:00:00.000Z" };
    expect(entry.validateSessionHealthBinding(ancient, plan()).ok).toBe(true);
    // No acquisition-receipt predecessor is required: a legitimate handoff successor has the same health shape.
    const successorRequest = { ...request(), sessionRequest: { ...acquire(), sessionId: otherId } };
    const successorHealth = {
      ...health(),
      holderSessionId: otherId,
      targetSessionId: otherId,
      step: { ...health().step!, inputDigest: entry.computeCycleRequestDigest(successorRequest) },
    };
    expect(
      entry.validateSessionHealthBinding(successorHealth, { ...plan(), request: successorRequest })
        .ok,
    ).toBe(true);
    const fabricatedProvenance = { ...provenance(), leaseFreshnessMs: 1000 };
    const internallyHashedRequest = {
      ...acquire(),
      configurationProvenanceDigest: contracts.canonicalDigest(fabricatedProvenance),
    };
    expect(
      entry.validateSessionAcquireRequestBinding(
        internallyHashedRequest,
        source(),
        fabricatedProvenance,
        paths(),
      ).ok,
    ).toBe(true);
    // The loader still must prove source/effective resolution; no boolean "admitted" input bypass exists.
    for (const [schema, , , make] of apis)
      for (const field of [
        "authority",
        "lease",
        "epoch",
        "current",
        "admitted",
        "holderPid",
        "expiresAt",
        "activeRelease",
        "mutationPlan",
        "proof",
      ])
        refuse(schema, { ...make(), [field]: true });
    for (const command of [
      "session acquire",
      "session renew",
      "session release",
      "session inspect",
      "cycle plan",
      "cycle run",
    ])
      expect(
        contracts.orchestrationCommandCensus.find((row) => row.command === command)
          ?.placeholderOwner,
      ).not.toBeNull();
  });

  test("registers exactly the five complete families, vocabulary, compatibility and bounded pure public surface", () => {
    expect(Object.keys(entry).sort()).toEqual([
      "computeCyclePlanDigest",
      "computeCycleRequestDigest",
      "computeSessionAcquireRequestDigest",
      "computeSessionHealthDigest",
      "computeSessionReceiptDigest",
      "cycleEntrySchemaFields",
      "cycleEntrySchemaVersions",
      "parseCycleEntryContract",
      "parseCyclePlan",
      "parseCycleRequest",
      "parseSessionAcquireRequest",
      "parseSessionHealth",
      "parseSessionReceipt",
      "validateCyclePlanBinding",
      "validateSessionAcquireRequestBinding",
      "validateSessionHealthBinding",
      "validateSessionReceiptBinding",
    ]);
    expect(entry.cycleEntrySchemaVersions).toEqual([
      "cycle-plan/v1",
      "cycle-request/v1",
      "session-acquire-request/v1",
      "session-health/v1",
      "session-receipt/v1",
    ]);
    for (const [name, value] of Object.entries(entry))
      expect(Object.entries(contracts).find(([key]) => key === name)?.[1]).toBe(value);
    for (const [schema, , , make] of apis) {
      expect(contracts.schemaVersions.filter((value) => value === schema)).toHaveLength(1);
      expect(contracts.schemaVocabularyDefinitions[schema]?.fields).toEqual(
        Object.keys(make()).sort(),
      );
      expect(
        contracts.compatibilityMatrix.filter((row) => row.expectedSchemaVersion === schema),
      ).toEqual(
        [schema, schema.replace("/v1", "/v0-fixture"), schema.replace("/v1", "/v999"), null].map(
          (observedSchemaVersion) => ({
            expectedSchemaVersion: schema,
            observedSchemaVersion,
            disposition: observedSchemaVersion === schema ? "readable" : "refused",
          }),
        ),
      );
    }
    for (const row of receiptGoldens)
      for (const literal of row.slice(0, 3))
        if (literal !== null)
          expect(
            contracts.schemaVocabularyDefinitions["session-receipt/v1"]?.closedValues,
          ).toContain(literal);
    for (const row of healthGoldens)
      for (const literal of row.slice(0, 3))
        if (literal !== null)
          expect(
            contracts.schemaVocabularyDefinitions["session-health/v1"]?.closedValues,
          ).toContain(literal);
    expect(contracts.schemaVocabularyDefinitions["session-health/v1#step"]?.closedValues).toEqual([
      "1",
      "session.verify",
    ]);
    for (const schema of [
      "routine-cycle/v1",
      "routine-step/v1",
      "session-lease/v1",
      "session-renew-request/v1",
      "session-handoff-request/v1",
      "session-handoff-receipt/v1",
      "cycle-receipt/v1",
      "event-journal/v1",
    ])
      expect(contracts.schemaVersions).not.toContain(schema);
    expect(contracts.engineVocabularyFindings(contracts.schemaVocabularyDefinitions)).toEqual([]);
  });
});
