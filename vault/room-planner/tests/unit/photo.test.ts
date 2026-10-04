// Render photo (Spec Addition A2, M4.7): presets, estimates, caption, file name, support check and the job state machine (no WebGL).
import { describe, expect, it } from 'vitest';
import {
  captionLayout, etaSeconds, formatDuration, LIGHTING, photoFileName, photoUnsupportedReason, PhotoJob, QUALITY_SAMPLES, SIZE_PRESETS, sizeById,
  type GlLike, type JobSnapshot, type Tracer,
} from '../../src/render3d/photo';

class FakeTracer implements Tracer {
  samples = 0;
  disposed = false;
  steps = 0;
  prepareError: Error | null = null;
  stepError: Error | null = null;
  gate: Promise<void> | null = null;
  async prepare(): Promise<void> { if (this.gate) await this.gate; if (this.prepareError) throw this.prepareError; }
  step(): number { this.steps++; if (this.stepError) throw this.stepError; return ++this.samples; }
  dispose(): void { this.disposed = true; }
}

describe('presets', () => {
  it('has the four picture sizes and three quality targets, increasing', () => {
    expect(SIZE_PRESETS.map((s) => [s.width, s.height])).toEqual([[640, 360], [1280, 720], [1920, 1080], [3840, 2160]]);
    expect(QUALITY_SAMPLES.draft).toBeLessThan(QUALITY_SAMPLES.good);
    expect(QUALITY_SAMPLES.good).toBeLessThan(QUALITY_SAMPLES.best);
  });
  it('falls back to the default size (1280 × 720) for an unknown size', () => { expect(sizeById('nope').width).toBe(1280); });
  it('has daylight, overcast and evening lighting; evening is lower and warmer than daylight, overcast has the weakest sun', () => {
    expect(Object.keys(LIGHTING).sort()).toEqual(['daylight', 'evening', 'overcast']);
    expect(LIGHTING.evening.sunElevationDeg).toBeLessThan(LIGHTING.daylight.sunElevationDeg);
    expect(LIGHTING.overcast.sun).toBeLessThan(LIGHTING.daylight.sun);
    expect(LIGHTING.overcast.sun).toBeLessThan(LIGHTING.evening.sun);
  });
});

describe('estimates', () => {
  it('time left = samples to go ÷ measured speed; unknown until there is a speed', () => {
    expect(etaSeconds(64, 256, 8)).toBe(24);
    expect(etaSeconds(256, 256, 8)).toBe(0);
    expect(etaSeconds(300, 256, 8)).toBe(0);
    expect(etaSeconds(0, 256, 0)).toBeNull();
  });
  it('formats durations in plain words', () => {
    expect(formatDuration(null)).toBe('working it out…');
    expect(formatDuration(2)).toBe('under 5 s');
    expect(formatDuration(35.4)).toBe('35 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(130)).toBe('2 min 10 s');
    expect(formatDuration(3720)).toBe('1 h 2 min');
  });
});

describe('file name and caption', () => {
  const d = new Date(2026, 9, 3); // 3 Oct 2026 (local)
  it('is <project>-<room>-<yyyy-mm-dd>.png, lower-case, safe', () => {
    expect(photoFileName('Smith Residence', 'Living Room', d)).toBe('smith-residence-living-room-2026-10-03.png');
    expect(photoFileName('Café / Bar #2', 'Back  room!', d)).toBe('cafe-bar-2-back-room-2026-10-03.png');
  });
  it('leaves out a room name that repeats the project, and never produces an empty name', () => {
    expect(photoFileName('Room 1', 'Room 1', d)).toBe('room-1-2026-10-03.png');
    expect(photoFileName('', '', d)).toBe('room-2026-10-03.png');
    expect(photoFileName('日本', '', d)).toBe('room-2026-10-03.png');
  });
  it('caption strip scales with the picture and shows project · room at the left, date at the right', () => {
    const small = captionLayout(1280, 'Smith', 'Living', d);
    const big = captionLayout(3840, 'Smith', 'Living', d);
    expect(big.stripHeight).toBeGreaterThan(small.stripHeight);
    expect(small.left).toBe('Smith · Living');
    expect(small.right).toBe('2026-10-03');
    expect(small.stripHeight).toBeGreaterThan(small.fontPx);
    expect(small.baseline).toBeLessThan(small.stripHeight);
    expect(captionLayout(1280, 'Same', 'Same', d).left).toBe('Same');
    expect(captionLayout(1280, 'Same', '  ', d).left).toBe('Same');
  });
});

describe('device support', () => {
  const gl = (over: Partial<{ ext: boolean; max: number }> = {}): GlLike => ({
    MAX_TEXTURE_SIZE: 3379,
    getExtension: (n: string) => (n === 'EXT_color_buffer_float' && (over.ext ?? true) ? {} : null),
    getParameter: () => over.max ?? 16384,
  });
  it('is fine with WebGL2 and float render targets', () => { expect(photoUnsupportedReason(gl())).toBeNull(); });
  it('gives the plain message with no WebGL2 or no float targets', () => {
    expect(photoUnsupportedReason(null)).toMatch(/can't render photos/);
    expect(photoUnsupportedReason(gl({ ext: false }))).toMatch(/Realistic 3D view still works/);
  });
  it('says so when the chosen size is bigger than the GPU allows', () => {
    expect(photoUnsupportedReason(gl({ max: 2048 }), 3840, 2160)).toMatch(/2048/);
    expect(photoUnsupportedReason(gl({ max: 2048 }), 1280, 720)).toBeNull();
  });
});

describe('PhotoJob', () => {
  const run = async (j: PhotoJob, frames: number, t0 = 0, dt = 100): Promise<number> => {
    let t = t0;
    for (let i = 0; i < frames; i++) { j.tick(t); t += dt; }
    return t;
  };

  it('goes idle → building → rendering → done, one sample per frame', async () => {
    const tr = new FakeTracer();
    const j = new PhotoJob(tr, 5);
    const seen: string[] = [];
    j.subscribe((s) => { if (seen[seen.length - 1] !== s.state) seen.push(s.state); });
    expect(j.state).toBe('idle');
    const started = j.start();
    expect(j.state).toBe('building');
    await started;
    expect(j.state).toBe('rendering');
    await run(j, 10);
    expect(j.state).toBe('done');
    expect(tr.samples).toBe(5); // no sample beyond the target
    expect(seen).toEqual(['building', 'rendering', 'done']);
    expect(j.snapshot().progress).toBe(1);
  });

  it('measures speed from rendering time and predicts the time left', async () => {
    const j = new PhotoJob(new FakeTracer(), 100);
    await j.start();
    await run(j, 11, 1000, 125); // 11 frames, 10 gaps of 125 ms = 1.25 s, 11 samples counted from the first tick
    const s = j.snapshot();
    expect(s.samples).toBe(11);
    expect(s.samplesPerSecond).toBeCloseTo(11 / 1.25, 6);
    expect(s.etaSeconds).toBeCloseTo((100 - 11) / (11 / 1.25), 6);
  });

  it('pause stops sampling and the paused time does not slow the measured speed; resume carries on', async () => {
    const tr = new FakeTracer();
    const j = new PhotoJob(tr, 100);
    await j.start();
    let t = await run(j, 5, 0, 100);
    const before = j.snapshot().samplesPerSecond;
    j.pause();
    expect(j.state).toBe('paused');
    const n = tr.steps;
    j.tick(t + 60_000);
    expect(tr.steps).toBe(n);
    j.resume();
    t = await run(j, 5, t + 120_000, 100);
    expect(j.state).toBe('rendering');
    expect(tr.steps).toBe(n + 5);
    expect(j.snapshot().samplesPerSecond).toBeGreaterThan(before * 0.8);
  });

  it('stop keeps the picture so far and ignores further frames; stopping twice or after done changes nothing', async () => {
    const tr = new FakeTracer();
    const j = new PhotoJob(tr, 100);
    await j.start();
    await run(j, 7);
    j.stop('Stopped');
    expect(j.state).toBe('stopped');
    expect(j.hasPicture).toBe(true);
    const steps = tr.steps;
    j.tick(10_000);
    expect(tr.steps).toBe(steps);
    j.stop('again');
    expect(j.snapshot().message).toBe('Stopped');
    const done = new PhotoJob(new FakeTracer(), 1);
    await done.start();
    done.tick(0);
    done.stop('late');
    expect(done.state).toBe('done');
  });

  it('stopping while the scene is still building ends the job and never starts rendering', async () => {
    const tr = new FakeTracer();
    let open!: () => void;
    tr.gate = new Promise<void>((r) => { open = r; });
    const j = new PhotoJob(tr, 10);
    const started = j.start();
    j.stop('Project changed');
    open();
    await started;
    expect(j.state).toBe('stopped');
    expect(j.hasPicture).toBe(false);
    j.tick(0);
    expect(tr.steps).toBe(0);
  });

  it('fails with the reason when building or sampling throws', async () => {
    const a = new FakeTracer();
    a.prepareError = new Error('no float textures');
    const ja = new PhotoJob(a, 10);
    await ja.start();
    expect(ja.state).toBe('failed');
    expect(ja.snapshot().message).toBe('no float textures');
    expect(ja.hasPicture).toBe(false);

    const b = new FakeTracer();
    const jb = new PhotoJob(b, 10);
    await jb.start();
    jb.tick(0);
    b.stepError = new Error('context lost');
    jb.tick(100);
    expect(jb.state).toBe('failed');
    expect(jb.snapshot().message).toBe('context lost');
  });

  it('start only works once, and dispose releases the tracer', async () => {
    const tr = new FakeTracer();
    const j = new PhotoJob(tr, 3);
    await j.start();
    await j.start();
    j.dispose();
    expect(tr.disposed).toBe(true);
  });

  it('refuses a target below one sample', () => { expect(() => new PhotoJob(new FakeTracer(), 0)).toThrow(); });

  it('snapshots report no time left when not rendering', async () => {
    const j = new PhotoJob(new FakeTracer(), 3);
    expect(j.snapshot().etaSeconds).toBeNull();
    await j.start();
    await run(j, 5);
    expect((j.snapshot() as JobSnapshot).etaSeconds).toBeNull(); // done
  });
});
