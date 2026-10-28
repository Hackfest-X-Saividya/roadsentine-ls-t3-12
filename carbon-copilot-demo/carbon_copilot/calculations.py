"""Transparent carbon calculations using explicitly provisional factor defaults."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
import math
import re
from typing import Any


@dataclass(frozen=True)
class EmissionFactor:
    key: str
    value: float
    unit: str
    source: str
    geography: str
    applicable_year: str
    boundary: str
    provisional: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _factor(
    key: str,
    value: float,
    unit: str,
    source: str,
    boundary: str,
    geography: str = "Illustrative; replace with local data",
    year: str = "2024 reference; confirm current edition",
) -> EmissionFactor:
    return EmissionFactor(key, value, unit, source, geography, year, boundary)


FACTOR_SOURCE_CEA = (
    "Central Electricity Authority, CO₂ Baseline Database "
    "(grid factor varies by location and version): "
    "https://cea.nic.in/cdm-co2-baseline-database/?lang=en"
)
FACTOR_SOURCE_GOV_UK = (
    "UK Government greenhouse gas conversion factors for company reporting "
    "(annual factors; confirm applicable edition): "
    "https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting"
)
PROVISIONAL_SOURCE = (
    "Provisional planning example only; no universal factor asserted. "
    "Replace with a cited local lifecycle/sector factor before formal reporting."
)

DEFAULT_FACTORS: dict[str, EmissionFactor] = {
    "electricity": _factor(
        "electricity", 0.716, "kg CO2e/kWh", FACTOR_SOURCE_CEA,
        "Purchased electricity generation; approximate grid-average proxy; "
        "excludes transmission losses unless included by selected source.",
        geography="India proxy; region/year-specific factor required",
    ),
    "petrolCar": _factor(
        "petrolCar", 0.192, "kg CO2e/vehicle-km", PROVISIONAL_SOURCE,
        "Provisional vehicle-use proxy; vehicle efficiency, occupancy and "
        "upstream fuel emissions are not consistently represented.",
    ),
    "dieselCar": _factor(
        "dieselCar", 0.171, "kg CO2e/vehicle-km", PROVISIONAL_SOURCE,
        "Provisional vehicle-use proxy; vehicle efficiency, occupancy and "
        "upstream fuel emissions are not consistently represented.",
    ),
    "electricCar": _factor(
        "electricCar", 0.053, "kg CO2e/vehicle-km", PROVISIONAL_SOURCE,
        "Provisional use-phase electricity proxy; grid, charging losses and "
        "vehicle efficiency vary; no vehicle manufacture.",
    ),
    "motorcycle": _factor(
        "motorcycle", 0.103, "kg CO2e/vehicle-km", PROVISIONAL_SOURCE,
        "Provisional vehicle-use proxy; size, efficiency and upstream fuel "
        "emissions vary.",
    ),
    "auto": _factor(
        "auto", 0.06, "kg CO2e/vehicle-km", PROVISIONAL_SOURCE,
        "Provisional auto-rickshaw passenger-use proxy; fuel, occupancy and "
        "vehicle efficiency vary by location.",
        geography="Illustrative South Asia-oriented proxy; confirm local data",
    ),
    "bus": _factor(
        "bus", 0.105, "kg CO2e/passenger-km", PROVISIONAL_SOURCE,
        "Provisional passenger allocation; occupancy and vehicle type vary.",
    ),
    "rail": _factor(
        "rail", 0.041, "kg CO2e/passenger-km", PROVISIONAL_SOURCE,
        "Provisional passenger allocation; grid and occupancy vary.",
    ),
    "active": _factor(
        "active", 0.0, "kg CO2e/km", PROVISIONAL_SOURCE,
        "Direct operational emissions only; excludes equipment, diet and "
        "infrastructure.",
    ),
    "petrol": _factor(
        "petrol", 2.31, "kg CO2e/litre", FACTOR_SOURCE_GOV_UK,
        "Approximate direct combustion; excludes complete upstream lifecycle.",
        geography="UK combustion reference; replace for local fuel specification",
    ),
    "diesel": _factor(
        "diesel", 2.68, "kg CO2e/litre", FACTOR_SOURCE_GOV_UK,
        "Approximate direct combustion; excludes complete upstream lifecycle.",
        geography="UK combustion reference; replace for local fuel specification",
    ),
    "lpg": _factor(
        "lpg", 3.0, "kg CO2e/kg", FACTOR_SOURCE_GOV_UK,
        "Approximate direct combustion; excludes complete upstream lifecycle.",
        geography="UK combustion reference; replace for local fuel specification",
    ),
    "otherFuel": _factor(
        "otherFuel", 2.5, "kg CO2e/litre", PROVISIONAL_SOURCE,
        "Placeholder for unspecified non-transport liquid fuel; direct "
        "combustion proxy only.",
    ),
    "foodWaste": _factor(
        "foodWaste", 2.5, "kg CO2e/kg", PROVISIONAL_SOURCE,
        "Provisional disposal-related placeholder; treatment pathway, "
        "composition and avoided production are excluded.",
    ),
    "paperWaste": _factor(
        "paperWaste", 1.0, "kg CO2e/kg", PROVISIONAL_SOURCE,
        "Provisional disposal-related placeholder; recycling/landfill "
        "pathway and lifecycle credits are not modeled.",
    ),
    "plasticWaste": _factor(
        "plasticWaste", 2.5, "kg CO2e/kg", PROVISIONAL_SOURCE,
        "Provisional disposal-related placeholder; composition and "
        "treatment pathway are not modeled.",
    ),
    "otherWaste": _factor(
        "otherWaste", 0.5, "kg CO2e/kg", PROVISIONAL_SOURCE,
        "Provisional disposal-related mixed-waste placeholder; composition "
        "and treatment pathway vary.",
    ),
}

ACTIVITY_LIMITS: dict[str, float] = {
    "vehicleDistance": 2000.0,
    "busDistance": 2000.0,
    "railDistance": 3000.0,
    "electricityKwh": 5000.0,
    "petrolLitres": 500.0,
    "dieselLitres": 500.0,
    "lpgKg": 500.0,
    "otherFuelLitres": 500.0,
    "foodWasteKg": 500.0,
    "paperWasteKg": 500.0,
    "plasticWasteKg": 500.0,
    "otherWasteKg": 500.0,
    "foodEmissionsKg": 500.0,
}
VEHICLE_TYPES = {"petrolCar", "dieselCar", "electricCar", "motorcycle", "auto", "active"}
ACTIVITY_FIELDS = set(ACTIVITY_LIMITS)
FACTOR_KEYS = set(DEFAULT_FACTORS)
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ValidationError(ValueError):
    """Invalid or out-of-range activity input."""


def validate_factors(custom: Any = None) -> dict[str, EmissionFactor]:
    if custom is None:
        return dict(DEFAULT_FACTORS)
    if not isinstance(custom, dict):
        raise ValidationError("factors must be a JSON object.")
    unknown = set(custom) - FACTOR_KEYS
    if unknown:
        raise ValidationError(f"Unknown emission factor(s): {', '.join(sorted(unknown))}.")
    factors = dict(DEFAULT_FACTORS)
    for key, raw_value in custom.items():
        if isinstance(raw_value, dict):
            raw_value = raw_value.get("value")
        if isinstance(raw_value, bool):
            raise ValidationError(f"Factor '{key}' must be a finite, non-negative number.")
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            raise ValidationError(f"Factor '{key}' must be a finite, non-negative number.") from None
        if not math.isfinite(value) or value < 0 or value > 10000:
            raise ValidationError(f"Factor '{key}' must be between 0 and 10000.")
        factors[key] = EmissionFactor(
            **{
                **asdict(DEFAULT_FACTORS[key]),
                "value": value,
                "source": "User-configured override; verify and document the cited source.",
                "geography": "User configured; not geographically validated",
                "applicable_year": "User configured; not independently verified",
            }
        )
    return factors


def validate_activity(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("Activity must be a JSON object.")
    unknown = set(payload) - ACTIVITY_FIELDS - {"date", "vehicleType", "vehicleFuel", "foodSource"}
    if unknown:
        raise ValidationError(f"Unknown activity field(s): {', '.join(sorted(unknown))}.")
    raw_date = payload.get("date")
    if not isinstance(raw_date, str) or not DATE_PATTERN.fullmatch(raw_date):
        raise ValidationError("date must use YYYY-MM-DD format.")
    try:
        parsed_date = date.fromisoformat(raw_date)
    except ValueError:
        raise ValidationError("date must be a real calendar date.") from None
    if parsed_date > date.today():
        raise ValidationError("Future activity dates are not allowed.")

    vehicle_type = payload.get("vehicleType", "petrolCar")
    if not isinstance(vehicle_type, str):
        raise ValidationError("vehicleType must be a supported vehicle type.")
    if vehicle_type not in VEHICLE_TYPES:
        raise ValidationError(f"vehicleType must be one of: {', '.join(sorted(VEHICLE_TYPES))}.")
    vehicle_fuel = payload.get("vehicleFuel", "petrol")
    if not isinstance(vehicle_fuel, str):
        raise ValidationError("vehicleFuel must be petrol or diesel.")
    if vehicle_fuel not in {"petrol", "diesel"}:
        raise ValidationError("vehicleFuel must be petrol or diesel.")

    result: dict[str, Any] = {
        "date": raw_date,
        "vehicleType": vehicle_type,
        "vehicleFuel": vehicle_fuel,
    }
    food_source = payload.get("foodSource", "home")
    if not isinstance(food_source, str) or food_source not in {"home", "delivery", "groceries"}:
        raise ValidationError("foodSource must be home, delivery, or groceries.")
    result["foodSource"] = food_source
    for field, maximum in ACTIVITY_LIMITS.items():
        raw_value = payload.get(field, 0)
        if isinstance(raw_value, bool):
            raise ValidationError(f"{field} must be a finite, non-negative number.")
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            raise ValidationError(f"{field} must be a finite, non-negative number.") from None
        if not math.isfinite(value) or value < 0 or value > maximum:
            raise ValidationError(f"{field} must be between 0 and {maximum:g}.")
        result[field] = value
    return result


def calculate_emissions(
    activity: Any, custom_factors: Any = None
) -> dict[str, Any]:
    entry = validate_activity(activity)
    factors = validate_factors(custom_factors)
    vehicle_factor_key = (
        entry["vehicleType"]
        if entry["vehicleType"] in {"electricCar", "motorcycle", "active", "auto"}
        else entry["vehicleFuel"] + "Car"
    )
    line_items = {
        "personalVehicle": {
            "quantity": entry["vehicleDistance"],
            "unit": "vehicle-km",
            "factor": factors[vehicle_factor_key].value,
            "factorKey": vehicle_factor_key,
            "kgCo2e": entry["vehicleDistance"] * factors[vehicle_factor_key].value,
        },
        "bus": {
            "quantity": entry["busDistance"],
            "unit": "passenger-km",
            "factor": factors["bus"].value,
            "factorKey": "bus",
            "kgCo2e": entry["busDistance"] * factors["bus"].value,
        },
        "rail": {
            "quantity": entry["railDistance"],
            "unit": "passenger-km",
            "factor": factors["rail"].value,
            "factorKey": "rail",
            "kgCo2e": entry["railDistance"] * factors["rail"].value,
        },
        "electricity": {
            "quantity": entry["electricityKwh"],
            "unit": "kWh",
            "factor": factors["electricity"].value,
            "factorKey": "electricity",
            "kgCo2e": entry["electricityKwh"] * factors["electricity"].value,
        },
        "petrol": {
            "quantity": entry["petrolLitres"],
            "unit": "litre non-transport",
            "factor": factors["petrol"].value,
            "factorKey": "petrol",
            "kgCo2e": entry["petrolLitres"] * factors["petrol"].value,
        },
        "diesel": {
            "quantity": entry["dieselLitres"],
            "unit": "litre non-transport",
            "factor": factors["diesel"].value,
            "factorKey": "diesel",
            "kgCo2e": entry["dieselLitres"] * factors["diesel"].value,
        },
        "lpg": {
            "quantity": entry["lpgKg"],
            "unit": "kg non-transport",
            "factor": factors["lpg"].value,
            "factorKey": "lpg",
            "kgCo2e": entry["lpgKg"] * factors["lpg"].value,
        },
        "otherFuel": {
            "quantity": entry["otherFuelLitres"],
            "unit": "litre non-transport",
            "factor": factors["otherFuel"].value,
            "factorKey": "otherFuel",
            "kgCo2e": entry["otherFuelLitres"] * factors["otherFuel"].value,
        },
        "foodWaste": {
            "quantity": entry["foodWasteKg"],
            "unit": "kg",
            "factor": factors["foodWaste"].value,
            "factorKey": "foodWaste",
            "kgCo2e": entry["foodWasteKg"] * factors["foodWaste"].value,
        },
        "paperWaste": {
            "quantity": entry["paperWasteKg"],
            "unit": "kg",
            "factor": factors["paperWaste"].value,
            "factorKey": "paperWaste",
            "kgCo2e": entry["paperWasteKg"] * factors["paperWaste"].value,
        },
        "plasticWaste": {
            "quantity": entry["plasticWasteKg"],
            "unit": "kg",
            "factor": factors["plasticWaste"].value,
            "factorKey": "plasticWaste",
            "kgCo2e": entry["plasticWasteKg"] * factors["plasticWaste"].value,
        },
        "otherWaste": {
            "quantity": entry["otherWasteKg"],
            "unit": "kg",
            "factor": factors["otherWaste"].value,
            "factorKey": "otherWaste",
            "kgCo2e": entry["otherWasteKg"] * factors["otherWaste"].value,
        },
        "foodEstimate": {
            "quantity": entry["foodEmissionsKg"],
            "unit": "kg CO2e estimated food footprint",
            "factor": 1.0,
            "factorKey": "scannerEstimate",
            "kgCo2e": entry["foodEmissionsKg"],
        },
    }
    category_totals = {
        "transport": sum(line_items[key]["kgCo2e"] for key in ("personalVehicle", "bus", "rail")),
        "electricity": line_items["electricity"]["kgCo2e"],
        "fuel": sum(line_items[key]["kgCo2e"] for key in ("petrol", "diesel", "lpg", "otherFuel")),
        "waste": sum(line_items[key]["kgCo2e"] for key in ("foodWaste", "paperWaste", "plasticWaste", "otherWaste")),
        "food": line_items["foodEstimate"]["kgCo2e"],
    }
    scopes = {
        "directMobile": line_items["personalVehicle"]["kgCo2e"] if entry["vehicleType"] in {"petrolCar", "dieselCar", "motorcycle", "auto"} else 0.0,
        "electricityRelated": category_totals["electricity"] + (
            line_items["personalVehicle"]["kgCo2e"] if entry["vehicleType"] == "electricCar" else 0.0
        ),
        "directStationaryFuel": category_totals["fuel"],
        "otherIndirect": (
            category_totals["transport"]
            - line_items["personalVehicle"]["kgCo2e"]
            + category_totals["waste"]
            + category_totals["food"]
        ),
    }
    for amount in (*category_totals.values(), *scopes.values()):
        if not math.isfinite(amount):
            raise ValidationError("The supplied activity and factors produce a non-finite result.")
    return {
        "date": entry["date"],
        "unit": "kg CO2e",
        "categories": category_totals,
        "scopes": scopes,
        "total": sum(category_totals.values()),
        "lineItems": line_items,
        "factorDetails": {
            **{key: factor.to_dict() for key, factor in factors.items()},
            "scannerEstimate": {
                "key": "scannerEstimate",
                "value": 1.0,
                "unit": "kg CO2e/kg CO2e estimate",
                "source": (
                    "User-reviewed receipt or quick-log estimate; serving "
                    "proxies are illustrative and are not independently verified."
                ),
                "geography": "Location-agnostic demo estimate",
                "applicable_year": "Not applicable",
                "boundary": (
                    "Uses the reviewed food estimate as supplied; transport, "
                    "packaging, recipe and origin are not separately modeled."
                ),
                "provisional": True,
            },
        },
        "method": (
            "Quantity × emission factor, summed by category. Vehicle distance "
            "uses a per-kilometre factor; fuel inputs are non-transport only. "
            "The electric-car factor includes a use-phase electricity proxy, "
            "so exclude that charging electricity from the electricity input. "
            "Waste factors are provisional disposal-related estimates. Food "
            "receipt estimates are supplied by the user after reviewing an "
            "illustrative per-serving scanner calculation."
        ),
        "uncertainty": (
            "Estimates depend on self-reported activity and provisional factor "
            "geography, year and boundary; not independently verified."
        ),
    }
