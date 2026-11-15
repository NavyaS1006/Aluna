// Friends, presence and squads.
// Data model (every writable path is owner-only through {self} access rules):
//   players/<uid>        public profile card (username, look, level, lastSeen)
//   outbox/<uid>         { to: { <otherUid>: { status: request|accept|reject, t } } } — friendship = mutual entries
//   squads/<leaderUid>   squad record written by its leader: code, members, roles, invites, mission state, squad progress
//   squadmembers/<uid>   each player's own membership/ready flag
// Online status comes from live presence in the real-time lobby room — never fabricated.
import { getPlatform } from './platform.js';

export const ROLES = ['commander', 'flight', 'systems', 'autonomy'];

export async function searchPlayers(q) {
  const p = await getPlatform();
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const r = await p.db.collection('players').where('usernameLower', '>=', s).where('usernameLower', '<=', `${s}`).limit(12).get();
  return r.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((x) => x.uid !== p.uid);
}

export async function getPlayers(uids) {
  const p = await getPlatform();
  const out = {};
  await Promise.all(uids.map(async (u) => { try { const d = await p.db.doc(`players/${u}`).get(); if (d.exists) out[u] = { uid: u, ...d.data() }; } catch { /* ignore */ } }));
  return out;
}

async function myOutbox() {
  const p = await getPlatform();
  const ref = p.db.doc(`outbox/${p.uid}`);
  const s = await ref.get();
  return { ref, data: s.exists ? JSON.parse(JSON.stringify(s.data())) : { to: {} } };
}
async function setStatus(uid, status) {
  const { ref, data } = await myOutbox();
  data.to = data.to || {};
  if (status === null) delete data.to[uid]; else data.to[uid] = { status, t: Date.now() };
  await ref.set(data);
}
export const sendFriendRequest = (uid) => setStatus(uid, 'request');
export const acceptFriend = (uid) => setStatus(uid, 'accept');
export const rejectFriend = (uid) => setStatus(uid, 'reject');
export const removeFriend = (uid) => setStatus(uid, null);

/** Derive friend graph from all outboxes. */
export function deriveFriends(outboxes, me) {
  const mine = outboxes[me]?.to || {};
  const friends = [], incoming = [], outgoing = [], declined = [];
  const others = new Set([...Object.keys(mine), ...Object.keys(outboxes).filter((u) => outboxes[u]?.to?.[me])]);
  for (const u of others) {
    if (u === me) continue;
    const a = mine[u]?.status, b = outboxes[u]?.to?.[me]?.status;
    const pos = (x) => x === 'request' || x === 'accept';
    if (pos(a) && pos(b)) friends.push(u);
    else if (b === 'request' && !a) incoming.push(u);
    else if (a === 'request' && b === 'reject') declined.push(u);
    else if (a === 'request' && !b) outgoing.push(u);
  }
  return { friends, incoming, outgoing, declined };
}

export async function watchOutboxes(cb) {
  const p = await getPlatform();
  return p.db.collection('outbox').onSnapshot((snap) => {
    const map = {};
    for (const d of snap.docs) map[d.id] = d.data();
    cb(deriveFriends(map, p.uid));
  }, (e) => console.warn('outbox watch', e));
}

// ---------------------------------------------------------------- presence (lobby)
let lobbyPresence = {};
export async function setLobbyPresence(patch) {
  const p = await getPlatform();
  lobbyPresence = { ...lobbyPresence, ...patch, uid: p.uid };
  try { await p.room?.presence(lobbyPresence); } catch { /* room unavailable */ }
}
export async function watchOnline(cb) {
  const p = await getPlatform();
  if (!p.room) { cb(new Set([p.uid])); return () => {}; }
  return p.room.onPeers(({ peers }) => {
    const s = new Set();
    for (const x of peers) { const u = x.by || x.presence?.uid; if (u) s.add(u); }
    cb(s);
  });
}

// ---------------------------------------------------------------- squads
const code6 = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return [...crypto.getRandomValues(new Uint8Array(6))].map((x) => A[x % A.length]).join(''); };

export async function createSquad(name, me) {
  const p = await getPlatform();
  const ref = p.db.doc(`squads/${p.uid}`);
  const ex = await ref.get();
  const progress = ex.exists ? ex.data().progress || {} : {};
  const sq = { leader: p.uid, code: code6(), name: name || `${me.displayName}'s Squad`, private: true, members: [{ uid: p.uid, roles: ['commander'] }], invites: [], missionId: null, status: 'idle', design: null, seed: null, progress, history: ex.exists ? ex.data().history || [] : [], createdAt: Date.now(), updatedAt: Date.now() };
  await ref.set(sq);
  await p.db.doc(`squadmembers/${p.uid}`).set({ squad: p.uid, ready: false, t: Date.now() });
  return sq;
}

export async function updateSquad(patch) {
  const p = await getPlatform();
  const ref = p.db.doc(`squads/${p.uid}`);
  await ref.update({ ...patch, updatedAt: Date.now() });
}

export async function inviteToSquad(uid) {
  const p = await getPlatform();
  const ref = p.db.doc(`squads/${p.uid}`);
  const s = (await ref.get()).data();
  if (!s) throw new Error('Create a squad first.');
  if (!s.invites.includes(uid)) await ref.update({ invites: [...s.invites, uid], updatedAt: Date.now() });
}

export async function findSquadByCode(code) {
  const p = await getPlatform();
  const r = await p.db.collection('squads').where('code', '==', code.trim().toUpperCase()).limit(1).get();
  return r.empty ? null : { id: r.docs[0].id, ...r.docs[0].data() };
}

export async function joinSquad(leaderUid) {
  const p = await getPlatform();
  await p.db.doc(`squadmembers/${p.uid}`).set({ squad: leaderUid, ready: false, t: Date.now() });
}
export async function setReady(ready) {
  const p = await getPlatform();
  const ref = p.db.doc(`squadmembers/${p.uid}`);
  const s = await ref.get();
  if (s.exists) await ref.update({ ready, t: Date.now() });
}
export async function leaveSquad() {
  const p = await getPlatform();
  await p.db.doc(`squadmembers/${p.uid}`).set({ squad: null, ready: false, t: Date.now() });
}
export async function myMembership() {
  const p = await getPlatform();
  const s = await p.db.doc(`squadmembers/${p.uid}`).get();
  return s.exists ? s.data() : null;
}

export function watchSquad(leaderUid, cb) {
  let unsub = () => {};
  getPlatform().then((p) => { unsub = p.db.doc(`squads/${leaderUid}`).onSnapshot((s) => cb(s.exists ? { id: s.id, ...s.data() } : null), (e) => console.warn('squad watch', e)); });
  return () => unsub();
}

export function watchMemberships(leaderUid, cb) {
  let unsub = () => {};
  getPlatform().then((p) => { unsub = p.db.collection('squadmembers').where('squad', '==', leaderUid).onSnapshot((s) => cb(s.docs.map((d) => ({ uid: d.id, ...d.data() }))), (e) => console.warn('members watch', e)); });
  return () => unsub();
}

export function watchInvites(cb) {
  let unsub = () => {};
  getPlatform().then((p) => { unsub = p.db.collection('squads').where('invites', 'array-contains', p.uid).onSnapshot((s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.warn('invite watch', e)); });
  return () => unsub();
}

/** Leader reconciles: members that requested (via squadmembers) and were invited / used the code. Max 4. */
export function reconcileMembers(squad, memberships) {
  const joined = memberships.filter((m) => m.squad === squad.leader).map((m) => m.uid);
  const keep = squad.members.filter((m) => m.uid === squad.leader || joined.includes(m.uid));
  for (const u of joined) if (!keep.find((m) => m.uid === u) && keep.length < 4) keep.push({ uid: u, roles: [] });
  return keep;
}

/** Effective roles: assigned roles, with every unassigned role covered by the leader. */
export function effectiveRoles(squad) {
  const map = Object.fromEntries((squad?.members || []).map((m) => [m.uid, [...(m.roles || [])]]));
  for (const r of ROLES) if (!Object.values(map).some((rs) => rs.includes(r))) (map[squad.leader] ||= []).push(r);
  return map;
}
