type PhaseDetail = Readonly<Record<string, unknown>>;

type PhaseEntry = Readonly<{
  elapsedMilliseconds: number;
  phase: string;
}>;

const bounded = (value: string) => value.slice(0, 160);

export function createPhaseWatchdog(
  scope: string,
  thresholdMilliseconds = 4_000,
  details: () => PhaseDetail = () => ({}),
) {
  let startedAt = 0;
  let testName = "not-started";
  let timer: NodeJS.Timeout | null = null;
  let thresholdReported = false;
  let trace: PhaseEntry[] = [];

  const elapsed = () => (startedAt === 0 ? 0 : Math.round(performance.now() - startedAt));
  const mark = (phase: string) => {
    trace.push({ elapsedMilliseconds: elapsed(), phase: bounded(phase) });
    if (trace.length > 32) trace = trace.slice(-32);
  };
  const report = (reason: "threshold" | "afterEach") => {
    process.stderr.write(
      `[phase-watchdog] ${JSON.stringify({
        details: details(),
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
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (thresholdReported) report("afterEach");
      startedAt = 0;
      thresholdReported = false;
      trace = [];
    },
    mark,
    start(name: string) {
      if (timer !== null) clearTimeout(timer);
      startedAt = performance.now();
      testName = bounded(name);
      thresholdReported = false;
      trace = [];
      mark("beforeEach:complete");
      timer = setTimeout(() => {
        thresholdReported = true;
        report("threshold");
      }, thresholdMilliseconds);
      timer.unref();
    },
    async within<T>(phase: string, operation: () => Promise<T>): Promise<T> {
      mark(`${phase}:start`);
      try {
        const value = await operation();
        mark(`${phase}:complete`);
        return value;
      } catch (error) {
        mark(`${phase}:error`);
        throw error;
      }
    },
  };
}
