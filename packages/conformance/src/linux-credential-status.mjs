import { types as nodeTypes } from "node:util";

const exactArrayPrototype = Array.prototype;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors.bind(Object);
const getPrototypeOf = Object.getPrototypeOf.bind(Object);
const ownKeys = Reflect.ownKeys.bind(Reflect);
const isArray = Array.isArray.bind(Array);
const isProxy = nodeTypes.isProxy.bind(nodeTypes);
const safeDecimal = /^(?:0|[1-9][0-9]*)$/;
const maximumLinuxIdentity = 2_147_483_646;
const minimumLinuxIdentity = 1_000_000;

function detachedInput(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    isProxy(input) ||
    ![Object.prototype, null].includes(getPrototypeOf(input))
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
  const descriptors = getOwnPropertyDescriptors(input);
  const keys = ownKeys(descriptors);
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
    !isArray(value.groups) ||
    isProxy(value.groups) ||
    getPrototypeOf(value.groups) !== exactArrayPrototype
  )
    return undefined;
  const groupDescriptors = getOwnPropertyDescriptors(value.groups);
  const lengthDescriptor = groupDescriptors.length;
  if (
    ownKeys(groupDescriptors).join("\0") !== "0\0length" ||
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

function statusField(statusText, name) {
  const prefix = `${name}:`;
  const values = statusText
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  return values.length === 1 ? values[0] : undefined;
}

export function verifyLinuxCredentialStatus(input) {
  try {
    const value = detachedInput(input);
    if (!value || !safeDecimal.test(value.expectedUid) || !safeDecimal.test(value.expectedGid))
      return false;
    const uid = Number(value.expectedUid);
    const gid = Number(value.expectedGid);
    if (
      !Number.isSafeInteger(uid) ||
      !Number.isSafeInteger(gid) ||
      uid < minimumLinuxIdentity ||
      gid < minimumLinuxIdentity ||
      uid > maximumLinuxIdentity ||
      gid > maximumLinuxIdentity ||
      value.realUid !== uid ||
      value.effectiveUid !== uid ||
      value.realGid !== gid ||
      value.effectiveGid !== gid ||
      value.groups[0] !== gid
    )
      return false;
    if (
      statusField(value.statusText, "Uid") !== [uid, uid, uid, uid].join("\t") ||
      statusField(value.statusText, "Gid") !== [gid, gid, gid, gid].join("\t") ||
      statusField(value.statusText, "Groups") !== "" ||
      statusField(value.statusText, "NoNewPrivs") !== "1"
    )
      return false;
    for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
      if (!/^0+$/.test(statusField(value.statusText, field) ?? "")) return false;
    return true;
  } catch {
    return false;
  }
}
