"""Deterministic recommendations; all savings use saved activity factors."""

from .calculations import estimate_savings

ACTION_CATALOG = [
    {"id": "transit", "title": "Replace one car trip with transit", "category": "transport", "fraction": 0.5, "cost": "Low", "difficulty": "Easy", "advice": "Try a bus or rail trip for a short journey you already make."},
    {"id": "walk-bike", "title": "Walk or cycle a short journey", "category": "transport", "fraction": 0.8, "cost": "Low", "difficulty": "Easy", "advice": "Choose one safe, nearby journey to make without a vehicle."},
    {"id": "car-share", "title": "Share a regular car journey", "category": "transport", "fraction": 0.4, "cost": "Low", "difficulty": "Easy", "advice": "Coordinate a shared ride for a regular commute or errand."},
    {"id": "electricity", "title": "Reduce avoidable electricity use", "category": "electricity", "fraction": 0.1, "cost": "Low", "difficulty": "Easy", "advice": "Switch off idle devices and adjust cooling or heating by one degree."},
    {"id": "food-waste", "title": "Plan meals to avoid food waste", "category": "waste", "fraction": 0.5, "cost": "Low", "difficulty": "Moderate", "advice": "Plan meals, store food well, and use leftovers before shopping."},
    {"id": "fuel", "title": "Avoid one non-transport fuel use", "category": "fuel", "fraction": 0.1, "cost": "Low", "difficulty": "Moderate", "advice": "Check for efficient settings and reduce unnecessary burner or generator use."},
    {"id": "waste-sort", "title": "Separate recyclable waste", "category": "waste", "fraction": 0.25, "cost": "Low", "difficulty": "Easy", "advice": "Separate paper and recyclable materials according to local collection rules."},
]


def get_recommendations(activities):
    ranked = []
    for action in ACTION_CATALOG:
        matching = [item for item in activities if item["category"] == action["category"]]
        savings = sum(estimate_savings(item, action["fraction"]) for item in matching)
        if savings <= 0:
            continue
        ranked.append({
            **action,
            "estimated_savings_kg_co2e": round(savings, 3),
            "basis": f"{action['fraction']:.0%} reduction applied to matching recorded "
            "emissions using each record's saved factor snapshot.",
            "is_estimate": True,
        })
    return sorted(ranked, key=lambda item: (-item["estimated_savings_kg_co2e"], item["cost"], item["difficulty"]))
