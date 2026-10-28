import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


BASE_DIR = Path(__file__).resolve().parent.parent


class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "local-development-only")
    DATABASE_PATH = os.getenv(
        "DATABASE_PATH", str(BASE_DIR / "instance" / "carbon_copilot.sqlite")
    )
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest")
    EMISSION_FACTORS_JSON = os.getenv("EMISSION_FACTORS_JSON", "")
    FACTOR_SOURCE = os.getenv(
        "FACTOR_SOURCE",
        "Provisional illustrative factors assembled for this demo; not an authoritative "
        "inventory. Replace with locally applicable, documented factors before formal reporting.",
    )
    FACTOR_GEOGRAPHY = os.getenv("FACTOR_GEOGRAPHY", "Generalized global estimate")
    FACTOR_YEAR = os.getenv("FACTOR_YEAR", "2024")
