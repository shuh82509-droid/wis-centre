# 4.9.2 next-day reminder: read-only evidence collection

Status: **diagnostic code delivered; production NO-GO**. This directory neither enables a production reminder nor sends a message, signs a permit, modifies an official sheet, refreshes a user OAuth grant, or changes a container. Passing synthetic tests is not live acceptance.

## Components

- `readiness-core.mjs` evaluates an independently pinned policy and derives D+1 in Asia/Shanghai. It checks exact gateway and three-service topology, current incarnation, unique writers and all dormant same-volume RW holders, four-room source consistency, current tasks and owner cards, independent bot recipient proof, approved war-room test, unknown/in-flight notification ledger, fresh three-service stopped-writer backup/restore evidence and four genuine OA acceptance cases (module, old-action link, old-record link and personal scope). Activation and renewal have separate time gates. `safeToEnable` is always false in this diagnostic layer.
- `readiness-collector.mjs` orchestrates only read operations, with up to four in-flight reads. A caller-supplied JSON, transport or boolean cannot provide release authorization.
- `trusted-policy.mjs` reads separate policy, topology-pin and artifact-config files by raw-byte SHA-256, without symlink/alias substitution, and freezes the loaded input. Pins must come from an independent approved source; this code does not manufacture policy approval.
- `trusted-topology.mjs` reads the rootless Docker inventory, every declared data-mount holder, actual nginx configuration and independently fetched direct/gateway health bodies. Initial and final inventory/CAS checks bind IDs, images, mounts, start times, routes, the independently pinned listener and the Hub instance. It now additionally samples PID/start ticks, mount namespaces, mountinfo, source/target device and inode identities, and hidden RW parent/child mounts. Whole-round collection compares these identities, ignoring only their observation timestamps. These diagnostic samples do not prove continuous process/container identity or lifetime.
- `trusted-hub-reads.mjs` uses a fixed read-only script inside the pinned Hub container. It reads approved bindings and the ledger, verifies the exact parser/card module graph by byte hashes, parses the four approved tabs and derives sessions/cards without instantiating a store, starting a scheduler/notifier or performing writes. The verified transitive imports do include store/runtime module definitions.
- `trusted-bot-reads.mjs` permits a fixed set of application-identity reads only: actual bot identity, bound users, exact message, chat/P2P proof, fixed war-room detail/roster and the four official sheet tabs. Exact message reads use native `GET /open-apis/im/v1/messages/:message_id`, not the shortcut that automatically expands thread replies. For bot-info only, the documented CLI `--output` preserves the native top-level `bot` response in a private bounded temporary export; only `open_id` and `activate_status` are returned. Changed directory/file identity fails closed, including cleanup; it never intentionally follows a substituted export directory. Pathname guards are not atomic dirfd/openat race proof. The actual bot `open_id` must match the independently approved pin before any resource read.
- `trusted-artifacts.mjs` compares actual backup/archive/restored-tree bytes and pinned stop/restore reports for all three services; OA evidence requires independently produced authenticated DOM/export and screenshot bytes for all four acceptance cases (module, old-action, old-record and personal). It does not create a backup, restore data, export a browser session, or replace real visual acceptance.
- `trusted-child-process.mjs` bounds output and creates a detached private Linux process group. On cancellation/failure it kills only that owned group and waits for client closure plus kernel group absence, or reports bounded lifetime-unknown. A zero-exit leader with surviving group members cannot return success. This does not prove termination of session-escaping descendants or daemon-side remote Docker exec.
- `trusted-read-ops.mjs` composes the concrete diagnostic adapter. At the end it re-reads all four source tabs, bindings, full ledger and topology, rechecks the raw input pins and evaluates freshness against the finished clock. It has no signing or sending entry point.

## Live entry point and deliberate NO-GO boundary

The live entry point is Linux-only:

```js
const reader = await createTrustedReadOps({
  policyPath,
  pinnedPolicySha256,
  topologyPinPath,
  artifactConfigPath,
});
const result = await reader.collect({mode: "preview"});
```

The four inputs above are paths/digest, not approval switches. Do not supply a policy copied from evidence, self-approved fixtures, historical container IDs or fabricated artifact reports. The release-side adapter must run with an independently approved policy and real, current artifacts before its runtime can even be evaluated.

The listener is a separate exact contract, not a discovery fallback. `pin.gateway` requires `containerPort` and `serverName` in addition to its existing `loopbackPort` and identity/config pins. `policy.gatewayListener` and the returned `gateway.listener` must contain exactly `{containerPort, serverName, loopbackPort}`, with both integer ports in 1..65535 and the server name either `_` or a finite lowercase DNS name. DNS names additionally require pure WHATWG URL hostname normalization to preserve the exact input and remain non-IP; shortened/octal/hex IPv4 and ambiguous numeric final labels are conservatively refused. No URL is fetched by this validator. The policy and pin must independently agree; the adapter verifies the actual nginx `listen`/`server_name` and the single `127.0.0.1` published binding against them. Missing policy, wildcard/regex/IP server names, extra published TCP/UDP mappings, mismatched config or first/final listener drift fail closed. An explicit legacy 80/DNS contract is accepted only when independently pinned and exactly observed; the reader never tries 80 and then 8080. Health requests use the pinned DNS Host, or the existing formal Host `hub.fandow.com` for catch-all `_`. Whole-round comparison retains all three listener fields through the final re-read. No live pin or permission was created by this change.

Every adapter result unconditionally retains these three blockers:

1. `trusted_kernel_mount_identity_unproven`
2. `trusted_transport_lifetime_unproven`
3. `trusted_linux_cli_compatibility_unverified`

No policy value or caller `trusted*=true` field can remove them. The result stays `diagnosticOnly: true`, `checksPassed: false` and `safeToEnable: false`, including activation and renewal modes. The existing permit/signing safeguards in the Hub candidate remain separate; this adapter is not an accepted production evidence producer and must not be connected to a production permit writer.

A local read-only check with Windows lark-cli 1.0.80 returned an empty wrapped `data` object for native bot-info GET. Investigation of the official CLI source established that `SuccessEnvelopeData` discards fields outside `data`, while this endpoint returns top-level `bot`. A separate fixed GET with the documented `--output` read the actual bot identity and active status without new permissions or a user OAuth refresh. The strict adapter now reads that bounded native metadata export rather than substituting a configuration name. Native **Linux CLI** response compatibility remains unverified: the Linux fixture suite below does not launch a real Docker/Lark CLI or use credentials. No current user, card or sheet was read through this new adapter. The new `createTrustedReadOps/collect` entry point has not been run against production or on the Linux host.

## Verification completed on 2026-09-28

The initial diagnostic revision passed **169/169 on Windows**. The hardened revision has **225 tests**:

- Readiness core/collector: 37.
- Trusted topology: 100.
- Trusted backup/OA artifacts: 16.
- Trusted policy, bot/Hub composition, cancellation and final drift checks: 43.
- Bounded bot metadata export, identity checks and mutated-directory cleanup: 19.
- Private-group child transport: 10, including five actual Linux Node group cases.

The hardened Linux fixture suite passed **225/225 with no skips**, exit 0, in an isolated `--init` Linux/amd64 container using the already built image `sha256:9c4f3ba864bfdfee7c0faa281620d3d7a8bbc46875f1a924ab7fa2c501d5460d`. The test container had no network, credentials, formal data mounts or Docker socket; code was mounted read-only, scratch data stayed in `/tmp`, and PID/memory/CPU limits were applied. The fixture archive SHA-256 was `1a6d77cdb95d70c9dd8a26f5500dd79e200e6f3aa8951f30d94cd3d420f5b087`. This did not rebuild or deploy the Hub image. Windows also passes the fixture suite, with the five Linux-native cases skipped rather than mislabeled as native passes.

These tests use isolated fixtures and injected read transports, not real Feishu delivery, live Linux CLI compatibility or authenticated OA visual acceptance. Independent review found and fixed a cleanup hazard when an export directory was replaced by a symlink/junction; actual directory-substitution fixtures prove that outside files are left untouched. An otherwise passing full-gate fixture still remains NO-GO in preview, activation and renewal; altered bot arguments and a mismatched bot identity cannot perform resource reads.

The previously built exact-r65 Hub OFF candidate remains a **different artifact**, image `sha256:9c4f3ba864bfdfee7c0faa281620d3d7a8bbc46875f1a924ab7fa2c501d5460d`. Its prior isolated Linux suite passed 257/257, but it was not switched to production. This release-side diagnostic addition does not alter that image or make it live.

The later exact-listener revision initially passed 307 isolated Linux cases. Independent review then identified nonstandard IPv4 text passing the DNS label check; the final correction passed **316/316 on isolated Linux, no skips**, and **311 passed / 5 Linux-only skipped / 0 failed on Windows**. The five additional core/collector tests and 86 topology cases cover exact policy/pin binding, supported listener forms, malformed names/ports, numeric URL host canonicalization, extra published mappings, health Host and repeated-observation drift. The Linux run reused the same image only as a Node test runtime, with `--init`, no network/credentials/formal data/Docker socket, read-only code and bounded `/tmp`/PID/memory/CPU. Its distinct final fixture archive SHA-256 is `b537282034961f92d87182bd6b5a21ccdc0d9dff2d957a32e473c5ab1a661ba0`; the earlier 307-case archive is historical, not the final source. Neither run is a native Linux CLI verification or a production collection, cutover or business receipt.

## Historical production readback, not release authority

The 2026-09-28 09:11 Shanghai readback found the actual gateway routing to:

- Hub r65 `07868bcf7eea…`, image `sha256:6840992d…`.
- Calendar r60 `aad49b32eec8…`, image `sha256:ffd3f09d…`.
- Dispatch r57 `75f28f4e6120…`, image `sha256:9f2e8d18…`.

All three services were healthy with one running RW writer each. There were still **8 / 14 / 6 dormant same-volume RW containers** respectively. The gateway had no Docker healthcheck; actual nginx configuration, not a inferred healthy status, identified the formal routes.

The 09:18 read-only ledger aggregation found **170 workflow04 tasks, 0 human-completed nodes, 0 completed workflow04 tasks, 32 receipt records and 0 next-day reminder rows**. Global historical unknown sends remained 7 and were not resent. A ledger receipt or `sent` row is not proof of a complete five-stage real-business path. Next-day group reminders, Calendar recruitment reminders/scheduler and Dispatch total-sheet import remained OFF. This snapshot is not reusable evidence for a later collection.

The 10:32 read-only ledger aggregation again found 170 workflow04 tasks, zero human-completed nodes/tasks, 32 receipt records and zero next-day rows; global historical unknown sends remained seven. The 10:54–10:55 topology readback found unchanged formal service IDs/images/start times, healthy services and one running RW writer each; 8/14/6 dormant same-volume RW holders remain. Actual nginx configuration retained SHA-256 `f4acb4c571bf00ca542ad26fd4edeffdd935e26de9a0dc2bdda969c94d771bcd`, `listen 8080`, `server_name _` and published route `127.0.0.1:19144 -> 8080/tcp`. At that time the diagnostic reader hardcoded `listen 80`, `server_name hub.fandow.com` and container `80/tcp`. That historical mismatch was a conservative diagnostic NO-GO, not evidence of a production outage. The later exact-listener correction above still requires independent pins; it does not adopt observations as approval or silently accept an 80/8080 fallback. The native formal-host collection remains unaccepted. Hub next-day reminders, Calendar scheduler/recruitment/leader reminders and Dispatch total import were OFF in that snapshot; no switches changed here.

The 11:25–11:35 read-only round observed **two Calendar incarnation changes**, so every old Calendar CAS/candidate is invalid for a later switch. At 11:34 the actual gateway alias resolved to Calendar `a57eb2b2d759eb7b9cd14ad0d685d19e8bc30d20e7d52d91161ca4063d789b33`, image `sha256:1de7c1147345a2f0ff257cf361a3f1c397d884afbbbc4e032db079c504a86a17`, started `2026-09-28T03:32:08.983780443Z`; Hub/Dispatch remained unchanged and all three were healthy with one running RW writer each. Dormant same-volume RW holders had increased to **8 / 18 / 6**, including four restartable Calendar holders, and were not isolated. The bounded ledger aggregation found 170 workflow04 tasks across four rooms (35/55/48/32), zero human-completed nodes/tasks or business-completion receipts, 32 `live_ack` records, 1,281 live-notice rows (1,275 `sent`) and zero next-day rows. Global historical `unknown:true` remained seven; current live unknowns, global in-flight and duplicate task/notification keys were zero. Internal `sent` rows were not independently fetched or treated as personal acknowledgement. Calendar grant usability remains **unknown**, not an inferred zero or success; no refresh or encrypted payload read was attempted. Only the known historical backup directory was checked, without a fresh stopped backup or restore. This snapshot is not release authority and no production action was taken here.

Computer Use listed existing Edge windows but refused the authenticated-page capture because the current browser URL could not be established confidently for policy enforcement. No further UI input or authentication automation was performed. No anonymous response or window title was substituted for genuine OA page/old-link acceptance.

## Remaining release and business gates

- Prove the three adapter runtime gaps above on the actual Linux execution host without bypassing browser or OAuth boundaries.
- Obtain independently approved current pins, actual identity/source/message proofs, the authorized single war-room test readback and genuine OA/old-link artifacts. No group test is sent by this code.
- Reconcile affected room/person blocks without guessing names or creating duplicate sessions; retain unread/permission-denied recipient proof as unknown.
- Before any cutover, recheck the current baseline, isolate every old same-volume RW holder, take complete fresh stopped-writer backups for all three services, verify isolated recovery and a rollback that preserves the latest business data.
- Only enable date-specific notifications in the approved valid time window after every gate passes. Unknown results and missed deadlines are not a reason to resend or backfill.
- Four coaches must authorize their own calendars before real review counts; source-table and cross-room personal-rest rules must be confirmed before affected writes/imports.
- All five stages must be performed by the real responsible person, anchor and assistant, then checked room by room against their actual node evidence and per-node notification receipts. No test card, successful API or clickable page substitutes for this.

Old scripts in `release-r61-nextday-20260925` pin retired containers and historical data. Do not run them against current production.

Git delivery, isolated candidate verification, production cutover and real business acceptance are reported separately. No production service, user data, official sheet, permission or message was changed by this diagnostic work.

## Primary API contracts

- [Get bot information](https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info)
- [Get a single message](https://open.feishu.cn/document/server-docs/im-v1/message/get)
- [Get a user](https://open.feishu.cn/document/server-docs/contact-v3/user/get)
- [CLI 1.0.80 success-envelope implementation](https://github.com/larksuite/cli/blob/v1.0.80/internal/output/envelope_success.go)
- [CLI 1.0.80 native response export](https://github.com/larksuite/cli/blob/v1.0.80/internal/client/response.go)
