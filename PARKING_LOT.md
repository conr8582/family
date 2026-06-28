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

## Historical data import for year-long P&L

**The problem:** Barry has already categorized Jan–May 2026 in his spreadsheet. Pulling that history into the app would enable a full year-to-date P&L view rather than just the current month.

**Two distinct sub-problems:**

1. **Raw transaction history from SimpleFIN** — SimpleFIN supports ~90 days of history, so extending the backfill date range would cover roughly April–June. This is a small change to `scripts/backfill.js` (change `startOfCurrentMonth()` to a fixed earlier date). Transactions would come in unreviewed and need to be tagged.

2. **Import already-categorized data from the spreadsheet** — The spreadsheet has Jan–May 2026 with categories already applied. A one-time import script could read the XLSX, map the spreadsheet category names to the app's category IDs, and insert transactions as reviewed. Tricky parts: account name mapping (CC1/CC2 → actual account IDs), handling the status column (Include/Transfer excluded/Reimbursed), and deduplication against anything SimpleFIN already pulled.

**Implementation order:** Do the SimpleFIN history extension first (easy), then decide if the spreadsheet import is worth the mapping work.

**Note:** This was explicitly out of scope in the original PRD — flagged here as a conscious revisit, not an oversight.

---

## Morning email digest

**The problem:** No proactive notification when new transactions arrive — you have to remember to open the app.

**What this would look like:**
- Daily email at ~8am listing all unreviewed transactions (description, account, amount)
- Link back to the app to review
- Only sends if there's something to review (no email on empty days)

**Implementation notes:**
- Use **Resend** (resend.com) — free tier, simple API, single npm package
- Add `RESEND_API_KEY` and `NOTIFY_EMAIL` to env vars / Fly secrets
- Hook into the existing `node-cron` scheduler alongside the daily sync
- Requires a verified sending domain to email arbitrary addresses; without one, can only send to the Resend account email

**Why deferred:** Nice-to-have; app is usable without it.

---

## Add Caroline's bank account to SimpleFIN

**The problem:** Only Barry's Chase accounts are currently connected. Caroline may have separate bank accounts (different institution) that aren't in the feed.

**What this would look like:**
- Add Caroline's bank as a second SimpleFIN connection, or add her accounts to the existing Chase connection if they're under the same login
- If a different bank: SimpleFIN supports multiple institutions — would need a second setup token claim and a second access URL stored

**Implementation notes:**
- If same Chase login: just add the accounts in the SimpleFIN dashboard, they'll appear on next sync automatically
- If different bank: add `SIMPLEFIN_ACCESS_URL_2` secret, update sync to fetch from both URLs and merge results
- Note: "Bank accounts beyond Chase" was explicitly out of scope in the original PRD

**Why deferred:** Scope decision — revisit once the Chase workflow is stable.
