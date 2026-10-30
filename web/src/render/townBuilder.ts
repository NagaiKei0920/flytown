/**
 * 街の見た目を作る。道路・歩道・小物・店・工事現場・広場はコード生成、
 * 一般のビルは Kenney City Kit Commercial（CC0）を配置する。
 */
import * as THREE from 'three';
import type { Assets } from './assets.ts';
import { Batch } from './batch.ts';
import { asphaltTexture, awningTexture, glowSpriteTexture, signTexture } from './textures.ts';
import type { BuildingSpec, PropSpec, ShopKind, TownLayout } from '../sim/world.ts';
import {
  BLOCK_HALF, CARRIAGE_HALF, FACADE, LANE_OFF, N_BLOCKS, N_ROADS, ROAD_C, ROAD_HALF, SLAB_HALF, blockCenter,
} from '../sim/world.ts';

const SIDEWALK = 0xe9e4da;
const CURB = 0xd2cdc2;
const ASPHALT = 0x7f8794;
const WHITE = 0xf8f7f2;
const TREE_GREENS = [0x9ed49f, 0x8cc99b, 0xb6dd9f, 0xa5d7a8];
const BLOSSOM = 0xf5c8d6;

export interface TownView {
  root: THREE.Group;
  update(t: number, dt: number): void;
  /** 影を切り替える（品質設定）。 */
  setShadows(on: boolean): void;
}

export function buildTown(layout: TownLayout, assets: Assets): TownView {
  const root = new THREE.Group();
  root.name = 'town';
  const animators: ((t: number, dt: number) => void)[] = [];
  const shadowMeshes: THREE.Mesh[] = [];

  const matMain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const B = new Batch();

  // ------------------------------------------------------------ 地面
  const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0xd2e6d0, roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.08;
  far.receiveShadow = true;
  root.add(far);

  const asphaltMat = new THREE.MeshStandardMaterial({ color: ASPHALT, map: asphaltTexture(), roughness: 0.95 });
  asphaltMat.map!.repeat.set(30, 30);
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(2 * (ROAD_C[4] + ROAD_HALF), 2 * (ROAD_C[4] + ROAD_HALF)), asphaltMat);
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = 0.0;
  asphalt.receiveShadow = true;
  root.add(asphalt);

  // 外周の芝（道路の外側）
  const edge = ROAD_C[4] + ROAD_HALF;
  B.box(0, 0, -(edge + 13.5), 2 * 150, 0.1, 27, 0xcfe8c4, 0, false);
  B.box(0, 0, edge + 13.5, 2 * 150, 0.1, 27, 0xcfe8c4, 0, false);
  B.box(-(edge + 13.5), 0, 0, 27, 0.1, 2 * edge, 0xcfe8c4, 0, false);
  B.box(edge + 13.5, 0, 0, 27, 0.1, 2 * edge, 0xcfe8c4, 0, false);
  // 外周の生垣
  const hedge = 0x93c79a;
  B.box(0, 0, -147.5, 300, 2.2, 3, hedge, 0, true);
  B.box(0, 0, 147.5, 300, 2.2, 3, hedge, 0, true);
  B.box(-147.5, 0, 0, 3, 2.2, 300, hedge, 0, true);
  B.box(147.5, 0, 0, 3, 2.2, 300, hedge, 0, true);

  // ブロックの歩道スラブ
  for (let ix = 0; ix < N_BLOCKS; ix++) {
    for (let iz = 0; iz < N_BLOCKS; iz++) {
      const cx = blockCenter(ix);
      const cz = blockCenter(iz);
      B.box(cx, 0, cz, 2 * SLAB_HALF, 0.16, 2 * SLAB_HALF, CURB, 0, true);
      B.plane(cx, 0.161, cz, 2 * SLAB_HALF - 0.5, 2 * SLAB_HALF - 0.5, SIDEWALK);
    }
  }

  // ------------------------------------------------------------ 道路標示
  const lineY = 0.012;
  // 中央線（破線）
  for (const r of ROAD_C) {
    for (let k = 0; k < N_ROADS - 1; k++) {
      const a = ROAD_C[k] + ROAD_HALF + 1;
      const b = ROAD_C[k + 1] - ROAD_HALF - 1;
      for (let u = a; u + 3 <= b; u += 6) {
        B.box(r, lineY, u + 1.5, 0.16, 0.01, 3, WHITE, 0, false);
        B.box(u + 1.5, lineY, r, 3, 0.01, 0.16, WHITE, 0, false);
      }
    }
  }
  // 横断歩道と停止線
  for (let i = 0; i < N_ROADS; i++) {
    for (let j = 0; j < N_ROADS; j++) {
      const nx = ROAD_C[i];
      const nz = ROAD_C[j];
      const legs: [number, number][] = [];
      if (i < N_ROADS - 1) legs.push([1, 0]);
      if (i > 0) legs.push([-1, 0]);
      if (j < N_ROADS - 1) legs.push([0, 1]);
      if (j > 0) legs.push([0, -1]);
      for (const [dx, dz] of legs) {
        // ゼブラ: 道路方向に長い縞を、道路幅方向に並べる
        for (let k = -3; k <= 3; k++) {
          const along = 5.25;
          const across = k * 1.0;
          const px = nx + dx * along + (dz !== 0 ? across : 0);
          const pz = nz + dz * along + (dx !== 0 ? across : 0);
          B.box(px, lineY, pz, dx !== 0 ? 3.2 : 0.5, 0.01, dz !== 0 ? 3.2 : 0.5, WHITE, 0, false);
        }
        // 停止線: この脚から交差点へ入る車線（左側通行）
        const lx = -dz; // 進行方向 (-dx,-dz) の左 = (-dz, dx)
        const lz = dx;
        const sx = nx + dx * 7.6 + lx * LANE_OFF * -1;
        const sz = nz + dz * 7.6 + lz * LANE_OFF * -1;
        // 左側通行: 進行方向 d' = (-dx,-dz) の左 = (d'z, -d'x) = (-dz, dx)
        const px = nx + dx * 7.6 + (-dz) * LANE_OFF;
        const pz = nz + dz * 7.6 + dx * LANE_OFF;
        void sx; void sz;
        B.box(px, lineY, pz, dx !== 0 ? 0.35 : 3.1, 0.01, dz !== 0 ? 0.35 : 3.1, WHITE, 0, false);
      }
    }
  }
  void CARRIAGE_HALF;

  // ------------------------------------------------------------ 建物
  const kenney = new THREE.Group();
  kenney.name = 'kenney-buildings';
  root.add(kenney);
  const signMeshes: THREE.Mesh[] = [];
  for (const b of layout.buildings) {
    if (b.model) {
      const src = assets.buildings.get(b.model);
      if (!src) continue;
      const o = src.clone(true);
      o.scale.setScalar(b.scale ?? 1);
      o.rotation.y = b.rotY ?? 0;
      o.position.set(b.x, 0, b.z);
      kenney.add(o);
    } else if (b.shop) {
      buildShop(b, B, root, animators, signMeshes);
    } else {
      buildPlainBuilding(b, B);
    }
  }

  // ------------------------------------------------------------ 小物
  for (const p of layout.props) buildProp(p, B, root, animators);

  // ------------------------------------------------------------ 特別区画
  for (const z of layout.zones) {
    if (z.kind === 'plaza') buildPlaza(z.x, z.z, B, root, animators);
    if (z.kind === 'construction') buildConstruction(z.x, z.z, B, root, animators);
    if (z.kind === 'alley') buildAlleyGround(z.x, z.z, B);
  }

  // 街灯の光だまり（昼間でもうっすら）はなし。コンビニの照明パネル
  for (const l of layout.lights) {
    if (l.intensity >= 0.9) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
      m.position.set(l.x, l.y, l.z);
      root.add(m);
    }
  }

  const batched = B.build(matMain, true);
  root.add(batched);
  batched.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) shadowMeshes.push(o as THREE.Mesh);
  });
  kenney.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) shadowMeshes.push(o as THREE.Mesh);
  });

  return {
    root,
    update(t, dt) {
      for (const a of animators) a(t, dt);
    },
    setShadows(on) {
      for (const m of shadowMeshes) m.castShadow = on;
    },
  };
}

// ---------------------------------------------------------------------------

function buildPlainBuilding(b: BuildingSpec, B: Batch): void {
  B.box(b.x, 0, b.z, b.w, b.h, b.d, b.color, 0, true);
  B.box(b.x, b.h, b.z, b.w + 0.3, 0.4, b.d + 0.3, b.roofColor, 0, false);
}

function glassMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x86a9b8, roughness: 0.12, metalness: 0.2 });
}

function buildShop(b: BuildingSpec, B: Batch, root: THREE.Group, animators: ((t: number, dt: number) => void)[], signs: THREE.Mesh[]): void {
  const kind = b.shop as ShopKind;
  const f = b.face!;
  const tx = -f.z;
  const tz = f.x;
  const rotY = Math.atan2(f.x, f.z); // 局所 +z が正面
  const frontW = f.x !== 0 ? b.d : b.w;
  const depth = f.x !== 0 ? b.w : b.d;
  const fx = b.x + f.x * (f.x !== 0 ? b.w / 2 : 0);
  const fz = b.z + f.z * (f.z !== 0 ? b.d / 2 : 0);
  // 局所座標 (u: 横, n: 正面方向) → ワールド
  const W = (u: number, y: number, n: number): [number, number, number] => [fx + tx * u + f.x * n, y, fz + tz * u + f.z * n];

  const style: Record<ShopKind, { awn: [number, number]; sign: [string, number, number, string]; trim: number }> = {
    bakery: { awn: [0xf2a6a6, 0xfff7ef], sign: ['パン屋', 0xf6c89f, 0x7a4a2b, 'BOULANGERIE'], trim: 0xf3b58a },
    coffee: { awn: [0x7fb69a, 0xf5f1e6], sign: ['喫茶店', 0x5d4a3c, 0xf3e6d2, 'COFFEE'], trim: 0x8a6b55 },
    yakitori: { awn: [0xc94b3f, 0x3b2a26], sign: ['焼き鳥', 0x2f2522, 0xf6d18a, 'やきとり'], trim: 0x6b3a2f },
    fruit: { awn: [0xf7c35f, 0xfff8e1], sign: ['果物屋', 0xa6d96a, 0x2f5a1f, 'FRUITS'], trim: 0xe8d98a },
    convenience: { awn: [0x4a90d9, 0x4cb582], sign: ['コンビニ', 0xffffff, 0x2d6fb6, '24H'], trim: 0xe8eef4 },
    cold: { awn: [0xa6c9e8, 0xe8f2fb], sign: ['冷凍倉庫', 0x6fa7d6, 0xffffff, '-25C'], trim: 0xb9d4ea },
    kakigori: { awn: [0xbfe6f2, 0xffffff], sign: ['かき氷', 0xcdeefa, 0x2d86a8, 'KAKIGORI'], trim: 0x9ed7ea },
  };
  const st = style[kind];

  // 本体
  B.box(b.x, 0, b.z, b.w, b.h, b.d, b.color, 0, true);
  B.box(b.x, b.h, b.z, b.w + 0.4, 0.45, b.d + 0.4, st.trim, 0, false);
  // 帯（看板の下地）
  const bandY = kind === 'kakigori' ? 2.7 : 3.5;
  const bw = frontW + 0.2;
  const [bx, , bz] = W(0, 0, 0.12);
  B.box(bx, bandY, bz, f.x !== 0 ? 0.3 : bw, 0.5, f.z !== 0 ? 0.3 : bw, st.trim, 0, false);

  // ショーウィンドウとドア
  const glass = new THREE.Mesh(new THREE.BoxGeometry(f.x !== 0 ? 0.2 : frontW * 0.72, 2.3, f.z !== 0 ? 0.2 : frontW * 0.72), glassMat());
  const [gx, gy, gz] = W(-frontW * 0.0, 1.5, 0.08);
  glass.position.set(gx, gy, gz);
  root.add(glass);
  const [dx, , dz] = W(frontW * 0.3, 0, 0.16);
  B.box(dx, 0.1, dz, f.x !== 0 ? 0.2 : 1.5, 2.3, f.z !== 0 ? 0.2 : 1.5, st.trim, 0, false);

  // 上階の窓（Kenney 風に明るい窓帯）
  if (b.h > 5 && kind !== 'cold') {
    for (let k = 0; k < Math.floor(frontW / 3.2); k++) {
      const u = -frontW / 2 + 1.8 + k * 3.2;
      const [wx, , wz] = W(u, 0, 0.06);
      const gm = new THREE.Mesh(new THREE.BoxGeometry(f.x !== 0 ? 0.12 : 1.9, 1.6, f.z !== 0 ? 0.12 : 1.9), glassMat());
      gm.position.set(wx, b.h > 7 ? 5.7 : 5.2, wz);
      root.add(gm);
    }
  }

  // 日よけ
  const awnTex = awningTexture(st.awn[0], st.awn[1]);
  awnTex.repeat.set(Math.max(2, Math.round(frontW / 2)), 1);
  const awn = new THREE.Mesh(new THREE.BoxGeometry(frontW * 0.88, 0.12, 1.8), new THREE.MeshStandardMaterial({ map: awnTex, roughness: 0.8 }));
  const [ax, , az] = W(0, 0, 0.9);
  awn.position.set(ax, 3.0, az);
  awn.rotation.y = rotY;
  awn.rotation.x = 0; // 傾けは局所 x 軸だが回転順の都合で位置のみで表現
  awn.castShadow = true;
  root.add(awn);

  // 看板
  const sg = st.sign;
  const signTex = signTexture(sg[0], sg[1], sg[2], sg[3]);
  const sw = Math.min(frontW * 0.8, 7.5);
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.3125), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.12 }));
  const [sx2, , sz2] = W(0, 0, 0.3);
  signMesh.position.set(sx2, bandY + 1.35, sz2);
  signMesh.rotation.y = rotY;
  root.add(signMesh);
  signs.push(signMesh);
  // 看板の裏板
  const backing = new THREE.Mesh(new THREE.BoxGeometry(f.x !== 0 ? 0.2 : sw + 0.3, sw * 0.3125 + 0.3, f.z !== 0 ? 0.2 : sw + 0.3), new THREE.MeshStandardMaterial({ color: st.trim, roughness: 0.8 }));
  const [kx, , kz] = W(0, 0, 0.18);
  backing.position.set(kx, bandY + 1.35, kz);
  root.add(backing);

  // 店ごとの特徴
  switch (kind) {
    case 'bakery': {
      const [cx, , cz] = W(-frontW * 0.25, 0, -depth * 0.3);
      B.box(cx, b.h, cz, 1.0, 2.2, 1.0, 0xc9a58a, 0, false);
      const [rx, , rz] = W(frontW * 0.2, 0, -1);
      B.sphere(rx, b.h + 1.1, rz, 1.7, 0.9, 1.1, 0xe3a857, 14, false); // 屋根のパン
      B.sphere(rx, b.h + 1.7, rz, 0.9, 0.3, 0.6, 0xf2c97d, 12, false);
      break;
    }
    case 'coffee': {
      const [rx, , rz] = W(frontW * 0.25, 0, -1);
      B.cyl(rx, b.h, rz, 1.1, 0.8, 1.6, 0xf5f1e6, 16, false); // 屋根のカップ
      B.cyl(rx, b.h + 1.55, rz, 0.95, 0.95, 0.12, 0x6b4a36, 16, false);
      B.add(new THREE.TorusGeometry(0.5, 0.12, 6, 14), rx + tx * 1.2, b.h + 0.9, rz + tz * 1.2, 1, 1, 1, rotY + Math.PI / 2, 0xf5f1e6, false);
      break;
    }
    case 'yakitori': {
      for (let k = -1; k <= 1; k++) {
        const [nx, , nz] = W(k * 1.3, 0, 0.2);
        B.box(nx, 2.1, nz, f.x !== 0 ? 0.1 : 1.1, 0.9, f.z !== 0 ? 0.1 : 1.1, 0xc94b3f, 0, false); // のれん
      }
      const [cx, , cz] = W(-frontW * 0.3, 0, -depth * 0.25);
      B.box(cx, b.h, cz, 1.0, 3.4, 1.0, 0x6e6a66, 0, false);
      // 煙
      const n = 36;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let i = 0; i < n; i++) seed[i] = Math.random();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ map: glowSpriteTexture(), size: 2.6, transparent: true, opacity: 0.38, depthWrite: false, color: 0xe4e4e8, sizeAttenuation: true });
      const smoke = new THREE.Points(geo, mat);
      smoke.frustumCulled = false;
      root.add(smoke);
      const base = new THREE.Vector3(cx, b.h + 3.4, cz);
      animators.push((t) => {
        for (let i = 0; i < n; i++) {
          const ph = (t * 0.12 + seed[i]) % 1;
          pos[i * 3] = base.x + Math.sin(ph * 6 + seed[i] * 9) * (0.4 + ph * 2.2) + ph * 2.0;
          pos[i * 3 + 1] = base.y + ph * 14;
          pos[i * 3 + 2] = base.z + Math.cos(ph * 5 + seed[i] * 7) * (0.4 + ph * 2.0);
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = 0.34;
      });
      break;
    }
    case 'fruit': {
      for (let k = 0; k < 3; k++) {
        const [rx, , rz] = W(-4 + k * 4, 0, -1);
        B.sphere(rx, b.h + 0.8, rz, 0.8, 0.8, 0.8, [0xf26d6d, 0xf7c35f, 0xa6d96a][k], 12, false);
        B.cyl(rx, b.h + 1.5, rz, 0.04, 0.06, 0.4, 0x6a4a2f, 6, false);
      }
      break;
    }
    case 'convenience': {
      for (const [k, c] of [[0, 0xffffff], [1, 0x2d6fb6], [2, 0x4cb582]] as const) {
        const [nx, , nz] = W(0, 0, 0.14);
        B.box(nx, bandY - 0.35 - k * 0.18, nz, f.x !== 0 ? 0.12 : bw, 0.18, f.z !== 0 ? 0.12 : bw, c, 0, false);
      }
      break;
    }
    case 'cold': {
      for (let k = 0; k < 4; k++) {
        const [rx, , rz] = W(-6 + k * 4, 0, -4);
        B.cyl(rx, b.h, rz, 1.4, 1.4, 1.1, 0xcfd8e0, 16, false);
        B.cyl(rx, b.h + 1.1, rz, 1.1, 1.1, 0.06, 0x6c7886, 16, false);
      }
      for (let k = 0; k < 2; k++) {
        const [sx, , sz] = W(-5 + k * 6, 0, 0.12);
        B.box(sx, 0.2, sz, f.x !== 0 ? 0.2 : 3.4, 3.0, f.z !== 0 ? 0.2 : 3.4, 0xb4c4d2, 0, false); // 搬入口のシャッター
      }
      break;
    }
    case 'kakigori': {
      const [rx, , rz] = W(0, 0, -1.2);
      B.cyl(rx, b.h, rz, 0.0, 1.9, 1.3, 0xffffff, 16, false); // 屋根のかき氷
      B.sphere(rx, b.h + 1.3, rz, 0.9, 0.6, 0.9, 0xf9a8c4, 14, false);
      B.sphere(rx, b.h + 1.7, rz, 0.55, 0.4, 0.55, 0xa8e0f5, 12, false);
      break;
    }
  }
  void animators;
}

// ---------------------------------------------------------------------------

function buildProp(p: PropSpec, B: Batch, root: THREE.Group, animators: ((t: number, dt: number) => void)[]): void {
  const s = p.scale;
  const rnd = (n: number) => ((Math.sin(p.x * 12.9898 + p.z * 78.233 + n * 37.719) * 43758.5453) % 1 + 1) % 1;
  switch (p.kind) {
    case 'tree': {
      const blossom = rnd(1) < 0.14;
      const g = blossom ? BLOSSOM : TREE_GREENS[Math.floor(rnd(2) * TREE_GREENS.length)];
      B.cyl(p.x, 0.16, p.z, 0.14 * s, 0.2 * s, 2.4 * s, 0xa88563, 7, true);
      B.ico(p.x, 3.3 * s, p.z, 1.55 * s, g, 0.9, rnd(3) * 3);
      B.ico(p.x + 0.7 * s, 2.7 * s, p.z + 0.2 * s, 1.0 * s, g, 0.9, rnd(4) * 3);
      B.ico(p.x - 0.5 * s, 2.9 * s, p.z - 0.6 * s, 1.05 * s, blossom ? 0xf9d4df : TREE_GREENS[(Math.floor(rnd(5) * 4) + 1) % 4], 0.9, rnd(6) * 3);
      break;
    }
    case 'lamp': {
      B.cyl(p.x, 0.16, p.z, 0.07, 0.1, 4.8, 0x707986, 8, true);
      B.box(p.x, 4.9, p.z, 0.9, 0.08, 0.14, 0x707986, p.rot, false);
      B.sphere(p.x + Math.cos(p.rot) * 0.4, 4.85, p.z - Math.sin(p.rot) * 0.4, 0.22, 0.12, 0.22, 0xfff3cf, 10, false);
      break;
    }
    case 'bench': {
      const c = Math.cos(p.rot);
      const sn = Math.sin(p.rot);
      const at = (u: number, n: number): [number, number] => [p.x + c * u + sn * n, p.z - sn * u + c * n];
      const [x0, z0] = at(0, 0);
      B.box(x0, 0.45, z0, 1.8, 0.08, 0.5, 0xcda97d, p.rot, true);
      const [x1, z1] = at(0, -0.22);
      B.box(x1, 0.55, z1, 1.8, 0.4, 0.07, 0xcda97d, p.rot, true);
      for (const u of [-0.75, 0.75]) {
        const [lx, lz] = at(u, 0);
        B.box(lx, 0.16, lz, 0.08, 0.3, 0.45, 0x5d6672, p.rot, true);
      }
      break;
    }
    case 'bin': {
      const cols = [0x8bc6a0, 0x8fb4de, 0xb9bfc7, 0xe6c07a];
      B.cyl(p.x, 0.16, p.z, 0.3 * s, 0.27 * s, 0.9 * s, cols[Math.floor(rnd(1) * 4)], 10, true);
      B.cyl(p.x, 0.16 + 0.9 * s, p.z, 0.32 * s, 0.32 * s, 0.07, 0x6e7681, 10, false);
      break;
    }
    case 'bags': {
      B.sphere(p.x, 0.16 + 0.28 * s, p.z, 0.36 * s, 0.3 * s, 0.34 * s, rnd(1) < 0.5 ? 0xe8efe8 : 0xcfe5d3, 9, true);
      B.sphere(p.x + 0.3 * s, 0.16 + 0.2 * s, p.z + 0.2 * s, 0.25 * s, 0.2 * s, 0.25 * s, 0xf0f0e6, 8, true);
      break;
    }
    case 'bike': {
      const c = Math.cos(p.rot);
      const sn = Math.sin(p.rot);
      const at = (u: number): [number, number] => [p.x + c * u, p.z - sn * u];
      for (const u of [-0.55, 0.55]) {
        const [wx, wz] = at(u);
        B.add(new THREE.TorusGeometry(0.33, 0.03, 5, 14), wx, 0.5, wz, 1, 1, 1, p.rot, 0x4a4f57, true);
      }
      const [fx, fz] = at(0);
      B.box(fx, 0.62, fz, 1.1, 0.05, 0.05, rnd(1) < 0.5 ? 0xe8836e : 0x6ea8d9, p.rot, false);
      B.box(fx, 0.9, fz, 0.05, 0.4, 0.05, 0x4a4f57, p.rot, false);
      const [hx, hz] = at(0.55);
      B.box(hx, 0.98, hz, 0.05, 0.05, 0.5, 0x4a4f57, p.rot, false);
      break;
    }
    case 'crate': {
      B.box(p.x, 0.16, p.z, 0.9, 0.35, 0.7, 0xd8b98c, p.rot, true);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * 6.28;
        const r = 0.18 + (k % 2) * 0.1;
        B.sphere(p.x + Math.cos(a) * r, 0.58, p.z + Math.sin(a) * r * 0.8, 0.13, 0.13, 0.13, p.color || 0xf26d6d, 8, false);
      }
      break;
    }
    case 'parasol': {
      B.cyl(p.x, 0.16, p.z, 0.04, 0.05, 2.3, 0xe6e6e6, 6, true);
      B.cyl(p.x, 2.2, p.z, 0.03, 1.4 * s, 0.5, p.color || 0xf4b6b6, 12, false);
      break;
    }
    case 'table': {
      B.cyl(p.x, 0.16, p.z, 0.05, 0.05, 0.62, 0x6e7681, 6, true);
      B.cyl(p.x, 0.77, p.z, 0.42, 0.42, 0.05, 0xf3efe6, 14, false);
      for (const d of [-1, 1]) B.box(p.x + d * 0.7, 0.16, p.z, 0.35, 0.45, 0.35, 0xcda97d, 0, true);
      break;
    }
    case 'sign': {
      B.box(p.x, 0.16, p.z, 0.6, 1.0, 0.05, 0xfdfbf4, p.rot, true);
      B.box(p.x, 0.75, p.z, 0.48, 0.28, 0.06, p.x * 7 % 2 > 1 ? 0xf29a8e : 0x9ac6e8, p.rot, false);
      break;
    }
    case 'container': {
      B.box(p.x, 0.0, p.z, 6, 2.6, 2.4, p.color || 0xf4b183, p.rot, true);
      break;
    }
    case 'sand': {
      B.sphere(p.x, 0.0, p.z, 1.8 * s, 1.2 * s, 1.8 * s, 0xe6d3a3, 10, true);
      break;
    }
    case 'column': {
      B.box(p.x, 0.0, p.z, 0.6, 10, 0.6, 0xc4c6c8, 0, true);
      break;
    }
    case 'hvac': {
      B.box(p.x, 0.16, p.z, 1.1 * s, 1.1 * s, 0.7 * s, 0xd0d5da, p.rot, true);
      B.cyl(p.x, 0.16 + 1.1 * s, p.z, 0.3 * s, 0.3 * s, 0.05, 0x59616c, 12, false);
      break;
    }
    case 'cone': {
      B.cyl(p.x, 0.16, p.z, 0.02, 0.22, 0.65, 0xf28b3d, 8, true);
      B.cyl(p.x, 0.16, p.z, 0.3, 0.3, 0.04, 0xf28b3d, 8, false);
      break;
    }
    case 'barrier': {
      B.box(p.x, 0.5, p.z, 2.0, 0.22, 0.12, 0xf2f2f2, p.rot, false);
      B.box(p.x - 0.5, 0.5, p.z, 0.5, 0.22, 0.13, 0xe85a4f, p.rot, false);
      B.box(p.x + 0.5, 0.5, p.z, 0.5, 0.22, 0.13, 0xe85a4f, p.rot, false);
      B.box(p.x - 0.9, 0.16, p.z, 0.08, 0.9, 0.3, 0x6e7681, p.rot, true);
      B.box(p.x + 0.9, 0.16, p.z, 0.08, 0.9, 0.3, 0x6e7681, p.rot, true);
      break;
    }
    case 'grill': {
      B.box(p.x, 0.16, p.z, 1.6, 0.9, 0.8, 0x4a4540, p.rot, true);
      B.box(p.x, 1.06, p.z, 1.45, 0.06, 0.6, 0xff9a52, p.rot, false);
      break;
    }
    case 'lantern': {
      B.sphere(p.x, 2.6, p.z, 0.28, 0.4, 0.28, 0xe85a4f, 10, false);
      B.cyl(p.x, 3.0, p.z, 0.02, 0.02, 0.4, 0x3b2a26, 4, false);
      break;
    }
    case 'fence': {
      const len = p.len ?? 4;
      const along = Math.abs(Math.cos(p.rot)) > 0.5;
      const sx = along ? len : 0.18;
      const sz = along ? 0.18 : len;
      B.box(p.x, 0.0, p.z, sx, 2.0, sz, 0xb7c7d6, 0, true);
      B.box(p.x, 1.8, p.z, along ? len : 0.26, 0.2, along ? 0.26 : len, 0xf2c14e, 0, false);
      break;
    }
    case 'planter': {
      B.cyl(p.x, 0.16, p.z, 0.42, 0.36, 0.55, 0xf5f1e8, 12, true);
      B.ico(p.x, 0.95, p.z, 0.42, 0x9ed49f, 0.8);
      for (let k = 0; k < 4; k++) B.sphere(p.x + Math.cos(k * 1.6) * 0.3, 1.15, p.z + Math.sin(k * 1.6) * 0.3, 0.1, 0.1, 0.1, [0xf59ab4, 0xf7d36b, 0xffffff, 0xc9b3f0][k], 6, false);
      break;
    }
    case 'crane': {
      const mast = 0xf2c14e;
      for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) B.box(p.x + dx, 0.0, p.z + dz, 0.16, 34, 0.16, mast, 0, true);
      for (let h = 1; h < 34; h += 3) {
        B.box(p.x, h, p.z - 0.5, 1.1, 0.12, 0.1, mast, 0, false);
        B.box(p.x, h, p.z + 0.5, 1.1, 0.12, 0.1, mast, 0, false);
      }
      B.box(p.x, 34, p.z, 1.4, 1.6, 1.4, 0xe4e6e8, 0, false);
      // 旋回する腕
      const jib = new THREE.Group();
      jib.position.set(p.x, 35.8, p.z);
      const mm = new THREE.MeshStandardMaterial({ color: mast, roughness: 0.7 });
      const boom = new THREE.Mesh(new THREE.BoxGeometry(26, 0.7, 0.7), mm);
      boom.position.x = 9;
      const counter = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 0.6), mm);
      counter.position.x = -8;
      const weight = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.4), new THREE.MeshStandardMaterial({ color: 0x9aa3ad }));
      weight.position.x = -10.5;
      weight.position.y = -0.6;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xf5f5f0 }));
      cab.position.set(1.6, -1.0, 0.9);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 12, 4), new THREE.MeshStandardMaterial({ color: 0x40464e }));
      hook.position.set(17, -6, 0);
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xe85a4f }));
      block.position.set(17, -12, 0);
      jib.add(boom, counter, weight, cab, hook, block);
      for (const m of [boom, counter, weight, cab, block]) m.castShadow = true;
      root.add(jib);
      animators.push((t) => {
        jib.rotation.y = 0.8 + Math.sin(t * 0.07) * 0.9;
      });
      break;
    }
    case 'fountain':
      break; // buildPlaza で作る
  }
}

// ---------------------------------------------------------------------------

function buildPlaza(cx: number, cz: number, B: Batch, root: THREE.Group, animators: ((t: number, dt: number) => void)[]): void {
  const n = 15;
  const tile = (2 * (BLOCK_HALF - 0.5)) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = (i + j) % 2 ? 0xf0e8dc : 0xe4ddd0;
      B.plane(cx - BLOCK_HALF + 0.5 + tile * (i + 0.5), 0.17, cz - BLOCK_HALF + 0.5 + tile * (j + 0.5), tile - 0.04, tile - 0.04, c);
    }
  }
  // 噴水
  B.cyl(cx, 0.16, cz, 5.0, 5.2, 0.6, 0xf3efe7, 36, true);
  B.cyl(cx, 0.16, cz, 4.5, 4.5, 0.62, 0xe2ddd2, 36, false);
  B.cyl(cx, 0.16, cz, 0.7, 1.0, 1.5, 0xf3efe7, 18, true);
  B.cyl(cx, 1.6, cz, 2.0, 0.6, 0.35, 0xf3efe7, 24, true);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(4.45, 4.45, 0.05, 40),
    new THREE.MeshStandardMaterial({ color: 0x9fd6ee, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }),
  );
  water.position.set(cx, 0.62, cz);
  water.receiveShadow = true;
  root.add(water);
  const jet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.22, 1, 10, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xcdeefa, transparent: true, opacity: 0.6, roughness: 0.1 }),
  );
  jet.position.set(cx, 3.4, cz);
  root.add(jet);
  const rings: THREE.Mesh[] = [];
  for (let k = 0; k < 3; k++) {
    const r = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    r.rotation.x = -Math.PI / 2;
    r.position.set(cx, 0.66, cz);
    root.add(r);
    rings.push(r);
  }
  animators.push((t) => {
    const h = 2.4 + Math.sin(t * 2.1) * 0.25;
    jet.scale.set(1 + Math.sin(t * 5) * 0.05, h, 1 + Math.sin(t * 5) * 0.05);
    jet.position.y = 1.9 + h / 2;
    rings.forEach((r, k) => {
      const ph = (t * 0.35 + k / 3) % 1;
      r.scale.setScalar(0.6 + ph * 3.8);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - ph);
    });
  });
}

function buildConstruction(cx: number, cz: number, B: Batch, root: THREE.Group, animators: ((t: number, dt: number) => void)[]): void {
  void root; void animators;
  B.plane(cx, 0.17, cz, 37.6, 37.6, 0xcdb99b);
  // 土の盛り上がり
  for (let k = 0; k < 6; k++) B.plane(cx - 14 + k * 5, 0.175, cz + 14, 3, 2, 0xb8a284, k * 0.4);
  // 柱の間の床スラブ（2 階分）
  B.box(cx, 3.4, cz - 2, 21, 0.4, 14, 0xd9dadc, 0, false);
  B.box(cx, 6.8, cz - 5, 21, 0.4, 8, 0xd9dadc, 0, false);
  // 手すり
  B.box(cx, 7.2, cz + -1.1, 21, 0.9, 0.06, 0xf2c14e, 0, false);
  // 鉄骨の梁
  for (const gx of [-9, -3, 3, 9]) B.box(cx + gx, 9.9, cz - 2, 0.35, 0.4, 14, 0x8c96a1, 0, false);
}

function buildAlleyGround(cx: number, cz: number, B: Batch): void {
  // しめった汚れ。路地の中央に濃い緑灰
  B.plane(cx, 0.18, cz, 43, 4.6, 0xb4bfb4);
  for (let k = 0; k < 9; k++) {
    B.plane(cx - 18 + k * 4.4, 0.185, cz + Math.sin(k * 2.3) * 1.2, 2.4, 1.4, 0x98a69b, k);
  }
  void FACADE;
}
