# SAQR (صقر)

**We go after what scammers publish.**

SAQR discovers, scores, explains and documents fraudulent websites, look-alike domains and fake helpline
numbers that impersonate UAE institutions, and produces police-ready evidence. It only analyses public URLs,
public listings and numbers that users choose to check. It never listens to calls or reads private messages.

> Status: project skeleton. The API serves fixture data from `data/fixtures/`; the detection engine,
> discovery monitors and evidence packs are being added.

The product name and tagline live in `shared/brand_config.json`.

## Layout

| Folder | Contents |
|---|---|
| `engine/` | FastAPI app (`/api/*`), settings, store |
| `discovery/` | Discovery, helpline sweep and campaign graph endpoints |
| `shared/` | Data contract (`contract.py`, mirrored in `contract.ts`), brand list, product config |
| `data/fixtures/` | Sample scan results and simulated Maps listings |
| `web/` | React + Vite + Tailwind dashboard and citizen portal (English / Arabic, RTL) |
| `tests/` | pytest suite (no network) |

## Run locally

Requirements: Python 3.12, Node.js 20+.

```bash
py -3.12 -m venv .venv            # macOS/Linux: python3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cd web && npm install && cd ..
cp .env.example .env    # optional: every key is optional

npm run dev             # or: python scripts/run_services.py   (make dev on macOS/Linux)
```

- Web app: http://localhost:5173
- API docs: http://localhost:8000/docs

Run the tests with `npm test` (or `python -m pytest`).
