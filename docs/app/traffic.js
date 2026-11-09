// Live traffic on the moving map, while a fix is driving it.
//
// The community ADS-B feeds send no CORS headers, so a browser cannot call them at all --
// verified, not assumed: fetch fails outright. NavAid is a static site with nothing of its
// own to proxy through, so it asks one endpoint that CAN call them (dump1090web's
// /api/traffic on the homelab: local receiver first, community feed for what the aerial
// cannot see, cached so a hundred clients cost one upstream call).
//
// Everything here is off unless the app is following a real position. Traffic on a planning
// map is decoration; traffic while you are flying is the point, and it is also the only time
// the battery cost is worth paying.
(function () {
  'use strict';

  const LAYER_KEY = 'navaid.showTraffic';
  let group = null;
  let followedHex = '';
  let timer = 0;
  let inFlight = false;
  let fails = 0;               // consecutive failed polls; one blip is not an outage
  let lastOkAt = 0;            // when the feed last answered (ms)
  let stalePolled = false;     // the feed's aircraft are drawn faded: their positions are old
  let lostSaid = false;        // the 'lost' message was given for this outage
  const tuneSec = (k, d) => ((typeof tune === 'function' && tune(k)) || d) * 1000;
  // Bumped whenever the layer is torn down. A request already on the wire when the pilot
  // switches traffic off -- or when the fix stops -- would otherwise arrive afterwards and
  // draw its aeroplanes onto a map that is meant to be clear of them.
  let generation = 0;
  window.trafficLastError = null;
  window.trafficAircraft = [];          // what the inspector and the hit test read

  // Where to ask about. A real fix if there is one -- that is the traffic that matters --
  // and otherwise the middle of whatever the pilot is looking at. Traffic is worth seeing
  // while planning too: which airways are busy over the field you are routing through is a
  // question you ask at the desk, not only in the air.
  const centre = () => {
    const c = (typeof gpsLastFix === 'function' && gpsLastFix()) || null;
    if (c && Number.isFinite(c.lat)) return { lat: c.lat, lng: c.lng };
    const m = map.getCenter();
    return { lat: m.lat, lng: m.lng };
  };
  // The ADS-B aggregators serve data to anyone and CORS headers to nobody, so a browser
  // cannot read them directly -- verified against adsb.lol, adsb.fi, airplanes.live, adsb.one,
  // ADS-B Exchange and OpenSky, and against the public CORS proxies, which either time out or
  // rate-limit long before an 8-second poll. The apps are not browsers: Capacitor's native HTTP
  // makes the request in native code (Java on Android, Swift on iOS), where the same-origin rule
  // does not apply. A browser goes through NavAid's own relay instead (relay/traffic, a Cloudflare
  // Worker that adds the CORS header), named by the gist's `trafficWebApiUrl`; without it the
  // switch is dimmed in a browser, saying why.
  const nativeHttp = () => {
    const C = typeof window !== 'undefined' && window.Capacitor;
    return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()
      && C.Plugins && C.Plugins.CapacitorHttp) || null;
  };
  // Two different questions, deliberately kept apart. The gist decides whether the feature
  // EXISTS -- that is the only thing that removes the switch. The platform decides whether
  // it can WORK: in a browser the switch is still there, dimmed, saying why. A control that
  // vanishes between the phone and the desktop makes the pilot wonder what else moved.
  const offered = () => typeof tune !== 'function' || tune('featureLiveTraffic') === true;
  const webUrl = () => (typeof tune === 'function' && tune('trafficWebApiUrl')) || '';
  const usable = () => !!nativeHttp() || !!webUrl();
  window.trafficUsable = usable;
  window.trafficOffered = offered;
  const on = () => {
    if (!offered() || !usable()) return false;
    let stored = null;
    try { stored = localStorage.getItem(LAYER_KEY); } catch (e) { /* storage unavailable */ }
    if (stored === '0') return false;
    if (stored === '1') return true;
    return typeof tune === 'function' ? tune('defaultShowTraffic') !== false : true;
  };
  window.trafficEnabled = on;
  // Follow is a temporary target choice made in the selected aircraft's inspector. Keep it
  // separate from navaid.gpsFollow, which is the pilot's saved own-aircraft preference.
  window.trafficFollowTarget = () => followedHex;
  // Where a followed aircraft goes: the middle of the map you can SEE, not of the whole map. On a
  // phone the inspector is a bottom sheet over the lower half -- and Stop following lives in it --
  // so centring on the whole map parked the aircraft under the panel that follows it (reported).
  // Worked in container pixels, so a rotated map (leaflet-rotate) needs no special case: the view
  // only translates, and the target moves to the centre of what is left uncovered.
  function visibleCentreFor(lat, lon) {
    const ll = L.latLng(lat, lon);
    const box = map.getContainer().getBoundingClientRect();
    let top = box.top, bottom = box.bottom, left = box.left, right = box.right;
    const shown = (el) => {
      if (!el || el.hidden || el.classList.contains('hidden')) return null;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const strip = shown(document.getElementById('deck-strip'));
    if (strip) top = Math.max(top, strip.bottom);
    const bar = shown(document.getElementById('deck-bar'));
    if (bar) bottom = Math.min(bottom, bar.top);
    const insp = shown(document.getElementById('inspector'));
    if (insp) {
      // Across most of the map it is a sheet (above or below); narrower, it is a side panel.
      if (insp.width >= (right - left) * 0.6) {
        if (insp.top > (top + bottom) / 2) bottom = Math.min(bottom, insp.top);
        else top = Math.max(top, insp.bottom);
      } else if (insp.left > (left + right) / 2) right = Math.min(right, insp.left);
      else left = Math.max(left, insp.right);
    }
    // Too little left to aim at: the plain centre.
    if (bottom - top < 80 || right - left < 80) return ll;
    const cx = box.width / 2, cy = box.height / 2;
    const vx = (left + right) / 2 - box.left, vy = (top + bottom) / 2 - box.top;
    const at = map.latLngToContainerPoint(ll);
    return map.containerPointToLatLng(L.point(at.x + cx - vx, at.y + cy - vy));
  }

  window.trafficToggleFollow = function (hex) {
    const key = String(hex || '');
    if (!key || followedHex === key) {
      followedHex = '';
      return false;
    }
    const target = (window.trafficAircraft || []).find(a => a && a.hex === key);
    if (!target) return false;
    followedHex = key;
    // This button is an explicit request to jump to the target, even if a recent hand pan
    // temporarily suspended the normal fix-driven following.
    if (typeof _gpsUserMovedAt === 'number') _gpsUserMovedAt = 0;
    map.setView(visibleCentreFor(target.lat, target.lon), map.getZoom());
    return true;
  };
  window.trafficClearFollow = function (hex) {
    if (!hex || followedHex === String(hex)) followedHex = '';
  };

  // The feeds put the position in the path (adsb.lol: /v2/lat/32.05/lon/34.92/dist/40), so
  // the tunable is a template. A URL with no placeholders keeps the old query-string form,
  // which is what a proxy of one's own would most likely want.
  function endpoint(lat, lng) {
    // The apps ask the feed itself; a browser asks the relay, which answers in the feed's form.
    const base = nativeHttp() ? ((typeof tune === 'function' && tune('trafficApiUrl')) || '') : webUrl();
    if (!base) return '';
    const nm = Math.round((typeof tune === 'function' ? tune('trafficRadiusNm') : 40) || 40);
    if (base.indexOf('{lat}') >= 0) {
      return base.replace('{lat}', lat.toFixed(4)).replace('{lon}', lng.toFixed(4))
                 .replace('{dist}', String(nm));
    }
    const sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + 'lat=' + lat.toFixed(4) + '&lon=' + lng.toFixed(4) + '&dist=' + nm;
  }

  // One aeroplane, from whichever spelling the feed uses. adsb.lol and its cousins say
  // `ac`, alt_baro (which reads "ground" for one on the runway) and `t` for the type;
  // a proxy of one's own would more likely say `aircraft`, `alt` and `type`.
  // adsb.lol's `type` is where the report came FROM (adsb_icao, mlat, tisb_...), not the aircraft:
  // the inspector showed "Type adsb_icao". The aircraft is `t`; `type` counts only when it is not
  // one of those source tags (a proxy of one's own may well put the aircraft there).
  const SOURCE_TAG = /^(adsb|adsr|tisb|mlat|mode_?s|adsc|uat|other|unknown)/i;
  // The emitter category says what the aircraft is: A7 is a rotorcraft. Feeds send it as "A7";
  // a GDL90 receiver as a number (gdl90.js), mapped to the same letters here.
  function emitterCategory(v) {
    if (typeof v === 'string' && /^[A-D][0-7]$/i.test(v.trim())) return v.trim().toUpperCase();
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v >= 1 && v <= 7) return 'A' + v;
      if (v >= 9 && v <= 15) return 'B' + (v - 8);
      if (v >= 17 && v <= 21) return 'C' + (v - 16);
    }
    return '';
  }
  // Helicopters by type code, for the reports that carry a type but no category (ICAO Doc 8643
  // designators of the rotorcraft seen in Israel's airspace and the common civil ones).
  const HELI_TYPES = new Set(['R22', 'R44', 'R66', 'AS50', 'AS55', 'AS65', 'AS32', 'AS3B', 'EC20', 'EC25',
    'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'H125', 'H130', 'H135', 'H145', 'H155', 'H160', 'H175',
    'B06', 'B06T', 'B407', 'B412', 'B427', 'B429', 'B430', 'B47G', 'B505', 'A109', 'A119', 'A139',
    'A149', 'A169', 'A189', 'S76', 'S92', 'S61', 'S64', 'H60', 'H64', 'H47', 'UH1', 'UH1Y', 'MI8',
    'MI17', 'K226', 'BK17', 'B105', 'EH10', 'NH90', 'H500', 'MD52', 'MD60', 'G2CA', 'CABR']);
  function rotorcraft(a) {
    // The category as either spelling: a receiver's targets reach the map without normalize().
    return emitterCategory(a.category) === 'A7' || HELI_TYPES.has(String(a.type || '').toUpperCase());
  }
  window.trafficIsRotorcraft = rotorcraft;
  // On the ground: reported so, or an aeroplane taxiing (slow and low). Never a helicopter by
  // speed -- a slow, low helicopter is very likely flying.
  function onGround(a) {
    if (a.ground === true) return true;
    if (rotorcraft(a)) return false;
    const kt = (typeof tune === 'function') ? tune('trafficGroundKt') : 40;
    const ft = (typeof tune === 'function') ? tune('trafficGroundBelowFt') : 1000;
    return Number.isFinite(a.gs) && a.gs < kt && (!Number.isFinite(a.alt) || a.alt < ft);
  }
  window.trafficOnGround = onGround;
  function normalize(a) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const alt = num(a.alt) !== null ? a.alt
      : num(a.alt_baro) !== null ? a.alt_baro : num(a.alt_geom);
    return {
      hex: String(a.hex || a.icao || '').trim(),
      flight: String(a.flight || a.callsign || '').trim(),
      lat: num(a.lat), lon: num(a.lon !== undefined ? a.lon : a.lng),
      alt: num(alt), gs: num(a.gs !== undefined ? a.gs : a.speed),
      track: num(a.track !== undefined ? a.track : a.heading),
      type: String(a.t || (SOURCE_TAG.test(String(a.type || '')) ? '' : a.type) || '').trim(),
      category: emitterCategory(a.category),
      // adsb.lol says alt_baro "ground" for one on the surface; a proxy may say ground: true.
      ground: a.alt_baro === 'ground' || a.ground === true,
      squawk: String(a.squawk || '').trim(),
    };
  }

  // GET through the native bridge. Capacitor hands back a parsed body for JSON responses
  // and a string otherwise, so both have to be accepted. A browser fetches the relay.
  // Every request has a deadline: one in flight at a time, so a request that hung held every later
  // refresh off until the browser gave up -- minutes with no retry. Timed out, it fails like any
  // other, and the next refresh asks again.
  async function getJson(url) {
    const ms = tuneSec('trafficTimeoutSec', 10);
    let timer = 0;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
    const http = nativeHttp();
    try {
      if (!http) {
        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        const req = fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ac ? ac.signal : undefined })
          .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
        try { return await Promise.race([req, deadline]); }
        catch (e) { if (ac) ac.abort(); throw e; }
      }
      const req = http.request({ url, method: 'GET', headers: { Accept: 'application/json' },
        connectTimeout: ms, readTimeout: ms })
        .then((r) => {
          if (!r || r.status < 200 || r.status >= 300) throw new Error('HTTP ' + (r && r.status));
          return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        });
      return await Promise.race([req, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  // The arrow points where the aircraft is going, and carries what a pilot reads first: who
  // it is and how high. Altitude in hundreds of feet, shown as a flight level (FL).
  // A top-down aeroplane, the way every traffic display draws one: nose along the track, so
  // the shape alone says which way it is going before the label is read. Drawn as a path
  // rather than a glyph -- a font character (the old arrow) is whatever the device decides
  // it is, and colour, size and the white outline that keeps it legible over a chart all
  // have to be ours.
  const PLANE = 'M12 1.6 13.35 6.4 13.35 9.6 22.4 14.9 22.4 17 13.35 14.3 13.35 19.4'
              + ' 16.1 21.3 16.1 22.6 12 21.4 7.9 22.6 7.9 21.3 10.65 19.4 10.65 14.3'
              + ' 1.6 17 1.6 14.9 10.65 9.6 10.65 6.4Z';
  // A helicopter, top down the same way (asked: "it shows planes only, even if it is a heli"):
  // the two main-rotor blades crossed over the cabin, the tail boom aft and the tail rotor across
  // its end -- so the nose is still the end without the tail, and the track still reads.
  const HELI = 'M3.33 3.67 19.33 19.67 20.67 18.33 4.67 2.33Z'
             + 'M20.67 3.67 4.67 19.67 3.33 18.33 19.33 2.33Z'
             + 'M12 6.2C14.1 6.2 15.4 8.4 15.4 11 15.4 13.6 14.1 15.8 12 15.8 9.9 15.8 8.6 13.6 8.6 11 8.6 8.4 9.9 6.2 12 6.2Z'
             + 'M11.2 15.4H12.8V21.6H11.2Z'
             + 'M9.2 20.8H14.8V22.6H9.2Z';

  function icon(a) {
    const trk = Number.isFinite(a.track) ? a.track : 0;
    const fl = Number.isFinite(a.alt) ? Math.round(a.alt / 100) : null;
    const label = [a.flight || a.hex || '', fl === null ? '' : 'FL' + String(fl).padStart(3, '0')]
      .filter(Boolean).join(' ');
    const ground = onGround(a);
    const full = Math.round((typeof tune === 'function' && tune('trafficIconPx')) || 22);
    const px = ground ? Math.round(full * ((typeof tune === 'function' && tune('trafficGroundScale')) || 0.7)) : full;
    const heli = rotorcraft(a);
    const svg = '<svg class="traffic-plane' + (heli ? ' traffic-heli' : '') + '" viewBox="0 0 24 24" width="' + px + '" height="' + px
      + '" aria-hidden="true"><path d="' + (heli ? HELI : PLANE) + '"/></svg>';
    return L.divIcon({
      // On the ground: smaller, faded, and no label (tap still opens the inspector).
      className: 'traffic-mark' + (ground ? ' traffic-ground' : ''),
      iconSize: [px + 38, px + 4],
      iconAnchor: [Math.round(px / 2), Math.round(px / 2)],
      html: '<span class="traffic-arrow" style="transform:rotate(' + trk + 'deg)">' + svg + '</span>'
          // On the ground: the callsign only (an altitude means nothing there), shown from airport
          // zoom in (map class traffic-ground-unlabelled, set on zoom) and decluttered like the rest.
          + '<span class="traffic-label">' + escapeXml(ground ? (a.flight || a.hex || '') : label) + '</span>',
    });
  }

  function draw(list) {
    if (!group) group = L.layerGroup();
    group.clearLayers();
    const fromFeed = new Set(polled);
    for (const a of list) {
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
      const ic = icon(a);
      // The feed's aircraft fade while the feed is silent; a receiver's own (external) are live.
      if (stalePolled && fromFeed.has(a)) ic.options.className += ' traffic-stale';
      const m = L.marker([a.lat, a.lon], { icon: ic, keyboard: false, pane: 'markerPane',
                                           title: a.flight || a.hex || '' });
      m._traffic = a;
      m.on('click', (e) => {
        // The map's own click handler clears the selection, and it runs after this one --
        // so without stopping here, tapping an aircraft selected it and immediately let go.
        // Guarded: a Leaflet event fired by hand carries no originalEvent, and handing that
        // to DomEvent throws before the selection is ever made.
        const dom = e && e.originalEvent;
        if (dom && L.DomEvent) L.DomEvent.stopPropagation(dom);
        if (followedHex && followedHex !== a.hex) followedHex = '';
        state.selected = { type: 'traffic', hex: a.hex };
        if (typeof showInspector === 'function') showInspector();
        declutterSoon();     // the selected one's label comes first now
      });
      m.addTo(group);
    }
    if (!map.hasLayer(group)) group.addTo(map);
    declutterSoon();
  }

  // Labels that would print over one another: the first keeps its label, the others show the
  // aircraft alone (a tap still names it). The followed and the selected aircraft go first. Zoomed
  // out over a busy airfield the labels had overprinted into nothing readable (reported).
  function declutterLabels() {
    if (!group) return;
    const sel = state && state.selected && state.selected.type === 'traffic' ? state.selected.hex : '';
    const zoomLabels = (typeof tune === 'function') ? tune('trafficGroundLabelZoom') : 13;
    map.getContainer().classList.toggle('traffic-ground-unlabelled', map.getZoom() < zoomLabels);
    const marks = [];
    group.eachLayer((m) => {
      const el = m.getElement && m.getElement();
      const lab = el && el.querySelector('.traffic-label');
      if (lab) marks.push({ a: m._traffic || {}, lab });
    });
    const rank = (x) => (x.a.hex && x.a.hex === followedHex ? 0 : x.a.hex && x.a.hex === sel ? 1 : 2);
    marks.sort((p, q) => rank(p) - rank(q));
    const kept = [];
    for (const x of marks) {
      x.lab.classList.remove('traffic-label-hidden');
      const r = x.lab.getBoundingClientRect();
      if (!r.width) continue;               // a ground label zoomed out: not drawn, takes no room
      const hit = kept.some(k => r.left < k.right && k.left < r.right && r.top < k.bottom && k.top < r.bottom);
      if (hit) x.lab.classList.add('traffic-label-hidden'); else kept.push(r);
    }
  }
  let declutterQueued = false;
  function declutterSoon() {
    if (declutterQueued) return;
    declutterQueued = true;
    requestAnimationFrame(() => { declutterQueued = false; declutterLabels(); });
  }
  window.trafficDeclutter = declutterLabels;
  map.on('zoomend', declutterSoon);

  // An inspector open on an aircraft nobody is receiving any more has nothing to show, and
  // leaving its last-known altitude on screen is worse than showing nothing: it reads as
  // current. Called on every poll, not only when the layer goes off -- traffic drops out of
  // range one aeroplane at a time.
  function dropSelectionIfGone() {
    const sel = state && state.selected;
    if (!sel || sel.type !== 'traffic') return;
    if (window.trafficAircraft.some(a => a && a.hex === sel.hex)) return;
    state.selected = null;
    if (typeof showInspector === 'function') showInspector();
  }

  // Two sources, one map: the internet feed polled here, and a receiver in the cockpit
  // (gdl90.js) that pushes its own targets. The receiver's report wins for an aircraft both
  // know -- it is what this aeroplane hears now, not what a ground station heard seconds ago.
  let polled = [];
  let external = [];
  // The pilot's switch, where there is one to see: offered, usable, and turned off. The
  // receiver's targets used to stay on the map with the switch off -- clear() re-drew them,
  // and trafficSetExternal never asked.
  const switchedOff = () => offered() && usable() && !on();
  // Own-ship is in the feeds too. Within ~110 m of the fix is not enough to call a target
  // "me": an aeroplane directly above or below is exactly the traffic that matters, and it
  // was being hidden at any height. So: the receiver's own ICAO address when it reports one,
  // and otherwise close by AND within OWN_SHIP_FT of our altitude (when both are known --
  // without an altitude to compare, position alone is all there is, as before).
  const OWN_SHIP_FT = 300;
  function isOwnShip(a, mine, ownHex, ownFt) {
    if (ownHex && a.hex && String(a.hex).toLowerCase() === ownHex) return true;
    if (!(mine && Number.isFinite(a.lat) &&
          Math.abs(a.lat - mine.lat) < 0.001 && Math.abs(a.lon - mine.lng) < 0.001)) return false;
    if (Number.isFinite(ownFt) && Number.isFinite(a.alt)) return Math.abs(a.alt - ownFt) <= OWN_SHIP_FT;
    return true;
  }
  // Our altitude on the feed's reference: transponders report PRESSURE altitude (1013.25 hPa),
  // ours is on the day's QNH -- about 27 ft per hPa apart, so at QNH 1025 or 1002 the gap alone
  // passed the 300 ft gate and our own target came back as traffic (review). With no QNH known,
  // ours is taken as on the standard setting -- the gate still keeps traffic over and under.
  function ownPressureFt(ownFt) {
    if (!Number.isFinite(ownFt)) return null;
    // gpsQnh is the QNH record ({ hPa, inHg, ... }) or null -- Number() of it was always NaN,
    // so the correction never ran (review).
    const q = typeof gpsQnh !== 'undefined' && gpsQnh ? Number(gpsQnh.hPa) : NaN;
    if (!(q > 900 && q < 1100)) return ownFt;
    return ownFt + (1013.25 - q) * 27.3;
  }
  function render() {
    const byHex = new Map();
    for (const a of polled) byHex.set(a.hex || (a.lat + ',' + a.lon), a);
    if (!switchedOff()) for (const a of external) byHex.set(a.hex || (a.lat + ',' + a.lon), a);
    const mine = typeof gpsLastFix === 'function' ? gpsLastFix() : null;
    let ownHex = '';
    try {
      const own = window.NavAid && NavAid.gdl90 && NavAid.gdl90.state && NavAid.gdl90.state.ownship;
      // An unconfigured receiver reports address 000000 for itself: that names nobody.
      ownHex = own && own.hex && !/^0+$/.test(String(own.hex)) ? String(own.hex).toLowerCase() : '';
    } catch (e) { ownHex = ''; }
    let ownFt = null;
    try { ownFt = (mine && typeof gpsAltitudeForCompare === 'function') ? gpsAltitudeForCompare() : null; }
    catch (e) { ownFt = null; }
    const ownPa = ownPressureFt(ownFt);
    window.trafficAircraft = [...byHex.values()].filter(a => !isOwnShip(a, mine, ownHex, ownPa));
    if (followedHex) {
      const target = window.trafficAircraft.find(a => a && a.hex === followedHex);
      if (!target) followedHex = '';
      else if (typeof gpsFollowSuspended !== 'function' || !gpsFollowSuspended()) {
        const c = visibleCentreFor(target.lat, target.lon);
        if (typeof gpsFollowRecenter === 'function') gpsFollowRecenter(c.lat, c.lng);
        else map.setView(c, map.getZoom());
      }
    }
    if (window.trafficAircraft.length) draw(window.trafficAircraft);
    else if (group) { group.clearLayers(); if (map.hasLayer(group)) map.removeLayer(group); }
    dropSelectionIfGone();
    // The selected transponder remains the same object by ICAO address while its report
    // changes underneath it. Keep an already-open inspector in step with each feed/receiver
    // update; refreshInspectorIfVisible deliberately leaves a closed panel closed.
    if (state && state.selected && state.selected.type === 'traffic' &&
        typeof refreshInspectorIfVisible === 'function') refreshInspectorIfVisible();
  }
  window.trafficSetExternal = function (list) {
    external = Array.isArray(list) ? list.filter(a => a && Number.isFinite(a.lat) && Number.isFinite(a.lon)) : [];
    render();
  };

  // How old the feed's picture is. Faded past trafficStaleSec; past trafficDropSec the feed's
  // aircraft go and the pilot is told once -- a frozen aeroplane on the map reads as current.
  function ageOut() {
    if (!lastOkAt || !polled.length) return;
    const age = Date.now() - lastOkAt;
    if (age >= tuneSec('trafficDropSec', 60)) {
      polled = [];
      stalePolled = false;
      render();
      if (!lostSaid && typeof showToast === 'function') {
        lostSaid = true;
        const s = Math.round(age / 1000);
        showToast(typeof S.trafficLost === 'function' ? S.trafficLost(s) : 'Live traffic lost — no update for ' + s + ' s',
          { warn: true });
      }
      return;
    }
    const stale = age >= tuneSec('trafficStaleSec', 30);
    if (stale !== stalePolled) { stalePolled = stale; render(); }
  }
  window.trafficAgeOut = ageOut;

  function clear() {
    polled = [];
    lastOkAt = 0;
    stalePolled = false;
    lostSaid = false;
    if (external.length && !switchedOff()) { render(); return; }
    followedHex = '';
    if (group && map.hasLayer(group)) map.removeLayer(group);
    if (group) group.clearLayers();
    window.trafficAircraft = [];
    dropSelectionIfGone();
  }

  async function poll() {
    ageOut();
    if (inFlight) return;
    if (!on()) { clear(); return; }
    const myGen = generation;   // 'mine' below is the own-ship fix; do not shadow it
    const at = centre();
    const url = endpoint(at.lat, at.lng);
    if (!url) return;                     // no endpoint configured: the feature is simply off
    inFlight = true;
    try {
      const d = await getJson(url);
      // Still the same layer that asked? A response that outlived its own switch-off is
      // stale by definition, and drawing it puts traffic back on a cleared map.
      if (myGen !== generation || !on()) return;
      // Own-ship is in the feed too when the transponder is on: it is already drawn, and a
      // second aeroplane on top of yourself reads as traffic in your lap (render drops it).
      polled = ((d && (d.ac || d.aircraft)) || []).map(normalize);
      lastOkAt = Date.now();
      stalePolled = false;
      lostSaid = false;
      render();
      fails = 0;
      window.trafficLastError = null;
    } catch (e) {
      if (myGen !== generation) return;             // torn down mid-flight: not an outage
      // One dropped request is not an outage. The feed times out or rate-limits now and
      // then, and the old rule -- complain on the first failure ever -- put "Live traffic
      // unavailable" on screen over a map that was drawing traffic perfectly well, which is
      // exactly the kind of message that teaches a pilot to ignore messages. Complain only
      // when it has failed several times running AND there is nothing on the map to look
      // at, and say what went wrong, so the next question is answerable.
      fails += 1;
      window.trafficLastError = { at: Date.now(), why: (e && e.message) || String(e), fails };
      ageOut();
      const quiet = Math.max(1, (typeof tune === 'function' && tune('trafficFailsBeforeWarn')) || 3);
      if (fails === quiet && !window.trafficAircraft.length && typeof showToast === 'function') {
        const why = (e && e.message) || '';
        showToast((S.trafficUnavailable || 'Live traffic unavailable') + (why ? ' (' + why + ')' : ''),
          { warn: true });
      }
    } finally {
      inFlight = false;
    }
  }
  window.trafficPoll = poll;
  let moveTimer = 0;

  function schedule() {
    clearInterval(timer);
    const sec = (typeof tune === 'function' ? tune('trafficRefreshSec') : 8) || 8;
    timer = setInterval(poll, Math.max(3, sec) * 1000);
    poll();
  }
  window.trafficRefresh = function () {
    if (on()) { schedule(); return; }
    generation++;                                   // disown whatever is still in flight
    clearInterval(timer);
    timer = 0;
    clear();
  };

  // Panning to another part of the country is a request to see the traffic there. Debounced,
  // and only when the map actually moved a useful distance: a drag fires moveend constantly,
  // and each one is a request over the wire.
  let lastAsked = null;
  map.on('moveend', () => {
    if (!on()) return;
    const at = centre();
    if (lastAsked && Math.abs(at.lat - lastAsked.lat) < 0.05
                  && Math.abs(at.lng - lastAsked.lng) < 0.05) return;
    lastAsked = at;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(poll, 400);
  });
})();
