// Pre-ISS-249 identities in retained-record fixtures must not follow live defaults.
export const SELF_ROUTING = {
  row: "self" as const,
  author: [
    { model: "gpt-6-astra", effort: "high" },
    { model: "gpt-6-astra", effort: "xhigh" },
    { model: "claude-fable-5-1", effort: "high" },
  ],
  reviewer: [
    { model: "claude-opus-5-5", effort: "high" },
    { model: "gpt-6.1-sol", effort: "high" },
  ],
};
