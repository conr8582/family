CREATE TABLE IF NOT EXISTS categories (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL UNIQUE,
  type                 TEXT    NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  monthly_budget_cents INTEGER NOT NULL DEFAULT 0,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  active               INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  simplefin_id  TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  institution   TEXT NOT NULL DEFAULT 'Chase',
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  simplefin_id  TEXT    NOT NULL UNIQUE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  date          TEXT    NOT NULL,           -- ISO date: YYYY-MM-DD
  description   TEXT    NOT NULL,
  amount_cents  INTEGER NOT NULL,           -- signed; negative = money out
  category_id   INTEGER REFERENCES categories(id),
  reimbursable  TEXT    NOT NULL DEFAULT 'none'
                  CHECK (reimbursable IN ('none', 'reimbursable', 'reimbursement')),
  reviewed      INTEGER NOT NULL DEFAULT 0, -- 0 = needs review, 1 = done
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Key-value store for app settings (e.g. SimpleFIN access URL)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_reviewed ON transactions(reviewed);
CREATE INDEX IF NOT EXISTS idx_transactions_account  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
