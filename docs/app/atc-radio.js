// Live ATC radio: Herzliya and Haifa, and Pluto West
//
// Each channel plays through NavAid's relay (atcRadioBase + id, by default the relay/atc Worker),
// one channel at a time.
(function () {
  'use strict';
  const CHANNELS = [
    { id: 'herzliya-twr', icao: 'LLHZ', type: 'atcTower', freq: '125.60' },
    { id: 'herzliya-clr', icao: 'LLHZ', type: 'atcClearance', freq: '118.55' },
    { id: 'haifa-twr', icao: 'LLHA', type: 'atcTower', freq: '133.00' },
    { id: 'haifa-atis', icao: 'LLHA', type: 'atis', freq: '135.40' },
    // Pluto is the country-wide control, not an airfield's: in the list only, never in an
    // airfield's window.
    { id: 'pluto-west', icao: null, type: 'atcPluto', freq: '118.40' },
  ];
  const str = (k, fb) => (typeof S !== 'undefined' && S[k]) || fb;
  const offered = () => typeof tune !== 'function' || tune('featureAtcRadio') !== false;
  const modal = document.getElementById('atc-modal');
  const list = document.getElementById('atc-list');
  // The on-map launcher button is built at boot (ui.js, with the other map controls) so its
  // slot is reserved before first paint; here we find it by id and wire its behaviour.
  const opener = document.getElementById('tool-atc-radio');
  if (!modal || !list || !opener) return;
  const fabWrap = opener.closest('.atc-fab-control') || opener;   // hide the control, not just the button

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
      const freq = document.createElement('div');
      freq.className = 'atc-freq';
      freq.dir = 'ltr';
      freq.textContent = c.freq;
      const st = document.createElement('div');
      st.className = 'atc-state';
      st.setAttribute('role', 'status');
      st.setAttribute('aria-live', 'polite');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atc-play';
      btn.setAttribute('aria-label', (c.icao ? c.icao + ' ' : '') + str(c.type, c.type) + ' ' + c.freq);
      btn.addEventListener('click', () => play(c.id));
      row.append(name, freq, st, btn);
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
    wrap.dataset.label = c.icao + ' ' + str(c.type, c.type) + ' ' + c.freq;
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
        v.textContent = c.freq + ' ';
        row.append(l, v);
        const phone = sec.querySelector('.airfield-phone-row');
        sec.insertBefore(row, phone || null);
      }
      (row.querySelector('.val') || row).appendChild(makeInline(c));
    }
    // The frequency inputs stay in one column: rows without a button keep its space.
    sec.classList.toggle('has-atc', mine.length > 0);
    return mine.length;
  }

  // The opener stays lit while a channel plays, like the other switches: closing the window
  // does not stop the audio, and the lit button says where to stop it.
  function refreshOpener() {
    opener.setAttribute('aria-pressed', current ? 'true' : 'false');
    opener.classList.toggle('active', !!current);
  }

  function open() { build(); modal.classList.remove('hidden'); const b = list.querySelector('button'); if (b) b.focus(); }
  function close() { modal.classList.add('hidden'); opener.focus(); }

  // The opener's click is wired where it's built (ui.js) -- it calls window.atcRadio.open().
  document.getElementById('atc-modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) { e.preventDefault(); close(); }
  });

  // Only the gist removes the control; withdrawn, the audio stops with it. Hide the Leaflet
  // wrapper, not just the button, so no empty control slot is left on the map.
  function refreshAtcRadioFeature() {
    const on = offered();
    fabWrap.hidden = !on;
    opener.hidden = !on;            // the button too, so its own hidden reflects the feature
    if (!on) { stop(); modal.classList.add('hidden'); }
  }

  window.refreshAtcRadioFeature = refreshAtcRadioFeature;
  window.atcRadio = { channels: CHANNELS, airfieldAttach, play, stop, open, close, streamUrl, get current() { return current; } };
  refreshOpener();
  refreshAtcRadioFeature();
  // An airfield window opened before this module loaded (phase 2) gets its buttons now.
  for (const sec of document.querySelectorAll('.comm-section[data-icao]')) {
    if (!sec.querySelector('[data-atc]')) airfieldAttach(sec.dataset.icao, sec);
  }
})();
