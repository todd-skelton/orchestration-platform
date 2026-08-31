import { types as nodeTypes } from "node:util";
import {
  serializePortablePrimitivesCapabilityDecisionCore,
  serializePortablePrimitivesIndependentReview,
  serializePortablePrimitivesCapabilityDecision,
  validatePortablePrimitivesCapabilityDecision,
} from "./portable-primitives-decision.js";

const serializers = Object.freeze({
  "decision-core.json": serializePortablePrimitivesCapabilityDecisionCore,
  "independent-review.json": serializePortablePrimitivesIndependentReview,
  "decision.json": serializePortablePrimitivesCapabilityDecision,
});

export type PortablePrimitivesPublicationCheck =
  | {
      readonly ok: true;
      readonly decision: "PASS" | "BLOCK_REPLAN";
      readonly decisionCoreDigest: string;
      readonly independentReviewReceiptDigest: string;
      readonly decisionDigest: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Pure layout/byte consistency check, consumed by the receipt verification tests.
 * The caller supplies a repository-relative directory and a filename-to-bytes map.
 * This does not authenticate a checkout, provider, review, run, or consumer profile;
 * even a structurally valid PASS publication grants no authority here.
 */
export function checkPortablePrimitivesPublication(
  directory: unknown,
  files: unknown,
): PortablePrimitivesPublicationCheck {
  try {
    if (
      !files ||
      typeof files !== "object" ||
      nodeTypes.isProxy(files) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(files))
    )
      throw new TypeError("publication:files-refused");
    const descriptors = Object.getOwnPropertyDescriptors(files);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 3 ||
      keys.some((key) => typeof key !== "string" || !Object.hasOwn(serializers, key))
    )
      throw new TypeError("publication:census-refused");
    const records: unknown[] = [];
    const digests: string[] = [];
    for (const [name, serialize] of Object.entries(serializers)) {
      const descriptor = descriptors[name];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw new TypeError("publication:data-files-required");
      const input: unknown = descriptor.value;
      if (
        !(input instanceof Uint8Array) ||
        nodeTypes.isProxy(input) ||
        Object.getPrototypeOf(input) !== Uint8Array.prototype
      )
        throw new TypeError("publication:bytes-required");
      const bytes = new Uint8Array(input);
      const record: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const serialized = serialize(record);
      if (!serialized.ok || !Buffer.from(bytes).equals(Buffer.from(serialized.bytes)))
        throw new TypeError("publication:canonical-record-required");
      records.push(record);
      digests.push(serialized.digest);
    }
    const [decisionCoreDigest, independentReviewReceiptDigest, decisionDigest] = digests;
    if (directory !== `planning/decisions/ISS-022/${decisionCoreDigest}`)
      throw new TypeError("publication:directory-mismatch");
    const joined = validatePortablePrimitivesCapabilityDecision(records[2], records[0], records[1]);
    if (!joined.ok) return joined;
    return {
      ok: true,
      decision: (records[0] as { decision: "PASS" | "BLOCK_REPLAN" }).decision,
      decisionCoreDigest: decisionCoreDigest!,
      independentReviewReceiptDigest: independentReviewReceiptDigest!,
      decisionDigest: decisionDigest!,
    };
  } catch {
    return { ok: false, issues: ["publication:layout-or-bytes-refused"] };
  }
}
