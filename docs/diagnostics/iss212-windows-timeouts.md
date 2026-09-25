# ISS-212: Windows timeout discriminator

The retained evidence establishes recurring 30-second real-Git test timeouts,
including source4 before ISS-210. It does not discriminate runner variation,
common-path cost, file order/reporting, or a sharding contribution. The additional
Linux capture locates most elapsed time in native queue work, without identifying
a new avoidable operation. **Negative result: no timing remedy is justified or
implemented here. ISS-210 landed; its qualification FAILED.**

## Evidence boundary

All external evidence below was read through the supplied manifest chain, with
no Actions retrieval. Define `P` as
`/mnt/d/Users/ToddS/Source/Repos/chase-sets/.orchestrator/artifacts/` and:

| Alias | Immutable captured path relative to P                                                        |
| ----- | -------------------------------------------------------------------------------------------- |
| E     | `iss212-evidence/`                                                                           |
| R     | `iss212-evidence/astra-iss210-qualification-failure-decision-r1.report.md`                   |
| LM    | `iss212-evidence/logs/main-310891e1-run36141856796-a2-windows-remainder-job108117539592.log` |
| LP    | `iss212-evidence/logs/pr661-ff9baddf-run36146696742-a1-windows-queue-job108109537628.log`    |
| H     | `iss204-evidence/`                                                                           |
| B     | `iss204-m1-attempt1/`                                                                        |
| W     | `iss205-final-windows/`                                                                      |

`E/CAPTURED_AT:1` is `2026-09-25T16:01:25Z`. All 16 entries passed
`sha256sum -c MANIFEST.sha256`. `E/PRIOR-CAPTURES.txt:2-4` binds the other
manifests by SHA-256:

| Manifest              | SHA-256                                                            | Verification                                                  |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| H/MANIFEST.sha256     | `6c5f1ee0772377438e9bd8c694287afc263171a7a5c266e7fae9ea060724c13c` | all 13 file hashes match                                      |
| B/MANIFEST.sha256     | `a29082374f22470ab9505f80e5b96c61fe903da383558deefc44289730e1c7da` | all 57 file hashes match                                      |
| W/MANIFEST.sha256.txt | `055c7d33a16120ebd3f543f567a0f0f6e0ebfe9f6b90aacbe8108ae1c72b22e6` | all three `name size sha256` entries match both size and hash |

These are captured observations, not current provider-health observations.
`E/actions-artifacts-listing-run-36141856796.json:1` lists only attempt-2
artifacts, and `E/actions-artifacts-listing-run-35955692519.json:1` lists zero.
Thus main attempt-1 and #639 JSON were **absent at source at capture time**.
Other missing values below are **not captured**, not evidence of source absence.
The report's references to uncaptured reports/logs are not additional evidence.
The consumed ISS-212 attempt 1 produced no observer or gate result and no review;
its partial ledger is not reused as authority. Its admission misreading and FAIL
remain history; this native WSL attempt needs no Windows host heavy admission.

## Retained case ledger

Head aliases are immutable:

- M = `310891e17320d57963a4cfbe9d8d721f5cfee27b`, ISS-210 landed main.
- P661 = `ff9baddf8bf8eb072c3b35067ba66dad1f3dec2b`, planning-only PR #661.
- P639 = `efbf1cb2ae15155ff986249f7bab58ecf746ba07`, unsharded PR #639.
- P205 = `3810239b278acca53c3381d7193f7db52bbbc52b`, ISS-205 final PR head;
  merge `89934753f69e92320e57f8f60178031a52988136` is a different revision.
- B204 = `acca21ebe8bd8ce23a8f019944527c97a53b9204`, ISS-204 no-edit Linux baseline.
- A = `f2d442cbaab7d12bfbeb057c08fac0f09c828675`, this author's unchanged Git HEAD.

`source4` means `test/dogfood/queue-adapter.test.ts` / `ISS-187 uses native
accounting and terminal hold: source4`. `unpark` means
`test/dogfood/queue.test.ts` / `unparks only attempt 4 with current guidance,
full diff, history and fresh review`. Times are milliseconds. `timeout` is a
failed, censored observation, **not a completed runtime**. F/C is file/case
ordinal: retained JSON file `startTime` order where available, otherwise log
report order; case ordinal is assertion/declaration order. Per-case start
timestamps are not captured. Buffered log order alone is not wall-clock timing.

| Head; run / attempt; job                                        | Case; command profile; F/C                          | Result; case ms                                             | Owning file ms; source                                        |
| --------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| M; 36141856796 / 1; 108093379518                                | source4; remainder; 3/4 reported                    | passed; 12,123                                              | 73,789; R:378-383                                             |
| M; 36141856796 / 1; 108093379365                                | unpark; queue; 1/2 reported                         | passed; 15,547                                              | 620,661; R:896-898                                            |
| M; 36141856796 / 2; 108117539592                                | source4; remainder; 3/4                             | timeout; JSON 30,084.5189, log 30,085                       | log 138,370; LM:273-278,659-677; J1                           |
| M; 36141856796 / 2; 108117539283                                | unpark; queue; 1/2                                  | passed; 21,698.7253                                         | JSON end-start 834,454.2854; J2; job R:55                     |
| P661; 36146696742 / 1; not captured                             | source4; remainder; 3/4                             | passed; 18,450.8365                                         | JSON end-start 143,964.7825; J6                               |
| P661; 36146696742 / 1; 108109537628                             | unpark; queue; 1/2                                  | timeout; JSON 30,088.2135, log 30,088                       | log 909,900; LP:168-175,356-375; J4                           |
| P661; 36146696742 / 2; 108121134540                             | unpark; queue; 1/2                                  | passed; 23,156.9914 (log 23,157)                            | log 905,717; R:1277-1279,1431-1436; J5                        |
| P661; 36146696742 / 2; prior remainder reused                   | source4; no new execution                           | not rerun; no new duration                                  | R:53-55; do not duplicate J6 as attempt-2 work                |
| M; 36141856796 / 3; none                                        | both; qualification not run                         | not run after terminal failure                              | R:1-7; no replacement sample                                  |
| P639; 35955692519 / 1; 107493425864                             | source4; full unsharded; 5/4 reported               | timeout; 30,327                                             | 197,627; H/p639-win.log:766-771,204-206                       |
| P639; 35955692519 / 1; 107493425864                             | unpark; full unsharded; 1/2 reported                | passed; 22,895                                              | 783,470; H/p639-win.log:170-172                               |
| PR #659; head/run/attempt/job not captured                      | actual failing case/file/profile/order not captured | historical failure retained; duration unavailable           | E/AVAILABILITY.txt:5; R:4,67; not a causal comparator         |
| P205; 35988875619 / 1; 107597924010                             | source4; full unsharded; 5/4 reported               | passed; 9,853                                               | 64,930; W/job-107597924010.log:602-607                        |
| P205; 35988875619 / 1; 107597924010                             | unpark; full unsharded; 1/2 reported                | passed; 16,045                                              | 463,706; W/job-107597924010.log:170-172                       |
| B204; m1-iss204-20260924T0815 / author attempt 1; local, no job | source4; three focused samples, sole selected case  | completed, exit 0 each; body 3,832.83 / 4,208.15 / 3,664.21 | B/REPORT.md:25-55,87-89; B/base-source4-{1,2,3}.terminal.json |

For J rows, select `testResults` by the exact owning path (Windows prefix
`D:/a/orchestration-platform/orchestration-platform/`), then `assertionResults`
by the exact case name above: source4 index 3, unpark index 1, zero-based. Each
JSON file is one line. JSON `endTime-startTime` and console file duration are
different observations: #661 queue values are 909,890.6533 and 905,733.1084,
versus console 909,900 and 905,717. Neither difference is an isolated collapse.
The timeout classification uses the paired logs: JSON's `STACK_TRACE_ERROR`
alone does not name the cause (LM:659 and LP:233 explicitly report 30000ms).

The seven JSON artifacts were all inspected, including every file and assertion
result, not merely artifact presence. IDs/head associations come from
`E/actions-artifacts-listing-run-{36141856796,36146696742}.json:1`; job IDs are
separately attributed above and at R:55. Artifact records themselves have no job
ID, runner image or tool versions.

| Alias; path under E/per-test-json/                            | Artifact ID | Actual files; passed / failed / skipped assertions |
| ------------------------------------------------------------- | ----------- | -------------------------------------------------- |
| J1 `windows-remainder-36141856796-2/bootstrap-remainder.json` | 10872071831 | 23; 1230 / 1 / 21                                  |
| J2 `windows-queue-36141856796-2/bootstrap-queue.json`         | 10871307547 | 1; 179 / 0 / 0                                     |
| J3 `windows-refresh-36141856796-2/bootstrap-refresh.json`     | 10871946540 | 1; 245 / 0 / 0                                     |
| J4 `windows-queue-36146696742-1/bootstrap-queue.json`         | 10869778477 | 1; 178 / 1 / 0                                     |
| J5 `windows-queue-36146696742-2/bootstrap-queue.json`         | 10872295070 | 1; 179 / 0 / 0                                     |
| J6 `windows-remainder-36146696742-1/bootstrap-remainder.json` | 10871250745 | 23; 1231 / 0 / 21                                  |
| J7 `windows-refresh-36146696742-1/bootstrap-refresh.json`     | 10869329979 | 1; 245 / 0 / 0                                     |

J1+J2+J3 and J4+J6+J7 each contain 25 distinct files and 1,676 assertions:
1,654 passed, one timed out, 21 skipped. Their full `(relative file, fullName)`
**multisets** match, including four repeated names accounting for seven additional
occurrences (planning-contracts, adapter, supervise, supervision). Do not dedupe
parameterized occurrences. Refresh's JSON `numTotalTestSuites:7` and remainder's
29 count nested suites, not files. None of these artifacts reports interruption;
that says nothing about uncaptured executions. A failed-only union with J5 would
reuse earlier successes, not create another full qualification.

Complete file census (paths under `test/`; `dogfood/` abbreviated `d/`):

| Files                                                                                                   | Assertions per file   |
| ------------------------------------------------------------------------------------------------------- | --------------------- |
| board-contracts, bootstrap-workflow, executor, format-eol, planning-contracts, require-bootstrap-checks | 30, 43, 5, 13, 24, 12 |
| d/adapter, d/chase-sets-adapter, d/chase-sets-deployment                                                | 212, 14, 33           |
| d/delivery-adapter, d/delivery, d/flow, d/integration-continuation                                      | 189, 135, 137, 82     |
| d/queue-adapter, d/queue-post-merge, d/queue, d/refresh                                                 | 33, 19, 179, 245      |
| d/repair-adapter, d/repair-policy, d/repository-adapter, d/routing                                      | 2, 8, 24, 5           |
| d/setup-adapter, d/setup, d/supervise, d/supervision                                                    | 86, 22, 38, 86        |

All names in that table end `.test.ts`. The 21 skips are exactly six in adapter,
13 in chase-sets-adapter, one in repository-adapter and one in executor, matching
the existing OS predicates. Neither target is skipped. A skipped shard **job**
is different: `windows-aggregate.mjs` requires each effective shard's `success`
and would not count it green. The recorded main attempt-2 aggregate
108127944562 failed (R:49-55); this is observed failure visibility, not exhaustive
aggregate certification. Historical #639 preserves 1,485 passed / two timeouts /
21 skips and 22 files (H/p639-win.log:1047-1050); its ceiling timeout 30,318 and
source2/probe passes 28,199/22,662 remain intact. ISS-205's single run preserves
1,530 passed / 21 skips and 22 files (W log:815-818), not a reliability solution.

The captured #639 local diagnostics also stay failed and separate from Actions:

| P639 local diagnostic; file/case report order | Result                                                                                                | Captured evidence under H                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| r1; queue-adapter/source4, 1/4                | setup failure at 241 ms, not a timeout or completed workload; full file 12 failed / 21 passed, exit 1 | platform-639-queue-adapter-isolated-r1.log:1,17-19,186-191 |
| r2; queue-adapter/source4, 1/4                | censored timeout 30,051 ms; full file four timeouts / 29 passed, exit 1                               | platform-639-queue-adapter-isolated-r2.log:1,13-18,48-72   |

Both are local Microsoft Windows NT 10.0.26200.0 / Node v24.15.0, not hosted
images or Actions jobs. R2's header records Git 2.53.0.windows.3 and identifies
r1's invalid Git 2.30 selection; r1 failed on `core.abbrev=no`. Raw launcher argv
and per-test JSON are not captured for either; the verbose log identifies the
isolated owning file, and unpark was not selected. R2's inherited preload is
reported as a confound in H/astra-639-windows-timeout-decision-r2.report.md:18,
not proved as a cause. Its starting CPU sample is not sustained-load evidence.
Neither diagnostic supplies an isolated timing collapse or a complete-suite
control. Their UTC windows are 2026-09-24 06:09:08-06:09:30Z and
06:14:39-06:19:32Z, respectively, from the captured log headers and exit lines.

## Runner, command and order confounders

| Execution                        | Runner image; Node; Git                                            | Source                                              |
| -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| M attempt 1 remainder            | windows-2025-vs2026 20260922.246.2; v24.21.0; 2.55.0.windows.5     | R:124-125,163,213                                   |
| M attempt 1 queue                | same captured versions                                             | R:756-757,795,845                                   |
| M attempt 2 remainder            | same captured versions                                             | LM:16-17,55,105                                     |
| M attempt 2 queue/refresh        | not captured for those jobs                                        | J2/J3 contain no versions                           |
| P661 attempts 1 and 2 queue      | windows-2025-vs2026 20260907.229.1; v24.20.0; 2.55.0.windows.5     | LP:16-17,55,121; R:1120-1121,1159,1225              |
| P661 attempt 1 remainder/refresh | not captured for those jobs                                        | J6/J7 contain no versions                           |
| P639                             | windows-2025-vs2026 20260907.229.1; v24.20.0; 2.55.0.windows.5     | H/p639-win.log:16-17,54,120                         |
| P205                             | windows-2025-vs2026 20260922.246.2; v24.21.0; 2.55.0.windows.5     | W/job-107597924010.log:16-17,54,120                 |
| B204 and A local                 | WSL2 Linux 6.18.33.2-microsoft-standard-WSL2 x64; v24.15.0; 2.53.0 | B/REPORT.md:32-35; current terminals/captures below |

The unchanged current workflow launches separate standard Windows runners with
`pnpm run verify:bootstrap --windows-shard {refresh,queue,remainder}`. Each
retains all four gates. `scripts/verify/bootstrap.mjs` uses Vitest's canonical
discovery, validates a disjoint full partition, and validates exact filters.
Queue is only `queue.test.ts`; source4 is in remainder, not the queue shard.
Under `RUNNER_TEMP`, test commands append `--reporter=default --reporter=json
--outputFile=<runner-temp>/bootstrap-<shard>.json`. Actual command lines survive
at R:260,892,1273, LM:153 and LP:169; the full remainder filter is LM:152.
J2/J6/J7's job command logs are not captured: their profiles above are supported
by the artifact identity and source configuration, not an invented command log.
The historical unsharded logs have `$ vitest run` without added JSON reporting.

For both retained remainder JSONs, file start-time order is delivery-adapter,
adapter, queue-adapter, flow, delivery, supervision, integration-continuation,
setup-adapter, chase-sets-adapter, supervise, bootstrap-workflow, setup,
queue-post-merge, repository-adapter, executor, board-contracts,
chase-sets-deployment, planning-contracts, routing, repair-adapter,
require-bootstrap-checks, format-eol, repair-policy. Main attempt-1 log also
reports source4's file third, after delivery-adapter and adapter. The queue
shard has one file. Historical #639 and ISS-205 report queue first, then refresh,
delivery-adapter, adapter, queue-adapter. File order and reporter differ between
sharded and historical unsharded profiles; no matched same-head control exists.

Inspection at A included the owning files, source-failure/prerequisite fixtures,
native setup/queue callers, workflow selector, reporter and aggregate. The owning
files and Vitest config are byte-identical between committed `ca4c27f9` and A;
the diff from M to A is planning-only. Source4/fixtures also predate ISS-210.
`vitest.config.ts` still has one worker via `fileParallelism:false`,
`sequence.concurrent:false`, and 30,000 ms test/hook limits. Synthetic worker,
authority and delivery replies do not replace the real Git and native accounting
being timed. No product, workflow, selector, config, timeout or assertion changes
are made by ISS-212.

## Reproducible local observer

The helper adapts B/observer.mjs and B/config.mjs's explicit phase scheme,
`tracing:child_process.spawn:start/end`, child `close`, and one-child live
control. It adds a constructor-channel census without reading constructor-time
`spawnargs`; family attribution occurs on `spawn`. Every recorded child needs
start/end/spawn/exit/close in monotonic order, and pending must be zero after all
owning `afterEach` hooks. Teardown starts `cleanup`; `onTestFinished` validates
and writes. Failed tests, missing phases, unmatched/duplicate events, pending
children and bounded-record overflow cannot produce a successful capture.
Tracing `end` is the synchronous spawn-call return, distinct from process `exit`
and stdio `close`.

Only `ISS212_TIMING=<absolute output outside checkout>` enables the two named
cases. Default calls return before probes, subscriptions, hooks or writes.
Output is exclusive-create JSON bounded to 2,048 children, 256 phase intervals
and 1 MB. It includes exact HEAD, measured input SHA-256s, Node/Git executable
and version, UTC, OS, configured serial profile, per-phase elapsed intervals and
per-child lifecycle/family/exit. It excludes argv, cwd, environment, output and
stacks. Git subcommands are retained, not their potentially sensitive arguments.
These are parent-observed children, not Git-internal subprocess counts. Child
lifetimes can overlap and cannot be added to infer phase wall time.

Two small extra test-fixture hook sites beyond the anticipated five files are
necessary for accurate phase boundaries: optional `PhaseTiming` in
`fixtures/source-failure.ts` and `fixtures/prerequisite.ts`. They separate fresh
repository/bare-remote construction from native history construction **inside**
the fixture calls, matching B's boundaries without its source-transform plugin.
Only the two owning cases supply them. Type-only imports and absent callbacks
leave all other calls inert. Proof/snapshot spans and cleanup remain in the
owning files. The native operations and every original assertion stay in order;
the fixtures still create private fresh repositories and preserve accounting.
No extra real-case test or alternate default profile was added.

The five cheap helper tests use one `git --version` and known `node -e` children.
The live test finishes only after a Node child from actual `afterEach` cleanup.
The missing-proof-phase control changes only that phase input. The executed
`guard-bypass mutant: dropped non-control tracing pair fails despite a passing
one-child control` deletes both tracing timestamps for Node child 3 from an
otherwise validated live sample: counts still balance and the live Git control
still passes, but the independent census rejects `ISS212 incomplete-child:3`.
A dropped close and an unmatched event are also rejected. The disabled control
independently counts zero helper children and one subsequent Node child, with
no residual subscriptions. These tests never run either real owning case.

## Local commands and classification

Local artifacts are beneath
`/root/orchestration-m1/runtime/m1-iss212-20260925T1715/iss-212-attempt-2/source/author-temp/`
(alias T). `T/record.py` ran each command foreground and retained full `.log` and
`.terminal.json` files: command, cwd, A, code-input hashes, UTC start/end and exit
code. The observer-on runs also retained `<name>.json`. HEAD stays A under the
author's no-commit rule; these are **A plus the recorded uncommitted test input
hashes**, not execution of a future committed delivery head. All input hashes
matched before/after each run. Documentation is the resulting analysis, not a
measured program input. No inherited `NODE_OPTIONS` was present.

Exact common commands (no config, worker or timeout override):

```sh
pnpm exec vitest run test/dogfood/iss212-timing.test.ts --reporter=verbose
pnpm exec vitest run test/dogfood/queue-adapter.test.ts --reporter=verbose -t '^ISS-187 uses native accounting and terminal hold: source4$'
pnpm exec vitest run test/dogfood/queue.test.ts --reporter=verbose -t '^unparks only attempt 4 with current guidance, full diff, history and fresh review$'
```

For `source4-on` and `unpark-on`, prefix the corresponding command with
`ISS212_TIMING=T/<name>.json`, substituting the absolute T above. For the `-off`
commands the variable is absent. T/record.py records that exact environment
value, as well as the argv array; a new execution needs a new output path.

| Record      | UTC on 2026-09-25         | Exit; result                    | Console case / whole Vitest duration |
| ----------- | ------------------------- | ------------------------------- | ------------------------------------ |
| source4-on  | 18:16:20.584-18:16:26.705 | 0; 1 passed, 32 filtered skips  | 4,289 ms / 5.11 s                    |
| source4-off | 18:16:26.744-18:16:32.811 | 0; 1 passed, 32 filtered skips  | 4,336 ms / 5.09 s                    |
| unpark-on   | 18:16:32.875-18:16:40.476 | 0; 1 passed, 178 filtered skips | 5,413 ms / 6.40 s                    |
| unpark-off  | 18:16:40.545-18:16:46.644 | 0; 1 passed, 178 filtered skips | 4,039 ms / 4.96 s                    |

The filtered skips are deliberate opt-in selection, not OS skips or a full gate.
The earlier `T/source4-development.json` also completed (4,040 ms console case)
while developing tool/profile identity capture; it is retained, not substituted
for the final-input rows. No failed diagnostic sample was discarded. The enabled
versus disabled differences include observer overhead, startup and run variation;
the one-pair unpark difference is not an overhead estimate or a load attribution.

Phase extension, milliseconds. Each cell is **children / wall / summed child
lifetimes**, excluding metadata collection before the live control:

| Phase                           | B source4 sample 1      | A source4-on            | A unpark-on             |
| ------------------------------- | ----------------------- | ----------------------- | ----------------------- |
| observer-control                | 1 / 12.97 / 11.35       | 1 / 6.11 / 4.34         | 1 / 10.29 / 8.47        |
| fresh repository/remote (setup) | 7 / 55.21 / 44.89       | 7 / 62.01 / 52.04       | 6 / 51.71 / 45.80       |
| native queue/launch             | 447 / 3431.52 / 2265.66 | 435 / 3682.32 / 2305.40 | 575 / 4945.80 / 3680.98 |
| snapshot/proof                  | 0 / 346.10 / 0          | 0 / 332.04 / 0          | 0 / 179.24 / 0          |
| cleanup                         | 0 / 49.33 / 0           | 0 / 54.79 / 0           | 0 / 52.83 / 0           |
| body (setup + queue + proof)    | 454 / 3832.83 / —       | 442 / 4076.38 / —       | 581 / 5176.76 / —       |

| Phase; family               | B source4/1 count / child ms | A source4 count / child ms | A unpark count / child ms |
| --------------------------- | ---------------------------: | -------------------------: | ------------------------: |
| control; Node launcher      |                     0 / 0.00 |                   0 / 0.00 |                  0 / 0.00 |
| control; git --version      |                    1 / 11.35 |                   1 / 4.34 |                  1 / 8.47 |
| setup; Node launcher        |                     0 / 0.00 |                   0 / 0.00 |                  0 / 0.00 |
| setup; executable lookup    |                     1 / 3.67 |                   1 / 3.53 |                  1 / 2.95 |
| setup; git add              |                     1 / 4.86 |                   1 / 4.68 |                  1 / 5.73 |
| setup; git clone            |                    1 / 11.38 |                  1 / 13.24 |                 1 / 12.81 |
| setup; git commit           |                    2 / 15.66 |                  2 / 16.01 |                 1 / 11.11 |
| setup; git init             |                     1 / 6.10 |                  1 / 10.64 |                  1 / 8.95 |
| setup; git remote           |                     1 / 3.23 |                   1 / 3.94 |                  1 / 4.26 |
| queue; Node launcher        |                     0 / 0.00 |                   0 / 0.00 |                  0 / 0.00 |
| queue; git --version        |                    8 / 30.48 |                  8 / 28.28 |                 9 / 40.98 |
| queue; git add              |                    3 / 12.08 |                  3 / 13.82 |                 5 / 28.37 |
| queue; git branch           |                  36 / 173.14 |                36 / 189.92 |               44 / 291.57 |
| queue; git check-ref-format |                   16 / 81.89 |                 16 / 70.09 |               20 / 102.39 |
| queue; git checkout         |                    3 / 14.04 |                  3 / 16.78 |                 4 / 23.69 |
| queue; git commit           |                    3 / 21.15 |                  3 / 23.73 |                 5 / 50.08 |
| queue; git diff             |                   16 / 56.75 |                 16 / 58.74 |               25 / 122.04 |
| queue; git fetch            |                    2 / 21.28 |                  2 / 23.27 |                 2 / 27.90 |
| queue; git for-each-ref     |                    8 / 21.59 |                  8 / 27.13 |                10 / 37.03 |
| queue; git ls-files         |                     3 / 9.15 |                   3 / 9.87 |                 4 / 16.80 |
| queue; git merge-base       |                   10 / 32.72 |                 10 / 36.26 |                16 / 73.79 |
| queue; git push             |                     0 / 0.00 |                   0 / 0.00 |                 1 / 34.18 |
| queue; git rebase           |                    2 / 11.44 |                  2 / 13.78 |                 2 / 20.18 |
| queue; git rev-parse        |                201 / 1127.40 |              193 / 1107.95 |             257 / 1779.05 |
| queue; git show             |                    3 / 10.40 |                  3 / 13.73 |                  2 / 8.67 |
| queue; git status           |                  77 / 373.98 |                73 / 370.94 |              100 / 614.61 |
| queue; git worktree         |                  56 / 268.16 |                56 / 301.10 |               69 / 409.66 |
| proof; Node launcher        |                     0 / 0.00 |                   0 / 0.00 |                  0 / 0.00 |
| cleanup; Node launcher      |                     0 / 0.00 |                   0 / 0.00 |                  0 / 0.00 |

B/phases.csv:47-61 and B/families.csv (rows selected by `sample=base-source4-1`)
contain the original comparison rows. B source4
samples 2/3 retain the same 454 children, queue 3,720.18/3,265.39 ms, proof
424.78/337.13 ms, setup 63.20/61.69 ms, cleanup 58.54/48.65 ms. No focused unpark
sample is captured in B. The family extension above keeps all baseline families, including
zero Node rows, and adds unpark's push. B's `git undefined` raw rows are
`git --version` per B/REPORT.md:106-107 and its retained arguments.

Source4 queue wall share is **90.33%**, versus B's 87-91%; unpark is **95.54%**.
Both real cases have **zero Node launcher children**, because worker launches are
synthetic callbacks. This is positively checked by the live Node controls, not
assumed from an empty channel. Setup/proof/cleanup are measured, not assigned
the residual of wall time. Source4's eight fewer queue `rev-parse` and four fewer
`status` children match the shape of ISS-205's existing same-checkout read reuse
(`8993475`, `setup-adapter.ts`); worktree/branch counts stay 56/36. That is a
post-ISS-205 count observation, not a Windows speedup estimate. Other native
queue/supervision/delivery code also changed between B204 and A; this historical
comparison is not an isolated ISS-205 causal experiment.

## Decision and handoff

The retained same-head flips establish variation, not its cause. Main remainder
source4 crosses 30 seconds on the same image; #661 queue flips on the same older
image while the file stays roughly 905-910 seconds. Main attempt-1 queue's
620,661 ms is an image/head-confounded comparator. Linux's dominant Git/native
phase cannot allocate a Windows timeout. No unchanged isolated Windows collapse
plus complete unchanged serial gate exists here; no load-sensitive finding is
made. No same-head comparable-Windows sharded/unsharded control exists; no
sharding-causal finding is made. #639 proves a pre-existing class, not that
sharding cannot contribute. ISS-204 remains a no-edit failed implementation
attempt reconciled by its successor, and ISS-205's one green Windows run remains
one observation. No coverage, security, aggregate or required-diagnostic defect
was demonstrated by this analysis.

**Explicit follow-up decision:** retain ISS-210 and route one separately
authorized campaign, `ISS212-Windows-phase-1`, to the host. At one unchanged
reviewed candidate, capture each owning file once with serial unchanged tests
and this observer, then a complete unchanged serial gate with exact tool/image,
order, command, job and per-test identities. Hosted observation needs a separately
reviewed non-landing diagnostic workflow; this issue adds none. An admitted
local Windows capture is useful but cannot stand in for a hosted runner. If
sharding causation remains material, separately authorize a matched same-head
sharded/default-unsharded hosted comparator and retain reporter/order differences.
Stop at that bound even if inconclusive; no qualification attempt 3 or rerun-until-
green series. Any supported remedy or revert gets a new fixed scope and review.
A confirmed coverage/aggregate/security/required-diagnostic defect goes directly
to M1 containment and repair-versus-revert planning; latency alone does not
automatically revert. This is a follow-up decision, not host execution authority.

ISS-212 already precedes ISS-211 in the roadmap; no planning/controller change
is needed. After independent review of this discriminator and applicable exact-
head three-OS proof, the host rechecks #662's current brief, board and native
prerequisites and makes it ready next. An inconclusive result does not justify
indefinite deferral. No readiness, installation, runtime or provider mutation is
performed by this author.

## Local verification

| Command                                                                      | Exit | Retained evidence under T                                                                                          |
| ---------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run test/dogfood/iss212-timing.test.ts --reporter=verbose` |    0 | focused.log and focused.terminal.json; all five cheap controls pass                                                |
| `pnpm typecheck`                                                             |    0 | typecheck.log and typecheck.terminal.json                                                                          |
| `pnpm format:check`                                                          |    0 | format-check.log and format-check.terminal.json; checked after this document's final text update                   |
| `pnpm planning:check`                                                        |    0 | planning-check.log and planning-check.terminal.json                                                                |
| `pnpm test`                                                                  |    0 | test.log and test.terminal.json; 26 files passed, 1,676 passed / five existing skips (1,681 tests), 614.44 seconds |

The full gate ran 2026-09-25T18:17:11.927813Z to 18:27:27.460877Z with
`ISS212_TIMING` absent, no test filters, and unchanged one-worker/file-serial
configuration. The original source4 and unpark registrations each execute once
in that full gate, with observation inert. Owning-file counts remain 33 and 179,
unchanged from `ca4c27f9`; the total increases only by the five cheap helper tests
in one new file. `pnpm exec vitest list test/dogfood/queue-adapter.test.ts
test/dogfood/queue.test.ts --json` (exit 0, T/owning-discovery.json) independently
checks both registration counts and one occurrence of each exact name without
rerunning the cases. The full gate's default reporter retains the complete
aggregate result, not individual case durations; the additional focused results
are separate evidence. No test count, skip, limit or failure was waived.

No existing assertion changes: the owning-file diff adds phase calls and optional
callback forwarding; the shared fixtures add only those optional boundaries.
The five new control assertions check independently known children, actual hook
ordering, the specific missing-phase/child failures and observer inactivity.
All measured code-input hashes stayed unchanged through the gate.

Independent review belongs to the loop's separate reviewer after candidate
capture. This report supplies no self-review verdict, hosted-green claim or
waiver. Delivery still requires fresh exact-head review and all ordinary gates.
