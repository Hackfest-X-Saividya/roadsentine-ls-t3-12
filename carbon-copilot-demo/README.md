# Carbon Copilot — AI Sustainability Advisor

A sustainability companion that makes personal carbon estimates understandable, turns the largest sources into practical options, and compares later activity against an explicit baseline. The polished landing view, dashboard, daily log, advisor, action planner, what-if simulator, 30-day challenge, and progress history work without accounts, a database, or an AI API key.

## Hackathon demo additions

This folder is an isolated demo clone. It adds:

- **Reduction proof:** start a recommended action and compare its source's recorded monthly emissions before and after the start date. Avoided CO₂e is an estimate based on recorded days, not causal proof.
- **Activity what-if:** change one typical daily activity amount and preview a 30-day footprint estimate without saving it.
- **Personal weekly carbon budget:** derives a weekly target from the saved reduction goal and compares recent logged emissions with it.
- **Team challenge:** combines this device's estimated progress with clearly labeled sample teammate contributions. No account or external service is needed.
- **Factor reference:** lists each active factor, unit, source/assumption, and whether it is illustrative.
- **Receipt scanner:** reads electricity bills, fuel receipts, grocery images, and food-order screenshots with browser-side OCR. Values are reviewed before applying; images are not uploaded or saved. Electricity is averaged only after you enter the bill's billing days. Fuel purchases use vehicle-efficiency and days-represented values that you enter and confirm; no assumptions are prefilled because purchased fuel is not measured fuel consumption.
- **Voice / quick logging:** type a plain-language activity or optionally use browser speech recognition, then review the parsed amounts before applying them. Text parsing is local and rule-based; no LLM or API key is required. Speech availability and audio handling depend on the browser and its speech service.
- **Habit-triggered nudges:** after at least three delivery logs on the same weekday across separate weeks, the dashboard suggests a timely lower-impact food choice. Nudges are computed from local records when the app is open; they are not background notifications and do not use location or restaurant data.

New action-start, receipt-derived, and quick-log data is stored alongside the existing local tracker state in this clone's browser storage. The existing tracking, planner, account-optional API, and local-only mode remain available. No paid services or API keys are required for the demo. The OCR engine is fetched from jsDelivr only when a scan is requested; the selected image itself is processed in the browser.

WhatsApp and Telegram bots are not connected in this demo: each requires a messaging provider account, bot credentials, and a public webhook. The in-app voice and text path demonstrates frictionless logging without those external dependencies.

The original browser-only mode remains available. Run the optional Flask service to expose a validated REST API, and configure Supabase to enable authenticated cloud storage and account sync. An optional Anthropic key enables explanation-only LLM responses; the local deterministic advisor remains the fallback.

## What it does

- Records one daily activity entry per date; saving the same date updates that entry.
- Calculates transportation, electricity, non-transport fuel, and waste emissions from transparent, editable factors.
- Shows daily, weekly, and monthly average trends, category totals, a recent-source breakdown, and a dated activity history.
- Creates deterministic, personalized actions from the saved activity and profile, with explicitly estimated weekly savings, rationale, impact, cost, and difficulty. Budget, transit availability, location, and optional lifestyle/preferences notes affect recommendation ranking or context, never the numerical factors.
- Answers advisor follow-ups with a local rule-based advisor. Numerical answers come from the same calculation factors used by the dashboard; no AI API key or external AI service is required.
- Sets a reduction goal using `target = baseline × (1 − reduction percentage / 100)`, and compares daily averages over recorded days.
- Tracks completed actions separately from observed changes. Marking an action complete never changes an activity record or counts its estimate as a verified reduction.
- Compares single-category what-if scenarios using the same factors as the calculator and offers a 30-day, non-streak-based logging challenge.
- Provides optional Flask REST APIs, Supabase Auth/PostgreSQL persistence with per-user RLS, and optional backend-only Anthropic explanations.

Chart.js is loaded from jsDelivr for the interactive trend chart. The rest of the app works without it, though the chart will not render when that library cannot be reached.

## Calculation method

For each date:

```
Transportation = personal-vehicle km × selected vehicle factor
               + bus passenger-km × bus factor
               + rail/metro passenger-km × rail factor
Electricity    = kWh × electricity factor
Other fuel     = non-transport fuel quantity × matching fuel factor
Waste          = each waste quantity × matching waste factor
Food           = estimated food CO₂e supplied after reviewing a receipt or quick-log estimate
Daily total    = transportation + electricity + other fuel + waste + food
```

Vehicle fuel type selects a per-kilometre car estimate; auto-rickshaws use their own illustrative proxy. Petrol/diesel/LPG quantities in the fuel section are explicitly for **non-transport use**; do not enter vehicle fuel there as well. The electric-car per-kilometre proxy includes use-phase charging electricity, so exclude EV charging from household electricity to prevent double counting. Treat the waste material inputs as separate, non-overlapping quantities. Food scanner estimates are stored as kg CO₂e after user review; illustrative serving assumptions are listed with the scanner and factor reference. Walking and cycling default to zero operational emissions. Public transport is entered as passenger-kilometres. Emissions shown are kg CO₂e estimates.

Dashboard trends group records by day, week, or month and report the mean of the recorded daily totals in each group. The current comparison uses the latest up to seven recorded dates. Baseline uses the first up to seven recorded dates. Both are averages per recorded day, not totals, to reduce bias from unequal numbers of logging days. These are not activity-adjusted or independently verified comparisons: travel distance, household occupancy, weather, and other activity levels may differ. Sparse logs and changes in activity mix can make comparisons uncertain.

The planner's potential savings are scenario estimates tied to logged activity and the displayed factors. For example, an electricity action models a 10% reduction in recent recorded electricity emissions. A transport substitution models shifting 20% of recorded car distance to rail, using the configured car and rail factors. Waste-prevention estimates are especially uncertain because actual waste treatment differs by location. The assumptions and relevant quantities are included in each recommendation's rationale. Savings are estimates, not promises. Only subsequent entries can show observed changes, and observed change is not proof that a particular action caused the difference.

## Emission factors

The starting values below are illustrative personal-planning defaults, not a formal greenhouse-gas inventory. They are intentionally editable in **Calculation factors**. Regional electricity, vehicle efficiency, occupancy, fuel blend, waste pathway, and boundaries can materially change the result; choose factors appropriate to your location and reporting purpose before using the numbers for anything beyond personal estimates.

| Activity | Default factor | Unit | Reference / assumption |
|---|---:|---|---|
| Grid electricity | 0.716 | kg CO₂e/kWh | Rounded planning proxy informed by India's Central Electricity Authority grid-baseline publications; the applicable regional/year-specific grid factor should replace it. [CEA CO₂ Baseline Database](https://cea.nic.in/cdm-co2-baseline-database/?lang=en) |
| Petrol car | 0.192 | kg CO₂e/vehicle-km | Illustrative average per-vehicle-km planning proxy; vehicle size, efficiency, fuel pathway, and occupancy vary. |
| Diesel car | 0.171 | kg CO₂e/vehicle-km | Illustrative average per-vehicle-km planning proxy; vehicle size, efficiency, fuel pathway, and occupancy vary. |
| Electric car | 0.053 | kg CO₂e/vehicle-km | Illustrative grid-dependent proxy; vehicle efficiency and local grid mix vary. |
| Motorcycle | 0.103 | kg CO₂e/vehicle-km | Illustrative fleet-average planning proxy. |
| Auto-rickshaw | 0.060 | kg CO₂e/vehicle-km | Illustrative passenger-use proxy; fuel, occupancy and location vary. |
| Bus | 0.105 | kg CO₂e/passenger-km | Illustrative average; occupancy and vehicle type vary. |
| Rail / metro | 0.041 | kg CO₂e/passenger-km | Illustrative grid- and occupancy-dependent proxy. |
| Petrol (non-transport) | 2.31 | kg CO₂e/litre | Approximate direct combustion factor; does not include a complete upstream lifecycle. |
| Diesel (non-transport) | 2.68 | kg CO₂e/litre | Approximate direct combustion factor; does not include a complete upstream lifecycle. |
| LPG (non-transport) | 3.0 | kg CO₂e/kg | Approximate direct combustion factor. |
| Other liquid fuel | 2.5 | kg CO₂e/litre | Broad editable placeholder; replace for the specific fuel. |
| Food waste | 2.5 | kg CO₂e/kg | Broad treatment-dependent placeholder; not a location-specific lifecycle factor. |
| Paper waste | 1.0 | kg CO₂e/kg | Broad treatment-dependent placeholder. |
| Plastic waste | 2.5 | kg CO₂e/kg | Broad treatment-dependent placeholder. |
| Other mixed waste | 0.5 | kg CO₂e/kg | Broad composition- and treatment-dependent placeholder. |
| Walking / cycling | 0 | kg CO₂e/km | Direct operational emissions only; excludes equipment, food, and infrastructure. |

Food order/grocery estimates use broad illustrative proxies after the user reviews the detected item and serving count. The current heuristic values are: plant-based meal 0.5 kg CO₂e per 250 g, dairy 1.2 per 50 g, poultry 1.0 per 150 g, fish 0.8 per 150 g, beef/lamb 6.0 per 100 g, and mixed/unknown meal 1.2 per serving. Serving conversions are not exact values from a source dataset; actual recipes, origins, processing and portion sizes vary. [Our World in Data's food-production comparison](https://ourworldindata.org/environmental-impacts-of-food) is context, not a direct validation of these demo values.

Combustion-factor reference: UK Government greenhouse gas conversion factors for company reporting, fuel properties, and direct emissions, published annually (factor tables may change by year). [UK Government conversion factors](https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting). Transport and waste values above are deliberately labeled illustrative planning proxies rather than claimed official or universal factors. Replace them with authoritative local factors when available.

## Run locally

Run these commands from this clone's directory (from the repository root, first use `Set-Location .\carbon-copilot-demo`). The static browser app can also be opened directly at `index.html`. For REST endpoints, authentication setup, and cloud sync, install the pinned Flask dependency and run the local backend:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python run.py
```

Then open `http://127.0.0.1:5000`. Python 3.9 or later is supported by Flask 3.1; Python 3.11+ is recommended. The development server binds to loopback with debug mode disabled. Do not expose it directly to the public internet; deploy behind a production WSGI server and HTTPS.

Copy `.env.example` to `.env`. The placeholders do not enable cloud storage. With `SUPABASE_URL` and `SUPABASE_ANON_KEY` unset, local mode is still fully useful and the app reports that cloud features are not configured. Do not put an Anthropic key, Supabase key, or other credential in HTML/JavaScript. `.gitignore` excludes `.env`.

### Optional Supabase setup

1. Create a Supabase project and enable email/password sign-in under **Authentication → Providers**. Configure email confirmation and password policy in the project dashboard.
2. In the Supabase SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql). It creates the profile, activity, calculation snapshot, target, recommendation, completion, and progress-history tables, constraints, triggers, and RLS policies. When upgrading an existing demo database, rerun the script to add the food-emissions column.
3. Copy the project URL and its public **anon/publishable** key into `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`, then restart Flask. The anon key is not a service-role key. The server verifies each bearer token with Supabase Auth and uses that user's token for PostgREST, so RLS remains active. **Never configure or expose the Supabase service-role key.**
4. Open the app via Flask, choose **Connect account**, create/sign in, and use **Sync this browser**. Sync uploads the local daily records and profile before refreshing the browser's list with the user's cloud records. If email confirmation is on, confirm the account before signing in.

Cloud mode is optional. Supabase policy/schema changes and actual hosted auth require your own project credentials and cannot be verified from this repository alone.

### Optional AI setup

Set `ANTHROPIC_API_KEY` in `.env` and optionally choose `ANTHROPIC_MODEL`. The key stays on the backend. The LLM receives the question, recent **calculated category summaries**, and the deterministic recommendation snapshots—not account email or raw personal profile. It is instructed to explain those fixed results, never calculate or replace factors or savings. If the provider is unavailable or rate-limited, the REST API returns a deterministic rule-based answer and a fallback notice. Do not send information that should not be processed by your configured provider.

### REST API

All JSON requests use `Content-Type: application/json`. Cloud data routes require `Authorization: Bearer <Supabase access token>`. The auth routes accept credentials only over the local/backend connection and proxy them to Supabase Auth; the service-role key is never used.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Report local/cloud/AI availability without exposing keys. |
| `GET` | `/api/factors` | List default factor values, units, geography, year, boundary and sources. |
| `POST` | `/api/calculate` | Validate input and return categories, scopes, line items and factor provenance. |
| `POST` | `/api/auth/signup` | Create a Supabase email/password account. |
| `POST` | `/api/auth/login` | Sign in and return a Supabase access token. |
| `GET`, `PUT` | `/api/profile` | Retrieve or update the authenticated user's profile and preferences. |
| `GET`, `POST`, `DELETE` | `/api/activities` | Retrieve or save dated activity; delete at `/api/activities/YYYY-MM-DD`. |
| `GET` | `/api/dashboard` | Return recent and baseline averages, categories and active target. |
| `GET`, `POST` | `/api/recommendations` | Generate deterministic scenarios or persist their recommendation snapshots. |
| `POST` | `/api/targets` | Create a 30/60/90-day percentage-reduction target from the recorded baseline. |
| `POST` | `/api/actions/{uuid}/completion` | Record completion separately from actual observed emissions. |
| `GET` | `/api/progress` | Return per-recorded-day comparisons, completion history, and progress snapshots. |
| `POST` | `/api/advisor` | Answer a bounded question with optional LLM explanation plus deterministic calculations. |

For activity writes, send `{ "activity": { "date": "YYYY-MM-DD", ...quantities }, "factors": { ...optional numeric overrides } }`. Quantities are finite, non-negative, and bounded server-side; unknown fields, future dates, invalid vehicle/fuel types, and unknown factors are rejected. Numeric results are calculated server-side from the submitted values and factors; AI output is never accepted as a calculation.

The backend tests use only Flask's test client and in-memory fake persistence:

```powershell
python -m unittest discover -s tests -v
```

## Privacy and limitations

In local mode, data is stored in this browser's local storage, which is not encrypted. Anyone with access to the same browser profile can read it. Use **Export data** to download a JSON copy. In cloud mode, daily data and preferences are sent to your configured Supabase project under its authenticated RLS policies; signing out does not delete cloud records. The browser holds the Supabase access token in session storage for the active tab session. The optional location and preference fields are sent to your own configured Supabase project, and the optional advisor provider receives only the question, calculated aggregates, and recommendation snapshots.
