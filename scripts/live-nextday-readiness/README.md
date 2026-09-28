# 4.9.2 next-day reminder: read-only evidence collection

Status: **diagnostic code delivered; production NO-GO**. This directory neither enables a production reminder nor sends a message, signs a permit, modifies an official sheet, refreshes a user OAuth grant, or changes a container. Passing synthetic tests is not live acceptance.

## Components

- `readiness-core.mjs` evaluates an independently pinned policy and derives D+1 in Asia/Shanghai. It checks exact gateway and three-service topology, current incarnation, unique writers and all dormant same-volume RW holders, four-room source consistency, current tasks and owner cards, independent bot recipient proof, approved war-room test, unknown/in-flight notification ledger, fresh three-service stopped-writer backup/restore evidence and four genuine OA acceptance cases (module, old-action link, old-record link and personal scope). Activation and renewal have separate time gates. `safeToEnable` is always false in this diagnostic layer.
- `readiness-collector.mjs` orchestrates only read operations, with up to four in-flight reads. A caller-supplied JSON, transport or boolean cannot provide release authorization.
- `trusted-policy.mjs` reads separate policy, topology-pin and artifact-config files by raw-byte SHA-256, without symlink/alias substitution, and freezes the loaded input. Pins must come from an independent approved source; this code does not manufacture policy approval.
- `trusted-topology.mjs` reads the rootless Docker inventory, every declared data-mount holder, actual nginx configuration and independently fetched direct/gateway health bodies. Initial and final inventory/CAS checks bind IDs, images, mounts, start times, routes and the Hub instance. These checks are conservative; they do not yet prove Linux kernel mount identity.
- `trusted-hub-reads.mjs` uses a fixed read-only script inside the pinned Hub container. It reads approved bindings and the ledger, verifies the exact parser/card module graph by byte hashes, parses the four approved tabs and derives sessions/cards without instantiating a store, starting a scheduler/notifier or performing writes. The verified transitive imports do include store/runtime module definitions.
- `trusted-bot-reads.mjs` permits a fixed set of application-identity reads only: actual bot identity, bound users, exact message, chat/P2P proof, fixed war-room detail/roster and the four official sheet tabs. Exact message reads use native `GET /open-apis/im/v1/messages/:message_id`, not the shortcut that automatically expands thread replies. The actual bot `open_id` must match the independently approved pin before any resource read.
- `trusted-artifacts.mjs` compares actual backup/archive/restored-tree bytes and pinned stop/restore reports for all three services; OA evidence requires independently produced authenticated DOM/export and screenshot bytes for all four acceptance cases (module, old-action, old-record and personal). It does not create a backup, restore data, export a browser session, or replace real visual acceptance.
- `trusted-child-process.mjs` bounds output and waits for the killed client process to close after cancellation. Client closure is not yet proof that a remote Docker exec or a native CLI descendant has terminated.
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

Every adapter result unconditionally retains these three blockers:

1. `trusted_kernel_mount_identity_unproven`
2. `trusted_transport_lifetime_unproven`
3. `trusted_linux_cli_compatibility_unverified`

No policy value or caller `trusted*=true` field can remove them. The result stays `diagnosticOnly: true`, `checksPassed: false` and `safeToEnable: false`, including activation and renewal modes. The existing permit/signing safeguards in the Hub candidate remain separate; this adapter is not an accepted production evidence producer and must not be connected to a production permit writer.

A local read-only check with Windows lark-cli 1.0.80 returned an empty `data` object for native bot-info GET. That does **not** prove the bot is disabled or establish its actual identity. The strict adapter rejects such a response rather than using a profile/configuration name as proof. Native Linux CLI response compatibility remains unverified. No current user, card or sheet was read through this new adapter. The new `createTrustedReadOps/collect` entry point has not been run against production or on the Linux host.

## Verification completed on 2026-09-28

`node --test scripts/live-nextday-readiness/*.test.mjs` passed **169/169 on Windows**:

- Existing readiness core/collector: 35.
- Trusted topology: 75.
- Trusted backup/OA artifacts: 16.
- Trusted policy, bot/Hub composition, cancellation and final drift checks: 43.

These tests use isolated fixtures and injected read transports, not real Feishu delivery, live Linux CLI compatibility or authenticated OA visual acceptance. Independent review verified that an otherwise passing full-gate fixture still remains NO-GO in preview, activation and renewal; altered bot arguments and a mismatched bot identity cannot perform resource reads.

The previously built exact-r65 Hub OFF candidate remains a **different artifact**, image `sha256:9c4f3ba864bfdfee7c0faa281620d3d7a8bbc46875f1a924ab7fa2c501d5460d`. Its prior isolated Linux suite passed 257/257, but it was not switched to production. This release-side diagnostic addition does not alter that image or make it live.

## Historical production readback, not release authority

The 2026-09-28 09:11 Shanghai readback found the actual gateway routing to:

- Hub r65 `07868bcf7eea…`, image `sha256:6840992d…`.
- Calendar r60 `aad49b32eec8…`, image `sha256:ffd3f09d…`.
- Dispatch r57 `75f28f4e6120…`, image `sha256:9f2e8d18…`.

All three services were healthy with one running RW writer each. There were still **8 / 14 / 6 dormant same-volume RW containers** respectively. The gateway had no Docker healthcheck; actual nginx configuration, not a inferred healthy status, identified the formal routes.

The 09:18 read-only ledger aggregation found **170 workflow04 tasks, 0 human-completed nodes, 0 completed workflow04 tasks, 32 receipt records and 0 next-day reminder rows**. Global historical unknown sends remained 7 and were not resent. A ledger receipt or `sent` row is not proof of a complete five-stage real-business path. Next-day group reminders, Calendar recruitment reminders/scheduler and Dispatch total-sheet import remained OFF. This snapshot is not reusable evidence for a later collection.

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
