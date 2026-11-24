.PHONY: install dev test build

install:
	python3.12 -m venv .venv
	.venv/bin/pip install -r requirements.txt
	.venv/bin/playwright install chromium
	cd web && npm install

dev:
	.venv/bin/python scripts/run_services.py

test:
	.venv/bin/python -m pytest -q

build:
	cd web && npm run build
