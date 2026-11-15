import { useGame } from '../state/store.js';
import { fmtTime } from './common.jsx';
import { ACHIEVEMENTS, missionStatus, MAX_ATTEMPTS } from '../services/progress.js';
import { backToHQ, openBriefing, openDesigner } from '../game/flow.js';
import { SOLO_MISSIONS } from '../data/missions.js';

export default function Results({ squad }) {
  const r = useGame((s) => s.result);
  const m = useGame((s) => s.mission);
  const progress = useGame((s) => s.progress);
  if (!r) return null;
  const sc = r.sc;
  const st = m.mode === 'solo' ? missionStatus(progress?.solo, m) : null;
  const next = m.mode === 'solo' ? SOLO_MISSIONS[m.number] : null;
  const newAch = (r.rec?.newAch || r.newAch || []).map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
  return (
    <div className="center-screen" style={{ zIndex: 12 }}>
      <div className="glass wide fade-in" style={{ maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column' }} data-testid="results">
        <div className="panel-head"><span>Mission debrief · {m.title}</span><span className={`pill ${r.success ? 'good' : 'bad'}`}>{r.success ? 'SUCCESS' : 'FAILED'}</span></div>
        <div className="panel-body scroll">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <h1 className="display" style={{ fontSize: 30, color: r.success ? 'var(--good)' : 'var(--bad)' }}>{r.success ? 'MISSION COMPLETE' : 'MISSION FAILED'}</h1>
              <div className="small muted">{r.reason}</div>
            </div>
            <div style={{ textAlign: 'right' }}><div className="stars">{'★'.repeat(sc.stars)}<span style={{ opacity: 0.2 }}>{'★'.repeat(3 - sc.stars)}</span></div><div className="display" style={{ fontSize: 28 }}>{sc.total}</div><div className="tiny muted">final score</div></div>
          </div>
          <div className="results-grid" style={{ marginTop: 14 }}>
            <div>
              <div className="section-title">Score breakdown (transparent rules)</div>
              {sc.lines.map((l) => <div key={l.label} className="score-line"><span>{l.label}</span><b>{l.mult ? `×${l.mult}` : `${l.pts >= 0 ? '+' : ''}${l.pts}`}</b></div>)}
              <div className="score-line"><span><b>Total</b></span><b>{sc.total}</b></div>
            </div>
            <div>
              <div className="section-title">Objectives</div>
              {sc.completed.map((o) => <div key={o} className="small good">✓ {o}</div>)}
              {sc.missed.map((o) => <div key={o} className="small bad">✕ {o}</div>)}
              <div className="section-title">Operations</div>
              <div className="kv">
                <span>Satellites surviving</span><b>{sc.alive}</b>
                <span>Simulated time</span><b>{fmtTime(sc.simTime)}</b>
                <span>Real time</span><b>{fmtTime(sc.realTime)}</b>
                <span>Burns / Δv used</span><b>{r.stats.burns} / {r.stats.dvUsed.toFixed(1)} m/s</b>
                <span>Conjunctions cleared</span><b>{r.stats.avoided} ({r.stats.nearMiss} near-miss, {r.stats.collisions} collision)</b>
                <span>Decisions approved / modified / rejected</span><b>{r.stats.approved} / {r.stats.modified} / {r.stats.rejected}</b>
                <span>Autonomous actions</span><b>{r.stats.auto} (reviewed {r.stats.acked || 0})</b>
                <span>Time in AI-Assisted</span><b>{fmtTime(r.stats.aiTime)}</b>
                <span>Mode switches</span><b>{r.stats.modeSwitches}</b>
                <span>Events resolved</span><b>{r.stats.resolved}</b>
              </div>
              <div className="section-title">Rewards</div>
              {m.mode === 'training' ? <div className="small muted">Training drills do not award XP or affect attempts.</div> : (
                <div className="small">
                  {r.rec?.gainedXp != null && <div>+{r.rec.gainedXp} XP</div>}
                  {r.success && m.rewards.badge && <div>🏅 Badge: {m.rewards.badge}</div>}
                  {newAch.map((a) => <div key={a.id}>{a.icon} Achievement unlocked: <b>{a.name}</b></div>)}
                  {m.mode === 'solo' && next && <div style={{ marginTop: 6 }}>Next mission <b>{next.title}</b>: {r.rec?.nextUnlocked ? <span className="good">UNLOCKED</span> : <span className="muted">locked</span>}</div>}
                  {m.mode === 'solo' && !r.success && st && (st.cooldown ? <div className="bad">{MAX_ATTEMPTS} failed attempts — mission cooling down for 1 hour.</div> : <div className="warn">Attempts remaining: {st.attemptsLeft}/{MAX_ATTEMPTS}</div>)}
                  {squad?.extra}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="row wrap" style={{ padding: 12, borderTop: '1px solid var(--line)', justifyContent: 'flex-end' }}>
          {squad ? squad.controls : (<>
            <button className="btn ghost" onClick={backToHQ} data-testid="return-hq">Return to headquarters</button>
            {!r.success && m.mode === 'solo' && !st?.cooldown && <button className="btn" onClick={openDesigner} data-testid="new-attempt">New attempt</button>}
            {m.mode === 'training' && <button className="btn" onClick={openDesigner}>Run drill again</button>}
            {r.success && next && r.rec?.nextUnlocked && <button className="btn primary" onClick={() => openBriefing(next)} data-testid="next-mission">Next mission →</button>}
          </>)}
        </div>
      </div>
    </div>
  );
}
