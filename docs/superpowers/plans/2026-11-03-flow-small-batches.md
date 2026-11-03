# Flow image batches

The failing project requested 25 shots plus a cover in one initial message. Its actual agent response explicitly rejected 26 images because that command supports at most 24. Later text claims of completion did not produce any files received by the pipeline. Three uploaded references were also reported as generated progress.

Send at most 10 requested images per bridge attempt, reusing the clip's verified project across batches. Rebuild each prompt with the style/character context and only that batch's pending filenames. Keep automatic account rotation, original references, zero-credit checks, prompt spacing, saved partials and the posting ledger. After rotation, create a new project in the next verified account, then reuse that project for its next batch. Only written image files count toward completion.

- [x] Add failing regressions for 26 images, a full batch followed by quota, project continuity and partial results.
- [x] Bound all initial/recovery/rotated requests; report actual named images and return project URL in content results.
- [x] Verify Flow routing/quota/text tests and obtain independent review.
- [ ] Commit/push next version and let the existing safe updater install when the running clip ends. Verify real production images before claiming full repair. Preserve the pending TikTok recovery.
