// Spacecraft Mission Designer — component catalog, derived budgets and validation.
// Every value here feeds the mission simulation (power, mass, comms, propulsion, sensing).
import { RE, MU, period } from './orbit.js';

export const BUSES = {
  cubesat: { label: 'CubeSat 12U', dryMass: 18, busPower: 12, maxPanel: 1.2, maxBattery: 300, maxFuel: 4, size: 0.5, desc: 'Compact, cheap, low power budget.' },
  smallsat: { label: 'SmallSat 150', dryMass: 140, busPower: 55, maxPanel: 8, maxBattery: 2400, maxFuel: 60, size: 1, desc: 'Balanced platform for most missions.' },
  medium: { label: 'Aquila 800', dryMass: 780, busPower: 220, maxPanel: 30, maxBattery: 12000, maxFuel: 400, size: 1.7, desc: 'Heavy bus for demanding payloads.' },
};

export const PAYLOADS = {
  none: { label: 'No payload', mass: 0, power: 0, rate: 0 },
  imager: { label: 'Optical Imager', mass: 12, power: 35, rate: 4.0, needs: ['star_tracker'] },
  radar: { label: 'SAR Radar', mass: 60, power: 300, rate: 9.0 },
  relay: { label: 'Comms Relay', mass: 20, power: 60, rate: 0.6, relay: true },
  science: { label: 'Science Spectrometer', mass: 15, power: 25, rate: 1.5 },
  weather: { label: 'Weather Sounder', mass: 25, power: 45, rate: 2.5 },
};

export const PANELS = {
  body: { label: 'Body-mounted', eff: 0.45, massPerM2: 2.0 },
  deployable: { label: 'Deployable wings', eff: 0.7, massPerM2: 3.2 },
  tracking: { label: 'Sun-tracking wings', eff: 0.92, massPerM2: 4.5 },
};

export const PROPULSION = {
  none: { label: 'None', isp: 1, mass: 0, power: 0, maxDv: 0 },
  cold_gas: { label: 'Cold gas', isp: 70, mass: 2, power: 2, maxDv: 6 },
  hydrazine: { label: 'Hydrazine monoprop', isp: 225, mass: 6, power: 10, maxDv: 60 },
  biprop: { label: 'Bipropellant', isp: 315, mass: 18, power: 15, maxDv: 300 },
  electric: { label: 'Hall-effect electric', isp: 1500, mass: 10, power: 280, maxDv: 4 },
};

export const COMMS = {
  uhf: { label: 'UHF transceiver', rate: 0.12, power: 6, mass: 1, beam: 'wide' },
  sband: { label: 'S-band', rate: 1.5, power: 18, mass: 3, beam: 'medium' },
  xband: { label: 'X-band high-gain', rate: 20, power: 45, mass: 8, beam: 'narrow', dish: true },
  optical: { label: 'Optical laser terminal', rate: 120, power: 60, mass: 10, beam: 'laser', needs: ['star_tracker'] },
};

export const SENSORS = {
  sun_sensor: { label: 'Sun sensors', mass: 0.3, power: 0.5, effect: 'Panel pointing: +5% solar output' },
  star_tracker: { label: 'Star tracker', mass: 1.5, power: 3, effect: 'Precise attitude: enables imager & optical comms' },
  gps: { label: 'GNSS receiver', mass: 0.5, power: 2, effect: 'Orbit determination: halves conjunction uncertainty' },
  proximity: { label: 'Proximity radar', mass: 4, power: 20, effect: 'Debris detection: doubles screening horizon' },
};

export const LAUNCHERS = {
  light: { label: 'ALN-1 Kestrel', capacityLeo: 600, stages: 2, boosters: 0, height: 22 },
  medium: { label: 'ALN-2 Condor', capacityLeo: 6000, stages: 2, boosters: 2, height: 38 },
  heavy: { label: 'ALN-3 Leviathan', capacityLeo: 22000, stages: 3, boosters: 4, height: 60 },
};

export const DEFAULT_DESIGN = {
  name: 'Aluna Pathfinder',
  bus: 'smallsat',
  satCount: 1,
  payload: 'imager',
  panelType: 'deployable',
  panelArea: 3,
  batteryWh: 800,
  propulsion: 'hydrazine',
  fuelKg: 20,
  comms: 'sband',
  sensors: ['sun_sensor', 'star_tracker', 'gps'],
  altKm: 550,
  incDeg: 51.6,
  durationDays: 30,
  alloc: { payload: 50, comms: 30, thermal: 20 },
  launcher: 'medium',
  color: '#d9a441',
};

export const SOLAR_CONST = 1361; // W/m^2
export const CELL_EFF = 0.29;

/** Derived per-satellite budgets used by both the designer UI and the engine. */
export function budgets(d) {
  const bus = BUSES[d.bus], pay = PAYLOADS[d.payload], pan = PANELS[d.panelType];
  const prop = PROPULSION[d.propulsion], com = COMMS[d.comms];
  const sensors = (d.sensors || []).map((k) => SENSORS[k]).filter(Boolean);
  const sensorMass = sensors.reduce((s, x) => s + x.mass, 0);
  const sensorPower = sensors.reduce((s, x) => s + x.power, 0);
  const batteryMass = d.batteryWh / 150; // 150 Wh/kg Li-ion
  const panelMass = d.panelArea * pan.massPerM2;
  const dryMass = bus.dryMass + pay.mass + panelMass + batteryMass + prop.mass + com.mass + sensorMass;
  const wetMass = dryMass + (d.propulsion === 'none' ? 0 : d.fuelKg);
  const sunBoost = d.sensors?.includes('sun_sensor') ? 1.05 : 1;
  const genSunlit = d.panelArea * SOLAR_CONST * CELL_EFF * pan.eff * sunBoost;
  const a = RE + d.altKm;
  const T = period(a);
  const beta = Math.asin(Math.min(1, RE / a));
  const eclipseFrac = beta / Math.PI; // worst-case (beta angle 0)
  const baseLoad = bus.busPower + sensorPower + prop.power * 0.1;
  const payloadLoad = pay.power;
  const commsLoad = com.power * 0.35; // duty-cycled average
  const avgLoad = baseLoad + payloadLoad * (d.alloc.payload / 100) * 1.2 + commsLoad + 8 * (d.alloc.thermal / 100) * 3;
  const avgGen = genSunlit * (1 - eclipseFrac);
  const eclipseEnergy = (avgLoad * T * eclipseFrac) / 3600; // Wh needed per eclipse
  const totalDv = d.propulsion === 'none' ? 0 : prop.isp * 9.80665 * Math.log(wetMass / dryMass);
  const dragDvPerYear = d.altKm < 450 ? 60 : d.altKm < 600 ? 15 : d.altKm < 800 ? 3 : 0.5;
  const stationKeepDv = (dragDvPerYear * d.durationDays) / 365;
  const lv = LAUNCHERS[d.launcher];
  const altPenalty = Math.max(0.2, 1 - (d.altKm - 200) / 1600);
  const capacity = lv.capacityLeo * altPenalty * (1 - Math.abs(d.incDeg - 28.5) / 400);
  return {
    dryMass, wetMass, totalMass: wetMass * d.satCount, genSunlit, avgGen, avgLoad, eclipseFrac, eclipseEnergy,
    periodMin: T / 60, totalDv, stationKeepDv, capacity, velocity: Math.sqrt(MU / a), dataRate: pay.rate, commsRate: com.rate,
    powerMargin: avgGen - avgLoad, batteryMargin: d.batteryWh * 0.8 - eclipseEnergy,
  };
}

/** Validate a design against physics rules and mission requirements. */
export function validateDesign(d, req = {}) {
  const errors = [], warnings = [];
  const bus = BUSES[d.bus];
  if (!bus) return { ok: false, errors: ['Unknown bus'], warnings, b: null };
  const b = budgets(d);
  const clampChecks = [
    [d.panelArea > bus.maxPanel, `Solar array ${d.panelArea} m² exceeds ${bus.label} limit of ${bus.maxPanel} m².`],
    [d.batteryWh > bus.maxBattery, `Battery ${d.batteryWh} Wh exceeds ${bus.label} limit of ${bus.maxBattery} Wh.`],
    [d.propulsion !== 'none' && d.fuelKg > bus.maxFuel, `Propellant ${d.fuelKg} kg exceeds tank limit of ${bus.maxFuel} kg.`],
    [d.altKm < 200 || d.altKm > 2000, 'Operational altitude must be between 200 and 2000 km for this programme.'],
    [d.incDeg < 0 || d.incDeg > 180, 'Inclination must be 0–180°.'],
    [d.satCount < 1 || d.satCount > 16, 'Satellite count must be 1–16.'],
    [b.totalMass > b.capacity, `Launch mass ${b.totalMass.toFixed(0)} kg exceeds ${LAUNCHERS[d.launcher].label} capacity ${b.capacity.toFixed(0)} kg to this orbit.`],
    [b.powerMargin < 0, `Negative orbit-average power margin (${b.powerMargin.toFixed(0)} W). Increase array area or reduce loads.`],
    [b.batteryMargin < 0, `Battery cannot carry eclipse load (needs ${b.eclipseEnergy.toFixed(0)} Wh at 80% depth of discharge).`],
    [d.propulsion === 'electric' && b.genSunlit < 300, 'Electric propulsion requires ≥300 W sunlit generation.'],
  ];
  for (const [bad, msg] of clampChecks) if (bad) errors.push(msg);
  const needs = [...(PAYLOADS[d.payload].needs || []), ...(COMMS[d.comms].needs || [])];
  for (const n of needs) if (!d.sensors.includes(n)) errors.push(`${SENSORS[n].label} required by selected ${d.payload !== 'none' && PAYLOADS[d.payload].needs?.includes(n) ? 'payload' : 'communications'}.`);
  const allocSum = d.alloc.payload + d.alloc.comms + d.alloc.thermal;
  if (Math.abs(allocSum - 100) > 0.5) errors.push(`Resource allocation must total 100% (now ${allocSum}%).`);
  if (d.bus === 'cubesat' && ['radar', 'biprop'].includes(d.payload)) errors.push('SAR radar cannot fit a CubeSat.');
  if (d.bus === 'cubesat' && d.propulsion === 'biprop') errors.push('Bipropellant system cannot fit a CubeSat.');
  if (b.stationKeepDv > b.totalDv && d.altKm < 600) warnings.push(`Station-keeping needs ~${b.stationKeepDv.toFixed(1)} m/s but only ${b.totalDv.toFixed(1)} m/s available.`);
  if (b.powerMargin < 15 && b.powerMargin >= 0) warnings.push('Thin power margin — expect battery stress in eclipse.');
  // Mission requirements
  if (req.minSats && d.satCount < req.minSats) errors.push(`Mission requires at least ${req.minSats} satellites.`);
  if (req.maxSats && d.satCount > req.maxSats) errors.push(`Mission allows at most ${req.maxSats} satellites.`);
  if (req.payload && d.payload !== req.payload) errors.push(`Mission requires payload: ${PAYLOADS[req.payload].label}.`);
  if (req.propulsion && d.propulsion === 'none') errors.push('Mission requires a propulsion system.');
  if (req.minDv && b.totalDv < req.minDv) errors.push(`Mission requires ≥${req.minDv} m/s Δv capability (design: ${b.totalDv.toFixed(0)} m/s).`);
  if (req.sensors) for (const s of req.sensors) if (!d.sensors.includes(s)) errors.push(`Mission requires ${SENSORS[s].label}.`);
  if (req.minBattery && d.batteryWh < req.minBattery) errors.push(`Mission requires ≥${req.minBattery} Wh battery.`);
  if (req.comms && !req.comms.includes(d.comms)) errors.push(`Mission requires comms: ${req.comms.map((c) => COMMS[c].label).join(' or ')}.`);
  return { ok: errors.length === 0, errors, warnings, b };
}
