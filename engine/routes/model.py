"""AI model page: test-split results of the last training run, and retraining with a live log."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from engine.ml import model
from engine.settings import ROOT
from shared.contract import ModelInfo, TrainingRun

router = APIRouter()


class Trainer:
    """Runs `python -m engine.ml.train` in a subprocess and keeps its output, one run at a time."""

    def __init__(self) -> None:
        self.command = [sys.executable, "-m", "engine.ml.train"]
        self.run: TrainingRun | None = None
        self._lock = threading.Lock()

    def start(self) -> TrainingRun:
        with self._lock:
            if self.run and self.run.status == "running":
                raise RuntimeError("A training run is already in progress.")
            self.run = TrainingRun(id=uuid.uuid4().hex[:12], status="running",
                                   started_at=datetime.now(timezone.utc))
        threading.Thread(target=self._work, args=(self.run,), daemon=True).start()
        return self.run

    def _work(self, run: TrainingRun) -> None:
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
        try:
            process = subprocess.Popen(self.command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            for line in process.stdout:
                run.lines.append(line.rstrip())
            code = process.wait()
        except OSError as exc:
            run.lines.append(f"Could not start training: {exc}")
            code = 1
        run.finished_at = datetime.now(timezone.utc)
        run.status = "done" if code == 0 else "failed"


trainer = Trainer()


def _current_run() -> TrainingRun:
    if trainer.run is None:
        raise HTTPException(status_code=404, detail="No training run yet.")
    return trainer.run


@router.get("/model", response_model=ModelInfo)
def model_info() -> ModelInfo:
    data = model.metrics()
    return ModelInfo.model_validate(data) if data else ModelInfo(available=False)


@router.post("/model/retrain", response_model=TrainingRun)
def retrain() -> TrainingRun:
    try:
        return trainer.start()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/model/retrain", response_model=TrainingRun)
def retrain_status() -> TrainingRun:
    return _current_run()


@router.get("/model/retrain/stream")
async def retrain_stream() -> StreamingResponse:
    """Server-sent events: one `data:` event per log line, then `event: done` with the final status."""
    run = _current_run()

    async def events():
        sent = 0
        while True:
            while sent < len(run.lines):
                yield f"data: {run.lines[sent]}\n\n"
                sent += 1
            if run.status != "running" and sent >= len(run.lines):
                yield f"event: done\ndata: {run.status}\n\n"
                return
            await asyncio.sleep(0.3)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
