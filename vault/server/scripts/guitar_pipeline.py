#!/usr/bin/env python3
"""
Guitar Learning Agent — audio pipeline.
Called by Node.js:
  python3 guitar_pipeline.py <youtube_url_or_-> <output_dir> [audio_file]

If audio_file is provided (3rd arg), skip YouTube download and analyse that file.
If youtube_url is "-" / empty and no audio_file, fail.

Outputs <output_dir>/result.json on success, or <output_dir>/error.json on failure.
"""

import sys
import os
import base64
import json
import subprocess
import tempfile
import traceback


def suggest_capo(key_root: str, roots: list) -> int:
    """Suggest capo only when the open key is awkward; 0 if already friendly."""
    friendly = {"G", "A", "C", "D", "E", "Em", "Am", "Dm"}
    # Capo suggestion is about major open shapes; use root only
    if key_root in {"G", "A", "C", "D", "E"}:
        return 0
    root_semitones = {
        "C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5,
        "F#": 6, "Gb": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11,
    }
    key_semi = root_semitones.get(key_root, 0)
    for capo in range(1, 8):
        transposed_root = roots[(key_semi - capo) % 12]
        if transposed_root in {"G", "A", "C", "D", "E"}:
            return capo
    return 0


def download_youtube(youtube_url: str, output_dir: str, audio_path: str) -> tuple:
    """Download audio with yt-dlp. Returns (title, artist, duration_meta)."""
    extractor_args = "youtube:player_client=tv_embedded,android_vr,web"
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--extractor-args", extractor_args,
        "--socket-timeout", "30",
        "--write-info-json",
        "--no-post-overwrites",
        "-o", os.path.join(output_dir, "audio.%(ext)s"),
        "--print-to-file", "after_move:filepath", os.path.join(output_dir, "filepath.txt"),
    ]

    cookie_tmp = None
    cookies_b64 = os.environ.get("YOUTUBE_COOKIES", "").strip()
    if cookies_b64:
        try:
            fd, cookie_tmp = tempfile.mkstemp(suffix=".txt", prefix="yt_cookies_")
            with os.fdopen(fd, "wb") as cf:
                cf.write(base64.b64decode(cookies_b64))
            cmd.extend(["--cookies", cookie_tmp])
            print("[pipeline] Using stored YouTube cookies", flush=True)
        except Exception as ce:
            print(f"[pipeline] Warning: could not decode YOUTUBE_COOKIES: {ce}", flush=True)
            cookie_tmp = None

    cmd.append(youtube_url)

    try:
        dl_result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    finally:
        if cookie_tmp and os.path.exists(cookie_tmp):
            os.unlink(cookie_tmp)

    if dl_result.returncode != 0:
        stderr = (dl_result.stderr or "") + (dl_result.stdout or "")
        sl = stderr.lower()
        if "age" in sl or "sign in" in sl or "confirm your age" in sl:
            raise ValueError(
                "Age-restricted video — YouTube won't allow server-side download. "
                "Download the audio yourself at cobalt.tools then use Upload audio."
            )
        if "private" in sl or "unavailable" in sl:
            raise ValueError("Video is private or unavailable — try uploading the audio file instead")
        if "live" in sl:
            raise ValueError("Live streams cannot be processed — submit a recorded video or upload audio")
        raise RuntimeError(f"yt-dlp failed (exit {dl_result.returncode}): {stderr[:400]}")

    if not os.path.exists(audio_path):
        for f in os.listdir(output_dir):
            if f.endswith(".wav"):
                # Move/rename to expected path if needed
                found = os.path.join(output_dir, f)
                if found != audio_path:
                    os.rename(found, audio_path)
                break
    if not os.path.exists(audio_path):
        raise RuntimeError("yt-dlp did not produce a wav file")

    title, artist, duration_meta = "Unknown Title", "Unknown Artist", None
    for f in os.listdir(output_dir):
        if f.endswith(".info.json"):
            with open(os.path.join(output_dir, f)) as fh:
                meta = json.load(fh)
            title = meta.get("title", title)
            artist = meta.get("uploader") or meta.get("channel") or artist
            duration_meta = meta.get("duration")
            break
    return title, artist, duration_meta


def analyse_audio(audio_path: str, title: str, artist: str, duration_meta) -> dict:
    import librosa
    import numpy as np

    print(f"[pipeline] Loading audio: {audio_path}", flush=True)
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = float(len(y) / sr)

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    bpm = int(round(float(np.atleast_1d(tempo)[0])))

    # Key estimation
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

    best_score, best_key = -999.0, "C major"
    for i, root in enumerate(roots):
        rotated = np.roll(chroma_mean, -i)
        for mode, profile in [("major", major_profile), ("minor", minor_profile)]:
            score = float(np.corrcoef(rotated, profile)[0, 1])
            if score > best_score:
                best_score = score
                best_key = f"{root} {mode}"

    # Chord detection — maj / min / 7 / maj7 / m7 / sus4 templates
    print("[pipeline] Detecting chords…", flush=True)
    templates = [
        ("",    np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], dtype=float)),       # maj
        ("m",   np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], dtype=float)),       # min
        ("7",   np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], dtype=float)),       # dom7
        ("maj7",np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1], dtype=float)),       # maj7
        ("m7",  np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], dtype=float)),       # m7
        ("sus4",np.array([1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0], dtype=float)),       # sus4
    ]

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    frame_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=512)

    chord_events = []
    prev_label = None
    for i, beat_time in enumerate(beat_times):
        next_beat = beat_times[i + 1] if i + 1 < len(beat_times) else beat_time + 0.5
        mask = (frame_times >= beat_time) & (frame_times < next_beat)
        if not mask.any():
            continue
        beat_chroma = chroma[:, mask].mean(axis=1)
        beat_chroma = beat_chroma / (beat_chroma.max() + 1e-8)

        best, best_root, best_quality = -1.0, "C", ""
        for semitone, root in enumerate(roots):
            for quality, template in templates:
                rotated = np.roll(template, semitone)
                score = float(np.dot(beat_chroma, rotated) / (np.linalg.norm(rotated) + 1e-8))
                if score > best:
                    best, best_root, best_quality = score, root, quality

        label = best_root + best_quality
        if label == prev_label:
            continue
        prev_label = label
        chord_events.append({
            "timestamp_sec": round(float(beat_time), 3),
            "chord_root": best_root,
            "chord_quality": best_quality,
            "confidence_score": round(best, 3),
            "section_name": None,
        })

    if not chord_events:
        raise RuntimeError("No chords detected — check that the audio contains pitched content")

    chord_events.sort(key=lambda e: e["timestamp_sec"])
    key_root = best_key.split()[0]
    capo_suggested = suggest_capo(key_root, roots)

    return {
        "title": title,
        "artist": artist,
        "duration": round(duration_meta or duration, 2),
        "bpm": bpm,
        "key_detected": best_key,
        "capo_suggested": capo_suggested,
        "chord_events": chord_events,
    }


def run_pipeline(youtube_url, output_dir, audio_file=None):
    os.makedirs(output_dir, exist_ok=True)
    audio_path = os.path.join(output_dir, "audio.wav")

    title = os.environ.get("GUITAR_TITLE") or "Untitled"
    artist = os.environ.get("GUITAR_ARTIST") or "Unknown Artist"
    duration_meta = None

    if audio_file:
        if not os.path.exists(audio_file):
            raise FileNotFoundError(f"Audio file not found: {audio_file}")
        # Convert to wav via ffmpeg for consistent analysis
        print(f"[pipeline] Converting uploaded audio → wav…", flush=True)
        conv = subprocess.run(
            ["ffmpeg", "-y", "-i", audio_file, "-ac", "1", "-ar", "22050", audio_path],
            capture_output=True, text=True, timeout=120,
        )
        if conv.returncode != 0 or not os.path.exists(audio_path):
            # Fall back: let librosa load the original directly
            audio_path = audio_file
            print(f"[pipeline] ffmpeg convert skipped/failed — loading original", flush=True)
        if title == "Untitled":
            title = os.path.splitext(os.path.basename(audio_file))[0]
    else:
        if not youtube_url or youtube_url in ("-", "none", "null"):
            raise ValueError("No YouTube URL or audio file provided")
        title, artist, duration_meta = download_youtube(youtube_url, output_dir, audio_path)

    return analyse_audio(audio_path, title, artist, duration_meta)


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: guitar_pipeline.py <youtube_url_|_-> <output_dir> [audio_file]"}))
        sys.exit(1)

    youtube_url = sys.argv[1]
    output_dir = sys.argv[2]
    audio_file = sys.argv[3] if len(sys.argv) > 3 else None

    try:
        result = run_pipeline(youtube_url, output_dir, audio_file)
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
