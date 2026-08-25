#!/usr/bin/env node
// ============================================================
// Clarity Desk — One-Command Release Gate & Verification Runner
// Runs master regression, gap fixes, normalization, PWA smoke,
// and full visual verification suites with fail-fast execution.
// ============================================================

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const STEPS = [
  {
    name: '1. Master Codebase Integrity & Regression Audit',
    command: 'node',
    args: ['tests/verify_master.mjs']
  },
  {
    name: '2. Gap Fix Board Verification',
    command: 'node',
    args: ['tests/verify_gap_fixes.mjs']
  },
  {
    name: '3. Subject Normalization & Readability Verification',
    command: 'node',
    args: ['tests/verify_subject_normalization.mjs']
  },
  {
    name: '4. PWA Release & Offline Smoke Suite',
    command: 'npx',
    args: ['playwright', 'test', 'tests/pwa-smoke.spec.ts', '--project=chromium-desktop']
  },
  {
    name: '5. Visual & Layout Regression Suite (Desktop & Mobile)',
    command: 'npx',
    args: ['playwright', 'test', 'tests/clarity-visual-verification.spec.ts']
  }
];

console.log('\n============================================================');
console.log('🚀 CLARITY DESK — FULL RELEASE VERIFICATION PIPELINE');
console.log('============================================================\n');

const startTime = Date.now();

for (const [index, step] of STEPS.entries()) {
  console.log(`\n▶ [${index + 1}/${STEPS.length}] Running: ${step.name}...`);
  console.log(`------------------------------------------------------------`);
  
  const stepStart = Date.now();
  const res = spawnSync(step.command, step.args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env }
  });

  const stepElapsed = ((Date.now() - stepStart) / 1000).toFixed(1);

  if (res.status !== 0) {
    console.error(`\n❌ [FAIL] Step failed with exit code ${res.status}: ${step.name}`);
    console.error(`Execution halted. Release blocked.\n`);
    process.exit(res.status || 1);
  }

  console.log(`✓ [PASS] ${step.name} (${stepElapsed}s)`);
}

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log('\n============================================================');
console.log(`🏆 ALL RELEASE VERIFICATION STEPS PASSED SUCCESSFULLY! (${totalElapsed}s)`);
console.log('STATUS: READY FOR PRODUCTION DEPLOYMENT 🚀');
console.log('============================================================\n');
process.exit(0);
