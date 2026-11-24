"""Turn whatever a user pastes into one canonical URL plus its parsed parts.

Accepts URLs with or without a scheme, upper case, surrounding whitespace and punctuation, defanged forms
(hxxp, [.], (.), [dot], {.}, [:]), URLs inside a longer message, and Unicode (IDN) hosts.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

import idna
import tldextract

_extract = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)

_REFANG = [
    (re.compile(r"h(?:xx|\*\*|XX)p(s?)", re.I), r"http\1"),
    (re.compile(r"\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}", re.I), "."),
    (re.compile(r"\[\s*:\s*\]"), ":"),
    (re.compile(r"\[\s*/\s*\]"), "/"),
]
_SCHEME_URL = re.compile(r"(?i)\bhttps?://[^\s<>\"'`]+")
_HOSTLIKE = re.compile(
    r"(?i)(?<![@\w.-])((?:[\w¡-￿-]+\.)+[\w¡-￿-]{2,}(?::\d{1,5})?(?:[/?#][^\s<>\"'`]*)?)"
)
_TRAILING = ".,;:!?'\"»”’)]}>"
_DEFAULT_PORTS = {"http": 80, "https": 443}


class InvalidInput(ValueError):
    """The input does not contain anything that looks like a URL or domain."""


@dataclass(frozen=True)
class NormalizedUrl:
    input: str
    url: str
    scheme: str
    host: str
    host_unicode: str
    port: int | None
    path: str
    query: str
    registered_domain: str
    domain_label: str
    subdomain: str
    suffix: str
    is_ip: bool
    has_userinfo: bool
    had_scheme: bool

    @property
    def is_idn(self) -> bool:
        return "xn--" in self.host


def refang(text: str) -> str:
    for pattern, replacement in _REFANG:
        text = pattern.sub(replacement, text)
    return text


def _strip_trailing(candidate: str) -> str:
    while candidate and candidate[-1] in _TRAILING:
        closer = candidate[-1]
        opener = {")": "(", "]": "[", "}": "{"}.get(closer)
        if opener and candidate.count(opener) >= candidate.count(closer):
            break
        candidate = candidate[:-1]
    return candidate


def _has_valid_suffix(host: str) -> bool:
    host = host.split(":")[0].strip(".")
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    try:
        ascii_host = idna.encode(host, uts46=True).decode("ascii")
    except idna.IDNAError:
        return False
    return ascii_host.endswith(".localhost") or bool(_extract(ascii_host).suffix)


def find_candidate(text: str) -> tuple[str, bool]:
    """Return (candidate URL text, whether it had an explicit scheme)."""
    text = refang(text.strip())
    match = _SCHEME_URL.search(text)
    if match:
        return _strip_trailing(match.group(0)), True
    for match in _HOSTLIKE.finditer(text):
        candidate = _strip_trailing(match.group(1))
        if _has_valid_suffix(re.split(r"[/?#]", candidate, maxsplit=1)[0]):
            return candidate, False
    raise InvalidInput("No URL or domain found in the input.")


def _encode_host(host: str) -> tuple[str, str]:
    host = host.strip(".").lower()
    try:
        ascii_host = idna.encode(host, uts46=True).decode("ascii")
    except idna.IDNAError:
        ascii_host = host.encode("idna").decode("ascii")
    try:
        unicode_host = idna.decode(ascii_host)
    except idna.IDNAError:
        unicode_host = host
    return ascii_host, unicode_host


def normalize(text: str) -> NormalizedUrl:
    if not text or not text.strip():
        raise InvalidInput("Empty input.")
    candidate, had_scheme = find_candidate(text[:8192])
    parts = urlsplit(candidate if had_scheme else f"https://{candidate}")
    scheme = parts.scheme.lower() or "https"
    raw_host = parts.hostname or ""
    if not raw_host:
        raise InvalidInput("The URL has no host.")
    try:
        port = parts.port
    except ValueError:
        port = None
    host, host_unicode = _encode_host(raw_host)

    is_ip = False
    try:
        ipaddress.ip_address(host.strip("[]"))
        is_ip = True
    except ValueError:
        pass

    if is_ip:
        registered, domain_label, subdomain, suffix = host, host, "", ""
    elif host.endswith(".localhost"):
        labels = host.removesuffix(".localhost").split(".")
        registered, domain_label = f"{labels[-1]}.localhost", labels[-1]
        subdomain, suffix = ".".join(labels[:-1]), "localhost"
    else:
        ext = _extract(host)
        if not ext.suffix or not ext.domain:
            raise InvalidInput("The host has no valid public suffix.")
        registered = f"{ext.domain}.{ext.suffix}"
        domain_label, subdomain, suffix = ext.domain, ext.subdomain, ext.suffix

    if port in (None, _DEFAULT_PORTS.get(scheme)):
        port = None
    netloc = host if port is None else f"{host}:{port}"
    path = parts.path or "/"
    url = urlunsplit((scheme, netloc, path, parts.query, ""))
    return NormalizedUrl(
        input=text,
        url=url,
        scheme=scheme,
        host=host,
        host_unicode=host_unicode,
        port=port,
        path=path,
        query=parts.query,
        registered_domain=registered,
        domain_label=domain_label,
        subdomain=subdomain,
        suffix=suffix,
        is_ip=is_ip,
        has_userinfo=bool(parts.username or parts.password or "@" in parts.netloc),
        had_scheme=had_scheme,
    )
