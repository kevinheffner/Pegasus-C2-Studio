/**
 * Military Sensor Simulations workbench.
 * Pick a scenario (built-in packages or the current COP scenario) and a sensor; play, record video,
 * download per-frame metadata, or export an annotated dataset (PNG frames + JSON/CSV) to out/exports/.
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { generate } from '../scenario/generator';
import { Simulation } from '../scenario/sim';
import type { Scenario } from '../scenario/types';
import { AO_PRESETS, DEFAULT_PARAMS, type BattleParams } from '../scenario/catalog';
import { BUILTIN_PACKAGES, type Settings } from '../app/library';
import { SAT_STYLE } from './style';
import { recordVideo } from '../export/recorder';
import { saveOutput as download } from '../export/save';
import { SENSORS, type Sensor, type SensorCtx } from './sensors';



function settingsToGen(s: Settings) {
  const preset = AO_PRESETS.find((a) => a.id === s.ao) ?? AO_PRESETS[0];
  const P: BattleParams = { ...DEFAULT_PARAMS };
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
    params: P,
    viewPx: [1280, 720] as [number, number],
  };
}

export async function initSensors() {
  const root = document.createElement('div');
  root.id = 'sensorApp';
  root.innerHTML = `
  <header id="sTop">
    <div class="sys"><span class="sysmark">◆</span><span class="sysname">SENSOR SIMULATION</span><span class="syssub">WORKBENCH</span></div>
    <label class="sScn">Scenario <select id="sScenario"></select></label>
    <div class="tbcenter"><span id="sStatus" class="hint"></span></div>
    <span id="sDtg" class="mono" style="color:#7dffb0"></span>
    <div class="tbactions">
      <button id="sShot" class="ico" title="Screenshot (PNG)">📷</button>
      <button id="sMeta" class="ico" title="Download metadata for the current frame">⇩</button>
      <button id="sDataset" class="ico" title="Export dataset (frames + metadata) to out/exports/">🗂</button>
      <button id="sRecord" class="ico rec" title="Record video">●</button>
      <span id="sRec" class="topRec"></span>
    </div>
  </header>
  <div id="sBody">
    <nav id="sList"></nav>
    <main id="sMain"><div id="sStage"><div id="sMap"></div><canvas id="sCanvas"></canvas></div></main>
    <aside id="sSide">
      <div class="wHead"><span id="sName">SENSOR</span></div>
      <div class="wBody">
        <div class="hint" id="sDesc"></div>
        <div id="sParams"></div>
        <div class="wsec">VIDEO / DATASET</div>
        <div class="row">
          <label class="grow">Resolution <select id="sRes"><option value="1280x720">1280×720</option><option value="1920x1080" selected>1920×1080</option></select></label>
          <label>FPS <select id="sFps"><option>24</option><option selected>30</option></select></label>
        </div>
        <div class="row">
          <label class="grow">Length (s) <input id="sLen" type="number" value="20" /></label>
          <label class="grow">From T+ <input id="sFrom" type="number" value="60" /></label>
          <label class="grow">To T+ <input id="sTo" type="number" value="140" /></label>
        </div>
        <label>Dataset frames <input id="sN" type="number" value="25" /></label>
        <div class="progress"><div id="sBar" style="height:100%;width:0;background:var(--rec)"></div></div>
        <div class="wsec">METADATA (CURRENT FRAME)</div>
        <pre id="sMetaView" class="metaView"></pre>
      </div>
    </aside>
  </div>
  <footer id="sTimeline">
    <button id="sPlay">▶</button>
    <input id="sTime" type="range" min="0" max="240" step="0.1" value="60" />
    <span id="sTimeLabel" class="mono" style="min-width:110px;color:#7dffb0"></span>
    <label>Speed <select id="sSpeed"><option value="0.25">¼ min/s</option><option value="0.5">½ min/s</option><option value="1" selected>1 min/s</option><option value="3">3 min/s</option></select></label>
  </footer>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

  // ---------- state ----------
  let sc: Scenario | null = null;
  let sim: Simulation | null = null;
  let sensor: Sensor = SENSORS[0];
  const params: Record<string, Record<string, any>> = {};
  for (const s of SENSORS) params[s.id] = Object.fromEntries(s.params.map((p) => [p.key, p.value]));
  let t = 60;
  let playing = false;
  let frame = 0;
  let busy = false;

  const map = new maplibregl.Map({ container: 'sMap', style: SAT_STYLE, center: AO_PRESETS[0].center, zoom: 13, fadeDuration: 0, interactive: false, attributionControl: false, canvasContextAttributes: { preserveDrawingBuffer: true } } as any);
  map.on('load', () => map.setTerrain({ source: 'dem', exaggeration: 1.4 }));
  const canvas = $<HTMLCanvasElement>('sCanvas');

  // ---------- stage sizing (16:9 internal resolution 1280×720 for preview) ----------
  // preview renders at the stage's pixel size (× DPI, max 2560) – see fitPreview()
  const PREVIEW: [number, number] = [1280, 720];
  function fit() {
    const main = $('sMain');
    const W = main.clientWidth - 16, H = main.clientHeight - 16;
    const w = Math.min(W, (H * 16) / 9);
    $('sStage').style.width = `${Math.floor(w)}px`;
    $('sStage').style.height = `${Math.floor((w * 9) / 16)}px`;
    // render the preview at the real displayed resolution
    const pref = String(params[sensor?.id ?? 'eoir']?.res ?? 'auto');
    const pw = pref === 'auto' ? Math.min(2560, Math.round(w * (window.devicePixelRatio || 1))) : Number(pref);
    if (pw > 0 && canvas && canvas.width !== pw) {
      canvas.width = pw;
      canvas.height = Math.round((pw * 9) / 16);
    }
  }
  new ResizeObserver(fit).observe($('sMain'));
  // the imagery map is rendered at the preview resolution behind the display
  $('sMap').style.width = `${PREVIEW[0]}px`;
  $('sMap').style.height = `${PREVIEW[1]}px`;
  canvas.width = PREVIEW[0];
  canvas.height = PREVIEW[1];

  // ---------- scenario select ----------
  const scnSel = $<HTMLSelectElement>('sScenario');
  scnSel.innerHTML = `<option value="cop">Current COP scenario</option>` + BUILTIN_PACKAGES.filter((p) => !p.workspace.multiAO).map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  scnSel.value = (window as any).scc?.active?.scenario ? 'cop' : '0';
  async function loadScenario() {
    setStatus('Generating scenario…');
    let s: Scenario | null = null;
    if (scnSel.value === 'cop') s = (window as any).scc?.active?.scenario ?? null;
    if (!s) {
      const pkg = BUILTIN_PACKAGES.filter((p) => !p.workspace.multiAO)[Number(scnSel.value) || 0];
      s = await generate(settingsToGen(pkg.settings));
    }
    sc = s;
    sim = new Simulation(s);
    $<HTMLInputElement>('sTime').max = String(s.meta.durationMin);
    $<HTMLInputElement>('sTo').value = String(Math.min(s.meta.durationMin, 160));
    // populate target selectors
    for (const sn of SENSORS) {
      const p = sn.params.find((x) => x.key === 'target');
      if (p) p.options = [['auto', 'Auto (where the fighting is)'], ...s.units.filter((u) => !u.air).map((u) => [u.id, `${u.modifiers?.uniqueDesignation ?? u.id}${u.modifiers?.higherFormation ? ' / ' + u.modifiers.higherFormation : ''}`] as [string, string])];
    }
    SENSORS.forEach((x) => x.reset?.());
    buildParams();
    setStatus(s.meta.name);
    await renderNow();
  }
  scnSel.onchange = loadScenario;
  const setStatus = (s: string) => ($('sStatus').textContent = s);

  // ---------- sensor list & params ----------
  $('sList').innerHTML = SENSORS.map((s) => `<button data-s="${s.id}" title="${s.description.replace(/"/g, '&quot;')}"><span class="si">${s.icon}</span><span class="sn">${s.name}</span></button>`).join('');
  $('sList').querySelectorAll<HTMLButtonElement>('button').forEach(
    (b) =>
      (b.onclick = async () => {
        sensor = SENSORS.find((s) => s.id === b.dataset.s)!;
        sensor.reset?.();
        buildParams();
        await renderNow();
      }),
  );
  function buildParams() {
    $('sList').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.s === sensor.id));
    $('sName').textContent = sensor.name.toUpperCase();
    $('sDesc').textContent = sensor.description;
    const P = params[sensor.id];
    $('sParams').innerHTML = sensor.params
      .map((p) => {
        if (p.type === 'select') return `<label>${p.label}<select data-k="${p.key}">${(p.options ?? []).map(([v, l]) => `<option value="${v}" ${String(P[p.key]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        if (p.type === 'range') return `<label>${p.label} <span class="val">${P[p.key]}</span><input data-k="${p.key}" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${P[p.key]}"></label>`;
        return `<label class="check"><input data-k="${p.key}" type="checkbox" ${P[p.key] ? 'checked' : ''}> ${p.label}</label>`;
      })
      .join('');
    $('sParams').querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => {
      el.oninput = el.onchange = () => {
        const k = el.dataset.k!;
        P[k] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
        const v = el.parentElement?.querySelector('.val');
        if (v) v.textContent = String(P[k]);
        if (!playing) renderNow();
      };
    });
  }

  // ---------- rendering ----------
  const t0 = performance.now();
  function ctx(w: number, h: number, vt: number): SensorCtx {
    return { sc: sc!, sim: sim!, t, vt, frame, map, p: params[sensor.id], w, h };
  }
  async function renderInto(out: HTMLCanvasElement, vt: number) {
    if (!sc || !sim) return;
    const c = ctx(out.width, out.height, vt);
    if (sensor.needsMap && Math.abs(map.getPixelRatio() - Math.max(1, out.width / PREVIEW[0])) > 0.01) map.setPixelRatio(Math.max(1, out.width / PREVIEW[0]));
    if (sensor.needsMap && sensor.prepare) await sensor.prepare(c);
    const g = out.getContext('2d')!;
    sensor.render(c, g);
    // attribution for imagery-based sensors
    if (sensor.needsMap) {
      g.font = `${Math.max(9, out.height / 90)}px Arial`;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.textAlign = 'right';
      g.fillText('Imagery: Sentinel-2 cloudless 2016 by EOX (CC BY 4.0) · © OpenStreetMap contributors, OpenFreeMap', out.width - 6, out.height - 6);
      g.textAlign = 'left';
    }
    return c;
  }
  let metaCache: unknown = null;
  async function renderNow() {
    if (busy || !sc) return;
    busy = true;
    try {
      const c = await renderInto(canvas, (performance.now() - t0) / 1000);
      frame++;
      if (c && (!playing || frame % 6 === 0)) showMeta(c);
      $('sTimeLabel').textContent = `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      $<HTMLInputElement>('sTime').value = String(t);
      $('sDtg').textContent = new Date(new Date(sc.meta.start).getTime() + t * 60000).toISOString().slice(11, 19) + 'Z';
    } finally {
      busy = false;
    }
  }
  function showMeta(c: SensorCtx) {
    const m = sensor.meta(c);
    metaCache = m;
    const txt = m.csv ?? JSON.stringify(m.json, null, 1);
    $('sMetaView').textContent = txt.length > 2500 ? txt.slice(0, 2500) + '\n…' : txt;
  }
  let last = 0;
  async function loop(ts: number) {
    const dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    if (sc && (playing || !sensor.needsMap) && !recording) {
      if (playing) t = Math.min(sc.meta.durationMin, t + dt * Number($<HTMLSelectElement>('sSpeed').value));
      await renderNow();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  $('sPlay').onclick = () => {
    playing = !playing;
    $('sPlay').textContent = playing ? '❚❚' : '▶';
  };
  $<HTMLInputElement>('sTime').oninput = () => {
    t = Number($<HTMLInputElement>('sTime').value);
    renderNow();
  };

  // ---------- exports ----------
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const res = () => $<HTMLSelectElement>('sRes').value.split('x').map(Number) as [number, number];
  async function withRes<T>(W: number, H: number, fn: (out: HTMLCanvasElement) => Promise<T>) {
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    map.setPixelRatio(W / PREVIEW[0]);
    try {
      return await fn(out);
    } finally {
      map.setPixelRatio(1);
    }
  }
  $('sShot').onclick = async () => {
    if (!sc) return;
    const [W, H] = res();
    const blob = await withRes(W, H, async (out) => {
      await renderInto(out, (performance.now() - t0) / 1000);
      return new Promise<Blob>((r) => out.toBlob((b) => r(b!), 'image/png'));
    });
    download(blob, `${sensor.id}_${slug(sc.meta.name)}_T${Math.round(t)}.png`);
  };
  $('sMeta').onclick = () => {
    if (!metaCache || !sc) return;
    const m = metaCache as { json?: unknown; csv?: string };
    if (m.csv) download(new Blob([m.csv], { type: 'text/csv' }), `${sensor.id}_T${Math.round(t)}.csv`);
    else download(new Blob([JSON.stringify(m.json, null, 2)], { type: 'application/json' }), `${sensor.id}_T${Math.round(t)}.json`);
  };
  let recording = false;
  const sig = { cancelled: false };
  $('sRecord').onclick = async () => {
    if (!sc) return;
    if (recording) {
      sig.cancelled = true;
      return;
    }
    recording = true;
    sig.cancelled = false;
    $('sRecord').classList.add('recording');
    const [W, H] = res();
    const fps = Number($<HTMLSelectElement>('sFps').value);
    const secs = Number($<HTMLInputElement>('sLen').value) || 20;
    const from = Number($<HTMLInputElement>('sFrom').value) || 0;
    const to = Math.min(sc.meta.durationMin, Number($<HTMLInputElement>('sTo').value) || sc.meta.durationMin);
    const frames = Math.round(secs * fps);
    const csvRows: string[] = [];
    const jsonFrames: unknown[] = [];
    sensor.reset?.();
    try {
      const r = await withRes(W, H, () =>
        recordVideo({
          width: W,
          height: H,
          fps,
          frames,
          signal: sig,
          renderFrame: async (i, out) => {
            t = from + ((to - from) * i) / Math.max(1, frames - 1);
            frame = i;
            const c = await renderInto(out, i / fps);
            if (c && i % fps === 0) {
              const m = sensor.meta(c);
              if (m.csv) csvRows.push(...m.csv.split('\n').slice(csvRows.length ? 1 : 0));
              else jsonFrames.push(m.json);
            }
          },
          onProgress: (d, n) => {
            $('sBar').style.width = `${(100 * d) / n}%`;
            $('sRec').textContent = `● ${d}/${n}`;
          },
        }),
      );
      download(r.blob, `${sensor.id}_${slug(sc.meta.name)}.${r.ext}`);
      if (csvRows.length) download(new Blob([csvRows.join('\n')], { type: 'text/csv' }), `${sensor.id}_${slug(sc.meta.name)}.csv`);
      if (jsonFrames.length) download(new Blob([JSON.stringify(jsonFrames, null, 1)], { type: 'application/json' }), `${sensor.id}_${slug(sc.meta.name)}_meta.json`);
      $('sRec').textContent = `Saved ${(r.blob.size / 1e6).toFixed(1)} MB`;
    } catch (e) {
      $('sRec').textContent = 'Failed: ' + (e as Error).message;
    } finally {
      recording = false;
      $('sRecord').classList.remove('recording');
    }
  };
  $('sDataset').onclick = async () => {
    if (!sc || recording) return;
    recording = true;
    const [W, H] = res();
    const n = Math.max(1, Number($<HTMLInputElement>('sN').value) || 25);
    const from = Number($<HTMLInputElement>('sFrom').value) || 0;
    const to = Math.min(sc.meta.durationMin, Number($<HTMLInputElement>('sTo').value) || sc.meta.durationMin);
    const run = `${sensor.id}_${slug(sc.meta.name)}_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
    const post = async (path: string, body: Blob | string) => {
      const r = await fetch(`/api/export?path=${encodeURIComponent(run + '/' + path)}`, { method: 'POST', body });
      if (!r.ok) throw new Error('export API unavailable');
      return (await r.json()).file as string;
    };
    const index: unknown[] = [];
    let csv = '';
    try {
      await withRes(W, H, async (out) => {
        for (let i = 0; i < n; i++) {
          t = from + ((to - from) * i) / Math.max(1, n - 1);
          frame = i;
          const c = await renderInto(out, i * 1.7);
          const png = await new Promise<Blob>((r) => out.toBlob((b) => r(b!), 'image/png'));
          const name = `frame_${String(i).padStart(5, '0')}`;
          await post(`${name}.png`, png);
          const m = sensor.meta(c!);
          if (m.csv) csv += (csv ? m.csv.split('\n').slice(1).join('\n') : m.csv) + '\n';
          else {
            await post(`${name}.json`, JSON.stringify(m.json, null, 1));
            index.push({ image: `${name}.png`, meta: `${name}.json`, t_min: +t.toFixed(2) });
          }
          $('sBar').style.width = `${(100 * (i + 1)) / n}%`;
          $('sRec').textContent = `Dataset ${i + 1}/${n}`;
        }
      });
      if (csv) await post('pdw.csv', csv);
      const f = await post('index.json', JSON.stringify({ sensor: sensor.id, scenario: sc.meta.name, params: params[sensor.id], resolution: [W, H], frames: index }, null, 1));
      $('sRec').textContent = `Dataset saved: ${f.replace(/index\.json$/, '')}`;
    } catch (e) {
      $('sRec').textContent = 'Dataset export failed: ' + (e as Error).message;
    } finally {
      recording = false;
    }
  };

  (window as any).sccSensors = {
    select: (id: string) => ($('sList').querySelector(`[data-s="${id}"]`) as HTMLButtonElement)?.click(),
    setTime: (x: number) => {
      t = x;
      return renderNow();
    },
    params,
    get ready() {
      return !!sc;
    },
  };

  buildParams();
  fit();
  await new Promise<void>((r) => (map.loaded() ? r() : map.once('load', () => r())));
  await loadScenario();
}
