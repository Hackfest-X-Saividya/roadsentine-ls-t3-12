
"""Optional Supabase Auth and user-scoped REST access using an end-user JWT."""

import requests


class SupabaseClient:
    def __init__(self, url, anon_key):
        self.url = (url or "").rstrip("/")
        self.anon_key = anon_key or ""

    @property
    def configured(self):
        """Check whether Supabase configuration is available."""
        return bool(self.url and self.anon_key)

    def health(self):
        """Check Auth and the activity table through PostgREST."""
        if not self.configured:
            return False

        try:
            auth_response = requests.get(
                f"{self.url}/auth/v1/health",
                headers={"apikey": self.anon_key},
                timeout=5,
            )
            rest_response = requests.get(
                f"{self.url}/rest/v1/activity_records",
                params={"select": "id", "limit": "0"},
                headers={"apikey": self.anon_key, "Accept": "application/json"},
                timeout=5,
            )
            return auth_response.ok and rest_response.ok
        except requests.RequestException:
            return False

    def authenticated_user(self, access_token):
        """Retrieve the authenticated user."""
        if not self.configured or not access_token:
            return None

        response = requests.get(
            f"{self.url}/auth/v1/user",
            headers={
                "apikey": self.anon_key,
                "Authorization": f"Bearer {access_token}",
            },
            timeout=10,
        )

        if response.status_code == 401:
            return None

        response.raise_for_status()
        return response.json()

    def sign_in(self, email, password):
        """Sign in with email and password."""
        if not self.configured:
            raise RuntimeError("Supabase is not configured.")

        response = requests.post(
            f"{self.url}/auth/v1/token?grant_type=password",
            headers={
                "apikey": self.anon_key,
                "Content-Type": "application/json",
            },
            json={"email": email, "password": password},
            timeout=10,
        )

        response.raise_for_status()
        return response.json()

    def sign_up(self, email, password):
        """Register a user with email and password."""
        if not self.configured:
            raise RuntimeError("Supabase is not configured.")

        response = requests.post(
            f"{self.url}/auth/v1/signup",
            headers={
                "apikey": self.anon_key,
                "Content-Type": "application/json",
            },
            json={"email": email, "password": password},
            timeout=10,
        )

        response.raise_for_status()
        return response.json()

    def user_scoped_request(self, method, table, access_token, **kwargs):
        """Send a database request using the authenticated user's JWT."""
        if not self.configured:
            raise ValueError(
                "Supabase is not configured. Check SUPABASE_URL "
                "and SUPABASE_ANON_KEY in your .env file."
            )

        if not access_token:
            raise ValueError(
                "An authenticated user access token is required."
            )

        headers = kwargs.pop("headers", {})

        response = requests.request(
            method,
            f"{self.url}/rest/v1/{table}",
            headers={
                **headers,
                "apikey": self.anon_key,
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            timeout=10,
            **kwargs,
        )

        response.raise_for_status()

        if response.content:
            return response.json()

        return None
