/**
 * MapLibre GL JS view. Draws basemap, hillshade/contours, MGRS grid, tactical graphics,
 * fire/engagement effects and unit symbols for a SimState. 2D or 3D (terrain + pitch).
 */
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import mlcontour from 'maplibre-contour';
import type { CameraKey, Scenario } from '../scenario/types';
import type { SimState } from '../scenario/sim';
import { DEM_TILES, FONT_BOLD, type Look } from './looks';
import { SymbolCache, renderGraphic } from './symbols';
import { llToUtm, utmToLl, utmZone } from '../geo/geo';

export type ViewMode = '2d' | '3d';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const OUR_SOURCES = ['scc-trails', 'scc-units', 'scc-glines', 'scc-gfills', 'scc-glabels', 'scc-fires', 'scc-impacts', 'scc-grid', 'scc-gridlabels'];

let demSource: any = null;
function getDemSource() {
  if (!demSource) {
    demSource = new mlcontour.DemSource({ url: DEM_TILES, encoding: 'terrarium', maxzoom: 13, worker: true });
    demSource.setupMaplibre(maplibregl);
  }
  return demSource;
}

export class MapView {
  map: MLMap;
  look!: Look;
  mode: ViewMode = '2d';
  symbols: SymbolCache;
  private state: SimState | null = null;
  private scenario: Scenario | null = null;
  private graphicsKey = '';
  private styleReady: Promise<void> = Promise.resolve();
  /** when true the camera follows scenario camera keys */
  followCamera = true;
  /** show unit strength (%) as the additional-information modifier */
  showStrength = false;
  /** fog of war on: enemy strength is unknown to the Blue COP */
  fog = false;

  constructor(container: HTMLElement, look: Look, center: [number, number], zoom: number) {
    this.map = new maplibregl.Map({
      container,
      style: { version: 8, sources: {}, layers: [] },
      center,
      zoom,
      fadeDuration: 0,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      maxPitch: 75,
    } as any);
    this.symbols = new SymbolCache(look, window.devicePixelRatio || 1);
    this.map.on('moveend', () => this.refreshViewDependent());
    this.map.on('load', () => this.updateGrid());
    this.map.on('styleimagemissing', () => {
      /* images are added on demand */
    });
  }

  get pixelRatio() {
    return this.map.getPixelRatio();
  }

  async setPixelRatio(pr: number) {
    this.map.setPixelRatio(pr);
    this.symbols.reset(this.look, pr);
    this.removeUnitImages();
    this.graphicsKey = '';
    if (this.state) this.update(this.state);
  }

  private removeUnitImages() {
    for (const id of this.map.listImages()) if (id.startsWith('u:')) this.map.removeImage(id);
  }

  async setLook(look: Look) {
    this.look = look;
    this.symbols.reset(look, this.map.getPixelRatio());
    let style: StyleSpecification;
    if (typeof look.style === 'string') {
      const res = await fetch(look.style);
      style = await res.json();
    } else style = look.style();
    this.styleReady = new Promise((resolve) => {
      this.map.once('style.load', () => {
        this.installLayers();
        resolve();
      });
    });
    this.map.setStyle(style, { diff: false });
    await this.styleReady;
    this.graphicsKey = '';
    this.applyMode();
    this.applyLayers();
    this.updateGrid();
    if (this.state) this.update(this.state);
  }

  setScenario(sc: Scenario) {
    this.scenario = sc;
    this.graphicsKey = '';
  }

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.applyMode();
  }

  private applyMode() {
    const m = this.map;
    if (!m.getSource('scc-dem')) return;
    if (this.mode === '3d') {
      m.setTerrain({ source: 'scc-dem', exaggeration: 1.6 });
      try {
        (m as any).setSky?.({ 'sky-color': this.look.dark ? '#0b1626' : '#9cc3e6', 'horizon-color': this.look.dark ? '#1b2a3d' : '#dfe9f2', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-color': this.look.dark ? '#0b1626' : '#e6eef5', 'fog-ground-blend': 0.3 });
      } catch {
        /* sky optional */
      }
    } else {
      m.setTerrain(null);
    }
  }

  private installLayers() {
    const m = this.map;
    const L = this.look;
    const style = m.getStyle();
    const firstSymbol = style.layers.find((l) => l.type === 'symbol')?.id;
    m.addSource('scc-dem', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
    m.addSource('scc-dem-hs', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
    if (L.hillshade > 0) {
      m.addLayer(
        {
          id: 'scc-hillshade',
          type: 'hillshade',
          source: 'scc-dem-hs',
          paint: {
            'hillshade-exaggeration': L.hillshade,
            'hillshade-shadow-color': L.dark ? '#000000' : '#473b24',
            'hillshade-highlight-color': L.dark ? '#2a3445' : '#ffffff',
          },
        },
        firstSymbol,
      );
    }
    if (L.contours) {
      const dem = getDemSource();
      m.addSource('scc-contours', {
        type: 'vector',
        tiles: [dem.contourProtocolUrl({ thresholds: { 11: [100, 500], 12: [50, 250], 13: [20, 100], 14: [10, 50], 15: [10, 50] }, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours' })],
        maxzoom: 15,
      });
      m.addLayer({ id: 'scc-contours', type: 'line', source: 'scc-contours', 'source-layer': 'contours', paint: { 'line-color': 'rgba(140,100,50,0.45)', 'line-width': ['match', ['get', 'level'], 1, 1.1, 0.5] } }, firstSymbol);
      m.addLayer({
        id: 'scc-contour-labels', type: 'symbol', source: 'scc-contours', 'source-layer': 'contours', filter: ['>', ['get', 'level'], 0],
        layout: { 'symbol-placement': 'line', 'text-size': 10, 'text-field': ['concat', ['number-format', ['get', 'ele'], {}], 'm'], 'text-font': ['Noto Sans Regular'] },
        paint: { 'text-color': 'rgba(120,80,40,0.8)', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1 },
      });
    }
    for (const id of OUR_SOURCES) m.addSource(id, { type: 'geojson', data: EMPTY });

    // MGRS grid
    m.addLayer({ id: 'scc-grid', type: 'line', source: 'scc-grid', layout: { visibility: L.grid ? 'visible' : 'none' }, paint: { 'line-color': L.gridColor, 'line-opacity': 0.45, 'line-width': ['get', 'w'] } });
    // tactical graphics
    m.addLayer({ id: 'scc-gfills', type: 'fill', source: 'scc-gfills', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['get', 'opacity'] } });
    m.addLayer({
      id: 'scc-glines-halo', type: 'line', source: 'scc-glines',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': L.graphicHalo, 'line-opacity': 0.35, 'line-width': ['+', ['get', 'width'], 2] },
    });
    m.addLayer({ id: 'scc-glines', type: 'line', source: 'scc-glines', filter: ['==', ['get', 'dashed'], 0], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] } });
    m.addLayer({ id: 'scc-glines-dash', type: 'line', source: 'scc-glines', filter: ['==', ['get', 'dashed'], 1], paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [3, 2] } });
    // track history trails
    m.addLayer({ id: 'scc-trails', type: 'line', source: 'scc-trails', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.55, 'line-dasharray': [1, 1.5] } });
    // fires
    m.addLayer({ id: 'scc-fires', type: 'line', source: 'scc-fires', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'o'], 'line-blur': 0.5 } });
    m.addLayer({ id: 'scc-impacts', type: 'circle', source: 'scc-impacts', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-opacity': ['get', 'o'], 'circle-blur': 0.6, 'circle-pitch-alignment': 'map' } });
    // graphic labels
    m.addLayer({
      id: 'scc-glabels', type: 'symbol', source: 'scc-glabels',
      layout: {
        'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': ['get', 'size'], 'text-rotate': ['get', 'rotate'],
        'text-anchor': ['get', 'anchor'] as any, 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'map',
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': ['get', 'halo'], 'text-halo-width': 1.6 },
    });
    // units
    m.addLayer({
      id: 'scc-units', type: 'symbol', source: 'scc-units',
      layout: {
        'icon-image': ['get', 'icon'], 'icon-offset': ['get', 'off'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'symbol-sort-key': ['get', 'z'],
      },
      paint: { 'icon-opacity': ['get', 'o'] },
    });
    m.addLayer({
      id: 'scc-gridlabels', type: 'symbol', source: 'scc-gridlabels', layout: { visibility: L.grid ? 'visible' : 'none', 'text-field': ['get', 'l'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-allow-overlap': true },
      paint: { 'text-color': L.gridColor, 'text-halo-color': L.dark ? '#000' : '#fff', 'text-halo-width': 1.2 },
    });
  }

  private setData(id: string, fc: GeoJSON.FeatureCollection) {
    (this.map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
  }

  /** Re-render things that depend on the viewport (grid, graphics tooth size). */
  private refreshViewDependent() {
    if (!this.look) return;
    this.updateGrid();
    this.graphicsKey = '';
    if (this.state) this.updateGraphics(this.state);
  }

  /** Apply the camera from the sim state (if following). */
  applyCamera(state: SimState) {
    if (!this.followCamera) return;
    const c = state.camera;
    this.map.jumpTo({
      center: c.center,
      zoom: c.zoom,
      bearing: this.mode === '3d' ? c.bearing ?? 0 : c.bearing ?? 0,
      pitch: this.mode === '3d' ? Math.max(c.pitch ?? 0, 58) : c.pitch ?? 0,
    });
  }

  layers = { friend: true, hostile: true, air: true, graphics: true, labels: true, fires: true };
  /** apply layer on/off toggles */
  applyLayers() {
    const m = this.map;
    if (!m.getLayer('scc-units')) return;
    const L = this.layers;
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    ['scc-gfills', 'scc-glines', 'scc-glines-dash', 'scc-glines-halo'].forEach((id) => vis(id, L.graphics));
    vis('scc-glabels', L.graphics && L.labels);
    vis('scc-fires', L.fires);
    vis('scc-impacts', L.fires);
    const f: any[] = ['all'];
    if (!L.friend) f.push(['any', ['!=', ['get', 'side'], 'f'], ['==', ['get', 'air'], 1]]);
    if (!L.hostile) f.push(['any', ['!=', ['get', 'side'], 'h'], ['==', ['get', 'air'], 1]]);
    if (!L.air) f.push(['==', ['get', 'air'], 0]);
    m.setFilter('scc-units', f.length > 1 ? (f as any) : null);
    const friendColor = this.look.dark ? '#7fd4ff' : '#1060b0';
    m.setFilter('scc-trails', L.friend !== L.hostile ? (['==', ['get', 'color'], L.friend ? friendColor : '#d02020'] as any) : null);
    vis('scc-trails', L.friend || L.hostile);
  }

  setCamera(c: CameraKey) {
    this.map.jumpTo({ center: c.center, zoom: c.zoom, bearing: c.bearing ?? 0, pitch: c.pitch ?? 0 });
  }

  update(state: SimState) {
    this.state = state;
    if (!this.look || !this.map.getSource('scc-units')) return;
    this.updateUnits(state);
    this.updateGraphics(state);
    this.updateFires(state);
  }

  private updateUnits(state: SimState) {
    const L = this.look;
    const feats: GeoJSON.Feature[] = [];
    const trails: GeoJSON.Feature[] = [];
    for (const u of state.units) {
      const m = u.unit.modifiers ?? {};
      if (u.trail) trails.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: u.trail }, properties: { color: /^d{3}[23]/.test(u.sidc) ? (L.dark ? '#7fd4ff' : '#1060b0') : '#d02020' } });
      const hideFoe = this.fog && /^d{3}[56]/.test(u.sidc);
      const H = this.showStrength && !u.unit.air && !u.stale && !hideFoe ? `${Math.round(u.strength * 100)}%` : m.additionalInformation;
      const Fm = u.strength < 0.7 && !u.unit.air ? '(-)' : m.reinforcedReduced;
      const isAir = /^\d{4}01/.test(u.sidc);
      let direction: number | undefined;
      let speedLeader: number | undefined;
      if (m.direction === 'auto' || (m.speedLeader && u.moving)) direction = Math.round(u.heading / 5) * 5;
      if (typeof m.direction === 'number') direction = m.direction;
      if (m.speedLeader && u.moving && u.status !== 'destroyed') speedLeader = isAir ? 0 : Math.min(60, 20 + u.speed * 1.2);
      if (direction !== undefined && !speedLeader && !isAir) direction = undefined;
      if (u.status === 'destroyed') direction = undefined;
      const icon = this.symbols.get({
        sidc: u.sidc, T: m.uniqueDesignation, M: m.higherFormation, H, F: Fm,
        direction, speedLeader: speedLeader ? Math.round(speedLeader / 10) * 10 : undefined, size: u.unit.size ?? L.symbol.size * (isAir ? 0.85 : 1),
      });
      if (!this.map.hasImage(icon.id)) this.map.addImage(icon.id, icon.data, { pixelRatio: icon.pixelRatio });
      feats.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: u.pos },
        properties: { icon: icon.id, off: icon.offset, z: isAir ? 10 : u.status === 'destroyed' ? 0 : 5, o: u.status === 'destroyed' ? 0.8 : 1, side: /^\d{3}[23]/.test(u.sidc) ? 'f' : 'h', air: u.unit.air ? 1 : 0 },
      });
    }
    this.setData('scc-units', { type: 'FeatureCollection', features: feats });
    this.setData('scc-trails', { type: 'FeatureCollection', features: trails });
  }

  private updateGraphics(state: SimState) {
    const m = this.map;
    const b = m.getBounds();
    const canvas = m.getCanvas();
    const w = canvas.clientWidth || 1280;
    const h = canvas.clientHeight || 720;
    // key on graphic geometry + rounded view so we only re-render when needed
    const key = state.graphics.map((g) => g.graphic.id + ':' + g.points.map((p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';')).join('|') + `@${m.getZoom().toFixed(2)}/${Math.round(m.getBearing())}`;
    if (key === this.graphicsKey) return;
    this.graphicsKey = key;
    const lines: GeoJSON.Feature[] = [];
    const fills: GeoJSON.Feature[] = [];
    const labels: GeoJSON.Feature[] = [];
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const bearing = m.getBearing();
    for (const g of state.graphics) {
      const r = renderGraphic(g.graphic, g.points, this.look, w, h, bbox);
      lines.push(...r.lines);
      fills.push(...r.fills);
      // keep labels upright relative to the camera (matters when the map is rotated in 3D)
      for (const l of r.labels) {
        const rot = Number(l.properties!.rotate) || 0;
        if (Math.cos(((rot - bearing) * Math.PI) / 180) < 0) l.properties!.rotate = rot + 180;
      }
      labels.push(...r.labels);
    }
    this.setData('scc-glines', { type: 'FeatureCollection', features: lines });
    this.setData('scc-gfills', { type: 'FeatureCollection', features: fills });
    this.setData('scc-glabels', { type: 'FeatureCollection', features: labels });
  }

  private updateFires(state: SimState) {
    const lines: GeoJSON.Feature[] = [];
    const impacts: GeoJSON.Feature[] = [];
    for (const f of state.fires) {
      const color = f.fromSide === 'friend' ? (this.look.dark ? '#7fd4ff' : '#0060c0') : '#ff3030';
      const p = f.progress;
      // tracer travelling from shooter to target, then a burst at the target
      const head = Math.min(1, p * 2.2);
      const tail = Math.max(0, head - 0.35);
      const pt = (k: number) => [f.from[0] + (f.to[0] - f.from[0]) * k, f.from[1] + (f.to[1] - f.from[1]) * k];
      if (f.kind === 'indirect') {
        // artillery salvo: staggered bursts scattered around the aim point, no tracer
        const zoomK = 0.004 * Math.pow(2, 12.5 - this.map.getZoom());
        for (let k = 0; k < 5; k++) {
          const ph = p * 1.6 - k * 0.12;
          if (ph < 0 || ph > 1) continue;
          const ang = (f.seed + k * 137) % 360;
          const rad = zoomK * (0.3 + ((f.seed * (k + 3)) % 100) / 100);
          const c = [f.to[0] + rad * Math.cos((ang * Math.PI) / 180) * 1.5, f.to[1] + rad * Math.sin((ang * Math.PI) / 180)];
          impacts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { color: '#ff7a00', r: 4 + 14 * ph, o: 0.85 * (1 - ph) } });
          impacts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { color: '#5a5048', r: 6 + 20 * ph, o: 0.35 * (1 - ph) } });
        }
        continue;
      }
      lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [f.from, f.to] }, properties: { color, w: f.kind === 'air' ? 1.5 : 1, o: 0.35 } });
      if (head < 1) lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [pt(tail), pt(head)] }, properties: { color: this.look.dark ? '#fff6a0' : '#ffb000', w: 3, o: 0.95 } });
      if (p > 0.4) {
        const k = (p - 0.4) / 0.6;
        impacts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: f.to }, properties: { color: '#ff8c00', r: 6 + 16 * k, o: 0.8 * (1 - k) } });
        impacts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: f.to }, properties: { color: '#fff3b0', r: 3 + 5 * (1 - k), o: 0.9 * (1 - k) } });
      }
    }
    this.setData('scc-fires', { type: 'FeatureCollection', features: lines });
    this.setData('scc-impacts', { type: 'FeatureCollection', features: impacts });
  }

  private updateGrid() {
    if (!this.look?.grid) return;
    const b = this.map.getBounds();
    const c = this.map.getCenter();
    const zone = utmZone(c.lng);
    const step = this.map.getZoom() >= 12.2 ? 1000 : 10000;
    const corners = [
      llToUtm(b.getWest(), b.getSouth(), zone),
      llToUtm(b.getEast(), b.getSouth(), zone),
      llToUtm(b.getWest(), b.getNorth(), zone),
      llToUtm(b.getEast(), b.getNorth(), zone),
    ];
    const minX = Math.floor(Math.min(...corners.map((p) => p.x)) / step) * step;
    const maxX = Math.ceil(Math.max(...corners.map((p) => p.x)) / step) * step;
    const minY = Math.floor(Math.min(...corners.map((p) => p.y)) / step) * step;
    const maxY = Math.ceil(Math.max(...corners.map((p) => p.y)) / step) * step;
    if ((maxX - minX) / step > 200 || (maxY - minY) / step > 200) return;
    const south = c.lat < 0;
    const lines: GeoJSON.Feature[] = [];
    const labels: GeoJSON.Feature[] = [];
    const n = 12;
    const lab = (v: number) => String(Math.floor(v / 1000) % 100).padStart(2, '0');
    for (let x = minX; x <= maxX; x += step) {
      const coords = Array.from({ length: n + 1 }, (_, i) => utmToLl(x, minY + ((maxY - minY) * i) / n, zone, south));
      lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { w: x % 10000 === 0 ? 1.4 : 0.7 } });
      const p = utmToLl(x, minY + (maxY - minY) * 0.03, zone, south);
      if (p[1] > b.getSouth()) labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: utmToLl(x + step * 0.12, llToUtm(c.lng, b.getSouth(), zone).y + step * 0.15, zone, south) }, properties: { l: lab(x) } });
    }
    for (let y = minY; y <= maxY; y += step) {
      const coords = Array.from({ length: n + 1 }, (_, i) => utmToLl(minX + ((maxX - minX) * i) / n, y, zone, south));
      lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { w: y % 10000 === 0 ? 1.4 : 0.7 } });
      labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: utmToLl(llToUtm(b.getWest(), c.lat, zone).x + step * 0.15, y + step * 0.1, zone, south) }, properties: { l: lab(y) } });
    }
    this.setData('scc-grid', { type: 'FeatureCollection', features: lines });
    this.setData('scc-gridlabels', { type: 'FeatureCollection', features: labels });
  }

  /** Render a state and resolve once every tile is loaded and the frame is drawn. */
  async renderFrame(state: SimState, camera?: CameraKey, timeoutMs = 20000): Promise<void> {
    await this.styleReady;
    if (camera) this.setCamera(camera);
    else this.applyCamera(state);
    this.updateGrid();
    this.update(state);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(to);
        resolve();
      };
      const to = setTimeout(() => {
        this.map.off('idle', done);
        resolve();
      }, timeoutMs);
      this.map.once('idle', done);
      this.map.triggerRepaint();
    });
  }
}
