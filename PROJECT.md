# AiTradr Project Documentation

## Project Overview

AiTradr is a Next.js App Router application for trading and financial management.

## Architecture Decisions

### Authentication System

**Status**: Completed (2024-12-01)

- Local email + password authentication implemented
- Session management using HTTP-only signed cookies with JWT tokens
- Prisma ORM with SQLite for local development
- Yahoo OAuth integration for local development (requires user to be signed in)

**Implementation Details**:
- Password hashing using bcryptjs with 10 rounds
- JWT tokens signed with HS256 algorithm using `jose` library
- Session cookies are HTTP-only, secure in production, and expire after 7 days
- Email validation and normalization (trim, lowercase)
- Password minimum length: 8 characters

### Database

- **ORM**: Prisma 6.19.0
- **Development Database**: SQLite (local file)
- **Location**: `/prisma/dev.db`
- **Client Output**: `/lib/prisma`

**Schema**:
- `User` model: id (cuid), email (unique), passwordHash, timestamps
- `YahooAccount` model: id (cuid), userId (foreign key), yahooUserId, accessToken, refreshToken (nullable), expiresAt (nullable), timestamps
- `League` model: id (cuid), userId (foreign key), leagueKey (unique per user), name, season, sport, teamCount (nullable), timestamps
- `Team` model: id (cuid), userId (foreign key), leagueId (foreign key), teamKey (unique per league), name, managerName (nullable), timestamps
- `TeamStanding` model: id (cuid), teamId (foreign key, unique), wins, losses, ties, pointsFor (nullable), pointsAgainst (nullable), rank (nullable), timestamps
- `Player` model: id (cuid), playerKey (unique), name, teamAbbr (nullable), positions (nullable), primaryPosition (nullable), status (nullable), timestamps
- `RosterEntry` model: id (cuid), userId (foreign key), leagueId (foreign key), teamId (foreign key), playerId (foreign key), yahooPosition (nullable), isBench, isInjuredList, timestamps
- `PlayerValue` model: id (cuid), playerId (foreign key), leagueId (foreign key), score (float), breakdown (nullable JSON string), unique on (playerId, leagueId), timestamps
- `DraftPickValue` model: id (cuid), leagueId (foreign key), round (int 1-16), score (float), unique on (leagueId, round), timestamps

### Session Management

- Sessions stored as signed HTTP-only cookies containing JWT tokens
- Session secret from environment variable `AUTH_SECRET` (required)
- Server-side session retrieval via `getSession()` utility
- Session payload contains `userId` only
- Token expiration: 7 days

### Yahoo OAuth Integration

**Status**: Completed (2024-12-01)

- Yahoo OAuth flow implemented for local development
- User must be signed in locally before linking Yahoo account
- Tokens stored in YahooAccount model (fields: yahooUserId, accessToken, refreshToken, expiresAt)
- State-based CSRF protection during OAuth flow
- HTTP-only signed cookies for CSRF state tokens
- OAuth scopes: profile, fspt-r (Yahoo Fantasy Sports Read)
- Write scopes (fspt-w) are not requested, only read access is used
- YAHOO_REDIRECT_URI is the single source of truth for redirect URI, including local development via Cloudflare tunnel

**Implementation Details**:
- CSRF state tokens use JWT signing with AUTH_SECRET
- State tokens expire after 10 minutes
- Token exchange handles Yahoo's token response format
- Upsert logic ensures one YahooAccount per user
- Redirect URI validation enforces https in production, allows http for localhost in development
- Authorization URL uses scopes: "profile fspt-r" (read-only Fantasy Sports access)

### Yahoo Fantasy API Client

**Status**: Completed (2024-12-01)

- Server-side Yahoo Fantasy API client implemented in `lib/yahoo/fantasyClient.ts`
- Centralized client for making authenticated requests to Yahoo Fantasy v2 endpoints
- Automatic user and YahooAccount resolution from request session
- Token expiration validation before API calls
- XML to JSON normalization utilities in `lib/yahoo/normalize.ts`
- Health check endpoint at `/api/yahoo/health` for local debugging and validation

**Implementation Details**:
- Client resolves current signed-in user and their YahooAccount from session
- Validates access token presence and expiration before making requests
- Uses Bearer token authentication with Yahoo Fantasy API
- Default Accept header set to `application/xml` (Yahoo returns XML by default)
- XML responses parsed to JSON using `fast-xml-parser` library
- Normalization utilities provide `parseYahooXml()`, `normalizeYahooNode()`, and `findFirstPath()` helpers
- Error handling with typed exceptions: `YahooNotLinkedError`, `YahooTokenExpiredError`, `YahooFantasyError`
- Logging includes status, endpoint, and body snippets (never logs access tokens)
- Health endpoint calls Yahoo Fantasy `/game` or `/game/{game_key}` endpoint and returns normalized sample data

### Season Detection and Stat Definitions

**Status**: Completed (2024-12-01)

- Season detection from Yahoo game endpoint via `lib/yahoo/season.ts`
- Stat definitions retrieval and caching via `lib/yahoo/statDefinitions.ts`
- Metadata debug endpoint at `/api/yahoo/metadata` for local validation

**Implementation Details**:
- Season helper (`lib/yahoo/season.ts`):
  - Fetches game information from Yahoo Fantasy API
  - Extracts season year from game response using flexible path matching
  - Caches season values per game key to avoid repeated API calls
  - Handles season formats like "2025" or "2025 26" by extracting first four-digit year
  - Returns canonical year string (e.g., "2025")
- Stat definitions helper (`lib/yahoo/statDefinitions.ts`):
  - Fetches stat categories from Yahoo Fantasy API `/game/{gameKey}/stat_categories` endpoint
  - Parses and normalizes stat definitions into typed `YahooStatDefinition` interface
  - Builds in-memory lookup maps: `byId` and `byName` (normalized)
  - Caches definitions per game key for fast lookups
  - Provides `getStatIdByNameCached()` for name-to-id resolution without network calls
  - Stat name normalization: lowercase, trim, collapse spaces, remove periods
  - No hardcoded stat IDs; all mappings derived from Yahoo API responses
- Metadata endpoint (`/api/yahoo/metadata`):
  - Returns current game key, resolved season, and stat definitions summary
  - Includes sample of first 5 stat definitions for debugging
  - Validates authentication and Yahoo account linkage
  - Useful for local testing and verification

### League Discovery

**Status**: Completed (2024-12-01)

- League discovery and parsing from Yahoo Fantasy API via `lib/yahoo/leagues.ts`
- Leagues persisted in Prisma `League` model
- League sync endpoint at `/api/yahoo/leagues` for fetching and storing user leagues

**Implementation Details**:
- League helper (`lib/yahoo/leagues.ts`):
  - Fetches user leagues from Yahoo Fantasy API `/users;use_login=1/games/leagues` endpoint
  - Parses and normalizes league data into typed `YahooLeague` interface
  - Handles various XML response structures using flexible path matching
  - Extracts league key, name, season, sport, and team count
  - Defensive parsing with `normalizeYahooNode` and `findFirstPath` utilities
- League persistence:
  - `syncUserLeagues()` function upserts leagues into database
  - Unique constraint on `userId + leagueKey` ensures one record per league per user
  - Updates existing leagues with latest data from Yahoo API
  - Returns stored league list after sync
- League model schema:
  - Stores league metadata: key, name, season, sport, team count
  - Foreign key relationship to User with cascade delete
  - Timestamps for created and updated tracking

### Team Standings

**Status**: Completed (2024-12-01)

- Team standings parsing and persistence from Yahoo Fantasy API via `lib/yahoo/standings.ts`
- Teams and standings persisted in Prisma `Team` and `TeamStanding` models
- Standings sync endpoint at `/api/yahoo/standings` for fetching and storing league standings
- **Verified working**: Successfully displays standings with wins, losses, ties, and ranks for all teams

**Implementation Details**:
- Standings helper (`lib/yahoo/standings.ts`):
  - Fetches league standings from Yahoo Fantasy API `/league/{leagueKey}/standings` endpoint
  - Parses XML response using `parseYahooXml` and `findFirstPath` utilities
  - Handles league key normalization (converts `465.1.9080` to `465.l.9080` for database lookup)
  - Extracts team standings data: wins, losses, ties, rank, points for/against
  - Uses flexible path matching: `fantasy_content.league.standings.teams.team` (without numeric indices)
  - Defensive parsing with `normalizeYahooNode` for nested structures
  - Fetches league standings from Yahoo Fantasy API `/league/{leagueKey}/standings` endpoint
  - Parses and normalizes standings data into typed `YahooTeamStanding` interface
  - Handles various XML response structures using flexible path matching
  - Extracts team key, name, manager name, wins, losses, ties, rank, points for/against
  - Defensive parsing with `normalizeYahooNode` and `findFirstPath` utilities
- Standings persistence:
  - `syncLeagueStandings()` function upserts teams and standings into database
  - Automatically syncs leagues if league not found in database
  - Unique constraint on `leagueId + teamKey` ensures one record per team per league
  - Unique constraint on `teamId` ensures one standing record per team
  - Updates existing teams and standings with latest data from Yahoo API
  - Returns stored standings list after sync
- Team and TeamStanding model schema:
  - Team stores: key, name, manager name (optional)
  - TeamStanding stores: wins, losses, ties, points for/against (optional), rank (optional)
  - Foreign key relationships with cascade delete from League to Team to TeamStanding
  - Timestamps for created and updated tracking

### Roster Parsing

**Status**: Completed (2024-12-01)

- Roster parsing and persistence from Yahoo Fantasy API via `lib/yahoo/roster.ts`
- Players and roster entries persisted in Prisma `Player` and `RosterEntry` models
- Roster sync endpoint at `/api/yahoo/roster` for fetching and storing league rosters
- **Verified working**: Successfully displays complete rosters with players, positions, slots, and status (bench/IR) for all teams

### Player Stats

**Status**: Completed (2024-12-02)

- Player stats fetching from Yahoo Fantasy API via `lib/yahoo/playerStats.ts`
- Stats fetched in batches using: `league/{leagueKey}/players;player_keys={keys}/stats`
- Stats stored in `PlayerStat` model with stat ID, name, and value
- Stat names resolved using stat definitions from Yahoo API
- Trade Builder automatically syncs stats when loading trade data
- Manual stat sync available via `/api/league/[leagueKey]/sync-stats` endpoint
- Uses native Node.js https module instead of fetch to handle Yahoo's non-standard HTTP status codes
- Includes User-Agent header to avoid bot detection
- Fetches up to 174 players per league in batches of 25
- Successfully stores all stats (goals, assists, points, +/-, PIM, PPP, saves, wins, GAA, etc.)

**Trade Builder UI Features**:
- Skaters and goalies displayed in separate sections with appropriate stat headers
- Value column prominently displayed as first column with blue highlighting
- Dual position eligibility displayed (e.g., C/RW, LW/RW)
- Injury status badges (IR, IR+, O) shown in red next to player names
- Clickable column headers to sort by any stat (ascending/descending)
- Color-coded stats: Goals (green), Assists (blue), Points (purple), PPP (orange), Wins (green), Saves (blue), Shutouts (purple)
- Alternating row colors and hover effects for better readability
- Top and bottom synchronized scrollbars for wide stat tables

**Known Issues**:
- Yahoo Fantasy API returns HTTP 999 status code when tokens are expiring or rate limiting occurs
- If you see "Request denied" errors, re-authenticate at `/api/auth/yahoo/start`
- Yahoo tokens typically last 1 hour; system detects expiry and provides re-auth prompts

**Multi-User Access**:
- Anyone can create an account and link their Yahoo Fantasy account
- Each user sees the same leagues they have access to in Yahoo
- Mobile browsers (especially Safari) may have issues with OAuth cookies:
  - If you get "Invalid state" error, try again from a desktop browser
  - Or enable "Prevent Cross-Site Tracking" to be OFF in Safari settings
  - The OAuth flow must complete within 10 minutes
- All cookies now use secure flag (required for HTTPS Cloudflare tunnels)

### Trade Builder

**Status**: Completed (2024-12-01)

- Trade evaluation tool for comparing player and draft pick trades between teams
- Player value calculation and storage via `lib/yahoo/playerValues.ts`
- Draft pick value management with configurable round values
- Trade Builder UI page at `/league/[leagueKey]/trade` for interactive trade construction
- Trade data API endpoint at `/api/league/[leagueKey]/trade-data` for fetching all trade-related data

**Implementation Details**:
- Roster helper (`lib/yahoo/roster.ts`):
  - Fetches league rosters from Yahoo Fantasy API `/league/{leagueKey}/teams;out=roster` endpoint
  - Falls back to `/league/{leagueKey}/teams` if roster endpoint fails
  - Parses XML response using `parseYahooXml` and `findFirstPath` utilities
  - Handles league key normalization (converts `465.1.9080` to `465.l.9080` for database lookup)
  - Extracts player data: name, team abbreviation, positions, primary position, status
  - Extracts roster entry data: team key, player key, Yahoo position, bench/IR status
  - Uses flexible path matching: `fantasy_content.league.teams.team` (without numeric indices)
  - Defensive parsing with `normalizeYahooNode` and `flattenYahooPlayerNode` utilities
  - Fetches league rosters from Yahoo Fantasy API `/league/{leagueKey}/teams;out=roster` endpoint
  - Falls back to `/league/{leagueKey}/teams` if primary endpoint fails
  - Parses and normalizes roster data into typed `YahooPlayer` and `YahooRosterEntry` interfaces
  - Handles various XML response structures using flexible path matching
  - Extracts player key, name, team abbreviation, positions, primary position, status
  - Extracts roster entries with Yahoo position, bench status, and injured list status
  - Defensive parsing with `normalizeYahooNode` and `findFirstPath` utilities
- Roster persistence:
  - `syncLeagueRosters()` function upserts players and creates roster entries
  - Automatically syncs leagues and standings if not found in database
  - Clears existing roster entries for league before inserting new ones
  - Unique constraint on `playerKey` ensures one record per player
  - Updates existing players with latest data from Yahoo API
  - Returns stored roster list grouped by team after sync
- Player and RosterEntry model schema:
  - Player stores: key (unique), name, team abbreviation (optional), positions (optional), primary position (optional), status (optional)
  - RosterEntry stores: user, league, team, player references, Yahoo position (optional), bench flag, injured list flag
  - Foreign key relationships with cascade delete from User/League/Team/Player to RosterEntry
  - Timestamps for created and updated tracking

### Auth Route Error Handling

**Status**: Completed (2024-12-01)

- Improved error handling in signup and signin routes
- All routes now return structured JSON errors instead of throwing unhandled exceptions
- Duplicate signup attempts return 400 with "Email already in use" message
- Invalid signin attempts return 401 with "Invalid email or password" message
- Login and signup UI pages display backend error messages correctly
- Fixed DATABASE_URL path issue (was pointing to wrong location)

### Frontend UI

**Status**: Completed (2024-12-01)

- Basic frontend UI implemented for authentication, Yahoo status, leagues, and league details
- Default Next.js starter page replaced with authentication-based redirect
- Login and signup pages with form validation and error handling
- Dashboard page showing Yahoo account linkage status
- Leagues list page displaying user's Yahoo Fantasy leagues
- League detail page showing standings and rosters
- Navigation layout with authenticated user menu

**Implementation Details**:
- Home page (`app/page.tsx`):
  - Server component that checks authentication status
  - Redirects to `/login` if not authenticated
  - Redirects to `/dashboard` if authenticated
- Authentication pages:
  - Login page (`app/login/page.tsx`): Client component with email/password form, validation, error display
  - Signup page (`app/signup/page.tsx`): Client component with email/password form, validation, error display
  - Both pages use existing auth client helpers from `lib/auth/client.ts`
  - Form validation: non-empty email, password minimum 8 characters
  - Loading states and disabled buttons during submission
- Dashboard page (`app/dashboard/page.tsx`):
  - Server component with authentication check
  - Fetches Yahoo status from `/api/yahoo/status`
  - Shows Yahoo linkage status, user ID, token expiry
  - Provides "Connect Yahoo" button if not linked
  - Provides "View Leagues" link if linked
- Leagues page (`app/leagues/page.tsx`):
  - Server component with authentication check
  - Fetches leagues from `/api/yahoo/leagues`
  - Displays list of leagues with name, season, sport, team count
  - Links to league detail pages
- League detail page (`app/league/[leagueKey]/page.tsx`):
  - Server component with authentication check
  - Reads leagueKey from route parameters
  - Parallel fetches for standings and rosters
  - Standings table: rank, team name, manager, wins, losses, ties
  - Rosters section: grouped by team, shows player name, position, slot, status (bench/IR)
  - Independent error handling for standings and rosters
- Navigation layout (`app/layout.tsx`):
  - Server component that checks authentication
  - Shows navigation bar only for authenticated users
  - Navigation includes: brand (AiTradr), Dashboard link, Leagues link, Sign out button
  - Sign out button is client component that POSTs to `/api/auth/signout`
- Styling:
  - Uses Tailwind CSS with existing project styles
  - Simple, clean design focused on clarity
  - Dark mode support using existing dark: classes
  - Responsive layout with container and proper spacing

## Completed Features

### Authentication

- [x] Prisma setup with SQLite
- [x] User model with email and password hash
- [x] YahooAccount model with OAuth token storage
- [x] Session handling utilities
- [x] API routes: POST /api/auth/signup, /api/auth/signin, /api/auth/signout
- [x] Client-side auth helpers

### Yahoo OAuth

- [x] Yahoo config module with environment variable validation
- [x] Yahoo OAuth start route with CSRF protection
- [x] Yahoo OAuth callback route with token exchange
- [x] Yahoo status endpoint for checking linkage
- [x] Client-side Yahoo helpers
- [x] Status page UI for Yahoo account linkage

### Yahoo Fantasy API Client

- [x] Server-side Yahoo Fantasy API client module
- [x] User and YahooAccount resolution from request session
- [x] Token expiration validation
- [x] XML to JSON normalization utilities
- [x] Health check endpoint for local debugging

### Season Detection and Stat Definitions

- [x] Season helper module with caching
- [x] Stat definitions helper module with caching
- [x] Metadata debug endpoint for validation

### League Discovery

- [x] League model added to Prisma schema
- [x] League parsing module with Yahoo API integration
- [x] League sync function to persist leagues
- [x] Leagues API endpoint for fetching and syncing
- [x] Client-side helper for leagues

### Team Standings

- [x] Team and TeamStanding models added to Prisma schema
- [x] Standings parsing module with Yahoo API integration
- [x] Standings sync function to persist teams and standings
- [x] Standings API endpoint for fetching and syncing

### Roster Parsing

- [x] Player and RosterEntry models added to Prisma schema
- [x] Roster parsing module with Yahoo API integration
- [x] Roster sync function to persist players and roster entries
- [x] Roster API endpoint for fetching and syncing

### Trade Builder

- [x] PlayerValue and DraftPickValue models added to Prisma schema
- [x] Player value calculation module with position-based scoring
- [x] Draft pick value initialization script
- [x] Trade data API endpoint for fetching teams, rosters, and pick values
- [x] Trade Builder UI page with team selectors, roster tables, and trade summary
- [x] Trade evaluation with value totals and advantage calculation

### Frontend UI (Current Step)

- [x] Default Next.js starter page replaced with auth redirect
- [x] Login and signup pages with form validation
- [x] Dashboard page showing Yahoo account status
- [x] Leagues list page
- [x] League detail page with standings and rosters
- [x] Navigation layout with authenticated user menu

## TODOs

### Authentication

- [ ] Hardening security for production (rate limiting, additional CSRF protection)
- [ ] Email verification flow
- [ ] Password reset flow

### Yahoo OAuth

- [ ] Token refresh logic implementation
- [ ] Production configuration hardening (enforce https only, stricter cookie flags)
- [ ] Expand OAuth scopes or add separate Fantasy API client modules

### Yahoo Fantasy API

- [ ] Implement player stats parsing using stat definitions
- [ ] Add token refresh handling in fantasy client
- [ ] Use stat definitions for player stats parsing
- [ ] Add tests to ensure season and stat definitions remain stable across future Yahoo API changes

### Frontend UI

- [ ] Improve UI styling and visual design
- [ ] Add filters or search on leagues page
- [ ] Add richer team and player detail views
- [ ] Add loading states and skeleton screens
- [ ] Add error boundaries for better error handling

## Technical Stack

- **Framework**: Next.js 16.0.6 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Database**: SQLite (development), Prisma ORM
- **React**: 19.2.0

## Project Structure

```
/app
  /api/auth
    /signup     - POST /api/auth/signup
    /signin     - POST /api/auth/signin
    /signout    - POST /api/auth/signout
    /yahoo
      /start     - GET /api/auth/yahoo/start (initiates OAuth flow)
      /callback  - GET /api/auth/yahoo/callback (handles OAuth callback)
      /status    - GET /api/auth/yahoo/status (checks linkage status)
  /api/yahoo
    /health     - GET /api/yahoo/health (validates Yahoo Fantasy API connection)
    /metadata   - GET /api/yahoo/metadata (returns game metadata, season, stat definitions)
    /leagues    - GET /api/yahoo/leagues (fetches and syncs user leagues)
    /standings  - GET /api/yahoo/standings?leagueKey=... (fetches and syncs league standings)
    /roster     - GET /api/yahoo/roster?leagueKey=... (fetches and syncs league rosters)
  /api/league
    /[leagueKey]/trade-data - GET /api/league/[leagueKey]/trade-data (returns trade data for Trade Builder)
  /yahoo
    /status     - /yahoo/status (status page UI)
  /league
    /[leagueKey] - /league/[leagueKey] (league detail page with standings and rosters)
    /[leagueKey]/trade - /league/[leagueKey]/trade (Trade Builder page)
/lib
  /auth
    session.ts   - Session creation, verification, cookie management
    password.ts  - Password hashing and verification
    validation.ts - Email and password validation
    client.ts    - Client-side auth helper functions
    csrf.ts      - CSRF state token generation and verification
    index.ts     - Auth module exports
  /yahoo
    config.ts           - Yahoo OAuth configuration and environment validation
    client.ts           - Client-side Yahoo helper functions
    fantasyClient.ts    - Server-side Yahoo Fantasy API client
    normalize.ts        - XML to JSON normalization utilities
    season.ts           - Season detection from Yahoo game endpoint
    statDefinitions.ts  - Stat definitions retrieval and caching
    leagues.ts          - League discovery and parsing from Yahoo API
    standings.ts        - Team standings parsing and persistence
    roster.ts           - Roster parsing and player persistence
    playerValues.ts     - Player value calculation and management
/components
  SignOutButton.tsx     - Client component for sign out functionality
  prisma.ts      - Prisma client singleton
/prisma
  schema.prisma  - Database schema
  migrations/    - Database migrations
```

## Environment Variables

Required environment variables (add to `.env`):

```
DATABASE_URL="file:./dev.db"
AUTH_SECRET="your-secret-key-here-minimum-32-characters"
YAHOO_CLIENT_ID="your-yahoo-client-id"
YAHOO_CLIENT_SECRET="your-yahoo-client-secret"
YAHOO_REDIRECT_URI="http://localhost:3000/api/auth/yahoo/callback"
YAHOO_GAME_KEY=""  # Optional, for future Fantasy API use
```

**Notes**:
- Generate a secure random string for `AUTH_SECRET`. In production, use a strong secret (at least 32 characters).
- `YAHOO_REDIRECT_URI` must match exactly what is configured in your Yahoo app settings.
- In production, `YAHOO_REDIRECT_URI` must use https.
- In development, `YAHOO_REDIRECT_URI` can use http for localhost only.
- `YAHOO_REDIRECT_URI` must not have a trailing slash.

## API Routes

### POST /api/auth/signup

Creates a new user account.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response** (201):
```json
{
  "user": {
    "id": "clx...",
    "email": "user@example.com"
  }
}
```

**Errors**:
- 400: Email already in use, invalid email format, password too short
- 500: Internal server error

### POST /api/auth/signin

Signs in an existing user.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response** (200):
```json
{
  "user": {
    "id": "clx...",
    "email": "user@example.com"
  }
}
```

**Errors**:
- 400: Missing email or password, invalid email format
- 401: Invalid credentials
- 500: Internal server error

### POST /api/auth/signout

Signs out the current user by destroying the session cookie.

**Response** (200):
```json
{
  "success": true
}
```

### GET /api/auth/yahoo/start

Initiates the Yahoo OAuth flow. Requires user to be authenticated.

**Response** (302):
- Redirects to Yahoo authorization URL

**Errors**:
- 401: Not authenticated

### GET /api/auth/yahoo/callback

Handles the OAuth callback from Yahoo. Requires user to be authenticated.

**Query Parameters**:
- `code`: Authorization code from Yahoo
- `state`: CSRF state token
- `error`: Error code (if authorization failed)

**Response** (302):
- Redirects to `/yahoo/status?success=true` on success
- Redirects to `/yahoo/status?error=...` on error

**Errors**:
- 400: Missing code, invalid state
- 401: Not authenticated
- 500: Token exchange failed, internal server error

### GET /api/auth/yahoo/status

Returns the Yahoo account linkage status for the current user.

**Response** (200):
```json
{
  "linked": true,
  "authenticated": true,
  "yahooUserId": "guid...",
  "expiresAt": "2024-12-08T12:00:00.000Z",
  "linkedAt": "2024-12-01T10:00:00.000Z"
}
```

**Response** (200, not linked):
```json
{
  "linked": false,
  "authenticated": true
}
```

**Response** (200, not authenticated):
```json
{
  "linked": false,
  "authenticated": false
}
```

### GET /api/yahoo/health

Validates that the current user has a linked Yahoo account and can successfully call Yahoo Fantasy API endpoints. Used for local debugging and validation.

**Response** (200, success):
```json
{
  "ok": true,
  "sample": { /* parsed Yahoo Fantasy API response */ }
}
```

**Response** (400, not linked):
```json
{
  "ok": false,
  "error": "Yahoo account not linked"
}
```

**Response** (401, not authenticated or token expired):
```json
{
  "ok": false,
  "error": "Not authenticated"
}
```
or
```json
{
  "ok": false,
  "error": "Yahoo access token expired"
}
```

**Response** (500, API error):
```json
{
  "ok": false,
  "error": "Yahoo Fantasy API error: 401 Unauthorized"
}
```

**Notes**:
- Calls Yahoo Fantasy `/game` endpoint (or `/game/{game_key}` if YAHOO_GAME_KEY is set)
- Returns normalized JSON from Yahoo's XML response
- Logs errors with status, endpoint, and body snippets (never logs tokens)

### GET /api/yahoo/metadata

Returns current game metadata including season and stat definitions summary. Used for local debugging and validation.

**Response** (200, success):
```json
{
  "ok": true,
  "gameKey": "414",
  "season": "2025",
  "statDefinitionsSummary": {
    "count": 25,
    "sample": [
      {
        "stat_id": "0",
        "name": "Games Played",
        "display_name": "Games Played"
      },
      {
        "stat_id": "1",
        "name": "Goals",
        "display_name": "Goals"
      }
    ]
  }
}
```

**Response** (400, not linked):
```json
{
  "ok": false,
  "error": "Yahoo account not linked"
}
```

**Response** (401, not authenticated or token expired):
```json
{
  "ok": false,
  "error": "Not authenticated"
}
```
or
```json
{
  "ok": false,
  "error": "Yahoo access token expired"
}
```

**Response** (500, configuration or API error):
```json
{
  "ok": false,
  "error": "YAHOO_GAME_KEY is not configured"
}
```

**Notes**:
- Requires YAHOO_GAME_KEY to be configured
- Returns resolved season as four-digit year string
- Includes count and sample of stat definitions
- Uses cached season and stat definitions if available
- Logs errors with minimal information (never logs tokens)

### GET /api/yahoo/leagues

Fetches and syncs leagues for the current signed-in user. Requires authentication and Yahoo account linkage.

**Response** (200, success):
```json
{
  "ok": true,
  "leagues": [
    {
      "leagueKey": "414.l.123456",
      "name": "My Fantasy League",
      "season": "2025",
      "sport": "nhl",
      "teamCount": 12
    }
  ]
}
```

**Response** (400, not linked):
```json
{
  "ok": false,
  "error": "Yahoo account not linked"
}
```

**Response** (401, not authenticated or token expired):
```json
{
  "ok": false,
  "error": "Not authenticated"
}
```
or
```json
{
  "ok": false,
  "error": "Yahoo access token expired"
}
```

**Response** (404, no leagues):
```json
{
  "ok": false,
  "error": "No leagues found for user"
}
```

**Notes**:
- Calls Yahoo Fantasy API `/users;use_login=1/games/leagues` endpoint
- Automatically syncs leagues to database (upsert by userId + leagueKey)
- Returns stored league data after sync
- Updates existing leagues with latest information from Yahoo
- Logs errors with minimal information (never logs tokens)

### GET /api/yahoo/standings

Fetches and syncs team standings for a specific league. Requires authentication, Yahoo account linkage, and leagueKey query parameter.

**Query Parameters**:
- `leagueKey` (required): The Yahoo league key (e.g., "414.l.123456")

**Response** (200, success):
```json
{
  "ok": true,
  "leagueKey": "414.l.123456",
  "standings": [
    {
      "teamKey": "414.l.123456.t.1",
      "teamName": "Team Name",
      "managerName": "Manager Name",
      "wins": 10,
      "losses": 2,
      "ties": 0,
      "rank": 1,
      "pointsFor": 1234.5,
      "pointsAgainst": 1100.0
    }
  ]
}
```

**Response** (400, missing leagueKey or not linked):
```json
{
  "ok": false,
  "error": "leagueKey is required"
}
```
or
```json
{
  "ok": false,
  "error": "Yahoo account not linked"
}
```

**Response** (401, not authenticated or token expired):
```json
{
  "ok": false,
  "error": "Not authenticated"
}
```
or
```json
{
  "ok": false,
  "error": "Yahoo access token expired"
}
```

**Response** (404, league or standings not found):
```json
{
  "ok": false,
  "error": "League not found for user"
}
```
or
```json
{
  "ok": false,
  "error": "No standings found for league 414.l.123456"
}
```

**Notes**:
- Calls Yahoo Fantasy API `/league/{leagueKey}/standings` endpoint
- Automatically syncs leagues if league not found in database
- Automatically syncs teams and standings to database (upsert by leagueId + teamKey)
- Returns stored standings data after sync
- Updates existing teams and standings with latest information from Yahoo
- Logs errors with minimal information (never logs tokens)

### GET /api/yahoo/roster

Fetches and syncs rosters for a specific league. Requires authentication, Yahoo account linkage, and leagueKey query parameter.

**Query Parameters**:
- `leagueKey` (required): The Yahoo league key (e.g., "414.l.123456")

**Response** (200, success):
```json
{
  "ok": true,
  "leagueKey": "414.l.123456",
  "rosters": [
    {
      "teamKey": "414.l.123456.t.1",
      "teamName": "Team Name",
      "managerName": "Manager Name",
      "entries": [
        {
          "playerKey": "414.p.12345",
          "playerName": "Player Name",
          "yahooPosition": "C",
          "isBench": false,
          "isInjuredList": false
        }
      ]
    }
  ]
}
```

**Response** (400, missing leagueKey or not linked):
```json
{
  "ok": false,
  "error": "leagueKey is required"
}
```
or
```json
{
  "ok": false,
  "error": "Yahoo account not linked"
}
```

**Response** (401, not authenticated or token expired):
```json
{
  "ok": false,
  "error": "Not authenticated"
}
```
or
```json
{
  "ok": false,
  "error": "Yahoo access token expired"
}
```

**Response** (404, league or rosters not found):
```json
{
  "ok": false,
  "error": "League not found for user"
}
```
or
```json
{
  "ok": false,
  "error": "No rosters found for league 414.l.123456"
}
```

**Notes**:
- Calls Yahoo Fantasy API `/league/{leagueKey}/teams;out=roster` endpoint (falls back to `/league/{leagueKey}/teams` if needed)
- Automatically syncs leagues and standings if not found in database
- Clears existing roster entries for league before inserting new ones
- Automatically upserts players by playerKey
- Creates new roster entries for each player on each team
- Returns stored roster data grouped by team after sync
- Updates existing players with latest information from Yahoo
- Logs errors with minimal information (never logs tokens)

### GET /api/league/[leagueKey]/trade-data

Returns all data needed for the Trade Builder feature, including teams, rosters with player values, and draft pick values.

**Response** (200, success):
```json
{
  "ok": true,
  "data": {
    "leagueKey": "465.l.9080",
    "leagueName": "My Fantasy League",
    "teams": [
      {
        "id": "clx...",
        "name": "Team Name",
        "managerName": "Manager Name",
        "roster": [
          {
            "playerId": "clx...",
            "yahooPlayerId": "465.p.12345",
            "name": "Player Name",
            "nhlTeam": "BOS",
            "position": "C",
            "valueScore": 50.0
          }
        ]
      }
    ],
    "draftPickValues": [
      {
        "round": 1,
        "score": 80.0
      }
    ]
  }
}
```

**Response** (400, not linked):
```json
{
  "ok": false,
  "error": "Yahoo account not linked"
}
```

**Response** (401, not authenticated or token expired):
```json
{
  "ok": false,
  "error": "Not authenticated"
}
```

**Response** (404, league not found):
```json
{
  "ok": false,
  "error": "League not found: 465.l.9080"
}
```

**Notes**:
- Automatically calculates player values if they don't exist yet
- Returns empty array for draftPickValues if not initialized (use init script)
- Player values are calculated using position-based heuristics (can be improved with stats)
- Requires authentication and Yahoo account linkage
- Logs errors with minimal information (never logs tokens)

## Usage Examples

### Server-Side Session Retrieval

```typescript
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // session.userId is available
  return Response.json({ userId: session.userId });
}
```

### Client-Side Authentication

```typescript
import { signup, signin, signout } from "@/lib/auth/client";

// Sign up
const result = await signup("user@example.com", "password123");
if (result.error) {
  console.error(result.error);
} else {
  console.log("User:", result.user);
}

// Sign in
const signinResult = await signin("user@example.com", "password123");

// Sign out
await signout();
```

### Yahoo OAuth Flow

```typescript
import { startYahooAuth, getYahooStatus } from "@/lib/yahoo/client";

// Check Yahoo linkage status
const status = await getYahooStatus();
if (!status.linked && status.authenticated) {
  // Start OAuth flow (redirects to Yahoo)
  startYahooAuth();
}

// After OAuth callback, check status again
const updatedStatus = await getYahooStatus();
if (updatedStatus.linked) {
  console.log("Yahoo User ID:", updatedStatus.yahooUserId);
  console.log("Token expires:", updatedStatus.expiresAt);
}
```

### Yahoo Fantasy API Client Usage

```typescript
import { getYahooFantasyClientForRequest } from "@/lib/yahoo/fantasyClient";
import { parseYahooXml } from "@/lib/yahoo/normalize";

export async function GET(request: NextRequest) {
  // Get authenticated client for current user
  const client = await getYahooFantasyClientForRequest(request);
  
  // Make request to Yahoo Fantasy API
  const xmlResponse = await client.request("game");
  
  // Parse XML to JSON
  const parsed = await parseYahooXml(xmlResponse);
  
  return Response.json({ data: parsed });
}
```

**Error Handling**:
```typescript
import {
  YahooNotLinkedError,
  YahooTokenExpiredError,
  YahooFantasyError,
} from "@/lib/yahoo/fantasyClient";

try {
  const client = await getYahooFantasyClientForRequest(request);
  const response = await client.request("league/123");
} catch (error) {
  if (error instanceof YahooNotLinkedError) {
    // Handle not linked
  } else if (error instanceof YahooTokenExpiredError) {
    // Handle expired token (refresh logic needed)
  } else if (error instanceof YahooFantasyError) {
    // Handle API error
    console.error(`Yahoo API error: ${error.status} on ${error.endpoint}`);
  }
}
```

### Trade Builder Usage

**Initializing Draft Pick Values**:
```bash
# Initialize draft pick values for a league
tsx scripts/init-draft-pick-values.ts 465.l.9080
```

This script creates or updates draft pick values for rounds 1-16 with a descending scale (Round 1: 80, Round 2: 70, etc.).

**Accessing Trade Builder**:
1. Navigate to a league detail page: `/league/[leagueKey]`
2. Click the "Open Trade Builder" button
3. Select Team A and Team B from the dropdowns
4. Select players and draft picks to include in the trade
5. View the trade summary with value totals and advantage calculation

**Player Value Calculation**:
- Player values are automatically calculated from actual Yahoo Fantasy stats
- Comprehensive formula weights all scoring categories: G, A, +/-, PIM, PPP, SHP, GWG, SOG, FW, HIT, BLK
- Goalie formula: Wins, Saves, SV%, Shutouts (with penalties for losses and GA)
- Values stored in `PlayerValue` model, one per player per league
- Formula designed to match Yahoo's player rankings (MacKinnon ~226, top players 150-225, mid-tier 80-120)

**Draft Pick Value Calculation**:
- Draft pick values calculated dynamically based on actual player values in the league
- Each round represents the average value of players in that draft tier
- Round 1 = Top tier players (e.g., 150-200+ value)
- Round 2-3 = Elite players (e.g., 120-150 value)
- Round 4-6 = Strong players (e.g., 80-120 value)
- Later rounds = Depth/streaming players
- Automatically recalculated whenever player values update
- Reflects real-world trade value: what caliber of player you'd actually draft

**Trade Evaluation**:
- Trade Builder calculates totals for what each team receives
- Shows advantage calculation: "Advantage: Team A by X" or "Even trade"
- Values update instantly as players/picks are added or removed
- Trade state is client-only and cleared on page reload

