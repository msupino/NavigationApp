// @ts-check
// Coverage for the keyboard-shortcuts cheat-sheet (issue #420):
// '?' opens the modal, the toolbar Help button opens it, Esc / backdrop /
// ✕ close it, the modal is aria-labelled, the '?' shortcut is suppressed
// inside inputs, and existing global shortcuts (F, Ctrl-F, Esc, Backspace)
// keep working after the change.
const { test, expect } = require('./_setup');
const { enableShowReturn } = require('./_show-return');
const { hideToolbarMenus, pressShortcut } = require('./_toolbar');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_init_v1', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showShortcutsHelp === 'function');
}

test.describe('Keyboard-shortcuts cheat-sheet (#420)', () => {
  test('? (Shift-/) opens the modal with at least 7 listed shortcuts', async ({ page }) => {
    await boot(page);
    // Make sure nothing is focused so the '?' shortcut path runs.
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press('Shift+/');
    const modal = page.locator('.modal-back.shortcuts-help');
    await expect(modal).toBeVisible();
    const rowCount = await modal.locator('.shortcuts-help-keys').count();
    expect(rowCount).toBeGreaterThanOrEqual(7);
  });

  test('Modal has role=dialog, aria-modal, and aria-labelledby pointing at title',
    async ({ page }) => {
      await boot(page);
      await page.evaluate(() => showShortcutsHelp());
      const box = page.locator('.shortcuts-help-modal');
      await expect(box).toHaveAttribute('role', 'dialog');
      await expect(box).toHaveAttribute('aria-modal', 'true');
      await expect(box).toHaveAttribute('aria-labelledby', 'shortcuts-help-title');
      await expect(page.locator('#shortcuts-help-title')).toBeVisible();
    });

  test('Escape closes the modal', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showShortcutsHelp());
    await expect(page.locator('.modal-back.shortcuts-help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(0);
  });

  test('Toolbar Help button opens the modal', async ({ page }) => {
    await boot(page);
    await page.locator('#help-trigger').click();
    await expect(page.locator('.modal-back.shortcuts-help')).toBeVisible();
  });

  test('✕ close button hides the modal', async ({ page }) => {
    await boot(page);
    await page.locator('#help-trigger').click();
    await page.locator('.shortcuts-help-modal .modal-close-x').click();
    await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(0);
  });

  test('Backdrop click closes the modal', async ({ page }) => {
    await boot(page);
    await page.locator('#help-trigger').click();
    // Click in the corner of the backdrop, outside the .modal box.
    const back = page.locator('.modal-back.shortcuts-help');
    const box = await back.boundingBox();
    if (!box) throw new Error('backdrop has no bounding box');
    await page.mouse.click(box.x + 4, box.y + 4);
    await expect(back).toHaveCount(0);
  });

  test('Hebrew locale shows Hebrew title + labels', async ({ page }) => {
    await boot(page, 'he');
    await page.evaluate(() => showShortcutsHelp());
    await expect(page.locator('#shortcuts-help-title')).toHaveText('מקשי קיצור');
    // At least one row description should be a Hebrew string.
    const descs = await page.locator('.shortcuts-help-desc').allTextContents();
    expect(descs.some(t => /[\u0590-\u05FF]/.test(t))).toBe(true);
  });

  test('Hebrew locale still shows English shortcut keys', async ({ page }) => {
    await boot(page, 'he');
    await page.evaluate(() => showShortcutsHelp());
    const keyRows = await page.locator('.shortcuts-help-keys').allTextContents();
    expect(keyRows).toContain('A');
    expect(keyRows).toContain('N');
    expect(keyRows).toContain('C');
    expect(keyRows.some(t => t.includes('Ctrl') && t.includes('F') && t.includes('⌘'))).toBe(true);
  });

  test('? is suppressed when focused in #wp-search (search input)', async ({ page }) => {
    await boot(page);
    await page.locator('#search-trigger').click();
    await expect(page.locator('#wp-search')).toBeFocused();
    await page.keyboard.press('Shift+/');
    // Modal must NOT open while focus is in the input — the keypress flows
    // through to the input (browsers vary on whether the value reads back as
    // '?' or '/'; the contract here is just "we don't hijack").
    await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(0);
    const value = await page.locator('#wp-search').inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test('? is suppressed when focused in the waypoint-name inspector input', async ({ page }) => {
    await boot(page);
    // Drop two waypoints and select the first so the editable name row appears.
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.5, lng: 35.5, name: 'B' },
      ];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    });
    // Desktop menubar dropdowns overlap the inspector; close them so the
    // input is clickable.
    await hideToolbarMenus(page);
    const nameInput = page.locator('#insp-body .row input[type="text"]').first();
    await nameInput.click();
    await nameInput.focus();
    await page.keyboard.press('Shift+/');
    await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(0);
  });

  test('Existing F shortcut (fit-to-route) still works', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 33.0, lng: 35.5, name: 'B' },
      ];
      syncLegs();
      draw();
      // Pan/zoom away from the route so F has visible work to do.
      map.setView([29.5, 34.5], 8);
    });
    const before = await page.evaluate(() => ({
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      z: map.getZoom(),
    }));
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press('KeyF');
    // Map must have moved toward the route midpoint after F.
    await page.waitForFunction(prev => {
      const c = map.getCenter();
      return Math.abs(c.lat - prev.lat) + Math.abs(c.lng - prev.lng) > 0.5;
    }, before);
  });

  test('Existing Ctrl-F shortcut (search) still works', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-overlay')).not.toHaveClass(/hidden/);
  });

  test('Existing Backspace (delete selected waypoint) still works', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.5, lng: 35.5, name: 'B' },
        { lat: 33.0, lng: 36.0, name: 'C' },
      ];
      syncLegs();
      state.selected = { type: 'wp', index: 1 };
      showInspector();
      draw();
    });
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press('Backspace');
    const remaining = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(remaining).toEqual(['A', 'C']);
  });

  test('Esc closes shortcuts modal without closing other open modals (no flight-plan side-effect)',
    async ({ page }) => {
      await boot(page);
      await page.evaluate(() => showShortcutsHelp());
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(0);
      // Verify the deselect path was not invoked (state.selected was already null).
      const sel = await page.evaluate(() => state.selected);
      expect(sel).toBeNull();
    });

  test('Opening the modal twice is idempotent (no duplicate backdrops)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showShortcutsHelp(); showShortcutsHelp(); });
    await expect(page.locator('.modal-back.shortcuts-help')).toHaveCount(1);
  });

  test('Modal renders English defaults when locale has no overrides',
    async ({ page }) => {
      await boot(page, 'en');
      await page.evaluate(() => showShortcutsHelp());
      await expect(page.locator('#shortcuts-help-title')).toHaveText('Keyboard shortcuts');
      // Every visible row description must be a non-empty string — guards
      // against typos in SHORTCUTS_HELP_ROWS keys that would render the
      // raw key name (e.g. "shortcutFitRoute") in production.
      const descs = await page.locator('.shortcuts-help-desc').allTextContents();
      expect(descs.length).toBeGreaterThan(0);
      for (const d of descs) {
        expect(d).not.toMatch(/^shortcut[A-Z]/);
        expect(d.trim()).not.toBe('');
      }
    });

  test('+ / − zoom the map when magnifier is off', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      map.setView([32.55, 35.20], 10, { animate: false });
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    const z0 = await page.evaluate(() => map.getZoom());
    await page.keyboard.press('Equal');
    const z1 = await page.evaluate(() => map.getZoom());
    expect(z1).toBeGreaterThan(z0);
    await page.keyboard.press('Minus');
    const z2 = await page.evaluate(() => map.getZoom());
    expect(z2).toBe(z0);
  });

  test('+ / − adjust loupe zoom when magnifier is on (map zoom unchanged)', async ({ page }) => {
    // Boot + magnifier init + several evaluate round-trips can exceed the
    // 15s default budget on a saturated CI runner (timed out there twice).
    test.slow();
    await boot(page);
    // Toggle the magnifier via its keyboard shortcut instead of the toolbar
    // button: in desktop-menubar mode the button lives inside the View
    // dropdown, and menu/modal churn hiding that dropdown made the click
    // flaky (same family as the mosaic-modal incident in magnifier.spec.js).
    await pressShortcut(page, 'm');
    await expect(page.locator('#magnifier')).toBeVisible();
    const mapZ0 = await page.evaluate(() => map.getZoom());
    const magZ0 = await page.evaluate(() => window.magnifierZoom);
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press('Equal');
    expect(await page.evaluate(() => map.getZoom())).toBe(mapZ0);
    expect(await page.evaluate(() => window.magnifierZoom)).toBeGreaterThan(magZ0);
    await page.keyboard.press('Minus');
    expect(await page.evaluate(() => window.magnifierZoom)).toBe(magZ0);
  });

  test('M toggles magnifier', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await expect(page.locator('#magnifier')).not.toBeVisible();
    await page.keyboard.press('m');
    await expect(page.locator('#magnifier')).toBeVisible();
    await page.keyboard.press('M');
    await expect(page.locator('#magnifier')).not.toBeVisible();
  });

  test('B toggles show-return-path (ret-cb) and persists', async ({ page }) => {
    await boot(page);
    await enableShowReturn(page);
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    const cb = page.locator('#ret-cb');
    const before = await cb.isChecked();
    await page.keyboard.press('b');
    expect(await cb.isChecked()).toBe(!before);
    expect(await page.evaluate(() => window.showReturn)).toBe(!before);
    await page.keyboard.press('B');
    expect(await cb.isChecked()).toBe(before);
    expect(await page.evaluate(() => window.showReturn)).toBe(before);
  });

  test('B is suppressed when typing in an input', async ({ page }) => {
    await boot(page);
    await page.locator('#search-trigger').click();
    await expect(page.locator('#wp-search')).toBeFocused();
    const before = await page.evaluate(() => window.showReturn);
    await page.keyboard.press('b');
    expect(await page.evaluate(() => window.showReturn)).toBe(before);
    expect(await page.locator('#wp-search').inputValue()).toContain('b');
  });

  test('B shortcut row appears in the cheat-sheet (Editing group)', async ({ page }) => {
    await boot(page);
    await enableShowReturn(page);
    await page.evaluate(() => showShortcutsHelp());
    const keyTexts = await page.locator('.shortcuts-help-keys').allTextContents();
    expect(keyTexts.some(t => t.trim() === 'B')).toBe(true);
  });

  test('rows within each category are sorted alphabetically by key', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showShortcutsHelp());
    // Walk the <dl>: each .shortcuts-help-group resets a fresh run of
    // .shortcuts-help-keys rows that must be in alphabetical key order.
    const groups = await page.evaluate(() => {
      const out = [];
      let cur = null;
      for (const el of document.querySelectorAll(
          '.shortcuts-help-list > .shortcuts-help-group, .shortcuts-help-list > .shortcuts-help-keys')) {
        if (el.classList.contains('shortcuts-help-group')) {
          cur = [];
          out.push(cur);
        } else if (cur) {
          // First key token of the row (the primary combo's leading key).
          cur.push(el.textContent.trim());
        }
      }
      return out;
    });
    expect(groups.length).toBeGreaterThan(1);
    for (const keys of groups) {
      const sorted = [...keys].sort((a, b) => a.localeCompare(b));
      expect(keys).toEqual(sorted);
    }
  });

  test('+ does not zoom the map while shortcuts modal is open', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      map.setView([32.55, 35.20], 10, { animate: false });
      showShortcutsHelp();
    });
    const z0 = await page.evaluate(() => map.getZoom());
    await page.keyboard.press('Equal');
    expect(await page.evaluate(() => map.getZoom())).toBe(z0);
  });
});
