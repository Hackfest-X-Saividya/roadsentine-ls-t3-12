"""Run Carbon Copilot locally: python run.py"""

from carbon_copilot.api import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)

