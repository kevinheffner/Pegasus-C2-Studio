/**
 * Instructor Operator Station (IOS) facsimile – original, generic design.
 * Monitor 1 "Exercise Control": Master Event List (scheduled / conditional injects with Execute-now),
 *   god's-eye tactical map, instructor journal, simulation controls (freeze, step, time scale, snapshots).
 * Monitor 2 "Training Overview": trainee station repeaters (sensor views + COP), training objectives,
 *   session timeline and performance KPIs.
 * One or two monitors; monitor 2 can be popped out to a second screen (synced via BroadcastChannel).
 */
import maplibregl from 'maplibre-gl';
import { generate } from '../scenario/generator';
import { Simulation, sideOf, type SimState } from '../scenario/sim';
import type { LonLat, Scenario } from '../scenario/types';
import { AO_PRESETS, DEFAULT_PARAMS } from '../scenario/catalog';
import { BUILTIN_PACKAGES, type Settings } from '../app/library';
import { MapView } from '../render/view2d';
import { getLook } from '../render/looks';
import { SensorView } from '../app/sensorview';
import { dtg } from '../render/hud';
import { toMgrs } from '../geo/geo';
import { saveOutput } from '../export/save';
import './ios.css';

type MelStatus = 'pending' | 'armed' | 'fired' | 'skipped';
interface MelItem {
  id: string;
  t: number; // planned trigger (mission minutes)
  kind: 'SCENARIO' | 'INJECT' | 'MALFUNCTION' | 'THREAT' | 'ENVIRONMENT' | 'COMMS' | 'MEDICAL' | 'LOGISTICS';
  title: string;
  detail: string;
  target: string;
  trigger: 'time' | 'condition' | 'manual';
  effect?: 'gps' | 'fog' | 'comms' | 'sensor' | 'samradar';
  status: MelStatus;
  firedAt?: number;
  response?: number; // trainee response delay (min)
}
interface Journal {
  t: number;
  who: string;
  text: string;
  cls?: string;
}

function settingsToGen(s: Settings) {
  const preset = AO_PRESETS.find((a) => a.id === s.ao) ?? AO_PRESETS[0];
  return {
    center: preset.center,
    zoom: Number(s.zoom ?? 11.7),
    axis: Number(s.axis ?? preset.axis),
    template: String(s.template ?? 'deliberate-attack'),
    blue: String(s.blue ?? 'abct'),
    red: String(s.red ?? 'mr-bde'),
    air: (s.air ?? 'all') as any,
    movement: (s.movement ?? 'roads') as any,
    riverine: s.riverine === true,
    seed: Number(s.seed ?? 7),
    params: { ...DEFAULT_PARAMS },
    viewPx: [1280, 720] as [number, number],
  };
}

const hashN = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** build the Master Event List from the mission plus a set of generic training injects */
function buildMel(sc: Scenario): MelItem[] {
  const out: MelItem[] = [];
  let n = 0;
  const id = () => `MEL-${String(++n).padStart(3, '0')}`;
  const msgs = (sc.events ?? []).filter((e) => e.type === 'message') as { t: number; text: string }[];
  const find = (re: RegExp) => msgs.find((m) => re.test(m.text));
  const hhour = find(/H-HOUR/)?.t ?? sc.meta.durationMin * 0.25;
  // scenario milestones (fire automatically as the engagement unfolds)
  for (const [re, title, target] of [
    [/artillery preparation/i, 'Artillery preparation begins', 'FIRES CELL'],
    [/H-HOUR/, 'H-hour: forces cross the LD', 'BDE TOC'],
    [/CONTACT/, 'First contact report expected', 'TF 1-12'],
    [/COUNTERATTACK/i, 'Enemy reserve counterattack', 'BDE TOC'],
    [/Air strike/i, 'Close air support strike', 'JTAC'],
    [/aviation inbound/i, 'Attack aviation on station', 'AVN LNO'],
    [/culminat/i, 'Attack culminates', 'BDE TOC'],
    [/SEIZED/, 'Objective seized', 'BDE TOC'],
  ] as [RegExp, string, string][]) {
    const m = find(re);
    if (m) out.push({ id: id(), t: m.t, kind: 'SCENARIO', title, detail: m.text, target, trigger: 'condition', status: 'pending' });
  }
  // generic training injects, timed relative to H-hour
  const inj: [number, MelItem['kind'], string, string, string, MelItem['effect']?][] = [
    [-15, 'COMMS', 'BDE command net degraded', 'Heavy interference on the brigade command net; alternate net required.', 'BDE TOC', 'comms'],
    [5, 'ENVIRONMENT', 'GPS jamming in the AO', 'GNSS degraded within 15 km of the FLOT; navigation accuracy reduced.', 'ALL', 'gps'],
    [18, 'THREAT', 'Pop-up SAM radar active', 'Enemy acquisition radar emitting; air corridor at risk.', 'AD CELL / AVN', 'samradar'],
    [25, 'MALFUNCTION', 'UAV EO/IR sensor fault', 'REAPER 1 gimbal stabilisation failure; imagery degraded.', 'UAV OPERATOR', 'sensor'],
    [35, 'MEDICAL', 'MEDEVAC request (9-line)', 'Urgent surgical casualties at the forward company; landing zone marked.', 'TF 2-14'],
    [48, 'ENVIRONMENT', 'Fog bank moves into the valley', 'Visibility drops to 800 m; observation and fires affected.', 'ALL', 'fog'],
    [62, 'LOGISTICS', 'Class III resupply request', 'Fuel critical in the lead battalion; LOGPAC requested.', 'BSB'],
    [75, 'INJECT', 'Civilian convoy on main supply route', 'Refugee column blocking the MSR; deconfliction required.', 'BDE TOC'],
    [90, 'INJECT', 'Possible chemical alarm', 'M8 alarm sounding at the TOC – false positive to be confirmed.', 'BDE TOC'],
  ];
  for (const [dt, kind, title, detail, target, effect] of inj) {
    const t = Math.max(3, Math.min(sc.meta.durationMin - 5, hhour + dt));
    out.push({ id: id(), t, kind, title, detail, target, trigger: 'time', effect, status: 'pending' });
  }
  // manual-only items (instructor discretion)
  out.push({ id: id(), t: -1, kind: 'MALFUNCTION', title: 'Vehicle breakdown (lead tank)', detail: 'Lead MBT of TF 1-12 throws a track; recovery required.', target: 'TF 1-12', trigger: 'manual', status: 'pending' });
  out.push({ id: id(), t: -1, kind: 'THREAT', title: 'Enemy UAV overflight', detail: 'Hostile reconnaissance UAV over friendly assembly area.', target: 'AD CELL', trigger: 'manual', status: 'pending' });
  out.sort((a, b) => (a.t < 0 ? 1e9 : a.t) - (b.t < 0 ? 1e9 : b.t));
  for (const m of out) m.response = 0.8 + (hashN(m.id + m.title) % 30) / 10; // trainee reaction 0.8–3.7 min
  return out;
}

export async function initIOS() {
  const params = new URLSearchParams(location.search);
  const follower = params.get('monitor') === '2'; // popped-out monitor 2 window
  const root = document.createElement('div');
  root.id = 'iosApp';
  root.innerHTML = `
  <header id="iosTop">
    <div class="sys"><span class="sysmark">🎓</span><span class="sysname">Pegasus Training</span><span class="syssub">Instructor Station</span></div>
    <div class="iosEx"><span class="tblabel">Training session</span> <span id="iosEx">—</span></div>
    <div class="tbstatus"><span id="iosState" class="iosState run">● Running</span><span id="iosDtg" class="mono"></span><span id="iosWall" class="mono iosWall"></span></div>
    <div class="tbactions">
      <label class="iosSel">Mission <select id="iosMission"></select></label>
      <label class="iosSel">Monitors <select id="iosMon"><option value="1">1</option><option value="2" selected>2</option></select></label>
      <button id="iosPop" class="ico" title="Pop monitor 2 out to another screen">⧉</button>
      <select id="iosRecTarget" class="recTop" title="What to record"><option value="m1">Monitor 1</option><option value="m2">Monitor 2</option><option value="both">Both monitors</option></select>
      <button id="iosRec" class="ico rec" title="Record (screen capture)">●</button>
      <button id="iosStop" class="ico stop" title="Stop recording" disabled>■</button>
    </div>
  </header>
  <div id="iosMonitors">
    <section class="monitor" id="mon1">
      <div class="monLabel">Session control<small>Monitor 1</small></div>
      <div class="m1grid">
        <div class="pane melPane">
          <div class="paneHead">Master event list <span class="paneSub" id="melCount"></span>
            <span class="grow"></span><span class="chips" id="melFilter"><button data-k="all" class="on">All</button><button data-k="pending">Upcoming</button><button data-k="fired">Done</button></span></div>
          <div class="melTable"><table><thead><tr><th>ID</th><th>Time</th><th>Type</th><th>Event</th><th>Audience</th><th>Trigger</th><th>Status</th><th></th></tr></thead><tbody id="melBody"></tbody></table></div>
        </div>
        <div class="pane mapPane">
          <div class="paneHead">Exercise map <span class="paneSub">ground truth</span> <span class="grow"></span><label class="check small"><input type="checkbox" id="iosFog"> Learner view</label><label class="check small"><input type="checkbox" id="iosRings" checked> Threat rings</label></div>
          <div class="iosMapWrap"><div id="iosMap"></div><div id="iosFogLayer"></div><div id="iosEffects"></div></div>
        </div>
        <div class="pane jourPane">
          <div class="paneHead">Instructor notes &amp; log</div>
          <div id="iosJournal" class="jour"></div>
          <div class="row"><input id="iosNote" type="text" placeholder="Add an instructor note…" class="grow" /><button id="iosNoteAdd" class="ghost small2" style="flex:none">Log</button></div>
        </div>
        <div class="pane ctlPane">
          <div class="ctlRow">
            <button id="iosRun" class="ctlBtn">❚❚ Pause</button>
            <button id="iosStep" class="ctlBtn" title="Advance 1 minute">⏭ Step 1 min</button>
            <label class="iosSel">Time scale <select id="iosScale"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></label>
            <input id="iosTime" type="range" min="0" max="240" step="0.1" value="0" class="grow" />
            <span id="iosT" class="mono iosT"></span>
            <button id="iosSnap" class="ctlBtn" title="Save a snapshot of the exercise state">⎙ Save snapshot</button>
            <select id="iosSnaps" title="Restore a snapshot"><option value="">Restore snapshot…</option></select>
          </div>
        </div>
      </div>
    </section>
    <section class="monitor" id="mon2">
      <div class="monLabel">Learner overview<small>Monitor 2</small></div>
      <div class="m2grid">
        <div class="pane rep" data-rep="0"><div class="paneHead">Learner 1 · UAV operator <span class="paneSub">EO/IR feed</span></div><div class="repBody" id="rep0"></div></div>
        <div class="pane rep" data-rep="1"><div class="paneHead">Learner 2 · Air defence <span class="paneSub">radar scope</span></div><div class="repBody" id="rep1"></div></div>
        <div class="pane rep" data-rep="2"><div class="paneHead">Learner 3 · EW operator <span class="paneSub">ESM display</span></div><div class="repBody" id="rep2"></div></div>
        <div class="pane rep" data-rep="3"><div class="paneHead">Learner 4 · Battle captain <span class="paneSub">common picture</span></div><div class="repBody"><div id="rep3map"></div></div></div>
        <div class="pane kpiPane"><div class="paneHead">Progress</div><div id="iosKpi" class="kpis"></div></div>
        <div class="pane objPane"><div class="paneHead">Learning objectives</div><div id="iosObj" class="objs"></div></div>
        <div class="pane tlPane"><div class="paneHead">Session timeline</div><canvas id="iosTl"></canvas></div>
      </div>
    </section>
  </div>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

  // ---------- state ----------
  let sc: Scenario | null = null;
  let sim: Simulation | null = null;
  let mel: MelItem[] = [];
  let journal: Journal[] = [];
  let t = 0;
  let playing = !follower;
  const effects = new Set<string>();
  const snapshots: { name: string; t: number; mel: MelItem[]; journal: Journal[]; effects: string[] }[] = [];
  const BASE_SPEED = 0.5; // 30× real time at scale 1×
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('pegasus-ios') : null;

  // ---------- maps & repeaters ----------
  const look = getLook('c2-light');
  const godMap = new MapView($('iosMap'), look, AO_PRESETS[0].center, 11.5);
  const copMap = new MapView($('rep3map'), getLook('topo'), AO_PRESETS[0].center, 11.5);
  await Promise.all([godMap.setLook(look), copMap.setLook(getLook('topo'))]);
  copMap.fog = true;
  const reps = [new SensorView($('rep0'), 'eoir'), new SensorView($('rep1'), 'radar'), new SensorView($('rep2'), 'esm')];
  reps[0].params.hud = true;
  reps[0].params.res = '960';

  // threat rings (air defence engagement zones) on the god's-eye map
  godMap.map.on('load', () => undefined);
  const ringSrc = () => {
    const m = godMap.map;
    if (!m.getSource('ios-rings')) {
      m.addSource('ios-rings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'ios-rings-fill', type: 'fill', source: 'ios-rings', paint: { 'fill-color': '#ff3b3b', 'fill-opacity': 0.08 } });
      m.addLayer({ id: 'ios-rings-line', type: 'line', source: 'ios-rings', paint: { 'line-color': '#ff6060', 'line-width': 1.2, 'line-dasharray': [3, 2] } });
    }
    return m.getSource('ios-rings') as maplibregl.GeoJSONSource;
  };
  const circle = (c: LonLat, km: number) => {
    const pts: LonLat[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([c[0] + (km * Math.sin(a)) / (111.32 * Math.cos((c[1] * Math.PI) / 180)), c[1] + (km * Math.cos(a)) / 111.32]);
    }
    return pts;
  };

  const fit = (mv: MapView, st: SimState, pad = 0.08) => {
    const g = st.units.filter((u) => !u.unit.air);
    if (!g.length) return;
    let w = 180, e = -180, s = 90, n = -90;
    for (const u of g) (w = Math.min(w, u.pos[0])), (e = Math.max(e, u.pos[0])), (s = Math.min(s, u.pos[1])), (n = Math.max(n, u.pos[1]));
    const c = mv.map.getCanvas();
    mv.map.fitBounds([[w, s], [e, n]], { padding: { left: c.clientWidth * pad, right: c.clientWidth * pad, top: c.clientHeight * pad + 10, bottom: c.clientHeight * pad }, duration: 0 });
  };

  // ---------- mission ----------
  const missions = BUILTIN_PACKAGES.filter((p) => !p.workspace.multiAO);
  $<HTMLSelectElement>('iosMission').innerHTML = ((window as any).scc?.active?.scenario ? '<option value="cop">Current COP mission</option>' : '') + missions.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  async function loadMission() {
    const v = $<HTMLSelectElement>('iosMission').value;
    let s: Scenario | null = v === 'cop' ? (window as any).scc?.active?.scenario ?? null : null;
    if (!s) s = await generate(settingsToGen(missions[Number(v) || 0].settings));
    sc = s;
    sim = new Simulation(s);
    mel = buildMel(s);
    journal = [{ t: 0, who: 'IOS', text: `Session opened · ${s.meta.title ?? s.meta.name}`, cls: 'sys' }];
    effects.clear();
    t = 0;
    $<HTMLInputElement>('iosTime').max = String(s.meta.durationMin);
    $('iosEx').textContent = (s.meta.title ?? s.meta.name).replace(/^OP /, 'OP ');
    godMap.setScenario(s);
    copMap.setScenario(s);
    for (const r of reps) (r.sensor.reset?.(), (r.lastT = -1));
    const st = sim.stateAt(0, {});
    fit(godMap, st);
    fit(copMap, st, 0.04);
    renderAll(true);
  }
  $<HTMLSelectElement>('iosMission').onchange = loadMission;

  // ---------- MEL ----------
  let melFilter = 'all';
  document.querySelectorAll<HTMLButtonElement>('#melFilter button').forEach((b) => (b.onclick = () => ((melFilter = b.dataset.k!), document.querySelectorAll('#melFilter button').forEach((x) => x.classList.toggle('on', x === b)), renderMel())));
  const fmtRt = (x: number) => `${Math.floor(x)}:${String(Math.round((x % 1) * 60)).padStart(2, "0")}`;
  const fmtT = (x: number) => (x < 0 ? '—' : `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')}`);
  function fire(m: MelItem, manual: boolean, at = t) {
    if (m.status === 'fired' || m.status === 'skipped') return;
    m.status = 'fired';
    m.firedAt = at;
    if (m.effect) effects.add(m.effect);
    journal.push({ t: at, who: manual ? 'INSTRUCTOR' : 'MEL', text: `${m.id} ${manual ? 'executed' : 'fired'}: ${m.title} → ${m.target}`, cls: m.kind === 'SCENARIO' ? 'scn' : 'inj' });
    broadcast();
  }
  function renderMel() {
    const body = $('melBody');
    const rows = mel.filter((m) => melFilter === 'all' || (melFilter === 'pending' ? m.status === 'pending' || m.status === 'armed' : m.status === 'fired'));
    body.innerHTML = rows
      .map(
        (m) => `<tr class="mel ${m.status}"><td class="mono">${m.id}</td><td class="mono">${fmtT(m.t)}</td><td><span class="kind k-${m.kind.toLowerCase()}">${m.kind[0] + m.kind.slice(1).toLowerCase()}</span></td>
        <td><div class="melTitle">${m.title}</div><div class="melDet">${m.detail}</div></td><td>${m.target}</td><td>${m.trigger[0].toUpperCase() + m.trigger.slice(1)}</td>
        <td><span class="st st-${m.status}">${({ pending: 'Upcoming', armed: 'Armed', fired: 'Done', skipped: 'Skipped' } as Record<string, string>)[m.status]}${m.firedAt !== undefined ? ' ' + fmtT(m.firedAt) : ''}</span></td>
        <td class="melAct">${m.status === 'pending' || m.status === 'armed' ? `<button data-x="${m.id}" title="Run this event now">▶ Run</button><button data-s="${m.id}" title="Skip">Skip</button>` : ''}</td></tr>`,
      )
      .join('');
    $('melCount').textContent = `${mel.filter((m) => m.status === 'fired').length}/${mel.length} fired`;
    body.querySelectorAll<HTMLButtonElement>('button[data-x]').forEach((b) => (b.onclick = () => (fire(mel.find((m) => m.id === b.dataset.x)!, true), renderAll(true))));
    body.querySelectorAll<HTMLButtonElement>('button[data-s]').forEach(
      (b) =>
        (b.onclick = () => {
          const m = mel.find((x) => x.id === b.dataset.s)!;
          m.status = 'skipped';
          journal.push({ t, who: 'INSTRUCTOR', text: `${m.id} skipped: ${m.title}`, cls: 'skip' });
          broadcast();
          renderAll(true);
        }),
    );
  }

  // ---------- journal ----------
  function renderJournal() {
    if (!sc) return;
    const start = new Date(sc.meta.start).getTime();
    // trainee responses appear after their reaction delay
    const resp: Journal[] = mel.filter((m) => m.status === 'fired' && m.kind !== 'SCENARIO' && m.firedAt !== undefined && t >= m.firedAt + m.response!).map((m) => ({ t: m.firedAt! + m.response!, who: m.target, text: `acknowledged ${m.id} (${m.title}) · RT ${fmtRt(m.response!)}`, cls: 'resp' }));
    const all = [...journal, ...resp].filter((j) => j.t <= t + 1e-6).sort((a, b) => a.t - b.t);
    $('iosJournal').innerHTML = all.map((j) => `<div class="jl ${j.cls ?? ''}"><span class="jt mono">${dtg(new Date(start + j.t * 60000)).slice(0, 6)}Z</span><b>${j.who}</b> ${j.text}</div>`).join('');
    $('iosJournal').scrollTop = $('iosJournal').scrollHeight;
  }
  $('iosNoteAdd').onclick = () => {
    const v = $<HTMLInputElement>('iosNote').value.trim();
    if (!v) return;
    journal.push({ t, who: 'NOTE', text: v, cls: 'note' });
    $<HTMLInputElement>('iosNote').value = '';
    broadcast();
    renderJournal();
  };
  $<HTMLInputElement>('iosNote').onkeydown = (e) => e.key === 'Enter' && $('iosNoteAdd').click();

  // ---------- overview: KPIs, objectives, timeline ----------
  function renderOverview(st: SimState) {
    if (!sc) return;
    const side = (s: 'friend' | 'hostile') => {
      const u = st.units.filter((x) => sideOf(x.sidc) === s && !x.unit.air);
      return Math.round((100 * u.reduce((a, x) => a + x.strength, 0)) / Math.max(1, u.length));
    };
    const fired = mel.filter((m) => m.status === 'fired' && m.kind !== 'SCENARIO');
    const answered = fired.filter((m) => t >= m.firedAt! + m.response!);
    const avgRt = answered.length ? answered.reduce((a, m) => a + m.response!, 0) / answered.length : 0;
    const msgs = (sc.events ?? []).filter((e) => e.type === 'message' && e.t <= t) as { text: string }[];
    const seized = msgs.filter((m) => /SEIZED/.test(m.text)).length;
    const kpi = [
      ['Friendly strength', `${side('friend')}%`, side('friend') > 60 ? 'ok' : 'warn'],
      ['Opposing strength', `${side('hostile')}%`, ''],
      ['Objectives seized', `${seized}`, seized ? 'ok' : ''],
      ['Events run', `${fired.length}`, ''],
      ['Avg response time', answered.length ? fmtRt(avgRt) : '—', avgRt > 3 ? 'warn' : 'ok'],
      ['Awaiting response', `${fired.length - answered.length}`, fired.length - answered.length > 1 ? 'warn' : ''],
    ];
    $('iosKpi').innerHTML = kpi.map(([l, v, c]) => `<div class="kpi ${c}"><div class="kv">${v}</div><div class="kl">${l}</div></div>`).join('');
    const objs: [string, boolean, boolean][] = [
      ['Synchronise fires with the manoeuvre (H-hour)', msgs.some((m) => /H-HOUR/.test(m.text)), true],
      ['Report first contact within 5 minutes', msgs.some((m) => /CONTACT/.test(m.text)), true],
      ['Respond to all training events within 3 minutes', answered.length > 0 && avgRt <= 3, answered.length > 0],
      ['Seize the brigade objectives', seized > 0, true],
      ['Defeat the enemy counterattack', msgs.some((m) => /COUNTERATTACK/i.test(m.text)) && side('hostile') < 60, msgs.some((m) => /COUNTERATTACK/i.test(m.text))],
      ['Keep friendly strength above 60 %', side('friend') >= 60, t > 0],
    ];
    $('iosObj').innerHTML = objs.map(([o, done, eval_]) => `<div class="obj ${done ? 'done' : eval_ ? 'open' : 'na'}"><span class="ob">${done ? '✔' : eval_ ? '◷' : '○'}</span>${o}</div>`).join('');
    // timeline
    const c = $<HTMLCanvasElement>('iosTl');
    const r = c.parentElement!.getBoundingClientRect();
    const W = Math.max(200, Math.round(r.width - 16)), H = Math.max(60, Math.round(r.height - 34));
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    const T = sc.meta.durationMin;
    const X = (x: number) => 60 + ((W - 70) * x) / T;
    g.strokeStyle = '#e5e9f0';
    g.fillStyle = '#6b7a8c';
    g.font = '11px Segoe UI';
    for (let x = 0; x <= T; x += 30) {
      g.beginPath();
      g.moveTo(X(x), 4);
      g.lineTo(X(x), H - 14);
      g.stroke();
      g.fillText(fmtT(x), X(x) - 12, H - 3);
    }
    const lanes: [string, (m: MelItem) => boolean, string][] = [
      ['Mission', (m) => m.kind === 'SCENARIO', '#4f46e5'],
      ['Training', (m) => m.kind !== 'SCENARIO', '#d97706'],
    ];
    lanes.forEach(([lab, f, col], li) => {
      const y = 12 + li * ((H - 30) / 2) + 6;
      g.fillStyle = '#1f2a37';
      g.fillText(lab, 2, y + 4);
      for (const m of mel.filter(f)) {
        const tt = m.firedAt ?? m.t;
        if (tt < 0) continue;
        g.fillStyle = m.status === 'fired' ? col : m.status === 'skipped' ? '#cbd5e1' : '#94a3b8';
        g.beginPath();
        g.arc(X(tt), y, m.status === 'fired' ? 5 : 3.5, 0, 7);
        g.fill();
        if (m.response && m.status === 'fired') {
          g.fillStyle = 'rgba(14,159,142,0.55)';
          g.fillRect(X(tt), y + 6, Math.max(2, X(tt + m.response) - X(tt)), 3);
        }
      }
    });
    g.strokeStyle = '#4f46e5';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(t), 2);
    g.lineTo(X(t), H - 14);
    g.stroke();
    g.lineWidth = 1;
  }

  // ---------- effects of injects on the views ----------
  function renderEffects() {
    $('iosFogLayer').style.opacity = effects.has('fog') ? '1' : '0';
    const tags: string[] = [];
    if (effects.has('gps')) tags.push('GNSS DEGRADED');
    if (effects.has('comms')) tags.push('BDE NET JAMMED');
    if (effects.has('samradar')) tags.push('SAM RADAR ACTIVE');
    if (effects.has('fog')) tags.push('VIS 800 m');
    $('iosEffects').innerHTML = tags.map((x) => `<span>${x}</span>`).join('');
  }

  // ---------- render ----------
  let lastSlow = 0;
  function renderAll(force = false) {
    if (!sc || !sim) return;
    const st = sim.stateAt(t, {});
    godMap.fog = $<HTMLInputElement>('iosFog').checked;
    godMap.update(sim.stateAt(t, { fog: godMap.fog, trailMin: 30 }));
    copMap.update(sim.stateAt(t, { fog: true }));
    // threat rings around enemy air defence units (bigger when the SAM radar inject is live)
    if ($<HTMLInputElement>('iosRings').checked) {
      const feats = st.units
        .filter((u) => sideOf(u.sidc) === 'hostile' && u.sidc.slice(10, 14) === '1301' && u.status !== 'destroyed')
        .map((u) => ({ type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [circle(u.pos, effects.has('samradar') ? 9 : 5)] }, properties: {} }));
      ringSrc().setData({ type: 'FeatureCollection', features: feats });
    } else ringSrc().setData({ type: 'FeatureCollection', features: [] });
    const now = performance.now();
    if (force || now - lastSlow > 400) {
      lastSlow = now;
      renderMel();
      renderJournal();
      renderOverview(st);
      renderEffects();
    }
    const start = new Date(sc.meta.start).getTime();
    $('iosDtg').textContent = dtg(new Date(start + t * 60000));
    $('iosT').textContent = `T+${fmtT(t)}`;
    $<HTMLInputElement>('iosTime').value = String(t);
    $('iosState').textContent = playing ? '● Running' : '❚❚ Paused';
    $('iosState').className = 'iosState ' + (playing ? 'run' : 'frz');
    $('iosRun').textContent = playing ? '❚❚ Pause' : '▶ Resume';
  }

  // ---------- clock ----------
  let last = 0;
  function loop(ts: number) {
    const dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    if (sc && playing && !follower) {
      t = Math.min(sc.meta.durationMin, t + dt * BASE_SPEED * Number($<HTMLSelectElement>('iosScale').value));
      if (t >= sc.meta.durationMin) playing = false;
      for (const m of mel) if ((m.trigger === 'time' || m.trigger === 'condition') && m.status === 'pending' && m.t >= 0 && t >= m.t) fire(m, false, m.t);
    }
    if (sc) {
      renderAll();
      // trainee repeaters
      const vt = ts / 1000;
      reps.forEach((r, i) => {
        if (i === 0 && effects.has('sensor')) r.params.noise = 80;
        if (r.due(t, ts, playing) && sim) r.renderLive(sc!, sim, t, vt);
      });
      $('iosWall').textContent = new Date().toISOString().slice(11, 19) + ' LOCAL SYS';
    }
    if (!follower && ts - lastBc > 250) broadcast();
    requestAnimationFrame(loop);
  }
  let lastBc = 0;
  function broadcast() {
    lastBc = performance.now();
    bc?.postMessage({ t, playing, mel: mel.map((m) => [m.id, m.status, m.firedAt]), journal, effects: [...effects], mission: $<HTMLSelectElement>('iosMission').value });
  }
  if (follower && bc) {
    bc.onmessage = async (e) => {
      const d = e.data;
      if (d.mission !== $<HTMLSelectElement>('iosMission').value) {
        $<HTMLSelectElement>('iosMission').value = d.mission;
        await loadMission();
      }
      t = d.t;
      playing = d.playing;
      journal = d.journal;
      effects.clear();
      d.effects.forEach((x: string) => effects.add(x));
      for (const [id, st, fa] of d.mel) {
        const m = mel.find((x) => x.id === id);
        if (m) (m.status = st), (m.firedAt = fa);
      }
    };
  }

  $('iosRun').onclick = () => {
    playing = !playing;
    journal.push({ t, who: 'IOS', text: playing ? 'Simulation resumed' : 'Simulation frozen', cls: 'sys' });
    broadcast();
    renderAll(true);
  };
  $('iosStep').onclick = () => {
    playing = false;
    t = Math.min(sc?.meta.durationMin ?? 0, t + 1);
    renderAll(true);
  };
  const catchUp = () => {
    for (const m of mel) if (m.trigger !== 'manual' && m.status === 'pending' && m.t >= 0 && t >= m.t) fire(m, false, m.t);
  };
  $<HTMLInputElement>('iosTime').oninput = () => {
    t = Number($<HTMLInputElement>('iosTime').value);
    catchUp();
    renderAll(true);
  };
  $('iosSnap').onclick = () => {
    const name = `SNAP ${snapshots.length + 1} · T+${fmtT(t)}`;
    snapshots.push({ name, t, mel: structuredClone(mel), journal: structuredClone(journal), effects: [...effects] });
    $<HTMLSelectElement>('iosSnaps').innerHTML = '<option value="">Restore snapshot…</option>' + snapshots.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
    journal.push({ t, who: 'IOS', text: `Snapshot saved (${name})`, cls: 'sys' });
    renderAll(true);
  };
  $<HTMLSelectElement>('iosSnaps').onchange = () => {
    const s = snapshots[Number($<HTMLSelectElement>('iosSnaps').value)];
    if (!s) return;
    t = s.t;
    mel = structuredClone(s.mel);
    journal = structuredClone(s.journal);
    effects.clear();
    s.effects.forEach((x) => effects.add(x));
    journal.push({ t, who: 'IOS', text: `Snapshot restored (${s.name})`, cls: 'sys' });
    playing = false;
    $<HTMLSelectElement>('iosSnaps').value = '';
    renderAll(true);
  };

  // ---------- monitors ----------
  const applyMon = () => {
    const two = $<HTMLSelectElement>('iosMon').value === '2';
    root.classList.toggle('dual', two && !follower);
    root.classList.toggle('single', !two && !follower);
    root.classList.toggle('follower', follower);
    setTimeout(() => (godMap.map.resize(), copMap.map.resize()), 50);
  };
  $<HTMLSelectElement>('iosMon').onchange = applyMon;
  $('iosPop').onclick = () => {
    window.open(`${location.pathname}?module=ios&monitor=2`, 'pegasus-ios-m2', 'width=1600,height=900');
    $<HTMLSelectElement>('iosMon').value = '1';
    applyMon();
  };
  new ResizeObserver(() => (godMap.map.resize(), copMap.map.resize())).observe($('iosMonitors'));

  // ---------- recording (screen capture of a monitor) ----------
  let rec: { r: MediaRecorder; chunks: Blob[]; stream: MediaStream; mime: string } | null = null;
  $('iosRec').onclick = async () => {
    if (rec) return;
    const tgt = $<HTMLSelectElement>('iosRecTarget').value;
    const el = tgt === 'm1' ? $('mon1') : tgt === 'm2' ? $('mon2') : $('iosMonitors');
    const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
    const [track] = stream.getVideoTracks();
    try {
      if ((window as any).CropTarget && track.cropTo) await track.cropTo(await (window as any).CropTarget.fromElement(el));
    } catch {
      /* full tab */
    }
    const mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4;codecs=avc1' : 'video/webm;codecs=vp9';
    const r = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.start(1000);
    rec = { r, chunks, stream, mime };
    $('iosRec').classList.add('recording');
    $<HTMLButtonElement>('iosStop').disabled = false;
    track.addEventListener('ended', () => $('iosStop').click());
  };
  $('iosStop').onclick = async () => {
    if (!rec) return;
    const x = rec;
    rec = null;
    await new Promise<void>((res) => ((x.r.onstop = () => res()), x.r.stop()));
    x.stream.getTracks().forEach((k) => k.stop());
    $('iosRec').classList.remove('recording');
    $<HTMLButtonElement>('iosStop').disabled = true;
    const blob = new Blob(x.chunks, { type: x.mime.split(';')[0] });
    await saveOutput(blob, `ios_${$<HTMLSelectElement>('iosRecTarget').value}_T${Math.round(t)}.${x.mime.includes('mp4') ? 'mp4' : 'webm'}`, 'Instructor station recording');
  };

  (window as any).sccIOS = {
    get t() {
      return t;
    },
    setTime: (x: number) => ((t = x), catchUp(), renderAll(true)),
    exec: (id: string) => {
      const m = mel.find((x) => x.id === id);
      if (m) fire(m, true);
      renderAll(true);
    },
    mel: () => mel,
    freeze: () => ((playing = false), renderAll(true)),
    get ready() {
      return !!sc;
    },
  };

  applyMon();
  if (follower) root.querySelector('#mon1')!.remove();
  await loadMission();
  requestAnimationFrame(loop);
  void toMgrs;
}
