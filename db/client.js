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

// Idempotent migration: add notes_auto column for merchant lookup caching
try { db.exec('ALTER TABLE transactions ADD COLUMN notes_auto TEXT'); } catch {}

// Close cleanly on process exit so the lock is always released
process.on('exit', () => { try { db.close(); } catch {} });
process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// NOTE: node-sqlite3-wasm requires params as an array, not spread args.
// Right:  stmt.run([a, b])  stmt.get([a])  stmt.all([a])
// Wrong:  stmt.run(a, b)    stmt.get(a)    stmt.all(a)
module.exports = db;
