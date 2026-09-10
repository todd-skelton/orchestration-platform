# The loop

One process improves a repository by picking an issue, dispatching an author,
getting an independent review, landing a PR through hosted CI, and moving on.
It starts on this repository and then runs Chase Sets through an adapter. New
capability is added only when a real cycle records a blocker.

## Rules

1. The loop is `scripts/dogfood/`. Entry points: `loop:prepare`, `loop:run`,
   `loop:repair`, `loop:deliver`, `loop:supervise` in `package.json`.
2. An issue is runnable when it is open, labeled `ready`, every `blocked_by`
   in its draft is closed, and it belongs to the earliest open milestone.
3. Authors run `pnpm typecheck`, `pnpm format:check` and `pnpm test` in their
   worktree before handing off. The hosted three-OS `bootstrap` workflow is
   the only required check on a PR.
4. Review is a verdict (PASS or FAIL), findings with `file:line`, and a G0
   answer: is there a simpler way. A blocking finding fails the review. Two
   blocking rounds force a third repair that applies the reviewer's prescribed
   fixes verbatim.
5. Transient failures get one automatic retry inside the same attempt: a
   failed typecheck or format gate, an unparsable verdict, a delayed exit
   receipt. Four attempts per issue, then stop.
6. Authority does not move. Workers never push, publish, merge, or edit the
   running loop. The executor is the checked-out stable `main`. The author
   never reviews its own work.
7. Every stop posts one paragraph on the issue: what stopped it, how many
   attempts, what a person should change. A recurring note becomes the next
   issue. That is the only intake.
8. Runtime state lives outside the checkout.

## Planning

`planning/roadmap.json` registers milestones and issues. Each issue has a
draft at `planning/drafts/<key>.md`:

```md
---
key: ISS-123
title: "Short imperative title"
labels: ["type:slice", "ready"]
milestone: "Exact milestone title"
blocked_by: [ISS-120, ISS-121]
---

## Why

## Done when

## Out of scope
```

`pnpm planning:check` proves drafts and roadmap agree and the graph is
acyclic. `pnpm planning:board-check` proves every open registered issue on
GitHub carries the marker, the draft link and the verbatim draft, has the
right milestone, and sits on the delivery project once. Closed issues are
history and are not compared. The GitHub issue body is:

```md
<!-- planning-key: ISS-123 -->

Source draft: [`planning/drafts/ISS-123.md`](https://github.com/todd-skelton/orchestration-platform/blob/main/planning/drafts/ISS-123.md)

<verbatim draft>
```

To add work: write the draft, register it, create the issue with that body and
milestone, add it to the project, label it `ready` when unblocked. To park
work: close the issue with a note; leave nothing registered.

## Milestones

| Key | Title                       | Exit evidence                                                                                                                                           |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Unattended self-improvement | Three consecutive useful issues on this repo land through one `supervise` invocation with no per-item host script, including one retry and one restart. |
| M2  | Chase Sets delivery adapter | One low-risk Chase Sets milestone is delivered end to end through the loop with a `chase-sets` adapter.                                                 |
| M3  | Chase Sets adoption         | Routine Chase Sets delivery runs on the platform; the `milestone-orchestrator` host loop is retired for routine work with a rollback.                   |

## Not carried forward

Parked without registration on 2026-09-10; unpark only from a learning note:
N0 certification and self-promotion, credential broker, host custody and
reboot evidence, repository-protection receipts and verifier anchors, the
shadow-parity program, state import, portable-primitives and native-lock
experiments, module manifest and registry, routing engine, telemetry intake,
review calibration. The tree before the replan is tagged
`pre-replan-2026-09-10`.
