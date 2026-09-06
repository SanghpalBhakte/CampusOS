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
    value: '',
    querySelector: () => null
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
    reconstructTimetable2DGrid
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
console.log('🏆 VERIFICATION: STAGE 2B NON-"+" MULTILINE CELL SPLIT (line fallback)');
console.log('==================================================================\n');

check('1. Two distinct parallel sessions stacked as two lines, no "+" separator: splits into 2 rows, both flagged uncertain', () => {
  const ocrData = {
    words: [
      w('Mon', 20, 100, 60, 130, 95),
      w('10:00 - 11:00', 150, 30, 280, 60, 95),
      // Line 1
      w('Database', 130, 100, 210, 120, 90), w('Systems', 215, 100, 290, 120, 90),
      // Line 2 (no '+' between them)
      w('Web', 130, 125, 180, 145, 90), w('Development', 185, 125, 290, 145, 90)
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 2) return `expected 2 split entries, got ${res.schedule.length}: ${JSON.stringify(res.schedule.map(s => s.subject))}`;
  const subjects = res.schedule.map(s => s.subject).sort();
  if (subjects[0] !== 'Database Systems' || subjects[1] !== 'Web Development') {
    return `expected ['Database Systems','Web Development'], got ${JSON.stringify(subjects)}`;
  }
  if (!res.schedule.every(s => s.isUncertain)) return `expected both line-split rows flagged isUncertain, got ${JSON.stringify(res.schedule.map(s => s.isUncertain))}`;
  return true;
});

check('2. Subject label + teacher-name line (no "+"): must NOT split, teacher-only line is the "General Subject" sentinel not a real second session', () => {
  const ocrData = {
    words: [
      w('Tue', 20, 100, 60, 130, 95),
      w('09:00 - 10:00', 150, 30, 280, 60, 95),
      // Line 1: subject
      w('Data', 130, 100, 175, 120, 90), w('Structures', 180, 100, 260, 120, 90),
      // Line 2: teacher only
      w('Prof.', 130, 125, 170, 145, 90), w('Sharma', 175, 125, 230, 145, 90)
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 1) return `expected 1 merged entry, got ${res.schedule.length}: ${JSON.stringify(res.schedule.map(s => s.subject))}`;
  const c = res.schedule[0];
  if (c.subject !== 'Data Structures') return `subject polluted: '${c.subject}'`;
  if (!c.teacher.includes('Sharma')) return `teacher missing: '${c.teacher}'`;
  return true;
});

check('3. Unresolved code residue on one line + a confident subject on the other: must NOT split, falls back safely', () => {
  const ocrData = {
    words: [
      w('Wed', 20, 100, 60, 130, 95),
      w('11:00 - 12:00', 150, 30, 280, 60, 95),
      // Line 1: raw unresolved code (no existingSubjects to match against) --
      // a bare, never-mapped abbreviation, deliberately NOT using the
      // "AI-<batch>" suffix shape, since that shape is now correctly
      // resolved (Stage 11 fixed a real bug where it stayed unresolved).
      w('XQZ', 130, 100, 220, 120, 90),
      // Line 2: a confidently-resolvable subject
      w('Web', 130, 125, 180, 145, 90), w('Development', 185, 125, 290, 145, 90)
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (res.schedule.length !== 1) return `expected 1 merged entry (declined split), got ${res.schedule.length}: ${JSON.stringify(res.schedule.map(s => s.subject))}`;
  return true;
});

console.log('\n========================================');
console.log(`TOTAL SCENARIOS CHECKED: ${total}`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${total - passed}`);
console.log('========================================');

if (errors.length > 0) {
  console.error('\n❌ FAILURES:');
  errors.forEach(e => console.error(`  - ${e.name}: ${e.error}`));
  process.exit(1);
} else {
  console.log('🏆 ALL MULTILINE SPLIT TESTS PASSED! 🚀');
}
