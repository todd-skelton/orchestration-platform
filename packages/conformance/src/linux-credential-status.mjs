import { types as nodeTypes } from "node:util";

// BEGIN LINUX_CREDENTIAL_VERIFIER
const credentialArrayPrototype = Array.prototype;
const credentialDescriptors = Object.getOwnPropertyDescriptors.bind(Object);
const credentialPrototype = Object.getPrototypeOf.bind(Object);
const credentialOwnKeys = Reflect.ownKeys.bind(Reflect);
const credentialIsArray = Array.isArray.bind(Array);
const credentialIsProxy = nodeTypes.isProxy.bind(nodeTypes);
const credentialSafeDecimal = /^(?:0|[1-9][0-9]*)$/;
const credentialMaximumIdentity = 2_147_483_646;
const credentialMinimumIdentity = 1_000_000;

function detachedCredentialInput(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    credentialIsProxy(input) ||
    ![Object.prototype, null].includes(credentialPrototype(input))
  )
    return undefined;
  const fields = [
    "effectiveGid",
    "effectiveUid",
    "expectedGid",
    "expectedUid",
    "groups",
    "realGid",
    "realUid",
    "statusText",
  ];
  const descriptors = credentialDescriptors(input);
  const keys = credentialOwnKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  const value = Object.create(null);
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    value[field] = descriptor.value;
  }
  if (
    typeof value.expectedGid !== "string" ||
    typeof value.expectedUid !== "string" ||
    typeof value.statusText !== "string" ||
    ![value.effectiveGid, value.effectiveUid, value.realGid, value.realUid].every((identity) =>
      Number.isSafeInteger(identity),
    ) ||
    !credentialIsArray(value.groups) ||
    credentialIsProxy(value.groups) ||
    credentialPrototype(value.groups) !== credentialArrayPrototype
  )
    return undefined;
  const groupDescriptors = credentialDescriptors(value.groups);
  const lengthDescriptor = groupDescriptors.length;
  if (
    credentialOwnKeys(groupDescriptors).join("\0") !== "0\0length" ||
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.value !== 1 ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.configurable !== false ||
    !groupDescriptors["0"] ||
    !("value" in groupDescriptors["0"]) ||
    groupDescriptors["0"].enumerable !== true ||
    !Number.isSafeInteger(groupDescriptors["0"].value)
  )
    return undefined;
  return { ...value, groups: [groupDescriptors["0"].value] };
}

function credentialStatusField(statusText, name) {
  const prefix = `${name}:`;
  const values = statusText
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  return values.length === 1 ? values[0] : undefined;
}

function verifyLinuxCredentialStatus(input) {
  try {
    const value = detachedCredentialInput(input);
    if (
      !value ||
      !credentialSafeDecimal.test(value.expectedUid) ||
      !credentialSafeDecimal.test(value.expectedGid)
    )
      return false;
    const uid = Number(value.expectedUid);
    const gid = Number(value.expectedGid);
    if (
      !Number.isSafeInteger(uid) ||
      !Number.isSafeInteger(gid) ||
      uid < credentialMinimumIdentity ||
      gid < credentialMinimumIdentity ||
      uid > credentialMaximumIdentity ||
      gid > credentialMaximumIdentity ||
      value.realUid !== uid ||
      value.effectiveUid !== uid ||
      value.realGid !== gid ||
      value.effectiveGid !== gid ||
      value.groups[0] !== gid
    )
      return false;
    if (
      credentialStatusField(value.statusText, "Uid") !== [uid, uid, uid, uid].join("\t") ||
      credentialStatusField(value.statusText, "Gid") !== [gid, gid, gid, gid].join("\t") ||
      credentialStatusField(value.statusText, "Groups") !== "" ||
      credentialStatusField(value.statusText, "NoNewPrivs") !== "1"
    )
      return false;
    for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
      if (!/^0+$/.test(credentialStatusField(value.statusText, field) ?? "")) return false;
    return true;
  } catch {
    return false;
  }
}
// END LINUX_CREDENTIAL_VERIFIER

export { verifyLinuxCredentialStatus };
