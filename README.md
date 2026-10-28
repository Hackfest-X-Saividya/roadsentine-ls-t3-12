# Carbon Copilot — AI Sustainability Advisor

A responsive sustainability activity tracker with a modular Flask API, transparent estimates, deterministic recommendations, target planning, progress comparisons, a scenario simulator, and a 30-day challenge.

## Run locally

1. Use Python 3.10 or later.
2. Create and activate a virtual environment, then install dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   py -m pip install -r requirements.txt
   ```
3. Optionally copy `.env.example` to `.env`. Leave service fields blank to use local-only mode.
4. Start the app:

   ```powershell
   py run.py
   ```
5. Open <http://127.0.0.1:5000>.

Activity, target, and action data are stored in the local SQLite database at `instance/carbon_copilot.sqlite` by default. The `DATABASE_PATH` environment variable can point to a different local file. Keep `.env` and local database files private; `.env` is ignored by Git.

## Calculation transparency

The factors in `carbon_copilot/calculations.py` are explicitly **provisional illustrative estimates**, not authoritative or suitable for formal reporting. Each activity saves its calculation and factor/provenance snapshot so later advice does not silently recalculate history with changed factors. Every estimate is quantity × factor; activity records remain distinct from estimated CO2e.

To supply a locally maintained complete factor table, set `EMISSION_FACTORS_JSON` to JSON with the same category, subcategory, numeric `value`, and matching `unit` structure as the defaults. Set `FACTOR_SOURCE`, `FACTOR_GEOGRAPHY`, and `FACTOR_YEAR` to matching provenance. Invalid or incomplete factor tables stop startup with an explicit error. Do not claim a factor source that you have not verified.

Units are km for distance, kWh for electricity, liters for non-transport fuel, and kg for waste. Vehicle travel is distance-based; do not enter vehicle fuel again as non-transport fuel. The electric-car distance factor includes a charging proxy. If a household electricity total also includes EV charging, enter the charging portion in the separate field so it is excluded from that electricity estimate. Waste streams should be recorded without overlapping quantities.

## Optional services

The app remains useful without Supabase or Anthropic credentials. Health status reports local-only mode unless both configured Supabase Auth and PostgREST endpoints respond successfully. AI is optional and only personalizes wording; deterministic advice remains available, and AI does not calculate factors or numeric savings.

For a Supabase project:

1. In Supabase, enable the Auth providers you want and configure allowed redirect URLs for your local app.
2. Apply [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor. Its tables use `auth.uid()` ownership checks and Row Level Security.
3. Put your project URL and **anon/public key** in the local `.env` file. Never use a service-role key in the browser or commit credentials. Cloud storage access must use an authenticated user's access token and RLS.
4. Restart the app, choose **Account backup**, and sign in or create an account. A signed-in user can explicitly back up this device's activity records (including calculation/factor snapshots), target, and action completions. This is a one-way local-to-cloud backup; the app continues using local SQLite and does not download cloud data.

The local application does not require a Supabase service-role key. Do not paste credentials into chat. Anthropic integration is disabled unless `ANTHROPIC_API_KEY` is set locally; `ANTHROPIC_MODEL` is optional.

## API

- `GET /api/health`, `/api/factors`
- `POST /api/cloud/sign-in`, `/api/cloud/sign-up`, `/api/cloud/backup`
- `GET|POST /api/activities`; `PUT|DELETE /api/activities/<id>`
- `POST /api/calculate`
- `GET /api/dashboard?period=daily|weekly|monthly`
- `GET /api/recommendations`
- `GET|POST /api/targets`
- `GET /api/actions`; `POST /api/actions/<id>/complete`
- `GET /api/progress?days=30`
- `POST /api/simulate`, `/api/advisor`

## Tests

Run the focused Python test suite:

```powershell
py -m unittest discover -s tests -v
```

The frontend uses browser-native JavaScript and Chart.js from its public CDN. It degrades gracefully if the chart library is unavailable.
