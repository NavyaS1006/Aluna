import { describe, it, expect } from 'vitest';
import { missionById } from '../src/data/missions.js';
import { MissionEngine } from '../src/sim/engine.js';
import { initialDesign } from '../src/sim/missionDesign.js';
import { validateDesign, DEFAULT_DESIGN } from '../src/sim/design.js';
import { perigeeAlt } from '../src/sim/orbit.js';

const run = (e, secs) => { const end = e.s.t + secs; while (e.s.t < end && !e.s.ended) e.step(5); };

describe('scripted player playthroughs', () => {
  it('S01 tutorial: deploy, inspect, contact → success', () => {
    const m = missionById('S01'); const e = new MissionEngine(m, initialDesign(m), { seed: 'p1' });
    run(e, 60); e.act({ type: 'inspect', sat: 0 });
    run(e, 2 * 3600);
    expect(e.s.status).toBe('success');
  });
  it('S02 manual Hohmann transfer reaches 550 km', () => {
    const m = missionById('S02'); const e = new MissionEngine(m, initialDesign(m), { seed: 'p2' });
    run(e, 120);
    const r = e.act({ type: 'plan_transfer', sat: 0, alt: 550 });
    expect(r.ok).toBe(true);
    run(e, 3 * 3600);
    expect(e.s.status).toBe('success');
  });
  it('S06 string-of-pearls formation via drift burns', () => {
    const m = missionById('S06'); const e = new MissionEngine(m, initialDesign(m), { seed: 'p3' });
    e.act({ type: 'deploy' }); run(e, 30); e.act({ type: 'deploy' }); run(e, 30); e.act({ type: 'deploy' }); run(e, 30);
    expect(e.act({ type: 'burn', sat: 1, dir: 'retrograde', dv: 6 }).ok).toBe(true);
    expect(e.act({ type: 'burn', sat: 2, dir: 'retrograde', dv: 12 }).ok).toBe(true);
    let stopped = false;
    while (!e.s.ended && e.s.t < 5 * 3600) {
      run(e, 60);
      const gaps = e.alongTrackGaps(e.aliveSats());
      if (!stopped && gaps.every((g) => g > 90)) { e.act({ type: 'burn', sat: 1, dir: 'prograde', dv: 6 }); e.act({ type: 'burn', sat: 2, dir: 'prograde', dv: 12 }); stopped = true; }
    }
    expect(e.s.status).toBe('success');
  });
  it('S09 manual collision avoidance via planner', () => {
    const m = missionById('S09'); const e = new MissionEngine(m, initialDesign(m), { seed: 'p4', mode: 'manual' });
    let done = false;
    while (!e.s.ended && e.s.t < 3 * 3600) {
      run(e, 30);
      const c = e.s.conjunctions.find((x) => x.status === 'open' && x.bKind === 'debris' && ['high', 'critical'].includes(x.risk));
      if (c && !done) { const p = e.act({ type: 'plan_avoid', conj: c.id }); expect(p.ok).toBe(true); const b = e.act({ type: 'burn', sat: p.plan.sat, dir: p.plan.dir, dv: p.plan.dv }); expect(b.ok).toBe(true); done = true; }
    }
    expect(e.s.decisions.length).toBe(0); // manual mode: no agent decisions
    expect(e.s.status).toBe('success');
  });
});

describe('modes, roles, persistence', () => {
  it('switching Manual ↔ AI preserves state', () => {
    const m = missionById('S17'); const e = new MissionEngine(m, initialDesign(m), { seed: 'm', mode: 'ai' });
    run(e, 1800);
    const before = JSON.stringify({ t: e.s.t, sats: e.s.sats.map((x) => [x.el, x.battery, x.fuel]), obj: e.s.objectives.map((o) => o.progress), log: e.s.log.length });
    e.act({ type: 'set_mode', mode: 'manual' });
    const after = JSON.stringify({ t: e.s.t, sats: e.s.sats.map((x) => [x.el, x.battery, x.fuel]), obj: e.s.objectives.map((o) => o.progress), log: e.s.log.length - 1 });
    expect(after).toBe(before);
    expect(e.s.decisions.some((d) => d.status === 'pending')).toBe(false);
    const nDec = e.s.decisions.length;
    run(e, 600);
    expect(e.s.decisions.length).toBe(nDec); // no agent activity in manual
    e.act({ type: 'set_mode', mode: 'ai' }); run(e, 600);
    expect(e.s.mode).toBe('ai');
  });
  it('low-risk actions auto-execute; high-risk wait for approval', () => {
    const m = missionById('S09'); const e = new MissionEngine(m, initialDesign(m), { seed: 'a', mode: 'ai' });
    let high;
    while (!e.s.ended && e.s.t < 3 * 3600 && !high) { run(e, 30); high = e.s.decisions.find((d) => d.risk === 'high' && d.status === 'pending'); }
    expect(high).toBeTruthy();
    expect(high.action.type).toBe('burn');
    expect(e.s.stats.burns).toBe(0); // not executed without approval
    const r = e.act({ type: 'decision', id: high.id, verdict: 'approve' });
    expect(r.ok).toBe(true); expect(e.s.stats.burns).toBe(1);
  });
  it('squad roles gate actions', () => {
    const m = missionById('Q01'); const e = new MissionEngine(m, initialDesign(m), { seed: 'r', squad: true });
    expect(e.act({ type: 'deploy' }, { roles: ['systems'] }).ok).toBe(false);
    expect(e.act({ type: 'deploy' }, { roles: ['flight'] }).ok).toBe(true);
    expect(e.act({ type: 'authorize' }, { roles: ['flight'] }).ok).toBe(false);
    expect(e.act({ type: 'authorize' }, { roles: ['commander'] }).ok).toBe(true);
  });
  it('serialize/restore continues identically', () => {
    const m = missionById('S16'); const d = initialDesign(m);
    const a = new MissionEngine(m, d, { seed: 'z' }); run(a, 900);
    const b = MissionEngine.restore(m, d, a.serialize());
    run(a, 900); run(b, 900);
    expect(JSON.stringify(b.s.sats.map((x) => x.battery))).toBe(JSON.stringify(a.s.sats.map((x) => x.battery)));
  });
  it('different seeds produce different event timelines; same seed reproduces', () => {
    const m = missionById('S24'); const d = initialDesign(m);
    const t = (seed) => new MissionEngine(m, d, { seed }).s.scheduled.filter((x) => x.kind === 'event').map((x) => `${x.ev.type}@${x.t.toFixed(0)}`).join(',');
    expect(t('A')).toBe(t('A'));
    expect(t('A')).not.toBe(t('B'));
  });
  it('design validation rejects impossible configurations', () => {
    const bad = { ...DEFAULT_DESIGN, bus: 'cubesat', panelArea: 5, payload: 'radar', satCount: 20 };
    const v = validateDesign(bad, {});
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(2);
    expect(validateDesign(DEFAULT_DESIGN, {}).ok).toBe(true);
    expect(validateDesign({ ...DEFAULT_DESIGN, comms: 'optical', sensors: [] }, {}).ok).toBe(false);
  });
  it('safety validator blocks burns below perigee floor and beyond fuel', () => {
    const m = missionById('S07'); const e = new MissionEngine(m, initialDesign(m), { seed: 'v' }); run(e, 120); expect(e.s.ended).toBe(false);
    let rej = null;
    for (let k = 0; k < 12 && !rej; k++) { const r = e.act({ type: 'burn', sat: 0, dir: 'retrograde', dv: 59 }); if (!r.ok) rej = r.msg; run(e, 10); }
    expect(rej).toMatch(/perigee|propellant/i);
    expect(e.act({ type: 'burn', sat: 0, dir: 'prograde', dv: 500 }).ok).toBe(false); // exceeds per-burn limit
  });
});
