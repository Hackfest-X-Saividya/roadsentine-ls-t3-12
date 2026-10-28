import copy
import unittest
from datetime import date

from carbon_copilot.calculations import (
    DEFAULT_FACTORS,
    calculate_activity,
    estimate_savings,
    factor_snapshot,
    validate_activity,
    validate_factors,
)


class CalculationTests(unittest.TestCase):
    def valid_activity(self, **overrides):
        data = {
            "category": "transport",
            "subcategory": "car_petrol",
            "quantity": 10,
            "date": date.today().isoformat(),
        }
        data.update(overrides)
        return data

    def test_distance_emissions_and_explanation_use_same_factor(self):
        activity = validate_activity(self.valid_activity())
        result = calculate_activity(activity)
        self.assertEqual(result["kg_co2e"], 1.92)
        self.assertIn("0.192 kg CO2e/km", result["calculation"])
        self.assertTrue(result["provisional"])
        self.assertEqual(result["geography"], "Generalized global estimate")

    def test_electricity_excludes_charging_proxy_quantity(self):
        activity = validate_activity({
            "category": "electricity",
            "subcategory": "electricity",
            "quantity": 20,
            "ev_charging_kwh": 5,
            "date": date.today().isoformat(),
        })
        result = calculate_activity(activity)
        self.assertEqual(result["kg_co2e"], 6)
        self.assertIn("20 kWh total − 5 kWh EV charging", result["calculation"])

    def test_electricity_charging_split_must_be_within_total(self):
        with self.assertRaisesRegex(ValueError, "between zero and total"):
            validate_activity({
                "category": "electricity",
                "subcategory": "electricity",
                "quantity": 10,
                "ev_charging_kwh": 11,
                "date": date.today().isoformat(),
            })

    def test_invalid_non_transport_vehicle_category_does_not_double_count(self):
        with self.assertRaisesRegex(ValueError, "supported activity type"):
            validate_activity(self.valid_activity(category="fuel", subcategory="car_petrol"))

    def test_future_date_and_nan_quantity_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "future"):
            validate_activity(self.valid_activity(date="2999-01-01"))
        with self.assertRaisesRegex(ValueError, "between"):
            validate_activity(self.valid_activity(quantity=float("nan")))

    def test_factors_require_valid_units_and_positive_finite_values(self):
        invalid = copy.deepcopy(DEFAULT_FACTORS)
        invalid["transport"]["car_petrol"]["value"] = float("inf")
        with self.assertRaisesRegex(ValueError, "between"):
            validate_factors(invalid)
        invalid = copy.deepcopy(DEFAULT_FACTORS)
        invalid["transport"]["car_petrol"]["unit"] = "kg CO2e/L"
        with self.assertRaisesRegex(ValueError, "unit"):
            validate_factors(invalid)

    def test_recommendation_savings_use_each_records_saved_factor_snapshot(self):
        activity = validate_activity(self.valid_activity())
        snapshot = factor_snapshot()
        snapshot["factors"]["transport"]["car_petrol"]["value"] = 0.1
        activity["factor_snapshot"] = snapshot
        self.assertEqual(estimate_savings(activity, 0.5), 0.5)


if __name__ == "__main__":
    unittest.main()
