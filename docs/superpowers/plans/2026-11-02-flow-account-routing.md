# Preserve the user's Flow account choice

The user reports that switching away from a quota-exhausted account is undone. The worker prioritizes a saved tab ID and reloads the clip's saved project URL; the panel also navigates to a constant home URL. Both can override the selected account.

Use the existing Chrome extension architecture. Shared URL/tab helpers select the most recently accessed Flow tab, preserve its account routing parameters/path, and remember its home URL locally. Resuming reuses the current workspace only if it is the saved project or the selected account home. A different open project stops with instructions to open the selected account home; never rename or collect another clip's assets. New clips retain separate projects. No account is selected automatically and no image generation is run during verification.

- [x] Add failing routing regressions for old saved tab, multiple active windows, account parameters and old project navigation.
- [x] Update worker and panel routing; retain the full project URL including account parameters.
- [x] Reset per-project image caches and stop translated resumes without reloading over the user's account.
- [x] Verify 32 Flow checks and review important regressions (wrong project reuse, cross-window selection, stale images, translation recovery).
- [ ] Commit/push version 1.0.20 and update the idle SSH machine without starting generation or altering posting schedules.
