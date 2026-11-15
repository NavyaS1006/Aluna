// Account system: registration, login (username or email), logout, persistent sessions,
// recovery-code password reset. Passwords are hashed client-side with PBKDF2-SHA256
// (210,000 iterations, per-user random salt) and stored only in the player's private
// data/users/<id>/ subtree, which the platform hides from every other viewer.
import { getPlatform, session, downgradeToLocal, prefsLocal } from './platform.js';

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const PBKDF2_ITER = 210000;

export async function hashPassword(password, saltB64 = null, iter = PBKDF2_ITER) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return { salt: b64(salt), hash: b64(bits), iter };
}
function ctEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
export async function verifyPassword(password, rec) { const h = await hashPassword(password, rec.salt, rec.iter); return ctEqual(h.hash, rec.hash); }
export async function emailHash(email) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(`aluna-email-v1:${email.trim().toLowerCase()}`));
  return b64(d).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
}
function recoveryCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  const s = [...r].map((x) => A[x % A.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function validateRegistration({ username, email, password, confirm }) {
  const e = {};
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username || '')) e.username = 'Username: 3–20 letters, numbers or underscore.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '')) e.email = 'Enter a valid email address.';
  if (!password || password.length < 8) e.password = 'Password must be at least 8 characters.';
  else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) e.password = 'Password needs at least one letter and one number.';
  if (password !== confirm) e.confirm = 'Passwords do not match.';
  return e;
}

const paths = (uid) => ({
  account: `data/users/${uid}/account`, profile: `data/users/${uid}/profile`, progress: `data/users/${uid}/progress`, player: `players/${uid}`,
});

async function findPlayer(db, identifier) {
  const id = identifier.trim();
  const byName = await db.collection('players').where('usernameLower', '==', id.toLowerCase()).limit(2).get();
  if (!byName.empty) return byName.docs[0];
  if (id.includes('@')) {
    const byMail = await db.collection('players').where('emailHash', '==', await emailHash(id)).limit(2).get();
    if (!byMail.empty) return byMail.docs[0];
  }
  return null;
}

/** Returns the platform after confirming this viewer can write; switches view-only visitors to local saves. */
async function writablePlatform() {
  let p = await getPlatform();
  if (p.mode === 'cloud') {
    try { await p.db.doc(`data/users/${p.uid}/probe`).set({ t: Date.now() }); } catch (e) {
      console.warn('ALUNA: cloud write refused, using browser-local save', e);
      p = await downgradeToLocal();
    }
  }
  return p;
}

export async function register(form) {
  const errs = validateRegistration(form);
  if (Object.keys(errs).length) return { ok: false, errors: errs };
  const p = await writablePlatform();
  const { db, uid } = p;
  const P = paths(uid);
  const existing = await db.doc(P.account).get();
  if (existing.exists) return { ok: false, errors: { form: 'This identity already has an ALUNA account. Please log in (or use Forgot password).' } };
  const dupName = await db.collection('players').where('usernameLower', '==', form.username.toLowerCase()).limit(1).get();
  if (!dupName.empty) return { ok: false, errors: { username: 'That username is already taken.' } };
  const eh = await emailHash(form.email);
  const dupMail = await db.collection('players').where('emailHash', '==', eh).limit(1).get();
  if (!dupMail.empty) return { ok: false, errors: { email: 'An account with this email already exists.' } };
  const pw = await hashPassword(form.password);
  const code = recoveryCode();
  const rc = await hashPassword(code.replace(/-/g, ''), null, 100000);
  const now = Date.now();
  await db.doc(P.account).set({ username: form.username, usernameLower: form.username.toLowerCase(), email: form.email.trim().toLowerCase(), pw, recovery: rc, createdAt: now, failed: 0 });
  await db.doc(P.player).set({ uid, username: form.username, usernameLower: form.username.toLowerCase(), emailHash: eh, displayName: form.username, look: null, level: 1, xp: 0, score: 0, missions: 0, createdAt: now, lastSeen: now });
  await db.doc(P.profile).set({ displayName: form.username, look: null, avatar: null, prefs: { quality: 'high', warp: 60, sound: true, hints: true }, setupDone: false, achievements: [], squadHistory: [], createdAt: now });
  await db.doc(P.progress).set({ solo: {}, squad: {}, history: [], totalScore: 0, xp: 0, updatedAt: now });
  session.set({ uid, username: form.username, t: now, mode: p.mode });
  return { ok: true, recoveryCode: code, uid, mode: p.mode };
}

export async function login({ identifier, password }) {
  if (!identifier || !password) return { ok: false, error: 'Enter your username or email and password.' };
  const p = await getPlatform();
  const { db, uid } = p;
  const lockKey = 'aluna:loginlock';
  const lock = prefsLocal.get(lockKey, { n: 0, until: 0 });
  if (lock.until > Date.now()) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 1000)} s.` };
  const player = await findPlayer(db, identifier);
  const fail = (msg) => { lock.n += 1; if (lock.n >= 5) { lock.until = Date.now() + 30000 * (lock.n - 4); } prefsLocal.set(lockKey, lock); return { ok: false, error: msg }; };
  if (!player) return fail('No account matches that username or email.');
  if (player.id !== uid) return fail(p.mode === 'cloud' ? 'That ALUNA account is bound to a different claude.ai identity. Sign in to claude.ai as that person to use it.' : 'That account was created in a different browser profile. Browser-local accounts cannot move between browsers.');
  const acct = await db.doc(paths(uid).account).get();
  if (!acct.exists) return fail('Account record missing.');
  if (!(await verifyPassword(password, acct.data().pw))) return fail('Incorrect password.');
  prefsLocal.set(lockKey, { n: 0, until: 0 });
  const now = Date.now();
  try { await db.doc(paths(uid).player).update({ lastSeen: now }); } catch { /* read-only view */ }
  session.set({ uid, username: acct.data().username, t: now, mode: p.mode });
  return { ok: true, uid, username: acct.data().username };
}

export async function resetPassword({ identifier, code, password, confirm }) {
  const e = validateRegistration({ username: 'xxx', email: 'a@b.cc', password, confirm });
  if (e.password || e.confirm) return { ok: false, error: e.password || e.confirm };
  const p = await getPlatform();
  const player = await findPlayer(p.db, identifier || '');
  if (!player || player.id !== p.uid) return { ok: false, error: 'No account for this identity matches that username or email.' };
  const ref = p.db.doc(paths(p.uid).account);
  const acct = await ref.get();
  if (!(await verifyPassword((code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), acct.data().recovery))) return { ok: false, error: 'Recovery code is incorrect.' };
  const pw = await hashPassword(password);
  const newCode = recoveryCode();
  const rc = await hashPassword(newCode.replace(/-/g, ''), null, 100000);
  await ref.update({ pw, recovery: rc });
  return { ok: true, recoveryCode: newCode };
}

export async function resumeSession() {
  const s = session.get();
  const p = await getPlatform();
  if (!s || s.uid !== p.uid) return null;
  const acct = await p.db.doc(paths(p.uid).account).get();
  if (!acct.exists) { session.set(null); return null; }
  return { uid: p.uid, username: acct.data().username };
}

export function logout() { session.set(null); }

export async function hasAccount() {
  const p = await getPlatform();
  try { return (await p.db.doc(paths(p.uid).account).get()).exists; } catch { return false; }
}
export { paths as userPaths };
