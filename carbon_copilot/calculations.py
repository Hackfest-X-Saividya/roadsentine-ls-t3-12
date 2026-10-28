"""Transparent, configurable activity-to-emissions calculations."""

from copy import deepcopy
from datetime import date
import math


FACTOR_SOURCE = (
    "Provisional illustrative factors assembled for this demo; not an authoritative "
    "inventory. Replace with locally applicable, documented factors before formal reporting."
)
FACTOR_GEOGRAPHY = "Generalized global estimate"
FACTOR_YEAR = 2024

# Units are kg CO2e per activity unit. Vehicle factors are distance-based and do
# not include a separate fuel calculation. The EV factor includes a charging proxy.
DEFAULT_FACTORS = {
    "transport": {
        "car_petrol": {"value": 0.192, "unit": "kg CO2e/km", "label": "Petrol car"},
        "car_diesel": {"value": 0.171, "unit": "kg CO2e/km", "label": "Diesel car"},
        "car_hybrid": {"value": 0.120, "unit": "kg CO2e/km", "label": "Hybrid car"},
        "car_electric": {"value": 0.050, "unit": "kg CO2e/km", "label": "Electric car (charging proxy included)"},
        "motorcycle": {"value": 0.103, "unit": "kg CO2e/km", "label": "Motorcycle"},
        "bus": {"value": 0.105, "unit": "kg CO2e/km", "label": "Bus"},
        "rail": {"value": 0.041, "unit": "kg CO2e/km", "label": "Rail"},
    },
    "electricity": {
        "electricity": {"value": 0.400, "unit": "kg CO2e/kWh", "label": "Grid electricity"}
    },
    "fuel": {
        "petrol": {"value": 2.31, "unit": "kg CO2e/L", "label": "Petrol (non-transport)"},
        "diesel": {"value": 2.68, "unit": "kg CO2e/L", "label": "Diesel (non-transport)"},
        "lpg": {"value": 1.51, "unit": "kg CO2e/L", "label": "LPG (non-transport)"},
        "other": {"value": 1.00, "unit": "kg CO2e/L", "label": "Other non-transport fuel"},
    },
    "waste": {
        "food": {"value": 0.500, "unit": "kg CO2e/kg", "label": "Food waste"},
        "paper": {"value": 0.900, "unit": "kg CO2e/kg", "label": "Paper waste"},
        "plastic": {"value": 2.000, "unit": "kg CO2e/kg", "label": "Plastic waste"},
        "other": {"value": 0.800, "unit": "kg CO2e/kg", "label": "Other waste"},
    },
}

ACTIVITY_LIMITS = {
    "transport": (0.01, 10000, "km"),
    "electricity": (0.01, 100000, "kWh"),
    "fuel": (0.01, 10000, "L"),
    "waste": (0.01, 10000, "kg"),
}
ALLOWED_SUBCATEGORIES = {key: set(value) for key, value in {
    "transport": DEFAULT_FACTORS["transport"],
    "electricity": DEFAULT_FACTORS["electricity"],
    "fuel": DEFAULT_FACTORS["fuel"],
    "waste": DEFAULT_FACTORS["waste"],
}.items()}


def validate_factors(factors):
    if not isinstance(factors, dict):
        raise ValueError("Emission factors must be an object.")
    for category, values in DEFAULT_FACTORS.items():
        if category not in factors or not isinstance(factors[category], dict):
            raise ValueError(f"Missing factors for {category}.")
        for subcategory, defaults in values.items():
            item = factors[category].get(subcategory)
            if not isinstance(item, dict):
                raise ValueError(f"Missing factor for {subcategory}.")
            value = item.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"Invalid factor for {subcategory}.")
            if not math.isfinite(value) or value <= 0 or value > 10000:
                raise ValueError(f"Factor for {subcategory} must be between 0 and 10000.")
            if item.get("unit") != defaults["unit"]:
                raise ValueError(f"Factor unit for {subcategory} must be {defaults['unit']}.")
    return deepcopy(factors)


def factor_snapshot(factors=None, source=None, geography=None, year=None):
    return {
        "factors": deepcopy(factors or DEFAULT_FACTORS),
        "source": source or FACTOR_SOURCE,
        "geography": geography or FACTOR_GEOGRAPHY,
        "year": year or FACTOR_YEAR,
        "boundary": "Direct activity estimate; transport distance factors are mode-based. "
        "Electric-car factor includes a charging proxy. Non-transport fuel is separate.",
        "assumptions": "Average-use estimates; actual results vary by location, vehicle, "
        "energy mix, occupancy, and waste treatment.",
        "provisional": True,
    }


def validate_activity(data):
    if not isinstance(data, dict):
        raise ValueError("Activity must be a JSON object.")
    category = data.get("category")
    subcategory = data.get("subcategory")
    if category not in ALLOWED_SUBCATEGORIES:
        raise ValueError("Choose a supported activity category.")
    if subcategory not in ALLOWED_SUBCATEGORIES[category]:
        raise ValueError("Choose a supported activity type for this category.")
    quantity = data.get("quantity")
    if isinstance(quantity, bool) or not isinstance(quantity, (int, float)):
        raise ValueError("Quantity must be a number.")
    minimum, maximum, unit = ACTIVITY_LIMITS[category]
    if not math.isfinite(quantity) or quantity < minimum or quantity > maximum:
        raise ValueError(f"Quantity must be between {minimum:g} and {maximum:g} {unit}.")
    activity_date = data.get("date")
    try:
        parsed_date = date.fromisoformat(activity_date)
    except (TypeError, ValueError):
        raise ValueError("Date must be a valid YYYY-MM-DD date.") from None
    if parsed_date > date.today():
        raise ValueError("Activity date cannot be in the future.")
    note = data.get("note", "")
    if not isinstance(note, str) or len(note) > 240:
        raise ValueError("Note must be 240 characters or fewer.")
    ev_charging = data.get("ev_charging_kwh", 0)
    if category == "electricity":
        if isinstance(ev_charging, bool) or not isinstance(ev_charging, (int, float)):
            raise ValueError("EV charging electricity must be a number.")
        if not math.isfinite(ev_charging) or ev_charging < 0 or ev_charging > quantity:
            raise ValueError("EV charging electricity must be between zero and total electricity.")
    elif ev_charging not in (None, 0):
        raise ValueError("EV charging electricity can only be recorded with electricity.")
    activity = {
        "category": category,
        "subcategory": subcategory,
        "quantity": float(quantity),
        "unit": unit,
        "date": activity_date,
        "note": note.strip(),
    }
    if category == "electricity":
        activity["ev_charging_kwh"] = float(ev_charging)
    return activity


def calculate_activity(activity, snapshot=None):
    snapshot = snapshot or factor_snapshot()
    factors = validate_factors(snapshot.get("factors"))
    category = activity["category"]
    subcategory = activity["subcategory"]
    factor = factors[category][subcategory]
    quantity = float(activity["quantity"])
    calculation_quantity = quantity
    if category == "electricity":
        calculation_quantity -= float(activity.get("ev_charging_kwh", 0))
    return {
        "kg_co2e": round(calculation_quantity * factor["value"], 4),
        "factor": factor["value"],
        "factor_unit": factor["unit"],
        "factor_label": factor["label"],
        "source": snapshot["source"],
        "geography": snapshot["geography"],
        "year": snapshot["year"],
        "boundary": snapshot["boundary"],
        "assumptions": snapshot["assumptions"],
        "provisional": snapshot["provisional"],
        "calculation": (
            f"({quantity:g} {activity['unit']} total − "
            f"{float(activity.get('ev_charging_kwh', 0)):g} kWh EV charging) × "
            f"{factor['value']:g} {factor['unit']} = {calculation_quantity * factor['value']:.4f} kg CO2e"
            if category == "electricity" and activity.get("ev_charging_kwh", 0)
            else f"{quantity:g} {activity['unit']} × {factor['value']:g} {factor['unit']} = "
            f"{calculation_quantity * factor['value']:.4f} kg CO2e"
        ),
    }


def estimate_savings(activity, reduction_fraction):
    """Use the record's saved factors rather than the current factor table."""
    snapshot = activity.get("factor_snapshot") or factor_snapshot()
    actual = calculate_activity(activity, snapshot)
    fraction = min(max(float(reduction_fraction), 0.0), 1.0)
    return round(actual["kg_co2e"] * fraction, 4)
