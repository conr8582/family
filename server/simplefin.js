const db = require('../db/client');

function getAccessUrl() {
  // On a fresh deploy the DB is empty — fall back to env var and persist it
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(['simplefin_access_url']);
  if (row) return row.value;
  if (process.env.SIMPLEFIN_ACCESS_URL) {
    saveAccessUrl(process.env.SIMPLEFIN_ACCESS_URL);
    return process.env.SIMPLEFIN_ACCESS_URL;
  }
  return null;
}

function saveAccessUrl(url) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(['simplefin_access_url', url]);
}

// Exchange the one-time setup token for a permanent access URL.
// Safe to call only once — the token is consumed on first use.
async function claimSetupToken(setupToken) {
  const claimUrl = Buffer.from(setupToken, 'base64').toString('utf8').trim();
  console.log(`Claiming setup token from: ${claimUrl.replace(/\/[^/]+$/, '/***')}`);

  const res = await fetch(claimUrl, { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SimpleFIN claim failed (${res.status}): ${body}`);
  }

  const accessUrl = (await res.text()).trim();
  saveAccessUrl(accessUrl);
  console.log('Access URL claimed and stored.');
  return accessUrl;
}

// Fetch accounts + transactions from SimpleFIN.
// startDate / endDate are JS Date objects (or ms timestamps).
async function fetchAccounts(startDate, endDate) {
  const accessUrl = getAccessUrl();
  if (!accessUrl) throw new Error('No SimpleFIN access URL in DB — run the backfill script first.');

  const parsed = new URL(accessUrl);
  const credentials = Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64');

  // Build the API URL without credentials in the path
  const apiBase = `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname}`;
  const startSec = Math.floor(new Date(startDate).getTime() / 1000);
  let apiUrl = `${apiBase}/accounts?start-date=${startSec}`;
  if (endDate) {
    const endSec = Math.floor(new Date(endDate).getTime() / 1000);
    apiUrl += `&end-date=${endSec}`;
  }

  const res = await fetch(apiUrl, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SimpleFIN fetch failed (${res.status}): ${body}`);
  }

  return res.json();
}

// Convert a SimpleFIN amount string (e.g. "-12.34") to signed integer cents.
function toCents(amountStr) {
  return Math.round(parseFloat(amountStr) * 100);
}

// Persist accounts and transactions from a SimpleFIN response payload.
// Returns { accountsUpserted, txAdded, txSkipped }.
function persistPayload(payload) {
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (simplefin_id, name, institution, last_synced_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(simplefin_id) DO UPDATE SET
      name = excluded.name,
      last_synced_at = excluded.last_synced_at
  `);

  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (simplefin_id, account_id, date, description, amount_cents)
    VALUES (?, ?, ?, ?, ?)
  `);

  const getAccount = db.prepare('SELECT id FROM accounts WHERE simplefin_id = ?');

  let accountsUpserted = 0;
  let txAdded = 0;
  let txSkipped = 0;

  for (const acct of payload.accounts || []) {
    const institution = acct.org?.name || 'Chase';
    upsertAccount.run([acct.id, acct.name, institution]);
    accountsUpserted++;

    const acctRow = getAccount.get([acct.id]);
    if (!acctRow) continue;

    for (const tx of acct.transactions || []) {
      // posted is a Unix timestamp (seconds)
      const date = new Date(tx.posted * 1000).toISOString().slice(0, 10);
      const desc = (tx.description || tx.memo || '').trim();
      const cents = toCents(tx.amount);

      const result = insertTx.run([tx.id, acctRow.id, date, desc, cents]);
      if (result.changes > 0) txAdded++;
      else txSkipped++;
    }
  }

  return { accountsUpserted, txAdded, txSkipped };
}

module.exports = { claimSetupToken, fetchAccounts, persistPayload, getAccessUrl };
