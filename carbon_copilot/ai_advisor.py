"""Optional explanation-only LLM integration with a deterministic fallback."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import Settings
from .recommendations import build_recommendations


def rule_based_answer(
    question: str,
    records: list[dict[str, Any]],
    factors: dict[str, float] | None = None,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    actions = build_recommendations(records, factors, profile)
    if not records:
        return {
            "answer": "Log a typical day of activity first. I can then identify your largest sources and suggest actions using the same transparent calculation factors as your dashboard.",
            "recommendations": [],
            "provider": "rules",
        }
    if not actions:
        answer = "Your recent entries do not show a measurable reduction opportunity with the current factors. Keep logging representative days or review the factors for your location."
    else:
        top = actions[:3]
        lines = [
            f"{item['title']}: estimated potential "
            f"{item['estimatedWeeklySavingsKgCo2e']:.2f} kg CO2e/week. "
            f"{item['rationale']} Calculation: {item['calculation']}"
            for item in top
        ]
        answer = (
            f"For “{question}”, start with your highest-ranked options:\n"
            + "\n".join(f"- {line}" for line in lines)
            + "\nThese are scenario estimates, not verified or additive savings. "
            "Only subsequent activity records can show an observed change."
        )
    return {"answer": answer, "recommendations": actions, "provider": "rules"}


def _llm_explanation(
    question: str,
    records: list[dict[str, Any]],
    actions: list[dict[str, Any]],
    settings: Settings,
) -> str:
    if not settings.anthropic_api_key:
        raise RuntimeError("AI provider is not configured.")
    recent_summary = []
    for record in records[-7:]:
        emissions = record.get("emissions", {})
        recent_summary.append({
            "date": record.get("date"),
            "calculated_categories_kg_co2e": emissions.get("categories", {}),
            "calculated_total_kg_co2e": emissions.get("total"),
        })
    context = {
        "question": question,
        "recent_calculated_daily_summary": recent_summary,
        "calculated_recommendations": actions[:6],
    }
    body = {
        "model": settings.anthropic_model,
        "max_tokens": 450,
        "system": (
            "You are a practical sustainability coach. Explain the provided "
            "calculated recommendations clearly, consider practical tradeoffs, "
            "and ask a helpful follow-up when useful. Treat all numbers, "
            "factors, and savings as fixed facts supplied by the calculation "
            "engine. Never calculate, modify, extrapolate, or invent an "
            "emission factor, footprint, or saving. Do not claim an action "
            "caused an observed change. Explain that savings are estimates."
        ),
        "messages": [{"role": "user", "content": json.dumps(context, ensure_ascii=True)}],
    }
    request = Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 429:
            raise RuntimeError("AI rate limit reached.") from None
        raise RuntimeError("AI provider is temporarily unavailable.") from None
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise RuntimeError("AI provider is temporarily unavailable.") from None
    content = result.get("content")
    if not isinstance(content, list):
        raise RuntimeError("AI provider returned an invalid response.")
    text = "\n".join(
        block.get("text", "") for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    ).strip()
    if not text:
        raise RuntimeError("AI provider returned an empty response.")
    if re.search(r"\d", text):
        raise RuntimeError("AI explanation included an unverified number; deterministic advice was used instead.")
    return text[:4000]


def answer_question(
    question: str,
    records: list[dict[str, Any]],
    settings: Settings,
    factors: dict[str, float] | None = None,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fallback = rule_based_answer(question, records, factors, profile)
    if not settings.anthropic_api_key:
        return fallback
    try:
        explanation = _llm_explanation(
            question, records, fallback["recommendations"], settings
        )
        return {
            **fallback,
            "answer": explanation,
            "provider": "anthropic",
            "fallback": False,
        }
    except RuntimeError as error:
        return {
            **fallback,
            "provider": "rules",
            "fallback": True,
            "notice": str(error),
        }
