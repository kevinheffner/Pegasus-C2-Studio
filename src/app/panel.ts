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
import { SensorView, SENSOR_CHOICES } from './sensorview';

export const WIDGET_CHOICES: { id: string; name: string }[] = [
  { id: 'intel', name: 'INTEL reports' },
  { id: 'orbat', name: 'ORBAT' },
  { id: 'fires', name: 'FIRES' },
  { id: 'chat', name: 'CHAT' },
  { id: 'layers', name: 'LAYERS' },
  { id: 'map', name: 'MAP tools' },
];
/** what a view shows: 'map' | 'sensor:<id>' | 'widget:<id>' */
export type ViewContent = string;

export interface PanelConfig {
  look: string;
  mode: ViewMode;
  camPath: CameraPath;
  fog: boolean;
  title?: string;
  content?: ViewContent;
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
  content: ViewContent = 'map';
  sensorView: SensorView | null = null;
  widgetBox: HTMLElement;
  private contentSel: HTMLSelectElement;
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
      split: (p: Panel, d: 'row' | 'col') => void;
      close: (p: Panel) => void;
      changed: (p: Panel, what: 'look' | 'mode' | 'cam' | 'fog' | 'content') => void;
      /** move a widget pane in/out of this view (handled by the app so the dock stays consistent) */
      hostWidget: (p: Panel, prev: string | null, next: string | null) => void;
    },
  ) {
    this.look = getLook(cfg.look);
    this.title = cfg.title ?? `VIEW ${idx + 1}`;
    this.el = document.createElement('div');
    this.el.className = 'vpanel';
    this.el.innerHTML = `
      <div class="vhead">
        <span class="vtitle">${this.title}</span>
        <select class="vcontent" title="What this view shows"></select>
        <span class="vname"></span>
        <span class="vspacer"></span>
        <select class="vlook" title="Map style for this view"></select>
        <span class="vseg"><button data-m="2d">2D</button><button data-m="3d">3D</button></span>
        <select class="vcam" title="Camera sequence for this view"></select>
        <button class="vfog" title="Blue COP: show the enemy only where detected (fog of war)">COP</button>
        <span class="vtools"><button class="vsplitR" title="Split this view: new view to the right">◫</button><button class="vsplitD" title="Split this view: new view below">⊟</button><button class="vmax" title="Maximize / restore this view">⤢</button><button class="vclose" title="Close this view">✕</button></span>
      </div>
      <div class="vbody"><div class="vstage"><div class="vmap"></div><canvas class="vhud"></canvas></div><div class="vsensor"></div><div class="vwidget"></div></div>`;
    host.appendChild(this.el);
    this.stage = this.el.querySelector('.vstage')!;
    this.hud = this.el.querySelector('.vhud')!;
    this.nameEl = this.el.querySelector('.vname')!;
    this.widgetBox = this.el.querySelector('.vwidget')!;
    this.contentSel = this.el.querySelector('.vcontent')!;
    this.contentSel.innerHTML =
      '<option value="map">🗺 Map (COP)</option>' +
      '<optgroup label="Sensors">' + SENSOR_CHOICES.map((c) => `<option value="sensor:${c.id}">${c.icon} ${c.name}</option>`).join('') + '</optgroup>' +
      '<optgroup label="Widgets">' + WIDGET_CHOICES.map((c) => `<option value="widget:${c.id}">▣ ${c.name}</option>`).join('') + '</optgroup>';
    this.contentSel.onchange = () => this.setContent(this.contentSel.value);
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
    (this.el.querySelector('.vsplitR') as HTMLButtonElement).onclick = () => this.hooks.split(this, 'row');
    (this.el.querySelector('.vsplitD') as HTMLButtonElement).onclick = () => this.hooks.split(this, 'col');
    (this.el.querySelector('.vclose') as HTMLButtonElement).onclick = () => this.hooks.close(this);
    this.camPath = cfg.camPath;
    this.fog = cfg.fog;
    this.mode = cfg.mode;
    this.el.dataset.kind = 'map';
    if (cfg.content && cfg.content !== 'map') queueMicrotask(() => this.setContent(cfg.content!));
  }

  /** header title follows the content: VIEW n · MAP label / sensor / widget */
  private mapLabel: string | null = null;
  updateTitle() {
    if (this.mapLabel === null) this.mapLabel = this.title.includes('·') ? this.title.split('·').slice(1).join('·').trim() : 'MAP';
    const kind = this.content.split(':')[0];
    const id = this.content.split(':')[1];
    const label = kind === 'map' ? this.mapLabel : kind === 'sensor' ? ({ eoir: 'EO/IR', sar: 'SAR', radar: 'RADAR', esm: 'ESM', sonar: 'SONAR' } as Record<string, string>)[id] ?? id.toUpperCase() : WIDGET_CHOICES.find((w) => w.id === id)?.name.split(' ')[0].toUpperCase() ?? id;
    const base = this.title.split('·')[0].trim();
    (this.el.querySelector('.vtitle') as HTMLElement).textContent = `${base} · ${label}`;
  }

  /** switch what the view shows: map, a sensor display or a widget */
  setContent(c: ViewContent) {
    const prev = this.content;
    const prevWidget = prev.startsWith('widget:') ? prev.slice(7) : null;
    const nextWidget = c.startsWith('widget:') ? c.slice(7) : null;
    this.content = c;
    const kind = c.split(':')[0];
    this.el.dataset.kind = kind;
    if (kind === 'sensor') {
      const id = c.slice(7);
      if (!this.sensorView) this.sensorView = new SensorView(this.el.querySelector('.vsensor') as HTMLElement, id);
      else if (this.sensorView.sensor.id !== id) this.sensorView.setSensor(id);
    }
    if (prevWidget !== nextWidget) this.hooks.hostWidget(this, prevWidget, nextWidget);
    this.contentSel.value = c;
    this.updateTitle();
    if (kind === 'map') requestAnimationFrame(() => this.fit());
    this.hooks.changed(this, 'content');
  }

  async init() {
    await this.view.setLook(this.look);
    this.view.setMode(this.mode);
    this.syncControls();
  }

  config(): PanelConfig {
    return { look: this.look.id, mode: this.mode, camPath: this.camPath, fog: this.fog, title: this.title, content: this.content };
  }

  async applyConfig(c: PanelConfig) {
    if (c.title) {
      this.title = c.title;
      this.mapLabel = null;
      (this.el.querySelector('.vtitle') as HTMLElement).textContent = c.title;
    }
    this.camPath = c.camPath;
    this.fog = c.fog;
    if (c.look !== this.look.id) await this.setLook(c.look);
    this.setMode(c.mode, false);
    this.setContent(c.content ?? 'map');
    this.syncControls();
  }

  syncControls() {
    this.lookSel.value = this.look.id;
    this.camSel.value = this.camPath;
    this.camSel.title = CAMERA_PATHS.find((c) => c.id === this.camPath)?.description ?? '';
    this.fogBtn.classList.toggle('on', this.fog);
    this.view.fog = this.fog;
    this.modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === this.mode));
    this.nameEl.textContent = this.content === 'map' && this.scenario ? this.scenario.meta.title ?? this.scenario.meta.name : '';
    this.contentSel.value = this.content;
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
