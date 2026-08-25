import { test, expect } from '@playwright/test';

test.describe('Clarity Desk PWA Smoke Suite', () => {
  test('1. Manifest presence, linkage, and valid schema', async ({ page, request }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Verify manifest link tag in DOM
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);
    const href = await manifestLink.getAttribute('href');
    expect(href).toBeTruthy();

    // Fetch and parse manifest.json
    const res = await request.get(href || 'manifest.json');
    expect(res.status(), 'manifest.json must return HTTP 200').toBe(200);

    const manifest = await res.json();
    expect(manifest.name).toBe('Clarity Desk');
    expect(manifest.short_name).toBe('Clarity Desk');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);

    // Verify icons array has valid entries
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    // Verify key icon assets are reachable
    for (const icon of manifest.icons.slice(0, 3)) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.status(), `Icon asset ${icon.src} must be reachable`).toBe(200);
    }
  });

  test('2. Service worker registers, activates, and controls page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for Service Worker registration & activation
    const swStatus = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      try {
        const reg = await navigator.serviceWorker.ready;
        return {
          supported: true,
          active: !!reg.active,
          state: reg.active?.state || 'none'
        };
      } catch (err) {
        return { supported: true, error: String(err) };
      }
    });

    expect(swStatus.supported, 'Service worker must be supported in browser').toBe(true);
    expect(swStatus.active, 'Service worker must be active').toBe(true);
    expect(swStatus.state).toBe('activated');

    // Reload page and confirm service worker controls the client
    await page.reload({ waitUntil: 'domcontentloaded' });
    const isControlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    expect(isControlled, 'Service worker must control the page after reload').toBe(true);
  });

  test('3. Offline shell resilience', async ({ context, page }) => {
    // Initial online load to ensure precache settlement
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });

    // Simulate browser offline condition
    await context.setOffline(true);

    try {
      // Reload under offline state
      await page.reload({ waitUntil: 'domcontentloaded' });

      // Verify app shell and essential UI components render offline
      const topbar = page.locator('.topbar, [data-testid="topbar"]');
      await expect(topbar.first()).toBeVisible({ timeout: 5000 });

      const mainContent = page.locator('.app-shell, main, #app');
      await expect(mainContent.first()).toBeVisible();

      // Verify page is not a browser network error screen
      const title = await page.title();
      expect(title).toContain('Clarity Desk');
    } finally {
      // Always restore online state
      await context.setOffline(false);
    }
  });

  test('4. Update safety and cache version verification', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const cacheAudit = await page.evaluate(async () => {
      if (!('caches' in window)) return { supported: false, keys: [] };
      const keys = await caches.keys();
      return { supported: true, keys };
    });

    expect(cacheAudit.supported).toBe(true);
    // Cache version must match repository naming convention (clarity-desk-v*)
    const versionedCaches = cacheAudit.keys.filter((k: string) => k.startsWith('clarity-desk-v'));
    expect(versionedCaches.length, 'At least one versioned Clarity Desk cache must exist').toBeGreaterThanOrEqual(1);

    // Confirm no multi-version cache collision
    expect(versionedCaches.length, 'Only the latest active cache version should remain after activation').toBe(1);
  });
});
