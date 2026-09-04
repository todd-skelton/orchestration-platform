# Operator model selection

List the configured options or emit an explicit selection:

```sh
node scripts/model-options.mjs list task
node scripts/model-options.mjs list orchestration
node scripts/model-options.mjs select orchestration gpt-6-astra high
```

`config/model-options.json` contains operator choices, including GPT-6 Astra
for tasks and orchestration. Selection is case-sensitive and requires a listed
effort. Astra supports low, medium, high, xhigh, and max. The catalog records no
default, pricing, capability score, credentials, or provider availability.

The command returns `identityStatus: "selector-only"`. It does not launch a
worker, acquire a lease, certify a host, or establish a provider-authenticated
snapshot. ISS-012 still owns evidence-backed routing and installed host census
selection; its package remains a scaffold. The eventual runtime must obtain
attempt-time provider identity and host authority independently. Astra inherits
no Sol evidence. This operator command is usable before that runtime ships.

The Chase Sets embedded controller separately offers `-Model gpt-6-astra` for
tasks and `start-host-trial.ps1 -Arm astra-high` for its high-effort host option.
That adapter's defaults and promotion rules remain independent of this catalog.

Model reference, checked September 4, 2026:
[OpenAI GPT-6 Astra documentation](https://developers.openai.com/api/docs/models/gpt-6-astra).

Verify this bounded selection surface with:

```sh
node --test scripts/tests/model-options.node-test.mjs
```
