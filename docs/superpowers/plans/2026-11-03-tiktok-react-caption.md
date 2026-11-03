# Preserve TikTok's React-owned caption nodes

After runtime 1.0.28 was verified (source is the 1.0.25 repair), a guarded retry of eafd7689 failed before publishing. The dedicated Studio tab showed a fatal page. Its real DevTools console reports React NotFoundError from removeChild. Translation was ruled out with a read-only console check: empty html class, native th-TH locale, google notranslate meta.

The driver directly replaces contenteditable child nodes using Range + execCommand and sends another synthetic input event. This can detach React-owned placeholder/text nodes, then crash the next settings render. Replace that path with browser text input via the debugger, bound to the existing running post job and tab. Keep textarea handling, caption readback, identity/privacy/AI checks, exactly one publish action, and all permanent ledger locks.

Test contenteditable handling and trusted command ordering locally. Commit/push and install only while idle. Retry only the approved real failed item after rechecking runtime, queue and matching ledger aliases/hashes. Confirm actual publication; never infer success from upload. Flow recovery remains pending and must not be interrupted.
