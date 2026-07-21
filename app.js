// ============================================================
// Campus OS — App Logic
// Routing, rendering, profile, persistent tasks, settings
// ============================================================

import { STUDENT, TIMETABLE, ASSIGNMENTS, NOTICES, QUICK_LINKS } from './data.js';

// ── localStorage Keys ─────────────────────────────────────────
const KEY_PROFILE          = 'cos_profile';
const KEY_ASSIGNMENTS      = 'cos_assignments';
const KEY_CUSTOM_TASKS     = 'cos_custom_tasks';
const KEY_CUSTOM_TIMETABLE = 'cos_custom_timetable';
const KEY_CUSTOM_LINKS     = 'cos_custom_links';
const KEY_GEMINI_KEY       = 'cos_gemini_key';
const KEY_THEME            = 'cos_theme';

// ── Safe Storage Helpers ─────────────────────────────────────
function safeGetStorage(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
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
  const savedName = (saved.name || '').trim();
  const isDefaultName = !savedName || savedName.toLowerCase() === 'your name';
  return {
    name:     isDefaultName ? '' : savedName,
    college:  saved.college  ?? STUDENT.college,
    branch:   saved.branch   ?? STUDENT.branch,
    year:     saved.year     ?? STUDENT.year,
    rollNo:   saved.rollNo   ?? STUDENT.rollNo,
    examDate: saved.examDate ?? '',
  };
}

function getDisplayName() {
  const nameVal = (liveProfile.name || '').trim();
  if (nameVal && nameVal.toLowerCase() !== 'your name') {
    return nameVal;
  }
  return 'Your Name';
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
    av.textContent = getInitials(nameToDisplay);
    av.title       = nameToDisplay;
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
      db   = firebase.firestore();

      db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        console.warn("Firestore persistence notice (non-fatal):", err);
      });

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

function updateSyncUI(status = null) {
  const label = document.getElementById('sync-label');
  const icon  = document.getElementById('sync-icon');
  if (!label || !icon) return;

  if (status === 'denied') {
    icon.textContent  = '🔒';
    label.textContent = 'Access Denied';
    label.style.color = 'var(--red)';
  } else if (currentUser) {
    icon.textContent  = '⚡';
    label.textContent = 'Synced';
    label.style.color = 'var(--green)';
  } else {
    icon.textContent  = '☁️';
    label.textContent = 'Local';
    label.style.color = 'var(--text-muted)';
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

let tesseractWorker = null;
let tesseractLoading = false;

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  if (tesseractLoading) {
    while(tesseractLoading) await new Promise(r => setTimeout(r, 100));
    return tesseractWorker;
  }
  tesseractLoading = true;
  updateTimetableLoadingModal("Loading local OCR engine (first time may take longer)...");
  try {
    console.log("[TesseractWorker] Initializing local OCR engine...");
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress % 0.2 < 0.05) {
          console.log(`[TesseractWorker] OCR Progress: ${(m.progress * 100).toFixed(0)}%`);
        }
      }
    });
    tesseractWorker = worker;
    console.log("[TesseractWorker] ✅ OCR engine initialized successfully.");
  } catch (err) {
    console.error("[TesseractWorker] ❌ Init Error:", err);
    throw new Error("Failed to initialize local OCR engine.");
  } finally {
    tesseractLoading = false;
  }
  return tesseractWorker;
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
  
  updateTimetableLoadingModal("Scanning text locally with Tesseract.js...");
  const worker = await getTesseractWorker();
  const ocrResult = await worker.recognize(preprocessedDataUrl);
  const rawOcrText = ocrResult.data.text;
  
  updateTimetableLoadingModal("Parsing timetable data...");
  const deterministicResult = parseTimetableDeterministically(rawOcrText);
  
  // If deterministic parser has high confidence and no ambiguity, use it.
  // Otherwise, use AI Repair layer.
  if (deterministicResult.confidence > 80 && !deterministicResult.ambiguous && deterministicResult.schedule.length > 0) {
    return { schedule: deterministicResult.schedule };
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
      subject: item.subject || 'Class',
      code:    item.code || 'SUB',
      room:    item.room || 'LT-1',
      teacher: item.teacher || 'Faculty',
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
      renderPage(state.currentPage);
    });
  }
}

function sanitizeTask(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    id:          String(t.id || `c-${Date.now()}`),
    subject:     String(t.subject || 'General'),
    code:        String(t.code || 'OTH'),
    title:       String(t.title || 'Untitled Task').slice(0, 150),
    description: String(t.description || '—').slice(0, 500),
    dueDate:     String(t.dueDate || todayStr()),
    priority:    ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
    status:      t.status === 'submitted' ? 'submitted' : 'pending',
    marks:       typeof t.marks === 'number' ? Math.max(0, Math.min(100, t.marks)) : 0,
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
  if (Array.isArray(data.customLinks)) {
    safeSetStorage(KEY_CUSTOM_LINKS, data.customLinks);
  }
  if (data.assignmentStatuses && typeof data.assignmentStatuses === 'object') {
    safeSetStorage(KEY_ASSIGNMENTS, data.assignmentStatuses);
    state.assignments = loadAssignments();
  }
  if (data.theme && ['dark', 'light', 'glass'].includes(data.theme)) {
    localStorage.setItem(KEY_THEME, data.theme);
    initTheme();
  }
  updateTopbarProfile();
  updateNavBadges();
  if (['settings', 'assignments', 'dashboard'].includes(state.currentPage)) {
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
    customLinks:        safeGetStorage(KEY_CUSTOM_LINKS, null),
    assignmentStatuses: safeGetStorage(KEY_ASSIGNMENTS, {}),
    theme:              localStorage.getItem(KEY_THEME) || 'glass',
    updatedAt:          firebase.firestore.FieldValue.serverTimestamp()
  };
  db.collection('users').doc(uid).set(payload, { merge: true }).catch(err => {
    if (err.code === 'permission-denied') {
      updateSyncUI('denied');
    }
    console.warn("Cloud push error:", err);
  });
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

// ── Custom Tasks (fully persisted) ────────────────────────────
function loadCustomTasks() {
  return safeGetStorage(KEY_CUSTOM_TASKS, []) || [];
}

function saveCustomTasks() {
  // Prune completed tasks older than 14 days to minimize document size and Firestore read/write overhead
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const cutoffStr = `${fourteenDaysAgo.getFullYear()}-${String(fourteenDaysAgo.getMonth()+1).padStart(2,'0')}-${String(fourteenDaysAgo.getDate()).padStart(2,'0')}`;

  state.customTasks = state.customTasks.filter(t => {
    if (t.status === 'submitted' && t.dueDate < cutoffStr) return false;
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
  assignSubjectFilter: 'all',
  noticeSearch:        '',
  assignments:         loadAssignments(),
  customTasks:         loadCustomTasks(),   // persisted across reloads
};

// ── Theme ─────────────────────────────────────────────────────
function initTheme() {
  const saved       = localStorage.getItem(KEY_THEME);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme       = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const themes  = ['dark', 'light', 'glass'];
  const nextIdx = (themes.indexOf(current) + 1) % themes.length;
  const next    = themes[nextIdx];
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(KEY_THEME, next);
  updateThemeIcon(next);
}

function setTheme(theme) {
  if (!['dark', 'light', 'glass'].includes(theme)) return;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY_THEME, theme);
  updateThemeIcon(theme);
  renderPage(state.currentPage);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (!icon) return;
  if (theme === 'dark')       icon.innerHTML = moonSVG();
  else if (theme === 'light') icon.innerHTML = sunSVG();
  else                        icon.innerHTML = icons.layers();
}

// ── Routing ───────────────────────────────────────────────────
const PAGES = ['dashboard', 'timetable', 'assignments', 'notices', 'links', 'summary', 'settings'];

function navigate(page) {
  if (!PAGES.includes(page)) page = 'dashboard';
  state.currentPage    = page;
  window.location.hash = page;

  document.querySelectorAll('.section-page').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page)
  );
  document.querySelectorAll('[data-nav]').forEach(el =>
    el.classList.toggle('active', el.dataset.nav === page)
  );

  renderPage(page);
}

function renderPage(page) {
  try {
    switch (page) {
      case 'dashboard':   renderDashboard();   break;
      case 'timetable':   renderTimetable();   break;
      case 'assignments': renderAssignments(); break;
      case 'notices':     renderNotices();     break;
      case 'links':       renderLinks();       break;
      case 'summary':     renderSummary();     break;
      case 'settings':    renderSettings();    break;
    }
  } catch (err) {
    console.error(`Error rendering page [${page}]:`, err);
    const targetEl = document.getElementById(`page-${page}`);
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
  if (!dateStr) return 0;
  const now = new Date(); now.setHours(0,0,0,0);
  const due = new Date(dateStr + 'T00:00:00');
  if (isNaN(due.getTime())) return 0;
  return Math.round((due - now) / 86400000);
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
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function allTasks() {
  return [...state.assignments, ...state.customTasks];
}

function pendingCount() {
  return allTasks().filter(a => a.status === 'pending').length;
}

function overdueCount() {
  const today = todayStr();
  return allTasks().filter(a => a.status === 'pending' && a.dueDate < today).length;
}

// ── Dynamic Timetable Loading ─────────────────────────────────
function loadTimetable() {
  const saved = safeGetStorage(KEY_CUSTOM_TIMETABLE, null);
  if (saved && typeof saved === 'object') return saved;
  return TIMETABLE;
}

function isCustomTimetableActive() {
  return !!safeGetStorage(KEY_CUSTOM_TIMETABLE, null);
}

function saveTimetable(ttMap) {
  safeSetStorage(KEY_CUSTOM_TIMETABLE, ttMap);
  syncToCloud();
}

function resetTimetableToDefault() {
  if (!confirm("Reset timetable back to official Sem 4 default schedule?")) return;
  localStorage.removeItem(KEY_CUSTOM_TIMETABLE);
  syncToCloud();
  renderPage(state.currentPage);
}

function todayClasses() {
  const tt = loadTimetable();
  return (tt[new Date().getDay()] || []).length;
}

// ── SVG Icons ─────────────────────────────────────────────────
function svg(path, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const icons = {
  dashboard:   () => svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  timetable:   () => svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  assignments: () => svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>'),
  notices:     () => svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
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

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
  const el       = document.getElementById('page-dashboard');
  const now      = new Date();
  const pending  = pendingCount();
  const overdue  = overdueCount();
  const classes  = todayClasses();

  const total          = allTasks().length;
  const submittedCount = allTasks().filter(a => a.status === 'submitted').length;
  const progress       = total === 0 ? 0 : Math.round((submittedCount / total) * 100);

  const liveTT     = loadTimetable();
  const dayClasses = liveTT[now.getDay()] || [];
  const currentMin = currentTimeMinutes();
  const nextClass  = dayClasses.find(c => timeToMinutes(c.time || '10:00') > currentMin);

  // Exam countdown
  let countdownHTML = '';
  if (liveProfile.examDate) {
    const today    = new Date(); today.setHours(0,0,0,0);
    const examDay  = new Date(liveProfile.examDate + 'T00:00:00');
    const daysLeft = Math.ceil((examDay - today) / 86400000);
    if (daysLeft > 0) {
      countdownHTML = `
        <div class="card" style="margin-bottom:20px;display:flex;align-items:center;gap:14px;border-left:3px solid var(--yellow)">
          <div style="width:40px;height:40px;border-radius:8px;background:rgba(245,158,11,0.12);color:var(--yellow);display:grid;place-items:center;flex-shrink:0">
            ${icons.clock()}
          </div>
          <div>
            <div style="font-weight:700;font-size:1.05rem">${daysLeft} days to End-Sem Exams</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">${formatDate(liveProfile.examDate)} · Keep going! 📚</div>
          </div>
        </div>`;
    } else if (daysLeft === 0) {
      countdownHTML = `
        <div class="card" style="margin-bottom:20px;border-left:3px solid var(--accent);padding:16px;font-weight:600">
          🎯 Exam is today — all the best!
        </div>`;
    }
  }

  // Profile setup prompt (shown when name is still default/empty)
  const displayName = getDisplayName();
  const needsSetup = !liveProfile.name || liveProfile.name === 'Your Name';
  const setupBanner = needsSetup ? `
    <div class="card" style="margin-bottom:20px;display:flex;align-items:center;gap:12px;background:var(--accent-dim);border-color:var(--accent)">
      <div style="color:var(--accent);flex-shrink:0">${icons.user()}</div>
      <div style="flex:1;font-size:0.87rem">
        <strong>Set up your profile</strong> — enter your name, college, and roll number so the app feels personal.
      </div>
      <button class="btn-primary" onclick="navigateTo('settings')" style="flex-shrink:0;padding:6px 14px;font-size:0.8rem">Go to Settings</button>
    </div>` : '';

  el.innerHTML = `
    <div class="greeting-banner">
      <div class="greeting-text">${greetingWord()}, ${displayName.split(' ')[0]}! 👋</div>
      <div class="greeting-sub">${liveProfile.branch} · ${liveProfile.year}</div>
      <div class="greeting-date">
        ${svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', 14)}
        &nbsp;${DAY_NAMES[now.getDay()]}, ${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}
        &nbsp;·&nbsp; ${liveProfile.rollNo}
      </div>
    </div>

    ${setupBanner}
    ${countdownHTML}

    <div class="stat-grid">
      <div class="stat-card" onclick="navigateTo('timetable')" style="cursor:pointer">
        <div class="stat-icon" style="background:rgba(99,102,241,0.12);color:var(--accent)">${icons.timetable()}</div>
        <div class="stat-value">${classes}</div>
        <div class="stat-label">Classes Today</div>
      </div>
      <div class="stat-card" onclick="navigateTo('assignments')" style="cursor:pointer">
        <div class="stat-icon" style="background:rgba(239,68,68,0.12);color:var(--red)">${icons.assignments()}</div>
        <div class="stat-value" style="color:${pending>0?'var(--red)':'inherit'}">${pending}</div>
        <div class="stat-label">Pending Tasks</div>
      </div>
      <div class="stat-card" onclick="navigateTo('assignments')" style="cursor:pointer">
        <div class="stat-icon" style="background:rgba(245,158,11,0.12);color:var(--yellow)">${icons.alert()}</div>
        <div class="stat-value" style="color:${overdue>0?'var(--red)':'inherit'}">${overdue}</div>
        <div class="stat-label">Overdue</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(16,185,129,0.12);color:var(--green)">${icons.check()}</div>
        <div class="stat-value" style="color:var(--green)">${submittedCount}</div>
        <div class="stat-label">Submitted</div>
      </div>
    </div>

    ${nextClass ? `
    <div class="section-heading">Next Class</div>
    <div class="card" style="display:flex;gap:14px;align-items:center;margin-bottom:20px">
      <div style="width:44px;height:44px;border-radius:10px;background:var(--accent-dim);color:var(--accent);display:grid;place-items:center;flex-shrink:0">
        ${icons.clock()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">${nextClass.subject}</div>
        <div class="text-sm text-muted">${nextClass.time} · ${nextClass.room} · ${nextClass.teacher}</div>
      </div>
      <span class="type-badge type-${nextClass.type}">${nextClass.type}</span>
    </div>` : ''}

    <div class="section-heading">Assignment Progress</div>
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span class="text-sm font-semibold">Submitted ${submittedCount} / ${total}</span>
        <span class="text-sm text-muted">${progress}%</span>
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
    </div>

    <div class="section-heading">Due Soon</div>
    ${(() => {
      const dueSoon = allTasks()
        .filter(a => a.status === 'pending')
        .sort((a,b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 3);
      if (!dueSoon.length) return `
        <div class="card" style="text-align:center;padding:24px;color:var(--text-muted)">
          🎉 Nothing pending — enjoy the break!
        </div>`;
      return dueSoon.map(a => {
        const days  = dueDaysLeft(a.dueDate);
        const label = days < 0 ? 'Overdue' : days === 0 ? 'Due Today' : `${days}d left`;
        const cls   = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'soon' : '';
        const done  = a.status === 'submitted';
        return `
          <div class="card card-sm" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;cursor:pointer"
               onclick="toggleAssignment('${a.id}')" title="Click to mark ${done ? 'pending' : 'done'}">
            <div style="width:18px;height:18px;border-radius:5px;border:2px solid ${done?'var(--green)':a.priority==='high'?'var(--red)':a.priority==='medium'?'var(--yellow)':'var(--border)'};background:${done?'var(--green)':'transparent'};display:grid;place-items:center;flex-shrink:0;color:white;transition:all 0.15s">
              ${done ? icons.check() : ''}
            </div>
            <div style="flex:1;min-width:0">
              <div class="font-semibold" style="font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${done?'text-decoration:line-through;opacity:0.5':''}">${a.title}</div>
              <div class="text-xs text-muted">${a.subject}</div>
            </div>
            <span class="due-badge ${cls}">${label}</span>
          </div>`;
      }).join('');
    })()}
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

  const tabs = [1,2,3,4,5,6,0].map(d => `
    <button class="tt-tab ${d===day?'active':''}" onclick="setTTDay(${d})">${DAY_SHORT[d]}${d===today?' ·':''}</button>
  `).join('');

  let content = '';
  if (!classes.length) {
    content = `<div class="card" style="text-align:center;padding:40px;color:var(--text-muted);border-style:dashed">
      🏖️ No classes on ${DAY_NAMES[day]} — enjoy the day!
      <div style="margin-top:12px">
        <button class="btn-primary" onclick="showTimetableEntryModal(${day}, null)" style="font-size:0.8rem;padding:6px 14px">+ Add Class Entry</button>
      </div>
    </div>`;
  } else {
    content = classes.map((c, idx) => {
      const startMin  = timeToMinutes(c.time || '10:00');
      const endMin    = timeToMinutes(c.end || '11:00');
      const isCurrent = day === today && currentMin >= startMin && currentMin < endMin;
      const isPast    = day === today && currentMin >= endMin;
      return `
        <div class="tt-entry ${isCurrent?'current':''} ${isPast?'past':''}">
          <div class="tt-time-col">
            <div class="tt-time-start">${c.time}</div>
            <div class="tt-time-end">${c.end}</div>
          </div>
          <div class="tt-divider"></div>
          <div class="tt-info" style="flex:1;min-width:0">
            <div class="tt-subject">${c.subject}</div>
            <div class="tt-meta">${c.code} &nbsp;·&nbsp; ${c.room} &nbsp;·&nbsp; ${c.teacher}</div>
            ${c.notes ? `<div style="font-size:0.78rem;color:var(--yellow);margin-top:3px;display:flex;align-items:center;gap:4px">📌 ${c.notes}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="type-badge type-${c.type || 'lecture'}">${c.type || 'lecture'}</span>
            <button class="task-delete-btn" onclick="showTimetableEntryModal(${day}, ${idx})" title="Edit class entry" style="padding:4px 6px">
              ${icons.edit()}
            </button>
          </div>
        </div>`;
    }).join('');
  }

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Timetable</div>
        <div class="page-subtitle">${classes.length} class${classes.length!==1?'es':''} on ${DAY_NAMES[day]} ${isCustom ? '· (Customized Schedule)' : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-primary" onclick="showTimetableEntryModal(${day}, null)" style="display:flex;align-items:center;gap:6px;font-size:0.8rem;padding:7px 14px">
          ${icons.plus()} Add Class
        </button>
        <button class="btn-secondary" onclick="triggerTimetableImport()" style="display:flex;align-items:center;gap:6px;font-size:0.8rem;padding:7px 14px">
          📷 Scan Photo
        </button>
        ${isCustom ? `
          <button class="btn-secondary" onclick="resetTimetableToDefault()" style="font-size:0.8rem;padding:7px 12px;color:var(--text-muted)">
            Reset Default
          </button>` : ''}
      </div>
    </div>
    <div class="tt-day-tabs">${tabs}</div>
    ${content}
    ${day===today&&classes.length?'<div class="text-xs text-muted" style="margin-top:12px;text-align:center">Highlighted = current class &nbsp;|&nbsp; Faded = past</div>':''}
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
  const subject  = (document.getElementById('tte-subject').value || '').trim();
  const code     = (document.getElementById('tte-code').value || '').trim() || 'SUB';
  const room     = (document.getElementById('tte-room').value || '').trim() || '—';
  const teacher  = (document.getElementById('tte-teacher').value || '').trim() || '—';
  const type     = document.getElementById('tte-type').value || 'lecture';
  const notes    = (document.getElementById('tte-notes').value || '').trim();

  if (!subject) {
    alert("Please enter a subject name.");
    return;
  }

  const tt = JSON.parse(JSON.stringify(loadTimetable()));
  if (!tt[newDay]) tt[newDay] = [];

  const entry = { time, end, subject, code, room, teacher, type };
  if (notes) entry.notes = notes;

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
  renderTimetable();
}

// ── Assignments ───────────────────────────────────────────────
function renderAssignments() {
  const el  = document.getElementById('page-assignments');
  const all = allTasks();

  const subjects = ['all', ...new Set(all.map(a => a.code))];
  const statusFilters = [
    { key:'all',       label:'All'       },
    { key:'pending',   label:'Pending'   },
    { key:'submitted', label:'Submitted' },
    { key:'overdue',   label:'Overdue'   },
  ];

  let filtered = all;
  if (state.assignFilter === 'pending')   filtered = filtered.filter(a => a.status === 'pending');
  if (state.assignFilter === 'submitted') filtered = filtered.filter(a => a.status === 'submitted');
  if (state.assignFilter === 'overdue')   filtered = filtered.filter(a => a.status === 'pending' && a.dueDate < todayStr());
  if (state.assignSubjectFilter !== 'all') filtered = filtered.filter(a => a.code === state.assignSubjectFilter);

  filtered.sort((a,b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  const statusBar  = statusFilters.map(f => `<button class="filter-chip ${f.key===state.assignFilter?'active':''}" onclick="setAssignFilter('${f.key}')">${f.label}</button>`).join('');
  const subjectBar = subjects.map(s => `<button class="filter-chip ${s===state.assignSubjectFilter?'active':''}" onclick="setAssignSubject('${s}')">${s==='all'?'All Subjects':s}</button>`).join('');

  const cards = filtered.length ? filtered.map(a => {
    const days = dueDaysLeft(a.dueDate);
    const done = a.status === 'submitted';
    const label = done ? 'Submitted' : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due Today' : `${days}d left`;
    const cls   = done ? '' : days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'soon' : '';
    const isCustom = !!a.isCustom;

    return `
      <div class="assignment-card priority-${a.priority} ${done?'done':''}" id="ac-${a.id}">
        <div class="assignment-checkbox" onclick="toggleAssignment('${a.id}')">
          ${done ? icons.check() : ''}
        </div>
        <div class="assignment-body">
          <div class="assignment-subject" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${a.subject} · ${a.code}
            ${isCustom ? '<span class="session-badge">My task</span>' : ''}
          </div>
          <div class="assignment-title">${a.title}</div>
          <div class="assignment-desc">${a.description}</div>
          <div class="assignment-footer">
            <span class="due-badge ${cls}">
              ${svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', 12)}
              ${formatDate(a.dueDate)} · ${label}
            </span>
            <span class="marks-badge">${a.marks > 0 ? a.marks + ' marks' : ''}</span>
            ${isCustom ? `
              <button class="task-edit-btn" onclick="showAddTaskModal('${a.id}')" title="Edit task" aria-label="Edit task">${icons.edit()}</button>
              <button class="task-delete-btn" onclick="deleteCustomTask('${a.id}')" title="Delete task" aria-label="Delete task">${icons.trash()}</button>
            ` : ''}
          </div>
        </div>
      </div>`;
  }).join('') : (all.length === 0 
    ? `<div class="card" style="text-align:center;padding:40px;color:var(--text-muted);border-style:dashed">✨ No tasks yet! Click <strong>+ Add Task</strong> above to create your first task.</div>`
    : `<div class="card" style="text-align:center;padding:40px;color:var(--text-muted);border-style:dashed">🔍 No tasks found for this filter.</div>`);

  el.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="page-title">Assignments</div>
        <div class="page-subtitle">${pendingCount()} pending · ${all.filter(a=>a.status==='submitted').length} submitted · ${state.customTasks.length} custom</div>
      </div>
      <button class="btn-primary" onclick="showAddTaskModal()" style="display:flex;align-items:center;gap:6px;flex-shrink:0">${icons.plus()} Add Task</button>
    </div>
    <div class="filter-bar">${statusBar}</div>
    <div class="filter-bar">${subjectBar}</div>
    ${cards}
  `;
}

// ── Notices ───────────────────────────────────────────────────
function renderNotices() {
  const el = document.getElementById('page-notices');
  const q  = state.noticeSearch.toLowerCase();

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
      <div class="notice-preview">${n.content}</div>
    </div>
  `).join('') : `<div class="card" style="text-align:center;padding:40px;color:var(--text-muted);border-style:dashed">🔍 No matching notices.</div>`;

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
        <div class="page-title">Notices</div>
        <div class="page-subtitle">${NOTICES.filter(n=>n.important).length} important</div>
      </div>
    </div>
    <div class="search-input-wrapper" style="position:relative;display:flex;align-items:center">
      <span class="s-icon">${icons.search()}</span>
      <input type="text" placeholder="Search notices…" value="${state.noticeSearch}"
        oninput="filterNotices(this.value)" id="notice-search" style="flex:1">
      <button id="notice-search-clear" onclick="filterNotices('');document.getElementById('notice-search').value='';"
        style="position:absolute;right:10px;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;line-height:0;font-size:1rem;display:${state.noticeSearch?'block':'none'}"
        title="Clear search">×</button>
    </div>
    <div id="notices-list-container">${cardsHtml}</div>
  `;
}

// ── Quick Links ───────────────────────────────────────────────
function renderLinks() {
  const el = document.getElementById('page-links');
  const links = loadCustomLinks();

  const subjectsHtml = links.map((s, si) => `
    <div class="link-subject-card" id="link-card-${si}">
      <div class="link-subject-header" style="display:flex;align-items:center;gap:8px">
        <span class="link-color-dot" style="background:${s.color || '#6366f1'}"></span>
        <span style="flex:1;font-weight:600">${s.subject}</span>
        <span class="link-code">${s.code}</span>
        <button onclick="editLinkSubject(${si})" title="Edit subject" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.9rem;padding:2px 6px">✏️</button>
        <button onclick="deleteLinkSubject(${si})" title="Delete subject" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:0.9rem;padding:2px 6px">🗑</button>
      </div>
      <div class="link-resources">
        ${s.resources.map((r, ri) => `
          <div style="display:flex;align-items:center;gap:6px">
            <a class="resource-link" href="${r.url}" target="_blank" rel="noopener" style="flex:1">
              <span class="r-icon">${getResourceIcon(r.icon || 'link')}</span>
              <span class="resource-label">${r.label}</span>
            </a>
            <button onclick="editLinkResource(${si},${ri})" title="Edit" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.8rem;padding:2px 4px">✏️</button>
            <button onclick="deleteLinkResource(${si},${ri})" title="Delete" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:0.8rem;padding:2px 4px">✕</button>
          </div>`).join('')}
        <button onclick="addLinkResource(${si})" style="margin-top:8px;font-size:0.78rem;color:var(--accent);background:none;border:none;cursor:pointer;padding:4px 0">+ Add Resource</button>
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Quick Links</div>
        <div class="page-subtitle">Your personal notes &amp; resources — fully editable</div>
      </div>
      <button class="btn-primary" onclick="addLinkSubject()" style="margin-top:4px">+ Add Subject</button>
    </div>
    <div class="links-grid">${subjectsHtml}</div>
  `;
}

window.addLinkSubject = function() {
  showLinkSubjectModal(null, null);
};

window.editLinkSubject = function(si) {
  const links = loadCustomLinks();
  showLinkSubjectModal(si, links[si]);
};

window.deleteLinkSubject = function(si) {
  if (!confirm('Delete this subject and all its resources?')) return;
  const links = loadCustomLinks();
  links.splice(si, 1);
  saveCustomLinks(links);
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
  renderLinks();
};

function showLinkSubjectModal(si, existing) {
  document.getElementById('link-subject-modal-backdrop')?.remove();
  const isNew = si === null;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'link-subject-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <span class="modal-title">${isNew ? 'Add Subject' : 'Edit Subject'}</span>
        <button class="modal-close" onclick="document.getElementById('link-subject-modal-backdrop')?.remove()">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label class="form-label">Subject Name</label>
          <input id="lsm-name" class="form-input" value="${existing?.subject || ''}" placeholder="e.g. Data Structures" />
        </div>
        <div>
          <label class="form-label">Short Code</label>
          <input id="lsm-code" class="form-input" value="${existing?.code || ''}" placeholder="e.g. DS" />
        </div>
        <div>
          <label class="form-label">Color (hex)</label>
          <input id="lsm-color" type="color" value="${existing?.color || '#6366f1'}" style="width:60px;height:36px;border:none;cursor:pointer;background:none" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('link-subject-modal-backdrop')?.remove()">Cancel</button>
        <button class="btn-primary" onclick="saveLinkSubject(${si === null ? 'null' : si})">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
}

window.saveLinkSubject = function(si) {
  const name  = document.getElementById('lsm-name')?.value?.trim();
  const code  = document.getElementById('lsm-code')?.value?.trim();
  const color = document.getElementById('lsm-color')?.value || '#6366f1';
  if (!name) { alert('Subject name is required.'); return; }
  const links = loadCustomLinks();
  if (si === null) {
    links.push({ subject: name, code: code || name.slice(0,4).toUpperCase(), color, resources: [] });
  } else {
    links[si] = { ...links[si], subject: name, code: code || links[si].code, color };
  }
  saveCustomLinks(links);
  document.getElementById('link-subject-modal-backdrop')?.remove();
  renderLinks();
};

function showLinkResourceModal(si, ri, existing) {
  document.getElementById('link-resource-modal-backdrop')?.remove();
  const isNew = ri === null;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'link-resource-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <span class="modal-title">${isNew ? 'Add Resource' : 'Edit Resource'}</span>
        <button class="modal-close" onclick="document.getElementById('link-resource-modal-backdrop')?.remove()">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label class="form-label">Label</label>
          <input id="lrm-label" class="form-input" value="${existing?.label || ''}" placeholder="e.g. GFG DSA Sheet" />
        </div>
        <div>
          <label class="form-label">URL</label>
          <input id="lrm-url" class="form-input" type="url" value="${existing?.url || ''}" placeholder="https://..." />
        </div>
        <div>
          <label class="form-label">Icon</label>
          <select id="lrm-icon" class="form-input">
            ${['link','book-open','code','video','eye','graduation-cap','database','cpu','list'].map(ic =>
              `<option value="${ic}" ${(existing?.icon||'link')===ic?'selected':''}>${ic}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('link-resource-modal-backdrop')?.remove()">Cancel</button>
        <button class="btn-primary" onclick="saveLinkResource(${si},${ri === null ? 'null' : ri})">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
}

window.saveLinkResource = function(si, ri) {
  const label = document.getElementById('lrm-label')?.value?.trim();
  const url   = document.getElementById('lrm-url')?.value?.trim();
  const icon  = document.getElementById('lrm-icon')?.value || 'link';
  if (!label || !url) { alert('Label and URL are required.'); return; }
  const links = loadCustomLinks();
  if (ri === null) {
    links[si].resources.push({ label, url, icon });
  } else {
    links[si].resources[ri] = { label, url, icon };
  }
  saveCustomLinks(links);
  document.getElementById('link-resource-modal-backdrop')?.remove();
  renderLinks();
};

// ── Daily Summary ─────────────────────────────────────────────
function renderSummary() {
  const el       = document.getElementById('page-summary');
  const today    = new Date();
  const todayDay = today.getDay();
  const classes  = TIMETABLE[todayDay] || [];
  const dueTodayItems = allTasks().filter(a => a.dueDate === todayStr() && a.status === 'pending');
  const importantNotices = NOTICES.filter(n => n.important).slice(0, 3);
  const overdueItems = allTasks().filter(a => a.status === 'pending' && a.dueDate < todayStr());
  const currentMin   = currentTimeMinutes();
  const remaining    = classes.filter(c => timeToMinutes(c.end) > currentMin);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Daily Summary</div>
        <div class="page-subtitle">${DAY_NAMES[todayDay]}, ${today.getDate()} ${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}</div>
      </div>
    </div>

    <div class="section-heading">Today's Schedule</div>
    ${classes.length === 0
      ? '<div class="card" style="text-align:center;padding:24px;color:var(--text-muted)">🏖️ No classes today.</div>'
      : classes.map(c => {
          const isPast = currentMin >= timeToMinutes(c.end);
          return `<div class="summary-item" style="${isPast?'opacity:0.5':''}">
            <div class="summary-icon" style="background:rgba(99,102,241,0.12);color:var(--accent)">${icons.timetable()}</div>
            <div>
              <div class="summary-text-main">${c.subject} <span class="type-badge type-${c.type}" style="margin-left:6px">${c.type}</span></div>
              <div class="summary-text-sub">${c.time}–${c.end} · ${c.room} · ${c.teacher}</div>
            </div>
          </div>`;
        }).join('')
    }

    <div class="section-heading">Due Today</div>
    ${dueTodayItems.length
      ? dueTodayItems.map(a => `
          <div class="summary-item">
            <div class="summary-icon" style="background:rgba(245,158,11,0.12);color:var(--yellow)">${icons.assignments()}</div>
            <div>
              <div class="summary-text-main">${a.title}</div>
              <div class="summary-text-sub">${a.subject} · ${a.marks > 0 ? a.marks + ' marks' : 'Custom task'}</div>
            </div>
          </div>`).join('')
      : '<div class="card" style="text-align:center;padding:20px;color:var(--text-muted)">✅ Nothing due today!</div>'
    }

    ${overdueItems.length ? `
      <div class="section-heading" style="color:var(--red)">⚠ Overdue</div>
      ${overdueItems.map(a => `
        <div class="summary-item" style="border-left:3px solid var(--red)">
          <div class="summary-icon" style="background:rgba(239,68,68,0.12);color:var(--red)">${icons.alert()}</div>
          <div>
            <div class="summary-text-main">${a.title}</div>
            <div class="summary-text-sub">${a.subject} · ${Math.abs(dueDaysLeft(a.dueDate))}d overdue</div>
          </div>
        </div>`).join('')}` : ''}

    <div class="section-heading">Important Notices</div>
    ${importantNotices.length
      ? importantNotices.map(n => `
          <div class="summary-item" onclick="showNotice('${n.id}')" style="cursor:pointer">
            <div class="summary-icon" style="background:rgba(239,68,68,0.12);color:var(--red)">${icons.notices()}</div>
            <div>
              <div class="summary-text-main">${n.title}</div>
              <div class="summary-text-sub">${formatDate(n.date)} · ${n.category}</div>
            </div>
          </div>`).join('')
      : '<div class="card" style="text-align:center;padding:20px;color:var(--text-muted)">No important notices.</div>'
    }

    <div class="section-heading">Quick Stats</div>
    <div class="stat-grid" style="margin-bottom:0">
      <div class="stat-card">
        <div class="stat-value">${remaining.length}</div>
        <div class="stat-label">Classes Remaining</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:${overdueItems.length?'var(--red)':'inherit'}">${overdueItems.length}</div>
        <div class="stat-label">Overdue Tasks</div>
      </div>
    </div>
  `;
}

// ── Settings ──────────────────────────────────────────────────
function renderSettings() {
  const el = document.getElementById('page-settings');
  const p  = liveProfile;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Your profile & app preferences — saved locally in your browser</div>
      </div>
    </div>

    <div class="section-heading">${icons.user()} Account & Cloud Sync</div>
    <div class="card" style="padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:600;font-size:0.95rem">${currentUser ? (currentUser.displayName || currentUser.email || 'Cloud User') : 'Local Storage Mode'}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">
            ${currentUser ? `Cross-device sync active · UID: ${currentUser.uid.slice(0, 8)}…` : 'Sign in with Google to sync tasks & profile across phone and laptop.'}
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

    <div class="section-heading">${icons.user()} Profile</div>
    <div class="card" style="padding:20px;margin-bottom:16px">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input type="text" class="form-input" id="s-name" value="${p.name.replace(/"/g, '&quot;')}" placeholder="Your Name">
        </div>
        <div class="form-group">
          <label class="form-label">Roll Number</label>
          <input type="text" class="form-input" id="s-roll" value="${p.rollNo}" placeholder="e.g. 2K23/AIDS/042">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">College / University</label>
        <input type="text" class="form-input" id="s-college" value="${p.college}" placeholder="e.g. Delhi Technological University">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Branch</label>
          <input type="text" class="form-input" id="s-branch" value="${p.branch}" placeholder="e.g. AI & Data Science">
        </div>
        <div class="form-group">
          <label class="form-label">Year & Semester</label>
          <input type="text" class="form-input" id="s-year" value="${p.year}" placeholder="e.g. 2nd Year — Semester 4">
        </div>
      </div>
    </div>

    <div class="section-heading">${icons.clock()} Academic</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">End-Semester Exam Date</label>
        <input type="date" class="form-input" id="s-exam-date" value="${p.examDate}" style="max-width:240px">
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">
          Shows a live countdown on your dashboard once set.
        </div>
      </div>
    </div>



    <div class="section-heading">${icons.layers()} Visual Theme</div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Active Theme</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="filter-chip ${document.documentElement.getAttribute('data-theme')==='dark'?'active':''}" onclick="setTheme('dark')">
            🌙 Dark (Slate)
          </button>
          <button class="filter-chip ${document.documentElement.getAttribute('data-theme')==='light'?'active':''}" onclick="setTheme('light')">
            ☀️ Light (Clean)
          </button>
          <button class="filter-chip ${document.documentElement.getAttribute('data-theme')==='glass'?'active':''}" onclick="setTheme('glass')">
            ⚡ Futuristic Glass (Dark)
          </button>
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

    <div class="section-heading">${icons.trash()} Data Management</div>
    <div class="card" style="padding:18px">
      <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.6">
        All your data (profile, tasks, assignment statuses) is stored only in this browser.
        Export a backup before clearing anything.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="exportData()" style="display:flex;align-items:center;gap:6px">
          Export Backup (.json)
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
  const rawName = (document.getElementById('s-name').value || '').trim();
  const nameToSave = (rawName.toLowerCase() === 'your name') ? '' : rawName;
  const profile = {
    name:     nameToSave,
    college:  (document.getElementById('s-college').value  || '').trim(),
    branch:   (document.getElementById('s-branch').value   || '').trim(),
    year:     (document.getElementById('s-year').value     || '').trim(),
    rollNo:   (document.getElementById('s-roll').value     || '').trim(),
    examDate:  document.getElementById('s-exam-date').value || '',
  };
  safeSetStorage(KEY_PROFILE, profile);
  Object.assign(liveProfile, profile);

  // Show "Saved" feedback
  const saved = document.getElementById('settings-saved');
  saved.style.display = 'flex';
  setTimeout(() => { saved.style.display = 'none'; }, 2500);

  // Refresh topbar avatar / name
  updateTopbarProfile();
  syncToCloud();
}

function exportData() {
  const data = {
    profile:            loadProfile(),
    customTasks:        state.customTasks,
    assignmentStatuses: safeGetStorage(KEY_ASSIGNMENTS, {}),
    theme:              localStorage.getItem(KEY_THEME) || 'dark',
    exportedAt:         new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `campus-os-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
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
      if (data.theme) {
        localStorage.setItem(KEY_THEME, data.theme);
        initTheme();
      }

      updateTopbarProfile();
      updateNavBadges();
      alert('Backup restored successfully!');
      renderSettings();
    } catch (err) {
      alert('Error parsing backup file: ' + err.message);
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

// ── Add / Edit Task Modal ──────────────────────────────────────
function showAddTaskModal(editTaskId = null) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().split('T')[0];

  const editTask = editTaskId ? state.customTasks.find(t => t.id === editTaskId) : null;

  const subjectOptions = QUICK_LINKS.map(s => {
    const val = `${s.subject}|||${s.code}`;
    const selected = editTask && editTask.code === s.code ? 'selected' : '';
    return `<option value="${val}" ${selected}>${s.subject} (${s.code})</option>`;
  }).join('');

  const isOther = editTask && !QUICK_LINKS.some(s => s.code === editTask.code);
  const otherSelected = isOther ? 'selected' : '';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'add-task-backdrop';
  backdrop.innerHTML = `
    <div class="modal add-task-modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2 class="modal-title">${editTask ? 'Edit Task' : 'Add New Task'}</h2>
        <button class="modal-close" onclick="document.getElementById('add-task-backdrop').remove()">${icons.x()}</button>
      </div>

      <div class="form-group">
        <label class="form-label">Subject <span class="req">*</span></label>
        <select class="form-select" id="task-subject">
          <option value="">Select subject…</option>
          ${subjectOptions}
          <option value="Other|||OTH" ${otherSelected}>Other</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Title <span class="req">*</span></label>
        <input type="text" class="form-input" id="task-title"
          placeholder="e.g. Assignment 3 — Decision Trees" maxlength="120"
          value="${editTask ? editTask.title.replace(/"/g, '&quot;') : ''}">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Due Date <span class="req">*</span></label>
          <input type="date" class="form-input" id="task-due" value="${editTask ? editTask.dueDate : defaultDate}">
        </div>
        <div class="form-group">
          <label class="form-label">Marks</label>
          <input type="number" class="form-input" id="task-marks" placeholder="10" min="0" max="100"
            value="${editTask && editTask.marks ? editTask.marks : ''}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Priority</label>
        <div class="priority-pills">
          <label class="priority-pill priority-high">
            <input type="radio" name="task-priority" value="high" ${editTask && editTask.priority === 'high' ? 'checked' : ''}> High
          </label>
          <label class="priority-pill priority-medium">
            <input type="radio" name="task-priority" value="medium" ${!editTask || editTask.priority === 'medium' ? 'checked' : ''}> Medium
          </label>
          <label class="priority-pill priority-low">
            <input type="radio" name="task-priority" value="low" ${editTask && editTask.priority === 'low' ? 'checked' : ''}> Low
          </label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-input form-textarea" id="task-desc"
          placeholder="Submission instructions, marks breakdown, etc.">${editTask ? editTask.description : ''}</textarea>
      </div>

      <div class="form-actions">
        <button class="btn-secondary" onclick="document.getElementById('add-task-backdrop').remove()">Cancel</button>
        <button class="btn-primary" onclick="submitAddTask(${editTask ? `'${editTask.id}'` : ''})">${editTask ? 'Save Changes' : 'Add Task'}</button>
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
  const subjectEl  = document.getElementById('task-subject');
  const titleEl    = document.getElementById('task-title');
  const dueEl      = document.getElementById('task-due');
  const marksEl    = document.getElementById('task-marks');
  const descEl     = document.getElementById('task-desc');
  const priorityEl = document.querySelector('input[name="task-priority"]:checked');

  [subjectEl, titleEl, dueEl].forEach(el => el.classList.remove('error'));

  let valid = true;
  if (!subjectEl.value)       { subjectEl.classList.add('error'); valid = false; }
  if (!titleEl.value.trim())  { titleEl.classList.add('error');   valid = false; }
  if (!dueEl.value)           { dueEl.classList.add('error');     valid = false; }
  if (!valid) return;

  const [subject, code] = subjectEl.value.split('|||');

  if (editTaskId) {
    const task = state.customTasks.find(t => t.id === editTaskId);
    if (task) {
      task.subject     = subject;
      task.code        = code;
      task.title       = titleEl.value.trim();
      task.description = descEl.value.trim() || '—';
      task.dueDate     = dueEl.value;
      task.priority    = priorityEl?.value || 'medium';
      task.marks       = parseInt(marksEl.value) || 0;
    }
  } else {
    const task = {
      id:          `c-${Date.now()}`,
      subject,
      code,
      title:       titleEl.value.trim(),
      description: descEl.value.trim() || '—',
      dueDate:     dueEl.value,
      priority:    priorityEl?.value || 'medium',
      status:      'pending',
      marks:       parseInt(marksEl.value) || 0,
      isCustom:    true,
    };
    state.customTasks.push(task);
  }

  saveCustomTasks();
  document.getElementById('add-task-backdrop')?.remove();
  renderPage(state.currentPage);
  updateNavBadges();
}

// ── Notice Modal ──────────────────────────────────────────────
function showNotice(id) {
  const n = NOTICES.find(x => x.id === id);
  if (!n) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">${icons.x()}</button>
      <div style="margin-bottom:14px">
        <span class="cat-badge cat-${n.category}">${n.category}</span>
        ${n.important ? '<span class="cat-badge" style="background:rgba(239,68,68,0.12);color:var(--red);margin-left:6px">Important</span>' : ''}
      </div>
      <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:10px;line-height:1.4">${n.title}</h2>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:14px">${formatDate(n.date)}</div>
      <p style="font-size:0.9rem;line-height:1.7;color:var(--text-secondary)">${n.content}</p>
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
window.showTimetableEntryModal = showTimetableEntryModal;
window.saveTimetableEntry      = saveTimetableEntry;
window.deleteTimetableEntry    = deleteTimetableEntry;
window.saveLinkSubject         = saveLinkSubject;
window.saveLinkResource        = saveLinkResource;

window.toggleAssignment = (id) => {
  // Custom task
  const ct = state.customTasks.find(x => x.id === id);
  if (ct) {
    ct.status = ct.status === 'submitted' ? 'pending' : 'submitted';
    saveCustomTasks();
    renderPage(state.currentPage);
    updateNavBadges();
    return;
  }
  // Data.js assignment
  const a = state.assignments.find(x => x.id === id);
  if (!a) return;
  a.status = a.status === 'submitted' ? 'pending' : 'submitted';
  saveAssignments();
  renderPage(state.currentPage);
  updateNavBadges();
};

window.deleteCustomTask = (id) => {
  if (!confirm('Delete this task?')) return;
  state.customTasks = state.customTasks.filter(t => t.id !== id);
  saveCustomTasks();
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
  document.title = pending > 0 ? `(${pending}) Campus OS` : 'Campus OS';

  document.querySelectorAll('[data-nav="assignments"]').forEach(el => {
    const badge = el.querySelector('.nav-badge');
    if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
    el.classList.toggle('has-badge', pending > 0);
    const dot = el.querySelector('.bnav-dot');
    if (dot) dot.style.display = pending > 0 ? 'block' : 'none';
  });
}

// ── Init ──────────────────────────────────────────────────────
function init() {
  initTheme();
  updateTopbarProfile();

  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('global-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleGlobalSearch(e.target.value);
  });

  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigate(hash);
  updateNavBadges();

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
}

document.addEventListener('DOMContentLoaded', init);
