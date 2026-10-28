import re

import requests


def ask_advisor(question, recommendations, api_key="", model="claude-3-5-haiku-latest"):
    deterministic = (
        "Here are practical next steps based on your recorded activities: "
        + ("; ".join(item["title"] + f" (estimated {item['estimated_savings_kg_co2e']} kg CO2e)"
                     for item in recommendations[:3]) or
           "Add a few dated activities to get personalized guidance.")
        + ". Savings are estimates, not measured reductions."
    )
    if not api_key:
        return {"answer": deterministic, "mode": "deterministic", "ai_available": False}
    supplied_guidance = [
        {
            "title": item["title"],
            "advice": item["advice"],
            "cost": item["cost"],
            "difficulty": item["difficulty"],
        }
        for item in recommendations[:5]
    ]
    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 400,
                "system": "Personalize practical sustainability advice using only supplied recommendations. "
                "Never calculate or invent emissions factors, savings, measurements, percentages, or quantities. "
                "Do not include digits or number words in the answer.",
                "messages": [{
                    "role": "user",
                    "content": f"Question: {question}\nAvailable guidance: {supplied_guidance}",
                }],
            },
            timeout=12,
        )
        response.raise_for_status()
        content = response.json().get("content", [])
        answer = " ".join(block.get("text", "") for block in content if block.get("type") == "text").strip()
        if not answer:
            raise ValueError("AI returned no answer.")
        if re.search(
            r"\d|%|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|"
            r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|"
            r"nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|"
            r"hundred|thousand|million)\b",
            answer,
            flags=re.IGNORECASE,
        ):
            raise ValueError("AI answer included unsupported numeric claims.")
        return {"answer": answer, "mode": "ai-assisted", "ai_available": True}
    except (requests.RequestException, ValueError, KeyError) as error:
        status = getattr(getattr(error, "response", None), "status_code", None)
        if status == 429:
            reason = "rate limited"
        elif isinstance(error, ValueError) and "numeric claims" in str(error):
            reason = "returned unsupported numeric claims"
        else:
            reason = "unavailable"
        return {
            "answer": deterministic,
            "mode": "deterministic-fallback",
            "ai_available": False,
            "notice": f"AI advisor is {reason}; showing deterministic guidance.",
        }
