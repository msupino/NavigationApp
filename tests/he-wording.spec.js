const { test, expect } = require('./_setup');

// Hebrew strings that said something other than the English (reviewed string by string).
test('Hebrew says what the English says', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => window.S && S.tbImport);
  const s = await page.evaluate(() => ({
    overwrite: S.routeLibrarySaveConfirm('A'),
    flown: S.trackFlownTwiceToast,
    cas: S.tbNavTableTitle,
    exp: S.tbExportTitle,
    imp: S.tbImportTitle,
    blocked: S.inspectorTrackingBlocked,
    live: S.tbGpsLiveTitle,
  }));
  expect(s.overwrite).toContain('להחליף');          // was "לשמור על" -- to keep, the opposite of overwrite
  expect(s.flown).toContain('נטוס');               // the leg is flown; it does not fly
  expect(s.cas).toContain('מכוילת');               // CAS is calibrated airspeed
  expect(s.exp).toContain('FDR');
  expect(s.imp).toBe('ייבא מסלול מקובץ JSON או GPX');
  expect(s.blocked).toContain('בהגדרות');          // the switch lives in Settings
  expect(s.live).not.toContain('ללא הקלטה');       // Location records too now
});
