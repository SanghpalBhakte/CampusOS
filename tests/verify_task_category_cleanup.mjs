import fs from 'fs';

// Mock browser environment (same pattern as other verify_*.mjs files).
// Covers Stage 12: removing "General" vs "Other" duplicate-category
// clutter reported by the user across two screens --
//   (1) Subject Hub was showing "General" and "Other" as if they were
//       real academic subjects, because getSubjectList() blindly folded
//       in EVERY task's subject field (including the non-academic
//       'General'/'Mission' task-category buckets) as though it were a
//       subject. Subject Hub is supposed to show only subjects that came
//       from the timetable or were added manually (e.g. a Quick Links
//       "Subject Vault").
//   (2) The Assignments/Tasks page's per-subject filter chip row could
//       show a redundant 'GEN'/'General'/'Mission'/'MIS'/'OTH'/'Other'
//       chip alongside the Type filter's own 'General'/'Mission' chips
//       -- two different-looking controls for the exact same category.
//   (3) Root cause for the mismatched "General" vs "OTH" labels
//       specifically: sanitizeTask()'s code fallback re-checked the
//       ORIGINAL (pre-default) t.subject instead of the just-computed
//       normalized subject, so a task with a blank subject ended up as
//       subject:'General' but code:'OTH' -- two different labels for one
//       task.
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

// Cache DOM stubs by id (unlike the plain "fresh object every call" stub
// used elsewhere) so a page-render function's own internal
// document.getElementById(...) call and this test's later inspection of
// the same id see the SAME object -- needed to actually read back what
// renderAssignments() wrote into el.innerHTML.
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
    sanitizeTask,
    getSubjectList,
    renderAssignments,
    saveCustomLinks,
    loadCustomLinks
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
console.log('🏆 VERIFICATION: TASK/SUBJECT CATEGORY CLEANUP (Stage 12)');
console.log('==================================================================\n');

// ── PART A: sanitizeTask code/subject consistency ───────────────────

check('A1. A task with a blank subject normalizes to subject "General" AND code "GEN" (not a mismatched "OTH")', () => {
  const mod = createSandbox();
  const t = mod.sanitizeTask({ id: 't1', title: 'Some task' });
  if (t.subject !== 'General') return `expected subject 'General', got '${t.subject}'`;
  if (t.code !== 'GEN') return `expected code 'GEN' to match subject 'General', got '${t.code}'`;
  return true;
});

check('A2. A task explicitly subject:"Mission" with a blank code normalizes to code "MIS"', () => {
  const mod = createSandbox();
  const t = mod.sanitizeTask({ id: 't2', title: 'Long-term goal', subject: 'Mission' });
  if (t.code !== 'MIS') return `expected code 'MIS', got '${t.code}'`;
  return true;
});

check('A3. A task with a real, non-reserved subject and no code still falls back to "OTH" (unchanged, intentional -- only the mismatch case was the bug)', () => {
  const mod = createSandbox();
  const t = mod.sanitizeTask({ id: 't3', title: 'Something', subject: 'Quantum Foo' });
  if (t.subject !== 'Quantum Foo') return `expected subject preserved, got '${t.subject}'`;
  if (t.code !== 'OTH') return `expected fallback code 'OTH' for a genuinely uncoded custom subject, got '${t.code}'`;
  return true;
});

// ── PART B: getSubjectList excludes non-academic task categories ────

check('B1. A "General" task does not create a phantom "General" Subject Hub entry', () => {
  const mod = createSandbox();
  mod.state.customTasks = [{ id: 'g1', subject: 'General', code: 'GEN', title: 'Buy books', taskType: 'general', status: 'pending' }];
  const subjects = mod.getSubjectList();
  if (subjects.some(s => s.name === 'General')) return `Subject Hub should not contain a "General" entry, got ${JSON.stringify(subjects.map(s => s.name))}`;
  return true;
});

check('B2. A "Mission" task does not create a phantom "Mission" Subject Hub entry', () => {
  const mod = createSandbox();
  mod.state.customTasks = [{ id: 'm1', subject: 'Mission', code: 'MIS', title: 'Learn Rust', taskType: 'mission', status: 'pending', noDeadline: true }];
  const subjects = mod.getSubjectList();
  if (subjects.some(s => s.name === 'Mission')) return `Subject Hub should not contain a "Mission" entry, got ${JSON.stringify(subjects.map(s => s.name))}`;
  return true;
});

check('B3. A legacy task with subject "Other" does not create a phantom "Other" Subject Hub entry', () => {
  const mod = createSandbox();
  mod.state.customTasks = [{ id: 'o1', subject: 'Other', code: 'OTH', title: 'Misc reminder', taskType: 'assignment', status: 'pending' }];
  const subjects = mod.getSubjectList();
  if (subjects.some(s => s.name === 'Other')) return `Subject Hub should not contain an "Other" entry, got ${JSON.stringify(subjects.map(s => s.name))}`;
  return true;
});

check('B4. A real-subject task still shows up in Subject Hub (this is not a blanket ban on task-sourced subjects)', () => {
  const mod = createSandbox();
  mod.state.customTasks = [{ id: 'r1', subject: 'Data Structures', code: 'DS', title: 'Lab record', taskType: 'lab', status: 'pending' }];
  const subjects = mod.getSubjectList();
  if (!subjects.some(s => s.name === 'Data Structures')) return `expected 'Data Structures' to still appear, got ${JSON.stringify(subjects.map(s => s.name))}`;
  return true;
});

check('B5. A manually-created Quick Links "Subject Vault" still appears in Subject Hub (manual adds are unaffected)', () => {
  const mod = createSandbox();
  mod.saveCustomLinks([{ subject: 'Robotics Club', code: 'ROBO', color: '#394B63', resources: [] }]);
  const subjects = mod.getSubjectList();
  if (!subjects.some(s => s.name === 'Robotics Club')) return `expected manually-added 'Robotics Club' vault to still appear, got ${JSON.stringify(subjects.map(s => s.name))}`;
  return true;
});

// ── PART C: Assignments page subject-filter chip row ────────────────

check('C1. The subject filter row does not show redundant General/Mission/Other chips, but still shows real subject chips', () => {
  const mod = createSandbox();
  mod.state.assignments = [];
  mod.state.customTasks = [
    { id: 'g2', subject: 'General', code: 'GEN', title: 'Buy books', taskType: 'general', status: 'pending', dueDate: '2026-09-10', priority: 'medium' },
    { id: 'm2', subject: 'Mission', code: 'MIS', title: 'Learn Rust', taskType: 'mission', status: 'pending', noDeadline: true, priority: 'medium' },
    { id: 'r2', subject: 'Data Structures', code: 'DS', title: 'Lab record', taskType: 'lab', status: 'pending', dueDate: '2026-09-10', priority: 'medium' }
  ];
  mod.renderAssignments();
  const html = domCache['page-assignments']?.innerHTML || '';
  if (!html) return 'renderAssignments did not write into #page-assignments';
  if (/setAssignSubject\('(GEN|General|MIS|Mission|OTH|Other)'\)/i.test(html)) {
    return `expected no redundant General/Mission/Other subject-filter chip, but found one in the rendered HTML`;
  }
  if (!/setAssignSubject\('DS'\)/.test(html)) {
    return `expected the real 'DS' subject-filter chip to still be present`;
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
  console.log('🏆 ALL TASK/SUBJECT CATEGORY CLEANUP TESTS PASSED! 🚀\n');
}
