# Stage 3 TRD - Complete Test Matrix & Endpoints

**Status**: ✅ All auth flows working. Profile APIs versioned. Pagination validated.

---

## 🔗 BACKEND URLS

### Base URLs
- **Local Dev**: `http://localhost:3000`
- **Vercel Prod**: `[INSERT_YOUR_VERCEL_URL]`

### Authentication Endpoints
```
GET    /api/v1/auth/github                    # Start OAuth flow
GET    /api/v1/auth/github/callback           # OAuth callback handler
POST   /api/v1/auth/refresh                   # Refresh access token
GET    /api/auth/me                           # Get current user (protected)
POST   /api/v1/auth/logout                    # Logout (revoke refresh token)
```

### Profile Endpoints (All require `X-API-Version: 1` header)
```
GET    /api/profiles                          # List profiles (paginated)
POST   /api/profiles                          # Create profile (admin only)
GET    /api/profiles/:id                      # Get single profile
GET    /api/profiles/search?q=...             # Natural language search
GET    /api/profiles/export?format=csv        # Export as CSV
```

### Utility Endpoints
```
GET    /api/health                            # Health check
POST   /api/seed                              # Trigger database seed
```

---

## 🖥️ CLI COMMANDS & USAGE

### Base Command
```bash
# Local workspace
cd c:\Users\Sumayyah\Desktop\project\HNGTASK1\insighta-cli
node .\bin\insighta.js <command>

# Global install
npm install -g .
insighta <command>
```

### Authentication Commands
```bash
# Login via GitHub OAuth (opens browser)
insighta login
# Output: Logged in as @Summiedev

# Show current user
insighta whoami
# Output:
# Insighta Identity
# @Summiedev (analyst)
# sumayah4ever@gmail.com

# Logout
insighta logout
# Output: Logged out successfully
```

### Profile List Commands
```bash
# List all profiles (page 1, limit 10)
insighta profiles list

# Filter by gender
insighta profiles list --gender male
insighta profiles list --gender female

# Filter by country
insighta profiles list --country NG
insighta profiles list --country NG --country KE

# Filter by age group
insighta profiles list --age-group adult
insighta profiles list --age-group teenager

# Filter by age range
insighta profiles list --min-age 25 --max-age 40

# Combine filters
insighta profiles list --country NG --gender male --age-group adult

# Pagination
insighta profiles list --page 2 --limit 20

# Sorting
insighta profiles list --sort-by age --order desc
insighta profiles list --sort-by created_at --order asc
```

### Profile Detail & Create
```bash
# Get single profile by ID
insighta profiles get 019dd451-3773-7cbe-bdca-e6fe31eeae15

# Create new profile (admin only)
insighta profiles create --name "Harriet Tubman"
# Output:
# {
#   "id": "...",
#   "name": "Harriet Tubman",
#   "gender": "female",
#   "age": 28,
#   ...
# }
```

### Search Commands
```bash
# Natural language search
insighta profiles search "young males from nigeria"
insighta profiles search "female adults from US with high confidence"
insighta profiles search "teenagers from Kenya"

# With pagination
insighta profiles search "adults" --page 2 --limit 15

# With sorting
insighta profiles search "females" --sort-by age --order desc
```

### Export Commands
```bash
# Export all profiles as CSV
insighta profiles export --format csv

# Export with filters
insighta profiles export --format csv --gender male --country NG

# With age range
insighta profiles export --format csv --min-age 25 --max-age 40

# Export saves to current directory as: profiles_<timestamp>.csv
```

---

## 📊 BACKEND API TEST MATRIX

### Test 1: Authentication Flow
```bash
# Step 1: Login (browser opens, you confirm GitHub)
insighta login
# Credentials saved to ~/.insighta/credentials.json

# Step 2: Verify token
insighta whoami
# Expected: @Summiedev (analyst)

# Step 3: Logout
insighta logout
# Credentials deleted

# Step 4: Try whoami after logout
insighta whoami
# Expected error: Not logged in. Run: insighta login
```

### Test 2: Profile List with Versioning
```bash
# CLI handles versioning automatically
insighta profiles list

# Direct curl with version header
curl -X GET "http://localhost:3000/api/profiles?page=1&limit=5" \
  -H "X-API-Version: 1" \
  -H "Authorization: Bearer <token>" \
  -H "x-auth-client: cli"

# Expected response:
{
  "status": "success",
  "page": 1,
  "limit": 5,
  "total": 2026,
  "total_pages": 406,
  "links": {
    "self": "/api/profiles?page=1&limit=5",
    "next": "/api/profiles?page=2&limit=5",
    "prev": null
  },
  "data": [...]
}
```

### Test 3: Create Profile (Admin Only)
```bash
# Create profile (only works if user is admin)
insighta profiles create --name "Test Profile"

# Expected if analyst:
# Error: Forbidden (403)

# Expected if admin:
{
  "id": "019...",
  "name": "Test Profile",
  "gender": "...",
  "age": ...,
  ...
}
```

### Test 4: Search with Pagination
```bash
insighta profiles search "males from Nigeria" --page 1 --limit 10

# Expected response includes:
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": <count>,
  "total_pages": <pages>,
  "links": {
    "self": "/api/profiles/search?q=males+from+Nigeria&page=1&limit=10",
    "next": "/api/profiles/search?q=males+from+Nigeria&page=2&limit=10",
    "prev": null
  },
  "data": [...]
}
```

### Test 5: Export CSV
```bash
insighta profiles export --format csv --gender male --country NG

# Expected output file: profiles_2026-04-29T10-30-00-000Z.csv
# Content: CSV with columns
# id,name,gender,gender_probability,age,age_group,country_id,country_name,country_probability,created_at
# 019dd451...,John Doe,male,0.95,25,adult,NG,Nigeria,0.87,2026-04-29T...
```

### Test 6: Rate Limiting
```bash
# Auth endpoints: 10 req/min
# Query endpoints: 120 req/min per user

# Trigger rate limit
for i in {1..11}; do
  curl -X GET "http://localhost:3000/api/v1/auth/github" -H "x-auth-client: cli"
done

# 11th request returns:
{
  "status": "error",
  "message": "Too many requests"
}
# Status code: 429
```

### Test 7: Token Expiry & Refresh
```bash
# Access token: 3 minutes
# Refresh token: 5 minutes

# After 3 minutes, access token expires
insighta whoami
# CLI automatically refreshes token

# After 5 minutes total, refresh token expires
insighta whoami
# Expected error: Invalid refresh token
# User must re-login
```

---

## 🌐 PORTAL TEST MATRIX

### Portal URLs
- **Local Dev**: `http://localhost:3000` (if serving portal)
- **Production**: `[INSERT_YOUR_PORTAL_URL]`

### Portal Pages (Protected)
```
/                    # Redirects to /login if not authenticated
/login               # GitHub OAuth login page
/dashboard           # Dashboard (protected, shows metrics)
/profiles            # Profiles list with filters (protected)
/profiles/:id        # Profile detail view (protected)
/search              # Search interface (protected)
/account             # Account settings (protected)
```

### Portal Auth Flow
```
1. User visits /login
2. Clicks "Continue with GitHub"
3. GitHub OAuth popup/redirect
4. Backend exchanges code for tokens
5. Backend sets HTTP-only cookie: portal_session=1
6. User redirected to /dashboard
7. Middleware checks portal_session cookie
8. If missing/invalid, redirect to /login
```

### Portal Test Sequence
```bash
# Step 1: Visit login page
curl -i http://localhost:3000/login

# Step 2: Click GitHub (manual in browser)

# Step 3: Check cookies
curl -b cookies.txt http://localhost:3000/dashboard
# Should have Set-Cookie: portal_session=1

# Step 4: Verify protected route
curl -b cookies.txt http://localhost:3000/account
# Expected: 200 OK (page content)

# Step 5: Without cookie
curl http://localhost:3000/dashboard
# Expected: 307 Redirect to /login
```

---

## ✅ VALIDATION CHECKLIST

### Authentication (20 points)
- [x] GitHub OAuth PKCE flow implemented
- [x] CLI callback on http://localhost:3001/api/auth/github/callback
- [x] Access token: 3 min TTL ✅
- [x] Refresh token: 5 min TTL ✅
- [x] Tokens stored in ~/.insighta/credentials.json
- [x] Refresh mechanism working (401 → auto-refresh)
- [x] Token verification (signature + expiry + issuer + role field) ✅

### Role Enforcement (10 points)
- [x] `authenticate()` wraps handlers before `authorize()` ✅ (FIXED)
- [x] analyst: read-only (/profiles GET, search, export)
- [x] admin: create/delete (/profiles POST, DELETE)
- [x] is_active=false → 403 Forbidden on all requests
- [x] Missing role → 401 Unauthorized

### Profile APIs (10 points)
- [x] X-API-Version: 1 header enforcement
- [x] Pagination with links (self, next, prev)
- [x] Export CSV with correct column order
- [x] Create profile (admin only)
- [x] Search with natural language parsing

### CLI (20 points)
- [x] login / logout / whoami
- [x] profiles list [--filters] [--pagination]
- [x] profiles get <id>
- [x] profiles search <query>
- [x] profiles create --name
- [x] profiles export --format csv
- [x] Token auto-refresh on 401
- [x] Rich output / loading states

### Portal (15 points)
- [x] Login page with GitHub button
- [x] Dashboard (protected)
- [x] Profiles list (protected)
- [x] Profile detail (protected)
- [x] Search page (protected)
- [x] Account page (protected)
- [x] HTTP-only cookies (no JS access)
- [x] Middleware redirects unauthenticated → /login

### API Updates (10 points)
- [x] Versioning header enforcement
- [x] Pagination structure with links
- [x] CSV export functionality
- [x] Error responses standardized

### Rate Limiting (5 points)
- [x] Auth: 10 req/min
- [x] Query: 120 req/min
- [x] Returns 429 Too Many Requests

### CI/CD (5 points)
- [x] GitHub Actions workflow file exists
- [x] Runs on PR to main

### Engineering (5 points)
- [x] Conventional commits
- [x] Clear branch names
- [x] README updated
- [x] Environment variables (.env)

---

## 🚀 QUICK START VALIDATION

```bash
# 1. Fresh login
Remove-Item $env:USERPROFILE\.insighta\credentials.json -Force -ErrorAction SilentlyContinue
cd c:\Users\Sumayyah\Desktop\project\HNGTASK1\insighta-cli
node .\bin\insighta.js login
# Confirms GitHub → backend → tokens → success

# 2. Verify identity
node .\bin\insighta.js whoami
# Expected: @Summiedev (analyst)

# 3. List profiles
node .\bin\insighta.js profiles list --page 1 --limit 5
# Expected: paginated output with links

# 4. Search
node .\bin\insighta.js profiles search "males from Nigeria"
# Expected: search results with natural language parsing

# 5. Export
node .\bin\insighta.js profiles export --format csv --country NG
# Expected: CSV file saved

# 6. Logout
node .\bin\insighta.js logout
# Expected: credentials deleted

# 7. Verify logout
node .\bin\insighta.js whoami
# Expected error: Not logged in
```

---

## 📋 ENVIRONMENT VARIABLES NEEDED

```bash
# .env (backend)
MONGODB_URI=mongodb+srv://...
MONGODB_DB=profileapi
GITHUB_CLIENT_ID=Ov23liQSEaZd01IavJoN
GITHUB_CLIENT_SECRET=7043320cbf7e7d4fa878b7bdf4ac7d33af5e6d25
GITHUB_REDIRECT_URI=http://localhost:3001/api/auth/github/callback
JWT_ACCESS_SECRET=b0967a4342d4e5822e5bc876fe95951a78d570b821efef23e62666c6eb8d7bfe
JWT_REFRESH_SECRET=ac2e3076677c19888c45083e4bda202f636a83c563809dcfbc16f2c91eac7254
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_QUERY_MAX=120

# For production deployment
APP_URL=https://your-vercel-url.vercel.app
API_URL=https://your-vercel-url.vercel.app
```

---

## 🔗 CRITICAL TRD COMPLIANCE ITEMS (VERIFIED)

1. ✅ **Access Token TTL**: 3 minutes (line 3 in src/auth.js)
2. ✅ **Refresh Token TTL**: 5 minutes (line 4 in src/auth.js)
3. ✅ **Auth Wrapper Order**: authenticate() before authorize() (line 99-101 in src/middleware/auth.js)
4. ✅ **API Versioning**: X-API-Version: 1 required
5. ✅ **Pagination Links**: {self, next, prev} structure
6. ✅ **Role Enforcement**: analyst (read) / admin (write)
7. ✅ **CSV Export**: Correct column order
8. ✅ **Token Verification**: Signature + exp + iss + role checks
9. ✅ **CLI Authentication**: GitHub OAuth + local callback
10. ✅ **Portal Auth**: HTTP-only cookies + middleware

