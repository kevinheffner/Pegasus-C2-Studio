/**
 * Animated Schemas workbench: explanatory animated graphics on C2–simulation interoperability, standards and
 * training. Every frame is a pure function of time, so exports (PNG, storyboard, GIF, MP4) are frame-exact.
 */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { renderSchema, THEMES, VW, VH, type Schema, type Theme } from './engine';
import { SCHEMAS } from './library';
import { createEncoder } from '../export/recorder';
import { saveOutput } from '../export/save';
import './schemas.css';

export async function initSchemas() {
  const root = document.createElement('div');
  root.id = 'schApp';
  const cats = [...new Set(SCHEMAS.map((s) => s.category))];
  root.innerHTML = `
  <header id="schTop">
    <div class="sys"><span class="schMark">◇</span><span class="schName">Animated Schemas</span><span class="schSub">C2 · simulation · standards · training</span></div>
    <span class="grow"></span>
    <label class="schSel">Style <select id="schTheme">${THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}</select></label>
    <label class="schChk"><input type="checkbox" id="schCap" checked> Captions</label>
    <label class="schChk"><input type="checkbox" id="schTitle" checked> Title</label>
  </header>
  <div id="schBody">
    <aside id="schList">${cats
      .map(
        (c) => `<div class="schCat">${c}</div>` + SCHEMAS.filter((s) => s.category === c).map((s) => `<button class="schItem" data-id="${s.id}" title="${s.description}"><b>${s.title}</b><span>${s.subtitle}</span></button>`).join(''),
      )
      .join('')}</aside>
    <main id="schMain">
      <div id="schStage"><canvas id="schCanvas"></canvas></div>
      <div id="schCtl">
        <button id="schPlay" class="schBtn primary">❚❚</button>
        <button id="schRestart" class="schBtn" title="Restart">⟲</button>
        <input type="range" id="schTime" min="0" max="30" step="0.01" value="0" class="grow">
        <span id="schT" class="mono">0.0 s</span>
        <label class="schSel">Speed <select id="schSpeed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
        <label class="schChk"><input type="checkbox" id="schLoop" checked> Loop</label>
      </div>
      <div id="schInfo">
        <div><div id="schDesc"></div><div id="schRefs"></div></div>
        <div class="schExport">
          <div class="schExpHead">Export</div>
          <div class="schExpRow">
            <button class="schBtn" id="xPng" title="This frame as a PNG image">🖼 Image</button>
            <label class="schSel"><select id="xPngRes"><option value="1920">1920×1080</option><option value="3840">3840×2160 (4K)</option></select></label>
            <button class="schBtn" id="xBoard" title="One frame per caption step, as a 3×2 sheet">▦ Storyboard</button>
            <button class="schBtn" id="xGif" title="Animated GIF (800×450, 10 fps)">◐ Animated GIF</button>
            <button class="schBtn primary" id="xMp4" title="Frame-exact video, 1920×1080 at 30 fps">● Video</button>
            <button class="schBtn" id="xAll" title="Video, GIF, image and storyboard of every schema, saved to out/exports/schemas">⇩ Export all</button>
          </div>
          <div id="schProg"><div id="schBar"></div></div>
          <div id="schStatus"></div>
        </div>
      </div>
    </main>
  </div>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

  let sc: Schema = SCHEMAS[0];
  let t = 0;
  let playing = true;
  let busy = false;
  const theme = (): Theme => THEMES.find((x) => x.id === $<HTMLSelectElement>('schTheme').value) ?? THEMES[0];
  const opts = () => ({ captions: $<HTMLInputElement>('schCap').checked, title: $<HTMLInputElement>('schTitle').checked });

  const canvas = $<HTMLCanvasElement>('schCanvas');
  function fitCanvas() {
    const st = $('schStage');
    const w = st.clientWidth, h = st.clientHeight;
    const cw = Math.min(w, (h * VW) / VH), ch = (cw * VH) / VW;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  new ResizeObserver(fitCanvas).observe($('schStage'));

  function select(id: string) {
    sc = SCHEMAS.find((s) => s.id === id) ?? SCHEMAS[0];
    t = 0;
    playing = true;
    document.querySelectorAll('.schItem').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === sc.id));
    $<HTMLInputElement>('schTime').max = String(sc.duration);
    $('schDesc').textContent = sc.description;
    $('schRefs').innerHTML = sc.refs.map((r) => `<div>• ${r}</div>`).join('');
    history.replaceState(null, '', `?module=schemas&schema=${sc.id}`);
  }
  document.querySelectorAll<HTMLButtonElement>('.schItem').forEach((b) => (b.onclick = () => select(b.dataset.id!)));

  // ---------- playback ----------
  let last = 0;
  function loop(ts: number) {
    const dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    if (playing && !busy) {
      t += dt * Number($<HTMLSelectElement>('schSpeed').value);
      if (t > sc.duration) {
        if ($<HTMLInputElement>('schLoop').checked) t = 0;
        else (t = sc.duration), (playing = false);
      }
    }
    if (!busy) {
      const g = canvas.getContext('2d')!;
      renderSchema(g, sc, t, theme(), canvas.width, canvas.height, opts());
      $<HTMLInputElement>('schTime').value = String(t);
      $('schT').textContent = `${t.toFixed(1)} / ${sc.duration} s`;
      $('schPlay').textContent = playing ? '❚❚' : '▶';
    }
    requestAnimationFrame(loop);
  }
  $('schPlay').onclick = () => {
    if (t >= sc.duration) t = 0;
    playing = !playing;
  };
  $('schRestart').onclick = () => ((t = 0), (playing = true));
  $<HTMLInputElement>('schTime').oninput = () => ((t = Number($<HTMLInputElement>('schTime').value)), (playing = false));

  // ---------- exports ----------
  const prog = (f: number, msg = '') => {
    $('schBar').style.width = `${Math.round(f * 100)}%`;
    $('schProg').style.opacity = f > 0 && f < 1 ? '1' : '0';
    if (msg) $('schStatus').textContent = msg;
  };
  const frame = (s: Schema, tt: number, w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    renderSchema(c.getContext('2d')!, s, tt, theme(), w, h, opts());
    return c;
  };
  const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  const base = (s: Schema) => `schema_${s.id}_${theme().id}`;

  function storyboard(s: Schema) {
    const cw = 960, chh = 540, cols = 3;
    const steps = s.captions.slice(0, 6);
    const rows = Math.ceil(steps.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * cw + (cols + 1) * 24;
    c.height = rows * (chh + 70) + 24 + 90;
    const g = c.getContext('2d')!;
    g.fillStyle = theme().bg[1];
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = theme().text;
    g.font = '700 40px "Segoe UI", sans-serif';
    g.fillText(s.title, 24, 60);
    steps.forEach((cap, i) => {
      const next = s.captions[i + 1]?.t ?? s.duration;
      const tt = Math.min(s.duration, cap.t + Math.min(4, (next - cap.t) * 0.85));
      const x = 24 + (i % cols) * (cw + 24), y = 90 + Math.floor(i / cols) * (chh + 70);
      const o = opts();
      const f = document.createElement('canvas');
      f.width = cw;
      f.height = chh;
      renderSchema(f.getContext('2d')!, s, tt, theme(), cw, chh, { captions: false, title: o.title });
      g.drawImage(f, x, y);
      g.fillStyle = theme().accents[0];
      g.beginPath();
      g.arc(x + 22, y + chh + 30, 18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '700 20px "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.fillText(String(i + 1), x + 22, y + chh + 37);
      g.textAlign = 'left';
      g.fillStyle = theme().text;
      g.font = '500 19px "Segoe UI", sans-serif';
      const words = cap.text.split(' ');
      let line = '', ly = y + chh + 24;
      for (const w of words) {
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

  async function video(s: Schema, onp: (f: number) => void) {
    const fps = 30, n = Math.round(s.duration * fps);
    const enc = await createEncoder({ width: VW, height: VH, fps, bitrate: 12_000_000 });
    const c = document.createElement('canvas');
    c.width = VW;
    c.height = VH;
    const g = c.getContext('2d')!;
    for (let i = 0; i < n; i++) {
      renderSchema(g, s, i / fps, theme(), VW, VH, opts());
      await enc.add(c, i);
      if (i % 15 === 0) {
        onp(i / n);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return enc.finish();
  }

  async function gif(s: Schema, onp: (f: number) => void) {
    const fps = 10, w = 800, h = 450, n = Math.round(s.duration * fps);
    const enc = GIFEncoder();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    // one global palette sampled from several moments keeps colours stable and the file small
    const samples: Uint8ClampedArray[] = [];
    for (const f of [0.15, 0.4, 0.65, 0.9]) {
      renderSchema(g, s, s.duration * f, theme(), w, h, opts());
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
      renderSchema(g, s, i / fps, theme(), w, h, opts());
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
      $('schStatus').textContent = 'Export failed: ' + String((e as Error)?.message ?? e);
    } finally {
      busy = false;
      root.classList.remove('busy');
      prog(0);
    }
  };
  $('xPng').onclick = () =>
    guard(async () => {
      const W = Number($<HTMLSelectElement>('xPngRes').value);
      const name = await saveOutput(await toBlob(frame(sc, t, W, (W * 9) / 16)), `${base(sc)}_t${t.toFixed(1)}s.png`, 'Schema image');
      if (name) $('schStatus').textContent = `Saved ${name}`;
    });
  $('xBoard').onclick = () =>
    guard(async () => {
      const name = await saveOutput(await toBlob(storyboard(sc)), `${base(sc)}_storyboard.png`, 'Schema storyboard');
      if (name) $('schStatus').textContent = `Saved ${name}`;
    });
  $('xGif').onclick = () =>
    guard(async () => {
      prog(0.01, 'Rendering animated GIF…');
      const b = await gif(sc, (f) => prog(f, `Rendering animated GIF… ${Math.round(f * 100)}%`));
      const name = await saveOutput(b, `${base(sc)}.gif`, 'Animated schema (GIF)');
      $('schStatus').textContent = name ? `Saved ${name}` : '';
    });
  $('xMp4').onclick = () =>
    guard(async () => {
      prog(0.01, 'Rendering video…');
      const r = await video(sc, (f) => prog(f, `Rendering video… ${Math.round(f * 100)}%`));
      const name = await saveOutput(r.blob, `${base(sc)}.${r.ext}`, 'Animated schema video');
      $('schStatus').textContent = name ? `Saved ${name}` : '';
    });
  const post = async (p: string, b: Blob) => {
    const r = await fetch(`/api/export?path=${encodeURIComponent(p)}`, { method: 'POST', body: b });
    if (!r.ok) throw new Error('save failed (' + r.status + ')');
  };
  $('xAll').onclick = () =>
    guard(async () => {
      for (let i = 0; i < SCHEMAS.length; i++) {
        const s = SCHEMAS[i];
        const f0 = i / SCHEMAS.length;
        prog(f0 + 0.001, `(${i + 1}/${SCHEMAS.length}) ${s.title}…`);
        await post(`schemas/${base(s)}.png`, await toBlob(frame(s, s.duration - 0.5, VW, VH)));
        await post(`schemas/${base(s)}_storyboard.png`, await toBlob(storyboard(s)));
        const r = await video(s, (f) => prog(f0 + f / SCHEMAS.length, `(${i + 1}/${SCHEMAS.length}) ${s.title}: video ${Math.round(f * 100)}%`));
        await post(`schemas/${base(s)}.${r.ext}`, r.blob);
        await post(`schemas/${base(s)}.gif`, await gif(s, (f) => prog(f0 + f / SCHEMAS.length, `(${i + 1}/${SCHEMAS.length}) ${s.title}: GIF ${Math.round(f * 100)}%`)));
      }
      $('schStatus').textContent = `Exported ${SCHEMAS.length} schemas (video, GIF, image, storyboard) to out/exports/schemas/`;
    });

  (window as any).sccSchemas = {
    select,
    setTime: (x: number) => ((t = x), (playing = false)),
    list: () => SCHEMAS.map((s) => s.id),
    async testExport(kind: string) {
      const r = kind === 'gif' ? await gif(sc, () => {}) : kind === 'board' ? await toBlob(storyboard(sc)) : (await video(sc, () => {})).blob;
      return { size: r.size, type: r.type };
    },
    ready: true,
  };

  const want = new URLSearchParams(location.search).get('schema');
  select(want ?? SCHEMAS[0].id);
  fitCanvas();
  requestAnimationFrame(loop);
}
