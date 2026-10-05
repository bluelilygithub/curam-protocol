// Render photo (Spec Addition A2, M4.7): the pure half. Presets, estimates, caption layout, file name, and the job state machine, all
// driven through an injected `Tracer` so it is tested without WebGL. The three.js / path-tracer half is `photoTracer.ts`.

export type PhotoQuality = 'draft' | 'good' | 'best';
export type PhotoLighting = 'daylight' | 'overcast' | 'evening';

export interface SizePreset { id: string; label: string; width: number; height: number }

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'sm', label: '640 × 360 (quick look)', width: 640, height: 360 },
  { id: 'hd', label: '1280 × 720', width: 1280, height: 720 },
  { id: 'fhd', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'uhd', label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
];
export const DEFAULT_SIZE_ID = 'hd';

/** Samples per pixel to reach. More samples = less noise, longer wait. */
export const QUALITY_SAMPLES: Record<PhotoQuality, number> = { draft: 64, good: 256, best: 1024 };
export const QUALITY_LABELS: Record<PhotoQuality, string> = { draft: 'Draft', good: 'Good', best: 'Best' };

export interface LightingPreset {
  id: PhotoLighting;
  label: string;
  /** Sun colour and strength (physical units as the live view uses them), sun height as an angle above the horizon in degrees. */
  sunColour: string;
  sun: number;
  sunElevationDeg: number;
  /** Sky gradient: colour at the zenith and at the horizon, and how much light the sky gives the room. */
  skyTop: string;
  skyHorizon: string;
  skyLight: number;
}

export const LIGHTING: Record<PhotoLighting, LightingPreset> = {
  daylight: { id: 'daylight', label: 'Daylight', sunColour: '#fff1d6', sun: 5, sunElevationDeg: 48, skyTop: '#6f9fd8', skyHorizon: '#dbe8f5', skyLight: 1.4 },
  overcast: { id: 'overcast', label: 'Overcast', sunColour: '#e8edf2', sun: 0.8, sunElevationDeg: 60, skyTop: '#aeb7c0', skyHorizon: '#d6dbe0', skyLight: 1.5 },
  evening: { id: 'evening', label: 'Evening', sunColour: '#ffb26b', sun: 4, sunElevationDeg: 12, skyTop: '#46506f', skyHorizon: '#f2a46b', skyLight: 0.55 },
};

export const sizeById = (id: string): SizePreset => SIZE_PRESETS.find((s) => s.id === id) ?? SIZE_PRESETS.find((s) => s.id === DEFAULT_SIZE_ID)!;

// ------------------------------------------------------------------ estimates

/** Seconds left at the measured speed; null until there is a speed to go on. */
export function etaSeconds(samples: number, target: number, samplesPerSecond: number): number | null {
  if (!(samplesPerSecond > 0)) return null;
  return Math.max(0, (target - samples) / samplesPerSecond);
}

/** "about 2 min 10 s", "35 s", "under 5 s". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'working it out…';
  const s = Math.round(seconds);
  if (s < 5) return 'under 5 s';
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r === 0 ? `${m} min` : `${m} min ${r} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** A render this slow is worth a warning before it starts (seconds). */
export const SLOW_WARNING_SECONDS = 180;

// ------------------------------------------------------------------ file name and caption

const pad = (n: number): string => String(n).padStart(2, '0');
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const slug = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** `<project>-<room>-<yyyy-mm-dd>.png`; the room is left out when it repeats the project name or is blank. */
export function photoFileName(project: string, room: string, date: Date): string {
  const p = slug(project) || 'room';
  const r = slug(room);
  return `${[p, r && r !== p ? r : ''].filter(Boolean).join('-')}-${isoDate(date)}.png`;
}

export interface CaptionLayout {
  /** Extra height added under the image for the strip. */
  stripHeight: number;
  fontPx: number;
  padding: number;
  /** Text baseline from the top of the strip. */
  baseline: number;
  left: string;
  right: string;
}

/** A thin strip under the picture: "Project · Room" at the left and the date at the right. Scales with the image width. */
export function captionLayout(width: number, project: string, room: string, date: Date): CaptionLayout {
  const fontPx = Math.max(14, Math.round(width / 70));
  const padding = Math.round(fontPx * 0.9);
  const stripHeight = Math.round(fontPx + padding * 2);
  const same = !room.trim() || room.trim() === project.trim();
  return { stripHeight, fontPx, padding, baseline: Math.round(padding + fontPx * 0.8), left: same ? project.trim() : `${project.trim()} · ${room.trim()}`, right: isoDate(date) };
}

// ------------------------------------------------------------------ support check

export interface GlLike {
  getExtension(name: string): unknown;
  getParameter(p: number): unknown;
  readonly MAX_TEXTURE_SIZE: number;
}

/** Why this device cannot render photos, or null when it can. `gl` is a WebGL2 context, or null when there is none. */
export function photoUnsupportedReason(gl: GlLike | null, width = 1280, height = 720): string | null {
  const msg = "This device can't render photos. The Realistic 3D view still works.";
  if (!gl) return msg;
  if (!gl.getExtension('EXT_color_buffer_float')) return msg;
  const max = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  if (!(max >= Math.max(width, height))) return `This device cannot make a picture this large (its limit is ${max} pixels). Choose a smaller size.`;
  return null;
}

// ------------------------------------------------------------------ job

export type PhotoState = 'idle' | 'building' | 'rendering' | 'paused' | 'done' | 'stopped' | 'failed';

/** What the job needs from the renderer. `step` adds one sample and returns the total so far. */
export interface Tracer {
  /** What it is doing right now, in plain words (shown while there is no picture to look at yet). */
  readonly phase?: string;
  prepare(): Promise<void>;
  step(): number;
  dispose(): void;
}

export interface JobSnapshot {
  state: PhotoState;
  samples: number;
  target: number;
  /** 0–1. */
  progress: number;
  samplesPerSecond: number;
  etaSeconds: number | null;
  message: string;
  /** The tracer's own account of the current step ("Building the room…"). */
  phase: string;
}

const TERMINAL: PhotoState[] = ['done', 'stopped', 'failed'];

/**
 * idle → building → rendering ⇄ paused → done | stopped | failed. The host calls `tick(nowMs)` once per animation frame while
 * rendering. Speed is measured over the rendering time only (paused time is not counted).
 */
export class PhotoJob {
  private st: PhotoState = 'idle';
  private n = 0;
  private note = '';
  private activeMs = 0;
  private last: number | null = null;
  private stepsAtStart = 0;
  private listeners = new Set<(s: JobSnapshot) => void>();

  constructor(private readonly tracer: Tracer, readonly target: number) {
    if (!(target >= 1)) throw new Error('target must be at least one sample');
  }

  get state(): PhotoState { return this.st; }
  get finished(): boolean { return TERMINAL.includes(this.st); }

  snapshot(): JobSnapshot {
    const sps = this.activeMs > 0 ? (this.n - this.stepsAtStart) / (this.activeMs / 1000) : 0;
    return {
      state: this.st, samples: this.n, target: this.target, progress: Math.min(1, this.n / this.target),
      samplesPerSecond: sps, etaSeconds: this.st === 'rendering' || this.st === 'paused' ? etaSeconds(this.n, this.target, sps) : null, message: this.note, phase: this.tracer.phase ?? '',
    };
  }

  subscribe(fn: (s: JobSnapshot) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(): void { const s = this.snapshot(); for (const l of [...this.listeners]) l(s); }

  /** Build the scene, then start rendering. Resolves when building has finished (or failed). */
  async start(): Promise<void> {
    if (this.st !== 'idle') return;
    this.st = 'building';
    this.emit();
    try {
      await this.tracer.prepare();
    } catch (e) {
      if (this.finished) return; // stopped while building
      this.fail(e);
      return;
    }
    if (this.finished) return; // stopped while building
    this.st = 'rendering';
    this.last = null;
    this.emit();
  }

  /** One animation frame. Does nothing unless rendering. */
  tick(nowMs: number): void {
    if (this.st !== 'rendering') return;
    if (this.last !== null) this.activeMs += Math.max(0, nowMs - this.last);
    this.last = nowMs;
    try {
      this.n = this.tracer.step();
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.n >= this.target) { this.st = 'done'; this.note = 'Done'; }
    this.emit();
  }

  pause(): void { if (this.st === 'rendering') { this.st = 'paused'; this.last = null; this.emit(); } }
  resume(): void { if (this.st === 'paused') { this.st = 'rendering'; this.last = null; this.emit(); } }

  /** Stop for good, keeping the picture so far (a stopped render can still be downloaded). */
  stop(reason = 'Stopped'): void {
    if (this.finished) return;
    this.st = 'stopped';
    this.note = reason;
    this.emit();
  }

  /** Whether there is a picture worth downloading. */
  get hasPicture(): boolean { return this.n > 0 && this.st !== 'failed' && this.st !== 'idle' && this.st !== 'building'; }

  dispose(): void { this.tracer.dispose(); this.listeners.clear(); }

  private fail(e: unknown): void {
    this.st = 'failed';
    this.note = e instanceof Error ? e.message : String(e);
    this.emit();
  }
}

/** What to expect, shown under the panel title. Honest about what the picture is and how long it takes. */
export const PHOTO_EXPECTATIONS =
  'A computer-generated picture of your design with realistic light and shadow. Most furniture is built from simple shapes (only pieces marked 3D model are real models), so it is a clear visualisation, not a studio photograph. ' +
  'It starts grainy and sharpens; Draft is quick, Good takes several minutes and Best much longer, and larger sizes take longer still. The first few seconds are spent preparing, so it may look still at first.';

/** Short tips for a better picture. */
export const PHOTO_TIPS = [
  'Choose “Inside the room” in View for an eye-level picture.',
  'Use Good for a client; Draft is for checking the view.',
  'Pick a colour palette first: it changes the walls, floor and furniture together.',
];

/** The view choices that stand inside the room at eye level, wider than the 3D view's camera. */
export const INSIDE_FOV = 72;
export const ORBIT_FOV = 50;
