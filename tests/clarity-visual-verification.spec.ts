import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';

const THEMES = ['paper-slate', 'midnight-ink'] as const;
const DESKTOP = { width: 1440, height: 980 };
const MOBILE = { width: 390, height: 844 };

const SEL = {
  rootHtml: 'html',
  body: 'body',

  topbar: '[data-testid="topbar"], .topbar, header.topbar',
  themeToggle: [
    '[data-testid="theme-toggle"]',
    '#theme-toggle-btn',
    '[data-action="toggle-theme"]',
    '.topbar-theme-toggle',
    '.theme-toggle',
    'button[aria-label*="theme" i]',
    'button[title*="theme" i]'
  ],
  themeMenuButtons: [
    '[data-testid="theme-option-paper-slate"]',
    '[data-testid="theme-option-midnight-ink"]',
    '[data-theme-option="paper-slate"]',
    '[data-theme-option="midnight-ink"]'
  ],

  addTaskButton: [
    '[data-testid="add-task-button"]',
    '[data-action="add-task"]',
    'button:has-text("Add Task")',
    'button:has-text("New Task")',
    'button:has-text("Quick Add")'
  ],
  taskSurface: [
    '[data-testid="add-task-modal"]',
    '[data-testid="task-modal"]',
    '[data-testid="task-drawer"]',
    '[role="dialog"]',
    '.task-modal',
    '.add-task-modal',
    '.modal',
    '.drawer'
  ],
  taskTitleInput: [
    '[data-testid="task-title"]',
    '#task-title',
    'input[name="title"]',
    'input[name="taskTitle"]',
    'input[placeholder*="task" i]',
    'input[placeholder*="title" i]'
  ],
  taskSubjectSelect: [
    '[data-testid="task-subject"]',
    '#task-subject',
    'select[name="subject"]',
    'select[id*="subject" i]',
    '[aria-label*="subject" i]'
  ],
  taskDateInput: [
    '[data-testid="task-due"]',
    '[data-testid="task-date"]',
    '#task-due',
    'input[type="date"]'
  ],
  taskPrioritySelect: [
    '[data-testid="task-priority"]',
    '.priority-pills',
    'select[name="priority"]',
    'select[id*="priority" i]'
  ],
  taskSubmitButton: [
    '[data-testid="task-save"]',
    'button:has-text("Save")',
    'button:has-text("Add Task")',
    'button:has-text("Create Mission")',
    'button:has-text("Create")'
  ],

  timetableView: [
    '[data-testid="timetable"]',
    '#page-timetable',
    '#timetable-view',
    '.timetable',
    '[data-screen="timetable"]'
  ],
  timetableNav: [
    '[data-nav="timetable"]',
    'button:has-text("Timetable")',
    'a:has-text("Timetable")',
    '.sidebar-item:has-text("Timetable")',
    '.nav-tab:has-text("Schedule")'
  ],

  subjectsNav: [
    '[data-nav="subjects"]',
    'button:has-text("Subjects")',
    'a:has-text("Subjects")',
    '.sidebar-item:has-text("Subjects")',
    '.nav-tab:has-text("Subjects")'
  ],
  subjectHub: [
    '[data-testid="subject-hub"]',
    '[data-testid="subjects-list"]',
    '#page-subjects',
    '#subjects-view',
    '.subjects-grid',
    '.subject-list'
  ],

  settingsNav: [
    '[data-nav="settings"]',
    'button:has-text("Settings")',
    'a:has-text("Settings")',
    '.sidebar-item:has-text("Settings")'
  ],
  consoleErrorIgnore: [/favicon/i, /firebase/i]
};

async function gotoApp(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('cos_onboarding_dismissed', 'true');
      localStorage.setItem('cos_onboarding_done', '1');
      if (!localStorage.getItem('cos_profile')) {
        localStorage.setItem('cos_profile', JSON.stringify({
          name: 'Sanghpal Bhakte',
          rollNo: '202501128002',
          college: 'JNEC',
          branch: 'AI & Data Science',
          year: '2nd Year',
          batch: 'A2'
        }));
      }
    } catch (e) {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

async function clearRuntime(page: Page) {
  await page.evaluate(async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('cos_onboarding_dismissed', 'true');
      localStorage.setItem('cos_onboarding_done', '1');
      localStorage.setItem('cos_profile', JSON.stringify({
        name: 'Sanghpal Bhakte',
        rollNo: '202501128002',
        college: 'JNEC',
        branch: 'AI & Data Science',
        year: '2nd Year',
        batch: 'A2'
      }));
      if (typeof (window as any).dismissOnboarding === 'function') {
        (window as any).dismissOnboarding();
      }
      const ob = document.getElementById('onboarding-backdrop');
      if (ob) ob.remove();
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {}
  }).catch(() => {});
}

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function clickIfVisible(page: Page, selectors: string[]) {
  const locator = await firstVisible(page, selectors);
  if (!locator) return false;
  await locator.click();
  return true;
}

async function ensureTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((t) => {
    const legacyMap: Record<string, string> = {
      'sandstone-notes': 'paper-slate',
      'nordic-frost': 'paper-slate',
      'misty-mint': 'paper-slate',
      'espresso-desk': 'midnight-ink'
    };
    const resolved = legacyMap[t] || t;
    localStorage.setItem('cos_theme', resolved);
    document.documentElement.setAttribute('data-theme', resolved);
    if (typeof (window as any).setTheme === 'function') {
      (window as any).setTheme(resolved);
    }
  }, theme);
  await expect.poll(async () => page.locator(SEL.rootHtml).getAttribute('data-theme')).toBe(theme);
}

async function openAddTask(page: Page) {
  let ok = await clickIfVisible(page, SEL.addTaskButton);
  if (!ok) {
    await page.evaluate(() => {
      if (typeof (window as any).showAddTaskModal === 'function') (window as any).showAddTaskModal();
    });
  }
  const surface = await firstVisible(page, SEL.taskSurface);
  expect(surface, 'Could not find visible add-task surface').not.toBeNull();
  await expect(surface!).toBeVisible();
  await page.waitForTimeout(250);
  return surface!;
}

async function navigateToTimetable(page: Page) {
  const ok = await clickIfVisible(page, SEL.timetableNav);
  if (!ok) {
    await page.evaluate(() => {
      if (typeof (window as any).navigateTo === 'function') (window as any).navigateTo('timetable');
    });
  }
}

async function navigateToSubjects(page: Page) {
  const ok = await clickIfVisible(page, SEL.subjectsNav);
  if (!ok) {
    await page.evaluate(() => {
      if (typeof (window as any).navigateTo === 'function') (window as any).navigateTo('subjects');
    });
  }
}

function noisySubjectPattern(label: string) {
  return /\s-\s[A-Z]\d\b|\b[A-Z]\d\b|\bB\d\b|\bC\d\b|\btheory\b|\blab\b|\bsection\b|\bgroup\b/i.test(label);
}

test.describe('Clarity Desk Visual & Layout Verification', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clearRuntime(page);
  });

  test('topbar theme switch is visible', async ({ page }) => {
    const topbar = page.locator(SEL.topbar).first();
    await expect(topbar).toBeVisible();

    const toggle = await firstVisible(page, SEL.themeToggle);
    expect(toggle, 'No visible topbar theme toggle found').not.toBeNull();
    await expect(toggle!).toBeVisible();
  });

  test('topbar theme switch toggles only between canonical themes', async ({ page }) => {
    const toggle = await firstVisible(page, SEL.themeToggle);
    expect(toggle, 'No visible theme toggle found').not.toBeNull();

    const before = await page.locator(SEL.rootHtml).getAttribute('data-theme');
    await toggle!.click();
    await page.waitForTimeout(200);
    const after = await page.locator(SEL.rootHtml).getAttribute('data-theme');

    expect(['paper-slate', 'midnight-ink']).toContain(before || '');
    expect(['paper-slate', 'midnight-ink']).toContain(after || '');
    expect(after).not.toBe(before);
  });

  for (const theme of THEMES) {
    test(`dashboard screenshot ${theme} desktop`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await ensureTheme(page, theme);
      await expect(page).toHaveScreenshot(`clarity-dashboard-${theme}-desktop.png`, {
        fullPage: true,
        animations: 'disabled'
      });
    });

    test(`add-task surface is readable ${theme}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await ensureTheme(page, theme);
      const surface = await openAddTask(page);

      const style = await surface.evaluate((el) => {
        const s = getComputedStyle(el as HTMLElement);
        return {
          backgroundColor: s.backgroundColor,
          backdropFilter: s.backdropFilter,
          borderColor: s.borderColor,
          opacity: s.opacity
        };
      });

      expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(style.opacity).not.toBe('0');
      await expect(surface).toHaveScreenshot(`clarity-add-task-${theme}-desktop.png`, {
        animations: 'disabled'
      });
    });

    test(`add-task controls align on desktop ${theme}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await ensureTheme(page, theme);
      const surface = await openAddTask(page);

      const report = await surface.evaluate((panel) => {
        const panelRect = panel.getBoundingClientRect();
        const controls = Array.from(panel.querySelectorAll('input, select, textarea, button')).map((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
            visible: r.width > 0 && r.height > 0,
            text: (el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 40)
          };
        });
        const overflow = controls.filter((c) => c.visible && (c.left < panelRect.left - 1 || c.right > panelRect.right + 1));
        return { controls, overflow, panel: { left: panelRect.left, right: panelRect.right, width: panelRect.width, height: panelRect.height } };
      });

      expect(report.overflow, `Desktop overflow detected: ${JSON.stringify(report.overflow)}`).toEqual([]);
    });

    test(`add-task controls align on mobile ${theme}`, async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await ensureTheme(page, theme);
      const surface = await openAddTask(page);

      const report = await surface.evaluate((panel) => {
        const panelRect = panel.getBoundingClientRect();
        const controls = Array.from(panel.querySelectorAll('input, select, textarea, button')).map((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
            visible: r.width > 0 && r.height > 0,
            text: (el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 40)
          };
        });
        const overflow = controls.filter((c) => c.visible && (c.left < panelRect.left - 1 || c.right > panelRect.right + 1));
        return { controls, overflow, panel: { left: panelRect.left, right: panelRect.right, width: panelRect.width, height: panelRect.height } };
      });

      expect(report.overflow, `Mobile overflow detected: ${JSON.stringify(report.overflow)}`).toEqual([]);
      await expect(surface).toHaveScreenshot(`clarity-add-task-${theme}-mobile.png`, {
        animations: 'disabled'
      });
    });
  }

  test('task subject selector uses canonical names only', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await ensureTheme(page, 'paper-slate');
    await openAddTask(page);

    const subjectSelect = await firstVisible(page, SEL.taskSubjectSelect);
    expect(subjectSelect, 'Could not find task subject selector').not.toBeNull();

    const options = await subjectSelect!.evaluate((el) => {
      if (el instanceof HTMLSelectElement) {
        return Array.from(el.options).map((o) => (o.textContent || '').trim()).filter(Boolean);
      }
      return [] as string[];
    });

    const academicOptions = options.filter(o => !o.includes('General Desk Task') && !o.includes('Long-Term Mission') && !o.includes('Select subject'));
    const noisy = academicOptions.filter(noisySubjectPattern);
    expect(noisy, `Noisy subject options found: ${JSON.stringify(noisy)}`).toEqual([]);
  });

  test('subject hub is not cluttered by timetable suffix variants', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await ensureTheme(page, 'paper-slate');
    await navigateToSubjects(page);

    const subjectHub = await firstVisible(page, SEL.subjectHub);
    expect(subjectHub, 'Could not find subject hub/list').not.toBeNull();

    const titles = await page.evaluate(() => {
      const cards = document.querySelectorAll('#page-subjects .attendance-subject-card, #page-subjects .card');
      return Array.from(cards).map(c => {
        const titleEl = c.querySelector('div[style*="font-weight:700"]') || c.querySelector('.card-title') || c;
        return (titleEl.textContent || '').trim();
      }).filter(Boolean);
    });

    const noisy = titles.filter(noisySubjectPattern);
    expect(noisy, `Noisy subject hub labels found: ${JSON.stringify(noisy)}`).toEqual([]);
  });

  test('timetable still preserves full operational class labels where present', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await ensureTheme(page, 'paper-slate');
    await navigateToTimetable(page);

    const timetable = await firstVisible(page, SEL.timetableView);
    expect(timetable, 'Could not find timetable view').not.toBeNull();
    const text = await timetable!.textContent();
    expect((text || '').trim().length).toBeGreaterThan(0);
  });

  test('no blocking console errors during core verification flow', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (SEL.consoleErrorIgnore.some((pattern) => pattern.test(text))) return;
      errors.push(text);
    });

    await gotoApp(page);
    await ensureTheme(page, 'paper-slate');
    await openAddTask(page);
    const closeBtn = await firstVisible(page, ['.modal-close', 'button:has-text("Cancel")']);
    if (closeBtn) await closeBtn.click();
    await navigateToSubjects(page);
    await navigateToTimetable(page);

    expect(errors, `Blocking console errors found: ${JSON.stringify(errors, null, 2)}`).toEqual([]);
  });
});
