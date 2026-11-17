import type { CameraKey, Graphic, LonLat, Scenario, Unit, Waypoint } from './types';

export type Status = 'present' | 'damaged' | 'destroyed' | 'planned';

export interface UnitState {
  unit: Unit;
  pos: LonLat;
  /** degrees clockwise from north */
  heading: number;
  moving: boolean;
  /** km/h (approx) */
  speed: number;
  status: Status;
  sidc: string;
  /** 0..1 combat strength */
  strength: number;
  /** recent positions (oldest first) for track-history trails */
  trail?: LonLat[];
  /** shown from a stale sighting (fog of war) */
  stale?: boolean;
}

export interface GraphicState {
  graphic: Graphic;
  points: LonLat[];
}

export interface FireState {
  from: LonLat;
  to: LonLat;
  /** 0..1 progress through the event */
  progress: number;
  fromSide: 'friend' | 'hostile' | 'other';
  kind: 'direct' | 'indirect' | 'air';
  seed: number;
}

export interface MessageState {
  text: string;
  age: number;
}

export interface SimState {
  t: number;
  units: UnitState[];
  graphics: GraphicState[];
  fires: FireState[];
  messages: MessageState[];
  camera: CameraKey;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const smooth = (f: number) => f * f * (3 - 2 * f);

function bearing(a: LonLat, b: LonLat): number {
  const toR = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
  const x =
    Math.cos(a[1] * toR) * Math.sin(b[1] * toR) -
    Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function distKm(a: LonLat, b: LonLat): number {
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR;
  const dLon = (b[0] - a[0]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function sampleTrack(track: Waypoint[], t: number) {
  if (track.length === 1 || t <= track[0].t) {
    const h = track.length > 1 ? bearing(track[0].pos, track[1].pos) : 0;
    return { pos: track[0].pos, heading: h, moving: false, speed: 0 };
  }
  const last = track[track.length - 1];
  if (t >= last.t) {
    const prev = track[track.length - 2];
    return { pos: last.pos, heading: bearing(prev.pos, last.pos), moving: false, speed: 0 };
  }
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      const same = a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1];
      const speed = same ? 0 : distKm(a.pos, b.pos) / ((b.t - a.t) / 60);
      return {
        pos: [lerp(a.pos[0], b.pos[0], f), lerp(a.pos[1], b.pos[1], f)] as LonLat,
        heading: same ? 0 : bearing(a.pos, b.pos),
        moving: !same,
        speed,
      };
    }
  }
  return { pos: last.pos, heading: 0, moving: false, speed: 0 };
}

/** Apply a status to a SIDC (2525D/E numeric or 2525C letter). */
export function sidcWithStatus(sidc: string, status: Status): string {
  if (/^\d{20,30}$/.test(sidc)) {
    const code = { present: '0', planned: '1', damaged: '3', destroyed: '4' }[status];
    return sidc.slice(0, 6) + code + sidc.slice(7);
  }
  const code = { present: 'P', planned: 'A', damaged: 'D', destroyed: 'X' }[status];
  return sidc.slice(0, 3) + code + sidc.slice(4);
}

export function sideOf(sidc: string): 'friend' | 'hostile' | 'other' {
  if (/^\d{20,30}$/.test(sidc)) {
    const a = sidc[3];
    if (a === '2' || a === '3') return 'friend';
    if (a === '5' || a === '6') return 'hostile';
    return 'other';
  }
  const a = sidc[1]?.toUpperCase();
  if (a === 'F' || a === 'A' || a === 'D' || a === 'M') return 'friend';
  if (a === 'H' || a === 'S' || a === 'J' || a === 'K') return 'hostile';
  return 'other';
}

export function interpCamera(keys: CameraKey[], t: number): CameraKey {
  if (keys.length === 1 || t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const raw = (t - a.t) / (b.t - a.t || 1);
      const f = b.t - a.t > 4 ? smooth(raw) : raw;
      return {
        t,
        center: [lerp(a.center[0], b.center[0], f), lerp(a.center[1], b.center[1], f)],
        zoom: lerp(a.zoom, b.zoom, f),
        bearing: lerp(a.bearing ?? 0, b.bearing ?? 0, f),
        pitch: lerp(a.pitch ?? 0, b.pitch ?? 0, f),
      };
    }
  }
  return last;
}

function interpPoints(g: Graphic, t: number): LonLat[] {
  const keys = [{ t: -Infinity, points: g.points }, ...(g.keyframes ?? [])];
  if (keys.length === 1) return g.points;
  let a = keys[0];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t < b.t) {
      if (a.t === -Infinity) {
        return a.points;
      }
      const f = smooth((t - a.t) / (b.t - a.t || 1));
      if (a.points.length !== b.points.length) return f < 0.5 ? a.points : b.points;
      return a.points.map((p, j) => [lerp(p[0], b.points[j][0], f), lerp(p[1], b.points[j][1], f)] as LonLat);
    }
    a = b;
  }
  return a.points;
}

const visible = (o: { appear?: number; disappear?: number }, t: number) =>
  (o.appear === undefined || t >= o.appear) && (o.disappear === undefined || t < o.disappear);

export interface ViewOptions {
  /** Blue COP: show enemy only where/when detected (last known position, dashed when stale) */
  fog?: boolean;
  /** minutes of track history to draw (0 = off) */
  trailMin?: number;
}

export class Simulation {
  constructor(public scenario: Scenario) {
    for (const u of scenario.units) u.track.sort((a, b) => a.t - b.t);
    scenario.camera?.sort((a, b) => a.t - b.t);
    scenario.events?.sort((a, b) => a.t - b.t);
  }

  stateAt(t: number, opts: ViewOptions = {}): SimState {
    const sc = this.scenario;
    const events = sc.events ?? [];
    const unitsById = new Map<string, UnitState>();
    const units: UnitState[] = [];
    for (const u of sc.units) {
      if (!visible(u, t)) continue;
      let status: Status = 'present';
      let strength = 1;
      for (const e of events) {
        if (e.t > t) break;
        if (e.type === 'status' && e.unit === u.id) status = e.status;
        if (e.type === 'strength' && e.unit === u.id) strength = e.value;
      }
      const s = sampleTrack(u.track, t);
      const st: UnitState = { unit: u, ...s, status, strength, sidc: sidcWithStatus(u.sidc, status) };
      unitsById.set(u.id, st);
      // fog of war: hostile ground units only appear where Blue has detected them
      if (opts.fog && sideOf(u.sidc) === 'hostile' && !u.air) {
        const seen = u.seen ?? [];
        let last: Waypoint | null = null;
        for (const w of seen) {
          if (w.t > t) break;
          last = w;
        }
        if (!last || t - last.t > 45) continue;
        st.pos = last.pos;
        st.moving = false;
        if (t - last.t > 8) {
          st.stale = true;
          st.status = status === 'destroyed' ? status : 'planned';
          st.sidc = sidcWithStatus(u.sidc, st.status);
        }
      }
      if (opts.trailMin && !st.stale && !u.air) {
        const tr: LonLat[] = [];
        const t0 = Math.max(u.track[0].t, t - opts.trailMin);
        for (let k = t0; k < t; k += 2) tr.push(sampleTrack(u.track, k).pos);
        tr.push(st.pos);
        if (tr.length > 1) st.trail = tr;
      }
      units.push(st);
    }
    const graphics = sc.graphics.filter((g) => visible(g, t)).map((g) => ({ graphic: g, points: interpPoints(g, t) }));
    const fires: FireState[] = [];
    const messages: MessageState[] = [];
    for (const e of events) {
      if (e.t > t) break;
      if (e.type === 'fire' && t >= e.t && t <= e.t + e.duration) {
        const a = unitsById.get(e.from);
        const b = unitsById.get(e.to);
        if (a && b) fires.push({ from: a.pos, to: b.pos, progress: (t - e.t) / e.duration, fromSide: sideOf(a.sidc), kind: e.kind ?? 'direct', seed: (e.t * 7919 + e.from.length * 31) % 1000 });
      }
      if (e.type === 'message' && t >= e.t && t <= e.t + (e.duration ?? 30)) messages.push({ text: e.text, age: t - e.t });
    }
    const camera = interpCamera(sc.camera?.length ? sc.camera : [sc.view], t);
    return { t, units, graphics, fires, messages, camera };
  }
}
