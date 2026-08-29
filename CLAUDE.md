# Clarity Desk — Agent Instructions

Offline-first academic PWA (timetable, attendance, tasks, vault, notices, "Ask Desk" assistant).
Vanilla JS, no build step. `localStorage` is the source of truth; Firebase is optional and must stay optional.

## Key files
- `index.html` — app shell, head theme bootstrap, modal templates, nav
- `app.js` — core logic (monolithic, ~11k lines, no module boundaries — high risk)
- `style.css` — themes, layout, responsive system
- `data.js` — fallback/default datasets
- `manifest.json`, `sw.js` — PWA manifest and service worker/cache versioning
- `firebase-config.js` — optional cloud config
- `PROJECT_MEMORY.md` — architecture history, storage schema, past bug-fix intent
- `tests/` — regression, normalization, PWA smoke, visual, release gate

## Working rules
- Inspect first before editing.
- Plan first for non-trivial or multi-file tasks; wait for explicit approval before implementing.
- Make the smallest safe change. No unrelated cleanup, refactors, or redesigns.
- Don't invent new architecture unless clearly necessary.

## Protected systems — inspect carefully, explain risk before touching
- `cos_*` storage schemas
- attendance calculations and history
- timetable parsing
- General + user-group filtering
- backup / restore
- OCR flows
- offline-first behavior
- service worker / manifest / cache update behavior
- subject normalization compatibility
- existing navigation behavior
- current 12-hour AM/PM formatting

## Data safety
- Never rename storage keys or change stored shapes without a migration path.
- No silent destructive writes: parser/OCR/AI/cleanup output must go through a review/preview flow before persisting.
- Backup/restore must stay compatible.

## Verification (run, don't assume)
- Logic changes → `npm test`
- PWA/service worker/manifest/offline changes → `npm run test:pwa-smoke`
- UI/theme/layout/modal changes → `npm run test:visual`
- Release readiness → `npm run release:check`
- Report exact failures; distinguish real regression vs setup issue vs pre-existing problem. Never weaken a test to pass.

## Git safety
- No `git reset --hard`, `git clean -fd`, force push, or branch deletion.
- No commit/push unless explicitly asked.
- Before pull/merge/rebase, report `git status`, branch, and remotes first.

## Reporting format
After any change, report: files changed, what changed in each, commands run, actual results, remaining risks. Never say "done" without evidence.
