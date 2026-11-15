// ALUNA orbital mechanics core — deterministic two-body propagation with J2 secular
// perturbations, state/element conversions, eclipse and ground-station geometry.
// Units: km, s, rad. Frame: Earth-centred inertial (ECI, z = north pole).
// Educational simulation only — not certified for real flight operations.

export const MU = 398600.4418; // km^3/s^2
export const RE = 6378.137; // km
export const J2 = 1.08262668e-3;
export const OMEGA_E = 7.2921159e-5; // rad/s
export const G0 = 9.80665e-3; // km/s^2
export const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export const wrap = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

/** Elements: { a, e, i, raan, argp, M, epoch } — M is mean anomaly at epoch (sim seconds). */
export function makeElements({ altKm = 500, e = 0, incDeg = 51.6, raanDeg = 0, argpDeg = 0, maDeg = 0, epoch = 0 }) {
  return { a: RE + altKm, e, i: incDeg * DEG, raan: raanDeg * DEG, argp: argpDeg * DEG, M: maDeg * DEG, epoch };
}

export const meanMotion = (a) => Math.sqrt(MU / (a * a * a));
export const period = (a) => TWO_PI / meanMotion(a);

export function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** J2 secular rates of RAAN, argument of perigee, mean anomaly. */
export function j2Rates(el) {
  const n = meanMotion(el.a);
  const p = el.a * (1 - el.e * el.e);
  const k = 1.5 * J2 * (RE / p) ** 2 * n;
  const ci = Math.cos(el.i);
  return {
    raanDot: -k * ci,
    argpDot: 0.5 * k * (5 * ci * ci - 1),
    mDot: n + 0.5 * k * Math.sqrt(1 - el.e * el.e) * (3 * ci * ci - 1),
  };
}

/** Propagate elements to sim time t → { r, v } (ECI, km & km/s). */
export function propagate(el, t) {
  const dt = t - el.epoch;
  const rates = j2Rates(el);
  const raan = el.raan + rates.raanDot * dt;
  const argp = el.argp + rates.argpDot * dt;
  const M = wrap(el.M + rates.mDot * dt);
  const E = solveKepler(M, el.e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const sq = Math.sqrt(1 - el.e * el.e);
  const xp = el.a * (cosE - el.e);
  const yp = el.a * sq * sinE;
  const r = el.a * (1 - el.e * cosE);
  const nAvg = meanMotion(el.a);
  const vxp = (-el.a * nAvg * el.a * sinE) / r;
  const vyp = (el.a * nAvg * el.a * sq * cosE) / r;
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(el.i), si = Math.sin(el.i);
  const R11 = cO * cw - sO * sw * ci, R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci, R22 = -sO * sw + cO * cw * ci;
  const R31 = sw * si, R32 = cw * si;
  return {
    r: [R11 * xp + R12 * yp, R21 * xp + R22 * yp, R31 * xp + R32 * yp],
    v: [R11 * vxp + R12 * vyp, R21 * vxp + R22 * vyp, R31 * vxp + R32 * vyp],
  };
}

/** Cartesian state → elements with epoch t (inverse of propagate at dt = 0). */
export function stateToElements(r, v, t) {
  const rm = v3.len(r);
  const vm2 = v3.dot(v, v);
  const h = v3.cross(r, v);
  const hm = v3.len(h);
  const nvec = [-h[1], h[0], 0];
  const nm = Math.hypot(nvec[0], nvec[1]);
  const evec = v3.scale(v3.sub(v3.scale(r, vm2 - MU / rm), v3.scale(v, v3.dot(r, v))), 1 / MU);
  let e = v3.len(evec);
  const energy = vm2 / 2 - MU / rm;
  const a = -MU / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hm)));
  let raan = nm > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, nvec[0] / nm))) : 0;
  if (nvec[1] < 0) raan = TWO_PI - raan;
  let argp, nu;
  if (e < 1e-7) {
    // circular: measure argument of latitude from node
    e = 0;
    argp = 0;
    if (nm > 1e-9) {
      nu = Math.acos(Math.max(-1, Math.min(1, v3.dot(nvec, r) / (nm * rm))));
      if (r[2] < 0) nu = TWO_PI - nu;
    } else {
      nu = Math.atan2(r[1], r[0]);
    }
  } else {
    if (nm > 1e-9) {
      argp = Math.acos(Math.max(-1, Math.min(1, v3.dot(nvec, evec) / (nm * e))));
      if (evec[2] < 0) argp = TWO_PI - argp;
    } else {
      argp = Math.atan2(evec[1], evec[0]);
    }
    nu = Math.acos(Math.max(-1, Math.min(1, v3.dot(evec, r) / (e * rm))));
    if (v3.dot(r, v) < 0) nu = TWO_PI - nu;
  }
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = wrap(E - e * Math.sin(E));
  return { a, e, i, raan: wrap(raan), argp: wrap(argp), M, epoch: t };
}

/** Apply an impulsive burn given in the RTN/velocity frame (m/s). dir: prograde|retrograde|normal|antinormal|radial|antiradial */
export function burnVector(state, dir, dvMs) {
  const dv = dvMs / 1000;
  const vhat = v3.norm(state.v);
  const hhat = v3.norm(v3.cross(state.r, state.v));
  const rhat = v3.norm(state.r);
  const map = {
    prograde: vhat, retrograde: v3.scale(vhat, -1),
    normal: hhat, antinormal: v3.scale(hhat, -1),
    radial: rhat, antiradial: v3.scale(rhat, -1),
  };
  return v3.scale(map[dir] || vhat, dv);
}

export function applyBurn(el, t, dir, dvMs) {
  const s = propagate(el, t);
  const v2 = v3.add(s.v, burnVector(s, dir, dvMs));
  return stateToElements(s.r, v2, t);
}

export const perigeeAlt = (el) => el.a * (1 - el.e) - RE;
export const apogeeAlt = (el) => el.a * (1 + el.e) - RE;
export const altitudeOf = (r) => v3.len(r) - RE;

/** Hohmann transfer between circular radii — returns burn magnitudes in m/s and transfer time. */
export function hohmann(r1, r2) {
  const at = (r1 + r2) / 2;
  const dv1 = Math.sqrt(MU / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  const dv2 = Math.sqrt(MU / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2)));
  return { dv1: dv1 * 1000, dv2: dv2 * 1000, tof: Math.PI * Math.sqrt(at ** 3 / MU) };
}

/** Plane change Δv for circular orbit (m/s). */
export const planeChangeDv = (a, dI) => 2 * Math.sqrt(MU / a) * Math.sin(Math.abs(dI) / 2) * 1000;

/** Sun direction (unit, ECI) — slow annual motion, deterministic. */
export function sunDir(t, t0Deg = 30) {
  const lam = t0Deg * DEG + (TWO_PI * t) / (365.25 * 86400);
  const eps = 23.44 * DEG;
  return [Math.cos(lam), Math.sin(lam) * Math.cos(eps), Math.sin(lam) * Math.sin(eps)];
}

/** Cylindrical Earth shadow test. */
export function inEclipse(r, s) {
  const d = v3.dot(r, s);
  if (d > 0) return false;
  const perp = v3.sub(r, v3.scale(s, d));
  return v3.len(perp) < RE;
}

export const gmst = (t) => wrap(OMEGA_E * t + 1.2);

/** Ground station ECI position. */
export function stationEci(st, t) {
  const lat = st.lat * DEG, lon = st.lon * DEG + gmst(t);
  const R = RE + (st.altKm || 0);
  return [R * Math.cos(lat) * Math.cos(lon), R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat)];
}

/** Elevation angle (deg) of satellite seen from station. */
export function elevation(st, r, t) {
  const g = stationEci(st, t);
  const rel = v3.sub(r, g);
  const up = v3.norm(g);
  return Math.asin(v3.dot(v3.norm(rel), up)) / DEG;
}

/** Sub-satellite latitude/longitude (deg). */
export function subPoint(r, t) {
  const lon = Math.atan2(r[1], r[0]) - gmst(t);
  const lat = Math.asin(r[2] / v3.len(r));
  let L = (lon / DEG) % 360;
  if (L > 180) L -= 360;
  if (L < -180) L += 360;
  return { lat: lat / DEG, lon: L };
}

/** Line-of-sight between two satellites not blocked by Earth (+100 km atmosphere margin). */
export function lineOfSight(r1, r2) {
  const d = v3.sub(r2, r1);
  const t = Math.max(0, Math.min(1, -v3.dot(r1, d) / v3.dot(d, d)));
  const p = v3.add(r1, v3.scale(d, t));
  return v3.len(p) > RE + 100;
}

/** Conjunction screening between two element sets over [t0, t0+horizon].
 * Coarse sampling finds every local minimum of separation; each is refined by golden-section search. */
export function screenPair(elA, elB, t0, horizon, step = 20) {
  const f = (t) => v3.len(v3.sub(propagate(elA, t).r, propagate(elB, t).r));
  const ts = [], ds = [];
  for (let t = t0; t <= t0 + horizon + 1e-9; t += step) { ts.push(t); ds.push(f(t)); }
  const cands = [];
  for (let k = 0; k < ts.length; k++) {
    const prev = k > 0 ? ds[k - 1] : Infinity, next = k < ts.length - 1 ? ds[k + 1] : Infinity;
    if (ds[k] <= prev && ds[k] <= next) cands.push(k);
  }
  let best = { d: Infinity, tca: t0 };
  for (const k of cands) {
    if (ds[k] > 400 && cands.length > 1 && ds[k] > best.d) continue;
    let lo = Math.max(t0, ts[k] - step), hi = Math.min(t0 + horizon, ts[k] + step);
    for (let j = 0; j < 36; j++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      if (f(m1) < f(m2)) hi = m2; else lo = m1;
    }
    const tca = (lo + hi) / 2, d = f(tca);
    if (d < best.d) best = { d, tca };
  }
  const sa = propagate(elA, best.tca), sb = propagate(elB, best.tca);
  return { d: best.d, tca: best.tca, relSpeed: v3.len(v3.sub(sa.v, sb.v)) };
}

export function riskLevel(dKm) {
  if (dKm < 1) return 'critical';
  if (dKm < 5) return 'high';
  if (dKm < 25) return 'medium';
  return 'low';
}

/** Rocket equation: propellant (kg) to deliver dv (m/s) from wet mass m (kg) at Isp (s). */
export const propellantFor = (m, dvMs, isp) => m * (1 - Math.exp(-(dvMs / 1000) / (isp * G0)));
export const dvFromProp = (m, prop, isp) => isp * G0 * Math.log(m / Math.max(1e-6, m - prop)) * 1000;
