/**
 * Sensor display embedded in a workspace view (EO/IR, SAR, radar PPI, ESM, sonar), driven by the
 * view's mission and the shared clock. Imagery-based sensors get their own off-screen imagery map.
 */
import maplibregl from 'maplibre-gl';
import { SENSORS, type Sensor, type SensorCtx } from '../sensor/sensors';
import { SAT_STYLE } from '../sensor/style';
import type { Scenario } from '../scenario/types';
import type { Simulation } from '../scenario/sim';

export const SENSOR_CHOICES = SENSORS.map((s) => ({ id: s.id, name: s.name, icon: s.icon }));

let imageryMap: maplibregl.Map | null = null;
/** one shared off-screen imagery map for EO/IR + SAR views (rendered on demand) */
function getImageryMap() {
  if (!imageryMap) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-20000px;top:0;width:960px;height:540px;';
    document.body.appendChild(host);
    imageryMap = new maplibregl.Map({ container: host, style: SAT_STYLE, center: [0, 0], zoom: 2, interactive: false, fadeDuration: 0, attributionControl: false, canvasContextAttributes: { preserveDrawingBuffer: true } } as any);
    imageryMap.on('load', () => imageryMap!.setTerrain({ source: 'dem', exaggeration: 1.4 }));
  }
  return imageryMap;
}

export class SensorView {
  canvas: HTMLCanvasElement;
  sensor: Sensor;
  params: Record<string, any>;
  private busy = false;
  private frame = 0;
  lastT = -1;
  lastRender = 0;

  constructor(host: HTMLElement, id: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vsensorCanvas';
    host.appendChild(this.canvas);
    this.sensor = SENSORS.find((s) => s.id === id) ?? SENSORS[0];
    this.params = Object.fromEntries(this.sensor.params.map((p) => [p.key, p.value]));
  }

  setSensor(id: string) {
    this.sensor = SENSORS.find((s) => s.id === id) ?? SENSORS[0];
    this.params = Object.fromEntries(this.sensor.params.map((p) => [p.key, p.value]));
    this.sensor.reset?.();
    this.lastT = -1;
  }

  /** should this view re-render now? (imagery sensors are throttled; scopes animate continuously) */
  due(t: number, now: number, playing: boolean) {
    if (this.busy) return false;
    if (this.sensor.needsMap) return Math.abs(t - this.lastT) > 0.05 && (!playing || now - this.lastRender > 250);
    return now - this.lastRender > 33;
  }

  /** render into the view's own canvas (sized to its box, capped for the pixel-heavy sensors) */
  async renderLive(sc: Scenario, sim: Simulation, t: number, vt: number) {
    const box = this.canvas.parentElement!;
    const cap = this.sensor.needsMap ? 960 : 1600;
    const w = Math.max(160, Math.min(cap, Math.round(box.clientWidth)));
    const h = Math.max(90, Math.round((w * box.clientHeight) / Math.max(1, box.clientWidth)));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    await this.renderTo(this.canvas, sc, sim, t, vt);
  }

  /** render a frame into any canvas (also used for screenshots and frame-perfect video) */
  async renderTo(out: HTMLCanvasElement, sc: Scenario, sim: Simulation, t: number, vt: number) {
    if (this.busy) return;
    this.busy = true;
    try {
      const map = getImageryMap();
      if (this.sensor.needsMap) {
        if (!map.loaded()) await new Promise<void>((r) => map.once('load', () => r()));
        // the imagery map renders at the output aspect so geometry matches
        const host = map.getContainer();
        const mw = 960, mh = Math.round((960 * out.height) / out.width);
        if (host.clientHeight !== mh) {
          host.style.height = `${mh}px`;
          map.resize();
        }
        map.setPixelRatio(Math.max(1, out.width / mw));
      }
      const c: SensorCtx = { sc, sim, t, vt, frame: this.frame++, map, p: this.params, w: out.width, h: out.height };
      if (this.sensor.needsMap && this.sensor.prepare) await this.sensor.prepare(c);
      const g = out.getContext('2d')!;
      this.sensor.render(c, g);
      if (this.sensor.needsMap) {
        g.font = `${Math.max(9, out.height / 90)}px Arial`;
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.textAlign = 'right';
        g.fillText('Imagery: Sentinel-2 cloudless 2016 by EOX (CC BY 4.0) · © OpenStreetMap contributors', out.width - 6, out.height - 6);
        g.textAlign = 'left';
      }
      this.lastT = t;
      this.lastRender = performance.now();
    } finally {
      this.busy = false;
    }
  }
}
