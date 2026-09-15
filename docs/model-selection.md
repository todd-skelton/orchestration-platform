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
| `gpt-5.6-terra`    | GPT-5.6 Terra    | minimal, low, medium, high, xhigh, max | author           |
| `gpt-5.6-luna`     | GPT-5.6 Luna     | minimal, low, medium, high, xhigh, max | author           |
| `claude-opus-5`    | Claude Opus 5    | low, medium, high, max                 | author, reviewer |
| `claude-sonnet-5`  | Claude Sonnet 5  | low, medium, high, max                 | author, reviewer |
| `claude-fable-5-1` | Claude Fable 5.1 | low, medium, high, max                 | author           |

Placement comes from the routing row, not from a per-run pair (ISS-149,
`docs/loop.md`): the self adapter uses Astra/high author and repair with
Opus/high review and Sol/high fallback; Chase Sets issues carry a routing
marker that selects a row from `adapters/chase-sets-routing.json`. Terra and
Fable never review, and the reviewer's model never equals the author's.
`claude-fable-5` is retired and never selectable.

The pool converts `reasoning.effort` into Claude thinking; an effort off a
Claude ladder is not refused, so keep Claude rows on the ladder above.