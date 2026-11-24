"""Headless Chromium visits for Layer B: one desktop Chrome visit and one iPhone Safari visit (ar-AE, Dubai)."""

from __future__ import annotations

import asyncio
from urllib.parse import urlsplit

from engine import net
from engine.page_analysis import Capture
from engine.settings import settings

DESKTOP = {
    "user_agent": net.DESKTOP_UA,
    "viewport": {"width": 1366, "height": 768},
    "locale": "en-US",
    "timezone_id": "Asia/Dubai",
    "extra_http_headers": {"Accept-Language": "en-US,en;q=0.9"},
}
IPHONE = {
    "user_agent": ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 "
                   "(KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"),
    "viewport": {"width": 390, "height": 844},
    "device_scale_factor": 2,
    "is_mobile": True,
    "has_touch": True,
    "locale": "ar-AE",
    "timezone_id": "Asia/Dubai",
    "extra_http_headers": {"Accept-Language": "ar-AE,ar;q=0.9,en;q=0.8"},
}
HIDE_AUTOMATION = "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
EXTRACT = """() => {
  const labelOf = el => {
    let text = '';
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) text += l.innerText + ' '; }
    const wrap = el.closest('label'); if (wrap) text += wrap.innerText + ' ';
    const prev = el.previousElementSibling;
    if (prev && prev.innerText && prev.innerText.length < 80) text += prev.innerText;
    return text.trim().slice(0, 120);
  };
  const field = el => ({name: el.name || '', id: el.id || '', type: (el.type || el.tagName).toLowerCase(),
    placeholder: el.placeholder || '', label: labelOf(el), autocomplete: el.autocomplete || '',
    aria: el.getAttribute('aria-label') || ''});
  const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox])' +
              ':not([type=radio]):not([type=image]), select, textarea';
  const forms = [...document.forms].map(f => ({action: f.action || '', method: (f.method || 'get').toLowerCase(),
    fields: [...f.querySelectorAll(sel)].map(field)}));
  const loose = [...document.querySelectorAll(sel)].filter(e => !e.form).map(field);
  if (loose.length) forms.push({action: '', method: '', fields: loose});
  const links = [...document.querySelectorAll('a[href^="tel:"], a[href*="wa.me/"], a[href*="api.whatsapp.com"], ' +
    'a[href^="mailto:"]')].map(a => a.href).slice(0, 50);
  const icon = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  return {forms, links, icon: icon ? icon.href : null, title: document.title || '',
          text: document.body ? document.body.innerText.slice(0, 20000) : ''};
}"""


class BrowserPool:
    """One shared Chromium process, started on first use."""

    def __init__(self) -> None:
        self._playwright = None
        self._browser = None
        self._lock = asyncio.Lock()

    async def browser(self):
        async with self._lock:
            if self._browser is None or not self._browser.is_connected():
                from playwright.async_api import async_playwright

                self._playwright = await async_playwright().start()
                self._browser = await self._playwright.chromium.launch(
                    args=["--disable-blink-features=AutomationControlled"])
            return self._browser

    async def close(self) -> None:
        async with self._lock:
            if self._browser:
                await self._browser.close()
            if self._playwright:
                await self._playwright.stop()
            self._browser = self._playwright = None


pool = BrowserPool()
_pages = asyncio.Semaphore(settings.page_concurrency)


async def visit(url: str, profile: str, timeout_s: float, allow_localhost: bool = False) -> Capture:
    options = DESKTOP if profile == "desktop" else IPHONE
    capture = Capture(profile=profile, ok=False)
    checked: dict[str, bool] = {}

    async def guard(route):
        parts = urlsplit(route.request.url)
        if parts.scheme in ("data", "blob"):
            await route.continue_()
            return
        host = parts.hostname or ""
        if parts.scheme not in ("http", "https") or not host:
            await route.abort()
            return
        if host not in checked:
            checked[host] = await net.is_public_host(host, allow_localhost)
        await (route.continue_() if checked[host] else route.abort("blockedbyclient"))

    async with _pages:
        try:
            browser = await pool.browser()
        except Exception as exc:
            capture.error = f"Browser unavailable: {type(exc).__name__}"
            return capture
        await _capture(browser, url, options, capture, guard, timeout_s, allow_localhost)
    return capture


async def _capture(browser, url: str, options: dict, capture: Capture, guard, timeout_s: float,
                   allow_localhost: bool) -> None:
    context = await browser.new_context(ignore_https_errors=True, accept_downloads=False, **options)
    try:
        await context.add_init_script(HIDE_AUTOMATION)
        await context.route("**/*", guard)
        page = await context.new_page()
        navigations: list[str] = []
        page.on("framenavigated", lambda frame: frame == page.main_frame and navigations.append(frame.url))
        response = await page.goto(url, wait_until="domcontentloaded", timeout=max(1000, timeout_s * 1000 - 1500))
        try:
            await page.wait_for_load_state("networkidle", timeout=2000)
        except Exception:
            pass  # pages that keep polling never go idle; the DOM is already there
        await page.wait_for_timeout(500)

        redirects: list[str] = []
        request = response.request if response else None
        while request is not None:
            redirects.insert(0, request.url)
            request = request.redirected_from
        chain: list[str] = []
        for item in redirects + navigations + [page.url]:
            if item and item != "about:blank" and (not chain or chain[-1] != item):
                chain.append(item)

        data = await page.evaluate(EXTRACT)
        capture.status = response.status if response else None
        capture.final_url = page.url
        capture.chain = chain
        capture.title = data["title"]
        capture.text = data["text"]
        capture.forms = data["forms"]
        capture.links = data["links"]
        capture.html = await page.content()
        capture.screenshot = await page.screenshot(type="png")
        icon_url = data["icon"] or f"{urlsplit(page.url).scheme}://{urlsplit(page.url).netloc}/favicon.ico"
        if await net.is_public_host(urlsplit(icon_url).hostname or "", allow_localhost):
            try:
                icon = await context.request.get(icon_url, timeout=3000)
                if icon.ok:
                    capture.favicon = await icon.body()
            except Exception:
                pass  # no favicon is not an error
        capture.ok = capture.status is None or capture.status < 400
        if not capture.ok:
            capture.error = f"HTTP {capture.status}"
    except Exception as exc:
        capture.error = type(exc).__name__
    finally:
        await context.close()


async def visit_both(url: str, timeout_s: float, allow_localhost: bool = False) -> tuple[Capture, Capture]:
    desktop, mobile = await asyncio.gather(
        visit(url, "desktop", timeout_s, allow_localhost),
        visit(url, "mobile", timeout_s, allow_localhost),
    )
    return desktop, mobile
