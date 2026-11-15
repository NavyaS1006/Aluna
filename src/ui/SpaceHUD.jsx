// In-mission HUD — clean hierarchy, minimizable/closable panels, keyboard + touch friendly.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, useHud, runtime } from '../state/store.js';
import { act } from '../game/dispatch.js';
import { perigeeAlt, apogeeAlt, propagate, period, subPoint, DEG, v3, RE } from '../sim/orbit.js';
import { STATIONS, ROLE_LABELS } from '../sim/engine.js';
import { AGENTS } from '../sim/agents.js';
import { PROPULSION } from '../sim/design.js';
import { Bar, Panel, fmtTime, Confirm } from './common.jsx';
import { restartMission, abortMission, finishSolo, saveLive } from '../game/flow.js';
import { explainDecision } from '../services/assistant.js';
import { fetchLiveTles, SNAPSHOT_SOURCE } from '../sim/catalog.js';

function useTick(ms = 200) {
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(i); }, [ms]);
}

/** Runs the authoritative engine (solo / squad host) in its own rAF loop. */
export function EngineLoop() {
  const ending = useRef(false);
  useEffect(() => {
    let raf, last = performance.now();
    const loop = (now) => {
      const dt = (now - last) / 1000; last = now;
      const e = runtime.engine;
      const sc = runtime.squadClient;
      if (e && (!sc || sc.isHost)) {
        e.update(dt);
        if (!sc) saveLive();
        sc?.hostTick?.(now);
        if (e.s.ended && !ending.current) {
          ending.current = true;
          setTimeout(() => { if (sc) sc.hostFinish(); else finishSolo(); }, 1800);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return null;
}

const sevClass = { crit: 'crit', warn: 'warn', good: 'good', ai: 'ai', info: '' };

function Objectives({ e, can }) {
  const panels = useHud((s) => s.panels); const toggle = useHud((s) => s.toggle);
  return (
    <Panel title="Objectives" onMin={() => toggle('objectives')} minimized={!panels.objectives} right={<span className="pill">{e.s.objectives.filter((o) => o.done).length}/{e.s.objectives.length}</span>}>
      <div className="panel-body scroll" style={{ maxHeight: 260 }}>
        {e.s.objectives.map((o) => (
          <div key={o.id} className={`obj ${o.done ? 'done' : o.failed ? 'failed' : ''}`}>
            <span className="box">{o.done ? '✓' : o.failed ? '✕' : ''}</span>
            <div className="grow">
              <div>{o.label} {o.required === false && <span className="pill">bonus</span>}</div>
              {o.role && <div className="tiny muted">{ROLE_LABELS[o.role]}</div>}
              {!o.done && !o.failed && !['battery_floor', 'no_collision', 'min_alive', 'fuel_reserve'].includes(o.type) && <div style={{ marginTop: 4 }}><Bar v={o.progress} color="var(--accent)" h={4} /></div>}
              {o.waiting && <div className="tiny muted">Becomes active after the anomaly.</div>}
              {o.type === 'authorize' && !o.done && <button className="btn xs amber" style={{ marginTop: 4 }} disabled={!can('authorize')} onClick={() => act({ type: 'authorize' })} data-testid="authorize">Authorize GO</button>}
              {o.type === 'formation' && o.gaps && <div className="tiny muted">Gaps: {o.gaps.join(' / ')} km (target {o.minKm}–{o.maxKm})</div>}
              {['battery_floor', 'no_collision', 'min_alive'].includes(o.type) && !o.failed && !o.done && <div className="tiny good">Holding</div>}
              {o.failed && <div className="tiny bad">{o.why}</div>}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DecisionCard({ d, canDecide }) {
  const [mod, setMod] = useState(false);
  const [params, setParams] = useState(() => ({ ...d.action }));
  const [expl, setExpl] = useState(null);
  const risk = { low: 'good', medium: 'warn', high: 'bad' }[d.risk];
  return (
    <div className="glass" style={{ padding: 10, marginBottom: 8, borderColor: d.status === 'pending' ? (d.risk === 'high' ? 'rgba(255,92,92,0.6)' : 'rgba(255,209,102,0.5)') : 'var(--line)' }} data-testid="decision-card">
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="small"><b>{AGENTS[d.agent]?.icon} {d.title}</b></span><span className={`pill ${risk}`}>{d.risk.toUpperCase()}</span></div>
      <div className="tiny muted" style={{ margin: '4px 0' }}>{AGENTS[d.agent]?.name} · T+{fmtTime(d.t)} · confidence {(d.confidence * 100).toFixed(0)}%</div>
      <div className="small"><b>Reason:</b> {d.reason}</div>
      <div className="small"><b>Predicted consequences:</b> {d.consequences}</div>
      <div className="small"><b>Safety:</b> {d.safety}</div>
      {expl && <div className="small" style={{ marginTop: 6, padding: 8, background: 'rgba(177,140,255,0.08)', borderRadius: 8 }}><b>ALUNA AI explains:</b> {expl}</div>}
      {mod && (
        <div className="row wrap" style={{ marginTop: 6 }}>
          {'dv' in params && <><label style={{ margin: 0 }}>Δv m/s</label><input style={{ width: 80 }} type="number" step="0.1" value={params.dv} onChange={(e) => setParams({ ...params, dv: +e.target.value })} /></>}
          {'dir' in params && <select style={{ width: 120 }} value={params.dir} onChange={(e) => setParams({ ...params, dir: e.target.value })}>{['prograde', 'retrograde', 'radial', 'antiradial', 'normal', 'antinormal'].map((x) => <option key={x}>{x}</option>)}</select>}
          {'alt' in params && <><label style={{ margin: 0 }}>alt km</label><input style={{ width: 80 }} type="number" value={params.alt} onChange={(e) => setParams({ ...params, alt: +e.target.value })} /></>}
          {'inc' in params && <><label style={{ margin: 0 }}>inc °</label><input style={{ width: 80 }} type="number" step="0.1" value={params.inc} onChange={(e) => setParams({ ...params, inc: +e.target.value })} /></>}
          {!('dv' in params || 'alt' in params || 'inc' in params) && <span className="tiny muted">This action has no adjustable parameters.</span>}
        </div>
      )}
      <div className="row wrap" style={{ marginTop: 8 }}>
        {d.status === 'pending' && canDecide && <>
          <button className="btn sm primary" onClick={() => act({ type: 'decision', id: d.id, verdict: mod ? 'modify' : 'approve', params: mod ? params : undefined })} data-testid="approve">{mod ? 'Apply modified' : 'Approve'}</button>
          <button className="btn sm danger" onClick={() => act({ type: 'decision', id: d.id, verdict: 'reject' })} data-testid="reject">Reject</button>
          <button className="btn sm" onClick={() => setMod(!mod)}>{mod ? 'Cancel modify' : 'Modify'}</button>
        </>}
        {d.status === 'pending' && !canDecide && <span className="tiny muted">Awaiting {d.risk === 'high' ? 'Mission Commander' : 'Autonomy Supervisor / Commander'}</span>}
        {d.status === 'auto' && !d.reviewed && canDecide && <button className="btn sm" onClick={() => act({ type: 'decision', id: d.id, verdict: 'ack' }, { quiet: true })}>Mark reviewed</button>}
        {d.status !== 'pending' && <span className={`pill ${d.status === 'rejected' || d.status === 'failed' ? 'bad' : 'good'}`}>{d.status}{d.reviewed ? ' · reviewed' : ''}{d.by ? ` · ${d.by}` : ''}</span>}
        <button className="btn sm ghost" onClick={async () => setExpl(await explainDecision(d, runtime.engine))}>Explain</button>
      </div>
      {d.result && <div className="tiny muted" style={{ marginTop: 4 }}>{d.result}</div>}
    </div>
  );
}

function AIPanel({ e, canDecide }) {
  const panels = useHud((s) => s.panels); const toggle = useHud((s) => s.toggle);
  const [tab, setTab] = useState('pending');
  const pending = e.s.decisions.filter((d) => d.status === 'pending');
  const history = [...e.s.decisions].reverse().filter((d) => d.status !== 'pending').slice(0, 25);
  return (
    <Panel title={e.s.mode === 'ai' ? 'Autonomous agents · active' : 'Autonomous agents · standby'} onMin={() => toggle('ai')} minimized={!panels.ai} right={pending.length ? <span className="pill bad">{pending.length} pending</span> : null}>
      <div className="panel-body scroll" style={{ maxHeight: 360 }}>
        {e.s.mode === 'manual' ? <div className="small muted">Manual mode — agents are not observing or acting. Switch to AI-Assisted to enable routine automation and recommendations.{e.s.decisions.length > 0 && ' Decision history is preserved below.'}</div> : null}
        <div className="tabs" style={{ marginTop: 8 }}><button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>Approvals ({pending.length})</button><button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button></div>
        {tab === 'pending' && (pending.length ? pending.map((d) => <DecisionCard key={d.id} d={d} canDecide={canDecide(d)} />) : <div className="small muted">No approvals pending.</div>)}
        {tab === 'history' && (history.length ? history.map((d) => <DecisionCard key={d.id} d={d} canDecide={canDecide(d)} />) : <div className="small muted">No decisions yet.</div>)}
      </div>
    </Panel>
  );
}

function Inspector({ e, sat, can }) {
  const panels = useHud((s) => s.panels); const toggle = useHud((s) => s.toggle);
  const setFocus = useHud((s) => s.setFocus); const focus = useHud((s) => s.focus);
  const [dir, setDir] = useState('prograde'); const [dv, setDv] = useState(2); const [alt, setAlt] = useState(600); const [inc, setInc] = useState(53);
  if (!sat) return (
    <Panel title="Satellite inspector" onMin={() => toggle('inspector')} minimized={!panels.inspector}>
      <div className="panel-body small muted">Select a satellite (click it, its chip below, or press 1–9).{e.s.sats.some((x) => !x.deployed) && <div style={{ marginTop: 10 }}><button className="btn primary sm" disabled={!can('deploy')} onClick={() => act({ type: 'deploy' })} data-testid="deploy">Deploy next satellite ({e.s.sats.filter((x) => !x.deployed).length} in stage)</button></div>}</div>
    </Panel>
  );
  const t = e.renderT();
  const st = sat.deployed ? propagate(sat.el, t) : null;
  const sp = st ? subPoint(st.r, t) : null;
  const pct = sat.battery / sat.batteryCap;
  const station = STATIONS.find((x) => x.id === sat.inContact);
  const ops = [];
  if (sat.sensor === 'fault') ops.push(['sensor_reset', 'Reset sensor']);
  if (sat.comms === 'lost') { ops.push(['comms_reboot', 'Reboot transceiver']); ops.push(['comms_backup', 'Backup antenna']); }
  if (sat.solarEff < 0.95) ops.push(['panel_realign', 'Realign array']);
  if (sat.extraLoad > 0) ops.push(['heater_reset', 'Reset heater relay']);
  if (sat.prop === 'fault') ops.push(['prop_backup', 'Backup thruster']);
  if (sat.payload === 'fault') ops.push(['payload_reset', 'Reboot payload']);
  return (
    <Panel title={<span style={{ color: sat.color }}>● {sat.name}</span>} onMin={() => toggle('inspector')} minimized={!panels.inspector} right={<span className="sim-tag">SIMULATED</span>}>
      <div className="panel-body scroll" style={{ maxHeight: 'calc(100vh - 300px)' }} data-testid="inspector">
        <div className="tiny muted">{sat.id} · {e.design.name}</div>
        <div className="row" style={{ margin: '6px 0' }}>
          <span className={`pill ${sat.alive ? 'good' : 'bad'}`}>{!sat.deployed ? 'STOWED' : sat.alive ? (sat.safeMode ? 'SAFE MODE' : 'NOMINAL') : 'LOST'}</span>
          {sat.eclipse && <span className="pill">🌑 eclipse</span>}
          {sat.busy && <span className="pill warn">⏳ {sat.busy}</span>}
        </div>
        <div className="kv">
          <span>Health</span><b>{sat.health.toFixed(0)}%</b>
        </div><Bar v={sat.health / 100} />
        <div className="kv" style={{ marginTop: 6 }}><span>Battery</span><b>{sat.battery.toFixed(0)} / {sat.batteryCap.toFixed(0)} Wh ({(pct * 100).toFixed(0)}%)</b></div><Bar v={pct} />
        <div className="kv" style={{ marginTop: 6 }}><span>Fuel</span><b>{sat.fuelCap ? `${sat.fuel.toFixed(2)} / ${sat.fuelCap} kg` : 'n/a'}</b></div><Bar v={sat.fuelCap ? sat.fuel / sat.fuelCap : 0} color="var(--amber)" />
        <div className="kv" style={{ marginTop: 8 }}>
          <span>Power gen / load</span><b className={sat.gen < sat.load ? 'warn' : 'good'}>{sat.gen.toFixed(0)} / {sat.load.toFixed(0)} W</b>
          <span>Solar array</span><b>{(sat.solarEff * 100).toFixed(0)}%</b>
          <span>Comms</span><b className={sat.comms === 'lost' ? 'bad' : sat.comms === 'degraded' ? 'warn' : 'good'}>{sat.comms.toUpperCase()}{sat.commsBackup ? ' (backup)' : ''}</b>
          <span>Ground contact</span><b>{station ? station.name : sat.linked ? 'via relay link' : '—'}</b>
          <span>Sensor / payload</span><b className={sat.sensor === 'fault' || sat.payload === 'fault' ? 'bad' : ''}>{sat.sensor} / {sat.payload}{sat.payloadOn ? ' ON' : ''}</b>
          <span>Propulsion</span><b className={sat.prop === 'fault' ? 'bad' : ''}>{sat.prop}{sat.propBackup ? ' (backup)' : ''}</b>
          <span>Data stored / down</span><b>{sat.dataStored.toFixed(0)} / {sat.dataDown.toFixed(0)} MB</b>
        </div>
        {st && <>
          <div className="section-title">Orbit (deterministic propagation)</div>
          <div className="kv">
            <span>Altitude</span><b>{(v3.len(st.r) - RE).toFixed(1)} km</b>
            <span>Perigee × apogee</span><b>{perigeeAlt(sat.el).toFixed(0)} × {apogeeAlt(sat.el).toFixed(0)} km</b>
            <span>Inclination</span><b>{(sat.el.i / DEG).toFixed(2)}°</b>
            <span>Eccentricity</span><b>{sat.el.e.toFixed(5)}</b>
            <span>Period</span><b>{(period(sat.el.a) / 60).toFixed(1)} min</b>
            <span>Velocity</span><b>{v3.len(st.v).toFixed(3)} km/s</b>
            <span>Lat / lon</span><b>{sp.lat.toFixed(1)}°, {sp.lon.toFixed(1)}°</b>
          </div>
        </>}
        {sat.deployed && sat.alive && <>
          <div className="section-title">Operations</div>
          <div className="row wrap">
            <button className="btn sm" onClick={() => { setFocus(focus === sat.id ? null : sat.id); }}>{focus === sat.id ? 'Unfollow' : 'Follow (F)'}</button>
            {e.design.payload !== 'none' && <button className="btn sm" disabled={!can('payload')} onClick={() => act({ type: 'payload', sat: sat.id, on: !sat.payloadOn })}>Payload {sat.payloadOn ? 'OFF' : 'ON'}</button>}
            <button className="btn sm" disabled={!can('load_shed')} onClick={() => act({ type: 'load_shed', sat: sat.id, on: !sat.loadShed })}>{sat.loadShed ? 'Restore loads' : 'Shed loads'}</button>
            <button className="btn sm" disabled={!can('safe_mode')} onClick={() => act({ type: 'safe_mode', sat: sat.id, on: !sat.safeMode })}>{sat.safeMode ? 'Exit safe mode' : 'Safe mode'}</button>
          </div>
          {ops.length > 0 && <div className="row wrap" style={{ marginTop: 6 }}>{ops.map(([k, l]) => <button key={k} className="btn sm amber" disabled={!can(k)} onClick={() => act({ type: k, sat: sat.id })}>{l}</button>)}</div>}
          {e.design.propulsion !== 'none' && <>
            <div className="section-title">Manoeuvres · max {PROPULSION[e.design.propulsion].maxDv} m/s per burn</div>
            <div className="row">
              <select value={dir} onChange={(ev) => setDir(ev.target.value)} aria-label="burn direction">{['prograde', 'retrograde', 'radial', 'antiradial', 'normal', 'antinormal'].map((x) => <option key={x}>{x}</option>)}</select>
              <input type="number" step="0.1" min="0.1" value={dv} onChange={(ev) => setDv(+ev.target.value)} style={{ width: 80 }} aria-label="delta-v" />
              <button className="btn sm primary" disabled={!can('burn')} onClick={() => act({ type: 'burn', sat: sat.id, dir, dv })} data-testid="burn">Burn</button>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <input type="number" value={alt} onChange={(ev) => setAlt(+ev.target.value)} style={{ width: 90 }} aria-label="target altitude" />
              <button className="btn sm" disabled={!can('plan_transfer')} onClick={() => act({ type: 'plan_transfer', sat: sat.id, alt })} data-testid="transfer">Plan transfer (km)</button>
              <button className="btn sm" disabled={!can('circularize')} onClick={() => act({ type: 'circularize', sat: sat.id })}>Circularize</button>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <input type="number" step="0.1" value={inc} onChange={(ev) => setInc(+ev.target.value)} style={{ width: 90 }} aria-label="target inclination" />
              <button className="btn sm" disabled={!can('plane_change')} onClick={() => act({ type: 'plane_change', sat: sat.id, inc })}>Plane change (°)</button>
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>Every burn passes the safety validator: perigee ≥ 180 km, propellant, per-burn limit, post-burn conjunction screen.</div>
          </>}
        </>}
        {e.s.sats.some((x) => !x.deployed) && <div style={{ marginTop: 10 }}><button className="btn primary sm" disabled={!can('deploy')} onClick={() => act({ type: 'deploy' })} data-testid="deploy">Deploy next satellite ({e.s.sats.filter((x) => !x.deployed).length} in stage)</button></div>}
      </div>
    </Panel>
  );
}

function ConjunctionAlert({ e, can }) {
  const open = e.s.conjunctions.filter((c) => c.status === 'open' && c.bKind === 'debris' && ['high', 'critical', 'medium'].includes(c.risk)).sort((a, b) => a.tca - b.tca);
  const [plan, setPlan] = useState({});
  const [hidden, setHidden] = useState({});
  const c = open.find((x) => !hidden[x.id]);
  if (!c) return null;
  const sat = e.sat(c.a);
  const dec = e.s.decisions.find((d) => d.key === `avoid:${c.id}`);
  const p = plan[c.id];
  return (
    <div className="glass alert" role="alert" data-testid="conj-alert">
      <div className="panel-head" style={{ color: c.risk === 'medium' ? 'var(--warn)' : 'var(--bad)' }}><span>⚠ Conjunction warning · {c.risk.toUpperCase()}</span><button className="btn xs ghost" onClick={() => setHidden({ ...hidden, [c.id]: true })} aria-label="dismiss">✕</button></div>
      <div className="panel-body">
        <div className="small"><b style={{ color: sat?.color }}>{sat?.name}</b> × <b className="bad">{c.bName}</b> ({c.bKind})</div>
        <div className="kv" style={{ marginTop: 6 }}>
          <span>Time to closest approach</span><b>{fmtTime(c.tca - e.renderT())}</b>
          <span>Predicted miss distance</span><b>{c.d.toFixed(2)} ± {c.sigma.toFixed(2)} km</b>
          <span>Relative speed</span><b>{c.relSpeed.toFixed(2)} km/s</b>
          <span>Exclusion zone (loss of vehicle)</span><b>{'<'} 1.0 km</b>
        </div>
        <div className="small" style={{ marginTop: 6 }}>{c.d < 1 ? 'Predicted pass is inside the 1 km exclusion zone — without action the satellite will be lost.' : 'Predicted pass is close; an avoidance manoeuvre increases margin.'}</div>
        {e.s.mode === 'ai' && dec && <div className="small" style={{ marginTop: 6 }}>Collision agent recommendation: <b>{dec.title}</b> — status <span className="pill">{dec.status}</span></div>}
        {p && (p.none ? <div className="small bad">No validated manoeuvre within propulsion limits.</div> : <div className="small" style={{ marginTop: 6 }}>Recommendation (deterministic planner): <b>{p.dir} {p.dv} m/s</b> now → predicted miss {p.miss.toFixed(1)} km, propellant {p.fuel.toFixed(3)} kg.</div>)}
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn sm" disabled={!can('plan_avoid')} onClick={() => { const r = act({ type: 'plan_avoid', conj: c.id }, { quiet: true }); if (r.plan) setPlan({ ...plan, [c.id]: r.plan }); else if (r.pending) useGame.getState().toast('Planning request sent to host', 'info'); }} data-testid="plan-avoid">Compute avoidance</button>
          {p && !p.none && <button className="btn sm danger" disabled={!can('burn')} onClick={() => act({ type: 'burn', sat: p.sat, dir: p.dir, dv: p.dv, exitSafe: true })} data-testid="exec-avoid">Execute {p.dir} {p.dv} m/s</button>}
          <button className="btn sm ghost" onClick={() => { useHud.getState().setSel(c.a); useHud.getState().setFocus(c.a); }}>Focus satellite</button>
        </div>
      </div>
    </div>
  );
}

function FleetSummary({ e }) {
  const alive = e.s.sats.filter((x) => x.alive && x.deployed);
  const avg = (f) => (alive.length ? alive.reduce((a, x) => a + f(x), 0) / alive.length : 0);
  const pending = e.s.decisions.filter((d) => d.status === 'pending').length;
  const alerts = e.s.conjunctions.filter((c) => c.status === 'open' && ['high', 'critical'].includes(c.risk)).length;
  return (
    <div className="glass hud-box" style={{ minWidth: 220 }}>
      <div className="kv">
        <span>Satellites</span><b>{alive.length}/{e.s.sats.length}{e.s.sats.some((x) => !x.deployed) ? ` (${e.s.sats.filter((x) => !x.deployed).length} stowed)` : ''}</b>
        <span>Fleet health</span><b>{avg((x) => x.health).toFixed(0)}%</b>
        <span>Avg battery</span><b>{(avg((x) => x.battery / x.batteryCap) * 100).toFixed(0)}%</b>
        <span>Avg fuel</span><b>{(avg((x) => (x.fuelCap ? x.fuel / x.fuelCap : 0)) * 100).toFixed(0)}%</b>
        <span>Comms</span><b>{alive.filter((x) => x.comms !== 'lost').length}/{alive.length} up · {alive.filter((x) => x.inContact).length} in contact</b>
        <span>Power (gen/load)</span><b>{alive.reduce((a, x) => a + x.gen, 0).toFixed(0)}/{alive.reduce((a, x) => a + x.load, 0).toFixed(0)} W</b>
        <span>Collision alerts</span><b className={alerts ? 'bad' : ''}>{alerts}</b>
        <span>Pending approvals</span><b className={pending ? 'warn' : ''}>{pending}</b>
        <span>Agent actions</span><b>{e.s.stats.auto} auto</b>
      </div>
    </div>
  );
}

export default function SpaceHUD({ squadBar, canFn }) {
  useTick(200);
  const e = runtime.engine;
  const m = useGame((s) => s.mission);
  const setG = useGame((s) => s.set);
  const showCatalog = useGame((s) => s.showCatalog);
  const sel = useHud((s) => s.selected); const setSel = useHud((s) => s.setSel); const setFocus = useHud((s) => s.setFocus);
  const panels = useHud((s) => s.panels); const toggle = useHud((s) => s.toggle);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [mobile, setMobile] = useState(null);
  const can = canFn || (() => true);
  const canDecide = (d) => can(d.risk === 'high' ? 'decision_high' : 'decision');
  useEffect(() => { setG({ onSelectSat: (id) => act({ type: 'inspect', sat: id }, { quiet: true }) }); }, [setG]);
  useEffect(() => {
    const k = (ev) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName)) return;
      const en = runtime.engine; if (!en) return;
      const dep = en.s.sats.filter((x) => x.deployed);
      if (/^Digit[1-9]$/.test(ev.code)) { const s = dep[+ev.code.slice(5) - 1]; if (s) { setSel(s.id); act({ type: 'inspect', sat: s.id }, { quiet: true }); } }
      if (ev.code === 'Tab') { ev.preventDefault(); const i = dep.findIndex((x) => x.id === useHud.getState().selected); const s = dep[(i + 1) % Math.max(1, dep.length)]; if (s) { setSel(s.id); act({ type: 'inspect', sat: s.id }, { quiet: true }); } }
      if (ev.code === 'KeyM' && can('set_mode')) act({ type: 'set_mode', mode: en.s.mode === 'ai' ? 'manual' : 'ai' });
      if (ev.code === 'Space' && can('time_scale')) { ev.preventDefault(); act({ type: 'pause', on: !en.s.paused }, { quiet: true }); }
      if ((ev.code === 'Equal' || ev.code === 'NumpadAdd') && can('time_scale')) act({ type: 'time_scale', x: Math.min(600, en.s.timeScale * 2) }, { quiet: true });
      if ((ev.code === 'Minus' || ev.code === 'NumpadSubtract') && can('time_scale')) act({ type: 'time_scale', x: Math.max(1, en.s.timeScale / 2) }, { quiet: true });
      if (ev.code === 'KeyF') setFocus(useHud.getState().focus ? null : useHud.getState().selected);
      if (ev.code === 'Escape') setMenu((x) => !x);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setSel, setFocus, can]);
  if (!e) return null;
  const s = e.s;
  const sat = s.sats.find((x) => x.id === sel);
  const warps = [1, 10, 30, 60, 120, 300, 600];
  return (
    <>
      <div className="topbar">
        <div className="glass hud-box" style={{ minWidth: 230 }}>
          <div className="hud-title">{m.title.toUpperCase()}</div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="timer" data-testid="mission-timer">T+{fmtTime(s.t)}</span><span className="tiny muted">limit {fmtTime(m.timeLimit)}</span></div>
          <Bar v={1 - s.t / m.timeLimit} color={s.t / m.timeLimit > 0.8 ? 'var(--bad)' : 'var(--accent)'} h={3} />
          <div className="row" style={{ marginTop: 6, gap: 4 }}>
            <button className="btn xs" disabled={!can('time_scale')} onClick={() => act({ type: 'pause', on: !s.paused }, { quiet: true })} aria-label="pause">{s.paused ? '▶' : '⏸'}</button>
            {warps.map((w) => <button key={w} className={`btn xs ${s.timeScale === w ? 'active' : ''}`} disabled={!can('time_scale')} onClick={() => act({ type: 'time_scale', x: w }, { quiet: true })}>×{w}</button>)}
          </div>
        </div>
        <div className="glass hud-box" style={{ textAlign: 'center' }}>
          <div className="tiny muted">OPERATION MODE</div>
          <div className="tabs" style={{ margin: '4px 0 0' }}>
            <button className={s.mode === 'manual' ? 'on' : ''} disabled={!can('set_mode')} onClick={() => act({ type: 'set_mode', mode: 'manual' })} data-testid="mode-manual">🎛 Manual</button>
            <button className={s.mode === 'ai' ? 'on' : ''} disabled={!can('set_mode')} onClick={() => act({ type: 'set_mode', mode: 'ai' })} data-testid="mode-ai">🧠 AI-Assisted</button>
          </div>
          {s.decisions.some((d) => d.status === 'pending') && <div className="tiny warn" style={{ marginTop: 4 }}>{s.decisions.filter((d) => d.status === 'pending').length} approval(s) pending</div>}
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
          <div className="row">
            <button className="btn sm" onClick={() => setMobile(mobile === 'l' ? null : 'l')} style={{ display: window.innerWidth < 600 ? 'inline-flex' : 'none' }}>Objectives</button>
            <button className="btn sm" onClick={() => setMobile(mobile === 'r' ? null : 'r')} style={{ display: window.innerWidth < 600 ? 'inline-flex' : 'none' }}>Inspector</button>
            <button className={`btn sm ${showCatalog ? 'active' : ''}`} onClick={() => setG({ showCatalog: !showCatalog })} title={`${SNAPSHOT_SOURCE.name}, epoch ${SNAPSHOT_SOURCE.epoch}`}>External catalog</button>
            <button className="btn sm" onClick={() => setMenu(true)} aria-label="mission menu">☰ Menu</button>
          </div>
          <FleetSummary e={e} />
          {squadBar}
        </div>
      </div>
      <div className={`side-left ${mobile === 'l' ? 'mobile-open' : ''}`}>
        <Objectives e={e} can={can} />
        <AIPanel e={e} canDecide={canDecide} />
        {panels.log ? (
          <Panel title="Event log" onClose={() => toggle('log')}>
            <div className="panel-body scroll log" style={{ maxHeight: 180 }} data-testid="event-log">
              {[...s.log].reverse().slice(0, 60).map((l, i) => <div key={i} className={sevClass[l.sev]}>[{fmtTime(l.t)}] {l.msg}</div>)}
            </div>
          </Panel>
        ) : <button className="btn sm" onClick={() => toggle('log')}>Show event log</button>}
      </div>
      <div className={`side-right ${mobile === 'r' ? 'mobile-open' : ''}`} style={{ top: squadBar ? 330 : 300 }}>
        <Inspector e={e} sat={sat} can={can} />
      </div>
      <ConjunctionAlert e={e} can={can} />
      {showCatalog && <div className="glass hud-box tiny" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 84, zIndex: 7, maxWidth: 'calc(100vw - 20px)' }}><span className="ext-tag">EXTERNAL</span> White markers: {SNAPSHOT_SOURCE.name}, epoch {SNAPSHOT_SOURCE.epoch}, propagated with SGP4 from epoch + mission time. Static snapshot — not live tracking. <LiveTleButton /></div>}
      <div className="glass fleet-strip" data-testid="fleet-strip">
        {s.sats.map((x, i) => (
          <button key={x.id} className={`chip ${sel === x.id ? 'sel' : ''} ${!x.alive ? 'lost' : ''}`} onClick={() => { setSel(x.id); act({ type: 'inspect', sat: x.id }, { quiet: true }); }} style={{ borderLeft: `3px solid ${x.color}` }}>
            <div><b>{i < 9 ? `${i + 1}·` : ''}{x.name}</b></div>
            <div className="tiny muted">{!x.deployed ? 'stowed' : !x.alive ? 'LOST' : `${(x.battery / x.batteryCap * 100).toFixed(0)}% ⚡ ${x.comms === 'lost' ? '📵' : x.inContact ? '📡' : ''}${x.sensor === 'fault' || x.prop === 'fault' || x.payload === 'fault' ? ' ⚠' : ''}`}</div>
          </button>
        ))}
      </div>
      {menu && (
        <div className="modal-back" onClick={() => setMenu(false)}>
          <div className="glass card" onClick={(ev) => ev.stopPropagation()}>
            <h2>Mission menu</h2>
            <div className="small muted" style={{ margin: '6px 0 12px' }}>Keys: 1–9 select · Tab cycle · M mode · Space pause · +/− warp · F follow · Esc menu</div>
            <div className="col">
              <button className="btn" onClick={() => setMenu(false)}>Resume</button>
              {!runtime.squadClient && <button className="btn" onClick={() => setConfirm('restart')} data-testid="restart">Restart mission (replays launch, keeps progress)</button>}
              {(!runtime.squadClient || can('abort')) && <button className="btn danger" onClick={() => setConfirm('abort')}>Abort mission (counts as failed attempt)</button>}
              {!runtime.squadClient && m.mode === 'solo' && <button className="btn ghost" onClick={async () => { await saveLive(true); setMenu(false); useGame.getState().toast('Mission state saved — you can resume from Mission Control.', 'good'); }}>Save checkpoint</button>}
            </div>
          </div>
        </div>
      )}
      {confirm === 'restart' && <Confirm title="Restart mission?" body="Resets this mission's temporary state (satellites, resources, events) and replays the launch. Completed and unlocked missions and permanent progress are preserved. This does not use an attempt." onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); setMenu(false); restartMission(); }} confirmText="Restart" />}
      {confirm === 'abort' && <Confirm danger title="Abort mission?" body="The mission ends immediately and counts as a failed attempt." onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); setMenu(false); if (runtime.squadClient) act({ type: 'abort' }); else abortMission(); }} confirmText="Abort" />}
    </>
  );
}

function LiveTleButton() {
  const setG = useGame((s) => s.set);
  const [st, setSt] = useState('');
  return <button className="btn xs" style={{ marginLeft: 6 }} onClick={async () => { setSt('fetching…'); const r = await fetchLiveTles(); if (r.records.length) { setG({ liveTles: r.records }); setSt(`${r.records.length} live records (yellow) fetched ${new Date().toLocaleTimeString()}`); } else setSt(`Live fetch unavailable here (${r.error || 'blocked'}) — showing snapshot only.`); }}>Try live TLE fetch{st ? ` · ${st}` : ''}</button>;
}
