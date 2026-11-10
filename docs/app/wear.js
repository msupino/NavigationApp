'use strict';

// The live picture on a paired Wear OS watch: next waypoint, magnetic bearing and distance,
// ETE/ETA, time on this leg, ground speed and altitude. This builds the figures from the same
// state the map and the alerts use (gps.js) and hands them, as one small JSON document, to the
// Android app's WearBridge plugin (mobile/android/.../WearBridgePlugin.java), which puts them on
// the Wearable Data Layer for the NavAid watch app (mobile/android/wear). The watch computes
// nothing navigational -- it shows these numbers, and how old they are.
//
// Sent at most every wearSendSec, and only when a shown figure changed (or every KEEPALIVE_MS, so
// the watch can tell a quiet picture from a dead one). Nothing at all outside the Android app,
// with featureWear off, or with no watch connected. Design: docs/superpowers/specs/
// 2026-11-09-wear-os-companion-design.md.
(function () {
  const KEEPALIVE_MS = 15000;
  const NODES_EVERY_MS = 30000;
  const MIN_ETE_KT = 20;              // slower than this, an ETE is a guess (taxi, a hover)

  const on = () => typeof tune === 'function' && tune('featureWear') === true;
  const plugin = () => {
    const C = window.Capacitor;
    if (!C || typeof C.getPlatform !== 'function' || C.getPlatform() !== 'android') return null;
    return (C.Plugins && C.Plugins.WearBridge) || null;
  };
  const live = () => !!((typeof gpsLiveOn !== 'undefined' && gpsLiveOn) ||
    (typeof gpsRecording !== 'undefined' && gpsRecording) || (typeof simOn !== 'undefined' && simOn));
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  let legIdx = -1, legStart = 0;      // when the current leg began (the watch's leg timer)
  let fixT = 0, lastFixKey = '';      // when the position last changed: the picture's age

  // The document the watch shows. Exposed for tests (NavAid.wear.payload).
  function payload(now) {
    now = now || Date.now();
    const own = (typeof gpsOwn !== 'undefined') ? gpsOwn : null;
    const p = { v: 1, live: live(), staleSec: (typeof tune === 'function' && tune('wearStaleSec')) || 10 };
    if (own && Number.isFinite(own.lat)) {
      const key = own.lat.toFixed(5) + ',' + own.lng.toFixed(5);
      if (key !== lastFixKey) { lastFixKey = key; fixT = now; }
    }
    p.t = fixT || now;
    const gs = fin(typeof gpsLastGS !== 'undefined' ? gpsLastGS : null);
    const alt = fin(typeof gpsLastAlt !== 'undefined' ? gpsLastAlt : null);
    if (gs !== null) p.gsKt = Math.round(gs);
    if (alt !== null) p.altFt = Math.round(alt);
    const wps = (typeof state !== 'undefined' && state.waypoints) || [];
    const legs = (typeof state !== 'undefined' && state.legs) || [];
    if (!own || wps.length < 2 || typeof geo !== 'function') return p;
    if (typeof gpsRouteUnknown !== 'undefined' && gpsRouteUnknown) { p.offRoute = true; return p; }
    const i = Math.max(0, Math.min(typeof gpsAlertLegIndex === 'number' ? gpsAlertLegIndex : 0, wps.length - 2));
    if (i !== legIdx) { legIdx = i; legStart = now; }
    const next = wps[i + 1];
    const g = geo(own, next);
    const label = (wp, k) => (typeof gpsPlaceLabel === 'function' ? gpsPlaceLabel(wp, k) : (wp && wp.name) || '');
    p.wp = String(label(next, i + 1) || '').slice(0, 40);
    p.wpIdx = i + 1;
    p.wpCount = wps.length - 1;
    if (Number.isFinite(g.brg)) p.brgMag = Math.round(typeof toMagnetic === 'function' ? Number(toMagnetic(g.brg)) : g.brg) % 360;
    if (Number.isFinite(g.dist)) {
      p.distNm = Math.round(g.dist * 10) / 10;
      if (gs !== null && gs >= MIN_ETE_KT) {
        p.eteSec = Math.round(g.dist / gs * 3600);
        p.etaUtc = p.t + p.eteSec * 1000;
      }
    }
    p.legStart = legStart;
    const planned = legs[i] && fin(legs[i].inboundAltitude);
    if (planned !== null && planned !== undefined) p.altPlanFt = Math.round(planned);
    p.dest = String(label(wps[wps.length - 1], wps.length - 1) || '').slice(0, 40);
    if (typeof gpsDistanceToDestinationNm === 'function') {
      const d = gpsDistanceToDestinationNm(own, i);
      if (Number.isFinite(d)) p.destNm = Math.round(d * 10) / 10;
    }
    return p;
  }

  // What the watch would show differently: the figures, not their timestamps.
  const shown = (p) => JSON.stringify(Object.assign({}, p, { t: 0, etaUtc: p.etaUtc ? Math.round(p.etaUtc / 60000) : 0 }));

  let lastSent = '', lastSentAt = 0, nodes = 0, nodesAt = 0, wasLive = false, busy = false;
  async function tick() {
    const P = plugin();
    if (!P || busy) return;
    busy = true;
    try {
      const now = Date.now();
      if (!on()) {
        if (lastSent) { lastSent = ''; try { await P.clear(); } catch (e) { /* no watch */ } }
        return;
      }
      if (now - nodesAt > NODES_EVERY_MS) {
        nodesAt = now;
        try { const r = await P.nodes(); nodes = (r && r.count) || 0; } catch (e) { nodes = 0; }
      }
      if (!nodes) return;
      const isLive = live();
      if (!isLive && !wasLive) return;          // nothing to say, and it has been said
      wasLive = isLive;
      const p = payload(now);
      const key = shown(p);
      if (key === lastSent && now - lastSentAt < KEEPALIVE_MS) return;
      await P.publish({ json: JSON.stringify(p) });
      lastSent = key; lastSentAt = now;
    } catch (e) {
      /* the watch went away mid-send: the next tick checks again */
    } finally {
      busy = false;
    }
  }
  let timer = 0;
  function schedule() {
    clearInterval(timer);
    const sec = Math.max(1, Number((typeof tune === 'function' && tune('wearSendSec')) || 2));
    timer = setInterval(tick, sec * 1000);
  }
  if (plugin()) schedule();

  window.NavAid = window.NavAid || {};
  NavAid.wear = { payload, tick, schedule, _reset() { lastSent = ''; lastSentAt = 0; nodes = 0; nodesAt = 0; wasLive = false; legIdx = -1; fixT = 0; lastFixKey = ''; } };
}());
