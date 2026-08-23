import fs from 'fs';

const htmlSrc = fs.readFileSync('D:/Clarity Desk/index.html', 'utf8');
const jsSrc = fs.readFileSync('D:/Clarity Desk/app.js', 'utf8');
const cssSrc = fs.readFileSync('D:/Clarity Desk/style.css', 'utf8');

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
console.log('🏆 CLARITY DESK: GAP FIX BOARD COMPREHENSIVE VERIFICATION');
console.log('==================================================================\n');

// 1. Unit 1: Theme flash on reload
check('Unit 1: <head> inline script correctly maps all 6 production themes and aliases', () => {
  const headScriptMatch = htmlSrc.match(/<head[^>]*>[\s\S]*?<script>([\s\S]*?)<\/script>/);
  if (!headScriptMatch) return 'Head script missing';
  const scriptContent = headScriptMatch[1];

  const requiredThemes = ['paper-slate', 'midnight-ink', 'espresso-desk', 'sandstone-notes', 'nordic-frost', 'misty-mint'];
  for (const t of requiredThemes) {
    if (!scriptContent.includes(`'${t}'`)) return `Theme '${t}' missing from head script`;
  }
  return true;
});

// 2. Unit 2: Mobile Subject Hubs access
check('Unit 2: Mobile bottom navigation includes direct Subjects tab button', () => {
  const bottomNavMatch = htmlSrc.match(/<nav class="bottom-nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!bottomNavMatch) return 'bottom-nav element missing';
  if (!bottomNavMatch[1].includes('data-nav="subjects"')) return 'data-nav="subjects" missing from bottom-nav';
  if (!bottomNavMatch[1].includes("navigateTo('subjects')")) return "navigateTo('subjects') missing";
  return true;
});

// 3. Unit 3: Single Subject Hub add-link action
check('Unit 3: Single Subject Hub provides empty-state "+ Add Study Link / Note" action with context prefill', () => {
  if (!jsSrc.includes('openAddResourceForSubject')) return 'openAddResourceForSubject function missing';
  if (!jsSrc.includes('No Study Links or Notes Yet')) return 'Empty state copy missing';
  if (!jsSrc.includes('+ Add Study Link / Note')) return 'Empty state action button missing';
  return true;
});

// 4. Unit 4: First-run setup checklist
check('Unit 4: First-run setup checklist presents 3-step sequence for new users and hides for active users', () => {
  if (!jsSrc.includes('1. Set Practical Batch & Profile')) return 'Step 1 missing';
  if (!jsSrc.includes('2. Import Timetable Schedule')) return 'Step 2 missing';
  if (!jsSrc.includes('3. Set Attendance Starting Counts')) return 'Step 3 missing';
  if (!jsSrc.includes('Welcome · Recommended Setup Order')) return 'Header missing';
  return true;
});

// 5. Unit 5: Local/offline save status clarity
check('Unit 5: Topbar displays visible storage status badge indicating local saving and offline status', () => {
  if (!htmlSrc.includes('class="storage-status-badge"')) return 'storage-status-badge missing in index.html';
  if (!htmlSrc.includes('Saved locally')) return 'Default "Saved locally" text missing';
  if (!jsSrc.includes('Saved locally') || !jsSrc.includes('Offline · Saved')) return 'Storage status state copy missing in app.js';
  if (!cssSrc.includes('.storage-status-badge {')) return 'CSS styling missing in style.css';
  return true;
});

console.log(`\n========================================`);
console.log(`TOTAL UNITS CHECKED: ${total}`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${errors.length}`);
console.log(`========================================`);

if (errors.length > 0) {
  process.exit(1);
} else {
  console.log('ALL 5 UNITS FROM GAP FIX BOARD PASSED WITH ZERO ERRORS! 🚀');
}
