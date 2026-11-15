// ALUNA mission catalogue — 25 Solo Campaign + 25 Squad Ops missions.
// Each mission defines its story, requirements, objectives, events and time constraints;
// the MissionEngine evaluates objectives against the live simulation.

const H = 3600;
const O = (type, label, params = {}) => ({ id: `${type}-${label.length}-${Math.abs(hash(label))}`, type, label, ...params });
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

const TIERS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
const tierOf = (n) => (n <= 5 ? 0 : n <= 15 ? 1 : n <= 20 ? 2 : 3);

const SOLO = [
  {
    title: 'First Contact', story: 'Welcome to ALUNA, Flight Director. Your first spacecraft — a single CubeSat — is already stowed on the pad. Launch it, watch it separate and make first contact with the Deep Space Network.',
    tutorial: true, timeLimit: 2 * H, timeScale: 60, ambientDebris: 6,
    lock: { satCount: 1 }, req: { maxSats: 1 },
    preset: { bus: 'cubesat', payload: 'science', panelType: 'deployable', panelArea: 0.8, batteryWh: 120, propulsion: 'cold_gas', fuelKg: 1, comms: 'uhf', sensors: ['sun_sensor'], altKm: 500, incDeg: 51.6, launcher: 'light', alloc: { payload: 40, comms: 40, thermal: 20 } },
    objectives: [O('deploy', 'Separate the satellite from the upper stage', { count: 1 }), O('contact', 'Make contact with any ground station', { count: 1 }), O('inspect', 'Inspect your satellite (click it or press 1)', { count: 1 })],
    tips: ['Press DEPLOY or wait for auto-separation.', 'Use time warp (+/-) to speed up until a ground pass.', 'Click a satellite chip at the bottom to inspect it.'],
  },
  {
    title: 'Orbital Foundations', story: 'A rideshare launch left your smallsat in an elliptical orbit. Circularize it into a stable 550 km orbit and hold it there.',
    timeLimit: 3 * H, req: { propulsion: true, minDv: 40 }, preset: { altKm: 450, satCount: 1 }, lock: { satCount: 1 },
    stageEcc: true,
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('alt_target', 'Circularize at 550 ± 20 km', { alt: 550, tol: 20 }), O('alt_hold', 'Hold 520–580 km for 20 min', { min: 520, max: 580, hold: 1200 })],
    tips: ['Use Plan Transfer with a target of 550 km — the engine schedules the circularization burn.'],
  },
  {
    title: 'Satellite Deployment', story: 'Two imaging satellites ride in the dispenser. Deploy each manually and bring their payloads online.',
    manualDeploy: true, timeLimit: 2 * H, req: { minSats: 2, maxSats: 3 }, preset: { satCount: 2 },
    objectives: [O('deploy', 'Manually deploy 2 satellites', { count: 2 }), O('payload_time', 'Operate payloads for 30 min total', { secs: 1800 }), O('collect', 'Collect 2,000 MB of imagery', { mb: 2000 })],
  },
  {
    title: 'Power Up', story: 'Your satellite must survive repeated eclipses with a battery that has already lost cells. Manage loads so the battery never drops below 20%.',
    timeLimit: 5 * H, preset: { satCount: 1, batteryWh: 600 }, lock: { satCount: 1 },
    events: [{ type: 'battery_degrade', at: 0.1, factor: 0.6 }, { type: 'power_shortage', at: [0.3, 0.5], watts: 45 }],
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('eclipses', 'Survive 3 eclipse passes', { count: 3 }), O('battery_floor', 'Keep battery above 20%', { pct: 20, grace: 120 }), O('resolve', 'Clear the stuck heater fault', { count: 1, event: 'power_shortage' })],
  },
  {
    title: 'Signal Connection', story: 'Establish an S-band link with three different ground stations and downlink your first data products.',
    timeLimit: 5 * H, req: { comms: ['sband', 'xband', 'optical'] }, preset: { satCount: 1, incDeg: 70 },
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('contact', 'Contact 3 different ground stations', { count: 3 }), O('downlink', 'Downlink 300 MB', { mb: 300 })],
  },
  {
    title: 'Fleet Formation', story: 'Build a "string of pearls": three satellites trailing each other 80–200 km apart. Use small retrograde burns to drift a satellite ahead, then a matching prograde burn to stop the drift.',
    manualDeploy: true, phasedManual: true, timeLimit: 5 * H, req: { minSats: 3, maxSats: 4 }, preset: { satCount: 3 },
    objectives: [O('deploy', 'Deploy 3 satellites', { count: 3 }), O('formation', 'Neighbours 80–200 km apart for 10 min', { count: 3, minKm: 80, maxKm: 200, hold: 600 })],
    tips: ['A 6 m/s retrograde burn drifts a satellite ~100 km ahead in about 90 minutes.', 'Stop the drift with an equal prograde burn once spacing is right.', 'Give the third satellite twice the burn of the second.'],
  },
  {
    title: 'Orbital Correction', story: 'A stuck thruster valve fired during commissioning and knocked your satellite off its orbit. Restore the 600 km working orbit.',
    timeLimit: 4 * H, req: { propulsion: true, minDv: 60 }, preset: { altKm: 600, satCount: 1 },
    events: [{ type: 'orbit_deviation', at: 600, dv: 22, target: 0 }],
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('alt_target', 'Restore 600 ± 15 km circular orbit (after the anomaly)', { alt: 600, tol: 15, afterT: 700 }), O('fuel_reserve', 'Finish with ≥ 40% propellant', { pct: 40 })],
  },
  {
    title: 'Sensor Recovery', story: 'The star tracker on your Earth-imaging satellite keeps faulting. Recover it and still deliver the imagery order.',
    timeLimit: 4 * H, req: { payload: 'imager' }, preset: { satCount: 1, payload: 'imager' },
    events: [{ type: 'sensor_fault', at: 0.15 }, { type: 'sensor_fault', at: 0.5 }],
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('resolve', 'Recover the sensor twice', { count: 2, event: 'sensor_fault' }), O('collect', 'Collect 6,000 MB of imagery', { mb: 6000 })],
  },
  {
    title: 'Debris Alert', story: 'A fragment from an old rocket body is on a crossing trajectory. Screen it, plan an avoidance burn and protect your spacecraft.',
    timeLimit: 3 * H, req: { propulsion: true }, preset: { satCount: 1 },
    events: [{ type: 'debris', at: 0.05, target: 0, lead: 3600, miss: 0.25 }],
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('avoid', 'Clear the conjunction', { count: 1 }), O('no_collision', 'No collisions')],
  },
  {
    title: 'Communication Crisis', story: 'Two satellites lose their transceivers within the same hour. Recover both links before the data recorder overflows.',
    timeLimit: 4 * H, preset: { satCount: 2 }, req: { minSats: 2 },
    events: [{ type: 'comms_loss', at: 0.12, target: 0 }, { type: 'comms_loss', at: 0.3, target: 1 }],
    objectives: [O('deploy', 'Deploy 2 satellites', { count: 2 }), O('resolve', 'Restore both communication links', { count: 2, event: 'comms_loss' }), O('downlink', 'Downlink 500 MB', { mb: 500 })],
  },
  {
    title: 'Resource Balance', story: 'A science campaign with a tight power budget: run the payload as long as possible without breaking the 25% battery rule.',
    timeLimit: 5 * H, req: { payload: 'science' }, preset: { satCount: 2, payload: 'science', panelArea: 2 },
    events: [{ type: 'solar_degrade', at: 0.25, factor: 0.6 }],
    objectives: [O('deploy', 'Deploy 2 satellites', { count: 2 }), O('payload_time', 'Operate payloads for 3 h total', { secs: 10800 }), O('battery_floor', 'Keep every battery above 25%', { pct: 25, grace: 300 }), O('downlink', 'Downlink 1,000 MB', { mb: 1000 }, ), O('resolve', 'Realign the degraded array (bonus)', { count: 1, event: 'solar_degrade', required: false })],
  },
  {
    title: 'Precision Deployment', story: 'A customer wants their satellite at exactly 700 km and 53.5°. You are delivered to 500 km at 51.6°.',
    timeLimit: 5 * H, req: { propulsion: true, minDv: 260 }, preset: { satCount: 1, altKm: 500, incDeg: 51.6, propulsion: 'biprop', fuelKg: 60 },
    lock: { altKm: 500, incDeg: 51.6 },
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('alt_target', 'Reach 700 ± 15 km', { alt: 700, tol: 15 }), O('inc_target', 'Reach 53.5 ± 0.5° inclination', { inc: 53.5, tol: 0.5 })],
    tips: ['Plane changes must happen near the equator (node). Watch the latitude readout.'],
  },
  {
    title: 'Power Emergency', story: 'A failed array drive and a stuck heater leave your satellite bleeding power. Prevent a loss of vehicle until the next maintenance window.',
    timeLimit: 3 * H, preset: { satCount: 1 },
    events: [{ type: 'solar_degrade', at: 0.05, factor: 0.35 }, { type: 'power_shortage', at: 0.1, watts: 70 }, { type: 'battery_degrade', at: 0.4, factor: 0.7 }],
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('survive_time', 'Keep the satellite alive for 2.5 h', { secs: 9000 }), O('battery_floor', 'Never fully discharge (stay > 5%)', { pct: 5, grace: 60 }), O('resolve', 'Fix 2 power faults', { count: 2 })],
  },
  {
    title: 'Navigation Challenge', story: 'Lower a satellite from 800 km to a 450 km very-low-Earth-orbit science slot while avoiding a debris shell.',
    timeLimit: 5 * H, req: { propulsion: true, minDv: 220 }, preset: { satCount: 1, altKm: 800, propulsion: 'biprop', fuelKg: 50 }, lock: { altKm: 800 },
    events: [{ type: 'debris', at: [0.35, 0.5], target: 0, miss: 0.4 }],
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('alt_target', 'Reach 450 ± 15 km', { alt: 450, tol: 15 }), O('no_collision', 'No collisions'), O('alt_hold', 'Hold 430–470 km for 15 min', { min: 430, max: 470, hold: 900 })],
  },
  {
    title: 'Multi-Satellite Coordination', story: 'Five relay satellites in a 1,900 km ring must form a continuous network so every spacecraft can reach the ground through its neighbours.',
    timeLimit: 6 * H, req: { minSats: 5, payload: 'relay' }, preset: { satCount: 5, payload: 'relay', altKm: 1900, launcher: 'heavy' }, phased: true,
    events: [{ type: 'gs_outage', at: 0.3, stations: 4, duration: 3600 }],
    objectives: [O('deploy', 'Deploy 5 satellites', { count: 5 }), O('network', 'Whole fleet linked to ground for 45 min', { hold: 2700, frac: 1 }), O('downlink', 'Downlink 1,500 MB', { mb: 1500 })],
  },
  {
    title: 'Collision Warning', story: 'Space surveillance reports two separate objects on intercept courses with your three-satellite fleet. Prioritise and act.',
    timeLimit: 4 * H, req: { propulsion: true, minSats: 3 }, preset: { satCount: 3 }, phased: true,
    events: [{ type: 'debris', at: 0.15, target: 0, miss: 0.2 }, { type: 'debris', at: 0.3, target: 2, miss: 0.5 }],
    objectives: [O('deploy', 'Deploy 3 satellites', { count: 3 }), O('avoid', 'Clear 2 conjunctions', { count: 2 }), O('no_collision', 'No collisions'), O('fuel_reserve', 'Average fuel ≥ 50%', { pct: 50 })],
  },
  {
    title: 'Autonomous Intervention', story: 'Fly the mission in AI-Assisted mode. The agents will raise recommendations — your job is to judge them: approve, modify or reject.',
    timeLimit: 4 * H, preset: { satCount: 2 }, startMode: 'ai',
    events: [{ type: 'sensor_fault', at: 0.1 }, { type: 'comms_loss', at: 0.2 }, { type: 'debris', at: 0.3, miss: 0.3 }, { type: 'prop_fault', at: 0.15 }],
    objectives: [O('deploy', 'Deploy 2 satellites', { count: 2 }), O('review', 'Review 3 agent recommendations', { count: 3 }), O('ai_time', 'Supervise AI-Assisted operations for 1 h', { secs: 3600 }), O('no_collision', 'No collisions')],
  },
  {
    title: 'Propulsion Failure', story: 'Mid-transfer, your primary thruster fails. Bring the backup branch online and finish the orbit raise on degraded performance.',
    timeLimit: 5 * H, req: { propulsion: true, minDv: 150 }, preset: { satCount: 1, altKm: 500, propulsion: 'biprop', fuelKg: 45 }, lock: { altKm: 500 },
    events: [{ type: 'prop_fault', at: 0.12, target: 0 }],
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('resolve', 'Activate the backup thruster', { count: 1, event: 'prop_fault' }), O('alt_target', 'Reach 720 ± 20 km', { alt: 720, tol: 20 })],
  },
  {
    title: 'Mission Extension', story: 'An ageing satellite with a worn battery and almost no fuel. Squeeze out six more hours of science.',
    timeLimit: 7 * H, timeScale: 120, preset: { satCount: 1, fuelKg: 3, batteryWh: 500 },
    events: [{ type: 'battery_degrade', at: 0.05, factor: 0.55 }, { type: 'solar_degrade', at: 0.4, factor: 0.7 }, { type: 'payload_fail', at: 0.6 }],
    objectives: [O('deploy', 'Deploy the satellite', { count: 1 }), O('survive_time', 'Operate for 6 h', { secs: 6 * H }), O('collect', 'Collect 4,000 MB', { mb: 4000 }), O('battery_floor', 'Battery above 10%', { pct: 10, grace: 60 })],
  },
  {
    title: 'Network Recovery', story: 'A ground-segment blackout and two transceiver failures fracture your five-satellite network. Reconnect everything.',
    timeLimit: 6 * H, req: { minSats: 5 }, preset: { satCount: 5, payload: 'relay', altKm: 1900, launcher: 'heavy' }, phased: true,
    events: [{ type: 'gs_outage', at: 0.1, stations: 5, duration: 5400 }, { type: 'comms_loss', at: 0.15, target: 1 }, { type: 'comms_loss', at: 0.22, target: 3 }],
    objectives: [O('deploy', 'Deploy 5 satellites', { count: 5 }), O('resolve', 'Restore 2 failed links', { count: 2, event: 'comms_loss' }), O('network', '80% of the network linked for 1 h', { hold: 3600, frac: 0.8 })],
  },
  {
    title: 'Complex Orbital Operations', story: 'Three satellites, three different target orbits, one shared timeline.',
    timeLimit: 6 * H, req: { propulsion: true, minSats: 3, minDv: 150 }, preset: { satCount: 3, propulsion: 'biprop', fuelKg: 50, altKm: 550 },
    objectives: [O('deploy', 'Deploy 3 satellites', { count: 3 }), O('alt_target', 'LYRA-1 to 650 km', { sat: 0, alt: 650, tol: 15 }), O('alt_target', 'ORION-2 to 480 km', { sat: 1, alt: 480, tol: 15 }), O('alt_target', 'VEGA-3 to 750 km', { sat: 2, alt: 750, tol: 15 }), O('no_collision', 'No collisions')],
  },
  {
    title: 'Space Debris Crisis', story: 'A fragmentation event has scattered debris across your orbital shell. Four conjunctions are expected within hours.',
    timeLimit: 5 * H, req: { propulsion: true, minSats: 3 }, preset: { satCount: 4 }, phased: true, ambientDebris: 60,
    events: [{ type: 'debris', at: 0.08, target: 0, miss: 0.2 }, { type: 'debris', at: 0.16, target: 1, miss: 0.3 }, { type: 'debris', at: 0.24, target: 2, miss: 0.1 }, { type: 'debris', at: 0.32, target: 3, miss: 0.4 }],
    objectives: [O('deploy', 'Deploy 4 satellites', { count: 4 }), O('avoid', 'Clear 4 conjunctions', { count: 4 }), O('min_alive', 'Keep at least 3 satellites', { count: 3 }), O('no_collision', 'Zero collisions (bonus)', { required: false })],
  },
  {
    title: 'Critical Fleet Recovery', story: 'A solar proton storm hits while your fleet is already degraded. Protect, recover and resume operations.',
    timeLimit: 5 * H, preset: { satCount: 4 }, phased: true,
    events: [{ type: 'solar_storm', at: 0.3, lead: 900, duration: 2700 }, { type: 'comms_loss', at: 0.55 }, { type: 'sensor_fault', at: 0.45 }, { type: 'power_shortage', at: 0.5, watts: 50 }],
    objectives: [O('deploy', 'Deploy 4 satellites', { count: 4 }), O('storm_safe', 'Ride out the storm with health > 60%', { health: 60 }), O('resolve', 'Resolve 3 post-storm faults', { count: 3 }), O('min_alive', 'Keep all 4 satellites', { count: 4 })],
  },
  {
    title: 'Autonomous Mission Challenge', story: 'Supervise a six-satellite constellation for two hours in AI-Assisted mode while the agents handle a cascade of routine faults.',
    timeLimit: 5 * H, preset: { satCount: 6 }, phased: true, startMode: 'ai',
    randomEvents: { count: 6, pool: ['sensor_fault', 'comms_loss', 'power_shortage', 'solar_degrade', 'payload_fail'], window: [0.1, 0.7] },
    events: [{ type: 'debris', at: 0.35, miss: 0.3 }],
    objectives: [O('deploy', 'Deploy 6 satellites', { count: 6 }), O('ai_time', '2 h in AI-Assisted mode', { secs: 2 * H }), O('review', 'Review 4 high/medium-risk decisions', { count: 4 }), O('resolve', 'Resolve 5 faults (agents or you)', { count: 5 }), O('no_collision', 'No collisions')],
  },
  {
    title: 'Final Mission', story: 'ALUNA\'s flagship: deploy an eight-satellite Earth-observation constellation, link it, survive a debris storm and deliver the first global map.',
    timeLimit: 8 * H, timeScale: 120, req: { minSats: 6, propulsion: true }, preset: { satCount: 8, launcher: 'heavy', altKm: 900 }, phased: true, ambientDebris: 50,
    events: [{ type: 'debris', at: 0.15, miss: 0.2 }, { type: 'debris', at: 0.35, miss: 0.3 }, { type: 'solar_storm', at: 0.5, lead: 900, duration: 1800 }, { type: 'gs_outage', at: 0.6, stations: 3, duration: 3600 }],
    randomEvents: { count: 4, pool: ['sensor_fault', 'comms_loss', 'power_shortage', 'prop_fault'], window: [0.2, 0.8] },
    objectives: [O('deploy', 'Deploy all 8 satellites', { count: 8 }), O('avoid', 'Clear 2 conjunctions', { count: 2 }), O('network', '75% of the constellation linked for 1 h', { hold: 3600, frac: 0.75 }), O('collect', 'Collect 30,000 MB', { mb: 30000 }), O('min_alive', 'At least 7 satellites survive', { count: 7 }), O('storm_safe', 'Weather the storm (health > 50%)', { health: 50 })],
  },
];

// ---------------- Squad Ops: shared objectives with role ownership ----------------
const SQUAD = [
  {
    title: 'Squad Formation', story: 'Your squad\'s first joint operation. The Commander authorises, Flight deploys, Systems brings the payload up and the Supervisor reviews AI output.',
    timeLimit: 2 * H, preset: { satCount: 2 }, manualDeploy: true, startMode: 'ai',
    objectives: [O('authorize', 'Commander: authorise operations', { role: 'commander' }), O('deploy', 'Flight: deploy 2 satellites', { count: 2, role: 'flight' }), O('payload_time', 'Systems: 20 min payload operations', { secs: 1200, role: 'systems' }), O('review', 'Supervisor: review 1 AI recommendation', { count: 1, role: 'autonomy' })],
  },
  {
    title: 'Joint Satellite Deployment', story: 'Deploy four spacecraft in a coordinated sequence and inspect each before commissioning.',
    timeLimit: 3 * H, preset: { satCount: 4 }, manualDeploy: true, phased: false, req: { minSats: 4 },
    objectives: [O('authorize', 'Commander: GO for deployment', { role: 'commander' }), O('deploy', 'Flight: deploy 4 satellites', { count: 4, role: 'flight' }), O('inspect', 'Systems: inspect all 4', { count: 4, role: 'systems' }), O('collect', 'Collect 3,000 MB', { mb: 3000, role: 'systems' })],
  },
  {
    title: 'Shared Communication Network', story: 'Build a three-satellite relay chain and keep it linked while the ground network goes dark.',
    timeLimit: 4 * H, preset: { satCount: 3, payload: 'relay', altKm: 1000 }, phased: true, req: { minSats: 3 },
    events: [{ type: 'gs_outage', at: 0.25, stations: 4, duration: 3000 }],
    objectives: [O('deploy', 'Deploy 3 relays', { count: 3, role: 'flight' }), O('network', 'Systems: 2 of 3 linked for 30 min', { hold: 1800, frac: 0.66, role: 'systems' }), O('contact', 'Contact 4 stations', { count: 4, role: 'commander' })],
  },
  {
    title: 'Coordinated Power Management', story: 'Every satellite in the fleet is power-constrained. Systems manages loads; Autonomy tunes the agents; Commander arbitrates.',
    timeLimit: 5 * H, preset: { satCount: 3, panelArea: 2.2 },
    events: [{ type: 'power_shortage', at: 0.15, watts: 40, target: 0 }, { type: 'solar_degrade', at: 0.3, target: 1, factor: 0.5 }, { type: 'battery_degrade', at: 0.45, target: 2 }],
    objectives: [O('deploy', 'Deploy 3 satellites', { count: 3, role: 'flight' }), O('battery_floor', 'All batteries above 20%', { pct: 20, grace: 300, role: 'systems' }), O('resolve', 'Resolve 2 power faults', { count: 2, role: 'systems' }), O('eclipses', 'Survive 3 eclipses', { count: 3, role: 'commander' })],
  },
  {
    title: 'Team Orbital Navigation', story: 'Raise two satellites to 650 km while Systems keeps them healthy.',
    timeLimit: 4 * H, preset: { satCount: 2, propulsion: 'biprop', fuelKg: 40 }, req: { propulsion: true },
    objectives: [O('deploy', 'Deploy 2 satellites', { count: 2, role: 'flight' }), O('alt_target', 'Flight: both to 650 ± 20 km', { alt: 650, tol: 20, role: 'flight' }), O('payload_time', 'Systems: 40 min payload ops', { secs: 2400, role: 'systems' })],
  },
  {
    title: 'Multi-Satellite Operations', story: 'Five satellites, five tasks. Split the work.',
    timeLimit: 5 * H, preset: { satCount: 5 }, phased: true, req: { minSats: 5 },
    events: [{ type: 'sensor_fault', at: 0.2 }, { type: 'payload_fail', at: 0.35 }],
    objectives: [O('deploy', 'Deploy 5', { count: 5, role: 'flight' }), O('resolve', 'Resolve 2 faults', { count: 2, role: 'systems' }), O('collect', 'Collect 8,000 MB', { mb: 8000, role: 'systems' }), O('inspect', 'Inspect all 5', { count: 5, role: 'commander' })],
  },
  {
    title: 'Distributed Resource Management', story: 'Data quota vs power quota: keep the fleet productive without breaking the battery floor.',
    timeLimit: 5 * H, preset: { satCount: 4, panelArea: 2.5 }, phased: true,
    events: [{ type: 'solar_degrade', at: 0.3, factor: 0.55 }],
    objectives: [O('deploy', 'Deploy 4', { count: 4, role: 'flight' }), O('downlink', 'Downlink 2,500 MB', { mb: 2500, role: 'systems' }), O('battery_floor', 'Batteries above 25%', { pct: 25, grace: 300, role: 'autonomy' }), O('fuel_reserve', 'Fuel ≥ 60%', { pct: 60, role: 'flight' })],
  },
  {
    title: 'Joint Orbital Correction', story: 'Two satellites were perturbed by a dispenser malfunction. Flight corrects; Commander confirms.',
    timeLimit: 4 * H, preset: { satCount: 2, altKm: 600 }, req: { propulsion: true, minDv: 60 },
    events: [{ type: 'orbit_deviation', at: 600, target: 0, dv: 18 }, { type: 'orbit_deviation', at: 900, target: 1, dv: 15 }],
    objectives: [O('deploy', 'Deploy 2', { count: 2, role: 'flight' }), O('alt_target', 'Both back to 600 ± 15 km (after the anomalies)', { alt: 600, tol: 15, afterT: 1000, role: 'flight' }), O('authorize', 'Commander: certify orbit', { role: 'commander' }), O('fuel_reserve', 'Fuel ≥ 40%', { pct: 40, role: 'flight' })],
  },
  {
    title: 'Communication Network Recovery', story: 'Three of four links fail during a solar flare. Systems restores them; Autonomy supervises agent actions.',
    timeLimit: 5 * H, preset: { satCount: 5, payload: 'relay', altKm: 1900, launcher: 'heavy' }, phased: true, startMode: 'ai',
    events: [{ type: 'comms_loss', at: 0.1, target: 0 }, { type: 'comms_loss', at: 0.15, target: 1 }, { type: 'comms_loss', at: 0.2, target: 2 }],
    objectives: [O('deploy', 'Deploy 5', { count: 5, role: 'flight' }), O('resolve', 'Restore 3 links', { count: 3, event: 'comms_loss', role: 'systems' }), O('review', 'Review 2 AI decisions', { count: 2, role: 'autonomy' }), O('network', '4 of 5 linked for 30 min', { hold: 1800, frac: 0.8, role: 'commander' })],
  },
  {
    title: 'Shared Debris Monitoring', story: 'The squad shares one conjunction screen. Two objects, two satellites, no collisions.',
    timeLimit: 4 * H, preset: { satCount: 3 }, phased: true, req: { propulsion: true },
    events: [{ type: 'debris', at: 0.1, target: 0, miss: 0.3 }, { type: 'debris', at: 0.25, target: 1, miss: 0.2 }],
    objectives: [O('deploy', 'Deploy 3', { count: 3, role: 'flight' }), O('avoid', 'Flight: clear 2 conjunctions', { count: 2, role: 'flight' }), O('no_collision', 'No collisions', { role: 'commander' }), O('review', 'Supervisor: review a collision plan', { count: 1, role: 'autonomy', required: false })],
  },
  {
    title: 'Coordinated Satellite Inspection', story: 'Six satellites must each be inspected and certified after launch vibration testing flagged anomalies.',
    timeLimit: 4 * H, preset: { satCount: 6 }, phased: true, req: { minSats: 6 },
    events: [{ type: 'sensor_fault', at: 0.15 }, { type: 'power_shortage', at: 0.25, watts: 35 }],
    objectives: [O('deploy', 'Deploy 6', { count: 6, role: 'flight' }), O('inspect', 'Inspect all 6', { count: 6, role: 'systems' }), O('resolve', 'Fix 2 anomalies', { count: 2, role: 'systems' }), O('authorize', 'Commander: certify fleet', { role: 'commander' })],
  },
  {
    title: 'Emergency Power Allocation', story: 'Triple power faults across the fleet. Decide who gets power and who goes to safe mode.',
    timeLimit: 3 * H, preset: { satCount: 3 },
    events: [{ type: 'battery_degrade', at: 0.05, target: 0, factor: 0.5 }, { type: 'solar_degrade', at: 0.08, target: 1, factor: 0.35 }, { type: 'power_shortage', at: 0.1, target: 2, watts: 80 }],
    objectives: [O('deploy', 'Deploy 3', { count: 3, role: 'flight' }), O('min_alive', 'Lose no satellites', { count: 3, role: 'commander' }), O('resolve', 'Resolve 2 faults', { count: 2, role: 'systems' }), O('survive_time', 'Hold out 2.5 h', { secs: 9000, role: 'autonomy' })],
  },
  {
    title: 'Precision Deployment (Squad)', story: 'Deliver two customer satellites to 700 km / 53° from a 500 km / 51.6° drop-off.',
    timeLimit: 5 * H, preset: { satCount: 2, altKm: 500, incDeg: 51.6, propulsion: 'biprop', fuelKg: 60 }, lock: { altKm: 500, incDeg: 51.6 }, req: { propulsion: true, minDv: 200 },
    objectives: [O('deploy', 'Deploy 2', { count: 2, role: 'flight' }), O('alt_target', 'Both to 700 ± 20 km', { alt: 700, tol: 20, role: 'flight' }), O('inc_target', 'Both to 53 ± 0.5°', { inc: 53, tol: 0.5, role: 'flight' }), O('authorize', 'Commander: customer handover', { role: 'commander' })],
  },
  {
    title: 'Multi-Station Coordination', story: 'Collect and downlink through six different ground stations while two of them go offline.',
    timeLimit: 6 * H, preset: { satCount: 3, incDeg: 75 }, phased: true,
    events: [{ type: 'gs_outage', at: 0.2, stations: 2, duration: 5400 }],
    objectives: [O('deploy', 'Deploy 3', { count: 3, role: 'flight' }), O('contact', 'Contact 5 stations', { count: 5, role: 'commander' }), O('downlink', 'Downlink 3,000 MB', { mb: 3000, role: 'systems' })],
  },
  {
    title: 'Fleet Stability Challenge', story: 'Arrange four satellites into a 60–250 km string-of-pearls formation and keep it stable through a thruster glitch.',
    timeLimit: 6 * H, preset: { satCount: 4 }, manualDeploy: true, req: { minSats: 4 },
    events: [{ type: 'orbit_deviation', at: 0.2, dv: 6 }],
    objectives: [O('deploy', 'Deploy 4', { count: 4, role: 'flight' }), O('formation', 'Neighbours 60–250 km apart for 15 min', { count: 4, minKm: 60, maxKm: 250, hold: 900, role: 'flight' }), O('battery_floor', 'Batteries > 20%', { pct: 20, grace: 300, role: 'systems' }), O('review', 'Review 2 AI decisions', { count: 2, role: 'autonomy', required: false })],
  },
  {
    title: 'Predictive Collision Response', story: 'Three conjunctions, uncertain tracking. The proximity radar gives you more warning — use it.',
    timeLimit: 4 * H, preset: { satCount: 3, sensors: ['sun_sensor', 'star_tracker', 'gps', 'proximity'] }, phased: true, req: { propulsion: true, sensors: ['proximity'] },
    events: [{ type: 'debris', at: 0.08, target: 0, miss: 0.15, lead: 4500 }, { type: 'debris', at: 0.18, target: 1, miss: 0.3, lead: 4500 }, { type: 'debris', at: 0.28, target: 2, miss: 0.05, lead: 4500 }],
    objectives: [O('deploy', 'Deploy 3', { count: 3, role: 'flight' }), O('avoid', 'Clear 3 conjunctions', { count: 3, role: 'flight' }), O('review', 'Review 2 collision plans', { count: 2, role: 'autonomy' }), O('no_collision', 'No collisions', { role: 'commander' })],
  },
  {
    title: 'Simultaneous Satellite Emergencies', story: 'Everything breaks at once. Divide and conquer.',
    timeLimit: 4 * H, preset: { satCount: 4 }, phased: true,
    events: [{ type: 'comms_loss', at: 0.12, target: 0 }, { type: 'prop_fault', at: 0.12, target: 1 }, { type: 'sensor_fault', at: 0.12, target: 2 }, { type: 'power_shortage', at: 0.12, target: 3, watts: 60 }, { type: 'debris', at: 0.15, target: 1, miss: 0.5 }],
    objectives: [O('deploy', 'Deploy 4', { count: 4, role: 'flight' }), O('resolve', 'Resolve 4 emergencies', { count: 4, role: 'systems' }), O('avoid', 'Clear the conjunction', { count: 1, role: 'flight' }), O('min_alive', 'Lose no satellites', { count: 4, role: 'commander' })],
  },
  {
    title: 'Critical Fleet Recovery (Squad)', story: 'A storm warning with only ten minutes lead time. Protect the fleet together.',
    timeLimit: 5 * H, preset: { satCount: 5 }, phased: true,
    events: [{ type: 'solar_storm', at: 0.3, lead: 600, duration: 3000 }, { type: 'comms_loss', at: 0.55 }, { type: 'sensor_fault', at: 0.6 }],
    objectives: [O('deploy', 'Deploy 5', { count: 5, role: 'flight' }), O('storm_safe', 'Health > 60% after storm', { health: 60, role: 'commander' }), O('resolve', 'Resolve 2 post-storm faults', { count: 2, role: 'systems' }), O('review', 'Review 3 fleet-agent proposals', { count: 3, role: 'autonomy' })],
  },
  {
    title: 'Autonomous Agent Supervision', story: 'The agents run the fleet. The Supervisor decides what they may do; the Commander signs off high-risk calls.',
    timeLimit: 5 * H, preset: { satCount: 5 }, phased: true, startMode: 'ai',
    randomEvents: { count: 6, pool: ['sensor_fault', 'comms_loss', 'power_shortage', 'solar_degrade', 'prop_fault'], window: [0.1, 0.6] },
    events: [{ type: 'debris', at: 0.3, miss: 0.25 }],
    objectives: [O('deploy', 'Deploy 5', { count: 5, role: 'flight' }), O('ai_time', '90 min AI-Assisted', { secs: 5400, role: 'autonomy' }), O('review', 'Review 5 decisions', { count: 5, role: 'autonomy' }), O('no_collision', 'No collisions', { role: 'commander' })],
  },
  {
    title: 'Multi-Orbit Coordination', story: 'Split a four-satellite fleet into two shells: 500 km and 750 km.',
    timeLimit: 6 * H, preset: { satCount: 4, altKm: 600, propulsion: 'biprop', fuelKg: 50 }, req: { propulsion: true, minDv: 120 },
    objectives: [O('deploy', 'Deploy 4', { count: 4, role: 'flight' }), O('alt_target', 'LYRA-1 → 500 km', { sat: 0, alt: 500, tol: 15, role: 'flight' }), O('alt_target', 'ORION-2 → 500 km', { sat: 1, alt: 500, tol: 15, role: 'flight' }), O('alt_target', 'VEGA-3 → 750 km', { sat: 2, alt: 750, tol: 15, role: 'flight' }), O('alt_target', 'ALTAIR-4 → 750 km', { sat: 3, alt: 750, tol: 15, role: 'flight' }), O('battery_floor', 'Batteries > 15%', { pct: 15, grace: 300, role: 'systems' })],
  },
  {
    title: 'Large-Scale Fleet Management', story: 'Ten satellites. One squad. Keep them productive and safe.',
    timeLimit: 6 * H, timeScale: 120, preset: { satCount: 10, launcher: 'heavy' }, phased: true, req: { minSats: 10 },
    randomEvents: { count: 5, pool: ['sensor_fault', 'comms_loss', 'power_shortage', 'payload_fail'], window: [0.15, 0.7] },
    objectives: [O('deploy', 'Deploy 10', { count: 10, role: 'flight' }), O('collect', 'Collect 25,000 MB', { mb: 25000, role: 'systems' }), O('resolve', 'Resolve 4 faults', { count: 4, role: 'systems' }), O('min_alive', 'Keep 9 satellites', { count: 9, role: 'commander' }), O('review', 'Review 3 decisions', { count: 3, role: 'autonomy' })],
  },
  {
    title: 'Complex Debris Environment', story: 'A dense debris band, five predicted conjunctions, limited propellant.',
    timeLimit: 5 * H, preset: { satCount: 5 }, phased: true, ambientDebris: 80, req: { propulsion: true },
    events: [0.06, 0.12, 0.18, 0.24, 0.3].map((at, k) => ({ type: 'debris', at, target: k, miss: 0.1 + k * 0.08 })),
    objectives: [O('deploy', 'Deploy 5', { count: 5, role: 'flight' }), O('avoid', 'Clear 5 conjunctions', { count: 5, role: 'flight' }), O('fuel_reserve', 'Average fuel ≥ 45%', { pct: 45, role: 'commander' }), O('min_alive', 'Keep 4 satellites', { count: 4, role: 'commander' })],
  },
  {
    title: 'Multi-System Failure Recovery', story: 'A cascading software fault takes down propulsion, power and comms across the fleet.',
    timeLimit: 5 * H, preset: { satCount: 4 }, phased: true,
    events: [{ type: 'prop_fault', at: 0.1, target: 0 }, { type: 'comms_loss', at: 0.12, target: 0 }, { type: 'power_shortage', at: 0.14, target: 1, watts: 60 }, { type: 'solar_degrade', at: 0.16, target: 2, factor: 0.4 }, { type: 'payload_fail', at: 0.18, target: 3 }, { type: 'orbit_deviation', at: 0.25, target: 1, dv: 15 }],
    objectives: [O('deploy', 'Deploy 4', { count: 4, role: 'flight' }), O('resolve', 'Resolve 5 failures', { count: 5, role: 'systems' }), O('alt_hold', 'Fleet in 480–620 km for 20 min', { min: 480, max: 620, hold: 1200, need: 4, role: 'flight' }), O('min_alive', 'Lose no satellites', { count: 4, role: 'commander' })],
  },
  {
    title: 'High-Risk Mission Coordination', story: 'A plane change, an orbit raise and two conjunctions — every move needs Commander sign-off.',
    timeLimit: 6 * H, preset: { satCount: 3, propulsion: 'biprop', fuelKg: 60, altKm: 520 }, req: { propulsion: true, minDv: 200 }, startMode: 'ai',
    events: [{ type: 'debris', at: 0.2, target: 1, miss: 0.2 }, { type: 'debris', at: 0.4, target: 2, miss: 0.3 }],
    objectives: [O('deploy', 'Deploy 3', { count: 3, role: 'flight' }), O('alt_target', 'LYRA-1 → 700 km', { sat: 0, alt: 700, tol: 20, role: 'flight' }), O('inc_target', 'ORION-2 → 53°', { sat: 1, inc: 53, tol: 0.5, role: 'flight' }), O('avoid', 'Clear 2 conjunctions', { count: 2, role: 'flight' }), O('review', 'Commander/Supervisor review 4 decisions', { count: 4, role: 'autonomy' }), O('authorize', 'Commander: final GO', { role: 'commander' })],
  },
  {
    title: 'Final Squad Operation', story: 'ALUNA\'s capstone: a twelve-satellite global relay and imaging network under storms, debris and failures. Every role is critical.',
    timeLimit: 8 * H, timeScale: 120, preset: { satCount: 12, launcher: 'heavy', payload: 'relay', altKm: 1150 }, phased: true, ambientDebris: 60, req: { minSats: 10, propulsion: true },
    events: [{ type: 'debris', at: 0.15, miss: 0.2 }, { type: 'debris', at: 0.3, miss: 0.3 }, { type: 'solar_storm', at: 0.4, lead: 900, duration: 2400 }, { type: 'gs_outage', at: 0.55, stations: 4, duration: 3600 }],
    randomEvents: { count: 6, pool: ['sensor_fault', 'comms_loss', 'power_shortage', 'prop_fault', 'payload_fail'], window: [0.2, 0.8] },
    objectives: [O('authorize', 'Commander: authorise campaign', { role: 'commander' }), O('deploy', 'Deploy 12', { count: 12, role: 'flight' }), O('avoid', 'Clear 2 conjunctions', { count: 2, role: 'flight' }), O('network', '75% network linked for 1 h', { hold: 3600, frac: 0.75, role: 'systems' }), O('resolve', 'Resolve 5 failures', { count: 5, role: 'systems' }), O('review', 'Review 5 AI decisions', { count: 5, role: 'autonomy' }), O('storm_safe', 'Weather the storm', { health: 50, role: 'commander' }), O('min_alive', 'Keep 11 satellites', { count: 11, role: 'commander' })],
  },
];

function build(list, mode) {
  return list.map((m, k) => {
    const n = k + 1;
    const tier = tierOf(n);
    return {
      id: `${mode === 'solo' ? 'S' : 'Q'}${String(n).padStart(2, '0')}`,
      mode, number: n, tier: TIERS[tier], difficulty: Math.min(10, 1 + Math.round((n - 1) * 0.38)),
      timeScale: 60, raanDeg: 40 + n * 7, ambientDebris: 20 + n,
      rewards: { xp: 100 + n * 40 + (mode === 'squad' ? 80 : 0), badge: n % 5 === 0 ? `${TIERS[tier]} ${mode === 'solo' ? 'Pilot' : 'Squad'} ${n / 5}` : null },
      req: {}, lock: {}, events: [], tips: [],
      ...m,
      objectives: m.objectives.map((o, j) => ({ ...o, id: `${o.type}-${j}` })),
    };
  });
}

export const SOLO_MISSIONS = build(SOLO, 'solo');
export const SQUAD_MISSIONS = build(SQUAD, 'squad');
export const ALL_MISSIONS = [...SOLO_MISSIONS, ...SQUAD_MISSIONS];
export const missionById = (id) => ALL_MISSIONS.find((m) => m.id === id);

export const EVENT_INFO = {
  sensor_fault: 'Sensor malfunction', comms_loss: 'Communication loss', battery_degrade: 'Battery depletion', solar_degrade: 'Solar panel degradation',
  power_shortage: 'Power shortage', prop_fault: 'Propulsion malfunction', payload_fail: 'Payload failure', orbit_deviation: 'Orbital deviation',
  gs_outage: 'Ground station loss', solar_storm: 'Solar storm', debris: 'Unexpected debris',
};
