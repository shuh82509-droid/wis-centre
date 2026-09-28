# Live opening safety candidate — OFF, not production

This directory archives the approved task's narrow candidate code and synthetic tests. It does **not** replace the repository's root runtime or assert that the deployed OpeningNotifications path is fixed. The live server and this repository have different historical module layouts; no blind runtime overwrite or cross-task merge is performed.

The candidate keeps the exact hard-OFF server from the production-pinned safety base and replaces only `/app/opening-notifications.mjs`. It protects uncertain sends, durable pre-POST intent, restart/concurrency, write/readback failures, forged outcomes and dependent group releases. Private immutable outcome capabilities are bound to the exact invocation/request/recipient. `postIntentAt` is not evidence of a POST. New persisted `autoHold` receipts never auto-release changed-key notifications or group summaries; independent source/message readback is still required. Known valid legacy sent receipts without `autoHold` remain compatible. This is a conservative safety candidate, **not a fully usable 4.9.2 implementation**.

## Frozen provenance

- Actual source snapshot: Hub `c1e3c6b4…`, image `sha256:27e494a0094e0e34a932876ff91988ca608be9bc0688a56c76a511a8154086dc`.
- Original module SHA256: `8c1346a53ff70b6d49a0d5a7885645e77dd4914e62ddd3283f802eed36affd1a`.
- Frozen hard-OFF base: `sha256:e54e3e7cbdb8602c8b07129d53b7436fb2edcec91d33c0333c3182ec2825a6cc`.
- Hard-OFF server SHA256: `af21b94baa29c3f245c2ee892b4ff273347645798eb2f4c9500c4419518ee4cd`.
- Candidate module SHA256: `1d3ea7ab9f9d86ca7566030f577f57abc9f2e16d5507ffd3fc3700e1e8c8b381`.
- Candidate image: `sha256:880e57976f2fa828e4813493c61041e76df8061f1d08aa6cc9aa595aef2d2ecb`, linux/amd64; exact base configuration and 32 base layers unchanged, one additional COPY layer.
- Actual unchanged WorkflowStore SHA256: `2e1637b0a8f5d0f486a6b0c9de9841b6cce7762e7dedf905338fd0a784546c68`.

The immutable base/image and complete original/patched server source are retained in the task's local/isolated release evidence, not reconstructed from this repository's root server. Never build a substitute from an unrelated root checkout or run a default service entrypoint for testing.

## Verification

Full Linux synthetic suite: **86/86**, independently rerun by the root agent with zero failures/skips. Tests use the actual image's WorkflowStore, two separate Node child processes and synthetic fetch responses. They contain no user grants, formal volumes, message body exports or credentials. See `ROOT-REVIEW.md` and the independent `REVIEW.md` for evidence boundaries.

With the exact frozen base already available, build only this archived candidate; run QA with an explicit Node entrypoint, no network, a read-only root filesystem and only a QA fixture mount. The fixture mount contains `opening-no-retry.test.mjs`, `opening-no-retry-worker.mjs`, `fixture-support.mjs` and `opening-notifications.original.mjs`. The image supplies `/app/workflow-store.mjs` and the patched module. Do not run these Linux-path tests as part of unrelated Windows root tests or invoke a production tick.

## Not authorized or delivered here

No production cutover, OAuth refresh, notification send/retry, task completion, source-table write or user impersonation occurred. Existing pending approval to temporarily close the actual reminder lane is not inferred from this archive or Git push. Production cutover still requires fresh CAS/source/identity verification, dormant same-volume RW isolation, fresh stopped-writer backup and isolated restore, latest-data-preserving rollback, genuine OA and old-link checks. Signed/time-window/start-instance gates and independent autoHold release are **not implemented by this candidate**. Tests, an image, sent API results and Git delivery do not constitute production or real five-stage business acceptance.
