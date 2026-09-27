interface PauseConfig {
  stateRoot: string;
  run: string;
}
export interface PauseObservation {
  request: string;
  acknowledgement: string;
  requestedAt: string | null;
  requestId: string | null;
  acknowledgedAt: string | null;
}
export function pausePaths(loop: PauseConfig): { request: string; acknowledgement: string };
export function observePause(loop: PauseConfig): Promise<PauseObservation>;
export function requestPause(loop: PauseConfig): Promise<PauseObservation>;
export function clearPause(loop: PauseConfig): Promise<void>;
export class PauseRequested extends Error {
  pause: PauseObservation;
}
export function pauseBeforeSelection(loop: PauseConfig): Promise<void>;
