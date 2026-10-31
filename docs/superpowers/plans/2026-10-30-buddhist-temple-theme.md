# Buddhist temple theme implementation plan

> For agentic workers: use superpowers:executing-plans in this session. The user approved the design and instructed creation; proceed continuously without another approval checkpoint.

**Goal:** Deliver the approved Thai Buddhist temple 3D theme across the extension with five distinct 12-frame characters and the completed ICO.

**Architecture:** Preserve department IDs and job behavior. Add generated temple assets and a 4×3 atlas renderer to the existing portrait function. Replace incumbent ocean styling at its sources; centralize new tokens and component refinements in temple.css loaded after existing styles.

**Tech Stack:** Plain HTML/CSS/JavaScript, native ImageGen, Windows PowerShell, Node static verification, local browser preview.

**Spec:** ../specs/2026-10-30-buddhist-temple-theme-design.md

## Global constraints

- Thai UI, 12 distinct frames per character, 5 characters, 2 temple backgrounds.
- Preserve job IDs, polling every 3 seconds, hidden/offscreen pauses, reduced motion, billing defaults, bridge and pipeline.
- All assets local. No runtime dependencies or fonts fetched remotely. Do not read secrets.
- Existing folder is not a Git checkout. Back up changed files locally; do not create worktrees or commits.

## Review focus

1. Atlas row transitions and all 12 unique frames: test atlas positions and image dimensions; inspect a contact sheet.
2. Dark/light readability across departments: contrast checks and screenshots at 360/450px.
3. Hidden/offscreen/reduced motion: assert computed animation state through preview fixtures.
4. All auxiliary surfaces: inspect posting, readiness, library and modal plus remove visible animal labels.
5. No false end-to-end claim: distinguish static fixture verification from unavailable production services.

## Task 1: Assets and backup

Interfaces: atlas paths `extension/agents/temple-{chatgpt,flow,meta,voice,edit}.png`, background paths `temple-day.png`, `temple-night.png`. Atlases are exactly 4 columns × 3 rows, reading order.

- [x] Back up HTML/CSS/JS/docs targeted by this change into `.impeccable/backups/temple-theme-20261030`.
- [x] Generate seven project-bound PNGs with built-in ImageGen; store exact prompts and provenance. Visually verify output and native alpha, never substitute ocean assets or repeat frames.

## Task 2: Twelve-frame portrait renderer

Files: `extension/agents.js`, `extension/agents.css`, `extension/sidepanel.js`, `scripts/test-temple-theme.mjs`.

Interfaces: preserve `portrait(id) -> HTMLSpanElement`, department IDs and `SEA_ASSETS` export compatibility; introduce `TEMPLE_ASSETS`, `SPRITE_COLUMNS=4`, `SPRITE_ROWS=3`, `SPRITE_FRAMES=12`, and `spritePosition(index) -> [xPercent,yPercent]`.

- [x] Write a meaningful failing test for twelve atlas positions including 3→4 and 7→8 row transitions, first/last frame, and invalid index handling. Run it and observe failure.
- [x] Implement new local assets, frame-aware portrait ratio, department display labels, and CSS discrete frame positions.
- [x] Preserve existing span class names for integration; remove obsolete strip animation from all active paths.
- [x] Run the test and syntax checks; verify pauses through fixtures in Task 4.

## Task 3: Complete temple visual system

Files: `extension/temple.css` (new), `extension/sidepanel.html`, `extension/agents.css`, `extension/posting.css`, `extension/sidepanel.js` (visible labels only), `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, surface brief.

Interfaces: shared semantic CSS variables for light/dark surfaces; persistent department IDs; existing control and overlay IDs.

- [x] Load the craft floor, implement cream/gold/saffron/wood tokens and temple backgrounds.
- [x] Refine first viewport and hero, coherent project controls, automatic/manual workflow sections, forms, sticky crew, focus and disabled states.
- [x] Apply theme to posting, video library, readiness, overlays and modals. Replace bird icon and ocean display labels, retain factual service text.
- [x] Update design/product artifacts to the chosen world and exact frame contract.

## Task 4: Verify and finish

Files: local-only static preview fixture and screenshot script under `.impeccable/review`, `scripts/test-temple-theme.mjs`, progress ledger.

- [x] Inspect existing tests and preview dependencies without reading secret-bearing modules. If production modules are empty, record that pre-existing limit and serve a mocked Chrome/bridge preview.
- [x] Verify PNGs, ICO and all 12 frames, code syntax, DOM IDs and UI event wiring.
- [x] Capture one batched inspection: 360/450px × light/dark plus key overlays and working/reduced-motion states. Fix material issues in one batch and confirm once.
- [x] Run the detector once on changed targets; fix mechanical findings.
- [x] Request a fresh finish review with spec, screenshots, test evidence and write scope. Resolve material findings and verify again only as warranted.
- [x] Deliver files and representative screenshot, noting the actual extent of verification.
