import { describe, expect, test } from "vitest";
import {
  computePortableAncestorObjectDigest,
  computePortableCustodyRootReadbackDigest,
  computePortableFilesystemDigest,
  computePortableLogicalLocatorDigest,
  computePortableNativeIdentityReadbackDigest,
  computePortablePhysicalVolumeDigest,
  computePortablePrimitivesPreCustodyEnvironmentDigest,
  computePortableProbeCustodyInstanceDigest,
  computePortableResolvedLocatorReadbackDigest,
  derivePortablePhysicalIdentity,
  portableStatfsTypeU64Hex,
  portableU32Hex,
  portableU64Hex,
} from "../../probes/portable-primitives/src/index.js";

const d = (value: string) => value.repeat(64);
const leaf = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const input = Object.freeze({
  canonicalPhysicalLeafBytes: leaf("absent-leaf"),
  filesystemType: 0xef53n,
  leafIdentityKind: "ABSENT_DIRECTORY_ENTRY" as const,
  namespaceFileHex: d("b"),
  operatingSystem: "LINUX" as const,
  rootStatDevice: 0x801n,
  rootStatInode: 0x1122334455667788n,
  rootStatMode: 0x41c0n,
});

describe("ISS-022 literal physical identity derivations", () => {
  test("pins every ordered physical component and existing Dphys/Ddest route", () => {
    const result = derivePortablePhysicalIdentity(input);
    expect({
      ancestor: result.ancestorObjectIdentityDigest,
      destination: result.destinationDigest,
      filesystem: result.filesystemIdentityDigest,
      hostNamespace: result.hostCustodyNamespaceDigest,
      logical: result.logicalLocatorDigest,
      native: result.nativeIdentityReadbackDigest,
      physical: result.physicalDestinationIdentityDigest,
      resolved: result.resolvedLocatorReadbackDigest,
      rootReadback: result.rootReadbackDigest,
      volume: result.physicalVolumeIdentityDigest,
    }).toEqual({
      ancestor: "f205e4fc27ef6a80b296782fe00e0b6118212dbb916739ae38ba2818ab766d42",
      destination: "f423e5d8c8ebb791708c8ebc56017b2106f6f6062bc2045efa9aa697ea8e6ee9",
      filesystem: "24de3ac0eff95462828236ab53f176565fdbff6c7908b4dd8587d50fc50e93f8",
      hostNamespace: "c52dd915426c173ab293920f6cac686d0dad1d06ba959cada25c5846a3322e25",
      logical: "db91e5c9bceeb893c89a84aab5bc05d27ebdc820a6b57cbcc73f573f2ed71dce",
      native: "aa72bc17f55931e6f756aef59f79b4133bc709ba43f6b7863adf01a390eaf2a6",
      physical: "1652839b6a7c43f2fc992ee806ccf16e605c9e0b3ca1b5d377e6ffea89f26b49",
      resolved: "15e066705eb040c9b044badb1bb33dea68319353e759c0f429c25cacff333d83",
      rootReadback: "89a62ab164c0ea180d48faceb6edf95b7b23f1b696b152303b6ac4593fd040a3",
      volume: "99290c005944cc0f21b887856113cca4109538955c54a4f7cfe8b07455f646f4",
    });
    expect(result.statDeviceBytes).toBe("0000000000000801");
    expect(result.filesystemTypeBytes).toBe("000000000000ef53");
    expect(result.physicalDestinationIdentity).toEqual({
      ancestorObjectIdentityDigest: result.ancestorObjectIdentityDigest,
      canonicalPhysicalLeafBytes: input.canonicalPhysicalLeafBytes,
      filesystemIdentityDigest: result.filesystemIdentityDigest,
      hostCustodyNamespaceDigest: result.hostCustodyNamespaceDigest,
      leafIdentityKind: "ABSENT_DIRECTORY_ENTRY",
      operatingSystem: "LINUX",
      physicalVolumeIdentityDigest: result.physicalVolumeIdentityDigest,
      schemaVersion: "physical-destination-identity/v1",
    });
  });

  test("component helpers reproduce the composed derivation exactly", () => {
    const result = derivePortablePhysicalIdentity(input);
    expect(
      computePortablePhysicalVolumeDigest(
        result.hostCustodyNamespaceDigest,
        input.operatingSystem,
        input.rootStatDevice,
      ),
    ).toBe(result.physicalVolumeIdentityDigest);
    expect(
      computePortableFilesystemDigest(
        result.physicalVolumeIdentityDigest,
        input.operatingSystem,
        input.filesystemType,
      ),
    ).toBe(result.filesystemIdentityDigest);
    expect(
      computePortableAncestorObjectDigest(
        result.physicalVolumeIdentityDigest,
        result.filesystemIdentityDigest,
        input.rootStatDevice,
        input.rootStatInode,
        input.rootStatMode,
      ),
    ).toBe(result.ancestorObjectIdentityDigest);
    expect(
      computePortableLogicalLocatorDigest(
        result.hostCustodyNamespaceDigest,
        input.canonicalPhysicalLeafBytes,
        input.operatingSystem,
      ),
    ).toBe(result.logicalLocatorDigest);
    expect(
      computePortableResolvedLocatorReadbackDigest(
        result.ancestorObjectIdentityDigest,
        input.canonicalPhysicalLeafBytes,
        input.operatingSystem,
      ),
    ).toBe(result.resolvedLocatorReadbackDigest);
    expect(
      computePortableNativeIdentityReadbackDigest(
        result.physicalVolumeIdentityDigest,
        result.filesystemIdentityDigest,
        result.ancestorObjectIdentityDigest,
        input.leafIdentityKind,
      ),
    ).toBe(result.nativeIdentityReadbackDigest);
    expect(
      computePortableCustodyRootReadbackDigest(
        result.hostCustodyNamespaceDigest,
        result.physicalVolumeIdentityDigest,
        result.filesystemIdentityDigest,
        result.ancestorObjectIdentityDigest,
      ),
    ).toBe(result.rootReadbackDigest);
  });

  test("uses fixed-width unsigned stat bytes and the signed statfs projection", () => {
    expect(portableU64Hex(0n)).toBe("0000000000000000");
    expect(portableU64Hex((1n << 64n) - 1n)).toBe("ffffffffffffffff");
    expect(portableU32Hex(0n)).toBe("00000000");
    expect(portableU32Hex((1n << 32n) - 1n)).toBe("ffffffff");
    expect(portableStatfsTypeU64Hex(-1n)).toBe("ffffffffffffffff");
    for (const invalid of [-1n, 1n << 64n]) expect(() => portableU64Hex(invalid)).toThrow();
    for (const invalid of [-1n, 1n << 32n]) expect(() => portableU32Hex(invalid)).toThrow();
  });

  test("moves the required identities when any physical input moves", () => {
    const baseline = derivePortablePhysicalIdentity(input);
    const mutants = [
      { ...input, namespaceFileHex: d("c") },
      { ...input, rootStatDevice: 0x802n },
      { ...input, rootStatInode: input.rootStatInode + 1n },
      { ...input, rootStatMode: input.rootStatMode + 1n },
      { ...input, filesystemType: input.filesystemType + 1n },
      { ...input, canonicalPhysicalLeafBytes: leaf("other-leaf") },
      { ...input, leafIdentityKind: "EXISTING_DIRECTORY_ENTRY" as const },
    ];
    for (const mutant of mutants) {
      const changed = derivePortablePhysicalIdentity(mutant);
      expect(changed.physicalDestinationIdentityDigest).not.toBe(
        baseline.physicalDestinationIdentityDigest,
      );
      expect(changed.destinationDigest).not.toBe(baseline.destinationDigest);
    }
  });

  test("binds root readback into the provider/job-specific custody instance", () => {
    const result = derivePortablePhysicalIdentity(input);
    const preCustodyEnvironment = computePortablePrimitivesPreCustodyEnvironmentDigest(
      d("1"),
      "X64",
      d("2"),
      d("3"),
      "24.15.0",
      "LINUX",
      d("4"),
      "11.22.0",
    );
    const custody = computePortableProbeCustodyInstanceDigest(
      result.hostCustodyNamespaceDigest,
      preCustodyEnvironment,
      d("2"),
      "node24-linux",
      result.rootReadbackDigest,
    );
    expect(custody).toMatch(/^[0-9a-f]{64}$/);
    expect(
      computePortableProbeCustodyInstanceDigest(
        result.hostCustodyNamespaceDigest,
        preCustodyEnvironment,
        d("2"),
        "node24-windows",
        result.rootReadbackDigest,
      ),
    ).not.toBe(custody);
    expect(() =>
      computePortableProbeCustodyInstanceDigest(
        result.hostCustodyNamespaceDigest,
        preCustodyEnvironment,
        d("2"),
        "bad job",
        result.rootReadbackDigest,
      ),
    ).toThrow();
    for (const invalid of [1, true, null])
      expect(() =>
        computePortableProbeCustodyInstanceDigest(
          result.hostCustodyNamespaceDigest,
          preCustodyEnvironment,
          d("2"),
          invalid as never,
          result.rootReadbackDigest,
        ),
      ).toThrow();
  });

  test("pins the ordered pre-custody environment identity and rejects substitutions", () => {
    const values = [d("1"), "X64", d("2"), d("3"), "24.15.0", "LINUX", d("4"), "11.22.0"] as const;
    const baseline = computePortablePrimitivesPreCustodyEnvironmentDigest(...values);
    expect(baseline).toBe("2369289b0401bfdfc69c5e41cd9565f3f1b7e12dca44d2512a8e362fad131a2a");
    const mutants = [
      [d("5"), ...values.slice(1)],
      [values[0], "ARM64", ...values.slice(2)],
      [...values.slice(0, 2), d("5"), ...values.slice(3)],
      [...values.slice(0, 3), d("5"), ...values.slice(4)],
      [...values.slice(0, 4), "24.16.0", ...values.slice(5)],
      [...values.slice(0, 5), "WINDOWS", ...values.slice(6)],
      [...values.slice(0, 6), d("5"), values[7]],
      [...values.slice(0, 7), "11.23.0"],
    ] as const;
    for (const mutant of mutants)
      expect(
        computePortablePrimitivesPreCustodyEnvironmentDigest(...(mutant as typeof values)),
      ).not.toBe(baseline);
    for (const invalid of [
      [d("1"), "IA32", d("2"), d("3"), "24.15.0", "LINUX", d("4"), "11.22.0"],
      [d("1"), "X64", d("2"), d("3"), "v24.15.0", "LINUX", d("4"), "11.22.0"],
      [d("1"), "X64", d("2"), d("3"), "24.15.0", "DARWIN", d("4"), "11.22.0"],
      [d("1"), "X64", d("2"), d("3"), "24.15.0", "LINUX", d("4"), "11.22.0-beta"],
    ])
      expect(() =>
        computePortablePrimitivesPreCustodyEnvironmentDigest(
          ...(invalid as unknown as typeof values),
        ),
      ).toThrow();
  });

  test("refuses width, digest, namespace, leaf, OS, and kind substitutions", () => {
    for (const mutant of [
      { ...input, namespaceFileHex: "00" },
      { ...input, rootStatDevice: -1n },
      { ...input, rootStatInode: 1n << 64n },
      { ...input, rootStatMode: 1n << 32n },
      { ...input, canonicalPhysicalLeafBytes: leaf("../escape") },
      { ...input, operatingSystem: "MACOS" as never },
      { ...input, leafIdentityKind: "SYMLINK" as never },
    ])
      expect(() => derivePortablePhysicalIdentity(mutant)).toThrow();
    expect(() => computePortablePhysicalVolumeDigest(d("g"), "LINUX", 1n)).toThrow();
  });
});
