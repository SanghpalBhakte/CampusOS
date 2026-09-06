import fs from 'fs';

// Mock browser environment (same pattern as verify_bodytext_retry.mjs /
// verify_ocr_header_robustness.mjs), covering two independent Stage 10
// fixes:
//   (A) looksLikeUnresolvedCodeResidue's length-cap bug -- a canonicalName
//       longer than 15 chars used to bypass residue detection entirely,
//       regardless of content, letting real multi-code-fusion garbage
//       through marked falsely "certain".
//   (B) a missing leading day token (e.g. "Monday" sitting with no visual
//       gap against the header band above it) is now recovered via a
//       narrow, day-label-column-only crop retry, reusing reOcrCellRegion.
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
    looksLikeUnresolvedCodeResidue,
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
console.log('🏆 VERIFICATION: RESIDUE LENGTH-CAP FIX + MISSING LEADING DAY RECOVERY');
console.log('==================================================================\n');

async function main() {

// ── PART A: looksLikeUnresolvedCodeResidue length-cap fix ──────────

await check('A1. A >15-char multi-code fusion string is now correctly flagged as residue', () => {
  const mod = createSandbox();
  if (mod.looksLikeUnresolvedCodeResidue('DEMP-ALLA2 DS-AL-B2') !== true) {
    return `expected "DEMP-ALLA2 DS-AL-B2" (20 chars) to be flagged residue`;
  }
  if (mod.looksLikeUnresolvedCodeResidue('DEMP ALB2 DS-ALC2 WEB DEVAL') !== true) {
    return `expected "DEMP ALB2 DS-ALC2 WEB DEVAL" (27 chars) to be flagged residue`;
  }
  return true;
});

await check('A2. Existing short all-caps/digit/hyphen residue is still flagged (no regression)', () => {
  const mod = createSandbox();
  if (mod.looksLikeUnresolvedCodeResidue('CS201-LAB') !== true) return `expected short residue-looking code to remain flagged`;
  if (mod.looksLikeUnresolvedCodeResidue('DS AI A2') !== true) return `expected short space-separated code to remain flagged`;
  return true;
});

await check('A3. Legitimate mixed-case subject names are never flagged as residue, long or short', () => {
  const mod = createSandbox();
  if (mod.looksLikeUnresolvedCodeResidue('Artificial Intelligence') !== false) return `expected "Artificial Intelligence" not flagged`;
  if (mod.looksLikeUnresolvedCodeResidue('Business Management and Financial Accounting') !== false) {
    return `expected a long, legitimate mixed-case subject name (>15 chars) to still NOT be flagged`;
  }
  if (mod.looksLikeUnresolvedCodeResidue('Data Structures') !== false) return `expected "Data Structures" not flagged`;
  return true;
});

await check('A4. Empty/falsy canonicalName still returns true (residue / untrusted)', () => {
  const mod = createSandbox();
  if (mod.looksLikeUnresolvedCodeResidue('') !== true) return `expected empty string to be treated as residue`;
  if (mod.looksLikeUnresolvedCodeResidue(null) !== true) return `expected null to be treated as residue`;
  return true;
});

// ── PART B: missing leading day (Monday) recovery ───────────────────

await check('B1. A missing leading day token is recovered via a narrow crop retry, and its orphaned row content is captured', async () => {
  const mod = createSandbox();
  let recognizeCalls = 0;
  const paramCalls = [];
  globalThis.Tesseract = {
    createWorker: async () => ({
      setParameters: async (p) => { paramCalls.push(p); },
      recognize: async () => {
        recognizeCalls++;
        if (recognizeCalls === 1) {
          // First pass: Tue + Wed day tokens (no Mon), 2 valid time-range
          // tokens (so Stage A's header retry does NOT trigger), a clean
          // Tue cell and a clean Wed cell, plus one clean-but-currently-
          // orphaned cell (cy=150) that sits above Tue's own band lower
          // bound (Tue.cy - 40 = 175) -- i.e. genuinely dropped today,
          // not merely misattributed to Tue.
          return {
            data: {
              words: [
                w('Tue', 20, 200, 60, 230, 95),
                w('Wed', 20, 340, 60, 370, 95),
                w('10:00 - 11:00', 150, 30, 280, 60, 95),
                w('11:00 - 12:00', 300, 30, 430, 60, 95),
                w('Physics', 160, 140, 220, 160, 90),
                w('Database', 160, 200, 220, 220, 90),
                w('Chemistry', 160, 340, 230, 360, 90)
              ],
              text: 'Tue Wed 10:00 - 11:00 11:00 - 12:00 Physics Database Chemistry'
            }
          };
        }
        // Second pass: the narrow day-label-column crop retry. Returned
        // bbox is in the crop's own upscaled space; reOcrCellRegion remaps
        // it back to (30,150)-(140,180) in full-image space -- squarely
        // inside the estimated one-row-height band above Tue.
        return {
          data: {
            words: [{ text: 'MONDAY', bbox: { x0: 60, y0: 232, x1: 280, y1: 292 }, confidence: 92 }],
            text: 'MONDAY'
          }
        };
      },
      terminate: async () => {}
    })
  };
  const result = await mod.extractTimetableFromImage('ZmFrZQ==', 'image/png');

  if (recognizeCalls !== 2) return `expected exactly 2 recognize() calls (1 first pass + 1 leading-day retry), got ${recognizeCalls}`;
  if (JSON.stringify(paramCalls) !== JSON.stringify([{ tessedit_pageseg_mode: '6' }, { tessedit_pageseg_mode: '3' }])) {
    return `expected PSM set to 6 then reset to 3, got ${JSON.stringify(paramCalls)}`;
  }
  const days = (result.schedule || []).map(r => r.day);
  if (!days.includes('Mon')) return `expected a recovered Monday row, got days: ${JSON.stringify(days)}`;
  const monRow = result.schedule.find(r => r.day === 'Mon');
  if (monRow.subject !== 'Physics') return `expected Monday's orphaned "Physics" content to be captured, got subject: '${monRow.subject}'`;
  const tueRow = result.schedule.find(r => r.day === 'Tue');
  if (!tueRow || tueRow.subject !== 'Database') return `expected Tue's own row to be unaffected, got: ${JSON.stringify(tueRow)}`;
  return true;
});

await check('B2. Monday already present in the first pass -- no retry attempted (normal scan unaffected)', async () => {
  const mod = createSandbox();
  let recognizeCalls = 0;
  globalThis.Tesseract = {
    createWorker: async () => ({
      setParameters: async () => {},
      recognize: async () => {
        recognizeCalls++;
        return {
          data: {
            words: [
              w('Mon', 20, 100, 60, 130, 95),
              w('Tue', 20, 240, 60, 270, 95),
              w('10:00 - 11:00', 150, 30, 280, 60, 95),
              w('11:00 - 12:00', 300, 30, 430, 60, 95),
              w('Physics', 160, 100, 220, 120, 90),
              w('Database', 160, 240, 220, 260, 90)
            ],
            text: 'Mon Tue 10:00 - 11:00 11:00 - 12:00 Physics Database'
          }
        };
      },
      terminate: async () => {}
    })
  };
  const result = await mod.extractTimetableFromImage('ZmFrZQ==', 'image/png');
  if (recognizeCalls !== 1) return `expected no retry when Monday is already present, got ${recognizeCalls} recognize() calls`;
  const days = (result.schedule || []).map(r => r.day);
  if (!days.includes('Mon') || !days.includes('Tue')) return `expected both existing days present, got ${JSON.stringify(days)}`;
  return true;
});

await check('B3. Fewer than 2 day tokens -- no retry attempted (row spacing cannot be estimated)', async () => {
  const mod = createSandbox();
  let recognizeCalls = 0;
  globalThis.Tesseract = {
    createWorker: async () => ({
      setParameters: async () => {},
      recognize: async () => {
        recognizeCalls++;
        return {
          data: {
            words: [
              w('Tue', 20, 200, 60, 230, 95),
              w('10:00 - 11:00', 150, 30, 280, 60, 95),
              w('11:00 - 12:00', 300, 30, 430, 60, 95),
              w('Database', 160, 200, 220, 220, 90)
            ],
            text: 'Tue 10:00 - 11:00 11:00 - 12:00 Database'
          }
        };
      },
      terminate: async () => {}
    })
  };
  const result = await mod.extractTimetableFromImage('ZmFrZQ==', 'image/png');
  if (recognizeCalls !== 1) return `expected no retry with only 1 day token, got ${recognizeCalls} recognize() calls`;
  if (!result || typeof result.schedule === 'undefined') return `expected a graceful result object, got ${JSON.stringify(result)}`;
  return true;
});

await check('B4. Leading-day retry OCR failure degrades safely (no crash, prior result kept)', async () => {
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
                w('Tue', 20, 200, 60, 230, 95),
                w('Wed', 20, 340, 60, 370, 95),
                w('10:00 - 11:00', 150, 30, 280, 60, 95),
                w('11:00 - 12:00', 300, 30, 430, 60, 95),
                w('Database', 160, 200, 220, 220, 90),
                w('Chemistry', 160, 340, 230, 360, 90)
              ],
              text: 'Tue Wed 10:00 - 11:00 11:00 - 12:00 Database Chemistry'
            }
          };
        }
        throw new Error('simulated leading-day crop OCR failure');
      },
      terminate: async () => {}
    })
  };
  const result = await mod.extractTimetableFromImage('ZmFrZQ==', 'image/png');
  if (recognizeCalls !== 2) return `expected the retry to still be attempted, got ${recognizeCalls} recognize() calls`;
  const days = (result.schedule || []).map(r => r.day);
  if (!days.includes('Tue') || !days.includes('Wed')) return `expected the prior result's rows to survive the retry failure, got ${JSON.stringify(days)}`;
  return true;
});

await check('B5. Recovered crop text that does not resolve to Monday is ignored (no false day injected)', async () => {
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
                w('Tue', 20, 200, 60, 230, 95),
                w('Wed', 20, 340, 60, 370, 95),
                w('10:00 - 11:00', 150, 30, 280, 60, 95),
                w('11:00 - 12:00', 300, 30, 430, 60, 95),
                w('Database', 160, 200, 220, 220, 90),
                w('Chemistry', 160, 340, 230, 360, 90)
              ],
              text: 'Tue Wed 10:00 - 11:00 11:00 - 12:00 Database Chemistry'
            }
          };
        }
        // Garbage recovery -- nothing resolves to a day at all.
        return {
          data: {
            words: [{ text: 'xzq', bbox: { x0: 60, y0: 232, x1: 280, y1: 292 }, confidence: 88 }],
            text: 'xzq'
          }
        };
      },
      terminate: async () => {}
    })
  };
  const result = await mod.extractTimetableFromImage('ZmFrZQ==', 'image/png');
  const days = (result.schedule || []).map(r => r.day);
  if (days.includes('Mon')) return `expected no Monday row to be injected from unresolved recovered text, got ${JSON.stringify(days)}`;
  if (!days.includes('Tue') || !days.includes('Wed')) return `expected the original rows to remain intact, got ${JSON.stringify(days)}`;
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
  console.log('🏆 ALL RESIDUE-FIX + MONDAY-RECOVERY TESTS PASSED! 🚀\n');
}

}

main();
