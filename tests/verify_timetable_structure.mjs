import fs from 'fs';

// Mock browser environment (same pattern as the other tests/*.mjs files)
const appSrc = fs.readFileSync('D:/Clarity Desk/app.js', 'utf8');

const localStorageData = {};
globalThis.localStorage = {
  getItem: (k) => localStorageData[k] !== undefined ? localStorageData[k] : null,
  setItem: (k, v) => { localStorageData[k] = String(v); },
  removeItem: (k) => { delete localStorageData[k]; },
  clear: () => { Object.keys(localStorageData).forEach(k => delete localStorageData[k]); }
};

globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.window = globalThis;

globalThis.document = {
  getElementById: (id) => ({
    id,
    style: {},
    classList: { add: () => {}, remove: () => {} },
    appendChild: () => {},
    remove: () => {},
    focus: () => {},
    value: ''
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => ({
    tagName: tag,
    style: {},
    classList: { add: () => {}, remove: () => {} },
    appendChild: () => {},
    remove: () => {},
    addEventListener: () => {},
    removeEventListener: () => {}
  }),
  body: { appendChild: () => {} }
};

let codeToRun = appSrc.replace(/import\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?/g, `
  const STUDENT = { name: 'Test Student', batch: 'A1', roll: '101' };
  const TIMETABLE = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };
  const EMPTY_TIMETABLE = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };
  const ASSIGNMENTS = [];
  const NOTICES = [];
  const QUICK_LINKS = [];
`);

const sandboxCode = `
  ${codeToRun}

  return {
    reconstructTimetable2DGrid,
    showTimetablePreviewModal,
    confirmSaveExtractedTimetable,
    loadTimetable,
    safeSetStorage,
    KEY_CUSTOM_TIMETABLE,
    liveProfile
  };
`;

const mod = new Function(sandboxCode)();

let passed = 0;
let total = 0;
const errors = [];

function check(name, testFn) {
  total++;
  try {
    const res = testFn();
    if (res === true || res === undefined) {
      console.log(`✓ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`✗ [FAIL] ${name}: ${res}`);
      errors.push({ name, error: res });
    }
  } catch (e) {
    console.error(`✗ [ERROR] ${name}: ${e.stack || e}`);
    errors.push({ name, error: e.message });
  }
}

function w(text, x0, y0, x1, y1, conf = 90) {
  return { text, bbox: { x0, y0, x1, y1 }, confidence: conf };
}

console.log('==================================================================');
console.log('🏆 VERIFICATION: STAGE 2A STRUCTURE-AWARE TIMETABLE PARSING');
console.log('==================================================================\n');

check('1. Single-cell regression: the original verify_master.mjs 4B fixture is unchanged', () => {
  const ocrData = {
    words: [
      { text: 'Thursday', bbox: { x0: 20, y0: 100, x1: 90, y1: 130 }, confidence: 95 },
      { text: '10:00 - 11:00', bbox: { x0: 150, y0: 30, x1: 250, y1: 60 }, confidence: 95 },
      { text: 'Deep', bbox: { x0: 150, y0: 100, x1: 190, y1: 120 }, confidence: 90 },
      { text: 'Learning', bbox: { x0: 195, y0: 100, x1: 260, y1: 120 }, confidence: 90 },
      { text: 'Prof.', bbox: { x0: 150, y0: 125, x1: 180, y1: 140 }, confidence: 90 },
      { text: 'Verma', bbox: { x0: 185, y0: 125, x1: 235, y1: 140 }, confidence: 90 },
      { text: 'LH-301', bbox: { x0: 150, y0: 145, x1: 200, y1: 160 }, confidence: 90 }
    ]
  };
  const gridRes = mod.reconstructTimetable2DGrid(ocrData, []);
  if (!gridRes.schedule || gridRes.schedule.length !== 1) return `expected 1 entry, got ${gridRes.schedule?.length}`;
  const c = gridRes.schedule[0];
  if (c.subject !== 'Deep Learning') return `subject polluted: '${c.subject}'`;
  if (!c.teacher.includes('Verma')) return `teacher missing: '${c.teacher}'`;
  if (c.room !== 'LH-301') return `room mismatch: '${c.room}'`;
  if (c.durationInSlots !== 1) return `expected durationInSlots 1, got ${c.durationInSlots}`;
  return true;
});

check('2. Layout A: 2-hour lab spanning two adjacent time columns becomes ONE row with correct end/duration', () => {
  const ocrData = {
    words: [
      w('Thu', 20, 100, 60, 130, 95), w('10:00', 150, 30, 190, 60, 95), w('11:00', 250, 30, 290, 60, 95),
      w('AI', 130, 100, 160, 120), w('Lab', 165, 100, 210, 120), w('Practical', 215, 100, 280, 120), w('Session', 285, 100, 340, 120),
      w('Prof.', 130, 125, 170, 140), w('Rao', 175, 125, 210, 140),
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 1) return `expected 1 merged entry, got ${res.schedule.length}: ${JSON.stringify(res.schedule.map(s => s.subject))}`;
  const c = res.schedule[0];
  if (c.time !== '10:00' || c.end !== '12:00') return `expected 10:00-12:00, got ${c.time}-${c.end}`;
  if (c.durationInSlots !== 2 || c.startSlot !== 0 || c.endSlot !== 1) return `expected durationInSlots 2 (slots 0-1), got ${JSON.stringify({ durationInSlots: c.durationInSlots, startSlot: c.startSlot, endSlot: c.endSlot })}`;
  return true;
});

check('3. Layout A: a grouped multi-batch cell (real production-style "+" text) splits into multiple entries, each with its own batch, flagged for review', () => {
  const ocrData = {
    words: [
      w('Mon', 20, 100, 60, 130, 95), w('10:00 - 11:00', 150, 30, 280, 60, 95),
      w('DS-AI-A2', 150, 100, 210, 120), w('(VJM)', 213, 100, 250, 120), w('+', 253, 100, 260, 120),
      w('DEMP-AI-C2', 263, 100, 320, 120), w('(VAK)', 323, 100, 360, 120),
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 2) return `expected 2 split entries, got ${res.schedule.length}: ${JSON.stringify(res.schedule.map(s => s.subject))}`;
  const [a, b] = res.schedule;
  if (!(a.batches.includes('A2') && b.batches.includes('C2'))) {
    return `expected distinct per-fragment batches A2/C2, got ${JSON.stringify(a.batches)} / ${JSON.stringify(b.batches)}`;
  }
  if (a.subject === b.subject) return `both fragments resolved to the identical subject '${a.subject}' -- the split did not separate identity as intended`;
  if (!a.isUncertain || !b.isUncertain) return `expected both unresolved-code fragments to be flagged isUncertain, got ${a.isUncertain} / ${b.isUncertain}`;
  return true;
});

check('4. Precision guard: a short code that legitimately resolves via the canonical subject map is trusted, not falsely flagged uncertain', () => {
  const ocrData = {
    words: [w('Fri', 20, 100, 60, 130, 95), w('09:00 - 10:00', 150, 30, 280, 60, 95), w('AI', 150, 100, 180, 120)]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 1) return `expected 1 entry, got ${res.schedule.length}`;
  const c = res.schedule[0];
  if (c.subject !== 'Artificial Intelligence') return `expected canonical resolution to 'Artificial Intelligence', got '${c.subject}'`;
  if (c.isUncertain) return `a cleanly-resolved standalone subject should not be flagged uncertain`;
  return true;
});

check('5. Layout B: basic single-cell case reconstructs correctly (days-as-columns, times-as-rows)', () => {
  const ocrData = {
    words: [
      w('Mon', 80, 40, 120, 60, 95), w('Tue', 300, 40, 340, 60, 95), w('10:00', 10, 140, 50, 160, 95), w('11:00', 10, 240, 50, 260, 95),
      w('Deep', 60, 120, 100, 140), w('Learning', 105, 120, 160, 140), w('Prof.', 60, 145, 90, 160), w('Verma', 95, 145, 140, 160), w('LH-301', 60, 165, 110, 180),
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 1) return `expected 1 entry, got ${res.schedule.length}`;
  const c = res.schedule[0];
  if (c.day !== 'Mon' || c.subject !== 'Deep Learning' || c.room !== 'LH-301') return `unexpected result: ${JSON.stringify(c)}`;
  if (c.durationInSlots !== 1) return `expected durationInSlots 1, got ${c.durationInSlots}`;
  return true;
});

check('6. Layout B: 2-hour lab spanning two adjacent time rows becomes ONE row with correct end/duration', () => {
  const ocrData = {
    words: [
      w('Mon', 80, 40, 120, 60, 95), w('Tue', 300, 40, 340, 60, 95), w('10:00', 10, 140, 50, 160, 95), w('11:00', 10, 240, 50, 260, 95),
      w('AI', 60, 130, 90, 150), w('Lab', 95, 155, 125, 175), w('Prof.', 60, 205, 100, 225), w('Rao', 105, 230, 140, 250),
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 1) return `expected 1 merged entry, got ${res.schedule.length}: ${JSON.stringify(res.schedule.map(s => s.subject))}`;
  const c = res.schedule[0];
  if (c.time !== '10:00' || c.end !== '12:00') return `expected 10:00-12:00, got ${c.time}-${c.end}`;
  if (c.durationInSlots !== 2) return `expected durationInSlots 2, got ${c.durationInSlots}`;
  // Note: this fixture's span coverage is intentionally close to the
  // borderline threshold on one axis, so isUncertain may legitimately be
  // true here -- the structural correctness (duration/end) is this check's
  // point, not the confidence flag, so it is deliberately not asserted.
  return true;
});

check('7. Cropped/insufficient-header image (no day tokens at all) still falls through safely, no fabricated rows', () => {
  const ocrData = {
    words: [w('10:00', 150, 30, 190, 60, 95), w('Deep', 150, 100, 190, 120), w('Learning', 195, 100, 260, 120)]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 0) return `expected no rows fabricated from a headerless image, got ${res.schedule.length}`;
  if (!res.ambiguous) return `expected ambiguous:true for an insufficient-header image`;
  return true;
});

check('8. Empty OCR payload returns cleanly (no crash, no fabricated rows)', () => {
  const res = mod.reconstructTimetable2DGrid({ words: [] }, []);
  if (res.schedule.length !== 0 || !res.ambiguous) return `expected empty/ambiguous result for empty OCR input`;
  return true;
});

check('9. confirmSaveExtractedTimetable now persists extracted batches into the saved timetable entry', () => {
  localStorage.clear();
  mod.liveProfile.batch = 'all';
  const schedule = [
    { day: 'Mon', time: '10:00', end: '11:00', subject: 'Data Structures', code: 'DS', room: 'SF-31', teacher: 'Prof. VJM', type: 'lecture', batches: ['A2'], isUncertain: false }
  ];
  mod.showTimetablePreviewModal(schedule);
  mod.confirmSaveExtractedTimetable();
  const saved = mod.loadTimetable();
  const entry = (saved[1] || [])[0];
  if (!entry) return `no timetable entry was saved`;
  if (!Array.isArray(entry.batches) || !entry.batches.includes('A2')) {
    return `expected saved entry to carry batches ['A2'], got ${JSON.stringify(entry.batches)}`;
  }
  return true;
});

console.log('\n========================================');
console.log(`TOTAL SCENARIOS CHECKED: ${total}`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${errors.length}`);
console.log('========================================');

if (errors.length > 0) {
  process.exit(1);
} else {
  console.log('🏆 ALL STAGE 2A TIMETABLE STRUCTURE TESTS PASSED! 🚀\n');
}
