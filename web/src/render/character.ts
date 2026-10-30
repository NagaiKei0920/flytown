/**
 * 人型の体（Quaternius Ultimate Modular Men / Women、CC0、骨格付き）をコードで動かす。
 * 歩容は BodyCommand 由来の前進速度から決める: 三脚 A = 左脚、三脚 B = 右脚（逆位相）。
 * 歩行・走行・待機はキーフレームの AnimationClip（周期 1 秒に正規化）で、
 * AnimationMixer の時刻を歩容の位相に直接結び付ける（自走させない）。後退は位相を逆回しにする。
 * 身繕い・羽ばたき中の腕は 2 ボーン IK、摂食・空中は骨への加算回転で姿勢を作る。
 * ハエ人は人の頭を消し、頭ボーンに大きなハエの頭を付け、胸ボーンに羽を付ける。
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FlyHead, FlyWings } from './flyParts.ts';

/** モデル（約 1.84 m）→ ゲーム内の身長（約 1.75 m）。 */
export const CHAR_SCALE = 0.95;
const HIP_H = 0.894 * CHAR_SCALE;

export interface PoseInput {
  /** 前向き速度（m/s）。負で後退。 */
  vf: number;
  turnRate: number;
  height: number;
  flap: number;
  groom: number;
  feed: number;
  antennaTilt: number;
  antennaStrength: number;
  tumble: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const qAxis = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

// ---- テンプレート（モデルごとに 1 回）: 休止姿勢と歩行クリップ -----------------------------

interface BoneRest {
  qRest: THREE.Quaternion; // ローカル
  pw: THREE.Quaternion; // 親のワールド回転（休止）
  pwInv: THREE.Quaternion;
  wRest: THREE.Quaternion; // 自分のワールド回転（休止）
  pos: THREE.Vector3; // 休止ワールド位置（モデル座標）
  mat: THREE.Matrix4; // 休止ワールド行列
  scale: THREE.Vector3;
}

interface Tpl {
  bones: Map<string, BoneRest>;
  Lt: number;
  Ls: number;
  hipsLocal: THREE.Vector3;
  hipsParentInv: THREE.Matrix4;
  clips: { idle: THREE.AnimationClip; walk: THREE.AnimationClip; run: THREE.AnimationClip };
  stride: { walk: number; run: number };
  arm: { L1: number; L2: number; restUp: THREE.Vector3; restFore: THREE.Vector3 }[]; // [L, R]
}

const TRACKED = [
  'Hips', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Head',
  'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR',
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR',
];
const EXTRA = ['ShoulderL', 'ShoulderR', 'HandL', 'HandR'];

const tplCache = new WeakMap<THREE.Object3D, Tpl>();

function localFromDelta(b: BoneRest, R: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  return out.copy(b.pwInv).multiply(R).multiply(b.pw).multiply(b.qRest);
}

interface GaitParams {
  A: number; kb: number; ks: number; arm: number; eb: number; ec: number;
  twist: number; hipYaw: number; lean: number; sway: number; low: number;
}

function buildClip(tpl: Tpl, name: string, P: GaitParams): { clip: THREE.AnimationClip; stride: number } {
  const N = 32;
  const times: number[] = [];
  const vals = new Map<string, number[]>();
  for (const n of TRACKED) vals.set(n, []);
  const hipsPos: number[] = [];
  const { Lt, Ls } = tpl;
  const tmp = new THREE.Quaternion();
  const zeroInv = new THREE.Vector3(0, 0, 0).applyMatrix4(tpl.hipsParentInv);

  const legs = (th: number, side: 'L' | 'R') => {
    const s = side === 'R' ? th + Math.PI : th;
    const a = P.A * (Math.sin(s) + 0.2);
    const bump = Math.pow(Math.max(0, Math.cos(s + 0.9)), 1.6);
    const b = P.kb + P.ks * bump;
    const plantar = Math.min(0.5, 0.45 * (P.A / 0.42)) * Math.pow(Math.max(0, Math.cos(s + 1.4)), 2);
    return {
      a, b, plantar,
      h: Lt * Math.cos(a) + Ls * Math.cos(a - b),
      z: Lt * Math.sin(a) + Ls * Math.sin(a - b),
    };
  };

  for (let i = 0; i <= N; i++) {
    const ph = i / N;
    const th = ph * Math.PI * 2;
    const s = Math.sin(th);
    const rel = new Map<string, THREE.Quaternion>();
    const legL = legs(th, 'L');
    const legR = legs(th, 'R');
    for (const [side, lg] of [['L', legL], ['R', legR]] as const) {
      rel.set(`UpperLeg${side}`, qAxis(AX, -lg.a));
      rel.set(`LowerLeg${side}`, qAxis(AX, lg.b));
      rel.set(`Foot${side}`, qAxis(AX, 0.8 * (lg.a - lg.b) + lg.plantar));
    }
    const dy = Math.max(legL.h, legR.h) - (Lt + Ls);
    rel.set('Hips', qAxis(AY, -P.hipYaw * s));
    rel.set('Abdomen', qAxis(AY, (P.twist + P.hipYaw) * 0.6 * s).multiply(qAxis(AX, P.lean * 0.5)));
    rel.set('Torso', qAxis(AY, (P.twist + P.hipYaw) * 0.4 * s));
    rel.set('Chest', qAxis(AX, P.lean * 0.5));
    rel.set('Neck', qAxis(AX, -P.lean * 0.3));
    rel.set('Head', qAxis(AY, -P.twist * s * 0.6).multiply(qAxis(AX, -P.lean * 0.5)));
    for (const side of ['L', 'R'] as const) {
      const sg = side === 'L' ? -1 : 1;
      const gamma = (side === 'L' ? -1 : 1) * P.arm * s;
      const fwd2 = P.arm > 1e-6 ? Math.max(0, gamma / P.arm) : 0;
      rel.set(`UpperArm${side}`, qAxis(AX, -gamma).multiply(qAxis(AZ, sg * P.low)));
      rel.set(`LowerArm${side}`, qAxis(AY, sg * (P.eb + P.ec * fwd2)));
    }
    times.push(ph);
    for (const n of TRACKED) {
      const b = tpl.bones.get(n)!;
      localFromDelta(b, rel.get(n) ?? tmp.identity(), tmp);
      vals.get(n)!.push(tmp.x, tmp.y, tmp.z, tmp.w);
    }
    // 腰の移動（モデル座標の差分 -> Hips のローカル）
    const wd = new THREE.Vector3(-P.sway * Math.cos(th), dy, 0).applyMatrix4(tpl.hipsParentInv).sub(zeroInv);
    const lp = tpl.hipsLocal.clone().add(wd);
    hipsPos.push(lp.x, lp.y, lp.z);
  }

  // 歩幅 = 接地している足が腰に対して後ろへ動いた距離の 1 周期分
  let stride = 0;
  if (P.A > 1e-6) {
    const M = 720;
    let prev: { z: number; side: number } | null = null;
    for (let i = 0; i <= M; i++) {
      const th = (i / M) * Math.PI * 2;
      const l = legs(th, 'L');
      const r = legs(th, 'R');
      const side = l.h >= r.h ? 0 : 1;
      const z = side === 0 ? l.z : r.z;
      if (prev && prev.side === side) stride += prev.z - z;
      prev = { z, side };
    }
  }

  const tracks: THREE.KeyframeTrack[] = [];
  for (const n of TRACKED) tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, vals.get(n)!));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipsPos));
  return { clip: new THREE.AnimationClip(name, 1, tracks), stride };
}

function getTpl(src: THREE.Object3D): Tpl {
  const hit = tplCache.get(src);
  if (hit) return hit;
  src.updateMatrixWorld(true);
  const bones = new Map<string, BoneRest>();
  for (const n of [...TRACKED, ...EXTRA]) {
    const b = src.getObjectByName(n);
    if (!b) throw new Error(`bone not found: ${n}`);
    const pw = new THREE.Quaternion();
    if (b.parent) b.parent.matrixWorld.decompose(new THREE.Vector3(), pw, new THREE.Vector3());
    const wq = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    b.matrixWorld.decompose(pos, wq, scale);
    bones.set(n, {
      qRest: b.quaternion.clone(), pw, pwInv: pw.clone().invert(), wRest: wq, pos,
      mat: b.matrixWorld.clone(), scale,
    });
  }
  const P = (n: string) => bones.get(n)!.pos;
  const hips = src.getObjectByName('Hips')!;
  const arm = (s: 'L' | 'R') => ({
    L1: P(`UpperArm${s}`).distanceTo(P(`LowerArm${s}`)),
    L2: P(`LowerArm${s}`).distanceTo(P(`Hand${s}`)),
    restUp: P(`LowerArm${s}`).clone().sub(P(`UpperArm${s}`)).normalize(),
    restFore: P(`Hand${s}`).clone().sub(P(`LowerArm${s}`)).normalize(),
  });
  const tpl: Tpl = {
    bones,
    Lt: P('UpperLegL').distanceTo(P('LowerLegL')),
    Ls: P('LowerLegL').distanceTo(P('FootL')),
    hipsLocal: hips.position.clone(),
    hipsParentInv: hips.parent!.matrixWorld.clone().invert(),
    clips: null as unknown as Tpl['clips'],
    stride: { walk: 1.4, run: 2.4 },
    arm: [arm('L'), arm('R')],
  };
  const base = { twist: 0, hipYaw: 0, sway: 0, A: 0, kb: 0.03, ks: 0, arm: 0, eb: 0.14, ec: 0, lean: 0, low: 1.3 };
  const idle = buildClip(tpl, 'idle', base);
  const walk = buildClip(tpl, 'walk', { ...base, A: 0.42, kb: 0.07, ks: 0.95, arm: 0.36, eb: 0.16, ec: 0.35, twist: 0.12, hipYaw: 0.09, sway: 0.02, lean: 0.04 });
  const run = buildClip(tpl, 'run', { ...base, A: 0.78, kb: 0.25, ks: 1.5, arm: 0.85, eb: 1.3, ec: 0.3, twist: 0.24, hipYaw: 0.14, sway: 0.015, lean: 0.2 });
  tpl.clips = { idle: idle.clip, walk: walk.clip, run: run.clip };
  tpl.stride = { walk: walk.stride, run: run.stride };
  tplCache.set(src, tpl);
  return tpl;
}

// ---- リグ ------------------------------------------------------------------------------

export interface RigOptions {
  fly: boolean;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

export class CharacterRig {
  readonly group = new THREE.Group();
  readonly isFly: boolean;
  private tumblePivot = new THREE.Group();
  private body = new THREE.Group();
  private clone: THREE.Object3D;
  private tpl: Tpl;
  private bone: Record<string, THREE.Bone> = {};
  private mixer: THREE.AnimationMixer;
  private act: { idle: THREE.AnimationAction; walk: THREE.AnimationAction; run: THREE.AnimationAction };
  private head?: FlyHead;
  private wings?: FlyWings;
  private headMount?: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private humanHead: THREE.Object3D[] = [];
  private tinyParts = new Set<THREE.Mesh>();

  private phase = Math.random();
  private groomS = 0;
  private groomT = 0;
  private feedS = 0;
  private airS = 0;
  private cloneInv = new THREE.Matrix4();
  private clean: THREE.Quaternion[] = [];
  private cleanHips = new THREE.Vector3();
  private hips!: THREE.Bone;

  constructor(src: THREE.Object3D, opts: RigOptions) {
    this.isFly = opts.fly;
    this.tpl = getTpl(src);
    this.clone = cloneSkinned(src);
    this.clone.traverse((o) => {
      const n = o.name;
      if ((o as THREE.Bone).isBone) this.bone[n] = o as THREE.Bone;
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.frustumCulled = false;
        this.meshes.push(m);
        const mn = (m.material as THREE.Material).name;
        if (!opts.fly && (['Eye', 'Eyebrows', 'Earrings', 'Moustache'].includes(mn) || /_Feet/.test(m.name))) this.tinyParts.add(m);
      }
      if (/_Head(_\d+)?$/.test(n)) this.humanHead.push(o);
    });
    this.hips = this.bone['Hips'];
    this.clean = TRACKED.map((n) => this.bone[n].quaternion.clone());
    this.cleanHips.copy(this.hips.position);
    this.body.scale.setScalar(CHAR_SCALE);
    this.body.add(this.clone);
    this.tumblePivot.add(this.body);
    this.group.add(this.tumblePivot);

    this.mixer = new THREE.AnimationMixer(this.clone);
    this.act = {
      idle: this.mixer.clipAction(this.tpl.clips.idle),
      walk: this.mixer.clipAction(this.tpl.clips.walk),
      run: this.mixer.clipAction(this.tpl.clips.run),
    };
    for (const a of Object.values(this.act)) a.play();

    if (opts.fly) this.buildFly();
  }

  /** 骨のローカル座標でモデル座標系（ワールド軸）と同じ向き・同じ大きさになる枠を作る。 */
  private makeMount(boneName: string): THREE.Group {
    const r = this.tpl.bones.get(boneName)!;
    const g = new THREE.Group();
    g.quaternion.copy(r.wRest).invert();
    g.scale.set(1 / r.scale.x, 1 / r.scale.y, 1 / r.scale.z);
    this.bone[boneName].add(g);
    return g;
  }

  private buildFly(): void {
    for (const o of this.humanHead) o.visible = false;
    this.head = new FlyHead();
    this.headMount = this.makeMount('Head');
    this.head.group.position.set(0, 0.15, 0.03);
    this.head.group.scale.setScalar(1.3);
    this.headMount.add(this.head.group);
    this.wings = new FlyWings();
    const chest = this.makeMount('Chest');
    chest.add(this.wings.group);
    for (const m of this.head.meshes) this.meshes.push(m);
  }

  setHeadVisible(v: boolean): void {
    if (this.isFly) {
      if (this.head) this.head.group.visible = v;
      if (this.wings) this.wings.group.visible = v;
    } else for (const o of this.humanHead) o.visible = v;
  }

  /** 頭の世界座標（複眼視点のカメラ位置）。 */
  headWorld(out: THREE.Vector3): THREE.Vector3 {
    const h = this.headMount ?? this.bone['Head'];
    h.updateWorldMatrix(true, false);
    return out.set(0, 0.14, 0.17).applyMatrix4(h.matrixWorld);
  }

  private shadowsOn = true;
  private lodNear = true;
  private lodFar = false;

  setShadows(on: boolean): void {
    this.shadowsOn = on;
    this.applyLod();
  }

  /** 距離に応じた簡略化。near: 影を落とす、far: 顔の小物（目・眉・ひげ・ピアス）を描かない。 */
  setLod(near: boolean, far: boolean): void {
    if (near === this.lodNear && far === this.lodFar) return;
    this.lodNear = near;
    this.lodFar = far;
    this.applyLod();
  }

  private applyLod(): void {
    const cast = this.shadowsOn && (this.lodNear || this.isFly);
    for (const m of this.meshes) {
      m.castShadow = cast;
      if (this.tinyParts.has(m)) m.visible = !this.lodFar;
    }
  }

  /** 骨に加算回転を掛ける。axis まわり angle（モデル軸）。 */
  private add(name: string, axis: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < 1e-5) return;
    const r = this.tpl.bones.get(name)!;
    _q.setFromAxisAngle(axis, angle);
    _q2.copy(r.pwInv).multiply(_q).multiply(r.pw);
    this.bone[name].quaternion.premultiply(_q2);
  }

  /** 休止姿勢の基準点（モデル座標）を、アンカー骨の現在の姿勢に追従させた点に直す。 */
  private anchored(anchor: string, rest: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const r = this.tpl.bones.get(anchor)!;
    _m.copy(this.cloneInv).multiply(this.bone[anchor].matrixWorld);
    _m2.copy(r.mat).invert();
    return out.copy(rest).applyMatrix4(_m2).applyMatrix4(_m);
  }

  /** 2 ボーン IK。target はモデル座標。w で元の姿勢と混ぜる。 */
  private armIK(side: 0 | 1, target: THREE.Vector3, pole: THREE.Vector3, w: number): void {
    const s = side === 0 ? 'L' : 'R';
    const t = this.tpl;
    const arm = t.arm[side];
    const up = this.bone[`UpperArm${s}`];
    const fore = this.bone[`LowerArm${s}`];
    const rU = t.bones.get(`UpperArm${s}`)!;
    const rF = t.bones.get(`LowerArm${s}`)!;
    const sh = this.bone[`Shoulder${s}`];

    // 肩（上腕の付け根）の現在位置
    _m.copy(this.cloneInv).multiply(up.matrixWorld);
    const S = _v.setFromMatrixPosition(_m).clone();
    const d0 = target.clone().sub(S);
    let d = d0.length();
    const u = d0.divideScalar(Math.max(d, 1e-6));
    d = Math.min(Math.max(d, Math.abs(arm.L1 - arm.L2) + 0.01), arm.L1 + arm.L2 - 0.005);
    const a = (arm.L1 * arm.L1 - arm.L2 * arm.L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, arm.L1 * arm.L1 - a * a));
    const pp = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    const E = S.clone().addScaledVector(u, a).addScaledVector(pp, h);
    const T = S.clone().addScaledVector(u, d);
    const dirU = E.clone().sub(S).normalize();
    const dirF = T.clone().sub(E).normalize();
    const RU = new THREE.Quaternion().setFromUnitVectors(arm.restUp, dirU);
    const RF = new THREE.Quaternion().setFromUnitVectors(arm.restFore, dirF);

    // 上腕: 親（肩）の現在のワールド回転で局所化
    _m.copy(this.cloneInv).multiply(sh.matrixWorld);
    _m.decompose(_v2, _q2, new THREE.Vector3());
    const upWorld = RU.clone().multiply(rU.wRest);
    const qUp = _q2.clone().invert().multiply(upWorld);
    const qFore = upWorld.clone().invert().multiply(RF).multiply(rF.wRest);
    up.quaternion.slerp(qUp, w);
    fore.quaternion.slerp(qFore, w);
  }

  /** 1 フレーム分の姿勢を更新する。dt は秒（時間倍率込み）。 */
  animate(dt: number, p: PoseInput, time: number): void {
    const sp = Math.abs(p.vf);
    const air = smooth(0.02, 0.1, p.height);
    this.airS = air;
    this.groomS += (p.groom - this.groomS) * (1 - Math.exp(-dt * 9));
    this.feedS += (p.feed - this.feedS) * (1 - Math.exp(-dt * 7));
    const gs = this.groomS;
    const fs = this.feedS;
    if (gs > 0.02) this.groomT += dt;

    // 歩容: 位相は前進速度 / 歩幅で進み、後退は逆回し。重みは 1 に正規化（残りは休止姿勢に引かれるため）。
    const wRun = smooth(2.1, 3.2, sp) * (1 - air);
    const wWalk = smooth(0.04, 0.5, sp) * (1 - wRun) * (1 - air);
    const wIdle = 1 - wWalk - wRun;
    const stride = lerp(this.tpl.stride.walk, this.tpl.stride.run, wRun / Math.max(wWalk + wRun, 1e-4));
    const dir = p.vf >= 0 ? 1 : -1;
    this.phase += (dir * sp * dt) / Math.max(0.5, stride);
    this.phase -= Math.floor(this.phase);
    this.act.idle.setEffectiveWeight(wIdle);
    this.act.walk.setEffectiveWeight(wWalk);
    this.act.run.setEffectiveWeight(wRun);
    // AnimationMixer は前回と値が同じトラックを書き戻さないので、加算で汚した骨を先に元へ戻す
    for (let i = 0; i < TRACKED.length; i++) this.bone[TRACKED[i]].quaternion.copy(this.clean[i]);
    this.hips.position.copy(this.cleanHips);
    this.mixer.setTime(this.phase);
    for (let i = 0; i < TRACKED.length; i++) this.clean[i].copy(this.bone[TRACKED[i]].quaternion);
    this.cleanHips.copy(this.hips.position);

    // ---- 加算の姿勢 ----
    // 呼吸と体の揺れ
    this.add('Chest', AX, 0.012 * Math.sin(time * 1.9));
    this.add('Head', AY, 0.05 * Math.sin(time * 0.5 + 1) - p.turnRate * 0.04);
    this.add('Head', AZ, 0.03 * Math.sin(time * 0.7));
    // 旋回: 上体を内側へ傾ける
    this.add('Abdomen', AZ, -p.turnRate * 0.05 * Math.min(1, sp / 1.2 + 0.2) * (1 - air));
    // 空中: 前傾し、脚は力を抜いてぶら下げる
    if (air > 0.001) {
      const fl = Math.sin(time * 11) * 0.08;
      this.add('Abdomen', AX, 0.18 * air);
      this.add('Chest', AX, 0.16 * air);
      this.add('Head', AX, -0.2 * air);
      this.add('UpperLegL', AX, -(0.45 + fl) * air);
      this.add('LowerLegL', AX, 0.7 * air);
      this.add('UpperLegR', AX, -(0.3 - fl) * air);
      this.add('LowerLegR', AX, 0.5 * air);
    }
    // 摂食: 膝を曲げて前かがみ、頭を下げる
    let hipDrop = 0;
    if (fs > 0.001) {
      this.add('UpperLegL', AX, -0.55 * fs);
      this.add('UpperLegR', AX, -0.55 * fs);
      this.add('LowerLegL', AX, 1.1 * fs);
      this.add('LowerLegR', AX, 1.1 * fs);
      this.add('FootL', AX, -0.55 * fs);
      this.add('FootR', AX, -0.55 * fs);
      this.add('Abdomen', AX, 0.22 * fs);
      this.add('Chest', AX, 0.24 * fs);
      this.add('Neck', AX, 0.18 * fs);
      hipDrop = 0.14 * fs;
    }
    if (hipDrop > 0) {
      const hips = this.bone['Hips'];
      _v.set(0, -hipDrop, 0.04 * (hipDrop / 0.14)).applyMatrix4(this.tpl.hipsParentInv);
      _v2.set(0, 0, 0).applyMatrix4(this.tpl.hipsParentInv);
      hips.position.add(_v.sub(_v2));
    }

    // ---- 腕: 身繕い / 空中 / 摂食は IK ----
    const wIK = Math.max(gs, air * 0.9, fs * 0.6);
    if (wIK > 0.002) {
      this.group.updateMatrixWorld(true);
      this.cloneInv.copy(this.clone.matrixWorld).invert();
      const mode = smooth(-0.3, 0.3, Math.sin(this.groomT * 0.9));
      const rub = Math.sin(this.groomT * 15);
      const stroke = Math.sin(this.groomT * 9);
      for (const side of [0, 1] as const) {
        const sg = side === 0 ? 1 : -1; // 左 = +x
        const cur = this.bone[side === 0 ? 'HandL' : 'HandR'];
        _m.copy(this.cloneInv).multiply(cur.matrixWorld);
        const wrist = new THREE.Vector3().setFromMatrixPosition(_m);
        const goal = wrist.clone();
        // 身繕い: こすり合わせ（胸の前） ⇄ 頭をなでる（頭の横）
        if (gs > 0.002) {
          const rubT = this.anchored('Chest', new THREE.Vector3(sg * (0.075 + 0.015 * rub), 1.31, 0.27 + sg * 0.05 * rub), new THREE.Vector3());
          const strT = this.anchored('Head', new THREE.Vector3(sg * (0.33 - 0.02 * stroke), 1.69 + 0.1 * stroke, 0.07), new THREE.Vector3());
          const gt = rubT.lerp(strT, mode);
          goal.lerp(gt, gs);
        }
        // 摂食: 手を口の前へ
        if (fs > 0.002) {
          const ft = this.anchored('Head', new THREE.Vector3(sg * 0.1, 1.55, 0.3), new THREE.Vector3());
          goal.lerp(ft, fs * 0.6 * (1 - gs));
        }
        // 空中: 腕を横に広げる
        if (air > 0.002) {
          const fl = Math.sin(time * 9 + side) * 0.08;
          const at = this.anchored('Chest', new THREE.Vector3(sg * 0.62, 1.44 + fl, -0.06), new THREE.Vector3());
          goal.lerp(at, air * 0.9 * (1 - gs));
        }
        const pole = side === 0 ? new THREE.Vector3(0.7, -0.6, -0.45) : new THREE.Vector3(-0.7, -0.6, -0.45);
        this.armIK(side, goal, pole, clamp01(wIK * 4));
      }
    }

    // ---- ハエの頭・羽 ----
    if (this.head && this.wings) {
      this.head.update(dt, { feed: p.feed >= 0 ? this.feedS : 0, antennaTilt: p.antennaTilt, antennaStrength: p.antennaStrength }, time);
      this.wings.update(dt, p.flap);
    }

    // ---- 転倒 ----
    const tm = p.tumble;
    this.tumblePivot.rotation.x = tm;
    const c = Math.cos(tm);
    this.tumblePivot.position.y = 0.2 + (HIP_H - 0.2) * c * c;
    this.body.position.y = -HIP_H;
  }
}
