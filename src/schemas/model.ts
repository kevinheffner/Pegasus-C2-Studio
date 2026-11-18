/**
 * Schema projects: each project holds images and animations (items), a project style, per-item style overrides,
 * the prompt they came from, and how each item goes into a Video Studio storyboard (scene, section, narration).
 * Stored on the dev server (schemas/projects/*.json) with a browser fallback; user blueprints in schemas/blueprints/.
 */
import { THEMES, DEFAULT_FX, VW, type Caption, type Icon, type Schema, type SLink, type SNode, type Theme } from './engine';
import { SCHEMAS } from './library';

export interface VsTarget {
  /** scene number (1, 2…) or scene title in the Video Studio storyboard; empty = new scene at the end */
  scene: string;
  /** section number within the scene (optional) */
  section: string;
  /** append the narration to the scene's narration, replace it, or create a new scene */
  mode: 'append' | 'replace' | 'new';
  /** narration text sent to the Video Studio; null = the item's captions */
  narration: string | null;
}

export interface SchemaItem {
  id: string;
  kind: 'animation' | 'image';
  /** for images: the moment of the animation to capture (s); default the end */
  imageAt?: number;
  schema: Schema;
  /** style override for this item (null = project style) */
  style: Theme | null;
  prompt?: string;
  vs: VsTarget;
}

export interface SchemaProject {
  format: 'pegasus-schema-project';
  version: 1;
  id: string;
  name: string;
  description: string;
  prompt: string;
  style: Theme;
  items: SchemaItem[];
  created: string;
  updated: string;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'project';

export function newProject(name: string, description = '', prompt = ''): SchemaProject {
  const now = new Date().toISOString();
  return { format: 'pegasus-schema-project', version: 1, id: `${slug(name)}-${uid().slice(0, 5)}`, name, description, prompt, style: clone(THEMES[0]), items: [], created: now, updated: now };
}
export function newItem(schema: Schema, prompt = ''): SchemaItem {
  return { id: uid(), kind: 'animation', schema: clone(schema), style: null, prompt, vs: { scene: '', section: '', mode: 'append', narration: null } };
}
/** the effective style of an item */
export const styleOf = (p: SchemaProject, it: SchemaItem | null): Theme => {
  const s = it?.style ?? p.style;
  return { ...s, fx: { ...DEFAULT_FX, ...(s.fx ?? {}) } };
};
export const narrationOf = (it: SchemaItem) => it.vs.narration ?? it.schema.captions.map((c) => c.text).join(' ');

// ---------------------------------------------------------------- storage
const LS = 'scc-schema-projects';
const lsAll = (): Record<string, SchemaProject> => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}');
  } catch {
    return {};
  }
};
export async function listProjects(): Promise<{ id: string; name: string; description: string; updated: string; count?: number }[]> {
  try {
    const r = await fetch('/api/schema-projects');
    if (r.ok) return await r.json();
  } catch {
    /* offline */
  }
  return Object.values(lsAll()).map((p) => ({ id: p.id, name: p.name, description: p.description, updated: p.updated, count: p.items.length }));
}
export async function loadProject(id: string): Promise<SchemaProject | null> {
  try {
    const r = await fetch(`/api/schema-projects/${encodeURIComponent(id)}`);
    if (r.ok) return await r.json();
  } catch {
    /* offline */
  }
  return lsAll()[id] ?? null;
}
export async function saveProject(p: SchemaProject): Promise<boolean> {
  p.updated = new Date().toISOString();
  try {
    const all = lsAll();
    all[p.id] = p;
    localStorage.setItem(LS, JSON.stringify(all));
  } catch {
    /* quota: large background images */
  }
  try {
    const r = await fetch(`/api/schema-projects/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify(p) });
    return r.ok;
  } catch {
    return false;
  }
}
export async function deleteProject(id: string) {
  const all = lsAll();
  delete all[id];
  try {
    localStorage.setItem(LS, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  await fetch(`/api/schema-projects/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
}

// ---------------------------------------------------------------- blueprints (built-in + user-saved / edited)
export interface Blueprint {
  id: string;
  schema: Schema;
  builtin: boolean;
  /** a user copy that overrides a built-in blueprint of the same id */
  edited?: boolean;
}
export async function listBlueprints(): Promise<Blueprint[]> {
  let user: Schema[] = [];
  try {
    const r = await fetch('/api/schema-blueprints');
    if (r.ok) {
      const ids: { id: string }[] = await r.json();
      user = (await Promise.all(ids.map((x) => fetch(`/api/schema-blueprints/${x.id}`).then((q) => (q.ok ? q.json() : null))))).filter(Boolean);
    }
  } catch {
    /* offline */
  }
  const out: Blueprint[] = SCHEMAS.map((s) => {
    const u = user.find((x) => x.id === s.id);
    return u ? { id: s.id, schema: u, builtin: true, edited: true } : { id: s.id, schema: s, builtin: true };
  });
  for (const u of user) if (!SCHEMAS.some((s) => s.id === u.id)) out.push({ id: u.id, schema: u, builtin: false });
  return out;
}
export async function saveBlueprint(s: Schema) {
  const r = await fetch(`/api/schema-blueprints/${encodeURIComponent(s.id)}`, { method: 'PUT', body: JSON.stringify(s) });
  return r.ok;
}
export async function deleteBlueprint(id: string) {
  await fetch(`/api/schema-blueprints/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- prompt → schema
export type LayoutKind = 'auto' | 'flow' | 'cycle' | 'hub' | 'layers' | 'columns';

const ICONS: [RegExp, Icon][] = [
  [/\b(c2|command|hq|headquarters|cop)\b/i, 'c2'],
  [/\b(server|rti|bus|broker|gateway)\b/i, 'server'],
  [/\b(sim|simulation|simulator|cgf|model)\w*/i, 'sim'],
  [/\b(staff|team|cell|audience|people|users?|trainees?|learners?|instructor|partners?|affiliates?)\b/i, 'people'],
  [/\b(network|mission network|federation|fmn|links?)\b/i, 'net'],
  [/\b(data|database|logger|log|archive|repository)\b/i, 'db'],
  [/\b(air|aircraft|flight|uav|drone)\b/i, 'plane'],
  [/\b(ship|maritime|naval|sea)\b/i, 'ship'],
  [/\b(tank|land|army|ground|armou?r)\b/i, 'tank'],
  [/\b(report|document|order|plan|standard|stanag|spec|agreement|message)\w*/i, 'doc'],
  [/\b(clock|time|schedule|timeline|session)\b/i, 'clock'],
  [/\b(review|analys\w*|chart|metric|evaluat\w*|aar|kpi)\b/i, 'chart'],
  [/\b(secur\w*|shield|verif\w*|test\w*|valid\w*|certif\w*)\b/i, 'shield'],
  [/\b(world|global|coalition|nato|nation\w*)\b/i, 'globe'],
  [/\b(observ\w*|monitor\w*|view\w*|watch)\b/i, 'eye'],
  [/\b(goal|objective|target|outcome|effect)\w*/i, 'target'],
  [/\b(radio|comms|communication\w*)\b/i, 'radio'],
  [/\b(learn\w*|course|training|education|book|guide)\b/i, 'book'],
  [/\b(process|step|configur\w*|tool|engine|service)\w*/i, 'gear'],
];
const iconFor = (s: string): Icon => ICONS.find(([re]) => re.test(s))?.[1] ?? 'cube';

const TOPICS: [RegExp, string][] = [
  [/session state|state machine|initiali[sz]ing|paused/i, 'c2sim-states'],
  [/ontolog|xsd|xml schema|\blox\b|\bsmx\b/i, 'c2sim-ontology'],
  [/c2sim|c2 ?-?sim|command and control to simulation/i, 'c2sim-overview'],
  [/netn|fom module|federation object model/i, 'netn-fom'],
  [/\bhla\b|high level architecture|\brti\b|federate/i, 'hla-federation'],
  [/dseep|ieee 1730|engineering process/i, 'dseep'],
  [/\bfmn\b|federated mission network/i, 'fmn'],
  [/\bcax\b|command post exercise|staff training|computer.assisted/i, 'cax-staff-training'],
  [/rehears|course of action|wargam/i, 'mission-rehearsal'],
  [/\blvc\b|live,? virtual|constructive/i, 'lvc'],
  [/interoperability level|lcim|levels of (conceptual )?interop/i, 'interop-levels'],
];

const sentences = (s: string) => s.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

interface Parsed {
  title?: string;
  subtitle?: string;
  layout?: LayoutKind;
  duration?: number;
  items: { label: string; sub: string; group?: string }[];
  links: { a: string; b: string; label?: string }[];
  narration: string[];
  message?: string;
  free: string;
}
function parse(text: string): Parsed {
  const P: Parsed = { items: [], links: [], narration: [], free: '' };
  let group: string | undefined;
  const free: string[] = [];
  const addItem = (label: string, sub = '') => {
    label = label.trim();
    if (!label) return;
    if (!P.items.some((i) => i.label.toLowerCase() === label.toLowerCase())) P.items.push({ label, sub: sub.trim(), group });
  };
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^title\s*:\s*(.+)$/i))) P.title = m[1].trim();
    else if ((m = l.match(/^sub-?title\s*:\s*(.+)$/i))) P.subtitle = m[1].trim();
    else if ((m = l.match(/^layout\s*:\s*(\w+)/i))) P.layout = m[1].toLowerCase() as LayoutKind;
    else if ((m = l.match(/^duration\s*:\s*(\d+)/i))) P.duration = Number(m[1]);
    else if ((m = l.match(/^(group|column)\s*:\s*(.+)$/i))) group = m[2].trim();
    else if ((m = l.match(/^(narration|caption|say)\s*:\s*(.+)$/i))) P.narration.push(m[2].trim());
    else if ((m = l.match(/^(message|key message|takeaway)\s*:\s*(.+)$/i))) P.message = m[2].trim();
    else if ((m = l.match(/^(items?|boxes|elements|steps|layers)\s*:\s*(.+)$/i))) m[2].split(/[;,]/).forEach((x) => addItem(x));
    else if ((m = l.match(/^(?:[-*•]|\d+[.)])?\s*(.+?)\s*(?:->|→|=>)\s*(.+?)(?:\s*[:(]\s*([^)]+)\)?)?$/))) {
      // arrows: A -> B : label   (chains A -> B -> C allowed)
      const parts = l.replace(/^(?:[-*•]|\d+[.)])\s*/, '').split(/\s*(?:->|→|=>)\s*/);
      let label: string | undefined;
      const lastM = parts[parts.length - 1].match(/^(.+?)\s*(?::|\()\s*([^)]+)\)?$/);
      if (lastM) (parts[parts.length - 1] = lastM[1]), (label = lastM[2].trim());
      parts.forEach((x) => addItem(x));
      for (let i = 0; i + 1 < parts.length; i++) P.links.push({ a: parts[i].trim(), b: parts[i + 1].trim(), label });
    } else if ((m = l.match(/^(?:[-*•]|\d+[.)])\s*(.+?)(?:\s*(?::|—|–| - )\s*(.+))?$/))) addItem(m[1], m[2] ?? '');
    else free.push(l);
  }
  P.free = free.join(' ');
  if (!P.items.length) {
    // a list in the free text: "… A, B, C and D …"
    const lists = P.free.match(/([A-Z0-9][\w\s/&-]{1,40}(?:,\s*[\w\s/&-]{1,40}){2,}(?:,?\s*(?:and|or)\s+[\w\s/&-]{1,40}))/g);
    const best = lists?.sort((a, b) => b.length - a.length)[0];
    if (best) best.split(/,\s*|\s+(?:and|or)\s+/).forEach((x) => addItem(cap(x.replace(/^(the|a|an)\s+/i, '').trim())));
  }
  return P;
}

/** generate a schema from a prompt (offline: topic templates, or a layout built from the items it lists) */
export function generateFromPrompt(prompt: string, o: { layout: LayoutKind; duration?: number; blueprints: Blueprint[] }): { schema: Schema; note: string } {
  const P = parse(prompt);
  const sents = sentences(P.free);
  const title = P.title ?? (sents[0] ? cap(sents[0].replace(/[.!?]$/, '').replace(/^(show|explain|illustrate|describe|create|make)\s+(how\s+|that\s+|the\s+)?/i, '')).slice(0, 70) : 'New schema');
  const topic = P.items.length < 2 ? TOPICS.find(([re]) => re.test(prompt))?.[1] : undefined;
  if (topic) {
    const bp = o.blueprints.find((b) => b.id === topic);
    if (bp) {
      const s = clone(bp.schema);
      s.id = `${topic}-${uid().slice(0, 4)}`;
      if (P.title) s.title = P.title;
      if (P.subtitle) s.subtitle = P.subtitle;
      if (P.narration.length) s.captions = spread(P.narration, s.duration);
      if (P.message) s.captions.push({ t: Math.max(0, s.duration - 6), text: P.message });
      return { schema: s, note: `Started from the “${bp.schema.title}” blueprint${P.narration.length ? ' with your narration' : ''}. Edit the texts, layout and narration as needed.` };
    }
  }
  let items = P.items;
  if (items.length < 2) items = ['Input', 'Process', 'Output'].map((label) => ({ label, sub: '' }));
  items = items.slice(0, 12);
  const words = `${prompt}`.toLowerCase();
  let layout: LayoutKind = P.layout ?? o.layout;
  if (layout === 'auto') layout = items.some((i) => i.group) ? 'columns' : /cycle|loop|iterat|repeat|continuous/.test(words) ? 'cycle' : /layer|level|stack|tier/.test(words) ? 'layers' : /hub|central|server|bus|connect|around|joins?/.test(words) ? 'hub' : 'flow';
  const n = items.length;
  const dt = Math.max(1.2, Math.min(3, 18 / n));
  const nodes: SNode[] = [];
  const links: SLink[] = [];
  const mk = (i: number, x: number, y: number, w: number, h: number, extra: Partial<SNode> = {}): SNode => ({ id: 'n' + i, x: Math.round(x), y: Math.round(y), w, h, label: items[i].label, sub: items[i].sub || undefined, icon: iconFor(items[i].label + ' ' + items[i].sub), c: i % 7, at: 1 + i * dt, ...extra });
  const top = 190, bottom = 930;
  if (layout === 'cycle') {
    const rx = 640, ry = 290, w = 380, h = 120;
    items.forEach((_, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      nodes.push(mk(i, 960 + Math.cos(a) * rx - w / 2, 560 + Math.sin(a) * ry - h / 2, w, h));
      links.push({ a: 'n' + i, b: 'n' + ((i + 1) % n), at: 1.5 + i * dt, bend: 60 });
    });
  } else if (layout === 'hub') {
    nodes.push(mk(0, 960 - 170, 560 - 150, 340, 300, { shape: 'circle', size: 30 }));
    const rest = n - 1;
    const w = 360, h = 120;
    for (let i = 1; i < n; i++) {
      const a = -Math.PI / 2 + ((i - 1) / Math.max(1, rest)) * Math.PI * 2;
      nodes.push(mk(i, 960 + Math.cos(a) * 640 - w / 2, 560 + Math.sin(a) * 300 - h / 2, w, h));
      links.push({ a: 'n' + i, b: 'n0', at: 1.5 + i * dt, two: true });
    }
  } else if (layout === 'layers') {
    const h = Math.min(110, (bottom - top - 20) / n - 14);
    items.forEach((_, i) => nodes.push(mk(i, 260 + i * 30, bottom - 40 - (i + 1) * (h + 14), 1400 - i * 60, h, { shape: 'layer', icon: undefined })));
  } else if (layout === 'columns') {
    const groups = [...new Set(items.map((i) => i.group ?? ''))];
    const cw = (VW - 160 - (groups.length - 1) * 40) / groups.length;
    groups.forEach((gname, gi) => {
      const mine = items.map((it, i) => ({ it, i })).filter((x) => (x.it.group ?? '') === gname);
      const x0 = 80 + gi * (cw + 40);
      if (gname) nodes.push({ id: 'g' + gi, shape: 'group', x: x0, y: top, w: cw, h: bottom - top - 20, label: gname, c: gi % 7, at: 0.5 });
      const h = Math.min(140, (bottom - top - 100) / Math.max(1, mine.length) - 20);
      mine.forEach((m, k) => nodes.push(mk(m.i, x0 + 30, top + 60 + k * (h + 20), cw - 60, h)));
    });
  } else {
    // flow: one row, or two rows (snake) for many items
    const rows = n > 5 ? 2 : 1;
    const per = Math.ceil(n / rows);
    const w = Math.min(330, (VW - 160 - (per - 1) * 60) / per), h = 150;
    items.forEach((_, i) => {
      const r = Math.floor(i / per), c = r % 2 ? per - 1 - (i % per) : i % per;
      const y = rows === 1 ? 480 : 320 + r * 330;
      nodes.push(mk(i, 80 + c * (w + 60) + (VW - 160 - per * w - (per - 1) * 60) / 2, y, w, h));
      if (i) links.push({ a: 'n' + (i - 1), b: 'n' + i, at: 1.5 + i * dt });
    });
  }
  // explicit arrows replace the default links
  if (P.links.length) {
    const idOf = (name: string) => 'n' + items.findIndex((i) => i.label.toLowerCase() === name.toLowerCase());
    links.length = 0;
    P.links.forEach((l, k) => {
      const a = idOf(l.a), b = idOf(l.b);
      if (a !== 'n-1' && b !== 'n-1') links.push({ a, b, label: l.label, at: 1.5 + k * dt });
    });
  }
  const built = 1 + n * dt + 1;
  links.forEach((l, k) => (l.flows = [{ label: l.label && l.label.length < 14 ? l.label.toUpperCase() : undefined, c: k % 7, t0: built + k * 0.7, every: 3 + (k % 3) * 0.5 }]));
  const duration = P.duration ?? o.duration ?? Math.round(Math.max(20, built + 14));
  // narration / captions
  let capText = P.narration;
  if (!capText.length) {
    capText = [];
    if (sents[0]) capText.push(sents[0]);
    for (let i = 0; i < n; i += 2) capText.push(items.slice(i, i + 2).map((x) => (x.sub ? `${x.label}: ${x.sub}` : x.label)).join('; ') + '.');
    sents.slice(1, 3).forEach((s) => capText.push(s));
    if (P.message) capText.push(P.message);
  }
  const captions = spread(capText.slice(0, 9), duration);
  const highlights = captions.map((c, i) => {
    const t1 = captions[i + 1]?.t ?? duration;
    const hit = nodes.filter((nd) => nd.shape !== 'group' && c.text.toLowerCase().includes(nd.label.toLowerCase())).map((x) => x.id);
    return { t0: c.t, t1, ids: hit };
  }).filter((h) => h.ids.length);
  const schema: Schema = {
    id: `${slug(title)}-${uid().slice(0, 4)}`,
    category: 'Project',
    title,
    subtitle: P.subtitle ?? (sents[1] ?? '').slice(0, 110),
    duration,
    description: prompt.slice(0, 300),
    refs: [],
    nodes,
    links,
    captions,
    highlights,
  };
  return { schema, note: `Built a ${layout} layout with ${n} elements${P.links.length ? ` and ${links.length} links from your arrows` : ''}. Drag the boxes in Edit mode, and edit the texts and narration in the Text tab.` };
}
/** spread narration lines over the duration */
export function spread(lines: string[], duration: number): Caption[] {
  const n = lines.length;
  return lines.map((text, i) => ({ t: Math.round((0.5 + (i * (duration - 2)) / Math.max(1, n)) * 10) / 10, text }));
}

export const PROMPT_EXAMPLES: [string, string][] = [
  ['C2SIM for coalition training', 'Show how C2SIM lets national C2 systems exchange orders and reports with simulations in a coalition exercise.\nMessage: one standard, every nation’s systems.'],
  ['Exercise control flow (arrows)', 'Title: How an inject reaches the training audience\nExercise control -> Response cell : inject\nResponse cell -> Simulation : task\nSimulation -> C2 system : report\nC2 system -> Training audience : picture\nNarration: Exercise control plans an inject from the master event list.\nNarration: The response cell turns it into a task for the simulation.\nNarration: The simulation reports back, and the staff see the effect in their own C2 system.'],
  ['Training cycle', 'Layout: cycle\nTitle: The collective training cycle\n- Analyse needs: what the staff must be able to do\n- Design: objectives, scenario and events\n- Prepare: systems, cells and rehearsal\n- Execute: run the exercise\n- Evaluate: AAR and lessons\nMessage: every exercise improves the next one.'],
  ['Simulation services on a hub', 'Layout: hub\nTitle: M&S as a Service on the mission network\nItems: Mission network, Scenario service, Simulation service, Terrain service, Data logging, AAR service\nMessage: services are shared, not rebuilt for every exercise.'],
  ['Columns: who does what', 'Title: Roles in a computer-assisted exercise\nGroup: Training audience\n- Commander\n- Staff\nGroup: Exercise control\n- White cell\n- Response cells\n- OPFOR\nGroup: Support\n- Simulation operators\n- Observer/trainers'],
];
