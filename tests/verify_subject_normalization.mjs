import fs from 'fs';

const appSrc = fs.readFileSync('D:/Clarity Desk/app.js', 'utf8');
const cssSrc = fs.readFileSync('D:/Clarity Desk/style.css', 'utf8');

// Mock browser environment
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
    focus: () => {}
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
    getCanonicalSubjectName,
    getCanonicalSubjectKey,
    getCanonicalSubjectCode,
    getSubjectList,
    getSubjectAttendance,
    loadTimetable,
    safeSetStorage,
    KEY_CUSTOM_TIMETABLE,
    KEY_ATTENDANCE,
    normalizeSubjectIdentity,
    extractBatchTags,
    generateDeclutterPlan,
    saveAttendanceBaselines,
    KEY_ATTENDANCE_BASELINE
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
  } catch (err) {
    console.error(`✗ [FAIL] ${name}: ${err.message}`);
    errors.push({ name, error: err.message });
  }
}

console.log('==================================================================');
console.log('🏆 VERIFICATION: READABILITY, ADD-TASK ALIGNMENT & SUBJECT NORMALIZATION');
console.log('==================================================================\n');

// ── TEST 1: CSS SOLID SURFACES & OPACITY ────────────────────────
check('1. Modal surfaces are solid and define --modal-bg in Paper Slate & Midnight Ink', () => {
  if (!cssSrc.includes('--modal-bg: var(--color-surface);')) {
    return 'Missing --modal-bg definition in CSS layers';
  }
  if (!cssSrc.includes('background: var(--modal-bg, var(--color-surface, #fffdfc));')) {
    return 'Modal does not use solid fallback background';
  }
  return true;
});

check('2. Form row has responsive layout breakpoint for mobile screens', () => {
  if (!cssSrc.includes('.form-label-row')) {
    return 'Missing .form-label-row utility in CSS';
  }
  if (!cssSrc.includes('.checkbox-inline')) {
    return 'Missing .checkbox-inline utility in CSS';
  }
  if (!cssSrc.includes('@media (max-width: 540px)')) {
    return 'Missing mobile breakpoint in CSS';
  }
  return true;
});

// ── TEST 2: CANONICAL SUBJECT NORMALIZATION ─────────────────────
check('3. Canonical subject mapping removes batch and clutter suffixes', () => {
  const tests = [
    { input: 'Web Dev - A2', expected: 'Web Development' },
    { input: 'Web Dev - Theory', expected: 'Web Development' },
    { input: 'Web Dev Lab B1', expected: 'Web Development' },
    { input: 'DEMP - C2', expected: 'Digital Electronics and Microprocessors' },
    { input: 'DEMP', expected: 'Digital Electronics and Microprocessors' },
    { input: 'Data Structures (AI-A2)', expected: 'Data Structures' },
    { input: 'Data Structures Lab - A2', expected: 'Data Structures' },
    { input: 'PBST Lab - D1', expected: 'Probability and Statistics' }
  ];

  for (const t of tests) {
    const res = mod.getCanonicalSubjectName(t.input);
    if (res !== t.expected) {
      return `Expected "${t.input}" -> "${t.expected}", got "${res}"`;
    }
  }
  return true;
});

check('4. Timetable slots for the same course combine into a single Subject Hub', () => {
  localStorage.clear();
  const tt = {
    1: [
      { time: '10:00', end: '12:00', subject: 'Web Dev - A2', type: 'lab', batches: ['A2'], room: 'Lab-3', teacher: 'Prof. Roy' },
      { time: '12:00', end: '13:00', subject: 'Web Dev - Theory', type: 'lecture', room: 'Room-204', teacher: 'Prof. Roy' },
      { time: '14:00', end: '16:00', subject: 'DEMP - C2', type: 'lab', batches: ['C2'], room: 'Lab-1' },
      { time: '09:00', end: '10:00', subject: 'DEMP', type: 'lecture', room: 'LT-1' }
    ]
  };
  mod.safeSetStorage(mod.KEY_CUSTOM_TIMETABLE, tt);
  const subjects = mod.getSubjectList();

  if (subjects.length !== 2) {
    return `Expected 2 canonical subjects (Web Dev and DEMP), got ${subjects.length}: ${subjects.map(s => s.name).join(', ')}`;
  }

  const webDev = subjects.find(s => s.name === 'Web Development');
  if (!webDev) return 'Web Development subject not found';
  if (webDev.slots.length !== 2) return `Expected 2 slots in Web Development Hub, got ${webDev.slots.length}`;

  const demp = subjects.find(s => s.name === 'Digital Electronics and Microprocessors');
  if (!demp) return 'DEMP subject not found';
  if (demp.slots.length !== 2) return `Expected 2 slots in DEMP Hub, got ${demp.slots.length}`;

  return true;
});

check('5. Attendance tracking matches both canonical names and specific timetable slot keys', () => {
  const subjects = mod.getSubjectList();
  const webDev = subjects.find(s => s.name === 'Web Development');

  // Log attendance for the lab slot specifically
  const dailyLogs = {
    '2026-08-25': {
      'WebDev-A2_10:00': 'attended',
      'WebDev-Theory_12:00': 'attended'
    }
  };
  mod.safeSetStorage(mod.KEY_ATTENDANCE, dailyLogs);

  const att = mod.getSubjectAttendance(webDev);
  if (att.dailyAttended !== 2) {
    return `Expected 2 daily attended classes counted, got ${att.dailyAttended}`;
  }
  return true;
});

// ── STAGE 1: PARSER RELIABILITY (bounded fuzzy matching + BATCH_PATTERN) ──
check('6. Fuzzy matching merges a small OCR/typo variant of an existing custom subject', () => {
  const existing = [{ name: 'Software Engineering', code: 'SE', type: 'lecture' }];
  // Missing one 'e' in "Engineering" -- a plausible single-character OCR drop,
  // not present in the hardcoded CANONICAL_SUBJECT_MAP.
  const norm = mod.normalizeSubjectIdentity('Software Enginering', existing);
  if (norm.canonicalName !== 'Software Engineering') {
    return `Expected fuzzy merge to "Software Engineering", got "${norm.canonicalName}"`;
  }
  if (norm.normalization_confidence !== 82) {
    return `Expected fuzzy-match confidence of 82, got ${norm.normalization_confidence}`;
  }
  return true;
});

check('7. Genuinely different subjects sharing a prefix do NOT get merged (false negatives preferred)', () => {
  const existing = [{ name: 'Data Structures', code: 'DS', type: 'lecture' }];
  const norm = mod.normalizeSubjectIdentity('Data Science', existing);
  if (norm.canonicalName === 'Data Structures') {
    return `"Data Science" was incorrectly merged into "Data Structures"`;
  }
  return true;
});

check('8. Short subject names/codes like "C" are not stripped as batch tags', () => {
  const tags = mod.extractBatchTags('C Programming Lab - A2');
  if (!tags.includes('A2')) return `Expected A2 to be detected as a batch tag, got: ${JSON.stringify(tags)}`;
  if (tags.includes('C')) return `"C" (a subject-name letter, no batch keyword nearby) was incorrectly treated as a batch tag: ${JSON.stringify(tags)}`;
  return true;
});

check('9. Bare batch codes like "A2" outside brackets are still detected (regression guard)', () => {
  const tags = mod.extractBatchTags('DS-AI-A2 (VJM)');
  if (!tags.includes('A2')) return `Expected A2 to still be detected without a Batch/Sec keyword, got: ${JSON.stringify(tags)}`;
  return true;
});

check('10. Baseline-first-then-timetable-second: OCR variant reconciles against an already-established subject', () => {
  localStorage.clear();
  // Attendance baseline scanned & saved FIRST, establishing the canonical spelling.
  mod.saveAttendanceBaselines({
    'BMFA': { subjectCode: 'BMFA', subjectName: 'Business Management and Financial Accounting', present: 10, absent: 2, leave: 0, notEntered: 0, totalSessions: 0, updatedAt: new Date().toISOString() }
  });
  const existingSubjects = mod.getSubjectList();
  const bmfa = existingSubjects.find(s => s.name === 'Business Management and Financial Accounting');
  if (!bmfa) return `Expected baseline-derived subject to exist first, got: ${existingSubjects.map(s => s.name).join(', ')}`;

  // A later timetable scan produces a slightly-garbled variant (dropped "and").
  const norm = mod.normalizeSubjectIdentity('Business Management Financial Accounting', existingSubjects);
  if (norm.canonicalName !== 'Business Management and Financial Accounting') {
    return `Expected reconciliation to the existing baseline subject, got "${norm.canonicalName}"`;
  }
  return true;
});

check('11. Declutter plan reconciles an OCR-variant timetable slot against an existing subject', () => {
  localStorage.clear();
  const tt = {
    1: [
      { time: '10:00', end: '11:00', subject: 'Digital Electronics and Microprocessors', code: 'DEMP', type: 'lecture', room: 'SF-31', teacher: 'Prof. VAK' },
      { time: '13:00', end: '14:00', subject: 'Digital Electronic and Microprocesor', code: '', type: 'lecture', room: 'SF-31', teacher: '' }
    ],
    2: [], 3: [], 4: [], 5: [], 6: [], 0: []
  };
  mod.safeSetStorage(mod.KEY_CUSTOM_TIMETABLE, tt);
  const plan = mod.generateDeclutterPlan(tt, {}, [], 'all');
  if (plan.survivingSubjects.length !== 1) {
    return `Expected both slots to merge into 1 surviving subject, got ${plan.survivingSubjects.length}: ${plan.survivingSubjects.map(s => s.name).join(', ')}`;
  }
  if (plan.survivingSubjects[0].slotsCount !== 2) {
    return `Expected merged subject to carry both slots, got slotsCount ${plan.survivingSubjects[0].slotsCount}`;
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
  console.log('🏆 ALL SUBJECT NORMALIZATION & READABILITY TESTS PASSED! 🚀\n');
}
