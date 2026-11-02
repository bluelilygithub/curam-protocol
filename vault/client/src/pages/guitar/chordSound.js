// A chord played with the browser's own synth (Web Audio): a soft strum of triangle waves over two octaves. Shared by the chord chart
// (click a chord to hear it) and ear training.

const NOTE_SEMI = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, 'D#': 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, 'G#': 8, A: 9, Bb: 10, 'A#': 10, B: 11 };
const INTERVALS = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7],
  dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10],
};

/** Make (or reuse) the AudioContext in `ref.current` and wake it if the browser has suspended it. */
export function audioContextFrom(ref) {
  if (!ref.current || ref.current.state === 'closed') ref.current = new (window.AudioContext || window.webkitAudioContext)();
  if (ref.current.state === 'suspended') ref.current.resume();
  return ref.current;
}

/** Play a chord now, or `delaySec` from now. Returns how many seconds it rings for. */
export function playChordSound(ctx, root, quality = '', delaySec = 0) {
  const rootSemi = NOTE_SEMI[root] ?? 0;
  const intervals = INTERVALS[quality] ?? [0, 4, 7];
  const baseFreq = 82.41 * Math.pow(2, rootSemi / 12); // the low E string is 82.41 Hz
  const now = ctx.currentTime + delaySec;
  intervals.forEach((iv, i) => {
    [0, 1].forEach((oct) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = baseFreq * Math.pow(2, (iv + oct * 12) / 12);
      const t0 = now + i * 0.03;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.06, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 2);
    });
  });
  return 1.8;
}

/** Just the root note of a chord, one octave, for the "hear the bass note" hint in ear training. Returns how many seconds it rings for. */
export function playRootNote(ctx, root, delaySec = 0) {
  const baseFreq = 82.41 * Math.pow(2, (NOTE_SEMI[root] ?? 0) / 12);
  const t0 = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = baseFreq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 1.6);
  return 1.5;
}

/** One note by MIDI number (60 = middle C), for hearing the notes of a singing range. Returns how many seconds it rings for. */
export function playToneMidi(ctx, midi, delaySec = 0) {
  const t0 = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
  gain.gain.setValueAtTime(0.2, t0 + 1.0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 1.8);
  return 1.7;
}

/** One plucked string at an exact time on the audio clock (`when` is in the context's seconds), for the fingerpicking ladder. */
export function playPluck(ctx, midi, when, gain = 0.2) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 1);
}
