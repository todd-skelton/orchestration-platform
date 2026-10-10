# Model selection

Native ladders name families, resolved through the shared model registry at
launch selection (ISS-249, after ISS-202, ISS-203 and ISS-218 recorded the cost
of literal selector replacement). Every worker still launches through the
executor's Codex CLI against `account_pool`. The registry supplies model
identity only: efforts, roles and rung order remain platform-owned. No
incumbent routing-policy rows, account selection or `admittedEfforts` are
imported.

| Family   | Efforts in native ladders | Native ladder roles |
| -------- | ------------------------- | ------------------- |
| `astra`  | medium, high, xhigh       | author, reviewer    |
| `sol`    | medium, high              | author, reviewer    |
| `luna`   | high, xhigh               | author              |
| `opus`   | medium, high              | author, reviewer    |
| `sonnet` | medium, high              | author, reviewer    |
| `fable`  | high                      | author              |

Self uses Astra/high, Astra/xhigh, Fable/high author with Opus/high then Sol/high
review. Chase Sets planning markers select the unchanged placements in
`adapters/chase-sets-routing.json`. Fresh host configs copy those rows into
`routingRows`, for example:

```json
{
  "modelRegistry": "/mnt/d/Users/ToddS/AgentPools/state/model-registry.json",
  "routingRows": [
    {
      "row": 7,
      "review": 11,
      "author": [
        { "family": "astra", "effort": "high" },
        { "family": "astra", "effort": "xhigh" },
        { "family": "fable", "effort": "high" }
      ],
      "reviewer": [
        { "family": "opus", "effort": "high" },
        { "family": "sol", "effort": "high" }
      ]
    }
  ]
}
```

`modelRegistry` is an optional absolute path. Otherwise the executor uses
`DOGFOOD_MODEL_REGISTRY`; the attached launcher exports the path shown above
unless the host already set that environment variable. Saved self configs
need no edit to use families for new stages. Literal `{model, effort}` rungs
remain supported and need no registry when the entire row is literal.

One snapshot is read per new role selection, before writing its intent.
The projection requires `format: "model-registry/v2"`, safe-integer
`generation`, nonempty `authorityDigest`, and a `families` object.
Used families have a nonempty string `current`, or null/absent current.
Malformed or unreadable data stops as non-parking retry
`model-registry-unavailable`. A null or absent current advances the ladder
without a launch charge; exhaustion retains `provider-model-refused`.
Reviewer-author disjointness covers every author rung in that snapshot
and every recorded author model for the attempt. Aliased families count as
duplicate models.

Intents, attempts and participant placements retain the exact resolved model,
effort, family, generation and authority digest. Registry swaps affect later
new intents only. Retained intents and retries keep their recorded identities
without another registry read; ordinary ladder advancement selects a new rung
and writes a new intent. Existing stage composition takes both roles'
ladders, rungs, effective models and efforts from its pinned `config.json`.
The fingerprint still binds the configured ladder and all other step inputs;
records are never rewritten or migrated. A first-use host capture remains a
separately authorized observation, not a provider probe or live start granted
by this implementation.

After every author failure, try the next configured rung: normally more effort
before changing model, with the other vendor last in every author ladder.
Row 10 retains ISS-158's Sol/xhigh skip; row 15 now skips Opus/max under
ISS-203's benchmark-based exception. A model change need not increase capability.
The recorded failed-launch counter carries across attempts, including corrective and gate
correction authors, and clamps at the top. Refusal, death, review FAIL and
attributed gate failure all advance it; PASS never descends. Reviewer ladders
advance only on refusal. Launches record zero-based rungs; resume preserves
the selected rung. Attempt ceilings and retry budgets are unchanged.

## Shipped placements

ISS-158 supplies failure-count advancement, ISS-203 this placement matrix,
and ISS-249 family resolution. Entries are in launch order:

| Row  | Author ladder                                    | Review 11 ladder       | Review 12 ladder           |
| ---- | ------------------------------------------------ | ---------------------- | -------------------------- |
| 2    | Luna high, Luna xhigh, Sol medium, Sonnet medium | Opus high, Astra high  | Opus medium, Astra medium  |
| 3    | Opus medium, Opus high, Astra medium             | Sol high, Sonnet high  | Sol medium, Sonnet medium  |
| 4    | Astra medium, Astra high, Fable high             | Opus high, Sol high    | Opus medium, Sol medium    |
| 7    | Astra high, Astra xhigh, Fable high              | Opus high, Sol high    | Opus medium, Sol medium    |
| 10   | Sol high, Astra high, Fable high                 | Opus high, Sonnet high | Opus medium, Sonnet medium |
| 14   | Opus medium, Opus high, Astra high               | Sol high, Sonnet high  | Sol medium, Sonnet medium  |
| 15   | Opus high, Astra high                            | Sol high, Sonnet high  | Sol medium, Sonnet medium  |
| self | Astra high, Astra xhigh, Fable high              | Opus high, Sol high    | —                          |

Review 11 uses high effort for intended recall; review 12 uses medium for
intended precision. Neither intent is locally certified.
Reviewer fallbacks exclude all models in their row's author ladder, including
later rungs. Sonnet retains its predecessor's refusal-only continuity role;
this makes no successor strength claim, and a quality verdict never advances
review to it. Two refusals exhaust review and stop the host,
retaining the pool reset time. Replacement authority transfers no predecessor
benchmark, score, verdict or capability evidence to the successors.

## Provisional placement basis (2026-09-23)

ISS-203 follows Todd's [placement-planning ruling](https://github.com/chase-sets/chase-sets/issues/4388#issuecomment-5797093035)
and the September 23 report R,
`C:/Users/ToddS/.codex/visualizations/2026/09/22/01a0cb2a-f41a-7282-8f86-412f60e644ca/model-routing-recommendations-2026-09-23.md`.
R's "Platform changes to propose", "What changed the recommendation",
"Complete effort comparison" and "Ten-component panel" motivate provisional
placements, pending same-row native evidence. Artificial Analysis weighted
USD/task estimates are API benchmark costs, not subscription spend or cost per
accepted artifact. Opus/Fable cells include provider fallback; they establish
neither pure-model nor local native performance. The public panel establishes
no reviewer recall, UI fit or service bar.
The September 23 Sol and Sonnet labels in this entire section refer to the
predecessor selectors `gpt-6-sol` and `claude-sonnet-5`; no benchmark,
score, cost, sample count, verdict or capability evidence transfers to Sol 6.1 or
Sonnet 5.5.

- Row 2 keeps the cheaper Luna/xhigh effort step ($0.042 weighted) before
  adding Sol/medium (index 39.8, TB4 18.7%, $0.248). Sonnet/medium stays last
  for other-vendor continuity, not a capability step. Sol's new author role
  excludes it from review, so Astra replaces only the second review seat.
  Keeping Opus primary follows R's review recommendation. Luna remains bounded
  to this row; its scope is not expanded by these benchmarks.
- Row 3 replaces Sonnet/medium with Opus/medium (index 51.2, TB4 52.5%).
  Its weighted cost is 34% higher ($1.336 versus $0.999) and first chunk
  slower (22.8s versus 2.4s). Opus/high keeps the effort step; Astra/medium
  (49.6, TB4 49.5%, $1.541) is the cross-vendor fallback. Opus authorship
  excludes it from review; Sol stays primary with Sonnet only on refusal.
- Row 15 drops Opus/max: R reports index 57.6 at $5.982 versus Opus/high's
  53.6 at $1.823. Astra/high moves to rung 2; attempts 3–4 repeat it.
  This is the explicit effort-before-model exception, alongside the retained
  row-10 Sol/xhigh skip. It creates no new failure classifier.
- Rows 4/7 and self retain protected Astra/Fable authors and Opus/Sol review.
  Row 10 retains Sol/Astra/Fable authors and Opus/Sonnet review. Row 14 retains
  Opus/medium, Opus/high, Astra/high and Sol/Sonnet review. Native Opus
  permissions do not transfer to the incumbent controller; unchanged review
  efforts and Sonnet tails carry no new quality claim.

Row 2's Luna/Sol/Opus author alternative with Astra-only review was rejected:
it creates a single-model review stop, shares a vendor with most row-2 authors,
and displaces R's recommended Opus review. Benchmark review costs are comparable
and accepted-artifact costs unmeasured. The Luna/high, Sol/medium alternative
also skips the cheaper effort step and loses other-vendor author continuity.

Operator rollback/replan triggers are worse same-row adjudicated quality, a
severe escaped defect, worse review recall/false positives, row-3 interactive
latency or resource regression, or a vendor/model block exhausting a ladder.
At a predeclared first checkpoint, compare 20 determinate outcomes per
configuration with 20 comparable historical pre-cutover incumbent outcomes,
stratified by scope: require no worse quality, no severe escape, and at least
20% lower full accepted-artifact resource cost or 20% faster completion without
material resource regression. Record latency and reviewer recall/precision
separately. This is no automatic route change, statistical confidence claim
or authority to run a trial. Insufficient evidence retains the protected/default
row and requires a separate decision before scope expansion.

## Cutover limit

Use a quiescent fresh-run cutover only after independent exact-head PASS,
final-head three-OS bootstrap green and separate host authorization, with
supervisors and workers absent and fresh runs/paths authorized. Immediately
before an authorized install, the host must capture native account_pool/CLI admission
for each exact target model/effort on that host, with observed UTC instant,
exact requested/reported identity, effort, exit/result and retained evidence
path. For ISS-218 the four captures are `gpt-6.1-sol/medium`,
`gpt-6.1-sol/high`, `claude-sonnet-5-5/medium` and `claude-sonnet-5-5/high`,
through the target executor's actual native Codex CLI/account_pool path.
Unavailable or refused admission stops installation; it permits neither matrix
changes nor predecessor fallback. Installed skill admission, catalogue presence,
earlier Pool14/Responses probes and fixture success are neither timely admission
nor quality evidence. This change authorizes no
probe, install, start, unpark, host rotation or attempt renewal. Workers leave
live executors, WSL runs, providers and runtime untouched. Independent reviewed
publication, main-bound mirror and ordinary native readiness remain required.

Preserve old runs/configs and participant strings, efforts, routing indexes,
attempts, failure counts, retries, ceilings and launch charges. Same-config
replay retains its saved placement and rung. New stage ladders bind the full
configuration fingerprint; changes to other pinned inputs retain
`conflicting-run-configuration` before launch: no backfill, waiver, automatic resume, version-changing
dead-worker retry, budget reset, exhausted-lineage re-entry or #457 renewal.
Observing a pinned worker grants no retired-worker relaunch permission.
Preserved-run continuation needs separate host disposition. Native authoring,
independent review and all ordinary local,
after-mirror and hosted gates remain required.

## Historical selector replacements

ISS-202 implemented Todd's [successor replacement ruling](https://github.com/chase-sets/chase-sets/issues/4388#issuecomment-5786554032)
as literal selector replacements: `gpt-5.6-luna` to `gpt-6-luna`,
`gpt-5.6-sol` to `gpt-6-sol`, and `claude-opus-5` to `claude-opus-5-5`.
That replacement preserved roles, efforts and ladder order; ISS-203's placement
changes are described above. Native Opus roles grant no incumbent protected authorship.
Generic operator model strings remain open configuration; there is no global
blacklist or automatic static-config rewrite.

ISS-218 applies Todd's September 28 [Sonnet replacement](https://github.com/chase-sets/chase-sets/issues/8403)
and September 29 [Sol replacement](https://github.com/chase-sets/chase-sets/issues/8403#issuecomment-5900473741):
`gpt-6-sol` becomes `gpt-6.1-sol` and `claude-sonnet-5` becomes
`claude-sonnet-5-5`. These literal substitutions preserve every ISS-203 row,
role, effort and rung, including native Sonnet reviewer tails. Predecessors
remain historical identities, with no new selections from shipped ladders.

## Historical placement basis (2026-09-15)

The following retained rationale describes the predecessor placements, not
successor results. Here Luna/Sol mean GPT-5.6, Sonnet means Sonnet 5 and Opus
means Claude Opus 5; none of these comparisons establishes successor quality
or capability.

Rebuilt from public benchmarks (Artificial Analysis Intelligence Index v4.3
and Coding Agent Index, vendor launch tables, Terminal-Bench 4.0, GDPval-AA,
OSWorld 2.0) rather than the earlier per-model usage rules, which are
withdrawn. Cheapest configuration that clears the row's bar wins.

| Row | Author        | Basis                                                                                      |
| --- | ------------- | ------------------------------------------------------------------------------------------ |
| 2   | Luna high     | Luna and Sol dominate Terra on the intelligence/cost frontier; Luna runs Codex auto-review |
| 3   | Sonnet medium | Sonnet's value band is low/medium; xhigh costs more than Opus for the same quality         |
| 4   | Astra medium  | Terminal-Bench 4.0 56% vs Sol 37%; every Astra effort sits on the cost frontier            |
| 7   | Astra high    | Tied with Fable 5.1 on both AA indices at roughly 40-60% of the cost per task              |
| 10  | Sol high      | Cheapest flagship that leads DeepSWE (72% vs Astra 68%)                                    |
| 14  | Opus medium   | GDPval-AA leader (1861) at half Fable's price; Astra scores ~45 Elo below Sol on GDPval    |
| 15  | Opus high     | Within 0.5% of Fable on CursorBench at half cost; front-end is Astra's weakest coding area |

Rung 1 retains PR #491's placements. ISS-158 supplies these escalation ladders.
Row 10 changes model at rung 2 because Sol xhigh costs three to four times
the tokens for less gain than Astra's Terminal-Bench lead on debugging.
Fable 5.1 ties Astra at higher cost and emits about 1.5x Fable 5's output
tokens, so it enters as a final cross-vendor author rung. Terra remains
Pareto-dominated and ships in no row. Reviewer fallbacks exclude all models
in their row's author ladder, including later rungs.

The pool converts `reasoning.effort` into Claude thinking; an effort off a
Claude ladder is not refused, so keep Claude rows on the ladder above.
