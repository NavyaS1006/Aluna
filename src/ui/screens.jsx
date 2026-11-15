// Boot, cinematic intro, title, authentication, first-time profile setup and mode selection.
import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useGame } from '../state/store.js';
import { register, login, resetPassword, resumeSession, logout, validateRegistration } from '../services/auth.js';
import { getPlatform, prefsLocal } from '../services/platform.js';
import { loadProgress, settleAbandoned, levelFor } from '../services/progress.js';
import { setLobbyPresence } from '../services/social.js';
import { Avatar, EMBLEMS } from './common.jsx';
import { SUIT_COLORS, TRIM_COLORS, DEFAULT_LOOK } from '../three/Character.jsx';

export async function loadUserData(uid) {
  const p = await getPlatform();
  const prof = await p.db.doc(`data/users/${uid}/profile`).get();
  const progress = await settleAbandoned(prefsLocal.get('liveSeed', null));
  return { profile: prof.exists ? prof.data() : null, progress };
}

export function Boot() {
  const { progress, active } = useProgress();
  const go = useGame((s) => s.go);
  const setG = useGame((s) => s.set);
  const [plat, setPlat] = useState(null);
  useEffect(() => { getPlatform().then((p) => { setPlat(p); setG({ platform: p }); }); }, [setG]);
  const ready = plat && !active && progress >= 100;
  useEffect(() => { if (ready) { const t = setTimeout(() => go(prefsLocal.get('seenIntro', false) ? 'title' : 'intro'), 600); return () => clearTimeout(t); } return undefined; }, [ready, go]);
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="col fade-in" style={{ alignItems: 'center' }}>
        <div className="logo">ALUNA</div>
        <div className="tagline">MISSION DESIGN · SATELLITE OPERATIONS</div>
        <div className="progress-line"><i style={{ width: `${plat ? Math.max(8, progress) : 4}%` }} /></div>
        <div className="small muted" style={{ marginTop: 10 }}>{!plat ? 'Connecting to ALUNA network…' : active ? `Loading assets ${progress.toFixed(0)}%` : 'Ready'}</div>
      </div>
    </div>
  );
}

const INTRO_LINES = [
  [0, 'EARTH ORBIT · 2041'],
  [3.5, 'Thirty thousand tracked objects. One fragile shell of sky.'],
  [7.5, 'Humans and autonomous agents now fly the fleet — together.'],
  [11, 'Welcome to ALUNA.'],
];
export function Intro() {
  const go = useGame((s) => s.go);
  const [t, setT] = useState(0);
  useEffect(() => { const s = performance.now(); const i = setInterval(() => setT((performance.now() - s) / 1000), 100); return () => clearInterval(i); }, []);
  useEffect(() => { if (t > 15) { prefsLocal.set('seenIntro', true); go('title'); } }, [t, go]);
  const line = [...INTRO_LINES].reverse().find(([at]) => t >= at);
  return (
    <div className="letterbox">
      {line && <div key={line[1]} className="intro-text fade-in">{line[1]}</div>}
      {t > 11 && <div className="center-screen" style={{ pointerEvents: 'none' }}><div className="logo fade-in">ALUNA</div></div>}
      <button className="btn skip" onClick={() => { prefsLocal.set('seenIntro', true); go('title'); }}>Skip intro ⏭</button>
    </div>
  );
}

export function Title() {
  const go = useGame((s) => s.go);
  const setG = useGame((s) => s.set);
  const plat = useGame((s) => s.platform);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const u = await resumeSession();
      if (u) {
        const { profile, progress } = await loadUserData(u.uid);
        setG({ user: u, profile, progress });
        setLobbyPresence({ where: 'menu', name: profile?.displayName });
        go(profile?.setupDone ? 'modeSelect' : 'setup');
      } else go('auth');
    } finally { setBusy(false); }
  };
  useEffect(() => { const k = (e) => { if (e.key === 'Enter') start(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  return (
    <div className="title-menu fade-in">
      <div className="logo" style={{ fontSize: 'clamp(44px, 9vw, 96px)', textAlign: 'left' }}>ALUNA</div>
      <div className="tagline" style={{ textAlign: 'left', marginBottom: 32 }}>SPACE MISSION DESIGN & SATELLITE OPERATIONS</div>
      <button className="btn primary press" style={{ padding: '14px 28px', fontSize: 16 }} onClick={start} disabled={busy}>{busy ? 'Connecting…' : 'PRESS START'}</button>
      <div className="small muted" style={{ marginTop: 18, maxWidth: 420 }}>
        {plat?.mode === 'cloud' ? '☁ Cloud save via claude.ai — progress & multiplayer sync across devices.' : '💾 Browser-local save — open this game inside claude.ai (signed in, with edit/contributor access) for cloud saves & online multiplayer.'}
      </div>
      <div className="tiny muted" style={{ marginTop: 8, maxWidth: 420 }}>Educational simulation. Not certified for real-world flight operations.</div>
    </div>
  );
}

export function Auth() {
  const go = useGame((s) => s.go);
  const setG = useGame((s) => s.set);
  const toast = useGame((s) => s.toast);
  const [tab, setTab] = useState('login');
  const [f, setF] = useState({ username: '', email: '', password: '', confirm: '', identifier: '', code: '' });
  const [show, setShow] = useState(false);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const upd = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const afterLogin = async (uid, username) => {
    const { profile, progress } = await loadUserData(uid);
    setG({ user: { uid, username }, profile, progress });
    setLobbyPresence({ where: 'menu', name: profile?.displayName || username });
    go(profile?.setupDone ? 'modeSelect' : 'setup');
  };
  const doRegister = async (e) => {
    e.preventDefault();
    const v = validateRegistration(f); setErrs(v); if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const r = await register(f);
      if (!r.ok) { setErrs(r.errors); return; }
      setRecovery({ code: r.recoveryCode, uid: r.uid, username: f.username });
      if (r.mode === 'local') toast('This view cannot write cloud data — your account is saved in this browser only.', 'warn', 7000);
    } catch (err) { setErrs({ form: `Registration failed: ${err?.message || err?.code || err}` }); } finally { setBusy(false); }
  };
  const doLogin = async (e) => {
    e.preventDefault(); setBusy(true); setErrs({});
    try { const r = await login({ identifier: f.identifier, password: f.password }); if (!r.ok) setErrs({ form: r.error }); else await afterLogin(r.uid, r.username); }
    catch (err) { setErrs({ form: `Login failed: ${err?.message || err?.code || err}` }); } finally { setBusy(false); }
  };
  const doReset = async (e) => {
    e.preventDefault(); setBusy(true); setErrs({});
    try { const r = await resetPassword({ identifier: f.identifier, code: f.code, password: f.password, confirm: f.confirm }); if (!r.ok) setErrs({ form: r.error }); else { setRecovery({ code: r.recoveryCode, reset: true }); } }
    catch (err) { setErrs({ form: String(err?.message || err) }); } finally { setBusy(false); }
  };
  if (recovery) {
    return (
      <div className="center-screen"><div className="glass card fade-in">
        <h2>{recovery.reset ? 'Password updated' : 'Account created'}</h2>
        <p className="small muted">Save this one-time <b>recovery code</b>. It is the only way to reset your password ("Forgot password"). ALUNA stores only a hash of it.</p>
        <div className="display" style={{ fontSize: 26, textAlign: 'center', padding: 16, border: '1px dashed var(--amber)', borderRadius: 10, margin: '12px 0', userSelect: 'all' }} data-testid="recovery-code">{recovery.code}</div>
        <div className="row"><button className="btn ghost" onClick={() => navigator.clipboard?.writeText(recovery.code)}>Copy</button>
          <button className="btn primary grow" onClick={() => (recovery.reset ? (setRecovery(null), setTab('login')) : afterLogin(recovery.uid, recovery.username))}>{recovery.reset ? 'Back to login' : 'I saved it — continue'}</button></div>
      </div></div>
    );
  }
  const pw = (k, lab, auto) => (
    <div className="field"><label htmlFor={k}>{lab}</label>
      <div className="row"><input id={k} type={show ? 'text' : 'password'} value={f[k]} onChange={upd(k)} autoComplete={auto} />
        <button type="button" className="btn sm ghost" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? '🙈' : '👁'}</button></div>
      {errs[k] && <div className="err">{errs[k]}</div>}</div>
  );
  return (
    <div className="center-screen"><div className="glass card fade-in">
      <div className="logo" style={{ fontSize: 34, textAlign: 'center', marginBottom: 10 }}>ALUNA</div>
      <div className="tabs" role="tablist">
        {[['login', 'Log in'], ['register', 'Register'], ['forgot', 'Forgot password']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setErrs({}); }}>{l}</button>)}
      </div>
      {tab === 'login' && (
        <form onSubmit={doLogin} noValidate>
          <div className="field"><label htmlFor="identifier">Username or email</label><input id="identifier" value={f.identifier} onChange={upd('identifier')} autoComplete="username" /></div>
          {pw('password', 'Password', 'current-password')}
          {errs.form && <div className="err" role="alert">{errs.form}</div>}
          <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>{busy ? 'Verifying…' : 'Log in'}</button>
        </form>
      )}
      {tab === 'register' && (
        <form onSubmit={doRegister} noValidate>
          <div className="field"><label htmlFor="username">Username</label><input id="username" value={f.username} onChange={upd('username')} autoComplete="username" />{errs.username && <div className="err">{errs.username}</div>}</div>
          <div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" value={f.email} onChange={upd('email')} autoComplete="email" />{errs.email && <div className="err">{errs.email}</div>}</div>
          {pw('password', 'Password (8+ chars, letters & numbers)', 'new-password')}
          {pw('confirm', 'Confirm password', 'new-password')}
          {errs.form && <div className="err" role="alert">{errs.form}</div>}
          <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>{busy ? 'Securing account (PBKDF2)…' : 'Create account'}</button>
          <p className="tiny muted" style={{ marginTop: 10 }}>Passwords are hashed with PBKDF2-SHA256 (210k iterations, unique salt). Your email is stored privately; only a one-way hash is used for duplicate checks.</p>
        </form>
      )}
      {tab === 'forgot' && (
        <form onSubmit={doReset} noValidate>
          <p className="small muted">Use the recovery code shown when you registered.</p>
          <div className="field"><label htmlFor="identifier2">Username or email</label><input id="identifier2" value={f.identifier} onChange={upd('identifier')} /></div>
          <div className="field"><label htmlFor="code">Recovery code</label><input id="code" value={f.code} onChange={upd('code')} placeholder="XXXX-XXXX-XXXX" /></div>
          {pw('password', 'New password', 'new-password')}
          {pw('confirm', 'Confirm new password', 'new-password')}
          {errs.form && <div className="err" role="alert">{errs.form}</div>}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>Reset password</button>
        </form>
      )}
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn ghost sm" onClick={() => go('title')}>← Back</button></div>
    </div></div>
  );
}

export function Setup() {
  const user = useGame((s) => s.user);
  const profile = useGame((s) => s.profile);
  const setG = useGame((s) => s.set);
  const go = useGame((s) => s.go);
  const toast = useGame((s) => s.toast);
  const [name, setName] = useState(profile?.displayName || user?.username || '');
  const [look, setLook] = useState(profile?.look || { ...DEFAULT_LOOK });
  const [prefs, setPrefs] = useState(profile?.prefs || { quality: 'high', warp: 60, sound: true, hints: true });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!/^.{2,20}$/.test(name.trim())) { toast('Display name must be 2–20 characters.', 'bad'); return; }
    setBusy(true);
    try {
      const p = await getPlatform();
      const patch = { displayName: name.trim(), look, avatar: look.emblem, prefs, setupDone: true };
      await p.db.doc(`data/users/${user.uid}/profile`).update(patch);
      await p.db.doc(`players/${user.uid}`).update({ displayName: name.trim(), look, lastSeen: Date.now() });
      setG({ profile: { ...profile, ...patch } });
      setLobbyPresence({ name: name.trim() });
      go('modeSelect');
    } catch (e) { toast(`Could not save profile: ${e?.message || e?.code}`, 'bad'); } finally { setBusy(false); }
  };
  return (
    <div className="center-screen"><div className="glass card fade-in" style={{ width: 'min(560px,100%)' }}>
      <h2 className="display">CREW PROFILE</h2>
      <p className="small muted">Set up how other operators see you in headquarters and squads.</p>
      <div className="field"><label htmlFor="dn">Display name</label><input id="dn" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></div>
      <div className="section-title">Suit colour</div>
      <div className="row wrap">{SUIT_COLORS.map((c) => <button key={c} aria-label={`suit ${c}`} className={`swatch ${look.suit === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLook({ ...look, suit: c })} />)}</div>
      <div className="section-title">Trim colour</div>
      <div className="row wrap">{TRIM_COLORS.map((c) => <button key={c} aria-label={`trim ${c}`} className={`swatch ${look.trim === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLook({ ...look, trim: c })} />)}</div>
      <div className="section-title">Height</div>
      <input type="range" min="0.9" max="1.1" step="0.01" value={look.height} onChange={(e) => setLook({ ...look, height: +e.target.value })} aria-label="height" />
      <div className="section-title">Avatar emblem (profile picture)</div>
      <div className="row wrap">{EMBLEMS.map((em, k) => <button key={k} className="btn sm" style={look.emblem === k ? { borderColor: 'var(--accent)' } : null} onClick={() => setLook({ ...look, emblem: k })}>{em}</button>)}</div>
      <div className="section-title">Preferences</div>
      <div className="row wrap">
        <label className="row" style={{ margin: 0 }}><select value={prefs.quality} onChange={(e) => setPrefs({ ...prefs, quality: e.target.value })} aria-label="graphics quality"><option value="high">High graphics</option><option value="low">Performance</option></select></label>
        <label className="row" style={{ margin: 0 }}><select value={prefs.warp} onChange={(e) => setPrefs({ ...prefs, warp: +e.target.value })} aria-label="default time warp"><option value={30}>Warp ×30</option><option value={60}>Warp ×60</option><option value={120}>Warp ×120</option></select></label>
        <label className="row small" style={{ margin: 0, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto' }} checked={prefs.hints} onChange={(e) => setPrefs({ ...prefs, hints: e.target.checked })} /> Show hints</label>
      </div>
      <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
        <div className="row"><Avatar look={look} size={48} /><div className="small">{name || '—'}<div className="tiny muted">Level 1 Operator</div></div></div>
        <button className="btn primary" onClick={save} disabled={busy}>Enter ALUNA →</button>
      </div>
    </div></div>
  );
}

export function ModeSelect() {
  const go = useGame((s) => s.go);
  const setG = useGame((s) => s.set);
  const profile = useGame((s) => s.profile);
  const progress = useGame((s) => s.progress);
  const plat = useGame((s) => s.platform);
  const pick = (mode) => { setG({ mode, hqArrived: false, facility: null }); setLobbyPresence({ where: mode === 'solo' ? 'hq-solo' : 'hq-squad' }); go('hq'); };
  const soloDone = Object.values(progress?.solo || {}).filter((x) => x.completed).length;
  const squadDone = Object.values(progress?.squad || {}).filter((x) => x.completed).length;
  return (
    <div className="center-screen">
      <div className="col fade-in" style={{ width: 'min(900px, 100%)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row"><Avatar look={profile?.look} size={44} /><div><div style={{ fontWeight: 700 }}>{profile?.displayName}</div><div className="tiny muted">Level {levelFor(progress?.xp)} · {progress?.xp || 0} XP · {plat?.label}</div></div></div>
          <div className="row"><button className="btn sm" onClick={() => setG({ modal: 'profile' })}>Profile</button><button className="btn sm ghost" onClick={() => { logout(); setG({ user: null, profile: null, progress: null }); go('title'); }}>Log out</button></div>
        </div>
        <div className="row wrap" style={{ alignItems: 'stretch' }}>
          <button className="glass grow" style={{ padding: 26, textAlign: 'left', cursor: 'pointer', minWidth: 260 }} onClick={() => pick('solo')} data-testid="mode-solo">
            <div className="display accent">SOLO CAMPAIGN</div>
            <h2 style={{ margin: '8px 0' }}>25 missions</h2>
            <p className="small muted">From First Contact to the Final Mission. Design spacecraft, launch, and fly with or without AI assistance.</p>
            <div className="bar" style={{ marginTop: 12 }}><i style={{ width: `${(soloDone / 25) * 100}%` }} /></div><div className="tiny muted" style={{ marginTop: 4 }}>{soloDone}/25 completed</div>
          </button>
          <button className="glass grow" style={{ padding: 26, textAlign: 'left', cursor: 'pointer', minWidth: 260 }} onClick={() => pick('squad')} data-testid="mode-squad">
            <div className="display amber">SQUAD OPS</div>
            <h2 style={{ margin: '8px 0' }}>25 team missions · 2–4 players</h2>
            <p className="small muted">Form a squad with friends, assign roles — Commander, Flight, Systems, Autonomy — and run shared real-time operations.</p>
            <div className="bar" style={{ marginTop: 12 }}><i style={{ width: `${(squadDone / 25) * 100}%`, background: 'var(--amber)' }} /></div><div className="tiny muted" style={{ marginTop: 4 }}>{squadDone}/25 completed (personal)</div>
          </button>
        </div>
      </div>
    </div>
  );
}
