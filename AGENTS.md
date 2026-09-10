# Repository instructions

Read `docs/loop.md` first. It is the only process document.

- Keep the loop small. Add a mechanism only when a real cycle recorded the
  blocker it removes; say which issue recorded it.
- Run `pnpm typecheck`, `pnpm format:check`, `pnpm planning:check` and
  `pnpm test` before handing off.
- Never push, publish, merge, or edit the running loop from a worker.
- Runtime state stays outside the checkout.
- Prefer deleting over guarding. A check that defends against a threat the
  design excludes is a finding, not a safeguard.
