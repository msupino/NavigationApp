const { test, expect } = require('./_setup');

// Hebrew terminology the app settled on, pinned so it does not drift back. Each rule names the
// English it translates; the review that set them compared every Hebrew string with its English.
//   waypoint            ציון דרך          (not נקודת ציון -- that is a coordinate -- nor נקודת מסלול/דרך)
//   leg                 קטע               (not רגל in the sense of a leg / מקטע)
//   variation           נטייה             (סטייה is deviation: the compass card)
//   gallon              גלון / גל׳        (not גאל)
//   recording (track)   הקלטה             (not רצועה)
const RULES = [
  { bad: /נקודת ציון|נקודות ציון|נקודת מסלול|נקודות מסלול|נקודות דרך/, why: 'waypoint is ציון דרך',
    allow: ['coordPointTitle'] },                       // "Coordinate": there נקודת ציון is right
  // Not bare רגל: that is also feet, the unit.
  { bad: /הרגליים|ברגל הראשונה|הרגל הראשונה|(^|[^א-ת])מקטע/, why: 'leg is קטע', allow: [] },
  { bad: /גאל/, why: 'gallon is גלון', allow: [] },
  { bad: /רצוע/, why: 'a recorded track is הקלטה', allow: [] },
  { bad: /View\/Set|תצוגה\/הגדרה/, why: 'View/Set no longer exists (Settings)', allow: [] },
];

test('Hebrew strings keep the settled terms', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => window.S && S.tbAddWp);
  const all = await page.evaluate(() => Object.entries(S).map(([k, v]) =>
    [k, typeof v === 'function' ? v.toString() : (typeof v === 'string' ? v : (Array.isArray(v) ? v.join(' | ') : ''))]));
  const hits = [];
  for (const [k, v] of all) {
    for (const r of RULES) {
      if (r.allow.includes(k)) continue;
      // Code inside function bodies (comments) is not shown; check only quoted text.
      const shown = (v.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) || [v]).join(' ');
      const text = typeof v === 'string' && !/^\s*(function|\()/.test(v) ? v : shown;
      if (r.bad.test(text)) hits.push(k + ': ' + r.why);
    }
  }
  expect(hits).toEqual([]);
});

test('the compass reads variation the way the nav log does', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => window.S && S.compassVar);
  const s = await page.evaluate(() => ({ v: S.compassVar, nl: S.navLogVariation, card: S.navLogCard }));
  expect(s.v).toBe('נטייה');
  expect(s.nl).toContain('נטייה');
  expect(s.card).toContain('סטיות');          // deviation keeps its own word
});
