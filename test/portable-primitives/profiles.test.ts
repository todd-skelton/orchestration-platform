import { describe, expect, test } from "vitest";
import * as portable from "../../probes/portable-primitives/src/index.js";

const d = (value: string) => value.repeat(64);
const osProfile = Object.freeze({
  caseComparisonProfile: "CASE_SENSITIVE",
  filesystemTypeBytes: "000000000000ef53",
  helperAbiDigest: d("1"),
  helperDigest: d("2"),
  operatingSystem: "LINUX",
  schemaVersion: "portable-primitives-os-profile/v1",
  statDeviceBytes: "0000000000000801",
  unicodeNormalizationProfile: "NFC",
  vectorCensusDigest: d("3"),
});
const custodyReceipt = Object.freeze({
  custodyInstanceDigest: d("4"),
  helperAbiDigest: osProfile.helperAbiDigest,
  helperDigest: osProfile.helperDigest,
  observedAt: "2026-08-28T00:00:00.000Z",
  osProfileDigest: portable.computePortablePrimitivesOsProfileDigest(osProfile),
  physicalDestinationIdentityDigest: d("5"),
  rootReadbackDigest: d("6"),
  schemaVersion: "portable-probe-custody-receipt/v1",
});

describe("ISS-022 helper, profile, and custody identities", () => {
  test("pins the exact helper and custody domains", () => {
    const abi = portable.computePortableNodeAbiDigest("24.15.0", "137", "10");
    const helper = portable.computePortableNodeHelperDigest(d("a"), "24.15.0", abi);
    expect(abi).toBe("86cff00d1da680cbf42ee1687f26359de783ae256e88caa48d3f3c073da0fda3");
    expect(helper).toBe("7b7bbec15215bb917cc6d93f47cc8e370cc7cbd5f47e22c9539de44b2ef6fd04");
    expect(portable.computePortableNodeHelperProfileDigest(helper, abi)).toBe(
      "87131373dfd68ac31d7f9f608e688cf42f8e96bfc0a6c0f97b68490d4fc9c3ea",
    );
    expect(portable.computePortableHostCustodyNamespaceDigest(d("b"))).toBe(
      "c52dd915426c173ab293920f6cac686d0dad1d06ba959cada25c5846a3322e25",
    );
    expect(portable.computePortableCustodyProfileDigest()).toBe(
      "d01b36552a70cdb11cd1e8baf9df096c515158ca0dd3019176c2c83b6d7eb33d",
    );
  });

  test("parses and hashes the closed OS profile and custody receipt", () => {
    expect(portable.parsePortablePrimitivesOsProfile(osProfile).ok).toBe(true);
    expect(portable.computePortablePrimitivesOsProfileDigest(osProfile)).toBe(
      "29ecd55bc914d6c711454b734e9a25bf5237377ffb4de71f75b424a0231487ac",
    );
    expect(portable.parsePortableProbeCustodyReceipt(custodyReceipt).ok).toBe(true);
    expect(portable.computePortableProbeCustodyReceiptDigest(custodyReceipt)).toBe(
      "b3ca13144edfbcac98c79813f3089d8143b7660394e63ba8e502b8cec3458b62",
    );
  });

  test("refuses profile width, enum, digest, time, and field mutants", () => {
    for (const mutant of [
      { ...osProfile, statDeviceBytes: "801" },
      { ...osProfile, filesystemTypeBytes: "000000000000EF53" },
      { ...osProfile, operatingSystem: "DARWIN" },
      { ...osProfile, operatingSystem: "MACOS" },
      { ...osProfile, caseComparisonProfile: "UNKNOWN" },
      { ...osProfile, helperDigest: d("g") },
      { ...osProfile, extra: true },
    ])
      expect(portable.parsePortablePrimitivesOsProfile(mutant).ok).toBe(false);
    for (const mutant of [
      { ...custodyReceipt, observedAt: "2026-08-28T00:00:00Z" },
      { ...custodyReceipt, rootReadbackDigest: null },
      { ...custodyReceipt, extra: true },
    ])
      expect(portable.parsePortableProbeCustodyReceipt(mutant).ok).toBe(false);
  });

  test("refuses noncanonical helper inputs before hashing", () => {
    expect(() => portable.computePortableNodeAbiDigest("v24.15.0", "137", "10")).toThrow();
    expect(() => portable.computePortableNodeAbiDigest("24.15.0", "0137", "10")).toThrow();
    expect(() => portable.computePortableNodeHelperDigest(d("g"), "24.15.0", d("1"))).toThrow();
    expect(() => portable.computePortableHostCustodyNamespaceDigest("00")).toThrow();
  });
});
