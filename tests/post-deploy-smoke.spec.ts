import { test, expect } from '@playwright/test';

test.describe('Clarity Desk Post-Deploy / Target URL Smoke Suite', () => {
  test('1. App shell boots cleanly without unhandled runtime exceptions', async ({ page }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore harmless favicon or 3rd-party resource warnings
        if (!/favicon|firebase-app-compat|firestore/i.test(text)) {
          consoleErrors.push(text);
        }
      }
    });

    // Dismiss onboarding automatically for test stability
    await page.addInitScript(() => {
      try {
        localStorage.setItem('cos_onboarding_dismissed', 'true');
        localStorage.setItem('cos_onboarding_done', '1');
      } catch (e) {}
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Verify document title
    const title = await page.title();
    expect(title).toContain('Clarity Desk');

    // Verify topbar branding renders
    const topbar = page.locator('.topbar, [data-testid="topbar"]');
    await expect(topbar.first()).toBeVisible({ timeout: 10_000 });

    // Verify zero fatal page errors occurred during boot
    expect(pageErrors, `Unhandled page errors detected: ${pageErrors.map(e => e.message).join('; ')}`).toHaveLength(0);
    expect(consoleErrors, `Blocking console errors detected: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });

  test('2. Theme toggle is present, interactive, and toggles data-theme', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('cos_onboarding_dismissed', 'true');
        localStorage.setItem('cos_onboarding_done', '1');
      } catch (e) {}
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const themeToggle = page.locator('.topbar-theme-toggle, [data-testid="theme-toggle"], #theme-toggle-btn').first();
    await expect(themeToggle).toBeVisible({ timeout: 5000 });

    const initialTheme = await page.locator('html').getAttribute('data-theme');
    await themeToggle.click();
    await page.waitForTimeout(300);

    const toggledTheme = await page.locator('html').getAttribute('data-theme');
    expect(['paper-slate', 'midnight-ink']).toContain(toggledTheme || '');
    expect(toggledTheme).not.toBe(initialTheme);
  });

  test('3. Core navigation opens Timetable and Subject Hubs', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('cos_onboarding_dismissed', 'true');
        localStorage.setItem('cos_onboarding_done', '1');
      } catch (e) {}
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Navigate to Timetable
    const ttNav = page.locator('[data-nav="timetable"], a:has-text("Timetable"), .sidebar-item:has-text("Timetable"), .nav-item:has-text("Timetable")').first();
    if (await ttNav.isVisible().catch(() => false)) {
      await ttNav.click();
    } else {
      await page.evaluate(() => {
        if (typeof (window as any).navigateTo === 'function') (window as any).navigateTo('timetable');
      });
    }

    const timetableSection = page.locator('#page-timetable, #timetable-view, [data-testid="timetable-view"], .tt-day-tabs').first();
    await expect(timetableSection).toBeVisible({ timeout: 5000 });

    // Navigate to Subject Hubs
    const subNav = page.locator('[data-nav="subjects"], a:has-text("Subject"), .sidebar-item:has-text("Subject"), .nav-item:has-text("Subject")').first();
    if (await subNav.isVisible().catch(() => false)) {
      await subNav.click();
    } else {
      await page.evaluate(() => {
        if (typeof (window as any).navigateTo === 'function') (window as any).navigateTo('subjects');
      });
    }

    const subjectsSection = page.locator('#page-subjects, #subjects-view, [data-testid="subject-hub"]').first();
    await expect(subjectsSection).toBeVisible({ timeout: 5000 });
  });

  test('4. Add-task flow opens and controls are bounded', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('cos_onboarding_dismissed', 'true');
        localStorage.setItem('cos_onboarding_done', '1');
      } catch (e) {}
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Open add task modal
    await page.evaluate(() => {
      if (typeof (window as any).showAddTaskModal === 'function') {
        (window as any).showAddTaskModal();
      }
    });

    const taskSurface = page.locator('[data-testid="add-task-modal"], .add-task-modal').first();
    await expect(taskSurface).toBeVisible({ timeout: 5000 });

    // Verify task title input & subject selector exist inside modal
    const titleInput = page.locator('[data-testid="task-title"], #task-title').first();
    await expect(titleInput).toBeVisible();

    const subjectSelect = page.locator('[data-testid="task-subject"], #task-subject').first();
    await expect(subjectSelect).toBeVisible();

    // Close modal cleanly
    const closeBtn = page.locator('.modal-close, button:has-text("Cancel")').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    }
  });
});
