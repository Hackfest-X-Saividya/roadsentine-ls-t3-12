import json

from flask import Flask
from .calculations import DEFAULT_FACTORS, validate_factors

from .api import api
from .config import Config


def create_app(test_config=None):
    app = Flask(__name__, static_folder="../static", static_url_path="/static")
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)
    factor_json = app.config.get("EMISSION_FACTORS_JSON", "")
    app.config["EMISSION_FACTORS"] = (
        validate_factors(json.loads(factor_json)) if factor_json else DEFAULT_FACTORS
    )
    try:
        app.config["FACTOR_YEAR"] = int(app.config["FACTOR_YEAR"])
    except (TypeError, ValueError):
        raise ValueError("FACTOR_YEAR must be a four-digit year.") from None
    if not 1900 <= app.config["FACTOR_YEAR"] <= 2100:
        raise ValueError("FACTOR_YEAR must be between 1900 and 2100.")
    if not app.config["FACTOR_SOURCE"] or not app.config["FACTOR_GEOGRAPHY"]:
        raise ValueError("Factor source and geography must be configured.")
    app.register_blueprint(api)

    with app.app_context():
        from .api import initialize_database

        initialize_database()

    return app
