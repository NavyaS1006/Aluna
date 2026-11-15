import { Suspense, lazy, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import { useGame, runtime } from './state/store.js';
import { Boot, Intro, Title, Auth, Setup, ModeSelect } from './ui/screens.jsx';
import { TitleScene, DesignerScene } from './scenes/MenuScenes.jsx';
import { Briefing, Designer, LaunchOverlay } from './ui/MissionScreens.jsx';
import SpaceHUD, { EngineLoop } from './ui/SpaceHUD.jsx';
import Results from './ui/Results.jsx';
import HQOverlay from './ui/HQOverlay.jsx';
import { ProfileModal } from './ui/Facilities.jsx';
import { Toasts, ErrorBoundary } from './ui/common.jsx';
import { backToHQ } from './game/flow.js';
import { watchOutboxes, watchOnline, watchInvites, setReady } from './services/social.js';
import { resumeMembership, leaderToDesign, leaderLaunch, leaderBackToIdle, leaderDesignChanged, allReady, leaveSquadMission } from './game/squad.js';
import { ROLE_PERMS, ROLE_LABELS } from './sim/engine.js';

const HQScene = lazy(() => import('./scenes/HQScene.jsx'));
const SpaceScene = lazy(() => import('./scenes/SpaceScene.jsx'));
const LaunchScene = lazy(() => import('./scenes/LaunchScene.jsx'));

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}

function Scene({ onLaunchPhase }) {
  const screen = useGame((s) => s.screen);
  const design = useGame((s) => s.design);
  const squadRoom = useGame((s) => s.squadRoom);
  const mode = useGame((s) => s.mode);
  const squad = useGame((s) => s.squad);
  const plat = useGame((s) => s.platform);
  const go = useGame((s) => s.go);
  const idx = squad ? Math.max(0, squad.members.findIndex((m) => m.uid === plat?.uid)) : 0;
  if (['boot', 'intro'].includes(screen)) return <TitleScene cinematic />;
  if (['title', 'auth', 'setup', 'modeSelect', 'briefing'].includes(screen)) return <TitleScene />;
  if (screen === 'hq') return <HQScene squadRoom={mode === 'squad' ? squadRoom : null} memberIndex={idx} />;
  if (screen === 'designer' && design) return <DesignerScene design={design} />;
  if (screen === 'launch' && design) return <LaunchScene design={design} onPhase={onLaunchPhase} onDone={() => go('space')} />;
  if ((screen === 'space' || screen === 'results') && runtime.engine) return <SpaceScene />;
  return <TitleScene />;
}

function useSocial() {
  const user = useGame((s) => s.user);
  const mode = useGame((s) => s.mode);
  const screen = useGame((s) => s.screen);
  const setG = useGame((s) => s.set);
  useEffect(() => {
    if (!user) return undefined;
    let u1 = () => {}, u2 = () => {}; let alive = true;
    watchOutboxes((f) => setG({ friends: f })).then((u) => { if (alive) u1 = u; else u(); });
    watchOnline((s) => setG({ online: s })).then((u) => { if (alive) u2 = u; else u(); });
    const u3 = watchInvites((inv) => setG({ invites: inv }));
    return () => { alive = false; u1(); u2(); u3(); };
  }, [user, setG]);
  useEffect(() => { if (user && mode === 'squad' && screen === 'hq' && !useGame.getState().squad) resumeMembership().catch(() => {}); }, [user, mode, screen]);
}

function SquadWrappers({ screen }) {
  const squad = useGame((s) => s.squad);
  const plat = useGame((s) => s.platform);
  const memberships = useGame((s) => s.memberships);
  const myRoles = useGame((s) => s.myRoles) || [];
  const isLeader = squad?.leader === plat?.uid;
  const ready = memberships.find((m) => m.uid === plat?.uid)?.ready;
  const readyBtn = !isLeader ? <button className={`btn ${ready ? 'active' : ''}`} onClick={() => setReady(!ready)} data-testid="ready-brief">{ready ? '✓ Ready' : 'Mark ready'}</button> : null;
  const roster = squad && <div className="tiny muted">{squad.members.length} members · {squad.members.filter((m) => m.uid === squad.leader || memberships.find((x) => x.uid === m.uid)?.ready).length} ready · your roles: {myRoles.map((r) => ROLE_LABELS[r]).join(', ')}</div>;
  if (screen === 'briefing') return <Briefing squad={{ onBack: () => (isLeader ? leaderBackToIdle() : useGame.getState().go('hq')), controls: <div className="row">{roster}{readyBtn}{isLeader && <button className="btn primary" onClick={leaderToDesign} data-testid="squad-design">Configure spacecraft →</button>}</div> }} />;
  if (screen === 'designer') return <Designer readOnly={!isLeader} squad={{ canLaunch: isLeader, allReady: allReady(), onDesign: leaderDesignChanged, onLaunch: leaderLaunch, onBack: () => (isLeader ? leaderBackToIdle() : useGame.getState().go('hq')), readyControl: <div className="row grow">{roster}{readyBtn}</div> }} />;
  if (screen === 'results') return <Results squad={{ extra: squad && <div className="small">Team score: {squad.teamScore || 0}</div>, controls: <><button className="btn" onClick={() => { if (isLeader) leaderBackToIdle(); leaveSquadMission(); }} data-testid="squad-return">Return to headquarters</button></> }} />;
  return null;
}

export default function App() {
  const screen = useGame((s) => s.screen);
  const modal = useGame((s) => s.modal);
  const mode = useGame((s) => s.mode);
  const mission = useGame((s) => s.mission);
  const profile = useGame((s) => s.profile);
  const squadConnected = useGame((s) => s.squadConnected);
  const myRoles = useGame((s) => s.myRoles) || [];
  const [launch, setLaunch] = useState({ phase: 'countdown', count: 10 });
  const [gl] = useState(webglAvailable);
  const [lowQ] = useState(() => new URLSearchParams(location.search).get('q') === 'low');
  useSocial();
  const isSquadMission = mission?.mode === 'squad';
  if (!gl) {
    return (
      <div className="glass fallback">
        <h1 className="display">ALUNA</h1>
        <p>ALUNA needs WebGL to render its 3D headquarters and orbital environment, and this browser or device has WebGL disabled or unavailable.</p>
        <ul className="small"><li>Enable hardware acceleration in your browser settings, or</li><li>Try a recent Chrome, Edge, Firefox or Safari on a device with a GPU.</li></ul>
      </div>
    );
  }
  const can = (perm) => !isSquadMission || myRoles.some((r) => ROLE_PERMS[r]?.includes(perm));
  const squadBar = isSquadMission && runtime.squadClient ? (
    <div className="glass hud-box tiny" style={{ maxWidth: 260 }}>
      <div><b>Squad</b> · {runtime.squadClient.isHost ? 'you are mission host' : 'synced from host'} · <span className={squadConnected === false ? 'bad' : 'good'}>{squadConnected === false ? 'reconnecting…' : 'connected'}</span></div>
      <div className="muted">Your roles: {myRoles.map((r) => ROLE_LABELS[r]).join(', ')}</div>
    </div>
  ) : null;
  return (
    <ErrorBoundary onReset={backToHQ}>
      <Canvas shadows={!lowQ && profile?.prefs?.quality !== 'low'} dpr={lowQ ? 0.5 : profile?.prefs?.quality === 'low' ? 1 : [1, 1.75]} camera={{ fov: 50, near: 0.01, far: 20000, position: [0, 2, 8] }} gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }} style={{ position: 'fixed', inset: 0 }}>
        <AdaptiveDpr pixelated={false} />
        <Suspense fallback={null}>
          <Scene onLaunchPhase={(phase, count) => setLaunch((l) => ({ phase, count: count ?? l.count }))} />
        </Suspense>
      </Canvas>
      <div className="layer">
        {screen === 'boot' && <Boot />}
        {screen === 'intro' && <Intro />}
        {screen === 'title' && <Title />}
        {screen === 'auth' && <Auth />}
        {screen === 'setup' && <Setup />}
        {screen === 'modeSelect' && <ModeSelect />}
        {screen === 'hq' && <HQOverlay />}
        {isSquadMission && ['briefing', 'designer', 'results'].includes(screen) ? <SquadWrappers screen={screen} /> : (
          <>
            {screen === 'briefing' && mission && <Briefing />}
            {screen === 'designer' && mission && <Designer />}
            {screen === 'results' && <Results />}
          </>
        )}
        {screen === 'launch' && <LaunchOverlay phase={launch.phase} count={launch.count} />}
        {screen === 'space' && <><EngineLoop /><SpaceHUD squadBar={squadBar} canFn={can} /></>}
        {modal === 'profile' && <ProfileModal />}
        <Toasts />
      </div>
      {mode === 'squad' && null}
    </ErrorBoundary>
  );
}
