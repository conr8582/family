require('dotenv').config();
const { claimSetupToken, fetchAccounts, persistPayload, getAccessUrl } = require('../server/simplefin');

async function main() {
  // ── 1. Claim setup token if we don't have an access URL yet ───────────────
  let accessUrl = getAccessUrl();
  if (!accessUrl) {
    const token = process.env.SIMPLEFIN_SETUP_TOKEN;
    if (!token) {
      console.error('Error: SIMPLEFIN_SETUP_TOKEN is not set in .env');
      process.exit(1);
    }
    accessUrl = await claimSetupToken(token);
  } else {
    console.log('Access URL already claimed — skipping token exchange.');
  }

  // ── 2. Pull the current month ──────────────────────────────────────────────
  // Start = first day of current month at midnight UTC
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const endOfDay = new Date(); // now

  console.log(`Fetching transactions from ${startOfMonth.toISOString().slice(0, 10)} to today...`);

  const payload = await fetchAccounts(startOfMonth, endOfDay);

  if (payload.errors && payload.errors.length > 0) {
    console.warn('SimpleFIN returned errors:', payload.errors);
  }

  // ── 3. Persist ─────────────────────────────────────────────────────────────
  const { accountsUpserted, txAdded, txSkipped } = persistPayload(payload);

  console.log(`Accounts: ${accountsUpserted} upserted`);
  console.log(`Transactions: ${txAdded} added, ${txSkipped} already existed`);

  // ── 4. Summary ─────────────────────────────────────────────────────────────
  const db = require('../db/client');
  const accounts = db.prepare('SELECT name, institution FROM accounts ORDER BY name').all([]);
  console.log('\nAccounts in DB:');
  for (const a of accounts) console.log(`  ${a.institution} — ${a.name}`);

  const txCount = db.prepare('SELECT count(*) as n FROM transactions').get([]);
  console.log(`\nTotal transactions in DB: ${txCount.n}`);
}

main()
  .catch(err => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
  })
  .finally(() => {
    require('../db/client').close();
  });
