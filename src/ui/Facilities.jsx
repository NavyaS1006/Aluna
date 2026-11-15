// The six interactive headquarters facilities. Each opens a working game system.
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../state/store.js';
import { SOLO_MISSIONS, SQUAD_MISSIONS, MP_MISSIONS } from '../data/missions.js';
import { TRAINING } from '../data/training.js';
import { missionStatus, MAX_ATTEMPTS, ACHIEVEMENTS, levelFor } from '../services/progress.js';
import { openBriefing, resumeLive, loadLive, startTraining } from '../game/flow.js';
import { getPlatform } from '../services/platform.js';
import { Panel, Countdown, Bar, fmtTime, Avatar } from './common.jsx';
import { perigeeAlt, apogeeAlt, DEG, period } from '../sim/orbit.js';
import { loadSnapshot, propagateRecord, fetchLiveTles, SNAPSHOT_SOURCE } from '../sim/catalog.js';
import { AGENTS } from '../sim/agents.js';
import { askAluna } from '../services/assistant.js';
import { ROLE_LABELS } from '../sim/engine.js';
import { DEFAULT_DESIGN } from '../sim/design.js';
import { leaderSelectMission, squadAttemptsInfo, attachSquad, detachSquad, squadCtx } from '../game/squad.js';
import { searchPlayers, sendFriendRequest, acceptFriend, rejectFriend, removeFriend, createSquad, inviteToSquad, findSquadByCode, joinSquad, leaveSquad, updateSquad, getPlayers, ROLES, effectiveRoles, setReady } from '../services/social.js';

function Shell({ title, color, children, right }) {
  const setG = useGame((s) => s.set);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') setG({ facility: null }); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [setG]);
  return (
    <div className="modal-back" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <div className="glass facility fade-in" role="dialog" aria-label={title} data-testid="facility">
        <div className="panel-head" style={{ color }}><span>{title}</span><span className="row">{right}<button className="btn sm" onClick={() => setG({ facility: null })} data-testid="close-facility">✕ Back to HQ</button></span></div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 1. Mission Control
export function MissionControl() {
  const mode = useGame((s) => s.mode);
  const progress = useGame((s) => s.progress);
  const squad = useGame((s) => s.squad);
  const plat = useGame((s) => s.platform);
  const list = mode === 'solo' ? SOLO_MISSIONS : [...SQUAD_MISSIONS, ...MP_MISSIONS];
  const map = mode === 'solo' ? progress?.solo : squad?.progress;
  const firstOpen = list.find((m) => !missionStatus(map, m).completed && missionStatus(map, m).unlocked) || list[0];
  const [sel, setSel] = useState(firstOpen);
  const [live, setLive] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { if (mode === 'solo') loadLive().then(setLive).catch(() => {}); }, [mode]);
  const st = missionStatus(map, sel);
  const isLeader = squad && squad.leader === plat?.uid;
  const history = (progress?.history || []).filter((h) => h.id === sel.id).slice(0, 5);
  const canResume = mode === 'solo' && live && live.missionId === sel.id && st.active?.seed === live.seed;
  const sqInfo = mode === 'squad' && squad ? squadAttemptsInfo(squad, sel) : null;
  return (
    <Shell title={`🛰 Mission Control Room · ${mode === 'solo' ? 'Solo Campaign' : 'Squad Ops'}`} color="#4fd1ff" right={<span className="pill">{list.filter((m) => !m.quickplay && missionStatus(map, m).completed).length}/25 complete{mode === 'squad' ? ' · +4 Multiplayer' : ''}</span>}>
      {mode === 'squad' && !squad && <div className="notice" style={{ marginBottom: 10 }}>Squad Ops missions are flown by a squad. Visit the <b>Squad Coordination Room</b> to create or join one. Squad progress is separate from your Solo Campaign.</div>}
      {mode === 'squad' && squad && !isLeader && <div className="notice" style={{ marginBottom: 10 }}>Your squad leader selects and launches missions. You'll be taken to the briefing automatically.</div>}
      <div className="split" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <div>
          {['Beginner', 'Intermediate', 'Advanced', 'Expert', ...(mode === 'squad' ? ['Multiplayer'] : [])].map((tier) => (
            <div key={tier}>
              <div className="section-title">{tier === 'Multiplayer' ? 'Multiplayer Quick Ops (4 · always unlocked · 2–4 players)' : tier}</div>
              <div className="mlist">
                {list.filter((m) => m.tier === tier).map((m) => {
                  const s = missionStatus(map, m);
                  return (
                    <button key={m.id} className={`mcard ${sel.id === m.id ? 'on' : ''} ${!s.unlocked ? 'locked' : ''}`} onClick={() => setSel(m)} data-testid={`mission-${m.id}`}>
                      <div className="tiny muted">{m.id} · D{m.difficulty}</div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{m.title}</div>
                      <div className="tiny" style={{ marginTop: 4 }}>{!s.unlocked ? '🔒 Locked' : s.cooldown ? <span className="bad">⏳ Cooldown</span> : s.completed ? <span className="good">✓ {'★'.repeat(s.stars)} {s.best}</span> : s.active ? <span className="warn">● In progress</span> : <span className="accent">Available · {s.attemptsLeft}/{MAX_ATTEMPTS}</span>}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="glass" style={{ padding: 14, alignSelf: 'start', position: 'sticky', top: 0 }}>
          <div className="tiny muted">{sel.id} · {sel.tier} · Difficulty {sel.difficulty}/10</div>
          <h2 className="display" style={{ margin: '4px 0 8px' }}>{sel.title}</h2>
          <p className="small" style={{ lineHeight: 1.5 }}>{sel.story}</p>
          <div className="section-title">Objectives</div>
          {sel.objectives.map((o) => <div key={o.id} className="small">• {o.label}{o.role ? <span className="tiny muted"> — {ROLE_LABELS[o.role]}</span> : ''}</div>)}
          <div className="section-title">Status</div>
          <div className="kv">
            <span>Unlocked</span><b>{st.unlocked ? 'yes' : 'no — complete previous mission'}</b>
            <span>Completed</span><b>{st.completed ? `yes · best ${st.best}` : 'no'}</b>
            <span>Plays</span><b>{st.plays}</b>
            <span>Attempts left</span><b>{st.cooldown ? 0 : st.attemptsLeft}/{MAX_ATTEMPTS}</b>
            <span>Time limit</span><b>{fmtTime(sel.timeLimit)} sim</b>
            <span>Reward</span><b>{sel.rewards.xp} XP</b>
          </div>
          {st.cooldown && <div className="bad small" style={{ marginTop: 8 }}>⏳ Cooldown after {MAX_ATTEMPTS} failed attempts — unlocks in <Countdown until={st.lockedUntil} /></div>}
          {sqInfo?.locked && <div className="bad small">Squad cooldown active.</div>}
          {history.length > 0 && <><div className="section-title">Mission review</div>{history.map((h, i) => <div key={i} className="tiny">{new Date(h.t).toLocaleString()} — <span className={h.success ? 'good' : 'bad'}>{h.success ? 'success' : h.note || 'failed'}</span> · {h.score} pts</div>)}</>}
          <div className="row wrap" style={{ marginTop: 14 }}>
            {mode === 'solo' && canResume && <button className="btn amber" onClick={resumeLive} data-testid="resume">Resume mission</button>}
            {mode === 'solo' && <button className="btn primary" disabled={!st.unlocked || st.cooldown} onClick={() => openBriefing(sel)} data-testid="start-mission">{st.completed ? 'Replay (new attempt)' : st.active && !canResume ? 'Start new attempt' : 'Mission briefing →'}</button>}
            {mode === 'squad' && isLeader && <button className="btn primary" disabled={!st.unlocked || st.cooldown} onClick={() => leaderSelectMission(sel)} data-testid="squad-start">Brief the squad →</button>}
          </div>
          {mode === 'solo' && st.active && !canResume && <div className="tiny warn" style={{ marginTop: 6 }}>An earlier attempt was left unfinished; it will be recorded as a failed attempt.</div>}
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- 2. Satellite Operations Center
export function SatOps() {
  const [fleet, setFleet] = useState(null);
  const [cat, setCat] = useState([]);
  const [live, setLive] = useState({ records: [], status: '' });
  const [now] = useState(Date.now());
  useEffect(() => { (async () => { const p = await getPlatform(); const f = await p.db.doc(`data/users/${p.uid}/fleet`).get(); setFleet(f.exists ? f.data() : null); })().catch(() => {}); loadSnapshot().then(setCat).catch(() => {}); }, []);
  const extRows = [...cat, ...live.records];
  return (
    <Shell title="📡 Satellite Operations Center" color="#7cff9b">
      <div className="section-title">Your fleet <span className="sim-tag">SIMULATED · player-created</span></div>
      {!fleet ? <div className="small muted">No fleet data yet — complete a mission to see your spacecraft here. During missions, live fleet telemetry appears in the HUD.</div> : (
        <>
          <div className="small muted">From mission <b>{fleet.title}</b> ({new Date(fleet.t).toLocaleString()}), state at T+{fmtTime(fleet.simT)}.</div>
          <div className="scroll" style={{ maxHeight: 260, marginTop: 6 }}>
            <table className="t"><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Health</th><th>Battery</th><th>Fuel</th><th>Comms</th><th>Perigee×Apogee</th><th>Inc</th><th>Period</th></tr></thead>
              <tbody>{fleet.sats.map((x) => (
                <tr key={x.id}><td className="tiny">{x.id}</td><td style={{ color: x.color }}>{x.name}</td><td>{!x.deployed ? 'stowed' : x.alive ? <span className="good">alive</span> : <span className="bad">lost</span>}</td>
                  <td style={{ minWidth: 70 }}><Bar v={x.health / 100} /></td><td style={{ minWidth: 70 }}><Bar v={x.battery / x.batteryCap} /></td><td>{x.fuelCap ? `${((x.fuel / x.fuelCap) * 100).toFixed(0)}%` : 'n/a'}</td>
                  <td className={x.comms === 'lost' ? 'bad' : ''}>{x.comms}</td><td>{x.el ? `${perigeeAlt(x.el).toFixed(0)}×${apogeeAlt(x.el).toFixed(0)} km` : '—'}</td><td>{x.el ? `${(x.el.i / DEG).toFixed(1)}°` : '—'}</td><td>{x.el ? `${(period(x.el.a) / 60).toFixed(1)} min` : '—'}</td></tr>
              ))}</tbody></table>
          </div>
          <div className="section-title">Collision warnings (last mission)</div>
          {(fleet.conjunctions || []).filter((c) => c.bKind === 'debris').length === 0 ? <div className="small muted">None recorded.</div> : (fleet.conjunctions || []).filter((c) => c.bKind === 'debris').map((c) => <div key={c.id} className="small">⚠ {fleet.sats.find((s) => s.id === c.a)?.name} × {c.bName} — miss {c.d?.toFixed(2)} km · <span className="pill">{c.status}</span></div>)}
        </>
      )}
      <div className="section-title">External satellite records <span className="ext-tag">EXTERNAL DATA</span></div>
      <div className="notice">Source: {SNAPSHOT_SOURCE.name}. Element epoch {SNAPSHOT_SOURCE.epoch}. Positions are SGP4-propagated to the epoch shown — this is a static historical snapshot, <b>not live tracking</b>.</div>
      <div className="row" style={{ margin: '8px 0' }}><button className="btn sm" onClick={async () => { setLive({ records: [], status: 'Fetching…' }); const r = await fetchLiveTles(); setLive({ records: r.records, status: r.records.length ? `Fetched ${r.records.length} records at ${new Date().toLocaleTimeString()} from the TLE API (NASA Open APIs listing).` : `Live fetch not available from this page (${r.error || 'blocked'}). Snapshot only.` }); }}>Try live TLE fetch</button><span className="tiny muted">{live.status}</span></div>
      <div className="scroll" style={{ maxHeight: 240 }}>
        <table className="t"><thead><tr><th>NORAD</th><th>Name</th><th>Alt (mean)</th><th>Inc</th><th>Period</th><th>Element epoch</th><th>Position @ epoch+0 (lat/lon via SGP4)</th><th>Source</th></tr></thead>
          <tbody>{extRows.map((r) => { const pv = propagateRecord(r, 0); const lat = pv ? Math.asin(pv.r[2] / Math.hypot(...pv.r)) / DEG : null; return (
            <tr key={r.id + r.source}><td>{r.norad}</td><td>{r.name}</td><td>{r.altKm.toFixed(0)} km</td><td>{r.incDeg.toFixed(1)}°</td><td>{r.periodMin.toFixed(1)} min</td><td className="tiny">{new Date(r.epochMs).toISOString().slice(0, 16).replace('T', ' ')}</td><td className="tiny">{lat !== null ? `lat ${lat.toFixed(1)}°, |r| ${Math.hypot(...pv.r).toFixed(0)} km` : 'n/a'}</td><td className="tiny">{r.fetchedAt ? 'live API' : 'snapshot'}</td></tr>); })}</tbody></table>
      </div>
      <div className="tiny muted" style={{ marginTop: 6 }}>Panel opened {new Date(now).toLocaleString()}.</div>
    </Shell>
  );
}

// ---------------------------------------------------------------- 3. Spacecraft Design Laboratory
export function DesignLab() {
  const setG = useGame((s) => s.set);
  const go = useGame((s) => s.go);
  const profile = useGame((s) => s.profile);
  const templates = profile?.templates || [];
  const open = (design) => {
    const sandbox = { id: 'LAB', mode: 'sandbox', number: 0, tier: 'Lab', difficulty: 0, title: 'Design Laboratory', story: 'Free design sandbox.', timeLimit: 3600, req: {}, lock: {}, objectives: [], events: [], rewards: { xp: 0 }, tips: [] };
    setG({ mission: sandbox, design: { ...DEFAULT_DESIGN, ...design }, facility: null, autonomy: { startMode: 'manual' } });
    go('designer');
  };
  return (
    <Shell title="🛠 Spacecraft Design Laboratory" color="#ffb547">
      <p className="small">Design spacecraft freely: bus, solar arrays, battery, payload, propulsion, sensors and communications. The lab validates power, mass and launch constraints and can run a quick orbital power test. Saved templates can be loaded in any mission's designer.</p>
      <button className="btn primary" onClick={() => open({})} data-testid="lab-new">Open designer (new spacecraft)</button>
      <div className="section-title">Saved templates</div>
      {templates.length === 0 ? <div className="small muted">No templates yet.</div> : <div className="mlist">{templates.map((t, i) => <button key={i} className="mcard" onClick={() => open(t)}><b>{t.name}</b><div className="tiny muted">{t.bus} · {t.payload} · {t.panelArea} m² · {t.batteryWh} Wh · {t.propulsion}</div></button>)}</div>}
    </Shell>
  );
}

// ---------------------------------------------------------------- 4. Autonomous Intelligence Operations Center
export function AIOps() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { const p = await getPlatform(); const d = await p.db.doc(`data/users/${p.uid}/airecords`).get(); setItems(d.exists ? d.data().items || [] : []); })().catch(() => {}); }, []);
  const counts = useMemo(() => { const c = {}; for (const i of items) c[i.status] = (c[i.status] || 0) + 1; return c; }, [items]);
  return (
    <Shell title="🧠 Autonomous Intelligence Operations Center" color="#b18cff">
      <div className="split">
        <div>
          <div className="section-title">Agents</div>
          {Object.entries(AGENTS).map(([k, x]) => <div key={k} className="row small" style={{ padding: '5px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}><span style={{ width: 22 }}>{x.icon}</span><div className="grow"><b>{x.name}</b><div className="tiny muted">{x.desc}</div></div></div>)}
          <div className="section-title">Safety & approval policy</div>
          <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
            <li><b>Manual mode:</b> agents are idle — no actions, no recommendations.</li>
            <li><b>AI-Assisted:</b> LOW-risk, reversible actions (payload duty, load shedding, sensor resets) run automatically and are logged.</li>
            <li><b>MEDIUM/HIGH-risk</b> (orbit changes, safe mode, irreversible reconfiguration) always wait for human <b>Approve / Reject / Modify</b>. In Squad Ops, high-risk approvals belong to the Mission Commander.</li>
            <li>All manoeuvres come from deterministic planners and pass the safety validator. Generative AI only explains.</li>
            <li>This is an educational simulation — not certified for real-world flight operations.</li>
          </ul>
        </div>
        <div>
          <div className="section-title">Decision history (recent missions)</div>
          <div className="row wrap" style={{ marginBottom: 6 }}>{Object.entries(counts).map(([k, v]) => <span key={k} className="pill">{k}: {v}</span>)}</div>
          <div className="scroll" style={{ maxHeight: 280 }}>
            {items.length === 0 ? <div className="small muted">No decisions recorded yet. Fly a mission in AI-Assisted mode.</div> : items.map((d, i) => (
              <div key={i} className="small" style={{ padding: '5px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}>
                <span className={`pill ${d.risk === 'high' ? 'bad' : d.risk === 'medium' ? 'warn' : 'good'}`}>{d.risk}</span> <b>{d.title}</b> <span className="tiny muted">[{d.mission} · {d.status}{d.by ? ` · ${d.by}` : ''}]</span>
                <div className="tiny muted">{d.reason}</div>
              </div>
            ))}
          </div>
          <div className="section-title">Ask ALUNA AI (explanations only)</div>
          <div className="row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Why is a prograde burn used for avoidance?" /><button className="btn" disabled={!q || busy} onClick={async () => { setBusy(true); setA(await askAluna(q, { facility: 'ai-ops' })); setBusy(false); }}>{busy ? '…' : 'Ask'}</button></div>
          {a && <div className="small" style={{ marginTop: 8, padding: 10, background: 'rgba(177,140,255,0.08)', borderRadius: 8 }}>{a}</div>}
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- 5. Training & Simulation Room
export function Training() {
  return (
    <Shell title="🎓 Training & Simulation Room" color="#5cf2d6">
      <div className="split">
        <div>
          <div className="section-title">Controls</div>
          <div className="kv small">
            <span>Move</span><b><span className="kbd">W A S D</span> / arrows · touch joystick</b>
            <span>Sprint</span><b><span className="kbd">Shift</span></b>
            <span>Interact / enter facility</span><b><span className="kbd">E</span> or Enter</b>
            <span>Camera</span><b>drag mouse · wheel zoom</b>
            <span>Select satellite</span><b><span className="kbd">1–9</span> · <span className="kbd">Tab</span> · click</b>
            <span>Follow selected</span><b><span className="kbd">F</span></b>
            <span>Switch operation mode</span><b><span className="kbd">M</span></b>
            <span>Pause / time warp</span><b><span className="kbd">Space</span> · <span className="kbd">+</span>/<span className="kbd">−</span></b>
            <span>Mission menu</span><b><span className="kbd">Esc</span></b>
          </div>
          <div className="section-title">Operations primer</div>
          <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
            <li><b>Prograde</b> burns raise the opposite side of the orbit; <b>retrograde</b> lowers it. A satellite in a lower orbit moves faster and drifts ahead.</li>
            <li><b>Plan transfer</b> computes a two-burn Hohmann transfer; the circularization burn is scheduled automatically.</li>
            <li><b>Plane changes</b> are efficient only near the equator (nodes) and are expensive in Δv.</li>
            <li><b>Eclipses</b> drain batteries. Shed loads or duty-cycle the payload; safe mode is a last resort.</li>
            <li><b>Conjunctions</b>: earlier avoidance burns need less Δv. Miss distance under 1 km is loss of vehicle.</li>
          </ul>
        </div>
        <div>
          <div className="section-title">Practice drills (never use attempts)</div>
          {TRAINING.map((t) => (
            <div key={t.id} className="glass" style={{ padding: 10, marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>{t.title}</b><button className="btn sm primary" onClick={() => startTraining(t.id)} data-testid={`drill-${t.id}`}>Start drill</button></div>
              <div className="tiny muted">{t.story}</div>
            </div>
          ))}
          <div className="notice">Test spacecraft designs in the Design Laboratory with the built-in orbital power test.</div>
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- 6. Squad Coordination Room
export function SquadRoom() {
  const plat = useGame((s) => s.platform);
  const profile = useGame((s) => s.profile);
  const friends = useGame((s) => s.friends);
  const online = useGame((s) => s.online);
  const squad = useGame((s) => s.squad);
  const memberships = useGame((s) => s.memberships);
  const invites = useGame((s) => s.invites) || [];
  const toast = useGame((s) => s.toast);
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]); const [code, setCode] = useState(''); const [people, setPeople] = useState({});
  const me = plat?.uid;
  const isLeader = squad?.leader === me;
  const ids = useMemo(() => [...new Set([...friends.friends, ...friends.incoming, ...friends.outgoing, ...friends.declined, ...(squad?.members || []).map((m) => m.uid), ...invites.map((i) => i.leader), ...(squad?.invites || [])])], [friends, squad, invites]);
  useEffect(() => { if (ids.length) getPlayers(ids).then(setPeople).catch(() => {}); }, [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const nm = (u) => people[u]?.displayName || people[u]?.username || 'Unknown operator';
  const safe = (fn, ok) => async (...a) => { try { await fn(...a); if (ok) toast(ok, 'good'); } catch (e) { toast(`Failed: ${e?.message || e?.code || e}`, 'bad'); } };
  const roles = squad ? effectiveRoles(squad) : {};
  const myMem = memberships.find((x) => x.uid === me);
  return (
    <Shell title="👥 Squad Coordination Room" color="#ff6fa8" right={<span className="pill">{plat?.mode === 'cloud' ? 'online multiplayer' : 'local multi-tab mode'}</span>}>
      {plat?.mode !== 'cloud' && <div className="notice" style={{ marginBottom: 10 }}>This page is running with a browser-local backend, so friends and squads only work between tabs of this browser. Open ALUNA inside claude.ai (signed in, with Contributor/Editor access) for real online multiplayer.</div>}
      <div className="split">
        <div>
          <div className="section-title">Your squad</div>
          {!squad ? (
            <div className="col">
              <button className="btn primary" onClick={safe(async () => { await createSquad(null, profile); await attachSquad(me); }, 'Squad created')} data-testid="create-squad">Create a private squad</button>
              <div className="row"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Squad code (6 chars)" maxLength={6} aria-label="squad code" /><button className="btn" onClick={safe(async () => { const s = await findSquadByCode(code); if (!s) throw new Error('No squad with that code'); await joinSquad(s.leader); await attachSquad(s.leader); }, 'Join request sent')} data-testid="join-code">Join</button></div>
            </div>
          ) : (
            <div className="glass" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>{squad.name}</b><span className="pill">code <b style={{ userSelect: 'all' }} data-testid="squad-code">{squad.code}</b></span></div>
              <div className="tiny muted">{squad.members.length}/4 members · team score {squad.teamScore || 0} · {Object.values(squad.progress || {}).filter((x) => x.completed).length}/25 squad missions</div>
              {squad.members.map((m) => {
                const mem = memberships.find((x) => x.uid === m.uid);
                return (
                  <div key={m.uid} className="row" style={{ padding: '6px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}>
                    <Avatar look={people[m.uid]?.look} size={30} />
                    <div className="grow"><div className="small"><b>{m.uid === me ? `${profile.displayName} (you)` : nm(m.uid)}</b> {m.uid === squad.leader && <span className="pill">leader</span>} <span className={`pill ${online.has(m.uid) ? 'good' : ''}`}>{online.has(m.uid) ? 'online' : 'offline'}</span> {m.uid !== squad.leader && <span className={`pill ${mem?.ready ? 'good' : 'warn'}`}>{mem?.ready ? 'ready' : 'not ready'}</span>}</div>
                      <div className="tiny muted">{(roles[m.uid] || []).map((r) => ROLE_LABELS[r]).join(' · ') || 'no role'}</div></div>
                    {isLeader && <select style={{ width: 150 }} aria-label="assign role" value={(m.roles || [])[0] || ''} onChange={(e) => { const r = e.target.value; const members = squad.members.map((x) => (x.uid === m.uid ? { ...x, roles: r ? [r] : [] } : { ...x, roles: (x.roles || []).filter((y) => y !== r) })); updateSquad({ members }).catch(() => {}); }}><option value="">(unassigned)</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>}
                  </div>
                );
              })}
              <div className="tiny muted" style={{ marginTop: 6 }}>Unassigned roles are covered by the leader. Roles gate actions: Commander (mode, high-risk approvals, authorize, time warp) · Flight (burns, deploy) · Systems (power, payload, faults) · Autonomy (agent approvals & reviews).</div>
              <div className="row wrap" style={{ marginTop: 10 }}>
                {!isLeader && <button className={`btn sm ${myMem?.ready ? 'active' : ''}`} onClick={() => setReady(!myMem?.ready)} data-testid="ready">{myMem?.ready ? '✓ Ready' : 'Mark ready'}</button>}
                {isLeader && <button className="btn sm" onClick={() => { window.dispatchEvent(new Event('aluna:regroup')); squadCtx.room?.emit('regroup', {}).catch(() => {}); }}>Regroup outside & enter together</button>}
                <button className="btn sm danger" onClick={safe(async () => { await leaveSquad(); detachSquad(); }, 'Left squad')}>Leave squad</button>
              </div>
            </div>
          )}
          {invites.filter((i) => i.leader !== me).length > 0 && <><div className="section-title">Squad invitations</div>{invites.filter((i) => i.leader !== me).map((i) => <div key={i.id} className="row small"><span className="grow">{nm(i.leader)} invited you to <b>{i.name}</b></span><button className="btn sm primary" onClick={safe(async () => { await joinSquad(i.leader); await attachSquad(i.leader); }, 'Joined squad')}>Accept</button></div>)}</>}
          {squad?.history?.length > 0 && <><div className="section-title">Squad history</div>{squad.history.slice(0, 6).map((h, i) => <div key={i} className="tiny">{h.mission} — <span className={h.success ? 'good' : 'bad'}>{h.success ? 'success' : 'failed'}</span> · {h.score} pts · {new Date(h.t).toLocaleDateString()}</div>)}</>}
        </div>
        <div>
          <div className="section-title">Find players</div>
          <div className="row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search username…" aria-label="search players" /><button className="btn" onClick={async () => setHits(await searchPlayers(q))} data-testid="search">Search</button></div>
          {hits.map((h) => <div key={h.uid} className="row small" style={{ padding: '4px 0' }}><Avatar look={h.look} size={26} /><span className="grow">{h.displayName || h.username} <span className="tiny muted">@{h.username} · L{h.level}</span></span>{friends.friends.includes(h.uid) ? <span className="pill good">friend</span> : <button className="btn xs" onClick={safe(() => sendFriendRequest(h.uid), 'Friend request sent')} data-testid="add-friend">Add friend</button>}</div>)}
          <div className="section-title">Friend requests</div>
          {friends.incoming.length === 0 && <div className="tiny muted">No incoming requests.</div>}
          {friends.incoming.map((u) => <div key={u} className="row small"><span className="grow">{nm(u)}</span><button className="btn xs primary" onClick={safe(() => acceptFriend(u), 'Friend added')} data-testid="accept-friend">Accept</button><button className="btn xs danger" onClick={safe(() => rejectFriend(u), 'Request rejected')} data-testid="reject-friend">Reject</button></div>)}
          {friends.outgoing.map((u) => <div key={u} className="tiny muted">Pending: {nm(u)}</div>)}
          {friends.declined.map((u) => <div key={u} className="tiny bad">Declined by {nm(u)}</div>)}
          <div className="section-title">Friends ({friends.friends.length})</div>
          {friends.friends.map((u) => (
            <div key={u} className="row small" style={{ padding: '4px 0' }}>
              <Avatar look={people[u]?.look} size={26} />
              <span className="grow">{nm(u)} <span className={`pill ${online.has(u) ? 'good' : ''}`}>{online.has(u) ? 'online' : 'offline'}</span></span>
              {isLeader && !squad.members.some((m) => m.uid === u) && <button className="btn xs" onClick={safe(() => inviteToSquad(u), 'Invitation sent')} data-testid="invite">{squad.invites.includes(u) ? 'Invited' : 'Invite'}</button>}
              <button className="btn xs ghost" onClick={safe(() => removeFriend(u), 'Friend removed')} aria-label="remove friend">✕</button>
            </div>
          ))}
          <div className="tiny muted" style={{ marginTop: 8 }}>Online status reflects players currently connected to ALUNA's real-time lobby.</div>
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- Profile modal
export function ProfileModal() {
  const setG = useGame((s) => s.set);
  const profile = useGame((s) => s.profile);
  const progress = useGame((s) => s.progress);
  const user = useGame((s) => s.user);
  const plat = useGame((s) => s.platform);
  const lvl = levelFor(progress?.xp);
  const [confirm, setConfirm] = useState(null);
  return (
    <div className="modal-back" onClick={() => setG({ modal: null })}>
      <div className="glass card" style={{ width: 'min(720px,100%)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto' }} onClick={(e) => e.stopPropagation()} data-testid="profile">
        <div className="row"><Avatar look={profile?.look} size={64} /><div className="grow"><h2>{profile?.displayName}</h2><div className="small muted">@{user?.username} · Level {lvl} · {progress?.xp || 0} XP · total score {progress?.totalScore || 0}</div><div className="tiny muted">{plat?.label}</div></div><button className="btn sm" onClick={() => setG({ modal: null })}>✕</button></div>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <span className="pill">Solo {Object.values(progress?.solo || {}).filter((x) => x.completed).length}/25</span>
          <span className="pill">Squad {Object.values(progress?.squad || {}).filter((x) => x.completed).length}/25</span>
          <span className="pill">Missions completed {Object.values(progress?.solo || {}).filter((x) => x.completed).length + Object.values(progress?.squad || {}).filter((x) => x.completed).length}</span>
        </div>
        <div className="section-title">Appearance</div>
        <div className="row small"><span className="swatch" style={{ background: profile?.look?.suit }} /> suit <span className="swatch" style={{ background: profile?.look?.trim }} /> trim · height ×{profile?.look?.height?.toFixed(2)} <button className="btn xs" onClick={() => { setG({ modal: null }); useGame.getState().go('setup'); }}>Edit profile</button></div>
        <div className="section-title">Achievements</div>
        <div className="mlist">{ACHIEVEMENTS.map((a) => { const has = profile?.achievements?.includes(a.id); return <div key={a.id} className="mcard" style={{ opacity: has ? 1 : 0.35, cursor: 'default' }}><div style={{ fontSize: 22 }}>{a.icon}</div><b className="small">{a.name}</b><div className="tiny muted">{a.desc}</div></div>; })}</div>
        <div className="section-title">Mission history</div>
        <div className="scroll" style={{ maxHeight: 180 }}>{(progress?.history || []).length === 0 ? <div className="small muted">No missions flown yet.</div> : progress.history.map((h, i) => <div key={i} className="tiny">{new Date(h.t).toLocaleString()} · {h.mode} {h.id} {h.title} — <span className={h.success ? 'good' : 'bad'}>{h.success ? 'success' : h.note || 'failed'}</span> · {h.score} pts</div>)}</div>
        <div className="section-title">Squad history</div>
        {(profile?.squadHistory || []).length === 0 ? <div className="small muted">No squad missions yet.</div> : profile.squadHistory.map((h, i) => <div key={i} className="tiny">{new Date(h.t).toLocaleDateString()} · {h.squad} · {h.mission} — {h.success ? 'success' : 'failed'} · roles {(h.roles || []).join(', ')}</div>)}
        <div className="section-title">Danger zone</div>
        <div className="row wrap"><button className="btn sm danger" onClick={() => setConfirm('solo')}>Reset Solo Campaign</button><button className="btn sm danger" onClick={() => setConfirm('squad')}>Reset personal Squad history</button><button className="btn sm danger" onClick={() => setConfirm('all')} data-testid="reset-all">Full new game reset</button></div>
        {confirm && <ResetConfirm scope={confirm} onDone={() => setConfirm(null)} />}
      </div>
    </div>
  );
}

function ResetConfirm({ scope, onDone }) {
  const setG = useGame((s) => s.set);
  const toast = useGame((s) => s.toast);
  const [txt, setTxt] = useState('');
  return (
    <div className="glass" style={{ padding: 12, marginTop: 10, borderColor: 'rgba(255,92,92,0.6)' }}>
      <div className="small">This permanently resets <b>{scope === 'all' ? 'ALL progress, XP, history and achievements' : scope === 'solo' ? 'your Solo Campaign progress' : 'your personal Squad Ops records'}</b>. Type <b>RESET</b> to confirm.</div>
      <div className="row" style={{ marginTop: 6 }}><input value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="type RESET" /><button className="btn danger" disabled={txt !== 'RESET'} onClick={async () => { const { resetProgress } = await import('../services/progress.js'); const prog = await resetProgress(scope); const p = await getPlatform(); const prof = (await p.db.doc(`data/users/${p.uid}/profile`).get()).data(); setG({ progress: prog, profile: prof }); toast('Progress reset.', 'warn'); onDone(); }} data-testid="confirm-reset">Reset</button><button className="btn ghost" onClick={onDone}>Cancel</button></div>
    </div>
  );
}
