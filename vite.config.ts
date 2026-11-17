import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

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
  plugins: [scenarioStore(), exportStore(), layoutStore()],
  optimizeDeps: { include: ['@armyc2.c5isr.renderer/mil-sym-ts-web', 'milsymbol', 'maplibre-gl'] },
});
