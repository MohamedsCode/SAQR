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

## Brand library and allowlist

`shared/brands.json` covers 16 UAE institutions. Every official domain and helpline number was read from the
institution's own website, and each number records the `source_url` of the page that publishes it. A number is
`verified: true` only when it was read on that official page; unconfirmed numbers stay `verified: false` and are
never used to clear a site or a number. `tests/test_brands.py` enforces that every verified number cites a page
on that brand's own domain.

```bash
python scripts/capture_brand_assets.py       # favicons + reference screenshots -> shared/brand_assets/
python scripts/build_allowlist.py data/runtime/tranco/top-1m.csv   # official domains + Tranco top 10,000
```

Only official brand domains and registered domains under `.gov.ae` are treated as verified official sites.
A Tranco top-10,000 domain only lowers the score (it is never an override), and gets no credit at all on
free hosting, tunnels, URL shorteners, or when the subdomain or path impersonates a brand. The free-hosting,
tunnel and shortener lists live in `engine/config/signals.json`.

## Detection engine

`POST /api/scan` and the CLI run the same pipeline:

1. **Normalize** whatever was pasted: no scheme, upper case, surrounding punctuation, defanged forms (`hxxp`,
   `[.]`, `(.)`, `[dot]`), a URL inside a longer message, and Unicode (IDN) hosts, which are converted to punycode.
2. **URL signals** (work even when the site is offline): official-domain and `.gov.ae` override; brand names in the
   domain, subdomain or path; the official domain used as a disguise (`tamm.abudhabi.evil-site.com`); look-alikes
   by character swaps (`sa1ik`), misspellings and homoglyphs from other alphabets; bait words; risky TLDs; IP hosts,
   `@` tricks, deep subdomains, long URLs, odd ports; free hosting and URL shorteners; Tranco popularity credit.
3. **Network lookups**, run in parallel within a 10-second budget and cached in SQLite: the HTTP redirect chain
   (every hop is checked and private network addresses are refused), DNS, RDAP domain age, registrar and abuse
   contact, the first certificate in crt.sh, and IP to ASN through Team Cymru's DNS service. When a link redirects
   to another domain, the landing domain is scored too.
4. **Live page** (Layer B): headless Chromium visits the page twice, as desktop Chrome and as Safari on an iPhone
   with the `ar-AE` locale and Dubai time zone, recording each redirect chain (including JavaScript redirects).
   - **Cloaking:** flagged when the two visits end on different sites, only one of them gets the page, or the
     content differs strongly.
   - **Forms:** fields asking for card number, expiry, CVV, OTP, password, Emirates ID or IBAN are detected in
     English and Arabic (رقم البطاقة، تاريخ الانتهاء، الرمز السري، رمز التحقق، رقم الهوية الإماراتية), as well as
     forms that post to another website.
   - **Content:** brand names, urgency language and payment requests in both languages.
   - **Visual similarity:** a perceptual-hash comparison of the screenshot and favicon against each brand's
     reference images.
   - **Contacts and evidence:** phone numbers (E.164), WhatsApp links and emails on the page. Screenshots and
     HTML are saved under `data/runtime/evidence/<case id>/` with SHA-256 hashes; every request the browser
     makes passes the same private-address guard.
5. **Scoring**: a transparent weighted sum (weights in `engine/config/signals.json`), clamped to 0-100.
   Every signal becomes a reason in English and Arabic with its weight and evidence. Below 30 is safe, 30-69
   suspicious, 70 or more fraud. Summaries come from templates, or from the LLM when `ANTHROPIC_API_KEY` and
   `LLM_MODEL` are set.

```bash
python -m engine.cli scan --input urls.txt --output results.csv            # txt or csv, one URL per line
python -m engine.cli evaluate --input data/datasets/labeled.csv --split test
```

`--mode url` scores from the address alone with no network access, `network` (the CLI default) adds the
lookups, and `full` (the API default) also visits the page. `BROWSER_ENABLED=false` turns the page visits off.

### Evaluation data

On Windows, `powershell -ExecutionPolicy Bypass -File scripts\setup_data.ps1` runs every download and build step
below (plus the brand-asset capture) and prints a summary of what succeeded. The individual commands:

```powershell
New-Item -ItemType Directory -Force data\runtime\feeds | Out-Null
Invoke-WebRequest https://openphish.com/feed.txt -OutFile data\runtime\feeds\openphish.txt
Invoke-WebRequest https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-links-ACTIVE.txt -OutFile data\runtime\feeds\phishing-links-ACTIVE.txt
python scripts/build_dataset.py --openphish data/runtime/feeds/openphish.txt --phishdb data/runtime/feeds/phishing-links-ACTIVE.txt --tranco data/runtime/tranco/top-1m.csv
python -m engine.cli evaluate --input data/datasets/labeled.csv --split train --sweep
```

The dataset mixes phishing URLs from OpenPhish and Phishing.Database, generated UAE look-alike URLs, Tranco top
sites, `.ae` sites from deeper in Tranco, and every official brand domain. It is split 70/30 into train and test
by registered domain. Weights are tuned on the train split only, and results are reported on test.
