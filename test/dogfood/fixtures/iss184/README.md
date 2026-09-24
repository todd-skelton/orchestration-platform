# ISS-184 recorded Actions evidence

Trimmed from the byte-exact `iss184-evidence-r2` offline host capture. No network
was used. Run/job JSON retains the fields consumed by the adapter, all job
identities and scope/image steps. Log excerpts retain original LF bytes and
timestamps for the listed ranges. Negative mutations in tests are synthetic.
No deploy=true resolver log was captured.
The fixture directory pins log checkout to LF, preserving the captured bytes on Windows too.
Each log also retains original line 1, including the provider BOM. Staging logs
retain unrelated unprefixed output at original lines 6067 and 7663–7666 (previous)
and 6130 and 7765–7768 (latest); those lines belong to other steps.

Captured at 2026-09-24T08:48:14.137Z. The latest staging evidence was originally
observed at 2026-09-24T04:08:17.6875919Z; its image verification ran on September
23 at 22:33Z. These are historical workflow facts, not fresh provider health.
Run 35146653520 is the previous staging deployment before the no-deploy run;
run 35928467557 is the latest captured deployment, not a permanent latest claim.

Original capture manifest SHA-256 hashes and excerpt ranges:

- `CAPTURED_AT.txt`: `a2d2219d813227c51ad081213d498ee1b63fc5f5ba27d27933fe42732bedd37e`
- `CAPTURE_NOTE.txt`: `620e0679e9ae7a7e08c75a6cf8978155a83b3392729cc48110bd9573c9fa3ca8`
- `job-104965862128-deploy-staging.log`: `c27388a26a4c819f7068567ebb6bcb8ec6b9ba41963023bdb024d78aa8e5f254`
- `job-105308935683-resolve-release.log`: `4bc18b3745c13c091b59c2010f18786bca81c54377f96b553c617cd6fc7e4835`
- `job-107410573331-deploy-staging.log`: `f15626d10c577abfda5eceea0093675048874667f2fe5bec5cdbad75dc8f112f`
- `run-35146653520-attempt-1-jobs.json`: `d2510d9576f5a3068fca65f20046b2f9d5e7a30013c9231e2fac355c7d163fc1`
- `run-35146653520.json`: `1c337f92f18f32b0228607992cf1ef2da74bc0af9bd4aedc30b4b71158a80a2c`
- `run-35252785218-attempt-1-jobs.json`: `13ab4b6f3f411d9c260bb37097647fcebbb4f74f27425176b1c4144c506441f2`
- `run-35252785218.json`: `e8e44979cf4cab064bfe4817ebf7f4b15e85dea947cadedcc7488d0cac36f96d`
- `run-35928467557-attempt-1-jobs.json`: `8dfb04ac93c19502ddef03f834d4999987bced5d2d2826c87e62ccce2f329a77`
- `run-35928467557.json`: `120712ca3cbc170769aff5ec3a96def6fc464b97f16f1b23099f12b507e5a8aa`
- `job-105308935683-resolve-release.log` excerpt: original lines 1814–1821, 1826–1855; command, output and next group boundary retained; shell/environment omitted.
- `job-104965862128-deploy-staging.log` excerpt: original lines 3503–3520, 3589–3592; command, output and next group boundary retained; shell/environment omitted.
- `job-107410573331-deploy-staging.log` excerpt: original lines 3560–3577, 3646–3649; command, output and next group boundary retained; shell/environment omitted.
