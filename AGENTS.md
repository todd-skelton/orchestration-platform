# Repository instructions

Build a portable orchestration platform rather than a project-specific
controller.

- Support macOS, Windows, and Linux as equal targets.
- Keep the engine independent from repository policy through explicit adapters.
- Treat schemas, state transitions, receipts, and mutation authority as public
  contracts with executable compatibility tests.
- A worker or candidate release never certifies itself.
- Stable release N may build and test N+1; only external review and the stable
  promotion path may grant N+1 authority.
- Prefer incremental behavioral extraction over a file-for-file port or
  big-bang rewrite.
- Keep runtime state outside the source checkout.
- Make unknown or malformed authority fail closed while keeping advisory
  telemetry non-blocking.
- Every issue must state scope, non-goals, acceptance evidence, verification,
  predicted footprint, and review attack surface.
