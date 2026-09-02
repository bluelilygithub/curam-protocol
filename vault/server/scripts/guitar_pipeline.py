#!/usr/bin/env python3
"""
Guitar Learning Agent — audio pipeline.
Called by Node.js: python3 guitar_pipeline.py <youtube_url> <output_dir>

Outputs a JSON file at <output_dir>/result.json on success,
or <output_dir>/error.json on failure.

Pipeline:
  1. yt-dlp  → download audio (wav)
  2. librosa → beat tracking, BPM, key estimation via Krumhansl-Schmuckler
  3. Chroma template matching → chord per beat (major / minor templates)
  4. Capo suggestion based on detected key

Detection approach: best-effort first draft — the UI supports fast manual
correction of any chord event.
"""

import sys
import os
import json
import subprocess
import tempfile
import traceback
import re


def run_pipeline(youtube_url: str, output_dir: str) -> dict:
    import librosa
    import numpy as np

    os.makedirs(output_dir, exist_ok=True)
    audio_path = os.path.join(output_dir, "audio.wav")

    # ── 1. Download audio via yt-dlp ─────────────────────────────────────────
    meta_path = os.path.join(output_dir, "meta.json")

    # tv_embedded player client bypasses YouTube's age gate on most videos
    # without requiring login cookies.
    extractor_args = "youtube:player_client=tv_embedded,web"
    yt_api_key = os.environ.get("YOUTUBE_API_KEY", "")
    if yt_api_key:
        extractor_args += f";youtube:api_key={yt_api_key}"

    dl_result = subprocess.run(
        [
            "yt-dlp",
            "--no-playlist",
            "--extract-audio",
            "--audio-format", "wav",
            "--audio-quality", "0",
            "--extractor-args", extractor_args,
            "--write-info-json",
            "--no-post-overwrites",
            "-o", os.path.join(output_dir, "audio.%(ext)s"),
            "--print-to-file", "after_move:filepath", os.path.join(output_dir, "filepath.txt"),
            youtube_url,
        ],
        capture_output=True, text=True, timeout=300
    )
    if dl_result.returncode != 0:
        stderr = dl_result.stderr or ""
        if "age" in stderr.lower() or "sign in" in stderr.lower():
            raise ValueError("Age-restricted video — cannot be processed even with tv_embedded client")
        if "private" in stderr.lower() or "unavailable" in stderr.lower():
            raise ValueError("Video is private or unavailable")
        if "live" in stderr.lower():
            raise ValueError("Live streams cannot be processed — submit a recorded video")
        raise RuntimeError(f"yt-dlp failed: {stderr[:300]}")

    # Find the actual output wav file
    if not os.path.exists(audio_path):
        for f in os.listdir(output_dir):
            if f.endswith(".wav"):
                audio_path = os.path.join(output_dir, f)
                break
    if not os.path.exists(audio_path):
        raise RuntimeError("yt-dlp did not produce a wav file")

    # Parse metadata
    title, artist, duration_meta = "Unknown Title", "Unknown Artist", None
    for f in os.listdir(output_dir):
        if f.endswith(".info.json"):
            with open(os.path.join(output_dir, f)) as fh:
                meta = json.load(fh)
            title    = meta.get("title", title)
            artist   = meta.get("uploader") or meta.get("channel") or artist
            duration_meta = meta.get("duration")
            break

    # ── 2. Load audio + beat tracking ────────────────────────────────────────
    print(f"[pipeline] Loading audio: {audio_path}", flush=True)
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = float(len(y) / sr)

    # Beat tracking
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    bpm = int(round(float(tempo)))

    # ── 3. Key estimation via chroma ─────────────────────────────────────────
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)

    # Krumhansl–Schmuckler key profiles
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    roots = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']

    best_score, best_key = -999, "C major"
    for i, root in enumerate(roots):
        rotated = np.roll(chroma_mean, -i)
        for mode, profile in [("major", major_profile), ("minor", minor_profile)]:
            score = float(np.corrcoef(rotated, profile)[0, 1])
            if score > best_score:
                best_score = score
                best_key = f"{root} {mode}"

    # ── 3. Chord detection via chroma template matching ───────────────────────
    print(f"[pipeline] Detecting chords via chroma template matching…", flush=True)

    ROOTS = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']
    # Major [root, M3, P5], minor [root, m3, P5]
    MAJ_TEMPLATE = np.array([1,0,0,0,1,0,0,1,0,0,0,0], dtype=float)
    MIN_TEMPLATE = np.array([1,0,0,1,0,0,0,1,0,0,0,0], dtype=float)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    frame_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=512)

    # Build per-beat chroma (average frames within each beat window)
    chord_events = []
    prev_label = None

    for i, beat_time in enumerate(beat_times):
        next_beat = beat_times[i + 1] if i + 1 < len(beat_times) else beat_time + 0.5
        mask = (frame_times >= beat_time) & (frame_times < next_beat)
        if not mask.any():
            continue
        beat_chroma = chroma[:, mask].mean(axis=1)
        norm = beat_chroma.max() + 1e-8
        beat_chroma = beat_chroma / norm

        best_score, best_root, best_quality = -1.0, 'C', ''
        for semitone, root in enumerate(ROOTS):
            for quality, template in [('', MAJ_TEMPLATE), ('m', MIN_TEMPLATE)]:
                rotated = np.roll(template, semitone)
                score = float(np.dot(beat_chroma, rotated) / (np.linalg.norm(rotated) + 1e-8))
                if score > best_score:
                    best_score, best_root, best_quality = score, root, quality

        label = best_root + best_quality
        if label == prev_label:
            continue  # skip consecutive duplicates
        prev_label = label

        chord_events.append({
            "timestamp_sec":    round(float(beat_time), 3),
            "chord_root":       best_root,
            "chord_quality":    best_quality,
            "confidence_score": round(best_score, 3),
            "section_name":     None,
        })

    if not chord_events:
        raise RuntimeError("No chords detected — check that the audio contains pitched content")

    chord_events.sort(key=lambda e: e["timestamp_sec"])

    # ── 6. Capo suggestion ─────────────────────────────────────────────────────
    # Suggest capo to bring the key closer to open-chord-friendly keys (G, A, C, D, E)
    friendly = {"G", "A", "C", "D", "E"}
    key_root = best_key.split()[0].replace("b", "♭").replace("#", "♯")
    root_semitones = {"C":0,"C#":1,"Db":1,"D":2,"Eb":3,"E":4,"F":5,
                      "F#":6,"Gb":6,"G":7,"Ab":8,"A":9,"Bb":10,"B":11}
    key_semi = root_semitones.get(best_key.split()[0], 0)
    capo_suggested = 0
    for capo in range(1, 8):
        transposed_root = roots[(key_semi - capo) % 12]
        if transposed_root in friendly:
            capo_suggested = capo
            break

    return {
        "title":          title,
        "artist":         artist,
        "duration":       round(duration_meta or duration, 2),
        "bpm":            bpm,
        "key_detected":   best_key,
        "capo_suggested": capo_suggested,
        "chord_events":   chord_events,
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: guitar_pipeline.py <youtube_url> <output_dir>"}))
        sys.exit(1)

    youtube_url = sys.argv[1]
    output_dir  = sys.argv[2]

    try:
        result = run_pipeline(youtube_url, output_dir)
        out_path = os.path.join(output_dir, "result.json")
        with open(out_path, "w") as fh:
            json.dump(result, fh)
        print(f"[pipeline] Done → {out_path}", flush=True)
        sys.exit(0)
    except Exception as e:
        err_path = os.path.join(output_dir, "error.json")
        with open(err_path, "w") as fh:
            json.dump({"error": str(e), "trace": traceback.format_exc()}, fh)
        print(f"[pipeline] Error: {e}", file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
