'use strict';
// The phone's gyro, for the turn predictor. GPS measures a turn only after it has happened --
// a least-squares slope over the last few seconds of course -- so the predictor bent seconds
// after the roll-in and kept bending seconds after the roll-out. A gyro measures turn rate the
// instant it changes, as an AHRS does in a glass cockpit.
//
// It is fused, not trusted:
//   fused = GPS slope + k * (gyro now - gyro slope over the same fixes)
// The gyro is integrated into an angle and fitted over exactly the fix times the GPS slope is
// fitted over, so in a steady turn the two slopes agree, the bracket is ~0 and the GPS rate
// stands; on a roll-in or roll-out only the gyro's "now" has moved, and it supplies the change
// before the GPS window has seen it. A constant gyro bias cancels in the difference.
// k is learned by comparing the two in clear turns -- which also takes care of
// the sign conventions of a platform's motion events, how the phone sits in its mount, and the
// bank angle (a phone in a coordinated turn measures yaw about the tilted vertical). Until k
// is learned the gyro is not used at all.
//
// Yaw rate here is the rotation about the vertical the phone feels (accelerationIncludingGravity),
// so it does not matter whether the phone lies flat, stands up or sits on a kneeboard.
(function () {
  const KEEP_MS = 20000;               // samples kept, comfortably past the GPS window
  const FRESH_MS = 600;                // a gyro reading older than this is not "now"
  const MIN_CAL = 4;                   // clear-turn windows before k is trusted
  const LP_SEC = 0.15;                 // gyro smoothing time constant
  const samples = [];                  // { t, y, a }: low-passed yaw rate (raw sign, deg/s), its integral
  let lp = null;
  let ang = 0;
  let lastAt = 0;
  let on = false;
  // Calibration: running (decaying) least squares of GPS rate on gyro mean.
  let sxy = 0, syy = 0, cal = 0, k = null;

  const tuneOn = () => typeof tune !== 'function' || tune('livePredictorGyro') !== false;

  function yawFrom(e) {
    const r = e && e.rotationRate;
    const g = e && e.accelerationIncludingGravity;
    if (!r || !g) return null;
    if (![r.alpha, r.beta, r.gamma, g.x, g.y, g.z].every(Number.isFinite)) return null;
    const n = Math.hypot(g.x, g.y, g.z);
    if (!(n > 5 && n < 20)) return null;          // not a sensible gravity reading
    // rotationRate: alpha about z, beta about x, gamma about y (deg/s). Project on "up".
    return (r.beta * g.x + r.gamma * g.y + r.alpha * g.z) / n;
  }
  function onMotion(e) {
    const y = yawFrom(e);
    if (y == null) return;
    const t = Date.now();
    // A light low-pass takes the engine vibration out. Time-based (0.15 s), so its lag is the
    // same whether a phone sends 60 events a second or 10.
    const fresh = lp != null && t - lastAt <= FRESH_MS;
    const prev = lp;
    const alpha = fresh ? 1 - Math.exp(-(t - lastAt) / 1000 / LP_SEC) : 1;
    lp = fresh ? lp + (y - lp) * alpha : y;
    if (fresh) ang += (prev + lp) / 2 * (t - lastAt) / 1000;
    lastAt = t;
    samples.push({ t, y: lp, a: ang });
    const cutoff = t - KEEP_MS;
    while (samples.length && samples[0].t < cutoff) samples.shift();
  }
  function start() {
    if (on || !tuneOn() || typeof window === 'undefined' || !window.DeviceMotionEvent) return Promise.resolve(false);
    const listen = () => { if (!on) { on = true; window.addEventListener('devicemotion', onMotion, true); } return true; };
    const DM = window.DeviceMotionEvent;
    // iOS 13+: an explicit grant from a user gesture -- starting tracking is one.
    if (typeof DM.requestPermission === 'function') {
      return Promise.resolve(DM.requestPermission()).then(r => (r === 'granted' ? listen() : false)).catch(() => false);
    }
    return Promise.resolve(listen());
  }
  function stop() {
    if (!on) return;
    on = false;
    window.removeEventListener('devicemotion', onMotion, true);
    samples.length = 0;
    lp = null;
  }
  // The integrated gyro angle at time t (the nearest sample at or before it), or null.
  function angleAt(t) {
    if (!samples.length || t < samples[0].t) return null;
    let lo = 0, hi = samples.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (samples[mid].t <= t) lo = mid; else hi = mid - 1; }
    return t - samples[lo].t <= FRESH_MS ? samples[lo].a : null;
  }
  // Least-squares slope of the gyro angle over the given fix times (deg/s), the gyro's version
  // of the GPS slope, or null when it did not cover them.
  function slopeAt(times) {
    if (!Array.isArray(times) || times.length < 2) return null;
    const pts = [];
    for (const t of times) { const a = angleAt(t); if (a == null) return null; pts.push({ t, a }); }
    const n = pts.length;
    const mt = pts.reduce((s, p) => s + p.t, 0) / n, ma = pts.reduce((s, p) => s + p.a, 0) / n;
    let num = 0, den = 0;
    for (const p of pts) { const d = (p.t - mt) / 1000; num += d * (p.a - ma); den += d * d; }
    return den > 0 ? num / den : null;
  }
  function now() {
    return lp != null && Date.now() - lastAt <= FRESH_MS ? lp : null;
  }
  // A GPS window that measured a clear turn: learn how the gyro relates to it.
  function observe(gpsRate, times) {
    if (!Number.isFinite(gpsRate) || Math.abs(gpsRate) < 1.5 || !times || times.length < 3
      || times[times.length - 1] - times[0] < 3000) return;
    const gm = slopeAt(times);
    if (gm == null || Math.abs(gm) < 0.5) return;
    sxy = sxy * 0.9 + gm * gpsRate;
    syy = syy * 0.9 + gm * gm;
    cal++;
    const kk = syy > 0 ? sxy / syy : null;
    // Plausible only: the same rate, give or take the bank and the mount. Anything else is a
    // phone being handled, not a turn being flown.
    k = kk != null && Math.abs(kk) >= 0.5 && Math.abs(kk) <= 1.6 ? kk : null;
  }
  // The GPS turn rate (0 when GPS says straight) with the gyro's head start added, or null when
  // the gyro has nothing to add (off, not calibrated, no fresh reading).
  function fuse(gpsRate, times) {
    if (!on || !tuneOn() || k == null || cal < MIN_CAL) return null;
    const g = now();
    const gm = slopeAt(times);
    if (g == null || gm == null) return null;
    return (Number.isFinite(gpsRate) ? gpsRate : 0) + k * (g - gm);
  }
  function reset() { sxy = 0; syy = 0; cal = 0; k = null; }

  window.NavAidGyro = { start, stop, observe, fuse, now, reset,
    state: () => ({ on, k, cal, samples: samples.length }), _yawFrom: yawFrom };
}());
