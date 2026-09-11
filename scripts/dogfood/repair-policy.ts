const MAX_REVIEW_SUMMARY_LENGTH = 2_000;

const REPORT_KEYS = ["run", "role", "head", "verdict", "findings", "g0"];

export class RepairBlocked extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function demand(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new RepairBlocked(reason);
}

const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string[]) =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const bounded = (value: unknown, maximum: number) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  !/[\u0000-\u001f\u007f]/.test(value);
const validPath = (path: unknown) =>
  bounded(path, 500) &&
  !(path as string).startsWith("/") &&
  !(path as string).includes("\\") &&
  !(path as string).split("/").includes("..");

export interface ReviewFinding {
  file: string;
  line: number;
  severity: "blocking" | "note";
  text: string;
}

export interface ValidatedReview {
  run: string;
  role: "reviewer";
  head: string;
  verdict: "PASS" | "FAIL";
  findings: ReviewFinding[];
  g0: string;
}

export function parseReview(
  summary: unknown,
  expectedRun: string,
  expectedHead: string,
): ValidatedReview {
  demand(
    typeof summary === "string" && summary.length <= MAX_REVIEW_SUMMARY_LENGTH,
    "source-review-summary-out-of-bounds",
  );
  let report: unknown;
  try {
    report = JSON.parse(summary);
  } catch {
    throw new RepairBlocked("malformed-source-review-report");
  }
  const parsed = report as Record<string, any>;
  demand(
    exactKeys(parsed, REPORT_KEYS) &&
      parsed.run === expectedRun &&
      parsed.role === "reviewer" &&
      parsed.head === expectedHead &&
      ["PASS", "FAIL"].includes(parsed.verdict) &&
      Array.isArray(parsed.findings) &&
      bounded(parsed.g0, MAX_REVIEW_SUMMARY_LENGTH),
    "malformed-source-review-report",
  );
  for (const finding of parsed.findings)
    demand(
      exactKeys(finding, ["file", "line", "severity", "text"]) &&
        validPath(finding.file) &&
        Number.isSafeInteger(finding.line) &&
        finding.line > 0 &&
        ["blocking", "note"].includes(finding.severity) &&
        bounded(finding.text, MAX_REVIEW_SUMMARY_LENGTH),
      "malformed-source-finding",
    );
  const blocking = parsed.findings.some(
    (finding: ReviewFinding) => finding.severity === "blocking",
  );
  demand(parsed.verdict === (blocking ? "FAIL" : "PASS"), "inconsistent-source-review-verdict");
  return parsed as unknown as ValidatedReview;
}

export function validateLocations(
  review: ValidatedReview,
  candidate: { changed: string[] },
  lineCounts: Record<string, number>,
) {
  const changed = new Set(candidate.changed);
  for (const finding of review.findings)
    demand(
      changed.has(finding.file) &&
        Number.isSafeInteger(lineCounts[finding.file]) &&
        finding.line <= lineCounts[finding.file]!,
      "source-finding-location-outside-candidate",
    );
}
