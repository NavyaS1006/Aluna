import { useEffect, useRef, useState } from 'react';
import { useGame } from '../state/store.js';
import { input } from '../three/input.js';
import { MissionControl, SatOps, DesignLab, AIOps, Training, SquadRoom } from './Facilities.jsx';
import { Avatar } from './common.jsx';
import { levelFor } from '../services/progress.js';
import { detachSquad } from '../game/squad.js';

const ARRIVAL_TEXT = { outside: 'Approaching ALUNA Headquarters…', doors: 'Proximity sensors detected — doors opening', inside: 'Proceeding to Mission Control…' };

function TouchControls() {
  const pad = useRef(); const knob = useRef();
  const [show] = useState(() => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
  useEffect(() => {
    if (!show || !pad.current) return undefined;
    const el = pad.current; let id = null;
    const setFrom = (t) => { const r = el.getBoundingClientRect(); const x = (t.clientX - r.left - r.width / 2) / (r.width / 2); const y = (t.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.min(1, Math.hypot(x, y)); const a = Math.atan2(y, x); input.touch.x = Math.cos(a) * l; input.touch.y = Math.sin(a) * l; knob.current.style.transform = `translate(${input.touch.x * 36}px, ${input.touch.y * 36}px)`; };
    const start = (e) => { const t = e.changedTouches[0]; id = t.identifier; input.touch.active = true; setFrom(t); e.preventDefault(); };
    const move = (e) => { for (const t of e.changedTouches) if (t.identifier === id) setFrom(t); e.preventDefault(); };
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; input.touch.active = false; input.touch.x = input.touch.y = 0; knob.current.style.transform = ''; } };
    el.addEventListener('touchstart', start, { passive: false }); el.addEventListener('touchmove', move, { passive: false }); el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); };
  }, [show]);
  if (!show) return null;
  return (<>
    <div className="joystick" ref={pad} aria-label="movement joystick"><i ref={knob} /></div>
    <div className="touch-btns"><button className="btn primary" onClick={() => { input.interact = true; }} aria-label="interact">E</button></div>
  </>);
}

export default function HQOverlay() {
  const facility = useGame((s) => s.facility);
  const near = useGame((s) => s.nearFacility);
  const arrival = useGame((s) => s.arrivalPhase);
  const hqArrived = useGame((s) => s.hqArrived);
  const profile = useGame((s) => s.profile);
  const progress = useGame((s) => s.progress);
  const mode = useGame((s) => s.mode);
  const squad = useGame((s) => s.squad);
  const online = useGame((s) => s.online);
  const friends = useGame((s) => s.friends);
  const myRoleLabel = useGame((s) => s.myRoleLabel);
  const setG = useGame((s) => s.set); const go = useGame((s) => s.go);
  const onlineFriends = friends.friends.filter((u) => online.has(u)).length;
  const F = { mission: MissionControl, satops: SatOps, design: DesignLab, ai: AIOps, training: Training, squad: SquadRoom }[facility];
  return (
    <>
      <div className="topbar">
        <div className="glass hud-box row">
          <Avatar look={profile?.look} size={36} />
          <div><div style={{ fontWeight: 700 }}>{profile?.displayName}</div><div className="tiny muted">Level {levelFor(progress?.xp)} · {mode === 'solo' ? 'Solo Campaign' : 'Squad Ops'}{myRoleLabel && mode === 'squad' ? ` · ${myRoleLabel}` : ''}</div></div>
        </div>
        <div className="row">
          {mode === 'squad' && <div className="glass hud-box tiny">{squad ? <>👥 {squad.name} · {squad.members.length}/4 · <span className="good">{squad.members.filter((m) => online.has(m.uid)).length} online</span></> : 'No squad — visit the Squad Coordination Room'}</div>}
          <div className="glass hud-box tiny">Friends online: {onlineFriends}</div>
          <button className="btn sm" onClick={() => setG({ modal: 'profile' })}>Profile</button>
          <button className="btn sm" onClick={() => { setG({ facility: null }); if (mode === 'squad') detachSquad(); go('modeSelect'); }} data-testid="change-mode">Change mode</button>
        </div>
      </div>
      {!hqArrived && arrival && (
        <>
          <div className="intro-text fade-in" key={arrival} style={{ bottom: '14%' }}>{ARRIVAL_TEXT[arrival] || ''}</div>
          <button className="btn skip" onClick={() => setG({ skipArrival: true, hqArrived: true, arrivalPhase: 'done' })} data-testid="skip-arrival">Skip arrival ⏭</button>
        </>
      )}
      {hqArrived && !facility && near && (
        <div className="glass prompt fade-in" data-testid="facility-prompt" style={{ borderColor: near.color }}>
          <div className="display" style={{ color: near.color, fontSize: 14 }}>{near.icon} {near.name}</div>
          <div className="small muted">{near.desc}</div>
          <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => setG({ facility: near.id })}>Press <span className="kbd">E</span> to enter</button>
        </div>
      )}
      {hqArrived && !facility && !near && <div className="glass hud-box tiny" style={{ position: 'fixed', left: 10, bottom: 10, zIndex: 6 }}>WASD move · Shift sprint · drag to look · E interact · Walk to a glowing ring to use a facility</div>}
      {hqArrived && !facility && (
        <div className="glass hud-box" style={{ position: 'fixed', right: 10, bottom: 10, zIndex: 6, maxWidth: 220 }}>
          <div className="tiny muted" style={{ marginBottom: 4 }}>Quick access</div>
          <div className="col" style={{ gap: 4 }}>
            {[['mission', '🛰 Mission Control'], ['satops', '📡 Satellite Ops'], ['design', '🛠 Design Lab'], ['ai', '🧠 AI Ops'], ['training', '🎓 Training'], ['squad', '👥 Squad Room']].map(([k, l]) => <button key={k} className="btn xs" style={{ justifyContent: 'flex-start' }} onClick={() => setG({ facility: k })} data-testid={`quick-${k}`}>{l}</button>)}
          </div>
        </div>
      )}
      {F && <F />}
      {!facility && <TouchControls />}
    </>
  );
}
