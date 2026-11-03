# Preserve the Flow account while requesting full-resolution images

The real 10-image batch has named image tiles but saves zero PNGs. Read-only DevTools inspection found requests ending in `=s512-rw?authuser=1=s0`, returning 403. The source thumbnail returns 200, decodes and converts successfully. The fullSize helper edits the entire URL string, so its resize suffix lands inside the account query parameter when a query is present.

Parse the URL and replace only the pathname resize suffix, preserving authuser, other query values and fragment. Cover both Flow and Google image hosts and leave unrelated/invalid URLs unchanged. Verify the corrected live URL independently, then Node regressions and review. Commit/push a new version, but do not reload or interrupt the currently running Flow retry. Install through the idle-only updater when it finishes, then resume the same project with all existing images preserved. TikTok's five confirmed posts must never be retried.

The corrected live URL was verified read-only: HTTP 200 JPEG, 768×1376, converted PNG size 2,451,085 bytes. This proves the image download path; pipeline file saving still awaits safe deployment. URL regressions plus Flow policy/progress/tab checks pass, and independent review found no P1/P2 issues.
