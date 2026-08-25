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
  let lastError = 0;
  window.trafficAircraft = [];          // what the inspector and the hit test read

  const live = () => typeof gpsPositionLive === 'function' && gpsPositionLive();
  // The gist switch outranks the pilot's: a feature that is off is off everywhere, even on
  // a device that ticked the box while it was on.
  const offered = () => typeof tune !== 'function' || tune('featureLiveTraffic') === true;
  window.trafficOffered = offered;
  const on = () => {
    if (!offered()) return false;
    let stored = null;
    try { stored = localStorage.getItem(LAYER_KEY); } catch (e) { /* storage unavailable */ }
    if (stored === '0') return false;
    if (stored === '1') return true;
    return typeof tune === 'function' ? tune('defaultShowTraffic') !== false : true;
  };
  window.trafficEnabled = on;

  function endpoint(lat, lng) {
    const base = (typeof tune === 'function' && tune('trafficApiUrl')) || '';
    if (!base) return '';
    const nm = (typeof tune === 'function' ? tune('trafficRadiusNm') : 40) || 40;
    const sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + 'lat=' + lat.toFixed(4) + '&lon=' + lng.toFixed(4) + '&dist=' + Math.round(nm);
  }

  // The arrow points where the aircraft is going, and carries what a pilot reads first: who
  // it is and how high. Altitude in hundreds of feet, the way it is said on the radio.
  function icon(a) {
    const trk = Number.isFinite(a.track) ? a.track : 0;
    const fl = Number.isFinite(a.alt) ? Math.round(a.alt / 100) : null;
    const label = [a.flight || a.hex || '', fl === null ? '' : (fl < 10 ? '0' : '') + fl]
      .filter(Boolean).join(' ');
    return L.divIcon({
      className: 'traffic-mark',
      iconSize: [58, 26],
      iconAnchor: [13, 13],
      html: '<span class="traffic-arrow" style="transform:rotate(' + trk + 'deg)">➤</span>' +
            '<span class="traffic-label">' + escapeXml(label) + '</span>',
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
    if (!live() || !on()) { clear(); return; }
    const c = (typeof gpsLastFix === 'function' && gpsLastFix()) || null;
    const at = c && Number.isFinite(c.lat) ? c : map.getCenter();
    const url = endpoint(at.lat, at.lng !== undefined ? at.lng : at.lon);
    if (!url) return;                     // no endpoint configured: the feature is simply off
    inFlight = true;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const list = (d && d.aircraft) || [];
      // Own-ship is in the feed too when the transponder is on: it is already drawn, and a
      // second aeroplane on top of yourself reads as traffic in your lap.
      const mine = typeof gpsLastFix === 'function' ? gpsLastFix() : null;
      window.trafficAircraft = list.filter(a => !(mine && Number.isFinite(a.lat) &&
        Math.abs(a.lat - mine.lat) < 0.001 && Math.abs(a.lon - mine.lng) < 0.001));
      draw(window.trafficAircraft);
      dropSelectionIfGone();
      lastError = 0;
    } catch (e) {
      // Silence, once: an aircraft map that nags about a dropped request in the air is worse
      // than one that quietly shows what it last had.
      if (!lastError && typeof showToast === 'function') {
        showToast(S.trafficUnavailable || 'Live traffic unavailable');
      }
      lastError = Date.now();
    } finally {
      inFlight = false;
    }
  }
  window.trafficPoll = poll;

  function schedule() {
    clearInterval(timer);
    const sec = (typeof tune === 'function' ? tune('trafficRefreshSec') : 8) || 8;
    timer = setInterval(poll, Math.max(3, sec) * 1000);
    poll();
  }
  window.trafficRefresh = function () {
    if (live() && on()) schedule();
    else { clearInterval(timer); timer = 0; clear(); }
  };
})();
