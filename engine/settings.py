"""Settings read from the environment, with an optional .env file in the repo root."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED_DIR = ROOT / "shared"
FIXTURES_DIR = ROOT / "data" / "fixtures"
RUNTIME_DIR = ROOT / "data" / "runtime"


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str
    llm_model: str
    google_places_api_key: str
    serpapi_key: str
    database_url: str
    scan_timeout_s: float
    page_concurrency: int
    allow_localhost_demo: bool
    web_origin: str


def load_settings() -> Settings:
    _load_dotenv(ROOT / ".env")
    return Settings(
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        llm_model=os.getenv("LLM_MODEL", ""),
        google_places_api_key=os.getenv("GOOGLE_PLACES_API_KEY", ""),
        serpapi_key=os.getenv("SERPAPI_KEY", ""),
        database_url=os.getenv("DATABASE_URL", f"sqlite:///{(RUNTIME_DIR / 'saqr.db').as_posix()}"),
        scan_timeout_s=float(os.getenv("SCAN_TIMEOUT_S", "10")),
        page_concurrency=int(os.getenv("PAGE_CONCURRENCY", "8")),
        allow_localhost_demo=_flag("ALLOW_LOCALHOST_DEMO", False),
        web_origin=os.getenv("WEB_ORIGIN", "http://localhost:5173"),
    )


settings = load_settings()
