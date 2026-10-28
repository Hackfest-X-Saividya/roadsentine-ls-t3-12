import json
import os
import tempfile
import unittest
from datetime import date
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

from requests import HTTPError

from carbon_copilot import create_app
from carbon_copilot.supabase_client import SupabaseClient


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.app = create_app({
            "TESTING": True,
            "DATABASE_PATH": os.path.join(self.temp_dir.name, "test.sqlite"),
            "SUPABASE_URL": "",
            "SUPABASE_ANON_KEY": "",
            "ANTHROPIC_API_KEY": "",
        })
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def create_activity(self, **overrides):
        data = {
            "category": "transport",
            "subcategory": "car_petrol",
            "quantity": 10,
            "date": date.today().isoformat(),
        }
        data.update(overrides)
        return self.client.post("/api/activities", json=data)

    def test_health_reports_local_mode_when_optional_services_are_unconfigured(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["mode"], "local-only")
        self.assertFalse(response.json["cloudEnabled"])
        self.assertFalse(response.json["aiEnabled"])
        self.assertFalse(response.json["cloudReachable"])

    def test_flask_serves_frontend_from_same_origin_as_api(self):
        page = self.client.get("/")
        try:
            self.assertEqual(page.status_code, 200)
            self.assertIn(b"Carbon Copilot", page.data)
            self.assertIn(b"/static/app.js", page.data)
        finally:
            page.close()
        for asset_path in ("/static/app.js", "/static/styles.css"):
            asset = self.client.get(asset_path)
            try:
                self.assertEqual(asset.status_code, 200)
            finally:
                asset.close()

    def test_activity_crud_dashboard_and_period_validation(self):
        created = self.create_activity()
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json["calculation"]["kg_co2e"], 1.92)
        self.assertTrue(created.json["factor_snapshot"]["provisional"])
        identifier = created.json["id"]
        listed = self.client.get("/api/activities")
        self.assertEqual(len(listed.json), 1)
        dashboard = self.client.get("/api/dashboard?period=daily")
        self.assertEqual(dashboard.json["total_kg_co2e"], 1.92)
        self.assertEqual(len(dashboard.json["trend"]), 30)
        self.assertEqual(self.client.get("/api/dashboard?period=yearly").status_code, 400)
        edited = self.client.put(f"/api/activities/{identifier}", json={
            "category": "transport", "subcategory": "rail", "quantity": 10,
            "date": date.today().isoformat(),
        })
        self.assertEqual(edited.json["calculation"]["kg_co2e"], 0.41)
        self.assertEqual(self.client.delete(f"/api/activities/{identifier}").status_code, 200)
        self.assertEqual(self.client.get("/api/activities").json, [])

    def test_server_rejects_invalid_input_and_invalid_json_explicitly(self):
        bad = self.create_activity(quantity=-1)
        self.assertEqual(bad.status_code, 400)
        self.assertIn("error", bad.json)
        invalid_json = self.client.post(
            "/api/activities", data="{", content_type="application/json"
        )
        self.assertEqual(invalid_json.status_code, 400)
        self.assertEqual(invalid_json.json["error"], "Request body must contain valid JSON.")

    def test_bad_progress_period_and_unconfigured_cloud_backup_are_explicit(self):
        self.assertEqual(self.client.get("/api/progress?days=bad").status_code, 400)
        backup = self.client.post("/api/cloud/backup")
        self.assertEqual(backup.status_code, 401)
        self.assertIn("error", backup.json)

    def test_supabase_health_requires_auth_and_postgrest(self):
        response_ok = Mock(ok=True)
        with patch("carbon_copilot.supabase_client.requests.get", return_value=response_ok) as get:
            self.assertTrue(SupabaseClient("https://example.test", "publishable").health())
        self.assertEqual(get.call_count, 2)
        self.assertTrue(get.call_args_list[0].args[0].endswith("/auth/v1/health"))
        self.assertTrue(get.call_args_list[1].args[0].endswith("/rest/v1/activity_records"))
        self.assertEqual(get.call_args_list[1].kwargs["params"], {"select": "id", "limit": "0"})

        with patch(
            "carbon_copilot.supabase_client.requests.get",
            side_effect=[Mock(ok=True), Mock(ok=False)],
        ):
            self.assertFalse(SupabaseClient("https://example.test", "publishable").health())

    def test_supabase_rest_requests_forward_only_user_scoped_auth(self):
        response = Mock(content=b"")
        with patch("carbon_copilot.supabase_client.requests.request", return_value=response) as send:
            result = SupabaseClient("https://example.test", "publishable-test-key").user_scoped_request(
                "POST",
                "activity_records",
                "user-jwt",
                json=[{"category": "transport"}],
            )
        self.assertIsNone(result)
        response.raise_for_status.assert_called_once_with()
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer user-jwt")
        self.assertEqual(kwargs["headers"]["apikey"], "publishable-test-key")
        self.assertNotIn("service_role", kwargs["headers"]["apikey"])

    def test_api_health_reports_reachability_and_not_authentication_state(self):
        supabase = Mock(configured=True)
        supabase.health.return_value = True
        with patch("carbon_copilot.api._supabase", return_value=supabase):
            response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["cloudEnabled"])
        self.assertTrue(response.json["cloudReachable"])
        self.assertFalse(response.json["aiEnabled"])

    def test_cloud_sign_in_and_sign_up_report_supabase_errors(self):
        supabase = Mock(configured=True)
        supabase.sign_in.side_effect = HTTPError("rejected")
        supabase.sign_up.side_effect = HTTPError("rejected")
        with patch("carbon_copilot.api._supabase", return_value=supabase):
            sign_in = self.client.post("/api/cloud/sign-in", json={
                "email": "user@example.test", "password": "valid-password",
            })
            sign_up = self.client.post("/api/cloud/sign-up", json={
                "email": "new@example.test", "password": "valid-password",
            })
        self.assertEqual(sign_in.status_code, 401)
        self.assertIn("error", sign_in.json)
        self.assertEqual(sign_up.status_code, 400)
        self.assertIn("error", sign_up.json)

    def test_cloud_backup_uses_user_jwt_schema_columns_and_user_scoped_uuids(self):
        activity = self.create_activity()
        self.assertEqual(activity.status_code, 201)
        self.client.post("/api/targets", json={"reduction_percentage": 20, "duration_days": 30})
        self.client.post("/api/actions/transit/complete")

        user_id = str(uuid4())
        access_token = "test-user-access-token"
        supabase = Mock(configured=True)
        supabase.authenticated_user.return_value = {"id": user_id, "email": "user@example.test"}
        with patch("carbon_copilot.api._supabase", return_value=supabase):
            response = self.client.post(
                "/api/cloud/backup",
                headers={"Authorization": f"Bearer {access_token}"},
            )

        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["activity_count"], 1)
        self.assertTrue(response.json["target_backed_up"])
        self.assertEqual(response.json["completed_actions_count"], 1)
        supabase.authenticated_user.assert_called_once_with(access_token)
        calls = supabase.user_scoped_request.call_args_list
        self.assertEqual([call.args[1] for call in calls], [
            "activity_records", "calculation_results", "targets", "action_completions",
        ])
        for call in calls:
            self.assertEqual(call.args[2], access_token)
            self.assertNotIn("user_id", call.kwargs["json"][0] if isinstance(call.kwargs["json"], list)
                             else call.kwargs["json"])

        activity_row = calls[0].kwargs["json"][0]
        calculation_row = calls[1].kwargs["json"][0]
        target_row = calls[2].kwargs["json"]
        completion_row = calls[3].kwargs["json"][0]
        cloud_activity_id = UUID(activity_row["id"])
        self.assertEqual(cloud_activity_id, UUID(calculation_row["activity_id"]))
        self.assertEqual(cloud_activity_id, UUID(calculation_row["id"]))
        self.assertNotEqual(activity_row["id"], activity.json["id"])
        self.assertEqual(calls[0].kwargs["params"]["on_conflict"], "id")
        self.assertEqual(calls[1].kwargs["params"]["on_conflict"], "id")
        self.assertEqual(calls[2].kwargs["params"]["on_conflict"], "user_id")
        self.assertEqual(calls[3].kwargs["params"]["on_conflict"], "id")
        self.assertEqual(target_row["baseline_period_days"], 30)
        self.assertIs(completion_row["is_measured_reduction"], False)

        with patch("carbon_copilot.api._supabase", return_value=supabase):
            repeated = self.client.post(
                "/api/cloud/backup",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        self.assertEqual(repeated.status_code, 200)
        repeated_activity = supabase.user_scoped_request.call_args_list[4].kwargs["json"][0]
        self.assertEqual(repeated_activity["id"], activity_row["id"])

    def test_cloud_backup_rejects_expired_sessions_and_reports_postgrest_errors(self):
        access_token = "test-user-access-token"
        supabase = Mock(configured=True)
        supabase.authenticated_user.return_value = None
        with patch("carbon_copilot.api._supabase", return_value=supabase):
            expired = self.client.post(
                "/api/cloud/backup",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        self.assertEqual(expired.status_code, 401)
        supabase.user_scoped_request.assert_not_called()

        supabase.authenticated_user.return_value = {"id": str(uuid4()), "email": "user@example.test"}
        supabase.user_scoped_request.side_effect = HTTPError("PostgREST rejected request")
        self.create_activity()
        with patch("carbon_copilot.api._supabase", return_value=supabase):
            failed = self.client.post(
                "/api/cloud/backup",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        self.assertEqual(failed.status_code, 502)
        self.assertIn("error", failed.json)

    def test_configured_factor_table_is_used_and_saved_in_snapshot(self):
        from carbon_copilot.calculations import DEFAULT_FACTORS

        factors = json.loads(json.dumps(DEFAULT_FACTORS))
        factors["transport"]["car_petrol"]["value"] = 0.2
        custom = create_app({
            "TESTING": True,
            "DATABASE_PATH": os.path.join(self.temp_dir.name, "custom.sqlite"),
            "EMISSION_FACTORS_JSON": json.dumps(factors),
            "FACTOR_SOURCE": "Local transport inventory",
            "FACTOR_GEOGRAPHY": "Example region",
            "FACTOR_YEAR": "2025",
        })
        response = custom.test_client().post("/api/activities", json={
            "category": "transport", "subcategory": "car_petrol", "quantity": 10,
            "date": date.today().isoformat(),
        })
        self.assertEqual(response.json["calculation"]["kg_co2e"], 2)
        self.assertEqual(response.json["calculation"]["source"], "Local transport inventory")
        self.assertEqual(response.json["factor_snapshot"]["year"], 2025)

    def test_target_progress_simulator_and_action_completion_keep_estimates_separate(self):
        self.create_activity()
        target = self.client.post("/api/targets", json={
            "reduction_percentage": 20,
            "duration_days": 30,
        })
        self.assertEqual(target.status_code, 201)
        self.assertEqual(target.json["target_kg_co2e"], 1.536)
        self.assertEqual(target.json["latest_period_kg_co2e"], 1.92)
        self.assertEqual(target.json["measurement_period_days"], 30)
        simulation = self.client.post("/api/simulate", json={"reduction_percentage": 25})
        self.assertEqual(simulation.json["estimated_savings_kg_co2e"], 0.48)
        completed = self.client.post("/api/actions/transit/complete")
        self.assertEqual(completed.status_code, 201)
        self.assertFalse(completed.json["is_measured_reduction"])
        progress = self.client.get("/api/progress?days=30")
        self.assertEqual(progress.json["completed_actions"][0]["action_id"], "transit")
        self.assertEqual(progress.json["observed_change_kg_co2e"], 1.92)
        self.assertNotEqual(progress.json["observed_change_kg_co2e"],
                            progress.json["estimated_action_savings_kg_co2e"])

    def test_ev_distance_proxy_and_household_electricity_are_not_double_counted(self):
        ev = self.create_activity(subcategory="car_electric", quantity=10)
        electricity = self.create_activity(
            category="electricity", subcategory="electricity", quantity=20,
            ev_charging_kwh=5,
        )
        self.assertEqual(ev.json["calculation"]["kg_co2e"], 0.5)
        self.assertEqual(electricity.json["calculation"]["kg_co2e"], 6)
        self.assertEqual(self.client.get("/api/dashboard?period=monthly").json["total_kg_co2e"], 6.5)


if __name__ == "__main__":
    unittest.main()
