import { AsyncLocalStorage } from "node:async_hooks";

type PhaseEntry = Readonly<{
  elapsedMilliseconds: number;
  phase: string;
}>;

const bounded = (value: string) => value.slice(0, 160);

export function createPhaseWatchdog(scope: string, thresholdMilliseconds = 4_000) {
  const run = new AsyncLocalStorage<number>();
  let activeToken = 0;
  let nextToken = 0;
  let startedAt = 0;
  let testName = "not-started";
  let timer: NodeJS.Timeout | null = null;
  let thresholdReported = false;
  let trace: PhaseEntry[] = [];

  const elapsed = () => (startedAt === 0 ? 0 : Math.round(performance.now() - startedAt));
  const markFor = (token: number | undefined, phase: string) => {
    if (token === undefined || token !== activeToken) return;
    trace.push({ elapsedMilliseconds: elapsed(), phase: bounded(phase) });
    if (trace.length > 32) trace = trace.slice(-32);
  };
  const mark = (phase: string) => markFor(run.getStore(), phase);
  const report = (token: number, reason: "threshold" | "afterEach") => {
    if (token !== activeToken) return;
    process.stderr.write(
      `[phase-watchdog] ${JSON.stringify({
        elapsedMilliseconds: elapsed(),
        reason,
        scope,
        testName,
        trace,
      })}\n`,
    );
  };

  return {
    finish() {
      const token = run.getStore();
      if (token === undefined || token !== activeToken) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (thresholdReported) report(token, "afterEach");
      activeToken = 0;
      startedAt = 0;
      thresholdReported = false;
      trace = [];
    },
    mark,
    scoped() {
      const token = run.getStore();
      return (phase: string) => markFor(token, phase);
    },
    start(name: string) {
      if (timer !== null) clearTimeout(timer);
      const token = ++nextToken;
      activeToken = token;
      run.enterWith(token);
      startedAt = performance.now();
      testName = bounded(name);
      thresholdReported = false;
      trace = [];
      markFor(token, "beforeEach:complete");
      timer = setTimeout(() => {
        if (token !== activeToken) return;
        thresholdReported = true;
        report(token, "threshold");
      }, thresholdMilliseconds);
      timer.unref();
    },
    async within<T>(phase: string, operation: () => Promise<T>): Promise<T> {
      const token = run.getStore();
      markFor(token, `${phase}:start`);
      try {
        const value = await operation();
        markFor(token, `${phase}:complete`);
        return value;
      } catch (error) {
        markFor(token, `${phase}:error`);
        throw error;
      }
    },
  };
}
