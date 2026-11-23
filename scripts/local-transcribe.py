#!/usr/bin/env python3
"""Local faster-whisper fallback for SciFlow media attachments.

Usage: python3 local-transcribe.py <audio-or-video> <model-dir>
Prints JSON: {"text": "...", "language": "...", "duration": seconds}

We normalize audio with ffmpeg and pass a numpy array to faster-whisper,
because some faster-whisper builds ship an av version whose decode_audio
signature is incompatible (metadata_errors kwarg).
"""
import json
import os
import subprocess
import sys
import tempfile
import wave


def load_audio(path: str, sample_rate: int = 16000):
    import numpy as np

    with tempfile.TemporaryDirectory(prefix="sciflow-whisper-") as tmp:
        wav_path = os.path.join(tmp, "audio.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", path,
             "-ar", str(sample_rate), "-ac", "1", "-f", "wav", wav_path],
            check=True,
        )
        with wave.open(wav_path, "rb") as wf:
            frames = wf.readframes(wf.getnframes())
        return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: local-transcribe.py <audio> <model-dir>"}, ensure_ascii=False))
        return 2
    audio_path, model_dir = sys.argv[1], sys.argv[2]
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - dependency check
        print(json.dumps({"error": f"faster-whisper 未安装: {exc}"}, ensure_ascii=False))
        return 3
    model = WhisperModel(model_dir, device="cpu", compute_type="int8")
    audio = load_audio(audio_path)
    segments, info = model.transcribe(audio, beam_size=5, vad_filter=True)
    text = "".join(segment.text for segment in segments).strip()
    print(json.dumps({
        "text": text,
        "language": getattr(info, "language", ""),
        "duration": getattr(info, "duration", 0),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
