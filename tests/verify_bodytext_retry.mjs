import fs from 'fs';

// Mock browser environment (same pattern as verify_ocr_header_robustness.mjs),
// plus lightweight Image/canvas/Tesseract-worker mocks so the new
// low-confidence cell-region retry (Stage C) can be exercised end-to-end
// without a real browser or real OCR.
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
    reconstructTimetable2DGrid,
    extractTimetableFromImage
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

console.log('==================================================================');
console.log('🏆 VERIFICATION: BODY-TEXT LOW-CONFIDENCE CELL RETRY (Stage C)');
console.log('==================================================================\n');

async function main() {

await check('1. A cell whose OCR words are mostly low-confidence is flagged in lowConfidenceClusters', () => {
  const mod = createSandbox();
  const ocrData = {
    words: [
      w('Thu', 20, 100, 60, 130, 95), w('10:00 - 11:00', 150, 30, 280, 60, 95),
      w('Pashilii', 150, 100, 210, 120, 20), w('Roce', 215, 100, 250, 120, 15),
      w('SDJ', 255, 100, 280, 120, 10), w('ss', 285, 100, 300, 120, 25)
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (!res.lowConfidenceClusters || res.lowConfidenceClusters.length !== 1) {
    return `expected exactly 1 flagged cluster, got ${JSON.stringify(res.lowConfidenceClusters)}`;
  }
  const region = res.lowConfidenceClusters[0];
  if (region.day !== 'Thu') return `expected flagged region day 'Thu', got '${region.day}'`;
  if (!(region.bbox.x0 <= 150 && region.bbox.x1 >= 300)) return `flagged bbox doesn't cover the cell's words: ${JSON.stringify(region.bbox)}`;
  return true;
});

await check('2. A confidently-recognized cell is NOT flagged', () => {
  const mod = createSandbox();
  const ocrData = {
    words: [
      { text: 'Thursday', bbox: { x0: 20, y0: 100, x1: 90, y1: 130 }, confidence: 95 },
      { text: '10:00 - 11:00', bbox: { x0: 150, y0: 30, x1: 250, y1: 60 }, confidence: 95 },
      { text: 'Deep', bbox: { x0: 150, y0: 100, x1: 190, y1: 120 }, confidence: 90 },
      { text: 'Learning', bbox: { x0: 195, y0: 100, x1: 260, y1: 120 }, confidence: 90 },
      { text: 'Prof.', bbox: { x0: 150, y0: 125, x1: 180, y1: 140 }, confidence: 90 },
      { text: 'Verma', bbox: { x0: 185, y0: 125, x1: 235, y1: 140 }, confidence: 90 }
    ]
  };
  const res = mod.reconstructTimetable2DGrid(ocrData, []);
  if (!res.lowConfidenceClusters || res.lowConfidenceClusters.length !== 0) {
    return `expected no flagged clusters, got ${JSON.stringify(res.lowConfidenceClusters)}`;
  }
  return true;
});

await check('3. Orchestration: a flagged cell region is retried and the recovered, confident text replaces the garbled one', async () => {
  const mod = createSandbox();
  let recognizeCalls = 0;
  const paramCalls = [];
  globalThis.Tesseract = {
    createWorker: async () => ({
      setParameters: async (p) => { paramCalls.push(p); },
      recognize: async () => {
        recognizeCalls++;
        if (recognizeCalls === 1) {
          // First pass: clean day + 2 valid time-range tokens (so Stage
          // A's header retry does NOT trigger -- isolates this test to
          // the new Stage C body-cell retry), plus one badly garbled,
          // low-confidence body cell.
          return {
            data: {
              words: [
                w('Mon', 20, 100, 60, 130, 95),
                w('10:00 - 11:00', 150, 30, 280, 60, 95),
                w('11:00 - 12:00', 300, 30, 430, 60, 95),
                w('Pashilii', 300, 100, 350, 120, 20), w('Roce', 355, 100, 390, 120, 15),
                w('SDJ', 393, 100, 415, 120, 10), w('ss', 418, 100, 435, 120, 25)
              ],
              text: 'Mon 10:00 - 11:00 11:00 - 12:00 Pashilii Roce SDJ ss'
            }
          };
        }
        // Second pass: targeted cell-region retry. Coordinates are in
        // the crop's own upscaled space; reOcrCellRegion remaps them back
        // to roughly (310,100)-(420,120) in full-image space, landing in
        // the same time column as the words being replaced.
        return {
          data: {
            words: [
              { text: 'Web', bbox: { x0: 32, y0: 12, x1: 132, y1: 52 }, confidence: 92 },
              { text: 'Development', bbox: { x0: 142, y0: 12, x1: 252, y1: 52 }, confidence: 90 }
            ],
            text: 'Web Development'
          }
        };
      },
      terminate: async () => {}
    })
  };
  const result = await mod.extractTimetableFromImage('ZmFrZQ==', 'image/png');

  if (recognizeCalls !== 2) return `expected exactly 2 recognize() calls (1 first pass + 1 cell retry), got ${recognizeCalls}`;
  if (JSON.stringify(paramCalls) !== JSON.stringify([{ tessedit_pageseg_mode: '6' }, { tessedit_pageseg_mode: '3' }])) {
    return `expected PSM set to 6 then reset to 3, got ${JSON.stringify(paramCalls)}`;
  }
  const row = (result.schedule || []).find(r => r.subject === 'Web Development');
  if (!row) return `expected a recovered 'Web Development' row, got subjects: ${JSON.stringify((result.schedule || []).map(r => r.subject))}`;
  return true;
});

await check('4. Orchestration: a crop retry failure degrades safely (no crash, first-pass result kept)', async () => {
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
                w('Mon', 20, 100, 60, 130, 95),
                w('10:00 - 11:00', 150, 30, 280, 60, 95),
                w('11:00 - 12:00', 300, 30, 430, 60, 95),
                w('Pashilii', 300, 100, 350, 120, 20), w('Roce', 355, 100, 390, 120, 15)
              ],
              text: 'Mon 10:00 - 11:00 11:00 - 12:00 Pashilii Roce'
            }
          };
        }
        throw new Error('simulated cell-region crop OCR failure');
      },
      terminate: async () => {}
    })
  };
  const result = await mod.extractTimetableFromImage('ZmFrZQ==', 'image/png');
  if (recognizeCalls !== 2) return `expected the retry to still be attempted, got ${recognizeCalls} recognize() calls`;
  if (!result || typeof result.schedule === 'undefined') return `expected a graceful result object, got ${JSON.stringify(result)}`;
  return true;
});

await check('5. Orchestration: a retry that would produce fewer rows is rejected, original result kept', async () => {
  const mod = createSandbox();
  let recognizeCalls = 0;
  globalThis.Tesseract = {
    createWorker: async () => ({
      setParameters: async () => {},
      recognize: async () => {
        recognizeCalls++;
        if (recognizeCalls === 1) {
          return {
            data: {
              words: [
                w('Mon', 20, 100, 60, 130, 95),
                w('10:00 - 11:00', 150, 30, 280, 60, 95),
                w('11:00 - 12:00', 450, 30, 580, 60, 95),
                // Clean cell in column 1 (kept as-is throughout)
                w('Database', 160, 100, 220, 120, 90), w('Systems', 225, 100, 280, 120, 90),
                // Garbled, low-confidence cell in column 2, well separated
                // from column 1 so they cluster independently (flagged for retry)
                w('Pashilii', 450, 100, 500, 120, 20), w('Roce', 505, 100, 540, 120, 15),
                w('SDJ', 543, 100, 565, 120, 10), w('ss', 568, 100, 585, 120, 25)
              ],
              text: 'Mon 10:00 - 11:00 11:00 - 12:00 Database Systems Pashilii Roce SDJ ss'
            }
          };
        }
        // Retry recovers a word that lands far outside every time column,
        // so it fails span computation and the row is dropped entirely --
        // a strictly worse outcome than keeping the original garbled row.
        return {
          data: {
            words: [{ text: 'Stray', bbox: { x0: 4000, y0: 4000, x1: 4100, y1: 4040 }, confidence: 92 }],
            text: 'Stray'
          }
        };
      },
      terminate: async () => {}
    })
  };
  const result = await mod.extractTimetableFromImage('ZmFrZQ==', 'image/png');
  if (!result.schedule || result.schedule.length !== 2) {
    return `expected the original 2-row result to be kept (retry rejected as worse), got ${result.schedule?.length}: ${JSON.stringify(result.schedule?.map(r => r.subject))}`;
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
  console.log('🏆 ALL BODY-TEXT RETRY TESTS PASSED! 🚀\n');
}

}

main();
