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

it("ships all independent incumbent placements and refuses colliding combinations", async () => {
  const rows: RoutingRow[] = JSON.parse(
    await readFile(new URL("../../adapters/chase-sets-routing.json", import.meta.url), "utf8"),
  );
  const expected = new Map([
    [2, ["gpt-5.6-terra", "medium"]],
    [3, ["claude-sonnet-5", "medium"]],
    [4, ["gpt-5.6-sol", "high"]],
    [7, ["gpt-6-astra", "high"]],
    [10, ["gpt-5.6-sol", "high"]],
    [14, ["gpt-6-astra", "high"]],
    [15, ["gpt-6-astra", "high"]],
  ]);
  expect(new Set(rows.map(({ row }) => row))).toEqual(new Set(expected.keys()));
  for (const row of rows) {
    expect(() => validateRoutingRow(row)).not.toThrow();
    expect([row.author.model, row.author.effort]).toEqual(expected.get(Number(row.row)));
    expect(row.repair).toEqual(row.author);
    expect(row.reviewer).toEqual(
      row.review === 11
        ? {
            model: "gpt-5.6-sol",
            effort: "high",
            fallback: { model: "claude-opus-5", effort: "high" },
          }
        : {
            model: "claude-opus-5",
            effort: "high",
            fallback: { model: "claude-sonnet-5", effort: "medium" },
          },
    );
    expect(resolveRouting("chase-sets", row, rows)).toEqual(row);
  }
  for (const selection of [
    { row: 4, review: 11 },
    { row: 10, review: 11 },
    { row: 3, review: 12 },
  ] as const)
    expect(() => resolveRouting("chase-sets", selection, rows)).toThrow("routing-row-unconfigured");
});

it("rejects author/repair overlap with either reviewer and never admits Terra or Fable review", () => {
  for (const model of ["gpt-6-astra", "gpt-5.6-terra", "claude-fable-5-1"]) {
    for (const fallback of [false, true]) {
      const row = structuredClone(SELF_ROUTING);
      if (fallback) row.reviewer.fallback.model = model;
      else row.reviewer.model = model;
      expect(() => validateRoutingRow(row)).toThrow("routing-reviewer-not-independent");
    }
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
