# Live opening safety candidate — OFF, not production

This directory archives the approved task's narrow candidate code and synthetic tests. It does **not** replace the repository's root runtime or assert that the deployed OpeningNotifications path is fixed. The live server and this repository have different historical module layouts; no blind runtime overwrite or cross-task merge is performed.

The candidate keeps the exact hard-OFF server from the production-pinned safety base and replaces only `/app/opening-notifications.mjs`. It protects uncertain sends, durable pre-POST intent, restart/concurrency, write/readback failures, forged outcomes and dependent group releases. Private immutable outcome capabilities are bound to the exact invocation/request/recipient. `postIntentAt` is not evidence of a POST. New persisted `autoHold` receipts never auto-release changed-key notifications or group summaries; independent source/message readback is still required. Known valid legacy sent receipts without `autoHold` remain compatible. It now also fixes the Shanghai **[16:00,17:00)** sending window: numeric `sendHour === 16` is required, invalid/backward observed clocks permanently close this process instance, and post-IO final checks prevent slow calls from starting a POST after cutoff. Already invoked in-window POSTs may finish after cutoff; the next recipient cannot start. This is a conservative safety candidate, **not a fully usable 4.9.2 implementation**.

## Frozen provenance

- Actual source snapshot: Hub `c1e3c6b4…`, image `sha256:27e494a0094e0e34a932876ff91988ca608be9bc0688a56c76a511a8154086dc`.
- Original module SHA256: `8c1346a53ff70b6d49a0d5a7885645e77dd4914e62ddd3283f802eed36affd1a`.
- Frozen hard-OFF base: `sha256:e54e3e7cbdb8602c8b07129d53b7436fb2edcec91d33c0333c3182ec2825a6cc`.
- Hard-OFF server SHA256: `af21b94baa29c3f245c2ee892b4ff273347645798eb2f4c9500c4419518ee4cd`.
- Previous frozen no-retry module SHA256: `1d3ea7ab9f9d86ca7566030f577f57abc9f2e16d5507ffd3fc3700e1e8c8b381`, retained as `opening-notifications.no-retry.original.mjs`.
- Current fixed-window module SHA256: `320af5fda2726b2b5ec7d45185929f48dac9f6fbbbf597209b4b76327952a9e7`.
- Current candidate image: `sha256:82fbd47e409b498fd629122714351546fc690f911961a9e437627e592baa6543`, linux/amd64; exact base configuration and 32 base layers unchanged, one additional COPY layer (33 total).
- Actual unchanged WorkflowStore SHA256: `2e1637b0a8f5d0f486a6b0c9de9841b6cce7762e7dedf905338fd0a784546c68`.

The immutable base/image and complete original/patched server source are retained in the task's local/isolated release evidence, not reconstructed from this repository's root server. Never build a substitute from an unrelated root checkout or run a default service entrypoint for testing.

## Verification

Full Linux synthetic suite: **156/156**, independently rerun by the root agent with zero failures/skips. This retains 86 no-retry cases at valid 16:00/16:30 times and adds 70 explicit window/clock cases. Tests use the actual image's WorkflowStore, two separate Node child processes and synthetic fetch responses. The separate reviewer executed 76 extra memory cases plus 82 original memory cases; these are not native WorkflowStore subprocess evidence. Tests contain no user grants, formal volumes, message body exports or credentials. See `ROOT-REVIEW.md` and the independent `REVIEW.md` for exact evidence boundaries.

With the exact frozen base already available, build only this archived candidate; run QA with an explicit Node entrypoint, no network, a read-only root filesystem and only a QA fixture mount. The fixture mount at `/qa` contains `opening-no-retry.test.mjs`, `opening-window.test.mjs`, `opening-no-retry-worker.mjs`, `fixture-support.mjs`, `opening-notifications.original.mjs` and `opening-notifications.no-retry.original.mjs`. Execute `node --test /qa/opening-no-retry.test.mjs /qa/opening-window.test.mjs`; the image supplies `/app/workflow-store.mjs` and the patched module. The independent memory fixture can separately run via `node --test WINDOW-INDEPENDENT-REVIEW.test.mjs`. Do not run these Linux-path tests as part of unrelated Windows root tests or invoke a production tick.

Full original/patched source and offline evidence remain in the task-local package `opening-window-off-c1e3c6b4-752cad8f.tgz`, SHA256 `7c22e249858298dcea0bc2e04af7d2e35716d927d6e5601793d7e6697ea44279`. This archive omits root runtime replacement and does not contain formal message exports, credentials or state.

## Not authorized or delivered here

No production cutover, OAuth refresh, notification send/retry, task completion, source-table write or user impersonation occurred. Existing pending approval to temporarily close the actual reminder lane is not inferred from this archive or Git push. Production cutover still requires fresh CAS/source/identity verification, dormant same-volume RW isolation, fresh stopped-writer backup and isolated restore, latest-data-preserving rollback, genuine OA and old-link checks. The fixed sending window is only a necessary condition: signed permit/expiry, 15:55 first activation, start-instance readiness and independent autoHold release are **not implemented by this candidate**. Clock blocking is instance-local, not a signed cross-restart disk permit. Tests, an image, sent API results and Git delivery do not constitute production or real five-stage business acceptance.
