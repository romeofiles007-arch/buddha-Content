# Flow quota failover implementation plan

**Goal:** Automatically move image generation to the next already signed-in Google account when Flow explicitly reports an account limit.

**Architecture:** Content detects explicit quota messages, saves available named images, and ends its bridge attempt with structured quota metadata. The image pipeline starts a separate serialized account-switch job, then builds a fresh project prompt containing the original style/character context and only remaining shots. The worker reads the real Google account chooser through Chrome's existing debugger permission, selects a signed-in account, and verifies its Flow profile email before returning. No new host permissions or login automation.

**Constraints:** Preserve zero-credit verification, prompt spacing, partial files, posting ledger and all posting schedules. High demand is not account quota. Never generate test images or post test clips during deployment. Cooldowns persist in extension local storage; use a reported retry interval or a conservative 24 hours when no reset is given. Visit each account at most once per pipeline run. Stop with a clear message if all are limited or login/challenge is required.

- [x] Write failing quota classification, circular selection, partial-resume and browser identity verification tests.
- [x] Add shared quota policy and account chooser driver, with cancellation heartbeats and bounded waits.
- [x] Integrate content quota results and pipeline continuation; stop autopilot retries for exhausted accounts.
- [x] Run relevant Flow, updater and posting regressions and obtain one independent review.
- [ ] Commit/push version 1.0.21 and update idle SSH installation; verify switching read-only without image generation.

**Review focus:** Ambiguous rate limits must not rotate; exhausted accounts must not ping-pong; chooser rows requiring login must not be selected; partial shots must not be requested again; a quota result must never be treated as a completed image batch.
