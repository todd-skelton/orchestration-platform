# Orchestration Platform

A loop that improves a repository by picking an issue, dispatching an author,
getting an independent review, and landing the PR through hosted CI. It runs
on this repository first and then on Chase Sets through an adapter.

- [docs/loop.md](docs/loop.md): the rules, the planning format, the milestones.
- [docs/model-selection.md](docs/model-selection.md): models the loop can dispatch.
- `planning/roadmap.json` and `planning/drafts/`: the executable backlog.

Verify locally:

```sh
pnpm typecheck && pnpm format:check && pnpm planning:check && pnpm test
```
