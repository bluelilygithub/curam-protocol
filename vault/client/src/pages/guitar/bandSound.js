// The backing band's sounds, made with the browser's Web Audio (no recordings, nothing to download): a kick, a snare and a hi-hat from
// sine waves and noise, and a bass from a filtered saw wave. Each takes `when` (audio clock seconds) and `vol` (0 to 1).

const noiseBuffers = new WeakMap();

function noise(ctx) {
  if (!noiseBuffers.has(ctx)) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return noiseBuffers.get(ctx);
}

function burst(ctx, when, { type, freq, q = 1, gain, len }) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + len);
  src.connect(filter); filter.connect(g); g.connect(ctx.destination);
  src.start(when); src.stop(when + len + 0.02);
}

/** A thump: a sine that drops fast in pitch. */
export function playKick(ctx, when, vol = 1) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(130, when);
  osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
  g.gain.setValueAtTime(0.9 * vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(when); osc.stop(when + 0.25);
}

/** A crack: a burst of filtered noise over a short tone. */
export function playSnare(ctx, when, vol = 1) {
  burst(ctx, when, { type: 'highpass', freq: 1800, gain: 0.55 * vol, len: 0.14 });
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 190;
  g.gain.setValueAtTime(0.35 * vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(when); osc.stop(when + 0.12);
}

/** A tick: short, bright noise. */
export function playHat(ctx, when, vol = 1) {
  burst(ctx, when, { type: 'highpass', freq: 7500, gain: 0.22 * vol, len: 0.045 });
}

/** A round low note: a saw wave through a low-pass filter that closes as the note dies away. */
export function playBass(ctx, when, freq, seconds, vol = 1) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(700, when);
  filter.frequency.exponentialRampToValueAtTime(180, when + Math.max(0.1, seconds));
  const g = ctx.createGain();
  const len = Math.max(0.12, seconds);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.5 * vol, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + len);
  osc.connect(filter); filter.connect(g); g.connect(ctx.destination);
  osc.start(when); osc.stop(when + len + 0.05);
}
