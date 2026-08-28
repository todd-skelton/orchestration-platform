import {
  canonicalBytes,
  parseCanonicalContractBytes,
  snapshotClosedArray,
  snapshotClosedRecord,
  type ContractRecord,
} from "@orchestration-platform/contracts";

const rowFields = Object.freeze(["bytesBase64url", "caseId", "expectedSchemaVersion"] as const);

function refuse(): never {
  process.stderr.write("parser-child:refused\n");
  process.exitCode = 2;
  process.disconnect?.();
  throw new Error("parser-child:refused");
}

process.once("message", (message) => {
  try {
    const request = snapshotClosedRecord(message, ["corpus", "schemaVersion"]);
    if (
      !request.ok ||
      request.value.schemaVersion !== "portable-primitives-parser-child-request/v1"
    )
      return refuse();
    const corpus = snapshotClosedArray(request.value.corpus);
    if (!corpus.ok) return refuse();
    const results: ContractRecord[] = [];
    for (const input of corpus.value) {
      const row = snapshotClosedRecord(input, rowFields);
      if (
        !row.ok ||
        typeof row.value.bytesBase64url !== "string" ||
        typeof row.value.caseId !== "string" ||
        typeof row.value.expectedSchemaVersion !== "string"
      )
        return refuse();
      const bytes = Buffer.from(row.value.bytesBase64url, "base64url");
      if (bytes.toString("base64url") !== row.value.bytesBase64url) return refuse();
      const parsed = parseCanonicalContractBytes(row.value.expectedSchemaVersion, bytes);
      results.push(
        Object.freeze({
          caseId: row.value.caseId,
          issues: Object.freeze(parsed.ok ? [] : [...new Set(parsed.issues)].sort()),
          normalizedRecordBase64url: parsed.ok
            ? Buffer.from(canonicalBytes(parsed.value)).toString("base64url")
            : null,
          result: parsed.ok ? "READABLE" : "REFUSED",
          schemaVersion: "portable-primitives-parser-result/v1",
        }),
      );
    }
    const normalized = canonicalBytes(
      Object.freeze({
        results: Object.freeze(results),
        schemaVersion: "portable-primitives-parser-normalized/v1",
      }),
    );
    if (typeof process.send !== "function") return refuse();
    process.send(
      {
        normalizedBytesBase64url: Buffer.from(normalized).toString("base64url"),
        schemaVersion: "portable-primitives-parser-child-response/v1",
      },
      undefined,
      undefined,
      () => process.disconnect?.(),
    );
  } catch {
    refuse();
  }
});
