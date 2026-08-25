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
  let timer = 0;
  let inFlight = false;
  let fails = 0;               // consecutive failed polls; one blip is not an outage
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
  // cannot read them at all -- verified against adsb.lol, adsb.fi, airplanes.live, adsb.one
  // and OpenSky, and against the public CORS proxies, which either time out or rate-limit
  // long before an 8-second poll. The APK is not a browser: Capacitor's native HTTP makes
  // the request in Java, where the same-origin rule does not apply. So this feature exists
  // in the APK and nowhere else, rather than existing everywhere and failing on the desktop.
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
  const usable = () => !!nativeHttp();
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

  // The feeds put the position in the path (adsb.lol: /v2/lat/32.05/lon/34.92/dist/40), so
  // the tunable is a template. A URL with no placeholders keeps the old query-string form,
  // which is what a proxy of one's own would most likely want.
  function endpoint(lat, lng) {
    const base = (typeof tune === 'function' && tune('trafficApiUrl')) || '';
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
      type: String(a.type || a.t || '').trim(),
      squawk: String(a.squawk || '').trim(),
    };
  }

  // GET through the native bridge. Capacitor hands back a parsed body for JSON responses
  // and a string otherwise, so both have to be accepted.
  async function getJson(url) {
    const http = nativeHttp();
    if (!http) throw new Error('no native http');
    const r = await http.request({ url, method: 'GET', headers: { Accept: 'application/json' } });
    if (!r || r.status < 200 || r.status >= 300) throw new Error('HTTP ' + (r && r.status));
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }

  // The arrow points where the aircraft is going, and carries what a pilot reads first: who
  // it is and how high. Altitude in hundreds of feet, the way it is said on the radio.
  // A top-down aeroplane, the way every traffic display draws one: nose along the track, so
  // the shape alone says which way it is going before the label is read. Drawn as a path
  // rather than a glyph -- a font character (the old arrow) is whatever the device decides
  // it is, and colour, size and the white outline that keeps it legible over a chart all
  // have to be ours.
  const PLANE = 'M12 1.6 13.35 6.4 13.35 9.6 22.4 14.9 22.4 17 13.35 14.3 13.35 19.4'
              + ' 16.1 21.3 16.1 22.6 12 21.4 7.9 22.6 7.9 21.3 10.65 19.4 10.65 14.3'
              + ' 1.6 17 1.6 14.9 10.65 9.6 10.65 6.4Z';

  function icon(a) {
    const trk = Number.isFinite(a.track) ? a.track : 0;
    const fl = Number.isFinite(a.alt) ? Math.round(a.alt / 100) : null;
    const label = [a.flight || a.hex || '', fl === null ? '' : (fl < 10 ? '0' : '') + fl]
      .filter(Boolean).join(' ');
    const px = Math.round((typeof tune === 'function' && tune('trafficIconPx')) || 22);
    const svg = '<svg class="traffic-plane" viewBox="0 0 24 24" width="' + px + '" height="' + px
      + '" aria-hidden="true"><path d="' + PLANE + '"/></svg>';
    return L.divIcon({
      className: 'traffic-mark',
      iconSize: [px + 38, px + 4],
      iconAnchor: [Math.round(px / 2), Math.round(px / 2)],
      html: '<span class="traffic-arrow" style="transform:rotate(' + trk + 'deg)">' + svg + '</span>'
          + '<span class="traffic-label">' + escapeXml(label) + '</span>',
    });
  }

  function draw(list) {
    if (!group) group = L.layerGroup();
    group.clearLayers();
    for (const a of list) {
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
      const m = L.marker([a.lat, a.lon], { icon: icon(a), keyboard: false, pane: 'markerPane',
                                           title: a.flight || a.hex || '' });
      m._traffic = a;
      m.on('click', (e) => {
        // The map's own click handler clears the selection, and it runs after this one --
        // so without stopping here, tapping an aircraft selected it and immediately let go.
        // Guarded: a Leaflet event fired by hand carries no originalEvent, and handing that
        // to DomEvent throws before the selection is ever made.
        const dom = e && e.originalEvent;
        if (dom && L.DomEvent) L.DomEvent.stopPropagation(dom);
        state.selected = { type: 'traffic', hex: a.hex };
        if (typeof showInspector === 'function') showInspector();
      });
      m.addTo(group);
    }
    if (!map.hasLayer(group)) group.addTo(map);
  }

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

  function clear() {
    if (group && map.hasLayer(group)) map.removeLayer(group);
    if (group) group.clearLayers();
    window.trafficAircraft = [];
    dropSelectionIfGone();
  }

  async function poll() {
    if (inFlight) return;
    if (!on()) { clear(); return; }
    const at = centre();
    const url = endpoint(at.lat, at.lng);
    if (!url) return;                     // no endpoint configured: the feature is simply off
    inFlight = true;
    try {
      const d = await getJson(url);
      const list = ((d && (d.ac || d.aircraft)) || []).map(normalize);
      // Own-ship is in the feed too when the transponder is on: it is already drawn, and a
      // second aeroplane on top of yourself reads as traffic in your lap.
      const mine = typeof gpsLastFix === 'function' ? gpsLastFix() : null;
      window.trafficAircraft = list.filter(a => !(mine && Number.isFinite(a.lat) &&
        Math.abs(a.lat - mine.lat) < 0.001 && Math.abs(a.lon - mine.lng) < 0.001));
      draw(window.trafficAircraft);
      dropSelectionIfGone();
      fails = 0;
      window.trafficLastError = null;
    } catch (e) {
      // One dropped request is not an outage. The feed times out or rate-limits now and
      // then, and the old rule -- complain on the first failure ever -- put "Live traffic
      // unavailable" on screen over a map that was drawing traffic perfectly well, which is
      // exactly the kind of message that teaches a pilot to ignore messages. Complain only
      // when it has failed several times running AND there is nothing on the map to look
      // at, and say what went wrong, so the next question is answerable.
      fails += 1;
      window.trafficLastError = { at: Date.now(), why: (e && e.message) || String(e), fails };
      const quiet = Math.max(1, (typeof tune === 'function' && tune('trafficFailsBeforeWarn')) || 3);
      if (fails === quiet && !window.trafficAircraft.length && typeof showToast === 'function') {
        const why = (e && e.message) || '';
        showToast((S.trafficUnavailable || 'Live traffic unavailable') + (why ? ' (' + why + ')' : ''));
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
    if (on()) schedule();
    else { clearInterval(timer); timer = 0; clear(); }
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
