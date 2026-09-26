import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  parseRoutingMarker,
  resolveRouting,
  SELF_ROUTING,
  validateRoutingRow,
  type RoutingRow,
} from "../../scripts/dogfood/routing.mjs";

const marker = '<!-- routing: {"version":1,"row":7,"review":11} -->';

it("requires exactly one versioned planning marker and an explicit review row", () => {
  expect(parseRoutingMarker(`Issue\n${marker}\nAcceptance`)).toEqual({ row: 7, review: 11 });
  for (const [body, reason] of [
    ["Issue", "absent"],
    [`${marker}\n${marker}`, "duplicate"],
    [`${marker}\n<!-- routing: broken`, "duplicate"],
    ['<!-- routing: {"version":2,"row":7,"review":11} -->', "malformed"],
    ['<!-- routing: {"version":1,"row":7} -->', "malformed"],
    ['<!-- routing: {"version":1,"row":7,"review":13} -->', "malformed"],
    ['<!-- routing: {"version":1,"row":"7","review":11} -->', "malformed"],
    ['<!-- routing: {"version":1,"row":0,"review":11} -->', "malformed"],
    ["<!-- routing: broken -->", "malformed"],
    ["<!-- routing: {}", "malformed"],
    ["<!-- routing: null -->", "malformed"],
  ])
    expect(() => parseRoutingMarker(body!)).toThrow(`routing-marker-${reason}`);
});

it("returns self's ladder, allowing only self to fall back to a static pair", () => {
  expect(resolveRouting("self", { row: "self" }, [])).toEqual({
    row: "self",
    author: [
      { model: "gpt-6-astra", effort: "high" },
      { model: "gpt-6-astra", effort: "xhigh" },
      { model: "claude-fable-5-1", effort: "high" },
    ],
    reviewer: [
      { model: "claude-opus-5-5", effort: "high" },
      { model: "gpt-6-sol", effort: "high" },
    ],
  });
  expect(resolveRouting("self", undefined)).toBeUndefined();
  expect(() => resolveRouting("chase-sets", undefined)).toThrow("routing-marker-absent");
  expect(() => resolveRouting("chase-sets", { row: 7, review: 11 }, [])).toThrow(
    "routing-row-unconfigured",
  );
});

it("ships the exact ISS-203 matrix with two independent reviewers per policy", async () => {
  const rows: RoutingRow[] = JSON.parse(
    await readFile(new URL("../../adapters/chase-sets-routing.json", import.meta.url), "utf8"),
  );
  const expected = new Map([
    [2, ["gpt-6-luna/high", "gpt-6-luna/xhigh", "gpt-6-sol/medium", "claude-sonnet-5/medium"]],
    [3, ["claude-opus-5-5/medium", "claude-opus-5-5/high", "gpt-6-astra/medium"]],
    [4, ["gpt-6-astra/medium", "gpt-6-astra/high", "claude-fable-5-1/high"]],
    [7, ["gpt-6-astra/high", "gpt-6-astra/xhigh", "claude-fable-5-1/high"]],
    [10, ["gpt-6-sol/high", "gpt-6-astra/high", "claude-fable-5-1/high"]],
    [14, ["claude-opus-5-5/medium", "claude-opus-5-5/high", "gpt-6-astra/high"]],
    [15, ["claude-opus-5-5/high", "gpt-6-astra/high"]],
  ]);
  const expectedReviewers = new Map([
    [2, ["claude-opus-5-5", "gpt-6-astra"]],
    [3, ["gpt-6-sol", "claude-sonnet-5"]],
    [4, ["claude-opus-5-5", "gpt-6-sol"]],
    [7, ["claude-opus-5-5", "gpt-6-sol"]],
    [10, ["claude-opus-5-5", "claude-sonnet-5"]],
    [14, ["gpt-6-sol", "claude-sonnet-5"]],
    [15, ["gpt-6-sol", "claude-sonnet-5"]],
  ]);
  const vendor = (model: string) => model.split("-")[0];
  expect(rows.map(({ row, review }) => `${row}:${review}`)).toEqual(
    [...expected.keys()].flatMap((row) => [`${row}:11`, `${row}:12`]),
  );
  for (const row of rows) {
    expect(() => validateRoutingRow(row)).not.toThrow();
    expect(row.author.map((p) => `${p.model}/${p.effort}`)).toEqual(expected.get(Number(row.row)));
    expect(row.reviewer).toEqual(
      expectedReviewers.get(Number(row.row))!.map((model) => ({
        model,
        effort: row.review === 11 ? "high" : "medium",
      })),
    );
    const selection = parseRoutingMarker(
      `<!-- routing: ${JSON.stringify({ version: 1, row: row.row, review: row.review })} -->`,
    );
    expect(resolveRouting("chase-sets", selection, rows)).toEqual(row);
  }
  for (const row of [...rows, SELF_ROUTING]) {
    expect(() => validateRoutingRow(row)).not.toThrow();
    expect(vendor(row.author.at(-1)!.model)).not.toBe(vendor(row.author[0]!.model));
    for (const placement of [...row.author, ...row.reviewer])
      expect(["low", "medium", "high", "xhigh"]).toContain(placement.effort);
    expect(row.reviewer).toHaveLength(2);
    expect(new Set(row.reviewer.map((p) => p.model)).size).toBe(2);
    expect(row.reviewer.every((p) => row.author.every((a) => a.model !== p.model))).toBe(true);
    // An unused author rung must still exclude that model from either review seat.
    for (const author of row.author) {
      for (const index of [0, 1]) {
        const overlap = structuredClone(row);
        overlap.reviewer[index]!.model = author.model;
        expect(() => validateRoutingRow(overlap)).toThrow("routing-reviewer-not-independent");
      }
    }
    const repeated = structuredClone(row);
    repeated.reviewer[1] = { ...row.reviewer[0]!, effort: "low" };
    expect(() => validateRoutingRow(repeated)).toThrow("invalid-routing-fallback");
  }
  expect(() => resolveRouting("chase-sets", { row: 5, review: 11 }, rows)).toThrow(
    "routing-row-unconfigured",
  );
});

it("keeps literal predecessor and operator placements valid without a closed model roster", () => {
  for (const row of [
    {
      row: 2,
      review: 11 as const,
      author: [
        { model: "gpt-5.6-luna", effort: "high" },
        { model: "gpt-5.6-luna", effort: "xhigh" },
        { model: "claude-sonnet-5", effort: "medium" },
      ],
      reviewer: [
        { model: "claude-opus-5", effort: "high" },
        { model: "gpt-5.6-sol", effort: "high" },
      ],
    },
    {
      row: 2,
      review: 11 as const,
      author: [{ model: "operator-author", effort: "operator-effort" }],
      reviewer: [{ model: "operator-reviewer", effort: "operator-effort" }],
    },
  ]) {
    expect(() => validateRoutingRow(row)).not.toThrow();
    expect(resolveRouting("chase-sets", { row: 2, review: 11 }, [row])).toEqual(row);
  }
});

it("rejects overlap with any author rung and malformed or repeated placements", () => {
  for (const index of [0, 1]) {
    const row = structuredClone(SELF_ROUTING);
    row.reviewer[index]!.model = row.author[2]!.model;
    expect(() => validateRoutingRow(row)).toThrow("routing-reviewer-not-independent");
  }
  for (const author of [[], [SELF_ROUTING.author[0]!, SELF_ROUTING.author[0]!]])
    expect(() => validateRoutingRow({ ...SELF_ROUTING, author })).toThrow("invalid-routing-row");
  expect(() => validateRoutingRow({ ...SELF_ROUTING, reviewer: [] })).toThrow(
    "invalid-routing-row",
  );
  expect(() =>
    validateRoutingRow({
      ...SELF_ROUTING,
      reviewer: [SELF_ROUTING.reviewer[0]!, SELF_ROUTING.reviewer[0]!],
    }),
  ).toThrow("invalid-routing-fallback");
});
