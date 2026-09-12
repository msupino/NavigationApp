'use strict';
// Option B, first slice: a data strip along the top of the chart and a deck of five targets
// along the bottom, on narrow screens only, behind `featureMobileDeck` (off).
//
// Why: measured at 390x844, the phone screen carried six floating islands -- the menu card,
// the Zulu clock, the look-ahead strip, the coordinate readout, the zoom column and the
// credits -- and the two actions a pilot reaches for in the air, Record and Location, sat in
// the top-left corner, the furthest point on the screen from a thumb. Every EFB worth the
// name (ForeFlight, Garmin Pilot, SkyDemon, OzRunways) answers this the same way: one data
// strip that is always readable, one deck at the bottom edge, and everything else as a sheet
// that arrives and leaves.
//
// This slice moves the furniture. It adds no new capability and removes none: each deck
// button drives a control that already exists, by clicking it, so state, persistence and
// every existing test of those controls still hold. The sheets with detents, the menu
// sections folded into Layers and Plan, and the long-press chart menu are the later steps.
(function mobileDeck() {
  const NARROW = '(max-width: 680px), (pointer: coarse)';

  // The gist owns the feature; `?deck=1` / `?deck=0` is for looking at it on a phone without
  // waiting for a config push, the same escape hatch `?tune=1` gives the tuning panel.
  function flagOn() {
    let param = null;
    try { param = new URLSearchParams(location.search).get('deck'); } catch (e) { /* no URL */ }
    if (param === '1' || param === 'true') return true;
    if (param === '0' || param === 'false') return false;
    return typeof tune === 'function' && tune('featureMobileDeck') === true;
  }
  const narrow = () => !window.matchMedia || window.matchMedia(NARROW).matches;
  const wanted = () => flagOn() && narrow();

  const txt = (id) => {
    const el = document.getElementById(id);
    return el && !el.hidden ? (el.textContent || '').trim() : '';
  };
  const click = (id) => {
    const el = document.getElementById(id);
    if (el) el.click();
  };

  // "LLHZ → LLEV", or the single point a route of one begins at. The strip names the flight
  // before it names the numbers: a readout with no idea what it belongs to is a dashboard.
  function routeTitle() {
    const wps = (typeof state === 'object' && state && Array.isArray(state.waypoints))
      ? state.waypoints : [];
    const name = (w) => (w && (w.name || w.code || '')) || '';
    if (!wps.length) return (typeof S === 'object' && S && S.deckNoRoute) || 'No route';
    if (wps.length === 1) return name(wps[0]) || '1 point';
    const from = name(wps[0]);
    const to = name(wps[wps.length - 1]);
    return (from && to) ? (from + ' → ' + to) : (from || to || wps.length + ' points');
  }

  let strip = null;
  let stripLeg = null;
  let stripVals = null;
  let stripSub = null;
  let deck = null;
  const buttons = {};
  let observers = [];

  function buildStrip() {
    strip = document.createElement('div');
    strip.id = 'deck-strip';
    strip.className = 'deck-strip';
    stripLeg = document.createElement('span');
    stripLeg.className = 'deck-strip-leg';
    stripVals = document.createElement('span');
    stripVals.className = 'deck-strip-vals';
    const top = document.createElement('div');
    top.className = 'deck-strip-top';
    top.append(stripLeg, stripVals);
    stripSub = document.createElement('div');
    stripSub.className = 'deck-strip-sub';
    strip.append(top, stripSub);
    document.body.appendChild(strip);
    // The menu opens under the strip, so it has to know how tall the strip is -- which
    // depends on the language, the font and whether the second line has anything to say.
    const measure = () => document.documentElement.style.setProperty(
      '--navaid-deck-strip-h', Math.round(strip.getBoundingClientRect().height) + 'px');
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(measure);
      ro.observe(strip);
      observers.push(ro);
    }
    measure();
  }

  // Each entry: the id of the button it drives, or a handler of its own. Nothing here
  // implements a feature -- it is five shortcuts to controls that already work.
  const ITEMS = [
    { key: 'map', icon: '🗺', string: 'deckMap', run: showMap },
    { key: 'layers', icon: '▤', string: 'deckLayers', run: showLayers },
    { key: 'plan', icon: '📋', string: 'deckPlan', run: () => click('plan') },
    { key: 'record', icon: '⏺', string: 'deckRecord', run: () => click('gps-record') },
    { key: 'here', icon: '📍', string: 'deckHere', run: () => click('gps-live') },
  ];

  // Map is "put everything away": the chart, and nothing over it.
  function showMap() {
    if (typeof window.collapseToolbarForMapTool === 'function') window.collapseToolbarForMapTool();
    if (typeof state === 'object' && state && state.selected) {
      state.selected = null;
      if (typeof showInspector === 'function') showInspector();
    }
  }

  // Layers opens the menu at the section it names. The sheet that replaces the floating card
  // is step 4; until then this is the same menu, opened for you at the right place.
  function showLayers() {
    if (typeof window.expandToolbar === 'function') window.expandToolbar();
    const sec = document.querySelector('.tb-section[data-sec="weather"]');
    if (!sec) return;
    if (!sec.classList.contains('open')) {
      const head = sec.querySelector('.tb-section-head');
      if (head) head.click();
    }
    if (typeof sec.scrollIntoView === 'function') sec.scrollIntoView({ block: 'nearest' });
  }

  function buildDeck() {
    deck = document.createElement('nav');
    deck.id = 'deck-bar';
    deck.className = 'deck-bar';
    deck.setAttribute('aria-label', (typeof S === 'object' && S && S.deckLabel) || 'Primary');
    for (const item of ITEMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'deck-btn deck-btn-' + item.key;
      btn.dataset.deck = item.key;
      const icon = document.createElement('i');
      icon.textContent = item.icon;
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'deck-btn-label';
      label.textContent = (typeof S === 'object' && S && S[item.string]) || item.key;
      btn.append(icon, label);
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => { item.run(); sync(); });
      deck.appendChild(btn);
      buttons[item.key] = btn;
    }
    document.body.appendChild(deck);
  }

  // What the strip says and which deck buttons read as engaged. Driven by the elements that
  // already carry these values rather than by a second copy of the arithmetic: the live
  // readout has just fitted itself to the width available, the Zulu clock is already ticking,
  // and the map clock already knows which hour is being shown.
  function sync() {
    if (!strip) return;
    stripLeg.textContent = routeTitle();
    stripVals.textContent = txt('gps-readout');
    // Measurements read left to right in Hebrew as well; the readout's own element says so
    // and the copy on the strip has to say it too.
    stripVals.dir = 'ltr';
    // Each piece in its own isolate. The Zulu clock is Latin, the look-ahead readout is not
    // -- in Hebrew it is "+2ש 09:00Z" -- and pouring both into one left-to-right text node
    // let the bidi algorithm reorder them into "+209:00 · שZ", which is not a time at all.
    const parts = [txt('zulu-clock'), txt('map-time-read')].filter(Boolean);
    stripSub.replaceChildren();
    parts.forEach((text, i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'deck-strip-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '·';
        stripSub.appendChild(sep);
      }
      const piece = document.createElement('bdi');
      piece.dir = 'auto';
      piece.textContent = text;
      stripSub.appendChild(piece);
    });
    stripSub.hidden = !parts.length;
    const live = typeof gpsPositionLive === 'function' && gpsPositionLive();
    strip.classList.toggle('deck-strip-live', !!live);
    if (buttons.record) {
      buttons.record.setAttribute('aria-pressed', String(!!(typeof gpsRecording !== 'undefined' && gpsRecording)));
    }
    if (buttons.here) {
      buttons.here.setAttribute('aria-pressed', String(!!(typeof gpsLiveOn !== 'undefined' && gpsLiveOn)));
    }
    if (buttons.plan) {
      const fp = document.getElementById('fp-modal') || document.querySelector('.fp-modal');
      buttons.plan.setAttribute('aria-pressed', String(!!(fp && !fp.hidden)));
    }
  }

  function watch(id) {
    const el = document.getElementById(id);
    if (!el || typeof MutationObserver !== 'function') return;
    const obs = new MutationObserver(() => sync());
    obs.observe(el, { childList: true, characterData: true, subtree: true, attributes: true,
                      attributeFilter: ['hidden'] });
    observers.push(obs);
  }

  function teardown() {
    for (const obs of observers) obs.disconnect();
    observers = [];
    if (strip) strip.remove();
    if (deck) deck.remove();
    document.documentElement.style.removeProperty('--navaid-deck-strip-h');
    strip = deck = stripLeg = stripVals = stripSub = null;
    for (const key of Object.keys(buttons)) delete buttons[key];
    document.body.classList.remove('deck-on');
  }

  function apply() {
    const on = wanted();
    if (on === !!deck) { if (on) sync(); return; }
    if (!on) { teardown(); return; }
    buildStrip();
    buildDeck();
    document.body.classList.add('deck-on');
    // The strip reads these three; nothing else needs to tell it anything.
    watch('gps-readout');
    watch('zulu-clock');
    watch('map-time-read');
    sync();
  }

  // The route title changes on every edit, and edits do not pass through any of the watched
  // elements. draw() is what every edit ends with.
  if (typeof window.draw === 'function') {
    const realDraw = window.draw;
    window.draw = function () {
      const out = realDraw.apply(this, arguments);
      if (deck) sync();
      return out;
    };
  }

  window.NavAid = window.NavAid || {};
  NavAid.refreshMobileDeck = apply;
  if (window.matchMedia) {
    const mq = window.matchMedia(NARROW);
    const onChange = () => apply();
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  // The gist arrives after boot, so the first apply() runs on the code default and the
  // config's answer lands a moment later, like every other feature switch.
  apply();
}());
