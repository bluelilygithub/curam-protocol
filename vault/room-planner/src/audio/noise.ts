// Deterministic noise for the ambient sounds. Pure: the same seed always gives the same samples, so it can be tested without audio.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** White noise in [-1, 1]. */
export function whiteNoise(length: number, seed = 1): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Pink noise (about -3 dB per octave), Paul Kellet's filter, scaled to stay inside [-1, 1]. */
export function pinkNoise(length: number, seed = 1): Float32Array {
  const w = whiteNoise(length, seed);
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const x = w[i];
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
  }
  return out;
}

/** Brown noise (about -6 dB per octave): a leaky running sum of white noise, scaled to stay inside [-1, 1]. */
export function brownNoise(length: number, seed = 1): Float32Array {
  const w = whiteNoise(length, seed);
  const out = new Float32Array(length);
  let last = 0;
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * w[i]) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/** Make a noise loop seamless: cross-fade the last `fade` samples into the first so the join does not click. */
export function loopable(data: Float32Array, fade = 2048): Float32Array {
  const n = Math.min(fade, Math.floor(data.length / 4));
  const out = data.slice(0, data.length - n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = out[i] * t + data[data.length - n + i] * (1 - t);
  }
  return out;
}
