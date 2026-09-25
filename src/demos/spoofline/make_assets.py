"""Precompute the spoofline demo assets from a spoofline checkout.

    uv run --with numpy --with pillow python src/demos/spoofline/make_assets.py <spoofline checkout>

Input is web/public/data of the spoofline repository, written by web/scripts/export.py
from one `make demo` run: manifest.json, reference.json, calib_scores.json,
test_scores.json, mel_fbank.bin, logmel_check.bin and the packed clips under clips/,
plus the committed artifacts of the same run under docs/runs: results.json,
robustness.json and export.json of the demo run, and sweep.json of the three seed
full profile sweep of the same held out pair.

Output, next to this script:

    frames.webp        every exported clip's 16 frames at their native 64x64, 8 across and
                       2 down, one clip per band
    spectrograms.webp  every exported clip's log mel spectrogram (64 bands by 201 frames),
                       low bands at the bottom, one clip per band, on one fixed scale and a
                       single graphite to lime ramp
    data.json          the run's calibration (both streams, the weighted sum and the
                       logistic fusion), the calibration and test split logits, the
                       measured metrics and attribution, the sweep, robustness and
                       export figures, the family descriptions, and per clip the scores
                       PyTorch produced

Nothing in data.json is recomputed here: scores, probabilities, decisions, attribution and
metrics are copied from the exported files. The script only checks that they are
consistent before it writes anything:

    - every clip inflates to the exact byte length of 16 x 64 x 64 x 3 frames and 32000 samples;
    - the log mel of the check clip matches logmel_check.bin;
    - the export's run block equals the committed results.json;
    - the calibration logits re-pick every threshold, including the logistic one, at the target;
    - the test logits at those thresholds reproduce every count in the metrics table;
    - the test logits reproduce the clean false alarm row and every abstain row of robustness.json;
    - the sweep holds this run's seed with this run's unseen precision;
    - each clip's probabilities, flags, decisions and triggering stream follow from its logits.

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

RUN_DIR = Path("docs/runs/demo-full-seed20250117")
SWEEP_FILE = Path("docs/runs/sweep-full-default-pair/sweep.json")
STREAMS = ("video", "audio")
DETECTORS = ("video", "audio", "fused", "logistic")
SPLITS = ("seen_test", "unseen_test")
LOGISTIC_FEATURES = ("p_video", "p_audio", "disagreement")

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


def logistic(model: dict, p_video: np.ndarray, p_audio: np.ndarray) -> np.ndarray:
    """spoofline.fusion.LogisticFusion.fuse: both probabilities, their gap, a clipped sigmoid."""
    c = model["coefficients"]
    z = c["p_video"] * p_video + c["p_audio"] * p_audio + c["disagreement"] * np.abs(p_video - p_audio) + model["intercept"]
    return 1.0 / (1.0 + np.exp(-np.clip(z, -60.0, 60.0)))


def attribute(decide, p_video: np.ndarray, p_audio: np.ndarray) -> list[str]:
    """spoofline.fusion.attribute: silence one stream at a time, a silenced stream reports 0."""
    silent = np.zeros_like(p_video)
    flagged = decide(p_video, p_audio)
    video_alone = decide(p_video, silent)
    audio_alone = decide(silent, p_audio)
    labels = np.select(
        [~flagged, video_alone & audio_alone, video_alone, audio_alone],
        ["none", "either", "video", "audio"],
        default="joint",
    )
    return labels.tolist()


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


def counts_of(flagged: np.ndarray, labels: np.ndarray) -> dict:
    return {
        "tp": int((flagged & (labels == 1)).sum()),
        "fp": int((flagged & (labels == 0)).sum()),
        "tn": int((~flagged & (labels == 0)).sum()),
        "fn": int((~flagged & (labels == 1)).sum()),
    }


def abstain_rows(p_video: np.ndarray, p_audio: np.ndarray, flagged: np.ndarray, labels: np.ndarray, margins) -> list[dict]:
    """spoofline.robustness.abstain_curve: abstain where |p_video - p_audio| exceeds the margin."""
    rows = []
    for margin in margins:
        kept = ~(np.abs(p_video - p_audio) > margin)
        c = counts_of(flagged[kept], labels[kept])
        rows.append(
            {
                "margin": float(margin),
                "coverage": float(kept.mean()),
                "kept": int(kept.sum()),
                "abstainedAttacks": int((~kept & (labels == 1)).sum()),
                "abstainedBonafide": int((~kept & (labels == 0)).sum()),
                "precision": c["tp"] / (c["tp"] + c["fp"]) if c["tp"] + c["fp"] else 0.0,
                "recall": c["tp"] / (c["tp"] + c["fn"]) if c["tp"] + c["fn"] else 0.0,
            }
        )
    return rows


def close(label: str, got: float, want: float, tol: float) -> None:
    if not abs(got - want) <= tol:
        fail(f"{label}: got {got!r}, want {want!r}")


def same(label: str, got, want, tol: float = 1e-12) -> None:
    """Recursive equality of two JSON values, floats within tol."""
    if isinstance(want, dict):
        if not isinstance(got, dict) or set(got) != set(want):
            fail(f"{label}: keys differ from the committed artifact")
        for k in want:
            same(f"{label}.{k}", got[k], want[k], tol)
    elif isinstance(want, list):
        if not isinstance(got, list) or len(got) != len(want):
            fail(f"{label}: length differs from the committed artifact")
        for i, (g, w) in enumerate(zip(got, want, strict=True)):
            same(f"{label}[{i}]", g, w, tol)
    elif isinstance(want, float) or isinstance(got, float):
        if want is None or got is None:
            if got != want:
                fail(f"{label}: got {got!r}, want {want!r}")
        else:
            close(label, float(got), float(want), tol)
    elif got != want:
        fail(f"{label}: got {got!r}, want {want!r}")


def stats(block: dict) -> dict:
    return {"mean": block["mean"], "std": block["std"], "ciLow": block["ci_low"], "ciHigh": block["ci_high"], "n": block["n"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("repo", type=Path, help="path to a SAY-5/spoofline checkout")
    args = parser.parse_args()
    data_dir = args.repo / "web" / "public" / "data"
    manifest = json.loads((data_dir / "manifest.json").read_text())
    reference = json.loads((data_dir / "reference.json").read_text())
    calib = json.loads((data_dir / "calib_scores.json").read_text())
    test = json.loads((data_dir / "test_scores.json").read_text())
    results = json.loads((args.repo / RUN_DIR / "results.json").read_text())
    robustness = json.loads((args.repo / RUN_DIR / "robustness.json").read_text())
    export = json.loads((args.repo / RUN_DIR / "export.json").read_text())
    sweep = json.loads((args.repo / SWEEP_FILE).read_text())
    corpus = manifest["corpus"]
    features = manifest["features"]
    fbank = np.frombuffer((data_dir / "mel_fbank.bin").read_bytes(), "<f4").reshape(features["fbank_shape"])
    run = reference["run"]
    cal = run["calibration"]
    target = float(run["target_precision"])
    if cal != manifest["calibration"]:
        fail("manifest and reference disagree on the calibration")
    if reference["trained_from_commit"] != manifest["trained_from_commit"]:
        fail("manifest and reference disagree on the training commit")

    # The export's run block is the committed results.json of the same run.
    for key in ("calibration", "metrics", "rules", "family_rates", "attribution", "headline", "splits", "corpus", "seed", "target_precision", "unseen_families"):
        same(f"results.json {key}", run[key], results[key])
    if results["profile"] != manifest["profile"]:
        fail("results.json and manifest disagree on the profile")
    for key, want in (("seed", run["seed"]), ("profile", manifest["profile"]), ("unseen_families", run["unseen_families"])):
        if robustness[key] != want:
            fail(f"robustness.json {key} {robustness[key]!r} is not the demo run's {want!r}")
    if sweep["profile"] != manifest["profile"] or sweep["pairs"] != [run["unseen_families"]]:
        fail("sweep.json is not the full profile sweep of the demo run's held out pair")

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

    weight = float(cal["fused"]["weight"])
    thresholds = {d: cal[d]["operating"]["threshold"] for d in DETECTORS}

    def probabilities(scores: dict) -> dict:
        out = {s: sigmoid(cal[s]["calibrator"]["a"], cal[s]["calibrator"]["b"], np.array(scores[f"{s}_logit"])) for s in STREAMS}
        out["fused"] = weight * out["video"] + (1 - weight) * out["audio"]
        out["logistic"] = logistic(cal["logistic"], out["video"], out["audio"])
        return out

    calib_labels = np.array(calib["label"], dtype=np.int64)
    calib_probs = probabilities(calib)
    for detector in DETECTORS:
        point = threshold_at_precision(calib_probs[detector], calib_labels, target)
        close(f"{detector} threshold", point["threshold"], thresholds[detector], 1e-12)
        close(f"{detector} calib recall", point["recall"], cal[detector]["operating"]["recall"], 1e-12)
        close(f"{detector} calib precision", point["precision"], cal[detector]["operating"]["achieved_precision"], 1e-12)

    test_labels = np.array(test["label"], dtype=np.int64)
    test_probs = probabilities(test)
    test_flags = {d: test_probs[d] >= thresholds[d] for d in DETECTORS}
    for split in SPLITS:
        mask = np.array([s == split for s in test["split"]])
        for detector in DETECTORS:
            counts = counts_of(test_flags[detector][mask], test_labels[mask])
            if counts != run["metrics"][split][detector]["counts"]:
                fail(f"{split} {detector} counts {counts} differ from the metrics table")

    # robustness.json: its clean row is the test split false alarm rate, and its abstain rows
    # follow from the same test logits at the same thresholds.
    bona = test_labels == 0
    if int(bona.sum()) != sum(robustness["bonafide_clips"].values()):
        fail("robustness.json counts a different number of bona fide test clips")
    clean = next(r for r in robustness["false_alarms"] if r["perturbation"] == "clean")
    for detector in DETECTORS:
        close(f"clean false alarm rate {detector}", float(test_flags[detector][bona].mean()), clean[detector], 1e-12)
    margins = [row["margin"] for row in robustness["abstain"]["unseen_test"]["fused"]]
    abstain = {}
    for split in SPLITS:
        mask = np.array([s == split for s in test["split"]])
        abstain[split.replace("_test", "")] = {}
        for fusion in ("fused", "logistic"):
            got = abstain_rows(test_probs["video"][mask], test_probs["audio"][mask], test_flags[fusion][mask], test_labels[mask], margins)
            want = robustness["abstain"][split][fusion]
            for g, w in zip(got, want, strict=True):
                same(
                    f"abstain {split} {fusion} margin {w['margin']}",
                    g,
                    {
                        "margin": w["margin"],
                        "coverage": w["coverage"],
                        "kept": w["kept"],
                        "abstainedAttacks": w["abstained_attacks"],
                        "abstainedBonafide": w["abstained_bonafide"],
                        "precision": w["precision"],
                        "recall": w["recall"],
                    },
                )
            abstain[split.replace("_test", "")][fusion] = got

    # sweep.json: the demo run is one of its three seeds, with the same unseen precision.
    this_run = next((r for r in sweep["runs"] if r["seed"] == run["seed"]), None)
    if this_run is None:
        fail(f"sweep.json has no run with seed {run['seed']}")
    for detector in DETECTORS:
        close(
            f"sweep seed {run['seed']} unseen {detector} precision",
            this_run["metrics"]["unseen_test"][detector]["precision"],
            run["metrics"]["unseen_test"][detector]["precision"],
            1e-12,
        )
    aggregate = sweep["aggregate"]["metrics"]
    for detector in DETECTORS:
        mean = float(np.mean([r["metrics"]["unseen_test"][detector]["precision"] for r in sweep["runs"]]))
        close(f"sweep mean unseen {detector} precision", mean, aggregate["unseen_test"][detector]["precision"]["mean"], 1e-12)

    def decide(p_video: np.ndarray, p_audio: np.ndarray) -> np.ndarray:
        return weight * p_video + (1 - weight) * p_audio >= thresholds["fused"]

    out_clips = []
    for band, entry in enumerate(clips):
        ref = reference["clips"][entry["id"]]
        p = {}
        for stream in STREAMS:
            c = cal[stream]
            p[stream] = float(sigmoid(c["calibrator"]["a"], c["calibrator"]["b"], np.array(ref[f"{stream}_logit"])))
            close(f"{entry['id']} {stream} probability", p[stream], ref[f"{stream}_probability"], 1e-9)
            if (ref[f"{stream}_probability"] >= thresholds[stream]) != ref[f"{stream}_flags"]:
                fail(f"{entry['id']} {stream} flag does not follow from its threshold")
        pv, pa = np.array([ref["video_probability"]]), np.array([ref["audio_probability"]])
        close(f"{entry['id']} fused probability", weight * p["video"] + (1 - weight) * p["audio"], ref["fused_probability"], 1e-9)
        close(f"{entry['id']} logistic probability", float(logistic(cal["logistic"], pv, pa)[0]), ref["logistic_probability"], 1e-9)
        if (ref["fused_probability"] >= thresholds["fused"]) != (ref["decision"] == "attack"):
            fail(f"{entry['id']} decision does not follow from the fused threshold")
        if (ref["logistic_probability"] >= thresholds["logistic"]) != (ref["logistic_decision"] == "attack"):
            fail(f"{entry['id']} logistic decision does not follow from the logistic threshold")
        if attribute(decide, pv, pa)[0] != ref["triggered_by"]:
            fail(f"{entry['id']} triggered_by {ref['triggered_by']} does not follow from silencing each stream")
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
                "logisticProbability": ref["logistic_probability"],
                "videoFlags": ref["video_flags"],
                "audioFlags": ref["audio_flags"],
                "decision": ref["decision"],
                "logisticDecision": ref["logistic_decision"],
                "triggeredBy": ref["triggered_by"],
            }
        )

    def metric(point: dict) -> dict:
        keys = ("precision", "recall", "f1", "auc", "eer", "n", "n_positive")
        return {("nPositive" if k == "n_positive" else k): point[k] for k in keys} | point["counts"]

    def operating(op: dict) -> dict:
        return {"threshold": op["threshold"], "precision": op["achieved_precision"], "recall": op["recall"]}

    def false_alarm_row(row: dict) -> dict:
        return {
            "perturbation": row["perturbation"],
            "stream": row["stream"],
            "severity": row["severity"],
            "unit": row["unit"],
            "n": row["n"],
            **{d: row[d] for d in DETECTORS},
        }

    def gap(name: str) -> dict:
        return stats(sweep["aggregate"]["derived"][name])

    data = {
        "trainedFrom": reference["trained_from_commit"],
        "trainedFromDescribe": manifest["trained_from_describe"],
        "profile": manifest["profile"],
        "seed": run["seed"],
        "targetPrecision": target,
        "unseenFamilies": run["unseen_families"],
        "runArtifacts": {
            "results": str(RUN_DIR / "results.json"),
            "robustness": str(RUN_DIR / "robustness.json"),
            "export": str(RUN_DIR / "export.json"),
            "sweep": str(SWEEP_FILE),
        },
        "families": manifest["families"],
        "corpus": {k: corpus[k] for k in ("n_clips", "n_identities", "n_frames", "frame_size", "sample_rate")},
        "calibration": {
            "video": {**cal["video"]["calibrator"], **operating(cal["video"]["operating"])},
            "audio": {**cal["audio"]["calibrator"], **operating(cal["audio"]["operating"])},
            "fused": {"weight": weight, **operating(cal["fused"]["operating"])},
            "logistic": {
                "coefficients": {k: cal["logistic"]["coefficients"][k] for k in LOGISTIC_FEATURES},
                "intercept": cal["logistic"]["intercept"],
                **operating(cal["logistic"]["operating"]),
            },
        },
        "metrics": {split.replace("_test", ""): {d: metric(run["metrics"][split][d]) for d in DETECTORS} for split in SPLITS},
        "headline": {"verdict": run["headline"]["verdict"], "logisticVerdict": run["headline"]["logistic_verdict"]},
        "attribution": {
            split.replace("_test", ""): {fusion: run["attribution"][split][fusion] for fusion in ("fused", "logistic")} for split in SPLITS
        },
        "familyRates": {f: run["family_rates"]["unseen_test"][f] for f in run["unseen_families"]},
        "sweep": {
            "seeds": sweep["seeds"],
            "runs": [{"seed": r["seed"], **{d: r["metrics"]["unseen_test"][d]["precision"] for d in DETECTORS}} for r in sweep["runs"]],
            "unseen": {
                d: {"precision": stats(aggregate["unseen_test"][d]["precision"]), "recall": stats(aggregate["unseen_test"][d]["recall"])}
                for d in DETECTORS
            },
            "gap": {"fused": gap("unseen_precision_gap"), "logistic": gap("logistic_unseen_precision_gap")},
            "wallClockS": sweep["wall_clock_s"],
        },
        "robustness": {
            "bonafideClips": robustness["bonafide_clips"],
            "falseAlarms": [false_alarm_row(r) for r in robustness["false_alarms"]],
            "margins": margins,
            "abstain": abstain,
        },
        "export": {
            "tolerance": export["tolerance"],
            "parityClips": export["clips"],
            "parity": {s: export["parity"][s]["max_abs_diff"] for s in STREAMS},
        },
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
