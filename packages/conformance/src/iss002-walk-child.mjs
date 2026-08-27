const stableModuleUrl = process.argv[2];
const candidateModuleUrl = process.argv[3];
if (
  typeof stableModuleUrl !== "string" ||
  !stableModuleUrl.startsWith("file:") ||
  typeof candidateModuleUrl !== "string" ||
  !candidateModuleUrl.startsWith("file:") ||
  stableModuleUrl === candidateModuleUrl
)
  throw new TypeError("stable-candidate-module-urls:refused");

const parseJson = JSON.parse.bind(JSON);
const stringifyJson = JSON.stringify.bind(JSON);
const writeStdout = process.stdout.write.bind(process.stdout);
const renderString = String;
const append = Function.call.bind(Array.prototype.push);
const stable = await import(stableModuleUrl);
if (
  typeof stable.computeAuthorityHistoryRecordDigest !== "function" ||
  typeof stable.validateAuthorityHistoryChain !== "function"
)
  throw new TypeError("stable-authority-api:missing");

const digest = (digit) => digit.repeat(64);
const globalIdentityDigest = digest("a");
const records = [
  {
    genesisBootstrapInputDigest: digest("1"),
    globalIdentityDigest,
    ordinal: "0",
    predecessorKind: "GENESIS_LITERAL",
    recordKind: "GENESIS",
    schemaVersion: "authority-history-record/v1",
    successorCoreDigest: digest("2"),
  },
];
let priorDigest = stable.computeAuthorityHistoryRecordDigest(records[0]);
for (let index = 1; index < 1000; index += 1) {
  const record = {
    globalIdentityDigest,
    ordinal: String(index),
    predecessorKind: "RECORD",
    priorHeadOrdinal: String(index - 1),
    priorRecordDigest: priorDigest,
    recordKind: "ROTATION",
    retiringAuthorityPathInstanceDigest: digest("3"),
    retiringAuthorityReceiptDigest: digest("4"),
    retiringAuthorityTipDigest: digest("5"),
    retiringAuthorityValueDigest: digest("6"),
    rotationInputDigest: digest("7"),
    schemaVersion: "authority-history-record/v1",
    successorCoreDigest: digest("8"),
  };
  records.push(record);
  priorDigest = stable.computeAuthorityHistoryRecordDigest(record);
}
const selectedAuthorityValue = {
  activeReleasePathInstanceDigest: digest("1"),
  activeReleaseReceiptDigest: digest("2"),
  activeReleaseTipDigest: digest("3"),
  activeReleaseValueDigest: digest("4"),
  admittedCustodyObservationDigest: digest("5"),
  authorityOrdinal: "999",
  custodyInstanceDigest: digest("6"),
  globalIdentityDigest,
  headOrdinal: "999",
  headRecordDigest: priorDigest,
  helperAbiDigest: digest("7"),
  helperDigest: digest("8"),
  helperProfileDigest: digest("9"),
  installationId: "018f0f4d-7b2d-7a11-aa2b-123456789abc",
  lockProfileDigest: digest("a"),
  priorAuthorityReceiptDigest: digest("b"),
  priorAuthorityTipDigest: digest("c"),
  priorAuthorityValueDigest: digest("d"),
  projectId: "018f0f4d-7b2d-7a11-ba2b-123456789abc",
  schemaVersion: "state-mutation-authority-value/v1",
  stateComponentProfileDigest: digest("e"),
  stateRootDigest: digest("f"),
};
const inputText = stringifyJson({ records, selectedAuthorityValue });
const expectedLastRecord = stringifyJson(records[999]);
const expectedHeadRecordDigest = priorDigest;

const candidate = await import(candidateModuleUrl);
if (typeof candidate.validateAuthorityHistoryChain !== "function")
  throw new TypeError("candidate-authority-api:missing");

const parsed = parseJson(inputText);
const issues = [
  ...candidate.validateAuthorityHistoryChain(parsed.records, parsed.selectedAuthorityValue),
];
if (
  parsed.records.length !== 1000 ||
  parsed.records[999]?.ordinal !== parsed.selectedAuthorityValue.headOrdinal ||
  stringifyJson(parsed.records[999]) !== expectedLastRecord ||
  parsed.selectedAuthorityValue.headRecordDigest !== expectedHeadRecordDigest
)
  append(issues, "selected-head:equality-mismatch");
writeStdout(
  stringifyJson({
    issues,
    recordCount: renderString(parsed.records.length),
  }),
);
