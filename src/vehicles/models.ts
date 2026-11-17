/**
 * Procedural, generic vehicle models (no real designs, no third-party model licences):
 * built from primitives with three.js and exported to binary glTF for CesiumJS.
 * Convention: 1 unit = 1 m, nose/forward = +X, up = +Y (glTF), origin at ground contact / waterline.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export type ModelKind = 'mbt' | 'ifv' | 'truck' | 'sph' | 'fighter' | 'transport' | 'helo' | 'uav' | 'frigate' | 'patrol';

export const MODEL_INFO: Record<ModelKind, { name: string; domain: 'land' | 'air' | 'sea'; lengthM: number; speedKph: number }> = {
  mbt: { name: 'Main battle tank (generic)', domain: 'land', lengthM: 9.5, speedKph: 35 },
  ifv: { name: 'Infantry fighting vehicle (generic)', domain: 'land', lengthM: 7, speedKph: 40 },
  truck: { name: '6×6 cargo truck (generic)', domain: 'land', lengthM: 8, speedKph: 50 },
  sph: { name: 'Self-propelled howitzer (generic)', domain: 'land', lengthM: 11, speedKph: 30 },
  fighter: { name: 'Twin-tail fighter (generic)', domain: 'air', lengthM: 18, speedKph: 750 },
  transport: { name: 'Tactical transport (generic)', domain: 'air', lengthM: 30, speedKph: 480 },
  helo: { name: 'Utility helicopter (generic)', domain: 'air', lengthM: 17, speedKph: 220 },
  uav: { name: 'MALE UAV (generic)', domain: 'air', lengthM: 11, speedKph: 250 },
  frigate: { name: 'Frigate (generic)', domain: 'sea', lengthM: 120, speedKph: 45 },
  patrol: { name: 'Patrol boat (generic)', domain: 'sea', lengthM: 25, speedKph: 55 },
};

const mat = (color: number, rough = 0.8, metal = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  return b;
}
function cyl(rt: number, rb: number, len: number, m: THREE.Material, seg = 16) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), m);
}
/** tube along +X */
function tubeX(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, rTip = r) {
  const c = cyl(rTip, r, len, m);
  c.rotation.z = -Math.PI / 2;
  c.position.set(x + len / 2, y, z);
  return c;
}
/** extruded side profile (in X/Y) of given width (Z) */
function profile(pts: [number, number][], width: number, m: THREE.Material) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.clearGroups(); // single material: keep side walls when exporting to glTF
  g.translate(0, 0, -width / 2);
  return new THREE.Mesh(g, m);
}
/** plan-view shape (in X/Z) extruded upward by height */
function plan(pts: [number, number][], height: number, m: THREE.Material, y0 = 0) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false });
  g.clearGroups();
  g.rotateX(Math.PI / 2);
  g.translate(0, y0 + height, 0);
  return new THREE.Mesh(g, m);
}
function wheel(r: number, w: number, m: THREE.Material, x: number, z: number) {
  const c = cyl(r, r, w, m, 14);
  c.rotation.x = Math.PI / 2;
  c.position.set(x, r, z);
  return c;
}

export const CAMO: Record<string, number> = { olive: 0x4b5320, desert: 0xb59a6a, gray: 0x6e7376, green: 0x3f4f2f, navy: 0x7c858c, black: 0x222222 };

function build(kind: ModelKind, camo: number): THREE.Group {
  const g = new THREE.Group();
  const body = mat(camo, 0.85);
  const dark = mat(0x1d1d1b, 0.9);
  const metal = mat(0x3a3a38, 0.6, 0.4);
  const glass = mat(0x223344, 0.2, 0.6);
  switch (kind) {
    case 'mbt': {
      g.add(box(7.2, 0.9, 0.7, dark, 0, 0.55, 1.45), box(7.2, 0.9, 0.7, dark, 0, 0.55, -1.45)); // tracks
      for (let i = 0; i < 7; i++) g.add(wheel(0.38, 0.75, dark, -2.9 + i * 0.97, 1.46), wheel(0.38, 0.75, dark, -2.9 + i * 0.97, -1.46));
      g.add(profile([[-3.6, 0.6], [3.4, 0.6], [3.9, 1.3], [3.3, 1.75], [-3.7, 1.75]], 3.4, body)); // hull
      g.add(plan([[-1.9, -1.5], [0.9, -1.6], [2.1, -0.6], [2.1, 0.6], [0.9, 1.6], [-1.9, 1.5]], 0.8, body, 1.75)); // turret
      g.add(tubeX(0.12, 5.2, metal, 2.0, 2.15, 0, 0.1)); // gun
      g.add(cyl(0.35, 0.35, 0.35, body).translateX(-0.6).translateY(2.75).translateZ(0.7)); // cupola
      break;
    }
    case 'ifv': {
      g.add(box(6.0, 0.8, 0.55, dark, 0, 0.5, 1.35), box(6.0, 0.8, 0.55, dark, 0, 0.5, -1.35));
      for (let i = 0; i < 6; i++) g.add(wheel(0.33, 0.6, dark, -2.4 + i * 0.96, 1.36), wheel(0.33, 0.6, dark, -2.4 + i * 0.96, -1.36));
      g.add(profile([[-3.2, 0.5], [2.6, 0.5], [3.4, 1.4], [2.8, 2.2], [-3.2, 2.2]], 3.1, body));
      g.add(plan([[-0.8, -0.8], [0.7, -0.8], [1.0, 0], [0.7, 0.8], [-0.8, 0.8]], 0.55, body, 2.2));
      g.add(tubeX(0.06, 2.4, metal, 0.9, 2.5, 0));
      break;
    }
    case 'sph': {
      g.add(box(7.8, 0.9, 0.7, dark, 0, 0.55, 1.5), box(7.8, 0.9, 0.7, dark, 0, 0.55, -1.5));
      g.add(profile([[-4.0, 0.6], [3.6, 0.6], [4.0, 1.3], [3.4, 1.8], [-4.0, 1.8]], 3.4, body));
      g.add(box(4.2, 1.6, 3.2, body, -1.2, 2.6, 0));
      g.add(tubeX(0.16, 7.0, metal, 0.9, 2.9, 0, 0.13));
      break;
    }
    case 'truck': {
      for (const x of [2.6, -0.9, -2.4]) g.add(wheel(0.55, 0.45, dark, x, 1.05), wheel(0.55, 0.45, dark, x, -1.05));
      g.add(box(7.6, 0.35, 2.2, metal, 0, 1.0, 0)); // chassis
      g.add(box(2.0, 1.8, 2.4, body, 2.9, 2.0, 0)); // cab
      g.add(box(0.05, 0.8, 2.1, glass, 3.91, 2.4, 0));
      g.add(box(4.8, 1.9, 2.5, mat(Math.max(0, camo - 0x111111), 0.95), -1.2, 2.2, 0)); // canvas cargo
      break;
    }
    case 'fighter': {
      g.add(tubeX(0.75, 13, body, -7.5, 2.2, 0));
      g.add(tubeX(0.75, 3.2, body, 5.5, 2.2, 0, 0.05)); // nose cone
      g.add(box(2.4, 0.5, 0.9, glass, 3.8, 2.85, 0)); // canopy
      g.add(plan([[2.5, 0.6], [-3.5, 6.8], [-5.2, 6.8], [-5.0, 0.6]], 0.15, body, 2.0)); // right wing
      g.add(plan([[2.5, -0.6], [-5.0, -0.6], [-5.2, -6.8], [-3.5, -6.8]], 0.15, body, 2.0)); // left wing
      g.add(plan([[-5.5, 0.4], [-7.3, 3.0], [-8.2, 3.0], [-8.0, 0.4]], 0.12, body, 2.0));
      g.add(plan([[-5.5, -0.4], [-8.0, -0.4], [-8.2, -3.0], [-7.3, -3.0]], 0.12, body, 2.0));
      for (const z of [0.9, -0.9]) {
        const fin = profile([[-5.0, 2.6], [-6.9, 5.4], [-8.0, 5.4], [-7.8, 2.6]], 0.12, body);
        fin.position.z = z;
        fin.rotation.x = z > 0 ? -0.25 : 0.25;
        g.add(fin);
      }
      g.add(tubeX(0.55, 0.8, dark, -8.3, 2.2, 0.45), tubeX(0.55, 0.8, dark, -8.3, 2.2, -0.45));
      break;
    }
    case 'transport': {
      g.add(tubeX(2.0, 22, body, -11, 3.2, 0));
      g.add(tubeX(2.0, 4, body, 11, 3.2, 0, 0.6));
      g.add(profile([[-11, 2.0], [-17, 4.6], [-17, 5.2], [-11, 5.2]], 2.6, body)); // tail upsweep
      g.add(plan([[2.5, 0], [-1.5, 19], [-4.0, 19], [-3.0, 0], [-4.0, -19], [-1.5, -19]], 0.4, body, 5.1)); // high wing
      g.add(profile([[-14, 5.0], [-17.5, 11], [-19.5, 11], [-18, 5.0]], 0.3, body));
      g.add(plan([[-16.5, 0], [-18.5, 7], [-20, 7], [-19.5, 0], [-20, -7], [-18.5, -7]], 0.25, body, 10.8));
      for (const z of [6, 11, -6, -11]) g.add(tubeX(0.8, 4, dark, -0.5, 4.4, z, 0.7));
      break;
    }
    case 'helo': {
      g.add(tubeX(1.3, 6.5, body, -2.5, 1.9, 0, 1.0));
      g.add(box(1.6, 1.0, 2.0, glass, 3.4, 2.1, 0));
      g.add(tubeX(0.35, 8, body, -10, 2.4, 0, 0.25));
      g.add(profile([[-9.5, 2.4], [-10.6, 4.4], [-11.2, 4.4], [-10.6, 2.4]], 0.15, body));
      g.add(box(0.8, 0.6, 1.4, body, -0.5, 3.4, 0));
      const rotor = cyl(7.8, 7.8, 0.05, new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.25 }), 32);
      rotor.position.set(-0.5, 3.8, 0);
      g.add(rotor);
      g.add(box(4.0, 0.12, 0.12, metal, 0.5, 0.35, 0.9), box(4.0, 0.12, 0.12, metal, 0.5, 0.35, -0.9)); // skids
      break;
    }
    case 'uav': {
      g.add(tubeX(0.45, 8.5, body, -4.5, 1.5, 0, 0.3));
      g.add(cyl(0.5, 0.45, 0.6, body).translateX(4.0).translateY(1.7));
      g.add(plan([[0.6, 0], [0.0, 10], [-0.8, 10], [-0.6, 0], [-0.8, -10], [0.0, -10]], 0.12, body, 1.6));
      for (const z of [0.35, -0.35]) {
        const v = profile([[-3.5, 1.6], [-4.4, 3.0], [-4.9, 3.0], [-4.6, 1.6]], 0.08, body);
        v.position.z = z;
        v.rotation.x = z > 0 ? -0.6 : 0.6;
        g.add(v);
      }
      break;
    }
    case 'frigate': {
      const hull = mat(camo, 0.7, 0.2);
      g.add(plan([[60, 0], [40, 6.5], [-50, 7.5], [-60, 6.5], [-60, -6.5], [-50, -7.5], [40, -6.5]], 9, hull, -4));
      g.add(box(30, 6, 11, hull, -5, 8, 0)); // superstructure
      g.add(box(12, 5, 9, hull, 8, 13, 0)); // bridge
      g.add(box(0.2, 1.4, 8.5, glass, 14.1, 14.2, 0));
      g.add(cyl(0.6, 0.9, 16, metal).translateX(0).translateY(22)); // mast
      g.add(box(6, 4, 7, hull, -14, 12, 0)); // funnel
      g.add(box(16, 3, 12, hull, -42, 6.5, 0)); // hangar/flight deck
      g.add(cyl(1.6, 1.8, 1.6, hull).translateX(32).translateY(6)); // gun mount
      g.add(tubeX(0.15, 5, metal, 33, 6.3, 0));
      break;
    }
    case 'patrol': {
      const hull = mat(camo, 0.7, 0.2);
      g.add(plan([[12.5, 0], [7, 2.8], [-12.5, 3.0], [-12.5, -3.0], [7, -2.8]], 3, hull, -1.2));
      g.add(box(7, 2.5, 4.2, hull, -1, 3.0, 0));
      g.add(box(0.15, 0.8, 3.8, glass, 2.55, 3.6, 0));
      g.add(cyl(0.2, 0.25, 5, metal).translateX(-1).translateY(6.5));
      g.add(cyl(0.6, 0.7, 0.8, hull).translateX(7).translateY(2.2));
      g.add(tubeX(0.08, 2.2, metal, 7.2, 2.5, 0));
      break;
    }
  }
  return g;
}

const cache = new Map<string, string>();
/** returns a blob: URL of a binary glTF for the given model kind and colour */
export async function modelUrl(kind: ModelKind, camo = CAMO.olive): Promise<string> {
  const key = `${kind}:${camo}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const scene = new THREE.Scene();
  scene.add(build(kind, camo));
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  cache.set(key, url);
  return url;
}
