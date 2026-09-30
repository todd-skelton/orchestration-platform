export const PROCESS_OWNERSHIP_SCHEMA: "dogfood-process-ownership/v1";
export const DEFAULT_CGROUP_ROOT: string;
export const BODY_MARKER: string;
export interface ProcessIdentity {
  pid: number;
  /** Decimal clock ticks since boot from /proc/<pid>/stat, never wall clock. */
  starttime: string;
  ppid: number;
  pgid: number;
  sid: number;
  state: string;
}
export interface OwnershipBinding {
  schemaVersion: "dogfood-process-ownership/v1";
  run: string;
  configPath: string;
  invocation: string;
  bootId: string;
  namespaces: { pid: string; cgroup: string; mnt: string };
  cgroupPath: string;
  cgroupIdentity: { device: string; inode: string };
  substrate: "cgroup-v2" | "injected-directory";
  wrapper: ProcessIdentity;
  createdAt: string;
}
export interface ProcessOwnershipInvocation {
  invocation: string;
  binding: OwnershipBinding | null;
  members: ProcessIdentity[] | null;
}
export interface ProcessOwnershipObservation {
  status: "observed" | "unavailable";
  diagnostic?: string;
  observationStart: string;
  observationEnd: string;
  invocations: ProcessOwnershipInvocation[];
}
export function parseProcStat(text: string): ProcessIdentity;
export function readProcIdentity(pid: number, procRoot?: string): Promise<ProcessIdentity>;
export function readCgroupMembership(leaf: string): Promise<number[]>;
export function observeProcessOwnership(
  stateRoot: string,
  run: string,
  options?: { procRoot?: string },
): Promise<ProcessOwnershipObservation>;
export function launchOwned(
  configPath: string,
  launcherPath: string,
  environment?: NodeJS.ProcessEnv,
): Promise<number>;
