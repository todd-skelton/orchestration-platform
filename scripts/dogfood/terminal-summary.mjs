export const MAX_TERMINAL_SUMMARY_LENGTH = 2000;

export const terminalSummary = (value) =>
  typeof value === "string" && value.length > 0
    ? value.slice(0, MAX_TERMINAL_SUMMARY_LENGTH)
    : undefined;
