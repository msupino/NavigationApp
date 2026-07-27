'use strict';

// Shared helper: attach a top-right '✕' close button to a .modal box. The
// inspector's #insp-close already uses this pattern; modals now match it
// (plate viewer, charts modal, flight plan) — see issue thread on toolbar
// cleanup. `onClose` is invoked when the user clicks the X.
function addModalCloseX(box, onClose, options = {}) {
  const x = document.createElement('button');
  x.className = 'modal-close-x';
  x.type = 'button';
  x.textContent = '✕';
  x.setAttribute('aria-label', (window.S && S.modalCloseTitle) || 'Close');
  x.title = (window.S && S.modalCloseTitle) || 'Close';
  x.onclick = onClose;
  const actions = Array.isArray(options.actions) ? options.actions.filter(Boolean) : [];
  if (actions.length) {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'modal-close-actions';
    for (const action of actions) actionWrap.appendChild(action);
    actionWrap.appendChild(x);
    box.appendChild(actionWrap);
    return;
  }
  box.appendChild(x);
}

const OPEN_CHART_MODAL_KEY = 'navaid.openChartModal';

function rememberOpenChartModal(kind) {
  if (!kind) return;
  try { sessionStorage.setItem(OPEN_CHART_MODAL_KEY, kind); } catch (e) { /* */ }
}

function readOpenChartModal() {
  try { return sessionStorage.getItem(OPEN_CHART_MODAL_KEY) || ''; }
  catch (e) { return ''; }
}

function clearOpenChartModal(kind) {
  try {
    const current = sessionStorage.getItem(OPEN_CHART_MODAL_KEY);
    if (!kind || current === kind) sessionStorage.removeItem(OPEN_CHART_MODAL_KEY);
  } catch (e) { /* */ }
}

function closeOpenChartModals() {
  for (const back of Array.from(document.querySelectorAll('.modal-back[data-chart-modal]'))) {
    if (typeof back._navaidClose === 'function') back._navaidClose();
    else back.remove();
  }
  // The flight plan is a chart too (non-blocking backdrop, no data-chart-modal);
  // close it as well so only one chart is ever on screen.
  if (typeof fpOpen !== 'undefined' && fpOpen && typeof closeFlightPlan === 'function') {
    closeFlightPlan();
  }
}

function isChartModalOpen(kind) {
  if (!kind) return false;
  for (const back of document.querySelectorAll('.modal-back[data-chart-modal]')) {
    if (back.dataset.chartModal === kind) return true;
  }
  return false;
}

function prepareChartModal(kind) {
  if (isChartModalOpen(kind)) return false;
  if (fpOpen) closeFlightPlan();
  closeOpenChartModals();
  rememberOpenChartModal(kind);
  return true;
}

// --- Keyboard-shortcuts cheat-sheet (issue #420) --------------------
// Single source of truth for the visible cheat-sheet rows. Each row's
// `keys` array is rendered as <kbd> chips so the rendering is locale-
// agnostic; the `descKey` is looked up in S so each locale controls the
// wording. Adding a new global shortcut means appending a row here AND
// updating the audit table in .claude/skills/navaid-dev/SKILL.md so the
// docs stay in sync.
const SHORTCUTS_HELP_ROWS = [
  { group: 'shortcutsGroupNavigation',
    rows: [
      { keys: ['F'], descKey: 'shortcutFitRoute' },
      { keys: ['+'], altKeys: ['='], descKey: 'shortcutZoomIn' },
      { keys: ['−'], altKeys: ['-'], descKey: 'shortcutZoomOut' },
      { keys: ['M'], descKey: 'shortcutMagnifier' },
    ] },
  { group: 'shortcutsGroupSearch',
    rows: [{ keys: ['Ctrl', 'F'], altKeys: ['⌘', 'F'], descKey: 'shortcutSearch' }] },
  { group: 'shortcutsGroupEditing',
    rows: [
      { keys: ['A'], descKey: 'shortcutAddWp' },
      { keys: ['N'], descKey: 'shortcutAddNote' },
      { keys: ['C'], descKey: 'shortcutClear' },
      { keys: ['R'], descKey: 'shortcutReverse' },
      { keys: ['B'], descKey: 'shortcutBothDirections' },
      { keys: ['Ctrl', 'Z'], altKeys: ['⌘', 'Z'], descKey: 'shortcutUndo' },
      { keys: ['Esc'], descKey: 'shortcutEsc' },
      { keys: ['D'], altKeys: ['Delete', 'Backspace'], descKey: 'shortcutDelete' },
    ] },
  { group: 'shortcutsGroupHelp',
    rows: [{ keys: ['?'], descKey: 'shortcutHelp' }] },
];
let _shortcutsHelpBack = null;
let _shortcutsHelpPrevFocus = null;
let _shortcutsHelpOnEsc = null;
let _shortcutsHelpOnFocusTrap = null;

function showShortcutsHelp() {
  if (_shortcutsHelpBack) return;   // already open — idempotent
  if (typeof closeToolbarDesktopMenus === 'function') closeToolbarDesktopMenus();
  _shortcutsHelpPrevFocus = document.activeElement;

  const back = document.createElement('div');
  back.className = 'modal-back shortcuts-help';

  const box = document.createElement('div');
  box.className = 'modal shortcuts-help-modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'shortcuts-help-title');

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.id = 'shortcuts-help-title';
  title.textContent = S.shortcutsHelpTitle || 'Keyboard shortcuts';
  // Make the title non-grabbable for this modal — the cheat-sheet is
  // ephemeral, doesn't need positioning, and the cursor: grab on .modal-title
  // would otherwise mislead the user.
  title.style.cursor = 'default';
  box.appendChild(title);

  const list = document.createElement('dl');
  list.className = 'shortcuts-help-list';
  for (const group of SHORTCUTS_HELP_ROWS) {
    const groupTitle = document.createElement('div');
    groupTitle.className = 'shortcuts-help-group';
    groupTitle.textContent = S[group.group] || group.group;
    list.appendChild(groupTitle);
    // Alphabetical within each category (by the primary key combo) so the
    // rows are predictable to scan; the category order itself is curated.
    const rows = [...group.rows].sort((a, b) =>
      a.keys.join('+').localeCompare(b.keys.join('+')));
    for (const row of rows) {
      const dt = document.createElement('dt');
      dt.className = 'shortcuts-help-keys';
      // Render primary key combo; if `altKeys` is present, render as
      // "Ctrl+F / ⌘+F" so users on either OS see their combo.
      _appendKeyCombo(dt, row.keys);
      if (row.altKeys) {
        const sep = document.createElement('span');
        sep.className = 'shortcuts-help-sep';
        sep.textContent = ' / ';
        dt.appendChild(sep);
        _appendKeyCombo(dt, row.altKeys);
      }
      const dd = document.createElement('dd');
      dd.className = 'shortcuts-help-desc';
      dd.textContent = S[row.descKey] || row.descKey;
      list.appendChild(dt);
      list.appendChild(dd);
    }
  }
  box.appendChild(list);

  addModalCloseX(box, closeShortcutsHelp);

  // Esc: close.
  _shortcutsHelpOnEsc = function (e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeShortcutsHelp();
    }
  };
  document.addEventListener('keydown', _shortcutsHelpOnEsc, true);

  // Focus trap: Tab / Shift-Tab cycles inside the modal so screen-reader
  // users do not escape into the toolbar behind the backdrop.
  _shortcutsHelpOnFocusTrap = function (e) {
    if (e.key !== 'Tab') return;
    const focusables = box.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  box.addEventListener('keydown', _shortcutsHelpOnFocusTrap);

  back.appendChild(box);
  back.addEventListener('click', e => {
    if (e.target === back) closeShortcutsHelp();
  });
  document.body.appendChild(back);
  _shortcutsHelpBack = back;

  // Move focus into the modal so Esc/Tab work without an extra click.
  const closeBtn = box.querySelector('.modal-close-x');
  if (closeBtn) closeBtn.focus();
}

function closeShortcutsHelp() {
  if (!_shortcutsHelpBack) return;
  if (_shortcutsHelpOnEsc) {
    document.removeEventListener('keydown', _shortcutsHelpOnEsc, true);
    _shortcutsHelpOnEsc = null;
  }
  _shortcutsHelpOnFocusTrap = null;
  _shortcutsHelpBack.remove();
  _shortcutsHelpBack = null;
  // Restore focus to whatever was focused before the modal opened so the
  // user can keep working without an extra click. Guard against the
  // previously-focused element having been removed from the DOM.
  if (_shortcutsHelpPrevFocus &&
      typeof _shortcutsHelpPrevFocus.focus === 'function' &&
      document.contains(_shortcutsHelpPrevFocus)) {
    try { _shortcutsHelpPrevFocus.focus(); } catch (e) { /* unfocusable */ }
  }
  _shortcutsHelpPrevFocus = null;
}

function _appendKeyCombo(parent, keys) {
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) {
      const plus = document.createElement('span');
      plus.className = 'shortcuts-help-plus';
      plus.textContent = '+';
      parent.appendChild(plus);
    }
    const kbd = document.createElement('kbd');
    kbd.textContent = keys[i];
    parent.appendChild(kbd);
  }
}

/* NavAid — save/load, page setup, flight plan, PNG export, persistence.
   Shares globals with core.js; loaded after interact.js. */

// --- schema validation ----------------------------------------------
// Strict validation of every documented field on route JSON (file import
// + localStorage restore) and on cvfr-nav-waypoints.json. A typo like
// `flghtSpeed` used to silently default; now it surfaces an alert that
// names the offending field path so the JSON author can find it. Extra /
// unknown fields at any level are silently allowed for forward-compat
// with future schema additions (issue #101). Plain JS — no deps.
function _vKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;                  // 'number' | 'string' | 'object' | …
}
// Push an error onto `errs` if `obj[key]` is missing or wrong-typed.
// `type` is one of: 'number' | 'string' | 'object' | 'array' | 'shape'.
// 'number' rejects NaN/Infinity; 'shape' allows exactly 'rect' | 'oval'.
function _v(obj, key, type, path, errs) {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    errs.push(path + '.' + key + ': missing');
    return false;
  }
  const v = obj[key];
  const k = _vKind(v);
  if (type === 'number') {
    if (k !== 'number' || !Number.isFinite(v)) {
      errs.push(path + '.' + key + ': expected number, got ' + k);
      return false;
    }
  } else if (type === 'string') {
    if (k !== 'string') {
      errs.push(path + '.' + key + ': expected string, got ' + k);
      return false;
    }
  } else if (type === 'object') {
    if (k !== 'object') {
      errs.push(path + '.' + key + ': expected object, got ' + k);
      return false;
    }
  } else if (type === 'array') {
    if (k !== 'array') {
      errs.push(path + '.' + key + ': expected array, got ' + k);
      return false;
    }
  } else if (type === 'shape') {
    if (v !== 'rect' && v !== 'oval') {
      errs.push(path + '.' + key + ': expected "rect" or "oval", got ' +
                JSON.stringify(v));
      return false;
    }
  }
  return true;
}
function _isRouteAltitude(v) {
  return v === 'NaN' || v === null ||
    (typeof v === 'number' && (Number.isFinite(v) || Number.isNaN(v)));
}
function _vRouteAltitude(obj, key, path, errs) {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    errs.push(path + '.' + key + ': missing');
    return false;
  }
  if (!_isRouteAltitude(obj[key])) {
    errs.push(path + '.' + key + ': expected number or "NaN", got ' +
              _vKind(obj[key]));
    return false;
  }
  return true;
}
function validateRoute(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  const wpsOk   = _v(d, 'waypoints', 'array', 'root', errs);
  const legsOk  = _v(d, 'legs',      'array', 'root', errs);
  const notesOk = _v(d, 'notes',     'array', 'root', errs);
  if (Object.prototype.hasOwnProperty.call(d, 'commChangeSuppressions')) {
    if (!Array.isArray(d.commChangeSuppressions)) {
      errs.push('root.commChangeSuppressions: expected array, got ' +
                _vKind(d.commChangeSuppressions));
    } else {
      for (let i = 0; i < d.commChangeSuppressions.length; i++) {
        if (typeof d.commChangeSuppressions[i] !== 'string') {
          errs.push('root.commChangeSuppressions[' + i +
                    ']: expected string, got ' + _vKind(d.commChangeSuppressions[i]));
        }
      }
    }
  }
  // Route-wide wind (#722) — optional { dir (°true, FROM), speed (kt) }.
  if (Object.prototype.hasOwnProperty.call(d, 'wind')) {
    if (_vKind(d.wind) !== 'object') {
      errs.push('root.wind: expected object, got ' + _vKind(d.wind));
    } else {
      _v(d.wind, 'dir',   'number', 'root.wind', errs);
      _v(d.wind, 'speed', 'number', 'root.wind', errs);
    }
  }
  if (Object.prototype.hasOwnProperty.call(d, 'bearing') && typeof d.bearing !== 'number') {
    errs.push('root.bearing: expected number, got ' + _vKind(d.bearing));
  }
  if (wpsOk) {
    for (let i = 0; i < d.waypoints.length; i++) {
      const p = 'waypoints[' + i + ']';
      const w = d.waypoints[i];
      if (_vKind(w) !== 'object') {
        errs.push(p + ': expected object, got ' + _vKind(w));
        continue;
      }
      _v(w, 'lat',  'number', p, errs);
      _v(w, 'lng',  'number', p, errs);
      _v(w, 'name', 'string', p, errs);
    }
  }
  if (legsOk) {
    for (let i = 0; i < d.legs.length; i++) {
      const p = 'legs[' + i + ']';
      const l = d.legs[i];
      if (_vKind(l) !== 'object') {
        errs.push(p + ': expected object, got ' + _vKind(l));
        continue;
      }
      _vRouteAltitude(l, 'inboundAltitude', p, errs);
      _vRouteAltitude(l, 'outboundAltitude', p, errs);
      _v(l, 'flightSpeed',      'number', p, errs);
      // #212: hasOwnProperty (not 'in') so inherited Object.prototype keys
      // can never satisfy the optional check.
      if (Object.prototype.hasOwnProperty.call(l, 'outboundSpeed')) {
        _v(l, 'outboundSpeed', 'number', p, errs);
      }
      // Per-leg wind override (#722) — optional; dir / speed each optional
      // (a partial override falls back to the route wind for the other half).
      if (Object.prototype.hasOwnProperty.call(l, 'wind')) {
        if (_vKind(l.wind) !== 'object') {
          errs.push(p + '.wind: expected object, got ' + _vKind(l.wind));
        } else {
          for (const k of ['dir', 'speed']) {
            if (Object.prototype.hasOwnProperty.call(l.wind, k)) {
              _v(l.wind, k, 'number', p + '.wind', errs);
            }
          }
        }
      }
      // Issue #394: `_default: 1` is the sentinel form written by
      // `_defaultLegLabels()` for an unmodified kite — its perpendicular
      // is computed at render time from the live leg length, so the
      // stored shape has no `p`. Accept either the sentinel form
      // (`a` only) or the user-dragged form (`a` + `p`).
      if (_v(l, 'inLabel',  'object', p, errs)) {
        _v(l.inLabel,  'a', 'number', p + '.inLabel',  errs);
        if (!l.inLabel._default) {
          _v(l.inLabel, 'p', 'number', p + '.inLabel', errs);
        }
      }
      if (_v(l, 'outLabel', 'object', p, errs)) {
        _v(l.outLabel, 'a', 'number', p + '.outLabel', errs);
        if (!l.outLabel._default) {
          _v(l.outLabel, 'p', 'number', p + '.outLabel', errs);
        }
      }
    }
  }
  if (notesOk) {
    for (let i = 0; i < d.notes.length; i++) {
      const p = 'notes[' + i + ']';
      const n = d.notes[i];
      if (_vKind(n) !== 'object') {
        errs.push(p + ': expected object, got ' + _vKind(n));
        continue;
      }
      _v(n, 'lat',   'number', p, errs);
      _v(n, 'lng',   'number', p, errs);
      _v(n, 'text',  'string', p, errs);
      _v(n, 'color', 'string', p, errs);
      _v(n, 'shape', 'shape',  p, errs);
      for (const k of ['cc', 'freqName', 'freq']) {
        if (Object.prototype.hasOwnProperty.call(n, k) && typeof n[k] !== 'string') {
          errs.push(p + '.' + k + ': expected string, got ' + _vKind(n[k]));
        }
      }
      if (Object.prototype.hasOwnProperty.call(n, 'freqAuto') &&
          typeof n.freqAuto !== 'boolean') {
        errs.push(p + '.freqAuto: expected boolean, got ' + _vKind(n.freqAuto));
      }
      if (Object.prototype.hasOwnProperty.call(n, 'size') &&
          typeof n.size !== 'number') {
        errs.push(p + '.size: expected number, got ' + _vKind(n.size));
      }
    }
  }
  if (wpsOk && legsOk) {
    const wlen = d.waypoints.length, llen = d.legs.length;
    const expected = wlen === 0 ? 0 : wlen - 1;
    if (llen !== expected) {
      errs.push('legs: length ' + llen +
                ' does not match waypoints.length - 1 (' + expected + ')');
    }
  }
  return errs.length ? errs.join('; ') : null;
}
function validateNavWaypoints(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  if (!_v(d, 'waypoints', 'array', 'root', errs)) return errs.join('; ');
  for (let i = 0; i < d.waypoints.length; i++) {
    const p = 'waypoints[' + i + ']';
    const w = d.waypoints[i];
    if (_vKind(w) !== 'object') {
      errs.push(p + ': expected object, got ' + _vKind(w));
      continue;
    }
    _v(w, 'name', 'string', p, errs);
    _v(w, 'en',   'string', p, errs);
    _v(w, 'he',   'string', p, errs);
    _v(w, 'lat',  'number', p, errs);
    _v(w, 'lng',  'number', p, errs);
    // `report` is optional (chart reporting class). When present it must be
    // one of the two CVFR classes: 'mandatory' (חובה) or 'onRequest' (דרישה).
    if (Object.prototype.hasOwnProperty.call(w, 'report') &&
        w.report !== 'mandatory' && w.report !== 'onRequest') {
      errs.push(p + '.report: expected "mandatory" or "onRequest", got ' + _vKind(w.report));
    }
  }
  return errs.length ? errs.join('; ') : null;
}
// Strict schema for docs/data/vor.json — { vors:[{ ident, name, freq, lat, lng,
// he?, aipName?, type?, ch?, hours?, elevFt?, coverageNm?, remarks?, dmeOnly? }].
// The optional fields carry the published AIP ENR 4.1 detail (facility type, DME
// channel, hours, antenna elevation, coverage radius and limits). Unknown keys
// tolerated (forward-compat).
function validateVors(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  if (!_v(d, 'vors', 'array', 'root', errs)) return errs.join('; ');
  for (let i = 0; i < d.vors.length; i++) {
    const p = 'vors[' + i + ']';
    const v = d.vors[i];
    if (_vKind(v) !== 'object') {
      errs.push(p + ': expected object, got ' + _vKind(v));
      continue;
    }
    _v(v, 'ident', 'string', p, errs);
    _v(v, 'name',  'string', p, errs);
    _v(v, 'freq',  'string', p, errs);
    _v(v, 'lat',   'number', p, errs);
    _v(v, 'lng',   'number', p, errs);
    // Optional AIP detail — checked only when present.
    for (const k of ['aipName', 'type', 'ch', 'hours', 'remarks']) {
      if (v[k] !== undefined && typeof v[k] !== 'string') {
        errs.push(p + '.' + k + ': expected string, got ' + _vKind(v[k]));
      }
    }
    for (const k of ['elevFt', 'coverageNm']) {
      if (v[k] !== undefined && typeof v[k] !== 'number') {
        errs.push(p + '.' + k + ': expected number, got ' + _vKind(v[k]));
      }
    }
    if (v.dmeOnly !== undefined && typeof v.dmeOnly !== 'boolean') {
      errs.push(p + '.dmeOnly: expected boolean, got ' + _vKind(v.dmeOnly));
    }
  }
  return errs.length ? errs.join('; ') : null;
}
// Strict schema for docs/data/cvfr-comm-change.json — { version, source?,
// callSigns?: { ID:{ label?, he?, unit?, primary?, secondary?, alternate?,
// secondaryAlternate?, atis?, atisDeparture?, ground?, groundWest?,
// groundEast?, clearance?, appPrimary?, appSecondary?, tmaPrimary?,
// tmaSecondary?, phone?, source? } }, points:[{ name, commChange,
// callSigns?, routeHints?,
// note?, source? }] }. Optional routeHints entries are
// {before?, after?, callSign}, matching adjacent route waypoint names around
// the comm-change point to a call-sign ID. Only `points[].name` and
// `points[].commChange` are required for the renderer; everything else is
// metadata / inspector content. Unknown keys at any level are tolerated
// (forward-compat). Issue #399.
function validateCommChange(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  if (Object.prototype.hasOwnProperty.call(d, 'callSigns')) {
    if (_vKind(d.callSigns) !== 'object') {
      errs.push('root.callSigns: expected object, got ' + _vKind(d.callSigns));
    } else {
      for (const [id, cs] of Object.entries(d.callSigns)) {
        const p = 'callSigns.' + id;
        if (_vKind(cs) !== 'object') {
          errs.push(p + ': expected object, got ' + _vKind(cs));
          continue;
        }
        for (const k of ['label', 'he', 'unit', 'primary', 'secondary',
                         'alternate', 'secondaryAlternate', 'atis',
                         'atisDeparture', 'ground', 'groundWest',
                         'groundEast', 'clearance', 'appPrimary',
                         'appSecondary', 'tmaPrimary', 'tmaSecondary',
                         'phone', 'source']) {
          if (k in cs && typeof cs[k] !== 'string') {
            errs.push(p + '.' + k + ': expected string, got ' + _vKind(cs[k]));
          }
        }
      }
    }
  }
  if (!_v(d, 'points', 'array', 'root', errs)) return errs.join('; ');
  for (let i = 0; i < d.points.length; i++) {
    const p = 'points[' + i + ']';
    const pt = d.points[i];
    if (_vKind(pt) !== 'object') {
      errs.push(p + ': expected object, got ' + _vKind(pt));
      continue;
    }
    _v(pt, 'name', 'string', p, errs);
    if ('commChange' in pt && typeof pt.commChange !== 'boolean') {
      errs.push(p + '.commChange: expected boolean, got ' + _vKind(pt.commChange));
    }
    if ('callSigns' in pt) {
      if (!Array.isArray(pt.callSigns)) {
        errs.push(p + '.callSigns: expected array, got ' + _vKind(pt.callSigns));
      } else {
        for (let j = 0; j < pt.callSigns.length; j++) {
          if (typeof pt.callSigns[j] !== 'string') {
            errs.push(p + '.callSigns[' + j + ']: expected string, got ' + _vKind(pt.callSigns[j]));
          }
        }
      }
    }
    if ('routeHints' in pt) {
      if (!Array.isArray(pt.routeHints)) {
        errs.push(p + '.routeHints: expected array, got ' + _vKind(pt.routeHints));
      } else {
        for (let j = 0; j < pt.routeHints.length; j++) {
          const h = pt.routeHints[j];
          const hp = p + '.routeHints[' + j + ']';
          if (_vKind(h) !== 'object') {
            errs.push(hp + ': expected object, got ' + _vKind(h));
            continue;
          }
          for (const k of ['before', 'after', 'callSign']) {
            if (k in h && typeof h[k] !== 'string') {
              errs.push(hp + '.' + k + ': expected string, got ' + _vKind(h[k]));
            }
          }
          if (!h.callSign) {
            errs.push(hp + '.callSign: expected non-empty string, got ' + _vKind(h.callSign));
          }
        }
      }
    }
    for (const k of ['from', 'to', 'note', 'source']) {
      if (k in pt && typeof pt[k] !== 'string') {
        errs.push(p + '.' + k + ': expected string, got ' + _vKind(pt[k]));
      }
    }
  }
  return errs.length ? errs.join('; ') : null;
}

// Strict schema for docs/data/cvfr-leg-altitude.json — a reference table of
// green CVFR route-segment altitude pairs. Unknown metadata keys are allowed;
// the map behavior needs from/to + integer/null altitude fields, plus the
// optional directionPool must mirror those pairs when present.
function validateLegAltitudes(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  if (!_v(d, 'segments', 'array', 'root', errs)) return errs.join('; ');
  const seen = new Set();
  for (let i = 0; i < d.segments.length; i++) {
    const p = 'segments[' + i + ']';
    const segment = d.segments[i];
    if (_vKind(segment) !== 'object') {
      errs.push(p + ': expected object, got ' + _vKind(segment));
      continue;
    }
    _v(segment, 'from', 'string', p, errs);
    _v(segment, 'to', 'string', p, errs);
    if (Object.prototype.hasOwnProperty.call(segment, 'oneWay') &&
        typeof segment.oneWay !== 'boolean') {
      errs.push(p + '.oneWay: expected boolean, got ' + _vKind(segment.oneWay));
    }
    for (const key of ['inboundAltitude', 'outboundAltitude']) {
      if (!Object.prototype.hasOwnProperty.call(segment, key)) {
        errs.push(p + '.' + key + ': missing');
      } else if (segment[key] !== null &&
          (!Number.isInteger(segment[key]) || !Number.isFinite(segment[key]))) {
        errs.push(p + '.' + key + ': expected integer or null, got ' +
                  _vKind(segment[key]));
      }
    }
    if (typeof segment.from === 'string' && typeof segment.to === 'string') {
      if (!segment.from.trim() || !segment.to.trim()) {
        errs.push(p + ': from/to must be non-empty');
      } else if (segment.from === segment.to) {
        errs.push(p + ': from and to must differ');
      }
      const k = segment.from + '-' + segment.to;
      if (seen.has(k)) errs.push(p + ': duplicate segment ' + k);
      seen.add(k);
    }
    const nullCount = ['inboundAltitude', 'outboundAltitude']
      .filter(key => segment[key] === null).length;
    const status = typeof segment.status === 'string' ? segment.status : '';
    if (segment.oneWay === true) {
      if (nullCount !== 1) errs.push(p + ': oneWay segment must have exactly one null altitude');
    } else if (status === 'unknown') {
      if (nullCount !== 2) errs.push(p + ': unknown segment must have two null altitudes');
    } else if (nullCount) {
      errs.push(p + ': null altitude requires oneWay=true');
    }
  }
  if (Object.prototype.hasOwnProperty.call(d, 'directionPool')) {
    if (!Array.isArray(d.directionPool)) {
      errs.push('root.directionPool: expected array, got ' + _vKind(d.directionPool));
    } else {
      const expected = legAltitudeDirectionsFromSegments(d.segments || []);
      const expectedKeys = new Set(expected.map(dir =>
        [dir.from, dir.to, dir.altitude, dir.segment, dir.field].join('|')));
      const seenDirections = new Set();
      for (let i = 0; i < d.directionPool.length; i++) {
        const p = 'directionPool[' + i + ']';
        const dir = d.directionPool[i];
        if (_vKind(dir) !== 'object') {
          errs.push(p + ': expected object, got ' + _vKind(dir));
          continue;
        }
        for (const key of ['from', 'to', 'segment', 'field']) {
          _v(dir, key, 'string', p, errs);
        }
        if (!Object.prototype.hasOwnProperty.call(dir, 'altitude')) {
          errs.push(p + '.altitude: missing');
        } else if (!Number.isInteger(dir.altitude) || !Number.isFinite(dir.altitude)) {
          errs.push(p + '.altitude: expected integer, got ' + _vKind(dir.altitude));
        }
        const key = [dir.from, dir.to, dir.altitude, dir.segment, dir.field].join('|');
        if (seenDirections.has(key)) errs.push(p + ': duplicate direction ' + key);
        seenDirections.add(key);
        if (!expectedKeys.has(key)) errs.push(p + ': does not match segment altitude pair');
      }
      if (seenDirections.size !== expectedKeys.size) {
        errs.push('root.directionPool: expected ' + expectedKeys.size +
          ' directed entries, got ' + seenDirections.size);
      }
    }
  }
  return errs.length ? errs.join('; ') : null;
}

// Strict schema for docs/data/airfields.json — { airfields:[{ name, he, lat,
// lng, en?, elev_ft?, atis?, clearance?, plates?:[string], runways?:[string] }] }. Mirrors
// validateNavWaypoints; the loader in draw.js bails out with an alert that
// names the offending field path so the JSON author can find the typo.
// Extras at any level are silently allowed for forward-compat (issue #101).
//
// Issue #412: `en`, `elev_ft`, `atis`, `clearance`, `plates`, and `runways` are now OPTIONAL
// per-entry — the chart's published ARP list (#411) carries airfields whose
// BYOP plate / elevation / runway enrichment is not yet in the repo, and
// dropping them just because we don't have a plate folder yet would lose
// real waypoints. When present they're still strictly type-checked.
function validateAirfields(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  if (!_v(d, 'airfields', 'array', 'root', errs)) return errs.join('; ');
  for (let i = 0; i < d.airfields.length; i++) {
    const p = 'airfields[' + i + ']';
    const a = d.airfields[i];
    if (_vKind(a) !== 'object') {
      errs.push(p + ': expected object, got ' + _vKind(a));
      continue;
    }
    _v(a, 'name', 'string', p, errs);
    _v(a, 'he',   'string', p, errs);
    _v(a, 'lat',  'number', p, errs);
    _v(a, 'lng',  'number', p, errs);
    if (Object.prototype.hasOwnProperty.call(a, 'en')) {
      _v(a, 'en', 'string', p, errs);
    }
    if (Object.prototype.hasOwnProperty.call(a, 'elev_ft')) {
      _v(a, 'elev_ft', 'number', p, errs);
    }
    if (Object.prototype.hasOwnProperty.call(a, 'atis')) {
      _v(a, 'atis', 'string', p, errs);
    }
    if (Object.prototype.hasOwnProperty.call(a, 'clearance')) {
      _v(a, 'clearance', 'string', p, errs);
    }
    if (Object.prototype.hasOwnProperty.call(a, 'plates')) {
      if (_v(a, 'plates', 'array', p, errs)) {
        for (let j = 0; j < a.plates.length; j++) {
          if (typeof a.plates[j] !== 'string') {
            errs.push(p + '.plates[' + j + ']: expected string, got ' +
                      _vKind(a.plates[j]));
          }
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(a, 'runways')) {
      if (_v(a, 'runways', 'array', p, errs)) {
        for (let j = 0; j < a.runways.length; j++) {
          if (typeof a.runways[j] !== 'string') {
            errs.push(p + '.runways[' + j + ']: expected string, got ' +
                      _vKind(a.runways[j]));
          }
        }
      }
    }
  }
  return errs.length ? errs.join('; ') : null;
}

// --- save / load -----------------------------------------------------
// Per-leg label normaliser used by every route-ingest path (load() file
// import, restoreRoute() localStorage boot, decodeShareUrl() short URL).
// Pre-#393 blobs stored offsets in raw screen pixels at the save-time
// `legArrowSize`; the new render math multiplies stored offsets by
// `legZoomScale() = max(0.35, 2^(zoom-12)) * legArrowSize`, so an
// unmigrated raw value renders at legArrowSize^2 of the intended position.
// We normalise by dividing by `legacyArrowSize` exactly once — `_m: 1`
// stamps the result so re-saved blobs never re-migrate. `legacyArrowSize`
// should be the size the file was *saved* under; if the file does not
// carry that field we fall back to the current `legArrowSize` (which
// matches the user's current display environment — the safest default
// per the PR-review #3 recommendation).
function _normalizeLegLabel(raw, legacyArrowSize) {
  if (!raw) return raw;
  if (raw._m) {
    // Already-migrated label. Preserve the `_default: 1` sentinel
    // (issue #394) so the renderer keeps computing the drift-aware
    // perpendicular at draw time; everything else round-trips as the
    // size-independent `{ a, p }` pair PR #393 introduced.
    const out = { a: raw.a, _m: 1 };
    if (raw._default) out._default = 1;
    else out.p = raw.p;
    return out;
  }
  const k = (typeof legacyArrowSize === 'number' && legacyArrowSize > 0)
    ? legacyArrowSize : 1;
  return { a: raw.a / k, p: raw.p / k, _m: 1 };
}
function routeCommChangeSuppressions(raw) {
  if (typeof normalizeCommChangeSuppressions === 'function') {
    return normalizeCommChangeSuppressions(raw).slice();
  }
  return Array.isArray(raw) ? raw.slice() :
    (Array.isArray(state.commChangeSuppressions) ? state.commChangeSuppressions.slice() : []);
}
function storedCommChangeSuppressions(raw) {
  return raw && Object.prototype.hasOwnProperty.call(raw, 'commChangeSuppressions')
    ? routeCommChangeSuppressions(raw.commChangeSuppressions) : [];
}
function encodeRouteAltitude(v) {
  return Number.isNaN(v) ? 'NaN' : v;
}
function decodeRouteAltitude(v) {
  return v === 'NaN' || v === null ? NaN : v;
}
function encodeRouteLegAltitudes(l) {
  return {
    ...l,
    inboundAltitude: encodeRouteAltitude(l.inboundAltitude),
    outboundAltitude: encodeRouteAltitude(l.outboundAltitude),
  };
}
function altitudeMetersForExport(ft, fallbackFt = 0) {
  const v = Number.isFinite(ft) ? ft : fallbackFt;
  return Math.max(0, Math.round(v * 0.3048));
}
// Clean copy of a wind object ({ dir, speed }, both optional) for
// serialization — drops anything non-numeric. Returns undefined when empty.
function encodeWind(w) {
  if (!w || typeof w !== 'object') return undefined;
  const out = {};
  if (Number.isFinite(w.dir))   out.dir   = w.dir;
  if (Number.isFinite(w.speed)) out.speed = w.speed;
  return (out.dir !== undefined || out.speed !== undefined) ? out : undefined;
}
// Route-wide wind from a stored blob — sanitized, with the calm default.
function storedWind(d) {
  const w = d && d.wind;
  if (w && Number.isFinite(w.dir) && Number.isFinite(w.speed) && w.speed >= 0) {
    return { dir: ((Math.round(w.dir) % 360) + 360) % 360,
             speed: Math.round(w.speed) };
  }
  return { dir: 270, speed: 0 };
}
function routeSnapshotForStorage() {
  const wind = encodeWind(state.wind);
  return {
    waypoints: state.waypoints,
    legs: state.legs.map(l => {
      const enc = encodeRouteLegAltitudes(l);     // spreads ...l (incl. wind)
      const w = encodeWind(l.wind);
      if (w) enc.wind = w; else delete enc.wind;  // drop junk overrides
      return enc;
    }),
    notes: state.notes,
    commChangeSuppressions: routeCommChangeSuppressions(),
    ...(wind && wind.speed > 0 ? { wind } : {}),
    // The route's altitude-layer pin travels with undo/session snapshots so
    // an undone or reloaded route keeps deriving from its original layer
    // instead of re-pinning to whichever layer happens to be displayed.
    ...(routeAltPrefix ? { altPin: routeAltPrefix } : {}),
    ...(currentMapBearing() ? { bearing: currentMapBearing() } : {}),
  };
}
// Serializable, schema-clean snapshot of the current route. Shared by the
// JSON file export (save), the route library (#677), and any other route
// persistence — keep this the single source of the on-disk route shape.
function serializeRoute() {
  const commChangeSuppressions = routeCommChangeSuppressions();
  const data = {
    waypoints: state.waypoints.map(w => ({
      lat: r5(w.lat), lng: r5(w.lng), name: w.name || '',
    })),
    legs: state.legs.map(l => ({
      inboundAltitude: encodeRouteAltitude(l.inboundAltitude),
      outboundAltitude: encodeRouteAltitude(l.outboundAltitude),
      flightSpeed: l.flightSpeed,
      outboundSpeed: l.outboundSpeed,
      inLabel: l.inLabel,
      outLabel: l.outLabel,
      ...(l.cumLabel ? { cumLabel: l.cumLabel } : {}),
      ...(l.cumLabelRet ? { cumLabelRet: l.cumLabelRet } : {}),
      ...(encodeWind(l.wind) ? { wind: encodeWind(l.wind) } : {}),
    })),
    notes: state.notes.map(n => ({
      lat: r5(n.lat), lng: r5(n.lng), text: n.text || '', color: n.color || '',
      shape: n.shape || 'rect',
      ...(n.cc ? { cc: n.cc } : {}),   // #487: preserve comm-change seed tag
      ...(n.freqName ? { freqName: n.freqName } : {}),
      ...(n.freq ? { freq: n.freq } : {}),
      ...(n.freqAuto === true ? { freqAuto: true } : {}),
      ...(Number.isFinite(n.size) && n.size !== 1 ? { size: n.size } : {}),
      ...(n.rp && Number.isInteger(n.rp.leg) ? { rp: { leg: n.rp.leg, t: r5(n.rp.t) } } : {}),
    })),
  };
  if (commChangeSuppressions.length) data.commChangeSuppressions = commChangeSuppressions;
  const wind = encodeWind(state.wind);
  if (wind && wind.speed > 0) data.wind = wind;     // calm = omit (#722)
  const bearing = currentMapBearing();
  if (bearing) data.bearing = bearing;              // north-up = 0 = omit
  return data;
}
// Map rotation (leaflet-rotate), normalised to [0,360) and rounded to a whole
// degree — saved with the route so a loaded route restores its orientation.
function currentMapBearing() {
  if (typeof map === 'undefined' || !map.getBearing) return 0;
  const b = Math.round(map.getBearing() || 0);
  return ((b % 360) + 360) % 360;
}
function applyMapBearing(d) {
  if (typeof map === 'undefined' || !map.setBearing) return;
  const b = d && Number.isFinite(d.bearing) ? (((Math.round(d.bearing) % 360) + 360) % 360) : 0;
  try { map.setBearing(b); } catch (e) { /* rotate plugin absent */ }
}
function save() {
  const data = serializeRoute();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = routeFileSlug() + '-' + fileStamp() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);   // revoking synchronously after click can abort the download (Firefox/Safari)
}

// --- GPX export --------------------------------------------------------
function exportGpx() {
  if (state.waypoints.length < 2) {
    alert(S.errNeedWps);
    return;
  }
  const wps = state.waypoints;
  const esc = s => String(s).replace(/[<>&]/g,
    c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const altM = i => {
    const leg = state.legs[Math.min(i, state.legs.length - 1)];
    return altitudeMetersForExport(leg ? leg.inboundAltitude : 2000, leg ? 0 : 2000);
  };
  let rtepts = '';
  for (let i = 0; i < wps.length; i++) {
    const name = esc(wpLabel(i));
    rtepts += '    <rtept lat="' + wps[i].lat + '" lon="' + wps[i].lng + '">\n' +
      '      <name>' + name + '</name>\n' +
      '      <ele>' + altM(i) + '</ele>\n' +
      '    </rtept>\n';
  }
  const gpx =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx xmlns="http://www.topografix.com/GPX/1/1"\n' +
    '     version="1.1"\n' +
    '     creator="NavAid"\n' +
    '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
    '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n' +
    '  <rte>\n' +
    '    <name>NavAid route</name>\n' +
    rtepts +
    '  </rte>\n' +
    '</gpx>\n';
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = routeFileSlug() + '-' + fileStamp() + '.gpx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);   // defer: see save()
}

// --- PLN export (MSFS / FSX flight plan) -------------------------------
// Degrees-minutes-seconds with hemisphere, e.g. N32° 0' 41.40" — the format
// FSX/MSFS expects in <WorldPosition> and the *LLA fields.
function fsxLatLngAlt(lat, lng, altFt) {
  const dms = (v, pos, neg) => {
    const hemi = v >= 0 ? pos : neg;
    v = Math.abs(v);
    let d = Math.floor(v);
    let m = Math.floor((v - d) * 60);
    let s = Math.round((((v - d) * 60 - m) * 60) * 100) / 100;
    // Carry rounded seconds/minutes so we never emit 60.00" or 60'.
    if (s >= 60) { s -= 60; m += 1; }
    if (m >= 60) { m -= 60; d += 1; }
    return hemi + d + '° ' + m + "' " + s.toFixed(2) + '"';
  };
  const a = Math.max(0, Math.round(Number.isFinite(altFt) ? altFt : 0));
  const altStr = '+' + String(a).padStart(6, '0') + '.00';
  return dms(lat, 'N', 'S') + ',' + dms(lng, 'E', 'W') + ',' + altStr;
}
function exportPln() {
  if (state.waypoints.length < 2) {
    alert(S.errNeedWps);
    return;
  }
  const wps = state.waypoints;
  const esc = s => String(s).replace(/[<>&"]/g,
    c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // FSX waypoint ids must be free of spaces / punctuation.
  const idOf = i => (wpLabel(i).replace(/[^A-Za-z0-9]/g, '').toUpperCase() ||
    ('WP' + (i + 1))).slice(0, 12);
  const altFt = i => {
    const leg = state.legs[Math.min(i, state.legs.length - 1)];
    return Number.isFinite(leg && leg.inboundAltitude) ? leg.inboundAltitude : 2000;
  };
  const firstAlt = altFt(0);
  let pts = '';
  for (let i = 0; i < wps.length; i++) {
    const isAf = typeof isAirport === 'function' && isAirport(wps[i]);
    pts +=
      '        <ATCWaypoint id="' + esc(idOf(i)) + '">\n' +
      '            <ATCWaypointType>' + (isAf ? 'Airport' : 'User') + '</ATCWaypointType>\n' +
      '            <WorldPosition>' + fsxLatLngAlt(wps[i].lat, wps[i].lng, altFt(i)) + '</WorldPosition>\n' +
      '            <ICAO>\n' +
      '                <ICAOIdent>' + esc(idOf(i)) + '</ICAOIdent>\n' +
      '            </ICAO>\n' +
      '        </ATCWaypoint>\n';
  }
  const depId = esc(idOf(0));
  const destId = esc(idOf(wps.length - 1));
  const title = depId + ' to ' + destId;
  const pln =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<SimBase.Document Type="AceXML" version="1,0">\n' +
    '    <Descr>AceXML Document</Descr>\n' +
    '    <FlightPlan.FlightPlan>\n' +
    '        <Title>' + title + '</Title>\n' +
    '        <FPType>VFR</FPType>\n' +
    '        <CruisingAlt>' + Math.round(firstAlt) + '</CruisingAlt>\n' +
    '        <DepartureID>' + depId + '</DepartureID>\n' +
    '        <DepartureLLA>' + fsxLatLngAlt(wps[0].lat, wps[0].lng, altFt(0)) + '</DepartureLLA>\n' +
    '        <DestinationID>' + destId + '</DestinationID>\n' +
    '        <DestinationLLA>' +
      fsxLatLngAlt(wps[wps.length - 1].lat, wps[wps.length - 1].lng, altFt(wps.length - 1)) +
      '</DestinationLLA>\n' +
    '        <Descr>NavAid route</Descr>\n' +
    '        <DepartureName>' + depId + '</DepartureName>\n' +
    '        <DestinationName>' + destId + '</DestinationName>\n' +
    '        <AppVersion>\n' +
    '            <AppVersionMajor>12</AppVersionMajor>\n' +
    '            <AppVersionBuild>282174</AppVersionBuild>\n' +
    '        </AppVersion>\n' +
    pts +
    '    </FlightPlan.FlightPlan>\n' +
    '</SimBase.Document>\n';
  const blob = new Blob([pln], { type: 'application/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = routeFileSlug() + '-' + fileStamp() + '.pln';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);   // defer: see save()
}

// --- X-Plane FDR export (issue #701) ----------------------------------------
// Exports the route as an X-Plane Flight Data Recorder replay file.
// Each leg is sampled at 1-second intervals; position is linearly interpolated
// along the leg, altitude blends smoothly between legs, and roll/pitch/VVI
// are computed from turn-rate and climb-rate geometry.
//
// X-Plane 12 FDR version 3 (the 'A'/'3' header) uses the COMPACT, positional
// DATA order — confirmed by X-Plane's parser, which reads the heading from the
// 5th value:
//   1 time s, 2 longitude, 3 latitude, 4 altitude MSL ft, 5 heading true,
//   6 pitch deg, 7 roll deg
// (The 80-column layout — time,temp,lon,lat,h_msl,… — is the old V2/legacy
// format X-Plane 12 rejects as "Old, non-supported FDR format"; putting those
// columns under a V3 header made it read altitude as heading: "Out of range
// FDR-file heading … 2000".)
function fdrDataRow(time, lon, lat, hmsl, hdg, pitch, roll) {
  return [
    time.toFixed(2),
    lon.toFixed(6),
    lat.toFixed(6),
    hmsl.toFixed(1),     // altitude MSL (ft)
    hdg.toFixed(2),      // heading (degrees true)
    pitch.toFixed(2),
    roll.toFixed(2),
  ].join(',');
}
function exportFdr() {
  if (state.waypoints.length < 2) { alert(S.errNeedWps); return; }

  const DEG = Math.PI / 180;
  // Degrees between two headings via shortest angular path (returns ±deg).
  function angleDiff(a, b) {
    let d = ((b - a) % 360 + 360) % 360;
    return d > 180 ? d - 360 : d;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  const KT_TO_MS = 0.514444;
  const M_TO_FT  = 3.280840;
  const G        = 9.80665;
  const BANK     = 18 * DEG;          // bank angle the turns are flown at
  // Local equirectangular projection (metres) around the first waypoint —
  // accurate over a CVFR route's span; turns are computed as real arcs here.
  const wp0 = state.waypoints[0];
  const mPerLat = 110540;
  const mPerLng = 111320 * Math.cos(wp0.lat * DEG);
  const toXY = w => ({ x: (w.lng - wp0.lng) * mPerLng, y: (w.lat - wp0.lat) * mPerLat });
  const toLL = p => ({ lng: wp0.lng + p.x / mPerLng, lat: wp0.lat + p.y / mPerLat });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  const hyp = a => Math.hypot(a.x, a.y);
  const norm = a => { const m = hyp(a) || 1; return { x: a.x / m, y: a.y / m }; };

  // Per-leg metres geometry + cruise speed/altitude.
  const W = state.waypoints.map(toXY);
  const leg = state.legs.map((l, i) => ({
    spdMS: Math.max(1, (l.flightSpeed || 90)) * KT_TO_MS,
    alt: Number.isFinite(l.inboundAltitude) ? l.inboundAltitude : 2000,
    len: hyp(sub(W[i + 1], W[i])),
  }));

  // Build the flown path as a dense metres polyline, rounding each interior
  // waypoint with a banked-turn arc (radius R = V²/(g·tanφ)). Each point
  // carries the speed/altitude that applies there.
  const path = [{ p: W[0], spdMS: leg[0].spdMS, alt: leg[0].alt }];
  for (let k = 1; k < W.length - 1; k++) {
    const uin  = norm(sub(W[k], W[k - 1]));
    const uout = norm(sub(W[k + 1], W[k]));
    const dot  = Math.max(-1, Math.min(1, uin.x * uout.x + uin.y * uout.y));
    const theta = Math.acos(dot);                       // turn angle (rad)
    const sIn = leg[k - 1].spdMS, sOut = leg[k].spdMS;
    if (theta < 0.5 * DEG) {                             // ~straight — no arc
      path.push({ p: W[k], spdMS: sOut, alt: leg[k].alt });
      continue;
    }
    const vTurn = Math.min(sIn, sOut);                  // fly the turn at the slower speed
    let R = (vTurn * vTurn) / (G * Math.tan(BANK));
    let d = R * Math.tan(theta / 2);                    // tangent distance from the vertex
    const dMax = 0.45 * Math.min(leg[k - 1].len, leg[k].len);
    if (d > dMax) { d = dMax; R = d / Math.tan(theta / 2); }
    const tIn  = sub(W[k], mul(uin, d));
    const tOut = add(W[k], mul(uout, d));
    const cross = uin.x * uout.y - uin.y * uout.x;       // >0 left turn, <0 right
    const left = cross > 0;
    const nIn = left ? { x: -uin.y, y: uin.x } : { x: uin.y, y: -uin.x };
    const center = add(tIn, mul(nIn, R));
    const a0 = Math.atan2(tIn.y - center.y, tIn.x - center.x);
    const sweep = left ? theta : -theta;
    const steps = Math.max(2, Math.ceil(theta / (3 * DEG)));   // ~3° per arc point
    path.push({ p: tIn, spdMS: vTurn, alt: leg[k - 1].alt });
    for (let s = 1; s <= steps; s++) {
      const ang = a0 + sweep * (s / steps);
      const p = { x: center.x + R * Math.cos(ang), y: center.y + R * Math.sin(ang) };
      path.push({ p, spdMS: vTurn, alt: lerp(leg[k - 1].alt, leg[k].alt, s / steps) });
    }
    // tOut == last arc point; continue the straight from there.
    void tOut;
  }
  const lastLeg = leg[leg.length - 1];
  path.push({ p: W[W.length - 1], spdMS: lastLeg.spdMS, alt: lastLeg.alt });

  // Cumulative travel time along the polyline (constant speed per segment).
  const tcum = [0];
  for (let i = 1; i < path.length; i++) {
    const ds = hyp(sub(path[i].p, path[i - 1].p));
    const v = 0.5 * (path[i].spdMS + path[i - 1].spdMS) || 1;
    tcum.push(tcum[i - 1] + ds / v);
  }
  const totalT = tcum[tcum.length - 1];

  // Resample the path at 1-second intervals (position + altitude).
  const samp = [];
  let seg = 1;
  for (let tt = 0; tt <= totalT; tt += 1) {
    while (seg < path.length - 1 && tcum[seg] < tt) seg++;
    const t0 = tcum[seg - 1], t1 = tcum[seg];
    const f = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
    const p = { x: lerp(path[seg - 1].p.x, path[seg].p.x, f),
                y: lerp(path[seg - 1].p.y, path[seg].p.y, f) };
    samp.push({ p, alt: lerp(path[seg - 1].alt, path[seg].alt, f) });
  }
  if (samp.length < 2) samp.push({ p: W[W.length - 1], alt: lastLeg.alt });
  // Smooth altitude (±20 s moving average) so climbs/descents are gradual.
  const altS = samp.map((s, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 20); j <= Math.min(samp.length - 1, i + 20); j++) { sum += samp[j].alt; n++; }
    return sum / n;
  });

  // Heading from the path tangent; roll from turn rate; pitch from climb rate.
  const rows = [];
  for (let i = 0; i < samp.length; i++) {
    const a = samp[Math.max(0, i - 1)].p, b = samp[Math.min(samp.length - 1, i + 1)].p;
    const dx = b.x - a.x, dy = b.y - a.y;
    const hdg = ((Math.atan2(dx, dy) / DEG) % 360 + 360) % 360;   // true bearing
    const ll = toLL(samp[i].p);
    // roll: tan(bank) = ω·V/g, ω = heading rate (rad/s), sign by turn direction.
    let roll = 0;
    if (i > 0 && i < samp.length - 1) {
      const a2 = samp[i - 1].p, b2 = samp[i + 1].p;
      const h0 = Math.atan2(samp[i].p.x - a2.x, samp[i].p.y - a2.y) / DEG;
      const h1 = Math.atan2(b2.x - samp[i].p.x, b2.y - samp[i].p.y) / DEG;
      const rate = angleDiff(h0, h1) * DEG;                 // rad/s
      const ds = hyp(sub(b2, a2)) / 2;                       // m/s
      roll = Math.atan((rate * ds) / G) / DEG;
    }
    // pitch from vertical vs horizontal speed.
    const vfps = i < samp.length - 1 ? (altS[i + 1] - altS[i]) / M_TO_FT : 0;   // m/s up (alt in ft)
    const gs = i < samp.length - 1 ? hyp(sub(samp[i + 1].p, samp[i].p)) : 1;     // m/s
    const pitch = Math.atan2(vfps, gs || 1) / DEG;
    rows.push(fdrDataRow(i, ll.lng, ll.lat, altS[i], hdg, pitch, roll));
  }

  const lastWp = state.waypoints[state.waypoints.length - 1];
  const dep  = (state.waypoints[0].name || 'DEP').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,8);
  const dest = (lastWp.name || 'DEST').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,8);

  // X-Plane 12 FDR V3: 'A' line-ending marker, version '3', then keyword header
  // lines (TAIL must immediately follow ACFT), then one compact 'DATA,' row per
  // sample (see fdrDataRow). X-Plane 12 rejects the old header-less / V2 layout
  // as "Old, non-supported FDR format", so the version line is required.
  const now = new Date();
  const dateStr = String(now.getMonth()+1).padStart(2,'0') + '/' +
                  String(now.getDate()).padStart(2,'0') + '/' + now.getFullYear();
  const timeStr = String(now.getUTCHours()).padStart(2,'0') + ':' +
                  String(now.getUTCMinutes()).padStart(2,'0') + ':' +
                  String(now.getUTCSeconds()).padStart(2,'0');
  const fdrRows = rows.map(r => 'DATA, ' + r);
  // No ACFT line: its path must resolve to an installed aircraft or X-Plane
  // errors ("unknown aircraft"). Omitting it replays on the currently-loaded
  // aircraft, which is robust across installs / X-Plane versions.
  const fdr = [
    'A',
    '3',
    '',
    'TAIL, NAVAID',
    'DATE, ' + dateStr,
    'TIME, ' + timeStr,
    'PRES, 29.92',
    'TEMP, 15',
    'WIND, 0,0',
    'COMM, NavAid CVFR route — ' + dep + ' to ' + dest,
    '',
    ...fdrRows,
    '',
  ].join('\n');

  const blob = new Blob([fdr], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = routeFileSlug() + '-' + fileStamp() + '.fdr';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);   // defer: see save()
}

// --- GPX import --------------------------------------------------------
function loadGpx(file) {
  const MAX_ROUTE_BYTES = 2 * 1024 * 1024;
  if (file && file.size > MAX_ROUTE_BYTES) {
    alert(S.errLoadFile + 'file too large (' +
          (file.size / 1024 / 1024).toFixed(1) + ' MB; max 2 MB)');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const xml = new DOMParser().parseFromString(reader.result, 'text/xml');
      const parseErr = xml.querySelector('parsererror');
      if (parseErr) throw new Error('XML parse error: ' + parseErr.textContent);
      const rtepts = xml.querySelectorAll('rtept');
      if (!rtepts.length) {
        alert(S.errLoadFile + 'no <rtept> elements found in GPX');
        return;
      }
      const wps = [];
      for (const pt of rtepts) {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lng = parseFloat(pt.getAttribute('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const name = (pt.querySelector('name') || {}).textContent || '';
        wps.push({ lat: r5(lat), lng: r5(lng), name: name.trim() });
      }
      if (wps.length < 2) {
        alert(S.errNeedWps);
        return;
      }
      routeAltPrefix = null;   // replacing the route unpins its altitude layer
      currentRouteLibraryId = null;   // decoded/imported route is not a saved entry
      state.waypoints = wps;
      state.legs = [];
      state.notes = [];
      state.commChangeSuppressions = [];
      state.wind = { dir: 270, speed: 0 };   // imported route carries no route-wide wind — don't inherit the previous route's
      syncLegs();
      state.selected = null;
      showInspector();
      fitView();
      draw();
    } catch (err) {
      alert(S.errLoadFile + err.message);
    }
  };
  reader.readAsText(file);
}

// --- PLN import (MSFS / FSX flight plan) -------------------------------
// Parse a DMS WorldPosition / *LLA value, e.g. N32° 0' 42.12",E34° 53' 7.08"
// (an optional ,+002000.00 altitude tail is ignored). Also accepts a plain
// "lat,lng" decimal pair as a fallback.
function parsePlnLatLng(s) {
  if (!s) return null;
  const dms = String(s).match(
    /([NS])\s*(\d+(?:\.\d+)?)°\s*(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"?\s*,\s*([EW])\s*(\d+(?:\.\d+)?)°\s*(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"?/);
  if (dms) {
    const lat = (+dms[2] + +dms[3] / 60 + +dms[4] / 3600) * (dms[1] === 'S' ? -1 : 1);
    const lng = (+dms[6] + +dms[7] / 60 + +dms[8] / 3600) * (dms[5] === 'W' ? -1 : 1);
    return { lat, lng };
  }
  const dec = String(s).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (dec) return { lat: parseFloat(dec[1]), lng: parseFloat(dec[2]) };
  return null;
}
function loadPln(file) {
  const MAX_ROUTE_BYTES = 2 * 1024 * 1024;
  if (file && file.size > MAX_ROUTE_BYTES) {
    alert(S.errLoadFile + 'file too large (' +
          (file.size / 1024 / 1024).toFixed(1) + ' MB; max 2 MB)');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const xml = new DOMParser().parseFromString(reader.result, 'text/xml');
      const parseErr = xml.querySelector('parsererror');
      if (parseErr) throw new Error('XML parse error: ' + parseErr.textContent);
      const atc = xml.querySelectorAll('ATCWaypoint');
      if (!atc.length) {
        alert(S.errLoadFile + 'no <ATCWaypoint> elements found in PLN');
        return;
      }
      const wps = [];
      for (const pt of atc) {
        const posEl = pt.querySelector('WorldPosition');
        const pos = parsePlnLatLng(posEl && posEl.textContent);
        if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) continue;
        const icao = pt.querySelector('ICAOIdent');
        const name = (icao && icao.textContent.trim()) ||
          (pt.getAttribute('id') || '').trim();
        wps.push({ lat: r5(pos.lat), lng: r5(pos.lng), name });
      }
      if (wps.length < 2) {
        alert(S.errNeedWps);
        return;
      }
      routeAltPrefix = null;   // replacing the route unpins its altitude layer
      currentRouteLibraryId = null;   // decoded/imported route is not a saved entry
      state.waypoints = wps;
      state.legs = [];
      state.notes = [];
      state.commChangeSuppressions = [];
      state.wind = { dir: 270, speed: 0 };   // imported route carries no route-wide wind — don't inherit the previous route's
      syncLegs();
      state.selected = null;
      showInspector();
      fitView();
      draw();
    } catch (err) {
      alert(S.errLoadFile + err.message);
    }
  };
  reader.readAsText(file);
}

function load(file) {
  // #146: hard cap on file size before we even read it. Route JSON is
  // typically <100 KB; 2 MB leaves room for big routes / future fields and
  // still aborts a user mis-pick (e.g. a PDF / image) instantly.
  const MAX_ROUTE_BYTES = 2 * 1024 * 1024;
  if (file && file.size > MAX_ROUTE_BYTES) {
    alert(S.errLoadFile + 'file too large (' +
          (file.size / 1024 / 1024).toFixed(1) + ' MB; max 2 MB)');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let d;
    try {
      d = JSON.parse(reader.result);
    } catch (err) {
      alert(S.errLoadFile + err.message);
      return;
    }
    // Strict schema check before applying any state — issue #101. Any
    // missing / mistyped field bails out with a field-path-naming alert
    // so the JSON author can find the typo. Extras are silently allowed.
    const verr = validateRoute(d);
    if (verr) {
      alert(S.errInvalidRoute(verr));
      return;
    }
    applyRouteData(d);
  };
  reader.readAsText(file);
}

// Apply a parsed, validated route blob (the shape serializeRoute() emits) to
// the live state and redraw. Shared by file import (load) and the route
// library (#677). Caller is responsible for validateRoute() first.
function applyRouteData(d) {
  routeAltPrefix = null;    // replacing the route unpins its altitude layer
  currentRouteLibraryId = null;   // default: loaded route isn't a library entry
                                  // (routeLibraryApply re-sets it right after)
  state.waypoints = d.waypoints.map(w => ({
    lat: r5(w.lat), lng: r5(w.lng), name: w.name,
  }));
  // Use the blob's `legArrowSize` if present (forward-compat — current
  // serializeRoute() doesn't emit it). Otherwise fall back to the current
  // setting. See _normalizeLegLabel for the migration math.
  const legacyAS = (typeof d.legArrowSize === 'number' && d.legArrowSize > 0)
    ? d.legArrowSize : legArrowSize;
  state.legs = d.legs.map(l => ({
    inboundAltitude: decodeRouteAltitude(l.inboundAltitude),
    outboundAltitude: decodeRouteAltitude(l.outboundAltitude),
    flightSpeed: l.flightSpeed,
    outboundSpeed: l.outboundSpeed != null ? l.outboundSpeed : l.flightSpeed,
    inLabel:  _normalizeLegLabel(l.inLabel,  legacyAS),
    outLabel: _normalizeLegLabel(l.outLabel, legacyAS),
    cumLabel: l.cumLabel ? _normalizeLegLabel(l.cumLabel, legacyAS)
                         : { a: 0, _default: 1, _m: 1 },
    cumLabelRet: l.cumLabelRet ? _normalizeLegLabel(l.cumLabelRet, legacyAS)
                               : { a: 0, _default: 1, _m: 1 },
    ...(encodeWind(l.wind) ? { wind: encodeWind(l.wind) } : {}),
  }));
  state.notes = d.notes.map(n => ({
    lat: r5(n.lat), lng: r5(n.lng),
    text: n.text, color: n.color, shape: n.shape,
    ...(n.cc ? { cc: n.cc } : {}),   // #487: preserve comm-change seed tag
    ...(n.freqName ? { freqName: n.freqName } : {}),
    ...(n.freq ? { freq: n.freq } : {}),
    ...(n.freqAuto === true ? { freqAuto: true } : {}),
    ...(Number.isFinite(n.size) && n.size !== 1 ? { size: n.size } : {}),
    ...(n.rp && Number.isInteger(n.rp.leg)
      ? { rp: { leg: n.rp.leg, t: Number.isFinite(n.rp.t) ? n.rp.t : 0.5 } } : {}),
  }));
  state.commChangeSuppressions = storedCommChangeSuppressions(d);
  state.wind = storedWind(d);
  if (typeof window.refreshWindInputs === 'function') window.refreshWindInputs();
  syncLegs();
  state.selected = null;
  showInspector();
  fitView();
  applyMapBearing(d);            // restore the saved map orientation
  draw();
}

// --- route library (#677) — multiple named routes in localStorage --------
// Device-local only (no backend). Each entry: { id, name, savedAt, data }
// where `data` is a serializeRoute() blob.
const ROUTE_LIBRARY_KEY = 'navaid.routes';
// A corrupt (unparseable / non-array) library blob must not be treated as an
// empty library: save / import / GPS-save would then persist [] over it and
// silently erase the user's raw saved routes. Mirror the main route store's
// #73 protection — preserve the raw blob, flag it, and block writes until the
// user recovers (export raw) or explicitly clears it (persist with force).
function loadRouteLibrary() {
  const raw = localStorage.getItem(ROUTE_LIBRARY_KEY);
  if (raw == null || raw === '') { NavAid.routeLibraryCorrupt = false; return []; }
  try {
    const a = JSON.parse(raw);
    if (Array.isArray(a)) { NavAid.routeLibraryCorrupt = false; return a; }
    NavAid.routeLibraryCorruptError = 'saved-route library is not an array';
  } catch (e) {
    NavAid.routeLibraryCorruptError = e && e.message ? e.message : 'parse error';
  }
  NavAid.routeLibraryCorrupt = true;
  NavAid.routeLibraryCorruptRaw = raw;   // keep the raw blob for export/recovery
  return [];
}
function persistRouteLibrary(list, opts) {
  // Refuse to overwrite a corrupt blob with a list derived from the empty
  // fallback — that is the silent data loss. A deliberate recovery/clear from
  // the Saved routes menu passes { force: true }.
  if (NavAid.routeLibraryCorrupt && !(opts && opts.force)) {
    try {
      alert(S.errRouteLibraryCorrupt ||
        'Your saved-route library is corrupted and could not be read. Export or clear it from the Saved routes menu before saving new routes.');
    } catch (_) { /* alert blocked */ }
    return false;
  }
  try {
    localStorage.setItem(ROUTE_LIBRARY_KEY, JSON.stringify(list));
    NavAid.routeLibraryCorrupt = false;   // a successful write clears the flag
    scheduleRouteAutoSync();
    return true;
  } catch (e) {
    alert(S.errStorageFull || 'Storage is full — delete some saved routes or export them.');
    return false;
  }
}
// Auto-push the library to Google Drive (debounced) after any local change,
// but only when Drive is connected. Suppressed while a sync is itself writing
// the merged result back (window._navaidSyncing) so we don't loop.
let _routeAutoSyncTimer = null;
function scheduleRouteAutoSync() {
  if (window._navaidSyncing) return;
  if (typeof gdriveConnected !== 'function' || !gdriveConnected()) return;
  if (_routeAutoSyncTimer) clearTimeout(_routeAutoSyncTimer);
  _routeAutoSyncTimer = setTimeout(function () {
    _routeAutoSyncTimer = null;
    if (typeof gdriveSync !== 'function') return;
    gdriveSync().then(function () {
      if (typeof window.refreshRouteLibrary === 'function') window.refreshRouteLibrary();
    }).catch(function () { /* offline / token expired — next change retries */ });
  }, 1500);
}
function routeLibraryId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
// Default name for a manually-saved route: "Saved - YYYY-MM-DD HH:MM".
function defaultSavedRouteName() {
  // Prefer "first → last" waypoint names (localised via navName); fall back to
  // a timestamp for unnamed/off-grid endpoints.
  const wps = state.waypoints;
  if (wps && wps.length >= 2) {
    const nm = (w) => {
      const raw = (w && w.name) ? w.name : '';
      const disp = (raw && typeof navName === 'function') ? navName(raw) : raw;
      return (disp || '').toString().trim();
    };
    const a = nm(wps[0]);
    const b = nm(wps[wps.length - 1]);
    // Point the arrow the reading direction: LTR "first → last", RTL (Hebrew
    // reads right-to-left, so the destination sits on the left) "first ← last".
    const he = (typeof currentUiLang === 'function')
      ? currentUiLang() === 'he' : (window.__navLang === 'he');
    if (a && b) return a + (he ? ' ← ' : ' → ') + b;
    if (a || b) return a || b;
  }
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return 'Saved - ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
       + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// Save the current route as a new named library entry. Returns the entry or null.
function routeLibrarySaveCurrent(name) {
  if (state.waypoints.length < 2) { alert(S.errNeedWps); return null; }
  const list = loadRouteLibrary();
  const entry = {
    id: routeLibraryId(),
    name: (name || '').trim() || defaultSavedRouteName(),
    savedAt: new Date().toISOString(),
    data: serializeRoute(),
  };
  list.unshift(entry);
  if (!persistRouteLibrary(list)) return null;
  currentRouteLibraryId = entry.id;   // this route is now tracked as a saved entry
  return entry;
}
// Overwrite an existing library entry's route with the current one (update in
// place), bumping savedAt so the change wins the Drive merge. Keeps the id and
// name. Returns the updated entry or null.
function routeLibraryUpdate(id) {
  if (state.waypoints.length < 2) { alert(S.errNeedWps); return null; }
  const list = loadRouteLibrary();
  const entry = list.find(x => x && x.id === id && !x.deleted);
  if (!entry) return null;
  entry.savedAt = new Date().toISOString();
  entry.data = serializeRoute();
  if (!persistRouteLibrary(list)) return null;
  currentRouteLibraryId = entry.id;   // now the active saved entry
  return entry;
}
// Apply a saved library entry to the live route. Returns true if applied.
function routeLibraryApply(entry) {
  if (!entry || !entry.data) return false;
  const verr = typeof validateRoute === 'function' ? validateRoute(entry.data) : null;
  if (verr) { alert(S.errInvalidRoute ? S.errInvalidRoute(verr) : verr); return false; }
  if ((state.waypoints.length || state.notes.length) &&
      !confirm(S.routeLibraryReplaceConfirm ||
        S.routeTemplateReplaceConfirm || 'Replace the current route?')) return false;
  applyRouteData(entry.data);
  currentRouteLibraryId = entry.id;   // track the loaded entry for in-place Save
  return true;
}

// --- print -----------------------------------------------------------

function applyPage() {
  // refreshPageButtons sets BOTH .active and aria-pressed; the selected-state
  // highlight CSS keys off aria-pressed (the A3/A4 buttons have no .tool class),
  // so toggling only .active here left a restored page size unhighlighted on
  // boot (docs/app/io.js boot restore calls applyPage without refreshPageButtons).
  refreshPageButtons();
  draw();
  refreshPrintFit();
}

// Reflect the active page size on the A3/A4 buttons (.active + aria-pressed →
// the toolbar's active highlight) so it's clear which is selected.
function refreshPageButtons() {
  for (const [id, sz] of [['page-a3', 'A3'], ['page-a4', 'A4'], ['page-a4x2', 'A4x2']]) {
    const b = document.getElementById(id);
    if (!b) continue;
    const on = pageSize === sz;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  updateExportPageWarn();   // the open print panel's ratio warning tracks the frame live
}
// Show/hide the print panel's "no page size → ratio may not match" warning to
// match the CURRENT page frame. Called on every page change so toggling A3/A4
// while the (non-modal) print panel is open updates the warning live.
function updateExportPageWarn() {
  const w = document.getElementById('export-page-warn');
  if (!w) return;
  if (!pageSize) {
    w.textContent = S.exportNoPageWarn;
    w.classList.add('blink-warn');
    w.style.display = '';
  } else {
    w.textContent = '';
    w.classList.remove('blink-warn');
    w.style.display = 'none';
  }
}
// Keep the open print panel's "Place flight plan" checkbox in sync with the
// route: it needs a route (>=1 leg), not a page. Called from draw() so adding
// or clearing a route while the (non-modal) panel is open updates it live.
function updateExportPlanCb() {
  const cb = document.getElementById('export-plan-cb');
  if (!cb) return;
  const hasLegs = !!(state.legs && state.legs.length);
  cb.disabled = !hasLegs;
  const lbl = document.getElementById('export-plan-cb-label');
  if (lbl) lbl.textContent = hasLegs ? S.exportPlanPlace : (S.exportPlanNoLegs || S.exportPlanPlace);
  if (!hasLegs && cb.checked) {
    cb.checked = false;
    window.planCard = null;
    // The card is gone, so the export backdrop must go back to being a normal
    // dimmed, click-blocking modal. Without this it stayed transparent and
    // pointer-events:none, so tapping outside no longer dismissed the panel and the
    // VOR row kept offering columns for a card that no longer exists.
    const vr = document.getElementById('export-vor-select');
    if (vr && vr.parentElement) vr.parentElement.style.display = 'none';
    if (typeof window.__exportSyncPlaceThrough === 'function') window.__exportSyncPlaceThrough();
  }
}
function setPage(size) {
  if (pageSize === size) {             // same button toggles the frame off
    pageSize = null;
    try { localStorage.removeItem('navaid.pageSize'); } catch (e) { /* */ }
    applyPage();
    refreshPageButtons();
    return;
  }
  // Orientation is no longer a per-click modal — the toolbar Landscape/
  // Portrait toggle (page-orient button) is the source of truth. Default
  // to landscape on first use if nothing is persisted yet.
  if (!pageOrient) pageOrient = 'landscape';
  pageSize = size;
  pageOffset = { x: 0, y: 0 };
  try { localStorage.setItem('navaid.pageSize', pageSize); } catch (e) { /* */ }
  applyPage();
  fitPageFrame();
  refreshPageButtons();
}
function toggleOrientation() {
  pageOrient = pageOrient === 'portrait' ? 'landscape' : 'portrait';
  try { localStorage.setItem('navaid.pageOrient', pageOrient); } catch (e) {}
  if (pageSize) { applyPage(); fitPageFrame(); }
  refreshOrientButton();
}
// Keep the clipping warning and the fit button in step with the page frame, the map
// view and the route. Called from applyPage/draw, so panning the map, resizing the
// page, dragging the frame or editing the route all re-evaluate it.
function refreshPrintFit() {
  const warn = document.getElementById('print-clip-warn');
  const fitBtn = document.getElementById('print-fit');
  if (!warn || !fitBtn) return;
  const noFrame = !pageSize || !state.waypoints || !state.waypoints.length;
  const fit = noFrame ? { fits: true } : routePageFit();
  if (noFrame || fit.fits) {
    warn.hidden = true;
    fitBtn.hidden = true;
    return;
  }
  // Is there any page that COULD hold it? Ask without committing, so the message can
  // distinguish "press the button" from "no page is big enough, split the route".
  const savedSize = pageSize, savedOrient = pageOrient, savedOffset = pageOffset;
  const pick = fitPageToRoute();
  pageSize = savedSize; pageOrient = savedOrient; pageOffset = savedOffset;
  warn.hidden = false;
  warn.textContent = pick ? (S.printClipWarn || 'The route runs past the page.')
    : (S.printNoFit || 'No page size holds this route.');
  fitBtn.hidden = !pick;
}

function refreshOrientButton() {
  const btn = document.getElementById('page-orient');
  if (!btn) return;
  const isPortrait = pageOrient === 'portrait';
  const icon = isPortrait ? '▯' : '▭';
  const label = isPortrait ? (S.portrait || 'Portrait') : (S.landscape || 'Landscape');
  const iconEl = btn.querySelector('.page-orient-icon');
  const labelEl = btn.querySelector('.page-orient-label');
  if (iconEl && labelEl) {
    iconEl.textContent = icon;
    labelEl.textContent = label;
  } else {
    btn.textContent = icon + ' ' + label;
  }
  btn.classList.toggle('portrait', isPortrait);
}

function fitPageFrame() {
  const d = pageDims();
  if (!d) return;
  const halfW = d.w * 926;          // NM→m ÷ 2 (1852÷2 = 926)
  const halfH = d.h * 926;
  let center;
  if (state.waypoints.length > 0) {
    const b = L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng]));
    center = b.getCenter();
  } else {
    center = map.getCenter();
  }
  const latRad = center.lat * Math.PI / 180;
  const cosLat = Math.cos(latRad) || 0.0001;
  const degLng = halfW / (111320 * cosLat);
  const degLat = halfH / 110540;
  const bounds = L.latLngBounds(
    [center.lat - degLat, center.lng - degLng],
    [center.lat + degLat, center.lng + degLng]
  );
  map.fitBounds(bounds, { padding: [30, 30] });
}

// --- flight plan table -----------------------------------------------
function wpLabel(i) {
  const wp = state.waypoints[i];
  if (!wp) return '';
  return waypointDisplayLabel(wp, i);
}

// #86: Flight Plan modal state and Escape-to-close handling.
let flightPlanBack = null;
let refreshFlightPlan = null;
let drawProfileStripIfOpen = null;   // set while the flight-plan modal is open (#672)
let flightPlanEscape = null;
let flightPlanCleanup = null;             // tears down drag listeners attached
                                          // outside the modal subtree (window).
var fpOpen = false;                       // true while flight-plan modal is shown

// Returns true if wp.name matches a known airfield ICAO code.
// Used to decide whether to add startup/taxi fuel to the first leg.
function isAirport(wp) {
  return typeof airfieldAtWaypoint === 'function' && airfieldAtWaypoint(wp) != null;
}

function closeFlightPlan() {
  if (flightPlanEscape) {
    document.removeEventListener('keydown', flightPlanEscape);
    flightPlanEscape = null;
  }
  if (flightPlanCleanup) {
    try { flightPlanCleanup(); } catch (e) { /* listener removal is best-effort */ }
    flightPlanCleanup = null;
  }
  if (flightPlanBack) {
    flightPlanBack.remove();
    flightPlanBack = null;
  }
  refreshFlightPlan = null;
  drawProfileStripIfOpen = null;
  fpOpen = false;
  if (window.showProfile) { window.showProfile = false; draw(); }   // hide TOC/TOD markers
  try { sessionStorage.removeItem('navaid.fpOpen'); } catch (e) {}
}

function showFlightPlan() {
  if (refreshFlightPlan) return;        // #78: dedupe — modal already open
  if (state.legs.length === 0) {
    alert(S.errNoLegs);
    return;
  }
  closeOpenChartModals();
  clearOpenChartModal();
  // 'flight-plan' variant: backdrop is transparent + pointer-events: none so
  // the map underneath stays interactive (waypoint drag, pan, etc.) while
  // the plan is open. The modal box itself opts back into pointer events.
  const back = document.createElement('div');
  back.className = 'modal-back flight-plan';
  const box = document.createElement('div');
  box.className = 'modal wide';
  // The inspector is pinned top-right at z-index 2320, above this modal's 2000, so an
  // open selection covered the right-hand columns (Cum. fuel was unreadable). Hide it
  // while the plan is up and put it back on close if the selection still stands.
  const inspEl = document.getElementById('inspector');
  const inspWasVisible = !!(inspEl && !inspEl.classList.contains('hidden'));
  if (inspWasVisible) inspEl.classList.add('hidden');
  const restoreInspector = () => {
    // Also covers a selection restored WHILE the plan was open (see
    // tryRestoreInspectorSelection): the panel was deferred, not discarded.
    const deferred = !!window.__inspectorDeferredByPlan;
    window.__inspectorDeferredByPlan = false;
    if ((inspWasVisible || deferred) && state.selected && typeof showInspector === 'function') showInspector();
  };

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.flightPlan;
  box.appendChild(title);

  // Drag-to-move on the title bar (mouse + touch).
  (function (el) {
    const KEY = 'navaid.fpPos';
    let dx = 0, dy = 0, dragging = false;
    function clamp(x, y) {
      return {
        x: Math.max(0, Math.min(window.innerWidth - el.offsetWidth, x)),
        y: Math.max(0, Math.min(window.innerHeight - el.offsetHeight, y)),
      };
    }
    function setPos(x, y) {
      const c = clamp(x, y);
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      el.style.margin = '0';
    }
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const p = JSON.parse(raw); setPos(p.x, p.y); }
    } catch (e) {}
    function start(cx, cy) {
      const r = el.getBoundingClientRect();
      dx = cx - r.left; dy = cy - r.top;
      dragging = true;
    }
    function move(cx, cy) { if (dragging) setPos(cx - dx, cy - dy); }
    function end() {
      if (!dragging) return;
      dragging = false;
      const r = el.getBoundingClientRect();
      try { localStorage.setItem(KEY, JSON.stringify({ x: r.left, y: r.top })); } catch (e) {}
    }
    title.addEventListener('mousedown', e => {
      e.preventDefault();
      start(e.clientX, e.clientY);
      const onMove = ev => move(ev.clientX, ev.clientY);
      const onUp = () => { end(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      start(e.touches[0].clientX, e.touches[0].clientY);
    }
    function onTouchMove(e) {
      if (!dragging || e.touches.length !== 1) return;
      e.preventDefault();
      move(e.touches[0].clientX, e.touches[0].clientY);
    }
    title.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    // closeFlightPlan() invokes this to detach the window-level listeners so
    // a re-open doesn't accumulate stale handlers (closures capture el/dragging).
    flightPlanCleanup = function () {
      title.removeEventListener('touchstart', onTouchStart, { passive: false });
      window.removeEventListener('touchmove', onTouchMove, { passive: false });
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      restoreInspector();          // put the inspector back if it was open
    };
  })(box);

  loadAircraft();
  const fpAircraft = document.createElement('div');
  fpAircraft.className = 'fp-aircraft';
  const acLbl = document.createElement('span');
  acLbl.textContent = S.tbAircraft + ': ';
  fpAircraft.appendChild(acLbl);
  const acInputDiv = document.createElement('div');
  acInputDiv.id = 'aircraft-custom';
  function mkAcInput(id, label, title, min, max, step) {
    const wrap = document.createElement('label');
    wrap.title = title || label;
    const lbl = document.createElement('span');
    lbl.textContent = label + ': ';
    wrap.appendChild(lbl);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.id = id;
    inp.min = min; inp.max = max; inp.step = step;
    inp.style.width = '60px';
    wrap.appendChild(inp);
    return wrap;
  }
  acInputDiv.appendChild(mkAcInput('aircraft-gph', S.tbGph, S.tbGphTitle, 1, 50, 0.5));
  acInputDiv.appendChild(mkAcInput('aircraft-taxi', S.tbTaxiGal, S.tbTaxiGalTitle, 0, 20, 0.1));
  fpAircraft.appendChild(acInputDiv);
  const gphInp  = acInputDiv.querySelector('#aircraft-gph');
  const taxiInp = acInputDiv.querySelector('#aircraft-taxi');
  function syncAircraftUI() {
    if (!aircraft) { aircraft = { gph: tune('defaultGph'), taxiGal: tune('defaultTaxiGal') }; saveAircraft(); }
    gphInp.value  = aircraft.gph;
    taxiInp.value = aircraft.taxiGal;
  }
  function readAircraftInputs() {
    const gph = parseFloat(gphInp.value);
    if (isNaN(gph) || gph <= 0) return null;
    return { gph: gph, taxiGal: parseFloat(taxiInp.value) || 0 };
  }
  [gphInp, taxiInp].forEach(inp => {
    inp.oninput = function () {
      const a = readAircraftInputs();
      aircraft = a;
      saveAircraft(); draw(); refresh();
    };
  });
  syncAircraftUI();
  // Reference VOR picker — drives the per-leg Radial / DME columns. Shares the
  // global `vorRef` with the map overlay so both stay in sync.
  const vorWrap = document.createElement('label');
  vorWrap.className = 'fp-vor';
  vorWrap.title = S.tbShowVorTitle || '';
  const vorLbl = document.createElement('span');
  vorLbl.textContent = (S.fpVorLabel || 'VOR') + ': ';
  vorWrap.appendChild(vorLbl);
  const vorSel = document.createElement('select');
  vorSel.id = 'fp-vor-select';
  const vorFreqSpan = document.createElement('span');
  vorFreqSpan.className = 'fp-vor-freq';
  function fillFpVorSelect() {
    vorSel.innerHTML = '';
    const none = document.createElement('option');
    none.value = ''; none.textContent = S.vorRefNone || '— none —';
    vorSel.appendChild(none);
    for (const v of (vors || [])) {
      const opt = document.createElement('option');
      opt.value = v.ident;
      opt.textContent = v.ident + ' · ' + v.name;
      vorSel.appendChild(opt);
    }
    vorSel.value = vorRef || '';
    const cur = typeof activeVor === 'function' ? activeVor() : null;
    vorFreqSpan.textContent = cur ? (typeof vorEffectiveFreq === 'function' ? vorEffectiveFreq(cur) : cur.freq) + ' MHz' : '';
  }
  vorSel.onchange = () => {
    window.vorRef = vorSel.value || null;
    try {
      if (vorRef) localStorage.setItem('navaid.vorRef', vorRef);
      else localStorage.removeItem('navaid.vorRef');
    } catch (e) { /* */ }
    const vs = document.getElementById('vor-ref-select');
    if (vs) vs.value = vorRef || '';
    fillFpVorSelect();
    draw();
    refresh();
    if (retRefresh) retRefresh();
  };
  vorWrap.appendChild(vorSel);
  vorWrap.appendChild(vorFreqSpan);
  fpAircraft.appendChild(vorWrap);
  if (vors === null && typeof loadVors === 'function') {
    loadVors().then(() => { fillFpVorSelect(); refresh(); if (retRefresh) retRefresh(); });
  } else {
    fillFpVorSelect();
  }
  box.appendChild(fpAircraft);

  // Vertical profile strip (#672) — altitude vs distance with TOC/TOD.
  const profWrap = document.createElement('div');
  profWrap.className = 'fp-profile';
  const profLbl = document.createElement('div');
  profLbl.className = 'fp-profile-label';
  const profTitle = document.createElement('span');
  profTitle.textContent = S.profileTitle || 'Vertical profile';
  profLbl.appendChild(profTitle);
  // V/S input — vertical speed (ft/min) driving the climb/descent ramp slope.
  // Default 500; persisted so the pilot's preferred rate sticks (#672).
  if (!(window.profileVS > 0)) {
    let stored = 0;
    try { stored = parseInt(localStorage.getItem('navaid.profileVS'), 10); } catch (e) { /* ignore */ }
    window.profileVS = stored > 0 ? stored : 500;
  }
  const vsLbl = document.createElement('label');
  vsLbl.className = 'fp-profile-vs';
  vsLbl.textContent = (S.profileVs || 'V/S (ft/min)') + ' ';
  // Say so out loud: this number shapes the drawn climb, it does not buy or spend ETE.
  if (S.profileVsTitle) vsLbl.title = S.profileVsTitle;
  const vsInput = document.createElement('input');
  vsInput.type = 'number'; vsInput.min = '50'; vsInput.step = '50';
  vsInput.value = String(window.profileVS);
  vsInput.className = 'fp-profile-vs-input';
  vsInput.oninput = () => {
    const v = parseInt(vsInput.value, 10);
    if (v > 0) {
      window.profileVS = v;
      try { localStorage.setItem('navaid.profileVS', String(v)); } catch (e) { /* ignore */ }
      draw();        // the map TOC marker moves with the new ramp
      refresh();     // redraw the profile strip (leg times do not depend on V/S)
    }
  };
  vsLbl.appendChild(vsInput);
  profLbl.appendChild(vsLbl);
  profWrap.appendChild(profLbl);
  // Direction indicator above the strip — the profile/X-axis mirrors in RTL
  // (Hebrew), so spell out the flow: departure → destination with a centred
  // arrow, oriented to match the axis (arrow points the way it's flown).
  (function () {
    const wps = state.waypoints || [];
    if (wps.length < 2) return;
    const depName = navName((wps[0].name || '').trim()) || (S.wpPrefix + 1);
    const destName = navName((wps[wps.length - 1].name || '').trim()) || (S.wpPrefix + wps.length);
    const rtl = document.documentElement && document.documentElement.dir === 'rtl';
    const label = S.fpDirection || 'Direction';
    const dirRow = document.createElement('div');
    dirRow.className = 'fp-profile-dir';
    dirRow.dir = 'ltr';                 // fixed frame; place ends by axis side
    const lEnd = document.createElement('span');
    const arrow = document.createElement('span');
    arrow.className = 'fp-dir-arrow';
    const rEnd = document.createElement('span');
    // d=0 (departure) is on the left in LTR, on the right in RTL.
    lEnd.textContent = rtl ? destName : depName;
    rEnd.textContent = rtl ? depName : destName;
    arrow.textContent = rtl ? ('◄ ' + label) : (label + ' ►');
    dirRow.appendChild(lEnd); dirRow.appendChild(arrow); dirRow.appendChild(rEnd);
    profWrap.appendChild(dirRow);
  })();
  const profCanvas = document.createElement('canvas');
  profCanvas.className = 'fp-profile-canvas';
  profCanvas.width = 600; profCanvas.height = 104;
  profWrap.appendChild(profCanvas);
  box.appendChild(profWrap);
  drawProfileStripIfOpen = function () {
    if (!profCanvas.isConnected) return;
    const cssW = profCanvas.clientWidth || 600;
    profCanvas.width = cssW; profCanvas.height = 104;
    const cx = profCanvas.getContext('2d');
    cx.clearRect(0, 0, profCanvas.width, profCanvas.height);
    if (typeof drawVerticalProfile === 'function') drawVerticalProfile(cx, 0, 0, profCanvas.width, profCanvas.height);
  };
  // Show TOC/TOD markers on the map while the flight plan is open.
  window.showProfile = true;
  draw();

  // Active comm frequency per leg (read-only) — departure airfield primary +
  // comm-change notes, carried forward until the next change (see core.js
  // routeFreqSources/legActiveFreq). Recomputed in refresh() once the comm
  // catalog loads, so the first leg from an airfield shows its tower freq.
  let freqSources = typeof routeFreqSources === 'function' ? routeFreqSources() : [];
  const depIsAirfield = state.waypoints && state.waypoints[0] &&
    typeof isAirport === 'function' && isAirport(state.waypoints[0]);
  const freqActive = freqSources.length > 0 || depIsAirfield;
  const freqCells = [];        // forward leg index -> freq cell
  const rFreqCells = [];       // return rows -> { cell, ri }
  const legFreqText = i => (typeof legActiveFreq === 'function' ? legActiveFreq(i, freqSources) : '');

  // Flight-plan columns are tagged once so the selector, CSV export, print
  // view, and nav-log clone all read the same visibility state.
  // Phone-width layout: drives both the default column set and the short titles below.
  const fpNarrowLayout = typeof window !== 'undefined' && window.innerWidth < 700;
  const baseHeaders = (S.fpHeaders || []).slice(0, 13);
  // Displayed column titles, kept SEPARATE from `fpHeaders`. `fpHeaders` is the CSV
  // export contract — the header row anything downstream keys on — so it must not move
  // when a title is reworded. Anything missing here falls back to the export name.
  const dispHeaders = (S.fpHeadersDisplay || []).slice(0, 13);
  const fpColumns = [
    { key: 'seq', label: baseHeaders[0] || '#', display: dispHeaders[0] || '#' },
    { key: 'from', label: baseHeaders[1] || 'From', display: dispHeaders[1] || 'From' },
    { key: 'to', label: baseHeaders[2] || 'To', display: dispHeaders[2] || 'To' },
    { key: 'hdg', label: baseHeaders[3] || 'Hdg', display: dispHeaders[3] || 'Hdg' },
    { key: 'dist', label: baseHeaders[4] || 'Dist (NM)', display: dispHeaders[4] || 'Dist (NM)' },
    { key: 'speed', label: baseHeaders[5] || 'Speed (kt)', display: dispHeaders[5] || 'Speed (kt)' },
    { key: 'alt', label: baseHeaders[6] || 'Alt (ft)', display: dispHeaders[6] || 'Alt (ft)' },
    { key: 'time', label: baseHeaders[7] || 'Time', display: dispHeaders[7] || 'Time' },
    { key: 'fuel', label: baseHeaders[8] || 'Fuel (gal)', display: dispHeaders[8] || 'Fuel (gal)' },
    { key: 'cumTime', label: baseHeaders[9] || 'Cum. time', display: dispHeaders[9] || 'Cum. time' },
    { key: 'cumFuel', label: baseHeaders[10] || 'Cum. fuel', display: dispHeaders[10] || 'Cum. fuel' },
    { key: 'radial', label: baseHeaders[11] || 'Radial', display: dispHeaders[11] || 'Radial', className: 'fp-vor-col' },
    { key: 'dme', label: baseHeaders[12] || 'DME', display: dispHeaders[12] || 'DME', className: 'fp-vor-col' },
  ];
  if (freqActive) fpColumns.push({ key: 'freq', label: S.fpFreq || 'Freq', className: 'fp-freq-col' });
  fpColumns.push({ key: 'delete', label: '', className: 'fp-del-col', control: true });
  // Phone widths get short display titles (the export names never change).
  if (fpNarrowLayout && S.fpHeadersNarrow) {
    for (const col of fpColumns) {
      const short = S.fpHeadersNarrow[col.key];
      if (short) col.display = short;
    }
  }
  const fpColumnMap = Object.fromEntries(fpColumns.map(col => [col.key, col]));
  const fpSelectableColumns = fpColumns.filter(col => !col.control);
  const fpSelectableKeys = new Set(fpSelectableColumns.map(col => col.key));
  const fpHiddenColumns = new Set();
  const fpColumnsKey = 'navaid.fpColumns';
  // Per-leg distance is a nav-log staple, so it is no longer hidden by default.
  // On a phone the table can only show ~4 columns before it scrolls sideways, and
  // Time/Fuel were the ones off-screen; there the default drops the columns a pilot
  // can rebuild from the row above (From, cumulative fuel) and the VOR pair, which
  // is blank until a VOR is picked. The Columns menu still overrides all of it.
  const fpDefaultHiddenColumns = fpNarrowLayout
    // ~315px of table on a phone fits five columns. These five answer "where am I
    // going, on what heading, at what altitude, and for how long"; everything else
    // (From, per-leg distance, speed, per-leg fuel, cumulatives, the VOR pair, freq)
    // is one tap away in the Columns menu, and the totals line above the table always
    // carries distance/ETE/fuel. The full table is 874px wide, so on a 375px phone the
    // columns you actually fly by started off-screen behind a sideways scroll.
    ? ['from', 'dist', 'speed', 'fuel', 'cumTime', 'cumFuel', 'radial', 'dme', 'freq']
    : [];
  let savedFpColumns = fpDefaultHiddenColumns;
  try {
    const rawColumns = localStorage.getItem(fpColumnsKey);
    savedFpColumns = rawColumns === null ? fpDefaultHiddenColumns : JSON.parse(rawColumns);
  } catch (e) { /* ignore corrupt prefs */ }
  if (Array.isArray(savedFpColumns)) {
    savedFpColumns.forEach(key => { if (fpSelectableKeys.has(key)) fpHiddenColumns.add(key); });
  }
  if (fpHiddenColumns.size >= fpSelectableColumns.length) fpHiddenColumns.clear();
  const fpVisibleColumns = new Set(fpSelectableColumns
    .filter(col => !fpHiddenColumns.has(col.key))
    .map(col => col.key));
  const fpTotalLabels = [];
  function saveFpColumnPrefs() {
    const hidden = fpSelectableColumns
      .filter(col => !fpVisibleColumns.has(col.key))
      .map(col => col.key);
    try {
      localStorage.setItem(fpColumnsKey, JSON.stringify(hidden));
    } catch (e) { /* ignore storage errors */ }
  }
  function markFpColumn(el, key) {
    const col = fpColumnMap[key];
    if (!el || !col) return el;
    el.dataset.fpCol = key;
    el.classList.add('fp-col-' + key);
    if (col.className) col.className.split(/\s+/).forEach(cls => { if (cls) el.classList.add(cls); });
    return el;
  }
  function fpCell(key, cell) {
    return markFpColumn(cell, key);
  }
  function syncFpColumnVisibility() {
    for (const col of fpSelectableColumns) {
      const hidden = !fpVisibleColumns.has(col.key);
      box.querySelectorAll('[data-fp-col="' + col.key + '"]').forEach(el => {
        el.classList.toggle('fp-col-hidden', hidden);
      });
    }
    const leadKeys = ['seq', 'from', 'to', 'hdg'];
    const leadVisible = leadKeys.filter(key => fpVisibleColumns.has(key)).length;
    for (const label of fpTotalLabels) {
      label.colSpan = Math.max(1, leadVisible);
      label.classList.toggle('fp-col-hidden', leadVisible === 0);
    }
  }
  const colWrap = document.createElement('details');
  colWrap.className = 'fp-columns';
  const colSummary = document.createElement('summary');
  colSummary.textContent = S.fpColumns || 'Columns';
  colWrap.appendChild(colSummary);
  const colMenu = document.createElement('div');
  colMenu.className = 'fp-columns-menu';
  const colAll = document.createElement('button');
  colAll.type = 'button';
  colAll.className = 'fp-columns-all';
  colAll.textContent = S.fpColumnsAll || 'All columns';
  colMenu.appendChild(colAll);
  const colChecks = [];
  for (const col of fpSelectableColumns) {
    const lbl = document.createElement('label');
    lbl.className = 'fp-column-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = fpVisibleColumns.has(col.key);
    cb.dataset.fpCol = col.key;
    const text = document.createElement('span');
    text.textContent = col.label;
    lbl.append(cb, text);
    colMenu.appendChild(lbl);
    colChecks.push(cb);
    cb.onchange = () => {
      if (!cb.checked && fpVisibleColumns.size <= 1) {
        cb.checked = true;
        return;
      }
      if (cb.checked) fpVisibleColumns.add(col.key);
      else fpVisibleColumns.delete(col.key);
      saveFpColumnPrefs();
      syncFpColumnVisibility();
    };
  }
  colAll.onclick = () => {
    fpVisibleColumns.clear();
    fpSelectableColumns.forEach(col => fpVisibleColumns.add(col.key));
    colChecks.forEach(cb => { cb.checked = true; });
    saveFpColumnPrefs();
    syncFpColumnVisibility();
  };
  colWrap.appendChild(colMenu);
  box.appendChild(colWrap);

  const scrollArea = document.createElement('div');
  scrollArea.className = 'fp-scroll';
  box.appendChild(scrollArea);

  const table = document.createElement('table');
  table.className = 'flight-table';
  const buildHeadRow = trEl => {
    fpColumns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.display || col.label;
      // The CSV header row is scraped from these cells, so carry the stable export
      // name explicitly. Without it, rewording a title silently rewrote the exported
      // file's header and broke anything keyed on the old name.
      th.dataset.csv = col.label || '';
      if (col.key === 'time' || col.key === 'cumTime') {
        th.title = S.fpTimeUnitsTitle || 'Elapsed time, mm:ss (not a clock time)';
      }
      trEl.appendChild(markFpColumn(th, col.key));
    });
  };
  const thead = document.createElement('thead');
  const trH = document.createElement('tr');
  buildHeadRow(trH);
  thead.appendChild(trH);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  // From / To cells are editable — each waypoint may appear in two rows,
  // so edits sync every input bound to the same waypoint.
  const wpInputs = {};                  // waypoint index -> [input elements]
  function nameCell(wpIdx) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'plan-name';
    inp.maxLength = 10;
    // #81: show the locale-resolved label so the cell matches the map.
    normalizeWaypointSequenceName(state.waypoints[wpIdx]);
    inp.value = navName((state.waypoints[wpIdx].name || '').trim());
    inp.placeholder = S.wpPrefix + (wpIdx + 1);
    inp.oninput = () => {
      const t = (inp.value || '').trim();
      const next = isSequenceWaypointName(t) ? '' : inp.value;
      state.waypoints[wpIdx].name = next;
      for (const o of wpInputs[wpIdx]) if (o !== inp) o.value = next;
      draw();
    };
    (wpInputs[wpIdx] || (wpInputs[wpIdx] = [])).push(inp);
    td.appendChild(inp);
    return td;
  }
  // Speed / Alt cells are editable number inputs. Commit on `change`
  // (blur / Enter), matching the inspector's number fields.
  function numCell(value, min, onCommit) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'plan-num';
    inp.min = min;
    inp.value = altitudeInputValue(value);
    inp.onchange = () => onCommit(inp);
    td.appendChild(inp);
    return td;
  }
  const altInputs = [];                 // leg index -> altitude input
  const speedInputs = [];               // leg index -> speed input
  const distCells = [];                 // leg index -> distance cell
  const hdgCells = [];                  // leg index -> heading cell
  const timeCells = [];                 // leg index -> time cell
  const fuelCells = [];                 // leg index -> fuel (gal) cell
  const cumTimeCells = [];              // leg index -> cumulative time (H:M:S)
  const cumFuelCells = [];            // leg index -> cumulative fuel (gal)
  const radialCells = [];              // leg index -> VOR radial cell (To wp)
  const dmeCells = [];                 // leg index -> VOR DME cell (To wp)
  // Radial (magnetic) + DME of a waypoint from the selected reference VOR.
  // Per-leg override (leg.vorRef) wins over the global reference VOR.
  const legVorSelects = [];             // { sel, leg } for every Radial cell
  function legVorObj(leg) {
    return (leg && leg.vorRef && typeof vorByIdent === 'function' ? vorByIdent(leg.vorRef) : null)
      || (typeof activeVor === 'function' ? activeVor() : null);
  }
  function anyVorActive() {
    return !!(typeof activeVor === 'function' && activeVor()) ||
      state.legs.some(l => l && l.vorRef);
  }
  function vorCells(wp, leg) {
    const v = legVorObj(leg);
    const empty = S.fpVorRadialEmpty || '—';
    if (!v || !wp) return [empty, empty];
    const rd = vorRadialDme(v, wp.lat, wp.lng);
    return rd ? ['R-' + rd.radial, rd.dme] : [empty, empty];
  }
  // A Radial cell carries a per-leg VOR picker (default = global reference)
  // plus the radial value; the DME cell stays plain text. Returns the value
  // span so refresh() can update it.
  function radialCellWithPicker(legIdx) {
    const td = planCell('');
    td.classList.add('fp-vor-col');
    const sel = document.createElement('select');
    sel.className = 'fp-leg-vor';
    sel.onchange = () => {
      if (state.legs[legIdx]) state.legs[legIdx].vorRef = sel.value || null;
      refresh();
      if (retRefresh) retRefresh();
    };
    const val = document.createElement('span');
    val.className = 'fp-radial-val';
    td.appendChild(sel);
    td.appendChild(val);
    legVorSelects.push({ sel, leg: legIdx });
    return { td, val };
  }
  function fillLegVorSelects() {
    for (const { sel, leg } of legVorSelects) {
      sel.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = (vorRef ? vorRef : (S.vorRefNone || '—'));
      sel.appendChild(def);
      for (const v of (vors || [])) {
        const o = document.createElement('option');
        o.value = v.ident; o.textContent = v.ident;
        sel.appendChild(o);
      }
      sel.value = (state.legs[leg] && state.legs[leg].vorRef) || '';
    }
  }
  let totDistCell, totTimeCell, totFuelCell, totCumTimeCell, totCumFuelCell;
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    const leg = state.legs[i];
    const { dist, brg } = geo(A, B);
    const tr = document.createElement('tr');
    tr.appendChild(fpCell('seq', planCell(String(i + 1))));
    tr.appendChild(fpCell('from', nameCell(i)));
    tr.appendChild(fpCell('to', nameCell(i + 1)));
    const hdgCell = planCell(pad3(toMagnetic(brg)) + '°M');
    tr.appendChild(fpCell('hdg', hdgCell));
    const distCell = planCell(dist.toFixed(1));
    tr.appendChild(fpCell('dist', distCell));
    const speedCell = numCell(leg.flightSpeed, 1, inp => {
      const v = +inp.value;
      if (v > 0) {
        const oldVal = leg.flightSpeed;
        leg.flightSpeed = v;
        propagateAlt(i, 'flightSpeed', leg.flightSpeed, oldVal);
        draw();
        refresh();
        if (retRefresh) retRefresh();
        // Keep an open leg inspector in sync with the edit (#672 follow-up).
        refreshInspectorIfVisible();
      }
      else inp.value = leg.flightSpeed;   // invalid — restore the real value
    });
    speedInputs[i] = speedCell.querySelector('.plan-num');
    tr.appendChild(fpCell('speed', speedCell));
    const altCell = numCell(leg.inboundAltitude, -2000, inp => {
      const raw = inp.value.trim();
      const oldVal = leg.inboundAltitude;
      if (!raw) {
        leg.inboundAltitude = NaN;
      } else {
        const v = Number(raw);
        if (!Number.isFinite(v)) { inp.value = altitudeInputValue(leg.inboundAltitude); return; }
        leg.inboundAltitude = Math.round(v);
      }
      propagateAlt(i, 'inboundAltitude', leg.inboundAltitude, oldVal);
      draw();
      refresh();
      if (retRefresh) retRefresh();
      refreshInspectorIfVisible();
    });
    altInputs[i] = altCell.querySelector('.plan-num');
    altInputs[i].placeholder = legAltitudePlaceholder(leg, 'inboundAltitude');
    tr.appendChild(fpCell('alt', altCell));
    const timeCell = planCell('');
    timeCells[i] = timeCell;
    distCells[i] = distCell;
    hdgCells[i] = hdgCell;
    tr.appendChild(fpCell('time', timeCell));
    const fuelCell = planCell('');
    fuelCells[i] = fuelCell;
    tr.appendChild(fpCell('fuel', fuelCell));
    const cumTimeCell = planCell('');
    cumTimeCells[i] = cumTimeCell;
    tr.appendChild(fpCell('cumTime', cumTimeCell));
    const cumFuelCell = planCell('');
    cumFuelCells[i] = cumFuelCell;
    tr.appendChild(fpCell('cumFuel', cumFuelCell));
    const radial = radialCellWithPicker(i);
    radialCells[i] = radial.val;
    tr.appendChild(fpCell('radial', radial.td));
    const dmeCell = planCell('');
    dmeCells[i] = dmeCell;
    dmeCell.classList.add('fp-vor-col');
    tr.appendChild(fpCell('dme', dmeCell));
    if (freqActive) {
      const freqCell = planCell(legFreqText(i));
      freqCell.classList.add('fp-freq-col');
      freqCells[i] = freqCell;
      tr.appendChild(fpCell('freq', freqCell));
    }
    // Delete-leg button — drops this leg and one of its endpoint waypoints,
    // then reconnects the route. The first leg removes the departure (its
    // "From") so peeling legs off the front trims the start (A-B-C-D → B-C-D →
    // C-D); every other leg removes its "To", so the last leg removes the
    // destination. The refreshFlightPlan callback detects the leg-count change
    // and rebuilds the modal.
    (function (idx) {
      const delTd = document.createElement('td');
      delTd.className = 'fp-del';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = S.fpDel || '✕';
      delBtn.title = S.fpDelTitle || 'Delete leg';
      delBtn.onclick = function () {
        if (state.waypoints.length < 2) return;
        // Same report-point re-anchoring deleteWaypoint does — this raw splice
        // renumbers legs too, so without it syncLegs' index prune deletes markers
        // whose segment still exists.
        const rpGeo = (typeof captureReportPointGeo === 'function') ? captureReportPointGeo() : [];
        state.waypoints.splice(idx === 0 ? 0 : idx + 1, 1);
        state.legs.splice(idx, 1);
        if (typeof reanchorReportPoints === 'function') reanchorReportPoints(rpGeo);
        syncLegs();
        // Drop the deleted waypoint's now-orphaned comm-change callout (this raw
        // splice bypasses deleteWaypoint's note cleanup; the index semantics
        // differ so we can't call it directly).
        if (typeof pruneStaleCommChangeNotes === 'function') pruneStaleCommChangeNotes();
        state.selected = null;
        showInspector();
        draw();
        if (refreshFlightPlan) refreshFlightPlan();
      };
      delTd.appendChild(delBtn);
      tr.appendChild(fpCell('delete', delTd));
    })(i);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  // Narrow screens: the table is ~2.6x the viewport width, so Dist / Time / Fuel and
  // the Total row are all scrolled off and a phone shows only names + heading. Put the
  // figures that matter in one line above it. Inserted once the scroll area is in the
  // DOM (below) — inserting here threw, because the table is not in `box` yet.
  const mobileSummary = document.createElement('div');
  mobileSummary.id = 'fp-mobile-summary';

  const tfoot = document.createElement('tfoot');
  const trF = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.colSpan = 4;
  tdLabel.className = 'fp-total-label';
  tdLabel.textContent = S.fpTotal;
  fpTotalLabels.push(tdLabel);
  trF.appendChild(tdLabel);
  totDistCell = fpCell('dist', planCell(''));
  trF.appendChild(totDistCell);
  trF.appendChild(fpCell('speed', planCell('')));        // Speed column
  trF.appendChild(fpCell('alt', planCell('')));          // Alt column
  totTimeCell = planCell('');
  trF.appendChild(fpCell('time', totTimeCell));
  totFuelCell = planCell('');
  trF.appendChild(fpCell('fuel', totFuelCell));
  totCumTimeCell = planCell('');
  trF.appendChild(fpCell('cumTime', totCumTimeCell));
  totCumFuelCell = planCell('');
  trF.appendChild(fpCell('cumFuel', totCumFuelCell));
  const totRadial = planCell(''); totRadial.classList.add('fp-vor-col'); trF.appendChild(fpCell('radial', totRadial));
  const totDme = planCell(''); totDme.classList.add('fp-vor-col'); trF.appendChild(fpCell('dme', totDme));
  if (freqActive) { const tf2 = planCell(''); tf2.classList.add('fp-freq-col'); trF.appendChild(fpCell('freq', tf2)); }
  trF.appendChild(fpCell('delete', planCell('')));        // Delete column (empty)
  tfoot.appendChild(trF);
  table.appendChild(tfoot);

  function refresh() {
    // Hide the Radial / DME columns when neither a global reference VOR nor
    // any per-leg override is set.
    fillLegVorSelects();
    table.classList.toggle('no-vor', !anyVorActive());
    let td = 0, th = 0, tf = 0;
    const ac = aircraft;
    const taxiFuel = ac && ac.taxiGal && isAirport(state.waypoints[0]) ? ac.taxiGal : 0;
    if (taxiFuel) tf = taxiFuel;
    // Per-leg time/fuel accounting for climb & descent (#672); falls back to
    // flat cruise per leg when the profile engine is unavailable.
    const prof = typeof routeProfile === 'function' ? routeProfile(ac) : null;
    if (typeof drawProfileStripIfOpen === 'function') drawProfileStripIfOpen();
    for (let i = 0; i < state.legs.length; i++) {
      const A = state.waypoints[i], B = state.waypoints[i + 1];
      if (!A || !B) continue;
      const { dist, brg } = geo(A, B);
      distCells[i].textContent = dist.toFixed(1);
      hdgCells[i].textContent = pad3(toMagnetic(brg)) + '°M';
      if (radialCells[i]) {
        const rc = vorCells(A, state.legs[i]); // radial/DME to the leg's start
        radialCells[i].textContent = rc[0];
        dmeCells[i].textContent = rc[1];
      }
      const dur = prof && prof.legs[i] ? prof.legs[i].timeH
        : (state.legs[i].flightSpeed > 0 ? dist / state.legs[i].flightSpeed : 0);
      td += dist;
      th += dur;
      timeCells[i].textContent = dur > 0 ? toHMS(dur) : '--';
      if (ac) {
        const fuel = prof && prof.legs[i] ? prof.legs[i].fuel : dur * ac.gph;
        tf += fuel;
        const mark = i === 0 && taxiFuel;
        fuelCells[i].textContent = (mark ? fuel + taxiFuel : fuel).toFixed(1) + (mark ? ' *' : '');
        fuelCells[i].title = mark ? S.fpTaxiTip(taxiFuel) : '';
      } else {
        fuelCells[i].textContent = '--';
        fuelCells[i].title = '';
      }
      cumTimeCells[i].textContent = th > 0 ? toHMS(th) : '--';
      cumFuelCells[i].textContent = ac ? tf.toFixed(1) : '--';
      cumFuelCells[i].title = '';
      if (speedInputs[i] && document.activeElement !== speedInputs[i])
        speedInputs[i].value = state.legs[i].flightSpeed;
      if (altInputs[i] && document.activeElement !== altInputs[i])
        altInputs[i].value = altitudeInputValue(state.legs[i].inboundAltitude);
    }
    for (const wpIdx in wpInputs) {
      const wp = state.waypoints[wpIdx];
      if (!wp) continue;
      const beforeRaw = wp.name;
      normalizeWaypointSequenceName(wp);
      const clearedSeq = beforeRaw !== wp.name;
      const localized = navName((wp.name || '').trim());
      for (const inp of wpInputs[wpIdx]) {
        if (clearedSeq || document.activeElement !== inp) inp.value = localized;
      }
    }
    totDistCell.textContent = td.toFixed(1);
    totTimeCell.textContent = th > 0 ? toHMS(th) : '--';
    totFuelCell.textContent = ac ? tf.toFixed(1) : '--';
    totCumTimeCell.textContent = totTimeCell.textContent;
    totCumFuelCell.textContent = totFuelCell.textContent;
    // Keep the narrow-screen summary in step with the table it summarises.
    if (mobileSummary) {
      mobileSummary.textContent = (typeof S.fpMobileSummary === 'function')
        ? S.fpMobileSummary(state.legs.length, td.toFixed(1),
            th > 0 ? toHMS(th) : '--', ac ? tf.toFixed(1) : '--')
        : '';
    }
    if (freqActive) {
      freqSources = typeof routeFreqSources === 'function' ? routeFreqSources() : freqSources;
      for (let i = 0; i < freqCells.length; i++) {
        if (freqCells[i]) freqCells[i].textContent = legFreqText(i);
      }
    }
  }
  refresh();
  scrollArea.appendChild(table);
  // Above the horizontally-scrolling table, inside the same parent.
  if (scrollArea.parentElement) scrollArea.parentElement.insertBefore(mobileSummary, scrollArea);

  // --- return-route table (when showReturn is on) --------------------
  let retRefresh = null;
  if (window.showReturn) {
    const sub = document.createElement('div');
    sub.className = 'flight-plan-sub';
    sub.textContent = S.fpReturn;
    scrollArea.appendChild(sub);

    const rtable = document.createElement('table');
    rtable.className = 'flight-table';
    const rthead = document.createElement('thead');
    const rtrH = document.createElement('tr');
    buildHeadRow(rtrH);
    rthead.appendChild(rtrH);
    rtable.appendChild(rthead);

    const rtbody = document.createElement('tbody');
    const rAltInputs = [];
    const rSpeedInputs = [];
    const rDistCells = [];
    const rHdgCells = [];
    const rTimeCells = [];
    const rFuelCells = [];
    const rCumTimeCells = [];
    const rCumFuelCells = [];
    const rRadialCells = [];
    const rDmeCells = [];
    let rTotDistCell, rTotTimeCell, rTotFuelCell, rTotCumTimeCell, rTotCumFuelCell;

    for (let i = 0; i < state.legs.length; i++) {
      const ri = state.legs.length - 1 - i;   // reverse leg order — flyable from destination
      const leg = state.legs[ri];
      const A = state.waypoints[ri + 1], B = state.waypoints[ri];
      const { dist, brg } = geo(A, B);
      const tr = document.createElement('tr');
      tr.appendChild(fpCell('seq', planCell(String(i + 1))));
      tr.appendChild(fpCell('from', nameCell(ri + 1)));
      tr.appendChild(fpCell('to', nameCell(ri)));
      const hdgCell = planCell(pad3(toMagnetic(brg)) + '°M');
      tr.appendChild(fpCell('hdg', hdgCell));
      const distCell = planCell(dist.toFixed(1));
      tr.appendChild(fpCell('dist', distCell));
      const speedCell = numCell(leg.outboundSpeed, 1, inp => {
        const v = +inp.value;
        if (v > 0) {
          const oldVal = leg.outboundSpeed;
          leg.outboundSpeed = v;
          propagateAlt(ri, 'outboundSpeed', leg.outboundSpeed, oldVal);
          draw();
          refresh();
          retRefresh();
          refreshInspectorIfVisible();
        }
        else inp.value = leg.outboundSpeed;
      });
      rSpeedInputs[i] = speedCell.querySelector('.plan-num');
      tr.appendChild(fpCell('speed', speedCell));
      const altCell = numCell(leg.outboundAltitude, -2000, inp => {
        const raw = inp.value.trim();
        const oldVal = leg.outboundAltitude;
        if (!raw) {
          leg.outboundAltitude = NaN;
        } else {
          const v = Number(raw);
          if (!Number.isFinite(v)) { inp.value = altitudeInputValue(leg.outboundAltitude); return; }
          leg.outboundAltitude = Math.round(v);
        }
        propagateAlt(ri, 'outboundAltitude', leg.outboundAltitude, oldVal);
        draw();
        refresh();
        retRefresh();
        refreshInspectorIfVisible();
      });
      rAltInputs[i] = altCell.querySelector('.plan-num');
      rAltInputs[i].placeholder = legAltitudePlaceholder(leg, 'outboundAltitude');
      tr.appendChild(fpCell('alt', altCell));
      const timeCell = planCell('');
      rTimeCells[i] = timeCell;
      rDistCells[i] = distCell;
      rHdgCells[i] = hdgCell;
      tr.appendChild(fpCell('time', timeCell));
      const fuelCell = planCell('');
      rFuelCells[i] = fuelCell;
      tr.appendChild(fpCell('fuel', fuelCell));
      const cumTimeCell = planCell('');
      rCumTimeCells[i] = cumTimeCell;
      tr.appendChild(fpCell('cumTime', cumTimeCell));
      const cumFuelCell = planCell('');
      rCumFuelCells[i] = cumFuelCell;
      tr.appendChild(fpCell('cumFuel', cumFuelCell));
      const radial = radialCellWithPicker(ri);
      rRadialCells[i] = radial.val;
      tr.appendChild(fpCell('radial', radial.td));
      const dmeCell = planCell('');
      rDmeCells[i] = dmeCell;
      dmeCell.classList.add('fp-vor-col');
      tr.appendChild(fpCell('dme', dmeCell));
      if (freqActive) {
        const freqCell = planCell(legFreqText(ri));
        freqCell.classList.add('fp-freq-col');
        rFreqCells.push({ cell: freqCell, ri });
        tr.appendChild(fpCell('freq', freqCell));
      }
      tr.appendChild(fpCell('delete', planCell('')));        // Delete column (empty — forward table only)
      rtbody.appendChild(tr);
    }
    rtable.appendChild(rtbody);

    const rtfoot = document.createElement('tfoot');
    const rtrF = document.createElement('tr');
    const rtdLabel = document.createElement('td');
    rtdLabel.colSpan = 4;
    rtdLabel.className = 'fp-total-label';
    rtdLabel.textContent = S.fpTotal;
    fpTotalLabels.push(rtdLabel);
    rtrF.appendChild(rtdLabel);
    rTotDistCell = fpCell('dist', planCell(''));
    rtrF.appendChild(rTotDistCell);
    rtrF.appendChild(fpCell('speed', planCell('')));
    rtrF.appendChild(fpCell('alt', planCell('')));
    rTotTimeCell = planCell('');
    rtrF.appendChild(fpCell('time', rTotTimeCell));
    rTotFuelCell = planCell('');
    rtrF.appendChild(fpCell('fuel', rTotFuelCell));
    rTotCumTimeCell = planCell('');
    rtrF.appendChild(fpCell('cumTime', rTotCumTimeCell));
    rTotCumFuelCell = planCell('');
    rtrF.appendChild(fpCell('cumFuel', rTotCumFuelCell));
    const rTotRadial = planCell(''); rTotRadial.classList.add('fp-vor-col'); rtrF.appendChild(fpCell('radial', rTotRadial));
    const rTotDme = planCell(''); rTotDme.classList.add('fp-vor-col'); rtrF.appendChild(fpCell('dme', rTotDme));
    if (freqActive) { const rtf = planCell(''); rtf.classList.add('fp-freq-col'); rtrF.appendChild(fpCell('freq', rtf)); }
    rtrF.appendChild(fpCell('delete', planCell('')));        // Delete column (empty)
    rtfoot.appendChild(rtrF);
    rtable.appendChild(rtfoot);


    retRefresh = function () {
      if (state.legs.length !== rDistCells.length) { closeFlightPlan(); return; }
      rtable.classList.toggle('no-vor', !anyVorActive());
      let td = 0, th = 0, tf = 0;
      const retTaxi = aircraft && aircraft.taxiGal && isAirport(state.waypoints[state.waypoints.length - 1]) ? aircraft.taxiGal : 0;
      if (retTaxi) tf = retTaxi;
      for (let i = 0; i < state.legs.length; i++) {
        const ri = state.legs.length - 1 - i;
        const A = state.waypoints[ri + 1], B = state.waypoints[ri];
        if (!A || !B) continue;
        const { dist, brg } = geo(A, B);
        rDistCells[i].textContent = dist.toFixed(1);
        rHdgCells[i].textContent = pad3(toMagnetic(brg)) + '°M';
        if (rRadialCells[i]) {
          const rc = vorCells(A, state.legs[ri]); // radial/DME to leg start
          rRadialCells[i].textContent = rc[0];
          rDmeCells[i].textContent = rc[1];
        }
        const dur = state.legs[ri].outboundSpeed > 0 ? dist / state.legs[ri].outboundSpeed : 0;
        td += dist;
        th += dur;
        rTimeCells[i].textContent = dur > 0 ? toHMS(dur) : '--';
        if (aircraft) {
          const fuel = dur * aircraft.gph;
          tf += fuel;
          const mark = i === 0 && retTaxi;
          rFuelCells[i].textContent = (mark ? fuel + retTaxi : fuel).toFixed(1) + (mark ? ' *' : '');
          rFuelCells[i].title = mark ? S.fpTaxiTip(retTaxi) : '';
        } else {
          rFuelCells[i].textContent = '--';
          rFuelCells[i].title = '';
        }
        rCumTimeCells[i].textContent = th > 0 ? toHMS(th) : '--';
        rCumFuelCells[i].textContent = aircraft ? tf.toFixed(1) : '--';
        rCumFuelCells[i].title = '';
        if (rSpeedInputs[i] && document.activeElement !== rSpeedInputs[i])
          rSpeedInputs[i].value = state.legs[ri].outboundSpeed;
        if (rAltInputs[i] && document.activeElement !== rAltInputs[i])
          rAltInputs[i].value = altitudeInputValue(state.legs[ri].outboundAltitude);
      }
      rTotDistCell.textContent = td.toFixed(1);
      rTotTimeCell.textContent = th > 0 ? toHMS(th) : '--';
      rTotFuelCell.textContent = aircraft ? tf.toFixed(1) : '--';
      rTotCumTimeCell.textContent = rTotTimeCell.textContent;
      rTotCumFuelCell.textContent = rTotFuelCell.textContent;
      for (const rc of rFreqCells) if (rc.cell) rc.cell.textContent = legFreqText(rc.ri);
    };
    retRefresh();
    scrollArea.appendChild(rtable);
  }
  syncFpColumnVisibility();

  function flightPlanCsv() {
    const visibleHeaders = Array.from(table.querySelectorAll('thead th'))
      .filter(th => !(th.classList && th.classList.contains('fp-col-hidden')))
      // data-csv is the stable export name; the visible text may carry units or other
      // wording that must never reach the file.
      .map(th => (th.dataset && th.dataset.csv) || th.textContent || '')
      .filter(h => h.trim() !== '');
    const columnCount = visibleHeaders.length;
    const csvCell = value => {
      const s = String(value == null ? '' : value).replace(/\r?\n|\r/g, ' ').trim();
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rowValues = row => {
      const values = [];
      for (const cell of row.children) {
        if (cell.classList && cell.classList.contains('fp-del')) continue;
        if (cell.classList && cell.classList.contains('fp-col-hidden')) continue;
        const span = Math.max(1, cell.colSpan || 1);
        const input = cell.querySelector('input');
        const radialVal = cell.querySelector('.fp-radial-val');
        const value = input ? input.value
          : (radialVal ? radialVal.textContent : cell.textContent);
        values.push(value);
        for (let i = 1; i < span && values.length < columnCount; i++) values.push('');
        if (values.length >= columnCount) break;
      }
      while (values.length < columnCount) values.push('');
      return values.slice(0, columnCount);
    };
    const addTable = (rows, section, planTable) => {
      rows.push([section]);
      rows.push(visibleHeaders);
      planTable.querySelectorAll('tbody tr, tfoot tr').forEach(row => {
        rows.push(rowValues(row));
      });
    };
    const rows = [];
    const tables = Array.from(scrollArea.querySelectorAll('.flight-table'));
    tables.forEach((planTable, idx) => {
      if (idx > 0) rows.push([]);
      addTable(rows, idx === 0 ? S.flightPlan : S.fpReturn, planTable);
    });
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function exportFlightPlanCsv() {
    const blob = new Blob(['\ufeff', flightPlanCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flight-plan-' + routeFileSlug() + '-' + fileStamp() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // #674 \u2014 kneeboard nav-log: open a clean, print-ready document (header +
  // per-leg table(s) + frequency list) in a new window and trigger print, so
  // the pilot saves a PDF via the browser. Renders Hebrew RTL natively.
  function exportNavLog() {
    if (state.waypoints.length < 2) { alert(S.errNeedWps); return; }
    const esc = s => String(s == null ? '' : s)
      .replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const lang = (window.__navLang === 'he') ? 'he' : 'en';
    const dir = lang === 'he' ? 'rtl' : 'ltr';
    const dep = esc(wpLabel(0));
    const dest = esc(wpLabel(state.waypoints.length - 1));

    // Per-leg table(s): clone the live flight-plan tables, freeze inputs to
    // their current values, and drop the delete column.
    const tablesHtml = Array.from(scrollArea.querySelectorAll('.flight-table')).map(t => {
      const clone = t.cloneNode(true);
      // cloneNode copies attributes, not live .value state (a <select>'s
      // selection resets to its first option) — read each value from the
      // ORIGINAL element, pairing originals and clones by document order.
      const origEls = t.querySelectorAll('input, select');
      clone.querySelectorAll('input, select').forEach((el, i) => {
        const live = origEls[i];
        const val = live ? live.value : el.value;
        const span = document.createElement('span');
        if (el.classList.contains('fp-leg-vor')) {
          // Per-leg VOR picker: print the EFFECTIVE ident (override or the
          // route-wide reference), so each Radial row says which VOR it's from.
          const ident = val || (typeof vorRef === 'string' && vorRef) || '';
          span.textContent = ident ? ident + ' ' : '';
          span.className = 'nl-vor-ident';
        } else {
          span.textContent = val || '';
        }
        el.replaceWith(span);
      });
      clone.querySelectorAll('.fp-col-hidden').forEach(el => el.remove());
      clone.querySelectorAll('[data-fp-col="delete"], .fp-del').forEach(el => el.remove());
      // The delete column has no .fp-del marker in the header / Total rows —
      // it's just an empty trailing cell. Drop it so the table has no stray
      // box on the far side (tbody delete cells were removed above).
      const headRow = clone.querySelector('thead tr');
      if (headRow && headRow.lastElementChild &&
          !headRow.lastElementChild.textContent.trim()) headRow.lastElementChild.remove();
      clone.querySelectorAll('tfoot tr').forEach(tr => {
        if (tr.lastElementChild && !tr.lastElementChild.textContent.trim()) {
          tr.lastElementChild.remove();
        }
      });
      return clone.outerHTML;
    }).join('<div class="nl-gap"></div>');

    // Wrap LTR content (codes, frequencies) in an isolate so it doesn't
    // reorder against surrounding Hebrew in the RTL nav log.
    const ltr = s => '<span dir="ltr" style="unicode-bidi:isolate">' + esc(s) + '</span>';
    // Frequency list from comm-change callout notes on the route. Use route
    // waypoint order, not note insertion order, so the kneeboard reads along
    // the flight path. The label uses the localized call-sign name (Hebrew in
    // he mode), not the raw catalog id.
    const routeNoteOrder = item => {
      const wpi = item && Number.isInteger(item.wpi) && item.wpi >= 0
        ? item.wpi : Number.MAX_SAFE_INTEGER;
      return wpi;
    };
    const freqs = (state.notes || [])
      .map((n, idx) => ({
        n,
        idx,
        wpi: (n && n.cc && typeof commCalloutWaypointIndex === 'function')
          ? commCalloutWaypointIndex(n) : -1,
      }))
      .filter(item => item.n && item.n.cc)
      .sort((a, b) => routeNoteOrder(a) - routeNoteOrder(b) || a.idx - b.idx)
      .map(({ n }) => {
      const wp = (typeof navName === 'function' ? navName(n.cc) : n.cc) || n.cc;
      const name = typeof commNoteName === 'function' ? commNoteName(n) : (n.freqName || '');
      const fq = typeof commNoteFreq === 'function' ? commNoteFreq(n) : (n.freq || '');
      return '<li>' + esc(wp) + (name ? ' \u2014 ' + esc(name) : '') +
        (fq ? ' \u2014 ' + ltr(fq + ' MHz') : '') + '</li>';
    }).join('');

    // Airport frequency block (tower/primary + clearance + ATIS) for the
    // departure and arrival airfields.
    const airfieldFreqHtml = (wp, code, sectionLabel) => {
      const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
      if (!af) return '';
      const item = (label, val) => '<li>' + esc(label) + ' — ' + ltr(val) + '</li>';
      const items = [];
      const primary = typeof airfieldPrimaryText === 'function' ? airfieldPrimaryText(af) : '';
      if (primary) items.push(item(S.primary || 'Primary', primary));
      const clr = typeof airfieldClearanceText === 'function' ? airfieldClearanceText(af) : '';
      if (clr) items.push(item(S.clearance || 'Clearance', clr));
      const atis = typeof airfieldAtisText === 'function' ? airfieldAtisText(af) : '';
      if (atis) items.push(item(S.atis || 'ATIS', atis));
      if (!items.length) return '';
      return '<h2>' + ltr(code) + ' — ' + esc(sectionLabel) + '</h2><ul>' + items.join('') + '</ul>';
    };
    const lastIdx = state.waypoints.length - 1;
    let depFreqHtml = airfieldFreqHtml(state.waypoints[0], wpLabel(0),
      S.navLogDepFreqs || 'Departure frequencies');
    if (lastIdx > 0) {
      depFreqHtml += airfieldFreqHtml(state.waypoints[lastIdx], wpLabel(lastIdx),
        S.navLogArrFreqs || 'Arrival frequencies');
    }

    // Reference VOR(s) feeding the Radial/DME columns — the route-wide
    // selection plus any distinct per-leg overrides — with their frequencies,
    // so the printed log carries what to tune.
    const vorIdents = [];
    const pushVor = id => {
      if (id && typeof id === 'string' && !vorIdents.includes(id)) vorIdents.push(id);
    };
    pushVor(typeof vorRef === 'string' ? vorRef : null);
    (state.legs || []).forEach(l => pushVor(l && l.vorRef));
    const vorHtml = vorIdents
      .map(id => (typeof vorByIdent === 'function' ? vorByIdent(id) : null))
      .filter(Boolean)
      .map(v => ltr(v.ident) + ' \u2014 ' + esc((lang === 'he' && v.he) ? v.he : v.name) +
                (v.freq ? ' \u2014 ' + ltr(v.freq + ' MHz') : ''))
      .join(' \u00b7 ');

    const ac = (typeof aircraft === 'object' && aircraft) ? aircraft : { gph: tune('defaultGph'), taxiGal: tune('defaultTaxiGal') };
    const today = new Date().toISOString().slice(0, 10);
    const title = (S.navLogTitle || 'NavAid \u2014 Nav Log') + ' \u00b7 ' + dep + ' \u2192 ' + dest;

    const html =
      '<!DOCTYPE html><html lang="' + lang + '" dir="' + dir + '"><head>' +
      '<meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
      '@page{size:A4 portrait;margin:12mm}' +
      'body{font:13px/1.4 system-ui,Arial,sans-serif;color:#111;margin:0}' +
      'h1{font-size:18px;margin:0 0 2px}.nl-sub{color:#555;margin:0 0 10px}' +
      '.nl-meta{margin:0 0 12px}.nl-meta b{display:inline-block;min-width:110px}' +
      'table{border-collapse:collapse;width:100%;font-size:12px}' +
      'th,td{border:1px solid #999;padding:3px 5px;text-align:' +
        (dir === 'rtl' ? 'right' : 'left') + '}' +
      'thead th{background:#eee}.nl-gap{height:14px}' +
      '.nl-vor-ident{font-weight:600;color:#555;margin-inline-end:2px}' +
      'h2{font-size:14px;margin:16px 0 4px}ul{margin:4px 0;padding-inline-start:18px}' +
      '</style></head><body>' +
      '<h1>' + esc(S.navLogTitle || 'NavAid \u2014 Nav Log') + '</h1>' +
      '<p class="nl-sub">' + dep + ' \u2192 ' + dest + '</p>' +
      '<div class="nl-meta">' +
        '<div><b>' + esc(S.navLogDate || 'Date') + ':</b> ' + today + '</div>' +
        '<div><b>' + esc(S.tbAircraft || 'Aircraft') + ':</b> ' +
          esc(S.tbGph || 'GPH') + ' ' + esc(ac.gph) + ' \u00b7 ' +
          esc(S.tbTaxiGal || 'Taxi/T.O.') + ' ' + esc(ac.taxiGal) + '</div>' +
        (vorHtml ? '<div><b>' + esc(S.navLogVor || 'Reference VOR') + ':</b> ' + vorHtml + '</div>' : '') +
      '</div>' +
      depFreqHtml +
      tablesHtml +
      (freqs ? '<h2>' + esc(S.navLogFreqs || 'Frequencies') + '</h2><ul>' + freqs + '</ul>' : '') +
      '</body></html>';

    const w = window.open('', '_blank');
    if (!w) { alert(S.navLogPopupBlocked || 'Allow pop-ups to export the nav log.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 300);
  }

  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.textContent = S.fpPrint;
  printBtn.onclick = () => {
    const pageStyle = document.createElement('style');
    pageStyle.textContent = '@page { size: A4 landscape; margin: 8mm; }';
    const cleanup = () => {
      document.body.classList.remove('printing-plan');
      pageStyle.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    document.head.appendChild(pageStyle);
    document.body.classList.add('printing-plan');
    window.print();
    setTimeout(cleanup, 4000);           // belt-and-braces for Safari
  };
  btns.appendChild(printBtn);
  const csvBtn = document.createElement('button');
  csvBtn.type = 'button';
  csvBtn.textContent = S.fpCsv || 'CSV';
  csvBtn.title = S.fpCsvTitle || 'Export this flight plan as CSV';
  csvBtn.onclick = exportFlightPlanCsv;
  btns.appendChild(csvBtn);
  const navLogBtn = document.createElement('button');
  navLogBtn.type = 'button';
  navLogBtn.textContent = S.tbNavLog || 'Nav log (PDF)';
  navLogBtn.title = S.tbNavLogTitle || 'Open a printable kneeboard nav log (save as PDF)';
  navLogBtn.onclick = exportNavLog;
  btns.appendChild(navLogBtn);
  box.appendChild(btns);
  addModalCloseX(box, closeFlightPlan);

  back.appendChild(box);
  // Close via the Close button or Escape (#86).
  document.body.appendChild(back);
  flightPlanBack = back;
  // #78: keep the modal in sync with the live route. draw() calls this after
  // each redraw so dragging a waypoint or reversing the route updates dist /
  // hdg / time / total. A leg-count change (delete wp, import, clear) tears
  // the modal down and re-opens it on the next tick so input handlers rebind
  // against the new leg array (the old fix just closed it — the rebuild is a
  // strictly better UX so the pilot doesn't lose the plan view on edits).
  refreshFlightPlan = retRefresh
    ? function () {
        if (state.legs.length !== distCells.length) {
          closeFlightPlan();
          setTimeout(showFlightPlan, 0);
          return;
        }
        refresh();
        retRefresh();
      }
    : function () {
        if (state.legs.length !== distCells.length) {
          closeFlightPlan();
          setTimeout(showFlightPlan, 0);
          return;
        }
        refresh();
      };
  flightPlanEscape = function (e) {
    if (e.key !== 'Escape') return;
    closeFlightPlan();
    // The global window-level Escape handler in interact.js otherwise runs
    // after this one and toggles the magnifier off whenever the plan is
    // closed while the loupe is open (issue #388 M3 follow-up). Stop the
    // event from bubbling past `document` so the loupe — which has no
    // logical relationship to the plan modal — keeps its current state.
    e.stopPropagation();
    e.preventDefault();
  };
  document.addEventListener('keydown', flightPlanEscape);
  fpOpen = true;
  // navaid.fpOpen is already cleared by closeFlightPlan(); on a fresh open
  // there's nothing to remove. The redundant call lived here for a while —
  // dropping it to keep showFlightPlan() side-effect-symmetric.
  // refresh() ran above before the modal was mounted, so the profile canvas
  // was still disconnected and drawProfileStripIfOpen() bailed out — the
  // strip stayed blank until the first edit. Now that `back` is in the DOM,
  // draw it once (rAF so the canvas has its laid-out clientWidth). #672
  if (typeof drawProfileStripIfOpen === 'function') {
    requestAnimationFrame(drawProfileStripIfOpen);
  }
  // The Freq column's airfield primary needs the comm call-sign catalog; it's
  // not loaded eagerly, so pull it (and airfields) then recompute the column so
  // the first leg from an airfield shows its tower frequency.
  if (freqActive && typeof loadCommChange === 'function') {
    Promise.all([
      loadCommChange(),
      typeof loadAirfields === 'function' ? loadAirfields() : null,
    ]).then(() => { if (fpOpen) { refresh(); if (typeof retRefresh === 'function') retRefresh(); } });
  }
}

function planCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

// Modal: pick Landscape or Portrait (named buttons, not OK/Cancel).
function chooseOrientation(size, onPick) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = size + S.pageOrientation;
  addModalCloseX(box, () => { document.removeEventListener('keydown', onEsc); back.remove(); });
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  // #86: Escape closes the picker (counts as cancel).
  function onEsc(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.removeEventListener('keydown', onEsc);
    back.remove();
  }
  for (const [label, val] of [[S.landscape, 'landscape'], [S.portrait, 'portrait']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { close(); onPick(val); };
    btns.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.textContent = S.cancel;
  cancel.className = 'modal-cancel';
  cancel.onclick = close;
  btns.appendChild(cancel);
  box.append(title, btns);
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) close(); };
  document.body.appendChild(back);
  document.addEventListener('keydown', onEsc);
}

// Timestamp for unique download names — avoids browser " (1)" suffixes.
function fileStamp() {
  return new Date().toISOString().slice(0, 19)
    .replace(/[-:]/g, '').replace('T', '-');
}
// Filename-safe "dep-to-dest" slug from the route endpoints, mirroring the
// saved-route naming (defaultSavedRouteName) so a downloaded file is named for
// its route instead of a bare "route-". Prefers the localised display name
// (navName); if ASCII-sanitising that leaves nothing (e.g. a Hebrew-only
// label), falls back to the raw canonical name, then to 'route'.
function routeFileSlug() {
  const slug = s => String(s || '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 24);
  const clean = (w) => {
    const raw = (w && w.name) ? String(w.name).trim() : '';
    const disp = (raw && typeof navName === 'function') ? navName(raw) : raw;
    return slug(disp) || slug(raw);
  };
  const wps = state.waypoints;
  if (wps && wps.length >= 2) {
    const a = clean(wps[0]);
    const b = clean(wps[wps.length - 1]);
    if (a && b) return a + '-to-' + b;
    if (a || b) return a || b;
  }
  return 'route';
}

// Plain-language SIGMET list (clicking the corner readout). Each entry shows
// the decoded sentence plus the raw text underneath.
function showSigmetDecoded() {
  if (!Array.isArray(sigmets) || !sigmets.length) return;
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.cssText = 'max-width:560px;max-height:80vh;overflow:auto';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.sigmetModalTitle || 'Active SIGMETs';
  box.appendChild(title);
  function close() { window.removeEventListener('keydown', onEsc); back.remove(); }
  function onEsc(e) { if (e.key === 'Escape') close(); }
  addModalCloseX(box, close);
  for (const s of sigmets) {
    const item = document.createElement('div');
    item.dir = 'ltr';                 // SIGMET text is LTR even in Hebrew mode
    item.style.cssText = 'margin:10px 0;padding:8px;border-left:4px solid ' +
      sigmetHazardColor(s.hazard) + ';background:rgba(255,255,255,0.04);direction:ltr;text-align:left';
    const dec = document.createElement('div');
    dec.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:4px';
    dec.textContent = decodeSigmet(s);
    item.appendChild(dec);
    if (s.raw) {
      const raw = document.createElement('div');
      raw.style.cssText = 'font:11px/1.4 monospace;color:#b9b3b3;white-space:pre-wrap';
      raw.textContent = (S.sigmetRaw || 'Raw') + ': ' + s.raw;
      item.appendChild(raw);
    }
    box.appendChild(item);
  }
  back.appendChild(box);
  document.body.appendChild(back);
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  window.addEventListener('keydown', onEsc);
}

// Show a pre-export modal so the user can decide which overlays and base
// layer appear in the PNG, independently of the current screen settings.
// True when the Print section head sits on the toolbar's top row. When the
// desktop menu bar wraps and the "🖨 Print" head drops to a second row (no
// longer inline with the other section heads) this returns false, so the print
// menu opens as the centered mobile modal instead of floating over a cramped,
// two-row toolbar.
function exportPrintOnTopLine() {
  const heads = document.querySelectorAll('#toolbar .tb-section:not(.tb-standalone) .tb-section-head');
  const printHead = document.querySelector('#toolbar .tb-section[data-sec="print"] .tb-section-head');
  if (!heads.length || !printHead) return true;
  let minTop = Infinity;
  heads.forEach(h => { const t = h.getBoundingClientRect().top; if (t < minTop) minTop = t; });
  return printHead.getBoundingClientRect().top <= minTop + 6;
}
function showExportModal() {
  if (!aircraft && typeof loadAircraft === 'function') loadAircraft();   // for the plan card's Fuel column
  // On desktop the print/export menu is a floating panel at the inspector's
  // default location (top-right), not a centered modal — the map stays visible
  // and interactive underneath so the plan card can be dragged straight away.
  // In mobile toolbar mode (the Print button no longer fits inline with the
  // others) it falls back to the centered, dimmed modal. `export-place` makes
  // the backdrop transparent + click-through; `.export-floating` pins the box
  // to the inspector spot.
  // `let`: the fit check after the panel is in the DOM can demote it to the
  // centered modal, and syncPlaceThrough() reads the current value.
  let floatPanel = ((typeof toolbarUsesDesktopMenu !== 'function') || toolbarUsesDesktopMenu())
    && exportPrintOnTopLine();
  const back = document.createElement('div');
  back.className = floatPanel ? 'modal-back export-place' : 'modal-back';
  const box = document.createElement('div');
  box.className = floatPanel ? 'modal export-floating' : 'modal';
  // Floating panel occupies the inspector spot — hide the inspector to avoid
  // overlap; it returns on the next selection.
  if (floatPanel) {
    const inspEl = document.getElementById('inspector');
    if (inspEl) inspEl.classList.add('hidden');
  }
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.exportModalTitle;
  box.appendChild(title);

  addModalCloseX(box, () => { restoreOrig(); close(); });

  // Drag to reposition the modal via the title bar.
  let drag = null;
  title.addEventListener('mousedown', function (e) {
    const r = box.getBoundingClientRect();
    drag = { ox: e.clientX - r.left, oy: e.clientY - r.top };
    box.style.position = 'fixed';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.margin = '0';
    const onMove = function (e) {
      if (!drag) return;
      // Clamp to the viewport so the title bar + ✕ stay reachable. Same
      // pattern the flight-plan modal already uses.
      const x = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, e.clientX - drag.ox));
      const y = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, e.clientY - drag.oy));
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    };
    const onUp = function () {
      drag = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:4px 0';

  // Show waypoint names checkbox (default on).
  const wpNameLabel = document.createElement('label');
  wpNameLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const wpNameCb = document.createElement('input');
  wpNameCb.type = 'checkbox';
  wpNameCb.checked = true;
  wpNameLabel.appendChild(wpNameCb);
  wpNameLabel.appendChild(document.createTextNode(S.exportShowWpNames));
  body.appendChild(wpNameLabel);

  // Show Drift Lines checkbox (default on).
  const driftLabel = document.createElement('label');
  driftLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const driftCb = document.createElement('input');
  driftCb.type = 'checkbox';
  driftCb.checked = true;
  driftLabel.appendChild(driftCb);
  driftLabel.appendChild(document.createTextNode(S.exportShowDrift));
  body.appendChild(driftLabel);

  // Show Cumulative time checkbox (default on).
  const cumLabel = document.createElement('label');
  cumLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const cumCb = document.createElement('input');
  cumCb.type = 'checkbox';
  cumCb.checked = true;
  cumLabel.appendChild(cumCb);
  cumLabel.appendChild(document.createTextNode(
    S.exportShowCumTime || S.tbShowCumTime || 'Show cumulative time'));
  body.appendChild(cumLabel);

  // Show Nav Waypoints checkbox.
  const navWpLabel = document.createElement('label');
  navWpLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const navWpCb = document.createElement('input');
  navWpCb.type = 'checkbox';
  navWpCb.checked = false;
  navWpLabel.appendChild(navWpCb);
  navWpLabel.appendChild(document.createTextNode(S.exportShowNavWP));
  body.appendChild(navWpLabel);

  // Show Airfields checkbox.
  const afLabel = document.createElement('label');
  afLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const afCb = document.createElement('input');
  afCb.type = 'checkbox';
  afCb.checked = false;
  afLabel.appendChild(afCb);
  afLabel.appendChild(document.createTextNode(S.exportShowAirfields));
  body.appendChild(afLabel);

  // Place flight-plan table on the export (#378). Drag it on the live map.
  const planLabel = document.createElement('label');
  planLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  planLabel.title = S.exportPlanPlaceTitle || '';
  const planCb = document.createElement('input');
  planCb.type = 'checkbox';
  planCb.id = 'export-plan-cb';
  planCb.checked = false;
  // Needs a route (at least one leg) to tabulate — a page frame is NOT
  // required; without one the card is placed on the current view. The enabled
  // state + label are kept live (updateExportPlanCb, called from draw) so
  // adding a route while this panel is open enables it immediately.
  planLabel.appendChild(planCb);
  const planLabelText = document.createElement('span');
  planLabelText.id = 'export-plan-cb-label';
  planLabel.appendChild(planLabelText);
  body.appendChild(planLabel);

  // Reference VOR selector — pick a VOR; its station + radial/DME lines to the
  // route waypoints are drawn on the map (preview + exported PNG). Shares the
  // global vorRef with the map / flight-plan.
  const vorRow = document.createElement('div');
  vorRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px';
  const vorLbl = document.createElement('span');
  vorLbl.textContent = (S.fpVorLabel || 'VOR') + ':';
  vorRow.appendChild(vorLbl);
  const vorSel = document.createElement('select');
  vorSel.id = 'export-vor-select';
  vorSel.style.cssText = 'font:inherit;font-size:12px;flex:1';
  function fillExportVorSelect() {
    vorSel.innerHTML = '';
    const none = document.createElement('option');
    none.value = ''; none.textContent = S.vorRefNone || '— none —';
    vorSel.appendChild(none);
    for (const v of (vors || [])) {
      const opt = document.createElement('option');
      opt.value = v.ident;
      opt.textContent = v.ident + ' · ' + v.name;
      vorSel.appendChild(opt);
    }
    vorSel.value = vorRef || '';
  }
  fillExportVorSelect();
  if (vors === null && typeof loadVors === 'function') {
    loadVors().then(() => { fillExportVorSelect(); draw(); });
  }
  vorSel.onchange = function () {
    window.vorRef = vorSel.value || null;
    try {
      if (vorRef) localStorage.setItem('navaid.vorRef', vorRef);
      else localStorage.removeItem('navaid.vorRef');
    } catch (e) { /* */ }
    const tbVor = document.getElementById('vor-ref-select');   // keep the toolbar in sync
    if (tbVor) tbVor.value = vorRef || '';
    draw();
  };
  vorRow.appendChild(vorSel);
  // VOR only affects the plan card's Radial/DME columns — show it only when the
  // flight-plan card is being added.
  vorRow.style.display = planCb.checked ? '' : 'none';
  body.appendChild(vorRow);

  // The plan card's Freq column needs the comm catalog + airfields to resolve
  // the departure/arrival airport frequencies — load them, then redraw.
  Promise.all([
    typeof loadCommChange === 'function' ? loadCommChange() : null,
    typeof loadAirfields === 'function' ? loadAirfields() : null,
  ]).then(() => draw());

  // Layer selector.
  const layerRow = document.createElement('div');
  layerRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px';
  const layerLbl = document.createElement('span');
  layerLbl.textContent = S.exportLayer;
  layerRow.appendChild(layerLbl);
  const layerSel = document.createElement('select');
  layerSel.id = 'export-layer-select';
  layerSel.style.cssText = 'font:inherit;font-size:12px;flex:1';
  for (const name in layers) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = (S.layerLabels && S.layerLabels[name]) || name;
    if (name === 'Navigation') opt.selected = true;
    layerSel.appendChild(opt);
  }
  layerRow.appendChild(layerSel);
  body.appendChild(layerRow);

  // Map opacity slider.
  const opacityRow = document.createElement('div');
  opacityRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px';
  const opLbl = document.createElement('span');
  opLbl.textContent = S.tbMapOpacity;
  opacityRow.appendChild(opLbl);
  const opSlider = document.createElement('input');
  opSlider.type = 'range';
  opSlider.min = '10';
  opSlider.max = '100';
  opSlider.step = '5';
  opSlider.value = Math.round(mapOpacity * 100);
  opSlider.style.cssText = 'flex:1;height:16px;accent-color:#ffd966';
  opacityRow.appendChild(opSlider);
  const opVal = document.createElement('span');
  opVal.style.cssText = 'width:2.2em;text-align:right;font-size:12px';
  opVal.textContent = opSlider.value + '%';
  opacityRow.appendChild(opVal);
  const opResetBtn = document.createElement('button');
  opResetBtn.type = 'button';
  opResetBtn.className = 'slider-reset';
  opResetBtn.textContent = '↻';
  opResetBtn.title = S.sliderReset || 'Reset to default';
  opResetBtn.setAttribute('aria-label', opResetBtn.title);
  opacityRow.appendChild(opResetBtn);
  body.appendChild(opacityRow);

  // Page-size warning — red + blinking, and kept live (updateExportPageWarn is
  // called from refreshPageButtons, so toggling A3/A4 while this panel is open
  // shows/hides it immediately).
  const pageWarn = document.createElement('div');
  pageWarn.id = 'export-page-warn';
  pageWarn.style.cssText = 'font-size:12px;color:#e53935;font-weight:600;padding:2px 0';
  body.appendChild(pageWarn);

  box.appendChild(body);

  // Save original state (before applying defaults) so Cancel can restore.
  const origNavWP = showNavWP;
  const origAirfields = showAirfields;
  const origWpNames = showWpNames;
  const origDrift = showDrift;
  const origCumTime = showCumTime;
  const origMapOpacity = mapOpacity;
  const origLayer = (function () {
    for (const n in layers) if (map.hasLayer(layers[n])) return n;
    return null;
  })();

  // Apply the modal's default state immediately so the user sees what
  // the PNG will look like before touching any control.
  showNavWP = navWpCb.checked;
  showWpNames = wpNameCb.checked;
  showDrift = driftCb.checked;
  showCumTime = cumCb.checked;
  showAirfields = afCb.checked;
  const chosen = layerSel.value;
  if (chosen !== origLayer) {
    for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
    map.addLayer(layers[chosen]);
  }
  draw();

  // Buttons.
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const exportBtn = document.createElement('button');
  exportBtn.textContent = S.exportBtn;
  const printBtn = document.createElement('button');
  printBtn.textContent = S.printBtn || 'Print';
  printBtn.title = S.printBtnTitle || 'Open the print dialog at true physical size';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = S.cancel;
  cancelBtn.className = 'modal-cancel';

  // Bounds the plan card lives in. With a page frame that is the frame; without
  // one the exporter captures the viewport, so the viewport IS the page. Both the
  // auto-shrink and the drag/resize clamps were gated on a frame existing, so
  // once the checkbox stopped requiring a page the card could be placed at scale
  // 1 and dragged clean off-screen — ending up clipped or missing in the PNG.
  function planBounds() {
    const fr = pageFrameRect();
    if (fr) return fr;
    const s = map.getSize();
    return { x: 0, y: 0, w: s.x, h: s.y };
  }
  // Keep the backdrop click-through while a card is placed (or while floating).
  function syncPlaceThrough() {
    const placing = !!(planCb && planCb.checked && planCard);
    back.classList.toggle('export-place', floatPanel || placing);
  }
  // updateExportPlanCb() can clear the card from OUTSIDE this closure (the route was
  // cleared while the panel is open), and it has to be able to re-sync the backdrop.
  window.__exportSyncPlaceThrough = syncPlaceThrough;

  // Undo the panel's preview by restoring each value from the TOOLBAR control that
  // owns it, rather than from a snapshot taken when the panel opened. The panel is
  // click-through, so the toolbar stays usable while it is open: replaying an
  // open-time snapshot silently undid changes made there, and comparing the current
  // value against what the panel last set cannot tell "the panel still owns this"
  // from "the user set it to the same boolean from the toolbar" — for a boolean the
  // two are indistinguishable. The checkbox IS the user-facing truth, so reading it
  // back can never leave the control and the render disagreeing.
  function restoreOrig() {
    const cb = id => document.getElementById(id);
    const chk = (id, fallback) => { const e = cb(id); return e ? e.checked : fallback; };
    showNavWP = chk('navwp-cb', origNavWP);
    showWpNames = chk('wpname-cb', origWpNames);
    showDrift = chk('drift-cb', origDrift);
    showCumTime = chk('cumtime-cb', origCumTime);
    showAirfields = chk('airfield-cb', origAirfields);
    const sel = cb('layer-select');
    const wantLayer = (sel && layers[sel.value]) ? sel.value : origLayer;
    const cur = (function () {
      for (const n in layers) if (map.hasLayer(layers[n])) return n;
      return null;
    })();
    if (cur !== wantLayer) {
      for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
      if (wantLayer) map.addLayer(layers[wantLayer]);
    }
    const opEl = cb('map-opacity');
    const opVal = opEl ? parseFloat(opEl.value) / 100 : NaN;
    mapOpacity = Number.isFinite(opVal) ? opVal : origMapOpacity;
    applyMapOpacity();
    window.planCard = null;            // drop the placed card (export already captured it)
    draw();
  }

  // Live preview: apply changes to the map immediately. Each handler records that
  // the PANEL owns this value, so cancel reverts it — and leaves alone anything
  // the user changed from the toolbar while the panel was open.
  navWpCb.onchange = function () {
    showNavWP = navWpCb.checked;
    draw();
  };
  wpNameCb.onchange = function () {
    showWpNames = wpNameCb.checked;
    draw();
  };
  driftCb.onchange = function () {
    showDrift = driftCb.checked;
    draw();
  };
  cumCb.onchange = function () {
    showCumTime = cumCb.checked;
    draw();
  };
  afCb.onchange = function () {
    showAirfields = afCb.checked;
    draw();
  };

  // Flight-plan card placement: toggle + drag on the live map.
  window.planCard = null;                              // fresh each open
  planCb.onchange = function () {
    const fr0 = planBounds();
    if (planCb.checked) {
      window.planCard = { x: fr0.x + 14, y: fr0.y + 14, scale: 1 };
    } else {
      window.planCard = null;
    }
    vorRow.style.display = planCb.checked ? '' : 'none';   // VOR drives plan-card columns only
    // The card is dragged on the LIVE map, so the backdrop has to let pointer
    // events through the moment a card is placed — including the centered
    // (mobile / short-desktop) modal, where the opaque backdrop swallowed every
    // mousedown so the card could not be moved and its resize grip was
    // unreachable. Tapping the map there hit back.onclick and closed the panel.
    syncPlaceThrough();
    draw();
    // Default the card to ~70% of the frame width: small enough to drag in
    // BOTH directions (a full-width card can only move up/down), large enough
    // to read. The corner grip resizes it from there.
    if (planCard && planCardRect) {
      const target = fr0.w * 0.7;
      if (planCardRect.w > target) {
        planCard.scale = Math.max(0.4, planCard.scale * target / planCardRect.w);
        planCard.x = fr0.x + 14; planCard.y = fr0.y + 14;
        draw();
      }
    }
  };
  // Drag the card inside the page frame. Listens on the map container so it
  // works over the route overlay; map panning is suspended while dragging.
  const mapEl = map.getContainer();
  let cardDrag = null;
  function cardDown(e) {
    if (!planCard || !planCardRect) return;
    const pt = map.mouseEventToContainerPoint(e);
    // Bottom-right grip → resize; elsewhere inside the card → move.
    if (typeof planCardOnGrip === 'function' && planCardOnGrip(pt.x, pt.y)) {
      cardDrag = { resize: true, baseW1: planCardRect.w / (planCard.scale || 1) };
      if (map.dragging) map.dragging.disable();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    const r = planCardRect;
    if (pt.x < r.x || pt.x > r.x + r.w || pt.y < r.y || pt.y > r.y + r.h) return;
    cardDrag = { dx: pt.x - planCard.x, dy: pt.y - planCard.y };
    if (map.dragging) map.dragging.disable();
    e.preventDefault();
    e.stopPropagation();
  }
  function cardMove(e) {
    if (!cardDrag || !planCard) return;
    const pt = map.mouseEventToContainerPoint(e);
    if (cardDrag.resize) {
      // Scale ∝ rendered width. Clamp so the card never grows past the page
      // frame (prevents overflow + the snap-back that follows it).
      let s = Math.max(0.15, (pt.x - planCard.x) / cardDrag.baseW1);
      const fr = planBounds();
      if (fr && planCardRect && planCardRect.w) {
        const ratio = planCardRect.h / planCardRect.w;   // table aspect (scale-invariant)
        const maxW = (fr.x + fr.w) - planCard.x;
        const maxH = (fr.y + fr.h) - planCard.y;
        s = Math.min(s, maxW / cardDrag.baseW1, maxH / (cardDrag.baseW1 * ratio));
      }
      planCard.scale = Math.max(0.15, Math.min(6, s));
      draw();
      return;
    }
    let nx = pt.x - cardDrag.dx, ny = pt.y - cardDrag.dy;
    const fr0 = planBounds();
    const cw = planCardRect ? planCardRect.w : 0, ch = planCardRect ? planCardRect.h : 0;
    if (fr0) {
      nx = Math.max(fr0.x, Math.min(fr0.x + fr0.w - cw, nx));
      ny = Math.max(fr0.y, Math.min(fr0.y + fr0.h - ch, ny));
    }
    planCard.x = nx; planCard.y = ny;
    draw();
  }
  function cardUp() {
    if (!cardDrag) return;
    cardDrag = null;
    if (map.dragging) map.dragging.enable();
  }
  // Touch equivalents. Without these the card was mouse-only, so on a phone —
  // where the backdrop is now click-through so the card CAN be reached — a finger
  // drag fell through to the map instead: it panned, selected a waypoint, or even
  // split a leg under the open panel, and the card stayed put with its resize grip
  // unreachable. Reuse the mouse handlers by passing the first touch through.
  const asMouse = e => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  function cardTouchStart(e) {
    const t = asMouse(e);
    if (!t) return;
    cardDown({ clientX: t.clientX, clientY: t.clientY,
      preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() });
  }
  function cardTouchMove(e) {
    if (!cardDrag) return;
    const t = asMouse(e);
    if (!t) return;
    e.preventDefault();               // we own the gesture — don't let the map pan
    cardMove({ clientX: t.clientX, clientY: t.clientY });
  }
  mapEl.addEventListener('mousedown', cardDown, true);
  window.addEventListener('mousemove', cardMove, true);
  window.addEventListener('mouseup', cardUp, true);
  mapEl.addEventListener('touchstart', cardTouchStart, true);
  window.addEventListener('touchmove', cardTouchMove, { capture: true, passive: false });
  window.addEventListener('touchend', cardUp, true);
  window.addEventListener('touchcancel', cardUp, true);
  function removeCardDrag() {
    mapEl.removeEventListener('mousedown', cardDown, true);
    window.removeEventListener('mousemove', cardMove, true);
    window.removeEventListener('mouseup', cardUp, true);
    mapEl.removeEventListener('touchstart', cardTouchStart, true);
    window.removeEventListener('touchmove', cardTouchMove, { capture: true });
    window.removeEventListener('touchend', cardUp, true);
    window.removeEventListener('touchcancel', cardUp, true);
    if (cardDrag && map.dragging) map.dragging.enable();
  }
  layerSel.onchange = function () {
    const chosen = layerSel.value;
    for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
    map.addLayer(layers[chosen]);
    applyMapOpacity();
  };

  opSlider.oninput = function () {
    mapOpacity = parseFloat(this.value) / 100;
    opVal.textContent = this.value + '%';
    applyMapOpacity();
  };
  opResetBtn.onclick = function (e) {
    e.preventDefault();
    opSlider.value = '80';                 // default map opacity (matches the toolbar slider)
    opSlider.oninput();
  };

  // Must detach from the SAME target the listener was added to (document, below).
  // Removing it from `window` left every open's handler alive, so a later Escape
  // — with no panel on screen — still ran restoreOrig() and reverted the overlay
  // toggles, base layer, map opacity and the placed card.
  function close() {
    removeCardDrag();
    document.removeEventListener('keydown', onEsc);
    if (window.__exportSyncPlaceThrough === syncPlaceThrough) window.__exportSyncPlaceThrough = null;
    back.remove();
  }
  function onEsc(e) {
    if (e.key !== 'Escape') return;
    // The panel is click-through, so another modal can be opened on top of it. Only
    // the topmost backdrop may act, or one Escape closed the flight-plan modal AND
    // silently reverted this panel's whole preview (matching the guard the other
    // modals in this file use).
    const backs = document.querySelectorAll('.modal-back');
    if (backs.length && backs[backs.length - 1] !== back) return;
    restoreOrig(); close();
  }

  exportBtn.onclick = () => {
    NavAid._restoreExport = restoreOrig;
    close();
    exportPNG();
  };
  printBtn.onclick = () => {
    NavAid._restoreExport = restoreOrig;
    close();
    exportPNG('print');
  };
  cancelBtn.onclick = function () {
    restoreOrig();
    close();
  };

  btns.appendChild(exportBtn);
  btns.appendChild(printBtn);
  btns.appendChild(cancelBtn);
  box.appendChild(btns);

  back.appendChild(box);
  // Dismissing via the backdrop must undo the preview like Cancel/Escape/X do;
  // closing without restoreOrig() left the panel's overlay/layer/opacity preview
  // applied permanently.
  back.onclick = e => { if (e.target === back) { restoreOrig(); close(); } };
  document.body.appendChild(back);
  updateExportPageWarn();   // now in the DOM — set the initial warning state
  updateExportPlanCb();     // and the initial plan-checkbox enabled state + label
  // Safety net: even on desktop, if the floating panel can't fit the viewport
  // without scrolling, fall back to the centered ("mobile") modal.
  if (box.classList.contains('export-floating') && box.scrollHeight > box.clientHeight + 1) {
    floatPanel = false;
    box.classList.remove('export-floating');
    syncPlaceThrough();   // keeps the backdrop click-through if a card is placed
  }
  document.addEventListener('keydown', onEsc);
}

async function fetchTileBitmap(layer, coords, signal) {
  try {
    const r = await fetch(exportTileLayerUrl(layer, coords), { signal });
    if (r.status === 404) return { bmp: null, failed: false };
    if (!r.ok) return { bmp: null, failed: true };
    const blob = await r.blob();
    return { bmp: await window.createImageBitmap(blob), failed: false };
  } catch (e) {
    return { bmp: null, failed: true };
  }
}

// Save the framed map + route as a PNG, rendered at the highest practical
// native tile zoom (not the on-screen zoom) for maximum quality.
// Slice a fully-rendered A3 export canvas into two A4 tiles at the same scale
// (A3 = 2×A4). Landscape A3 → two A4 portrait halves (vertical cut); portrait
// A3 → two A4 landscape halves (horizontal cut). Halves abut exactly (no
// overlap, so 1:250 000 is preserved); a dashed cut/tape guide marks the shared
// edge and each page is labelled. Downloads two PNGs with A4 DPI metadata.
function exportA4x2Tiles(out, W, H, done) {
  // pageOrient describes the assembled A3 sheet (the on-screen frame), same as
  // A3/A4: a landscape frame splits into two portrait A4 pages side-by-side
  // (vertical cut); a portrait frame splits into two landscape halves stacked
  // (horizontal cut), saved pre-rotated below so they still print portrait.
  const portraitPages = pageOrient !== 'portrait';
  const halfW = Math.floor(W / 2), halfH = Math.floor(H / 2);
  const tiles = portraitPages
    ? [{ sx: 0,     sy: 0, sw: halfW,     sh: H, seam: 'right',  n: 1, side: 'LEFT' },
       { sx: halfW, sy: 0, sw: W - halfW, sh: H, seam: 'left',   n: 2, side: 'RIGHT' }]
    : [{ sx: 0, sy: 0,     sw: W, sh: halfH,     seam: 'bottom', n: 1, side: 'TOP' },
       { sx: 0, sy: halfH, sw: W, sh: H - halfH, seam: 'top',    n: 2, side: 'BOTTOM' }];

  let i = 0;
  (function nextTile() {
    if (i >= tiles.length) { done(); return; }
    const t = tiles[i++];
    const c = document.createElement('canvas');
    c.width = t.sw; c.height = t.sh;
    const cx = c.getContext('2d');
    cx.drawImage(out, t.sx, t.sy, t.sw, t.sh, 0, 0, t.sw, t.sh);
    // WYSIWYG: each file is saved exactly as its half appears on screen.
    // Portrait halves carry portrait-A4 DPI; landscape halves carry
    // landscape-A4 DPI (pick Landscape in the print dialog for those).
    const paperW = portraitPages ? 210 : 297;
    const paperH = portraitPages ? 297 : 210;
    const ppmX = Math.round(c.width * 1000 / paperW);
    const ppmY = Math.round(c.height * 1000 / paperH);
    // Marks are sized in paper millimetres (via px-per-mm), not fixed pixels:
    // framed exports render at native tile zoom (thousands of px per page),
    // where a fixed 22px label would print ~2 mm tall and be illegible.
    drawA4x2TileMarks(cx, t, tiles.length, ppmX / 1000);
    const dl = (blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'navigation-' + routeFileSlug() + '-A4x2-p' + t.n + 'of2-' + fileStamp() + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
      setTimeout(nextTile, 400);   // stagger so the browser allows both downloads
    };
    c.toBlob(b => {
      // A null blob (canvas memory limits) must surface, not silently drop a
      // page — the user would tape together half a chart. Abort the sequence.
      if (!b) { alert(S.errPngFail); done(); return; }
      b.arrayBuffer()
        .then(buf => dl(new Blob([injectPngPhys(buf, ppmX, ppmY)], { type: 'image/png' })))
        .catch(() => dl(b));
    }, 'image/png');
  })();
}

// Page label + dashed cut/tape guide on the edge shared with the other tile.
// Sized in paper millimetres via pxPerMm so the marks print the same physical
// size at any export resolution; label text comes from S (i18n) and the mm
// sizes are tunable (Page frame group).
function drawA4x2TileMarks(cx, t, total, pxPerMm) {
  const W = cx.canvas.width, H = cx.canvas.height;
  const mm = Math.max(0.5, pxPerMm || 1);
  cx.save();
  // page label (top-left, on a translucent chip so it reads over any chart)
  const sideKey = { LEFT: 'a4x2SideLeft', RIGHT: 'a4x2SideRight',
                    TOP: 'a4x2SideTop', BOTTOM: 'a4x2SideBottom' }[t.side];
  const label = S.a4x2TileLabel(t.n, total, S[sideKey] || t.side, t.n === 1 ? 2 : 1);
  const fontPx = Math.round(tune('a4x2MarkLabelMm') * mm);
  cx.font = 'bold ' + fontPx + 'px sans-serif';
  cx.textBaseline = 'top';
  const tw = cx.measureText(label).width;
  const pad = Math.round(fontPx * 0.3);
  cx.fillStyle = tune('a4x2MarkLabelBgColor');
  cx.fillRect(pad, pad, tw + pad * 2, fontPx + pad * 2);
  cx.fillStyle = tune('a4x2MarkLabelInkColor');
  cx.fillText(label, pad * 2, pad * 2);
  // dashed guide along the shared (seam) edge
  cx.strokeStyle = 'rgba(0,0,0,0.7)';
  cx.lineWidth = Math.max(1, tune('a4x2MarkGuideMm') * mm);
  cx.setLineDash([Math.round(4 * mm), Math.round(2.5 * mm)]);
  cx.beginPath();
  if (t.seam === 'right')       { cx.moveTo(W - 1, 0); cx.lineTo(W - 1, H); }
  else if (t.seam === 'left')   { cx.moveTo(1, 0);     cx.lineTo(1, H); }
  else if (t.seam === 'bottom') { cx.moveTo(0, H - 1); cx.lineTo(W, H - 1); }
  else                          { cx.moveTo(0, 1);     cx.lineTo(W, 1); }
  cx.stroke();
  cx.restore();
}

// Open the framed PNG in a new window sized to the exact paper millimetres with
// an @page rule, then fire the print dialog — so it prints 1:1 regardless of the
// printer's "fit to page" default (the only reliable way to hit the physical mm
// sizes). Non-framed falls back to printing the image on the default page.
function openPrintWindow(blob, paperWmm, paperHmm) {
  const url = URL.createObjectURL(blob);
  const w = window.open('', '_blank');
  if (!w) { try { alert(S.errPopupBlocked || 'Allow pop-ups to print.'); } catch (e) {} URL.revokeObjectURL(url); return; }
  const sized = (paperWmm && paperHmm)
    ? `@page{size:${paperWmm}mm ${paperHmm}mm;margin:0}img{width:${paperWmm}mm;height:${paperHmm}mm;display:block}`
    : `@page{margin:0}img{max-width:100%;display:block}`;
  w.document.open();
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' +
    (S.printBtn || 'Print') + '</title><style>html,body{margin:0;padding:0}' + sized +
    '</style></head><body><img alt=""></body></html>');
  w.document.close();
  const img = w.document.querySelector('img');
  const go = () => { try { w.focus(); w.print(); } catch (e) {} setTimeout(() => URL.revokeObjectURL(url), 60000); };
  img.onload = () => setTimeout(go, 60);
  img.onerror = () => { URL.revokeObjectURL(url); };
  img.src = url;
}
function exportPNG(mode) {
  // Export matches the screen view exactly, including map bearing.
  // Tiles are fetched north-up (axis-aligned) for a bounding box that covers
  // all 4 frame corners, composited onto an intermediate canvas, then drawn
  // onto the output canvas with the bearing rotation applied.  The route
  // overlay uses normal screen coords (which already encode bearing via
  // latLngToContainerPoint) so the same scale/translate works for any bearing.
  NavAid.exporting = true;
  const exportBearing = map.getBearing ? map.getBearing() : 0;

  const framed = !!pageFrameRect();
  const fr = pageFrameRect() || { x: 0, y: 0, w: vw(), h: vh() };
  if (fr.w < 4 || fr.h < 4) { NavAid.exporting = false; return; }

  let base = null, baseName = 'map';
  for (const n in layers) {
    if (map.hasLayer(layers[n])) { base = layers[n]; baseName = n; }
  }
  if (!base || !base._url) { NavAid.exporting = false; return; }

  // Lock map interaction for the duration of the async tile fetch.  The
  // route overlay is composited using live proj() after the awaited tiles
  // resolve; if the user panned / zoomed / rotated during "Saving…", the
  // overlay would drift relative to the captured tile bounding box and the
  // saved PNG would be misaligned (issue #74). Remember each handler's
  // pre-export state so we restore exactly what the user had.
  const _handlers = ['dragging', 'scrollWheelZoom', 'doubleClickZoom',
                     'touchZoom', 'boxZoom', 'keyboard', 'touchRotate'];
  const _handlerWas = {};
  for (const h of _handlers) {
    if (map[h] && typeof map[h].enabled === 'function' && map[h].enabled()) {
      _handlerWas[h] = true;
      map[h].disable();
    }
  }
  // The rotate dial is a Leaflet control that calls map.setBearing directly,
  // so the handlers above don't cover it — block pointer events too.
  const _rotEl = document.querySelector('.rotate-ctrl');
  const _prevRotPE = _rotEl ? _rotEl.style.pointerEvents : '';
  if (_rotEl) _rotEl.style.pointerEvents = 'none';
  function unlockMap() {
    for (const h in _handlerWas) map[h].enable();
    if (_rotEl) _rotEl.style.pointerEvents = _prevRotPE;
  }

  // Geographic centre of the frame (stays constant regardless of bearing).
  const frameCenterLL = map.containerPointToLatLng([fr.x + fr.w / 2, fr.y + fr.h / 2]);

  // All 4 frame corners → axis-aligned lat/lng bounding box for tile fetching.
  const c0 = map.containerPointToLatLng([fr.x,          fr.y         ]);
  const c1 = map.containerPointToLatLng([fr.x + fr.w,   fr.y         ]);
  const c2 = map.containerPointToLatLng([fr.x + fr.w,   fr.y + fr.h  ]);
  const c3 = map.containerPointToLatLng([fr.x,          fr.y + fr.h  ]);
  const bbNWll = { lat: Math.max(c0.lat, c1.lat, c2.lat, c3.lat),
                   lng: Math.min(c0.lng, c1.lng, c2.lng, c3.lng) };
  const bbSEll = { lat: Math.min(c0.lat, c1.lat, c2.lat, c3.lat),
                   lng: Math.max(c0.lng, c1.lng, c2.lng, c3.lng) };

  // Choose a starting tile zoom. Framed exports (A3 / A4) target maximum
  // print quality at the layer's max native zoom. Without a frame the export
  // covers the entire viewport; rendering that at max native zoom can balloon
  // into hundreds of tiles. Mirror the on-screen tile zoom instead so the
  // export matches what the user sees and the tile count stays bounded by the
  // viewport size.
  const nativeMax = base.options.maxNativeZoom || base.options.maxZoom || 13;
  const maxZ = framed
    ? nativeMax
    : Math.min(nativeMax, Math.max(7, Math.round(map.getZoom())));

  // Zoom down until the bounding box fits in one canvas AND the parallel tile
  // count stays bounded. The floor of 7 keeps even very large rotated frames
  // under the cap.
  const MAX_TILES = 300;
  let z = maxZ, bbNWP, bbSEP, Wbb, Hbb;
  for (z = maxZ; z >= 7; z--) {
    bbNWP = map.project([bbNWll.lat, bbNWll.lng], z);
    bbSEP = map.project([bbSEll.lat, bbSEll.lng], z);
    Wbb = Math.round(bbSEP.x - bbNWP.x);
    Hbb = Math.round(bbSEP.y - bbNWP.y);
    const tiles = Math.ceil(Wbb / 256) * Math.ceil(Hbb / 256);
    if (Wbb <= 10000 && Hbb <= 10000 && tiles <= MAX_TILES) break;
  }

  // Output canvas: same physical size as the frame at the chosen tile zoom.
  const tilePerScreen = Math.pow(2, z - map.getZoom());
  const W = Math.round(fr.w * tilePerScreen);
  const H = Math.round(fr.h * tilePerScreen);

  // Intermediate canvas: north-up tile composite covering the bounding box.
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width  = Wbb;
  tileCanvas.height = Hbb;
  const tc = tileCanvas.getContext('2d');
  tc.fillStyle = tune('exportBgColor');
  tc.fillRect(0, 0, Wbb, Hbb);

  const out = document.createElement('canvas');
  out.width  = W;
  out.height = H;
  const o = out.getContext('2d');
  o.fillStyle = tune('exportBgColor');
  o.fillRect(0, 0, W, H);

  const btn = document.getElementById('print');
  const btnLabel = btn.textContent;
  btn.textContent = S.saving;
  btn.disabled = true;

  // Gather the covering tiles.
  // Clip the tile grid to the chart's published coverage when the layer
  // declares one (chart layers only cover Israel + adjacent VFR
  // airspace).  Tiles outside that box return 404, which used to be reported
  // as "X of Y map tiles failed to load" even though they are expected blanks
  // outside the chart.  Areas outside chartBounds simply stay as the dark
  // canvas background, which matches what the user sees on screen.
  let txMin = Math.floor(bbNWP.x / 256);
  let txMax = Math.floor(bbSEP.x / 256);
  let tyMin = Math.floor(bbNWP.y / 256);
  let tyMax = Math.floor(bbSEP.y / 256);
  const cb = base.options.chartBounds;
  if (cb) {
    const cbNW = map.project([cb.north, cb.west], z);
    const cbSE = map.project([cb.south, cb.east], z);
    txMin = Math.max(txMin, Math.floor(cbNW.x / 256));
    txMax = Math.min(txMax, Math.floor(cbSE.x / 256));
    tyMin = Math.max(tyMin, Math.floor(cbNW.y / 256));
    tyMax = Math.min(tyMax, Math.floor(cbSE.y / 256));
  }
  // Fetch each tile first so we can distinguish HTTP 404 (expected outside the
  // chart's published coverage) from real failures (network, 5xx, decode).
  // Only the latter count toward the "X of Y tiles failed" alert; a 404 just
  // leaves the dark canvas backdrop showing in that area, matching what the
  // user already sees on screen.
  const jobs = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const job = {
        dx: Math.round(tx * 256 - bbNWP.x),
        dy: Math.round(ty * 256 - bbNWP.y),
        bmp: null,
        failed: false,
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      job.done = fetchTileBitmap(base, { z, x: tx, y: ty }, ctrl.signal)
        .then(result => {
          job.bmp = result.bmp;
          job.failed = result.failed;
        })
        .catch(() => { job.failed = true; })
        .then(() => clearTimeout(timer));
      jobs.push(job);
    }
  }

  Promise.all(jobs.map(j => j.done)).then(() => {
    let failed = 0;
    for (const j of jobs) {
      if (j.bmp) {
        try { tc.drawImage(j.bmp, j.dx, j.dy, 256, 256); }
        catch (e) { failed++; }
      } else if (j.failed) {
        failed++;
      }
    }

    // Draw the tile canvas onto the output, rotated by the map bearing so the
    // result matches the screen view.  The frame centre in tile-canvas space
    // maps to the output centre; rotation is clockwise by exportBearing.
    // globalAlpha honours the Map-opacity slider so dim tiles on screen also
    // export dim; overlays drawn after restore() stay at full alpha.
    const fcP = map.project([frameCenterLL.lat, frameCenterLL.lng], z);
    const fcx = fcP.x - bbNWP.x;
    const fcy = fcP.y - bbNWP.y;
    o.save();
    o.translate(W / 2, H / 2);
    o.rotate(exportBearing * Math.PI / 180);
    o.translate(-fcx, -fcy);
    o.globalAlpha = (typeof mapOpacity === 'number') ? mapOpacity : 1;
    o.drawImage(tileCanvas, 0, 0);
    o.restore();

    // Route overlay: screen coords already encode bearing, so the standard
    // scale/translate maps them correctly onto the rotated tile output.
    const s = W / fr.w;
    const prevOctx = octx;
    octx = o;
    // Symbols size themselves geographically (printPxPerMm, = 250/metresPerPixel
    // at 1:250,000), identical on screen and here — so the export is a faithful
    // scaled copy of what you arranged on screen and lands at the intended
    // physical mm. No export-time size override needed.
    o.save();
    o.scale(s, s);
    o.translate(-fr.x, -fr.y);
    try {
      drawNavWaypoints();
      drawCommChangeRings();
      drawAirfields();
      // Draw VOR stations when the live "Show VOR stations" toggle is on, or —
      // even with it off — when the export carries VOR info (the plan card's
      // Radial/DME columns), so the chart shows where those readings reference.
      // Mirror the plan card's own gate (draw.js): a reference VOR that actually
      // resolves via activeVor() (not a stale/unloaded ident), or any per-leg VOR.
      const exportHasVorInfo = !!planCard &&
        ((typeof activeVor === 'function' && activeVor()) ||
         (state.legs || []).some(l => l && l.vorRef));
      drawVors(exportHasVorInfo);
      drawLegs();
      drawWaypoints();
      drawNotes();
      drawPlanCard();        // flight-plan card placed in the export modal (#378)
      o.restore();
    } finally {
      octx = prevOctx;
    }

    // A4×2: the frame is A3-sized — slice it into two A4 tiles at the same
    // 1:250 000 scale (no A3 printer needed) instead of one A3 PNG.
    if (pageSize === 'A4x2') {
      // Teardown runs in the completion callback, mirroring the single-page
      // path's toBlob callback: the Save button stays disabled and
      // NavAid.exporting stays true until both tile downloads have fired,
      // so a second export can't start mid-tiling.
      exportA4x2Tiles(out, W, H, () => {
        btn.textContent = btnLabel;
        btn.disabled = false;
        unlockMap();
        NavAid.exporting = false;
        if (typeof NavAid._restoreExport === 'function') NavAid._restoreExport();
        if (failed > 0) alert(S.errTilesFail(failed, jobs.length));
      });
      return;
    }

    out.toBlob(b => {
      btn.textContent = btnLabel;
      btn.disabled = false;
      unlockMap();
      NavAid.exporting = false;
      if (typeof NavAid._restoreExport === 'function') NavAid._restoreExport();
      if (!b) { alert(S.errPngFail); return; }

      // Embed physical DPI metadata so the PNG prints at the correct
      // physical size on A3 / A4 at 1:250,000 scale.
      const printing = mode === 'print';
      const mm = pageSize === 'A4' ? [210, 297] : [297, 420];
      const paperW = pageOrient === 'portrait' ? mm[0] : mm[1];
      const paperH = pageOrient === 'portrait' ? mm[1] : mm[0];
      const deliver = function (blob) {
        if (printing) {
          openPrintWindow(blob, (framed && pageSize) ? paperW : 0, (framed && pageSize) ? paperH : 0);
          return;
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'navigation-' + routeFileSlug() + '-' + (pageSize || baseName) +
                     '-' + fileStamp() + '.png';
        a.click();
        URL.revokeObjectURL(a.href);
      };
      if (framed && pageSize) {
        const ppmX = Math.round(W * 1000 / paperW);
        const ppmY = Math.round(H * 1000 / paperH);
        b.arrayBuffer().then(buf => {
          deliver(new Blob([injectPngPhys(buf, ppmX, ppmY)], { type: 'image/png' }));
        }).catch(function () { deliver(b); });
      } else {
        deliver(b);
      }
      if (failed > 0) alert(S.errTilesFail(failed, jobs.length));
    }, 'image/png');
  }).catch(err => {
    // #215: a sync throw in the .then body (e.g. drawImage on a malformed
    // bitmap) would otherwise leave the button disabled forever. Restore
    // the UI so the user can retry, and surface the failure.
    console.warn('PNG export pipeline failed:', err);
    btn.textContent = btnLabel;
    btn.disabled = false;
    unlockMap();
    NavAid.exporting = false;
    if (typeof NavAid._restoreExport === 'function') NavAid._restoreExport();
    try { alert(S.errPngFail); } catch (_) { /* alert blocked */ }
  });
}

// Inject a pHYs (physical pixel dimensions) chunk into a PNG blob so that
// the image prints at the intended physical size when the print dialog uses
// the embedded DPI rather than scaling to fit the page.
function injectPngPhys(buf, ppmX, ppmY) {
  // PNG format: 8-byte signature, then a series of chunks.
  // Each chunk: 4 bytes length (big-endian), 4 bytes type, data, 4 bytes CRC.
  // The first chunk is always IHDR (13 bytes data).  pHYs must follow IHDR.
  const view = new DataView(buf);
  const ihdrLen = view.getUint32(8);                    // should be 13
  const ihdrStart = 12;                                  // after length field
  const type = String.fromCharCode(view.getUint8(ihdrStart), view.getUint8(ihdrStart + 1),
                                    view.getUint8(ihdrStart + 2), view.getUint8(ihdrStart + 3));
  if (type !== 'IHDR') return buf;                      // not a valid PNG
  const insOff = ihdrStart + 4 + ihdrLen + 4;            // after IHDR data + CRC

  // Build pHYs chunk (9 bytes data).
  const physData = new ArrayBuffer(9);
  const pv = new DataView(physData);
  pv.setUint32(0, ppmX);
  pv.setUint32(4, ppmY);
  pv.setUint8(8, 1);                                     // unit = metre

  // CRC covers type + data.
  const crcBytes = new Uint8Array(4 + 9);
  crcBytes[0] = 112; crcBytes[1] = 72; crcBytes[2] = 89; crcBytes[3] = 115; // "pHYs"
  crcBytes.set(new Uint8Array(physData), 4);
  const crc = pngCrc(crcBytes);

  const chunk = new ArrayBuffer(21);                     // 4 len + 4 type + 9 data + 4 crc
  const cv = new DataView(chunk);
  cv.setUint32(0, 9);                                    // data length
  cv.setUint32(4, 0x70485973);                            // "pHYs"
  new Uint8Array(chunk, 8, 9).set(new Uint8Array(physData));
  cv.setUint32(17, crc);                                  // CRC at byte 17 (after 8+9)

  // Splice the pHYs chunk after IHDR.
  const out = new Uint8Array(buf.byteLength + 21);
  out.set(new Uint8Array(buf, 0, insOff), 0);
  out.set(new Uint8Array(chunk), insOff);
  out.set(new Uint8Array(buf, insOff), insOff + 21);
  return out.buffer;
}

// CRC-32 for PNG (IEEE polynomial, init 0xFFFFFFFF, final XOR 0xFFFFFFFF).
const PNG_CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function pngCrc(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = PNG_CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// --- fly the route (Google Earth) -----------------------------------
async function flyRoute() {
  if (state.waypoints.length < 2) {
    alert(S.errNeedWps);
    return;
  }
  if (airfields === null && typeof loadAirfields === 'function') {
    await loadAirfields();
  }
  const wps = state.waypoints;
  const endpointGroundM = i => {
    if (i !== 0 && i !== wps.length - 1) return null;
    const af = typeof airfieldAtWaypoint === 'function'
      ? airfieldAtWaypoint(wps[i])
      : null;
    const elevFt = af && Number(af.elev_ft);
    return Number.isFinite(elevFt) ? Math.round(elevFt * 0.3048) : null;
  };
  const altM = i => {
    const groundM = endpointGroundM(i);
    if (groundM !== null) return groundM;
    const leg = state.legs[Math.min(i, state.legs.length - 1)];
    return altitudeMetersForExport(leg ? leg.inboundAltitude : 2000, leg ? 0 : 2000);
  };
  const inboundHeading = i => {
    if (i <= 0) return geo(wps[0], wps[1]).brg;
    return geo(wps[i - 1], wps[i]).brg;
  };
  const outboundHeading = i => geo(wps[i], wps[i + 1]).brg;
  const normalizeHeading = hdg => ((hdg % 360) + 360) % 360;
  const signedHeadingDelta = (from, to) =>
    (((normalizeHeading(to) - normalizeHeading(from)) % 360) + 540) % 360 - 180;
  const blendHeading = (from, to, f) => normalizeHeading(from + signedHeadingDelta(from, to) * f);
  const pointAlongLeg = (from, to, bufferNm, fromEnd) => {
    const { dist } = geo(from, to);
    if (!Number.isFinite(dist) || dist <= 0) return { lat: to.lat, lng: to.lng };
    const f = fromEnd
      ? Math.max(0, 1 - bufferNm / dist)
      : Math.min(1, bufferNm / dist);
    return {
      lat: from.lat + (to.lat - from.lat) * f,
      lng: from.lng + (to.lng - from.lng) * f,
    };
  };
  const turnBufferNm = i => {
    const inDist = geo(wps[i - 1], wps[i]).dist;
    return Math.max(0, Math.min(0.5, inDist * 0.15));
  };
  const legAltitudeM = i => {
    const leg = state.legs[i];
    return altitudeMetersForExport(leg ? leg.inboundAltitude : 2000, leg ? 0 : 2000);
  };
  const tourFractions = (legIndex, dist) => {
    const out = [];
    const add = f => {
      const x = Math.max(0, Math.min(1, f));
      if (x > 0 && !out.some(v => Math.abs(v - x) < 1e-4)) out.push(x);
    };
    const steps = Math.max(1, Math.ceil(dist / 1.5));
    for (let s = 1; s <= steps; s++) add(s / steps);
    if (legIndex < wps.length - 2 && dist > 0) add(1 - turnBufferNm(legIndex + 1) / dist);
    return out.sort((a, b) => a - b);
  };

  function downloadKml() {
    const esc = s => String(s).replace(/[<>&]/g,
      c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const cameraAt = (pos, alt, hdg, pad) =>
      pad + '<Camera>\n' +
      pad + '  <longitude>' + pos.lng + '</longitude>\n' +
      pad + '  <latitude>' + pos.lat + '</latitude>\n' +
      pad + '  <altitude>' + alt + '</altitude>\n' +
      pad + '  <heading>' + hdg.toFixed(1) + '</heading>\n' +
      pad + '  <tilt>70</tilt>\n' +
      pad + '  <roll>0</roll>\n' +
      pad + '  <altitudeMode>absolute</altitudeMode>\n' +
      pad + '</Camera>\n';
    const camera = (i, pad, hdg = inboundHeading(i)) => cameraAt(wps[i], altM(i), hdg, pad);
    const flyToCamera = (pos, alt, hdg, dur, mode) =>
      '    <gx:FlyTo>\n' +
      '      <gx:duration>' + dur.toFixed(1) + '</gx:duration>\n' +
      '      <gx:flyToMode>' + mode + '</gx:flyToMode>\n' +
      cameraAt(pos, alt, hdg, '      ') +
      '    </gx:FlyTo>\n';
    const flyTo = (i, dur, mode, hdg = inboundHeading(i)) =>
      flyToCamera(wps[i], altM(i), hdg, dur, mode);
    let lastTourHeading = null;
    const continuousHeading = hdg => {
      let next = normalizeHeading(hdg);
      if (lastTourHeading !== null) {
        while (next - lastTourHeading > 180) next -= 360;
        while (next - lastTourHeading < -180) next += 360;
      }
      lastTourHeading = next;
      return next;
    };
    let tour = flyTo(0, 2, 'smooth', continuousHeading(outboundHeading(0)));
    for (let i = 0; i < wps.length - 1; i++) {
      const leg = state.legs[i];
      const from = wps[i];
      const to = wps[i + 1];
      const { dist } = geo(from, to);
      const durH = leg && leg.flightSpeed > 0 ? dist / leg.flightSpeed : 0;
      const legDur = Math.max(4, Math.min(45, durH * 60 * 4));
      const legHdg = outboundHeading(i);
      const hasTurn = i < wps.length - 2 && dist > 0;
      const turnStartF = hasTurn ? Math.max(0, 1 - turnBufferNm(i + 1) / dist) : 1;
      const nextHdg = hasTurn ? outboundHeading(i + 1) : legHdg;
      const turnDur = hasTurn
        ? Math.min(4, Math.max(1.5, Math.abs(signedHeadingDelta(legHdg, nextHdg)) / 30))
        : 0;
      let prevF = 0;
      for (const f of tourFractions(i, dist)) {
        const pos = pointAlongLeg(from, to, dist * f, false);
        const inTurn = hasTurn && f >= turnStartF;
        const turnPart = inTurn && turnStartF < 1 ? (f - turnStartF) / (1 - turnStartF) : 0;
        const hdg = inTurn ? blendHeading(legHdg, nextHdg, turnPart) : legHdg;
        let segDur = legDur * (f - prevF);
        if (hasTurn && f > turnStartF && turnStartF < 1) {
          const a = Math.max(prevF, turnStartF);
          const turnSegPart = (f - a) / (1 - turnStartF);
          segDur = Math.max(segDur, turnDur * turnSegPart);
        }
        const alt = f >= 1 ? altM(i + 1) : legAltitudeM(i);
        tour += flyToCamera(pos, alt, continuousHeading(hdg), Math.max(0.6, segDur), 'smooth');
        prevF = f;
      }
    }
    const coords = wps.map(w => w.lng + ',' + w.lat + ',0').join(' ');
    const points = wps.map((w, i) =>
      '  <Placemark><name>' + esc(wpLabel(i)) + '</name>' +
      '<Point><coordinates>' + w.lng + ',' + w.lat + ',0</coordinates></Point>' +
      '</Placemark>').join('\n');
    const kml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<kml xmlns="http://www.opengis.net/kml/2.2" ' +
      'xmlns:gx="http://www.google.com/kml/ext/2.2">\n<Document>\n' +
      '  <name>' + S.kmlDocName + '</name>\n' +
      camera(0, '  ') +
      '  <Placemark><name>' + S.kmlRouteName + '</name>\n' +
      '    <Style><LineStyle><color>ff3399ff</color><width>3</width></LineStyle></Style>\n' +
      '    <LineString><tessellate>1</tessellate>\n' +
      '      <coordinates>' + coords + '</coordinates>\n' +
      '    </LineString>\n  </Placemark>\n' + points + '\n' +
      '  <gx:Tour><name>' + S.kmlTourName + '</name>\n    <gx:Playlist>\n' +
      tour + '    </gx:Playlist>\n  </gx:Tour>\n' +
      '</Document>\n</kml>\n';
    const blob = new Blob([kml],
      { type: 'application/vnd.google-earth.kml+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'navaid-flythrough-' + routeFileSlug() + '-' + fileStamp() + '.kml';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onPick(mode) {
    if (mode === 'web') {
      if (!confirm(S.geWebConfirm)) return;
      // #145: validate the first waypoint's coords before string-concat so a
      // malformed lat/lng (e.g. from a tampered import) can't leak into the
      // URL. heading()/altM() are already bounded numerics by construction.
      const lat = Number(wps[0].lat), lng = Number(wps[0].lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lng) || lng < -180 || lng > 180) {
        alert(S.errBadCoords);
        return;
      }
      const url = 'https://earth.google.com/web/@' +
        lat.toFixed(6) + ',' + lng.toFixed(6) + ',' + altM(0) + 'a,' +
        outboundHeading(0).toFixed(1) + 'h,70t';
      window.open(url, '_blank', 'noopener');
      downloadKml();
      return;
    }

    if (!confirm(S.flyConfirm)) return;
    downloadKml();
  }

  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.chooseGeMode;
  addModalCloseX(box, () => { document.removeEventListener('keydown', onEsc); back.remove(); });
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  function onEsc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); back.remove(); } }
  function close() { document.removeEventListener('keydown', onEsc); back.remove(); }
  for (const [label, mode] of [[S.geModeWeb, 'web'], [S.geModeApp, 'app']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { close(); onPick(mode); };
    btns.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.textContent = S.cancel;
  cancel.className = 'modal-cancel';
  cancel.onclick = close;
  btns.appendChild(cancel);
  box.append(title, btns);
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) close(); };
  document.body.appendChild(back);
  document.addEventListener('keydown', onEsc);
}

// --- route persistence ----------------------------------------------
const STORE_KEY = 'navaid.route';
let persistTimer = null;
let quotaWarned = false;                // #80: stop scheduling after a quota fail
// An empty route is stored as the *absence* of the key, not an empty object, so
// a fresh boot (or a clear-store reload) leaves navaid.route truly cleared
// rather than re-writing "{waypoints:[]…}".
function routeIsEmpty() {
  if (state.waypoints.length || state.legs.length || state.notes.length) return false;
  // Also persist when only suppressions / a non-calm wind remain, so the
  // empty-route key-removal doesn't silently drop them (both are in the snapshot).
  const sup = (typeof routeCommChangeSuppressions === 'function') ? routeCommChangeSuppressions() : null;
  if (sup && sup.length) return false;
  const w = (typeof encodeWind === 'function') ? encodeWind(state.wind) : null;
  if (w && w.speed > 0) return false;
  return true;
}
function writeRoute() {
  if (routeIsEmpty()) localStorage.removeItem(STORE_KEY);
  else localStorage.setItem(STORE_KEY, JSON.stringify(routeSnapshotForStorage()));
}
function persist() {
  // When boot detected a corrupt saved blob (issue #73), refuse to overwrite
  // it with the empty in-memory state — that's silent data loss. Once the
  // user adds a waypoint / note the state is no longer empty and the normal
  // save path resumes, replacing the corrupt blob with their new work.
  if (NavAid.corruptCache &&
      state.waypoints.length === 0 &&
      state.legs.length === 0 &&
      state.notes.length === 0) return;
  // Snapshot for undo runs synchronously on every state change (not on the
  // debounced write) so a quick succession of edits collapses into one undo
  // step the same way it collapses into one save.
  recordUndoSnapshot(JSON.stringify(routeSnapshotForStorage()));
  if (persistTimer || quotaWarned) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      // center / zoom are not restored (load fits the route) — not saved.
      writeRoute();
    } catch (e) {
      // #80: a full quota used to fail silently. Surface it once so the
      // user knows to export the route; other storage-unavailable errors
      // (private mode, disabled storage) stay silent as before.
      if (e && (e.name === 'QuotaExceededError' || e.code === 22 ||
                e.code === 1014 /* NS_ERROR_DOM_QUOTA_REACHED */)) {
        quotaWarned = true;
        try { alert(S.errStorageFull); } catch (_) { /* alert blocked */ }
      }
    }
  }, 500);
}

function flushPersist() {
  if (NavAid.corruptCache &&
      state.waypoints.length === 0 &&
      state.legs.length === 0 &&
      state.notes.length === 0) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (quotaWarned) return;
  try {
    writeRoute();
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22 ||
              e.code === 1014 /* NS_ERROR_DOM_QUOTA_REACHED */)) {
      quotaWarned = true;
      try { alert(S.errStorageFull); } catch (_) { /* alert blocked */ }
    }
  }
}

// --- undo -----------------------------------------------------------
// undoStack holds serialized route snapshots of *prior*
// committed states. lastCommitted is the serialization of the state as it
// currently stands; when a change makes the new serialization differ, the
// previous one is pushed so undo() can return to it. The first call after
// boot only establishes the baseline (no push). `undoing` suppresses the
// snapshot while undo() is restoring, so an undo never becomes its own entry.
const undoStack = [];
let lastCommitted = null;
let undoing = false;
// A live pointer/touch drag repaints (and persists) on every move; the
// interaction layer flags that here so the dozens of intermediate frames of
// one drag don't each become an undo entry (which used to flood the stack and
// evict real history). On drag end it flips back and commits ONE snapshot of
// the final dragged state.
let liveDragging = false;
function setLiveDragging(v) {
  const was = liveDragging;
  liveDragging = !!v;
  if (was && !liveDragging) recordUndoSnapshot(JSON.stringify(routeSnapshotForStorage()));
}

function recordUndoSnapshot(serialized) {
  if (lastCommitted === null) {           // baseline — nothing to undo to yet
    lastCommitted = serialized;
    return;
  }
  if (undoing || liveDragging || serialized === lastCommitted) return;
  undoStack.push(lastCommitted);
  if (undoStack.length > tune('undoLimit')) undoStack.shift();
  lastCommitted = serialized;
  refreshUndoButton();
}

function refreshUndoButton() {
  const btn = document.getElementById('undo');
  if (btn) btn.disabled = undoStack.length === 0;
}

function undo() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  let snap;
  try { snap = JSON.parse(prev); } catch (_) { refreshUndoButton(); return; }
  state.waypoints = Array.isArray(snap.waypoints) ? snap.waypoints : [];
  state.legs = Array.isArray(snap.legs)
    ? snap.legs.map(leg => ({
      ...leg,
      inboundAltitude: decodeRouteAltitude(leg.inboundAltitude),
      outboundAltitude: decodeRouteAltitude(leg.outboundAltitude),
    })) : [];
  state.notes = Array.isArray(snap.notes) ? snap.notes : [];
  state.commChangeSuppressions = storedCommChangeSuppressions(snap);
  // Restore the snapshot's altitude-layer pin (null for pre-pin snapshots)
  // so the restored route is not re-pinned to — and rewritten from —
  // whichever layer happens to be displayed at undo time.
  routeAltPrefix = typeof snap.altPin === 'string' ? snap.altPin : null;
  // Restore route-wide wind + map bearing too (the snapshot carries both, and
  // restoreRoute/applyRouteData restore them) — otherwise an undo across a wind
  // or rotation change leaves the current values feeding the heading/ETA math.
  state.wind = storedWind(snap);
  applyMapBearing(snap);
  // The restored snapshot may predate (or differ from) the loaded library
  // entry, so drop the tracked id — Save then opens the menu instead of
  // silently overwriting a saved route with unrelated content.
  currentRouteLibraryId = null;
  state.selected = null;
  undoing = true;
  lastCommitted = prev;            // align baseline so the redraw won't re-push
  try {
    draw();
    if (typeof showInspector === 'function') showInspector();
  } finally {
    undoing = false;
  }
  refreshUndoButton();
}

// Returns one of:
//   true       — saved route restored into state.
//   false      — no saved route (clean first-time boot, safe to persist).
//   'corrupt'  — a saved blob exists but is unparseable or has bad coords;
//                state is left empty and the blob is preserved on disk so
//                the user can copy it out (issue #73).
function restoreRoute() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch (e) {
    return false;                         // storage unavailable
  }
  if (!raw) return false;
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    NavAid.corruptCacheError = e.message;
    return 'corrupt';                     // bad JSON — preserve raw blob (#73)
  }
  // Strict schema check — issue #101. Legacy saved blobs lacking a newer
  // field (e.g. notes added later) will fail here. The caller treats
  // 'corrupt' as the preserve-on-failure path from #73: the raw blob is
  // left untouched in localStorage and the boot continues with empty
  // state, so no user work is lost (they can hand-edit / re-import).
  const verr = validateRoute(d);
  if (verr !== null) {
    NavAid.corruptCacheError = verr;
    return 'corrupt';
  }
  state.waypoints = d.waypoints.map(w => ({
    lat: r5(w.lat), lng: r5(w.lng), name: w.name,
    ...(w._defaultWpName ? { _defaultWpName: 1 } : {}),
  }));
  // #393 — normalise inLabel/outLabel offsets to zoom-12 reference so they
  // scale proportionally with zoom. Pre-#393 blobs lack `_m` and hold raw
  // pixel offsets, which `_normalizeLegLabel` divides by `legacyArrowSize`
  // (one-shot, idempotent — the `_m: 1` stamp blocks any re-migration). If
  // the saved blob carries its own legArrowSize we honour it; otherwise we
  // fall back to the current setting (PR-review #3).
  const legacyAS = (typeof d.legArrowSize === 'number' && d.legArrowSize > 0)
    ? d.legArrowSize : legArrowSize;
  state.legs = d.legs.map(l => ({
    inboundAltitude: decodeRouteAltitude(l.inboundAltitude),
    outboundAltitude: decodeRouteAltitude(l.outboundAltitude),
    flightSpeed: l.flightSpeed,
    outboundSpeed: l.outboundSpeed != null ? l.outboundSpeed : l.flightSpeed,
    inLabel:  _normalizeLegLabel(l.inLabel,  legacyAS),
    outLabel: _normalizeLegLabel(l.outLabel, legacyAS),
    ...(encodeWind(l.wind) ? { wind: encodeWind(l.wind) } : {}),
  }));
  state.notes = d.notes.map(n => ({
    lat: r5(n.lat), lng: r5(n.lng),
    text: n.text, color: n.color, shape: n.shape,
    ...(n.cc ? { cc: n.cc } : {}),
    ...(n.freqName ? { freqName: n.freqName } : {}),
    ...(n.freq ? { freq: n.freq } : {}),
    ...(n.freqAuto === true ? { freqAuto: true } : {}),
    ...(Number.isFinite(n.size) && n.size !== 1 ? { size: n.size } : {}),
    ...(n.rp && Number.isInteger(n.rp.leg)
      ? { rp: { leg: n.rp.leg, t: Number.isFinite(n.rp.t) ? n.rp.t : 0.5 } } : {}),
  }));
  state.commChangeSuppressions = storedCommChangeSuppressions(d);
  state.wind = storedWind(d);
  // Restore the altitude-layer pin before syncLegs so the restored route
  // derives (and re-derives on endpoint changes) only from its own layer.
  routeAltPrefix = typeof d.altPin === 'string' ? d.altPin : null;
  if (typeof window.refreshWindInputs === 'function') window.refreshWindInputs();
  syncLegs();
  applyMapBearing(d);            // restore the saved map orientation on boot
  return true;
}

// --- Airfield plates viewer (#105) -----------------------------------
// Plate PDFs (~133 MB) ship as a SINGLE copy at the deployed artifact root;
// staging / PR / branch previews don't carry their own copy and resolve
// plates against that shared root. Deriving the base from location at load
// time makes the same source work on every host the site is served from —
// the custom domain (served at '/') and raw GitHub Pages (served under
// '/NavigationApp/') — so the deploy pipeline no longer has to rewrite a
// per-environment absolute path (which 404'd on the custom domain).
function plateBase(pathname) {
  let dir = (pathname || location.pathname).replace(/[^/]*$/, '');  // drop filename, keep trailing '/'
  // Preview suffix → shared root. `branch/.+` (not `[^/]+`) so branch names
  // that contain a slash (e.g. feat/loading-charts-indicator) strip fully,
  // otherwise byop resolves under the branch dir and 404s on previews.
  dir = dir.replace(/(staging|pr\/[^/]+|branch\/.+)\/$/, '');
  return dir + 'byop/';
}

function plateUrl(filename) {
  return plateBase() + encodeURIComponent(filename);
}

// Plates are shown as pre-rendered PNGs (scripts/render-plates.sh, poppler):
// poppler renders their embedded Hebrew CID fonts correctly (PDF.js garbled
// them) and images work in the Android WebView, which has no native PDF
// renderer. The manifest maps each plate → its page count so the viewer knows
// how many page PNGs to load; the original PDF stays for download.
const PLATES_VER = '1';   // bump when plates are re-rendered (busts PNG + manifest cache)
let _platesManifest = null, _platesManifestPromise = null;
function loadPlatesManifest() {
  if (_platesManifest) return Promise.resolve(_platesManifest);
  if (_platesManifestPromise) return _platesManifestPromise;
  _platesManifestPromise = fetch(plateBase() + 'plates-manifest.json?v=' + PLATES_VER, { credentials: 'omit' })
    .then(r => (r.ok ? r.json() : {}))
    .then(m => (_platesManifest = m || {}))
    .catch(() => (_platesManifest = {}));
  return _platesManifestPromise;
}
// URL of one rendered plate page (1-based).
function platePngUrl(filename, page) {
  const base = filename.replace(/\.pdf$/i, '');
  const nn = String(page).padStart(2, '0');
  return plateBase() + encodeURIComponent(base + '-p' + nn + '.png') + '?v=' + PLATES_VER;
}

// Prefetch a plate's first page (+ the manifest) on chip hover/focus so the
// click opens from cache. Deduped; failures ignored.
const _platePrefetched = new Set();
function prefetchPlate(filename) {
  if (!filename || _platePrefetched.has(filename)) return;
  _platePrefetched.add(filename);
  loadPlatesManifest();
  try {
    fetch(platePngUrl(filename, 1), { credentials: 'omit' }).catch(() => {});
  } catch (_) { /* fetch unavailable — ignore */ }
}

function plateCategory(filename) {
  const rest = filename.replace(/^[A-Z]{4}_/, '');
  const cat = rest.split('_')[0];
  if (cat === 'APPROACH') return 'approach';
  if (cat === 'SID') return 'sid';
  if (cat === 'STAR') return 'star';
  if (cat === 'Ground' || cat === 'parking') return 'ground';
  if (cat === 'VAC' || cat === 'airport') return 'vfr';
  return 'other';
}

function prettyPlateLabel(filename) {
  const noIcao = filename.replace(/^[A-Z]{4}_/, '').replace(/\.pdf$/i, '');
  return noIcao.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function showPlateViewer(filename, label) {
  const back = document.createElement('div');
  back.className = 'modal-back plate-viewer';
  const box = document.createElement('div');
  box.className = 'modal plate-viewer-box';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = label;
  box.appendChild(title);

  const pdfUrl = plateUrl(filename);   // original PDF, kept for download / open-in-tab

  const viewer = document.createElement('div');
  viewer.className = 'plate-canvas-wrap';

  const loading = document.createElement('div');
  loading.className = 'plate-loading';
  loading.textContent = (S.plateLoading || 'Loading…');

  // Show each page as its pre-rendered PNG (poppler). The manifest gives the
  // page count; if it's missing, fall back to a single page.
  loadPlatesManifest().then(man => {
    const pages = Math.max(1, (man && man[filename]) || 1);
    let firstDone = false;
    for (let p = 1; p <= pages; p++) {
      const img = document.createElement('img');
      img.className = 'plate-canvas';
      img.alt = label + ' — ' + p + '/' + pages;
      img.loading = p === 1 ? 'eager' : 'lazy';
      if (p === 1) {
        img.addEventListener('load', () => { if (!firstDone) { firstDone = true; loading.style.display = 'none'; } });
        img.addEventListener('error', () => { loading.textContent = S.plateLoadError + '\n' + pdfUrl; });
      }
      img.src = platePngUrl(filename, p);
      viewer.appendChild(img);
    }
  }).catch(() => { loading.textContent = S.plateLoadError + '\n' + pdfUrl; });

  box.appendChild(loading);
  box.appendChild(viewer);

  const att = document.createElement('div');
  att.className = 'plate-attribution';
  att.textContent = S.plateAttribution;
  box.appendChild(att);

  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const openTab = document.createElement('button');
  openTab.textContent = S.plateOpenTab;
  openTab.onclick = () => window.open(pdfUrl, '_blank', 'noopener');
  btns.appendChild(openTab);
  const download = document.createElement('button');
  download.textContent = S.plateDownload;
  download.onclick = () => {
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = filename;
    a.click();
  };
  btns.appendChild(download);
  box.appendChild(btns);
  function teardown() {
    window.removeEventListener('keydown', onEsc, true);
    back.remove();
  }
  addModalCloseX(box, teardown);

  // The plate viewer opens on top of the Charts modal. Both the Charts
  // modal and the global handler in interact.js close a `.modal-back` on
  // Escape, so a plain bubble listener here would let one Escape close the
  // plate AND the chart underneath it. Listen in the capture phase and stop
  // the event so only the topmost (plate) viewer closes.
  function onEsc(e) {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    teardown();
  }
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) teardown(); };
  document.body.appendChild(back);
  window.addEventListener('keydown', onEsc, true);
}

function createDraggableModal(titleText, className, onClose, options = {}) {
  const back = document.createElement('div');
  back.className = options.nonBlocking ? 'modal-back flight-plan' : 'modal-back';
  if (options.chartKind) back.dataset.chartModal = options.chartKind;
  const box = document.createElement('div');
  box.className = className || 'modal wide';

  const title = document.createElement('div');
  title.className = 'modal-title';
  if (options.titleDir) title.dir = options.titleDir;
  if (options.titleBidi) title.style.unicodeBidi = options.titleBidi;
  title.textContent = titleText || '';
  box.appendChild(title);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onEsc);
    if (back.parentNode) back.remove();
    if (typeof onClose === 'function') onClose();
  }
  back._navaidClose = close;
  addModalCloseX(box, close, { actions: options.closeActions || [] });

  let drag = null;
  title.addEventListener('mousedown', function (e) {
    const r = box.getBoundingClientRect();
    drag = { ox: e.clientX - r.left, oy: e.clientY - r.top };
    box.style.position = 'fixed';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.margin = '0';
    const onMove = function (e) {
      if (!drag) return;
      // Clamp to the viewport so the title bar + ✕ stay reachable. Same
      // pattern the flight-plan modal already uses.
      const x = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, e.clientX - drag.ox));
      const y = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, e.clientY - drag.oy));
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    };
    const onUp = function () {
      drag = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  function onEsc(e) {
    if (e.key !== 'Escape') return;
    // Only the top-most modal reacts to Escape, so closing a picture stacked
    // over another modal (e.g. a satellite view over the route mosaic) doesn't
    // also close the one underneath. Each open modal registers its own onEsc;
    // without this guard they'd all close on a single Escape.
    const backs = document.querySelectorAll('.modal-back');
    if (backs.length && backs[backs.length - 1] !== back) return;
    close();
  }
  back.onclick = e => { if (e.target === back) close(); };
  function show() {
    if (!box.parentNode) back.appendChild(box);
    document.body.appendChild(back);
    // Opening any modal closes the toolbar dropdowns so they don't overlap it.
    if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    window.addEventListener('keydown', onEsc);
  }
  return { back, box, title, close, show };
}

function afterFreqTableEdit() {
  draw();
  refreshInspectorIfVisible();
}

function renderFreqTable(freqSection) {
  const existingSearch = freqSection.querySelector('.charts-freq-search');
  const searchQuery = existingSearch ? existingSearch.value : '';
  freqSection.innerHTML = '';
  const titleRow = document.createElement('div');
  titleRow.className = 'charts-freq-title';
  const heading = document.createElement('h3');
  heading.textContent = S.freqTableTitle || 'Frequency defaults';
  const restoreAll = document.createElement('button');
  restoreAll.type = 'button';
  restoreAll.className = 'charts-freq-restore-all';
  restoreAll.textContent = S.freqTableRestoreAll || 'Restore originals';
  restoreAll.title = S.freqTableRestoreAll || 'Restore originals';
  restoreAll.setAttribute('aria-label', restoreAll.title);
  titleRow.append(heading, restoreAll);
  freqSection.appendChild(titleRow);

  const usedIds = new Set();
  if (commChangeMap && typeof commChangeMap === 'object') {
    for (const row of Object.values(commChangeMap)) {
      if (!row || !Array.isArray(row.callSigns)) continue;
      for (const id of row.callSigns) {
        const key = typeof commCallSignIdKey === 'function'
          ? commCallSignIdKey(id) : String(id || '').trim().toUpperCase();
        if (key) usedIds.add(key);
      }
    }
  }
  const opts = (typeof commAllCallSignOptions === 'function'
    ? commAllCallSignOptions() : [])
    .filter(o => o && o.id)
    .filter(o => {
      const key = typeof commCallSignIdKey === 'function'
        ? commCallSignIdKey(o.id) : String(o.id || '').trim().toUpperCase();
      return key && usedIds.has(key);
    })
    .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
  // Reverse map: call-sign id (key) -> airfield ICAO, so an airfield-primary
  // call sign reads with the airport's ICAO code + "Primary" label (consistent
  // with that airport's Clearance / ATIS rows below) instead of its own code.
  const idToIcao = {};
  if (typeof AIRFIELD_CALL_SIGN_IDS === 'object' && AIRFIELD_CALL_SIGN_IDS) {
    for (const [icao, csId] of Object.entries(AIRFIELD_CALL_SIGN_IDS)) {
      if (!csId) continue;
      idToIcao[typeof commCallSignIdKey === 'function' ? commCallSignIdKey(csId) : String(csId).toUpperCase()] = icao;
    }
  }
  // Airfield clearance / ATIS frequencies — one row per labelled numeric part.
  const afList = (typeof airfields !== 'undefined' && Array.isArray(airfields)) ? airfields : [];
  const afFreqRows = [];
  for (const af of afList) {
    for (const fld of [['clearance', S.clearance || 'Clearance'], ['atis', S.atis || 'ATIS']]) {
      const parts = typeof airfieldFieldParts === 'function' ? airfieldFieldParts(af, fld[0]) : [];
      for (const part of parts) afFreqRows.push({ af, flabel: fld[1], part });
    }
  }
  // VOR frequencies (one editable row each).
  const vorList = (typeof vors !== 'undefined' && Array.isArray(vors)) ? vors : [];
  const vorFreqRows = vorList.map(v => ({
    v,
    def: typeof freqClean === 'function' ? freqClean(v.freq) : String(v.freq || ''),
    get overridden() { return !!(typeof vorFreqOverrides === 'function' && vorFreqOverrides()[v.ident]); },
  }));
  const updateRestoreAll = () => {
    restoreAll.disabled = !(opts.some(o => !!o.overrideFreq) ||
      afFreqRows.some(r => r.part.overridden) || vorFreqRows.some(r => r.overridden));
  };
  updateRestoreAll();
  restoreAll.onclick = e => {
    e.preventDefault();
    if (typeof commResetAllCallSignFreqOverrides === 'function') {
      commResetAllCallSignFreqOverrides();
    } else {
      for (const opt of opts) {
        if (opt.templateFreq && typeof commApplyCallSignFreqOverride === 'function') {
          commApplyCallSignFreqOverride(opt.id, opt.templateFreq);
        }
      }
    }
    try { localStorage.removeItem('navaid.airfieldFreqOverrides'); } catch (err) { /* ignore */ }
    try { localStorage.removeItem('navaid.vorFreqOverrides'); } catch (err) { /* ignore */ }
    renderFreqTable(freqSection);
    afterFreqTableEdit();
  };

  if (!opts.length && !afFreqRows.length && !vorFreqRows.length) {
    const empty = document.createElement('p');
    empty.className = 'charts-freq-empty';
    empty.textContent = S.freqTableEmpty || 'No frequency catalog available';
    freqSection.appendChild(empty);
    return;
  }

  const searchWrap = document.createElement('div');
  searchWrap.className = 'charts-freq-search-row';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'charts-freq-search';
  search.placeholder = S.freqTableSearch || 'Search frequencies';
  search.value = searchQuery;
  search.setAttribute('aria-label', S.freqTableSearch || 'Search frequencies');
  searchWrap.appendChild(search);
  freqSection.appendChild(searchWrap);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'charts-freq-table-wrap';
  const table = document.createElement('table');
  table.className = 'flight-table charts-freq-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of [
    S.freqTableCallSign || 'Call sign',
    S.freqTableDefault || S.commChangeTemplateFreq || 'Default',
    S.freqTableOverride || 'Override',
    '',
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const opt of opts) {
    const tr = document.createElement('tr');
    tr.className = opt.overrideFreq ? 'overridden' : '';
    // Airfield-primary call signs show the airport ICAO as their code, so the
    // same airport reads consistently with its Clearance / ATIS rows (LLHZ),
    // not two codes (HERZLIYA vs LLHZ).
    const optKey = typeof commCallSignIdKey === 'function' ? commCallSignIdKey(opt.id) : String(opt.id || '').toUpperCase();
    const optIcao = idToIcao[optKey] || '';
    const searchText = [
      opt.id, optIcao,
      opt.label,
      opt.templateFreq,
      opt.freq,
      opt.overrideFreq,
      opt.row && opt.row.he,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    tr.dataset.search = searchText;
    const name = document.createElement('td');
    const label = document.createElement('span');
    label.className = 'charts-freq-label';
    label.textContent = opt.label || opt.id;
    name.appendChild(label);
    const codeText = optIcao || ((opt.label && opt.label !== opt.id) ? opt.id : '');
    if (codeText) {
      const code = document.createElement('span');
      code.className = 'charts-freq-code';
      code.textContent = codeText;
      name.appendChild(code);
    }
    const template = document.createElement('td');
    template.className = 'charts-freq-template';
    template.textContent = opt.templateFreq || '';
    const local = document.createElement('td');
    const inp = document.createElement('input');
    inp.className = 'charts-freq-input';
    if (typeof commConfigureFreqInput === 'function') {
      commConfigureFreqInput(inp);
    } else {
      inp.type = 'number';
      inp.inputMode = 'decimal';
      inp.step = '0.005';
    }
    inp.value = opt.freq || opt.templateFreq || '';
    inp.dataset.callSign = opt.id;
    inp.setAttribute('aria-invalid', 'false');
    inp.setAttribute('aria-label', (opt.label || opt.id) + ' ' +
      (S.commChangeFreq || 'Frequency'));
    let reset = null;
    function syncFreqInputValidity() {
      const normalized = typeof commNormalizeFreqInput === 'function'
        ? commNormalizeFreqInput(inp.value) : String(inp.value || '').trim();
      const invalid = normalized === null;
      inp.classList.toggle('invalid', invalid);
      inp.classList.toggle('is-default',
        !invalid && !!opt.templateFreq && (normalized || '') === opt.templateFreq);
      inp.setAttribute('aria-invalid', invalid ? 'true' : 'false');
      if (reset) reset.disabled = !opt.templateFreq || (!opt.overrideFreq && !invalid);
      return normalized;
    }
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    });
    inp.addEventListener('input', syncFreqInputValidity);
    inp.addEventListener('change', () => {
      const normalized = syncFreqInputValidity();
      if (normalized === null) return;
      let eff = normalized;
      if (typeof commApplyCallSignFreqOverride === 'function') {
        eff = commApplyCallSignFreqOverride(opt.id, normalized) || normalized || inp.value;
      }
      inp.value = eff;
      // Update this row in place rather than rebuilding the whole table — a full
      // re-render destroys the focused input and scrolls back to the first row.
      opt.freq = eff;
      opt.overrideFreq = typeof commCallSignOverrideFreq === 'function'
        ? commCallSignOverrideFreq(opt.id) : (eff !== opt.templateFreq ? eff : '');
      tr.classList.toggle('overridden', !!opt.overrideFreq);
      syncFreqInputValidity();
      updateRestoreAll();
      afterFreqTableEdit();
    });
    local.appendChild(inp);
    const actions = document.createElement('td');
    actions.className = 'charts-freq-actions';
    reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'commchange-freq-reset';
    reset.textContent = '↻';
    reset.title = S.resetFreqOverride || S.sliderReset || 'Reset to default';
    reset.setAttribute('aria-label', reset.title);
    reset.disabled = !opt.overrideFreq || !opt.templateFreq;
    function resetTableFreq() {
      if (typeof commResetCallSignFreqOverride === 'function') {
        commResetCallSignFreqOverride(opt.id);
      } else if (opt.templateFreq && typeof commApplyCallSignFreqOverride === 'function') {
        commApplyCallSignFreqOverride(opt.id, opt.templateFreq);
      }
      // Update in place (keep scroll position) — no full table rebuild.
      opt.overrideFreq = '';
      opt.freq = opt.templateFreq || '';
      inp.value = opt.templateFreq || '';
      tr.classList.remove('overridden');
      syncFreqInputValidity();
      updateRestoreAll();
      afterFreqTableEdit();
    }
    // pointerdown handles pointer activation; click handles keyboard. Suppress
    // the click that trails a pointerdown so the reset doesn't fire twice.
    let resetPointerHandled = false;
    reset.onpointerdown = e => {
      if (reset.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      resetPointerHandled = true;
      resetTableFreq();
    };
    reset.onclick = e => {
      e.preventDefault();
      if (resetPointerHandled) { resetPointerHandled = false; return; }
      if (!reset.disabled) resetTableFreq();
    };
    actions.appendChild(reset);
    syncFreqInputValidity();
    tr.append(name, template, local, actions);
    tbody.appendChild(tr);
  }
  // Airfield clearance / ATIS rows (editable numeric parts).
  for (const r of afFreqRows) {
    const part = r.part;
    const tr = document.createElement('tr');
    tr.className = part.overridden ? 'overridden' : '';
    const partName = (part.label ? ' ' + part.label : '');
    tr.dataset.search = [r.af.name, r.af.en, r.af.he, r.flabel, part.label, part.freq, part.def]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    const name = document.createElement('td');
    const label = document.createElement('span');
    label.className = 'charts-freq-label';
    label.textContent = r.flabel + partName;
    name.appendChild(label);
    const code = document.createElement('span');
    code.className = 'charts-freq-code';
    code.textContent = r.af.name;
    name.appendChild(code);
    const template = document.createElement('td');
    template.className = 'charts-freq-template';
    template.textContent = part.def || '';
    const local = document.createElement('td');
    const inp = document.createElement('input');
    inp.className = 'charts-freq-input';
    inp.dir = 'ltr';
    if (typeof commConfigureFreqInput === 'function') commConfigureFreqInput(inp);
    else { inp.type = 'number'; inp.inputMode = 'decimal'; inp.step = '0.005'; }
    inp.value = part.freq || part.def || '';
    const actions = document.createElement('td');
    actions.className = 'charts-freq-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'commchange-freq-reset';
    reset.textContent = '↻';
    reset.title = S.resetFreqOverride || S.sliderReset || 'Reset to default';
    const normOf = () => (typeof commNormalizeFreqInput === 'function'
      ? commNormalizeFreqInput(inp.value) : String(inp.value || '').trim());
    function syncAf() {
      const n = normOf();
      const invalid = n === null;
      inp.classList.toggle('invalid', invalid);
      inp.classList.toggle('is-default', !invalid && !!part.def && (n || '') === part.def);
      inp.setAttribute('aria-invalid', invalid ? 'true' : 'false');
      reset.disabled = !part.def || (!part.overridden && !invalid);
    }
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('input', syncAf);
    inp.addEventListener('change', () => {
      const n = normOf();
      if (n === null) { syncAf(); return; }
      setAirfieldFreqOverride(part.key, n === part.def ? '' : n);
      part.freq = n; part.overridden = n !== part.def;
      inp.value = n;
      tr.classList.toggle('overridden', part.overridden);
      syncAf(); updateRestoreAll(); afterFreqTableEdit();
    });
    reset.onclick = e => {
      e.preventDefault();
      if (reset.disabled) return;
      setAirfieldFreqOverride(part.key, '');
      part.freq = part.def; part.overridden = false;
      inp.value = part.def || '';
      tr.classList.remove('overridden');
      syncAf(); updateRestoreAll(); afterFreqTableEdit();
    };
    local.appendChild(inp);
    actions.appendChild(reset);
    syncAf();
    tr.append(name, template, local, actions);
    tbody.appendChild(tr);
  }
  // VOR rows (editable single frequency each).
  for (const r of vorFreqRows) {
    const v = r.v;
    const tr = document.createElement('tr');
    tr.className = r.overridden ? 'overridden' : '';
    tr.dataset.search = [v.ident, v.name, v.he, 'vor', r.def].filter(Boolean).join(' ').toLocaleLowerCase();
    const name = document.createElement('td');
    const label = document.createElement('span');
    label.className = 'charts-freq-label';
    label.textContent = (v.name || v.ident) + ' VOR';
    name.appendChild(label);
    const code = document.createElement('span');
    code.className = 'charts-freq-code';
    code.textContent = v.ident;
    name.appendChild(code);
    const template = document.createElement('td');
    template.className = 'charts-freq-template';
    template.textContent = r.def || '';
    const local = document.createElement('td');
    const inp = document.createElement('input');
    inp.className = 'charts-freq-input';
    inp.dir = 'ltr';
    if (typeof vorConfigureFreqInput === 'function') vorConfigureFreqInput(inp);
    else { inp.type = 'number'; inp.inputMode = 'decimal'; inp.step = '0.05'; }
    inp.value = (typeof vorEffectiveFreq === 'function' ? vorEffectiveFreq(v) : r.def) || r.def || '';
    const actions = document.createElement('td');
    actions.className = 'charts-freq-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'commchange-freq-reset';
    reset.textContent = '↻';
    reset.title = S.resetFreqOverride || S.sliderReset || 'Reset to default';
    const normOf = () => (typeof vorNormalizeFreqInput === 'function'
      ? vorNormalizeFreqInput(inp.value) : String(inp.value || '').trim());
    function syncVor() {
      const n = normOf();
      const invalid = n === null;
      inp.classList.toggle('invalid', invalid);
      inp.classList.toggle('is-default', !invalid && !!r.def && (n || '') === r.def);
      inp.setAttribute('aria-invalid', invalid ? 'true' : 'false');
      reset.disabled = !r.def || (!r.overridden && !invalid);
    }
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('input', syncVor);
    inp.addEventListener('change', () => {
      const n = normOf();
      if (n === null) { syncVor(); return; }
      if (typeof setVorFreqOverride === 'function') setVorFreqOverride(v.ident, n === r.def ? '' : n);
      inp.value = n;
      tr.classList.toggle('overridden', r.overridden);
      syncVor(); updateRestoreAll(); afterFreqTableEdit();
    });
    reset.onclick = e => {
      e.preventDefault();
      if (reset.disabled) return;
      if (typeof setVorFreqOverride === 'function') setVorFreqOverride(v.ident, '');
      inp.value = r.def || '';
      tr.classList.remove('overridden');
      syncVor(); updateRestoreAll(); afterFreqTableEdit();
    };
    local.appendChild(inp);
    actions.appendChild(reset);
    syncVor();
    tr.append(name, template, local, actions);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  freqSection.appendChild(tableWrap);

  const noMatches = document.createElement('p');
  noMatches.className = 'charts-freq-empty charts-freq-no-matches';
  noMatches.textContent = S.freqTableNoMatches || 'No matching frequencies';
  noMatches.hidden = true;
  freqSection.appendChild(noMatches);

  function applySearchFilter() {
    const q = search.value.trim().toLocaleLowerCase();
    let shown = 0;
    for (const tr of tbody.querySelectorAll('tr')) {
      const hit = !q || (tr.dataset.search || '').includes(q);
      tr.hidden = !hit;
      if (hit) shown += 1;
    }
    noMatches.hidden = shown > 0;
  }
  search.addEventListener('input', applySearchFilter);
  applySearchFilter();
}

function showFreqTableModal() {
  if (!prepareChartModal('freq-table')) return;
  const modal = createDraggableModal(S.tbFreqTable || S.freqTableTitle || 'Freq table',
    'modal wide', () => clearOpenChartModal('freq-table'),
    { nonBlocking: true, chartKind: 'freq-table' });
  const scrollArea = document.createElement('div');
  scrollArea.className = 'fp-scroll';
  const body = document.createElement('div');
  body.className = 'charts-modal-body';
  const freqSection = document.createElement('div');
  freqSection.className = 'charts-freq-section charts-freq-section-only';
  body.appendChild(freqSection);
  const loadingFreq = document.createElement('p');
  loadingFreq.textContent = '…';
  freqSection.appendChild(loadingFreq);
  // Load the catalog + airfields + VORs so the table can list every frequency.
  Promise.all([
    loadCommChange(),
    typeof loadAirfields === 'function' ? loadAirfields() : null,
    typeof loadVors === 'function' ? loadVors() : null,
  ]).then(() => renderFreqTable(freqSection));
  scrollArea.appendChild(body);
  modal.box.appendChild(scrollArea);
  modal.show();
}

function altitudePairSegmentsForChart() {
  if (legAltitudeDataset && Array.isArray(legAltitudeDataset.segments)) {
    return legAltitudeDataset.segments.slice();
  }
  return Object.values(legAltitudeMap || {}).map(segment => ({
    from: segment.from,
    to: segment.to,
    inboundAltitude: segment.inboundAltitude,
    outboundAltitude: segment.outboundAltitude,
    ...(segment.oneWay ? { oneWay: true } : {}),
    ...(segment.status ? { status: segment.status } : {}),
  }));
}

function altitudePairsDataForCopy() {
  const data = (legAltitudeDataset && Array.isArray(legAltitudeDataset.segments))
    ? legAltitudeDataset
    : { version: 1, segments: altitudePairSegmentsForChart() };
  for (const segment of data.segments || []) normalizeAltitudePairSegment(segment);
  syncLegAltitudeDatasetDirectionPool(data);
  return data;
}

function altitudePairsJsonForCopy() {
  const data = altitudePairsDataForCopy();
  return JSON.stringify(data, null, 2);
}

function normalizeAltitudePairSegment(segment) {
  normalizeLegAltitudePairSegment(segment);
}

function formatAltitudePairValue(segment, key) {
  if (!segment) return '';
  const v = segment[key];
  if (v === null && segment.oneWay === true) return S.altPairsBlocked || 'Blocked';
  if (v === null) return S.altPairsUnknown || 'Unknown';
  return Number.isFinite(v) ? String(v) : '';
}

function altitudePairStatus(segment) {
  if (!segment) return '';
  if (segment.inboundAltitude === null && segment.outboundAltitude === null) {
    return S.altPairsUnknown || 'Unknown';
  }
  return segment.oneWay === true
    ? (S.altPairsOneWay || 'One way')
    : (S.altPairsTwoWay || 'Two way');
}

function altitudePairCellPlaceholder(segment, key) {
  if (!segment || segment[key] !== null) return '';
  return segment.oneWay === true
    ? (S.altPairsBlocked || 'Blocked')
    : (S.altPairsUnknown || 'Unknown');
}

function altitudePairCellMatchesOrigin(segment, key) {
  const origin = legAltitudeOriginSegment(segment);
  if (!origin) return false;
  const current = segment[key];
  const original = origin[key];
  if (current === null || original === null) return current === original;
  return Number.isFinite(current) && Number.isFinite(original) &&
    Math.round(current) === Math.round(original);
}

function updateAltitudePairRowState(tr, segment, statusCell, inputs, resetButton,
  directionResetButtons) {
  normalizeAltitudePairSegment(segment);
  const origin = legAltitudeOriginSegment(segment);
  tr.classList.toggle('one-way', segment.oneWay === true);
  tr.classList.toggle('unknown',
    segment.inboundAltitude === null && segment.outboundAltitude === null);
  tr.classList.toggle('overridden', legAltitudePairDiffersFromOrigin(segment));
  if (statusCell) statusCell.textContent = altitudePairStatus(segment);
  if (inputs) {
    for (const input of inputs) {
      const key = input.dataset.altKey;
      const matchesOrigin = altitudePairCellMatchesOrigin(segment, key);
      input.placeholder = altitudePairCellPlaceholder(segment, input.dataset.altKey);
      input.value = Number.isFinite(segment[input.dataset.altKey])
        ? String(segment[input.dataset.altKey]) : '';
      input.classList.toggle('is-default', matchesOrigin);
      const directionReset = directionResetButtons && directionResetButtons[key];
      if (directionReset) directionReset.disabled = !origin || matchesOrigin;
    }
  }
  if (resetButton) resetButton.disabled = !legAltitudePairDiffersFromOrigin(segment);
  const fromAlt = formatAltitudePairValue(segment, 'inboundAltitude');
  const toAlt = formatAltitudePairValue(segment, 'outboundAltitude');
  const distance = Number.isFinite(segment.distanceNm)
    ? String(Math.round(segment.distanceNm * 10) / 10) : '';
  tr.dataset.search = [
    segment.from,
    segment.to,
    fromAlt,
    toAlt,
    altitudePairStatus(segment),
    distance,
    segment.note,
    segment.source,
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function altitudePairNumberInput(segment, key) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'charts-alt-input';
  input.min = '0';
  input.step = '100';
  input.inputMode = 'numeric';
  input.dataset.altKey = key;
  input.value = Number.isFinite(segment[key]) ? String(segment[key]) : '';
  input.placeholder = altitudePairCellPlaceholder(segment, key);
  input.setAttribute('aria-label',
    (key === 'inboundAltitude'
      ? (S.altPairsInbound || 'From to')
      : (S.altPairsOutbound || 'To from')) + ' ' + segment.from + ' ' + segment.to);
  return input;
}

function altitudePairResetButton(className, title) {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = className;
  reset.textContent = '↻';
  reset.title = title;
  reset.setAttribute('aria-label', title);
  return reset;
}

function wireAltitudePairResetButton(reset, resetFn) {
  let pointerHandled = false;
  reset.onpointerdown = e => {
    if (reset.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    pointerHandled = true;
    resetFn();
  };
  reset.onclick = e => {
    e.preventDefault();
    if (pointerHandled) { pointerHandled = false; return; }
    if (!reset.disabled) resetFn();
  };
}

var altitudePairFocusLayer = null;
var altitudePairFocusSource = null;

function clearAltitudePairFocus(source) {
  if (source && altitudePairFocusSource !== source) return false;
  if (altitudePairFocusLayer && map && map.removeLayer) {
    map.removeLayer(altitudePairFocusLayer);
  }
  altitudePairFocusLayer = null;
  altitudePairFocusSource = null;
  return true;
}

function altitudePairSearchPairKey(segment) {
  return String(segment && segment.from || '').trim().toLocaleLowerCase()
    + '\u001f' + String(segment && segment.to || '').trim().toLocaleLowerCase();
}

function altitudePairMatchesExactSearch(segment, terms) {
  if (!segment || terms.length !== 2) return false;
  const from = String(segment.from || '').trim().toLocaleLowerCase();
  const to = String(segment.to || '').trim().toLocaleLowerCase();
  return (terms[0] === from && terms[1] === to) || (terms[0] === to && terms[1] === from);
}

function altitudePairEndpoint(name) {
  const code = String(name || '').trim();
  if (!code) return null;
  const visit = p => p && p.name === code && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  if (Array.isArray(navWP)) {
    const point = navWP.find(visit);
    if (point) return point;
  }
  if (Array.isArray(airfields)) {
    const point = airfields.find(visit);
    if (point) return point;
  }
  return null;
}

function showAltitudePairFocus(from, to, keepVisible, source) {
  clearAltitudePairFocus();
  const latlngs = [[from.lat, from.lng], [to.lat, to.lng]];
  const lineColor = tune('altPairFocusColor');
  const dotColor = tune('altPairFocusDotColor');
  const dotRadius = tune('altPairFocusDotRadiusPx');
  const dot = ll => L.circleMarker(ll, {
    className: 'alt-pair-focus-dot alt-pair-focus-blink',
    radius: dotRadius,
    color: lineColor,
    weight: 3,
    fillColor: dotColor,
    fillOpacity: tune('altPairFocusDotAlpha'),
    interactive: false,
  });
  const layer = L.layerGroup([
    L.polyline(latlngs, {
      className: 'alt-pair-focus-line alt-pair-focus-blink',
      color: lineColor,
      weight: tune('altPairFocusWidthPx'),
      opacity: tune('altPairFocusLineAlpha'),
      dashArray: tune('altPairFocusDashOnPx') + ' ' + tune('altPairFocusDashOffPx'),
      interactive: false,
    }),
    dot(latlngs[0]),
    dot(latlngs[1]),
  ]).addTo(map);
  altitudePairFocusLayer = layer;
  altitudePairFocusSource = source || null;
  if (keepVisible) return;
  window.setTimeout(() => {
    if (altitudePairFocusLayer === layer && map && map.hasLayer(layer)) {
      map.removeLayer(layer);
      altitudePairFocusLayer = null;
      altitudePairFocusSource = null;
    }
  }, tune('altPairFocusMs'));
}

async function focusAltitudePairSegment(segment, closeModal, keepFocusVisible, focusSource) {
  if (!segment) return false;
  if (navWP === null && typeof loadNavWaypoints === 'function') await loadNavWaypoints();
  if (airfields === null && typeof loadAirfields === 'function') await loadAirfields();
  const from = altitudePairEndpoint(segment.from);
  const to = altitudePairEndpoint(segment.to);
  if (!from || !to) {
    if (typeof showToast === 'function') {
      showToast(S.altPairsLocationMissing || 'Pair endpoints not found');
    }
    return false;
  }
  if (typeof closeModal === 'function') closeModal();
  const bounds = L.latLngBounds([[from.lat, from.lng], [to.lat, to.lng]]);
  map.fitBounds(bounds, { padding: [80, 80], maxZoom: 12, animate: false });
  showAltitudePairFocus(from, to, keepFocusVisible, focusSource);
  return true;
}

function createAltitudePairsPinButton(opts) {
  opts = opts || {};
  if (typeof opts.keepOpenOnFocus !== 'boolean') opts.keepOpenOnFocus = false;
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'modal-close-action charts-alt-pin';
  pin.textContent = '📌';
  const updatePinButton = () => {
    const title = opts.keepOpenOnFocus
      ? (S.altPairsPinnedTitle || S.altPairsPinTitle || 'Alt pairs stays open')
      : (S.altPairsPinTitle || 'Keep Alt pairs open');
    pin.title = title;
    pin.setAttribute('aria-label', title);
    pin.setAttribute('aria-pressed', opts.keepOpenOnFocus ? 'true' : 'false');
    pin.classList.toggle('is-pinned', opts.keepOpenOnFocus);
  };
  opts.updatePinButton = updatePinButton;
  updatePinButton();
  pin.onclick = e => {
    e.preventDefault();
    opts.keepOpenOnFocus = !opts.keepOpenOnFocus;
    updatePinButton();
  };
  return pin;
}

function renderAltitudePairsTable(altSection, opts) {
  opts = opts || altSection._altitudePairsRenderOpts || {};
  if (typeof opts.keepOpenOnFocus !== 'boolean') opts.keepOpenOnFocus = false;
  if (typeof opts.updatePinButton === 'function') opts.updatePinButton();
  altSection._altitudePairsRenderOpts = opts;
  const existingSearch = altSection.querySelector('.charts-alt-search');
  const searchQuery = existingSearch ? existingSearch.value : '';
  altSection.innerHTML = '';

  const titleRow = document.createElement('div');
  titleRow.className = 'charts-alt-title';
  const heading = document.createElement('h3');
  // Reflect the active base layer (CVFR / LSA / Helicopters) in the heading.
  const _apPfx = (typeof layerDataPrefix === 'function') ? layerDataPrefix() : 'cvfr';
  const _apLabel = typeof layerLabelForPrefix === 'function' ? layerLabelForPrefix(_apPfx) : 'CVFR';
  heading.textContent = typeof S.altPairsTitleFor === 'function'
    ? S.altPairsTitleFor(_apLabel)
    : (S.altPairsTitle || 'CVFR altitude pairs');
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'charts-alt-copy';
  copy.textContent = S.altPairsCopyJson || 'Copy JSON';
  copy.title = copy.textContent;
  copy.setAttribute('aria-label', copy.title);
  const resetAll = document.createElement('button');
  resetAll.type = 'button';
  resetAll.className = 'charts-alt-reset-all';
  resetAll.textContent = S.altPairsResetAll || '↻ Reset all';
  resetAll.title = S.altPairsResetAllTitle || resetAll.textContent;
  resetAll.setAttribute('aria-label', resetAll.title);
  const actions = document.createElement('div');
  actions.className = 'charts-alt-title-actions';
  actions.append(resetAll, copy);
  titleRow.append(heading, actions);
  altSection.appendChild(titleRow);

  copy.onclick = async e => {
    e.preventDefault();
    const text = altitudePairsJsonForCopy();
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      copy.textContent = S.altPairsCopied || 'Copied';
      if (typeof showToast === 'function') showToast(S.altPairsCopied || 'Copied');
    } catch (err) {
      copy.textContent = S.altPairsCopyFailed || 'Copy failed';
      window.prompt(S.altPairsCopyJson || 'Copy JSON', text);
    } finally {
      setTimeout(() => { copy.textContent = S.altPairsCopyJson || 'Copy JSON'; }, 1200);
    }
  };

  const segments = altitudePairSegmentsForChart()
    .filter(segment => segment && segment.from && segment.to)
    .sort((a, b) => (a.from + '-' + a.to).localeCompare(b.from + '-' + b.to));
  const syncAltitudePairsAfterEdit = () => {
    applyLegAltitudesToRoute();
    draw();
    if (state.selected) showInspector();
    if (typeof refreshFlightPlan === 'function' && refreshFlightPlan) refreshFlightPlan();
  };
  const updateResetAll = () => {
    resetAll.disabled = !segments.some(segment => legAltitudePairDiffersFromOrigin(segment));
  };
  resetAll.onclick = e => {
    e.preventDefault();
    let changed = false;
    for (const segment of segments) {
      changed = restoreLegAltitudePairOrigin(segment) || changed;
    }
    if (!changed) {
      updateResetAll();
      return;
    }
    syncAltitudePairsAfterEdit();
    renderAltitudePairsTable(altSection, opts);
  };
  updateResetAll();
  if (!segments.length) {
    const empty = document.createElement('p');
    empty.className = 'charts-alt-empty';
    empty.textContent = S.altPairsEmpty || 'No altitude-pair data available';
    altSection.appendChild(empty);
    return;
  }

  const searchWrap = document.createElement('div');
  searchWrap.className = 'charts-alt-search-row';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'charts-alt-search';
  search.placeholder = S.altPairsSearch || 'Search altitude pairs';
  search.value = searchQuery;
  search.setAttribute('aria-label', S.altPairsSearch || 'Search altitude pairs');
  searchWrap.appendChild(search);
  altSection.appendChild(searchWrap);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'charts-alt-table-wrap';
  const table = document.createElement('table');
  table.className = 'flight-table charts-alt-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of [
    { label: S.altPairsPair || 'Pair' },
    {
      label: S.altPairsInbound || 'From → to',
      title: S.altPairsInboundTitle || 'Altitude in the pair direction',
    },
    {
      label: S.altPairsOutbound || 'To → from',
      title: S.altPairsOutboundTitle || 'Altitude in the reverse direction',
    },
    { label: S.altPairsStatus || 'Status' },
    { label: S.altPairsDistance || 'NM' },
    { label: '', title: S.altPairsRevertOrigin || 'Revert to origin' },
  ]) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (!col.label) th.className = 'charts-alt-actions';
    if (col.title) {
      th.title = col.title;
      th.setAttribute('aria-label', col.title);
    }
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const segment of segments) {
    const tr = document.createElement('tr');
    normalizeAltitudePairSegment(segment);
    const distance = Number.isFinite(segment.distanceNm)
      ? String(Math.round(segment.distanceNm * 10) / 10) : '';

    const pair = document.createElement('td');
    pair.className = 'charts-alt-pair';
    const pairButton = document.createElement('button');
    pairButton.type = 'button';
    pairButton.className = 'charts-alt-pair-button';
    pairButton.textContent = segment.from + ' ↔ ' + segment.to;
    pairButton.title = (typeof S.altPairsGoTo === 'function')
      ? S.altPairsGoTo(segment.from, segment.to)
      : 'Go to ' + segment.from + ' ↔ ' + segment.to;
    pairButton.setAttribute('aria-label', pairButton.title);
    pairButton.addEventListener('click', e => {
      e.preventDefault();
      const closeModal = opts.keepOpenOnFocus ? null : opts.closeModal;
      focusAltitudePairSegment(segment, closeModal, opts.keepOpenOnFocus,
        opts.keepOpenOnFocus ? 'pinned' : 'manual').catch(err => {
        console.warn('Failed to focus leg-altitude pair:', err);
        if (typeof showToast === 'function') {
          showToast(S.altPairsLocationMissing || 'Pair endpoints not found');
        }
      });
    });
    pair.appendChild(pairButton);
    const inbound = document.createElement('td');
    const inboundInput = altitudePairNumberInput(segment, 'inboundAltitude');
    const inboundReset = altitudePairResetButton(
      'commchange-freq-reset charts-alt-cell-reset',
      S.altPairsRevertDirection || S.altPairsRevertOrigin || 'Revert this direction to origin');
    const inboundControl = document.createElement('div');
    inboundControl.className = 'charts-alt-cell-control';
    inboundControl.append(inboundInput, inboundReset);
    inbound.appendChild(inboundControl);
    const outbound = document.createElement('td');
    const outboundInput = altitudePairNumberInput(segment, 'outboundAltitude');
    const outboundReset = altitudePairResetButton(
      'commchange-freq-reset charts-alt-cell-reset',
      S.altPairsRevertDirection || S.altPairsRevertOrigin || 'Revert this direction to origin');
    const outboundControl = document.createElement('div');
    outboundControl.className = 'charts-alt-cell-control';
    outboundControl.append(outboundInput, outboundReset);
    outbound.appendChild(outboundControl);
    const statusCell = document.createElement('td');
    statusCell.className = 'charts-alt-status';
    const distCell = document.createElement('td');
    distCell.className = 'charts-alt-distance';
    distCell.textContent = distance;
    const actions = document.createElement('td');
    actions.className = 'charts-alt-actions';
    const reset = altitudePairResetButton('commchange-freq-reset charts-alt-reset',
      S.altPairsRevertOrigin || 'Revert to origin');
    actions.appendChild(reset);
    tr.append(pair, inbound, outbound, statusCell, distCell, actions);
    const inputs = [inboundInput, outboundInput];
    const directionResetButtons = {
      inboundAltitude: inboundReset,
      outboundAltitude: outboundReset,
    };
    const syncPairEdit = () => {
      updateAltitudePairRowState(tr, segment, statusCell, inputs, reset, directionResetButtons);
      updateResetAll();
      applySearchFilter();
      syncAltitudePairsAfterEdit();
    };
    const commitInput = input => {
      const raw = input.value.trim();
      if (!raw) {
        input.setAttribute('aria-invalid', 'false');
        setLegAltitudePairValue(segment, input.dataset.altKey, null);
      } else {
        const next = Number(raw);
        if (!Number.isFinite(next)) {
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        input.setAttribute('aria-invalid', 'false');
        setLegAltitudePairValue(segment, input.dataset.altKey, next);
        input.value = String(segment[input.dataset.altKey]);
      }
      syncPairEdit();
    };
    const resetAltitudePairDirection = key => {
      const origin = legAltitudeOriginSegment(segment);
      if (!origin) return;
      setLegAltitudePairValue(segment, key, origin[key]);
      syncPairEdit();
    };
    for (const input of inputs) {
      input.addEventListener('change', () => commitInput(input));
      input.addEventListener('blur', () => commitInput(input));
    }
    function resetAltitudePair() {
      restoreLegAltitudePairOrigin(segment);
      syncPairEdit();
    }
    wireAltitudePairResetButton(inboundReset,
      () => resetAltitudePairDirection('inboundAltitude'));
    wireAltitudePairResetButton(outboundReset,
      () => resetAltitudePairDirection('outboundAltitude'));
    wireAltitudePairResetButton(reset, resetAltitudePair);
    updateAltitudePairRowState(tr, segment, statusCell, inputs, reset, directionResetButtons);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  altSection.appendChild(tableWrap);
  const renderedRows = Array.from(tbody.querySelectorAll('tr')).map((tr, index) => ({
    tr,
    segment: segments[index],
  }));

  const noMatches = document.createElement('p');
  noMatches.className = 'charts-alt-empty charts-alt-no-matches';
  noMatches.textContent = S.altPairsNoMatches || 'No matching altitude pairs';
  noMatches.hidden = true;
  altSection.appendChild(noMatches);

  function applySearchFilter() {
    const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    let exactMatch = null;
    for (const row of renderedRows) {
      const tr = row.tr;
      const rowSearch = tr.dataset.search || '';
      const hit = !terms.length || terms.every(term => rowSearch.includes(term));
      tr.hidden = !hit;
      if (hit) shown += 1;
      if (!exactMatch && altitudePairMatchesExactSearch(row.segment, terms)) exactMatch = row.segment;
    }
    noMatches.hidden = shown > 0;
    const exactKey = exactMatch ? altitudePairSearchPairKey(exactMatch) : '';
    if (exactMatch && opts.autoSearchFocusKey !== exactKey) {
      opts.autoSearchFocusKey = exactKey;
      focusAltitudePairSegment(exactMatch, null, true, 'search').then(ok => {
        if (ok && opts.autoSearchFocusKey !== exactKey) clearAltitudePairFocus('search');
      }).catch(err => {
        console.warn('Failed to focus exact leg-altitude search:', err);
      });
    } else if (!exactMatch && opts.autoSearchFocusKey) {
      opts.autoSearchFocusKey = '';
      clearAltitudePairFocus('search');
    }
  }
  search.addEventListener('input', applySearchFilter);
  applySearchFilter();
}

function refreshAltitudePairsTableIfOpen() {
  for (const section of document.querySelectorAll('.charts-alt-section')) {
    renderAltitudePairsTable(section, section._altitudePairsRenderOpts || {});
  }
}

function showAltitudePairsModal() {
  if (!prepareChartModal('alt-pairs')) return;
  const renderOpts = { keepOpenOnFocus: false };
  const pin = createAltitudePairsPinButton(renderOpts);
  const modal = createDraggableModal(S.tbAltPairs || S.altPairsTitle || 'Alt pairs',
    'modal wide charts-alt-modal', () => {
      clearOpenChartModal('alt-pairs');
      clearAltitudePairFocus();
    },
    { nonBlocking: true, chartKind: 'alt-pairs', closeActions: [pin] });
  renderOpts.closeModal = modal.close;
  const scrollArea = document.createElement('div');
  scrollArea.className = 'fp-scroll';
  const body = document.createElement('div');
  body.className = 'charts-modal-body';
  const altSection = document.createElement('div');
  altSection.className = 'charts-alt-section charts-alt-section-only';
  body.appendChild(altSection);
  const loading = document.createElement('p');
  loading.textContent = '…';
  altSection.appendChild(loading);
  loadLegAltitudes().then(() => renderAltitudePairsTable(altSection, renderOpts));
  scrollArea.appendChild(body);
  modal.box.appendChild(scrollArea);
  modal.show();
}

function showChartsModal(focusIcao) {
  if (!prepareChartModal('airport-charts')) return;
  // Warm the plate manifest while the user scans the list, so the first open
  // already knows the page count.
  if (typeof loadPlatesManifest === 'function') loadPlatesManifest().catch(() => {});
  const modal = createDraggableModal(S.plates, 'modal wide',
    () => clearOpenChartModal('airport-charts'),
    { nonBlocking: true, chartKind: 'airport-charts' });
  const scrollArea = document.createElement('div');
  scrollArea.className = 'fp-scroll';
  const body = document.createElement('div');
  body.className = 'charts-modal-body';
  const platesSection = document.createElement('div');
  platesSection.className = 'charts-plates-section';
  body.appendChild(platesSection);

  const catOrder = ['approach', 'sid', 'star', 'ground', 'vfr', 'other'];
  const catLabel = {
    approach: S.plateCategoryApproach,
    sid: S.plateCategorySid,
    star: S.plateCategoryStar,
    ground: S.plateCategoryGround,
    vfr: S.plateCategoryVfr,
    other: S.plateCategoryOther,
  };

  function renderList(afs, focusIcao) {
    platesSection.innerHTML = '';
    const withPlates = afs.filter(af => af.plates && af.plates.length)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!withPlates.length) {
      const none = document.createElement('p');
      none.textContent = S.platesNone;
      platesSection.appendChild(none);
      return;
    }
    let focusSection = null;
    for (const af of withPlates) {
      const section = document.createElement('div');
      section.className = 'charts-airport';
      section.dataset.icao = af.name;
      const header = document.createElement('div');
      header.className = 'charts-airport-header';
      header.textContent = af.name + (af.en ? ' — ' + af.en : '');
      // Keyboard + screen-reader parity with the toolbar's .tb-section-head
      // pattern: tabbable, announced as a button, with explicit expanded
      // state. The pane it controls is display:none until 'open', so without
      // this the plate chips inside would be unreachable from the keyboard.
      header.tabIndex = 0;
      header.setAttribute('role', 'button');
      header.setAttribute('aria-expanded', 'false');
      const pane = document.createElement('div');
      pane.className = 'charts-airport-body';
      function toggle() {
        const open = pane.classList.toggle('open');
        header.classList.toggle('open', open);
        header.setAttribute('aria-expanded', open ? 'true' : 'false');
        // Touch-friendly warm: hover/focus never fires on a tap, so prefetch
        // this airfield's plates when its section is expanded (deduped by
        // prefetchPlate, so it won't refetch ones already warmed by hover).
        if (open) af.plates.forEach(prefetchPlate);
      }
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      section.appendChild(header);

      const groups = {};
      for (const fn of af.plates) {
        const cat = plateCategory(fn);
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(fn);
      }
      for (const cat of catOrder) {
        if (!groups[cat]) continue;
        const catDiv = document.createElement('div');
        catDiv.className = 'charts-cat';
        const catLbl = document.createElement('span');
        catLbl.className = 'charts-cat-label';
        catLbl.textContent = catLabel[cat];
        catDiv.appendChild(catLbl);
        for (const fn of groups[cat]) {
          const chip = document.createElement('button');
          chip.className = 'plate-chip';
          chip.textContent = prettyPlateLabel(fn);
          chip.onclick = () => showPlateViewer(fn, prettyPlateLabel(fn));
          // Prefetch on intent (hover / keyboard focus) so the click loads from
          // cache. One-shot per chip via prefetchPlate's dedupe.
          const warm = () => prefetchPlate(fn);
          chip.addEventListener('pointerenter', warm);
          chip.addEventListener('focus', warm);
          catDiv.appendChild(chip);
        }
        pane.appendChild(catDiv);
      }
      // Auto-expand + remember the airfield opened from the inspector button.
      if (focusIcao && af.name === focusIcao) {
        pane.classList.add('open');
        header.classList.add('open');
        header.setAttribute('aria-expanded', 'true');
        focusSection = section;
        af.plates.forEach(prefetchPlate);   // warm the auto-opened airfield's plates
      }
      section.appendChild(pane);
      platesSection.appendChild(section);
    }
    if (focusSection) requestAnimationFrame(() => focusSection.scrollIntoView({ block: 'start' }));
  }

  if (airfields) {
    renderList(airfields, focusIcao);
  } else {
    const loading = document.createElement('p');
    loading.textContent = '…';
    platesSection.appendChild(loading);
    loadAirfields().then(() => { if (airfields) renderList(airfields, focusIcao); });
  }

  scrollArea.appendChild(body);
  modal.box.appendChild(scrollArea);

  const att = document.createElement('div');
  att.className = 'plate-attribution';
  att.textContent = S.plateAttribution;
  modal.box.appendChild(att);
  modal.show();
}

// --- shareable route link (#162) -----------------------------------
// Encodes the current route into the URL so a pilot can paste a link
// into WhatsApp / Telegram and the receiver opens the same route.
//
// Wire format (chosen for URL-length budget — JSON+base64 of a 20-WP
// route blows past WhatsApp's ~2 KB preview render):
//   ?r=<polyline>         — Google Encoded Polyline of [lat,lng] pairs
//                            at 1e-5 precision (~1.1 m at 32 N)
//   &n=<base64url-names>  — names joined by U+001F, then base64url
//                            (UTF-8 safe — Hebrew names go through)
//   &l=<compact-legs>     — semicolon-separated `ia,oa,fs[,os]` triples
//                            where outboundSpeed is optional
const SHARE_NAME_SEP = '\x1f';

function _polyEncodeSigned(v) {
  v = v < 0 ? ~(v << 1) : (v << 1);
  let out = '';
  while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>>= 5; }
  out += String.fromCharCode(v + 63);
  return out;
}
function polylineEncode(points) {
  let out = '', prevLat = 0, prevLng = 0;
  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * 1e5), lngE5 = Math.round(lng * 1e5);
    out += _polyEncodeSigned(latE5 - prevLat) + _polyEncodeSigned(lngE5 - prevLng);
    prevLat = latE5; prevLng = lngE5;
  }
  return out;
}
function polylineDecode(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >>> 1) : (result >>> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >>> 1) : (result >>> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
function _b64UrlEncode(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64UrlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

// Build the share URL from current state. Returns null if no route or if
// the route would exceed SHARE_MAX_WAYPOINTS.
function buildShareUrl() {
  if (state.waypoints.length < 2) return { err: 'errNeedWps' };
  if (state.waypoints.length > tune('shareMaxWaypoints')) return { err: 'errShareTooLong' };
  const r = polylineEncode(state.waypoints.map(w => [w.lat, w.lng]));
  const n = _b64UrlEncode(state.waypoints.map(w => w.name || '').join(SHARE_NAME_SEP));
  const l = state.legs.map(leg => {
    const triple = [
      encodeRouteAltitude(leg.inboundAltitude),
      encodeRouteAltitude(leg.outboundAltitude),
      leg.flightSpeed,
    ];
    if (leg.outboundSpeed != null && leg.outboundSpeed !== leg.flightSpeed) {
      triple.push(leg.outboundSpeed);
    }
    return triple.join(',');
  }).join(';');
  const base = location.origin + location.pathname;
  const params = new URLSearchParams(location.search);
  // Preserve ?lang= so the receiver opens in the sender's language. Drop
  // any previous share params so re-shares don't double up.
  params.delete('r'); params.delete('n'); params.delete('l');
  params.delete('f'); params.delete('x');
  params.set('r', r); params.set('n', n); params.set('l', l);
  const freqNotes = state.notes.filter(n => n && n.cc);
  if (freqNotes.length) {
    const f = _b64UrlEncode(freqNotes.map(n =>
      [n.cc, n.freqName || '', n.freq || ''].join(',')).join(';'));
    params.set('f', f);
  }
  const supps = state.commChangeSuppressions;
  if (Array.isArray(supps) && supps.length) {
    params.set('x', _b64UrlEncode(supps.join(',')));
  }
  return { url: base + '?' + params.toString() };
}

// Decode a share URL back into a route shape. Returns the route or null.
function decodeShareUrl(search) {
  const params = new URLSearchParams(search);
  const r = params.get('r'), n = params.get('n'), l = params.get('l');
  if (!r || n === null || l === null) return null;
  let coords, names, legParts;
  let freqNotes = [], suppressions = [];
  try {
    coords = polylineDecode(r);
    names = _b64UrlDecode(n).split(SHARE_NAME_SEP);
    legParts = l === '' ? [] : l.split(';');
    const f = params.get('f');
    if (f) {
      const raw = _b64UrlDecode(f);
      freqNotes = raw.split(';').filter(Boolean).map(s => {
        const p = s.split(',');
        if (p.length < 3) return null;
        return { cc: p[0], freqName: p[1], freq: p[2] };
      }).filter(Boolean);
    }
    const x = params.get('x');
    if (x) {
      suppressions = _b64UrlDecode(x).split(',').filter(Boolean);
    }
  } catch (e) {
    return null;
  }
  if (!coords.length || names.length !== coords.length) return null;
  if (legParts.length !== Math.max(0, coords.length - 1)) return null;
  const waypoints = coords.map(([lat, lng], i) => ({ lat, lng, name: names[i] || '' }));
  const legs = legParts.map(s => {
    const parts = s.split(',');
    // Treat an empty field as unset (NaN), NOT 0 — Number('') is 0, which would
    // silently load a truncated/tampered link as a 0 ft / 0 kt leg. Empty speed
    // → NaN → this leg is null → the whole link is rejected (guard below).
    const altitudePart = raw => (raw === 'NaN' || raw === '') ? NaN : Number(raw);
    const numericPart = raw => raw === '' ? NaN : Number(raw);
    if (parts.length < 3) return null;
    const ia = altitudePart(parts[0]);
    const oa = altitudePart(parts[1]);
    const fs = numericPart(parts[2]);
    const os = parts.length > 3 ? numericPart(parts[3]) : undefined;
    if ((!Number.isFinite(ia) && !Number.isNaN(ia)) ||
        (!Number.isFinite(oa) && !Number.isNaN(oa)) ||
        !Number.isFinite(fs) ||
        (os !== undefined && !Number.isFinite(os))) return null;
    // Short-URL share format doesn't carry per-leg label offsets — use the
    // size-independent default with `_m: 1` so the offsets render at the
    // same on-screen position as a freshly-created leg, independent of
    // legArrowSize, and so the migration in restoreRoute() / load() never
    // touches them on a later round-trip (PR-review #3 + #5).
    const d = _defaultLegLabels();
    return {
      inboundAltitude: ia,
      outboundAltitude: oa,
      flightSpeed: fs,
      outboundSpeed: os != null ? os : fs,
      inLabel: d.inLabel,
      outLabel: d.outLabel,
      cumLabel: d.cumLabel,
      cumLabelRet: d.cumLabelRet,
    };
  });
  if (legs.some(l => l === null)) return null;
  return { waypoints, legs, notes: [], freqNotes, suppressions };
}

// Called from ui.js boot, before restoreRoute(). Returns true if a route
// was loaded from the URL (boot should skip restoreRoute in that case).
function tryLoadRouteFromUrl() {
  const r = decodeShareUrl(location.search);
  if (!r) return false;
  const verr = validateRoute(r);
  if (verr) { console.warn('share-link schema error:', verr); return false; }
  state.waypoints = r.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
  state.legs = r.legs;
  state.notes = [];
  state.commChangeSuppressions = [];
  if (Array.isArray(r.suppressions) && r.suppressions.length) {
    state.commChangeSuppressions = r.suppressions.slice();
  }
  if (Array.isArray(r.freqNotes) && r.freqNotes.length) {
    for (const fn of r.freqNotes) {
      const idx = state.notes.push({
        text: 'Freq change',
        color: (typeof NOTE_DEFAULT_COLOR !== 'undefined' ? NOTE_DEFAULT_COLOR : tune('labelFillColor')),
        shape: 'rect',
        cc: fn.cc, freqName: fn.freqName, freq: fn.freq,
      }) - 1;
      // Place tail at default position for the target waypoint.
      const wp = state.waypoints.find(w => w &&
        typeof canonicalNavWaypointName === 'function' &&
        canonicalNavWaypointName(w.name) === fn.cc);
      if (wp && typeof commCalloutDefaultTail === 'function') {
        const tail = commCalloutDefaultTail(wp);
        state.notes[idx].lat = tail.lat;
        state.notes[idx].lng = tail.lng;
      }
    }
  }
  return true;
}

// Lightweight non-blocking toast (no popup, no modal). The share action
// fires often enough that an alert() was disproportionately disruptive —
// pilots want the link copied and to keep working. The toast self-removes
// after 2.5 s; clipboard failures still fall through to a window.prompt
// so the URL can be copied manually.
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  void el.offsetWidth;                  // force reflow so the fade-in runs
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2500);
}

// --- magnifying glass -------------------------------------------------
let _magDirty = true;                      // content needs rebuilding
let _magRAF = null;                        // requestAnimationFrame id
let _magX = 0, _magY = 0;                 // last known cursor (viewport px)
let _magFixed = false;                     // click-to-lock fixed position
// Cursor coords used for the most recent hi-res rebuild. Initialised to a
// sentinel so the first real mousemove always triggers a rebuild — without
// this the cursor-driven refetch in updateMagnifier would short-circuit when
// the user opens the loupe with a stale `_magX`.
let _magLastX = -Infinity, _magLastY = -Infinity;
// Visible CSS scale of the loupe content — ALWAYS equals `magnifierZoom`
// (the slider value). Refreshed by rebuildMagnifier();
// applyMagnifierTransform() reads it for the loupe's `scale()` transform.
//
// A previous iteration set this to `max(slider, sub)` so hi-res tiles
// rendered at native pixel density. That conflated two concepts: the
// USER-FACING magnification (slider) vs. the IMPLEMENTATION-DETAIL
// sub-tile zoom step. At base z=8 / slider 4.75 the loupe rendered at
// 16× — almost 4× the value the user dialled in — because `sub` (16)
// won the max(). The hi-res tiles are still fetched (see `sub` in
// rebuildMagnifier); they just get downsampled to slider density on
// display, which is far crisper than upscaling the cloned base tiles.
let _magScale = 1;
// Minimum loupe zoom — even when the base map is wide-out (z=8) the hi-res
// overlay aims for at least this zoom so VFR chart labels stay legible.
// Hard ceiling on the per-rebuild sub-tile grid (sub = 2^MAG_MAX_EXP).
// sub=16 → up to 4 zoom levels deeper than the displayed map tile, which is
// what `MAG_BASELINE_Z` needs at the lowest allowed map zoom (8 → 12).
// In-flight hi-res sub-tile counter for the current rebuild batch. The
// "Perfecting…" indicator is visible while this is > 0.
let _magPendingTiles = 0;
// Monotonically increasing rebuild id. Tile <img>s are tagged with the
// batch they were created in; load/error callbacks from a stale batch
// (e.g. cursor moved fast and a newer rebuild already ran) bail out so
// they don't decrement the current batch's counter.
let _magBatch = 0;

function magCenter() { return magnifierSize / 2; }

// Read Leaflet's `.leaflet-map-pane` CSS transform once and return its
// {dx, dy} translation. Reading `getComputedStyle(...).transform` forces
// a style flush; callers in the rAF-driven loupe path should call this
// once per frame and reuse the result. Returns {dx:0,dy:0} if the pane
// is missing or the matrix can't be parsed.
// The loupe clones live in two coordinate systems: the cloned base /
// hi-res tiles are positioned in `.leaflet-rotate-pane`-LOCAL pixels
// (unrotated), while the captured overlay canvas is in rotated CONTAINER
// pixels (drawn via `latLngToContainerPoint`, which accounts for bearing).
// To reconcile them we read the rotate-pane's full transform matrix: a
// `tileWrap` div carries it so the local-space tiles land in container
// space, and the loupe transform then works in pure container space. At
// bearing 0 the matrix is the identity, so this is a no-op for the common
// case. Falls back to `.leaflet-map-pane` (then identity) when the rotate
// plugin isn't present.
function _readMagPaneMatrix() {
  const pane = document.querySelector('.leaflet-rotate-pane') ||
               document.querySelector('.leaflet-map-pane');
  const IDENTITY = 'matrix(1, 0, 0, 1, 0, 0)';
  if (!pane) return { m: new DOMMatrixReadOnly(), css: IDENTITY };
  const css = getComputedStyle(pane).transform;
  if (!css || css === 'none') return { m: new DOMMatrixReadOnly(), css: IDENTITY };
  try {
    return { m: new DOMMatrixReadOnly(css), css };
  } catch (e) {
    return { m: new DOMMatrixReadOnly(), css: IDENTITY };
  }
}

function showMagLoading() {
  const el = document.querySelector('#magnifier .mag-loading');
  if (el) el.classList.add('show');
}

function hideMagLoading() {
  const el = document.querySelector('#magnifier .mag-loading');
  if (el) el.classList.remove('show');
}

function createMagnifier() {
  if (document.getElementById('magnifier')) return;
  const mag = document.createElement('div');
  mag.id = 'magnifier';
  mag.style.cssText = 'display:none;position:fixed;z-index:1000;width:' + magnifierSize +
    'px;height:' + magnifierSize + 'px;border-radius:50%;overflow:hidden;' +
    'pointer-events:none;border:2px solid rgba(255,204,51,0.85);' +
    'box-shadow:0 0 20px rgba(0,0,0,0.6)';
  const content = document.createElement('div');
  content.id = 'mag-content';
  content.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;transform-origin:0 0';
  mag.appendChild(content);
  // crosshair
  const ch = document.createElement('div');
  ch.style.cssText = 'position:absolute;top:50%;left:50%;width:0;height:0;pointer-events:none';
  ch.innerHTML =
    '<div style="position:absolute;top:-1px;left:-24px;width:48px;height:2px;background:rgba(255,60,60,0.8)"></div>' +
    '<div style="position:absolute;top:-24px;left:-1px;width:2px;height:48px;background:rgba(255,60,60,0.8)"></div>';
  mag.appendChild(ch);
  // "Perfecting…" indicator — sibling of `content` so the loupe's scale()
  // transform doesn't affect it. Hidden by default; rebuildMagnifier
  // shows it when there are in-flight hi-res sub-tiles.
  const loading = document.createElement('div');
  loading.className = 'mag-loading';
  loading.textContent = (typeof S !== 'undefined' && S.magLoading) || 'Perfecting…';
  mag.appendChild(loading);
  document.body.appendChild(mag);
}

function rebuildMagnifier() {
  if (!magnifierOn) return;
  const content = document.getElementById('mag-content');
  if (!content) return;
  content.innerHTML = '';
  _magLastX = _magX;
  _magLastY = _magY;
  // Start a fresh hi-res batch. Any pending load/error callbacks from a
  // prior rebuild are now stale — they'll match a different `_magBatch`
  // value and bail out instead of decrementing the new batch's counter.
  const batch = ++_magBatch;
  _magPendingTiles = 0;

  // Read the rotate-pane matrix once. `tileWrap` carries it so every cloned
  // tile (positioned in rotate-pane-LOCAL pixels) is mapped into CONTAINER
  // space — the same space the captured overlay canvas lives in. Without
  // this the tiles ignored map bearing while the overlay honoured it, so
  // dots / lines drifted off the terrain whenever the map was rotated.
  const _pane = _readMagPaneMatrix();

  // #483: Leaflet can have multiple `.leaflet-tile-container` levels visible
  // during a zoom transition or past maxNativeZoom. Each level has its own
  // CSS transform. We must preserve this hierarchy in the loupe, otherwise
  // tiles from different levels drift apart.
  const tilePane = document.querySelector('.leaflet-tile-pane');
  if (!tilePane) return;
  const containers = Array.from(tilePane.querySelectorAll('.leaflet-tile-container'));

  let activeLayer = null;
  for (const key in layers) {
    if (map.hasLayer(layers[key])) { activeLayer = layers[key]; break; }
  }

  let refX = null, refY = null, refZ = null;
  let refLocalX = 0, refLocalY = 0;
  let refTileWrap = null;
  let refWrapM = null;

  const coordsBySrc = new Map();
  if (activeLayer) {
    const tileCache = activeLayer._tiles || {};
    for (const k in tileCache) {
      const t = tileCache[k];
      if (t && t.el && t.el.src && t.coords) coordsBySrc.set(t.el.src, t.coords);
    }
  }

  for (const container of containers) {
    const lc = getComputedStyle(container).transform;
    let _levelMatrix = new DOMMatrixReadOnly();
    if (lc && lc !== 'none') {
      try { _levelMatrix = new DOMMatrixReadOnly(lc); } catch (e) { /* identity */ }
    }
    const _wrapM = _pane.m.multiply(_levelMatrix);

    const tileWrap = document.createElement('div');
    tileWrap.style.cssText =
      'position:absolute;left:0;top:0;width:0;height:0;' +
      'transform-origin:0 0;transform:' + _wrapM.toString();
    content.appendChild(tileWrap);

    const imgs = Array.from(container.querySelectorAll('img'));
    for (const img of imgs) {
      const c = img.cloneNode(true);
      c.style.visibility = 'visible';
      tileWrap.appendChild(c);

      // Pick the reference tile for hi-res positioning from the most relevant
      // level (ideally the one matching the map's current zoom).
      if (activeLayer && img.src) {
        const coords = coordsBySrc.get(img.src);
        if (coords) {
          const trStr = img.style.transform;
          let mat;
          try { mat = new DOMMatrixReadOnly(trStr); } catch (e) { continue; }
          const isBetter = refZ === null ||
            Math.abs(coords.z - map.getZoom()) < Math.abs(refZ - map.getZoom());
          if (isBetter) {
            refZ = coords.z; refX = coords.x; refY = coords.y;
            refLocalX = mat.is2D ? mat.e : mat.m41;
            refLocalY = mat.is2D ? mat.f : mat.m42;
            refWrapM = _wrapM;
            refTileWrap = tileWrap;
          }
        }
      }
    }
  }

  // CSS scale = the slider value, always. (See _magScale comment for
  // rationale.) `sub` below is the orthogonal hi-res tile zoom step.
  _magScale = Math.max(1, magnifierZoom);

  if (activeLayer && refZ !== null && refTileWrap) {
    const _paneInv = refWrapM.inverse();
    const maxNZ = activeLayer.options.maxNativeZoom ||
                  activeLayer.options.maxZoom || 19;
    // Local alias for the slider value. Named `slider` to avoid shadowing
    // the global i18n `S` (which a sibling block in this same file used
    // to read for the loading-pill label).
    const slider = magnifierZoom;
    const sliderExp = Math.ceil(Math.log2(Math.max(1, slider)));
    const baselineExp = tune('magBaselineZoom') - refZ;
    const desiredExp = Math.max(sliderExp, baselineExp);
    const targetExp = Math.max(0,
      Math.min(tune('magMaxExp'), Math.min(maxNZ - refZ, desiredExp)));
    if (targetExp > 0) {
      const tileTarget = refZ + targetExp;
      const sub = Math.pow(2, targetExp);
      const sz = 256 / sub;
      // NOTE: `_magScale` is NOT bumped to `sub` here — the loupe's
      // visible magnification stays exactly at the slider value. Hi-res
      // tiles fetched below get downsampled to slider density on display.

      // Cursor in rotate-pane-LOCAL source pixels (same coord system as the
      // clones' transforms). The cursor is a CONTAINER point; invert the
      // rotate-pane matrix to get its local position so the fetch stays
      // centred under the cursor even when the map is rotated.
      const mapRect = map.getContainer().getBoundingClientRect();
      const _curLocal = _paneInv.transformPoint(
        new DOMPoint(_magX - mapRect.left, _magY - mapRect.top));
      const cursorX = _curLocal.x;
      const cursorY = _curLocal.y;

      // Loupe area + one loupe-radius margin so the cursor can drift a
      // little before `updateMagnifier` decides to schedule a refetch.
      // Sized using `_magScale` (= slider) so the fetched region matches
      // the visible source-pixel area: smaller slider → larger visible
      // source area → larger fetch span. Capped via `MAG_MAX_EXP` /
      // `maxNZ` above so the per-rebuild grid stays bounded.
      const loupeR = magnifierSize / 2 / _magScale;
      const radius = 2 * loupeR;
      const xMin = cursorX - radius, xMax = cursorX + radius;
      const yMin = cursorY - radius, yMax = cursorY + radius;

      // Map tile-pane-local pixels back to hi-res tile coords using the
      // reference clone we picked above.
      const refTxBase = refX * sub;
      const refTyBase = refY * sub;
      const txMin = Math.floor(refTxBase + (xMin - refLocalX) / sz);
      const txMax = Math.floor(refTxBase + (xMax - refLocalX) / sz);
      const tyMin = Math.floor(refTyBase + (yMin - refLocalY) / sz);
      const tyMax = Math.floor(refTyBase + (yMax - refLocalY) / sz);

      for (let ty = tyMin; ty <= tyMax; ty++) {
        if (ty < 0) continue;
        for (let tx = txMin; tx <= txMax; tx++) {
          if (tx < 0) continue;
          const localX = refLocalX + (tx - refTxBase) * sz;
          const localY = refLocalY + (ty - refTyBase) * sz;
          const tile = document.createElement('img');
          tile.style.cssText = 'position:absolute;left:' +
            localX + 'px;top:' + localY + 'px;' +
            'width:' + sz + 'px;height:' + sz + 'px';
          tile.dataset.batch = String(batch);
          _magPendingTiles++;
          // Settle handler shared by load + error. Stale-batch callbacks
          // (cursor moved fast → newer rebuild already ran) early-return
          // so they don't decrement the current batch's pending count.
          //
          // Idempotency: `tile.dataset.settled` guards against a
          // cached-image race where `tile.complete` is true synchronously
          // after `tile.src = …` (so we call `onSettle` manually below)
          // AND the still-pending async `load` event subsequently fires
          // anyway. Without this tag both calls would decrement
          // `_magPendingTiles`, masking the bug only because of the
          // `<= 0` clamp below. The clamp now never sees a true negative.
          const onSettle = (ev) => {
            const t = ev && ev.target ? ev.target : tile;
            if (t.dataset.settled === '1') return;
            t.dataset.settled = '1';
            if (t.dataset.batch !== String(_magBatch)) return;
            _magPendingTiles--;
            if (_magPendingTiles <= 0) hideMagLoading();
          };
          tile.addEventListener('load', onSettle, { once: true });
          tile.addEventListener('error', (ev) => {
            // Preserve the original cleanup behaviour for 404'd tiles.
            tile.remove();
            onSettle(ev);
          });
          tile.src = tileLayerUrl(activeLayer,
            { z: tileTarget, x: tx, y: ty });
          // Cached images can fire `load` before listeners are attached.
          // `complete` + `naturalWidth > 0` ⇒ already loaded; `complete`
          // alone (with `naturalWidth === 0`) ⇒ already errored. Settle
          // synchronously here so the counter doesn't get stuck; the
          // `dataset.settled` guard in `onSettle` makes the (still
          // pending) async load callback a no-op.
          if (tile.complete) {
            if (tile.naturalWidth === 0) tile.remove();
            onSettle({ target: tile });
          }
          refTileWrap.appendChild(tile);
        }
      }
    }
  }
  // Show the "Perfecting…" pill iff there are still in-flight hi-res
  // tiles after the loop ran. At max native zoom (no hi-res fetched,
  // sub=1, 0 tiles) the counter stays at 0 and the pill never appears,
  // which is what we want — no flicker on already-crisp views.
  if (_magPendingTiles > 0) showMagLoading();
  else hideMagLoading();

  // Capture the overlay canvas (waypoint dots, leg lines, notes).
  //
  // Force a fresh `draw()` BEFORE `toDataURL()` so the capture reflects
  // the CURRENT map state, not whatever the canvas held when the user
  // last released a drag. `scheduleDraw` (interact.js) already redraws
  // on Leaflet's `move` event via rAF, but its callback and our rebuild
  // callback are independent rAFs — and during a drag, the map pane's
  // CSS transform updates synchronously while the overlay's canvas
  // pixels only update on the next rAF. Without this synchronous draw
  // the loupe captured a stale overlay one frame behind the tiles, so
  // waypoint dots / leg lines appeared to "float" off the underlying
  // terrain as the user dragged. Cheap (canvas overlay redraw) and the
  // duplicated work (scheduleDraw rAF will run again later this frame)
  // is bounded by the loupe's own rAF coalescing.
  if (typeof draw === 'function') {
    try { draw(); } catch (e) { /* never abort the loupe rebuild on a draw error */ }
  }
  const overlay = document.getElementById('overlay');
  if (overlay) {
    // Copy the overlay pixels into a same-sized `<canvas>` via
    // `drawImage` (~1 ms at 1080p) instead of re-encoding the canvas to
    // a base64 PNG via `toDataURL()` (~10–20 ms at 1080p, 50–100 ms at
    // 4K). The rebuild runs on every coalesced rAF during a pan so the
    // per-frame budget matters; the visual result is identical because
    // the loupe just blits the captured pixels through its `scale()`
    // transform.
    const cap = document.createElement('canvas');
    cap.width = overlay.width;
    cap.height = overlay.height;
    try {
      const cctx = cap.getContext('2d');
      if (cctx) cctx.drawImage(overlay, 0, 0);
    } catch (e) { /* never abort the loupe rebuild on a draw error */ }
    // The overlay canvas is already in CONTAINER pixels (drawn via
    // `latLngToContainerPoint`, which bakes in bearing), so it sits at the
    // content origin with no pane offset. `content`'s own transform handles
    // cursor-centring + the `scale(_magScale)` magnification; the cloned
    // tiles get into the same container space via `tileWrap`'s matrix.
    cap.style.cssText = 'position:absolute;left:0;top:0;width:' +
      overlay.style.width + ';height:' + overlay.style.height;
    content.appendChild(cap);
  }
  _magDirty = false;
}

function applyMagnifierTransform() {
  const mag = document.getElementById('magnifier');
  const content = document.getElementById('mag-content');
  if (!mag || !content) return;
  if (_magDirty) rebuildMagnifier();
  const mapRect = map.getContainer().getBoundingClientRect();
  const cp = { x: _magX - mapRect.left, y: _magY - mapRect.top };
  // Loupe's visible CSS scale = the slider (`magnifierZoom`). Hi-res
  // tiles get downsampled to slider density for display; the adaptive
  // sub-tile fetch in `rebuildMagnifier` only governs WHICH tiles are
  // fetched, not how big they appear.
  const effS = _magScale;
  // `content` works in CONTAINER space: tiles are mapped there via
  // `tileWrap`'s matrix and the overlay is captured there directly. So the
  // loupe transform is just "centre the cursor's container point in the
  // loupe, then scale" — no pane offset, which also keeps it correct under
  // map rotation.
  content.style.transform =
    'translate(' + (magCenter() - cp.x * effS) + 'px,' +
                   (magCenter() - cp.y * effS) + 'px) scale(' + effS + ')';
}

// Shared rAF queue: coalesces every refresh trigger (cursor move, map
// pan, map zoom, layer change, slider tweak…) into a single per-frame
// `applyMagnifierTransform` call, which itself runs `rebuildMagnifier`
// iff `_magDirty`. Centralising the schedule is what lets `map.on('move')`
// keep the loupe in lock-step with the underlying pan without re-typing
// the same rAF dance in every caller.
function scheduleMagRebuild() {
  if (!magnifierOn) return;
  if (_magRAF) return;                     // already queued this frame
  _magRAF = requestAnimationFrame(() => {
    _magRAF = null;
    const mag = document.getElementById('magnifier');
    const content = document.getElementById('mag-content');
    if (!mag || !content) return;
    // Locked loupe (`_magFixed`) keeps its on-screen position; only the
    // CONTENT refreshes when the underlying map moves. Without this
    // guard a pan would yank the locked loupe back to the live cursor.
    if (!_magFixed) {
      mag.style.left = (_magX - magCenter()) + 'px';
      mag.style.top = (_magY - magCenter()) + 'px';
    }
    applyMagnifierTransform();
  });
}

function updateMagnifier(e) {
  if (!magnifierOn || _magFixed) return;
  _magX = e.clientX;
  _magY = e.clientY;
  // Refetch threshold tied to the actual prefetched margin. rebuildMagnifier
  // fetches a region of radius `magnifierSize/scale` source pixels around
  // the cursor; source≈client px in this coord system, so we refetch once
  // the cursor's drifted past HALF that margin — the loupe view never
  // wanders into un-fetched territory. Lower-bound at 8 px so we don't
  // thrash on every micro-jitter at high slider values.
  //
  // Pre-fix this used `magnifierSize/3` (≈ 133 px on a 400 px loupe) —
  // a 60 px cursor drift didn't refetch, so the user saw stale clones
  // until they swung the cursor far enough. That matched the reported
  // "have to zoom to refresh" symptom.
  const moveThreshold = Math.max(8, magnifierSize / 2 / _magScale);
  if (Math.abs(_magX - _magLastX) > moveThreshold ||
      Math.abs(_magY - _magLastY) > moveThreshold) {
    _magDirty = true;
  }
  scheduleMagRebuild();
}

function applyMagBorder() {
  const mag = document.getElementById('magnifier');
  if (!mag) return;
  mag.style.borderColor = _magFixed ? 'rgba(102,255,102,0.9)' : 'rgba(255,204,51,0.85)';
}

function toggleMagnifier() {
  magnifierOn = !magnifierOn;
  _magFixed = false;
  const mag = document.getElementById('magnifier');
  if (!mag) return;
  mag.style.display = magnifierOn ? 'block' : 'none';
  applyMagBorder();
  const magBtn = document.getElementById('tool-magnifier');
  magBtn.classList.toggle('active', magnifierOn);
  // Accessibility: expose toggle state to assistive tech (screen
  // readers announce "pressed" / "not pressed"). Same pattern applied
  // to every other toggle button in the toolbar (see ui.js setMode +
  // tool-reset-all-markers wiring).
  magBtn.setAttribute('aria-pressed', String(magnifierOn));
  const settings = document.getElementById('magnifier-settings');
  if (settings) settings.classList.toggle('hidden', !magnifierOn);
  if (magnifierOn) {
    // Always open at 1× — opening at a higher zoom left the loupe content
    // drifting from the cursor until the first move. Reset the slider + label
    // to match so the control reflects the actual zoom.
    window.magnifierZoom = 1;
    const zoomSlider = document.getElementById('mag-zoom');
    const zoomVal = document.getElementById('mag-zoom-val');
    if (zoomSlider) zoomSlider.value = '1';
    if (zoomVal) zoomVal.textContent = '1×';
    // Establish the cursor anchor BEFORE the first rebuild — the adaptive
    // hi-res fetch is centred on (_magX, _magY), so a stale 0/0 would put
    // every fetched sub-tile far off the loupe viewport on first open.
    _magX = _magX || window.innerWidth / 2;
    _magY = _magY || window.innerHeight / 2;
    _magLastX = -Infinity;       // force the next mousemove to refetch
    _magLastY = -Infinity;
    _magDirty = true;
    rebuildMagnifier();
    mag.style.left = (_magX - magCenter()) + 'px'; mag.style.top = (_magY - magCenter()) + 'px';
    applyMagnifierTransform();
    map.dragging.disable();
    document.addEventListener('mousemove', updateMagnifier);
    document.addEventListener('click', onMagClick, true);
  } else {
    map.dragging.enable();
    document.removeEventListener('mousemove', updateMagnifier);
    document.removeEventListener('click', onMagClick, true);
    if (_magRAF) { cancelAnimationFrame(_magRAF); _magRAF = null; }
    // Invalidate any in-flight hi-res callbacks and hide the indicator.
    // Bumping `_magBatch` is what guarantees onSettle handlers from the
    // closing batch early-return instead of poking a hidden indicator.
    _magBatch++;
    _magPendingTiles = 0;
    hideMagLoading();
  }
}

function onMagClick(e) {
  if (!magnifierOn) return;
  // Any click that lands inside a UI surface (toolbar, magnifier
  // settings panel, inspector, modal backdrop/box, or the search
  // overlay) must NOT toggle the loupe lock — those clicks are aimed
  // at the UI, not at the map underneath. `closest()` lets us match
  // either a singleton element (id) or a class shared by multiple
  // dynamically-created modals (.modal-back / .modal).
  if (e.target && typeof e.target.closest === 'function' &&
      e.target.closest(
        '#toolbar, #magnifier-settings, #inspector,' +
        ' .modal-back, .modal, #search-overlay'
      )) return;
  _magFixed = !_magFixed;
  applyMagBorder();
  // event passes through to map for selection
}

// Magnifier zoom: shared step for scroll wheel + +/− keys (interact.js).
function bumpMagnifierZoomKeyboard(step) {
  const zoomSlider = document.getElementById('mag-zoom');
  const zoomVal = document.getElementById('mag-zoom-val');
  if (!zoomSlider || !zoomVal) return;
  var v = parseFloat(zoomSlider.value) + step;
  v = Math.max(1, Math.min(5, Math.round(v * 4) / 4));
  if (v === parseFloat(zoomSlider.value)) return;
  zoomSlider.value = '' + v;
  window.magnifierZoom = v;
  zoomVal.textContent = v.toFixed(2).replace(/\.?0+$/, '') + '×';
  _magDirty = true;
  rebuildMagnifier();
  applyMagnifierTransform();
}

// Magnifier zoom slider + scroll-wheel control
(function () {
  const zoomSlider = document.getElementById('mag-zoom');
  const zoomVal = document.getElementById('mag-zoom-val');
  if (zoomSlider && zoomVal) {
    zoomSlider.addEventListener('input', function () {
      window.magnifierZoom = parseFloat(this.value);
      zoomVal.textContent = magnifierZoom.toFixed(2).replace(/\.?0+$/, '') + '×';
      _magDirty = true;
      if (magnifierOn) { rebuildMagnifier(); applyMagnifierTransform(); }
    });
  }
  // Scroll wheel changes magnifier zoom instead of map zoom.
  // Intercept on document during capture phase so we fire before Leaflet's
  // own wheel handler (which is attached to the map container in bubble phase).
  if (zoomSlider && zoomVal) {
    document.addEventListener('wheel', function (e) {
      if (!magnifierOn) return;
      if (!document.getElementById('map')?.contains(e.target)) return;
      e.stopPropagation();
      e.preventDefault();
      const step = e.deltaY > 0 ? -0.25 : 0.25;
      bumpMagnifierZoomKeyboard(step);
    }, { capture: true, passive: false });
  }
  // Settings close button
  const closeBtn = document.getElementById('mag-settings-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      if (magnifierOn) toggleMagnifier();
    });
  }
})();

// Keep the loupe in lock-step with the underlying map. `move` / `zoom`
// fire CONTINUOUSLY while a drag or zoom is in progress; `moveend` /
// `zoomend` fire on release. The previous `moveend zoomend rotate`
// wiring only dirtied the flag — it didn't schedule a rebuild — so
// during a drag the loupe showed stale clones until the user happened
// to wiggle the cursor far enough to clear the (also-too-large)
// mousemove threshold. That matched the reported "have to zoom to
// force a refresh" symptom. We now dirty AND schedule on every map
// motion, including in-progress events, so the hi-res tiles re-fetch
// as the user pans.
//
// `layeradd` covers base-layer switches (CVFR ↔ Satellite ↔ OSM …) —
// the active tile layer is what feeds rebuildMagnifier's hi-res URL.
map.on('move zoom moveend zoomend rotate layeradd', () => {
  if (!magnifierOn) return;
  _magDirty = true;
  scheduleMagRebuild();
});

// --- Simulator live aircraft (issue #691) ----------------------------
let _simInterval = null;
// Status element is set by ui.js via window._simStatusEl after DOM is ready.

function _simSetStatus(ok) {
  const el = window._simStatusEl || null;
  if (!el) return;
  el.textContent = ok ? (S.tbSimStatusOk || '✅ Connected')
                      : (S.tbSimStatusErr || '⚠ No data');
  el.style.color = ok ? tune('simStatusOkColor') : tune('simStatusErrColor');
}

async function _simFetch() {
  try {
    const url = (typeof simUrl === 'string' && simUrl.trim()) || 'http://localhost:2020';
    const res = await fetch(url, { signal: AbortSignal.timeout(900) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number') throw new Error('bad data');
    window.simAircraft = {
      lat: d.latitude,
      lng: d.longitude,
      alt: d.altitude || 0,
      hdg: d.heading || 0,
      ias: d.ias || 0,
    };
    _simSetStatus(true);
    if (simFollow) map.setView([window.simAircraft.lat, window.simAircraft.lng], map.getZoom());
    draw();
  } catch (e) {
    _simSetStatus(false);
  }
}

function simStart() {
  if (_simInterval) return;
  simOn = true;
  window.simAircraft = null;
  if (typeof resetHeadingPredictor === 'function') resetHeadingPredictor();
  try { localStorage.setItem('navaid.simOn', '1'); } catch (e) { /* */ }
  _simFetch();
  _simInterval = setInterval(_simFetch, 1000);
}

function simStop() {
  simOn = false;
  window.simAircraft = null;
  if (_simInterval) { clearInterval(_simInterval); _simInterval = null; }
  try { localStorage.setItem('navaid.simOn', '0'); } catch (e) { /* */ }
  const _el = window._simStatusEl;
  if (_el) _el.textContent = '';
  draw();
}
window.simStart = simStart;
window.simStop  = simStop;

// --- Toolbar button handler — copy share URL to clipboard. ------------
function shareRoute() {
  const r = buildShareUrl();
  if (r.err) { alert(S[r.err]); return; }
  // Clipboard API requires a secure context + user gesture; the button
  // click satisfies the gesture, but http://localhost might fall back.
  const writePromise = (navigator.clipboard && navigator.clipboard.writeText)
    ? navigator.clipboard.writeText(r.url)
    : Promise.reject(new Error('no clipboard API'));
  writePromise
    .then(() => showToast(S.shareCopied))
    .catch(() => {
      // Fallback: show the URL in a prompt so the user can copy manually.
      window.prompt(S.shareCopied, r.url);
    });
}
