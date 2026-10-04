// Ambient sound (M4.10): deterministic noise, and the player against a fake Web Audio context (no sound is made in tests).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AMBIENT_OPTIONS, AmbientPlayer, FADE_SECONDS, isAmbientKind, type AmbientKind } from '../../src/audio/ambient';
import { brownNoise, loopable, pinkNoise, rng, whiteNoise } from '../../src/audio/noise';

// ------------------------------------------------------------------ a minimal fake AudioContext
class FakeParam { value = 0; setTargetAtTime = vi.fn(); setValueAtTime = vi.fn(); linearRampToValueAtTime = vi.fn(); exponentialRampToValueAtTime = vi.fn(); }
class FakeNode {
  connected: FakeNode[] = [];
  disconnected = false;
  connect(n: FakeNode) { this.connected.push(n); return n; }
  disconnect() { this.disconnected = true; }
}
class FakeSource extends FakeNode { loop = false; buffer: unknown = null; started = false; stopped = false; onended: (() => void) | null = null; start() { this.started = true; } stop() { this.stopped = true; } }
class FakeOsc extends FakeNode { type = 'sine'; frequency = new FakeParam(); detune = new FakeParam(); started = false; stopped = false; onended: (() => void) | null = null; start() { this.started = true; } stop() { this.stopped = true; } }
class FakeCtx {
  sampleRate = 8000;
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeNode();
  sources: FakeSource[] = [];
  oscillators: FakeOsc[] = [];
  gains: Array<FakeNode & { gain: FakeParam }> = [];
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createBuffer(_c: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() }); }
  createGain() { const g = Object.assign(new FakeNode(), { gain: new FakeParam() }); this.gains.push(g); return g; }
  createOscillator() { const o = new FakeOsc(); this.oscillators.push(o); return o; }
}
const make = () => { const ctx = new FakeCtx(); return { ctx, player: new AmbientPlayer(() => ctx as unknown as AudioContext) }; };

describe('noise', () => {
  it('is deterministic and different for another seed', () => {
    expect(Buffer.compare(Buffer.from(whiteNoise(512, 4).buffer), Buffer.from(whiteNoise(512, 4).buffer))).toBe(0);
    expect(Buffer.compare(Buffer.from(whiteNoise(512, 4).buffer), Buffer.from(whiteNoise(512, 5).buffer))).not.toBe(0);
    const r = rng(9); const a = [r(), r(), r()]; const r2 = rng(9);
    expect([r2(), r2(), r2()]).toEqual(a);
  });
  it('stays inside -1..1 and is not silent', () => {
    for (const make of [whiteNoise, pinkNoise, brownNoise]) {
      const d = make(20000, 2);
      const peak = Math.max(...Array.from(d, Math.abs));
      expect(peak).toBeLessThanOrEqual(1);
      expect(peak).toBeGreaterThan(0.05);
    }
  });
  it('pink and brown noise carry more of their energy in the low frequencies than white noise does', () => {
    // energy of the sample-to-sample difference (a crude high-pass) relative to total energy
    const hi = (d: Float32Array) => { let a = 0, b = 0; for (let i = 1; i < d.length; i++) { a += (d[i] - d[i - 1]) ** 2; b += d[i] ** 2; } return a / b; };
    const w = hi(whiteNoise(30000, 3)), p = hi(pinkNoise(30000, 3)), b = hi(brownNoise(30000, 3));
    expect(p).toBeLessThan(w);
    expect(b).toBeLessThan(p);
  });
  it('a loop is cross-faded so its ends meet without a jump', () => {
    const d = loopable(whiteNoise(10000, 1), 500);
    expect(d.length).toBe(9500);
    expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThan(2);
  });
});

describe('ambient options', () => {
  it('has Off and four sounds', () => {
    expect(AMBIENT_OPTIONS.map((o) => o.id)).toEqual(['off', 'rain', 'ocean', 'forest', 'calm']);
    expect(isAmbientKind('rain')).toBe(true);
    expect(isAmbientKind('disco')).toBe(false);
  });
});

describe('AmbientPlayer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(['rain', 'ocean', 'forest', 'calm'] as AmbientKind[])('%s starts sound-making nodes, connected to the output, and wakes a suspended context', (kind) => {
    const { ctx, player } = make();
    player.set(kind, 0.5);
    expect(player.current).toBe(kind);
    expect(ctx.sources.some((s) => s.started) || ctx.oscillators.some((o) => o.started)).toBe(true);
    expect(ctx.destination.connected).toEqual([]); // master connects TO destination, not the reverse
    expect(ctx.gains.some((g) => g.connected.includes(ctx.destination as unknown as FakeNode))).toBe(true);
    expect(ctx.resume).toHaveBeenCalled();
    player.dispose();
  });
  it('noise-based sounds loop', () => {
    const { ctx, player } = make();
    player.set('rain');
    expect(ctx.sources.length).toBeGreaterThan(0);
    expect(ctx.sources.every((s) => s.loop)).toBe(true);
    player.dispose();
  });
  it('Off fades out, then stops and releases everything', () => {
    const { ctx, player } = make();
    player.set('ocean');
    const started = ctx.sources.filter((s) => s.started);
    expect(started.length).toBeGreaterThan(0);
    player.set('off');
    expect(player.current).toBe('off');
    expect(started.every((s) => !s.stopped)).toBe(true); // still fading
    vi.advanceTimersByTime(FADE_SECONDS * 1000 + 500);
    expect(started.every((s) => s.stopped)).toBe(true);
    player.dispose();
  });
  it('switching sounds retires the old one after the fade and starts the new one at once', () => {
    const { ctx, player } = make();
    player.set('rain');
    const rainSources = [...ctx.sources];
    player.set('ocean');
    expect(ctx.sources.length).toBeGreaterThan(rainSources.length);
    vi.advanceTimersByTime(FADE_SECONDS * 1000 + 500);
    expect(rainSources.every((s) => s.stopped)).toBe(true);
    expect(ctx.sources.filter((s) => !rainSources.includes(s)).every((s) => !s.stopped)).toBe(true);
    player.dispose();
  });
  it('setting the same sound again does not start a second copy; changing the volume only changes the master gain', () => {
    const { ctx, player } = make();
    player.set('rain', 0.5);
    const n = ctx.sources.length;
    player.set('rain', 0.5);
    player.set('rain', 0.2);
    expect(ctx.sources.length).toBe(n);
    player.dispose();
  });
  it('does nothing and stays off where there is no audio', () => {
    const player = new AmbientPlayer(() => null);
    player.set('rain');
    expect(player.current).toBe('off');
    expect(() => { player.wake(); player.set('off'); player.dispose(); }).not.toThrow();
  });
  it('a context that cannot be made is handled', () => {
    const player = new AmbientPlayer(() => { throw new Error('blocked'); });
    expect(() => player.set('calm')).not.toThrow();
    expect(player.current).toBe('off');
  });
  it('dispose stops everything straight away and closes the context', () => {
    const { ctx, player } = make();
    player.set('forest');
    player.dispose();
    expect(ctx.close).toHaveBeenCalled();
    expect(ctx.sources.filter((s) => s.started).every((s) => s.stopped)).toBe(true);
    expect(player.current).toBe('off');
  });
  it('wake resumes a suspended context only when a sound is selected', () => {
    const { ctx, player } = make();
    player.wake();
    expect(ctx.resume).not.toHaveBeenCalled();
    player.set('rain');
    ctx.resume.mockClear();
    ctx.state = 'suspended';
    player.wake();
    expect(ctx.resume).toHaveBeenCalled();
    player.dispose();
  });
});
