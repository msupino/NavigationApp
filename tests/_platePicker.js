// Drive the compact, user-facing airfield-plate picker while allowing each overlay suite
// to keep asserting its established per-type state and layer implementation.
async function setAirfieldPlate(page, checkboxId, enabled = true) {
  const toggle = page.locator('#plate-enabled-cb');
  if (enabled) {
    if (!(await toggle.isChecked())) await toggle.check();
    await page.locator('#plate-type').selectOption(checkboxId);
  } else if (await toggle.isChecked()) {
    await toggle.uncheck();
  }
}

module.exports = { setAirfieldPlate };
