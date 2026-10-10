// @ts-expect-error Node 24 executes this private TypeScript composition directly.
import { QueueBlocked, readOptional } from "./flow.ts";
import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import type { Config, Role } from "./flow.js";

export interface ModelPlacement {
  model?: string;
  family?: string;
  effort: string;
  generation?: number;
  authorityDigest?: string;
}
export interface RoutingRow {
  row: number | "self";
  review?: 11 | 12;
  author: ModelPlacement[];
  reviewer: ModelPlacement[];
}
export type RoutingSelection = Pick<RoutingRow, "row" | "review">;

export const SELF_ROUTING: RoutingRow = {
  row: "self",
  author: [
    { family: "astra", effort: "high" },
    { family: "astra", effort: "xhigh" },
    { family: "fable", effort: "high" },
  ],
  reviewer: [
    { family: "opus", effort: "high" },
    { family: "sol", effort: "high" },
  ],
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

export function validateRoutingRow(row: RoutingRow, snapshot?: Registry) {
  if (
    !row ||
    Object.keys(row).some((key) => !["row", "review", "author", "reviewer"].includes(key)) ||
    !Array.isArray(row.author) ||
    !row.author.length ||
    !Array.isArray(row.reviewer) ||
    !row.reviewer.length
  )
    throw new QueueBlocked("invalid-routing-row");
  const placements = [...row.author, ...row.reviewer];
  if (
    placements.some(
      (p) =>
        !p ||
        Object.keys(p).some((key) => !["model", "family", "effort"].includes(key)) ||
        Object.hasOwn(p, "model") === Object.hasOwn(p, "family") ||
        typeof (p.model ?? p.family) !== "string" ||
        !(p.model ?? p.family)?.trim() ||
        typeof p.effort !== "string" ||
        !p.effort.trim(),
    )
  )
    throw new QueueBlocked("invalid-routing-row");
  const identity = (p: ModelPlacement) =>
    snapshot
      ? (p.model ?? snapshot.families[p.family!]?.current)
      : JSON.stringify([p.model, p.family]);
  for (const reviewer of row.reviewer) {
    if (identity(reviewer) && row.author.some((author) => identity(author) === identity(reviewer)))
      throw new QueueBlocked("routing-reviewer-not-independent");
  }
  const authorSelectors = new Map<string, string>();
  for (const author of row.author) {
    const model = identity(author);
    if (!model) continue;
    const selector = JSON.stringify([author.model, author.family]);
    if (authorSelectors.has(model) && authorSelectors.get(model) !== selector)
      throw new QueueBlocked("invalid-routing-row");
    authorSelectors.set(model, selector);
  }
  if (
    new Set(
      row.author.filter((p) => identity(p)).map((p) => JSON.stringify([identity(p), p.effort])),
    ).size !== row.author.filter((p) => identity(p)).length
  )
    throw new QueueBlocked("invalid-routing-row");
  if (
    new Set(row.reviewer.filter((p) => identity(p)).map(identity)).size !==
    row.reviewer.filter((p) => identity(p)).length
  )
    throw new QueueBlocked("invalid-routing-fallback");
}

interface Registry {
  format: "model-registry/v2";
  generation: number;
  authorityDigest: string;
  families: Record<string, { current?: string | null }>;
}

// ISS-249: read only the registry projection needed by this selection. Efforts
// and routing policy remain platform-owned; unavailable families spend no launch.
export async function resolveRole(
  config: Config,
  role: Role,
  rung: number,
  authors: string[] = [],
) {
  const row: RoutingRow = {
    row: config.routing?.row ?? "self",
    author: config.author.ladder ?? [{ model: config.author.model!, effort: config.author.effort }],
    reviewer: config.reviewer.ladder ?? [
      { model: config.reviewer.model!, effort: config.reviewer.effort },
    ],
  };
  const placements = [...row.author, ...row.reviewer];
  let snapshot: Registry | undefined;
  if (placements.some((p) => p.family !== undefined)) {
    try {
      const path = config.modelRegistry ?? process.env.DOGFOOD_MODEL_REGISTRY;
      if (!path || !isAbsolute(path)) throw new Error("registry path");
      snapshot = JSON.parse(await readFile(path, "utf8"));
      if (
        !snapshot ||
        snapshot.format !== "model-registry/v2" ||
        !Number.isSafeInteger(snapshot.generation) ||
        typeof snapshot.authorityDigest !== "string" ||
        !snapshot.authorityDigest.trim() ||
        !snapshot.families ||
        typeof snapshot.families !== "object" ||
        Array.isArray(snapshot.families)
      )
        throw new Error("registry header");
      for (const p of placements) {
        if (!p.family) continue;
        const entry = snapshot.families[p.family];
        if (entry === undefined) continue;
        if (
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          (entry.current !== undefined &&
            entry.current !== null &&
            (typeof entry.current !== "string" || !entry.current.trim()))
        )
          throw new Error("registry family");
      }
    } catch {
      throw new QueueBlocked("model-registry-unavailable");
    }
  }
  validateRoutingRow(row, snapshot);
  const ladder = row[role];
  for (; rung < ladder.length; rung++) {
    const p = ladder[rung]!;
    const model = p.model ?? snapshot?.families[p.family!]?.current;
    if (!model) continue;
    if (role === "reviewer" && authors.includes(model))
      throw new QueueBlocked("routing-reviewer-not-independent");
    return {
      rung,
      placement: {
        model,
        effort: p.effort,
        ...(p.family
          ? {
              family: p.family,
              generation: snapshot!.generation,
              authorityDigest: snapshot!.authorityDigest,
            }
          : {}),
      },
    };
  }
  throw new QueueBlocked("provider-model-refused");
}

// Composition, not fingerprint validation, owns the retained routing inputs.
// Copy just those fields; changed prompts, bases and other policy still refuse.
export async function retainedRouting(config: Config): Promise<Config> {
  const pinned = await readOptional(resolve(config.stateDirectory, "config.json"));
  if (
    !pinned &&
    (config.routing?.row !== "self" || !config.author.ladder || !config.reviewer.ladder)
  )
    return config;
  const result = { ...config };
  for (const role of ["author", "reviewer"] as const) {
    if (pinned) result[role] = { ...pinned.config[role], prompt: config[role].prompt };
    else {
      const ladder = SELF_ROUTING[role];
      const rung = Math.min(config[role].rung ?? 0, ladder.length - 1);
      result[role] = { ...ladder[rung]!, ladder, rung, prompt: config[role].prompt };
    }
  }
  return result;
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
