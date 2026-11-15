// Platform layer — one API over two backends:
//  • CLOUD: claude.ai Artifact runtime capabilities (db = persistent document store,
//    user = authenticated identity, room = real-time multiplayer channel, sample = Claude for explanations)
//  • LOCAL: browser-only fallback (localStorage + BroadcastChannel) when the page is opened
//    outside the claude.ai viewer, by a signed-out visitor, or by a view-only visitor.
// The game code only talks to this module.

const LS = (() => { try { const k = '__aluna_t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch { return null; } })();
const mem = new Map();
const lsGet = (k) => { try { return LS ? LS.getItem(k) : mem.get(k) ?? null; } catch { return mem.get(k) ?? null; } };
const lsSet = (k, v) => { try { if (LS) LS.setItem(k, v); else mem.set(k, v); } catch { mem.set(k, v); } };
const lsDel = (k) => { try { if (LS) LS.removeItem(k); else mem.delete(k); } catch { mem.delete(k); } };
const lsKeys = () => { try { return LS ? Object.keys(LS) : [...mem.keys()]; } catch { return [...mem.keys()]; } };

// ---------------------------------------------------------------- Local document store
function makeLocalDb() {
  const PFX = 'aluna:db:';
  const listeners = new Set();
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('aluna-db') : null;
  const notify = (path) => { for (const l of [...listeners]) l(path); };
  if (bc) bc.onmessage = (e) => notify(e.data);
  if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key?.startsWith(PFX)) notify(e.key.slice(PFX.length)); });
  const read = (p) => { const v = lsGet(PFX + p); return v ? JSON.parse(v) : undefined; };
  const write = (p, d) => { if (d === undefined) lsDel(PFX + p); else lsSet(PFX + p, JSON.stringify(d)); notify(p); bc?.postMessage(p); };
  const snap = (p) => { const d = read(p); const id = p.split('/').pop(); return { id, exists: d !== undefined, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } }; };
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v; return o; };
  const docRef = (path) => ({
    id: path.split('/').pop(), path,
    get: async () => snap(path),
    set: async (d) => write(path, JSON.parse(JSON.stringify(d))),
    update: async (d) => { const cur = read(path); if (cur === undefined) throw { code: 'invalid_argument', message: 'missing doc' }; write(path, merge(cur, JSON.parse(JSON.stringify(d)))); },
    delete: async () => write(path, undefined),
    acquire: async () => ({ acquired: true }),
    onSnapshot: (next) => { const l = (p) => { if (p === path) next(snap(path)); }; listeners.add(l); setTimeout(() => next(snap(path)), 0); return () => listeners.delete(l); },
    collection: (c) => collRef(`${path}/${c}`),
  });
  const collRef = (path, filters = [], order = null, lim = null) => {
    const depth = path.split('/').length + 1;
    const run = () => {
      let docs = lsKeys().filter((k) => k.startsWith(PFX + path + '/') && k.slice(PFX.length).split('/').length === depth).map((k) => snap(k.slice(PFX.length))).filter((s) => s.exists);
      for (const [f, op, v] of filters) docs = docs.filter((s) => { const x = s.data()[f]; switch (op) { case '==': return x === v; case '!=': return x !== v; case '<': return x < v; case '<=': return x <= v; case '>': return x > v; case '>=': return x >= v; case 'in': return v.includes(x); case 'array-contains': return Array.isArray(x) && x.includes(v); default: return true; } });
      if (order) docs.sort((a, b) => ((a.data()[order[0]] ?? Infinity) > (b.data()[order[0]] ?? Infinity) ? 1 : -1) * (order[1] === 'desc' ? -1 : 1));
      if (lim) docs = docs.slice(0, lim);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      path,
      doc: (id) => docRef(`${path}/${id || Math.random().toString(36).slice(2, 12)}`),
      add: async (d) => { const r = docRef(`${path}/${Math.random().toString(36).slice(2, 12)}`); await r.set(d); return r; },
      where: (f, op, v) => collRef(path, [...filters, [f, op, v]], order, lim),
      orderBy: (f, dir = 'asc') => collRef(path, filters, [f, dir], lim),
      limit: (n) => collRef(path, filters, order, n),
      get: async () => run(),
      onSnapshot: (next) => { const l = (p) => { if (p.startsWith(path + '/')) next(run()); }; listeners.add(l); setTimeout(() => next(run()), 0); return () => listeners.delete(l); },
    };
  };
  return { doc: docRef, collection: (p) => collRef(p), local: true };
}

// ---------------------------------------------------------------- Local room (cross-tab)
function makeLocalRoom(uid) {
  const peerId = Math.random().toString(36).slice(2, 10);
  const mk = (name) => {
    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`aluna-room-${name}`) : null;
    const topics = new Map(), peerL = new Set();
    let me = {}; const peers = new Map();
    let snapshot = [];
    const rebuild = (joined = [], left = []) => {
      snapshot = Object.freeze([{ peer: peerId, by: uid, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: me, updatedAt: Date.now() }, ...[...peers.values()]]);
      for (const l of peerL) l({ peers: snapshot, joined, left, updated: [] });
    };
    const send = (m) => bc?.postMessage(m);
    if (bc) bc.onmessage = (e) => {
      const m = e.data;
      if (m.kind === 'emit') for (const h of topics.get(m.topic) || []) h({ topic: m.topic, data: m.data, peer: m.peer, by: m.by, isMe: false, sameTab: false, kind: 'viewer', guest: false });
      if (m.kind === 'presence') { const isNew = !peers.has(m.peer); peers.set(m.peer, { peer: m.peer, by: m.by, isMe: m.by === uid, sameTab: false, kind: 'viewer', guest: false, presence: m.presence, updatedAt: Date.now(), seen: Date.now() }); rebuild(isNew ? [peers.get(m.peer)] : []); if (isNew) send({ kind: 'presence', peer: peerId, by: uid, presence: me }); }
      if (m.kind === 'leave') { const p = peers.get(m.peer); peers.delete(m.peer); if (p) rebuild([], [p]); }
    };
    const hb = setInterval(() => { send({ kind: 'presence', peer: peerId, by: uid, presence: me }); const now = Date.now(); for (const [k, p] of peers) if (now - p.seen > 5000) { peers.delete(k); rebuild([], [p]); } }, 1000);
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => send({ kind: 'leave', peer: peerId }));
    rebuild();
    return {
      name,
      emit: async (topic, data) => { send({ kind: 'emit', topic, data, peer: peerId, by: uid }); for (const h of topics.get(topic) || []) h({ topic, data, peer: peerId, by: uid, isMe: true, sameTab: true, kind: 'viewer', guest: false }); },
      on: (topic, h) => { if (!topics.has(topic)) topics.set(topic, new Set()); topics.get(topic).add(h); return () => topics.get(topic).delete(h); },
      presence: async (patch) => { me = { ...me, ...patch }; for (const k of Object.keys(patch)) if (patch[k] === null) delete me[k]; rebuild(); send({ kind: 'presence', peer: peerId, by: uid, presence: me }); },
      peers: () => snapshot,
      onPeers: (h) => { peerL.add(h); setTimeout(() => h({ peers: snapshot, joined: snapshot, left: [], updated: [] }), 0); return () => peerL.delete(h); },
      connected: () => true,
      onConnection: (h) => { setTimeout(() => h(true), 0); return () => {}; },
      leave: async () => { clearInterval(hb); send({ kind: 'leave', peer: peerId }); bc?.close(); },
    };
  };
  const lobby = mk('lobby');
  const rooms = new Map();
  return { ...lobby, join: async (n) => { if (!rooms.has(n)) rooms.set(n, mk(n)); return rooms.get(n); }, local: true, peerId };
}

// ---------------------------------------------------------------- init
let platformPromise = null;

export function getPlatform() {
  if (!platformPromise) platformPromise = init();
  return platformPromise;
}

async function withTimeout(p, ms) { return Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]); }

async function init() {
  const url = new URL(typeof location !== 'undefined' ? location.href : 'http://x/');
  const forceLocal = url.searchParams.has('local') || url.searchParams.has('as');
  let cloud = null;
  if (!forceLocal && typeof window !== 'undefined' && window.claude?.use) {
    try {
      const [db, user, room, sample] = await Promise.all([
        withTimeout(window.claude.use('db'), 11000), withTimeout(window.claude.use('user'), 11000),
        withTimeout(window.claude.use('room'), 11000), withTimeout(window.claude.use('sample'), 11000),
      ]);
      const uid = user ? await user.id() : null;
      if (db && uid) cloud = { db, user, room, sample, uid };
    } catch (e) { console.warn('ALUNA: cloud capabilities unavailable', e); }
  }
  if (cloud) {
    let canWrite = null;
    try { canWrite = await cloud.user.can('data.write'); } catch { /* ignore */ }
    return { mode: 'cloud', db: cloud.db, room: cloud.room, user: cloud.user, sample: cloud.sample, uid: cloud.uid, canWrite, label: 'claude.ai cloud save' };
  }
  // local fallback: per-browser identity (or ?as=<name> for multi-tab testing)
  const as = url.searchParams.get('as');
  let uid;
  if (as) uid = `local-${as.replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
  else { uid = lsGet('aluna:localUid'); if (!uid) { uid = `local-${Math.random().toString(36).slice(2, 12)}`; lsSet('aluna:localUid', uid); } }
  return { mode: 'local', db: makeLocalDb(), room: makeLocalRoom(uid), user: null, sample: null, uid, canWrite: true, label: 'browser-local save' };
}

/** Switch a cloud session to local storage when the viewer cannot write (view-only visitors). */
export async function downgradeToLocal() {
  const p = await getPlatform();
  if (p.mode === 'local') return p;
  let uid = lsGet('aluna:localUid'); if (!uid) { uid = `local-${Math.random().toString(36).slice(2, 12)}`; lsSet('aluna:localUid', uid); }
  Object.assign(p, { mode: 'local', db: makeLocalDb(), room: makeLocalRoom(uid), uid, canWrite: true, label: 'browser-local save (view-only visitor)' });
  return p;
}

const sessKey = () => { try { const a = new URL(location.href).searchParams.get('as'); return a ? `aluna:session:${a}` : 'aluna:session'; } catch { return 'aluna:session'; } };
export const session = {
  get: () => { try { return JSON.parse(lsGet(sessKey()) || 'null'); } catch { return null; } },
  set: (v) => (v ? lsSet(sessKey(), JSON.stringify(v)) : lsDel(sessKey())),
};
export const prefsLocal = {
  get: (k, d) => { try { const v = lsGet(`aluna:pref:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => lsSet(`aluna:pref:${k}`, JSON.stringify(v)),
};
