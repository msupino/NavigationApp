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

  // `reopen` says the sheet is being asked for with NEW content -- a second press on the
  // chart is a question about a different point, not a request to resize the answer to the
  // last one. A deck button asking for the sheet it already has cycles the height instead.
  function openSheet(key, title, fill, opts) {
    if (!sheet) return;
    if (sheetKey === key && !sheet.hidden && !(opts && opts.reopen)) { cycleDetent(); return; }
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
  // section left open inside it, the inspector -- and everything that opened over the chart,
  // the flight plan and the chart viewers included. Reported twice, and the second time
  // settled it: a button labelled Map that leaves a table covering the map is a button that
  // has to be pressed and then followed by hunting for an X.
  //
  // Each overlay is closed through its own door, not by deleting the node: a modal built by
  // createDraggableModal carries a _navaidClose that also unhooks its Escape handler and its
  // listeners, and the flight plan has closeFlightPlan(), which clears fpOpen, the stored
  // session flag and the profile markers it drew on the chart. Removing the element would
  // leave every one of those behind.
  function closeOverlays() {
    if (typeof fpOpen !== 'undefined' && fpOpen && typeof closeFlightPlan === 'function') {
      closeFlightPlan();
    }
    for (const back of document.querySelectorAll('.modal-back, .sim-overlay')) {
      if (back.classList.contains('hidden')) continue;
      if (typeof back._navaidClose === 'function') { back._navaidClose(); continue; }
      const x = back.querySelector('.modal-close-x, .modal-close, .sim-modal-close');
      if (x) { x.click(); continue; }
      back.remove();
    }
  }

  function showMap() {
    closeSheet();
    closeOverlays();
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

  // ---- press and hold on the chart -----------------------------------------------------
  // The last step of the layout: the chart itself answers a question. Press and hold anywhere
  // and the sheet says what is there -- the coordinates, the nearest field with its bearing
  // and distance, the highest terrain in that square -- and offers the two things a pilot
  // does with a point on a chart: fly to it, or add it to the plan.
  //
  // This is how SkyDemon replaces most of its menus, and it is the one part of the deck that
  // changes how a route is BUILT rather than where a button sits, so it lives here behind the
  // same switch and does nothing a tap already does.
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_SLOP = 10;

  function hereRow(body, label, value) {
    const row = document.createElement('div');
    row.className = 'deck-here-row';
    const k = document.createElement('span');
    k.textContent = label;
    const v = document.createElement('bdi');
    v.className = 'deck-here-value';
    v.textContent = value;
    row.append(k, v);
    body.appendChild(row);
    return row;
  }

  // Nearest published field, by great-circle distance -- not by pixels, which is what the
  // map's own hit-testing uses and which would answer differently at every zoom.
  function nearestField(latlng) {
    const list = Array.isArray(window.airfields) ? window.airfields : [];
    let best = null;
    for (const af of list) {
      if (!af || !Number.isFinite(af.lat) || !Number.isFinite(af.lng)) continue;
      const g = geo(latlng, af);
      if (!best || g.dist < best.dist) best = { af, dist: g.dist, brg: g.brg };
    }
    return best;
  }

  function fmtBearing(deg) {
    const mag = (typeof toMagnetic === 'function') ? toMagnetic(deg) : deg;
    const r = ((Math.round(mag) % 360) + 360) % 360;
    return (typeof pad3 === 'function' ? pad3(r) : String(r)) + '\u00b0M';
  }

  function openHere(latlng) {
    const title = (typeof S === 'object' && S && S.deckHereTitle) || 'What is here';
    openSheet('here-point', title, (body) => {
      body.classList.add('deck-here');
      hereRow(body, (typeof S === 'object' && S && S.deckHereCoords) || 'Position',
        typeof coordReadoutText === 'function'
          ? coordReadoutText(latlng.lat, latlng.lng)
          : latlng.lat.toFixed(4) + ', ' + latlng.lng.toFixed(4));
      const near = nearestField(latlng);
      if (near) {
        // The name the pilot reads on this chart, in the language they are reading it in.
        const lang = (document.documentElement.lang === 'he') ? 'he' : 'en';
        const name = near.af[lang] || near.af.en || near.af.name || '';
        hereRow(body, (typeof S === 'object' && S && S.deckHereNearest) || 'Nearest field',
          name + '  ' + near.dist.toFixed(1) + ' NM  ' + fmtBearing(near.brg));
      }
      const terrain = (typeof terrainMaxAtLatLng === 'function')
        ? terrainMaxAtLatLng(latlng.lat, latlng.lng) : null;
      if (Number.isFinite(terrain)) {
        hereRow(body, (typeof S === 'object' && S && S.deckHereTerrain) || 'Highest terrain',
          Math.round(terrain) + ' ft');
      }

      const actions = document.createElement('div');
      actions.className = 'deck-here-actions';
      // The DELIBERATE lock refuses these; the automatic in-flight one does not. That lock
      // exists to stop a finger on a phone nudging a waypoint it landed on by accident --
      // "a default, not a rule", as the lock itself puts it, because a diversion gets
      // planned in the air. Holding the chart for half a second and then pressing a button
      // is not an accident, and refusing it would leave Direct to needing a position (so:
      // in flight) and no lock (so: not in flight), which is nothing at all.
      const locked = window.editLocked === true && window.editUnlockOverride !== true;
      const live = typeof gpsOwn === 'object' && gpsOwn
        && Number.isFinite(gpsOwn.lat) && Number.isFinite(gpsOwn.lng)
        && typeof gpsPositionLive === 'function' && gpsPositionLive();

      // Dim, never hide: both are real controls, and a control that disappears is one the
      // pilot hunts for. Each says why it cannot be used.
      const direct = document.createElement('button');
      direct.type = 'button';
      direct.className = 'deck-here-btn';
      direct.textContent = (typeof S === 'object' && S && S.deckDirectTo) || 'Direct to';
      direct.disabled = !live || locked;
      direct.title = locked
        ? ((typeof S === 'object' && S && S.editLockBlockedToast) || '')
        : (!live ? ((typeof S === 'object' && S && S.deckDirectNeedsFix)
          || 'No position yet — turn Location on') : '');
      direct.addEventListener('click', () => { directTo(latlng); });

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'deck-here-btn';
      add.textContent = (typeof S === 'object' && S && S.deckAddWaypoint) || 'Add waypoint';
      add.disabled = locked;
      add.title = locked ? ((typeof S === 'object' && S && S.editLockBlockedToast) || '') : '';
      add.addEventListener('click', () => { addHere(latlng); });

      actions.append(direct, add);
      body.appendChild(actions);
    }, { reopen: true });
  }

  // A point on the chart, onto the end of the plan -- the same thing the Add tool does with a
  // tap, including the nav-point snap, so a held point and a tapped one produce the same
  // waypoint.
  function addHere(latlng) {
    if (typeof state !== 'object' || !state) return;
    const snapped = (typeof applyNavSnap === 'function') ? applyNavSnap(latlng, '') : latlng;
    const next = { lat: (typeof r5 === 'function' ? r5(snapped.lat) : snapped.lat),
                   lng: (typeof r5 === 'function' ? r5(snapped.lng) : snapped.lng),
                   name: snapped.name || '' };
    state.waypoints.push(next);
    // syncLegs -> the save path -> recordUndoSnapshot: a point added this way is one undo
    // step, exactly like a point added with the Add tool.
    if (typeof syncLegs === 'function') syncLegs();
    if (typeof draw === 'function') draw();
    closeSheet();
  }

  // Straight there from where the aeroplane actually is. A plan already drawn is not thrown
  // away on a tap: this replaces it, so it asks first.
  function directTo(latlng) {
    if (typeof state !== 'object' || !state || !gpsOwn) return;
    if (state.waypoints.length) {
      const ask = (typeof S === 'object' && S && S.deckDirectConfirm)
        || 'Replace the route with a direct leg to this point?';
      try { if (!confirm(ask)) return; } catch (e) { /* no confirm: go ahead */ }
    }
    const here = { lat: gpsOwn.lat, lng: gpsOwn.lng,
                   name: (typeof S === 'object' && S && S.deckHereNow) || 'NOW' };
    const snapped = (typeof applyNavSnap === 'function') ? applyNavSnap(latlng, '') : latlng;
    state.waypoints = [here, { lat: snapped.lat, lng: snapped.lng, name: snapped.name || '' }];
    if (typeof syncLegs === 'function') syncLegs();
    if (typeof draw === 'function') draw();
    closeSheet();
  }

  let longPress = null;
  function wireLongPress() {
    if (longPress || typeof map === 'undefined' || !map || !map.getContainer) return;
    const el = map.getContainer();
    let timer = 0;
    let sx = 0;
    let sy = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; };
    const down = (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      // Not on the controls that float over the chart: a press there is a press on them.
      if (ev.target && ev.target.closest && ev.target.closest('.leaflet-control, #deck-sheet')) return;
      sx = ev.clientX;
      sy = ev.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = 0;
        if (!map.containerPointToLatLng) return;
        const box = el.getBoundingClientRect();
        openHere(map.containerPointToLatLng([sx - box.left, sy - box.top]));
      }, LONG_PRESS_MS);
    };
    const moved = (ev) => {
      if (!timer) return;
      if (Math.abs(ev.clientX - sx) > LONG_PRESS_SLOP || Math.abs(ev.clientY - sy) > LONG_PRESS_SLOP) cancel();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', moved);
    for (const name of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(name, cancel);
    longPress = () => {
      cancel();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', moved);
      for (const name of ['pointerup', 'pointercancel', 'pointerleave']) el.removeEventListener(name, cancel);
      longPress = null;
    };
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
    if (longPress) longPress();
    modalWatch = null;                       // disconnected with the rest, just below
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

  // A menu item that opens something -- a chart, the route templates, the NOTAM list -- has
  // finished being a menu. The sheet stayed open over the thing it had just opened, so the
  // pilot had to put the menu away by hand to see what they asked for. Reported: the menu
  // hides charts.
  //
  // Watched rather than wired into each button: every modal in the app arrives as a
  // .modal-back on the body, and there are dozens of buttons that make one.
  let modalWatch = null;
  function watchModals() {
    if (modalWatch || typeof MutationObserver !== 'function') return;
    modalWatch = new MutationObserver((records) => {
      if (!sheet || sheet.hidden) return;
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches('.modal-back, .sim-overlay')) { closeSheet(); return; }
        }
      }
    });
    modalWatch.observe(document.body, { childList: true });
    observers.push(modalWatch);
  }

  function apply() {
    const on = wanted();
    if (on === !!deck) { if (on) sync(); return; }
    if (!on) { teardown(); return; }
    buildStrip();
    buildDeck();
    buildSheet();
    wireLongPress();
    watchModals();
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
