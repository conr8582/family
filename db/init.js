const fs = require('fs');
const path = require('path');
const db = require('./client');

// ── Schema ────────────────────────────────────────────────────────────────────
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
console.log('Schema applied.');

// ── Categories ────────────────────────────────────────────────────────────────
// Only inserts rows that don't already exist (safe to re-run).
const insertCategory = db.prepare(`
  INSERT OR IGNORE INTO categories (name, type, monthly_budget_cents, sort_order)
  VALUES (?, ?, ?, ?)
`);

const categories = [
  // Income
  { name: 'Income',              type: 'income',   budget: 16000_00, order: 10 },

  // Expenses — housing & recurring
  { name: 'Rent',                type: 'expense',  budget:  4500_00, order: 20 },
  { name: 'Utilities',           type: 'expense',  budget:   325_00, order: 21 },
  { name: 'Insurance',           type: 'expense',  budget:    82_00, order: 22 },
  { name: 'Household',           type: 'expense',  budget:   100_00, order: 23 },
  { name: 'Chef',                type: 'expense',  budget:   450_00, order: 24 },

  // Expenses — subscriptions
  { name: 'Subscriptions',       type: 'expense',  budget:   200_00, order: 30 },
  { name: 'Tech Subscriptions',  type: 'expense',  budget:   100_00, order: 31 },
  { name: 'Media Subscriptions', type: 'expense',  budget:   125_00, order: 32 },
  { name: 'TV Subscriptions',    type: 'expense',  budget:   100_00, order: 33 },

  // Expenses — food
  { name: 'Groceries',              type: 'expense',  budget:   900_00, order: 40 },
  { name: 'Dining Out',             type: 'expense',  budget:   900_00, order: 41 },
  { name: 'Coffee / Drinks / Treats', type: 'expense', budget:  200_00, order: 42 },

  // Expenses — kids & family
  { name: 'Baby Care',           type: 'expense',  budget:  4000_00, order: 50 },
  { name: 'Baby Items',          type: 'expense',  budget:   700_00, order: 51 },
  { name: 'Pet Care',            type: 'expense',  budget:   150_00, order: 52 },

  // Expenses — transport & health
  { name: 'Transportation',      type: 'expense',  budget:   400_00, order: 60 },
  { name: 'Health',              type: 'expense',  budget:   800_00, order: 61 },

  // Expenses — lifestyle
  { name: 'Shopping',            type: 'expense',  budget:   900_00, order: 70 },
  { name: 'Entertainment',       type: 'expense',  budget:   500_00, order: 71 },
  { name: 'Travel',              type: 'expense',  budget:         0, order: 72 },
  { name: 'ATM',                 type: 'expense',  budget:   300_00, order: 74 },

  // Expenses — catch-alls
  { name: 'Unknown',             type: 'expense',  budget:         0, order: 90 },
  { name: 'Needs Review',        type: 'expense',  budget:         0, order: 91 },

  // Transfers — excluded from all totals
  { name: 'Internal Transfer',   type: 'transfer', budget:         0, order: 100 },
];

let inserted = 0;
for (const c of categories) {
  const result = insertCategory.run([c.name, c.type, c.budget, c.order]);
  if (result.changes > 0) inserted++;
}

console.log(`Categories: ${inserted} inserted, ${categories.length - inserted} already existed.`);
console.log('Done.');
db.close();
