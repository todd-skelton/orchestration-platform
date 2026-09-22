// ISS-164: the private request stream exported by the supervisor entry.
import type { Readable, Writable } from "node:stream";
import type { Adapter, NativeDbIdentity, NativeDbOwner, NativeDbReply } from "./flow.js";

export const NATIVE_DB_REQUEST_SCHEMA: "dogfood-native-db-request/v1";
export const NATIVE_DB_REPLY_SCHEMA: "dogfood-native-db-reply/v1";
export const NATIVE_DB_PROFILE: "reconciliation-pg16/v1";
export const NATIVE_DB_REQUEST_LIMIT: 65536;
export const NATIVE_DB_REPLY_LIMIT: 8192;
export const NATIVE_DB_REQUEST_KEYS: readonly string[];
export const NATIVE_DB_REPLY_KEYS: readonly string[];

export type NativeDbStatus = NativeDbReply["status"];
export type { NativeDbOwner, NativeDbReply as NativeDbResult };
export interface NativeDbAdmission {
  request(body: unknown): Promise<NativeDbReply>;
  close(): void;
}
export function validateNativeDbRequest(
  value: unknown,
  options?: { run?: string; approvedParents?: readonly string[] },
): string | undefined;
export function validateNativeDbReply(value: unknown): string | undefined;
export function createNativeDbAdmission(
  run: string,
  input: Readable,
  output: Writable,
  options?: { approvedParents?: readonly string[] },
): NativeDbAdmission;
// ISS-165: composes the run-owned channel onto the native adapter as the
// optional typed `nativeDbProfile` method; every other member is unchanged.
export function nativeDbProfileAdapter(
  native: Adapter,
  channel: Pick<NativeDbAdmission, "request">,
): Adapter & { nativeDbProfile(identity: NativeDbIdentity): Promise<NativeDbReply> };
