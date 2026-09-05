import fs from 'fs';

// Mock browser environment (same pattern as the other tests/*.mjs files),
// plus lightweight Image/canvas/Tesseract-worker mocks so the real
// extractTimetableFromImage orchestration (including the new header-band
// retry pass) can run end-to-end without a real browser or real OCR.
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

// Fake Image: fires onload synchronously with fixed dimensions. Real
// dimensions don't matter for these checks -- only the day-token
// y-coordinates (supplied directly in each fixture's OCR words) drive the
// crop-boundary math.
class FakeImage {
  set src(v) {
    this._src = v;
    this.width = 1600;
    this.height = 1174;
    if (this.onload) this.onload();
  }
  get src() { return this._src; }
}
globalThis.Image = FakeImage;

// Fake canvas: enough of the 2D context surface for preprocessImageForOCR
// (grayscale/contrast/trim) and the new header-crop helper to run to
// completion without throwing, without needing real pixel data.
function makeFakeCanvas() {
  return {
    _width: 1, _height: 1,
    get width() { return this._width; },
    set width(v) { this._width = v; },
    get height() { return this._height; },
    set height(v) { this._height = v; },
    getContext: () => ({
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      drawImage: () => {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4).fill(180) }),
      putImageData: () => {}
    }),
    toDataURL: (mime) => `data:${mime || 'image/png'};base64,FAKE`
  };
}

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
  createElement: (tag) => tag === 'canvas' ? makeFakeCanvas() : {
    tagName: tag, style: {}, classList: { add: () => {}, remove: () => {} },
    appendChild: () => {}, remove: () => {}, addEventListener: () => {}, removeEventListener: () => {}
  },
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
    standardizeTimetableDay,
    detectDayAndTimeTokens,
    mapRawOcrWordsForDetection,
    extractTimetableFromImage,
    getSubjectList
  };
`;

// Fresh sandbox instance per check -- guarantees a clean _tesseractWorker
// singleton (app.js's own top-level `let`) with no cross-check leakage.
function createSandbox() {
  return new Function(sandboxCode)();
}

let passed = 0;
let total = 0;
const errors = [];

function check(name, testFn) {
  total++;
  const res = testFn();
  return Promise.resolve(res).then(
    (r) => {
      if (r === true || r === undefined) {
        console.log(`✓ [PASS] ${name}`);
        passed++;
      } else {
        console.error(`✗ [FAIL] ${name}: ${r}`);
        errors.push({ name, error: r });
      }
    },
    (e) => {
      console.error(`✗ [ERROR] ${name}: ${e.stack || e}`);
      errors.push({ name, error: e.message });
    }
  );
}

function w(text, x0, y0, x1, y1, conf = 90) {
  return { text, bbox: { x0, y0, x1, y1 }, confidence: conf };
}

function timeStrToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

console.log('==================================================================');
console.log('🏆 VERIFICATION: OCR HEADER ROBUSTNESS (Stage A)');
console.log('==================================================================\n');

async function main() {

await check('1. WEB / WebDevelopment no longer resolve to Wed', () => {
  const mod = createSandbox();
  if (mod.standardizeTimetableDay('web') !== '') return `expected '', got '${mod.standardizeTimetableDay('web')}'`;
  if (mod.standardizeTimetableDay('WEB') !== '') return `expected '', got '${mod.standardizeTimetableDay('WEB')}'`;
  if (mod.standardizeTimetableDay('webdevelopment') !== '') return `expected '', got '${mod.standardizeTimetableDay('webdevelopment')}'`;
  if (mod.standardizeTimetableDay('webdev') !== '') return `expected '', got '${mod.standardizeTimetableDay('webdev')}'`;
  return true;
});

await check('2. Valid short day aliases still resolve correctly (all six 2-letter forms + exact/prefix 3+ forms)', () => {
  const mod = createSandbox();
  const cases = [
    ['we', 'Wed'], ['wed', 'Wed'], ['wednesday', 'Wed'],
    ['mo', 'Mon'], ['tu', 'Tue'], ['th', 'Thu'], ['fr', 'Fri'], ['sa', 'Sat'],
    ['mon', 'Mon'], ['tuesday', 'Tue'], ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'],
    ['mondayclass', 'Mon'] // legitimate 3+ char prefix match should still work
  ];
  for (const [input, expected] of cases) {
    const got = mod.standardizeTimetableDay(input);
    if (got !== expected) return `standardizeTimetableDay('${input}') expected '${expected}', got '${got}'`;
  }
  return true;
});

await check('3. First-pass success case: second OCR pass does not trigger (happy path unchanged)', async () => {
  const mod = createSandbox();
  let recognizeCalls = 0;
  const paramCalls = [];
  globalThis.Tesseract = {
    createWorker: async () => ({
      setParameters: async (p) => { paramCalls.push(p); },
      recognize: async () => {
        recognizeCalls++;
        return {
          data: {
            words: [
              w('Mon', 20, 100, 60, 130, 95),
              w('10:00', 150, 30, 190, 60, 95),
              w('11:00', 250, 30, 290, 60, 95),
              w('DS', 150, 100, 190, 120, 90),
              w('VJM', 195, 100, 240, 120, 85)
            ],
            text: 'Mon 10:00 11:00 DS VJM'
          }
        };
      },
      terminate: async () => {}
    })
  };
  const base64Data = 'ZmFrZQ==';
  await mod.extractTimetableFromImage(base64Data, 'image/png');
  if (recognizeCalls !== 1) return `expected exactly 1 recognize() call (no retry), got ${recognizeCalls}`;
  if (paramCalls.length !== 0) return `expected zero setParameters calls on the happy path, got ${JSON.stringify(paramCalls)}`;
  return true;
});

await check('4. Real failing-photo pattern: header-band retry triggers, PSM set then reset, usable time tokens recovered, and the resulting schedule has no impossible ranges', async () => {
  const mod = createSandbox();
  let recognizeCalls = 0;
  const paramCalls = [];
  globalThis.Tesseract = {
    createWorker: async () => ({
      setParameters: async (p) => { paramCalls.push(p); },
      recognize: async () => {
        recognizeCalls++;
        if (recognizeCalls === 1) {
          // First pass: mirrors the real photo's actual failure mode --
          // a real day token recognized fine, but the numeric header
          // band comes back as unparseable glyph soup (matches the
          // observed "f000AM" / "izasPM" style garbling; confidence 0,
          // no colon survives).
          return {
            data: {
              words: [
                w('TUESDAY', 80, 358, 192, 382, 87),
                w('f000AM', 210, 100, 280, 120, 0),
                w('izasPM', 600, 100, 670, 120, 0),
                w('DS', 150, 400, 180, 420, 90),
                w('VJM', 185, 400, 220, 420, 85)
              ],
              text: 'TUESDAY f000AM izasPM DS VJM'
            }
          };
        }
        // Second pass (header-band crop, 3x upscaled coordinate space):
        // clean, directly-usable range strings -- mirrors what the real
        // crop + PSM 6 re-OCR actually recovered in practice.
        return {
          data: {
            words: [
              w('10:00-11:00', 450, 200, 650, 260, 88),
              w('11:00-12:00', 700, 200, 900, 260, 85)
            ],
            text: '10:00-11:00 11:00-12:00'
          }
        };
      },
      terminate: async () => {}
    })
  };
  const base64Data = 'ZmFrZQ==';
  const result = await mod.extractTimetableFromImage(base64Data, 'image/png');

  if (recognizeCalls !== 2) return `expected the header-band retry to trigger (2 recognize() calls), got ${recognizeCalls}`;
  if (JSON.stringify(paramCalls) !== JSON.stringify([{ tessedit_pageseg_mode: '6' }, { tessedit_pageseg_mode: '3' }])) {
    return `expected PSM set to 6 then reset to 3, got ${JSON.stringify(paramCalls)}`;
  }
  if (!result.schedule || result.schedule.length === 0) {
    return `expected the recovered time tokens to yield at least one real row, got 0`;
  }
  const tue = result.schedule.find(r => r.day === 'Tue');
  if (!tue) return `expected a Tuesday row, got days: ${JSON.stringify(result.schedule.map(r => r.day))}`;
  if (!tue.time || !tue.end) return `Tuesday row missing time/end: ${JSON.stringify(tue)}`;
  // No impossible ranges anywhere in the result (the exact failure mode
  // observed when a whole-image PSM change was tried instead).
  for (const row of result.schedule) {
    if (timeStrToMinutes(row.end) <= timeStrToMinutes(row.time)) {
      return `impossible range found: day=${row.day} time=${row.time} end=${row.end}`;
    }
    if (!(row.durationInSlots >= 1 && row.durationInSlots <= 8)) {
      return `unreasonable durationInSlots on row: ${JSON.stringify(row)}`;
    }
  }
  return true;
});

await check('5. Crop-pass failure still resets PSM and degrades safely (no crash, first-pass data still used)', async () => {
  const mod = createSandbox();
  let recognizeCalls = 0;
  const paramCalls = [];
  globalThis.Tesseract = {
    createWorker: async () => ({
      setParameters: async (p) => { paramCalls.push(p); },
      recognize: async () => {
        recognizeCalls++;
        if (recognizeCalls === 1) {
          return {
            data: {
              words: [
                w('TUESDAY', 80, 358, 192, 382, 87),
                w('f000AM', 210, 100, 280, 120, 0)
              ],
              text: 'TUESDAY f000AM'
            }
          };
        }
        throw new Error('simulated crop OCR failure');
      },
      terminate: async () => {}
    })
  };
  const base64Data = 'ZmFrZQ==';
  const result = await mod.extractTimetableFromImage(base64Data, 'image/png');
  if (recognizeCalls !== 2) return `expected the retry to still be attempted, got ${recognizeCalls} recognize() calls`;
  if (JSON.stringify(paramCalls) !== JSON.stringify([{ tessedit_pageseg_mode: '6' }, { tessedit_pageseg_mode: '3' }])) {
    return `expected PSM to be reset to 3 even after the crop pass threw, got ${JSON.stringify(paramCalls)}`;
  }
  if (!result || typeof result.schedule === 'undefined') return `expected a graceful result object, got ${JSON.stringify(result)}`;
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
  console.log('🏆 ALL OCR HEADER ROBUSTNESS TESTS PASSED! 🚀\n');
}

}

main();
