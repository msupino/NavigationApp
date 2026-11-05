// Live ATC radio: Herzliya and Haifa, and Pluto West
//
// Each channel plays through NavAid's relay (atcRadioBase + id, by default the relay/atc Worker),
// one channel at a time.
(function () {
  'use strict';
  const CHANNELS = [
    // No frequencies here: the airfield window shows each field's own, from its data, and a copy
    // here would go stale when one changes -- the provider updates the channel (asked).
    // callSign: the station's id in the frequency catalog (comm-change), so a waypoint's call-sign
    // list can offer its live channel too -- the tower for an airfield's call sign.
    { id: 'herzliya-twr', icao: 'LLHZ', type: 'atcTower', callSign: 'HERZLIYA' },
    { id: 'herzliya-clr', icao: 'LLHZ', type: 'atcClearance' },
    { id: 'haifa-twr', icao: 'LLHA', type: 'atcTower', callSign: 'HAIFA' },
    { id: 'haifa-atis', icao: 'LLHA', type: 'atis' },
    // Pluto is the country-wide control, not an airfield's: in the list only, never in an
    // airfield's window.
    { id: 'pluto-west', icao: null, type: 'atcPluto', callSign: 'PLUTO_WEST' },
  ];
  const str = (k, fb) => (typeof S !== 'undefined' && S[k]) || fb;
  const offered = () => typeof tune !== 'function' || tune('featureAtcRadio') !== false;
  const modal = document.getElementById('atc-modal');
  const list = document.getElementById('atc-list');
  // The on-map launcher button is built at boot (ui.js, with the other map controls) so its
  // slot is reserved before first paint; here we find it by id and wire its behaviour.
  const opener = document.getElementById('tool-atc-radio');
  if (!modal || !list || !opener) return;

  const audio = new Audio();
  audio.preload = 'none';
  let current = null;                 // the channel id playing (or connecting)

  function streamUrl(id) {
    const base = (typeof tune === 'function' && tune('atcRadioBase')) || 'https://navaid-atc.marco-956.workers.dev/';
    return base + encodeURIComponent(id) + '?ts=' + Date.now();
  }

  // A channel can be on screen twice -- in its airfield's window and in the ATC radio list --
  // so every copy of its row is painted together.
  const stateOf = {};                   // id -> the last state key shown
  function paint(id, on, stateKey) {
    stateOf[id] = stateKey || null;
    for (const row of document.querySelectorAll('[data-atc="' + id + '"]')) paintRow(row, on, stateKey);
  }
  // The airfield window's copy is a small round button beside the frequency: a play/stop icon,
  // its state in the colour, the tooltip and a hidden live region, instead of a labelled button.
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg>';
  function paintRow(row, on, stateKey) {
    const btn = row.querySelector('button');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const st = row.querySelector('.atc-state');
    st.textContent = stateKey ? str(stateKey, '') : '';
    row.classList.toggle('is-live', !!on && stateKey === 'atcLive');
    if (row.classList.contains('atc-inline')) {
      btn.innerHTML = on ? ICON_STOP : ICON_PLAY;      // fixed markup, no data in it
      const verb = on ? str('atcStop', 'Stop') : str('atcPlay', 'Listen');
      btn.setAttribute('aria-label', verb + ' ' + row.dataset.label);
      btn.title = verb + (stateKey ? ' · ' + str(stateKey, '') : '');
      row.classList.toggle('is-connecting', !!on && (stateKey === 'atcConnecting' || stateKey === 'atcBuffering'));
      row.classList.toggle('is-offline', !on && stateKey === 'atcOffline');
    } else {
      btn.textContent = on ? str('atcStop', 'Stop') : str('atcPlay', 'Listen');
    }
  }

  function stop() {
    const was = current;
    current = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (was) paint(was, false);
    refreshOpener();
  }

  function play(id) {
    if (current === id) { stop(); return; }
    stop();
    current = id;
    paint(id, true, 'atcConnecting');
    audio.src = streamUrl(id);
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { if (current === id) { current = null; paint(id, false, 'atcOffline'); refreshOpener(); } });
    }
    refreshOpener();
  }

  audio.addEventListener('playing', () => { if (current) paint(current, true, 'atcLive'); });
  audio.addEventListener('waiting', () => { if (current) paint(current, true, 'atcBuffering'); });
  audio.addEventListener('error', () => {
    if (!current || !audio.getAttribute('src')) return;
    const id = current;
    current = null;
    paint(id, false, 'atcOffline');
    refreshOpener();
  });

  function makeRow(c, withField) {
      const row = document.createElement('div');
      row.className = 'atc-row';
      row.dataset.atc = c.id;
      const name = document.createElement('div');
      name.className = 'atc-name';
      name.textContent = withField && c.icao ? c.icao + ' · ' + str(c.type, c.type) : str(c.type, c.type);
      const st = document.createElement('div');
      st.className = 'atc-state';
      st.setAttribute('role', 'status');
      st.setAttribute('aria-live', 'polite');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atc-play';
      btn.setAttribute('aria-label', (c.icao ? c.icao + ' ' : '') + str(c.type, c.type));
      btn.addEventListener('click', () => play(c.id));
      row.append(name, st, btn);
      const on = current === c.id;
      paintRow(row, on, on ? stateOf[c.id] : (stateOf[c.id] === 'atcOffline' ? 'atcOffline' : null));
      return row;
  }
  function build() {
    list.textContent = '';
    for (const c of CHANNELS) list.appendChild(makeRow(c, true));
  }
  function makeInline(c) {
    const wrap = document.createElement('span');
    wrap.className = 'atc-inline';
    wrap.dataset.atc = c.id;
    wrap.dataset.label = (c.icao ? c.icao + ' ' : '') + str(c.type, c.type);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atc-play';
    btn.addEventListener('click', () => play(c.id));
    const st = document.createElement('span');
    st.className = 'atc-state sr-only';
    st.setAttribute('role', 'status');
    st.setAttribute('aria-live', 'polite');
    wrap.append(btn, st);
    const on = current === c.id;
    paintRow(wrap, on, on ? stateOf[c.id] : (stateOf[c.id] === 'atcOffline' ? 'atcOffline' : null));
    return wrap;
  }
  // The airfield's own window (interact.js, its Communication frame): each channel on the air
  // from that field gets a small play button in its own frequency row -- Tower in the primary
  // row, Clearance and ATIS in theirs. A channel whose row the field does not print gets a row
  // of its own. Nothing for a field without a channel.
  const ROW_FOR = { atcTower: '.primary-row', atcClearance: '.clearance-row', atis: '.atis-row' };
  function airfieldAttach(icao, sec) {
    if (!offered() || !icao || !sec) return 0;
    const mine = CHANNELS.filter(c => c.icao === String(icao).toUpperCase());
    for (const c of mine) {
      let row = sec.querySelector(ROW_FOR[c.type] || ':not(*)');
      if (!row) {
        row = document.createElement('div');
        row.className = 'row atc-own-row';
        const l = document.createElement('label');
        l.textContent = str(c.type, c.type);
        const v = document.createElement('span');
        v.className = 'val';
        v.dir = 'ltr';
        row.append(l, v);
        const phone = sec.querySelector('.airfield-phone-row');
        sec.insertBefore(row, phone || null);
      }
      // Between the label and the frequency in either language. The value box reads left to
      // right, so the button goes after the frequency in Hebrew (label on the right), before it
      // in English (label on the left).
      const host = row.querySelector('.val') || row;
      const btn = makeInline(c);
      if (document.documentElement.dir === 'rtl') host.appendChild(btn);
      else { btn.classList.add('atc-inline-lead'); host.insertBefore(btn, host.firstChild); }
    }
    // The frequency inputs stay in one column: rows without a button keep its space.
    sec.classList.toggle('has-atc', mine.length > 0);
    return mine.length;
  }

  // The opener stays lit while a channel plays, like the other switches: closing the window
  // does not stop the audio, and the lit button says where to stop it.
  // While a channel plays the button stops it (ui.js), and says so: "Stop <channel>".
  function refreshOpener() {
    opener.setAttribute('aria-pressed', current ? 'true' : 'false');
    opener.classList.toggle('active', !!current);
    const c = current && CHANNELS.find(ch => ch.id === current);
    const label = c
      ? str('atcStop', 'Stop') + ' ' + (c.icao ? c.icao + ' ' : '') + str(c.type, c.type)
      : str('atcRadioTitle', 'ATC radio');
    opener.title = label;
    opener.setAttribute('aria-label', label);
    // The channel's name beside the green button, so the map says what is playing (asked).
    const now = opener.parentNode && opener.parentNode.querySelector('.atc-fab-now');
    if (now) {
      now.textContent = c ? (c.icao ? c.icao + ' \u00b7 ' : '') + str(c.type, c.type) : '';
      now.hidden = !c;
    }
  }

  function open() { build(); modal.classList.remove('hidden'); const b = list.querySelector('button'); if (b) b.focus(); }
  function close() { modal.classList.add('hidden'); opener.focus(); }

  // The opener's click is wired where it's built (ui.js) -- it calls window.atcRadio.open().
  document.getElementById('atc-modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) { e.preventDefault(); close(); }
  });

  // The gist withdraws it: hide the button, but leave the wrapper in place -- its slot stays
  // reserved (CSS min-size), so turning it on or off never shifts the control column.
  function refreshAtcRadioFeature() {
    const on = offered();
    opener.hidden = !on;
    if (!on) { stop(); modal.classList.add('hidden'); }
  }

  window.refreshAtcRadioFeature = refreshAtcRadioFeature;
  // A waypoint's call-sign list (interact.js, the frequency change point): the live channel of a
  // listed station, as the same small button -- Pluto West, Haifa, Herzliya. Null for any other.
  function callSignButton(id) {
    if (!offered() || !id) return null;
    const c = CHANNELS.find(ch => ch.callSign === String(id).toUpperCase());
    return c ? makeInline(c) : null;
  }
  function callSignAttach(item) {
    if (!item || item.querySelector('[data-atc]')) return false;
    const slot = item.querySelector('.commchange-option-play');
    const btn = callSignButton(item.dataset.callSign);
    if (!slot || !btn) return false;
    slot.appendChild(btn);
    item.classList.add('has-atc');
    return true;
  }

  window.atcRadio = { channels: CHANNELS, airfieldAttach, callSignAttach, play, stop, open, close, streamUrl, get current() { return current; } };
  refreshOpener();
  refreshAtcRadioFeature();
  // An airfield window opened before this module loaded (phase 2) gets its buttons now.
  for (const sec of document.querySelectorAll('.comm-section[data-icao]')) {
    if (!sec.querySelector('[data-atc]')) airfieldAttach(sec.dataset.icao, sec);
  }
  // ...and so does a waypoint's call-sign list.
  for (const item of document.querySelectorAll('.commchange-option[data-call-sign]')) callSignAttach(item);
})();
