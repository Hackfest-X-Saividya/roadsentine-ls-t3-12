"""Deterministic recommendation engine; all savings use calculated factors."""

from __future__ import annotations

from typing import Any

from .calculations import calculate_emissions, validate_activity, validate_factors


def build_recommendations(
    records: list[dict[str, Any]],
    custom_factors: Any = None,
    profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    profile = profile or {}
    factors = validate_factors(custom_factors)
    fields = {
        "date", "vehicleType", "vehicleFuel", "vehicleDistance", "busDistance",
        "railDistance", "electricityKwh", "petrolLitres", "dieselLitres",
        "lpgKg", "otherFuelLitres", "foodWasteKg", "paperWasteKg",
        "plasticWasteKg", "otherWasteKg", "foodEmissionsKg",
    }
    normalized = [
        validate_activity({key: value for key, value in record.items() if key in fields})
        for record in records[-7:]
    ]
    if not normalized:
        return []
    activity_factors = [
        validate_factors(record.get("factors") or {
            key: factor.value for key, factor in factors.items()
        })
        for record in records[-7:]
    ]
    averages = {field: sum(record[field] for record in normalized) / len(normalized) for field in (
        "vehicleDistance", "busDistance", "railDistance", "electricityKwh",
        "petrolLitres", "dieselLitres", "lpgKg", "otherFuelLitres",
        "foodWasteKg", "paperWasteKg", "plasticWasteKg", "otherWasteKg",
        "foodEmissionsKg",
    )}
    daily = {
        key: sum(
            calculate_emissions(record, {
                factor_key: factor.value for factor_key, factor in record_factors.items()
            })["categories"][key]
            for record, record_factors in zip(normalized, activity_factors)
        ) / len(normalized)
        for key in ("transport", "electricity", "fuel", "waste", "food")
    }
    options: list[dict[str, Any]] = []

    def add(
        action_id: str,
        category: str,
        title: str,
        rationale: str,
        daily_saving: float,
        impact: str,
        cost: str,
        difficulty: str,
        method: str,
    ) -> None:
        if daily_saving <= 0.005:
            return
        options.append({
            "id": action_id,
            "category": category,
            "title": title,
            "rationale": rationale,
            "estimatedDailySavingsKgCo2e": round(daily_saving, 4),
            "estimatedWeeklySavingsKgCo2e": round(daily_saving * 7, 4),
            "impact": impact,
            "cost": cost,
            "difficulty": difficulty,
            "calculation": method,
            "estimateOnly": True,
        })

    fossil_emissions = 0.0
    fossil_rail_emissions = 0.0
    fossil_distance = 0.0
    average_vehicle_emissions = 0.0
    for record, record_factors in zip(normalized, activity_factors):
        vehicle_factor_key = (
            record["vehicleType"] if record["vehicleType"] in {"electricCar", "motorcycle", "active", "auto"}
            else record["vehicleFuel"] + "Car"
        )
        average_vehicle_emissions += (
            record["vehicleDistance"] * record_factors[vehicle_factor_key].value / len(normalized)
        )
        if record["vehicleType"] in {"petrolCar", "dieselCar"}:
            factor_key = record["vehicleFuel"] + "Car"
            fossil_distance += record["vehicleDistance"] / len(normalized)
            fossil_emissions += record["vehicleDistance"] * record_factors[factor_key].value / len(normalized)
            fossil_rail_emissions += record["vehicleDistance"] * record_factors["rail"].value / len(normalized)
    if fossil_distance:
        weighted_factor = fossil_emissions / fossil_distance
        weighted_rail_factor = fossil_rail_emissions / fossil_distance
        location = profile.get("location", "").strip()
        location_hint = f" Check whether rail service is available near {location}." if location else ""
        add(
            "transit-swap", "transport", "Swap one short car trip for rail",
            "Shift a small share of fossil-fuel car travel to rail where practical.",
            fossil_emissions * 0.2 * max(0.0, 1 - weighted_rail_factor / weighted_factor)
            if weighted_factor else 0.0,
            "High", "Low cost", "Moderate",
            f"20% of {fossil_distance:.2f} km/day from car factor {weighted_factor:.4f} "
            f"to rail factor {weighted_rail_factor:.4f} kg CO2e/passenger-km.{location_hint}",
        )

    add(
        "carpool", "transport", "Combine errands or carpool",
        "Reduce personal-vehicle kilometres through trip combining or sharing.",
        average_vehicle_emissions * 0.15,
        "Medium", "Free", "Easy",
        f"15% of recent average personal-vehicle emissions ({average_vehicle_emissions:.4f} kg CO2e/day).",
    )
    if daily["electricity"]:
        add(
            "electricity-trim", "electricity", "Trim electricity use by 10%",
            "Review cooling, standby power, and lighting habits.",
            daily["electricity"] * 0.1, "High" if daily["electricity"] > sum(daily.values()) * 0.3 else "Medium",
            "Free", "Easy",
            f"10% × recent factor-weighted electricity emissions "
            f"({daily['electricity']:.4f} kg CO2e/day across "
            f"{averages['electricityKwh']:.3f} kWh/day).",
        )
    if daily["food"]:
        add(
            "food-choice", "food", "Choose a lower-impact meal",
            "Try a plant-forward option for one meal where it suits your needs.",
            daily["food"] * 0.2,
            "Medium", "Free", "Easy",
            "Illustrative scenario: 20% of the recent food footprint estimate; "
            "the estimate is not a measured reduction.",
        )
    if daily["fuel"]:
        add(
            "fuel-efficiency", "fuel", "Reduce non-transport fuel use by 10%",
            "Check burner maintenance and avoid unnecessary heating or cooking fuel use.",
            daily["fuel"] * 0.1, "High" if daily["fuel"] > sum(daily.values()) * 0.3 else "Medium",
            "Free", "Easy", f"10% × {daily['fuel']:.4f} kg CO2e/day non-transport fuel.",
        )
    if averages["foodWasteKg"]:
        average_food_waste_emissions = sum(
            record["foodWasteKg"] * record_factors["foodWaste"].value / len(normalized)
            for record, record_factors in zip(normalized, activity_factors)
        )
        add(
            "food-waste", "waste", "Prevent one quarter of food waste",
            "Plan meals and store leftovers to prevent avoidable food waste.",
            average_food_waste_emissions * 0.25,
            "Medium", "Free", "Easy",
            f"25% of recent average food-waste emissions ({average_food_waste_emissions:.4f} kg CO2e/day; provisional disposal factors).",
        )
    recyclable_emissions = (
        sum(
            record["plasticWasteKg"] * record_factors["plasticWaste"].value / len(normalized)
            + record["otherWasteKg"] * record_factors["otherWaste"].value / len(normalized)
            for record, record_factors in zip(normalized, activity_factors)
        )
    )
    if recyclable_emissions:
        add(
            "waste-sort", "waste", "Sort recyclable waste locally",
            "If accepted by your local collection service, separate recyclables.",
            recyclable_emissions * 0.2, "Low", "Free", "Easy",
            "20% planning scenario on plastic and other mixed waste; actual "
            "avoidance depends on locally available treatment pathways.",
        )

    preferences = str(profile.get("preferences", "")).lower()
    prefers_easy = any(value in preferences for value in ("low-effort", "low effort", "simple", "easy", "busy"))
    prefers_transit = any(value in preferences for value in ("public transit", "public transport", "bus", "rail", "metro"))
    budget = profile.get("budget", "any")
    impact_rank = {"High": 3, "Medium": 2, "Low": 1}
    cost_rank = {"Free": 2, "Low cost": 1, "Any": 0}
    difficulty_rank = {"Easy": 3, "Moderate": 2, "Hard": 1}

    def rank(item: dict[str, Any]) -> tuple[int, int, int, int, float]:
        budget_fit = int(budget == "free" and item["cost"] == "Free")
        preference_fit = int(prefers_easy and item["difficulty"] == "Easy") + 2 * int(
            prefers_transit and item["id"] == "transit-swap"
        )
        return (
            preference_fit,
            budget_fit,
            impact_rank[item["impact"]],
            cost_rank[item["cost"]] + difficulty_rank[item["difficulty"]],
            item["estimatedWeeklySavingsKgCo2e"],
        )

    options.sort(key=rank, reverse=True)
    return options
