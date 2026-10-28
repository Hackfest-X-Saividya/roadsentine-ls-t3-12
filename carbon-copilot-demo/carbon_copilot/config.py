"""Environment-based application configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Load a local .env file without requiring python-dotenv."""
    env_file = PROJECT_ROOT / ".env"
    if not env_file.is_file():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass(frozen=True)
class Settings:
    supabase_url: str = ""
    supabase_anon_key: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-3-5-haiku-latest"
    flask_secret_key: str = "local-development-only-change-me"
    max_request_bytes: int = 64 * 1024

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)


def get_settings() -> Settings:
    _load_dotenv()
    return Settings(
        supabase_url=os.getenv("SUPABASE_URL", "").rstrip("/"),
        supabase_anon_key=os.getenv("SUPABASE_ANON_KEY", ""),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        anthropic_model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest"),
        flask_secret_key=os.getenv("FLASK_SECRET_KEY", "local-development-only-change-me"),
        max_request_bytes=int(os.getenv("MAX_REQUEST_BYTES", str(64 * 1024))),
    )

