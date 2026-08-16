export function normalizeTrackedText(value) {
  if (/\r(?!\n)/.test(value)) {
    throw new Error("tracked text contains a lone carriage return");
  }
  if (value.includes("\r\n") && /(^|[^\r])\n/.test(value)) {
    throw new Error("tracked text mixes CRLF and LF line endings");
  }
  return value.replace(/\r\n/g, "\n");
}
