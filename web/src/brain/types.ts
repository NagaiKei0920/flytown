/**
 * 脳と体の境界。
 * 体は BodyCommand だけで動く。脳は SensorFrame だけを読む。
 * ハエ人の行動を決めるのは BrainAgent の出力だけで、シミュレーション側に判断ロジックは置かない。
 */
import type { SensorFrame } from '../sim/sensors.ts';

export interface BodyCommand {
  /** 前進速度。-1..1。負は後ろ歩き（ムーンウォーク）。 */
  forward: number;
  /** 旋回。-1..1。正が左（上から見て反時計回り）。 */
  turn: number;
  /** 羽ばたき。0..1。連続 3 秒まで。超えると強制的に着地して、羽ばたきを一度離すまで再開できない。 */
  flap: number;
  /** 身繕い。0..1。両手をこすり合わせる、頭をなでる。 */
  groom: number;
  /** 摂食。0..1。前かがみになり口吻が伸びる。 */
  feed: number;
}

export const ZERO_COMMAND: Readonly<BodyCommand> = Object.freeze({
  forward: 0,
  turn: 0,
  flap: 0,
  groom: 0,
  feed: 0,
});

export function clampCommand(c: BodyCommand): BodyCommand {
  const f = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
  return {
    forward: f(c.forward, -1, 1),
    turn: f(c.turn, -1, 1),
    flap: f(c.flap, 0, 1),
    groom: f(c.groom, 0, 1),
    feed: f(c.feed, 0, 1),
  };
}

/** 脳パネルが読む任意のデバッグ情報。M2 で拡張する。 */
export interface BrainDebug {
  /** 区分名 → 0..1 の発火の強さ。 */
  activity?: Record<string, number>;
  note?: string;
  /** 脳ごとの詳細（ConnectomeBrain: rates, dopamine, z, preference, lagTicks）。 */
  extra?: Record<string, unknown>;
}

export interface BrainAgent {
  readonly id: string;
  /** UI に出す名前。開発用の脳には "DEV" を含める。 */
  readonly label: string;
  /**
   * 1 tick（既定 20 ms）に 1 回呼ばれる。
   * 重い計算は Web Worker に逃がし、直近の結果を返してよい（同期的に返せない場合）。
   */
  step(sensors: SensorFrame, dtMs: number): BodyCommand;
  reset(): void;
  /** 脳パネル用。 */
  getDebug?(): BrainDebug;
  dispose?(): void;
}
