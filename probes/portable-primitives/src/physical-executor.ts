import { constants } from "node:fs";
import { lstat, open, readFile, realpath, stat, statfs, type FileHandle } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { canonicalPortablePrimitiveCustodyRoot } from "./executor.js";
import {
  derivePortablePhysicalIdentity,
  portableStatfsTypeU64Hex,
  portableU32Hex,
  portableU64Hex,
  type PortablePhysicalDerivation,
  type PortablePhysicalOperatingSystem,
} from "./physical.js";

const namespaceFilename = ".orchestration-custody-namespace";
const existingLeafName = "existing-leaf";
const absentLeafName = "absent-leaf";

export type PortablePhysicalBaseCaseId = "PHYSICAL_ABSENT_LEAF" | "PHYSICAL_EXISTING";

interface RootSnapshot {
  readonly filesystemType: bigint;
  readonly handleDevice: bigint;
  readonly handleInode: bigint;
  readonly handleMode: bigint;
  readonly namespaceFileHex: string;
  readonly pathDevice: bigint;
  readonly pathInode: bigint;
  readonly pathMode: bigint;
  readonly realpath: string;
}

export interface PortableRootRawObservation {
  readonly filesystemTypeBytes: string;
  readonly handleDeviceBytes: string;
  readonly handleInodeBytes: string;
  readonly handleModeBytes: string;
  readonly namespaceFileHex: string;
  readonly pathDeviceBytes: string;
  readonly pathInodeBytes: string;
  readonly pathModeBytes: string;
}

interface ExistingLeafSnapshot {
  readonly disposition: "EXISTING";
  readonly lstatDevice: bigint;
  readonly lstatInode: bigint;
  readonly lstatMode: bigint;
  readonly realpath: string;
  readonly statDevice: bigint;
  readonly statInode: bigint;
  readonly statMode: bigint;
}

interface AbsentLeafSnapshot {
  readonly disposition: "ABSENT";
  readonly errorCode: "ENOENT";
}

type LeafSnapshot = AbsentLeafSnapshot | ExistingLeafSnapshot;

export type PortableLeafRawObservation =
  | Readonly<{ disposition: "ABSENT"; errorCode: "ENOENT" }>
  | Readonly<{
      disposition: "EXISTING";
      lstatDeviceBytes: string;
      lstatInodeBytes: string;
      lstatModeBytes: string;
      statDeviceBytes: string;
      statInodeBytes: string;
      statModeBytes: string;
    }>;

export interface PortablePhysicalBaseRawFacts {
  readonly caseId: PortablePhysicalBaseCaseId;
  readonly derivation: PortablePhysicalDerivation | null;
  readonly leafAfter: PortableLeafRawObservation;
  readonly leafBefore: PortableLeafRawObservation;
  readonly leafStable: boolean;
  readonly operatingSystem: PortablePhysicalOperatingSystem;
  readonly rootAfter: PortableRootRawObservation;
  readonly rootBefore: PortableRootRawObservation;
  readonly rootRealpathStable: boolean;
  readonly rootStable: boolean;
}

function physicalOperatingSystem(): PortablePhysicalOperatingSystem {
  if (process.platform === "darwin") return "DARWIN";
  if (process.platform === "linux") return "LINUX";
  if (process.platform === "win32") return "WINDOWS";
  throw new Error("operatingSystem:unsupported");
}

function canonicalLeafBytes(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function createOnceSyncedFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
  try {
    if (bytes.byteLength > 0) await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function initializePortableProbeCustodyNamespace(root: string): Promise<void> {
  const namespaceBytes = randomBytes(32);
  const namespacePath = resolve(root, namespaceFilename);
  await createOnceSyncedFile(namespacePath, namespaceBytes);
  const readback = await readFile(namespacePath);
  if (!readback.equals(namespaceBytes)) throw new Error("custodyNamespace:readback-mismatch");
}

async function observeRoot(root: string, rootHandle: FileHandle): Promise<RootSnapshot> {
  const [handleIdentity, pathLstat, pathStat, filesystem, resolvedRoot, namespaceBytes] =
    await Promise.all([
      rootHandle.stat({ bigint: true }),
      lstat(root, { bigint: true }),
      stat(root, { bigint: true }),
      statfs(root, { bigint: true }),
      realpath(root),
      readFile(resolve(root, namespaceFilename)),
    ]);
  if (
    !handleIdentity.isDirectory() ||
    !pathLstat.isDirectory() ||
    pathLstat.isSymbolicLink() ||
    !pathStat.isDirectory() ||
    namespaceBytes.byteLength !== 32 ||
    pathLstat.dev !== pathStat.dev ||
    pathLstat.ino !== pathStat.ino ||
    pathLstat.mode !== pathStat.mode
  )
    throw new Error("custodyRoot:readback-refused");
  return Object.freeze({
    filesystemType: filesystem.type,
    handleDevice: handleIdentity.dev,
    handleInode: handleIdentity.ino,
    handleMode: handleIdentity.mode,
    namespaceFileHex: namespaceBytes.toString("hex"),
    pathDevice: pathStat.dev,
    pathInode: pathStat.ino,
    pathMode: pathStat.mode,
    realpath: resolvedRoot,
  });
}

async function observeLeaf(
  path: string,
  caseId: PortablePhysicalBaseCaseId,
): Promise<LeafSnapshot> {
  if (caseId === "PHYSICAL_ABSENT_LEAF") {
    try {
      await lstat(path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return Object.freeze({ disposition: "ABSENT", errorCode: "ENOENT" });
      throw error;
    }
    throw new Error("physicalLeaf:unexpected-presence");
  }
  const [linkIdentity, followedIdentity, resolvedLeaf] = await Promise.all([
    lstat(path, { bigint: true }),
    stat(path, { bigint: true }),
    realpath(path),
  ]);
  if (
    !linkIdentity.isFile() ||
    linkIdentity.isSymbolicLink() ||
    !followedIdentity.isFile() ||
    linkIdentity.dev !== followedIdentity.dev ||
    linkIdentity.ino !== followedIdentity.ino ||
    linkIdentity.mode !== followedIdentity.mode
  )
    throw new Error("physicalLeaf:readback-refused");
  return Object.freeze({
    disposition: "EXISTING",
    lstatDevice: linkIdentity.dev,
    lstatInode: linkIdentity.ino,
    lstatMode: linkIdentity.mode,
    realpath: resolvedLeaf,
    statDevice: followedIdentity.dev,
    statInode: followedIdentity.ino,
    statMode: followedIdentity.mode,
  });
}

function publicRoot(snapshot: RootSnapshot): PortableRootRawObservation {
  return Object.freeze({
    filesystemTypeBytes: portableStatfsTypeU64Hex(snapshot.filesystemType),
    handleDeviceBytes: portableU64Hex(snapshot.handleDevice, "handleDevice"),
    handleInodeBytes: portableU64Hex(snapshot.handleInode, "handleInode"),
    handleModeBytes: portableU32Hex(snapshot.handleMode, "handleMode"),
    namespaceFileHex: snapshot.namespaceFileHex,
    pathDeviceBytes: portableU64Hex(snapshot.pathDevice, "pathDevice"),
    pathInodeBytes: portableU64Hex(snapshot.pathInode, "pathInode"),
    pathModeBytes: portableU32Hex(snapshot.pathMode, "pathMode"),
  });
}

function publicLeaf(snapshot: LeafSnapshot): PortableLeafRawObservation {
  if (snapshot.disposition === "ABSENT") return snapshot;
  return Object.freeze({
    disposition: "EXISTING",
    lstatDeviceBytes: portableU64Hex(snapshot.lstatDevice, "leafLstatDevice"),
    lstatInodeBytes: portableU64Hex(snapshot.lstatInode, "leafLstatInode"),
    lstatModeBytes: portableU32Hex(snapshot.lstatMode, "leafLstatMode"),
    statDeviceBytes: portableU64Hex(snapshot.statDevice, "leafStatDevice"),
    statInodeBytes: portableU64Hex(snapshot.statInode, "leafStatInode"),
    statModeBytes: portableU32Hex(snapshot.statMode, "leafStatMode"),
  });
}

function rootIdentityStable(before: RootSnapshot, after: RootSnapshot): boolean {
  return (
    before.filesystemType === after.filesystemType &&
    before.handleDevice === after.handleDevice &&
    before.handleInode === after.handleInode &&
    before.handleMode === after.handleMode &&
    before.namespaceFileHex === after.namespaceFileHex &&
    before.pathDevice === after.pathDevice &&
    before.pathInode === after.pathInode &&
    before.pathMode === after.pathMode &&
    before.handleDevice === before.pathDevice &&
    before.handleInode === before.pathInode &&
    before.handleMode === before.pathMode &&
    after.handleDevice === after.pathDevice &&
    after.handleInode === after.pathInode &&
    after.handleMode === after.pathMode
  );
}

function leafIdentityStable(before: LeafSnapshot, after: LeafSnapshot): boolean {
  if (before.disposition !== after.disposition) return false;
  if (before.disposition === "ABSENT" || after.disposition === "ABSENT")
    return before.disposition === "ABSENT" && after.disposition === "ABSENT";
  return (
    before.lstatDevice === after.lstatDevice &&
    before.lstatInode === after.lstatInode &&
    before.lstatMode === after.lstatMode &&
    before.statDevice === after.statDevice &&
    before.statInode === after.statInode &&
    before.statMode === after.statMode &&
    before.realpath === after.realpath
  );
}

async function executePortablePhysicalBaseCase(
  root: string,
  rootHandle: FileHandle,
  caseId: PortablePhysicalBaseCaseId,
): Promise<PortablePhysicalBaseRawFacts> {
  const operatingSystem = physicalOperatingSystem();
  const leafName = caseId === "PHYSICAL_EXISTING" ? existingLeafName : absentLeafName;
  const leafPath = resolve(root, leafName);
  const rootBefore = await observeRoot(root, rootHandle);
  if (caseId === "PHYSICAL_EXISTING") await createOnceSyncedFile(leafPath, new Uint8Array());
  const leafBefore = await observeLeaf(leafPath, caseId);
  const rootAfter = await observeRoot(root, rootHandle);
  const leafAfter = await observeLeaf(leafPath, caseId);
  const rootStable = rootIdentityStable(rootBefore, rootAfter);
  const rootRealpathStable = rootBefore.realpath === root && rootAfter.realpath === root;
  const leafStable = leafIdentityStable(leafBefore, leafAfter);
  const derivation =
    rootStable && rootRealpathStable && leafStable
      ? derivePortablePhysicalIdentity({
          canonicalPhysicalLeafBytes: canonicalLeafBytes(leafName),
          filesystemType: rootBefore.filesystemType,
          leafIdentityKind:
            caseId === "PHYSICAL_EXISTING" ? "EXISTING_DIRECTORY_ENTRY" : "ABSENT_DIRECTORY_ENTRY",
          namespaceFileHex: rootBefore.namespaceFileHex,
          operatingSystem,
          rootStatDevice: rootBefore.handleDevice,
          rootStatInode: rootBefore.handleInode,
          rootStatMode: rootBefore.handleMode,
        })
      : null;
  return Object.freeze({
    caseId,
    derivation,
    leafAfter: publicLeaf(leafAfter),
    leafBefore: publicLeaf(leafBefore),
    leafStable,
    operatingSystem,
    rootAfter: publicRoot(rootAfter),
    rootBefore: publicRoot(rootBefore),
    rootRealpathStable,
    rootStable,
  });
}

export async function executePortablePhysicalBaseProbe(
  custodyRoot: string,
): Promise<readonly [PortablePhysicalBaseRawFacts, PortablePhysicalBaseRawFacts]> {
  const root = await canonicalPortablePrimitiveCustodyRoot(custodyRoot);
  const rootHandle = await open(root, constants.O_RDONLY);
  try {
    await initializePortableProbeCustodyNamespace(root);
    const existing = await executePortablePhysicalBaseCase(root, rootHandle, "PHYSICAL_EXISTING");
    const absent = await executePortablePhysicalBaseCase(root, rootHandle, "PHYSICAL_ABSENT_LEAF");
    return Object.freeze([existing, absent] as const);
  } finally {
    await rootHandle.close();
  }
}
