"""Flask REST API for calculations, Supabase-backed records, and advisor."""

from __future__ import annotations

from datetime import date
from functools import wraps
import logging
import re
from typing import Any, Callable, TypeVar
from uuid import UUID

from flask import Flask, g, jsonify, request, send_from_directory

from .ai_advisor import answer_question
from .calculations import (
    DEFAULT_FACTORS,
    ValidationError,
    calculate_emissions,
    validate_activity,
    validate_factors,
)
from .config import PROJECT_ROOT, Settings, get_settings
from .database import SupabaseClient, SupabaseError
from .recommendations import build_recommendations

F = TypeVar("F", bound=Callable[..., Any])
EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]{2,}$")
PROFILE_FIELDS = {"name", "location", "budget", "transport", "preferences"}
MAX_RECORDS = 366


def _json_body() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object.")
    return payload


def _finite_text(value: Any, field: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string.")
    cleaned = value.strip()
    if len(cleaned) > maximum:
        raise ValidationError(f"{field} must be at most {maximum} characters.")
    return cleaned


def _valid_uuid(raw: str) -> str:
    try:
        return str(UUID(raw))
    except (ValueError, AttributeError):
        raise ValidationError("Action ID must be a valid UUID.") from None


def _user_id() -> str:
    return g.user["id"]


def _token() -> str:
    return g.access_token


def _client() -> SupabaseClient:
    return g.supabase


def _require_auth(function: F) -> F:
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        settings: Settings = g.settings
        if not settings.supabase_enabled:
            return jsonify({"error": "Cloud features are not configured. Local mode remains available."}), 503
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token or len(token) > 8192:
            return jsonify({"error": "Sign in with Supabase Auth to use this endpoint."}), 401
        try:
            user = g.supabase_client.get_user(token)
        except SupabaseError as error:
            return jsonify({"error": str(error)}), error.status
        g.user = user
        g.access_token = token
        g.supabase = g.supabase_client
        return function(*args, **kwargs)

    return wrapped  # type: ignore[return-value]


def _activity_rows() -> list[dict[str, Any]]:
    rows = _client().select(
        "activity_records", _token(),
        {"user_id": f"eq.{_user_id()}"},
        order="activity_date.asc", limit=MAX_RECORDS,
    )
    return [
        {
            **row["activity_data"],
            "emissions": row["calculation_result"],
            "factors": row.get("factor_values") or {},
        }
        for row in rows
    ]


def _factors_for_request(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, float]]:
    custom = payload.get("factors")
    factors = validate_factors(custom)
    return factors, {key: factor.value for key, factor in factors.items()}


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings or get_settings()
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = settings.max_request_bytes
    app.secret_key = settings.flask_secret_key
    app.json.sort_keys = False
    app.logger.setLevel(logging.INFO)
    supabase = SupabaseClient(settings)

    @app.before_request
    def attach_request_services() -> None:
        g.settings = settings
        g.supabase_client = supabase

    @app.after_request
    def apply_security_headers(response: Any) -> Any:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store" if request.path.startswith("/api/") else "no-cache"
        return response

    @app.errorhandler(ValidationError)
    def validation_error(error: ValidationError) -> tuple[Any, int]:
        return jsonify({"error": str(error)}), 400

    @app.errorhandler(SupabaseError)
    def supabase_error(error: SupabaseError) -> tuple[Any, int]:
        if error.status >= 500:
            app.logger.warning("Supabase request failed with status %s.", error.status)
        return jsonify({"error": str(error)}), error.status

    @app.errorhandler(413)
    def request_too_large(_error: Any) -> tuple[Any, int]:
        return jsonify({"error": "Request body is too large."}), 413

    @app.errorhandler(404)
    def not_found(_error: Any) -> tuple[Any, int]:
        return jsonify({"error": "Resource not found."}), 404

    @app.errorhandler(500)
    def internal_error(_error: Any) -> tuple[Any, int]:
        app.logger.error("Unhandled request failure; response details withheld.")
        return jsonify({"error": "The server could not complete this request. Try again shortly."}), 500

    @app.get("/")
    def index() -> Any:
        return send_from_directory(PROJECT_ROOT, "index.html")

    @app.get("/styles.css")
    def stylesheet() -> Any:
        return send_from_directory(PROJECT_ROOT, "styles.css")

    @app.get("/app.js")
    def javascript() -> Any:
        return send_from_directory(PROJECT_ROOT, "app.js")

    @app.get("/README.md")
    def documentation() -> Any:
        return send_from_directory(PROJECT_ROOT, "README.md")

    @app.get("/api/health")
    def health() -> Any:
        return jsonify({
            "status": "ok",
            "cloudEnabled": settings.supabase_enabled,
            "aiEnabled": bool(settings.anthropic_api_key),
            "mode": "cloud-optional" if settings.supabase_enabled else "local-only",
        })

    @app.get("/api/factors")
    def factors() -> Any:
        return jsonify({
            key: factor.to_dict() for key, factor in DEFAULT_FACTORS.items()
        })

    @app.post("/api/calculate")
    def calculate() -> Any:
        payload = _json_body()
        activity_payload = payload.get("activity")
        if activity_payload is None:
            activity_payload = {key: value for key, value in payload.items() if key != "factors"}
        result = calculate_emissions(activity_payload, payload.get("factors"))
        return jsonify(result)

    @app.post("/api/auth/signup")
    def sign_up() -> Any:
        if not settings.supabase_enabled:
            return jsonify({"error": "Cloud sign-in is not configured. Set Supabase URL and anon key."}), 503
        payload = _json_body()
        email = _finite_text(payload.get("email"), "email", 254).lower()
        password = payload.get("password")
        if not EMAIL_PATTERN.fullmatch(email):
            raise ValidationError("Enter a valid email address.")
        if not isinstance(password, str) or not 10 <= len(password) <= 128:
            raise ValidationError("Password must be between 10 and 128 characters.")
        result = supabase.auth_request("signup", {"email": email, "password": password})
        return jsonify(result), 201

    @app.post("/api/auth/login")
    def sign_in() -> Any:
        if not settings.supabase_enabled:
            return jsonify({"error": "Cloud sign-in is not configured. Set Supabase URL and anon key."}), 503
        payload = _json_body()
        email = _finite_text(payload.get("email"), "email", 254).lower()
        password = payload.get("password")
        if not EMAIL_PATTERN.fullmatch(email) or not isinstance(password, str) or not 1 <= len(password) <= 128:
            raise ValidationError("Enter a valid email and password.")
        result = supabase.auth_request("token?grant_type=password", {"email": email, "password": password})
        if not result.get("access_token"):
            return jsonify({"error": "Sign-in failed. Check your credentials or email confirmation."}), 401
        return jsonify(result)

    @app.get("/api/profile")
    @_require_auth
    def get_profile() -> Any:
        rows = _client().select(
            "user_profiles", _token(), {"user_id": f"eq.{_user_id()}"}, limit=1
        )
        return jsonify(rows[0] if rows else {})

    @app.put("/api/profile")
    @_require_auth
    def update_profile() -> Any:
        payload = _json_body()
        unknown = set(payload) - PROFILE_FIELDS
        if unknown:
            raise ValidationError(f"Unknown profile field(s): {', '.join(sorted(unknown))}.")
        values = {
            field: _finite_text(payload.get(field, ""), field, maximum)
            for field, maximum in {
                "name": 80, "location": 100, "preferences": 240,
                "budget": 16, "transport": 16,
            }.items()
        }
        if values["budget"] not in {"any", "free", "moderate"}:
            raise ValidationError("budget must be any, free, or moderate.")
        if values["transport"] not in {"any", "transit", "limited"}:
            raise ValidationError("transport must be any, transit, or limited.")
        row = _client().upsert(
            "user_profiles", _token(),
            {"user_id": _user_id(), **values},
            on_conflict="user_id",
        )
        return jsonify(row)

    @app.get("/api/activities")
    @_require_auth
    def get_activities() -> Any:
        return jsonify({"records": _activity_rows()})

    @app.post("/api/activities")
    @_require_auth
    def save_activity() -> Any:
        payload = _json_body()
        raw_activity = payload.get("activity")
        if raw_activity is None:
            raw_activity = {key: value for key, value in payload.items() if key != "factors"}
        activity = validate_activity(raw_activity)
        factors, factor_values = _factors_for_request(payload)
        result = calculate_emissions(activity, factor_values)
        row = _client().upsert(
            "activity_records", _token(),
            {
                "user_id": _user_id(),
                "activity_date": activity["date"],
                "activity_data": activity,
                "factor_values": factor_values,
                "calculation_result": result,
                "transport_kg_co2e": result["categories"]["transport"],
                "electricity_kg_co2e": result["categories"]["electricity"],
                "fuel_kg_co2e": result["categories"]["fuel"],
                "waste_kg_co2e": result["categories"]["waste"],
                "food_kg_co2e": result["categories"]["food"],
                "total_kg_co2e": result["total"],
            },
            on_conflict="user_id,activity_date",
        )
        return jsonify({"record": activity, "emissions": result, "id": row.get("id")}), 201

    @app.delete("/api/activities/<activity_date>")
    @_require_auth
    def delete_activity(activity_date: str) -> Any:
        try:
            parsed = date.fromisoformat(activity_date)
        except ValueError:
            raise ValidationError("Activity date must use YYYY-MM-DD format.") from None
        if parsed.isoformat() != activity_date:
            raise ValidationError("Activity date must use YYYY-MM-DD format.")
        _client()._request(
            "/rest/v1/activity_records",
            method="DELETE",
            token=_token(),
            params={"user_id": f"eq.{_user_id()}", "activity_date": f"eq.{activity_date}"},
            prefer="return=minimal",
        )
        return jsonify({"deleted": True, "date": activity_date})

    @app.get("/api/dashboard")
    @_require_auth
    def dashboard() -> Any:
        records = _activity_rows()
        values = [record["emissions"] for record in records]
        baseline = values[:7]
        latest = values[7:][-7:] if len(values) > 7 else values
        baseline_average = sum(item["total"] for item in baseline) / len(baseline) if baseline else 0
        latest_average = sum(item["total"] for item in latest) / len(latest) if latest else 0
        category_totals = {
            key: sum(item["categories"].get(key, 0) for item in latest)
            for key in ("transport", "electricity", "fuel", "waste", "food")
        }
        target_rows = _client().select(
            "reduction_targets", _token(),
            {"user_id": f"eq.{_user_id()}", "active": "eq.true"},
            order="created_at.desc", limit=1,
        )
        return jsonify({
            "recordCount": len(records),
            "baseline": {"days": len(baseline), "averageKgCo2ePerDay": baseline_average},
            "latest": {"days": len(latest), "averageKgCo2ePerDay": latest_average, "categoryTotalsKgCo2e": category_totals},
            "changeKgCo2ePerDay": latest_average - baseline_average if len(values) > 7 else None,
            "target": target_rows[0] if target_rows else None,
            "records": records,
        })

    @app.get("/api/recommendations")
    @_require_auth
    def recommendations() -> Any:
        records = _activity_rows()
        profile_rows = _client().select(
            "user_profiles", _token(), {"user_id": f"eq.{_user_id()}"}, limit=1
        )
        profile = profile_rows[0] if profile_rows else {}
        factors = records[-1].get("factors") if records else None
        actions = build_recommendations(records, factors, profile)
        return jsonify({"recommendations": actions, "estimateOnly": True})

    @app.post("/api/recommendations")
    @_require_auth
    def save_recommendations() -> Any:
        payload = _json_body()
        requested = payload.get("recommendations")
        if not isinstance(requested, list) or not requested or len(requested) > 20:
            raise ValidationError("recommendations must be a non-empty array of at most 20 actions.")
        requested_ids = set()
        for item in requested:
            if not isinstance(item, dict):
                raise ValidationError("Each recommendation must be an object.")
            requested_ids.add(_finite_text(item.get("id"), "recommendation id", 64))
        records = _activity_rows()
        profile_rows = _client().select(
            "user_profiles", _token(), {"user_id": f"eq.{_user_id()}"}, limit=1
        )
        profile = profile_rows[0] if profile_rows else {}
        factor_values = records[-1].get("factors") if records else None
        actions = [
            item for item in build_recommendations(records, factor_values, profile)
            if item["id"] in requested_ids
        ]
        if not actions:
            raise ValidationError("No matching server-generated recommendations are available.")
        saved = []
        for action in actions:
            row = _client().upsert(
                "recommended_actions", _token(),
                {
                    "user_id": _user_id(),
                    "recommendation_key": action["id"],
                    "recommendation_snapshot": action,
                },
                on_conflict="user_id,recommendation_key",
            )
            saved.append(row)
        return jsonify({"actions": saved}), 201

    @app.post("/api/targets")
    @_require_auth
    def create_target() -> Any:
        payload = _json_body()
        percent = payload.get("reductionPercent")
        days = payload.get("durationDays")
        if isinstance(percent, bool) or not isinstance(percent, (int, float)) or not 1 <= percent <= 90:
            raise ValidationError("reductionPercent must be between 1 and 90.")
        if isinstance(days, bool) or not isinstance(days, int) or days not in {30, 60, 90}:
            raise ValidationError("durationDays must be 30, 60, or 90.")
        records = _activity_rows()
        if not records:
            raise ValidationError("Log activity before setting a reduction target.")
        baseline = records[:7]
        baseline_average = sum(record["emissions"]["total"] for record in baseline) / len(baseline)
        target_average = baseline_average * (1 - float(percent) / 100)
        _client().update(
            "reduction_targets", _token(),
            {"user_id": f"eq.{_user_id()}", "active": "eq.true"},
            {"active": False},
        )
        row = _client().insert(
            "reduction_targets", _token(),
            {
                "user_id": _user_id(), "reduction_percent": percent,
                "duration_days": days, "baseline_daily_kg_co2e": baseline_average,
                "target_daily_kg_co2e": target_average, "baseline_days": len(baseline),
                "active": True,
            },
        )
        return jsonify(row), 201

    @app.post("/api/actions/<action_id>/completion")
    @_require_auth
    def complete_action(action_id: str) -> Any:
        action_id = _valid_uuid(action_id)
        rows = _client().select(
            "recommended_actions", _token(),
            {"user_id": f"eq.{_user_id()}", "id": f"eq.{action_id}"}, limit=1,
        )
        if not rows:
            return jsonify({"error": "Recommendation not found."}), 404
        row = _client().upsert(
            "action_completions", _token(),
            {
                "user_id": _user_id(),
                "recommended_action_id": action_id,
                "completed": True,
            },
            on_conflict="user_id,recommended_action_id",
        )
        return jsonify({
            "completion": row,
            "note": "Completion is not a verified emissions reduction; compare subsequent activity records.",
        }), 200

    @app.get("/api/progress")
    @_require_auth
    def progress() -> Any:
        records = _activity_rows()
        emissions = [record["emissions"]["total"] for record in records]
        baseline = emissions[:7]
        latest = emissions[7:][-7:] if len(emissions) > 7 else emissions
        baseline_average = sum(baseline) / len(baseline) if baseline else None
        latest_average = sum(latest) / len(latest) if latest else None
        change = latest_average - baseline_average if (
            baseline_average is not None and latest_average is not None and len(emissions) > 7
        ) else None
        completions = _client().select(
            "action_completions", _token(),
            {"user_id": f"eq.{_user_id()}", "completed": "eq.true"},
            order="completed_at.desc", limit=100,
        )
        recommendation_rows = _client().select(
            "recommended_actions", _token(),
            {"user_id": f"eq.{_user_id()}"},
            limit=100,
        )
        recommendation_by_id = {row["id"]: row for row in recommendation_rows}
        completed_with_actions = [
            {
                **completion,
                "recommendation": (
                    recommendation_by_id.get(completion["recommended_action_id"], {})
                    .get("recommendation_snapshot", {})
                ),
            }
            for completion in completions
        ]
        history = _client().select(
            "progress_history", _token(),
            {"user_id": f"eq.{_user_id()}"},
            order="activity_date.asc", limit=MAX_RECORDS,
        )
        return jsonify({
            "baseline": {"recordedDays": len(baseline), "averageKgCo2ePerDay": baseline_average},
            "latest": {"recordedDays": len(latest), "averageKgCo2ePerDay": latest_average},
            "observedChangeKgCo2ePerDay": change,
            "observedChangePercent": change / baseline_average * 100 if change is not None and baseline_average else None,
            "completedActions": completed_with_actions,
            "history": history,
            "comparisonNote": (
                "Daily averages are compared across different recorded days. "
                "Changes in activity levels, season, or input quality may explain "
                "some or all of an observed difference; action completion is not causal proof."
            ),
        })

    @app.post("/api/advisor")
    @_require_auth
    def advisor() -> Any:
        payload = _json_body()
        question = _finite_text(payload.get("question"), "question", 400)
        if not question:
            raise ValidationError("question cannot be empty.")
        records = _activity_rows()
        profile_rows = _client().select(
            "user_profiles", _token(), {"user_id": f"eq.{_user_id()}"}, limit=1
        )
        profile = profile_rows[0] if profile_rows else {}
        factors = records[-1].get("factors") if records else None
        result = answer_question(question, records, settings, factors, profile)
        return jsonify(result)

    return app
