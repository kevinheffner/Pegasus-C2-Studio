/**
 * Scenario packages = scenario settings + battle model + display + default video settings
 * + workspace layout (+ optionally the generated battle for exact replay).
 * Built-in packages ship with the app; user packages are saved to ./scenarios/saved/ on disk
 * through the dev-server API (see vite.config.ts), or downloaded/uploaded as .scc.json files.
 */
import type { Scenario } from '../scenario/types';
import type { PanelConfig } from './panel';

export type Settings = Record<string, string | boolean>;

/** view layouts: single · 2 side by side · 2 stacked · big left + 2 right · 2 left + big right · 2×2 */
export type LayoutId = '1' | '2v' | '2h' | '1+2' | '2+1' | '4';
export const LAYOUTS: { id: LayoutId; n: number; name: string }[] = [
  { id: '1', n: 1, name: 'Single view' },
  { id: '2v', n: 2, name: 'Two views side by side' },
  { id: '2h', n: 2, name: 'Two views stacked' },
  { id: '1+2', n: 3, name: 'Large view left, two stacked right' },
  { id: '2+1', n: 3, name: 'Two stacked left, large view right' },
  { id: '4', n: 4, name: 'Four views (2×2)' },
];
export const normLayout = (l: unknown): LayoutId => (l === 4 || l === '4' ? '4' : LAYOUTS.some((x) => x.id === l) ? (l as LayoutId) : '1');
export const layoutCount = (l: unknown) => LAYOUTS.find((x) => x.id === normLayout(l))!.n;

export interface WorkspaceConfig {
  layout: LayoutId | 1 | 4;
  /** free-form split tree (overrides the preset) */
  tree?: import('./tiles').LNode;
  multiAO: boolean;
  active: number;
  panels: PanelConfig[];
  /** per-panel scenario settings (multi-AO mode) */
  panelSettings?: (Settings | null)[];
}

export interface ScenarioPackage {
  format: 'scc-package';
  version: 1;
  name: string;
  description: string;
  created?: string;
  settings: Settings;
  workspace: WorkspaceConfig;
  /** generated battle(s) for exact replay; omitted for built-ins (generated on load) */
  scenario?: Scenario | null;
  panelScenarios?: (Scenario | null)[];
}

const P = (look: string, mode: '2d' | '3d', camPath: any, fog = false, title?: string): PanelConfig => ({ look, mode, camPath, fog, title });
const quad = (a: PanelConfig): PanelConfig[] => [
  a,
  P('vector-topo', '3d', 'overwatch', false, 'VIEW 2 · 3D'),
  P('c2-dark', '2d', 'static', true, 'VIEW 3 · BLUE COP'),
  P('c2-sat', '3d', 'commander', false, 'VIEW 4 · ISR'),
];
const video = (vlen: number, extra: Settings = {}): Settings => ({ res: '1920x1080', fps: '30', vlen: String(vlen), vfrom: '60', vto: '', vpace: '30', recMode: 'offline', speed: '0.5', ...extra });

export const BUILTIN_PACKAGES: ScenarioPackage[] = [
  {
    format: 'scc-package',
    version: 1,
    name: 'Fulda Gap – Armored Brigade Attack',
    description: 'Deliberate attack: armored brigade against a motor rifle brigade defending behind a fortified line. Topographic overlay, Overwatch Orbit video.',
    settings: { ao: 'fulda', zoom: '11.7', axis: '90', template: 'deliberate-attack', blue: 'abct', red: 'mr-bde', air: 'all', movement: 'roads', riverine: false, seed: '7', ...video(30) },
    workspace: { layout: 1, multiAO: false, active: 0, panels: quad(P('topo', '3d', 'overwatch', false, 'VIEW 1 · MAP')) },
  },
  {
    format: 'scc-package',
    version: 1,
    name: 'Suwałki Gap – Meeting Engagement',
    description: 'Mechanized brigade and tank brigade collide on the march. Dark C2 console, Commander’s View camera, 4-view COP workspace.',
    settings: { ao: 'suwalki', zoom: '11.7', axis: '0', template: 'meeting', blue: 'mech-bde', red: 'tank-bde', air: 'cap', movement: 'roads', riverine: false, seed: '21', ...video(30) },
    workspace: { layout: 4, multiAO: false, active: 0, panels: quad(P('c2-dark', '3d', 'commander', false, 'VIEW 1 · COP')) },
  },
  {
    format: 'scc-package',
    version: 1,
    name: 'Narva River – Delay Under Pressure',
    description: 'Red offensive; Blue motorized brigade delays back through phase lines. Riverine patrol boats and helicopters along the river. Satellite + MGRS grid, Pendulum Sweep.',
    settings: { ao: 'narva', zoom: '11.7', axis: '90', template: 'blue-delay', blue: 'motor-bde', red: 'btg', air: 'helo', movement: 'roads', riverine: true, seed: '5', ...video(30) },
    workspace: { layout: 1, multiAO: false, active: 0, panels: quad(P('c2-sat', '3d', 'pendulum', false, 'VIEW 1 · ISR')) },
  },
  {
    format: 'scc-package',
    version: 1,
    name: 'Cheorwon Valley – Blue Defense',
    description: 'Light infantry brigade holds prepared positions; enemy light infantry regiment assaults; reserve counterattacks. Vector topo with contours, Eagle Descent.',
    settings: { ao: 'cheorwon', zoom: '11.7', axis: '0', template: 'blue-defend', blue: 'light-bde', red: 'red-light', air: 'strike', movement: 'roads', riverine: false, seed: '12', ...video(30) },
    workspace: { layout: 1, multiAO: false, active: 0, panels: quad(P('vector-topo', '3d', 'eagle', false, 'VIEW 1 · 3D')) },
  },
  {
    format: 'scc-package',
    version: 1,
    name: 'Bastogne – Pursuit',
    description: 'Enemy withdraws under pressure with a rear guard; Blue pursues along the roads. Clean paper map, Map Zoom (2D) video.',
    settings: { ao: 'bastogne', zoom: '11.7', axis: '270', template: 'pursuit', blue: 'abct', red: 'tank-bde', air: 'uav', movement: 'roads', riverine: false, seed: '3', ...video(25) },
    workspace: { layout: 1, multiAO: false, active: 0, panels: quad(P('paper', '2d', 'map-zoom', false, 'VIEW 1 · MAP')) },
  },
  {
    format: 'scc-package',
    version: 1,
    name: 'NTC Rotation – Desert Attack',
    description: 'Motorized brigade attacks battalion tactical groups in the desert. Satellite imagery, Cinematic Arc.',
    settings: { ao: 'ntc', zoom: '11.7', axis: '90', template: 'deliberate-attack', blue: 'motor-bde', red: 'btg', air: 'all', movement: 'cross-country', riverine: false, seed: '9', ...video(30) },
    workspace: { layout: 1, multiAO: false, active: 0, panels: quad(P('c2-sat', '3d', 'cinematic', false, 'VIEW 1 · ISR')) },
  },
  {
    format: 'scc-package',
    version: 1,
    name: 'Theater COP – Four Areas of Operations',
    description: 'Four simultaneous fights (Fulda, Suwałki, Narva, Cheorwon) in a 2×2 C2 workspace, each in its own AO and style.',
    settings: { ao: 'fulda', zoom: '11.7', axis: '90', template: 'deliberate-attack', blue: 'abct', red: 'mr-bde', air: 'all', movement: 'roads', riverine: false, seed: '7', ...video(30) },
    workspace: {
      layout: 4,
      multiAO: true,
      active: 0,
      panels: [P('topo', '2d', 'static', false, 'AO NORTH'), P('c2-dark', '2d', 'static', false, 'AO EAST'), P('c2-sat', '2d', 'static', false, 'AO BALTIC'), P('vector-topo', '3d', 'overwatch', false, 'AO KOREA')],
      panelSettings: [
        { ao: 'fulda', zoom: '11.7', axis: '90', template: 'deliberate-attack', blue: 'abct', red: 'mr-bde', air: 'all', seed: '7' },
        { ao: 'suwalki', zoom: '11.7', axis: '0', template: 'meeting', blue: 'mech-bde', red: 'tank-bde', air: 'cap', seed: '21' },
        { ao: 'narva', zoom: '11.7', axis: '90', template: 'blue-delay', blue: 'motor-bde', red: 'btg', air: 'helo', riverine: true, seed: '5' },
        { ao: 'cheorwon', zoom: '11.7', axis: '0', template: 'blue-defend', blue: 'light-bde', red: 'red-light', air: 'strike', seed: '12' },
      ],
    },
  },
];

// ---------- disk storage via dev-server API ----------
export interface SavedEntry {
  file: string;
  name: string;
  description: string;
  created?: string;
}

export async function listSaved(): Promise<SavedEntry[]> {
  try {
    const r = await fetch('/api/scenarios');
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

export async function loadSaved(file: string): Promise<ScenarioPackage> {
  const r = await fetch('/api/scenarios/' + encodeURIComponent(file));
  if (!r.ok) throw new Error('Could not load ' + file);
  return r.json();
}

export async function saveToDisk(pkg: ScenarioPackage): Promise<string> {
  const r = await fetch('/api/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pkg) });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).file;
}

export async function deleteSaved(file: string): Promise<void> {
  await fetch('/api/scenarios/' + encodeURIComponent(file), { method: 'DELETE' });
}
