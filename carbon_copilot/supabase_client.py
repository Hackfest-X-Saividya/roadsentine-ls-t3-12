"""Optional Supabase Auth and user-scoped REST access using an end-user JWT."""

import requests


class SupabaseClient:
    def __init__(self, url, anon_key):
        self.url = url.rstrip("/")
        self.anon_key = anon_key

    @property
    def configured(self):
        return bool(self.url and self.anon_key)

    def health(self):
        if not self.configured:
            return False
        try:
            auth_response = requests.get(
                f"{self.url}/auth/v1/health",
                headers={"apikey": self.anon_key},
                timeout=3,
            )
            rest_response = requests.get(
                f"{self.url}/rest/v1/",
                headers={"apikey": self.anon_key},
                timeout=3,
            )
            return auth_response.ok and rest_response.ok
        except requests.RequestException:
            return False

    def authenticated_user(self, access_token):
        if not self.configured or not access_token:
            return None
        response = requests.get(
            f"{self.url}/auth/v1/user",
            headers={"apikey": self.anon_key, "Authorization": f"Bearer {access_token}"},
            timeout=5,
        )
        if response.status_code == 401:
            return None
        response.raise_for_status()
        return response.json()

    def sign_in(self, email, password):
        response = requests.post(
            f"{self.url}/auth/v1/token?grant_type=password",
            headers={"apikey": self.anon_key, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    def sign_up(self, email, password):
        response = requests.post(
            f"{self.url}/auth/v1/signup",
            headers={"apikey": self.anon_key, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    def user_scoped_request(self, method, table, access_token, **kwargs):
        if not self.configured or not access_token:
            raise ValueError("A configured Supabase project and authenticated user token are required.")
        headers = kwargs.pop("headers", {})
        response = requests.request(
            method,
            f"{self.url}/rest/v1/{table}",
            headers={
                "apikey": self.anon_key,
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                **headers,
            },
            timeout=10,
            **kwargs,
        )
        response.raise_for_status()
        return response.json() if response.content else None
