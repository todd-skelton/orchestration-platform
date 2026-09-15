# Model selection

Models the loop can dispatch. Every worker launches through the executor's
Codex CLI against the `account_pool` provider, which advertises the GPT and
Claude selectors on one `/models` endpoint; no second launcher exists.
Selectors are case-sensitive. Efforts are one configuration with the model
and must sit on that model's ladder.

| Selector           | Label            | Effort ladder                          | Roles            |
| ------------------ | ---------------- | -------------------------------------- | ---------------- |
| `gpt-6-astra`      | GPT-6 Astra      | low, medium, high, xhigh, max          | author, reviewer |
| `gpt-5.6-sol`      | GPT-5.6 Sol      | minimal, low, medium, high, xhigh, max | author, reviewer |
| `gpt-5.6-terra`    | GPT-5.6 Terra    | minimal, low, medium, high, xhigh, max | author, reviewer |
| `gpt-5.6-luna`     | GPT-5.6 Luna     | minimal, low, medium, high, xhigh, max | author, reviewer |
| `claude-opus-5`    | Claude Opus 5    | low, medium, high, max                 | author, reviewer |
| `claude-sonnet-5`  | Claude Sonnet 5  | low, medium, high, max                 | author, reviewer |
| `claude-fable-5-1` | Claude Fable 5.1 | low, medium, high, max                 | author, reviewer |

Placement comes from the routing row, not from a per-run pair (ISS-149,
`docs/loop.md`): the self adapter uses Astra/high author and repair with
Opus/high review and Sol/high fallback; Chase Sets issues carry a routing
marker that selects a row from `adapters/chase-sets-routing.json`. The only
structural rule is that the reviewer's model never equals the author's; the
shipped rows also keep the primary reviewer on the other vendor so one
provider outage cannot take both seats. `claude-fable-5` is retired and never
selectable.

## Shipped placements (2026-09-15)

Rebuilt from public benchmarks (Artificial Analysis Intelligence Index v4.3
and Coding Agent Index, vendor launch tables, Terminal-Bench 4.0, GDPval-AA,
OSWorld 2.0) rather than the earlier per-model usage rules, which are
withdrawn. Cheapest configuration that clears the row's bar wins.

| Row | Author         | Basis                                                                                       |
| --- | -------------- | ------------------------------------------------------------------------------------------- |
| 2   | Luna high      | Luna and Sol dominate Terra on the intelligence/cost frontier; Luna runs Codex auto-review  |
| 3   | Sonnet medium  | Sonnet's value band is low/medium; xhigh costs more than Opus for the same quality         |
| 4   | Astra medium   | Terminal-Bench 4.0 56% vs Sol 37%; every Astra effort sits on the cost frontier             |
| 7   | Astra high     | Tied with Fable 5.1 on both AA indices at roughly 40-60% of the cost per task              |
| 10  | Sol high       | Cheapest flagship that leads DeepSWE (72% vs Astra 68%)                                     |
| 14  | Opus medium    | GDPval-AA leader (1861) at half Fable's price; Astra scores ~45 Elo below Sol on GDPval    |
| 15  | Opus high      | Within 0.5% of Fable on CursorBench at half cost; front-end is Astra's weakest coding area |

Review 11 (high recall) runs the other vendor's judge at high: Opus for GPT
authors, Sol for Claude authors. Review 12 (precision) runs the same pair at
medium. Fallbacks are the remaining flagship at the same effort, or Sonnet
when that flagship authored. Fable 5.1 and Terra ship in no row: Fable ties
Astra at higher cost and emits about 1.5x Fable 5's output tokens; Terra is
Pareto-dominated. Both stay selectable for future rows.

The pool converts `reasoning.effort` into Claude thinking; an effort off a
Claude ladder is not refused, so keep Claude rows on the ladder above.