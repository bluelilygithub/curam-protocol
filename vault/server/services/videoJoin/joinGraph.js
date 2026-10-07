'use strict';

// Builds the ffmpeg filter_complex that joins already-prepared clips (same size, 30 fps, 48 kHz
// stereo — see joinClips.js). Pure: no ffmpeg, no files. One graph handles every join, so cuts,
// blends and dips can be mixed freely; the logic switches on a transition's `kind`, never on its
// name, so new transitions of an existing kind need no changes here.

const { TRANSITIONS, curveExpr, AUDIO_CURVES, dipColourHex } = require('./transitions');

const f3 = (n) => (Math.round(n * 1000) / 1000).toFixed(3);

/**
 * Clamp every join to what the neighbouring clips can actually afford. Each clip must keep at
 * least 10% of its length that is not part of a transition (a middle clip loses time at both
 * ends). Returns new join objects; the input is not mutated.
 */
function planTimings(durations, joins) {
  const n = durations.length;
  const js = joins.map((j) => ({ ...j }));

  js.forEach((j, i) => {
    const a = durations[i];
    const b = durations[i + 1];
    const kind = TRANSITIONS[j.type]?.kind;
    if (kind === 'overlap') j.duration = Math.min(j.duration, 0.45 * Math.min(a, b));
    if (kind === 'dip') {
      j.fadeOut = Math.min(j.fadeOut, 0.45 * a);
      j.fadeIn = Math.min(j.fadeIn, 0.45 * b);
    }
  });

  const tailOf = (j) => {
    const kind = j && TRANSITIONS[j.type]?.kind;
    return kind === 'overlap' ? j.duration : kind === 'dip' ? j.fadeOut : 0;
  };
  const headOf = (j) => {
    const kind = j && TRANSITIONS[j.type]?.kind;
    return kind === 'overlap' ? j.duration : kind === 'dip' ? j.fadeIn : 0;
  };
  const scaleTail = (j, k) => {
    const kind = TRANSITIONS[j.type]?.kind;
    if (kind === 'overlap') j.duration *= k;
    if (kind === 'dip') j.fadeOut *= k;
  };
  const scaleHead = (j, k) => {
    const kind = TRANSITIONS[j.type]?.kind;
    if (kind === 'overlap') j.duration *= k;
    if (kind === 'dip') j.fadeIn *= k;
  };

  for (let i = 0; i < n; i += 1) {
    const head = i > 0 ? headOf(js[i - 1]) : 0;
    const tail = i < n - 1 ? tailOf(js[i]) : 0;
    const budget = 0.9 * durations[i];
    if (head + tail > budget && head + tail > 0) {
      const k = budget / (head + tail);
      if (i > 0) scaleHead(js[i - 1], k);
      if (i < n - 1) scaleTail(js[i], k);
    }
  }
  return js;
}

/**
 * @param {{ durations: number[], joins: object[], width: number, height: number, fps?: number }} input
 *   joins[j] sits between clip j and clip j+1 and is a normalised join (see normalizeJoin).
 * @returns {{ filterComplex: string, mapV: string, mapA: string, totalDuration: number, joins: object[] }}
 */
function buildJoinGraph({ durations, joins, width, height, fps = 30 }) {
  const n = durations.length;
  if (n < 2) throw new Error('At least two clips are required to join');
  if (joins.length !== n - 1) throw new Error('Expected one join per gap between clips');

  const js = planTimings(durations, joins);
  const eps = 2 / fps; // last/first two frames sit fully on the dip colour, so the dark point is exact
  const chains = [];
  let uid = 0;

  const colourSource = (hex, extra = '') => {
    const label = `k${uid++}`;
    chains.push(`color=c=${hex}:s=${width}x${height}:r=${fps}${extra},format=yuv420p,setsar=1[${label}]`);
    return `[${label}]`;
  };

  // ---- per-clip streams, with the dip fade-in (head) / fade-out (tail) baked in ----
  const vLab = [];
  const aLab = [];
  for (let i = 0; i < n; i += 1) {
    const head = i > 0 && TRANSITIONS[js[i - 1].type].kind === 'dip' ? js[i - 1] : null;
    const tail = i < n - 1 && TRANSITIONS[js[i].type].kind === 'dip' ? js[i] : null;

    let v = `[${i}:v]`;
    // Common timebase so xfade/concat never see mismatched inputs.
    chains.push(`${v}settb=AVTB,setpts=PTS-STARTPTS[s${i}v]`);
    v = `[s${i}v]`;

    if (head) {
      const k = colourSource(dipColourHex(head.level));
      const den = Math.max(head.fadeIn - eps, 0.05);
      const u = `clip((T-${f3(eps)})/${f3(den)},0,1)`;
      const p = `1-${curveExpr(head.curve, u)}`;
      const out = `v${i}h`;
      chains.push(`${v}${k}blend=all_expr='A+(B-A)*(${p})':shortest=1[${out}]`);
      v = `[${out}]`;
    }
    if (tail) {
      const k = colourSource(dipColourHex(tail.level));
      const st = durations[i] - tail.fadeOut;
      const den = Math.max(tail.fadeOut - eps, 0.05);
      const u = `clip((T-${f3(st)})/${f3(den)},0,1)`;
      const p = curveExpr(tail.curve, u);
      const out = `v${i}t`;
      chains.push(`${v}${k}blend=all_expr='A+(B-A)*(${p})':shortest=1[${out}]`);
      v = `[${out}]`;
    }
    vLab.push(v);

    let a = `[${i}:a]`;
    chains.push(`${a}asetpts=PTS-STARTPTS[s${i}a]`);
    a = `[s${i}a]`;
    const afades = [];
    if (head) afades.push(`afade=t=in:st=0:d=${f3(head.fadeIn)}:curve=${AUDIO_CURVES.in[head.curve]}`);
    if (tail) afades.push(`afade=t=out:st=${f3(durations[i] - tail.fadeOut)}:d=${f3(tail.fadeOut)}:curve=${AUDIO_CURVES.out[tail.curve]}`);
    if (afades.length) {
      chains.push(`${a}${afades.join(',')}[a${i}f]`);
      a = `[a${i}f]`;
    }
    aLab.push(a);
  }

  // ---- chain the joins ----
  let V = vLab[0];
  let A = aLab[0];
  let length = durations[0];
  for (let j = 0; j < n - 1; j += 1) {
    const join = js[j];
    const def = TRANSITIONS[join.type];
    const last = j === n - 2;
    const outV = last ? 'outv' : `jv${j}`;
    const outA = last ? 'outa' : `ja${j}`;

    if (def.kind === 'overlap') {
      const t = join.duration;
      chains.push(`${V}${vLab[j + 1]}xfade=transition=${def.xfade}:duration=${f3(t)}:offset=${f3(length - t)}[${outV}]`);
      chains.push(`${A}${aLab[j + 1]}acrossfade=d=${f3(t)}[${outA}]`);
      length = length + durations[j + 1] - t;
    } else {
      // cut and dip are both "play one after the other"; a dip may add a solid-colour hold between.
      const segV = [V];
      const segA = [A];
      let count = 2;
      let hold = 0;
      if (def.kind === 'dip' && join.hold > 0) {
        hold = join.hold;
        const k = colourSource(dipColourHex(join.level), `:d=${f3(hold)}`);
        const hv = `hv${j}`;
        const ha = `ha${j}`;
        chains.push(`${k}settb=AVTB,setpts=PTS-STARTPTS[${hv}]`);
        chains.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f3(hold)},asetpts=PTS-STARTPTS[${ha}]`);
        segV.push(`[${hv}]`);
        segA.push(`[${ha}]`);
        count = 3;
      }
      segV.push(vLab[j + 1]);
      segA.push(aLab[j + 1]);
      const inputs = segV.map((v, idx) => `${v}${segA[idx]}`).join('');
      chains.push(`${inputs}concat=n=${count}:v=1:a=1[${outV}][${outA}]`);
      length = length + hold + durations[j + 1];
    }
    V = `[${outV}]`;
    A = `[${outA}]`;
  }

  return {
    filterComplex: chains.join(';'),
    mapV: '[outv]',
    mapA: '[outa]',
    totalDuration: length,
    joins: js,
  };
}

module.exports = { buildJoinGraph, planTimings };
