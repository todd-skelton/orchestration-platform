# ISS-230 synthetic regression evidence

Executed in the author worktree based on
`9feb892a265e787b71c6c7cdbd9769148b3e562f`, with HEAD unchanged. All fixture
repositories, jobs, logs, comments, stops and workers are synthetic. No incident
runtime was used as a fixture and no GitHub/provider mutation was performed.

## Production baseline

The delivery, delivery-adapter, queue and supervision production files at this
base are byte-identical to `4c1287e1c81e2c724ad08a70d7d05604fb69345e`.
The following command was run with those production files (and fault-class)
temporarily restored to their `4c1287e1` contents, retaining the new tests:

```sh
pnpm exec vitest run test/dogfood/delivery.test.ts test/dogfood/queue.test.ts -t 'ISS-230 SYNTHETIC (mixed six-job|all-never-executed|hosted completed-stop continuation: completed)'
```

Exit **1**, three expected failures:

| Test name suffix                                                                      | Required result                                                | Baseline actual result               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| mixed six-job publication preserves failures without demanding the unassigned job log | Executed failure evidence, no macOS job-log request            | `hosted-check-log-unavailable:macos` |
| all-never-executed stops after the shared two retries without logs or parking         | `hosted-check-never-executed`, waits 1000/2000                 | `hosted-check-log-unavailable:macos` |
| hosted completed-stop continuation: completed                                         | Existing-publication observation, ordinary attempt advancement | `invalid-gate-stop-authorization`    |

The implementation files were restored immediately afterward. The completed-stop
fixture exercises real source/review/setup, queue delivery and supervision;
its initial retained stop represents the old observer's log-acquisition refusal,
not a fabricated local gate failure.

## Bypass experiments

Each experiment temporarily changed only the named production condition, ran
`pnpm exec vitest run <owning test file> -t '<owning test name>'`, then restored
the production bytes. Every listed command exited **1** from the expected test
assertion, rather than a compilation/import failure. All names below have the
prefix `ISS-230 SYNTHETIC`.

| Mutant                                                   | Owning test suffix                                                                  | Observed wrong behavior                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Remove runner-value check                                | discriminating control positive runner                                              | Executed cancellation's log request disappears                            |
| Remove empty-steps check                                 | discriminating control (unstarted\|started) step                                    | Both cancellations' log requests disappear                                |
| Project full census to required checks                   | full census executed failure only in shard                                          | Incorrect `hosted-check-never-executed` despite an executed shard failure |
| Omit post-log verification and final acquisition bracket | acquisition drift attempt publishes no evidence                                     | Publishes failure evidence after attempt drift                            |
| Skip every cancelled log                                 | discriminating control positive runner                                              | Executed cancellation's log request disappears                            |
| Demand every cancelled log                               | mixed six-job                                                                       | Incorrect missing macOS log stop                                          |
| Remove exact witness commit lookup                       | hosted completed-stop continuation: unresolvable witness                            | Incorrectly advances attempt; other ancestry inputs remain frozen         |
| Remove setup-to-witness ancestry                         | hosted completed-stop continuation: (older\|divergent) witness                      | Both invalid witnesses incorrectly advance attempt                        |
| Remove repair-absence check                              | hosted completed-stop continuation: included repair                                 | Incorrectly advances despite repair already present at stop time          |
| Invent absent historical setup                           | hosted completed-stop continuation: missing setup                                   | Incorrectly advances without retained setup evidence                      |
| Omit historical setup validation                         | hosted completed-stop continuation: malformed setup                                 | Incorrectly advances with malformed retained setup                        |
| Omit witness string/SHA validation                       | composes a four-input saved-stop grant outside immutable source and delivery inputs | Accepts a malformed witness grant                                         |

Runner, steps, full-census and acquisition mutants belong to
`test/dogfood/delivery.test.ts`; witness mutants belong to
`test/dogfood/queue.test.ts`. The grant-schema test uses its existing name without
the synthetic prefix. Attempt revalidation has two acquisition boundaries;
the experiment disables both, rather than pretending that removing one redundant
read bypasses the other.

## Consumer inventory

- `deliveryStep` calls `hostedFailureEvidence` with the observed required checks
  and complete effective-job census. The latter calls `failedCheckLog` for each
  executed cancellation and once per failing run/attempt, then revalidates the
  complete observation before publishing evidence.
- Queue `correctiveEvidence` calls `hostedFailureEvidence` without a supplied
  census, including the dead-author recovery path through `boundedNative`.
  That entry acquires the same current census or reuses complete retained
  evidence; it does not invent historical non-execution. The new bounded stop
  keeps its reason and diagnostic through that caller.
- `validateGateStopAuthorization` is used by both loop and queue config
  validation. `queueConfigFromLoop` carries it outside immutable source inputs.
  `nextCycle` and `reconcilePendingStop` admit only the matching saved hosted
  stop; native `repositoryQueueAdapter.delivery` validates and reserves it.
- `retainedPostMergeDelivery` follows the original publication directory for
  this hosted variant, while existing local-gate continuations retain their
  separate delivery directory. The ordinary four-key and executor-repair
  controls remain in the queue suite.

The expanded tests also exercise explicit-null versus missing runner metadata,
missing/malformed steps, executed empty/error logs, metadata/census/identity
drift, shared transport/non-execution retry exhaustion, underlying shard and
aggregate failures, retained log replay, pending/completed stop receipts,
refreshed and corrected source directories, interrupted acquisition and
retained implementation accounting. Test execution is local evidence; it is
not independent review, hosted bootstrap green, installation or recovery
authority.

## Final implementation verification

At the unchanged base HEAD with this implementation in the working tree:

- `pnpm exec vitest run test/dogfood/delivery-adapter.test.ts test/dogfood/delivery.test.ts test/dogfood/queue.test.ts -t 'ISS-230|composes a four-input saved-stop'`:
  exit **0**, 45 selected tests passed. The three baseline-red cases now produce
  their required results, and the restored mutation controls pass.
- `pnpm test --reporter=verbose`: exit **0**, all 30 files passed;
  **2103 passed, 12 skipped**, 1269.87 seconds. No source or tests changed during
  this complete run. Its raw output remains in the author runtime's
  `author-temp/iss230-final-full-suite.log`.
- `pnpm typecheck`, `pnpm format:check`, `pnpm planning:check`: exit **0**.

The optional/platform skips above are suite-reported skips, not evidence of
execution. No timeout, workflow, test selection or verifier configuration was
changed to obtain the full-suite result.
