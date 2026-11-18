/**
 * Animated schema engine: declarative node / link / flow diagrams rendered on a 1920×1080 virtual canvas
 * as a pure function of time (so any frame can be rendered exactly – used for PNG, GIF and video export).
 */
export const VW = 1920;
export const VH = 1080;

export interface Effects {
  /** 0 = none … 1 = very bouncy overshoot when an item appears */
  bounce: number;
  /** seconds an item takes to appear */
  appearDur: number;
  /** afterglow intensity 0–1 (new items and highlighted items keep glowing) */
  glowPct: number;
  /** seconds the afterglow takes to fade */
  glowDur: number;
  /** seconds a link takes to draw */
  linkDur: number;
  /** box corner radius (px at 1080p) */
  radius: number;
  /** size of travelling message tags (1 = normal) */
  packetScale: number;
  /** pulse highlighted items */
  pulse: boolean;
}
export const DEFAULT_FX: Effects = { bounce: 0.35, appearDur: 0.6, glowPct: 0.6, glowDur: 1.5, linkDur: 0.7, radius: 16, packetScale: 1, pulse: true };

export interface Theme {
  id: string;
  name: string;
  /** background: gradient (bg[0]→bg[1]), solid (bg[1]) or an uploaded image */
  bgKind?: 'gradient' | 'solid' | 'image';
  bgImage?: string; // data URL
  bgFit?: 'cover' | 'contain';
  /** 0–1: veil of the background colour over the image */
  bgDim?: number;
  font?: string;
  textScale?: number;
  fx?: Partial<Effects>;
  bg: [string, string];
  grid: string | null;
  text: string;
  muted: string;
  box: string;
  boxLine: string;
  group: string;
  link: string;
  caption: string;
  captionText: string;
  accents: string[];
}

export const THEMES: Theme[] = [
  { id: 'blueprint', name: 'Blueprint', bg: ['#123a63', '#0c2a4a'], grid: 'rgba(160,200,255,0.08)', text: '#eef5ff', muted: '#a9c3e3', box: 'rgba(14,40,72,0.92)', boxLine: 'rgba(170,210,255,0.55)', group: 'rgba(170,210,255,0.35)', link: 'rgba(200,225,255,0.55)', caption: 'rgba(6,22,42,0.86)', captionText: '#ffffff', accents: ['#5fb4ff', '#ffc857', '#6ee7b7', '#ff8a80', '#c4a7ff', '#7dd3fc', '#fda4af'] },
  { id: 'paper', name: 'Classroom (light)', bg: ['#f6f1e7', '#ece4d4'], grid: 'rgba(120,100,60,0.07)', text: '#23262f', muted: '#6f6656', box: '#fffdf8', boxLine: '#cbbfa6', group: 'rgba(110,90,50,0.35)', link: 'rgba(80,70,50,0.55)', caption: 'rgba(45,42,90,0.92)', captionText: '#ffffff', accents: ['#4f46e5', '#d97706', '#0e9f8e', '#dc2626', '#7c3aed', '#0284c7', '#db2777'] },
  { id: 'chalk', name: 'Chalkboard', bg: ['#26433a', '#1d352e'], grid: null, text: '#f4f1e6', muted: '#c9c3ae', box: 'rgba(30,55,47,0.9)', boxLine: 'rgba(244,241,230,0.6)', group: 'rgba(244,241,230,0.4)', link: 'rgba(244,241,230,0.6)', caption: 'rgba(16,30,26,0.88)', captionText: '#fffbe9', accents: ['#ffe08a', '#9ee6c9', '#ffb3a7', '#a8d8ff', '#e6c1ff', '#fff3c4', '#c6f0a0'], font: 'Trebuchet MS', fx: { bounce: 0.6, glowPct: 0.3 } },
  { id: 'sunrise', name: 'Sunrise (warm light)', bg: ['#fff4e6', '#fde2c8'], grid: null, text: '#3a2a1f', muted: '#8a6d58', box: '#fffaf3', boxLine: '#e7c3a0', group: 'rgba(160,100,60,0.4)', link: 'rgba(120,80,50,0.55)', caption: 'rgba(120,53,15,0.92)', captionText: '#ffffff', accents: ['#ea580c', '#0d9488', '#7c3aed', '#db2777', '#2563eb', '#ca8a04', '#16a34a'], fx: { bounce: 0.5, glowPct: 0.45 } },
  { id: 'slate', name: 'Slate', bg: ['#2b3140', '#1d2230'], grid: 'rgba(255,255,255,0.04)', text: '#f1f3f7', muted: '#a4adbf', box: 'rgba(42,49,64,0.95)', boxLine: 'rgba(255,255,255,0.22)', group: 'rgba(255,255,255,0.25)', link: 'rgba(255,255,255,0.45)', caption: 'rgba(15,18,26,0.88)', captionText: '#ffffff', accents: ['#38bdf8', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#22d3ee', '#f472b6'] },
];

export type Icon = 'c2' | 'sim' | 'server' | 'people' | 'doc' | 'net' | 'clock' | 'gear' | 'shield' | 'plane' | 'tank' | 'ship' | 'chart' | 'flag' | 'globe' | 'eye' | 'cube' | 'radio' | 'book' | 'target' | 'db';

export interface SNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  icon?: Icon;
  c?: number; // accent index
  at?: number; // appear time (s)
  shape?: 'box' | 'pill' | 'circle' | 'group' | 'state' | 'doc' | 'layer';
  size?: number; // label font size
}
export interface Flow {
  label?: string;
  c?: number;
  dir?: 1 | -1;
  t0: number; // first packet leaves
  every?: number; // repeat period (s)
  until?: number; // stop emitting after this time
  dur?: number; // traversal time (s)
}
export interface SLink {
  a: string;
  b: string;
  at?: number;
  label?: string;
  c?: number;
  dashed?: boolean;
  two?: boolean; // arrowheads on both ends
  none?: boolean; // no arrowheads
  bend?: number; // curvature (px, perpendicular)
  flows?: Flow[];
}
export interface Caption {
  t: number;
  text: string;
}
export interface Highlight {
  t0: number;
  t1: number;
  ids: string[];
}
export interface Badge {
  x: number;
  y: number;
  text: string;
  at?: number;
  c?: number;
  align?: 'left' | 'center' | 'right';
}
export interface Schema {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  duration: number;
  nodes: SNode[];
  links: SLink[];
  captions: Caption[];
  highlights?: Highlight[];
  badges?: Badge[];
  description: string;
  refs: string[];
  /** extra drawing on top of the diagram (virtual coordinates) */
  draw?: (g: CanvasRenderingContext2D, t: number, th: Theme, h: Helpers) => void;
  /** id of a registered extra drawing (kept when the schema is saved as JSON) */
  drawId?: string;
}

export const EXTRA_DRAW: Record<string, NonNullable<Schema['draw']>> = {};

const imgCache = new Map<string, HTMLImageElement>();
/** decoded background image (null until loaded; the next frame draws it) */
export function bgImage(src: string): HTMLImageElement | null {
  let im = imgCache.get(src);
  if (!im) {
    im = new Image();
    im.src = src;
    imgCache.set(src, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
/** resolves once a background image is decoded (exports wait for it) */
export function bgReady(src?: string) {
  if (!src) return Promise.resolve();
  const im = imgCache.get(src) ?? (bgImage(src), imgCache.get(src)!);
  return im.complete ? Promise.resolve() : new Promise<void>((r) => ((im.onload = () => r()), (im.onerror = () => r())));
}
/** where a schema's virtual 1920×1080 space sits in a canvas */
export function viewTransform(W: number, H: number) {
  const k = Math.min(W / VW, H / VH);
  return { k, ox: (W - VW * k) / 2, oy: (H - VH * k) / 2 };
}
let FONT = '"Segoe UI", system-ui, sans-serif';
let TS = 1;

export interface Helpers {
  ease: (x: number) => number;
  appear: (t: number, at?: number, d?: number) => number;
  center: (id: string) => [number, number];
  node: (id: string) => SNode | undefined;
  text: (s: string, x: number, y: number, o?: { size?: number; color?: string; weight?: number; align?: CanvasTextAlign; max?: number; alpha?: number }) => void;
  pill: (s: string, x: number, y: number, color: string, o?: { size?: number; alpha?: number; fg?: string }) => void;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** ease-out with overshoot: b = 0 none … 1 strong */
const back = (x: number, b: number) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c = 1.70158 * b * 1.6;
  const y = x - 1;
  return 1 + (c + 1) * y * y * y + c * y * y;
};
const appear = (t: number, at = 0, d = 0.6) => ease((t - at) / d);

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g: CanvasRenderingContext2D, s: string, max: number) {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const tryL = cur ? cur + ' ' + w : w;
    if (g.measureText(tryL).width > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = tryL;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** simple line icons, drawn in a size×size box centred on (x, y) */
export function drawIcon(g: CanvasRenderingContext2D, icon: Icon, x: number, y: number, s: number, col: string) {
  g.save();
  g.translate(x - s / 2, y - s / 2);
  g.scale(s / 24, s / 24);
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 1.7;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const L = (pts: number[][], close = false) => {
    g.beginPath();
    pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
    if (close) g.closePath();
    g.stroke();
  };
  const C = (cx: number, cy: number, r: number, fill = false) => {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    fill ? g.fill() : g.stroke();
  };
  const R = (a: number, b: number, w: number, h: number) => {
    rr(g, a, b, w, h, 1.5);
    g.stroke();
  };
  switch (icon) {
    case 'c2':
      R(2, 3, 20, 13);
      L([[8, 21], [16, 21]]);
      L([[12, 16], [12, 21]]);
      R(5, 6, 6, 4);
      L([[13, 8], [19, 8]]);
      L([[13, 11], [17, 11]]);
      L([[5, 13], [19, 13]]);
      break;
    case 'sim':
      L([[12, 2], [21, 7], [21, 17], [12, 22], [3, 17], [3, 7]], true);
      L([[3, 7], [12, 12], [21, 7]]);
      L([[12, 12], [12, 22]]);
      break;
    case 'cube':
      R(4, 4, 16, 16);
      L([[4, 12], [20, 12]]);
      L([[12, 4], [12, 20]]);
      break;
    case 'server':
      R(4, 3, 16, 5);
      R(4, 10, 16, 5);
      R(4, 17, 16, 5);
      C(7, 5.5, 0.8, true);
      C(7, 12.5, 0.8, true);
      C(7, 19.5, 0.8, true);
      break;
    case 'db':
      g.beginPath();
      g.ellipse(12, 5, 8, 3, 0, 0, Math.PI * 2);
      g.stroke();
      L([[4, 5], [4, 19]]);
      L([[20, 5], [20, 19]]);
      g.beginPath();
      g.ellipse(12, 19, 8, 3, 0, 0, Math.PI);
      g.stroke();
      g.beginPath();
      g.ellipse(12, 12, 8, 3, 0, 0, Math.PI);
      g.stroke();
      break;
    case 'people':
      C(8, 8, 3);
      C(16, 8, 3);
      L([[2, 20], [3, 15], [8, 13], [13, 15], [14, 20]]);
      L([[13, 13.5], [16, 13], [21, 15], [22, 20]]);
      break;
    case 'doc':
      L([[5, 2], [15, 2], [20, 7], [20, 22], [5, 22]], true);
      L([[15, 2], [15, 7], [20, 7]]);
      L([[8, 12], [17, 12]]);
      L([[8, 16], [17, 16]]);
      break;
    case 'book':
      L([[2, 4], [9, 4], [12, 7], [12, 21], [9, 19], [2, 19]], true);
      L([[22, 4], [15, 4], [12, 7]]);
      L([[12, 21], [15, 19], [22, 19], [22, 4]]);
      break;
    case 'net':
      C(12, 5, 2.5);
      C(5, 18, 2.5);
      C(19, 18, 2.5);
      L([[12, 7.5], [6, 16]]);
      L([[12, 7.5], [18, 16]]);
      L([[7.5, 18], [16.5, 18]]);
      break;
    case 'globe':
      C(12, 12, 9.5);
      g.beginPath();
      g.ellipse(12, 12, 4.5, 9.5, 0, 0, Math.PI * 2);
      g.stroke();
      L([[2.5, 12], [21.5, 12]]);
      L([[4, 7], [20, 7]]);
      L([[4, 17], [20, 17]]);
      break;
    case 'clock':
      C(12, 12, 9.5);
      L([[12, 6], [12, 12], [16, 14]]);
      break;
    case 'gear':
      C(12, 12, 3.5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        L([[12 + Math.cos(a) * 6.5, 12 + Math.sin(a) * 6.5], [12 + Math.cos(a) * 9.5, 12 + Math.sin(a) * 9.5]]);
      }
      C(12, 12, 6.5);
      break;
    case 'shield':
      L([[12, 2], [20, 5], [20, 11], [12, 22], [4, 11], [4, 5]], true);
      L([[8, 12], [11, 15], [16, 9]]);
      break;
    case 'plane':
      L([[12, 2], [13.5, 9], [22, 13], [22, 15], [13.5, 13], [13, 19], [16, 21], [16, 22], [12, 21], [8, 22], [8, 21], [11, 19], [10.5, 13], [2, 15], [2, 13], [10.5, 9]], true);
      break;
    case 'tank':
      R(2, 13, 20, 6);
      L([[6, 13], [8, 9], [15, 9], [17, 13]]);
      L([[13, 10.5], [22, 8]]);
      C(6, 16, 1.2);
      C(12, 16, 1.2);
      C(18, 16, 1.2);
      break;
    case 'ship':
      L([[2, 14], [22, 14], [19, 20], [5, 20]], true);
      L([[7, 14], [7, 9], [15, 9], [15, 14]]);
      L([[11, 9], [11, 4]]);
      break;
    case 'chart':
      L([[3, 3], [3, 21], [21, 21]]);
      L([[6, 16], [10, 11], [14, 14], [20, 6]]);
      break;
    case 'flag':
      L([[5, 22], [5, 3]]);
      L([[5, 4], [18, 4], [15, 8.5], [18, 13], [5, 13]]);
      break;
    case 'eye':
      g.beginPath();
      g.moveTo(2, 12);
      g.quadraticCurveTo(12, 2, 22, 12);
      g.quadraticCurveTo(12, 22, 2, 12);
      g.stroke();
      C(12, 12, 3.5);
      break;
    case 'radio':
      R(4, 9, 16, 12);
      L([[8, 9], [16, 3]]);
      C(9, 15, 2.5);
      L([[14, 13], [17, 13]]);
      L([[14, 17], [17, 17]]);
      break;
    case 'target':
      C(12, 12, 9.5);
      C(12, 12, 5.5);
      C(12, 12, 1.5, true);
      break;
  }
  g.restore();
}

export interface RenderOpts {
  captions: boolean;
  title: boolean;
}

/** draw one frame of a schema at time t into a canvas of any size (16:9 virtual space scaled to fit) */
export function renderSchema(g: CanvasRenderingContext2D, sc: Schema, t: number, th: Theme, W: number, H: number, o: RenderOpts) {
  g.save();
  const k = Math.min(W / VW, H / VH);
  g.setTransform(k, 0, 0, k, (W - VW * k) / 2, (H - VH * k) / 2);
  const fx: Effects = { ...DEFAULT_FX, ...(th.fx ?? {}) };
  FONT = `"${th.font ?? 'Segoe UI'}", system-ui, sans-serif`;
  TS = th.textScale ?? 1;
  const acc = (i?: number) => th.accents[(i ?? 0) % th.accents.length];
  const appearN = (at?: number) => appear(t, at ?? 0, fx.appearDur);
  const byId = new Map(sc.nodes.map((n) => [n.id, n]));
  const center = (id: string): [number, number] => {
    const n = byId.get(id)!;
    return [n.x + n.w / 2, n.y + n.h / 2];
  };
  const text: Helpers['text'] = (s, x, y, op = {}) => {
    g.save();
    g.globalAlpha *= op.alpha ?? 1;
    const fsz = (op.size ?? 22) * TS;
    g.font = `${op.weight ?? 500} ${fsz}px ${FONT}`;
    g.fillStyle = op.color ?? th.text;
    g.textAlign = op.align ?? 'left';
    g.textBaseline = 'middle';
    if (op.max) {
      const lines = wrap(g, s, op.max);
      const lh = fsz * 1.25;
      lines.forEach((l, i) => g.fillText(l, x, y + (i - (lines.length - 1) / 2) * lh));
    } else g.fillText(s, x, y);
    g.restore();
  };
  const pill: Helpers['pill'] = (s, x, y, color, op = {}) => {
    g.save();
    g.globalAlpha *= op.alpha ?? 1;
    const fs = op.size ?? 17;
    g.font = `700 ${fs}px ${FONT}`;
    const w = g.measureText(s).width + fs * 1.1;
    const h = fs * 1.7;
    rr(g, x - w / 2, y - h / 2, w, h, h / 2);
    g.fillStyle = color;
    g.fill();
    g.fillStyle = op.fg ?? '#0b1220';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, x, y + 1);
    g.restore();
  };
  const H_: Helpers = { ease, appear, center, node: (id) => byId.get(id), text, pill };

  // background
  if (th.bgKind === 'solid') g.fillStyle = th.bg[1];
  else {
    const bg = g.createLinearGradient(0, 0, 0, VH);
    bg.addColorStop(0, th.bg[0]);
    bg.addColorStop(1, th.bg[1]);
    g.fillStyle = bg;
  }
  g.fillRect(-2000, -2000, VW + 4000, VH + 4000);
  const im = th.bgKind === 'image' && th.bgImage ? bgImage(th.bgImage) : null;
  if (im) {
    const s0 = th.bgFit === 'contain' ? Math.min(VW / im.naturalWidth, VH / im.naturalHeight) : Math.max(VW / im.naturalWidth, VH / im.naturalHeight);
    const iw = im.naturalWidth * s0, ih = im.naturalHeight * s0;
    g.drawImage(im, (VW - iw) / 2, (VH - ih) / 2, iw, ih);
    if ((th.bgDim ?? 0) > 0) {
      g.globalAlpha = th.bgDim ?? 0;
      g.fillStyle = th.bg[1];
      g.fillRect(0, 0, VW, VH);
      g.globalAlpha = 1;
    }
  }
  if (th.grid) {
    g.strokeStyle = th.grid;
    g.lineWidth = 1;
    for (let x = 0; x <= VW; x += 40) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, VH);
      g.stroke();
    }
    for (let y = 0; y <= VH; y += 40) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(VW, y);
      g.stroke();
    }
  }
  // title
  if (o.title) {
    const a = appear(t, 0, 0.8);
    text(sc.title, 70, 70, { size: 46, weight: 700, alpha: a });
    text(sc.subtitle, 72, 118, { size: 24, color: th.muted, alpha: a });
    g.globalAlpha = a;
    g.fillStyle = acc(0);
    g.fillRect(70, 140, 120 * a, 5);
    g.globalAlpha = 1;
  }

  const hl = new Set<string>();
  const lastEnd = new Map<string, number>();
  for (const h of sc.highlights ?? []) {
    if (t >= h.t0 && t <= h.t1) h.ids.forEach((i) => hl.add(i));
    else if (t > h.t1) h.ids.forEach((i) => lastEnd.set(i, Math.max(lastEnd.get(i) ?? -1e9, h.t1)));
  }
  /** glow level 0–1: highlighted, recently highlighted (afterglow) or newly created */
  const glow = (n: SNode) => {
    if (hl.has(n.id)) return 1;
    let v = 0;
    const e = lastEnd.get(n.id);
    if (e !== undefined && fx.glowDur > 0) v = Math.max(v, (1 - (t - e) / fx.glowDur) * fx.glowPct);
    const born = (n.at ?? 0) + fx.appearDur * 0.5;
    if (t >= born && fx.glowDur > 0) v = Math.max(v, (1 - (t - born) / fx.glowDur) * fx.glowPct);
    return Math.max(0, v);
  };

  // groups first
  for (const n of sc.nodes.filter((n) => n.shape === 'group')) {
    const a = appearN(n.at);
    if (a <= 0) continue;
    g.save();
    g.globalAlpha = a;
    rr(g, n.x, n.y, n.w, n.h, fx.radius + 6);
    g.fillStyle = 'rgba(127,127,127,0.06)';
    g.fill();
    g.setLineDash([10, 8]);
    g.strokeStyle = n.c !== undefined ? acc(n.c) : th.group;
    g.lineWidth = 2;
    g.stroke();
    g.setLineDash([]);
    text(n.label.toUpperCase(), n.x + 22, n.y + 26, { size: 17, weight: 700, color: n.c !== undefined ? acc(n.c) : th.muted });
    g.restore();
  }

  // links
  const edge = (n: SNode, tx: number, ty: number): [number, number] => {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (n.shape === 'circle') {
      const r = Math.min(n.w, n.h) / 2, d = Math.hypot(dx, dy) || 1;
      return [cx + (dx / d) * r, cy + (dy / d) * r];
    }
    const sx = dx ? n.w / 2 / Math.abs(dx) : Infinity, sy = dy ? n.h / 2 / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return [cx + dx * s, cy + dy * s];
  };
  const geom = (l: SLink) => {
    const A = byId.get(l.a)!, B = byId.get(l.b)!;
    const [ax0, ay0] = center(l.a), [bx0, by0] = center(l.b);
    const mx = (ax0 + bx0) / 2, my = (ay0 + by0) / 2;
    const len = Math.hypot(bx0 - ax0, by0 - ay0) || 1;
    const bend = l.bend ?? 0;
    const cx = mx + (-(by0 - ay0) / len) * bend, cy = my + ((bx0 - ax0) / len) * bend;
    const [ax, ay] = edge(A, bend ? cx : bx0, bend ? cy : by0);
    const [bx, by] = edge(B, bend ? cx : ax0, bend ? cy : ay0);
    const pt = (u: number): [number, number] => [(1 - u) * (1 - u) * ax + 2 * (1 - u) * u * cx + u * u * bx, (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * cy + u * u * by];
    return { ax, ay, bx, by, cx, cy, pt };
  };
  const arrow = (x: number, y: number, ang: number, col: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-16, -8);
    g.lineTo(-16, 8);
    g.closePath();
    g.fill();
    g.restore();
  };
  for (const l of sc.links) {
    const a = appear(t, l.at ?? 0, fx.linkDur);
    if (a <= 0 || !byId.get(l.a) || !byId.get(l.b)) continue;
    const { pt } = geom(l);
    const col = l.c !== undefined ? acc(l.c) : th.link;
    g.save();
    g.strokeStyle = col;
    g.lineWidth = 3;
    if (l.dashed) g.setLineDash([10, 8]);
    g.beginPath();
    const N = 40;
    for (let i = 0; i <= N * a; i++) {
      const [x, y] = pt(i / N);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
    if (a >= 1 && !l.none) {
      const [x1, y1] = pt(1), [x0, y0] = pt(0.97);
      arrow(x1, y1, Math.atan2(y1 - y0, x1 - x0), col);
      if (l.two) {
        const [u1, v1] = pt(0), [u0, v0] = pt(0.03);
        arrow(u1, v1, Math.atan2(v1 - v0, u1 - u0), col);
      }
    }
    if (l.label && a >= 1) {
      const [x, y] = pt(0.5);
      g.font = `600 17px ${FONT}`;
      const w = g.measureText(l.label).width + 16;
      rr(g, x - w / 2, y - 14, w, 28, 8);
      g.fillStyle = th.bg[1];
      g.fill();
      text(l.label, x, y, { size: 17, weight: 600, color: col === th.link ? th.muted : col, align: 'center' });
    }
    g.restore();
  }

  // nodes
  for (const n of sc.nodes) {
    if (n.shape === 'group') continue;
    const p = Math.max(0, Math.min(1, (t - (n.at ?? 0)) / Math.max(0.05, fx.appearDur)));
    if (p <= 0) continue;
    const a = ease(Math.min(1, p * 1.6));
    const col = acc(n.c);
    const on = hl.has(n.id);
    const gl = glow(n);
    g.save();
    g.globalAlpha = a;
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const grow = fx.bounce > 0 ? back(p, fx.bounce) : ease(p);
    const sc_ = 0.6 + 0.4 * grow + (on && fx.pulse ? 0.04 * (0.5 + 0.5 * Math.sin(t * 6)) : 0);
    g.translate(cx, cy);
    g.scale(sc_, sc_);
    g.translate(-cx, -cy);
    if (gl > 0.01) {
      g.shadowColor = col;
      g.shadowBlur = 40 * gl;
    }
    if (n.shape === 'circle') {
      g.beginPath();
      g.arc(cx, cy, Math.min(n.w, n.h) / 2, 0, Math.PI * 2);
    } else rr(g, n.x, n.y, n.w, n.h, n.shape === 'pill' || n.shape === 'state' ? n.h / 2 : Math.min(fx.radius, n.shape === 'layer' ? 10 : fx.radius));
    g.fillStyle = n.shape === 'layer' ? mix(th.box, col, 0.28) : gl > 0.01 ? mix(th.box, col, 0.22 * gl) : th.box;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 2.5 + 1.5 * gl;
    g.strokeStyle = gl > 0.3 || n.c !== undefined ? col : th.boxLine;
    g.stroke();
    // accent strip
    if (n.shape !== 'circle' && n.shape !== 'pill' && n.shape !== 'state' && n.shape !== 'layer') {
      g.save();
      rr(g, n.x, n.y, n.w, n.h, fx.radius);
      g.clip();
      g.fillStyle = col;
      g.fillRect(n.x, n.y, 8, n.h);
      g.restore();
    }
    const fs = n.size ?? (n.h < 80 ? 22 : 25);
    let tx = n.x + 24;
    let align: CanvasTextAlign = 'left';
    if (n.icon && n.shape !== 'circle' && n.shape !== 'state' && n.shape !== 'pill') {
      const is = Math.min(56, n.h - 24);
      drawIcon(g, n.icon, n.x + 22 + is / 2, cy, is, col);
      tx = n.x + 38 + is;
    }
    if (n.shape === 'circle' || n.shape === 'state' || n.shape === 'pill' || (!n.icon && n.shape === 'layer')) {
      tx = cx;
      align = 'center';
      if (n.icon && n.shape === 'circle') drawIcon(g, n.icon, cx, cy - n.h * 0.18, n.h * 0.26, col);
    }
    // stack the (possibly wrapped) label and sub-label as one centred block
    const maxW = align === 'center' ? (n.shape === 'circle' ? n.w * 0.78 : n.w - 30) : n.x + n.w - tx - 14;
    const sfs = Math.round(fs * 0.72);
    const fsT = fs * TS, sfsT = sfs * TS;
    g.font = `700 ${fsT}px ${FONT}`;
    const nl = wrap(g, n.label, maxW).length;
    g.font = `500 ${sfsT}px ${FONT}`;
    const ns = n.sub ? wrap(g, n.sub, maxW).length : 0;
    const lh = fsT * 1.25, slh = sfsT * 1.25, gap = ns ? fsT * 0.3 : 0;
    const blockH = nl * lh + gap + ns * slh;
    const mid = n.shape === 'circle' && n.icon ? cy + n.h * 0.1 : cy;
    const top = mid - blockH / 2;
    text(n.label, tx, top + (nl * lh) / 2, { size: fs, weight: 700, align, max: maxW });
    if (n.sub) text(n.sub, tx, top + nl * lh + gap + (ns * slh) / 2, { size: sfs, color: th.muted, align, max: maxW });
    g.restore();
  }

  // flows (packets travelling along links)
  for (const l of sc.links) {
    if (!l.flows || appear(t, l.at ?? 0, fx.linkDur) < 1) continue;
    const { pt } = geom(l);
    for (const f of l.flows) {
      const dur = f.dur ?? 1.6;
      const every = f.every ?? 1e9;
      for (let k0 = Math.max(0, Math.floor((t - f.t0 - dur) / every)); ; k0++) {
        const s = f.t0 + k0 * every;
        if (s > t || (f.until !== undefined && s > f.until)) break;
        const u = (t - s) / dur;
        if (u < 0 || u > 1) continue;
        const uu = f.dir === -1 ? 1 - ease(u) : ease(u);
        const [x, y] = pt(uu);
        const col = acc(f.c);
        const fade = Math.min(1, u * 6, (1 - u) * 6);
        g.save();
        g.globalAlpha = fade;
        g.shadowColor = col;
        g.shadowBlur = 18;
        if (f.label) pill(f.label, x, y, col, { size: 16 * fx.packetScale });
        else {
          g.fillStyle = col;
          g.beginPath();
          g.arc(x, y, 9 * fx.packetScale, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      }
    }
  }

  // badges
  for (const b of sc.badges ?? []) {
    const a = appear(t, b.at ?? 0, 0.6);
    if (a <= 0) continue;
    g.save();
    g.globalAlpha = a;
    g.font = `700 18px ${FONT}`;
    const w = g.measureText(b.text).width + 26;
    const x = b.align === 'left' ? b.x : b.align === 'right' ? b.x - w : b.x - w / 2;
    rr(g, x, b.y - 18, w, 36, 18);
    g.fillStyle = mix(th.box, acc(b.c), 0.18);
    g.fill();
    g.strokeStyle = acc(b.c);
    g.lineWidth = 2;
    g.stroke();
    text(b.text, x + w / 2, b.y + 1, { size: 18, weight: 700, align: 'center', color: th.text });
    g.restore();
  }

  (sc.draw ?? (sc.drawId ? EXTRA_DRAW[sc.drawId] : undefined))?.(g, t, th, H_);

  // caption bar
  if (o.captions && sc.captions.length) {
    let ci = -1;
    for (let i = 0; i < sc.captions.length; i++) if (t >= sc.captions[i].t) ci = i;
    if (ci >= 0) {
      const c = sc.captions[ci];
      const a = Math.min(appear(t, c.t, 0.5), ci + 1 < sc.captions.length ? 1 - appear(t, sc.captions[ci + 1].t - 0.35, 0.35) : 1);
      g.save();
      g.globalAlpha = a;
      rr(g, 160, 958, VW - 320, 92, 18);
      g.fillStyle = th.caption;
      g.fill();
      g.fillStyle = acc(0);
      g.fillRect(160, 958, 8, 92);
      text(c.text, VW / 2, 1004, { size: 27, weight: 500, color: th.captionText, align: 'center', max: VW - 400 });
      g.restore();
      // step dots
      const n = sc.captions.length;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        g.arc(VW / 2 - (n - 1) * 11 + i * 22, 1066, i === ci ? 6 : 4, 0, Math.PI * 2);
        g.fillStyle = i <= ci ? acc(0) : th.muted;
        g.globalAlpha = i <= ci ? 1 : 0.4;
        g.fill();
        g.globalAlpha = 1;
      }
    }
  }
  g.restore();
}

/** mix two css colours (hex or rgba) roughly: used for tinted fills */
function mix(a: string, b: string, f: number) {
  const p = (c: string) => {
    if (c.startsWith('#')) {
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const m = c.match(/[\d.]+/g)!.map(Number);
    return [m[0], m[1], m[2], m[3] ?? 1];
  };
  const A = p(a), B = p(b);
  return `rgba(${Math.round(A[0] + (B[0] - A[0]) * f)},${Math.round(A[1] + (B[1] - A[1]) * f)},${Math.round(A[2] + (B[2] - A[2]) * f)},${Math.max(A[3], 0.92)})`;
}
