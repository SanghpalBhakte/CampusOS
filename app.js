// ============================================================
// Clarity Desk — App Logic & Interactive Functions
// ============================================================

import { STUDENT, TIMETABLE, EMPTY_TIMETABLE, ASSIGNMENTS, NOTICES, QUICK_LINKS } from './data.js';

// ── localStorage Keys ─────────────────────────────────────────
const KEY_PROFILE          = 'cos_profile';
const KEY_ASSIGNMENTS      = 'cos_assignments';
const KEY_CUSTOM_TASKS     = 'cos_custom_tasks';
const KEY_CUSTOM_TIMETABLE = 'cos_custom_timetable';
const KEY_TIMETABLE_CHOICE = 'cos_timetable_choice';
const KEY_CUSTOM_LINKS     = 'cos_custom_links';
const KEY_ATTENDANCE          = 'cos_attendance';
const KEY_ATTENDANCE_BASELINE = 'cos_attendance_baseline';
const KEY_ATTENDANCE_LIVE     = 'cos_attendance_live';
const KEY_GEMINI_KEY          = 'cos_gemini_key';
const KEY_THEME               = 'cos_theme';
const KEY_NOTIF_PREFS         = 'cos_notif_prefs';
const KEY_NOTICE_CHANNELS     = 'cos_notice_channels';
const KEY_ATT_TARGET          = 'cos_att_target';
const KEY_USER_BATCH          = 'cos_user_batch';
const KEY_CLEANUP_BACKUP      = 'cos_cleanup_backup';

// ── Safe Storage Helpers ─────────────────────────────────────
function safeGetStorage(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    if (v === null || v === undefined) return fallback;
    try {
      return JSON.parse(v);
    } catch (_) {
      return v;
    }
  } catch (err) {
    console.warn(`localStorage read error for key [${key}]:`, err);
    return fallback;
  }
}

function safeSetStorage(key, val) {
  try {
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    return true;
  } catch (err) {
    console.warn(`localStorage write error for key [${key}]:`, err);
    return false;
  }
}

// ── Profile (read from localStorage, fallback to data.js) ─────
function loadProfile() {
  const saved = safeGetStorage(KEY_PROFILE, {}) || {};
  const isDummy = (val, dummies = []) => {
    const s = (val || '').trim();
    if (!s) return true;
    return dummies.some(d => s.toLowerCase() === d.toLowerCase());
  };

  const getCleanVal = (val, fallback = '', dummies = []) => {
    if (val !== undefined && val !== null) {
      const s = String(val).trim();
      if (!isDummy(s, dummies)) return s;
    }
    if (fallback && !isDummy(fallback, dummies)) return String(fallback).trim();
    return '';
  };

  return {
    name:     getCleanVal(saved.name, STUDENT.name, ['your name']),
    college:  getCleanVal(saved.college, STUDENT.college, ['your college', 'your university']),
    branch:   getCleanVal(saved.branch, STUDENT.branch, ['your branch', 'your major', 'your department']),
    year:     getCleanVal(saved.year, STUDENT.year, ['your year', 'your semester', 'your term']),
    rollNo:   getCleanVal(saved.rollNo, STUDENT.rollNo, ['your roll no.', 'your roll number', 'your student id']),
    batch:    getCleanVal(saved.batch, '', ['your batch', 'batch']),
    examDate: (saved.examDate || '').trim(),
  };
}

function getDisplayName() {
  const nameVal = (liveProfile.name || '').trim();
  if (nameVal && nameVal.toLowerCase() !== 'your name') {
    return nameVal;
  }
  return '';
}

// Mutable live profile — updated on settings save without page reload
let liveProfile = loadProfile();

function getInitials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

function updateTopbarProfile() {
  liveProfile = loadProfile();
  const nameToDisplay = getDisplayName();
  const av = document.getElementById('topbar-avatar');
  if (av) {
    if (nameToDisplay) {
      av.textContent = getInitials(nameToDisplay);
      av.title       = nameToDisplay;
    } else {
      av.textContent = '?';
      av.title       = 'Set up your profile';
    }
  }
  // Sidebar semester label
  const semLabel = document.getElementById('sidebar-semester-label');
  if (semLabel) {
    const parts = [liveProfile.branch, liveProfile.year].filter(Boolean);
    semLabel.textContent = parts.length ? parts.join(' · ') : 'Clarity Desk';
    semLabel.title = semLabel.textContent;
  }
}

// ── Assignments (status overrides from localStorage) ──────────
function loadAssignments() {
  const saved = safeGetStorage(KEY_ASSIGNMENTS, {}) || {};
  return ASSIGNMENTS.map(a => ({ ...a, status: saved[a.id] ?? a.status }));
}

function saveAssignments() {
  const map = {};
  state.assignments.forEach(a => { map[a.id] = a.status; });
  safeSetStorage(KEY_ASSIGNMENTS, map);
  syncToCloud();
}

// ── Firebase Configuration & Cloud Sync ───────────────────────
const DEFAULT_FIREBASE_CONFIG = {
  apiKey:            "AIzaSyD1st-UB9NbBme9z-8M0upwJ0ndQrr8J2E",
  authDomain:        "campusos-83365.firebaseapp.com",
  projectId:         "campusos-83365",
  storageBucket:     "campusos-83365.appspot.com",
  messagingSenderId: "248625780152",
  appId:             "1:248625780152:web:555bfb8bdf0b42ba776b4d"
};

function isValidFirebaseConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (!cfg.apiKey || typeof cfg.apiKey !== 'string') return false;
  if (cfg.apiKey.includes('Demo') || cfg.apiKey.length < 20) return false;
  if (!cfg.projectId || cfg.projectId.includes('demo')) return false;
  return true;
}

function getFirebaseConfig() {
  if (window.CAMPUS_OS_FIREBASE_CONFIG && isValidFirebaseConfig(window.CAMPUS_OS_FIREBASE_CONFIG)) {
    return window.CAMPUS_OS_FIREBASE_CONFIG;
  }
  const saved = safeGetStorage('cos_firebase_config', null);
  if (saved && isValidFirebaseConfig(saved)) {
    return saved;
  }
  return DEFAULT_FIREBASE_CONFIG;
}

let db = null;
let auth = null;
let currentUser = null;
let cloudUnsubscribe = null;
let firebaseInitError = null;

function initFirebase() {
  firebaseInitError = null;
  const cfg = getFirebaseConfig();

  if (typeof firebase !== 'undefined' && firebase.apps) {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(cfg);
      }
      auth = firebase.auth();

      // Initialize Firestore with recommended cache settings (eliminates enableMultiTabIndexedDbPersistence deprecation)
      db = firebase.firestore();
      try {
        if (typeof firebase.firestore.persistentLocalCache === 'function') {
          const tabManager = (typeof firebase.firestore.persistentMultipleTabManager === 'function')
            ? firebase.firestore.persistentMultipleTabManager()
            : undefined;
          db.settings({
            localCache: firebase.firestore.persistentLocalCache(tabManager ? { tabManager } : {})
          });
        }
      } catch (cacheErr) {
        // Graceful fallback if offline IndexedDB is restricted in browser context (e.g. private browsing)
        console.info("Firestore cache note (non-fatal):", cacheErr?.message || cacheErr);
      }

      // Process redirect authentication result if Returning from redirect sign-in
      auth.getRedirectResult().then(result => {
        if (result && result.user) {
          currentUser = result.user;
          updateSyncUI();
          if (state.currentPage === 'settings') renderSettings();
        }
      }).catch(err => {
        console.warn("Firebase redirect auth result error:", err);
        handleAuthError(err);
      });

      auth.onAuthStateChanged(user => {
        currentUser = user;
        updateSyncUI();
        if (user) {
          subscribeUserCloudData(user.uid);
        } else {
          if (cloudUnsubscribe) { cloudUnsubscribe(); cloudUnsubscribe = null; }
        }
        if (state.currentPage === 'settings') renderSettings();
      });
    } catch (e) {
      console.warn("Firebase initialization error:", e);
      firebaseInitError = e.message || "Failed to initialize Firebase SDK.";
      updateSyncUI();
    }
  } else {
    firebaseInitError = "Firebase SDK not loaded. Please check your internet connection or ad blocker.";
    console.warn(firebaseInitError);
    updateSyncUI();
  }
}

// triggerConfetti removed — calm confirmation used instead


function showToast(msg, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '0.95rem';
  iconSpan.textContent = type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️';
  
  const textSpan = document.createElement('span');
  textSpan.textContent = msg;

  toast.appendChild(iconSpan);
  toast.appendChild(textSpan);
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function updateSyncUI(status = null) {
  const icon = document.getElementById('sync-icon');
  const text = document.getElementById('sync-text');
  const dot  = document.querySelector('.storage-status-dot');
  const btn  = document.getElementById('sync-status-btn');
  if (!btn && !icon) return;

  const isOnline = typeof navigator !== 'undefined' && ('onLine' in navigator) ? navigator.onLine : true;

  if (status === 'denied') {
    if (icon) icon.textContent = '🔒';
    if (text) text.textContent = 'Sync denied';
    if (dot) dot.style.background = 'var(--red)';
    if (btn) btn.title = 'Access Denied — check cloud Firestore permissions in Settings';
  } else if (status === 'offline' || !isOnline) {
    if (icon) icon.textContent = '💾';
    if (text) text.textContent = 'Offline · Saved';
    if (dot) dot.style.background = 'var(--yellow)';
    if (btn) btn.title = 'Working offline · All changes are saved locally to this device';
  } else if (currentUser) {
    if (icon) icon.textContent = '⚡';
    if (text) text.textContent = 'Cloud synced';
    if (dot) dot.style.background = 'var(--green)';
    if (btn) btn.title = 'Cloud sync active · Saved locally & synced to your account';
  } else {
    if (icon) icon.textContent = '💾';
    if (text) text.textContent = 'Saved locally';
    if (dot) dot.style.background = 'var(--green)';
    if (btn) btn.title = 'Local offline storage active · All data is saved automatically on this device';
  }
}

// ── Vision AI Service (Groq primary → Gemini fallback) ────────
const AIService = {
  GROQ_MODEL: 'qwen/qwen3.6-27b',
  MODEL: 'gemini-2.5-flash',
  FALLBACK_MODELS: ['gemini-2.0-flash', 'gemini-1.5-flash'],

  getApiKey() {
    if (window.CAMPUS_OS_GEMINI_KEY) return window.CAMPUS_OS_GEMINI_KEY;
    const envKey = (typeof process !== 'undefined' && process.env && (process.env.VITE_GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY));
    if (envKey) return envKey;
    return null;
  },

  getGroqKey() {
    if (window.CAMPUS_OS_GROQ_KEY) return window.CAMPUS_OS_GROQ_KEY;
    const envKey = (typeof process !== 'undefined' && process.env && (process.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY));
    if (envKey) return envKey;
    return null;
  },

  getModelsList() {
    return [this.MODEL, ...this.FALLBACK_MODELS];
  },

  async callGroqText(ocrText, promptText) {
    const key = this.getGroqKey();
    if (!key) throw new Error('No Groq API key configured.');
    
    console.log(`[AIService] Attempting extraction with Groq model: ${this.GROQ_MODEL}`);
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.GROQ_MODEL,
        messages: [
          { role: "system", content: "You are an expert AI that structures raw OCR data into valid JSON." },
          { role: "user", content: promptText + "\n\nRaw OCR Text:\n" + ocrText }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });
    
    if (!response.ok) {
      const errObj = await response.json().catch(() => ({}));
      const rawMsg = errObj.error?.message || `HTTP ${response.status} from Groq`;
      throw new Error(`Groq (${this.GROQ_MODEL}): ${rawMsg}`);
    }
    
    const resData = await response.json();
    const rawText = resData.choices?.[0]?.message?.content || '';
    
    const parsed = safeParseGeminiJson(rawText);
    if (!parsed) {
      throw new Error(`Groq returned unparseable content.`);
    }
    console.log(`[AIService] ✅ Extraction succeeded with Groq:`, parsed);
    return parsed;
  },

  async generateContentFromText(ocrText, promptText) {
    let lastError = null;

    try {
      return await this.callGroqText(ocrText, promptText);
    } catch (err) {
      lastError = err;
      console.warn(`[AIService] Groq text failed:`, err.message || err);
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(lastError ? lastError.message : 'No AI API key configured.');
    }

    const models = this.getModelsList();
    for (const model of models) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      try {
        console.log(`[AIService] Attempting extraction with Gemini model: ${model}`);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: promptText },
                { text: "\n\nRaw OCR Text:\n" + ocrText }
              ]
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1
            }
          })
        });

        if (!response.ok) {
          const errObj = await response.json().catch(() => ({}));
          const rawMsg = errObj.error?.message || `HTTP ${response.status} from ${model}`;
          throw new Error(friendlyGeminiError(response.status, rawMsg));
        }

        const resData = await response.json();
        const candidate = resData.candidates?.[0];

        const finishReason = candidate?.finishReason;
        if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
          throw new Error(`Gemini blocked the response (reason: ${finishReason}). Try a clearer image.`);
        }

        const rawText = candidate?.content?.parts?.[0]?.text || '';
        const parsed = safeParseGeminiJson(rawText);
        if (!parsed) {
          throw new Error(`Model ${model} returned unparseable content. Raw: ${rawText.slice(0, 120)}`);
        }
        console.log(`[AIService] ✅ Extraction succeeded with model: ${model}`, parsed);
        return parsed;
      } catch (err) {
        lastError = new Error(`${lastError ? lastError.message + ' (Gemini Fallback: ' + (err.message || err) + ')' : (err.message || err)}`);
        console.warn(`[AIService] Model attempt ${model} failed:`, err.message || err);
      }
    }

    throw lastError || new Error('AI service unavailable. Please try again later.');
  }
};


// Strips markdown code fences (```json ... ```) that Gemini sometimes wraps around JSON responses,
// then safely attempts JSON.parse. Returns null (not throws) if content is unparseable.
function safeParseGeminiJson(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim();

  // Remove leading ```json or ``` fence and trailing ```
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // If still not starting with { or [, attempt to extract the first {...} block
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    console.warn('[safeParseGeminiJson] Response does not start with { or [. Attempting substring extraction.');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    cleaned = match[0];
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('[safeParseGeminiJson] JSON.parse failed after cleanup:', e.message, '| Snippet:', cleaned.slice(0, 120));
    return null;
  }
}

// Converts raw Gemini API error messages into short, user-friendly strings.
function friendlyGeminiError(httpStatus, rawMsg) {
  const m = (rawMsg || '').toLowerCase();
  if (httpStatus === 429 || m.includes('quota') || m.includes('rate') || m.includes('limit')) {
    return 'The AI extraction service has reached its usage limit for now. Please wait a few minutes and try again, or enter your timetable manually.';
  }
  if (httpStatus === 403 || m.includes('api key') || m.includes('permission') || m.includes('unauthorized')) {
    return 'AI service authentication error. The Gemini API key may be invalid or restricted.';
  }
  if (httpStatus === 404 || m.includes('not found') || m.includes('not supported')) {
    return 'The AI model is currently unavailable. Trying a fallback model…';
  }
  if (httpStatus >= 500 || m.includes('internal') || m.includes('server error')) {
    return 'Google AI service is temporarily unavailable. Please try again in a moment.';
  }
  // Truncate any other raw message at 160 chars
  return rawMsg.length > 160 ? rawMsg.slice(0, 157) + '…' : rawMsg;
}

function updateTimetableLoadingModal(msg) {
  const backdrop = document.getElementById('tt-loading-backdrop');
  if (backdrop) {
    const msgEl = backdrop.querySelector('.loading-msg');
    if (msgEl) msgEl.textContent = msg;
  } else {
    showTimetableLoadingModal(msg);
  }
}

function showTimetableLoadingModal(msg = "Analyzing photo...") {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'tt-loading-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:360px;text-align:center;padding:32px 24px">
      <div style="font-size:2rem;margin-bottom:12px;animation:spin 1.5s linear infinite">✨</div>
      <div style="font-weight:700;font-size:1rem;margin-bottom:6px" class="loading-msg">${msg}</div>
      <div style="font-size:0.8rem;color:var(--text-muted)">Extracting weekly schedule...</div>
    </div>
  `;
  document.body.appendChild(backdrop);
}

// ── Lazy-Loaded OCR Engine & Worker Cache ─────────────────────
let _tesseractWorker = null;
let _tesseractWorkerPromise = null;
let _tesseractScriptPromise = null;
let _isOcrBusy = false;

function loadTesseractScriptOnDemand() {
  if (typeof window !== 'undefined' && window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (_tesseractScriptPromise) return _tesseractScriptPromise;

  _tesseractScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => {
      console.log('[TesseractLazy] Local OCR engine library loaded on-demand.');
      resolve(window.Tesseract);
    };
    script.onerror = (err) => {
      _tesseractScriptPromise = null;
      console.error('[TesseractLazy] Failed to fetch Tesseract library:', err);
      reject(new Error('Failed to load local OCR engine library. Check your network connection.'));
    };
    document.head.appendChild(script);
  });

  return _tesseractScriptPromise;
}

async function getTesseractWorker(onProgress = null) {
  if (_tesseractWorker) return _tesseractWorker;
  if (_tesseractWorkerPromise) return _tesseractWorkerPromise;

  _tesseractWorkerPromise = (async () => {
    try {
      await loadTesseractScriptOnDemand();
      console.log('[TesseractWorker] Initializing single reusable OCR worker (eng fast)...');
      
      const worker = await window.Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            const pct = Math.round((m.progress || 0) * 100);
            if (typeof onProgress === 'function') onProgress(pct);
            if (typeof updateAttendanceScanLoadingProgress === 'function') {
              updateAttendanceScanLoadingProgress(pct);
            }
            if (m.progress % 0.2 < 0.05) {
              console.log(`[TesseractWorker] OCR Progress: ${pct}%`);
            }
          }
        }
      });
      _tesseractWorker = worker;
      console.log('[TesseractWorker] ✅ Single reusable OCR worker ready and cached.');
      return _tesseractWorker;
    } catch (err) {
      _tesseractWorker = null;
      _tesseractWorkerPromise = null;
      console.error('[TesseractWorker] ❌ Worker init failed:', err);
      throw err;
    }
  })();

  return _tesseractWorkerPromise;
}

function preprocessImageForOCR(base64Data, mimeType) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      let width = img.width;
      let height = img.height;

      // 1. Target upscaling: upscale narrow/low-res photos for crisp OCR character recognition
      const TARGET_MIN_WIDTH = 1400;
      if (width < TARGET_MIN_WIDTH) {
        const scale = Math.min(2.0, TARGET_MIN_WIDTH / width);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      // Cap at reasonable max to keep memory low and local OCR fast
      const MAX_DIM = 2000;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      // 2. Grayscale & contrast enhancement with dynamic range expansion & soft S-curve
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      let minL = 255, maxL = 0;
      const grayValues = new Uint8ClampedArray(data.length / 4);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        grayValues[j] = gray;
        if (gray < minL) minL = gray;
        if (gray > maxL) maxL = gray;
      }

      const range = Math.max(1, maxL - minL);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const normalized = Math.min(255, Math.max(0, Math.round(((grayValues[j] - minL) / range) * 255)));
        // Soft S-curve boost to keep font edges anti-aliased while whitening light backgrounds
        const boosted = normalized < 130 
          ? Math.round(Math.pow(normalized / 130, 1.35) * 115) 
          : Math.min(255, Math.round(115 + Math.pow((normalized - 130) / 125, 0.75) * 140));
        data[i] = boosted;
        data[i + 1] = boosted;
        data[i + 2] = boosted;
      }

      ctx.putImageData(imageData, 0, 0);

      // 3. Margin & noise trimming (with safe 24px padding to prevent header clipping)
      let top = 0, bottom = height - 1, left = 0, right = width - 1;
      const darkPixelThreshold = 100;

      for (let y = 0; y < height; y++) {
        let darks = 0;
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4] < darkPixelThreshold) darks++;
        }
        if (darks > width * 0.015) { top = y; break; }
      }

      for (let y = height - 1; y >= top; y--) {
        let darks = 0;
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4] < darkPixelThreshold) darks++;
        }
        if (darks > width * 0.015) { bottom = y; break; }
      }

      for (let x = 0; x < width; x++) {
        let darks = 0;
        for (let y = top; y <= bottom; y++) {
          if (data[(y * width + x) * 4] < darkPixelThreshold) darks++;
        }
        if (darks > (bottom - top) * 0.015) { left = x; break; }
      }

      for (let x = width - 1; x >= left; x--) {
        let darks = 0;
        for (let y = top; y <= bottom; y++) {
          if (data[(y * width + x) * 4] < darkPixelThreshold) darks++;
        }
        if (darks > (bottom - top) * 0.015) { right = x; break; }
      }

      const pad = 24;
      top = Math.max(0, top - pad);
      bottom = Math.min(height - 1, bottom + pad);
      left = Math.max(0, left - pad);
      right = Math.min(width - 1, right + pad);

      const trimW = Math.max(10, right - left + 1);
      const trimH = Math.max(10, bottom - top + 1);

      const trimmedCanvas = document.createElement('canvas');
      trimmedCanvas.width = trimW;
      trimmedCanvas.height = trimH;
      const trimmedCtx = trimmedCanvas.getContext('2d');
      trimmedCtx.drawImage(canvas, left, top, trimW, trimH, 0, 0, trimW, trimH);

      const resultDataUrl = trimmedCanvas.toDataURL(mimeType, 0.92);

      // Free buffers immediately to avoid memory leaks
      canvas.width = 1;
      canvas.height = 1;
      trimmedCanvas.width = 1;
      trimmedCanvas.height = 1;

      resolve(resultDataUrl);
    };
    img.onerror = () => reject(new Error("Failed to load image for timetable preprocessing"));
    img.src = `data:${mimeType};base64,${base64Data}`;
  });
}

// ── Robust Time Normalizer ──────────────────────────────────────
function normalizeTimetableTime(timeRaw, defaultEndHours = 1) {
  if (!timeRaw || typeof timeRaw !== 'string') return { time: '', end: '', isValid: false };
  let str = timeRaw.trim()
    .replace(/[OoQ](?=\d|:|\s|$)/g, '0')
    .replace(/(?<=\d|:|\s|^)[OoQ]/g, '0')
    .replace(/(?<=\s|^)[lI|i](?=\d|:)/g, '1')
    .replace(/\s+/g, ' ');

  // Range match e.g. "09:00 - 10:00", "9.00 to 10.30", "1:00 - 2:00 pm"
  const rangeMatch = str.match(/(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?\s*(?:-|to|~|–|—)\s*(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i);
  if (rangeMatch) {
    let h1 = parseInt(rangeMatch[1], 10);
    let m1 = parseInt(rangeMatch[2] || '00', 10);
    let mer1 = rangeMatch[3] ? rangeMatch[3].toLowerCase() : '';

    let h2 = parseInt(rangeMatch[4], 10);
    let m2 = parseInt(rangeMatch[5] || '00', 10);
    let mer2 = rangeMatch[6] ? rangeMatch[6].toLowerCase() : '';

    if (mer2 === 'pm' && !mer1 && h1 < 12 && h2 <= 12) {
      if (h1 < h2) h1 += 12;
      if (h2 < 12) h2 += 12;
    } else if (mer1 === 'pm' && h1 < 12) {
      h1 += 12;
    }
    if (mer2 === 'pm' && h2 < 12) {
      h2 += 12;
    }

    // College afternoon heuristic for non-AM/PM timetables
    if (!mer1 && !mer2) {
      if (h1 >= 1 && h1 <= 6) h1 += 12;
      if (h2 >= 1 && h2 <= 7 && h2 < h1) h2 += 12;
      else if (h2 >= 1 && h2 <= 6 && h1 >= 12) h2 += 12;
    }

    if (h1 >= 0 && h1 <= 23 && m1 >= 0 && m1 <= 59 && h2 >= 0 && h2 <= 23 && m2 >= 0 && m2 <= 59) {
      const t1 = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
      const t2 = `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
      return { time: t1, end: t2, isValid: true };
    }
  }

  // Single timestamp e.g. "09:00", "10:30 AM"
  const singleMatch = str.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/i);
  if (singleMatch) {
    let h1 = parseInt(singleMatch[1], 10);
    let m1 = parseInt(singleMatch[2], 10);
    let mer = singleMatch[3] ? singleMatch[3].toLowerCase() : '';

    if (mer === 'pm' && h1 < 12) h1 += 12;
    if (!mer && h1 >= 1 && h1 <= 6) h1 += 12;

    if (h1 >= 0 && h1 <= 23 && m1 >= 0 && m1 <= 59) {
      const t1 = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
      let endH = (h1 + defaultEndHours) % 24;
      const t2 = `${String(endH).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
      return { time: t1, end: t2, isValid: true };
    }
  }

  return { time: '', end: '', isValid: false };
}

// ── Day Standardizer ───────────────────────────────────────────
const DAY_ALIASES = {
  mon: 'Mon', monday: 'Mon', m0n: 'Mon', mo: 'Mon',
  tue: 'Tue', tuesday: 'Tue', tu: 'Tue', tues: 'Tue', tu3: 'Tue',
  wed: 'Wed', wednesday: 'Wed', we: 'Wed', w3d: 'Wed',
  thu: 'Thu', thursday: 'Thu', th: 'Thu', thur: 'Thu', thurs: 'Thu',
  fri: 'Fri', friday: 'Fri', fr: 'Fri', fr1: 'Fri',
  sat: 'Sat', saturday: 'Sat', sa: 'Sat'
};

function standardizeTimetableDay(rawDay) {
  if (!rawDay || typeof rawDay !== 'string') return '';
  const clean = rawDay.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [alias, standard] of Object.entries(DAY_ALIASES)) {
    if (clean === alias || clean.startsWith(alias) || (alias.length >= 3 && clean.includes(alias))) {
      return standard;
    }
  }
  return '';
}

// ── Precision Timetable Cell Sanitizer & Canonical Subject Normalizer ─
const TIMETABLE_NON_CLASS_KEYWORDS = [
  'lunch', 'break', 'recess', 'tea break', 'interval',
  'free', 'library', 'sports', 'mentoring', 'assembly',
  'no class', 'holiday', 'gap', 'vacant', 'off period'
];

const TIMETABLE_JUNK_TOKENS = new Set([
  'timetable', 'time table', 'schedule', 'semester', 'sem', 'academic year',
  'class', 'period', 'room no', 'lecture', 'theory', 'lab', 'practical',
  'tutorial', 'batch', 'section', 'day', 'time', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat',
  'slot', 'hours', 'hr', 'dept', 'department', 'college', 'university',
  'sr', 'no', 'code', 'subject', 'faculty', 'room', 'venue', 'timing'
]);

const BATCH_PATTERN = /\b(?:Batch(?:es)?|Sec(?:tion)?|Grp|Group)?\s*[:\-\s]*\b([A-D][1-4]|[A-D](?![a-z])|[1-4](?![0-9]))\b/gi;
const BRACKETED_BATCH_PATTERN = /\((?:AI-)?([A-D][1-4](?:[\s,/-]+(?:AI-)?[A-D][1-4])*)\)/i;
const SUBJECT_CODE_PATTERN = /\b([A-Z]{2,8}[0-9]{1,4}[A-Z]{1,4}[0-9]{1,4}[A-Z]?|[A-Z]{2,6}[-\s]?[0-9]{2,5}[A-Z]?|[0-9]{2}[A-Z]{2,6}[0-9]{2,4})\b/i;
const FACULTY_TITLE_PATTERN = /\b(?:Prof\.?|Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Shri|Smt\.?)\s+[A-Za-z]+(?:\s+(?!LH|LT|CR|Room|Lab|Cabin|Hall|Batch|Sec)[A-Za-z]+)?/gi;
const ROOM_PATTERN = /\b(?:Room|LT|CR|LH|Cabin|Hall|SF|FF|GF|WS)[-.\s]*(?:\d+[A-Z]?|[A-D]\b)|\bLab[-.\s]*\d+[A-Z]?\b|\b(?:G|F|S|T)-\d{2,3}\b|\b[A-Z]{1,2}-\d{2,3}\b/i;

function extractBatchTags(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const batches = new Set();

  // 1. Check all bracketed expressions e.g. (AI-A2, B2), (Sec B), (Batch D1)
  const bracketMatches = rawText.match(/\(([^)]+)\)/g);
  if (bracketMatches) {
    bracketMatches.forEach(bracket => {
      const inner = bracket.replace(/^\(|\)$/g, '').trim();
      const parts = inner.split(/[\s,/-]+/).map(p => p.replace(/^AI-/i, '').replace(/^(?:Sec|Section|Batch|Grp|Group)[:\-\s]*/i, '').trim().toUpperCase());
      parts.forEach(p => {
        if (/^[A-D][1-4]$|^[A-D]$/.test(p)) batches.add(p);
      });
    });
  }

  // 2. Check standalone batch markers e.g. "Batch A2", "Sec B", "Batch D1"
  let match;
  const regex = new RegExp(BATCH_PATTERN.source, 'gi');
  while ((match = regex.exec(rawText)) !== null) {
    const tag = match[1].toUpperCase();
    if (/^[A-D][1-4]$|^[A-D]$/.test(tag)) {
      batches.add(tag);
    }
  }

  return Array.from(batches);
}

function normalizeSubjectIdentity(rawText, existingSubjects = [], forceType = null) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      canonicalName: '',
      canonicalCode: '',
      classType: 'lecture',
      batches: [],
      room: '',
      teacher: '',
      isLab: false
    };
  }

  let text = rawText.trim().replace(/\r\n|\r/g, '\n');

  // 1. Extract Batch tags
  const batches = extractBatchTags(text);

  // 2. Extract Faculty
  let teacher = '';
  const teacherMatch = text.match(FACULTY_TITLE_PATTERN);
  if (teacherMatch) {
    teacher = teacherMatch[0].trim();
    text = text.replace(teacherMatch[0], ' ');
  }

  // 3. Extract Room
  let room = '';
  const roomMatch = text.match(ROOM_PATTERN);
  if (roomMatch && !/^(19|20)\d\d$/.test(roomMatch[0])) {
    room = roomMatch[0].trim().replace(/\s+/g, '-');
    text = text.replace(roomMatch[0], ' ');
  }

  // 4. Extract Course Code (including inside parentheses like (CS401) or (AID21PCL202))
  let code = '';
  const codeMatch = text.match(SUBJECT_CODE_PATTERN);
  if (codeMatch && codeMatch[1].length >= 3) {
    const candidateCode = codeMatch[1].replace(/\s+/g, '').toUpperCase();
    if (/[0-9]/.test(candidateCode) || candidateCode.length <= 5) {
      code = candidateCode;
      text = text.replace(codeMatch[0], ' ');
    }
  }

  // Strip all remaining bracketed expressions e.g. (AI-A2, B2) or (CE) or (Batch 1)
  text = text.replace(/\([^)]*\)/g, ' ');
  text = text.replace(/\[[^\]]*\]/g, ' ');
  text = text.replace(/\b(?:Batch(?:es)?|Sec(?:tion)?)\s*[:\-\s]*[A-D0-9,\s/-]+\b/gi, ' ');

  // 5. Detect Class Type & Lab markers
  let classType = forceType || 'lecture';
  const isLabExplicit = /\b(?:lab|practical|workshop|hands-on|pr)\b/i.test(text) || /\b(?:lab|ws)\b/i.test(room);
  const isTutorial = /\b(?:tutorial|tut)\b/i.test(text);
  const isProject = /\b(?:project|seminar|viva)\b/i.test(text);

  if (forceType) {
    classType = forceType;
  } else if (isLabExplicit) {
    classType = 'lab';
  } else if (isTutorial) {
    classType = 'tutorial';
  } else if (isProject) {
    classType = 'project';
  }

  // Strip type keywords from title candidate
  text = text
    .replace(/\b(?:laboratory|lab|practical|tutorial|tut|lecture|theory|project|seminar|workshop)\b/gi, ' ')
    .replace(/\b(?:credits?|hours?|hrs?|periods?|sem(?:ester)?\s*(?:[1-8]|i{1,3}|iv|v|vi{0,3})?)\b/gi, ' ');

  // If code was not found earlier, try again on cleaned text
  if (!code) {
    const codeMatch2 = text.match(SUBJECT_CODE_PATTERN);
    if (codeMatch2 && codeMatch2[1].length >= 3) {
      const candidateCode = codeMatch2[1].replace(/\s+/g, '').toUpperCase();
      if (/[0-9]/.test(candidateCode) || candidateCode.length <= 5) {
        code = candidateCode;
        text = text.replace(codeMatch2[0], ' ');
      }
    }
  }

  // 6. Clean Subject Name words
  text = text.replace(/^\d+[\s.\-–)]+/, '');
  let cleanName = text
    .replace(/[^a-zA-Z0-9\s/&+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleanName.split(' ').filter(w => {
    const wLow = w.toLowerCase();
    if (w.length <= 1 && !['c', 'r'].includes(wLow)) return false;
    if (TIMETABLE_JUNK_TOKENS.has(wLow)) return false;
    if (/^[A-D][1-4]$/i.test(w)) return false;
    if (/^\d+$/.test(w)) return false;
    return true;
  });

  cleanName = words.join(' ').trim();

  // Normalize common subject abbreviations / names
  const CANONICAL_SUBJECT_MAP = {
    'ds': 'Data Structures',
    'data structure': 'Data Structures',
    'demp': 'Digital Electronics and Microprocessors',
    'digital electronics': 'Digital Electronics and Microprocessors',
    'digital electronics and microprocessor': 'Digital Electronics and Microprocessors',
    'pbst': 'Probability and Statistics',
    'probability statistics': 'Probability and Statistics',
    'probability & statistics': 'Probability and Statistics',
    'probability and statistic': 'Probability and Statistics',
    'bmfa': 'Business Management and Financial Accounting',
    'business management': 'Business Management and Financial Accounting',
    'coi': 'Constitution of India',
    'ce': 'Community Engagement',
    'web dev': 'Web Development',
    'web development': 'Web Development',
    'os': 'Operating Systems',
    'operating system': 'Operating Systems',
    'dbms': 'Database Management Systems',
    'database management': 'Database Management Systems',
    'ai': 'Artificial Intelligence',
    'ml': 'Machine Learning',
    'cn': 'Computer Networks',
    'computer network': 'Computer Networks'
  };

  const lowerClean = cleanName.toLowerCase();
  if (CANONICAL_SUBJECT_MAP[lowerClean]) {
    cleanName = CANONICAL_SUBJECT_MAP[lowerClean];
  }

  // If Lab variant, standardize name with 'Lab' suffix
  if (classType === 'lab' && cleanName && !/\blab\b/i.test(cleanName)) {
    cleanName = `${cleanName} Lab`;
    if (code && !code.endsWith('-LAB') && !code.endsWith('LAB') && !code.endsWith('P')) {
      code = `${code}-LAB`;
    }
  }

  // Match against existing subjects
  if (existingSubjects && existingSubjects.length > 0) {
    const cleanNoSpaces = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanCodeNoSpaces = code.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const ex of existingSubjects) {
      const exName = (ex.name || ex.subject || '').trim();
      const exCode = (ex.code || '').trim();
      const exNameClean = exName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const exCodeClean = exCode.toLowerCase().replace(/[^a-z0-9]/g, '');

      const exIsLab = /\blab\b/i.test(exName) || (ex.type === 'lab');
      if (exIsLab !== (classType === 'lab')) continue;

      if (cleanCodeNoSpaces && exCodeClean && cleanCodeNoSpaces === exCodeClean) {
        cleanName = exName;
        code = exCode;
        break;
      }
      if (cleanNoSpaces && exNameClean && cleanNoSpaces === exNameClean) {
        cleanName = exName;
        code = exCode || code;
        break;
      }
    }
  }

  const confidence = (cleanName && cleanName !== 'General Subject') ? (code ? 95 : 85) : (code ? 80 : 50);

  return {
    raw_label: rawText,
    normalized_subject_name: cleanName || code || 'General Subject',
    canonicalName: cleanName || code || 'General Subject',
    canonicalCode: code || '',
    code: code || '',
    subject_kind: classType,
    classType,
    batch_tags: batches,
    batches,
    room,
    faculty: teacher,
    teacher,
    isLab: classType === 'lab',
    normalization_confidence: confidence
  };
}

function shouldKeepClassForUserBatch(classItem, userBatch = 'all') {
  if (!userBatch || userBatch.toLowerCase() === 'all') return true;

  const itemBatches = classItem.batches || extractBatchTags(classItem.subject || '');
  if (!itemBatches || itemBatches.length === 0) return true;

  const cleanUserBatch = userBatch.toUpperCase().trim();
  if (itemBatches.includes(cleanUserBatch)) return true;

  const userLetter = cleanUserBatch.charAt(0);
  if (itemBatches.includes(userLetter)) return true;

  return false;
}

function cleanupTimetableDomain(rawText, existingSubjects = []) {
  if (!rawText || typeof rawText !== 'string') {
    return { subject: '', code: '', room: '', teacher: '', type: 'lecture', batches: [], isOff: false, isUncertain: true };
  }

  let text = rawText.trim().replace(/\r\n|\r/g, '\n');
  const lower = text.toLowerCase();

  // Check if non-class / break period
  for (const kw of TIMETABLE_NON_CLASS_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(lower)) {
      return {
        subject: kw.toUpperCase(),
        code: '',
        room: '',
        teacher: '',
        type: 'off',
        batches: [],
        isOff: true,
        isUncertain: false
      };
    }
  }

  // Strip time strings so times never pollute room numbers, batch tokens, or codes
  text = text
    .replace(/\b([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\s*(?:am|pm)?\s*(?:-|to|~|–|—)\s*([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, ' ');

  const norm = normalizeSubjectIdentity(text, existingSubjects);

  return {
    subject: norm.canonicalName,
    code: norm.canonicalCode,
    room: norm.room,
    teacher: norm.teacher,
    type: norm.classType,
    batches: norm.batches,
    isOff: false,
    isUncertain: !norm.canonicalName
  };
}

// ── Table-Aware 2D Grid Reconstructor ────────────────────────────
function reconstructTimetable2DGrid(ocrData, existingSubjects = []) {
  if (!ocrData || !ocrData.words || ocrData.words.length === 0) {
    return { schedule: [], confidence: 0, ambiguous: true };
  }

  const words = ocrData.words.map(w => ({
    text: (w.text || '').trim(),
    bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
    conf: w.confidence || 0,
    cx: ((w.bbox?.x0 || 0) + (w.bbox?.x1 || 0)) / 2,
    cy: ((w.bbox?.y0 || 0) + (w.bbox?.y1 || 0)) / 2
  })).filter(w => w.text.length > 0);

  // 1. Identify Day Tokens and Time Tokens with coordinates
  const dayTokens = [];
  const timeTokens = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const cleanWord = w.text.toLowerCase().replace(/[^a-z]/g, '');
    const stdDay = standardizeTimetableDay(cleanWord);
    if (stdDay && (cleanWord.length >= 3 || ['mon','tue','wed','thu','fri','sat'].includes(cleanWord))) {
      dayTokens.push({ word: w, stdDay, cx: w.cx, cy: w.cy });
      continue;
    }

    // Check single word or multi-word window for time range
    const timeWin1 = normalizeTimetableTime(w.text);
    if (timeWin1.isValid) {
      timeTokens.push({ words: [w], timeNorm: timeWin1, cx: w.cx, cy: w.cy });
    } else if (i < words.length - 1) {
      const pairText = `${w.text} ${words[i+1].text}`;
      const timeWin2 = normalizeTimetableTime(pairText);
      if (timeWin2.isValid) {
        const cx = (w.cx + words[i+1].cx) / 2;
        const cy = (w.cy + words[i+1].cy) / 2;
        timeTokens.push({ words: [w, words[i+1]], timeNorm: timeWin2, cx, cy });
        i++;
      } else if (i < words.length - 2) {
        const tripText = `${w.text} ${words[i+1].text} ${words[i+2].text}`;
        const timeWin3 = normalizeTimetableTime(tripText);
        if (timeWin3.isValid) {
          const cx = (w.cx + words[i+2].cx) / 2;
          const cy = (w.cy + words[i+2].cy) / 2;
          timeTokens.push({ words: [w, words[i+1], words[i+2]], timeNorm: timeWin3, cx, cy });
          i += 2;
        }
      }
    }
  }

  // 2. Detect Orientation:
  // Layout A: Rows = Days (stacked vertically), Columns = Times (spread horizontally)
  // Layout B: Rows = Times (stacked vertically), Columns = Days (spread horizontally)
  const dayXSpread = dayTokens.length > 1 ? Math.max(...dayTokens.map(d => d.cx)) - Math.min(...dayTokens.map(d => d.cx)) : 0;
  const dayYSpread = dayTokens.length > 1 ? Math.max(...dayTokens.map(d => d.cy)) - Math.min(...dayTokens.map(d => d.cy)) : 0;
  const timeXSpread = timeTokens.length > 1 ? Math.max(...timeTokens.map(t => t.cx)) - Math.min(...timeTokens.map(t => t.cx)) : 0;
  const timeYSpread = timeTokens.length > 1 ? Math.max(...timeTokens.map(t => t.cy)) - Math.min(...timeTokens.map(t => t.cy)) : 0;

  let isLayoutA = true;
  let isLayoutB = false;

  if (dayXSpread > dayYSpread * 1.5 && timeYSpread >= timeXSpread) {
    isLayoutA = false;
    isLayoutB = true;
  } else if (dayYSpread >= dayXSpread) {
    isLayoutA = true;
    isLayoutB = false;
  }

  const schedule = [];

  if (isLayoutA && dayTokens.length >= 1 && timeTokens.length >= 1) {
    // Layout A: Days are row headers along left, Times are column headers along top
    dayTokens.sort((a, b) => a.cy - b.cy);
    timeTokens.sort((a, b) => a.cx - b.cx);

    const dayIntervals = [];
    for (let i = 0; i < dayTokens.length; i++) {
      const curr = dayTokens[i];
      const prevY = i > 0 ? (dayTokens[i - 1].cy + curr.cy) / 2 : curr.cy - 40;
      const nextY = i < dayTokens.length - 1 ? (curr.cy + dayTokens[i + 1].cy) / 2 : curr.cy + 70;
      dayIntervals.push({ day: curr.stdDay, minY: prevY, maxY: nextY });
    }

    const timeIntervals = [];
    for (let i = 0; i < timeTokens.length; i++) {
      const curr = timeTokens[i];
      const prevX = i > 0 ? (timeTokens[i - 1].cx + curr.cx) / 2 : curr.cx - 60;
      const nextX = i < timeTokens.length - 1 ? (curr.cx + timeTokens[i + 1].cx) / 2 : curr.cx + 90;
      timeIntervals.push({ timeNorm: curr.timeNorm, minX: prevX, maxX: nextX });
    }

    const headerWordSet = new Set([...dayTokens.map(d => d.word), ...timeTokens.flatMap(t => t.words)]);

    dayIntervals.forEach(dInt => {
      timeIntervals.forEach(tInt => {
        const cellWords = words.filter(w => {
          if (headerWordSet.has(w)) return false;
          return w.cy >= dInt.minY && w.cy < dInt.maxY && w.cx >= tInt.minX && w.cx < tInt.maxX;
        });

        if (cellWords.length > 0) {
          cellWords.sort((a, b) => a.bbox.y0 === b.bbox.y0 ? a.bbox.x0 - b.bbox.x0 : a.bbox.y0 - b.bbox.y0);
          const cellRaw = cellWords.map(w => w.text).join(' ');
          if (cellRaw.length >= 2 && !/^(break|lunch|recess|tea|interval)$/i.test(cellRaw.trim())) {
            const norm = normalizeSubjectIdentity(cellRaw, existingSubjects);
            if (norm.canonicalName && !TIMETABLE_JUNK_TOKENS.has(norm.canonicalName.toLowerCase())) {
              schedule.push({
                day: dInt.day,
                time: tInt.timeNorm.time,
                end: tInt.timeNorm.end,
                subject: norm.canonicalName,
                code: norm.canonicalCode,
                room: norm.room,
                teacher: norm.teacher,
                type: norm.classType,
                batches: norm.batches,
                isUncertain: !norm.canonicalName
              });
            }
          }
        }
      });
    });
  } else if (isLayoutB && dayTokens.length >= 1 && timeTokens.length >= 1) {
    // Layout B: Days are column headers along top, Times are row headers along left
    dayTokens.sort((a, b) => a.cx - b.cx);
    timeTokens.sort((a, b) => a.cy - b.cy);

    const dayIntervals = [];
    for (let i = 0; i < dayTokens.length; i++) {
      const curr = dayTokens[i];
      const prevX = i > 0 ? (dayTokens[i - 1].cx + curr.cx) / 2 : curr.cx - 60;
      const nextX = i < dayTokens.length - 1 ? (curr.cx + dayTokens[i + 1].cx) / 2 : curr.cx + 90;
      dayIntervals.push({ day: curr.stdDay, minX: prevX, maxX: nextX });
    }

    const timeIntervals = [];
    for (let i = 0; i < timeTokens.length; i++) {
      const curr = timeTokens[i];
      const prevY = i > 0 ? (timeTokens[i - 1].cy + curr.cy) / 2 : curr.cy - 40;
      const nextY = i < timeTokens.length - 1 ? (curr.cy + timeTokens[i + 1].cy) / 2 : curr.cy + 70;
      timeIntervals.push({ timeNorm: curr.timeNorm, minY: prevY, maxY: nextY });
    }

    const headerWordSet = new Set([...dayTokens.map(d => d.word), ...timeTokens.flatMap(t => t.words)]);

    timeIntervals.forEach(tInt => {
      dayIntervals.forEach(dInt => {
        const cellWords = words.filter(w => {
          if (headerWordSet.has(w)) return false;
          return w.cy >= tInt.minY && w.cy < tInt.maxY && w.cx >= dInt.minX && w.cx < dInt.maxX;
        });

        if (cellWords.length > 0) {
          cellWords.sort((a, b) => a.bbox.y0 === b.bbox.y0 ? a.bbox.x0 - b.bbox.x0 : a.bbox.y0 - b.bbox.y0);
          const cellRaw = cellWords.map(w => w.text).join(' ');
          if (cellRaw.length >= 2 && !/^(break|lunch|recess|tea|interval)$/i.test(cellRaw.trim())) {
            const norm = normalizeSubjectIdentity(cellRaw, existingSubjects);
            if (norm.canonicalName && !TIMETABLE_JUNK_TOKENS.has(norm.canonicalName.toLowerCase())) {
              schedule.push({
                day: dInt.day,
                time: tInt.timeNorm.time,
                end: tInt.timeNorm.end,
                subject: norm.canonicalName,
                code: norm.canonicalCode,
                room: norm.room,
                teacher: norm.teacher,
                type: norm.classType,
                batches: norm.batches,
                isUncertain: !norm.canonicalName
              });
            }
          }
        }
      });
    });
  }

  const confidence = Math.min(98, 75 + schedule.length * 5);
  return { schedule, confidence, ambiguous: schedule.length === 0 };
}

// ── Multi-Strategy Timetable Parser (2D Grid + Geometric Rows + Text Stream) ───
function parseTimetableFromGrid(ocrData, existingSubjects = []) {
  if (!ocrData || !ocrData.words || ocrData.words.length === 0) {
    if (ocrData?.text) {
      const textFallback = parseTimetableFromTextStream(ocrData.text, existingSubjects);
      return { schedule: textFallback, confidence: textFallback.length ? 60 : 0, ambiguous: textFallback.length === 0 };
    }
    return { schedule: [], confidence: 0, ambiguous: true };
  }

  // Strategy 1: Table-Aware 2D Grid Reconstructor (Layout A & Layout B)
  try {
    const gridResult = reconstructTimetable2DGrid(ocrData, existingSubjects);
    if (gridResult.schedule && gridResult.schedule.length > 0) {
      return gridResult;
    }
  } catch (err) {
    console.warn("[TimetableParser] 2D grid reconstructor error, falling back to visual line clusterer:", err);
  }

  // Strategy 2: Visual Line / Card Clusterer (for list/card-based schedules)
  const words = ocrData.words.map(w => ({
    text: (w.text || '').trim(),
    bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
    conf: w.confidence || 0,
    cx: ((w.bbox?.x0 || 0) + (w.bbox?.x1 || 0)) / 2,
    cy: ((w.bbox?.y0 || 0) + (w.bbox?.y1 || 0)) / 2
  })).filter(w => w.text.length > 0);

  words.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const visualLines = [];
  for (const word of words) {
    let added = false;
    for (const line of visualLines) {
      const avgY0 = line.reduce((sum, w) => sum + w.bbox.y0, 0) / line.length;
      const avgY1 = line.reduce((sum, w) => sum + w.bbox.y1, 0) / line.length;
      const wordH = word.bbox.y1 - word.bbox.y0;
      const overlap = Math.max(0, Math.min(word.bbox.y1, avgY1) - Math.max(word.bbox.y0, avgY0));
      if (wordH > 0 && (overlap / wordH) > 0.42) {
        line.push(word);
        added = true;
        break;
      }
    }
    if (!added) visualLines.push([word]);
  }
  visualLines.forEach(l => l.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const schedule = [];
  let currentDay = '';
  let foundCount = 0;

  for (const line of visualLines) {
    const lineStr = line.map(w => w.text).join(' ');
    const firstWord = (line[0]?.text || '').toLowerCase().replace(/[^a-z]/g, '');
    const matchedDay = dayNames.find(d => firstWord === d || firstWord.startsWith(d) || lineStr.toLowerCase().startsWith(d));

    if (matchedDay) {
      currentDay = standardizeTimetableDay(matchedDay);
    }

    const timeNorm = normalizeTimetableTime(lineStr);
    if (timeNorm.isValid) {
      let lineDay = currentDay;
      if (matchedDay) lineDay = standardizeTimetableDay(matchedDay);
      if (!lineDay) lineDay = 'Mon';

      const cell = cleanupTimetableDomain(lineStr, existingSubjects);
      if (!cell.isOff && cell.subject) {
        schedule.push({
          day: lineDay,
          time: timeNorm.time,
          end: timeNorm.end,
          subject: cell.subject,
          code: cell.code || '',
          room: cell.room || '',
          teacher: cell.teacher || '',
          type: cell.type || 'lecture',
          batches: cell.batches || [],
          isUncertain: cell.isUncertain
        });
        foundCount++;
      }
    }
  }

  // Strategy 3: Text stream linear extractor fallback
  if (schedule.length === 0 && ocrData.text) {
    const streamSchedule = parseTimetableFromTextStream(ocrData.text, existingSubjects);
    if (streamSchedule.length > 0) {
      return {
        schedule: streamSchedule,
        confidence: Math.min(90, 35 + streamSchedule.length * 10),
        ambiguous: false
      };
    }
  }

  const confidence = Math.min(95, 30 + foundCount * 12);
  return {
    schedule,
    confidence,
    ambiguous: schedule.length === 0 || confidence < 40
  };
}

// ── Text-Stream / Linear Schedule Extractor ────────────────────
function parseTimetableFromTextStream(rawText, existingSubjects = []) {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const schedule = [];

  let currentDay = '';
  const dayRegex = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Mon|Tue|Wed|Thu|Fri|Sat)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dayMatch = line.match(dayRegex);

    if (dayMatch && (line.length < 25 || /^(?:day|daily|schedule)?\s*[:\-\s]*[A-Za-z]+\s*$/i.test(line))) {
      currentDay = standardizeTimetableDay(dayMatch[1]);
      continue;
    }

    const timeNorm = normalizeTimetableTime(line);
    if (timeNorm.isValid) {
      let lineDay = currentDay;
      if (dayMatch) {
        lineDay = standardizeTimetableDay(dayMatch[1]);
      }
      if (!lineDay) lineDay = 'Mon';

      const cellInfo = cleanupTimetableDomain(line, existingSubjects);
      if (cellInfo.isOff) continue;

      if (cellInfo.subject) {
        schedule.push({
          day: lineDay,
          time: timeNorm.time,
          end: timeNorm.end,
          subject: cellInfo.subject,
          code: cellInfo.code || '',
          room: cellInfo.room || '',
          teacher: cellInfo.teacher || '',
          type: cellInfo.type || 'lecture',
          batches: cellInfo.batches || [],
          isUncertain: cellInfo.isUncertain
        });
      }
    }
  }
  return schedule;
}

async function extractTimetableFromImage(base64Data, mimeType) {
  const existingSubjects = getSubjectList();

  updateTimetableLoadingModal("Preprocessing timetable image (adaptive contrast, scaling)...");
  const preprocessedDataUrl = await preprocessImageForOCR(base64Data, mimeType);
  
  updateTimetableLoadingModal("Scanning timetable text with local OCR...");
  const worker = await getTesseractWorker();
  const ocrResult = await worker.recognize(preprocessedDataUrl);
  
  updateTimetableLoadingModal("Reconstructing schedule rows and matching subjects...");
  let deterministicResult;
  try {
    deterministicResult = parseTimetableFromGrid(ocrResult.data, existingSubjects);
  } catch (err) {
    console.error("[TimetableParser] Error in grid parser, falling back to text stream:", err);
    try {
      const streamFallback = parseTimetableFromTextStream(ocrResult.data?.text || '', existingSubjects);
      deterministicResult = { schedule: streamFallback, confidence: streamFallback.length ? 50 : 0, ambiguous: streamFallback.length === 0 };
    } catch {
      deterministicResult = { schedule: [], confidence: 0, ambiguous: true };
    }
  }
  
  // If deterministic parser extracted classes, return immediately!
  if (deterministicResult.schedule && deterministicResult.schedule.length > 0) {
    return { schedule: deterministicResult.schedule, confidence: Math.max(70, deterministicResult.confidence) };
  }
  
  // AI structured repair fallback (only if user has configured an API key)
  const hasGroqKey = !!window.CAMPUS_OS_GROQ_KEY;
  const hasGeminiKey = !!window.CAMPUS_OS_GEMINI_KEY;

  if (!hasGroqKey && !hasGeminiKey) {
    console.log("[ExtractionPipeline] AI Repair skipped (no API key). Using deterministic output.");
    return deterministicResult;
  }

  updateTimetableLoadingModal("Refining ambiguous timetable entries with AI...");
  const schemaInstruction = `Extract all weekly college class timetable entries from this raw OCR text.
Return JSON matching this exact structure:
{
  "schedule": [
    {
      "day": "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat",
      "time": "10:00",
      "end": "11:00",
      "subject": "Data Structures",
      "code": "DS",
      "room": "LT-2",
      "teacher": "Prof. Name",
      "type": "lecture" | "lab" | "project",
      "isUncertain": false
    }
  ]
}

Rules:
1. Day must be one of: Mon, Tue, Wed, Thu, Fri, Sat.
2. time and end must be 24-hour HH:MM format (e.g. 09:00, 10:30, 14:00).
3. Do not invent fake subjects or rooms if not present in text.
4. If an entry is ambiguous, mark isUncertain: true.`;

  try {
    const rawOcrText = ocrResult.data.text;
    const aiResult = await AIService.generateContentFromText(rawOcrText, schemaInstruction);
    if (aiResult && Array.isArray(aiResult.schedule) && aiResult.schedule.length > 0) {
      // Sanitize AI rows to prevent hallucinations
      const sanitized = aiResult.schedule.map(item => {
        const timeNorm = normalizeTimetableTime(`${item.time || '10:00'} - ${item.end || '11:00'}`);
        return {
          day: standardizeTimetableDay(item.day) || 'Mon',
          time: timeNorm.time || item.time || '10:00',
          end: timeNorm.end || item.end || '11:00',
          subject: (item.subject || '').trim(),
          code: (item.code || '').trim(),
          room: (item.room || '').trim(),
          teacher: (item.teacher || '').trim(),
          type: item.type || 'lecture',
          isUncertain: !!item.isUncertain || !item.subject
        };
      }).filter(r => r.subject.length > 0);

      return { schedule: sanitized.length > 0 ? sanitized : deterministicResult.schedule, confidence: 85 };
    }
    return deterministicResult;
  } catch (err) {
    console.warn("[ExtractionPipeline] AI Repair failed:", err);
    return deterministicResult;
  }
}

function triggerTimetableImport() {
  selectTimetableFile();
}

function selectTimetableFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = handleTimetableImageUpload;
  input.click();
}

function handleTimetableImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  // Validate file type & size (< 12 MB)
  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file (JPG, PNG, WEBP, etc.)');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    alert('Image is too large (max 12 MB). Please compress or crop it first.');
    return;
  }

  showTimetableLoadingModal('Scanning timetable photo…');

  const reader = new FileReader();
  reader.onload = async (e) => {
    let mimeType, base64Data;
    try {
      const resultUrl = e.target.result;
      mimeType   = resultUrl.split(';')[0].split(':')[1] || 'image/jpeg';
      base64Data = resultUrl.split(',')[1];
    } catch {
      document.getElementById('tt-loading-backdrop')?.remove();
      showTimetableUploadErrorModal('Could not read the image file. Please try a different photo.');
      return;
    }

    try {
      const result = await extractTimetableFromImage(base64Data, mimeType);
      document.getElementById('tt-loading-backdrop')?.remove();

      const schedule = result?.schedule || [];

      if (schedule.length === 0) {
        // Extraction found no valid classes
        showTimetableUploadErrorModal(
          'No timetable entries could be extracted from this photo. The image may be blurry, low-contrast, or not a timetable.',
          base64Data, mimeType
        );
        return;
      }

      // ✅ SUCCESS → ALWAYS show preview/edit modal with extracted entries and batch filter
      console.log('[TimetableUpload] Extraction successful. UI transitioning to showTimetablePreviewModal with', schedule.length, 'classes.');
      showTimetablePreviewModal(schedule);

    } catch (err) {
      document.getElementById('tt-loading-backdrop')?.remove();
      console.warn('[TimetableUpload] Extraction error:', err);
      const reason = err?.message || 'Timetable extraction failed.';
      showTimetableUploadErrorModal(reason, base64Data, mimeType);
    }
  };

  reader.onerror = () => {
    document.getElementById('tt-loading-backdrop')?.remove();
    showTimetableUploadErrorModal('File could not be read. Please try again with a different image.');
  };

  reader.readAsDataURL(file);
}

// Non-blocking error dialog with Retry, Upload Again, and Enter Manually options.
function showTimetableUploadErrorModal(reason, base64Data, mimeType) {
  document.getElementById('tt-upload-error-backdrop')?.remove();
  const canRetry = !!(base64Data && mimeType);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'tt-upload-error-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:400px;text-align:center;padding:28px 24px">
      <div style="font-size:2.2rem;margin-bottom:12px">⚠️</div>
      <div style="font-weight:700;font-size:1rem;margin-bottom:8px">Timetable Extraction Failed</div>
      <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:20px;line-height:1.5">${reason}</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${canRetry ? `<button class="btn-primary" id="tt-error-retry-btn">🔄 Retry with Same Image</button>` : ''}
        <button class="btn-secondary" id="tt-error-upload-btn">📷 Upload a Different Image</button>
        <button class="btn-secondary" id="tt-error-manual-btn">✏️ Enter Timetable Manually</button>
        <button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.8rem;margin-top:4px"
                onclick="document.getElementById('tt-upload-error-backdrop')?.remove()">Dismiss</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  if (canRetry) {
    document.getElementById('tt-error-retry-btn').onclick = async () => {
      backdrop.remove();
      showTimetableLoadingModal('Retrying extraction…');
      try {
        const result = await extractTimetableFromImage(base64Data, mimeType);
        document.getElementById('tt-loading-backdrop')?.remove();
        const schedule = result?.schedule;
        if (!Array.isArray(schedule) || schedule.length === 0) {
          showTimetableUploadErrorModal('Still no entries found. Try a clearer photo or enter manually.', base64Data, mimeType);
        } else {
          showTimetablePreviewModal(schedule);
        }
      } catch (err2) {
        document.getElementById('tt-loading-backdrop')?.remove();
        showTimetableUploadErrorModal(err2?.message || 'Retry also failed.', base64Data, mimeType);
      }
    };
  }

  document.getElementById('tt-error-upload-btn').onclick = () => {
    backdrop.remove();
    selectTimetableFile();
  };

  document.getElementById('tt-error-manual-btn').onclick = () => {
    console.log('[TimetableUpload] User explicitly clicked "Enter Timetable Manually" from Error Modal.');
    backdrop.remove();
    showTimetableEntryModal(state.ttDay, null);
  };
}

let pendingExtractedSchedule = [];
let selectedTimetablePreviewBatch = 'all';

function showTimetablePreviewModal(schedule) {
  const currentProfileBatch = (liveProfile?.batch || '').trim().toUpperCase();

  // Normalize each row through canonical normalization layer
  pendingExtractedSchedule = (schedule || []).map(item => {
    const norm = normalizeSubjectIdentity(item.subject || '', [], item.type);
    const batches = (norm.batches && norm.batches.length > 0) ? norm.batches : (item.batches || []);
    return {
      day: standardizeTimetableDay(item.day) || 'Mon',
      time: item.time || '10:00',
      end: item.end || '11:00',
      subject: norm.canonicalName || item.subject || '',
      code: norm.canonicalCode || item.code || '',
      room: norm.room || item.room || '',
      teacher: norm.teacher || item.teacher || '',
      type: norm.classType || item.type || 'lecture',
      batches,
      isUncertain: !norm.canonicalName || !!item.isUncertain
    };
  });

  // Collect all discovered batches across schedule
  const discoveredBatches = new Set();
  pendingExtractedSchedule.forEach(item => {
    (item.batches || []).forEach(b => discoveredBatches.add(b));
  });

  if (currentProfileBatch && (discoveredBatches.has(currentProfileBatch) || discoveredBatches.size > 0)) {
    selectedTimetablePreviewBatch = currentProfileBatch;
  } else {
    selectedTimetablePreviewBatch = 'all';
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'tt-preview-backdrop';

  renderTimetablePreviewModalContent(backdrop);
  document.body.appendChild(backdrop);
}

function renderTimetablePreviewModalContent(backdrop) {
  const discoveredBatches = new Set();
  pendingExtractedSchedule.forEach(item => {
    (item.batches || []).forEach(b => discoveredBatches.add(b));
  });
  const batchList = Array.from(discoveredBatches).sort();

  const visibleSchedule = pendingExtractedSchedule
    .map((item, originalIdx) => ({ item, originalIdx }))
    .filter(({ item }) => shouldKeepClassForUserBatch(item, selectedTimetablePreviewBatch));

  const uncertainCount = visibleSchedule.filter(({ item }) => item.isUncertain || !item.subject).length;

  const rowsHtml = visibleSchedule.map(({ item, originalIdx }) => {
    const isRowUncertain = item.isUncertain || !item.subject;
    const batchLabel = (item.batches && item.batches.length > 0)
      ? `<span class="type-badge" style="font-size:0.7rem;padding:2px 6px;background:var(--accent-dim);color:var(--brand-primary)">${item.batches.join(', ')}</span>`
      : `<span style="font-size:0.7rem;color:var(--text-muted)">General</span>`;

    return `
    <tr class="${isRowUncertain ? 'preview-row-uncertain' : ''}" id="preview-row-${originalIdx}">
      <td>
        <select class="form-select" style="padding:4px 6px;font-size:0.8rem" onchange="updatePreviewEntry(${originalIdx}, 'day', this.value)">
          ${['Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<option value="${d}" ${item.day===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:3px">
          <input type="text" class="form-input" style="padding:4px 4px;font-size:0.8rem;width:52px;font-family:var(--font-mono)" value="${item.time || '10:00'}" placeholder="10:00" onchange="updatePreviewEntry(${originalIdx}, 'time', this.value)">
          <span style="color:var(--text-muted)">-</span>
          <input type="text" class="form-input" style="padding:4px 4px;font-size:0.8rem;width:52px;font-family:var(--font-mono)" value="${item.end || '11:00'}" placeholder="11:00" onchange="updatePreviewEntry(${originalIdx}, 'end', this.value)">
        </div>
      </td>
      <td>
        <input type="text" class="form-input ${!item.subject ? 'error' : ''}" id="preview-subject-${originalIdx}" style="padding:4px 6px;font-size:0.8rem;width:100%" value="${(item.subject || '').replace(/"/g, '&quot;')}" placeholder="Subject name *" onchange="updatePreviewEntry(${originalIdx}, 'subject', this.value)">
      </td>
      <td>
        <select class="form-select" style="padding:4px 6px;font-size:0.8rem;width:82px" onchange="updatePreviewEntry(${originalIdx}, 'type', this.value)">
          <option value="lecture" ${item.type==='lecture'?'selected':''}>Lecture</option>
          <option value="lab" ${item.type==='lab'?'selected':''}>Lab</option>
          <option value="tutorial" ${item.type==='tutorial'?'selected':''}>Tutorial</option>
          <option value="project" ${item.type==='project'?'selected':''}>Project</option>
          <option value="off" ${item.type==='off'?'selected':''}>Off</option>
        </select>
      </td>
      <td style="text-align:center">
        ${batchLabel}
      </td>
      <td>
        <input type="text" class="form-input" style="padding:4px 6px;font-size:0.8rem;width:68px" value="${(item.code || '').replace(/"/g, '&quot;')}" placeholder="Code" onchange="updatePreviewEntry(${originalIdx}, 'code', this.value)">
      </td>
      <td>
        <input type="text" class="form-input" style="padding:4px 6px;font-size:0.8rem;width:68px" value="${(item.room || '').replace(/"/g, '&quot;')}" placeholder="Room" onchange="updatePreviewEntry(${originalIdx}, 'room', this.value)">
      </td>
      <td>
        <input type="text" class="form-input" style="padding:4px 6px;font-size:0.8rem;width:85px" value="${(item.teacher || '').replace(/"/g, '&quot;')}" placeholder="Faculty" onchange="updatePreviewEntry(${originalIdx}, 'teacher', this.value)">
      </td>
      <td style="text-align:center">
        ${isRowUncertain ? '<span class="uncertain-badge" title="Please review or edit missing details">⚠️ Review</span>' : '<span style="color:var(--green);font-size:0.75rem;font-weight:600">✓ Ready</span>'}
      </td>
      <td style="text-align:center">
        <button class="task-delete-btn" onclick="removePreviewEntry(${originalIdx})" title="Remove class entry">${icons.trash()}</button>
      </td>
    </tr>`;
  }).join('');

  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:860px;width:95%">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Extracted Timetable Preview</h2>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">
            ${visibleSchedule.length} class${visibleSchedule.length !== 1 ? 'es' : ''} shown ${selectedTimetablePreviewBatch !== 'all' ? `(Filtered for Batch ${selectedTimetablePreviewBatch})` : ''} ${uncertainCount > 0 ? `· <span style="color:var(--yellow);font-weight:600">${uncertainCount} entries need review</span>` : '· <span style="color:var(--green);font-weight:600">All fields structured</span>'}
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('tt-preview-backdrop').remove()">${icons.x()}</button>
      </div>

      <!-- Batch Filter & Normalization Controls -->
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface-2);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary)">Your Practical Batch / Section:</span>
          <select class="form-select" id="tt-preview-batch-select" style="padding:4px 8px;font-size:0.82rem;max-width:160px" onchange="onTimetablePreviewBatchChange(this.value)">
            <option value="all" ${selectedTimetablePreviewBatch === 'all' ? 'selected' : ''}>All Batches (No Filter)</option>
            ${batchList.map(b => `<option value="${b}" ${selectedTimetablePreviewBatch === b ? 'selected' : ''}>Batch ${b}</option>`).join('')}
            ${!batchList.includes('A1') ? '<option value="A1"' + (selectedTimetablePreviewBatch === 'A1' ? ' selected' : '') + '>Batch A1</option>' : ''}
            ${!batchList.includes('A2') ? '<option value="A2"' + (selectedTimetablePreviewBatch === 'A2' ? ' selected' : '') + '>Batch A2</option>' : ''}
            ${!batchList.includes('B1') ? '<option value="B1"' + (selectedTimetablePreviewBatch === 'B1' ? ' selected' : '') + '>Batch B1</option>' : ''}
            ${!batchList.includes('B2') ? '<option value="B2"' + (selectedTimetablePreviewBatch === 'B2' ? ' selected' : '') + '>Batch B2</option>' : ''}
            ${!batchList.includes('C1') ? '<option value="C1"' + (selectedTimetablePreviewBatch === 'C1' ? ' selected' : '') + '>Batch C1</option>' : ''}
            ${!batchList.includes('C2') ? '<option value="C2"' + (selectedTimetablePreviewBatch === 'C2' ? ' selected' : '') + '>Batch C2</option>' : ''}
            ${!batchList.includes('D1') ? '<option value="D1"' + (selectedTimetablePreviewBatch === 'D1' ? ' selected' : '') + '>Batch D1</option>' : ''}
            ${!batchList.includes('D2') ? '<option value="D2"' + (selectedTimetablePreviewBatch === 'D2' ? ' selected' : '') + '>Batch D2</option>' : ''}
          </select>
        </div>
        <div style="font-size:0.76rem;color:var(--text-muted)">
          Hides other batch practicals so you only save classes for your section.
        </div>
      </div>

      <div style="overflow-x:auto;max-height:380px;margin-bottom:16px;border:1px solid var(--border);border-radius:var(--radius-sm)">
        <table class="preview-table">
          <thead>
            <tr>
              <th style="width:75px">Day</th>
              <th style="width:125px">Time</th>
              <th>Subject Name *</th>
              <th style="width:85px">Type</th>
              <th style="width:70px;text-align:center">Batch</th>
              <th style="width:70px">Code</th>
              <th style="width:70px">Room</th>
              <th style="width:90px">Faculty</th>
              <th style="width:75px;text-align:center">Status</th>
              <th style="width:36px"></th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml.length > 0 ? rowsHtml : `
              <tr>
                <td colspan="10" style="text-align:center;padding:24px;color:var(--text-muted)">
                  No timetable rows matched the chosen batch (${selectedTimetablePreviewBatch}). Change batch or click "Add Class Row" below.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <button class="btn-secondary" onclick="addPreviewEntry()" style="font-size:0.8rem;display:flex;align-items:center;gap:5px">
          ${icons.plus()} Add Class Row
        </button>

        <div style="display:flex;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('tt-preview-backdrop').remove()">Cancel</button>
          <button class="btn-primary" onclick="confirmSaveExtractedTimetable()">Confirm &amp; Save Schedule</button>
        </div>
      </div>
    </div>
  `;
}

window.onTimetablePreviewBatchChange = function(val) {
  selectedTimetablePreviewBatch = val;
  const backdrop = document.getElementById('tt-preview-backdrop');
  if (backdrop) renderTimetablePreviewModalContent(backdrop);
};

window.updatePreviewEntry = function(idx, key, val) {
  if (pendingExtractedSchedule[idx]) {
    pendingExtractedSchedule[idx][key] = val;
    if (key === 'subject' && val.trim().length > 0) {
      pendingExtractedSchedule[idx].isUncertain = false;
      const subjEl = document.getElementById(`preview-subject-${idx}`);
      if (subjEl) subjEl.classList.remove('error');
    }
  }
};

window.removePreviewEntry = function(idx) {
  pendingExtractedSchedule.splice(idx, 1);
  const backdrop = document.getElementById('tt-preview-backdrop');
  if (backdrop) renderTimetablePreviewModalContent(backdrop);
};

window.addPreviewEntry = function() {
  pendingExtractedSchedule.push({
    day: 'Mon',
    time: '10:00',
    end: '11:00',
    subject: '',
    code: '',
    room: '',
    teacher: '',
    type: 'lecture',
    batches: selectedTimetablePreviewBatch !== 'all' ? [selectedTimetablePreviewBatch] : [],
    isUncertain: true
  });
  const backdrop = document.getElementById('tt-preview-backdrop');
  if (backdrop) renderTimetablePreviewModalContent(backdrop);
};

window.confirmSaveExtractedTimetable = function() {
  const toSave = pendingExtractedSchedule.filter(item => shouldKeepClassForUserBatch(item, selectedTimetablePreviewBatch));

  if (!toSave.length) {
    showToast("No classes to save for the selected batch. Add at least one class row or select 'All Batches'.", "info");
    return;
  }

  // 1. Validate that all kept entries have valid subject names
  for (let i = 0; i < toSave.length; i++) {
    const item = toSave[i];
    const subj = (item.subject || '').trim();
    if (!subj && item.type !== 'off') {
      showToast(`A class on ${item.day} at ${item.time} is missing a Subject name. Please fill it in or delete the row.`, "error");
      return;
    }

    // Validate times
    const timeNorm = normalizeTimetableTime(`${item.time || '10:00'} - ${item.end || '11:00'}`);
    if (!timeNorm.isValid) {
      showToast(`Class "${subj || 'Class'}" on ${item.day} has an invalid time format. Use HH:MM.`, "error");
      return;
    }
  }

  const dayMap = { "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6 };
  const newTT = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };

  toSave.forEach(item => {
    const dayNum = dayMap[item.day] || 1;
    const timeNorm = normalizeTimetableTime(`${item.time || '10:00'} - ${item.end || '11:00'}`);

    newTT[dayNum].push({
      time:    timeNorm.time || item.time || '10:00',
      end:     timeNorm.end || item.end || '11:00',
      subject: (item.subject || (item.type === 'off' ? 'Off' : 'Class')).trim(),
      code:    (item.code || '').trim(),
      room:    (item.room || '').trim(),
      teacher: (item.teacher || '').trim(),
      type:    item.type || 'lecture',
    });
  });

  Object.keys(newTT).forEach(d => {
    newTT[d].sort((a,b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  });

  saveTimetable(newTT);

  // If user chose a specific batch during preview, update profile batch
  if (selectedTimetablePreviewBatch && selectedTimetablePreviewBatch !== 'all') {
    liveProfile.batch = selectedTimetablePreviewBatch;
    safeSetStorage(KEY_PROFILE, liveProfile);
    syncToCloud();
  }

  document.getElementById('tt-preview-backdrop')?.remove();
  showToast(`Timetable saved! ${toSave.length} classes loaded${selectedTimetablePreviewBatch !== 'all' ? ` for Batch ${selectedTimetablePreviewBatch}` : ''}.`, "success");
  renderPage(state.currentPage);
};

function handleAuthError(err) {
  if (!err) return;
  const code = err.code || '';
  const msg  = err.message || '';

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return;
  }

  if (code === 'auth/popup-blocked') {
    if (confirm("Sign-in popup was blocked by your browser.\n\nClick OK to try signing in with redirect instead.")) {
      loginWithGoogleRedirect();
    }
    return;
  }

  if (code === 'auth/unauthorized-domain') {
    const domain = window.location.hostname;
    alert(`Unauthorized Domain: '${domain}'\n\nTo allow Google Sign-In on this domain:\n1. Open Firebase Console → Authentication → Settings → Authorized Domains.\n2. Add '${domain}' to authorized domains.`);
    return;
  }

  if (code === 'auth/api-key-not-valid' || code === 'auth/invalid-api-key') {
    alert("Firebase API Key Error: The API key for this project is invalid or restricted in Google Cloud Console. Please verify authorized API key restrictions.");
    return;
  }

  if (code === 'auth/operation-not-allowed') {
    alert("Google Sign-In Disabled: Google auth provider is not enabled in Firebase Console.\n\nGo to Firebase Console → Authentication → Sign-in method → Enable Google.");
    return;
  }

  if (code === 'auth/network-request-failed') {
    alert("Network Error: Could not connect to Google Authentication servers. Please check your internet connection and try again.");
    return;
  }

  alert(`Google Sign-In Error (${code || 'unknown'}):\n${msg || 'An unexpected authentication error occurred.'}`);
}

function loginWithGoogle() {
  if (!auth) {
    initFirebase();
  }
  if (!auth) {
    const detail = firebaseInitError || "Firebase Auth service is not loaded.";
    alert(`Google Sign-In Unavailable:\n\n${detail}`);
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  auth.signInWithPopup(provider).then(result => {
    if (result && result.user) {
      currentUser = result.user;
      updateSyncUI();
      if (state.currentPage === 'settings') renderSettings();
    }
  }).catch(err => {
    handleAuthError(err);
  });
}

function loginWithGoogleRedirect() {
  if (!auth) initFirebase();
  if (!auth) return;
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  auth.signInWithRedirect(provider).catch(err => {
    handleAuthError(err);
  });
}

function logoutUser() {
  if (auth) {
    auth.signOut().then(() => {
      currentUser = null;
      updateSyncUI();
      showToast('Signed out of Clarity Desk', 'info');
      renderPage(state.currentPage);
    });
  }
}

const VALID_TASK_TYPES = ['assignment', 'mission', 'general', 'quiz', 'lab', 'project', 'exam', 'study'];

function sanitizeTask(t) {
  if (!t || typeof t !== 'object') return null;

  const rawType = String(t.taskType || t.type || '').toLowerCase();
  const taskType = VALID_TASK_TYPES.includes(rawType) ? rawType : 'assignment';

  const isNoDeadline = !!(t.noDeadline || (taskType === 'mission' && !t.dueDate));

  let finalDueDate = '';
  if (!isNoDeadline) {
    if (typeof t.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)) {
      finalDueDate = t.dueDate;
    } else {
      finalDueDate = todayStr();
    }
  }

  return {
    id:          String(t.id || `c-${Date.now()}`),
    subject:     String(t.subject || 'General'),
    code:        String(t.code || (t.subject === 'General' ? 'GEN' : t.subject === 'Mission' ? 'MIS' : 'OTH')),
    title:       String(t.title || 'Untitled Task').slice(0, 150),
    taskType:    taskType,
    noDeadline:  isNoDeadline,
    description: String(t.description !== undefined && t.description !== null ? t.description : '—').slice(0, 500),
    dueDate:     finalDueDate,
    priority:    ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
    status:      t.status === 'submitted' ? 'submitted' : 'pending',
    marks:       typeof t.marks === 'number' ? Math.max(0, Math.min(100, t.marks)) : (parseInt(t.marks) || 0),
    isCustom:    true,
  };
}

let lastCloudPayloadHash = null;

function calculatePayloadHash(data) {
  try {
    return JSON.stringify({
      p: data.profile,
      t: data.customTasks?.length,
      tt: data.customTimetable ? Object.keys(data.customTimetable).length : 0,
      a: data.assignmentStatuses,
      tm: data.theme
    });
  } catch (e) {
    return null;
  }
}

function subscribeUserCloudData(uid) {
  if (!db || !uid) return;
  if (cloudUnsubscribe) cloudUnsubscribe();

  const userRef = db.collection('users').doc(uid);

  // Cache-First Read: Immediate IndexedDB cache hit (0ms UI latency, 0 server reads)
  userRef.get({ source: 'cache' }).then(doc => {
    if (doc && doc.exists) {
      applyCloudDataToLocalState(doc.data());
    }
  }).catch(() => {});

  // Server Listener with metadata echo filter
  cloudUnsubscribe = userRef.onSnapshot({ includeMetadataChanges: false }, doc => {
    if (!doc || !doc.exists) {
      pushLocalDataToCloud(uid);
      return;
    }

    // Skip parsing and UI re-renders on local pending write echo events
    if (doc.metadata && doc.metadata.hasPendingWrites) return;

    const data = doc.data() || {};
    const currentHash = calculatePayloadHash(data);
    if (currentHash && currentHash === lastCloudPayloadHash) return;
    lastCloudPayloadHash = currentHash;

    applyCloudDataToLocalState(data);
  }, err => {
    if (err.code === 'permission-denied') {
      updateSyncUI('denied');
      console.warn("Firestore access denied by Security Rules.");
    } else {
      console.warn("Cloud snapshot error:", err);
    }
  });
}

function applyCloudDataToLocalState(data) {
  if (!data || typeof data !== 'object') return;
  if (data.profile && typeof data.profile === 'object') {
    const cleanProfile = {
      name:     String(data.profile.name || '').slice(0, 80),
      college:  String(data.profile.college || '').slice(0, 100),
      branch:   String(data.profile.branch || '').slice(0, 100),
      year:     String(data.profile.year || '').slice(0, 50),
      rollNo:   String(data.profile.rollNo || '').slice(0, 50),
      examDate: String(data.profile.examDate || '').slice(0, 20),
    };
    safeSetStorage(KEY_PROFILE, cleanProfile);
  }
  if (Array.isArray(data.customTasks)) {
    state.customTasks = data.customTasks.map(sanitizeTask).filter(Boolean);
    safeSetStorage(KEY_CUSTOM_TASKS, state.customTasks);
  }
  if (data.customTimetable && typeof data.customTimetable === 'object') {
    safeSetStorage(KEY_CUSTOM_TIMETABLE, data.customTimetable);
  }
  if (data.timetableChoice && typeof data.timetableChoice === 'string') {
    safeSetStorage(KEY_TIMETABLE_CHOICE, data.timetableChoice);
  }
  if (Array.isArray(data.customLinks)) {
    safeSetStorage(KEY_CUSTOM_LINKS, data.customLinks);
  }
  if (data.assignmentStatuses && typeof data.assignmentStatuses === 'object') {
    safeSetStorage(KEY_ASSIGNMENTS, data.assignmentStatuses);
    state.assignments = loadAssignments();
  }
  if (data.attendance && typeof data.attendance === 'object') {
    safeSetStorage(KEY_ATTENDANCE, data.attendance);
  }
  if (data.attendanceBaseline && typeof data.attendanceBaseline === 'object') {
    safeSetStorage(KEY_ATTENDANCE_BASELINE, data.attendanceBaseline);
  }
  if (data.attendanceLive && typeof data.attendanceLive === 'object') {
    safeSetStorage(KEY_ATTENDANCE_LIVE, data.attendanceLive);
  }
  if (data.theme && typeof data.theme === 'string') {
    let cloudTheme = data.theme;
    if (LEGACY_THEME_MAP[cloudTheme]) cloudTheme = LEGACY_THEME_MAP[cloudTheme];
    const localTheme = localStorage.getItem(KEY_THEME);
    
    // If local theme is not set yet, adopt cloud theme
    if (!localTheme && ALL_THEMES.includes(cloudTheme)) {
      localStorage.setItem(KEY_THEME, cloudTheme);
      initTheme();
    } else if (localTheme && localTheme !== cloudTheme && currentUser && db) {
      // Local user preference takes precedence; heal cloud document with current local theme
      db.collection('users').doc(currentUser.uid).set({
        theme: localTheme
      }, { merge: true }).catch(() => {});
    }
  }
  if (data.notificationPrefs && typeof data.notificationPrefs === 'object') {
    safeSetStorage(KEY_NOTIF_PREFS, data.notificationPrefs);
  }
  if (data.noticeChannels && typeof data.noticeChannels === 'object') {
    safeSetStorage(KEY_NOTICE_CHANNELS, data.noticeChannels);
  }
  updateTopbarProfile();
  setupFABDrag();
  updateNavBadges();
  if (['settings', 'assignments', 'dashboard', 'notices'].includes(state.currentPage)) {
    renderPage(state.currentPage);
  }
}

let syncDebounceTimer = null;

function pushLocalDataToCloud(uid) {
  if (!db || !uid) return;
  const sanitizedTasks = state.customTasks.map(sanitizeTask).filter(Boolean);
  const payload = {
    profile:            loadProfile(),
    customTasks:        sanitizedTasks,
    customTimetable:    safeGetStorage(KEY_CUSTOM_TIMETABLE, null),
    timetableChoice:    safeGetStorage(KEY_TIMETABLE_CHOICE, null),
    customLinks:        safeGetStorage(KEY_CUSTOM_LINKS, null),
    assignmentStatuses: safeGetStorage(KEY_ASSIGNMENTS, {}),
    attendance:         safeGetStorage(KEY_ATTENDANCE, {}),
    attendanceBaseline: safeGetStorage(KEY_ATTENDANCE_BASELINE, {}),
    attendanceLive:     safeGetStorage(KEY_ATTENDANCE_LIVE, {}),
    theme:              localStorage.getItem(KEY_THEME) || 'paper-slate',
    notificationPrefs:  safeGetStorage(KEY_NOTIF_PREFS, null),
    noticeChannels:     safeGetStorage(KEY_NOTICE_CHANNELS, null),
    updatedAt:          firebase.firestore.FieldValue.serverTimestamp()
  };
  db.collection('users').doc(uid).set(payload, { merge: true }).catch(err => {
    if (err.code === 'permission-denied') {
      updateSyncUI('denied');
    }
    console.warn("Cloud push error:", err);
  });
}

// ── Notice Channels (Official & WhatsApp Links) ───────────────
function loadNoticeChannels() {
  const saved = safeGetStorage(KEY_NOTICE_CHANNELS, null);
  if (saved && typeof saved === 'object') {
    return {
      officialTitle: (saved.officialTitle || 'Official Updates').trim(),
      officialUrl:   (saved.officialUrl || '').trim(),
      whatsappTitle: (saved.whatsappTitle || 'Class Community').trim(),
      whatsappUrl:   (saved.whatsappUrl || '').trim()
    };
  }
  return {
    officialTitle: 'Official Updates',
    officialUrl:   '',
    whatsappTitle: 'Class Community',
    whatsappUrl:   ''
  };
}

function saveNoticeChannels(channels) {
  safeSetStorage(KEY_NOTICE_CHANNELS, channels);
  syncToCloud();
}

function showNoticeChannelModal(targetKey) {
  document.getElementById('notice-channel-modal-backdrop')?.remove();
  const channels = loadNoticeChannels();
  const isOfficial = targetKey === 'official';
  const currentTitle = isOfficial ? channels.officialTitle : channels.whatsappTitle;
  const currentUrl   = isOfficial ? channels.officialUrl : channels.whatsappUrl;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'notice-channel-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:460px;width:92vw">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.2rem">${isOfficial ? '📢' : '💬'}</span>
          <span class="modal-title">${isOfficial ? 'Configure Notice Source' : 'Configure Class Group & Channels'}</span>
        </div>
        <button class="modal-close" onclick="document.getElementById('notice-channel-modal-backdrop')?.remove()">${icons.x()}</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div style="font-size:0.82rem;color:var(--text-muted);line-height:1.45">
          ${isOfficial 
            ? 'Set your college portal link, class channel, or department notice page URL.' 
            : 'Add your batch community link, group invite URL, or class representative contact. Tapping opens the channel directly for quick access.'}
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">${isOfficial ? 'Card Title' : 'Group or Channel Title'}</label>
          <input type="text" class="form-input" id="nc-modal-title" value="${(currentTitle || '').replace(/"/g, '&quot;')}" placeholder="${isOfficial ? 'e.g. Official Updates or Department Portal' : 'e.g. Class Community or SY-AIDS 2026'}">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">${isOfficial ? 'Destination Link / URL' : 'Invite Link or Contact URL'}</label>
          <input type="url" class="form-input" id="nc-modal-url" value="${(currentUrl || '').replace(/"/g, '&quot;')}" placeholder="${isOfficial ? 'https://college.edu/notices' : 'https://chat.whatsapp.com/... or https://wa.me/...'}">
        </div>
        ${!isOfficial ? `
          <div style="font-size:0.75rem;color:var(--text-muted);background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-xs,6px);padding:8px 10px;line-height:1.4">
            💡 <strong>Note:</strong> Class group access opens directly in WhatsApp based on your batch link and admin settings.
          </div>
        ` : ''}
      </div>
      <div class="modal-footer" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
        <button class="btn-secondary" onclick="document.getElementById('notice-channel-modal-backdrop')?.remove()">Cancel</button>
        <button class="btn-primary" onclick="submitNoticeChannelModal('${targetKey}')">Save Changes</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

function submitNoticeChannelModal(targetKey) {
  const titleEl = document.getElementById('nc-modal-title');
  const urlEl   = document.getElementById('nc-modal-url');
  const title   = (titleEl ? titleEl.value : '').trim();
  const url     = (urlEl ? urlEl.value : '').trim();

  const channels = loadNoticeChannels();
  if (targetKey === 'official') {
    channels.officialTitle = title || 'Official Updates';
    channels.officialUrl   = url;
  } else {
    channels.whatsappTitle = title || 'Class Community';
    channels.whatsappUrl   = url;
  }

  saveNoticeChannels(channels);
  document.getElementById('notice-channel-modal-backdrop')?.remove();
  showToast('Notice source updated ✓', 'success');
  if (state.currentPage === 'notices') renderNotices();
  if (state.currentPage === 'settings') renderSettings();
}

function handleNoticeSourceClick(targetKey) {
  const channels = loadNoticeChannels();
  const url = targetKey === 'official' ? channels.officialUrl : channels.whatsappUrl;
  if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('tg://') || url.startsWith('whatsapp://'))) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    showToast(targetKey === 'official' ? 'Configure your official notice link' : 'Add your WhatsApp group invite or community link to enable quick access', 'info');
    showNoticeChannelModal(targetKey);
  }
}

// ── Custom Quick Links / Resources ───────────────────────────
function loadCustomLinks() {
  const saved = safeGetStorage(KEY_CUSTOM_LINKS, null);
  if (Array.isArray(saved)) return saved;
  // Seed defaults from data.js on first load
  return JSON.parse(JSON.stringify(QUICK_LINKS));
}

function saveCustomLinks(links) {
  safeSetStorage(KEY_CUSTOM_LINKS, links);
  syncToCloud();
}

function syncToCloud() {
  if (!currentUser) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    pushLocalDataToCloud(currentUser.uid);
  }, 2500);
}

// Pause active cloud listener when tab is hidden to save Firestore read quota
document.addEventListener('visibilitychange', () => {
  if (!currentUser || !db) return;
  if (document.hidden) {
    if (cloudUnsubscribe) {
      cloudUnsubscribe();
      cloudUnsubscribe = null;
    }
  } else {
    subscribeUserCloudData(currentUser.uid);
  }
});

// ── Notification Preferences & Service ───────────────────────
// ── Notification Preferences & Service ───────────────────────
function loadNotifPrefs() {
  const saved = safeGetStorage(KEY_NOTIF_PREFS, null);
  const defaults = {
    enabled: typeof Notification !== 'undefined' && Notification.permission === 'granted',
    taskUpcoming: "day_before",  // "day_before" | "same_day" | "off"
    taskOverdue: "same_day",     // "same_day" | "instant" | "off"
    classReminders: "15_min",    // "15_min" | "30_min" | "1_hour" | "off"
    attendanceAlerts: "instant", // "instant" | "weekly" | "off"
    newNotices: "instant",       // "instant" | "same_day" | "off"
    dailySummaryTime: "08:00"
  };
  if (saved && typeof saved === 'object') {
    const mapped = { ...defaults, ...saved };
    if (saved.taskUpcoming === true) mapped.taskUpcoming = "day_before";
    if (saved.taskUpcoming === false) mapped.taskUpcoming = "off";
    if (saved.taskOverdue === true) mapped.taskOverdue = "same_day";
    if (saved.taskOverdue === false) mapped.taskOverdue = "off";
    if (saved.noticeMode === 'off') mapped.newNotices = "off";
    if (saved.noticeMode === 'instant') mapped.newNotices = "instant";
    return mapped;
  }
  return defaults;
}

function saveNotifPrefs(prefs) {
  safeSetStorage(KEY_NOTIF_PREFS, prefs);
  syncToCloud();
}

async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') {
    showToast('Notifications not supported by your browser', 'error');
    return false;
  }

  const currentPermission = Notification.permission;
  if (currentPermission === 'denied') {
    showToast('Notifications blocked in browser settings. Please allow in address bar site settings.', 'error');
    const prefs = loadNotifPrefs();
    prefs.enabled = false;
    saveNotifPrefs(prefs);
    if (state.currentPage === 'settings') renderSettings();
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    const prefs = loadNotifPrefs();
    prefs.enabled = (permission === 'granted');
    saveNotifPrefs(prefs);
    if (permission === 'granted') {
      showToast('Notifications enabled!', 'success');
      dispatchNotification('Clarity Desk Notifications', {
        body: 'You will now receive alerts for class reminders, task deadlines, attendance warnings, and notices.',
        tag: 'welcome-notif'
      });
    } else if (permission === 'denied') {
      showToast('Notifications blocked. Please enable them in browser site settings.', 'error');
    }
    if (state.currentPage === 'settings') renderSettings();
    return permission === 'granted';
  } catch (err) {
    console.warn("Notification permission error:", err);
    return false;
  }
}

const NOTIF_DEFAULT_ICON = './icon-192.png';
const NOTIF_DEFAULT_BADGE = './badge-96.png'; // monochrome transparent PNG for Android status bar

function dispatchNotification(title, options = {}) {
  if (typeof Notification === 'undefined') return;

  if (Notification.permission !== 'granted') {
    if (options.showInAppFallback !== false) {
      if (Notification.permission === 'denied') {
        showToast('Notifications blocked in browser settings. Enable in site settings to receive alerts.', 'error');
      } else if (Notification.permission === 'default') {
        showToast('Notification permission not requested yet. Click Enable Notifications in Settings.', 'info');
      }
    }
    return;
  }

  const merged = { ...options };
  const notifOptions = {
    icon: NOTIF_DEFAULT_ICON,
    badge: NOTIF_DEFAULT_BADGE,
    vibrate: [100, 50, 100],
    ...merged,
    renotify: !!(merged.tag)
  };

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      if (reg && reg.showNotification) {
        reg.showNotification(title, notifOptions);
      } else {
        new Notification(title, notifOptions);
      }
    }).catch(() => {
      try { new Notification(title, notifOptions); } catch(e) {}
    });
  } else {
    try { new Notification(title, notifOptions); } catch(e) {}
  }
}
window.dispatchNotification = dispatchNotification;

function checkScheduledNotifications() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const prefs = loadNotifPrefs();

  const today = todayStr();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const now = new Date();
  const currentMin = currentTimeMinutes();
  const currentHHMM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const tasks = allTasks().filter(t => t.status === 'pending');
  const notifiedMap = safeGetStorage('cos_notified_history', {}) || {};

  // 1. Upcoming Tasks
  if (prefs.taskUpcoming === 'day_before') {
    tasks.filter(t => !t.noDeadline && t.dueDate === tomorrowStr).forEach(t => {
      const key = `upcoming_daybefore_${t.id}_${today}`;
      if (!notifiedMap[key]) {
        dispatchNotification(`Upcoming Task: ${t.title}`, {
          body: `${t.subject || 'Task'} · Due tomorrow! Keep going.`,
          tag: key,
          data: { url: './#assignments' }
        });
        notifiedMap[key] = true;
      }
    });
  } else if (prefs.taskUpcoming === 'same_day') {
    tasks.filter(t => !t.noDeadline && t.dueDate === today).forEach(t => {
      const key = `upcoming_sameday_${t.id}_${today}`;
      if (!notifiedMap[key]) {
        dispatchNotification(`Task Due Today: ${t.title}`, {
          body: `${t.subject || 'Task'} · Due today!`,
          tag: key,
          data: { url: './#assignments' }
        });
        notifiedMap[key] = true;
      }
    });
  }

  // 2. Overdue Tasks
  if (prefs.taskOverdue !== 'off') {
    tasks.filter(t => isTaskOverdue(t)).forEach(t => {
      const key = `overdue_${t.id}_${today}`;
      if (!notifiedMap[key]) {
        const days = Math.abs(dueDaysLeft(t.dueDate) || 1);
        dispatchNotification(`Task Overdue: ${t.title}`, {
          body: `${t.subject || 'Task'} is ${days} day${days > 1 ? 's' : ''} overdue.`,
          tag: key,
          data: { url: './#assignments' }
        });
        notifiedMap[key] = true;
      }
    });
  }

  // 3. Class Reminders
  if (prefs.classReminders !== 'off') {
    const liveTT = loadTimetable();
    const dayClasses = (liveTT[now.getDay()] || []).filter(isTeachingClass);
    const leadWindow = prefs.classReminders === '1_hour' ? 60 : prefs.classReminders === '30_min' ? 30 : 15;

    dayClasses.forEach(c => {
      const startMin = timeToMinutes(c.time || '10:00');
      const diff = startMin - currentMin;
      if (diff > 0 && diff <= leadWindow) {
        const classKey = `class_rem_${c.code || c.subject}_${c.time}_${today}`;
        if (!notifiedMap[classKey]) {
          dispatchNotification(`Class Starting Soon: ${c.subject}`, {
            body: `Starts at ${c.time} in ${c.room || 'class'} with ${c.teacher || 'faculty'}`,
            tag: classKey,
            data: { url: './#timetable' }
          });
          notifiedMap[classKey] = true;
        }
      }
    });
  }

  // 4. Low-Attendance Warning Alert
  if (prefs.attendanceAlerts !== 'off') {
    const attendanceData = safeGetStorage(KEY_ATTENDANCE, {}) || {};
    let totalAttended = 0;
    let totalSkipped = 0;
    Object.values(attendanceData).forEach(dayObj => {
      if (dayObj && typeof dayObj === 'object') {
        Object.values(dayObj).forEach(st => {
          if (st === 'attended') totalAttended++;
          else if (st === 'skipped') totalSkipped++;
        });
      }
    });
    const totalMarked = totalAttended + totalSkipped;
    const pct = totalMarked > 0 ? Math.round((totalAttended / totalMarked) * 100) : null;

    if (pct !== null && pct < getAttendanceTarget()) {
      const attKey = `att_warning_${today}`;
      if (!notifiedMap[attKey]) {
        dispatchNotification(`Attendance Alert: ${pct}%`, {
          body: `Your attendance is currently ${pct}% (below ${getAttendanceTarget()}% target). Tap to review.`,
          tag: attKey,
          data: { url: './#review' }
        });
        notifiedMap[attKey] = true;
      }
    }
  }

  // 5. Daily Summary Notification Check
  if (prefs.dailySummaryTime && prefs.dailySummaryTime !== 'off') {
    const summaryKey = `daily_summary_${today}`;
    if (currentHHMM >= prefs.dailySummaryTime && !notifiedMap[summaryKey]) {
      const pendingCountVal = tasks.length;
      const dueTodayCount = tasks.filter(t => t.dueDate === today).length;
      dispatchNotification(`Clarity Desk — Daily Summary`, {
        body: `You have ${pendingCountVal} pending task${pendingCountVal !== 1 ? 's' : ''} (${dueTodayCount} due today).`,
        tag: summaryKey,
        data: { url: './#dashboard' }
      });
      notifiedMap[summaryKey] = true;
    }
  }

  const keys = Object.keys(notifiedMap);
  if (keys.length > 100) {
    const pruned = {};
    keys.slice(-50).forEach(k => { pruned[k] = notifiedMap[k]; });
    safeSetStorage('cos_notified_history', pruned);
  } else {
    safeSetStorage('cos_notified_history', notifiedMap);
  }
}

function triggerNoticeNotification(notice) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const prefs = loadNotifPrefs();
  if (prefs.newNotices === 'off') return;

  if (prefs.newNotices === 'instant' || prefs.newNotices === 'same_day') {
    dispatchNotification(`New Notice: ${notice.title}`, {
      body: (notice.content || '').slice(0, 120),
      tag: `notice_${notice.id}`,
      data: { url: './#notices' }
    });
  }
}

function checkNoticeNotifications() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const prefs = loadNotifPrefs();
  if (prefs.newNotices === 'off') return;

  const notifiedNotices = safeGetStorage('cos_notified_notices', {}) || {};
  NOTICES.forEach(n => {
    if (!notifiedNotices[n.id]) {
      triggerNoticeNotification(n);
      notifiedNotices[n.id] = true;
    }
  });
  safeSetStorage('cos_notified_notices', notifiedNotices);
}

// ── Custom Tasks (fully persisted) ────────────────────────────
function loadCustomTasks() {
  const raw = safeGetStorage(KEY_CUSTOM_TASKS, []) || [];
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeTask).filter(Boolean);
}

function saveCustomTasks() {
  // Prune completed dated tasks older than 14 days; never prune ongoing/standing missions
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const cutoffStr = `${fourteenDaysAgo.getFullYear()}-${String(fourteenDaysAgo.getMonth()+1).padStart(2,'0')}-${String(fourteenDaysAgo.getDate()).padStart(2,'0')}`;

  state.customTasks = state.customTasks
    .map(sanitizeTask)
    .filter(Boolean)
    .filter(t => {
      if (t.noDeadline || (t.taskType === 'mission' && !t.dueDate)) return true;
      if (t.status === 'submitted' && t.dueDate && t.dueDate < cutoffStr) return false;
      return true;
    });

  safeSetStorage(KEY_CUSTOM_TASKS, state.customTasks);
  syncToCloud();
}

// ── State ─────────────────────────────────────────────────────
const state = {
  currentPage:         'dashboard',
  ttDay:               new Date().getDay(),
  assignFilter:        'all',
  assignTypeFilter:    'all',
  assignSubjectFilter: 'all',
  noticeSearch:        '',
  assignments:         loadAssignments(),
  customTasks:         loadCustomTasks(),   // persisted across reloads
};
window.state = state;

window.filterAndNavigateToAssignments = function(filter, typeFilter = null, subjectFilter = null) {
  if (filter) state.assignFilter = filter;
  if (typeFilter) state.assignTypeFilter = typeFilter;
  if (subjectFilter) state.assignSubjectFilter = subjectFilter;
  navigateTo('assignments');
};

window.resetAssignmentFilters = function() {
  state.assignFilter = 'all';
  state.assignTypeFilter = 'all';
  state.assignSubjectFilter = 'all';
  renderAssignments();
};

// ── Theme (6 Distinct Environments) ───────────────────────────
const ALL_THEMES = [
  'paper-slate',
  'midnight-ink',
  'espresso-desk',
  'sandstone-notes',
  'nordic-frost',
  'misty-mint'
];

const LEGACY_THEME_MAP = {
  'paper':              'paper-slate',
  'soft-neutral':       'paper-slate',
  'light':              'paper-slate',
  'cloud':              'paper-slate',
  'mist-blue':          'paper-slate',
  'glass':              'paper-slate',
  'quiet-dark':         'midnight-ink',
  'dark':               'midnight-ink',
  'midnight-executive': 'midnight-ink',
  'cocoa-night':        'espresso-desk',
  'cafe-night':         'espresso-desk',
  'cafe':               'espresso-desk',
  'espresso-paper':     'espresso-desk',
  'rose-pine':          'espresso-desk',
  'stone':              'sandstone-notes',
  'sandstone':          'sandstone-notes',
  'warm-study':         'sandstone-notes',
  'sunset':             'sandstone-notes',
  'academic-amber':     'sandstone-notes',
  'crimson-bold':       'sandstone-notes',
  'forest-study':       'nordic-frost',
  'emerald':            'nordic-frost',
  'emerald-focus':      'nordic-frost',
  'mint':               'misty-mint'
};

function initTheme() {
  const saved = localStorage.getItem(KEY_THEME);
  let theme   = saved || 'paper-slate';
  if (LEGACY_THEME_MAP[theme]) theme = LEGACY_THEME_MAP[theme];
  if (!ALL_THEMES.includes(theme)) theme = 'paper-slate';
  
  if (!saved || saved !== theme) {
    localStorage.setItem(KEY_THEME, theme);
  }
  
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeSelector(theme);
}

function toggleTheme() {
  let current = document.documentElement.getAttribute('data-theme') || 'paper-slate';
  if (LEGACY_THEME_MAP[current]) current = LEGACY_THEME_MAP[current];
  const nextIdx = (ALL_THEMES.indexOf(current) + 1) % ALL_THEMES.length;
  const next    = ALL_THEMES[nextIdx];
  setTheme(next);
}

function setTheme(theme) {
  if (LEGACY_THEME_MAP[theme]) theme = LEGACY_THEME_MAP[theme];
  if (!ALL_THEMES.includes(theme)) return;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY_THEME, theme);
  updateThemeSelector(theme);
  renderPage(state.currentPage);
  
  // Instant cloud persistence (no 2.5s delay)
  if (currentUser && db) {
    db.collection('users').doc(currentUser.uid).set({
      theme: theme,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  }
}

function updateThemeSelector(theme) {
  // Theme selector moved from topbar to Settings page — no DOM element to update here.
  // The Settings page re-renders on setTheme() so active state is always current.
}

// ── Routing ───────────────────────────────────────────────────
const PAGES = ['dashboard', 'timetable', 'subjects', 'assignments', 'notices', 'resources', 'links', 'summary', 'settings', 'review'];
const sectionHistory = [];

function navigate(page, isBack = false, keepActiveSubject = false) {
  if (!PAGES.includes(page)) page = 'dashboard';

  // Unless explicitly instructed to keep active subject, clear activeSubject state
  if (!keepActiveSubject) {
    state.activeSubject = null;
  }

  const current = state.currentPage;
  if (!isBack && current && current !== page) {
    if (sectionHistory.length === 0 || sectionHistory[sectionHistory.length - 1] !== current) {
      sectionHistory.push(current);
    }
  }

  if (page === 'links' || page === 'summary') {
    state.resourcesTab = page;
    page = 'resources';
  } else if (page === 'resources') {
    if (!state.resourcesTab) state.resourcesTab = 'links';
  }

  state.currentPage = page;
  window.location.hash = (page === 'resources') ? (state.resourcesTab || 'resources') : page;

  document.querySelectorAll('.section-page').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page)
  );

  document.querySelectorAll('[data-nav]').forEach(el => {
    const navVal = el.dataset.nav;
    if (page === 'resources') {
      el.classList.toggle('active', navVal === 'resources' || navVal === state.resourcesTab);
    } else {
      el.classList.toggle('active', navVal === page);
    }
  });

  updateBackButtonUI();
  renderPage(page);
}

// Immediately attach to window so inline onclick handlers work without waiting for full script load
window.navigateTo = function(page) { navigate(page, false, false); };
window.navigate   = function(page) { navigate(page, false, false); };
window.navigateBack = function() {
  // If currently inside a single subject hub detail view, back action returns to list or previous route
  if (state.currentPage === 'subjects' && state.activeSubject) {
    state.activeSubject = null;
    if (sectionHistory.length > 0) {
      const prev = sectionHistory.pop();
      if (prev === 'subjects_overview' || prev === 'subjects') {
        updateBackButtonUI();
        renderSubjects();
        return;
      } else {
        navigate(prev, true);
        return;
      }
    } else {
      updateBackButtonUI();
      renderSubjects();
      return;
    }
  }

  if (sectionHistory.length > 0) {
    let prev = sectionHistory.pop();
    if (prev === 'subjects_overview') prev = 'subjects';
    state.activeSubject = null;
    navigate(prev, true);
  }
};

function updateBackButtonUI() {
  const backBtn = document.getElementById('nav-back-btn');
  if (!backBtn) return;
  const hasHistory = sectionHistory.length > 0 || (state.currentPage === 'subjects' && !!state.activeSubject);
  if (hasHistory) {
    backBtn.style.display = 'inline-flex';
    backBtn.disabled = false;
  } else {
    backBtn.style.display = 'none';
    backBtn.disabled = true;
  }
}

function renderPage(page) {
  try {
    switch (page) {
      case 'dashboard':   renderDashboard();   break;
      case 'review':      renderReview();      break;
      case 'timetable':   renderTimetable();   break;
      case 'subjects':    renderSubjects();    break;
      case 'assignments': renderAssignments(); break;
      case 'notices':     renderNotices();     break;
      case 'resources':
      case 'links':
      case 'summary':     renderResources();   break;
      case 'settings':    renderSettings();    break;
    }
  } catch (err) {
    console.error(`Error rendering page [${page}]:`, err);
    const targetEl = document.getElementById(`page-${page}`) || document.getElementById('page-resources');
    if (targetEl) {
      targetEl.innerHTML = `
        <div class="card" style="text-align:center;padding:40px 20px;margin-top:20px;border-left:3px solid var(--red)">
          <div style="font-size:2rem;margin-bottom:10px">⚠️</div>
          <div style="font-weight:700;font-size:1.05rem;margin-bottom:6px">Unable to render section</div>
          <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:16px">${err.message || 'An unexpected rendering error occurred.'}</div>
          <button class="btn-primary" onclick="location.reload()" style="font-size:0.85rem">Reload Campus OS</button>
        </div>
      `;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────
const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return String(dateStr);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function dueDaysLeft(dateStr) {
  if (!dateStr) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return null;
  return Math.round((due - now) / 86400000);
}

function formatRelativeDueDate(dateStr) {
  const days = dueDaysLeft(dateStr);
  if (days === null) return { label: 'No deadline', cls: 'ongoing' };
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, cls: 'overdue' };
  if (days === 0) return { label: 'Due Today', cls: 'today' };
  if (days === 1) return { label: 'Due Tomorrow', cls: 'soon' };
  if (days <= 7) return { label: `Due in ${days}d`, cls: 'soon' };
  return { label: formatDate(dateStr), cls: '' };
}

function isTaskOverdue(task) {
  if (!task || task.status !== 'pending') return false;
  if (task.noDeadline || (task.taskType === 'mission' && !task.dueDate)) return false;
  if (!task.dueDate) return false;
  return task.dueDate < todayStr();
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function currentTimeMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return 0;
  const parts = t.split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return 0;
  return parts[0] * 60 + parts[1];
}

function greetingWord() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Good night';
}

// Returns user's configured attendance target (default 75)
function getAttendanceTarget() {
  const stored = parseInt(safeGetStorage(KEY_ATT_TARGET, 75) || '75', 10);
  if (isNaN(stored) || stored < 50 || stored > 100) return 75;
  return stored;
}

// Builds a situation-aware context line for the dashboard masthead.
// Priority: attendance risk > overdue tasks > exam imminent > normal > all clear.
function buildDashboardContextLine(opts = {}) {
  const { attendancePct, attTarget, overdue, pending, classesLeft, totalClasses, examDaysLeft, firstName, dayClasses } = opts;
  const isWeekend = dayClasses !== undefined && dayClasses.length === 0;

  // Attendance at risk — highest urgency, surfaces immediately
  if (attendancePct !== null && attendancePct < attTarget) {
    return `Attendance at <strong>${attendancePct}%</strong> — below your ${attTarget}% target. Attend today's classes.`;
  }

  // Overdue tasks — second priority
  if (overdue > 0) {
    return `${overdue} overdue task${overdue !== 1 ? 's' : ''} need${overdue === 1 ? 's' : ''} attention before anything else.`;
  }

  // Exam imminent (≤ 7 days)
  if (examDaysLeft !== null && examDaysLeft >= 0 && examDaysLeft <= 7) {
    if (examDaysLeft === 0) return 'End-Sem exam is <strong>today</strong>. Good luck.';
    if (examDaysLeft === 1) return 'End-Sem exam is <strong>tomorrow</strong>. Make today count.';
    return `<strong>${examDaysLeft} days</strong> to End-Sem. Stay consistent.`;
  }

  // Weekend or free day with no tasks
  if (isWeekend && pending === 0) {
    return 'No classes today. A clear desk — use it well.';
  }

  // Normal day with classes remaining
  if (classesLeft > 0) {
    return `${classesLeft} class${classesLeft !== 1 ? 'es' : ''} remaining today.${pending > 0 ? ` ${pending} task${pending !== 1 ? 's' : ''} pending.` : ''}`;
  }

  // All classes done, tasks pending
  if (pending > 0) {
    return `Classes done for today. ${pending} task${pending !== 1 ? 's' : ''} still pending.`;
  }

  // Everything clear
  return 'All clear. Classes attended, tasks on track.';
}

function allTasks() {
  return [...state.assignments, ...state.customTasks];
}

function pendingCount() {
  return allTasks().filter(a => a.status === 'pending').length;
}

function overdueCount() {
  return allTasks().filter(a => isTaskOverdue(a)).length;
}

// ── Dynamic Timetable Loading ─────────────────────────────────
function isBreakEntry(c) {
  if (!c || typeof c !== 'object') return true;
  if (c.isBreak === true) return true;
  const type = (c.type || '').toLowerCase();
  const subject = (c.subject || '').toLowerCase();
  const code = (c.code || '').toLowerCase();

  if (type === 'off' || type === 'break' || type === 'recess') return true;
  if (subject === 'recess' || subject === 'break' || subject.includes('lunch')) return true;
  if (code === 'rec' || code === 'break') return true;
  return false;
}

function isTeachingClass(c) {
  return !isBreakEntry(c);
}

function getEmptyTimetable() {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

function loadTimetable() {
  const saved = safeGetStorage(KEY_CUSTOM_TIMETABLE, null);
  if (saved && typeof saved === 'object') return saved;
  const choice = safeGetStorage(KEY_TIMETABLE_CHOICE, null);
  if (choice === 'aids') {
    return TIMETABLE;
  }
  return getEmptyTimetable();
}

function isCustomTimetableActive() {
  const saved = safeGetStorage(KEY_CUSTOM_TIMETABLE, null);
  if (!saved || typeof saved !== 'object') return false;
  return Object.values(saved).some(arr => Array.isArray(arr) && arr.length > 0);
}

function saveTimetable(ttMap) {
  safeSetStorage(KEY_CUSTOM_TIMETABLE, ttMap);
  syncToCloud();
}

function resetTimetableToDefault() {
  if (!confirm("Clear your timetable schedule and start with a clean slate?")) return;
  safeSetStorage(KEY_CUSTOM_TIMETABLE, getEmptyTimetable());
  safeSetStorage(KEY_TIMETABLE_CHOICE, 'clean');
  syncToCloud();
  renderPage(state.currentPage);
  showToast("Timetable schedule cleared ✓", "info");
}

function loadOfficialAidsTimetable() {
  if (!confirm("Load the official Sem 3 SY AI-DS timetable schedule? This will set up your weekly classes.")) return;
  safeSetStorage(KEY_CUSTOM_TIMETABLE, TIMETABLE);
  safeSetStorage(KEY_TIMETABLE_CHOICE, 'aids');
  syncToCloud();
  renderPage(state.currentPage);
  showToast("Official SY AI-DS timetable loaded ✓", "success");
}

function todayClasses() {
  const tt = loadTimetable();
  const currentMin = currentTimeMinutes();
  return (tt[new Date().getDay()] || []).filter(c => isTeachingClass(c) && timeToMinutes(c.end || '23:59') > currentMin).length;
}

// ── SVG Icons ─────────────────────────────────────────────────
function svg(path, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const icons = {
  dashboard:   () => svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  timetable:   () => svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  calendar:    () => svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  assignments: () => svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>'),
  notices:     () => svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  bell:        () => svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  links:       () => svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  summary:     () => svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
  settings:    () => svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  check:       () => svg('<polyline points="20 6 9 17 4 12"/>'),
  clock:       () => svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  book:        () => svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  alert:       () => svg('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  search:      () => svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  sun:         () => svg('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
  moon:        () => svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  video:       () => svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'),
  list:        () => svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
  code:        () => svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
  eye:         () => svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  database:    () => svg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'),
  filetext:    () => svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  cpu:         () => svg('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>'),
  calculator:  () => svg('<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="16" y2="18"/>'),
  network:     () => svg('<rect x="9" y="2" width="6" height="4" rx="1"/><rect x="1" y="18" width="6" height="4" rx="1"/><rect x="17" y="18" width="6" height="4" rx="1"/><path d="M12 6v3M4 18v-4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v4"/><line x1="12" y1="10" x2="12" y2="13"/>'),
  wifi:        () => svg('<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>'),
  graduation:  () => svg('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>'),
  x:           () => svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  trash:       () => svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  edit:        () => svg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  layers:      () => svg('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
  plus:        () => svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  save:        () => svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
  link:        () => svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>'),
  user:        () => svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  target:      () => svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
};

function sunSVG()  { return icons.sun(); }
function moonSVG() { return icons.moon(); }

function getResourceIcon(name) {
  const map = {
    video: icons.video, list: icons.list, code: icons.code, eye: icons.eye,
    'book-open': icons.book, database: icons.database, 'file-text': icons.filetext,
    cpu: icons.cpu, calculator: icons.calculator, network: icons.network,
    wifi: icons.wifi, 'graduation-cap': icons.graduation,
  };
  return (map[name] || icons.link)();
}

const SUBJECT_ALIASES = {
  'DS': 'Data Structures',
  'DEMP': 'Digital Electronics',
  'AI': 'Artificial Intelligence',
  'MDM': 'Multi Disciplinary Minor',
  'PBST': 'Probability and Statistics',
  'COI': 'Constitution of India',
  'BMFA': 'Basic Mgmt',
  'OE-1': 'Open Elective 1',
  'OE-2': 'Open Elective 2'
};

window.handleQuickAdd = function() {
  const inputEl = document.getElementById('quick-add-input');
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (!text) return;

  let subjectCode = 'General';
  let subjectName = 'General';
  let foundAlias = false;

  // 1. Check dynamically against the user's subjects (from timetable, tasks, etc.)
  const lowerText = text.toLowerCase();
  const knownSubjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
  for (const s of knownSubjects) {
    const sName = (s.name || '').toLowerCase();
    const sCode = (s.code || '').toLowerCase();
    if ((sName && lowerText.includes(sName)) || (sCode && sCode.length >= 2 && lowerText.includes(sCode))) {
      subjectCode = s.code || s.name;
      subjectName = s.name;
      foundAlias = true;
      break;
    }
  }

  // 2. Fallback check against standard aliases
  if (!foundAlias) {
    for (const [key, val] of Object.entries(SUBJECT_ALIASES)) {
      if (lowerText.includes(key.toLowerCase()) || lowerText.includes(val.toLowerCase())) {
        subjectCode = key;
        subjectName = val;
        foundAlias = true;
        break;
      }
    }
  }

  if (!foundAlias) {
    console.log("[Quick Add] Assigned general category for text:", text);
  }

  let dueDate = new Date();
  let dateFound = false;
  
  if (lowerText.includes('today')) {
    dateFound = true;
  } else if (lowerText.includes('tomorrow')) {
    dueDate.setDate(dueDate.getDate() + 1);
    dateFound = true;
  } else if (lowerText.includes('next week')) {
    dueDate.setDate(dueDate.getDate() + 7);
    dateFound = true;
  } else if (lowerText.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)) {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const match = lowerText.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)[0];
    const targetIdx = days.indexOf(match);
    const currentIdx = dueDate.getDay();
    let diff = targetIdx - currentIdx;
    if (diff <= 0) diff += 7;
    dueDate.setDate(dueDate.getDate() + diff);
    dateFound = true;
  } else if (lowerText.match(/\b(\d{1,2})(st|nd|rd|th)\b/)) {
    const match = lowerText.match(/\b(\d{1,2})(st|nd|rd|th)\b/);
    const dayNum = parseInt(match[1]);
    dueDate.setDate(dayNum);
    if (dueDate < new Date()) dueDate.setMonth(dueDate.getMonth() + 1);
    dateFound = true;
  }

  const finalizeQuickAdd = (finalDateStr) => {
    const isMission = subjectCode === 'MIS' || subjectName === 'Mission';
    const isGen = subjectCode === 'GEN' || subjectName === 'General';
    const t = {
      id: 'c-' + Date.now(),
      subject: subjectName,
      code: subjectCode,
      title: text,
      taskType: isMission ? 'mission' : isGen ? 'general' : 'assignment',
      noDeadline: isMission,
      description: 'Added via Quick Add',
      dueDate: isMission ? '' : finalDateStr,
      priority: 'medium',
      status: 'pending',
      marks: 0,
      isCustom: true
    };
    
    state.customTasks.push(t);
    saveCustomTasks();
    
    const container = document.getElementById('quick-add-container');
    if (container) {
      container.innerHTML = `
        <div class="card card-sm" style="display:flex;align-items:center;gap:12px;background:var(--surface-2);color:var(--text-primary);padding:10px 14px;border:1px solid var(--accent)">
          <div style="color:var(--green)">${icons.check()}</div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:0.85rem">Added: ${t.title}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">
              ${!foundAlias ? '<span class="type-badge" style="padding:2px 4px;font-size:0.6rem;background:var(--accent-dim);color:var(--accent)">General</span> ' : ''}
              ${subjectCode} · Due: ${formatDate(finalDateStr)}
            </div>
          </div>
        </div>
      `;
      setTimeout(() => renderPage('dashboard'), 2500);
    }
  };

  if (!dateFound) {
    const container = document.getElementById('quick-add-container');
    if (container) {
      container.innerHTML = `
        <div class="card card-sm" style="display:flex;flex-direction:column;gap:10px;padding:12px">
          <div style="font-size:0.85rem;color:var(--text-secondary)">Couldn't detect a date for: <strong>"${text}"</strong></div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:0.8rem;color:var(--text-muted)">Due:</span>
            <input type="date" id="quick-add-date" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary)">
            <button class="btn btn-sm btn-primary" onclick="window._qaFinalize('${encodeURIComponent(text)}')">Save</button>
            <button class="btn btn-sm" onclick="cancelQuickAdd()">Cancel</button>
          </div>
        </div>
      `;
      window._qaFinalize = function(encText) {
        const val = document.getElementById('quick-add-date').value;
        if (val) {
          finalizeQuickAdd(val);
        }
      };
    }
  } else {
    finalizeQuickAdd(dueDate.toISOString().split('T')[0]);
  }
};

window.cancelQuickAdd = function() {
  delete window._qaFinalize;
  const container = document.getElementById('quick-add-container');
  if (container) {
    container.innerHTML = `
      <div class="card" style="display:flex;align-items:center;gap:10px;padding:8px 12px">
        <div style="color:var(--accent);opacity:0.8">${icons.plus()}</div>
        <input type="text" id="quick-add-input" enterkeyhint="done" placeholder="Add task: 'Math problem set due Friday'" style="flex:1;border:none;background:transparent;outline:none;font-size:0.9rem;color:var(--text-primary)" onkeypress="if(event.key==='Enter') handleQuickAdd()">
        <button class="btn btn-sm btn-primary" onclick="handleQuickAdd()" style="padding:4px 12px">Add</button>
      </div>
    `;
  }
};

window.handleRolloverAction = function(taskId, action) {
  const t = state.customTasks.find(x => x.id === taskId);
  if (!t) return;
  if (action === 'done') {
    t.status = 'submitted';
    saveCustomTasks();
    renderPage('review');
  } else if (action === 'reschedule') {
    const el = document.getElementById(`rollover-card-${taskId}`);
    if (el) {
      el.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:0.8rem;color:var(--text-muted)">Reschedule to:</div>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="date" id="resched-${taskId}" value="${t.dueDate}" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary)">
            <button class="btn btn-sm btn-primary" onclick="window._rsSave('${taskId}')">Save</button>
            <button class="btn btn-sm" onclick="renderPage('review')">Cancel</button>
          </div>
        </div>
      `;
    }
  }
};

window._rsSave = function(taskId) {
  const t = state.customTasks.find(x => x.id === taskId);
  if (!t) return;
  const val = document.getElementById(`resched-${taskId}`).value;
  if (val) {
    t.dueDate = val;
    saveCustomTasks();
  }
  renderPage('review');
};

function getWeekId(d = new Date()) {
  const year = d.getFullYear();
  const firstJan = new Date(year, 0, 1);
  const dayNum = Math.floor((d - firstJan) / 86400000);
  const weekNum = Math.ceil((dayNum + firstJan.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

function isWeeklyReviewDismissed() {
  const currentWeek = getWeekId();
  return localStorage.getItem(`cos_weekly_review_dismissed_${currentWeek}`) === 'true';
}

window.dismissWeeklyReview = function() {
  const currentWeek = getWeekId();
  localStorage.setItem(`cos_weekly_review_dismissed_${currentWeek}`, 'true');
  renderPage(state.currentPage);
};

window.completeWeeklyReset = function() {
  dismissWeeklyReview();
  showToast('Weekly reset complete! Ready for a clear, focused week. ✨', 'success');
  navigateTo('dashboard');
};

function renderReview() {
  const el = document.getElementById('page-review');
  if (!el) return;
  const now = new Date();
  
  const last7 = new Date(); last7.setDate(now.getDate() - 7);
  const lookbackStr = last7.toISOString().split('T')[0];
  const todayS = todayStr();
  
  const tasksCompleted = allTasks().filter(t => t.status === 'submitted' && t.dueDate && t.dueDate >= lookbackStr && t.dueDate <= todayS);
  const tasksRolledOver = allTasks().filter(t => isTaskOverdue(t) && t.dueDate >= lookbackStr);
  
  const next7 = new Date(); next7.setDate(now.getDate() + 7);
  const lookaheadStr = next7.toISOString().split('T')[0];
  
  const upcomingTasks = allTasks().filter(t => t.status === 'pending' && !t.noDeadline && t.dueDate && t.dueDate >= todayS && t.dueDate <= lookaheadStr);
  const upcomingNotices = NOTICES.filter(n => n.date >= todayS && n.date <= lookaheadStr);
  const recentNotices = NOTICES.filter(n => n.date >= lookbackStr && n.date <= todayS);
  
  const next7Days = {};
  for(let i=0; i<=7; i++) {
    const d = new Date(); d.setDate(now.getDate() + i);
    next7Days[d.toISOString().split('T')[0]] = { date: d, items: [] };
  }
  
  upcomingTasks.forEach(t => {
    if (next7Days[t.dueDate]) next7Days[t.dueDate].items.push({ type: 'task', data: t });
  });
  upcomingNotices.forEach(n => {
    if (next7Days[n.date]) next7Days[n.date].items.push({ type: 'notice', data: n });
  });
  
  let maxItems = 0;
  let busyDayDate = null;
  Object.keys(next7Days).forEach(dateStr => {
    const count = next7Days[dateStr].items.length;
    if (count > maxItems) {
      maxItems = count;
      busyDayDate = dateStr;
    }
  });
  if (maxItems < 2) busyDayDate = null;

  let lookaheadHTML = '';
  Object.keys(next7Days).sort().forEach(dateStr => {
    const day = next7Days[dateStr];
    if (day.items.length === 0) return;
    
    let itemsHTML = day.items.map(it => {
      if (it.type === 'task') {
        const a = it.data;
        const done = a.status === 'submitted';
        const taskType = a.taskType || 'assignment';
        return `
          <div class="card card-sm assignment-card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;padding:12px 14px">
            <div onclick="toggleAssignment('${a.id}')" title="Click to toggle status" style="width:18px;height:18px;border-radius:5px;border:2px solid ${done?'var(--green)':a.priority==='high'?'var(--red)':'var(--border)'};background:${done?'var(--green)':'transparent'};display:grid;place-items:center;flex-shrink:0;color:white;cursor:pointer">
              ${done ? icons.check() : ''}
            </div>
            <div style="flex:1;min-width:0">
              <div class="font-semibold" style="font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${done?'text-decoration:line-through;opacity:0.5':''}">${a.title}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-top:2px">
                <span onclick="openSubjectHub('${a.subject}')" style="cursor:pointer;font-weight:600">${a.subject}</span>
                <span class="type-badge type-${taskType}" style="font-size:0.62rem;padding:1px 6px">${taskType}</span>
              </div>
            </div>
          </div>
        `;
      } else {
        const n = it.data;
        return `
          <div class="card card-sm notice-card" style="margin-bottom:8px;padding:12px 14px">
            <div style="font-weight:600;font-size:0.9rem">${n.title}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">${n.category} ${n.important ? '· <strong style="color:var(--red)">Important</strong>' : ''}</div>
          </div>
        `;
      }
    }).join('');
    
    const isBusy = (dateStr === busyDayDate);
    
    lookaheadHTML += `
      <div style="margin-bottom:16px">
        <div style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-bottom:8px;display:flex;align-items:center;gap:8px">
          ${formatDate(dateStr)}
          ${isBusy ? '<span class="type-badge" style="background:color-mix(in srgb, var(--status-warning) 14%, transparent);color:var(--status-warning);padding:2px 6px;font-size:0.65rem">🔥 Busy Day</span>' : ''}
        </div>
        ${itemsHTML}
      </div>
    `;
  });
  
  if (!lookaheadHTML) {
    lookaheadHTML = `<div class="card" style="padding:20px;text-align:center;color:var(--text-muted)">✨ Nothing major scheduled for the upcoming 7 days.</div>`;
  }

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn btn-sm btn-secondary" onclick="navigateTo('dashboard')">← Back to Today</button>
        <div>
          <div style="font-size:1.3rem;font-weight:800;color:var(--text-primary)">Weekly Reflection &amp; Reset</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Review last week's coursework and plan your next 7 days</div>
        </div>
      </div>
    </div>
    
    <!-- 1. HIGH-VISIBILITY LAST WEEK LOOKBACK BANNER -->
    <div class="card" style="padding:18px 20px;margin-bottom:22px;background:var(--surface);border-left:3px solid var(--accent-warm)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:0.95rem;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px">
            <span>⏪ Last Week's Reflection</span>
            <span class="type-badge" style="background:var(--accent-dim);color:var(--brand-primary);font-size:0.7rem;padding:2px 8px">${formatDate(lookbackStr)} – ${formatDate(todayS)}</span>
          </div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">Lookback summary of completed tasks, rollover items, and study momentum.</div>
        </div>
      </div>

      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-card" onclick="filterAndNavigateToAssignments('submitted')" title="View completed coursework" style="cursor:pointer">
          <div class="stat-value" style="color:var(--green)">${tasksCompleted.length}</div>
          <div class="stat-label">Tasks Completed Last 7 Days →</div>
        </div>
        <div class="stat-card" onclick="filterAndNavigateToAssignments('overdue')" title="View rollover & overdue tasks" style="cursor:pointer">
          <div class="stat-value" style="color:${tasksRolledOver.length > 0 ? 'var(--red)' : 'var(--green)'}">${tasksRolledOver.length}</div>
          <div class="stat-label">Rollover / Overdue Tasks →</div>
        </div>
      </div>

      ${tasksCompleted.length > 0 ? `
        <div style="margin-bottom:14px">
          <div style="font-size:0.76rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--green);margin-bottom:6px">✓ Completed in this period:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${tasksCompleted.map(t => `
              <span class="filter-chip" style="font-size:0.75rem;padding:3px 10px;background:color-mix(in srgb, var(--status-success) 10%, transparent);color:var(--status-success);border:1px solid color-mix(in srgb, var(--status-success) 25%, transparent)">
                ✓ ${t.title} (${t.subject || 'Task'})
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${tasksRolledOver.length > 0 ? `
        <div>
          <div style="font-size:0.76rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--red);margin-bottom:6px">⚠ Tasks needing attention / reschedule:</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${tasksRolledOver.map(a => `
              <div class="card card-sm assignment-card" id="rollover-card-${a.id}" style="margin-bottom:0;display:flex;align-items:center;gap:12px;padding:10px 14px;border-left:3px solid var(--red)">
                <div style="flex:1;min-width:0">
                  <div class="font-semibold" style="font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.title}</div>
                  <div class="text-xs text-muted">${a.subject} · Due: ${formatDate(a.dueDate)}</div>
                </div>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-sm btn-secondary" style="color:var(--green);font-size:0.75rem;padding:4px 10px" onclick="handleRolloverAction('${a.id}', 'done')" title="Mark Done">✓ Done</button>
                  <button class="btn btn-sm btn-secondary" style="font-size:0.75rem;padding:4px 10px" onclick="handleRolloverAction('${a.id}', 'reschedule')" title="Reschedule for this week">📅 Reschedule</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    <div class="section-heading">2. Weekly Class Attendance Tracker</div>
    ${renderWeeklyAttendanceTracker()}

    ${recentNotices.length > 0 ? `
      <div class="section-heading">3. Recent Important Notices (Past 7 Days)</div>
      <div style="margin-bottom:22px">
        ${recentNotices.map(n => `
          <div class="card card-sm notice-card" onclick="showNotice('${n.id}')" style="margin-bottom:8px;padding:12px 14px;cursor:pointer">
            <div style="font-weight:600;font-size:0.88rem;color:var(--text-primary)">${n.title}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">${formatDate(n.date)} · ${n.category} ${n.important ? '· <strong style="color:var(--red)">Important</strong>' : ''}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="section-heading">4. Upcoming Week Lookahead (Next 7 Days)</div>
    ${lookaheadHTML}

    <div style="margin-top:24px;margin-bottom:32px;text-align:center">
      <button class="btn btn-primary" onclick="completeWeeklyReset()" style="width:100%;max-width:400px;padding:12px;font-size:0.9rem;font-weight:700">
        ✓ Complete Weekly Reset &amp; Return to Today
      </button>
    </div>
  `;
}

// ── Weekly Attendance Helper Functions ───────────────────────
function calculateSmartAttendanceGuidance(totalAttended, totalSkipped, targetPct = getAttendanceTarget()) {
  const totalMarked = totalAttended + totalSkipped;
  if (totalMarked === 0) {
    return {
      totalAttended: 0,
      totalSkipped: 0,
      totalMarked: 0,
      pct: null,
      isSafe: true,
      statusZone: 'Neutral',
      classesToAttend: 0,
      safeSkips: 0,
      message: 'No classes marked yet. Tap Attended or Skipped on today\'s classes to start tracking.',
      badgeLabel: 'Getting Started',
      badgeColor: 'var(--accent)'
    };
  }

  const pct = Math.round((totalAttended / totalMarked) * 100);
  const targetFraction = targetPct / 100;
  const isSafe = pct >= targetPct;

  let classesToAttend = 0;
  let safeSkips = 0;
  let message = '';

  if (!isSafe) {
    // Formula: ceil((targetFraction * T - A) / (1 - targetFraction))
    classesToAttend = Math.max(1, Math.ceil((targetFraction * totalMarked - totalAttended) / (1 - targetFraction)));
    message = `You are in the <strong>Risk Zone</strong> (${pct}%). Attend the next <strong>${classesToAttend} class${classesToAttend !== 1 ? 'es' : ''}</strong> continuously to reach the ${targetPct}% target.`;
  } else {
    // Formula: floor((A - targetFraction * T) / targetFraction)
    safeSkips = Math.max(0, Math.floor((totalAttended - targetFraction * totalMarked) / targetFraction));
    if (safeSkips > 0) {
      message = `You are in the <strong>Safe Zone</strong> (${pct}%). You can safely skip up to <strong>${safeSkips} class${safeSkips !== 1 ? 'es' : ''}</strong> without dropping below ${targetPct}%.`;
    } else {
      message = `You are on target at <strong>${pct}%</strong>. Attend your next class to build a safe skip buffer!`;
    }
  }

  return {
    totalAttended,
    totalSkipped,
    totalMarked,
    pct,
    isSafe,
    statusZone: isSafe ? 'Safe Zone' : 'Risk Zone',
    classesToAttend,
    safeSkips,
    message,
    badgeLabel: isSafe ? 'Safe Zone ✅' : 'Risk Zone ⚠️',
    badgeColor: isSafe ? 'var(--green)' : 'var(--red)'
  };
}

function getWeekDays(offset = 0) {
  const now = new Date();
  now.setDate(now.getDate() + (offset * 7));
  const currentDay = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const distanceToMon = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(now);
  monday.setDate(now.getDate() + distanceToMon);
  monday.setHours(0,0,0,0);

  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push(d);
  }
  return week;
}

function calculateAttendanceStreak() {
  const attendanceData = safeGetStorage(KEY_ATTENDANCE, {}) || {};
  const dates = Object.keys(attendanceData).sort().reverse();
  let streak = 0;
  for (const d of dates) {
    const dayClasses = attendanceData[d];
    const statuses = Object.values(dayClasses);
    if (!statuses.length) continue;
    if (statuses.includes('skipped')) {
      break;
    }
    if (statuses.includes('attended')) {
      streak += statuses.filter(s => s === 'attended').length;
    }
  }
  return streak;
}

window.setAttendanceWeekOffset = function(offset) {
  state.attendanceWeekOffset = offset;
  renderReview();
};

window.setAttendance = function(dateStr, classKey, status) {
  const data = safeGetStorage(KEY_ATTENDANCE, {}) || {};
  if (!data[dateStr]) data[dateStr] = {};
  
  if (data[dateStr][classKey] === status) {
    delete data[dateStr][classKey];
    showToast('Attendance status cleared', 'info');
  } else {
    data[dateStr][classKey] = status;
    if (status === 'attended') {
      const streak = calculateAttendanceStreak();
      showToast(streak >= 3 ? `Attendance logged: Attended ✓ (Streak: ${streak})` : 'Attendance logged: Attended ✓', 'success');
    } else {
      showToast('Attendance logged: Skipped', 'info');
    }
  }
  
  safeSetStorage(KEY_ATTENDANCE, data);
  syncToCloud();
  if (['timetable', 'review', 'dashboard', 'resources', 'links'].includes(state.currentPage)) {
    renderPage(state.currentPage);
  }
};

function renderWeeklyAttendanceTracker() {
  const ttData = loadTimetable();
  const attendanceData = safeGetStorage(KEY_ATTENDANCE, {}) || {};
  const weekOffset = state.attendanceWeekOffset || 0;
  const weekDays = getWeekDays(weekOffset);

  let totalAttended = 0;
  let totalLabsAttended = 0;
  let totalSkipped = 0;
  const subjectStats = {};

  let attendanceDaysHTML = '';
  let hasAnyClassesInWeek = false;

  weekDays.forEach(d => {
    const dateStr = d.toISOString().split('T')[0];
    const dayIdx = d.getDay();
    const dayClasses = (ttData[dayIdx] || []).filter(isTeachingClass);
    
    if (dayClasses.length === 0) return;
    hasAnyClassesInWeek = true;

    const dayName = DAY_NAMES[dayIdx];
    const isToday = dateStr === todayStr();

    let classListHTML = dayClasses.map(c => {
      const classKey = `${c.code || c.subject}_${c.time}`.replace(/[^a-zA-Z0-9_]/g, '');
      const status = attendanceData[dateStr]?.[classKey] || 'unset';
      const isLab = c.type === 'lab';
      const subjKey = `${c.subject} ${isLab ? '(Lab)' : ''}`;

      subjectStats[subjKey] = subjectStats[subjKey] || { total: 0, attended: 0 };
      subjectStats[subjKey].total++;

      if (status === 'attended') {
        totalAttended++;
        subjectStats[subjKey].attended++;
        if (isLab) totalLabsAttended++;
      } else if (status === 'skipped') {
        totalSkipped++;
      }

      return `
        <div class="card card-sm" style="margin-bottom:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:600;font-size:0.88rem;display:flex;align-items:center;gap:6px">
              ${c.subject}
              <span class="type-badge" style="font-size:0.65rem;padding:2px 6px;background:${isLab ? 'color-mix(in srgb, var(--status-success) 14%, transparent)' : 'var(--accent-dim)'};color:${isLab ? 'var(--status-success)' : 'var(--brand-primary)'}">
                ${isLab ? 'Lab' : 'Lecture'}
              </span>
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">
              ${c.time} ${c.end ? '- ' + c.end : ''} ${c.room ? '· ' + c.room : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn btn-sm" onclick="setAttendance('${dateStr}', '${classKey}', 'attended')" aria-label="Mark ${c.subject} as attended on ${formatDate(dateStr)}" aria-pressed="${status === 'attended'}" style="padding:5px 12px;font-size:0.75rem;font-weight:700;border-radius:var(--radius-xs,6px);background:${status==='attended'?'var(--green)':'var(--surface-2)'};color:${status==='attended'?'white':'var(--text-primary)'};border:1px solid ${status==='attended'?'var(--green)':'var(--border)'};cursor:pointer;transition:transform 0.1s ease">
              ${status==='attended'?'✓ Attended':'Attended'}
            </button>
            <button class="btn btn-sm" onclick="setAttendance('${dateStr}', '${classKey}', 'skipped')" aria-label="Mark ${c.subject} as skipped on ${formatDate(dateStr)}" aria-pressed="${status === 'skipped'}" style="padding:5px 12px;font-size:0.75rem;font-weight:700;border-radius:var(--radius-xs,6px);background:${status==='skipped'?'var(--red)':'var(--surface-2)'};color:${status==='skipped'?'white':'var(--text-primary)'};border:1px solid ${status==='skipped'?'var(--red)':'var(--border)'};cursor:pointer;transition:transform 0.1s ease">
              ${status==='skipped'?'✕ Skipped':'Skipped'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    attendanceDaysHTML += `
      <div style="margin-bottom:14px">
        <div style="font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px">
          ${dayName}, ${formatDate(dateStr)} ${isToday ? '<span style="color:var(--accent)">· Today</span>' : ''}
        </div>
        ${classListHTML}
      </div>
    `;
  });

  const weekSelectorHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-size:0.85rem;color:var(--text-muted);font-weight:500">
        ${formatDate(weekDays[0].toISOString().split('T')[0])} – ${formatDate(weekDays[6].toISOString().split('T')[0])}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm ${weekOffset === 0 ? 'btn-primary' : ''}" onclick="setAttendanceWeekOffset(0)" aria-pressed="${weekOffset === 0}" style="padding:4px 12px;font-size:0.75rem">This Week</button>
        <button class="btn btn-sm ${weekOffset === -1 ? 'btn-primary' : ''}" onclick="setAttendanceWeekOffset(-1)" aria-pressed="${weekOffset === -1}" style="padding:4px 12px;font-size:0.75rem">Last Week</button>
      </div>
    </div>
  `;

  if (!hasAnyClassesInWeek) {
    return `
      ${weekSelectorHTML}
      <div class="card" style="padding:20px;text-align:center;color:var(--text-muted);margin-bottom:20px">
        <div style="font-size:1.5rem;margin-bottom:6px">📅</div>
        <div style="font-weight:600;font-size:0.9rem;margin-bottom:4px;color:var(--text-primary)">Set up your timetable to start tracking classes</div>
        <div style="font-size:0.8rem;margin-bottom:12px">Add your weekly schedule to mark class attendance and view weekly totals.</div>
        <button class="btn-primary" onclick="navigateTo('timetable')" style="font-size:0.8rem;padding:6px 14px">Go to Timetable</button>
      </div>
    `;
  }

  const guidance = calculateSmartAttendanceGuidance(totalAttended, totalSkipped, 75);
  const streak = calculateAttendanceStreak();

  const subjectBreakdownHTML = Object.keys(subjectStats).map(subj => {
    const st = subjectStats[subj];
    const pct = st.total > 0 ? Math.round((st.attended / st.total) * 100) : 0;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px dotted var(--border);font-size:0.8rem">
        <span style="font-weight:600">${subj}</span>
        <span style="color:var(--text-secondary)">${st.attended} / ${st.total} attended (${pct}%)</span>
      </div>
    `;
  }).join('');

  return `
    <div style="margin-bottom:24px">
      ${weekSelectorHTML}
      ${attendanceDaysHTML}

      <!-- Gamified Attendance & Safe Bunk Guidance Card -->
      <div class="card" style="padding:16px;margin-bottom:16px;background:var(--surface-2);border-left:3px solid ${guidance.isSafe ? 'var(--green)' : 'var(--red)'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;font-size:0.98rem;color:var(--text-primary);display:flex;align-items:center;gap:8px">
              <span>Attendance Health &amp; Safe Skips</span>
              ${streak > 0 ? `<span class="type-badge" style="background:color-mix(in srgb, var(--status-warning) 14%, transparent);color:var(--status-warning);padding:2px 8px;font-size:0.7rem">🔥 ${streak}-Class Streak</span>` : ''}
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">Target threshold: <strong>75%</strong> minimum required attendance</div>
          </div>
          <span class="type-badge" style="font-size:0.75rem;padding:3px 9px;background:${guidance.isSafe ? 'color-mix(in srgb, var(--status-success) 14%, transparent)' : 'color-mix(in srgb, var(--status-error) 14%, transparent)'};color:${guidance.isSafe ? 'var(--status-success)' : 'var(--status-error)'}">
            ${guidance.badgeLabel}
          </span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:10px;margin-bottom:12px">
          <div style="background:var(--background);padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;color:var(--green)">${totalAttended}</div>
            <div style="font-size:0.72rem;color:var(--text-muted)">Attended</div>
          </div>
          <div style="background:var(--background);padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;color:var(--red)">${totalSkipped}</div>
            <div style="font-size:0.72rem;color:var(--text-muted)">Missed / Skipped</div>
          </div>
          <div style="background:var(--background);padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;color:${guidance.isSafe ? 'var(--green)' : 'var(--red)'}">${guidance.pct !== null ? guidance.pct + '%' : '0%'}</div>
            <div style="font-size:0.72rem;color:var(--text-muted)">Current Rate</div>
          </div>
          <div style="background:var(--background);padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;color:${guidance.isSafe ? 'var(--green)' : 'var(--red)'}">${guidance.isSafe ? guidance.safeSkips : guidance.classesToAttend}</div>
            <div style="font-size:0.72rem;color:var(--text-muted)">${guidance.isSafe ? 'Safe Skips' : 'Classes Needed'}</div>
          </div>
        </div>

        <div style="font-size:0.83rem;color:var(--text-primary);background:var(--background);padding:10px 12px;border-radius:6px;line-height:1.45;border:1px solid var(--border)">
          💡 ${guidance.message}
        </div>

        ${subjectBreakdownHTML ? `
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
            <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:6px">Per-Subject Breakdown</div>
            ${subjectBreakdownHTML}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ── Onboarding Flow ───────────────────────────────────────────
function checkOnboarding() {
  const p = loadProfile();
  if (!p.name && !localStorage.getItem('cos_onboarding_dismissed')) {
    setTimeout(showOnboardingModal, 400);
  }
}

window.showOnboardingModal = function() {
  if (document.getElementById('onboarding-backdrop')) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'onboarding-backdrop';
  
  const p = loadProfile();

  backdrop.innerHTML = `
    <div class="modal onboarding-card" id="onboarding-modal-box">
      <div id="onboarding-step-1">
        <div style="width:44px;height:44px;border-radius:12px;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;margin-bottom:16px">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <h2 style="margin:0 0 6px 0;font-size:1.35rem;font-weight:700;letter-spacing:-0.025em;color:var(--text-primary)">Welcome to Clarity Desk</h2>
        <div style="font-size:0.84rem;font-weight:600;color:var(--accent);margin-bottom:12px;letter-spacing:0.01em">Your calm, unified student workspace</div>
        <div style="font-size:0.88rem;color:var(--text-secondary);line-height:1.6;margin-bottom:24px">
          Manage your class schedule, monitor attendance safety, track tasks, and access study notes with zero clutter.
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn-primary" onclick="showOnboardingStep2()" style="width:100%;padding:11px;font-weight:600;justify-content:center;font-size:0.88rem">Set up profile →</button>
          <button class="btn-secondary" onclick="dismissOnboarding()" style="width:100%;padding:9px;font-size:0.84rem;justify-content:center">Explore first</button>
        </div>
      </div>

      <div id="onboarding-step-2" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div>
            <h2 style="margin:0;font-size:1.2rem;font-weight:700;letter-spacing:-0.02em;color:var(--text-primary)">Profile Setup</h2>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">Personalizes your timetable and countdown</div>
          </div>
          <span style="font-size:0.74rem;color:var(--text-muted);background:var(--surface-2);padding:3px 8px;border-radius:999px;border:1px solid var(--border)">Step 1 of 1</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Full Name <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="ob-name" value="${(p.name||'').replace(/"/g, '&quot;')}" placeholder="Your full name (e.g. Alex Morgan)">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Student ID / Roll Number <span style="color:var(--text-muted);font-weight:normal">(optional)</span></label>
            <input type="text" class="form-input" id="ob-roll" value="${(p.rollNo||'').replace(/"/g, '&quot;')}" placeholder="Student ID or Roll number (optional)">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">College / University <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="ob-college" value="${(p.college||'').replace(/"/g, '&quot;')}" placeholder="College, university, or school name">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Major / Branch / Department</label>
            <input type="text" class="form-input" id="ob-branch" value="${(p.branch||'').replace(/"/g, '&quot;')}" placeholder="e.g. Computer Science, Mechanical, Biology">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Year / Semester / Term</label>
            <input type="text" class="form-input" id="ob-year" value="${(p.year||'').replace(/"/g, '&quot;')}" placeholder="e.g. 3rd Semester, Year 2, Fall 2026">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Practical Batch / Section <span style="color:var(--text-muted);font-weight:normal">(optional)</span></label>
            <input type="text" class="form-input" id="ob-batch" value="${(p.batch||'').replace(/"/g, '&quot;')}" placeholder="e.g. A1, A2, B2, D1">
          </div>

          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-top:4px">
            <div style="font-weight:600;font-size:0.86rem;color:var(--text-primary);margin-bottom:2px">
              Timetable Schedule Setup
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.45;margin-bottom:10px">
              Start clean to build or scan your own class schedule, or load a sample college timetable.
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface)">
                <input type="radio" name="ob-tt-choice" value="clean" id="ob-tt-clean" checked style="accent-color:var(--accent)">
                <span>Start with a clean schedule</span>
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface)">
                <input type="radio" name="ob-tt-choice" value="aids" id="ob-tt-aids" style="accent-color:var(--accent)">
                <span>Load sample timetable (SY AI-DS)</span>
              </label>
            </div>
          </div>

          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-top:4px">
            <div style="font-weight:600;font-size:0.86rem;color:var(--text-primary);margin-bottom:2px">
              Set your current attendance (Optional)
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.45;margin-bottom:10px">
              Add your current attended and missed class counts once. Clarity Desk will track continuously from there.
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="showBaselineModal()" style="font-size:0.78rem;padding:5px 12px;display:inline-flex;align-items:center;gap:6px">
              📊 Set attendance counts →
            </button>
          </div>

          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-top:4px">
            <div style="font-weight:600;font-size:0.86rem;color:var(--text-primary);margin-bottom:2px">
              Attendance Target (%)
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.45;margin-bottom:8px">
              Configure your institution's minimum required attendance % (default is 75%).
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="number" class="form-input" id="ob-att-target" value="75" min="50" max="100" step="1" style="width:90px;font-size:0.88rem;padding:5px 10px">
              <span style="font-size:0.82rem;color:var(--text-muted)">% minimum</span>
            </div>
          </div>

          <div id="ob-error" style="color:var(--red);font-size:0.78rem;display:none">Please enter your name to finish setup.</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="dismissOnboarding()" style="font-size:0.82rem">Skip</button>
          <button class="btn-primary" onclick="finishOnboarding()" style="font-size:0.85rem;padding:8px 18px">Finish setup</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
};

window.showOnboardingStep2 = function() {
  const s1 = document.getElementById('onboarding-step-1');
  const s2 = document.getElementById('onboarding-step-2');
  if (s1) s1.style.display = 'none';
  if (s2) s2.style.display = 'block';
};

window.dismissOnboarding = function() {
  localStorage.setItem('cos_onboarding_dismissed', 'true');
  const existingChoice = safeGetStorage(KEY_TIMETABLE_CHOICE, null);
  if (!existingChoice) {
    safeSetStorage(KEY_TIMETABLE_CHOICE, 'clean');
  }
  document.getElementById('onboarding-backdrop')?.remove();
  renderPage(state.currentPage);
};

window.finishOnboarding = function() {
  const nameVal = (document.getElementById('ob-name')?.value || '').trim();
  const collegeVal = (document.getElementById('ob-college')?.value || '').trim();
  const errEl = document.getElementById('ob-error');

  if (!nameVal || !collegeVal) {
    if (errEl) errEl.style.display = 'block';
    return;
  }

  const isAidsOptIn = !!document.getElementById('ob-tt-aids')?.checked;

  let branchVal = (document.getElementById('ob-branch')?.value || '').trim();
  let yearVal = (document.getElementById('ob-year')?.value || '').trim();

  if (isAidsOptIn) {
    if (!branchVal) branchVal = 'AI & Data Science';
    if (!yearVal) yearVal = '2nd Year (Sem 3)';
    safeSetStorage(KEY_TIMETABLE_CHOICE, 'aids');
    const existingCustom = safeGetStorage(KEY_CUSTOM_TIMETABLE, null);
    if (!existingCustom) {
      safeSetStorage(KEY_CUSTOM_TIMETABLE, TIMETABLE);
    }
  } else {
    safeSetStorage(KEY_TIMETABLE_CHOICE, 'clean');
    const existingCustom = safeGetStorage(KEY_CUSTOM_TIMETABLE, null);
    if (!existingCustom) {
      safeSetStorage(KEY_CUSTOM_TIMETABLE, getEmptyTimetable());
    }
  }

  const profile = {
    name: nameVal,
    rollNo: (document.getElementById('ob-roll')?.value || '').trim(),
    college: collegeVal,
    branch: branchVal,
    year: yearVal,
    batch: (document.getElementById('ob-batch')?.value || '').trim(),
    examDate: liveProfile.examDate || '',
  };

  safeSetStorage(KEY_PROFILE, profile);
  Object.assign(liveProfile, profile);

  // Save attendance target from onboarding
  const obAttTargetRaw = parseInt(document.getElementById('ob-att-target')?.value || '75', 10);
  const obAttTargetSafe = (isNaN(obAttTargetRaw) || obAttTargetRaw < 50 || obAttTargetRaw > 100) ? 75 : obAttTargetRaw;
  safeSetStorage(KEY_ATT_TARGET, obAttTargetSafe);

  localStorage.setItem('cos_onboarding_dismissed', 'true');

  syncToCloud();
  updateTopbarProfile();
  document.getElementById('onboarding-backdrop')?.remove();
  renderPage(state.currentPage);
};

// ── Ask Clarity Assistant ─────────────────────────────────────

window.handleAssistantQuestion = function() {
  const el = document.getElementById('assistant-input');
  const text = (el ? el.value.trim() : '').toLowerCase();
  if (!text) return;

  const container = document.getElementById('assistant-answer-container');
  if (!container) return;

  container.innerHTML = '';
  let intentType = 'unknown';
  let intentData = {};

  if ((text.includes('today') && text.includes('need to')) || (text.includes('today') && text.includes('due')) || text.includes('what do i need to do today') || text.includes('what should i focus on')) {
    intentType = 'today-summary';
  } else if ((text.includes('overdue') || text.includes('late') || text.includes('pending')) && (text.includes('any') || text.includes('what'))) {
    intentType = 'overdue';
  } else if (text.includes('exam') || text.includes('test') || text.includes('quiz')) {
    intentType = 'exams';
  } else if (text.match(/\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/) && text.match(/\b(class|classes|left|have)\b/)) {
    intentType = 'timetable-day';
    intentData.dayMatch = text.match(/\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)[0];
  } else {
    // 1. Check dynamically against user's actual subjects
    const knownSubjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    for (const s of knownSubjects) {
      const sName = (s.name || '').toLowerCase();
      const sCode = (s.code || '').toLowerCase();
      if ((sName && text.includes(sName)) || (sCode && sCode.length >= 2 && text.includes(sCode))) {
        intentType = 'subject-tasks';
        intentData.subject = s.name;
        intentData.window = text.includes('next week') ? 'next-week' : 'this-week';
        break;
      }
    }
    // 2. Fallback to common aliases
    if (intentType === 'unknown') {
      for (const [key, val] of Object.entries(SUBJECT_ALIASES)) {
        if (text.includes(key.toLowerCase()) || text.includes(val.toLowerCase())) {
          intentType = 'subject-tasks';
          intentData.subject = key;
          intentData.window = text.includes('next week') ? 'next-week' : 'this-week';
          break;
        }
      }
    }
  }

  let answerHTML = '';
  switch (intentType) {
    case 'today-summary': answerHTML = answerTodaySummary(); break;
    case 'subject-tasks': answerHTML = answerSubjectTasks(intentData.subject, intentData.window); break;
    case 'timetable-day': answerHTML = answerTimetableDay(intentData.dayMatch); break;
    case 'overdue':       answerHTML = answerOverdueTasks(); break;
    case 'exams':         answerHTML = answerExams(); break;
    default:              answerHTML = answerUnknown(); break;
  }

  container.innerHTML = `
    <div class="card card-sm" style="margin-bottom:12px;padding:14px;background:var(--surface-2);border-left:3px solid var(--accent)">
      ${answerHTML}
    </div>
  `;
};

function answerTodaySummary() {
  const currentMin = currentTimeMinutes();
  const tt = loadTimetable();
  const dayClasses = tt[new Date().getDay()] || [];
  const nextClass = dayClasses.find(c => timeToMinutes(c.end || '23:59') > currentMin && c.type !== 'off' && c.subject !== 'Recess');
  const classesLeft = todayClasses();
  const tsks = allTasks().filter(a => a.status === 'pending' && a.dueDate === todayStr());
  
  let html = `<div style="font-weight:600;margin-bottom:8px">Today's Focus &amp; Summary</div>`;
  html += `<div style="font-size:0.85rem;margin-bottom:8px">You have ${classesLeft} class${classesLeft!==1?'es':''} left and ${tsks.length} task${tsks.length!==1?'s':''} due today.</div>`;
  if (nextClass) {
    html += `<div style="font-size:0.85rem;color:var(--text-secondary)">👉 Next session: <strong>${nextClass.subject}</strong> at ${nextClass.time} (${nextClass.room})</div>`;
  }
  if (tsks.length > 0) {
    html += `<ul style="font-size:0.85rem;color:var(--text-secondary);margin:8px 0 0 16px;padding:0">`;
    tsks.forEach(t => { html += `<li>${t.title}</li>`; });
    html += `</ul>`;
  }
  return html;
}

function answerSubjectTasks(subject, window) {
  const todayS = todayStr();
  const next7 = new Date(); next7.setDate(new Date().getDate() + 7);
  const next7Str = next7.toISOString().split('T')[0];
  
  let tsks = allTasks().filter(a => a.status === 'pending' && a.code === subject);
  if (window === 'this-week') {
    tsks = tsks.filter(a => a.dueDate >= todayS && a.dueDate <= next7Str);
  } else {
    const next14 = new Date(); next14.setDate(new Date().getDate() + 14);
    tsks = tsks.filter(a => a.dueDate > next7Str && a.dueDate <= next14.toISOString().split('T')[0]);
  }
  
  let html = `<div style="font-weight:600;margin-bottom:8px">${subject} Tasks (${window.replace('-', ' ')})</div>`;
  if (tsks.length === 0) {
    html += `<div style="font-size:0.85rem">No pending tasks found for ${subject}.</div>`;
  } else {
    html += `<ul style="font-size:0.85rem;color:var(--text-secondary);margin:0 0 0 16px;padding:0">`;
    tsks.forEach(t => { html += `<li>${t.title} (Due: ${formatDate(t.dueDate)})</li>`; });
    html += `</ul>`;
  }
  return html;
}

function answerTimetableDay(dayMatch) {
  let targetDate = new Date();
  if (dayMatch === 'tomorrow') {
    targetDate.setDate(targetDate.getDate() + 1);
  } else {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const targetIdx = days.indexOf(dayMatch);
    const currentIdx = targetDate.getDay();
    let diff = targetIdx - currentIdx;
    if (diff <= 0) diff += 7;
    targetDate.setDate(targetDate.getDate() + diff);
  }
  
  const tt = loadTimetable();
  const dayIdx = targetDate.getDay();
  const classes = (tt[dayIdx] || []).filter(c => c.type !== 'off' && c.subject !== 'Recess');
  
  let html = `<div style="font-weight:600;margin-bottom:8px">Classes on ${DAY_NAMES[dayIdx]}</div>`;
  if (classes.length === 0) {
    html += `<div style="font-size:0.85rem">You have no classes scheduled.</div>`;
  } else {
    html += `<div style="font-size:0.85rem;margin-bottom:8px">You have ${classes.length} class${classes.length!==1?'es':''}:</div>`;
    html += `<ul style="font-size:0.85rem;color:var(--text-secondary);margin:0 0 0 16px;padding:0">`;
    classes.forEach(c => { html += `<li><strong>${c.subject}</strong> (${c.time} · ${c.room})</li>`; });
    html += `</ul>`;
  }
  return html;
}

function answerOverdueTasks() {
  const tsks = allTasks().filter(t => isTaskOverdue(t));
  let html = `<div style="font-weight:600;margin-bottom:8px">Overdue Tasks</div>`;
  if (tsks.length === 0) {
    html += `<div style="font-size:0.85rem">You have no overdue tasks — all clear!</div>`;
  } else {
    html += `<div style="font-size:0.85rem;margin-bottom:8px">You have ${tsks.length} overdue task(s):</div>`;
    html += `<ul style="font-size:0.85rem;color:var(--text-secondary);margin:0 0 0 16px;padding:0">`;
    tsks.forEach(t => { html += `<li>${t.title} (Due: ${formatDate(t.dueDate)})</li>`; });
    html += `</ul>`;
  }
  return html;
}

function answerExams() {
  const tsks = allTasks().filter(t => t.status === 'pending' && (t.title.toLowerCase().includes('exam') || t.title.toLowerCase().includes('test') || t.title.toLowerCase().includes('quiz')));
  const nts = NOTICES.filter(n => n.category.toLowerCase().includes('exam') || n.title.toLowerCase().includes('exam') || n.title.toLowerCase().includes('test'));
  
  let html = `<div style="font-weight:600;margin-bottom:8px">Upcoming Exams &amp; Tests</div>`;
  if (tsks.length === 0 && nts.length === 0) {
    html += `<div style="font-size:0.85rem">No upcoming exams or tests found in your tasks or notice board.</div>`;
  } else {
    html += `<ul style="font-size:0.85rem;color:var(--text-secondary);margin:0 0 0 16px;padding:0">`;
    tsks.forEach(t => { html += `<li>${t.title} (Due: ${formatDate(t.dueDate)})</li>`; });
    nts.forEach(n => { html += `<li>${n.title} (Notice Date: ${formatDate(n.date)})</li>`; });
    html += `</ul>`;
  }
  return html;
}

function answerUnknown() {
  return `
    <div style="font-weight:600;margin-bottom:8px">Here are a few questions you can ask Clarity Desk:</div>
    <ul style="font-size:0.85rem;color:var(--text-muted);margin:8px 0 0 16px;padding:0">
      <li>"What should I focus on today?"</li>
      <li>"Show DS tasks due this week"</li>
      <li>"How many classes do I have tomorrow?"</li>
      <li>"Any overdue tasks?"</li>
      <li>"When are my upcoming exams?"</li>
    </ul>
  `;
}

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
  const el       = document.getElementById('page-dashboard');
  if (!el) return;
  liveProfile    = loadProfile();
  const now      = new Date();
  const dateStr  = todayStr();
  const currentMin = currentTimeMinutes();
  const dayIdx   = now.getDay();

  const pending  = pendingCount();
  const overdue  = overdueCount();
  const classesLeftCount = todayClasses();

  const total          = allTasks().length;
  const submittedCount = allTasks().filter(a => a.status === 'submitted').length;
  const progress       = total === 0 ? 0 : Math.round((submittedCount / total) * 100);

  const liveTT     = loadTimetable();
  const dayClasses = (liveTT[dayIdx] || []).filter(isTeachingClass);

  // Attendance calculation & risk assessment (incorporates baseline + live tracking)
  const attendanceData = safeGetStorage(KEY_ATTENDANCE, {}) || {};
  const overallAtt = getOverallAttendance();
  const totalAttended = overallAtt.attended;
  const totalSkipped = overallAtt.skipped;
  const totalMarked = overallAtt.total;
  const attendancePct = overallAtt.pct;
  const attTarget = getAttendanceTarget();
  const isAttendanceAtRisk = attendancePct !== null && attendancePct < attTarget;
  const dashGuidance = calculateSmartAttendanceGuidance(totalAttended, totalSkipped, attTarget);

  // Active class (now) or next class
  let activeClass = null;
  let nextClass = null;

  for (const c of dayClasses) {
    const startMin = timeToMinutes(c.time || '00:00');
    const endMin   = timeToMinutes(c.end || '23:59');
    if (currentMin >= startMin && currentMin < endMin) {
      activeClass = c;
      break;
    }
  }

  if (!activeClass) {
    nextClass = dayClasses.find(c => timeToMinutes(c.time || '00:00') > currentMin);
  }

  // Exam countdown
  let countdownText = '';
  if (liveProfile.examDate) {
    const today    = new Date(); today.setHours(0,0,0,0);
    const examDay  = new Date(liveProfile.examDate + 'T00:00:00');
    const daysLeft = Math.ceil((examDay - today) / 86400000);
    if (daysLeft > 0) {
      countdownText = `${daysLeft} days to End-Sem (${formatDate(liveProfile.examDate)})`;
    } else if (daysLeft === 0) {
      countdownText = `End-Sem Exam is today`;
    }
  }

  const displayName = getDisplayName();
  const firstName = displayName ? displayName.split(' ')[0] : '';
  const greeting = greetingWord();
  const needsSetup = !displayName;
  const hasAttendanceData = totalMarked > 0;

  // Exam days left (null if not set)
  const examDaysLeftNum = (liveProfile.examDate && countdownText)
    ? (() => { const today = new Date(); today.setHours(0,0,0,0); return Math.ceil((new Date(liveProfile.examDate + 'T00:00:00') - today) / 86400000); })()
    : null;

  // Situation-aware context line replacing the generic sub-greeting
  const contextLine = buildDashboardContextLine({
    attendancePct,
    attTarget,
    overdue,
    pending,
    classesLeft: classesLeftCount,
    totalClasses: dayClasses.length,
    examDaysLeft: examDaysLeftNum,
    firstName,
    dayClasses,
  });

  // Setup completeness — recommended 3-step setup order for first-run users
  const setupSteps = [];
  
  // 1. Set Practical Batch & Profile
  const currentProf = loadProfile() || liveProfile || {};
  const hasProfileSetup = !!((currentProf.name && currentProf.name.trim()) || (currentProf.batch && currentProf.batch.trim()));
  if (!hasProfileSetup) {
    setupSteps.push({
      id: 'profile',
      label: '1. Set Practical Batch & Profile',
      desc: 'Set your name, semester, and batch for filtered timetable views.',
      action: `navigateTo('settings')`,
      icon: '👤'
    });
  }

  // 2. Import Timetable
  const hasCustomTT = isCustomTimetableActive();
  if (!hasCustomTT) {
    setupSteps.push({
      id: 'tt',
      label: '2. Import Timetable Schedule',
      desc: 'Scan your schedule photo, add class slots, or load a sample template.',
      action: `navigateTo('timetable')`,
      icon: '🗓️'
    });
  }

  // 3. Set Attendance Starting Counts
  const currentBaselines = loadAttendanceBaselines();
  const hasBaselinesConfigured = Object.keys(currentBaselines).length > 0;
  if (!hasAttendanceData && !hasBaselinesConfigured) {
    setupSteps.push({
      id: 'att',
      label: '3. Set Attendance Starting Counts',
      desc: 'Enter your portal baseline once to unlock percentage tracking and safe skips.',
      action: `showBaselineModal(null, 'manual')`,
      icon: '📊'
    });
  }

  const isFullySetup = setupSteps.length === 0;

  // Masthead ticker items in monospace ledger strip
  const formattedDay = `${DAY_NAMES[dayIdx]}, ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}`;
  const tickerItems = [];
  tickerItems.push(`<span class="desk-ticker-item">${icons.calendar()} ${formattedDay}</span>`);
  if (dayClasses.length > 0) {
    tickerItems.push(`<span class="desk-ticker-item">${classesLeftCount}/${dayClasses.length} classes remaining</span>`);
  }
  tickerItems.push(`<span class="desk-ticker-item" style="color:${overdue > 0 ? 'var(--red)' : 'inherit'}">${pending} pending task${pending !== 1 ? 's' : ''}${overdue > 0 ? ` (${overdue} overdue)` : ''}</span>`);
  if (attendancePct !== null) {
    tickerItems.push(`<span class="desk-ticker-item" style="color:${isAttendanceAtRisk ? 'var(--red)' : 'var(--green)'}">Attendance: ${attendancePct}% (${dashGuidance.isSafe ? 'Safe' : 'Action needed'})</span>`);
  }
  if (countdownText) {
    tickerItems.push(`<span class="desk-ticker-item">🎯 ${countdownText}</span>`);
  }
  const tickerHTML = tickerItems.join('<span class="desk-ticker-sep">/</span>');

  // Streamlined 1-line desk vitals bar
  const vitalsPills = [];
  vitalsPills.push(`
    <span class="desk-vitals-pill" onclick="navigateTo('timetable')" title="View Today's Schedule">
      ${icons.calendar()} ${formattedDay}
    </span>
  `);
  if (dayClasses.length > 0) {
    vitalsPills.push(`
      <span class="desk-vitals-pill" onclick="navigateTo('timetable')" title="View Today's Schedule">
        📚 ${classesLeftCount} of ${dayClasses.length} classes left
      </span>
    `);
  } else {
    vitalsPills.push(`
      <span class="desk-vitals-pill" onclick="navigateTo('timetable')" title="View Timetable">
        🏖️ No classes today
      </span>
    `);
  }
  vitalsPills.push(`
    <span class="desk-vitals-pill ${overdue > 0 ? 'is-critical' : pending > 0 ? '' : 'is-safe'}" onclick="filterAndNavigateToAssignments('${overdue > 0 ? 'overdue' : 'pending'}')" title="View Tasks">
      📝 ${pending} task${pending !== 1 ? 's' : ''}${overdue > 0 ? ` (${overdue} overdue)` : ''}
    </span>
  `);
  if (attendancePct !== null) {
    vitalsPills.push(`
      <span class="desk-vitals-pill ${isAttendanceAtRisk ? 'is-critical' : 'is-safe'}" onclick="navigateTo('review')" title="View Attendance Guidance">
        📊 ${attendancePct}% attendance · ${dashGuidance.isSafe ? 'Safe' : 'Needs attention'}
      </span>
    `);
  } else {
    vitalsPills.push(`
      <span class="desk-vitals-pill" onclick="showBaselineModal(null, 'manual')" title="Set Attendance Baseline">
        📊 Attendance: Not set
      </span>
    `);
  }
  if (countdownText) {
    vitalsPills.push(`
      <span class="desk-vitals-pill" onclick="navigateTo('settings')" title="Exam Date Settings">
        🎯 ${countdownText}
      </span>
    `);
  }
  const vitalsBarHTML = `<div class="desk-vitals-bar">${vitalsPills.join('')}</div>`;

  // Signature Chrono Beacon (Active lecture, next slot, day complete, or free day)
  let beaconHTML = '';
  if (activeClass) {
    const classKey = `${activeClass.code || activeClass.subject}_${activeClass.time}`.replace(/[^a-zA-Z0-9_]/g, '');
    const status = attendanceData[dateStr]?.[classKey] || 'unset';
    beaconHTML = `
      <div class="chrono-beacon is-live" role="region" aria-label="Current class in session">
        <div style="flex:1;min-width:180px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="chrono-beacon-badge" style="background:color-mix(in srgb, var(--status-success) 15%, transparent);color:var(--status-success)">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--status-success);box-shadow:0 0 6px var(--status-success)"></span>
              In Session
            </span>
            <span class="chrono-beacon-time">${activeClass.time} → ${activeClass.end || 'end'}</span>
          </div>
          <div class="chrono-beacon-title" onclick="openSubjectHub('${activeClass.subject}')" style="cursor:pointer" title="Open Subject Hub">
            ${activeClass.subject}
          </div>
          <div class="chrono-beacon-meta">
            ${activeClass.room ? `<span>📍 ${activeClass.room}</span>` : ''}
            ${activeClass.teacher ? `<span>👤 Prof. ${activeClass.teacher}</span>` : ''}
            <span class="type-badge type-${activeClass.type || 'lecture'}" style="font-size:0.62rem">${activeClass.type || 'lecture'}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <button class="btn btn-sm ${status==='attended'?'btn-primary':'btn-secondary'}" onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'attended')" style="padding:5px 12px;font-size:0.76rem;font-weight:600;${status==='attended'?'background:var(--status-success);border-color:var(--status-success);color:white;':''}">
            ${status==='attended'?'Attended ✓':'Mark Attended'}
          </button>
          <button class="btn btn-sm ${status==='skipped'?'btn-primary':'btn-secondary'}" onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'skipped')" style="padding:5px 12px;font-size:0.76rem;font-weight:600;${status==='skipped'?'background:var(--status-error);border-color:var(--status-error);color:white;':''}">
            ${status==='skipped'?'Skipped':'Skip'}
          </button>
        </div>
      </div>`;
  } else if (nextClass) {
    beaconHTML = `
      <div class="chrono-beacon" role="region" aria-label="Next upcoming class">
        <div style="flex:1;min-width:180px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="chrono-beacon-badge" style="background:color-mix(in srgb, var(--accent-warm) 15%, transparent);color:var(--accent-warm)">⏳ Next Up</span>
            <span class="chrono-beacon-time">${nextClass.time} → ${nextClass.end || 'end'}</span>
          </div>
          <div class="chrono-beacon-title" onclick="openSubjectHub('${nextClass.subject}')" style="cursor:pointer" title="Open Subject Hub">
            ${nextClass.subject}
          </div>
          <div class="chrono-beacon-meta">
            ${nextClass.room ? `<span>📍 ${nextClass.room}</span>` : ''}
            ${nextClass.teacher ? `<span>👤 Prof. ${nextClass.teacher}</span>` : ''}
            <span class="type-badge type-${nextClass.type || 'lecture'}" style="font-size:0.62rem">${nextClass.type || 'lecture'}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="openSubjectHub('${nextClass.subject}')" style="font-size:0.75rem;padding:6px 12px">
          Open Subject Hub →
        </button>
      </div>`;
  } else if (dayClasses.length > 0 && classesLeftCount === 0) {
    beaconHTML = `
      <div class="chrono-beacon is-finished" role="region" aria-label="Classes completed for today">
        <div style="flex:1;min-width:180px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="chrono-beacon-badge" style="background:color-mix(in srgb, var(--status-success) 12%, transparent);color:var(--status-success)">✓ Day Complete</span>
            <span style="font-size:0.78rem;color:var(--text-muted)">All ${dayClasses.length} classes finished today</span>
          </div>
          <div class="chrono-beacon-title">Classes Done for Today</div>
          <div class="chrono-beacon-meta">
            <span>${pending > 0 ? `📝 ${pending} task${pending !== 1 ? 's' : ''} pending on your desk` : '🌿 No pending tasks. Enjoy your evening.'}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="navigateTo('${pending > 0 ? 'assignments' : 'links'}')" style="font-size:0.75rem;padding:6px 12px">
          ${pending > 0 ? 'Review Tasks →' : 'Study Vault →'}
        </button>
      </div>`;
  } else {
    beaconHTML = `
      <div class="chrono-beacon is-free" role="region" aria-label="Free day">
        <div style="flex:1;min-width:180px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="chrono-beacon-badge" style="background:var(--surface-2);color:var(--text-secondary)">🏖️ Rest Day</span>
            <span style="font-size:0.78rem;color:var(--text-muted)">${DAY_NAMES[dayIdx]}</span>
          </div>
          <div class="chrono-beacon-title">No Classes Today</div>
          <div class="chrono-beacon-meta">
            <span>${!isCustomTimetableActive() ? 'Add your class schedule to track daily lectures.' : 'A free day on your study desk.'}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="navigateTo('${!isCustomTimetableActive() ? 'timetable' : 'assignments'}')" style="font-size:0.75rem;padding:6px 12px">
          ${!isCustomTimetableActive() ? 'Set Schedule →' : 'View Tasks →'}
        </button>
      </div>`;
  }

  // Setup guide banner — shown only when there are missing setup steps
  const setupBanner = !isFullySetup ? `
    <div class="desk-setup-guide" role="complementary" aria-label="Setup checklist">
      <div class="setup-guide-header">
        <span class="setup-guide-title">🚀 Welcome · Recommended Setup Order</span>
        <span class="setup-guide-count">${setupSteps.length} step${setupSteps.length !== 1 ? 's' : ''} left</span>
      </div>
      <div class="setup-guide-steps">
        ${setupSteps.map((s) => `
          <button class="setup-guide-step" onclick="${s.action}" aria-label="${s.label}">
            <span class="setup-step-icon">${s.icon}</span>
            <div style="flex:1;min-width:0">
              <div class="setup-step-label" style="font-weight:600;color:var(--text-primary)">${s.label}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px">${s.desc}</div>
            </div>
            <span class="setup-step-arrow" style="font-weight:600;font-size:0.8rem">Start →</span>
          </button>
        `).join('')}
      </div>
    </div>` : '';

  // Urgent & Active tasks
  const urgentTasks = allTasks()
    .filter(a => a.status === 'pending')
    .sort((a,b) => {
      const isOngoingA = !!a.noDeadline || (a.taskType === 'mission' && !a.dueDate);
      const isOngoingB = !!b.noDeadline || (b.taskType === 'mission' && !b.dueDate);
      if (isOngoingA && !isOngoingB) return 1;
      if (!isOngoingA && isOngoingB) return -1;
      if (isOngoingA && isOngoingB) return a.title.localeCompare(b.title);
      const daysA = dueDaysLeft(a.dueDate);
      const daysB = dueDaysLeft(b.dueDate);
      if (daysA !== null && daysB !== null) {
        if (daysA < 0 && daysB >= 0) return -1;
        if (daysB < 0 && daysA >= 0) return 1;
      }
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    })
    .slice(0, 4);

  // Latest notice
  const latestNotice = NOTICES.find(n => n.important) || NOTICES[0];
  const quickLinksPreview = loadCustomLinks().slice(0, 4);

  el.innerHTML = `
    <!-- 1. ARCHITECTURAL MASTHEAD & GREETING -->
    <div class="desk-masthead">
      <div class="desk-masthead-top">
        <div>
          <div class="desk-greeting">${greeting}${firstName ? `, <span class="desk-greeting-name">${firstName}</span>` : ''}.${needsSetup ? '' : ''}</div>
          <div class="desk-greeting-sub">${contextLine}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;align-self:flex-end">
          <button class="btn btn-sm btn-secondary" onclick="navigateTo('review')" title="Weekly reflection &amp; guidance" style="font-size:0.76rem;padding:5px 12px;white-space:nowrap;flex-shrink:0">
            Weekly Review →
          </button>
        </div>
      </div>
      ${vitalsBarHTML}
    </div>

    <!-- 2. PRIMARY FOCUS ANCHOR (CHRONO BEACON) -->
    ${beaconHTML}
    ${setupBanner}

    <!-- 3. WORKBENCH & AMBIENT PANEL -->
    <div class="dashboard-layout">

      <!-- LEFT COLUMN: WORKBENCH -->
      <div class="dashboard-left">
        <!-- SCHEDULE LEDGER -->
        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-title">Today's Schedule ${dayClasses.length > 0 ? `<span style="font-family:var(--font-mono);font-size:0.65rem;font-weight:500;color:var(--text-muted);margin-left:4px;letter-spacing:0;text-transform:none">${classesLeftCount}/${dayClasses.length}</span>` : ''}</div>
            <button class="panel-action" onclick="navigateTo('timetable')">Full timetable →</button>
          </div>
          <!-- Open ledger: no card box -->
          ${dayClasses.length > 0 ? `
            <div class="schedule-ledger">
              ${dayClasses.map(c => {
                const classKey = `${c.code || c.subject}_${c.time}`.replace(/[^a-zA-Z0-9_]/g, '');
                const status = attendanceData[dateStr]?.[classKey] || 'unset';
                const isNow = (currentMin >= timeToMinutes(c.time || '00:00') && currentMin < timeToMinutes(c.end || '23:59'));
                const isPast = (currentMin >= timeToMinutes(c.end || '23:59'));
                return `
                  <div class="schedule-slot ${isNow ? 'is-now' : ''} ${isPast ? 'is-past' : ''}">
                    <div class="schedule-slot-time">${c.time}${c.end ? '–' + c.end : ''}</div>
                    <div style="flex:1;min-width:100px;cursor:pointer" onclick="openSubjectHub('${c.subject}')">
                      <div class="schedule-slot-title">${c.subject}</div>
                      <div style="font-size:0.71rem;color:var(--text-muted);margin-top:1px">${c.room ? c.room + ' · ' : ''}${c.teacher ? 'Prof. ' + c.teacher + ' · ' : ''}${c.type || 'lecture'}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
                      <button class="btn btn-xs ${status==='attended'?'btn-primary':'btn-secondary'}" onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'attended')" style="padding:3px 8px;font-size:0.69rem;font-weight:600;${status==='attended'?'background:var(--green);border-color:var(--green);color:white;':''}">${status==='attended'?'Attended ✓':'Present'}</button>
                      <button class="btn btn-xs ${status==='skipped'?'btn-primary':'btn-secondary'}" onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'skipped')" style="padding:3px 8px;font-size:0.69rem;font-weight:600;${status==='skipped'?'background:var(--red);border-color:var(--red);color:white;':''}">${status==='skipped'?'Skipped':'Missed'}</button>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          ` : `
            <div style="padding:20px 0;color:var(--text-muted);font-size:0.85rem">${!isCustomTimetableActive() ? 'No timetable set up yet. <button class="setup-inline-link" onclick="navigateTo(\'timetable\')">Add your schedule →</button>' : 'No classes today — a free day on your desk.'}</div>
          `}
        </div>

        <!-- TASKS & DEADLINES -->
        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-title">Tasks &amp; Deadlines</div>
            <button class="panel-action" onclick="navigateTo('assignments')">All tasks (${pending}) →</button>
          </div>

          <!-- Progress bar -->
          <div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
              <span style="font-size:0.74rem;color:var(--text-muted)">${submittedCount} of ${total} completed</span>
              <span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted)">${progress}%</span>
            </div>
            <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
          </div>

          <!-- Open task rows -->
          <div style="position:relative;padding-left:4px">
            ${urgentTasks.length > 0 ? urgentTasks.map(a => {
              const isOngoing = !!a.noDeadline || (a.taskType === 'mission' && !a.dueDate);
              const rel = isOngoing ? { label: 'Ongoing', cls: 'ongoing' } : formatRelativeDueDate(a.dueDate);
              const done = a.status === 'submitted';
              const pCls = a.priority === 'high' ? 'priority-high' : a.priority === 'medium' ? 'priority-medium' : 'priority-low';
              return `
                <div class="task-ledger-item ${pCls}">
                  <div class="task-checkbox ${done ? 'checked' : ''}" onclick="toggleAssignment('${a.id}')" title="Mark completed">
                    ${done ? icons.check() : ''}
                  </div>
                  <div style="flex:1;min-width:0;cursor:pointer" onclick="navigateTo('assignments')">
                    <div style="font-weight:600;font-size:0.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${done?'text-decoration:line-through;opacity:0.45':''}">${a.title}</div>
                    <div style="font-size:0.71rem;color:var(--text-muted);margin-top:2px;display:flex;align-items:center;gap:5px">
                      <span onclick="event.stopPropagation(); openSubjectHub('${a.subject}')" style="color:var(--accent);font-weight:600;cursor:pointer">${a.subject || 'General'}</span>
                      <span>·</span>
                      <span>${isOngoing ? 'Standing' : formatDate(a.dueDate)}</span>
                    </div>
                  </div>
                  <span class="due-badge ${rel.cls}" style="font-size:0.68rem;padding:2px 6px;font-family:var(--font-mono);flex-shrink:0">${rel.label}</span>
                </div>`;
            }).join('') : `<div style="padding:12px 0;color:var(--text-muted);font-size:0.84rem">🌿 All caught up. No urgent tasks.</div>`}
          </div>

          <!-- Inline Task Quick Add -->
          <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
            <input type="text" id="quick-add-input" class="form-input" enterkeyhint="done" placeholder="+ Add a task… e.g. 'Lab report due Friday'" onkeypress="if(event.key==='Enter') handleQuickAdd()" style="font-size:0.82rem;padding:7px 12px;height:36px;flex:1">
            <button class="btn btn-sm btn-secondary" onclick="handleQuickAdd()" style="padding:6px 12px;font-size:0.78rem;flex-shrink:0">Add</button>
          </div>
        </div>

        <!-- ASK DESK ASSISTANT DOCK -->
        <div class="desk-command-dock" style="margin-top:16px">
          <div class="command-dock-field">
            <span style="color:var(--accent);opacity:0.8;font-size:0.8rem">✨</span>
            <input type="text" id="assistant-input" enterkeyhint="send" placeholder="Ask Desk… e.g. 'Classes today?' or 'Safe to miss OS?'" onkeypress="if(event.key==='Enter') handleAssistantQuestion()">
            <span class="command-dock-kbd">Ask</span>
          </div>
        </div>
        <div id="assistant-answer-container"></div>
      </div>

      <!-- RIGHT COLUMN: AMBIENT CONTEXT -->
      <div class="dashboard-right-panel">

        <!-- ATTENDANCE: Redesigned ambient right panel -->
        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-title">Attendance</div>
            <button class="panel-action" onclick="navigateTo('review')">Guidance →</button>
          </div>
          <div>
            <div class="att-stat-figure ${isAttendanceAtRisk ? 'at-risk' : attendancePct !== null ? 'is-safe' : ''}" style="margin-bottom:2px">
              ${attendancePct !== null ? `${attendancePct}%` : '—'}
            </div>
            <div class="att-stat-label">${attendancePct !== null ? (dashGuidance.isSafe ? `Safe · ≥${attTarget}%` : `Needs attention · <${attTarget}%`) : 'Not configured'}</div>
            ${attendancePct !== null ? `
              <div style="margin-top:10px">
                <div class="att-bar-wrap">
                  <div class="att-bar-seg att-seg-present" style="width:${totalMarked > 0 ? Math.round((totalAttended/totalMarked)*100) : 0}%"></div>
                  <div class="att-bar-seg att-seg-absent" style="width:${totalMarked > 0 ? Math.round((totalSkipped/totalMarked)*100) : 0}%"></div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:5px;font-family:var(--font-mono);font-size:0.67rem;color:var(--text-muted)">
                  <span>${totalAttended} present</span>
                  <span>${totalSkipped} missed</span>
                </div>
              </div>
              ${!dashGuidance.isSafe ? `
              <div style="margin-top:10px;font-size:0.77rem;color:var(--text-secondary);line-height:1.5;padding:8px 10px;background:color-mix(in srgb, var(--red) 5%, var(--surface-2));border-radius:var(--radius-sm);border-left:2px solid var(--red)">
                ${dashGuidance.message}
              </div>` : `<div class="att-stat-message" style="margin-top:8px">${dashGuidance.message}</div>`}
            ` : `<div class="att-stat-message" style="margin-top:8px">${dashGuidance.message}</div>`}
          </div>
        </div>

        <!-- LATEST NOTICE -->
        ${latestNotice ? `
          <div class="dashboard-panel">
            <div class="panel-header">
              <div class="panel-title">Notice Board</div>
              <button class="panel-action" onclick="navigateTo('notices')">All Notices →</button>
            </div>
            <div class="card card-sm notice-card ${latestNotice.important ? 'important' : ''}" onclick="navigateTo('notices')" style="padding:12px 14px;cursor:pointer">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
                <div style="font-weight:700;font-size:0.86rem;color:var(--text-primary)">${latestNotice.title}</div>
                <span class="cat-badge cat-${latestNotice.category}" style="font-size:0.65rem">${latestNotice.category}</span>
              </div>
              <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:4px;line-height:1.4">
                ${latestNotice.content.length > 95 ? latestNotice.content.slice(0, 92) + '…' : latestNotice.content}
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px;display:flex;align-items:center;justify-content:space-between">
                <span>${formatDate(latestNotice.date)}</span>
                <span style="color:var(--accent);font-weight:600">Read Notice →</span>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- STUDY SHORTCUTS -->
        ${quickLinksPreview.length > 0 ? `
          <div class="dashboard-panel">
            <div class="panel-header">
              <div class="panel-title">Study Shortcuts</div>
              <button class="panel-action" onclick="navigateTo('links')">Vault →</button>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${quickLinksPreview.map(s => `
                <div class="filter-chip" style="font-size:0.74rem;padding:3px 10px;cursor:pointer;display:flex;align-items:center;gap:6px" onclick="openSubjectHub('${s.subject}')" title="Open ${s.subject} Subject Hub">
                  <span style="width:6px;height:6px;border-radius:50%;background:${s.color || 'var(--accent)'}"></span>
                  <span>${s.subject}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

      </div>
    </div>
  `;
}

// ── Timetable ─────────────────────────────────────────────────
function renderTimetable() {
  const el         = document.getElementById('page-timetable');
  const today      = new Date().getDay();
  const day        = state.ttDay;
  const liveTT     = loadTimetable();
  const classes    = liveTT[day] || [];
  const currentMin = currentTimeMinutes();
  const isCustom   = isCustomTimetableActive();
  const attendanceData = safeGetStorage(KEY_ATTENDANCE, {}) || {};
  const weekDays   = getWeekDays(0);
  const targetDayObj = weekDays.find(d => d.getDay() === day) || new Date();
  const dateStr    = targetDayObj.toISOString().split('T')[0];

  const tabs = [1,2,3,4,5,6,0].map(d => `
    <button class="tt-tab ${d===day?'active':''}" onclick="setTTDay(${d})">${DAY_SHORT[d]}${d===today?' ·':''}</button>
  `).join('');

  let content = '';
  if (!classes.length) {
    content = `
      <div class="empty-state-card" style="margin-top:8px">
        <span class="empty-state-icon">🏖️</span>
        <div class="empty-state-title">No Classes on ${DAY_NAMES[day]}</div>
        <div class="empty-state-desc">No classes scheduled for this day. You can add class slots manually, scan your class timetable photo, or load a sample template.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:6px">
          <button class="btn-primary" onclick="showTimetableEntryModal(${day}, null)" style="font-size:0.82rem;padding:6px 14px">+ Add Class Entry</button>
          <button class="btn-secondary" onclick="triggerTimetableImport()" style="font-size:0.82rem;padding:6px 14px">📷 Scan Photo</button>
          <button class="btn-secondary" onclick="loadOfficialAidsTimetable()" style="font-size:0.82rem;padding:6px 14px">📋 Load Sample Template</button>
        </div>
      </div>`;
  } else {
    content = classes.map((c, idx) => {
      const startMin  = timeToMinutes(c.time || '10:00');
      const endMin    = timeToMinutes(c.end || '11:00');
      const isCurrent = day === today && currentMin >= startMin && currentMin < endMin;
      const isPast    = day === today && currentMin >= endMin;
      const isTeaching = isTeachingClass(c);
      const classKey  = isTeaching ? `${c.code || c.subject}_${c.time}`.replace(/[^a-zA-Z0-9_]/g, '') : null;
      const status    = isTeaching ? (attendanceData[dateStr]?.[classKey] || 'unset') : 'unset';

      const isAttended = status === 'attended';
      const isSkipped  = status === 'skipped';

      const attendanceControlsHTML = isTeaching ? `
        <div style="display:flex;align-items:center;gap:4px;margin-right:2px">
          <button class="btn btn-sm ${isAttended ? 'btn-primary' : 'btn-secondary'}"
                  onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'attended')"
                  title="Mark ${c.subject} Attended" aria-label="Mark ${c.subject} as attended" aria-pressed="${isAttended}"
                  style="padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:6px;min-width:32px;height:28px;
                         ${isAttended ? 'background:var(--green);border-color:var(--green);color:#ffffff;' : ''}">
            ✓
          </button>
          <button class="btn btn-sm ${isSkipped ? 'btn-primary' : 'btn-secondary'}"
                  onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'skipped')"
                  title="Mark ${c.subject} as skipped" aria-label="Mark ${c.subject} as skipped" aria-pressed="${isSkipped}"
                  style="padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:6px;min-width:32px;height:28px;
                         ${isSkipped ? 'background:var(--red);border-color:var(--red);color:#ffffff;' : ''}">
            ✕
          </button>
        </div>` : '';

      return `
        <div class="tt-entry ${isCurrent ? 'current' : ''} ${isPast ? 'past' : ''}">
          <div class="tt-time-col">
            <div class="tt-time-start">${c.time}</div>
            <div class="tt-time-end">${c.end || ''}</div>
          </div>
          <div class="tt-divider"></div>
          <div class="tt-info">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div class="tt-subject" onclick="openSubjectHub('${c.subject}')" style="cursor:pointer;font-weight:700" title="Open ${c.subject} Hub">
                ${c.subject} ${c.code ? '· ' + c.code : ''}
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="type-badge type-${c.type || 'lecture'}">${c.type || 'lecture'}</span>
                <button class="btn btn-xs btn-secondary" onclick="openSubjectHub('${c.subject}')" style="font-size:0.7rem;padding:2px 6px">Hub →</button>
              </div>
            </div>
            <div class="tt-meta">
              ${c.room ? `Room: <strong>${c.room}</strong>` : ''}
              ${c.teacher ? ` · Prof. <strong>${c.teacher}</strong>` : ''}
              ${c.notes ? ` · <span style="font-style:italic">${c.notes}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${attendanceControlsHTML}
            <button class="icon-btn-sm" onclick="showTimetableEntryModal(${day}, ${idx})" title="Edit class" aria-label="Edit class">✏️</button>
          </div>
        </div>
      `;
    }).join('');
  }

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Timetable &amp; Schedule</div>
        <div class="page-subtitle">${classes.length} class${classes.length!==1?'es':''} on ${DAY_NAMES[day]} ${isCustom ? '· Custom Schedule' : '· Regular Schedule'}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-primary" onclick="showTimetableEntryModal(${day}, null)" style="display:flex;align-items:center;gap:6px;font-size:0.8rem;padding:7px 14px">
          ${icons.plus()} Add Class
        </button>
        <button class="btn-secondary" onclick="triggerTimetableImport()" style="display:flex;align-items:center;gap:6px;font-size:0.8rem;padding:7px 14px">
          📷 Scan Timetable
        </button>
        <button class="btn-secondary" onclick="showDeclutterDeskModal()" style="display:flex;align-items:center;gap:6px;font-size:0.8rem;padding:7px 14px" title="Declutter duplicate or other-batch sessions">
          🧹 Declutter Schedule
        </button>
        <button class="btn-secondary" onclick="loadOfficialAidsTimetable()" style="display:flex;align-items:center;gap:6px;font-size:0.8rem;padding:7px 14px" title="Load sample schedule template">
          📋 Sample Schedule
        </button>
        ${isCustom ? `
          <button class="btn-secondary" onclick="resetTimetableToDefault()" style="font-size:0.8rem;padding:7px 12px;color:var(--text-muted)">
            Clear Schedule
          </button>` : ''}
      </div>
    </div>
    <div class="tt-day-tabs">${tabs}</div>
    ${content}
    ${day===today&&classes.length?'<div class="text-xs text-muted" style="margin-top:12px;text-align:center">Highlighted = current session · Faded = completed · Tap subject to open notes &amp; syllabus</div>':''}
  `;
}

// ── Subject Hub System ─────────────────────────────────────────
window.openSubjectHub = function(subjName) {
  if (!subjName) return;
  const current = state.currentPage;
  if (current === 'subjects' && !state.activeSubject) {
    sectionHistory.push('subjects_overview');
  } else if (current && current !== 'subjects') {
    if (sectionHistory.length === 0 || sectionHistory[sectionHistory.length - 1] !== current) {
      sectionHistory.push(current);
    }
  }
  state.activeSubject = subjName;
  navigate('subjects', false, true);
};

window.closeSubjectHub = function() {
  state.activeSubject = null;
  if (sectionHistory.length > 0 && sectionHistory[sectionHistory.length - 1] === 'subjects_overview') {
    sectionHistory.pop();
  }
  if (state.currentPage === 'subjects') {
    updateBackButtonUI();
    renderSubjects();
  } else {
    navigateTo('subjects');
  }
};

function getSubjectList() {
  const map = new Map();
  const liveTT = loadTimetable();

  const getOrCreateSubject = (rawName, rawCode, classType, teacher = '', room = '', color = 'var(--accent)') => {
    if (!rawName || typeof rawName !== 'string') return null;
    const cleanRaw = rawName.trim();
    if (!cleanRaw || /^(off|lunch|break|holiday|recess|free)$/i.test(cleanRaw)) return null;

    const norm = normalizeSubjectIdentity(cleanRaw, [], classType);
    const isLab = classType === 'lab' || norm.isLab;
    const finalName = norm.canonicalName || cleanRaw;
    const finalCode = norm.canonicalCode || rawCode || finalName;

    // Distinguish theory from lab canonical identity cleanly
    const key = `${finalName.toLowerCase()}|||${isLab ? 'lab' : 'theory'}`;
    if (!map.has(key)) {
      map.set(key, {
        name: finalName,
        code: finalCode,
        type: isLab ? 'lab' : (classType || norm.classType || 'lecture'),
        teacher: teacher || norm.teacher || '',
        room: room || norm.room || '',
        color: color || 'var(--accent)',
        slots: []
      });
    }
    const item = map.get(key);
    if (!item.teacher && (teacher || norm.teacher)) item.teacher = teacher || norm.teacher;
    if (!item.room && (room || norm.room)) item.room = room || norm.room;
    if (!item.code && finalCode) item.code = finalCode;
    return item;
  };

  // 1. Collect from Timetable
  [1, 2, 3, 4, 5, 6, 0].forEach(d => {
    (liveTT[d] || []).forEach(c => {
      if (isTeachingClass(c) && c.subject) {
        const item = getOrCreateSubject(c.subject, c.code, c.type, c.teacher, c.room, c.color);
        if (item) {
          item.slots.push({
            day: d,
            time: c.time,
            end: c.end,
            room: c.room || item.room,
            teacher: c.teacher || item.teacher,
            code: c.code || item.code
          });
        }
      }
    });
  });

  // 2. Collect from Tasks
  allTasks().forEach(t => {
    if (t.subject && t.subject.trim()) {
      getOrCreateSubject(t.subject, t.subject, 'lecture');
    }
  });

  // 3. Collect from Quick Links
  loadCustomLinks().forEach(l => {
    if (l.subject && l.subject.trim()) {
      getOrCreateSubject(l.subject, l.subject, 'lecture', '', '', l.color);
    }
  });

  // 4. Collect from Attendance Baselines (KEY_ATTENDANCE_BASELINE)
  const baselines = loadAttendanceBaselines();
  Object.entries(baselines || {}).forEach(([k, b]) => {
    if (b && typeof b === 'object') {
      const name = (b.subjectName || k || '').trim();
      const code = (b.subjectCode || '').trim();
      if (name) {
        getOrCreateSubject(name, code, b.classType || (b.isLab ? 'lab' : 'lecture'));
      }
    } else if (k && typeof k === 'string' && k.trim()) {
      getOrCreateSubject(k.trim(), '', 'lecture');
    }
  });

  return Array.from(map.values());
}

// ── Manual Baseline & Live Attendance System ─────────────────────

function loadAttendanceBaselines() {
  return safeGetStorage(KEY_ATTENDANCE_BASELINE, {}) || {};
}

function saveAttendanceBaselines(baselines) {
  safeSetStorage(KEY_ATTENDANCE_BASELINE, baselines);
  syncToCloud();
}

function loadLiveAttendanceActions() {
  return safeGetStorage(KEY_ATTENDANCE_LIVE, {}) || {};
}

function saveLiveAttendanceActions(actions) {
  safeSetStorage(KEY_ATTENDANCE_LIVE, actions);
  syncToCloud();
}

function getSubjectBaseline(subjItem) {
  const baselines = loadAttendanceBaselines();
  if (!subjItem) {
    return { present: 0, absent: 0, leave: 0, notEntered: 0, totalSessions: 0, totalCount: 0, hasBaseline: false };
  }

  const codeKey = (subjItem.code || '').trim();
  const nameKey = (subjItem.name || '').trim();
  const cleanCode = codeKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanName = nameKey.toLowerCase().replace(/[^a-z0-9]/g, '');

  let match = null;
  if (codeKey && baselines[codeKey]) match = baselines[codeKey];
  else if (nameKey && baselines[nameKey]) match = baselines[nameKey];
  else {
    for (const [k, v] of Object.entries(baselines)) {
      if (!v || typeof v !== 'object') continue;
      const vCode = (v.subjectCode || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const vName = (v.subjectName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if ((cleanCode && (cleanK === cleanCode || vCode === cleanCode)) ||
          (cleanName && (cleanK === cleanName || vName === cleanName))) {
        match = v;
        break;
      }
    }
  }

  if (!match || typeof match !== 'object') {
    return { present: 0, absent: 0, leave: 0, notEntered: 0, totalSessions: 0, totalCount: 0, hasBaseline: false };
  }

  const present = Math.max(0, parseInt(match.present) || 0);
  const absent = Math.max(0, parseInt(match.absent) || 0);
  const leave = Math.max(0, parseInt(match.leave) || 0);
  const notEntered = Math.max(0, parseInt(match.notEntered) || 0);
  const totalSessions = Math.max(0, parseInt(match.totalSessions) || 0);
  const totalCount = present + absent + leave + notEntered;

  return {
    present,
    absent,
    leave,
    notEntered,
    totalSessions,
    totalCount,
    hasBaseline: totalCount > 0 || totalSessions > 0 || (match.present !== undefined && match.present !== '')
  };
}

function getSubjectLiveActions(subjItem) {
  const liveActions = loadLiveAttendanceActions();
  if (!subjItem) return { present: 0, missed: 0, leave: 0 };

  const codeKey = (subjItem.code || '').trim();
  const nameKey = (subjItem.name || '').trim();
  const cleanCode = codeKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanName = nameKey.toLowerCase().replace(/[^a-z0-9]/g, '');

  let match = null;
  if (codeKey && liveActions[codeKey]) match = liveActions[codeKey];
  else if (nameKey && liveActions[nameKey]) match = liveActions[nameKey];
  else {
    for (const [k, v] of Object.entries(liveActions)) {
      const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if ((cleanCode && cleanK === cleanCode) || (cleanName && cleanK === cleanName)) {
        match = v;
        break;
      }
    }
  }

  if (!match || typeof match !== 'object') {
    return { present: 0, missed: 0, leave: 0 };
  }

  return {
    present: Math.max(0, parseInt(match.present) || 0),
    missed: Math.max(0, parseInt(match.missed) || 0),
    leave: Math.max(0, parseInt(match.leave) || 0),
  };
}

function logSubjectAttendanceAction(subjectKey, action) {
  const subjects = getSubjectList();
  const subj = subjects.find(s => (s.code || s.name) === subjectKey || s.name.toLowerCase() === subjectKey.toLowerCase()) || { name: subjectKey, code: subjectKey };
  const storageKey = (subj.code || subj.name).trim();

  const liveActions = loadLiveAttendanceActions();
  if (!liveActions[storageKey]) {
    liveActions[storageKey] = { present: 0, missed: 0, leave: 0 };
  }

  if (action === 'present') {
    liveActions[storageKey].present = (liveActions[storageKey].present || 0) + 1;
    showToast(`Logged Present (+1) for ${subj.name} ✓`, 'success');
  } else if (action === 'missed') {
    liveActions[storageKey].missed = (liveActions[storageKey].missed || 0) + 1;
    showToast(`Logged Missed (+1) for ${subj.name}`, 'info');
  } else if (action === 'leave') {
    liveActions[storageKey].leave = (liveActions[storageKey].leave || 0) + 1;
    showToast(`Logged Leave (+1) for ${subj.name}`, 'info');
  }

  saveLiveAttendanceActions(liveActions);
  renderPage(state.currentPage);
}

function undoSubjectAttendanceAction(subjectKey) {
  const subjects = getSubjectList();
  const subj = subjects.find(s => (s.code || s.name) === subjectKey || s.name.toLowerCase() === subjectKey.toLowerCase()) || { name: subjectKey, code: subjectKey };
  const storageKey = (subj.code || subj.name).trim();

  const liveActions = loadLiveAttendanceActions();
  if (!liveActions[storageKey]) return;

  delete liveActions[storageKey];
  saveLiveAttendanceActions(liveActions);
  showToast(`Reset live attendance adjustments for ${subj.name}`, 'info');
  renderPage(state.currentPage);
}

function getSubjectAttendance(subjItem) {
  const attendanceData = safeGetStorage(KEY_ATTENDANCE, {}) || {};
  let dailyAttended = 0;
  let dailySkipped = 0;

  const targetCode = (subjItem.code || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
  const targetName = (subjItem.name || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '');

  Object.values(attendanceData).forEach(dayObj => {
    if (dayObj && typeof dayObj === 'object') {
      Object.entries(dayObj).forEach(([key, status]) => {
        const cleanKey = key.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '');
        const matchesCode = targetCode && cleanKey.startsWith(targetCode + '_');
        const matchesName = targetName && cleanKey.startsWith(targetName + '_');
        if (matchesCode || matchesName) {
          if (status === 'attended') dailyAttended++;
          else if (status === 'skipped') dailySkipped++;
        }
      });
    }
  });

  const baseline = getSubjectBaseline(subjItem);
  const liveAdj = getSubjectLiveActions(subjItem);

  const present = baseline.present + dailyAttended + liveAdj.present;
  const absent = baseline.absent + dailySkipped + liveAdj.missed;
  const leave = baseline.leave + liveAdj.leave;
  const notEntered = baseline.notEntered;

  const attended = present;
  const skipped = absent + leave + notEntered;
  const total = present + absent + leave + notEntered;

  const pct = total > 0 ? Math.round((present / total) * 100) : null;
  const exactPct = total > 0 ? parseFloat(((present / total) * 100).toFixed(2)) : null;

  const targetPct = getAttendanceTarget();
  const targetFrac = targetPct / 100;
  const isSafe = pct !== null ? pct >= targetPct : null;
  const statusLine = pct === null ? 'Attendance not set yet' : isSafe ? 'Safe Zone' : 'Needs Recovery';

  let insightMessage = '';
  let safeSkips = 0;
  let classesToAttend = 0;

  if (pct !== null) {
    if (isSafe) {
      safeSkips = Math.max(0, Math.floor((present - targetFrac * total) / targetFrac));
      insightMessage = safeSkips > 0
        ? `Can safely miss ${safeSkips} class${safeSkips !== 1 ? 'es' : ''} · Target: ${targetPct}%`
        : `On target at ${pct}% · Attend next class to build buffer`;
    } else {
      const denom = Math.max(0.01, 1 - targetFrac);
      classesToAttend = Math.max(1, Math.ceil((targetFrac * total - present) / denom));
      insightMessage = `Need to attend ${classesToAttend} class${classesToAttend !== 1 ? 'es' : ''} continuously to reach ${targetPct}%`;
    }
  }

  return {
    present,
    absent,
    leave,
    notEntered,
    attended,
    skipped,
    total,
    pct,
    exactPct,
    isSafe,
    statusLine,
    insightMessage,
    safeSkips,
    classesToAttend,
    targetPct,
    baseline,
    liveAdj,
    dailyAttended,
    dailySkipped,
    hasBaseline: baseline.hasBaseline,
    hasAnyData: baseline.hasBaseline || (dailyAttended + dailySkipped + liveAdj.present + liveAdj.missed + liveAdj.leave) > 0
  };
}

function getOverallAttendance() {
  const subjects = getSubjectList();
  let totalAttended = 0;
  let totalCount = 0;
  let hasAnyData = false;

  subjects.forEach(s => {
    const att = getSubjectAttendance(s);
    if (att.total > 0) {
      totalAttended += att.attended;
      totalCount += att.total;
      hasAnyData = true;
    }
  });

  const pct = totalCount > 0 ? Math.round((totalAttended / totalCount) * 100) : null;
  const exactPct = totalCount > 0 ? parseFloat(((totalAttended / totalCount) * 100).toFixed(2)) : null;
  const totalSkipped = totalCount - totalAttended;

  return {
    attended: totalAttended,
    skipped: totalSkipped,
    total: totalCount,
    pct,
    exactPct,
    hasAnyData
  };
}

function showBaselineModal(preselectedSubject = null, initialTab = 'manual') {
  const subjects = getSubjectList();
  const existingBackdrop = document.getElementById('baseline-modal-backdrop');
  if (existingBackdrop) existingBackdrop.remove();

  let activeSubj = subjects.length > 0 ? subjects[0] : null;
  if (preselectedSubject && subjects.length > 0) {
    const found = subjects.find(s =>
      (s.code && s.code.toLowerCase() === preselectedSubject.toLowerCase()) ||
      (s.name && s.name.toLowerCase() === preselectedSubject.toLowerCase())
    );
    if (found) activeSubj = found;
  }

  let optionsHTML = '';
  if (subjects.length > 0) {
    optionsHTML = subjects.map(s => {
      const isSel = activeSubj && (s.code === activeSubj.code || s.name === activeSubj.name);
      return `<option value="${s.code || s.name}" ${isSel ? 'selected' : ''}>${s.name} (${s.code || 'No Code'})</option>`;
    }).join('') + `<option value="__new__">+ Add New Subject…</option>`;
  }

  const baseline = activeSubj ? getSubjectBaseline(activeSubj) : { present: 0, absent: 0, leave: 0, notEntered: 0, totalSessions: 0, totalCount: 0, hasBaseline: false };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'baseline-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal baseline-dialog" onclick="event.stopPropagation()" style="max-width:540px;padding:24px 22px">
      <div class="modal-header" style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
        <div>
          <h2 class="modal-title" style="margin:0;font-size:1.22rem;font-weight:700">Set your current attendance</h2>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px">Add your present and absent counts once. Clarity Desk will continue from there.</div>
        </div>
        <button class="modal-close" onclick="document.getElementById('baseline-modal-backdrop')?.remove()">${icons.x()}</button>
      </div>

      <!-- Mode Selector Tabs: Set Manually | Scan from Photo -->
      <div style="display:flex;gap:8px;background:var(--surface-2);padding:4px;border-radius:8px;margin-bottom:16px">
        <button type="button" id="ab-tab-manual-btn" class="btn btn-sm ${initialTab==='manual'?'btn-primary':'btn-secondary'}" onclick="switchBaselineModalTab('manual')" style="flex:1;font-size:0.8rem;padding:6px 12px;border:none">
          ✍️ Set Manually
        </button>
        <button type="button" id="ab-tab-scan-btn" class="btn btn-sm ${initialTab==='scan'?'btn-primary':'btn-secondary'}" onclick="switchBaselineModalTab('scan')" style="flex:1;font-size:0.8rem;padding:6px 12px;border:none">
          📷 Scan from Photo
        </button>
      </div>

      <!-- TAB 1: MANUAL SETUP FORM -->
      <div id="ab-manual-section" style="${initialTab==='manual'?'display:block':'display:none'}">
        <div style="background:var(--surface-2);border-left:3px solid var(--accent);border-radius:6px;padding:9px 12px;margin-bottom:14px;font-size:0.79rem;color:var(--text-secondary);line-height:1.45">
          💡 Set your current attendance to calculate from the right starting point. Future attendance actions update automatically from this baseline.
        </div>

        <div class="form-group" style="margin-bottom:14px">
          <label class="form-label" style="font-weight:600">Subject</label>
          ${subjects.length > 0 ? `
            <select id="ab-subject-select" class="form-select" onchange="onBaselineSubjectChange(this.value)">
              ${optionsHTML}
            </select>
            <div id="ab-new-subject-fields" style="display:none;grid-template-columns:1.5fr 1fr;gap:10px;margin-top:8px">
              <input type="text" id="ab-new-subject-name" class="form-input" placeholder="Subject Name * (e.g. Operating Systems)" oninput="updateBaselinePreview()">
              <input type="text" id="ab-new-subject-code" class="form-input" placeholder="Code (e.g. CS302)" oninput="updateBaselinePreview()">
            </div>
          ` : `
            <div id="ab-new-subject-fields" style="display:grid;grid-template-columns:1.5fr 1fr;gap:10px">
              <input type="text" id="ab-new-subject-name" class="form-input" placeholder="Subject Name * (e.g. Operating Systems)" oninput="updateBaselinePreview()">
              <input type="text" id="ab-new-subject-code" class="form-input" placeholder="Code (e.g. CS302)" oninput="updateBaselinePreview()">
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">
              No subjects set up yet. Enter your subject name and counts below to begin.
            </div>
          `}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label" style="display:flex;align-items:center;gap:6px">
              <span style="color:var(--green)">●</span> Present Count <span style="color:var(--red)">*</span>
            </label>
            <input type="number" id="ab-present" min="0" class="form-input" value="${baseline.hasBaseline ? baseline.present : ''}" placeholder="e.g. 9" oninput="updateBaselinePreview()">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label" style="display:flex;align-items:center;gap:6px">
              <span style="color:var(--red)">●</span> Absent Count <span style="color:var(--red)">*</span>
            </label>
            <input type="number" id="ab-absent" min="0" class="form-input" value="${baseline.hasBaseline ? baseline.absent : ''}" placeholder="e.g. 8" oninput="updateBaselinePreview()">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label" style="display:flex;align-items:center;gap:6px">
              <span style="color:var(--yellow)">●</span> Leave Count <span style="color:var(--text-muted);font-weight:normal">(optional)</span>
            </label>
            <input type="number" id="ab-leave" min="0" class="form-input" value="${baseline.hasBaseline ? baseline.leave : ''}" placeholder="0" oninput="updateBaselinePreview()">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label" style="display:flex;align-items:center;gap:6px">
              <span style="color:var(--text-muted)">●</span> Attendance Not Entered <span style="color:var(--text-muted);font-weight:normal">(optional)</span>
            </label>
            <input type="number" id="ab-not-entered" min="0" class="form-input" value="${baseline.hasBaseline ? baseline.notEntered : ''}" placeholder="0" oninput="updateBaselinePreview()">
          </div>
        </div>

        <div class="form-group" style="margin-bottom:14px">
          <label class="form-label">Total Planned Sessions <span style="color:var(--text-muted);font-weight:normal">(semester total, e.g. 60 or 30)</span></label>
          <input type="number" id="ab-total-sessions" min="0" class="form-input" value="${baseline.hasBaseline && baseline.totalSessions ? baseline.totalSessions : ''}" placeholder="e.g. 60" oninput="updateBaselinePreview()">
        </div>

        <div id="ab-preview-card" style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:16px"></div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm btn-secondary" id="ab-clear-btn" onclick="clearSubjectBaseline()" style="color:var(--status-error);border-color:color-mix(in srgb, var(--status-error) 30%, transparent);font-size:0.82rem;${baseline.hasBaseline ? '' : 'display:none'}">
            Clear Baseline
          </button>
          <div style="display:flex;align-items:center;gap:10px;margin-left:auto">
            <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('baseline-modal-backdrop')?.remove()" style="font-size:0.84rem">Cancel</button>
            <button type="button" class="btn-primary" onclick="saveSubjectBaselineFromModal()" style="padding:8px 18px;font-size:0.85rem;font-weight:600">Save Baseline ✓</button>
          </div>
        </div>
      </div>

      <!-- TAB 2: SCAN FROM PHOTO DROPZONE -->
      <div id="ab-scan-section" style="${initialTab==='scan'?'display:block':'display:none'}">
        <input type="file" id="ab-scan-file-input" accept="image/*" style="display:none" onchange="handleAttendancePhotoUpload(event)">
        
        <div class="attendance-scan-zone" onclick="document.getElementById('ab-scan-file-input')?.click()">
          <div style="font-size:2.4rem;margin-bottom:8px">📷</div>
          <div style="font-weight:700;font-size:1rem;color:var(--text-primary);margin-bottom:4px">
            Upload your attendance screenshot and we’ll fill this in for you.
          </div>
          <div style="font-size:0.8rem;color:var(--text-secondary);max-width:380px;margin:0 auto 16px auto;line-height:1.4">
            Supports portal screenshots, PDF exports, and camera photos from MGM JUNO ERP, ERP portals, or Excel sheets.
          </div>
          <button type="button" class="btn-primary" style="font-size:0.84rem;padding:8px 18px;display:inline-flex;align-items:center;gap:6px">
            📁 Choose Photo / Screenshot
          </button>
        </div>

        <div style="margin-top:16px;background:var(--surface-2);border-radius:8px;padding:10px 14px;font-size:0.78rem;color:var(--text-muted);display:flex;align-items:center;gap:8px">
          <span>🔒</span>
          <span>Photos are scanned locally in your browser. You can review and adjust every subject count before saving.</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  updateBaselinePreview();
}

function switchBaselineModalTab(tab) {
  const manualSec = document.getElementById('ab-manual-section');
  const scanSec = document.getElementById('ab-scan-section');
  const manualBtn = document.getElementById('ab-tab-manual-btn');
  const scanBtn = document.getElementById('ab-tab-scan-btn');

  if (tab === 'manual') {
    if (manualSec) manualSec.style.display = 'block';
    if (scanSec) scanSec.style.display = 'none';
    if (manualBtn) { manualBtn.className = 'btn btn-sm btn-primary'; }
    if (scanBtn) { scanBtn.className = 'btn btn-sm btn-secondary'; }
  } else {
    if (manualSec) manualSec.style.display = 'none';
    if (scanSec) scanSec.style.display = 'block';
    if (manualBtn) { manualBtn.className = 'btn btn-sm btn-secondary'; }
    if (scanBtn) { scanBtn.className = 'btn btn-sm btn-primary'; }
  }
}

// ── Attendance Photo Scanning Engine ──────────────────────────

let _currentAttendanceScanId = 0;
let _isAttendanceScanCanceled = false;

function triggerAttendancePhotoScan() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = handleAttendancePhotoUpload;
  input.click();
}

function showAttendanceScanLoadingModal(message = 'Scanning attendance…') {
  const existing = document.getElementById('ab-scan-loading-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'ab-scan-loading-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:380px;text-align:center;padding:28px 24px">
      <div class="spinner" style="width:36px;height:36px;border-width:3px;margin:0 auto 16px auto"></div>
      <div id="ab-scan-loading-msg" style="font-weight:700;font-size:1rem;color:var(--text-primary);margin-bottom:6px">${message}</div>
      <div id="ab-scan-loading-sub" style="font-size:0.8rem;color:var(--text-muted);margin-bottom:18px">Extracting subject names and attendance counts from screenshot…</div>
      <button type="button" class="btn-secondary" onclick="cancelAttendancePhotoScan()" style="font-size:0.82rem;padding:6px 16px">
        Cancel Scan
      </button>
    </div>
  `;
  document.body.appendChild(backdrop);
}

function updateAttendanceScanLoadingMessage(msg) {
  const el = document.getElementById('ab-scan-loading-msg');
  if (el) el.textContent = msg;
}

function updateAttendanceScanLoadingProgress(pct) {
  const subEl = document.getElementById('ab-scan-loading-sub');
  if (subEl && pct > 0 && pct < 100) {
    subEl.textContent = `Recognizing table text with local OCR (${pct}%)…`;
  }
}

function hideAttendanceScanLoadingModal() {
  document.getElementById('ab-scan-loading-backdrop')?.remove();
}

function cancelAttendancePhotoScan() {
  _isAttendanceScanCanceled = true;
  _isOcrBusy = false;
  hideAttendanceScanLoadingModal();
  showToast('Scan canceled', 'info');
  showBaselineModal(null, 'manual');
}

function preprocessAttendanceImageForOCR(base64Data, mimeType) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      let width = img.width;
      let height = img.height;

      // 1. Upscale low-res screenshots for crisp digit recognition
      const TARGET_MIN_WIDTH = 1300;
      if (width < TARGET_MIN_WIDTH) {
        const scale = Math.min(2.0, TARGET_MIN_WIDTH / width);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      // Cap at reasonable max to keep memory low and local OCR responsive
      const MAX_DIM = 1800;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      // 2. Grayscale & contrast enhancement with dynamic range expansion
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      let minL = 255, maxL = 0;
      const grayValues = new Uint8ClampedArray(data.length / 4);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        grayValues[j] = gray;
        if (gray < minL) minL = gray;
        if (gray > maxL) maxL = gray;
      }

      const range = Math.max(1, maxL - minL);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const normalized = Math.min(255, Math.max(0, Math.round(((grayValues[j] - minL) / range) * 255)));
        // Soft S-curve boost to keep font edges anti-aliased while whitening light backgrounds
        const boosted = normalized < 130 
          ? Math.round(Math.pow(normalized / 130, 1.35) * 115) 
          : Math.min(255, Math.round(115 + Math.pow((normalized - 130) / 125, 0.75) * 140));
        data[i] = boosted;
        data[i + 1] = boosted;
        data[i + 2] = boosted;
      }

      ctx.putImageData(imageData, 0, 0);

      // 3. Margin & noise trimming (remove outer borders / OS status bars)
      let top = 0, bottom = height - 1, left = 0, right = width - 1;
      const darkPixelThreshold = 100;

      for (let y = 0; y < height; y++) {
        let darks = 0;
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4] < darkPixelThreshold) darks++;
        }
        if (darks > width * 0.015) { top = y; break; }
      }

      for (let y = height - 1; y >= top; y--) {
        let darks = 0;
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4] < darkPixelThreshold) darks++;
        }
        if (darks > width * 0.015) { bottom = y; break; }
      }

      for (let x = 0; x < width; x++) {
        let darks = 0;
        for (let y = top; y <= bottom; y++) {
          if (data[(y * width + x) * 4] < darkPixelThreshold) darks++;
        }
        if (darks > (bottom - top) * 0.015) { left = x; break; }
      }

      for (let x = width - 1; x >= left; x--) {
        let darks = 0;
        for (let y = top; y <= bottom; y++) {
          if (data[(y * width + x) * 4] < darkPixelThreshold) darks++;
        }
        if (darks > (bottom - top) * 0.015) { right = x; break; }
      }

      const pad = 16;
      top = Math.max(0, top - pad);
      bottom = Math.min(height - 1, bottom + pad);
      left = Math.max(0, left - pad);
      right = Math.min(width - 1, right + pad);

      const trimW = Math.max(10, right - left + 1);
      const trimH = Math.max(10, bottom - top + 1);

      const trimmedCanvas = document.createElement('canvas');
      trimmedCanvas.width = trimW;
      trimmedCanvas.height = trimH;
      const trimmedCtx = trimmedCanvas.getContext('2d');
      trimmedCtx.drawImage(canvas, left, top, trimW, trimH, 0, 0, trimW, trimH);

      const resultDataUrl = trimmedCanvas.toDataURL(mimeType, 0.92);

      canvas.width = 1;
      canvas.height = 1;
      trimmedCanvas.width = 1;
      trimmedCanvas.height = 1;

      resolve(resultDataUrl);
    };
    img.onerror = () => reject(new Error('Failed to load image for attendance preprocessing'));
    img.src = `data:${mimeType};base64,${base64Data}`;
  });
}

async function handleAttendancePhotoUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (_isOcrBusy) {
    showToast('An OCR scan is already in progress. Please wait a moment.', 'info');
    return;
  }

  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file (PNG, JPG, WEBP, etc.)');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    alert('Image is too large (max 12 MB). Please compress or crop it first.');
    return;
  }

  _isOcrBusy = true;
  _isAttendanceScanCanceled = false;
  const currentScanId = ++_currentAttendanceScanId;

  showAttendanceScanLoadingModal('Scanning attendance…');

  const reader = new FileReader();
  reader.onload = async (e) => {
    let mimeType, base64Data;
    try {
      const resultUrl = e.target.result;
      mimeType = resultUrl.split(';')[0].split(':')[1] || 'image/jpeg';
      base64Data = resultUrl.split(',')[1];
    } catch {
      _isOcrBusy = false;
      hideAttendanceScanLoadingModal();
      showAttendanceScanErrorModal('Could not read image file. Please try another photo.');
      return;
    }

    try {
      if (_isAttendanceScanCanceled || currentScanId !== _currentAttendanceScanId) return;

      updateAttendanceScanLoadingMessage('Preprocessing image (contrast normalization, table crop)…');
      const preprocessedDataUrl = await preprocessAttendanceImageForOCR(base64Data, mimeType);

      if (_isAttendanceScanCanceled || currentScanId !== _currentAttendanceScanId) return;

      updateAttendanceScanLoadingMessage('Running local OCR in background worker…');
      const worker = await getTesseractWorker();
      const ocrResult = await worker.recognize(preprocessedDataUrl);

      if (_isAttendanceScanCanceled || currentScanId !== _currentAttendanceScanId) return;

      updateAttendanceScanLoadingMessage('Reconstructing table columns and mapping attendance counts…');
      const extractedRows = await extractAttendanceRowsFromOCR(ocrResult?.data, base64Data, mimeType);

      _isOcrBusy = false;
      hideAttendanceScanLoadingModal();
      document.getElementById('baseline-modal-backdrop')?.remove();

      if (_isAttendanceScanCanceled || currentScanId !== _currentAttendanceScanId) return;

      if (!extractedRows || extractedRows.length === 0) {
        showAttendanceScanErrorModal('We couldn’t read this screenshot clearly. You can still enter your counts manually.');
        return;
      }

      showAttendanceScanReviewModal(extractedRows);
    } catch (err) {
      _isOcrBusy = false;
      console.error('[AttendancePhotoScan] Scan error:', err);
      hideAttendanceScanLoadingModal();
      if (!_isAttendanceScanCanceled) {
        showAttendanceScanErrorModal('We couldn’t read this screenshot clearly. You can still enter your counts manually.');
      }
    }
  };
  reader.readAsDataURL(file);
}

async function extractAttendanceRowsFromOCR(ocrData, base64Data, mimeType) {
  const existingSubjects = getSubjectList();
  const rawOcrText = typeof ocrData === 'string' ? ocrData : (ocrData?.text || '');

  // 1. First attempt: High-Precision Local Geometric Table Reconstruction
  let geometricResult = [];
  if (ocrData && typeof ocrData === 'object' && Array.isArray(ocrData.words) && ocrData.words.length > 0) {
    try {
      geometricResult = reconstructAttendanceTableFromGrid(ocrData, existingSubjects);
      console.log(`[AttendanceGeometricOCR] Extracted ${geometricResult.length} rows via bounding-box geometry.`);
    } catch (geoErr) {
      console.warn('[AttendanceGeometricOCR] Geometric parse error, falling back to text regex:', geoErr);
    }
  }

  if (geometricResult.length > 0) {
    return geometricResult;
  }

  // 2. Second attempt: AI-Assisted Structured Extraction (if API key configured)
  const hasGroqKey = !!window.CAMPUS_OS_GROQ_KEY;
  const hasGeminiKey = !!window.CAMPUS_OS_GEMINI_KEY;

  if (hasGroqKey || hasGeminiKey) {
    const schemaInstruction = `Extract all course attendance records from this college ERP attendance report OCR text.
Return JSON with this exact structure:
{
  "rows": [
    {
      "subject": "Data Structures",
      "code": "AID21PCL202",
      "present": 10,
      "absent": 8,
      "leave": 0,
      "notEntered": 0,
      "totalSessions": 60,
      "isUncertain": false
    }
  ]
}
Rules:
1. Extract present count, absent count, leave count, and attendance not entered.
2. If subject name or numbers are slightly garbled by OCR, clean them up logically.
3. Validate total = present + absent + leave + notEntered.
4. If uncertain, set isUncertain: true.`;

    try {
      const aiResult = await AIService.generateContentFromText(rawOcrText, schemaInstruction);
      if (aiResult && Array.isArray(aiResult.rows) && aiResult.rows.length > 0) {
        return aiResult.rows.map(r => matchScannedRowToSubjects(r, existingSubjects));
      }
    } catch (aiErr) {
      console.warn('[AttendancePhotoScan] AI extraction fallback to deterministic parser:', aiErr);
    }
  }

  // 3. Third attempt: Deterministic Text Table Parser (100% offline fallback)
  const textRows = parseAttendanceFromText(rawOcrText, existingSubjects);
  return textRows.length > 0 ? textRows : geometricResult;
}

function reconstructAttendanceTableFromGrid(ocrData, existingSubjects = []) {
  if (!ocrData || !Array.isArray(ocrData.words) || ocrData.words.length === 0) {
    return [];
  }

  // 1. Sanitize OCR words and attach coordinate centers
  const words = ocrData.words.map(w => ({
    text: (w.text || '').trim(),
    bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
    conf: w.confidence || 0,
    cx: ((w.bbox?.x0 || 0) + (w.bbox?.x1 || 0)) / 2,
    cy: ((w.bbox?.y0 || 0) + (w.bbox?.y1 || 0)) / 2
  })).filter(w => w.text.length > 0);

  // 2. Group into visual rows based on Y vertical overlap
  words.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const visualRows = [];

  for (const word of words) {
    let added = false;
    for (const row of visualRows) {
      const avgY0 = row.reduce((sum, w) => sum + w.bbox.y0, 0) / row.length;
      const avgY1 = row.reduce((sum, w) => sum + w.bbox.y1, 0) / row.length;
      const wordH = word.bbox.y1 - word.bbox.y0;

      const overlap = Math.max(0, Math.min(word.bbox.y1, avgY1) - Math.max(word.bbox.y0, avgY0));
      if (wordH > 0 && (overlap / wordH) > 0.38) {
        row.push(word);
        added = true;
        break;
      }
    }
    if (!added) {
      visualRows.push([word]);
    }
  }

  // Sort words inside each row horizontally (left to right)
  visualRows.forEach(r => r.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  // 3. Identify header row and compute column boundary intervals
  const headerKeywords = ['course', 'subject', 'present', 'absent', 'leave', 'attended', 'total', 'percent', '%', 'entered', 'status', 'sessions', 'faculty', 'code', 'sr.'];
  let headerRowIndex = -1;
  let intervals = null;

  for (let i = 0; i < visualRows.length; i++) {
    const rowText = visualRows[i].map(w => w.text.toLowerCase()).join(' ');
    const matchCount = headerKeywords.filter(kw => rowText.includes(kw)).length;
    if (matchCount >= 3) {
      headerRowIndex = i;
      intervals = extractColumnIntervalsFromHeader(visualRows[i]);
      break;
    }
  }

  // 4. Parse candidate data rows
  const candidateRows = [];
  const startIdx = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;

  for (let i = startIdx; i < visualRows.length; i++) {
    const rowWords = visualRows[i];
    const fullRowText = rowWords.map(w => w.text).join(' ');

    // Check if this is a summary / footer row (e.g. Total, Overall, or all-numeric summary)
    const isSummaryRow = /^(total|overall|aggregate|grand\s*total)\b/i.test(fullRowText) ||
      (rowWords.length <= 7 && rowWords.every(w => /^\d+(\.\d+)?%?$/.test(w.text)));
    if (isSummaryRow) {
      continue;
    }

    let parsedRow = null;
    if (intervals && intervals.length >= 3) {
      parsedRow = parseRowWithIntervals(rowWords, intervals);
    }

    if (!parsedRow || !parsedRow.subject) {
      parsedRow = parseRowUsingMathematicalSolver(rowWords);
    }

    if (parsedRow && (parsedRow.subject || parsedRow.code)) {
      const matched = matchScannedRowToSubjects(parsedRow, existingSubjects);
      candidateRows.push(matched);
    }
  }

  // Deduplicate matched rows by subject code/name
  const seen = new Set();
  const deduped = [];
  for (const r of candidateRows) {
    const key = (r.code || r.subject).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  return deduped;
}

function extractColumnIntervalsFromHeader(headerWords) {
  const colKeywords = [
    { type: 'sr', match: /^(sr\.?\s*no\.?|s\.?\s*no\.?|serial\s*no\.?|sl\.?\s*no\.?|sr|sno)$/i },
    { type: 'code', match: /^(course\s*code|sub(ject)?\s*code|paper\s*code)$/i },
    { type: 'name', match: /^(course\s*name|sub(ject)?\s*name|course\s*title|sub(ject)?\s*title)$/i },
    { type: 'sessions', match: /^(total\s*sessions|total\s*lectures|total\s*hours|conducted|sessions|held)$/i },
    { type: 'faculty', match: /^(faculty\s*name|teacher\s*name|instructor|faculty|teacher)$/i },
    { type: 'present', match: /^(present\s*count|attended|present|att)$/i },
    { type: 'absent', match: /^(absent\s*count|missed|absent|abs)$/i },
    { type: 'leave', match: /^(leaves?\s*applied|leaves?|od|medical)$/i },
    { type: 'notEntered', match: /^(attendance\s*not\s*entered|not\s*entered|pending)$/i },
    { type: 'total', match: /^(total\s*count|total\s*marked)$/i },
    { type: 'percentage', match: /^(percentage|percent|att\.?\s*%|%)$/i },

    // Single-word fallbacks
    { type: 'code', match: /^code$/i },
    { type: 'name', match: /^(course|subject|title)$/i },
    { type: 'total', match: /^total$/i }
  ];

  const detected = [];
  let i = 0;
  while (i < headerWords.length) {
    let matchedType = null;
    let endIdx = i + 1;

    // Check longer phrases first
    for (let len = 3; len >= 1; len--) {
      if (i + len <= headerWords.length) {
        const phrase = headerWords.slice(i, i + len).map(w => w.text).join(' ').trim();
        const m = colKeywords.find(k => k.match.test(phrase));
        if (m && !detected.some(d => d.type === m.type)) {
          matchedType = m.type;
          endIdx = i + len;
          break;
        }
      }
    }

    if (matchedType) {
      const slice = headerWords.slice(i, endIdx);
      const x0 = Math.min(...slice.map(w => w.bbox.x0));
      const x1 = Math.max(...slice.map(w => w.bbox.x1));
      const cx = (x0 + x1) / 2;
      detected.push({ type: matchedType, x0, x1, cx });
      i = endIdx;
    } else {
      i++;
    }
  }

  detected.sort((a, b) => a.cx - b.cx);

  const intervals = [];
  for (let idx = 0; idx < detected.length; idx++) {
    const prev = detected[idx - 1];
    const curr = detected[idx];
    const next = detected[idx + 1];

    const minX = prev ? (prev.x1 + curr.x0) / 2 : 0;
    const maxX = next ? (curr.x1 + next.x0) / 2 : Infinity;

    intervals.push({
      type: curr.type,
      x0: curr.x0,
      x1: curr.x1,
      minX,
      maxX
    });
  }

  return intervals;
}

function parseColumnNumberToken(arr) {
  if (!arr || !arr.length) return 0;
  for (const token of arr) {
    if (!token) continue;
    let cleaned = String(token).trim()
      .replace(/[%₹$]/g, '')
      .replace(/(?<=\d)[OoQD](?=\d|$)/g, '0')
      .replace(/(?<=\d)[lI|i](?=\d|$)/g, '1')
      .replace(/^[OoQD@C]$/, '0')
      .replace(/^[lI|i!\]\[]$/, '1')
      .replace(/^[Zz?]$/, '2')
      .replace(/^[Ee]$/, '3')
      .replace(/^[Ah]$/, '4')
      .replace(/^[Ss$§]$/, '5')
      .replace(/^[Gb]$/, '6')
      .replace(/^[Tt/]$/, '7')
      .replace(/^[Bb&]$/, '8')
      .replace(/^[gq]$/, '9')
      .trim();

    const m = cleaned.match(/\b\d+(\.\d+)?\b/);
    if (m) {
      const n = parseFloat(m[0]);
      if (!isNaN(n) && n >= 0) return Math.round(n);
    }
  }
  return 0;
}

function solveAttendanceCounts(numTokens, pctToken = null) {
  const nums = (numTokens || []).filter(n => typeof n === 'number' && !isNaN(n) && n >= 0);
  if (nums.length < 2) return null;

  // 1. Sort candidate totals descending (college attendance rows have total as the largest count)
  const candidateIndices = [...nums.keys()].sort((a, b) => nums[b] - nums[a]);

  // Try 4-term balance first (P + A + L + N == Total)
  for (const tIdx of candidateIndices) {
    const candidateTotal = nums[tIdx];
    if (candidateTotal < 1) continue;

    for (let pIdx = 0; pIdx < nums.length; pIdx++) {
      if (pIdx === tIdx) continue;
      for (let aIdx = 0; aIdx < nums.length; aIdx++) {
        if (aIdx === tIdx || aIdx === pIdx) continue;
        for (let lIdx = 0; lIdx < nums.length; lIdx++) {
          if (lIdx === tIdx || lIdx === pIdx || lIdx === aIdx) continue;
          for (let nIdx = 0; nIdx < nums.length; nIdx++) {
            if (nIdx === tIdx || nIdx === pIdx || nIdx === aIdx || nIdx === lIdx) continue;

            const p = nums[pIdx];
            const a = nums[aIdx];
            const l = nums[lIdx];
            const n = nums[nIdx];

            if (p + a + l + n === candidateTotal) {
              if (pctToken) {
                const expectedPct = (p / candidateTotal) * 100;
                if (Math.abs(expectedPct - pctToken) < 1.8) {
                  return { present: Math.round(p), absent: Math.round(a), leave: Math.round(l), notEntered: Math.round(n), total: Math.round(candidateTotal), confidence: 98 };
                }
              }
              return { present: Math.round(p), absent: Math.round(a), leave: Math.round(l), notEntered: Math.round(n), total: Math.round(candidateTotal), confidence: 95 };
            }
          }
        }
      }
    }
  }

  // Try 3-term balance (P + A + L == Total)
  for (const tIdx of candidateIndices) {
    const candidateTotal = nums[tIdx];
    if (candidateTotal < 1) continue;

    for (let pIdx = 0; pIdx < nums.length; pIdx++) {
      if (pIdx === tIdx) continue;
      for (let aIdx = 0; aIdx < nums.length; aIdx++) {
        if (aIdx === tIdx || aIdx === pIdx) continue;
        for (let lIdx = 0; lIdx < nums.length; lIdx++) {
          if (lIdx === tIdx || lIdx === pIdx || lIdx === aIdx) continue;

          const p = nums[pIdx];
          const a = nums[aIdx];
          const l = nums[lIdx];

          if (p + a + l === candidateTotal) {
            if (pctToken) {
              const expectedPct = (p / candidateTotal) * 100;
              if (Math.abs(expectedPct - pctToken) < 1.8) {
                return { present: Math.round(p), absent: Math.round(a), leave: Math.round(l), notEntered: 0, total: Math.round(candidateTotal), confidence: 98 };
              }
            }
            return { present: Math.round(p), absent: Math.round(a), leave: Math.round(l), notEntered: 0, total: Math.round(candidateTotal), confidence: 92 };
          }
        }
      }
    }
  }

  // Try 2-term balance (P + A == Total)
  for (const tIdx of candidateIndices) {
    const candidateTotal = nums[tIdx];
    if (candidateTotal < 1) continue;

    for (let pIdx = 0; pIdx < nums.length; pIdx++) {
      if (pIdx === tIdx) continue;
      for (let aIdx = 0; aIdx < nums.length; aIdx++) {
        if (aIdx === tIdx || aIdx === pIdx) continue;

        const p = nums[pIdx];
        const a = nums[aIdx];

        if (p + a === candidateTotal) {
          if (pctToken) {
            const expectedPct = (p / candidateTotal) * 100;
            if (Math.abs(expectedPct - pctToken) < 1.8) {
              return { present: Math.round(p), absent: Math.round(a), leave: 0, notEntered: 0, total: Math.round(candidateTotal), confidence: 98 };
            }
          }
          return { present: Math.round(p), absent: Math.round(a), leave: 0, notEntered: 0, total: Math.round(candidateTotal), confidence: 90 };
        }
      }
    }
  }

  // 2. Intelligent offset extraction skipping serial numbers and 30/45/60/90 planned session counts
  let offset = 0;
  if (nums[0] >= 1 && nums[0] <= 30 && Number.isInteger(nums[0]) && nums.length >= 3) {
    offset = 1;
  }
  if (nums[offset] === 30 || nums[offset] === 45 || nums[offset] === 60 || nums[offset] === 90) {
    offset++;
  }

  const remaining = nums.slice(offset);
  if (remaining.length >= 2) {
    const present = Math.round(remaining[0]);
    const absent = Math.round(remaining[1]);
    const leave = remaining.length >= 3 ? Math.round(remaining[2]) : 0;
    const notEntered = remaining.length >= 4 ? Math.round(remaining[3]) : 0;
    return { present, absent, leave, notEntered, total: present + absent + leave + notEntered, confidence: 75 };
  }

  return { present: Math.round(nums[0]), absent: Math.round(nums[1]), leave: 0, notEntered: 0, total: Math.round(nums[0] + nums[1]), confidence: 60 };
}

function cleanSubjectString(s, existingSubjects = []) {
  if (!s || typeof s !== 'string') return { subject: 'General Subject', code: '' };

  let text = s.trim();
  // Strip leading serial numbers (e.g. "1.", "02", "1 -")
  text = text.replace(/^\d+[\s.\-–)]+/, '');
  // Strip room and teacher tokens first before numbers are stripped
  text = text.replace(/\b(?:prof\.|dr\.|mr\.|ms\.|mrs\.|lh\s*[-–]?\s*\d+|lab\s*[-–]?\s*\d+|room\s*[-–]?\s*\d+)\b/gi, ' ');
  // Strip standalone numeric tokens from subject text
  text = text.replace(/\b\d+(\.\d+)?%?\b/g, ' ');
  // Strip portal table headers & metadata tokens
  text = text.replace(/\b(?:semester|sem|lecture|sessions|total|present|absent|leave|entered|percentage|percent|att|count|marked|held|conducted)\b/gi, ' ');

  // Pass through canonical normalization layer
  const norm = normalizeSubjectIdentity(text, existingSubjects);
  return {
    subject: norm.canonicalName || 'General Subject',
    code: norm.canonicalCode || ''
  };
}

function parseRowWithIntervals(rowWords, intervals) {
  const buckets = {};
  intervals.forEach(inv => { buckets[inv.type] = []; });

  rowWords.forEach(w => {
    const cx = ((w.bbox?.x0 || 0) + (w.bbox?.x1 || 0)) / 2;
    const matched = intervals.find(inv => cx >= inv.minX && cx < inv.maxX);
    if (matched) {
      buckets[matched.type].push(w.text);
    }
  });

  const rawCode = (buckets.code || []).join('').trim();
  
  // Gather course name words from name bucket + any overflow text words in sessions before faculty column
  const nameWords = [...(buckets.name || [])];
  (buckets.sessions || []).forEach(w => {
    if (!/^\d+$/.test(w) && !/^(dr\.|mr\.|ms\.|mrs\.|prof\.)/i.test(w)) {
      nameWords.push(w);
    }
  });

  let rawName = nameWords.join(' ').trim();
  if (!rawName && rawCode) rawName = rawCode;

  const present = parseColumnNumberToken(buckets.present);
  const absent = parseColumnNumberToken(buckets.absent);
  const leave = parseColumnNumberToken(buckets.leave);
  const notEntered = parseColumnNumberToken(buckets.notEntered);
  const total = parseColumnNumberToken(buckets.total);
  const totalSessions = parseColumnNumberToken(buckets.sessions);

  const clean = cleanSubjectString(rawName);

  return {
    subject: clean.subject || rawCode || 'General Subject',
    code: clean.code || (rawCode && /^[A-Z0-9_-]+$/.test(rawCode) ? rawCode : ''),
    present,
    absent,
    leave,
    notEntered,
    totalSessions,
    isUncertain: !clean.subject || (present + absent === 0)
  };
}

function parseRowUsingMathematicalSolver(rowWords) {
  const textTokens = [];
  const numTokens = [];
  let pctVal = null;

  rowWords.forEach(w => {
    const cleaned = w.text.trim();
    const isPct = cleaned.includes('%');
    const numCandidate = cleaned
      .replace(/[%]/g, '')
      .replace(/^[OoQD]$/, '0')
      .replace(/^[lI|i]$/, '1')
      .replace(/^[Ss]$/, '5')
      .replace(/^[Bb]$/, '8');

    if (/^\d+(\.\d+)?$/.test(numCandidate)) {
      const val = parseFloat(numCandidate);
      if (isPct) pctVal = val;
      numTokens.push(val);
    } else if (cleaned.length > 0 && !/^[.\-/,:;]+$/.test(cleaned)) {
      textTokens.push(cleaned);
    }
  });

  if (numTokens.length < 2 || textTokens.length === 0) return null;

  const cleanTexts = textTokens.filter(t => !/^(dr\.|mr\.|ms\.|mrs\.|prof\.)/i.test(t));
  const rawSubjectStr = cleanTexts.join(' ');
  const clean = cleanSubjectString(rawSubjectStr);

  const solved = solveAttendanceCounts(numTokens, pctVal);
  if (!solved) return null;

  return {
    subject: clean.subject || clean.code || 'General Subject',
    code: clean.code || '',
    present: solved.present,
    absent: solved.absent,
    leave: solved.leave,
    notEntered: solved.notEntered,
    totalSessions: 0,
    isUncertain: solved.confidence < 75 || !clean.subject || (solved.present + solved.absent === 0)
  };
}

function parseAttendanceFromText(rawText, existingSubjects = []) {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^(sr\.?\s*no|course\s*code|course\s*name|total\s*sessions|present\s*count|overall|aggregate|grand\s*total)\b/i.test(line)) {
      continue;
    }

    const numTokens = [];
    let pctVal = null;
    const numRegex = /\b\d+(\.\d+)?%?\b/g;
    let match;
    while ((match = numRegex.exec(line)) !== null) {
      const isPct = match[0].includes('%');
      const cleaned = match[0].replace('%', '');
      const val = parseFloat(cleaned);
      if (!isNaN(val)) {
        if (isPct) pctVal = val;
        numTokens.push(val);
      }
    }

    if (numTokens.length < 2) continue;

    const clean = cleanSubjectString(line, existingSubjects);
    const solved = solveAttendanceCounts(numTokens, pctVal);
    if (!solved) continue;

    const rawRow = {
      subject: clean.subject || clean.code || 'General Subject',
      code: clean.code || '',
      present: solved.present,
      absent: solved.absent,
      leave: solved.leave,
      notEntered: solved.notEntered,
      totalSessions: 0,
      isUncertain: solved.confidence < 75 || !clean.subject || (solved.present + solved.absent === 0)
    };

    const matched = matchScannedRowToSubjects(rawRow, existingSubjects);
    rows.push(matched);
  }

  return rows;
}

function matchScannedRowToSubjects(rawRow, existingSubjects = []) {
  const rawName = (rawRow.subject || '').trim();
  const rawCode = (rawRow.code || '').trim();

  // 1. Run raw text through canonical normalizer
  const norm = normalizeSubjectIdentity(rawName, existingSubjects);
  const isLab = norm.isLab || /\blab\b/i.test(rawName) || rawCode.endsWith('-LAB');
  const targetName = norm.canonicalName || rawName;
  const targetCode = norm.canonicalCode || rawCode;

  const cleanTargetName = targetName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTargetCode = targetCode.toLowerCase().replace(/[^a-z0-9]/g, '');

  let bestMatch = null;

  // 2. Exact code match (preserving theory vs lab distinction)
  if (cleanTargetCode) {
    for (const s of existingSubjects) {
      const sCode = (s.code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const sIsLab = s.type === 'lab' || /\blab\b/i.test(s.name);
      if (sCode && cleanTargetCode === sCode && sIsLab === isLab) {
        bestMatch = s;
        break;
      }
    }
  }

  // 3. Exact name match (preserving theory vs lab distinction)
  if (!bestMatch && cleanTargetName) {
    for (const s of existingSubjects) {
      const sName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const sIsLab = s.type === 'lab' || /\blab\b/i.test(s.name);
      if (sName && cleanTargetName === sName && sIsLab === isLab) {
        bestMatch = s;
        break;
      }
    }
  }

  // 4. Substring name match (longest name match first)
  if (!bestMatch && cleanTargetName) {
    const sortedSubjects = [...existingSubjects].sort((a, b) => (b.name || '').length - (a.name || '').length);
    for (const s of sortedSubjects) {
      const sName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const sIsLab = s.type === 'lab' || /\blab\b/i.test(s.name);
      if (sName && sName.length >= 4 && sIsLab === isLab && (cleanTargetName.includes(sName) || sName.includes(cleanTargetName))) {
        bestMatch = s;
        break;
      }
    }
  }

  // 5. Word token code match
  if (!bestMatch && rawName) {
    const tokens = rawName.toUpperCase().split(/[^A-Z0-9_-]+/);
    for (const s of existingSubjects) {
      const sCodeUpper = (s.code || '').toUpperCase();
      const sIsLab = s.type === 'lab' || /\blab\b/i.test(s.name);
      if (sCodeUpper && sCodeUpper.length >= 2 && tokens.includes(sCodeUpper) && sIsLab === isLab) {
        bestMatch = s;
        break;
      }
    }
  }

  const finalSubject = bestMatch ? bestMatch.name : (targetName || 'General Subject');
  const finalCode = bestMatch ? bestMatch.code : targetCode;
  const isSubjectValid = finalSubject && finalSubject !== 'General Subject' && finalSubject.length >= 3;

  return {
    subject: finalSubject,
    code: finalCode,
    present: Math.max(0, parseInt(rawRow.present) || 0),
    absent: Math.max(0, parseInt(rawRow.absent) || 0),
    leave: Math.max(0, parseInt(rawRow.leave) || 0),
    notEntered: Math.max(0, parseInt(rawRow.notEntered) || 0),
    totalSessions: Math.max(0, parseInt(rawRow.totalSessions) || 0),
    isUncertain: !isSubjectValid || (rawRow.present + rawRow.absent === 0) || !!rawRow.isUncertain
  };
}

function showAttendanceScanReviewModal(rows = []) {
  const existingBackdrop = document.getElementById('ab-review-modal-backdrop');
  if (existingBackdrop) existingBackdrop.remove();

  const subjects = getSubjectList();
  const hasUncertain = rows.some(r => r.isUncertain);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'ab-review-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal attendance-review-dialog" onclick="event.stopPropagation()" style="max-width:680px;padding:24px 22px">
      <div class="modal-header" style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
        <div>
          <h2 class="modal-title" style="margin:0;font-size:1.24rem;font-weight:700">We found your subject counts. Review once before saving.</h2>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px">Check the scanned numbers below and make any quick corrections.</div>
        </div>
        <button class="modal-close" onclick="document.getElementById('ab-review-modal-backdrop')?.remove()">${icons.x()}</button>
      </div>

      ${hasUncertain ? `
        <div style="background:var(--surface-2);border-left:3px solid var(--yellow);border-radius:6px;padding:9px 12px;margin-bottom:14px;font-size:0.79rem;color:var(--text-secondary);display:flex;align-items:center;gap:8px">
          <span>⚠️</span>
          <span>Couldn’t match a few rows directly. You can select your subject or keep the detected name below.</span>
        </div>
      ` : ''}

      <div id="ab-review-rows-container" style="max-height:55vh;overflow-y:auto;padding-right:4px;margin-bottom:16px">
        ${renderReviewRowsHTML(rows, subjects)}
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--border)">
        <button type="button" class="btn-secondary" onclick="addScanReviewRow()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;padding:6px 12px">
          ${icons.plus()} Add Subject Row
        </button>
        <div style="display:flex;align-items:center;gap:10px;margin-left:auto">
          <button type="button" class="btn-secondary" onclick="document.getElementById('ab-review-modal-backdrop')?.remove(); showBaselineModal(null, 'manual');" style="font-size:0.84rem">
            ← Enter Manually
          </button>
          <button type="button" class="btn-primary" onclick="saveAllReviewedBaselines()" style="padding:8px 20px;font-size:0.86rem;font-weight:600">
            Save All Baselines ✓
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
}

function renderReviewRowsHTML(rows, subjects) {
  if (!rows.length) {
    return `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.84rem">No rows found. Tap + Add Subject Row to add one.</div>`;
  }

  const targetPct = getAttendanceTarget();

  return rows.map((r, idx) => {
    const total = (parseInt(r.present) || 0) + (parseInt(r.absent) || 0) + (parseInt(r.leave) || 0) + (parseInt(r.notEntered) || 0);
    const pct = total > 0 ? (((parseInt(r.present) || 0) / total) * 100).toFixed(1) : '0.0';
    const isSafe = parseFloat(pct) >= targetPct;

    const subjectOptionsHTML = subjects.map(s => {
      const isSel = (s.name.toLowerCase() === r.subject.toLowerCase() || (r.code && s.code && s.code.toLowerCase() === r.code.toLowerCase()));
      return `<option value="${s.name}|||${s.code || ''}" ${isSel ? 'selected' : ''}>${s.name} ${s.code ? `(${s.code})` : ''}</option>`;
    }).join('');

    const isExisting = subjects.some(s => s.name.toLowerCase() === r.subject.toLowerCase() || (r.code && s.code && s.code.toLowerCase() === r.code.toLowerCase()));

    return `
      <div class="attendance-review-row ${r.isUncertain ? 'uncertain' : ''}" id="review-row-${idx}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <label class="form-label" style="font-size:0.75rem;margin-bottom:3px">Subject</label>
            <select class="form-select review-subject-select" style="font-size:0.84rem;padding:5px 8px" onchange="onReviewRowInputChange(${idx})">
              ${subjectOptionsHTML}
              ${!isExisting ? `<option value="${r.subject}|||${r.code || ''}" selected>${r.subject} ${r.code ? `(${r.code})` : ''} (Detected)</option>` : ''}
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="type-badge" id="row-badge-${idx}" style="font-size:0.72rem;padding:3px 8px;background:${isSafe ? 'color-mix(in srgb, var(--status-success) 14%, transparent)' : 'color-mix(in srgb, var(--status-error) 14%, transparent)'};color:${isSafe ? 'var(--status-success)' : 'var(--status-error)'}">
              ${total > 0 ? `${pct}% · ${isSafe ? 'Safe Zone' : 'Needs Recovery'}` : 'Attendance not set'}
            </span>
            <button type="button" onclick="deleteReviewRow(${idx})" class="btn-icon" style="color:var(--text-muted);font-size:0.9rem" title="Remove row">✕</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(80px, 1fr));gap:8px">
          <div>
            <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--status-success)">Present *</label>
            <input type="number" min="0" class="form-input review-present" id="row-present-${idx}" value="${r.present}" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${idx})">
          </div>
          <div>
            <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--status-error)">Absent *</label>
            <input type="number" min="0" class="form-input review-absent" id="row-absent-${idx}" value="${r.absent}" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${idx})">
          </div>
          <div>
            <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--status-warning)">Leave</label>
            <input type="number" min="0" class="form-input review-leave" id="row-leave-${idx}" value="${r.leave || 0}" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${idx})">
          </div>
          <div>
            <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--text-muted)">Not Entered</label>
            <input type="number" min="0" class="form-input review-not-entered" id="row-not-entered-${idx}" value="${r.notEntered || 0}" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${idx})">
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function onReviewRowInputChange(idx) {
  const p = Math.max(0, parseInt(document.getElementById(`row-present-${idx}`)?.value) || 0);
  const a = Math.max(0, parseInt(document.getElementById(`row-absent-${idx}`)?.value) || 0);
  const l = Math.max(0, parseInt(document.getElementById(`row-leave-${idx}`)?.value) || 0);
  const n = Math.max(0, parseInt(document.getElementById(`row-not-entered-${idx}`)?.value) || 0);

  const targetPct = getAttendanceTarget();
  const total = p + a + l + n;
  const pct = total > 0 ? ((p / total) * 100).toFixed(1) : '0.0';
  const isSafe = parseFloat(pct) >= targetPct;

  const badgeEl = document.getElementById(`row-badge-${idx}`);
  if (badgeEl) {
    badgeEl.textContent = total > 0 ? `${pct}% · ${isSafe ? 'Safe Zone' : 'Needs Recovery'}` : 'Attendance not set';
    badgeEl.style.background = isSafe ? 'color-mix(in srgb, var(--status-success) 14%, transparent)' : 'color-mix(in srgb, var(--status-error) 14%, transparent)';
    badgeEl.style.color = isSafe ? 'var(--status-success)' : 'var(--status-error)';
  }
}

function deleteReviewRow(idx) {
  document.getElementById(`review-row-${idx}`)?.remove();
}

function addScanReviewRow() {
  const container = document.getElementById('ab-review-rows-container');
  if (!container) return;

  const subjects = getSubjectList();
  const newIdx = container.querySelectorAll('.attendance-review-row').length + Math.floor(Math.random()*1000);

  const subjectOptionsHTML = subjects.map(s => `
    <option value="${s.name}|||${s.code || ''}">${s.name} ${s.code ? `(${s.code})` : ''}</option>
  `).join('');

  const rowDiv = document.createElement('div');
  rowDiv.className = 'attendance-review-row';
  rowDiv.id = `review-row-${newIdx}`;
  rowDiv.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <label class="form-label" style="font-size:0.75rem;margin-bottom:3px">Subject</label>
        <select class="form-select review-subject-select" style="font-size:0.84rem;padding:5px 8px" onchange="onReviewRowInputChange(${newIdx})">
          ${subjectOptionsHTML}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="type-badge" id="row-badge-${newIdx}" style="font-size:0.72rem;padding:3px 8px;background:var(--surface-2);color:var(--text-muted)">
          Attendance not set
        </span>
        <button type="button" onclick="deleteReviewRow(${newIdx})" class="btn-icon" style="color:var(--text-muted);font-size:0.9rem" title="Remove row">✕</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(80px, 1fr));gap:8px">
      <div>
        <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--green)">Present *</label>
        <input type="number" min="0" class="form-input review-present" id="row-present-${newIdx}" value="0" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${newIdx})">
      </div>
      <div>
        <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--red)">Absent *</label>
        <input type="number" min="0" class="form-input review-absent" id="row-absent-${newIdx}" value="0" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${newIdx})">
      </div>
      <div>
        <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--yellow)">Leave</label>
        <input type="number" min="0" class="form-input review-leave" id="row-leave-${newIdx}" value="0" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${newIdx})">
      </div>
      <div>
        <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--text-muted)">Not Entered</label>
        <input type="number" min="0" class="form-input review-not-entered" id="row-not-entered-${newIdx}" value="0" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${newIdx})">
      </div>
    </div>
  `;
  container.appendChild(rowDiv);
}

function saveAllReviewedBaselines() {
  const container = document.getElementById('ab-review-rows-container');
  if (!container) return;

  const rows = container.querySelectorAll('.attendance-review-row');
  if (!rows.length) {
    showToast('No subjects to save.', 'info');
    document.getElementById('ab-review-modal-backdrop')?.remove();
    return;
  }

  const baselines = loadAttendanceBaselines();
  let savedCount = 0;

  rows.forEach(row => {
    const subjVal = row.querySelector('.review-subject-select')?.value || '';
    const [subjName, subjCode] = subjVal.split('|||');
    if (!subjName && !subjCode) return;

    const present = Math.max(0, parseInt(row.querySelector('.review-present')?.value) || 0);
    const absent = Math.max(0, parseInt(row.querySelector('.review-absent')?.value) || 0);
    const leave = Math.max(0, parseInt(row.querySelector('.review-leave')?.value) || 0);
    const notEntered = Math.max(0, parseInt(row.querySelector('.review-not-entered')?.value) || 0);

    const storageKey = (subjCode || subjName).trim();
    baselines[storageKey] = {
      subjectCode: subjCode || '',
      subjectName: subjName || '',
      present,
      absent,
      leave,
      notEntered,
      totalSessions: 0,
      updatedAt: new Date().toISOString()
    };
    savedCount++;
  });

  saveAttendanceBaselines(baselines);
  document.getElementById('ab-review-modal-backdrop')?.remove();
  showToast(`Attendance baseline saved for ${savedCount} subject${savedCount!==1?'s':''} ✓`, 'success');
  renderPage(state.currentPage);
}

function showAttendanceScanErrorModal(message) {
  const existing = document.getElementById('ab-scan-error-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'ab-scan-error-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:440px;padding:26px 22px;text-align:center">
      <div style="font-size:2.2rem;margin-bottom:10px">📷</div>
      <h3 style="margin:0 0 8px 0;font-size:1.15rem;font-weight:700;color:var(--text-primary)">We couldn’t read this screenshot clearly.</h3>
      <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:20px;line-height:1.45">
        ${message || 'The image may be blurry, low contrast, or not showing table columns. You can still enter your counts manually.'}
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button type="button" class="btn-secondary" onclick="document.getElementById('ab-scan-error-backdrop')?.remove()" style="font-size:0.84rem">
          Close
        </button>
        <button type="button" class="btn-primary" onclick="document.getElementById('ab-scan-error-backdrop')?.remove(); showBaselineModal(null, 'manual');" style="font-size:0.84rem;padding:7px 16px">
          ✍️ Enter Counts Manually
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
}

function onBaselineSubjectChange(subjectKey) {
  const newFields = document.getElementById('ab-new-subject-fields');
  if (subjectKey === '__new__') {
    if (newFields) newFields.style.display = 'grid';
    const presentEl = document.getElementById('ab-present');
    const absentEl = document.getElementById('ab-absent');
    const leaveEl = document.getElementById('ab-leave');
    const notEnteredEl = document.getElementById('ab-not-entered');
    const totalSessionsEl = document.getElementById('ab-total-sessions');
    const clearBtn = document.getElementById('ab-clear-btn');
    if (presentEl) presentEl.value = '';
    if (absentEl) absentEl.value = '';
    if (leaveEl) leaveEl.value = '';
    if (notEnteredEl) notEnteredEl.value = '';
    if (totalSessionsEl) totalSessionsEl.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    updateBaselinePreview();
    return;
  }
  if (newFields) newFields.style.display = 'none';

  const subjects = getSubjectList();
  const subj = subjects.find(s => (s.code || s.name) === subjectKey || s.name === subjectKey) || subjects[0];
  if (!subj) return;

  const baseline = getSubjectBaseline(subj);
  const presentEl = document.getElementById('ab-present');
  const absentEl = document.getElementById('ab-absent');
  const leaveEl = document.getElementById('ab-leave');
  const notEnteredEl = document.getElementById('ab-not-entered');
  const totalSessionsEl = document.getElementById('ab-total-sessions');
  const clearBtn = document.getElementById('ab-clear-btn');

  if (presentEl) presentEl.value = baseline.hasBaseline ? baseline.present : '';
  if (absentEl) absentEl.value = baseline.hasBaseline ? baseline.absent : '';
  if (leaveEl) leaveEl.value = baseline.hasBaseline ? baseline.leave : '';
  if (notEnteredEl) notEnteredEl.value = baseline.hasBaseline ? baseline.notEntered : '';
  if (totalSessionsEl) totalSessionsEl.value = (baseline.hasBaseline && baseline.totalSessions) ? baseline.totalSessions : '';

  if (clearBtn) {
    clearBtn.style.display = baseline.hasBaseline ? 'inline-block' : 'none';
  }

  updateBaselinePreview();
}

function updateBaselinePreview() {
  const previewEl = document.getElementById('ab-preview-card');
  if (!previewEl) return;

  const presentVal = parseInt(document.getElementById('ab-present')?.value) || 0;
  const absentVal = parseInt(document.getElementById('ab-absent')?.value) || 0;
  const leaveVal = parseInt(document.getElementById('ab-leave')?.value) || 0;
  const notEnteredVal = parseInt(document.getElementById('ab-not-entered')?.value) || 0;
  const totalSessionsVal = parseInt(document.getElementById('ab-total-sessions')?.value) || 0;

  const targetPct = getAttendanceTarget();
  const totalCount = presentVal + absentVal + leaveVal + notEnteredVal;
  const pct = totalCount > 0 ? ((presentVal / totalCount) * 100) : 0;
  const pctFormatted = pct.toFixed(2);
  const isSafe = pct >= targetPct;

  if (totalCount === 0) {
    previewEl.innerHTML = `
      <div style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:4px 0">
        Enter your present and absent counts to view instant percentage and recovery guidance.
      </div>
    `;
    return;
  }

  const guidance = calculateSmartAttendanceGuidance(presentVal, absentVal + leaveVal + notEnteredVal, targetPct);

  previewEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
      <div style="font-size:0.82rem;font-weight:600;color:var(--text-primary)">
        Conducted: <strong>${totalCount}</strong> sessions (${presentVal} attended)
      </div>
      <span class="type-badge" style="font-size:0.75rem;padding:2px 8px;background:${isSafe ? 'color-mix(in srgb, var(--status-success) 14%, transparent)' : 'color-mix(in srgb, var(--status-error) 14%, transparent)'};color:${isSafe ? 'var(--status-success)' : 'var(--status-error)'}">
        ${isSafe ? 'Safe Zone' : 'Needs Recovery'} · ${pctFormatted}%
      </span>
    </div>
    <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.45">
      💡 ${guidance.message}
    </div>
    ${totalSessionsVal > 0 ? `
      <div style="font-size:0.74rem;color:var(--text-muted);margin-top:6px;border-top:1px dashed var(--border);padding-top:6px">
        Semester Progress: <strong>${totalCount}</strong> of <strong>${totalSessionsVal}</strong> total planned sessions (${Math.round((totalCount / totalSessionsVal) * 100)}% conducted).
      </div>
    ` : ''}
  `;
}

function saveSubjectBaselineFromModal() {
  const selectEl = document.getElementById('ab-subject-select');
  const customNameEl = document.getElementById('ab-new-subject-name');
  const customCodeEl = document.getElementById('ab-new-subject-code');

  let subjName = '';
  let subjCode = '';

  if (selectEl && selectEl.value && selectEl.value !== '__new__') {
    const subjectKey = selectEl.value;
    const subjects = getSubjectList();
    const subj = subjects.find(s => (s.code || s.name) === subjectKey || s.name === subjectKey) || { name: subjectKey, code: subjectKey };
    subjName = subj.name;
    subjCode = subj.code || '';
  } else if (customNameEl && customNameEl.value.trim()) {
    subjName = customNameEl.value.trim();
    subjCode = (customCodeEl ? customCodeEl.value.trim() : '');
  }

  if (!subjName) {
    if (customNameEl) {
      customNameEl.classList.add('error', 'shake');
      customNameEl.focus();
    } else if (selectEl) {
      selectEl.classList.add('error', 'shake');
      selectEl.focus();
    }
    showToast('Please specify a subject name for this baseline.', 'error');
    return;
  }

  const present = Math.max(0, parseInt(document.getElementById('ab-present')?.value) || 0);
  const absent = Math.max(0, parseInt(document.getElementById('ab-absent')?.value) || 0);
  const leave = Math.max(0, parseInt(document.getElementById('ab-leave')?.value) || 0);
  const notEntered = Math.max(0, parseInt(document.getElementById('ab-not-entered')?.value) || 0);
  const totalSessions = Math.max(0, parseInt(document.getElementById('ab-total-sessions')?.value) || 0);

  const totalCount = present + absent + leave + notEntered;
  const pct = totalCount > 0 ? ((present / totalCount) * 100).toFixed(1) : '0.0';

  const baselines = loadAttendanceBaselines();
  const storageKey = (subjCode || subjName).trim();

  baselines[storageKey] = {
    subjectCode: subjCode,
    subjectName: subjName,
    present,
    absent,
    leave,
    notEntered,
    totalSessions,
    updatedAt: new Date().toISOString()
  };

  saveAttendanceBaselines(baselines);
  document.getElementById('baseline-modal-backdrop')?.remove();
  showToast(`Baseline saved for ${subjName} (${pct}%) ✓`, 'success');
  renderPage(state.currentPage);
}

function clearSubjectBaseline() {
  const selectEl = document.getElementById('ab-subject-select');
  const subjectKey = selectEl ? selectEl.value : null;
  if (!subjectKey || subjectKey === '__new__') return;

  const baselines = loadAttendanceBaselines();
  const subjects = getSubjectList();
  const subj = subjects.find(s => (s.code || s.name) === subjectKey || s.name === subjectKey) || { name: subjectKey, code: subjectKey };

  const storageKey = (subj.code || subj.name).trim();
  delete baselines[storageKey];

  saveAttendanceBaselines(baselines);
  document.getElementById('baseline-modal-backdrop')?.remove();
  showToast(`Attendance baseline cleared for ${subj.name}`, 'info');
  renderPage(state.currentPage);
}

// ── Declutter & Subject Recovery Engine ──────────────────────────

function detectDeskPollution() {
  const subjects = getSubjectList();
  if (!subjects || !subjects.length) return false;

  for (const s of subjects) {
    const raw = (s.name + ' ' + (s.code || '')).toLowerCase();
    // Check batch markers in subject identity
    if (/\b(?:batch|sec|section)\s*[a-d0-9]/i.test(raw) || /\b[a-d][1-4]\b/i.test(raw)) return true;
    // Check room numbers or faculty in subject identity
    if (/\b(?:prof\.|dr\.|mr\.|ms\.|mrs\.|lab-\d+|lh-\d+|lt-\d+|room\s*\d+)\b/i.test(raw)) return true;
    // Check timetable junk tokens
    for (const kw of TIMETABLE_JUNK_TOKENS) {
      if (raw.includes(kw)) return true;
    }
  }

  // Check if multiple subjects map to the same canonical core
  const seenCanonical = new Set();
  for (const s of subjects) {
    const norm = normalizeSubjectIdentity(s.name, [], s.type);
    const key = `${(norm.canonicalName || s.name).toLowerCase()}|||${s.type}`;
    if (seenCanonical.has(key)) return true;
    seenCanonical.add(key);
  }

  return false;
}

function loadDeclutterBackup() {
  return safeGetStorage(KEY_CLEANUP_BACKUP, null);
}

function showDeclutterDeskModal() {
  const existingBackdrop = document.getElementById('declutter-modal-backdrop');
  if (existingBackdrop) existingBackdrop.remove();

  const p = liveProfile || loadProfile() || {};
  const currentBatch = p.batch || safeGetStorage(KEY_USER_BATCH, '') || '';
  const backup = loadDeclutterBackup();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'declutter-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal declutter-dialog" onclick="event.stopPropagation()" style="max-width:540px;padding:26px 22px">
      <div class="modal-header" style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
        <div>
          <h2 class="modal-title" style="margin:0;font-size:1.24rem;font-weight:700">Declutter my desk</h2>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px">Clean up duplicate, noisy, or other-batch subject cards and normalize your schedule.</div>
        </div>
        <button class="modal-close" onclick="document.getElementById('declutter-modal-backdrop')?.remove()">${icons.x()}</button>
      </div>

      <div style="background:var(--surface-2);border-left:3px solid var(--accent);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:0.8rem;color:var(--text-secondary);line-height:1.45">
        💡 <strong>How decluttering works:</strong>
        <ul style="margin:6px 0 0 16px;padding:0;font-size:0.78rem;line-height:1.4">
          <li><strong>General lectures</strong> with no batch markers will be kept for everyone.</li>
          <li><strong>Practical lab sessions</strong> will only be kept if they match your specific batch.</li>
          <li>Duplicate variations and OCR noise will be merged into clean canonical Subject Hub cards.</li>
          <li>Attendance baselines, daily check-in logs, and tasks will be safely remapped.</li>
        </ul>
      </div>

      <div class="form-group" style="margin-bottom:18px">
        <label class="form-label" style="font-weight:600">Your Practical Batch / Section</label>
        <input type="text" id="declutter-user-batch" class="form-input" value="${(currentBatch || '').replace(/"/g, '&quot;')}" placeholder="e.g. A2, B1, D1 (or leave blank for All)" style="font-size:0.9rem">
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">
          Enter your batch (e.g. <strong>A1</strong>, <strong>A2</strong>, <strong>B2</strong>, <strong>D1</strong>). Leave blank if you wish to keep all sessions.
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:10px;border-top:1px solid var(--border);flex-wrap:wrap">
        <div>
          ${backup && backup.timestamp ? `
            <button type="button" class="btn-secondary" onclick="document.getElementById('declutter-modal-backdrop')?.remove(); showRestoreDeskModal();" style="font-size:0.8rem;padding:6px 12px;color:var(--text-secondary)">
              ↩ Restore Previous Backup
            </button>
          ` : `
            <button type="button" class="btn-secondary" onclick="document.getElementById('declutter-modal-backdrop')?.remove()" style="font-size:0.84rem">
              Cancel
            </button>
          `}
        </div>
        <div style="display:flex;gap:8px">
          ${backup && backup.timestamp ? `
            <button type="button" class="btn-secondary" onclick="document.getElementById('declutter-modal-backdrop')?.remove()" style="font-size:0.84rem">
              Cancel
            </button>
          ` : ''}
          <button type="button" class="btn-primary" onclick="proceedToDeclutterPreview()" style="font-size:0.85rem;padding:8px 18px;font-weight:600">
            Preview Cleanup Plan →
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
}

function proceedToDeclutterPreview() {
  const batchInput = document.getElementById('declutter-user-batch');
  const userBatch = (batchInput ? batchInput.value.trim() : '') || 'all';

  const liveTT = loadTimetable();
  const liveBaselines = loadAttendanceBaselines();
  const liveTasks = allTasks();

  const plan = generateDeclutterPlan(liveTT, liveBaselines, liveTasks, userBatch);
  renderDeclutterPreviewModal(plan, userBatch);
}

function generateDeclutterPlan(liveTT, liveBaselines, liveTasks, userBatch = 'all') {
  const newTT = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };
  const archivedSlots = [];
  const subjectMap = new Map();
  const remappedBaselines = [];
  const mergedSubjects = new Map();

  // 1. Process Timetable Slots
  [1, 2, 3, 4, 5, 6, 0].forEach(d => {
    (liveTT[d] || []).forEach(c => {
      const rawName = c.subject || '';
      if (!rawName.trim() || /^(off|lunch|break|holiday|recess|free)$/i.test(rawName.trim())) {
        newTT[d].push(c);
        return;
      }

      const shouldKeep = shouldKeepClassForUserBatch(c, userBatch);
      if (!shouldKeep) {
        archivedSlots.push({ day: d, time: c.time, subject: c.subject, batches: c.batches || extractBatchTags(c.subject) });
        return;
      }

      const norm = normalizeSubjectIdentity(rawName, [], c.type);
      const isLab = c.type === 'lab' || norm.isLab;
      const canonicalName = norm.canonicalName || rawName;
      const canonicalCode = norm.canonicalCode || c.code || '';
      const subjectKey = `${canonicalName.toLowerCase()}|||${isLab ? 'lab' : 'theory'}`;

      if (!subjectMap.has(subjectKey)) {
        subjectMap.set(subjectKey, {
          name: canonicalName,
          code: canonicalCode,
          type: isLab ? 'lab' : (c.type || norm.classType || 'lecture'),
          teacher: c.teacher || norm.teacher || '',
          room: c.room || norm.room || '',
          slotsCount: 0
        });
      }
      subjectMap.get(subjectKey).slotsCount++;

      if (!mergedSubjects.has(canonicalName)) {
        mergedSubjects.set(canonicalName, new Set());
      }
      mergedSubjects.get(canonicalName).add(rawName);

      newTT[d].push({
        ...c,
        subject: canonicalName,
        code: canonicalCode,
        type: isLab ? 'lab' : (c.type || norm.classType || 'lecture'),
        teacher: c.teacher || norm.teacher || '',
        room: c.room || norm.room || '',
        batches: norm.batches
      });
    });
  });

  const survivingList = Array.from(subjectMap.values());

  // 2. Process Attendance Baselines
  const newBaselines = {};
  Object.entries(liveBaselines || {}).forEach(([oldKey, oldVal]) => {
    const rawSubj = oldVal.subjectName || oldKey;
    const norm = normalizeSubjectIdentity(rawSubj, survivingList);
    const matched = survivingList.find(s => 
      s.name.toLowerCase() === norm.canonicalName.toLowerCase() || 
      (s.code && norm.canonicalCode && s.code.toLowerCase() === norm.canonicalCode.toLowerCase())
    );

    const targetKey = matched ? (matched.code || matched.name) : (norm.canonicalCode || norm.canonicalName || oldKey);
    const targetName = matched ? matched.name : (norm.canonicalName || rawSubj);
    const targetCode = matched ? matched.code : (norm.canonicalCode || '');

    if (!newBaselines[targetKey]) {
      newBaselines[targetKey] = {
        subjectCode: targetCode,
        subjectName: targetName,
        present: 0,
        absent: 0,
        leave: 0,
        notEntered: 0,
        totalSessions: oldVal.totalSessions || 0,
        updatedAt: new Date().toISOString()
      };
    }

    newBaselines[targetKey].present += (parseInt(oldVal.present) || 0);
    newBaselines[targetKey].absent += (parseInt(oldVal.absent) || 0);
    newBaselines[targetKey].leave += (parseInt(oldVal.leave) || 0);
    newBaselines[targetKey].notEntered += (parseInt(oldVal.notEntered) || 0);

    remappedBaselines.push({
      oldKey,
      newKey: targetKey,
      subjectName: targetName,
      present: newBaselines[targetKey].present,
      absent: newBaselines[targetKey].absent
    });
  });

  // 3. Process Historical Daily Attendance Logs (KEY_ATTENDANCE)
  const liveDailyAttendance = safeGetStorage(KEY_ATTENDANCE, {}) || {};
  const newDailyAttendance = {};
  const remappedDailyLogs = [];
  const unmatchedDailyLogs = [];
  let totalDailyLogsCount = 0;

  Object.entries(liveDailyAttendance).forEach(([dateStr, dayLogs]) => {
    if (!dayLogs || typeof dayLogs !== 'object') return;
    newDailyAttendance[dateStr] = {};

    Object.entries(dayLogs).forEach(([oldClassKey, status]) => {
      totalDailyLogsCount++;
      const lastUnderscore = oldClassKey.lastIndexOf('_');
      const rawSubjKey = lastUnderscore > 0 ? oldClassKey.substring(0, lastUnderscore) : oldClassKey;
      const timeSuffix = lastUnderscore > 0 ? oldClassKey.substring(lastUnderscore) : '';

      const cleanRaw = rawSubjKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      let matched = survivingList.find(s => {
        const sCode = (s.code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const sName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return (sCode && cleanRaw === sCode) || (sName && cleanRaw === sName) || (sCode && cleanRaw.startsWith(sCode)) || (sName && cleanRaw.startsWith(sName));
      });

      if (!matched) {
        const norm = normalizeSubjectIdentity(rawSubjKey, survivingList);
        matched = survivingList.find(s =>
          s.name.toLowerCase() === norm.canonicalName.toLowerCase() ||
          (s.code && norm.canonicalCode && s.code.toLowerCase() === norm.canonicalCode.toLowerCase())
        );
      }

      if (matched) {
        const targetId = (matched.code || matched.name).replace(/[^a-zA-Z0-9_]/g, '');
        const targetTime = timeSuffix.replace(/[^a-zA-Z0-9_]/g, '');
        const newClassKey = `${targetId}${targetTime}`;

        newDailyAttendance[dateStr][newClassKey] = status;

        if (newClassKey !== oldClassKey) {
          remappedDailyLogs.push({
            date: dateStr,
            oldKey: oldClassKey,
            newKey: newClassKey,
            subjectName: matched.name,
            status
          });
        }
      } else {
        // Safe retention: Never discard unmatched logs
        newDailyAttendance[dateStr][oldClassKey] = status;
        unmatchedDailyLogs.push({
          date: dateStr,
          key: oldClassKey,
          status
        });
      }
    });
  });

  // 4. Calculate Affected Tasks and Links Count
  const tasks = safeGetStorage(KEY_CUSTOM_TASKS, []);
  let affectedTasksCount = 0;
  if (Array.isArray(tasks)) {
    tasks.forEach(t => {
      if (!t.subject) return;
      const norm = normalizeSubjectIdentity(t.subject, survivingList);
      const matched = survivingList.find(s => 
        s.name.toLowerCase() === t.subject.toLowerCase() || 
        (s.code && s.code.toLowerCase() === t.subject.toLowerCase()) ||
        s.name.toLowerCase() === norm.canonicalName.toLowerCase() ||
        (s.code && norm.canonicalCode && s.code.toLowerCase() === norm.canonicalCode.toLowerCase())
      );
      if (matched && matched.name !== t.subject) affectedTasksCount++;
    });
  }

  const links = safeGetStorage(KEY_CUSTOM_LINKS, []);
  let affectedLinksCount = 0;
  if (Array.isArray(links)) {
    links.forEach(l => {
      if (!l.subject) return;
      const norm = normalizeSubjectIdentity(l.subject, survivingList);
      const matched = survivingList.find(s => 
        s.name.toLowerCase() === l.subject.toLowerCase() || 
        (s.code && s.code.toLowerCase() === l.subject.toLowerCase()) ||
        s.name.toLowerCase() === norm.canonicalName.toLowerCase() ||
        (s.code && norm.canonicalCode && s.code.toLowerCase() === norm.canonicalCode.toLowerCase())
      );
      if (matched && matched.name !== l.subject) affectedLinksCount++;
    });
  }

  return {
    newTimetable: newTT,
    newBaselines,
    newDailyAttendance,
    survivingSubjects: survivingList,
    archivedSlots,
    mergedSubjects: Array.from(mergedSubjects.entries()).map(([k, v]) => ({ canonicalName: k, rawSources: Array.from(v) })),
    remappedBaselines,
    remappedDailyLogs,
    unmatchedDailyLogs,
    totalDailyLogsCount,
    affectedTasksCount,
    affectedLinksCount
  };
}

function renderDeclutterPreviewModal(plan, userBatch) {
  const existingBackdrop = document.getElementById('declutter-modal-backdrop');
  if (existingBackdrop) existingBackdrop.remove();

  const subjectsHTML = plan.survivingSubjects.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface-2);border-radius:6px;margin-bottom:6px">
      <div>
        <div style="font-weight:600;font-size:0.88rem;color:var(--text-primary)">${s.name}</div>
        <div style="font-size:0.75rem;color:var(--text-muted)">${s.code || 'No Code'} · ${s.slotsCount} slot${s.slotsCount!==1?'s':''}/wk ${s.room ? `· ${s.room}` : ''}</div>
      </div>
      <span class="type-badge" style="font-size:0.72rem;padding:2px 8px;text-transform:capitalize">
        ${s.type}
      </span>
    </div>
  `).join('');

  const archivedHTML = plan.archivedSlots.length > 0 ? plan.archivedSlots.map(a => `
    <div style="font-size:0.77rem;color:var(--text-muted);padding:4px 8px;background:var(--surface-2);border-radius:4px;margin-bottom:4px;display:flex;justify-content:space-between">
      <span>${a.subject}</span>
      <span style="color:var(--yellow)">Batch: ${(a.batches || []).join(', ') || 'Other'}</span>
    </div>
  `).join('') : '<div style="font-size:0.78rem;color:var(--text-muted)">No other-batch classes found to remove.</div>';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'declutter-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal declutter-preview-dialog" onclick="event.stopPropagation()" style="max-width:620px;padding:26px 22px">
      <div class="modal-header" style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
        <div>
          <h2 class="modal-title" style="margin:0;font-size:1.24rem;font-weight:700">Preview your clean desk setup</h2>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px">Review the normalized course structure before applying changes.</div>
        </div>
        <button class="modal-close" onclick="document.getElementById('declutter-modal-backdrop')?.remove()">${icons.x()}</button>
      </div>

      <!-- Overview Stats Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;margin-bottom:14px">
        <div style="background:var(--surface-2);padding:8px 10px;border-radius:6px;text-align:center">
          <div style="font-size:1.15rem;font-weight:800;color:var(--accent)">${plan.survivingSubjects.length}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">Canonical Hubs</div>
        </div>
        <div style="background:var(--surface-2);padding:8px 10px;border-radius:6px;text-align:center">
          <div style="font-size:1.15rem;font-weight:800;color:var(--yellow)">${plan.archivedSlots.length}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">Other Batches Removed</div>
        </div>
        <div style="background:var(--surface-2);padding:8px 10px;border-radius:6px;text-align:center">
          <div style="font-size:1.15rem;font-weight:800;color:var(--green)">${plan.remappedDailyLogs.length}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">Daily Logs Remapped</div>
        </div>
        <div style="background:var(--surface-2);padding:8px 10px;border-radius:6px;text-align:center">
          <div style="font-size:1.15rem;font-weight:800;color:var(--text-primary)">${plan.remappedBaselines.length}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">Baselines Merged</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface-2);border-radius:6px;padding:8px 12px;margin-bottom:14px;font-size:0.8rem">
        <span>🎓 Practical Batch Filter:</span>
        <strong style="color:var(--accent)">${userBatch === 'all' ? 'All (Keep all batches)' : `Batch ${userBatch.toUpperCase()}`}</strong>
      </div>

      <div style="max-height:48vh;overflow-y:auto;padding-right:4px;margin-bottom:16px">
        <div style="font-weight:700;font-size:0.86rem;margin-bottom:8px;color:var(--text-primary)">
          🟢 Surviving Canonical Subject Hubs (${plan.survivingSubjects.length})
        </div>
        ${subjectsHTML}

        ${plan.archivedSlots.length > 0 ? `
          <div style="font-weight:700;font-size:0.86rem;margin:14px 0 6px 0;color:var(--text-secondary)">
            🗑️ Other-Batch Sessions Removed (${plan.archivedSlots.length})
          </div>
          ${archivedHTML}
        ` : ''}

        ${plan.remappedBaselines.length > 0 ? `
          <div style="font-weight:700;font-size:0.86rem;margin:14px 0 6px 0;color:var(--text-secondary)">
            📊 Attendance Baselines Reassigned (${plan.remappedBaselines.length})
          </div>
          <div style="font-size:0.77rem;color:var(--text-muted);background:var(--surface-2);padding:8px 12px;border-radius:6px">
            All existing present and absent counts have been safely mapped to your clean canonical subjects.
          </div>
        ` : ''}

        ${plan.remappedDailyLogs.length > 0 ? `
          <div style="font-weight:700;font-size:0.86rem;margin:14px 0 6px 0;color:var(--text-secondary)">
            📅 Daily Attendance Logs Remapped (${plan.remappedDailyLogs.length})
          </div>
          <div style="font-size:0.77rem;color:var(--text-muted);background:var(--surface-2);padding:8px 12px;border-radius:6px">
            Past attendance marks from uncleaned subject keys will now link seamlessly to their canonical timetable slots.
          </div>
        ` : ''}

        ${plan.unmatchedDailyLogs && plan.unmatchedDailyLogs.length > 0 ? `
          <div style="font-size:0.74rem;color:var(--text-muted);background:var(--surface-2);padding:6px 10px;border-radius:6px;margin-top:10px">
            🛡️ <strong>Data Safety:</strong> ${plan.unmatchedDailyLogs.length} unassociated check-in logs were safely retained without modification.
          </div>
        ` : ''}
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:12px;border-top:1px solid var(--border)">
        <button type="button" class="btn-secondary" onclick="showDeclutterDeskModal()" style="font-size:0.84rem">
          ← Back
        </button>
        <button type="button" class="btn-primary" onclick="confirmExecuteDeclutter()" style="font-size:0.86rem;padding:8px 20px;font-weight:600">
          Confirm &amp; Clean Up Desk ✓
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  window._pendingDeclutterPlan = plan;
  window._pendingDeclutterBatch = userBatch;
}

function confirmExecuteDeclutter() {
  if (window._pendingDeclutterPlan) {
    executeDeclutterPlan(window._pendingDeclutterPlan, window._pendingDeclutterBatch || 'all');
    window._pendingDeclutterPlan = null;
    window._pendingDeclutterBatch = null;
  }
}

function executeDeclutterPlan(plan, userBatch) {
  // 1. Take a safe complete snapshot before applying any destructive writes
  const backup = {
    timestamp: new Date().toISOString(),
    userBatch,
    timetable: loadTimetable(),
    baselines: loadAttendanceBaselines(),
    liveAttendance: loadLiveAttendanceActions(),
    dailyAttendance: safeGetStorage(KEY_ATTENDANCE, {}) || {},
    tasks: safeGetStorage(KEY_CUSTOM_TASKS, []),
    links: safeGetStorage(KEY_CUSTOM_LINKS, []),
    profile: liveProfile || loadProfile() || {}
  };
  safeSetStorage(KEY_CLEANUP_BACKUP, backup);

  // 2. Save new timetable
  safeSetStorage(KEY_CUSTOM_TIMETABLE, plan.newTimetable);

  // 3. Save remapped attendance baselines
  saveAttendanceBaselines(plan.newBaselines);

  // 4. Save remapped historical daily attendance logs
  if (plan.newDailyAttendance) {
    safeSetStorage(KEY_ATTENDANCE, plan.newDailyAttendance);
  }

  // 5. Remap tasks
  const tasks = safeGetStorage(KEY_CUSTOM_TASKS, []);
  if (Array.isArray(tasks) && tasks.length > 0) {
    const updatedTasks = tasks.map(t => {
      if (!t.subject) return t;
      const norm = normalizeSubjectIdentity(t.subject, plan.survivingSubjects);
      const matched = plan.survivingSubjects.find(s => 
        s.name.toLowerCase() === t.subject.toLowerCase() || 
        (s.code && s.code.toLowerCase() === t.subject.toLowerCase()) ||
        s.name.toLowerCase() === norm.canonicalName.toLowerCase() ||
        (s.code && norm.canonicalCode && s.code.toLowerCase() === norm.canonicalCode.toLowerCase())
      );
      return matched ? { ...t, subject: matched.name } : t;
    });
    safeSetStorage(KEY_CUSTOM_TASKS, updatedTasks);
  }

  // 6. Remap custom links
  const links = safeGetStorage(KEY_CUSTOM_LINKS, []);
  if (Array.isArray(links) && links.length > 0) {
    const updatedLinks = links.map(l => {
      if (!l.subject) return l;
      const norm = normalizeSubjectIdentity(l.subject, plan.survivingSubjects);
      const matched = plan.survivingSubjects.find(s => 
        s.name.toLowerCase() === l.subject.toLowerCase() || 
        (s.code && s.code.toLowerCase() === l.subject.toLowerCase()) ||
        s.name.toLowerCase() === norm.canonicalName.toLowerCase() ||
        (s.code && norm.canonicalCode && s.code.toLowerCase() === norm.canonicalCode.toLowerCase())
      );
      return matched ? { ...l, subject: matched.name } : l;
    });
    safeSetStorage(KEY_CUSTOM_LINKS, updatedLinks);
  }

  // 7. Update user profile batch
  if (userBatch && userBatch.toLowerCase() !== 'all') {
    safeSetStorage(KEY_USER_BATCH, userBatch);
    const p = liveProfile || loadProfile() || {};
    p.batch = userBatch;
    liveProfile = p;
    safeSetStorage(KEY_PROFILE, p);
  }

  syncToCloud();

  document.getElementById('declutter-modal-backdrop')?.remove();
  showToast('Your desk is now decluttered and normalized! ✨', 'success');
  renderPage(state.currentPage);
}

function showRestoreDeskModal() {
  const backup = loadDeclutterBackup();
  if (!backup || !backup.timestamp) {
    showToast('No previous desk cleanup backup found to restore.', 'info');
    return;
  }

  const existing = document.getElementById('restore-desk-backdrop');
  if (existing) existing.remove();

  const formattedDate = new Date(backup.timestamp).toLocaleString();
  const ttCount = [1, 2, 3, 4, 5, 6, 0].reduce((acc, d) => acc + ((backup.timetable && backup.timetable[d]) ? backup.timetable[d].length : 0), 0);
  const baseCount = Object.keys(backup.baselines || {}).length;
  const taskCount = Array.isArray(backup.tasks) ? backup.tasks.length : 0;
  const linkCount = Array.isArray(backup.links) ? backup.links.length : 0;
  const dailyCount = Object.values(backup.dailyAttendance || {}).reduce((acc, day) => acc + (typeof day === 'object' ? Object.keys(day).length : 0), 0);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'restore-desk-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:520px;padding:26px 22px">
      <div class="modal-header" style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
        <div>
          <h2 class="modal-title" style="margin:0;font-size:1.24rem;font-weight:700">Restore Previous Desk Setup</h2>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px">Roll back your timetable, attendance baselines, and logs to before the last cleanup.</div>
        </div>
        <button class="modal-close" onclick="document.getElementById('restore-desk-backdrop')?.remove()">${icons.x()}</button>
      </div>

      <div style="background:var(--surface-2);border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:0.82rem">
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px">📦 Snapshot Details:</div>
        <div style="color:var(--text-secondary);line-height:1.6;font-size:0.79rem">
          📅 <strong>Backup Created:</strong> ${formattedDate}<br>
          🎓 <strong>Previous Filter:</strong> ${backup.userBatch && backup.userBatch !== 'all' ? `Batch ${backup.userBatch.toUpperCase()}` : 'All Batches (General)'}<br>
          📊 <strong>Contents:</strong> ${ttCount} timetable slots · ${baseCount} baselines · ${dailyCount} daily logs · ${taskCount} tasks · ${linkCount} links
        </div>
      </div>

      <div style="background:color-mix(in srgb, var(--status-error) 8%, var(--bg-surface));border-left:3px solid var(--status-error);border-radius:var(--radius-xs,6px);padding:10px 12px;margin-bottom:18px;font-size:0.79rem;color:var(--text-secondary)">
        ⚠️ <strong>Note:</strong> Restoring this backup will replace current timetable slots, attendance baselines, and daily logs with the state saved on ${formattedDate}.
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:12px;border-top:1px solid var(--border)">
        <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('restore-desk-backdrop')?.remove()" style="font-size:0.84rem">
          Cancel
        </button>
        <button type="button" class="btn btn-sm btn-primary" onclick="confirmExecuteRestore()" style="font-size:0.86rem;padding:8px 20px;font-weight:600;background:var(--status-error);border-color:var(--status-error)">
          Confirm &amp; Restore Desk ↩
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
}

function confirmExecuteRestore() {
  const backup = loadDeclutterBackup();
  if (!backup) {
    showToast('No backup found to restore.', 'error');
    return;
  }

  try {
    if (backup.timetable) safeSetStorage(KEY_CUSTOM_TIMETABLE, backup.timetable);
    if (backup.baselines) safeSetStorage(KEY_ATTENDANCE_BASELINE, backup.baselines);
    if (backup.liveAttendance) safeSetStorage(KEY_ATTENDANCE_LIVE, backup.liveAttendance);
    if (backup.dailyAttendance) safeSetStorage(KEY_ATTENDANCE, backup.dailyAttendance);
    if (backup.tasks) safeSetStorage(KEY_CUSTOM_TASKS, backup.tasks);
    if (backup.links) safeSetStorage(KEY_CUSTOM_LINKS, backup.links);
    if (backup.userBatch) safeSetStorage(KEY_USER_BATCH, backup.userBatch);
    if (backup.profile) {
      safeSetStorage(KEY_PROFILE, backup.profile);
      liveProfile = backup.profile;
    }

    syncToCloud();
    document.getElementById('restore-desk-backdrop')?.remove();
    showToast('Previous desk setup restored successfully! ↩', 'success');
    renderPage(state.currentPage);
  } catch (err) {
    console.error('[RestoreBackup] Error restoring snapshot:', err);
    showToast('Failed to restore backup. Your current data is preserved.', 'error');
  }
}

function renderSubjects() {
  const el = document.getElementById('page-subjects');
  if (!el) return;

  const subjects = getSubjectList();
  const activeName = state.activeSubject;
  const activeSubject = activeName ? subjects.find(s => s.name.toLowerCase() === activeName.toLowerCase() || s.code.toLowerCase() === activeName.toLowerCase()) : null;

  if (activeSubject) {
    renderSingleSubjectHub(el, activeSubject, subjects);
  } else {
    renderSubjectsOverview(el, subjects);
  }
}

function renderSubjectsOverview(el, subjects) {
  if (!subjects.length) {
    el.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Subject Hubs</div>
          <div class="page-subtitle">Course schedules, attendance baselines, tasks &amp; study resources organized per subject</div>
        </div>
      </div>
      <div class="empty-state-card" style="margin-top:16px">
        <span class="empty-state-icon">📚</span>
        <div class="empty-state-title">No Subjects Set Up Yet</div>
        <div class="empty-state-desc">Import your timetable schedule or enter an initial attendance baseline to automatically create your Subject Hubs.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px">
          <button class="btn-primary" onclick="triggerTimetableImport()" style="font-size:0.82rem;padding:7px 14px">📷 Scan Timetable Photo</button>
          <button class="btn-secondary" onclick="showBaselineModal(null, 'manual')" style="font-size:0.82rem;padding:7px 14px">📊 Set Attendance Baseline</button>
          <button class="btn-secondary" onclick="loadOfficialAidsTimetable()" style="font-size:0.82rem;padding:7px 14px">📋 Sample Template</button>
        </div>
      </div>
    `;
    return;
  }

  const anyMissingBaseline = subjects.some(s => !getSubjectAttendance(s).hasBaseline);

  const cardsHTML = subjects.map(s => {
    const att = getSubjectAttendance(s);
    const tasks = allTasks().filter(t => (t.subject || '').toLowerCase() === s.name.toLowerCase() || (t.subject || '').toLowerCase() === s.code.toLowerCase());
    const pendingTasks = tasks.filter(t => t.status === 'pending');

    const attStatusClass = att.pct === null ? 'muted' : att.isSafe ? 'green' : 'red';
    const attLabel = att.pct !== null ? `${att.exactPct !== null ? att.exactPct : att.pct}%` : 'Attendance not set yet';

    return `
      <div class="card attendance-subject-card" style="padding:18px;border-left:4px solid ${s.color || 'var(--accent)'}">
        <!-- Subject Header -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px">
          <div style="cursor:pointer" onclick="openSubjectHub('${s.name}')">
            <div style="font-weight:700;font-size:1.02rem;color:var(--text-primary)">${s.name}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">${s.code} ${s.teacher ? '· Prof. ' + s.teacher : ''} ${s.room ? '· ' + s.room : ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
            <span class="type-badge" style="font-size:0.75rem;padding:3px 9px;background:${attStatusClass==='green'?'color-mix(in srgb, var(--status-success) 14%, transparent)':attStatusClass==='red'?'color-mix(in srgb, var(--status-error) 14%, transparent)':'var(--surface-2)'};color:${attStatusClass==='green'?'var(--status-success)':attStatusClass==='red'?'var(--status-error)':'var(--text-muted)'}">
              ${attLabel}
            </span>
            <span style="font-size:0.68rem;font-weight:600;color:${att.pct===null?'var(--text-muted)':att.isSafe?'var(--status-success)':'var(--status-error)'}">
              ${att.statusLine}
            </span>
          </div>
        </div>

        <!-- Attendance Summary Pill -->
        <div style="font-size:0.78rem;color:var(--text-secondary);background:var(--surface-2);padding:6px 10px;border-radius:6px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">
          <div>
            ${att.total > 0 ? `<strong>${att.present}</strong> Present · <strong>${att.absent}</strong> Missed${att.leave > 0 ? ` · <strong>${att.leave}</strong> Leave` : ''}` : 'No attendance recorded yet'}
          </div>
          <div style="color:var(--text-muted);font-size:0.74rem">
            ${att.total > 0 ? `Total: <strong>${att.total}</strong>` : 'Starting point not set'}
          </div>
        </div>

        <!-- Insight Row -->
        ${att.pct !== null ? `
          <div style="font-size:0.76rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.4">
            💡 ${att.insightMessage}
          </div>
        ` : `
          <div style="font-size:0.76rem;color:var(--text-muted);margin-bottom:12px">
            Add your current counts once so future attendance stays accurate.
          </div>
        `}

        <!-- Workload Metadata -->
        <div style="display:flex;gap:12px;font-size:0.76rem;color:var(--text-secondary);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">
          <div>📅 <strong>${s.slots.length}</strong> slot${s.slots.length!==1?'s':''}/wk</div>
          <div>📝 <strong>${pendingTasks.length}</strong> pending task${pendingTasks.length!==1?'s':''}</div>
        </div>

        <!-- Action Buttons: Present, Missed, Leave, Edit baseline -->
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="event.stopPropagation(); logSubjectAttendanceAction('${s.code || s.name}', 'present')" title="Log 1 class attended" style="color:var(--status-success);border-color:color-mix(in srgb, var(--status-success) 30%, transparent)">
            Present
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="event.stopPropagation(); logSubjectAttendanceAction('${s.code || s.name}', 'missed')" title="Log 1 class missed" style="color:var(--status-error);border-color:color-mix(in srgb, var(--status-error) 30%, transparent)">
            Missed
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="event.stopPropagation(); logSubjectAttendanceAction('${s.code || s.name}', 'leave')" title="Log 1 leave applied" style="color:var(--status-warning);border-color:color-mix(in srgb, var(--status-warning) 30%, transparent)">
            Leave
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="event.stopPropagation(); showBaselineModal('${s.code || s.name}')" style="margin-left:auto;font-size:0.74rem">
            Edit Baseline
          </button>
        </div>
      </div>
    `;
  }).join('');

  const hasPollution = detectDeskPollution();

  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div class="page-title">Subject Hubs</div>
        <div class="page-subtitle">Course schedules, attendance baselines, tasks &amp; study resources organized per subject</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="showDeclutterDeskModal()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px" title="Declutter duplicate or other-batch subject cards">
          🧹 Declutter my desk
        </button>
        <button class="btn btn-secondary" onclick="showBaselineModal(null, 'scan')" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px">
          📷 Scan from Photo
        </button>
        <button class="btn btn-primary" onclick="showBaselineModal(null, 'manual')" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px">
          📊 Set Baseline
        </button>
      </div>
    </div>

    ${hasPollution ? `
      <div class="card" style="padding:12px 16px;margin-bottom:16px;background:var(--surface-2);border-left:3px solid var(--yellow);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:0.88rem;color:var(--text-primary)">✨ Declutter your personalized desk</div>
          <div style="font-size:0.79rem;color:var(--text-secondary);margin-top:2px">
            We detected duplicate or batch-specific subject cards from an earlier timetable import. Clean them up to match your specific practical batch.
          </div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="showDeclutterDeskModal()" style="font-size:0.82rem;padding:6px 14px;white-space:nowrap">
          🧹 Clean Up Desk →
        </button>
      </div>
    ` : ''}

    ${anyMissingBaseline ? `
      <div class="card" style="padding:14px 18px;margin-bottom:18px;background:var(--surface-2);border-left:3px solid var(--accent);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:0.9rem;color:var(--text-primary)">Set your current attendance</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px">
            Add your present and absent counts once. Clarity Desk will continue from there.
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-secondary" onclick="showBaselineModal(null, 'scan')" style="font-size:0.82rem;padding:6px 12px;white-space:nowrap">
            📷 Scan Photo
          </button>
          <button class="btn btn-sm btn-primary" onclick="showBaselineModal(null, 'manual')" style="font-size:0.82rem;padding:6px 14px;white-space:nowrap">
            📊 Set Counts
          </button>
        </div>
      </div>
    ` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(290px, 1fr));gap:14px">
      ${cardsHTML}
    </div>
  `;
}

function renderSingleSubjectHub(el, subj, allSubjects) {
  const att = getSubjectAttendance(subj);
  const tasks = allTasks().filter(t => (t.subject || '').toLowerCase() === subj.name.toLowerCase() || (t.subject || '').toLowerCase() === subj.code.toLowerCase());
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const doneTasks = tasks.filter(t => t.status === 'submitted');

  const subjectVaults = loadCustomLinks().filter(l => 
    (l.subject || '').toLowerCase() === subj.name.toLowerCase() || 
    (subj.code && (l.code || '').toLowerCase() === subj.code.toLowerCase())
  );
  
  const allResources = [];
  subjectVaults.forEach((v, si) => {
    if (Array.isArray(v.resources)) {
      v.resources.forEach((r, ri) => allResources.push({ ...r, vaultSubject: v.subject, vaultIdx: si, resIdx: ri }));
    }
  });

  // Timetable slots
  const slotsHTML = subj.slots.length > 0 ? subj.slots.map(sl => `
    <div class="card card-sm" style="margin-bottom:6px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div>
        <div style="font-weight:600;font-size:0.85rem">${DAY_NAMES[sl.day]} · ${sl.time} ${sl.end ? '- ' + sl.end : ''}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">${sl.room || subj.room || 'Classroom'} ${sl.teacher ? '· ' + sl.teacher : subj.teacher ? '· ' + subj.teacher : ''}</div>
      </div>
      <span class="type-badge">${sl.code || subj.code}</span>
    </div>
  `).join('') : `<div style="font-size:0.82rem;color:var(--text-muted);padding:10px 0">No weekly timetable slots assigned to this subject yet.</div>`;

  // Tasks list
  const tasksHTML = tasks.length > 0 ? tasks.map(a => {
    const isOngoing = !!a.noDeadline || (a.taskType === 'mission' && !a.dueDate);
    const days  = isOngoing ? null : dueDaysLeft(a.dueDate);
    const done  = a.status === 'submitted';
    const label = done ? 'Completed ✓' : isOngoing ? '🚀 Ongoing' : days < 0 ? 'Overdue' : days === 0 ? 'Due Today' : `${days}d left`;
    const cls   = done ? '' : isOngoing ? 'ongoing' : days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'soon' : '';
    const dateText = isOngoing ? 'Standing Mission' : `Due ${formatDate(a.dueDate)}`;
    return `
      <div class="card card-sm assignment-card" style="margin-bottom:6px;display:flex;align-items:center;gap:10px;padding:10px 12px">
        <div onclick="toggleAssignment('${a.id}')" title="Click to mark done" style="width:18px;height:18px;border-radius:4px;border:2px solid ${done ? 'var(--green)' : a.priority==='high' ? 'var(--red)' : a.priority==='medium' ? 'var(--yellow)' : 'var(--border)'};background:${done ? 'var(--green)' : 'transparent'};display:grid;place-items:center;flex-shrink:0;color:white;cursor:pointer;transition:all 0.15s">
          ${done ? icons.check() : ''}
        </div>
        <div style="flex:1;min-width:0">
          <div class="font-semibold" style="font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${done?'text-decoration:line-through;opacity:0.5':''}">${a.title}</div>
          <div class="text-xs text-muted">${dateText}</div>
        </div>
        <span class="due-badge ${cls}">${label}</span>
      </div>`;
  }).join('') : `<div style="font-size:0.82rem;color:var(--text-muted);padding:10px 0">No active tasks for this subject. Tap + Add Task to create one.</div>`;

  // Links list
  const linksHTML = allResources.length > 0 ? allResources.map(r => `
    <div class="card card-sm" style="margin-bottom:6px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
        <span class="r-icon" style="font-size:1.05rem;line-height:1">${getResourceIcon(r.icon || 'book-open')}</span>
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:0.85rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.label}</div>
          ${r.fileSize ? `<div style="font-size:0.7rem;color:var(--text-muted)">${r.fileSize}</div>` : ''}
        </div>
      </div>
      <a href="${r.url}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary" style="font-size:0.75rem;padding:3px 9px">${r.isUpload ? 'Download 📥' : 'Open ↗'}</a>
    </div>
  `).join('') : `
    <div class="empty-state-card" style="padding:16px 14px;margin-top:6px;text-align:center">
      <div style="font-size:1.35rem;margin-bottom:4px">📚</div>
      <div style="font-weight:600;font-size:0.88rem;color:var(--text-primary);margin-bottom:2px">No Study Links or Notes Yet</div>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">Attach drive folders, lecture notes, syllabus PDFs, or code repos for ${subj.name}.</div>
      <button class="btn btn-sm btn-primary" onclick="openAddResourceForSubject('${(subj.name || '').replace(/'/g, "\\'")}', '${(subj.code || '').replace(/'/g, "\\'")}')" style="font-size:0.78rem;padding:5px 14px">+ Add Study Link / Note</button>
    </div>
  `;

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="btn btn-sm btn-secondary" onclick="closeSubjectHub()" style="margin-bottom:12px;font-size:0.8rem;display:inline-flex;align-items:center;gap:6px">
        ← All Subjects
      </button>

      <div class="card" style="padding:20px;border-left:4px solid ${subj.color || 'var(--accent)'}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:1.35rem;font-weight:800;color:var(--text-primary)">${subj.name}</div>
            <div style="font-size:0.85rem;color:var(--text-muted);margin-top:2px">
              ${subj.code ? 'Course Code: <strong>' + subj.code + '</strong> · ' : ''}
              ${subj.teacher ? 'Faculty: <strong>Prof. ' + subj.teacher + '</strong> · ' : ''}
              ${subj.room ? 'Room: <strong>' + subj.room + '</strong>' : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="type-badge" style="font-size:0.8rem;padding:5px 12px;background:${att.pct===null?'var(--surface-2)':att.isSafe?'color-mix(in srgb, var(--status-success) 14%, transparent)':'color-mix(in srgb, var(--status-error) 14%, transparent)'};color:${att.pct===null?'var(--text-muted)':att.isSafe?'var(--status-success)':'var(--status-error)'}">
              ${att.pct !== null ? `${att.exactPct !== null ? att.exactPct : att.pct}% Attendance (${att.attended}/${att.total})` : 'Attendance not set yet'}
            </span>
            <button class="btn btn-sm ${att.hasBaseline ? 'btn-secondary' : 'btn-primary'}" onclick="showBaselineModal('${subj.code || subj.name}')" style="display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;padding:5px 11px">
              📊 ${att.hasBaseline ? 'Edit Baseline' : 'Set Baseline'}
            </button>
          </div>
        </div>

        ${att.hasBaseline ? `
          <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:12px;padding:8px 12px;background:var(--surface-2);border-radius:6px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
            <div>📌 ERP Baseline: <strong>${att.baseline.present} / ${att.baseline.totalCount}</strong> (${att.baseline.totalCount > 0 ? ((att.baseline.present/att.baseline.totalCount)*100).toFixed(2) : 0}%)</div>
            <div>${(att.dailyAttended > 0 || att.dailySkipped > 0 || att.liveAdj.present > 0 || att.liveAdj.missed > 0) ? `Live marked: <strong>+${att.dailyAttended + att.liveAdj.present}</strong> attended, <strong>+${att.dailySkipped + att.liveAdj.missed}</strong> missed` : 'Live tracking active from baseline'}</div>
          </div>
        ` : ''}

        <!-- Quick Log Action Bar on Subject Hub -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <span style="font-size:0.74rem;font-weight:600;color:var(--text-muted);letter-spacing:-0.01em">Quick Log:</span>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="logSubjectAttendanceAction('${subj.code || subj.name}', 'present')" style="color:var(--status-success);border-color:color-mix(in srgb, var(--status-success) 35%, transparent)">
            Present (+1)
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="logSubjectAttendanceAction('${subj.code || subj.name}', 'missed')" style="color:var(--status-error);border-color:color-mix(in srgb, var(--status-error) 35%, transparent)">
            Missed (+1)
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="logSubjectAttendanceAction('${subj.code || subj.name}', 'leave')" style="color:var(--status-warning);border-color:color-mix(in srgb, var(--status-warning) 35%, transparent)">
            Leave (+1)
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="showBaselineModal('${subj.code || subj.name}')" style="margin-left:auto">
            Edit Baseline
          </button>
          ${(att.liveAdj.present > 0 || att.liveAdj.missed > 0 || att.liveAdj.leave > 0) ? `
            <button class="btn btn-xs btn-secondary" onclick="undoSubjectAttendanceAction('${subj.code || subj.name}')" title="Reset live manual adjustments" style="color:var(--text-muted);font-size:0.72rem;padding:3px 7px">
              ↩ Reset Live Adjustments
            </button>
          ` : ''}
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
          <div style="background:var(--surface-2);padding:10px 12px;border-radius:8px">
            <div style="font-size:0.75rem;color:var(--text-muted)">Weekly Slots</div>
            <div style="font-size:1.1rem;font-weight:700;margin-top:2px">${subj.slots.length} class${subj.slots.length!==1?'es':''}</div>
          </div>
          <div style="background:var(--surface-2);padding:10px 12px;border-radius:8px">
            <div style="font-size:0.75rem;color:var(--text-muted)">Pending Tasks</div>
            <div style="font-size:1.1rem;font-weight:700;color:${pendingTasks.length>0?'var(--red)':'inherit'};margin-top:2px">${pendingTasks.length} pending</div>
          </div>
          <div style="background:var(--surface-2);padding:10px 12px;border-radius:8px">
            <div style="font-size:0.75rem;color:var(--text-muted)">Completed Tasks</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--green);margin-top:2px">${doneTasks.length} done</div>
          </div>
          <div style="background:var(--surface-2);padding:10px 12px;border-radius:8px">
            <div style="font-size:0.75rem;color:var(--text-muted)">Study Resources</div>
            <div style="font-size:1.1rem;font-weight:700;margin-top:2px">${allResources.length} link${allResources.length!==1?'s':''}</div>
          </div>
        </div>

        ${att.pct !== null ? `
          <div style="font-size:0.8rem;color:var(--text-primary);margin-top:12px;padding:8px 12px;background:var(--surface-2);border-radius:6px;border-left:3px solid ${att.isSafe ? 'var(--green)' : 'var(--red)'}">
            💡 ${att.insightMessage}
          </div>
        ` : `
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:12px;padding:8px 12px;background:var(--surface-2);border-radius:6px">
            💡 Add your current counts once so future attendance stays accurate from the right starting point.
          </div>
        `}
      </div>
    </div>

    <!-- 1. Timetable Slots -->
    <div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="section-heading" style="margin-bottom:0">Timetable Schedule</div>
        <button class="btn btn-sm btn-action" onclick="navigateTo('timetable')">Open Timetable →</button>
      </div>
      ${slotsHTML}
    </div>

    <!-- 2. Tasks & Assignments -->
    <div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="section-heading" style="margin-bottom:0">Tasks &amp; Deadlines</div>
        <button class="btn btn-sm btn-primary" onclick="showAssignmentModal(null, '${subj.name}')" style="font-size:0.75rem;padding:3px 9px">+ Add Task</button>
      </div>
      ${tasksHTML}
    </div>

    <!-- 3. Resources & Links -->
    <div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="section-heading" style="margin-bottom:0">Study Links &amp; Notes</div>
        <button class="btn btn-sm btn-primary" onclick="openAddResourceForSubject('${(subj.name || '').replace(/'/g, "\\'")}', '${(subj.code || '').replace(/'/g, "\\'")}')" style="font-size:0.75rem;padding:3px 9px">+ Add Link</button>
      </div>
      ${linksHTML}
    </div>
  `;
}

function showTimetableEntryModal(day = state.ttDay, idx = null) {
  const tt = loadTimetable();
  const dayClasses = tt[day] || [];
  const item = (idx !== null && dayClasses[idx]) ? dayClasses[idx] : null;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'tt-entry-modal-backdrop';

  const dayOptions = [1,2,3,4,5,6,0].map(d => 
    `<option value="${d}" ${d == day ? 'selected' : ''}>${DAY_NAMES[d]}</option>`
  ).join('');

  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:480px">
      <div class="modal-header">
        <h2 class="modal-title">${item ? 'Edit Class Entry' : 'Add Class Entry'}</h2>
        <button class="modal-close" onclick="document.getElementById('tt-entry-modal-backdrop').remove()">${icons.x()}</button>
      </div>

      <div class="form-group">
        <label class="form-label">Day <span class="req">*</span></label>
        <select class="form-select" id="tte-day">${dayOptions}</select>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Start Time <span class="req">*</span></label>
          <input type="text" class="form-input" id="tte-time" placeholder="e.g. 10:00" value="${item ? item.time || '' : '10:00'}">
        </div>
        <div class="form-group">
          <label class="form-label">End Time <span class="req">*</span></label>
          <input type="text" class="form-input" id="tte-end" placeholder="e.g. 11:00" value="${item ? item.end || '' : '11:00'}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Subject Name <span class="req">*</span></label>
          <input type="text" class="form-input" id="tte-subject" placeholder="e.g. Data Structures" value="${item ? (item.subject || '').replace(/"/g, '&quot;') : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Subject Code</label>
          <input type="text" class="form-input" id="tte-code" placeholder="e.g. DS" value="${item ? (item.code || '').replace(/"/g, '&quot;') : ''}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Room / Hall</label>
          <input type="text" class="form-input" id="tte-room" placeholder="e.g. LT-1" value="${item ? (item.room || '').replace(/"/g, '&quot;') : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Faculty / Teacher</label>
          <input type="text" class="form-input" id="tte-teacher" placeholder="e.g. Prof. VJM" value="${item ? (item.teacher || '').replace(/"/g, '&quot;') : ''}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Class Type</label>
        <select class="form-select" id="tte-type">
          <option value="lecture" ${item && item.type === 'lecture' ? 'selected' : ''}>Lecture</option>
          <option value="lab" ${item && item.type === 'lab' ? 'selected' : ''}>Lab</option>
          <option value="project" ${item && item.type === 'project' ? 'selected' : ''}>Project / Workshop</option>
          <option value="off" ${item && item.type === 'off' ? 'selected' : ''}>Off</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Notes / Exception (Optional)</label>
        <input type="text" class="form-input" id="tte-notes" placeholder="e.g. Room changed to SF-32 on 24 Oct" value="${item ? (item.notes || '').replace(/"/g, '&quot;') : ''}">
      </div>

      <div class="form-actions">
        ${item ? `<button class="btn-secondary" onclick="deleteTimetableEntry(${day}, ${idx})" style="color:var(--red);margin-right:auto">Delete Entry</button>` : ''}
        <button class="btn-secondary" onclick="document.getElementById('tt-entry-modal-backdrop').remove()">Cancel</button>
        <button class="btn-primary" onclick="saveTimetableEntry(${day}, ${idx !== null ? idx : 'null'})">Save Class</button>
      </div>
    </div>
  `;

  backdrop.addEventListener('click', () => backdrop.remove());
  document.body.appendChild(backdrop);
}

function saveTimetableEntry(oldDay, idx) {
  const newDay   = parseInt(document.getElementById('tte-day').value);
  const time     = (document.getElementById('tte-time').value || '10:00').trim();
  const end      = (document.getElementById('tte-end').value || '11:00').trim();
  const subjectEl = document.getElementById('tte-subject');
  let subject  = (subjectEl ? subjectEl.value : '').trim();
  let code     = (document.getElementById('tte-code').value || '').trim();
  let room     = (document.getElementById('tte-room').value || '').trim();
  let teacher  = (document.getElementById('tte-teacher').value || '').trim();
  const type     = document.getElementById('tte-type').value || 'lecture';
  const notes    = (document.getElementById('tte-notes').value || '').trim();

  if (subjectEl) subjectEl.classList.remove('error', 'shake');

  if (type === 'off') {
    if (!subject) subject = 'Off';
  } else {
    if (!subject) {
      if (subjectEl) {
        subjectEl.classList.add('error', 'shake');
        subjectEl.focus();
      }
      showToast('Please enter a subject name.', 'error');
      return;
    }
    if (!code) code = 'SUB';
    if (!room) room = '—';
    if (!teacher) teacher = '—';
  }

  const tt = JSON.parse(JSON.stringify(loadTimetable()));
  if (!tt[newDay]) tt[newDay] = [];

  const entry = { time, end, subject, code, room, teacher, type };
  if (notes) entry.notes = notes;
  if (isBreakEntry(entry)) entry.isBreak = true;

  if (idx !== null && oldDay === newDay && tt[oldDay]?.[idx]) {
    tt[oldDay][idx] = entry;
  } else {
    if (idx !== null && tt[oldDay]?.[idx]) {
      tt[oldDay].splice(idx, 1);
    }
    tt[newDay].push(entry);
  }

  Object.keys(tt).forEach(d => {
    tt[d].sort((a,b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  });

  saveTimetable(tt);
  document.getElementById('tt-entry-modal-backdrop')?.remove();
  state.ttDay = newDay;
  showToast('Class schedule saved ✓', 'success');
  renderTimetable();
}

function deleteTimetableEntry(day, idx) {
  if (!confirm("Delete this class entry?")) return;
  const tt = JSON.parse(JSON.stringify(loadTimetable()));
  if (tt[day]?.[idx]) {
    tt[day].splice(idx, 1);
    saveTimetable(tt);
  }
  document.getElementById('tt-entry-modal-backdrop')?.remove();
  showToast('Class entry removed', 'info');
  renderTimetable();
}

// ── Assignments & Workload Manager ────────────────────────────
window.setAssignTypeFilter = function(type) {
  state.assignTypeFilter = type;
  renderAssignments();
};

window.handleTaskTypeChange = function(type) {
  const chk = document.getElementById('task-no-deadline');
  if (type === 'mission' && chk && !chk.checked) {
    chk.checked = true;
    window.handleTaskNoDeadlineToggle(true);
  }
};

window.handleTaskNoDeadlineToggle = function(checked) {
  const dueInput = document.getElementById('task-due');
  const reqSpan = document.getElementById('task-due-req');
  const hint = document.getElementById('task-ongoing-hint');
  if (dueInput) {
    dueInput.disabled = checked;
    dueInput.style.opacity = checked ? '0.45' : '1';
    dueInput.style.background = checked ? 'var(--surface-2)' : 'var(--surface)';
    if (checked) {
      dueInput.classList.remove('error', 'shake');
    }
  }
  if (reqSpan) reqSpan.style.display = checked ? 'none' : 'inline';
  if (hint) hint.style.display = checked ? 'block' : 'none';
};

function renderAssignments() {
  const el  = document.getElementById('page-assignments');
  const all = allTasks();

  if (!state.assignTypeFilter) state.assignTypeFilter = 'all';
  const today = todayStr();
  const subjects = ['all', ...new Set(all.map(a => a.code || a.subject))];

  const statusFilters = [
    { key:'all',       label:'All Tasks' },
    { key:'today',     label:'🔥 Due Today' },
    { key:'upcoming',  label:'📅 Upcoming' },
    { key:'ongoing',   label:'🚀 Ongoing Missions' },
    { key:'overdue',   label:'⚠️ Overdue' },
    { key:'exams',     label:'🎯 Exams & Tests' },
    { key:'submitted', label:'✓ Completed' },
  ];

  const typeFilters = [
    { key:'all',        label:'All Types' },
    { key:'assignment', label:'📝 Assignments' },
    { key:'mission',    label:'🚀 Missions' },
    { key:'general',    label:'📋 General' },
    { key:'quiz',       label:'⚡ Quizzes' },
    { key:'lab',        label:'🧪 Labs' },
    { key:'project',    label:'💻 Projects' },
    { key:'exam',       label:'🎯 Exams' },
    { key:'study',      label:'📚 Self Study' },
  ];

  let filtered = all;

  // Filter by status/deadline
  if (state.assignFilter === 'today') {
    filtered = filtered.filter(a => a.status === 'pending' && !a.noDeadline && a.dueDate === today);
  } else if (state.assignFilter === 'upcoming') {
    filtered = filtered.filter(a => a.status === 'pending' && !a.noDeadline && a.dueDate && a.dueDate >= today);
  } else if (state.assignFilter === 'ongoing' || state.assignFilter === 'missions') {
    filtered = filtered.filter(a => a.status === 'pending' && (a.taskType === 'mission' || !!a.noDeadline));
  } else if (state.assignFilter === 'overdue') {
    filtered = filtered.filter(a => isTaskOverdue(a));
  } else if (state.assignFilter === 'exams') {
    filtered = filtered.filter(a => (a.taskType === 'exam' || a.taskType === 'quiz') && a.status === 'pending');
  } else if (state.assignFilter === 'submitted') {
    filtered = filtered.filter(a => a.status === 'submitted');
  }

  // Filter by subject
  if (state.assignSubjectFilter !== 'all') {
    filtered = filtered.filter(a => a.code === state.assignSubjectFilter || a.subject === state.assignSubjectFilter);
  }

  // Filter by task type
  if (state.assignTypeFilter !== 'all') {
    filtered = filtered.filter(a => (a.taskType || 'assignment') === state.assignTypeFilter);
  }

  // Sorting: Pending first, then due date ascending, with ongoing missions organized
  filtered.sort((a,b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    const isOngoingA = !!a.noDeadline || (a.taskType === 'mission' && !a.dueDate);
    const isOngoingB = !!b.noDeadline || (b.taskType === 'mission' && !b.dueDate);
    if (isOngoingA && !isOngoingB) return 1;
    if (!isOngoingA && isOngoingB) return -1;
    if (isOngoingA && isOngoingB) return a.title.localeCompare(b.title);
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  });

  const statusBar  = statusFilters.map(f => `<button class="filter-chip ${(f.key===state.assignFilter || (f.key==='ongoing' && state.assignFilter==='missions'))?'active':''}" onclick="setAssignFilter('${f.key}')">${f.label}</button>`).join('');
  const typeBar    = typeFilters.map(f => `<button class="filter-chip ${f.key===state.assignTypeFilter?'active':''}" onclick="setAssignTypeFilter('${f.key}')">${f.label}</button>`).join('');
  const subjectBar = subjects.map(s => `<button class="filter-chip ${s===state.assignSubjectFilter?'active':''}" onclick="setAssignSubject('${s}')">${s==='all'?'All Subjects':s}</button>`).join('');

  const cards = filtered.length ? filtered.map(a => {
    const isMission = a.taskType === 'mission';
    const isOngoing = !!a.noDeadline || (isMission && !a.dueDate);
    const days = isOngoing ? null : dueDaysLeft(a.dueDate);
    const done = a.status === 'submitted';
    const isCustom = !!a.isCustom;
    const taskType = a.taskType || 'assignment';

    let stateBadge = '';
    if (done) {
      stateBadge = `<span class="due-badge">Completed ✓</span>`;
    } else if (isOngoing) {
      stateBadge = `<span class="due-badge ongoing" title="Always active — stays visible until completed"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor"></span> Ongoing · No deadline</span>`;
    } else if (days !== null) {
      const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due Today' : days === 1 ? 'Due Tomorrow' : `${days}d left`;
      const cls   = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'soon' : '';
      stateBadge = `<span class="due-badge ${cls}">${svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', 12)} ${formatDate(a.dueDate)} · ${label}</span>`;
    }

    return `
      <div class="assignment-card ${isMission ? 'is-mission' : ''} priority-${a.priority} ${done?'done':''}" id="ac-${a.id}">
        <div class="assignment-checkbox" onclick="toggleAssignment('${a.id}')">
          ${done ? icons.check() : ''}
        </div>
        <div class="assignment-body">
          <div class="assignment-subject" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span onclick="openSubjectHub('${a.subject}')" style="cursor:pointer;font-weight:700" title="Open ${a.subject} Hub">${a.subject} ${a.code ? '· ' + a.code : ''}</span>
            <span class="type-badge type-${taskType}">${taskType === 'mission' ? '🚀 Mission' : taskType}</span>
            ${isCustom ? '<span class="session-badge">My task</span>' : ''}
          </div>
          <div class="assignment-title">${a.title}</div>
          ${a.description ? `<div class="assignment-desc">${a.description}</div>` : ''}
          <div class="assignment-footer">
            ${stateBadge}
            <span class="marks-badge">${a.marks > 0 ? a.marks + ' marks' : ''}</span>
            ${isCustom ? `
              <button class="task-edit-btn" onclick="showAddTaskModal('${a.id}')" title="Edit task" aria-label="Edit task">${icons.edit()}</button>
              <button class="task-delete-btn" onclick="deleteCustomTask('${a.id}')" title="Delete task" aria-label="Delete task">${icons.trash()}</button>
            ` : ''}
          </div>
        </div>
      </div>`;
  }).join('') : (all.length === 0 
    ? `<div class="empty-state-card" style="margin-top:14px">
        <span class="empty-state-icon">📚</span>
        <div class="empty-state-title">No Tasks Yet</div>
        <div class="empty-state-desc">Stay on top of coursework, deadlines, and project milestones. Tap Add Task to get started.</div>
        <button class="btn-primary" onclick="showAddTaskModal()" style="font-size:0.82rem;padding:7px 16px">+ Add Task</button>
      </div>`
    : (state.assignFilter === 'ongoing' || state.assignFilter === 'missions')
    ? `<div class="empty-state-card" style="margin-top:14px">
        <span class="empty-state-icon">🚀</span>
        <div class="empty-state-title">No Standing Missions</div>
        <div class="empty-state-desc">Missions stay visible on your desk without rigid deadlines until you complete them.</div>
        <button class="btn-primary" onclick="showAddTaskModal(null, null, 'mission')" style="font-size:0.82rem;padding:7px 16px">+ Create Mission</button>
      </div>`
    : `<div class="empty-state-card" style="margin-top:14px">
        <span class="empty-state-icon">✨</span>
        <div class="empty-state-title">No Matching Tasks</div>
        <div class="empty-state-desc">No tasks found matching the selected filter. Try switching back to All Tasks or resetting your filters.</div>
        <button class="btn-secondary" onclick="resetAssignmentFilters()" style="font-size:0.82rem;padding:6px 14px">Reset Filters</button>
      </div>`);

  el.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="page-title">Tasks &amp; Deadlines</div>
        <div class="page-subtitle">${pendingCount()} pending · ${all.filter(a=>a.status==='submitted').length} completed</div>
      </div>
      <button class="btn-primary" onclick="showAddTaskModal()" style="display:flex;align-items:center;gap:6px;flex-shrink:0">${icons.plus()} Add Task</button>
    </div>
    <div class="filter-bar">${statusBar}</div>
    <div class="filter-bar">${typeBar}</div>
    <div class="filter-bar">${subjectBar}</div>
    ${cards}
  `;
}

// ── Add / Edit Task Modal ──────────────────────────────────────
window.showAssignmentModal = function(id = null, prefilledSubject = null, defaultType = null) {
  showAddTaskModal(id, prefilledSubject, defaultType);
};

function showAddTaskModal(editTaskId = null, prefilledSubject = null, defaultType = null) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().split('T')[0];

  const editTask = editTaskId ? state.customTasks.find(t => t.id === editTaskId) : null;
  const initialType = editTask ? editTask.taskType : (defaultType || 'assignment');
  const isOngoing = editTask ? (!!editTask.noDeadline || (editTask.taskType === 'mission' && !editTask.dueDate)) : (initialType === 'mission');

  const subjectsList = getSubjectList();

  const subjectOptions = subjectsList.map(s => {
    const val = `${s.name}|||${s.code}`;
    const isSel = (editTask && (editTask.code === s.code || editTask.subject === s.name)) || (prefilledSubject && (prefilledSubject.toLowerCase() === s.name.toLowerCase() || prefilledSubject.toLowerCase() === s.code.toLowerCase()));
    return `<option value="${val}" ${isSel ? 'selected' : ''}>${s.name} (${s.code})</option>`;
  }).join('');

  const isGeneralSel = editTask && (editTask.subject === 'General' || editTask.code === 'GEN');
  const isMissionSubjectSel = (editTask && (editTask.subject === 'Mission' || editTask.code === 'MIS')) || (!editTask && initialType === 'mission' && !prefilledSubject);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'add-task-backdrop';
  backdrop.innerHTML = `
    <div class="modal add-task-modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2 class="modal-title">${editTask ? 'Edit Task' : initialType === 'mission' ? 'Create Mission' : 'Add Task'}</h2>
        <button class="modal-close" onclick="document.getElementById('add-task-backdrop').remove()">${icons.x()}</button>
      </div>

      <div class="form-group">
        <label class="form-label">Subject / Category <span class="req">*</span></label>
        <select class="form-select" id="task-subject">
          <option value="">Select subject or category…</option>
          <optgroup label="Academic Subjects">
            ${subjectOptions}
          </optgroup>
          <optgroup label="General &amp; Life Goals">
            <option value="General|||GEN" ${isGeneralSel ? 'selected' : ''}>📋 General Desk Task / Other</option>
            <option value="Mission|||MIS" ${isMissionSubjectSel ? 'selected' : ''}>🚀 Long-Term Mission / Target</option>
          </optgroup>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Task Title <span class="req">*</span></label>
        <input type="text" class="form-input" id="task-title"
          placeholder="e.g. Master Dynamic Programming, Lab Report 3, or Pay Fee" maxlength="120"
          value="${editTask ? editTask.title.replace(/"/g, '&quot;') : ''}">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Task Type</label>
          <select class="form-select" id="task-type" onchange="handleTaskTypeChange(this.value)">
            <option value="assignment" ${initialType === 'assignment' ? 'selected' : ''}>📝 Assignment</option>
            <option value="mission" ${initialType === 'mission' ? 'selected' : ''}>🚀 Mission (Long-term Goal)</option>
            <option value="general" ${initialType === 'general' ? 'selected' : ''}>📋 General / Personal</option>
            <option value="quiz" ${initialType === 'quiz' ? 'selected' : ''}>⚡ Quiz / Test</option>
            <option value="lab" ${initialType === 'lab' ? 'selected' : ''}>🧪 Lab Report / Viva</option>
            <option value="project" ${initialType === 'project' ? 'selected' : ''}>💻 Project</option>
            <option value="exam" ${initialType === 'exam' ? 'selected' : ''}>🎯 Exam</option>
            <option value="study" ${initialType === 'study' ? 'selected' : ''}>📚 Self Study</option>
          </select>
        </div>
        <div class="form-group" id="task-due-group">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <label class="form-label" style="margin-bottom:0" id="task-due-label">Due Date <span class="req" id="task-due-req" style="${isOngoing ? 'display:none' : ''}">*</span></label>
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.76rem;color:var(--text-secondary);cursor:pointer;user-select:none;font-weight:500">
              <input type="checkbox" id="task-no-deadline" ${isOngoing ? 'checked' : ''} onchange="handleTaskNoDeadlineToggle(this.checked)">
              <span>Ongoing · No deadline</span>
            </label>
          </div>
          <input type="date" class="form-input" id="task-due" value="${editTask && !isOngoing ? (editTask.dueDate || '') : defaultDate}" ${isOngoing ? 'disabled style="opacity:0.45;background:var(--surface-2);cursor:not-allowed"' : ''}>
          <div id="task-ongoing-hint" style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;line-height:1.4;display:${isOngoing ? 'flex' : 'none'};align-items:center;gap:6px">
            <span style="color:var(--purple);font-weight:600">✦ Standing Goal:</span> Stays active on your desk until completed or deleted. Never becomes overdue.
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Marks / Weightage</label>
          <input type="number" class="form-input" id="task-marks" placeholder="10" min="0" max="100"
            value="${editTask && editTask.marks ? editTask.marks : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <div class="priority-pills">
            <label class="priority-pill priority-high">
              <input type="radio" name="task-priority" value="high" ${editTask && editTask.priority === 'high' ? 'checked' : ''}> High
            </label>
            <label class="priority-pill priority-medium">
              <input type="radio" name="task-priority" value="medium" ${!editTask || editTask.priority === 'medium' ? 'checked' : ''}> Med
            </label>
            <label class="priority-pill priority-low">
              <input type="radio" name="task-priority" value="low" ${editTask && editTask.priority === 'low' ? 'checked' : ''}> Low
            </label>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Description / Instructions</label>
        <textarea class="form-input form-textarea" id="task-desc"
          placeholder="Milestones, notes, syllabus topics, or links...">${editTask ? editTask.description : ''}</textarea>
      </div>

      <div class="form-actions">
        <button class="btn-secondary" onclick="document.getElementById('add-task-backdrop').remove()">Cancel</button>
        <button class="btn-primary" onclick="submitAddTask(${editTask ? `'${editTask.id}'` : ''})">${editTask ? 'Save Changes' : initialType === 'mission' ? 'Create Mission' : 'Add Task'}</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', () => backdrop.remove());
  document.body.appendChild(backdrop);
  setTimeout(() => document.getElementById('task-subject')?.focus(), 50);

  // Close on Esc
  const escHandler = (e) => {
    if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
  backdrop.addEventListener('remove', () => document.removeEventListener('keydown', escHandler));
}

function submitAddTask(editTaskId = null) {
  const subjectEl    = document.getElementById('task-subject');
  const titleEl      = document.getElementById('task-title');
  const dueEl        = document.getElementById('task-due');
  const noDeadlineEl = document.getElementById('task-no-deadline');
  const marksEl      = document.getElementById('task-marks');
  const descEl       = document.getElementById('task-desc');
  const typeEl       = document.getElementById('task-type');
  const priorityEl   = document.querySelector('input[name="task-priority"]:checked');

  const isNoDeadline = !!(noDeadlineEl && noDeadlineEl.checked);

  [subjectEl, titleEl, dueEl].forEach(el => {
    if (el) {
      el.classList.remove('error');
      el.classList.remove('shake');
    }
  });

  let valid = true;
  let firstInvalid = null;

  if (!subjectEl || !subjectEl.value) {
    if (subjectEl) { subjectEl.classList.add('error', 'shake'); if (!firstInvalid) firstInvalid = subjectEl; }
    valid = false;
  }
  if (!titleEl || !titleEl.value.trim()) {
    if (titleEl) { titleEl.classList.add('error', 'shake'); if (!firstInvalid) firstInvalid = titleEl; }
    valid = false;
  }
  if (!isNoDeadline && (!dueEl || !dueEl.value)) {
    if (dueEl) { dueEl.classList.add('error', 'shake'); if (!firstInvalid) firstInvalid = dueEl; }
    valid = false;
  }

  if (!valid) {
    if (firstInvalid) firstInvalid.focus();
    showToast(isNoDeadline ? 'Please provide a subject and title.' : 'Please provide a subject, title, and due date.', 'error');
    return;
  }

  const [subject, code] = subjectEl.value.split('|||');
  const taskType = typeEl?.value || 'assignment';
  const finalDueDate = isNoDeadline ? '' : (dueEl ? dueEl.value : '');

  if (editTaskId) {
    let task = state.customTasks.find(t => t.id === editTaskId);
    if (task) {
      task.subject     = subject;
      task.code        = code;
      task.title       = titleEl.value.trim();
      task.taskType    = taskType;
      task.noDeadline  = isNoDeadline;
      task.description = descEl ? (descEl.value.trim() || '—') : '—';
      task.dueDate     = finalDueDate;
      task.priority    = priorityEl?.value || 'medium';
      task.marks       = parseInt(marksEl?.value) || 0;
    } else {
      task = {
        id:          editTaskId,
        subject,
        code,
        title:       titleEl.value.trim(),
        taskType,
        noDeadline:  isNoDeadline,
        description: descEl ? (descEl.value.trim() || '—') : '—',
        dueDate:     finalDueDate,
        priority:    priorityEl?.value || 'medium',
        status:      'pending',
        marks:       parseInt(marksEl?.value) || 0,
        isCustom:    true,
      };
      state.customTasks.push(task);
    }
  } else {
    const task = {
      id:          `c-${Date.now()}`,
      subject,
      code,
      title:       titleEl.value.trim(),
      taskType,
      noDeadline:  isNoDeadline,
      description: descEl ? (descEl.value.trim() || '—') : '—',
      dueDate:     finalDueDate,
      priority:    priorityEl?.value || 'medium',
      status:      'pending',
      marks:       parseInt(marksEl?.value) || 0,
      isCustom:    true,
    };
    state.customTasks.push(task);
  }

  saveCustomTasks();
  document.getElementById('add-task-backdrop')?.remove();
  showToast(editTaskId ? 'Task updated ✓' : (taskType === 'mission' || isNoDeadline) ? 'Mission added to desk ✓' : 'Task added to desk ✓', 'success');
  renderPage(state.currentPage);
  updateNavBadges();
}

// ── Notices ───────────────────────────────────────────────────
function renderNotices() {
  const el = document.getElementById('page-notices');
  if (!el) return;
  const q  = state.noticeSearch.toLowerCase();
  const channels = loadNoticeChannels();

  let filtered = NOTICES;
  if (q) filtered = filtered.filter(n =>
    n.title.toLowerCase().includes(q) ||
    n.content.toLowerCase().includes(q) ||
    n.category.toLowerCase().includes(q)
  );

  const cardsHtml = filtered.length ? filtered.map(n => `
    <div class="notice-card ${n.important?'important':''}" onclick="showNotice('${n.id}')">
      <div class="notice-header">
        <div class="notice-title">${n.title}</div>
        <span class="cat-badge cat-${n.category}">${n.category}</span>
      </div>
      <div class="notice-date">
        ${svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', 12)}
        ${formatDate(n.date)} ${n.important ? '· <strong style="color:var(--red)">Important</strong>' : ''}
      </div>
    </div>
  `).join('') : `<div class="empty-state-card" style="margin-top:14px">
    <span class="empty-state-icon">🔍</span>
    <div class="empty-state-title">No Announcements Found</div>
    <div class="empty-state-desc">No campus notices match "${state.noticeSearch}". Check your keywords or clear your search to view all notices.</div>
    <button class="btn-secondary" onclick="filterNotices(''); const el=document.getElementById('notice-search'); if(el) el.value='';" style="font-size:0.82rem;padding:6px 14px">Clear Search</button>
  </div>`;

  const searchInput = document.getElementById('notice-search');
  if (searchInput && el.classList.contains('active')) {
    const listContainer = document.getElementById('notices-list-container');
    if (listContainer) listContainer.innerHTML = cardsHtml;
    const clearBtn = document.getElementById('notice-search-clear');
    if (clearBtn) clearBtn.style.display = state.noticeSearch ? 'block' : 'none';
    return;
  }

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Notice Board</div>
        <div class="page-subtitle">${NOTICES.filter(n=>n.important).length} pinned announcements · official campus circulars</div>
      </div>
    </div>

    <!-- ── Quick-Access Notice Sources (3 Soft Linked Cards) ── -->
    <div class="notice-sources-grid">
      <!-- Card 1: Official Updates / Official Class Group -->
      <div class="notice-source-card tint-official" onclick="handleNoticeSourceClick('official')" title="Open official notice source">
        <div class="notice-source-top">
          <div class="notice-source-icon-wrap notice-source-icon-official">📢</div>
          <button class="btn-icon" onclick="event.stopPropagation(); showNoticeChannelModal('official')" title="Edit official channel settings" style="width:24px;height:24px;font-size:0.72rem" aria-label="Edit official channel settings">
            ✏️
          </button>
        </div>
        <div>
          <div class="notice-source-title">${escHtml_cd(channels.officialTitle || 'Official Updates')}</div>
          <div class="notice-source-sub">Official notices from your class or department</div>
        </div>
        <div class="notice-source-action">
          <span>${channels.officialUrl ? 'Open Portal / Source ↗' : '+ Configure Link'}</span>
        </div>
      </div>

      <!-- Card 2: WhatsApp / Community Group -->
      <div class="notice-source-card tint-whatsapp" onclick="handleNoticeSourceClick('whatsapp')" title="Open class group or channel">
        <div class="notice-source-top">
          <div class="notice-source-icon-wrap notice-source-icon-whatsapp">💬</div>
          <button class="btn-icon" onclick="event.stopPropagation(); showNoticeChannelModal('whatsapp')" title="Edit class group link" style="width:24px;height:24px;font-size:0.72rem" aria-label="Edit class group link">
            ✏️
          </button>
        </div>
        <div>
          <div class="notice-source-title">${escHtml_cd(channels.whatsappTitle || 'Class Community')}</div>
          <div class="notice-source-sub">Open batch channel or group invite</div>
        </div>
        <div class="notice-source-action" style="color:var(--accent-warm, #25D366)">
          <span>${channels.whatsappUrl ? 'Open Class Group ↗' : '+ Set Channel Link'}</span>
        </div>
      </div>

      <!-- Card 3: Dev Notes -->
      <div class="notice-source-card tint-devnotes" onclick="showDevNotesModal()" title="View recent updates and improvements">
        <div class="notice-source-top">
          <div class="notice-source-icon-wrap notice-source-icon-devnotes">🛠️</div>
          <span style="font-size:0.68rem;font-weight:700;background:color-mix(in srgb, var(--status-warning) 14%, transparent);color:var(--status-warning);padding:2px 6px;border-radius:var(--radius-xs,4px)">v2.4</span>
        </div>
        <div>
          <div class="notice-source-title">Dev Notes</div>
          <div class="notice-source-sub">See recent fixes, updates, and improvements</div>
        </div>
        <div class="notice-source-action" style="color:var(--yellow)">
          <span>View Updates ↗</span>
        </div>
      </div>
    </div>

    <div class="search-input-wrapper" style="position:relative;display:flex;align-items:center">
      <span class="s-icon">${icons.search()}</span>
      <input type="text" placeholder="Search notices by title, category, or keyword…" value="${state.noticeSearch}"
        oninput="filterNotices(this.value)" id="notice-search" style="flex:1">
      <button id="notice-search-clear" onclick="filterNotices('');document.getElementById('notice-search').value='';"
        style="position:absolute;right:10px;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;line-height:0;font-size:1rem;display:${state.noticeSearch?'block':'none'}"
        title="Clear search">×</button>
    </div>
    <div id="notices-list-container">${cardsHtml}</div>
  `;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ── Study Vault (Resources & Daily Summary) ─────────────────────
function switchResourcesTab(tab) {
  state.resourcesTab = tab;
  window.location.hash = tab;
  document.querySelectorAll('[data-nav]').forEach(el => {
    const navVal = el.dataset.nav;
    el.classList.toggle('active', navVal === 'resources' || navVal === tab || (navVal === 'links' && tab === 'links'));
  });
  renderResources();
}

function renderResources() {
  const el = document.getElementById('page-resources') || document.getElementById('page-links');
  if (!el) return;

  const currentTab = state.resourcesTab || 'links';

  el.innerHTML = `
    <div class="page-header" style="margin-bottom: 16px;">
      <div>
        <div class="page-title">Study Vault &amp; Summary</div>
        <div class="page-subtitle">Course notes, syllabus documents, cloud repositories &amp; academic briefing</div>
      </div>
      ${currentTab === 'links' ? `
        <button class="btn-primary" onclick="addLinkSubject()" style="font-size:0.85rem;padding:8px 14px">+ Add Subject Vault</button>
      ` : ''}
    </div>

    <div class="resources-tab-bar" role="tablist" aria-label="Resources sections">
      <button role="tab" aria-selected="${currentTab === 'links'}" class="res-tab-btn ${currentTab === 'links' ? 'active' : ''}" onclick="switchResourcesTab('links')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
        Vault Materials
      </button>
      <button role="tab" aria-selected="${currentTab === 'summary'}" class="res-tab-btn ${currentTab === 'summary' ? 'active' : ''}" onclick="switchResourcesTab('summary')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Daily Briefing
      </button>
    </div>

    <div id="resources-subtab-content"></div>
  `;

  const contentEl = document.getElementById('resources-subtab-content');
  if (!contentEl) return;

  if (currentTab === 'links') {
    renderLinksContent(contentEl);
  } else {
    renderSummaryContent(contentEl);
  }
}

function renderLinks() {
  state.resourcesTab = 'links';
  renderResources();
}

function renderSummary() {
  state.resourcesTab = 'summary';
  renderResources();
}

function renderLinksContent(container) {
  const links = loadCustomLinks();

  if (!links || links.length === 0) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px 20px;color:var(--text-muted)">
        <div style="font-size:2.2rem;margin-bottom:12px">📚</div>
        <div style="font-weight:700;font-size:1.05rem;color:var(--text-primary);margin-bottom:6px">No Course Materials in Study Vault</div>
        <div style="font-size:0.85rem;margin-bottom:20px;max-width:380px;margin-left:auto;margin-right:auto">Attach notes, syllabus PDFs, lab cheat sheets, and cloud drive folders per subject for 1-click access.</div>
        <button class="btn-primary" onclick="addLinkSubject()" style="font-size:0.85rem">+ Create Your First Subject Vault</button>
      </div>
    `;
    return;
  }

  const subjectsHtml = links.map((s, si) => `
    <div class="link-subject-card" id="link-card-${si}">
      <div class="link-subject-header">
        <span class="link-color-dot" style="background:${s.color || '#394B63'}"></span>
        <span class="link-subject-title" title="${s.subject}">${s.subject}</span>
        <span class="link-code">${s.code}</span>
        <div class="link-subject-actions">
          <button class="icon-btn-sm" onclick="editLinkSubject(${si})" title="Edit subject" aria-label="Edit subject">✏️</button>
          <button class="icon-btn-sm icon-btn-danger" onclick="deleteLinkSubject(${si})" title="Delete subject" aria-label="Delete subject">🗑</button>
        </div>
      </div>

      <div class="link-resources">
        ${s.resources.length === 0 ? `
          <div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;padding:8px 0">No materials attached yet. Click below to add files or links.</div>
        ` : s.resources.map((r, ri) => {
          const isUploaded = r.isUpload || (r.url && r.url.startsWith('data:'));
          return `
          <div class="resource-item-row">
            <a class="resource-link" href="${r.url}" ${isUploaded ? `download="${r.label}"` : 'target="_blank" rel="noopener"'} title="${isUploaded ? 'Click to download ' + r.label : r.url}">
              <span class="r-icon">${getResourceIcon(r.icon || 'book-open')}</span>
              <span class="resource-label" title="${r.label}">${r.label}</span>
              ${r.fileSize ? `<span class="type-badge" style="font-size:0.62rem;padding:1px 5px;background:var(--surface-2);color:var(--text-muted);margin-left:4px">${r.fileSize}</span>` : ''}
              ${isUploaded ? `<span style="font-size:0.75rem;margin-left:auto;color:var(--accent)">📥</span>` : `<span style="font-size:0.75rem;margin-left:auto;color:var(--text-muted)">↗</span>`}
            </a>
            <div class="resource-actions">
              <button class="icon-btn-xs" onclick="editLinkResource(${si},${ri})" title="Edit resource" aria-label="Edit resource">✏️</button>
              <button class="icon-btn-xs icon-btn-danger" onclick="deleteLinkResource(${si},${ri})" title="Delete resource" aria-label="Delete resource">✕</button>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div style="padding: 10px 16px 14px;">
        <button class="btn-add-resource" onclick="addLinkResource(${si})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Vault Material / Upload
        </button>
      </div>
    </div>`).join('');

  container.innerHTML = `<div class="links-grid">${subjectsHtml}</div>`;
}

window.addLinkSubject = function() {
  showLinkSubjectModal(null, null);
};

window.openAddResourceForSubject = function(subjectName, subjectCode = '') {
  const links = loadCustomLinks();
  const cleanName = (subjectName || '').trim();
  const cleanCode = (subjectCode || '').trim();
  const matchedIdx = links.findIndex(l => 
    (l.subject || '').toLowerCase() === cleanName.toLowerCase() || 
    (cleanCode && (l.code || '').toLowerCase() === cleanCode.toLowerCase())
  );

  if (matchedIdx !== -1) {
    showLinkResourceModal(matchedIdx, null, null);
  } else {
    showLinkSubjectModal(null, {
      subject: cleanName,
      code: cleanCode || (cleanName ? cleanName.slice(0, 4).toUpperCase() : '')
    });
  }
};

window.editLinkSubject = function(si) {
  const links = loadCustomLinks();
  showLinkSubjectModal(si, links[si]);
};

window.deleteLinkSubject = function(si) {
  if (!confirm('Delete this subject and all its materials?')) return;
  const links = loadCustomLinks();
  links.splice(si, 1);
  saveCustomLinks(links);
  showToast('Subject removed from vault', 'info');
  renderLinks();
};

window.addLinkResource = function(si) {
  showLinkResourceModal(si, null, null);
};

window.editLinkResource = function(si, ri) {
  const links = loadCustomLinks();
  showLinkResourceModal(si, ri, links[si].resources[ri]);
};

window.deleteLinkResource = function(si, ri) {
  if (!confirm('Delete this resource?')) return;
  const links = loadCustomLinks();
  links[si].resources.splice(ri, 1);
  saveCustomLinks(links);
  showToast('Material removed from vault', 'info');
  renderLinks();
};

function showLinkSubjectModal(si, existing) {
  document.getElementById('link-subject-modal-backdrop')?.remove();
  const isNew = si === null;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'link-subject-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:400px;width:92vw">
      <div class="modal-header">
        <span class="modal-title">${isNew ? 'Create Subject Vault' : 'Edit Subject Vault'}</span>
        <button class="modal-close" onclick="document.getElementById('link-subject-modal-backdrop')?.remove()">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label class="form-label">Subject Name <span style="color:var(--red)">*</span></label>
          <input id="lsm-name" class="form-input" value="${existing?.subject || ''}" placeholder="e.g. Data Structures &amp; Algorithms" />
        </div>
        <div>
          <label class="form-label">Short Code</label>
          <input id="lsm-code" class="form-input" value="${existing?.code || ''}" placeholder="e.g. DSA" />
        </div>
        <div>
          <label class="form-label">Color Indicator</label>
          <input id="lsm-color" type="color" value="${existing?.color || '#394B63'}" style="width:60px;height:36px;border:none;cursor:pointer;background:none" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('link-subject-modal-backdrop')?.remove()">Cancel</button>
        <button class="btn-primary" onclick="saveLinkSubject(${si === null ? 'null' : si})">Save Vault</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

window.saveLinkSubject = function(si) {
  const nameEl = document.getElementById('lsm-name');
  const name  = nameEl?.value?.trim();
  const code  = document.getElementById('lsm-code')?.value?.trim();
  const color = document.getElementById('lsm-color')?.value || '#394B63';
  if (!name) {
    if (nameEl) { nameEl.classList.add('error', 'shake'); nameEl.focus(); }
    showToast('Subject name is required.', 'error');
    return;
  }
  const links = loadCustomLinks();
  if (si === null) {
    links.push({ subject: name, code: code || name.slice(0,4).toUpperCase(), color, resources: [] });
  } else {
    links[si] = { ...links[si], subject: name, code: code || links[si].code, color };
  }
  saveCustomLinks(links);
  document.getElementById('link-subject-modal-backdrop')?.remove();
  showToast('Subject vault saved ✓', 'success');
  renderLinks();
};

window.handleVaultFileSelect = function(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const dataUrl = evt.target.result;
    const urlEl = document.getElementById('lrm-url');
    const labelEl = document.getElementById('lrm-label');
    const fileLabel = document.getElementById('lrm-file-label');
    const iconEl = document.getElementById('lrm-icon');

    if (urlEl) urlEl.value = dataUrl;
    if (labelEl && !labelEl.value) labelEl.value = file.name;
    if (fileLabel) fileLabel.innerHTML = `✓ <strong>${file.name}</strong> (${formatBytes(file.size)})`;

    // Auto-detect icon
    const ext = file.name.split('.').pop().toLowerCase();
    if (['pdf', 'doc', 'docx', 'txt', 'ppt', 'pptx'].includes(ext) && iconEl) iconEl.value = 'book-open';
    else if (['py', 'js', 'cpp', 'c', 'java', 'html', 'css', 'zip'].includes(ext) && iconEl) iconEl.value = 'code';
    else if (['mp4', 'mov', 'avi', 'mkv'].includes(ext) && iconEl) iconEl.value = 'video';
    
    window._uploadedFileMeta = {
      isUpload: true,
      fileName: file.name,
      fileSize: formatBytes(file.size)
    };
    showToast(`File attached: ${file.name} ✓`, 'success');
  };
  reader.readAsDataURL(file);
};

window.setResourceInputMode = function(mode) {
  const fileSec = document.getElementById('lrm-file-section');
  const urlSec = document.getElementById('lrm-url-section');
  const fileBtn = document.getElementById('lrm-mode-file-btn');
  const urlBtn = document.getElementById('lrm-mode-url-btn');

  if (mode === 'file') {
    if (fileSec) fileSec.style.display = 'block';
    if (urlSec) urlSec.style.display = 'none';
    if (fileBtn) { fileBtn.className = 'btn btn-sm btn-primary'; }
    if (urlBtn) { urlBtn.className = 'btn btn-sm btn-secondary'; }
  } else {
    if (fileSec) fileSec.style.display = 'none';
    if (urlSec) urlSec.style.display = 'block';
    if (fileBtn) { fileBtn.className = 'btn btn-sm btn-secondary'; }
    if (urlBtn) { urlBtn.className = 'btn btn-sm btn-primary'; }
  }
};

window.autoDetectVaultIcon = function(url) {
  const iconEl = document.getElementById('lrm-icon');
  if (!iconEl || !url) return;
  const u = url.toLowerCase();
  if (u.includes('drive.google.com') || u.includes('dropbox') || u.includes('onedrive')) iconEl.value = 'database';
  else if (u.includes('github.com') || u.includes('gitlab') || u.includes('codepen') || u.includes('replit')) iconEl.value = 'code';
  else if (u.includes('youtube.com') || u.includes('youtu.be') || u.includes('vimeo')) iconEl.value = 'video';
  else if (u.includes('notion.so') || u.includes('docs.google.com') || u.includes('.pdf')) iconEl.value = 'book-open';
};

function showLinkResourceModal(si, ri, existing) {
  document.getElementById('link-resource-modal-backdrop')?.remove();
  const isNew = ri === null;
  const isUpload = existing?.isUpload || (existing?.url && existing.url.startsWith('data:'));
  window._uploadedFileMeta = isUpload ? { isUpload: true, fileSize: existing.fileSize } : null;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'link-resource-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:440px;width:92vw" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span class="modal-title">${isNew ? 'Add Vault Material' : 'Edit Vault Material'}</span>
        <button class="modal-close" onclick="document.getElementById('link-resource-modal-backdrop')?.remove()">✕</button>
      </div>

      <div style="display:flex;gap:6px;margin-bottom:14px;background:var(--surface-2);padding:4px;border-radius:var(--radius-sm)">
        <button type="button" class="btn btn-sm ${!isUpload ? 'btn-primary' : 'btn-secondary'}" id="lrm-mode-url-btn" onclick="setResourceInputMode('url')" style="flex:1;padding:6px;font-size:0.8rem">🔗 Web / Cloud Link</button>
        <button type="button" class="btn btn-sm ${isUpload ? 'btn-primary' : 'btn-secondary'}" id="lrm-mode-file-btn" onclick="setResourceInputMode('file')" style="flex:1;padding:6px;font-size:0.8rem">📁 Upload Document</button>
      </div>

      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div id="lrm-file-section" style="display:${isUpload ? 'block' : 'none'}">
          <label class="form-label">Attach File / Note (PDF, Doc, Image, Code)</label>
          <input type="file" id="lrm-file-input" style="display:none" onchange="handleVaultFileSelect(event)" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.zip,.py,.java,.cpp,.c,.js">
          <div class="card" onclick="document.getElementById('lrm-file-input').click()" style="text-align:center;padding:20px;border:2px dashed var(--border);border-radius:var(--radius-sm);cursor:pointer;background:var(--surface-2)">
            <div style="font-size:1.6rem;margin-bottom:6px">📥</div>
            <div id="lrm-file-label" style="font-size:0.86rem;font-weight:600;color:var(--text-primary)">
              ${existing?.label && isUpload ? `✓ <strong>${existing.label}</strong> (${existing.fileSize || 'Attached File'})` : 'Click to select note, PDF, slide, or code file'}
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">Saved persistently to your local Study Vault</div>
          </div>
        </div>

        <div>
          <label class="form-label">Material Name / Title <span style="color:var(--red)">*</span></label>
          <input id="lrm-label" class="form-input" value="${existing?.label || ''}" placeholder="e.g. Unit 2 Summary Notes or Lab Manual PDF" />
        </div>

        <div id="lrm-url-section" style="display:${!isUpload ? 'block' : 'none'}">
          <label class="form-label">URL / Cloud Folder <span style="color:var(--red)">*</span></label>
          <input id="lrm-url" class="form-input" type="url" value="${existing?.url || ''}" placeholder="https://drive.google.com/... or GitHub link" oninput="autoDetectVaultIcon(this.value)" />
        </div>

        <div>
          <label class="form-label">Category Icon</label>
          <select id="lrm-icon" class="form-input">
            ${['book-open','code','video','graduation-cap','database','link','eye','list'].map(ic =>
              `<option value="${ic}" ${(existing?.icon||'book-open')===ic?'selected':''}>${ic === 'book-open' ? '📖 Notes / PDF' : ic === 'code' ? '💻 Code / Repo' : ic === 'video' ? '🎥 Lecture Video' : ic === 'graduation-cap' ? '🎓 Syllabus / Guide' : ic === 'database' ? '🗄️ Cloud Drive' : '🔗 Web Resource'}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="modal-footer" style="margin-top:16px">
        <button class="btn-secondary" onclick="document.getElementById('link-resource-modal-backdrop')?.remove()">Cancel</button>
        <button class="btn-primary" onclick="saveLinkResource(${si},${ri === null ? 'null' : ri})">Save Material</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

window.saveLinkResource = function(si, ri) {
  const labelEl = document.getElementById('lrm-label');
  const urlEl   = document.getElementById('lrm-url');
  const label = labelEl?.value?.trim();
  const url   = urlEl?.value?.trim();
  const icon  = document.getElementById('lrm-icon')?.value || 'book-open';
  const meta  = window._uploadedFileMeta || {};

  [labelEl, urlEl].forEach(el => el?.classList.remove('error', 'shake'));

  if (!label || !url) {
    if (!label && labelEl) { labelEl.classList.add('error', 'shake'); labelEl.focus(); }
    else if (!url && urlEl) { urlEl.classList.add('error', 'shake'); urlEl.focus(); }
    showToast('Resource name and file/link are required.', 'error');
    return;
  }
  const links = loadCustomLinks();
  const item = {
    label,
    url,
    icon,
    isUpload: !!meta.isUpload || url.startsWith('data:'),
    fileSize: meta.fileSize || (url.startsWith('data:') ? formatBytes(url.length * 0.75) : '')
  };

  if (ri === null) {
    links[si].resources.push(item);
  } else {
    links[si].resources[ri] = item;
  }
  saveCustomLinks(links);
  document.getElementById('link-resource-modal-backdrop')?.remove();
  showToast('Study vault material saved ✓', 'success');
  renderLinks();
};

function renderSummaryContent(container) {
  const today    = new Date();
  const todayDay = today.getDay();
  const classes  = loadTimetable()[todayDay] || [];
  const dueTodayItems = allTasks().filter(a => !a.noDeadline && a.dueDate === todayStr() && a.status === 'pending');
  const importantNotices = NOTICES.filter(n => n.important).slice(0, 3);
  const overdueItems = allTasks().filter(a => isTaskOverdue(a));
  const ongoingMissions = allTasks().filter(a => a.status === 'pending' && (a.taskType === 'mission' || !!a.noDeadline));
  const currentMin   = currentTimeMinutes();
  const remaining    = classes.filter(c => c.type !== 'off' && c.subject !== 'Recess' && timeToMinutes(c.end || '23:59') > currentMin);
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;background:var(--surface);padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm)">
      <div style="font-weight:600;font-size:0.88rem;color:var(--text-secondary)">📅 Today's Date</div>
      <div style="font-weight:700;font-size:0.88rem;color:var(--accent)">${DAY_NAMES[todayDay]}, ${today.getDate()} ${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}</div>
    </div>

    <div class="section-heading">Today's Schedule</div>
    ${classes.length === 0
      ? '<div class="card" style="text-align:center;padding:24px;color:var(--text-muted)">🏖️ No classes scheduled for today.</div>'
      : classes.map(c => {
          const isPast = currentMin >= timeToMinutes(c.end);
          return `<div class="summary-item" style="${isPast?'opacity:0.5':''}">
            <div class="summary-icon" style="background:var(--accent-dim);color:var(--brand-primary)">${icons.timetable()}</div>
            <div style="flex:1;min-width:0">
              <div class="summary-text-main" style="display:flex;align-items:center;flex-wrap:wrap;gap:6px">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.subject}</span>
                <span class="type-badge type-${c.type}">${c.type}</span>
              </div>
              <div class="summary-text-sub">${c.time}–${c.end} · ${c.room} · ${c.teacher}</div>
            </div>
          </div>`;
        }).join('')
    }

    <div class="section-heading" style="margin-top:20px">Due Today</div>
    ${dueTodayItems.length
      ? dueTodayItems.map(a => `
          <div class="summary-item">
            <div class="summary-icon" style="background:color-mix(in srgb, var(--status-warning) 12%, transparent);color:var(--status-warning)">${icons.assignments()}</div>
            <div style="flex:1;min-width:0">
              <div class="summary-text-main">${a.title}</div>
              <div class="summary-text-sub">${a.subject} · ${a.marks > 0 ? a.marks + ' marks' : 'Academic task'}</div>
            </div>
          </div>`).join('')
      : '<div class="card" style="text-align:center;padding:20px;color:var(--text-muted)">🌿 No tasks due today — all clear!</div>'
    }

    ${ongoingMissions.length ? `
      <div class="section-heading" style="margin-top:20px;color:var(--brand-secondary)">🚀 Ongoing Missions</div>
      ${ongoingMissions.map(a => `
        <div class="summary-item" style="border-left:3px solid var(--brand-secondary)">
          <div class="summary-icon" style="background:color-mix(in srgb, var(--brand-secondary) 12%, transparent);color:var(--brand-secondary)">${icons.target()}</div>
          <div style="flex:1;min-width:0">
            <div class="summary-text-main">${a.title}</div>
            <div class="summary-text-sub">${a.subject} · Standing Goal · Active</div>
          </div>
        </div>`).join('')}` : ''}

    ${overdueItems.length ? `
      <div class="section-heading" style="margin-top:20px;color:var(--status-error)">⚠ Overdue Tasks</div>
      ${overdueItems.map(a => `
        <div class="summary-item" style="border-left:3px solid var(--status-error)">
          <div class="summary-icon" style="background:color-mix(in srgb, var(--status-error) 12%, transparent);color:var(--status-error)">${icons.alert()}</div>
          <div style="flex:1;min-width:0">
            <div class="summary-text-main">${a.title}</div>
            <div class="summary-text-sub">${a.subject} · ${Math.abs(dueDaysLeft(a.dueDate) || 1)}d overdue</div>
          </div>
        </div>`).join('')}` : ''}

    <div class="section-heading" style="margin-top:20px">Key Notices</div>
    ${importantNotices.length
      ? importantNotices.map(n => `
          <div class="summary-item" onclick="showNotice('${n.id}')" style="cursor:pointer">
            <div class="summary-icon" style="background:color-mix(in srgb, var(--status-error) 12%, transparent);color:var(--status-error)">${icons.notices()}</div>
            <div style="flex:1;min-width:0">
              <div class="summary-text-main">${n.title}</div>
              <div class="summary-text-sub">${formatDate(n.date)} · ${n.category}</div>
            </div>
          </div>`).join('')
      : '<div class="card" style="text-align:center;padding:20px;color:var(--text-muted)">No urgent notices today.</div>'
    }

    <div class="section-heading" style="margin-top:20px">Quick Stats &amp; Direct Views</div>
    <div class="stat-grid" style="margin-bottom:0">
      <div class="stat-card" onclick="navigateTo('timetable')" title="Open Today's Timetable Schedule" style="cursor:pointer">
        <div class="stat-value">${remaining.length}</div>
        <div class="stat-label">Classes Remaining →</div>
      </div>
      <div class="stat-card" onclick="filterAndNavigateToAssignments('today')" title="View Tasks Due Today" style="cursor:pointer">
        <div class="stat-value" style="color:var(--yellow)">${dueTodayItems.length}</div>
        <div class="stat-label">Due Today →</div>
      </div>
      <div class="stat-card" onclick="filterAndNavigateToAssignments('overdue')" title="View Overdue Tasks Needing Action" style="cursor:pointer">
        <div class="stat-value" style="color:${overdueItems.length ? 'var(--red)' : 'var(--text-primary)'}">${overdueItems.length}</div>
        <div class="stat-label">Overdue Tasks →</div>
      </div>
      <div class="stat-card" onclick="filterAndNavigateToAssignments('submitted')" title="View Completed Tasks &amp; History" style="cursor:pointer">
        <div class="stat-value" style="color:var(--green)">${allTasks().filter(a => a.status === 'submitted').length}</div>
        <div class="stat-label">Completed Tasks →</div>
      </div>
    </div>
  `;
}

// ── Settings ────────────────────────────────────────────────
function renderSettings() {
  const el = document.getElementById('page-settings');
  if (!el) return;
  const p  = liveProfile || loadProfile() || {};
  const nPrefs = loadNotifPrefs() || {};
  const channels = loadNoticeChannels() || {};
  const notifPermission = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
  const isGranted = notifPermission === 'granted';
  const isDenied  = notifPermission === 'denied';

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Desk Settings</div>
        <div class="page-subtitle">Your student profile, notification preferences &amp; local workspace settings</div>
      </div>
    </div>

    <div class="section-heading">${icons.user()} Account &amp; Cloud Sync</div>
    <div class="card" style="padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:600;font-size:0.95rem">${currentUser ? (currentUser.displayName || currentUser.email || 'Cloud User') : 'Local Desk Mode'}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">
            ${currentUser ? `Cross-device sync active · Signed in via Google` : 'Your desk data stays in your browser storage. Sign in with Google to sync seamlessly across devices.'}
          </div>
        </div>
        <div>
          ${currentUser ? 
            `<button class="btn btn-sm btn-secondary" onclick="logoutUser()" style="color:var(--status-error);border-color:color-mix(in srgb, var(--status-error) 35%, transparent)">Sign Out</button>` : 
            `<button class="btn btn-primary" onclick="loginWithGoogle()" style="display:flex;align-items:center;gap:6px">🌐 Sign In with Google</button>`
          }
        </div>
      </div>
    </div>

    <div class="section-heading">${icons.user()} Student Profile</div>
    <div class="card" style="padding:20px;margin-bottom:16px">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:14px">Used to personalize your dashboard greeting, timetable headers, and course schedule.</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input type="text" class="form-input" id="s-name" value="${(p.name || '').replace(/"/g, '&quot;')}" placeholder="Full name (e.g. Alex Morgan)">
        </div>
        <div class="form-group">
          <label class="form-label">Student ID / Roll Number</label>
          <input type="text" class="form-input" id="s-roll" value="${(p.rollNo || '').replace(/"/g, '&quot;')}" placeholder="Student ID or Roll number (e.g. 2026/CS/042)">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">College / University / School</label>
        <input type="text" class="form-input" id="s-college" value="${(p.college || '').replace(/"/g, '&quot;')}" placeholder="College or University name">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Major / Branch / Department</label>
          <input type="text" class="form-input" id="s-branch" value="${(p.branch || '').replace(/"/g, '&quot;')}" placeholder="e.g. Computer Science, Mechanical, Biology">
        </div>
        <div class="form-group">
          <label class="form-label">Year / Semester / Term</label>
          <input type="text" class="form-input" id="s-year" value="${(p.year || '').replace(/"/g, '&quot;')}" placeholder="e.g. 3rd Semester, Year 2, Fall 2026">
        </div>
        <div class="form-group">
          <label class="form-label">Practical Batch / Section</label>
          <input type="text" class="form-input" id="s-batch" value="${(p.batch || '').replace(/"/g, '&quot;')}" placeholder="e.g. A1, A2, B2, D1">
        </div>
      </div>
    </div>

    <div class="section-heading">${icons.timetable()} Timetable Schedule Management</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">
        Manage your schedule template. You can start clean to add or scan classes for any degree/major, or load the sample Sem 3 AI-DS template.
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="resetTimetableToDefault()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px;color:var(--status-error);border-color:color-mix(in srgb, var(--status-error) 30%, transparent)">
          Clear Timetable (Start Clean)
        </button>
        <button class="btn btn-secondary" onclick="loadOfficialAidsTimetable()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px">
          📋 Load Sample SY AI-DS Template
        </button>
      </div>
    </div>

    <div class="section-heading">${icons.timetable()} Mid-Semester Attendance Baseline</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">
        Started using Clarity Desk mid-semester? Manually enter your current college portal / ERP attendance counts per subject. Future attendance marked in your timetable will calculate continuously from this baseline.
      </div>
      <button class="btn-secondary" onclick="showBaselineModal()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px">
        📊 Configure Attendance Baselines →
      </button>
    </div>

    <div class="section-heading">🧹 Personalized Desk Optimization</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">
        Did an earlier timetable import or photo scan create duplicate, noisy, or other-batch subject cards? Clean up and normalize your Subject Hubs, timetable slots, and attendance records to match your specific practical batch.
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn-primary" onclick="showDeclutterDeskModal()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:8px 16px">
          🧹 Declutter my desk →
        </button>
        ${(() => {
          const b = loadDeclutterBackup();
          if (b && b.timestamp) {
            return `
              <button class="btn-secondary" onclick="showRestoreDeskModal()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:8px 16px;color:var(--text-secondary)">
                ↩ Restore Previous Desk (${new Date(b.timestamp).toLocaleDateString()})
              </button>
            `;
          }
          return '';
        })()}
      </div>
    </div>

    <div class="section-heading">${icons.clock()} Academic Goals & Countdown</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">End-Semester Exam Date</label>
          <input type="date" class="form-input" id="s-exam-date" value="${p.examDate || ''}" style="max-width:240px">
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">
            Shows a calm daily countdown on your dashboard once set.
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Attendance Target (%)</label>
          <input type="number" class="form-input" id="s-att-target" value="${getAttendanceTarget()}" min="50" max="100" step="1" style="max-width:120px">
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">
            Minimum attendance % to maintain. Default is 75% (most colleges).
          </div>
        </div>
      </div>
    </div>

    <div class="section-heading">${icons.layers()} Appearance</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" style="margin-bottom:6px">Workspace Environment &amp; Theme</label>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:14px">Six curated palettes with distinct atmospheres. Saves automatically and syncs to cloud.</div>
        <div class="theme-swatch-grid" role="group" aria-label="Theme selection options">
          <button type="button" class="theme-swatch ${(document.documentElement?.getAttribute('data-theme') || 'paper-slate') === 'paper-slate' ? 'active' : ''}" onclick="setTheme('paper-slate')" aria-pressed="${(document.documentElement?.getAttribute('data-theme') || 'paper-slate') === 'paper-slate'}" aria-label="Paper Slate theme: Clean neutral academic palette">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#F6F1E8"></div>
              <div class="swatch-surface" style="background:#FFFDFC"></div>
              <div class="swatch-accent" style="background:#2F4A3D"></div>
            </div>
            <span class="swatch-name">Paper Slate</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'midnight-ink' ? 'active' : ''}" onclick="setTheme('midnight-ink')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'midnight-ink'}" aria-label="Midnight Ink theme: Obsidian dark with electric indigo">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#171412"></div>
              <div class="swatch-surface" style="background:#221D19"></div>
              <div class="swatch-accent" style="background:#7E9C8D"></div>
            </div>
            <span class="swatch-name">Midnight Ink</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'espresso-desk' ? 'active' : ''}" onclick="setTheme('espresso-desk')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'espresso-desk'}" aria-label="Espresso Desk theme: Cozy café dark mahogany and caramel">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#171310"></div>
              <div class="swatch-surface" style="background:#221b16"></div>
              <div class="swatch-accent" style="background:#D2A56B"></div>
            </div>
            <span class="swatch-name">Espresso Desk</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'sandstone-notes' ? 'active' : ''}" onclick="setTheme('sandstone-notes')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'sandstone-notes'}" aria-label="Sandstone Notes theme: Warm parchment and terracotta">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#f5f0e6"></div>
              <div class="swatch-surface" style="background:#fffdfa"></div>
              <div class="swatch-accent" style="background:#B48852"></div>
            </div>
            <span class="swatch-name">Sandstone Notes</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'nordic-frost' ? 'active' : ''}" onclick="setTheme('nordic-frost')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'nordic-frost'}" aria-label="Nordic Frost theme: Crisp glacial ice and azure">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#eaf0f6"></div>
              <div class="swatch-surface" style="background:#ffffff"></div>
              <div class="swatch-accent" style="background:#394B63"></div>
            </div>
            <span class="swatch-name">Nordic Frost</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'misty-mint' ? 'active' : ''}" onclick="setTheme('misty-mint')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'misty-mint'}" aria-label="Misty Mint theme: Light eucalyptus and sage">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#f0f5f3"></div>
              <div class="swatch-surface" style="background:#ffffff"></div>
              <div class="swatch-accent" style="background:#4E7A5D"></div>
            </div>
            <span class="swatch-name">Misty Mint</span>
          </button>
        </div>
      </div>
    </div>

    <div class="section-heading">${icons.bell()} Notifications &amp; Study Alerts</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;padding-bottom:14px;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary)">Browser Notification Permission</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">
            Status: <strong style="color:${isGranted ? 'var(--green)' : isDenied ? 'var(--red)' : 'var(--yellow)'}">
              ${isGranted ? 'Granted ✓' : isDenied ? 'Blocked ✕' : 'Not Requested'}
            </strong>
          </div>
        </div>
        <button class="btn btn-sm ${isGranted ? 'btn-secondary' : 'btn-primary'}" onclick="requestNotificationPermission()">
          ${isGranted ? 'Test Notification' : isDenied ? 'Re-check Permission' : 'Enable Notifications'}
        </button>
      </div>

      ${isDenied ? `
      <div style="margin-bottom:16px;font-size:0.78rem;color:var(--status-error);background:color-mix(in srgb, var(--status-error) 8%, var(--bg-surface));padding:10px 12px;border-radius:var(--radius-xs,6px);border:1px solid color-mix(in srgb, var(--status-error) 25%, transparent);line-height:1.5;display:flex;align-items:flex-start;gap:8px">
        <span style="font-size:0.9rem">🔒</span>
        <div>
          <strong>Notifications are blocked by your browser.</strong> To receive alerts, click the lock or tune icon (🔒) near your browser address bar, set <strong>Notifications</strong> to <strong>Allow</strong>, and click <strong>Re-check Permission</strong>.
        </div>
      </div>` : ''}

      <div style="display:flex;flex-direction:column;gap:14px">
        <div style="font-weight:700;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted)">Task Deadlines</div>
        
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.88rem;gap:12px;flex-wrap:wrap">
          <div>
            <span style="font-weight:500;color:var(--text-primary)">Upcoming Tasks</span>
            <div style="font-size:0.75rem;color:var(--text-muted)">Remind about pending assignments</div>
          </div>
          <select class="form-select" id="np-task-upcoming" style="width:170px;padding:5px 8px;font-size:0.82rem">
            <option value="day_before" ${nPrefs.taskUpcoming === 'day_before' ? 'selected' : ''}>Day Before (09:00)</option>
            <option value="same_day" ${nPrefs.taskUpcoming === 'same_day' ? 'selected' : ''}>Same Day (Morning)</option>
            <option value="off" ${nPrefs.taskUpcoming === 'off' ? 'selected' : ''}>Off</option>
          </select>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.88rem;gap:12px;flex-wrap:wrap">
          <div>
            <span style="font-weight:500;color:var(--text-primary)">Overdue Tasks</span>
            <div style="font-size:0.75rem;color:var(--text-muted)">Alert when tasks pass due date</div>
          </div>
          <select class="form-select" id="np-task-overdue" style="width:170px;padding:5px 8px;font-size:0.82rem">
            <option value="same_day" ${nPrefs.taskOverdue === 'same_day' ? 'selected' : ''}>Daily Reminder</option>
            <option value="instant" ${nPrefs.taskOverdue === 'instant' ? 'selected' : ''}>Instant Alert</option>
            <option value="off" ${nPrefs.taskOverdue === 'off' ? 'selected' : ''}>Off</option>
          </select>
        </div>

        <div style="font-weight:700;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-top:6px">Classes & Attendance</div>

        <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.88rem;gap:12px;flex-wrap:wrap">
          <div>
            <span style="font-weight:500;color:var(--text-primary)">Class Reminders</span>
            <div style="font-size:0.75rem;color:var(--text-muted)">Notify before upcoming classes</div>
          </div>
          <select class="form-select" id="np-class-reminders" style="width:170px;padding:5px 8px;font-size:0.82rem">
            <option value="15_min" ${nPrefs.classReminders === '15_min' ? 'selected' : ''}>15 Minutes Before</option>
            <option value="30_min" ${nPrefs.classReminders === '30_min' ? 'selected' : ''}>30 Minutes Before</option>
            <option value="1_hour" ${nPrefs.classReminders === '1_hour' ? 'selected' : ''}>1 Hour Before</option>
            <option value="off" ${nPrefs.classReminders === 'off' ? 'selected' : ''}>Off</option>
          </select>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.88rem;gap:12px;flex-wrap:wrap">
          <div>
            <span style="font-weight:500;color:var(--text-primary)">Low-Attendance Alerts</span>
            <div style="font-size:0.75rem;color:var(--text-muted)">Alert if attendance drops below target (${getAttendanceTarget()}%)</div>
          </div>
          <select class="form-select" id="np-attendance-alerts" style="width:170px;padding:5px 8px;font-size:0.82rem">
            <option value="instant" ${nPrefs.attendanceAlerts === 'instant' ? 'selected' : ''}>Instant Alert (&lt; ${getAttendanceTarget()}%)</option>
            <option value="weekly" ${nPrefs.attendanceAlerts === 'weekly' ? 'selected' : ''}>Weekly Summary Only</option>
            <option value="off" ${nPrefs.attendanceAlerts === 'off' ? 'selected' : ''}>Off</option>
          </select>
        </div>

        <div style="font-weight:700;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-top:6px">Notices & Summaries</div>

        <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.88rem;gap:12px;flex-wrap:wrap">
          <div>
            <span style="font-weight:500;color:var(--text-primary)">New Notices</span>
            <div style="font-size:0.75rem;color:var(--text-muted)">Alerts for admin announcements</div>
          </div>
          <select class="form-select" id="np-new-notices" style="width:170px;padding:5px 8px;font-size:0.82rem">
            <option value="instant" ${nPrefs.newNotices === 'instant' ? 'selected' : ''}>Instant Alert</option>
            <option value="same_day" ${nPrefs.newNotices === 'same_day' ? 'selected' : ''}>Daily Overview</option>
            <option value="off" ${nPrefs.newNotices === 'off' ? 'selected' : ''}>Off</option>
          </select>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.88rem;gap:12px;flex-wrap:wrap">
          <div>
            <span style="font-weight:500;color:var(--text-primary)">Daily Briefing Time</span>
            <div style="font-size:0.75rem;color:var(--text-muted)">Preferred morning notification time</div>
          </div>
          <input type="time" class="form-input" id="np-summary-time" value="${nPrefs.dailySummaryTime || '08:00'}" style="width:130px;padding:4px 8px;font-size:0.85rem">
        </div>
      </div>
    </div>

    <div class="section-heading">📢 Notice Channels &amp; Class Communities</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:14px">
        Customize your department notice portal link and batch WhatsApp community invite link for quick access on your Notice Board.
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Official Channel Card Title</label>
          <input type="text" class="form-input" id="nc-official-title" value="${(channels.officialTitle || 'Official Updates').replace(/"/g, '&quot;')}" placeholder="e.g. Official Updates or College Portal">
        </div>
        <div class="form-group">
          <label class="form-label">Official Channel Link / Portal URL</label>
          <input type="url" class="form-input" id="nc-official-url" value="${(channels.officialUrl || '').replace(/"/g, '&quot;')}" placeholder="https://college.edu/notices or portal link">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">WhatsApp Community Card Title</label>
          <input type="text" class="form-input" id="nc-wa-title" value="${(channels.whatsappTitle || 'Class Community').replace(/"/g, '&quot;')}" placeholder="e.g. Class Community or Batch 2026">
        </div>
        <div class="form-group">
          <label class="form-label">Group Invite Link or Admin Contact</label>
          <input type="url" class="form-input" id="nc-wa-url" value="${(channels.whatsappUrl || '').replace(/"/g, '&quot;')}" placeholder="https://chat.whatsapp.com/... or https://wa.me/...">
        </div>
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;line-height:1.4">
        💡 Links open in WhatsApp where you can preview group details, submit join requests, or contact the group admin.
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
      <button class="btn-primary" onclick="saveSettings()" style="display:flex;align-items:center;gap:6px">
        ${icons.save()} Save Changes
      </button>
      <span id="settings-saved" style="display:none;align-items:center;gap:6px;color:var(--green);font-size:0.85rem;font-weight:500">
        ${icons.check()} Saved
      </span>
    </div>

    <div class="section-heading">${icons.trash()} Data &amp; Backup</div>
    <div class="card" style="padding:18px">
      <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.6">
        Your desk data (profile, custom schedule, tasks, attendance records, notice sources) stays private and stored locally in this browser.
        You can export a portable JSON backup anytime.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="exportData()" style="display:flex;align-items:center;gap:6px">
          Export Desk Backup (.json)
        </button>
        <button class="btn-secondary" onclick="document.getElementById('import-file-input').click()" style="display:flex;align-items:center;gap:6px">
          Restore Backup (.json)
        </button>
        <input type="file" id="import-file-input" accept=".json" style="display:none" onchange="importData(event)">
        <button class="btn btn-secondary" onclick="confirmClearTasks()"
          style="color:var(--status-error);border-color:color-mix(in srgb, var(--status-error) 35%, transparent)">
          Clear All Custom Tasks
        </button>
      </div>
    </div>
  `;
}

function saveSettings() {
  const nameToSave = (document.getElementById('s-name')?.value || '').trim();
  const rawCollege = (document.getElementById('s-college')?.value || '').trim();
  const rawBranch  = (document.getElementById('s-branch')?.value || '').trim();
  const rawYear    = (document.getElementById('s-year')?.value || '').trim();
  const rawRoll    = (document.getElementById('s-roll')?.value || '').trim();
  const rawBatch   = (document.getElementById('s-batch')?.value || '').trim();

  const profile = {
    name:     nameToSave,
    college:  (rawCollege.toLowerCase() === 'your college' || rawCollege.toLowerCase() === 'your university') ? '' : rawCollege,
    branch:   (rawBranch.toLowerCase() === 'your branch' || rawBranch.toLowerCase() === 'your major' || rawBranch.toLowerCase() === 'your department') ? '' : rawBranch,
    year:     (rawYear.toLowerCase() === 'your year' || rawYear.toLowerCase() === 'your semester' || rawYear.toLowerCase() === 'your term') ? '' : rawYear,
    rollNo:   (rawRoll.toLowerCase() === 'your roll no.' || rawRoll.toLowerCase() === 'your roll number' || rawRoll.toLowerCase() === 'your student id') ? '' : rawRoll,
    batch:    (rawBatch.toLowerCase() === 'your batch' || rawBatch.toLowerCase() === 'batch') ? '' : rawBatch,
    examDate: document.getElementById('s-exam-date')?.value || '',
  };
  safeSetStorage(KEY_PROFILE, profile);
  Object.assign(liveProfile, profile);

  // Save attendance target separately (not part of profile)
  const attTargetRaw = parseInt(document.getElementById('s-att-target')?.value || '75', 10);
  const attTargetSafe = (isNaN(attTargetRaw) || attTargetRaw < 50 || attTargetRaw > 100) ? 75 : attTargetRaw;
  safeSetStorage(KEY_ATT_TARGET, attTargetSafe);

  const nPrefs = {
    taskUpcoming: document.getElementById('np-task-upcoming')?.value || 'day_before',
    taskOverdue: document.getElementById('np-task-overdue')?.value || 'same_day',
    classReminders: document.getElementById('np-class-reminders')?.value || '15_min',
    attendanceAlerts: document.getElementById('np-attendance-alerts')?.value || 'instant',
    newNotices: document.getElementById('np-new-notices')?.value || 'instant',
    dailySummaryTime: document.getElementById('np-summary-time')?.value || '08:00',
  };
  saveNotifPrefs(nPrefs);

  const offTitleEl = document.getElementById('nc-official-title');
  const offUrlEl   = document.getElementById('nc-official-url');
  const waTitleEl  = document.getElementById('nc-wa-title');
  const waUrlEl    = document.getElementById('nc-wa-url');
  if (offTitleEl || waTitleEl) {
    const channels = {
      officialTitle: (offTitleEl ? offTitleEl.value : '').trim() || 'Official Updates',
      officialUrl:   (offUrlEl ? offUrlEl.value : '').trim(),
      whatsappTitle: (waTitleEl ? waTitleEl.value : '').trim() || 'Class Community',
      whatsappUrl:   (waUrlEl ? waUrlEl.value : '').trim()
    };
    saveNoticeChannels(channels);
  }

  // Show "Saved" feedback
  const saved = document.getElementById('settings-saved');
  if (saved) {
    saved.style.display = 'inline-flex';
    setTimeout(() => { saved.style.display = 'none'; }, 2500);
  }

  // Refresh topbar avatar / name
  updateTopbarProfile();
  setupFABDrag();
  syncToCloud();
  showToast('Settings saved ✓', 'success');
}

function saveNoticeChannelsFromSettings() {
  saveSettings();
}

function exportData() {
  const data = {
    profile:            loadProfile(),
    customTasks:        state.customTasks,
    assignmentStatuses: safeGetStorage(KEY_ASSIGNMENTS, {}),
    notificationPrefs:  loadNotifPrefs(),
    noticeChannels:     loadNoticeChannels(),
    theme:              localStorage.getItem(KEY_THEME) || 'paper-slate',
    exportedAt:         new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `clarity-desk-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded ✓', 'success');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') throw new Error('Invalid JSON format');

      if (data.profile) safeSetStorage(KEY_PROFILE, data.profile);
      if (Array.isArray(data.customTasks)) {
        state.customTasks = data.customTasks;
        saveCustomTasks();
      }
      if (data.assignmentStatuses) {
        safeSetStorage(KEY_ASSIGNMENTS, data.assignmentStatuses);
        state.assignments = loadAssignments();
      }
      if (data.notificationPrefs) {
        safeSetStorage(KEY_NOTIF_PREFS, data.notificationPrefs);
      }
      if (data.noticeChannels && typeof data.noticeChannels === 'object') {
        saveNoticeChannels(data.noticeChannels);
      }
      if (data.theme) {
        localStorage.setItem(KEY_THEME, data.theme);
        initTheme();
      }

      updateTopbarProfile();
      setupFABDrag();
      updateNavBadges();
      showToast('Desk data restored ✓', 'success');
      renderSettings();
    } catch (err) {
      showToast('Could not read backup file. Please select a valid Clarity Desk JSON backup.', 'error');
    }
  };
  reader.readAsText(file);
}

function confirmClearTasks() {
  if (!confirm(`Delete all ${state.customTasks.length} custom task(s)? This cannot be undone.`)) return;
  state.customTasks = [];
  saveCustomTasks();
  updateNavBadges();
  renderSettings(); // re-render to update counts
}

// ── Notice Modal ──────────────────────────────────────────────
function showNotice(id) {
  const n = NOTICES.find(x => x.id === id);
  if (!n) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const whatsappText = `📢 *${n.title}*\n\n${n.content}\n\n🗓️ Date: ${formatDate(n.date)} (${n.category})\n— Shared via Clarity Desk`;
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`;

  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:500px;width:92vw">
      <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">${icons.x()}</button>
      <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div>
          <span class="cat-badge cat-${n.category}">${n.category}</span>
          ${n.important ? '<span class="cat-badge" style="background:color-mix(in srgb, var(--status-error) 12%, transparent);color:var(--status-error);margin-left:6px">Important</span>' : ''}
        </div>
        <span style="font-size:0.75rem;color:var(--text-muted)">${formatDate(n.date)}</span>
      </div>
      <h2 style="font-size:1.15rem;font-weight:700;margin-bottom:10px;line-height:1.4">${n.title}</h2>
      <p style="font-size:0.9rem;line-height:1.7;color:var(--text-secondary);margin-bottom:20px;white-space:pre-line">${n.content}</p>
      
      <div class="modal-footer" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:14px;border-top:1px solid var(--border);flex-wrap:wrap">
        <a href="${whatsappUrl}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#25D366;border-color:#25D366;color:#ffffff;display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:var(--radius-xs,6px);font-size:0.8rem;text-decoration:none;font-weight:700">
          <span>💬</span> Share to Class Group ↗
        </a>
        <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText('${n.title.replace(/'/g, "\\'")}\\n\\n${n.content.replace(/'/g, "\\'")}').then(() => showToast('Notice copied to clipboard ✓', 'success'))" style="font-size:0.8rem;padding:6px 12px">
          📋 Copy Notice
        </button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', () => backdrop.remove());
  document.body.appendChild(backdrop);

  // Close on Esc
  const escHandler = (e) => {
    if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
}

const DEV_UPDATES = [
  {
    id: 'u1',
    date: '2026-08-08',
    title: 'Study Vault & File Attachment Engine',
    category: 'Study Vault',
    tag: 'Feature',
    tagColor: 'var(--accent)',
    summary: 'Direct note, syllabus PDF, and lab manual uploads with offline storage and 1-click downloads.',
    points: [
      'Upload PDFs, lecture slides, lab manuals, and code files directly from your device.',
      'Auto-extracted file sizes and instant downloads saved offline to your browser storage.',
      'Renamed Study Links to Study Vault for a calmer, student-first course workspace.'
    ]
  },
  {
    id: 'u2',
    date: '2026-08-08',
    title: 'Smart Attendance Streaks & Safe Bunk Calculator',
    category: 'Attendance',
    tag: 'Improvement',
    tagColor: 'var(--green)',
    summary: 'Natural college terminology with active streak counter and safe bunk guidance.',
    points: [
      'Replaced rigid buttons with authentic student actions (Attended ✓ / Bunked ✕).',
      'Active streak counter (🔥) with milestone celebration feedback.',
      'Real-time safe bunk status calculating how many classes you can afford to miss.'
    ]
  },
  {
    id: 'u3',
    date: '2026-08-08',
    title: 'Custom Notice Channels & WhatsApp Integration',
    category: 'Notices',
    tag: 'Integration',
    tagColor: '#25D366',
    summary: 'Quick-access linked cards for official updates, class WhatsApp groups, and circulars.',
    points: [
      'Soft linked cards for your Official Class Group and WhatsApp channels.',
      '1-tap WhatsApp forward button formats notices for immediate class group sharing.',
      'Copy Notice action for easy pasting into student chats and channels.'
    ]
  },
  {
    id: 'u4',
    date: '2026-08-07',
    title: 'Expanded Desktop Layout & Breathability',
    category: 'Dashboard',
    tag: 'Design',
    tagColor: 'var(--yellow)',
    summary: 'Wider desktop container and balanced 2-column grid for comfortable scanning.',
    points: [
      'Expanded desktop width to 1160px and 1240px for laptops and large displays.',
      'Disciplined 2-column grid balancing today\'s classes with tasks and vitals.',
      'Maintains compact, touch-friendly navigation on mobile devices.'
    ]
  },
  {
    id: 'u5',
    date: '2026-08-07',
    title: 'Zero-Flash Palette Persistence',
    category: 'Theme',
    tag: 'Reliability',
    summary: 'Synchronous pre-render script ensures instant theme restoration without dark/light flash.',
    points: [
      'Synchronous head script applies data-theme before the DOM paints.',
      'Local user selection heals cloud document states across multi-device sync.',
      'Seamless support across Paper, Cloud, Stone, Quiet Dark, and Café Night palettes.'
    ]
  },
  {
    id: 'u6',
    date: '2026-08-06',
    title: 'Natural IST Greetings & Course Shortcuts',
    category: 'Navigation',
    tag: 'Polish',
    summary: 'Human greeting transitions and direct deep-linking into subject course materials.',
    points: [
      'Night greeting now extends smoothly until 5:00 AM to match student study schedules.',
      'Subject shortcut chips route directly into the specific subject course screen.'
    ]
  }
];

let _devNotesFilter = 'week';

function getFilteredDevUpdates(filter) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  if (filter === 'today') {
    return DEV_UPDATES.filter(u => u.date === todayStr);
  }

  if (filter === 'week') {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const wy = weekAgo.getFullYear();
    const wm = String(weekAgo.getMonth() + 1).padStart(2, '0');
    const wd = String(weekAgo.getDate()).padStart(2, '0');
    const weekAgoStr = `${wy}-${wm}-${wd}`;
    return DEV_UPDATES.filter(u => u.date >= weekAgoStr);
  }

  if (filter === 'month') {
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const my = monthAgo.getFullYear();
    const mm = String(monthAgo.getMonth() + 1).padStart(2, '0');
    const md = String(monthAgo.getDate()).padStart(2, '0');
    const monthAgoStr = `${my}-${mm}-${md}`;
    return DEV_UPDATES.filter(u => u.date >= monthAgoStr);
  }

  return DEV_UPDATES;
}

function renderDevNotesEntriesHtml(filter) {
  const entries = getFilteredDevUpdates(filter);
  if (!entries.length) {
    return `
      <div class="empty-state-card" style="padding:28px 16px;margin:10px 0">
        <span class="empty-state-icon">✨</span>
        <div class="empty-state-title">No Updates for Selected Filter</div>
        <div class="empty-state-desc">No release notes found for this time range. You can switch to <strong>This Week</strong> or <strong>All Updates</strong> to view recent improvements.</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
          <button class="btn btn-sm btn-primary" onclick="setDevNotesFilter('week')">View This Week</button>
          <button class="btn btn-sm btn-secondary" onclick="setDevNotesFilter('all')">View All Updates</button>
        </div>
      </div>
    `;
  }

  return entries.map(item => `
    <div class="dev-update-card" style="border-left-color: ${item.tagColor};">
      <div class="dev-update-header">
        <div class="dev-update-title">${escHtml_cd(item.title)}</div>
        <div class="dev-update-meta">
          <span class="dev-update-tag" style="background: color-mix(in srgb, ${item.tagColor} 14%, transparent); color: ${item.tagColor}; border: 1px solid color-mix(in srgb, ${item.tagColor} 30%, transparent);">${item.tag}</span>
          <span class="dev-update-date">${formatDate(item.date)}</span>
        </div>
      </div>
      <div class="dev-update-summary">${escHtml_cd(item.summary)}</div>
      <ul class="dev-update-list">
        ${item.points.map(pt => `<li>${escHtml_cd(pt)}</li>`).join('')}
      </ul>
    </div>
  `).join('');
}

function setDevNotesFilter(newFilter) {
  if (!newFilter) newFilter = 'week';
  _devNotesFilter = newFilter;

  const backdrop = document.getElementById('dev-notes-modal-backdrop');
  if (!backdrop) {
    showDevNotesModal(newFilter);
    return;
  }

  // Smoothly update active pill state without remounting the dialog
  const filterBar = backdrop.querySelector('.dev-notes-filter-bar');
  if (filterBar) {
    filterBar.querySelectorAll('.dev-filter-pill').forEach(btn => {
      const pillFilter = btn.getAttribute('data-filter');
      if (pillFilter === newFilter) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    });
  }

  const bodyEl = backdrop.querySelector('.dev-notes-body');
  if (!bodyEl) return;

  // Gentle, calm in-place transition without screen flash
  bodyEl.classList.remove('fade-in');
  bodyEl.classList.add('switching');

  setTimeout(() => {
    bodyEl.innerHTML = renderDevNotesEntriesHtml(newFilter);
    bodyEl.scrollTop = 0;
    bodyEl.classList.remove('switching');
    bodyEl.classList.add('fade-in');
  }, 90);
}
window.setDevNotesFilter = setDevNotesFilter;

function showDevNotesModal(filter = null) {
  if (filter) _devNotesFilter = filter;

  const existingBackdrop = document.getElementById('dev-notes-modal-backdrop');
  if (existingBackdrop) {
    setDevNotesFilter(_devNotesFilter);
    return;
  }

  const entriesHtml = renderDevNotesEntriesHtml(_devNotesFilter);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'dev-notes-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal dev-notes-dialog" onclick="event.stopPropagation()">
      <div class="dev-notes-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1.3rem">🛠️</span>
          <div>
            <div class="modal-title" style="font-size:1.05rem;line-height:1.2">Dev Notes &amp; System Updates</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">Recent fixes, desk features &amp; engineering improvements</div>
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('dev-notes-modal-backdrop')?.remove()" title="Close (Esc)" aria-label="Close modal">${icons.x()}</button>
      </div>

      <!-- Time Filter Tabs (Pinned Bar) -->
      <div class="dev-notes-filter-bar" role="tablist" aria-label="Filter updates by time">
        <button class="dev-filter-pill ${_devNotesFilter === 'today' ? 'active' : ''}" data-filter="today" role="tab" aria-selected="${_devNotesFilter === 'today'}" onclick="setDevNotesFilter('today')">
          Today
        </button>
        <button class="dev-filter-pill ${_devNotesFilter === 'week' ? 'active' : ''}" data-filter="week" role="tab" aria-selected="${_devNotesFilter === 'week'}" onclick="setDevNotesFilter('week')">
          This Week
        </button>
        <button class="dev-filter-pill ${_devNotesFilter === 'month' ? 'active' : ''}" data-filter="month" role="tab" aria-selected="${_devNotesFilter === 'month'}" onclick="setDevNotesFilter('month')">
          This Month
        </button>
        <button class="dev-filter-pill ${_devNotesFilter === 'all' ? 'active' : ''}" data-filter="all" role="tab" aria-selected="${_devNotesFilter === 'all'}" onclick="setDevNotesFilter('all')">
          All Updates
        </button>
      </div>

      <div class="dev-notes-body fade-in">
        ${entriesHtml}
      </div>

      <div class="dev-notes-footer">
        <span style="font-size:0.75rem;color:var(--text-muted)">Clarity Desk Engine · Local-first</span>
        <button class="btn-primary" onclick="document.getElementById('dev-notes-modal-backdrop')?.remove()" style="padding:6px 18px;font-size:0.82rem">Done</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}
window.showDevNotesModal = showDevNotesModal;


// ── Desk Assistant ────────────────────────────────────────────
// Rules-based student data assistant. No paid API. No fake LLM.
// Every answer comes from live app state.

const ClarityAssistant = (() => {

  // ── Helpers ───────────────────────────────────────────────────
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function nDaysFromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d} ${months[m-1]}`;
  }

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAY_ABBR  = ['sun','mon','tue','wed','thu','fri','sat'];

  function formatTime(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = ((h - 1 + 12) % 12) + 1;
    return `${hour}:${String(m).padStart(2,'0')} ${suffix}`;
  }

  // ── Intent Matching ───────────────────────────────────────────
  const INTENTS = [
    {
      id: 'greeting',
      test: /\b(hi|hello|hey|good\s*(morning|afternoon|evening)|what'?s up|sup)\b/i,
    },
    {
      id: 'parser_review',
      test: /\b(review (import|timetable|attendance|scan|data|staging)|check (pending|uncertain|imports?|review)|is my import (confirmed|ready)|needs? review|uncertain (data|import|attendance|timetable))\b/i,
    },
    {
      id: 'cleanup_followup',
      test: /\b(cleanup status|what changed after cleanup|did (declutter|cleanup) work|recovery status|continue (cleanup|recovery|declutter)|post[- ]cleanup|after cleanup)\b/i,
    },
    {
      id: 'weekly_plan',
      test: /\b(plan (my )?week|weekly (plan|focus|schedule|summary)|what should i focus on this week|help me rebalance this week|rebalance this week|week'?s plan)\b/i,
    },
    {
      id: 'subject_guidance',
      test: /\b(which subjects? need(s)? (attention|more attention|the most attention)|where am i falling behind|highest risk subject|undertracked|weak attendance|subject with upcoming pressure|what subject should i focus on|needs? (the )?most attention|needs? more attention)\b|\bwhich (lab|theory|subject|course).*(undertracked|attention|falling behind|pressure)\b/i,
    },
    {
      id: 'import_timetable',
      test: /\b(import timetable|scan timetable|upload timetable|add timetable|setup timetable|set up timetable|fix timetable|import my timetable|i need to set up my timetable|set up my timetable)\b/i,
    },
    {
      id: 'setup_attendance',
      test: /\b(setup attendance|set up attendance|attendance baseline|attendance setup|help me set up attendance|help me set my attendance baseline|configure attendance|set baseline|set my baseline|set attendance baseline)\b/i,
    },
    {
      id: 'subject_hubs',
      test: /\b(open (my )?subject hubs?|view (my )?subject hubs?|go to subject hubs?|subject hubs?|open subjects?|view subjects?)\b/i,
    },
    {
      id: 'declutter_desk',
      test: /\b(clean my desk|clean desk|declutter|declutter desk|declutter my desk|duplicate subjects|find duplicate|fix duplicate|polluted subjects|my subjects look wrong|subjects look wrong|wrong subjects)\b/i,
    },
    {
      id: 'create_task',
      test: /\b(add task|create task|new task|add a task|remind me to|make a task)\b/i,
    },
    {
      id: 'study_plan',
      test: /\b(study plan|plan tonight|help me plan tonight|plan today|what should i study|what to study|study schedule|how to study today|plan my evening)\b/i,
    },
    {
      id: 'setup_gaps',
      test: /\b(setup|what needs setup|missing setup|setup gaps|what is missing|needs setup|desk setup|is anything missing( from my setup)?|anything missing)\b/i,
    },
    {
      id: 'next_class',
      test: /\b(next class|next lecture|upcoming class|which class|next period|what'?s next|what is next|\bnext\b|soon start|starting next)\b/i,
    },
    {
      id: 'attendance_risk',
      test: /\b(at risk|risk|attendance risk|which subjects are at risk|attendance at risk|low attendance|below 75|danger)\b/i,
    },
    {
      id: 'tasks_urgent',
      test: /\b(urgent|overdue|late|missed deadline|past due|behind|urgent tasks|show (my )?urgent tasks|what tasks are urgent|due today|due tomorrow|deadline|deadlines)\b/i,
    },
    {
      id: 'tasks_week',
      test: /\b(due (this|next) week|upcoming (task|deadline|assignment)|this week|due soon|week'?s tasks?)\b/i,
    },
    {
      id: 'tasks_all',
      test: /\b(all (task|assignment)|pending tasks?|my tasks?|task list|what (task|assignment))\b/i,
    },
    {
      id: 'today_summary',
      test: /\b(today|what do i have|schedule today|classes today|my day|show my day|what'?s on|plan for today|focus on today|what should i focus)\b/i,
    },
    {
      id: 'attendance_general',
      test: /\b(attendance|percentage|pct|how many class(es)? (attended|missed)|my record|att(end)?|can i skip|safe to skip)\b/i,
    },
    {
      id: 'classes_left',
      test: /\b(classes left|remaining (class|today)|how many more|left today)\b/i,
    },
    {
      id: 'day_schedule',
      test: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i,
    },
    {
      id: 'notices',
      test: /\b(notice|announcement|important|update|bulletin|news|notification)\b/i,
    },
    {
      id: 'profile',
      test: /\b(who am i|my profile|my name|my branch|my year|my roll|my college|my batch)\b/i,
    },
    {
      id: 'help',
      test: /\b(help|what can you|commands|what do you know|how to use|capabilities)\b/i,
    },
  ];

  function matchIntent(q) {
    const lower = q.toLowerCase().trim();
    for (const intent of INTENTS) {
      if (intent.test.test(lower)) return intent.id;
    }
    return 'unknown';
  }

  // ── Data Readers ──────────────────────────────────────────────

  function getTodayClasses() {
    const tt = loadTimetable();
    const day = new Date().getDay();
    return (tt[day] || []).filter(c => !isBreakEntry(c));
  }

  function getDayClasses(dayNum) {
    const tt = loadTimetable();
    return (tt[dayNum] || []).filter(c => !isBreakEntry(c));
  }

  function getNextClass() {
    const tt = loadTimetable();
    const now = currentTimeMinutes();
    const day = new Date().getDay();
    const classes = (tt[day] || []).filter(c => !isBreakEntry(c));
    return classes.find(c => timeToMinutes(c.time) > now) || null;
  }

  function getRemainingTodayClasses() {
    const tt = loadTimetable();
    const now = currentTimeMinutes();
    const day = new Date().getDay();
    return (tt[day] || []).filter(c => !isBreakEntry(c) && timeToMinutes(c.end || c.time) > now);
  }

  // ── Response Builders ─────────────────────────────────────────

  function buildGreeting() {
    const p = loadProfile() || liveProfile || {};
    const name = p.name || '';
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const nameStr = name ? `, ${name.split(' ')[0]}` : '';
    const todayClasses = getTodayClasses();
    const pending = allTasks().filter(t => t.status === 'pending').length;
    const dayName = DAY_NAMES[new Date().getDay()];

    let line2 = '';
    if (todayClasses.length > 0) {
      line2 = `You have <strong>${todayClasses.length} class${todayClasses.length !== 1 ? 'es' : ''}</strong> today (${dayName})`;
    } else {
      line2 = `No classes today (${dayName}).`;
    }
    if (pending > 0) {
      line2 += ` and <strong>${pending} pending task${pending !== 1 ? 's' : ''}</strong>.`;
    } else {
      line2 += ` and no pending tasks.`;
    }

    return `${greet}${nameStr}! ${line2}`;
  }

  function buildHelp() {
    return `Ask Desk operates as your academic assistant grounded in your live schedule &amp; records:<ul class="cd-list">
      <li><span class="cd-item-label">Parser &amp; Setup Review</span><span class="cd-item-meta">"Review timetable import" · "Check pending imports"</span></li>
      <li><span class="cd-item-label">Post-Cleanup Followup</span><span class="cd-item-meta">"What changed after cleanup?" · "Recovery status"</span></li>
      <li><span class="cd-item-label">Weekly Academic Plan</span><span class="cd-item-meta">"Plan my week" · "Help me rebalance this week"</span></li>
      <li><span class="cd-item-label">Subject Radar</span><span class="cd-item-meta">"Which subject needs the most attention?" · "Where am I falling behind?"</span></li>
      <li><span class="cd-item-label">Today Study Plan</span><span class="cd-item-meta">"Help me plan tonight" · "What should I study today?"</span></li>
      <li><span class="cd-item-label">Desk Actions</span><span class="cd-item-meta">"Add a task for [Subject]" · "Import timetable" · "Clean my desk"</span></li>
    </ul>`;
  }

  function buildParserReview() {
    const tt = loadTimetable();
    const hasClasses = Object.values(tt || {}).some(arr => Array.isArray(arr) && arr.some(c => !isBreakEntry(c)));
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    const baselines = loadAttendanceBaselines();
    const isPolluted = (typeof detectDeskPollution === 'function') && detectDeskPollution();

    const issues = [];

    // 1. Timetable Check
    if (!hasClasses) {
      issues.push({
        title: 'Timetable Import Pending',
        desc: 'No timetable data found. Your schedule has not been imported yet.',
        action: `<button class="btn btn-sm btn-primary" onclick="triggerTimetableImport()" style="font-size:0.75rem;padding:3px 10px;margin-top:4px">📷 Scan Timetable Photo →</button>`
      });
    } else if (isPolluted) {
      issues.push({
        title: 'Timetable Multi-Batch Sessions Found',
        desc: 'Extracted timetable contains other-batch practicals or duplicate merged slots that need batch filtering confirmation.',
        action: `<button class="btn btn-sm btn-secondary" onclick="showDeclutterDeskModal()" style="font-size:0.75rem;padding:3px 10px;margin-top:4px">🧹 Review &amp; Filter Batch →</button>`
      });
    }

    // 2. Attendance Baseline Check
    if (subjects.length > 0) {
      const unverified = subjects.filter(s => {
        const codeKey = (s.code || '').trim();
        const nameKey = (s.name || '').trim();
        return !baselines[codeKey] && !baselines[nameKey];
      });
      if (unverified.length > 0) {
        issues.push({
          title: `Attendance Baselines (${unverified.length} Unverified)`,
          desc: `${unverified.map(s => s.name).slice(0, 3).join(', ')}${unverified.length > 3 ? ` and ${unverified.length - 3} more` : ''} need starting attendance counts confirmed.`,
          action: `<button class="btn btn-sm btn-secondary" onclick="showBaselineModal(null, 'manual')" style="font-size:0.75rem;padding:3px 10px;margin-top:4px">📊 Confirm Baselines →</button>`
        });
      }
    }

    if (issues.length === 0) {
      let totalSlots = 0;
      Object.values(tt || {}).forEach(arr => {
        (arr || []).forEach(c => { if (!isBreakEntry(c)) totalSlots++; });
      });
      return `<div class="cd-tag cd-tag-safe" style="display:inline-flex;margin-bottom:8px">✓ All Imports Confirmed</div><br>
      <strong>All imported data is verified and confirmed!</strong><br><br>
      • Timetable: <strong>${totalSlots} weekly slots</strong> active.<br>
      • Attendance: <strong>${subjects.length}/${subjects.length} subjects</strong> confirmed with live tracking.<br>
      • Desk Health: Zero duplicate or unmapped rows detected.`;
    }

    const items = issues.map(iss => `
      <li style="margin-bottom:8px">
        <div style="font-weight:600;color:var(--text-primary)">${iss.title}</div>
        <div style="font-size:0.78rem;color:var(--text-muted)">${iss.desc}</div>
        ${iss.action}
      </li>
    `).join('');

    return `<div class="cd-tag is-warning" style="margin-bottom:8px">Import Review Status</div><br>
    <strong>${issues.length} item${issues.length !== 1 ? 's' : ''} require confirmation or review:</strong><ul class="cd-list" style="margin-top:8px">${items}</ul>`;
  }

  function buildCleanupFollowup() {
    const isPolluted = (typeof detectDeskPollution === 'function') && detectDeskPollution();
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    const p = loadProfile() || liveProfile || {};

    if (isPolluted) {
      return `<div class="cd-tag is-warning" style="margin-bottom:8px">Cleanup Incomplete</div><br>
      Your desk still has duplicate cards or mixed practical batches from an earlier timetable scan.<br><br>
      <strong>Next step:</strong> Select your practical batch to remove other-batch classes and merge duplicate cards safely.<br><br>
      <button class="btn btn-sm btn-primary" onclick="showDeclutterDeskModal()" style="font-size:0.78rem;padding:6px 14px">🧹 Run Declutter &amp; Recovery →</button>`;
    }

    const labSubjects = subjects.filter(s => s.isLab || /lab\b/i.test(s.name));
    const theorySubjects = subjects.filter(s => !s.isLab && !/lab\b/i.test(s.name));

    return `<div class="cd-tag cd-tag-safe" style="margin-bottom:8px">✓ Desk Structure Clean</div><br>
    <strong>Post-Cleanup Status:</strong><br>
    • <strong>Active Filter:</strong> ${p.batch ? `Batch ${p.batch}` : 'All Batches (General)'}<br>
    • <strong>Canonical Subjects:</strong> ${subjects.length} active (${theorySubjects.length} theory, ${labSubjects.length} lab)<br>
    • <strong>Data Integrity:</strong> All attendance baselines and tasks remain safely attached to canonical hubs.<br><br>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm btn-secondary" onclick="navigate('subjects')" style="font-size:0.78rem;padding:5px 12px">View Subject Hubs →</button>
      <button class="btn btn-sm btn-secondary" onclick="navigate('timetable')" style="font-size:0.78rem;padding:5px 12px">View Timetable →</button>
    </div>`;
  }

  function buildWeeklyPlan() {
    const tt = loadTimetable();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayCounts = [1, 2, 3, 4, 5, 6].map(d => {
      const classes = (tt[d] || []).filter(c => !isBreakEntry(c));
      return { dayNum: d, day: dayNames[d], count: classes.length };
    }).filter(d => d.count > 0);

    const totalSlots = dayCounts.reduce((acc, d) => acc + d.count, 0);
    const sortedDays = [...dayCounts].sort((a, b) => b.count - a.count);
    const heaviest = sortedDays[0];
    const lightest = sortedDays[sortedDays.length - 1];

    const today = todayISO();
    const weekEnd = nDaysFromNow(7);
    const tasks = allTasks();
    const thisWeekTasks = tasks.filter(t => t.status === 'pending' && !t.noDeadline && t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd);
    const overdueTasks = tasks.filter(t => isTaskOverdue(t));

    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    const target = getAttendanceTarget();
    const atRisk = subjects.filter(s => {
      const att = getSubjectAttendance(s);
      return att.pct !== null && att.pct < target;
    });

    const sections = [];

    // 1. Timetable Load
    if (totalSlots > 0) {
      sections.push(`<li><strong>Weekly Timetable Load:</strong> <strong>${totalSlots} total classes</strong> this week. Heaviest day: <strong>${heaviest.day} (${heaviest.count} classes)</strong>${lightest && lightest.day !== heaviest.day ? `, lightest: ${lightest.day} (${lightest.count} classes)` : ''}.</li>`);
    } else {
      sections.push(`<li><strong>Weekly Timetable Load:</strong> No weekly schedule imported yet.</li>`);
    }

    // 2. Deadlines
    if (overdueTasks.length > 0 || thisWeekTasks.length > 0) {
      const topTask = overdueTasks[0] || thisWeekTasks[0];
      const overdueTag = overdueTasks.length > 0 ? ` (<strong>${overdueTasks.length} overdue</strong>)` : '';
      sections.push(`<li><strong>Academic Deadlines:</strong> <strong>${thisWeekTasks.length + overdueTasks.length} task${(thisWeekTasks.length+overdueTasks.length)!==1?'s':''}</strong>${overdueTag} needing focus, led by <em>${escHtml(topTask.title)}</em> (${escHtml(topTask.subject || 'Task')}).</li>`);
    } else {
      sections.push(`<li><strong>Academic Deadlines:</strong> Clear desk — no overdue or upcoming assignments due this week.</li>`);
    }

    // 3. Attendance Targets
    if (atRisk.length > 0) {
      const riskNames = atRisk.map(s => escHtml(s.name)).join(', ');
      sections.push(`<li><strong>Attendance Health:</strong> <strong>${atRisk.length} subject${atRisk.length!==1?'s':''}</strong> below target (${riskNames}). Attend all sessions this week to gain safety margin.</li>`);
    } else {
      sections.push(`<li><strong>Attendance Health:</strong> All active subjects are in safe standing (≥${target}%).</li>`);
    }

    // 4. Rebalancing Strategy
    if (heaviest && (overdueTasks.length > 0 || thisWeekTasks.length > 0)) {
      const topTask = overdueTasks[0] || thisWeekTasks[0];
      sections.push(`<li><strong>💡 Rebalance Strategy:</strong> Complete <em>${escHtml(topTask.title)}</em> before <strong>${heaviest.day}</strong> to eliminate stress during your heaviest class day.</li>`);
    } else {
      sections.push(`<li><strong>💡 Rebalance Strategy:</strong> Review your notes in 25-minute focus intervals after morning lectures.</li>`);
    }

    return `<div class="cd-tag is-accent" style="margin-bottom:8px">Weekly Academic Roadmap</div><br>
    Here is your grounded weekly focus summary:<ul class="cd-list" style="margin-top:8px">${sections.join('')}</ul>`;
  }

  function buildSubjectGuidance() {
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    if (subjects.length === 0) {
      return `No subjects found. Add classes in Timetable to start subject-aware tracking.`;
    }

    const target = getAttendanceTarget();

    const scored = subjects.map(s => {
      const att = getSubjectAttendance(s);
      const tasks = allTasks().filter(t => t.subject && t.subject.toLowerCase() === s.name.toLowerCase() && t.status === 'pending');
      const overdue = tasks.filter(t => isTaskOverdue(t));
      const hasBaseline = att.hasBaseline;
      const pct = att.pct;

      let score = 0;
      const signals = [];

      if (pct !== null && pct < target) {
        score += 50;
        signals.push(`attendance is low at <strong>${pct}%</strong> (target: ${target}%)`);
      } else if (!hasBaseline && att.total === 0) {
        score += 20;
        signals.push(`baseline counts unverified`);
      }

      if (overdue.length > 0) {
        score += 40;
        signals.push(`<strong>${overdue.length} overdue deadline${overdue.length!==1?'s':''}</strong>`);
      } else if (tasks.length > 0) {
        score += 20;
        signals.push(`${tasks.length} pending task${tasks.length!==1?'s':''}`);
      }

      const isLab = s.isLab || /lab\b/i.test(s.name);

      return {
        subject: s,
        score,
        signals,
        isLab,
        pct,
        tasksCount: tasks.length,
        hasBaseline
      };
    }).sort((a, b) => b.score - a.score);

    const top = scored[0];
    if (!top || top.score === 0) {
      return `<div class="cd-tag cd-tag-safe" style="margin-bottom:8px">✓ All Good</div><br>
      <strong>All subjects are in great standing!</strong><br><br>
      No subjects have low attendance, unverified baselines, or overdue tasks. Keep up the strong consistency!`;
    }

    const items = scored.filter(s => s.score > 0).slice(0, 3).map(s => {
      const typeBadge = s.isLab ? '<span class="cd-tag is-purple" style="font-size:0.7rem;padding:1px 5px">Lab</span> ' : '';
      return `<li>${typeBadge}<strong>${escHtml(s.subject.name)}</strong>: ${s.signals.join(' and ')}.</li>`;
    }).join('');

    return `<div class="cd-tag is-error" style="margin-bottom:8px">Academic Focus Radar</div><br>
    <strong>${escHtml(top.subject.name)}</strong> needs the most attention right now because ${top.signals.join(' and ')}.<br><br>
    <strong>Priority Breakdown:</strong><ul class="cd-list" style="margin-top:6px">${items}</ul>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-sm btn-primary" onclick="sendAssistantMessage('Help me plan tonight')" style="font-size:0.75rem;padding:4px 10px">🎯 Plan Study for Today</button>
      <button class="btn btn-sm btn-secondary" onclick="showAddTaskModal(null, '${top.subject.name.replace(/'/g, "\\'")}')" style="font-size:0.75rem;padding:4px 10px">✍️ Add Task</button>
    </div>`;
  }

  function buildImportTimetable() {
    const tt = loadTimetable();
    const hasClasses = Object.values(tt || {}).some(arr => Array.isArray(arr) && arr.some(c => !isBreakEntry(c)));
    let totalSlots = 0;
    Object.values(tt || {}).forEach(arr => {
      (arr || []).forEach(c => { if (!isBreakEntry(c)) totalSlots++; });
    });

    if (!hasClasses) {
      return `<div class="cd-tag is-accent" style="margin-bottom:8px">Timetable Setup</div><br>
      You don't have a schedule set up yet. You can scan an image of your timetable or load our official sample schedule template.<br><br>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-primary" onclick="triggerTimetableImport()" style="font-size:0.78rem;padding:5px 12px">📷 Scan Timetable Photo</button>
        <button class="btn btn-sm btn-secondary" onclick="loadOfficialAidsTimetable()" style="font-size:0.78rem;padding:5px 12px">📋 Sample Template</button>
        <button class="btn btn-sm btn-secondary" onclick="navigate('timetable')" style="font-size:0.78rem;padding:5px 12px">Open Timetable →</button>
      </div>`;
    }

    return `<div class="cd-tag cd-tag-safe" style="margin-bottom:8px">Timetable Active</div><br>
    You currently have <strong>${totalSlots} class slot${totalSlots!==1?'s':''}</strong> active on your timetable. You can scan a new photo to replace/update it or add individual classes manually.<br><br>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm btn-secondary" onclick="triggerTimetableImport()" style="font-size:0.78rem;padding:5px 12px">📷 Scan New Photo</button>
      <button class="btn btn-sm btn-secondary" onclick="navigate('timetable')" style="font-size:0.78rem;padding:5px 12px">View Full Schedule →</button>
    </div>`;
  }

  function buildSetupAttendance() {
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    const baselines = loadAttendanceBaselines();
    const missing = subjects.filter(s => {
      const codeKey = (s.code || '').trim();
      const nameKey = (s.name || '').trim();
      return !baselines[codeKey] && !baselines[nameKey];
    });

    if (subjects.length === 0) {
      return `<div class="cd-tag is-warning" style="margin-bottom:8px">No Subjects Found</div><br>
      Set up your timetable schedule first so Clarity Desk can automatically create your Subject Hubs for tracking attendance.<br><br>
      <button class="btn btn-sm btn-primary" onclick="triggerTimetableImport()" style="font-size:0.78rem;padding:5px 12px">📷 Scan Timetable Photo →</button>`;
    }

    if (missing.length > 0) {
      return `<div class="cd-tag is-warning" style="margin-bottom:8px">Attendance Baseline</div><br>
      <strong>${missing.length} of ${subjects.length} subjects</strong> are missing initial attendance counts. Entering your portal counts once gives you instant % calculations and safe skip guidance.<br><br>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-primary" onclick="showBaselineModal(null, 'scan')" style="font-size:0.78rem;padding:5px 12px">📷 Scan Portal Screenshot</button>
        <button class="btn btn-sm btn-secondary" onclick="showBaselineModal(null, 'manual')" style="font-size:0.78rem;padding:5px 12px">✍️ Enter Counts Manually</button>
        <button class="btn btn-sm btn-secondary" onclick="navigate('subjects')" style="font-size:0.78rem;padding:5px 12px">Subject Hubs →</button>
      </div>`;
    }

    return `<div class="cd-tag cd-tag-safe" style="margin-bottom:8px">Baselines Active</div><br>
    All your active Subject Hubs have baseline counts configured. You can update counts at any time or log daily attendance directly in the timetable.<br><br>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm btn-secondary" onclick="showBaselineModal()" style="font-size:0.78rem;padding:5px 12px">📊 Edit Baseline Counts</button>
      <button class="btn btn-sm btn-secondary" onclick="navigate('subjects')" style="font-size:0.78rem;padding:5px 12px">Subject Hubs →</button>
    </div>`;
  }

  function buildDeclutterDesk() {
    const isPolluted = (typeof detectDeskPollution === 'function') && detectDeskPollution();

    if (isPolluted) {
      return `<div class="cd-tag is-warning" style="margin-bottom:8px">Declutter Recommended</div><br>
      We detected duplicate, noisy, or multi-batch subject cards on your desk. Decluttering will:<br>
      <ul class="cd-list" style="margin:6px 0 8px 0">
        <li>Filter practical lab sessions to your exact batch (e.g. A2, B1, D1)</li>
        <li>Merge duplicate variations into clean canonical cards</li>
        <li>Safely reassign all attendance baselines &amp; tasks without data loss</li>
      </ul>
      <button class="btn btn-sm btn-primary" onclick="showDeclutterDeskModal()" style="font-size:0.78rem;padding:6px 14px">🧹 Declutter my desk →</button>`;
    }

    return `<div class="cd-tag cd-tag-safe" style="margin-bottom:8px">Clean Desk</div><br>
    Your Subject Hubs and timetable structure are already normalized and clean! If you ever need to change your practical batch or re-filter sessions, you can launch cleanup anytime.<br><br>
    <button class="btn btn-sm btn-secondary" onclick="showDeclutterDeskModal()" style="font-size:0.78rem;padding:5px 12px">🧹 Open Declutter Tool →</button>`;
  }

  function buildSubjectHubs() {
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    if (subjects.length === 0) {
      return `No Subject Hubs found. Set up your timetable schedule or attendance baseline first.<br><br>
      <button class="btn btn-sm btn-primary" onclick="navigate('subjects')" style="font-size:0.78rem;padding:5px 12px">Open Subject Hubs →</button>`;
    }
    return `You have <strong>${subjects.length} active Subject Hub${subjects.length !== 1 ? 's' : ''}</strong> configured with attendance, course resources, and faculty metadata.<br><br>
    <button class="btn btn-sm btn-primary" onclick="navigate('subjects')" style="font-size:0.78rem;padding:6px 14px">📚 Open Subject Hubs →</button>`;
  }

  function buildCreateTask(query) {
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    let q = query.replace(/\b(add a task|add task|create task|new task|make a task|remind me to)\b/i, '').trim();
    const cleanQ = q.replace(/^(for|in|about)\s+/i, '').trim().toLowerCase();

    // Check matching subjects
    const matching = subjects.filter(s => {
      const sName = s.name.toLowerCase();
      const sCode = (s.code || '').toLowerCase();
      if (!cleanQ || cleanQ.length < 3) return false;
      return (sName && (sName === cleanQ || sName.includes(cleanQ) || cleanQ.includes(sName))) ||
             (sCode && sCode.length >= 2 && (sCode === cleanQ || sCode.includes(cleanQ) || cleanQ.includes(sCode)));
    });

    if (matching.length === 1) {
      const foundSubj = matching[0];
      return `Open the Task Creator for <strong>${escHtml(foundSubj.name)}</strong> in <a href="javascript:void(0)" onclick="navigate('assignments')" style="color:var(--accent);font-weight:600">Tasks &amp; Deadlines</a>:<br><br>
      <button class="btn btn-sm btn-primary" onclick="showAddTaskModal(null, '${foundSubj.name.replace(/'/g, "\\'")}')" style="font-size:0.78rem;padding:6px 14px">✍️ Create Task for ${escHtml(foundSubj.name)} →</button>`;
    } else if (matching.length > 1) {
      const buttons = matching.map(s =>
        `<button class="btn btn-sm btn-secondary" onclick="showAddTaskModal(null, '${s.name.replace(/'/g, "\\'")}')" style="font-size:0.75rem;padding:4px 10px">${escHtml(s.name)}</button>`
      ).join(' ');
      return `Multiple subjects matched your request. Choose which subject to create a task for:<br><br>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${buttons}</div>`;
    }

    return `To create or schedule an assignment, open the Task Creator in <a href="javascript:void(0)" onclick="navigate('assignments')" style="color:var(--accent);font-weight:600">Tasks &amp; Deadlines</a>:<br><br>
    <button class="btn btn-sm btn-primary" onclick="showAddTaskModal()" style="font-size:0.78rem;padding:6px 14px">✍️ Open Task Creator →</button>`;
  }

  function buildStudyPlan() {
    const today = todayISO();
    const tomorrow = nDaysFromNow(1);
    const tasks = allTasks();
    const urgentTasks = tasks.filter(t => t.status === 'pending' && (isTaskOverdue(t) || t.dueDate === today || t.dueDate === tomorrow));
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    const target = getAttendanceTarget();
    const atRisk = subjects.filter(s => {
      const att = getSubjectAttendance(s);
      return att.pct !== null && att.pct < target;
    });

    const tomorrowDay = (new Date().getDay() + 1) % 7;
    const tt = loadTimetable();
    const tomorrowClasses = (tt[tomorrowDay] || []).filter(c => !isBreakEntry(c));

    const planSteps = [];

    // Block 1: Highest Priority / Urgent Work
    if (urgentTasks.length > 0) {
      const topTask = urgentTasks[0];
      const urgencyLabel = isTaskOverdue(topTask) ? 'Overdue' : topTask.dueDate === today ? 'Due Today' : 'Due Tomorrow';
      planSteps.push(`<strong>1. High-Priority Focus (45 min):</strong> Tackle <em>${escHtml(topTask.title)}</em> for <strong>${escHtml(topTask.subject || 'Task')}</strong> (${urgencyLabel}). Finish this before moving to optional topics.`);
    } else {
      planSteps.push(`<strong>1. Course Consolidation (35 min):</strong> No urgent deadlines pending. Review key concepts and lab writeups from today's lectures.`);
    }

    // Block 2: Attendance Recovery & Weak Topics
    if (atRisk.length > 0) {
      const topRisk = atRisk[0];
      const att = getSubjectAttendance(topRisk);
      planSteps.push(`<strong>2. Attendance Recovery Study (30 min):</strong> Focus on <strong>${escHtml(topRisk.name)}</strong> (currently at ${att.pct}%). Ensure lecture notes and assignments are up to date so you don't miss future marks.`);
    } else if (subjects.length > 0) {
      planSteps.push(`<strong>2. Problem Practice (30 min):</strong> Solve practice questions or read syllabus references for <strong>${escHtml(subjects[0].name)}</strong>.`);
    } else {
      planSteps.push(`<strong>2. Desk Review (20 min):</strong> Organize notes, verify upcoming tests, and check campus notices.`);
    }

    // Block 3: Tomorrow's Schedule Preview
    if (tomorrowClasses.length > 0) {
      const firstClass = tomorrowClasses[0];
      planSteps.push(`<strong>3. Tomorrow's Preview (15 min):</strong> Preview tomorrow's opening lecture: <strong>${escHtml(firstClass.subject)}</strong> at ${formatTime(firstClass.time)}${firstClass.room && firstClass.room !== '—' ? ' in ' + escHtml(firstClass.room) : ''}.`);
    } else {
      planSteps.push(`<strong>3. Day Wrap-Up (10 min):</strong> Check off completed tasks and set goals for tomorrow.`);
    }

    return `<div class="cd-tag is-accent" style="margin-bottom:8px">Today's Focus Plan</div><br>
    Here is a realistic study plan grounded in your live desk data:<ul class="cd-list" style="margin-top:8px">${planSteps.map(s => `<li>${s}</li>`).join('')}</ul>`;
  }

  function buildTodaySummary() {
    const classes = getTodayClasses();
    const dayName = DAY_NAMES[new Date().getDay()];
    const isSunday = new Date().getDay() === 0;
    const pendingOverdue = allTasks().filter(t => isTaskOverdue(t));
    const dueToday = allTasks().filter(t => t.status === 'pending' && !t.noDeadline && t.dueDate === todayISO());

    if (isSunday) {
      let msg = `Today is <strong>Sunday</strong> — no scheduled classes.`;
      if (pendingOverdue.length > 0 || dueToday.length > 0) {
        msg += `<br><br>💡 You have <strong>${pendingOverdue.length + dueToday.length}</strong> urgent/due tasks to catch up on before Monday.`;
      } else {
        msg += ` A calm day to relax or plan ahead for the week.`;
      }
      return msg;
    }

    const hasAnyTT = Object.values(loadTimetable() || {}).some(arr => arr && arr.some(c => !isBreakEntry(c)));
    if (!hasAnyTT) {
      return `<div class="cd-tag is-warning" style="margin-bottom:8px">No Timetable Set</div><br>No timetable imported yet. You can scan your schedule photo or add classes in the <a href="javascript:void(0)" onclick="navigate('timetable')" style="color:var(--accent);font-weight:600">Timetable tab</a>.`;
    }

    if (classes.length === 0) {
      return `<strong>${dayName}</strong>: No classes scheduled today.<br><br>💡 ${pendingOverdue.length > 0 ? `Focus on clearing your <strong>${pendingOverdue.length} overdue task${pendingOverdue.length!==1?'s':''}</strong> today.` : 'Your desk schedule is clear today.'}`;
    }

    const items = classes.map(c => {
      const timeStr = `${formatTime(c.time)} – ${formatTime(c.end)}`;
      const meta = [c.room && c.room !== '—' ? c.room : null, c.teacher && c.teacher !== '—' ? c.teacher : null].filter(Boolean).join(' · ');
      return `<li><span class="cd-item-label">${escHtml(c.subject)}</span><span class="cd-item-meta">${timeStr}${meta ? ' · ' + escHtml(meta) : ''}</span></li>`;
    }).join('');

    let guidance = '';
    const next = getNextClass();
    if (next) {
      guidance = `<div style="margin-top:10px;font-size:0.78rem;color:var(--text-secondary);border-top:1px dashed var(--border);padding-top:8px">⏱️ Next up: <strong>${escHtml(next.subject)}</strong> at ${formatTime(next.time)}${next.room ? ' (' + escHtml(next.room) + ')' : ''}</div>`;
    } else {
      guidance = `<div style="margin-top:10px;font-size:0.78rem;color:var(--green);border-top:1px dashed var(--border);padding-top:8px">✓ All classes for today completed!</div>`;
    }

    return `<strong>${dayName}</strong> — ${classes.length} class${classes.length !== 1 ? 'es' : ''}:<ul class="cd-list">${items}</ul>${guidance}`;
  }

  function buildNextClass() {
    const hasAnyTT = Object.values(loadTimetable() || {}).some(arr => arr && arr.some(c => !isBreakEntry(c)));
    if (!hasAnyTT) {
      return `No timetable imported yet. Add or scan your schedule in the <a href="javascript:void(0)" onclick="navigate('timetable')" style="color:var(--accent);font-weight:600">Timetable tab</a>.`;
    }

    const todayClasses = getTodayClasses();
    if (todayClasses.length === 0) {
      return `No classes scheduled for today.`;
    }

    const next = getNextClass();
    const now = currentTimeMinutes();

    if (!next) {
      const remaining = getRemainingTodayClasses();
      if (remaining.length === 0) {
        return `🎉 All classes for today are finished! You're done for the day.`;
      }
      return `No upcoming class found. Check your timetable.`;
    }

    const startMin = timeToMinutes(next.time);
    const diff = startMin - now;
    const inStr = diff > 0 ? ` (in ${diff} min)` : '';
    const timeStr = `${formatTime(next.time)} – ${formatTime(next.end)}`;
    const meta = [next.room && next.room !== '—' ? next.room : null, next.teacher && next.teacher !== '—' ? next.teacher : null].filter(Boolean).join(' · ');

    return `Next class: <strong>${escHtml(next.subject)}</strong>${inStr}<br><span style="font-size:0.8rem;color:var(--text-secondary)">🕐 ${timeStr}${meta ? ' · ' + escHtml(meta) : ''}</span>`;
  }

  function buildAttendanceRisk() {
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    if (subjects.length === 0) {
      return `No subjects found yet. Set up your timetable or attendance baseline to start monitoring attendance health.`;
    }

    const target = getAttendanceTarget();
    const atRisk = [];
    const safe = [];
    const missingBaseline = [];

    subjects.forEach(s => {
      const att = getSubjectAttendance(s);
      if (!att.hasBaseline && att.total === 0) {
        missingBaseline.push(s);
      } else if (att.pct !== null && att.pct < target) {
        atRisk.push({ subject: s, att });
      } else if (att.pct !== null) {
        safe.push({ subject: s, att });
      }
    });

    if (atRisk.length === 0 && missingBaseline.length === subjects.length) {
      return `<div class="cd-tag is-warning" style="margin-bottom:8px">No Baseline Set</div><br>No attendance baseline recorded yet. Set your starting attendance counts in <a href="javascript:void(0)" onclick="navigate('subjects')" style="color:var(--accent);font-weight:600">Subject Hubs</a> to track risks.`;
    }

    if (atRisk.length > 0) {
      const items = atRisk.map(({ subject, att }) => {
        const guidance = calculateSmartAttendanceGuidance(att.present, att.absent + att.leave, target);
        const cleanMsg = guidance.message.replace(/<\/?strong>/g, '');
        return `<li><span class="cd-tag cd-tag-risk">${att.pct}%</span><span class="cd-item-label">${escHtml(subject.name)}</span><span class="cd-item-meta">${cleanMsg}</span></li>`;
      }).join('');

      return `<strong>${atRisk.length} subject${atRisk.length!==1?'s':''} below target (${target}%):</strong><ul class="cd-list">${items}</ul>`;
    }

    const highest = safe.sort((a, b) => b.att.pct - a.att.pct)[0];
    return `<span class="cd-tag cd-tag-safe">All Safe</span> <strong>All active subjects are safely at or above ${target}%!</strong><br><br>Highest: <strong>${escHtml(highest.subject.name)}</strong> (${highest.att.pct}%). Keep up the good momentum!`;
  }

  function buildAttendanceGeneral() {
    const { attended, skipped, total } = getOverallAttendance();
    if (total === 0) {
      return `<div class="cd-tag is-warning" style="margin-bottom:8px">Attendance Setup Incomplete</div><br>No attendance recorded yet. Enter your starting portal baseline counts in <a href="javascript:void(0)" onclick="showBaselineModal(null, 'manual')" style="color:var(--accent);font-weight:600">Subject Hubs</a> to unlock percentage tracking and safe skip guidance.<br><br><button class="btn btn-sm btn-primary" onclick="showBaselineModal(null, 'manual')" style="font-size:0.78rem;padding:5px 12px">📊 Set Baseline Counts →</button>`;
    }
    const pct = Math.round((attended / total) * 100);
    const target = getAttendanceTarget();
    const isSafe = pct >= target;
    const tag = isSafe
      ? '<span class="cd-tag cd-tag-safe">Safe Zone</span>'
      : '<span class="cd-tag cd-tag-risk">Risk Zone</span>';
    const guidance = calculateSmartAttendanceGuidance(attended, skipped, target);
    const cleanMsg = guidance.message.replace(/<\/?strong>/g, '');

    return `${tag}<strong>${pct}% overall attendance</strong> (${attended}/${total} sessions attended).<br><br>💡 ${cleanMsg}`;
  }

  function buildTasksUrgent() {
    const today = todayISO();
    const tomorrow = nDaysFromNow(1);
    const tasks = allTasks();

    const overdue = tasks.filter(t => isTaskOverdue(t));
    const dueToday = tasks.filter(t => t.status === 'pending' && !t.noDeadline && t.dueDate === today);
    const dueTomorrow = tasks.filter(t => t.status === 'pending' && !t.noDeadline && t.dueDate === tomorrow);

    const urgentTotal = overdue.length + dueToday.length + dueTomorrow.length;

    if (urgentTotal === 0) {
      return `<span class="cd-tag cd-tag-safe">Clear Desk</span> <strong>No urgent deadlines right now!</strong><br><br>No tasks are overdue or due in the next 24 hours. You're fully on track.`;
    }

    const items = [];
    overdue.forEach(t => {
      items.push(`<li><span class="cd-tag cd-tag-overdue">Overdue</span><span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${escHtml(t.subject || 'Task')} · Due ${fmtDate(t.dueDate)}</span></li>`);
    });
    dueToday.forEach(t => {
      items.push(`<li><span class="cd-tag cd-tag-today">Due Today</span><span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${escHtml(t.subject || 'Task')}</span></li>`);
    });
    dueTomorrow.forEach(t => {
      items.push(`<li><span class="cd-tag is-accent">Tomorrow</span><span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${escHtml(t.subject || 'Task')} · Due ${fmtDate(t.dueDate)}</span></li>`);
    });

    return `<strong>${urgentTotal} urgent task${urgentTotal!==1?'s':''}:</strong><ul class="cd-list">${items.join('')}</ul>`;
  }

  function buildSetupGaps() {
    const gaps = [];
    const tt = loadTimetable();
    const hasClasses = Object.values(tt || {}).some(arr => Array.isArray(arr) && arr.some(c => !isBreakEntry(c)));
    const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
    const baselines = loadAttendanceBaselines();
    const p = loadProfile() || liveProfile || {};

    // 1. Timetable Check
    if (!hasClasses) {
      gaps.push({
        title: 'Timetable Schedule',
        desc: 'No classes imported yet. Add or scan your schedule to unlock daily timetable intelligence.',
        btn: `<button class="btn btn-sm btn-secondary" onclick="navigate('timetable')" style="margin-top:4px;font-size:0.75rem;padding:3px 10px">📷 Scan Timetable →</button>`
      });
    }

    // 2. Attendance Baseline Check
    if (subjects.length > 0) {
      const missingBaselines = subjects.filter(s => {
        const codeKey = (s.code || '').trim();
        const nameKey = (s.name || '').trim();
        return !baselines[codeKey] && !baselines[nameKey];
      });
      if (missingBaselines.length > 0) {
        gaps.push({
          title: 'Attendance Baselines',
          desc: `${missingBaselines.length} of ${subjects.length} subjects missing initial attendance counts.`,
          btn: `<button class="btn btn-sm btn-secondary" onclick="navigate('subjects')" style="margin-top:4px;font-size:0.75rem;padding:3px 10px">📊 Set Baselines →</button>`
        });
      }
    }

    // 3. Profile & Practical Batch Check
    const missingProfile = [];
    if (!p.name) missingProfile.push('Name');
    if (!p.batch) missingProfile.push('Practical Batch');
    if (missingProfile.length > 0) {
      gaps.push({
        title: 'Student Profile',
        desc: `Add your ${missingProfile.join(' and ')} for personalized headers and batch filtering.`,
        btn: `<button class="btn btn-sm btn-secondary" onclick="navigate('settings')" style="margin-top:4px;font-size:0.75rem;padding:3px 10px">⚙️ Profile Settings →</button>`
      });
    }

    // 4. Desk Pollution / Decluttering Check
    if (typeof detectDeskPollution === 'function' && detectDeskPollution()) {
      gaps.push({
        title: 'Schedule Decluttering',
        desc: 'Detected duplicate or other-batch subject cards from an earlier timetable scan.',
        btn: `<button class="btn btn-sm btn-secondary" onclick="showDeclutterDeskModal()" style="margin-top:4px;font-size:0.75rem;padding:3px 10px">🧹 Declutter Desk →</button>`
      });
    }

    if (gaps.length === 0) {
      return `<div class="cd-tag cd-tag-safe" style="display:inline-flex;margin-bottom:8px">✓ Setup Complete</div><br><strong>Your desk setup is complete!</strong><br><br>Timetable, attendance baselines, and profile are all configured and active.`;
    }

    const items = gaps.map(g => `
      <li style="margin-bottom:8px">
        <div style="font-weight:600;color:var(--text-primary)">${g.title}</div>
        <div style="font-size:0.78rem;color:var(--text-muted)">${g.desc}</div>
        ${g.btn}
      </li>
    `).join('');

    return `<strong>${gaps.length} desk setup item${gaps.length !== 1 ? 's' : ''} to complete:</strong><ul class="cd-list" style="margin-top:8px">${items}</ul>`;
  }

  function buildClassesLeft() {
    const remaining = getRemainingTodayClasses();
    if (remaining.length === 0) {
      return `No more classes left today. You're done!`;
    }
    const items = remaining.map(c =>
      `<li><span class="cd-item-label">${escHtml(c.subject)}</span><span class="cd-item-meta">${formatTime(c.time)} – ${formatTime(c.end)}</span></li>`
    ).join('');
    return `<strong>${remaining.length} class${remaining.length !== 1 ? 'es' : ''}</strong> remaining today:<ul class="cd-list">${items}</ul>`;
  }

  function buildDaySchedule(q) {
    const lower = q.toLowerCase();
    let dayNum = -1;
    for (let i = 0; i < DAY_ABBR.length; i++) {
      if (lower.includes(DAY_ABBR[i]) || lower.includes(DAY_NAMES[i].toLowerCase())) {
        dayNum = i;
        break;
      }
    }
    if (dayNum < 0) return buildTodaySummary();

    const classes = getDayClasses(dayNum);
    const dayName = DAY_NAMES[dayNum];

    if (dayNum === 0) return `No classes on Sundays.`;
    if (classes.length === 0) return `No classes scheduled on ${dayName}.`;

    const items = classes.map(c => {
      const timeStr = `${formatTime(c.time)} – ${formatTime(c.end)}`;
      return `<li><span class="cd-item-label">${escHtml(c.subject)}</span><span class="cd-item-meta">${timeStr}</span></li>`;
    }).join('');

    return `<strong>${dayName}</strong> — ${classes.length} class${classes.length !== 1 ? 'es' : ''}:<ul class="cd-list">${items}</ul>`;
  }

  function buildTasksWeek() {
    const today = todayISO();
    const weekEnd = nDaysFromNow(7);
    const upcoming = allTasks().filter(t => t.status === 'pending' && !t.noDeadline && t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd);
    if (upcoming.length === 0) return `Nothing due in the next 7 days.`;
    const items = upcoming.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).map(t => {
      const isToday = t.dueDate === today;
      const tag = isToday ? '<span class="cd-tag cd-tag-today">Today</span>' : '';
      return `<li>${tag}<span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${escHtml(t.subject || 'Task')} · Due ${fmtDate(t.dueDate)}</span></li>`;
    }).join('');
    return `<strong>${upcoming.length} task${upcoming.length !== 1 ? 's' : ''} in the next 7 days:</strong><ul class="cd-list">${items}</ul>`;
  }

  function buildTasksAll() {
    const pending = allTasks().filter(t => t.status === 'pending');
    if (pending.length === 0) return `No pending tasks. Your desk is clear.`;
    const sorted = [...pending].sort((a, b) => {
      const isOngoingA = !!a.noDeadline || (a.taskType === 'mission' && !a.dueDate);
      const isOngoingB = !!b.noDeadline || (b.taskType === 'mission' && !b.dueDate);
      if (isOngoingA && !isOngoingB) return 1;
      if (!isOngoingA && isOngoingB) return -1;
      if (isOngoingA && isOngoingB) return a.title.localeCompare(b.title);
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    });
    const items = sorted.map(t => {
      const isOngoing = !!t.noDeadline || (t.taskType === 'mission' && !t.dueDate);
      const isOverdue = isTaskOverdue(t);
      const tag = isOngoing
        ? '<span class="cd-tag is-purple">Mission</span>'
        : isOverdue ? '<span class="cd-tag cd-tag-overdue">Overdue</span>' : '';
      const meta = isOngoing ? `${escHtml(t.subject || 'Task')} · Ongoing Mission` : `${escHtml(t.subject || 'Task')} · Due ${fmtDate(t.dueDate)}`;
      return `<li>${tag}<span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${meta}</span></li>`;
    }).join('');
    return `<strong>${pending.length} pending task${pending.length !== 1 ? 's' : ''}:</strong><ul class="cd-list">${items}</ul>`;
  }

  function buildNotices() {
    const importantNotices = NOTICES.filter(n => n.important);
    const allNotices = NOTICES;

    if (allNotices.length === 0) return `No notices posted yet.`;

    const items = allNotices.slice(0, 5).map(n => {
      const tag = n.important ? '<span class="cd-tag cd-tag-notice">Important</span>' : '';
      return `<li>${tag}<span class="cd-item-label">${escHtml(n.title)}</span><span class="cd-item-meta">${n.category} · ${fmtDate(n.date)}</span></li>`;
    }).join('');

    const header = importantNotices.length > 0
      ? `${importantNotices.length} important notice${importantNotices.length !== 1 ? 's' : ''}:`
      : `${allNotices.length} notice${allNotices.length !== 1 ? 's' : ''} posted:`;

    return `<strong>${header}</strong><ul class="cd-list">${items}</ul>`;
  }

  function buildProfile() {
    const p = loadProfile() || liveProfile || {};
    if (!p.name) return `Your profile isn't set up yet. Go to <a href="javascript:void(0)" onclick="navigate('settings')" style="color:var(--accent);font-weight:600">Settings</a> to add your name, batch, and branch.`;
    const lines = [
      p.name    ? `<li><span class="cd-item-label">Name</span><span class="cd-item-meta">${escHtml(p.name)}</span></li>` : '',
      p.branch  ? `<li><span class="cd-item-label">Branch</span><span class="cd-item-meta">${escHtml(p.branch)}</span></li>` : '',
      p.batch   ? `<li><span class="cd-item-label">Batch</span><span class="cd-item-meta">Batch ${escHtml(p.batch)}</span></li>` : '',
      p.year    ? `<li><span class="cd-item-label">Year</span><span class="cd-item-meta">${escHtml(p.year)}</span></li>` : '',
      p.college ? `<li><span class="cd-item-label">College</span><span class="cd-item-meta">${escHtml(p.college)}</span></li>` : '',
      p.rollNo  ? `<li><span class="cd-item-label">Roll No.</span><span class="cd-item-meta">${escHtml(p.rollNo)}</span></li>` : '',
    ].filter(Boolean).join('');
    return `<ul class="cd-list">${lines}</ul>`;
  }

  function buildUnknown() {
    return `I didn't quite get that. I can answer questions and trigger helpful actions grounded in your real desk data. Try:
      <ul class="cd-list" style="margin-top:6px">
        <li><strong>Plan my week</strong> — Weekly academic roadmap &amp; load rebalancing</li>
        <li><strong>Which subject needs the most attention</strong> — Academic focus radar</li>
        <li><strong>Review timetable import</strong> — Check unconfirmed imports or staging</li>
        <li><strong>What changed after cleanup</strong> — Post-declutter status &amp; recovery</li>
        <li><strong>Help me plan tonight</strong> — 3-block study schedule</li>
        <li><strong>Show my day</strong> — Today's classes &amp; tasks</li>
      </ul>`;
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Main Respond ──────────────────────────────────────────────
  function respond(query) {
    let intent = matchIntent(query);

    // Refinement: if 'today' in query, prefer today_summary over day_schedule
    if (intent === 'day_schedule' && /\btoday\b/i.test(query)) intent = 'today_summary';

    switch (intent) {
      case 'greeting':           return buildGreeting();
      case 'help':               return buildHelp();
      case 'parser_review':      return buildParserReview();
      case 'cleanup_followup':   return buildCleanupFollowup();
      case 'weekly_plan':        return buildWeeklyPlan();
      case 'subject_guidance':   return buildSubjectGuidance();
      case 'import_timetable':   return buildImportTimetable();
      case 'setup_attendance':   return buildSetupAttendance();
      case 'subject_hubs':       return buildSubjectHubs();
      case 'declutter_desk':     return buildDeclutterDesk();
      case 'create_task':        return buildCreateTask(query);
      case 'study_plan':         return buildStudyPlan();
      case 'today_summary':      return buildTodaySummary();
      case 'next_class':         return buildNextClass();
      case 'attendance_risk':    return buildAttendanceRisk();
      case 'attendance_general': return buildAttendanceGeneral();
      case 'tasks_urgent':       return buildTasksUrgent();
      case 'tasks_week':         return buildTasksWeek();
      case 'tasks_all':          return buildTasksAll();
      case 'setup_gaps':         return buildSetupGaps();
      case 'classes_left':       return buildClassesLeft();
      case 'day_schedule':       return buildDaySchedule(query);
      case 'notices':            return buildNotices();
      case 'profile':            return buildProfile();
      default: {
        // Dynamic check against all user subjects
        const subjects = (typeof getSubjectList === 'function') ? getSubjectList() : [];
        const lQuery = query.toLowerCase();
        for (const s of subjects) {
          if ((s.name && lQuery.includes(s.name.toLowerCase())) || (s.code && s.code.length >= 2 && lQuery.includes(s.code.toLowerCase()))) {
            const tt = loadTimetable();
            const classes = [];
            [1,2,3,4,5,6,0].forEach(d => {
              (tt[d] || []).forEach(c => {
                if (isTeachingClass(c) && c.subject && c.subject.toLowerCase() === s.name.toLowerCase()) {
                  classes.push(`${DAY_SHORT[d]} ${c.time}–${c.end || 'end'}${c.room ? ' (' + c.room + ')' : ''}`);
                }
              });
            });
            const pTasks = allTasks().filter(t => t.subject && t.subject.toLowerCase() === s.name.toLowerCase() && t.status === 'pending');
            const att = getSubjectAttendance(s);
            let res = `<strong>${escHtml(s.name)}:</strong><br>`;
            if (classes.length) {
              res += `Schedule: ${classes.join(' · ')}<br>`;
            } else {
              res += `No weekly timetable slots scheduled.<br>`;
            }
            if (att.pct !== null) {
              res += `Attendance: <strong>${att.pct}%</strong> (${att.present}/${att.total} attended)<br>`;
            }
            if (pTasks.length) {
              res += `${pTasks.length} pending task${pTasks.length !== 1 ? 's' : ''}: ${pTasks.map(t => escHtml(t.title)).join(', ')}`;
            } else {
              res += `No pending tasks.`;
            }
            return res;
          }
        }
        return buildUnknown();
      }
    }
  }

  return { respond };
})();

// ── Assistant Panel UI ────────────────────────────────────────

let _assistantOpen = false;

function renderAssistantWelcome() {
  const thread = document.getElementById('cd-chat-thread');
  if (!thread) return;

  const tt = loadTimetable();
  const hasTT = Object.values(tt || {}).some(arr => Array.isArray(arr) && arr.some(c => !isBreakEntry(c)));
  const baselines = loadAttendanceBaselines();
  const hasBaselines = Object.keys(baselines || {}).length > 0;
  const isNewUser = !hasTT && !hasBaselines;

  if (isNewUser) {
    thread.innerHTML = `
      <div class="cd-welcome-card">
        <div class="cd-welcome-badge" style="background:var(--accent-dim);color:var(--brand-primary)">
          <span class="cd-dot-live"></span> ✨ Getting Started
        </div>
        <div class="cd-welcome-title">Welcome to Ask Desk</div>
        <div class="cd-welcome-sub">I answer academic questions grounded in your real timetable, tasks, and attendance.</div>
        <div class="cd-starter-grid">
          <button class="cd-starter-btn" onclick="sendAssistantMessage('Is anything missing from my setup?')">
            <span class="cd-starter-icon">⚙️</span>
            <strong>Setup Checklist</strong>
            <span>Check missing setup gaps</span>
          </button>
          <button class="cd-starter-btn" onclick="sendAssistantMessage('What do I have today?')">
            <span class="cd-starter-icon">📅</span>
            <strong>What do I have today?</strong>
            <span>Today's classes &amp; tasks</span>
          </button>
          <button class="cd-starter-btn" onclick="sendAssistantMessage('How is my attendance?')">
            <span class="cd-starter-icon">📊</span>
            <strong>How is my attendance?</strong>
            <span>Overall attendance status</span>
          </button>
          <button class="cd-starter-btn" onclick="sendAssistantMessage('What tasks are urgent?')">
            <span class="cd-starter-icon">⚡</span>
            <strong>What tasks are urgent?</strong>
            <span>Check pending deadlines</span>
          </button>
        </div>
      </div>
    `;
  } else {
    thread.innerHTML = `
      <div class="cd-welcome-card">
        <div class="cd-welcome-badge">
          <span class="cd-dot-live"></span> Ready with live desk data
        </div>
        <div class="cd-welcome-title">How can I help you today?</div>
        <div class="cd-welcome-sub">Grounded in your real timetable, task deadlines, and attendance logs.</div>
        <div class="cd-starter-grid">
          <button class="cd-starter-btn" onclick="sendAssistantMessage('What do I have today?')">
            <span class="cd-starter-icon">📅</span>
            <strong>What do I have today?</strong>
            <span>Today's schedule &amp; tasks</span>
          </button>
          <button class="cd-starter-btn" onclick="sendAssistantMessage('What is my next class?')">
            <span class="cd-starter-icon">⏰</span>
            <strong>What is my next class?</strong>
            <span>Next upcoming lecture/lab</span>
          </button>
          <button class="cd-starter-btn" onclick="sendAssistantMessage('Which subject needs attention?')">
            <span class="cd-starter-icon">🎯</span>
            <strong>Focus Radar</strong>
            <span>Subject risk &amp; priority check</span>
          </button>
          <button class="cd-starter-btn" onclick="sendAssistantMessage('How is my attendance?')">
            <span class="cd-starter-icon">📊</span>
            <strong>How is my attendance?</strong>
            <span>Overall record &amp; safe skips</span>
          </button>
          <button class="cd-starter-btn" onclick="sendAssistantMessage('What tasks are urgent?')">
            <span class="cd-starter-icon">⚡</span>
            <strong>What tasks are urgent?</strong>
            <span>Deadlines due today or overdue</span>
          </button>
          <button class="cd-starter-btn" onclick="sendAssistantMessage('Is anything missing from my setup?')">
            <span class="cd-starter-icon">⚙️</span>
            <strong>Setup Checklist</strong>
            <span>Check desk health &amp; gaps</span>
          </button>
        </div>
      </div>
    `;
  }
}

function clearAssistantChat() {
  renderAssistantWelcome();
  showToast('Chat cleared', 'info');
}

function openAssistant() {
  _assistantOpen = true;
  const panel   = document.getElementById('cd-assistant-panel');
  const overlay = document.getElementById('cd-assistant-overlay');
  const btn     = document.getElementById('assistant-toggle-btn');
  if (!panel) return;

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  overlay?.classList.add('open');
  btn?.setAttribute('aria-expanded', 'true');

  const thread = document.getElementById('cd-chat-thread');
  if (thread && thread.children.length === 0) {
    renderAssistantWelcome();
  }

  setTimeout(() => document.getElementById('cd-input')?.focus(), 250);
}

function closeAssistant() {
  _assistantOpen = false;
  const panel   = document.getElementById('cd-assistant-panel');
  const overlay = document.getElementById('cd-assistant-overlay');
  const btn     = document.getElementById('assistant-toggle-btn');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  overlay?.classList.remove('open');
  btn?.setAttribute('aria-expanded', 'false');
}

function toggleAssistant() {
  _assistantOpen ? closeAssistant() : openAssistant();
}

function sendAssistantMessage(presetText) {
  const input = document.getElementById('cd-input');
  const q = (presetText || (input ? input.value : '')).trim();
  if (!q) return;
  if (input) input.value = '';

  const thread = document.getElementById('cd-chat-thread');
  if (!thread) return;

  // Clear welcome card on first real message
  const welcome = thread.querySelector('.cd-welcome-card, .cd-welcome');
  if (welcome) welcome.remove();

  // Render user bubble
  const userMsg = document.createElement('div');
  userMsg.className = 'cd-msg cd-msg-user';
  userMsg.innerHTML = `<div class="cd-bubble">${escHtml_cd(q)}</div>`;
  thread.appendChild(userMsg);

  // Typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'cd-msg cd-msg-bot';
  typingEl.innerHTML = `<div class="cd-typing"><span></span><span></span><span></span></div>`;
  thread.appendChild(typingEl);
  thread.scrollTop = thread.scrollHeight;

  // Respond after brief delay (feels natural, not instant)
  setTimeout(() => {
    typingEl.remove();
    const response = ClarityAssistant.respond(q);

    const botMsg = document.createElement('div');
    botMsg.className = 'cd-msg cd-msg-bot';
    botMsg.innerHTML = `<div class="cd-bubble">${response}</div>`;
    thread.appendChild(botMsg);
    thread.scrollTop = thread.scrollHeight;
  }, 380);
}

function escHtml_cd(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Keyboard shortcut: Ctrl+/ to toggle assistant
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '/') {
    e.preventDefault();
    toggleAssistant();
  }
  if (e.key === 'Escape' && _assistantOpen) {
    closeAssistant();
  }
});

// ── Global Handlers ───────────────────────────────────────────

window.navigateTo       = navigate;
window.setTTDay         = (d) => { state.ttDay = d; renderTimetable(); };
window.setAssignFilter  = (f) => { state.assignFilter = f; renderAssignments(); };
window.setAssignSubject = (s) => { state.assignSubjectFilter = s; renderAssignments(); };
window.filterNotices    = (q) => { state.noticeSearch = q; renderNotices(); };
window.showNotice       = showNotice;
window.showAddTaskModal = showAddTaskModal;
window.submitAddTask    = submitAddTask;
window.saveSettings     = saveSettings;
window.exportData       = exportData;
window.importData       = importData;
window.confirmClearTasks = confirmClearTasks;
window.setTheme         = setTheme;
window.loginWithGoogle  = loginWithGoogle;
window.loginWithGoogleRedirect = loginWithGoogleRedirect;
window.logoutUser       = logoutUser;
window.triggerTimetableImport  = triggerTimetableImport;
window.resetTimetableToDefault = resetTimetableToDefault;
window.loadOfficialAidsTimetable = loadOfficialAidsTimetable;
window.showTimetableEntryModal = showTimetableEntryModal;
window.saveTimetableEntry      = saveTimetableEntry;
window.deleteTimetableEntry    = deleteTimetableEntry;
window.saveLinkSubject         = typeof saveLinkSubject !== 'undefined' ? saveLinkSubject : window.saveLinkSubject;
window.saveLinkResource        = typeof saveLinkResource !== 'undefined' ? saveLinkResource : window.saveLinkResource;
window.switchResourcesTab     = switchResourcesTab;
window.renderResources        = renderResources;
window.showNoticeChannelModal = showNoticeChannelModal;
window.submitNoticeChannelModal = submitNoticeChannelModal;
window.handleNoticeSourceClick = handleNoticeSourceClick;
window.showDevNotesModal      = showDevNotesModal;
window.saveNoticeChannelsFromSettings = saveNoticeChannelsFromSettings;

// Attendance Baseline & Live Actions
window.showBaselineModal           = showBaselineModal;
window.switchBaselineModalTab      = switchBaselineModalTab;
window.triggerAttendancePhotoScan  = triggerAttendancePhotoScan;
window.handleAttendancePhotoUpload = handleAttendancePhotoUpload;
window.cancelAttendancePhotoScan   = cancelAttendancePhotoScan;
window.onBaselineSubjectChange     = onBaselineSubjectChange;
window.updateBaselinePreview       = updateBaselinePreview;
window.saveSubjectBaselineFromModal = saveSubjectBaselineFromModal;
window.clearSubjectBaseline        = clearSubjectBaseline;
window.logSubjectAttendanceAction  = logSubjectAttendanceAction;
window.undoSubjectAttendanceAction = undoSubjectAttendanceAction;
window.onReviewRowInputChange      = onReviewRowInputChange;
window.deleteReviewRow             = deleteReviewRow;
window.addScanReviewRow            = addScanReviewRow;
window.saveAllReviewedBaselines    = saveAllReviewedBaselines;
window.showAttendanceScanReviewModal = showAttendanceScanReviewModal;

// Timetable Image Upload & Preview Modal
window.showTimetablePreviewModal      = showTimetablePreviewModal;
window.onTimetablePreviewBatchChange  = onTimetablePreviewBatchChange;
window.updatePreviewEntry             = updatePreviewEntry;
window.removePreviewEntry             = removePreviewEntry;
window.confirmSaveExtractedTimetable  = window.confirmSaveExtractedTimetable;
window.showTimetableUploadErrorModal  = showTimetableUploadErrorModal;

// Declutter & Subject Recovery Engine
window.showDeclutterDeskModal         = showDeclutterDeskModal;
window.proceedToDeclutterPreview      = proceedToDeclutterPreview;
window.confirmExecuteDeclutter        = confirmExecuteDeclutter;
window.executeDeclutterPlan           = executeDeclutterPlan;
window.detectDeskPollution            = detectDeskPollution;
window.showRestoreDeskModal           = showRestoreDeskModal;
window.confirmExecuteRestore          = confirmExecuteRestore;
window.loadDeclutterBackup            = loadDeclutterBackup;

// Desk Assistant
window.toggleAssistant       = toggleAssistant;
window.openAssistant         = openAssistant;
window.closeAssistant        = closeAssistant;
window.sendAssistantMessage  = sendAssistantMessage;
window.clearAssistantChat    = clearAssistantChat;

window.toggleAssignment = (id) => {
  // Custom task
  const ct = state.customTasks.find(x => x.id === id);
  if (ct) {
    const isNowDone = ct.status !== 'submitted';
    ct.status = isNowDone ? 'submitted' : 'pending';
    saveCustomTasks();
    if (isNowDone) {
      showToast('Task marked completed ✓', 'success');
    } else {
      showToast('Task moved back to pending', 'info');
    }
    renderPage(state.currentPage);
    updateNavBadges();
    return;
  }
  // Data.js assignment
  const a = state.assignments.find(x => x.id === id);
  if (!a) return;
  const isNowDone = a.status !== 'submitted';
  a.status = isNowDone ? 'submitted' : 'pending';
  saveAssignments();
  if (isNowDone) {
    showToast('Task marked completed ✓', 'success');
  } else {
    showToast('Task moved back to pending', 'info');
  }
  renderPage(state.currentPage);
  updateNavBadges();
};

window.deleteCustomTask = (id) => {
  if (!confirm('Delete this task?')) return;
  state.customTasks = state.customTasks.filter(t => t.id !== id);
  saveCustomTasks();
  showToast('Task removed from desk', 'info');
  renderPage(state.currentPage);
  updateNavBadges();
};

function handleGlobalSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return;
  state.noticeSearch = q;
  navigate('notices');
}

// ── Nav Badge Update ──────────────────────────────────────────
function updateNavBadges() {
  const pending = pendingCount();

  // Update browser tab title with pending count
  document.title = pending > 0 ? `(${pending}) Clarity Desk` : 'Clarity Desk';

  document.querySelectorAll('[data-nav="assignments"]').forEach(el => {
    // Sidebar: dot indicator (no badge number)
    const dot = el.querySelector('.nav-alert-dot');
    if (dot) dot.style.display = pending > 0 ? 'block' : 'none';
    el.classList.toggle('has-overdue', pending > 0);
    // Bottom nav: keep the dot behavior
    const bnavDot = el.querySelector('.bnav-dot');
    if (bnavDot) bnavDot.style.display = pending > 0 ? 'block' : 'none';
  });
}
window.updateNavBadges = updateNavBadges;

window.requestNotificationPermission = requestNotificationPermission;

// ── Init ──────────────────────────────────────────────────────
function init() {
  initTheme();
  updateTopbarProfile();
  setupFABDrag();

  // Attach event listeners to all navigation items with data-nav
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      const page = el.dataset.nav;
      if (page) navigate(page);
    });
  });

  document.getElementById('global-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleGlobalSearch(e.target.value);
  });

  const pending = window._pendingNav;
  if (pending) {
    delete window._pendingNav;
    navigate(pending);
  } else {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    navigate(hash);
  }

  // Deep-link routing for notification clicks and browser back/forward hash navigation
  window.addEventListener('hashchange', () => {
    const targetHash = window.location.hash.replace('#', '') || 'dashboard';
    if (targetHash && targetHash !== state.currentPage && targetHash !== state.resourcesTab) {
      navigate(targetHash);
    }
  });

  updateNavBadges();
  checkOnboarding();

  // Check and schedule task & notice notifications
  checkScheduledNotifications();
  checkNoticeNotifications();
  setInterval(() => {
    checkScheduledNotifications();
    checkNoticeNotifications();
  }, 60000);

  // Initialize Firebase Auth & Firestore sync
  initFirebase();

  // Register PWA Service Worker for offline support
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.update();
    }).catch(err => {
      console.warn('ServiceWorker registration skipped or failed:', err);
    });
  }

  // Network connectivity status listeners
  window.addEventListener('online', () => {
    showToast('Back online — cloud sync active ✓', 'success');
    updateSyncUI();
  });
  window.addEventListener('offline', () => {
    showToast('Offline mode — changes saved locally to your device', 'info');
    updateSyncUI('offline');
  });
}

document.addEventListener('DOMContentLoaded', init);

function setupFABDrag() {
  const fab = document.querySelector('.fab');
  if (!fab) return;

  let isDragging = false;
  let hasMoved = false;
  let startX = 0;
  let initialLeft = 0;
  let clickPrevented = false;
  // First-time hint
  let hintEl = null;
  if (window.innerWidth <= 768 && !localStorage.getItem('fabHintDismissed')) {
    hintEl = document.createElement('div');
    hintEl.className = 'fab-hint';
    hintEl.innerText = 'Drag me left/right';
    fab.appendChild(hintEl);
  }

  const applySnapPosition = (pos) => {
    if (window.innerWidth > 768) return;
    fab.style.right = 'auto';
    if (pos === 'left') {
      fab.style.left = '16px';
      fab.style.transform = 'none';
    } else if (pos === 'right') {
      fab.style.left = 'auto';
      fab.style.right = '16px';
      fab.style.transform = 'none';
    } else if (pos === 'center') {
      fab.style.left = '50%';
      fab.style.transform = 'translateX(-50%)';
    }
  };
  const savedPos = localStorage.getItem('fabPosition');
  if (savedPos) applySnapPosition(savedPos);

  const getClientX = (e) => e.touches ? e.touches[0].clientX : e.clientX;

  const onStart = (e) => {
    if (window.innerWidth > 768) return; // Only drag on mobile
    isDragging = true;
    hasMoved = false;
    clickPrevented = false;
    startX = getClientX(e);
    const rect = fab.getBoundingClientRect();
    initialLeft = rect.left;
    
    // Convert current position to left-based so drag is 1:1
    fab.style.right = 'auto';
    fab.style.left = initialLeft + 'px';
    fab.style.transform = 'none';
  };

  const onMove = (e) => {
    if (!isDragging || window.innerWidth > 768) return;
    const currentX = getClientX(e);
    const diff = currentX - startX;
    
    if (Math.abs(diff) > 5) {
      hasMoved = true;
      if (hintEl) {
        hintEl.remove();
        hintEl = null;
        localStorage.setItem('fabHintDismissed', 'true');
      }
      fab.classList.add('dragging');
      if (e.cancelable) e.preventDefault(); // Prevent scrolling while actively dragging horizontally
    }
    
    if (hasMoved) {
      let newLeft = initialLeft + diff;
      const maxLeft = window.innerWidth - fab.offsetWidth - 16;
      if (newLeft < 16) newLeft = 16;
      if (newLeft > maxLeft) newLeft = maxLeft;
      fab.style.left = newLeft + 'px';
    }
  };

  const onEnd = (e) => {
    if (!isDragging) return;
    isDragging = false;
    fab.classList.remove('dragging');
    
    if (hasMoved) {
      clickPrevented = true; // Mark to prevent the next click
      const rect = fab.getBoundingClientRect();
      const center = rect.left + (rect.width / 2);
      const w = window.innerWidth;
      
      fab.style.right = 'auto';
      let snapPos = 'right';
      if (center < w * 0.33) snapPos = 'left';
      else if (center > w * 0.66) snapPos = 'right';
      else snapPos = 'center';
      applySnapPosition(snapPos);
      localStorage.setItem('fabPosition', snapPos);
    }
  };

  fab.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  
  fab.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);

  // Handle desktop resize reset
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      fab.style.left = '';
      fab.style.right = '';
      fab.style.transform = '';
      fab.classList.remove('dragging');
    }
  });

  // Intercept the click event on FAB to prevent opening if we dragged
  fab.addEventListener('click', (e) => {
    if (clickPrevented) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      clickPrevented = false; // Reset for next tap
    }
  }, true); // use capture phase
}
