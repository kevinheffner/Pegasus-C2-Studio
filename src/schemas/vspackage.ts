/**
 * Video Studio schema package (.vsschema.zip): a schema project's images and animations, each with its narration
 * and the storyboard scene / section it belongs to, for import into Video Studio (Storyboard → Import schema package).
 *
 *   manifest.json   { format: "video-studio-schema", version: 1, project, items: [...] }
 *   media/…         one PNG (image) or MP4 (animation) per item
 */
import JSZip from 'jszip';
import { narrationOf, slug, styleOf, type SchemaProject } from './model';

export interface VsManifestItem {
  id: string;
  title: string;
  subtitle: string;
  kind: 'animation' | 'image';
  file: string;
  mime: string;
  duration_s: number | null;
  /** the narration to add to the target scene (Video Studio voices it) */
  narration: string;
  /** the on-screen captions of the animation, with their times */
  captions: { t: number; text: string }[];
  target: { scene: string; section: string; mode: 'append' | 'replace' | 'new' };
  style: string;
  description: string;
  sources: string[];
}
export interface VsManifest {
  format: 'video-studio-schema';
  version: 1;
  generator: string;
  created: string;
  project: { id: string; name: string; description: string };
  items: VsManifestItem[];
}

export async function buildVsPackage(
  p: SchemaProject,
  render: (itemIndex: number, kind: 'animation' | 'image', onp: (f: number) => void) => Promise<{ blob: Blob; ext: string; mime: string }>,
  onp: (f: number, msg: string) => void,
) {
  const zip = new JSZip();
  const items: VsManifestItem[] = [];
  for (let i = 0; i < p.items.length; i++) {
    const it = p.items[i];
    const f0 = i / p.items.length;
    onp(f0, `(${i + 1}/${p.items.length}) ${it.schema.title}…`);
    const r = await render(i, it.kind, (f) => onp(f0 + f / p.items.length, `(${i + 1}/${p.items.length}) ${it.schema.title}: ${Math.round(f * 100)}%`));
    const file = `media/${String(i + 1).padStart(2, '0')}-${slug(it.schema.title)}.${r.ext}`;
    zip.file(file, r.blob);
    items.push({
      id: it.id,
      title: it.schema.title,
      subtitle: it.schema.subtitle,
      kind: it.kind,
      file,
      mime: r.mime,
      duration_s: it.kind === 'animation' ? it.schema.duration : null,
      narration: narrationOf(it),
      captions: it.schema.captions.map((c) => ({ t: c.t, text: c.text })),
      target: { scene: it.vs.scene, section: it.vs.section, mode: it.vs.mode },
      style: styleOf(p, it).name,
      description: it.schema.description,
      sources: it.schema.refs ?? [],
    });
  }
  const manifest: VsManifest = {
    format: 'video-studio-schema',
    version: 1,
    generator: 'Pegasus Simulation Content Creator · Animated Schemas',
    created: new Date().toISOString(),
    project: { id: p.id, name: p.name, description: p.description },
    items,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('README.txt', `Video Studio schema package: ${p.name}\n\nImport it in Video Studio: Storyboard tab → Import schema package…\nEach image or animation is added to the media catalog, placed in its target scene and its narration is added to that scene.\n`);
  onp(1, 'Compressing…');
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
