# Production scheduling clarity

Keep the existing scheduler and saved settings. Replace the dense production form with three explicit choices: when to start, how many clips, and the rest after a completed clip. Show a plain Thai summary before the start button. Move random content and publishing settings into a native disclosure, preserving every option.

Use an explicit continuous checkbox instead of requiring users to understand count=0. Offer no rest, fixed rest and random rest, mapping to the existing delayMin/delayMax fields. Validate empty or invalid values before saving or starting. Keep actual running status separate from the draft plan and never promise a completion time.

Verification: Node tests for legacy settings round trips, invalid input and date rollover; isolated Chrome preview of the actual markup and production controller with a stub API, including narrow/wide panels and light/dark themes. No production jobs or posts may be launched by verification. Review, commit and push. The remote installation must use the existing idle-only updater without interrupting production.
