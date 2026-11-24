"""Train the ML layer on the TRAIN split, tune how it blends with the rules, and report on the TEST split.

  python -m engine.ml.train [--dataset data/datasets/labeled.csv] [--no-fetch]

Network lookups (RDAP, DNS, redirects) for every URL are cached in data/runtime/ml/lookups.jsonl, so only the
first run is slow; later runs, including the dashboard's Retrain button, reuse the cache. --no-fetch skips URLs
that are not cached yet instead of looking them up.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.model_selection import GroupKFold

from engine import evaluate as ev
from engine import net
from engine.brands import official_brand_for_host, tranco_top
from engine.browser import pool
from engine.ml.features import FEATURE_NAMES, OVERRIDE_CODES, extract, feature_label, rule_score
from engine.ml.model import METRICS_FILE, MODEL_DIR, MODEL_FILE, blend_weight
from engine.normalize import InvalidInput, normalize
from engine.scanner import scan
from engine.settings import ROOT, RUNTIME_DIR, settings
from shared.contract import (
    FRAUD_MIN,
    SUSPICIOUS_MIN,
    ApproachMetrics,
    ConfusionCell,
    DatasetSplit,
    Evidence,
    FeatureImportance,
    ModelInfo,
    ThresholdMetrics,
    verdict_for,
)

DATASET = ROOT / "data" / "datasets" / "labeled.csv"
CACHE = RUNTIME_DIR / "ml" / "lookups.jsonl"
SEED = 2026
ALGORITHM = "Gradient boosting (scikit-learn HistGradientBoostingClassifier)"
BLEND_UP = range(10, 105, 5)
BLEND_DOWN = range(0, 45, 5)
LOOKUP_TIMEOUT_S = 30


def say(text: str = "") -> None:
    print(text, flush=True)


def new_model() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=1.0, random_state=SEED,
    )


# ---- lookups ----


def load_cache() -> dict[str, dict]:
    if not CACHE.is_file():
        return {}
    records = {}
    for line in CACHE.read_text(encoding="utf-8").splitlines():
        if line.strip():
            record = json.loads(line)
            records[record["url"]] = record
    return records


async def _skip_certificate(domain: str) -> None:
    return None


async def fetch_missing(urls: list[str], concurrency: int) -> None:
    """Scan every URL in network mode without the model. Certificate transparency is skipped: the model does
    not use it, and crt.sh is far too slow to query for thousands of domains."""
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    original_certificate = net.first_certificate
    net.first_certificate = _skip_certificate
    limit = asyncio.Semaphore(concurrency)
    done = 0
    started = time.monotonic()
    step = max(1, len(urls) // 50)

    async def one(url: str, handle) -> None:
        nonlocal done
        async with limit:
            try:
                result = await scan(url, discovered_by="batch", mode="network", use_model=False,
                                    timeout_s=LOOKUP_TIMEOUT_S)
                record = {"url": url, "codes": sorted({r.code for r in result.reasons}),
                          "evidence": result.evidence.model_dump(mode="json"),
                          "scanned_at": result.scanned_at.isoformat()}
            except InvalidInput:
                record = {"url": url, "invalid": True}
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        done += 1
        if done % step == 0 or done == len(urls):
            elapsed = time.monotonic() - started
            rate = done / elapsed if elapsed else 0.0
            eta = (len(urls) - done) / rate if rate else 0.0
            say(f"    lookups {done:5}/{len(urls)}  ({done / len(urls):6.1%})  {rate:5.1f} URLs/s  "
                f"about {eta / 60:4.1f} min left")

    try:
        with CACHE.open("a", encoding="utf-8") as handle:
            await asyncio.gather(*(one(u, handle) for u in urls))
    finally:
        net.first_certificate = original_certificate
        await pool.close()


# ---- dataset ----


@dataclass
class Example:
    url: str
    phishing: bool
    split: str
    source: str
    domain: str
    codes: set[str]
    features: list[float]
    official: bool
    allowlisted: bool

    @property
    def override(self) -> bool:
        return bool(self.codes & OVERRIDE_CODES)


def build_examples(rows: list[ev.Row], cache: dict[str, dict]) -> list[Example]:
    examples = []
    top = tranco_top()
    for row in rows:
        record = cache.get(row.url)
        if not record or record.get("invalid"):
            continue
        url = normalize(row.url)
        codes = set(record["codes"])
        evidence = Evidence.model_validate(record["evidence"])
        now = datetime.fromisoformat(record["scanned_at"])
        host = urlsplit(url.url).hostname or ""
        official = bool(official_brand_for_host(host)) or url.registered_domain.endswith(".gov.ae")
        examples.append(Example(
            url=row.url, phishing=row.label == "phishing", split=row.split, source=row.source,
            domain=url.registered_domain, codes=codes, features=extract(url, codes, evidence, now),
            official=official, allowlisted=official or url.registered_domain in top,
        ))
    return examples


# ---- scoring and metrics ----


def rule_scores(examples: list[Example]) -> np.ndarray:
    return np.array([0 if e.override else rule_score(e.codes) for e in examples])


def combined_scores(examples: list[Example], probabilities: np.ndarray, up: int, down: int) -> np.ndarray:
    scores = []
    for e, p in zip(examples, probabilities):
        if e.override:
            scores.append(0)
            continue
        scores.append(max(0, min(100, rule_score(e.codes) + blend_weight(p, e.codes, up, down))))
    return np.array(scores)


def threshold_metrics(labels: np.ndarray, scores: np.ndarray, threshold: int) -> ThresholdMetrics:
    flagged = scores >= threshold
    tp = int(np.sum(flagged & labels))
    fp = int(np.sum(flagged & ~labels))
    fn = int(np.sum(~flagged & labels))
    tn = int(np.sum(~flagged & ~labels))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return ThresholdMetrics(threshold=threshold, precision=round(precision, 4), recall=round(recall, 4),
                            f1=round(f1, 4), tp=tp, fp=fp, tn=tn, fn=fn)


def approach(name: str, labels: np.ndarray, scores: np.ndarray) -> ApproachMetrics:
    return ApproachMetrics(approach=name, fraud=threshold_metrics(labels, scores, FRAUD_MIN),
                           flagged=threshold_metrics(labels, scores, SUSPICIOUS_MIN))


def tune_blend(examples: list[Example], labels: np.ndarray, oof: np.ndarray) -> tuple[int, int]:
    """Pick the blend that maximises F1 at both thresholds while keeping precision high, on train only."""
    best: tuple[float, int, int] | None = None
    fallback: tuple[float, int, int] | None = None
    for up in BLEND_UP:
        for down in BLEND_DOWN:
            scores = combined_scores(examples, oof, up, down)
            fraud = threshold_metrics(labels, scores, FRAUD_MIN)
            flagged = threshold_metrics(labels, scores, SUSPICIOUS_MIN)
            objective = fraud.f1 + flagged.f1
            if fallback is None or objective > fallback[0]:
                fallback = (objective, up, down)
            if fraud.precision >= 0.98 and flagged.precision >= 0.97 and (best is None or objective > best[0]):
                best = (objective, up, down)
    chosen = best or fallback
    return chosen[1], chosen[2]


# ---- main ----


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.ml.train", description=__doc__.splitlines()[0])
    parser.add_argument("--dataset", type=Path, default=DATASET)
    parser.add_argument("--no-fetch", action="store_true")
    parser.add_argument("--concurrency", type=int, default=settings.page_concurrency * 2)
    args = parser.parse_args(argv)
    started = time.monotonic()

    say("[1/6] Loading the labelled dataset")
    if not args.dataset.is_file():
        say(f"    {args.dataset} not found. Build it first with scripts/setup_data.ps1.")
        return 1
    rows = ev.load(args.dataset, None)
    for split in ("train", "test"):
        phishing = sum(1 for r in rows if r.split == split and r.label == "phishing")
        legit = sum(1 for r in rows if r.split == split and r.label != "phishing")
        say(f"    {split:5}  {phishing:5} phishing  {legit:5} legitimate")

    say("[2/6] Network lookups (RDAP, DNS, redirects)")
    cache = load_cache()
    missing = sorted({r.url for r in rows} - set(cache))
    say(f"    {len(cache)} cached, {len(missing)} to look up")
    if missing and not args.no_fetch:
        asyncio.run(fetch_missing(missing, args.concurrency))
        cache = load_cache()

    say("[3/6] Extracting features")
    examples = build_examples(rows, cache)
    train = [e for e in examples if e.split == "train"]
    test = [e for e in examples if e.split == "test"]
    say(f"    {len(FEATURE_NAMES)} features for {len(train)} train and {len(test)} test URLs")
    fit_rows = [e for e in train if not e.override]
    X_fit = np.array([e.features for e in fit_rows])
    y_fit = np.array([e.phishing for e in fit_rows])
    groups = np.array([e.domain for e in fit_rows])

    say("[4/6] Training (5-fold cross-validation on train, grouped by domain)")
    oof_fit = np.zeros(len(fit_rows))
    for fold, (a, b) in enumerate(GroupKFold(n_splits=5).split(X_fit, y_fit, groups), start=1):
        model = new_model().fit(X_fit[a], y_fit[a])
        oof_fit[b] = model.predict_proba(X_fit[b])[:, 1]
        fold_scores = np.round(oof_fit[b] * 100)
        m = threshold_metrics(y_fit[b], fold_scores, 50)
        say(f"    fold {fold}/5  precision {m.precision:.3f}  recall {m.recall:.3f}")
    oof_by_url = {e.url: p for e, p in zip(fit_rows, oof_fit)}
    oof_train = np.array([oof_by_url.get(e.url, 0.0) for e in train])
    y_train = np.array([e.phishing for e in train])
    up, down = tune_blend(train, y_train, oof_train)
    say(f"    blend tuned on train: the model adds up to +{up} points and removes up to -{down}")
    model = new_model().fit(X_fit, y_fit)

    say("[5/6] Evaluating on the TEST split")
    X_test = np.array([e.features for e in test])
    y_test = np.array([e.phishing for e in test])
    probabilities = model.predict_proba(X_test)[:, 1]
    rules = rule_scores(test)
    combined = combined_scores(test, probabilities, up, down)
    results = [
        approach("rules", y_test, rules),
        approach("model", y_test, np.round(probabilities * 100)),
        approach("combined", y_test, combined),
    ]
    official = [i for i, e in enumerate(test) if e.official and not e.phishing]
    allowlisted = [i for i, e in enumerate(test) if e.allowlisted and not e.phishing]
    confusion = [
        ConfusionCell(label=label, verdict=verdict, count=sum(
            1 for e, s in zip(test, combined) if e.phishing == (label == "phishing") and verdict_for(int(s)) == verdict
        ))
        for label in ("phishing", "legit") for verdict in ("safe", "suspicious", "fraud")
    ]
    eligible = [i for i, e in enumerate(test) if not e.override]
    importance = permutation_importance(model, X_test[eligible], y_test[eligible], scoring="roc_auc",
                                        n_repeats=5, random_state=SEED)
    order = np.argsort(importance.importances_mean)[::-1][:15]
    top_features = [
        FeatureImportance(feature=FEATURE_NAMES[i], en=feature_label(FEATURE_NAMES[i])[0],
                          ar=feature_label(FEATURE_NAMES[i])[1],
                          importance=round(float(importance.importances_mean[i]), 4))
        for i in order
    ]

    say("[6/6] Saving the model")
    seconds = round(time.monotonic() - started, 1)
    info = ModelInfo(
        available=True,
        algorithm=ALGORITHM,
        trained_at=datetime.now(timezone.utc),
        training_seconds=seconds,
        feature_count=len(FEATURE_NAMES),
        datasets=[
            DatasetSplit(split=s, phishing=sum(1 for e in group if e.phishing),
                         legit=sum(1 for e in group if not e.phishing))
            for s, group in (("train", train), ("test", test))
        ],
        metrics=results,
        confusion=confusion,
        official_false_positives=sum(1 for i in official if combined[i] >= SUSPICIOUS_MIN),
        official_checked=len(official),
        allowlist_false_positives=sum(1 for i in allowlisted if combined[i] >= SUSPICIOUS_MIN),
        allowlist_checked=len(allowlisted),
        model_weight_max=up,
        model_weight_min=-down,
        top_features=top_features,
    )
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "feature_names": FEATURE_NAMES, "blend": {"up": up, "down": down},
                 "sklearn": sklearn.__version__}, MODEL_FILE, compress=3)
    METRICS_FILE.write_text(info.model_dump_json(indent=2) + "\n", encoding="utf-8")
    say(f"    {MODEL_FILE.relative_to(ROOT).as_posix()} and {METRICS_FILE.relative_to(ROOT).as_posix()}")

    say()
    say("Results on the TEST split (never used for training or tuning)")
    say(f"    {'approach':10} {'threshold':>10} {'precision':>10} {'recall':>8} {'F1':>7} {'FP':>5} {'FN':>5}")
    for result in results:
        for m, name in ((result.fraud, "fraud>=70"), (result.flagged, "flag>=30")):
            say(f"    {result.approach:10} {name:>10} {m.precision:10.3f} {m.recall:8.3f} {m.f1:7.3f} "
                f"{m.fp:5} {m.fn:5}")
    say(f"    official domains flagged: {info.official_false_positives} of {info.official_checked}   "
        f"allowlisted (incl. Tranco top) flagged: {info.allowlist_false_positives} of {info.allowlist_checked}")
    say("    top features: " + ", ".join(f.feature for f in top_features[:5]))
    say(f"Done in {seconds} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
