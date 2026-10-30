/** レンダラ・光・空・霧。やわらかい配色の昼。 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SUN_DIR } from '../sim/world.ts';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  update(focus: THREE.Vector3, camDist: number, t: number): void;
  setShadows(on: boolean): void;
  setPixelRatio(r: number): void;
}

export interface StageOptions { dprCap?: number; shadowMap?: number }

export function createStage(parent: HTMLElement, opts: StageOptions = {}): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.dprCap ?? 2));
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = (opts.shadowMap ?? 2048) > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = 'block';
  parent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const horizon = new THREE.Color(0xdfeaf4);
  scene.fog = new THREE.Fog(horizon, 280, 1100);

  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  scene.add(new THREE.HemisphereLight(0xdbeaff, 0xf3e7d7, 0.85));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
  sun.castShadow = (opts.shadowMap ?? 2048) > 0;
  sun.shadow.mapSize.set(opts.shadowMap ?? 2048, opts.shadowMap ?? 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  // 空
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x8fc1ec) },
      horizon: { value: horizon },
      sunDir: { value: new THREE.Vector3(...SUN_DIR) },
    },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += vec3(1.0, 0.93, 0.8) * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  // 雲（低ポリの丸の塊）
  const clouds = new THREE.Group();
  const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false });
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    const n = 4 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), cm);
      m.scale.set(14 + r() * 14, 7 + r() * 6, 12 + r() * 10);
      m.position.set((k - n / 2) * 14 + r() * 6, r() * 5, r() * 10);
      g.add(m);
    }
    const a = r() * Math.PI * 2;
    const d = 450 + r() * 500;
    g.position.set(Math.cos(a) * d, 170 + r() * 90, Math.sin(a) * d);
    clouds.add(g);
  }
  scene.add(clouds);

  const snap = new THREE.Vector3();
  let lastExtent = 0;
  return {
    renderer, scene, sun,
    update(focus, camDist, t) {
      const extent = camDist < 60 ? 50 : camDist < 140 ? 95 : 175;
      snap.set(Math.round(focus.x), 0, Math.round(focus.z));
      sun.target.position.copy(snap);
      sun.position.set(snap.x + SUN_DIR[0] * 260, SUN_DIR[1] * 260, snap.z + SUN_DIR[2] * 260);
      if (extent !== lastExtent) {
        const c = sun.shadow.camera;
        c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent;
        c.near = 10; c.far = 620;
        c.updateProjectionMatrix();
        lastExtent = extent;
      }
      clouds.rotation.y = t * 0.002;
    },
    setShadows(on) {
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
    },
    setPixelRatio(v) {
      renderer.setPixelRatio(v);
      renderer.setSize(parent.clientWidth, parent.clientHeight);
    },
  };
}
