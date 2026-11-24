"""Keep the public SAQR demo online: restart the server or the tunnel when they stop working.

The live website (Vercel) forwards /api to a Cloudflare quick tunnel on this laptop, which forwards to the demo
server on port 8787. Every 20 seconds this checks both. A dead server is restarted. A dead tunnel is restarted, and
because a quick tunnel gets a new address each time, the new address is written into vercel.json on the GitHub repo
Vercel deploys from, which redeploys the site.

Run with pythonw (no window): .venv\\Scripts\\pythonw.exe scripts\\keep_live.py
Log: data/runtime/hosting/keep_live.log
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "data" / "runtime" / "hosting"
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
CLOUDFLARED = RUNTIME / "cloudflared.exe"
TUNNEL_LOG = RUNTIME / "tunnel.log"
LOG = RUNTIME / "keep_live.log"
LOCK = RUNTIME / "keep_live.pid"
DEPLOY_REPO = "MohamedsCode/SAQR"  # the repo Vercel deploys saqr-nu.vercel.app from
PORT = 8787
CHECK_EVERY = 20
NO_WINDOW = 0x08000000
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def log(message: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S}  {message}"
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def healthy(url: str, timeout: float = 12) -> bool:
    try:
        return httpx.get(url, timeout=timeout).status_code == 200
    except httpx.HTTPError:
        return False


def run(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True, creationflags=NO_WINDOW).stdout


def kill_tree(pid: int) -> None:
    run("taskkill", "/PID", str(pid), "/T", "/F")


def pid_on_port(port: int) -> int | None:
    for line in run("netstat", "-ano", "-p", "TCP").splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[1].endswith(f":{port}") and parts[3] == "LISTENING":
            return int(parts[4])
    return None


def tunnel_pids() -> list[int]:
    out = run("tasklist", "/FI", "IMAGENAME eq cloudflared.exe", "/FO", "CSV", "/NH")
    return [int(row.split('","')[1]) for row in out.splitlines() if row.startswith('"cloudflared.exe"')]


def start_server() -> None:
    env = {**os.environ, "ALLOW_LOCALHOST_DEMO": "false", "ANTHROPIC_API_KEY": " ",
           "DATABASE_URL": "sqlite:///" + (RUNTIME / "public-demo.db").as_posix()}
    out = (RUNTIME / "api.log").open("a", encoding="utf-8")
    err = (RUNTIME / "api-error.log").open("a", encoding="utf-8")
    subprocess.Popen([str(PYTHON), "-m", "uvicorn", "scripts.public_demo:app", "--host", "127.0.0.1",
                      "--port", str(PORT), "--limit-concurrency", "24"],
                     cwd=ROOT, env=env, stdout=out, stderr=err, creationflags=NO_WINDOW)


def current_tunnel_url() -> str | None:
    if not TUNNEL_LOG.is_file():
        return None
    found = URL_RE.findall(TUNNEL_LOG.read_text(encoding="utf-8", errors="replace"))
    return found[-1] if found else None


def start_tunnel() -> str | None:
    TUNNEL_LOG.write_text("", encoding="utf-8")
    err = TUNNEL_LOG.open("a", encoding="utf-8")
    subprocess.Popen([str(CLOUDFLARED), "tunnel", "--url", f"http://127.0.0.1:{PORT}", "--protocol", "http2"],
                     cwd=ROOT, stdout=err, stderr=err, creationflags=NO_WINDOW)
    for _ in range(60):
        time.sleep(1)
        url = current_tunnel_url()
        if url:
            return url
    return None


def point_vercel_at(new_url: str) -> None:
    """Replace the tunnel address in vercel.json on the deploy repo; Vercel redeploys from it."""
    meta = json.loads(run("gh", "api", f"repos/{DEPLOY_REPO}/contents/vercel.json?ref=master"))
    text = base64.b64decode(meta["content"]).decode("utf-8")
    updated = URL_RE.sub(new_url, text)
    if updated == text:
        return
    out = subprocess.run(
        ["gh", "api", "-X", "PUT", f"repos/{DEPLOY_REPO}/contents/vercel.json",
         "-f", "message=Point the live site at the restarted demo tunnel",
         "-f", "content=" + base64.b64encode(updated.encode("utf-8")).decode("ascii"),
         "-f", f"sha={meta['sha']}", "-f", "branch=master"],
        capture_output=True, text=True, creationflags=NO_WINDOW)
    log("vercel.json updated on GitHub" if out.returncode == 0 else f"vercel.json update FAILED: {out.stderr[:300]}")


def single_instance() -> bool:
    if LOCK.is_file():
        try:
            old = int(LOCK.read_text())
            if str(old) in run("tasklist", "/FI", f"PID eq {old}", "/NH"):
                return False
        except ValueError:
            pass
    LOCK.write_text(str(os.getpid()))
    return True


def main() -> int:
    if not single_instance():
        return 0
    log("watchdog started")
    server_fails = tunnel_fails = 0
    while True:
        if healthy(f"http://127.0.0.1:{PORT}/api/health", timeout=8):
            server_fails = 0
        else:
            server_fails += 1
            if server_fails >= 3:
                pid = pid_on_port(PORT)
                if pid:
                    kill_tree(pid)
                log("server not answering: restarting it")
                start_server()
                time.sleep(15)
                server_fails = 0
                continue

        url = current_tunnel_url()
        if tunnel_pids() and url and healthy(f"{url}/api/health"):
            tunnel_fails = 0
        else:
            tunnel_fails += 1
            # a running tunnel reconnects by itself; give it about two minutes before replacing it
            if not tunnel_pids() or tunnel_fails >= 6:
                for pid in tunnel_pids():
                    kill_tree(pid)
                log("tunnel down: restarting it")
                new_url = start_tunnel()
                if new_url:
                    log(f"new tunnel address {new_url}")
                    if new_url != url:
                        point_vercel_at(new_url)
                else:
                    log("tunnel did not report an address; will retry")
                tunnel_fails = 0
        time.sleep(CHECK_EVERY)


if __name__ == "__main__":
    sys.exit(main())
