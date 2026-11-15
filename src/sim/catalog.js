// External satellite records — clearly separated from player-created simulated spacecraft.
// Source A (bundled): CelesTrak GP element sets captured 2019-10-11/12, redistributed in the MIT-licensed
//   tle.js test fixtures. Static snapshot — NOT live tracking.
// Source B (optional, on request): the TLE API (tle.ivanstanojevic.me) listed in NASA's Open APIs catalogue.
// Propagation uses SGP4 via satellite.js.
import * as satellite from 'satellite.js';

export const SNAPSHOT_SOURCE = { name: 'CelesTrak GP snapshot (via tle.js fixtures, MIT)', epoch: '2019-10-11 → 2019-10-12 UTC', live: false };

export function parseTle(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      const name = i > 0 && !lines[i - 1].startsWith('2 ') ? lines[i - 1].trim() : `NORAD ${lines[i].slice(2, 7)}`;
      out.push(makeRecord(name, lines[i], lines[i + 1]));
      i++;
    }
  }
  return out.filter(Boolean);
}

export function makeRecord(name, l1, l2, source = SNAPSHOT_SOURCE.name) {
  try {
    const satrec = satellite.twoline2satrec(l1, l2);
    const epochMs = (satrec.jdsatepoch - 2440587.5) * 86400000;
    const meanMotion = satrec.no * 1440 / (2 * Math.PI); // rev/day
    const a = Math.pow(398600.4418 / Math.pow(satrec.no / 60, 2), 1 / 3);
    return { id: `EXT-${l1.slice(2, 7).trim()}`, norad: +l1.slice(2, 7), name, l1, l2, satrec, epochMs, incDeg: (satrec.inclo * 180) / Math.PI, ecc: satrec.ecco, periodMin: 1440 / meanMotion, altKm: a - 6378.137, source };
  } catch { return null; }
}

/** ECI (TEME) position in km at epoch + dt seconds. */
export function propagateRecord(rec, dtSec) {
  const d = new Date(rec.epochMs + dtSec * 1000);
  const pv = satellite.propagate(rec.satrec, d);
  if (!pv.position) return null;
  return { r: [pv.position.x, pv.position.y, pv.position.z], v: [pv.velocity.x, pv.velocity.y, pv.velocity.z], date: d };
}

let cache = null;
export async function loadSnapshot() {
  if (cache) return cache;
  const res = await fetch(`${import.meta.env.BASE_URL}data/reference_tles_celestrak_2019-10.txt`);
  cache = parseTle(await res.text());
  return cache;
}

const LIVE_IDS = [25544, 20580, 43013, 39084, 25994, 27424, 33591];
/** Attempts a live fetch; returns { records, error }. Never fabricates data on failure. */
export async function fetchLiveTles() {
  const records = [];
  let error = null;
  for (const id of LIVE_IDS) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(`https://tle.ivanstanojevic.me/api/tle/${id}`, { signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const rec = makeRecord(j.name, j.line1, j.line2, `TLE API (NASA Open APIs listing), element date ${j.date}`);
      if (rec) { rec.fetchedAt = new Date().toISOString(); records.push(rec); }
    } catch (e) { error = e.message || String(e); break; }
  }
  return { records, error };
}
