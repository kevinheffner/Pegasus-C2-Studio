/**
 * Widget dock: drag widgets from the rail into the dock column; they stack vertically as bordered cards
 * with their own scroll bars, a header (drag to reorder, collapse, close) and a bottom resize grip.
 * The dock column itself is width-resizable. Layout is remembered in localStorage (per browser).
 */
const LS_KEY = 'scc-dock-v3';

interface CardState {
  w: string;
  h: number; // px
  collapsed: boolean;
}
interface DockState {
  cards: CardState[];
  width: number;
  hidden: boolean;
}

export interface DockLayout {
  cards: { w: string; h: number; collapsed: boolean }[];
  width: number;
  hidden: boolean;
}

export interface Dock {
  /** current disposition (for saving workspace layouts) */
  getState(): DockLayout;
  /** apply a saved disposition */
  setState(s: DockLayout): void;
  /** ids of the widgets currently open in the dock, top to bottom */
  open(): string[];
  toggle(w: string): void;
  add(w: string, index?: number): void;
  remove(w: string): void;
  /** returns the scroll container of a widget card (or null) */
  body(w: string): HTMLElement | null;
}

export function initDock(o: { names: Record<string, string>; defaults: string[]; changed: () => void }): Dock {
  const aside = document.getElementById('widget')!;
  const dock = document.getElementById('dock')!;
  const store = document.getElementById('paneStore')!;
  const empty = document.getElementById('dockEmpty')!;
  const rail = document.getElementById('rail')!;

  let st: DockState = { cards: o.defaults.map((w) => ({ w, h: w === 'map' ? 300 : 240, collapsed: false })), width: 270, hidden: false };
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    if (s && Array.isArray(s.cards)) st = { ...st, ...s, cards: s.cards.filter((c: CardState) => o.names[c.w]) };
  } catch {
    /* storage unavailable */
  }
  const save = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(st));
    } catch {
      /* ignore */
    }
  };
  const pane = (w: string) => document.querySelector<HTMLElement>(`.wpane[data-w="${w}"]`);
  const cardEl = (w: string) => dock.querySelector<HTMLElement>(`.wcard[data-w="${w}"]`);

  const GAP = 8;
  const CHROME = 30 + 8 + 2; // header + resize grip + borders (px)
  const colHeight = () => Math.max(200, (document.getElementById('dockScroll') as HTMLElement).clientHeight - 12);
  const outerH = (c: CardState, H: number) => (c.collapsed ? 30 : Math.min(c.h, H - CHROME) + CHROME);
  /** split cards into columns: fill top to bottom, open a new column when the next card does not fit */
  function layout(): CardState[][] {
    const H = colHeight();
    const cols: CardState[][] = [[]];
    let used = 0;
    for (const c of st.cards) {
      const h = outerH(c, H);
      if (cols[cols.length - 1].length && used + GAP + h > H) {
        cols.push([]);
        used = 0;
      }
      used += (cols[cols.length - 1].length ? GAP : 0) + h;
      cols[cols.length - 1].push(c);
    }
    return cols;
  }
  let lastCols = -1;

  function render() {
    // move panes back to the store, rebuild cards column by column, re-insert panes
    for (const p of document.querySelectorAll<HTMLElement>('.wpane')) if (!p.closest('.vwidget')) store.appendChild(p);
    dock.innerHTML = '';
    const H = colHeight();
    const cols = layout();
    lastCols = cols.length;
    let colEl: HTMLElement | null = null;
    const colOf = new Map<CardState, number>();
    cols.forEach((col, i) => col.forEach((c) => colOf.set(c, i)));
    let curCol = -1;
    for (const c of st.cards) {
      if (colOf.get(c) !== curCol) {
        curCol = colOf.get(c)!;
        colEl = document.createElement('div');
        colEl.className = 'dcol';
        colEl.style.width = `${st.width - 12}px`;
        dock.appendChild(colEl);
      }
      const el = document.createElement('section');
      el.className = 'wcard' + (c.collapsed ? ' collapsed' : '');
      el.dataset.w = c.w;
      el.innerHTML = `
        <header class="wcHead" draggable="true" title="Drag to reorder">
          <span class="wcGrip">⠿</span><span class="wcTitle">${o.names[c.w]}</span>
          <button class="wcBtn wcCol" title="${c.collapsed ? 'Expand' : 'Collapse'}">${c.collapsed ? '▸' : '▾'}</button>
          <button class="wcBtn wcX" title="Remove from dock">✕</button>
        </header>
        <div class="wcBody"></div>
        <div class="wcResize" title="Drag to resize"></div>`;
      if (!c.collapsed) (el.querySelector('.wcBody') as HTMLElement).style.height = `${Math.min(c.h, H - CHROME)}px`;
      const p = pane(c.w);
      if (p && p.closest('.vwidget')) {
        el.querySelector('.wcBody')!.innerHTML = '<div class="empty">Shown in a view.</div>';
      } else if (p) {
        p.classList.add('on');
        el.querySelector('.wcBody')!.appendChild(p);
      }
      colEl!.appendChild(el);
      wireCard(el, c);
    }
    empty.style.display = st.cards.length ? 'none' : '';
    aside.classList.toggle('collapsed', st.hidden);
    aside.style.width = `${Math.max(1, cols.length) * st.width}px`;
    aside.classList.toggle('multi', cols.length > 1);
    rail.querySelectorAll<HTMLButtonElement>('button[data-w]').forEach((b) => b.classList.toggle('on', st.cards.some((c) => c.w === b.dataset.w) && !st.hidden));
    save();
    o.changed();
  }

  function wireCard(el: HTMLElement, c: CardState) {
    (el.querySelector('.wcX') as HTMLButtonElement).onclick = () => api.remove(c.w);
    (el.querySelector('.wcCol') as HTMLButtonElement).onclick = () => {
      c.collapsed = !c.collapsed;
      render();
    };
    const head = el.querySelector('.wcHead') as HTMLElement;
    head.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/scc-widget', c.w);
      e.dataTransfer!.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    head.addEventListener('dragend', () => el.classList.remove('dragging'));
    // vertical resize from the bottom grip
    const grip = el.querySelector('.wcResize') as HTMLElement;
    grip.addEventListener('pointerdown', (e) => {
      if (c.collapsed) return;
      e.preventDefault();
      const body = el.querySelector('.wcBody') as HTMLElement;
      const y0 = e.clientY;
      const h0 = body.getBoundingClientRect().height;
      grip.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        c.h = Math.max(70, Math.min(colHeight() - CHROME, h0 + ev.clientY - y0));
        body.style.height = `${c.h}px`;
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        render(); // may open or fold a column
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }

  // ---------- drop target: the dock column ----------
  const indicator = document.createElement('div');
  indicator.className = 'dropLine';
  /** where a drop at (x, y) would land: the column under the pointer, before the first card below the pointer */
  const dropTarget = (x: number, y: number) => {
    const cols = [...dock.querySelectorAll<HTMLElement>('.dcol')];
    let col = cols[cols.length - 1] ?? null;
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      if (x >= r.left - GAP && x <= r.right + GAP) col = c;
    }
    if (!col) return { col: null as HTMLElement | null, before: null as HTMLElement | null };
    for (const card of col.querySelectorAll<HTMLElement>('.wcard:not(.dragging)')) {
      const r = card.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { col, before: card };
    }
    return { col, before: null as HTMLElement | null };
  };
  aside.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('text/scc-widget')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    aside.classList.add('dropping');
    const { col, before } = dropTarget(e.clientX, e.clientY);
    if (!col) dock.appendChild(indicator);
    else if (before) col.insertBefore(indicator, before);
    else col.appendChild(indicator);
  });
  aside.addEventListener('dragleave', (e) => {
    if (!aside.contains(e.relatedTarget as Node)) {
      aside.classList.remove('dropping');
      indicator.remove();
    }
  });
  aside.addEventListener('drop', (e) => {
    const w = e.dataTransfer?.getData('text/scc-widget');
    aside.classList.remove('dropping');
    if (!w) return;
    e.preventDefault();
    // index among cards excluding the dragged one
    const kids = [...dock.querySelectorAll('.wcard, .dropLine')].filter((x) => x === indicator || (x as HTMLElement).dataset.w !== w);
    const idx = kids.indexOf(indicator);
    indicator.remove();
    api.add(w, idx < 0 ? undefined : idx);
  });

  // ---------- rail: click toggles, drag adds ----------
  rail.querySelectorAll<HTMLButtonElement>('button[data-w]').forEach((b) => {
    b.draggable = true;
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/scc-widget', b.dataset.w!);
      e.dataTransfer!.effectAllowed = 'copyMove';
      if (st.hidden) {
        st.hidden = false;
        aside.classList.remove('collapsed');
      }
    });
    b.onclick = () => api.toggle(b.dataset.w!);
  });

  // ---------- dock width resize & hide ----------
  const wgrip = document.getElementById('dockResize')!;
  wgrip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = aside.getBoundingClientRect().width;
    wgrip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const n = Math.max(1, lastCols);
      st.width = Math.max(220, Math.min(560, (w0 + ev.clientX - x0) / n));
      aside.style.width = `${n * st.width}px`;
      dock.querySelectorAll<HTMLElement>('.dcol').forEach((c) => (c.style.width = `${st.width - 12}px`));
    };
    const up = () => {
      wgrip.removeEventListener('pointermove', move);
      wgrip.removeEventListener('pointerup', up);
      save();
      o.changed();
    };
    wgrip.addEventListener('pointermove', move);
    wgrip.addEventListener('pointerup', up);
  });
  document.getElementById('wClose')!.onclick = () => {
    st.hidden = true;
    render();
  };

  let roT: number | undefined;
  new ResizeObserver(() => {
    clearTimeout(roT);
    roT = window.setTimeout(() => {
      if (layout().length !== lastCols) render();
      else dock.querySelectorAll<HTMLElement>('.wcard:not(.collapsed) .wcBody').forEach((b) => {
        const c = st.cards.find((x) => x.w === (b.closest('.wcard') as HTMLElement).dataset.w);
        if (c) b.style.height = `${Math.min(c.h, colHeight() - CHROME)}px`;
      });
    }, 120);
  }).observe(document.getElementById('dockScroll')!);

  const api: Dock = {
    getState: () => JSON.parse(JSON.stringify(st)),
    setState(s) {
      st = { cards: (s.cards ?? []).filter((c) => o.names[c.w]).map((c) => ({ ...c })), width: s.width ?? 270, hidden: !!s.hidden };
      render();
    },
    open: () => (st.hidden ? [] : st.cards.filter((c) => !c.collapsed).map((c) => c.w)),
    toggle(w) {
      if (st.hidden) {
        st.hidden = false;
        if (!st.cards.some((c) => c.w === w)) st.cards.push({ w, h: 260, collapsed: false });
      } else if (st.cards.some((c) => c.w === w)) st.cards = st.cards.filter((c) => c.w !== w);
      else st.cards.push({ w, h: 260, collapsed: false });
      render();
      cardEl(w)?.scrollIntoView({ block: 'nearest' });
    },
    add(w, index) {
      const existing = st.cards.find((c) => c.w === w);
      st.cards = st.cards.filter((c) => c.w !== w);
      const c = existing ?? { w, h: 260, collapsed: false };
      st.cards.splice(index === undefined ? st.cards.length : Math.min(index, st.cards.length), 0, c);
      st.hidden = false;
      render();
    },
    remove(w) {
      st.cards = st.cards.filter((c) => c.w !== w);
      render();
    },
    body: (w) => cardEl(w)?.querySelector<HTMLElement>('.wcBody') ?? null,
  };
  render();
  return api;
}
