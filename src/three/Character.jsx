// Rigged, skeletal-animated crew character (RobotExpressive by Tomás Laulhé, CC0 — via three.js examples).
// Each instance is a skeleton clone with its own tinted materials and animation mixer;
// animations cross-fade (Idle ↔ Walking ↔ Running ↔ Wave).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const MODEL_URL = `${import.meta.env.BASE_URL}assets/models/RobotExpressive.glb`;
useGLTF.preload(MODEL_URL);

export const SUIT_COLORS = ['#e6e9ef', '#4fd1ff', '#ffb547', '#ff6fa8', '#7cff9b', '#b18cff', '#ff5c5c', '#2f6bff'];
export const TRIM_COLORS = ['#3a3f4b', '#c0c6d2', '#d9a441', '#1d2733', '#5cf2d6', '#a33'];
export const DEFAULT_LOOK = { suit: '#4fd1ff', trim: '#3a3f4b', height: 1, emblem: 0 };

export function makeNameTag(text, color = '#4fd1ff', sub = '') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(6,12,24,0.78)'; g.beginPath(); g.roundRect(8, 16, 496, 96, 24); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#fff'; g.font = '600 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.slice(0, 18), 256, sub ? 52 : 64);
  if (sub) { g.fillStyle = color; g.font = '500 26px system-ui, sans-serif'; g.fillText(sub.slice(0, 32), 256, 90); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function Character({ look = DEFAULT_LOOK, anim = 'Idle', name, sub, tagColor, groupRef, speed = 1 }) {
  const { scene, animations } = useGLTF(MODEL_URL);
  const model = useMemo(() => {
    const m = skeletonClone(scene);
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = false;
        o.material = o.material.clone();
        if (o.material.name === 'Main') o.material.color.set(look.suit);
        if (o.material.name === 'Grey') o.material.color.set(look.trim);
        o.material.metalness = 0.35; o.material.roughness = 0.45;
      }
    });
    return m;
  }, [scene, look.suit, look.trim]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const actions = useMemo(() => Object.fromEntries(animations.map((a) => [a.name, mixer.clipAction(a)])), [animations, mixer]);
  const current = useRef(null);
  useEffect(() => {
    const next = actions[anim] || actions.Idle;
    if (current.current === next) return;
    next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    if (['Wave', 'Jump', 'Yes', 'ThumbsUp'].includes(anim)) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    if (current.current) current.current.fadeOut(0.25);
    current.current = next;
  }, [anim, actions]);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(model); model.traverse((o) => { if (o.isMesh) o.material.dispose(); }); }, [mixer, model]);
  useFrame((_, dt) => mixer.update(Math.min(dt, 0.1) * speed));
  const tag = useMemo(() => (name ? makeNameTag(name, tagColor || look.suit, sub) : null), [name, sub, tagColor, look.suit]);
  useEffect(() => () => tag?.dispose(), [tag]);
  return (
    <group ref={groupRef}>
      <primitive object={model} scale={0.42 * (look.height || 1)} />
      {tag && (
        <sprite position={[0, 2.25 * (look.height || 1), 0]} scale={[1.6, 0.4, 1]}>
          <spriteMaterial map={tag} transparent depthWrite={false} />
        </sprite>
      )}
    </group>
  );
}
