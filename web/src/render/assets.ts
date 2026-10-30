/**
 * CC0 の 3D モデル（Kenney: City Kit Commercial / Car Kit、Quaternius: Ultimate Modular Men / Women）を読み込む。
 * 出典は public/models/CREDITS.md。ハエの頭・羽・店・小物・道路はコードで生成する。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeHuman } from './humanMerge.ts';
import { KENNEY_MID, KENNEY_SKY } from '../sim/world.ts';

const BASE = import.meta.env.BASE_URL + 'models/';
export const CAR_MODELS = ['sedan', 'suv', 'taxi', 'van', 'hatchback-sports', 'sedan-sports', 'suv-luxury', 'truck'];
export const CHAR_IDS = ['man-Suit', 'man-Casual', 'man-Worker', 'man-Punk', 'man-Casual2', 'man-Farmer', 'man-Beach', 'woman-Casual', 'woman-Formal', 'woman-Suit', 'woman-Worker'];

function prepare(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const isHuman = m.type === 'SkinnedMesh';
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const s = mat as THREE.MeshStandardMaterial;
      if (s.map) {
        s.map.magFilter = THREE.NearestFilter;
        s.map.minFilter = THREE.NearestFilter;
        s.map.generateMipmaps = false;
        s.map.needsUpdate = true;
      }
      s.roughness = isHuman ? (s.name === 'Eye' ? 0.2 : 0.6) : 0.85;
      s.metalness = 0;
    }
  });
}

export interface Assets {
  buildings: Map<string, THREE.Object3D>;
  cars: { obj: THREE.Object3D; length: number }[];
  characters: THREE.Object3D[];
}

export async function loadAssets(onProgress?: (done: number, total: number) => void): Promise<Assets> {
  const loader = new GLTFLoader();
  const jobs: { kind: 'b' | 'c' | 'h'; name: string; url: string }[] = [];
  for (const b of [...KENNEY_MID, ...KENNEY_SKY]) jobs.push({ kind: 'b', name: b.name, url: `${BASE}commercial/${b.name}.glb` });
  for (const c of CAR_MODELS) jobs.push({ kind: 'c', name: c, url: `${BASE}cars/${c}.glb` });
  for (const h of CHAR_IDS) jobs.push({ kind: 'h', name: h, url: `${BASE}humans/${h}.glb` });
  let done = 0;
  const results = await Promise.all(
    jobs.map(async (j) => {
      const g = await loader.loadAsync(j.url);
      if (j.kind === 'h') mergeHuman(g.scene);
      prepare(g.scene);
      done++;
      onProgress?.(done, jobs.length);
      return { j, scene: g.scene };
    }),
  );
  const assets: Assets = { buildings: new Map(), cars: [], characters: [] };
  for (const r of results) {
    if (r.j.kind === 'b') assets.buildings.set(r.j.name, r.scene);
    else if (r.j.kind === 'c') {
      // 長さ 4.3 m に正規化し、底面を y=0、中心を原点に揃える（前方は +z）
      const box = new THREE.Box3().setFromObject(r.scene);
      const size = box.getSize(new THREE.Vector3());
      const s = 4.3 / size.z;
      const wrap = new THREE.Group();
      r.scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      const inner = new THREE.Group();
      inner.add(r.scene);
      inner.scale.setScalar(s);
      wrap.add(inner);
      assets.cars.push({ obj: wrap, length: 4.3 });
    }
  }
  assets.characters = CHAR_IDS.map((h) => results.find((r) => r.j.kind === 'h' && r.j.name === h)!.scene);
  return assets;
}
