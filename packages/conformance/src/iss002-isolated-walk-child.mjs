import { types as nodeTypes } from "node:util";

const parseJson = JSON.parse.bind(JSON);
const stringifyJson = JSON.stringify.bind(JSON);
const writeStdout = process.stdout.write.bind(process.stdout);
const append = Function.call.bind(Array.prototype.push);
const freeze = Object.freeze.bind(Object);
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors.bind(Object);
const getPrototypeOf = Object.getPrototypeOf.bind(Object);
const ownKeys = Reflect.ownKeys.bind(Reflect);
const isArray = Array.isArray.bind(Array);
const isProxy = nodeTypes.isProxy.bind(nodeTypes);
const isSafeInteger = Number.isSafeInteger.bind(Number);
const exactArrayPrototype = Array.prototype;

freeze(Object.prototype);
freeze(Array.prototype);
freeze(String.prototype);

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const descriptor of Object.values(getOwnPropertyDescriptors(value)))
    if ("value" in descriptor) deepFreeze(descriptor.value);
  return freeze(value);
}

function detachIssues(value) {
  if (!isArray(value) || isProxy(value) || getPrototypeOf(value) !== exactArrayPrototype)
    throw new TypeError("candidate-issues:exact-array-required");
  const descriptors = getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor))
    throw new TypeError("candidate-issues:length-refused");
  const length = lengthDescriptor.value;
  if (!isSafeInteger(length) || length < 0 || length > 1024)
    throw new TypeError("candidate-issues:length-refused");
  const keys = ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string") || keys.length !== length + 1)
    throw new TypeError("candidate-issues:keys-refused");
  const issues = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "string"
    )
      throw new TypeError("candidate-issues:element-refused");
    append(issues, descriptor.value);
  }
  return issues;
}

if (
  process.argv.length !== 3 ||
  typeof process.argv[2] !== "string" ||
  !process.argv[2].startsWith("file:")
)
  throw new TypeError("candidate-module-url:refused");

const chunks = [];
let byteLength = 0;
for await (const chunk of process.stdin) {
  byteLength += chunk.byteLength;
  if (byteLength > 4 * 1024 * 1024) throw new TypeError("challenge:length-refused");
  chunks.push(chunk);
}
const inputText = Buffer.concat(chunks).toString("utf8");
const input = parseJson(inputText);
if (
  input === null ||
  typeof input !== "object" ||
  Array.isArray(input) ||
  Object.keys(input).sort().join("\0") !== "records\0selectedAuthorityValue" ||
  !Array.isArray(input.records) ||
  input.records.length !== 1000 ||
  input.selectedAuthorityValue === null ||
  typeof input.selectedAuthorityValue !== "object" ||
  Array.isArray(input.selectedAuthorityValue)
)
  throw new TypeError("challenge:record-refused");
deepFreeze(input);

const candidate = await import(process.argv[2]);
if (typeof candidate.validateAuthorityHistoryChain !== "function")
  throw new TypeError("candidate-authority-api:missing");
const issues = detachIssues(
  candidate.validateAuthorityHistoryChain(input.records, input.selectedAuthorityValue),
);

writeStdout(stringifyJson({ issues }));
