/** 置いた刺激オブジェクトの見た目（低ポリゴンのコード生成）。TownField.items と同期する。 */
import * as THREE from 'three';
import type { ItemKind, PlacedItem } from '../sim/items.ts';
import type { TownField } from '../sim/field.ts';
import { glowSpriteTexture } from './textures.ts';

type Anim = (t: number, dt: number) => void;
interface Built { group: THREE.Group; anim?: Anim }

const std = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...o });

let glowTex: THREE.CanvasTexture | null = null;
const glow = (color: number, size: number, opacity = 0.7): THREE.Sprite => {
  glowTex ??= glowSpriteTexture();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.setScalar(size);
  return s;
};

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** 立ち上る粒（湯気・胞子）。 */
function risingPoints(n: number, color: number, size: number, height: number, spread: number, opacity: number): { obj: THREE.Points; anim: Anim } {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const seed = Float32Array.from({ length: n }, () => Math.random());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  glowTex ??= glowSpriteTexture();
  const mat = new THREE.PointsMaterial({ map: glowTex, size, transparent: true, opacity, depthWrite: false, color, sizeAttenuation: true });
  const obj = new THREE.Points(geo, mat);
  obj.frustumCulled = false;
  const anim: Anim = (t) => {
    for (let i = 0; i < n; i++) {
      const ph = (t * 0.25 + seed[i]) % 1;
      pos[i * 3] = Math.sin(ph * 7 + seed[i] * 9) * spread * (0.3 + ph);
      pos[i * 3 + 1] = ph * height;
      pos[i * 3 + 2] = Math.cos(ph * 6 + seed[i] * 7) * spread * (0.3 + ph);
    }
    geo.attributes.position.needsUpdate = true;
  };
  return { obj, anim };
}

function build(kind: ItemKind, rot: number): Built {
  const g = new THREE.Group();
  switch (kind) {
    case 'garbage': {
      const m = std(0x3f4a46, { roughness: 0.4 });
      for (const [x, z, s] of [[0, 0, 1], [0.38, 0.12, 0.75]] as const) {
        const b = mesh(new THREE.IcosahedronGeometry(0.34 * s, 1), m, x, 0.3 * s, z);
        b.scale.set(1, 0.9, 1);
        g.add(b, mesh(new THREE.ConeGeometry(0.1 * s, 0.2 * s, 6), m, x, 0.68 * s, z));
      }
      return { group: g };
    }
    case 'banana': {
      const peel = std(0xf6d34a, { roughness: 0.5 });
      const tip = std(0x5b4326);
      for (let k = 0; k < 3; k++) {
        const b = mesh(new THREE.TorusGeometry(0.24, 0.055, 6, 10, Math.PI * 0.75), peel);
        b.rotation.set(Math.PI / 2, 0, k * 0.5);
        b.position.set(0, 0.06 + k * 0.09, 0);
        const t = mesh(new THREE.SphereGeometry(0.06, 5, 4), tip, 0, 0, 0);
        t.position.set(Math.cos(k * 0.5) * 0.24, 0.06 + k * 0.09, Math.sin(k * 0.5) * 0.24);
        g.add(b, t);
      }
      return { group: g };
    }
    case 'cake': {
      g.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 16), std(0xffffff), 0, 0.015, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 14), std(0xfff0d6), 0, 0.1, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 14), std(0xf9b4c8), 0, 0.23, 0));
      g.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), std(0xe03a4a, { roughness: 0.3 }), 0, 0.32, 0));
      return { group: g };
    }
    case 'coffee': {
      g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 16), std(0xf4f1ea), 0, 0.013, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.18, 14), std(0xffffff, { roughness: 0.3 }), 0, 0.12, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 14), std(0x4a2c1a), 0, 0.205, 0));
      const h = mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 10), std(0xffffff), 0.2, 0.12, 0);
      g.add(h);
      const st = risingPoints(6, 0xf2efe9, 0.25, 0.5, 0.06, 0.35);
      st.obj.position.y = 0.22;
      g.add(st.obj);
      return { group: g, anim: st.anim };
    }
    case 'heater': {
      g.add(mesh(new THREE.BoxGeometry(0.62, 0.78, 0.3), std(0x4b4f57), 0, 0.39, 0));
      const grille = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a14, emissiveIntensity: 1.2, roughness: 0.5 });
      const gm = mesh(new THREE.BoxGeometry(0.5, 0.58, 0.04), grille, 0, 0.4, 0.16);
      g.add(gm);
      const sp = glow(0xff7a2a, 2.6, 0.5);
      sp.position.set(0, 0.5, 0.3);
      g.add(sp);
      return { group: g, anim: (t) => { grille.emissiveIntensity = 1.0 + 0.3 * Math.sin(t * 3); sp.material.opacity = 0.42 + 0.1 * Math.sin(t * 2.3); } };
    }
    case 'ice': {
      const m = std(0xc4ecff, { transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.05 });
      for (const [x, z, s, r] of [[0, 0, 0.5, 0.3], [0.38, 0.2, 0.34, 0.9], [-0.3, 0.32, 0.3, 1.4]] as const) {
        const b = mesh(new THREE.BoxGeometry(s, s, s), m, x, s / 2, z);
        b.rotation.y = r;
        g.add(b);
      }
      const sp = glow(0x8fd6ff, 2.2, 0.35);
      sp.position.y = 0.3;
      g.add(sp);
      return { group: g };
    }
    case 'fan': {
      const body = std(0xe6ebf0);
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 12), body, 0, 0.03, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8), body, 0, 0.3, 0));
      const head = new THREE.Group();
      head.position.set(0, 0.7, 0);
      head.rotation.y = rot;
      const ring = mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 20), std(0x7aa7d9), 0, 0, 0.05);
      head.add(ring);
      head.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), body, 0, 0, 0).rotateX(Math.PI / 2));
      const blades = new THREE.Group();
      blades.position.z = 0.1;
      for (let k = 0; k < 3; k++) {
        const b = mesh(new THREE.BoxGeometry(0.1, 0.26, 0.012), std(0x9ec5ee, { transparent: true, opacity: 0.85 }), 0, 0.14, 0);
        const pivot = new THREE.Group();
        pivot.rotation.z = (k * Math.PI * 2) / 3;
        pivot.add(b);
        blades.add(pivot);
      }
      head.add(blades);
      g.add(head);
      return { group: g, anim: (_t, dt) => { blades.rotation.z -= dt * 22; } };
    }
    case 'humidifier': {
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 14), std(0xf4f8fb), 0, 0.25, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.06, 14), std(0x9dd3ee), 0, 0.53, 0));
      const st = risingPoints(14, 0xeaf6ff, 0.5, 1.6, 0.3, 0.4);
      st.obj.position.y = 0.55;
      g.add(st.obj);
      return { group: g, anim: st.anim };
    }
    case 'mold': {
      g.add(mesh(new THREE.BoxGeometry(0.56, 0.5, 0.56), std(0xb89b72), 0, 0.25, 0));
      const mm = std(0x6e9a62, { roughness: 1 });
      for (const [x, y, z, s] of [[0.1, 0.51, 0.1, 0.16], [-0.14, 0.5, -0.08, 0.12], [0.29, 0.3, 0.05, 0.12], [-0.05, 0.33, 0.29, 0.14]] as const) {
        const b = mesh(new THREE.IcosahedronGeometry(s, 0), mm, x, y, z);
        b.scale.y = 0.5;
        g.add(b);
      }
      const sp = risingPoints(10, 0x93c486, 0.18, 1.0, 0.25, 0.4);
      sp.obj.position.y = 0.5;
      g.add(sp.obj);
      return { group: g, anim: sp.anim };
    }
    case 'zapper': {
      g.add(mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.1, 12), std(0x3a3d46), 0, 0.05, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), std(0x3a3d46), 0, 0.3, 0));
      const cage = new THREE.MeshStandardMaterial({ color: 0xb48cff, emissive: 0x8a5cff, emissiveIntensity: 1.6, transparent: true, opacity: 0.85, roughness: 0.4 });
      g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 10, 1, true), cage, 0, 0.8, 0));
      g.add(mesh(new THREE.ConeGeometry(0.26, 0.2, 10), std(0x3a3d46), 0, 1.2, 0));
      const sp = glow(0xa57aff, 3.4, 0.7);
      sp.position.y = 0.85;
      g.add(sp);
      return { group: g, anim: (t) => { const f = 0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 7.3); cage.emissiveIntensity = 1.2 + 0.9 * f; sp.material.opacity = 0.4 + 0.4 * f; } };
    }
    case 'paper': {
      const m = std(0xe8b445, { roughness: 0.18, metalness: 0.05, flatShading: false });
      const d = mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.012, 24), m, 0, 0.008, 0);
      d.castShadow = false;
      g.add(d);
      const dot = std(0x2a2623);
      for (const [x, z] of [[0.2, 0.15], [-0.3, 0.1], [0.05, -0.35], [-0.12, 0.38]] as const) {
        const s = mesh(new THREE.SphereGeometry(0.03, 5, 4), dot, x, 0.02, z);
        s.scale.y = 0.4;
        s.castShadow = false;
        g.add(s);
      }
      return { group: g };
    }
    case 'cone': {
      g.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), std(0xff7a2a), 0, 0.02, 0));
      g.add(mesh(new THREE.ConeGeometry(0.19, 0.7, 12), std(0xff7a2a), 0, 0.37, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.1, 12), std(0xffffff), 0, 0.33, 0));
      return { group: g };
    }
  }
}

export class ItemsView {
  readonly root = new THREE.Group();
  private views = new Map<number, Built & { item: PlacedItem }>();
  private field: TownField;
  /** 置く位置の目印。 */
  readonly cursor: THREE.Mesh;
  private cursorMat: THREE.MeshBasicMaterial;

  constructor(field: TownField) {
    this.field = field;
    this.cursorMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32), this.cursorMat);
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.renderOrder = 4;
    this.cursor.visible = false;
    this.root.add(this.cursor);
  }

  setCursor(x: number, z: number, state: 'add' | 'remove' | 'bad' | null): void {
    if (!state) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.set(x, 0.14, z);
    this.cursorMat.color.setHex(state === 'add' ? 0x3b82f6 : state === 'remove' ? 0xf59e0b : 0xe5484d);
  }

  setShadows(on: boolean): void {
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = on; });
  }

  update(t: number, dt: number): void {
    const items = this.field.items;
    if (items.length !== this.views.size || items.some((i) => !this.views.has(i.id))) this.sync();
    for (const v of this.views.values()) v.anim?.(t, dt);
  }

  private sync(): void {
    const live = new Set(this.field.items.map((i) => i.id));
    for (const [id, v] of this.views) {
      if (!live.has(id)) { this.root.remove(v.group); this.views.delete(id); }
    }
    for (const it of this.field.items) {
      if (this.views.has(it.id)) continue;
      const b = build(it.kind, it.rot);
      b.group.position.set(it.x, 0, it.z);
      if (it.kind !== 'fan') b.group.rotation.y = it.rot;
      this.root.add(b.group);
      this.views.set(it.id, { ...b, item: it });
    }
  }
}
