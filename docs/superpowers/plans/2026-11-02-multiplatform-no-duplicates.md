# Multiplatform posting without duplicate submissions

**Goal:** One clip can publish to all selected platforms in the same scheduled round. Never submit the same clip again to the same destination after success or an uncertain submission.

**Design:** Keep the existing queue and adapters. Add a permanent delivery ledger, keyed by video SHA-256 or original project/file identity plus the platform's external account identity. Reserve durably before uploading; confirm the ledger before saving queue results. Unknown outcomes remain blocked, including after reconnecting, removing/re-adding queue entries, or restarting. Import previous queue successes/uncertain attempts. Send different platforms concurrently while serializing destinations within a platform. Preserve selected accounts/categories and existing schedule times.

**Approach:** Queue-only flags miss re-enrollment and reconnects. Provider idempotency alone is unavailable across all three existing adapters. A local permanent ledger plus fail-closed unknown outcomes fits the existing architecture. This deliberately prefers a blocked uncertain upload over risking another submission.

**Constraints:** No real test publications. Existing successful destinations must remain untouched. YouTube without a connected channel cannot receive uploads. Apply the user's all-platform preference to pending matching-category clips and continuous production on SSH 192.168.1.133; retain their times. Do not replay earlier posted clips.

- [x] Add failing ledger and full posting regressions: parallel platforms, copied/re-added clips, account reconnect, lost responses, restart, corrupt history, safe pre-submit retry.
- [x] Implement the ledger and adapter failure-phase tracking; integrate atomic reservation and per-target persistence.
- [x] Remove the uncertain retry override and make the UI explain blocked destinations. Keep retry available for known unsubmitted destinations.
- [ ] Run related tests and independent review, resolve important findings, bump release, commit and push.
- [ ] Safely update the SSH package, import history before the next publication, and align pending targets/production settings without changing schedule times. Read back results and preserve production work.

Review resolved three concrete findings with failing-then-passing regressions: legacy removed rows erased before import, mutable source files changing after hashing, and aliases lost when a duplicate was recognized. A follow-up audit found no remaining concrete P1/P2 issues. The final related regression run passed 100 checks across 12 scripts without contacting any posting platform. TikTok handle changes fail closed because the browser adapter lacks a stable user ID; Facebook/YouTube use page/channel IDs. Deployment is still pending the safe SSH update window.
