// Mission lifecycle for Solo Campaign (+ shared helpers used by Squad Ops).
import { useGame, runtime, bumpRuntime, useHud } from '../state/store.js';
import { MissionEngine, scoreMission } from '../sim/engine.js';
import { initialDesign } from '../sim/missionDesign.js';
import { getPlatform, prefsLocal } from '../services/platform.js';
import { beginSoloAttempt, recordSoloResult, loadProgress } from '../services/progress.js';
import { missionById } from '../data/missions.js';
import { TRAINING } from '../data/training.js';

const G = () => useGame.getState();

export function openBriefing(mission) {
  G().set({ mission, facility: null, result: null });
  G().go('briefing');
}

export async function openDesigner() {
  const m = G().mission;
  const p = await getPlatform();
  let saved = null;
  try { const prof = (await p.db.doc(`data/users/${p.uid}/profile`).get()).data(); saved = prof?.lastDesigns?.[m.id] || null; } catch { /* ignore */ }
  G().set({ design: initialDesign(m, saved), autonomy: { startMode: m.startMode || 'manual' } });
  G().go('designer');
}

export async function launchSolo(design, startMode) {
  const m = G().mission;
  const isTraining = m.mode === 'training';
  let seed;
  if (isTraining) seed = `train-${Date.now().toString(36)}`;
  else {
    const r = await beginSoloAttempt(m);
    if (!r.ok) { G().toast(r.msg, 'bad'); return false; }
    seed = r.seed;
    prefsLocal.set('liveSeed', seed);
  }
  // remember last design for this mission
  try { const p = await getPlatform(); const ref = p.db.doc(`data/users/${p.uid}/profile`); const prof = (await ref.get()).data(); await ref.update({ lastDesigns: { ...(prof?.lastDesigns || {}), [m.id]: design } }); } catch { /* ignore */ }
  startEngine(m, design, seed, startMode);
  G().set({ attempt: { seed, startMode }, design, launchSkip: false });
  G().go('launch');
  return true;
}

export function startEngine(m, design, seed, startMode, squad = false) {
  const e = new MissionEngine(m, design, { seed, mode: startMode || m.startMode || 'manual', squad });
  e.s.timeScale = G().profile?.prefs?.warp || m.timeScale || 60;
  runtime.engine = e;
  runtime.startedReal = performance.now();
  runtime.lastSave = performance.now();
  useHud.setState({ selected: null, focus: null });
  bumpRuntime();
  return e;
}

/** Restart Mission: same attempt & seed, fresh temporary state, replays the launch. */
export function restartMission() {
  const { mission, design, attempt } = G();
  if (!runtime.engine) return;
  startEngine(mission, design, attempt.seed, attempt.startMode);
  G().set({ launchSkip: false });
  G().go('launch');
  G().toast('Mission restarted — temporary state reset. Permanent progress preserved.', 'info');
}

export async function saveLive(force = false) {
  const e = runtime.engine; const { mission, design, attempt } = G();
  if (!e || !mission || mission.mode !== 'solo' || e.s.ended) return;
  if (!force && performance.now() - (runtime.lastSave || 0) < 20000) return;
  runtime.lastSave = performance.now();
  const data = e.serialize();
  data.s.log = data.s.log.slice(-60);
  data.s.decisions = data.s.decisions.slice(-40);
  try { const p = await getPlatform(); await p.db.doc(`data/users/${p.uid}/live`).set({ missionId: mission.id, seed: attempt.seed, startMode: attempt.startMode, design, data, savedAt: Date.now() }); } catch (err) { console.warn('live save failed', err); }
}

export async function loadLive() {
  const p = await getPlatform();
  const s = await p.db.doc(`data/users/${p.uid}/live`).get();
  return s.exists ? s.data() : null;
}

export async function resumeLive() {
  const live = await loadLive();
  const prog = await loadProgress();
  if (!live || prog.solo?.[live.missionId]?.active?.seed !== live.seed) { G().toast('No resumable mission found.', 'warn'); return; }
  const m = missionById(live.missionId);
  const e = MissionEngine.restore(m, live.design, live.data);
  runtime.engine = e; runtime.startedReal = performance.now(); runtime.lastSave = performance.now();
  prefsLocal.set('liveSeed', live.seed);
  G().set({ mission: m, design: live.design, attempt: { seed: live.seed, startMode: live.startMode }, result: null, facility: null });
  bumpRuntime();
  G().go('space');
  G().toast(`Resumed ${m.title} at T+${Math.floor(e.s.t / 60)} min.`, 'good');
}

export async function finishSolo() {
  const e = runtime.engine; const { mission } = G();
  if (!e) return;
  const sc = scoreMission(e, (performance.now() - runtime.startedReal) / 1000);
  const result = { success: e.s.status === 'success', score: sc.total, stars: sc.stars, xp: sc.xp, simTime: e.s.t, stats: e.s.stats, reason: e.s.endReason, sc, mode: e.s.mode };
  let rec = null;
  if (mission.mode === 'solo') {
    try {
      rec = await recordSoloResult(mission, result);
      G().set({ progress: rec.prog });
      const p = await getPlatform();
      await p.db.doc(`data/users/${p.uid}/live`).delete();
      // archive decisions for the AI Ops center
      const ref = p.db.doc(`data/users/${p.uid}/airecords`);
      const prev = (await ref.get()).data()?.items || [];
      const items = [...e.s.decisions.filter((d) => d.status !== 'withdrawn').slice(-30).map((d) => ({ mission: mission.id, title: d.title, agent: d.agent, risk: d.risk, status: d.status, reason: d.reason, t: d.t, by: d.by || null })), ...prev].slice(0, 150);
      await ref.set({ items, updatedAt: Date.now() });
      await p.db.doc(`data/users/${p.uid}/fleet`).set({ mission: mission.id, title: mission.title, design: G().design, t: Date.now(), sats: e.s.sats.map((x) => ({ id: x.id, name: x.name, color: x.color, el: x.el, alive: x.alive, health: x.health, battery: x.battery, batteryCap: x.batteryCap, fuel: x.fuel, fuelCap: x.fuelCap, comms: x.comms, sensor: x.sensor, prop: x.prop, deployed: x.deployed })), conjunctions: e.s.conjunctions.slice(-20), simT: e.s.t });
    } catch (err) { console.error(err); G().toast(`Could not save result: ${err?.message || err}`, 'bad'); }
    prefsLocal.set('liveSeed', null);
  }
  G().set({ result: { ...result, rec } });
  G().go('results');
}

export function abortMission() {
  runtime.engine?.act({ type: 'abort' });
}

export function backToHQ() {
  runtime.engine = null;
  bumpRuntime();
  G().set({ facility: null, hqArrived: true, launchSkip: false });
  G().go('hq');
}

export function startTraining(id) {
  const m = TRAINING.find((x) => x.id === id);
  G().set({ mission: m, facility: null, result: null });
  G().go('briefing');
}
