# Live workflow integration

This change integrates the existing official schedule reader with restricted
Feishu participants, direct-message cards, callback receipts and the five-stage
live workflow. Anchors and assistants can handle their assigned execution nodes
without gaining hub access. Manager nodes retain the hub's existing authorization.

Safety boundaries:

- Identity bindings, department allowlists, secrets, OAuth stores and business
  tasks remain in protected runtime storage and are not part of this repository.
- Verify each person's active account and allowed department; unresolved names
  or unknown schedule layouts stop affected assignments instead of guessing.
- Card receipts are bound to the real recipient and node attempt. Receiving or
  acknowledging a schedule does not complete a business node.
- The production scheduler creates at most four new sessions per five-minute
  check within the rolling 24-hour window. Stable keys prevent duplicates.
- Read-only candidates refresh identities without enabling assignment, notices,
  business writes or callback consumption.
- Defer personnel alarms while the live identity cache is uninitialized. Invalid
  verified accounts still fail closed; this does not weaken action permissions.
- `panorama/creative.js` must not redeclare the route owned by `panorama/app.js`.
  The generated page syntax and compressed variants are covered by regression tests.

Build before running published-artifact tests:

```sh
npm ci
npm run build
node --test *.test.mjs panorama/*.test.mjs scripts/*.test.mjs
```

The remote branch's startup checks and other source changes are preserved. A Git
push is not itself a production rollout. Existing live production runtime changes
were deployed incrementally with retained backups; do not replace runtime data
with repository fixtures or replay unknown-result messages during deployment.

Current business boundary: special joint-presenter sessions and newly introduced
name suffixes require explicit mapping before dispatch. Passing tests or reading
sent messages back from Feishu does not substitute for real colleague completion.
