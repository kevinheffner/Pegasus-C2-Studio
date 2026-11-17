import './style.css';
import ms from 'milsymbol';
import maplibregl from 'maplibre-gl';
import { AO_PRESETS, AIR_OPTIONS, DEFAULT_PARAMS, FORCES, TEMPLATES, type BattleParams } from './scenario/catalog';
import { CAMERA_PATHS, CameraDirector, type CameraPath } from './render/camera';
import { generate, type GenOptions } from './scenario/generator';
import { Simulation, sideOf, type ViewOptions } from './scenario/sim';
import type { CameraKey, LonLat, Scenario } from './scenario/types';
import { dtg } from './render/hud';
import { recordVideo, download, startLiveRecording, createEncoder, type LiveRecording } from './export/recorder';
import { saveOutput, saveTarget, setSaveTarget, chooseFolder, folderName } from './export/save';
import { importFile } from './import/overlay';
import { extentKm, toMgrs } from './geo/geo';
import { Panel, type PanelConfig } from './app/panel';
import { buildReports, type ChatLine, type Report } from './app/reports';
import { BUILTIN_PACKAGES, deleteSaved, listSaved, loadSaved, saveToDisk, LAYOUTS, normLayout, layoutCount, type LayoutId, type ScenarioPackage, type Settings } from './app/library';
import { initHome } from './home';
import { initDock, type Dock } from './app/dock';
import { PRESET_TREES, cloneTree, leaves, splitLeaf, removeLeaf, renderTree, type LNode } from './app/tiles';
import { openLayouts, applyDefaultLayout, type LayoutHost } from './app/layouts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const sel = (id: string) => $<HTMLSelectElement>(id);
const inp = (id: string) => $<HTMLInputElement>(id);
const REF_W = 1280; // reference frame width for "zoom" settings
const params = new URLSearchParams(location.search);
const headless = params.has('headless');

// ================= controls =================
const fill = (s: HTMLSelectElement, items: { id: string; name: string }[]) => (s.innerHTML = items.map((i) => `<option value="${i.id}">${i.name}</option>`).join(''));
fill(sel('ao'), [...AO_PRESETS, { id: 'custom', name: 'Custom (click on map)' }]);
fill(sel('wAo'), [{ id: '', name: '— select —' }, ...AO_PRESETS]);
fill(sel('template'), TEMPLATES);
fill(sel('blue'), FORCES.filter((f) => f.side === 'blue'));
fill(sel('red'), FORCES.filter((f) => f.side === 'red'));
fill(sel('air'), AIR_OPTIONS);
sel('air').value = 'all';
sel('camPath').innerHTML = CAMERA_PATHS.map((c) => `<option value="${c.id}" title="${c.description.replace(/"/g, '&quot;')}">${c.name}${c.needs3d ? ' (3D)' : ''}</option>`).join('');

const PARAM_KEYS = ['blueQuality', 'lethality', 'defenderAdvantage', 'tempo', 'prepMinutes', 'durationMin'] as const;
const showParam = (k: string) => ($('v-' + k).textContent = k === 'durationMin' && inp('p-' + k).value === '0' ? 'auto' : inp('p-' + k).value);
for (const k of PARAM_KEYS) {
  inp('p-' + k).addEventListener('input', () => showParam(k));
  showParam(k);
}

// ================= state =================
const panels: Panel[] = [];
let active!: Panel;
let layout: LayoutId = '1'; // last preset chosen (for the icon highlight)
let tree: LNode = cloneTree(PRESET_TREES['1']);
let maximized = false;
const MAX_VIEWS = 8;
let multiAO = false;
let t = 0;
let playing = false;
let customCenter: LonLat | null = null;
const reportCache = new WeakMap<Scenario, { reports: Report[]; chat: ChatLine[] }>();
const userChat: ChatLine[] = [];
const viewsEl = $('views');

const visiblePanels = (): Panel[] => (maximized ? (active ? [active] : []) : leaves(tree).map((i) => panels[i]).filter(Boolean));
const mapPanels = () => visiblePanels().filter((p) => p.content === 'map');
const scenarioOf = () => active?.scenario ?? null;
const viewOpts = (): ViewOptions => ({ trailMin: Number(sel('trails').value) });
const hudOpts = () => ({ banner: inp('banner').value, markStyle: sel('markStyle').value as 'none' | 'corner' | 'banner', chrome: inp('L-hud').checked });
const zoomAdj = (p: Panel) => Math.log2(Math.max(100, p.captureRect().w) / REF_W);
const maxDuration = () => Math.max(1, ...visiblePanels().map((p) => p.scenario?.meta.durationMin ?? 0));
const vclock = () => performance.now() / 1000;

// ---------- panel helpers that respect the reference zoom ----------
function applyCam(p: Panel, cam: CameraKey) {
  p.view.setCamera({ ...cam, zoom: cam.zoom + zoomAdj(p) });
}
function refCamera(p: Panel): CameraKey {
  const c = p.currentCamera(t);
  return { ...c, zoom: c.zoom - zoomAdj(p) };
}
function clipBase(p: Panel): CameraKey {
  if (p.scenario && p.camPath !== 'static' && p.camPath !== 'keyframes') return { t: 0, center: p.scenario.view.center, zoom: p.scenario.view.zoom, bearing: 0, pitch: 0 };
  return refCamera(p);
}
/** frame all ground units (over a short time window, for smooth reframing) inside the 16:9 capture area */
const fitCache = new Map<Panel, { key: string; cam: CameraKey | null }>();
function fitCamera(p: Panel, tt: number): CameraKey | null {
  const sc = p.scenario;
  if (!sc || !p.sim || p.stage.clientWidth < 50) return null;
  const r = p.captureRect();
  const key = `${Math.round(tt * 4)}|${Math.round(r.w)}x${Math.round(r.h)}|${p.mode}|${sc.meta.start}`;
  const hit = fitCache.get(p);
  if (hit && hit.key === key) return hit.cam;
  let w = 180, e = -180, s = 90, n = -90;
  for (const dt of [-6, -3, 0, 3, 6]) {
    const st = p.sim.stateAt(Math.max(0, Math.min(sc.meta.durationMin, tt + dt)), {});
    for (const u of st.units) {
      if (u.unit.air) continue;
      w = Math.min(w, u.pos[0]);
      e = Math.max(e, u.pos[0]);
      s = Math.min(s, u.pos[1]);
      n = Math.max(n, u.pos[1]);
    }
  }
  let cam: CameraKey | null = null;
  if (w <= e) {
    const W = p.stage.clientWidth, H = p.stage.clientHeight;
    const mx = r.w * 0.07, my = r.h * 0.09;
    const hudTop = p.look.hud === 'c2-dark' && inp('L-hud').checked ? 40 : 0;
    const c = p.view.map.cameraForBounds([[w, s], [e, n]], {
      padding: { left: r.x + mx, right: W - r.x - r.w + mx, top: r.y + my + hudTop, bottom: H - r.y - r.h + my + (hudTop ? 28 : 0) },
      bearing: p.mode === '3d' ? p.view.map.getBearing() : 0,
    });
    if (c?.center) {
      const ll = maplibregl.LngLat.convert(c.center as any);
      cam = { t: tt, center: [ll.lng, ll.lat], zoom: Math.min(15.5, (c.zoom ?? 12) - (p.mode === '3d' ? 0.3 : 0)) - zoomAdj(p), bearing: p.mode === '3d' ? p.view.map.getBearing() : 0, pitch: p.mode === '3d' ? 50 : 0 };
    }
  }
  fitCache.set(p, { key, cam });
  return cam;
}

function directed(p: Panel, prog: number, tt: number): CameraKey | null {
  if (p.camPath === 'fit') return p.content === 'map' ? fitCamera(p, tt) : null;
  if (!p.director || p.camPath === 'static') return null;
  return p.director.camera(p.camPath, prog, tt, p.cameraBase ?? clipBase(p), p.mode);
}
function flyToAO(p: Panel) {
  if (!p.scenario) return;
  const fit = fitCamera(p, t);
  if (fit) return applyCam(p, fit);
  applyCam(p, { t: 0, center: p.scenario.view.center, zoom: p.scenario.view.zoom, bearing: p.mode === '3d' ? p.scenario.meta.axis ?? 0 : 0, pitch: p.mode === '3d' ? 55 : 0 });
}

/** top-bar mission title: the operation of the active view (or a theater overview) */
function updateMissionTitle() {
  const sc = active?.scenario;
  $('scnName').textContent = multiAO ? 'THEATER OVERVIEW · 4 AREAS OF OPERATIONS' : sc ? sc.meta.title ?? sc.meta.name : '—';
}

// ================= panels & layout =================
async function createPanel(i: number, cfg: PanelConfig) {
  const preset = AO_PRESETS[0];
  const p = new Panel(i, viewsEl, cfg, preset.center, preset.zoom, {
    activate: (x) => setActive(x),
    maximize: (x) => {
      setActive(x);
      maximized = !maximized && leaves(tree).length > 1;
      renderLayout();
    },
    split: (x, d) => splitView(x, d),
    close: (x) => closeView(x),
    changed: (x, what) => {
      if (what === 'cam') x.cameraBase = clipBase(x);
      if (x === active) syncActiveControls();
      if (what === 'content') {
        refreshRecTargets();
        renderWidgets(true);
        if (x.sensorView) x.sensorView.lastT = -1;
      }
      renderAll();
    },
    hostWidget: (x, prev, next) => hostWidget(x, prev, next),
  });
  panels[i] = p;
  await p.init();
  let lastW = 0;
  new ResizeObserver(() => {
    p.fit();
    const w = p.captureRect().w;
    // keep the same ground framing when the panel changes size
    const shown = p.el.offsetParent !== null && p.stage.clientWidth > 120;
    if (shown && lastW > 120 && Math.abs(w - lastW) > 2 && w / lastW < 4 && lastW / w < 4) p.view.map.setZoom(p.view.map.getZoom() + Math.log2(w / lastW));
    // first time the view is actually visible: frame the AO for its real size
    if (shown && lastW <= 120 && p.scenario) {
      const cam = directed(p, Math.min(1, t / p.scenario.meta.durationMin), t);
      if (cam) applyCam(p, cam);
      else flyToAO(p);
    }
    if (shown) lastW = w;
    renderPanel(p);
  }).observe(p.el.querySelector('.vbody')!);
  p.view.map.on('move', () => {
    renderHud(p);
    if (p === active) syncMapWidget();
  });
  p.view.map.on('movestart', (e: any) => {
    if (e.originalEvent && p.camPath !== 'static' && (playing || live || flying)) {
      p.camPath = 'static';
      p.syncControls();
      if (p === active) syncActiveControls();
    }
  });
  p.view.map.on('moveend', (e: any) => {
    if (e.originalEvent && inp('linkViews').checked && !multiAO && p === active) linkFrom(p);
  });
  p.view.map.on('mousemove', (e) => {
    if (p === active) $('cursorPos').textContent = `${toMgrs(e.lngLat.lng, e.lngLat.lat, 5)}  ·  ${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
  });
  p.view.map.on('click', (e) => {
    if (!picking || p !== active) return;
    customCenter = [e.lngLat.lng, e.lngLat.lat];
    p.view.map.easeTo({ center: e.lngLat, duration: 500 });
    sel('ao').value = 'custom';
    endPicking();
    scheduleRegen();
  });
  return p;
}

function linkFrom(src: Panel) {
  const c = refCamera(src);
  for (const p of visiblePanels()) if (p !== src && p.camPath === 'static') applyCam(p, { ...c, bearing: p.view.map.getBearing(), pitch: p.view.map.getPitch() });
}

async function ensurePanels(n: number, cfgs?: PanelConfig[]) {
  const base: PanelConfig[] = [
    { look: 'topo', mode: '2d', camPath: 'fit', fog: false, title: 'VIEW 1 · MAP' },
    { look: 'vector-topo', mode: '3d', camPath: 'overwatch', fog: false, title: 'VIEW 2 · 3D' },
    { look: 'c2-dark', mode: '2d', camPath: 'fit', fog: true, title: 'VIEW 3 · BLUE COP' },
    { look: 'c2-sat', mode: '3d', camPath: 'commander', fog: false, title: 'VIEW 4 · ISR' },
  ];
  const defaults = Array.from({ length: MAX_VIEWS }, (_, i) => ({ ...base[i % 4], title: `VIEW ${i + 1} · ${base[i % 4].title!.split('·')[1].trim()}` }));
  for (let i = 0; i < n; i++) {
    if (!panels[i]) {
      await createPanel(i, cfgs?.[i] ?? defaults[i]);
      // share the scenario in same-AO mode
      if (!multiAO && panels[0]?.scenario && i > 0) attachScenario(panels[i], panels[0].scenario, true);
    }
  }
}

/** move a widget pane into / out of a view; a widget lives in one place at a time */
let hostingGuard = false;
function hostWidget(p: Panel, prev: string | null, next: string | null) {
  const pane = (w: string) => document.querySelector<HTMLElement>(`.wpane[data-w="${w}"]`);
  if (prev) {
    const el = pane(prev);
    if (el && p.widgetBox.contains(el)) $('paneStore').appendChild(el);
  }
  if (next) {
    // another view showing the same widget goes back to its map
    for (const o of panels) if (o && o !== p && o.content === 'widget:' + next) o.setContent('map');
    hostingGuard = true;
    if (dock?.getState().cards.some((c) => c.w === next)) dock.remove(next);
    hostingGuard = false;
    const el = pane(next);
    if (el) {
      el.classList.add('on');
      p.widgetBox.innerHTML = '';
      p.widgetBox.appendChild(el);
    }
  } else p.widgetBox.innerHTML = '';
  if (dock && !hostingGuard) dock.setState(dock.getState()); // re-render dock placeholders
  renderWidgets(true);
}

function setActive(p: Panel) {
  if (active === p) return;
  active = p;
  panels.forEach((x) => x?.el.classList.toggle('active', x === p));
  if (multiAO && p.settings) applySettings(p.settings, false);
  syncActiveControls();
  updateMissionTitle();
  renderWidgets(true);
}

/** the recording target lists every open view by name, then the workspace and the whole window */
function refreshRecTargets() {
  const views = visiblePanels();
  const opts = (short: boolean) =>
    views.map((p) => {
      const title = (p.el.querySelector('.vtitle') as HTMLElement)?.textContent ?? `VIEW ${p.idx + 1}`;
      return `<option value="view:${p.idx}">${short ? '' : 'Show '}${title}${p === active ? ' (active)' : ''}</option>`;
    }).join('') +
    `<option value="workspace">${short ? 'All views' : 'Show all views (workspace, screen capture)'}</option><option value="screen">${short ? 'Entire window' : 'Show entire Pegasus C2 Studio window'}</option>`;
  for (const [id, short] of [['recTarget', false], ['recTargetTop', true]] as const) {
    const s = sel(id);
    const prev = s.value;
    s.innerHTML = opts(short);
    const keep = [...s.options].some((o) => o.value === prev);
    s.value = keep ? prev : `view:${active?.idx ?? 0}`;
  }
}
/** the panel a "view:N" target refers to (or null for workspace / window) */
function targetPanel(): Panel | null {
  const v = sel('recTarget').value;
  if (v === 'view' || !v) return active;
  if (!v.startsWith('view:')) return null;
  return panels[Number(v.slice(5))] ?? active;
}

/** apply a layout preset (or a saved tree) */
async function setLayout(id: LayoutId | number, t?: LNode) {
  const n = normLayout(id);
  layout = n;
  tree = t ? cloneTree(t) : cloneTree(PRESET_TREES[n]);
  maximized = false;
  await ensurePanels(Math.max(...leaves(tree)) + 1);
  renderLayout();
  updateTimeMax();
}
const viewStore = document.createElement('div');
viewStore.style.display = 'none';
document.body.appendChild(viewStore);
/** rebuild the tiled DOM from the tree (panels not in the tree are parked off-screen) */
function renderLayout() {
  viewsEl.className = 'tiles';
  const shown = new Set(maximized ? [active.idx] : leaves(tree));
  for (const p of panels) if (p && !shown.has(p.idx)) viewStore.appendChild(p.el);
  if (!shown.has(active?.idx)) setActive(panels[leaves(tree)[0]]);
  renderTree(viewsEl, maximized ? { t: 'leaf', p: active.idx } : tree, (i) => panels[i].el, () => {
    panels.forEach((p) => p?.fit());
    renderAll();
  });
  document.querySelectorAll<HTMLButtonElement>('#layoutBtns button').forEach((b) => b.classList.toggle('on', !maximized && b.dataset.l === layout && JSON.stringify(PRESET_TREES[layout]) === JSON.stringify(stripF(tree))));
  panels.forEach((p) => p?.el.classList.toggle('maximized', maximized && p === active));
  refreshRecTargets();
  requestAnimationFrame(() => {
    panels.forEach((p) => p?.fit());
    renderAll();
    renderWidgets(true);
  });
}
const stripF = (n: LNode): LNode => (n.t === 'leaf' ? n : { ...n, f: 0.5, a: stripF(n.a), b: stripF(n.b) });
/** split a view: a new view appears to the right (row) or below (col) */
async function splitView(p: Panel, d: 'row' | 'col') {
  const used = new Set(leaves(tree));
  let q = -1;
  for (let i = 0; i < MAX_VIEWS; i++) if (!used.has(i)) { q = i; break; }
  if (q < 0) return alert(`Up to ${MAX_VIEWS} views.`);
  await ensurePanels(q + 1);
  maximized = false;
  tree = splitLeaf(tree, p.idx, d, q);
  renderLayout();
  setActive(panels[q]);
  if (panels[q].scenario) requestAnimationFrame(() => flyToAO(panels[q]));
}
function closeView(p: Panel) {
  const t2 = removeLeaf(tree, p.idx);
  if (!t2) return; // keep at least one view
  if (p.content.startsWith('widget:')) p.setContent('map'); // give the widget back
  tree = t2;
  maximized = false;
  renderLayout();
}

// ================= scenario attach / generate =================
function attachScenario(p: Panel, sc: Scenario, fly: boolean) {
  const sim = new Simulation(sc);
  const dir = new CameraDirector(sc);
  p.setScenario(sc, sim, dir, false);
  if (fly) flyToAO(p);
  p.cameraBase = clipBase(p);
}

function loadScenario(sc: Scenario, fly = true) {
  if (multiAO) attachScenario(active, sc, fly);
  else for (const p of panels) if (p) attachScenario(p, sc, fly);
  t = 0;
  updateTimeMax();
  updateMissionTitle();
  updateKeyInfo();
  updateVideoHint();
  renderAll();
  renderWidgets(true);
}

function updateTimeMax() {
  inp('time').max = String(maxDuration());
  inp('vto').placeholder = String(scenarioOf()?.meta.durationMin ?? '');
}

const SCENARIO_KEYS = ['ao', 'zoom', 'axis', 'template', 'blue', 'red', 'air', 'movement', 'riverine', 'seed', ...PARAM_KEYS.map((k) => 'p-' + k), 'p-counterattack'];

function genOptionsFrom(s: Settings, p: Panel): GenOptions {
  const get = (k: string, d: string) => (s[k] !== undefined ? String(s[k]) : d);
  const preset = AO_PRESETS.find((a) => a.id === s.ao);
  const center: LonLat = typeof s.center === 'string' && s.center ? (s.center.split(',').map(Number) as LonLat) : preset ? preset.center : AO_PRESETS[0].center;
  const P: BattleParams = { ...DEFAULT_PARAMS };
  for (const k of PARAM_KEYS) if (s['p-' + k] !== undefined) (P as any)[k] = Number(s['p-' + k]);
  if (s['p-counterattack'] !== undefined) P.counterattack = !!s['p-counterattack'];
  return {
    center,
    zoom: Number(get('zoom', '11.7')),
    axis: Number(get('axis', String(preset?.axis ?? 90))),
    template: get('template', 'deliberate-attack'),
    blue: get('blue', 'abct'),
    red: get('red', 'mr-bde'),
    air: get('air', 'all') as GenOptions['air'],
    movement: get('movement', 'roads') as GenOptions['movement'],
    riverine: s.riverine === true || s.riverine === 'true',
    seed: Number(get('seed', '7')) || 1,
    params: P,
    viewPx: [REF_W, 720],
    onProgress: (m) => ($('genStatus').textContent = m),
  };
}

let genBusy = false;
async function generateFor(p: Panel | null, s: Settings) {
  genBusy = true;
  $<HTMLButtonElement>('generate').disabled = true;
  setPlaying(false);
  try {
    const t0 = performance.now();
    const opts = genOptionsFrom(s, p ?? active);
    const sc = await generate(opts);
    if (p && multiAO) {
      p.settings = { ...s };
      attachScenario(p, sc, true);
      updateMissionTitle();
    } else loadScenario(sc, true);
    t = 0;
    updateTimeMax();
    renderAll();
    renderWidgets(true);
    $('genStatus').textContent = `Loaded ${sc.units.length} tracks, ${sc.graphics.length} control measures in ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
  } catch (e) {
    console.error(e);
    $('genStatus').textContent = 'Load failed: ' + (e as Error).message;
  } finally {
    genBusy = false;
    $<HTMLButtonElement>('generate').disabled = false;
  }
}
const doGenerate = () => generateFor(multiAO ? active : null, collectScenarioSettings());

let regenTimer: number | undefined;
function scheduleRegen() {
  if (!inp('autoRegen').checked) return;
  clearTimeout(regenTimer);
  regenTimer = window.setTimeout(doGenerate, 450);
}

// ================= settings <-> form =================
function settingsElements(): (HTMLInputElement | HTMLSelectElement)[] {
  return [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#settingsDlg input[id], #settingsDlg select[id], #widget input[id], #widget select[id], #speed')].filter(
    (e) => !(e instanceof HTMLInputElement && e.type === 'file') && !['wAo', 'wZoom', 'chatInput', 'camPath'].includes(e.id),
  );
}
function collectSettings(): Settings {
  const s: Settings = {};
  for (const e of settingsElements()) s[e.id] = e instanceof HTMLInputElement && e.type === 'checkbox' ? e.checked : e.value;
  if (sel('ao').value === 'custom' && customCenter) s.center = customCenter.join(',');
  return s;
}
function collectScenarioSettings(): Settings {
  const all = collectSettings();
  const s: Settings = {};
  for (const k of [...SCENARIO_KEYS, 'center']) if (all[k] !== undefined) s[k] = all[k];
  return s;
}
function applySettings(s: Settings, includeView = true) {
  for (const [k, v] of Object.entries(s)) {
    if (k === 'center' || k === 'camPath') continue;
    if (!includeView && !SCENARIO_KEYS.includes(k)) continue;
    const e = document.getElementById(k) as HTMLInputElement | HTMLSelectElement | null;
    if (!e) continue;
    if (e instanceof HTMLInputElement && e.type === 'checkbox') e.checked = v === true || v === 'true';
    else e.value = String(v);
  }
  customCenter = typeof s.center === 'string' && s.center ? (s.center.split(',').map(Number) as LonLat) : null;
  for (const k of PARAM_KEYS) showParam(k);
  $('zoomVal').textContent = inp('zoom').value;
  tplDesc();
  applyDisplayToggles();
  updateVideoHint();
  updateAoInfo();
  sel('recTargetTop').value = sel('recTarget').value;
}

// ================= rendering =================
function renderHud(p: Panel) {
  p.drawPreviewHud(p.stateAt(t, viewOpts()), hudOpts());
}
function renderPanel(p: Panel) {
  if (p.content !== 'map') return;
  const st = p.stateAt(t, viewOpts());
  if (st) p.view.update(st);
  p.drawPreviewHud(st, hudOpts());
}
function renderAll() {
  for (const p of visiblePanels()) renderPanel(p);
  updateTimeLabel();
}
function updateTimeLabel() {
  const sc = scenarioOf();
  if (!sc) return;
  const now = new Date(new Date(sc.meta.start).getTime() + Math.min(t, sc.meta.durationMin) * 60000);
  const tt = `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  $('timeLabel').textContent = `${dtg(now)}   ${tt}`;
  $('topDtg').textContent = dtg(now);
  inp('time').value = String(t);
}

// ================= playback loop =================
let last = 0;
let lastWidget = 0;
let lastFit = 0;
function loop(ts: number) {
  const dt = last ? (ts - last) / 1000 : 0;
  if (playing && active?.scenario) {
    t += dt * Number(sel('speed').value);
    const end = live || flying ? clipEnd() : maxDuration();
    if (t >= end) {
      t = end;
      if (live || flying) finishClip();
      else setPlaying(false);
    }
    for (const p of visiblePanels()) {
      const cam = directed(p, p.scenario ? Math.min(1, t / p.scenario.meta.durationMin) : 0, t);
      if (cam) applyCam(p, cam);
    }
    renderAll();
    if (flying) sampleFlight(ts);
    if (ts - lastWidget > 400) {
      lastWidget = ts;
      renderWidgets();
    }
  }
  // fit-all-units views keep their framing up to date even when paused (resize, scrubbing)
  if (!playing && ts - lastFit > 500) {
    lastFit = ts;
    for (const p of visiblePanels()) {
      if (p.camPath !== 'fit' || p.content !== 'map' || p.view.map.isMoving()) continue;
      const c = fitCamera(p, t);
      if (c) {
        const cur = refCamera(p);
        if (Math.abs(cur.zoom - c.zoom) > 0.05 || Math.hypot(cur.center[0] - c.center[0], cur.center[1] - c.center[1]) > 0.001) applyCam(p, c);
      }
    }
  }
  // live sensor views (scopes animate continuously; imagery sensors refresh when the clock moves)
  for (const p of visiblePanels()) {
    const sv = p.sensorView;
    if (!recording && p.content.startsWith('sensor:') && sv && p.scenario && p.sim && sv.due(t, ts, playing)) sv.renderLive(p.scenario, p.sim, Math.min(t, p.scenario.meta.durationMin), vclock());
  }
  applyPad(dt);
  last = ts;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function setPlaying(p: boolean) {
  if (p && !playing) for (const x of visiblePanels()) x.cameraBase = clipBase(x);
  playing = p;
  $('play').textContent = p ? '❚❚' : '▶';
  if (p && t >= maxDuration()) t = 0;
}
$('play').onclick = () => setPlaying(!playing);
inp('time').oninput = () => {
  t = Number(inp('time').value);
  for (const p of visiblePanels()) {
    const cam = directed(p, p.scenario ? Math.min(1, t / p.scenario.meta.durationMin) : 0, t);
    if (cam) applyCam(p, cam);
  }
  renderAll();
  renderWidgets(true);
};

// ================= top bar =================
const settingsDlg = $<HTMLDialogElement>('settingsDlg');
const libraryDlg = $<HTMLDialogElement>('libraryDlg');
const saveDlg = $<HTMLDialogElement>('saveDlg');
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) => (b.onclick = () => (b.closest('dialog') as HTMLDialogElement).close()));
$('btnSettings').onclick = () => settingsDlg.showModal();
$('btnLibrary').onclick = $('ioLibrary').onclick = () => openLibrary();
$('btnSave').onclick = $('ioSave').onclick = () => openSave();
$('layoutBtns').innerHTML = LAYOUTS.map((l) => `<button class="ico lay" data-l="${l.id}" title="${l.name}">${layoutIcon(l.id)}</button>`).join('');
document.querySelectorAll<HTMLButtonElement>('#layoutBtns button').forEach((b) => (b.onclick = () => setLayout(b.dataset.l as LayoutId)));
function layoutIcon(id: string) {
  const r = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1"/>`;
  const cells: Record<string, string> = {
    '1': r(2, 3, 16, 12),
    '2v': r(2, 3, 7.5, 12) + r(10.5, 3, 7.5, 12),
    '2h': r(2, 3, 16, 5.5) + r(2, 9.5, 16, 5.5),
    '1+2': r(2, 3, 9, 12) + r(12, 3, 6, 5.5) + r(12, 9.5, 6, 5.5),
    '2+1': r(2, 3, 6, 5.5) + r(2, 9.5, 6, 5.5) + r(9, 3, 9, 12),
    '4': r(2, 3, 7.5, 5.5) + r(10.5, 3, 7.5, 5.5) + r(2, 9.5, 7.5, 5.5) + r(10.5, 9.5, 7.5, 5.5),
  };
  return `<svg viewBox="0 0 20 18" width="20" height="18" fill="none" stroke="currentColor" stroke-width="1.4">${cells[id]}</svg>`;
}
$('btnShot').onclick = () => $('shot').click();
$('btnRecord').onclick = () => {
  if (!recording && !live && !screenRec && !flying) $('record').click();
};
$('btnStop').onclick = () => {
  if (bgJob) fetch('/api/render-jobs/' + bgJob, { method: 'DELETE' });
  else if (recording) recSignal.cancelled = true;
  else if (live || screenRec || flying) finishClip();
};
// where recordings are saved (also changeable in the save dialog)
sel('saveTo').value = saveTarget();
sel('saveTo').onchange = async () => {
  if (sel('saveTo').value === 'folder') {
    try {
      $('saveFolder').textContent = '→ ' + (await chooseFolder());
    } catch (e) {
      $('saveFolder').textContent = (e as Error).message;
      sel('saveTo').value = saveTarget();
    }
  } else {
    setSaveTarget(sel('saveTo').value as any);
    $('saveFolder').textContent = sel('saveTo').value === 'project' ? '→ out/recordings/' : '';
  }
};
$('savePick').onclick = async () => {
  try {
    $('saveFolder').textContent = '→ ' + (await chooseFolder());
    sel('saveTo').value = 'folder';
  } catch (e) {
    $('saveFolder').textContent = (e as Error).message;
  }
};
void folderName;
sel('recTargetTop').onchange = () => (sel('recTarget').value = sel('recTargetTop').value);
sel('recTarget').addEventListener('change', () => (sel('recTargetTop').value = sel('recTarget').value));
document.querySelectorAll<HTMLButtonElement>('#setTabs button').forEach(
  (b) =>
    (b.onclick = () => {
      document.querySelectorAll('#setTabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll<HTMLElement>('#settingsDlg .tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === b.dataset.tab));
    }),
);
document.querySelector<HTMLElement>('#settingsDlg .tab[data-tab="scenario"]')!.classList.add('on');

// ================= widget dock =================
let dock!: Dock;
function setupDock() {
  dock = initDock({
    names: { map: 'MAP', layers: 'LAYERS', intel: 'INTEL', orbat: 'ORBAT', fires: 'FIRES', chat: 'CHAT' },
    defaults: ['intel', 'orbat'],
    changed: () => {
      renderWidgets(true);
      requestAnimationFrame(() => panels.forEach((p) => p?.fit()));
    },
  });
}
// ================= workspace layouts (save as default / by name) =================
const TOGGLE_IDS = ['L-friend', 'L-hostile', 'L-air', 'L-graphics', 'L-labels', 'L-fires', 'L-hud', 'strength', 'trails'];
const layoutHost: LayoutHost = {
  capture: () => ({
    dock: dock.getState(),
    views: { layout, active: active.idx, panels: panels.filter(Boolean).map((p) => p.config()), tree: cloneTree(tree) },
    toggles: Object.fromEntries(TOGGLE_IDS.map((id) => {
      const e = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
      return [id, e instanceof HTMLInputElement && e.type === 'checkbox' ? e.checked : e.value];
    })),
  }),
  async apply(l) {
    dock.setState(l.dock);
    if (l.views?.panels?.length) {
      await ensurePanels(l.views.panels.length, l.views.panels);
      for (let i = 0; i < l.views.panels.length; i++) if (panels[i]) await panels[i].applyConfig(l.views.panels[i]);
    }
    if (l.views) {
      await setLayout(normLayout(l.views.layout), (l.views as any).tree);
      setActive(panels[Math.min(l.views.active ?? 0, panels.length - 1)] ?? panels[0]);
    }
    for (const [id, v] of Object.entries(l.toggles ?? {})) {
      const e = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (!e) continue;
      if (e instanceof HTMLInputElement && e.type === 'checkbox') e.checked = !!v;
      else e.value = String(v);
    }
    applyDisplayToggles();
    renderAll();
    renderWidgets(true);
  },
};
$('btnLayouts').onclick = () => openLayouts(layoutHost);

/** API compatibility: make sure a widget is open in the dock */
function showWidget(w: string) {
  if (!dock.open().includes(w)) dock.add(w);
}

// ----- MAP widget -----
function syncMapWidget() {
  if (!active) return;
  inp('wZoom').value = String((active.view.map.getZoom() - zoomAdj(active)).toFixed(1));
}
function syncActiveControls() {
  $('wActive').textContent = active.title;
  document.querySelectorAll<HTMLButtonElement>('#wMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === active.mode));
  sel('camPath').value = active.camPath;
  updateCamDesc();
  syncMapWidget();
  updateKeyInfo();
  updateAoInfo();
}
inp('wZoom').oninput = () => active.view.map.jumpTo({ zoom: Number(inp('wZoom').value) + zoomAdj(active) });
$('wZoomIn').onclick = () => active.view.map.easeTo({ zoom: active.view.map.getZoom() + 0.5, duration: 300 });
$('wZoomOut').onclick = () => active.view.map.easeTo({ zoom: active.view.map.getZoom() - 0.5, duration: 300 });
$('wHome').onclick = () => flyToAO(active);
$('wNorth').onclick = () => active.view.map.easeTo({ bearing: 0, pitch: active.mode === '3d' ? 45 : 0, duration: 500 });
document.querySelectorAll<HTMLButtonElement>('#wMode button').forEach((b) => (b.onclick = () => (active.setMode(b.dataset.m as '2d' | '3d'), syncActiveControls())));
sel('wAo').onchange = () => {
  const a = AO_PRESETS.find((x) => x.id === sel('wAo').value);
  if (a) applyCam(active, { t: 0, center: a.center, zoom: a.zoom, bearing: 0, pitch: active.mode === '3d' ? 45 : 0 });
  sel('wAo').value = '';
};
let padAct: string | null = null;
document.querySelectorAll<HTMLButtonElement>('#camPad button').forEach((b) =>
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (active.camPath !== 'static') {
      active.camPath = 'static';
      active.syncControls();
      syncActiveControls();
    }
    padAct = b.dataset.act!;
  }),
);
window.addEventListener('pointerup', () => (padAct = null));
function applyPad(dt: number) {
  if (!padAct || dt <= 0 || dt > 0.25) return;
  const m = active.view.map;
  const k = ({ rotL: [-45, 0, 0], rotR: [45, 0, 0], tiltUp: [0, -25, 0], tiltDown: [0, 25, 0], zoomIn: [0, 0, 0.6], zoomOut: [0, 0, -0.6] } as Record<string, number[]>)[padAct];
  if (!k) return;
  m.jumpTo({ bearing: m.getBearing() + k[0] * dt, pitch: Math.max(0, Math.min(75, m.getPitch() + k[1] * dt)), zoom: m.getZoom() + k[2] * dt });
  if (!playing) renderPanel(active);
}

// ----- LAYERS widget -----
function applyDisplayToggles() {
  for (const p of panels) {
    if (!p) continue;
    for (const k of ['friend', 'hostile', 'air', 'graphics', 'labels', 'fires'] as const) p.view.layers[k] = inp('L-' + k).checked;
    p.view.showStrength = inp('strength').checked;
    p.view.applyLayers();
  }
}
['L-friend', 'L-hostile', 'L-air', 'L-graphics', 'L-labels', 'L-fires', 'strength'].forEach((id) => (inp(id).onchange = () => (applyDisplayToggles(), renderAll())));
inp('L-hud').onchange = renderAll;
sel('trails').onchange = renderAll;
inp('banner').oninput = renderAll;
sel('markStyle').onchange = renderAll;

// ----- INTEL / ORBAT / FIRES / CHAT widgets -----
let intelFilter = 'all';
document.querySelectorAll<HTMLButtonElement>('#intelFilter button').forEach(
  (b) =>
    (b.onclick = () => {
      intelFilter = b.dataset.k!;
      document.querySelectorAll('#intelFilter button').forEach((x) => x.classList.toggle('on', x === b));
      renderWidgets(true);
    }),
);
/** nominal vehicles / personnel by unit type and echelon (generic, for the ORBAT read-out) */
function establishment(sidc: string): { veh: number; pers: number } | null {
  if (sidc.slice(4, 6) !== '10') return null;
  const e = sidc.slice(10, 16);
  const ech = sidc.slice(8, 10);
  const hq = sidc[7] === '2';
  let veh = 40, pers = 600;
  if (e.startsWith('1205')) (veh = 44), (pers = 550);
  else if (e.startsWith('121102')) (veh = 40), (pers = 650);
  else if (e.startsWith('121104')) (veh = 45), (pers = 700);
  else if (e.startsWith('1211')) (veh = 20), (pers = 750);
  else if (e.startsWith('1213')) (veh = 30), (pers = 420);
  else if (e.startsWith('1303')) (veh = 18), (pers = 450);
  else if (e.startsWith('1301')) (veh = 12), (pers = 300);
  else if (e.startsWith('1407')) (veh = 25), (pers = 450);
  const f = ech === '15' ? 0.28 : ech === '18' ? 4 : ech === '21' ? 12 : 1;
  if (hq) return { veh: Math.round(12 * (ech === '21' ? 3 : ech === '18' ? 2 : 1)), pers: Math.round(250 * (ech === '21' ? 3 : ech === '18' ? 2 : 1)) };
  return { veh: Math.max(4, Math.round(veh * f)), pers: Math.max(40, Math.round(pers * f)) };
}

const symCache = new Map<string, string>();
const miniSym = (sidc: string) => {
  let s = symCache.get(sidc);
  if (!s) {
    s = new ms.Symbol(sidc, { size: 14, colorMode: 'Light' } as any).asSVG();
    symCache.set(sidc, s);
  }
  return s;
};
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
let marker: maplibregl.Marker | null = null;
function flyTo(pos: LonLat) {
  if (active.camPath !== 'static') {
    active.camPath = 'static';
    active.syncControls();
    syncActiveControls();
  }
  const z = Math.max(active.view.map.getZoom(), (active.scenario?.view.zoom ?? 11.7) + 1 + zoomAdj(active));
  active.view.map.easeTo({ center: pos, zoom: z, duration: 800 });
  marker?.remove();
  const el = document.createElement('div');
  el.style.cssText = 'width:34px;height:34px;border:2px solid #f0b03d;border-radius:50%;box-shadow:0 0 12px #f0b03d;';
  marker = new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(active.view.map);
  setTimeout(() => marker?.remove(), 3500);
}
let lastWidgetKey = '';
function renderWidgets(force = false) {
  const sc = scenarioOf();
  if (!sc) return;
  const key = `${dock?.open().join(',')}|${visiblePanels().map((p) => p.content).join(',')}|${Math.floor(t)}|${intelFilter}|${active.idx}|${sc.meta.start}`;
  if (!force && key === lastWidgetKey) return;
  lastWidgetKey = key;
  const D = (x: number) => dtg(new Date(new Date(sc.meta.start).getTime() + x * 60000));
  let rc = reportCache.get(sc);
  if (!rc) reportCache.set(sc, (rc = buildReports(sc)));
  const hosted = visiblePanels().filter((p) => p.content.startsWith('widget:')).map((p) => p.content.slice(7));
  for (const widget of [...new Set([...(dock?.open() ?? []), ...hosted])]) {
  if (widget === 'intel') {
    const list = rc.reports.filter((r) => r.t <= t && r.kind !== 'FIRE' && (intelFilter === 'all' || r.kind === intelFilter)).slice(-80).reverse();
    $('intelList').innerHTML = list.length
      ? list.map((r, i) => `<div class="ritem ${r.severity}" data-i="${i}"><div class="rt"><span class="rk">${r.kind}</span><span>${D(r.t)}</span></div><div class="rtitle">${esc(r.title)}</div><pre>${esc(r.body)}</pre></div>`).join('')
      : '<div class="empty">No reports.</div>';
    $('intelList').querySelectorAll<HTMLElement>('.ritem').forEach((el) => {
      el.onclick = () => {
        el.classList.toggle('open');
        const r = list[Number(el.dataset.i)];
        if (r.pos) flyTo(r.pos);
      };
    });
  } else if (widget === 'fires') {
    const list = rc.reports.filter((r) => r.t <= t && r.kind === 'FIRE').slice(-60).reverse();
    const activeFires = (sc.events ?? []).filter((e) => e.type === 'fire' && e.kind === 'indirect' && e.t <= t && e.t + e.duration >= t).length;
    $('firesActive').textContent = activeFires ? `${activeFires} rounds in the air` : '';
    $('firesList').innerHTML = list.length
      ? list.map((r, i) => `<div class="ritem" data-i="${i}"><div class="rt"><span class="rk">FIRE MISSION</span><span>${D(r.t)}</span></div><div class="rtitle">${esc(r.title)}</div><pre>${esc(r.body)}</pre></div>`).join('')
      : '<div class="empty">No fire missions yet.</div>';
    $('firesList').querySelectorAll<HTMLElement>('.ritem').forEach((el) => {
      el.onclick = () => {
        el.classList.toggle('open');
        const r = list[Number(el.dataset.i)];
        if (r.pos) flyTo(r.pos);
      };
    });
  } else if (widget === 'orbat') {
    const st = active.stateAt(t, viewOpts());
    if (!st) continue;
    const rows = (side: 'friend' | 'hostile') =>
      st.units
        .filter((u) => sideOf(u.sidc) === side)
        .sort((a, b) => (a.unit.air ? 1 : 0) - (b.unit.air ? 1 : 0))
        .map((u) => {
          const m = u.unit.modifiers ?? {};
          const pct = Math.round(u.strength * 100);
          const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--rec)';
          const unknown = side === 'hostile' && active.fog;
          const est = !u.unit.air && !unknown ? establishment(u.sidc) : null;
          const loss = est ? `<span class="orbLoss">${Math.round(est.veh * u.strength)}/${est.veh} veh · ${Math.round(est.pers * (1 - u.strength) * 0.9)} cas</span>` : '';
          return `<div class="orb ${u.status === 'destroyed' ? 'dead' : ''}" data-id="${u.unit.id}"><span class="sym">${miniSym(u.sidc)}</span><span class="nm">${esc(m.uniqueDesignation ?? u.unit.id)}${m.higherFormation ? ' / ' + esc(m.higherFormation) : ''}${u.stale ? ' <i style="color:var(--muted)">(last known)</i>' : ''}${loss}</span>${
            u.unit.air || unknown ? '<span class="pct">—</span>' : `<span class="bar"><i style="width:${pct}%;background:${color}"></i></span><span class="pct">${pct}%</span>`
          }</div>`;
        })
        .join('');
    $('orbatList').innerHTML = `<div class="orbHead f">FRIENDLY</div>${rows('friend')}<div class="orbHead h">ENEMY ${active.fog ? '(Blue COP – detected only)' : ''}</div>${rows('hostile') || '<div class="empty">No enemy units detected.</div>'}`;
    $('orbatList').querySelectorAll<HTMLElement>('.orb').forEach((el) => {
      el.onclick = () => {
        const u = st.units.find((x) => x.unit.id === el.dataset.id);
        if (u) flyTo(u.pos);
      };
    });
  } else if (widget === 'chat') {
    const lines = [...rc.chat.filter((c) => c.t <= t), ...userChat.filter((c) => c.t <= t)].sort((a, b) => a.t - b.t).slice(-120);
    const el = $('chatList');
    el.innerHTML = lines.map((c) => `<div class="cl ${c.from === 'ME' ? 'me' : ''}"><span class="ct">${D(c.t).slice(0, 6)}Z</span><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`).join('') || '<div class="empty">Channel quiet.</div>';
    const body = dock.body('chat') ?? panels.find((p) => p?.content === 'widget:chat')?.widgetBox;
    if (body) body.scrollTop = body.scrollHeight;
  }
  }
}
$('chatSend').onclick = () => {
  const v = inp('chatInput').value.trim();
  if (!v) return;
  userChat.push({ t, from: 'ME', text: v });
  inp('chatInput').value = '';
  renderWidgets(true);
};
inp('chatInput').onkeydown = (e) => e.key === 'Enter' && $('chatSend').click();

// ================= settings modal: scenario tab =================
const tplDesc = () => ($('tplDesc').textContent = TEMPLATES.find((x) => x.id === sel('template').value)?.description ?? '');
sel('template').addEventListener('change', tplDesc);
sel('ao').onchange = () => {
  const a = AO_PRESETS.find((x) => x.id === sel('ao').value);
  if (a) {
    customCenter = null;
    sel('axis').value = String(a.axis);
    applyCam(active, { t: 0, center: a.center, zoom: Number(inp('zoom').value), bearing: 0, pitch: active.mode === '3d' ? 45 : 0 });
  }
  scheduleRegen();
};
inp('zoom').oninput = () => {
  $('zoomVal').textContent = inp('zoom').value;
  updateAoInfo();
};
inp('zoom').onchange = scheduleRegen;
let picking = false;
$('pickAo').onclick = () => {
  picking = true;
  settingsDlg.close();
  active.el.classList.add('picking');
  $('genStatus').textContent = 'Click on the active view to set the AO center…';
};
function endPicking() {
  picking = false;
  panels.forEach((p) => p?.el.classList.remove('picking'));
  settingsDlg.showModal();
}
function updateAoInfo() {
  const z = Number(inp('zoom').value);
  const c = customCenter ?? AO_PRESETS.find((a) => a.id === sel('ao').value)?.center ?? AO_PRESETS[0].center;
  const ext = extentKm(c[1], z, REF_W, 720);
  $('aoInfo').textContent = `Center ${toMgrs(c[0], c[1], 4)} · frame ≈ ${ext.width.toFixed(0)} × ${ext.height.toFixed(0)} km · ${z + 0.6 < 11.5 ? 'division fight (brigades)' : z + 0.6 < 13.7 ? 'brigade fight (battalions)' : 'battalion fight (companies)'}`;
}
['template', 'blue', 'red', 'air', 'movement', 'riverine', 'seed', 'axis', 'p-counterattack', ...PARAM_KEYS.map((k) => 'p-' + k)].forEach((id) => $(id).addEventListener('change', scheduleRegen));
$('dice').onclick = () => {
  inp('seed').value = String(Math.floor(Math.random() * 99999));
  scheduleRegen();
};
$('generate').onclick = () => doGenerate();
inp('multiAO').onchange = async () => {
  multiAO = inp('multiAO').checked;
  if (multiAO) {
    await setLayout('4');
    for (const p of panels) if (p && !p.settings) p.settings = collectScenarioSettings();
    updateMissionTitle();
  } else {
    const sc = active.scenario;
    if (sc) loadScenario(sc, false);
  }
};

// ================= camera & video tab =================
function updateCamDesc() {
  const info = CAMERA_PATHS.find((c) => c.id === sel('camPath').value);
  sel('camPath').title = info?.description ?? '';
  $('camDesc').textContent = info?.description ?? '';
}
sel('camPath').onchange = () => {
  active.setCamPath(sel('camPath').value as CameraPath);
  active.cameraBase = clipBase(active);
  updateCamDesc();
  const cam = directed(active, active.scenario ? t / active.scenario.meta.durationMin : 0, t);
  if (cam) applyCam(active, cam);
  renderAll();
};
function updateKeyInfo() {
  const sc = active?.scenario;
  const n = sc?.camera?.length ?? 0;
  $('keyInfo').textContent = n ? `Keyframes: ${n} (T+${Math.round(sc!.camera![0].t)} … T+${Math.round(sc!.camera![n - 1].t)}). Select "My Keyframes" to use them.` : 'Keyframes: 0. Frame the active view, scrub the time, then add a keyframe.';
}
$('addKey').onclick = () => {
  const sc = active.scenario;
  if (!sc) return;
  sc.camera = (sc.camera ?? []).filter((k) => Math.abs(k.t - t) > 0.5);
  sc.camera.push(refCamera(active));
  sc.camera.sort((a, b) => a.t - b.t);
  active.director = new CameraDirector(sc);
  updateKeyInfo();
};
$('clearKeys').onclick = () => {
  if (active.scenario) active.scenario.camera = [];
  updateKeyInfo();
};
function updateVideoHint() {
  const sc = scenarioOf();
  if (!sc) return;
  const secs = Math.max(1, Number(inp('vlen').value) || 30);
  const from = Number(inp('vfrom').value) || 0;
  const to = clipEnd();
  const pace = ((to - from) * 60) / secs;
  $('vHint').textContent = `${secs} s of video covers T+${Math.round(from)}–${Math.round(to)} min of the mission (${pace.toFixed(0)}× real time, ${Math.round(secs * Number(sel('fps').value))} frames). Speed it up later in your editor if needed.`;
}
['vlen', 'vfrom', 'vto', 'fps', 'vpace'].forEach((id) => $(id).addEventListener('input', updateVideoHint));
const clipStart = () => Math.max(0, Number(inp('vfrom').value) || 0);
/** end of the recorded clip: explicit To T+, otherwise From + video length × pace */
const clipEnd = () => {
  const dur = scenarioOf()?.meta.durationMin ?? 0;
  const to = Number(inp('vto').value);
  if (to) return Math.min(dur, to);
  const secs = Math.max(1, Number(inp('vlen').value) || 30);
  return Math.min(dur, clipStart() + (secs * Number(sel('vpace').value || 30)) / 60);
};
function resolution(): [number, number] {
  const [w, h] = sel('res').value.split('x').map(Number);
  return [w, h];
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'mission';
/** default file name: operation codename + mission time window + local date/time */
function fileBase(kind: string, tFrom = t, tTo?: number) {
  const sc = scenarioOf();
  const op = (sc?.meta.title ?? sc?.meta.name ?? 'mission').split(' · ')[0];
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const tt = tTo !== undefined ? `T${Math.round(tFrom)}-${Math.round(tTo)}` : `T${Math.round(tFrom)}`;
  return `${slug(op)}_${kind}_${tt}_${stamp}`;
}
async function saveFile(blob: Blob, name: string, info: string) {
  const where = await saveOutput(blob, name, info);
  $('recStatus').textContent = where ? `Saved → ${where}` : 'Discarded.';
  $('topRec').textContent = where ? `✓ saved` : '';
  setTimeout(() => ($('topRec').textContent === '✓ saved' ? ($('topRec').textContent = '') : 0), 4000);
}
function setRecUI(on: boolean, label = '') {
  dock?.freeze(on);
  $<HTMLButtonElement>('btnStop').disabled = !on;
  $('btnStop').classList.toggle('armed', on);
  $('btnRecord').classList.toggle('recording', on);
  $('topRec').textContent = label;
  active.el.classList.toggle('recording', on && sel('recTarget').value === 'view');
}

// ---------- fly & capture ----------
let flying = false;
let lastSample = 0;
let lastBearing = 0;
function sampleFlight(ts: number) {
  const sc = active.scenario;
  if (!sc || ts - lastSample < 250) return;
  lastSample = ts;
  const c = refCamera(active);
  let b = c.bearing ?? 0;
  while (b - lastBearing > 180) b -= 360;
  while (b - lastBearing < -180) b += 360;
  lastBearing = b;
  c.bearing = b;
  (sc.camera ??= []).push(c);
}
$('flyCapture').onclick = () => {
  const sc = active.scenario;
  if (!sc) return;
  if (flying) return finishClip();
  flying = true;
  sc.camera = [];
  lastBearing = active.view.map.getBearing();
  active.camPath = 'static';
  active.syncControls();
  syncActiveControls();
  t = clipStart();
  $('flyCapture').textContent = '■ Stop capturing';
  $('flyCapture').classList.add('active-rec');
  settingsDlg.close();
  setRecUI(true, 'CAPTURING CAMERA…');
  setPlaying(true);
};

// ---------- live / screen recording ----------
let live: LiveRecording | null = null;
let screenRec: { rec: MediaRecorder; chunks: Blob[]; stream: MediaStream; mime: string; label: string } | null = null;
let livePrevPr = 1;
async function startLive() {
  const sc = active.scenario;
  if (!sc) return;
  const [W, H] = resolution();
  const fps = Number(sel('fps').value);
  livePrevPr = active.view.pixelRatio;
  await active.view.setPixelRatio(W / active.captureRect().w);
  active.view.map.resize();
  t = clipStart();
  const p = active;
  live = await startLiveRecording({
    width: W,
    height: H,
    fps,
    bitrate: W >= 3840 ? 40e6 : W >= 2560 ? 20e6 : 12e6,
    draw: (out) => {
      const st = p.stateAt(t, viewOpts());
      if (st) p.compose(out, st, hudOpts());
    },
  });
  settingsDlg.close();
  setRecUI(true, 'LIVE ● steer the camera');
  setPlaying(true);
}
async function startScreenCapture(target: HTMLElement) {
  const fps = Number(sel('fps').value);
  const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: { frameRate: fps }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
  const [track] = stream.getVideoTracks();
  try {
    if ((window as any).CropTarget && (track as any).cropTo) await (track as any).cropTo(await (window as any).CropTarget.fromElement(target));
  } catch (e) {
    console.warn('[scc] region capture unavailable', e);
  }
  const mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4;codecs=avc1' : MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);
  screenRec = { rec, chunks, stream, mime, label: target.id === 'app' ? 'window' : target.id === 'workspace' ? 'workspace' : 'view' };
  track.addEventListener('ended', () => screenRec && finishClip());
  t = clipStart();
  settingsDlg.close();
  setRecUI(true, 'SCREEN ● recording');
  setPlaying(true);
}
async function finishClip() {
  if (flying) {
    flying = false;
    setPlaying(false);
    setRecUI(false);
    $('flyCapture').textContent = '✈ Fly & capture camera path (real time)';
    $('flyCapture').classList.remove('active-rec');
    if (active.scenario?.camera?.length) {
      active.director = new CameraDirector(active.scenario);
      active.setCamPath('keyframes');
      syncActiveControls();
      sel('recMode').value = 'offline';
      $('keyInfo').textContent += ' Captured flight selected. Press ● Record (frame-perfect) to render it.';
    }
  }
  if (live) {
    const rec = live;
    live = null;
    setPlaying(false);
    setRecUI(false);
    const r = await rec.stop();
    await active.view.setPixelRatio(livePrevPr);
    active.view.map.resize();
    renderAll();
    const liveEnd = t;
    resetMission();
    await saveFile(r.blob, `${fileBase('live', clipStart(), liveEnd)}.${r.ext}`, 'Live recording – map view');
  }
  if (screenRec) {
    const s = screenRec;
    screenRec = null;
    setPlaying(false);
    setRecUI(false);
    await new Promise<void>((res) => {
      s.rec.onstop = () => res();
      s.rec.stop();
    });
    s.stream.getTracks().forEach((x) => x.stop());
    const blob = new Blob(s.chunks, { type: s.mime.split(';')[0] });
    const scrEnd = t;
    resetMission();
    await saveFile(blob, `${fileBase(s.label, clipStart(), scrEnd)}.${s.mime.includes('mp4') ? 'mp4' : 'webm'}`, s.label === 'window' ? 'Entire Pegasus C2 Studio window' : s.label === 'view' ? 'Single view (screen capture)' : 'All views');
  }
}

// ---------- frame-perfect (offline) ----------
async function withCaptureResolution<T>(p: Panel, W: number, fn: () => Promise<T>): Promise<T> {
  const prevPr = p.view.pixelRatio;
  await p.view.setPixelRatio(W / p.captureRect().w);
  p.view.map.resize();
  try {
    return await fn();
  } finally {
    await p.view.setPixelRatio(prevPr);
    p.view.map.resize();
    renderAll();
  }
}
async function composeFrame(p: Panel, tt: number, out: HTMLCanvasElement, cam?: CameraKey | null, vt = vclock()) {
  if (p.content.startsWith('sensor:') && p.sensorView && p.scenario && p.sim) return p.sensorView.renderTo(out, p.scenario, p.sim, tt, vt);
  if (p.content.startsWith('widget:')) throw new Error('The active view shows a widget – pick a map or sensor view, or record the entire window.');
  const st = p.stateAt(tt, viewOpts());
  if (!st) throw new Error('No mission loaded');
  await p.view.renderFrame(st, cam ? { ...cam, zoom: cam.zoom + zoomAdj(p) } : undefined);
  p.compose(out, st, hudOpts());
}
async function screenshot(): Promise<Blob> {
  const [W, H] = resolution();
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  await withCaptureResolution(active, W, () => composeFrame(active, t, out));
  return await new Promise<Blob>((r) => out.toBlob((b) => r(b!), 'image/png'));
}
$('shot').onclick = async () => {
  if (!active.scenario) return;
  const tp = targetPanel();
  if (tp && tp !== active) setActive(tp);
  if (active.content.startsWith('widget:')) {
    $('recStatus').textContent = 'Widget views can be recorded as video (background or screen capture); screenshots are for map and sensor views.';
    return;
  }
  await saveFile(await screenshot(), `${fileBase('screenshot')}.png`, 'Screenshot – map view');
};
const recSignal = { cancelled: false };
let recording = false;
async function recordOffline() {
  const p = active;
  const sc = p.scenario!;
  const [W, H] = resolution();
  const fps = Number(sel('fps').value);
  const seconds = Math.max(1, Number(inp('vlen').value) || 30);
  const from = clipStart();
  const to = clipEnd();
  const frames = Math.round(seconds * fps);
  setPlaying(false);
  p.cameraBase = clipBase(p);
  recSignal.cancelled = false;
  const t0 = performance.now();
  return withCaptureResolution(p, W, () =>
    recordVideo({
      width: W,
      height: H,
      fps,
      frames,
      bitrate: W >= 3840 ? 40e6 : W >= 2560 ? 20e6 : 12e6,
      signal: recSignal,
      renderFrame: async (i, out) => {
        const prog = i / Math.max(1, frames - 1);
        t = from + (to - from) * prog;
        await composeFrame(p, t, out, directed(p, prog, t), i / fps);
        updateTimeLabel();
        if (i % 15 === 0) renderWidgets();
      },
      onProgress: (d, n) => {
        $('recBar').style.width = `${(100 * d) / n}%`;
        const el = (performance.now() - t0) / 1000;
        const msg = `Frame ${d}/${n} · ETA ${Math.round(((n - d) * el) / d)} s`;
        $('recStatus').textContent = msg;
        $('topRec').textContent = '● ' + msg;
        (window as any).sccProgress?.(d, n);
      },
    }),
  ).then((r) => ({ ...r, name: sc.meta.name }));
}
/** back to the start of the clip: stop playback, restore every view's camera and the dock */
function resetMission(toStart = clipStart()) {
  setPlaying(false);
  t = Math.max(0, toStart);
  for (const p of panels) {
    if (!p?.scenario) continue;
    p.cameraBase = clipBase(p);
    const cam = directed(p, Math.min(1, t / p.scenario.meta.durationMin), t);
    if (cam) applyCam(p, cam);
    else if (p.camPath === 'static' && p.content === 'map') flyToAO(p);
    p.sensorView?.sensor.reset?.();
    if (p.sensorView) p.sensorView.lastT = -1;
  }
  dock?.freeze(false);
  $('recBar').style.width = '0%';
  updateTimeLabel();
  renderAll();
  renderWidgets(true);
}
$('btnReset').onclick = () => {
  $('btnReset').classList.remove('spin');
  void $('btnReset').offsetWidth;
  $('btnReset').classList.add('spin');
  resetMission(0);
};

// ---------- background rendering (separate headless Chrome, nothing rendered in this tab) ----------
let bgJob: string | null = null;
async function startBackground() {
  const p = active;
  const name = prompt('File name for the background render (saved in out/recordings/):', `${fileBase('map', clipStart(), clipEnd())}.mp4`);
  if (!name) return;
  const pkg = buildPackage(scenarioOf()?.meta.title ?? 'mission', 'background render', true);
  const r = await fetch('/api/render-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: pkg, view: p.idx, camera: refCamera(p), settings: collectSettings(), fileName: name.endsWith('.mp4') || name.endsWith('.webm') ? name : name + '.mp4' }),
  });
  if (!r.ok) throw new Error('background rendering needs the dev server (start.bat)');
  bgJob = (await r.json()).id;
  settingsDlg.close();
  setRecUI(true, '◌ background render starting…');
  dock?.freeze(false); // nothing is captured from this tab, the dock may reflow freely
  $('recStatus').textContent = 'Rendering in a separate headless browser – you can keep working.';
  const poll = async () => {
    if (!bgJob) return;
    const s = await (await fetch('/api/render-jobs/' + bgJob)).json();
    const pr = s.progress?.total ? `${s.progress.done}/${s.progress.total}` : '';
    if (s.status === 'done') {
      bgJob = null;
      setRecUI(false);
      $('recBar').style.width = '100%';
      const f = String(s.file).split(/[\\/]/).pop();
      $('recStatus').innerHTML = `Background render saved → ${s.file} (${(s.size / 1e6).toFixed(1)} MB) · <a href="/api/recordings/${encodeURIComponent(f ?? "")}" download>download</a>`;
      $('topRec').textContent = '✓ background render saved';
      return;
    }
    if (s.status === 'error' || s.status === 'cancelled') {
      bgJob = null;
      setRecUI(false);
      $('recStatus').textContent = `Background render ${s.status}${s.error ? ': ' + s.error : ''}`;
      $('topRec').textContent = '';
      return;
    }
    if (s.progress?.total) $('recBar').style.width = `${(100 * s.progress.done) / s.progress.total}%`;
    $('topRec').textContent = `◌ background ${s.status} ${pr}`;
    setTimeout(poll, 1000);
  };
  poll();
}

$('record').onclick = async () => {
  if (bgJob) {
    await fetch('/api/render-jobs/' + bgJob, { method: 'DELETE' });
    return;
  }
  if (live || screenRec) return finishClip();
  if (recording) {
    recSignal.cancelled = true;
    return;
  }
  if (!active.scenario) {
    $('recStatus').textContent = 'Load a mission first.';
    return;
  }
  const target = sel('recTarget').value;
  try {
    if (target === 'workspace') return await startScreenCapture($('workspace'));
    if (target === 'screen') return await startScreenCapture($('app'));
    // a specific view: make it the active one, then record it with the chosen mode
    const tp = targetPanel();
    if (tp && tp !== active) setActive(tp);
    if (active.content.startsWith('widget:')) {
      if (sel('recMode').value === 'background') return await startBackground();
      return await startScreenCapture(active.el); // widgets are live HTML: real-time capture of just this view
    }
    if (sel('recMode').value === 'live') return await startLive();
    if (sel('recMode').value === 'background') return await startBackground();
    recording = true;
    setRecUI(true, '● rendering…');
    $('record').textContent = '■ Stop';
    const from = clipStart();
    const r = await recordOffline();
    const stopped = recSignal.cancelled;
    recording = false;
    setRecUI(false);
    $('record').textContent = '● Record video';
    const endT = t;
    resetMission(from);
    await saveFile(r.blob, `${fileBase('map', from, endT)}.${r.ext}`, stopped ? 'Stopped early – partial video' : 'Frame-perfect map view');
  } catch (e) {
    console.error(e);
    $('recStatus').textContent = 'Recording failed: ' + (e as Error).message;
    resetMission();
  } finally {
    if (recording) {
      recording = false;
      setRecUI(false);
      $('record').textContent = '● Record video';
    }
  }
};

// ================= packages: save / library / import =================
function buildPackage(name: string, description: string, includeBattle: boolean): ScenarioPackage {
  return {
    format: 'scc-package',
    version: 1,
    name,
    description,
    created: new Date().toISOString(),
    settings: collectSettings(),
    workspace: {
      layout,
      tree: cloneTree(tree),
      multiAO,
      active: active.idx,
      panels: panels.filter(Boolean).map((p) => p.config()),
      panelSettings: multiAO ? panels.map((p) => p?.settings ?? null) : undefined,
    },
    scenario: includeBattle && !multiAO ? active.scenario : null,
    panelScenarios: includeBattle && multiAO ? panels.map((p) => p?.scenario ?? null) : undefined,
  };
}

async function applyPackage(pkg: ScenarioPackage) {
  setPlaying(false);
  libraryDlg.close();
  $('genStatus').textContent = `Loading "${pkg.name}"…`;
  $('topRec').textContent = `Loading ${pkg.name}…`;
  applySettings(pkg.settings, true);
  multiAO = !!pkg.workspace?.multiAO;
  inp('multiAO').checked = multiAO;
  const ws = pkg.workspace;
  const n = multiAO ? 4 : Math.max(layoutCount(ws?.layout), ws?.panels?.length ?? 1, ws?.tree ? Math.max(...leaves(ws.tree)) + 1 : 1);
  await ensurePanels(n, ws?.panels);
  for (let i = 0; i < (ws?.panels?.length ?? 0); i++) if (panels[i]) await panels[i].applyConfig(ws.panels[i]);
  await setLayout(multiAO ? '4' : normLayout(ws?.layout), multiAO ? undefined : ws?.tree);
  setActive(panels[Math.min(ws?.active ?? 0, panels.length - 1)] ?? panels[0]);
  if (multiAO) {
    for (let i = 0; i < 4; i++) {
      const s = { ...pkg.settings, ...(ws.panelSettings?.[i] ?? {}) };
      panels[i].settings = s;
      const sc = pkg.panelScenarios?.[i];
      if (sc) attachScenario(panels[i], sc, true);
      else await generateFor(panels[i], s);
    }
    updateMissionTitle();
    applySettings(panels[active.idx].settings!, false);
  } else if (pkg.scenario) {
    loadScenario(pkg.scenario, true);
    updateMissionTitle();
  } else {
    await generateFor(null, collectScenarioSettings());
    updateMissionTitle();
  }
  for (const p of panels) if (p) p.cameraBase = clipBase(p);
  applyDisplayToggles();
  t = 0;
  updateTimeMax();
  renderAll();
  renderWidgets(true);
  syncActiveControls();
  $('topRec').textContent = '';
}

async function openLibrary() {
  settingsDlg.close();
  const card = (name: string, desc: string, tags: string[], btns: string) =>
    `<div class="card"><div class="cn">${esc(name)}</div><div class="cd">${esc(desc)}</div><div class="ctags">${tags.map((x) => `<span>${esc(x)}</span>`).join('')}</div><div class="cbtn">${btns}</div></div>`;
  const tagsOf = (p: ScenarioPackage) => {
    const s = p.settings;
    const cam = CAMERA_PATHS.find((c) => c.id === p.workspace?.panels?.[p.workspace.active ?? 0]?.camPath)?.name;
    return [
      AO_PRESETS.find((a) => a.id === s.ao)?.name.split(',')[0] ?? 'Custom AO',
      TEMPLATES.find((x) => x.id === s.template)?.name.split(' (')[0] ?? '',
      p.workspace?.multiAO ? '4 AOs' : (p.workspace?.tree ? leaves(p.workspace.tree).length : layoutCount(p.workspace?.layout)) > 1 ? `${p.workspace?.tree ? leaves(p.workspace.tree).length : layoutCount(p.workspace?.layout)} views` : '1 view',
      cam ? '🎥 ' + cam : '',
      `${s.vlen ?? 30}s ${s.res ?? ''}`,
    ].filter(Boolean);
  };
  $('libBuiltin').innerHTML = BUILTIN_PACKAGES.map((p, i) => card(p.name, p.description, tagsOf(p), `<button data-b="${i}" class="primary">Load</button>`)).join('');
  $('libBuiltin').querySelectorAll<HTMLButtonElement>('button[data-b]').forEach((b) => (b.onclick = () => applyPackage(structuredClone(BUILTIN_PACKAGES[Number(b.dataset.b)]))));
  $('libSaved').innerHTML = '<div class="empty">Loading…</div>';
  libraryDlg.showModal();
  const saved = await listSaved();
  $('libSaved').innerHTML = saved.length
    ? saved.map((e) => card(e.name, e.description || '(no description)', [e.created ? new Date(e.created).toLocaleString() : e.file], `<button data-f="${esc(e.file)}" class="primary">Load</button><button data-d="${esc(e.file)}">Delete</button>`)).join('')
    : '<div class="empty">No saved missions yet. Use 💾 to save one.</div>';
  $('libSaved').querySelectorAll<HTMLButtonElement>('button[data-f]').forEach((b) => (b.onclick = async () => applyPackage(await loadSaved(b.dataset.f!))));
  $('libSaved').querySelectorAll<HTMLButtonElement>('button[data-d]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm(`Delete saved mission "${b.dataset.d}"?`)) return;
        await deleteSaved(b.dataset.d!);
        openLibrary();
      }),
  );
}
inp('libFile').onchange = async () => {
  const f = inp('libFile').files?.[0];
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.format === 'scc-package') await applyPackage(j);
    else loadScenario(j as Scenario, true);
  } catch (e) {
    alert('Could not load: ' + (e as Error).message);
  }
  inp('libFile').value = '';
};

function openSave() {
  settingsDlg.close();
  inp('saveName').value = scenarioOf()?.meta.title ?? scenarioOf()?.meta.name ?? 'My mission';
  $<HTMLTextAreaElement>('saveDesc').value = '';
  $('saveStatus').textContent = '';
  saveDlg.showModal();
}
$('saveDisk').onclick = async () => {
  const pkg = buildPackage(inp('saveName').value || 'Mission', $<HTMLTextAreaElement>('saveDesc').value, inp('saveBattle').checked);
  try {
    const f = await saveToDisk(pkg);
    $('saveStatus').textContent = `Saved to scenarios/saved/${f}`;
    updateMissionTitle();
  } catch (e) {
    $('saveStatus').textContent = 'Save failed: ' + (e as Error).message + ' – use Download instead.';
  }
};
$('saveDownload').onclick = () => {
  const pkg = buildPackage(inp('saveName').value || 'Mission', $<HTMLTextAreaElement>('saveDesc').value, inp('saveBattle').checked);
  download(new Blob([JSON.stringify(pkg)], { type: 'application/json' }), `${slug(pkg.name)}.scc.json`);
  $('saveStatus').textContent = 'Downloaded.';
};
inp('importFile').onchange = async () => {
  const f = inp('importFile').files?.[0];
  if (!f) return;
  try {
    if (f.name.endsWith('.scc.json')) {
      const j = JSON.parse(await f.text());
      if (j.format === 'scc-package') await applyPackage(j);
    } else {
      const sc = await importFile(f);
      loadScenario(sc, true);
      $('genStatus').textContent = `Imported ${f.name}: ${sc.units.length} units, ${sc.graphics.length} graphics.`;
    }
  } catch (e) {
    $('genStatus').textContent = 'Import failed: ' + (e as Error).message;
  }
  inp('importFile').value = '';
};

// ================= automation API (headless tests / CLI) =================
(window as any).scc = {
  ready: false,
  panels,
  get active() {
    return active;
  },
  get t() {
    return t;
  },
  async generate(o: Partial<Settings> = {}) {
    applySettings({ ...collectSettings(), ...o } as Settings, false);
    await generateFor(multiAO ? active : null, collectScenarioSettings());
    return active.scenario;
  },
  applyPackage,
  builtins: BUILTIN_PACKAGES,
  setLayout,
  setTime(x: number) {
    t = x;
    renderAll();
    renderWidgets(true);
  },
  showWidget,
  /** used by cli/render-worker.mjs: render the given view frame-perfectly with the given video settings */
  async renderJob(o: { view: number; camera?: CameraKey; settings: Settings }) {
    applySettings(o.settings, true);
    document.body.classList.add('headless-render');
    const p = panels[o.view] ?? active;
    setActive(p);
    maximized = true;
    renderLayout();
    await new Promise((r) => setTimeout(r, 800));
    p.fit();
    if (o.camera && p.camPath === 'static') applyCam(p, o.camera);
    recording = true; // pauses live sensor refreshes in this page
    let r;
    try {
      r = await recordOffline();
    } finally {
      recording = false;
    }
    renderedVideo = r.blob;
    return { size: r.blob.size, ext: r.ext, frames: Math.round((Number(inp('vlen').value) || 30) * Number(sel('fps').value)) };
  },
  /** worker, widget views: maximize the view and report where it is, then frames are fed with encodeFrame() */
  async prepareWidgetJob(o: { view: number; settings: Settings }) {
    applySettings(o.settings, true);
    document.body.classList.add('headless-render');
    const p = panels[o.view] ?? active;
    setActive(p);
    maximized = true;
    renderLayout();
    await new Promise((r) => setTimeout(r, 600));
    const r = p.el.getBoundingClientRect();
    const fps = Number(sel('fps').value);
    const frames = Math.round((Number(inp('vlen').value) || 30) * fps);
    widgetEnc = await createEncoder({ width: Math.round(r.width), height: Math.round(r.height), fps });
    return { clip: { x: Math.round(r.x), y: Math.round(r.y), width: widgetEnc.width, height: widgetEnc.height }, frames, fps, from: clipStart(), to: clipEnd() };
  },
  async setWidgetTime(tt: number) {
    t = tt;
    updateTimeLabel();
    renderWidgets(true);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  },
  async encodeFrame(b64: string, i: number) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/jpeg' }));
    await widgetEnc!.add(bmp, i);
    bmp.close();
  },
  async finishWidgetJob() {
    const r = await widgetEnc!.finish();
    renderedVideo = r.blob;
    return { size: r.blob.size, ext: r.ext };
  },
  async chunk(i: number, size = 4 * 1024 * 1024) {
    if (!renderedVideo) return null;
    const part = renderedVideo.slice(i * size, (i + 1) * size);
    if (!part.size) return null;
    const buf = new Uint8Array(await part.arrayBuffer());
    let s = '';
    for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
    return btoa(s);
  },
};
let renderedVideo: Blob | null = null;
let widgetEnc: Awaited<ReturnType<typeof createEncoder>> | null = null;
(window as any).sccState = () => active?.stateAt(t, viewOpts());

// ================= boot =================
async function bootCop() {
  await ensurePanels(1);
  active = panels[0];
  active.el.classList.add('active');
  await setLayout('1');
  setupDock();
  inp('zoom').value = '11.7';
  $('zoomVal').textContent = '11.7';
  sel('axis').value = String(AO_PRESETS[0].axis);
  tplDesc();
  updateAoInfo();
  syncActiveControls();
  (window as any).scc.ready = true;
  const pkgParam = params.get('pkg');
  if (pkgParam && BUILTIN_PACKAGES[Number(pkgParam)]) await applyPackage(structuredClone(BUILTIN_PACKAGES[Number(pkgParam)]));
  else if (!headless && params.get('autogen') !== '0') await applyPackage(structuredClone(BUILTIN_PACKAGES[0]));
  // the user's default workspace layout wins over the mission's view layout at start-up
  const def = await applyDefaultLayout(layoutHost);
  if (def) $('genStatus').textContent += ` · layout "${def}"`;
}

initHome({ startCop: bootCop });
