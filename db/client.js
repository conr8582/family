require('dotenv').config();
const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(process.env.DB_PATH || './data/finance.db');
const lockPath = dbPath + '.lock';

// Ensure the data directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// node-sqlite3-wasm leaves a .lock directory behind if a process crashes.
// Only remove it if it's more than 60 seconds old — if it's fresh, another
// process is probably still alive and we should let SQLite handle the conflict.
if (fs.existsSync(lockPath)) {
  const age = Date.now() - fs.statSync(lockPath).mtimeMs;
  if (age > 60_000) {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

const db = new Database(dbPath);

// Wait up to 5s for a momentary lock to clear instead of throwing immediately —
// this app sometimes has more than one process touching the file at once
// (daily cron sync overlapping with a page load, ad-hoc admin scripts, etc).
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');

// Idempotent migrations
try { db.exec('ALTER TABLE transactions ADD COLUMN notes_auto TEXT'); } catch {}
try { db.exec("ALTER TABLE transactions ADD COLUMN navan_status TEXT"); } catch {}
try { db.exec('ALTER TABLE transactions ADD COLUMN linked_reimbursement_id INTEGER REFERENCES transactions(id)'); } catch {}
try { db.exec('ALTER TABLE transactions ADD COLUMN reimb_closed INTEGER NOT NULL DEFAULT 0'); } catch {}
db.exec(`
  CREATE TABLE IF NOT EXISTS atm_splits (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    category_id    INTEGER NOT NULL REFERENCES categories(id),
    amount_cents   INTEGER NOT NULL,
    notes          TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_atm_splits_transaction ON atm_splits(transaction_id)');

// Category updates
db.exec(`UPDATE categories SET monthly_budget_cents = 90000 WHERE name = 'Dining Out'`);
db.exec(`UPDATE categories SET monthly_budget_cents = 90000 WHERE name = 'Shopping'`);
db.exec(`UPDATE categories SET monthly_budget_cents = 20000 WHERE name = 'Subscriptions'`);
db.exec(`UPDATE categories SET monthly_budget_cents = 12500 WHERE name = 'Media Subscriptions'`);
db.exec(`UPDATE categories SET monthly_budget_cents = 400000 WHERE name = 'Baby Care'`);
db.exec(`INSERT OR IGNORE INTO categories (name, type, monthly_budget_cents, sort_order) VALUES ('Coffee / Drinks / Treats', 'expense', 20000, 42)`);
db.exec(`INSERT OR IGNORE INTO categories (name, type, monthly_budget_cents, sort_order) VALUES ('Chef', 'expense', 45000, 24)`);
db.exec(`INSERT OR IGNORE INTO categories (name, type, monthly_budget_cents, sort_order, active) VALUES ('Caroline Card', 'expense', 170000, 25, 0)`);

// Close cleanly on process exit so the lock is always released
process.on('exit', () => { try { db.close(); } catch {} });
process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// NOTE: node-sqlite3-wasm requires params as an array, not spread args.
// Right:  stmt.run([a, b])  stmt.get([a])  stmt.all([a])
// Wrong:  stmt.run(a, b)    stmt.get(a)    stmt.all(a)
module.exports = db;
