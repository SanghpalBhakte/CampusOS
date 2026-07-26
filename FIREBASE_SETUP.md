# CampusOS — Firebase Production Setup & Security Guide

This document outlines the architecture, code implementation, and manual Firebase Console steps required to keep CampusOS fast, secure, and 100% free on the Firebase Spark Plan.

---

## 1. Automated Code Architecture (PWA & Firebase SDK)

CampusOS includes built-in PWA and Firebase SDK optimizations:

* **Offline-First Persistence**: `app.js` initializes Firestore with `persistentLocalCache` & `persistentMultipleTabManager` fallback so all data (profile, timetable, tasks, attendance) loads instantly at 0ms latency from IndexedDB.
* **Smart Server Snapshot Filtering**: Listens to `/users/{uid}` with `includeMetadataChanges: false` to ignore local pending write echoes and save Firestore read quota.
* **Tab Visibility Pause**: Automatically pauses the live cloud snapshot listener when the browser tab is hidden/minimized to save read operations.
* **Auto Pruning**: Automatically prunes completed tasks older than 14 days to keep payload sizes small.
* **PWA Service Worker (`sw.js`)**: Caches app shell assets (`index.html`, `app.js`, `style.css`, `data.js`) for offline execution.

---

## 2. Manual Firebase Console Setup (Free Spark Plan)

Follow these 5 steps in the [Firebase Console](https://console.firebase.google.com/project/campusos-83365/overview) to configure your project.

### Step 1: Firebase Hosting Setup
1. Go to **Firebase Console → Hosting**.
2. Confirm deployment target: `campusos-83365.web.app`.
3. To deploy updates from your terminal:
   ```bash
   firebase deploy --only hosting
   ```
4. *(Optional)* To add a custom domain: Click **Add Custom Domain** → enter your domain (e.g. `campusos.sanghpal.dev`) → update CNAME/A records with your domain provider.

---

### Step 2: Authentication Configuration (Google Provider)
1. Go to **Firebase Console → Authentication → Sign-in method**.
2. Click **Add new provider** → select **Google** → enable it and select your support email.
3. Go to **Authentication → Settings → Authorized Domains**.
4. Ensure the following domains are listed in the whitelist:
   * `campusos-83365.web.app`
   * `campusos-83365.firebaseapp.com`
   * `sanghpalbhakte.github.io`
   * `localhost`
   * *(Any custom domain you attach)*

---

### Step 3: Firestore Security Rules Setup
1. Go to **Firebase Console → Firestore Database → Rules**.
2. Paste the contents of `firestore.rules`:
   ```text
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // Deny read/write to all unlisted paths
       match /{document=**} {
         allow read, write: if false;
       }

       // Strict owner-only access for user profile, tasks, timetable, and attendance
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
3. Click **Publish** (or run `firebase deploy --only firestore:rules` from terminal).

---

### Step 4: Restrict Web API Key (Google Cloud Console Security)
1. Open the [Google Cloud Credentials Console](https://console.cloud.google.com/apis/credentials).
2. Select project **campusos-83365**.
3. Edit your Web API Key:
   * Under **Application restrictions**, choose **HTTP referrers (web sites)**.
   * Add:
     * `https://campusos-83365.web.app/*`
     * `https://campusos-83365.firebaseapp.com/*`
     * `https://sanghpalbhakte.github.io/*`
     * `http://localhost:*`
   * Under **API restrictions**, choose **Restrict key** and select:
     * *Identity Toolkit API*
     * *Cloud Firestore API*
4. Click **Save**.

---

### Step 5: Free Spark Plan Quotas Overview

CampusOS is optimized to run 100% free within these daily limits:

| Feature | Free Spark Quota | CampusOS Optimization |
| :--- | :--- | :--- |
| **Firestore Reads** | 50,000 / day | Cache-first IndexedDB reads (0 server reads on reload) |
| **Firestore Writes** | 20,000 / day | 2.5s debounced batch writes |
| **Firestore Storage** | 1 GiB total | Prunes old completed tasks >14 days |
| **Authentication** | 50,000 MAU free | Google OAuth Popup/Redirect with token reuse |
| **Hosting Bandwidth** | 360 MB / day | PWA static cache reduces server asset requests |

---

## 3. Deployment Commands

```bash
# Deploy both Hosting and Firestore Rules
firebase deploy

# Deploy Hosting only
firebase deploy --only hosting

# Deploy Firestore Rules only
firebase deploy --only firestore:rules
```
