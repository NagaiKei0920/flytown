/** 注射器の動きと、頭のぼんやりした光。 */
import * as THREE from 'three';
import { glowSpriteTexture } from './textures.ts';
import type { DopamineKind } from '../brain/connectome/batch.ts';

const COLOR: Record<DopamineKind, number> = { reward: 0xff7aa8, punish: 0x6c63ff, all: 0xffc94d };
/** 注射の動き: 近づく -> 押す -> 戻る（秒）。 */
const T_IN = 0.45;
const T_PUSH = 0.55;
const T_OUT = 0.4;
const T_GLOW = 2.8;

interface Active {
  t: number;
  kind: DopamineKind;
}

export class InjectionFx {
  readonly root = new THREE.Group();
  private syringes: THREE.Group[] = [];
  private plungers: THREE.Mesh[] = [];
  private liquids: THREE.MeshStandardMaterial[] = [];
  private glows: THREE.Sprite[] = [];
  private active: (Active | null)[] = [];
  private tmp = new THREE.Vector3();

  constructor(n: number) {
    const tex = glowSpriteTexture();
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const glass = new THREE.MeshStandardMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.45, roughness: 0.1 });
      const liquid = new THREE.MeshStandardMaterial({ color: 0xff7aa8, emissive: 0xff7aa8, emissiveIntensity: 0.5, transparent: true, opacity: 0.9 });
      const metal = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, metalness: 0.7, roughness: 0.3 });
      // 軸は +z（針先が +z）。
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 10).rotateX(Math.PI / 2), glass);
      barrel.position.z = -0.14;
      const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 10).rotateX(Math.PI / 2), liquid);
      fluid.position.z = -0.12;
      const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6).rotateX(Math.PI / 2), metal);
      plunger.position.z = -0.38;
      const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 10).rotateX(Math.PI / 2), metal);
      thumb.position.z = -0.12;
      plunger.add(thumb);
      const flange = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.025), metal);
      flange.position.z = -0.02;
      const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6).rotateX(Math.PI / 2), metal);
      needle.position.z = 0.06;
      g.add(barrel, fluid, plunger, flange, needle);
      g.visible = false;
      g.renderOrder = 6;
      this.root.add(g);
      this.syringes.push(g);
      this.plungers.push(plunger);
      this.liquids.push(liquid);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
      sp.renderOrder = 7;
      sp.visible = false;
      this.root.add(sp);
      this.glows.push(sp);
      this.active.push(null);
    }
  }

  trigger(i: number, kind: DopamineKind): void {
    this.active[i] = { t: 0, kind };
    const c = COLOR[kind];
    this.liquids[i].color.setHex(c);
    this.liquids[i].emissive.setHex(c);
    (this.glows[i].material as THREE.SpriteMaterial).color.setHex(c);
  }

  /** head: 各ハエ人の頭の世界座標を返す関数。yaw: 体の向き。 */
  update(dt: number, head: (i: number, out: THREE.Vector3) => THREE.Vector3, yaw: (i: number) => number): void {
    for (let i = 0; i < this.active.length; i++) {
      const a = this.active[i];
      const g = this.syringes[i];
      const sp = this.glows[i];
      if (!a) { g.visible = false; sp.visible = false; continue; }
      a.t += dt;
      if (a.t > T_GLOW) { this.active[i] = null; continue; }
      const h = head(i, this.tmp);
      // 注射器: 頭の横上から針先を頭へ向ける
      const y = yaw(i);
      const side = new THREE.Vector3(Math.cos(y), 0, -Math.sin(y)); // 体の左
      const tIn = Math.min(1, a.t / T_IN);
      const tOut = Math.max(0, (a.t - T_IN - T_PUSH) / T_OUT);
      const e = (u: number) => u * u * (3 - 2 * u);
      const reach = a.t < T_IN + T_PUSH ? e(tIn) : 1 - e(Math.min(1, tOut));
      const dist = 0.9 - 0.62 * reach; // 針先から頭までの距離
      const dir = side.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.55, 0)).normalize();
      g.visible = a.t < T_IN + T_PUSH + T_OUT;
      g.position.copy(h).addScaledVector(dir, dist + 0.06);
      g.lookAt(h);
      const push = Math.max(0, Math.min(1, (a.t - T_IN) / T_PUSH));
      this.plungers[i].position.z = -0.38 + 0.14 * e(push);
      this.liquids[i].opacity = 0.9 - 0.5 * push;
      // 頭の光: 押した後に立ち上がり、ゆっくり消える
      const gl = a.t < T_IN ? 0 : Math.min(1, (a.t - T_IN) / 0.25) * Math.max(0, 1 - (a.t - T_IN - 0.25) / (T_GLOW - T_IN - 0.25));
      sp.visible = gl > 0.01;
      sp.position.copy(h);
      sp.scale.setScalar(1.2 + 0.5 * Math.sin(a.t * 9) * gl + 0.9 * gl);
      (sp.material as THREE.SpriteMaterial).opacity = 0.85 * gl;
    }
  }
}
