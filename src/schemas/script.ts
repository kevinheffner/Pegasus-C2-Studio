/**
 * Instruction script: a readable, editable text form of a schema. It is generated from the schema (so canvas and text
 * edits always show), and parsed back into a schema (Apply instructions). Elements without a position are arranged by
 * the layout. Prompt commands ("rename X to Y", "make it a cycle"…) are applied to the schema the same way.
 *
 *   Source: prompt | blueprint <id>
 *   Title: …            Subtitle: …     Duration: 30     Layout: flow | cycle | hub | layers | columns
 *   Element n1: Label
 *     sub: second line | icon: c2 | shape: box | colour: 2 | appears: 1.5 | size: 22
 *     at: 110,250 size 480x150
 *   Group g1: Label
 *   Link n1 -> n2: label
 *     appears: 3 | colour: 1 | two-way | dashed | no arrows | curve: 60
 *     message ORDER: from 13 every 3 until 21 colour 0 reverse duration 1.6
 *   Narration 0.5: text
 *   Highlight 6-12: n1, n2
 *   Badge 960,690: text | appears 30 | colour 1
 */
import { VW, type Icon, type Schema, type SLink, type SNode } from './engine';

export type LayoutName = 'flow' | 'cycle' | 'hub' | 'layers' | 'columns';
export const LAYOUTS: LayoutName[] = ['flow', 'cycle', 'hub', 'layers', 'columns'];
const ICONS: Icon[] = ['c2', 'sim', 'server', 'people', 'doc', 'net', 'clock', 'gear', 'shield', 'plane', 'tank', 'ship', 'chart', 'flag', 'globe', 'eye', 'cube', 'radio', 'book', 'target', 'db'];
const COLOUR_NAMES: Record<string, number> = { blue: 0, primary: 0, yellow: 1, amber: 1, orange: 1, green: 2, teal: 2, red: 3, pink: 6, purple: 4, violet: 4, cyan: 5, sky: 5, magenta: 6, rose: 6 };
const num = (v: number) => String(Math.round(v * 100) / 100);

/** extra fields kept with a schema for its instructions */
export interface ScriptMeta {
  source?: string;
  layout?: LayoutName;
}

// ------------------------------------------------------------------ schema → script
export function scriptFromSchema(s: Schema & ScriptMeta): string {
  const L: string[] = ['# Pegasus schema instructions (edit and press Apply instructions)'];
  L.push(`Source: ${s.source ?? 'manual'}`);
  L.push(`Title: ${s.title}`);
  if (s.subtitle) L.push(`Subtitle: ${s.subtitle}`);
  L.push(`Category: ${s.category}`);
  L.push(`Duration: ${num(s.duration)}`);
  if (s.layout) L.push(`Layout: ${s.layout}`);
  if (s.description) L.push(`Description: ${s.description.replace(/\s*\n\s*/g, ' ')}`);
  if (s.drawId) L.push(`Draw: ${s.drawId}`);
  for (const r of s.refs ?? []) L.push(`Reference: ${r}`);
  L.push('');
  for (const n of s.nodes) {
    L.push(`${n.shape === 'group' ? 'Group' : 'Element'} ${n.id}: ${n.label}`);
    const p: string[] = [];
    if (n.sub) p.push(`sub: ${n.sub}`);
    if (n.icon) p.push(`icon: ${n.icon}`);
    if (n.shape && n.shape !== 'group') p.push(`shape: ${n.shape}`);
    if (n.c !== undefined) p.push(`colour: ${n.c}`);
    if (n.at !== undefined) p.push(`appears: ${num(n.at)}`);
    if (n.size) p.push(`size: ${n.size}`);
    if (p.length) L.push('  ' + p.join(' | '));
    L.push(`  at: ${Math.round(n.x)},${Math.round(n.y)} size ${Math.round(n.w)}x${Math.round(n.h)}`);
  }
  if (s.links.length) L.push('');
  for (const l of s.links) {
    L.push(`Link ${l.a} -> ${l.b}${l.label ? ': ' + l.label : ''}`);
    const p: string[] = [];
    if (l.at !== undefined) p.push(`appears: ${num(l.at)}`);
    if (l.c !== undefined) p.push(`colour: ${l.c}`);
    if (l.two) p.push('two-way');
    if (l.dashed) p.push('dashed');
    if (l.none) p.push('no arrows');
    if (l.bend) p.push(`curve: ${l.bend}`);
    if (p.length) L.push('  ' + p.join(' | '));
    for (const f of l.flows ?? [])
      L.push(`  message ${f.label ? f.label : '·'}: from ${num(f.t0)}${f.every !== undefined ? ` every ${num(f.every)}` : ''}${f.until !== undefined ? ` until ${num(f.until)}` : ''}${f.c !== undefined ? ` colour ${f.c}` : ''}${f.dir === -1 ? ' reverse' : ''}${f.dur !== undefined ? ` duration ${num(f.dur)}` : ''}`);
  }
  if (s.captions.length) L.push('');
  for (const c of s.captions) L.push(`Narration ${num(c.t)}: ${c.text}`);
  if (s.highlights?.length) L.push('');
  for (const h of s.highlights ?? []) if (h.ids.length) L.push(`Highlight ${num(h.t0)}-${num(h.t1)}: ${h.ids.join(', ')}`);
  if (s.badges?.length) L.push('');
  for (const b of s.badges ?? []) L.push(`Badge ${Math.round(b.x)},${Math.round(b.y)}: ${b.text}${b.at !== undefined ? ` | appears ${num(b.at)}` : ''}${b.c !== undefined ? ` | colour ${b.c}` : ''}${b.align ? ` | align ${b.align}` : ''}`);
  return L.join('\n') + '\n';
}

// ------------------------------------------------------------------ script → schema
export interface ParseResult {
  schema: (Schema & ScriptMeta) | null;
  errors: string[];
  warnings: string[];
}
export function schemaFromScript(text: string, base?: Schema & ScriptMeta): ParseResult {
  const errors: string[] = [], warnings: string[] = [];
  const s: Schema & ScriptMeta = {
    id: base?.id ?? 'schema', category: base?.category ?? 'Project', title: '', subtitle: '', duration: 30, description: '', refs: [],
    nodes: [], links: [], captions: [], highlights: [], badges: [], drawId: undefined, source: base?.source,
  };
  let cur: { kind: 'node'; n: SNode; placed: boolean } | { kind: 'link'; l: SLink } | null = null;
  const unplaced = new Set<SNode>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const ln = i + 1;
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const indented = /^\s/.test(raw);
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (indented && cur) {
      if (cur.kind === 'node') {
        const n = cur.n;
        if ((m = line.match(/^at:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s+size\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?))?$/i))) {
          n.x = Number(m[1]);
          n.y = Number(m[2]);
          if (m[3]) (n.w = Number(m[3])), (n.h = Number(m[4]));
          unplaced.delete(n);
          return;
        }
        for (const seg of line.split(/\s+\|\s+/)) {
          const kv = seg.match(/^(\w[\w ]*?)\s*:\s*(.*)$/);
          if (!kv) {
            warnings.push(`Line ${ln}: “${seg}” not understood for ${n.id}.`);
            continue;
          }
          const [k, v] = [kv[1].toLowerCase(), kv[2].trim()];
          if (k === 'sub') n.sub = v || undefined;
          else if (k === 'icon') {
            if (ICONS.includes(v as Icon)) n.icon = v as Icon;
            else if (v === 'none' || !v) n.icon = undefined;
            else warnings.push(`Line ${ln}: unknown icon “${v}” (${ICONS.join(', ')}).`);
          } else if (k === 'shape') n.shape = v === 'box' ? undefined : (v as SNode['shape']);
          else if (k === 'colour' || k === 'color') n.c = colourOf(v) ?? n.c;
          else if (k === 'appears') n.at = Number(v) || 0;
          else if (k === 'size') n.size = Number(v) || undefined;
          else warnings.push(`Line ${ln}: unknown property “${k}”.`);
        }
        return;
      }
      const l = cur.l;
      if ((m = line.match(/^message\s+(.*?):\s*(.*)$/i))) {
        const spec = m[2];
        const g = (re: RegExp) => spec.match(re)?.[1];
        l.flows = l.flows ?? [];
        l.flows.push({
          label: m[1] === '·' || m[1] === '-' || !m[1] ? undefined : m[1],
          t0: Number(g(/from\s+(-?[\d.]+)/i) ?? 0),
          every: g(/every\s+([\d.]+)/i) !== undefined ? Number(g(/every\s+([\d.]+)/i)) : undefined,
          until: g(/until\s+([\d.]+)/i) !== undefined ? Number(g(/until\s+([\d.]+)/i)) : undefined,
          c: g(/colou?r\s+(\w+)/i) !== undefined ? colourOf(g(/colou?r\s+(\w+)/i)!) : undefined,
          dir: /\breverse\b/i.test(spec) ? -1 : undefined,
          dur: g(/duration\s+([\d.]+)/i) !== undefined ? Number(g(/duration\s+([\d.]+)/i)) : undefined,
        });
        return;
      }
      for (const seg of line.split(/\s+\|\s+/)) {
        const t = seg.toLowerCase();
        if (t === 'two-way') l.two = true;
        else if (t === 'dashed') l.dashed = true;
        else if (t === 'no arrows') l.none = true;
        else if ((m = seg.match(/^appears:\s*([\d.]+)$/i))) l.at = Number(m[1]);
        else if ((m = seg.match(/^colou?r:\s*(\w+)$/i))) l.c = colourOf(m[1]);
        else if ((m = seg.match(/^curve:\s*(-?[\d.]+)$/i))) l.bend = Number(m[1]);
        else warnings.push(`Line ${ln}: “${seg}” not understood for the link ${l.a} -> ${l.b}.`);
      }
      return;
    }
    cur = null;
    if ((m = line.match(/^(element|group)\s+([\w-]+)\s*:\s*(.*)$/i))) {
      const id = m[2];
      if (s.nodes.some((n) => n.id === id)) errors.push(`Line ${ln}: the id “${id}” is used twice.`);
      const isGroup = m[1].toLowerCase() === 'group';
      const n: SNode = { id, label: m[3].trim(), x: NaN, y: NaN, w: isGroup ? 600 : 360, h: isGroup ? 400 : 130, ...(isGroup ? { shape: 'group' as const } : {}) };
      s.nodes.push(n);
      unplaced.add(n);
      cur = { kind: 'node', n, placed: false };
    } else if ((m = line.match(/^link\s+([\w-]+)\s*(?:->|→)\s*([\w-]+)\s*(?::\s*(.*))?$/i))) {
      const l: SLink = { a: m[1], b: m[2], label: m[3]?.trim() || undefined };
      s.links.push(l);
      cur = { kind: 'link', l };
    } else if ((m = line.match(/^narration\s+(-?[\d.]+)\s*:\s*(.*)$/i))) s.captions.push({ t: Number(m[1]), text: m[2].trim() });
    else if ((m = line.match(/^highlight\s+([\d.]+)\s*-\s*([\d.]+)\s*:\s*(.*)$/i))) s.highlights!.push({ t0: Number(m[1]), t1: Number(m[2]), ids: m[3].split(/\s*,\s*/).filter(Boolean) });
    else if ((m = line.match(/^badge\s+(-?\d+)\s*,\s*(-?\d+)\s*:\s*(.*)$/i))) {
      const parts = m[3].split(/\s+\|\s+/);
      const b = { x: Number(m[1]), y: Number(m[2]), text: parts[0].trim() } as NonNullable<Schema['badges']>[number];
      for (const p of parts.slice(1)) {
        const q = p.match(/^(appears|colou?r|align)\s+(.+)$/i);
        if (!q) continue;
        if (/appears/i.test(q[1])) b.at = Number(q[2]);
        else if (/colou?r/i.test(q[1])) b.c = colourOf(q[2]);
        else b.align = q[2].trim() as 'left' | 'center' | 'right';
      }
      s.badges!.push(b);
    } else if ((m = line.match(/^(source|title|subtitle|category|duration|layout|description|draw|reference)\s*:\s*(.*)$/i))) {
      const [k, v] = [m[1].toLowerCase(), m[2].trim()];
      if (k === 'source') s.source = v;
      else if (k === 'title') s.title = v;
      else if (k === 'subtitle') s.subtitle = v;
      else if (k === 'category') s.category = v || 'Project';
      else if (k === 'duration') s.duration = Math.max(3, Number(v) || 30);
      else if (k === 'layout') {
        if (LAYOUTS.includes(v as LayoutName)) s.layout = v as LayoutName;
        else warnings.push(`Line ${ln}: unknown layout “${v}” (${LAYOUTS.join(', ')}).`);
      } else if (k === 'description') s.description = v;
      else if (k === 'draw') s.drawId = v || undefined;
      else s.refs.push(v);
    } else errors.push(`Line ${ln}: “${line.slice(0, 60)}” is not an instruction.`);
  });
  const ids = new Set(s.nodes.map((n) => n.id));
  s.links = s.links.filter((l) => {
    const ok = ids.has(l.a) && ids.has(l.b);
    if (!ok) errors.push(`The link ${l.a} -> ${l.b} refers to an element that does not exist.`);
    return ok;
  });
  for (const h of s.highlights!) h.ids = h.ids.filter((x) => ids.has(x) || (warnings.push(`Highlight: unknown element “${x}”.`), false));
  if (!s.title) warnings.push('No Title line.');
  s.captions.sort((a, b) => a.t - b.t);
  const placedCount = s.nodes.filter((n) => !unplaced.has(n) && n.shape !== 'group').length;
  if (unplaced.size && placedCount === 0) arrange(s, [...unplaced], s.layout ?? 'flow');
  else if (unplaced.size) {
    // new elements in an existing diagram: a row in the free band at the bottom, not on top of the others
    const list = [...unplaced].filter((n) => n.shape !== 'group');
    const w = Math.min(360, (VW - 160 - (list.length - 1) * 40) / Math.max(1, list.length));
    list.forEach((n, i) => Object.assign(n, { x: Math.round(80 + i * (w + 40) + (VW - 160 - list.length * w - (list.length - 1) * 40) / 2), y: 790, w: Math.round(w), h: 120 }));
    for (const g of [...unplaced].filter((n) => n.shape === 'group')) Object.assign(g, { x: 60, y: 180, w: 1800, h: 740 });
  }
  // default appear times for new elements: after the elements that have one
  let k = 0;
  const last = Math.max(0, ...s.nodes.filter((n) => n.at !== undefined).map((n) => n.at!));
  for (const n of s.nodes) if (n.at === undefined && n.shape !== 'group') n.at = Math.round((last + 1 + 1.5 * k++) * 10) / 10;
  return { schema: errors.length ? null : s, errors, warnings };
}

function colourOf(v: string): number | undefined {
  if (/^\d+$/.test(v)) return Number(v) % 7;
  return COLOUR_NAMES[v.toLowerCase()];
}

// ------------------------------------------------------------------ layout
/** place the given nodes (or all non-group nodes) in one of the standard layouts */
export function arrange(s: Schema, nodes: SNode[] = s.nodes.filter((n) => n.shape !== 'group'), layout: LayoutName = 'flow') {
  const items = nodes.filter((n) => n.shape !== 'group');
  const groups = nodes.filter((n) => n.shape === 'group');
  const n = items.length;
  const top = 190, bottom = 930;
  if (layout === 'cycle') {
    const rx = 640, ry = 290, w = 380, h = 120;
    items.forEach((nd, i) => {
      const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
      Object.assign(nd, { x: Math.round(960 + Math.cos(a) * rx - w / 2), y: Math.round(560 + Math.sin(a) * ry - h / 2), w, h });
      if (nd.shape === 'circle' || nd.shape === 'layer') nd.shape = undefined;
    });
  } else if (layout === 'hub') {
    items.forEach((nd, i) => {
      if (i === 0) return Object.assign(nd, { x: 790, y: 410, w: 340, h: 300, shape: 'circle' as const });
      const a = -Math.PI / 2 + ((i - 1) / Math.max(1, n - 1)) * Math.PI * 2;
      Object.assign(nd, { x: Math.round(960 + Math.cos(a) * 640 - 180), y: Math.round(560 + Math.sin(a) * 300 - 60), w: 360, h: 120 });
      if (nd.shape === 'circle' || nd.shape === 'layer') nd.shape = undefined;
    });
  } else if (layout === 'layers') {
    const h = Math.min(110, (bottom - top - 20) / Math.max(1, n) - 14);
    items.forEach((nd, i) => Object.assign(nd, { x: 260 + i * 30, y: Math.round(bottom - 40 - (i + 1) * (h + 14)), w: 1400 - i * 60, h: Math.round(h), shape: 'layer' as const }));
  } else if (layout === 'columns' && groups.length) {
    const cw = (VW - 160 - (groups.length - 1) * 40) / groups.length;
    groups.forEach((g, gi) => Object.assign(g, { x: Math.round(80 + gi * (cw + 40)), y: top, w: Math.round(cw), h: bottom - top - 20 }));
    // elements are shared out over the columns in order
    const per = Math.ceil(n / groups.length);
    items.forEach((nd, i) => {
      const gi = Math.min(groups.length - 1, Math.floor(i / per)), k = i % per;
      const h = Math.min(140, (bottom - top - 100) / per - 20);
      Object.assign(nd, { x: groups[gi].x + 30, y: Math.round(top + 60 + k * (h + 20)), w: groups[gi].w - 60, h: Math.round(h) });
      if (nd.shape === 'circle' || nd.shape === 'layer') nd.shape = undefined;
    });
  } else {
    const rows = n > 5 ? 2 : 1;
    const per = Math.ceil(n / rows) || 1;
    const w = Math.round(Math.min(330, (VW - 160 - (per - 1) * 60) / per)), h = 150;
    items.forEach((nd, i) => {
      const r = Math.floor(i / per), c = r % 2 ? per - 1 - (i % per) : i % per;
      Object.assign(nd, { x: Math.round(80 + c * (w + 60) + (VW - 160 - per * w - (per - 1) * 60) / 2), y: rows === 1 ? 480 : 320 + r * 330, w, h });
      if (nd.shape === 'circle' || nd.shape === 'layer') nd.shape = undefined;
    });
    groups.forEach((g, i) => Object.assign(g, { x: 60 + i * 40, y: 200 + i * 30, w: 1800 - i * 80, h: 700 }));
  }
}

// ------------------------------------------------------------------ prompt commands
export interface CommandResult {
  applied: string[];
  unknown: string[];
}
const ICON_WORDS = ICONS.join('|');
/** apply edit commands (one per line or sentence) to a schema in place */
export function applyCommands(s: Schema & ScriptMeta, text: string): CommandResult {
  const applied: string[] = [], unknown: string[] = [];
  const find = (name: string): SNode | undefined => {
    const q = name.trim().replace(/^["'“”]|["'“”]$/g, '').toLowerCase();
    return s.nodes.find((n) => n.id.toLowerCase() === q) ?? s.nodes.find((n) => n.label.toLowerCase() === q) ?? s.nodes.find((n) => n.label.toLowerCase().includes(q));
  };
  const newId = (base: string) => {
    let id = base.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'n';
    while (s.nodes.some((n) => n.id === id)) id += '2';
    return id;
  };
  const cmds = text.split(/\r?\n|(?<=\.)\s+(?=[A-Z])/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean);
  for (const c of cmds) {
    let m: RegExpMatchArray | null;
    const ok = (msg: string) => applied.push(msg);
    if ((m = c.match(/^(?:title|set (?:the )?title(?: to)?)\s*:?\s+(.+)$/i))) (s.title = m[1]), ok(`Title set to “${m[1]}”`);
    else if ((m = c.match(/^(?:subtitle|set (?:the )?subtitle(?: to)?)\s*:?\s+(.+)$/i))) (s.subtitle = m[1]), ok(`Subtitle set`);
    else if ((m = c.match(/^(?:duration|length|make it)\s*:?\s*(\d+)\s*(?:s|sec|seconds)?(?: long)?$/i))) {
      const d = Number(m[1]), k = d / s.duration;
      retime(s, k);
      s.duration = d;
      ok(`Length set to ${d} s (timings scaled ×${num(k)})`);
    } else if ((m = c.match(/^(?:layout\s*:?|make it (?:a|an)?|use (?:a|an)?|arrange (?:it )?(?:as|in) (?:a|an)?)\s*(flow|cycle|hub|layers?|columns?)(?: layout)?$/i))) {
      const lay = (m[1].toLowerCase().replace(/s$/, '') === 'layer' ? 'layers' : m[1].toLowerCase().replace(/^column$/, 'columns')) as LayoutName;
      s.layout = lay;
      arrange(s, undefined, lay);
      ok(`Arranged as ${lay}`);
    } else if ((m = c.match(/^(?:rename|change)\s+(.+?)\s+(?:to|into)\s+(.+)$/i))) {
      const n = find(m[1]);
      if (n) (ok(`“${n.label}” renamed to “${m[2]}”`), (n.label = m[2].replace(/^["'“”]|["'“”]$/g, '')));
      else unknown.push(`${c} (no element “${m[1]}”)`);
    } else if ((m = c.match(/^(?:describe|sub(?:title)? of|second line of)\s+(.+?)\s*(?:as|:)\s*(.+)$/i))) {
      const n = find(m[1]);
      if (n) (n.sub = m[2]), ok(`Second line of “${n.label}” set`);
      else unknown.push(`${c} (no element “${m[1]}”)`);
    } else if ((m = c.match(/^add\s+(?:an?\s+)?(?:element|box)?\s*(.+?)(?:\s*:\s*(.+?))?(?:\s+(after|before|between)\s+(.+?))?$/i)) && !/^add narration/i.test(c)) {
      const label = m[1].replace(/^["'“”]|["'“”]$/g, '');
      const ref = m[4] ? find(m[4].split(/\s+and\s+/)[0]) : undefined;
      const id = newId(label);
      const nd: SNode = { id, label, sub: m[2], x: 0, y: 0, w: 360, h: 130, icon: 'cube', c: s.nodes.length % 7, at: (ref?.at ?? s.duration * 0.6) + 0.5 };
      if (ref) Object.assign(nd, { x: ref.x + (m[3] === 'before' ? -ref.w - 80 : ref.w + 80), y: ref.y, w: ref.w, h: ref.h, shape: ref.shape === 'circle' ? undefined : ref.shape });
      // keep it inside the frame: beside the reference if there is room, else below (or above) it
      if (ref && (nd.x < 20 || nd.x + nd.w > VW - 20)) Object.assign(nd, { x: Math.min(Math.max(20, ref.x), VW - 20 - nd.w), y: ref.y + ref.h + 60 > 930 - nd.h ? ref.y - nd.h - 60 : ref.y + ref.h + 60 });
      if (!ref) Object.assign(nd, { x: 780, y: 760 });
      nd.x = Math.round(Math.min(Math.max(20, nd.x), VW - 20 - nd.w));
      nd.y = Math.round(Math.min(Math.max(170, nd.y), 940 - nd.h));
      s.nodes.push(nd);
      if (ref && m[3] === 'after') s.links.push({ a: ref.id, b: id, at: nd.at });
      if (ref && m[3] === 'before') s.links.push({ a: id, b: ref.id, at: nd.at });
      if (ref && m[3] === 'between') {
        const other = find(m[4].split(/\s+and\s+/)[1] ?? '');
        if (other) {
          s.links = s.links.filter((l) => !(l.a === ref.id && l.b === other.id));
          s.links.push({ a: ref.id, b: id, at: nd.at }, { a: id, b: other.id, at: nd.at });
          Object.assign(nd, { x: Math.round((ref.x + other.x) / 2), y: Math.round((ref.y + other.y) / 2) + 170 });
        }
      }
      ok(`Added “${label}”${ref ? ` ${m[3]} “${ref.label}”` : ''}`);
    } else if ((m = c.match(/^(?:remove|delete)\s+(?:the\s+)?(?:element|box)?\s*(.+)$/i)) && !/narration/i.test(c)) {
      const n = find(m[1]);
      if (n) {
        s.nodes = s.nodes.filter((x) => x !== n);
        s.links = s.links.filter((l) => l.a !== n.id && l.b !== n.id);
        for (const h of s.highlights ?? []) h.ids = h.ids.filter((x) => x !== n.id);
        ok(`Removed “${n.label}”`);
      } else unknown.push(`${c} (no element “${m[1]}”)`);
    } else if ((m = c.match(/^(?:link|connect)\s+(.+?)\s+(?:to|->|→|with)\s+(.+?)(?:\s*:\s*(.+))?$/i))) {
      const a = find(m[1]), b = find(m[2]);
      if (a && b) s.links.push({ a: a.id, b: b.id, label: m[3], at: Math.max(a.at ?? 0, b.at ?? 0) + 0.3, flows: m[3] ? [{ label: m[3].toUpperCase().slice(0, 14), t0: Math.max(a.at ?? 0, b.at ?? 0) + 1, every: 3 }] : undefined }), ok(`Linked “${a.label}” → “${b.label}”`);
      else unknown.push(`${c} (element not found)`);
    } else if ((m = c.match(/^(?:unlink|disconnect)\s+(.+?)\s+(?:and|from)\s+(.+)$/i))) {
      const a = find(m[1]), b = find(m[2]);
      const before = s.links.length;
      if (a && b) s.links = s.links.filter((l) => !((l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id)));
      if (a && b && s.links.length < before) ok(`Unlinked “${a.label}” and “${b.label}”`);
      else unknown.push(`${c} (no such link)`);
    } else if ((m = c.match(/^(?:narration|caption|line)\s+(\d+)\s*:\s*(.+)$/i))) {
      const i = Number(m[1]) - 1;
      if (s.captions[i]) (s.captions[i].text = m[2]), ok(`Narration line ${i + 1} rewritten`);
      else unknown.push(`${c} (there are ${s.captions.length} narration lines)`);
    } else if ((m = c.match(/^add narration(?:\s+at\s+([\d.]+)\s*s?)?\s*:\s*(.+)$/i))) {
      const t = m[1] ? Number(m[1]) : Math.min(s.duration - 1, (s.captions.at(-1)?.t ?? 0) + 4);
      s.captions.push({ t, text: m[2] });
      s.captions.sort((a, b) => a.t - b.t);
      ok(`Narration line added at ${num(t)} s`);
    } else if ((m = c.match(/^(?:remove|delete) narration(?: line)?\s+(\d+)$/i))) {
      const i = Number(m[1]) - 1;
      if (s.captions[i]) s.captions.splice(i, 1), ok(`Narration line ${i + 1} removed`);
      else unknown.push(c);
    } else if ((m = c.match(/^(?:colou?r)\s+(?:of\s+)?(.+?)\s*(?::|to|=)?\s+(\w+)$/i)) && colourOf(m[2]) !== undefined) {
      const n = find(m[1]);
      if (n) (n.c = colourOf(m[2])), ok(`“${n.label}” coloured ${m[2]}`);
      else unknown.push(`${c} (no element “${m[1]}”)`);
    } else if ((m = c.match(new RegExp(`^icon\\s+(?:of\\s+)?(.+?)\\s*(?::|to|=)?\\s+(${ICON_WORDS}|none)$`, 'i')))) {
      const n = find(m[1]);
      if (n) (n.icon = m[2] === 'none' ? undefined : (m[2] as Icon)), ok(`Icon of “${n.label}”: ${m[2]}`);
      else unknown.push(`${c} (no element “${m[1]}”)`);
    } else if ((m = c.match(/^(?:shape)\s+(?:of\s+)?(.+?)\s*(?::|to|=)?\s+(box|pill|circle|state|layer)$/i))) {
      const n = find(m[1]);
      if (n) (n.shape = m[2] === 'box' ? undefined : (m[2] as SNode['shape'])), ok(`Shape of “${n.label}”: ${m[2]}`);
      else unknown.push(`${c} (no element “${m[1]}”)`);
    } else if ((m = c.match(/^move\s+(.+?)\s+(left|right|up|down)(?:\s+(?:by\s+)?(\d+))?$/i))) {
      const n = find(m[1]);
      const d = Number(m[3] ?? 100);
      if (n) {
        if (m[2] === 'left') n.x -= d;
        else if (m[2] === 'right') n.x += d;
        else if (m[2] === 'up') n.y -= d;
        else n.y += d;
        ok(`Moved “${n.label}” ${m[2]} ${d}`);
      } else unknown.push(`${c} (no element “${m[1]}”)`);
    } else if ((m = c.match(/^(?:make\s+)?(.+?)\s+(bigger|larger|smaller)$/i)) && find(m[1])) {
      const n = find(m[1])!;
      const k = m[2] === 'smaller' ? 0.85 : 1.18;
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      n.w = Math.round(n.w * k);
      n.h = Math.round(n.h * k);
      n.x = Math.round(cx - n.w / 2);
      n.y = Math.round(cy - n.h / 2);
      ok(`“${n.label}” made ${m[2]}`);
    } else if ((m = c.match(/^(?:make it\s+)?(faster|slower|quicker)$/i))) {
      const k = m[1] === 'slower' ? 1.25 : 0.8;
      retime(s, k);
      s.duration = Math.round(s.duration * k);
      ok(`Timing ×${k} (length ${s.duration} s)`);
    } else if ((m = c.match(/^(?:show|appear)\s+(.+?)\s+at\s+([\d.]+)\s*s?$/i))) {
      const n = find(m[1]);
      if (n) (n.at = Number(m[2])), ok(`“${n.label}” appears at ${m[2]} s`);
      else unknown.push(`${c} (no element “${m[1]}”)`);
    } else if ((m = c.match(/^highlight\s+(.+?)(?:\s+(?:during|with)\s+(?:narration|line)\s+(\d+))?$/i))) {
      const names = m[1].split(/\s*,\s*|\s+and\s+/);
      const ns = names.map(find).filter(Boolean) as SNode[];
      const i = m[2] ? Number(m[2]) - 1 : s.captions.length - 1;
      const cap = s.captions[i];
      if (ns.length && cap) {
        s.highlights = s.highlights ?? [];
        s.highlights.push({ t0: cap.t, t1: s.captions[i + 1]?.t ?? s.duration, ids: ns.map((n) => n.id) });
        ok(`Highlight ${ns.map((n) => `“${n.label}”`).join(', ')} during narration line ${i + 1}`);
      } else unknown.push(c);
    } else unknown.push(c);
  }
  return { applied, unknown };
}

function retime(s: Schema, k: number) {
  for (const n of s.nodes) if (n.at !== undefined) n.at = Math.round(n.at * k * 10) / 10;
  for (const l of s.links) {
    if (l.at !== undefined) l.at = Math.round(l.at * k * 10) / 10;
    for (const f of l.flows ?? []) {
      f.t0 = Math.round(f.t0 * k * 10) / 10;
      if (f.every !== undefined) f.every = Math.round(f.every * k * 10) / 10;
      if (f.until !== undefined) f.until = Math.round(f.until * k * 10) / 10;
    }
  }
  for (const c of s.captions) c.t = Math.round(c.t * k * 10) / 10;
  for (const h of s.highlights ?? []) (h.t0 = Math.round(h.t0 * k * 10) / 10), (h.t1 = Math.round(h.t1 * k * 10) / 10);
  for (const b of s.badges ?? []) if (b.at !== undefined) b.at = Math.round(b.at * k * 10) / 10;
}

/** does the text look like edit commands rather than a description of a new schema? */
export function looksLikeCommands(text: string) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .every((l) => /^(rename|change|add|remove|delete|link|connect|unlink|disconnect|narration|caption|line|colou?r|icon|shape|move|make|title|subtitle|duration|length|layout|use|arrange|show|appear|highlight|describe|faster|slower)\b/i.test(l.trim()));
}
