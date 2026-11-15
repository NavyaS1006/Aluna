// Generative explanations (optional). Uses the claude.ai `sample` capability when available to EXPLAIN
// decisions in plain language. It never produces manoeuvres or commands: input is the already-computed,
// validated decision; output is display text only. Falls back to a deterministic explanation.
import { getPlatform } from './platform.js';
import { perigeeAlt, apogeeAlt } from '../sim/orbit.js';

function deterministic(d, e) {
  const sat = e?.sat(d.action?.sat);
  const parts = [`The ${d.agent} agent flagged this because: ${d.reason}`];
  if (sat) parts.push(`${sat.name} is at ${perigeeAlt(sat.el).toFixed(0)}×${apogeeAlt(sat.el).toFixed(0)} km with ${(sat.battery / sat.batteryCap * 100).toFixed(0)}% battery and ${sat.fuel.toFixed(2)} kg propellant.`);
  parts.push(d.risk === 'high' ? 'It is high-risk because it changes the orbit or is irreversible, so ALUNA requires a human decision.' : d.risk === 'medium' ? 'It is medium-risk (pauses work or is hard to reverse), so it needs approval.' : 'It is low-risk and reversible, so the agent may execute it automatically in AI-Assisted mode.');
  return parts.join(' ');
}

export async function explainDecision(d, e) {
  try {
    const p = await getPlatform();
    if (p.sample) {
      const sat = e?.sat(d.action?.sat);
      const ctx = { decision: { title: d.title, agent: d.agent, risk: d.risk, reason: d.reason, consequences: d.consequences, safety: d.safety, action: d.action }, satellite: sat ? { name: sat.name, perigeeKm: +perigeeAlt(sat.el).toFixed(0), apogeeKm: +apogeeAlt(sat.el).toFixed(0), batteryPct: +(sat.battery / sat.batteryCap * 100).toFixed(0), fuelKg: +sat.fuel.toFixed(2), comms: sat.comms } : null };
      const r = await p.sample(`You are the explanation layer of ALUNA, an educational satellite-operations game. Explain to the player in 2-3 short sentences why this already-computed, safety-validated recommendation makes sense and what trade-off they are accepting. Do not invent numbers beyond those given, do not propose different manoeuvres, and do not claim real-world flight certification.\n\nDATA:\n${JSON.stringify(ctx)}`, { modelTier: 'quick', cache: true });
      if (r?.text) return r.text.trim();
    }
  } catch (err) { console.warn('sample unavailable', err?.code || err); }
  return deterministic(d, e);
}

export async function askAluna(question, context) {
  try {
    const p = await getPlatform();
    if (p.sample) {
      const r = await p.sample(`You are ALUNA's operations tutor inside an educational space game. Answer briefly (max 5 sentences) about orbital mechanics, satellite operations or how to play. Game facts: Manual vs AI-Assisted modes; agents (health, power, comms, collision, planning, resource, fleet) auto-execute only low-risk actions; medium/high risk need human approval; manoeuvres come only from deterministic planners and a safety validator; 3 attempts then 1-hour cooldown. Never claim certification for real flight.\nContext: ${JSON.stringify(context || {})}\nQuestion: ${question}`, { modelTier: 'quick', cache: false });
      if (r?.text) return r.text.trim();
    }
  } catch (err) { return `ALUNA AI is unavailable in this view (${err?.code || 'offline'}). Try the Training room tutorials.`; }
  return 'ALUNA AI explanations need the page to be opened inside claude.ai. The Training room covers controls, orbits, power and collision avoidance.';
}
