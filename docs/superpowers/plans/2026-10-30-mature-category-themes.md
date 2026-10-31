# Mature category themes implementation plan

> Use executing-plans inline; asset producers and final reviewers follow impeccable's delegated asset/review workflow. User's explicit correction supplies the new subject, category behavior and maturity requirements; proceed with the revision.

**Goal:** Three distinct category-driven whole-app themes, with no childish imagery and five adult 12-frame characters.
**Architecture:** Pure category theme configuration resolves existing genre names/IDs. Existing S.genre remains source of truth. Apply data-category and CSS tokens across all surfaces; adult atlas paths replace child assets without job ID changes.
**Tech stack:** Existing MV3 HTML/CSS/JS, local ImageGen PNGs, authored SVG, Node and isolated Chrome fixtures.
**Spec:** ../specs/2026-10-30-mature-category-themes-design.md

## Constraints
- No child/chibi/oversized-head imagery. Adult 3D natural proportions, 12 distinct frames per person.
- Preserve three content categories and mix, API payload genre values, production prompts, department IDs, 3-second polling and accessibility/motion behavior.
- No secrets, runtime dependencies or paid clip calls. Local backups; no Git available.

## Review focus
- Stored ID/name/mix/unknown category resolution.
- Immediate category UI change in every topic mode and after load.
- Department changes must not override category tokens.
- Whole-app overlays and light/dark contrast follow selected category.
- All five replacement atlases must depict adults and contain 12 actual poses.

## Tasks
1. Back up changed sources; produce six category backgrounds and five adult atlases with prompt provenance.
2. Write failing category-resolution/palette/state tests, implement category-themes.js and selection integration, expose the selector in all topic modes; verify names and IDs with actual dropdown persistence.
3. Implement category colors/logos/backgrounds across all UI surfaces; remove child labels/visual references, bind adult portraits and retain exact 12-frame behavior.
4. Update product/design/surface docs; run asset+contrast+syntax tests and one batched browser screenshot inspection over the category/theme/width matrix. Fix material findings and confirm once. Fresh review and deliver.

## Completion evidence

All four tasks completed. See .impeccable/category-progress.md, category-finish-review.md and the subsequent sprite-lock-review.md.
