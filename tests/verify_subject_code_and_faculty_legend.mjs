import fs from 'fs';

// Mock browser environment (same pattern as other verify_*.mjs files).
// Covers Stage 11: five real-photo-evidenced fixes bundled together --
//   (A) an inline, unbracketed "-AI-<batch>" / "-AL-<batch>" branch/batch
//       qualifier appended directly to a subject abbreviation (e.g.
//       "DS-AI-A2") is now stripped before CANONICAL_SUBJECT_MAP lookup,
//       so it resolves to the real subject name instead of staying an
//       unresolved raw code.
//   (B) footer/legend-table content (e.g. a "Subject / Abbrivation" or
//       "Name of the faculty" table below the grid) no longer bleeds into
//       whichever day happens to sit physically last.
//   (C) trySplitByIndependentLines now handles 2-4 stacked lines, not
//       just exactly 2 -- a real 3-subject stacked cell was found on a
//       clean real photo.
//   (D) a per-scan "Name of the faculty" legend (initials -> full name)
//       is parsed and used to resolve bare faculty initials left in a
//       cell (e.g. "VAK") into the real teacher's name.
//   (E) "Adv." (Advocate) added to the recognized faculty title prefixes.
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
    id, style: {}, classList: { add: () => {}, remove: () => {} },
    appendChild: () => {}, remove: () => {}, focus: () => {}, value: '', textContent: '',
    querySelector: () => null
  }),
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
    normalizeSubjectIdentity,
    reconstructTimetable2DGrid,
    parseFacultyLegend,
    looksLikeUnresolvedCodeResidue
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

function w(text, x0, y0, x1, y1, conf = 90) {
  return { text, bbox: { x0, y0, x1, y1 }, confidence: conf };
}

console.log('==================================================================');
console.log('🏆 VERIFICATION: SUBJECT-CODE DECOMPOSITION + FACULTY LEGEND (Stage 11)');
console.log('==================================================================\n');

// ── PART A: inline "-AI-<batch>" / "-AL-<batch>" qualifier stripping ──

check('A1. "DS-AI-A2" resolves to the real subject name, not a raw code', () => {
  const mod = createSandbox();
  const norm = mod.normalizeSubjectIdentity('DS-AI-A2( VJM)', []);
  if (norm.canonicalName !== 'Data Structures') return `expected 'Data Structures', got '${norm.canonicalName}'`;
  if (mod.looksLikeUnresolvedCodeResidue(norm.canonicalName)) return `resolved name should not be flagged residue`;
  return true;
});

check('A2. The OCR-misread "AL" variant of the same qualifier also resolves ("DEMP- AL-B2")', () => {
  const mod = createSandbox();
  const norm = mod.normalizeSubjectIdentity('DEMP- AL-B2(VAK)', []);
  if (norm.canonicalName !== 'Digital Electronics and Microprocessors') {
    return `expected 'Digital Electronics and Microprocessors', got '${norm.canonicalName}'`;
  }
  return true;
});

check('A3. The batch itself is still captured correctly after stripping the qualifier', () => {
  const mod = createSandbox();
  const norm = mod.normalizeSubjectIdentity('DS-AI-A2( VJM)', []);
  if (!norm.batches.includes('A2')) return `expected batch 'A2' preserved, got ${JSON.stringify(norm.batches)}`;
  return true;
});

check('A4. A genuinely unmapped abbreviation with the same qualifier shape still stays unresolved (no over-matching)', () => {
  const mod = createSandbox();
  const norm = mod.normalizeSubjectIdentity('XQZ-AI-A2', []);
  if (norm.canonicalName !== 'XQZ') return `expected the bare unmapped abbreviation 'XQZ' to survive, got '${norm.canonicalName}'`;
  if (!mod.looksLikeUnresolvedCodeResidue(norm.canonicalName)) return `expected 'XQZ' to still be flagged residue`;
  return true;
});

// ── PART B: legend/footer bleed-through prevention ──────────────────

check('B1. A "Name of the faculty" legend table below the grid does not fabricate a row for the last day', () => {
  const mod = createSandbox();
  const ocrData = {
    words: [
      w('Sat', 20, 100, 60, 130, 95), w('10:00 - 11:00', 150, 30, 280, 60, 95),
      w('Physics', 150, 100, 220, 120, 90),
      // Footer legend far enough below to be a real risk of falling
      // inside Sat's otherwise-unbounded "+70px" lower band.
      w('Name', 20, 160, 60, 180, 90), w('of', 65, 160, 85, 180, 90),
      w('the', 90, 160, 120, 180, 90), w('facul', 125, 160, 180, 180, 90),
      w('VAK', 20, 190, 60, 210, 90), w('Prof.', 70, 190, 110, 210, 90),
      w('Kulkarni', 115, 190, 200, 210, 90)
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  const badRow = res.schedule.find(r => /prof|kulkarni|name|facul/i.test(r.subject));
  if (badRow) return `legend content leaked into the schedule: ${JSON.stringify(badRow)}`;
  if (res.schedule.length !== 1 || res.schedule[0].subject !== 'Physics') {
    return `expected exactly the real 'Physics' row, got ${JSON.stringify(res.schedule.map(r => r.subject))}`;
  }
  return true;
});

// ── PART C: 2-4 line independent-subject splitting ──────────────────

check('C1. A genuinely 3-subject stacked cell splits into 3 rows', () => {
  const mod = createSandbox();
  const ocrData = {
    words: [
      w('Thu', 20, 100, 60, 130, 95), w('10:00 - 12:00', 150, 30, 280, 60, 95),
      w('DS-AI-C2', 150, 100, 220, 120, 90),
      w('DEMP-AI-B2', 150, 125, 230, 145, 90),
      w('Web', 150, 150, 190, 170, 90), w('Development', 195, 150, 300, 170, 90)
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  const subjects = res.schedule.map(r => r.subject);
  if (res.schedule.length !== 3) return `expected 3 split entries, got ${res.schedule.length}: ${JSON.stringify(subjects)}`;
  if (!subjects.includes('Data Structures') || !subjects.includes('Digital Electronics and Microprocessors') || !subjects.includes('Web Development')) {
    return `expected all 3 distinct subjects resolved, got ${JSON.stringify(subjects)}`;
  }
  return true;
});

check('C2. A 5-line cell (beyond the cap) is left unsplit -- treated as noise, not a real 5-subject cell', () => {
  const mod = createSandbox();
  const ocrData = {
    words: [
      w('Fri', 20, 100, 60, 130, 95), w('10:00 - 12:00', 150, 30, 280, 60, 95),
      w('DS', 150, 100, 190, 118, 90),
      w('DEMP', 150, 120, 200, 138, 90),
      w('PBST', 150, 140, 200, 158, 90),
      w('BMFA', 150, 160, 200, 178, 90),
      w('COI', 150, 180, 190, 198, 90)
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  // Whatever it resolves to, it must NOT be 5 separate confidently-split
  // rows -- the cap exists specifically to treat this as unlikely/noisy.
  if (res.schedule.length === 5) return `expected the 5-line cap to prevent a full 5-way split, got 5 rows`;
  return true;
});

// ── PART D + E: faculty-legend parsing and auto teacher resolution ──

check('D1. parseFacultyLegend extracts initials -> full name from a "Name of the faculty" table', () => {
  const mod = createSandbox();
  const words = [
    w('Name', 20, 1120, 60, 1140, 90), w('of', 65, 1124, 85, 1142, 90),
    w('the', 90, 1125, 120, 1144, 90), w('facul', 125, 1126, 180, 1147, 90),
    w('VAK', 20, 1144, 82, 1188, 90), w('Prof.', 125, 1161, 175, 1181, 90),
    w('A.', 180, 1164, 200, 1184, 90), w('Kulkarni', 205, 1165, 290, 1187, 90),
    w('MKP', 20, 1238, 84, 1286, 90), w('Prof.', 125, 1256, 173, 1278, 90),
    w('M.', 178, 1259, 200, 1280, 90), w('Pawar', 205, 1262, 280, 1284, 90)
  ];
  const legend = mod.parseFacultyLegend(words);
  if (!legend.VAK || !/Kulkarni/.test(legend.VAK)) return `expected VAK to resolve to a Kulkarni name, got ${JSON.stringify(legend)}`;
  if (!legend.MKP || !/Pawar/.test(legend.MKP)) return `expected MKP to resolve to a Pawar name, got ${JSON.stringify(legend)}`;
  return true;
});

check('D2. A combined "code | subject name | faculty name" row (real FY-AIDS shape) resolves to just the teacher name, with the subject-name prose and a trailing student roll-number range both discarded', () => {
  const mod = createSandbox();
  const words = [
    w('Subject', 20, 100, 80, 120, 90), w('Name', 85, 100, 130, 120, 90), w('FacultyName', 200, 100, 300, 120, 90),
    w('LADE', 20, 130, 70, 150, 90), w('Linear', 130, 130, 180, 150, 90), w('Algebra', 185, 130, 240, 150, 90),
    w('Prof.', 300, 130, 340, 150, 90), w('A.', 345, 130, 360, 150, 90), w('Nale', 365, 130, 410, 150, 90),
    w('12506051-12506075', 450, 130, 600, 150, 90)
  ];
  const legend = mod.parseFacultyLegend(words);
  if (!legend.LADE || !/^Prof\.?\s*A\.?\s*Nale$/i.test(legend.LADE)) {
    return `expected LADE to resolve to just 'Prof. A. Nale' (subject prose + roll-range stripped), got ${JSON.stringify(legend.LADE)}`;
  }
  return true;
});

check('D2b. A legend row with no recognizable title at all is still rejected outright (real evidence: OCR ate the "Prof V." entirely)', () => {
  const mod = createSandbox();
  // Real photo evidence: the "VJM" row's own initials OCR'd as "VIM", and
  // what should have been "Prof V. J. Murambikar" came out as
  // "157, VJ; Murambikar" -- no title token survives at all, so there is
  // nothing safe to anchor a name extraction on. Correctly stays
  // unresolved rather than guessing.
  const words = [
    w('Name', 20, 1120, 60, 1140, 90), w('of', 65, 1124, 85, 1142, 90),
    w('the', 90, 1125, 120, 1144, 90), w('facul', 125, 1126, 180, 1147, 90),
    w('VIM', 20, 1176, 78, 1225, 90), w('157,', 122, 1193, 199, 1213, 90),
    w('VJ;', 207, 1194, 252, 1215, 90), w('Murambikar', 261, 1197, 391, 1221, 90)
  ];
  const legend = mod.parseFacultyLegend(words);
  if (legend.VIM) return `expected the title-less garbled row to stay unresolved, got VIM='${legend.VIM}'`;
  return true;
});

check('D2c. A single stray-digit OCR typo inside an otherwise valid name still resolves (real evidence: "S.D." misread as "5.0.")', () => {
  const mod = createSandbox();
  const words = [
    w('Name', 20, 1120, 60, 1140, 90), w('of', 65, 1124, 85, 1142, 90),
    w('the', 90, 1125, 120, 1144, 90), w('facul', 125, 1126, 180, 1147, 90),
    w('SDJ', 28, 1211, 166, 1247, 90), w('Prof,', 173, 1225, 222, 1246, 90),
    w('5.0.', 236, 1228, 276, 1248, 90), w('Jadhay', 281, 1230, 357, 1252, 90)
  ];
  const legend = mod.parseFacultyLegend(words);
  if (!legend.SDJ || /\d{2,}/.test(legend.SDJ)) return `expected SDJ to resolve despite the isolated digit typo, got ${JSON.stringify(legend.SDJ)}`;
  return true;
});

check('D2d. Digit contamination stuck in the middle of the name (not a trailing roll-range) is still rejected', () => {
  const mod = createSandbox();
  const words = [
    w('Name', 20, 1120, 60, 1140, 90), w('of', 65, 1124, 85, 1142, 90),
    w('the', 90, 1125, 120, 1144, 90), w('facul', 125, 1126, 180, 1147, 90),
    w('XYZ', 20, 1160, 60, 1180, 90), w('Prof.', 70, 1160, 110, 1180, 90),
    w('A.', 115, 1160, 130, 1180, 90), w('12506051', 135, 1160, 220, 1180, 90), w('Nale', 225, 1160, 270, 1180, 90)
  ];
  const legend = mod.parseFacultyLegend(words);
  if (legend.XYZ) return `expected mid-string digit-run contamination to still be rejected, got XYZ='${legend.XYZ}'`;
  return true;
});

check('D3. A bare faculty-initials token in a cell resolves to the legend full name (auto name assignment)', () => {
  const mod = createSandbox();
  const facultyLegend = { VAK: 'Prof. V. A. Kulkarni' };
  const norm = mod.normalizeSubjectIdentity('DEMP VAK', [], null, facultyLegend);
  if (norm.canonicalName !== 'Digital Electronics and Microprocessors') return `expected subject resolved, got '${norm.canonicalName}'`;
  if (norm.teacher !== 'Prof. V. A. Kulkarni') return `expected teacher resolved from legend, got '${norm.teacher}'`;
  return true;
});

check('D4. With no legend supplied (default), bare initials are left alone -- fully backward compatible', () => {
  const mod = createSandbox();
  const norm = mod.normalizeSubjectIdentity('DEMP VAK', []);
  if (norm.teacher) return `expected no teacher resolved without a legend, got '${norm.teacher}'`;
  return true;
});

check('E1. "Adv." is recognized as a faculty title (e.g. "Adv. Vrushali Joshi")', () => {
  const mod = createSandbox();
  const norm = mod.normalizeSubjectIdentity('COI Adv. Vrushali Joshi', []);
  if (!norm.teacher || !/Adv\.?\s*Vrushali/.test(norm.teacher)) return `expected 'Adv. Vrushali...' extracted as teacher, got '${norm.teacher}'`;
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
  console.log('🏆 ALL SUBJECT-CODE + FACULTY-LEGEND TESTS PASSED! 🚀\n');
}
