import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from requests import RequestException
from werkzeug.exceptions import BadRequest

from .advisor import ask_advisor
from .calculations import calculate_activity, factor_snapshot, validate_activity
from .recommendations import ACTION_CATALOG, get_recommendations
from .supabase_client import SupabaseClient

api = Blueprint("api", __name__)


@contextmanager
def _db():
    connection = sqlite3.connect(current_app.config["DATABASE_PATH"])
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    path = Path(current_app.config["DATABASE_PATH"])
    path.parent.mkdir(parents=True, exist_ok=True)
    with _db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS activities (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                calculation TEXT NOT NULL,
                factor_snapshot TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS targets (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS action_completions (
                id TEXT PRIMARY KEY,
                action_id TEXT NOT NULL,
                title TEXT NOT NULL,
                completed_date TEXT NOT NULL,
                estimated_savings_kg_co2e REAL NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )


def _read_activities():
    with _db() as connection:
        rows = connection.execute("SELECT * FROM activities ORDER BY json_extract(data, '$.date') DESC").fetchall()
    result = []
    for row in rows:
        item = json.loads(row["data"])
        item.update({
            "id": row["id"],
            "calculation": json.loads(row["calculation"]),
            "factor_snapshot": json.loads(row["factor_snapshot"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        })
        result.append(item)
    return result


def _period_days(name):
    return {"daily": 1, "weekly": 7, "monthly": 30}.get(name)


def _summary(items, start=None, end=None):
    totals = {"transport": 0.0, "electricity": 0.0, "fuel": 0.0, "waste": 0.0}
    filtered = []
    for item in items:
        if start and item["date"] < start:
            continue
        if end and item["date"] > end:
            continue
        filtered.append(item)
        totals[item["category"]] += item["calculation"]["kg_co2e"]
    return {
        "total_kg_co2e": round(sum(totals.values()), 3),
        "by_category": {key: round(value, 3) for key, value in totals.items()},
        "activity_count": len(filtered),
    }


def _target_progress(items):
    with _db() as connection:
        row = connection.execute("SELECT data FROM targets WHERE id = 1").fetchone()
    if not row:
        return None
    target = json.loads(row["data"])
    baseline = float(target["baseline_kg_co2e"])
    goal = baseline * (1 - target["reduction_percentage"] / 100)
    today = date.today()
    period_days = target.get("baseline_period_days", 30)
    latest = _summary(
        items, (today - timedelta(days=period_days - 1)).isoformat(), today.isoformat()
    )["total_kg_co2e"]
    return {
        **target,
        "target_kg_co2e": round(goal, 3),
        "latest_period_kg_co2e": latest,
        "measurement_period_days": period_days,
        "remaining_gap_kg_co2e": round(max(0, latest - goal), 3),
        "progress_percentage": round(min(100, max(0, (baseline - latest) / max(baseline - goal, 0.0001) * 100)), 1),
        "completed_actions_are_estimates": True,
    }


def _error(message, status=400):
    return jsonify({"error": message}), status


def _factor_snapshot():
    return factor_snapshot(
        current_app.config["EMISSION_FACTORS"],
        current_app.config["FACTOR_SOURCE"],
        current_app.config["FACTOR_GEOGRAPHY"],
        current_app.config["FACTOR_YEAR"],
    )


@api.errorhandler(BadRequest)
def invalid_json(error):
    return _error("Request body must contain valid JSON.")


@api.get("/")
def home():
    return send_from_directory(current_app.static_folder, "index.html")


@api.get("/api/health")
def health():
    supabase = SupabaseClient(current_app.config["SUPABASE_URL"], current_app.config["SUPABASE_ANON_KEY"])
    cloud_enabled = supabase.health()
    return jsonify({
        "status": "ok",
        "mode": "local-first-cloud-available" if cloud_enabled else "local-only",
        "cloudEnabled": cloud_enabled,
        "cloudReachable": cloud_enabled,
        "aiEnabled": bool(current_app.config["ANTHROPIC_API_KEY"]),
    })


def _supabase():
    return SupabaseClient(current_app.config["SUPABASE_URL"], current_app.config["SUPABASE_ANON_KEY"])


@api.post("/api/cloud/sign-in")
def cloud_sign_in():
    supabase = _supabase()
    body = request.get_json(silent=True) or {}
    email, password = body.get("email"), body.get("password")
    if not supabase.configured:
        return _error("Cloud sign-in is unavailable: Supabase is not configured.", 503)
    if (not isinstance(email, str) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
            or not isinstance(password, str) or not password or len(password) > 1024):
        return _error("Enter a valid email address and password.")
    try:
        result = supabase.sign_in(email, password)
    except RequestException:
        return _error("Supabase sign-in failed. Check your credentials and project Auth settings.", 401)
    if not result.get("access_token"):
        return _error("Supabase did not return a session. Check whether email confirmation is required.", 401)
    return jsonify({
        "access_token": result["access_token"],
        "user": {"id": result.get("user", {}).get("id"), "email": result.get("user", {}).get("email")},
    })


@api.post("/api/cloud/sign-up")
def cloud_sign_up():
    supabase = _supabase()
    body = request.get_json(silent=True) or {}
    email, password = body.get("email"), body.get("password")
    if not supabase.configured:
        return _error("Cloud registration is unavailable: Supabase is not configured.", 503)
    if (not isinstance(email, str) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
            or not isinstance(password, str) or len(password) < 8 or len(password) > 1024):
        return _error("Enter a valid email and a password of at least 8 characters.")
    try:
        result = supabase.sign_up(email, password)
    except RequestException:
        return _error("Supabase registration failed. Check your project Auth settings.", 400)
    session = result.get("session") or {}
    return jsonify({
        "access_token": session.get("access_token"),
        "user": {"id": result.get("user", {}).get("id"), "email": result.get("user", {}).get("email")},
        "confirmation_required": not bool(session.get("access_token")),
    }), 201


@api.post("/api/cloud/backup")
def cloud_backup():
    supabase = _supabase()
    authorization = request.headers.get("Authorization", "")
    access_token = authorization[7:] if authorization.startswith("Bearer ") else ""
    if not supabase.configured or not access_token:
        return _error("Sign in to a configured Supabase account before backing up.", 401)
    try:
        user = supabase.authenticated_user(access_token)
        if not user:
            return _error("Your cloud session has expired. Sign in again.", 401)
        records = _read_activities()
        if records:
            rows = [{
                "id": item["id"],
                "category": item["category"],
                "subcategory": item["subcategory"],
                "quantity": item["quantity"],
                "unit": item["unit"],
                "ev_charging_kwh": item.get("ev_charging_kwh", 0),
                "activity_date": item["date"],
                "note": item["note"],
                "calculation": item["calculation"],
                "factor_snapshot": item["factor_snapshot"],
            } for item in records]
            supabase.user_scoped_request(
                "POST", "activity_records", access_token,
                params={"on_conflict": "id"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json=rows,
            )
            supabase.user_scoped_request(
                "POST", "calculation_results", access_token,
                params={"on_conflict": "id"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json=[{
                    "id": item["id"],
                    "activity_id": item["id"],
                    "result": item["calculation"],
                } for item in records],
            )
        with _db() as connection:
            target_row = connection.execute("SELECT data FROM targets WHERE id = 1").fetchone()
            completions = connection.execute(
                "SELECT id, action_id, title, completed_date, estimated_savings_kg_co2e "
                "FROM action_completions"
            ).fetchall()
        if target_row:
            target = json.loads(target_row["data"])
            supabase.user_scoped_request(
                "POST", "targets", access_token,
                params={"on_conflict": "user_id"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json={
                    "reduction_percentage": target["reduction_percentage"],
                    "duration_days": target["duration_days"],
                    "baseline_kg_co2e": target["baseline_kg_co2e"],
                    "baseline_period_days": target["baseline_period_days"],
                    "started_date": target["started_date"],
                    "target_date": target["target_date"],
                },
            )
        if completions:
            supabase.user_scoped_request(
                "POST", "action_completions", access_token,
                params={"on_conflict": "id"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json=[{
                    "id": row["id"],
                    "action_id": row["action_id"],
                    "title": row["title"],
                    "completed_date": row["completed_date"],
                    "estimated_savings_kg_co2e": row["estimated_savings_kg_co2e"],
                    "is_measured_reduction": False,
                } for row in completions],
            )
    except RequestException as error:
        current_app.logger.warning("Supabase user-scoped backup request failed: %s", error.__class__.__name__)
        return _error("Cloud backup failed. Check the Supabase schema and your account permissions.", 502)
    return jsonify({
        "user_email": user.get("email"),
        "activity_count": len(records),
        "target_backed_up": bool(target_row),
        "completed_actions_count": len(completions),
        "direction": "local-to-cloud",
        "message": "Local records were backed up to your authenticated account; local data remains on this device.",
    })


@api.get("/api/factors")
def factors():
    return jsonify(_factor_snapshot())


@api.route("/api/activities", methods=["GET", "POST"])
def activities():
    if request.method == "GET":
        return jsonify(_read_activities())
    try:
        data = validate_activity(request.get_json(silent=False))
        snapshot = _factor_snapshot()
        calculation = calculate_activity(data, snapshot)
    except (ValueError, TypeError) as error:
        return _error(str(error))
    identifier = str(uuid.uuid4())
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    with _db() as connection:
        connection.execute(
            "INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?)",
            (identifier, json.dumps(data), json.dumps(calculation), json.dumps(snapshot), now, now),
        )
    return jsonify({**data, "id": identifier, "calculation": calculation, "factor_snapshot": snapshot,
                    "created_at": now, "updated_at": now}), 201


@api.route("/api/activities/<identifier>", methods=["PUT", "DELETE"])
def activity_detail(identifier):
    with _db() as connection:
        exists = connection.execute("SELECT id FROM activities WHERE id = ?", (identifier,)).fetchone()
        if not exists:
            return _error("Activity not found.", 404)
        if request.method == "DELETE":
            connection.execute("DELETE FROM activities WHERE id = ?", (identifier,))
            return jsonify({"deleted": True, "id": identifier})
        try:
            data = validate_activity(request.get_json(silent=False))
            snapshot = _factor_snapshot()
            calculation = calculate_activity(data, snapshot)
        except (ValueError, TypeError) as error:
            return _error(str(error))
        now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
        connection.execute(
            "UPDATE activities SET data = ?, calculation = ?, factor_snapshot = ?, updated_at = ? WHERE id = ?",
            (json.dumps(data), json.dumps(calculation), json.dumps(snapshot), now, identifier),
        )
    return jsonify({**data, "id": identifier, "calculation": calculation, "factor_snapshot": snapshot,
                    "updated_at": now})


@api.post("/api/calculate")
def calculate():
    try:
        data = validate_activity(request.get_json(silent=False))
        return jsonify({"activity": data, "calculation": calculate_activity(data, _factor_snapshot())})
    except (ValueError, TypeError) as error:
        return _error(str(error))


@api.get("/api/dashboard")
def dashboard():
    period = request.args.get("period", "weekly")
    days = _period_days(period)
    if not days:
        return _error("Period must be daily, weekly, or monthly.")
    items = _read_activities()
    today = date.today()
    summary = _summary(items, (today - timedelta(days=days - 1)).isoformat(), today.isoformat())
    trends = []
    for offset in range(29, -1, -1):
        day = (today - timedelta(days=offset)).isoformat()
        trends.append({"date": day, "kg_co2e": _summary(items, day, day)["total_kg_co2e"]})
    sources = sorted(
        [{"label": item["calculation"]["factor_label"], "kg_co2e": item["calculation"]["kg_co2e"],
          "date": item["date"]} for item in items],
        key=lambda item: item["kg_co2e"], reverse=True,
    )[:5]
    return jsonify({
        **summary,
        "period": period,
        "period_days": days,
        "largest_sources": sources,
        "trend": trends,
        "target": _target_progress(items),
        "recommendations": get_recommendations(items)[:5],
        "estimated_action_savings_kg_co2e": round(
            sum(row["estimated_savings_kg_co2e"] for row in get_recommendations(items)), 3
        ),
    })


@api.get("/api/recommendations")
def recommendations():
    return jsonify(get_recommendations(_read_activities()))


@api.route("/api/targets", methods=["GET", "POST"])
def targets():
    if request.method == "GET":
        return jsonify(_target_progress(_read_activities()))
    body = request.get_json(silent=True) or {}
    try:
        raw_reduction = body.get("reduction_percentage")
        raw_duration = body.get("duration_days")
        if isinstance(raw_reduction, bool) or isinstance(raw_duration, bool):
            raise ValueError
        reduction = float(raw_reduction)
        duration_value = float(raw_duration)
        if not duration_value.is_integer():
            raise ValueError
        duration = int(duration_value)
    except (TypeError, ValueError):
        return _error("Provide a numeric reduction_percentage and duration_days.")
    if not 1 <= reduction <= 90 or not 7 <= duration <= 365:
        return _error("Reduction must be 1–90%; duration must be 7–365 days.")
    today = date.today()
    baseline = _summary(
        _read_activities(), (today - timedelta(days=29)).isoformat(), today.isoformat()
    )["total_kg_co2e"]
    if baseline <= 0:
        return _error("Record an activity in the last 30 days before setting a target.")
    target = {
        "reduction_percentage": reduction,
        "duration_days": duration,
        "baseline_kg_co2e": baseline,
        "baseline_period_days": 30,
        "started_date": today.isoformat(),
        "target_date": (today + timedelta(days=duration)).isoformat(),
    }
    with _db() as connection:
        connection.execute(
            "INSERT INTO targets (id, data, updated_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (json.dumps(target), datetime.utcnow().isoformat(timespec="seconds") + "Z"),
        )
    return jsonify(_target_progress(_read_activities())), 201


@api.get("/api/actions")
def actions():
    with _db() as connection:
        completed = connection.execute(
            "SELECT id, action_id, title, completed_date, estimated_savings_kg_co2e FROM action_completions ORDER BY completed_date DESC"
        ).fetchall()
    return jsonify({
        "available": get_recommendations(_read_activities()),
        "catalog": ACTION_CATALOG,
        "completed": [dict(row) for row in completed],
    })


@api.post("/api/actions/<action_id>/complete")
def complete_action(action_id):
    action = next((item for item in ACTION_CATALOG if item["id"] == action_id), None)
    if not action:
        return _error("Action not found.", 404)
    rec = next((item for item in get_recommendations(_read_activities()) if item["id"] == action_id), None)
    estimated = rec["estimated_savings_kg_co2e"] if rec else 0
    identifier = str(uuid.uuid4())
    completed_date = date.today().isoformat()
    with _db() as connection:
        connection.execute(
            "INSERT INTO action_completions VALUES (?, ?, ?, ?, ?, ?)",
            (identifier, action_id, action["title"], completed_date, estimated,
             datetime.utcnow().isoformat(timespec="seconds") + "Z"),
        )
    return jsonify({
        "id": identifier, "action_id": action_id, "title": action["title"],
        "completed_date": completed_date, "estimated_savings_kg_co2e": estimated,
        "is_measured_reduction": False,
    }), 201


@api.get("/api/progress")
def progress():
    items = _read_activities()
    today = date.today()
    raw_days = request.args.get("days")
    try:
        days = int(raw_days) if raw_days is not None else 30
    except ValueError:
        return _error("Progress period must be an integer from 7 to 365 days.")
    if not 7 <= days <= 365:
        return _error("Progress period must be 7–365 days.")
    current_start = today - timedelta(days=days - 1)
    previous_start = current_start - timedelta(days=days)
    current = _summary(items, current_start.isoformat(), today.isoformat())
    previous = _summary(items, previous_start.isoformat(), (current_start - timedelta(days=1)).isoformat())
    change = round(current["total_kg_co2e"] - previous["total_kg_co2e"], 3)
    with _db() as connection:
        completions = connection.execute(
            "SELECT id, action_id, title, completed_date, estimated_savings_kg_co2e FROM action_completions ORDER BY completed_date DESC"
        ).fetchall()
    return jsonify({
        "period_days": days,
        "current": current,
        "baseline": previous,
        "absolute_change_kg_co2e": change,
        "percentage_change": round(change / previous["total_kg_co2e"] * 100, 1)
        if previous["total_kg_co2e"] else None,
        "target": _target_progress(items),
        "completed_actions": [dict(row) for row in completions],
        "estimated_action_savings_kg_co2e": round(sum(row["estimated_savings_kg_co2e"] for row in completions), 3),
        "observed_change_kg_co2e": change,
        "interpretation": "Period totals are compared across equal-length windows, but activity mix and "
        "seasonal conditions may differ. Completed-action savings are estimates; only later activity records "
        "contribute to observed period changes.",
    })


@api.post("/api/simulate")
def simulate():
    body = request.get_json(silent=True) or {}
    try:
        raw_reduction = body.get("reduction_percentage")
        if isinstance(raw_reduction, bool):
            raise ValueError
        reduction = float(raw_reduction)
    except (TypeError, ValueError):
        return _error("Provide reduction_percentage from 0 to 100.")
    if not 0 <= reduction <= 100:
        return _error("Reduction percentage must be between 0 and 100.")
    items = _read_activities()
    total = sum(item["calculation"]["kg_co2e"] for item in items)
    savings = round(total * reduction / 100, 3)
    return jsonify({
        "baseline_kg_co2e": round(total, 3),
        "reduction_percentage": reduction,
        "estimated_savings_kg_co2e": savings,
        "scenario_kg_co2e": round(total - savings, 3),
        "basis": "Scenario reduction applied to all saved activity emissions using each record's factor snapshot.",
        "is_estimate": True,
    })


@api.post("/api/advisor")
def advisor():
    body = request.get_json(silent=True) or {}
    question = body.get("question", "")
    if not isinstance(question, str) or not question.strip() or len(question) > 1000:
        return _error("Question is required and must be 1000 characters or fewer.")
    answer = ask_advisor(
        question.strip(),
        get_recommendations(_read_activities()),
        current_app.config["ANTHROPIC_API_KEY"],
        current_app.config["ANTHROPIC_MODEL"],
    )
    return jsonify(answer)
