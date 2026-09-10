# Model selection

Models the loop can dispatch. Selectors are case-sensitive; efforts are
`low`, `medium`, `high`, `xhigh`, `max` for every row.

| Selector          | Label           | Harness | Roles            |
| ----------------- | --------------- | ------- | ---------------- |
| `gpt-6-astra`     | GPT-6 Astra     | codex   | author, reviewer |
| `gpt-5.6-sol`     | GPT-5.6 Sol     | codex   | author, reviewer |
| `gpt-5.6-terra`   | GPT-5.6 Terra   | codex   | author           |
| `gpt-5.6-luna`    | GPT-5.6 Luna    | codex   | author           |
| `claude-opus-5`   | Claude Opus 5   | claude  | author, reviewer |
| `claude-sonnet-5` | Claude Sonnet 5 | claude  | author, reviewer |
| `claude-fable-5`  | Claude Fable 5  | claude  | author           |

Default: `gpt-5.6-sol` high for both roles. The Claude harness needs ISS-109.
The author and reviewer of one attempt are always distinct launches.
