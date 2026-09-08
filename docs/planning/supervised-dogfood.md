# Supervised real-work loop

M0 completed its supervised real-work loop through PR #320. The next goal is
successive useful cycles with fewer manual interventions, beginning with keeping
actionable worker diagnostics in pilot output. This remains a supervised trial,
not a production or self-promotion claim.

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
3. Observe that attempt to completion. The author edits source only and reports
   the unchanged base. Validate tracked, staged, untracked and deleted paths
   before staging the exact footprint and making one local controller commit.
   Reserve commit intent first; missing durable candidate evidence after that
   intent blocks reconciliation instead of retrying the commit. A moved base,
   unexpected diff or unknown terminal result is blocked.
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

The adapter accepts only `kind` and `executable`; obsolete extra Git-write
configuration is refused. The author uses `workspace-write` for source edits
only, with no additional write roots. Shared Git metadata remains protected by
the native sandbox. The reviewer uses `read-only` in a separate fresh session.
Canonical pilot, author and reviewer roots must not overlap; the state directory
must not overlap any checkout. Both documented temporary-root exclusions and
an empty `sandbox_workspace_write.writable_roots` are explicit CLI overrides.
See the [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
for `exclude_slash_tmp` and `exclude_tmpdir_env_var`.
The actual installed `codex exec --help` supplies the observed CLI flags; preflight
refuses an unavailable/incompatible CLI. `--ignore-user-config` and `--ignore-rules`
avoid importing a user's controller configuration. Existing authentication is
retained. The native CLI's sandbox is the host isolation boundary; no new
credential broker or production worker authority is claimed.

Native Windows workers explicitly select the host's observed `unelevated`
backend; `--ignore-user-config` otherwise removes that separate setting. Other
hosts receive no Windows override. Both native process hops rebuild their child
environment from an empty object: controller to observer and observer to worker.
The exact allowlist is `PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`,
`TEMP`, `TMP`, `TMPDIR` for OS and process startup, plus provider-auth locations
`CODEX_HOME`, `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`,
`LOCALAPPDATA`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME`. POSIX accepts only those
exact uppercase spellings. Windows matches names case-insensitively and emits
one canonical uppercase spelling; an exact canonical entry wins over an alias.
Windows also explicitly permits `LOGONSERVER`, `SYSTEMDRIVE`, `USERDOMAIN`, and
`USERNAME`: libuv supplies these startup names from its own process when absent
from a supplied environment. Thus the list is 17 names on POSIX and 21 on Windows.
The projected object has no prototype and is frozen. A non-enumerable own
`NODE_V8_COVERAGE` entry with value `undefined` prevents Node's automatic ambient
coverage propagation; no coverage variable is transported to the child. Other
JavaScript runtime attempts to append variables fail before spawn.
Every other parent name is omitted without logging, including delivery/cloud
credentials, `NODE_OPTIONS`, askpass, agent sockets and proxies. Provider-auth
filesystem and keychain locations stay usable; this does not isolate those
stores. The parent remains unchanged and no environment is serialized into the
request or trace.

Child runtime initialization is a separate boundary. CoreFoundation can generate
the exact `__CF_USER_TEXT_ENCODING` name on macOS after exec; it is never copied
by this allowlist. Hosted fixtures allow only that exact Darwin runtime name in
addition to the explicit list and report fixed booleans for verification. Native
Windows tool shells may add offline proxy controls, as recorded by live
presence-only checks. Neither behavior authorizes arbitrary runtime-name prefixes,
parent proxy pass-through, or inspection of environment values.

This stronger boundary supersedes the five-name ISS-073 candidate that source 1
and review 2 passed. Source 6, review 7 and four controller gates passed the next
candidate, but hosted Windows/macOS failures withheld acceptance. The bounded
controller repair requires independent review 8, all four gates at the corrected
head, and fresh hosted three-OS execution. Credential material reached retained
logs in the original observed run.
Its validity and scopes and any unauthorized operations remain unverified, and
invalidation was not performed. This repair does not prove controller
containment or identify which launch-context defect caused the earlier read-only
downgrade. See pressure rounds 474 and 476.

The request file must not be named `config.json` inside the state directory:
the pilot reserves that name for the pinned request/prompt fingerprint. One
controller owns this trial. Exclusive immutable stage files reserve each attempt;
partial writes or intent without identity block for reconciliation, never retry.
These files, process traces and private output-shape files remain external. The
small detached observation process only captures the existing CLI's PID, exit
and JSONL; it survives controller exit and cannot dispatch another attempt.

The pilot appends the exact base/head and JSON verdict instructions to each
prompt. The four authority keys remain required; new native schemas also require
a summary string of at most 2,000 characters, using an empty string when there
are no findings. The parser still accepts legacy four-key records. The pilot
omits malformed or empty summary values, bounds long ones, and exposes retained
summaries as advisory diagnostics without changing verdict, head, role, or run
checks. Author `head` must be the unchanged base; the pilot makes the local commit
under the controller's existing authority after validating the complete
footprint. The author does not stage,
commit, or alter Git metadata. The pilot starts review at the resulting detached
candidate head, then returns `awaiting-publication`. The existing controller
publishes and writes `publication.json` in the state directory containing
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

## Normal delivery command

ISS-074 extracts the repeatedly measured post-review controller handoffs into
`node scripts/dogfood/deliver.mjs <absolute-request.json>`. This remains a
private self-repository composition, not a public capability or successor
activation path. Run it from the independently reviewed stable checkout. The
external `delivery-request.json` is a direct child of the external state
directory, binds an exact candidate and includes controller-held authority:

```json
{
  "run": "unique-delivery-label",
  "issue": "https://github.com/todd-skelton/orchestration-platform/issues/332",
  "repository": "todd-skelton/orchestration-platform",
  "controllerRoot": "<absolute stable checkout>",
  "controllerRevision": "<reviewed stable 40-character head>",
  "worktree": "<absolute clean candidate worktree>",
  "reviewWorktree": "<absolute clean exact-head review worktree>",
  "stateDirectory": "<absolute existing pilot state directory>",
  "candidateHead": "<independently reviewed 40-character head>",
  "requiredChecks": [
    "Node 24 / ubuntu-latest",
    "Node 24 / windows-latest",
    "Node 24 / macos-latest"
  ],
  "authority": {
    "schemaVersion": "dogfood-delivery-authority/v1",
    "controller": "<controller identity>",
    "run": "unique-delivery-label",
    "repository": "todd-skelton/orchestration-platform",
    "controllerRevision": "<same stable head>",
    "head": "<same reviewed head>",
    "actions": ["gates", "mirror", "publish", "merge", "cleanup"]
  },
  "policy": {
    "kind": "orchestration-platform-self/v1",
    "planningKey": "ISS-074",
    "planningIssue": 332,
    "parentEpicKey": "EPIC-KERNEL",
    "parentEpicIssue": 2,
    "sourceBranch": "codex/<selected normal-delivery branch>",
    "baseBranch": "main",
    "pullRequestTitle": "<approved title>",
    "pullRequestBody": "<approved body>"
  }
}
```

The command first joins the pinned pilot `config.json`, candidate, both exact
attempt identities and both terminal records into narrow `delivery-source.json`
evidence. The join binds the controller, run, repository, pilot revision,
worktrees and hosted check set without reading worker prose. It then runs
typecheck, format and local planning checks; mirrors only the approved ISS-074
and kernel-epic bodies; runs the board check; publishes or updates one draft PR;
observes every required hosted check at the exact reviewed head; and uses the
explicit squash/cleanup policy only after all checks pass. It stages PR and issue
bodies plus immutable mutation intents in the external state directory.

Every provider mutation is observed before and after the call. Confirmed state
is recorded and never repeated. Unknown or partial publication, merge or cleanup
stops with a typed reconcile status; a later invocation observes provider state
before any retry. Cleanup refuses moved, dirty, missing or broad targets and
requires the stable controller checkout to survive. Once cleanup is confirmed,
restart reads a separately policy-authorized plan digest and the complete gate,
draft, publication, hosted-check and merge receipt chain directly; it does not
enter the original pilot flow or resolve the removed candidate/reviewer paths.
Publication and merge observations bind the repository, PR number and URL,
source, base, title, body and exact reviewed head before dependent effects.
Output is limited to typed status, identities, heads and check links; raw errors,
logs, worker prose and environment values are excluded.

Stable release N may run this command for reviewed N+1. N+1 cannot invoke itself
as delivery authority, certify its tests, activate itself or alter the production
release/operator fences. The controller still owns request creation, credentials
and every mutation grant. Hosted fixtures demonstrate behavior only; the next
genuinely useful measured issue must retain real counts, identities, exact heads,
hosted execution and restart evidence.

## Deferred work and unpark conditions

| Work                                                                   | Current disposition                                      | Unpark condition                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CF-2 full capture subsystem, ISS-057                                   | #322 1A/2B/3B; no four-packet expansion or increased cap | A real trial/release consumer names the minimum needed behavior; unresolved policy remains unusable as authority |
| CF-3 through CF-7, ISS-058 through ISS-062                             | Release preparation, off the first trial path            | Observed need from a runnable consumer; original correctness dependencies still apply                            |
| CF-8, ISS-063                                                          | #316 C, deferred                                         | Runnable release consumer needs the post-upload transport                                                        |
| ISS-036 live protection window                                         | #317 deferred                                            | Concrete consumer need, dry-run and separately authorized operator action                                        |
| Native experiment and ISS-022 selection                                | Production-lock track, not this supervised trial's lock  | Verified hosted build/experiment and Todd's selection before production use                                      |
| N0 certification, broker, installed supervisor, automatic N1 promotion | Original M3 acceptance unchanged                         | Production path prerequisites and separate operator/release authority                                            |
| Seven ISS-064 through ISS-070 followups                                | Reserved in the parked planning artifact, backlog        | A measured defect or next real consumer needs one; #319 record repair does not authorize implementation          |

Deferral is priority, not false completion or deletion of existing dependency
edges. ISS-071 closes only its supervised trial. ISS-026, ISS-021, ISS-041 and
ISS-015 are not closed or certified by it. Future production extraction must
implement their contracts rather than treating trial bookkeeping as authority.
