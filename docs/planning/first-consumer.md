# First consumer selection and authority timing

## Selection

The first consumer is the operator-selected incumbent-controller repository.
Its concrete repository identity is supplied only in the private deployment
configuration; product vocabulary and delivery policy remain in its adapter and
may not enter platform packages, public fixtures, or roadmap issue text.

The incumbent controller reference is the read-only container snapshot at
commit `216887080f0570edbbac1c4e3a74a17add242ce3`. Access is an explicit operator
prerequisite for inventory and fixture capture. Public fixtures must be
sanitized and independently approved before commit.

## Shadow window

Shadow mode runs for at least seven consecutive UTC days and at least 100
comparable authoritative decisions, whichever completes later. Every incumbent
cycle must correlate to a shadow cycle or an explicit unavailable result.
Cutover requires:

- zero unexplained authoritative differences;
- no more than 1% unavailable correlations, with none on a mutation decision;
- shadow observation adding less than 5% to incumbent p50 cycle duration and
  less than 10% to p95;
- current release, adapter, credential-census, and authority-health receipts.

After authority transfer, the incumbent remains active only as a read-only
comparator for the seven-day/100-decision post-cutover window. It receives no
mutation credentials, cannot renew the former controller lease, and correlates
its observations to the successor using the same decision-opportunity identity
used during shadow mode. Its output is evidence only and cannot veto or perform
successor mutations. At the end of the window, its credentials and process are
removed after the terminal report is durable.

## Authority-timing matrix

| Fact | Applicable phase | Lifecycle moment | Authority surface | Required evidence | Unavailable disposition |
|---|---|---|---|---|---|
| Work candidate and dependency state | shadow, pre-cutover, successor routine, post-cutover comparator | immediately before selection | GitHub Issues REST/GraphQL IDs, state, type, labels, milestone, dependencies | timestamped normalized response plus pagination proof | cycle incomparable in shadow; successor selection refused |
| Workspace eligibility and subject identity | shadow dispatch simulation, successor routine | immediately before ownership publication | local Git worktree/common-dir/status/head plus adapter policy | sanitized normalized receipt and exact command outcomes | dispatch refused |
| Worker process identity | successor routine only | immediately after native child creation and at terminal observation | local OS process APIs through platform runtime | launch/process-tree receipt | capacity unknown; not required by cutover preflight |
| Pull request revision and review state | shadow, pre-cutover open-work census, successor routine, post-cutover comparator | immediately before review request and promotion evaluation | GitHub pull request head and review/check APIs | exact revision, pagination, and response provenance | review/promotion refused |
| Merge-queue eligibility and checks | shadow simulation, pre-cutover queue census, successor routine, post-cutover comparator | immediately before enqueue mutation | GitHub rules/checks/queue APIs | dry-run mutation plan plus fresh observations | enqueue refused |
| Deployment execution and deployed revision | shadow historical correlation, successor routine, post-cutover comparator | after landing when the actual deployment job terminates | GitHub Actions jobs plus deployed revision probe | executed-job identity, conclusion, and deployed digest | further enqueue refused; not required before first successor mutation |
| Installed controller and lease authority | every phase, including post-cutover comparator | session start and immediately before cutover | local installed manifest and lease contracts | exact byte hashes and health receipt | controller/cutover refused |

Cutover preflight requires only rows marked pre-cutover plus current platform,
adapter, credential-census, quiescence, and single-writer receipts. Post-hoc API
reads do not substitute for applicable live observations. Fixtures record
known-empty and unavailable responses as first-class negative cases.

Comparator retirement follows the `Incumbent comparator retirement` state
machine. Its terminal report, credential revocation census, exact process-tree
exit, and the successor's next routine receipt are all required; elapsed time
alone never proves retirement.
