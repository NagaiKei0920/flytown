/**
 * ハエ人の頭（大きな複眼・毛深い頭殻・触角と剛毛・関節のある口吻・単眼）と、背中の薄膜の羽。
 * どちらもコード生成。単位はメートル、頭は +z が前、+y が上。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hexEyeTextures, wingVeinTexture } from './textures.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Shared {
  eye: THREE.MeshPhysicalMaterial;
  fuzz: THREE.MeshPhysicalMaterial;
  face: THREE.MeshPhysicalMaterial;
  dark: THREE.MeshStandardMaterial;
  bristle: THREE.MeshStandardMaterial;
  ocellus: THREE.MeshPhysicalMaterial;
  pad: THREE.MeshPhysicalMaterial;
  eyeGeo: THREE.BufferGeometry;
  aristaGeo: THREE.BufferGeometry;
  bristleGeo: THREE.BufferGeometry;
  veins: THREE.Texture;
  wingGeo: THREE.BufferGeometry;
}
let shared: Shared | null = null;

const EYE_R = 0.125;

function getShared(): Shared {
  if (shared) return shared;
  const { map, normal } = hexEyeTextures();
  const eye = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.2,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    emissive: 0x2a0309,
    envMapIntensity: 1.4,
  });
  // 半球のドーム。極が +z（外側）を向き、ファセットは正射影の UV で貼る（縁ほど小さく見える）
  const eyeGeo = new THREE.SphereGeometry(EYE_R, 56, 40, 0, Math.PI * 2, 0, Math.PI);
  eyeGeo.rotateX(Math.PI / 2);
  const ep = eyeGeo.attributes.position;
  const euv = new Float32Array(ep.count * 2);
  const K = 1.0;
  for (let i = 0; i < ep.count; i++) {
    euv[i * 2] = (ep.getX(i) / EYE_R) * K;
    euv[i * 2 + 1] = (ep.getY(i) / EYE_R) * K;
  }
  eyeGeo.setAttribute('uv', new THREE.BufferAttribute(euv, 2));

  // 触角の剛毛（arista）: 細い曲線 + 左右に並ぶ羽毛状の枝
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.012, 0.06),
    new THREE.Vector3(0, 0.036, 0.115),
    new THREE.Vector3(0, 0.07, 0.15),
  ]);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.TubeGeometry(curve, 14, 0.0042, 5, false).toNonIndexed());
  const m4 = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  for (let k = 0; k < 14; k++) {
    const t = 0.12 + (k / 13) * 0.86;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const len = 0.03 * (1 - t * 0.55);
    for (const s of [-1, 1]) {
      for (const lift of [0, 0.7]) {
        const g = new THREE.CylinderGeometry(0.0009, 0.0015, len, 3, 1).toNonIndexed();
        g.translate(0, len / 2, 0);
        const dir = new THREE.Vector3(s * 0.95, lift, 0.55).normalize().addScaledVector(tan, 0.45).normalize();
        qq.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        m4.compose(p, qq, new THREE.Vector3(1, 1, 1));
        g.applyMatrix4(m4);
        parts.push(g);
        if (lift === 0) break;
      }
    }
  }
  const aristaGeo = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; }))!;

  const bristleGeo = new THREE.ConeGeometry(0.0022, 0.03, 4, 1);
  bristleGeo.translate(0, 0.015, 0);

  // 羽
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.bezierCurveTo(0.42, 0.18, 0.46, 0.85, 0.12, 1.3);
  wingShape.bezierCurveTo(-0.08, 1.5, -0.4, 0.95, -0.3, 0.42);
  wingShape.bezierCurveTo(-0.26, 0.16, -0.1, 0.05, 0, 0);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 24);
  const pos = wingGeo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + 0.4) / 0.9;
    uv[i * 2 + 1] = pos.getY(i) / 1.5;
  }
  wingGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  shared = {
    eye,
    fuzz: new THREE.MeshPhysicalMaterial({ color: 0x4b4039, roughness: 0.92, sheen: 1, sheenColor: new THREE.Color(0x9b8a7a), sheenRoughness: 0.45 }),
    face: new THREE.MeshPhysicalMaterial({ color: 0x5c4e44, roughness: 0.7, sheen: 0.6, sheenColor: new THREE.Color(0xc2ad96), sheenRoughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a302a, roughness: 0.55 }),
    bristle: new THREE.MeshStandardMaterial({ color: 0x241c18, roughness: 0.8 }),
    ocellus: new THREE.MeshPhysicalMaterial({ color: 0xe8743c, roughness: 0.12, clearcoat: 1, emissive: 0x5a1c06, emissiveIntensity: 0.6 }),
    pad: new THREE.MeshPhysicalMaterial({ color: 0xcf8a8a, roughness: 0.35, clearcoat: 0.6 }),
    eyeGeo,
    aristaGeo,
    bristleGeo,
    veins: wingVeinTexture(),
    wingGeo,
  };
  return shared;
}

export interface FlyHeadInput {
  feed: number;
  antennaTilt: number;
  antennaStrength: number;
}

export class FlyHead {
  /** 頭のボーンのマウントに付ける。原点 = 頭殻の中心。 */
  readonly group = new THREE.Group();
  private antL = new THREE.Group();
  private antR = new THREE.Group();
  private rost = new THREE.Group();
  private rostMesh: THREE.Mesh;
  private joint = new THREE.Group();
  private haust: THREE.Mesh;
  private lab = new THREE.Group();
  private feedS = 0;
  private antTiltS = 0;
  private antStrS = 0;
  readonly meshes: THREE.Mesh[] = [];

  constructor() {
    const sh = getShared();
    const H = this.group;
    const add = (m: THREE.Mesh, parent: THREE.Object3D = H) => {
      m.castShadow = true;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };
    const ell = (r: number, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, seg = 24) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(10, seg / 2)), mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      return m;
    };

    // 頭殻（毛深い灰褐色）。複眼の間と後ろを埋める
    add(ell(0.13, sh.fuzz, 0.72, 1.0, 0.9, 0, -0.005, -0.04, 32));
    // 後頭部
    add(ell(0.1, sh.fuzz, 1.0, 0.9, 0.8, 0, -0.03, -0.09, 20));
    // 顔の下（頬 + 口の周り）
    add(ell(0.085, sh.face, 0.95, 0.7, 0.7, 0, -0.1, 0.055, 24));
    // 口の窪み
    add(ell(0.045, sh.dark, 1.2, 0.8, 0.8, 0, -0.15, 0.1, 14));

    // 複眼: 外側 + やや前を向いた半球ドーム
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(sh.eyeGeo, sh.eye);
      eye.castShadow = true;
      eye.scale.set(1.0, 1.25, 1.0);
      eye.position.set(s * 0.092, 0.015, 0.0);
      const dir = new THREE.Vector3(s * 0.55, 0.1, 0.83).normalize();
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      H.add(eye);
      this.meshes.push(eye);
    }

    // 単眼 3 つ（頭頂）
    for (const [x, y, z] of [[0, 0.142, 0.03], [-0.032, 0.134, -0.005], [0.032, 0.134, -0.005]]) {
      add(ell(0.0135, sh.ocellus, 1, 1, 1, x, y, z, 12));
    }

    // 剛毛（前頭と頭頂のまばらな毛）
    const r = rng(1234);
    const bristles = new THREE.InstancedMesh(sh.bristleGeo, sh.bristle, 150);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    const eyeC = [new THREE.Vector3(-0.092, 0.015, 0), new THREE.Vector3(0.092, 0.015, 0)];
    for (let guard = 0; n < 150 && guard < 4000; guard++) {
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const sq = Math.sqrt(1 - u * u);
      const nrm = new THREE.Vector3(sq * Math.cos(a), u, sq * Math.sin(a));
      if (nrm.z < -0.25 || nrm.y < -0.2) continue;
      const p = new THREE.Vector3(nrm.x * 0.124, nrm.y * 0.14, nrm.z * 0.127 - 0.015);
      if (eyeC.some((c) => Math.hypot((p.x - c.x) / 0.82, (p.y - c.y) / 1.25, p.z - c.z) < EYE_R * 0.98)) continue;
      const len = 0.5 + r() * 0.6;
      q.setFromUnitVectors(up, nrm.clone().add(new THREE.Vector3(0, 0.15, 0.25)).normalize());
      m4.compose(p, q, new THREE.Vector3(1, len, 1));
      bristles.setMatrixAt(n++, m4);
    }
    bristles.count = n;
    bristles.castShadow = false;
    H.add(bristles);

    // 触角: 柄節・梗節・第 3 節 + 羽毛状の剛毛
    for (const [pivot, s] of [[this.antL, 1], [this.antR, -1]] as const) {
      pivot.position.set(s * 0.036, 0.068, 0.118);
      add(ell(0.01, sh.dark, 1, 1, 1.2, 0, 0, 0.004, 10), pivot);
      const third = add(ell(0.014, sh.dark, 0.9, 1.1, 1.7, 0, -0.008, 0.026, 14), pivot);
      third.rotation.x = 0.35;
      const arista = new THREE.Mesh(sh.aristaGeo, sh.bristle);
      arista.position.set(0, 0.0, 0.05);
      arista.rotation.x = -0.1;
      pivot.add(arista);
      this.meshes.push(arista);
      H.add(pivot);
    }

    // 口吻: 基部（口吻） -> 関節 -> 吻（細い管）-> 唇弁
    const probRoot = new THREE.Group();
    probRoot.position.set(0, -0.145, 0.095);
    H.add(probRoot);
    probRoot.add(this.rost);
    const rg = new THREE.CylinderGeometry(0.017, 0.024, 1, 10);
    rg.rotateX(Math.PI / 2);
    rg.translate(0, 0, 0.5);
    this.rostMesh = add(new THREE.Mesh(rg, sh.face), this.rost);
    this.rost.add(this.joint);
    add(ell(0.0155, sh.dark, 1, 1, 1, 0, 0, 0, 10), this.joint);
    const hg = new THREE.CylinderGeometry(0.0085, 0.0115, 1, 8);
    hg.rotateX(Math.PI / 2);
    hg.translate(0, 0, 0.5);
    this.haust = add(new THREE.Mesh(hg, sh.dark), this.joint);
    this.joint.add(this.lab);
    for (const s of [-1, 1]) {
      const lobe = ell(0.02, sh.pad, 0.75, 0.5, 1.5, s * 0.014, 0, 0.012, 12);
      lobe.rotation.y = s * 0.35;
      add(lobe, this.lab);
    }
  }

  update(dt: number, p: FlyHeadInput, time: number): void {
    this.feedS += (p.feed - this.feedS) * (1 - Math.exp(-dt * 7));
    const e = clamp01(this.feedS);
    // 口吻: 折りたたんで下に収まっている -> 前下に伸び、先が地面方向を向く
    const L1 = lerp(0.05, 0.1, e);
    const L2 = lerp(0.035, 0.17, e);
    this.rost.rotation.x = lerp(1.45, 0.8, e);
    this.rostMesh.scale.z = L1;
    this.joint.position.z = L1;
    this.joint.rotation.x = lerp(-2.7, 0.45, e);
    this.haust.scale.z = L2;
    this.lab.position.z = L2;
    this.lab.scale.setScalar(lerp(0.6, 1.25, e));
    this.lab.rotation.z = Math.sin(time * 9) * 0.25 * e;

    this.antTiltS += (p.antennaTilt - this.antTiltS) * (1 - Math.exp(-dt * 6));
    this.antStrS += (p.antennaStrength - this.antStrS) * (1 - Math.exp(-dt * 6));
    const wob = Math.sin(time * 5.5) * 0.05 * (0.3 + this.antStrS);
    const yaw = this.antTiltS * 0.55;
    this.antL.rotation.set(-0.12 - 0.3 * this.antStrS + wob, 0.3 + yaw, 0);
    this.antR.rotation.set(-0.12 - 0.3 * this.antStrS - wob, -0.3 + yaw, 0);
  }
}

function wingMaterial(veins: THREE.Texture, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uVeins: { value: veins }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uVeins; uniform float uOpacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        // 薄膜干渉: 見る角度と膜厚（位置でゆるく変わる）で色相が回る
        float thick = 0.55 + vUv.y * 0.9 + vUv.x * 0.35 + 0.1 * sin(vUv.y * 19.0 + vUv.x * 7.0);
        float film = (1.0 - ndv) * 1.7 + thick;
        vec3 irid = 0.56 + 0.44 * cos(6.28318 * (film + vec3(0.0, 0.33, 0.67)));
        irid = mix(vec3(0.9, 0.95, 1.0), irid, 0.62);
        float v = texture2D(uVeins, vUv).r;
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float a = (0.16 + 0.3 * (1.0 - ndv)) + v * 0.55;
        vec3 col = mix(irid, vec3(0.3, 0.27, 0.26), v * 0.7);
        gl_FragColor = vec4(col, clamp(a * (0.75 + 0.25 * edge), 0.0, 0.95) * uOpacity);
      }`,
  });
}

interface WingSide {
  pivots: THREE.Group[];
  mats: THREE.ShaderMaterial[];
  sign: 1 | -1;
}

/** 背中の左右の羽。待機では背に沿って畳み、羽ばたきで開いて残像 3 枚をずらす。 */
export class FlyWings {
  readonly group = new THREE.Group();
  private sides: WingSide[] = [];
  private open = 0;
  private phase = 0;

  constructor() {
    const sh = getShared();
    for (const sign of [1, -1] as const) {
      const side: WingSide = { pivots: [], mats: [], sign };
      for (let k = 0; k < 3; k++) {
        const pv = new THREE.Group();
        pv.rotation.order = 'ZYX';
        pv.position.set(sign * 0.055, 0.07, -0.115);
        const mat = wingMaterial(sh.veins, [1, 0.5, 0.28][k]);
        const mesh = new THREE.Mesh(sh.wingGeo, mat);
        mesh.scale.setScalar(0.5);
        mesh.renderOrder = 5;
        pv.add(mesh);
        this.group.add(pv);
        side.pivots.push(pv);
        side.mats.push(mat);
      }
      this.sides.push(side);
    }
  }

  update(dt: number, flap: number): void {
    const on = flap > 0.05;
    this.open += ((on ? 1 : 0) - this.open) * (1 - Math.exp(-dt * 14));
    if (on) this.phase += Math.PI * 2 * (17 + 6 * flap) * dt;
    const rest = Math.PI - 0.2;
    const open = this.open;
    for (const w of this.sides) {
      for (let k = 0; k < 3; k++) {
        const amp = 0.55 * (0.4 + 0.6 * flap);
        const swing = Math.sin(this.phase - k * 0.6) * amp;
        const spread = lerp(rest, 1.45 + swing, open);
        const pv = w.pivots[k];
        // 開くと翼面が水平に近づくよう、長軸まわりにひねる
        pv.rotation.set(-0.12 * (1 - open) - 0.2 * open, -w.sign * 1.15 * open, -w.sign * spread);
        pv.visible = k === 0 || open > 0.25;
        w.mats[k].uniforms.uOpacity.value = [1, 0.5, 0.28][k] * (k === 0 ? 1 : open);
      }
    }
  }
}
