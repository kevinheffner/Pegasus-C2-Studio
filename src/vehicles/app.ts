/**
 * 3D Vehicle Simulations: CesiumJS (Apache-2.0) globe with real terrain + imagery from free, keyless sources
 * (AWS terrarium elevation via a custom heightmap provider, EOX Sentinel-2 / OpenTopoMap / OSM imagery),
 * sun/atmosphere/shadows, animated water, and procedural generic aircraft, ground vehicles and ships.
 * Scenes are animated along real roads / rivers / flight paths; cinematic camera modes; frame-perfect MP4.
 */
import './cesium-base';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { DEM_TILES } from '../render/looks';
import { loadNetwork, route } from '../geo/roads';
import { recordVideo } from '../export/recorder';
import { saveOutput as download } from '../export/save';
import { CAMO, MODEL_INFO, modelUrl, type ModelKind } from './models';
import type { LonLat, Scenario } from '../scenario/types';
import { sampleTrack } from '../scenario/sim';
import { targetClass } from '../sensor/common';

Cesium.Ion.defaultAccessToken = '';

// ---------------- terrain: AWS terrarium tiles → Cesium heightmaps ----------------
const tileCache = new Map<string, Promise<Float32Array | null>>();
function terrariumTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  let p = tileCache.get(key);
  if (!p) {
    p = fetch(DEM_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
      .then((r) => (r.ok ? r.blob() : null))
      .then(async (b) => {
        if (!b) return null;
        const bmp = await createImageBitmap(b);
        const c = new OffscreenCanvas(256, 256);
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, 256, 256).data;
        const h = new Float32Array(256 * 256);
        for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        return h;
      })
      .catch(() => null);
    tileCache.set(key, p);
  }
  return p;
}
const HM = 65;
function terrainProvider() {
  return new Cesium.CustomHeightmapTerrainProvider({
    width: HM,
    height: HM,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    callback: async (x, y, level) => {
      // above z14 sample a sub-window of the z14 parent tile
      const z = Math.min(level, 14);
      const div = 2 ** (level - z);
      const px = Math.floor(x / div), py = Math.floor(y / div);
      const src = await terrariumTile(z, px, py);
      const out = new Float32Array(HM * HM);
      if (!src) return out;
      const ox = ((x % div) / div) * 255, oy = ((y % div) / div) * 255, span = 255 / div;
      for (let j = 0; j < HM; j++)
        for (let i = 0; i < HM; i++) {
          const sx = ox + (i / (HM - 1)) * span, sy = oy + (j / (HM - 1)) * span;
          const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
          const fx = sx - x0, fy = sy - y0;
          const v = src[y0 * 256 + x0] * (1 - fx) * (1 - fy) + src[y0 * 256 + x1] * fx * (1 - fy) + src[y1 * 256 + x0] * (1 - fx) * fy + src[y1 * 256 + x1] * fx * fy;
          out[j * HM + i] = Math.max(-50, v);
        }
      return out;
    },
  });
}

const IMAGERY: Record<string, () => Cesium.ImageryProvider> = {
  sat: () => new Cesium.UrlTemplateImageryProvider({ url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg', maximumLevel: 15, credit: 'Sentinel-2 cloudless 2016 by EOX (CC BY 4.0)' }),
  topo: () => new Cesium.UrlTemplateImageryProvider({ url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subdomains: 'abc', maximumLevel: 17, credit: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' }),
  osm: () => new Cesium.UrlTemplateImageryProvider({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maximumLevel: 19, credit: '© OpenStreetMap contributors' }),
};

// ---------------- scenes ----------------
interface Mover {
  kind: ModelKind;
  path: LonLat[];
  /** height mode: 'ground' (baked terrain height), 'agl' (m above terrain), 'msl' (absolute), 'sea' */
  alt: { mode: 'ground' | 'agl' | 'msl' | 'sea'; m: number };
  speedKph: number;
  offsetM: number; // spacing behind the lead along the path
  lateralM?: number;
  delayS?: number;
  camo?: number;
  label?: string;
}
interface SceneDef {
  id: string;
  name: string;
  description: string;
  center: LonLat;
  hour: number;
  date?: string;
  durationS: number;
  build(): Promise<Mover[]>;
  water?: boolean;
}

const line = (a: LonLat, b: LonLat, n = 2): LonLat[] => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)]);
const arc = (c: LonLat, rKm: number, a0: number, a1: number, n = 40): LonLat[] =>
  Array.from({ length: n }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180;
    return [c[0] + (rKm * Math.sin(a)) / (111.32 * Math.cos((c[1] * Math.PI) / 180)), c[1] + (rKm * Math.cos(a)) / 111.32];
  });

async function roadPath(from: LonLat, to: LonLat): Promise<LonLat[]> {
  const pad = 0.04;
  const net = await loadNetwork('roads', { s: Math.min(from[1], to[1]) - pad, n: Math.max(from[1], to[1]) + pad, w: Math.min(from[0], to[0]) - pad, e: Math.max(from[0], to[0]) + pad });
  return (net && route(net, from, to)) || line(from, to, 10);
}
async function riverPath(center: LonLat, km: number): Promise<LonLat[]> {
  const d = km / 111;
  const net = await loadNetwork('rivers', { s: center[1] - d, n: center[1] + d, w: center[0] - d * 1.5, e: center[0] + d * 1.5 });
  if (!net || !net.lines.length) return line([center[0] - d, center[1]], [center[0] + d, center[1]], 10);
  const len = (l: LonLat[]) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);
  // stitch the longest river line
  return net.lines.reduce((b, l) => (len(l) > len(b) ? l : b), net.lines[0]);
}

const SCENES: SceneDef[] = [
  {
    id: 'column',
    name: 'Armored column on the march',
    description: 'Tanks, IFVs and trucks road-marching along real roads near Fulda (OSM routing), terrain-following.',
    center: [9.83, 50.6],
    hour: 8.5,
    durationS: 60,
    async build() {
      const p = await roadPath([9.775, 50.585], [9.875, 50.615]);
      const kinds: ModelKind[] = ['mbt', 'mbt', 'ifv', 'mbt', 'ifv', 'sph', 'truck', 'truck'];
      return kinds.map((k, i) => ({ kind: k, path: p, alt: { mode: 'ground', m: 0 }, speedKph: 32, offsetM: i * 55, label: `${k.toUpperCase()} ${i + 1}` }));
    },
  },
  {
    id: 'helo',
    name: 'Helicopter low-level along a river',
    description: 'Two helicopters nap-of-the-earth along the Rhine gorge (Lorelei) at ~60 m above the river, with a fighter pass.',
    center: [7.73, 50.14],
    hour: 17.5,
    durationS: 50,
    async build() {
      const r = await riverPath([7.73, 50.14], 6);
      return [
        { kind: 'helo', path: r, alt: { mode: 'agl', m: 60 }, speedKph: 180, offsetM: 0 },
        { kind: 'helo', path: r, alt: { mode: 'agl', m: 70 }, speedKph: 180, offsetM: 160, lateralM: 60 },
        { kind: 'fighter', path: line([7.62, 50.10], [7.86, 50.19], 20), alt: { mode: 'msl', m: 700 }, speedKph: 700, offsetM: 0, delayS: 18, camo: CAMO.gray },
      ];
    },
  },
  {
    id: 'alps',
    name: 'Fighter pair through Alpine valleys',
    description: 'A pair of fighters in a descending turn through the Lauterbrunnen valley, Swiss Alps.',
    center: [7.9, 46.59],
    hour: 10,
    durationS: 40,
    async build() {
      const p = [...arc([7.9, 46.56], 7, 300, 360, 20), ...line([7.9, 46.623], [7.9, 46.53], 15).slice(1)];
      return [
        { kind: 'fighter', path: p, alt: { mode: 'msl', m: 2600 }, speedKph: 650, offsetM: 0, camo: CAMO.gray },
        { kind: 'fighter', path: p, alt: { mode: 'msl', m: 2650 }, speedKph: 650, offsetM: 220, lateralM: 90, camo: CAMO.gray },
      ];
    },
  },
  {
    id: 'naval',
    name: 'Naval task group at sea',
    description: 'A frigate with two patrol boats and an escorting helicopter off the Norwegian coast, animated ocean surface.',
    center: [5.0, 60.35],
    hour: 14,
    durationS: 60,
    water: true,
    async build() {
      const p = line([4.83, 60.30], [5.05, 60.37], 20);
      return [
        { kind: 'frigate', path: p, alt: { mode: 'sea', m: 0 }, speedKph: 40, offsetM: 0, camo: CAMO.navy },
        { kind: 'patrol', path: p, alt: { mode: 'sea', m: 0 }, speedKph: 40, offsetM: 250, lateralM: 160, camo: CAMO.navy },
        { kind: 'patrol', path: p, alt: { mode: 'sea', m: 0 }, speedKph: 40, offsetM: 250, lateralM: -160, camo: CAMO.navy },
        { kind: 'helo', path: arc([4.95, 60.335], 1.5, 0, 720, 60), alt: { mode: 'msl', m: 150 }, speedKph: 200, offsetM: 0, camo: CAMO.navy },
      ];
    },
  },
  {
    id: 'airlift',
    name: 'Tactical airlift with UAV overwatch',
    description: 'Two tactical transports in trail at low level over the Kasserine area, a MALE UAV orbiting overhead.',
    center: [8.78, 35.25],
    hour: 7,
    durationS: 45,
    async build() {
      return [
        { kind: 'transport', path: line([8.62, 35.18], [8.95, 35.32], 20), alt: { mode: 'agl', m: 250 }, speedKph: 420, offsetM: 0, camo: CAMO.desert },
        { kind: 'transport', path: line([8.62, 35.18], [8.95, 35.32], 20), alt: { mode: 'agl', m: 280 }, speedKph: 420, offsetM: 900, lateralM: 150, camo: CAMO.desert },
        { kind: 'uav', path: arc([8.78, 35.25], 3, 0, 360, 50), alt: { mode: 'msl', m: 3500 }, speedKph: 230, offsetM: 0, camo: CAMO.gray },
      ];
    },
  },
  {
    id: 'cop',
    name: 'Current COP scenario in 3D',
    description: 'The battle from the COP Viewer rendered with 3D vehicles along their simulated tracks (needs a scenario loaded in the COP Viewer).',
    center: [9.83, 50.6],
    hour: 9,
    durationS: 60,
    async build() {
      return [];
    },
  },
];

// ---------------- app ----------------
export async function initVehicles() {
  const root = document.createElement('div');
  root.id = 'vehApp';
  root.innerHTML = `
  <header id="vTop">
    <div class="sys"><span class="sysmark">◆</span><span class="sysname">3D VEHICLE SIMULATION</span><span class="syssub">CESIUMJS</span></div>
    <div class="tbcenter"><span id="vStatus" class="hint"></span></div>
    <div class="tbactions">
      <button id="vShot" class="ico" title="Screenshot (PNG)">📷</button>
      <button id="vRecord" class="ico rec" title="Record video (frame-perfect)">●</button>
      <span id="vRec" class="topRec"></span>
    </div>
  </header>
  <div id="vBody">
    <nav id="vList"></nav>
    <main id="vMain"><div id="vStage"><div id="vCesium"></div><canvas id="vHud"></canvas></div></main>
    <aside id="vSide">
      <div class="wHead"><span>SCENE &amp; CAMERA</span></div>
      <div class="wBody">
        <div class="hint" id="vDesc"></div>
        <label>Camera
          <select id="vCam">
            <option value="cinematic" title="Wide orbit → chase → low flyby, cycling">Cinematic sequence</option>
            <option value="chase" title="Behind and above the lead vehicle">Chase (lead vehicle)</option>
            <option value="orbit" title="Slow orbit around the lead vehicle">Orbit lead</option>
            <option value="flyby" title="Fixed observer near the path; vehicles pass by">Ground observer flyby</option>
            <option value="top" title="High overhead, tracking the group">Overhead tracking</option>
            <option value="free" title="Mouse-controlled free camera">Free (mouse)</option>
          </select>
        </label>
        <div class="row">
          <label class="grow">Time of day <span class="val" id="vHourV"></span><input id="vHour" type="range" min="0" max="24" step="0.25" /></label>
        </div>
        <label>Imagery <select id="vImg"><option value="sat">Satellite (Sentinel-2)</option><option value="topo">OpenTopoMap</option><option value="osm">OpenStreetMap</option></select></label>
        <label>Paint <select id="vCamo"><option value="">Scene default</option><option value="olive">Olive drab</option><option value="green">NATO green</option><option value="desert">Desert tan</option><option value="gray">Gray</option></select></label>
        <label>Terrain exaggeration <span class="val" id="vExV">1.0</span><input id="vEx" type="range" min="1" max="2.5" step="0.1" value="1" /></label>
        <label class="check"><input id="vShadows" type="checkbox" checked /> Shadows</label>
        <label class="check"><input id="vLabels" type="checkbox" /> Vehicle labels</label>
        <label class="check"><input id="vHudOn" type="checkbox" checked /> Caption overlay</label>
        <label class="file">Custom lead-vehicle model (.glb) <input id="vGlb" type="file" accept=".glb,.gltf" /></label>
        <div class="wsec">VIDEO</div>
        <div class="row">
          <label class="grow">Resolution <select id="vRes"><option value="1280x720">1280×720</option><option value="1920x1080" selected>1920×1080</option></select></label>
          <label>FPS <select id="vFps"><option>24</option><option selected>30</option></select></label>
        </div>
        <label>Length (s) <input id="vLen" type="number" value="20" /></label>
        <div class="progress"><div id="vBar" style="height:100%;width:0;background:var(--rec)"></div></div>
        <div class="hint">Free sources: AWS terrain tiles, EOX Sentinel-2 cloudless, OpenStreetMap. Models are generic procedural shapes; load your own .glb for detailed vehicles.</div>
      </div>
    </aside>
  </div>
  <footer id="vTimeline">
    <button id="vPlay">❚❚</button>
    <input id="vTime" type="range" min="0" max="60" step="0.05" value="0" />
    <span id="vTimeLabel" class="mono" style="min-width:90px;color:#7dffb0"></span>
    <label>Speed <select id="vSpeed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
  </footer>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

  const viewer = new Cesium.Viewer('vCesium', {
    baseLayer: false,
    terrainProvider: terrainProvider(),
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shadows: true,
    contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: false } },
  } as any);
  const scene = viewer.scene;
  scene.globe.enableLighting = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.maximumScreenSpaceError = 1.5;
  scene.fog.enabled = true;
  scene.fog.density = 0.00004;
  scene.light = new Cesium.SunLight({ intensity: 2.2 });
  scene.highDynamicRange = false;
  scene.globe.atmosphereLightIntensity = 14;
  (scene as any).atmosphere && ((scene as any).atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType?.SUNLIGHT ?? 2);
  scene.shadowMap.softShadows = true;
  scene.shadowMap.size = 2048;
  scene.shadowMap.maximumDistance = 3000;
  (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';
  let imageryLayer = viewer.imageryLayers.addImageryProvider(IMAGERY.sat());

  // ---------- state ----------
  let sceneDef = SCENES[0];
  let duration = 60;
  let st = 0; // scene seconds
  let playing = true;
  let entities: Cesium.Entity[] = [];
  let water: Cesium.Primitive | null = null;
  let start = Cesium.JulianDate.now();
  let customGlb: string | null = null;
  const camState = { mode: 'cinematic' };

  const setStatus = (s: string) => ($('vStatus').textContent = s);
  $('vList').innerHTML = SCENES.map((s) => `<button data-s="${s.id}" title="${s.description.replace(/"/g, '&quot;')}"><span class="sn">${s.name}</span></button>`).join('');
  $('vList').querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => loadScene(SCENES.find((s) => s.id === b.dataset.s)!)));

  function julian(sec: number) {
    return Cesium.JulianDate.addSeconds(start, sec, new Cesium.JulianDate());
  }
  function setHour(hr: number) {
    const d = new Date(Date.UTC(2026, 5, 21, 0, 0, 0));
    // local solar time → UTC from longitude
    const utcH = hr - sceneDef.center[0] / 15;
    start = Cesium.JulianDate.fromDate(new Date(d.getTime() + utcH * 3600e3));
    $('vHourV').textContent = `${String(Math.floor(hr)).padStart(2, '0')}:${String(Math.round((hr % 1) * 60)).padStart(2, '0')} local`;
  }

  /** sample heights along a path (for terrain-following ground vehicles and AGL aircraft) */
  async function heightsFor(path: LonLat[]) {
    // sample the same terrarium tiles the terrain provider uses (z14, bilinear)
    const z = 14, n = 2 ** z;
    const out: number[] = [];
    for (const [lon, lat] of path) {
      const fx = ((lon + 180) / 360) * n;
      const r = (lat * Math.PI) / 180;
      const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
      const tx = Math.floor(fx), ty = Math.floor(fy);
      const src = await terrariumTile(z, tx, ty);
      if (!src) {
        out.push(0);
        continue;
      }
      const px = Math.min(254.999, (fx - tx) * 256), py = Math.min(254.999, (fy - ty) * 256);
      const x0 = Math.floor(px), y0 = Math.floor(py), ax = px - x0, ay = py - y0;
      out.push(src[y0 * 256 + x0] * (1 - ax) * (1 - ay) + src[y0 * 256 + x0 + 1] * ax * (1 - ay) + src[(y0 + 1) * 256 + x0] * (1 - ax) * ay + src[(y0 + 1) * 256 + x0 + 1] * ax * ay);
    }
    return out;
  }
  function densify(path: LonLat[], stepM: number): LonLat[] {
    const out: LonLat[] = [path[0]];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const d = Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 111320);
      const n = Math.max(1, Math.ceil(d / stepM));
      for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  }

  async function loadScene(def: SceneDef) {
    sceneDef = def;
    $('vList').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.s === def.id));
    $('vDesc').textContent = def.description;
    setStatus(`Loading ${def.name}…`);
    viewer.entities.removeAll();
    entities = [];
    if (water) {
      scene.primitives.remove(water);
      water = null;
    }
    $<HTMLInputElement>('vHour').value = String(def.hour);
    setHour(def.hour);
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(def.center[0], def.center[1] - 0.03, 2500), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-30), roll: 0 } });
    let movers: Mover[];
    if (def.id === 'cop') movers = copMovers();
    else movers = await def.build();
    if (!movers.length) {
      setStatus('No COP scenario loaded – open the COP Viewer first (or pick another scene).');
      return;
    }
    duration = def.id === 'cop' ? Math.min(180, (movers as any).durationS ?? 120) : def.durationS;
    $<HTMLInputElement>('vTime').max = String(duration);
    if (def.water) addWater(def.center);
    const camoSel = $<HTMLSelectElement>('vCamo').value;
    for (const [mi, mv] of movers.entries()) {
      const pts = densify(mv.path, mv.alt.mode === 'msl' || mv.alt.mode === 'sea' ? 200 : 15);
      const hs = mv.alt.mode === 'ground' || mv.alt.mode === 'agl' ? await heightsFor(pts) : pts.map(() => 0);
      const prop = new Cesium.SampledPositionProperty();
      prop.setInterpolationOptions({ interpolationDegree: 2, interpolationAlgorithm: Cesium.LagrangePolynomialApproximation });
      // cumulative distance along the path, then time = (dist - offset) / speed
      const v = (mv.speedKph / 3.6) * ((mv as any).timeScale ?? 1);
      let acc = 0;
      const cum = pts.map((p, i) => (i ? (acc += Math.hypot((p[0] - pts[i - 1][0]) * 111320 * Math.cos((p[1] * Math.PI) / 180), (p[1] - pts[i - 1][1]) * 111320)) : 0));
      const lat = mv.lateralM ?? 0;
      const tFor = (i: number) => (cum[i] - (cum[0] + 0)) / v - mv.offsetM / v + (mv.delayS ?? 0);
      for (let i = 0; i < pts.length; i++) {
        const tt = (mv as any).times ? (mv as any).times[i] : tFor(i) + mv.offsetM / v * 0;
        let p = pts[i];
        if (lat && i < pts.length - 1) {
          const q = pts[i + 1];
          const dx = (q[0] - p[0]) * Math.cos((p[1] * Math.PI) / 180), dy = q[1] - p[1];
          const L = Math.hypot(dx, dy) || 1;
          p = [p[0] + ((dy / L) * lat) / 111320 / Math.cos((p[1] * Math.PI) / 180), p[1] - ((dx / L) * lat) / 111320];
        }
        const h = mv.alt.mode === 'ground' ? hs[i] + 0.05 : mv.alt.mode === 'agl' ? hs[i] + mv.alt.m : mv.alt.m;
        prop.addSample(julian((mv as any).times ? tt : tFor(i) + (i === 0 ? 0 : 0)), Cesium.Cartesian3.fromDegrees(p[0], p[1], h));
      }
      // hold position before start / after end
      prop.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
      prop.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
      const color = camoSel ? CAMO[camoSel] : mv.camo ?? CAMO.olive;
      const uri = mi === 0 && customGlb ? customGlb : await modelUrl(mv.kind, color);
      const e = viewer.entities.add({
        position: prop,
        orientation: new Cesium.VelocityOrientationProperty(prop) as any,
        model: { uri, minimumPixelSize: 0, shadows: Cesium.ShadowMode.ENABLED, runAnimations: false },
        label: { text: mv.label ?? MODEL_INFO[mv.kind].name, font: '13px Consolas', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -30), show: $<HTMLInputElement>('vLabels').checked, disableDepthTestDistance: 1e9 },
      });
      (e as any)._kind = mv.kind;
      entities.push(e);
      // wake for ships
      if (mv.alt.mode === 'sea') {
        viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              const out: Cesium.Cartesian3[] = [];
              for (let k = 0; k < 12; k++) {
                const p = prop.getValue(julian(Math.max(0, st - k * 3)));
                if (p) out.push(p);
              }
              return out;
            }, false),
            width: MODEL_INFO[mv.kind].lengthM > 50 ? 14 : 6,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: Cesium.Color.WHITE.withAlpha(0.45) }),
            clampToGround: false,
          },
        });
      }
    }
    st = 0;
    playing = true;
    $('vPlay').textContent = '❚❚';
    setStatus(def.name);
  }

  function addWater(c: LonLat) {
    const d = 0.4;
    water = scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.RectangleGeometry({ rectangle: Cesium.Rectangle.fromDegrees(c[0] - d * 2, c[1] - d, c[0] + d * 2, c[1] + d), height: 0.5, vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT }) }),
        appearance: new Cesium.EllipsoidSurfaceAppearance({
          aboveGround: true,
          material: new Cesium.Material({
            fabric: {
              type: 'Water',
              uniforms: { baseWaterColor: new Cesium.Color(0.08, 0.2, 0.32, 0.92), normalMap: Cesium.buildModuleUrl('Assets/Textures/waterNormals.jpg'), frequency: 9000.0, animationSpeed: 0.02, amplitude: 6.0, specularIntensity: 0.6 },
            },
          }),
        }),
      }),
    );
  }

  /** COP scenario → movers along simulated tracks (scenario minutes compressed to scene seconds) */
  function copMovers(): Mover[] {
    const sc: Scenario | undefined = (window as any).scc?.active?.scenario;
    if (!sc) return [];
    const T = sc.meta.durationMin;
    const durS = 120;
    const scale = durS / T; // seconds per scenario minute
    const out: Mover[] = [];
    for (const u of sc.units) {
      const cls = targetClass(u);
      const kind: ModelKind =
        cls.cls === 'MBT' ? 'mbt' : cls.cls === 'IFV' || cls.cls === 'APC' || cls.cls === 'RECON' ? 'ifv' : cls.cls === 'SPH' || cls.cls === 'SAM' ? 'sph' : cls.cls === 'AIRCRAFT' ? 'fighter' : cls.cls === 'HELO' ? 'helo' : cls.cls === 'UAV' ? 'uav' : cls.cls === 'BOAT' ? 'patrol' : 'truck';
      const air = !!u.air;
      const n = air ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const pts: LonLat[] = [];
        const times: number[] = [];
        for (let tt = 0; tt <= T; tt += air ? 0.5 : 2) {
          if (u.appear !== undefined && tt < u.appear) continue;
          if (u.disappear !== undefined && tt > u.disappear) break;
          const s = sampleTrack(u.track, tt);
          pts.push([s.pos[0] + k * 0.0006, s.pos[1] + k * 0.0003]);
          times.push(tt * scale);
        }
        if (pts.length < 2) continue;
        const m: Mover = { kind, path: pts, alt: air ? { mode: 'agl', m: kind === 'helo' ? 80 : kind === 'uav' ? 2500 : 900 } : kind === 'patrol' ? { mode: 'sea', m: 0 } : { mode: 'ground', m: 0 }, speedKph: 30, offsetM: 0, camo: u.sidc[3] === '6' ? CAMO.green : CAMO.olive, label: `${u.modifiers?.uniqueDesignation ?? u.id}` };
        (m as any).times = times;
        out.push(m);
      }
    }
    (out as any).durationS = durS;
    sceneDef = { ...sceneDef, center: sc.view.center };
    return out;
  }

  // ---------- camera ----------
  function leadPos(time: Cesium.JulianDate) {
    const e = entities[0];
    return e?.position?.getValue(time);
  }
  function groupCenter(time: Cesium.JulianDate) {
    let n = 0;
    const acc = new Cesium.Cartesian3();
    for (const e of entities.slice(0, 12)) {
      const p = e.position?.getValue(time);
      if (p) Cesium.Cartesian3.add(acc, p, acc), n++;
    }
    return n ? Cesium.Cartesian3.divideByScalar(acc, n, acc) : undefined;
  }
  function headingAt(time: Cesium.JulianDate) {
    const a = leadPos(time);
    const b = leadPos(Cesium.JulianDate.addSeconds(time, 1, new Cesium.JulianDate()));
    if (!a || !b) return 0;
    const ca = Cesium.Cartographic.fromCartesian(a), cb = Cesium.Cartographic.fromCartesian(b);
    return Math.atan2((cb.longitude - ca.longitude) * Math.cos(ca.latitude), cb.latitude - ca.latitude);
  }
  function applyCamera(sec: number) {
    const mode = camState.mode;
    if (mode === 'free' || !entities.length) {
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      return;
    }
    const time = julian(sec);
    const lead = leadPos(time);
    if (!lead) return;
    const len = MODEL_INFO[(entities[0] as any)._kind as ModelKind]?.lengthM ?? 10;
    const hd = headingAt(time);
    let m = mode;
    let local = sec;
    if (mode === 'cinematic') {
      const cyc = sec % 30;
      m = cyc < 10 ? 'orbit' : cyc < 20 ? 'chase' : 'flyby';
      local = cyc;
    }
    if (m === 'chase') viewer.camera.lookAt(lead, new Cesium.HeadingPitchRange(hd + Cesium.Math.toRadians(32), Cesium.Math.toRadians(-14), len * 4.5 + 25));
    else if (m === 'orbit') viewer.camera.lookAt(lead, new Cesium.HeadingPitchRange(hd + Cesium.Math.toRadians(local * 9 + 70), Cesium.Math.toRadians(-22), len * 7 + 60));
    else if (m === 'top') {
      const c = groupCenter(time) ?? lead;
      viewer.camera.lookAt(c, new Cesium.HeadingPitchRange(hd, Cesium.Math.toRadians(-80), len * 30 + 400));
    } else if (m === 'flyby') {
      // observer placed ahead of the lead at the start of the segment, low and to the side
      const seg = mode === 'cinematic' ? sec - local + 20 : Math.floor(sec / 12) * 12;
      const ahead = leadPos(julian(seg + 6)) ?? lead;
      const c = Cesium.Cartographic.fromCartesian(ahead);
      const side = len * 3 + 25;
      const obs = Cesium.Cartesian3.fromRadians(c.longitude + Math.cos(hd) * (side / 6378137) / Math.cos(c.latitude), c.latitude - Math.sin(hd) * (side / 6378137), c.height + Math.max(2, len * 0.25));
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      const dir = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(lead, obs, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      viewer.camera.setView({ destination: obs, orientation: { direction: dir, up: Cesium.Cartesian3.normalize(obs, new Cesium.Cartesian3()) } });
    }
  }

  // ---------- caption overlay ----------
  const hud = $<HTMLCanvasElement>('vHud');
  function drawCaption(g: CanvasRenderingContext2D, w: number, h: number) {
    g.clearRect(0, 0, w, h);
    if (!$<HTMLInputElement>('vHudOn').checked) return;
    g.font = `600 ${Math.max(12, h / 45)}px Consolas, monospace`;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, h - h * 0.07, w, h * 0.07);
    g.fillStyle = '#e8f1ff';
    const d = Cesium.JulianDate.toDate(julian(st));
    g.fillText(`${sceneDef.name.toUpperCase()}`, w * 0.02, h - h * 0.025);
    g.textAlign = 'right';
    g.fillText(`${d.toISOString().slice(0, 19).replace('T', ' ')}Z   T+${st.toFixed(1)}s`, w * 0.98, h - h * 0.025);
    g.textAlign = 'left';
    g.font = `${Math.max(9, h / 90)}px Arial`;
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.textAlign = 'right';
    g.fillText(`CesiumJS · terrain: AWS Terrain Tiles · imagery: ${$<HTMLSelectElement>('vImg').value === 'sat' ? 'Sentinel-2 cloudless by EOX (CC BY 4.0)' : '© OpenStreetMap contributors'}`, w * 0.98, h - h * 0.08);
    g.textAlign = 'left';
  }

  // ---------- loop ----------
  function fit() {
    const main = $('vMain');
    const W = main.clientWidth - 16, H = main.clientHeight - 16;
    const w = Math.min(W, (H * 16) / 9);
    $('vStage').style.width = `${Math.floor(w)}px`;
    $('vStage').style.height = `${Math.floor((w * 9) / 16)}px`;
    viewer.resize();
  }
  new ResizeObserver(fit).observe($('vMain'));
  let recording = false;
  let last = performance.now();
  viewer.clock.shouldAnimate = false;
  scene.preRender.addEventListener(() => {
    if (recording) return;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    if (playing) st = (st + dt * Number($<HTMLSelectElement>('vSpeed').value)) % Math.max(1, duration);
    viewer.clock.currentTime = julian(st);
    applyCamera(st);
    $<HTMLInputElement>('vTime').value = String(st);
    $('vTimeLabel').textContent = `T+${st.toFixed(1)} s`;
    const r = hud.getBoundingClientRect();
    if (hud.width !== Math.round(r.width)) (hud.width = Math.round(r.width)), (hud.height = Math.round(r.height));
    drawCaption(hud.getContext('2d')!, hud.width, hud.height);
  });

  // ---------- controls ----------
  $('vPlay').onclick = () => {
    playing = !playing;
    $('vPlay').textContent = playing ? '❚❚' : '▶';
  };
  $<HTMLInputElement>('vTime').oninput = () => (st = Number($<HTMLInputElement>('vTime').value));
  $<HTMLSelectElement>('vCam').onchange = () => (camState.mode = $<HTMLSelectElement>('vCam').value);
  $<HTMLInputElement>('vHour').oninput = () => setHour(Number($<HTMLInputElement>('vHour').value));
  $<HTMLSelectElement>('vImg').onchange = () => {
    viewer.imageryLayers.remove(imageryLayer);
    imageryLayer = viewer.imageryLayers.addImageryProvider(IMAGERY[$<HTMLSelectElement>('vImg').value]());
  };
  $<HTMLSelectElement>('vCamo').onchange = () => loadScene(sceneDef);
  $<HTMLInputElement>('vEx').oninput = () => {
    scene.verticalExaggeration = Number($<HTMLInputElement>('vEx').value);
    $('vExV').textContent = $<HTMLInputElement>('vEx').value;
  };
  $<HTMLInputElement>('vShadows').onchange = () => (viewer.shadows = $<HTMLInputElement>('vShadows').checked);
  $<HTMLInputElement>('vLabels').onchange = () => entities.forEach((e) => e.label && ((e.label.show as any) = $<HTMLInputElement>('vLabels').checked));
  $<HTMLInputElement>('vGlb').onchange = () => {
    const f = $<HTMLInputElement>('vGlb').files?.[0];
    if (!f) return;
    customGlb = URL.createObjectURL(f);
    loadScene(sceneDef);
  };

  // ---------- capture ----------
  const res = () => $<HTMLSelectElement>('vRes').value.split('x').map(Number) as [number, number];
  async function renderAt(sec: number, out: HTMLCanvasElement) {
    viewer.clock.currentTime = julian(sec);
    applyCamera(sec);
    // render until terrain/imagery tiles for this view are loaded (bounded)
    for (let i = 0; i < 120; i++) {
      viewer.render();
      if (scene.globe.tilesLoaded && i > 1) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    viewer.render();
    const g = out.getContext('2d')!;
    g.drawImage(scene.canvas, 0, 0, out.width, out.height);
    const cap = new OffscreenCanvas(out.width, out.height);
    const prev = st;
    st = sec;
    drawCaption(cap.getContext('2d') as any, out.width, out.height);
    st = prev;
    g.drawImage(cap, 0, 0);
  }
  async function withRes<T>(W: number, fn: () => Promise<T>) {
    const prevRes = viewer.resolutionScale;
    viewer.useDefaultRenderLoop = false;
    viewer.resolutionScale = W / scene.canvas.clientWidth / (window.devicePixelRatio || 1);
    try {
      return await fn();
    } finally {
      viewer.resolutionScale = prevRes;
      viewer.useDefaultRenderLoop = true;
    }
  }
  $('vShot').onclick = async () => {
    const [W, H] = res();
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    recording = true;
    try {
      await withRes(W, () => renderAt(st, out));
    } finally {
      recording = false;
    }
    out.toBlob((b) => b && download(b, `${sceneDef.id}_t${st.toFixed(0)}.png`), 'image/png');
  };
  const sig = { cancelled: false };
  $('vRecord').onclick = async () => {
    if (recording) {
      sig.cancelled = true;
      return;
    }
    recording = true;
    sig.cancelled = false;
    $('vRecord').classList.add('recording');
    const [W, H] = res();
    const fps = Number($<HTMLSelectElement>('vFps').value);
    const secs = Number($<HTMLInputElement>('vLen').value) || 20;
    const frames = Math.round(secs * fps);
    const t0 = st;
    try {
      const r = await withRes(W, () =>
        recordVideo({
          width: W,
          height: H,
          fps,
          frames,
          signal: sig,
          renderFrame: (i, out) => renderAt((t0 + (i / fps) * Number($<HTMLSelectElement>('vSpeed').value)) % Math.max(1, duration), out),
          onProgress: (d, n) => {
            $('vBar').style.width = `${(100 * d) / n}%`;
            $('vRec').textContent = `● ${d}/${n}`;
          },
        }),
      );
      download(r.blob, `${sceneDef.id}.${r.ext}`);
      $('vRec').textContent = `Saved ${(r.blob.size / 1e6).toFixed(1)} MB`;
    } catch (e) {
      $('vRec').textContent = 'Failed: ' + (e as Error).message;
    } finally {
      recording = false;
      $('vRecord').classList.remove('recording');
    }
  };

  (window as any).sccVehicles = {
    viewer,
    load: (id: string) => loadScene(SCENES.find((s) => s.id === id)!),
    setTime: (s: number) => (st = s),
    setCam: (m: string) => ((camState.mode = m), ($<HTMLSelectElement>('vCam').value = m)),
    pause: () => ((playing = false), ($('vPlay').textContent = '▶')),
    get ready() {
      return entities.length > 0;
    },
  };
  fit();
  await loadScene(SCENES[0]);
}
