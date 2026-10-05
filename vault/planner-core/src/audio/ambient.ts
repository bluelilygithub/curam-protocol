// Soothing ambient sound for the 3D view. Everything is synthesised with the Web Audio API (noise, filters, slow oscillators), so there
// are no audio files and no licences. One sound plays at a time with a short fade between; the player does nothing where there is no audio.
import { brownNoise, loopable, pinkNoise, rng, whiteNoise } from './noise';

export type AmbientKind = 'off' | 'rain' | 'ocean' | 'forest' | 'calm';

export const AMBIENT_OPTIONS: Array<{ id: AmbientKind; label: string; note: string }> = [
  { id: 'off', label: 'Off', note: 'No sound' },
  { id: 'rain', label: 'Gentle rain', note: 'Soft steady rainfall' },
  { id: 'ocean', label: 'Ocean waves', note: 'Slow waves rolling in and out' },
  { id: 'forest', label: 'Forest breeze', note: 'Wind in the trees with distant birds' },
  { id: 'calm', label: 'Calm music', note: 'A slow, warm, drifting pad' },
];
export const isAmbientKind = (v: unknown): v is AmbientKind => AMBIENT_OPTIONS.some((o) => o.id === v);

export const DEFAULT_VOLUME = 0.5;
export const FADE_SECONDS = 1.5;
/** The loudest the master gain goes at volume 1: ambient sound should sit under everything else. */
const MASTER_MAX = 0.6;

type Stop = () => void;

function noiseSource(ctx: AudioContext, kind: 'white' | 'pink' | 'brown', seed: number): AudioBufferSourceNode {
  const seconds = 6;
  const length = Math.floor(ctx.sampleRate * seconds);
  const raw = kind === 'white' ? whiteNoise(length, seed) : kind === 'pink' ? pinkNoise(length, seed) : brownNoise(length, seed);
  const data = loopable(raw, Math.floor(ctx.sampleRate * 0.1));
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.getChannelData(0).set(data);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

function filter(ctx: AudioContext, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

function gain(ctx: AudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A slow sine that moves `target` around its current value by ±depth. */
function lfo(ctx: AudioContext, target: AudioParam, hz: number, depth: number, stopFns: Stop[]): void {
  const o = ctx.createOscillator();
  o.frequency.value = hz;
  const d = gain(ctx, depth);
  o.connect(d);
  d.connect(target);
  o.start();
  stopFns.push(() => { try { o.stop(); } catch { /* already stopped */ } o.disconnect(); d.disconnect(); });
}

function rain(ctx: AudioContext, out: AudioNode): Stop {
  const stops: Stop[] = [];
  const hiss = noiseSource(ctx, 'white', 3);
  const hp = filter(ctx, 'highpass', 1400);
  const lp = filter(ctx, 'lowpass', 7500);
  const gHiss = gain(ctx, 0.32);
  hiss.connect(hp); hp.connect(lp); lp.connect(gHiss); gHiss.connect(out);
  lfo(ctx, gHiss.gain, 0.07, 0.04, stops);
  const body = noiseSource(ctx, 'pink', 5);
  const bp = filter(ctx, 'bandpass', 500, 0.5);
  const gBody = gain(ctx, 0.3);
  body.connect(bp); bp.connect(gBody); gBody.connect(out);
  hiss.start(); body.start();
  stops.push(() => { for (const n of [hiss, body]) { try { n.stop(); } catch { /* */ } n.disconnect(); } for (const n of [hp, lp, bp, gHiss, gBody]) n.disconnect(); });
  return () => stops.forEach((s) => s());
}

function ocean(ctx: AudioContext, out: AudioNode): Stop {
  const stops: Stop[] = [];
  const surf = noiseSource(ctx, 'brown', 7);
  const lp = filter(ctx, 'lowpass', 600, 0.5);
  const g = gain(ctx, 0.55);
  surf.connect(lp); lp.connect(g); g.connect(out);
  lfo(ctx, lp.frequency, 0.09, 380, stops); // the wave opens up and closes down
  lfo(ctx, g.gain, 0.09, 0.3, stops);
  const foam = noiseSource(ctx, 'pink', 9);
  const hp = filter(ctx, 'highpass', 2200);
  const gf = gain(ctx, 0.05);
  foam.connect(hp); hp.connect(gf); gf.connect(out);
  lfo(ctx, gf.gain, 0.09, 0.045, stops);
  surf.start(); foam.start();
  stops.push(() => { for (const n of [surf, foam]) { try { n.stop(); } catch { /* */ } n.disconnect(); } for (const n of [lp, g, hp, gf]) n.disconnect(); });
  return () => stops.forEach((s) => s());
}

function forest(ctx: AudioContext, out: AudioNode): Stop {
  const stops: Stop[] = [];
  const wind = noiseSource(ctx, 'pink', 11);
  const bp = filter(ctx, 'bandpass', 650, 0.4);
  const g = gain(ctx, 0.5);
  wind.connect(bp); bp.connect(g); g.connect(out);
  lfo(ctx, bp.frequency, 0.05, 220, stops);
  lfo(ctx, g.gain, 0.11, 0.12, stops);
  wind.start();
  stops.push(() => { try { wind.stop(); } catch { /* */ } wind.disconnect(); bp.disconnect(); g.disconnect(); });
  // distant birds: a few short rising chirps at unhurried, random intervals
  const r = rng(21);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const chirp = (): void => {
    const t = ctx.currentTime;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const e = gain(ctx, 0);
      o.type = 'sine';
      const f0 = 2100 + r() * 900;
      const at = t + i * 0.16;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.45, at + 0.1);
      e.gain.setValueAtTime(0, at);
      e.gain.linearRampToValueAtTime(0.035, at + 0.02);
      e.gain.linearRampToValueAtTime(0, at + 0.12);
      o.connect(e); e.connect(out);
      o.start(at); o.stop(at + 0.14);
      o.onended = () => { o.disconnect(); e.disconnect(); };
    }
    timer = setTimeout(chirp, 2500 + r() * 5500);
  };
  timer = setTimeout(chirp, 1500);
  stops.push(() => { if (timer) clearTimeout(timer); });
  return () => stops.forEach((s) => s());
}

function calm(ctx: AudioContext, out: AudioNode): Stop {
  const stops: Stop[] = [];
  const lp = filter(ctx, 'lowpass', 1100, 0.4);
  const master = gain(ctx, 0.5);
  lp.connect(master); master.connect(out);
  lfo(ctx, master.gain, 0.12, 0.12, stops); // slow swell
  // two gentle chords the voices glide between every so often
  const chords = [[130.81, 196.0, 246.94, 329.63, 392.0], [110.0, 164.81, 196.0, 261.63, 329.63]];
  const voices = chords[0].map((f, i) => {
    const o = ctx.createOscillator();
    o.type = i % 2 ? 'sine' : 'triangle';
    o.frequency.value = f;
    o.detune.value = (i - 2) * 3;
    const vg = gain(ctx, 0.11);
    o.connect(vg); vg.connect(lp);
    o.start();
    return { o, vg };
  });
  let step = 0;
  const timer = setInterval(() => {
    step = (step + 1) % chords.length;
    voices.forEach((v, i) => v.o.frequency.setTargetAtTime(chords[step][i], ctx.currentTime, 2.5));
  }, 14000);
  stops.push(() => { clearInterval(timer); for (const v of voices) { try { v.o.stop(); } catch { /* */ } v.o.disconnect(); v.vg.disconnect(); } lp.disconnect(); master.disconnect(); });
  return () => stops.forEach((s) => s());
}

const BUILDERS: Record<Exclude<AmbientKind, 'off'>, (ctx: AudioContext, out: AudioNode) => Stop> = { rain, ocean, forest, calm };

interface Playing { kind: AmbientKind; gain: GainNode; stop: Stop }

/** Plays one ambient sound at a time. `make` returns an AudioContext, or null where there is no audio (tests, old browsers). */
export class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private playing: Playing | null = null;
  private master: GainNode | null = null;
  private volume = DEFAULT_VOLUME;
  private kind: AmbientKind = 'off';
  private readonly retiring = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly make: () => AudioContext | null) {}

  get current(): AmbientKind { return this.kind; }

  /** Play `kind` at `volume` (0–1). 'off' fades out. Safe to call as often as you like. */
  set(kind: AmbientKind, volume = this.volume): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (kind !== 'off' && !this.ctx) {
      try { this.ctx = this.make(); } catch { this.ctx = null; }
      if (!this.ctx) { this.kind = 'off'; return; }
    }
    const ctx = this.ctx;
    if (!ctx) { this.kind = 'off'; return; }
    if (this.master) this.master.gain.setTargetAtTime(this.volume * MASTER_MAX, ctx.currentTime, 0.1);
    if (kind === this.kind && (kind === 'off' || this.playing)) return;
    this.kind = kind;
    this.fadeOutCurrent();
    if (kind === 'off') return;
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = this.volume * MASTER_MAX;
      this.master.connect(ctx.destination);
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    const stop = BUILDERS[kind](ctx, g);
    g.gain.setTargetAtTime(1, ctx.currentTime, FADE_SECONDS / 3);
    this.playing = { kind, gain: g, stop };
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  /** Browsers only start audio after a click or key press: call this from one (the planner does, once) to wake a waiting sound. */
  wake(): void {
    if (this.ctx?.state === 'suspended' && this.kind !== 'off') void this.ctx.resume().catch(() => undefined);
  }

  private fadeOutCurrent(): void {
    const p = this.playing;
    if (!p || !this.ctx) return;
    this.playing = null;
    p.gain.gain.setTargetAtTime(0, this.ctx.currentTime, FADE_SECONDS / 3);
    const t = setTimeout(() => { this.retiring.delete(t); p.stop(); p.gain.disconnect(); }, FADE_SECONDS * 1000 + 200);
    this.retiring.add(t);
  }

  dispose(): void {
    for (const t of this.retiring) clearTimeout(t);
    this.retiring.clear();
    if (this.playing) { this.playing.stop(); this.playing.gain.disconnect(); this.playing = null; }
    this.master?.disconnect();
    this.master = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.kind = 'off';
  }
}

/** The real thing in a browser; null elsewhere. */
export function browserAudioContext(): AudioContext | null {
  const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  return Ctor ? new Ctor() : null;
}
