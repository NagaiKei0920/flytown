/** シミュレーション状態 → 車・歩行者・ハエ人のメッシュ。固定 tick の間を補間する。 */
import * as THREE from 'three';
import type { Assets } from './assets.ts';
import { CharacterRig } from './character.ts';
import type { Sim } from '../sim/sim.ts';

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Actors {
  readonly root = new THREE.Group();
  readonly flyRigs: CharacterRig[] = [];
  private npcRigs: CharacterRig[] = [];
  private cars: THREE.Object3D[] = [];
  private rings: THREE.Mesh[] = [];
  private ringMats: THREE.MeshBasicMaterial[] = [];
  selected = -1;
  private skip: number[] = [];
  private skipN: number[] = [];
  private camPos = new THREE.Vector3(0, 100, 0);

  private sim: Sim;

  constructor(sim: Sim, assets: Assets) {
    this.sim = sim;
    // 描画時にカメラ位置を拾うための点（簡略化の距離判定に使う）
    const probe = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)), new THREE.MeshBasicMaterial({ visible: true, colorWrite: false, depthWrite: false }));
    probe.frustumCulled = false;
    probe.onBeforeRender = (_r, _s, camera) => this.camPos.copy(camera.position);
    this.root.add(probe);
    for (const c of sim.cars) {
      const src = assets.cars[c.id % assets.cars.length];
      const o = src.obj.clone(true);
      this.cars.push(o);
      this.root.add(o);
    }
    for (const n of sim.npcs) {
      const rig = new CharacterRig(assets.characters[(4 + n.id) % assets.characters.length], { fly: false });
      this.npcRigs.push(rig);
      this.skip.push(0);
      this.skipN.push(0);
      this.root.add(rig.group);
    }
    for (const f of sim.flies) {
      const rig = new CharacterRig(assets.characters[f.id % 4], { fly: true });
      this.flyRigs.push(rig);
      this.root.add(rig.group);
      const mat = new THREE.MeshBasicMaterial({ color: f.accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 40), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 3;
      this.rings.push(ring);
      this.ringMats.push(mat);
      this.root.add(ring);
    }
  }

  setShadows(on: boolean): void {
    for (const r of [...this.npcRigs, ...this.flyRigs]) r.setShadows(on);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.Mesh).geometry.type.startsWith('Ring')) {
        // 車も含めて切替
      }
    });
    for (const c of this.cars) c.traverse((o) => { (o as THREE.Mesh).castShadow = on; });
  }

  update(alpha: number, dt: number, time: number): void {
    const sim = this.sim;
    sim.cars.forEach((c, i) => {
      const o = this.cars[i];
      o.position.set(c.px + (c.x - c.px) * alpha, 0, c.pz + (c.z - c.pz) * alpha);
      o.rotation.y = lerpAngle(c.pyaw, c.yaw, alpha);
    });
    sim.npcs.forEach((n, i) => {
      const r = this.npcRigs[i];
      r.group.position.set(n.px + (n.x - n.px) * alpha, 0, n.pz + (n.z - n.pz) * alpha);
      r.group.rotation.y = lerpAngle(n.pyaw, n.yaw, alpha);
      const d2 = r.group.position.distanceToSquared(this.camPos);
      r.setLod(d2 < 55 * 55, d2 > 70 * 70);
      // 遠い NPC は 3 フレームに 1 回だけ姿勢を更新する
      if (d2 > 90 * 90) {
        this.skip[i] += dt;
        if (++this.skipN[i] % 3 !== 0) return;
      }
      const adt = d2 > 90 * 90 ? this.skip[i] : dt;
      this.skip[i] = 0;
      r.animate(adt, { vf: n.speed, turnRate: 0, height: 0, flap: 0, groom: 0, feed: 0, antennaTilt: 0, antennaStrength: 0, tumble: 0 }, time + i);
    });
    sim.flies.forEach((f, i) => {
      const r = this.flyRigs[i];
      const x = f.px + (f.x - f.px) * alpha;
      const z = f.pz + (f.z - f.pz) * alpha;
      const y = f.py + (f.y - f.py) * alpha;
      r.group.position.set(x, y, z);
      r.group.rotation.y = lerpAngle(f.pyaw, f.yaw, alpha);
      const c = f.cmd;
      const alive = !f.down;
      r.animate(dt, {
        vf: alive ? f.vf : 0,
        turnRate: alive ? f.turnRate : 0,
        height: y,
        flap: alive && !f.flapLocked && c.flap > 0.15 ? c.flap : 0,
        groom: alive ? c.groom : 0,
        feed: alive ? c.feed : 0,
        antennaTilt: f.antennaTilt,
        antennaStrength: f.antennaStrength,
        tumble: f.tumble,
      }, time + i * 3);
      const ring = this.rings[i];
      ring.position.set(x, 0.2, z);
      const sel = i === this.selected;
      ring.scale.setScalar(sel ? 1 + 0.08 * Math.sin(time * 4) : 0.9);
      this.ringMats[i].opacity = sel ? 0.95 : 0.4;
    });
  }

  /** 画面のレイに最も近いハエ人の番号。無ければ -1。 */
  pick(ray: THREE.Ray, radius = 1.0): number {
    let best = -1;
    let bd = Infinity;
    const s = new THREE.Sphere();
    const p = new THREE.Vector3();
    this.sim.flies.forEach((f, i) => {
      s.set(new THREE.Vector3(f.x, f.y + 0.85, f.z), radius);
      if (ray.intersectSphere(s, p)) {
        const d = p.distanceTo(ray.origin);
        if (d < bd) { bd = d; best = i; }
      }
    });
    return best;
  }
}
