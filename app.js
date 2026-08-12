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
    college:  getCleanVal(saved.college, STUDENT.college, ['your college']),
    branch:   getCleanVal(saved.branch, STUDENT.branch, ['artificial intelligence & data science', 'artificial intelligence']),
    year:     getCleanVal(saved.year, STUDENT.year, ['2nd year — semester 3', '2nd year']),
    rollNo:   getCleanVal(saved.rollNo, STUDENT.rollNo, ['your roll no.']),
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
  const btn  = document.getElementById('sync-status-btn');
  if (!icon) return;

  if (status === 'denied') {
    icon.textContent = '🔒';
    if (btn) btn.title = 'Access Denied — check Firestore rules';
  } else if (currentUser) {
    icon.textContent = '⚡';
    if (btn) btn.title = 'Synced to cloud';
  } else {
    icon.textContent = '☁️';
    if (btn) btn.title = 'Local only — sign in to sync';
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
      const MAX_DIM = 2000;
      let width = img.width;
      let height = img.height;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      
      ctx.drawImage(img, 0, 0, width, height);
      
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const contrast = 1.5;
        const val = ((avg / 255 - 0.5) * contrast + 0.5) * 255;
        const clamped = Math.max(0, Math.min(255, val));
        data[i] = clamped;
        data[i + 1] = clamped;
        data[i + 2] = clamped;
      }
      
      // Margin Trimming
      let top = 0, bottom = height - 1, left = 0, right = width - 1;
      const threshold = 240;
      
      // Top
      for (let y = 0; y < height; y++) {
        let darkPixels = 0;
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4] < threshold) darkPixels++;
        }
        if (darkPixels > width * 0.01) { top = y; break; }
      }
      // Bottom
      for (let y = height - 1; y >= top; y--) {
        let darkPixels = 0;
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4] < threshold) darkPixels++;
        }
        if (darkPixels > width * 0.01) { bottom = y; break; }
      }
      // Left
      for (let x = 0; x < width; x++) {
        let darkPixels = 0;
        for (let y = top; y <= bottom; y++) {
          if (data[(y * width + x) * 4] < threshold) darkPixels++;
        }
        if (darkPixels > (bottom - top) * 0.01) { left = x; break; }
      }
      // Right
      for (let x = width - 1; x >= left; x--) {
        let darkPixels = 0;
        for (let y = top; y <= bottom; y++) {
          if (data[(y * width + x) * 4] < threshold) darkPixels++;
        }
        if (darkPixels > (bottom - top) * 0.01) { right = x; break; }
      }
      
      // Add a small padding back
      const padding = 20;
      top = Math.max(0, top - padding);
      bottom = Math.min(height - 1, bottom + padding);
      left = Math.max(0, left - padding);
      right = Math.min(width - 1, right + padding);
      
      const trimW = right - left + 1;
      const trimH = bottom - top + 1;
      
      // We need to re-put the data and then crop
      ctx.putImageData(imageData, 0, 0);
      
      const trimmedCanvas = document.createElement('canvas');
      trimmedCanvas.width = trimW;
      trimmedCanvas.height = trimH;
      const trimmedCtx = trimmedCanvas.getContext('2d');
      trimmedCtx.drawImage(canvas, left, top, trimW, trimH, 0, 0, trimW, trimH);
      
      resolve(trimmedCanvas.toDataURL(mimeType, 0.9));
    };
    img.onerror = () => reject(new Error("Failed to load image for preprocessing"));
    img.src = `data:${mimeType};base64,${base64Data}`;
  });
}

function cleanupTimetableDomain(rawText) {
  let remaining = rawText.replace(/\b(?:class|lecture|time|day|period)\b/gi, '').trim();
  
  // Extract room
  let room = '';
  const roomMatch = remaining.match(/\b(LT-?\d+|Room\s*\d+|L-?\d+)\b/i);
  if (roomMatch) {
    room = roomMatch[1];
    remaining = remaining.replace(roomMatch[0], '').trim();
  }
  
  // Extract teacher
  let teacher = '';
  const teacherMatch = remaining.match(/\b(Prof\.?\s+\w+|Dr\.?\s+\w+)\b/i);
  if (teacherMatch) {
    teacher = teacherMatch[1];
    remaining = remaining.replace(teacherMatch[0], '').trim();
  }
  
  // Extract course code
  let code = '';
  const codeMatch = remaining.match(/\b([A-Z]{2,4}-?\d{3,4})\b/i);
  if (codeMatch) {
    code = codeMatch[1];
    remaining = remaining.replace(codeMatch[0], '').trim();
  }
  
  // Extract type
  let type = 'lecture';
  if (remaining.toLowerCase().includes('lab')) {
    type = 'lab';
    remaining = remaining.replace(/\blab\b/i, '').trim();
  } else if (remaining.toLowerCase().match(/\btutorial|tut\b/i)) {
    type = 'tutorial';
    remaining = remaining.replace(/\btutorial|tut\b/i, '').trim();
  }
  
  const timeRegex = /\b([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\s*(?:-|to|~)\s*([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\b/i;
  remaining = remaining.replace(timeRegex, '').trim();
  
  // Clean junk (numbers only, pure symbols)
  let subject = remaining.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (/^\d+$/.test(subject) || subject.length < 2) subject = '';
  
  subject = subject || 'Unknown Subject';
  const isUncertain = subject === 'Unknown Subject' || !room;
  
  return { subject, room, teacher, code, type, isUncertain };
}

function parseTimetableFromGrid(ocrData) {
  let confidence = 0;
  const schedule = [];
  let parsedCount = 0;
  let rejectedCount = 0;
  
  if (!ocrData || !ocrData.words || ocrData.words.length === 0) {
    console.log("[GeometricParser] No words found in OCR data.");
    return { schedule, confidence: 0, ambiguous: true };
  }
  
  console.log(`[GeometricParser] OCR words count: ${ocrData.words.length}`);
  
  // 1. Clean and filter words
  const words = ocrData.words.map(w => ({
    text: w.text.trim(),
    bbox: w.bbox,
    conf: w.confidence,
    cx: (w.bbox.x0 + w.bbox.x1) / 2,
    cy: (w.bbox.y0 + w.bbox.y1) / 2
  })).filter(w => w.text.length > 0);
  
  // 2. Group into rows by Y overlap
  const rows = [];
  words.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  
  for (const word of words) {
    let added = false;
    for (const row of rows) {
      const rowY0 = row.reduce((sum, w) => sum + w.bbox.y0, 0) / row.length;
      const rowY1 = row.reduce((sum, w) => sum + w.bbox.y1, 0) / row.length;
      
      const overlap = Math.max(0, Math.min(word.bbox.y1, rowY1) - Math.max(word.bbox.y0, rowY0));
      const wordHeight = word.bbox.y1 - word.bbox.y0;
      
      if (overlap / wordHeight > 0.4) {
        row.push(word);
        added = true;
        break;
      }
    }
    if (!added) {
      rows.push([word]);
    }
  }
  
  rows.forEach(r => r.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  
  console.log(`[GeometricParser] Detected ${rows.length} visual rows.`);
  if (rows.length > 3) confidence += 20;

  // 3. Cluster columns by X centers
  const xCenters = words.map(w => w.cx).sort((a, b) => a - b);
  const cols = [];
  let currentCol = [xCenters[0]];
  for (let i = 1; i < xCenters.length; i++) {
    if (xCenters[i] - xCenters[i-1] < 40) {
      currentCol.push(xCenters[i]);
    } else {
      cols.push(currentCol.reduce((a, b) => a + b, 0) / currentCol.length);
      currentCol = [xCenters[i]];
    }
  }
  cols.push(currentCol.reduce((a, b) => a + b, 0) / currentCol.length);
  console.log(`[GeometricParser] Detected ${cols.length} logical columns.`);
  if (cols.length > 4) confidence += 10;

  // Assign cell indices to words
  const grid = [];
  for (let i = 0; i < rows.length; i++) {
    const rowWords = rows[i];
    const gridRow = new Array(cols.length).fill('');
    
    for (const w of rowWords) {
      let closestColIdx = 0;
      let minDiff = Infinity;
      for (let j = 0; j < cols.length; j++) {
        const diff = Math.abs(w.cx - cols[j]);
        if (diff < minDiff) {
          minDiff = diff;
          closestColIdx = j;
        }
      }
      gridRow[closestColIdx] = gridRow[closestColIdx] ? gridRow[closestColIdx] + ' ' + w.text : w.text;
    }
    grid.push(gridRow);
  }

  // 4. Determine Orientation (Rows = Days or Cols = Days)
  const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  
  let dayColIdx = -1;
  let dayRowIdx = -1;
  
  for (let c = 0; c < cols.length; c++) {
    let dayCount = 0;
    for (let r = 0; r < rows.length; r++) {
      const cellText = grid[r][c].toLowerCase();
      if (dayNames.some(d => cellText.includes(d))) dayCount++;
    }
    if (dayCount >= 3) { dayColIdx = c; break; }
  }
  
  if (dayColIdx === -1) {
    for (let r = 0; r < rows.length; r++) {
      let dayCount = 0;
      for (let c = 0; c < cols.length; c++) {
        const cellText = grid[r][c].toLowerCase();
        if (dayNames.some(d => cellText.includes(d))) dayCount++;
      }
      if (dayCount >= 3) { dayRowIdx = r; break; }
    }
  }
  
  const orientation = dayColIdx !== -1 ? 'Time-by-Day' : (dayRowIdx !== -1 ? 'Day-by-Time' : 'Unknown');
  console.log(`[GeometricParser] Chosen orientation: ${orientation}`);
  
  if (orientation !== 'Unknown') confidence += 30;

  const timeRegex = /\b([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\s*(?:-|to|~)\s*([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\b/i;
  
  // 5. Parse Schedule based on orientation
  if (orientation === 'Time-by-Day') {
    let timeRowIdx = 0;
    let maxTimes = 0;
    for (let r = 0; r < Math.min(3, rows.length); r++) {
      let timeCount = 0;
      for (let c = 0; c < cols.length; c++) {
        if (grid[r][c].match(timeRegex)) timeCount++;
      }
      if (timeCount > maxTimes) { maxTimes = timeCount; timeRowIdx = r; }
    }
    
    for (let r = 0; r < rows.length; r++) {
      const dayCell = grid[r][dayColIdx].toLowerCase();
      const matchedDay = dayNames.find(d => dayCell.includes(d));
      if (!matchedDay) continue;
      
      const dayStr = matchedDay.slice(0,3);
      const cleanDay = dayStr.charAt(0).toUpperCase() + dayStr.slice(1);
      
      for (let c = 0; c < cols.length; c++) {
        if (c === dayColIdx) continue;
        const cellText = grid[r][c];
        if (!cellText || cellText.length < 3) continue;
        
        let timeStr = '', endStr = '';
        const tMatch = grid[timeRowIdx][c].match(timeRegex);
        if (tMatch) {
          timeStr = `${tMatch[1].padStart(2, '0')}:${tMatch[2]}`;
          endStr = `${tMatch[3].padStart(2, '0')}:${tMatch[4]}`;
        } else {
          const localTMatch = cellText.match(timeRegex);
          if (localTMatch) {
            timeStr = `${localTMatch[1].padStart(2, '0')}:${localTMatch[2]}`;
            endStr = `${localTMatch[3].padStart(2, '0')}:${localTMatch[4]}`;
          }
        }
        
        if (!timeStr) {
          console.log(`[GeometricParser] Rejected cell at r=${r} c=${c} due to missing time.`);
          rejectedCount++;
          continue;
        }
        
        const { subject, room, teacher, code, type, isUncertain } = cleanupTimetableDomain(cellText);
        if (subject && subject !== 'Unknown Subject') {
          schedule.push({ day: cleanDay, time: timeStr, end: endStr, subject, room, teacher, code, type, isUncertain });
          parsedCount++;
          confidence += 2;
        } else {
          console.log(`[GeometricParser] Rejected cell at r=${r} c=${c} due to invalid subject/junk text.`);
          rejectedCount++;
        }
      }
    }
  } else if (orientation === 'Day-by-Time') {
    let timeColIdx = 0;
    let maxTimes = 0;
    for (let c = 0; c < Math.min(3, cols.length); c++) {
      let timeCount = 0;
      for (let r = 0; r < rows.length; r++) {
        if (grid[r][c].match(timeRegex)) timeCount++;
      }
      if (timeCount > maxTimes) { maxTimes = timeCount; timeColIdx = c; }
    }
    
    for (let r = 0; r < rows.length; r++) {
      let timeStr = '', endStr = '';
      const tMatch = grid[r][timeColIdx].match(timeRegex);
      if (tMatch) {
        timeStr = `${tMatch[1].padStart(2, '0')}:${tMatch[2]}`;
        endStr = `${tMatch[3].padStart(2, '0')}:${tMatch[4]}`;
      }
      
      for (let c = 0; c < cols.length; c++) {
        if (c === timeColIdx) continue;
        
        const dayCell = grid[dayRowIdx][c].toLowerCase();
        const matchedDay = dayNames.find(d => dayCell.includes(d));
        if (!matchedDay) continue;
        
        const dayStr = matchedDay.slice(0,3);
        const cleanDay = dayStr.charAt(0).toUpperCase() + dayStr.slice(1);
        
        const cellText = grid[r][c];
        if (!cellText || cellText.length < 3) continue;
        
        let localTimeStr = timeStr, localEndStr = endStr;
        if (!localTimeStr) {
          const localTMatch = cellText.match(timeRegex);
          if (localTMatch) {
            localTimeStr = `${localTMatch[1].padStart(2, '0')}:${localTMatch[2]}`;
            localEndStr = `${localTMatch[3].padStart(2, '0')}:${localTMatch[4]}`;
          }
        }
        
        if (!localTimeStr) {
          console.log(`[GeometricParser] Rejected cell at r=${r} c=${c} due to missing time.`);
          rejectedCount++;
          continue;
        }
        
        const { subject, room, teacher, code, type, isUncertain } = cleanupTimetableDomain(cellText);
        if (subject && subject !== 'Unknown Subject') {
          schedule.push({ day: cleanDay, time: localTimeStr, end: localEndStr, subject, room, teacher, code, type, isUncertain });
          parsedCount++;
          confidence += 2;
        } else {
          console.log(`[GeometricParser] Rejected cell at r=${r} c=${c} due to invalid subject/junk text.`);
          rejectedCount++;
        }
      }
    }
  } else {
    console.log('[GeometricParser] Unknown orientation. Falling back to linear raw text scanning is skipped.');
  }
  
  confidence = Math.min(100, Math.round(confidence));
  console.log(`[GeometricParser] Final confidence: ${confidence}/100. Parsed: ${parsedCount}, Rejected: ${rejectedCount}`);
  return { schedule, confidence, ambiguous: rejectedCount > parsedCount || confidence < 40 };
}

async function extractTimetableFromImage(base64Data, mimeType) {
  updateTimetableLoadingModal("Preprocessing image for optimal OCR...");
  const preprocessedDataUrl = await preprocessImageForOCR(base64Data, mimeType);
  
  updateTimetableLoadingModal("Scanning text and structure with Tesseract.js...");
  const worker = await getTesseractWorker();
  const ocrResult = await worker.recognize(preprocessedDataUrl);
  
  updateTimetableLoadingModal("Reconstructing geometric grid...");
  let deterministicResult;
  try {
    deterministicResult = parseTimetableFromGrid(ocrResult.data);
  } catch (err) {
    console.error("[GeometricParser] Fatal crash inside grid parser:", err);
    // Safe fallback if parsing completely crashes
    deterministicResult = { schedule: [], confidence: 0, ambiguous: true };
  }
  
  // If deterministic parser has high confidence and no ambiguity, use it.
  // Otherwise, use AI Repair layer if available.
  if (deterministicResult.confidence > 80 && !deterministicResult.ambiguous && deterministicResult.schedule.length > 0) {
    return { schedule: deterministicResult.schedule, confidence: deterministicResult.confidence };
  }
  
  updateTimetableLoadingModal("Applying AI repair to messy OCR text...");
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
3. Identify typos caused by OCR (e.g. "0S" -> "OS", "10:Q0" -> "10:00") and fix them logically.
4. If an entry is too mangled to understand, set "isUncertain": true.`;

  const hasGroqKey = !!window.CAMPUS_OS_GROQ_KEY;
  const hasGeminiKey = !!window.CAMPUS_OS_GEMINI_KEY;

  if (!hasGroqKey && !hasGeminiKey) {
    console.log("[ExtractionPipeline] AI Repair skipped (no API key). Using geometric structural output.");
    // Return what we have, even if schedule is empty. We pass confidence up to the UI.
    return deterministicResult;
  }

  try {
    updateTimetableLoadingModal("Repairing partial rows with AI...");
    const rawOcrText = ocrResult.data.text; // Use raw text for AI context
    const aiResult = await AIService.generateContentFromText(rawOcrText, schemaInstruction);
    return { ...aiResult, confidence: deterministicResult.confidence };
  } catch (err) {
    console.warn("[ExtractionPipeline] AI Repair failed:", err);
    console.log("[ExtractionPipeline] Falling back to geometric output due to AI failure.");
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
      const confidence = result?.confidence || 0;

      if (schedule.length === 0) {
        if (confidence > 10) {
          // OCR found some timetable-like data but couldn't parse it well. Drop them in manual edit.
          console.log('[TimetableUpload] Deterministic parse was low confidence/ambiguous. Falling back to manual edit.');
          showTimetablePreviewModal([]);
          return;
        } else {
          // Total failure, probably not a timetable
          showTimetableUploadErrorModal(
            'No timetable entries could be read from this image. The image may be blurry, low-contrast, or not a timetable.',
            base64Data, mimeType
          );
          return;
        }
      }

      // ✅ SUCCESS → show preview/edit modal
      console.log('[TimetableUpload] Extraction successful. UI transitioning to showTimetablePreviewModal.');
      showTimetablePreviewModal(schedule);

    } catch (err) {
      document.getElementById('tt-loading-backdrop')?.remove();
      console.warn('[TimetableUpload] Extraction error:', err);
      console.log('[TimetableUpload] UI transitioning to showTimetableUploadErrorModal due to API/extraction failure.');
      const reason = err?.message || 'AI extraction service returned an error.';
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

function showTimetablePreviewModal(schedule) {
  pendingExtractedSchedule = JSON.parse(JSON.stringify(schedule));

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'tt-preview-backdrop';

  renderTimetablePreviewModalContent(backdrop);
  document.body.appendChild(backdrop);
}

function renderTimetablePreviewModalContent(backdrop) {
  const uncertainCount = pendingExtractedSchedule.filter(x => x.isUncertain).length;

  const rowsHtml = pendingExtractedSchedule.map((item, idx) => `
    <tr class="${item.isUncertain ? 'preview-row-uncertain' : ''}">
      <td>
        <select class="form-select" style="padding:4px 6px;font-size:0.8rem" onchange="updatePreviewEntry(${idx}, 'day', this.value)">
          ${['Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<option value="${d}" ${item.day===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </td>
      <td>
        <input type="text" class="form-input" style="padding:4px 4px;font-size:0.8rem;width:55px" value="${item.time || '10:00'}" onchange="updatePreviewEntry(${idx}, 'time', this.value)">
        -
        <input type="text" class="form-input" style="padding:4px 4px;font-size:0.8rem;width:55px" value="${item.end || '11:00'}" onchange="updatePreviewEntry(${idx}, 'end', this.value)">
      </td>
      <td>
        <input type="text" class="form-input" style="padding:4px 6px;font-size:0.8rem" value="${item.subject || ''}" placeholder="Subject" onchange="updatePreviewEntry(${idx}, 'subject', this.value)">
      </td>
      <td>
        <input type="text" class="form-input" style="padding:4px 6px;font-size:0.8rem;width:65px" value="${item.code || ''}" placeholder="Code" onchange="updatePreviewEntry(${idx}, 'code', this.value)">
      </td>
      <td>
        <input type="text" class="form-input" style="padding:4px 6px;font-size:0.8rem;width:65px" value="${item.room || ''}" placeholder="Room" onchange="updatePreviewEntry(${idx}, 'room', this.value)">
      </td>
      <td>
        <select class="form-select" style="padding:4px 6px;font-size:0.8rem;width:80px" onchange="updatePreviewEntry(${idx}, 'type', this.value)">
          <option value="lecture" ${item.type==='lecture'?'selected':''}>Lecture</option>
          <option value="lab" ${item.type==='lab'?'selected':''}>Lab</option>
          <option value="project" ${item.type==='project'?'selected':''}>Project</option>
          <option value="off" ${item.type==='off'?'selected':''}>Off</option>
        </select>
      </td>
      <td style="text-align:center">
        ${item.isUncertain ? '<span class="uncertain-badge" title="Uncertain AI entry — please check">⚠️ Review</span>' : '✓'}
      </td>
      <td>
        <button class="task-delete-btn" onclick="removePreviewEntry(${idx})">${icons.trash()}</button>
      </td>
    </tr>
  `).join('');

  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:780px;width:95%">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Extracted Timetable Preview</h2>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">
            ${pendingExtractedSchedule.length} classes extracted ${uncertainCount > 0 ? `· <span style="color:var(--yellow);font-weight:600">${uncertainCount} entries marked for review</span>` : ''}
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('tt-preview-backdrop').remove()">${icons.x()}</button>
      </div>

      <div style="overflow-x:auto;max-height:360px;margin-bottom:16px;border:1px solid var(--border);border-radius:var(--radius-sm)">
        <table class="preview-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Time</th>
              <th>Subject</th>
              <th>Code</th>
              <th>Room</th>
              <th>Type</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div style="display:flex;justify-space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <button class="btn-secondary" onclick="addPreviewEntry()" style="font-size:0.8rem;display:flex;align-items:center;gap:4px">
          ${icons.plus()} Add Class Row
        </button>

        <div style="display:flex;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('tt-preview-backdrop').remove()">Cancel</button>
          <button class="btn-primary" onclick="confirmSaveExtractedTimetable()">Confirm & Save Schedule</button>
        </div>
      </div>
    </div>
  `;
}

window.updatePreviewEntry = function(idx, key, val) {
  if (pendingExtractedSchedule[idx]) {
    pendingExtractedSchedule[idx][key] = val;
    if (key !== 'isUncertain') pendingExtractedSchedule[idx].isUncertain = false;
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
    subject: 'New Subject',
    code: 'SUB',
    room: 'LT-1',
    teacher: 'Faculty',
    type: 'lecture',
    isUncertain: false
  });
  const backdrop = document.getElementById('tt-preview-backdrop');
  if (backdrop) renderTimetablePreviewModalContent(backdrop);
};

window.confirmSaveExtractedTimetable = function() {
  if (!pendingExtractedSchedule.length) {
    alert("Timetable schedule is empty.");
    return;
  }

  const dayMap = { "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6 };
  const newTT = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };

  pendingExtractedSchedule.forEach(item => {
    const dayNum = dayMap[item.day] || 1;
    newTT[dayNum].push({
      time:    item.time || '10:00',
      end:     item.end || '11:00',
      subject: item.type === 'off' ? (item.subject || 'Off') : (item.subject || 'Class'),
      code:    item.type === 'off' ? (item.code || '') : (item.code || 'SUB'),
      room:    item.type === 'off' ? (item.room || '') : (item.room || 'LT-1'),
      teacher: item.type === 'off' ? (item.teacher || '') : (item.teacher || 'Faculty'),
      type:    item.type || 'lecture',
    });
  });

  Object.keys(newTT).forEach(d => {
    newTT[d].sort((a,b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  });

  saveTimetable(newTT);
  document.getElementById('tt-preview-backdrop')?.remove();
  alert("Timetable imported and saved successfully!");
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
      whatsappTitle: (saved.whatsappTitle || 'WhatsApp Group').trim(),
      whatsappUrl:   (saved.whatsappUrl || '').trim()
    };
  }
  return {
    officialTitle: 'Official Updates',
    officialUrl:   '',
    whatsappTitle: 'WhatsApp Group',
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
          <span class="modal-title">${isOfficial ? 'Configure Official Notice Source' : 'Configure WhatsApp Group'}</span>
        </div>
        <button class="modal-close" onclick="document.getElementById('notice-channel-modal-backdrop')?.remove()">${icons.x()}</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div style="font-size:0.82rem;color:var(--text-muted);line-height:1.45">
          ${isOfficial ? 'Set your college portal link, class channel, or department notice page URL.' : 'Set your official batch or class WhatsApp group invite link for 1-tap access.'}
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Card Title</label>
          <input type="text" class="form-input" id="nc-modal-title" value="${(currentTitle || '').replace(/"/g, '&quot;')}" placeholder="${isOfficial ? 'e.g. Official Updates or College Portal' : 'e.g. WhatsApp Group or Batch 2026'}">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Destination Link / URL</label>
          <input type="url" class="form-input" id="nc-modal-url" value="${(currentUrl || '').replace(/"/g, '&quot;')}" placeholder="${isOfficial ? 'https://college.edu/notices' : 'https://chat.whatsapp.com/invite...'}">
        </div>
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
    channels.whatsappTitle = title || 'WhatsApp Group';
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
    showToast(targetKey === 'official' ? 'Configure your official notice link' : 'Configure your WhatsApp group link', 'info');
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

    if (pct !== null && pct < 75) {
      const attKey = `att_warning_${today}`;
      if (!notifiedMap[attKey]) {
        dispatchNotification(`Attendance Alert: ${pct}%`, {
          body: `Your attendance is currently ${pct}% (below 75% target). Tap to review.`,
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
  'paper':           'paper-slate',
  'soft-neutral':    'paper-slate',
  'light':           'paper-slate',
  'cloud':           'paper-slate',
  'mist-blue':       'paper-slate',
  'glass':           'paper-slate',
  'quiet-dark':      'midnight-ink',
  'dark':            'midnight-ink',
  'cocoa-night':     'espresso-desk',
  'cafe-night':      'espresso-desk',
  'cafe':            'espresso-desk',
  'espresso-paper':  'espresso-desk',
  'stone':           'sandstone-notes',
  'sandstone':       'sandstone-notes',
  'warm-study':      'sandstone-notes',
  'sunset':          'sandstone-notes',
  'forest-study':    'nordic-frost',
  'emerald':         'nordic-frost'
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

  for (const [key, val] of Object.entries(SUBJECT_ALIASES)) {
    // Check key or value match
    if (text.toLowerCase().includes(key.toLowerCase()) || text.toLowerCase().includes(val.toLowerCase())) {
      subjectCode = key;
      subjectName = val;
      foundAlias = true;
      break;
    }
  }
  
  if (!foundAlias) {
    console.warn("[Quick Add] Unmapped subject for text:", text);
  }

  let dueDate = new Date();
  let dateFound = false;
  const lowerText = text.toLowerCase();
  
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
        <input type="text" id="quick-add-input" placeholder="Quick add: 'DS assignment due Friday'" style="flex:1;border:none;background:transparent;outline:none;font-size:0.9rem;color:var(--text-primary)" onkeypress="if(event.key==='Enter') handleQuickAdd()">
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
          ${isBusy ? '<span class="type-badge" style="background:rgba(245,158,11,0.15);color:var(--yellow);padding:2px 6px;font-size:0.65rem">🔥 Busy Day</span>' : ''}
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
    <div class="card" style="padding:18px 20px;margin-bottom:22px;background:var(--surface);border-left:4px solid var(--accent)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:0.95rem;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px">
            <span>⏪ Last Week's Reflection</span>
            <span class="type-badge" style="background:var(--accent-dim);color:var(--accent);font-size:0.7rem;padding:2px 8px">${formatDate(lookbackStr)} – ${formatDate(todayS)}</span>
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
              <span class="filter-chip" style="font-size:0.75rem;padding:3px 10px;background:rgba(16,185,129,0.08);color:var(--green);border:1px solid rgba(16,185,129,0.25)">
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
function calculateSmartAttendanceGuidance(totalAttended, totalSkipped, targetPct = 75) {
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
              <span class="type-badge" style="font-size:0.65rem;padding:2px 6px;background:${isLab ? 'rgba(16,185,129,0.15)' : 'var(--accent-dim)'};color:${isLab ? 'var(--green)' : 'var(--accent)'}">
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
            <button class="btn btn-sm" onclick="setAttendance('${dateStr}', '${classKey}', 'skipped')" aria-label="Mark ${c.subject} as bunked on ${formatDate(dateStr)}" aria-pressed="${status === 'skipped'}" style="padding:5px 12px;font-size:0.75rem;font-weight:700;border-radius:var(--radius-xs,6px);background:${status==='skipped'?'var(--red)':'var(--surface-2)'};color:${status==='skipped'?'white':'var(--text-primary)'};border:1px solid ${status==='skipped'?'var(--red)':'var(--border)'};cursor:pointer;transition:transform 0.1s ease">
              ${status==='skipped'?'✕ Bunked':'Bunked'}
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
      <div class="card" style="padding:16px;margin-bottom:16px;background:var(--surface-2);border-left:4px solid ${guidance.isSafe ? 'var(--green)' : 'var(--red)'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;font-size:0.98rem;color:var(--text-primary);display:flex;align-items:center;gap:8px">
              <span>Attendance Health &amp; Safe Bunks</span>
              ${streak > 0 ? `<span class="type-badge" style="background:rgba(245,158,11,0.15);color:var(--yellow);padding:2px 8px;font-size:0.7rem">🔥 ${streak}-Class Streak</span>` : ''}
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">Target threshold: <strong>75%</strong> minimum required attendance</div>
          </div>
          <span class="type-badge" style="font-size:0.75rem;padding:3px 9px;background:${guidance.isSafe ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${guidance.isSafe ? 'var(--green)' : 'var(--red)'}">
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
          Manage your class schedule, monitor attendance safety, track assignments, and access coursework notes with zero clutter.
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn-primary" onclick="showOnboardingStep2()" style="width:100%;padding:11px;font-weight:600;justify-content:center;font-size:0.88rem">Set Up My Profile →</button>
          <button class="btn-secondary" onclick="dismissOnboarding()" style="width:100%;padding:9px;font-size:0.84rem;justify-content:center">Explore First</button>
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
            <input type="text" class="form-input" id="ob-name" value="${(p.name||'').replace(/"/g, '&quot;')}" placeholder="Your full name (e.g. Sanghpal Bhakte)">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Roll Number <span style="color:var(--text-muted);font-weight:normal">(optional)</span></label>
            <input type="text" class="form-input" id="ob-roll" value="${(p.rollNo||'').replace(/"/g, '&quot;')}" placeholder="Roll number (optional)">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">College / University <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="ob-college" value="${(p.college||'').replace(/"/g, '&quot;')}" placeholder="College or University name">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Branch / Department</label>
            <input type="text" class="form-input" id="ob-branch" value="${(p.branch||'').replace(/"/g, '&quot;')}" placeholder="Branch (e.g. AI &amp; Data Science)">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Year &amp; Semester</label>
            <input type="text" class="form-input" id="ob-year" value="${(p.year||'').replace(/"/g, '&quot;')}" placeholder="Year &amp; semester (e.g. 2nd Year)">
          </div>

          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-top:4px">
            <div style="font-weight:600;font-size:0.86rem;color:var(--text-primary);margin-bottom:4px">
              Are you a Second Year (SY) AI &amp; Data Science student?
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.45;margin-bottom:10px">
              We have the official Sem 3 AI-DS class schedule pre-configured. You can load it right away, or start with a clean schedule to build or scan your own timetable.
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface)">
                <input type="radio" name="ob-tt-choice" value="aids" id="ob-tt-aids" style="accent-color:var(--accent)">
                <span>Yes, load SY AI-DS timetable</span>
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface)">
                <input type="radio" name="ob-tt-choice" value="clean" id="ob-tt-clean" checked style="accent-color:var(--accent)">
                <span>No, start clean</span>
              </label>
            </div>
          </div>

          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-top:4px">
            <div style="font-weight:600;font-size:0.86rem;color:var(--text-primary);margin-bottom:2px">
              Set your current attendance (Optional)
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.45;margin-bottom:10px">
              Add your present and absent counts once. Clarity Desk will continue from there.
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="showBaselineModal()" style="font-size:0.78rem;padding:5px 12px;display:inline-flex;align-items:center;gap:6px">
              📊 Set Current Attendance Counts →
            </button>
          </div>

          <div id="ob-error" style="color:var(--red);font-size:0.78rem;display:none">Please enter your Full Name and College to finish setup.</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="dismissOnboarding()" style="font-size:0.82rem">Skip</button>
          <button class="btn-primary" onclick="finishOnboarding()" style="font-size:0.85rem;padding:8px 18px">Finish Setup</button>
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
    examDate: liveProfile.examDate || '',
  };

  safeSetStorage(KEY_PROFILE, profile);
  Object.assign(liveProfile, profile);
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
    for (const [key, val] of Object.entries(SUBJECT_ALIASES)) {
      if (text.includes(key.toLowerCase()) || text.includes(val.toLowerCase())) {
        intentType = 'subject-tasks';
        intentData.subject = key;
        intentData.window = text.includes('next week') ? 'next-week' : 'this-week';
        break;
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
  const isAttendanceAtRisk = attendancePct !== null && attendancePct < 75;
  const dashGuidance = calculateSmartAttendanceGuidance(totalAttended, totalSkipped, 75);

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

  // Signature Chrono Beacon (Active lecture or next slot)
  let beaconHTML = '';
  if (activeClass) {
    const classKey = `${activeClass.code || activeClass.subject}_${activeClass.time}`.replace(/[^a-zA-Z0-9_]/g, '');
    const status = attendanceData[dateStr]?.[classKey] || 'unset';
    beaconHTML = `
      <div class="chrono-beacon is-live">
        <div style="flex:1;min-width:180px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="chrono-beacon-badge">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)"></span>
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
          <button class="btn btn-sm ${status==='attended'?'btn-primary':'btn-secondary'}" onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'attended')" style="padding:5px 11px;font-size:0.76rem;font-weight:600;${status==='attended'?'background:var(--green);border-color:var(--green);color:white;':''}">
            ${status==='attended'?'Attended ✓':'Mark Attended'}
          </button>
          <button class="btn btn-sm ${status==='skipped'?'btn-primary':'btn-secondary'}" onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'skipped')" style="padding:5px 11px;font-size:0.76rem;font-weight:600;${status==='skipped'?'background:var(--red);border-color:var(--red);color:white;':''}">
            ${status==='skipped'?'Skipped':'Skip'}
          </button>
        </div>
      </div>`;
  } else if (nextClass) {
    beaconHTML = `
      <div class="chrono-beacon">
        <div style="flex:1;min-width:180px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="chrono-beacon-badge">⏳ Next Up</span>
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
          Subject Hub →
        </button>
      </div>`;
  }

  const setupBanner = needsSetup ? `
    <div class="card" style="margin-bottom:18px;display:flex;align-items:center;gap:14px;background:var(--accent-dim);border-color:color-mix(in srgb, var(--accent) 35%, var(--border));padding:14px 18px">
      <div style="width:36px;height:36px;border-radius:10px;background:color-mix(in srgb, var(--accent) 20%, transparent);color:var(--accent);display:grid;place-items:center;flex-shrink:0">${icons.user()}</div>
      <div style="flex:1;min-width:200px">
        <div style="font-weight:650;font-size:0.9rem;color:var(--text-primary);letter-spacing:-0.015em">Personalize your student profile</div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">Set up your name, college, and semester to customize your timetable and countdown.</div>
      </div>
      <button class="btn-primary" onclick="navigateTo('settings')" style="flex-shrink:0;padding:7px 16px;font-size:0.82rem;font-weight:600">Set Up Profile →</button>
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
    <!-- 1. ARCHITECTURAL MASTHEAD -->
    <div class="desk-masthead">
      <div class="desk-masthead-top">
        <div>
          <div class="desk-greeting">${greeting}${firstName ? `, ${firstName}` : ''}.</div>
          <div class="desk-greeting-sub">${dayClasses.length > 0 ? `${classesLeftCount} class${classesLeftCount !== 1 ? 'es' : ''} left on your desk today.` : 'No classes scheduled today. A good day for focus or rest.'}</div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="navigateTo('review')" title="Weekly reflection & guidance" style="font-size:0.76rem;padding:5px 12px;align-self:flex-start">
          Weekly Review →
        </button>
      </div>
      <div class="desk-ticker-strip">${tickerHTML}</div>
    </div>

    ${beaconHTML}
    ${setupBanner}

    <!-- 2. WORKBENCH & AMBIENT PANEL -->
    <div class="dashboard-layout">

      <!-- LEFT COLUMN: WORKBENCH -->
      <div class="dashboard-left">
        <!-- SCHEDULE LEDGER -->
        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-title">${icons.timetable()} Today's Schedule</div>
            <button class="panel-action" onclick="navigateTo('timetable')">Full Timetable →</button>
          </div>

          <div class="card" style="padding:14px">
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
                      <div style="flex:1;min-width:120px;cursor:pointer" onclick="openSubjectHub('${c.subject}')">
                        <div class="schedule-slot-title">${c.subject}</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:1px">
                          ${c.room ? c.room + ' · ' : ''}${c.teacher ? 'Prof. ' + c.teacher + ' · ' : ''}${c.type || 'lecture'}
                        </div>
                      </div>
                      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
                        <button class="btn btn-xs ${status==='attended'?'btn-primary':'btn-secondary'}" onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'attended')" style="padding:3px 8px;font-size:0.7rem;font-weight:600;${status==='attended'?'background:var(--green);border-color:var(--green);color:white;':''}">
                          ${status==='attended'?'Attended ✓':'Present'}
                        </button>
                        <button class="btn btn-xs ${status==='skipped'?'btn-primary':'btn-secondary'}" onclick="event.stopPropagation(); setAttendance('${dateStr}', '${classKey}', 'skipped')" style="padding:3px 8px;font-size:0.7rem;font-weight:600;${status==='skipped'?'background:var(--red);border-color:var(--red);color:white;':''}">
                          ${status==='skipped'?'Skipped':'Missed'}
                        </button>
                      </div>
                    </div>`;
                }).join('')}
              </div>
            ` : `
              <div style="padding:24px 12px;text-align:center;color:var(--text-muted);font-size:0.85rem">
                🏖️ No classes scheduled for today. Take time to study or rest!
              </div>
            `}
          </div>
        </div>

        <!-- TASKS & MISSIONS LEDGER -->
        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-title">${icons.assignments()} Tasks &amp; Deadlines</div>
            <button class="panel-action" onclick="navigateTo('assignments')">Open Tasks (${pending}) →</button>
          </div>

          <div class="card" style="padding:14px">
            <!-- WORKLOAD PROGRESS BAR -->
            <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border-light, var(--border))">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span class="text-xs font-semibold" style="color:var(--text-secondary)">Completed ${submittedCount} of ${total} tasks</span>
                <span class="text-xs text-muted font-semibold" style="font-family:var(--font-mono)">${progress}%</span>
              </div>
              <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
            </div>

            <!-- TASK LEDGER ITEMS -->
            ${urgentTasks.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:4px">
                ${urgentTasks.map(a => {
                  const isOngoing = !!a.noDeadline || (a.taskType === 'mission' && !a.dueDate);
                  const rel = isOngoing ? { label: 'Ongoing', cls: 'ongoing' } : formatRelativeDueDate(a.dueDate);
                  const done = a.status === 'submitted';
                  const pCls = a.priority === 'high' ? 'priority-high' : a.priority === 'medium' ? 'priority-medium' : 'priority-low';
                  return `
                    <div class="task-ledger-item ${pCls}">
                      <div class="task-checkbox ${done ? 'checked' : ''}" onclick="toggleAssignment('${a.id}')" title="Click to mark completed">
                        ${done ? icons.check() : ''}
                      </div>
                      <div style="flex:1;min-width:0;cursor:pointer" onclick="navigateTo('assignments')">
                        <div style="font-weight:600;font-size:0.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${done?'text-decoration:line-through;opacity:0.5':''}">${a.title}</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;display:flex;align-items:center;gap:6px">
                          <span onclick="event.stopPropagation(); openSubjectHub('${a.subject}')" style="color:var(--accent);font-weight:600;cursor:pointer" title="Open ${a.subject} Hub">${a.subject || 'General'}</span>
                          <span>· ${isOngoing ? 'Standing Mission' : formatDate(a.dueDate)}</span>
                        </div>
                      </div>
                      <span class="due-badge ${rel.cls}" style="font-size:0.7rem;padding:2px 7px;font-family:var(--font-mono)">${rel.label}</span>
                    </div>`;
                }).join('')}
              </div>
            ` : `
              <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.84rem">
                🌿 All caught up! No urgent tasks due today.
              </div>
            `}
          </div>
        </div>

        <!-- DESK COMMAND DOCK (DUAL INPUT) -->
        <div class="desk-command-dock">
          <div class="command-dock-field">
            <span style="color:var(--accent);opacity:0.8;font-size:0.8rem">${icons.plus()}</span>
            <input type="text" id="quick-add-input" placeholder="Add task… e.g. 'Lab report due Friday'" onkeypress="if(event.key==='Enter') handleQuickAdd()">
            <span class="command-dock-kbd">↵ Enter</span>
          </div>

          <div class="command-dock-field">
            <span style="color:var(--accent);opacity:0.8;font-size:0.8rem">✨</span>
            <input type="text" id="assistant-input" placeholder="Ask Desk… e.g. 'Classes today?'" onkeypress="if(event.key==='Enter') handleAssistantQuestion()">
            <span class="command-dock-kbd">Ask</span>
          </div>
        </div>
        <div id="assistant-answer-container"></div>
      </div>

      <!-- RIGHT COLUMN: AMBIENT CONTEXT (Sticky on Desktop) -->
      <div class="dashboard-right-panel">

        <!-- ATTENDANCE HEALTH -->
        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-title">Attendance Health</div>
            <button class="panel-action" onclick="navigateTo('review')">Guidance →</button>
          </div>
          <div class="card card-sm" style="padding:14px;border-left:3px solid ${isAttendanceAtRisk ? 'var(--red)' : attendancePct !== null ? 'var(--green)' : 'var(--accent)'};background:${isAttendanceAtRisk ? 'rgba(239,68,68,0.04)' : 'var(--surface)'}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
              <div style="font-family:var(--font-mono);font-weight:700;font-size:0.92rem;color:${isAttendanceAtRisk ? 'var(--red)' : 'var(--text-primary)'}">
                ${attendancePct !== null ? `${attendancePct}% Overall` : 'Attendance Health'}
              </div>
              <span class="type-badge" style="font-family:var(--font-mono);font-size:0.66rem;padding:2px 6px;background:${isAttendanceAtRisk ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)'};color:${isAttendanceAtRisk ? 'var(--red)' : 'var(--green)'}">
                ${attendancePct !== null ? (dashGuidance.isSafe ? 'Safe (≥75%)' : 'Recovery needed') : 'Not configured'}
              </span>
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.45">
              ${dashGuidance.message}
            </div>
            ${attendancePct !== null ? `
              <div style="margin-top:10px">
                <div class="att-bar-wrap">
                  <div class="att-bar-seg att-seg-present" style="width:${totalMarked > 0 ? Math.round((totalAttended/totalMarked)*100) : 0}%"></div>
                  <div class="att-bar-seg att-seg-absent" style="width:${totalMarked > 0 ? Math.round((totalSkipped/totalMarked)*100) : 0}%"></div>
                </div>
              </div>
            ` : ''}
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
        <div class="empty-state-desc">No classes scheduled for this day. You can add class slots manually, scan your college timetable photo, or load the SY AI-DS template if you belong to that department.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:6px">
          <button class="btn-primary" onclick="showTimetableEntryModal(${day}, null)" style="font-size:0.82rem;padding:6px 14px">+ Add Class Entry</button>
          <button class="btn-secondary" onclick="triggerTimetableImport()" style="font-size:0.82rem;padding:6px 14px">📷 Scan Photo</button>
          <button class="btn-secondary" onclick="loadOfficialAidsTimetable()" style="font-size:0.82rem;padding:6px 14px">⚡ Load SY AI-DS Template</button>
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
                  title="Mark ${c.subject} Bunked" aria-label="Mark ${c.subject} as bunked" aria-pressed="${isSkipped}"
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
        <button class="btn-secondary" onclick="loadOfficialAidsTimetable()" style="display:flex;align-items:center;gap:6px;font-size:0.8rem;padding:7px 14px" title="Load official SY AI-DS schedule template">
          ⚡ Load SY AI-DS
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

  // 1. Collect from Timetable
  [1, 2, 3, 4, 5, 6, 0].forEach(d => {
    (liveTT[d] || []).forEach(c => {
      if (isTeachingClass(c) && c.subject) {
        const key = c.subject.trim();
        if (!map.has(key)) {
          map.set(key, {
            name: key,
            code: c.code || key,
            teacher: c.teacher || '',
            room: c.room || '',
            color: c.color || 'var(--accent)',
            slots: []
          });
        }
        const item = map.get(key);
        if (!item.teacher && c.teacher) item.teacher = c.teacher;
        if (!item.room && c.room) item.room = c.room;
        if (!item.code && c.code) item.code = c.code;
        item.slots.push({ day: d, time: c.time, end: c.end, room: c.room, teacher: c.teacher, code: c.code || item.code });
      }
    });
  });

  // 2. Collect from Tasks
  allTasks().forEach(t => {
    if (t.subject && t.subject.trim()) {
      const key = t.subject.trim();
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          code: key,
          teacher: '',
          room: '',
          color: 'var(--accent)',
          slots: []
        });
      }
    }
  });

  // 3. Collect from Quick Links
  loadCustomLinks().forEach(l => {
    if (l.subject && l.subject.trim()) {
      const key = l.subject.trim();
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          code: key,
          teacher: '',
          room: '',
          color: l.color || 'var(--accent)',
          slots: []
        });
      }
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
      const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if ((cleanCode && cleanK === cleanCode) || (cleanName && cleanK === cleanName)) {
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
        const cleanKey = key.toLowerCase();
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

  const isSafe = pct !== null ? pct >= 75 : null;
  const statusLine = pct === null ? 'Attendance not set yet' : isSafe ? 'Safe Zone' : 'Needs Recovery';

  let insightMessage = '';
  let safeSkips = 0;
  let classesToAttend = 0;

  if (pct !== null) {
    if (isSafe) {
      safeSkips = Math.max(0, Math.floor((present - 0.75 * total) / 0.75));
      insightMessage = safeSkips > 0
        ? `Can safely miss ${safeSkips} class${safeSkips !== 1 ? 'es' : ''} · Target: 75%`
        : `On target at ${pct}% · Attend next class to build buffer`;
    } else {
      classesToAttend = Math.max(1, Math.ceil((0.75 * total - present) / 0.25));
      insightMessage = `Need to attend ${classesToAttend} class${classesToAttend !== 1 ? 'es' : ''} continuously to reach 75%`;
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
  if (!subjects.length) {
    showToast('Set up your weekly timetable or add tasks first to configure subjects.', 'info');
    return;
  }

  const existingBackdrop = document.getElementById('baseline-modal-backdrop');
  if (existingBackdrop) existingBackdrop.remove();

  let activeSubj = subjects[0];
  if (preselectedSubject) {
    const found = subjects.find(s =>
      s.code.toLowerCase() === preselectedSubject.toLowerCase() ||
      s.name.toLowerCase() === preselectedSubject.toLowerCase()
    );
    if (found) activeSubj = found;
  }

  const optionsHTML = subjects.map(s => {
    const isSel = (s.code === activeSubj.code || s.name === activeSubj.name);
    return `<option value="${s.code || s.name}" ${isSel ? 'selected' : ''}>${s.name} (${s.code || 'No Code'})</option>`;
  }).join('');

  const baseline = getSubjectBaseline(activeSubj);

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
          <select id="ab-subject-select" class="form-select" onchange="onBaselineSubjectChange(this.value)">
            ${optionsHTML}
          </select>
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
          <button type="button" class="btn-secondary" id="ab-clear-btn" onclick="clearSubjectBaseline()" style="color:var(--red);border-color:rgba(239,68,68,0.3);font-size:0.82rem;${baseline.hasBaseline ? '' : 'display:none'}">
            Clear Baseline
          </button>
          <div style="display:flex;align-items:center;gap:10px;margin-left:auto">
            <button type="button" class="btn-secondary" onclick="document.getElementById('baseline-modal-backdrop')?.remove()" style="font-size:0.84rem">Cancel</button>
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

      // 2. Grayscale, adaptive contrast stretching, and Otsu-like binarization
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      // Calculate luminance histogram for optimal thresholding
      let totalLuminance = 0;
      const grayValues = new Uint8ClampedArray(data.length / 4);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        grayValues[j] = gray;
        totalLuminance += gray;
      }
      const meanLuminance = totalLuminance / (width * height);
      const threshold = Math.max(120, Math.min(210, Math.round(meanLuminance * 0.88)));

      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const gray = grayValues[j];
        // High contrast boost & clean binarization
        const binVal = gray < threshold ? 0 : 255;
        data[i] = binVal;
        data[i + 1] = binVal;
        data[i + 2] = binVal;
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

      // Release canvas buffers to keep memory low on mobile
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

      updateAttendanceScanLoadingMessage('Preprocessing image (upscaling, binarization, table crop)…');
      const preprocessedDataUrl = await preprocessAttendanceImageForOCR(base64Data, mimeType);

      if (_isAttendanceScanCanceled || currentScanId !== _currentAttendanceScanId) return;

      updateAttendanceScanLoadingMessage('Running local OCR in background worker…');
      const worker = await getTesseractWorker();
      const ocrResult = await worker.recognize(preprocessedDataUrl);

      if (_isAttendanceScanCanceled || currentScanId !== _currentAttendanceScanId) return;

      updateAttendanceScanLoadingMessage('Reconstructing table rows and validating attendance numbers…');
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
    const highConfidenceCount = geometricResult.filter(r => !r.isUncertain).length;
    if (highConfidenceCount >= 1 || geometricResult.length >= 2) {
      return geometricResult;
    }
  }

  // 2. Second attempt: AI-Assisted Structured Extraction (if API key available)
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
      "present": 9,
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
    text: w.text.trim(),
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
      if (wordH > 0 && (overlap / wordH) > 0.42) {
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

  // 3. Identify header line or column anchors
  const headerKeywords = ['course', 'subject', 'present', 'absent', 'leave', 'attended', 'total', 'percent', '%', 'entered', 'status'];
  let headerRowIndex = -1;

  for (let i = 0; i < visualRows.length; i++) {
    const rowText = visualRows[i].map(w => w.text.toLowerCase()).join(' ');
    const matchCount = headerKeywords.filter(kw => rowText.includes(kw)).length;
    if (matchCount >= 2) {
      headerRowIndex = i;
      break;
    }
  }

  // 4. Parse candidate data rows (rows below header, or rows with numbers + text)
  const candidateRows = [];
  const startIdx = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;

  for (let i = startIdx; i < visualRows.length; i++) {
    const rowWords = visualRows[i];
    const fullRowText = rowWords.map(w => w.text).join(' ');

    // Separate text tokens from numeric tokens
    const textTokens = [];
    const numTokens = [];

    rowWords.forEach(w => {
      const cleaned = w.text.trim();
      // Handle digit OCR fixes
      const numCandidate = cleaned
        .replace(/[%]/g, '')
        .replace(/^[OoQD]$/, '0')
        .replace(/^[lI|i]$/, '1')
        .replace(/^[Ss]$/, '5')
        .replace(/^[Bb]$/, '8');

      if (/^\d+(\.\d+)?$/.test(numCandidate)) {
        numTokens.push({
          val: parseFloat(numCandidate),
          intVal: Math.round(parseFloat(numCandidate)),
          orig: cleaned,
          bbox: w.bbox,
          conf: w.conf
        });
      } else if (cleaned.length > 1 && !/^[.\-/,:;]+$/.test(cleaned)) {
        textTokens.push(cleaned);
      }
    });

    if (numTokens.length >= 2 && textTokens.length >= 1) {
      const candidateTitle = textTokens.join(' ');
      // Ignore pure metadata headers like 'Semester IV', 'Academic Year'
      if (/academic\s*year|semester|roll\s*no|student\s*name/i.test(candidateTitle)) {
        continue;
      }

      // Assign numbers based on column sequence (standard ERP order: Present, Absent, Leave, Not Entered, Total, Pct)
      let present = numTokens[0]?.intVal || 0;
      let absent = numTokens[1]?.intVal || 0;
      let leave = 0;
      let notEntered = 0;
      let scannedTotal = 0;
      let scannedPct = null;

      if (numTokens.length === 2) {
        // [present, absent]
        scannedTotal = present + absent;
      } else if (numTokens.length === 3) {
        // [present, absent, total] OR [present, absent, leave]
        if (numTokens[2].intVal === present + absent) {
          scannedTotal = numTokens[2].intVal;
        } else {
          leave = numTokens[2].intVal;
          scannedTotal = present + absent + leave;
        }
      } else if (numTokens.length === 4) {
        // [present, absent, leave, total] or [present, absent, total, pct]
        if (numTokens[2].intVal === present + absent || (numTokens[3].orig && numTokens[3].orig.includes('%'))) {
          scannedTotal = numTokens[2].intVal;
          scannedPct = numTokens[3].val;
        } else {
          leave = numTokens[2].intVal;
          scannedTotal = numTokens[3].intVal;
        }
      } else if (numTokens.length === 5) {
        // Typical: [present, absent, leave, total, pct]
        if (numTokens[3].intVal === (present + absent + numTokens[2].intVal) || (numTokens[4].orig && numTokens[4].orig.includes('%'))) {
          leave = numTokens[2].intVal;
          scannedTotal = numTokens[3].intVal;
          scannedPct = numTokens[4].val;
        } else {
          leave = numTokens[2].intVal;
          notEntered = numTokens[3].intVal;
          scannedTotal = numTokens[4].intVal;
        }
      } else if (numTokens.length >= 6) {
        // [present, absent, leave, notEntered, total, pct]
        leave = numTokens[2].intVal;
        notEntered = numTokens[3].intVal;
        scannedTotal = numTokens[4].intVal;
        scannedPct = numTokens[5]?.val || null;
      }

      // Check if present was abnormally large (e.g. course code mistaken for number)
      if (present > 100 && numTokens.length > 2) {
        present = numTokens[1].intVal;
        absent = numTokens[2].intVal;
        leave = numTokens[3]?.intVal || 0;
      }

      const expectedTotal = present + absent + leave + notEntered;
      let isUncertain = false;

      if (scannedTotal > 0 && Math.abs(scannedTotal - expectedTotal) > 1) {
        isUncertain = true;
      }

      const rawRow = {
        subject: candidateTitle,
        code: '',
        present,
        absent,
        leave,
        notEntered,
        totalSessions: scannedTotal > expectedTotal ? scannedTotal : 0,
        isUncertain: isUncertain || numTokens.length < 2
      };

      const matched = matchScannedRowToSubjects(rawRow, existingSubjects);
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

function parseAttendanceFromText(rawText, existingSubjects = []) {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for lines that contain numbers (counts) and text
    const numMatches = line.match(/\b\d+(\.\d+)?\b/g);
    if (!numMatches || numMatches.length < 2) continue;

    // Check if line contains a known subject or course code
    const words = line.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    let candidateName = words.filter(w => !/^\d+$/.test(w)).join(' ');

    if (!candidateName || candidateName.length < 3) {
      // Check previous line for subject title
      if (i > 0 && lines[i-1] && lines[i-1].length > 3 && !/\d{2,}/.test(lines[i-1])) {
        candidateName = lines[i-1];
      }
    }

    if (candidateName && candidateName.length >= 3) {
      if (/academic\s*year|semester|roll\s*no|student\s*name/i.test(candidateName)) {
        continue;
      }

      const ints = numMatches.map(n => parseInt(n)).filter(n => !isNaN(n));
      if (ints.length >= 2) {
        let present = ints[0] || 0;
        let absent = ints[1] || 0;
        let leave = ints[2] !== undefined && ints.length > 3 ? ints[2] : 0;
        let notEntered = ints[3] !== undefined && ints.length > 4 ? ints[3] : 0;
        let totalSessions = ints[ints.length - 1] > 20 ? ints[ints.length - 1] : 0;

        // If present count appears unreasonably larger than total, adjust
        if (present > 100 && ints.length > 2) {
          present = ints[1] || 0;
          absent = ints[2] || 0;
        }

        const rawRow = {
          subject: candidateName,
          code: '',
          present,
          absent,
          leave,
          notEntered,
          totalSessions,
          isUncertain: ints.length < 2
        };

        const matched = matchScannedRowToSubjects(rawRow, existingSubjects);
        rows.push(matched);
      }
    }
  }

  // Deduplicate matched rows by subject code/name
  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    const key = (r.code || r.subject).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  return deduped;
}

function matchScannedRowToSubjects(scannedRow, existingSubjects = []) {
  const rawName = (scannedRow.subject || '').trim();
  const rawCode = (scannedRow.code || '').trim();
  const cleanRawName = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanRawCode = rawCode.toLowerCase().replace(/[^a-z0-9]/g, '');

  let bestMatch = null;
  let isUncertain = !!scannedRow.isUncertain;

  for (const s of existingSubjects) {
    const sName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sCode = (s.code || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (cleanRawCode && sCode && cleanRawCode === sCode) {
      bestMatch = s;
      isUncertain = false;
      break;
    }
    if (cleanRawName && sName && (cleanRawName.includes(sName) || sName.includes(cleanRawName))) {
      bestMatch = s;
      isUncertain = false;
      break;
    }
    if (cleanRawName && sCode && cleanRawName.includes(sCode)) {
      bestMatch = s;
      isUncertain = false;
      break;
    }
  }

  return {
    subject: bestMatch ? bestMatch.name : rawName || 'General Subject',
    code: bestMatch ? bestMatch.code : rawCode || '',
    present: Math.max(0, parseInt(scannedRow.present) || 0),
    absent: Math.max(0, parseInt(scannedRow.absent) || 0),
    leave: Math.max(0, parseInt(scannedRow.leave) || 0),
    notEntered: Math.max(0, parseInt(scannedRow.notEntered) || 0),
    totalSessions: Math.max(0, parseInt(scannedRow.totalSessions) || 0),
    isUncertain: !bestMatch || isUncertain
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
          <span>Couldn’t read a few rows clearly. You can fix them below.</span>
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

  return rows.map((r, idx) => {
    const total = (parseInt(r.present) || 0) + (parseInt(r.absent) || 0) + (parseInt(r.leave) || 0) + (parseInt(r.notEntered) || 0);
    const pct = total > 0 ? (((parseInt(r.present) || 0) / total) * 100).toFixed(1) : '0.0';
    const isSafe = parseFloat(pct) >= 75;

    const subjectOptionsHTML = subjects.map(s => {
      const isSel = (s.name.toLowerCase() === r.subject.toLowerCase() || (r.code && s.code.toLowerCase() === r.code.toLowerCase()));
      return `<option value="${s.name}|||${s.code}" ${isSel ? 'selected' : ''}>${s.name} (${s.code || 'No Code'})</option>`;
    }).join('');

    return `
      <div class="attendance-review-row ${r.isUncertain ? 'uncertain' : ''}" id="review-row-${idx}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <label class="form-label" style="font-size:0.75rem;margin-bottom:3px">Subject</label>
            <select class="form-select review-subject-select" style="font-size:0.84rem;padding:5px 8px" onchange="onReviewRowInputChange(${idx})">
              ${subjectOptionsHTML}
              <option value="${r.subject}|||${r.code}" ${!subjects.some(s=>s.name===r.subject)?'selected':''}>${r.subject} (Custom)</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="type-badge" id="row-badge-${idx}" style="font-size:0.72rem;padding:3px 8px;background:${isSafe ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${isSafe ? 'var(--green)' : 'var(--red)'}">
              ${total > 0 ? `${pct}% · ${isSafe ? 'Safe Zone' : 'Needs Recovery'}` : 'Attendance not set'}
            </span>
            <button type="button" onclick="deleteReviewRow(${idx})" class="btn-icon" style="color:var(--text-muted);font-size:0.9rem" title="Remove row">✕</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(80px, 1fr));gap:8px">
          <div>
            <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--green)">Present *</label>
            <input type="number" min="0" class="form-input review-present" id="row-present-${idx}" value="${r.present}" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${idx})">
          </div>
          <div>
            <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--red)">Absent *</label>
            <input type="number" min="0" class="form-input review-absent" id="row-absent-${idx}" value="${r.absent}" style="font-size:0.84rem;padding:5px 8px" oninput="onReviewRowInputChange(${idx})">
          </div>
          <div>
            <label class="form-label" style="font-size:0.72rem;margin-bottom:2px;color:var(--yellow)">Leave</label>
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

  const total = p + a + l + n;
  const pct = total > 0 ? ((p / total) * 100).toFixed(1) : '0.0';
  const isSafe = parseFloat(pct) >= 75;

  const badgeEl = document.getElementById(`row-badge-${idx}`);
  if (badgeEl) {
    badgeEl.textContent = total > 0 ? `${pct}% · ${isSafe ? 'Safe Zone' : 'Needs Recovery'}` : 'Attendance not set';
    badgeEl.style.background = isSafe ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
    badgeEl.style.color = isSafe ? 'var(--green)' : 'var(--red)';
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
    <option value="${s.name}|||${s.code}">${s.name} (${s.code || 'No Code'})</option>
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
  const subjects = getSubjectList();
  const subj = subjects.find(s => (s.code || s.name) === subjectKey) || subjects[0];
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

  const totalCount = presentVal + absentVal + leaveVal + notEnteredVal;
  const pct = totalCount > 0 ? ((presentVal / totalCount) * 100) : 0;
  const pctFormatted = pct.toFixed(2);
  const isSafe = pct >= 75;

  if (totalCount === 0) {
    previewEl.innerHTML = `
      <div style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:4px 0">
        Enter your present and absent counts to view instant percentage and recovery guidance.
      </div>
    `;
    return;
  }

  const guidance = calculateSmartAttendanceGuidance(presentVal, absentVal + leaveVal + notEnteredVal, 75);

  previewEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
      <div style="font-size:0.82rem;font-weight:600;color:var(--text-primary)">
        Conducted: <strong>${totalCount}</strong> sessions (${presentVal} attended)
      </div>
      <span class="type-badge" style="font-size:0.75rem;padding:2px 8px;background:${isSafe ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${isSafe ? 'var(--green)' : 'var(--red)'}">
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
  const subjectKey = selectEl ? selectEl.value : null;
  if (!subjectKey) return;

  const subjects = getSubjectList();
  const subj = subjects.find(s => (s.code || s.name) === subjectKey) || { name: subjectKey, code: subjectKey };

  const present = Math.max(0, parseInt(document.getElementById('ab-present')?.value) || 0);
  const absent = Math.max(0, parseInt(document.getElementById('ab-absent')?.value) || 0);
  const leave = Math.max(0, parseInt(document.getElementById('ab-leave')?.value) || 0);
  const notEntered = Math.max(0, parseInt(document.getElementById('ab-not-entered')?.value) || 0);
  const totalSessions = Math.max(0, parseInt(document.getElementById('ab-total-sessions')?.value) || 0);

  const totalCount = present + absent + leave + notEntered;
  const pct = totalCount > 0 ? ((present / totalCount) * 100).toFixed(1) : '0.0';

  const baselines = loadAttendanceBaselines();
  const storageKey = (subj.code || subj.name).trim();

  baselines[storageKey] = {
    subjectCode: subj.code || '',
    subjectName: subj.name || '',
    present,
    absent,
    leave,
    notEntered,
    totalSessions,
    updatedAt: new Date().toISOString()
  };

  saveAttendanceBaselines(baselines);
  document.getElementById('baseline-modal-backdrop')?.remove();
  showToast(`Baseline saved for ${subj.name} (${pct}%) ✓`, 'success');
  renderPage(state.currentPage);
}

function clearSubjectBaseline() {
  const selectEl = document.getElementById('ab-subject-select');
  const subjectKey = selectEl ? selectEl.value : null;
  if (!subjectKey) return;

  const baselines = loadAttendanceBaselines();
  const subjects = getSubjectList();
  const subj = subjects.find(s => (s.code || s.name) === subjectKey) || { name: subjectKey, code: subjectKey };

  const storageKey = (subj.code || subj.name).trim();
  delete baselines[storageKey];

  saveAttendanceBaselines(baselines);
  document.getElementById('baseline-modal-backdrop')?.remove();
  showToast(`Attendance baseline cleared for ${subj.name}`, 'info');
  renderPage(state.currentPage);
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
      <div class="card" style="padding:40px;text-align:center;color:var(--text-muted);border-style:dashed">
        📚 No subjects found yet. Set up your timetable or add tasks to automatically build your subject hubs!
      </div>
    `;
    return;
  }

  const anyMissingBaseline = subjects.some(s => !getSubjectAttendance(s).hasBaseline);

  const cardsHTML = subjects.map(s => {
    const att = getSubjectAttendance(s);
    const tasks = allTasks().filter(t => (t.subject || '').toLowerCase() === s.name.toLowerCase() || (t.subject || '').toLowerCase() === s.code.toLowerCase());
    const pendingTasks = tasks.filter(t => t.status === 'pending');

    const attStatusClass = att.pct === null ? 'muted' : att.pct >= 75 ? 'green' : 'red';
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
            <span class="type-badge" style="font-size:0.75rem;padding:3px 9px;background:${attStatusClass==='green'?'rgba(16,185,129,0.15)':attStatusClass==='red'?'rgba(239,68,68,0.15)':'var(--surface-2)'};color:${attStatusClass==='green'?'var(--green)':attStatusClass==='red'?'var(--red)':'var(--text-muted)'}">
              ${attLabel}
            </span>
            <span style="font-size:0.68rem;font-weight:600;color:${att.pct===null?'var(--text-muted)':att.pct>=75?'var(--green)':'var(--red)'}">
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
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="event.stopPropagation(); logSubjectAttendanceAction('${s.code || s.name}', 'present')" title="Log 1 class attended" style="color:var(--green);border-color:rgba(16,185,129,0.3)">
            Present
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="event.stopPropagation(); logSubjectAttendanceAction('${s.code || s.name}', 'missed')" title="Log 1 class missed" style="color:var(--red);border-color:rgba(239,68,68,0.3)">
            Missed
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="event.stopPropagation(); logSubjectAttendanceAction('${s.code || s.name}', 'leave')" title="Log 1 leave applied" style="color:var(--yellow);border-color:rgba(245,158,11,0.3)">
            Leave
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="event.stopPropagation(); showBaselineModal('${s.code || s.name}')" style="margin-left:auto;font-size:0.74rem">
            Edit Baseline
          </button>
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div class="page-title">Subject Hubs</div>
        <div class="page-subtitle">Course schedules, attendance baselines, tasks &amp; study resources organized per subject</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="showBaselineModal(null, 'scan')" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px">
          📷 Scan from Photo
        </button>
        <button class="btn btn-primary" onclick="showBaselineModal(null, 'manual')" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px">
          📊 Set Baseline
        </button>
      </div>
    </div>

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

  const links = loadCustomLinks().filter(l => (l.subject || '').toLowerCase() === subj.name.toLowerCase() || (l.subject || '').toLowerCase() === subj.code.toLowerCase());

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
  const linksHTML = links.length > 0 ? links.map(l => `
    <div class="card card-sm" style="margin-bottom:6px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
        <span style="width:8px;height:8px;border-radius:50%;background:${l.color || 'var(--accent)'};flex-shrink:0"></span>
        <a href="${l.url}" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:0.85rem;color:var(--accent);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.subject}</a>
      </div>
      <a href="${l.url}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary" style="font-size:0.75rem;padding:3px 8px">Open ↗</a>
    </div>
  `).join('') : `<div style="font-size:0.82rem;color:var(--text-muted);padding:10px 0">No study links or notes saved for this subject yet.</div>`;

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
            <span class="type-badge" style="font-size:0.8rem;padding:5px 12px;background:${att.pct===null?'var(--surface-2)':att.pct>=75?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)'};color:${att.pct===null?'var(--text-muted)':att.pct>=75?'var(--green)':'var(--red)'}">
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
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="logSubjectAttendanceAction('${subj.code || subj.name}', 'present')" style="color:var(--green);border-color:rgba(16,185,129,0.35)">
            Present (+1)
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="logSubjectAttendanceAction('${subj.code || subj.name}', 'missed')" style="color:var(--red);border-color:rgba(239,68,68,0.35)">
            Missed (+1)
          </button>
          <button class="btn btn-sm btn-secondary attendance-action-btn" onclick="logSubjectAttendanceAction('${subj.code || subj.name}', 'leave')" style="color:var(--yellow);border-color:rgba(245,158,11,0.35)">
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
            <div style="font-size:1.1rem;font-weight:700;margin-top:2px">${links.length} link${links.length!==1?'s':''}</div>
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
        <button class="btn btn-sm btn-primary" onclick="addLinkSubject()" style="font-size:0.75rem;padding:3px 9px">+ Add Link</button>
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
        <div class="empty-state-title">No Academic Tasks Yet</div>
        <div class="empty-state-desc">Stay ahead of coursework, standing missions, and exam deadlines. Tap Add Task to organize your desk with ease.</div>
        <button class="btn-primary" onclick="showAddTaskModal()" style="font-size:0.82rem;padding:7px 16px">+ Add Your First Task</button>
      </div>`
    : (state.assignFilter === 'ongoing' || state.assignFilter === 'missions')
    ? `<div class="empty-state-card" style="margin-top:14px">
        <span class="empty-state-icon">🚀</span>
        <div class="empty-state-title">No Ongoing Missions Active</div>
        <div class="empty-state-desc">Missions stay visible on your desk without deadlines until you finish them. Tap Add Task to set your first long-term target.</div>
        <button class="btn-primary" onclick="showAddTaskModal(null, null, 'mission')" style="font-size:0.82rem;padding:7px 16px">+ Create First Mission</button>
      </div>`
    : `<div class="empty-state-card" style="margin-top:14px">
        <span class="empty-state-icon">✨</span>
        <div class="empty-state-title">No Matching Tasks</div>
        <div class="empty-state-desc">No tasks found matching the selected filter. Try switching back to All Tasks or reset your filters.</div>
        <button class="btn-secondary" onclick="resetAssignmentFilters()" style="font-size:0.82rem;padding:6px 14px">Reset Filters</button>
      </div>`);

  el.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="page-title">Tasks &amp; Workload</div>
        <div class="page-subtitle">${pendingCount()} pending · ${all.filter(a=>a.status==='submitted').length} completed · Academic tasks &amp; standing missions</div>
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

      <!-- Card 2: WhatsApp Group -->
      <div class="notice-source-card tint-whatsapp" onclick="handleNoticeSourceClick('whatsapp')" title="Open class WhatsApp group">
        <div class="notice-source-top">
          <div class="notice-source-icon-wrap notice-source-icon-whatsapp">💬</div>
          <button class="btn-icon" onclick="event.stopPropagation(); showNoticeChannelModal('whatsapp')" title="Edit WhatsApp group settings" style="width:24px;height:24px;font-size:0.72rem" aria-label="Edit WhatsApp group settings">
            ✏️
          </button>
        </div>
        <div>
          <div class="notice-source-title">${escHtml_cd(channels.whatsappTitle || 'WhatsApp Group')}</div>
          <div class="notice-source-sub">Open your saved WhatsApp group in one tap</div>
        </div>
        <div class="notice-source-action" style="color:#25D366">
          <span>${channels.whatsappUrl ? 'Open WhatsApp Group ↗' : '+ Configure Link'}</span>
        </div>
      </div>

      <!-- Card 3: Dev Notes -->
      <div class="notice-source-card tint-devnotes" onclick="showDevNotesModal()" title="View recent updates and improvements">
        <div class="notice-source-top">
          <div class="notice-source-icon-wrap notice-source-icon-devnotes">🛠️</div>
          <span style="font-size:0.68rem;font-weight:700;background:rgba(245,158,11,0.15);color:var(--yellow);padding:2px 6px;border-radius:4px">v2.4</span>
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
        <span class="link-color-dot" style="background:${s.color || '#6366f1'}"></span>
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
          <input id="lsm-color" type="color" value="${existing?.color || '#6366f1'}" style="width:60px;height:36px;border:none;cursor:pointer;background:none" />
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
  const color = document.getElementById('lsm-color')?.value || '#6366f1';
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
            <div class="summary-icon" style="background:rgba(99,102,241,0.12);color:var(--accent)">${icons.timetable()}</div>
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
            <div class="summary-icon" style="background:rgba(245,158,11,0.12);color:var(--yellow)">${icons.assignments()}</div>
            <div style="flex:1;min-width:0">
              <div class="summary-text-main">${a.title}</div>
              <div class="summary-text-sub">${a.subject} · ${a.marks > 0 ? a.marks + ' marks' : 'Academic task'}</div>
            </div>
          </div>`).join('')
      : '<div class="card" style="text-align:center;padding:20px;color:var(--text-muted)">🌿 No tasks due today — all clear!</div>'
    }

    ${ongoingMissions.length ? `
      <div class="section-heading" style="margin-top:20px;color:var(--purple)">🚀 Ongoing Missions</div>
      ${ongoingMissions.map(a => `
        <div class="summary-item" style="border-left:3px solid var(--purple)">
          <div class="summary-icon" style="background:rgba(147,51,234,0.12);color:var(--purple)">${icons.target()}</div>
          <div style="flex:1;min-width:0">
            <div class="summary-text-main">${a.title}</div>
            <div class="summary-text-sub">${a.subject} · Standing Goal · Active</div>
          </div>
        </div>`).join('')}` : ''}

    ${overdueItems.length ? `
      <div class="section-heading" style="margin-top:20px;color:var(--red)">⚠ Overdue Tasks</div>
      ${overdueItems.map(a => `
        <div class="summary-item" style="border-left:3px solid var(--red)">
          <div class="summary-icon" style="background:rgba(239,68,68,0.12);color:var(--red)">${icons.alert()}</div>
          <div style="flex:1;min-width:0">
            <div class="summary-text-main">${a.title}</div>
            <div class="summary-text-sub">${a.subject} · ${Math.abs(dueDaysLeft(a.dueDate) || 1)}d overdue</div>
          </div>
        </div>`).join('')}` : ''}

    <div class="section-heading" style="margin-top:20px">Key Notices</div>
    ${importantNotices.length
      ? importantNotices.map(n => `
          <div class="summary-item" onclick="showNotice('${n.id}')" style="cursor:pointer">
            <div class="summary-icon" style="background:rgba(239,68,68,0.12);color:var(--red)">${icons.notices()}</div>
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
            `<button class="btn-secondary" onclick="logoutUser()" style="color:var(--red);border-color:rgba(239,68,68,0.35)">Sign Out</button>` : 
            `<button class="btn-primary" onclick="loginWithGoogle()" style="display:flex;align-items:center;gap:6px">🌐 Sign In with Google</button>`
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
          <input type="text" class="form-input" id="s-name" value="${(p.name || '').replace(/"/g, '&quot;')}" placeholder="Full name (e.g. Sanghpal Bhakte)">
        </div>
        <div class="form-group">
          <label class="form-label">Roll Number</label>
          <input type="text" class="form-input" id="s-roll" value="${(p.rollNo || '').replace(/"/g, '&quot;')}" placeholder="Roll number (e.g. 2K23/AIDS/042)">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">College / University</label>
        <input type="text" class="form-input" id="s-college" value="${(p.college || '').replace(/"/g, '&quot;')}" placeholder="College / University">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Branch / Department</label>
          <input type="text" class="form-input" id="s-branch" value="${(p.branch || '').replace(/"/g, '&quot;')}" placeholder="Branch (e.g. AI &amp; Data Science)">
        </div>
        <div class="form-group">
          <label class="form-label">Year &amp; Semester</label>
          <input type="text" class="form-input" id="s-year" value="${(p.year || '').replace(/"/g, '&quot;')}" placeholder="Year &amp; semester (e.g. 2nd Year)">
        </div>
      </div>
    </div>

    <div class="section-heading">${icons.timetable()} Timetable Schedule Template</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">
        Clarity Desk can start with a clean schedule or load the pre-configured official Sem 3 SY AI-DS timetable template if you belong to that department.
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="loadOfficialAidsTimetable()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px">
          ⚡ Load Official SY AI-DS Template
        </button>
        <button class="btn-secondary" onclick="resetTimetableToDefault()" style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;padding:7px 14px;color:var(--red);border-color:rgba(239,68,68,0.3)">
          Clear Timetable (Start Clean)
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

    <div class="section-heading">${icons.clock()} Academic Countdown</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">End-Semester Exam Date</label>
        <input type="date" class="form-input" id="s-exam-date" value="${p.examDate || ''}" style="max-width:240px">
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">
          Shows a calm daily countdown on your dashboard once set.
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
              <div class="swatch-bg" style="background:#f8fafc"></div>
              <div class="swatch-surface" style="background:#ffffff"></div>
              <div class="swatch-accent" style="background:#2563eb"></div>
            </div>
            <span class="swatch-name">Paper Slate</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'midnight-ink' ? 'active' : ''}" onclick="setTheme('midnight-ink')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'midnight-ink'}" aria-label="Midnight Ink theme: Obsidian dark with electric indigo">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#08090d"></div>
              <div class="swatch-surface" style="background:#11131a"></div>
              <div class="swatch-accent" style="background:#6366f1"></div>
            </div>
            <span class="swatch-name">Midnight Ink</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'espresso-desk' ? 'active' : ''}" onclick="setTheme('espresso-desk')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'espresso-desk'}" aria-label="Espresso Desk theme: Cozy café dark mahogany and caramel">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#171310"></div>
              <div class="swatch-surface" style="background:#221b16"></div>
              <div class="swatch-accent" style="background:#d97706"></div>
            </div>
            <span class="swatch-name">Espresso Desk</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'sandstone-notes' ? 'active' : ''}" onclick="setTheme('sandstone-notes')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'sandstone-notes'}" aria-label="Sandstone Notes theme: Warm parchment and terracotta">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#f5f0e6"></div>
              <div class="swatch-surface" style="background:#fffdfa"></div>
              <div class="swatch-accent" style="background:#c25e2e"></div>
            </div>
            <span class="swatch-name">Sandstone Notes</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'nordic-frost' ? 'active' : ''}" onclick="setTheme('nordic-frost')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'nordic-frost'}" aria-label="Nordic Frost theme: Crisp glacial ice and azure">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#eaf0f6"></div>
              <div class="swatch-surface" style="background:#ffffff"></div>
              <div class="swatch-accent" style="background:#0284c7"></div>
            </div>
            <span class="swatch-name">Nordic Frost</span>
          </button>
          <button type="button" class="theme-swatch ${document.documentElement?.getAttribute('data-theme') === 'misty-mint' ? 'active' : ''}" onclick="setTheme('misty-mint')" aria-pressed="${document.documentElement?.getAttribute('data-theme') === 'misty-mint'}" aria-label="Misty Mint theme: Light eucalyptus and sage">
            <div class="swatch-preview" aria-hidden="true">
              <div class="swatch-bg" style="background:#f0f5f3"></div>
              <div class="swatch-surface" style="background:#ffffff"></div>
              <div class="swatch-accent" style="background:#1b7a6d"></div>
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
      <div style="margin-bottom:16px;font-size:0.78rem;color:var(--red);background:rgba(239,68,68,0.08);padding:10px 12px;border-radius:6px;border:1px solid rgba(239,68,68,0.25);line-height:1.5;display:flex;align-items:flex-start;gap:8px">
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
            <div style="font-size:0.75rem;color:var(--text-muted)">Alert if attendance drops below 75% target</div>
          </div>
          <select class="form-select" id="np-attendance-alerts" style="width:170px;padding:5px 8px;font-size:0.82rem">
            <option value="instant" ${nPrefs.attendanceAlerts === 'instant' ? 'selected' : ''}>Instant Alert (&lt; 75%)</option>
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

    <div class="section-heading">📢 Notice Channels &amp; Class Groups</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:14px">
        Customize the title and destination link for quick-access notice sources on your Notice Board.
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
          <label class="form-label">WhatsApp Card Title</label>
          <input type="text" class="form-input" id="nc-wa-title" value="${(channels.whatsappTitle || 'WhatsApp Group').replace(/"/g, '&quot;')}" placeholder="e.g. WhatsApp Group or Batch 2026">
        </div>
        <div class="form-group">
          <label class="form-label">WhatsApp Group Link</label>
          <input type="url" class="form-input" id="nc-wa-url" value="${(channels.whatsappUrl || '').replace(/"/g, '&quot;')}" placeholder="https://chat.whatsapp.com/invite...">
        </div>
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
        <button class="btn-secondary" onclick="confirmClearTasks()"
          style="color:var(--red);border-color:rgba(239,68,68,0.35)">
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

  const profile = {
    name:     nameToSave,
    college:  (rawCollege.toLowerCase() === 'your college') ? '' : rawCollege,
    branch:   (rawBranch.toLowerCase().includes('artificial intelligence & data science')) ? '' : rawBranch,
    year:     (rawYear.toLowerCase().includes('2nd year — semester 3')) ? '' : rawYear,
    rollNo:   (rawRoll.toLowerCase() === 'your roll no.') ? '' : rawRoll,
    examDate: document.getElementById('s-exam-date')?.value || '',
  };
  safeSetStorage(KEY_PROFILE, profile);
  Object.assign(liveProfile, profile);

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
      whatsappTitle: (waTitleEl ? waTitleEl.value : '').trim() || 'WhatsApp Group',
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
  showToast('Settings saved successfully ✓', 'success');
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
  showToast('Backup file downloaded ✓', 'success');
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
      showToast('Desk data restored successfully! ✨', 'success');
      renderSettings();
    } catch (err) {
      showToast('Error parsing backup: ' + err.message, 'error');
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
          ${n.important ? '<span class="cat-badge" style="background:rgba(239,68,68,0.12);color:var(--red);margin-left:6px">Important</span>' : ''}
        </div>
        <span style="font-size:0.75rem;color:var(--text-muted)">${formatDate(n.date)}</span>
      </div>
      <h2 style="font-size:1.15rem;font-weight:700;margin-bottom:10px;line-height:1.4">${n.title}</h2>
      <p style="font-size:0.9rem;line-height:1.7;color:var(--text-secondary);margin-bottom:20px;white-space:pre-line">${n.content}</p>
      
      <div class="modal-footer" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:14px;border-top:1px solid var(--border);flex-wrap:wrap">
        <a href="${whatsappUrl}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#25D366;border-color:#25D366;color:#ffffff;display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:var(--radius-xs,6px);font-size:0.8rem;text-decoration:none;font-weight:700">
          <span>💬</span> Forward to WhatsApp
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
      id: 'help',
      test: /\b(help|what can you|commands|what do you know|how to use|capabilities)\b/i,
    },
    {
      id: 'today_schedule',
      test: /\b(today|what do i have|schedule today|classes today|my day|what'?s on|plan for today)\b/i,
    },
    {
      id: 'next_class',
      test: /\b(next class|next lecture|upcoming class|which class|next period|soon start|starting next)\b/i,
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
      id: 'tasks_overdue',
      test: /\b(overdue|late|missed deadline|past due|behind|not submitted)\b/i,
    },
    {
      id: 'tasks_today',
      test: /\b(due today|tasks? today|deadline today|submit today|assignment today)\b/i,
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
      id: 'attendance_skip',
      test: /\b(can i (skip|bunk|miss)|safe to (skip|bunk|miss)|how many (can i|more) (skip|miss|bunk)|bunking)\b/i,
    },
    {
      id: 'attendance',
      test: /\b(attendance|percentage|pct|how many class(es)? (attended|missed)|my record|att(end)?)\b/i,
    },
    {
      id: 'notices',
      test: /\b(notice|announcement|important|update|bulletin|news|notification)\b/i,
    },
    {
      id: 'profile',
      test: /\b(who am i|my profile|my name|my branch|my year|my roll|my college)\b/i,
    },
  ];

  function matchIntent(q) {
    const lower = q.toLowerCase().trim();
    // Priority order — more specific first
    for (const intent of INTENTS) {
      if (intent.test.test(lower)) return intent.id;
    }
    return 'unknown';
  }

  // ── Data Readers ──────────────────────────────────────────────

  function getAttendanceSummary() {
    return getOverallAttendance();
  }

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
    const profile = loadProfile();
    const name = profile.name || '';
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
    return `I can answer questions about your real desk data. Try:<ul class="cd-list">
      <li><span class="cd-item-label">Schedule</span><span class="cd-item-meta">"What do I have today?" · "Show Friday's timetable" · "What's my next class?"</span></li>
      <li><span class="cd-item-label">Tasks</span><span class="cd-item-meta">"Which tasks are overdue?" · "What's due this week?" · "Show all pending tasks"</span></li>
      <li><span class="cd-item-label">Attendance</span><span class="cd-item-meta">"What is my attendance?" · "Can I skip a class?"</span></li>
      <li><span class="cd-item-label">Notices</span><span class="cd-item-meta">"Any important notices?"</span></li>
    </ul>`;
  }

  function buildTodaySchedule() {
    const classes = getTodayClasses();
    const dayName = DAY_NAMES[new Date().getDay()];

    if (new Date().getDay() === 0) {
      return `Today is Sunday — no classes. A good day to catch up on pending tasks.`;
    }
    if (classes.length === 0) {
      return `No classes scheduled for today (${dayName}). Enjoy the free time.`;
    }

    const items = classes.map(c => {
      const timeStr = `${formatTime(c.time)} – ${formatTime(c.end)}`;
      const meta = [c.room !== '—' ? c.room : null, c.teacher !== '—' ? c.teacher : null].filter(Boolean).join(' · ');
      return `<li><span class="cd-item-label">${escHtml(c.subject)}</span><span class="cd-item-meta">${timeStr}${meta ? ' · ' + escHtml(meta) : ''}</span></li>`;
    }).join('');

    return `<strong>${dayName}</strong> — ${classes.length} class${classes.length !== 1 ? 'es' : ''}:<ul class="cd-list">${items}</ul>`;
  }

  function buildNextClass() {
    const next = getNextClass();
    if (!next) {
      const remaining = getRemainingTodayClasses();
      if (remaining.length === 0) return `No more classes today. You're done for the day.`;
      return `No upcoming class found. Check your timetable.`;
    }
    const timeStr = `${formatTime(next.time)} – ${formatTime(next.end)}`;
    const meta = [next.room !== '—' ? next.room : null, next.teacher !== '—' ? next.teacher : null].filter(Boolean).join(' · ');
    return `Next up: <strong>${escHtml(next.subject)}</strong> at <strong>${timeStr}</strong>${meta ? ' · ' + escHtml(meta) : ''}.`;
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
    if (dayNum < 0) return buildTodaySchedule();

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

  function buildTasksOverdue() {
    const overdue = allTasks().filter(t => isTaskOverdue(t));
    if (overdue.length === 0) return `No overdue tasks. You're on top of things.`;

    const items = overdue.map(t =>
      `<li><span class="cd-tag cd-tag-overdue">Overdue</span><span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${escHtml(t.subject)} · Due ${fmtDate(t.dueDate)}</span></li>`
    ).join('');
    return `<strong>${overdue.length} overdue task${overdue.length !== 1 ? 's' : ''}:</strong><ul class="cd-list">${items}</ul>`;
  }

  function buildTasksToday() {
    const today = todayISO();
    const due = allTasks().filter(t => t.status === 'pending' && !t.noDeadline && t.dueDate === today);
    if (due.length === 0) return `Nothing due today. Good.`;
    const items = due.map(t =>
      `<li><span class="cd-tag cd-tag-today">Due Today</span><span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${escHtml(t.subject)}</span></li>`
    ).join('');
    return `<strong>${due.length} task${due.length !== 1 ? 's' : ''} due today:</strong><ul class="cd-list">${items}</ul>`;
  }

  function buildTasksWeek() {
    const today = todayISO();
    const weekEnd = nDaysFromNow(7);
    const upcoming = allTasks().filter(t => t.status === 'pending' && !t.noDeadline && t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd);
    if (upcoming.length === 0) return `Nothing due in the next 7 days.`;
    const items = upcoming.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).map(t => {
      const isToday = t.dueDate === today;
      const tag = isToday ? '<span class="cd-tag cd-tag-today">Today</span>' : '';
      return `<li>${tag}<span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${escHtml(t.subject)} · Due ${fmtDate(t.dueDate)}</span></li>`;
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
        ? '<span class="cd-tag" style="background:rgba(147,51,234,0.14);color:var(--purple)">Mission</span>'
        : isOverdue ? '<span class="cd-tag cd-tag-overdue">Overdue</span>' : '';
      const meta = isOngoing ? `${escHtml(t.subject)} · Ongoing Mission` : `${escHtml(t.subject)} · Due ${fmtDate(t.dueDate)}`;
      return `<li>${tag}<span class="cd-item-label">${escHtml(t.title)}</span><span class="cd-item-meta">${meta}</span></li>`;
    }).join('');
    return `<strong>${pending.length} pending task${pending.length !== 1 ? 's' : ''}:</strong><ul class="cd-list">${items}</ul>`;
  }

  function buildAttendance() {
    const { attended, skipped, total } = getAttendanceSummary();
    if (total === 0) {
      return `No attendance recorded yet. Mark classes as Attended or Skipped in the Timetable to start tracking.`;
    }
    const pct = Math.round((attended / total) * 100);
    const isSafe = pct >= 75;
    const tag = isSafe
      ? '<span class="cd-tag cd-tag-safe">Safe Zone</span>'
      : '<span class="cd-tag cd-tag-risk">Risk Zone</span>';
    return `${tag}<strong>${pct}% attendance</strong> — ${attended} attended, ${skipped} skipped (${total} total marked).<br><br>75% is the general target. ${isSafe ? 'You are currently above target.' : 'You are below target.'}`;
  }

  function buildAttendanceSkip() {
    const { attended, skipped, total } = getAttendanceSummary();
    const guidance = calculateSmartAttendanceGuidance(attended, skipped, 75);
    if (total === 0) return `No attendance data yet. Start marking classes first.`;
    // Strip HTML from guidance message for cleaner display
    const cleanMsg = guidance.message.replace(/<\/?strong>/g, '');
    const tag = guidance.isSafe
      ? '<span class="cd-tag cd-tag-safe">Safe Zone</span>'
      : '<span class="cd-tag cd-tag-risk">Risk Zone</span>';
    return `${tag}${cleanMsg}`;
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
    const p = loadProfile();
    if (!p.name) return `Your profile isn't set up yet. Go to Settings to add your name, branch, and year.`;
    const lines = [
      p.name    ? `<li><span class="cd-item-label">Name</span><span class="cd-item-meta">${escHtml(p.name)}</span></li>` : '',
      p.branch  ? `<li><span class="cd-item-label">Branch</span><span class="cd-item-meta">${escHtml(p.branch)}</span></li>` : '',
      p.year    ? `<li><span class="cd-item-label">Year</span><span class="cd-item-meta">${escHtml(p.year)}</span></li>` : '',
      p.college ? `<li><span class="cd-item-label">College</span><span class="cd-item-meta">${escHtml(p.college)}</span></li>` : '',
      p.rollNo  ? `<li><span class="cd-item-label">Roll No.</span><span class="cd-item-meta">${escHtml(p.rollNo)}</span></li>` : '',
    ].filter(Boolean).join('');
    return `<ul class="cd-list">${lines}</ul>`;
  }

  function buildUnknown() {
    return `I didn't quite get that. I can answer questions about your schedule, tasks, attendance, and notices. Type <strong>help</strong> to see what I understand.`;
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Main Respond ──────────────────────────────────────────────
  function respond(query) {
    // For 'day_schedule', check it's not actually a 'today' query first
    let intent = matchIntent(query);

    // Refinement: if 'today' in query, prefer today_schedule over day_schedule
    if (intent === 'day_schedule' && /\btoday\b/i.test(query)) intent = 'today_schedule';

    switch (intent) {
      case 'greeting':      return buildGreeting();
      case 'help':          return buildHelp();
      case 'today_schedule': return buildTodaySchedule();
      case 'next_class':    return buildNextClass();
      case 'classes_left':  return buildClassesLeft();
      case 'day_schedule':  return buildDaySchedule(query);
      case 'tasks_overdue': return buildTasksOverdue();
      case 'tasks_today':   return buildTasksToday();
      case 'tasks_week':    return buildTasksWeek();
      case 'tasks_all':     return buildTasksAll();
      case 'attendance':    return buildAttendance();
      case 'attendance_skip': return buildAttendanceSkip();
      case 'notices':       return buildNotices();
      case 'profile':       return buildProfile();
      default:              return buildUnknown();
    }
  }

  return { respond };
})();

// ── Assistant Panel UI ────────────────────────────────────────

let _assistantOpen = false;

function renderAssistantWelcome() {
  const thread = document.getElementById('cd-chat-thread');
  if (!thread) return;
  thread.innerHTML = `
    <div class="cd-welcome-card">
      <div class="cd-welcome-badge">
        <span class="cd-dot-live"></span> Ready with live desk data
      </div>
      <div class="cd-welcome-title">How can I help you today?</div>
      <div class="cd-welcome-sub">Grounded in your live timetable, task deadlines, attendance logs, and notices.</div>
      <div class="cd-starter-grid">
        <button class="cd-starter-btn" onclick="sendAssistantMessage('What do I have today?')">
          <span class="cd-starter-icon">📅</span>
          <strong>Today's Classes</strong>
          <span>View today's lecture schedule</span>
        </button>
        <button class="cd-starter-btn" onclick="sendAssistantMessage('What is my next class?')">
          <span class="cd-starter-icon">⏱️</span>
          <strong>Next Class</strong>
          <span>Upcoming lecture &amp; room</span>
        </button>
        <button class="cd-starter-btn" onclick="sendAssistantMessage('Which tasks are overdue?')">
          <span class="cd-starter-icon">🎯</span>
          <strong>Overdue Tasks</strong>
          <span>Check pending deadlines</span>
        </button>
        <button class="cd-starter-btn" onclick="sendAssistantMessage('What is my attendance situation?')">
          <span class="cd-starter-icon">🛡️</span>
          <strong>Attendance %</strong>
          <span>Safe skips &amp; target buffer</span>
        </button>
      </div>
    </div>
  `;
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
