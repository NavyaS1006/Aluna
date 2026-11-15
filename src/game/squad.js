// Squad Ops real-time session.
// Authority model: the squad leader's client hosts the authoritative MissionEngine ("host-authoritative").
// Members run a mirror engine (same seed/design → identical deterministic background objects) that is
// overwritten by compact snapshots broadcast on the squad's named room. Members send actions to the host,
// which applies role permissions and validation. Full state is checkpointed to the database every 10 s so
// a reloading member — or a reloading host — can resume.
import { useGame, runtime, bumpRuntime, useHud } from '../state/store.js';
import { getPlatform } from '../services/platform.js';
import { MissionEngine, scoreMission, ROLE_LABELS } from '../sim/engine.js';
import { effectiveRoles, watchSquad, watchMemberships, reconcileMembers, updateSquad, myMembership, setReady } from '../services/social.js';
import { applyResult, canStart, recordSquadPersonal, MAX_ATTEMPTS } from '../services/progress.js';
import { missionById } from '../data/missions.js';
import { initialDesign } from '../sim/missionDesign.js';

const G = () => useGame.getState();
const round = (x, n = 3) => (typeof x === 'number' ? +x.toFixed(n) : x);
const trim = (s, n = 150) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s);

let ctx = { unsubs: [], room: null, leader: null, squad: null, memberships: [], hostState: {}, lastSquadMembersSig: '' };

export function roomName(code) { return `sq-${String(code).toLowerCase().replace(/[^a-z0-9]/g, '')}`; }

/** Begin following a squad (called when entering Squad Ops HQ or after joining/creating). */
export async function attachSquad(leaderUid) {
  detachSquad();
  const p = await getPlatform();
  ctx.leader = leaderUid;
  ctx.unsubs.push(watchSquad(leaderUid, (sq) => onSquad(sq, p)));
  if (leaderUid === p.uid) ctx.unsubs.push(watchMemberships(leaderUid, (ms) => onMemberships(ms, p)));
  else ctx.unsubs.push(watchMemberships(leaderUid, (ms) => { ctx.memberships = ms; G().set({ memberships: ms }); }));
}

export function detachSquad() {
  for (const u of ctx.unsubs) try { u(); } catch { /* ignore */ }
  ctx.unsubs = [];
  if (ctx.room) { ctx.room.leave?.().catch(() => {}); ctx.room = null; }
  ctx.squad = null; ctx.leader = null;
  G().set({ squad: null, squadRoom: null, memberships: [], myRoles: [], myRoleLabel: null });
}

async function ensureRoom(code) {
  const p = await getPlatform();
  const name = roomName(code);
  if (ctx.room?.name === name) return ctx.room;
  if (ctx.room) await ctx.room.leave?.().catch(() => {});
  if (!p.room) return null;
  try {
    ctx.room = await p.room.join(name);
    G().set({ squadRoom: ctx.room });
    wireRoom(ctx.room, p);
    return ctx.room;
  } catch (e) { console.warn('room join failed', e); G().toast(`Real-time squad channel unavailable (${e?.code || e}).`, 'bad'); return null; }
}

function onMemberships(ms, p) {
  ctx.memberships = ms;
  G().set({ memberships: ms });
  const sq = ctx.squad;
  if (!sq || sq.leader !== p.uid) return;
  const members = reconcileMembers(sq, ms);
  const sig = JSON.stringify(members);
  if (sig !== JSON.stringify(sq.members) && sig !== ctx.lastSquadMembersSig) { ctx.lastSquadMembersSig = sig; updateSquad({ members }).catch(() => {}); }
}

function onSquad(sq, p) {
  const prev = ctx.squad;
  ctx.squad = sq;
  if (!sq) { G().set({ squad: null }); return; }
  const roles = effectiveRoles(sq)[p.uid] || [];
  const amMember = sq.members.some((m) => m.uid === p.uid);
  G().set({ squad: sq, myRoles: roles, myRoleLabel: roles.map((r) => ROLE_LABELS[r].split(' ')[0]).join(' / ') });
  if (amMember) ensureRoom(sq.code);
  if (!amMember && sq.leader !== p.uid) return;
  // follow leader-driven status transitions
  const st = G().screen;
  if (sq.status !== prev?.status || sq.missionId !== prev?.missionId) {
    const m = sq.missionId ? missionById(sq.missionId) : null;
    if (sq.status === 'briefing' && m) { G().set({ mission: m, result: null, facility: null }); G().go('briefing'); }
    if (sq.status === 'designing' && m) { G().set({ mission: m, design: sq.design || initialDesign(m), autonomy: { startMode: sq.startMode || m.startMode || 'manual' } }); G().go('designer'); }
    if (sq.status === 'launch' && m && sq.seed && st !== 'space' && st !== 'launch') startSquadMission(sq, p, Date.now() - (sq.launchAt || 0) > 60000);
    if (sq.status === 'idle' && ['briefing', 'designer'].includes(st)) { G().go('hq'); }
  }
  if (sq.status === 'designing' && sq.leader !== p.uid && sq.design) G().set({ design: sq.design, autonomy: { startMode: sq.startMode || 'manual' } });
  if (sq.status === 'active' && st !== 'space' && st !== 'launch' && st !== 'results' && sq.seed && !runtime.engine) startSquadMission(sq, p, true);
}

// ---------------------------------------------------------------- leader controls
export async function leaderSelectMission(m) {
  const sq = ctx.squad; if (!sq) return;
  const chk = canStart(sq.progress, m);
  if (!chk.ok) { G().toast(chk.msg, 'bad'); return; }
  if (sq.members.length < 2) G().toast('Tip: Squad Ops is designed for 2–4 players. You can start alone to test, but objectives assume a team.', 'warn', 6000);
  await updateSquad({ status: 'briefing', missionId: m.id, design: null, seed: null });
  await setReady(false);
}
export async function leaderToDesign() {
  const sq = ctx.squad; const m = missionById(sq.missionId);
  await updateSquad({ status: 'designing', design: initialDesign(m), startMode: m.startMode || 'manual' });
}
let designTimer = null;
export function leaderDesignChanged(d) { clearTimeout(designTimer); designTimer = setTimeout(() => updateSquad({ design: d }).catch(() => {}), 500); }
export function leaderStartModeChanged(mode) { updateSquad({ startMode: mode }).catch(() => {}); }
export async function leaderLaunch(design, startMode) {
  const sq = ctx.squad; const m = missionById(sq.missionId);
  const chk = canStart(sq.progress, m);
  if (!chk.ok) { G().toast(chk.msg, 'bad'); return; }
  const seed = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const progress = { ...(sq.progress || {}), [m.id]: { ...(sq.progress?.[m.id] || {}), active: { seed, startedAt: Date.now() } } };
  await updateSquad({ status: 'launch', seed, design, startMode, progress, launchAt: Date.now() });
}
export async function leaderBackToIdle() { await updateSquad({ status: 'idle', missionId: null, seed: null }); }
export function allReady() {
  const sq = ctx.squad; if (!sq) return false;
  return sq.members.every((m) => m.uid === sq.leader || ctx.memberships.find((x) => x.uid === m.uid)?.ready);
}

// ---------------------------------------------------------------- mission start (all clients)
async function startSquadMission(sq, p, resume) {
  const m = missionById(sq.missionId);
  const isHost = sq.leader === p.uid;
  let e;
  if (resume) {
    const live = await p.db.doc(`squadlive/${sq.leader}`).get().catch(() => null);
    if (live?.exists && live.data().seed === sq.seed) e = MissionEngine.restore(m, sq.design, live.data().data);
  }
  if (!e) e = new MissionEngine(m, sq.design, { seed: sq.seed, mode: sq.startMode || 'manual', squad: true });
  if (!isHost) e.mirror = { snapT: e.s.t, at: performance.now() };
  e.renderT = isHost ? e.renderT.bind(e) : () => { const mm = e.mirror; if (e.s.ended || e.s.paused) return e.s.t; return mm.snapT + Math.min(3, (performance.now() - mm.at) / 1000) * e.s.timeScale; };
  runtime.engine = e; runtime.startedReal = performance.now(); runtime.plans = {};
  const me = sq.members.find((x) => x.uid === p.uid);
  const roles = effectiveRoles(sq)[p.uid] || [];
  runtime.squadClient = makeClient(isHost, p, roles, me);
  useHud.setState({ selected: null, focus: null });
  G().set({ mission: m, design: sq.design, attempt: { seed: sq.seed, startMode: sq.startMode }, launchSkip: false, result: null, facility: null });
  bumpRuntime();
  G().go(resume ? 'space' : 'launch');
  if (!isHost) setTimeout(() => ctx.room?.emit('hello', { t: Date.now() }).catch(() => {}), 500);
  if (isHost && !resume) setTimeout(() => { if (ctx.squad?.status === 'launch' && ctx.squad.seed === sq.seed) updateSquad({ status: 'active' }).catch(() => {}); }, 8000);
}

function compactSat(x) {
  return [x.id, x.deployed ? 1 : 0, x.alive ? 1 : 0, x.el ? [round(x.el.a, 4), round(x.el.e, 7), round(x.el.i, 7), round(x.el.raan, 7), round(x.el.argp, 7), round(x.el.M, 7), round(x.el.epoch, 2)] : null,
    round(x.health, 1), round(x.battery, 1), round(x.batteryCap, 1), round(x.fuel, 3), round(x.solarEff, 3), x.comms, x.commsBackup ? 1 : 0, x.sensor, x.prop, x.propBackup ? 1 : 0, x.payload, x.payloadOn ? 1 : 0, x.safeMode ? 1 : 0, x.loadShed ? 1 : 0,
    round(x.extraLoad, 0), round(x.dataStored, 0), round(x.dataDown, 0), x.inContact, x.eclipse ? 1 : 0, round(x.gen, 0), round(x.load, 0), x.busy, x.linked ? 1 : 0, round(x.minBattPct, 0), round(x.initAlt, 1)];
}
function applySat(x, c) {
  const k = ['id', 'deployed', 'alive', 'el', 'health', 'battery', 'batteryCap', 'fuel', 'solarEff', 'comms', 'commsBackup', 'sensor', 'prop', 'propBackup', 'payload', 'payloadOn', 'safeMode', 'loadShed', 'extraLoad', 'dataStored', 'dataDown', 'inContact', 'eclipse', 'gen', 'load', 'busy', 'linked', 'minBattPct', 'initAlt'];
  k.forEach((key, i) => {
    let v = c[i];
    if (key === 'el') v = v ? { a: v[0], e: v[1], i: v[2], raan: v[3], argp: v[4], M: v[5], epoch: v[6] } : null;
    else if (['deployed', 'alive', 'commsBackup', 'propBackup', 'payloadOn', 'safeMode', 'loadShed', 'eclipse', 'linked'].includes(key)) v = !!v;
    x[key] = v;
  });
}

function makeClient(isHost, p, roles, me) {
  const room = ctx.room;
  const name = G().profile?.displayName || 'Crew';
  const client = {
    isHost, roles,
    localActor: () => ({ roles: client.roles, name, uid: p.uid }),
    sendAction: (a) => {
      if (!room?.connected?.()) { G().toast('Disconnected from squad channel — action not sent. Reconnecting…', 'bad'); return; }
      room.emit('act', { a, n: name }).catch((e) => G().toast(`Send failed: ${e?.code}`, 'bad'));
    },
    lastCore: 0, lastSats: 0, lastAux: 0, lastSave: 0,
    hostTick: (now) => {
      const e = runtime.engine; if (!e || !room) return;
      if (now - client.lastCore > 450) { client.lastCore = now; sendCore(e); }
      if (now - client.lastSats > 450) { client.lastSats = now; sendSats(e); }
      if (now - client.lastAux > 1000) { client.lastAux = now; sendAux(e); }
      if (now - client.lastSave > 10000) { client.lastSave = now; const d = e.serialize(); d.s.log = d.s.log.slice(-50); d.s.decisions = d.s.decisions.slice(-30); p.db.doc(`squadlive/${p.uid}`).set({ seed: G().attempt.seed, mission: e.mission.id, data: d, savedAt: Date.now() }).catch(() => {}); }
    },
    hostFinish: () => finishSquad(p),
    afterLocalAction: () => { client.lastCore = 0; client.lastSats = 0; client.lastAux = 0; },
  };
  const sendCore = (e) => {
    const s = e.s;
    room.emit('core', { t: round(s.t, 1), ts: s.timeScale, p: s.paused ? 1 : 0, m: s.mode, st: s.status, en: s.ended ? 1 : 0, er: trim(s.endReason, 120), lf: round(s.linkedFrac || 0, 2), sd: s.stationsDown, sm: s.storm, ob: s.objectives.map((o) => [o.id, o.done ? 1 : 0, o.failed ? 1 : 0, round(o.progress, 3), trim(o.why, 60), o.gaps || null, o.waiting ? 1 : 0]), stt: { ...s.stats, inspected: s.stats.inspected.length }, ins: s.stats.inspected, cn: Object.keys(s.contacted).length }).catch(() => {});
  };
  const sendSats = (e) => {
    const sats = e.s.sats;
    for (let i = 0; i < sats.length; i += 4) room.emit('sats', { i, d: sats.slice(i, i + 4).map(compactSat) }).catch(() => {});
  };
  const sendAux = (e) => {
    const s = e.s;
    const pending = s.decisions.filter((d) => d.status === 'pending').slice(-3);
    const recent = s.decisions.filter((d) => d.status !== 'pending').slice(-2);
    const dec = [...pending, ...recent].map((d) => ({ id: d.id, key: d.key, ag: d.agent, ti: trim(d.title, 70), ac: d.action, re: trim(d.reason, 120), ri: d.risk, co: round(d.confidence, 2), cq: trim(d.consequences, 90), sf: trim(d.safety, 70), st: d.status, t: round(d.t, 0), by: d.by, rv: d.reviewed ? 1 : 0 }));
    room.emit('aux1', { dec }).catch(() => {});
    const cj = s.conjunctions.filter((c) => c.status === 'open' || s.t - c.tca < 300).slice(-6).map((c) => ({ id: c.id, a: c.a, b: c.b, bn: c.bName, bk: c.bKind, d: round(c.d, 3), tca: round(c.tca, 0), sg: round(c.sigma, 2), rs: round(c.relSpeed, 2), ri: c.risk, st: c.status }));
    const th = s.debris.filter((d) => d.kind === 'threat').slice(-6).map((d) => ({ id: d.id, n: d.name, el: [round(d.el.a, 4), round(d.el.e, 7), round(d.el.i, 7), round(d.el.raan, 7), round(d.el.argp, 7), round(d.el.M, 7), round(d.el.epoch, 1)] }));
    room.emit('aux2', { cj, th, lg: s.log.slice(-8).map((l) => [round(l.t, 0), l.sev, trim(l.msg, 140)]) }).catch(() => {});
  };
  client.sendCore = sendCore; client.sendSats = sendSats; client.sendAux = sendAux;
  return client;
}

function wireRoom(room, p) {
  room.on('act', (msg) => {
    const c = runtime.squadClient; const e = runtime.engine;
    if (!c?.isHost || !e || msg.isMe && msg.sameTab) return;
    const sq = ctx.squad; const uid = msg.by || null;
    const member = sq?.members.find((m) => m.uid === uid);
    if (!member) { room.emit('ack', { to: msg.peer, ok: false, msg: 'Not a squad member.' }).catch(() => {}); return; }
    const roles = effectiveRoles(sq)[uid] || [];
    const res = e.act(msg.data?.a || {}, { roles, name: trim(msg.data?.n || 'Crew', 20), uid });
    room.emit('ack', { to: msg.peer, ok: res.ok, msg: trim(res.msg, 200), plan: res.plan || null }).catch(() => {});
    c.afterLocalAction(); bumpRuntime();
  });
  room.on('hello', () => { const c = runtime.squadClient; if (c?.isHost && runtime.engine) { c.sendCore(runtime.engine); c.sendSats(runtime.engine); c.sendAux(runtime.engine); } });
  room.on('ack', (msg) => {
    const c = runtime.squadClient; if (!c || c.isHost) return;
    const myPeer = p.room?.peerId;
    if (msg.data?.to && room.peers().find((x) => x.sameTab)?.peer !== msg.data.to && msg.data.to !== myPeer) return;
    if (msg.data?.plan) { runtime.plans = { ...(runtime.plans || {}), [msg.data.plan.conj]: msg.data.plan }; }
    G().toast(msg.data?.msg || 'OK', msg.data?.ok ? 'good' : 'bad', msg.data?.ok ? 2500 : 5000);
    bumpRuntime();
  });
  const isClient = () => runtime.squadClient && !runtime.squadClient.isHost && runtime.engine;
  room.on('core', (msg) => {
    if (!isClient()) return; const e = runtime.engine; const s = e.s; const d = msg.data;
    Object.assign(s, { t: d.t, timeScale: d.ts, paused: !!d.p, mode: d.m, status: d.st, ended: !!d.en, endReason: d.er, linkedFrac: d.lf, stationsDown: d.sd || {}, storm: d.sm || null });
    e.mirror = { snapT: d.t, at: performance.now() };
    for (const [id, done, failed, prog, why, gaps, waiting] of d.ob) { const o = s.objectives.find((x) => x.id === id); if (o) Object.assign(o, { done: !!done, failed: !!failed, progress: prog, why, gaps, waiting: !!waiting }); }
    Object.assign(s.stats, { ...d.stt, inspected: d.ins || [] });
    s.contacted = Object.fromEntries(Array.from({ length: d.cn }, (_, i) => [`c${i}`, true]));
    ctx.lastCoreAt = performance.now();
  });
  room.on('sats', (msg) => { if (!isClient()) return; const s = runtime.engine.s; msg.data.d.forEach((c) => { const x = s.sats.find((y) => y.id === c[0]); if (x) applySat(x, c); }); });
  room.on('aux1', (msg) => {
    if (!isClient()) return; const s = runtime.engine.s;
    const incoming = msg.data.dec.map((d) => ({ id: d.id, key: d.key, agent: d.ag, title: d.ti, action: d.ac, reason: d.re, risk: d.ri, confidence: d.co, consequences: d.cq, safety: d.sf, status: d.st, t: d.t, by: d.by, reviewed: !!d.rv }));
    const map = new Map(s.decisions.map((d) => [d.id, d]));
    for (const d of incoming) map.set(d.id, { ...(map.get(d.id) || {}), ...d });
    // decisions no longer pending on host but missing from the recent window: mark resolved
    const pendingIds = new Set(incoming.filter((d) => d.status === 'pending').map((d) => d.id));
    for (const d of map.values()) if (d.status === 'pending' && !pendingIds.has(d.id)) d.status = 'resolved';
    s.decisions = [...map.values()].slice(-60);
  });
  room.on('aux2', (msg) => {
    if (!isClient()) return; const s = runtime.engine.s; const d = msg.data;
    const map = new Map(s.conjunctions.map((c) => [c.id, c]));
    for (const c of d.cj) map.set(c.id, { id: c.id, a: c.a, b: c.b, bName: c.bn, bKind: c.bk, d: c.d, tca: c.tca, sigma: c.sg, relSpeed: c.rs, risk: c.ri, status: c.st });
    s.conjunctions = [...map.values()].slice(-30);
    for (const t of d.th) if (!s.debris.find((x) => x.id === t.id)) s.debris.push({ id: t.id, name: t.n, kind: 'threat', el: { a: t.el[0], e: t.el[1], i: t.el[2], raan: t.el[3], argp: t.el[4], M: t.el[5], epoch: t.el[6] } });
    const last = s.log[s.log.length - 1];
    for (const [t, sev, m] of d.lg) if (!s.log.some((l) => l.t === t && l.msg === m) && (!last || t >= last.t - 1)) s.log.push({ t, sev, msg: m });
    if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  });
  room.on('regroup', (msg) => { if (!(msg.isMe && msg.sameTab)) window.dispatchEvent(new Event('aluna:regroup')); });
  room.on('end', (msg) => {
    if (!isClient()) return;
    finishSquadClient(msg.data);
  });
  room.onConnection?.((up) => {
    G().set({ squadConnected: up });
    if (up && runtime.squadClient && !runtime.squadClient.isHost) room.emit('hello', { t: Date.now() }).catch(() => {});
  });
}

// ---------------------------------------------------------------- finish
async function finishSquad(p) {
  const e = runtime.engine; const sq = ctx.squad; const m = e.mission;
  const sc = scoreMission(e, (performance.now() - runtime.startedReal) / 1000);
  const result = { success: e.s.status === 'success', score: sc.total, stars: sc.stars, xp: sc.xp, simTime: e.s.t, stats: { ...e.s.stats }, reason: e.s.endReason, sc };
  const progress = applyResult(sq.progress || {}, m, result);
  const teamScore = (sq.teamScore || 0) + (result.success ? sc.total : 0);
  const summary = { mission: m.id, success: result.success, score: sc.total, stars: sc.stars, reason: trim(result.reason, 140), t: Date.now(), members: sq.members.map((x) => x.uid) };
  await updateSquad({ status: 'results', progress, teamScore, lastResult: summary, history: [summary, ...(sq.history || [])].slice(0, 30) }).catch(() => {});
  ctx.room?.emit('end', { sc: { ...sc, lines: sc.lines.map((l) => ({ label: trim(l.label, 80), pts: l.pts, mult: l.mult })) , completed: sc.completed.map((x) => trim(x, 60)), missed: sc.missed.map((x) => trim(x, 60)) }, success: result.success, reason: trim(result.reason, 140), stats: { ...result.stats, inspected: result.stats.inspected.length } }).catch(() => {});
  await p.db.doc(`squadlive/${p.uid}`).delete().catch(() => {});
  await finishSquadClient({ sc, success: result.success, reason: result.reason, stats: result.stats });
}

async function finishSquadClient(data) {
  const m = runtime.engine?.mission || G().mission;
  const sq = ctx.squad;
  const result = { success: data.success, score: data.sc.total, stars: data.sc.stars, xp: data.sc.xp ?? Math.round(data.sc.total / 5), simTime: data.sc.simTime, stats: data.stats, reason: data.reason, sc: data.sc };
  let rec = null;
  try { rec = await recordSquadPersonal(m, result, { squad: sq?.name, leader: sq?.leader, roles: G().myRoles }); G().set({ progress: rec.prog }); } catch (e) { console.warn(e); }
  G().set({ result: { ...result, rec, newAch: rec?.newAch || [] } });
  G().go('results');
}

export function leaveSquadMission() {
  runtime.engine = null; runtime.squadClient = null; bumpRuntime();
  G().set({ facility: null, hqArrived: true });
  G().go('hq');
}

export function squadAttemptsInfo(sq, m) {
  const r = sq?.progress?.[m.id] || {};
  const locked = r.lockedUntil && r.lockedUntil > Date.now();
  return { fails: locked ? MAX_ATTEMPTS : r.fails || 0, locked, lockedUntil: r.lockedUntil };
}

export async function resumeMembership() {
  const mem = await myMembership();
  if (mem?.squad) await attachSquad(mem.squad);
  return mem;
}
export { ctx as squadCtx };
