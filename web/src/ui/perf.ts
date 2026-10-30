/** fps とフレーム時間。5 秒ごとにコンソールへ 1 行出す（検証側が読む）。 */
import type * as THREE from 'three';

export class Perf {
  private frames = 0;
  private acc = 0;
  private times: number[] = [];
  private simMs = 0;
  private lastLog = performance.now();
  fps = 0;
  avgMs = 0;
  p95Ms = 0;
  maxMs = 0;
  draws = 0;
  tris = 0;
  onUpdate: (() => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private info: () => Record<string, number>;

  constructor(renderer: THREE.WebGLRenderer, info: () => Record<string, number>) {
    this.renderer = renderer;
    this.info = info;
  }

  frame(dtMs: number, simMs: number): void {
    this.frames++;
    this.acc += dtMs;
    this.simMs += simMs;
    this.times.push(dtMs);
    const now = performance.now();
    if (this.acc >= 1000) {
      this.fps = (this.frames * 1000) / this.acc;
      this.avgMs = this.acc / this.frames;
      const sorted = [...this.times].sort((a, b) => a - b);
      this.p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      this.maxMs = sorted[sorted.length - 1];
      const ri = this.renderer.info.render;
      this.draws = ri.calls;
      this.tris = ri.triangles;
      this.onUpdate?.();
      this.frames = 0;
      this.acc = 0;
      this.times = [];
      this.simMs = 0;
    }
    if (now - this.lastLog >= 5000) {
      this.lastLog = now;
      const extra = this.info();
      console.log(
        `[flytown:perf] fps=${this.fps.toFixed(1)} avg_ms=${this.avgMs.toFixed(2)} p95_ms=${this.p95Ms.toFixed(2)} max_ms=${this.maxMs.toFixed(1)} draws=${this.draws} tris=${this.tris} ` +
          Object.entries(extra).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(2) : v}`).join(' '),
      );
    }
  }
}
