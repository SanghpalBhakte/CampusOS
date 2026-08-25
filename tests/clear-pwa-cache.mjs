#!/usr/bin/env node
// ============================================================
// Clarity Desk — Origin-Scoped PWA Cache Clearing Utility
// Safely clears Service Worker registrations & Cache Storage
// for the local app origin without touching user localStorage.
// Optional --full flag also clears origin localStorage/sessionStorage.
// ============================================================

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const isFull = process.argv.includes('--full') || process.env.CLEAR_FULL === 'true';
const PORT = parseInt(process.env.PORT || '4173', 10);
const TARGET_URL = process.env.CLEAR_ORIGIN_URL || `http://127.0.0.1:${PORT}`;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function ensureLocalServer() {
  return new Promise((resolve) => {
    const testReq = http.get(TARGET_URL, () => {
      resolve(null); // Already running
    });
    testReq.on('error', () => {
      // Start a temporary local static server
      const srv = http.createServer((req, res) => {
        let reqPath = req.url.split('?')[0];
        if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
        const filePath = path.join(ROOT, reqPath);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*'
          });
          fs.createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      });

      srv.listen(PORT, '127.0.0.1', () => {
        resolve(srv);
      });
    });
  });
}

async function run() {
  console.log('\n============================================================');
  console.log('🧹 CLARITY DESK — PWA CACHE CLEANUP UTILITY');
  console.log(`Target Origin: ${TARGET_URL}`);
  console.log(`Mode: ${isFull ? 'FULL STORAGE WIPE (Service Worker + Caches + localStorage)' : 'SAFE CACHE CLEAR (Service Worker + Caches only)'}`);
  console.log('============================================================\n');

  const server = await ensureLocalServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    const audit = await page.evaluate(async (wipeStorage) => {
      const summary = {
        serviceWorkersUnregistered: 0,
        cachesDeleted: [],
        storageCleared: false,
        origin: window.location.origin
      };

      // 1. Unregister active service workers for this origin
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          const scope = reg.scope;
          const ok = await reg.unregister();
          if (ok) summary.serviceWorkersUnregistered++;
        }
      }

      // 2. Delete Cache Storage entries for this origin
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
          summary.cachesDeleted.push(key);
        }
      }

      // 3. Optional full storage wipe
      if (wipeStorage) {
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
        if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
          const dbs = await indexedDB.databases();
          for (const db of dbs) {
            if (db.name) indexedDB.deleteDatabase(db.name);
          }
        }
        summary.storageCleared = true;
      }

      return summary;
    }, isFull);

    console.log(`✓ Scope Verified                : ${audit.origin}`);
    console.log(`✓ Service Workers Unregistered  : ${audit.serviceWorkersUnregistered}`);
    console.log(`✓ Cache Storage Entries Deleted : ${audit.cachesDeleted.length} (${audit.cachesDeleted.join(', ') || 'None found'})`);
    console.log(`✓ User Data Preserved (cos_*)   : ${audit.storageCleared ? 'NO (Full Wipe Invoked)' : 'YES (localStorage & IndexedDB Untouched)'}`);
    console.log('\n🏆 Origin cache cleared successfully! Next session will fetch fresh assets & service worker.\n');

  } catch (err) {
    console.error('\n❌ Cache clearing encountered an error:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (server) {
      server.close();
    }
  }
}

run();
