# Codex 0.144.4 admitted tool manifest

This is a closed initial admission target for `ISS-023`, not a census learned
from a successful run. The raw model-visible tool names must be exactly those in
the applicable role row; added, removed, renamed, or schema-expanded tools fail
before work and require a reviewed contract change.

| Role | Tool | Permitted capability |
|---|---|---|
| implementation | `exec_command` | execute one command string through the pinned per-OS interpreter below, only inside the exact synthetic workspace under `workspace-write`; no network, extra directory, privilege, approval escalation, or credential inheritance |
| implementation | `apply_patch` | modify files only under the exact synthetic workspace; final delta restricted by fixture verifier |
| review | `exec_command` | read-only commands inside the exact workspace; write, network, credential, privilege, approval, and extra-directory attempts denied |
| observer | `exec_command` | same read-only boundary as review |

No role admits `web_search`, image/computer tools, MCP, plugin tools,
`apply_patch` for review/observer, arbitrary shell outside the workspace, or a
tool that can change sandbox/approval/configuration.

The command string is not represented as native argv. Its admitted interpreter
is part of the subject: Windows uses the exact system Windows PowerShell binary
with `-NoLogo -NoProfile -NonInteractive -Command`; macOS uses `/bin/zsh -f -c`;
Linux uses `/bin/bash --noprofile --norc -c`. The probe records executable byte
digest/version and the CLI-emitted invocation. An absent, moved, extra-profile,
different interpreter, or broader quoting contract is `BLOCK_REPLAN`. This
integration detail does not make PowerShell a platform runtime dependency.

The admitted JSON-schema shapes are exact:

`exec_command`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["cmd", "workdir"],
  "properties": {
    "cmd": { "type": "string", "minLength": 1 },
    "workdir": { "type": "string", "const": "<absolute-synthetic-workspace>" },
    "yield_time_ms": { "type": "integer", "minimum": 1000, "maximum": 30000 },
    "max_output_tokens": { "type": "integer", "minimum": 1, "maximum": 20000 },
    "tty": { "type": "boolean", "const": false }
  }
}
```

`apply_patch`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["patch"],
  "properties": {
    "patch": { "type": "string", "minLength": 1 }
  }
}
```

The placeholder workspace constant is replaced only with the fixture's recorded
absolute path before canonical JSON hashing. The probe captures the CLI-emitted
raw schema, normalizes only key order, and compares exact bytes/digest to this
manifest. A functionally similar but differently named or broader schema is not
compatible. If Codex 0.144.4 does not expose this surface, the probe follows its
`BLOCK_REPLAN` disposition; it does not widen the manifest in implementation.
