"""Load the trained model and turn its phishing probability into a weighted, explainable signal."""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime

from engine.ml.features import FEATURE_NAMES, MODEL_CODE, OVERRIDE_CODES, extract
from engine.normalize import NormalizedUrl
from engine.reasons import Signal
from engine.settings import ROOT
from shared.contract import Evidence

MODEL_DIR = ROOT / "engine" / "model"
MODEL_FILE = MODEL_DIR / "saqr_model.joblib"
METRICS_FILE = MODEL_DIR / "metrics.json"

_cache: dict[str, object] = {"mtime": None, "bundle": None}


def _bundle() -> dict | None:
    """The saved model bundle, reloaded whenever the file changes (e.g. after a retrain)."""
    if not MODEL_FILE.is_file():
        return None
    mtime = MODEL_FILE.stat().st_mtime
    if _cache["mtime"] != mtime:
        import joblib  # imported lazily: scikit-learn is only needed once a model exists

        bundle = joblib.load(MODEL_FILE)
        _cache.update(mtime=mtime, bundle=bundle if bundle.get("feature_names") == FEATURE_NAMES else None)
    return _cache["bundle"]


def available() -> bool:
    return _bundle() is not None


def blend_weight(probability: float, codes: Iterable[str], up: int, down: int) -> int:
    """Points the model adds (up to +up) or removes (down to -down). Top-10k sites are never pushed upward."""
    if probability >= 0.5:
        weight = round(up * (probability - 0.5) / 0.5)
    else:
        weight = -round(down * (0.5 - probability) / 0.5)
    if "TRANCO_TOP" in set(codes):
        weight = min(weight, 0)
    return weight


def predict(url: NormalizedUrl, codes: Iterable[str], evidence: Evidence, now: datetime) -> float | None:
    bundle = _bundle()
    if bundle is None:
        return None
    row = extract(url, codes, evidence, now)
    return float(bundle["model"].predict_proba([row])[0][1])


def model_signal(url: NormalizedUrl, codes: Iterable[str], evidence: Evidence, now: datetime) -> Signal | None:
    """The bilingual 'AI model' reason, or None when no model is trained or an official-domain rule applies."""
    codes = set(codes)
    if codes & OVERRIDE_CODES:
        return None
    probability = predict(url, codes, evidence, now)
    if probability is None:
        return None
    blend = _bundle()["blend"]
    weight = blend_weight(probability, codes, blend["up"], blend["down"])
    return Signal(MODEL_CODE, f"{round(probability * 100)}%", weight_override=weight)


def metrics() -> dict | None:
    if not METRICS_FILE.is_file():
        return None
    return json.loads(METRICS_FILE.read_text(encoding="utf-8"))
