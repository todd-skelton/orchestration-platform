// ISS-164: the private request stream exported by the supervisor entry.
import type { Readable, Writable } from "node:stream";

export const NATIVE_DB_REQUEST_SCHEMA: "dogfood-native-db-request/v1";
export const NATIVE_DB_REPLY_SCHEMA: "dogfood-native-db-reply/v1";
export const NATIVE_DB_PROFILE: "reconciliation-pg16/v1";
export const NATIVE_DB_REQUEST_LIMIT: 65536;
export const NATIVE_DB_REPLY_LIMIT: 8192;
export const NATIVE_DB_REQUEST_KEYS: readonly string[];
export const NATIVE_DB_REPLY_KEYS: readonly string[];

export type NativeDbStatus = "completed" | "refused" | "unknown";
export interface NativeDbOwner {
  lockId: string;
  head: string;
  lane: string;
}
export interface NativeDbResult {
  correlation: number | null;
  status: NativeDbStatus;
  owner: NativeDbOwner | null;
  evidencePath: string | null;
  diagnostic: string | null;
}
export interface NativeDbAdmission {
  request(body: unknown): Promise<NativeDbResult>;
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
