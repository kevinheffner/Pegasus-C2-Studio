/**
 * Extra Instructor Station views: Observer / evaluator, After-action review, Exercise lifecycle.
 * Inspired by the generic feature set of web-based exercise management tools (event planning, MSEL,
 * observer/evaluator capture, AAR); original layout and content.
 */
import type { Scenario } from '../scenario/types';
import { sideOf, type Simulation } from '../scenario/sim';
import { BUILTIN_PACKAGES } from '../app/library';

export interface ViewCtx {
  sc: () => Scenario | null;
  sim: () => Simulation | null;
  t: () => number;
  setTime: (t: number) => void;
  mel: () => { id: string; t: number; kind: string; title: string; target: string; status: string; firedAt?: number; response?: number }[];
  notes: () => { t: number; who: string; text: string; cls?: string }[];
  addNote: (who: string, text: string, cls: string) => void;
}

const fmt = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
const fmtRt = (x: number) => `${Math.floor(x)}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const LEARNERS = ['Learner 1 · UAV operator', 'Learner 2 · Air defence', 'Learner 3 · EW operator', 'Learner 4 · Battle captain'];
const TASKS: [string, string, number][] = [
  ['Acknowledge and act on injects', 'within 3 min', 0],
  ['Report first contact (SALUTE)', 'within 5 min of contact', 3],
  ['Maintain the common operational picture', 'updated every 10 min', 3],
  ['Coordinate fires with manoeuvre', 'no fratricide, on time', 3],
  ['Identify and report emitters', 'correct ID, within 4 min', 2],
  ['Detect and track air threats', 'track within 2 min', 1],
  ['Sensor management & tasking', 'coverage of named areas', 0],
];

export function createViews(ctx: ViewCtx) {
  // ---------------- Observer / evaluator ----------------
  const obs = document.createElement('div');
  obs.className = 'vgrid obsGrid';
  obs.innerHTML = `
    <div class="pane obsTasks"><div class="paneHead">Task performance <span class="paneSub">trained · practised · untrained</span></div><div class="obsTable"></div></div>
    <div class="pane obsCards"><div class="paneHead">Learner scorecards</div><div class="cards"></div></div>
    <div class="pane obsRt"><div class="paneHead">Response time per training event <span class="paneSub">standard: 3 min</span></div><canvas></canvas></div>
    <div class="pane obsLog"><div class="paneHead">Observations</div><div class="obsList"></div>
      <div class="obsAdd"><select class="obsWho">${LEARNERS.map((l) => `<option>${l}</option>`).join('')}</select>
      <input type="text" class="obsTxt" placeholder="What did you observe?"><button class="obsPlus" title="Strength">＋ Sustain</button><button class="obsMinus" title="Improve">△ Improve</button></div></div>`;
  const obsNotes: { t: number; who: string; text: string; kind: 'sustain' | 'improve' }[] = [];
  const addObs = (kind: 'sustain' | 'improve') => {
    const txt = (obs.querySelector('.obsTxt') as HTMLInputElement).value.trim();
    if (!txt) return;
    const who = (obs.querySelector('.obsWho') as HTMLSelectElement).value;
    obsNotes.push({ t: ctx.t(), who, text: txt, kind });
    ctx.addNote('O/E', `${kind === 'sustain' ? 'Sustain' : 'Improve'} · ${who}: ${txt}`, 'note');
    (obs.querySelector('.obsTxt') as HTMLInputElement).value = '';
    renderObs(true);
  };
  (obs.querySelector('.obsPlus') as HTMLButtonElement).onclick = () => addObs('sustain');
  (obs.querySelector('.obsMinus') as HTMLButtonElement).onclick = () => addObs('improve');
  (obs.querySelector('.obsTxt') as HTMLInputElement).onkeydown = (e) => e.key === 'Enter' && addObs('sustain');

  /** deterministic per-task rating from mission progress + responses */
  function ratings() {
    const t = ctx.t();
    const mel = ctx.mel().filter((m) => m.kind !== 'SCENARIO' && m.status === 'fired' && m.firedAt !== undefined && t >= m.firedAt + (m.response ?? 0));
    const avg = mel.length ? mel.reduce((a, m) => a + (m.response ?? 0), 0) / mel.length : 0;
    return TASKS.map(([task, std, who], i) => {
      const seen = t > 20 + i * 12;
      const base = (Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1;
      const score = !seen ? -1 : Math.max(0, Math.min(1, 0.55 + Math.abs(base) * 0.4 - (i === 0 ? Math.max(0, avg - 2.5) * 0.25 : 0) + Math.min(0.15, t / 1600)));
      return { task, std, who, score, rating: score < 0 ? '—' : score > 0.78 ? 'T' : score > 0.55 ? 'P' : 'U' };
    });
  }
  function renderObs(force = false) {
    if (!force && obs.offsetParent === null) return;
    const R = ratings();
    (obs.querySelector('.obsTable') as HTMLElement).innerHTML = `<table><thead><tr><th>Task</th><th>Standard</th><th>Learner</th><th>Rating</th></tr></thead><tbody>${R.map(
      (r) => `<tr><td>${r.task}</td><td class="muted">${r.std}</td><td>${LEARNERS[r.who].split(' · ')[1]}</td><td><span class="rate r${r.rating}">${r.rating === 'T' ? 'Trained' : r.rating === 'P' ? 'Practised' : r.rating === 'U' ? 'Untrained' : 'Not yet observed'}</span></td></tr>`,
    ).join('')}</tbody></table>`;
    (obs.querySelector('.cards') as HTMLElement).innerHTML = LEARNERS.map((l, i) => {
      const mine = R.filter((r) => r.who === i && r.score >= 0);
      const pct = mine.length ? Math.round((100 * mine.reduce((a, r) => a + r.score, 0)) / mine.length) : 0;
      const n = obsNotes.filter((o) => o.who === l);
      return `<div class="card"><div class="cardName">${l.split(' · ')[1]}</div><div class="cardSub">${l.split(' · ')[0]}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="cardRow"><span>${mine.length ? pct + '%' : '—'}</span><span>＋${n.filter((x) => x.kind === 'sustain').length} · △${n.filter((x) => x.kind === 'improve').length}</span></div></div>`;
    }).join('');
    (obs.querySelector('.obsList') as HTMLElement).innerHTML = obsNotes.length
      ? obsNotes.map((o) => `<div class="ob ${o.kind}"><span class="mono">T+${fmt(o.t)}</span><b>${o.kind === 'sustain' ? '＋' : '△'} ${o.who.split(' · ')[1]}</b> ${esc(o.text)}</div>`).join('')
      : '<div class="muted" style="padding:8px">No observations yet. Type one below and press Sustain or Improve.</div>';
    // response time chart
    const c = obs.querySelector('.obsRt canvas') as HTMLCanvasElement;
    const box = c.parentElement!.getBoundingClientRect();
    const W = Math.max(200, Math.round(box.width - 24)), H = Math.max(80, Math.round(box.height - 52));
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const t = ctx.t();
    const ev = ctx.mel().filter((m) => m.kind !== 'SCENARIO' && m.status === 'fired' && m.firedAt !== undefined);
    const maxV = 5;
    const y = (v: number) => H - 22 - ((H - 34) * v) / maxV;
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.fillStyle = '#776f62';
    g.font = '11px Segoe UI';
    for (let v = 0; v <= maxV; v++) {
      g.beginPath();
      g.moveTo(30, y(v));
      g.lineTo(W, y(v));
      g.stroke();
      g.fillText(`${v}m`, 4, y(v) + 4);
    }
    g.strokeStyle = '#dc2626';
    g.setLineDash([6, 4]);
    g.beginPath();
    g.moveTo(30, y(3));
    g.lineTo(W, y(3));
    g.stroke();
    g.setLineDash([]);
    const bw = Math.min(46, (W - 40) / Math.max(1, ev.length) - 8);
    ev.forEach((m, i) => {
      const done = t >= (m.firedAt ?? 0) + (m.response ?? 0);
      const v = done ? m.response ?? 0 : Math.max(0, t - (m.firedAt ?? 0));
      const x = 40 + i * (bw + 8);
      g.fillStyle = !done ? '#94a3b8' : v > 3 ? '#d97706' : '#0e9f8e';
      g.fillRect(x, y(Math.min(maxV, v)), bw, y(0) - y(Math.min(maxV, v)));
      g.fillStyle = '#2a2f3a';
      g.fillText(m.id.slice(4), x + 2, H - 6);
    });
  }

  // ---------------- After-action review ----------------
  const aar = document.createElement('div');
  aar.className = 'vgrid aarGrid';
  aar.innerHTML = `
    <div class="pane aarChart"><div class="paneHead">How the engagement developed <span class="paneSub">combat strength over time · click to jump</span></div><canvas></canvas></div>
    <div class="pane aarKey"><div class="paneHead">Key moments</div><div class="keyList"></div></div>
    <div class="pane aarQ q1"><div class="paneHead">What was planned?</div><div class="qBody"></div></div>
    <div class="pane aarQ q2"><div class="paneHead">What happened?</div><div class="qBody"></div></div>
    <div class="pane aarQ q3"><div class="paneHead">Why did it happen?</div><div class="qBody"></div></div>
    <div class="pane aarQ q4"><div class="paneHead">How can we improve?</div><div class="qBody"></div></div>`;
  let curve: { t: number; b: number; r: number }[] = [];
  let curveFor: Scenario | null = null;
  const chart = aar.querySelector('.aarChart canvas') as HTMLCanvasElement;
  chart.onclick = (e) => {
    const sc = ctx.sc();
    if (!sc) return;
    const r = chart.getBoundingClientRect();
    ctx.setTime(Math.max(0, Math.min(sc.meta.durationMin, ((e.clientX - r.left - 44) / (r.width - 60)) * sc.meta.durationMin)));
  };
  function renderAar(force = false) {
    const sc = ctx.sc(), sim = ctx.sim();
    if (!sc || !sim || (!force && aar.offsetParent === null)) return;
    if (curveFor !== sc) {
      curveFor = sc;
      curve = [];
      for (let x = 0; x <= sc.meta.durationMin; x += 2) {
        const st = sim.stateAt(x, {});
        const side = (s: string) => {
          const u = st.units.filter((q) => sideOf(q.sidc) === s && !q.unit.air);
          return u.reduce((a, q) => a + q.strength, 0) / Math.max(1, u.length);
        };
        curve.push({ t: x, b: side('friend'), r: side('hostile') });
      }
    }
    const t = ctx.t();
    const box = chart.parentElement!.getBoundingClientRect();
    const W = Math.max(300, Math.round(box.width - 24)), H = Math.max(120, Math.round(box.height - 52));
    if (chart.width !== W || chart.height !== H) (chart.width = W), (chart.height = H);
    const g = chart.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const T = sc.meta.durationMin;
    const X = (x: number) => 44 + ((W - 60) * x) / T;
    const Y = (v: number) => 10 + (H - 34) * (1 - v);
    g.font = '11px Segoe UI';
    g.fillStyle = '#776f62';
    g.strokeStyle = 'rgba(0,0,0,0.1)';
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      g.beginPath();
      g.moveTo(44, Y(v));
      g.lineTo(W - 16, Y(v));
      g.stroke();
      g.fillText(`${Math.round(v * 100)}%`, 6, Y(v) + 4);
    }
    for (let x = 0; x <= T; x += 30) g.fillText(fmt(x), X(x) - 14, H - 6);
    // events
    const msgs = (sc.events ?? []).filter((e) => e.type === 'message') as { t: number; text: string }[];
    const keys = msgs.filter((m) => /H-HOUR|CONTACT|COUNTERATTACK|SEIZED|culminat|Air strike|artillery preparation/i.test(m.text));
    for (const k of keys) {
      g.strokeStyle = 'rgba(79,70,229,0.35)';
      g.beginPath();
      g.moveTo(X(k.t), 8);
      g.lineTo(X(k.t), H - 22);
      g.stroke();
    }
    const line = (key: 'b' | 'r', col: string) => {
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.beginPath();
      curve.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p[key])) : g.moveTo(X(p.t), Y(p[key]))));
      g.stroke();
      g.lineWidth = 1;
    };
    line('b', '#2563eb');
    line('r', '#dc2626');
    g.fillStyle = '#2563eb';
    g.fillText('Friendly', W - 140, 20);
    g.fillStyle = '#dc2626';
    g.fillText('Opposing', W - 80, 20);
    g.strokeStyle = '#2a2f3a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(t), 6);
    g.lineTo(X(t), H - 22);
    g.stroke();
    g.lineWidth = 1;
    (aar.querySelector('.keyList') as HTMLElement).innerHTML = keys
      .map((k) => `<button class="key ${k.t <= t ? 'past' : ''}" data-t="${k.t}"><span class="mono">T+${fmt(k.t)}</span>${esc(k.text.replace(/^[A-Z-]+:\s*/, (s) => s))}</button>`)
      .join('');
    aar.querySelectorAll<HTMLButtonElement>('.key').forEach((b) => (b.onclick = () => ctx.setTime(Number(b.dataset.t))));
    // four AAR questions, filled from the mission and the session
    const at = (x: number) => curve[Math.min(curve.length - 1, Math.round(x / 2))] ?? { b: 1, r: 1 };
    const now = at(t);
    const fired = ctx.mel().filter((m) => m.status === 'fired' && m.kind !== 'SCENARIO');
    const slow = fired.filter((m) => (m.response ?? 0) > 3);
    const notes = ctx.notes().filter((n) => n.cls === 'note' && n.t <= t);
    const q = (cls: string, html: string) => ((aar.querySelector(`.${cls} .qBody`) as HTMLElement).innerHTML = html);
    q('q1', `<p><b>${esc(sc.meta.title ?? sc.meta.name)}</b></p><ul><li>Task: ${esc((sc.meta.title ?? '').split(' · ').slice(1).join(' · ') || 'see order')}</li><li>${keys.length} planned phases and decision points</li><li>${ctx.mel().length} events in the master event list</li></ul>`);
    q('q2', `<ul><li>Friendly strength now <b>${Math.round(now.b * 100)}%</b>, opposing <b>${Math.round(now.r * 100)}%</b></li><li>${keys.filter((k) => k.t <= t).length} of ${keys.length} key moments reached</li><li>${fired.length} training events run</li></ul>`);
    q('q3', `<ul>${slow.length ? slow.map((m) => `<li>${esc(m.title)}: response ${fmtRt(m.response ?? 0)} (standard 3:00)</li>`).join('') : '<li>All responses so far within the standard</li>'}${now.b < 0.6 ? '<li>High friendly losses: review fires synchronisation</li>' : ''}</ul>`);
    q('q4', `<ul>${notes.length ? notes.slice(-4).map((n) => `<li>${esc(n.text)}</li>`).join('') : '<li>Add observations in the Observer / evaluator view; they appear here.</li>'}</ul>`);
  }

  // ---------------- Exercise lifecycle ----------------
  const life = document.createElement('div');
  life.className = 'vgrid lifeGrid';
  const STAGES: [string, string, string[]][] = [
    ['Plan', 'objectives & audience', ['Training objectives agreed', 'Training audience identified', 'Exercise specification issued']],
    ['Design', 'scenario & MSEL', ['Scenario and setting', 'Master event list drafted', 'Evaluation criteria defined']],
    ['Develop', 'systems & rehearsal', ['C2 systems connected', 'Simulation federation tested', 'Response cells rehearsed']],
    ['Conduct', 'execution', ['Start of exercise', 'Events and injects', 'Observation & data capture']],
    ['Evaluate', 'AAR & lessons', ['Hot wash-up', 'After-action review', 'Lessons identified & report']],
  ];
  life.innerHTML = `
    <div class="pane lifeStages"><div class="paneHead">Exercise lifecycle</div><div class="stages">${STAGES.map(
      ([n, s, items], i) => `<div class="stage s${i}" data-i="${i}"><div class="stNum">${i + 1}</div><div class="stName">${n}</div><div class="stSub">${s}</div><ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul></div>`,
    ).join('<div class="stArrow">→</div>')}</div></div>
    <div class="pane lifeSys"><div class="paneHead">Connected systems</div><div class="sysList"></div></div>
    <div class="pane lifeRoles"><div class="paneHead">Participants & roles</div><div class="roles"></div></div>
    <div class="pane lifeLib"><div class="paneHead">Exercise library <span class="paneSub">reusable scenarios & event lists</span></div><div class="lib"></div></div>`;
  (life.querySelector('.roles') as HTMLElement).innerHTML = [
    ['Training audience', 'Brigade staff, 4 learner stations', 'people'],
    ['Exercise control (white cell)', 'Instructor station, MSEL, pacing', 'ctl'],
    ['Response cells', 'Subordinate & higher units (LOCON / HICON)', 'rc'],
    ['Opposing force', 'OPFOR cell driving the enemy', 'op'],
    ['Observer / evaluators', 'Capture performance against standards', 'oe'],
  ]
    .map(([r, d, c]) => `<div class="role ${c}"><b>${r}</b><span>${d}</span></div>`)
    .join('');
  (life.querySelector('.lib') as HTMLElement).innerHTML = BUILTIN_PACKAGES.map((p) => `<div class="libRow"><b>${esc(p.name)}</b><span>${esc(p.description ?? '')}</span><em>${11 + (p.name.length % 7)} events</em></div>`).join('');
  function renderLife(force = false) {
    if (!force && life.offsetParent === null) return;
    const sc = ctx.sc();
    const t = ctx.t();
    const done = sc && t >= sc.meta.durationMin - 0.5;
    const cur = done ? 4 : 3;
    life.querySelectorAll<HTMLElement>('.stage').forEach((e, i) => e.classList.toggle('done', i < cur));
    life.querySelectorAll<HTMLElement>('.stage').forEach((e, i) => e.classList.toggle('cur', i === cur));
    const sys: [string, string, boolean][] = [
      ['C2SIM server', 'orders & reports, session running', true],
      ['Constructive simulation', `${sc?.units.length ?? 0} units simulated`, true],
      ['Brigade C2 system', 'COP, orders, reports', true],
      ['Sensor simulations', 'EO/IR, radar, ESM feeds', true],
      ['Data logger', 'recording for the AAR', true],
      ['Weather service', 'METOC feed (static)', false],
    ];
    (life.querySelector('.sysList') as HTMLElement).innerHTML = sys.map(([n, d, ok]) => `<div class="sys ${ok ? 'ok' : 'warn'}"><i></i><b>${n}</b><span>${d}</span></div>`).join('');
  }

  return {
    views: { obs, aar, life },
    render(force = false) {
      renderObs(force);
      renderAar(force);
      renderLife(force);
    },
    reset() {
      obsNotes.length = 0;
      curveFor = null;
    },
  };
}
