/** UI。下にツールバー、その上にツールのカード、右に脳パネルと設定タブ、左上に fps とハエ人の選択。 */
import type { FlyPerson } from '../sim/flyperson.ts';
import type { ItemKind } from '../sim/items.ts';
import { ITEM_DEFS } from '../sim/items.ts';
import type { DopamineKind } from '../brain/connectome/batch.ts';
import type { ModeId, RunResult, RunStats } from '../sim/modes.ts';
import { MODE_IDS, MODE_LIMIT, loadBest, splitZapScore } from '../sim/modes.ts';
import type { Key, Lang } from './i18n.ts';
import { getLang, setLang, t } from './i18n.ts';
import type { PerfPref, ProfileName } from './device.ts';

export interface UiInit { perf: PerfPref; profile: ProfileName; hiRes: boolean }

export type Tool = 'none' | 'syringe' | 'place' | 'mode';

export interface UiHandlers {
  onSelect(i: number): void;
  onTimeScale(s: number): void;
  onEye(on: boolean): void;
  onShadows(on: boolean): void;
  onHiRes(on: boolean): void;
  onPerf(p: PerfPref): void;
  onDebug(on: boolean): void;
  onManual(on: boolean): void;
  onTool(t: Tool): void;
  onPlaceKind(k: ItemKind): void;
  onPlaceMode(m: 'add' | 'remove'): void;
  onPlaceRot(deg: number): void;
  onWind(dirDeg: number, speed: number): void;
  onInject(kind: DopamineKind, dose: 1 | 2 | 3): void;
  onPlume(on: boolean): void;
  onModeStart(mode: ModeId, flyIdx: number): void;
  onModeCancel(): void;
  onLang(l: Lang): void;
}

/** 脳パネルに渡す、選択中のハエ人の脳の状態。 */
export interface BrainView {
  activity: Record<string, number>;
  pam: number;
  ppl1: number;
  /** 注射で変わった好み（暖機直後の基準からの変化、-1..+1）。 */
  pref: Record<string, number>;
  /** 好みの生の探り値。デバッグ表示（センサ欄）だけに使う。 */
  prefRaw?: Record<string, number>;
}

const SVG = {
  flag: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  syringe: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2l4 4M20 4l-3 3M14.5 5.5l4 4-8.5 8.5-4-4zM6 14l-3 3 4 4 3-3M10 11l3 3M3 21l3-3"/></svg>',
  place: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.6-6-10.5a6 6 0 0112 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};

const BAR_KEYS: Key[] = ['cmd.forward', 'cmd.turn', 'cmd.flap', 'cmd.groom', 'cmd.feed'];
const CLASS_KEYS: [string, Key][] = [['sensory', 'region.sensory'], ['MB', 'region.MB'], ['LH', 'region.LH'], ['CX', 'region.CX'], ['DN', 'region.DN']];
const PREF_KEYS: [string, Key][] = [['vinegar', 'pref.vinegar'], ['fruit', 'pref.fruit'], ['geosmin', 'pref.geosmin'], ['co2', 'pref.co2'], ['cva', 'pref.cva']];
const DA_FULL = 4.5;
const HIST = 300;

const KIND_KEY: Record<DopamineKind, Key> = { reward: 'syringe.reward', punish: 'syringe.punish', all: 'syringe.all' };

export class Ui {
  private root: HTMLElement;
  private fpsEl!: HTMLElement;
  private chips: HTMLButtonElement[] = [];
  private toast!: HTMLElement;
  private toastTimer = 0;
  private cmdBars: HTMLElement[] = [];
  private classBars = new Map<string, HTMLElement>();
  private pamBar!: HTMLElement;
  private pplBar!: HTMLElement;
  private pamVal!: HTMLElement;
  private pplVal!: HTMLElement;
  private spark!: HTMLCanvasElement;
  private prefRows = new Map<string, { bar: HTMLElement; val: HTMLElement }>();
  private statsEl!: HTMLElement;
  private sensEl!: HTMLElement;
  private selEl!: HTMLElement;
  private devBadge!: HTMLElement;
  private panel!: HTMLElement;
  private eyeBtn!: HTMLButtonElement;
  private accEl!: HTMLElement;
  private loading!: HTMLElement;
  private card!: HTMLElement;
  private syringeCard!: HTMLElement;
  private placeCard!: HTMLElement;
  private injectBtn!: HTMLButtonElement;
  private compass!: SVGElement;
  private compassArrow!: SVGElement;
  private windSlider!: HTMLInputElement;
  private windVal!: HTMLElement;
  private rotBtn!: HTMLButtonElement;
  private toolBtns!: NodeListOf<HTMLButtonElement>;
  private modeCard!: HTMLElement;
  private runEl!: HTMLElement;
  private resEl!: HTMLElement;
  private pickMode: ModeId | 'free' = 'free';
  private pickFly = 0;
  private running = false;
  private lastRes: RunResult | null = null;
  private lastRun: { stats: RunStats; mode: ModeId } | null = null;

  private flies: FlyPerson[];
  private init: UiInit;
  private h: UiHandlers;
  private sheetSummary!: HTMLElement;
  private tool: Tool = 'none';
  private kind: DopamineKind = 'reward';
  private dose: 1 | 2 | 3 = 2;
  private placeKind: ItemKind = 'garbage';
  private rotDeg = 0;
  private sel = -1;
  private windDeg = 90;
  private windSpeed = 0.5;
  /** 画面の上向きの世界方向（水平、単位ベクトル）。 */
  private viewF = { x: -0.7071, z: -0.7071 };
  private histPam: number[] = [];
  private histPpl: number[] = [];

  constructor(parent: HTMLElement, flies: FlyPerson[], init: UiInit, h: UiHandlers) {
    this.init = init;
    this.flies = flies;
    this.h = h;
    this.root = document.createElement('div');
    this.root.className = 'ui';
    this.root.innerHTML = `
      <div class="loading"><div class="loading-t">FLYTOWN</div><div class="loading-s" data-i18n="loading.ready"></div></div>
      <div class="hud">
        <div class="brand">FLYTOWN</div>
        <div class="chips"></div>
        <div class="fps"></div>
        <div class="acc"></div>
      </div>
      <div class="dev" hidden></div>
      <div class="run glass" hidden>
        <b class="run-t"></b><span class="run-time"></span><span class="run-info"></span>
        <button class="run-stop" data-run-stop data-i18n="mode.cancel"></button>
      </div>
      <div class="result glass" hidden>
        <div class="res-t"></div>
        <div class="res-mode"></div>
        <div class="res-score"></div>
        <div class="res-formula"></div>
        <div class="res-best"></div>
        <div class="res-btns"><button class="primary" data-res-retry data-i18n="mode.retry"></button><button class="ghost" data-res-close data-i18n="mode.close"></button></div>
      </div>
      <div class="toast" hidden></div>
      <div class="card glass" hidden>
        <div class="card-syringe" hidden>
          <div class="row seg" data-group="kind">
            <button data-kind="reward" class="on" data-i18n="syringe.reward"></button><button data-kind="punish" data-i18n="syringe.punish"></button><button data-kind="all" data-i18n="syringe.all"></button>
          </div>
          <div class="row"><span class="lbl" data-i18n="syringe.dose"></span>
            <div class="seg" data-group="dose"><button data-dose="1">1</button><button data-dose="2" class="on">2</button><button data-dose="3">3</button></div>
          </div>
          <button class="primary" data-inject disabled></button>
        </div>
        <div class="card-place" hidden>
          <div class="row seg" data-group="mode"><button data-mode="add" class="on" data-i18n="place.add"></button><button data-mode="remove" data-i18n="place.remove"></button></div>
          <div class="items"></div>
          <div class="row rot" hidden><span class="lbl" data-i18n="place.rot"></span><button class="rotbtn" data-rot></button></div>
          <div class="row wind">
            <svg class="compass" viewBox="0 0 56 56" width="56" height="56">
              <circle cx="28" cy="28" r="25" fill="rgba(0,0,0,0.05)" stroke="rgba(0,0,0,0.18)"/>
              <text class="cup" x="28" y="11" text-anchor="middle" font-size="8" fill="currentColor" opacity="0.6"></text>
              <g class="arrow"><path d="M28 28V9M28 7l-5 8h10z" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="currentColor"/></g>
            </svg>
            <div class="wslide"><span class="lbl" data-i18n="place.wind"></span><input type="range" min="0" max="5" step="0.1" value="0.5" data-wind /><span class="wv"></span></div>
          </div>
        </div>
        <div class="card-mode" hidden>
          <div class="row seg modepick"></div>
          <p class="note mode-desc"></p>
          <div class="row modefly"><span class="lbl" data-i18n="mode.fly"></span><div class="mflies"></div></div>
          <div class="row mbest"></div>
          <button class="primary" data-mode-start data-i18n="mode.start"></button>
        </div>
      </div>
      <nav class="toolbar glass">
        <button data-act="syringe">${SVG.syringe}<span data-i18n="tool.syringe"></span></button>
        <button data-act="place">${SVG.place}<span data-i18n="tool.place"></span></button>
        <button data-act="mode">${SVG.flag}<span data-i18n="tool.mode"></span></button>
        <i class="sep"></i>
        <div class="seg" role="group" data-i18n-aria="time">
          <button data-time="0">0x</button><button data-time="1" class="on">1x</button><button data-time="4">4x</button>
        </div>
        <i class="sep"></i>
        <button data-act="eye">${SVG.eye}<span data-i18n="tool.eye"></span></button>
      </nav>
      <div class="sheet-clip"><aside class="panel glass">
        <div class="sheet-handle" role="button" tabindex="0" data-i18n-aria="sheet.toggle"><i class="grip"></i><span class="sheet-sum"></span></div>
        <div class="panel-body">
        <div class="tabs"><button data-tab="brain" class="on" data-i18n="tab.brain"></button><button data-tab="settings" data-i18n="tab.settings"></button></div>
        <section data-pane="brain">
          <div class="sel"></div>
          <h4 data-i18n="h.regions"></h4>
          <div class="cls"></div>
          <h4 data-i18n="h.dopamine"></h4>
          <div class="da">
            <div class="bar wide"><span>PAM</span><div><b class="pam"></b></div><em class="pamv">0.0</em></div>
            <div class="bar wide"><span>PPL1</span><div><b class="ppl"></b></div><em class="pplv">0.0</em></div>
            <canvas class="spark" width="520" height="64"></canvas>
          </div>
          <h4 data-i18n="h.commands"></h4>
          <div class="bars"></div>
          <h4 data-i18n="h.prefs"></h4>
          <div class="prefs"></div>
          <h4 data-i18n="h.stats"></h4>
          <div class="stats"></div>
          <details class="sensd"><summary data-i18n="sensors"></summary><pre class="sens"></pre></details>
        </section>
        <section data-pane="settings" hidden>
          <div class="row langrow"><span class="lbl" data-i18n="set.language"></span>
            <div class="seg" data-group="lang"><button data-lang="ja">日本語</button><button data-lang="en">English</button></div>
          </div>
          <div class="row langrow"><span class="lbl" data-i18n="set.perf"></span>
            <div class="seg" data-group="perf"><button data-perf="auto" data-i18n="perf.auto"></button><button data-perf="phone" data-i18n="perf.phone"></button><button data-perf="full" data-i18n="perf.full"></button></div>
          </div>
          <p class="note perf-note"></p>
          <label><input type="checkbox" data-set="shadows" checked /> <span data-i18n="set.shadows"></span></label>
          <label><input type="checkbox" data-set="hires" ${init.hiRes ? 'checked' : ''} /> <span data-i18n="set.hires"></span></label>
          <label><input type="checkbox" data-set="debug" /> <span data-i18n="set.debug"></span></label>
          <label><input type="checkbox" data-set="plume" /> <span data-i18n="set.plume"></span></label>
          <label><input type="checkbox" data-set="manual" /> <span data-i18n="set.manual"></span></label>
          <p class="note" data-i18n="set.manualNote"></p>
        </section>
        </div>
      </aside></div>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.fpsEl = q('.fps');
    this.accEl = q('.acc');
    this.toast = q('.toast');
    this.sensEl = q('.sens');
    this.selEl = q('.sel');
    this.devBadge = q('.dev');
    this.panel = q('.panel');
    this.sheetSummary = q('.sheet-sum');
    this.loading = q('.loading');
    this.eyeBtn = q('[data-act="eye"]');
    this.card = q('.card');
    this.syringeCard = q('.card-syringe');
    this.placeCard = q('.card-place');
    this.injectBtn = q('[data-inject]');
    this.statsEl = q('.stats');
    this.spark = q('.spark');
    this.pamBar = q('.pam');
    this.pplBar = q('.ppl');
    this.pamVal = q('.pamv');
    this.pplVal = q('.pplv');
    this.compass = q('.compass') as unknown as SVGElement;
    this.compassArrow = q('.compass .arrow') as unknown as SVGElement;
    this.windSlider = q('[data-wind]');
    this.windVal = q('.wv');
    this.rotBtn = q('[data-rot]');
    this.toolBtns = this.root.querySelectorAll<HTMLButtonElement>('.toolbar [data-act="syringe"], .toolbar [data-act="place"], .toolbar [data-act="mode"]');
    this.modeCard = q('.card-mode');
    this.runEl = q('.run');
    this.resEl = q('.result');

    const chipBox = q('.chips');
    flies.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.style.setProperty('--c', '#' + f.accent.toString(16).padStart(6, '0'));
      b.textContent = String(i + 1);
      b.dataset.fly = String(i);
      b.onclick = () => h.onSelect(i);
      chipBox.appendChild(b);
      this.chips.push(b);
    });
    const mkBar = (box: HTMLElement, label: Key): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'bar';
      row.innerHTML = `<span data-i18n="${label}"></span><div><b></b></div>`;
      box.appendChild(row);
      return row.querySelector('b') as HTMLElement;
    };
    const cls = q('.cls');
    for (const [k, l] of CLASS_KEYS) this.classBars.set(k, mkBar(cls, l));
    const bars = q('.bars');
    BAR_KEYS.forEach((l) => this.cmdBars.push(mkBar(bars, l)));
    const prefs = q('.prefs');
    for (const [k, l] of PREF_KEYS) {
      const row = document.createElement('div');
      row.className = 'pref';
      row.innerHTML = `<span data-i18n="${l}"></span><div class="pb"><b></b></div><em></em>`;
      prefs.appendChild(row);
      this.prefRows.set(k, { bar: row.querySelector('b') as HTMLElement, val: row.querySelector('em') as HTMLElement });
    }
    // 置くカードの品物
    const items = q('.items');
    for (const d of ITEM_DEFS) {
      const b = document.createElement('button');
      b.className = 'item' + (d.kind === this.placeKind ? ' on' : '');
      b.dataset.item = d.kind;
      b.dataset.i18n = `item.${d.kind}`;
      b.onclick = () => {
        this.placeKind = d.kind;
        items.querySelectorAll('.item').forEach((x) => x.classList.toggle('on', x === b));
        this.root.querySelector<HTMLElement>('.rot')!.hidden = !d.directional;
        h.onPlaceKind(d.kind);
        this.setPlaceMode('add');
      };
      items.appendChild(b);
    }

    this.root.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((b) => {
      b.onclick = () => {
        this.root.querySelectorAll('[data-time]').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        h.onTimeScale(Number(b.dataset.time));
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'syringe') this.setTool(this.tool === 'syringe' ? 'none' : 'syringe');
        else if (a === 'place') this.setTool(this.tool === 'place' ? 'none' : 'place');
        else if (a === 'mode') this.setTool(this.tool === 'mode' ? 'none' : 'mode');
        else if (a === 'eye') h.onEye(!b.classList.contains('on'));
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.onclick = () => {
        this.root.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
        this.root.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
      b.onclick = () => {
        setLang(b.dataset.lang as Lang);
        this.applyLang();
        h.onLang(b.dataset.lang as Lang);
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-perf]').forEach((b) => {
      b.onclick = () => { if (b.dataset.perf !== this.init.perf) h.onPerf(b.dataset.perf as PerfPref); };
    });
    this.initSheet();
    this.initModeCard();
    this.runEl.querySelector<HTMLButtonElement>('[data-run-stop]')!.onclick = () => h.onModeCancel();
    this.resEl.querySelector<HTMLButtonElement>('[data-res-retry]')!.onclick = () => {
      const r = this.lastRes;
      this.resEl.hidden = true;
      if (r) h.onModeStart(r.mode, r.flyIdx);
    };
    this.resEl.querySelector<HTMLButtonElement>('[data-res-close]')!.onclick = () => (this.resEl.hidden = true);
    this.root.querySelectorAll<HTMLInputElement>('[data-set]').forEach((c) => {
      c.onchange = () => {
        const k = c.dataset.set;
        if (k === 'shadows') h.onShadows(c.checked);
        if (k === 'hires') h.onHiRes(c.checked);
        if (k === 'debug') h.onDebug(c.checked);
        if (k === 'manual') h.onManual(c.checked);
        if (k === 'plume') h.onPlume(c.checked);
      };
    });
    // 注射器のカード
    this.root.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => {
      b.onclick = () => {
        this.kind = b.dataset.kind as DopamineKind;
        this.root.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
        this.updateInjectBtn();
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-dose]').forEach((b) => {
      b.onclick = () => {
        this.dose = Number(b.dataset.dose) as 1 | 2 | 3;
        this.root.querySelectorAll('[data-dose]').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    this.injectBtn.onclick = () => {
      if (this.sel < 0) return;
      h.onInject(this.kind, this.dose);
    };
    // 置くカード
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.onclick = () => this.setPlaceMode(b.dataset.mode as 'add' | 'remove');
    });
    this.rotBtn.onclick = () => {
      this.rotDeg = (this.rotDeg + 45) % 360;
      this.rotBtn.textContent = t('place.deg', { n: this.rotDeg });
      h.onPlaceRot(this.rotDeg);
    };
    this.windSlider.oninput = () => {
      this.windSpeed = Number(this.windSlider.value);
      this.drawWind();
      h.onWind(this.windDeg, this.windSpeed);
    };
    const dial = (e: PointerEvent) => {
      const r = this.compass.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < 3) return;
      const phi = Math.atan2(dx, -dy); // 画面の上から時計回り
      const f = this.viewF;
      const right = { x: -f.z, z: f.x };
      const wx = Math.sin(phi) * right.x + Math.cos(phi) * f.x;
      const wz = Math.sin(phi) * right.z + Math.cos(phi) * f.z;
      this.windDeg = ((Math.atan2(wx, -wz) * 180) / Math.PI + 360) % 360;
      this.drawWind();
      h.onWind(this.windDeg, this.windSpeed);
    };
    this.compass.addEventListener('pointerdown', (e) => { (e.target as Element).setPointerCapture?.(e.pointerId); dial(e as PointerEvent); (this.compass as unknown as { _d: boolean })._d = true; });
    this.compass.addEventListener('pointermove', (e) => { if ((this.compass as unknown as { _d: boolean })._d) dial(e as PointerEvent); });
    this.compass.addEventListener('pointerup', () => ((this.compass as unknown as { _d: boolean })._d = false));
    this.drawWind();
    this.applyLang();
  }

  // ------------------------------------------------------------ 脳パネル（スマートフォンでは下からのシート）

  private sheetOpen = false;

  /** ハンドルのタップで開閉、ドラッグで追従して近い方へ止まる。幅 768 px 以上では CSS がシートを使わない。 */
  private initSheet(): void {
    const handle = this.root.querySelector<HTMLElement>('.sheet-handle')!;
    const panel = this.panel;
    const closedOffset = (): number => Math.max(0, panel.offsetHeight - handle.offsetHeight);
    const apply = (open: boolean): void => {
      this.sheetOpen = open;
      panel.classList.toggle('open', open);
      panel.style.removeProperty('--sheet-drag');
    };
    let drag: { id: number; y0: number; base: number; moved: boolean; t0: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, y0: e.clientY, base: this.sheetOpen ? 0 : closedOffset(), moved: false, t0: performance.now() };
      panel.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0;
      if (Math.abs(dy) > 6) drag.moved = true;
      const off = Math.min(closedOffset(), Math.max(0, drag.base + dy));
      panel.style.setProperty('--sheet-drag', `${off}px`);
    });
    const end = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      panel.classList.remove('dragging');
      if (!d.moved) { apply(!this.sheetOpen); return; }
      const dy = e.clientY - d.y0;
      const v = dy / Math.max(1, performance.now() - d.t0); // px/ms
      const off = Math.min(closedOffset(), Math.max(0, d.base + dy));
      apply(Math.abs(v) > 0.4 ? v < 0 : off < closedOffset() / 2);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') apply(!this.sheetOpen); });
  }

  /** ツールのカードを開いたときなど、シートを閉じる。 */
  collapseSheet(): void {
    this.sheetOpen = false;
    this.panel.classList.remove('open');
  }

  // ------------------------------------------------------------ 言語

  /** data-i18n を持つ要素と、動的に作った文字列を、現在の言語で書き直す。 */
  applyLang(): void {
    this.root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n as Key)));
    this.root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((e) => e.setAttribute('aria-label', t(e.dataset.i18nAria as Key)));
    this.root.querySelectorAll<HTMLElement>('.cup').forEach((e) => (e.textContent = t('compass.up')));
    const lang = getLang();
    this.root.querySelectorAll<HTMLElement>('[data-perf]').forEach((e) => e.classList.toggle('on', e.dataset.perf === this.init.perf));
    const pn = this.root.querySelector<HTMLElement>('.perf-note');
    if (pn) pn.textContent = t('set.perfNote', { now: this.init.profile });
    this.root.querySelectorAll<HTMLElement>('[data-lang]').forEach((e) => e.classList.toggle('on', e.dataset.lang === lang));
    this.chips.forEach((c, i) => (c.title = this.flyName(i)));
    this.rotBtn.textContent = t('place.deg', { n: this.rotDeg });
    this.selEl.textContent = this.sel >= 0 ? this.flyName(this.sel) : t('select.hint');
    this.sheetSummary.textContent = this.selEl.textContent;
    this.updateInjectBtn();
    this.drawWind();
    this.renderModeCard();
    if (this.lastRes && !this.resEl.hidden) this.renderResult(this.lastRes);
  }

  flyName(i: number): string {
    return t('fly', { n: i + 1 });
  }

  // ------------------------------------------------------------ お題

  private initModeCard(): void {
    const pick = this.root.querySelector('.modepick') as HTMLElement;
    for (const m of ['free', ...MODE_IDS] as (ModeId | 'free')[]) {
      const b = document.createElement('button');
      b.dataset.pm = m;
      b.dataset.i18n = `mode.${m}`;
      b.onclick = () => {
        if (m === 'free') {
          if (this.running) this.h.onModeCancel();
          this.pickMode = 'free';
        } else {
          if (this.running) { this.showToast(t('mode.busy')); return; }
          this.pickMode = m;
        }
        this.renderModeCard();
      };
      pick.appendChild(b);
    }
    const box = this.root.querySelector('.mflies') as HTMLElement;
    this.flies.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = 'mfly';
      b.style.setProperty('--c', '#' + f.accent.toString(16).padStart(6, '0'));
      b.textContent = String(i + 1);
      b.onclick = () => { this.pickFly = i; this.renderModeCard(); };
      box.appendChild(b);
    });
    (this.root.querySelector('[data-mode-start]') as HTMLButtonElement).onclick = () => {
      if (this.pickMode === 'free' || this.running) return;
      this.h.onModeStart(this.pickMode, this.pickFly);
    };
  }

  /** ツールのカードを閉じる。 */
  closeTool(): void {
    this.setTool('none');
  }

  /** 選択中のハエ人があれば、お題の対象の初期値にする。 */
  private renderModeCard(): void {
    const m = this.pickMode;
    this.root.querySelectorAll<HTMLElement>('[data-pm]').forEach((e) => e.classList.toggle('on', e.dataset.pm === m));
    (this.root.querySelector('.mode-desc') as HTMLElement).textContent = t(`mode.desc.${m}` as Key);
    const isFree = m === 'free';
    (this.root.querySelector('.modefly') as HTMLElement).hidden = isFree;
    (this.root.querySelector('.mbest') as HTMLElement).hidden = isFree;
    (this.root.querySelector('[data-mode-start]') as HTMLElement).hidden = isFree;
    this.root.querySelectorAll<HTMLElement>('.mfly').forEach((e, i) => e.classList.toggle('on', i === this.pickFly));
    if (!isFree) (this.root.querySelector('.mbest') as HTMLElement).textContent = `${t('mode.best')}: ${this.bestText(m)}`;
  }

  private bestText(m: ModeId): string {
    const b = loadBest(m);
    if (b === null) return t('mode.none');
    if (m === 'zapper') {
      const z = splitZapScore(b);
      return t('res.formula.zapper', { z: z.zaps, n: z.nearSec.toFixed(1) });
    }
    return t('res.unit.sec', { n: b.toFixed(1) });
  }

  /** 実行中の表示。null で消す。 */
  setRun(mode: ModeId | null, stats: RunStats | null): void {
    this.running = mode !== null;
    this.runEl.hidden = mode === null;
    if (mode === null || !stats) return;
    this.lastRun = { stats, mode };
    this.resEl.hidden = true;
    const left = Math.max(0, MODE_LIMIT - stats.elapsed);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    (this.runEl.querySelector('.run-t') as HTMLElement).textContent = t(`mode.${mode}` as Key);
    (this.runEl.querySelector('.run-time') as HTMLElement).textContent = t('mode.left', { t: `${mm}:${String(ss).padStart(2, '0')}` });
    const info = mode === 'bakery' ? t('mode.inj', { n: stats.injections })
      : mode === 'road' ? t('mode.acc', { n: stats.accidents })
      : `${t('mode.zap', { n: stats.zaps })} / ${t('mode.near', { n: stats.nearSec.toFixed(0) })}`;
    (this.runEl.querySelector('.run-info') as HTMLElement).textContent = info;
  }

  showResult(r: RunResult): void {
    this.lastRes = r;
    this.runEl.hidden = true;
    this.running = false;
    this.renderResult(r);
    this.resEl.hidden = false;
    this.renderModeCard();
  }

  private renderResult(r: RunResult): void {
    const q = (s: string) => this.resEl.querySelector(s) as HTMLElement;
    q('.res-t').textContent = r.success ? t(r.mode === 'zapper' ? 'res.title.zapper' : 'res.title.success') : t('res.title.fail');
    q('.res-mode').textContent = `${t(`mode.${r.mode}` as Key)} / ${this.flyName(r.flyIdx)}`;
    let big = '-';
    let formula = '';
    if (r.mode === 'zapper') {
      big = t('res.unit.times', { n: r.zaps });
      formula = t('res.formula.zapper', { z: r.zaps, n: r.nearSec.toFixed(1) });
    } else if (r.success && r.score !== null) {
      big = t('res.unit.sec', { n: r.score.toFixed(1) });
      formula = r.mode === 'bakery'
        ? t('res.formula.bakery', { t: r.elapsed.toFixed(1), i: r.injections })
        : t('res.formula.road', { t: r.elapsed.toFixed(1), a: r.accidents });
    } else {
      formula = t('res.noscore');
    }
    q('.res-score').textContent = big;
    q('.res-formula').textContent = formula;
    q('.res-best').textContent = r.newBest ? t('res.new') : r.best !== null ? t('res.best', { v: this.bestText(r.mode) }) : '';
  }

  /** お題の対象に選ぶハエ人の既定値（選択中のハエ人）。 */
  setPickFly(i: number): void {
    if (i >= 0) { this.pickFly = i; this.renderModeCard(); }
  }

  // ------------------------------------------------------------ ツール

  private setTool(t: Tool): void {
    this.tool = t;
    this.toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.act === t));
    this.card.hidden = t === 'none';
    this.root.classList.toggle('card-open', t !== 'none');
    this.syringeCard.hidden = t !== 'syringe';
    this.placeCard.hidden = t !== 'place';
    this.modeCard.hidden = t !== 'mode';
    if (t === 'mode') this.renderModeCard();
    if (t !== 'none') this.collapseSheet();
    this.h.onTool(t);
    this.updateInjectBtn();
  }

  setPlaceMode(m: 'add' | 'remove'): void {
    this.root.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.mode === m));
    this.h.onPlaceMode(m);
  }

  private updateInjectBtn(): void {
    if (this.sel < 0) {
      this.injectBtn.disabled = true;
      this.injectBtn.textContent = t('syringe.pick');
    } else {
      this.injectBtn.disabled = false;
      this.injectBtn.textContent = t('syringe.go', { name: this.flyName(this.sel), kind: t(KIND_KEY[this.kind]) });
    }
  }

  // ------------------------------------------------------------ 風

  setWind(dirDeg: number, speed: number): void {
    this.windDeg = dirDeg;
    this.windSpeed = speed;
    this.windSlider.value = String(speed);
    this.drawWind();
  }

  /** 画面の上向きの世界方向（カメラの向き）。羅針盤の向きを画面に合わせる。 */
  setView(fx: number, fz: number): void {
    const l = Math.hypot(fx, fz) || 1;
    const nx = fx / l;
    const nz = fz / l;
    if (Math.abs(nx - this.viewF.x) + Math.abs(nz - this.viewF.z) > 0.01) {
      this.viewF = { x: nx, z: nz };
      this.drawWind();
    }
  }

  private drawWind(): void {
    const a = (this.windDeg * Math.PI) / 180;
    const w = { x: Math.sin(a), z: -Math.cos(a) };
    const f = this.viewF;
    const right = { x: -f.z, z: f.x };
    const phi = Math.atan2(w.x * right.x + w.z * right.z, w.x * f.x + w.z * f.z);
    const len = 0.35 + 0.65 * Math.min(1, this.windSpeed / 5);
    this.compassArrow.setAttribute('transform', `rotate(${(phi * 180) / Math.PI} 28 28) translate(28 28) scale(${len}) translate(-28 -28)`);
    this.compassArrow.style.opacity = this.windSpeed < 0.05 ? '0.25' : '1';
    this.windVal.textContent = `${this.windSpeed.toFixed(1)} m/s`;
  }

  // ------------------------------------------------------------ 表示

  hideLoading(): void {
    this.loading.classList.add('done');
    setTimeout(() => this.loading.remove(), 600);
  }
  setLoading(text: string): void {
    (this.loading.querySelector('.loading-s') as HTMLElement).textContent = text;
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 2600);
  }

  setEye(on: boolean): void {
    this.eyeBtn.classList.toggle('on', on);
  }

  setManual(on: boolean, name: string): void {
    this.devBadge.hidden = !on;
    this.devBadge.textContent = t('dev.badge', { name });
  }

  setPerf(fps: number, ms: number, draws: number, tris: number): void {
    this.fpsEl.textContent = t('fps', { fps: fps.toFixed(0), ms: ms.toFixed(1), draws, tris: (tris / 1000).toFixed(0) });
  }

  setSelected(i: number): void {
    this.sel = i;
    this.chips.forEach((c, k) => c.classList.toggle('on', k === i));
    this.selEl.textContent = i >= 0 ? this.flyName(i) : t('select.hint');
    this.sheetSummary.textContent = i >= 0 ? this.flyName(i) : t('select.hint');
    if (i >= 0 && !this.running) this.pickFly = i;
    this.histPam = [];
    this.histPpl = [];
    this.updateInjectBtn();
  }

  /** 約 10 Hz で呼ぶ。 */
  refresh(sel: number, accidents: number, bv: BrainView | null): void {
    this.accEl.textContent = t('accidents', { n: accidents });
    if (sel < 0) { this.sensEl.textContent = ''; this.statsEl.textContent = ''; return; }
    const f = this.flies[sel];
    const c = f.cmd;
    const vals = [(c.forward + 1) / 2, (c.turn + 1) / 2, c.flap, c.groom, c.feed];
    vals.forEach((v, i) => (this.cmdBars[i].style.width = `${Math.round(v * 100)}%`));
    this.sheetSummary.textContent = `${this.flyName(sel)}  ${t('sheet.fwd', { n: Math.round(vals[0] * 100) })}  ${t('sheet.flap', { n: Math.round(c.flap * 100) })}`;

    // 脳
    const act = bv?.activity ?? {};
    for (const [k, el] of this.classBars) el.style.width = `${Math.round((act[k] ?? 0) * 100)}%`;
    const pam = bv?.pam ?? 0;
    const ppl = bv?.ppl1 ?? 0;
    this.pamBar.style.width = `${Math.round(Math.min(1, pam / DA_FULL) * 100)}%`;
    this.pplBar.style.width = `${Math.round(Math.min(1, ppl / DA_FULL) * 100)}%`;
    this.pamVal.textContent = pam.toFixed(1);
    this.pplVal.textContent = ppl.toFixed(1);
    this.histPam.push(pam);
    this.histPpl.push(ppl);
    if (this.histPam.length > HIST) { this.histPam.shift(); this.histPpl.shift(); }
    this.drawSpark();

    // 注射で変わった好み（-1..+1。起動直後は 0）
    const pref = bv?.pref ?? {};
    for (const [k, row] of this.prefRows) {
      const v = pref[k];
      if (v === undefined) { row.val.textContent = '-'; row.bar.style.width = '0'; continue; }
      const z = Math.abs(v) < 0.005;
      row.val.textContent = z ? '0.00' : (v >= 0 ? '+' : '') + v.toFixed(2);
      const w = z ? 0 : Math.abs(v) * 50;
      row.bar.style.width = `${w}%`;
      row.bar.style.left = v >= 0 ? '50%' : `${50 - w}%`;
      row.bar.className = v >= 0 ? 'pos' : 'neg';
    }

    const s = f.stats;
    this.statsEl.innerHTML =
      `<span>${t('stat.distance')}</span><b>${s.distance.toFixed(0)} m</b><span>${t('stat.meals')}</span><b>${s.meals}</b>` +
      `<span>${t('stat.accidents')}</span><b>${f.accidents}</b><span>${t('stat.zaps')}</span><b>${s.zaps}</b><span>${t('stat.flaps')}</span><b>${s.flaps}</b>`;

    const se = f.sensors;
    if (!se) return;
    const n = (v: number) => v.toFixed(2).padStart(5);
    const fl = se.field.left;
    this.sensEl.textContent = [
      t('sens.looming', { l: n(se.left.loomingMax), r: n(se.right.loomingMax) }),
      t('sens.obstacle', { f: n(se.obstacle.front), l: n(se.obstacle.left), r: n(se.obstacle.right) }),
      t('sens.light', { l: n(se.light.left), r: n(se.light.right) }),
      t('sens.nearest', { l: n(se.left.nearest), r: n(se.right.nearest) }),
      t('sens.odor', { v: n(fl.odor.fermentation), f: n(fl.odor.sweet), g: n(fl.odor.geosmin), c: n(fl.odor.co2), a: n(fl.odor.cva) }),
      bv?.prefRaw ? t('sens.prefraw', { v: n(bv.prefRaw.vinegar ?? 0), f: n(bv.prefRaw.fruit ?? 0), g: n(bv.prefRaw.geosmin ?? 0), c: n(bv.prefRaw.co2 ?? 0), a: n(bv.prefRaw.cva ?? 0) }) : '',
      t('sens.env', { w: n(fl.warm), c: n(fl.cold), h: n(fl.humidity), d: n(fl.dust) }),
      t('sens.body', { y: n(f.y), f: n(f.flapSeconds), lock: f.flapLocked ? t('sens.locked') : '' }),
      f.down ? t('sens.down', { t: n(f.downT) }) : f.stuckT > 0 ? t('sens.stuck', { t: n(f.stuckT) }) : t('sens.normal'),
    ].filter((x) => x).join('\n');
  }

  private drawSpark(): void {
    const cv = this.spark;
    const g = cv.getContext('2d');
    if (!g) return;
    const w = cv.width, hh = cv.height;
    g.clearRect(0, 0, w, hh);
    const line = (a: number[], color: string) => {
      g.beginPath();
      a.forEach((v, i) => {
        const x = (i / (HIST - 1)) * w;
        const y = hh - 4 - Math.min(1, v / DA_FULL) * (hh - 8);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.stroke();
    };
    g.strokeStyle = 'rgba(128,128,128,0.25)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, hh - 0.5); g.lineTo(w, hh - 0.5); g.stroke();
    line(this.histPam, '#e8639a');
    line(this.histPpl, '#6c63ff');
  }
}
