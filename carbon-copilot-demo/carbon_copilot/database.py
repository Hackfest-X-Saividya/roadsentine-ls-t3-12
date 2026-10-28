"""Small Supabase Auth/PostgREST client using only the authenticated user JWT."""

from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .config import Settings


class SupabaseError(RuntimeError):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class SupabaseClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.supabase_url
        self.anon_key = settings.supabase_anon_key

    def _request(
        self,
        path: str,
        *,
        method: str = "GET",
        token: str | None = None,
        body: dict[str, Any] | list[dict[str, Any]] | None = None,
        params: dict[str, str] | None = None,
        prefer: str | None = None,
    ) -> Any:
        if not self.settings.supabase_enabled:
            raise SupabaseError("Supabase is not configured.", 503)
        url = f"{self.base_url}{path}"
        if params:
            url = f"{url}?{urlencode(params)}"
        headers = {
            "apikey": self.anon_key,
            "Accept": "application/json",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            headers["Authorization"] = f"Bearer {self.anon_key}"
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        if prefer:
            headers["Prefer"] = prefer
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=8) as response:
                payload = response.read()
                if not payload:
                    return None
                return json.loads(payload.decode("utf-8"))
        except HTTPError as error:
            error_body = error.read(2048).decode("utf-8", errors="replace")
            try:
                parsed = json.loads(error_body)
                message = parsed.get("msg") or parsed.get("message") or parsed.get("error_description") or parsed.get("error")
            except json.JSONDecodeError:
                message = ""
            if error.code == 429:
                raise SupabaseError("Authentication service rate limit reached. Try again shortly.", 429) from None
            if error.code in {400, 401, 403, 404, 409, 422}:
                raise SupabaseError(message or "The Supabase request was rejected.", error.code) from None
            raise SupabaseError("Supabase service is temporarily unavailable.", 502) from None
        except (URLError, TimeoutError, json.JSONDecodeError):
            raise SupabaseError("Supabase service is temporarily unavailable.", 502) from None

    def auth_request(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request(
            f"/auth/v1/{path}",
            method="POST",
            body=payload,
        )
        return result if isinstance(result, dict) else {}

    def get_user(self, token: str) -> dict[str, Any]:
        result = self._request("/auth/v1/user", token=token)
        if not isinstance(result, dict) or not result.get("id"):
            raise SupabaseError("Authentication token is invalid.", 401)
        return result

    def select(
        self,
        table: str,
        token: str,
        filters: dict[str, str] | None = None,
        *,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        params = {"select": "*", **(filters or {})}
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(limit)
        result = self._request(f"/rest/v1/{quote(table)}", token=token, params=params)
        if not isinstance(result, list):
            raise SupabaseError("Unexpected response from the database.")
        return result

    def upsert(
        self,
        table: str,
        token: str,
        row: dict[str, Any],
        *,
        on_conflict: str,
    ) -> dict[str, Any]:
        result = self._request(
            f"/rest/v1/{quote(table)}",
            method="POST",
            token=token,
            body=row,
            params={"on_conflict": on_conflict},
            prefer="resolution=merge-duplicates,return=representation",
        )
        return result[0] if isinstance(result, list) and result else {}

    def insert(
        self, table: str, token: str, row: dict[str, Any]
    ) -> dict[str, Any]:
        result = self._request(
            f"/rest/v1/{quote(table)}",
            method="POST",
            token=token,
            body=row,
            prefer="return=representation",
        )
        return result[0] if isinstance(result, list) and result else {}

    def update(
        self,
        table: str,
        token: str,
        filters: dict[str, str],
        row: dict[str, Any],
    ) -> list[dict[str, Any]]:
        result = self._request(
            f"/rest/v1/{quote(table)}",
            method="PATCH",
            token=token,
            body=row,
            params={"select": "*", **filters},
            prefer="return=representation",
        )
        return result if isinstance(result, list) else []

