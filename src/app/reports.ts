/**
 * Facsimile C2 reports derived from the simulation (not random text):
 *  - SPOTREP (SALUTE format) from actual Blue detections of enemy units
 *  - BDA from enemy status / strength changes
 *  - Fire missions from friendly indirect-fire events
 *  - Staff chat from scenario events with generic callsigns
 * All unit names, equipment types and callsigns are generic and fictional.
 */
import type { LonLat, Scenario, Unit } from '../scenario/types';
import { sampleTrack, sideOf } from '../scenario/sim';
import { toMgrs } from '../geo/geo';
import { dtg } from '../render/hud';

export interface Report {
  t: number;
  kind: 'SPOTREP' | 'BDA' | 'FIRE' | 'CONTACT' | 'SITREP';
  title: string;
  body: string;
  pos?: LonLat;
  unitId?: string;
  severity: 'info' | 'warn' | 'alert';
}

export interface ChatLine {
  t: number;
  from: string;
  text: string;
}

const ECHELON: Record<string, string> = { '15': 'Company', '16': 'Battalion', '17': 'Regiment', '18': 'Brigade', '21': 'Division' };

function kindOf(u: Unit): { type: string; equip: string } {
  const e = u.sidc.slice(10, 16);
  if (u.sidc.slice(4, 6) === '01') return { type: 'aircraft', equip: 'fixed/rotary-wing aircraft' };
  if (e.startsWith('1205')) return { type: 'armor', equip: 'main battle tanks' };
  if (e.startsWith('121102')) return { type: 'mechanized infantry', equip: 'tracked IFVs' };
  if (e.startsWith('121104')) return { type: 'motorized infantry', equip: 'wheeled APCs' };
  if (e.startsWith('1211')) return { type: 'infantry', equip: 'dismounted infantry, ATGM teams' };
  if (e.startsWith('1213')) return { type: 'reconnaissance', equip: 'wheeled recon vehicles' };
  if (e.startsWith('1303')) return { type: 'artillery', equip: 'self-propelled howitzers' };
  if (e.startsWith('1301')) return { type: 'air defense', equip: 'mobile SAM / AAA systems' };
  if (e.startsWith('1407')) return { type: 'engineer', equip: 'engineer vehicles' };
  return { type: 'unit', equip: 'mixed vehicles' };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const mgrs = (p: LonLat) => toMgrs(p[0], p[1], 4);

export function buildReports(sc: Scenario): { reports: Report[]; chat: ChatLine[] } {
  const start = new Date(sc.meta.start).getTime();
  const D = (t: number) => dtg(new Date(start + t * 60000));
  const reports: Report[] = [];
  const chat: ChatLine[] = [];
  const byId = new Map(sc.units.map((u) => [u.id, u]));
  const friends = sc.units.filter((u) => sideOf(u.sidc) === 'friend' && !u.air);
  const name = (u?: Unit) => (u ? `${u.modifiers?.uniqueDesignation ?? u.id}${u.modifiers?.higherFormation ? '/' + u.modifiers.higherFormation : ''}` : '?');
  const observer = (p: LonLat, t: number) => {
    let best: Unit | undefined;
    let bd = Infinity;
    for (const f of friends) {
      if (f.disappear !== undefined && t >= f.disappear) continue;
      const q = sampleTrack(f.track, t).pos;
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d < bd) (bd = d), (best = f);
    }
    return best;
  };

  // --- SPOTREPs from Blue sightings of enemy units ---
  let n = 0;
  for (const u of sc.units) {
    if (sideOf(u.sidc) !== 'hostile' || u.air || !u.seen?.length) continue;
    const k = kindOf(u);
    const size = ECHELON[u.sidc.slice(8, 10)] ?? 'Unit';
    let lastRep = -999;
    for (const s of u.seen) {
      if (s.t - lastRep < 25) continue;
      lastRep = s.t;
      const st = sampleTrack(u.track, s.t);
      const act = st.moving ? `moving ${compass(st.heading)} at ~${Math.max(5, Math.round(st.speed / 5) * 5)} km/h` : 'stationary, in position';
      const obs = observer(s.pos, s.t);
      n++;
      reports.push({
        t: s.t,
        kind: 'SPOTREP',
        title: `SPOTREP #${String(n).padStart(3, '0')} · ${size}-size ${k.type}`,
        body: `S: ${size}-size element\nA: ${act}\nL: ${mgrs(s.pos)}\nU: enemy ${k.type}${u.modifiers?.uniqueDesignation ? ' (' + name(u) + ')' : ''}\nT: ${D(s.t)}\nE: ${k.equip}\nObserved by: ${name(obs)}`,
        pos: s.pos,
        unitId: u.id,
        severity: st.moving ? 'warn' : 'info',
      });
      if (n % 3 === 1) chat.push({ t: s.t, from: 'BDE S2', text: `New SPOTREP: ${size.toLowerCase()} ${k.type} ${act} vic ${mgrs(s.pos)}` });
    }
  }

  // --- events: BDA, fire missions, contact, sitreps ---
  let fm = 1000;
  const lastFm = new Map<string, number>();
  for (const e of sc.events ?? []) {
    if (e.type === 'status') {
      const u = byId.get(e.unit);
      if (!u || e.status === 'present') continue;
      const hostile = sideOf(u.sidc) === 'hostile';
      const k = kindOf(u);
      const p = sampleTrack(u.track, e.t).pos;
      reports.push({
        t: e.t,
        kind: 'BDA',
        title: `${hostile ? 'BDA' : 'LOSS REPORT'} · ${name(u)} ${e.status === 'destroyed' ? 'DESTROYED' : 'DAMAGED'}`,
        body: `${hostile ? 'Enemy' : 'Friendly'} ${k.type} ${name(u)} assessed ${e.status === 'destroyed' ? 'destroyed (combat ineffective)' : 'damaged (<70% strength)'}\nL: ${mgrs(p)}\nT: ${D(e.t)}`,
        pos: p,
        unitId: u.id,
        severity: hostile ? 'info' : 'alert',
      });
      chat.push({ t: e.t, from: hostile ? 'BDE FSE' : name(u), text: hostile ? `BDA: ${name(u)} ${e.status}` : `${name(u)} reports heavy losses, request support` });
    } else if (e.type === 'fire' && e.kind === 'indirect') {
      const shooter = byId.get(e.from);
      const tgt = byId.get(e.to);
      if (!shooter || !tgt || sideOf(shooter.sidc) !== 'friend') continue;
      if (e.t - (lastFm.get(e.to) ?? -99) < 8) continue;
      lastFm.set(e.to, e.t);
      const p = sampleTrack(tgt.track, e.t).pos;
      fm++;
      reports.push({
        t: e.t,
        kind: 'FIRE',
        title: `FIRE MISSION AB${fm} · ${name(shooter)}`,
        body: `Target: enemy ${kindOf(tgt).type}, ${sampleTrack(tgt.track, e.t).moving ? 'moving' : 'stationary'}\nGrid: ${mgrs(p)}\nFiring unit: ${name(shooter)}\nMethod: battery, 3 volleys\nStatus: rounds complete ${D(e.t + 3)}`,
        pos: p,
        unitId: tgt.id,
        severity: 'info',
      });
    } else if (e.type === 'message') {
      const alert = /CONTACT|COUNTERATTACK|destroyed|withdraw|culminat/i.test(e.text);
      if (/CONTACT|H-HOUR|SEIZED|COUNTERATTACK|culminat|breaking/i.test(e.text)) {
        reports.push({ t: e.t, kind: /CONTACT/.test(e.text) ? 'CONTACT' : 'SITREP', title: e.text.slice(0, 60), body: `${e.text}\nT: ${D(e.t)}`, severity: alert ? 'alert' : 'info' });
      }
      const from = /artillery|Air strike/i.test(e.text) ? 'BDE FSE' : /aviation/i.test(e.text) ? 'AVN LNO' : /ENEMY|Enemy|CONTACT/.test(e.text) ? 'BDE S2' : 'BDE TOC';
      chat.push({ t: e.t, from, text: e.text });
    }
  }
  reports.sort((a, b) => a.t - b.t);
  chat.sort((a, b) => a.t - b.t);
  return { reports, chat };
}
