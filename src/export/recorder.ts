/**
 * Deterministic frame-by-frame video recorder.
 * Each frame: set sim time → render map → wait until all tiles are loaded → composite map + HUD
 * → encode with WebCodecs (H.264 MP4 via mp4-muxer, or VP9 WebM via webm-muxer; both MIT).
 * Because frames are rendered on demand, output is smooth at exactly `fps` regardless of
 * machine speed or network latency.
 */
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

export interface RecordOptions {
  width: number;
  height: number;
  fps: number;
  frames: number;
  bitrate?: number;
  /** render frame i into the given canvas (must fully draw it) */
  renderFrame: (i: number, out: HTMLCanvasElement) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  signal?: { cancelled: boolean };
}

export interface RecordResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  mime: string;
}

async function pickCodec(width: number, height: number, fps: number, bitrate: number) {
  const candidates = [
    { codec: 'avc1.640028', container: 'mp4' as const },
    { codec: 'avc1.4d0028', container: 'mp4' as const },
    { codec: 'vp09.00.40.08', container: 'webm' as const },
    { codec: 'vp8', container: 'webm' as const },
  ];
  for (const c of candidates) {
    const config: VideoEncoderConfig = { codec: c.codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' };
    try {
      const s = await VideoEncoder.isConfigSupported(config);
      if (s.supported) return { ...c, config };
    } catch {
      /* try next */
    }
  }
  throw new Error('No supported WebCodecs video encoder found (use Chrome or Edge).');
}

export async function recordVideo(o: RecordOptions): Promise<RecordResult> {
  const bitrate = o.bitrate ?? 12_000_000;
  const { container, config } = await pickCodec(o.width, o.height, o.fps, bitrate);
  let muxer: Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget>;
  if (container === 'mp4') {
    muxer = new Mp4Muxer({ target: new Mp4Target(), video: { codec: 'avc', width: o.width, height: o.height, frameRate: o.fps }, fastStart: 'in-memory' });
  } else {
    muxer = new WebmMuxer({ target: new WebmTarget(), video: { codec: config.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: o.width, height: o.height, frameRate: o.fps } });
  }
  let encErr: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => (muxer as any).addVideoChunk(chunk, meta),
    error: (e) => (encErr = e),
  });
  encoder.configure(config);
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const frameDur = 1e6 / o.fps;
  for (let i = 0; i < o.frames; i++) {
    if (o.signal?.cancelled) break;
    if (encErr) throw encErr;
    await o.renderFrame(i, canvas);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
    encoder.encode(vf, { keyFrame: i % (o.fps * 2) === 0 });
    vf.close();
    while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    o.onProgress?.(i + 1, o.frames);
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  const buf = (muxer.target as Mp4Target | WebmTarget).buffer;
  const mime = container === 'mp4' ? 'video/mp4' : 'video/webm';
  return { blob: new Blob([buf], { type: mime }), ext: container, mime };
}

/** incremental encoder: feed frames one by one (used for widget-view renders in the background worker) */
export async function createEncoder(o: { width: number; height: number; fps: number; bitrate?: number }) {
  const width = o.width - (o.width % 2), height = o.height - (o.height % 2);
  const { container, config } = await pickCodec(width, height, o.fps, o.bitrate ?? 10_000_000);
  const muxer: any =
    container === 'mp4'
      ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: 'avc', width, height, frameRate: o.fps }, fastStart: 'in-memory' })
      : new WebmMuxer({ target: new WebmTarget(), video: { codec: config.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width, height, frameRate: o.fps } });
  let err: unknown = null;
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (err = e) });
  enc.configure(config);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const dur = 1e6 / o.fps;
  return {
    width,
    height,
    async add(src: CanvasImageSource, i: number) {
      if (err) throw err;
      g.fillStyle = '#0a0f15';
      g.fillRect(0, 0, width, height);
      g.drawImage(src, 0, 0, width, height);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * dur), duration: Math.round(dur) });
      enc.encode(vf, { keyFrame: i % (o.fps * 2) === 0 });
      vf.close();
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    },
    async finish(): Promise<RecordResult> {
      await enc.flush();
      enc.close();
      muxer.finalize();
      const mime = container === 'mp4' ? 'video/mp4' : 'video/webm';
      return { blob: new Blob([muxer.target.buffer], { type: mime }), ext: container, mime };
    },
  };
}

export interface LiveRecording {
  /** stop and return the finished video */
  stop(): Promise<RecordResult>;
  frames(): number;
}

/**
 * Real-time recording: captures whatever is on screen (map + HUD, drawn by `draw`) at up to `fps`
 * while the user interacts with the camera. Timestamps follow the wall clock.
 */
export async function startLiveRecording(o: { width: number; height: number; fps: number; bitrate?: number; draw: (out: HTMLCanvasElement) => void }): Promise<LiveRecording> {
  const bitrate = o.bitrate ?? 12_000_000;
  const { container, config } = await pickCodec(o.width, o.height, o.fps, bitrate);
  const muxer: any =
    container === 'mp4'
      ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: 'avc', width: o.width, height: o.height, frameRate: o.fps }, fastStart: 'in-memory' })
      : new WebmMuxer({ target: new WebmTarget(), video: { codec: config.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: o.width, height: o.height, frameRate: o.fps } });
  let encErr: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encErr = e) });
  encoder.configure(config);
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  let t0 = -1;
  let n = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    if (t0 < 0) t0 = performance.now();
    const elapsed = (performance.now() - t0) / 1000;
    // one frame per 1/fps of wall-clock time; skip if the encoder is backed up
    if (elapsed * o.fps >= n && encoder.encodeQueueSize < 6 && !encErr) {
      o.draw(canvas);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(elapsed * 1e6), duration: Math.round(1e6 / o.fps) });
      encoder.encode(vf, { keyFrame: n % (o.fps * 2) === 0 });
      vf.close();
      n++;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    frames: () => n,
    async stop() {
      running = false;
      if (encErr) throw encErr;
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      const mime = container === 'mp4' ? 'video/mp4' : 'video/webm';
      return { blob: new Blob([muxer.target.buffer], { type: mime }), ext: container, mime };
    },
  };
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
}
