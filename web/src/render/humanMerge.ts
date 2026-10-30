/**
 * 人型モデルの SkinnedMesh（素材ごと・部位ごとに 10 個以上）を、頭とそれ以外の 2 つに統合する。
 * 素材はどれも単色なので、色を頂点カラーに焼いて素材を 1 つにする。
 * 1 人あたりの描画命令が約 12 から 2 になる（NPC 20 人 + ハエ人 4 人で約 250 命令の削減）。
 */
import * as THREE from 'three';

const humanMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });

export function mergeHuman(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (skinned.length === 0) return;
  const ref = skinned[0];
  const skeleton = ref.skeleton;
  const refInv = ref.matrixWorld.clone().invert();
  const A = new THREE.Matrix4();
  const index = new Map<string, number>();
  skeleton.bones.forEach((b, i) => index.set(b.name, i));

  const build = (list: THREE.SkinnedMesh[], name: string): THREE.SkinnedMesh | null => {
    if (list.length === 0) return null;
    let total = 0;
    let idx = 0;
    for (const m of list) {
      total += m.geometry.attributes.position.count;
      idx += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const sIdx = new Uint16Array(total * 4);
    const sW = new Float32Array(total * 4);
    const ind = new Uint32Array(idx);
    let vo = 0;
    let io = 0;
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (const m of list) {
      const g = m.geometry;
      const n = g.attributes.position.count;
      const color = ((m.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1));
      A.multiplyMatrices(refInv, m.matrixWorld);
      nm.getNormalMatrix(A);
      // この mesh の骨番号 -> 統合後の骨番号
      const remap = m.skeleton.bones.map((b) => index.get(b.name) ?? 0);
      const si = g.attributes.skinIndex;
      const sw = g.attributes.skinWeight;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(A);
        pos.set([v.x, v.y, v.z], (vo + i) * 3);
        v.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize();
        nor.set([v.x, v.y, v.z], (vo + i) * 3);
        col.set([color.r, color.g, color.b], (vo + i) * 3);
        for (let k = 0; k < 4; k++) {
          sIdx[(vo + i) * 4 + k] = remap[si.getComponent(i, k)];
          sW[(vo + i) * 4 + k] = sw.getComponent(i, k);
        }
      }
      if (g.index) {
        for (let i = 0; i < g.index.count; i++) ind[io + i] = g.index.getX(i) + vo;
        io += g.index.count;
      } else {
        for (let i = 0; i < n; i++) ind[io + i] = vo + i;
        io += n;
      }
      vo += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sW, 4));
    geo.setIndex(new THREE.BufferAttribute(ind, 1));
    const mesh = new THREE.SkinnedMesh(geo, humanMaterial);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  };

  const head = skinned.filter((m) => /_Head/.test(m.name));
  const body = skinned.filter((m) => !/_Head/.test(m.name));
  const mh = build(head, 'Human_Head');
  const mb = build(body, 'Human_Body');
  const parent = ref.parent!;
  const local = ref.matrix.clone();
  const bindMatrix = ref.bindMatrix.clone();
  for (const m of skinned) m.removeFromParent();
  for (const m of [mb, mh]) {
    if (!m) continue;
    m.applyMatrix4(local);
    parent.add(m);
    m.updateMatrixWorld(true);
    m.bind(skeleton, bindMatrix);
  }
}
