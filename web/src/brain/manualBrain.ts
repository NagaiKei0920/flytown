import type { BodyCommand, BrainAgent } from './types.ts';
import type { SensorFrame } from '../sim/sensors.ts';

/**
 * DEV 専用: キーボードで 1 人のハエ人を操作する開発用の脳。
 * 自動で判断はしない。押されたキーを BodyCommand に写すだけ。
 * W/S 前進・後退、A/D 左・右旋回、Space 羽ばたき、G 身繕い、F 摂食。
 */
export class ManualBrain implements BrainAgent {
  readonly id = 'dev-manual';
  readonly label = 'DEV: キーボード操作';
  private keys = new Set<string>();
  private down = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const k = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyG', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      this.keys.add(k);
      e.preventDefault();
    }
  };
  private up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private blur = () => this.keys.clear();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.down);
      window.addEventListener('keyup', this.up);
      window.addEventListener('blur', this.blur);
    }
  }

  /** テスト用: キー状態を直接与える。 */
  setKeys(codes: string[]): void {
    this.keys = new Set(codes);
  }

  step(_sensors: SensorFrame, _dtMs: number): BodyCommand {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const turn = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    return {
      forward: fwd,
      turn,
      flap: k.has('Space') ? 1 : 0,
      groom: k.has('KeyG') ? 1 : 0,
      feed: k.has('KeyF') ? 1 : 0,
    };
  }

  reset(): void {
    this.keys.clear();
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.down);
      window.removeEventListener('keyup', this.up);
      window.removeEventListener('blur', this.blur);
    }
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !t.tagName) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}
