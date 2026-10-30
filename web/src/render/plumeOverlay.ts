/** 匂いの濃さを地面に薄く重ねて見せる（設定で切替）。 */
import * as THREE from 'three';
import { GN } from '../sim/field.ts';
import type { TownField } from '../sim/field.ts';
import { TOWN_HALF } from '../sim/world.ts';

// vinegar, fruit, geosmin, co2（GRID_ODORS の順）
const COL = [[255, 170, 40], [255, 90, 140], [60, 200, 90], [120, 130, 150]] as const;

export class PlumeOverlay {
  readonly mesh: THREE.Mesh;
  private data = new Uint8Array(GN * GN * 4);
  private tex: THREE.DataTexture;
  private lastT = -1;
  private field: TownField;

  constructor(field: TownField) {
    this.field = field;
    this.tex = new THREE.DataTexture(this.data, GN, GN, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * TOWN_HALF, 2 * TOWN_HALF), m);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.12;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  setVisible(on: boolean): void {
    this.mesh.visible = on;
    this.lastT = -1;
  }

  update(): void {
    if (!this.mesh.visible || this.field.simTime === this.lastT) return;
    this.lastT = this.field.simTime;
    const g = this.field.grid;
    const d = this.data;
    for (let j = 0; j < GN; j++) {
      const row = (GN - 1 - j) * GN;
      for (let i = 0; i < GN; i++) {
        const k = j * GN + i;
        let r = 0, gg = 0, b = 0, s = 0;
        for (let c = 0; c < 4; c++) {
          const v = g[c][k];
          if (v <= 0.02) continue;
          r += COL[c][0] * v; gg += COL[c][1] * v; b += COL[c][2] * v; s += v;
        }
        const o = (row + i) * 4;
        if (s <= 0) { d[o + 3] = 0; continue; }
        d[o] = r / s; d[o + 1] = gg / s; d[o + 2] = b / s;
        d[o + 3] = Math.min(110, s * 120);
      }
    }
    this.tex.needsUpdate = true;
  }
}
