/**
 * Symbology:
 *  - single-point units/equipment/aircraft via milsymbol (MIT)
 *  - multipoint tactical graphics via the US Army C5ISR renderer mil-sym-ts (Apache-2.0),
 *    which returns GeoJSON we draw with MapLibre line/fill/symbol layers.
 */
import ms from 'milsymbol';
import * as C5 from '@armyc2.c5isr.renderer/mil-sym-ts-web';
import type { Graphic, LonLat } from '../scenario/types';
import type { Look } from './looks';

export interface UnitIcon {
  id: string;
  data: ImageData;
  pixelRatio: number;
  /** offset (CSS px) from the image center to the symbol anchor */
  offset: [number, number];
}

export interface UnitIconRequest {
  sidc: string;
  T?: string;
  M?: string;
  H?: string;
  F?: string;
  direction?: number;
  speedLeader?: number;
  size: number;
}

export class SymbolCache {
  private cache = new Map<string, UnitIcon>();
  constructor(public look: Look, public pixelRatio: number) {}

  reset(look: Look, pixelRatio: number) {
    this.look = look;
    this.pixelRatio = pixelRatio;
    this.cache.clear();
  }

  get(req: UnitIconRequest): UnitIcon {
    const key = `${req.sidc}|${req.T ?? ''}|${req.M ?? ''}|${req.H ?? ''}|${req.F ?? ''}|${req.direction ?? ''}|${req.speedLeader ?? ''}|${req.size}`;
    let icon = this.cache.get(key);
    if (icon) return icon;
    const L = this.look.symbol;
    const opts: Record<string, unknown> = {
      size: req.size,
      uniqueDesignation: req.T,
      higherFormation: req.M,
      additionalInformation: req.H,
      reinforcedReduced: req.F,
      colorMode: L.colorMode,
      fill: L.fill,
      infoColor: L.infoColor,
      infoOutlineColor: L.infoOutline,
      infoOutlineWidth: 3,
      outlineColor: L.outlineColor ?? (this.look.dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)'),
      outlineWidth: L.outlineWidth ?? 2,
      fontfamily: 'Arial, Helvetica, sans-serif',
      infoSize: 44,
    };
    if (req.direction !== undefined) opts.direction = req.direction;
    if (req.speedLeader) opts.speedLeader = req.speedLeader;
    // milsymbol chokes on undefined option values
    for (const k of Object.keys(opts)) if (opts[k] === undefined || opts[k] === '') delete opts[k];
    const sym = new ms.Symbol(req.sidc, opts as any);
    const pr = this.pixelRatio;
    const canvas = sym.asCanvas(pr);
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const size = sym.getSize();
    const anchor = sym.getAnchor();
    icon = {
      id: 'u:' + key,
      data,
      pixelRatio: pr,
      offset: [size.width / 2 - anchor.x, size.height / 2 - anchor.y],
    };
    this.cache.set(key, icon);
    return icon;
  }
}

// ---------------- tactical graphics ----------------

let rendererReady = false;
function initRenderer() {
  if (rendererReady) return;
  try {
    const rs = C5.RendererSettings.getInstance() as any;
    rs.setTextOutlineWidth?.(2);
    rs.setMPLabelFont?.('arial', 'bold', 12);
  } catch {
    /* optional */
  }
  rendererReady = true;
}

export interface GraphicFeatures {
  lines: GeoJSON.Feature[];
  fills: GeoJSON.Feature[];
  labels: GeoJSON.Feature[];
}

const MOD_KEYS: Record<string, string> = {
  T: 'T_UNIQUE_DESIGNATION_1',
  T1: 'T1_UNIQUE_DESIGNATION_2',
  H: 'H_ADDITIONAL_INFO_1',
  W: 'W_DTG_1',
  W1: 'W1_DTG_2',
  AM: 'AM_DISTANCE',
  AN: 'AN_AZIMUTH',
};

function ptSize(s: unknown): number {
  if (typeof s === 'number') return s;
  const m = /([\d.]+)\s*(pt|px)?/.exec(String(s ?? ''));
  if (!m) return 13;
  const v = parseFloat(m[1]);
  return m[2] === 'pt' ? v * 1.333 : v;
}

function recolor(c: string | undefined, look: Look): string {
  if (!c) return look.graphicNeutral;
  const x = c.toLowerCase();
  if (x === '#000000' || x === '#000' || x === 'black') return look.graphicNeutral;
  return c.length === 9 ? '#' + c.slice(3) : c; // #AARRGGBB → #RRGGBB
}

/**
 * Render a tactical graphic for the current viewport.
 * @param bbox [west, south, east, north]
 */
export function renderGraphic(g: Graphic, points: LonLat[], look: Look, pxW: number, pxH: number, bbox: [number, number, number, number]): GraphicFeatures {
  const out: GraphicFeatures = { lines: [], fills: [], labels: [] };
  if (g.plain || !g.sidc) return renderPlain(g, points, look, out);
  initRenderer();
  const mods = new Map<string, string>();
  for (const [k, v] of Object.entries(g.modifiers ?? {})) {
    const key = (C5.Modifiers as any)[MOD_KEYS[k]];
    if (key !== undefined && v) mods.set(key, String(v));
  }
  const attrs = new Map<string, string>();
  if (g.color) attrs.set((C5.MilStdAttributes as any).LineColor, g.color.replace('#', ''));
  const cp = points.map((p) => `${p[0]},${p[1]}`).join(' ');
  let json: any;
  try {
    const res = C5.WebRenderer.RenderSymbol2D(g.id, g.id, '', g.sidc, cp, Math.round(pxW), Math.round(pxH), bbox.join(','), mods, attrs, C5.WebRenderer.OUTPUT_FORMAT_GEOJSON);
    json = JSON.parse(res);
  } catch (e) {
    console.warn('[scc] graphic render failed', g.id, e);
    return out;
  }
  if (json.type === 'error') {
    console.warn('[scc]', json.error);
    return out;
  }
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Point' && p.label !== undefined) {
      if (!p.label) continue;
      const align = String(p.labelAlign ?? 'center');
      out.labels.push({
        type: 'Feature',
        geometry: geom,
        properties: {
          label: p.label,
          size: ptSize(p.fontSize),
          color: recolor(p.fontColor, look),
          halo: look.graphicHalo,
          rotate: Number(p.rotation ?? p.angle ?? 0),
          anchor: align === 'left' || align === 'start' ? 'left' : align === 'right' || align === 'end' ? 'right' : 'center',
        },
      });
    } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      if (!geom.coordinates?.length) continue;
      const fill = p.fillColor;
      if (fill) out.fills.push({ type: 'Feature', geometry: geom, properties: { fill: recolor(fill, look), opacity: Number(p.fillOpacity ?? 0.25) } });
      if (p.strokeColor) {
        const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
        out.lines.push({
          type: 'Feature',
          geometry: { type: 'MultiLineString', coordinates: rings },
          properties: { color: recolor(p.strokeColor, look), width: Number(p.strokeWidth ?? 2), dashed: p.strokeDasharray ? 1 : 0 },
        });
      }
    } else if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
      out.lines.push({
        type: 'Feature',
        geometry: geom,
        properties: { color: recolor(p.strokeColor, look), width: Number(p.strokeWidth ?? 2), dashed: p.strokeDasharray ? 1 : 0 },
      });
    }
  }
  return out;
}

function renderPlain(g: Graphic, points: LonLat[], look: Look, out: GraphicFeatures): GraphicFeatures {
  const p = g.plain ?? { kind: 'line' as const };
  const color = p.stroke ?? look.graphicNeutral;
  const width = p.width ?? 2;
  let ring: LonLat[] = points;
  if (p.kind === 'circle' && points.length) {
    const c = points[0];
    const rM = p.radiusM ?? 1000;
    ring = Array.from({ length: 49 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return [c[0] + ((rM * Math.sin(a)) / (111320 * Math.cos((c[1] * Math.PI) / 180))), c[1] + (rM * Math.cos(a)) / 110540] as LonLat;
    });
  }
  if (p.kind === 'polygon' || p.kind === 'circle') {
    const closed = [...ring, ring[0]];
    if (p.fill && p.fill !== 'none') out.fills.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] }, properties: { fill: p.fill, opacity: 0.25 } });
    out.lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: closed }, properties: { color, width, dashed: 0 } });
  } else {
    out.lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: { color, width, dashed: 0 } });
    if (p.kind === 'arrow' && ring.length >= 2) {
      const a = ring[ring.length - 2];
      const b = ring[ring.length - 1];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.25;
      const w1: LonLat = [b[0] - len * Math.cos(ang - 0.4), b[1] - len * Math.sin(ang - 0.4)];
      const w2: LonLat = [b[0] - len * Math.cos(ang + 0.4), b[1] - len * Math.sin(ang + 0.4)];
      out.lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [w1, b, w2] }, properties: { color, width, dashed: 0 } });
    }
  }
  if (p.label && ring.length) {
    const mid = ring[Math.floor(ring.length / 2)];
    out.labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: { label: p.label, size: 14, color, halo: look.graphicHalo, rotate: 0, anchor: 'center' } });
  }
  return out;
}
