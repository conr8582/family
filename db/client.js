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

db.exec('PRAGMA foreign_keys = ON');

// Idempotent migrations
try { db.exec('ALTER TABLE transactions ADD COLUMN notes_auto TEXT'); } catch {}
try { db.exec("ALTER TABLE transactions ADD COLUMN navan_status TEXT"); } catch {}
try { db.exec('ALTER TABLE transactions ADD COLUMN linked_reimbursement_id INTEGER REFERENCES transactions(id)'); } catch {}
try { db.exec('ALTER TABLE transactions ADD COLUMN reimb_closed INTEGER NOT NULL DEFAULT 0'); } catch {}

// Category updates
db.exec(`UPDATE categories SET monthly_budget_cents = 90000 WHERE name = 'Dining Out'`);
db.exec(`UPDATE categories SET monthly_budget_cents = 90000 WHERE name = 'Shopping'`);
db.exec(`UPDATE categories SET monthly_budget_cents = 20000 WHERE name = 'Subscriptions'`);
db.exec(`UPDATE categories SET monthly_budget_cents = 12500 WHERE name = 'Media Subscriptions'`);
db.exec(`UPDATE categories SET monthly_budget_cents = 400000 WHERE name = 'Baby Care'`);
db.exec(`INSERT OR IGNORE INTO categories (name, type, monthly_budget_cents, sort_order) VALUES ('Coffee / Drinks / Treats', 'expense', 20000, 42)`);
db.exec(`INSERT OR IGNORE INTO categories (name, type, monthly_budget_cents, sort_order) VALUES ('Chef', 'expense', 45000, 24)`);
db.exec(`DELETE FROM categories WHERE name = 'Caroline Card'`);

// Close cleanly on process exit so the lock is always released
process.on('exit', () => { try { db.close(); } catch {} });
process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// NOTE: node-sqlite3-wasm requires params as an array, not spread args.
// Right:  stmt.run([a, b])  stmt.get([a])  stmt.all([a])
// Wrong:  stmt.run(a, b)    stmt.get(a)    stmt.all(a)
module.exports = db;
