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
    varC: S.compassVar, varHint: S.tbSecSettingsHint, card: S.navLogCard,
  }));
  expect(s.overwrite).toContain('להחליף');          // was "לשמור על" -- to keep, the opposite of overwrite
  expect(s.flown).toContain('את הקטע הזה כבר טסים');   // the leg is flown (by you); it does not fly
  expect(s.cas).toContain('מכוילת');               // CAS is calibrated airspeed
  expect(s.exp).toContain('FDR');
  expect(s.imp).toBe('ייבא מסלול מקובץ JSON או GPX');
  expect(s.blocked).toContain('בהגדרות');          // the switch lives in Settings
  expect(s.live).not.toContain('ללא הקלטה');       // Location records too now
  // Variation is נטייה; deviation is סטייה (the compass card) -- the compass said סטייה for VAR.
  expect(s.varC).toBe('נטייה');
  expect(s.varHint).toContain('נטייה');
  expect(s.card).toContain('סטיות');
});
