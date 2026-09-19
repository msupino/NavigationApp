/* Shared by the feed producer and browser so cached TAFs use the same intervals. */
(function (root) {
  function tafPeriods(taf) {
    const forecasts = taf && Array.isArray(taf.fcsts) ? taf.fcsts : [];
    const anchor = forecasts.find(f => Number.isFinite(f.timeFrom));
    if (!anchor) return [];
    const ref = new Date(anchor.timeFrom * 1000);
    const epoch = (day, hour, minute = 0) => {
      const candidates = [-1, 0, 1].map(offset => Date.UTC(ref.getUTCFullYear(),
        ref.getUTCMonth() + offset, +day, +hour, +minute) / 1000);
      return candidates.sort((a, b) => Math.abs(a - anchor.timeFrom) - Math.abs(b - anchor.timeFrom))[0];
    };
    const raw = String(taf.rawTAF || '');
    const validity = raw.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
    const end = validity ? epoch(validity[3], validity[4]) : taf.validTo;
    const markers = [...raw.matchAll(/\b(FM(\d{2})(\d{2})(\d{2})|(?:PROB\d{2}(?:\s+TEMPO)?|TEMPO|BECMG)\s+(\d{2})(\d{2})\/(\d{2})(\d{2}))\b/g)];
    const groups = markers.map((m, i) => ({
      from: m[2] ? epoch(m[2], m[3], m[4]) : epoch(m[5], m[6]),
      transitionEnd: m[2] ? epoch(m[2], m[3], m[4]) : epoch(m[7], m[8]),
      temporary: /^(PROB|TEMPO)/.test(m[1]),
      text: raw.slice(m.index + m[0].length, markers[i + 1] ? markers[i + 1].index : raw.length),
    }));
    let prevailingClouds = [];
    return forecasts.map((f, i) => {
      const temporary = /^(TEMPO|PROB)/.test(f.fcstChange || '');
      const group = groups.find(g => g.from === f.timeFrom && g.temporary === temporary);
      const next = groups.find(g => !g.temporary && g.from > f.timeFrom);
      let to = Number.isFinite(f.timeTo) ? f.timeTo
        : temporary ? group && group.transitionEnd
          : next ? next.transitionEnd : end;
      if (Number.isFinite(end) && Number.isFinite(to)) to = Math.min(to, end);
      const text = group ? group.text : raw.slice(0, markers[0] ? markers[0].index : raw.length);
      const specified = /\b(?:CAVOK|NSC|SKC|NCD|(?:FEW|SCT|BKN|OVC|VV)\d{3})/.test(text);
      const clouds = Array.isArray(f.clouds) && (f.clouds.length || specified || i === 0)
        ? f.clouds : prevailingClouds;
      if (!temporary) prevailingClouds = clouds;
      return { ...f, clouds, timeTo: to };
    }).filter(f => Number.isFinite(f.timeFrom) && Number.isFinite(f.timeTo) && f.timeTo > f.timeFrom);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = tafPeriods;
  else root.tafPeriods = tafPeriods;
})(typeof window !== 'undefined' ? window : globalThis);
