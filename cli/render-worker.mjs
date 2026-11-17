/**
 * Background render worker: renders a mission video in a separate headless Chrome process
 * (no rendering in the user's browser tab). Started by the dev server (POST /api/render-jobs).
 *
 *   node cli/render-worker.mjs <job.json>
 *
 * The job file holds { id, url, package, view, camera, settings, fileName }; progress is written to
 * <job>.status.json and the finished video to out/recordings/<fileName>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const jobFile = process.argv[2];
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const statusFile = jobFile.replace(/\.json$/, '.status.json');
const outDir = path.resolve(process.cwd(), 'out', 'recordings');
const status = (s) => fs.writeFileSync(statusFile, JSON.stringify({ id: job.id, pid: process.pid, updated: new Date().toISOString(), ...s }));

let browser;
async function main() {
  status({ status: 'starting', progress: { done: 0, total: 0 } });
  const [W, H] = String(job.settings.res ?? '1920x1080').split('x').map(Number);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  // viewport with the output aspect; the view is maximized and scaled up to W×H via the pixel ratio
  const page = await browser.newPage({ viewport: { width: Math.round((W / H) * 900), height: 900 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.exposeFunction('sccProgress', (done, total) => status({ status: 'rendering', progress: { done, total } }));
  await page.goto(`${job.url}/?module=cop&headless=1&autogen=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.scc?.ready, null, { timeout: 120000 });
  status({ status: 'loading mission', progress: { done: 0, total: 0 } });
  await page.evaluate((pkg) => window.scc.applyPackage(pkg), job.package);
  status({ status: 'rendering', progress: { done: 0, total: 0 } });
  const res = await page.evaluate((o) => window.scc.renderJob(o), { view: job.view, camera: job.camera, settings: job.settings });
  // fetch the video in base64 chunks
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, job.fileName.replace(/[\\/:*?"<>|]+/g, '_'));
  const fd = fs.openSync(file, 'w');
  for (let i = 0; ; i++) {
    const b64 = await page.evaluate((i) => window.scc.chunk(i), i);
    if (!b64) break;
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
  status({ status: 'done', progress: { done: res.frames, total: res.frames }, file: path.relative(process.cwd(), file), size: fs.statSync(file).size });
}

main()
  .catch((e) => status({ status: 'error', error: String(e?.message ?? e) }))
  .finally(async () => {
    await browser?.close().catch(() => {});
    process.exit(0);
  });
process.on('SIGTERM', async () => {
  status({ status: 'cancelled' });
  await browser?.close().catch(() => {});
  process.exit(0);
});
