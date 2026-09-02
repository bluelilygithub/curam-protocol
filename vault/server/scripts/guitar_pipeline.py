#!/usr/bin/env python3
"""
Guitar Learning Agent — audio pipeline.
Called by Node.js: python3 guitar_pipeline.py <youtube_url> <output_dir> [song_id]

Outputs a JSON file at <output_dir>/result.json on success,
or <output_dir>/error.json on failure.

Pipeline:
  1. yt-dlp  → download audio (wav)
  2. librosa → beat tracking, BPM, chroma / key estimation
  3. autochord → chord recognition per frame
  4. Post-process → snap to beats, build chord events
  5. Suggest capo based on key

JSON output schema:
{
  "title": str,
  "artist": str,
  "duration": float,
  "bpm": int,
  "key_detected": str,        # e.g. "G major"
  "capo_suggested": int,      # fret number, 0 = no capo
  "chord_events": [
    { "timestamp_sec": float, "chord_root": str, "chord_quality": str,
      "confidence_score": float, "section_name": null }
  ]
}
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
    import autochord

    os.makedirs(output_dir, exist_ok=True)
    audio_path = os.path.join(output_dir, "audio.wav")

    # ── 1. Download audio via yt-dlp ─────────────────────────────────────────
    meta_path = os.path.join(output_dir, "meta.json")
    dl_result = subprocess.run(
        [
            "yt-dlp",
            "--no-playlist",
            "--extract-audio",
            "--audio-format", "wav",
            "--audio-quality", "0",
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
            raise ValueError("Age-restricted video — cannot process without authentication")
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

    # ── 4. Chord detection via autochord ─────────────────────────────────────
    print(f"[pipeline] Running chord detection (this may take a minute)…", flush=True)
    raw_chords = autochord.recognize(audio_path)
    # raw_chords: list of (start_sec, end_sec, chord_label)

    if not raw_chords:
        raise RuntimeError("autochord returned no chords — file may not contain guitar audio")

    # ── 5. Post-process: parse chord labels, snap to beats ────────────────────
    def parse_chord(label: str):
        """Return (root, quality) from autochord label like 'G:min', 'C:maj', 'N'."""
        if label in ("N", "X", "", None):
            return None, None
        label = label.strip()
        # Format: ROOT:QUALITY or just ROOT
        if ":" in label:
            parts = label.split(":", 1)
            root_raw, qual_raw = parts[0], parts[1]
        else:
            root_raw, qual_raw = label, "maj"

        # Normalise root: C# Db etc.
        root_map = {"Cb":"B","Db":"C#","Eb":"Eb","Fb":"E","Gb":"F#","Ab":"Ab","Bb":"Bb"}
        root = root_map.get(root_raw, root_raw)

        # Normalise quality
        qual_map = {
            "maj": "", "min": "m", "7": "7", "maj7": "maj7", "min7": "m7",
            "dim": "dim", "aug": "aug", "sus2": "sus2", "sus4": "sus4",
            "hdim7": "m7b5", "dim7": "dim7", "minmaj7": "mM7",
        }
        quality = qual_map.get(qual_raw.lower(), qual_raw)
        return root, quality

    def nearest_beat(ts, beat_times):
        """Snap a timestamp to the nearest beat."""
        if not beat_times:
            return ts
        bt = min(beat_times, key=lambda b: abs(b - ts))
        return bt if abs(bt - ts) < 0.5 else ts

    chord_events = []
    seen_ts = set()
    for (start_sec, end_sec, label) in raw_chords:
        root, quality = parse_chord(label)
        if root is None:
            continue
        # Confidence: autochord doesn't expose per-chord confidence;
        # use duration as a proxy (longer = more confident)
        chord_dur = float(end_sec) - float(start_sec)
        confidence = min(1.0, chord_dur / 2.0)

        snapped = round(nearest_beat(float(start_sec), beat_times), 3)
        if snapped in seen_ts:
            continue
        seen_ts.add(snapped)

        chord_events.append({
            "timestamp_sec":   snapped,
            "chord_root":      root,
            "chord_quality":   quality,
            "confidence_score": round(confidence, 3),
            "section_name":    None,
        })

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
