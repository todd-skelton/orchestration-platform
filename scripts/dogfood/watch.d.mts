export interface WatchSettings {
  loopConfig: string;
  destination: string;
  intervalSeconds: number;
  noProgressSeconds: number;
  run: string;
  state: string;
}
export interface NotificationDestination {
  find(url: string, marker: string): Promise<{ url: string | null } | null>;
  post(url: string, body: string): Promise<void>;
}
export function watchSettings(path: string): Promise<WatchSettings>;
export function githubNotifications(
  command?: (executable: string, args: string[], input?: string) => Promise<any>,
): NotificationDestination;
export function watchOnce(
  settings: WatchSettings,
  options?: {
    now?: number;
    github?: NotificationDestination;
    observe?: (path: string) => Promise<any>;
    report?: (text: string) => void;
  },
): Promise<boolean>;
