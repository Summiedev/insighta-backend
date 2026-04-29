# Insighta Labs — Intelligence Query Engine

A queryable demographic intelligence API built on the Task 1 foundation. Turns the basic profile store into a full filtering, sorting, pagination, and natural language query engine.

## Tech Stack

- **Runtime**: Node.js ≥ 18
- **Deployment**: Vercel serverless functions (`api/` directory)
- **Database**: MongoDB Atlas (`mongodb` native driver)
- **IDs**: UUID v7 (custom implementation in `src/uuidv7.js`)
- **CORS**: origin allowlist with credential support for browser auth

---

## What's New in Task 2

| Feature | Task 1 | Task 2 |
|---|---|---|
| List profiles | Basic (no filters) | Advanced filtering + sorting + pagination |
| Filter by gender | ✅ | ✅ |
| Filter by age_group | ✅ | ✅ |
| Filter by country_id | ✅ | ✅ |
| Filter by min/max age | ❌ | ✅ |
| Filter by probability scores | ❌ | ✅ |
| Combined filters | ❌ | ✅ |
| Sorting | ❌ | ✅ (`age`, `created_at`, `gender_probability`) |
| Pagination with totals | ❌ | ✅ |
| Natural language search | ❌ | ✅ `/api/profiles/search?q=...` |
| Seeded dataset (2026) | ❌ | ✅ |
| `country_name` field | ❌ | ✅ |
| Auth-protected health/seed | ❌ | ✅ |

---

## Project Structure

```
api/
  health.js                  # GET  /api/health
  seed.js                    # POST /api/seed  (remote seed trigger)
  profiles/
    index.js                 # GET  /api/profiles  (filter + sort + paginate)
    [id].js                  # GET  /api/profiles/:id
    search/
      index.js               # GET  /api/profiles/search?q=...
src/
  db.js                      # MongoDB connection + index setup
  helpers.js                 # CORS, UTC timestamp, formatProfile
  nlParser.js                # Rule-based natural language query parser
  queryBuilder.js            # Builds MongoDB filter + sort from params
  profileService.js          # External API calls (Genderize/Agify/Nationalize)
  seed.js                    # CLI seed script
  uuidv7.js                  # UUID v7 generator
package.json
.env
README.md
```

---

## Database Schema

Each document in the `profiles` MongoDB collection follows this structure:

| Field | Type | Notes |
|---|---|---|
| `id` | String (UUID v7) | Primary key |
| `name` | String (UNIQUE) | Person's full name |
| `gender` | String | `"male"` or `"female"` |
| `gender_probability` | Float | Confidence score (0.0–1.0) |
| `age` | Int | Exact age |
| `age_group` | String | `child` / `teenager` / `adult` / `senior` |
| `country_id` | String(2) | ISO 3166-1 alpha-2 code (e.g. `NG`, `KE`) |
| `country_name` | String | Full country name |
| `country_probability` | Float | Confidence score (0.0–1.0) |
| `created_at` | String | UTC ISO 8601 timestamp |

**Age group boundaries:**
- `child`: 0–12
- `teenager`: 13–17
- `adult`: 18–64
- `senior`: 65+

**Indexes:** `name` (unique), `gender`, `age_group`, `country_id`, `age`, `gender_probability`, `country_probability`, `created_at`

---

## Setup

### 1. Environment variables

Create or update `.env`:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/?appName=Cluster0
MONGODB_DB=profileapi
```

### 2. Install dependencies

```bash
npm install
```

### 3. Seed the database

**Option A — CLI (local):**

```bash
node src/seed.js
```

**Option B — HTTP (after deploying):**

```bash
curl -X POST https://yourapp.vercel.app/api/seed \
  -H "Authorization: Bearer <admin-token>"
```

Re-running either option is fully **idempotent** — existing profiles are skipped via `bulkWrite` with `ordered: false` on the unique `name` index.

Note: `GET /api/health` and `POST /api/seed` are now authenticated routes in Stage 3.

### 4. Run locally

```bash
npx vercel dev
# → http://localhost:3000
```

All profile-related routes require `X-API-Version: 1`. Authenticated requests should send the backend session cookies or bearer token created by the Stage 3 auth flow.

---

## API Reference

### `GET /api/health`

Requires authentication.

```json
{ "status": "ok", "profiles": 2026, "timestamp": "2026-04-21T10:00:00.000Z" }
```

---

### `GET /api/profiles`

Returns a filtered, sorted, paginated list of profiles.

**Filter parameters:**

| Param | Type | Example |
|---|---|---|
| `gender` | `male` \| `female` | `?gender=male` |
| `age_group` | `child` \| `teenager` \| `adult` \| `senior` | `?age_group=adult` |
| `country_id` | ISO-2 string | `?country_id=NG` |
| `min_age` | integer | `?min_age=25` |
| `max_age` | integer | `?max_age=45` |
| `min_gender_probability` | float 0–1 | `?min_gender_probability=0.9` |
| `min_country_probability` | float 0–1 | `?min_country_probability=0.3` |

All filters are combinable. Results match **all** supplied conditions.

**Sort parameters:**

| Param | Values | Default |
|---|---|---|
| `sort_by` | `age` \| `created_at` \| `gender_probability` | `created_at` |
| `order` | `asc` \| `desc` | `asc` |

**Pagination parameters:**

| Param | Default | Max |
|---|---|---|
| `page` | `1` | — |
| `limit` | `10` | `50` |

**Example:**

```
GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10
```

**Response:**

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 42,
  "data": [
    {
      "id": "018f4e3b-7c2a-7000-b3a1-2c4d5e6f7a8b",
      "name": "Emeka Okafor",
      "gender": "male",
      "gender_probability": 0.97,
      "age": 34,
      "age_group": "adult",
      "country_id": "NG",
      "country_name": "Nigeria",
      "country_probability": 0.82,
      "created_at": "2026-04-21T10:00:00Z"
    }
  ]
}
```

---

### `GET /api/profiles/search`

Converts a plain-English query into filters and returns matching profiles.

**Parameter:**

| Param | Required | Description |
|---|---|---|
| `q` | ✅ | Natural language query string |
| `page` | ❌ | Pagination (default: 1) |
| `limit` | ❌ | Page size (default: 10, max: 50) |

**Example queries and their parsed filters:**

| Query | Parsed Filters |
|---|---|
| `young males` | `gender=male` + `min_age=16` + `max_age=24` |
| `females above 30` | `gender=female` + `min_age=30` |
| `people from angola` | `country_id=AO` |
| `adult males from kenya` | `gender=male` + `age_group=adult` + `country_id=KE` |
| `male and female teenagers above 17` | `age_group=teenager` + `min_age=17` |
| `elderly women from nigeria` | `gender=female` + `min_age=65` + `country_id=NG` |
| `children in ghana` | `age_group=child` + `country_id=GH` |

**Parsing rules:**
- Rule-based only — **no AI, no LLMs**
- `"young"` maps to `min_age=16, max_age=24` (parsing only; not a stored age_group)
- `"elderly"` / `"old"` maps to `min_age=65`
- Nationality adjectives work: `nigerian`, `kenyan`, `ghanaian`, etc.
- Prepositions work: `from nigeria`, `in kenya`, `of ghana`
- 50+ countries supported (African-focused + major world countries)

**Uninterpretable query response (422):**

```json
{ "status": "error", "message": "Unable to interpret query" }
```

---

### `GET /api/profiles/:id`

Fetch a single profile by UUID.

```
GET /api/profiles/018f4e3b-7c2a-7000-b3a1-2c4d5e6f7a8b
```

**404 response:**

```json
{ "status": "error", "message": "Profile not found" }
```

---

## Stage 3 CI/CD (Grading)

- Workflow file: `.github/workflows/backend-ci-cd.yml`
- Pipeline gates: `lint` -> `test` -> `build` -> `deploy`
- Deploy target: Vercel production on push to `main`
- Required repository secrets:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`

## Stage 3 Submission Checklist (Backend)

- Architecture and stack constraints documented (Node + Vercel serverless + Mongo driver)
- Auth, RBAC, rate limiting, and logging behavior documented
- API examples provided for list/search/export/auth endpoints
- Environment variables and deployment steps provided
- CI/CD workflow and required secrets documented

## Stage 2 vs Stage 3 Diff

- Stage 2: profile filtering/search only
- Stage 3: GitHub OAuth PKCE, JWT access/refresh, RBAC, v1 API routes, CSV export, rate limiting, structured logging
- Stage 2 contract preserved: filtering, sorting, pagination, NL search behavior remain unchanged
- Stage 3 additions are additive and versioned under `/api/v1`

---

### `POST /api/seed`

Triggers database seeding. Idempotent — safe to call multiple times. Requires admin authentication.

```bash
curl -X POST https://yourapp.vercel.app/api/seed \
  -H "Authorization: Bearer <token>"

**Response:**

```json
{ "status": "success", "inserted": 2026, "skipped": 0, "total": 2026 }
```

If `SEED_SECRET` is not set in env, the endpoint is unprotected.

---

## Error Responses

All errors follow this structure:

```json
{ "status": "error", "message": "<description>" }
```

| Status Code | Meaning |
|---|---|
| `400` | Missing or empty required parameter |
| `404` | Profile not found |
| `405` | Method not allowed |
| `422` | Invalid parameter type or value / Unable to interpret NL query |
| `500` | Internal server error |
| `502` | External API unreachable |

---

## Natural Language Parser — Design Notes

`src/nlParser.js` uses pure regex + lookup tables to extract structured filters from English text. The implementation:

1. **Gender detection** — scans for `male`, `female`, `males`, `females`, or combined phrases (`male and female`, `people`, `persons`)
2. **Age keyword mapping** — `young` → 16–24, `elderly`/`old` → 65+
3. **Age group words** — `child/children`, `teen/teens/teenager/teenagers`, `adult/adults`, `senior/seniors`
4. **Explicit age constraints** — `above/over/older than N`, `below/under/younger than N`, `between N and M`, `aged N`
5. **Country detection** — tries preposition capture (`from/in/of <country>`) first, then scans for nationality adjectives anywhere in the query. Matches longest phrases first to avoid false-positives (e.g., `south africa` before `africa`)

The parser requires at least one interpretable signal. If nothing is extracted, it returns `"Unable to interpret query"`.

---

## CORS

All handlers set:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

All timestamps are UTC ISO 8601. All IDs are UUID v7.
