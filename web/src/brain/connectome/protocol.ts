/** メインスレッドと脳 Worker の間のメッセージ。 */
import type { DopamineKind } from './batch.ts';

export type ToWorker =
  | { t: 'init'; baseUrl: string; n: number; seed: number }
  | {
      t: 'ticks';
      /** 送るシミュレーション tick 番号（昇順）。 */
      ticks: number[];
      /** ticks.length * n * STIM_LEN の刺激量。 */
      stim: Float32Array;
      /** ticks.length * n。0 のエージェントはその tick は進めない（手動操作中・転倒中など）。 */
      active: Uint8Array;
    }
  | { t: 'inject'; agent: number; kind: DopamineKind; dose: 1 | 2 | 3; durationMs: number }
  | { t: 'reset'; agent: number };

export interface BrainLayout {
  outLen: number;
  cmd: number;
  backward: number;
  escape: number;
  z: number;
  panel: number;
  da: number;
  pref: number;
  prefChange: number;
  recNames: string[];
  panelNames: string[];
  probeChannels: string[];
}

export type FromWorker =
  | { t: 'ready'; layout: BrainLayout; loadMs: number; warmMs: number }
  | { t: 'result'; lastTick: number; ticksDone: number; out: Float32Array; procMs: number }
  | { t: 'error'; message: string };
