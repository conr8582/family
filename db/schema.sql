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
  notes_auto    TEXT,                       -- cached AI merchant lookup result
  navan_status  TEXT,                       -- null / 'reimbursed' / 'pending' / 'manual'
  linked_reimbursement_id INTEGER REFERENCES transactions(id), -- payment tx this expense is matched to
  reimb_closed  INTEGER NOT NULL DEFAULT 0, -- 1 = reimbursement payment has been closed out (only meaningful when reimbursable = 'reimbursement')
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Key-value store for app settings (e.g. SimpleFIN access URL)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Itemized carve-outs of an ATM cash withdrawal into other spending categories
-- (e.g. $20 of a $100 withdrawal turns out to have been a haircut / Shopping).
CREATE TABLE IF NOT EXISTS atm_splits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  category_id    INTEGER NOT NULL REFERENCES categories(id),
  amount_cents   INTEGER NOT NULL, -- positive; magnitude carved out of the withdrawal
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_reviewed ON transactions(reviewed);
CREATE INDEX IF NOT EXISTS idx_transactions_account  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_atm_splits_transaction ON atm_splits(transaction_id);
