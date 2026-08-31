# Glossary

- **Adapter policy**: Consumer-owned rules that interpret project facts and
  decide readiness, priority, or operational meaning.
- **Authority**: Evidence that permits a specific mutation or state transition.
- **Authority event**: A strict journal event that may participate in a mutation
  decision.
- **Authority transfer**: The single transition granting mutation authority to
  a successor after removing it from the predecessor.
- **Attestation**: Cryptographically verifiable statement binding a subject
  digest to an authenticated issuer, workflow, predicate, and provenance.
- **Bootstrap release**: First independently authorized platform release whose
  trust derives from pinned workflow/test bytes, distinct review, operator
  grant, and installed-byte verification rather than a stable predecessor.
- **Circuit breaker**: Platform-owned authority lifecycle that holds an opaque
  capability while adapter-supplied trip or recovery policy facts require it.
- **Candidate manifest**: Immutable inventory and hashes for a proposed release.
- **Capability refusal**: A named result stating that the current environment
  cannot prove a required property.
- **Capture provenance**: Exact source, lifecycle time, schema, and digest that
  make a recorded external observation reproducible.
- **Compare-and-swap**: Mutation admitted only when the observed predecessor
  identity still matches immediately before replacement.
- **Configuration provenance**: The flag, environment, project file, or default
  that supplied one resolved configuration value.
- **Credential broker**: Platform service that resolves a non-secret credential
  reference through an admitted native backend for one bounded role/capability
  use without serializing the secret.
- **Credential reference**: Non-secret, generation-bound identity of a native
  credential item, owning user, role, and admitted capabilities.
- **Credential capability**: Named external authority a role may request from a
  credential reference; absence or excess always refuses access.
- **Conformance receipt**: Versioned evidence that an implementation satisfies a
  declared contract on a named environment.
- **Cutover**: Bounded transfer of mutation authority from an incumbent
  controller to a reviewed successor.
- **Correlation identity**: Durable key joining an incumbent cycle and its
  shadow observation of the same decision opportunity.
- **Dispatch brief**: Complete bounded work description for a fresh worker.
- **Discrepancy**: Correlated incumbent/shadow result whose authority meaning has
  not yet reached a terminal explanation.
- **Discovery intake**: Advisory record reduced from measured delivery telemetry
  that proposes candidate platform work for operator disposition; evidence,
  never authority.
- **Exact revision**: Immutable source identity examined by a worker or reviewer.
- **Exact model identity**: Provider-authenticated immutable snapshot/version
  reported for one attempt, distinct from a requested selector or alias.
- **Finding class**: Named, recurring category of independent-review finding
  whose structural form can be recognized across review rounds.
- **Frontier snapshot**: Adapter-produced, provenance-bound set of work facts
  available at one observation point.
- **Host custody**: Enrolled binding of canonical host, current user, state root,
  installed collector, and native evidence-signing key used to authenticate
  lifecycle evidence across reboot.
- **Journal**: Append-only durable sequence of controller observations and
  outcomes.
- **Launch identity**: Globally unique identity for one worker-process lifecycle.
- **Module**: Versioned portable workflow and evidence standard that consumes
  engine contracts and adapter facts.
- **Mechanism**: Platform-owned behavior independent from a consumer's delivery
  policy.
- **Mutation plan**: Inspectable, bounded, idempotent description of intended
  external changes.
- **Model routing**: Evidence-backed selection of an exact worker-host model,
  effort, and placement for a declared capability.
- **Observation**: Read-only fact with provenance and lifecycle timing.
- **Parity fixture**: Sanitized input and expected authoritative result used to
  compare a new implementation with an incumbent without importing its policy
  into the engine.
- **Project adapter**: Versioned implementation translating consumer facts and
  policies into platform contracts.
- **Project root**: Source checkout selected for one project configuration.
- **Owned resource**: Opaque adapter or host workspace/temporary identity bound
  to one dispatch and retained until exact process exit and verified reclaim.
- **Promotion**: Reviewed transaction that verifies and grants active authority
  to an immutable installed release.
- **Receipt**: Versioned immutable evidence bound to an exact subject and
  attempt.
- **Reducer**: Deterministic function deriving current state from durable input.
- **Recovery**: Authorized continuation from an interrupted known transaction.
- **Re-entry receipt**: Host-custody-signed evidence that the installed native
  scheduler, not a manual process, invoked the expected release in the next
  eligible user session after a changed boot identity.
- **Revocation generation**: Monotonic credential-reference generation advanced
  before future access so an older grant cannot be replayed.
- **Review packet**: Evidence and attack surface supplied to an independent
  reviewer for one exact subject.
- **Routine cycle**: One journaled, restartable engine composition from fresh
  adapter facts through a terminal action, refusal, or no-work receipt.
- **Session**: Bounded interval in which one controller identity owns runtime
  authority.
- **Shadow mode**: Read-only execution compared against an incumbent authority.
- **Self-hosting**: A stable released platform orchestrating implementation,
  review, and promotion of its successor.
- **State root**: Installation-specific durable storage outside the source
  checkout.
- **State import**: Provenance-bound, idempotent transaction mapping a quiescent
  incumbent export into verified successor records before authority transfer.
- **Stable predecessor**: Released controller version authorized to build and
  promote its successor.
- **Supervisor tick**: One scheduler-authenticated invocation that starts or
  resumes at most one routine cycle and records terminal re-entry evidence.
- **Steady state**: Named routine state and behavior after a transition has
  completed.
- **Transition**: Contract-defined movement between named states.
- **Worker host**: Integration that launches and observes a concrete agent
  runtime while enforcing identity and role capabilities.
- **Worker result subject**: Canonical immutable base revision plus resulting
  tree, ordered patch or artifact digest materialized once from a terminal worker
  attempt and carried unchanged through review and mutation.
- **Worker ownership**: Durable binding between one session, launch, role,
  workspace subject, and live process lifecycle.
- **Unknown authority**: Explicit inability to establish permission; never
  equivalent to success or vacancy.
