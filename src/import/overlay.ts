/**
 * Overlay importers: MilX (.milxly / .milxlyz, gs-soft / map.army) and NATO Vector Graphics (.nvg).
 * Units keep their (2525C) letter SIDCs, which milsymbol renders directly. Tactical graphics are
 * converted to 2525D numeric SIDCs for the mil-sym-ts renderer using a crosswalk of common
 * control measures; anything unmapped is drawn as plain geometry.
 */
import type { Graphic, LonLat, Scenario, Unit } from '../scenario/types';

/** 2525C scheme char + 6-char function id  →  2525D symbol set 25 entity code */
const C_TO_D: Record<string, string> = {
  'GGLB----': '110100', // boundary
  'GGLL----': '110200', // light line
  'GGLF----': '140100', // FLOT
  'GGLC----': '140200', // line of contact
  'GGLP----': '140300', // phase line
  'GDLF----': '140400', // FEBA
  'GOLT----': '141100', // line of departure
  'GOLAGM--': '151403', // axis of advance – main attack
  'GOLAGS--': '151404', // axis of advance – supporting attack
  'GOLAV---': '151401', // axis of advance – aviation
  'GOLAA---': '151401', // axis of advance – airborne
  'GOLKGM--': '140602', // direction of attack – main
  'GOLKGS--': '140603', // direction of attack – supporting
  'GOLKA---': '140601', // direction of attack – aviation
  'GGAA----': '150200', // assembly area
  'GGAF----': '151000', // fortified area
  'GOAO----': '151700', // objective
  'GDAB----': '151200', // battle position
  'GDAE----': '151300', // engagement area
  'MSL-----': '290900', // fortified line
  'TK------': '340600', // counterattack
};

const ECH_C_TO_D: Record<string, string> = { A: '11', B: '12', C: '13', D: '14', E: '15', F: '16', G: '17', H: '18', I: '21', J: '22', K: '23', L: '24', M: '25' };
const AFF_C_TO_D: Record<string, string> = { P: '0', U: '1', A: '2', F: '3', N: '4', S: '5', H: '6', J: '6', K: '6', D: '2', M: '2', G: '1', W: '1' };

/** Convert a 2525C/APP-6A/B tactical graphic SIDC to 2525D. Returns null when unmapped. */
export function graphicCtoD(sidc: string): string | null {
  const s = sidc.toUpperCase().replace(/\*/g, '-');
  if (s[0] !== 'G') return null;
  // scheme char (G=C2 general, M=mobility/survivability, T=tasks) + function id, e.g. "GGLB"
  const code = (s[2] + s.slice(4, 10)).replace(/-+$/, '');
  let entity: string | undefined;
  let bestLen = 0;
  for (const [k, v] of Object.entries(C_TO_D)) {
    const kk = k.replace(/-+$/, '');
    if (code.startsWith(kk) && kk.length > bestLen) {
      entity = v;
      bestLen = kk.length;
    }
  }
  if (!entity) return null;
  const aff = AFF_C_TO_D[s[1]] ?? '3';
  const ech = ECH_C_TO_D[s[11]] ?? '00';
  return `100${aff}2500${entity === '110100' ? ech : '00'}${entity}0000`;
}

function bboxView(points: LonLat[]): Scenario['view'] {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const w = Math.min(...lons);
  const e = Math.max(...lons);
  const s = Math.min(...lats);
  const n = Math.max(...lats);
  const center: LonLat = [(w + e) / 2, (s + n) / 2];
  const spanX = Math.max(0.005, (e - w) * 1.3);
  const spanY = Math.max(0.005, (n - s) * 1.3);
  const zx = Math.log2((360 * 1920) / 512 / spanX);
  const latR = (center[1] * Math.PI) / 180;
  const zy = Math.log2((360 * 1080 * Math.cos(latR)) / 512 / spanY);
  return { t: 0, center, zoom: Math.max(3, Math.min(16, Math.min(zx, zy))), bearing: 0, pitch: 0 };
}

function baseScenario(name: string, units: Unit[], graphics: Graphic[]): Scenario {
  const all = [...units.flatMap((u) => u.track.map((w) => w.pos)), ...graphics.flatMap((g) => g.points)];
  return {
    meta: { name, title: name, start: new Date().toISOString().slice(0, 16) + ':00Z', durationMin: 60, banner: 'EXERCISE – SYNTHETIC DATA' },
    view: all.length ? bboxView(all) : { t: 0, center: [10, 50], zoom: 6 },
    units,
    graphics,
    events: [],
  };
}

const unitMods = (attrs: Record<string, string>) => ({
  uniqueDesignation: attrs.T,
  higherFormation: attrs.M,
  additionalInformation: attrs.H,
  staffComments: attrs.G,
  reinforcedReduced: attrs.F,
});

// ---------------- MilX ----------------
export function parseMilX(xml: string): Scenario {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const name = doc.getElementsByTagName('Name')[0]?.textContent ?? 'MilX import';
  const units: Unit[] = [];
  const graphics: Graphic[] = [];
  let n = 0;
  for (const g of Array.from(doc.getElementsByTagName('MilXGraphic'))) {
    const symXml = g.getElementsByTagName('MssStringXML')[0]?.textContent ?? '';
    const sdoc = new DOMParser().parseFromString(symXml, 'application/xml');
    const sym = sdoc.getElementsByTagName('Symbol')[0];
    if (!sym) continue;
    const sidc = sym.getAttribute('ID') ?? '';
    const attrs: Record<string, string> = {};
    for (const a of Array.from(sym.getElementsByTagName('Attribute'))) attrs[a.getAttribute('ID') ?? ''] = a.textContent ?? '';
    const points: LonLat[] = Array.from(g.getElementsByTagName('Point')).map((p) => [
      parseFloat(p.getElementsByTagName('X')[0]?.textContent ?? '0'),
      parseFloat(p.getElementsByTagName('Y')[0]?.textContent ?? '0'),
    ]);
    if (!points.length) continue;
    const id = `milx-${++n}`;
    if (sidc[0] === 'G') {
      const d = graphicCtoD(sidc);
      // MilX arrows: P1 = tip, P2 = start of shaft, P3 = width → mil-sym: tip first as well
      if (d) graphics.push({ id, sidc: d, points, modifiers: { T: attrs.T, H: attrs.H, W: attrs.W } });
      else graphics.push({ id, points, plain: { kind: points.length > 2 && sidc.slice(4, 5) === 'A' ? 'polygon' : 'line', label: attrs.T } });
    } else {
      units.push({ id, sidc, modifiers: unitMods(attrs), track: [{ t: 0, pos: points[0] }] });
    }
  }
  return baseScenario(name, units, graphics);
}

// ---------------- NVG ----------------
function parseStyle(style: string | null) {
  const out: Record<string, string> = {};
  for (const part of (style ?? '').split(';')) {
    const [k, v] = part.split(':').map((x) => x?.trim());
    if (k && v) out[k] = v;
  }
  const rgb = (c?: string) => {
    if (!c || c === 'none') return c;
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c);
    return m ? '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('') : c;
  };
  return { stroke: rgb(out['stroke']), fill: rgb(out['fill']), width: out['stroke-width'] ? parseFloat(out['stroke-width']) : undefined };
}

const pts = (s: string | null): LonLat[] =>
  (s ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.split(',').map(Number) as LonLat);

export function parseNVG(xml: string): Scenario {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const units: Unit[] = [];
  const graphics: Graphic[] = [];
  let n = 0;
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      const tag = c.localName;
      const sym = (c.getAttribute('symbol') ?? '').split(':').pop() ?? '';
      const label = c.getAttribute('label') ?? undefined;
      const style = parseStyle(c.getAttribute('style'));
      const id = `nvg-${++n}`;
      if (tag === 'g' || tag === 'composite') {
        walk(c);
        continue;
      }
      if (tag === 'point' || tag === 'text') {
        const x = parseFloat(c.getAttribute('x') ?? 'NaN');
        const y = parseFloat(c.getAttribute('y') ?? 'NaN');
        if (isNaN(x) || isNaN(y)) continue;
        if (sym && sym[0] !== 'G') units.push({ id, sidc: sym.replace(/\*/g, '-'), modifiers: { uniqueDesignation: label }, track: [{ t: 0, pos: [x, y] }] });
        else if (tag === 'text') graphics.push({ id, points: [[x, y]], plain: { kind: 'line', label: c.textContent?.trim() || label, stroke: style.stroke } });
        continue;
      }
      if (tag === 'circle') {
        const cx = parseFloat(c.getAttribute('cx') ?? '0');
        const cy = parseFloat(c.getAttribute('cy') ?? '0');
        graphics.push({ id, points: [[cx, cy]], plain: { kind: 'circle', radiusM: parseFloat(c.getAttribute('r') ?? '1000'), stroke: style.stroke, fill: style.fill, width: style.width, label } });
        continue;
      }
      const p = pts(c.getAttribute('points'));
      if (p.length < 2) continue;
      const d = sym ? graphicCtoD(sym) : null;
      if (d) {
        graphics.push({ id, sidc: d, points: p, modifiers: { T: label } });
        continue;
      }
      const kind = tag === 'polygon' ? 'polygon' : tag === 'arrow' ? 'arrow' : 'line';
      graphics.push({ id, points: p, plain: { kind, stroke: style.stroke, fill: style.fill, width: style.width, label } });
    }
  };
  walk(doc.documentElement);
  return baseScenario('NVG import', units, graphics);
}

/** Unzip a .milxlyz (single-entry deflate zip) using the browser's DecompressionStream. */
export async function unzipFirst(buf: ArrayBuffer): Promise<string> {
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== 0x04034b50) throw new Error('not a zip');
  const method = v.getUint16(8, true);
  const compSize = v.getUint32(18, true);
  const nameLen = v.getUint16(26, true);
  const extraLen = v.getUint16(28, true);
  const start = 30 + nameLen + extraLen;
  const data = new Uint8Array(buf, start, compSize || buf.byteLength - start);
  if (method === 0) return new TextDecoder().decode(data);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

export async function importFile(file: File): Promise<Scenario> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.milxlyz') || name.endsWith('.zip')) return parseMilX(await unzipFirst(await file.arrayBuffer()));
  const text = await file.text();
  if (name.endsWith('.json')) return JSON.parse(text) as Scenario;
  if (/<MilXDocument/i.test(text) || name.endsWith('.milxly')) return parseMilX(text);
  if (/nvg/i.test(text.slice(0, 500)) || name.endsWith('.nvg')) return parseNVG(text);
  throw new Error('Unsupported file: ' + file.name);
}
