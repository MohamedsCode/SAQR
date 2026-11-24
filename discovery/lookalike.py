"""Generate look-alike candidates for an official domain, the way dnstwist does."""

from __future__ import annotations

from engine.brands import SIGNALS

KEYBOARD = {
    "q": "wa", "w": "qes", "e": "wrd", "r": "etf", "t": "ryg", "y": "tuh", "u": "yij", "i": "uok", "o": "ipl",
    "p": "ol", "a": "qsz", "s": "awdz", "d": "sefx", "f": "drgc", "g": "fthv", "h": "gyjb", "j": "hukn",
    "k": "jilm", "l": "kop", "z": "asx", "x": "zsdc", "c": "xdfv", "v": "cfgb", "b": "vghn", "n": "bhjm",
    "m": "njk",
}
LATIN_LOOKALIKES = {"l": ["1", "i"], "i": ["1", "l"], "o": ["0"], "e": ["3"], "a": ["4"], "s": ["5"], "m": ["rn"],
                    "w": ["vv"], "d": ["cl"], "b": ["8"], "g": ["9"], "t": ["7"]}
CYRILLIC = {"a": "а", "e": "е", "o": "о", "p": "р", "c": "с", "y": "у", "x": "х", "i": "і", "s": "ѕ", "j": "ј"}
BAIT_AFFIXES = ["pay", "fine", "fines", "ae", "uae", "online", "portal", "verify", "gov", "services", "secure",
                "login", "update", "refund", "track", "support"]
SWAP_TLDS = ["com", "net", "org", "info", "co"]


def _edits(label: str) -> set[str]:
    out: set[str] = set()
    for i in range(len(label)):
        out.add(label[:i] + label[i + 1:])  # omission
        out.add(label[:i] + label[i] + label[i:])  # repetition
        if i < len(label) - 1:
            out.add(label[:i] + label[i + 1] + label[i] + label[i + 2:])  # transposition
            out.add(label[:i + 1] + "-" + label[i + 1:])  # hyphenation
        for ch in KEYBOARD.get(label[i], ""):
            out.add(label[:i] + ch + label[i + 1:])  # replacement (adjacent key)
        for swap in LATIN_LOOKALIKES.get(label[i], []):
            out.add(label[:i] + swap + label[i + 1:])  # digit / letter swap
        if label[i] in CYRILLIC:
            out.add(label[:i] + CYRILLIC[label[i]] + label[i + 1:])  # homoglyph (Cyrillic)
    out.discard(label)
    return {c for c in out if c and not c.startswith("-") and not c.endswith("-")}


def generate(official_domain: str) -> set[str]:
    """Candidate look-alike domains for one official registered domain (e.g. 'salik.ae')."""
    label, _, suffix = official_domain.partition(".")
    candidates: set[str] = set()
    for variant in _edits(label):
        candidates.add(f"{variant}.{suffix}")
        candidates.add(f"{variant}.com")
    for bait in BAIT_AFFIXES:
        candidates.add(f"{label}-{bait}.com")
        candidates.add(f"{bait}-{label}.com")
        candidates.add(f"{label}{bait}.com")
    for tld in SWAP_TLDS + SIGNALS["risky_tlds"][:12]:
        if tld != suffix:
            candidates.add(f"{label}.{tld}")
    candidates.discard(official_domain)
    return candidates
