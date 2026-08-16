# Self-host GitHub and Actions authority contract

The self-host adapter recognizes exactly one open GitHub issue carrying label
`orchestration:self-host` and one fenced `orchestration-work/v1` canonical JSON
block. The block contains UUIDv7 `workId`, repository numeric ID, issue number/
node ID, exact base SHA/tree digest, outcome enum `add-health-summary-v1`, module
path `modules/health-summary/`, acceptance-bundle SHA-256, operator numeric actor,
and creation time. The issue form is `.github/ISSUE_TEMPLATE/self-host-work.yml`;
the operator supplies no free-form executable instruction. Duplicate labels,
blocks, work IDs, outcomes, or open eligible records are unknown/refused.

Every external fact is a versioned observation with request URL/GraphQL document,
API version, numeric repository/resource IDs, complete cursor/Link pagination,
ETag/updated time, response digest, capture start/end, and lifecycle use. The
initial GitHub API contract uses version `2022-11-28` and exact operations:

| Authority moment | Fresh observation / guarded mutation |
|---|---|
| frontier selection | GraphQL open-issues-by-label query through `pageInfo.hasNextPage=false`; re-read selected issue immediately before claim |
| workspace/base | REST repository + Git ref/default-branch commit/tree reads immediately before isolated workspace creation |
| branch publication | re-read expected base and target-ref absence, then Git ref create/push bound to worker-result tree under `code-host.branch-pr-write` |
| pull request | REST create, then read numeric PR/head/base/tree and materialize the identical worker-result digest |
| checks/certification | Actions workflow dispatch with `workId` and exact head SHA; enumerate workflow runs/jobs/check suites/check runs/artifacts to terminal pagination and verify attested artifact subjects |
| worker-result merge | re-read PR head/base, required checks, exact worker-result review, and branch protection; execute the probe-admitted merge method; read final default-branch commit/tree and prove tree equivalence under `code-host.merge` |
| release review/promotion | assemble/certify the final landed SHA; bind independent release review, candidate, installed predecessor, and fresh default-branch observation immediately before local promotion |
| work completion | close the exact issue only after installed-byte/promotion/next-tick receipt; failure leaves it open with a receipt link |

The first N0→N1 execution is an explicit later-cycle chain:

1. implementation cycle materializes `worker-result-subject/v1`, emits a review
   follow-up, reclaims resources, and performs no GitHub/source mutation;
2. distinct worker-result review cycle binds that target, and only its accepted
   authority permits branch/PR publication and the probe-admitted merge;
3. after fresh landed-SHA/tree observation, a release-assembly/certification
   cycle creates `release-candidate-subject/v1` from that exact landed revision
   and all three OS receipts, then emits a release-review follow-up with no
   promotion;
4. distinct release-candidate review cycle binds that target; only its accepted
   authority plus unchanged landed SHA/candidate/certification permits the
   stable N0 release owner to promote in steps 11–13;
5. a later verification cycle proves installed N1 and closes the work record.

Worker-result review cannot stand in for release-candidate review. No cycle
merges before step 2, promotes before step 4, or carries fresh authority across
a moved landed tree/candidate.

`ISS-036` may admit a merge method only if the resulting final SHA/tree and
protection response can be deterministically observed and rebound before
certification. Unsupported branch protection, merge queue, pagination, workflow
correlation, artifact attestation, or API permission is `BLOCK_REPLAN`; polling
latest runs, names, timestamps alone, or partial first pages is forbidden.
