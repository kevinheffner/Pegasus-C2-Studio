/**
 * Workspace layouts: save the widget disposition (dock cards, order, heights, columns, width),
 * the view layout (1 / 4 views + each view's style, 2D/3D, camera sequence, COP) and the layer toggles,
 * under a name or as the default. Stored in ./config/layouts.json via the dev server (falls back to
 * browser storage). The default layout is applied at start-up.
 */
import type { DockLayout } from './dock';
import type { PanelConfig } from './panel';

export interface WorkspaceLayout {
  dock: DockLayout;
  views: { layout: string | number; panels: PanelConfig[]; active: number; colFrac?: number; rowFrac?: number };
  toggles: Record<string, boolean | string>;
  saved: string;
}
interface LayoutFile {
  default: string | null;
  layouts: Record<string, WorkspaceLayout>;
}

const LS = 'scc-layouts-v1';
async function load(): Promise<LayoutFile> {
  try {
    const r = await fetch('/api/layouts');
    if (r.ok) return await r.json();
  } catch {
    /* fall back */
  }
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '') as LayoutFile;
  } catch {
    return { default: null, layouts: {} };
  }
}
async function store(f: LayoutFile) {
  try {
    localStorage.setItem(LS, JSON.stringify(f));
  } catch {
    /* ignore */
  }
  try {
    await fetch('/api/layouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f, null, 1) });
  } catch {
    /* browser storage only */
  }
}

export interface LayoutHost {
  capture(): Omit<WorkspaceLayout, 'saved'>;
  apply(l: WorkspaceLayout): Promise<void>;
}

/** apply the saved default layout (if any); returns its name */
export async function applyDefaultLayout(host: LayoutHost): Promise<string | null> {
  const f = await load();
  if (f.default && f.layouts[f.default]) {
    await host.apply(f.layouts[f.default]);
    return f.default;
  }
  return null;
}

let dlg: HTMLDialogElement | null = null;
export async function openLayouts(host: LayoutHost) {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'dlg small';
    dlg.id = 'layoutsDlg';
    dlg.innerHTML = `
      <div class="dlgHead"><span>▤ WORKSPACE LAYOUTS</span><span class="grow"></span><button class="dlgClose" data-x>✕</button></div>
      <div class="dlgBody">
        <div class="hint">A layout stores the widget dock (which widgets, order, heights, columns, width), the 1/4-view layout with each view's style, 2D/3D, camera sequence and COP setting, and the layer toggles.</div>
        <h2>Save current layout</h2>
        <div class="row"><input id="lyName" type="text" placeholder="Layout name, e.g. Intel cell" class="grow" /><button id="lySave" class="primary small2" style="flex:none;width:auto;margin:0">Save</button></div>
        <div class="row"><button id="lySaveDefault" class="ghost small2">★ Save as default</button><button id="lyFactory" class="ghost small2">↺ Factory default</button></div>
        <h2>Saved layouts</h2>
        <div id="lyList" class="rlist"></div>
        <div class="status" id="lyStatus"></div>
      </div>`;
    document.body.appendChild(dlg);
    (dlg.querySelector('[data-x]') as HTMLButtonElement).onclick = () => dlg!.close();
  }
  const d = dlg;
  const $ = <T extends HTMLElement>(id: string) => d.querySelector('#' + id) as T;
  const status = (s: string) => ($('lyStatus').textContent = s);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  let f = await load();
  const list = () => {
    const names = Object.keys(f.layouts).sort();
    $('lyList').innerHTML = names.length
      ? names
          .map((n) => {
            const l = f.layouts[n];
            const sum = `layout ${l.views.layout} · ${l.dock.cards.map((c) => c.w.toUpperCase()).join(', ') || 'no widgets'}`;
            return `<div class="ritem lyItem"><div class="rt"><span class="rk">${f.default === n ? '★ DEFAULT' : 'LAYOUT'}</span><span>${new Date(l.saved).toLocaleString()}</span></div><div class="rtitle">${esc(n)}</div><div class="hint">${esc(sum)}</div><div class="row"><button data-a="apply" data-n="${esc(n)}" class="ghost small2">Apply</button><button data-a="def" data-n="${esc(n)}" class="ghost small2">${f.default === n ? 'Unset default' : 'Make default'}</button><button data-a="del" data-n="${esc(n)}" class="ghost small2">Delete</button></div></div>`;
          })
          .join('')
      : '<div class="empty">No saved layouts yet.</div>';
    $('lyList').querySelectorAll<HTMLButtonElement>('button[data-a]').forEach(
      (b) =>
        (b.onclick = async () => {
          const n = b.dataset.n!;
          if (b.dataset.a === 'apply') {
            await host.apply(f.layouts[n]);
            status(`Applied "${n}".`);
          } else if (b.dataset.a === 'def') {
            f.default = f.default === n ? null : n;
            await store(f);
            status(f.default ? `"${n}" is now the default layout.` : 'No default layout.');
          } else if (b.dataset.a === 'del' && confirm(`Delete layout "${n}"?`)) {
            delete f.layouts[n];
            if (f.default === n) f.default = null;
            await store(f);
            status(`Deleted "${n}".`);
          }
          list();
        }),
    );
  };
  const saveAs = async (name: string, asDefault: boolean) => {
    f = await load();
    f.layouts[name] = { ...host.capture(), saved: new Date().toISOString() };
    if (asDefault) f.default = name;
    await store(f);
    list();
    status(asDefault ? `Saved "${name}" and set it as the default layout.` : `Saved layout "${name}".`);
  };
  $<HTMLButtonElement>('lySave').onclick = () => {
    const n = $<HTMLInputElement>('lyName').value.trim();
    if (!n) return status('Enter a layout name.');
    if (f.layouts[n] && !confirm(`Overwrite layout "${n}"?`)) return;
    saveAs(n, false);
  };
  $<HTMLButtonElement>('lySaveDefault').onclick = () => saveAs($<HTMLInputElement>('lyName').value.trim() || 'Default', true);
  $<HTMLButtonElement>('lyFactory').onclick = async () => {
    f.default = null;
    await store(f);
    await host.apply({
      dock: { cards: [{ w: 'intel', h: 240, collapsed: false }, { w: 'orbat', h: 240, collapsed: false }], width: 270, hidden: false },
      views: { layout: '1', active: 0, panels: [] },
      toggles: {},
      saved: '',
    });
    list();
    status('Factory layout restored (no default set).');
  };
  $<HTMLInputElement>('lyName').value = '';
  status('');
  list();
  d.showModal();
}
