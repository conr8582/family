# Project Memory

Live decisions log — updated after each chunk and whenever scope or decisions change.
This is the source of truth for "what's actually been decided and built."
The PRD (`../Financial Tracker PRD.rtf`) is "what we originally planned."

---

## Status

| Chunk | Description | Status |
|---|---|---|
| 1 | Project scaffold + Docker | ✅ Done |
| 2 | Database schema + seed data | ✅ Done |
| 3 | SimpleFIN integration + backfill | ✅ Done |
| 4 | Daily cron sync | ✅ Done |
| 5 | Auth + login screen | ✅ Done |
| 6 | Daily review screen | ✅ Done |
| 7 | Monthly budget screen | ✅ Done |
| 8 | VPS deployment | Not started |

---

## Decisions

### Stack
- **Backend:** Node.js + Express
- **Templates:** Nunjucks (server-rendered HTML, no build step)
- **Database:** SQLite via `better-sqlite3`
- **Auth:** `express-session` + `bcryptjs`, credentials from env vars
- **Cron:** `node-cron` (in-process, runs at `SYNC_HOUR` env var, default 6am)
- **Reverse proxy:** Caddy (auto HTTPS)
- **Container:** Docker + docker-compose

### Categories
- **"Caroline Card"** stays as its own category ($1,700/mo budget). Catch-all for Caroline's credit card — her transactions are not broken down further.
- **Income** uses a single "Income" category (not 3 sub-categories for Thumbtack / Frances Goldin / Trust Income).
- **Transfers** use "Internal Transfer" (Type = transfer), excluded from all spend/income totals.

### Data model
- Amounts stored as **integer cents** (no float rounding).
- `transactions.reimbursable` enum: `none` | `reimbursable` | `reimbursement`
- `transactions.reviewed` boolean — daily review screen shows reviewed=false rows only.
- `categories.type` enum: `income` | `expense` | `transfer`

### Out of scope (hard boundary — ask before building)
- Yearly P&L view
- Historical months beyond current month (June 2026)
- Bank accounts beyond Chase
- Multi-user / per-user permissions
- Mobile-native app

---

## Environment variables (see `.env.example`)
| Var | Purpose |
|---|---|
| `PORT` | Server port (default 3000) |
| `APP_USERNAME` | Login username |
| `APP_PASSWORD_HASH` | bcrypt hash of login password |
| `SESSION_SECRET` | Random string for session signing |
| `SIMPLEFIN_SETUP_TOKEN` | One-time claim token from simplefin.org |
| `SYNC_HOUR` | Hour to run daily sync (24h, default 6) |
| `DB_PATH` | Path to SQLite file (default `./data/finance.db`) |

---

## Notes
- Typos from the spreadsheet (Grocers, Unkown, Inculde, etc.) normalized to canonical category names.
- "Needs Review" exists as a category for transactions deferred without a real category.
- `node-sqlite3-wasm` quirks: params must be arrays (`stmt.run([a,b])`); no WAL mode; leaves a `.lock` directory that is auto-cleaned on startup if >60s old; scripts must not run concurrently with the server.
- Dev password for `.env` is `barry2026` — change before deploying with `npm run hash-password`.
- SimpleFIN pulled 7 accounts (not 4): two checking, two savings, Freedom Flex, Sapphire Reserve, Rapid Rewards Premier. All syncing.
- Category combobox uses type-to-filter with vanilla JS (no library). `window.CATEGORIES` JSON injected once per page load.
- 205 transactions backfilled from June 1–26. One (id=2) marked reviewed as a test.
