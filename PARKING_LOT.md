# Parking Lot

Future ideas to revisit. Not in scope for the current build.

---

## Navan reimbursement reconciliation

**The problem:** Navan deposits show up as income but represent expense reimbursements. Barry needs confidence that every `reimbursable` expense has a corresponding Navan deposit — i.e., he hasn't been left unpaid.

**What this would look like:**
- A way to link a `reimbursement` income transaction (the Navan deposit) to one or more `reimbursable` expense transactions it covers
- A view that shows open/unmatched reimbursable expenses (money spent, not yet paid back) vs. matched ones
- Possibly a running balance: total reimbursable outstanding vs. total reimbursements received

**Why deferred:** Requires a new data relationship (expense ↔ reimbursement matching), a UI for linking them, and a reconciliation view. Solid chunk of work — revisit after the core app is stable.

---

## "What is this?" merchant lookup

**The problem:** Bank transaction descriptions are often garbled (`SQ *THE MAIL AND MORE STO`, `SEAMLSS*KULUSHKAT`, etc.) and it's not always obvious what the charge is.

**What this would look like:**
- A small `?` icon next to each transaction description on the review screen
- Clicking it calls the Claude API with the raw description + amount + date as context
- Claude uses web search to identify the merchant and returns a one-line answer ("Square payment to The Mail and More Store, a shipping/mailbox service")
- Answer appears inline below the transaction, no page reload

**Implementation notes:**
- Backend endpoint: `POST /api/transactions/:id/lookup` — calls Anthropic API with `claude-haiku` (fast + cheap) and the `web_search` tool
- Need `ANTHROPIC_API_KEY` added to `.env`
- Responses could be cached in a `transaction_notes_auto` column so repeat lookups don't re-call the API
- Should make clear in the UI that it's an AI guess, not definitive

**Why deferred:** Requires Anthropic API key + billing, adds an external dependency, and is a nice-to-have rather than core to the budget tracking goal.

---

## Category drill-down on the budget screen

**The problem:** The budget screen shows a single Actual total per category but gives no visibility into what's underneath it — e.g. why is Household $440 this month?

**What this would look like:**
- Click a category row → expands inline (accordion) or opens a modal showing all reviewed transactions in that category for the current month
- Each transaction shows: date, description, account, amount
- Ideally inline/accordion rather than modal, since it keeps context
- Bonus: click a transaction to jump to it in Filed for editing

**Implementation notes:**
- Backend: `GET /api/budget/:categoryId/transactions?month=2026-06` returning the relevant rows
- Frontend: click handler on category row fetches and renders the list inline, toggle to collapse
- Small amount of JS, reuses existing transaction display styles

**Why deferred:** Core budget view works without it; useful once there's enough reviewed data to want to investigate specific categories.

---

## Historical data import for year-long P&L

**The problem:** Barry has already categorized Jan–May 2026 in his spreadsheet. Pulling that history into the app would enable a full year-to-date P&L view rather than just the current month.

**Two distinct sub-problems:**

1. **Raw transaction history from SimpleFIN** — SimpleFIN supports ~90 days of history, so extending the backfill date range would cover roughly April–June. This is a small change to `scripts/backfill.js` (change `startOfCurrentMonth()` to a fixed earlier date). Transactions would come in unreviewed and need to be tagged.

2. **Import already-categorized data from the spreadsheet** — The spreadsheet has Jan–May 2026 with categories already applied. A one-time import script could read the XLSX, map the spreadsheet category names to the app's category IDs, and insert transactions as reviewed. Tricky parts: account name mapping (CC1/CC2 → actual account IDs), handling the status column (Include/Transfer excluded/Reimbursed), and deduplication against anything SimpleFIN already pulled.

**Implementation order:** Do the SimpleFIN history extension first (easy), then decide if the spreadsheet import is worth the mapping work.

**Note:** This was explicitly out of scope in the original PRD — flagged here as a conscious revisit, not an oversight.
