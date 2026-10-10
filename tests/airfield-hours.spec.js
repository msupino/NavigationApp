// @ts-check
// Published operating hours in the airfield panel (airfield-hours.js, data/airfield-hours.json).
// The verdict says "within / outside published hours" only when the AIP's rules decide it;
// twilight either side of a daytime-only field, a day the AIP's "holiday" may or may not mean,
// and the evening after Yom Kippur get no verdict at all.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const HOURS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'airfield-hours.json'), 'utf8'));
const AIRFIELDS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'airfields.json'), 'utf8')).airfields;

async function boot(page, lang, when) {
  if (when) await page.clock.setFixedTime(new Date(when));
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.airfieldHours) && !!window.airfields);
  await page.evaluate(() => NavAid.airfieldHours.load());
}

async function open(page, icao) {
  await page.evaluate((name) => {
    const i = airfields.findIndex(a => String(a.name || '').toUpperCase() === name);
    state.selected = { type: 'airfield', index: i };
    showInspector();
  }, icao);
  await page.waitForFunction(() => {
    const s = document.querySelector('#insp-body .hours-section');
    return s && s.querySelector('.hours-line');
  });
}

const readHours = (page) => page.evaluate(() => {
  const s = document.querySelector('#insp-body .hours-section');
  const pill = s.querySelector('.hours-now');
  return {
    title: s.querySelector('.insp-section-badge').textContent,
    lines: [...s.querySelectorAll('.hours-line')].map(n => n.textContent),
    src: (s.querySelector('.hours-src') || {}).textContent || '',
    pill: pill.hidden ? null : pill.textContent,
    open: pill.classList.contains('is-open'),
    closed: pill.classList.contains('is-closed'),
  };
});

const status = (page, icao, iso) => page.evaluate(([k, t]) => {
  const look = n => airfields.find(a => a.name === n);
  const r = NavAid.airfieldHours.status(k, look(k), new Date(t), look);
  return r.state + (r.until ? ' until ' + r.until : '') + (r.opens ? ' opens ' + r.opens : '') + ' ' + r.reason;
}, [icao, iso]);

test('every field with hours is a real airfield, in both languages', async () => {
  const names = new Set(AIRFIELDS.map(a => a.name));
  for (const [icao, e] of Object.entries(HOURS.fields)) {
    expect(names.has(icao), icao + ' in airfields.json').toBe(true);
    expect(e.he.length, icao + ' he/en line count').toBe(e.en.length);
    expect(e.source && e.source.title && e.source.amdt && e.source.date, icao + ' source').toBeTruthy();
    expect(Array.isArray(e.schedule) && e.schedule.length, icao + ' schedule').toBeTruthy();
  }
});

test('every schedule decides every hour of a year without failing', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate((keys) => {
    const look = n => airfields.find(a => a.name === n);
    const start = Date.UTC(2026, 8, 1);
    const tally = {};
    for (const k of keys) {
      tally[k] = { open: 0, closed: 0, none: 0, errors: 0 };
      for (let h = 0; h < 365 * 24; h += 5) {
        try {
          const r = NavAid.airfieldHours.status(k, look(k), new Date(start + h * 3600e3), look);
          if (r.state === 'open') tally[k].open++;
          else if (r.state === 'closed') tally[k].closed++;
          else tally[k].none++;
        } catch (e) { tally[k].errors++; }
      }
    }
    return tally;
  }, Object.keys(HOURS.fields));
  for (const [k, t] of Object.entries(result)) {
    expect(t.errors, k + ' errors').toBe(0);
    expect(t.open, k + ' is within its hours some of the time').toBeGreaterThan(0);
    // An unknown verdict is the exception, never the rule.
    expect(t.none, k + ' undecided hours').toBeLessThan((t.open + t.closed) * 0.1);
  }
});

test('Herzliya: clock windows, twilight, the eve and the day of Yom Kippur', async ({ page }) => {
  await boot(page);
  // Monday 12 Oct 2026 (summer time). Twilight end at Ben Gurion is about 18:38.
  expect(await status(page, 'LLHZ', '2026-10-12T05:30:00+03:00')).toBe('closed opens 07:00 window');
  expect(await status(page, 'LLHZ', '2026-10-12T10:00:00+03:00')).toBe('open until 14:00 window');
  expect(await status(page, 'LLHZ', '2026-10-12T15:00:00+03:00')).toBe('closed opens 16:00 window');
  expect(await status(page, 'LLHZ', '2026-10-12T18:10:00+03:00')).toMatch(/^open until 18:2\d window$/);
  expect(await status(page, 'LLHZ', '2026-10-12T18:45:00+03:00')).toBe('closed window');
  // A June evening: 19:30 comes before twilight, so 19:30 governs.
  expect(await status(page, 'LLHZ', '2026-06-22T19:00:00+03:00')).toBe('open until 19:30 window');
  // Erev Yom Kippur (Sun 20 Sep 2026): closes 13:00. Yom Kippur: closed; after it, no verdict.
  expect(await status(page, 'LLHZ', '2026-09-20T12:00:00+03:00')).toBe('open until 13:00 window');
  expect(await status(page, 'LLHZ', '2026-09-20T13:30:00+03:00')).toBe('closed window');
  expect(await status(page, 'LLHZ', '2026-09-21T10:00:00+03:00')).toBe('closed closedDay');
  expect(await status(page, 'LLHZ', '2026-09-21T20:00:00+03:00')).toBe('null reopens');
  // 4 Iyar 5787 (Tue 11 May 2027): Yom HaZikaron / the eve of Yom HaAtzmaut. Not guessed.
  expect(await status(page, 'LLHZ', '2027-05-11T10:00:00+03:00')).toBe('null calendar');
});

test('other rule shapes: weekdays, summer time, closures, daytime only', async ({ page }) => {
  await boot(page);
  // Haifa on a Wednesday at 21:00 is open only to commercial flights of 30+ seats.
  expect(await status(page, 'LLHA', '2026-10-14T21:00:00+03:00')).toBe('closed window');
  expect(await status(page, 'LLHA', '2026-10-15T21:00:00+03:00')).toBe('open until 22:00 window');
  // Rosh Pina on Saturday: 09:00-19:00 in summer time, 09:00-18:00 in winter.
  expect(await status(page, 'LLIB', '2026-07-04T18:30:00+03:00')).toBe('open until 19:00 window');
  expect(await status(page, 'LLIB', '2026-12-05T18:30:00+02:00')).toBe('closed window');
  // Rishon closes Mon and Wed 14:00-15:00.
  expect(await status(page, 'LLRS', '2026-10-14T14:30:00+03:00')).toBe('closed opens 15:00 window');
  // Ktziot: Sun-Thu only.
  expect(await status(page, 'LLKZ', '2026-10-16T10:00:00+03:00')).toBe('closed closedDay');
  // Ein Yahav, daytime only: midday is within, civil twilight is undecided.
  expect(await status(page, 'LLEY', '2026-10-12T12:00:00+03:00')).toMatch(/^open until 18:\d\d window$/);
  expect(await status(page, 'LLEY', '2026-10-12T18:25:00+03:00')).toBe('null twilight');
  expect(await status(page, 'LLBG', '2026-10-16T03:00:00+03:00')).toBe('open h24');
});

test('the panel shows the AIP hours, the source and the verdict', async ({ page }) => {
  await boot(page, 'en', '2026-10-12T10:00:00+03:00');
  await open(page, 'LLHZ');
  const h = await readHours(page);
  expect(h.title).toBe('Hours');
  expect(h.lines[0]).toContain('Weekdays: 07:00-14:00');
  expect(h.src).toContain('AIP, amendment 1/26');
  expect(h.src).toContain('check NOTAMs');
  expect(h.pill).toBe('Within published hours · until 14:00');
  expect(h.open).toBe(true);
  // The AIP text starts folded: the verdict is what is read in passing.
  const fold = () => page.evaluate(() => {
    const sec = document.querySelector('#insp-body .hours-section');
    const t = sec.querySelector('.hours-toggle');
    return { hidden: sec.querySelector('.hours-text').hidden, expanded: t.getAttribute('aria-expanded'),
      visibleLines: [...sec.querySelectorAll('.hours-line')].filter(n => n.offsetParent).length };
  });
  expect(await fold(page)).toEqual({ hidden: true, expanded: 'false', visibleLines: 0 });
  await page.click('#insp-body .hours-section .hours-toggle');
  const open1 = await fold(page);
  expect(open1.hidden).toBe(false);
  expect(open1.expanded).toBe('true');
  expect(open1.visibleLines).toBeGreaterThan(3);
  await page.click('#insp-body .hours-section .insp-section-badge');
  expect((await fold(page)).hidden).toBe(true);
  // It sits before the radios.
  const order = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#insp-body .insp-frame')].map(s => s.className);
    return secs.findIndex(c => c.includes('hours-section')) < secs.findIndex(c => c.includes('comm-section'));
  });
  expect(order).toBe(true);
});

test('a prior-coordination field says so; a field with no hours says that', async ({ page }) => {
  await boot(page, 'en', '2026-10-12T10:00:00+03:00');
  await open(page, 'LLMG');
  expect((await readHours(page)).pill).toBe('Within published hours · prior coordination required');
  await open(page, 'LLEK');
  const h = await readHours(page);
  expect(h.lines).toEqual(['No hours published in the AIP']);
  expect(h.pill).toBe(null);
  // Nothing to fold: the one line shows, and there is no toggle.
  expect(await page.evaluate(() => {
    const sec = document.querySelector('#insp-body .hours-section');
    return { lineShown: !!sec.querySelector('.hours-none').offsetParent, toggle: sec.querySelector('.hours-toggle').hidden };
  })).toEqual({ lineShown: true, toggle: true });
});

test('in Hebrew: the AIP wording and a Hebrew verdict', async ({ page }) => {
  await boot(page, 'he', '2026-10-12T15:00:00+03:00');
  await open(page, 'LLHZ');
  const h = await readHours(page);
  expect(h.title).toBe('שעות פעילות');
  expect(h.lines[0]).toContain('ימי חול');
  expect(h.pill).toBe('מחוץ לשעות הפעילות המפורסמות · נפתח ב-16:00');
  expect(h.closed).toBe(true);
});
