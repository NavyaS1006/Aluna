// Mission briefing, Spacecraft Mission Designer (+ autonomy configuration) and launch overlay.
import { useMemo, useState } from 'react';
import { useGame, runtime } from '../state/store.js';
import { BUSES, PAYLOADS, PANELS, PROPULSION, COMMS, SENSORS, LAUNCHERS, validateDesign } from '../sim/design.js';
import { isLocked } from '../sim/missionDesign.js';
import { openDesigner, launchSolo, backToHQ } from '../game/flow.js';
import { EVENT_INFO } from '../data/missions.js';
import { AGENTS } from '../sim/agents.js';
import { ROLE_LABELS } from '../sim/engine.js';
import { fmtTime } from './common.jsx';
import { missionStatus } from '../services/progress.js';

const OBJ_HELP = {
  deploy: 'Separate satellites from the upper stage', alt_target: 'Circular orbit at target altitude', alt_hold: 'Maintain altitude band', inc_target: 'Change orbital plane',
  battery_floor: 'Constraint: battery minimum', no_collision: 'Constraint: no collisions', eclipses: 'Survive eclipse passes', contact: 'Ground station contacts', downlink: 'Data downlinked', collect: 'Payload data collected',
  resolve: 'Resolve anomalies', avoid: 'Clear high-risk conjunctions', survive_time: 'Keep operating', min_alive: 'Constraint: fleet survival', formation: 'String-of-pearls spacing', fuel_reserve: 'Constraint: propellant reserve',
  review: 'Review agent decisions', network: 'Network connectivity', payload_time: 'Payload operating time', inspect: 'Inspect satellites', authorize: 'Commander authorization', ai_time: 'Time in AI-Assisted mode', storm_safe: 'Protect fleet from storm', raise: 'Raise orbit',
};

export function Briefing({ squad }) {
  const m = useGame((s) => s.mission);
  const progress = useGame((s) => s.progress);
  const evTypes = [...new Set([...(m.events || []).map((e) => e.type), ...(m.randomEvents?.pool || [])])];
  const st = m.mode === 'solo' ? missionStatus(progress?.solo, m) : null;
  return (
    <div className="center-screen" style={{ zIndex: 6 }}>
      <div className="glass wide fade-in" style={{ maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-head"><span>Mission briefing · {m.mode === 'training' ? 'Training' : m.mode === 'solo' ? `Solo ${m.number}/25` : `Squad Ops ${m.number}/25`}</span><span className="pill">{m.tier} · Difficulty {m.difficulty}/10</span></div>
        <div className="panel-body scroll">
          <h1 className="display" style={{ fontSize: 26 }}>{m.title}</h1>
          <p style={{ lineHeight: 1.6 }}>{m.story}</p>
          <div className="split">
            <div>
              <div className="section-title">Objectives</div>
              {m.objectives.map((o) => (
                <div key={o.id} className="obj"><span className="box" />
                  <div><div>{o.label} {o.required === false && <span className="pill">bonus</span>} {o.role && <span className="pill">{ROLE_LABELS[o.role]}</span>}</div><div className="tiny muted">{OBJ_HELP[o.type]}</div></div></div>
              ))}
              <div className="section-title">Failure conditions</div>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Mission clock exceeds {fmtTime(m.timeLimit)} (simulated time)</li>
                <li>Any constraint objective is violated</li>
                <li>All satellites lost</li>
              </ul>
            </div>
            <div>
              <div className="section-title">Mission parameters</div>
              <div className="kv"><span>Time limit</span><b>{fmtTime(m.timeLimit)} sim</b><span>Default warp</span><b>×{m.timeScale}</b>
                {m.req?.minSats && <><span>Min satellites</span><b>{m.req.minSats}</b></>}
                {m.req?.payload && <><span>Required payload</span><b>{PAYLOADS[m.req.payload].label}</b></>}
                {m.req?.propulsion && <><span>Propulsion</span><b>required{m.req.minDv ? ` (≥${m.req.minDv} m/s)` : ''}</b></>}
                {m.req?.sensors && <><span>Sensors</span><b>{m.req.sensors.map((s) => SENSORS[s].label).join(', ')}</b></>}
                {m.req?.comms && <><span>Comms</span><b>{m.req.comms.map((c) => COMMS[c].label).join(' / ')}</b></>}
                <span>Rewards</span><b>{m.rewards.xp} XP{m.rewards.badge ? ` · ${m.rewards.badge}` : ''}</b>
                {st && <><span>Attempts left</span><b>{st.attemptsLeft}/3</b></>}
              </div>
              <div className="section-title">Intelligence — expected events</div>
              <div className="row wrap">{evTypes.length ? evTypes.map((t) => <span key={t} className="pill warn">{EVENT_INFO[t]}</span>) : <span className="small muted">No anomalies forecast.</span>}</div>
              {m.randomEvents && <div className="tiny muted" style={{ marginTop: 6 }}>Plus {m.randomEvents.count} unscheduled anomalies (seeded per attempt).</div>}
              {m.phased && <div className="notice" style={{ marginTop: 10 }}>Constellation phasing uses a phasing dispenser (time-compressed drift) so each satellite starts in its own slot.</div>}
              {m.tips?.length > 0 && <><div className="section-title">Flight director tips</div><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{m.tips.map((t) => <li key={t}>{t}</li>)}</ul></>}
            </div>
          </div>
        </div>
        <div className="row" style={{ padding: 12, borderTop: '1px solid var(--line)', justifyContent: 'space-between' }}>
          <button className="btn ghost" onClick={squad ? squad.onBack : backToHQ}>← Headquarters</button>
          {squad ? squad.controls : <button className="btn primary" onClick={openDesigner} data-testid="to-designer">Configure spacecraft →</button>}
        </div>
      </div>
    </div>
  );
}

function Opt({ on, onClick, disabled, children, title }) { return <button className={`opt ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>; }

export function Designer({ squad, readOnly }) {
  const m = useGame((s) => s.mission);
  const design = useGame((s) => s.design);
  const autonomy = useGame((s) => s.autonomy) || { startMode: 'manual' };
  const setG = useGame((s) => s.set);
  const [step, setStep] = useState('craft');
  const [busy, setBusy] = useState(false);
  const v = useMemo(() => validateDesign(design, m.req), [design, m.req]);
  const b = v.b;
  const set = (patch) => { if (readOnly) return; const d = { ...design, ...patch }; setG({ design: d }); squad?.onDesign?.(d); };
  const L = (k) => isLocked(m, k) || readOnly;
  const bus = BUSES[design.bus];
  const launch = async () => { setBusy(true); try { if (squad) await squad.onLaunch(design, autonomy.startMode); else await launchSolo(design, autonomy.startMode); } finally { setBusy(false); } };
  return (
    <>
      <div className="topbar"><div className="glass hud-box"><div className="hud-title">SPACECRAFT MISSION DESIGNER</div><div className="tiny muted">{m.title}{readOnly ? ' · view only (leader designs)' : ''}</div></div>
        <div className="glass hud-box row"><div className="tabs" style={{ margin: 0 }}><button className={step === 'craft' ? 'on' : ''} onClick={() => setStep('craft')}>1 · Spacecraft</button><button className={step === 'orbit' ? 'on' : ''} onClick={() => setStep('orbit')}>2 · Orbit & resources</button><button className={step === 'auto' ? 'on' : ''} onClick={() => setStep('auto')} data-testid="tab-autonomy">3 · Autonomy</button></div></div></div>
      <div className="glass designer-left">
        <div className="panel-body scroll" style={{ flex: 1 }}>
          {step === 'craft' && (<>
            <div className="field"><label>Spacecraft name</label><input value={design.name} onChange={(e) => set({ name: e.target.value.slice(0, 28) })} disabled={readOnly} /></div>
            <div className="section-title">Spacecraft type (bus)</div>
            <div className="opt-grid">{Object.entries(BUSES).map(([k, x]) => <Opt key={k} on={design.bus === k} disabled={L('bus')} onClick={() => set({ bus: k, panelArea: Math.min(design.panelArea, x.maxPanel), batteryWh: Math.min(design.batteryWh, x.maxBattery), fuelKg: Math.min(design.fuelKg, x.maxFuel) })} title={x.desc}><b>{x.label}</b><div className="tiny muted">{x.dryMass} kg · {x.busPower} W bus</div></Opt>)}</div>
            <div className="section-title">Payload</div>
            <div className="opt-grid">{Object.entries(PAYLOADS).map(([k, x]) => <Opt key={k} on={design.payload === k} disabled={L('payload')} onClick={() => set({ payload: k })}><b>{x.label}</b><div className="tiny muted">{x.mass} kg · {x.power} W · {x.rate} MB/s</div></Opt>)}</div>
            <div className="section-title">Solar panels</div>
            <div className="opt-grid">{Object.entries(PANELS).map(([k, x]) => <Opt key={k} on={design.panelType === k} disabled={L('panelType')} onClick={() => set({ panelType: k })}><b>{x.label}</b><div className="tiny muted">η×{x.eff}</div></Opt>)}</div>
            <label style={{ marginTop: 8 }}>Array area: {design.panelArea.toFixed(1)} m² (max {bus.maxPanel})</label>
            <input type="range" min="0.2" max={bus.maxPanel} step="0.1" value={design.panelArea} onChange={(e) => set({ panelArea: +e.target.value })} disabled={L('panelArea')} aria-label="array area" />
            <label>Battery capacity: {design.batteryWh} Wh (max {bus.maxBattery})</label>
            <input type="range" min="50" max={bus.maxBattery} step="10" value={design.batteryWh} onChange={(e) => set({ batteryWh: +e.target.value })} disabled={L('batteryWh')} aria-label="battery" />
            <div className="section-title">Propulsion</div>
            <div className="opt-grid">{Object.entries(PROPULSION).map(([k, x]) => <Opt key={k} on={design.propulsion === k} disabled={L('propulsion')} onClick={() => set({ propulsion: k })}><b>{x.label}</b><div className="tiny muted">Isp {x.isp}s · ≤{x.maxDv} m/s/burn</div></Opt>)}</div>
            {design.propulsion !== 'none' && <><label style={{ marginTop: 8 }}>Propellant: {design.fuelKg} kg (tank {bus.maxFuel})</label><input type="range" min="0.5" max={bus.maxFuel} step="0.5" value={design.fuelKg} onChange={(e) => set({ fuelKg: +e.target.value })} disabled={L('fuelKg')} aria-label="propellant" /></>}
            <div className="section-title">Communications</div>
            <div className="opt-grid">{Object.entries(COMMS).map(([k, x]) => <Opt key={k} on={design.comms === k} disabled={L('comms')} onClick={() => set({ comms: k })}><b>{x.label}</b><div className="tiny muted">{x.rate} MB/s · {x.power} W</div></Opt>)}</div>
            <div className="section-title">Sensors</div>
            <div className="opt-grid">{Object.entries(SENSORS).map(([k, x]) => <Opt key={k} on={design.sensors.includes(k)} disabled={readOnly} onClick={() => set({ sensors: design.sensors.includes(k) ? design.sensors.filter((s) => s !== k) : [...design.sensors, k] })} title={x.effect}><b>{x.label}</b><div className="tiny muted">{x.effect}</div></Opt>)}</div>
          </>)}
          {step === 'orbit' && (<>
            <div className="section-title">Mission objective</div><div className="small">{m.objectives.map((o) => o.label).join(' · ')}</div>
            <div className="section-title">Satellite count</div>
            <input type="range" min={m.req?.minSats || 1} max={m.req?.maxSats || 16} step="1" value={design.satCount} onChange={(e) => set({ satCount: +e.target.value })} disabled={L('satCount')} aria-label="satellite count" />
            <div className="small">{design.satCount} spacecraft</div>
            <div className="section-title">Orbital parameters</div>
            <label>Altitude: {design.altKm} km</label><input type="range" min="300" max="2000" step="10" value={design.altKm} onChange={(e) => set({ altKm: +e.target.value })} disabled={L('altKm')} aria-label="altitude" />
            <label>Inclination: {design.incDeg.toFixed(1)}°</label><input type="range" min="0" max="98" step="0.1" value={design.incDeg} onChange={(e) => set({ incDeg: +e.target.value })} disabled={L('incDeg')} aria-label="inclination" />
            <label>Design life: {design.durationDays} days</label><input type="range" min="7" max="1825" step="1" value={design.durationDays} onChange={(e) => set({ durationDays: +e.target.value })} disabled={readOnly} aria-label="duration" />
            <div className="section-title">Launch vehicle</div>
            <div className="opt-grid">{Object.entries(LAUNCHERS).map(([k, x]) => <Opt key={k} on={design.launcher === k} disabled={L('launcher')} onClick={() => set({ launcher: k })}><b>{x.label}</b><div className="tiny muted">{x.capacityLeo.toLocaleString()} kg LEO · {x.stages} stages{x.boosters ? ` + ${x.boosters} boosters` : ''}</div></Opt>)}</div>
            <div className="section-title">Resource allocation (power budget)</div>
            {['payload', 'comms', 'thermal'].map((k) => (
              <div key={k}><label>{k}: {design.alloc[k]}%</label><input type="range" min="0" max="100" step="5" value={design.alloc[k]} disabled={readOnly} aria-label={`alloc ${k}`}
                onChange={(e) => { const val = +e.target.value; const others = ['payload', 'comms', 'thermal'].filter((x) => x !== k); const rest = 100 - val; const sumO = others.reduce((s, x) => s + design.alloc[x], 0) || 1; const a = { [k]: val }; others.forEach((x, i) => { a[x] = i === 0 ? Math.round((design.alloc[x] / sumO) * rest) : 0; }); a[others[1]] = 100 - val - a[others[0]]; set({ alloc: a }); }} /></div>
            ))}
            <div className="section-title">Identity colour</div>
            <input type="color" value={design.color} onChange={(e) => set({ color: e.target.value })} disabled={readOnly} aria-label="colour" style={{ height: 36 }} />
          </>)}
          {step === 'auto' && (<>
            <div className="section-title">Starting operation mode</div>
            <div className="opt-grid">
              <Opt on={autonomy.startMode === 'manual'} onClick={() => setG({ autonomy: { ...autonomy, startMode: 'manual' } })} disabled={readOnly}><b>Manual</b><div className="tiny muted">You make every operational decision. No agent actions or recommendations. Physics & safety rules still apply.</div></Opt>
              <Opt on={autonomy.startMode === 'ai'} onClick={() => setG({ autonomy: { ...autonomy, startMode: 'ai' } })} disabled={readOnly}><b>AI-Assisted</b><div className="tiny muted">Agents run routine low-risk actions; medium/high-risk actions wait for your approval.</div></Opt>
            </div>
            <p className="small muted">You can switch modes at any time during the mission without losing state{m.mode === 'squad' ? ' (Commander only, synchronized to the squad)' : ''}.</p>
            <div className="section-title">Autonomous agents</div>
            {Object.entries(AGENTS).map(([k, a]) => <div key={k} className="row small" style={{ padding: '4px 0' }}><span style={{ width: 22 }}>{a.icon}</span><div className="grow"><b>{a.name}</b><div className="tiny muted">{a.desc}</div></div></div>)}
            <div className="notice" style={{ marginTop: 10 }}>Safety policy: manoeuvres come only from deterministic planners and pass the safety validator (perigee floor, propellant, per-burn limit, conjunction re-screen). Generative AI may explain decisions but never authors manoeuvres.</div>
          </>)}
        </div>
      </div>
      <div className="glass designer-right">
        <div className="panel-head"><span>Budgets & validation</span><span className={`pill ${v.ok ? 'good' : 'bad'}`}>{v.ok ? 'GO' : 'NO-GO'}</span></div>
        <div className="panel-body scroll" style={{ flex: 1 }}>
          <div className="kv">
            <span>Dry / wet mass</span><b>{b.dryMass.toFixed(0)} / {b.wetMass.toFixed(0)} kg</b>
            <span>Total launch mass</span><b className={b.totalMass > b.capacity ? 'bad' : ''}>{b.totalMass.toFixed(0)} / {b.capacity.toFixed(0)} kg</b>
            <span>Sunlit generation</span><b>{b.genSunlit.toFixed(0)} W</b>
            <span>Orbit-avg gen / load</span><b className={b.powerMargin < 0 ? 'bad' : ''}>{b.avgGen.toFixed(0)} / {b.avgLoad.toFixed(0)} W</b>
            <span>Eclipse energy need</span><b className={b.batteryMargin < 0 ? 'bad' : ''}>{b.eclipseEnergy.toFixed(0)} Wh</b>
            <span>Δv capability</span><b>{b.totalDv.toFixed(0)} m/s</b>
            <span>Station-keeping need</span><b>{b.stationKeepDv.toFixed(1)} m/s</b>
            <span>Orbital period</span><b>{b.periodMin.toFixed(1)} min</b>
            <span>Orbital velocity</span><b>{b.velocity.toFixed(2)} km/s</b>
            <span>Payload data rate</span><b>{b.dataRate} MB/s</b>
            <span>Downlink rate</span><b>{b.commsRate} MB/s</b>
          </div>
          <div className="divider" />
          {v.errors.map((e) => <div key={e} className="err" style={{ fontSize: 12.5 }}>✕ {e}</div>)}
          {v.warnings.map((e) => <div key={e} className="warn small">⚠ {e}</div>)}
          {v.ok && !v.warnings.length && <div className="good small">✓ Design satisfies physics rules and mission requirements.</div>}
        </div>
        <div className="row" style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
          <button className="btn ghost" onClick={squad ? squad.onBack : m.mode === 'sandbox' ? backToHQ : () => useGame.getState().go('briefing')}>{m.mode === 'sandbox' ? '← HQ' : '← Briefing'}</button>
          {m.mode === 'sandbox' && <SandboxControls design={design} ok={v.ok} />}
          {m.mode !== 'sandbox' && (!squad || squad.canLaunch) && <button className="btn amber grow" disabled={!v.ok || busy || (squad && !squad.allReady)} onClick={launch} data-testid="launch-btn">{busy ? 'Preparing…' : squad && !squad.allReady ? 'Waiting for squad ready' : '🚀 LAUNCH'}</button>}
          {squad && !squad.canLaunch && squad.readyControl}
        </div>
      </div>
    </>
  );
}

const PHASE_TEXT = { countdown: 'T-minus', ignition: 'IGNITION', liftoff: 'LIFTOFF', maxq: 'MAX-Q', boosters: 'BOOSTER SEPARATION', staging: 'STAGE SEPARATION · 2ND STAGE IGNITION', fairing: 'FAIRING JETTISON — PAYLOAD EXPOSED', insertion: 'ORBITAL INSERTION' };
export function LaunchOverlay({ phase, count }) {
  const m = useGame((s) => s.mission);
  const design = useGame((s) => s.design);
  const setG = useGame((s) => s.set);
  return (
    <>
      <div className="launch-hud">
        {phase === 'countdown' ? <div className="countdown">{count}</div> : <div className="display" style={{ fontSize: 'clamp(16px,3vw,28px)', textShadow: '0 0 20px #000' }}>{PHASE_TEXT[phase] || ''}</div>}
        <div className="small" style={{ textShadow: '0 1px 8px #000' }}>{m?.title} · {LAUNCHERS[design.launcher].label} · {design.satCount}× {design.name}</div>
      </div>
      <div className="telemetry glass hud-box">
        <div>VEHICLE {LAUNCHERS[design.launcher].label}</div>
        <div>PAYLOAD {design.satCount} × {BUSES[design.bus].label}</div>
        <div>TARGET {design.altKm} km · {design.incDeg.toFixed(1)}°</div>
        <div>PHASE {phase?.toUpperCase()}</div>
      </div>
      <button className="btn skip" onClick={() => setG({ launchSkip: true })} data-testid="skip-launch">Skip to orbit ⏭</button>
      {runtime.engine && null}
    </>
  );
}

function SandboxControls({ design, ok }) {
  const toast = useGame((s) => s.toast);
  const setG = useGame((s) => s.set);
  const [report, setReport] = useState(null);
  const test = async () => {
    const { MissionEngine } = await import('../sim/engine.js');
    const T = 3 * 3600;
    const mission = { id: 'LABTEST', mode: 'sandbox', title: 'Power test', timeLimit: T, raanDeg: 40, ambientDebris: 0, objectives: [{ id: 's', type: 'survive_time', secs: T - 60, label: 'test' }], events: [] };
    const e = new MissionEngine(mission, design, { seed: 'lab' });
    while (!e.s.ended) e.step(10);
    const x = e.s.sats[0];
    setReport({ minBatt: x.minBattPct, eclipses: e.s.stats.eclipses, data: e.s.stats.collected, down: e.s.stats.downlink, alive: x.alive, contacts: Object.keys(e.s.contacted).length });
  };
  const save = async () => {
    const { getPlatform } = await import('../services/platform.js');
    const p = await getPlatform(); const ref = p.db.doc(`data/users/${p.uid}/profile`); const prof = (await ref.get()).data();
    const templates = [design, ...(prof.templates || []).filter((t) => t.name !== design.name)].slice(0, 12);
    await ref.update({ templates }); setG({ profile: { ...prof, templates } }); toast(`Template "${design.name}" saved.`, 'good');
  };
  return (
    <div className="col grow">
      <div className="row"><button className="btn grow" onClick={test} disabled={!ok}>Run 3-h orbital power test</button><button className="btn primary grow" onClick={save} disabled={!ok}>Save template</button></div>
      {report && <div className="tiny">Test (1 satellite, 3 h): min battery <b className={report.minBatt < 20 ? 'bad' : 'good'}>{report.minBatt.toFixed(0)}%</b> · eclipses {report.eclipses.toFixed(0)} · data {report.data.toFixed(0)} MB · downlinked {report.down.toFixed(0)} MB · {report.contacts} stations · {report.alive ? 'survived' : 'LOST'}</div>}
    </div>
  );
}
