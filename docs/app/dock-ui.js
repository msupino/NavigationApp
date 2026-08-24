// Opt-in dock shell (?dock=1) — the responsive dock-layout proposal, phases 1-4:
//   #1863 status strip (GPS cluster + readout move out of the toolbar)
//   #1864 phone bottom bar + sheet (CSS re-shell of #toolbar)
//   #1865 desktop/tablet left rail with in-flow accordions + icon collapse
//   #1864/#1865 are pure CSS on html.dock-ui; this file moves nodes the CSS
//   cannot and owns the one piece of new chrome (rail collapse button).
// Gated exactly like editor.js: presence of the URL parameter only, never
// persisted, so a plain load always gets the proven shell.
(function () {
  'use strict';
  if (!/[?&]dock=1\b/.test(location.search)) return;
  window.dockUiActive = true;
  document.documentElement.classList.add('dock-ui');
  let railCollapsedSaved = false;
  try { railCollapsedSaved = localStorage.getItem('navaid.dockRailCollapsed') === '1'; } catch (e) { /* */ }
  if (railCollapsedSaved) {
    document.documentElement.classList.add('dock-rail-collapsed');
  }

  // ── Phase 1: status strip ────────────────────────────────────────────────
  // The GPS cluster (record / live / simulator) and the readout leave the
  // toolbar footer for a fixed top strip so the bottom bar stays pure
  // navigation. Reparenting keeps every id, so gpsUpdateReadout(), the
  // record wiring and all existing queries keep working untouched.
  // Help / repo links stay in the toolbar; the Zulu clock keeps its Leaflet
  // control (its drag persistence is bound to that container).
  function buildStatusStrip() {
    let strip = document.getElementById('status-strip');
    if (strip) return strip;
    strip = document.createElement('div');
    strip.id = 'status-strip';
    const rec = document.getElementById('gps-rec-indicator');
    const group = document.querySelector('#footer-links .footer-gps-group');
    const readout = document.getElementById('gps-readout');
    if (rec) strip.appendChild(rec);
    if (group) {
      while (group.firstChild) strip.appendChild(group.firstChild);
      group.remove();
    }
    if (readout) strip.appendChild(readout);
    document.body.appendChild(strip);
    return strip;
  }
  buildStatusStrip();

  // ── Phase 3: rail collapse (desktop ≥1024px) ─────────────────────────────
  const collapseBtn = document.createElement('button');
  collapseBtn.id = 'dock-rail-collapse';
  collapseBtn.type = 'button';
  collapseBtn.setAttribute('aria-expanded',
    railCollapsedSaved ? 'false' : 'true');
  collapseBtn.title = (typeof S !== 'undefined' && S.dockRailTitle) || 'Collapse or expand the toolbar rail';
  collapseBtn.setAttribute('aria-label', collapseBtn.title);
  collapseBtn.addEventListener('click', () => {
    const collapsed = document.documentElement.classList.toggle('dock-rail-collapsed');
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem('navaid.dockRailCollapsed', collapsed ? '1' : '0'); } catch (e) { /* */ }
    if (typeof window.reclampToolbarSections === 'function') window.reclampToolbarSections();
  });
  document.getElementById('toolbar').appendChild(collapseBtn);
})();
