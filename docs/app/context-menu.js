'use strict';
/* NavAid — right-click quick actions on the map (desktop).

   Asked: "can we capture right click for quick edit actions?" A right-click opens a small menu
   at the cursor with what can be done to whatever is under it:
     - open map: add a waypoint here (or start a route), add a note, Direct to, point details,
       distance from the aircraft;
     - a route waypoint, a leg, a chart point (nav point, airfield, VOR) or a note: it is
       selected, as a click would, and the menu carries the actions of its own inspector, plus
       the one or two only a pointer can give (insert here, rename / edit).

   The item actions are the inspector's own buttons -- the menu mirrors them, label, pressed
   state and dimming reason included, and pressing an item presses that button -- so the two can
   never disagree about what a point allows (the route lock, a missing GPS fix, a turn the
   geometry already settles). Dimmed, never hidden: a dimmed item says why when pressed.

   A mouse only: on a touch screen a long press already opens the point details (deck.js), and a
   browser's own long-press context menu is left to it. Shift + right-click opens the browser's
   own menu, for copying a link or inspecting the page. */
(function () {
  if (typeof map === 'undefined' || !map || typeof L === 'undefined') return;
  const t = (key, fallback) => (typeof S === 'object' && S && S[key]) || fallback;

  let menu = null;
  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('blur', closeMenu);
    map.off('movestart zoomstart', closeMenu);
  }
  function outside(e) { if (menu && !menu.contains(e.target)) closeMenu(); }

  // One item: { label, run, why (dimmed with this reason), pressed, danger }. Built as a real
  // button through setButtonWhy, so a dimmed one says why on a press, like everywhere else.
  function itemButton(it) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctx-item' + (it.danger ? ' ctx-danger' : '') + (it.pressed ? ' ctx-on' : '');
    b.setAttribute('role', 'menuitem');
    // An icon on every item, as on every button: the mirrored ones the same as their panel
    // button, the menu's own named below.
    if (it.icon && typeof navIconSvg === 'function') {
      const ic = document.createElement('span');
      ic.className = 'mi-icon';
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = navIconSvg(it.icon, 16);
      b.appendChild(ic);
    }
    b.appendChild(document.createTextNode(it.label));
    if (it.pressed) b.setAttribute('aria-checked', 'true');
    if (typeof setButtonWhy === 'function') setButtonWhy(b, it.why || null);
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;   // the why toast has run
      closeMenu();
      it.run();
    });
    return b;
  }

  function openMenu(clientX, clientY, title, items) {
    closeMenu();
    if (!items.length) return;
    menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', title || t('ctxMenuLabel', 'Quick actions'));
    if (title) {
      const h = document.createElement('div');
      h.className = 'ctx-title';
      h.textContent = title;
      menu.appendChild(h);
    }
    let lastDanger = false;
    for (const it of items) {
      if (it.danger && !lastDanger && menu.querySelector('.ctx-item')) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
      }
      lastDanger = !!it.danger;
      menu.appendChild(itemButton(it));
    }
    document.body.appendChild(menu);
    // At the cursor, kept inside the window.
    const r = menu.getBoundingClientRect();
    const x = Math.max(4, Math.min(clientX, window.innerWidth - r.width - 4));
    const y = Math.max(4, Math.min(clientY, window.innerHeight - r.height - 4));
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.addEventListener('keydown', onKey);
    menu.addEventListener('contextmenu', (e) => e.preventDefault());
    const first = menu.querySelector('.ctx-item');
    if (first) first.focus({ preventScroll: true });
    setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      window.addEventListener('blur', closeMenu);
      map.on('movestart zoomstart', closeMenu);
    }, 0);
  }
  function onKey(e) {
    const list = menu ? [...menu.querySelectorAll('.ctx-item')] : [];
    const at = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (list[(at + 1) % list.length] || list[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (list[(at - 1 + list.length) % list.length] || list[0]).focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0] && list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1] && list[list.length - 1].focus(); }
  }

  // An inspector button as a menu item: its words, its pressed look, its dimming reason, and
  // pressing it. A button the inspector disables outright (no reason) is dimmed with its title.
  function mirror(btn, extra) {
    const dimmed = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
    return Object.assign({
      // Words only: the panel draws its leading symbol (↻ 🔥 ⏱ 🗑 ➕) as an icon; a menu
      // reads as plain text.
      label: (btn.textContent || '').trim().replace(/^[^\p{L}\p{N}(]+/u, ''),
      pressed: btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('insp-btn-on'),
      danger: btn.classList.contains('insp-btn-danger'),
      icon: typeof navButtonIconName === 'function' ? navButtonIconName(btn) : '',
      why: dimmed ? (btn.dataset.why || btn.title || t('ctxUnavailable', 'Not available here')) : null,
      run: () => btn.click(),
    }, extra || {});
  }
  function inspectorActions() {
    const body = document.getElementById('insp-body');
    const insp = document.getElementById('inspector');
    if (!body || !insp || insp.classList.contains('hidden')) return [];
    return [...body.querySelectorAll('.insp-actions button.insp-btn')]
      .filter(b => b.offsetParent !== null || b.closest('.insp-actions'))
      .map(b => mirror(b));
  }
  function lockWhy() {
    return (typeof routeEditLocked === 'function' && routeEditLocked())
      ? t('editLockBlockedToast', 'The route is locked') : null;
  }
  function focusInspectorField(selector) {
    const el = document.querySelector('#insp-body ' + selector);
    if (el) { el.focus(); if (typeof el.select === 'function') el.select(); }
  }
  function select(sel) {
    state.selected = sel;
    if (typeof showInspector === 'function') showInspector();
    if (typeof draw === 'function') draw();
  }

  // What is under the pointer, in the order a click resolves it: notes are drawn above
  // waypoints, then waypoints, legs, and the chart's own points.
  function targetAt(p, latlng) {
    if (typeof hitNote === 'function') {
      const n = hitNote(p.x, p.y);
      if (n >= 0) return { type: 'note', index: n };
    }
    if (typeof hitWaypointCandidates === 'function') {
      const w = hitWaypointCandidates(p.x, p.y);
      if (w.length) return { type: 'wp', index: w[0].index };
    }
    // A leg's kites (time, heading) are the leg too: a left click there opens its inspector,
    // so a right click opens its menu, not the bare map's.
    for (const fn of ['hitCumLabel', 'hitCumLabelRet', 'hitLegLabel']) {
      const k = typeof window[fn] === 'function' ? window[fn](p.x, p.y) : null;
      if (k && Number.isInteger(k.i)) return { type: 'leg', index: k.i, latlng };
    }
    if (typeof hitLeg === 'function') {
      const l = hitLeg(p.x, p.y);
      if (l >= 0) return { type: 'leg', index: l, latlng };
    }
    if (typeof hitOverlayMarkerCandidates === 'function') {
      const o = hitOverlayMarkerCandidates(p.x, p.y)
        .find(h => h && (h.type === 'navwp' || h.type === 'airfield' || h.type === 'vor'));
      if (o) return o;
    }
    return { type: 'map', latlng };
  }

  function itemsFor(target, latlng) {
    if (target.type === 'map') {
      // The inspector's own Direct to and Add to route, built for this spot without opening it.
      const tmp = document.createElement('div');
      const pt = { lat: latlng.lat, lng: latlng.lng };
      if (typeof appendAddToRouteButton === 'function') appendAddToRouteButton(tmp, pt);
      if (typeof appendDirectToButton === 'function') appendDirectToButton(tmp, pt);
      const items = [...tmp.querySelectorAll('button')].map(b => mirror(b));
      items.push({
        label: t('ctxAddNoteHere', 'Add note here'), icon: 'addNote', why: lockWhy(),
        run: () => {
          state.notes.push({ lat: r5(latlng.lat), lng: r5(latlng.lng), text: S.noteDefault,
                             color: NOTE_DEFAULT_COLOR, shape: 'rect' });
          select({ type: 'note', index: state.notes.length - 1 });
          focusInspectorField('textarea');
        },
      });
      items.push({
        label: t('deckHereTitle', 'Point details'), icon: 'location',
        run: () => select({ type: 'coord', lat: latlng.lat, lng: latlng.lng, held: true }),
      });
      const live = typeof measureLiveFrom === 'function' && measureLiveFrom();
      items.push({
        label: t('ctxDistanceHere', 'Distance from the aircraft'), icon: 'ruler',
        why: live ? null : t('whyMeasureNoPosition', 'Measure works from your position: turn on Location'),
        run: () => {
          if (typeof measureToggle === 'function') measureToggle(true, true);
          if (typeof measureTap === 'function') measureTap(latlng);
        },
      });
      return { title: '', items };
    }

    select(target);
    const own = inspectorActions();
    const extra = [];
    if (target.type === 'wp') {
      const i = target.index;
      const next = state.waypoints[i + 1];
      const wp = state.waypoints[i];
      extra.push({
        label: t('ctxInsertAfter', 'Insert waypoint after'), icon: 'insert',
        why: lockWhy() || (next ? null : t('ctxLastPoint', 'The last point has no leg after it')),
        run: () => splitLegAt(i, { lat: (wp.lat + next.lat) / 2, lng: (wp.lng + next.lng) / 2 }),
      });
      extra.push({
        label: t('ctxRename', 'Rename'), icon: 'edit',
        run: () => focusInspectorField('.row input[type="text"]'),
      });
    } else if (target.type === 'leg') {
      extra.push({
        label: t('ctxInsertHere', 'Insert waypoint here'), icon: 'insert', why: lockWhy(),
        run: () => splitLegAt(target.index, latlng),
      });
    } else if (target.type === 'note') {
      // Delete is the note inspector's own button, mirrored below.
      extra.push({ label: t('ctxEditNote', 'Edit text'), icon: 'edit', run: () => focusInspectorField('textarea') });
    }
    const title = (document.getElementById('insp-title') || {}).value || '';
    // Insert / rename first, then the inspector's own actions in its order, Delete last.
    const items = extra.filter(x => !x.danger).concat(own.filter(x => !x.danger),
      extra.filter(x => x.danger), own.filter(x => x.danger));
    return { title, items };
  }

  function onContextMenu(ev) {
    if (ev.shiftKey) return;                                // the browser's own menu
    // A mouse only: a touch long press opens deck.js's point details.
    if (ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents) return;
    if (window.matchMedia && !window.matchMedia('(pointer: fine)').matches) return;
    if (ev.target && ev.target.closest && ev.target.closest('.leaflet-control, #inspector')) return;
    ev.preventDefault();
    ev.stopPropagation();
    const p = map.mouseEventToContainerPoint(ev);
    const latlng = map.containerPointToLatLng(p);
    const target = targetAt(p, latlng);
    const { title, items } = itemsFor(target, latlng);
    openMenu(ev.clientX, ev.clientY, title, items);
  }
  map.getContainer().addEventListener('contextmenu', onContextMenu, true);

  window.NavAidContextMenu = { open: onContextMenu, close: closeMenu, targetAt };
}());
