import fs from 'fs';

// Stage 13: the Timetable tab's "N classes on <Day>" header counted Recess
// (and any other break/off period) as if it were a real class, because
// renderTimetable() built that count from the raw per-day array
// (liveTT[day] || []) instead of filtering out non-teaching entries the
// way every other class-count in the app already does via isBreakEntry()/
// isTeachingClass() (see getDayClasses(), getTodayRemainingClasses(),
// answerTodaySummary(), etc. -- renderTimetable() was the one outlier).
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

const domCache = {};
function domStub(id) {
  if (!domCache[id]) {
    domCache[id] = {
      id, style: {}, classList: { add: () => {}, remove: () => {} },
      appendChild: () => {}, remove: () => {}, focus: () => {},
      value: '', textContent: '', innerHTML: '', querySelector: () => null
    };
  }
  return domCache[id];
}

globalThis.document = {
  getElementById: (id) => domStub(id),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => ({
    tagName: tag, style: {}, classList: { add: () => {}, remove: () => {} },
    appendChild: () => {}, remove: () => {}, addEventListener: () => {}, removeEventListener: () => {}
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
    state,
    renderTimetable,
    saveTimetable,
    isBreakEntry,
    isTeachingClass
  };
`;

function createSandbox() {
  return new Function(sandboxCode)();
}

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
    console.error(`✗ [ERROR] ${name}: ${err.stack || err}`);
    errors.push({ name, error: err.message });
  }
}

console.log('==================================================================');
console.log('🏆 VERIFICATION: TIMETABLE TAB RECESS-COUNTED-AS-CLASS FIX (Stage 13)');
console.log('==================================================================\n');

check('A1. A day with 3 real classes + 1 Recess shows "3 classes", not "4 classes"', () => {
  const mod = createSandbox();
  mod.state.ttDay = 1; // Monday
  mod.saveTimetable({
    0: [], 2: [], 3: [], 4: [], 5: [], 6: [],
    1: [
      { subject: 'Data Structures', code: 'DS', type: 'lecture', time: '09:00', end: '10:00', room: 'A1' },
      { subject: 'Recess', code: '', type: 'off', time: '10:00', end: '10:20', room: '' },
      { subject: 'Digital Electronics', code: 'DEMP', type: 'lecture', time: '10:20', end: '11:20', room: 'A1' },
      { subject: 'Web Development', code: 'WD', type: 'lab', time: '11:20', end: '13:20', room: 'Lab-2' }
    ]
  });
  mod.renderTimetable();
  const html = domCache['page-timetable']?.innerHTML || '';
  if (!html) return 'renderTimetable did not write into #page-timetable';
  if (!/3 classes on Monday/.test(html)) {
    const m = html.match(/(\d+) classe?s? on Monday/);
    return `expected "3 classes on Monday", got "${m ? m[0] : '(no match found in rendered HTML)'}"`;
  }
  if (/4 classes on Monday/.test(html)) return 'still showing the inflated "4 classes" count that includes Recess';
  return true;
});

check('A2. The Recess row itself is still shown in the schedule list (not hidden, just not counted)', () => {
  const mod = createSandbox();
  mod.state.ttDay = 1;
  mod.saveTimetable({
    0: [], 2: [], 3: [], 4: [], 5: [], 6: [],
    1: [
      { subject: 'Data Structures', code: 'DS', type: 'lecture', time: '09:00', end: '10:00', room: 'A1' },
      { subject: 'Recess', code: '', type: 'off', time: '10:00', end: '10:20', room: '' }
    ]
  });
  mod.renderTimetable();
  const html = domCache['page-timetable']?.innerHTML || '';
  if (!/Recess/.test(html)) return 'expected the Recess entry to still appear in the rendered timetable list';
  return true;
});

check('A3. A lunch-break entry (different wording, same non-teaching meaning) is also excluded from the count', () => {
  const mod = createSandbox();
  mod.state.ttDay = 2; // Tuesday
  mod.saveTimetable({
    0: [], 1: [], 3: [], 4: [], 5: [], 6: [],
    2: [
      { subject: 'Data Structures', code: 'DS', type: 'lecture', time: '09:00', end: '10:00', room: 'A1' },
      { subject: 'Lunch Break', code: '', type: 'off', time: '13:00', end: '14:00', room: '' },
      { subject: 'Web Development', code: 'WD', type: 'lecture', time: '14:00', end: '15:00', room: 'A1' }
    ]
  });
  mod.renderTimetable();
  const html = domCache['page-timetable']?.innerHTML || '';
  if (!/2 classes on Tuesday/.test(html)) {
    const m = html.match(/(\d+) classe?s? on Tuesday/);
    return `expected "2 classes on Tuesday", got "${m ? m[0] : '(no match found)'}"`;
  }
  return true;
});

check('A4. A day with zero real classes (only a Recess slot) is unaffected in the empty-state gate -- classes.length still gates the "No Classes" empty state, only the visible count text is corrected', () => {
  const mod = createSandbox();
  mod.state.ttDay = 3; // Wednesday
  mod.saveTimetable({
    0: [], 1: [], 2: [], 4: [], 5: [], 6: [],
    3: [{ subject: 'Recess', code: '', type: 'off', time: '10:00', end: '10:20', room: '' }]
  });
  mod.renderTimetable();
  const html = domCache['page-timetable']?.innerHTML || '';
  if (!/0 classes on Wednesday/.test(html)) {
    const m = html.match(/(\d+) classe?s? on Wednesday/);
    return `expected "0 classes on Wednesday", got "${m ? m[0] : '(no match found)'}"`;
  }
  return true;
});

console.log('\n========================================');
console.log(`TOTAL SCENARIOS CHECKED: ${total}`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${errors.length}`);
console.log('========================================');

if (errors.length > 0) {
  console.error('\n❌ FAILURES:');
  errors.forEach(e => console.error(`  - ${e.name}: ${e.error}`));
  process.exit(1);
} else {
  console.log('🏆 ALL TIMETABLE RECESS-COUNT TESTS PASSED! 🚀\n');
}
