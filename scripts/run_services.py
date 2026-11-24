"""Start the API and the web app together; Ctrl+C stops both.

Usage: python scripts/run_services.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    npm = shutil.which("npm")
    if not npm:
        print("npm was not found on PATH. Install Node.js 20+ and run 'npm install' in web/.")
        return 1
    commands = {
        "api": [sys.executable, "-m", "uvicorn", "engine.app:app", "--reload", "--port", "8000"],
        "web": [npm, "run", "dev"],
    }
    processes = {
        "api": subprocess.Popen(commands["api"], cwd=ROOT),
        "web": subprocess.Popen(commands["web"], cwd=ROOT / "web"),
    }
    print("API: http://localhost:8000/docs   Web: http://localhost:5173   (Ctrl+C to stop)")
    exit_code = 0
    try:
        while True:
            stopped = [name for name, p in processes.items() if p.poll() is not None]
            if stopped:
                print(f"{', '.join(stopped)} stopped unexpectedly; shutting down.")
                exit_code = 1
                break
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes.values():
            if process.poll() is None:
                process.terminate()
        for process in processes.values():
            process.wait()
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
