# TikTok posting through Chrome

User-selected approach: use TikTok Studio in the Chrome profile where the extension runs. Reuse the existing local posting queue, schedule, categories, results, and notifications. No TikTok developer app, stored passwords, or unofficial TikTok HTTP APIs.

## Flow

- Settings offers a button to open TikTok Studio and read the signed-in account. Show the detected username and posting visibility. Login stays in TikTok; never collect credentials.
- Store connected accounts as `tiktok[]`, with local `id`, `username`, `name`, `privacy`, and `categories`. Target keys use `tk:<id>`.
- Multiple accounts may be remembered, but Chrome has one active TikTok session. Before uploading and immediately before publishing, verify its username matches the selected destination. A mismatch stops with instructions to switch accounts.
- When a scheduled clip becomes due, enqueue a dedicated `tiktok-post` browser job, upload the local MP4 through Chrome's file input, fill the editable caption, set and verify the chosen visibility and AI-content disclosure, then publish once.
- Report success only after observing TikTok's completion state. Keep a post link when TikTok exposes one; never fabricate a video ID or treat upload progress as published.
- Show login, account mismatch, missing controls, upload errors, and CAPTCHA as actionable Thai errors. Do not solve CAPTCHA automatically.

## Failure and duplicate prevention

- TikTok publishing jobs never automatically retry or requeue after a stale heartbeat.
- Persist an uncertain-result checkpoint before dispatching a posting job. Persist its job ID on the posting item so restarting the bridge cancels an interrupted job.
- A failure before the publish action may be retried normally. A failure after publishing begins, a lost result, or a bridge restart requires the user to check TikTok and explicitly confirm before another attempt.
- Content-script job guards and heartbeat cancellation prevent a second delivery from publishing again.
- Preserve successful Facebook/YouTube/TikTok destinations during retries. Do not send a TikTok destination through the YouTube upload branch.

## Alternatives

The user chose browser posting. Official TikTok Content Posting API requires developer access and review for public posting; that integration is outside this change. Manual-only upload would not satisfy scheduled posting.

## Verification

Use temporary accounts/queues and fake browser jobs for backend tests, DOM fixtures for browser state checks, and the real signed-in TikTok Studio page to verify selectors. Do not upload or publish real user content during development without authorization for the specific test file and destination. If login prevents live verification, report the limitation explicitly. Verify the settings at sidebar widths 360/450 and preserve existing card colors.

## Delivery

Ship source, regression tests, setup instructions, an extension version increment, and commit/push to the current `main` as requested in this chat.
