// Earth with day/night shader (NASA Blue Marble + city lights textures via three.js examples),
// specular oceans, moving clouds and an atmospheric rim glow.
import { useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';

const base = (p) => `${import.meta.env.BASE_URL}assets/textures/${p}`;

const vert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const frag = /* glsl */ `
uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D specMap; uniform vec3 sunDir;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  float d = dot(n, normalize(sunDir));
  float day = smoothstep(-0.12, 0.25, d);
  vec3 dayC = texture2D(dayMap, vUv).rgb;
  vec3 nightC = texture2D(nightMap, vUv).rgb * vec3(1.0, 0.82, 0.55) * 1.6;
  vec3 viewDir = normalize(cameraPosition - vW);
  vec3 h = normalize(normalize(sunDir) + viewDir);
  float spec = pow(max(dot(n, h), 0.0), 40.0) * texture2D(specMap, vUv).r * 0.7 * day;
  vec3 col = mix(nightC * (1.0 - day), dayC * (0.25 + 0.95 * max(d, 0.0)), day) + spec * vec3(1.0,0.95,0.85);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  col += rim * vec3(0.25, 0.55, 1.0) * (0.25 + day * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;
const atmoFrag = /* glsl */ `
uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(n, v)), 2.6);
  float lit = smoothstep(-0.3, 0.6, dot(n, normalize(sunDir)));
  gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * rim * (0.25 + lit), rim * (0.3 + 0.7 * lit));
}`;

export default function Earth({ radius = 1, sunDir = [1, 0.2, 0.3], rotation = 0, cloudSpeed = 0.004, segments = 96 }) {
  const [day, night, spec, normal, clouds] = useLoader(THREE.TextureLoader, [
    base('earth_atmos_2048.jpg'), base('earth_lights_2048.png'), base('earth_specular_2048.jpg'), base('earth_normal_2048.jpg'), base('earth_clouds_1024.png'),
  ]);
  useMemo(() => { day.colorSpace = THREE.SRGBColorSpace; night.colorSpace = THREE.SRGBColorSpace; for (const t of [day, night, spec, normal, clouds]) t.anisotropy = 8; }, [day, night, spec, normal, clouds]);
  const sun = useMemo(() => new THREE.Vector3(), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({ uniforms: { dayMap: { value: day }, nightMap: { value: night }, specMap: { value: spec }, sunDir: { value: sun } }, vertexShader: vert, fragmentShader: frag }), [day, night, spec, sun]);
  const atmo = useMemo(() => new THREE.ShaderMaterial({ uniforms: { sunDir: { value: sun } }, vertexShader: vert, fragmentShader: atmoFrag, transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }), [sun]);
  const cloudRef = useRef();
  const earthRef = useRef();
  useFrame((_, dt) => {
    sun.set(sunDir[0], sunDir[2], -sunDir[1]).normalize(); // ECI (z-up) → scene (y-up)
    if (earthRef.current) earthRef.current.rotation.y = rotation;
    if (cloudRef.current) cloudRef.current.rotation.y += dt * cloudSpeed;
  });
  return (
    <group>
      <mesh ref={earthRef} material={mat}>
        <sphereGeometry args={[radius, segments, segments]} />
      </mesh>
      <group ref={cloudRef}>
        <mesh scale={1.008}>
          <sphereGeometry args={[radius, segments, segments]} />
          <meshLambertMaterial map={clouds} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      </group>
      <mesh scale={1.06} material={atmo}>
        <sphereGeometry args={[radius, 64, 64]} />
      </mesh>
    </group>
  );
}
