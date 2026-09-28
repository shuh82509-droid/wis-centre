# Independent window and no-retry safety review

2026-09-28, same-task independent reviewer `sender_final_gate_review`.

## Decision and scope

No new P1/P2 defect was found in the narrow reviewed change. Fixed Shanghai **[16:00, 17:00)**, strict numeric `sendHour === 16`, sticky same-process invalid/backward-clock stop, and final post-IO synchronous clock checks pass the independent synthetic checks below. The existing no-retry / per-scope autoHold / private immutable sender-capability protocol did not regress in the reviewed memory cases.

**This is an offline, hard-OFF safety candidate, not permission to enable reminders and not production acceptance.** Signed permit, verified source/identity/start-instance and hold-release mechanisms are not implemented by this narrow patch. No production state, real message, personal acknowledgment, or five-stage business completion was created or claimed by this reviewer.

## Reviewed bytes

| File | SHA256 |
| --- | --- |
| opening-notifications.mjs | `320af5fda2726b2b5ec7d45185929f48dac9f6fbbbf597209b4b76327952a9e7` |
| opening-window.test.mjs | `620d3753a7273616e40e3d24271db5b813c6cced42e94ef4bb79a8a6b2507781` |
| opening-no-retry.test.mjs | `c87cbefcfa6f20fdd1fca8a25ca46e71228cfb7005e8d0125db18f77c5554d53` |
| server.mjs | `af21b94baa29c3f245c2ee892b4ff273347645798eb2f4c9500c4419518ee4cd` |
| opening-notifications.no-retry.original.mjs | `1d3ea7ab9f9d86ca7566030f577f57abc9f2e16d5507ffd3fc3700e1e8c8b381` |

The original frozen no-retry sibling's runtime and server were independently hashed again and still match the last two applicable hashes above. This reviewer edited neither frozen sibling nor implementation/server files. The Dockerfile copies only the reviewed opening module into exact base `sha256:e54e3e7cbdb8602c8b07129d53b7436fb2edcec91d33c0333c3182ec2825a6cc`. Local server lines 3112–3113 retain the literal `Hard OFF` / `enabled:false`; that source check is not a runtime deployment claim.

## Static contract checks

- Runtime lines 76–86: only safe-integer milliseconds within the Date margin are accepted; any invalid/throwing/observed backward clock permanently latches `clockBlocked` for this instance. The window cannot move or widen through 0, 17, string `16`, fractional or NaN configuration. This is an instance-local stop, **not a disk-persisted global clock permit across restart**.
- Lines 88–91: the reviewed `plan()` samples validated time before the fresh schedule await and again after it. Lines 102–111 validate entry, throttle, due date, and each message before reserving or sending; earlier-than-nextAt rollback is checked before the throttle can hide it.
- Lines 119, 131–143 validate window/date after reservation, refreshed source and token-related source checks, and inside intent mutation. A durable risk marker does not assert that the transport has been invoked.
- Lines 149–157: all journal readback and full-row ownership/scope scans finish **before** the last `checkedClock()`. Hash/binding recomputation also precedes that clock. Source age must be at most 1000ms, the next-day date must match, and the fixed window must still hold.
- Sender lines 191–200: tenant token, stillValid, durable intent and final readback complete before the final synchronous function. Request/timeout construction precedes it. After its successful return there is no await, transaction or source/readback operation before `notifier.fetch()`; a queued microtask from final readback cannot execute between final guard and actual invocation.
- Lines 36–64 and 162–176: immutable private WeakMap evidence remains invocation/request/UUID/key/recipient-bound. Copied/mutated/replayed/fabricated sent or not-posted results cannot satisfy it. Actual pre-POST failures are recorded as known no-POST, not fake successful sends or actual-POST unknowns.
- Lines 45–54, 116–122, 145 and 170: a held date/room/kind/recipient cannot use a changed body/key to retry. Legacy missing role/roomCode is handled conservatively without guessed identities. Old known sent receipts without autoHold remain compatible; new autoHold sent receipts cannot release groups (lines 38–39, 118).
- Line 171: if the clock becomes invalid after a synthetic successful transport response, result commit stops; the durable intent remains held rather than inventing a valid sent timestamp. No automatic retry or new group release follows.

## Independent executed evidence

All execution was local Node with fictional identities, fake notifier transport and in-memory state. No external URL was contacted. The reviewed source bytes are imported through data URLs without modifying the runtime. The real scheduling dependency is explicitly substituted; these are safety tests, not proof of real table/person/calendar access or message delivery.

1. `WINDOW-INDEPENDENT-REVIEW.test.mjs`: **76/76 passed, 0 failed, 0 skipped**, executed with `H:\node.exe --test` against the pinned runtime SHA above.

   - 44 tests inject NaN, Infinity, negative Infinity and out-of-Date-range time at token, source reads 1–4, status/prepared/intent commit, and prepared/intent/final readback. Every pre-POST injection gives zero POST, no messageId, no `postAttempted:true`, no fake actual-POST `unknown:true`, then remains inert after a valid 16:02 time is restored to the same instance.
   - 16 additional tests exercise the **unmodified `plan()` itself** around its four fresh source awaits using a fictional-slot scheduler surrogate. An independent stable positive confirms this route reaches one fake POST, so the failure cases are not passing because the route is inert.
   - Four POST-return invalid-clock cases preserve `sending` intent, `postAttempted:null`, no sent/messageId evidence and autoHold; same-instance recovery and in-window changed-key restart cannot POST again.
   - Four 16:00 → 16:02 restart cases independently prove unknown transport, result-before-commit failure, result-after-commit failure and new held successful result cannot retry through a changed key. This does **not** rely on the 17:00 cutoff hiding regressions.
   - Four legacy prepared/sending/uncertain/unknown cases at 16:02 freeze only the affected scope; an unrelated room still gets its own single fake POST.
   - Intent-readback queued invalid time runs before the sender's resumed final check, so POST stays zero. Final-readback queued invalid time cannot run until after synchronous fetch invocation; its later result commit is held, not mis-proven sent.

2. Independently reran the existing `opening-no-retry.test.mjs` **pure-memory portion: 82/82 passed, 0 failed, 0 skipped**. The test data-URL transformation removed the `/app/workflow-store.mjs` import and ended before `function startWorker`; no native WorkflowStore subprocess cases were run by this reviewer. The runtime remained unchanged. This covers old scope holds, durable-marker failures, concurrency, final readback delay, private immutable result evidence, copied/replayed capabilities and group dependency failures, now at valid 16:00 and 16:30 fixture times.

Existing window tests were statically read, including exact endpoint rejection, slow token/source/persist/readback crossing 17, rollback phases, configuration rejection, midnight and changed recipient/hash. Native Linux image tests and actual WorkflowStore cross-process/crash evidence are the implementation agent/root's separate execution responsibility; this report does not claim their results before inspecting a completed log.

## Remaining release and business boundary

The original no-retry candidate's conservatism is intentional: even newly confirmed sent autoHold receipts cannot release later group summaries or new-key sends until an independently reviewed readback/release protocol exists. The current source has no signed permit/expiry/manifest, complete real source/identity/start-instance gate or hold-release flow. Those omissions are stated NO-GO boundaries, not falsely marked delivered by synthetic tests.

Before any production switch or enablement, the approved workflow still requires current production CAS, actual gateway/writer/volume/readback and recipient/source/message ledger checks, dormant same-volume RW isolation, fresh stopped-state backup and newest-data-preserving restore, real OA and old-link acceptance, valid-time gate and applicable original authorization. No such production verification or action was performed by this reviewer. Actual colleagues must complete their own business nodes and confirmations; test cards and fake/API sends never substitute for that evidence.
