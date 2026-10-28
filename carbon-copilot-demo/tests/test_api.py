import unittest
from datetime import date
from unittest.mock import patch
from uuid import uuid4

from carbon_copilot import api as api_module
from carbon_copilot.api import create_app
from carbon_copilot.config import Settings


class FakeSupabase:
    def __init__(self, _settings):
        self.tables = {}

    def get_user(self, token):
        if token != "valid-user-token":
            raise api_module.SupabaseError("Authentication token is invalid.", 401)
        return {"id": "user-123", "email": "person@example.com"}

    def select(self, table, _token, filters=None, order=None, limit=None):
        rows = list(self.tables.get(table, []))
        for key, expression in (filters or {}).items():
            value = expression[3:] if expression.startswith("eq.") else expression
            rows = [row for row in rows if str(row.get(key)).lower() == value.lower()]
        if order:
            column = order.split(".", 1)[0]
            rows.sort(key=lambda row: row.get(column, ""), reverse=order.endswith(".desc"))
        return rows[:limit] if limit else rows

    def upsert(self, table, _token, row, *, on_conflict):
        keys = on_conflict.split(",")
        rows = self.tables.setdefault(table, [])
        existing = next((item for item in rows if all(item.get(key) == row.get(key) for key in keys)), None)
        if existing:
            existing.update(row)
            return existing
        result = {**row}
        if table in {"recommended_actions", "action_completions"}:
            result["id"] = str(uuid4())
        rows.append(result)
        return result

    def insert(self, table, _token, row):
        result = {**row, "id": str(uuid4())}
        self.tables.setdefault(table, []).append(result)
        return result

    def update(self, table, _token, filters, values):
        rows = self.tables.setdefault(table, [])
        updated = []
        for row in rows:
            if all(str(row.get(key)) == value[3:] for key, value in filters.items()):
                row.update(values)
                updated.append(row)
        return updated

    def _request(self, path, *, token=None, params=None, **_kwargs):
        self.tables["activity_records"] = [
            row for row in self.tables.get("activity_records", [])
            if not all(row.get(key) == expression[3:] for key, expression in params.items())
        ]


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(Settings())
        self.client = self.app.test_client()

    def test_health_does_not_expose_secrets(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["mode"], "local-only")
        self.assertNotIn("key", response.get_data(as_text=True).lower())

    def test_static_app_files_are_served_without_exposing_other_root_files(self):
        for path in ("/", "/styles.css", "/app.js", "/README.md"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()
        self.assertEqual(self.client.get("/.env.example").status_code, 404)

    def test_calculation_endpoint_returns_transparent_breakdown(self):
        response = self.client.post("/api/calculate", json={
            "date": date.today().isoformat(),
            "electricityKwh": 2,
            "vehicleDistance": 10,
        })
        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(response.json["total"], 3.352)
        self.assertIn("factorDetails", response.json)
        self.assertIn("lineItems", response.json)

    def test_calculation_endpoint_rejects_negative_activity(self):
        response = self.client.post("/api/calculate", json={
            "date": date.today().isoformat(),
            "electricityKwh": -20,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("electricityKwh", response.json["error"])

    def test_calculation_endpoint_includes_food_and_auto_categories(self):
        response = self.client.post("/api/calculate", json={
            "date": date.today().isoformat(),
            "vehicleType": "auto",
            "vehicleDistance": 8,
            "foodEmissionsKg": 1.0,
            "foodSource": "delivery",
        })
        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(response.json["categories"]["transport"], 0.48)
        self.assertAlmostEqual(response.json["categories"]["food"], 1.0)
        self.assertAlmostEqual(response.json["total"], 1.48)

    def test_cloud_endpoints_fail_explicitly_when_not_configured(self):
        response = self.client.get("/api/activities")
        self.assertEqual(response.status_code, 503)
        signup = self.client.post("/api/auth/signup", json={"email": "a@example.com", "password": "long-password"})
        self.assertEqual(signup.status_code, 503)

    def test_missing_auth_is_rejected_when_supabase_is_configured(self):
        app = create_app(Settings(supabase_url="https://project.supabase.co", supabase_anon_key="public-key"))
        response = app.test_client().get("/api/activities")
        self.assertEqual(response.status_code, 401)

    def test_authenticated_activity_target_recommendation_and_progress_flow(self):
        settings = Settings(supabase_url="https://project.supabase.co", supabase_anon_key="public-key")
        with patch.object(api_module, "SupabaseClient", FakeSupabase):
            app = create_app(settings)
        client = app.test_client()
        headers = {"Authorization": "Bearer valid-user-token"}
        activity = {
            "date": date.today().isoformat(),
            "vehicleDistance": 10,
            "vehicleType": "petrolCar",
            "vehicleFuel": "petrol",
            "electricityKwh": 2,
            "foodWasteKg": 0.2,
        }

        saved = client.post("/api/activities", json={"activity": activity}, headers=headers)
        self.assertEqual(saved.status_code, 201)
        self.assertAlmostEqual(saved.json["emissions"]["total"], 3.852)
        self.assertEqual(len(client.get("/api/activities", headers=headers).json["records"]), 1)

        profile = client.put(
            "/api/profile",
            json={"name": "Alex", "location": "Pune", "budget": "free", "transport": "transit", "preferences": "simple"},
            headers=headers,
        )
        self.assertEqual(profile.status_code, 200)

        target = client.post(
            "/api/targets",
            json={"reductionPercent": 20, "durationDays": 30},
            headers=headers,
        )
        self.assertEqual(target.status_code, 201)
        self.assertAlmostEqual(target.json["target_daily_kg_co2e"], saved.json["emissions"]["total"] * 0.8)

        recommendations = client.get("/api/recommendations", headers=headers)
        self.assertEqual(recommendations.status_code, 200)
        client_suggestions = recommendations.json["recommendations"]
        client_suggestions[0]["estimatedWeeklySavingsKgCo2e"] = 999999
        persisted = client.post(
            "/api/recommendations",
            json={"recommendations": client_suggestions},
            headers=headers,
        )
        self.assertEqual(persisted.status_code, 201)
        self.assertNotEqual(
            persisted.json["actions"][0]["recommendation_snapshot"]["estimatedWeeklySavingsKgCo2e"],
            999999,
        )
        action_id = persisted.json["actions"][0]["id"]
        completion = client.post(f"/api/actions/{action_id}/completion", json={}, headers=headers)
        self.assertEqual(completion.status_code, 200)
        self.assertIn("not a verified", completion.json["note"])

        progress = client.get("/api/progress", headers=headers)
        self.assertEqual(progress.status_code, 200)
        self.assertEqual(len(progress.json["completedActions"]), 1)
        self.assertEqual(len(progress.json["history"]), 0)


if __name__ == "__main__":
    unittest.main()
