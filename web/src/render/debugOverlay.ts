/** センサのレイを 3D 表示する（選択中のハエ人）。 */
import * as THREE from 'three';
import type { FlyPerson } from '../sim/flyperson.ts';
import { FLY } from '../sim/flyperson.ts';
import { HitKind, SENSOR_SPEC } from '../sim/sensors.ts';

export class SensorOverlay {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;

  constructor() {
    const n = SENSOR_SPEC.raysPerEye * 2;
    this.pos = new Float32Array(n * 6);
    this.col = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 20;
    this.lines.visible = false;
  }

  update(f: FlyPerson | null, x: number, y: number, z: number): void {
    const s = f?.sensors;
    if (!f || !s) { this.lines.visible = false; return; }
    const ey = y + FLY.eyeHeight;
    const ex = x + Math.sin(f.yaw) * 0.1;
    const ez = z + Math.cos(f.yaw) * 0.1;
    let k = 0;
    const c = new THREE.Color();
    for (const eye of [s.left, s.right]) {
      eye.rays.forEach((r, i) => {
        const ang = f.yaw + r.azimuth;
        const slope = Math.tan((SENSOR_SPEC.pitchDeg[i % 2] * Math.PI) / 180);
        const t = r.distance;
        const o = k * 6;
        this.pos[o] = ex; this.pos[o + 1] = ey; this.pos[o + 2] = ez;
        this.pos[o + 3] = ex + Math.sin(ang) * t;
        this.pos[o + 4] = ey + slope * t;
        this.pos[o + 5] = ez + Math.cos(ang) * t;
        if (r.kind === HitKind.None) c.setRGB(0.55, 0.6, 0.65);
        else c.setHSL(0.38 - Math.min(0.38, r.looming * 0.9 + (1 - t / SENSOR_SPEC.maxRange) * 0.12), 0.8, 0.5);
        for (let v = 0; v < 2; v++) {
          this.col[o + v * 3] = c.r; this.col[o + v * 3 + 1] = c.g; this.col[o + v * 3 + 2] = c.b;
        }
        k++;
      });
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
    this.lines.visible = true;
  }
}
