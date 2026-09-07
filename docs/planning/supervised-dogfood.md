# Supervised real-work loop

Todd's 2026-09-07 ruling (#323) makes ISS-071 the next delivery target. The
first milestone is **Supervised self-improvement (M0)**: this general-purpose
orchestrator pilot takes one real improvement to its own repository through independent
review and hosted CI, followed by one restart that does not dispatch it again.
It is a supervised trial, not the certified N0-to-N1 release in ISS-015.

## Run boundary

The installed Chase Sets skills are references only. Their controller rules do
not define this platform. Treat the existing launcher as an observed, replaceable
adapter interface, not a second controller or a requirement for every user.

The existing authorized controller selects one low-risk issue, exact base,
allowed file footprint, worker configuration and state directory. It prepares
the worktree and gives the pilot an explicit launcher adapter. The pilot owns
the small sequential run/observe/resume flow; the controller retains credential,
merge and all release authority. A human manually moving every step does not
count as the pilot completing a loop.

Use an installed provider launcher and its author/reviewer isolation. Do not build a
second launcher, credential broker, general engine, scheduler or policy
framework. The adapter translates between the pilot's small local run record
and the launcher's existing attempt identities and terminal observations.
Inspect the real launcher's supported interface before implementation; a
missing capability gets the smallest concrete adapter change, not a new public
contract family. Never import the walking-skeleton fixture into the pilot.

The portable flow has no embedded repository policy or Windows command paths.
The installed native Codex CLI is an explicit host adapter; a host without a
compatible adapter reports unavailable before dispatch. Hosted tests exercise
the portable flow and adapter boundary on macOS, Windows and Linux. The first
live run reports its actual host and proves no untested cross-OS claim.

## One observable cycle

1. Accept the controller-selected issue, reviewed pilot revision, exact base,
   allowed worktree and bounded author/reviewer configurations. Refuse conflicting
   or unknown run ownership before launch.
2. Persist intent outside the checkout and dispatch one real author attempt
   through the adapter. Record the real launcher attempt identity. On restart,
   an uncertain intent-to-launch interval is blocked for operator reconciliation;
   never blindly retry it or claim exactly-once launch without evidence.
3. Observe that attempt to completion. Capture its exact commit and changed-file
   scope. A moved base, unexpected diff or unknown terminal result is blocked.
4. Dispatch a distinct review attempt for that exact commit through the existing
   isolated reviewer path. Author approval cannot substitute for this review.
5. On review PASS, the controller publishes the candidate PR using its existing
   authority. The pilot observes the exact PR head and its required hosted checks.
   Changed heads invalidate readiness. No inferred success from an empty check list.
6. Report ready, blocked or failed with issue, run, author/reviewer identities,
   exact head, PR and CI links. Restart the pilot process once while observing
   an existing attempt, and once after terminal readiness; neither may dispatch
   another author/reviewer or repeat publication. The controller may merge a
   ready candidate under its normal authority; merge is outside pilot acceptance.

The small run record is local trial bookkeeping, not a release receipt or
authority pointer. Existing public contracts keep their meanings. The pilot
does not acquire production locking or recovery authority by writing a record.
One controller reserves one pilot run; launcher ownership remains authoritative.
Crash ambiguity can stop safely. Distributed locking, automatic lease takeover
and unattended restart recovery are deferred.

## Delivery order

Implement and review ISS-071 as one bounded vertical slice, then run it against
one controller-selected low-risk improvement to this orchestrator repository.
The running pilot stays pinned to its reviewed revision; any successor edit is
reviewed as a candidate and cannot replace the running pilot or certify itself.
The first run may apply the already-approved #321A exact scaffold census repair
on PR #320. Preserve unknown-directory and unexpected-manifest failures and
require independent review. It must not edit the running pilot, review/CI success
conditions, mutation authority or release rules. Select the exact target when
the pilot is ready; record it before launch. Do not invent a busywork change to
manufacture a success. A real blocker and its captured evidence is useful, but
does not satisfy the successful-run acceptance criterion.

The already-approved #321 scaffold fix and #319 record correction remain small
maintenance work; neither blocks a pilot under `scripts/dogfood/`. The #318
non-native test discovery repair may proceed within its scope. These repairs
must not expand into the self-host certification program before the trial.

After the run, retain one short learning note: what happened, what stopped
progress, time/spend observed, and the next smallest change justified by that
evidence. Do not add speculative hardening acceptance to ISS-071 mid-flight.

## Pilot invocation

Run `node scripts/dogfood/run.mjs <absolute-request.json>` from the clean,
independently reviewed pilot checkout. Node 24 executes the private TypeScript
modules directly; no package/build registration is needed. The controller first
creates two clean worktrees and an existing external state directory. Supply:

```json
{
  "owner": "controller-identity",
  "run": "unique-trial-label",
  "issue": "https://github.com/owner/repo/issues/123",
  "pilotRevision": "<reviewed pilot 40-character commit>",
  "base": "<author starting 40-character commit>",
  "worktree": "<absolute author worktree>",
  "reviewWorktree": "<absolute separate review worktree>",
  "stateDirectory": "<absolute existing external directory>",
  "allowedPaths": ["exact/file.ts", "allowed/subdirectory/"],
  "repository": "owner/repo",
  "requiredChecks": ["exact hosted check name for each required job"],
  "author": { "model": "<model>", "effort": "<effort>", "promptFile": "<absolute prompt>" },
  "reviewer": { "model": "<model>", "effort": "<effort>", "promptFile": "<absolute prompt>" },
  "adapter": { "kind": "codex-exec", "executable": "<absolute installed native CLI>" }
}
```

For a linked author worktree, optional `adapter.authorGitDirectory` must resolve
to its exact Git common directory. The adapter checks this and adds that write
root only for the author so commits can reach shared Git metadata. The author
uses `workspace-write`; the reviewer uses `read-only` in a separate fresh session.
The actual installed `codex exec --help` supplies the observed CLI flags; preflight
refuses an unavailable/incompatible CLI. `--ignore-user-config` and `--ignore-rules`
avoid importing a user's controller configuration. Existing authentication is
retained. The native CLI's sandbox is the host isolation boundary; no new
credential broker or production worker authority is claimed.

The request file must not be named `config.json` inside the state directory:
the pilot reserves that name for the pinned request/prompt fingerprint. One
controller owns this trial. Exclusive immutable stage files reserve each attempt;
partial writes or intent without identity block for reconciliation, never retry.
These files, process traces and private output-shape files remain external. The
small detached observation process only captures the existing CLI's PID, exit
and JSONL; it survives controller exit and cannot dispatch another attempt.

The pilot appends the exact base/head and four-key JSON verdict instructions to
each prompt. It retains substantive progress messages and advisory token usage
in the attempt trace. It polls author, starts review at the resulting detached
head, then returns `awaiting-publication`. The existing controller publishes
and writes `publication.json` in the state directory containing
`{"url":"https://github.com/owner/repo/pull/123","head":"<reviewed commit>"}`.
Rerun the same command to observe CI using read-only `gh pr view`/`gh pr checks`.
The configured required check names must each appear exactly once and pass.
The pilot verifies PR head before and after reading checks; it never publishes,
pushes, merges or promotes. Restart with the same request while observing and
after `ready`; record unchanged attempt identities and launch artifacts. Even
after readiness, a resumed command rechecks worktrees and hosted CI.

Tests under `test/dogfood/` use fake attempts/processes only. Intended hosted
three-OS execution and independent assertion review remain required. A live run
must separately retain actual host, exact revision, launch counts, attempt and
PR/CI links plus the short learning note; unit tests do not satisfy that trial.

## Deferred work and unpark conditions

| Work | Current disposition | Unpark condition |
|---|---|---|
| CF-2 full capture subsystem, ISS-057 | #322 1A/2B/3B; no four-packet expansion or increased cap | A real trial/release consumer names the minimum needed behavior; unresolved policy remains unusable as authority |
| CF-3 through CF-7, ISS-058 through ISS-062 | Release preparation, off the first trial path | Observed need from a runnable consumer; original correctness dependencies still apply |
| CF-8, ISS-063 | #316 C, deferred | Runnable release consumer needs the post-upload transport |
| ISS-036 live protection window | #317 deferred | Concrete consumer need, dry-run and separately authorized operator action |
| Native experiment and ISS-022 selection | Production-lock track, not this supervised trial's lock | Verified hosted build/experiment and Todd's selection before production use |
| N0 certification, broker, installed supervisor, automatic N1 promotion | Original M3 acceptance unchanged | Production path prerequisites and separate operator/release authority |
| Seven ISS-064 through ISS-070 followups | Reserved in the parked planning artifact, backlog | A measured defect or next real consumer needs one; #319 record repair does not authorize implementation |

Deferral is priority, not false completion or deletion of existing dependency
edges. ISS-071 closes only its supervised trial. ISS-026, ISS-021, ISS-041 and
ISS-015 are not closed or certified by it. Future production extraction must
implement their contracts rather than treating trial bookkeeping as authority.
