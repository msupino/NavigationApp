'use strict';

// The map tour: a first-launch walk round the controls, one at a time. Everything but the
// control in hand is dimmed, a bubble says what it does, and a blue arrow points from the bubble
// to it. Next / Back / Skip, a step counter, Escape and the arrow keys. It plays once (the gist
// can withdraw it with `featureTour`) and Settings → "Show the tour" plays it again.
//
// It points at the live buttons rather than showing a recording: a step whose control is not on
// screen (a phone has no search card, a desktop no long press) is simply left out, and a button
// that moves next month is still pointed at where it is.
(function () {
  const SEEN_KEY = 'navaid.tourSeen';
  // Each step: the first VISIBLE match of `sel` is the target; `only` limits it to a layout.
  const STEPS = [
    // Build the route first, then check it. Route check heads the edit column on screen, but as
    // the tour's opening step it explained checking a route nobody had drawn yet (reported).
    // The edit buttons only: Route check sits in the same column, and a spotlight round the
    // whole column read as if checking were an edit too. Fit closes the column, under Clear map.
    { sel: ['.edit-col-ctrl'], k: 'Edit', group: ['#edit-col-add', '#edit-col-note', '#edit-col-undo', '#edit-col-clear', '#edit-col-fit'] },
    // Its own step, right after the buttons that make the route it checks.
    // The Layers button above it joins this step, lit with it.
    { sel: ['#edit-col-check'], k: 'Check', group: ['#edit-col-layers', '#edit-col-check'] },
    { sel: ['#measure-btn'], k: 'Measure' },
    { sel: ['#edit-lock'], k: 'Lock' },
    // Desktop: the Legend button and the route totals beside it (asked: "add it to the tutorial").
    // Its own step -- the one exception to "no new steps": nothing in the tour sits beside it, and
    // lit with the edit column or the dial the ring spanned half the screen. The phone's legend is
    // the card it always was and its tour stays at ten.
    { sel: ['#legend-toggle'], k: 'Legend', only: 'desktop', group: ['#legend-toggle', '#route-summary'] },
    // No new steps for new buttons (ten is already plenty): a control joins the step it sits
    // beside, lit together. Zoom and the credits are the same column as the dial.
    { sel: ['.rotate-ctrl', '#rotate-dial'], k: 'Dial', group: ['.rotate-ctrl', '.leaflet-control-zoom', '.attrib-toggle'] },
    { sel: ['.deck-btn-here', '#gps-live'], k: 'Location' },
    { sel: ['.deck-btn-record', '#gps-record'], k: 'Record' },
    // On a phone the language button shares the strip with Comm fail.
    { sel: ['.deck-strip-commfail', '#commfail-btn'], k: 'Commfail', group: ['.deck-strip-lang', '.deck-strip-commfail'] },
    // On a phone, the tabs beside Menu (Map, Plan) -- not the legend: in Hebrew it sits at the
    // other end of the bar, and the union lit the whole bar, Location and Record too. The text
    // names it. On a desktop the whole bar is lit already, and its text names what is in it.
    { sel: ['.deck-btn-menu', '#toolbar'], k: 'Menu', phoneGroup: ['.deck-btn-map', '.deck-btn-menu', '.deck-btn-plan'] },
    { sel: ['#search-overlay:not(.hidden) input', '#search-overlay:not(.hidden)'], k: 'Search', only: 'desktop' },
    { sel: null, k: 'Hold', only: 'phone' },
  ];
  // The in-flight tour: the controls that only appear while a fix is driving the map (and the
  // recording sign while a flight is recorded). Asked: "when recording, there are few more
  // icons on map, add tutorial for them". It plays once, the first time the position is live;
  // "Show the tour" always plays it after the map tour -- with no live position, the in-flight
  // buttons and the REC sign are shown for the tour's length (body.tour-live-preview) and put
  // away when it ends. The readout and the GPS chip have nothing to show without a fix, so
  // their steps are left out then.
  const LIVE_SEEN_KEY = 'navaid.liveTourSeen';
  const LIVE_STEPS = [
    // The REC pill on a desktop; on a phone, the deck's Record button, which is the sign there.
    { sel: ['#gps-rec-indicator', '.deck-btn-record'], k: 'LiveRec' },
    { sel: ['.deck-strip-vals', '#gps-readout'], k: 'LiveRead' },
    { sel: ['#gps-status'], k: 'LiveStatus' },
    { sel: ['#follow-lock'], k: 'LiveFollow' },
    { sel: ['#orient-toggle'], k: 'LiveOrient' },
    { sel: ['#voice-toggle'], k: 'LiveVoice' },
    { sel: ['#follow-me-map'], k: 'LiveShare' },
    // The heading line is drawn on the chart, not a control: a box over it is what the tour lights
    // (lineSpot below). Without a live position the line was described but nowhere on screen
    // (reported: "says about the flight line, but doesn't show it"); the preview draws one.
    // Kept even with nothing to light (a live fix with no heading yet): it was always a step.
    { sel: ['#tour-line-spot'], k: 'LiveLine', optional: true },
  ];
  const liveNow = () => typeof gpsPositionLive === 'function' && !!gpsPositionLive();
  const phone = () => document.body.classList.contains('deck-on');
  const visible = (el) => {
    if (!el || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const target = (step) => {
    if (!step.sel) return null;
    for (const s of step.sel) {
      for (const el of document.querySelectorAll(s)) if (visible(el)) return el;
    }
    return null;
  };
  const stepsOf = (defs) => defs.filter((s) => (!s.only || (s.only === 'phone') === phone()) && (!s.sel || s.optional || target(s)));
  const steps = () => stepsOf(STEPS);
  const str = (k, d) => (typeof S === 'object' && S && S[k]) || d;

  let root = null, list = [], i = 0, before = null, onKey = null, onResize = null, seenKeys = [SEEN_KEY];
  const PREVIEW = 'tour-live-preview';

  // The heading line, for its step. Live: the aircraft's own. Otherwise, during the preview, a
  // sample aircraft low in the middle of the chart heading up the screen, drawn by draw.js from
  // window.__tourDemoOwn. The step lights a box from the aircraft to the line's 10 nm mark.
  const LINE_NM = 10, DEMO_GS_KT = 100;
  function lineSpot() {
    if (typeof map === 'undefined' || !map) return;
    let pos = null, hdg = null;
    const own = typeof gpsOwn !== 'undefined' ? gpsOwn : null;
    if (liveNow() && own && Number.isFinite(own.hdg)) {
      pos = typeof gpsShownOwn === 'function' ? gpsShownOwn() : own;
      hdg = own.hdg;
      window.__tourDemoOwn = null;
    } else if (document.body.classList.contains(PREVIEW)) {
      const box = map.getContainer().getBoundingClientRect();
      const at = map.containerPointToLatLng([box.width / 2, box.height * 0.72]);
      // The heading that points up the screen, whatever the map's rotation.
      const a = map.latLngToContainerPoint(at), n = map.latLngToContainerPoint([at.lat + 0.05, at.lng]);
      hdg = (360 - Math.atan2(n.x - a.x, a.y - n.y) * 180 / Math.PI) % 360;
      pos = { lat: at.lat, lng: at.lng, t: Date.now() };
      window.__tourDemoOwn = { lat: pos.lat, lng: pos.lng, t: pos.t, hdg: hdg, gs: DEMO_GS_KT };
      if (typeof draw === 'function') draw();
    }
    let el = document.getElementById('tour-line-spot');
    if (!pos) { if (el) el.remove(); return; }
    const r = hdg * Math.PI / 180;
    const end = { lat: pos.lat + (LINE_NM / 60) * Math.cos(r),
      lng: pos.lng + (LINE_NM / 60) * Math.sin(r) / Math.cos(pos.lat * Math.PI / 180) };
    const box = map.getContainer().getBoundingClientRect();
    const p = map.latLngToContainerPoint([pos.lat, pos.lng]), q = map.latLngToContainerPoint([end.lat, end.lng]);
    const pad = 28;
    const clampX = (x) => Math.max(box.left + 8, Math.min(box.right - 8, x));
    const clampY = (y) => Math.max(box.top + 8, Math.min(box.bottom - 8, y));
    const l = clampX(box.left + Math.min(p.x, q.x) - pad), rr = clampX(box.left + Math.max(p.x, q.x) + pad);
    const t = clampY(box.top + Math.min(p.y, q.y) - pad), b = clampY(box.top + Math.max(p.y, q.y) + pad);
    if (!el) {
      el = document.createElement('div');
      el.id = 'tour-line-spot';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;pointer-events:none;z-index:1;';
      document.body.appendChild(el);
    }
    Object.assign(el.style, { left: l + 'px', top: t + 'px', width: Math.max(1, rr - l) + 'px', height: Math.max(1, b - t) + 'px' });
  }
  function clearLineSpot() {
    const el = document.getElementById('tour-line-spot');
    if (el) el.remove();
    if (window.__tourDemoOwn) { window.__tourDemoOwn = null; if (typeof draw === 'function') draw(); }
  }

  function close(seen) {
    if (!root) return;
    root.remove();
    root = null;
    document.body.classList.remove(PREVIEW);
    clearLineSpot();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (seen) { try { for (const k of seenKeys) localStorage.setItem(k, '1'); } catch (e) { /* storage off */ } }
    if (before && typeof before.focus === 'function') { try { before.focus(); } catch (e) { /* gone */ } }
  }

  // Where a line from `a` towards `b` leaves rectangle r (both points as {x, y}).
  function exitPoint(r, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let t = 1;
    if (dx) t = Math.min(t, ((dx > 0 ? r.right : r.left) - a.x) / dx);
    if (dy) t = Math.min(t, ((dy > 0 ? r.bottom : r.top) - a.y) / dy);
    return { x: a.x + dx * Math.max(0, t), y: a.y + dy * Math.max(0, t) };
  }

  // The box to light: the target's own, or the union of a step's `group` that is on screen.
  function rectOf(step, el) {
    // phoneGroup: lit together on a phone only -- on a desktop the target alone (the whole bar).
    const g = (phone() && step.phoneGroup) || step.group || [];
    const parts = g.map((s) => document.querySelector(s)).filter(visible);
    if (!parts.length) return el.getBoundingClientRect();
    const rs = parts.map((p) => p.getBoundingClientRect());
    const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
    const right = Math.max(...rs.map((r) => r.right)), bottom = Math.max(...rs.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function place() {
    if (!root) return;
    const step = list[i];
    const el = target(step);
    const spot = root.querySelector('.tour-spot');
    const bubble = root.querySelector('.tour-bubble');
    const arrow = root.querySelector('.tour-arrow');
    const vw = innerWidth, vh = innerHeight, m = 12;
    bubble.style.left = bubble.style.top = '0px';
    bubble.style.width = '';
    let bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    if (!el) {
      // A step about the map itself: no hole, the bubble in the middle.
      spot.hidden = true; arrow.hidden = true;
      root.classList.add('tour-plain');
      bubble.style.left = Math.round((vw - bw) / 2) + 'px';
      bubble.style.top = Math.round((vh - bh) / 2) + 'px';
      return;
    }
    root.classList.remove('tour-plain');
    const r = rectOf(step, el);
    const pad = 6;
    spot.hidden = false;
    // The ring stays on screen even for a control at the very edge (the phone's bottom bar).
    const sl = Math.max(2, r.left - pad), st = Math.max(2, r.top - pad);
    const sr = Math.min(vw - 2, r.right + pad), sb = Math.min(vh - 2, r.bottom + pad);
    Object.assign(spot.style, { left: sl + 'px', top: st + 'px', width: (sr - sl) + 'px', height: (sb - st) + 'px' });
    // The bubble goes on a side it FITS on, a gap away for the arrow to show; of those, the one
    // with the most room. Picking by room alone put it on the right of the edit column on a
    // 360px phone -- 300px free, 346px needed -- and the clamp pulled it back over the column.
    const gap = 46;
    const room = { below: vh - r.bottom, above: r.top, right: vw - r.right, left: r.left };
    const need = { below: bh + gap + m, above: bh + gap + m, right: bw + gap + m, left: bw + gap + m };
    const byRoom = Object.keys(room).sort((a, b) => room[b] - room[a]);
    // Nowhere fits (a tall group on a short phone): the side short by the LEAST, where the clamp
    // below tucks the bubble against the control instead of over it.
    let side = byRoom.find((s) => room[s] >= need[s]);
    if (!side) {
      // Nowhere fits as it is. A side column (the edit column on a short phone) has the map
      // beside it: the bubble narrows to the room there, close to the column, rather than being
      // clamped back over the very buttons it is about.
      const sideways = room.right >= room.left ? 'right' : 'left';
      const narrow = room[sideways] - 14 - m;
      if (narrow >= 220) {
        bubble.style.width = Math.floor(narrow) + 'px';
        bw = bubble.offsetWidth; bh = bubble.offsetHeight;
        need[sideways] = bw + 14 + m;
        if (bh + 2 * m <= vh) side = sideways;
      }
    }
    side = side || Object.keys(room).sort((a, b) => (room[b] - need[b]) - (room[a] - need[a]))[0];
    const sideGap = room[side] >= bw + gap + m ? gap : 14;
    let x, y;
    if (side === 'below' || side === 'above') {
      x = r.left + r.width / 2 - bw / 2;
      y = side === 'below' ? r.bottom + gap : r.top - gap - bh;
    } else {
      y = r.top + r.height / 2 - bh / 2;
      x = side === 'right' ? r.right + sideGap : r.left - sideGap - bw;
    }
    x = Math.max(m, Math.min(vw - bw - m, x));
    y = Math.max(m, Math.min(vh - bh - m, y));
    bubble.style.left = Math.round(x) + 'px';
    bubble.style.top = Math.round(y) + 'px';
    // The arrow: from the bubble's edge to the control's, along the line between their centres.
    const bc = { x: x + bw / 2, y: y + bh / 2 }, tc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const brect = { left: x, top: y, right: x + bw, bottom: y + bh };
    const trect = { left: r.left - pad - 6, top: r.top - pad - 6, right: r.right + pad + 6, bottom: r.bottom + pad + 6 };
    const a = exitPoint(brect, bc, tc), b = exitPoint(trect, tc, bc);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    arrow.hidden = len < 14;
    const line = arrow.querySelector('line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    // The nudge (CSS) moves the arrow along its own direction.
    arrow.style.setProperty('--tour-dx', ((b.x - a.x) / (len || 1) * 6).toFixed(2) + 'px');
    arrow.style.setProperty('--tour-dy', ((b.y - a.y) / (len || 1) * 6).toFixed(2) + 'px');
  }

  function render() {
    const step = list[i];
    root.querySelector('.tour-title').textContent = str('tour' + step.k + 'Title', step.k);
    // A step may say it differently on a phone and a desktop (tour<K>TextPhone / ...Desk).
    const base = str('tour' + step.k + 'Text', '');
    root.querySelector('.tour-text').textContent = str('tour' + step.k + 'Text' + (phone() ? 'Phone' : 'Desk'), base);
    root.querySelector('.tour-count').textContent = (i + 1) + ' / ' + list.length;
    const back = root.querySelector('.tour-back'), next = root.querySelector('.tour-next');
    back.disabled = i === 0;
    next.textContent = i === list.length - 1 ? str('tourDone', 'Done') : str('tourNext', 'Next');
    place();
    try { next.focus({ preventScroll: true }); } catch (e) { next.focus(); }
  }
  const go = (d) => {
    if (i + d >= list.length) { close(true); return; }
    i = Math.max(0, i + d);
    render();
  };

  // `which`: 'map' (the first-launch tour), 'live' (the in-flight one), or 'all' (both, for
  // "Show the tour" while the position is live). Each marks its own tour seen.
  function start(which) {
    if (root) return false;
    const w = which === 'live' || which === 'all' ? which : 'map';
    // "Show the tour" with no live position: show the in-flight controls so their steps can
    // point at them (before the steps are chosen -- a step is kept only if its control shows).
    if (w === 'all' && !liveNow()) document.body.classList.add(PREVIEW);
    if (w !== 'map') lineSpot();
    list = w === 'live' ? stepsOf(LIVE_STEPS) : w === 'all' ? steps().concat(stepsOf(LIVE_STEPS)) : steps();
    // A live tour of only the heading line is not worth stopping the pilot for.
    if (w === 'live' && !list.some((s) => s.sel && s.k !== 'LiveLine')) { clearLineSpot(); return false; }
    seenKeys = w === 'live' ? [LIVE_SEEN_KEY] : w === 'all' ? [SEEN_KEY, LIVE_SEEN_KEY] : [SEEN_KEY];
    if (!list.length) { document.body.classList.remove(PREVIEW); clearLineSpot(); return false; }
    i = 0;
    before = document.activeElement;
    root = document.createElement('div');
    root.id = 'map-tour';
    root.innerHTML =
      '<div class="tour-spot"></div>' +
      '<svg class="tour-arrow" aria-hidden="true"><defs><marker id="tour-head" viewBox="0 0 10 10" refX="7" refY="5"' +
      ' markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="currentColor"/></marker></defs>' +
      '<line marker-end="url(#tour-head)"/></svg>' +
      '<div class="tour-bubble" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">' +
      '<div class="tour-head"><span class="tour-count"></span><button type="button" class="tour-skip"></button></div>' +
      '<h3 class="tour-title" id="tour-title"></h3><p class="tour-text" id="tour-text"></p>' +
      '<div class="tour-btns"><button type="button" class="tour-back"></button><button type="button" class="tour-next"></button></div>' +
      '</div>';
    root.querySelector('.tour-skip').textContent = str('tourSkip', 'Skip');
    root.querySelector('.tour-back').textContent = str('tourBack', 'Back');
    root.querySelector('.tour-skip').onclick = () => close(true);
    root.querySelector('.tour-back').onclick = () => go(-1);
    root.querySelector('.tour-next').onclick = () => go(1);
    // A tap on the dimmed map is not a request to leave: only Skip / Done end it.
    root.addEventListener('pointerdown', (e) => { if (!e.target.closest('.tour-bubble')) e.preventDefault(); });
    document.body.appendChild(root);
    onKey = (e) => {
      if (!root) return;
      const rtl = document.documentElement.dir === 'rtl';
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); }
      else if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) { e.preventDefault(); go(1); }
      else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) { e.preventDefault(); go(-1); }
      else if (e.key === 'Tab') {
        // Focus stays in the bubble.
        const f = [...root.querySelectorAll('.tour-bubble button:not([disabled])')];
        const at = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    onResize = () => place();
    window.addEventListener('resize', onResize);
    render();
    return true;
  }

  // First launch: once the app is up and nothing else is asking for attention (the safety
  // notice, the boot screen, a question), and only if the tour is on and not yet seen.
  // A link someone shared (a Follow me view, a route, the pilots link) opens on what it was
  // shared for, not a walk round the controls: no tour then, and it is not marked seen, so the
  // pilot's own first visit still gets it.
  function maybeAutoStart() {
    if (window.__navaidNoTour) return;                    // the test suite (tests/_setup.js)
    if (window.__navaidFromSharedLink) return;
    if (typeof tune === 'function' && tune('featureTour') === false) return;
    try { if (localStorage.getItem(SEEN_KEY) === '1') return; } catch (e) { return; }
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > 240) { clearInterval(t); return; }
      if (document.getElementById('boot-loading') || document.querySelector('.modal-back')) return;
      // After the safety notice (disclaimer.js), never under it.
      if (!(window.NavAid && NavAid.disclaimerDone) || document.querySelector('.disclaimer-back')) return;
      if (typeof map === 'undefined' || !map) return;
      clearInterval(t);
      setTimeout(start, 600);
    }, 500);
  }

  // The in-flight tour, the first time the position is live: polled (cheaply, every 2 s) only
  // until it has been seen. It waits for the map tour, a dialog or the boot screen to be gone,
  // and for the controls to be on screen.
  function maybeAutoStartLive() {
    if (window.__navaidNoTour) return;
    if (window.__navaidFromSharedLink) return;
    if (typeof tune === 'function' && tune('featureTour') === false) return;
    try { if (localStorage.getItem(LIVE_SEEN_KEY) === '1') return; } catch (e) { return; }
    let liveSince = 0;
    const t = setInterval(() => {
      try { if (localStorage.getItem(LIVE_SEEN_KEY) === '1') { clearInterval(t); return; } } catch (e) { clearInterval(t); return; }
      if (!liveNow()) { liveSince = 0; return; }
      if (root || document.getElementById('boot-loading') || document.querySelector('.modal-back, .disclaimer-back')) return;
      if (!liveSince) { liveSince = Date.now(); return; }
      if (Date.now() - liveSince < 1500) return;          // the controls have just appeared
      if (start('live')) clearInterval(t);
    }, 2000);
  }

  window.NavAid = window.NavAid || {};
  NavAid.tour = { start, close: () => close(false), steps, liveSteps: () => stepsOf(LIVE_STEPS) };
  const replay = document.getElementById('tour-replay');
  if (replay) replay.addEventListener('click', () => {
    if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    // On a phone the menu sheet covers the map: the Map tab puts everything away first.
    const mapTab = document.querySelector('.deck-btn-map');
    if (mapTab && phone()) mapTab.click();
    setTimeout(() => start('all'), 350);
  });
  if (document.readyState === 'complete') { maybeAutoStart(); maybeAutoStartLive(); }
  else window.addEventListener('load', () => { maybeAutoStart(); maybeAutoStartLive(); });
}());
