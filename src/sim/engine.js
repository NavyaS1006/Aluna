// ALUNA Mission Engine — the authoritative, deterministic mission simulation.
// Runs in the solo player's browser, or on the squad host for Squad Ops.
import {
  RE, MU, DEG, v3, makeElements, propagate, stateToElements, applyBurn, perigeeAlt, apogeeAlt,
  sunDir, inEclipse, elevation, lineOfSight, screenPair, riskLevel, hohmann, period, propellantFor, wrap,
} from './orbit.js';
import { BUSES, PAYLOADS, PANELS, PROPULSION, COMMS, SOLAR_CONST, CELL_EFF, budgets } from './design.js';
import { makeRng, hashString } from './rng.js';
import { runAgents } from './agents.js';

export const STATIONS = [
  { id: 'gs-gold', name: 'Goldstone (DSN)', lat: 35.43, lon: -116.89 },
  { id: 'gs-madr', name: 'Madrid (DSN)', lat: 40.43, lon: -4.25 },
  { id: 'gs-canb', name: 'Canberra (DSN)', lat: -35.4, lon: 148.98 },
  { id: 'gs-sval', name: 'Svalbard', lat: 78.23, lon: 15.39 },
  { id: 'gs-hart', name: 'Hartebeesthoek', lat: -25.89, lon: 27.69 },
  { id: 'gs-bang', name: 'Bengaluru', lat: 13.03, lon: 77.51 },
  { id: 'gs-wall', name: 'Wallops', lat: 37.94, lon: -75.46 },
  { id: 'gs-sant', name: 'Santiago', lat: -33.15, lon: -70.67 },
];

const SAT_NAMES = ['LYRA', 'ORION', 'VEGA', 'ALTAIR', 'DENEB', 'RIGEL', 'CAPELLA', 'SIRIUS', 'POLARIS', 'ANTARES', 'SPICA', 'ARCTURUS', 'MIRA', 'ELARA', 'TALOS', 'NOVA'];
const SAT_COLORS = ['#4fd1ff', '#ffb547', '#7cff9b', '#ff6fa8', '#b18cff', '#ffe066', '#5cf2d6', '#ff8a5c', '#8fb3ff', '#e0ff6f', '#ff5c5c', '#6fffe9', '#f7a8ff', '#a8ffb0', '#ffd0a8', '#c0c0ff'];

export const ROLE_PERMS = {
  commander: ['set_mode', 'decision_high', 'authorize', 'time_scale', 'abort', 'inspect', 'decision'],
  flight: ['burn', 'plan_transfer', 'circularize', 'plane_change', 'plan_avoid', 'deploy', 'inspect', 'prop_backup'],
  systems: ['payload', 'sensor_reset', 'comms_reboot', 'comms_backup', 'panel_realign', 'load_shed', 'safe_mode', 'payload_reset', 'heater_reset', 'inspect', 'prop_backup'],
  autonomy: ['decision', 'agent_toggle', 'inspect'],
};
export const ROLE_LABELS = {
  commander: 'Mission Commander', flight: 'Flight Operations Officer',
  systems: 'Satellite Systems Specialist', autonomy: 'Autonomous Systems Supervisor',
};

export const FATAL_KM = 1.0; // hard-body exclusion zone (game rule)
const STEP = 5; // integration step, sim seconds

let uid = 0;
const nid = (p) => `${p}-${(++uid).toString(36)}`;

export class MissionEngine {
  constructor(mission, design, { seed = 'x', mode = 'manual', squad = false } = {}) {
    this.mission = mission;
    this.design = design;
    this.b = budgets(design);
    this.rng = makeRng(hashString(`${mission.id}:${seed}`));
    const s = {
      missionId: mission.id, t: 0, acc: 0, timeScale: mission.timeScale || 60, paused: false, mode, squad,
      status: 'active', ended: false, endReason: '',
      stage: { el: mission.stageEcc ? { ...makeElements({ altKm: design.altKm, incDeg: design.incDeg, raanDeg: mission.raanDeg ?? 40, epoch: 0 }), a: RE + design.altKm + 60, e: 0.012 } : makeElements({ altKm: design.altKm, incDeg: design.incDeg, raanDeg: mission.raanDeg ?? 40, maDeg: 0, epoch: 0 }) },
      sats: [], debris: [], conjunctions: [], log: [], activeEvents: [], decisions: [], scheduled: [], tasks: [],
      stationsDown: {}, contacted: {}, storm: null,
      objectives: (mission.objectives || []).map((o) => ({ ...o, done: false, failed: false, progress: 0, acc: 0 })),
      stats: { burns: 0, dvUsed: 0, avoided: 0, collisions: 0, nearMiss: 0, approved: 0, rejected: 0, modified: 0, auto: 0, modeSwitches: 0, resolved: 0, inspected: [], authorized: false, aiTime: 0, eclipses: 0, downlink: 0, collected: 0, payloadTime: 0, networkTime: 0 },
      agentsEnabled: { health: true, power: true, comms: true, collision: true, planning: true, resource: true, fleet: true },
      agentTimer: 0, sunLon: (mission.raanDeg ?? 40),
    };
    this.s = s;
    for (let k = 0; k < design.satCount; k++) s.sats.push(this.makeSat(k));
    this.scheduleEvents();
    this.spawnAmbient();
    this.log('info', `Mission ${mission.title} initialised. ${design.satCount} spacecraft stowed in upper stage.`);
    if (!mission.manualDeploy) this.autoDeployPlan();
    this.s.scheduled.sort((a, b) => a.t - b.t);
  }

  makeSat(k) {
    const d = this.design, bus = BUSES[d.bus];
    return {
      id: `${this.mission.id}-SAT${String(k + 1).padStart(2, '0')}`,
      name: `${SAT_NAMES[k % SAT_NAMES.length]}-${k + 1}`,
      color: SAT_COLORS[k % SAT_COLORS.length], idx: k,
      el: null, deployed: false, alive: true, health: 100,
      battery: d.batteryWh * 0.9, batteryCap: d.batteryWh, fuel: d.propulsion === 'none' ? 0 : d.fuelKg, fuelCap: d.fuelKg,
      dryMass: this.b.dryMass, solarEff: 1, comms: 'ok', commsBackup: false, sensor: 'ok', prop: d.propulsion === 'none' ? 'none' : 'ok', propBackup: false,
      payload: d.payload === 'none' ? 'none' : 'ok', payloadOn: false, safeMode: false, loadShed: false, extraLoad: 0,
      dataStored: 0, dataDown: 0, inContact: null, eclipse: false, gen: 0, load: 0, minBattPct: 100, initAlt: d.altKm, busy: null,
      lowBattT: 0, size: bus.size,
    };
  }

  // ---------------------------------------------------------------- logging
  log(sev, msg, extra = {}) {
    this.s.log.push({ t: this.s.t, sev, msg, ...extra });
    if (this.s.log.length > 200) this.s.log.shift();
  }

  // ---------------------------------------------------------------- setup
  autoDeployPlan() {
    const T = period(this.s.stage.el.a);
    const n = this.s.sats.length;
    const spacing = this.mission.phased ? 40 : 25;
    this.s.sats.forEach((sat, k) => this.s.scheduled.push({ t: 30 + k * spacing, kind: 'deploy', auto: true }));
  }

  scheduleEvents() {
    const m = this.mission, r = this.rng, s = this.s;
    const L = m.timeLimit;
    const list = [...(m.events || [])];
    if (m.randomEvents) {
      for (let k = 0; k < m.randomEvents.count; k++) list.push({ type: r.pick(m.randomEvents.pool), at: m.randomEvents.window || [0.2, 0.8] });
    }
    for (const ev of list) {
      const at = Array.isArray(ev.at) ? r.range(ev.at[0], ev.at[1]) : ev.at ?? r.range(0.2, 0.7);
      const t = at <= 1 ? at * L : at;
      s.scheduled.push({ t, kind: 'event', ev: { ...ev, targetRoll: r.next() } });
    }
    s.scheduled.sort((a, b) => a.t - b.t);
  }

  spawnAmbient() {
    const n = this.mission.ambientDebris ?? 24;
    for (let k = 0; k < n; k++) {
      const alt = this.rng.range(350, 1400);
      this.s.debris.push({
        id: `DEB-${1000 + k}`, name: `Fragment ${1000 + k}`, kind: 'ambient',
        el: makeElements({ altKm: alt, e: this.rng.range(0, 0.01), incDeg: this.rng.range(20, 100), raanDeg: this.rng.range(0, 360), argpDeg: this.rng.range(0, 360), maDeg: this.rng.range(0, 360) }),
      });
    }
  }

  // ---------------------------------------------------------------- queries
  renderT() { return this.s.t + (this.s.ended || this.s.paused ? 0 : this.s.acc); }
  pos(el, t = this.s.t) { return propagate(el, t); }
  deployedSats() { return this.s.sats.filter((x) => x.deployed); }
  aliveSats() { return this.s.sats.filter((x) => x.deployed && x.alive); }
  sat(id) { return this.s.sats.find((x) => x.id === id || x.idx === id); }
  ispOf(sat) { const isp = PROPULSION[this.design.propulsion].isp; return sat.propBackup ? isp * 0.8 : isp; }
  maxDvPerBurn() { return PROPULSION[this.design.propulsion].maxDv; }

  // ---------------------------------------------------------------- main loop
  update(realDt) {
    const s = this.s;
    if (s.ended || s.paused) return;
    s.acc += Math.min(realDt, 0.25) * s.timeScale;
    let guard = 0;
    while (s.acc >= STEP && guard++ < 400) {
      s.acc -= STEP;
      this.step(STEP);
      if (s.ended) break;
    }
  }

  step(dt) {
    const s = this.s;
    s.t += dt;
    // scheduled items
    while (s.scheduled.length && s.scheduled[0].t <= s.t) {
      const it = s.scheduled.shift();
      if (it.kind === 'event') this.fireEvent(it.ev);
      else if (it.kind === 'deploy' && it.auto) this.deployNext(true);
      else if (it.kind === 'burn') this.executeScheduledBurn(it);
    }
    this.processTasks();
    const sun = sunDir(s.t, s.sunLon);
    for (const sat of s.sats) if (sat.deployed && sat.alive) this.stepSat(sat, dt, sun);
    this.stepNetwork(dt);
    if (Math.floor(s.t / 30) !== Math.floor((s.t - dt) / 30)) this.screenConjunctions();
    this.checkConjunctionPasses();
    if (s.storm && s.t >= s.storm.start && s.t <= s.storm.end) this.stormEffects(dt);
    if (s.mode === 'ai') {
      s.stats.aiTime += dt;
      s.agentTimer += dt;
      if (s.agentTimer >= 20) { s.agentTimer = 0; runAgents(this); }
    }
    for (const d of s.decisions) if (d.status === 'pending' && d.expires && s.t > d.expires) { d.status = 'expired'; this.log('warn', `Recommendation expired: ${d.title}`); }
    this.evaluateObjectives(dt);
  }

  stepSat(sat, dt, sun) {
    const d = this.design, st = this.pos(sat.el);
    const alt = v3.len(st.r) - RE;
    if (alt < 120) { this.loseSat(sat, 'Re-entered the atmosphere'); return; }
    // power
    const ecl = inEclipse(st.r, sun);
    if (sat.eclipse && !ecl) s_eclipseExit(this, sat);
    sat.eclipse = ecl;
    const stormFactor = this.s.storm && this.s.t >= this.s.storm.start && this.s.t <= this.s.storm.end ? 0.85 : 1;
    const sunBoost = d.sensors.includes('sun_sensor') ? 1.05 : 1;
    sat.gen = ecl ? 0 : d.panelArea * SOLAR_CONST * CELL_EFF * PANELS[d.panelType].eff * sat.solarEff * sunBoost * stormFactor * (sat.safeMode ? 0.9 : 1);
    const bus = BUSES[d.bus];
    const sensorsP = d.sensors.length * 2.5;
    const heater = ecl ? 8 * (d.alloc.thermal / 100) * 3 : 0;
    const payloadP = sat.payloadOn && sat.payload === 'ok' && !sat.safeMode ? PAYLOADS[d.payload].power : 0;
    const commsP = sat.inContact && sat.comms !== 'lost' ? COMMS[d.comms].power : COMMS[d.comms].power * 0.1;
    let load = bus.busPower * (sat.loadShed ? 0.7 : 1) + sensorsP * (sat.loadShed ? 0.5 : 1) + heater + payloadP + commsP + sat.extraLoad;
    if (sat.safeMode) load = bus.busPower * 0.6 + heater + sat.extraLoad * 0.5;
    sat.load = load;
    sat.battery = Math.min(sat.batteryCap, sat.battery + ((sat.gen - load) * dt) / 3600);
    const pct = (sat.battery / sat.batteryCap) * 100;
    sat.minBattPct = Math.min(sat.minBattPct, pct);
    if (sat.battery <= 0) {
      sat.battery = 0;
      if (!sat.safeMode) { sat.safeMode = true; sat.payloadOn = false; this.log('crit', `${sat.name}: battery depleted — autonomous hardware safe mode engaged.`); }
      sat.lowBattT += dt;
      sat.health = Math.max(0, sat.health - dt * 0.02);
      if (sat.lowBattT > 1800) this.loseSat(sat, 'Prolonged battery depletion — thermal loss of vehicle');
    } else sat.lowBattT = 0;
    // payload data
    if (payloadP > 0 && sat.sensor === 'ok') {
      const rate = PAYLOADS[d.payload].rate * (d.alloc.payload / 50);
      sat.dataStored += rate * dt;
      this.s.stats.collected += rate * dt;
      this.s.stats.payloadTime += dt;
    }
    // comms / ground contact
    let best = null;
    if (sat.comms !== 'lost') {
      for (const gs of STATIONS) {
        if (this.s.stationsDown[gs.id] && this.s.stationsDown[gs.id] > this.s.t) continue;
        const el = elevation(gs, st.r, this.s.t);
        if (el > 5 && (!best || el > best.el)) best = { id: gs.id, el };
      }
    }
    sat.inContact = best ? best.id : null;
    if (best) {
      this.s.contacted[best.id] = true;
      const rate = COMMS[d.comms].rate * (sat.comms === 'degraded' || sat.commsBackup ? 0.3 : 1) * (0.5 + d.alloc.comms / 60);
      const tx = Math.min(sat.dataStored, rate * dt * 8);
      sat.dataStored -= tx; sat.dataDown += tx; this.s.stats.downlink += tx;
    }
    // natural decay for low orbits (drag) — tiny semi-major axis loss
    if (alt < 500) sat.el = { ...sat.el, a: sat.el.a - dt * (500 - alt) * 1.2e-7 };
  }

  stepNetwork(dt) {
    // Network connectivity: a satellite is "linked" if it has ground contact or an
    // inter-satellite path (line of sight, < 5000 km) to one that does. Relay payload extends range.
    const sats = this.aliveSats();
    if (!sats.length) return;
    const range = this.design.payload === 'relay' ? 10000 : 6000;
    const pos = new Map(sats.map((x) => [x.id, this.pos(x.el).r]));
    const linked = new Set(sats.filter((x) => x.inContact && x.comms !== 'lost').map((x) => x.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of sats) {
        if (linked.has(a.id) || a.comms === 'lost') continue;
        for (const b of sats) {
          if (!linked.has(b.id)) continue;
          const ra = pos.get(a.id), rb = pos.get(b.id);
          if (v3.len(v3.sub(ra, rb)) < range && lineOfSight(ra, rb)) { linked.add(a.id); changed = true; break; }
        }
      }
    }
    for (const x of sats) x.linked = linked.has(x.id);
    this.s.linkedFrac = linked.size / Math.max(1, this.s.sats.length);
    const need = this.s.objectives.find((o) => o.type === 'network' && !o.done)?.frac ?? 1;
    if (this.deployedSats().length === this.s.sats.length && this.s.linkedFrac >= need - 1e-9) this.s.stats.networkTime += dt;
  }

  // ---------------------------------------------------------------- events
  pickTarget(ev) {
    const alive = this.aliveSats();
    const pool = alive.length ? alive : this.s.sats;
    if (typeof ev.target === 'number') return pool[Math.min(ev.target, pool.length - 1)];
    return pool[Math.floor(ev.targetRoll * pool.length)];
  }

  fireEvent(ev) {
    const s = this.s, sat = this.pickTarget(ev);
    const id = nid('ev');
    const add = (msg, sev, resolve) => {
      s.activeEvents.push({ id, type: ev.type, sat: sat?.id, t: s.t, msg, resolved: !resolve, resolveBy: resolve || null });
      this.log(sev, msg, { event: ev.type, sat: sat?.id });
    };
    if (sat && !sat.deployed && ev.type !== 'gs_outage' && ev.type !== 'solar_storm') {
      // retry later once satellites are deployed
      s.scheduled.push({ t: s.t + 120, kind: 'event', ev });
      s.scheduled.sort((a, b) => a.t - b.t);
      return;
    }
    switch (ev.type) {
      case 'sensor_fault': sat.sensor = 'fault'; add(`${sat.name}: attitude sensor fault — payload data invalid.`, 'warn', ['sensor_reset']); break;
      case 'comms_loss': sat.comms = 'lost'; add(`${sat.name}: transceiver unresponsive — communication lost.`, 'crit', ['comms_reboot', 'comms_backup']); break;
      case 'battery_degrade': sat.batteryCap *= ev.factor || 0.65; sat.battery = Math.min(sat.battery, sat.batteryCap); sat.health -= 5; add(`${sat.name}: battery cell failure — capacity reduced to ${sat.batteryCap.toFixed(0)} Wh.`, 'warn'); break;
      case 'solar_degrade': sat.solarEff *= ev.factor || 0.55; add(`${sat.name}: solar array drive misalignment — output at ${(sat.solarEff * 100).toFixed(0)}%.`, 'warn', ['panel_realign']); break;
      case 'power_shortage': sat.extraLoad += ev.watts || 60; add(`${sat.name}: heater relay stuck ON — +${ev.watts || 60} W unplanned load.`, 'warn', ['heater_reset']); break;
      case 'prop_fault': if (sat.prop === 'ok') { sat.prop = 'fault'; add(`${sat.name}: primary thruster valve fault — propulsion offline.`, 'crit', ['prop_backup']); } break;
      case 'payload_fail': if (sat.payload === 'ok') { sat.payload = 'fault'; sat.payloadOn = false; add(`${sat.name}: payload electronics fault.`, 'warn', ['payload_reset']); } break;
      case 'orbit_deviation': {
        const dv = ev.dv || this.rng.range(12, 25);
        sat.el = applyBurn(sat.el, s.t, this.rng.chance(0.5) ? 'retrograde' : 'radial', dv);
        add(`${sat.name}: unplanned thruster firing — orbit perturbed by ${dv.toFixed(1)} m/s. Perigee now ${perigeeAlt(sat.el).toFixed(0)} km.`, 'warn');
        break;
      }
      case 'gs_outage': {
        const gs = STATIONS[Math.floor(ev.targetRoll * STATIONS.length)];
        const n = ev.stations || 3;
        for (let k = 0; k < n; k++) s.stationsDown[STATIONS[(STATIONS.indexOf(gs) + k) % STATIONS.length].id] = s.t + (ev.duration || 3600);
        s.activeEvents.push({ id, type: 'gs_outage', t: s.t, msg: `${n} ground stations offline (power failure at ${gs.name} network).`, resolved: true });
        this.log('warn', `Ground segment outage: ${n} stations offline for ${((ev.duration || 3600) / 60).toFixed(0)} min. Use inter-satellite links.`, { event: 'gs_outage' });
        break;
      }
      case 'solar_storm': {
        s.storm = { start: s.t + (ev.lead || 600), end: s.t + (ev.lead || 600) + (ev.duration || 1800) };
        s.activeEvents.push({ id, type: 'solar_storm', t: s.t, msg: `Solar particle event predicted in ${((ev.lead || 600) / 60).toFixed(0)} min. Safe-mode satellites to protect electronics.`, resolved: true });
        this.log('crit', `NOAA-style space weather alert: proton storm arriving T+${((ev.lead || 600) / 60).toFixed(0)} min, lasting ${((ev.duration || 1800) / 60).toFixed(0)} min.`, { event: 'solar_storm' });
        break;
      }
      case 'debris': this.spawnConjunction(sat, ev); break;
      default: break;
    }
  }

  stormEffects(dt) {
    for (const sat of this.aliveSats()) {
      if (!sat.safeMode) {
        sat.health = Math.max(0, sat.health - dt * 0.008);
        if (this.rng.chance(dt * 0.0004) && sat.sensor === 'ok') { sat.sensor = 'fault'; this.s.activeEvents.push({ id: nid('ev'), type: 'sensor_fault', sat: sat.id, t: this.s.t, msg: `${sat.name}: single-event upset in sensor electronics.`, resolved: false, resolveBy: ['sensor_reset'] }); this.log('warn', `${sat.name}: radiation upset — sensor fault.`); }
        if (sat.health <= 0) this.loseSat(sat, 'Radiation damage');
      }
    }
  }

  spawnConjunction(sat, ev) {
    const s = this.s;
    const lead = ev.lead || this.rng.range(2400, 4200);
    const tca = s.t + lead;
    const st = this.pos(sat.el, tca);
    let el, tries = 0;
    do { el = this.makeThreatOrbit(sat, ev, st, tca); tries++; } while (tries < 10 && this.aliveSats().some((x) => screenPair(x.el, el, s.t, 900, 20).d < 5));
    const deb = { id: `DEB-${Math.floor(this.rng.range(20000, 49999))}`, name: ev.name || 'DEB-PENDING', kind: 'threat', el, sizeCm: Math.floor(this.rng.range(10, 90)) };
    if (deb.name === 'DEB-PENDING') deb.name = deb.id;
    s.debris.push(deb);
    this.log('info', `Space surveillance catalogued new object ${deb.id} (${deb.sizeCm} cm).`, { event: 'debris' });
  }

  makeThreatOrbit(sat, ev, st, tca) {
    const ang = (ev.crossDeg || this.rng.range(20, 160)) * DEG;
    const rh = v3.norm(st.r);
    // Rodrigues rotation of velocity around radial axis
    const v = st.v, k = rh, c = Math.cos(ang), sn = Math.sin(ang);
    const kxv = v3.cross(k, v), kdv = v3.dot(k, v);
    const vr = v3.add(v3.add(v3.scale(v, c), v3.scale(kxv, sn)), v3.scale(k, kdv * (1 - c)));
    const miss = ev.miss ?? this.rng.range(0.05, 0.6);
    const hh = v3.norm(v3.cross(st.r, st.v));
    const r2 = v3.add(st.r, v3.scale(hh, miss));
    return stateToElements(r2, vr, tca);
  }

  screenConjunctions() {
    const s = this.s;
    const horizon = (this.design.sensors.includes('proximity') ? 2 : 1) * 2700;
    const sats = this.aliveSats();
    const objs = [...s.debris.map((d) => ({ ...d, isDebris: true })), ...sats.map((x) => ({ id: x.id, name: x.name, el: x.el, isDebris: false }))];
    for (const sat of sats) {
      const pa = perigeeAlt(sat.el), aa = apogeeAlt(sat.el);
      for (const o of objs) {
        if (o.id === sat.id) continue;
        if (!o.isDebris && o.id < sat.id) continue; // sat-sat once
        const op = perigeeAlt(o.el), oa = apogeeAlt(o.el);
        if (op > aa + 30 || oa < pa - 30) continue;
        const existing = s.conjunctions.find((c) => c.a === sat.id && c.b === o.id && c.status === 'open');
        const r = screenPair(sat.el, o.el, s.t, horizon, 30);
        if (r.d < (o.isDebris ? 25 : 2) && r.tca > s.t + 60) {
          const sigma = (this.design.sensors.includes('gps') ? 0.15 : 0.35) * (1 + (r.tca - s.t) / 3600);
          if (existing) { Object.assign(existing, { d: r.d, tca: r.tca, sigma, risk: o.isDebris ? riskLevel(r.d) : 'proximity', relSpeed: r.relSpeed }); if (['high', 'critical'].includes(existing.risk)) existing.wasHigh = true; continue; }
          const c = { id: nid('cj'), a: sat.id, b: o.id, bName: o.name, bKind: o.isDebris ? 'debris' : 'satellite', d: r.d, tca: r.tca, sigma, relSpeed: r.relSpeed, risk: o.isDebris ? riskLevel(r.d) : 'proximity', status: 'open', detected: s.t, actions: [] };
          c.wasHigh = ['high', 'critical'].includes(c.risk);
          s.conjunctions.push(c);
          if (c.risk === 'proximity') { this.log('info', `Fleet proximity watch: ${sat.name} × ${o.name} ${r.d.toFixed(2)} km in ${((r.tca - s.t) / 60).toFixed(0)} min.`); continue; }
          this.log(c.risk === 'critical' || c.risk === 'high' ? 'crit' : 'warn', `CONJUNCTION: ${sat.name} × ${o.name} — predicted miss ${r.d.toFixed(2)} km in ${((r.tca - s.t) / 60).toFixed(0)} min (${c.risk.toUpperCase()}).`, { conj: c.id });
        } else if (existing && r.d >= 25) {
          existing.status = 'resolved'; existing.d = r.d;
          if (existing.wasHigh) s.stats.avoided++;
          this.log('good', `Conjunction ${sat.name} × ${o.name} cleared — new miss distance > 25 km.`);
        }
      }
    }
  }

  checkConjunctionPasses() {
    const s = this.s;
    for (const c of s.conjunctions) {
      if (c.status !== 'open' || s.t < c.tca) continue;
      const a = this.sat(c.a);
      const bObj = s.debris.find((d) => d.id === c.b) || this.sat(c.b);
      if (!a || !bObj || !a.alive) { c.status = 'passed'; continue; }
      const r = screenPair(a.el, bObj.el, c.tca - 120, 240, 5);
      c.finalD = r.d;
      const fatal = FATAL_KM;
      if (bObj.idx !== undefined) {
        // Own-fleet proximity: formation-flying close approaches are informational in ALUNA.
        c.status = 'proximity';
        this.log('info', `Fleet proximity: ${a.name} passed ${bObj.name} at ${r.d.toFixed(2)} km.`);
      } else if (r.d < fatal) {
        c.status = 'collision';
        s.stats.collisions++;
        this.loseSat(a, `Collision with ${c.bName} (miss ${r.d.toFixed(2)} km < ${fatal} km exclusion zone)`);
        if (bObj.idx !== undefined) this.loseSat(bObj, `Collision with ${a.name}`);
      } else if (r.d < 5) {
        c.status = 'near_miss'; s.stats.nearMiss++;
        a.health = Math.max(0, a.health - 8);
        this.log('warn', `Near miss: ${a.name} passed ${c.bName} at ${r.d.toFixed(2)} km.`);
      } else {
        c.status = 'resolved'; if (c.wasHigh) s.stats.avoided++;
        this.log('good', `${a.name} safely passed ${c.bName} at ${r.d.toFixed(1)} km.`);
      }
    }
  }

  loseSat(sat, why) {
    if (!sat.alive) return;
    sat.alive = false; sat.payloadOn = false; sat.health = 0;
    this.log('crit', `LOSS OF VEHICLE: ${sat.name} — ${why}.`);
  }

  // ---------------------------------------------------------------- tasks (timed operations)
  processTasks() {
    const s = this.s;
    s.tasks = s.tasks.filter((tk) => {
      if (s.t < tk.until) return true;
      const sat = this.sat(tk.sat);
      if (!sat || !sat.alive) return false;
      const ok = this.rng.next() < tk.p;
      tk.done(sat, ok);
      sat.busy = null;
      return false;
    });
  }

  addTask(sat, label, secs, p, done) {
    sat.busy = label;
    this.s.tasks.push({ sat: sat.id, label, until: this.s.t + secs, p, done });
  }

  resolveEvents(sat, type) {
    for (const e of this.s.activeEvents) if (!e.resolved && e.sat === sat.id && e.resolveBy?.includes(type)) { e.resolved = true; e.resolvedAt = this.s.t; this.s.stats.resolved++; e.resolvedType = e.type; }
  }

  // ---------------------------------------------------------------- deployment & burns
  deployNext(auto = false) {
    const sat = this.s.sats.find((x) => !x.deployed);
    if (!sat) return { ok: false, msg: 'All satellites already deployed.' };
    const st = this.pos(this.s.stage.el);
    // spring separation: small prograde/radial kick, unique per satellite
    const kick = v3.add(v3.scale(v3.norm(st.v), (0.5 + 0.12 * sat.idx) / 1000 * (sat.idx % 2 ? -1 : 1)), v3.scale(v3.norm(st.r), 0.0003));
    sat.el = stateToElements(st.r, v3.add(st.v, kick), this.s.t);
    if (this.mission.phased) {
      // Phasing dispenser: each spacecraft is released into its own slot (time-compressed drift phasing).
      const n = this.s.sats.length;
      sat.el = { ...sat.el, M: wrap(sat.el.M + (2 * Math.PI * sat.idx) / n) };
    }
    sat.deployed = true;
    sat.initAlt = perigeeAlt(sat.el);
    sat.payloadOn = this.design.payload !== 'none' && this.mission.autoPayload !== false;
    this.log('good', `${sat.name} separated from upper stage${auto ? '' : ' (manual command)'} — orbit ${perigeeAlt(sat.el).toFixed(0)}×${apogeeAlt(sat.el).toFixed(0)} km.`);
    return { ok: true, msg: `${sat.name} deployed.` };
  }

  /** Safety validator: every manoeuvre passes here before it touches the simulation. */
  validateBurn(sat, newEl, dvMs) {
    const errs = [];
    if (!sat.deployed || !sat.alive) errs.push('Satellite not operational.');
    if (sat.prop === 'none') errs.push('No propulsion installed.');
    if (sat.prop === 'fault') errs.push('Propulsion offline — switch to backup thruster first.');
    if (sat.safeMode) errs.push('Satellite in safe mode — exit safe mode before manoeuvring.');
    const maxDv = this.maxDvPerBurn();
    if (dvMs > maxDv + 1e-6) errs.push(`Δv ${dvMs.toFixed(2)} m/s exceeds per-burn limit of ${maxDv} m/s for ${PROPULSION[this.design.propulsion].label}.`);
    const mass = sat.dryMass + sat.fuel;
    const need = propellantFor(mass, dvMs, this.ispOf(sat));
    if (need > sat.fuel + 1e-9) errs.push(`Insufficient propellant: need ${need.toFixed(2)} kg, have ${sat.fuel.toFixed(2)} kg.`);
    if (newEl && perigeeAlt(newEl) < 180) errs.push(`Resulting perigee ${perigeeAlt(newEl).toFixed(0)} km is below 180 km safety floor.`);
    if (newEl) {
      for (const o of [...this.s.debris, ...this.aliveSats().filter((x) => x.id !== sat.id)]) {
        const op = perigeeAlt(o.el), oa = apogeeAlt(o.el);
        if (op > apogeeAlt(newEl) + 30 || oa < perigeeAlt(newEl) - 30) continue;
        const r = screenPair(newEl, o.el, this.s.t + 30, 5400, 60);
        if (r.d < (o.idx !== undefined ? 0.05 : 2)) { errs.push(`Post-burn orbit creates conjunction with ${o.name} (${r.d.toFixed(2)} km).`); break; }
      }
    }
    return { ok: errs.length === 0, errs, need };
  }

  doBurn(sat, dir, dvMs, tag = 'manual', vec = null) {
    if (!(dvMs > 0)) return { ok: false, msg: 'Δv must be positive.' };
    let newEl;
    if (vec) { const st = this.pos(sat.el); newEl = stateToElements(st.r, v3.add(st.v, vec), this.s.t); }
    else newEl = applyBurn(sat.el, this.s.t, dir, dvMs);
    const v = this.validateBurn(sat, newEl, dvMs);
    if (!v.ok) { this.log('warn', `Burn rejected by safety validator (${sat.name}): ${v.errs.join(' ')}`); return { ok: false, msg: v.errs.join(' ') }; }
    sat.el = newEl;
    sat.fuel -= v.need;
    this.s.stats.burns++; this.s.stats.dvUsed += dvMs;
    this.log('good', `${sat.name}: ${dir} burn ${dvMs.toFixed(2)} m/s executed (${tag}). Orbit ${perigeeAlt(newEl).toFixed(0)}×${apogeeAlt(newEl).toFixed(0)} km, fuel ${sat.fuel.toFixed(2)} kg.`);
    this.rescreen(sat);
    return { ok: true, msg: `Burn executed: ${dvMs.toFixed(2)} m/s ${dir}.` };
  }

  rescreen(sat) {
    for (const c of this.s.conjunctions) {
      if (c.status !== 'open' || (c.a !== sat.id && c.b !== sat.id)) continue;
      const other = this.s.debris.find((d) => d.id === c.b) || this.sat(c.a === sat.id ? c.b : c.a);
      const me = this.sat(c.a);
      if (!other || !me) continue;
      const r = screenPair(me.el, other.el, this.s.t, Math.max(600, c.tca - this.s.t + 900), 20);
      c.d = r.d; c.tca = r.tca; if (c.risk !== 'proximity') c.risk = riskLevel(r.d);
      if (r.d >= 5) { c.status = 'resolved'; c.mitigated = true; if (c.wasHigh) this.s.stats.avoided++; this.log('good', `Avoidance successful: ${me.name} × ${c.bName} miss distance now ${r.d.toFixed(1)} km.`); }
    }
  }

  /** Deterministic avoidance planner — searches minimal along-track Δv yielding ≥ 8 km miss. */
  planAvoidance(conjId) {
    const c = this.s.conjunctions.find((x) => x.id === conjId);
    if (!c || c.status !== 'open') return null;
    const sat = this.sat(c.a), other = this.s.debris.find((d) => d.id === c.b) || this.sat(c.b);
    if (!sat || !other) return null;
    const maxDv = Math.min(this.maxDvPerBurn(), 30);
    const options = [];
    for (const dir of ['prograde', 'retrograde', 'radial']) {
      for (let dv = 0.1; dv <= maxDv + 1e-9; dv += dv < 1 ? 0.1 : 0.5) {
        const el = applyBurn(sat.el, this.s.t, dir, dv);
        const r = screenPair(el, other.el, this.s.t, Math.max(600, c.tca - this.s.t + 900), 20);
        if (r.d >= 8 || (dv >= maxDv - 1e-9 && r.d >= 5)) {
          const v = this.validateBurn(sat, el, dv);
          if (v.ok) { options.push({ dir, dv: +dv.toFixed(2), miss: r.d, fuel: v.need }); break; }
        }
      }
    }
    options.sort((a, b) => a.dv - b.dv);
    return options[0] ? { conj: c.id, sat: sat.id, ...options[0], alternatives: options.slice(1) } : { conj: c.id, sat: sat.id, none: true };
  }

  executeScheduledBurn(it) {
    const sat = this.sat(it.sat);
    if (!sat?.alive) return;
    let dv = it.dv, dir = it.dir;
    let vec = null;
    if (it.circularize) {
      const r = this.circularizeDv(sat); dv = r.dv; dir = 'circularize'; vec = r.vec;
      if (dv > this.maxDvPerBurn()) { vec = v3.scale(vec, this.maxDvPerBurn() / dv); dv = this.maxDvPerBurn(); }
    }
    const res = this.doBurn(sat, dir, dv, it.tag || 'scheduled', vec);
    if (!res.ok) this.log('warn', `Scheduled burn for ${sat.name} aborted: ${res.msg}`);
  }

  /** Deterministic transfer planner: bisection on burn magnitude so the opposite apsis hits the target radius. */
  planTransfer(sat, altKm) {
    const r2 = RE + altKm;
    const st = this.pos(sat.el);
    const r1 = v3.len(st.r);
    if (Math.abs(r2 - r1) < 3) return { ok: false, msg: 'Already at target altitude — use Circularize.' };
    const raising = r2 > r1;
    const apsis = (el) => (raising ? el.a * (1 + el.e) : el.a * (1 - el.e));
    const cur = apsis(this.s.sats.length && sat.el);
    const dir = raising ? (cur < r2 ? 'prograde' : 'retrograde') : (cur > r2 ? 'retrograde' : 'prograde');
    // apsis grows with prograde Δv and shrinks with retrograde Δv (monotonic) → bisection
    const grows = dir === 'prograde';
    let lo = 0, hi = 600;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      const ap = apsis(applyBurn(sat.el, this.s.t, dir, mid));
      if (grows ? ap < r2 : ap > r2) lo = mid; else hi = mid;
    }
    const dv = (lo + hi) / 2;
    if (dv > this.maxDvPerBurn() + 1e-6) return { ok: false, msg: `Transfer needs ${dv.toFixed(1)} m/s but the per-burn limit is ${this.maxDvPerBurn()} m/s. Use repeated ${dir} burns.` };
    const el = applyBurn(sat.el, this.s.t, dir, dv);
    const n = Math.sqrt(MU / el.a ** 3);
    const target = raising ? Math.PI : 0;
    const tof = wrap(target - el.M) / n || Math.PI / n;
    return { ok: true, dir, dv, tof, el };
  }

  /** Along-track arc distances (km) between consecutive satellites ordered by argument of latitude. */
  alongTrackGaps(sats) {
    const ref = sats[0];
    const st0 = this.pos(ref.el);
    const n = v3.norm(v3.cross(st0.r, st0.v));
    const x = v3.norm(st0.r), y = v3.cross(n, x);
    const ang = sats.map((sat) => { const r = this.pos(sat.el).r; return { a: Math.atan2(v3.dot(r, y), v3.dot(r, x)), rr: v3.len(r) }; }).sort((p, q) => p.a - q.a);
    const gaps = [];
    for (let k = 0; k + 1 < ang.length; k++) gaps.push((ang[k + 1].a - ang[k].a) * (ang[k].rr + ang[k + 1].rr) / 2);
    // drop the largest gap (the open end of the string)
    if (gaps.length) {
      const wrapGap = (2 * Math.PI - (ang[ang.length - 1].a - ang[0].a)) * ang[0].rr;
      const all = [...gaps, wrapGap];
      all.splice(all.indexOf(Math.max(...all)), 1);
      return all;
    }
    return gaps;
  }

  circularizeDv(sat) {
    const st = this.pos(sat.el);
    const rm = v3.len(st.r);
    const hhat = v3.norm(v3.cross(st.r, st.v));
    const vc = v3.scale(v3.norm(v3.cross(hhat, st.r)), Math.sqrt(MU / rm));
    const vec = v3.sub(vc, st.v);
    return { dir: 'vector', vec, dv: v3.len(vec) * 1000 };
  }

  // ---------------------------------------------------------------- objectives
  evaluateObjectives(dt) {
    const s = this.s, objs = s.objectives;
    const dep = this.deployedSats(), alive = this.aliveSats();
    const pick = (o) => (o.sat === undefined || o.sat === 'all' ? alive : alive.filter((x) => x.idx === o.sat));
    const inBand = (x, o) => { const p = perigeeAlt(x.el), a = apogeeAlt(x.el); return p >= o.min && a <= o.max; };
    for (const o of objs) {
      if (o.done || o.failed) continue;
      if (o.afterT && s.t < o.afterT) { o.waiting = true; continue; }
      o.waiting = false;
      switch (o.type) {
        case 'deploy': o.progress = dep.length / o.count; if (dep.length >= o.count) o.done = true; break;
        case 'alt_hold': {
          const set = pick(o);
          const ok = set.length > 0 && (o.sat !== undefined && o.sat !== 'all' ? true : dep.length >= (o.need || 1)) && set.every((x) => inBand(x, o));
          o.acc = ok ? o.acc + dt : 0; o.progress = o.acc / o.hold; if (o.acc >= o.hold) o.done = true; break;
        }
        case 'alt_target': {
          const set = pick(o);
          const ok = set.length > 0 && set.every((x) => Math.abs(perigeeAlt(x.el) - o.alt) <= o.tol && Math.abs(apogeeAlt(x.el) - o.alt) <= o.tol);
          o.progress = set.length ? Math.max(0, 1 - Math.min(...set.map((x) => Math.abs((perigeeAlt(x.el) + apogeeAlt(x.el)) / 2 - o.alt))) / Math.max(50, Math.abs(o.alt - (s.sats[0].initAlt || o.alt)))) : 0;
          if (ok) o.done = true; break;
        }
        case 'inc_target': { const set = pick(o); const ok = set.length && set.every((x) => Math.abs(x.el.i / DEG - o.inc) <= o.tol); if (ok) o.done = true; break; }
        case 'raise': { const set = pick(o); const ok = set.length && set.every((x) => perigeeAlt(x.el) - x.initAlt >= o.delta - 5); o.progress = set.length ? Math.min(1, Math.max(0, (perigeeAlt(set[0].el) - set[0].initAlt) / o.delta)) : 0; if (ok) o.done = true; break; }
        case 'battery_floor': { for (const x of alive) if ((x.battery / x.batteryCap) * 100 < o.pct && s.t > (o.grace || 0)) { o.failed = true; o.why = `${x.name} battery fell below ${o.pct}%`; } break; }
        case 'no_collision': if (s.stats.collisions > 0) { o.failed = true; o.why = 'A collision occurred'; } break;
        case 'eclipses': o.progress = s.stats.eclipses / o.count; if (s.stats.eclipses >= o.count && alive.length) o.done = true; break;
        case 'contact': { const n = Object.keys(s.contacted).length; o.progress = n / o.count; if (n >= o.count) o.done = true; break; }
        case 'downlink': o.progress = s.stats.downlink / o.mb; if (s.stats.downlink >= o.mb) o.done = true; break;
        case 'collect': o.progress = s.stats.collected / o.mb; if (s.stats.collected >= o.mb) o.done = true; break;
        case 'resolve': { const n = s.activeEvents.filter((e) => e.resolved && e.resolvedAt && (!o.event || e.type === o.event)).length; o.progress = n / o.count; if (n >= o.count) o.done = true; break; }
        case 'avoid': o.progress = s.stats.avoided / o.count; if (s.stats.avoided >= o.count && s.stats.collisions === 0) o.done = true; break;
        case 'survive_time': o.progress = s.t / o.secs; if (s.t >= o.secs && alive.length >= (o.min || 1)) o.done = true; break;
        case 'min_alive': if (dep.length === s.sats.length && alive.length < o.count) { o.failed = true; o.why = `Fewer than ${o.count} satellites operational`; } break;
        case 'formation': {
          // String-of-pearls: consecutive along-track separations within [minKm, maxKm].
          if (alive.length >= o.count) {
            const gaps = this.alongTrackGaps(alive);
            const bad = gaps.filter((g) => g < o.minKm || g > o.maxKm);
            o.err = gaps.length ? Math.max(...gaps.map((g) => (g < o.minKm ? o.minKm - g : g > o.maxKm ? g - o.maxKm : 0))) : 999;
            o.gaps = gaps.map((g) => Math.round(g));
            o.progress = Math.max(0, 1 - bad.length / Math.max(1, gaps.length)) * 0.6 + Math.min(1, o.acc / (o.hold || 300)) * 0.4;
            o.acc = bad.length === 0 ? o.acc + dt : 0;
            if (o.acc >= (o.hold || 300)) o.done = true;
          }
          break;
        }
        case 'fuel_reserve': break; // checked at completion
        case 'review': { const n = s.stats.approved + s.stats.rejected + s.stats.modified + (s.stats.acked || 0); o.progress = n / o.count; if (n >= o.count) o.done = true; break; }
        case 'network': o.progress = s.stats.networkTime / o.hold; if (s.stats.networkTime >= o.hold) o.done = true; break;
        case 'payload_time': o.progress = s.stats.payloadTime / o.secs; if (s.stats.payloadTime >= o.secs) o.done = true; break;
        case 'inspect': o.progress = s.stats.inspected.length / o.count; if (s.stats.inspected.length >= o.count) o.done = true; break;
      case 'authorize': if (s.stats.authorized) o.done = true; break;
        case 'ai_time': o.progress = s.stats.aiTime / o.secs; if (s.stats.aiTime >= o.secs) o.done = true; break;
        case 'storm_safe': if (s.storm && s.t > s.storm.end) { o.done = alive.length > 0 && alive.every((x) => x.health > (o.health || 60)); if (!o.done) { o.failed = true; o.why = 'Fleet damaged by solar storm'; } } break;
        default: break;
      }
      o.progress = Math.max(0, Math.min(1, o.progress || 0));
    }
    // Completion/failure
    const goals = objs.filter((o) => o.required !== false && !['battery_floor', 'no_collision', 'min_alive', 'fuel_reserve'].includes(o.type));
    const constraintsFailed = objs.filter((o) => o.required !== false && o.failed);
    if (constraintsFailed.length) return this.end(false, `Objective failed: ${constraintsFailed[0].label} — ${constraintsFailed[0].why || ''}`);
    if (dep.length === s.sats.length && alive.length === 0) return this.end(false, 'All satellites lost.');
    if (goals.every((o) => o.done)) {
      for (const o of objs.filter((x) => x.type === 'fuel_reserve')) {
        const avg = alive.reduce((a, x) => a + x.fuel / Math.max(1e-6, x.fuelCap), 0) / Math.max(1, alive.length) * 100;
        o.done = avg >= o.pct; o.progress = Math.min(1, avg / o.pct);
        if (!o.done && o.required !== false) { o.failed = true; o.why = `Average fuel ${avg.toFixed(0)}% < ${o.pct}%`; return this.end(false, `Objective failed: ${o.label}`); }
      }
      for (const o of objs.filter((x) => ['battery_floor', 'no_collision', 'min_alive'].includes(x.type))) o.done = !o.failed;
      return this.end(true, 'All mission objectives achieved.');
    }
    if (s.t >= this.mission.timeLimit) return this.end(false, 'Mission time expired before all objectives were completed.');
  }

  end(success, reason) {
    const s = this.s;
    if (s.ended) return;
    s.ended = true; s.status = success ? 'success' : 'failed'; s.endReason = reason;
    this.log(success ? 'good' : 'crit', `MISSION ${success ? 'COMPLETE' : 'FAILED'}: ${reason}`);
  }

  // ---------------------------------------------------------------- actions
  act(action, actor = {}) {
    const s = this.s;
    if (s.ended && action.type !== 'inspect') return { ok: false, msg: 'Mission has ended.' };
    if (actor.roles) {
      const perm = action.type === 'decision' ? (this.decisionRisk(action.id) === 'high' ? 'decision_high' : 'decision') : action.type;
      const allowed = actor.roles.some((r) => ROLE_PERMS[r]?.includes(perm));
      if (!allowed) return { ok: false, msg: `Your role cannot perform "${action.type}". Ask the ${roleFor(perm)}.` };
    }
    const sat = action.sat !== undefined ? this.sat(action.sat) : null;
    const needSat = () => { if (!sat) return 'Select a satellite.'; if (!sat.deployed) return `${sat.name} not deployed yet.`; if (!sat.alive) return `${sat.name} is lost.`; if (sat.busy) return `${sat.name} busy: ${sat.busy}.`; return null; };
    const who = actor.name ? ` [${actor.name}]` : '';
    switch (action.type) {
      case 'deploy': return this.deployNext(false);
      case 'burn': { const e = needSat(); if (e) return { ok: false, msg: e }; if (action.exitSafe && sat.safeMode && sat.battery > sat.batteryCap * 0.1) { sat.safeMode = false; this.log('info', `${sat.name}: exiting safe mode for manoeuvre.`); } return this.doBurn(sat, action.dir, +action.dv, `manual${who}`); }
      case 'circularize': { const e = needSat(); if (e) return { ok: false, msg: e }; const c = this.circularizeDv(sat); if (c.dv < 0.05) return { ok: false, msg: 'Orbit already circular here.' }; const k = Math.min(1, this.maxDvPerBurn() / c.dv); return this.doBurn(sat, 'circularize', c.dv * k, `circularize${who}`, v3.scale(c.vec, k)); }
      case 'plan_transfer': {
        const e = needSat(); if (e) return { ok: false, msg: e };
        const plan = this.planTransfer(sat, +action.alt);
        if (!plan.ok) return plan;
        const res = this.doBurn(sat, plan.dir, plan.dv, `transfer burn 1/2${who}`);
        if (!res.ok) return res;
        s.scheduled = s.scheduled.filter((x) => !(x.kind === 'burn' && x.sat === sat.id));
        s.scheduled.push({ t: s.t + plan.tof, kind: 'burn', sat: sat.id, circularize: true, tag: 'transfer burn 2/2 (circularize)' });
        s.scheduled.sort((a, b) => a.t - b.t);
        return { ok: true, msg: `Transfer started: ${plan.dv.toFixed(2)} m/s ${plan.dir}; circularization scheduled in ${(plan.tof / 60).toFixed(0)} min.` };
      }
      case 'plane_change': {
        const e = needSat(); if (e) return { ok: false, msg: e };
        const st = this.pos(sat.el);
        let dI = (+action.inc * DEG) - sat.el.i;
        const vmag = v3.len(st.v);
        let dvMs = Math.abs(2 * vmag * Math.sin(dI / 2)) * 1000;
        let partial = false;
        if (dvMs > this.maxDvPerBurn()) { dI = Math.sign(dI) * 2 * Math.asin(this.maxDvPerBurn() / 1000 / (2 * vmag)); dvMs = this.maxDvPerBurn(); partial = true; }
        // rotate velocity about the radius vector — performed at current point (effective at nodes)
        const lat = Math.asin(st.r[2] / v3.len(st.r)) / DEG;
        if (Math.abs(lat) > 5) return { ok: false, msg: `Plane change must be executed near a node (|lat| < 5°). Current latitude ${lat.toFixed(1)}°. Wait for the equator crossing.` };
        const k = v3.norm(st.r); const sign = st.v[2] >= 0 ? -1 : 1; const ang = sign * dI;
        const c = Math.cos(ang), sn = Math.sin(ang);
        const vr = v3.add(v3.add(v3.scale(st.v, c), v3.scale(v3.cross(k, st.v), sn)), v3.scale(k, v3.dot(k, st.v) * (1 - c)));
        let newEl = stateToElements(st.r, vr, s.t);
        if (Math.abs(newEl.i - +action.inc * DEG) > Math.abs(dI)) { const vr2 = v3.add(v3.add(v3.scale(st.v, c), v3.scale(v3.cross(k, st.v), -sn)), v3.scale(k, v3.dot(k, st.v) * (1 - c))); newEl = stateToElements(st.r, vr2, s.t); }
        const v = this.validateBurn(sat, newEl, dvMs);
        if (!v.ok) { this.log('warn', `Plane change rejected: ${v.errs.join(' ')}`); return { ok: false, msg: v.errs.join(' ') }; }
        sat.el = newEl; sat.fuel -= v.need; s.stats.burns++; s.stats.dvUsed += dvMs;
        this.log('good', `${sat.name}: ${partial ? 'partial ' : ''}plane change to ${(newEl.i / DEG).toFixed(2)}° (${dvMs.toFixed(1)} m/s)${who}.`);
        return { ok: true, msg: `${partial ? 'Partial plane change (per-burn limit) — repeat at next node. ' : ''}Plane change executed (${dvMs.toFixed(1)} m/s).` };
      }
      case 'plan_avoid': { const p = this.planAvoidance(action.conj); return p ? { ok: true, plan: p, msg: p.none ? 'No safe avoidance found within limits.' : `Plan: ${p.dir} ${p.dv} m/s → miss ${p.miss.toFixed(1)} km.` } : { ok: false, msg: 'Conjunction not open.' }; }
      case 'payload': { const e = needSat(); if (e) return { ok: false, msg: e }; if (sat.payload !== 'ok') return { ok: false, msg: 'Payload not available.' }; if (sat.safeMode) return { ok: false, msg: 'Exit safe mode first.' }; sat.payloadOn = !!action.on; this.log('info', `${sat.name}: payload ${sat.payloadOn ? 'ON' : 'OFF'}${who}.`); return { ok: true, msg: `Payload ${sat.payloadOn ? 'on' : 'off'}.` }; }
      case 'safe_mode': { const e = needSat(); if (e && !e.includes('busy')) return { ok: false, msg: e }; if (!action.on && sat.battery < sat.batteryCap * 0.1) return { ok: false, msg: 'Battery below 10% — safety rule keeps satellite in safe mode.' }; sat.safeMode = !!action.on; if (sat.safeMode) sat.payloadOn = false; this.log('info', `${sat.name}: safe mode ${sat.safeMode ? 'ENTERED' : 'EXITED'}${who}.`); return { ok: true, msg: `Safe mode ${sat.safeMode ? 'on' : 'off'}.` }; }
      case 'load_shed': { const e = needSat(); if (e) return { ok: false, msg: e }; sat.loadShed = !!action.on; this.log('info', `${sat.name}: non-essential loads ${sat.loadShed ? 'shed' : 'restored'}${who}.`); return { ok: true, msg: 'Load configuration updated.' }; }
      case 'sensor_reset': { const e = needSat(); if (e) return { ok: false, msg: e }; if (sat.sensor === 'ok') return { ok: false, msg: 'Sensor nominal.' }; this.addTask(sat, 'Sensor power-cycle', 120, 0.8, (x, ok) => { if (ok) { x.sensor = 'ok'; this.resolveEvents(x, 'sensor_reset'); this.log('good', `${x.name}: sensor restored.`); } else this.log('warn', `${x.name}: sensor reset failed — retry.`); }); this.log('info', `${sat.name}: sensor power-cycle started${who}.`); return { ok: true, msg: 'Sensor reset in progress (2 min).' }; }
      case 'comms_reboot': { const e = needSat(); if (e) return { ok: false, msg: e }; if (sat.comms !== 'lost') return { ok: false, msg: 'Comms not lost.' }; this.addTask(sat, 'Transceiver reboot (stored command)', 90, 0.65, (x, ok) => { if (ok) { x.comms = 'ok'; x.commsBackup = false; this.resolveEvents(x, 'comms_reboot'); this.log('good', `${x.name}: transceiver reboot successful.`); } else this.log('warn', `${x.name}: transceiver reboot failed.`); }); return { ok: true, msg: 'Reboot command queued (1.5 min).' }; }
      case 'comms_backup': { const e = needSat(); if (e) return { ok: false, msg: e }; if (sat.comms !== 'lost') return { ok: false, msg: 'Comms not lost.' }; sat.comms = 'degraded'; sat.commsBackup = true; this.resolveEvents(sat, 'comms_backup'); this.log('good', `${sat.name}: switched to backup low-gain antenna (30% data rate)${who}.`); return { ok: true, msg: 'Backup antenna active.' }; }
      case 'panel_realign': { const e = needSat(); if (e) return { ok: false, msg: e }; if (sat.solarEff >= 0.95) return { ok: false, msg: 'Array nominal.' }; this.addTask(sat, 'Array drive recalibration', 180, 0.9, (x, ok) => { if (ok) { x.solarEff = Math.max(x.solarEff, 0.88); this.resolveEvents(x, 'panel_realign'); this.log('good', `${x.name}: solar array realigned (${(x.solarEff * 100).toFixed(0)}%).`); } else this.log('warn', `${x.name}: realignment failed.`); }); return { ok: true, msg: 'Array recalibration (3 min).' }; }
      case 'heater_reset': { const e = needSat(); if (e) return { ok: false, msg: e }; if (sat.extraLoad <= 0) return { ok: false, msg: 'No stuck load.' }; this.addTask(sat, 'Heater relay reset', 60, 0.85, (x, ok) => { if (ok) { x.extraLoad = 0; this.resolveEvents(x, 'heater_reset'); this.log('good', `${x.name}: heater relay reset.`); } else this.log('warn', `${x.name}: relay reset failed.`); }); return { ok: true, msg: 'Relay reset (1 min).' }; }
      case 'prop_backup': { const e = needSat(); if (e) return { ok: false, msg: e }; if (sat.prop !== 'fault') return { ok: false, msg: 'Primary propulsion OK.' }; this.addTask(sat, 'Backup thruster priming', 90, 1, (x) => { x.prop = 'ok'; x.propBackup = true; this.resolveEvents(x, 'prop_backup'); this.log('good', `${x.name}: backup thruster branch active (Isp −20%).`); }); return { ok: true, msg: 'Priming backup thruster (1.5 min).' }; }
      case 'payload_reset': { const e = needSat(); if (e) return { ok: false, msg: e }; if (sat.payload !== 'fault') return { ok: false, msg: 'Payload nominal.' }; this.addTask(sat, 'Payload reboot', 150, 0.6, (x, ok) => { if (ok) { x.payload = 'ok'; this.resolveEvents(x, 'payload_reset'); this.log('good', `${x.name}: payload recovered.`); } else this.log('warn', `${x.name}: payload reboot failed — retry.`); }); return { ok: true, msg: 'Payload reboot (2.5 min).' }; }
      case 'set_mode': {
        if (!['manual', 'ai'].includes(action.mode)) return { ok: false, msg: 'Unknown mode.' };
        if (s.mode === action.mode) return { ok: true, msg: 'Mode unchanged.' };
        s.mode = action.mode; s.stats.modeSwitches++;
        if (s.mode === 'manual') for (const d of s.decisions) if (d.status === 'pending') { d.status = 'withdrawn'; }
        this.log('info', `Operation mode → ${s.mode === 'ai' ? 'AI-ASSISTED' : 'MANUAL'}${who}. Mission state preserved.`);
        return { ok: true, msg: `Mode: ${s.mode}` };
      }
      case 'decision': return this.resolveDecision(action.id, action.verdict, action.params, actor);
      case 'time_scale': s.timeScale = Math.max(1, Math.min(600, +action.x || 60)); return { ok: true, msg: `Time warp ×${s.timeScale}` };
      case 'pause': s.paused = !!action.on; return { ok: true, msg: s.paused ? 'Paused' : 'Resumed' };
      case 'inspect': if (sat && !s.stats.inspected.includes(sat.id) && sat.deployed) { s.stats.inspected.push(sat.id); this.log('info', `${sat.name} inspected${who}: health ${sat.health.toFixed(0)}%, battery ${(sat.battery / sat.batteryCap * 100).toFixed(0)}%.`); } return { ok: true, msg: 'Inspected.' };
      case 'checkout': if (!sat) return { ok: false, msg: 'Select a satellite.' }; sat.checkedOut = true; this.log('info', `${sat.name}: checkout complete — bus ${(sat.battery / sat.batteryCap * 100).toFixed(0)}% charge, health ${sat.health.toFixed(0)}%.`); return { ok: true, msg: 'Checkout complete.' };
      case 'authorize': s.stats.authorized = true; this.log('good', `Commander authorization recorded${who}: GO for operations.`); return { ok: true, msg: 'Authorized.' };
      case 'agent_toggle': if (action.agent in s.agentsEnabled) { s.agentsEnabled[action.agent] = !!action.on; this.log('info', `Agent ${action.agent} ${action.on ? 'enabled' : 'disabled'}${who}.`); return { ok: true, msg: 'Updated.' }; } return { ok: false, msg: 'Unknown agent.' };
      case 'abort': this.end(false, `Mission aborted by operator${who}.`); return { ok: true, msg: 'Aborted.' };
      default: return { ok: false, msg: `Unknown action ${action.type}` };
    }
  }

  decisionRisk(id) { return this.s.decisions.find((d) => d.id === id)?.risk; }

  /** Execute a decision's action through the same validated action paths a human uses. */
  executeDecision(d, params) {
    const a = { ...d.action, ...(params || {}) };
    return this.act(a);
  }

  resolveDecision(id, verdict, params, actor = {}) {
    const d = this.s.decisions.find((x) => x.id === id);
    if (d && verdict === 'ack' && (d.status === 'auto') && !d.reviewed) { d.reviewed = true; d.reviewedBy = actor.name || 'operator'; this.s.stats.acked = (this.s.stats.acked || 0) + 1; this.log('info', `Autonomous action reviewed${actor.name ? ' by ' + actor.name : ''}: ${d.title}`); return { ok: true, msg: 'Marked as reviewed.' }; }
    if (!d || d.status !== 'pending') return { ok: false, msg: 'Decision not pending.' };
    const who = actor.name ? ` by ${actor.name}` : '';
    if (verdict === 'reject') { d.status = 'rejected'; d.by = actor.name || 'operator'; this.s.stats.rejected++; this.log('info', `Recommendation rejected${who}: ${d.title}`); return { ok: true, msg: 'Rejected.' }; }
    const res = this.executeDecision(d, verdict === 'modify' ? params : null);
    if (!res.ok) { d.status = 'failed'; d.result = res.msg; this.log('warn', `Approved action failed validation: ${res.msg}`); return res; }
    d.status = verdict === 'modify' ? 'modified' : 'approved'; d.by = actor.name || 'operator'; d.result = res.msg;
    if (verdict === 'modify') this.s.stats.modified++; else this.s.stats.approved++;
    this.log('good', `Recommendation ${d.status}${who}: ${d.title}`);
    return res;
  }

  // ---------------------------------------------------------------- serialization
  serialize() { return JSON.parse(JSON.stringify({ s: this.s, rng: this.rng.state() })); }
  static restore(mission, design, data) {
    const e = new MissionEngine(mission, design, { seed: 'restore', mode: data.s.mode, squad: data.s.squad });
    e.s = data.s; e.rng.setState(data.rng);
    return e;
  }
}

function s_eclipseExit(engine, sat) {
  if (sat.battery > 0) engine.s.stats.eclipses += 1 / Math.max(1, engine.aliveSats().length);
}

function roleFor(perm) {
  for (const [r, p] of Object.entries(ROLE_PERMS)) if (p.includes(perm)) return ROLE_LABELS[r];
  return 'commander';
}

/** Distinct, transparent scoring. */
export function scoreMission(engine, elapsedRealSec) {
  const s = engine.s;
  const objs = s.objectives;
  const req = objs.filter((o) => o.required !== false);
  const opt = objs.filter((o) => o.required === false);
  const doneReq = req.filter((o) => o.done).length;
  const doneOpt = opt.filter((o) => o.done).length;
  const alive = s.sats.filter((x) => x.alive).length;
  const fuelLeft = s.sats.filter((x) => x.alive && x.fuelCap > 0).reduce((a, x) => a + x.fuel / x.fuelCap, 0) / Math.max(1, s.sats.filter((x) => x.alive && x.fuelCap > 0).length);
  const batt = s.sats.filter((x) => x.alive).reduce((a, x) => a + x.minBattPct, 0) / Math.max(1, alive);
  const lines = [
    { label: `Required objectives ${doneReq}/${req.length}`, pts: Math.round(600 * (doneReq / Math.max(1, req.length))) },
    { label: `Bonus objectives ${doneOpt}/${opt.length}`, pts: doneOpt * 100 },
    { label: `Satellites surviving ${alive}/${s.sats.length}`, pts: Math.round(200 * (alive / Math.max(1, s.sats.length))) },
    { label: `Propellant efficiency ${(fuelLeft * 100).toFixed(0)}% remaining`, pts: Math.round(100 * fuelLeft) },
    { label: `Power discipline (min battery ${batt.toFixed(0)}%)`, pts: Math.round(Math.min(100, batt)) },
    { label: `Time efficiency ${(100 * (1 - s.t / engine.mission.timeLimit)).toFixed(0)}% under limit`, pts: Math.round(150 * Math.max(0, 1 - s.t / engine.mission.timeLimit)) },
    { label: `Collision avoidance (${s.stats.avoided} cleared, ${s.stats.nearMiss} near-miss, ${s.stats.collisions} collision)`, pts: s.stats.avoided * 50 - s.stats.nearMiss * 25 - s.stats.collisions * 200 },
    { label: `Decisions reviewed (${s.stats.approved} approved, ${s.stats.modified} modified, ${s.stats.rejected} rejected, ${s.stats.acked || 0} auto-actions reviewed)`, pts: (s.stats.approved + s.stats.modified + s.stats.rejected) * 15 + (s.stats.acked || 0) * 5 },
    { label: `Events resolved: ${s.stats.resolved}`, pts: s.stats.resolved * 40 },
  ];
  if (s.status !== 'success') lines.push({ label: 'Mission failed — score halved', pts: 0, mult: 0.5 });
  let total = lines.reduce((a, l) => a + l.pts, 0);
  if (s.status !== 'success') total = Math.round(total * 0.5);
  total = Math.max(0, total);
  const stars = s.status !== 'success' ? 0 : total >= 1300 ? 3 : total >= 1000 ? 2 : 1;
  return { lines, total, stars, xp: Math.round(total / 5), alive, doneReq, reqCount: req.length, missed: objs.filter((o) => !o.done).map((o) => o.label), completed: objs.filter((o) => o.done).map((o) => o.label), simTime: s.t, realTime: elapsedRealSec };
}
