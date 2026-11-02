# TikTok Browser Posting Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Post queued clips to the selected TikTok account through the user's Chrome session.

**Architecture:** Extend posting destinations with `tk:` accounts. Bridge jobs communicate with a TikTok content driver through the existing extension worker; a small local adapter waits for terminal job results. Publishing jobs are non-retryable automatically and preserve uncertain outcomes.

**Tech Stack:** Existing Node ES modules, Chrome MV3, plain DOM/CSS, native Node assertions. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-02-tiktok-browser-design.md`

## Global Constraints

- Thai UI, existing light/dark category themes and 360–450px sidebar.
- No passwords, cookies, TikTok developer secrets, or unofficial HTTP APIs.
- Never claim posted from upload acceptance alone; never automatically repeat a publish attempt.
- Existing Facebook/YouTube destinations and successful results must remain compatible.

## Review Focus

- Stale/restarted jobs cannot be delivered again after a publish may have happened.
- Remembered account and signed-in account must match before upload and before publishing.
- Connection detection cannot choose an unrelated creator's profile link from navigation/content.
- Missing visibility/AI disclosure controls must stop rather than silently publish different settings.
- Legacy accounts files and mocks without `tiktok` arrays must keep working.

## Task 1: Accounts and bridge adapter

Files: `pipeline/lib/posting.mjs`, new `pipeline/lib/tiktok-browser.mjs`, `bridge/posting.js`, `bridge/server.js`, `scripts/test-tiktok-posting.mjs`.

- [x] Write and run failing tests for legacy accounts, target/category selection, connection jobs, TikTok success/failure, uncertain retries and interrupted attempts.
- [x] Add the `tiktok` account collection and `tk:` destination resolution, with sanitized public metadata.
- [x] Add connect/update/remove routes and collect terminal account-detection jobs.
- [x] Implement `runTikTokJob({ jobs, enqueue, payload, onStart }, options)` with bounded waiting, cancellation, non-retryable jobs, strict results, and `needsVerification` errors.
- [x] Persist attempt/job checkpoints, route TikTok uploads separately, require explicit confirmation for uncertain retries, and prevent stale job requeue.
- [x] Run TikTok and existing posting regression scripts.

## Task 2: Browser worker and driver

Files: `extension/background.js`, `extension/manifest.json`, new `extension/tiktok-dom.js`, new `extension/content-tiktok.js`, `scripts/test-tiktok-dom.mjs`.

- [ ] Read the actual TikTok Studio DOM after user login; use fixtures reflecting observed controls. **Pending user login:** the opened TikTok Studio tab redirects to login; signed-in selectors remain unverified.
- [x] Write and run failing tests for account mismatch, login/CAPTCHA, caption editing, privacy verification, and duplicate job delivery.
- [x] Register the TikTok agent and host/content permissions. Scope file injection to the active job and expected TikTok tab; obtain paths from the authenticated bridge rather than message-supplied arbitrary paths.
- [x] Implement account detection and single-submit posting, with heartbeat, progress, cancellation, and durable per-attempt browser guards.
- [x] Run driver tests and syntax checks. Pure DOM and full-driver fixtures pass; live verification remains the pending item above.

## Task 3: Settings, results and delivery

Files: `extension/posting.js`, `extension/posting.css`, `extension/sidepanel.js`, `README.md`, `extension/manifest.json`.

- [x] Add TikTok connect/status controls, visibility and AI-content settings, category selection, removal, badges and quota labels.
- [x] Add explicit confirmation before retrying an uncertain TikTok destination; keep successful destinations skipped.
- [x] Verify mocked settings screen in Chrome at 360/450px; visibility control updates and no horizontal overflow. Existing theme palette checks pass. Run all related posting and update tests.
- [x] Perform a fresh whole-change review and resolve important findings; prepare version 1.0.14 for commit/push. Live TikTok verification remains pending user login.

## Review ledger

Independent review found four P2 issues: global-body success text, a final cancellation gap, stale AI settings, and overlapping jobs after worker restart. Added adversarial regressions and fixed each. Follow-up found a detached caption editor; its regression failed before the final-editor reacquisition fix and now passes. Real HTTP tests also confirm serialized dispatch and that bridge restart never replays a queued publish attempt. No real user files were uploaded or published during development.
