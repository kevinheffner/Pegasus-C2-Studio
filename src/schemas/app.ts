/**
 * Animated Schemas workbench: projects of animated / still schemas made from prompts and blueprints, edited on the
 * canvas (move, resize, texts, links, narration), styled per project or per item, exported as PNG, storyboard, GIF,
 * MP4, or as a Video Studio schema package. Every frame is a pure function of time, so exports are frame-exact.
 */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { renderSchema, THEMES, VW, VH, DEFAULT_FX, viewTransform, bgReady, type Schema, type Theme, type SNode, type Icon, type Effects } from './engine';
import {
  newProject, newItem, styleOf, narrationOf, listProjects, loadProject, saveProject, deleteProject, listBlueprints, saveBlueprint, deleteBlueprint,
  generateFromPrompt, spread, clone, uid, slug, PROMPT_EXAMPLES, type SchemaProject, type SchemaItem, type Blueprint, type LayoutKind,
} from './model';
import { buildVsPackage } from './vspackage';
import { createEncoder } from '../export/recorder';
import { saveOutput } from '../export/save';
import './schemas.css';

const ICON_LIST: Icon[] = ['c2', 'sim', 'server', 'people', 'doc', 'net', 'clock', 'gear', 'shield', 'plane', 'tank', 'ship', 'chart', 'flag', 'globe', 'eye', 'cube', 'radio', 'book', 'target', 'db'];
const FONTS = ['Segoe UI', 'Arial', 'Georgia', 'Trebuchet MS', 'Verdana', 'Consolas', 'Times New Roman'];
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const toHex = (c: string) => {
  if (c.startsWith('#')) return c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c.slice(0, 7);
  const m = c.match(/[\d.]+/g);
  return m ? '#' + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('') : '#000000';
};

type Target = { kind: 'item'; index: number } | { kind: 'blueprint'; bp: Blueprint };
type Sel = { type: 'node'; id: string } | { type: 'link'; index: number } | null;

export async function initSchemas() {
  const root = document.createElement('div');
  root.id = 'schApp';
  root.innerHTML = `
  <header id="schTop">
    <div class="sys"><span class="schMark">◇</span><span class="schName">Animated Schemas</span><span class="schSub">projects · blueprints · Video Studio</span></div>
    <span class="schProj"><select id="schProject" title="Project"></select><button class="schBtn" id="schNewProj" title="New project">＋ Project</button></span>
    <span class="grow"></span>
    <span id="schSaved" class="schSaved"></span>
  </header>
  <div id="schBody">
    <aside id="schList">
      <div class="schCat">This project <button class="schMini" id="schProjEdit" title="Rename / describe / delete the project">✎</button></div>
      <div id="schProjDesc" class="schProjDesc"></div>
      <div id="schItems"></div>
      <div class="schAddRow"><button class="schBtn" id="schAddPrompt">＋ From prompt</button><button class="schBtn" id="schAddBp">＋ From blueprint</button></div>
      <div class="schCat">Blueprint library <span class="schHint">click to edit</span></div>
      <div id="schBps"></div>
    </aside>
    <main id="schMain">
      <div id="schEditBar">
        <span id="schTargetLbl"></span><span class="grow"></span>
        <label class="schChk"><input type="checkbox" id="schEdit"> ✎ Edit layout</label>
        <label class="schChk"><input type="checkbox" id="schCap" checked> Captions</label>
        <label class="schChk"><input type="checkbox" id="schTitleChk" checked> Title</label>
      </div>
      <div id="schStage"><canvas id="schCanvas" tabindex="0"></canvas><div id="schHelp" class="schEditHelp">Drag to move · drag the corner to resize · double-click a box to edit its text · Delete removes · Ctrl+Z undoes</div></div>
      <div id="schCtl">
        <button id="schPlay" class="schBtn primary">❚❚</button>
        <button id="schRestart" class="schBtn" title="Restart">⟲</button>
        <input type="range" id="schTime" min="0" max="30" step="0.01" value="0" class="grow">
        <span id="schT" class="mono">0.0 s</span>
        <label class="schSel">Speed <select id="schSpeed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
        <label class="schChk"><input type="checkbox" id="schLoop" checked> Loop</label>
      </div>
    </main>
    <aside id="schSide">
      <div class="schTabs">${['Prompt', 'Text', 'Style', 'Video Studio', 'Export'].map((t, i) => `<button class="schTab${i ? '' : ' on'}" data-tab="${i}">${t}</button>`).join('')}</div>
      <div class="schPanel on" data-panel="0" id="pPrompt"></div>
      <div class="schPanel" data-panel="1" id="pText"></div>
      <div class="schPanel" data-panel="2" id="pStyle"></div>
      <div class="schPanel" data-panel="3" id="pVs"></div>
      <div class="schPanel" data-panel="4" id="pExport"></div>
      <div id="schProg"><div id="schBar"></div></div>
      <div id="schStatus"></div>
    </aside>
  </div>
  <div id="schModal" class="schModal" hidden><div class="schModalBox"></div></div>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const q = <T extends HTMLElement = HTMLElement>(sel: string, el: ParentNode = root) => el.querySelector(sel) as T;

  // ------------------------------------------------------------------ state
  let blueprints: Blueprint[] = await listBlueprints();
  let P: SchemaProject;
  let target: Target = { kind: 'item', index: 0 };
  let t = 0;
  let playing = true;
  let busy = false;
  let sel: Sel = null;
  let linking: string | null = null; // node id waiting for the link's other end
  const undo: string[] = [];
  let styleScope: 'project' | 'item' = 'project';

  const item = (): SchemaItem | null => (target.kind === 'item' ? P.items[target.index] ?? null : null);
  const schema = (): Schema => (target.kind === 'item' ? item()!.schema : target.bp.schema);
  const style = (): Theme => (target.kind === 'item' ? styleOf(P, item()) : styleOf(P, null));
  const editing = () => $<HTMLInputElement>('schEdit').checked;
  const opts = () => ({ captions: $<HTMLInputElement>('schCap').checked && !editing(), title: $<HTMLInputElement>('schTitleChk').checked });
  const status = (s: string) => ($('schStatus').textContent = s);
  const prog = (f: number, msg = '') => {
    $('schBar').style.width = `${Math.round(f * 100)}%`;
    $('schProg').style.opacity = f > 0 && f < 1 ? '1' : '0';
    if (msg) status(msg);
  };

  // ------------------------------------------------------------------ saving
  let saveTimer = 0;
  const dirty = (what = 'project') => {
    if (target.kind === 'blueprint' && what !== 'project') {
      $('schSaved').textContent = 'Blueprint changed: save it in the Text tab';
      return;
    }
    $('schSaved').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const ok = await saveProject(P);
      $('schSaved').textContent = ok ? `Saved ${new Date().toLocaleTimeString().slice(0, 5)}` : 'Saved in this browser (server unavailable)';
      renderItems();
    }, 700);
  };
  const snapshot = () => {
    undo.push(JSON.stringify(schema()));
    if (undo.length > 60) undo.shift();
  };
  const changed = () => dirty('schema');

  // ------------------------------------------------------------------ projects
  async function refreshProjects(selectId?: string) {
    let list = await listProjects();
    if (!list.length) {
      const p = newProject('My first schema project', 'Animated schemas on C2–simulation interoperability');
      const bp = blueprints.find((b) => b.id === 'c2sim-overview') ?? blueprints[0];
      p.items.push(newItem(bp.schema));
      await saveProject(p);
      list = await listProjects();
    }
    $<HTMLSelectElement>('schProject').innerHTML = list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.count !== undefined ? ` (${p.count})` : ''}</option>`).join('');
    const id = selectId ?? localStorage.getItem('scc-schema-last') ?? list[0].id;
    $<HTMLSelectElement>('schProject').value = list.some((p) => p.id === id) ? id : list[0].id;
    await openProject($<HTMLSelectElement>('schProject').value);
  }
  async function openProject(id: string) {
    const p = await loadProject(id);
    if (!p) return;
    P = p;
    localStorage.setItem('scc-schema-last', id);
    if (!P.items.length) P.items.push(newItem(blueprints[0].schema));
    target = { kind: 'item', index: 0 };
    select();
  }
  $<HTMLSelectElement>('schProject').onchange = () => openProject($<HTMLSelectElement>('schProject').value);
  $('schNewProj').onclick = () =>
    modal(
      'New schema project',
      `<label>Name<input type="text" id="mName" placeholder="e.g. C2SIM briefing for the coalition exercise"></label>
       <label>Description<textarea id="mDesc" rows="2" placeholder="Purpose, audience, where it will be used"></textarea></label>
       <label>What should the first image or animation show? (prompt)<textarea id="mPrompt" rows="4" placeholder="Describe the content and the message…"></textarea></label>`,
      async () => {
        const name = $<HTMLInputElement>('mName').value.trim() || 'Untitled project';
        const p = newProject(name, $<HTMLTextAreaElement>('mDesc').value.trim(), $<HTMLTextAreaElement>('mPrompt').value.trim());
        p.style = clone(P?.style ?? THEMES[0]);
        const r = p.prompt ? generateFromPrompt(p.prompt, { layout: 'auto', blueprints }) : { schema: blueprints[0].schema, note: '' };
        p.items.push(newItem(r.schema, p.prompt));
        await saveProject(p);
        await refreshProjects(p.id);
        if (r.note) status(r.note);
      },
    );
  $('schProjEdit').onclick = () =>
    modal(
      'Project',
      `<label>Name<input type="text" id="mName" value="${esc(P.name)}"></label>
       <label>Description<textarea id="mDesc" rows="3">${esc(P.description)}</textarea></label>
       <p class="schHint">Project file: schemas/projects/${esc(P.id)}.json</p>
       <button class="schBtn danger" id="mDel">Delete this project…</button>`,
      async () => {
        P.name = $<HTMLInputElement>('mName').value.trim() || P.name;
        P.description = $<HTMLTextAreaElement>('mDesc').value.trim();
        await saveProject(P);
        await refreshProjects(P.id);
      },
      () => {
        $('mDel').onclick = async () => {
          if (!confirm(`Delete the project “${P.name}” and its ${P.items.length} item(s)?`)) return;
          await deleteProject(P.id);
          closeModal();
          localStorage.removeItem('scc-schema-last');
          await refreshProjects();
        };
      },
    );

  // ------------------------------------------------------------------ modal
  function modal(title: string, html: string, ok: () => void | Promise<void>, init?: () => void, okLabel = 'OK') {
    const box = q('.schModalBox');
    box.innerHTML = `<h3>${esc(title)}</h3>${html}<div class="schModalBtns"><button class="schBtn" id="mCancel">Cancel</button><button class="schBtn primary" id="mOk">${okLabel}</button></div>`;
    $('schModal').hidden = false;
    $('mCancel').onclick = closeModal;
    $('mOk').onclick = async () => {
      await ok();
      closeModal();
    };
    init?.();
    (box.querySelector('input,textarea') as HTMLElement | null)?.focus();
  }
  const closeModal = () => ($('schModal').hidden = true);

  // ------------------------------------------------------------------ left lists
  function thumb(s: Schema, th: Theme) {
    const c = document.createElement('canvas');
    c.width = 192;
    c.height = 108;
    renderSchema(c.getContext('2d')!, s, s.duration, th, 192, 108, { captions: false, title: true });
    return c.toDataURL('image/jpeg', 0.7);
  }
  function renderItems() {
    $('schProjDesc').textContent = P.description || '';
    $('schItems').innerHTML = P.items
      .map(
        (it, i) => `<div class="schItem2${target.kind === 'item' && target.index === i ? ' on' : ''}" data-i="${i}">
        <img src="${thumb(it.schema, styleOf(P, it))}" alt="">
        <div class="schItemTxt"><b>${esc(it.schema.title)}</b><span>${it.kind === 'animation' ? `▶ animation · ${it.schema.duration}s` : '🖼 image'}${it.style ? ' · own style' : ''}${it.vs.scene ? ` · VS scene ${esc(it.vs.scene)}` : ''}</span></div>
        <div class="schItemBtns"><button class="schMini" data-up="${i}" title="Move up">▲</button><button class="schMini" data-dup="${i}" title="Duplicate">⧉</button><button class="schMini" data-del="${i}" title="Delete">✕</button></div></div>`,
      )
      .join('');
    root.querySelectorAll<HTMLElement>('.schItem2').forEach(
      (el) =>
        (el.onclick = (e) => {
          const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
          const i = Number(el.dataset.i);
          if (b?.dataset.del) {
            if (!confirm(`Delete “${P.items[i].schema.title}” from the project?`)) return;
            P.items.splice(i, 1);
            if (!P.items.length) P.items.push(newItem(blueprints[0].schema));
            target = { kind: 'item', index: Math.min(i, P.items.length - 1) };
            dirty();
            return select();
          }
          if (b?.dataset.dup) {
            const c = clone(P.items[i]);
            c.id = uid();
            c.schema.title += ' (copy)';
            P.items.splice(i + 1, 0, c);
            target = { kind: 'item', index: i + 1 };
            dirty();
            return select();
          }
          if (b?.dataset.up) {
            if (i > 0) [P.items[i - 1], P.items[i]] = [P.items[i], P.items[i - 1]];
            target = { kind: 'item', index: Math.max(0, i - 1) };
            dirty();
            return select();
          }
          target = { kind: 'item', index: i };
          select();
        }),
    );
  }
  function renderBlueprints() {
    const cats = [...new Set(blueprints.map((b) => (b.builtin ? b.schema.category : 'My blueprints')))];
    $('schBps').innerHTML = cats
      .map(
        (c) =>
          `<div class="schBpCat">${esc(c)}</div>` +
          blueprints
            .filter((b) => (b.builtin ? b.schema.category : 'My blueprints') === c)
            .map((b) => `<button class="schItem${target.kind === 'blueprint' && target.bp.id === b.id ? ' on' : ''}" data-bp="${esc(b.id)}" title="${esc(b.schema.description)}"><b>${esc(b.schema.title)}${b.edited ? ' <em class="schEdited">edited</em>' : ''}</b></button>`)
            .join(''),
      )
      .join('');
    root.querySelectorAll<HTMLButtonElement>('[data-bp]').forEach(
      (b) =>
        (b.onclick = () => {
          const bp = blueprints.find((x) => x.id === b.dataset.bp)!;
          target = { kind: 'blueprint', bp: { ...bp, schema: clone(bp.schema) } };
          select();
        }),
    );
  }
  $('schAddBp').onclick = () =>
    modal(
      'Add from a blueprint',
      `<div class="schBpGrid">${blueprints.map((b) => `<label class="schBpPick"><input type="radio" name="bp" value="${esc(b.id)}"><img src="${thumb(b.schema, P.style)}"><span>${esc(b.schema.title)}</span></label>`).join('')}</div>`,
      () => {
        const id = (q<HTMLInputElement>('input[name=bp]:checked') as HTMLInputElement | null)?.value;
        const bp = blueprints.find((b) => b.id === id);
        if (!bp) return;
        P.items.push(newItem(bp.schema));
        target = { kind: 'item', index: P.items.length - 1 };
        dirty();
        select();
      },
      undefined,
      'Add',
    );
  $('schAddPrompt').onclick = () => {
    tab(0);
    $<HTMLTextAreaElement>('ppText').focus();
  };

  // ------------------------------------------------------------------ select / refresh everything
  function select() {
    sel = null;
    linking = null;
    undo.length = 0;
    t = editing() ? schema().duration : 0;
    playing = !editing();
    $<HTMLInputElement>('schTime').max = String(schema().duration);
    $('schTargetLbl').innerHTML =
      target.kind === 'item'
        ? `<b>${esc(P.name)}</b> › ${esc(schema().title)}`
        : `<b>Blueprint</b> › ${esc(schema().title)} <em class="schHint">${target.bp.builtin ? (target.bp.edited ? 'built-in, edited copy' : 'built-in') : 'my blueprint'}</em>`;
    renderItems();
    renderBlueprints();
    renderPrompt();
    renderText();
    renderStyle();
    renderVs();
    renderExport();
    history.replaceState(null, '', `?module=schemas`);
  }

  // ------------------------------------------------------------------ canvas & playback
  const canvas = $<HTMLCanvasElement>('schCanvas');
  function fitCanvas() {
    const st = $('schStage');
    const w = st.clientWidth, h = st.clientHeight;
    const cw = Math.max(100, Math.min(w, (h * VW) / VH)), ch = (cw * VH) / VW;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  new ResizeObserver(fitCanvas).observe($('schStage'));
  let last = 0;
  function loop(ts: number) {
    const dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    if (P && !busy) {
      const sc = schema();
      if (playing && !editing()) {
        t += dt * Number($<HTMLSelectElement>('schSpeed').value);
        if (t > sc.duration) {
          if ($<HTMLInputElement>('schLoop').checked) t = 0;
          else (t = sc.duration), (playing = false);
        }
      }
      const g = canvas.getContext('2d')!;
      renderSchema(g, sc, t, style(), canvas.width, canvas.height, opts());
      if (editing()) drawEditOverlay(g);
      $<HTMLInputElement>('schTime').value = String(t);
      $('schT').textContent = `${t.toFixed(1)} / ${sc.duration} s`;
      $('schPlay').textContent = playing ? '❚❚' : '▶';
    }
    requestAnimationFrame(loop);
  }
  $('schPlay').onclick = () => {
    if (editing()) $<HTMLInputElement>('schEdit').click();
    if (t >= schema().duration) t = 0;
    playing = !playing;
  };
  $('schRestart').onclick = () => ((t = 0), (playing = true));
  $<HTMLInputElement>('schTime').oninput = () => ((t = Number($<HTMLInputElement>('schTime').value)), (playing = false));
  $<HTMLInputElement>('schEdit').onchange = () => {
    root.classList.toggle('editing', editing());
    if (editing()) (t = schema().duration), (playing = false);
    sel = null;
    renderText();
  };

  // ------------------------------------------------------------------ canvas editing
  const toVirtual = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const { k, ox, oy } = viewTransform(r.width, r.height);
    return { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k };
  };
  const hitNode = (x: number, y: number): SNode | null => {
    const ns = schema().nodes;
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      if (n.shape === 'group') continue;
      if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
    }
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      if (n.shape !== 'group') continue;
      const edge = Math.min(Math.abs(x - n.x), Math.abs(x - n.x - n.w), Math.abs(y - n.y), Math.abs(y - n.y - n.h));
      if (x >= n.x - 8 && x <= n.x + n.w + 8 && y >= n.y - 8 && y <= n.y + n.h + 8 && (edge < 14 || y < n.y + 44)) return n;
    }
    return null;
  };
  const hitLink = (x: number, y: number): number => {
    const sc = schema();
    const c = (id: string) => {
      const n = sc.nodes.find((m) => m.id === id);
      return n ? [n.x + n.w / 2, n.y + n.h / 2] : [0, 0];
    };
    let best = -1, bd = 14;
    sc.links.forEach((l, i) => {
      const [ax, ay] = c(l.a), [bx, by] = c(l.b);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const mx = (ax + bx) / 2 + (-(by - ay) / len) * (l.bend ?? 0), my = (ay + by) / 2 + ((bx - ax) / len) * (l.bend ?? 0);
      for (let u = 0; u <= 1; u += 0.04) {
        const px = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * bx, py = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * by;
        const d = Math.hypot(px - x, py - y);
        if (d < bd) (bd = d), (best = i);
      }
    });
    return best;
  };
  let drag: { mode: 'move' | 'resize'; id: string; dx: number; dy: number; x0: number; y0: number; w0: number; h0: number; moved: boolean } | null = null;
  const snap = (v: number) => Math.round(v / 10) * 10;
  canvas.addEventListener('mousedown', (e) => {
    if (!editing()) return;
    canvas.focus();
    const { x, y } = toVirtual(e);
    const n = hitNode(x, y);
    if (linking && n && n.id !== linking) {
      snapshot();
      schema().links.push({ a: linking, b: n.id, at: Math.max(nodeAt(linking), n.at ?? 0) + 0.3 });
      sel = { type: 'link', index: schema().links.length - 1 };
      linking = null;
      changed();
      return renderText();
    }
    linking = null;
    if (n) {
      sel = { type: 'node', id: n.id };
      const corner = x > n.x + n.w - 22 && y > n.y + n.h - 22;
      drag = { mode: corner ? 'resize' : 'move', id: n.id, dx: x - n.x, dy: y - n.y, x0: n.x, y0: n.y, w0: n.w, h0: n.h, moved: false };
    } else {
      const li = hitLink(x, y);
      sel = li >= 0 ? { type: 'link', index: li } : null;
    }
    renderText();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) {
      if (editing() && e.target === canvas) {
        const { x, y } = toVirtual(e);
        const n = hitNode(x, y);
        canvas.style.cursor = linking ? 'crosshair' : n ? (x > n.x + n.w - 22 && y > n.y + n.h - 22 ? 'nwse-resize' : 'move') : hitLink(x, y) >= 0 ? 'pointer' : 'default';
      }
      return;
    }
    const n = schema().nodes.find((m) => m.id === drag!.id);
    if (!n) return;
    const { x, y } = toVirtual(e);
    if (!drag.moved) snapshot();
    drag.moved = true;
    if (drag.mode === 'move') {
      const nx = snap(x - drag.dx), ny = snap(y - drag.dy);
      const ddx = nx - n.x, ddy = ny - n.y;
      // moving a group moves what is inside it
      if (n.shape === 'group' && (ddx || ddy))
        for (const m of schema().nodes)
          if (m !== n && m.x >= n.x && m.x + m.w <= n.x + n.w && m.y >= n.y && m.y + m.h <= n.y + n.h) (m.x += ddx), (m.y += ddy);
      n.x = nx;
      n.y = ny;
    } else {
      n.w = Math.max(60, snap(x - n.x));
      n.h = Math.max(40, snap(y - n.y));
      if (n.shape === 'circle') n.h = n.w;
    }
  });
  window.addEventListener('mouseup', () => {
    if (drag?.moved) {
      changed();
      renderText();
      renderItems();
    }
    drag = null;
  });
  canvas.addEventListener('dblclick', (e) => {
    if (!editing()) return;
    const v = toVirtual(e);
    const n = hitNode(v.x, v.y);
    if (!n) return;
    sel = { type: 'node', id: n.id };
    tab(1);
    renderText();
    setTimeout(() => (document.getElementById('eLabel') as HTMLInputElement | null)?.select(), 30);
  });
  canvas.addEventListener('keydown', (e) => {
    if (!editing()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      return doUndo();
    }
    if (!sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return removeSel();
    }
    const d: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
    if (d[e.key] && sel.type === 'node') {
      e.preventDefault();
      const s0 = sel;
      const n = schema().nodes.find((m) => m.id === s0.id)!;
      snapshot();
      n.x += d[e.key][0];
      n.y += d[e.key][1];
      changed();
    }
  });
  const nodeAt = (id: string) => schema().nodes.find((n) => n.id === id)?.at ?? 0;
  function doUndo() {
    const s = undo.pop();
    if (!s) return status('Nothing to undo.');
    const restored = JSON.parse(s) as Schema;
    if (target.kind === 'item') item()!.schema = restored;
    else target.bp.schema = restored;
    sel = null;
    changed();
    renderText();
  }
  function removeSel() {
    const sc = schema();
    if (!sel) return;
    snapshot();
    if (sel.type === 'node') {
      const id = sel.id;
      sc.nodes = sc.nodes.filter((n) => n.id !== id);
      sc.links = sc.links.filter((l) => l.a !== id && l.b !== id);
      sc.highlights = (sc.highlights ?? []).map((h) => ({ ...h, ids: h.ids.filter((x) => x !== id) }));
    } else sc.links.splice(sel.index, 1);
    sel = null;
    changed();
    renderText();
  }
  function drawEditOverlay(g: CanvasRenderingContext2D) {
    const { k, ox, oy } = viewTransform(canvas.width, canvas.height);
    g.save();
    g.setTransform(k, 0, 0, k, ox, oy);
    g.strokeStyle = 'rgba(242,184,75,0.25)';
    g.setLineDash([4, 6]);
    g.lineWidth = 1;
    for (const n of schema().nodes) g.strokeRect(n.x, n.y, n.w, n.h);
    g.setLineDash([]);
    const sc = schema();
    if (sel?.type === 'node') {
      const s0 = sel;
      const n = sc.nodes.find((m) => m.id === s0.id);
      if (n) {
        g.strokeStyle = '#f2b84b';
        g.lineWidth = 3;
        g.setLineDash([10, 6]);
        g.strokeRect(n.x - 6, n.y - 6, n.w + 12, n.h + 12);
        g.setLineDash([]);
        g.fillStyle = '#f2b84b';
        g.fillRect(n.x + n.w - 12, n.y + n.h - 12, 18, 18);
      }
    }
    if (sel?.type === 'link') {
      const l = sc.links[sel.index];
      const A = sc.nodes.find((m) => m.id === l?.a), B = sc.nodes.find((m) => m.id === l?.b);
      if (A && B) {
        g.strokeStyle = '#f2b84b';
        g.lineWidth = 8;
        g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(A.x + A.w / 2, A.y + A.h / 2);
        g.lineTo(B.x + B.w / 2, B.y + B.h / 2);
        g.stroke();
      }
    }
    if (linking) {
      const A = sc.nodes.find((m) => m.id === linking);
      if (A) {
        g.globalAlpha = 1;
        g.font = '600 24px Segoe UI';
        g.fillStyle = '#f2b84b';
        g.fillText('Click the box to link to…', A.x, A.y - 16);
      }
    }
    g.restore();
  }

  // ------------------------------------------------------------------ tabs
  const tab = (i: number) => {
    root.querySelectorAll('.schTab').forEach((b, k) => b.classList.toggle('on', k === i));
    root.querySelectorAll('.schPanel').forEach((b, k) => b.classList.toggle('on', k === i));
  };
  root.querySelectorAll<HTMLButtonElement>('.schTab').forEach((b) => (b.onclick = () => tab(Number(b.dataset.tab))));

  // ------------------------------------------------------------------ Prompt panel
  function renderPrompt() {
    const p = $('pPrompt');
    p.innerHTML = `
      <div class="schHead">Describe the image or animation</div>
      <textarea id="ppText" rows="9" placeholder="What should it show, for whom, and what is the message?\n\nFree text works (e.g. “Show how C2SIM connects national C2 systems and simulations”). For full control use lines like:\nTitle: …\nLayout: flow | cycle | hub | layers | columns\n- Element: short description\nA -> B : label\nGroup: name\nNarration: one sentence per line\nMessage: the takeaway">${esc(item()?.prompt ?? '')}</textarea>
      <div class="schRow"><label class="schSel">Layout <select id="ppLayout">${['auto', 'flow', 'cycle', 'hub', 'layers', 'columns'].map((l) => `<option>${l}</option>`).join('')}</select></label>
      <label class="schSel">Length <input type="number" id="ppDur" min="8" max="180" placeholder="auto" style="width:70px"> s</label></div>
      <div class="schRow"><select id="ppEx"><option value="">Example prompts…</option>${PROMPT_EXAMPLES.map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join('')}</select></div>
      <div class="schRow wrap"><button class="schBtn primary" id="ppNew">＋ New item from prompt</button><button class="schBtn" id="ppReplace" ${target.kind === 'item' ? '' : 'disabled'}>↻ Replace this item</button></div>
      <div id="ppNote" class="schNote"></div>
      <div class="schHead">Project</div>
      <div class="schHint">The project prompt describes the overall content and messaging; new items start from it when the box above is empty.</div>
      <textarea id="ppProject" rows="3" placeholder="Overall content, audience and message of this project">${esc(P.prompt)}</textarea>
      <div class="schHint">Generation runs locally from your text and the blueprint library; no AI service or key is used.</div>`;
    $<HTMLSelectElement>('ppEx').onchange = () => {
      const ex = PROMPT_EXAMPLES[Number($<HTMLSelectElement>('ppEx').value)];
      if (ex) $<HTMLTextAreaElement>('ppText').value = ex[1];
    };
    $<HTMLTextAreaElement>('ppProject').onchange = () => {
      P.prompt = $<HTMLTextAreaElement>('ppProject').value;
      dirty();
    };
    const gen = () => {
      const text = $<HTMLTextAreaElement>('ppText').value.trim() || P.prompt;
      if (!text) return null;
      const d = Number($<HTMLInputElement>('ppDur').value) || undefined;
      return { text, ...generateFromPrompt(text, { layout: $<HTMLSelectElement>('ppLayout').value as LayoutKind, duration: d, blueprints }) };
    };
    $('ppNew').onclick = () => {
      const r = gen();
      if (!r) return ($('ppNote').textContent = 'Write a prompt first.');
      P.items.push(newItem(r.schema, r.text));
      target = { kind: 'item', index: P.items.length - 1 };
      dirty();
      select();
      $('ppNote').textContent = r.note;
    };
    $('ppReplace').onclick = () => {
      const r = gen();
      if (!r || target.kind !== 'item') return;
      if (!confirm('Replace the content of this item? (Its style and Video Studio settings are kept.)')) return;
      item()!.schema = r.schema;
      item()!.prompt = r.text;
      dirty();
      select();
      $('ppNote').textContent = r.note;
    };
  }

  // ------------------------------------------------------------------ Text panel (content, elements, narration)
  function renderText() {
    const sc = schema();
    const p = $('pText');
    const n = sel?.type === 'node' ? sc.nodes.find((m) => m.id === (sel as { id: string }).id) : null;
    const l = sel?.type === 'link' ? sc.links[(sel as { index: number }).index] : null;
    const swatches = (cur: number | undefined, id: string) =>
      `<div class="schSw" id="${id}">${style().accents.map((c, i) => `<button class="${cur === i ? 'on' : ''}" data-c="${i}" style="background:${c}"></button>`).join('')}</div>`;
    p.innerHTML = `
      <div class="schHead">${target.kind === 'blueprint' ? 'Blueprint' : 'Item'}</div>
      <label>Title<input type="text" id="tTitle" value="${esc(sc.title)}"></label>
      <label>Subtitle<input type="text" id="tSub" value="${esc(sc.subtitle)}"></label>
      <div class="schRow"><label class="schSel">Length <input type="number" id="tDur" min="3" max="300" value="${sc.duration}" style="width:70px"> s</label>
      ${target.kind === 'blueprint' ? `<label class="schSel">Category <input type="text" id="tCat" value="${esc(sc.category)}" style="width:120px"></label>` : ''}</div>
      <div class="schHead">Elements ${editing() ? '' : '<span class="schHint">turn on ✎ Edit layout to move and select</span>'}</div>
      <div class="schRow wrap"><button class="schBtn" id="tAddBox">＋ Box</button><button class="schBtn" id="tAddGroup">＋ Group</button><button class="schBtn" id="tAddLink" ${n ? '' : 'disabled'}>↗ Link from selected</button><button class="schBtn" id="tDel" ${sel ? '' : 'disabled'}>✕ Delete</button><button class="schBtn" id="tUndo">↶ Undo</button></div>
      ${
        n
          ? `<div class="schBox">
        <label>Text<input type="text" id="eLabel" value="${esc(n.label)}"></label>
        ${n.shape === 'group' ? '' : `<label>Second line<input type="text" id="eSub" value="${esc(n.sub ?? '')}"></label>`}
        <div class="schRow"><label class="schSel">Shape <select id="eShape">${['box', 'pill', 'circle', 'state', 'layer', 'group'].map((s) => `<option ${(n.shape ?? 'box') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="schSel">Icon <select id="eIcon"><option value="">none</option>${ICON_LIST.map((i) => `<option ${n.icon === i ? 'selected' : ''}>${i}</option>`).join('')}</select></label></div>
        <div class="schRow"><span class="schLbl">Colour</span>${swatches(n.c, 'eColor')}</div>
        <div class="schRow"><label class="schSel">Appears at <input type="number" id="eAt" step="0.1" min="0" value="${n.at ?? 0}" style="width:64px"> s</label><label class="schSel">Text size <input type="number" id="eSize" min="12" max="48" value="${n.size ?? ''}" placeholder="auto" style="width:60px"></label></div>
        <div class="schRow"><label class="schSel">x <input type="number" id="eX" value="${n.x}" style="width:62px"></label><label class="schSel">y <input type="number" id="eY" value="${n.y}" style="width:62px"></label><label class="schSel">w <input type="number" id="eW" value="${n.w}" style="width:62px"></label><label class="schSel">h <input type="number" id="eH" value="${n.h}" style="width:62px"></label></div>
        <label class="schChk"><input type="checkbox" id="eHl" ${(sc.highlights ?? []).some((h) => h.ids.includes(n.id) && t >= h.t0 && t <= h.t1) ? 'checked' : ''}> Highlight during the narration line at ${t.toFixed(1)} s</label>
      </div>`
          : ''
      }
      ${
        l
          ? `<div class="schBox">
        <div class="schHint">Link: ${esc(sc.nodes.find((m) => m.id === l.a)?.label ?? l.a)} → ${esc(sc.nodes.find((m) => m.id === l.b)?.label ?? l.b)}</div>
        <label>Label<input type="text" id="lLabel" value="${esc(l.label ?? '')}"></label>
        <div class="schRow"><span class="schLbl">Colour</span>${swatches(l.c, 'lColor')}<button class="schMini" id="lNoColor" title="Default colour">∅</button></div>
        <div class="schRow wrap"><label class="schChk"><input type="checkbox" id="lDash" ${l.dashed ? 'checked' : ''}> dashed</label><label class="schChk"><input type="checkbox" id="lTwo" ${l.two ? 'checked' : ''}> two-way</label><label class="schChk"><input type="checkbox" id="lNone" ${l.none ? 'checked' : ''}> no arrows</label><button class="schMini" id="lFlip" title="Reverse direction">⇄</button></div>
        <div class="schRow"><label class="schSel">Curve <input type="range" id="lBend" min="-300" max="300" step="10" value="${l.bend ?? 0}"></label><label class="schSel">Appears <input type="number" id="lAt" step="0.1" value="${l.at ?? 0}" style="width:60px"> s</label></div>
        <div class="schHead2">Messages travelling on this link</div>
        ${(l.flows ?? [])
          .map(
            (f, i) => `<div class="schFlow" data-f="${i}"><input type="text" class="fLabel" value="${esc(f.label ?? '')}" placeholder="label (empty = dot)">
            <label>from <input type="number" class="fT0" step="0.5" value="${f.t0}"></label><label>every <input type="number" class="fEvery" step="0.5" value="${f.every ?? ''}" placeholder="once"></label><label>until <input type="number" class="fUntil" step="0.5" value="${f.until ?? ''}" placeholder="end"></label>
            <label class="schChk"><input type="checkbox" class="fRev" ${f.dir === -1 ? 'checked' : ''}> reverse</label>${swatches(f.c, 'fc' + i)}<button class="schMini fDel">✕</button></div>`,
          )
          .join('')}
        <button class="schBtn" id="lAddFlow">＋ Message</button>
      </div>`
          : ''
      }
      <div class="schHead">Narration and captions <span class="schHint">one line per step; shown as captions, sent to Video Studio as narration</span></div>
      <div id="tCaps">${sc.captions
        .map((c, i) => `<div class="schCap" data-i="${i}"><input type="number" class="cT" step="0.1" value="${c.t}" title="time (s)"><textarea class="cText" rows="2">${esc(c.text)}</textarea><div class="schCapBtns"><button class="schMini cNow" title="Set to the current time">⏱</button><button class="schMini cGo" title="Go to this line">▶</button><button class="schMini cDel" title="Delete">✕</button></div></div>`)
        .join('')}</div>
      <div class="schRow wrap"><button class="schBtn" id="tAddCap">＋ Line at ${t.toFixed(1)} s</button><button class="schBtn" id="tSpread" title="Spread the lines evenly over the length">⇹ Spread evenly</button></div>
      <div class="schHead">Save</div>
      <div class="schRow wrap">
        ${target.kind === 'blueprint' ? `<button class="schBtn primary" id="tSaveBp">💾 Save blueprint</button>${target.bp.edited ? '<button class="schBtn" id="tResetBp">↺ Reset to original</button>' : ''}${!target.bp.builtin ? '<button class="schBtn danger" id="tDelBp">Delete blueprint</button>' : ''}<button class="schBtn" id="tBpToProj">＋ Add to project</button>` : ''}
        <button class="schBtn" id="tSaveAsBp">💾 Save as new blueprint…</button>
      </div>`;
    const bind = (id: string, fn: (v: string, el: HTMLInputElement) => void, ev: 'input' | 'change' = 'input') => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.addEventListener(ev, () => fn(el.value, el));
    };
    let snapped = false;
    const edit = (fn: () => void) => {
      if (!snapped) snapshot(), (snapped = true);
      fn();
      changed();
    };
    bind('tTitle', (v) => edit(() => (sc.title = v)));
    bind('tSub', (v) => edit(() => (sc.subtitle = v)));
    bind('tDur', (v) => edit(() => ((sc.duration = Math.max(3, Number(v) || sc.duration)), ($<HTMLInputElement>('schTime').max = String(sc.duration)))), 'change');
    bind('tCat', (v) => edit(() => (sc.category = v)));
    $('tAddBox').onclick = () => {
      snapshot();
      const id = 'n' + uid().slice(0, 5);
      sc.nodes.push({ id, x: 760, y: 470, w: 400, h: 130, label: 'New box', sub: 'description', icon: 'cube', c: sc.nodes.length % 7, at: Math.max(0, Math.min(t, sc.duration - 1)) });
      sel = { type: 'node', id };
      if (!editing()) $<HTMLInputElement>('schEdit').click();
      changed();
      renderText();
    };
    $('tAddGroup').onclick = () => {
      snapshot();
      const id = 'g' + uid().slice(0, 5);
      sc.nodes.unshift({ id, shape: 'group', x: 600, y: 300, w: 700, h: 460, label: 'Group', c: 0, at: 0.5 });
      sel = { type: 'node', id };
      if (!editing()) $<HTMLInputElement>('schEdit').click();
      changed();
      renderText();
    };
    $('tAddLink').onclick = () => {
      if (sel?.type !== 'node') return;
      linking = sel.id;
      status('Now click the box the link goes to.');
    };
    $('tDel').onclick = removeSel;
    $('tUndo').onclick = doUndo;
    if (n) {
      bind('eLabel', (v) => edit(() => (n.label = v)));
      bind('eSub', (v) => edit(() => (n.sub = v || undefined)));
      bind('eShape', (v) => edit(() => ((n.shape = v === 'box' ? undefined : (v as SNode['shape'])), v === 'circle' && (n.h = n.w))), 'change');
      bind('eIcon', (v) => edit(() => (n.icon = (v || undefined) as Icon | undefined)), 'change');
      bind('eAt', (v) => edit(() => (n.at = Number(v) || 0)));
      bind('eSize', (v) => edit(() => (n.size = Number(v) || undefined)));
      for (const k of ['x', 'y', 'w', 'h'] as const) bind('e' + k.toUpperCase(), (v) => edit(() => (n[k] = Number(v) || n[k])));
      root.querySelectorAll<HTMLButtonElement>('#eColor button').forEach((b) => (b.onclick = () => (edit(() => (n.c = Number(b.dataset.c))), renderText())));
      bind(
        'eHl',
        (_v, el) =>
          edit(() => {
            const idx = sc.captions.map((c, i) => (c.t <= t ? i : -1)).filter((i) => i >= 0).pop();
            const t0 = idx === undefined ? 0 : sc.captions[idx].t;
            const t1 = idx === undefined ? sc.captions[0]?.t ?? sc.duration : sc.captions[idx + 1]?.t ?? sc.duration;
            sc.highlights = sc.highlights ?? [];
            let h = sc.highlights.find((x) => x.t0 === t0 && x.t1 === t1);
            if (!h) sc.highlights.push((h = { t0, t1, ids: [] }));
            h.ids = el.checked ? [...new Set([...h.ids, n.id])] : h.ids.filter((x) => x !== n.id);
          }),
        'change',
      );
    }
    if (l) {
      bind('lLabel', (v) => edit(() => (l.label = v || undefined)));
      bind('lDash', (_v, el) => edit(() => (l.dashed = el.checked)), 'change');
      bind('lTwo', (_v, el) => edit(() => (l.two = el.checked)), 'change');
      bind('lNone', (_v, el) => edit(() => (l.none = el.checked)), 'change');
      bind('lBend', (v) => edit(() => (l.bend = Number(v))));
      bind('lAt', (v) => edit(() => (l.at = Number(v) || 0)));
      $('lFlip').onclick = () => (edit(() => ([l.a, l.b] = [l.b, l.a])), renderText());
      $('lNoColor').onclick = () => (edit(() => (l.c = undefined)), renderText());
      root.querySelectorAll<HTMLButtonElement>('#lColor button').forEach((b) => (b.onclick = () => (edit(() => (l.c = Number(b.dataset.c))), renderText())));
      $('lAddFlow').onclick = () => (edit(() => (l.flows = [...(l.flows ?? []), { label: 'MSG', c: 0, t0: Math.round(t), every: 3 }])), renderText());
      root.querySelectorAll<HTMLElement>('.schFlow').forEach((row) => {
        const f = l.flows![Number(row.dataset.f)];
        const num = (cls: string, k: 't0' | 'every' | 'until') =>
          row.querySelector<HTMLInputElement>(cls)!.addEventListener('input', (e) =>
            edit(() => {
              const v = (e.target as HTMLInputElement).value;
              if (k === 't0') f.t0 = Number(v) || 0;
              else f[k] = v === '' ? undefined : Number(v);
            }),
          );
        row.querySelector<HTMLInputElement>('.fLabel')!.addEventListener('input', (e) => edit(() => (f.label = (e.target as HTMLInputElement).value || undefined)));
        num('.fT0', 't0');
        num('.fEvery', 'every');
        num('.fUntil', 'until');
        row.querySelector<HTMLInputElement>('.fRev')!.addEventListener('change', (e) => edit(() => (f.dir = (e.target as HTMLInputElement).checked ? -1 : 1)));
        row.querySelectorAll<HTMLButtonElement>('.schSw button').forEach((b) => (b.onclick = () => (edit(() => (f.c = Number(b.dataset.c))), renderText())));
        row.querySelector<HTMLButtonElement>('.fDel')!.onclick = () => (edit(() => l.flows!.splice(Number(row.dataset.f), 1)), renderText());
      });
    }
    // captions
    root.querySelectorAll<HTMLElement>('.schCap').forEach((row) => {
      const i = Number(row.dataset.i);
      const c = sc.captions[i];
      row.querySelector<HTMLInputElement>('.cT')!.addEventListener('change', (e) => (edit(() => ((c.t = Number((e.target as HTMLInputElement).value) || 0), sc.captions.sort((a, b) => a.t - b.t))), renderText()));
      row.querySelector<HTMLTextAreaElement>('.cText')!.addEventListener('input', (e) => edit(() => (c.text = (e.target as HTMLTextAreaElement).value)));
      row.querySelector<HTMLButtonElement>('.cNow')!.onclick = () => (edit(() => ((c.t = Math.round(t * 10) / 10), sc.captions.sort((a, b) => a.t - b.t))), renderText());
      row.querySelector<HTMLButtonElement>('.cGo')!.onclick = () => {
        if (editing()) $<HTMLInputElement>('schEdit').click();
        t = c.t + 0.6;
        playing = false;
      };
      row.querySelector<HTMLButtonElement>('.cDel')!.onclick = () => (edit(() => sc.captions.splice(i, 1)), renderText());
    });
    $('tAddCap').onclick = () => (edit(() => (sc.captions.push({ t: Math.round(t * 10) / 10, text: 'New narration line.' }), sc.captions.sort((a, b) => a.t - b.t))), renderText());
    $('tSpread').onclick = () => (edit(() => (sc.captions = spread(sc.captions.map((c) => c.text), sc.duration))), renderText());
    // saving blueprints
    const doSaveBp = async (s: Schema, msg: string) => {
      const ok = await saveBlueprint(s);
      blueprints = await listBlueprints();
      if (target.kind === 'blueprint' && target.bp.id === s.id) {
        const nb = blueprints.find((b) => b.id === s.id);
        if (nb) target = { kind: 'blueprint', bp: { ...nb, schema: clone(nb.schema) } };
      }
      $('schSaved').textContent = ok ? msg : 'Could not save the blueprint (server unavailable)';
      renderBlueprints();
      renderText();
      if (target.kind === 'blueprint') $('schTargetLbl').innerHTML = `<b>Blueprint</b> › ${esc(schema().title)} <em class="schHint">${target.bp.builtin ? (target.bp.edited ? 'built-in, edited copy' : 'built-in') : 'my blueprint'}</em>`;
    };
    const b1 = document.getElementById('tSaveBp');
    if (b1) b1.onclick = () => target.kind === 'blueprint' && doSaveBp(target.bp.schema, `Blueprint “${target.bp.schema.title}” saved`);
    const b2 = document.getElementById('tResetBp');
    if (b2)
      b2.onclick = async () => {
        if (target.kind !== 'blueprint' || !confirm('Discard your changes to this built-in blueprint?')) return;
        const id = target.bp.id;
        await deleteBlueprint(id);
        blueprints = await listBlueprints();
        const nb = blueprints.find((b) => b.id === id)!;
        target = { kind: 'blueprint', bp: { ...nb, schema: clone(nb.schema) } };
        select();
      };
    const b3 = document.getElementById('tDelBp');
    if (b3)
      b3.onclick = async () => {
        if (target.kind !== 'blueprint' || !confirm(`Delete the blueprint “${target.bp.schema.title}”?`)) return;
        await deleteBlueprint(target.bp.id);
        blueprints = await listBlueprints();
        target = { kind: 'item', index: 0 };
        select();
      };
    const b4 = document.getElementById('tBpToProj');
    if (b4)
      b4.onclick = () => {
        if (target.kind !== 'blueprint') return;
        P.items.push(newItem(target.bp.schema));
        target = { kind: 'item', index: P.items.length - 1 };
        dirty();
        select();
      };
    $('tSaveAsBp').onclick = () =>
      modal(
        'Save as a new blueprint',
        `<label>Title<input type="text" id="mName" value="${esc(sc.title)}"></label><label>Category<input type="text" id="mCat" value="${esc(target.kind === 'blueprint' && !target.bp.builtin ? sc.category : 'My blueprints')}"></label>`,
        async () => {
          const s = clone(sc);
          s.title = $<HTMLInputElement>('mName').value.trim() || s.title;
          s.category = $<HTMLInputElement>('mCat').value.trim() || 'My blueprints';
          s.id = `bp-${slug(s.title)}-${uid().slice(0, 4)}`;
          await doSaveBp(s, `Saved as blueprint “${s.title}”`);
        },
        undefined,
        'Save',
      );
  }

  // ------------------------------------------------------------------ Style panel
  const PRESET_LS = 'scc-schema-styles';
  const userPresets = (): Theme[] => {
    try {
      return JSON.parse(localStorage.getItem(PRESET_LS) ?? '[]');
    } catch {
      return [];
    }
  };
  function renderStyle() {
    const p = $('pStyle');
    if (target.kind === 'blueprint') styleScope = 'project';
    const it = item();
    const scopeItem = styleScope === 'item' && !!it;
    const s: Theme = scopeItem ? it!.style ?? clone(P.style) : P.style;
    const fx: Effects = { ...DEFAULT_FX, ...(s.fx ?? {}) };
    const presets = [...THEMES, ...userPresets()];
    const col = (k: string, label: string, v: string) => `<label class="schColor"><input type="color" data-k="${k}" value="${toHex(v)}"><span>${label}</span></label>`;
    const slider = (k: keyof Effects, label: string, min: number, max: number, step: number, unit = '') =>
      `<label class="schSlider"><span>${label}</span><input type="range" data-fx="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${fx[k] as number}"><em>${fx[k]}${unit}</em></label>`;
    p.innerHTML = `
      <div class="schHead">Apply to</div>
      <div class="schRow wrap"><label class="schChk"><input type="radio" name="scope" value="project" ${!scopeItem ? 'checked' : ''}> Whole project</label>
      <label class="schChk"><input type="radio" name="scope" value="item" ${scopeItem ? 'checked' : ''} ${it ? '' : 'disabled'}> This item only</label>
      ${it?.style ? '<button class="schMini" id="sClear" title="Use the project style again">↺ project style</button>' : ''}</div>
      <div class="schRow"><select id="sPreset"><option value="">Start from a preset…</option>${presets.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select><button class="schBtn" id="sSavePreset">💾 Save as preset</button></div>
      <div class="schHead">Colours</div>
      <div class="schColors">${col('bg0', 'Background top', s.bg[0])}${col('bg1', 'Background bottom', s.bg[1])}${col('text', 'Text', s.text)}${col('muted', 'Secondary text', s.muted)}${col('box', 'Box fill', s.box)}${col('boxLine', 'Box border', s.boxLine)}${col('link', 'Links', s.link)}${col('caption', 'Caption bar', s.caption)}${col('captionText', 'Caption text', s.captionText)}</div>
      <div class="schLbl">Accent colours (elements)</div>
      <div class="schColors acc">${s.accents.map((a, i) => `<label class="schColor"><input type="color" data-acc="${i}" value="${toHex(a)}"></label>`).join('')}</div>
      <div class="schHead">Background</div>
      <div class="schRow wrap"><label class="schSel">Kind <select id="sBgKind">${['gradient', 'solid', 'image'].map((k) => `<option ${(s.bgKind ?? 'gradient') === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="schChk"><input type="checkbox" id="sGrid" ${s.grid ? 'checked' : ''}> grid</label></div>
      <div class="schRow wrap"><label class="schBtn schFile">📁 Upload background image…<input type="file" id="sBgFile" accept="image/*" hidden></label>
      <label class="schSel">Fit <select id="sBgFit"><option ${s.bgFit !== 'contain' ? 'selected' : ''}>cover</option><option ${s.bgFit === 'contain' ? 'selected' : ''}>contain</option></select></label></div>
      ${s.bgImage ? `<div class="schRow"><img class="schBgThumb" src="${s.bgImage}"><button class="schMini" id="sBgDel" title="Remove image">✕</button></div>` : ''}
      <label class="schSlider"><span>Veil over the image</span><input type="range" id="sBgDim" min="0" max="0.95" step="0.05" value="${s.bgDim ?? 0.35}"><em>${Math.round((s.bgDim ?? 0.35) * 100)}%</em></label>
      <div class="schHead">Effects <span class="schHint">the opening replays as you change them</span></div>
      ${slider('bounce', 'Bounciness of new items', 0, 1, 0.05)}
      ${slider('appearDur', 'Appear time', 0.1, 2, 0.05, ' s')}
      ${slider('glowPct', 'Afterglow', 0, 1, 0.05)}
      ${slider('glowDur', 'Afterglow duration', 0, 6, 0.1, ' s')}
      ${slider('linkDur', 'Link drawing time', 0.1, 2.5, 0.05, ' s')}
      ${slider('radius', 'Corner rounding', 0, 40, 1, ' px')}
      ${slider('packetScale', 'Message tag size', 0.5, 2, 0.05, '×')}
      <label class="schChk"><input type="checkbox" id="sPulse" ${fx.pulse ? 'checked' : ''}> Pulse highlighted items</label>
      <div class="schHead">Text</div>
      <div class="schRow"><label class="schSel">Font <select id="sFont">${FONTS.map((f) => `<option ${(s.font ?? 'Segoe UI') === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      <label class="schSel">Size <input type="range" id="sTs" min="0.8" max="1.4" step="0.05" value="${s.textScale ?? 1}"></label></div>
      <label>Style name<input type="text" id="sName" value="${esc(s.name)}"></label>`;
    const commit = (fn: (x: Theme) => void, rerender = false) => {
      if (scopeItem) {
        if (!it!.style) it!.style = clone(P.style);
        fn(it!.style!);
      } else fn(P.style);
      dirty();
      if (rerender) renderStyle();
    };
    root.querySelectorAll<HTMLInputElement>('input[name=scope]').forEach((r) => (r.onchange = () => ((styleScope = r.value as 'project' | 'item'), renderStyle())));
    const clr = document.getElementById('sClear');
    if (clr) clr.onclick = () => ((it!.style = null), (styleScope = 'project'), dirty(), renderStyle(), renderItems());
    $<HTMLSelectElement>('sPreset').onchange = () => {
      const x = presets[Number($<HTMLSelectElement>('sPreset').value)];
      if (x) commit((s0) => Object.assign(s0, clone({ bgKind: 'gradient' as const, bgImage: undefined, font: 'Segoe UI', textScale: 1, fx: {}, ...x })), true);
    };
    $('sSavePreset').onclick = () => {
      const name = prompt('Name of the style preset', s.name + ' (mine)');
      if (!name) return;
      const list = userPresets().filter((x) => x.name !== name);
      list.push({ ...clone(s), id: 'user-' + slug(name), name, bgImage: s.bgImage && s.bgImage.length < 1.5e6 ? s.bgImage : undefined });
      try {
        localStorage.setItem(PRESET_LS, JSON.stringify(list));
        status(`Style preset “${name}” saved in this browser.`);
      } catch {
        status('Could not save the preset (browser storage full: try without a background image).');
      }
      renderStyle();
    };
    root.querySelectorAll<HTMLInputElement>('.schColors input[data-k]').forEach(
      (el) =>
        (el.oninput = () =>
          commit((s0) => {
            const k = el.dataset.k!;
            if (k === 'bg0') s0.bg = [el.value, s0.bg[1]];
            else if (k === 'bg1') s0.bg = [s0.bg[0], el.value];
            else (s0 as unknown as Record<string, string>)[k] = el.value;
          })),
    );
    root.querySelectorAll<HTMLInputElement>('.schColors input[data-acc]').forEach((el) => (el.oninput = () => commit((s0) => (s0.accents = s0.accents.map((a, i) => (i === Number(el.dataset.acc) ? el.value : a))))));
    $<HTMLSelectElement>('sBgKind').onchange = () => commit((s0) => (s0.bgKind = $<HTMLSelectElement>('sBgKind').value as Theme['bgKind']), true);
    $<HTMLInputElement>('sGrid').onchange = () => commit((s0) => (s0.grid = $<HTMLInputElement>('sGrid').checked ? 'rgba(160,200,255,0.08)' : null));
    $<HTMLSelectElement>('sBgFit').onchange = () => commit((s0) => (s0.bgFit = $<HTMLSelectElement>('sBgFit').value as 'cover' | 'contain'));
    $<HTMLInputElement>('sBgDim').oninput = () => {
      commit((s0) => (s0.bgDim = Number($<HTMLInputElement>('sBgDim').value)));
      ($<HTMLInputElement>('sBgDim').nextElementSibling as HTMLElement).textContent = `${Math.round(Number($<HTMLInputElement>('sBgDim').value) * 100)}%`;
    };
    $<HTMLInputElement>('sBgFile').onchange = async () => {
      const f = $<HTMLInputElement>('sBgFile').files?.[0];
      if (!f) return;
      const url = await downscale(f, 1920);
      commit((s0) => ((s0.bgImage = url), (s0.bgKind = 'image'), (s0.bgDim = s0.bgDim ?? 0.35)), true);
      status(`Background image “${f.name}” set.`);
    };
    const del = document.getElementById('sBgDel');
    if (del) del.onclick = () => commit((s0) => ((s0.bgImage = undefined), (s0.bgKind = 'gradient')), true);
    root.querySelectorAll<HTMLInputElement>('input[data-fx]').forEach(
      (el) =>
        (el.oninput = () => {
          commit((s0) => (s0.fx = { ...DEFAULT_FX, ...(s0.fx ?? {}), [el.dataset.fx!]: Number(el.value) }));
          (el.nextElementSibling as HTMLElement).textContent = el.value + (el.dataset.unit ?? '');
          if (['bounce', 'appearDur', 'glowPct', 'glowDur', 'linkDur'].includes(el.dataset.fx!) && !editing()) {
            t = 0; // replay the opening so the effect is visible
            playing = true;
          }
        }),
    );
    $<HTMLInputElement>('sPulse').onchange = () => commit((s0) => (s0.fx = { ...DEFAULT_FX, ...(s0.fx ?? {}), pulse: $<HTMLInputElement>('sPulse').checked }));
    $<HTMLSelectElement>('sFont').onchange = () => commit((s0) => (s0.font = $<HTMLSelectElement>('sFont').value));
    $<HTMLInputElement>('sTs').oninput = () => commit((s0) => (s0.textScale = Number($<HTMLInputElement>('sTs').value)));
    $<HTMLInputElement>('sName').onchange = () => commit((s0) => (s0.name = $<HTMLInputElement>('sName').value || s0.name));
  }
  /** background images are downscaled to keep projects small */
  function downscale(f: File, max: number) {
    return new Promise<string>((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k);
        c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(im.src);
        res(c.toDataURL('image/jpeg', 0.86));
      };
      im.onerror = rej;
      im.src = URL.createObjectURL(f);
    });
  }

  // ------------------------------------------------------------------ Video Studio panel
  function renderVs() {
    const p = $('pVs');
    const it = item();
    if (!it) {
      p.innerHTML = `<div class="schHint">A blueprint goes to Video Studio through a project: use <b>＋ Add to project</b> in the Text tab first.</div>${projectVsSummary()}`;
      return bindVsExport();
    }
    p.innerHTML = `
      <div class="schHead">This item in Video Studio</div>
      <div class="schRow"><label class="schChk"><input type="radio" name="vk" value="animation" ${it.kind === 'animation' ? 'checked' : ''}> Animation (MP4)</label><label class="schChk"><input type="radio" name="vk" value="image" ${it.kind === 'image' ? 'checked' : ''}> Image (PNG)</label></div>
      ${it.kind === 'image' ? `<div class="schRow"><label class="schSel">Capture at <input type="number" id="vAt" step="0.1" value="${it.imageAt ?? it.schema.duration}" style="width:70px"> s</label><button class="schMini" id="vAtNow" title="Use the current time">⏱ now</button></div>` : ''}
      <div class="schRow"><label class="schSel">Scene <input type="text" id="vScene" value="${esc(it.vs.scene)}" placeholder="number or title" style="width:110px"></label>
      <label class="schSel">Section <input type="text" id="vSection" value="${esc(it.vs.section)}" placeholder="optional" style="width:70px"></label></div>
      <label class="schSel">Narration <select id="vMode"><option value="append" ${it.vs.mode === 'append' ? 'selected' : ''}>add to the scene's narration</option><option value="replace" ${it.vs.mode === 'replace' ? 'selected' : ''}>replace the scene's narration</option><option value="new" ${it.vs.mode === 'new' ? 'selected' : ''}>new scene with this narration</option></select></label>
      <div class="schHint">Leave Scene empty to create a new scene at the end of the storyboard.</div>
      <label>Narration text <span class="schHint">${it.vs.narration === null ? '(from the captions)' : '(edited)'}</span><textarea id="vNarr" rows="6">${esc(narrationOf(it))}</textarea></label>
      <div class="schRow"><button class="schBtn" id="vNarrReset" ${it.vs.narration === null ? 'disabled' : ''}>↺ From the captions</button></div>
      ${projectVsSummary()}`;
    root.querySelectorAll<HTMLInputElement>('input[name=vk]').forEach((r) => (r.onchange = () => ((it.kind = r.value as 'animation' | 'image'), dirty(), renderVs(), renderItems())));
    const at = document.getElementById('vAt') as HTMLInputElement | null;
    if (at) at.oninput = () => ((it.imageAt = Number(at.value)), dirty());
    const atNow = document.getElementById('vAtNow');
    if (atNow) atNow.onclick = () => ((it.imageAt = Math.round(t * 10) / 10), dirty(), renderVs());
    const resum = () => { $('vSum').outerHTML = projectVsSummary(); bindVsExport(); };
    $<HTMLInputElement>('vScene').oninput = () => ((it.vs.scene = $<HTMLInputElement>('vScene').value.trim()), dirty(), resum());
    $<HTMLInputElement>('vSection').oninput = () => ((it.vs.section = $<HTMLInputElement>('vSection').value.trim()), dirty(), resum());
    $<HTMLSelectElement>('vMode').onchange = () => ((it.vs.mode = $<HTMLSelectElement>('vMode').value as 'append' | 'replace' | 'new'), dirty(), resum());
    $<HTMLTextAreaElement>('vNarr').oninput = () => ((it.vs.narration = $<HTMLTextAreaElement>('vNarr').value), dirty(), resum());
    $('vNarrReset').onclick = () => ((it.vs.narration = null), dirty(), renderVs());
    bindVsExport();
  }
  function projectVsSummary() {
    return `<div id="vSum"><div class="schHead">Whole project → Video Studio</div>
      <table class="schVsTable"><thead><tr><th>#</th><th>Item</th><th></th><th>Scene</th><th>Narration</th></tr></thead><tbody>${P.items
        .map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.schema.title)}</td><td>${x.kind === 'animation' ? '▶' : '🖼'}</td><td>${x.vs.mode === 'new' || !x.vs.scene ? 'new' : esc(x.vs.scene) + (x.vs.section ? '.' + esc(x.vs.section) : '')}</td><td>${x.vs.mode} · ${narrationOf(x).split(/\s+/).filter(Boolean).length} words</td></tr>`)
        .join('')}</tbody></table>
      <button class="schBtn primary" id="vExport">⇩ Export Video Studio schema package (.zip)</button>
      <div class="schHint">In Video Studio: Storyboard → <b>Import schema package…</b> Each item goes into the media catalog, is placed in its scene, and its narration is added to that scene. Single images and videos can also be imported like any other media file (Export tab).</div></div>`;
  }
  function bindVsExport() {
    $('vExport').onclick = () =>
      guard(async () => {
        const blob = await buildVsPackage(P, (i, kind, onp) => renderItemMedia(P.items[i], kind, onp), prog);
        const name = await saveOutput(blob, `${slug(P.name)}.vsschema.zip`, 'Video Studio schema package');
        status(name ? `Saved ${name}. Import it in Video Studio: Storyboard → Import schema package…` : '');
      });
  }

  // ------------------------------------------------------------------ Export panel
  function renderExport() {
    $('pExport').innerHTML = `
      <div class="schHead">This ${target.kind === 'item' ? 'item' : 'blueprint'}</div>
      <div class="schRow wrap"><button class="schBtn" id="xPng">🖼 Image</button><select id="xPngRes"><option value="1920">1920×1080</option><option value="3840">3840×2160 (4K)</option></select></div>
      <div class="schRow wrap"><button class="schBtn" id="xBoard">▦ Storyboard sheet</button><button class="schBtn" id="xGif">◐ Animated GIF</button><button class="schBtn primary" id="xMp4">● Video (MP4)</button></div>
      <div class="schHint">Images and videos import into Video Studio like any other media file. For narration and scene placement, use the Video Studio tab.</div>
      <div class="schHead">Whole project</div>
      <button class="schBtn" id="xAll">⇩ Export every item (video, GIF, image, storyboard)</button>
      <div class="schHint">Saved to out/exports/schemas/${esc(slug(P.name))}/</div>`;
    $('xPng').onclick = () =>
      guard(async () => {
        const W = Number($<HTMLSelectElement>('xPngRes').value);
        await bgReady(style().bgImage);
        const name = await saveOutput(await toBlob(frame(schema(), t, style(), W, (W * 9) / 16)), `${base()}_t${t.toFixed(1)}s.png`, 'Schema image');
        if (name) status(`Saved ${name}`);
      });
    $('xBoard').onclick = () =>
      guard(async () => {
        await bgReady(style().bgImage);
        const name = await saveOutput(await toBlob(storyboard(schema(), style())), `${base()}_storyboard.png`, 'Schema storyboard');
        if (name) status(`Saved ${name}`);
      });
    $('xGif').onclick = () =>
      guard(async () => {
        const b = await gif(schema(), style(), (f) => prog(f, `Rendering animated GIF… ${Math.round(f * 100)}%`));
        const name = await saveOutput(b, `${base()}.gif`, 'Animated schema (GIF)');
        status(name ? `Saved ${name}` : '');
      });
    $('xMp4').onclick = () =>
      guard(async () => {
        const r = await video(schema(), style(), (f) => prog(f, `Rendering video… ${Math.round(f * 100)}%`));
        const name = await saveOutput(r.blob, `${base()}.${r.ext}`, 'Animated schema video');
        status(name ? `Saved ${name}` : '');
      });
    $('xAll').onclick = () =>
      guard(async () => {
        const dir = `schemas/${slug(P.name)}`;
        for (let i = 0; i < P.items.length; i++) {
          const it = P.items[i], s = it.schema, th = styleOf(P, it);
          const f0 = i / P.items.length;
          const b = `${String(i + 1).padStart(2, '0')}-${slug(s.title)}`;
          prog(f0 + 0.001, `(${i + 1}/${P.items.length}) ${s.title}…`);
          await bgReady(th.bgImage);
          await post(`${dir}/${b}.png`, await toBlob(frame(s, it.kind === 'image' ? it.imageAt ?? s.duration : s.duration - 0.5, th, VW, VH)));
          await post(`${dir}/${b}_storyboard.png`, await toBlob(storyboard(s, th)));
          const r = await video(s, th, (f) => prog(f0 + (f * 0.7) / P.items.length, `(${i + 1}/${P.items.length}) ${s.title}: video ${Math.round(f * 100)}%`));
          await post(`${dir}/${b}.${r.ext}`, r.blob);
          await post(`${dir}/${b}.gif`, await gif(s, th, (f) => prog(f0 + (0.7 + f * 0.3) / P.items.length, `(${i + 1}/${P.items.length}) ${s.title}: GIF ${Math.round(f * 100)}%`)));
        }
        status(`Exported ${P.items.length} item(s) to out/exports/${dir}/`);
      });
  }
  const base = () => `schema_${slug(schema().title)}`;
  const post = async (p: string, b: Blob) => {
    const r = await fetch(`/api/export?path=${encodeURIComponent(p)}`, { method: 'POST', body: b });
    if (!r.ok) throw new Error('save failed (' + r.status + ')');
  };
  const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  const exportOpts = () => ({ captions: $<HTMLInputElement>('schCap').checked, title: $<HTMLInputElement>('schTitleChk').checked });
  const frame = (s: Schema, tt: number, th: Theme, w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    renderSchema(c.getContext('2d')!, s, tt, th, w, h, exportOpts());
    return c;
  };
  async function renderItemMedia(it: SchemaItem, kind: 'animation' | 'image', onp: (f: number) => void) {
    const th = styleOf(P, it);
    await bgReady(th.bgImage);
    if (kind === 'image') return { blob: await toBlob(frame(it.schema, it.imageAt ?? it.schema.duration, th, VW, VH)), ext: 'png', mime: 'image/png' };
    const r = await video(it.schema, th, onp);
    return { blob: r.blob, ext: r.ext, mime: r.mime };
  }
  function storyboard(s: Schema, th: Theme) {
    const cw = 960, chh = 540, cols = 3;
    const steps = s.captions.slice(0, 6);
    const rows = Math.max(1, Math.ceil(steps.length / cols));
    const c = document.createElement('canvas');
    c.width = cols * cw + (cols + 1) * 24;
    c.height = rows * (chh + 70) + 24 + 90;
    const g = c.getContext('2d')!;
    g.fillStyle = th.bg[1];
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = th.text;
    g.font = `700 40px "${th.font ?? 'Segoe UI'}", sans-serif`;
    g.fillText(s.title, 24, 60);
    steps.forEach((capn, i) => {
      const next = s.captions[i + 1]?.t ?? s.duration;
      const tt = Math.min(s.duration, capn.t + Math.min(4, (next - capn.t) * 0.85));
      const x = 24 + (i % cols) * (cw + 24), y = 90 + Math.floor(i / cols) * (chh + 70);
      const f = document.createElement('canvas');
      f.width = cw;
      f.height = chh;
      renderSchema(f.getContext('2d')!, s, tt, th, cw, chh, { captions: false, title: exportOpts().title });
      g.drawImage(f, x, y);
      g.fillStyle = th.accents[0];
      g.beginPath();
      g.arc(x + 22, y + chh + 30, 18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '700 20px "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.fillText(String(i + 1), x + 22, y + chh + 37);
      g.textAlign = 'left';
      g.fillStyle = th.text;
      g.font = `500 19px "${th.font ?? 'Segoe UI'}", sans-serif`;
      let line = '', ly = y + chh + 24;
      for (const w of capn.text.split(' ')) {
        if (g.measureText(line + ' ' + w).width > cw - 60 && line) {
          g.fillText(line, x + 50, ly);
          line = w;
          ly += 24;
        } else line = line ? line + ' ' + w : w;
      }
      g.fillText(line, x + 50, ly);
    });
    return c;
  }
  async function video(s: Schema, th: Theme, onp: (f: number) => void) {
    await bgReady(th.bgImage);
    const fps = 30, n = Math.round(s.duration * fps);
    const enc = await createEncoder({ width: VW, height: VH, fps, bitrate: 12_000_000 });
    const c = document.createElement('canvas');
    c.width = VW;
    c.height = VH;
    const g = c.getContext('2d')!;
    const o = exportOpts();
    for (let i = 0; i < n; i++) {
      renderSchema(g, s, i / fps, th, VW, VH, o);
      await enc.add(c, i);
      if (i % 15 === 0) {
        onp(i / n);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return enc.finish();
  }
  async function gif(s: Schema, th: Theme, onp: (f: number) => void) {
    await bgReady(th.bgImage);
    const fps = 10, w = 800, h = 450, n = Math.round(s.duration * fps);
    const enc = GIFEncoder();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const o = exportOpts();
    // one global palette sampled from several moments keeps colours stable and the file small
    const samples: Uint8ClampedArray[] = [];
    for (const f of [0.15, 0.4, 0.65, 0.9]) {
      renderSchema(g, s, s.duration * f, th, w, h, o);
      samples.push(g.getImageData(0, 0, w, h).data);
    }
    const all = new Uint8ClampedArray(samples.reduce((a, x) => a + x.length, 0));
    let off = 0;
    for (const x of samples) all.set(x, off), (off += x.length);
    const pal = quantize(all, 127);
    const TR = pal.length; // extra index = transparent (pixel unchanged since the previous frame)
    pal.push([255, 0, 255]);
    let prev: Uint8Array | null = null;
    for (let i = 0; i < n; i++) {
      renderSchema(g, s, i / fps, th, w, h, o);
      const data = g.getImageData(0, 0, w, h).data;
      const idx = applyPalette(data, pal.slice(0, TR));
      const out = new Uint8Array(idx);
      if (prev) for (let p = 0; p < out.length; p++) if (idx[p] === prev[p]) out[p] = TR;
      prev = idx;
      enc.writeFrame(out, w, h, { palette: i === 0 ? pal : undefined, delay: Math.round(1000 / fps), repeat: i === 0 ? 0 : undefined, transparent: i > 0, transparentIndex: TR, dispose: 1 });
      if (i % 6 === 0) {
        onp(i / n);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    enc.finish();
    return new Blob([enc.bytes()], { type: 'image/gif' });
  }
  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    root.classList.add('busy');
    try {
      await fn();
    } catch (e) {
      status('Export failed: ' + String((e as Error)?.message ?? e));
    } finally {
      busy = false;
      root.classList.remove('busy');
      prog(0);
    }
  };

  // ------------------------------------------------------------------ automation (tests)
  (window as any).sccSchemas = {
    ready: true,
    project: () => P,
    target: () => target,
    selectItem: (i: number) => ((target = { kind: 'item', index: i }), select()),
    editBlueprint: (id: string) => {
      const bp = blueprints.find((b) => b.id === id)!;
      target = { kind: 'blueprint', bp: { ...bp, schema: clone(bp.schema) } };
      select();
    },
    setTime: (x: number) => ((t = x), (playing = false)),
    tab,
    async testPackage(kindOverride?: 'image') {
      const blob = await buildVsPackage(P, (i, kind, onp) => renderItemMedia(P.items[i], kindOverride ?? kind, onp), prog);
      const r = await fetch('/api/export?path=' + encodeURIComponent(`schemas/${slug(P.name)}.vsschema.zip`), { method: 'POST', body: blob });
      return { size: blob.size, ok: r.ok };
    },
    async testExport(kind: string) {
      const r = kind === 'gif' ? await gif(schema(), style(), () => {}) : kind === 'board' ? await toBlob(storyboard(schema(), style())) : (await video(schema(), style(), () => {})).blob;
      return { size: r.size, type: r.type };
    },
  };

  await refreshProjects();
  fitCanvas();
  requestAnimationFrame(loop);
}
