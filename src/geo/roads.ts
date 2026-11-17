/**
 * Road and river networks from OpenStreetMap data (ODbL).
 * Primary source: OpenFreeMap vector tiles (same free, keyless host as the basemap) –
 * the "transportation" and "waterway" layers are decoded into a routing graph.
 * Fallback: the Overpass API.
 * Builds a routable graph and runs Dijkstra so ground units follow real roads and
 * boats follow real rivers. Results are cached in memory and in localStorage.
 */
import type { LonLat } from '../scenario/types';
import { distM } from './geo';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

export interface Network {
  nodes: Map<number, LonLat>;
  adj: Map<number, { to: number; w: number; len: number }[]>;
  /** Raw polylines (for debugging / river display) */
  lines: LonLat[][];
}

export interface BBox {
  s: number;
  w: number;
  n: number;
  e: number;
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/** Cost multiplier per highway class (lower = preferred by military convoys). */
const ROAD_COST: Record<string, number> = {
  motorway: 0.8,
  trunk: 0.8,
  primary: 0.85,
  secondary: 0.95,
  tertiary: 1.05,
  unclassified: 1.2,
  track: 1.5,
  motorway_link: 1,
  trunk_link: 1,
  primary_link: 1,
  secondary_link: 1.05,
  tertiary_link: 1.1,
};

const cache = new Map<string, Network>();

function cacheKey(kind: string, b: BBox) {
  const r = (x: number) => x.toFixed(3);
  return `scc-net:${kind}:${r(b.s)},${r(b.w)},${r(b.n)},${r(b.e)}`;
}

async function overpass(query: string): Promise<any> {
  let lastErr: unknown;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function build(json: any, kind: 'roads' | 'rivers'): Network {
  const nodes = new Map<number, LonLat>();
  const adj: Network['adj'] = new Map();
  const lines: LonLat[][] = [];
  for (const el of json.elements) if (el.type === 'node') nodes.set(el.id, [el.lon, el.lat]);
  for (const el of json.elements) {
    if (el.type !== 'way') continue;
    const cls = el.tags?.highway ?? el.tags?.waterway ?? '';
    const cost = kind === 'roads' ? ROAD_COST[cls] ?? 1.3 : cls === 'river' ? 1 : 1.3;
    const ids: number[] = el.nodes.filter((id: number) => nodes.has(id));
    lines.push(ids.map((id) => nodes.get(id)!));
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1];
      const b = ids[i];
      const len = distM(nodes.get(a)!, nodes.get(b)!);
      const w = len * cost;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push({ to: b, w, len });
      adj.get(b)!.push({ to: a, w, len });
    }
  }
  return finalize(nodes, adj, lines, kind);
}

function finalize(nodes: Map<number, LonLat>, adj: Network['adj'], lines: LonLat[][], kind: 'roads' | 'rivers'): Network {
  // keep only the largest connected component so routes always resolve
  const comp = new Map<number, number>();
  let best = -1;
  let bestSize = 0;
  let c = 0;
  for (const start of adj.keys()) {
    if (comp.has(start)) continue;
    let size = 0;
    const stack = [start];
    comp.set(start, c);
    while (stack.length) {
      const n = stack.pop()!;
      size++;
      for (const e of adj.get(n)!) if (!comp.has(e.to)) (comp.set(e.to, c), stack.push(e.to));
    }
    if (size > bestSize) (bestSize = size), (best = c);
    c++;
  }
  if (kind === 'roads') {
    for (const [id, cc] of comp) if (cc !== best) adj.delete(id);
  }
  return { nodes, adj, lines };
}

const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'track']);
const TILE_COST: Record<string, number> = { motorway: 0.8, trunk: 0.8, primary: 0.85, secondary: 0.95, tertiary: 1.05, minor: 1.2, track: 1.5 };
let tileTemplate: string | null = null;

function lon2tile(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2tile(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Build a network from OpenFreeMap vector tiles. Vertices are snapped (~2 m) to stitch tile seams. */
async function loadFromTiles(kind: 'roads' | 'rivers', b: BBox): Promise<Network | null> {
  if (!tileTemplate) {
    const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
    tileTemplate = tj.tiles[0] as string;
  }
  let z = kind === 'roads' ? 13 : 12;
  const count = (zz: number) => (lon2tile(b.e, zz) - lon2tile(b.w, zz) + 1) * (lat2tile(b.s, zz) - lat2tile(b.n, zz) + 1);
  while (z > 9 && count(z) > 48) z--;
  const x0 = lon2tile(b.w, z), x1 = lon2tile(b.e, z), y0 = lat2tile(b.n, z), y1 = lat2tile(b.s, z);
  const jobs: Promise<void>[] = [];
  const nodes = new Map<number, LonLat>();
  const ids = new Map<string, number>();
  const adj: Network['adj'] = new Map();
  const lines: LonLat[][] = [];
  const idOf = (p: LonLat) => {
    const k = `${Math.round(p[0] * 50000)},${Math.round(p[1] * 50000)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = ids.size + 1;
      ids.set(k, id);
      nodes.set(id, p);
    }
    return id;
  };
  const addLine = (coords: LonLat[], cost: number) => {
    lines.push(coords);
    let prev = idOf(coords[0]);
    for (let i = 1; i < coords.length; i++) {
      const id = idOf(coords[i]);
      if (id === prev) continue;
      const len = distM(nodes.get(prev)!, nodes.get(id)!);
      if (!adj.has(prev)) adj.set(prev, []);
      if (!adj.has(id)) adj.set(id, []);
      adj.get(prev)!.push({ to: id, w: len * cost, len });
      adj.get(id)!.push({ to: prev, w: len * cost, len });
      prev = id;
    }
  };
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const url = tileTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      jobs.push(
        fetch(url)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((buf) => {
            if (!buf) return;
            const vt = new VectorTile(new PbfReader(new Uint8Array(buf)) as any);
            const layer = vt.layers[kind === 'roads' ? 'transportation' : 'waterway'];
            if (!layer) return;
            for (let i = 0; i < layer.length; i++) {
              const f = layer.feature(i);
              const cls = String(f.properties.class ?? '');
              if (kind === 'roads' && (!ROAD_CLASSES.has(cls) || f.properties.brunnel === 'ferry')) continue;
              if (kind === 'rivers' && cls !== 'river' && cls !== 'canal') continue;
              const gj = f.toGeoJSON(x, y, z);
              const g = gj.geometry as GeoJSON.Geometry;
              const parts: LonLat[][] = g.type === 'LineString' ? [g.coordinates as LonLat[]] : g.type === 'MultiLineString' ? (g.coordinates as LonLat[][]) : [];
              for (const p of parts) if (p.length > 1) addLine(p, kind === 'roads' ? TILE_COST[cls] ?? 1.3 : 1);
            }
          })
          .catch(() => undefined),
      );
    }
  await Promise.all(jobs);
  if (!adj.size) return null;
  return finalize(nodes, adj, lines, kind);
}

export async function loadNetwork(kind: 'roads' | 'rivers', b: BBox): Promise<Network | null> {
  const key = cacheKey(kind, b);
  if (cache.has(key)) return cache.get(key)!;
  try {
    const net = await loadFromTiles(kind, b);
    if (net) {
      cache.set(key, net);
      return net;
    }
  } catch (e) {
    console.warn('[scc] vector-tile network failed, trying Overpass', e);
  }
  let json: any = null;
  try {
    const s = localStorage.getItem(key);
    if (s) json = JSON.parse(s);
  } catch {
    /* storage unavailable */
  }
  if (!json) {
    const bb = `${b.s},${b.w},${b.n},${b.e}`;
    const q =
      kind === 'roads'
        ? `[out:json][timeout:90];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|track|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bb});out body;>;out skel qt;`
        : `[out:json][timeout:90];way["waterway"~"^(river|canal)$"](${bb});out body;>;out skel qt;`;
    try {
      json = await overpass(q);
      try {
        localStorage.setItem(key, JSON.stringify(json));
      } catch {
        /* quota exceeded: fine, memory cache only */
      }
    } catch (e) {
      console.warn('[scc] Overpass failed, falling back to cross-country movement', e);
      return null;
    }
  }
  const net = build(json, kind);
  cache.set(key, net);
  return net;
}

export function nearestNode(net: Network, p: LonLat, maxM = Infinity): number | null {
  let best: number | null = null;
  let bestD = maxM;
  for (const id of net.adj.keys()) {
    const d = distM(net.nodes.get(id)!, p);
    if (d < bestD) (bestD = d), (best = id);
  }
  return best;
}

/** Dijkstra with a binary heap. Returns the coordinate path or null. */
export function route(net: Network, from: LonLat, to: LonLat): LonLat[] | null {
  const s = nearestNode(net, from);
  const t = nearestNode(net, to);
  if (s === null || t === null) return null;
  if (s === t) return [from, net.nodes.get(s)!, to];
  const dist = new Map<number, number>([[s, 0]]);
  const prev = new Map<number, number>();
  const heap: [number, number][] = [[0, s]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, n] = pop();
    if (n === t) break;
    if (d > (dist.get(n) ?? Infinity)) continue;
    for (const e of net.adj.get(n) ?? []) {
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, n);
        push([nd, e.to]);
      }
    }
  }
  if (!prev.has(t)) return null;
  const path: LonLat[] = [];
  for (let n: number | undefined = t; n !== undefined; n = prev.get(n)) path.push(net.nodes.get(n)!);
  path.reverse();
  return [from, ...path, to];
}
