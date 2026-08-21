import { describe, expect, test } from "vitest";
import {
  engineVocabularyValueFindings,
  recoveryAuthorizationLifecycles,
  recoveryAuthorizationPaths,
} from "../../packages/contracts/src/index.js";

const transactionId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const operationId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";

describe("recovery authorization state and storage", () => {
  test("exposes only selected state lifecycles; terminal removal is a tombstone", () => {
    expect(recoveryAuthorizationLifecycles).toEqual(["CREATED", "CONSUMED", "REVOKED"]);
    expect(engineVocabularyValueFindings(recoveryAuthorizationLifecycles)).toEqual([]);
  });

  test("constructs transaction and operation paths without native/projection collisions", () => {
    const transactionRoot = `installation/recovery-authorizations/${transactionId}`;
    expect(recoveryAuthorizationPaths.core(transactionId)).toBe(`${transactionRoot}/core.json`);
    expect(recoveryAuthorizationPaths.state(transactionId)).toBe(`${transactionRoot}/state.json`);
    expect(recoveryAuthorizationPaths.attachment(transactionId)).toBe(
      `${transactionRoot}/attachment.json`,
    );
    expect(recoveryAuthorizationPaths.nativeReceipt(transactionId, operationId)).toBe(
      `${transactionRoot}/native/${operationId}.json`,
    );
    expect(recoveryAuthorizationPaths.postSelectionReceipt(transactionId, operationId)).toBe(
      `${transactionRoot}/receipts/${operationId}.json`,
    );
    expect(recoveryAuthorizationPaths.archive(transactionId)).toBe(
      `${transactionRoot}/archive.json`,
    );
    expect(recoveryAuthorizationPaths.attachmentArchive(transactionId)).toBe(
      `${transactionRoot}/attachment-archive.json`,
    );
    expect(recoveryAuthorizationPaths.nativeReceipt(transactionId, operationId)).not.toBe(
      recoveryAuthorizationPaths.postSelectionReceipt(transactionId, operationId),
    );
    expect(() => recoveryAuthorizationPaths.core("not-a-uuid")).toThrow();
    expect(() => recoveryAuthorizationPaths.nativeReceipt(transactionId, "not-a-uuid")).toThrow();
  });
});
