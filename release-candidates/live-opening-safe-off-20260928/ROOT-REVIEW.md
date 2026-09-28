# Root verification — fixed-window OFF candidate

2026-09-28, same WIS task. This file was added after the source package was frozen; it is not claimed as a member of that package.

Root independently read the whole new opening module and window tests, checked syntax of the module, both tests, fixture and child worker, and executed the complete Linux suite through the approved SSH/rootless Docker path. Result: **156/156 passed, 0 failed/cancelled/skipped**. The real WorkflowStore subprocess tests use only synthetic /tmp state. No default server entrypoint, formal volume, credential, OAuth, real POST, production tick or callback was used.

Root independently inspected immutable images: candidate `sha256:82fbd47e409b498fd629122714351546fc690f911961a9e437627e592baa6543` is linux/amd64, Config exactly matches hard-OFF parent `e54e3e7cbdb8602c8b07129d53b7436fb2edcec91d33c0333c3182ec2825a6cc`, all 32 parent layers are unchanged and one COPY layer makes 33. Separate no-network/read-only/non-root image readback yielded:

- opening module `320af5fda2726b2b5ec7d45185929f48dac9f6fbbbf597209b4b76327952a9e7`;
- hard-OFF server `af21b94baa29c3f245c2ee892b4ff273347645798eb2f4c9500c4419518ee4cd`;
- unchanged WorkflowStore `2e1637b0a8f5d0f486a6b0c9de9841b6cce7762e7dedf905338fd0a784546c68`.

The independent reviewer separately executed 76 extra memory cases and the existing 82 memory no-retry cases. Root read that report and its exact limitations and then independently reran the 76 extra memory cases from the actual Git archive bytes: 76/76 passed with no failures/skips. Neither this memory run nor the reviewer's 82 cases is native WorkflowStore subprocess evidence. Invalid/rollback clocks, slow source/token/commit/readback crossing 17:00, fixed configuration, midnight and request drift fail closed. The last clock follows journal IO and precedes fetch without another await/transaction. New autoHold remains permanent; success cannot implicitly release group summaries.

Root separately hashed the frozen local source package `opening-window-off-c1e3c6b4-752cad8f.tgz`: `7c22e249858298dcea0bc2e04af7d2e35716d927d6e5601793d7e6697ea44279`. The original no-retry sibling remains unchanged. Git archive delivery is separately verified and is not deployment.

**NO-GO for production enablement.** This is only a necessary fixed Shanghai [16:00,17:00) safety boundary. It does not implement signed/15:55 first-activation/start-instance/source-identity readiness or independent autoHold release. Current source/recipient/CAS, dormant RW isolation, fresh stopped backup plus restore/latest-data-preserving rollback and genuine OA/old-link checks are still required. Production was not changed; real business completion must be performed by actual colleagues.
