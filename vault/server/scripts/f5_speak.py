#!/usr/bin/env python3
import argparse

from f5_tts_mlx.generate import generate


def main():
    parser = argparse.ArgumentParser(description='Generate speech with F5-TTS MLX voice clone')
    parser.add_argument('--text', required=True)
    parser.add_argument('--ref-audio', required=True)
    parser.add_argument('--ref-text', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--steps', type=int, default=4)
    args = parser.parse_args()

    generate(
        generation_text=args.text,
        ref_audio_path=args.ref_audio,
        ref_audio_text=args.ref_text,
        output_path=args.output,
        steps=args.steps,
        estimate_duration=True,
    )
    print(args.output)


if __name__ == '__main__':
    main()
