/**
 * A workspace view panel: header controls + 16:9 stage with a MapLibre view and HUD canvas.
 * Each panel has its own look, 2D/3D mode, camera sequence and COP (fog of war) setting.
 * In "same AO" mode all panels share one scenario; in "multiple AOs" mode each has its own.
 */
import { MapView, type ViewMode } from '../render/view2d';
import { LOOKS, getLook, type Look } from '../render/looks';
import { CAMERA_PATHS, CameraDirector, type CameraPath } from '../render/camera';
import { drawHud, type HudContext } from '../render/hud';
import { Simulation, type SimState, type ViewOptions } from '../scenario/sim';
import type { CameraKey, LonLat, Scenario } from '../scenario/types';

export interface PanelConfig {
  look: string;
  mode: ViewMode;
  camPath: CameraPath;
  fog: boolean;
  title?: string;
}

export class Panel {
  el: HTMLElement;
  stage: HTMLElement;
  hud: HTMLCanvasElement;
  view: MapView;
  look: Look;
  mode: ViewMode = '2d';
  camPath: CameraPath = 'static';
  fog = false;
  title: string;
  scenario: Scenario | null = null;
  sim: Simulation | null = null;
  director: CameraDirector | null = null;
  cameraBase: CameraKey | null = null;
  /** scenario settings snapshot (multi-AO mode) */
  settings: Record<string, string | boolean> | null = null;
  private lookSel: HTMLSelectElement;
  private camSel: HTMLSelectElement;
  private fogBtn: HTMLButtonElement;
  private modeBtns: HTMLButtonElement[];
  private nameEl: HTMLElement;

  constructor(
    public idx: number,
    host: HTMLElement,
    cfg: PanelConfig,
    center: LonLat,
    zoom: number,
    private hooks: {
      activate: (p: Panel) => void;
      maximize: (p: Panel) => void;
      changed: (p: Panel, what: 'look' | 'mode' | 'cam' | 'fog') => void;
    },
  ) {
    this.look = getLook(cfg.look);
    this.title = cfg.title ?? `VIEW ${idx + 1}`;
    this.el = document.createElement('div');
    this.el.className = 'vpanel';
    this.el.innerHTML = `
      <div class="vhead">
        <span class="vtitle">${this.title}</span>
        <span class="vname"></span>
        <span class="vspacer"></span>
        <select class="vlook" title="Map style for this view"></select>
        <span class="vseg"><button data-m="2d">2D</button><button data-m="3d">3D</button></span>
        <select class="vcam" title="Camera sequence for this view"></select>
        <button class="vfog" title="Blue COP: show the enemy only where detected (fog of war)">COP</button>
        <button class="vmax" title="Maximize / restore this view">⤢</button>
      </div>
      <div class="vbody"><div class="vstage"><div class="vmap"></div><canvas class="vhud"></canvas></div></div>`;
    host.appendChild(this.el);
    this.stage = this.el.querySelector('.vstage')!;
    this.hud = this.el.querySelector('.vhud')!;
    this.nameEl = this.el.querySelector('.vname')!;
    this.lookSel = this.el.querySelector('.vlook')!;
    this.camSel = this.el.querySelector('.vcam')!;
    this.fogBtn = this.el.querySelector('.vfog')!;
    this.modeBtns = [...this.el.querySelectorAll<HTMLButtonElement>('.vseg button')];
    this.lookSel.innerHTML = LOOKS.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
    this.camSel.innerHTML = CAMERA_PATHS.map((c) => `<option value="${c.id}" title="${c.description.replace(/"/g, '&quot;')}">${c.name}</option>`).join('');
    this.view = new MapView(this.el.querySelector('.vmap') as HTMLElement, this.look, center, zoom);
    this.view.followCamera = false;

    this.el.addEventListener('pointerdown', () => this.hooks.activate(this), true);
    this.lookSel.onchange = async () => {
      await this.setLook(this.lookSel.value);
      this.hooks.changed(this, 'look');
    };
    this.modeBtns.forEach((b) => (b.onclick = () => (this.setMode(b.dataset.m as ViewMode), this.hooks.changed(this, 'mode'))));
    this.camSel.onchange = () => {
      this.setCamPath(this.camSel.value as CameraPath);
      this.hooks.changed(this, 'cam');
    };
    this.fogBtn.onclick = () => {
      this.fog = !this.fog;
      this.syncControls();
      this.hooks.changed(this, 'fog');
    };
    (this.el.querySelector('.vmax') as HTMLButtonElement).onclick = () => this.hooks.maximize(this);
    this.camPath = cfg.camPath;
    this.fog = cfg.fog;
    this.mode = cfg.mode;
  }

  async init() {
    await this.view.setLook(this.look);
    this.view.setMode(this.mode);
    this.syncControls();
  }

  config(): PanelConfig {
    return { look: this.look.id, mode: this.mode, camPath: this.camPath, fog: this.fog, title: this.title };
  }

  async applyConfig(c: PanelConfig) {
    if (c.title) {
      this.title = c.title;
      (this.el.querySelector('.vtitle') as HTMLElement).textContent = c.title;
    }
    this.camPath = c.camPath;
    this.fog = c.fog;
    if (c.look !== this.look.id) await this.setLook(c.look);
    this.setMode(c.mode, false);
    this.syncControls();
  }

  syncControls() {
    this.lookSel.value = this.look.id;
    this.camSel.value = this.camPath;
    this.camSel.title = CAMERA_PATHS.find((c) => c.id === this.camPath)?.description ?? '';
    this.fogBtn.classList.toggle('on', this.fog);
    this.view.fog = this.fog;
    this.modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === this.mode));
    this.nameEl.textContent = this.scenario ? this.scenario.meta.title ?? this.scenario.meta.name : '';
  }

  async setLook(id: string) {
    this.look = getLook(id);
    await this.view.setLook(this.look);
    this.syncControls();
  }

  setMode(m: ViewMode, animate = true) {
    this.mode = m;
    this.view.setMode(m);
    const axis = this.scenario?.meta.axis ?? 0;
    const opts = { pitch: m === '3d' ? 55 : 0, bearing: m === '3d' ? axis : 0 };
    if (animate) this.view.map.easeTo({ ...opts, duration: 700 });
    else this.view.map.jumpTo(opts);
    this.syncControls();
  }

  setCamPath(p: CameraPath) {
    this.camPath = p;
    const info = CAMERA_PATHS.find((c) => c.id === p);
    if (info?.needs3d && this.mode !== '3d') this.setMode('3d');
    this.cameraBase = this.clipBase();
    this.syncControls();
  }

  setScenario(sc: Scenario, sim: Simulation, director: CameraDirector, fly: boolean) {
    this.scenario = sc;
    this.sim = sim;
    this.director = director;
    this.view.setScenario(sc);
    if (fly) this.view.map.jumpTo({ center: sc.view.center, zoom: sc.view.zoom, bearing: this.mode === '3d' ? sc.meta.axis ?? 0 : 0, pitch: this.mode === '3d' ? 55 : 0 });
    this.syncControls();
  }

  currentCamera(t = 0): CameraKey {
    const m = this.view.map;
    const c = m.getCenter();
    return { t, center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
  }

  /** named sequences start from the AO framing; static/keyframes from the current view */
  clipBase(): CameraKey {
    if (this.scenario && this.camPath !== 'static' && this.camPath !== 'keyframes') return { t: 0, center: this.scenario.view.center, zoom: this.scenario.view.zoom, bearing: 0, pitch: 0 };
    return this.currentCamera();
  }

  directedCamera(p: number, t: number): CameraKey | null {
    if (!this.director || this.camPath === 'static') return null;
    return this.director.camera(this.camPath, p, t, this.cameraBase ?? this.currentCamera(), this.mode);
  }

  stateAt(t: number, opts: ViewOptions): SimState | null {
    if (!this.sim || !this.scenario) return null;
    return this.sim.stateAt(Math.min(t, this.scenario.meta.durationMin), { ...opts, fog: this.fog });
  }

  /** the map fills the whole panel body */
  fit() {
    const body = this.el.querySelector('.vbody') as HTMLElement;
    const W = body.clientWidth;
    const H = body.clientHeight;
    if (W <= 0 || H <= 0) return;
    this.stage.style.width = `${W}px`;
    this.stage.style.height = `${H}px`;
    this.view.map.resize();
  }

  /** centered region of the stage (CSS px) with the output aspect ratio – what screenshots/videos capture */
  captureRect(aspect = 16 / 9) {
    const W = this.stage.clientWidth || 1;
    const H = this.stage.clientHeight || 1;
    if (W / H > aspect) {
      const w = H * aspect;
      return { x: (W - w) / 2, y: 0, w, h: H };
    }
    const h = W / aspect;
    return { x: 0, y: (H - h) / 2, w: W, h };
  }

  drawPreviewHud(state: SimState | null, hc: Omit<HudContext, 'look' | 'scenario' | 'state' | 'map' | 'mode'>) {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (this.hud.width !== Math.round(w * dpr)) this.hud.width = Math.round(w * dpr);
    if (this.hud.height !== Math.round(h * dpr)) this.hud.height = Math.round(h * dpr);
    const ctx = this.hud.getContext('2d')!;
    ctx.clearRect(0, 0, this.hud.width, this.hud.height);
    if (!this.scenario || !state) return;
    drawHud(ctx, w, h, dpr, { ...hc, look: this.look, scenario: this.scenario, state, map: this.view.map, mode: this.mode });
  }

  /** draw map + HUD into an output canvas (for screenshots and video) */
  compose(out: HTMLCanvasElement, state: SimState, hc: Omit<HudContext, 'look' | 'scenario' | 'state' | 'map' | 'mode'>) {
    const ctx = out.getContext('2d')!;
    const r = this.captureRect(out.width / out.height);
    const mc = this.view.map.getCanvas();
    const pr = mc.width / (mc.clientWidth || 1);
    ctx.drawImage(mc, r.x * pr, r.y * pr, r.w * pr, r.h * pr, 0, 0, out.width, out.height);
    drawHud(ctx, r.w, r.h, out.width / r.w, { ...hc, look: this.look, scenario: this.scenario!, state, map: this.view.map, mode: this.mode });
  }
}
