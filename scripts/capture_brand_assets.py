"""Capture each brand's favicon and a reference screenshot of its official site.

Writes shared/brand_assets/<brand_id>/favicon.<ext> and reference.png, then records the paths in
shared/brands.json. Brands without a reference_url are skipped.

Usage: python scripts/capture_brand_assets.py [brand_id ...]
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urljoin

from playwright.async_api import Browser, async_playwright

ROOT = Path(__file__).resolve().parent.parent
BRANDS_FILE = ROOT / "shared" / "brands.json"
ASSETS_DIR = ROOT / "shared" / "brand_assets"
VIEWPORT = {"width": 1366, "height": 768}
BLOCK_MARKERS = ["access denied", "you have been blocked", "performing security verification",
                 "verify you are human", "just a moment", "attention required", "request unsuccessful",
                 "coming back soon", "under maintenance", "temporarily unavailable"]
ICON_EXTENSIONS = {"image/png": "png", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
                   "image/svg+xml": "svg", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}


async def capture(browser: Browser, brand: dict) -> None:
    out_dir = ASSETS_DIR / brand["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    context = await browser.new_context(viewport=VIEWPORT, locale="en-US", timezone_id="Asia/Dubai")
    page = await context.new_page()
    try:
        await page.goto(brand["reference_url"], wait_until="domcontentloaded", timeout=45_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass  # busy sites never go idle; the DOM is loaded, which is enough for a screenshot
        text = (await page.inner_text("body", timeout=5_000)).lower()[:3000]
        blocked = next((m for m in BLOCK_MARKERS if m in text), None)
        if blocked:
            raise RuntimeError(f"got a bot-block or maintenance page (\"{blocked}\"), not the real site")
        screenshot = out_dir / "reference.png"
        await page.screenshot(path=screenshot)
        brand["reference_screenshot_path"] = screenshot.relative_to(ROOT).as_posix()

        href = await page.evaluate(
            """() => {
                const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')];
                return links.length ? links[0].getAttribute('href') : null;
            }"""
        )
        icon_url = urljoin(page.url, href or "/favicon.ico")
        response = await context.request.get(icon_url, timeout=20_000)
        if response.ok:
            content_type = response.headers.get("content-type", "").split(";")[0].strip()
            ext = ICON_EXTENSIONS.get(content_type, Path(icon_url.split("?")[0]).suffix.lstrip(".") or "ico")
            favicon = out_dir / f"favicon.{ext}"
            favicon.write_bytes(await response.body())
            brand["favicon_path"] = favicon.relative_to(ROOT).as_posix()
        print(f"ok    {brand['id']:13} {page.url}")
    except Exception as exc:
        manual = out_dir / "reference.png"
        if manual.is_file():
            brand["reference_screenshot_path"] = manual.relative_to(ROOT).as_posix()
            print(f"kept  {brand['id']:13} existing {manual.relative_to(ROOT).as_posix()} (live capture failed)")
        else:
            print(f"FAIL  {brand['id']:13} {brand['reference_url']}: {exc}")
    finally:
        await context.close()


async def main(only: set[str]) -> None:
    brands = json.loads(BRANDS_FILE.read_text(encoding="utf-8"))
    targets = [b for b in brands if b.get("reference_url") and (not only or b["id"] in only)]
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for brand in targets:
            await capture(browser, brand)
        await browser.close()
    BRANDS_FILE.write_text(json.dumps(brands, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main(set(sys.argv[1:])))
