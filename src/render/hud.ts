/**
 * Canvas-drawn HUD / C2 chrome. Drawn identically in the live preview overlay and in
 * recorded frames (composited on top of the map canvas). All UI chrome is generic.
 */
import type { Map as MLMap } from 'maplibre-gl';
import type { Scenario } from '../scenario/types';
import type { SimState } from '../scenario/sim';
import { sideOf } from '../scenario/sim';
import { toMgrs } from '../geo/geo';
import type { Look } from './looks';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function dtg(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
}

export interface HudContext {
  look: Look;
  scenario: Scenario;
  state: SimState;
  map: MLMap;
  banner: string;
  /** how the marking is drawn */
  markStyle?: 'none' | 'corner' | 'banner';
  mode: '2d' | '3d';
  /** draw C2 chrome (bars, log, scale); the marking banner and attribution are always drawn */
  chrome?: boolean;
}

function niceScale(maxM: number) {
  const pow = 10 ** Math.floor(Math.log10(maxM));
  for (const m of [5, 2, 1]) if (m * pow <= maxM) return m * pow;
  return pow;
}

/**
 * Draw the HUD into ctx. `w`,`h` are the logical (CSS) size; `s` is the device scale.
 */
export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, s: number, hc: HudContext) {
  const { look, scenario, state, map } = hc;
  ctx.save();
  ctx.scale(s, s);
  const now = new Date(new Date(scenario.meta.start).getTime() + state.t * 60000);
  const font = (px: number, weight = 'normal', mono = false) => `${weight} ${px}px ${mono ? '"Consolas","Lucida Console",monospace' : 'Arial, Helvetica, sans-serif'}`;

  const chrome = hc.chrome !== false;
  const dark = look.dark;
  if (chrome) {
  // scale bar (all looks)
  const y = map.getCenter().lat;
  const mpp = (78271.51696 * Math.cos((y * Math.PI) / 180)) / 2 ** map.getZoom();
  const target = niceScale(mpp * 160);
  const px = target / mpp;
  const sbx = 16;
  const sby = h - (look.hud === 'c2-dark' ? 64 : 30);
  ctx.fillStyle = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.8)';
  ctx.fillRect(sbx - 6, sby - 18, px + 12, 28);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? (dark ? '#e8f1ff' : '#fff') : dark ? '#4fb3ff' : '#c03030';
    ctx.fillRect(sbx + (px / 4) * i, sby, px / 4, 5);
  }
  ctx.strokeStyle = dark ? '#e8f1ff' : '#333';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(sbx, sby, px, 5);
  ctx.fillStyle = dark ? '#e8f1ff' : '#222';
  ctx.font = font(11, 'bold');
  ctx.fillText('0', sbx - 3, sby - 4);
  const lbl = target >= 1000 ? `${target / 1000} km` : `${target} m`;
  ctx.fillText(lbl, sbx + px - ctx.measureText(lbl).width / 2, sby - 4);

  if (look.hud === 'c2-light') {
    // project box top-left, DTG box top-right
    ctx.font = font(13);
    const title = scenario.meta.title ?? scenario.meta.name;
    const tw = ctx.measureText(title).width;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(8, 8, tw + 16, 24);
    ctx.fillStyle = '#222';
    ctx.fillText(title, 16, 25);
    const d = dtg(now);
    const dw = ctx.measureText(d).width;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(w - dw - 24, 8, dw + 16, 24);
    ctx.fillStyle = '#222';
    ctx.fillText(d, w - dw - 16, 25);
  }

  if (look.hud === 'c2-dark') {
    // top bar
    ctx.fillStyle = 'rgba(6,14,24,0.86)';
    ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = '#1f6fb2';
    ctx.fillRect(0, 34, w, 1.5);
    ctx.font = font(14, 'bold', true);
    ctx.fillStyle = '#9fd3ff';
    ctx.fillText('COP', 14, 22);
    ctx.fillStyle = '#e8f1ff';
    ctx.font = font(13, 'normal', true);
    // keep the title clear of the counters and DTG on the right in narrow views
    const maxTitle = Math.max(8, Math.floor((w - 470) / 7.8));
    const ttl = scenario.meta.title ?? scenario.meta.name;
    ctx.fillText(ttl.length > maxTitle ? ttl.slice(0, maxTitle - 1) + '…' : ttl, 60, 22);
    const d = dtg(now);
    ctx.font = font(16, 'bold', true);
    const dw = ctx.measureText(d).width;
    ctx.fillStyle = '#7dffb0';
    ctx.fillText(d, w - dw - 14, 23);
    const blue = state.units.filter((u) => sideOf(u.sidc) === 'friend' && u.status !== 'destroyed').length;
    const red = state.units.filter((u) => sideOf(u.sidc) === 'hostile' && u.status !== 'destroyed').length;
    ctx.font = font(12, 'bold', true);
    const counts = `FRD ${String(blue).padStart(2, '0')}   HOS ${String(red).padStart(2, '0')}   ${hc.mode.toUpperCase()}`;
    const cw = ctx.measureText(counts).width;
    ctx.fillStyle = '#c8d6e8';
    ctx.fillText(counts, w - dw - cw - 40, 22);

    // bottom status bar
    ctx.fillStyle = 'rgba(6,14,24,0.86)';
    ctx.fillRect(0, h - 28, w, 28);
    ctx.font = font(12, 'normal', true);
    ctx.fillStyle = '#c8d6e8';
    const c = map.getCenter();
    ctx.fillText(`CTR ${toMgrs(c.lng, c.lat, 5)}   Z ${map.getZoom().toFixed(1)}   HDG ${String(Math.round((map.getBearing() + 360) % 360)).padStart(3, '0')}°`, 14, h - 10);
    const T = `T+${String(Math.floor(state.t / 60)).padStart(2, '0')}:${String(Math.floor(state.t % 60)).padStart(2, '0')}`;
    ctx.fillText(T, w - ctx.measureText(T).width - 14, h - 10);

    // message log (right side)
    const msgs = state.messages.slice(-6);
    if (msgs.length) {
      const bw = 360;
      const bh = 22 + msgs.length * 18;
      const bx = w - bw - 12;
      const by = 46;
      ctx.fillStyle = 'rgba(6,14,24,0.78)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#1f6fb2';
      ctx.strokeRect(bx, by, bw, bh);
      ctx.font = font(11, 'bold', true);
      ctx.fillStyle = '#9fd3ff';
      ctx.fillText('EVENT LOG', bx + 8, by + 15);
      ctx.font = font(11, 'normal', true);
      msgs.forEach((m, i) => {
        const tt = new Date(new Date(scenario.meta.start).getTime() + (state.t - m.age) * 60000);
        const hh = `${String(tt.getUTCHours()).padStart(2, '0')}${String(tt.getUTCMinutes()).padStart(2, '0')}Z`;
        ctx.fillStyle = /destroyed|CONTACT|withdraw/i.test(m.text) ? '#ffb070' : '#e8f1ff';
        ctx.globalAlpha = Math.max(0.35, 1 - m.age / 30);
        ctx.fillText(`${hh} ${m.text}`.slice(0, 52), bx + 8, by + 33 + i * 18);
        ctx.globalAlpha = 1;
      });
    }
    // north arrow
    const bearing = map.getBearing();
    ctx.save();
    ctx.translate(36, 70);
    ctx.rotate((-bearing * Math.PI) / 180);
    ctx.fillStyle = '#e8f1ff';
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(7, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-7, 10);
    ctx.closePath();
    ctx.fill();
    ctx.font = font(11, 'bold');
    ctx.fillText('N', -4, -20);
    ctx.restore();
  }

  } // chrome

  // basemap attribution (required by the tile licences; burned into exports)
  ctx.font = font(10);
  const attr = look.attribution;
  const aw = ctx.measureText(attr).width;
  const ay = chrome && look.hud === 'c2-dark' ? h - 34 : h - 6;
  ctx.fillStyle = dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
  ctx.fillRect(w - aw - 10, ay - 11, aw + 8, 14);
  ctx.fillStyle = dark ? '#c8d6e8' : '#333';
  ctx.fillText(attr, w - aw - 6, ay);

  // optional marking
  const ms = hc.markStyle ?? 'none';
  if (hc.banner && ms === 'corner') {
    ctx.font = font(10, 'bold');
    const tw = ctx.measureText(hc.banner).width;
    const ty = chrome && look.hud === 'c2-dark' ? 46 : 8;
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.6)';
    ctx.fillRect(w - tw - 18, ty, tw + 10, 15);
    ctx.fillStyle = dark ? 'rgba(220,230,240,0.85)' : 'rgba(30,30,30,0.8)';
    ctx.fillText(hc.banner, w - tw - 13, ty + 11);
  }
  if (hc.banner && ms === 'banner') {
    ctx.font = font(12, 'bold');
    const bw = ctx.measureText(hc.banner).width + 24;
    const by = chrome && look.hud === 'c2-dark' ? 40 : 8;
    ctx.fillStyle = 'rgba(0,122,61,0.92)';
    ctx.fillRect((w - bw) / 2, by, bw, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(hc.banner, (w - bw) / 2 + 12, by + 14.5);
  }
  ctx.restore();
}
