// @ts-check
const { test, expect } = require('./_setup');
const { LLHZ, LLHA } = require('./_airfieldArp');

// Minimal 1-leg route — enough to open the flight-plan modal.
const ROUTE = {
  waypoints: [
    { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
    { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
  ],
};

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      for (const s of ['build','view','display','charts','export','print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof showFlightPlan !== 'undefined');
  await page.evaluate(route => {
    state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
  }, ROUTE);
}

async function openFlightPlan(page) {
  await page.locator('#plan').click();
  const modal = page.locator('.modal-back.flight-plan .modal.wide');
  await expect(modal).toBeVisible();
  return modal;
}

async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test.describe('Flight-plan modal table print', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test('plan window has no resize grips or size persistence', async ({ page }) => {
    const modal = await openFlightPlan(page);
    await expect(modal.locator('.resize-handle')).toHaveCount(0);

    await page.mouse.move(20, 20);
    await page.mouse.down();
    await page.mouse.move(180, 160, { steps: 4 });
    await page.mouse.up();

    const stored = await page.evaluate(() => localStorage.getItem('navaid.fpSize'));
    expect(stored).toBeNull();
  });

  test('legacy persisted flight-plan size is ignored', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('navaid.fpSize', JSON.stringify({ w: 760, h: 540 }));
    });
    const modal = await openFlightPlan(page);
    const inlineSize = await modal.evaluate(el => ({
      width: el.style.width,
      height: el.style.height,
      maxWidth: el.style.maxWidth,
      maxHeight: el.style.maxHeight,
    }));
    expect(inlineSize).toEqual({ width: '', height: '', maxWidth: '', maxHeight: '' });
  });

  test('print mode is a white table document without modal controls', async ({ page }) => {
    await openFlightPlan(page);
    await page.emulateMedia({ media: 'print' });
    const printState = await page.evaluate(() => {
      document.body.classList.add('printing-plan');
      const styleOf = selector => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el) : null;
      };
      const modal = styleOf('.modal-back.flight-plan .modal.wide');
      const table = document.querySelector('.flight-table');
      const th = styleOf('.flight-table th');
      const td = styleOf('.flight-table td');
      return {
        tableTag: table && table.tagName,
        modalPosition: modal && modal.position,
        modalBackground: modal && modal.backgroundColor,
        modalBoxShadow: modal && modal.boxShadow,
        mapDisplay: styleOf('#map').display,
        toolbarDisplay: styleOf('#toolbar').display,
        buttonsDisplay: styleOf('.modal-btns').display,
        closeDisplay: styleOf('.modal-close-x').display,
        aircraftDisplay: styleOf('.fp-aircraft').display,
        deleteDisplay: styleOf('.fp-del').display,
        thBorder: th && th.borderTopStyle,
        tdBorder: td && td.borderTopStyle,
        thBackground: th && th.backgroundColor,
      };
    });

    expect(printState.tableTag).toBe('TABLE');
    expect(printState.modalPosition).toBe('static');
    expect(printState.modalBackground).toBe('rgb(255, 255, 255)');
    expect(printState.modalBoxShadow).toBe('none');
    expect(printState.mapDisplay).toBe('none');
    expect(printState.toolbarDisplay).toBe('none');
    expect(printState.buttonsDisplay).toBe('none');
    expect(printState.closeDisplay).toBe('none');
    expect(printState.aircraftDisplay).toBe('none');
    expect(printState.deleteDisplay).toBe('none');
    expect(printState.thBorder).toBe('solid');
    expect(printState.tdBorder).toBe('solid');
    expect(printState.thBackground).toBe('rgb(255, 255, 255)');
  });

  test('print mode fits VOR-enabled forward and return tables into the page width', async ({ page }) => {
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.evaluate(async route => {
      if (typeof loadVors === 'function') await loadVors();
      window.vorRef = 'NAT';
      window.showReturn = true;
      state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
      syncLegs();
      draw();
    }, {
      waypoints: [
        { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
        { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
        { lat: 32.12, lng: 34.86, name: 'LONGWP001' },
        { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
      ],
    });
    await openFlightPlan(page);
    await page.emulateMedia({ media: 'print' });

    const fit = await page.evaluate(() => {
      document.body.classList.add('printing-plan');
      const pageWidth = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll('.flight-table')).map(table => {
        const rect = table.getBoundingClientRect();
        return {
          layout: getComputedStyle(table).tableLayout,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          scrollWidth: table.scrollWidth,
          pageWidth,
        };
      });
    });

    expect(fit).toHaveLength(2);
    for (const table of fit) {
      expect(table.layout).toBe('fixed');
      expect(table.left).toBeGreaterThanOrEqual(0);
      expect(table.right).toBeLessThanOrEqual(table.pageWidth + 1);
      expect(table.scrollWidth).toBeLessThanOrEqual(table.width + 1);
    }
  });

  test('CSV button downloads the current flight-plan tables', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    const modal = await openFlightPlan(page);
    const buttons = await modal.locator('.modal-btns button').evaluateAll(btns =>
      btns.map(btn => btn.textContent.trim()));
    expect(buttons).toEqual(['Print', 'CSV', 'Nav log (PDF)', '✈ Submit flight plan']);

    const downloadPromise = page.waitForEvent('download');
    await modal.locator('.modal-btns button', { hasText: 'CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^flight-plan-.+\.csv$/);
    const csv = await downloadText(download);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Flight plan\r\n#,From,To,Hdg,Dist (NM),Speed (kt),Alt (ft),Time,Fuel (gal),Cum. time,Cum. fuel');
    expect(csv).toContain('1,LLHZ,LLHA,');
    expect(csv).toContain('\r\nTotal,,,,');
    expect(csv).toContain('\r\nReturn route\r\n#,From,To,Hdg,Dist (NM),Speed (kt),Alt (ft),Time,Fuel (gal),Cum. time,Cum. fuel');
    expect(csv).toContain('1,LLHA,LLHZ,');
    expect(csv).not.toContain('<table');
    expect(csv).not.toContain('✕');
  });

  test('Hebrew CSV download includes UTF-8 BOM and readable Hebrew headers', async ({ page }) => {
    await boot(page, 'he');
    const modal = await openFlightPlan(page);

    const downloadPromise = page.waitForEvent('download');
    await modal.locator('.modal-btns button', { hasText: 'CSV' }).click();
    const download = await downloadPromise;
    const csv = await downloadText(download);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('תכנית טיסה');
    expect(csv).toContain('כיוון');
    expect(csv).toContain('מרחק (מ״י)');     // distance ships visible now
    expect(csv).not.toContain('◊');
    expect(csv).not.toContain('¬∞');
  });
});
