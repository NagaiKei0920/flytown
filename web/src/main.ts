import * as THREE from 'three';
import './ui/style.css';
import { ManualBrain } from './brain/manualBrain.ts';
import { ConnectomeHub } from './brain/connectome/hub.ts';
import type { ConnectomeBrain } from './brain/connectome/hub.ts';
import type { DopamineKind } from './brain/connectome/batch.ts';
import { Sim, TICK } from './sim/sim.ts';
import { loadAssets } from './render/assets.ts';
import { buildTown } from './render/townBuilder.ts';
import { createStage } from './render/stage.ts';
import { Actors } from './render/actors.ts';
import { CameraRig } from './render/cameraRig.ts';
import { CompoundEyePost } from './render/compoundEye.ts';
import { SensorOverlay } from './render/debugOverlay.ts';
import { ItemsView } from './render/items.ts';
import { InjectionFx } from './render/fx.ts';
import { PlumeOverlay } from './render/plumeOverlay.ts';
import type { ItemKind } from './sim/items.ts';
import type { BrainView, Tool } from './ui/ui.ts';
import { Ui } from './ui/ui.ts';
import { Perf } from './ui/perf.ts';
import { t } from './ui/i18n.ts';
import { ModeController } from './sim/modes.ts';

window.addEventListener('error', (e) => console.error('[flytown:error]', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[flytown:error] unhandled', e.reason));

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const params = new URLSearchParams(location.search);
  const flyCount = Number(params.get('flies') ?? 4);
  // 脳: FlyWire 回路を Worker で動かす。?brain=off で無効（指令 0）。
  const hub = params.get('brain') === 'off' ? null : new ConnectomeHub(flyCount, { baseUrl: new URL(import.meta.env.BASE_URL, location.href).href, seed: 1 });
  const sim = new Sim({
    seed: Number(params.get('seed') ?? 20261029),
    flyCount,
    brainFactory: (i) => hub?.brains[i] ?? null,
    npcCount: Number(params.get('npcs') ?? 20),
    carCount: Number(params.get('cars') ?? 15),
  });
  console.log(`[flytown] sim: flies=${sim.flies.length} npcs=${sim.npcs.length} cars=${sim.cars.length} colliders=${sim.world.colliders.length}`);

  const stage = createStage(app);
  const gl = stage.renderer.getContext();
  console.log(`[flytown] webgl2=${stage.renderer.capabilities.isWebGL2} maxTex=${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`);

  const cam = new CameraRig(stage.renderer.domElement, app.clientWidth / app.clientHeight);
  let selected = -1;
  let manualOn = false; // DEV の手動操作は設定で入れたときだけ
  let tool: Tool = 'none';
  let placeKind: ItemKind = 'garbage';
  let placeMode: 'add' | 'remove' = 'add';
  let placeRot = 0;
  let timeScale = 1;
  let eyeOn = false;
  const manual = new ManualBrain();

  const ui: Ui = new Ui(app, sim.flies, {
    onSelect: (i) => select(i),
    onTimeScale: (s) => (timeScale = s),
    onEye: (on) => setEye(on),
    onShadows: (on) => { stage.setShadows(on); town?.setShadows(on); actors?.setShadows(on); items?.setShadows(on); },
    onHiRes: (on) => stage.setPixelRatio(on ? Math.min(window.devicePixelRatio, 2) : 1),
    onDebug: (on) => (debugOn = on),
    onManual: (on) => { manualOn = on; applyManual(); },
    onTool: (t) => { tool = t; if (t !== 'place') items?.setCursor(0, 0, null); },
    onPlaceKind: (k) => (placeKind = k),
    onPlaceMode: (m) => (placeMode = m),
    onPlaceRot: (deg) => (placeRot = (deg * Math.PI) / 180),
    onWind: (d, sp) => sim.town?.setWind(d, sp),
    onInject: (kind, dose) => inject(kind, dose),
    onPlume: (on) => plume?.setVisible(on),
    onModeStart: (m, i) => {
      ui.closeTool();
      select(i);
      if (eyeOn) setEye(false);
      modes.start(m, i);
      ui.setRun(m, modes.stats);
    },
    onModeCancel: () => { modes.cancel(); ui.setRun(null, null); },
    onLang: () => ui.refresh(selected, sim.accidents, selected >= 0 ? brainView(selected) : null),
  });
  const modes = new ModeController(sim);
  modes.onFinish = (r) => ui.showResult(r);
  if (sim.town) ui.setWind(sim.town.windDirDeg, sim.town.windSpeed);
  let debugOn = false;
  ui.setLoading(t('loading.models'));
  const t0 = performance.now();
  const assets = await loadAssets((d, total) => ui.setLoading(`${t('loading.models')} (${d}/${total})`));
  console.log(`[flytown] assets loaded in ${(performance.now() - t0).toFixed(0)} ms: buildings=${assets.buildings.size} cars=${assets.cars.length} characters=${assets.characters.length}`);

  const t1 = performance.now();
  const town = buildTown(sim.world.layout, assets);
  stage.scene.add(town.root);
  const actors = new Actors(sim, assets);
  stage.scene.add(actors.root);
  const overlay = new SensorOverlay();
  stage.scene.add(overlay.lines);
  const eyePost = new CompoundEyePost(stage.renderer);
  const items = sim.town ? new ItemsView(sim.town) : null;
  if (items) stage.scene.add(items.root);
  const plume = sim.town ? new PlumeOverlay(sim.town) : null;
  if (plume) stage.scene.add(plume.mesh);
  const fx = new InjectionFx(sim.flies.length);
  stage.scene.add(fx.root);
  // 熱いアスファルトの目印（暗い円。見た目のみ）
  const hot = sim.town?.sources.find((s) => s.label === '熱いアスファルト');
  if (hot) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28), new THREE.MeshStandardMaterial({ color: 0x4e535c, roughness: 1 }));
    d.rotation.x = -Math.PI / 2;
    d.position.set(hot.x, 0.07, hot.z);
    d.receiveShadow = true;
    stage.scene.add(d);
  }
  console.log(`[flytown] town built in ${(performance.now() - t1).toFixed(0)} ms`);

  function applyManual(): void {
    for (const f of sim.flies) if (f.brain === manual) f.brain = hub?.brains[f.id] ?? null;
    manual.reset();
    if (manualOn && selected >= 0) sim.flies[selected].brain = manual;
    ui.setManual(manualOn && selected >= 0, selected >= 0 ? ui.flyName(selected) : '');
  }
  function select(i: number, follow = true): void {
    selected = i;
    actors.selected = i;
    if (follow || i < 0) cam.setFollow(i);
    ui.setSelected(i);
    if (i < 0 && eyeOn) setEye(false);
    applyManual();
  }
  /** 選択中のハエ人にドーパミンを打つ（脳の inject を呼ぶだけ。効果は回路が決める）。 */
  function inject(kind: DopamineKind, dose: 1 | 2 | 3): void {
    if (selected < 0) return;
    const b = sim.flies[selected].brain as unknown as Partial<ConnectomeBrain> | null;
    if (!b || typeof b.inject !== 'function') {
      ui.showToast(t('syringe.noBrain'));
      return;
    }
    b.inject(kind, dose, 2000);
    modes.noteInjection(selected);
    fx.trigger(selected, kind);
  }
  function brainView(i: number): BrainView | null {
    const b = sim.flies[i].brain as unknown as Partial<ConnectomeBrain> | null;
    const d = b?.getConnectomeDebug?.();
    if (!d) return null;
    const activity: Record<string, number> = {};
    for (const [k, r] of Object.entries(d.rates)) activity[k] = Math.max(0, Math.min(1, r / 2));
    return { activity, pam: d.dopamine.pam, ppl1: d.dopamine.ppl1, pref: d.preferenceChange, prefRaw: d.preference };
  }
  const groundPt = (e: PointerEvent | MouseEvent): THREE.Vector3 | null => {
    const r = stage.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, cam.camera);
    const p = new THREE.Vector3();
    return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  };
  function setEye(on: boolean): void {
    if (on && selected < 0) select(0);
    eyeOn = on;
    cam.eyeView = on;
    ui.setEye(on);
    actors.flyRigs.forEach((r, i) => r.setHeadVisible(!(on && i === selected)));
  }
  select(-1); // 起動時は俯瞰。最初に選んだハエ人には追従する

  // クリックで選択（ドラッグは無視）
  const dom = stage.renderer.domElement;
  let down: { x: number; y: number; t: number } | null = null;
  dom.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
  dom.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 6 || dt > 400 || eyeOn) return;
    if (tool === 'place' && sim.town) {
      const p = groundPt(e);
      if (!p) return;
      if (placeMode === 'add') {
        if (!sim.town.addItem(placeKind, p.x, p.z, placeRot)) ui.showToast(t('place.bad'));
      } else {
        const it = sim.town.nearestItem(p.x, p.z, Math.max(1.2, cam.camera.position.distanceTo(p) * 0.03));
        if (it) sim.town.removeItem(it.id);
        else ui.showToast(t('place.none'));
      }
      return;
    }
    const r = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, cam.camera);
    const hit = actors.pick(rc.ray);
    if (hit >= 0) select(hit);
  });
  dom.addEventListener('pointermove', (e) => {
    if (tool !== 'place' || !sim.town || !items) return;
    const p = groundPt(e);
    if (!p) return;
    if (placeMode === 'add') items.setCursor(p.x, p.z, sim.town.world.isBlocked(p.x, p.z, 0.3) || Math.abs(p.x) > 146 || Math.abs(p.z) > 146 ? 'bad' : 'add');
    else {
      const it = sim.town.nearestItem(p.x, p.z, Math.max(1.2, cam.camera.position.distanceTo(p) * 0.03));
      items.setCursor(it ? it.x : p.x, it ? it.z : p.z, it ? 'remove' : 'bad');
    }
  });
  dom.addEventListener('dblclick', (e) => {
    const r = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, cam.camera);
    if (actors.pick(rc.ray) < 0) select(-1);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') select(-1);
    if (e.code === 'KeyV') setEye(!eyeOn);
    if (e.code === 'Tab') { e.preventDefault(); select((selected + 1) % sim.flies.length); }
  });

  const resize = () => {
    stage.renderer.setSize(app.clientWidth, app.clientHeight);
    cam.resize(app.clientWidth, app.clientHeight);
  };
  window.addEventListener('resize', resize);

  const perf = new Perf(stage.renderer, () => ({
    sim_t: sim.time,
    accidents: sim.accidents,
    scale: timeScale,
    eye: eyeOn ? 1 : 0,
  }));
  perf.onUpdate = () => ui.setPerf(perf.fps, perf.avgMs, perf.draws, perf.tris);

  (window as unknown as Record<string, unknown>).__flytown = { sim, perf, stage, cam, actors, select, setEye, manual, hub, THREE, items, inject, modes };

  ui.hideLoading();
  console.log('[flytown] ready');

  let acc = 0;
  let last = performance.now();
  let uiT = 0;
  let animTime = 0;
  const head = new THREE.Vector3();
  const loop = (now: number) => {
    const dtMs = Math.min(100, now - last);
    last = now;
    const dt = dtMs / 1000;
    const s0 = performance.now();
    acc += dt * timeScale;
    let n = 0;
    while (acc >= TICK && n < 16) {
      sim.step(TICK);
      acc -= TICK;
      n++;
    }
    if (n === 16) acc = 0;
    const simMs = performance.now() - s0;
    const alpha = Math.min(1, acc / TICK);
    animTime += dt * timeScale;
    actors.update(alpha, dt * timeScale, animTime);
    town.update(now / 1000, dt);
    items?.update(now / 1000, dt);
    plume?.update();
    modes.update();
    fx.update(dt, (i, out) => actors.flyRigs[i].headWorld(out), (i) => actors.flyRigs[i].group.rotation.y);
    cam.update(sim.flies, actors.flyRigs, dt);

    const f = selected >= 0 ? sim.flies[selected] : null;
    if (f) {
      const g = actors.flyRigs[selected].group.position;
      overlay.update(debugOn ? f : null, g.x, g.y, g.z);
    } else overlay.update(null, 0, 0, 0);

    stage.update(cam.controls.target, cam.camera.position.distanceTo(cam.controls.target), now / 1000);
    if (eyeOn && f) eyePost.render(stage.scene, cam.eyeCamera);
    else stage.renderer.render(stage.scene, cam.camera);

    uiT += dt;
    if (uiT > 0.1) {
      uiT = 0;
      const to = cam.controls.target;
      const cp = cam.camera.position;
      ui.setView(to.x - cp.x, to.z - cp.z);
      ui.refresh(selected, sim.accidents, selected >= 0 ? brainView(selected) : null);
      if (modes.active) ui.setRun(modes.active, modes.stats);
    }
    perf.frame(dtMs, simMs);
    head.set(0, 0, 0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => console.error('[flytown:error] boot failed', e));
