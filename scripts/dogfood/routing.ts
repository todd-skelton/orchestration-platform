// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked } from "./flow.ts";

export interface ModelPlacement {
  model: string;
  effort: string;
}
export interface RoutingRow {
  row: number | "self";
  review?: 11 | 12;
  author: ModelPlacement;
  reviewer: ModelPlacement & { fallback: ModelPlacement };
  repair: ModelPlacement;
}
export type RoutingSelection = Pick<RoutingRow, "row" | "review">;

export const SELF_ROUTING: RoutingRow = {
  row: "self",
  author: { model: "gpt-6-astra", effort: "high" },
  reviewer: {
    model: "claude-opus-5",
    effort: "high",
    fallback: { model: "gpt-5.6-sol", effort: "high" },
  },
  repair: { model: "gpt-6-astra", effort: "high" },
};

export function parseRoutingMarker(body: string): RoutingSelection {
  const starts = body.match(/<!--\s*routing\b/gi) ?? [];
  if (starts.length !== 1)
    throw new QueueBlocked(starts.length ? "routing-marker-duplicate" : "routing-marker-absent");
  const marker = /<!-- routing: (.*?) -->/.exec(body);
  let value;
  try {
    value = JSON.parse(marker?.[1] ?? "");
  } catch {
    throw new QueueBlocked("routing-marker-malformed");
  }
  if (
    !value ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.row) ||
    value.row <= 0 ||
    ![11, 12].includes(value.review) ||
    Object.keys(value).some((key) => !["version", "row", "review"].includes(key))
  )
    throw new QueueBlocked("routing-marker-malformed");
  return { row: value.row, review: value.review };
}

export function validateRoutingRow(row: RoutingRow) {
  const placements = [row?.author, row?.reviewer, row?.reviewer?.fallback, row?.repair];
  if (
    placements.some(
      (p) =>
        !p ||
        typeof p.model !== "string" ||
        !p.model.trim() ||
        typeof p.effort !== "string" ||
        !p.effort.trim(),
    )
  )
    throw new QueueBlocked("invalid-routing-row");
  for (const reviewer of [row.reviewer, row.reviewer.fallback]) {
    if ([row.author.model, row.repair.model].includes(reviewer.model))
      throw new QueueBlocked("routing-reviewer-not-independent");
  }
  if (row.reviewer.model === row.reviewer.fallback.model)
    throw new QueueBlocked("invalid-routing-fallback");
}

export function resolveRouting(
  adapter: string,
  selection: RoutingSelection | undefined,
  rows?: RoutingRow[],
): RoutingRow | undefined {
  if (adapter === "self") return selection ? SELF_ROUTING : undefined;
  if (!selection) throw new QueueBlocked("routing-marker-absent");
  const matches =
    rows?.filter((row) => row.row === selection.row && row.review === selection.review) ?? [];
  if (matches.length !== 1)
    throw new QueueBlocked(
      "routing-row-unconfigured",
      `Routing row ${selection.row}, review ${selection.review}; no author or reviewer launched.`,
    );
  validateRoutingRow(matches[0]!);
  return matches[0];
}
