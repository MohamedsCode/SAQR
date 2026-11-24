# Working on SAQR without breaking it

Read this before changing anything. SAQR has a live website, a Chrome extension, a trained AI model and police
evidence reports that all depend on each other. Most breakages come from changing one side of a connection and not
the other. If a change touches anything in the "do not touch" lists below, ask the project owner first.

## 1. The live system: do not interrupt it

- The public website is **https://saqr-nu.vercel.app/** (Vercel, configured by `vercel.json`). Only the citizen
  page (`/check`) is live. `/` redirects there, and only `/api/health`, `/api/brands`, `/api/check` and `/api/report`
  are forwarded to the server.
- Those requests go through a temporary Cloudflare tunnel (`*.trycloudflare.com` in `vercel.json`) to a demo
  server running **on the project owner's laptop** (port 8787). If that laptop sleeps, shuts down or goes offline,
  the website stops checking links. Do not stop that server or the tunnel.
- If the tunnel restarts, its address changes: update the four addresses in `vercel.json` and redeploy, or the
  site breaks.
- **Do not edit `vercel.json`** unless you are moving the server. A wrong rewrite takes the live site down.

## 2. Website and extension: UI changes only

Changes to `web/` and to the extension's look (`extension/src/Warning.tsx`, `styles.css`, `i18n.ts`) must be purely
visual: layout, styling, colours, wording, images, animation. **Do not change how they talk to the server:**

- API calls, paths, request bodies, headers or response handling: `web/src/api.ts`,
  `web/src/pages/citizen/api.ts`, `extension/src/background.ts`, `extension/src/messages.ts`.
- `web/vite.config.ts` (the `/api` proxy and the `@shared` alias), environment variables, base addresses.
- Routes and links people share: `/check`, `/check?url=...`. Existing links in messages must keep working.
- The extension's `public/manifest.json` permissions and its server address (see section 7).

## 3. The data contract: change both sides or neither

`shared/contract.py` (server) and `shared/contract.ts` (website, extension) describe every request and response.
They must always match; `tests/test_contract.py` fails if they don't.

- **Never rename or remove a field or an endpoint.** The website and extension read them by name. Only *add* new
  optional fields, in both files at the same time.
- The verdict thresholds (`SUSPICIOUS_MIN = 30`, `FRAUD_MIN = 70`) are in both files and drive the colours, the
  extension's popups and the evaluation. Don't change them.
- These server endpoints are used by the website and extension and must keep their path, method and shape:
  `/api/check`, `/api/scan`, `/api/report`, `/api/brands`, `/api/health`, `/api/stats`, `/api/scans`,
  `/api/scans/{id}` (with `/evidence.json`, `/evidence.pdf`, `/screenshot/{kind}`), `/api/model` and
  `/api/model/retrain` (with `/stream`), `/api/discovery/run`, `/api/discovery/runs/{id}`, `/api/maps-sweep` (and
  `/run`), `/api/graph`, `/api/demo/reset`.

## 4. The AI model: it is tied to its features

`engine/model/saqr_model.joblib` was trained on exactly the features in `engine/ml/features.py`, with
`scikit-learn==1.9.1`.

- **Do not change `engine/ml/features.py`** without retraining (`python -m engine.ml.train`). If the feature list
  changes, the saved model is silently ignored and the "AI model" reason disappears from every result.
- **Do not upgrade scikit-learn** in `requirements.txt` without retraining. A model saved by one version may not
  load in another.
- **Weights in `engine/config/signals.json` feed the model too.** After changing a weight or a hosting list,
  retrain, re-run `python -m engine.cli evaluate --input data/datasets/labeled.csv --split test`, and update the
  accuracy numbers in `README.md` from `engine/model/metrics.json`.
- Never tune anything on the test split. Tuning uses the train split only; the test split is for reporting.
- Official domains (`OFFICIAL_DOMAIN`, `GOV_AE_DOMAIN`) always score 0 and the model never runs on them. Don't
  weaken that: flagging a real bank or government site is the worst possible error.

## 5. Brand library and allowlists

- `shared/brands.json`: every official domain and helpline number must come from the institution's own website,
  with its `source_url`. Only numbers actually read on that page may be `verified: true`; tests enforce it.
  Never invent or guess a number or domain.
- `data/allowlist/official_uae.txt` is generated from `brands.json`: run `python scripts/build_allowlist.py` after
  editing brands. Don't edit it by hand; a test checks they match.
- A platform's own website is not "free hosting": only its user subdomains are (see `free_hosting_match` in
  `engine/brands.py`).

## 6. Never commit

- `.env` or any key (Google Places, SerpAPI, Anthropic).
- `data/runtime/` and `data/datasets/`: they contain **live phishing URLs**, scan screenshots and databases.
- `node_modules/`, `web/dist/`, `extension/dist/`.
- Never open phishing links from the dataset in a normal browser. Only SAQR's scanner should visit them.

## 7. Releasing the Chrome extension

The extension currently calls `http://localhost:8000/api`, which only works on a computer running the server. For
a release, point `API` in `extension/src/background.ts` and `host_permissions` in `extension/public/manifest.json`
at `https://saqr-nu.vercel.app/api` (only `/api/check` is needed), run `npm run build` in `extension/`, zip the
*contents* of `extension/dist/` as `SAQR-Chrome.zip`, and attach it to a GitHub Release so the README's download
link works.

## 8. Before you push

```bash
python -m pytest -q                       # all tests must pass (no internet needed)
python -m pytest -q evidence/test_pdf.py  # evidence report tests
cd web && npx tsc --noEmit && cd ..       # website type check
cd extension && npm run build && cd ..    # extension builds
git pull --rebase                         # someone else may have pushed
```

Local ports: 8000 (API), 5173 (website), 5175 (extension preview), 8081 (demo scam page). **8787 is the live demo
server: leave it alone.**
