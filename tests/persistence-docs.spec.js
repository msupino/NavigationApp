// @ts-check
// Guard the authoritative .ai persistence list against drift when new
// navaid.* keys are introduced.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

test('developer guide documents persisted navaid.* keys used by app code', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '.ai', 'navaid-dev.md'), 'utf8');
  const required = [
    'navaid.route',
    'navaid.view',
    'navaid.routes',
    'navaid.inspPos',
    'navaid.tunePanelPos',
    'navaid.showCumTime',
    'navaid.showReporting',
    'navaid.showMsa',
    'navaid.showWind',
    'navaid.showSigmet',
    'navaid.showVorStations',
    'navaid.vorRef',
    'navaid.forceSnap',
    'navaid.legLineWidth3',
    'navaid.driftLineWidth2',
    'navaid.airfieldFreqOverrides',
    'navaid.vorFreqOverrides',
    'navaid.profileVS',
    'navaid.pageSize',
    'navaid.simUrl',
    'navaid.simOn',
    'navaid.simFollow',
    'navaid.openChartModal',
  ];
  for (const key of required) {
    expect(doc, `${key} missing from .ai/navaid-dev.md`).toContain(key);
  }
});
