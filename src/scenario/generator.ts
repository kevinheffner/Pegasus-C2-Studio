/**
 * Procedural scenario generator with a doctrine-based engagement model.
 *
 * Realism features:
 *  - Phased operations: assembly area → tactical road march → attack position → synchronized
 *    H-hour at the LD (after artillery preparation) → deployment off-road into combat formation →
 *    fire and movement in contact → consolidation on the objective.
 *  - Recon leads and screens; main bodies follow. Meeting engagements: march columns deploy on
 *    first contact.
 *  - Defense in depth: security zone (recon) falls back, prepared battle positions, a reserve that
 *    counterattacks a penetration, artillery in depth.
 *  - Strength-based Lanchester-style attrition: losses depend on firer strength, weapon range,
 *    target posture (march column ≫ deployed > hasty defense ≫ prepared positions),
 *    suppression by artillery and concealment of prepared positions (detected only at short range).
 *  - Breakpoints: units stall at ~55 %, become combat-ineffective and pull back at ~35 %, are
 *    destroyed only below ~15 %. Attacks culminate when the force is worn down; defenders break.
 *  - Artillery: preparation fires, close support on detected targets, counter-battery fire.
 *  - Sensors: units, recon, UAVs and helicopters detect enemies within sensor range → sightings
 *    used for fog of war (Blue COP view) and for target acquisition.
 */
import { BattleFrame, along, distM, extentKm, lineLengthM, rng, toMgrs, type Rng } from '../geo/geo';
import { loadNetwork, route, type Network } from '../geo/roads';
import {
  DEFAULT_PARAMS,
  ENTITY,
  FORCES,
  OBJ_NAMES,
  PL_NAMES,
  POWER,
  RANGE,
  RED_PL_NAMES,
  SENSOR,
  SPEED,
  TEMPLATES,
  type AirOption,
  type BattleParams,
  type ForcePackage,
  type Kind,
  type Role,
} from './catalog';
import type { Graphic, LonLat, Scenario, ScenarioEvent, Unit, Waypoint } from './types';

export interface GenOptions {
  center: LonLat;
  zoom: number;
  axis: number;
  template: string;
  blue: string;
  red: string;
  air: AirOption;
  movement: 'roads' | 'cross-country';
  riverine: boolean;
  seed: number;
  viewPx?: [number, number];
  /** forces are laid out for (zoom + layoutMargin) so they stay in the middle of the frame */
  layoutMargin?: number;
  params?: Partial<BattleParams>;
  onProgress?: (msg: string) => void;
}

type Side = 'blue' | 'red';
type AirKind = 'fighter' | 'strike' | 'helo' | 'uav' | 'boat';
type Posture = 'assembly' | 'march' | 'deployed' | 'assault' | 'hasty' | 'prepared' | 'withdraw' | 'consolidate';

interface Element {
  kind: Kind;
  echelon: string;
  hq: boolean;
  T: string;
  M: string;
  maneuver: boolean;
}

interface Actor {
  id: string;
  side: Side;
  kind: Kind;
  role: Role;
  sidc: string;
  T: string;
  M: string;
  pos: LonLat;
  path: LonLat[] | null;
  pathLen: number;
  s: number;
  moving: boolean;
  str: number;
  posture: Posture;
  phase: string;
  lane: number;
  maneuver: boolean;
  reserve: boolean;
  /** waypoints of the plan */
  ap?: LonLat;
  obj?: LonLat;
  objName?: string;
  rear: LonLat;
  aa: LonLat;
  delaySteps?: LonLat[];
  delayIdx: number;
  engagedSince: number;
  suppressedUntil: number;
  lastFire: number;
  reportedStr: number;
  status: 'present' | 'damaged' | 'destroyed';
  dead: boolean;
  gone: boolean;
  disappear?: number;
  track: Waypoint[];
  seen: Waypoint[];
  lastSeen: number;
  /** training/readiness factor */
  quality: number;
}

interface AirActor {
  id: string;
  side: Side;
  kind: AirKind;
  sidc: string;
  T: string;
  track: Waypoint[];
  appear?: number;
  disappear?: number;
  lastFire: number;
  seen: Waypoint[];
}

const ECH = { company: '15', battalion: '16', brigade: '18', division: '21' };
const VULN: Record<Posture, number> = { assembly: 1.3, march: 1.7, deployed: 1.0, assault: 1.1, hasty: 0.6, prepared: 0.33, withdraw: 1.3, consolidate: 0.7 };
const SPEED_F: Record<Posture, number> = { assembly: 0, march: 1.8, deployed: 0.9, assault: 0.7, hasty: 0, prepared: 0, withdraw: 1.6, consolidate: 0 };

function unitSidc(side: Side, kind: Kind, echelon: string, hq: boolean) {
  return `100${side === 'blue' ? '3' : '6'}100${hq ? '2' : '0'}${echelon}${ENTITY[kind]}0000`;
}
function airSidc(side: Side, kind: AirKind) {
  const a = side === 'blue' ? '3' : '6';
  const ent = { fighter: '01110104', strike: '01110102', helo: '01110200', uav: '01110300', boat: '30120500' }[kind];
  return `100${a}${ent.slice(0, 2)}0000${ent.slice(2)}0000`;
}
function cmSidc(side: Side, entity: string, echelon = '00') {
  return `100${side === 'blue' ? '3' : '6'}2500${echelon}${entity}0000`;
}

function expand(pkg: ForcePackage, zoom: number, side: Side): Element[] {
  const maneuverKinds: Kind[] = ['armor', 'mech', 'motor', 'inf', 'recon'];
  const isMan = (k: Kind) => maneuverKinds.includes(k);
  const main = pkg.battalions.find((k) => k !== 'recon' && isMan(k)) ?? 'mech';
  const out: Element[] = [];
  if (zoom < 11.5) {
    const div = side === 'blue' ? '1 AD' : '10 TD';
    const manKinds = pkg.battalions.filter((k) => isMan(k) && k !== 'recon').slice(0, 3);
    while (manKinds.length < 3) manKinds.push(main);
    manKinds.push(main);
    manKinds.forEach((k, i) => out.push({ kind: k, echelon: ECH.brigade, hq: false, T: `${i + 1}`, M: div, maneuver: true }));
    out.push({ kind: 'recon', echelon: ECH.battalion, hq: false, T: '1', M: div, maneuver: true });
    out.push({ kind: 'arty', echelon: ECH.brigade, hq: false, T: 'DIVARTY', M: div, maneuver: false });
    out.push({ kind: main, echelon: ECH.division, hq: true, T: div, M: '', maneuver: false });
    return out;
  }
  if (zoom < 13.7) {
    let n = 1;
    for (const k of pkg.battalions) {
      const T = side === 'blue' ? `${n}-${10 + n * 2}` : `${n}`;
      out.push({ kind: k, echelon: ECH.battalion, hq: false, T, M: pkg.hqName, maneuver: isMan(k) });
      n++;
    }
    out.push({ kind: main, echelon: ECH.brigade, hq: true, T: pkg.hqName, M: '', maneuver: false });
    return out;
  }
  const bns = pkg.battalions.filter((k) => isMan(k) && k !== 'recon').slice(0, 2);
  bns.forEach((k, b) => {
    const bn = side === 'blue' ? `${b + 1}-${12 + b * 2}` : `${b + 1}`;
    ['A', 'B', 'C'].forEach((c) => out.push({ kind: k, echelon: ECH.company, hq: false, T: c, M: bn, maneuver: true }));
    out.push({ kind: k, echelon: ECH.battalion, hq: true, T: bn, M: pkg.hqName, maneuver: false });
  });
  if (pkg.battalions.includes('recon')) out.push({ kind: 'recon', echelon: ECH.company, hq: false, T: 'D', M: 'CAV', maneuver: true });
  if (pkg.battalions.includes('arty')) out.push({ kind: 'arty', echelon: ECH.company, hq: false, T: 'A', M: 'FA', maneuver: false });
  return out;
}

function lateralLine(frame: BattleFrame, u: number, F: number, r: Rng, n = 7, amp = 0.25): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i < n; i++) pts.push(frame.toLL(u + r.range(-amp, amp), -F + (2 * F * i) / (n - 1)));
  return pts;
}

function circle(frame: BattleFrame, u: number, v: number, rKm: number, r: Rng, n = 9): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = rKm * r.range(0.8, 1.12);
    pts.push(frame.toLL(u + rr * Math.cos(a), v + rr * Math.sin(a) * 1.3));
  }
  return pts;
}

function resample(path: LonLat[], n: number): LonLat[] {
  const L = lineLengthM(path);
  return Array.from({ length: n }, (_, i) => along(path, (L * i) / (n - 1)));
}

function trackPos(tr: Waypoint[], t: number): LonLat {
  if (t <= tr[0].t) return tr[0].pos;
  for (let i = 1; i < tr.length; i++) {
    if (tr[i].t >= t) {
      const a = tr[i - 1];
      const b = tr[i];
      const f = (t - a.t) / (b.t - a.t || 1);
      return [a.pos[0] + (b.pos[0] - a.pos[0]) * f, a.pos[1] + (b.pos[1] - a.pos[1]) * f];
    }
  }
  return tr[tr.length - 1].pos;
}

export async function generate(o: GenOptions): Promise<Scenario> {
  const P: BattleParams = { ...DEFAULT_PARAMS, ...(o.params ?? {}) };
  const r = rng(o.seed);
  const tpl = TEMPLATES.find((t) => t.id === o.template) ?? TEMPLATES[0];
  const bluePkg = FORCES.find((f) => f.id === o.blue) ?? FORCES[0];
  const redPkg = FORCES.find((f) => f.id === o.red) ?? FORCES.find((f) => f.side === 'red')!;
  const layoutZoom = o.zoom + (o.layoutMargin ?? 0.6);
  const ext = extentKm(o.center[1], layoutZoom, o.viewPx?.[0] ?? 1920, o.viewPx?.[1] ?? 1080);
  const frame = new BattleFrame(o.center, o.axis);
  const b = (o.axis * Math.PI) / 180;
  const halfAlong = Math.min(ext.width / 2 / Math.max(1e-6, Math.abs(Math.sin(b))), ext.height / 2 / Math.max(1e-6, Math.abs(Math.cos(b))));
  const halfAcross = Math.min(ext.width / 2 / Math.max(1e-6, Math.abs(Math.cos(b))), ext.height / 2 / Math.max(1e-6, Math.abs(Math.sin(b))));
  const D = halfAlong * 0.88;
  const F = halfAcross * 0.8;
  const T = P.durationMin > 0 ? P.durationMin : tpl.durationMin;
  // time scaling: engagement distances shrink with zoom, so slow things down for small AOs
  const kmScale = Math.max(0.35, Math.min(2.5, D / 9));
  const rngScale = Math.max(0.45, Math.min(2.2, kmScale)); // weapon/sensor ranges scale gently with echelon

  // ---------- networks ----------
  const viewExt = extentKm(o.center[1], o.zoom, o.viewPx?.[0] ?? 1920, o.viewPx?.[1] ?? 1080);
  const degLat = (Math.max(ext.height, viewExt.height * 0.8) * 0.65) / 111.32;
  const degLon = (Math.max(ext.width, viewExt.width * 0.8) * 0.65) / (111.32 * Math.cos((o.center[1] * Math.PI) / 180));
  const bbox = { s: o.center[1] - degLat, n: o.center[1] + degLat, w: o.center[0] - degLon, e: o.center[0] + degLon };
  let roads: Network | null = null;
  let rivers: Network | null = null;
  if (o.movement === 'roads') {
    o.onProgress?.('Loading road network (OpenStreetMap)…');
    roads = await loadNetwork('roads', bbox);
    if (!roads) o.onProgress?.('Road network unavailable – using cross-country movement');
  }
  const has = (x: AirOption) => o.air === x || o.air === 'all';
  if (o.riverine || has('helo')) rivers = await loadNetwork('rivers', bbox);
  o.onProgress?.('Planning and simulating the engagement…');

  const sign = (side: Side) => (side === 'blue' ? 1 : -1);
  const uOf = (side: Side, d: number) => sign(side) * d * D;
  const pt = (side: Side, d: number, v: number): LonLat => frame.toLL(uOf(side, d), v);
  /** side-local depth of a position (−1 own rear … +1 enemy rear) */
  const depth = (side: Side, p: LonLat) => (frame.toUV(p)[0] * sign(side)) / D;

  const roadPath = (from: LonLat, to: LonLat): LonLat[] => {
    if (roads) {
      const p = route(roads, from, to);
      // reject big detours (e.g. no road in the right direction): go cross-country instead
      if (p && p.length > 1 && lineLengthM(p) < distM(from, to) * 1.9 + 1500 * kmScale) return p;
    }
    return xcPath(from, to);
  };
  /** cross-country path: gentle irregular line (formations use terrain, not roads) */
  const xcPath = (from: LonLat, to: LonLat): LonLat[] => {
    const [u0, v0] = frame.toUV(from);
    const [u1, v1] = frame.toUV(to);
    const n = 4;
    const pts: LonLat[] = [from];
    for (let i = 1; i < n; i++) {
      const f = i / n;
      pts.push(frame.toLL(u0 + (u1 - u0) * f + r.range(-0.15, 0.15) * kmScale, v0 + (v1 - v0) * f + r.range(-0.35, 0.35) * kmScale));
    }
    pts.push(to);
    return pts;
  };

  // ---------- force layout ----------
  const actors: Actor[] = [];
  const lanesOf = (n: number) => Array.from({ length: n }, (_, i) => -F * 0.8 + (2 * F * 0.8 * (i + 0.5)) / n);
  let seq = 0;
  const sideRole = (side: Side) => (side === 'blue' ? tpl.blue : tpl.red);
  const defendBPs: Record<Side, { p: LonLat; name: string }[]> = { blue: [], red: [] };

  for (const side of ['blue', 'red'] as Side[]) {
    const pkg = side === 'blue' ? bluePkg : redPkg;
    const role = sideRole(side);
    const els = expand(pkg, layoutZoom, side);
    let man = els.filter((e) => e.maneuver && e.kind !== 'recon');
    // defender holds back one maneuver unit (prefer armor) as reserve
    let reserveEl: Element | null = null;
    if ((role === 'defend') && P.counterattack && man.length >= 3) {
      reserveEl = man.find((e) => e.kind === 'armor') ?? man[man.length - 1];
      man = man.filter((e) => e !== reserveEl);
    }
    const lanes = lanesOf(man.length);
    let li = 0;
    for (const e of els) {
      const recon = e.kind === 'recon';
      const isLine = e.maneuver && !recon && e !== reserveEl;
      const v0 = isLine ? lanes[li++] * sign(side) : recon ? r.range(-F * 0.2, F * 0.2) : r.range(-F * 0.3, F * 0.3);
      const jitter = () => r.range(-0.25, 0.25) * kmScale;
      let startD: number;
      let posture: Posture = 'assembly';
      let phase = 'assembly';
      switch (role) {
        case 'attack':
          startD = isLine || recon ? -0.93 : e.kind === 'arty' ? -0.97 : -0.95;
          break;
        case 'advance':
          startD = recon ? -0.85 : isLine ? -0.95 : -0.98;
          break;
        case 'defend':
          startD = recon ? -0.02 : isLine ? -0.3 : e === reserveEl ? -0.62 : e.kind === 'arty' ? -0.78 : e.kind === 'ad' ? -0.5 : -0.7;
          posture = recon ? 'hasty' : isLine ? 'prepared' : 'hasty';
          phase = recon ? 'screen' : isLine ? 'defend' : e === reserveEl ? 'reserve' : 'support';
          break;
        case 'delay':
          startD = recon ? 0.15 : isLine ? 0.02 : e.kind === 'arty' ? -0.6 : -0.65;
          posture = 'hasty';
          phase = isLine || recon ? 'delay' : 'support';
          break;
        case 'withdraw':
          startD = recon ? -0.05 : isLine ? -0.15 : -0.55;
          posture = 'hasty';
          phase = 'hold';
          break;
      }
      const start = pt(side, startD!, v0 + jitter());
      const a: Actor = {
        id: `${side[0]}-${++seq}`,
        side,
        kind: e.kind,
        role,
        sidc: unitSidc(side, e.kind, e.echelon, e.hq),
        T: e.T,
        M: e.M,
        pos: start,
        path: null,
        pathLen: 0,
        s: 0,
        moving: false,
        str: 1,
        posture,
        phase,
        lane: v0,
        maneuver: e.maneuver,
        reserve: e === reserveEl,
        rear: pt(side, -1.12, v0 * 0.6 + jitter()),
        aa: start,
        delayIdx: 0,
        engagedSince: -1,
        suppressedUntil: -1,
        lastFire: -99,
        reportedStr: 1,
        quality: r.range(0.85, 1.15),
        status: 'present',
        dead: false,
        gone: false,
        track: [{ t: 0, pos: start }],
        seen: [],
        lastSeen: -999,
      };
      if (role === 'defend' && isLine) defendBPs[side].push({ p: start, name: '' });
      if (role === 'delay' && (isLine || recon)) a.delaySteps = [-0.3, -0.6, -0.9].map((d) => pt(side, d, v0 + jitter()));
      actors.push(a);
    }
  }
  // objectives for attackers = enemy battle positions (deliberate attack) or terrain objectives
  for (const side of ['blue', 'red'] as Side[]) {
    const role = sideRole(side);
    if (role !== 'attack' && role !== 'advance') continue;
    const enemy: Side = side === 'blue' ? 'red' : 'blue';
    const bps = defendBPs[enemy];
    bps.forEach((bp, i) => (bp.name = OBJ_NAMES[i % OBJ_NAMES.length]));
    for (const a of actors.filter((x) => x.side === side)) {
      const goalD = role === 'advance' ? 0.25 : sideRole(enemy) === 'withdraw' ? 0.85 : 0.45;
      if (a.maneuver && a.kind !== 'recon') {
        if (bps.length && role === 'attack') {
          // nearest enemy BP across the frontage → objective
          const [, av] = frame.toUV(a.pos);
          let best = bps[0];
          for (const bp of bps) if (Math.abs(frame.toUV(bp.p)[1] - av) < Math.abs(frame.toUV(best.p)[1] - av)) best = bp;
          const [bu, bv] = frame.toUV(best.p);
          a.obj = frame.toLL(bu + sign(side) * 0.3 * kmScale, bv + r.range(-0.3, 0.3) * kmScale);
          a.objName = best.name;
        } else a.obj = pt(side, goalD, a.lane + r.range(-0.3, 0.3) * kmScale);
        a.ap = pt(side, role === 'advance' ? -0.5 : -0.62, a.lane + r.range(-0.2, 0.2) * kmScale);
      } else if (a.kind === 'recon') {
        a.obj = pt(side, role === 'advance' ? 0.1 : -0.12, a.lane);
        a.ap = pt(side, -0.6, a.lane);
      } else {
        // support: arty to firing positions, HQ/eng/AD follow
        a.obj = pt(side, a.kind === 'arty' ? -0.78 : a.kind === 'eng' ? -0.45 : -0.68, a.lane * 0.5);
      }
    }
  }

  // ---------- air & riverine ----------
  const events: ScenarioEvent[] = [];
  const air: AirActor[] = [];
  const mkAir = (side: Side, kind: AirKind, T: string, track: Waypoint[], appear?: number, disappear?: number) => {
    const a: AirActor = { id: `${side[0]}-air-${++seq}`, side, kind, sidc: airSidc(side, kind), T, track, appear, disappear, lastFire: -99, seen: [] };
    air.push(a);
    return a;
  };
  const orbit = (cu: number, cv: number, len: number, rad: number, kph: number, phase: number, t0: number, t1: number, ellipse = false): Waypoint[] => {
    const per = ellipse ? 2 * Math.PI * rad : 2 * len + 2 * Math.PI * rad;
    const out: Waypoint[] = [];
    for (let t = t0; t <= t1; t += 1 / 6) {
      let s = (((t - t0) / 60) * kph + phase * per) % per;
      let u: number;
      let v: number;
      if (ellipse) {
        const a = s / rad;
        u = cu + rad * Math.cos(a);
        v = cv + rad * Math.sin(a);
      } else if (s < len) {
        u = cu + rad;
        v = cv - len / 2 + s;
      } else if ((s -= len) < Math.PI * rad) {
        const a = s / rad;
        u = cu + rad * Math.cos(a);
        v = cv + len / 2 + rad * Math.sin(a);
      } else if ((s -= Math.PI * rad) < len) {
        u = cu - rad;
        v = cv + len / 2 - s;
      } else {
        s -= len;
        const a = Math.PI + s / rad;
        u = cu + rad * Math.cos(a);
        v = cv - len / 2 + rad * Math.sin(a);
      }
      out.push({ t, pos: frame.toLL(u, v) });
    }
    return out;
  };
  if (has('cap')) {
    for (const side of ['blue', 'red'] as Side[]) {
      for (let i = 0; i < 2; i++) mkAir(side, 'fighter', side === 'blue' ? `VIPER ${i + 1}` : `FLANKER ${i + 1}`, orbit(-0.72 * D * sign(side), 0, F * 1.1, Math.max(1.5, 3 * kmScale), 650, i * 0.5, 0, T));
    }
  }
  if (has('uav')) {
    mkAir('blue', 'uav', 'REAPER 1', orbit(0.4 * D, r.range(-F / 3, F / 3), 0, Math.max(1, 3 * kmScale), 160, 0, 0, T, true));
    mkAir('red', 'uav', 'ORLAN 1', orbit(-0.4 * D, r.range(-F / 3, F / 3), 0, Math.max(1, 2.5 * kmScale), 120, 0.3, 0, T, true));
  }
  let riverLine: LonLat[] | null = null;
  if (rivers && rivers.lines.length) {
    riverLine = rivers.lines.reduce((best, l) => (lineLengthM(l) > lineLengthM(best) ? l : best), rivers.lines[0]);
    if (lineLengthM(riverLine) < 3000) riverLine = null;
  }
  if (o.riverine && riverLine) {
    const L = lineLengthM(riverLine);
    for (let i = 0; i < 2; i++) {
      const tr: Waypoint[] = [];
      const a0 = L * (0.2 + 0.05 * i);
      const a1 = L * 0.8;
      const leg = ((a1 - a0) / 1000 / 22) * 60;
      for (let t = 0; t <= T; t += 0.5) {
        const ph = ((t + i * 6) % (2 * leg)) / leg;
        tr.push({ t, pos: along(riverLine, ph < 1 ? a0 + (a1 - a0) * ph : a1 - (a1 - a0) * (ph - 1)) });
      }
      mkAir('blue', 'boat', `PB ${i + 1}`, tr);
    }
  }

  // ---------- engagement simulation ----------
  const msg = (t: number, text: string) => events.push({ t, type: 'message', text, duration: 25 });
  const name = (a: Actor) => `${a.T}${a.M ? '/' + a.M : ''}`;
  const alive = (a: Actor) => !a.dead && !a.gone;
  const enemies = (side: Side) => actors.filter((e) => e.side !== side && alive(e));
  const flags = new Set<string>();
  const once = (k: string) => (flags.has(k) ? false : (flags.add(k), true));
  const H: Record<Side, number> = { blue: -1, red: -1 };
  const prepStart: Record<Side, number> = { blue: -1, red: -1 };
  const deployed: Record<Side, boolean> = { blue: false, red: false };
  const culminated: Record<Side, boolean> = { blue: false, red: false };
  const fortDepthBlue = 0.18; // red fortified line (blue-local depth)
  let penetration: LonLat | null = null;
  const strikeAt = has('strike') ? T * r.range(0.3, 0.45) : -1;
  const heloAt = has('helo') ? T * r.range(0.3, 0.42) : -1;
  let helos: AirActor[] = [];
  const plDepths = [-0.35, 0, 0.35];
  const isAttacker = (s: Side) => sideRole(s) === 'attack' || sideRole(s) === 'advance';

  const setPath = (a: Actor, path: LonLat[], posture: Posture, phase: string) => {
    a.path = path;
    a.pathLen = lineLengthM(path) / 1000;
    a.s = 0;
    a.posture = posture;
    a.phase = phase;
  };
  const speedOf = (a: Actor, inContact: boolean) => {
    let v = SPEED[a.kind] * SPEED_F[a.posture] * P.tempo * kmScale;
    if (inContact && a.posture !== 'withdraw' && a.posture !== 'march') v *= 0.3;
    if (a.status === 'damaged') v *= 0.8;
    return v;
  };
  const known = (target: Actor | AirActor, t: number) => target.seen.length > 0 && t - target.seen[target.seen.length - 1].t <= 15;
  const fire = (t: number, from: { id: string; lastFire: number }, to: Actor, loss: number, kind: 'direct' | 'indirect' | 'air', dur = 1.4, show = true) => {
    if (show) events.push({ t, type: 'fire', from: from.id, to: to.id, duration: dur, kind });
    to.str = Math.max(0, to.str - loss);
    from.lastFire = t;
  };
  const sideStrength = (side: Side) => {
    const m = actors.filter((a) => a.side === side && a.maneuver);
    return m.reduce((s, a) => s + (a.dead ? 0 : a.str), 0) / Math.max(1, m.length);
  };
  const record = (a: Actor, t: number) => {
    const last = a.track[a.track.length - 1];
    if (last.pos[0] === a.pos[0] && last.pos[1] === a.pos[1]) return;
    if (t - last.t > 1.5) a.track.push({ t: t - 1, pos: last.pos });
    a.track.push({ t, pos: a.pos });
  };

  for (let t = 0; t <= T; t += 1) {
    // ===== sensing (every 2 min) =====
    if (t % 2 === 0) {
      for (const tgt of actors) {
        if (!alive(tgt) && !(tgt.dead && t < (tgt.disappear ?? 0))) continue;
        const conceal = tgt.posture === 'prepared' ? 0.45 : tgt.posture === 'hasty' ? 0.75 : tgt.posture === 'march' ? 1.3 : 1;
        let seen = false;
        let byGround = false;
        for (const s of actors) {
          if (s.side === tgt.side || !alive(s)) continue;
          if (distM(s.pos, tgt.pos) / 1000 < SENSOR[s.kind] * rngScale * conceal) {
            seen = byGround = true;
            break;
          }
        }
        if (!seen)
          for (const a of air) {
            if (a.side === tgt.side || (a.kind !== 'uav' && a.kind !== 'helo')) continue;
            if (a.appear !== undefined && (t < a.appear || t > (a.disappear ?? T))) continue;
            if (distM(trackPos(a.track, t), tgt.pos) / 1000 < (a.kind === 'uav' ? 5 : 6) * rngScale * Math.max(conceal, 0.7)) {
              seen = true;
              break;
            }
          }
        if (seen) {
          tgt.seen.push({ t, pos: tgt.pos });
          if (byGround && (tgt.lastSeen < 0 || t - tgt.lastSeen > 30)) {
            if (tgt.side === 'red' && byGround && once('contact-red')) msg(t, `CONTACT: enemy ${tgt.kind === 'armor' ? 'armor' : 'mech'} vic ${toMgrs(tgt.pos[0], tgt.pos[1], 3)}`);
          }
          if (byGround) tgt.lastSeen = t;
        }
      }
    }

    // ===== command decisions =====
    for (const side of ['blue', 'red'] as Side[]) {
      const role = sideRole(side);
      const mine = actors.filter((a) => a.side === side && alive(a));
      // attack: road march to AP → prep → H-hour
      if (role === 'attack' && H[side] < 0) {
        const line = mine.filter((a) => a.maneuver && a.kind !== 'recon');
        const atAP = line.filter((a) => a.phase === 'at-ap').length;
        if (prepStart[side] < 0 && (atAP >= Math.ceil(line.length / 2) || t > T * 0.25)) {
          prepStart[side] = t;
          if (P.prepMinutes > 0) msg(t, `${side === 'blue' ? 'Friendly' : 'Enemy'} artillery preparation begins`);
        }
        if (prepStart[side] >= 0 && t >= prepStart[side] + P.prepMinutes && (atAP === line.length || t > prepStart[side] + P.prepMinutes + 12 || t > T * 0.35)) {
          H[side] = t;
          msg(t, `H-HOUR: ${side === 'blue' ? 'friendly' : 'enemy'} forces cross ${side === 'blue' ? 'LD ' + PL_NAMES[0] : 'their LD'}`);
          for (const a of line.concat(mine.filter((x) => x.kind === 'recon'))) if (a.obj) setPath(a, xcPath(a.pos, a.obj), 'deployed', 'attack');
        }
      }
      // pursuit: no AP halt – attack immediately once the enemy starts withdrawing
      if (role === 'attack' && sideRole(side === 'blue' ? 'red' : 'blue') === 'withdraw' && H[side] < 0 && t >= 12) {
        H[side] = t;
        prepStart[side] = t;
        msg(t, 'Pursuit: friendly forces advance');
        for (const a of mine) if (a.obj && a.maneuver) setPath(a, roadPath(a.pos, a.obj), 'march', 'pursue');
      }
      // advance (meeting engagement): march columns, deploy on first contact
      if (role === 'advance' && !deployed[side]) {
        const contact = enemies(side).some((e) => e.seen.length && t - e.seen[e.seen.length - 1].t <= 2 && mine.some((m) => distM(m.pos, e.pos) / 1000 < 7 * rngScale));
        if (contact && t > 5) {
          deployed[side] = true;
          msg(t, `${side === 'blue' ? 'Friendly' : 'Enemy'} main body deploys from march column (hasty attack)`);
          const foes = enemies(side);
          for (const a of mine.filter((x) => x.maneuver && x.kind !== 'recon')) {
            if (!foes.length) break;
            const tgt = foes.reduce((bst, e) => (distM(a.pos, e.pos) < distM(a.pos, bst.pos) ? e : bst), foes[0]);
            const [tu, tv] = frame.toUV(tgt.pos);
            setPath(a, xcPath(a.pos, frame.toLL(tu, tv + r.range(-0.4, 0.4) * kmScale)), 'deployed', 'hasty-attack');
          }
          for (const a of mine.filter((x) => x.kind === 'recon')) a.posture = 'hasty';
        }
      }
      // culmination
      if (isAttacker(side) && !culminated[side] && (H[side] >= 0 || role === 'advance') && sideStrength(side) < 0.45) {
        culminated[side] = true;
        msg(t, `${side === 'blue' ? 'Friendly' : 'Enemy'} attack culminates – transitioning to hasty defense`);
        for (const a of mine) if (a.maneuver && a.posture !== 'withdraw') (a.path = null), (a.posture = 'hasty'), (a.phase = 'culminated');
      }
      // defender: penetration of the fortified line → reserve counterattacks
      if (role === 'defend' && P.counterattack) {
        const enemy: Side = side === 'blue' ? 'red' : 'blue';
        const bpLost = actors.some((a) => a.side === side && a.phase === 'defend-break');
        const pen = enemies(side).find((e) => e.maneuver && depth(enemy, e.pos) > (side === 'red' ? fortDepthBlue : -0.1) + 0.02);
        const res = mine.find((a) => a.reserve && a.phase === 'reserve');
        if (res && (pen || bpLost) && t > 20) {
          const target = pen ? pen.pos : enemies(side)[0]?.pos;
          if (target) {
            penetration = target;
            setPath(res, roadPath(res.pos, target), 'assault', 'counterattack');
            msg(t, `${side === 'red' ? 'Enemy reserve' : 'Friendly reserve'} ${name(res)} COUNTERATTACKS`);
            (res as any).caFrom = res.pos;
            (res as any).caAt = t;
          }
        }
      }
    }

    // ===== unit behaviour & movement =====
    for (const a of actors) {
      if (!alive(a)) continue;
      const foes = enemies(a.side);
      let nearest = Infinity;
      for (const e of foes) nearest = Math.min(nearest, distM(a.pos, e.pos) / 1000);
      const inRange = nearest < Math.max(RANGE[a.kind], 1.5) * rngScale * 1.1;
      if (inRange) {
        if (a.engagedSince < 0) a.engagedSince = t;
      } else a.engagedSince = -1;

      // breakpoints
      if (a.maneuver && a.str < 0.35 && a.posture !== 'withdraw' && a.phase !== 'ineffective') {
        setPath(a, roadPath(a.pos, a.role === 'defend' || a.role === 'delay' || a.role === 'withdraw' ? a.rear : a.aa), 'withdraw', 'ineffective');
        if (once('ce-' + a.id)) msg(t, `${a.side === 'blue' ? 'FRIENDLY' : 'ENEMY'} ${name(a)} combat ineffective, falling back`);
      } else if (a.role === 'defend' && a.phase === 'defend' && a.str < 0.55) {
        setPath(a, roadPath(a.pos, a.rear), 'withdraw', 'defend-break');
        if (once('break-' + a.side)) msg(t, `${a.side === 'red' ? 'ENEMY' : 'FRIENDLY'} defense breaking – ${name(a)} withdrawing`);
      } else if (isAttacker(a.side) && a.maneuver && a.str < 0.48 && (a.posture === 'deployed' || a.posture === 'assault')) {
        a.path = null;
        a.posture = 'hasty';
        a.phase = 'stalled';
      }

      // actions on contact: a marching column that runs into the enemy deploys and attacks
      if (a.posture === 'march' && a.maneuver && isAttacker(a.side) && nearest < Math.max(RANGE[a.kind], 1.5) * rngScale * 1.3) {
        const foe = foes.reduce((bst, e) => (distM(a.pos, e.pos) < distM(a.pos, bst.pos) ? e : bst), foes[0]);
        (a as any).resume = a.phase;
        setPath(a, xcPath(a.pos, foe.pos), 'deployed', 'hasty-attack');
        if (once('aoc-' + a.side)) msg(t, `${a.side === 'blue' ? 'Friendly' : 'Enemy'} lead elements deploy on contact`);
      }
      // after a hasty attack, resume the advance once the area is clear
      if (a.phase === 'consolidate' && (a as any).resume && a.obj && nearest > 4 * rngScale && a.str > 0.55) {
        const ph = (a as any).resume;
        (a as any).resume = undefined;
        setPath(a, roadPath(a.pos, a.obj), 'march', ph);
      }

      // phase logic
      switch (a.phase) {
        case 'assembly':
          if (a.role === 'attack' && t >= 4 + (a.kind === 'recon' ? 0 : r.range(2, 8)) + (a.maneuver ? 0 : 10)) {
            if (a.ap) setPath(a, roadPath(a.pos, a.ap), 'march', 'to-ap');
            else if (a.obj) setPath(a, roadPath(a.pos, a.obj), 'march', 'to-support');
          }
          if (a.role === 'advance' && t >= (a.kind === 'recon' ? 1 : a.maneuver ? 8 + r.range(0, 4) : 18)) {
            if (a.obj) setPath(a, roadPath(a.pos, a.obj), 'march', 'advance');
          }
          break;
        case 'screen':
          // defender security zone falls back when pressed
          if (nearest < 4.5 * rngScale) {
            setPath(a, roadPath(a.pos, pt(a.side, -0.45, a.lane)), 'withdraw', 'screen-back');
            if (once('screen-' + a.side)) msg(t, `${a.side === 'red' ? 'Enemy' : 'Friendly'} security zone forces fall back`);
          }
          break;
        case 'delay':
          if (a.delaySteps && a.delayIdx < a.delaySteps.length && a.engagedSince >= 0 && (t - a.engagedSince > 8 || a.str < 0.7)) {
            setPath(a, roadPath(a.pos, a.delaySteps[a.delayIdx++]), 'withdraw', 'delay-move');
            if (once(`delay-${a.delayIdx}-${a.side}`)) msg(t, `${a.side === 'blue' ? 'Friendly' : 'Enemy'} delay: displacing to next battle position`);
          }
          break;
        case 'hold':
          // withdrawal: main body leaves early, rear guard (first line unit) delays
          if (a.role === 'withdraw') {
            const rearGuard = actors.find((x) => x.side === a.side && x.maneuver && x.kind !== 'recon') === a;
            if (!rearGuard && t >= 6 + r.range(0, 6)) setPath(a, roadPath(a.pos, pt(a.side, -1.25, a.lane)), 'march', 'withdrawing');
            if (rearGuard && (a.engagedSince >= 0 && t - a.engagedSince > 12)) setPath(a, roadPath(a.pos, pt(a.side, -1.25, a.lane)), 'withdraw', 'withdrawing');
            if (once('wd-' + a.side) && t >= 6) msg(t, `${a.side === 'red' ? 'Enemy' : 'Friendly'} forces begin withdrawal; rear guard in contact`);
          }
          break;
      }

      // fire and movement: attackers halt in support-by-fire positions ~1 km from a strong enemy
      // position and only close in (assault) once the defender is worn down or suppressed
      let standoff = false;
      if ((a.posture === 'deployed' || a.posture === 'assault') && a.maneuver) {
        for (const e of foes) {
          const d = distM(a.pos, e.pos) / 1000;
          const holding = e.posture !== 'withdraw' && !e.gone;
          const suppressedWeak = t < e.suppressedUntil && e.str < 0.7;
          // support-by-fire standoff against a strong position; never drive onto an enemy that still holds
          if (holding && ((d < 1.1 * rngScale && e.str > 0.5 && !suppressedWeak) || d < 0.5 * rngScale)) {
            standoff = true;
            break;
          }
        }
        a.posture = standoff ? 'deployed' : nearest < 1.6 * rngScale ? 'assault' : a.posture;
      }
      // move along the current path
      if (a.path && !standoff && a.posture !== 'hasty' && a.posture !== 'prepared' && a.posture !== 'consolidate') {
        const v = speedOf(a, inRange);
        a.s = Math.min(a.pathLen, a.s + v / 60);
        a.pos = along(a.path, a.s * 1000);
        a.moving = v > 0;
        if (a.s >= a.pathLen - 1e-6) {
          a.moving = false;
          a.path = null;
          switch (a.phase) {
            case 'to-ap':
              a.phase = 'at-ap';
              a.posture = 'hasty';
              break;
            case 'attack':
            case 'hasty-attack':
            case 'pursue':
            case 'counterattack':
              a.phase = 'consolidate';
              a.posture = 'consolidate';
              if (a.objName && foes.every((e) => distM(e.pos, a.pos) > 900 * rngScale) && once('obj-' + a.objName)) msg(t, `OBJ ${a.objName} SEIZED by ${name(a)}`);
              break;
            case 'defend-break':
            case 'withdrawing':
              a.gone = true;
              a.disappear = t + 1;
              break;
            case 'screen-back':
              a.phase = 'support';
              a.posture = 'hasty';
              break;
            case 'delay-move':
              a.phase = 'delay';
              a.posture = 'hasty';
              a.engagedSince = -1;
              break;
            default:
              a.posture = 'hasty';
              if (a.phase !== 'ineffective') a.phase = 'support';
          }
        }
      } else a.moving = false;

      // PL crossing reports (friendly attackers)
      if (a.side === 'blue' && isAttacker('blue') && a.maneuver && a.posture !== 'withdraw') {
        const d = depth('blue', a.pos);
        plDepths.forEach((pd, i) => {
          if (d > pd && once('pl' + i)) msg(t, `${name(a)} crossing PL ${PL_NAMES[i + 1]}`);
        });
      }
      record(a, t);
    }

    // ===== direct fire (Lanchester-style, continuous attrition) =====
    const losses = new Map<Actor, number>();
    for (const a of actors) {
      if (!alive(a) || RANGE[a.kind] === 0 || a.posture === 'march' && a.kind !== 'recon') continue;
      const range = RANGE[a.kind] * rngScale;
      let tgt: Actor | null = null;
      let best = Infinity;
      for (const e of enemies(a.side)) {
        const d = distM(a.pos, e.pos) / 1000;
        // prepared positions are only acquired at short range unless previously spotted
        const acq = e.posture === 'prepared' && !known(e, t) ? range * 0.65 : range;
        if (d < acq && d < best) (best = d), (tgt = e);
      }
      if (!tgt) continue;
      const rf = 1 - 0.6 * (best / range);
      const q = a.side === 'blue' ? P.blueQuality : 1;
      const supp = t < a.suppressedUntil ? 0.3 : 1;
      // attackers mass combat power at the point of attack after H-hour
      const mass = isAttacker(a.side) && H[a.side] >= 0 && (a.posture === 'deployed' || a.posture === 'assault') ? 1.35 : 1;
      let vuln = VULN[tgt.posture];
      if (tgt.posture === 'prepared') {
        vuln = 1 / Math.max(1, P.defenderAdvantage);
        // close assault: once the attacker is on top of the position the advantage erodes; suppressed defenders are exposed
        if (best < 0.9 * rngScale) vuln = Math.max(vuln, 0.65);
        if (t < tgt.suppressedUntil) vuln *= 1.5;
      }
      const loss = 0.011 * P.lethality * POWER[a.kind] * a.str * a.quality * q * rf * vuln * supp * mass * r.range(0.7, 1.3);
      losses.set(tgt, (losses.get(tgt) ?? 0) + loss);
      if (r.next() < 0.28) events.push({ t, type: 'fire', from: a.id, to: tgt.id, duration: 1.2, kind: 'direct' });
    }
    for (const [tgt, l] of losses) tgt.str = Math.max(0, tgt.str - l);

    // ===== artillery =====
    for (const a of actors) {
      if (a.kind !== 'arty' || !alive(a) || a.moving || t - a.lastFire < 4) continue;
      const side = a.side;
      const foes = enemies(side).filter((e) => distM(a.pos, e.pos) < 24000 * rngScale);
      let tgt: Actor | undefined;
      const prep = prepStart[side] >= 0 && H[side] < 0;
      // counter-battery first if an enemy battery fired recently and is known
      const cb = foes.find((e) => e.kind === 'arty' && t - e.lastFire < 6 && known(e, t));
      if (cb && r.next() < 0.5) tgt = cb;
      else if (prep) tgt = r.pick(foes.filter((e) => e.posture === 'prepared' || e.posture === 'hasty').concat(foes).slice(0, 4));
      else {
        const kn = foes.filter((e) => known(e, t));
        // close support: the known enemy closest to our own forces
        kn.sort((x, y) => depth(side, x.pos) - depth(side, y.pos));
        tgt = kn[0];
      }
      if (!tgt) continue;
      const vuln = tgt.posture === 'prepared' ? 0.5 : tgt.posture === 'march' ? 1.5 : 1;
      fire(t, a, tgt, 0.03 * P.lethality * a.str * vuln * (side === 'blue' ? P.blueQuality : 1) * r.range(0.6, 1.4), 'indirect', 2.5);
      tgt.suppressedUntil = t + 5;
    }

    // ===== attack helicopters =====
    if (heloAt >= 0 && t === Math.round(heloAt)) {
      const bpU = (depth('blue', actors.filter((a) => a.side === 'blue' && alive(a) && a.maneuver).reduce((m, a) => (depth('blue', a.pos) > depth('blue', m.pos) ? a : m), actors[0]).pos) - 0.12) * D;
      const bp: LonLat = frame.toLL(Math.min(bpU, 0.1 * D), r.range(-F / 2, F / 2));
      const home: LonLat = pt('blue', -1.15, r.range(-F / 3, F / 3));
      let ingress: LonLat[] = [home, bp];
      if (riverLine) {
        const bu = frame.toUV(bp)[0];
        const pts = resample(riverLine, 30).filter((p) => frame.toUV(p)[0] < bu && frame.toUV(p)[0] > -D * 1.1);
        if (pts.length > 3) ingress = [home, ...pts.sort((x, y) => frame.toUV(x)[0] - frame.toUV(y)[0]), bp];
      } else {
        const [hu, hv] = frame.toUV(home);
        const [bu, bv] = frame.toUV(bp);
        ingress = [home, frame.toLL(hu + (bu - hu) * 0.35, hv + 2 * kmScale), frame.toLL(hu + (bu - hu) * 0.7, bv - 1.5 * kmScale), bp];
      }
      const L = lineLengthM(ingress) / 1000;
      const tIn = (L / 200) * 60;
      helos = [0, 1].map((i) => {
        const tr: Waypoint[] = [];
        for (let k = 0; k <= 30; k++) {
          const p = along(ingress, (L * 1000 * k) / 30);
          tr.push({ t: t + (tIn * k) / 30 + i * 0.4, pos: [p[0] + i * 0.004 * kmScale, p[1] + i * 0.002 * kmScale] });
        }
        const hold = tr[30].t + 15;
        tr.push({ t: hold, pos: tr[30].pos });
        const back = [...ingress].reverse();
        for (let k = 1; k <= 30; k++) tr.push({ t: hold + (tIn * k) / 30, pos: along(back, (L * 1000 * k) / 30) });
        return mkAir('blue', 'helo', `GUNSLINGER ${i + 1}`, tr, t, hold + tIn);
      });
      msg(t, 'Attack aviation inbound to battle position');
    }
    for (const h of helos) {
      const tr = h.track;
      if (t >= tr[30].t && t <= tr[31].t && t - h.lastFire >= 2) {
        const tg = enemies('blue').filter((e) => distM(tr[30].pos, e.pos) < 6000 * rngScale);
        if (tg.length) {
          const x = r.pick(tg);
          fire(t, h, x, 0.05 * P.lethality * VULN[x.posture === 'prepared' ? 'hasty' : x.posture], 'air', 1);
        }
        // enemy air defence engages the helicopters
        const ad = enemies('blue').find((e) => e.kind === 'ad' && distM(e.pos, tr[30].pos) < 8000 * rngScale);
        if (ad && r.next() < 0.3) events.push({ t, type: 'fire', from: ad.id, to: h.id, duration: 1.2, kind: 'direct' });
      }
    }
    // ===== strike package =====
    if (strikeAt >= 0 && t === Math.round(strikeAt)) {
      // priority targets: known reserve or artillery, else the strongest known enemy
      const kn = enemies('blue').filter((e) => known(e, t));
      const tgt = kn.find((e) => e.reserve) ?? kn.find((e) => e.kind === 'arty') ?? kn.sort((x, y) => y.str - x.str)[0];
      if (tgt) {
        const [tu, tv] = frame.toUV(tgt.pos);
        for (let i = 0; i < 2; i++) {
          const kph = 800;
          const legs = [frame.toLL(-D * 1.6, tv - 6 + i * 1.2), frame.toLL(tu - 8 * kmScale, tv - 3 + i * 0.8), tgt.pos, frame.toLL(tu + 3 * kmScale, tv + 2 + i), frame.toLL(-D * 1.6, tv + 10 + i)];
          let tt = t - ((distM(legs[0], legs[1]) + distM(legs[1], legs[2])) / 1000 / kph) * 60 + i * 0.3;
          const t0 = tt;
          const tr: Waypoint[] = [];
          legs.forEach((p, k) => {
            if (k > 0) tt += (distM(legs[k - 1], p) / 1000 / kph) * 60;
            tr.push({ t: tt, pos: p });
          });
          const a = mkAir('blue', 'strike', `HOG ${i + 1}`, tr, t0, tt);
          fire(t + i * 0.3, a, tgt, 0.18 * P.lethality, 'air', 0.8);
          tgt.suppressedUntil = t + 6;
        }
        msg(t, `Air strike on ${tgt.reserve ? 'enemy reserve' : name(tgt)}`);
      }
    }

    // ===== status reporting =====
    for (const a of actors) {
      if (a.dead || a.gone) continue;
      if (a.reportedStr - a.str >= 0.01) {
        a.reportedStr = Math.round(a.str * 100) / 100;
        events.push({ t, type: 'strength', unit: a.id, value: Math.round(a.str * 100) / 100 });
      }
      if (a.str < 0.15 && a.status !== 'destroyed') {
        a.status = 'destroyed';
        a.dead = true;
        a.path = null;
        a.disappear = t + 30;
        events.push({ t, type: 'status', unit: a.id, status: 'destroyed' });
        msg(t, `${a.side === 'blue' ? 'FRIENDLY' : 'ENEMY'} ${name(a)} destroyed`);
      } else if (a.str < 0.7 && a.status === 'present') {
        a.status = 'damaged';
        events.push({ t, type: 'status', unit: a.id, status: 'damaged' });
      }
    }
  }

  // ---------- graphics ----------
  const graphics: Graphic[] = [];
  const blueRole = tpl.blue;
  const redRole = tpl.red;
  const manBlue = actors.filter((a) => a.side === 'blue' && a.maneuver && a.kind !== 'recon');
  const bEch = manBlue[0]?.sidc.slice(8, 10) ?? '16';
  const lineAt = (d: number, amp = 0.25) => lateralLine(frame, d * D, F * 1.05, r, 7, amp * kmScale);

  const blueLanes = [...new Set(manBlue.filter((a) => !a.reserve).map((a) => a.lane))].sort((x, y) => x - y);
  for (let i = 0; i < blueLanes.length - 1; i++) {
    const v = (blueLanes[i] + blueLanes[i + 1]) / 2;
    const pts: LonLat[] = [];
    for (let k = 0; k <= 5; k++) pts.push(frame.toLL(-D + (k / 5) * 1.55 * D, v + r.range(-0.15, 0.15) * kmScale));
    graphics.push({ id: `bdy-${i}`, sidc: cmSidc('blue', '110100', bEch), points: pts });
  }
  if (blueRole === 'attack' || blueRole === 'advance') {
    graphics.push({ id: 'ld', sidc: cmSidc('blue', '141100'), points: lineAt(-0.55), modifiers: { T: PL_NAMES[0] } });
    plDepths.forEach((d, i) => graphics.push({ id: `pl-${i}`, sidc: cmSidc('blue', '140300'), points: lineAt(d), modifiers: { T: PL_NAMES[i + 1] } }));
    // attack positions
    manBlue.slice(0, 3).forEach((a, i) => {
      if (!a.ap) return;
      const [u, v] = frame.toUV(a.ap);
      graphics.push({ id: `ap-${i}`, sidc: cmSidc('blue', '151600'), points: circle(frame, u, v, 0.55 * kmScale, r, 7), modifiers: { T: ['ALPHA', 'BRAVO', 'CHARLIE'][i] } });
    });
  } else {
    [-0.15, -0.5, -0.82].forEach((d, i) => graphics.push({ id: `pl-${i}`, sidc: cmSidc('blue', '140300'), points: lineAt(d), modifiers: { T: PL_NAMES[i + 4] } }));
  }
  if (redRole === 'attack' || redRole === 'advance') {
    [0.55, 0.2].forEach((d, i) => graphics.push({ id: `rpl-${i}`, sidc: cmSidc('red', '140300'), points: lineAt(d, 0.15), modifiers: { T: RED_PL_NAMES[i] } }));
  }
  if (redRole === 'defend') {
    graphics.push({ id: 'red-fort', sidc: cmSidc('red', '290900'), points: lineAt(fortDepthBlue, 0.3) });
    defendBPs.red.forEach((bp, i) => {
      const [u, v] = frame.toUV(bp.p);
      graphics.push({ id: `obj-${i}`, sidc: cmSidc('blue', '151700'), points: circle(frame, u + 0.2 * kmScale, v, 1.3 * kmScale, r), modifiers: { T: bp.name } });
    });
  }
  if (blueRole === 'defend' || blueRole === 'delay') {
    graphics.push({ id: 'blue-fort', sidc: cmSidc('blue', '290900'), points: lineAt(-0.12, 0.25) });
    manBlue.filter((a) => !a.reserve).slice(0, 4).forEach((a, i) => {
      const [u, v] = frame.toUV(a.track[0].pos);
      graphics.push({ id: `bp-${i}`, sidc: cmSidc('blue', '151200'), points: circle(frame, u, v, 0.8 * kmScale, r, 7), modifiers: { T: `${i + 1}` } });
      if (i < 2) graphics.push({ id: `ea-${i}`, sidc: cmSidc('blue', '151300'), points: circle(frame, u + 0.3 * D, v, 1.4 * kmScale, r, 8), modifiers: { T: OBJ_NAMES[i + 4] } });
    });
  }
  const axisFor = (side: Side, path: LonLat[] | null, entity: string, id: string, appear?: number) => {
    if (!path || path.length < 2) return;
    const fine = resample(path, 10);
    const pts = [fine[0], fine[5], fine[9]].map((p) => frame.toUV(p));
    const tip = pts[2];
    const prev = pts[1];
    const len = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
    const dir = [(tip[0] - prev[0]) / len, (tip[1] - prev[1]) / len];
    const w = Math.max(0.35, D * 0.055);
    const base = [tip[0] - dir[0] * w * 1.3, tip[1] - dir[1] * w * 1.3];
    const widthPt = frame.toLL(base[0] - dir[1] * w, base[1] + dir[0] * w);
    graphics.push({ id, sidc: cmSidc(side, entity), points: [...pts.slice().reverse().map(([u, v]) => frame.toLL(u, v)), widthPt], appear });
  };
  for (const side of ['blue', 'red'] as Side[]) {
    if (!isAttacker(side)) continue;
    const att = actors.filter((a) => a.side === side && a.maneuver && a.kind !== 'recon' && a.ap && a.obj);
    if (!att.length) continue;
    const main = att[Math.floor(att.length / 2)];
    axisFor(side, [main.ap!, main.obj!], '151403', `${side}-axis-main`);
    if (att.length > 2) axisFor(side, [att[0].ap!, att[0].obj!], '151404', `${side}-axis-sup`);
  }
  // counterattack arrow appears when the reserve is committed
  for (const a of actors) {
    const caAt = (a as any).caAt;
    if (caAt !== undefined) {
      const from: LonLat = (a as any).caFrom;
      const to = trackPos(a.track, Math.min(T, caAt + 40));
      axisFor(a.side, [from, to], '340600', `ca-${a.id}`, caAt);
    }
  }
  const hq = actors.find((a) => a.side === 'blue' && a.sidc[7] === '2');
  if (hq) {
    const [u, v] = frame.toUV(hq.track[0].pos);
    graphics.push({ id: 'aa', sidc: cmSidc('blue', '150200'), points: circle(frame, u, v, 1.2 * kmScale, r, 8), modifiers: { T: 'TIGER' } });
  }
  // FLOTs follow the forward line of in-contact maneuver units (keyframed)
  const flotKeys = (side: Side) => {
    const keys: { t: number; points: LonLat[] }[] = [];
    const vs = Array.from({ length: 8 }, (_, i) => -F + (2 * F * i) / 7);
    const wob = vs.map(() => r.range(-0.2, 0.2) * kmScale);
    const units = actors.filter((a) => a.side === side && a.maneuver);
    let lastFront = -Infinity;
    for (let t = 0; t <= T; t += 10) {
      const ds = units
        .filter((a) => !(a.disappear !== undefined && t >= a.disappear) && !(a.status === 'destroyed' && a.disappear !== undefined && t > a.disappear - 30))
        .map((a) => depth(side, trackPos(a.track, t)));
      if (!ds.length) continue;
      let front = Math.max(...ds) * D + 0.6 * kmScale;
      if (isAttacker(side)) front = Math.max(front, lastFront); // FLOT doesn't fall back during an attack
      lastFront = front;
      keys.push({ t, points: vs.map((v, i) => frame.toLL((front + wob[i]) * sign(side), v)) });
    }
    return keys;
  };
  const bk = flotKeys('blue');
  if (bk.length) graphics.push({ id: 'flot-blue', sidc: cmSidc('blue', '140100'), points: bk[0].points, keyframes: bk.slice(1) });
  if (redRole !== 'defend') {
    const rk = flotKeys('red');
    if (rk.length) graphics.push({ id: 'flot-red', sidc: cmSidc('red', '140100'), points: rk[0].points, keyframes: rk.slice(1) });
  }

  // ---------- assemble ----------
  const units: Unit[] = [
    ...actors.map((a) => ({
      id: a.id,
      sidc: a.sidc,
      modifiers: { uniqueDesignation: a.T, higherFormation: a.M || undefined, speedLeader: true },
      track: a.track,
      disappear: a.disappear,
      seen: a.seen,
    })),
    ...air.map((a) => ({
      id: a.id,
      sidc: a.sidc,
      air: true,
      modifiers: { uniqueDesignation: a.T, direction: 'auto' as const },
      track: a.track,
      appear: a.appear,
      disappear: a.disappear,
    })),
  ];
  const day = new Date(Date.UTC(2026, r.int(0, 11), r.int(1, 28), r.int(3, 6), r.pick([0, 15, 30, 45])));
  // operation codename + mission statement style title
  const OP_A = ['IRON', 'STEEL', 'GRANITE', 'COBALT', 'THUNDER', 'SILENT', 'NORTHERN', 'AMBER', 'TITAN', 'RAVEN', 'SABRE', 'FROST'];
  const OP_B = ['SPEAR', 'TALON', 'ANVIL', 'SHIELD', 'HAMMER', 'LANCE', 'GUARDIAN', 'STRIKE', 'BASTION', 'ARROW', 'FORGE', 'WATCH'];
  const opName = `${OP_A[o.seed % OP_A.length]} ${OP_B[Math.floor(o.seed / OP_A.length) % OP_B.length]}`;
  const objs = defendBPs.red.map((b) => b.name).filter(Boolean);
  const objTxt = objs.length > 1 ? `OBJ ${objs[0]}–${objs[objs.length - 1]}` : objs.length ? `OBJ ${objs[0]}` : 'OBJECTIVES';
  const bHQ = bluePkg.hqName;
  const task: Record<string, string> = {
    'deliberate-attack': `${bHQ} ATTACKS TO SEIZE ${objTxt}`,
    meeting: `${bHQ} MOVEMENT TO CONTACT`,
    'blue-delay': `${bHQ} DELAYS IN SECTOR · PL ${PL_NAMES[4]}–${PL_NAMES[6]}`,
    pursuit: `${bHQ} PURSUIT · DESTROY WITHDRAWING ENEMY`,
    'blue-defend': `${bHQ} DEFENDS IN SECTOR · RETAIN BP 1–4`,
  };
  const title = `OP ${opName} · ${task[tpl.id] ?? tpl.name.toUpperCase()}`;
  return {
    meta: {
      name: `${tpl.name} – ${bluePkg.name} vs ${redPkg.name}`,
      title,
      start: day.toISOString(),
      durationMin: T,
      banner: 'EXERCISE – SYNTHETIC DATA',
      axis: o.axis,
    },
    view: { t: 0, center: o.center, zoom: o.zoom, bearing: 0, pitch: 0 },
    units,
    graphics,
    events: events.sort((x, y) => x.t - y.t),
    generator: { ...o, onProgress: undefined },
  } as Scenario;
}
