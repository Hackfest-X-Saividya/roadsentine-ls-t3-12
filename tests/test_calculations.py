import unittest
from datetime import date, timedelta

from carbon_copilot.calculations import ValidationError, calculate_emissions
from carbon_copilot.recommendations import build_recommendations


class CarbonCalculationTests(unittest.TestCase):
    def setUp(self):
        self.activity = {
            "date": date.today().isoformat(),
            "vehicleDistance": 10,
            "vehicleType": "petrolCar",
            "vehicleFuel": "petrol",
            "electricityKwh": 2,
            "petrolLitres": 1,
            "foodWasteKg": 0.2,
        }

    def test_components_and_total_use_quantity_times_factor(self):
        result = calculate_emissions(self.activity)
        self.assertAlmostEqual(result["categories"]["transport"], 1.92)
        self.assertAlmostEqual(result["categories"]["electricity"], 1.432)
        self.assertAlmostEqual(result["categories"]["fuel"], 2.31)
        self.assertAlmostEqual(result["categories"]["waste"], 0.5)
        self.assertAlmostEqual(result["total"], 6.162)
        self.assertEqual(result["lineItems"]["petrol"]["unit"], "litre non-transport")
        self.assertIn("provisional", result["factorDetails"]["foodWaste"]["source"].lower())

    def test_factors_are_configurable_and_returned_with_provenance(self):
        result = calculate_emissions(self.activity, {"electricity": 0.5})
        self.assertAlmostEqual(result["categories"]["electricity"], 1.0)
        self.assertEqual(result["factorDetails"]["electricity"]["value"], 0.5)
        self.assertIn("User-configured override", result["factorDetails"]["electricity"]["source"])
        with self.assertRaises(ValidationError):
            calculate_emissions(self.activity, {"electricity": True})

    def test_invalid_inputs_are_rejected(self):
        for field, value in (
            ("electricityKwh", -1),
            ("vehicleDistance", float("inf")),
            ("vehicleDistance", True),
            ("vehicleType", ["petrolCar"]),
            ("unrecognized", 1),
        ):
            payload = {**self.activity, field: value}
            with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                calculate_emissions(payload)

    def test_future_and_impossible_dates_are_rejected(self):
        future = (date.today() + timedelta(days=1)).isoformat()
        with self.assertRaises(ValidationError):
            calculate_emissions({**self.activity, "date": future})
        with self.assertRaises(ValidationError):
            calculate_emissions({**self.activity, "date": "2025-02-30"})

    def test_vehicle_distance_and_fuel_are_separate_boundaries(self):
        result = calculate_emissions(self.activity)
        self.assertAlmostEqual(result["categories"]["transport"], 10 * 0.192)
        self.assertAlmostEqual(result["categories"]["fuel"], 1 * 2.31)
        self.assertAlmostEqual(result["scopes"]["directMobile"], 1.92)

    def test_electric_vehicle_emissions_are_classified_with_electricity(self):
        result = calculate_emissions({
            "date": date.today().isoformat(),
            "vehicleType": "electricCar",
            "vehicleDistance": 10,
            "electricityKwh": 2,
        })
        self.assertAlmostEqual(result["categories"]["transport"], 0.53)
        self.assertAlmostEqual(result["categories"]["electricity"], 1.432)
        self.assertAlmostEqual(result["scopes"]["electricityRelated"], 1.962)
        self.assertIn("exclude that charging electricity", result["method"])

    def test_recommendations_use_factors_and_rank_preferences(self):
        record = {**self.activity, "date": date.today().isoformat()}
        actions = build_recommendations(
            [record],
            {"electricity": 0.5},
            {"budget": "free", "transport": "transit", "preferences": "low effort public transit"},
        )
        self.assertTrue(actions)
        self.assertEqual(actions[0]["id"], "transit-swap")
        electricity = next(action for action in actions if action["id"] == "electricity-trim")
        self.assertAlmostEqual(electricity["estimatedWeeklySavingsKgCo2e"], 0.7)
        self.assertTrue(all(action["estimateOnly"] for action in actions))

    def test_recommendations_respect_each_record_factor_snapshot(self):
        today = date.today()
        records = [
            {
                "date": (today - timedelta(days=1)).isoformat(),
                "electricityKwh": 2,
                "factors": {"electricity": 0.5},
            },
            {
                "date": today.isoformat(),
                "electricityKwh": 2,
                "factors": {"electricity": 1.0},
            },
        ]
        actions = build_recommendations(records)
        electricity = next(action for action in actions if action["id"] == "electricity-trim")
        self.assertAlmostEqual(electricity["estimatedWeeklySavingsKgCo2e"], 1.05)


if __name__ == "__main__":
    unittest.main()
