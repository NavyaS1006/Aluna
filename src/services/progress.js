// Mission progression: unlocking, 3 attempts → 1 h cooldown, scores, rewards, achievements, resets.
// Solo progress lives in the player's private data/users/<id>/progress document.
// Squad progress lives in the squad leader's squads/<leaderId> document (shared with the squad).
// Cooldown timestamps are wall-clock epoch ms stored server-side, so they survive refresh,
// logout and other devices.
import { getPlatform } from './platform.js';
import { SOLO_MISSIONS, SQUAD_MISSIONS } from '../data/missions.js';

export const MAX_ATTEMPTS = 3;
export const COOLDOWN_MS = 60 * 60 * 1000;

export const ACHIEVEMENTS = [
  { id: 'first_flight', name: 'First Flight', desc: 'Complete your first mission.', icon: '🚀', test: (p) => countDone(p.solo) + countDone(p.squad) >= 1 },
  { id: 'beginner', name: 'Cadet Graduate', desc: 'Complete Solo missions 1–5.', icon: '🎓', test: (p) => [1, 2, 3, 4, 5].every((n) => p.solo?.[`S0${n}`]?.completed) },
  { id: 'intermediate', name: 'Flight Controller', desc: 'Complete Solo missions 6–15.', icon: '🛰', test: (p) => range(6, 15).every((n) => p.solo?.[sid(n)]?.completed) },
  { id: 'advanced', name: 'Operations Lead', desc: 'Complete Solo missions 16–20.', icon: '🧭', test: (p) => range(16, 20).every((n) => p.solo?.[sid(n)]?.completed) },
  { id: 'campaign', name: 'ALUNA Director', desc: 'Complete the entire Solo Campaign.', icon: '👑', test: (p) => countDone(p.solo) >= 25 },
  { id: 'three_star', name: 'Flawless', desc: 'Earn 3 stars on any mission.', icon: '⭐', test: (p, r) => r?.stars === 3 },
  { id: 'debris_dodger', name: 'Debris Dodger', desc: 'Clear 3 conjunctions in one mission.', icon: '☄', test: (p, r) => (r?.stats?.avoided || 0) >= 3 },
  { id: 'ai_partner', name: 'Human–AI Team', desc: 'Approve or modify 5 agent recommendations in one mission.', icon: '🤝', test: (p, r) => (r?.stats?.approved || 0) + (r?.stats?.modified || 0) >= 5 },
  { id: 'skeptic', name: 'Healthy Skeptic', desc: 'Reject an agent recommendation and still win.', icon: '🛑', test: (p, r) => r?.success && (r?.stats?.rejected || 0) >= 1 },
  { id: 'manual_ace', name: 'Manual Ace', desc: 'Win a mission entirely in Manual mode.', icon: '🎛', test: (p, r) => r?.success && r?.stats?.aiTime === 0 },
  { id: 'squad_up', name: 'Squad Up', desc: 'Complete a Squad Ops mission.', icon: '👥', test: (p) => countDone(p.squad) >= 1 },
  { id: 'squad_final', name: 'Constellation Command', desc: 'Complete the Final Squad Operation.', icon: '🌐', test: (p) => p.squad?.Q25?.completed },
  { id: 'xp_5000', name: 'Veteran', desc: 'Earn 5,000 XP.', icon: '🏅', test: (p) => (p.xp || 0) >= 5000 },
];
function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
const sid = (n) => `S${String(n).padStart(2, '0')}`;
function countDone(map) { return Object.values(map || {}).filter((x) => x?.completed).length; }

export const levelFor = (xp) => Math.floor(Math.sqrt((xp || 0) / 150)) + 1;
export const xpForLevel = (lvl) => (lvl - 1) ** 2 * 150;

/** Pure status computation — used by UI and tests. */
export function missionStatus(map, mission, now = Date.now()) {
  const list = mission.mode === 'solo' ? SOLO_MISSIONS : SQUAD_MISSIONS;
  const rec = map?.[mission.id] || {};
  const prev = list[mission.number - 2];
  const unlocked = mission.number === 1 || !!map?.[prev?.id]?.completed;
  const lockedUntil = rec.lockedUntil && rec.lockedUntil > now ? rec.lockedUntil : 0;
  const fails = lockedUntil ? MAX_ATTEMPTS : rec.lockedUntil && rec.lockedUntil <= now ? 0 : rec.fails || 0;
  return { unlocked, completed: !!rec.completed, best: rec.best || 0, stars: rec.stars || 0, plays: rec.plays || 0, fails, attemptsLeft: MAX_ATTEMPTS - fails, lockedUntil, active: rec.active || null, cooldown: !!lockedUntil };
}

/** Apply a finished attempt to a progress map (pure). */
export function applyResult(map, mission, result, now = Date.now()) {
  const m = { ...(map || {}) };
  const rec = { ...(m[mission.id] || {}) };
  if (rec.lockedUntil && rec.lockedUntil <= now) { rec.lockedUntil = 0; rec.fails = 0; }
  rec.plays = (rec.plays || 0) + 1;
  rec.active = null;
  rec.lastPlayed = now;
  if (result.success) {
    rec.completed = true; rec.fails = 0; rec.lockedUntil = 0;
    rec.best = Math.max(rec.best || 0, result.score); rec.stars = Math.max(rec.stars || 0, result.stars || 0);
    rec.firstCompletedAt = rec.firstCompletedAt || now;
  } else {
    rec.fails = (rec.fails || 0) + 1;
    if (rec.fails >= MAX_ATTEMPTS) { rec.lockedUntil = now + COOLDOWN_MS; }
  }
  m[mission.id] = rec;
  return m;
}

export function canStart(map, mission, now = Date.now()) {
  const st = missionStatus(map, mission, now);
  if (!st.unlocked) return { ok: false, msg: 'Locked — complete the previous mission first.' };
  if (st.cooldown) return { ok: false, msg: `Cooldown: ${Math.ceil((st.lockedUntil - now) / 60000)} min remaining after ${MAX_ATTEMPTS} failed attempts.` };
  return { ok: true };
}

// ---------------------------------------------------------------- persistence (solo)
async function soloRef() { const p = await getPlatform(); return p.db.doc(`data/users/${p.uid}/progress`); }

export async function loadProgress() {
  const ref = await soloRef();
  const s = await ref.get();
  const d = s.exists ? s.data() : { solo: {}, squad: {}, history: [], totalScore: 0, xp: 0 };
  return JSON.parse(JSON.stringify(d));
}

/** Marks an attempt as started (backend record). A stale active attempt found later counts as a failure. */
export async function beginSoloAttempt(mission) {
  const ref = await soloRef();
  const prog = await loadProgress();
  const chk = canStart(prog.solo, mission);
  if (!chk.ok) return chk;
  const seed = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  prog.solo[mission.id] = { ...(prog.solo[mission.id] || {}), active: { seed, startedAt: Date.now() } };
  await writeProg(ref, prog);
  return { ok: true, seed };
}

/** Any attempt left "active" (browser closed mid-mission) is recorded as a failed attempt. */
export async function settleAbandoned(currentSeed = null) {
  const ref = await soloRef();
  const prog = await loadProgress();
  let changed = false;
  for (const m of SOLO_MISSIONS) {
    const a = prog.solo[m.id]?.active;
    if (a && a.seed !== currentSeed) {
      prog.solo = applyResult(prog.solo, m, { success: false, score: 0 });
      prog.history = [{ id: m.id, title: m.title, mode: 'solo', success: false, score: 0, t: Date.now(), note: 'Attempt abandoned' }, ...(prog.history || [])].slice(0, 100);
      changed = true;
    }
  }
  if (changed) await writeProg(ref, prog);
  return prog;
}

async function writeProg(ref, prog) { prog.updatedAt = Date.now(); await ref.set(prog); }

export async function recordSoloResult(mission, result) {
  const ref = await soloRef();
  const prog = await loadProgress();
  const before = missionStatus(prog.solo, mission);
  prog.solo = applyResult(prog.solo, mission, result);
  const gainedXp = result.success ? result.xp + (before.completed ? 0 : mission.rewards.xp) : Math.round(result.xp * 0.25);
  prog.xp = (prog.xp || 0) + gainedXp;
  if (result.success) prog.totalScore = (prog.totalScore || 0) + Math.max(0, result.score - (before.best || 0));
  prog.history = [{ id: mission.id, title: mission.title, mode: 'solo', success: result.success, score: result.score, stars: result.stars, t: Date.now(), simTime: result.simTime }, ...(prog.history || [])].slice(0, 100);
  const newAch = await updateAchievements(prog, result);
  await writeProg(ref, prog);
  await syncPublicStats(prog);
  const after = missionStatus(prog.solo, mission);
  const next = SOLO_MISSIONS[mission.number];
  return { prog, gainedXp, newAch, after, nextUnlocked: next ? missionStatus(prog.solo, next).unlocked : null, next };
}

export async function updateAchievements(prog, result) {
  const p = await getPlatform();
  const pref = p.db.doc(`data/users/${p.uid}/profile`);
  const prof = (await pref.get()).data() || {};
  const have = new Set(prof.achievements || []);
  const fresh = ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.test(prog, result)).map((a) => a.id);
  if (fresh.length) await pref.update({ achievements: [...have, ...fresh] });
  return fresh;
}

export async function syncPublicStats(prog) {
  const p = await getPlatform();
  try {
    await p.db.doc(`players/${p.uid}`).update({ xp: prog.xp || 0, level: levelFor(prog.xp), score: prog.totalScore || 0, missions: countDone(prog.solo) + countDone(prog.squad), lastSeen: Date.now() });
  } catch { /* ignore */ }
}

/** Full reset — requires explicit confirmation in the UI. scope: 'solo' | 'squad' | 'all' */
export async function resetProgress(scope) {
  const ref = await soloRef();
  const prog = await loadProgress();
  if (scope === 'solo' || scope === 'all') prog.solo = {};
  if (scope === 'squad' || scope === 'all') prog.squad = {};
  if (scope === 'all') { prog.history = []; prog.xp = 0; prog.totalScore = 0; const p = await getPlatform(); await p.db.doc(`data/users/${p.uid}/profile`).update({ achievements: [] }); }
  prog.resetAt = Date.now();
  await writeProg(ref, prog);
  await syncPublicStats(prog);
  return prog;
}

/** Personal record of a squad mission (history/xp); squad unlocks are tracked on the squad doc. */
export async function recordSquadPersonal(mission, result, squadInfo) {
  const ref = await soloRef();
  const prog = await loadProgress();
  prog.squad = applyResult(prog.squad, mission, result);
  prog.xp = (prog.xp || 0) + (result.success ? result.xp + mission.rewards.xp : Math.round(result.xp * 0.25));
  if (result.success) prog.totalScore = (prog.totalScore || 0) + result.score;
  prog.history = [{ id: mission.id, title: mission.title, mode: 'squad', success: result.success, score: result.score, stars: result.stars, t: Date.now(), squad: squadInfo }, ...(prog.history || [])].slice(0, 100);
  const newAch = await updateAchievements(prog, result);
  await writeProg(ref, prog);
  await syncPublicStats(prog);
  const p = await getPlatform();
  try { const pr = p.db.doc(`data/users/${p.uid}/profile`); const d = (await pr.get()).data(); await pr.update({ squadHistory: [{ ...squadInfo, mission: mission.id, success: result.success, t: Date.now() }, ...(d.squadHistory || [])].slice(0, 50) }); } catch { /* ignore */ }
  return { prog, newAch };
}
