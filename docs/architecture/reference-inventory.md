# Reference implementation inventory

The bootstrap source contains 112 tracked controller files:

- 75 PowerShell scripts
- 5 PowerShell modules
- 14 JSON contracts or fixtures
- 8 Markdown skill or contract documents
- 2 CommonJS files
- 2 YAML skill descriptors
- 1 shell script
- 1 Visual Basic launcher
- 4 other fixtures or text artifacts

There were 111 controller commits between 2026-07-15 and the bootstrap
inventory at commit `216887080f0570edbbac1c4e3a74a17add242ce3`.

The behavior families to characterize are:

- Session leasing and host freshness.
- Worker dispatch and process ownership.
- Worktree identity and reclamation.
- Exact-revision review receipts and landing authority.
- Event logging, flow snapshots, metrics, and learning ledgers.
- Circuit breakers and recovery.
- Planning, delivery, review, and repair contracts.
- Model capability routing and spend observations.
- Controller release assembly, independent review, promotion, and recovery.

This inventory is evidence for decomposition, not an instruction to preserve
the current file boundaries.
