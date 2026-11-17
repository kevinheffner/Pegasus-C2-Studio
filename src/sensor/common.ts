/** Shared helpers for the representative (non-physics) sensor displays. */
import type { LonLat, Scenario, Unit } from '../scenario/types';
import { sampleTrack, sideOf, type SimState } from '../scenario/sim';

/** fast deterministic hash noise in [0,1) */
export function hash(x: number, y = 0, z = 0): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** approx. gaussian from two hashes */
export const gauss = (x: number, y: number, z: number) => Math.sqrt(-2 * Math.log(hash(x, y, z) + 1e-9)) * Math.cos(2 * Math.PI * hash(x + 7, y + 13, z + 3));

export type RGB = [number, number, number];
/** colour maps: value 0..1 → rgb */
export function colormap(name: string): (v: number) => RGB {
  const stops: Record<string, [number, RGB][]> = {
    ironbow: [[0, [0, 0, 10]], [0.2, [50, 0, 120]], [0.45, [180, 30, 100]], [0.65, [240, 100, 20]], [0.85, [255, 200, 40]], [1, [255, 255, 230]]],
    rainbow: [[0, [0, 0, 80]], [0.25, [0, 90, 255]], [0.5, [0, 220, 120]], [0.75, [255, 220, 0]], [1, [255, 40, 0]]],
    phosphor: [[0, [0, 6, 0]], [0.5, [20, 150, 40]], [1, [190, 255, 170]]],
    amber: [[0, [8, 4, 0]], [0.5, [170, 90, 0]], [1, [255, 220, 140]]],
    jet: [[0, [0, 0, 60]], [0.15, [0, 0, 200]], [0.4, [0, 200, 255]], [0.6, [120, 255, 120]], [0.8, [255, 200, 0]], [1, [200, 0, 0]]],
    gray: [[0, [0, 0, 0]], [1, [255, 255, 255]]],
  };
  const s = stops[name] ?? stops.gray;
  const lut: RGB[] = [];
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < s.length - 2 && v > s[k + 1][0]) k++;
    const [a, ca] = s[k];
    const [b, cb] = s[k + 1];
    const f = Math.max(0, Math.min(1, (v - a) / (b - a || 1)));
    lut.push([ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]);
  }
  return (v: number) => lut[Math.max(0, Math.min(255, Math.round(v * 255)))];
}

/** generic target class (no real model names) */
export interface TargetClass {
  cls: 'MBT' | 'IFV' | 'APC' | 'SPH' | 'RECON' | 'SAM' | 'TRUCK' | 'CMD' | 'AIRCRAFT' | 'HELO' | 'UAV' | 'BOAT';
  lengthM: number;
  widthM: number;
  count: number; // vehicles drawn per unit symbol
  rcs: number; // representative dBsm
  engineC: number; // representative engine deck temperature when running
}
export function targetClass(u: Unit): TargetClass {
  const set = u.sidc.slice(4, 6);
  const e = u.sidc.slice(10, 16);
  const ech = u.sidc.slice(8, 10);
  const n = ech === '15' ? 3 : ech === '16' ? 5 : ech === '18' || ech === '21' ? 7 : 4;
  if (set === '01') {
    if (e.startsWith('1102')) return { cls: 'HELO', lengthM: 17, widthM: 3, count: 1, rcs: 10, engineC: 300 };
    if (e.startsWith('1103')) return { cls: 'UAV', lengthM: 11, widthM: 20, count: 1, rcs: 0, engineC: 120 };
    return { cls: 'AIRCRAFT', lengthM: 16, widthM: 13, count: 1, rcs: 5, engineC: 500 };
  }
  if (set === '30') return { cls: 'BOAT', lengthM: 12, widthM: 3.5, count: 1, rcs: 15, engineC: 90 };
  if (e.startsWith('1205')) return { cls: 'MBT', lengthM: 9.5, widthM: 3.6, count: n, rcs: 22, engineC: 85 };
  if (e.startsWith('121102')) return { cls: 'IFV', lengthM: 7, widthM: 3.2, count: n, rcs: 18, engineC: 80 };
  if (e.startsWith('121104')) return { cls: 'APC', lengthM: 7.5, widthM: 2.9, count: n, rcs: 16, engineC: 75 };
  if (e.startsWith('1211')) return { cls: 'TRUCK', lengthM: 8, widthM: 2.5, count: Math.max(2, n - 2), rcs: 12, engineC: 70 };
  if (e.startsWith('1213')) return { cls: 'RECON', lengthM: 6, widthM: 2.6, count: Math.max(2, n - 1), rcs: 12, engineC: 70 };
  if (e.startsWith('1303')) return { cls: 'SPH', lengthM: 11, widthM: 3.4, count: Math.max(3, n - 1), rcs: 20, engineC: 80 };
  if (e.startsWith('1301')) return { cls: 'SAM', lengthM: 9, widthM: 3.2, count: 3, rcs: 18, engineC: 75 };
  return { cls: 'CMD', lengthM: 8, widthM: 2.8, count: 3, rcs: 14, engineC: 70 };
}

export interface Vehicle {
  id: string;
  unitId: string;
  cls: TargetClass;
  pos: LonLat;
  heading: number;
  moving: boolean;
  speed: number;
  status: string;
  side: 'friend' | 'hostile' | 'other';
  firing: boolean;
  air: boolean;
}

const M_PER_DEG = 111320;
/** expand unit symbols into individual vehicles in a formation (column when moving, line when halted) */
export function vehiclesOf(state: SimState, sc: Scenario, firingIds: Set<string>): Vehicle[] {
  const out: Vehicle[] = [];
  for (const u of state.units) {
    const cls = targetClass(u.unit);
    const air = !!u.unit.air;
    const n = u.status === 'destroyed' ? Math.max(1, Math.round(cls.count * 0.6)) : Math.max(1, Math.round(cls.count * Math.max(0.35, u.strength)));
    const hd = (u.heading * Math.PI) / 180;
    const cos = Math.cos((u.pos[1] * Math.PI) / 180);
    for (let k = 0; k < n; k++) {
      // column along heading when moving; wedge/line across when halted
      const j = k - (n - 1) / 2;
      const spacing = u.moving ? 45 : 70;
      const along = u.moving ? -k * spacing : (hash(k, u.unit.id.length, 3) - 0.5) * 60;
      const across = u.moving ? (hash(k, 9, u.unit.id.length) - 0.5) * 12 : j * spacing;
      const dx = along * Math.sin(hd) + across * Math.cos(hd);
      const dy = along * Math.cos(hd) - across * Math.sin(hd);
      out.push({
        id: `${u.unit.id}-${k}`,
        unitId: u.unit.id,
        cls,
        pos: [u.pos[0] + dx / (M_PER_DEG * cos), u.pos[1] + dy / M_PER_DEG],
        heading: u.heading + (u.moving ? 0 : (hash(k, 4, 5) - 0.5) * 30),
        moving: u.moving,
        speed: u.speed,
        status: k === 0 && u.status === 'destroyed' ? 'destroyed' : u.status === 'destroyed' && k % 2 ? 'destroyed' : u.status === 'damaged' && k === n - 1 ? 'destroyed' : 'ok',
        side: sideOf(u.sidc),
        firing: firingIds.has(u.unit.id) && k % 2 === 0,
        air,
      });
    }
  }
  void sc;
  return out;
}

export function firingUnits(state: SimState, sc: Scenario, t: number): Set<string> {
  const s = new Set<string>();
  for (const e of sc.events ?? []) {
    if (e.t > t) break;
    if (e.type === 'fire' && t >= e.t && t <= e.t + Math.min(0.6, e.duration)) s.add(e.from);
  }
  void state;
  return s;
}

/** representative positions of a unit at time t */
export const unitPos = (u: Unit, t: number) => sampleTrack(u.track, t).pos;

export function fmtLat(v: number) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${v >= 0 ? 'N' : 'S'}${String(d).padStart(2, '0')}°${m.toFixed(3).padStart(6, '0')}'`;
}
export function fmtLon(v: number) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${v >= 0 ? 'E' : 'W'}${String(d).padStart(3, '0')}°${m.toFixed(3).padStart(6, '0')}'`;
}

export function distM(a: LonLat, b: LonLat) {
  const dx = (b[0] - a[0]) * M_PER_DEG * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = (b[1] - a[1]) * M_PER_DEG;
  return Math.hypot(dx, dy);
}
export function bearingDeg(a: LonLat, b: LonLat) {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}
