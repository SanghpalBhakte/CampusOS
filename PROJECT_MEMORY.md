# 🧠 CLARITY DESK — PROJECT MEMORY & ARCHITECTURAL KNOWLEDGE BASE

> **Version:** 2.0 Production-Ready (Post Unit 1–5, Polish Pass, and Gap Fixes)  
> **Repository Root:** `D:\Clarity Desk`  
> **Philosophy:** Offline-first, privacy-first, deterministic academic operating desk for college students.  

---

## 1. Executive Summary & Core Principles

Clarity Desk is a progressive web application (PWA) designed to eliminate academic friction for university students. It unites daily timetables, live attendance logs, assignment tracking, study vault links, notice boards, and an intelligent context-aware assistant (**Ask Desk**) without requiring cumbersome third-party servers or mandatory logins.

### Non-Negotiable Core Rules:
1. **Local-First & Offline Resilience**: All student data is stored locally in `localStorage` with automated snapshot backup capabilities. Cloud sync via Firebase Firestore is purely optional.
2. **Deterministic-First Logic**: Normalization, attendance calculations, threshold warnings, and OCR table reconstruction rely on deterministic algorithms first, using LLMs/Vision AI strictly as assistive or structured-extraction fallbacks.
3. **Zero Silent Writes / Auto-Saves**: Parser outputs, AI suggestions, cleanup migrations, and guided actions never mutate stored data autonomously. Every change requires an explicit student review and confirmation modal.
4. **Product Trust & Calm UI**: Transparent status indicators, calm non-alarmist warnings, exact mathematical feedback, and predictable navigation.

---

## 2. Directory Structure & Key Files

```text
D:\Clarity Desk\
├── index.html           # PWA entry point, <head> theme bootstrap, shell, modal templates, mobile & desktop nav
├── app.js               # Core application logic (~11,100 lines), routers, state managers, renderers, OCR pipelines
├── style.css            # Unified design system, CSS variables, 6 themes, responsive layouts, print sheets
├── data.js              # Fallback reference datasets, default batch timetables, sample notices
├── manifest.json        # PWA web manifest, icons, standalone display mode
├── sw.js                # Service Worker for offline asset caching
├── tests/               # Automated regression test suites (Node.js ESM)
│   ├── verify_master.mjs
│   └── verify_gap_fixes.mjs
└── PROJECT_MEMORY.md    # Permanent memory & architecture archive
```

---

## 3. Engineering History & Unit-by-Unit Implementation

### 🔹 Unit 1 — Attendance Baseline Setup & Normalization
- **Problem**: New students could not track ERP attendance without entering an entire semester of historical classes manually.
- **Solution**:
  - Implemented configurable attendance baselines stored in `cos_attendance_baseline`.
  - Added support for manual count entry (`Present` / `Total` or `Present` / `Absent`) and OCR camera scan imports.
  - Baseline-only subjects appear correctly even without weekly timetable slots.
  - Formula: `Total Attended = Baseline Attended + Daily Marked Attended + Live Manual Adjustments`.
  - Configurable target threshold (default `75%`, customizable to `80%` or `85%`).

### 🔹 Unit 2 — Polluted Subject Cleanup, Daily Log Migration & Undo
- **Problem**: Multiple batch variants (e.g. `OS Lab B1`, `OS Lab B2`, `OS-Theory`) created fragmented, noisy subject cards.
- **Solution**:
  - Built an intelligent declutter engine that detects batch suffixes and token variations.
  - Added a safe **Declutter Preview Modal** showing exact merge mapping before any write occurs.
  - Automatically migrates historical daily attendance logs to canonical keys.
  - Created a 7-domain snapshot backup system (`KEY_BACKUP_SNAPSHOTS`) with instant **Undo / Restore** capabilities.

### 🔹 Unit 3 — Ask Desk Phase 1: Data-Aware Read-Only Assistant
- **Problem**: Students needed fast, grounded answers about their day without digging through menus.
- **Solution**:
  - Built an in-desk read-only NLP assistant matching patterns for:
    - Focus of the day & class schedule
    - Safe-to-skip attendance calculations
    - High-priority & overdue tasks
    - Exam countdowns & notice highlights
  - Zero hallucinations: strictly grounded in live `localStorage` data.

### 🔹 Unit 4 — Ask Desk Phase 2: Safe Guided Actions
- **Problem**: Conversational assistants often risk destructive autonomous writes or confusing UX loops.
- **Solution**:
  - Ask Desk provides **Guided Action Buttons** (`Open Setup →`, `Add Task →`, `View Preview →`) that open existing UI flows.
  - Enforces zero direct writes from chat: the assistant routes into the standard modal review flows.
  - Honest missing-data states: guides students to configure baselines or import schedules when data is unavailable.

### 🔹 Unit 5 — Parser Reliability for Attendance & Timetable Imports
- **Problem**: Camera OCR scans produced digit errors (e.g., `8` read as `B`, `0` read as `O`), noisy teacher tokens, and misaligned grids.
- **Solution**:
  - Preprocessing and token cleanup: alphanumeric balance solver ensures `Present <= Total`.
  - 2D grid reconstructor with coordinate alignment for timetable timetables.
  - Explicit uncertainty highlighting (`⚠️ Needs Review`) for low-confidence cells.
  - Editable review tables prior to saving (zero silent imports).

### 🔹 Final Polish Pass — Product Trust, Empty States & Consistency
- **Problem**: Inconsistent terminology (mixing "Tasks" and "Assignments") and generic empty states.
- **Solution**:
  - Standardized all terminology to **Tasks & Deadlines**.
  - Upgraded empty states across Dashboard, Timetable, Subject Hubs, Tasks, and Vault with actionable next steps.
  - Replaced misleading `0%` attendance representations with honest `Attendance not configured` states.

---

## 4. Gap Fixes (Units 1–5 of Gap Fix Board)

### 1. Theme Flash on Reload
- **Root Cause**: The inline `<head>` bootstrap script contained outdated theme names (`midnight-ink`, etc.), causing fallback resets before `app.js` loaded.
- **Fix**: Synchronized `<head>` script and `LEGACY_THEME_MAP` across all 6 production themes:
  `paper-slate`, `midnight-ink`, `espresso-desk`, `sandstone-notes`, `nordic-frost`, `misty-mint`.
- **Result**: Zero theme flash on hard refreshes.

### 2. Mobile Access to Subject Hubs
- **Root Cause**: On mobile screens, the desktop sidebar was hidden, leaving no direct 1-tap route to Subject Hubs in bottom navigation.
- **Fix**: Added a dedicated `Subjects` tab to `<nav class="bottom-nav">` with standard book SVG icon and `data-nav="subjects"`.
- **Result**: Immediate 1-tap mobile reachability for course baselines, slots, and quick logs.

### 3. Single Subject Hub Empty-State Add-Link Action
- **Root Cause**: Opening an individual Subject Hub with 0 links forced students to leave the hub and navigate to Study Vault to add materials.
- **Fix**: Added `+ Add Study Link / Note` action inside the hub empty state with `openAddResourceForSubject(subjectName, subjectCode)` prefilling course context.
- **Result**: Single Subject Hub acts as a self-contained course workspace.

### 4. First-Run Setup Checklist & Onboarding Order
- **Root Cause**: Brand-new users landed on an empty dashboard without a unified explanation of recommended setup sequence.
- **Fix**: Added an inline 3-step checklist:
  1. **Set Practical Batch & Profile** (`navigateTo('settings')`)
  2. **Import Timetable Schedule** (`navigateTo('timetable')`)
  3. **Set Attendance Starting Counts** (`showBaselineModal(null, 'manual')`)
- **Result**: Dynamic step tracking that disappears completely once setup is finished (`isFullySetup === true`).

### 5. Local/Offline Save Status Clarity
- **Root Cause**: The lone cloud icon in the topbar created ambiguity about whether data was being saved offline.
- **Fix**: Upgraded topbar indicator to a clear status pill: `[🟢 💾 Saved locally]` (collapsing to `[🟢 💾]` on small viewports with full tooltips).
- **Result**: Immediate student trust that data is safely preserved on-device.

---

## 5. Storage Schema & Keys Reference

| Key Constant | Storage Key Name | Description |
| :--- | :--- | :--- |
| `KEY_ATTENDANCE_BASELINE` | `cos_attendance_baseline` | Map of course code $\rightarrow$ baseline counts `{ present, totalCount, absent, lastUpdated }` |
| `KEY_ATTENDANCE` | `cos_attendance_records` | Historical daily log `{ "YYYY-MM-DD": { "CS201_1000": "attended" } }` |
| `KEY_ATTENDANCE_TARGET` | `cos_attendance_target` | Numerical target threshold (e.g. `75`, `80`, `85`) |
| `KEY_CUSTOM_TIMETABLE` | `cos_custom_timetable` | Day-indexed schedule map `{ 0: [], 1: [...slots], ... 6: [] }` |
| `KEY_PROFILE` | `cos_profile` | User profile `{ name, roll, batch, semester, branch, examDate }` |
| `KEY_TASKS` | `cos_custom_assignments`| Array of tasks `{ id, title, subject, dueDate, priority, status, taskType }` |
| `KEY_CUSTOM_LINKS` | `cos_custom_links` | Subject vault items `{ subject, code, color, resources: [...] }` |
| `KEY_BACKUP_SNAPSHOTS` | `cos_backup_snapshots` | Array of rollback snapshots for instant undo/restore |
| `KEY_THEME` | `cos_theme` | Current theme key (e.g. `paper-slate`, `midnight-ink`, etc.) |

---

## 6. How to Run Automated Verification

All verification suites are ESM Node.js scripts. Run them from the project root:

```bash
# Run Master Codebase Regression Suite (14 Core Scenarios)
node tests/verify_master.mjs

# Run Gap Fix Board Suite (5 Scenarios)
node tests/verify_gap_fixes.mjs
```

---

## 7. Visual Identity & Dual-Theme Redesign (The Quiet Study Desk)

### 🔹 Design Direction & Folio Monogram
- **Philosophy:** Quiet Cafe Editorial / Academic Stationery. Transitioned from a generic dashboard into a high-craft academic study desk.
- **Folio Monogram Vector Logo:**
  - Archival 'C' arc with precision desk horizon rule and center focus node.
  - SVG vector in `index.html` and `favicon.svg` with compensated stroke weights (`2.8px–3.2px`).

### 🔹 Palette & Token Specifications
- **Clarity Light (`paper-slate`):**
  - Base: `#F6F1E8`, Surface: `#FFFDFC`, Subtle/Well: `#ECE4D7`, Ink: `#2A241F`, Secondary: `#5E5449`, Pine: `#2F4A3D`, Amber: `#B48852`.
- **Clarity Dark (`midnight-ink` & `espresso-desk`):**
  - Base: `#171412`, Surface: `#221D19`, Subtle/Well: `#2B241F`, Bone: `#F3ECE3`, Secondary: `#C8BEB1`, Sage: `#7E9C8D`, Caramel: `#D2A56B`.
- **Geometry & Control Radii:**
  - Base card/input radius: `14px`
  - Button radius: `12px` (Curved rectangle controls)
  - Hairline dividers: `--border-rule: #D8CCBD` (Light) / `--border-rule: #3A312A` (Dark).

### 🔹 Accessibility & State Parity
- **Measured WCAG Contrast:** Body Text: `13.62:1` (Light) / `15.65:1` (Dark) — Exceeds WCAG AAA.
- **Pre-Paint Theme Hydration:** Synchronous `<head>` script inspects `localStorage` and falls back automatically to system `window.matchMedia('(prefers-color-scheme: dark)')` with no noticeable flash during normal reload and navigation.
- **Multi-Surface Icon Coverage:** `manifest.json` includes `192×192` and `512×512` PNG app icons, and `apple-touch-icon.png` uses a solid background with no transparency.

---

*This document is the definitive source of truth for the Clarity Desk codebase. All future enhancements should respect the local-first, zero-silent-write, and calm UX foundations established here.*
