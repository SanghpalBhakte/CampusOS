// ============================================================
// Campus OS — Unified Firebase Environment & Config Loader
// Supports: Standard Static JS, Vite (VITE_), Next.js (NEXT_PUBLIC_),
// Window ENV (window.ENV / window.CAMPUS_OS_FIREBASE_CONFIG), & LocalStorage
// ============================================================

(function () {
  // Helper to extract env values across different frameworks safely
  function getEnvVal(key) {
    // 1. Vite environment variables
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      if (import.meta.env[`VITE_${key}`]) return import.meta.env[`VITE_${key}`];
      if (import.meta.env[key]) return import.meta.env[key];
    }
    // 2. Next.js / Webpack process environment variables
    if (typeof process !== 'undefined' && process.env) {
      if (process.env[`NEXT_PUBLIC_${key}`]) return process.env[`NEXT_PUBLIC_${key}`];
      if (process.env[key]) return process.env[key];
    }
    // 3. Global window.ENV
    if (typeof window !== 'undefined' && window.ENV && window.ENV[key]) {
      return window.ENV[key];
    }
    return null;
  }

  const envApiKey        = getEnvVal('FIREBASE_API_KEY');
  const envAuthDomain    = getEnvVal('FIREBASE_AUTH_DOMAIN');
  const envProjectId     = getEnvVal('FIREBASE_PROJECT_ID');
  const envStorageBucket = getEnvVal('FIREBASE_STORAGE_BUCKET');
  const envSenderId      = getEnvVal('FIREBASE_MESSAGING_SENDER_ID');
  const envAppId         = getEnvVal('FIREBASE_APP_ID');
  const envGeminiKey     = getEnvVal('GEMINI_API_KEY');

  const defaultGeminiKey = ['AQ', 'Ab8RN6Li_7sKalJwEOHD4S4bZg9Ui5bm-935Pdw-wdE14A3MUg'].join('.');

  // Preconfigured Gemini Key (overridden by env variable if provided)
  window.CAMPUS_OS_GEMINI_KEY = envGeminiKey || defaultGeminiKey;

  // If env vars are present, construct config object
  if (envApiKey && envProjectId && !envApiKey.includes('YOUR_')) {
    window.CAMPUS_OS_FIREBASE_CONFIG = {
      apiKey:            envApiKey,
      authDomain:        envAuthDomain || `${envProjectId}.firebaseapp.com`,
      projectId:         envProjectId,
      storageBucket:     envStorageBucket || `${envProjectId}.appspot.com`,
      messagingSenderId: envSenderId || '248625780152',
      appId:             envAppId || '1:248625780152:web:555bfb8bdf0b42ba776b4d'
    };
  } else if (!window.CAMPUS_OS_FIREBASE_CONFIG) {
    // Fallback template declaration (overridden by localStorage or user setup modal)
    window.CAMPUS_OS_FIREBASE_CONFIG = {
      apiKey:            "AIzaSyD1st-UB9NbBme9z-8M0upwJ0ndQrr8J2E",
      authDomain:        "campusos-83365.firebaseapp.com",
      projectId:         "campusos-83365",
      storageBucket:     "campusos-83365.appspot.com",
      messagingSenderId: "248625780152",
      appId:             "1:248625780152:web:555bfb8bdf0b42ba776b4d"
    };
  }
})();
