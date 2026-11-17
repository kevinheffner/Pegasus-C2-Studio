/**
 * Representative military sensor displays (visual facsimiles, not physics models):
 *  EO/IR gimbal video · SAR image (+GMTI) · GMTI radar PPI scope · ESM/SIGINT spectrum + PDWs · passive sonar.
 * All are driven by the generated scenario (unit tracks, status, fires) and export metadata in common
 * JSON / CSV layouts. Equipment classes are generic (MBT, IFV, …); emitter names are generic.
 */
import type maplibregl from 'maplibre-gl';
import type { LonLat, Scenario } from '../scenario/types';
import { Simulation, sampleTrack, sideOf, type SimState } from '../scenario/sim';
import { toMgrs } from '../geo/geo';
import { dtg } from '../render/hud';
import { bearingDeg, colormap, distM, firingUnits, fmtLat, fmtLon, gauss, hash, vehiclesOf, type Vehicle } from './common';

export interface ParamDef {
  key: string;
  label: string;
  type: 'select' | 'range' | 'check';
  options?: [string, string][];
  min?: number;
  max?: number;
  step?: number;
  value: string | number | boolean;
}

export interface SensorCtx {
  sc: Scenario;
  sim: Simulation;
  /** scenario time (min) */
  t: number;
  /** display time (s) – drives sweeps, noise, scrolling */
  vt: number;
  frame: number;
  map: maplibregl.Map;
  p: Record<string, any>;
  /** output pixel size */
  w: number;
  h: number;
}

export interface SensorMeta {
  json?: unknown;
  csv?: string;
}

export interface Sensor {
  id: string;
  name: string;
  icon: string;
  description: string;
  needsMap: boolean;
  params: ParamDef[];
  /** position the imagery camera; resolves once tiles are loaded (map sensors) */
  prepare?(c: SensorCtx): Promise<void> | void;
  render(c: SensorCtx, g: CanvasRenderingContext2D): void;
  meta(c: SensorCtx): SensorMeta;
  reset?(): void;
}

const D2R = Math.PI / 180;
const DTG = (c: SensorCtx) => dtg(new Date(new Date(c.sc.meta.start).getTime() + c.t * 60000));
const ISO = (c: SensorCtx) => new Date(new Date(c.sc.meta.start).getTime() + c.t * 60000 + (c.vt % 1) * 1000).toISOString();
const font = (px: number, w = 'normal') => `${w} ${px}px "Consolas","Lucida Console",monospace`;
const state = (c: SensorCtx) => c.sim.stateAt(c.t, {});

/** the scene focus: chosen unit, or the hottest area of fighting, or the AO center */
export function focusPoint(c: SensorCtx, st: SimState, prefer: string): { pos: LonLat; unitId?: string } {
  if (prefer && prefer !== 'auto') {
    const u = st.units.find((x) => x.unit.id === prefer);
    if (u) return { pos: u.pos, unitId: u.unit.id };
  }
  // most recently engaged hostile ground unit
  let best: { pos: LonLat; unitId?: string } | null = null;
  let bt = -1;
  for (const e of c.sc.events ?? []) {
    if (e.t > c.t) break;
    if (e.type !== 'fire' || e.t < bt) continue;
    const u = st.units.find((x) => x.unit.id === e.to && !x.unit.air);
    if (u) {
      bt = e.t;
      best = { pos: u.pos, unitId: u.unit.id };
    }
  }
  if (best && c.t - bt < 40) return best;
  const h = st.units.filter((u) => sideOf(u.sidc) === 'hostile' && !u.unit.air);
  if (h.length) return { pos: h[0].pos, unitId: h[0].unit.id };
  return { pos: c.sc.view.center };
}

function waitIdle(map: maplibregl.Map, timeout = 15000) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(to);
      resolve();
    };
    const to = setTimeout(() => {
      map.off('idle', done);
      resolve();
    }, timeout);
    map.once('idle', done);
    map.triggerRepaint();
  });
}

/** artificial detail: unsharp mask on RGBA pixels (separable 5-tap box blur, then d + k·(d − blur)) */
function sharpen(d: Uint8ClampedArray, w: number, h: number, k: number) {
  if (k <= 0) return;
  const tmp = new Float32Array(w * h * 3);
  const blur = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let o = -2; o <= 2; o++) acc += d[(y * w + Math.min(w - 1, Math.max(0, x + o))) * 4 + c];
        tmp[(y * w + x) * 3 + c] = acc / 5;
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let o = -2; o <= 2; o++) acc += tmp[(Math.min(h - 1, Math.max(0, y + o)) * w + x) * 3 + c];
        blur[(y * w + x) * 3 + c] = acc / 5;
      }
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3)
    for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + k * (d[i + c] - blur[j + c]);
}

const zoomFor = (lat: number, mpp: number) => Math.log2((78271.51696 * Math.cos(lat * D2R)) / mpp);

// =====================================================================
// EO/IR gimbal (FLIR) video
// =====================================================================
let eoFocus: LonLat | null = null;
export const EOIR: Sensor = {
  id: 'eoir',
  name: 'EO/IR Gimbal (FLIR)',
  icon: '🎯',
  description: 'UAV gimbal video: MWIR/LWIR thermal (white-hot, black-hot, ironbow) or EO day-TV over real imagery, tracking vehicles with a standard symbology overlay and optional ATR boxes. Exports per-frame JSON annotations.',
  needsMap: true,
  params: [
    { key: 'mode', label: 'Mode', type: 'select', options: [['wht', 'IR white-hot'], ['blk', 'IR black-hot'], ['iron', 'IR ironbow'], ['eo', 'EO day TV']], value: 'wht' },
    { key: 'band', label: 'Band', type: 'select', options: [['MWIR_3_5um', 'MWIR 3–5 µm'], ['LWIR_8_12um', 'LWIR 8–12 µm']], value: 'MWIR_3_5um' },
    { key: 'fov', label: 'Field of view', type: 'select', options: [['8', 'WFOV 8°'], ['3', 'MFOV 3°'], ['1.2', 'NFOV 1.2°']], value: '3' },
    { key: 'range', label: 'Slant range (km)', type: 'range', min: 1.5, max: 12, step: 0.5, value: 4 },
    { key: 'alt', label: 'Platform altitude (m AGL)', type: 'range', min: 500, max: 7000, step: 250, value: 2500 },
    { key: 'orbit', label: 'Orbit speed (°/s)', type: 'range', min: 0, max: 8, step: 0.5, value: 2 },
    { key: 'target', label: 'Track target', type: 'select', options: [['auto', 'Auto (where the fighting is)']], value: 'auto' },
    { key: 'night', label: 'Night', type: 'check', value: false },
    { key: 'noise', label: 'Sensor noise (NETD mK)', type: 'range', min: 0, max: 80, step: 5, value: 25 },
    { key: 'detail', label: 'Detail enhancement (sharpen + micro texture)', type: 'range', min: 0, max: 1.5, step: 0.1, value: 0.8 },
    { key: 'res', label: 'Render resolution', type: 'select', options: [['auto', 'Auto (view size × screen DPI)'], ['1280', '1280 px'], ['1920', '1920 px (FHD)'], ['2560', '2560 px (QHD)']], value: 'auto' },
    { key: 'atr', label: 'ATR boxes', type: 'check', value: true },
    { key: 'hud', label: 'Symbology overlay', type: 'check', value: true },
  ],
  reset() {
    eoFocus = null;
  },
  async prepare(c) {
    const st = state(c);
    const f = focusPoint(c, st, c.p.target);
    // smooth the gimbal slew so the camera doesn't jump between targets
    eoFocus = eoFocus ? [eoFocus[0] + (f.pos[0] - eoFocus[0]) * 0.15, eoFocus[1] + (f.pos[1] - eoFocus[1]) * 0.15] : f.pos;
    const S = Number(c.p.range) * 1000;
    const alt = Math.min(Number(c.p.alt), S * 0.95);
    const dep = Math.asin(alt / S); // depression angle
    const groundW = 2 * S * Math.tan((Number(c.p.fov) * D2R) / 2);
    const mpp = groundW / c.map.getCanvas().clientWidth;
    const orbit = (c.vt * Number(c.p.orbit) + (c.sc.meta.axis ?? 0) + 200) % 360;
    c.map.jumpTo({ center: eoFocus, zoom: zoomFor(eoFocus[1], mpp), bearing: orbit, pitch: Math.min(80, 90 - dep / D2R) });
    await waitIdle(c.map);
  },
  render(c, g) {
    const { w, h } = c;
    const m = c.map;
    const mode = c.p.mode;
    const st = state(c);
    const fire = firingUnits(st, c.sc, c.t);
    const veh = vehiclesOf(st, c.sc, fire);
    // 1. base imagery → temperature field
    const off = new OffscreenCanvas(w, h);
    const og = off.getContext('2d', { willReadFrequently: true })!;
    og.drawImage(m.getCanvas(), 0, 0, w, h);
    const img = og.getImageData(0, 0, w, h);
    const d = img.data;
    const detail = Number(c.p.detail ?? 0.8);
    sharpen(d, w, h, detail * 1.2);
    const night = !!c.p.night;
    const temp = new Float32Array(w * h);
    // ground-anchored micro texture (tree crowns, field grain): unproject a coarse grid, interpolate per pixel
    const GX = 32, GY = 18;
    const cw = m.getCanvas().clientWidth, ch = m.getCanvas().clientHeight;
    const gridX = new Float32Array((GX + 1) * (GY + 1));
    const gridY = new Float32Array((GX + 1) * (GY + 1));
    const cosL = Math.cos(m.getCenter().lat * D2R);
    for (let j = 0; j <= GY; j++)
      for (let i = 0; i <= GX; i++) {
        const ll = m.unproject([(i / GX) * cw, (j / GY) * ch]);
        gridX[j * (GX + 1) + i] = ll.lng * 111320 * cosL;
        gridY[j * (GX + 1) + i] = ll.lat * 111320;
      }
    const vnoise = (x: number, y: number, s2: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx2 = x - xi, fy2 = y - yi;
      const a = hash(xi, yi, s2), b = hash(xi + 1, yi, s2), cc = hash(xi, yi + 1, s2), dd = hash(xi + 1, yi + 1, s2);
      const ux = fx2 * fx2 * (3 - 2 * fx2), uy = fy2 * fy2 * (3 - 2 * fy2);
      return a + (b - a) * ux + (cc - a) * uy + (a - b - cc + dd) * ux * uy;
    };
    const tex = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * GY, j0 = Math.min(GY - 1, Math.floor(gy)), fy2 = gy - j0;
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * GX, i0 = Math.min(GX - 1, Math.floor(gx)), fx2 = gx - i0;
        const k00 = j0 * (GX + 1) + i0;
        const X = (gridX[k00] * (1 - fx2) + gridX[k00 + 1] * fx2) * (1 - fy2) + (gridX[k00 + GX + 1] * (1 - fx2) + gridX[k00 + GX + 2] * fx2) * fy2;
        const Y = (gridY[k00] * (1 - fx2) + gridY[k00 + 1] * fx2) * (1 - fy2) + (gridY[k00 + GX + 1] * (1 - fx2) + gridY[k00 + GX + 2] * fx2) * fy2;
        tex[y * w + x] = vnoise(X / 3.5, Y / 3.5, 1) * 0.5 + vnoise(X / 14, Y / 14, 2) * 0.3 + (detail > 0 ? (vnoise(X / 1.2, Y / 1.2, 3) - 0.5) * 0.35 * detail + 0.1 : 0.1);
      }
    }
    for (let i = 0, k = 0; i < d.length; i += 4, k++) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
      const veg = gg - (r + b) / 2;
      const water = b - gg > 7 && b > r + 12 ? 1 : 0;
      let tv = night ? 110 - lum * 0.35 + veg * 0.6 : lum * 0.85 - veg * 0.9 + 20;
      if (water) tv = night ? 120 : 30;
      else {
        // forest canopy is lumpy (crowns + shadows), open fields are smoother
        const canopy = veg > 4 && lum < 70 ? 1 : 0.35;
        tv += (tex[k] - 0.5) * (night ? 18 : 34) * canopy;
      }
      temp[k] = tv;
    }
    // 2. vehicles, fires and impacts painted as heat into the field (perspective-correct footprints)
    const heat = new OffscreenCanvas(w, h);
    const hg = heat.getContext('2d', { willReadFrequently: true })!;
    hg.fillStyle = '#000';
    hg.fillRect(0, 0, w, h);
    const sx = w / m.getCanvas().clientWidth;
    const P = (lon: number, lat: number) => {
      const q = m.project([lon, lat]);
      return [q.x * sx, q.y * sx];
    };
    const pitch = m.getPitch() * D2R;
    const boxes: { v: Vehicle; x: number; y: number; bw: number; bh: number }[] = [];
    const corner = (v: Vehicle, a: number, s: number) => {
      const hd = v.heading * D2R;
      const cos = Math.cos(v.pos[1] * D2R);
      const L = v.cls.lengthM, W = v.cls.widthM;
      const ax = a * L / 2, cx = s * W / 2;
      const dx = ax * Math.sin(hd) + cx * Math.cos(hd);
      const dy = ax * Math.cos(hd) - cx * Math.sin(hd);
      return P(v.pos[0] + dx / (111320 * cos), v.pos[1] + dy / 111320);
    };
    for (const v of veh) {
      if (v.air) continue;
      const cs = [corner(v, 1, 1), corner(v, 1, -1), corner(v, -1, -1), corner(v, -1, 1)];
      const xs = cs.map((q) => q[0]), ys = cs.map((q) => q[1]);
      const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      if (maxx < -20 || minx > w + 20 || maxy < -20 || miny > h + 20) continue;
      const lenPx = Math.hypot(cs[0][0] - cs[3][0], cs[0][1] - cs[3][1]);
      const hPx = Math.max(1, lenPx * 0.28 * Math.sin(pitch)); // pseudo-3D height
      const dead = v.status === 'destroyed';
      const running = v.moving || v.firing;
      const poly = (pts: number[][], dy: number, val: number) => {
        hg.fillStyle = `rgb(${val},${val},${val})`;
        hg.beginPath();
        pts.forEach((q, i) => (i ? hg.lineTo(q[0], q[1] - dy) : hg.moveTo(q[0], q[1] - dy)));
        hg.closePath();
        hg.fill();
      };
      // hull sides + top
      for (let s = 0; s <= hPx; s += Math.max(1, hPx / 4)) poly(cs, s, dead ? 180 : running ? 120 : 85);
      // engine deck (rear third) hot
      const rear = [corner(v, -0.3, 0.8), corner(v, -0.3, -0.8), corner(v, -1, -0.8), corner(v, -1, 0.8)];
      poly(rear, hPx, dead ? 255 : running ? 230 : 140);
      if (running && !dead) {
        // exhaust plume behind the vehicle
        const e = corner(v, -1.4, 0);
        const gr = hg.createRadialGradient(e[0], e[1] - hPx, 0, e[0], e[1] - hPx, lenPx * 0.9);
        gr.addColorStop(0, 'rgba(200,200,200,0.7)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        hg.fillStyle = gr;
        hg.fillRect(e[0] - lenPx, e[1] - hPx - lenPx, lenPx * 2, lenPx * 2);
      }
      if (v.firing && !dead && hash(c.frame, v.id.length, 5) > 0.6) {
        const f = corner(v, 1.8, 0);
        hg.fillStyle = '#fff';
        hg.beginPath();
        hg.arc(f[0], f[1] - hPx, Math.max(2, lenPx * 0.4), 0, 7);
        hg.fill();
      }
      if (dead) {
        // burning wreck and warm smoke column drifting downwind
        const cpt = corner(v, 0, 0);
        for (let k = 0; k < 6; k++) {
          const rr = lenPx * (0.4 + k * 0.35);
          const gr = hg.createRadialGradient(cpt[0] + k * lenPx * 0.3, cpt[1] - hPx - k * lenPx * 0.6, 0, cpt[0] + k * lenPx * 0.3, cpt[1] - hPx - k * lenPx * 0.6, rr);
          gr.addColorStop(0, `rgba(255,255,255,${0.5 - k * 0.07})`);
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          hg.fillStyle = gr;
          hg.fillRect(cpt[0] - 3 * rr, cpt[1] - 3 * rr - k * lenPx, 6 * rr, 6 * rr);
        }
      }
      boxes.push({ v, x: minx, y: miny - hPx, bw: maxx - minx, bh: maxy - miny + hPx });
    }
    // artillery impacts near the view
    for (const e of c.sc.events ?? []) {
      if (e.t > c.t) break;
      if (e.type !== 'fire' || e.kind !== 'indirect' || c.t - e.t > 2.5) continue;
      const tgt = c.sc.units.find((u) => u.id === e.to);
      if (!tgt) continue;
      const p0 = sampleTrack(tgt.track, e.t).pos;
      for (let k = 0; k < 4; k++) {
        const age = c.t - e.t - k * 0.15;
        if (age < 0) continue;
        const q = P(p0[0] + (hash(k, e.t * 10, 1) - 0.5) * 0.004, p0[1] + (hash(k, e.t * 10, 2) - 0.5) * 0.003);
        const rr = 6 + age * 30;
        const gr = hg.createRadialGradient(q[0], q[1], 0, q[0], q[1], rr);
        gr.addColorStop(0, `rgba(255,255,255,${Math.max(0, 0.9 - age * 0.4)})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        hg.fillStyle = gr;
        hg.fillRect(q[0] - rr, q[1] - rr, 2 * rr, 2 * rr);
      }
    }
    const hd = hg.getImageData(0, 0, w, h).data;
    // 3. AGC (percentile stretch) + noise + palette
    const sample: number[] = [];
    for (let k = 0; k < temp.length; k += 97) sample.push(temp[k]);
    sample.sort((a, b) => a - b);
    const lo = sample[Math.floor(sample.length * 0.02)];
    const hi = sample[Math.floor(sample.length * 0.98)];
    const span = Math.max(10, hi - lo);
    const netd = Number(c.p.noise) / 25;
    const cmap = colormap(mode === 'iron' ? 'ironbow' : 'gray');
    const fr = c.frame;
    for (let y = 0, k = 0; y < h; y++) {
      const fpn = (hash(0, y, 99) - 0.5) * 0.015 * netd;
      for (let x = 0; x < w; x++, k++) {
        const i = k * 4;
        if (mode === 'eo') {
          // EO: slightly desaturated, contrasty imagery with dark vehicles
          const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
          const hv = hd[i] / 255;
          const n = gauss(x, y, fr) * 3 * netd;
          for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.max(0, Math.min(255, (d[i + ch] * 0.65 + lum * 0.35 - 128) * 1.15 + 128 + n - hv * 120));
          continue;
        }
        let v = (temp[k] - lo) / span;
        v = v * 0.75 + (hd[i] / 255) * 0.9;
        v += gauss(x, y, fr) * 0.02 * netd + fpn;
        v = Math.max(0, Math.min(1, v));
        if (mode === 'blk') v = 1 - v;
        const col = cmap(v);
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
      }
    }
    og.putImageData(img, 0, 0);
    g.save();
    g.filter = mode === 'eo' ? 'none' : 'blur(0.5px)';
    g.drawImage(off, 0, 0);
    g.filter = 'none';
    // vignette
    const vg = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
    g.restore();
    // 4. ATR boxes
    const sym = mode === 'blk' || mode === 'eo' ? '#00ff66' : '#00ff66';
    if (c.p.atr) {
      g.lineWidth = Math.max(1, w / 900);
      g.font = font(Math.max(10, w / 110));
      for (const b of boxes) {
        if (b.bw < 3) continue;
        g.strokeStyle = b.v.side === 'hostile' ? '#ff4040' : '#40c0ff';
        g.strokeRect(b.x - 2, b.y - 2, b.bw + 4, b.bh + 4);
        const conf = (0.62 + hash(b.v.id.length, b.v.unitId.length, 3) * 0.35).toFixed(2);
        g.fillStyle = g.strokeStyle;
        if (b.bw > 6) g.fillText(`${b.v.cls.cls} ${conf}`, b.x, b.y - 5);
      }
    }
    // 5. symbology
    if (c.p.hud) {
      const cx = w / 2, cy = h / 2;
      g.strokeStyle = sym;
      g.fillStyle = sym;
      g.lineWidth = Math.max(1.5, w / 700);
      const r = h * 0.04;
      g.beginPath();
      for (const [a, b2] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        g.moveTo(cx + a * r, cy + b2 * r);
        g.lineTo(cx + a * r * 3, cy + b2 * r * 3);
      }
      g.stroke();
      g.strokeRect(cx - r * 0.5, cy - r * 0.5, r, r);
      // corner brackets
      const bx = w * 0.06, by = h * 0.08, bl = h * 0.06;
      g.beginPath();
      for (const [x0, y0, sxn, syn] of [[bx, by, 1, 1], [w - bx, by, -1, 1], [bx, h - by, 1, -1], [w - bx, h - by, -1, -1]]) {
        g.moveTo(x0, y0 + syn * bl);
        g.lineTo(x0, y0);
        g.lineTo(x0 + sxn * bl, y0);
      }
      g.stroke();
      // heading tape
      const brg = m.getBearing();
      g.font = font(Math.max(10, w / 100));
      g.textAlign = 'center';
      for (let a = -40; a <= 40; a += 5) {
        const hdg = Math.round((brg + a + 360) % 360);
        const x = cx + (a / 40) * w * 0.25;
        g.beginPath();
        g.moveTo(x, h * 0.035);
        g.lineTo(x, h * (a % 10 === 0 ? 0.055 : 0.045));
        g.stroke();
        if (a % 10 === 0) g.fillText(String(Math.floor(((hdg - (hdg % 10) + 360) % 360) / 10) * 10).padStart(3, '0'), x, h * 0.075);
      }
      g.fillText('▼', cx, h * 0.03);
      g.textAlign = 'left';
      const S = Number(c.p.range) * 1000;
      const ctr = m.getCenter();
      const L = [
        `${mode === 'eo' ? 'EO DAY' : 'IR ' + (mode === 'blk' ? 'BLK' : 'WHT')}  ${c.p.band.split('_')[0]}`,
        `${Number(c.p.fov) >= 8 ? 'WFOV' : Number(c.p.fov) >= 3 ? 'MFOV' : 'NFOV'} ${Number(c.p.fov).toFixed(1)}°`,
        `AZ ${String(Math.round((brg + 360) % 360)).padStart(3, '0')}°`,
        `EL -${(90 - m.getPitch()).toFixed(1)}°`,
        'TRK  ●',
      ];
      L.forEach((s, i) => g.fillText(s, w * 0.07, h * 0.16 + i * h * 0.035));
      g.textAlign = 'right';
      const R = [`ALT ${Math.round(Number(c.p.alt) * 3.281)} FT`, `SLR ${(S / 1000).toFixed(2)} KM`, `TGT ${fmtLat(ctr.lat)}`, `    ${fmtLon(ctr.lng)}`, `MGRS ${toMgrs(ctr.lng, ctr.lat, 4)}`];
      R.forEach((s, i) => g.fillText(s, w * 0.93, h * 0.16 + i * h * 0.035));
      g.fillText(`${DTG(c)}`, w * 0.93, h * 0.93);
      g.textAlign = 'left';
      g.fillText(`FRM ${String(c.frame).padStart(6, '0')}`, w * 0.07, h * 0.93);
      g.textAlign = 'center';
      g.fillText(`NETD ${c.p.noise} mK · AGC`, cx, h * 0.93);
      g.textAlign = 'left';
    }
    (EOIR as any)._boxes = boxes;
  },
  meta(c) {
    const boxes: { v: Vehicle; x: number; y: number; bw: number; bh: number }[] = (EOIR as any)._boxes ?? [];
    const ctr = c.map.getCenter();
    const brg = c.map.getBearing();
    return {
      json: {
        frame_id: `${c.p.band.startsWith('MWIR') ? 'mwir' : 'lwir'}_scene_${String(c.frame).padStart(5, '0')}`,
        timestamp_utc: ISO(c),
        sensor_mode: c.p.mode,
        sensor_band: c.p.band,
        sensor_netd_mk: Number(c.p.noise),
        fov_deg: Number(c.p.fov),
        slant_range_m: Number(c.p.range) * 1000,
        platform_alt_m: Number(c.p.alt),
        gimbal_az_deg: +((brg + 360) % 360).toFixed(1),
        gimbal_el_deg: -(90 - c.map.getPitch()).toFixed(1),
        center_lat_deg: +ctr.lat.toFixed(6),
        center_lon_deg: +ctr.lng.toFixed(6),
        atmospheric_visibility_km: 12.0,
        image_size: [c.w, c.h],
        annotations: boxes
          .filter((b) => b.x + b.bw > 0 && b.y + b.bh > 0 && b.x < c.w && b.y < c.h)
          .map((b) => ({
            object_id: b.v.id,
            class: b.v.cls.cls,
            affiliation: b.v.side,
            aspect_angle_deg: +(((b.v.heading - brg) % 360 + 360) % 360).toFixed(1),
            engine_deck_temp_c: +(b.v.status === 'destroyed' ? 300 : (b.v.moving ? b.v.cls.engineC : b.v.cls.engineC * 0.55) + (hash(b.v.id.length, 2, 3) - 0.5) * 8).toFixed(1),
            status: b.v.status,
            occlusion_ratio: +(hash(b.v.id.length, b.v.unitId.length, 7) * 0.3).toFixed(2),
            bbox_xywh: [Math.round(b.x), Math.round(b.y), Math.round(b.bw), Math.round(b.bh)],
          })),
      },
    };
  },
};

// =====================================================================
// SAR image (+ GMTI overlay)
// =====================================================================
let sarFocus: LonLat | null = null;
export const SAR: Sensor = {
  id: 'sar',
  name: 'SAR Imagery (+GMTI)',
  icon: '🛰',
  description: 'Spotlight / stripmap SAR image look: speckle, bright urban returns, dark water and roads, vehicles as bright point scatterers with sidelobes and radar shadows, optional GMTI movers. Exports collect + target metadata JSON.',
  needsMap: true,
  params: [
    { key: 'swath', label: 'Scene width (km)', type: 'select', options: [['1.5', '1.5 km (spotlight)'], ['4', '4 km'], ['10', '10 km (stripmap)']], value: '4' },
    { key: 'res', label: 'Resolution', type: 'select', options: [['0.3', '0.3 m'], ['1', '1 m'], ['3', '3 m']], value: '1' },
    { key: 'pol', label: 'Polarization', type: 'select', options: [['HH', 'HH'], ['HV', 'HV'], ['VV', 'VV'], ['VH', 'VH']], value: 'HH' },
    { key: 'looks', label: 'Looks (speckle)', type: 'range', min: 1, max: 8, step: 1, value: 2 },
    { key: 'look', label: 'Look direction', type: 'select', options: [['left', 'Left'], ['right', 'Right']], value: 'right' },
    { key: 'target', label: 'Scene center', type: 'select', options: [['auto', 'Auto (where the fighting is)']], value: 'auto' },
    { key: 'detail', label: 'Detail enhancement (sharpen + micro texture)', type: 'range', min: 0, max: 1.5, step: 0.1, value: 0.8 },
    { key: 'res', label: 'Render resolution', type: 'select', options: [['auto', 'Auto (view size × screen DPI)'], ['1280', '1280 px'], ['1920', '1920 px (FHD)'], ['2560', '2560 px (QHD)']], value: 'auto' },
    { key: 'gmti', label: 'GMTI movers overlay', type: 'check', value: true },
    { key: 'annot', label: 'Annotation frame', type: 'check', value: true },
  ],
  reset() {
    sarFocus = null;
  },
  async prepare(c) {
    const st = state(c);
    const f = focusPoint(c, st, c.p.target).pos;
    sarFocus = sarFocus ? [sarFocus[0] + (f[0] - sarFocus[0]) * 0.05, sarFocus[1] + (f[1] - sarFocus[1]) * 0.05] : f;
    const mpp = (Number(c.p.swath) * 1000) / c.map.getCanvas().clientWidth;
    c.map.jumpTo({ center: sarFocus, zoom: zoomFor(sarFocus[1], mpp), bearing: 0, pitch: 0 });
    await waitIdle(c.map);
  },
  render(c, g) {
    const { w, h } = c;
    const m = c.map;
    const st = state(c);
    const veh = vehiclesOf(st, c.sc, new Set());
    const off = new OffscreenCanvas(w, h);
    const og = off.getContext('2d', { willReadFrequently: true })!;
    og.drawImage(m.getCanvas(), 0, 0, w, h);
    const img = og.getImageData(0, 0, w, h);
    const d = img.data;
    sharpen(d, w, h, Number(c.p.detail ?? 0.8) * 1.4);
    const L = Number(c.p.looks);
    const crossPol = c.p.pol === 'HV' || c.p.pol === 'VH';
    const lum = new Float32Array(w * h);
    for (let i = 0, k = 0; i < d.length; i += 4, k++) lum[k] = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const ls: number[] = [];
    for (let k = 0; k < lum.length; k += 101) ls.push(lum[k]);
    ls.sort((a, b) => a - b);
    const lnorm = 235 / Math.max(30, ls[Math.floor(ls.length * 0.98)]);
    for (let k = 0; k < lum.length; k++) lum[k] *= lnorm;
    const sigma = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x, i = k * 4;
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
        const veg = (gg - (r + b) / 2) * lnorm;
        const water = b - gg > 7 && b > r + 12;
        const grad = Math.abs(lum[k + 1] - lum[k - 1]) + Math.abs(lum[k + w] - lum[k - w]);
        let s: number;
        if (water) s = 0.004;
        else {
          const urban = Math.max(0, (lum[k] - 120) / 135) * (1 - Math.min(1, sat / 60));
          s = 0.03 + (veg > 5 ? 0.06 + veg * 0.002 : 0.02) + urban * 0.5 + grad * 0.004 * (1 + urban * 3);
          if (lum[k] > 150 && sat < 25 && grad < 6) s *= 0.25; // smooth roads/runways are dark
        }
        if (crossPol) s *= 0.35 + (veg > 5 ? 0.4 : 0);
        sigma[k] = s;
      }
    }
    // vehicles: point scatterers + shadows (shadow cast away from sensor in range)
    const sx = w / m.getCanvas().clientWidth;
    const rangeDir = c.p.look === 'right' ? 1 : -1; // sensor on the left looking right → shadows to the right
    const pts: { x: number; y: number; a: number }[] = [];
    const mppOut = (Number(c.p.swath) * 1000) / w;
    for (const v of veh) {
      if (v.air) continue;
      const q = m.project(v.pos);
      const x0 = q.x * sx, y0 = q.y * sx;
      if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) continue;
      const lpx = Math.max(1.5, v.cls.lengthM / mppOut);
      // shadow
      for (let s = 1; s < lpx * 1.6; s++) {
        for (let wy = -lpx * 0.25; wy <= lpx * 0.25; wy++) {
          const xx = Math.round(x0 + rangeDir * (s + lpx * 0.3)), yy = Math.round(y0 + wy);
          if (xx > 0 && yy > 0 && xx < w && yy < h) sigma[yy * w + xx] *= 0.15;
        }
      }
      const nsc = 3 + Math.floor(hash(v.id.length, 1, 2) * 4);
      for (let s = 0; s < nsc; s++) {
        const a = (hash(s, v.id.length, 9) - 0.5) * lpx;
        const hd = v.heading * D2R;
        pts.push({ x: x0 + a * Math.sin(hd), y: y0 - a * Math.cos(hd), a: v.status === 'destroyed' ? 6 : 20 + hash(s, 3, v.id.length) * 30 });
      }
    }
    for (const p of pts) {
      const xi = Math.round(p.x), yi = Math.round(p.y);
      const sl = Math.ceil(Math.min(40, 6 / Math.max(0.3, Number(c.p.res))));
      for (let k = -sl; k <= sl; k++) {
        const fall = p.a * (k === 0 ? 1 : 0.06 / Math.abs(k));
        if (xi + k > 0 && xi + k < w && yi > 0 && yi < h) sigma[yi * w + xi + k] += fall;
        if (yi + k > 0 && yi + k < h && xi > 0 && xi < w) sigma[(yi + k) * w + xi] += fall;
      }
    }
    // speckle (L-look gamma) + dB scaling; speckle seeded by map position so it is stable frame to frame
    const seedX = Math.round(m.getCenter().lng * 5000), seedY = Math.round(m.getCenter().lat * 5000);
    for (let y = 0, k = 0; y < h; y++) {
      for (let x = 0; x < w; x++, k++) {
        let sp = 0;
        for (let l = 0; l < L; l++) sp += -Math.log(hash(x + seedX, y + seedY, l + 11) + 1e-6);
        const val = sigma[k] * (sp / L);
        const db = 10 * Math.log10(val + 1e-5);
        const vv = Math.max(0, Math.min(1, (db + 26) / 30));
        const gv = Math.pow(vv, 1.1) * 255;
        const i = k * 4;
        d[i] = d[i + 1] = d[i + 2] = gv;
      }
    }
    og.putImageData(img, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const pad = c.p.annot ? Math.round(h * 0.06) : 0;
    g.drawImage(off, pad, pad, w - 2 * pad, h - 2 * pad);
    // GMTI movers
    if (c.p.gmti) {
      const scale = (w - 2 * pad) / w;
      for (const v of veh) {
        if (!v.moving || v.air || v.id.endsWith('-0') === false) continue;
        const q = m.project(v.pos);
        const x = pad + q.x * sx * scale, y = pad + q.y * sx * scale;
        if (x < pad || y < pad || x > w - pad || y > h - pad) continue;
        const radial = Math.cos((v.heading - (c.p.look === 'right' ? 90 : 270)) * D2R);
        g.fillStyle = radial > 0 ? '#ff5050' : '#40a0ff';
        g.beginPath();
        g.arc(x, y, Math.max(3, w / 300), 0, 7);
        g.fill();
        g.strokeStyle = g.fillStyle;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.sin(v.heading * D2R) * 14, y - Math.cos(v.heading * D2R) * 14);
        g.stroke();
      }
    }
    if (c.p.annot) {
      g.strokeStyle = '#9aa';
      g.lineWidth = 1;
      g.strokeRect(pad - 1, pad - 1, w - 2 * pad + 2, h - 2 * pad + 2);
      g.fillStyle = '#d0dada';
      g.font = font(Math.max(10, h / 55));
      const ctr = m.getCenter();
      g.fillText(`SAR ${Number(c.p.swath) <= 2 ? 'SPOTLIGHT' : Number(c.p.swath) <= 5 ? 'SPOT/STRIP' : 'STRIPMAP'}  ${c.p.pol}  RES ${c.p.res} m  ${c.p.looks}-LOOK  ${c.p.gmti ? '+GMTI' : ''}`, pad, pad * 0.62);
      g.textAlign = 'right';
      g.fillText(`${DTG(c)}   CTR ${toMgrs(ctr.lng, ctr.lat, 4)}`, w - pad, pad * 0.62);
      g.textAlign = 'left';
      g.fillText(`${fmtLat(ctr.lat)} ${fmtLon(ctr.lng)}   GRAZE 35°   LOOK ${c.p.look.toUpperCase()}   SCENE ${c.p.swath} km`, pad, h - pad * 0.35);
      // scale bar + range/azimuth arrows
      const kmPx = (w - 2 * pad) / Number(c.p.swath);
      const sb = Number(c.p.swath) >= 8 ? 2 : Number(c.p.swath) >= 3 ? 1 : 0.5;
      g.fillRect(w - pad - sb * kmPx, h - pad * 0.55, sb * kmPx, 3);
      g.textAlign = 'right';
      g.fillText(`${sb} km`, w - pad, h - pad * 0.7);
      g.textAlign = 'left';
      g.font = font(Math.max(9, h / 70));
      g.fillText(`RANGE ${c.p.look === 'right' ? '→' : '←'}   AZIMUTH ↑`, pad, pad * 1.0 + Math.max(10, h / 55));
    }
  },
  meta(c) {
    const st = state(c);
    const ctr = c.map.getCenter();
    const b = c.map.getBounds();
    const veh = vehiclesOf(st, c.sc, new Set()).filter((v) => !v.air && b.contains(v.pos));
    return {
      json: {
        product: 'SAR_IMAGE',
        collect_timestamp_utc: ISO(c),
        mode: Number(c.p.swath) <= 2 ? 'SPOTLIGHT' : 'STRIPMAP',
        polarization: c.p.pol,
        resolution_m: Number(c.p.res),
        looks: Number(c.p.looks),
        look_direction: c.p.look,
        grazing_angle_deg: 35,
        scene_center: { lat_deg: +ctr.lat.toFixed(6), lon_deg: +ctr.lng.toFixed(6) },
        scene_width_km: Number(c.p.swath),
        targets: veh.map((v) => ({
          object_id: v.id,
          class: v.cls.cls,
          lat_deg: +v.pos[1].toFixed(6),
          lon_deg: +v.pos[0].toFixed(6),
          aspect_angle_deg: +(((v.heading - (c.p.look === 'right' ? 90 : 270)) % 360 + 360) % 360).toFixed(1),
          rcs_dbsm: +(v.cls.rcs + (hash(v.id.length, 5, 1) - 0.5) * 6).toFixed(1),
          moving: v.moving,
          status: v.status,
        })),
      },
    };
  },
};

// =====================================================================
// GMTI radar PPI scope
// =====================================================================
let ppiAccum: OffscreenCanvas | null = null;
let ppiLastAngle = 0;
const tracksSeen = new Map<string, { t: number; pos: LonLat; id: string; speed: number; heading: number }>();
export const RADAR: Sensor = {
  id: 'radar',
  name: 'GMTI Radar Scope (PPI)',
  icon: '📡',
  description: 'Rotating-sweep radar PPI with phosphor persistence, ground clutter, range rings and GMTI track symbols / data blocks for moving vehicles and aircraft. Exports GMTI dwell JSON.',
  needsMap: false,
  params: [
    { key: 'site', label: 'Radar site', type: 'select', options: [['ground', 'Ground radar (friendly rear)'], ['air', 'Airborne standoff (orbit)']], value: 'ground' },
    { key: 'rangeKm', label: 'Range scale (km)', type: 'select', options: [['0', 'Auto'], ['10', '10'], ['25', '25'], ['50', '50'], ['100', '100']], value: '0' },
    { key: 'period', label: 'Sweep period (s)', type: 'range', min: 2, max: 12, step: 1, value: 5 },
    { key: 'palette', label: 'Phosphor', type: 'select', options: [['phosphor', 'Green'], ['amber', 'Amber']], value: 'phosphor' },
    { key: 'clutter', label: 'Clutter', type: 'range', min: 0, max: 1, step: 0.1, value: 0.5 },
    { key: 'tracks', label: 'Track symbols & data blocks', type: 'check', value: true },
    { key: 'res', label: 'Render resolution', type: 'select', options: [['auto', 'Auto (view size × screen DPI)'], ['1280', '1280 px'], ['1920', '1920 px (FHD)'], ['2560', '2560 px (QHD)']], value: 'auto' },
  ],
  reset() {
    ppiAccum = null;
    tracksSeen.clear();
  },
  render(c, g) {
    const { w, h } = c;
    // scope sized to the view: keep room for the text panel on the right
    const R = Math.min(h * 0.45, w * 0.36);
    const cx = Math.min(w * 0.42, w * 0.77 - R), cy = h * 0.52;
    const site = radarSite(c);
    const rangeKm = Number(c.p.rangeKm) || autoRange(c, site);
    const pal = colormap(c.p.palette);
    if (!ppiAccum || ppiAccum.width !== w) {
      ppiAccum = new OffscreenCanvas(w, h);
      ppiLastAngle = 0;
    }
    const ag = ppiAccum.getContext('2d')!;
    // persistence fade
    ag.globalCompositeOperation = 'source-over';
    ag.fillStyle = 'rgba(0,0,0,0.035)';
    ag.fillRect(0, 0, w, h);
    const ang = ((c.vt / Number(c.p.period)) * 360) % 360;
    let a0 = ppiLastAngle;
    let a1 = ang;
    if (a1 < a0) a1 += 360;
    if (a1 - a0 > 90) a0 = a1 - 90;
    ppiLastAngle = ang;
    // clutter along the swept wedge
    const cl = Number(c.p.clutter);
    for (let a = a0; a < a1; a += 0.6) {
      const ar = (a - 90) * D2R;
      for (let rb = 4; rb < 220; rb += 1) {
        const rr = rb / 220;
        const n = hash(Math.round(a * 2), rb, 7);
        const terrain = hash(Math.round(a / 4), Math.round(rb / 6), 3);
        const v = (n * 0.4 + terrain * 0.6) * cl * Math.max(0, 1.2 - rr * 1.4);
        if (v < 0.35) continue;
        const col = pal(Math.min(1, v * 0.7));
        ag.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.35 + v * 0.4})`;
        ag.fillRect(cx + Math.cos(ar) * rr * R, cy + Math.sin(ar) * rr * R, 1.6, 1.6);
      }
    }
    // targets painted when the sweep passes
    const st = state(c);
    for (const u of st.units) {
      const d = distM(site, u.pos) / 1000;
      if (d > rangeKm) continue;
      const b = bearingDeg(site, u.pos);
      let bb = b;
      while (bb < a0) bb += 360;
      if (bb > a1) continue;
      const rr = (d / rangeKm) * R;
      const x = cx + Math.cos((b - 90) * D2R) * rr, y = cy + Math.sin((b - 90) * D2R) * rr;
      const mover = u.moving || !!u.unit.air;
      const col = mover ? [255, 200, 60] : pal(0.95);
      ag.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.95)`;
      ag.beginPath();
      ag.arc(x, y, mover ? 3.2 : 2.4, 0, 7);
      ag.fill();
      if (mover) tracksSeen.set(u.unit.id, { t: c.t, pos: u.pos, id: `TRK-${400 + (hashStr(u.unit.id) % 600)}`, speed: u.speed, heading: u.heading });
    }
    // compose
    g.fillStyle = '#020604';
    g.fillRect(0, 0, w, h);
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, 7);
    g.clip();
    const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, '#04140a');
    bg.addColorStop(1, '#010502');
    g.fillStyle = bg;
    g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    g.drawImage(ppiAccum, 0, 0);
    // sweep glow
    const sg = (ang - 90) * D2R;
    for (let k = 0; k < 24; k++) {
      const a = sg - k * 0.012;
      const col = pal(0.8);
      g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.35 * (1 - k / 24)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.stroke();
    }
    g.restore();
    // rings & ticks
    const lc = pal(0.55);
    g.strokeStyle = `rgba(${lc[0]},${lc[1]},${lc[2]},0.55)`;
    g.fillStyle = `rgb(${lc[0]},${lc[1]},${lc[2]})`;
    g.lineWidth = 1;
    g.font = font(Math.max(9, h / 70));
    for (let k = 1; k <= 4; k++) {
      g.beginPath();
      g.arc(cx, cy, (R * k) / 4, 0, 7);
      g.stroke();
      g.fillText(`${((rangeKm * k) / 4).toFixed(0)}`, cx + 3, cy - (R * k) / 4 + 11);
    }
    for (let a = 0; a < 360; a += 10) {
      const ar = (a - 90) * D2R;
      const len = a % 30 === 0 ? 12 : 6;
      g.beginPath();
      g.moveTo(cx + Math.cos(ar) * R, cy + Math.sin(ar) * R);
      g.lineTo(cx + Math.cos(ar) * (R - len), cy + Math.sin(ar) * (R - len));
      g.stroke();
      if (a % 30 === 0) {
        g.textAlign = 'center';
        g.fillText(String(a).padStart(3, '0'), cx + Math.cos(ar) * (R + 14), cy + Math.sin(ar) * (R + 14) + 4);
      }
    }
    g.textAlign = 'left';
    // track symbols
    const live = [...tracksSeen.entries()].filter(([, v]) => c.t - v.t < 6);
    if (c.p.tracks) {
      for (const [, tr] of live) {
        const d = distM(site, tr.pos) / 1000;
        const b = bearingDeg(site, tr.pos);
        const rr = (d / rangeKm) * R;
        const x = cx + Math.cos((b - 90) * D2R) * rr, y = cy + Math.sin((b - 90) * D2R) * rr;
        g.strokeStyle = '#ffd060';
        g.fillStyle = '#ffd060';
        g.strokeRect(x - 5, y - 5, 10, 10);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.sin(tr.heading * D2R) * (10 + Math.min(30, tr.speed / 8)), y - Math.cos(tr.heading * D2R) * (10 + Math.min(30, tr.speed / 8)));
        g.stroke();
        g.font = font(Math.max(9, h / 80));
        g.fillText(`${tr.id}`, x + 8, y - 6);
        g.fillText(`${Math.round(tr.speed)}KPH ${String(Math.round(tr.heading)).padStart(3, '0')}`, x + 8, y + 6);
      }
    }
    // side panel
    const px = w * 0.8;
    g.fillStyle = `rgb(${lc[0]},${lc[1]},${lc[2]})`;
    g.font = font(Math.max(11, h / 55), 'bold');
    g.fillText(c.p.site === 'air' ? 'AIRBORNE GMTI' : 'GROUND SURV RADAR', px - w * 0.04, h * 0.08);
    g.font = font(Math.max(10, h / 65));
    const rows = [`MODE   GMTI / MTI`, `RANGE  ${rangeKm} KM`, `SCAN   ${c.p.period} S`, `TRACKS ${live.length}`, `TIME   ${DTG(c)}`, `SITE   ${toMgrs(site[0], site[1], 3)}`, '', 'TRK      SPD  HDG'];
    rows.forEach((s, i) => g.fillText(s, px - w * 0.04, h * 0.13 + i * h * 0.035));
    live.slice(0, 14).forEach(([, tr], i) => g.fillText(`${tr.id}  ${String(Math.round(tr.speed)).padStart(3, ' ')}  ${String(Math.round(tr.heading)).padStart(3, '0')}`, px - w * 0.04, h * 0.13 + (rows.length + i) * h * 0.035));
  },
  meta(c) {
    const site = radarSite(c);
    const live = [...tracksSeen.values()].filter((v) => c.t - v.t < 6);
    return {
      json: {
        dwell_timestamp_utc: ISO(c),
        platform_alt_m: c.p.site === 'air' ? 9144.0 : 15.0,
        platform_lat_deg: +site[1].toFixed(5),
        platform_lon_deg: +site[0].toFixed(5),
        mode: 'GMTI',
        tracks: live.map((tr) => {
          const brg = bearingDeg(site, tr.pos);
          const vms = tr.speed / 3.6;
          return {
            track_id: tr.id,
            lat_deg: +tr.pos[1].toFixed(5),
            lon_deg: +tr.pos[0].toFixed(5),
            ground_speed_mps: +vms.toFixed(1),
            heading_deg: +tr.heading.toFixed(1),
            mean_rcs_dbsm: +(14 + (hashStr(tr.id) % 80) / 10).toFixed(1),
            radial_velocity_mps: +(-vms * Math.cos((tr.heading - brg) * D2R)).toFixed(1),
          };
        }),
      },
    };
  },
};

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function radarSite(c: SensorCtx): LonLat {
  const axis = (c.sc.meta.axis ?? 0) * D2R;
  const ctr = c.sc.view.center;
  const back = c.p.site === 'air' ? 0.32 : 0.14;
  const orbitOff = c.p.site === 'air' ? Math.sin(c.vt / 40) * 0.08 : 0;
  return [ctr[0] - (Math.sin(axis) * back) / Math.cos(ctr[1] * D2R) + Math.cos(axis) * orbitOff, ctr[1] - Math.cos(axis) * back - Math.sin(axis) * orbitOff];
}
function autoRange(c: SensorCtx, site: LonLat) {
  let mx = 5;
  for (const u of c.sc.units) mx = Math.max(mx, distM(site, u.track[0].pos) / 1000);
  for (const r of [10, 15, 20, 25, 30, 40, 50, 75, 100, 150]) if (r >= mx * 1.1) return r;
  return 200;
}

// =====================================================================
// ESM / SIGINT spectrum + PDW
// =====================================================================
interface Emitter {
  tag: string;
  label: string;
  freq: number; // MHz
  pri: number; // µs
  pw: number; // µs
  pulsed: boolean;
  hop?: boolean;
  scan: number; // s (0 = steady)
  unitId?: string;
  pos: LonLat;
  power: number; // relative dB
}
function emitters(c: SensorCtx, st: SimState): Emitter[] {
  const out: Emitter[] = [];
  for (const u of st.units) {
    if (sideOf(u.sidc) !== 'hostile' || u.status === 'destroyed') continue;
    const e = u.sidc.slice(10, 16);
    const id = hashStr(u.unit.id);
    if (e.startsWith('1301')) {
      out.push({ tag: 'fire_control_xband', label: 'FIRE CONTROL X-BAND', freq: 9410.5 + (id % 40) - 20, pri: 450, pw: 1.2, pulsed: true, scan: 0, unitId: u.unit.id, pos: u.pos, power: 0 });
      out.push({ tag: 'acquisition_sband', label: 'ACQUISITION S-BAND', freq: 2850 + (id % 60), pri: 1200, pw: 4.5, pulsed: true, scan: 4, unitId: u.unit.id, pos: u.pos, power: -4 });
    } else if (e.startsWith('1303')) {
      out.push({ tag: 'counter_battery_cband', label: 'C/B RADAR C-BAND', freq: 5620 + (id % 50), pri: 800, pw: 2.0, pulsed: true, scan: 2.5, unitId: u.unit.id, pos: u.pos, power: -8 });
    } else if (e.startsWith('1213')) {
      out.push({ tag: 'ground_surveillance_ku', label: 'GND SURV KU-BAND', freq: 16500 + (id % 100), pri: 250, pw: 0.5, pulsed: true, scan: 6, unitId: u.unit.id, pos: u.pos, power: -10 });
    }
    // tactical comms (VHF hopping) from every hostile ground unit, busier when fighting
    if (!u.unit.air) out.push({ tag: 'vhf_comms_fhss', label: 'VHF COMMS (FH)', freq: 30 + (id % 58), pri: 0, pw: 0, pulsed: false, hop: true, scan: 0, unitId: u.unit.id, pos: u.pos, power: -2 });
  }
  // background / civil emitters
  out.push({ tag: 'civil_atc_sband', label: 'CIVIL ATC S-BAND', freq: 2780, pri: 1000, pw: 1.0, pulsed: true, scan: 4.8, pos: c.sc.view.center, power: -14 });
  out.push({ tag: 'broadcast_fm', label: 'FM BROADCAST', freq: 98.4, pri: 0, pw: 0, pulsed: false, scan: 0, pos: c.sc.view.center, power: -6 });
  out.push({ tag: 'cellular_900', label: 'CELLULAR 900', freq: 935, pri: 0, pw: 0, pulsed: false, scan: 0, pos: c.sc.view.center, power: -12 });
  return out;
}
const FMIN = 20, FMAX = 18000;
const fx = (f: number, x0: number, x1: number) => x0 + ((Math.log10(f) - Math.log10(FMIN)) / (Math.log10(FMAX) - Math.log10(FMIN))) * (x1 - x0);
let wfCanvas: OffscreenCanvas | null = null;
let wfLastRow = -1;
export const ESM: Sensor = {
  id: 'esm',
  name: 'ESM / SIGINT Spectrum + PDW',
  icon: '〰',
  description: 'Electronic support display: wideband spectrum trace and scrolling waterfall (20 MHz–18 GHz), DF bearing plot and live Pulse Descriptor Word stream from the scenario’s enemy radars and radios. Exports PDW CSV.',
  needsMap: false,
  params: [
    { key: 'palette', label: 'Waterfall palette', type: 'select', options: [['jet', 'Jet'], ['ironbow', 'Ironbow'], ['phosphor', 'Green']], value: 'jet' },
    { key: 'floor', label: 'Noise floor (dBm)', type: 'range', min: -110, max: -70, step: 5, value: -95 },
    { key: 'df', label: 'DF bearing plot', type: 'check', value: true },
    { key: 'res', label: 'Render resolution', type: 'select', options: [['auto', 'Auto (view size × screen DPI)'], ['1280', '1280 px'], ['1920', '1920 px (FHD)'], ['2560', '2560 px (QHD)']], value: 'auto' },
  ],
  reset() {
    wfCanvas = null;
    wfLastRow = -1;
  },
  render(c, g) {
    const { w, h } = c;
    const st = state(c);
    const em = emitters(c, st);
    const rx = radarSite({ ...c, p: { site: 'ground' } });
    const pal = colormap(c.p.palette);
    const floor = Number(c.p.floor);
    g.fillStyle = '#05080c';
    g.fillRect(0, 0, w, h);
    const x0 = w * 0.05, x1 = w * (c.p.df ? 0.72 : 0.96);
    const specTop = h * 0.08, specH = h * 0.22, wfTop = specTop + specH + h * 0.03, wfH = h * 0.45;
    const bins = Math.round(x1 - x0);
    const rowAt = (rt: number) => {
      const row = new Float32Array(bins);
      for (let b = 0; b < bins; b++) row[b] = floor + gauss(b, Math.round(rt * 20), 1) * 2.5 + (b > bins * 0.05 && b < bins * 0.08 ? 4 : 0);
      for (const e of em) {
        const d = Math.max(0.3, distM(rx, e.pos) / 1000);
        let p = -35 + e.power - 20 * Math.log10(d);
        if (e.scan) p += -18 * (1 - Math.max(0, Math.cos(((rt / e.scan) * 2 * Math.PI) % (2 * Math.PI))) ** 8);
        let f = e.freq;
        if (e.hop) {
          if (hash(Math.round(rt * 10), hashStr(e.unitId ?? e.tag), 4) > 0.35) continue;
          f = 30 + hash(Math.round(rt * 10), hashStr(e.unitId ?? e.tag), 8) * 58;
        }
        const bc = Math.round(fx(f, 0, bins));
        const wdt = e.pulsed ? 2 : e.hop ? 1 : 3;
        for (let k = -wdt; k <= wdt; k++) if (bc + k >= 0 && bc + k < bins) row[bc + k] = Math.max(row[bc + k], p - Math.abs(k) * 3);
      }
      return row;
    };
    // waterfall: one row per 1/20 s of display time, scrolling down
    const rowsH = Math.round(wfH);
    if (!wfCanvas || wfCanvas.width !== bins || wfCanvas.height !== rowsH) {
      wfCanvas = new OffscreenCanvas(bins, rowsH);
      wfLastRow = -1;
    }
    const wg = wfCanvas.getContext('2d')!;
    const cur = Math.floor(c.vt * 20);
    let n = wfLastRow < 0 ? rowsH : Math.min(rowsH, cur - wfLastRow);
    if (n < 0) n = rowsH;
    if (n > 0) {
      wg.drawImage(wfCanvas, 0, n);
      const im = wg.createImageData(bins, n);
      for (let r = 0; r < n; r++) {
        const row = rowAt((cur - r) / 20);
        for (let b = 0; b < bins; b++) {
          const v = Math.max(0, Math.min(1, (row[b] - floor) / 55));
          const col = pal(v);
          const i = (r * bins + b) * 4;
          im.data[i] = col[0];
          im.data[i + 1] = col[1];
          im.data[i + 2] = col[2];
          im.data[i + 3] = 255;
        }
      }
      wg.putImageData(im, 0, 0);
      wfLastRow = cur;
    }
    g.drawImage(wfCanvas, x0, wfTop);
    // spectrum trace (max-hold of current row)
    const row = rowAt(cur / 20);
    g.strokeStyle = '#ffd84a';
    g.lineWidth = 1;
    g.beginPath();
    for (let b = 0; b < bins; b++) {
      const y = specTop + specH - ((row[b] - floor + 5) / 65) * specH;
      b ? g.lineTo(x0 + b, y) : g.moveTo(x0 + b, y);
    }
    g.stroke();
    // axes
    g.strokeStyle = '#2c3a48';
    g.strokeRect(x0, specTop, bins, specH);
    g.strokeRect(x0, wfTop, bins, wfH);
    g.fillStyle = '#9fb3c8';
    g.font = font(Math.max(9, h / 75));
    for (const f of [30, 100, 300, 1000, 3000, 10000]) {
      const x = fx(f, x0, x0 + bins);
      g.fillText(f >= 1000 ? `${f / 1000} GHz` : `${f} MHz`, x - 14, specTop - 4);
      g.beginPath();
      g.moveTo(x, specTop);
      g.lineTo(x, wfTop + wfH);
      g.strokeStyle = 'rgba(80,100,120,0.25)';
      g.stroke();
    }
    g.fillText(`${floor + 60} dBm`, 4, specTop + 10);
    g.fillText(`${floor} dBm`, 4, specTop + specH);
    g.font = font(Math.max(11, h / 55), 'bold');
    g.fillText(`ESM / SIGINT   20 MHz – 18 GHz   ${DTG(c)}`, x0, h * 0.04);
    // DF plot
    const active = em.filter((e) => e.pulsed || e.tag === 'vhf_comms_fhss');
    if (c.p.df) {
      const cx = w * 0.86, cy = h * 0.3, R = h * 0.2;
      g.strokeStyle = '#2c3a48';
      g.beginPath();
      g.arc(cx, cy, R, 0, 7);
      g.stroke();
      g.fillStyle = '#9fb3c8';
      g.font = font(Math.max(9, h / 75));
      g.textAlign = 'center';
      ['N', 'E', 'S', 'W'].forEach((s, i) => g.fillText(s, cx + Math.sin(i * Math.PI / 2) * (R + 10), cy - Math.cos(i * Math.PI / 2) * (R + 10) + 4));
      g.fillText('DF BEARINGS', cx, cy + R + 26);
      g.textAlign = 'left';
      for (const e of active) {
        const b = bearingDeg(rx, e.pos) + gauss(c.frame, hashStr(e.tag), 2) * 1.5;
        g.strokeStyle = e.tag.includes('fire') ? '#ff5050' : e.tag.includes('vhf') ? '#50a0ff' : '#ffd84a';
        g.globalAlpha = e.tag.includes('vhf') ? 0.35 : 0.85;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.sin(b * D2R) * R, cy - Math.cos(b * D2R) * R);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // PDW table + emitter list
    const pdw = pdwsAt(c, em, rx, c.vt, 12);
    const ty = wfTop + wfH + h * 0.04;
    g.font = font(Math.max(9, h / 78));
    g.fillStyle = '#7dffb0';
    g.fillText('TOA_NS        FREQ_MHZ  PW_US  PRI_US   AOA   PWR_DBM  TAG', x0, ty);
    g.fillStyle = '#c8d6e8';
    pdw.slice(-8).forEach((r, i) => g.fillText(`${String(r.toa).padEnd(13)} ${r.f.toFixed(1).padStart(8)}  ${r.pw.toFixed(2).padStart(5)}  ${r.pri.toFixed(1).padStart(6)}  ${r.aoa.toFixed(1).padStart(6)}  ${r.p.toFixed(1).padStart(6)}  ${r.tag}`, x0, ty + (i + 1) * h * 0.025));
    const ex = w * 0.745;
    g.fillStyle = '#7dffb0';
    g.fillText('EMITTERS (ID / AOA)', ex, h * 0.56);
    g.fillStyle = '#c8d6e8';
    const uniq = new Map<string, Emitter>();
    for (const e of active) if (!uniq.has(e.tag + e.unitId)) uniq.set(e.tag + e.unitId, e);
    [...uniq.values()].slice(0, 9).forEach((e, i) => g.fillText(`E-${String(i + 1).padStart(2, '0')} ${e.label.padEnd(20).slice(0, 20)} ${String(Math.round(bearingDeg(rx, e.pos))).padStart(3, '0')}°`, ex, h * 0.59 + i * h * 0.03));
  },
  meta(c) {
    const st = state(c);
    const em = emitters(c, st);
    const rx = radarSite({ ...c, p: { site: 'ground' } });
    const rows = pdwsAt(c, em, rx, c.vt, 60);
    return { csv: 'toa_ns,carrier_freq_mhz,pulse_width_us,pri_us,aoa_deg,rx_power_dbm,emitter_tag\n' + rows.map((r) => `${r.toa},${r.f.toFixed(1)},${r.pw.toFixed(2)},${r.pri.toFixed(1)},${r.aoa.toFixed(1)},${r.p.toFixed(1)},${r.tag}`).join('\n') };
  },
};
function pdwsAt(c: SensorCtx, em: Emitter[], rx: LonLat, vt: number, n: number) {
  const rows: { toa: number; f: number; pw: number; pri: number; aoa: number; p: number; tag: string }[] = [];
  const base = Math.floor((c.t * 60 + vt) * 1e9);
  const pulsed = em.filter((e) => e.pulsed);
  for (let k = 0; k < n && pulsed.length; k++) {
    const e = pulsed[k % pulsed.length];
    const d = Math.max(0.3, distM(rx, e.pos) / 1000);
    rows.push({
      toa: base + k * Math.round(e.pri * 1000) + Math.round(hash(k, 3, 4) * 300),
      f: e.freq + gauss(k, hashStr(e.tag), 1) * 0.2,
      pw: e.pw,
      pri: e.pri + gauss(k, 2, hashStr(e.tag)) * 0.5,
      aoa: ((bearingDeg(rx, e.pos) + gauss(k, 5, 6) * 1.2 + 540) % 360) - 180,
      p: -40 + e.power - 20 * Math.log10(d) + gauss(k, 7, 8) * 0.4,
      tag: e.tag,
    });
  }
  return rows.sort((a, b) => a.toa - b.toa);
}

// =====================================================================
// Passive sonar (BTR + LOFAR) – synthetic maritime picture
// =====================================================================
interface Contact {
  id: string;
  type: string;
  b0: number;
  rate: number;
  level: number;
  tonals: number[];
  bb: number;
}
function contacts(seed: number): Contact[] {
  const types: [string, number, number[], number][] = [
    ['MERCHANT', 0.9, [8.5, 17, 25.5, 50, 100], 1],
    ['WARSHIP', 0.7, [12, 24, 60, 180], 0.8],
    ['FISHING', 0.6, [11, 33, 66], 0.6],
    ['SUBMERGED', 0.3, [7.2, 21.6, 57], 0.25],
  ];
  return types.map(([type, level, tonals, bb], i) => ({ id: `S${String(i + 1).padStart(2, '0')}`, type, b0: hash(i, seed, 1) * 360, rate: (hash(i, seed, 2) - 0.5) * 0.6, level, tonals, bb }));
}
let btr: OffscreenCanvas | null = null;
let lofar: OffscreenCanvas | null = null;
let sonarLast = -1;
export const SONAR: Sensor = {
  id: 'sonar',
  name: 'Passive Sonar (BTR + LOFAR)',
  icon: '🌊',
  description: 'Towed-array style passive sonar: bearing-time waterfall and LOFAR gram with machinery tonals from a synthetic maritime picture (merchant, warship, fishing vessel, submerged contact). Exports contact JSON.',
  needsMap: false,
  params: [
    { key: 'palette', label: 'Palette', type: 'select', options: [['phosphor', 'Green'], ['amber', 'Amber'], ['gray', 'Gray']], value: 'phosphor' },
    { key: 'ambient', label: 'Ambient noise', type: 'range', min: 0, max: 1, step: 0.1, value: 0.5 },
    { key: 'seed', label: 'Contact seed', type: 'range', min: 1, max: 20, step: 1, value: 3 },
    { key: 'res', label: 'Render resolution', type: 'select', options: [['auto', 'Auto (view size × screen DPI)'], ['1280', '1280 px'], ['1920', '1920 px (FHD)'], ['2560', '2560 px (QHD)']], value: 'auto' },
  ],
  reset() {
    btr = lofar = null;
    sonarLast = -1;
  },
  render(c, g) {
    const { w, h } = c;
    const pal = colormap(c.p.palette);
    const cs = contacts(Number(c.p.seed));
    const amb = Number(c.p.ambient);
    const bw = Math.round(w * 0.46), bh = Math.round(h * 0.78);
    if (!btr || btr.width !== bw) {
      btr = new OffscreenCanvas(bw, bh);
      lofar = new OffscreenCanvas(bw, bh);
      sonarLast = -1;
    }
    const cur = Math.floor(c.vt * 8);
    let n = sonarLast < 0 ? bh : Math.min(bh, cur - sonarLast);
    if (n < 0) n = bh;
    if (n > 0) {
      for (const [cv, kind] of [[btr, 'btr'], [lofar, 'lofar']] as const) {
        const cg = cv!.getContext('2d')!;
        cg.drawImage(cv!, 0, n);
        const im = cg.createImageData(bw, n);
        for (let r = 0; r < n; r++) {
          const rt = (cur - r) / 8;
          for (let x = 0; x < bw; x++) {
            let v = amb * 0.35 + hash(x, Math.round(rt * 8), kind === 'btr' ? 1 : 2) * 0.25;
            for (const ct of cs) {
              if (kind === 'btr') {
                const b = (ct.b0 + ct.rate * rt + 360) % 360;
                const bx = (b / 360) * bw;
                const dd = Math.min(Math.abs(x - bx), bw - Math.abs(x - bx));
                v += ct.bb * Math.exp(-(dd * dd) / 6) * (0.7 + 0.3 * hash(Math.round(rt * 8), x, 9));
              } else {
                for (const f of ct.tonals) {
                  const fx2 = (f / 200) * bw;
                  const drift = Math.sin(rt / 20 + f) * 0.6;
                  const dd = Math.abs(x - fx2 - drift);
                  v += ct.level * 0.8 * Math.exp(-(dd * dd) / 1.2) * (0.6 + 0.4 * hash(Math.round(rt * 8), Math.round(f), 3));
                }
              }
            }
            const col = pal(Math.min(1, v));
            const i = (r * bw + x) * 4;
            im.data[i] = col[0];
            im.data[i + 1] = col[1];
            im.data[i + 2] = col[2];
            im.data[i + 3] = 255;
          }
        }
        cg.putImageData(im, 0, 0);
      }
      sonarLast = cur;
    }
    g.fillStyle = '#030805';
    g.fillRect(0, 0, w, h);
    const lx = w * 0.03, rx2 = w * 0.51, ty = h * 0.12;
    g.drawImage(btr!, lx, ty);
    g.drawImage(lofar!, rx2, ty);
    const lc = pal(0.7);
    g.strokeStyle = `rgba(${lc[0]},${lc[1]},${lc[2]},0.6)`;
    g.strokeRect(lx, ty, bw, bh);
    g.strokeRect(rx2, ty, bw, bh);
    g.fillStyle = `rgb(${lc[0]},${lc[1]},${lc[2]})`;
    g.font = font(Math.max(11, h / 55), 'bold');
    g.fillText('BTR  BEARING-TIME', lx, ty - h * 0.05);
    g.fillText('LOFAR  0–200 Hz', rx2, ty - h * 0.05);
    g.font = font(Math.max(9, h / 75));
    for (let b = 0; b <= 360; b += 60) g.fillText(String(b).padStart(3, '0'), lx + (b / 360) * bw - 10, ty - 6);
    for (let f = 0; f <= 200; f += 50) g.fillText(`${f}`, rx2 + (f / 200) * bw - 6, ty - 6);
    g.fillText(`${DTG(c)}   OWN SHIP CSE 090 SPD 8 KTS   ARRAY: TOWED`, lx, h - h * 0.03);
    // contact labels on the BTR
    for (const ct of cs) {
      const b = (ct.b0 + ct.rate * (cur / 8) + 360) % 360;
      g.fillText(`${ct.id}`, lx + (b / 360) * bw - 8, ty + bh + 14);
    }
    g.textAlign = 'right';
    g.fillText(`CONTACTS ${cs.length}`, w - w * 0.03, h - h * 0.03);
    g.textAlign = 'left';
  },
  meta(c) {
    const cs = contacts(Number(c.p.seed));
    const rt = Math.floor(c.vt * 8) / 8;
    return {
      json: {
        timestamp_utc: ISO(c),
        array: 'towed_passive',
        own_ship: { course_deg: 90, speed_kts: 8 },
        contacts: cs.map((ct) => ({ contact_id: ct.id, classification: ct.type, bearing_deg: +(((ct.b0 + ct.rate * rt) % 360 + 360) % 360).toFixed(1), bearing_rate_deg_s: ct.rate, broadband_level: ct.bb, tonals_hz: ct.tonals })),
      },
    };
  },
};

export const SENSORS: Sensor[] = [EOIR, SAR, RADAR, ESM, SONAR];
