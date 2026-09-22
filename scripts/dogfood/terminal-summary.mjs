// ISS-198: one bound for author summaries, serialized reviewer verdicts and
// terminal diagnostics. 4000 admits the recorded 2036-character reviewer
// verdict with 1964 characters of headroom; it is still a finite cap.
export const MAX_TERMINAL_SUMMARY_LENGTH = 4000;

export const terminalSummary = (value) =>
  typeof value === "string" && value.length > 0
    ? value.slice(0, MAX_TERMINAL_SUMMARY_LENGTH)
    : undefined;
