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

  // ---- the sheet -------------------------------------------------------------------
  // One surface for everything that is not the chart, dragged between three heights and
  // dismissed downward. The heights are not decoration: PEEK is a glance that leaves the
  // aeroplane and the leg ahead of it visible, HALF is the working height for a list, FULL is
  // for reading. A phone has one screen, and a panel that can only be all-or-nothing forces
  // a pilot to choose between the chart and the thing they are reading about it.
  const DETENTS = { peek: 0.34, half: 0.62, full: 0.94 };
  const DETENT_ORDER = ['peek', 'half', 'full'];
  let sheet = null;
  let sheetBody = null;
  let sheetTitle = null;
  let sheetKey = '';
  let sheetDetent = 'half';
  let restore = null;                       // how to put borrowed DOM back where it was

  const sheetSpace = () => {
    const stripH = strip ? strip.getBoundingClientRect().height : 0;
    return Math.max(160, window.innerHeight - stripH - 52);
  };
  function applyDetent(name, animate) {
    sheetDetent = DETENTS[name] ? name : 'half';
    sheet.dataset.detent = sheetDetent;
    sheet.style.transition = animate === false ? 'none' : '';
    sheet.style.height = Math.round(sheetSpace() * DETENTS[sheetDetent]) + 'px';
    sheet.style.transform = '';
  }

  function buildSheet() {
    sheet = document.createElement('section');
    sheet.id = 'deck-sheet';
    sheet.className = 'deck-sheet';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'false');    // the chart stays live behind it
    const head = document.createElement('div');
    head.className = 'deck-sheet-head';
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'deck-sheet-grip';
    grip.setAttribute('aria-label', (typeof S === 'object' && S && S.deckSheetGrip)
      || 'Drag to resize, tap to change height');
    sheetTitle = document.createElement('h2');
    sheetTitle.className = 'deck-sheet-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'deck-sheet-close';
    close.textContent = '\u2715';
    close.setAttribute('aria-label', (typeof S === 'object' && S && S.close) || 'Close');
    close.addEventListener('click', () => closeSheet());
    head.append(grip, sheetTitle, close);
    sheetBody = document.createElement('div');
    sheetBody.className = 'deck-sheet-body';
    sheet.append(head, sheetBody);
    document.body.appendChild(sheet);
    wireGrip(grip);
  }

  // Tap cycles up through the heights and back to the smallest; drag goes where the finger
  // goes and snaps to the nearest. Both, because a tap is what a gloved thumb manages on a
  // bumpy leg and a drag is what the gesture promises.
  function wireGrip(grip) {
    let startY = 0;
    let startH = 0;
    let dragged = false;
    let suppressClick = false;
    let id = null;
    const onMove = (ev) => {
      if (id === null) return;
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 6) dragged = true;
      const space = sheetSpace();
      const h = Math.min(space * DETENTS.full, Math.max(60, startH - dy));
      sheet.style.transition = 'none';
      sheet.style.height = Math.round(h) + 'px';
    };
    const onUp = () => {
      if (id === null) return;
      if (grip.releasePointerCapture && grip.hasPointerCapture && grip.hasPointerCapture(id)) {
        grip.releasePointerCapture(id);
      }
      id = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // A tap is handled as a click, so the keyboard and assistive tech get it too. A drag
      // ends with a click as well, and that one is not a tap.
      if (!dragged) return;
      suppressClick = true;
      const space = sheetSpace();
      const frac = sheet.getBoundingClientRect().height / space;
      // Dragged below half of the smallest height: that is a dismissal, not a resize.
      if (frac < DETENTS.peek * 0.6) { closeSheet(); return; }
      let best = DETENT_ORDER[0];
      for (const name of DETENT_ORDER) {
        if (Math.abs(DETENTS[name] - frac) < Math.abs(DETENTS[best] - frac)) best = name;
      }
      applyDetent(best);
    };
    grip.addEventListener('pointerdown', (ev) => {
      id = ev.pointerId;
      dragged = false;
      startY = ev.clientY;
      startH = sheet.getBoundingClientRect().height;
      grip.setPointerCapture && grip.setPointerCapture(id);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      ev.preventDefault();
    });
    grip.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      cycleDetent();
    });
    grip.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        const i = DETENT_ORDER.indexOf(sheetDetent);
        applyDetent(DETENT_ORDER[Math.min(DETENT_ORDER.length - 1, Math.max(0, i + (ev.key === 'ArrowUp' ? 1 : -1)))]);
      }
      if (ev.key === 'Escape') closeSheet();
    });
  }
  function cycleDetent() {
    const i = DETENT_ORDER.indexOf(sheetDetent);
    applyDetent(DETENT_ORDER[(i + 1) % DETENT_ORDER.length]);
  }

  function openSheet(key, title, fill) {
    if (!sheet) return;
    if (sheetKey === key && !sheet.hidden) { cycleDetent(); return; }
    closeSheet({ keepOpen: true });
    sheetKey = key;
    sheetTitle.textContent = title;
    fill(sheetBody);
    sheet.hidden = false;
    applyDetent(sheetDetent, false);
    sync();
  }

  function closeSheet(opts) {
    if (!sheet || (sheet.hidden && !restore)) return;
    // Anything borrowed goes back where it came from, before the sheet is emptied: the menu
    // is the app's only copy of those controls, and their handlers are on the elements.
    if (restore) { restore(); restore = null; }
    sheetBody.replaceChildren();
    sheetKey = '';
    if (!opts || !opts.keepOpen) sheet.hidden = true;
    sync();
  }
  NavAid.closeDeckSheet = () => closeSheet();

  // The menu, in the sheet. Not a copy of it: the toolbar element itself is moved in and put
  // back on close, so every section, handler and stored state is the one that already works.
  function hostToolbar(body) {
    const bar = document.getElementById('toolbar');
    if (!bar) return;
    const parent = bar.parentNode;
    const next = bar.nextSibling;
    const inline = bar.getAttribute('style') || '';
    bar.removeAttribute('style');              // a dragged position means nothing in a sheet
    bar.classList.remove('collapsed');
    bar.classList.add('deck-hosted');
    body.appendChild(bar);
    restore = () => {
      bar.classList.remove('deck-hosted');
      if (inline) bar.setAttribute('style', inline);
      if (next && next.parentNode === parent) parent.insertBefore(bar, next);
      else parent.appendChild(bar);
      if (typeof window.collapseToolbarForMapTool === 'function') window.collapseToolbarForMapTool();
    };
  }

  // Map is "put everything away": the chart, and nothing over it. The sheet, the menu, any
  // section left open inside it, and the inspector.
  //
  // Not the flight plan. It is the thing being flown FROM -- a pilot tapping Map with the
  // plan open wants to see where the next leg goes and then go back to the table, and a
  // button that threw the table away would be one they stopped pressing. It is a
  // non-blocking modal for exactly that reason: the chart is usable underneath it.
  function showMap() {
    closeSheet();
    if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    if (typeof window.collapseToolbarForMapTool === 'function') window.collapseToolbarForMapTool();
    if (typeof state === 'object' && state && state.selected) {
      state.selected = null;
      if (typeof showInspector === 'function') showInspector();
    }
  }

  // Layers is the menu, in the sheet, opened at the section it names.
  function showLayers() {
    openSheet('layers', (typeof S === 'object' && S && S.deckLayers) || 'Layers', (body) => {
      hostToolbar(body);
      const sec = document.querySelector('.tb-section[data-sec="weather"]');
      if (sec && !sec.classList.contains('open')) {
        const head = sec.querySelector('.tb-section-head');
        if (head) head.click();
      }
      if (sec && typeof sec.scrollIntoView === 'function') sec.scrollIntoView({ block: 'nearest' });
    });
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
    for (const key of ['layers']) {
      if (buttons[key]) buttons[key].setAttribute('aria-pressed', String(sheetKey === key));
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
    closeSheet();
    if (sheet) { sheet.remove(); sheet = sheetBody = sheetTitle = null; }
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
    buildSheet();
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
