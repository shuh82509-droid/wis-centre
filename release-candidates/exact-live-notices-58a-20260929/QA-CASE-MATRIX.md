# Exact 58a fairness r2 synthetic QA case matrix

## Frozen author handoff, not a QA result

This document describes the authored suite only. At handoff, **`node --check` completed with exit 0; tests executed: 0**. No module import, default application entrypoint, HTTP server, provider request, SSH, Docker, Git mutation, production data or credential read was performed by this test author. The expected isolated Node registration count is **114 top-level cases**, with no nested `test()` calls. This is a finite assertion matrix, not 114 independent real business scenarios. Root must record the actual count, outcomes and isolated runner evidence before reporting a QA pass.

- Suite: `qa/exact-fairness.test.mjs`
- Suite SHA256: `061b6fe8e03ba7e43e0d2cff107caa0e70b471e46ac546a80c5d7ec5fd4b26f8`
- Exact baseline sender SHA256: `58a94eb60df9021193c9b23480b73910ef857ade0428b655f21566e83954a635`
- Candidate sender SHA256: `cae7fc8df477f14d851df939e58d27d4121a6f955f543d755bae15cb5d939e6c`
- Native baseline WorkflowStore SHA256: `2e1637b0a8f5d0f486a6b0c9de9841b6cce7762e7dedf905338fd0a784546c68`

The first case hashes all 16 actual baseline ordinary modules and compares the other 15 candidate dependencies byte-for-byte. It also pins the changed candidate sender. The baseline sender is imported from the actual frozen baseline, not transcribed or extracted. Candidate sender author A owns its source; this author did not alter either source tree.

## Preserved failed first run and exact r2 extension

Root's actual first isolated Linux run of r1 registered 107 cases: **106 passed, 1 failed**, with fail case 65 `final token boundary: persisted delivery changes is fail closed`, expected IM POST 0 versus observed 1. Its test/launcher exits were 1; cancel/skip/todo were 0. This author only read that log and did not execute it.

- Original r1 suite SHA256: `74f90b3b5eee20cdad3dff664ffe9b7578f9f622bc48bc3e8ea2b102e21c21c9`
- Original r1 sender SHA256: `8d74149abc77f7177e02cbda75d9d7ac296a6db007bdaeeec31fb85bcddf887a`
- Original failed TAP: `../exact-58a-fairness-20260929/LINUX-EXACT-TAP.txt`
- Original failed TAP raw SHA256: `967ff39e9ca90d39277207a5796d31ab6907651e4e4a437c9f0695fd97ed1022`

The original r1 directory, payload, suite, matrix and failure log remain unchanged. R2 is a separately approved sibling. No failed assertion was deleted or loosened: **all first 107 titles and assertion bodies, including case 65's zero-POST assertion, are retained**. A static readback verified r2 starts with the entire original suite text after exactly one 64-character candidate SHA replacement; only the seven new cases are appended. These source/text-preservation checks are not an executed test result.

The real case-65 mutation is not ignored as a harmless test artifact. The memory fixture stores an externally supplied delivery object by reference; tokenHook's in-place content change also changes the sender's captured object, so r1's post-await object comparison missed it. R2 sender author A pins the original serialized delivery signature and complete IM body string **before the first store write or await**. The existing strong memory-alias negative case remains. Two added cases use the actual unchanged WorkflowStore toy file to check its JSON read/write isolation under in-place and whole-delivery replacement, with the same zero-POST requirement.

Five additional actual-native-store cases record one new signal during token I/O: unknown, futureEvidence, foreign sendIntent, messageId, or sentAt. Each freezes the persisted row immediately after the hook; no other new signal is added. They require zero IM POST, no invented sent state, unchanged signal/row/ID/digest, no duplicate notice, and no auto/manual release across reconstructed store/sender instances. The messageId case preserves its independently recorded **toy** receipt instead of falsely asserting a null receipt. The persisted row remains in-flight; restart checks do not pretend to isolate each new signal from that already-present sending barrier. The isolated final-POST check is the token-stage assertion.

Expected r2 registration is **114**, not an actual pass result. Any future r2 TAP, source revisions or runner record must be new evidence and must not overwrite or reinterpret the r1 106/107 failure.

## Portability and offline boundary

The suite uses only relative imports: `../candidate/flow-feishu.mjs`, `../baseline/flow-feishu.mjs`, and `../baseline/workflow-store.mjs`. Supply both complete 16-file ordinary ESM closures unchanged plus this suite at the same relative paths. No H-drive fallback, unpinned path override, default server or external package is required. Every constructed sender is supplied an explicit toy `fetchImpl`, clock, people and env. All IDs, names, bodies, app credentials, mapping and responses are synthetic. Provider URL strings are intercepted and asserted by this stub; they are not network evidence.

Native cases create a unique validated child of `tmpdir()` named `wis-exact-fairness-toy-*`, containing only toy workflow data. Cleanup targets that resolved generated directory, not a workspace, formal volume or parent tmp directory. The actual native store may inspect host/process metadata to maintain its normal lock protocol; the suite never provides production state, app env, credential files or Docker socket. Root's approved runner must remain network-none, no-production-volume, no-secret/env, non-root, read-only with bounded tmpfs/resources.

## Count and purpose

| Group | Expected top-level count | Scope |
| --- | ---: | --- |
| Exact ordinary-source scope | 1 | Baseline pins, unchanged dependencies, exact candidate sender |
| Actual old baseline reproductions | 4 | Unsafe starvation, unknown repeat, pre-POST misclassification, repeated UUID |
| Reused/adapted fairness bodies | 16 | Source filtering, finite batch, acquired lease fairness |
| Ordered historical unknown7 matrix with prior receipt facts | 14 | Seven states, seven ages, both orders; immutable original rows |
| Isolated unknown7 with no other hold signals | 2 | Every source fresh or absent; messageId null, no sentAt/intent/evidence |
| Isolated expired sending with no other hold signals | 1 | unknown false, absent source, null receipt, no intent/evidence |
| Historical sending plus receipt preservation | 3 | Expired, future and missing lease expiry |
| Unsupported intent preservation | 4 | futureEvidence/sendIntent prepared or null; no auto/manual release |
| Final source changes after token await | 7 | Source issue/age/type/future/absence; zero IM POST |
| Final lease/node/identity/delivery changes | 13 | Including missing, expired and extended TTL |
| Initial custom business-reason races | 8 | Five token-cleared reasons, source reason/state changes, completed source-await |
| Slow final persistence-return boundary | 1 | Lease ages after callback before transaction return |
| Invalid or rolled-back final clock | 2 | Zero POST without fake sent result |
| Acquired lease budget | 2 | Valid owned-node unmapped/card-unready fixtures consume five leases |
| Official-source unreadable boolean/exception | 2 | Stub false/throw blocks only its attempted source |
| Known pre-POST token failure | 6 | No IM POST, no unknown or durable send intent |
| IM invoked outcome boundaries | 11 | Unknown vs known rejection, permanent one-use barrier |
| Native shared store and successful reconstruction | 2 | Same-process concurrent senders plus new store instance |
| Native synthetic result-fault wrappers | 3 | Before mutation, callback-before-write, after native write |
| Native synthetic intent-fault wrappers | 3 | Known unpersisted vs durable hold distinguished |
| Ready result applied then wrapper throws | 1 | Durable intent blocks reconstruction repeat |
| Native toy unknown7 ordered digest | 1 | Ordered unknown rows unchanged across reconstruction |
| Actual native delivery-race extension | 2 | In-place content mutation and whole-object replacement after token |
| Actual native concurrent one-signal extension | 5 | New unknown/futureEvidence/sendIntent/messageId/sentAt preserved |
| **Total** | **114** | Expected registration, not executed acceptance |

## Original Git test preservation and the single deliberate adaptation

The separate Git 20-case fairness file at commit `9160d3449429ee91c6fd054dd77b4ab5783d382c` has raw SHA256 `9a49079dda3a5c482c4398ddf446583d2ebacf84fb28e4fb02549179a382a2ac` and remains untouched. Existing Git Linux 261 results are separate and are not acceptance of this exact-production overlay.

The exact suite contains **15 originally proposed reusable fairness assertion bodies plus 1 explicitly adapted slow-selection fixture**. Git #19 delayed every transaction by 60001 ms; the new final lease barrier correctly rejects a POST after such a final delay. Therefore the exact positive selection test delays only the first selection transaction once, retaining its fair progress and deferred-source assertions. A separate strong negative case delays after the final intent callback and requires zero POST. This is disclosed fixture adaptation, not removal of an unsafe assertion or a claim that the original 16 bodies are byte-identical. The four Git permanent-hold/protocol cases are not copied into a source that lacks the Git future/permit module: this suite instead tests the actual same-file `sendIntent` contract and freezes historical rows without migration.

## Hold, POST and durability invariants

1. Existing unknown, sending, unsupported intent and receipt rows are not migrated, retired, re-leased or overwritten. The receipt-bearing matrix remains as a positive preservation check. Separately, the two full unknown7 matrices remove all other hold signals and use only fresh/absent source; the isolated sending case sets unknown=false and removes every receipt/intent marker. Thus source staleness or delivery facts cannot mask missing unknown/sending barriers.
2. Ordered row snapshots and SHA256 of `JSON.stringify` are checked before/after flush, sender reconstruction and retry. These are ordered semantic-row digests, **not the entire WorkflowStore file's raw-byte hash**; the native store's normal `updatedAt` and task normalization are not misrepresented as unchanged bytes. All unknown7 rows here are toy rows, not the seven real historical unknown notifications.
3. Every invocation retains original notice ID and deterministic original message UUID. No additional notice, inferred receipt, substituted message ID, automatic old-unknown retry or manual intent release is allowed.
4. IM fetch invoked followed by network/JSON failure, HTTP 5xx or HTTP 408/409/499, or missing/empty/non-string successful message ID is unknown=true and held forever by sendIntent. An explicit finite nonzero provider code with finite status>=200 and <500, excluding 408/409/499 (429 or expired-token rejection) is **unknown=false but still permanently held**, with no second IM POST or token-driven IM replay.
5. Known token/pre-POST failures have zero IM invocation, no sendIntent and are not falsely labeled sent/unknown. Before-intent-mutation and callback-before-native-write exceptions leave no committed intent or POST; a fresh sender may safely send the original once. After-native-intent-write exceptions retain a durable marker and permit zero future POST. The assertions distinguish these boundaries rather than imposing false permanent quarantine for proven unpersisted work.
6. Result transaction faults cannot erase the already persisted intent. A synthetic wrapper that commits ready/unknown=false then throws remains held across new WorkflowStore/sender instances. This represents an after-native-transaction-return failure boundary, **not a demonstrated real rename or directory-fsync failure**.
7. The five-lease budget is consumed by legitimate acquired leases, including unmapped and card-unready recipients whose node owner actually matches that recipient. Obsolete invalid rows and stale/unknown/intent rows do not consume the budget. No validity helper is stubbed or bypassed.
8. The sender's final token/clock/lease/source/node/recipient/delivery readback is exercised with pure mutations. The original initial custom-kind reasons are cleared during token I/O only after proving an actual acquired lease and token invocation; creative completed is also changed during its actual official-source await. The exact sourceExceptionKinds skip official-source I/O for the other four alert kinds; this suite does not fake that call or claim coverage of a non-existent source-await. The final synchronous persistence-return delay requires zero POST; no source/clock guard test is accepted merely because a synthetic positive POST happens to succeed.

## Explicit limits and production NO-GO

- There is no real kernel fsync/rename/power-loss fault injection, child-process crash or multi-process concurrency claim. Native fault cases are labeled synthetic wrappers; the concurrent case uses two sender instances in one Node process with the actual native store.
- Synthetic official-source false/throw and toy mapping do not prove actual schedule ownership, current employment, independent message readback, source completeness, real recipient identity, signed permit, live card authorization, group readiness, notification-link login or real five-node business completion.
- This overlay does not repair every business time window or the adjacent modules. No claim is made that next-day activation, source/identity permissions, old intent recovery, new-context release, backup/restoration, old RW isolation or current formal CAS is complete.
- No candidate is enabled or deployed by this author. Production remains subject to root's fresh gateway/source/CAS verification, approved isolation, fresh stopped-state backup, rollback preserving current data, real OA/login and old-link visual acceptance, and required user/business approvals.
- There is no executed pass count here. Root must retain any real failed run, report exact final hashes and actual isolated TAP outcomes, and not combine prior 261/509 QA or another candidate's tests with these 114.

## Fixed expected titles in registration order

1. scope: all 16 baseline pins and 15 unchanged candidate dependencies are exact ordinary source
2. baseline reproduction: five recurring stale rows starve sixth eligible row
3. baseline reproduction: unknown under one hour is POSTed again and marked sent
4. baseline reproduction: known pre-POST token error is misclassified unknown
5. baseline reproduction: ambiguous first POST auto-repeats same original UUID under one hour
6. fairness: five recurring stale sources cannot starve an independent notice
7. fairness: 128 blocked rows do not consume five eligible leases
8. fairness: missing timestamp blocks only its source
9. fairness: invalid timestamp blocks only its source
10. fairness: non-string timestamp blocks only its source
11. fairness: future timestamp blocks only its source
12. fairness: source issue blocks only its source
13. fairness: source age 45000 is accepted and 45001 is not
14. fairness: refreshed source preserves ID and sends original once
15. fairness: transaction selection rechecks source changes
16. fairness: duplicate task IDs preserve first source gate
17. fairness: only stale rows produce zero transactions and provider calls
18. fairness: explicit disabled sender performs no transaction or provider call
19. fairness: seven obsolete nodes retire without consuming acquired leases
20. fairness: one slow selection ages source without repeatedly selecting deferred row
21. fairness: finite batch ignores notices appended during its transactions
22. immutable barrier: seven unknown states / new / forward
23. immutable barrier: seven unknown states / new / reverse
24. immutable barrier: seven unknown states / under one hour / forward
25. immutable barrier: seven unknown states / under one hour / reverse
26. immutable barrier: seven unknown states / exactly one hour / forward
27. immutable barrier: seven unknown states / exactly one hour / reverse
28. immutable barrier: seven unknown states / older than one hour / forward
29. immutable barrier: seven unknown states / older than one hour / reverse
30. immutable barrier: seven unknown states / malformed / forward
31. immutable barrier: seven unknown states / malformed / reverse
32. immutable barrier: seven unknown states / future / forward
33. immutable barrier: seven unknown states / future / reverse
34. immutable barrier: seven unknown states / missing / forward
35. immutable barrier: seven unknown states / missing / reverse
36. isolated unknown barrier: seven states without delivery facts / all fresh
37. isolated unknown barrier: seven states without delivery facts / all no-source
38. isolated sending barrier: expired lease without unknown, source or delivery facts remains immutable
39. immutable barrier: pre-existing sending expired lease is never re-acquired
40. immutable barrier: pre-existing sending future lease is never re-acquired
41. immutable barrier: pre-existing sending missing lease is never re-acquired
42. immutable barrier: future evidence prepared does not auto or manual retry
43. immutable barrier: future evidence null does not auto or manual retry
44. immutable barrier: send intent prepared does not auto or manual retry
45. immutable barrier: send intent null does not auto or manual retry
46. final token boundary: aged to 45001 blocks IM POST
47. final token boundary: invalid checkedAt blocks IM POST
48. final token boundary: future checkedAt blocks IM POST
49. final token boundary: non-string checkedAt blocks IM POST
50. final token boundary: missing checkedAt blocks IM POST
51. final token boundary: new source issue blocks IM POST
52. final token boundary: creative source invalid blocks IM POST
53. final token boundary: lease expires during token is fail closed
54. final token boundary: lease ID changes is fail closed
55. final token boundary: lease removed is fail closed
56. final token boundary: lease expiry removed is fail closed
57. final token boundary: lease expiry extended is fail closed
58. final token boundary: node owner changes is fail closed
59. final token boundary: node attempt changes is fail closed
60. final token boundary: node completes is fail closed
61. final token boundary: task pauses is fail closed
62. final token boundary: recipient map changes is fail closed
63. final token boundary: recipient is no longer active is fail closed
64. final token boundary: notice recipient changes is fail closed
65. final token boundary: persisted delivery changes is fail closed
66. custom reason token boundary: source_attention issue cleared blocks IM POST
67. custom reason token boundary: assignment_attention issue cleared blocks IM POST
68. custom reason token boundary: handoff_blocked attention cleared blocks IM POST
69. custom reason token boundary: routing_attention reasons cleared blocks IM POST
70. custom reason token boundary: creative completed becomes running blocks IM POST
71. custom reason token boundary: source_attention reason changes blocks IM POST
72. custom reason token boundary: source_attention task stops running blocks IM POST
73. custom reason source boundary: creative completed becomes running blocks IM POST
74. final synchronous transaction: lease expires after callback before store returns, zero POST
75. final token boundary: invalid clock blocks POST and preserves original ID
76. final token boundary: clock rollback blocks POST and preserves original ID
77. lease budget: five unmapped rows consume acquired leases, sixth waits until next flush
78. lease budget: five unavailable cards consume acquired leases, sixth waits until next flush
79. official source: unreadable false produces zero IM POST
80. official source: unreadable throw produces zero IM POST
81. known pre-POST token failure: network throw is not sent or unknown
82. known pre-POST token failure: JSON throw is not sent or unknown
83. known pre-POST token failure: authentication rejected is not sent or unknown
84. known pre-POST token failure: server error is not sent or unknown
85. known pre-POST token failure: successful code missing token is not sent or unknown
86. known pre-POST token failure: malformed token type is not sent or unknown
87. one-use IM POST: network result unknown holds original message across restart
88. one-use IM POST: response JSON unknown holds original message across restart
89. one-use IM POST: HTTP 500 holds original message across restart
90. one-use IM POST: HTTP 408 holds original message across restart
91. one-use IM POST: HTTP 409 holds original message across restart
92. one-use IM POST: HTTP 499 holds original message across restart
93. one-use IM POST: HTTP 429 holds original message across restart
94. one-use IM POST: success missing ID holds original message across restart
95. one-use IM POST: success empty ID holds original message across restart
96. one-use IM POST: success object ID holds original message across restart
97. one-use IM POST: explicit expired token response holds original message across restart
98. native store: two sender instances concurrently sharing one toy file POST only once
99. native store: successful sender reconstruction retains ID, receipt and permanent send intent
100. native synthetic wrapper: before result mutation failure cannot duplicate POST after restart
101. native synthetic wrapper: after result mutation before native write failure cannot duplicate POST after restart
102. native synthetic wrapper: after native result write failure cannot duplicate POST after restart
103. native synthetic wrapper: before intent mutation failure produces zero first POST
104. native synthetic wrapper: after intent mutation before native write failure produces zero first POST
105. native synthetic wrapper: after native intent write failure produces zero first POST
106. native synthetic wrapper: result stored as ready then throw still leaves durable barrier
107. native store: seven synthetic historical unknown rows keep exact ordered SHA through independent sender restart
108. native final token boundary: delivery content changed in place blocks IM POST
109. native final token boundary: delivery whole delivery replaced blocks IM POST
110. native final token boundary: newly recorded unknown is preserved without IM POST or retry
111. native final token boundary: newly recorded futureEvidence is preserved without IM POST or retry
112. native final token boundary: newly recorded sendIntent is preserved without IM POST or retry
113. native final token boundary: newly recorded messageId is preserved without IM POST or retry
114. native final token boundary: newly recorded sentAt is preserved without IM POST or retry
