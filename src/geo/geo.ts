import type { LonLat } from '../scenario/types';

export const R_EARTH = 6371008.8;
const toR = Math.PI / 180;

export function distM(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * toR;
  const dLon = (b[0] - a[0]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthM(pts: LonLat[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distM(pts[i - 1], pts[i]);
  return d;
}

/** Point at distance d (m) along a polyline. */
export function along(pts: LonLat[], d: number): LonLat {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = distM(pts[i - 1], pts[i]);
    if (acc + seg >= d) {
      const f = seg ? (d - acc) / seg : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}

/**
 * Local "battle frame": origin at AO center, u axis points along the direction of the
 * friendly attack (bearing), v axis points to the left of u. Units: km.
 */
export class BattleFrame {
  private cosLat: number;
  constructor(public origin: LonLat, public bearingDeg: number) {
    this.cosLat = Math.cos(origin[1] * toR);
  }
  /** (u,v) km → lon/lat */
  toLL(u: number, v: number): LonLat {
    const b = this.bearingDeg * toR;
    // u along bearing (east = sin b, north = cos b); v to the left (east = -cos b, north = sin b)
    const east = u * Math.sin(b) - v * Math.cos(b);
    const north = u * Math.cos(b) + v * Math.sin(b);
    const dLat = (north * 1000) / R_EARTH / toR;
    const dLon = (east * 1000) / (R_EARTH * this.cosLat) / toR;
    return [this.origin[0] + dLon, this.origin[1] + dLat];
  }
  /** lon/lat → (u,v) km */
  toUV(p: LonLat): [number, number] {
    const east = ((p[0] - this.origin[0]) * toR * R_EARTH * this.cosLat) / 1000;
    const north = ((p[1] - this.origin[1]) * toR * R_EARTH) / 1000;
    const b = this.bearingDeg * toR;
    return [east * Math.sin(b) + north * Math.cos(b), -east * Math.cos(b) + north * Math.sin(b)];
  }
}

/** Ground extent (km) visible in a W×H px viewport at a zoom (web mercator). */
export function extentKm(lat: number, zoom: number, w = 1920, h = 1080) {
  const mpp = (78271.51696 * Math.cos(lat * toR)) / 2 ** zoom; // MapLibre: 512 px tiles
  return { width: (w * mpp) / 1000, height: (h * mpp) / 1000, mpp };
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T>(arr: T[]) => arr[Math.floor(next() * arr.length)],
  };
}
export type Rng = ReturnType<typeof rng>;

// ---------- UTM (for the C2 grid overlay) ----------
const a = 6378137;
const f = 1 / 298.257223563;
const k0 = 0.9996;
const e2 = f * (2 - f);
const ep2 = e2 / (1 - e2);

export function utmZone(lon: number) {
  return Math.floor((lon + 180) / 6) + 1;
}

export function llToUtm(lon: number, lat: number, zone = utmZone(lon)) {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * toR;
  const phi = lat * toR;
  const lam = lon * toR;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lon0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) y += 10000000;
  return { x, y, zone };
}

export function utmToLl(x: number, y: number, zone: number, south = false): LonLat {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * toR;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const yy = south ? y - 10000000 : y;
  const M = yy / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = (x - 500000) / (N1 * k0);
  const lat =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) *
      (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon =
    lon0 +
    (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120) /
      Math.cos(phi1);
  return [lon / toR, lat / toR];
}

const LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

/** MGRS string (1 m precision → digits). */
export function toMgrs(lon: number, lat: number, digits = 5): string {
  const { x, y, zone } = llToUtm(lon, lat);
  const band = LAT_BANDS[Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)))];
  const col = COL_SETS[(zone - 1) % 3][Math.floor(x / 100000) - 1];
  const rowOffset = zone % 2 === 0 ? 5 : 0;
  const row = ROW_LETTERS[(Math.floor(y / 100000) + rowOffset) % 20];
  const div = 10 ** (5 - digits);
  const e = Math.floor((x % 100000) / div).toString().padStart(digits, '0');
  const n = Math.floor((y % 100000) / div).toString().padStart(digits, '0');
  return `${zone}${band} ${col}${row} ${e} ${n}`;
}
