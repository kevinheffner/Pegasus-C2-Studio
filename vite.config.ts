import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Tiny local API so scenario packages are saved as files in ./scenarios/saved/ */
function scenarioStore(): Plugin {
  const dir = path.resolve(process.cwd(), 'scenarios', 'saved');
  const safe = (f: string) => path.basename(f).replace(/[^a-zA-Z0-9._-]/g, '');
  return {
    name: 'scc-scenario-store',
    configureServer(server) {
      server.middlewares.use('/api/scenarios', (req, res) => {
        fs.mkdirSync(dir, { recursive: true });
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const file = safe(decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]));
        try {
          if (req.method === 'GET' && !file) {
            const list = fs
              .readdirSync(dir)
              .filter((f) => f.endsWith('.json'))
              .map((f) => {
                try {
                  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                  return { file: f, name: j.name ?? f, description: j.description ?? '', created: j.created };
                } catch {
                  return { file: f, name: f, description: '(unreadable)' };
                }
              })
              .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
            return send(200, list);
          }
          if (req.method === 'GET' && file) {
            const p = path.join(dir, file);
            if (!fs.existsSync(p)) return send(404, { error: 'not found' });
            res.setHeader('Content-Type', 'application/json');
            return res.end(fs.readFileSync(p));
          }
          if (req.method === 'DELETE' && file) {
            fs.rmSync(path.join(dir, file), { force: true });
            return send(200, { ok: true });
          }
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
              try {
                const pkg = JSON.parse(body);
                const slug = String(pkg.name ?? 'scenario').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'scenario';
                const f = `${slug}.scc.json`;
                fs.writeFileSync(path.join(dir, f), JSON.stringify(pkg));
                send(200, { file: f });
              } catch (e) {
                send(400, { error: String(e) });
              }
            });
            return;
          }
          send(405, { error: 'method not allowed' });
        } catch (e) {
          send(500, { error: String(e) });
        }
      });
    },
  };
}

/** Workspace layouts (widget dock, views, layers) stored in ./config/layouts.json */
function layoutStore(): Plugin {
  const file = path.resolve(process.cwd(), 'config', 'layouts.json');
  return {
    name: 'scc-layout-store',
    configureServer(server) {
      server.middlewares.use('/api/layouts', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') return res.end(fs.existsSync(file) ? fs.readFileSync(file) : JSON.stringify({ default: null, layouts: {} }));
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('{}');
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            JSON.parse(body);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, body);
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}

/** Background render jobs: each job renders a video in a separate headless Chrome (cli/render-worker.mjs) */
function renderJobs(): Plugin {
  const dir = path.resolve(process.cwd(), 'out', 'render-jobs');
  const recDir = path.resolve(process.cwd(), 'out', 'recordings');
  return {
    name: 'scc-render-jobs',
    configureServer(server) {
      server.middlewares.use('/api/recordings', (req, res) => {
        const f = path.basename(decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]));
        const p = path.join(recDir, f);
        if (!f || !fs.existsSync(p)) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', f.endsWith('.webm') ? 'video/webm' : 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${f}"`);
        fs.createReadStream(p).pipe(res);
      });
      server.middlewares.use('/api/render-jobs', (req, res) => {
        fs.mkdirSync(dir, { recursive: true });
        res.setHeader('Content-Type', 'application/json');
        const id = path.basename(decodeURIComponent((req.url ?? '/').slice(1).split('?')[0])).replace(/[^a-zA-Z0-9_-]/g, '');
        const statusOf = (jid: string) => {
          const f = path.join(dir, jid + '.status.json');
          return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { id: jid, status: 'queued' };
        };
        if (req.method === 'GET' && id) return res.end(JSON.stringify(statusOf(id)));
        if (req.method === 'DELETE' && id) {
          const s = statusOf(id);
          try {
            if (s.pid) process.kill(s.pid, 'SIGTERM');
          } catch {
            /* already gone */
          }
          fs.writeFileSync(path.join(dir, id + '.status.json'), JSON.stringify({ ...s, status: 'cancelled' }));
          return res.end(JSON.stringify({ ok: true }));
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            try {
              const job = JSON.parse(body);
              const jid = 'job-' + Date.now().toString(36);
              const host = req.headers.host ?? 'localhost:5173';
              const file = path.join(dir, jid + '.json');
              fs.writeFileSync(file, JSON.stringify({ ...job, id: jid, url: `http://${host}` }));
              fs.writeFileSync(path.join(dir, jid + '.status.json'), JSON.stringify({ id: jid, status: 'queued' }));
              const child = spawn(process.execPath, [path.resolve(process.cwd(), 'cli', 'render-worker.mjs'), file], { cwd: process.cwd(), detached: true, stdio: 'ignore' });
              child.unref();
              res.end(JSON.stringify({ id: jid }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end('{}');
      });
    },
  };
}

/** Save exported sensor frames / metadata into ./out/exports/<run>/ */
function exportStore(): Plugin {
  const root = path.resolve(process.cwd(), 'out', 'exports');
  return {
    name: 'scc-export-store',
    configureServer(server) {
      server.middlewares.use('/api/export', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        const url = new URL(req.url ?? '/', 'http://x');
        const rel = (url.searchParams.get('path') ?? 'file.bin').split(/[\/]/).map((p) => p.replace(/[^a-zA-Z0-9._-]/g, '')).filter((p) => p && p !== '..').join(path.sep);
        const base = url.searchParams.get('root') === 'recordings' ? path.resolve(process.cwd(), 'out', 'recordings') : root;
        const file = path.join(base, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.writeFileSync(file, Buffer.concat(chunks));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ file: path.relative(process.cwd(), file) }));
        });
      });
    },
  };
}

export default defineConfig({
  server: { port: 5173 },
  plugins: [scenarioStore(), exportStore(), layoutStore(), renderJobs()],
  optimizeDeps: { include: ['@armyc2.c5isr.renderer/mil-sym-ts-web', 'milsymbol', 'maplibre-gl'] },
});
