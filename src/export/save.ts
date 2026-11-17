/**
 * Save dialog for recordings and screenshots: asks for a file name and where to save it.
 * Targets: browser Downloads folder, the project folder (out/recordings/ via the dev server),
 * or a folder chosen with the File System Access API (Chrome / Edge).
 */
import { download } from './recorder';

type Target = 'downloads' | 'project' | 'folder';
const LS = 'scc-save-target';
let target: Target = 'downloads';
let dir: any = null; // FileSystemDirectoryHandle
try {
  target = (localStorage.getItem(LS) as Target) || 'downloads';
} catch {
  /* ignore */
}
if (target === 'folder') target = 'downloads'; // folder handles don't survive a reload

let dlg: HTMLDialogElement | null = null;
function ensureDialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'dlg small';
  dlg.id = 'saveFileDlg';
  dlg.innerHTML = `
    <div class="dlgHead"><span>💾 SAVE FILE</span><span class="grow"></span><button class="dlgClose" data-x>✕</button></div>
    <div class="dlgBody">
      <label>File name <input id="sfName" type="text" spellcheck="false" /></label>
      <label>Save to
        <select id="sfTarget">
          <option value="downloads">Browser Downloads folder</option>
          <option value="project">Project folder (out/recordings/)</option>
          <option value="folder">A folder I choose…</option>
        </select>
      </label>
      <div class="row"><button id="sfPick" class="ghost small2">📁 Choose folder…</button><span id="sfFolder" class="hint grow"></span></div>
      <div class="hint" id="sfInfo"></div>
      <div class="row">
        <button id="sfSave" class="primary small2">Save</button>
        <button id="sfDiscard" class="ghost small2">Discard</button>
      </div>
      <div class="status" id="sfStatus"></div>
    </div>`;
  document.body.appendChild(dlg);
  return dlg;
}

export function saveTarget(): Target {
  return target;
}
export function setSaveTarget(t: Target) {
  target = t;
  try {
    localStorage.setItem(LS, t === 'folder' ? 'downloads' : t);
  } catch {
    /* ignore */
  }
}
export async function chooseFolder(): Promise<string | null> {
  const picker = (window as any).showDirectoryPicker;
  if (!picker) throw new Error('This browser cannot choose folders (use Chrome or Edge).');
  dir = await picker({ id: 'scc-recordings', mode: 'readwrite', startIn: 'videos' });
  setSaveTarget('folder');
  return dir.name as string;
}
export function folderName() {
  return dir?.name ?? null;
}

async function writeTo(t: Target, blob: Blob, name: string): Promise<string> {
  if (t === 'downloads') {
    download(blob, name);
    return `Downloads/${name}`;
  }
  if (t === 'project') {
    const r = await fetch(`/api/export?root=recordings&path=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    if (!r.ok) throw new Error('project folder not available (dev server)');
    return (await r.json()).file;
  }
  if (!dir) throw new Error('choose a folder first');
  if ((await dir.queryPermission?.({ mode: 'readwrite' })) !== 'granted') await dir.requestPermission?.({ mode: 'readwrite' });
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return `${dir.name}/${name}`;
}

/**
 * Ask for a name / location and save. Resolves with the saved path, or null if discarded.
 * @param defaultName suggested file name including extension
 */
export function saveOutput(blob: Blob, defaultName: string, info = ''): Promise<string | null> {
  const d = ensureDialog();
  const $ = <T extends HTMLElement>(id: string) => d.querySelector('#' + id) as T;
  const ext = defaultName.includes('.') ? defaultName.slice(defaultName.lastIndexOf('.')) : '';
  $<HTMLInputElement>('sfName').value = defaultName;
  $<HTMLSelectElement>('sfTarget').value = target;
  $('sfInfo').textContent = `${info ? info + ' · ' : ''}${(blob.size / 1e6).toFixed(1)} MB`;
  $('sfStatus').textContent = '';
  const syncFolder = () => {
    const t = $<HTMLSelectElement>('sfTarget').value as Target;
    $('sfPick').style.display = t === 'folder' ? '' : 'none';
    $('sfFolder').textContent = t === 'folder' ? (dir ? `→ ${dir.name}` : 'no folder chosen yet') : '';
  };
  syncFolder();
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      d.close();
      resolve(v);
    };
    $<HTMLSelectElement>('sfTarget').onchange = () => {
      setSaveTarget($<HTMLSelectElement>('sfTarget').value as Target);
      syncFolder();
    };
    $<HTMLButtonElement>('sfPick').onclick = async () => {
      try {
        await chooseFolder();
      } catch (e) {
        $('sfStatus').textContent = (e as Error).message;
      }
      syncFolder();
    };
    $<HTMLButtonElement>('sfSave').onclick = async () => {
      let name = $<HTMLInputElement>('sfName').value.trim().replace(/[\\/:*?"<>|]+/g, '_') || defaultName;
      if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
      try {
        $('sfStatus').textContent = 'Saving…';
        const where = await writeTo($<HTMLSelectElement>('sfTarget').value as Target, blob, name);
        done(where);
      } catch (e) {
        $('sfStatus').textContent = 'Save failed: ' + (e as Error).message;
      }
    };
    $<HTMLButtonElement>('sfDiscard').onclick = () => {
      if (confirm('Discard this file?')) done(null);
    };
    (d.querySelector('[data-x]') as HTMLButtonElement).onclick = () => $<HTMLButtonElement>('sfDiscard').click();
    d.oncancel = (e) => {
      e.preventDefault();
      $<HTMLButtonElement>('sfDiscard').click();
    };
    d.showModal();
    setTimeout(() => {
      const inp = $<HTMLInputElement>('sfName');
      inp.focus();
      inp.setSelectionRange(0, Math.max(0, inp.value.length - ext.length));
    }, 30);
  });
}
