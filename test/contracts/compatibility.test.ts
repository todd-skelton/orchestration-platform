import { describe, expect, test } from "vitest";
import {
  compatibilityDisposition,
  compatibilityMatrix,
  parseCanonicalContractBytes,
  schemaVersions,
} from "../../packages/contracts/src/index.js";

describe("compatibility", () => {
  test("reads only exact current versions and refuses legacy, future, missing, and unknown versions", () => {
    expect(schemaVersions).toContain("platform-configuration/v1");
    for (const expected of schemaVersions) {
      const family = expected.slice(0, expected.lastIndexOf("/"));
      expect(compatibilityDisposition(expected, expected)).toBe("readable");
      expect(compatibilityDisposition(expected, `${family}/v999`)).toBe("refused");
      expect(compatibilityDisposition(expected, null)).toBe("refused");
    }
    expect(
      compatibilityDisposition("platform-configuration/v1", "platform-configuration/v0-fixture"),
    ).toBe("refused");
    expect(compatibilityDisposition("unknown/v1", "unknown/v1")).toBe("refused");
    expect(compatibilityMatrix.every((row) => row.expectedSchemaVersion.endsWith("/v1"))).toBe(
      true,
    );
  });

  test("snapshots canonical bytes for active configuration and cycle consumers", () => {
    for (const schemaVersion of [
      "platform-configuration/v1",
      "adapter-configuration/v1",
      "cycle-request/v1",
      "review-authority/v1",
      "worker-terminal-receipt/v1",
    ]) {
      const shared = new Uint8Array(new SharedArrayBuffer(1));
      expect(parseCanonicalContractBytes(schemaVersion, shared)).toEqual({
        ok: false,
        issues: ["encoding:shared-bytes-refused"],
      });
    }

    const cycleRequest =
      '{"adapterId":"fixture.adapter","allowedModuleIds":["module.a"],"cycleId":"01900000-0000-7000-8000-000000000002","schemaVersion":"cycle-request/v1","sessionRequest":{"configurationPathsDigest":"7834e7450cf229794a95eca85c63b00e2147b9dc04e5b15936c26e6421b7735a","configurationProvenanceDigest":"68f259a032cd1ee5067a1701c07edc10e8dea60ed75358803d96f23103bdaac4","configurationSourceDigest":"d344533a93e761fe0422eb3ab275f5183581975bcf1a38bbee38fe5d009c7c88","schemaVersion":"session-acquire-request/v1","sessionId":"01900000-0000-7000-8000-000000000001"}}\n';
    const payload = new TextEncoder().encode(cycleRequest);
    const storage = new Uint8Array(payload.byteLength + 8);
    storage.fill(0xff);
    storage.set(payload, 4);
    const sliced = new Uint8Array(storage.buffer, 4, payload.byteLength);
    expect(parseCanonicalContractBytes("cycle-request/v1", sliced).ok).toBe(true);
    expect(parseCanonicalContractBytes("cycle-request/v1", Buffer.from(payload)).ok).toBe(true);

    const spoofed = Object.setPrototypeOf(new Uint16Array(4), Uint8Array.prototype);
    expect(
      parseCanonicalContractBytes("cycle-request/v1", spoofed as unknown as Uint8Array),
    ).toEqual({ ok: false, issues: ["encoding:bytes-required"] });
  });
});
