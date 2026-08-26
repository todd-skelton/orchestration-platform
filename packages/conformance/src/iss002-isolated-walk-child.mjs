import { types as nodeTypes } from "node:util";
import { accessSync, constants, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLinuxCredentialStatus } from "./linux-credential-status.mjs";

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
const getUid = process.getuid?.bind(process);
const getEuid = process.geteuid?.bind(process);
const getGid = process.getgid?.bind(process);
const getEgid = process.getegid?.bind(process);
const getGroups = process.getgroups?.bind(process);
const currentWorkingDirectory = process.cwd.bind(process);
const executablePath = process.execPath;
const rpcModulePath = fileURLToPath(import.meta.url);

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

function verifyLinuxPrincipal(uidText, gidText) {
  if (process.platform !== "linux")
    throw new TypeError("candidate-principal:linux-expectation-refused");
  if (!getUid || !getEuid || !getGid || !getEgid || !getGroups)
    throw new TypeError("candidate-principal:credential-refused");
  if (
    !verifyLinuxCredentialStatus({
      effectiveGid: getEgid(),
      effectiveUid: getEuid(),
      expectedGid: gidText,
      expectedUid: uidText,
      groups: getGroups(),
      realGid: getGid(),
      realUid: getUid(),
      statusText: readFileSync("/proc/self/status", "utf8"),
    })
  )
    throw new TypeError("candidate-principal:kernel-credential-refused");
}

function requireAccess(path, mode, code) {
  try {
    accessSync(path, mode);
  } catch {
    throw new TypeError(code);
  }
}

function requireRefusedAccess(path, mode, code) {
  try {
    accessSync(path, mode);
  } catch (error) {
    if (error?.code === "EACCES") return;
    throw new TypeError(code);
  }
  throw new TypeError(code);
}

function requireProfile(path, expected) {
  const profile = lstatSync(path, { bigint: true });
  if (
    (expected.directory ? !profile.isDirectory() : !profile.isFile()) ||
    profile.isSymbolicLink() ||
    profile.uid !== BigInt(expected.uid) ||
    profile.gid !== BigInt(expected.gid) ||
    (profile.mode & 0o7777n) !== BigInt(expected.mode)
  )
    throw new TypeError("candidate-filesystem:profile-refused");
}

function verifyLinuxFilesystemAccess(uidText, gidText) {
  const uid = Number(uidText);
  const gid = Number(gidText);
  const rpcPath = realpathSync(rpcModulePath);
  const rootPath = dirname(rpcPath);
  const parentPath = dirname(rootPath);
  const scratchPath = realpathSync(currentWorkingDirectory());
  const runtimePath = realpathSync(executablePath);
  const candidatePath = resolve(rootPath, "candidate.mjs");
  if (
    basename(scratchPath) !== "scratch" ||
    dirname(scratchPath) !== rootPath ||
    rpcPath !== resolve(rootPath, "rpc-runner.mjs") ||
    runtimePath !== resolve(rootPath, "node")
  )
    throw new TypeError("candidate-filesystem:layout-refused");
  requireProfile(parentPath, { directory: true, gid, mode: 0o710, uid: lstatSync(parentPath).uid });
  if (lstatSync(parentPath).uid === BigInt(uid))
    throw new TypeError("candidate-filesystem:parent-owner-refused");
  requireProfile(rootPath, { directory: true, gid, mode: 0o510, uid: 0 });
  requireProfile(candidatePath, { directory: false, gid, mode: 0o550, uid: 0 });
  requireProfile(rpcPath, { directory: false, gid, mode: 0o550, uid: 0 });
  requireProfile(runtimePath, { directory: false, gid, mode: 0o550, uid: 0 });
  requireProfile(scratchPath, { directory: true, gid, mode: 0o700, uid });

  requireAccess(parentPath, constants.X_OK, "candidate-filesystem:parent-search-refused");
  requireRefusedAccess(parentPath, constants.R_OK, "candidate-filesystem:parent-read-admitted");
  requireRefusedAccess(parentPath, constants.W_OK, "candidate-filesystem:parent-write-admitted");
  try {
    readdirSync(parentPath);
    throw new TypeError("candidate-filesystem:parent-list-admitted");
  } catch (error) {
    if (error instanceof TypeError) throw error;
    if (error?.code !== "EACCES") throw new TypeError("candidate-filesystem:parent-list-refused");
  }
  requireAccess(rootPath, constants.X_OK, "candidate-filesystem:root-search-refused");
  requireRefusedAccess(rootPath, constants.R_OK, "candidate-filesystem:root-read-admitted");
  requireRefusedAccess(rootPath, constants.W_OK, "candidate-filesystem:root-write-admitted");
  try {
    readdirSync(rootPath);
    throw new TypeError("candidate-filesystem:root-list-admitted");
  } catch (error) {
    if (error instanceof TypeError) throw error;
    if (error?.code !== "EACCES") throw new TypeError("candidate-filesystem:root-list-refused");
  }
  for (const path of [candidatePath, rpcPath, runtimePath]) {
    requireAccess(
      path,
      constants.R_OK | constants.X_OK,
      "candidate-filesystem:file-access-refused",
    );
    requireRefusedAccess(path, constants.W_OK, "candidate-filesystem:file-write-admitted");
  }
  requireAccess(
    scratchPath,
    constants.R_OK | constants.W_OK | constants.X_OK,
    "candidate-filesystem:scratch-access-refused",
  );
}

if (
  ![3, 6].includes(process.argv.length) ||
  typeof process.argv[2] !== "string" ||
  (process.argv.length === 6
    ? process.argv[2] !== "./candidate.mjs"
    : !process.argv[2].startsWith("file:"))
)
  throw new TypeError("candidate-module-url:refused");
if (process.argv.length === 6) {
  if (process.argv[3] !== "--linux-principal")
    throw new TypeError("candidate-principal:mode-refused");
  verifyLinuxPrincipal(process.argv[4], process.argv[5]);
  verifyLinuxFilesystemAccess(process.argv[4], process.argv[5]);
}

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
