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

it("returns self's fixed policy, allowing only self to fall back to a static pair", () => {
  expect(resolveRouting("self", { row: "self" }, [])).toEqual({
    row: "self",
    author: { model: "gpt-6-astra", effort: "high" },
    reviewer: {
      model: "claude-opus-5",
      effort: "high",
      fallback: { model: "gpt-5.6-sol", effort: "high" },
    },
    repair: { model: "gpt-6-astra", effort: "high" },
  });
  expect(resolveRouting("self", undefined)).toBeUndefined();
  expect(() => resolveRouting("chase-sets", undefined)).toThrow("routing-marker-absent");
  expect(() => resolveRouting("chase-sets", { row: 7, review: 11 }, [])).toThrow(
    "routing-row-unconfigured",
  );
});

it("ships every author row with both independent, cross-vendor review policies", async () => {
  const rows: RoutingRow[] = JSON.parse(
    await readFile(new URL("../../adapters/chase-sets-routing.json", import.meta.url), "utf8"),
  );
  const expected = new Map([
    [2, ["gpt-5.6-luna", "high"]],
    [3, ["claude-sonnet-5", "medium"]],
    [4, ["gpt-6-astra", "medium"]],
    [7, ["gpt-6-astra", "high"]],
    [10, ["gpt-5.6-sol", "high"]],
    [14, ["claude-opus-5", "medium"]],
    [15, ["claude-opus-5", "high"]],
  ]);
  const vendor = (model: string) => model.split("-")[0];
  expect(rows.map(({ row, review }) => `${row}:${review}`)).toEqual(
    [...expected.keys()].flatMap((row) => [`${row}:11`, `${row}:12`]),
  );
  for (const row of rows) {
    expect(() => validateRoutingRow(row)).not.toThrow();
    expect([row.author.model, row.author.effort]).toEqual(expected.get(Number(row.row)));
    expect(row.repair).toEqual(row.author);
    const { reviewer } = row;
    expect(reviewer.effort).toBe(row.review === 11 ? "high" : "medium");
    expect(reviewer.fallback.effort).toBe(reviewer.effort);
    expect(vendor(reviewer.model)).not.toBe(vendor(row.author.model));
    expect(reviewer.fallback.model).not.toBe(row.author.model);
    expect(resolveRouting("chase-sets", row, rows)).toEqual(row);
  }
  expect(() => resolveRouting("chase-sets", { row: 5, review: 11 }, rows)).toThrow(
    "routing-row-unconfigured",
  );
});

it("rejects author/repair overlap with either reviewer", () => {
  for (const fallback of [false, true]) {
    const row = structuredClone(SELF_ROUTING);
    if (fallback) row.reviewer.fallback.model = row.author.model;
    else row.reviewer.model = row.author.model;
    expect(() => validateRoutingRow(row)).toThrow("routing-reviewer-not-independent");
  }
  const row = structuredClone(SELF_ROUTING);
  row.repair = row.reviewer.fallback;
  expect(() => validateRoutingRow(row)).toThrow("routing-reviewer-not-independent");
  expect(() =>
    validateRoutingRow({
      ...SELF_ROUTING,
      reviewer: { model: "review", effort: "high" },
    } as RoutingRow),
  ).toThrow("invalid-routing-row");
});
