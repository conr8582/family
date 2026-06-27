const cron = require('node-cron');
const db = require('../db/client');
const { fetchAccounts, persistPayload, getAccessUrl } = require('./simplefin');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get([key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run([key, value]);
}

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
}

// Core sync function. Fetches from SimpleFIN and persists new transactions.
// Returns a result summary object.
async function runSync() {
  if (!getAccessUrl()) {
    throw new Error('SimpleFIN not configured — run the backfill script first.');
  }

  // Overlap 48h with the last sync to catch late-posting transactions.
  // INSERT OR IGNORE handles any duplicates automatically.
  const lastSyncedAt = getSetting('last_synced_at');
  const startDate = lastSyncedAt
    ? new Date(new Date(lastSyncedAt).getTime() - 48 * 60 * 60 * 1000)
    : startOfCurrentMonth();

  const now = new Date();
  const payload = await fetchAccounts(startDate, now);

  if (payload.errors && payload.errors.length > 0) {
    console.warn(`[sync] SimpleFIN errors:`, payload.errors);
  }

  const { accountsUpserted, txAdded, txSkipped } = persistPayload(payload);

  setSetting('last_synced_at', now.toISOString());

  const summary = { accountsUpserted, txAdded, txSkipped, syncedAt: now.toISOString() };
  console.log(`[${now.toISOString()}] Sync complete —`, JSON.stringify(summary));
  return summary;
}

// Register the daily cron job. Called once at server startup.
function scheduleDailySync() {
  const hour = parseInt(process.env.SYNC_HOUR ?? '6', 10);
  const schedule = `0 ${hour} * * *`;

  cron.schedule(schedule, async () => {
    console.log(`[${new Date().toISOString()}] Daily sync starting...`);
    try {
      await runSync();
    } catch (err) {
      console.error(`[sync] Error:`, err.message);
    }
  });

  console.log(`[${new Date().toISOString()}] Daily sync scheduled at ${hour}:00.`);
}

module.exports = { runSync, scheduleDailySync };
