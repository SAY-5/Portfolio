"""Precompute the spoofline demo assets from a spoofline checkout.

    uv run --with numpy --with pillow python src/demos/spoofline/make_assets.py <spoofline checkout>

Input is web/public/data of the spoofline repository, written by web/scripts/export.py
from one `make demo` run: manifest.json, reference.json, calib_scores.json,
test_scores.json, mel_fbank.bin, logmel_check.bin and the packed clips under clips/.

Output, next to this script:

    frames.webp        every exported clip's 16 frames at their native 64x64, 8 across and
                       2 down, one clip per band
    spectrograms.webp  every exported clip's log mel spectrogram (64 bands by 201 frames),
                       low bands at the bottom, one clip per band, on one fixed scale and a
                       single graphite to lime ramp
    data.json          the run's calibration, the calibration and test split logits, the
                       measured metrics, the family descriptions, and per clip the scores
                       PyTorch produced

Nothing in data.json is recomputed here: scores, probabilities, decisions and metrics are
copied from the exported files. The script only checks that they are consistent before it
writes anything:

    - every clip inflates to the exact byte length of 16 x 64 x 64 x 3 frames and 32000 samples;
    - the log mel of the check clip matches logmel_check.bin;
    - the calibration logits re-pick the run's per stream and fused thresholds at the target;
    - the test logits at those thresholds reproduce every count in the metrics table;
    - each clip's probabilities, flags and fused decision follow from its logits.

A rerun on the same input writes the same data.json.
"""

from __future__ import annotations

import argparse
import json
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent

FRAME_COLS = 8
FRAME_QUALITY = 50
SPEC_QUALITY = 55
SPEC_LOW = -14.0
SPEC_HIGH = 10.0
LEVELS = 64

# Graphite to lime, the site tokens --ink-900, --ink-600, --lime-deep, --lime, --lime-soft.
RAMP_STOPS = [
    (0.0, (0x0B, 0x0C, 0x0A)),
    (0.35, (0x21, 0x25, 0x1E)),
    (0.72, (0x9F, 0xC4, 0x1F)),
    (0.9, (0xCD, 0xF5, 0x3A)),
    (1.0, (0xE6, 0xFF, 0x7A)),
]


def fail(message: str) -> None:
    raise SystemExit(f"asset check failed: {message}")


def decode_clip(blob: bytes, n_frames: int, size: int, n_samples: int) -> tuple[np.ndarray, np.ndarray]:
    """Undo export.py's packing: left then temporal prediction on frames, first difference on audio."""
    raw = zlib.decompress(blob)
    shape = (n_frames, size, size, 3)
    frame_bytes = int(np.prod(shape))
    if len(raw) != frame_bytes + 2 * n_samples:
        fail(f"clip holds {len(raw)} bytes, expected {frame_bytes + 2 * n_samples}")
    residual = np.frombuffer(raw[:frame_bytes], np.uint8).reshape(shape).astype(np.int64)
    left = np.cumsum(residual, axis=0) % 256
    frames = (np.cumsum(left, axis=2) % 256).astype(np.uint8)
    diff = np.frombuffer(raw[frame_bytes:], "<i2").astype(np.int64)
    audio = ((np.cumsum(diff) + 32768) % 65536 - 32768).astype(np.int16)
    return frames, audio


def log_mel(audio: np.ndarray, fbank: np.ndarray, features: dict) -> np.ndarray:
    """(n_mels, frames): periodic Hann, reflect padding, power spectrum, mel filterbank, log."""
    n_fft = int(features["n_fft"])
    hop = int(features["hop_length"])
    wave = audio.astype(np.float32) / np.float32(features["audio_scale"])
    padded = np.pad(wave.astype(np.float64), n_fft // 2, mode="reflect")
    n_frames = 1 + len(wave) // hop
    window = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_fft) / n_fft)
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n_frames)[:, None]
    power = np.abs(np.fft.rfft(padded[idx] * window, axis=1)) ** 2
    mel = power @ fbank.astype(np.float64)
    return np.log(mel + float(features["log_epsilon"])).T


def ramp() -> np.ndarray:
    out = np.zeros((LEVELS, 3), dtype=np.uint8)
    for i in range(LEVELS):
        t = i / (LEVELS - 1)
        k = 0
        while k < len(RAMP_STOPS) - 2 and t > RAMP_STOPS[k + 1][0]:
            k += 1
        (t0, c0), (t1, c1) = RAMP_STOPS[k], RAMP_STOPS[k + 1]
        u = (t - t0) / (t1 - t0)
        out[i] = [round(c0[c] + (c1[c] - c0[c]) * u) for c in range(3)]
    return out


def sigmoid(a: float, b: float, s: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-(a * s + b)))


def threshold_at_precision(scores: np.ndarray, labels: np.ndarray, target: float) -> dict:
    """Lowest threshold whose precision reaches the target, falling back to the best precision."""
    best = None
    fallback = None
    n_pos = max(1, int(labels.sum()))
    for t in np.unique(scores):
        flagged = scores >= t
        tp = int((flagged & (labels == 1)).sum())
        fp = int((flagged & (labels == 0)).sum())
        if tp + fp == 0:
            continue
        point = {"threshold": float(t), "precision": tp / (tp + fp), "recall": tp / n_pos}
        if point["precision"] >= target and (best is None or point["recall"] > best["recall"]):
            best = point
        if fallback is None or (point["precision"], point["recall"]) > (fallback["precision"], fallback["recall"]):
            fallback = point
    return best or fallback


def close(label: str, got: float, want: float, tol: float) -> None:
    if not abs(got - want) <= tol:
        fail(f"{label}: got {got!r}, want {want!r}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("repo", type=Path, help="path to a SAY-5/spoofline checkout")
    args = parser.parse_args()
    data_dir = args.repo / "web" / "public" / "data"
    manifest = json.loads((data_dir / "manifest.json").read_text())
    reference = json.loads((data_dir / "reference.json").read_text())
    calib = json.loads((data_dir / "calib_scores.json").read_text())
    test = json.loads((data_dir / "test_scores.json").read_text())
    corpus = manifest["corpus"]
    features = manifest["features"]
    fbank = np.frombuffer((data_dir / "mel_fbank.bin").read_bytes(), "<f4").reshape(features["fbank_shape"])
    run = reference["run"]
    cal = run["calibration"]
    target = float(run["target_precision"])
    if cal != manifest["calibration"]:
        fail("manifest and reference disagree on the calibration")

    clips = manifest["clips"]
    n_frames, size, n_samples = corpus["n_frames"], corpus["frame_size"], corpus["n_samples"]
    rows = n_frames // FRAME_COLS
    frames_sheet = np.zeros((len(clips) * rows * size, FRAME_COLS * size, 3), dtype=np.uint8)
    mel_frames = 1 + n_samples // int(features["hop_length"])
    n_mels = int(features["n_mels"])
    spec_sheet = np.zeros((len(clips) * n_mels, mel_frames), dtype=np.int64)
    lo_seen, hi_seen = np.inf, -np.inf
    for band, entry in enumerate(clips):
        frames, audio = decode_clip((data_dir / "clips" / f"{entry['id']}.zlib").read_bytes(), n_frames, size, n_samples)
        tile = frames.reshape(rows, FRAME_COLS, size, size, 3).transpose(0, 2, 1, 3, 4).reshape(rows * size, FRAME_COLS * size, 3)
        frames_sheet[band * rows * size : (band + 1) * rows * size] = tile
        mel = log_mel(audio, fbank, features)
        if entry["id"] == features["logmel_check_clip"]:
            check = np.frombuffer((data_dir / "logmel_check.bin").read_bytes(), "<f4").reshape(features["logmel_check_shape"])
            gap = float(np.max(np.abs(mel - check)))
            if gap > 1e-3:
                fail(f"log mel of {entry['id']} is {gap:.2e} away from logmel_check.bin")
            print(f"  log mel of {entry['id']} within {gap:.1e} of logmel_check.bin")
        lo_seen, hi_seen = min(lo_seen, float(mel.min())), max(hi_seen, float(mel.max()))
        level = np.clip(np.round((mel - SPEC_LOW) / (SPEC_HIGH - SPEC_LOW) * (LEVELS - 1)), 0, LEVELS - 1)
        spec_sheet[band * n_mels : (band + 1) * n_mels] = level[::-1].astype(np.int64)
    print(f"  decoded {len(clips)} clips, log mel range {lo_seen:.2f} to {hi_seen:.2f}, drawn on {SPEC_LOW} to {SPEC_HIGH}")

    streams = ("video", "audio")
    calib_labels = np.array(calib["label"], dtype=np.int64)
    calib_probs = {}
    for stream in streams:
        c = cal[stream]
        calib_probs[stream] = sigmoid(c["calibrator"]["a"], c["calibrator"]["b"], np.array(calib[f"{stream}_logit"]))
        point = threshold_at_precision(calib_probs[stream], calib_labels, target)
        close(f"{stream} threshold", point["threshold"], c["operating"]["threshold"], 1e-12)
        close(f"{stream} calib recall", point["recall"], c["operating"]["recall"], 1e-12)
    weight = float(cal["fused"]["weight"])
    calib_probs["fused"] = weight * calib_probs["video"] + (1 - weight) * calib_probs["audio"]
    point = threshold_at_precision(calib_probs["fused"], calib_labels, target)
    close("fused threshold", point["threshold"], cal["fused"]["operating"]["threshold"], 1e-12)

    thresholds = {s: cal[s]["operating"]["threshold"] for s in streams}
    thresholds["fused"] = cal["fused"]["operating"]["threshold"]
    test_labels = np.array(test["label"], dtype=np.int64)
    test_probs = {
        s: sigmoid(cal[s]["calibrator"]["a"], cal[s]["calibrator"]["b"], np.array(test[f"{s}_logit"])) for s in streams
    }
    test_probs["fused"] = weight * test_probs["video"] + (1 - weight) * test_probs["audio"]
    for split in ("seen_test", "unseen_test"):
        mask = np.array([s == split for s in test["split"]])
        for detector in ("video", "audio", "fused"):
            flagged = test_probs[detector][mask] >= thresholds[detector]
            labels = test_labels[mask]
            counts = {
                "tp": int((flagged & (labels == 1)).sum()),
                "fp": int((flagged & (labels == 0)).sum()),
                "tn": int((~flagged & (labels == 0)).sum()),
                "fn": int((~flagged & (labels == 1)).sum()),
            }
            if counts != run["metrics"][split][detector]["counts"]:
                fail(f"{split} {detector} counts {counts} differ from the metrics table")

    out_clips = []
    for band, entry in enumerate(clips):
        ref = reference["clips"][entry["id"]]
        for stream in streams:
            c = cal[stream]
            p = float(sigmoid(c["calibrator"]["a"], c["calibrator"]["b"], np.array(ref[f"{stream}_logit"])))
            close(f"{entry['id']} {stream} probability", p, ref[f"{stream}_probability"], 1e-9)
            if (ref[f"{stream}_probability"] >= thresholds[stream]) != ref[f"{stream}_flags"]:
                fail(f"{entry['id']} {stream} flag does not follow from its threshold")
        fused = weight * ref["video_probability"] + (1 - weight) * ref["audio_probability"]
        close(f"{entry['id']} fused probability", fused, ref["fused_probability"], 1e-9)
        if (ref["fused_probability"] >= thresholds["fused"]) != (ref["decision"] == "attack"):
            fail(f"{entry['id']} decision does not follow from the fused threshold")
        gallery = next((r.split(":", 1)[1] for r in entry["roles"] if r.startswith("gallery:")), None)
        out_clips.append(
            {
                "id": entry["id"],
                "band": band,
                "identity": entry["identity"],
                "videoFamily": entry["video_family"],
                "audioFamily": entry["audio_family"],
                "label": entry["label"],
                "combo": entry["combo"],
                "split": entry["split"],
                "unseen": entry["touches_unseen"],
                "gallery": gallery,
                "videoLogit": ref["video_logit"],
                "audioLogit": ref["audio_logit"],
                "videoProbability": ref["video_probability"],
                "audioProbability": ref["audio_probability"],
                "fusedProbability": ref["fused_probability"],
                "videoFlags": ref["video_flags"],
                "audioFlags": ref["audio_flags"],
                "decision": ref["decision"],
            }
        )

    def metric(point: dict) -> dict:
        keys = ("precision", "recall", "f1", "auc", "eer", "n", "n_positive")
        return {("nPositive" if k == "n_positive" else k): point[k] for k in keys} | point["counts"]

    def operating(op: dict) -> dict:
        return {"threshold": op["threshold"], "precision": op["achieved_precision"], "recall": op["recall"]}

    data = {
        "trainedFrom": reference["trained_from_commit"],
        "seed": run["seed"],
        "targetPrecision": target,
        "unseenFamilies": run["unseen_families"],
        "families": manifest["families"],
        "corpus": {k: corpus[k] for k in ("n_clips", "n_identities", "n_frames", "frame_size", "sample_rate")},
        "calibration": {
            "video": {**cal["video"]["calibrator"], **operating(cal["video"]["operating"])},
            "audio": {**cal["audio"]["calibrator"], **operating(cal["audio"]["operating"])},
            "fused": {"weight": weight, **operating(cal["fused"]["operating"])},
        },
        "metrics": {
            split.replace("_test", ""): {d: metric(run["metrics"][split][d]) for d in ("video", "audio", "fused")}
            for split in ("seen_test", "unseen_test")
        },
        "familyRates": {f: run["family_rates"]["unseen_test"][f] for f in run["unseen_families"]},
        "calib": {"label": calib["label"], "video": calib["video_logit"], "audio": calib["audio_logit"]},
        "test": {
            "label": test["label"],
            "unseen": [1 if s == "unseen_test" else 0 for s in test["split"]],
            "video": test["video_logit"],
            "audio": test["audio_logit"],
        },
        "sheets": {
            "frames": {"cols": FRAME_COLS, "rows": rows, "size": size},
            "spectrogram": {"bands": n_mels, "frames": mel_frames, "low": SPEC_LOW, "high": SPEC_HIGH},
        },
        "clips": out_clips,
    }

    Image.fromarray(frames_sheet, "RGB").save(HERE / "frames.webp", "WEBP", quality=FRAME_QUALITY, method=6)
    colored = ramp()[spec_sheet]
    Image.fromarray(colored, "RGB").save(HERE / "spectrograms.webp", "WEBP", quality=SPEC_QUALITY, method=6)
    (HERE / "data.json").write_text(json.dumps(data, separators=(",", ":")) + "\n")
    for name in ("frames.webp", "spectrograms.webp", "data.json"):
        print(f"  wrote {name} ({(HERE / name).stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
