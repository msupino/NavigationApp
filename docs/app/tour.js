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
    { sel: ['.edit-col-ctrl'], k: 'Edit' },
    { sel: ['#measure-btn'], k: 'Measure' },
    { sel: ['#edit-lock'], k: 'Lock' },
    { sel: ['.rotate-ctrl', '#rotate-dial'], k: 'Dial' },
    { sel: ['.deck-btn-here', '#gps-live'], k: 'Location' },
    { sel: ['.deck-btn-record', '#gps-record'], k: 'Record' },
    { sel: ['.deck-strip-commfail', '#commfail-btn'], k: 'Commfail' },
    { sel: ['.deck-btn-menu', '#toolbar'], k: 'Menu' },
    { sel: ['#search-overlay:not(.hidden) input', '#search-overlay:not(.hidden)'], k: 'Search', only: 'desktop' },
    { sel: null, k: 'Hold', only: 'phone' },
  ];
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
  const steps = () => STEPS.filter((s) => (!s.only || (s.only === 'phone') === phone()) && (!s.sel || target(s)));
  const str = (k, d) => (typeof S === 'object' && S && S[k]) || d;

  let root = null, list = [], i = 0, before = null, onKey = null, onResize = null;

  function close(seen) {
    if (!root) return;
    root.remove();
    root = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (seen) { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* storage off */ } }
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

  function place() {
    if (!root) return;
    const step = list[i];
    const el = target(step);
    const spot = root.querySelector('.tour-spot');
    const bubble = root.querySelector('.tour-bubble');
    const arrow = root.querySelector('.tour-arrow');
    const vw = innerWidth, vh = innerHeight, m = 12;
    bubble.style.left = bubble.style.top = '0px';
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    if (!el) {
      // A step about the map itself: no hole, the bubble in the middle.
      spot.hidden = true; arrow.hidden = true;
      root.classList.add('tour-plain');
      bubble.style.left = Math.round((vw - bw) / 2) + 'px';
      bubble.style.top = Math.round((vh - bh) / 2) + 'px';
      return;
    }
    root.classList.remove('tour-plain');
    const r = el.getBoundingClientRect();
    const pad = 6;
    spot.hidden = false;
    // The ring stays on screen even for a control at the very edge (the phone's bottom bar).
    const sl = Math.max(2, r.left - pad), st = Math.max(2, r.top - pad);
    const sr = Math.min(vw - 2, r.right + pad), sb = Math.min(vh - 2, r.bottom + pad);
    Object.assign(spot.style, { left: sl + 'px', top: st + 'px', width: (sr - sl) + 'px', height: (sb - st) + 'px' });
    // The bubble goes on the side with the most room, a gap away for the arrow to show.
    const gap = 46;
    const room = { below: vh - r.bottom, above: r.top, right: vw - r.right, left: r.left };
    const side = Object.keys(room).sort((a, b) => room[b] - room[a])[0];
    let x, y;
    if (side === 'below' || side === 'above') {
      x = r.left + r.width / 2 - bw / 2;
      y = side === 'below' ? r.bottom + gap : r.top - gap - bh;
    } else {
      y = r.top + r.height / 2 - bh / 2;
      x = side === 'right' ? r.right + gap : r.left - gap - bw;
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
    root.querySelector('.tour-text').textContent = str('tour' + step.k + 'Text', '');
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

  function start() {
    if (root) return false;
    list = steps();
    if (!list.length) return false;
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
  function maybeAutoStart() {
    if (window.__navaidNoTour) return;                    // the test suite (tests/_setup.js)
    if (typeof tune === 'function' && tune('featureTour') === false) return;
    try { if (localStorage.getItem(SEEN_KEY) === '1') return; } catch (e) { return; }
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > 240) { clearInterval(t); return; }
      if (document.getElementById('boot-loading') || document.querySelector('.modal-back')) return;
      if (typeof map === 'undefined' || !map) return;
      clearInterval(t);
      setTimeout(start, 600);
    }, 500);
  }

  window.NavAid = window.NavAid || {};
  NavAid.tour = { start, close: () => close(false), steps };
  const replay = document.getElementById('tour-replay');
  if (replay) replay.addEventListener('click', () => {
    if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    // On a phone the menu sheet covers the map: the Map tab puts everything away first.
    const mapTab = document.querySelector('.deck-btn-map');
    if (mapTab && phone()) mapTab.click();
    setTimeout(start, 350);
  });
  if (document.readyState === 'complete') maybeAutoStart();
  else window.addEventListener('load', maybeAutoStart);
}());
