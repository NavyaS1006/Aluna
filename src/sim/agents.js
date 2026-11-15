// Autonomous Intelligence System — rule-based agents that observe the live mission
// state, follow safety rules and emit structured, explainable decisions.
// Low-risk actions auto-execute in AI-Assisted mode; medium/high risk need human approval.
// All manoeuvres are produced by deterministic planners and pass the engine safety validator.
import { perigeeAlt, apogeeAlt, RE } from './orbit.js';

export const AGENTS = {
  health: { name: 'Satellite Health Agent', icon: '✚', desc: 'Watches subsystem faults and vehicle health.' },
  power: { name: 'Power Management Agent', icon: '⚡', desc: 'Balances generation, loads and battery depth of discharge.' },
  comms: { name: 'Communication Agent', icon: '📡', desc: 'Monitors links and recovers lost transceivers.' },
  collision: { name: 'Collision Monitoring Agent', icon: '⚠', desc: 'Screens conjunctions and proposes avoidance burns.' },
  planning: { name: 'Mission Planning Agent', icon: '🧭', desc: 'Plans orbit changes toward mission targets.' },
  resource: { name: 'Resource Optimization Agent', icon: '⚖', desc: 'Schedules payload duty to maximise data return.' },
  fleet: { name: 'Fleet Coordination Agent', icon: '✦', desc: 'Coordinates deployment and fleet-wide protection.' },
};

let n = 0;

function propose(engine, key, agent, { title, action, reason, risk, confidence = 0.85, consequences, safety, ttl = 1800 }) {
  const s = engine.s;
  const recent = s.decisions.find((d) => d.key === key && (d.status === 'pending' || s.t - d.t < 600));
  if (recent) return null;
  const d = { id: `dc-${(++n).toString(36)}-${Math.floor(s.t)}`, key, agent, title, action, reason, risk, confidence, consequences, safety, status: 'pending', t: s.t, expires: s.t + ttl };
  s.decisions.push(d);
  if (s.decisions.length > 120) s.decisions.splice(0, s.decisions.length - 120);
  if (risk === 'low') {
    const res = engine.act(action);
    d.status = res.ok ? 'auto' : 'failed';
    d.by = 'agent';
    d.result = res.msg;
    if (res.ok) { s.stats.auto++; engine.log('ai', `[${AGENTS[agent].name}] auto-executed: ${title}`); }
  } else {
    engine.log('ai', `[${AGENTS[agent].name}] requests approval (${risk.toUpperCase()}): ${title}`);
  }
  return d;
}

export function runAgents(engine) {
  const s = engine.s, en = s.agentsEnabled;
  const alive = engine.aliveSats();
  for (const sat of alive) {
    const pct = (sat.battery / sat.batteryCap) * 100;
    if (sat.busy) continue;
    // ---- Health agent
    if (en.health) {
      if (sat.sensor === 'fault') propose(engine, `sensor:${sat.id}`, 'health', { title: `Power-cycle ${sat.name} attitude sensor`, action: { type: 'sensor_reset', sat: sat.id }, reason: 'Sensor telemetry flags invalid attitude solution; payload data is being corrupted.', risk: 'low', confidence: 0.8, consequences: '2-minute sensor outage, ~80% chance of recovery.', safety: 'No orbital change. Reversible.' });
      if (sat.payload === 'fault') propose(engine, `payload:${sat.id}`, 'health', { title: `Reboot ${sat.name} payload`, action: { type: 'payload_reset', sat: sat.id }, reason: 'Payload electronics reported a fault flag.', risk: 'low', confidence: 0.6, consequences: '2.5-minute reboot, ~60% success.', safety: 'Payload only.' });
      if (sat.extraLoad > 0) propose(engine, `heater:${sat.id}`, 'health', { title: `Reset stuck heater relay on ${sat.name}`, action: { type: 'heater_reset', sat: sat.id }, reason: `Unplanned ${sat.extraLoad.toFixed(0)} W thermal load detected.`, risk: 'low', consequences: 'Removes unplanned load if successful (85%).', safety: 'Thermal margins verified.' });
      if (sat.prop === 'fault') propose(engine, `prop:${sat.id}`, 'health', { title: `Switch ${sat.name} to backup thruster branch`, action: { type: 'prop_backup', sat: sat.id }, reason: 'Primary valve fault blocks all manoeuvres.', risk: 'medium', confidence: 0.95, consequences: 'Restores propulsion with 20% lower specific impulse (more fuel per burn).', safety: 'Irreversible for this mission. Requires approval.' });
    }
    // ---- Power agent
    if (en.power) {
      if (pct < 35 && sat.payloadOn) propose(engine, `payoff:${sat.id}`, 'power', { title: `Suspend ${sat.name} payload (battery ${pct.toFixed(0)}%)`, action: { type: 'payload', sat: sat.id, on: false }, reason: 'Battery below 35% with payload active; projected eclipse deficit.', risk: 'low', consequences: 'Stops data collection until battery recovers.', safety: 'Protects battery depth-of-discharge limit.' });
      if (pct < 30 && !sat.loadShed) propose(engine, `shed:${sat.id}`, 'power', { title: `Shed non-essential loads on ${sat.name}`, action: { type: 'load_shed', sat: sat.id, on: true }, reason: `Battery ${pct.toFixed(0)}% and falling (net ${(sat.gen - sat.load).toFixed(0)} W).`, risk: 'low', consequences: 'Reduces bus load ~30%.', safety: 'Essential bus kept powered.' });
      if (pct < 15 && !sat.safeMode) propose(engine, `safe:${sat.id}`, 'power', { title: `Command ${sat.name} into safe mode`, action: { type: 'safe_mode', sat: sat.id, on: true }, reason: `Battery critical at ${pct.toFixed(0)}%.`, risk: 'medium', confidence: 0.9, consequences: 'Payload and manoeuvres disabled until exit.', safety: 'Prevents deep discharge; requires approval because it pauses mission work.' });
      if (pct > 70 && sat.loadShed) propose(engine, `unshed:${sat.id}`, 'power', { title: `Restore loads on ${sat.name}`, action: { type: 'load_shed', sat: sat.id, on: false }, reason: 'Battery recovered above 70%.', risk: 'low', consequences: 'Full sensor suite back online.', safety: 'Margin verified.' });
      if (sat.solarEff < 0.8) propose(engine, `realign:${sat.id}`, 'power', { title: `Recalibrate ${sat.name} array drive`, action: { type: 'panel_realign', sat: sat.id }, reason: `Array output at ${(sat.solarEff * 100).toFixed(0)}% of nominal.`, risk: 'low', consequences: '3-minute recalibration, 90% success.', safety: 'No attitude risk.' });
    }
    // ---- Comms agent
    if (en.comms && sat.comms === 'lost') {
      propose(engine, `reboot:${sat.id}`, 'comms', { title: `Send stored reboot command to ${sat.name}`, action: { type: 'comms_reboot', sat: sat.id }, reason: 'No telemetry for > 1 pass; on-board timer reboot available.', risk: 'low', confidence: 0.65, consequences: '65% chance of full restoration.', safety: 'Standard recovery procedure.' });
      propose(engine, `backup:${sat.id}`, 'comms', { title: `Switch ${sat.name} to backup antenna`, action: { type: 'comms_backup', sat: sat.id }, reason: 'Guaranteed link at reduced (30%) data rate.', risk: 'medium', confidence: 0.98, consequences: 'Data return reduced to 30% for the rest of the mission.', safety: 'Irreversible configuration — approval required.' });
    }
    // ---- Resource agent
    if (en.resource && sat.payload === 'ok' && !sat.payloadOn && !sat.safeMode && pct > 65 && engine.design.payload !== 'none') {
      propose(engine, `payon:${sat.id}`, 'resource', { title: `Resume ${sat.name} payload operations`, action: { type: 'payload', sat: sat.id, on: true }, reason: `Battery ${pct.toFixed(0)}% — energy surplus available for data collection.`, risk: 'low', consequences: 'Increases data volume; payload draws extra power.', safety: 'Power agent will suspend if battery < 35%.' });
    }
    // ---- Planning agent: altitude targets / perigee floor
    if (en.planning && sat.prop === 'ok') {
      const tgt = s.objectives.find((o) => !o.done && o.type === 'alt_target' && (o.sat === undefined || o.sat === 'all' || o.sat === sat.idx));
      const mid = (perigeeAlt(sat.el) + apogeeAlt(sat.el)) / 2;
      const pA = perigeeAlt(sat.el), aA = apogeeAlt(sat.el);
      const offTarget = tgt && !(Math.abs(pA - tgt.alt) <= tgt.tol && Math.abs(aA - tgt.alt) <= tgt.tol);
      const pendingBurn = s.scheduled.some((x) => x.kind === 'burn' && x.sat === sat.id);
      const curAlt = Math.hypot(...engine.pos(sat.el).r) - RE;
      if (offTarget && !pendingBurn && pA <= tgt.alt + tgt.tol && aA >= tgt.alt - tgt.tol && Math.abs(curAlt - tgt.alt) < tgt.tol * 0.6) {
        propose(engine, `circ:${sat.id}:${Math.floor(s.t / 600)}`, 'planning', { title: `Circularize ${sat.name} at ${curAlt.toFixed(0)} km`, action: { type: 'circularize', sat: sat.id }, reason: `Orbit ${pA.toFixed(0)}×${aA.toFixed(0)} km straddles the ${tgt.alt} km target and the satellite is passing through it now.`, risk: 'high', confidence: 0.9, consequences: 'Single burn removes eccentricity.', safety: 'Validated by safety validator.', ttl: 120 });
      } else if (offTarget && !pendingBurn && (pA > tgt.alt + tgt.tol || aA < tgt.alt - tgt.tol)) {
        propose(engine, `xfer:${sat.id}:${tgt.alt}`, 'planning', { title: `Hohmann transfer ${sat.name} → ${tgt.alt} km`, action: { type: 'plan_transfer', sat: sat.id, alt: tgt.alt }, reason: `Objective "${tgt.label}" requires ${tgt.alt} km (now ${mid.toFixed(0)} km).`, risk: 'high', confidence: 0.92, consequences: 'Two-burn transfer; propellant consumed; conjunction screening runs on new orbit.', safety: 'Planner output verified by safety validator (perigee floor, propellant, conjunctions).' });
      }
      const itgt = s.objectives.find((o) => !o.done && o.type === 'inc_target' && (o.sat === undefined || o.sat === 'all' || o.sat === sat.idx));
      if (itgt && Math.abs(sat.el.i * 180 / Math.PI - itgt.inc) > itgt.tol && !s.scheduled.some((x) => x.kind === 'burn' && x.sat === sat.id)) {
        const r = engine.pos(sat.el).r;
        const lat = Math.asin(r[2] / Math.hypot(r[0], r[1], r[2])) * 180 / Math.PI;
        if (Math.abs(lat) < 4) propose(engine, `inc:${sat.id}:${Math.floor(s.t / 1200)}`, 'planning', { title: `Plane change ${sat.name} → ${itgt.inc}°`, action: { type: 'plane_change', sat: sat.id, inc: itgt.inc }, reason: `Satellite is crossing the equator (lat ${lat.toFixed(1)}°) — the efficient point for an inclination change. Objective "${itgt.label}".`, risk: 'high', confidence: 0.9, consequences: 'Large Δv burn normal to the orbit plane.', safety: 'Validated for propellant and perigee floor.', ttl: 240 });
      }
      if (perigeeAlt(sat.el) < 300 && !tgt) {
        propose(engine, `raise:${sat.id}`, 'planning', { title: `Raise ${sat.name} perigee`, action: { type: 'burn', sat: sat.id, dir: 'prograde', dv: Math.min(engine.maxDvPerBurn(), 10) }, reason: `Perigee ${perigeeAlt(sat.el).toFixed(0)} km — atmospheric drag will cause decay.`, risk: 'high', consequences: 'Uses propellant; raises apogee.', safety: 'Validated against conjunctions.' });
      }
    }
  }
  // ---- Collision agent
  if (en.collision) {
    for (const c of s.conjunctions) {
      if (c.status !== 'open' || c.bKind !== 'debris' || !['high', 'critical'].includes(c.risk)) continue;
      const plan = engine.planAvoidance(c.id);
      const sat = engine.sat(c.a);
      if (!plan || plan.none || !sat) { if (sat) propose(engine, `noplan:${c.id}`, 'collision', { title: `No safe avoidance for ${sat.name} — consider safe mode`, action: { type: 'safe_mode', sat: c.a, on: true }, reason: `Conjunction with ${c.bName} (${c.d.toFixed(2)} km) and no validated manoeuvre within propulsion limits.`, risk: 'high', consequences: 'Satellite rides out the encounter.', safety: 'Planner found no solution.' }); continue; }
      const mins = ((c.tca - s.t) / 60).toFixed(0);
      propose(engine, `avoid:${c.id}`, 'collision', {
        title: `Avoidance: ${sat.name} ${plan.dir} ${plan.dv} m/s`, action: { type: 'burn', sat: c.a, dir: plan.dir, dv: plan.dv, exitSafe: true },
        reason: `${c.bName} predicted to pass ${c.d.toFixed(2)} ± ${c.sigma.toFixed(2)} km from ${sat.name} in ${mins} min (relative speed ${c.relSpeed.toFixed(1)} km/s).`,
        risk: 'high', confidence: Math.max(0.5, 1 - c.sigma / 2), consequences: `Predicted miss distance after burn ${plan.miss.toFixed(1)} km. Propellant ${plan.fuel.toFixed(3)} kg.`,
        safety: 'Deterministic planner; validated for perigee floor, propellant and secondary conjunctions. Requires human approval.', ttl: Math.max(120, c.tca - s.t - 60),
      });
    }
  }
  // ---- Fleet agent: storm protection & deployment
  if (en.fleet) {
    if (s.storm && s.t > s.storm.start - 900 && s.t < s.storm.end) {
      for (const sat of alive) if (!sat.safeMode) propose(engine, `storm:${sat.id}`, 'fleet', { title: `Safe ${sat.name} for solar storm`, action: { type: 'safe_mode', sat: sat.id, on: true }, reason: 'Proton event inside window; safe mode protects electronics.', risk: 'medium', consequences: 'Payload paused during storm.', safety: 'Standard space-weather procedure.' });
    }
    if (s.storm && s.t > s.storm.end + 60) {
      for (const sat of alive) if (sat.safeMode && sat.battery / sat.batteryCap > 0.3) propose(engine, `unsafe:${sat.id}`, 'fleet', { title: `Return ${sat.name} to nominal operations`, action: { type: 'safe_mode', sat: sat.id, on: false }, reason: 'Storm has passed.', risk: 'low', consequences: 'Resumes operations.', safety: 'Battery > 30%.' });
    }
    const undeployed = s.sats.filter((x) => !x.deployed).length;
    if (undeployed && engine.mission.manualDeploy && !engine.mission.phased) propose(engine, `deploy:${undeployed}`, 'fleet', { title: 'Deploy next satellite', action: { type: 'deploy' }, reason: `${undeployed} satellites remain in the upper stage.`, risk: 'medium', consequences: 'Separates next spacecraft.', safety: 'Separation geometry verified.' });
  }
}
