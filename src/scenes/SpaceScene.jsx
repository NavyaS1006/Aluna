// Main 3D space environment: Earth, sun, stars, every simulated satellite as an individual
// instance with its own orbit path, threat debris, ambient debris (instanced), ground stations,
// links, conjunction lines and the optional external reference catalog.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import Earth from '../three/Earth.jsx';
import Starfield from '../three/Starfield.jsx';
import SatelliteModel from '../three/SatelliteModel.jsx';
import { makeNameTag } from '../three/Character.jsx';
import { runtime, useHud, useGame } from '../state/store.js';
import { propagate, sunDir, gmst, RE, DEG } from '../sim/orbit.js';
import { STATIONS } from '../sim/engine.js';
import { loadSnapshot, propagateRecord } from '../sim/catalog.js';

export const toScene = (r, out = new THREE.Vector3()) => out.set(r[0] / RE, r[2] / RE, -r[1] / RE);
const SAT_SCALE = 0.006; // visual exaggeration (≈38 km per metre) so spacecraft are visible — not to scale

function orbitPoints(el, t, n = 160) {
  const pts = [];
  const T = 2 * Math.PI * Math.sqrt(el.a ** 3 / 398600.4418);
  for (let k = 0; k <= n; k++) pts.push(toScene(propagate(el, t + (k / n) * T).r));
  return pts;
}

function OrbitLine({ el, t, color, opacity = 0.55, dashed = false }) {
  const key = `${el.a.toFixed(2)}${el.e.toFixed(5)}${el.i.toFixed(4)}${el.raan.toFixed(3)}${el.argp.toFixed(3)}${Math.floor(t / 600)}`;
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints(orbitPoints(el, t)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = useMemo(() => { const m = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.03, gapSize: 0.02 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity }); const l = new THREE.Line(geo, m); if (dashed) l.computeLineDistances(); return l; }, [geo, color, opacity, dashed]);
  useEffect(() => () => { geo.dispose(); line.material.dispose(); }, [geo, line]);
  return <primitive object={line} />;
}

function Sat({ sat, design, selected, onSelect }) {
  const g = useRef();
  const label = useMemo(() => makeNameTag(sat.name, sat.alive ? sat.color : '#777'), [sat.name, sat.color, sat.alive]);
  useEffect(() => () => label.dispose(), [label]);
  const ring = useRef();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const vel = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const e = runtime.engine; if (!e || !g.current) return;
    const st = propagate(sat.el, e.renderT());
    toScene(st.r, tmp); g.current.position.copy(tmp);
    toScene(st.v, vel).normalize();
    g.current.lookAt(tmp.clone().add(vel));
    if (ring.current) { const k = 0.07 * (1 + Math.sin(clock.elapsedTime * 4) * 0.08); ring.current.scale.set(k, k, 1); }
  });
  return (
    <group ref={g} onClick={(ev) => { ev.stopPropagation(); onSelect(sat.id); }} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
      <SatelliteModel design={design} accent={sat.color} scale={SAT_SCALE} lost={!sat.alive} />
      {/* generous invisible hit target */}
      <mesh visible={false}><sphereGeometry args={[0.03, 8, 8]} /></mesh>
      {selected && (
        <sprite ref={ring} scale={[0.07, 0.07, 1]}>
          <spriteMaterial color={sat.color} map={RING_TEX} transparent depthWrite={false} />
        </sprite>
      )}
      <sprite scale={[0.022, 0.022, 1]}><spriteMaterial color={sat.alive ? sat.color : '#555'} map={DOT_TEX} transparent depthWrite={false} sizeAttenuation={false} /></sprite>
      <sprite position={[0, 0.018, 0]} scale={[0.09, 0.0225, 1]} center={[0.5, -0.2]}><spriteMaterial map={label} transparent depthWrite={false} sizeAttenuation={false} /></sprite>
    </group>
  );
}

const DOT_TEX = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const RING_TEX = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke(); g.lineWidth = 10; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(64, 64, 52, k * Math.PI / 2 - 0.2, k * Math.PI / 2 + 0.2); g.stroke(); } return new THREE.CanvasTexture(c); })();

function UpperStage({ stageEl }) {
  const g = useRef();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => { const e = runtime.engine; if (!e || !g.current) return; const st = propagate(stageEl, e.renderT()); toScene(st.r, tmp); g.current.position.copy(tmp); g.current.lookAt(tmp.clone().add(toScene(st.v).normalize())); });
  return (
    <group ref={g} scale={0.006}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[1.2, 1.2, 4, 20]} /><meshStandardMaterial color="#dfe3ea" metalness={0.5} roughness={0.4} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2.6]}><coneGeometry args={[0.8, 1.2, 16, 1, true]} /><meshStandardMaterial color="#333" metalness={0.9} /></mesh>
    </group>
  );
}

function DebrisField({ list }) {
  const mesh = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geo = useMemo(() => new THREE.TetrahedronGeometry(0.004), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#9aa3b2' }), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(() => {
    const e = runtime.engine; if (!e || !mesh.current) return;
    const t = e.renderT();
    list.forEach((d, i) => { toScene(propagate(d.el, t).r, tmp); dummy.position.copy(tmp); dummy.rotation.set(i, t * 0.01 + i, 0); dummy.updateMatrix(); mesh.current.setMatrixAt(i, dummy.matrix); });
    mesh.current.count = list.length;
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, mat, Math.max(1, list.length)]} frustumCulled={false} />;
}

function Threat({ deb, onSelect }) {
  const g = useRef();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => { const e = runtime.engine; if (!e || !g.current) return; toScene(propagate(deb.el, e.renderT()).r, tmp); g.current.position.copy(tmp); g.current.rotation.x = clock.elapsedTime; g.current.rotation.y = clock.elapsedTime * 1.3; });
  return (
    <group ref={g} onClick={(e) => { e.stopPropagation(); onSelect?.(deb.id); }}>
      <mesh><octahedronGeometry args={[0.012]} /><meshBasicMaterial color="#ff5c5c" wireframe /></mesh>
      <sprite scale={[0.02, 0.02, 1]}><spriteMaterial color="#ff5c5c" map={DOT_TEX} transparent depthWrite={false} sizeAttenuation={false} /></sprite>
    </group>
  );
}

function Links() {
  // dynamic lines: ground contacts, inter-satellite links, conjunctions — rebuilt every frame into one buffer
  const geo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 6), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(600 * 6), 3)); return g; }, []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const a = useMemo(() => new THREE.Vector3(), []), b = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const e = runtime.engine; if (!e) return;
    const s = e.s, t = e.renderT();
    const P = geo.attributes.position.array, C = geo.attributes.color.array;
    let n = 0;
    const push = (p, q, c) => { if (n >= 600) return; P.set([p.x, p.y, p.z, q.x, q.y, q.z], n * 6); C.set([...c, ...c], n * 6); n++; };
    const alive = s.sats.filter((x) => x.deployed && x.alive);
    const posMap = new Map(alive.map((x) => [x.id, toScene(propagate(x.el, t).r, new THREE.Vector3())]));
    const g = gmst(t);
    for (const sat of alive) {
      if (sat.inContact) {
        const st = STATIONS.find((x) => x.id === sat.inContact);
        if (st) { const lat = st.lat * DEG, lon = st.lon * DEG + g; b.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)); push(posMap.get(sat.id), b, [0.49, 1, 0.6]); }
      }
    }
    if (e.design?.payload === 'relay' || s.linkedFrac !== undefined) {
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
        const p = posMap.get(alive[i].id), q = posMap.get(alive[j].id);
        if (alive[i].linked && alive[j].linked && p.distanceTo(q) * RE < (e.design?.payload === 'relay' ? 10000 : 6000)) {
          const mid = p.clone().add(q).multiplyScalar(0.5);
          if (mid.length() > (RE + 100) / RE) push(p, q, [0.3, 0.8, 1]);
        }
      }
    }
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 6);
    for (const c of s.conjunctions) {
      if (c.status !== 'open' || c.risk === 'proximity') continue;
      const p = posMap.get(c.a); const d = s.debris.find((x) => x.id === c.b);
      if (!p || !d) continue;
      toScene(propagate(d.el, t).r, a);
      push(p, a, c.risk === 'critical' || c.risk === 'high' ? [1, 0.25 * pulse, 0.25 * pulse] : [1, 0.7, 0.2]);
    }
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} />;
}

function GroundStations({ rotation }) {
  const g = useRef();
  useFrame(() => { if (g.current) g.current.rotation.y = rotation.current; });
  const s = runtime.engine?.s;
  return (
    <group ref={g}>
      {STATIONS.map((st) => {
        const lat = st.lat * DEG, lon = st.lon * DEG;
        const p = [Math.cos(lat) * Math.cos(lon) * 1.002, Math.sin(lat) * 1.002, -Math.cos(lat) * Math.sin(lon) * 1.002];
        const down = s?.stationsDown?.[st.id] > s?.t;
        return <mesh key={st.id} position={p}><sphereGeometry args={[0.008, 8, 8]} /><meshBasicMaterial color={down ? '#ff5c5c' : '#7cff9b'} /></mesh>;
      })}
    </group>
  );
}

function Catalog({ show }) {
  const [recs, setRecs] = useState([]);
  const extra = useGame((st) => st.liveTles);
  useEffect(() => { if (show) loadSnapshot().then(setRecs).catch(() => setRecs([])); }, [show]);
  const all = useMemo(() => [...recs, ...(extra || [])], [recs, extra]);
  const refs = useRef([]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const e = runtime.engine; if (!e || !show) return;
    all.forEach((rec, i) => { const pv = propagateRecord(rec, e.renderT()); const m = refs.current[i]; if (pv && m) { toScene(pv.r, tmp); m.position.copy(tmp); } });
  });
  if (!show) return null;
  return all.map((rec, i) => (
    <sprite key={rec.id + i} ref={(el) => (refs.current[i] = el)} scale={[0.014, 0.014, 1]}>
      <spriteMaterial color={rec.fetchedAt ? '#ffe066' : '#ffffff'} map={DOT_TEX} transparent opacity={0.85} depthWrite={false} sizeAttenuation={false} />
    </sprite>
  ));
}

function CameraRig({ controls }) {
  const focus = useHud((s) => s.focus);
  const { camera } = useThree();
  const tgt = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const e = runtime.engine; const c = controls.current; if (!e || !c) return;
    const sat = focus && e.s.sats.find((x) => x.id === focus);
    if (sat && sat.deployed) {
      toScene(propagate(sat.el, e.renderT()).r, tgt);
      const delta = tgt.clone().sub(c.target);
      c.target.add(delta.multiplyScalar(1 - Math.exp(-dt * 8)));
      camera.position.add(delta);
    } else {
      c.target.lerp(tgt.set(0, 0, 0), 1 - Math.exp(-dt * 3));
    }
  });
  return null;
}

export default function SpaceScene() {
  const [, setV] = useState(0);
  const sel = useHud((s) => s.selected);
  const setSel = useHud((s) => s.setSel);
  const showCatalog = useGame((s) => s.showCatalog);
  const controls = useRef();
  const earthRot = useRef(0);
  const [sun, setSun] = useState([1, 0, 0]);
  const { camera } = useThree();
  useEffect(() => {
    camera.near = 0.001; camera.far = 2000; camera.updateProjectionMatrix();
    const e = runtime.engine;
    if (e) { const st = propagate(e.s.stage.el, e.renderT()); const p = toScene(st.r).normalize(); const v = toScene(st.v).normalize(); camera.position.copy(p.multiplyScalar(2.6).add(v.multiplyScalar(-1.2)).add(new THREE.Vector3(0, 0.6, 0))); }
    else camera.position.set(2.2, 1.4, 3.2);
  }, [camera]);
  useEffect(() => { const l = () => setV((v) => v + 1); runtime.listeners.add(l); return () => runtime.listeners.delete(l); }, []);
  useFrame(() => {
    const e = runtime.engine; if (!e) return;
    const t = e.renderT();
    earthRot.current = gmst(t);
    const sd = sunDir(t, e.s.sunLon);
    if (Math.abs(sd[0] - sun[0]) > 0.001) setSun(sd);
  });
  const e = runtime.engine;
  if (!e) return null;
  const s = e.s;
  const select = (id) => { setSel(id); useGame.getState().onSelectSat?.(id); };
  const ambient = s.debris.filter((d) => d.kind === 'ambient');
  const threats = s.debris.filter((d) => d.kind === 'threat');
  const sunPos = [sun[0] * 50, sun[2] * 50, -sun[1] * 50];
  return (
    <>
      <color attach="background" args={['#000005']} />
      <Starfield />
      <ambientLight intensity={0.08} />
      <directionalLight position={sunPos} intensity={2.4} color="#fff6e8" />
      <mesh position={sunPos}><sphereGeometry args={[1.2, 24, 24]} /><meshBasicMaterial color="#fff3d6" /></mesh>
      <sprite position={sunPos} scale={[14, 14, 1]}><spriteMaterial map={DOT_TEX} color="#ffe2a8" transparent opacity={0.6} depthWrite={false} /></sprite>
      <Suspense fallback={null}>
        <EarthRotating sun={sun} rot={earthRot} />
      </Suspense>
      <GroundStations rotation={earthRot} />
      {s.sats.some((x) => !x.deployed) && <UpperStage stageEl={s.stage.el} />}
      {s.sats.filter((x) => x.deployed).map((sat) => (
        <group key={sat.id}>
          <Sat sat={sat} design={e.design} selected={sel === sat.id} onSelect={select} />
          {sat.alive && <OrbitLine el={sat.el} t={s.t} color={sat.color} opacity={sel === sat.id ? 0.95 : 0.4} />}
        </group>
      ))}
      {threats.map((d) => (
        <group key={d.id}>
          <Threat deb={d} />
          {s.conjunctions.some((c) => c.b === d.id && c.status === 'open') && <OrbitLine el={d.el} t={s.t} color="#ff5c5c" opacity={0.6} dashed />}
        </group>
      ))}
      <DebrisField list={ambient} />
      <Links />
      <Catalog show={showCatalog} />
      <OrbitControls ref={controls} enablePan={false} minDistance={0.05} maxDistance={30} rotateSpeed={0.5} zoomSpeed={0.8} makeDefault />
      <CameraRig controls={controls} />
    </>
  );
}

function EarthRotating({ sun, rot }) {
  const g = useRef();
  useFrame(() => { if (g.current) g.current.rotation.y = rot.current; });
  return <group ref={g}><Earth sunDir={sun} rotation={0} /></group>;
}
