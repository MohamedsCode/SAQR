"""Optional LLM rewrite of the summary into plain English and Arabic. Falls back to None on any problem."""

from __future__ import annotations

import json

from engine.settings import settings
from shared.contract import Reason

PROMPT = """You explain website risk checks to members of the public in the UAE.
Verdict: {verdict} (score {score}/100). Impersonated brand: {brand}.
Evidence, strongest first:
{reasons}

Write a plain-language summary of two short sentences: what this site appears to be and what the reader should do.
Use only the evidence above; do not add facts. Reply with JSON only: {{"en": "...", "ar": "..."}} where "ar" is
natural Modern Standard Arabic."""


def enabled() -> bool:
    return bool(settings.anthropic_api_key and settings.llm_model)


async def summarise(verdict: str, score: int, brand: str | None, reasons: list[Reason]) -> tuple[str, str] | None:
    if not enabled():
        return None
    from anthropic import AsyncAnthropic

    lines = "\n".join(f"- {r.en} ({r.evidence})" if r.evidence else f"- {r.en}" for r in reasons[:6])
    client = AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=8.0, max_retries=0)
    try:
        message = await client.messages.create(
            model=settings.llm_model,
            max_tokens=400,
            messages=[{"role": "user", "content": PROMPT.format(
                verdict=verdict, score=score, brand=brand or "none", reasons=lines)}],
        )
        text = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
        data = json.loads(text[text.index("{"): text.rindex("}") + 1])
        en, ar = str(data["en"]).strip(), str(data["ar"]).strip()
    except Exception:
        return None
    return (en, ar) if en and ar else None
