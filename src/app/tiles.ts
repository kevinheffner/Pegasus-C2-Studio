/**
 * Tiling layout engine: views are arranged in a binary split tree (like a tiling window manager).
 * Any view can be split right or down, closed, and every boundary can be dragged to resize.
 */
export type LNode = { t: 'leaf'; p: number } | { t: 'split'; d: 'row' | 'col'; f: number; a: LNode; b: LNode };

const L = (p: number): LNode => ({ t: 'leaf', p });
const S = (d: 'row' | 'col', a: LNode, b: LNode, f = 0.5): LNode => ({ t: 'split', d, f, a, b });

/** the layout presets as trees */
export const PRESET_TREES: Record<string, LNode> = {
  '1': L(0),
  '2v': S('row', L(0), L(1)),
  '2h': S('col', L(0), L(1)),
  '1+2': S('row', L(0), S('col', L(1), L(2))),
  '2+1': S('row', S('col', L(0), L(1)), L(2)),
  '4': S('col', S('row', L(0), L(1)), S('row', L(2), L(3))),
};

export const cloneTree = (n: LNode): LNode => JSON.parse(JSON.stringify(n));

export function leaves(n: LNode): number[] {
  return n.t === 'leaf' ? [n.p] : [...leaves(n.a), ...leaves(n.b)];
}

/** split the leaf showing view p; the new view q goes right (row) or below (col) */
export function splitLeaf(n: LNode, p: number, d: 'row' | 'col', q: number): LNode {
  if (n.t === 'leaf') return n.p === p ? S(d, L(p), L(q)) : n;
  return { ...n, a: splitLeaf(n.a, p, d, q), b: splitLeaf(n.b, p, d, q) };
}

/** remove the leaf showing view p (its sibling takes the space); returns null if it was the only view */
export function removeLeaf(n: LNode, p: number): LNode | null {
  if (n.t === 'leaf') return n.p === p ? null : n;
  const a = removeLeaf(n.a, p);
  const b = removeLeaf(n.b, p);
  if (!a) return b;
  if (!b) return a;
  return { ...n, a, b };
}

/**
 * Build the DOM for a tree inside host. panelEl(i) returns the element of view i.
 * Gutters between children can be dragged (double-click resets to 50/50).
 */
export function renderTree(host: HTMLElement, tree: LNode, panelEl: (i: number) => HTMLElement, onResized: () => void) {
  host.innerHTML = '';
  const build = (n: LNode): HTMLElement => {
    if (n.t === 'leaf') {
      const leaf = document.createElement('div');
      leaf.className = 'tleaf';
      leaf.appendChild(panelEl(n.p));
      return leaf;
    }
    const box = document.createElement('div');
    box.className = `tsplit t${n.d}`;
    const ca = document.createElement('div');
    const cb = document.createElement('div');
    ca.className = cb.className = 'tchild';
    const setFlex = () => {
      ca.style.flex = `${n.f} 1 0`;
      cb.style.flex = `${1 - n.f} 1 0`;
    };
    setFlex();
    ca.appendChild(build(n.a));
    cb.appendChild(build(n.b));
    const g = document.createElement('div');
    g.className = 'tgutter';
    g.title = 'Drag to resize · double-click to reset';
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      g.setPointerCapture(e.pointerId);
      g.classList.add('dragging');
      const r = box.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const f = n.d === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        n.f = Math.max(0.1, Math.min(0.9, f));
        setFlex();
      };
      const up = () => {
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.classList.remove('dragging');
        onResized();
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
    });
    g.addEventListener('dblclick', () => {
      n.f = 0.5;
      setFlex();
      onResized();
    });
    box.append(ca, g, cb);
    return box;
  };
  host.appendChild(build(tree));
}
