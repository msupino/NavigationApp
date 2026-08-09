// @ts-check
// Coverage for the A / N / C global keyboard shortcuts wired into the
// interact.js keydown handler:
//   A — toggle add-waypoint mode (state.mode 'add' <-> null)
//   N — toggle add-note mode (state.mode 'note' <-> null)
//   C — clear the map (reuses the Clear button's confirm + reset)
// Guards: suppressed while typing in an input/textarea, and (for A/N/C)
// while a modal backdrop is open.
const { test, expect } = require('./_setup');
const { stubGraph } = require('./_layerData');

async function boot(page, lang = 'en') {
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof map !== 'undefined' &&
    typeof setMode === 'function');
}

async function pressPhysical(page, code, key, modifiers = {}) {
  await page.evaluate(({ code, key, modifiers }) => {
    const target = document.activeElement && document.activeElement !== document.documentElement
      ? document.activeElement
      : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
      cancelable: true,
      ctrlKey: !!modifiers.ctrlKey,
      metaKey: !!modifiers.metaKey,
      altKey: !!modifiers.altKey,
      shiftKey: !!modifiers.shiftKey,
    }));
  }, { code, key, modifiers });
}

test.describe('A / N / C keyboard shortcuts', () => {
  test('A toggles add-waypoint mode on and off', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => state.mode)).toBeNull();
    await page.keyboard.press('a');
    expect(await page.evaluate(() => state.mode)).toBe('add');
    await page.keyboard.press('a');
    expect(await page.evaluate(() => state.mode)).toBeNull();
  });

  test('N toggles add-note mode on and off', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('n');
    expect(await page.evaluate(() => state.mode)).toBe('note');
    await page.keyboard.press('n');
    expect(await page.evaluate(() => state.mode)).toBeNull();
  });

  test('A then N switches modes (exclusive)', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('a');
    expect(await page.evaluate(() => state.mode)).toBe('add');
    await page.keyboard.press('n');
    expect(await page.evaluate(() => state.mode)).toBe('note');
  });

  test('Escape exits add-waypoint mode when no inspector or modal is open', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('a');
    expect(await page.evaluate(() => ({
      mode: state.mode,
      selected: state.selected,
      inspectorHidden: document.getElementById('inspector').classList.contains('hidden'),
    }))).toEqual({ mode: 'add', selected: null, inspectorHidden: true });

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => state.mode)).toBeNull();
    await expect(page.locator('#tool-add')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Escape exits add-note mode when no inspector or modal is open', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('n');
    expect(await page.evaluate(() => ({
      mode: state.mode,
      selected: state.selected,
      inspectorHidden: document.getElementById('inspector').classList.contains('hidden'),
    }))).toEqual({ mode: 'note', selected: null, inspectorHidden: true });

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => state.mode)).toBeNull();
    await expect(page.locator('#tool-note')).toHaveAttribute('aria-pressed', 'false');
  });

  test('C clears all waypoints and notes', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.2, lng: 35.0, name: 'B' },
      ];
      state.notes = [{ lat: 32.1, lng: 34.95, text: 'X', color: '#fff6aa', shape: 'rect' }];
      syncLegs(); draw();
    });
    page.once('dialog', d => d.accept());      // clearConfirm
    await page.keyboard.press('c');
    const counts = await page.evaluate(() => ({
      wp: state.waypoints.length, legs: state.legs.length, notes: state.notes.length,
    }));
    expect(counts).toEqual({ wp: 0, legs: 0, notes: 0 });
  });

  test('D deletes the selected waypoint', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.2, lng: 35.0, name: 'B' },
      ];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    });
    await page.keyboard.press('d');
    const out = await page.evaluate(() => ({
      wp: state.waypoints.length, sel: state.selected,
    }));
    expect(out.wp).toBe(1);
    expect(out.sel).toBeNull();
  });

  test('D deletes the selected note', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.notes = [{ lat: 32.1, lng: 34.95, text: 'X', color: '#fff6aa', shape: 'rect' }];
      state.selected = { type: 'note', index: 0 };
      showInspector(); draw();
    });
    await page.keyboard.press('d');
    expect(await page.evaluate(() => state.notes.length)).toBe(0);
  });

  test('D with nothing selected is a no-op', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }];
      syncLegs(); state.selected = null; draw();
    });
    await page.keyboard.press('d');
    expect(await page.evaluate(() => state.waypoints.length)).toBe(1);
  });

  test('shortcut keys are ignored while typing in an input', async ({ page }) => {
    await boot(page);
    // Open the search overlay (Ctrl-F) so its input is visible + focused,
    // then type "a" — the keydown guard must NOT enter add mode.
    await page.keyboard.press('Control+f');
    await expect(page.locator('#wp-search')).toBeFocused();
    await page.keyboard.press('a');
    expect(await page.evaluate(() => state.mode)).toBeNull();
  });

  test('shortcut label hints render on the toolbar buttons', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#tool-add')).toHaveText(/\(A\)/);
    await expect(page.locator('#tool-note')).toHaveText(/\(N\)/);
    await expect(page.locator('#clear')).toHaveText(/\(C\)/);
  });

  test('English A / N / C shortcuts work while the keyboard layout is Hebrew', async ({ page }) => {
    await boot(page, 'he');
    expect(await page.evaluate(() => state.mode)).toBeNull();

    await pressPhysical(page, 'KeyA', 'ש');
    expect(await page.evaluate(() => state.mode)).toBe('add');
    await pressPhysical(page, 'KeyN', 'מ');
    expect(await page.evaluate(() => state.mode)).toBe('note');

    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.2, lng: 35.0, name: 'B' },
      ];
      state.notes = [{ lat: 32.1, lng: 34.95, text: 'X', color: '#fff6aa', shape: 'rect' }];
      syncLegs(); draw();
    });
    page.once('dialog', d => d.accept());      // clearConfirm
    await pressPhysical(page, 'KeyC', 'ב');
    const counts = await page.evaluate(() => ({
      wp: state.waypoints.length, legs: state.legs.length, notes: state.notes.length,
    }));
    expect(counts).toEqual({ wp: 0, legs: 0, notes: 0 });
  });

  test('English app shortcuts work while the keyboard layout is Hebrew', async ({ page }) => {
    await boot(page, 'he');
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.2, lng: 35.0, name: 'B' },
      ];
      syncLegs();
      window.__fitCount = 0;
      window.__undoCount = 0;
      window.fitView = () => { window.__fitCount += 1; };
      window.undo = () => { window.__undoCount += 1; };
    });

    await pressPhysical(page, 'KeyF', 'כ');
    await pressPhysical(page, 'KeyR', 'ר');
    await pressPhysical(page, 'KeyB', 'נ');
    await pressPhysical(page, 'KeyZ', 'ז', { ctrlKey: true });

    expect(await page.evaluate(() => ({
      fitCount: window.__fitCount,
      undoCount: window.__undoCount,
      names: state.waypoints.map(w => w.name),
      showReturn,
      retChecked: document.getElementById('ret-cb').checked,
    }))).toEqual({
      fitCount: 1,
      undoCount: 1,
      names: ['B', 'A'],
      showReturn: true,
      retChecked: true,
    });

    await pressPhysical(page, 'KeyF', 'כ', { ctrlKey: true });
    await expect(page.locator('#wp-search')).toBeFocused();
    await pressPhysical(page, 'KeyA', 'ש');
    expect(await page.evaluate(() => state.mode)).toBeNull();
  });
});

const TYONA = { lat: 32.00472, lng: 34.72722, name: 'TYONA' };
const CC_FIXTURE = {
  version: 1, source: 'test fixture',
  callSigns: {
    PLUTO: { label: 'Pluto', he: 'פלוטו', primary: '118.40', secondary: '119.25' },
  },
  points: [{ name: 'TYONA', commChange: true, callSigns: ['PLUTO'], to: 'Pluto 118.40' }],
};

async function bootWithCC(page) {
  await stubGraph(page, { commChange: CC_FIXTURE.points, callSigns: CC_FIXTURE.callSigns });
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof map !== 'undefined' && typeof setMode === 'function');
  await page.evaluate(() => {
    loadNavWaypoints();
    loadAirfields();
    loadCommChange();
  });
  await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.TYONA);
  await page.evaluate(() => { window.showCommChange = true; });
}

test.describe('X / Z / Delete freq-change keyboard shortcuts', () => {
  test('X deletes the freq-change callout from the selected waypoint (keeps waypoint)', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    }, TYONA);
    await page.keyboard.press('x');
    const out = await page.evaluate(() => ({
      wp: state.waypoints.map(w => w.name),
      notes: state.notes.filter(n => n && n.cc).length,
      selected: state.selected,
    }));
    expect(out.wp).toEqual(['TYONA']);
    expect(out.notes).toBe(0);
    expect(out.selected).toEqual({ type: 'wp', index: 0 });
  });

  test('X with no freq-callout is a no-op', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      state.notes = [];
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    }, TYONA);
    await page.keyboard.press('x');
    const out = await page.evaluate(() => ({
      wp: state.waypoints.length, selected: state.selected,
    }));
    expect(out.wp).toBe(1);
    expect(out.selected).toEqual({ type: 'wp', index: 0 });
  });

  test('Z adds a freq-change callout to a selected comm-change waypoint', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    }, TYONA);
    await page.keyboard.press('z');
    const out = await page.evaluate(() => ({
      notes: state.notes.filter(n => n && n.cc).length,
      cc: state.notes[0]?.cc,
      freqName: state.notes[0]?.freqName,
      selected: state.selected,
    }));
    expect(out.notes).toBe(1);
    expect(out.cc).toBe('TYONA');
    expect(out.freqName).toBe('PLUTO');
    expect(out.selected).toEqual({ type: 'wp', index: 0, freqNoteIndex: 0 });
  });

  test('Z adds a manual freq-change callout to a waypoint with no comm-change data', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat + 0.5, lng: t.lng + 0.5, name: 'NOPEX' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    }, TYONA);
    await page.keyboard.press('z');
    const out = await page.evaluate(() => ({
      notes: state.notes.filter(n => n && n.cc).length,
      cc: state.notes[0]?.cc,
      freqName: state.notes[0]?.freqName,
      freq: state.notes[0]?.freq,
      selected: state.selected,
    }));
    expect(out).toEqual({
      notes: 1,
      cc: 'NOPEX',
      freqName: 'NOPEX',
      freq: '',
      selected: { type: 'wp', index: 0, freqNoteIndex: 0 },
    });
  });

  test('Z on a waypoint that already has a freq callout is a no-op', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'wp', index: 0, freqNoteIndex: 0 };
      showInspector(); draw();
    }, TYONA);
    await page.keyboard.press('z');
    expect(await page.evaluate(() => state.notes.filter(n => n && n.cc).length)).toBe(1);
  });

  test('Delete/Backspace deletes the freq callout first when a waypoint has one', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    }, TYONA);
    await page.keyboard.press('Delete');
    const out = await page.evaluate(() => ({
      wp: state.waypoints.map(w => w.name),
      notes: state.notes.filter(n => n && n.cc).length,
      selected: state.selected,
    }));
    expect(out.wp).toEqual(['TYONA']);
    expect(out.notes).toBe(0);
    expect(out.selected).toEqual({ type: 'wp', index: 0 });
  });

  test('Delete/Backspace deletes the waypoint when no freq callout exists', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    }, TYONA);
    await page.keyboard.press('Delete');
    expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
  });

  test('Delete/Backspace deletes a plain note', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(() => {
      state.notes = [{ lat: 32.1, lng: 34.9, text: 'Plain', color: '#fff6aa', shape: 'rect' }];
      state.selected = { type: 'note', index: 0 };
      showInspector(); draw();
    });
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => state.notes.length)).toBe(0);
  });

  test('D on a waypoint with a freq callout deletes both', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    }, TYONA);
    await page.keyboard.press('d');
    const out = await page.evaluate(() => ({
      wp: state.waypoints.length,
      notes: state.notes.filter(n => n && n.cc).length,
      selected: state.selected,
    }));
    expect(out.wp).toBe(0);
    expect(out.notes).toBe(0);
    expect(out.selected).toBeNull();
  });

  test('English X / Z / D shortcuts work while the keyboard layout is Hebrew', async ({ page }) => {
    await bootWithCC(page);
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    }, TYONA);

    await pressPhysical(page, 'KeyZ', 'ז');
    expect(await page.evaluate(() => ({
      notes: state.notes.filter(n => n && n.cc).length,
      selected: state.selected,
    }))).toEqual({ notes: 1, selected: { type: 'wp', index: 0, freqNoteIndex: 0 } });

    await pressPhysical(page, 'KeyX', 'ס');
    expect(await page.evaluate(() => ({
      wp: state.waypoints.length,
      notes: state.notes.filter(n => n && n.cc).length,
      selected: state.selected,
    }))).toEqual({ wp: 1, notes: 0, selected: { type: 'wp', index: 0 } });

    await pressPhysical(page, 'KeyD', 'ג');
    expect(await page.evaluate(() => ({
      wp: state.waypoints.length,
      notes: state.notes.filter(n => n && n.cc).length,
      selected: state.selected,
    }))).toEqual({ wp: 0, notes: 0, selected: null });
  });
});
