/**
 * Camera director: computes the camera for each frame of playback or recording.
 * Named sequences (see CAMERA_PATHS) plus user keyframes.
 * "Where the action is" = smoothed centroid of engagements (fire events), else of ground units.
 */
import type { CameraKey, LonLat, Scenario } from '../scenario/types';
import { interpCamera, sampleTrack, sideOf } from '../scenario/sim';

export type CameraPath =
  | 'static'
  | 'overwatch'
  | 'eagle'
  | 'commander'
  | 'enemy-eyes'
  | 'pendulum'
  | 'map-zoom'
  | 'orbit'
  | 'flyover'
  | 'follow'
  | 'cinematic'
  | 'keyframes';

export interface CameraPathInfo {
  id: CameraPath;
  name: string;
  /** the sequence of moves, shown on mouse-over */
  description: string;
  /** needs the 3D (terrain) view to look right */
  needs3d: boolean;
}

export const CAMERA_PATHS: CameraPathInfo[] = [
  { id: 'static', name: 'Fixed Camera', needs3d: false, description: 'No movement. The camera stays exactly where you framed it.' },
  {
    id: 'overwatch',
    name: 'Overwatch Orbit',
    needs3d: true,
    description: 'Start straight overhead (2D map view) → tilt smoothly to 45° → then circle slowly and continuously around the battlefield (one full turn over the clip), centered on the fighting.',
  },
  {
    id: 'eagle',
    name: 'Eagle Descent',
    needs3d: true,
    description: 'Start high above the AO looking straight down → descend toward the main engagement while tilting to 60° → finish with a slow drift around the fight.',
  },
  {
    id: 'commander',
    name: "Commander's View",
    needs3d: true,
    description: 'Low oblique (65°) from behind the friendly lines, looking down the axis of attack → the camera advances with the friendly front and sways gently from side to side.',
  },
  {
    id: 'enemy-eyes',
    name: 'Enemy Eyes',
    needs3d: true,
    description: 'Low oblique (65°) from behind the enemy lines, looking toward the attacker → slowly pans across the front as the attack develops.',
  },
  {
    id: 'pendulum',
    name: 'Pendulum Sweep',
    needs3d: true,
    description: 'Tilted 50°, centered on the fighting → the view swings slowly left and right (±50°) like a surveillance camera, two full sweeps over the clip.',
  },
  {
    id: 'map-zoom',
    name: 'Map Zoom (2D)',
    needs3d: false,
    description: 'Stays straight overhead, north up → slow zoom in on the main engagement → hold → slow zoom back out to the whole AO.',
  },
  { id: 'orbit', name: 'Tight Orbit', needs3d: true, description: 'Tilted 62°, close in over the fighting → orbits 200° around it over the clip.' },
  {
    id: 'flyover',
    name: 'Axis Flyover',
    needs3d: true,
    description: 'Low 70° pass flying along the axis of attack, from behind the friendly start line to beyond the objectives, with a slight bank.',
  },
  { id: 'follow', name: 'Main Effort Chase', needs3d: true, description: 'Chase camera at 60° tilt that follows the friendly maneuver force, biased toward the fighting.' },
  {
    id: 'cinematic',
    name: 'Cinematic Arc',
    needs3d: true,
    description: 'Wide overview at 30° → push in to the fight with a rotating close-up at 68° → pull back to an overview to reveal the outcome.',
  },
  { id: 'keyframes', name: 'My Keyframes / Captured Flight', needs3d: false, description: 'Plays back the keyframes you added or the flight you captured with ✈ Fly & capture.' },
];

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const ease = (f: number) => f * f * (3 - 2 * f);
const clamp01 = (f: number) => Math.max(0, Math.min(1, f));
/** segment progress: 0 before a, 1 after b */
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
/** rotation angle with a smooth start: R degrees per unit p after ramping up over r */
const ramped = (p: number, p0: number, r: number, R: number) => {
  if (p <= p0) return 0;
  const x = p - p0;
  return x < r ? (R * x * x) / (2 * r) : R * (r / 2 + (x - r));
};
const mix = (a: LonLat, b: LonLat, f: number): LonLat => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];

export class CameraDirector {
  private step = 2;
  private action: LonLat[] = [];
  private blue: LonLat[] = [];

  constructor(private sc: Scenario) {
    const T = sc.meta.durationMin;
    const ground = sc.units.filter((u) => !u.air);
    const byId = new Map(sc.units.map((u) => [u.id, u]));
    const fires = (sc.events ?? []).filter((e) => e.type === 'fire') as { t: number; from: string; to: string }[];
    const rawA: (LonLat | null)[] = [];
    const rawB: (LonLat | null)[] = [];
    for (let t = 0; t <= T; t += this.step) {
      // engagement centroid in a ±10 min window
      let sx = 0, sy = 0, n = 0;
      for (const f of fires) {
        if (f.t < t - 10 || f.t > t + 10) continue;
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        if (!a || !b || a.air || b.air) continue;
        const pa = sampleTrack(a.track, f.t).pos;
        const pb = sampleTrack(b.track, f.t).pos;
        sx += (pa[0] + pb[0]) / 2;
        sy += (pa[1] + pb[1]) / 2;
        n++;
      }
      // friendly maneuver centroid
      let bx = 0, by = 0, bn = 0;
      for (const u of ground) {
        if (sideOf(u.sidc) !== 'friend' || (u.disappear !== undefined && t >= u.disappear)) continue;
        const p = sampleTrack(u.track, t).pos;
        bx += p[0];
        by += p[1];
        bn++;
      }
      rawB.push(bn ? [bx / bn, by / bn] : null);
      rawA.push(n >= 3 ? [sx / n, sy / n] : null);
    }
    const fillSmooth = (raw: (LonLat | null)[], fallback: LonLat[]) => {
      const filled = raw.map((p, i) => p ?? fallback[i] ?? sc.view.center);
      const out: LonLat[] = [];
      const W = 6;
      for (let i = 0; i < filled.length; i++) {
        let x = 0, y = 0, k = 0;
        for (let j = Math.max(0, i - W); j <= Math.min(filled.length - 1, i + W); j++) {
          x += filled[j][0];
          y += filled[j][1];
          k++;
        }
        out.push([x / k, y / k]);
      }
      return out;
    };
    this.blue = fillSmooth(rawB, []);
    this.action = fillSmooth(rawA, this.blue);
  }

  private at(arr: LonLat[], t: number): LonLat {
    const f = t / this.step;
    const i = Math.max(0, Math.min(arr.length - 1, Math.floor(f)));
    const j = Math.min(arr.length - 1, i + 1);
    const k = f - i;
    return [lerp(arr[i][0], arr[j][0], k), lerp(arr[i][1], arr[j][1], k)];
  }

  /**
   * @param p progress 0..1 through the clip, t sim time (min), base = view when the clip started
   */
  camera(path: CameraPath, p: number, t: number, base: CameraKey, mode: '2d' | '3d'): CameraKey {
    const axis = this.sc.meta.axis ?? 0;
    const is3d = mode === '3d';
    const pitch = (x: number) => (is3d ? x : 0);
    switch (path) {
      case 'static':
        return base;
      case 'keyframes':
        return this.sc.camera?.length ? interpCamera(this.sc.camera, t) : base;
      case 'overwatch': {
        // overhead → tilt to 45° → continuous slow orbit
        const act = this.at(this.action, t);
        const center = mix(base.center, act, 0.5 * ease(seg(p, 0, 0.35)));
        const tilt = ease(seg(p, 0.1, 0.3));
        const spin = ramped(p, 0.22, 0.12, 360 / 0.84);
        return { t, center, zoom: base.zoom + 0.25 * tilt, bearing: (base.bearing ?? 0) + spin, pitch: pitch(45 * tilt) };
      }
      case 'eagle': {
        const act = this.at(this.action, t);
        const d = ease(seg(p, 0.05, 0.6));
        const drift = ramped(p, 0.5, 0.15, 80);
        return {
          t,
          center: mix(base.center, act, d),
          zoom: lerp(base.zoom - 0.6, base.zoom + 1.2, d),
          bearing: (base.bearing ?? 0) + lerp(0, axis - (base.bearing ?? 0) - 20, d) + drift,
          pitch: pitch(60 * ease(seg(p, 0.15, 0.6))),
        };
      }
      case 'commander':
      case 'enemy-eyes': {
        const red = path === 'enemy-eyes';
        const look = red ? axis + 180 : axis;
        const front = this.at(red ? this.action : this.blue, t);
        const act = this.at(this.action, t);
        const c = mix(front, act, red ? 0.6 : 0.45);
        // stand back from the focus point, behind the observer's own lines
        const back = 0.035 * Math.pow(2, 12 - base.zoom);
        const rad = (look * Math.PI) / 180;
        const cosLat = Math.cos((c[1] * Math.PI) / 180);
        const center: LonLat = [c[0] - (Math.sin(rad) * back) / cosLat, c[1] - Math.cos(rad) * back];
        const sway = red ? lerp(-25, 25, ease(p)) : 12 * Math.sin(p * Math.PI * 2);
        return { t, center, zoom: base.zoom + 0.9, bearing: is3d ? look + sway : 0, pitch: pitch(65) };
      }
      case 'pendulum': {
        const act = this.at(this.action, t);
        const intro = ease(seg(p, 0, 0.12));
        return {
          t,
          center: mix(base.center, act, 0.7 * intro),
          zoom: base.zoom + 0.5 * intro,
          bearing: axis + 50 * Math.sin(p * Math.PI * 4) * intro,
          pitch: pitch(50 * intro),
        };
      }
      case 'map-zoom': {
        const act = this.at(this.action, t);
        const zin = ease(seg(p, 0.05, 0.4));
        const zout = ease(seg(p, 0.7, 0.98));
        const f = zin * (1 - zout);
        return { t, center: mix(base.center, act, f), zoom: base.zoom + 1.4 * f, bearing: 0, pitch: 0 };
      }
      case 'orbit': {
        const c = this.at(this.action, t);
        const center: LonLat = [lerp(base.center[0], c[0], 0.6), lerp(base.center[1], c[1], 0.6)];
        return { t, center, zoom: base.zoom + (is3d ? 0.4 : 0), bearing: (base.bearing ?? 0) + (is3d ? 200 : 40) * ease(p), pitch: pitch(62) };
      }
      case 'flyover': {
        // from behind the friendly start line to beyond the objectives, looking down the axis
        const rad = (axis * Math.PI) / 180;
        const span = 0.06 * Math.pow(2, 12.5 - base.zoom); // degrees, scales with AO size
        const cosLat = Math.cos((base.center[1] * Math.PI) / 180);
        const off = (k: number): LonLat => [base.center[0] + (Math.sin(rad) * span * k) / cosLat, base.center[1] + Math.cos(rad) * span * k];
        const a = off(-1.1);
        const b = off(0.9);
        const f = ease(p);
        return { t, center: [lerp(a[0], b[0], f), lerp(a[1], b[1], f)], zoom: base.zoom + (is3d ? 1.0 : 0.6), bearing: is3d ? axis + 15 * Math.sin(p * Math.PI) : 0, pitch: pitch(70) };
      }
      case 'follow': {
        const c = this.at(this.blue, t);
        const a = this.at(this.action, t);
        return { t, center: [lerp(c[0], a[0], 0.35), lerp(c[1], a[1], 0.35)], zoom: base.zoom + 0.8, bearing: is3d ? axis + 25 * Math.sin(p * Math.PI * 1.5) : 0, pitch: pitch(60) };
      }
      case 'cinematic': {
        const act = this.at(this.action, t);
        if (p < 0.15) {
          const f = ease(p / 0.15);
          return {
            t,
            center: [lerp(base.center[0], act[0], f * 0.5), lerp(base.center[1], act[1], f * 0.5)],
            zoom: lerp(base.zoom - 0.4, base.zoom + 0.3, f),
            bearing: is3d ? lerp(axis - 40, axis - 10, f) : 0,
            pitch: pitch(lerp(30, 55, f)),
          };
        }
        if (p < 0.72) {
          const f = clamp01((p - 0.15) / 0.57);
          const mid: LonLat = [lerp(base.center[0], act[0], 0.5), lerp(base.center[1], act[1], 0.5)];
          const g = ease(clamp01(f * 3));
          return {
            t,
            center: [lerp(mid[0], act[0], g), lerp(mid[1], act[1], g)],
            zoom: lerp(base.zoom + 0.3, base.zoom + 1.1, g),
            bearing: is3d ? axis - 10 + 70 * f : 0,
            pitch: pitch(lerp(55, 68, g)),
          };
        }
        const f = ease(clamp01((p - 0.72) / 0.28));
        return {
          t,
          center: [lerp(act[0], base.center[0], f), lerp(act[1], base.center[1], f)],
          zoom: lerp(base.zoom + 1.1, base.zoom - 0.2, f),
          bearing: is3d ? axis + 60 + 30 * f : 0,
          pitch: pitch(lerp(68, 45, f)),
        };
      }
    }
  }
}
