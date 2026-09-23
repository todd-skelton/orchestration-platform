# Model selection

Native selectors in the shipped ladders. Every worker launches through the
executor's Codex CLI against the `account_pool` provider; no second launcher
exists. Selectors are case-sensitive. This table describes configured
placements, not provider availability or capability evidence.

| Selector           | Short label | Efforts in native ladders | Native ladder roles |
| ------------------ | ----------- | ------------------------- | ------------------- |
| `gpt-6-astra`       | Astra       | medium, high, xhigh       | author              |
| `gpt-6-sol`         | Sol         | medium, high              | author, reviewer    |
| `gpt-6-luna`        | Luna        | high, xhigh               | author              |
| `claude-opus-5-5`   | Opus        | medium, high, max         | author, reviewer    |
| `claude-sonnet-5`   | Sonnet      | medium, high              | author, reviewer    |
| `claude-fable-5-1`  | Fable       | high                      | author              |

Placement comes from the routing row (ISS-149, ISS-158, `docs/loop.md`).
Each row has ordered author and reviewer ladders; reviewer models are disjoint
from every author model. Self uses Astra/high, Astra/xhigh, Fable/high author
with Opus/high then Sol/high review. Chase Sets planning markers select the
ladders in `adapters/chase-sets-routing.json`. Current placement prose uses
the short labels above: Luna and Sol mean GPT-6, and Opus means Opus 5.5.
`claude-fable-5` is retired. Terra has no native route and is removed from
the current dispatch roster.

ISS-202 implements Todd's [successor replacement ruling](https://github.com/chase-sets/chase-sets/issues/4388#issuecomment-5786554032)
as literal selector replacements: `gpt-5.6-luna` to `gpt-6-luna`,
`gpt-5.6-sol` to `gpt-6-sol`, and `claude-opus-5` to `claude-opus-5-5`.
Roles, efforts and ladder order are preserved; Astra, Fable and Sonnet are
unchanged. Native Opus row 14/15 roles grant no incumbent permission or new
native roles. Generic operator model strings remain open configuration;
there is no global blacklist or automatic static-config rewrite.

Model size is the ceiling; effort buys search. After every author failure,
try more effort before a larger model, with the other vendor last. The recorded
failed-launch counter carries across attempts, including corrective and gate
correction authors, and clamps at the top. Refusal, death, review FAIL and
attributed gate failure all advance it; PASS never descends. Reviewer ladders
advance only on refusal. Launches record zero-based rungs; resume preserves
the selected rung. Attempt ceilings and retry budgets are unchanged.

## Shipped placements

ISS-158 supplies the ladder policy; ISS-202 replaces only the three selectors:

| Row | Author rung 1 | Author rung 2 | Author rung 3 | Review 11 | Review 12 |
| --- | --- | --- | --- | --- | --- |
| 2 | Luna high | Luna xhigh | Sonnet medium | Opus high, Sol high | Opus medium, Sol medium |
| 3 | Sonnet medium | Sonnet high | Luna high | Sol high, Opus high | Sol medium, Opus medium |
| 4 | Astra medium | Astra high | Fable high | Opus high, Sol high | Opus medium, Sol medium |
| 7 | Astra high | Astra xhigh | Fable high | Opus high, Sol high | Opus medium, Sol medium |
| 10 | Sol high | Astra high | Fable high | Opus high, Sonnet high | Opus medium, Sonnet medium |
| 14 | Opus medium | Opus high | Astra high | Sol high, Sonnet high | Sol medium, Sonnet medium |
| 15 | Opus high | Opus max | Astra high | Sol high, Sonnet high | Sol medium, Sonnet medium |

Review 11 uses high effort for recall; review 12 uses medium for precision.
Reviewer fallbacks exclude all models in their row's author ladder, including
later rungs. Replacement authority transfers no predecessor benchmark, score,
verdict or capability evidence to the successors.

## Cutover limit

Use a quiescent fresh-run cutover only after independent exact-head review,
final-head three-OS bootstrap green and separate host authorization, with
supervisors absent and fresh runs/paths authorized. Immediately before an
authorized install, the host must capture native account_pool/CLI admission
for each exact successor model/effort on that host, with UTC instant and
result. Catalogue presence, earlier Pool14 probes and fixture success are
neither timely admission nor quality evidence. This change authorizes no
probe, install, start, unpark or #457 renewal; ISS-199's live run stays untouched.

Preserve old runs/configs and participant strings, efforts, routing indexes,
attempts, failure counts, retries, ceilings and launch charges. Same-config
replay retains its saved placement and rung. Changed ladders change the full
configuration fingerprint and retain `conflicting-run-configuration` before
launch: no aliases, backfill, waiver, automatic resume, budget reset or
exhausted-lineage re-entry. Preserved-run continuation needs separate host
disposition. Native authoring, independent review and all ordinary local,
after-mirror and hosted gates remain required.

## Historical placement basis (2026-09-15)

The following retained rationale describes the predecessor placements, not
successor results. Here Luna/Sol mean GPT-5.6 and Opus means Claude Opus 5;
none of these comparisons establishes successor quality or capability.

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

Rung 1 retains PR #491's placements. ISS-158 supplies these escalation ladders.
Row 10 changes model at rung 2 because Sol xhigh costs three to four times
the tokens for less gain than Astra's Terminal-Bench lead on debugging.
Fable 5.1 ties Astra at higher cost and emits about 1.5x Fable 5's output
tokens, so it enters as a final cross-vendor author rung. Terra remains
Pareto-dominated and ships in no row. Reviewer fallbacks exclude all models
in their row's author ladder, including later rungs.

The pool converts `reasoning.effort` into Claude thinking; an effort off a
Claude ladder is not refused, so keep Claude rows on the ladder above.
