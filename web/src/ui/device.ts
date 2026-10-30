/**
 * 端末ごとの性能プロファイル。スマートフォン（タッチ + 小さい画面）と低スペック機（論理コア 4 以下）を自動で見分ける。
 * 設定タブの「性能」で上書きでき、選択は localStorage に保存する（再読み込みで反映）。URL の ?perf=phone|full|auto でも指定できる。
 * 数値は設計値。実機（iPhone）での fps は未測定。
 */
export type PerfPref = 'auto' | 'phone' | 'full';
export type ProfileName = 'phone' | 'low' | 'full';

export interface Profile {
  name: ProfileName;
  /** スマートフォン向けのレイアウトと操作を使う（画面幅が 768 px 未満のときは CSS 側でも切り替わる）。 */
  touch: boolean;
  /** devicePixelRatio の上限（描画）。 */
  dprCap: number;
  /** 影の解像度（0 で影なし）。 */
  shadowMap: number;
  flies: number;
  npcs: number;
  cars: number;
  /** 脳 Worker の数。 */
  workers: number;
  cores: number;
  reason: string;
}

const KEY = 'flytown.perf';

export function loadPerfPref(): PerfPref {
  try {
    const q = new URLSearchParams(location.search).get('perf');
    if (q === 'phone' || q === 'full' || q === 'auto') return q;
    const v = localStorage.getItem(KEY);
    if (v === 'phone' || v === 'full' || v === 'auto') return v;
  } catch { /* ストレージが使えなくても動く */ }
  return 'auto';
}

export function savePerfPref(p: PerfPref): void {
  try { localStorage.setItem(KEY, p); } catch { /* 無視 */ }
}

/** 論理コア数から Worker の数を決める。描画とメインスレッドに 2 コア残し、1 Worker に 2 体まで。 */
export function workerCount(flies: number, cores: number): number {
  const spare = Math.max(1, Math.floor((cores - 2) / 2));
  return Math.max(1, Math.min(Math.ceil(flies / 2), 3, spare));
}

export function detectProfile(pref: PerfPref = loadPerfPref()): Profile {
  const cores = Math.max(1, navigator.hardwareConcurrency || 4);
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* 無視 */ }
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || coarse;
  const shortSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  const smallScreen = shortSide < 600; // iPhone の短辺は 320〜440。iPad mini は 744
  const autoPhone = touch && smallScreen;
  const lowCores = cores <= 4;

  let name: ProfileName;
  let reason: string;
  if (pref === 'phone') { name = 'phone'; reason = 'setting=phone'; }
  else if (pref === 'full') { name = 'full'; reason = 'setting=full'; }
  else if (autoPhone) { name = 'phone'; reason = `auto: touch=${touch} short=${shortSide}px`; }
  else if (lowCores) { name = 'low'; reason = `auto: cores=${cores}`; }
  else { name = 'full'; reason = `auto: touch=${touch} short=${shortSide}px cores=${cores}`; }

  const mk = (flies: number, npcs: number, cars: number, dprCap: number, shadowMap: number): Profile => ({
    name, touch: name === 'phone' ? true : touch && smallScreen, dprCap, shadowMap, flies, npcs, cars,
    workers: workerCount(flies, cores), cores, reason,
  });
  if (name === 'phone') return mk(3, 8, 8, 1.5, 1024);
  if (name === 'low') return mk(4, 14, 12, 2, 1024);
  return mk(4, 20, 15, 2, 2048);
}
