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
    KEY_ATTENDANCE
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
