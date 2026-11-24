"""SQLite storage: scan results and a TTL cache for network lookups."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete
from sqlmodel import Field, Session, SQLModel, create_engine, select

from engine.settings import ROOT, settings
from shared.contract import ScanResult


class ScanRow(SQLModel, table=True):
    id: str = Field(primary_key=True)
    registered_domain: str = Field(index=True)
    verdict: str = Field(index=True)
    scanned_at: datetime = Field(index=True)
    data: str


class CacheRow(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
    expires_at: datetime


def _make_engine():
    url = settings.database_url
    if url.startswith("sqlite:///") and not url.startswith("sqlite:///:memory:"):
        path = Path(url.removeprefix("sqlite:///"))
        if not path.is_absolute():
            path = ROOT / path
            url = f"sqlite:///{path.as_posix()}"
        path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    return engine


engine = _make_engine()


def save_scan(scan: ScanResult) -> None:
    row = ScanRow(
        id=scan.id,
        registered_domain=scan.registered_domain,
        verdict=scan.verdict,
        scanned_at=scan.scanned_at,
        data=scan.model_dump_json(),
    )
    with Session(engine) as session:
        session.merge(row)
        session.commit()


def load_scans() -> list[ScanResult]:
    with Session(engine) as session:
        rows = session.exec(select(ScanRow)).all()
    return [ScanResult.model_validate_json(row.data) for row in rows]


def clear_scans() -> None:
    with Session(engine) as session:
        session.exec(delete(ScanRow))
        session.commit()


def cache_get(key: str) -> object | None:
    with Session(engine) as session:
        row = session.get(CacheRow, key)
    if row is None:
        return None
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None
    return json.loads(row.value)


def cache_set(key: str, value: object, ttl: timedelta) -> None:
    row = CacheRow(key=key, value=json.dumps(value, default=str), expires_at=datetime.now(timezone.utc) + ttl)
    with Session(engine) as session:
        session.merge(row)
        session.commit()
