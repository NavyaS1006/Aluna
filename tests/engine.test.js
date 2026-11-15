import { describe, it, expect } from 'vitest';
import { SOLO_MISSIONS, SQUAD_MISSIONS } from '../src/data/missions.js';
import { MissionEngine, scoreMission } from '../src/sim/engine.js';
import { initialDesign } from '../src/sim/missionDesign.js';
import { validateDesign } from '../src/sim/design.js';
import { makeElements, propagate, stateToElements, applyBurn, perigeeAlt, apogeeAlt, hohmann, RE, v3 } from '../src/sim/orbit.js';

describe('orbit math', () => {
  it('round-trips state <-> elements', () => {
    const el = makeElements({ altKm: 700, e: 0.01, incDeg: 63, raanDeg: 120, argpDeg: 40, maDeg: 77 });
    const s = propagate(el, 0);
    const el2 = stateToElements(s.r, s.v, 0);
    const s2 = propagate(el2, 1234);
    const s1 = propagate(el, 1234);
    expect(v3.len(v3.sub(s1.r, s2.r))).toBeLessThan(0.5);
  });
  it('hohmann transfer reaches target radius', () => {
    const el = makeElements({ altKm: 500, incDeg: 51.6 });
    const h = hohmann(RE + 500, RE + 700);
    const e1 = applyBurn(el, 0, 'prograde', h.dv1);
    expect(Math.abs(apogeeAlt(e1) - 700)).toBeLessThan(2);
    expect(Math.abs(perigeeAlt(e1) - 500)).toBeLessThan(2);
  });
});

describe('mission catalogue', () => {
  it('has 25 distinct solo and 25 distinct squad missions', () => {
    expect(SOLO_MISSIONS).toHaveLength(25);
    expect(SQUAD_MISSIONS).toHaveLength(25);
    const sig = (m) => JSON.stringify(m.objectives.map((o) => [o.type, o.count, o.alt, o.mb, o.secs, o.hold, o.pct])) + JSON.stringify(m.events);
    expect(new Set(SOLO_MISSIONS.map(sig)).size).toBe(25);
    expect(new Set(SQUAD_MISSIONS.map(sig)).size).toBe(25);
    expect(new Set([...SOLO_MISSIONS, ...SQUAD_MISSIONS].map((m) => m.id)).size).toBe(50);
  });
  it('every squad objective names a role', () => {
    for (const m of SQUAD_MISSIONS) for (const o of m.objectives) expect(o.role, `${m.id} ${o.label}`).toBeTruthy();
  });
});

describe('engine runs every mission headless (AI-assisted, auto-approve)', () => {
  for (const m of [...SOLO_MISSIONS, ...SQUAD_MISSIONS]) {
    it(`${m.id} ${m.title}`, () => {
      const d = initialDesign(m);
      const v = validateDesign(d, m.req);
      const e = new MissionEngine(m, d, { seed: 'test', mode: 'ai' });
      let steps = 0;
      while (!e.s.ended && steps < 20000) {
        if (e.s.sats.some((x) => !x.deployed) && m.manualDeploy && steps % 40 === 0) e.act({ type: 'deploy' });
        e.step(5);
        for (const dc of e.s.decisions) if (dc.status === 'pending') e.act({ type: 'decision', id: dc.id, verdict: 'approve' }); for (const dc of e.s.decisions) if (dc.status === 'auto' && !dc.reviewed && steps % 50 === 0) e.act({ type: 'decision', id: dc.id, verdict: 'ack' });
        if (steps === 10) e.act({ type: 'authorize' });
        steps++;
      }
      const sc = scoreMission(e, 100);
      // eslint-disable-next-line no-console
      console.log(`${m.id} valid=${v.ok}${v.ok ? '' : ' ' + v.errors[0]} status=${e.s.status} t=${(e.s.t / 3600).toFixed(2)}h score=${sc.total} :: ${e.s.endReason} | ${e.s.objectives.map((o) => (o.done ? '✔' : o.failed ? '✘' : '·') + o.type).join(' ')} ${e.s.log.filter((l) => l.msg.includes('LOSS')).map((l) => l.msg).slice(0, 2).join(' / ')}`);
      expect(e.s.ended).toBe(true);
    });
  }
});
