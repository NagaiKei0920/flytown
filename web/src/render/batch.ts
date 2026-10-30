import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CHUNK = 75;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** 頂点色つきの静的ジオメトリを空間チャンクごとに結合する。足元ほど暗くして簡易 AO にする。 */
export class Batch {
  private chunks = new Map<string, THREE.BufferGeometry[]>();

  add(g: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number, color: number, ao = true, rotX = 0, rotZ = 0): void {
    _p.set(x, y, z);
    if (rotX !== 0 || rotZ !== 0) _q.setFromEuler(_e.set(rotX, rotY, rotZ));
    else _q.setFromAxisAngle(UP, rotY);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    g.deleteAttribute('uv');
    if (!g.index) g = mergeVertices(g);
    g.applyMatrix4(_m);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    _c.set(color);
    for (let i = 0; i < pos.count; i++) {
      const yy = pos.getY(i);
      let f = 1;
      if (ao) {
        const t = Math.max(0, Math.min(1, yy / 4));
        f = 0.74 + 0.26 * t * t * (3 - 2 * t);
      }
      col[i * 3] = _c.r * f;
      col[i * 3 + 1] = _c.g * f;
      col[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const key = `${Math.floor((x + 150) / CHUNK)},${Math.floor((z + 150) / CHUNK)}`;
    let arr = this.chunks.get(key);
    if (!arr) this.chunks.set(key, (arr = []));
    arr.push(g);
  }

  /** y0 は底面の高さ。 */
  box(x: number, y0: number, z: number, sx: number, sh: number, sz: number, color: number, rotY = 0, ao = true): void {
    this.add(new THREE.BoxGeometry(1, 1, 1), x, y0 + sh / 2, z, sx, sh, sz, rotY, color, ao);
  }
  cyl(x: number, y0: number, z: number, rTop: number, rBot: number, h: number, color: number, seg = 10, ao = true): void {
    this.add(new THREE.CylinderGeometry(rTop, rBot, 1, seg), x, y0 + h / 2, z, 1, h, 1, 0, color, ao);
  }
  sphere(x: number, y: number, z: number, rx: number, ry: number, rz: number, color: number, seg = 10, ao = true): void {
    this.add(new THREE.SphereGeometry(1, seg, Math.max(5, seg - 3)), x, y, z, rx, ry, rz, 0, color, ao);
  }
  ico(x: number, y: number, z: number, r: number, color: number, sy = 1, rot = 0): void {
    this.add(new THREE.IcosahedronGeometry(1, 1), x, y, z, r, r * sy, r, rot, color, true);
  }
  /** 地面の板（y は上面の高さ）。 */
  plane(x: number, y: number, z: number, sx: number, sz: number, color: number, rotY = 0): void {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.add(g, x, y, z, sx, 1, sz, rotY, color, false);
  }

  build(material: THREE.Material, shadows = true): THREE.Group {
    const group = new THREE.Group();
    for (const arr of this.chunks.values()) {
      const merged = mergeGeometries(arr, false);
      for (const g of arr) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.chunks.clear();
    return group;
  }
}
