const express = require('express');
const db = require('../../db/client');

const router = express.Router();

router.get('/budget', (req, res) => {
  const now = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthStr   = `${year}-${month}`;
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Per-category actuals for the current month.
  // Excludes: unreviewed, reimbursable/reimbursement transactions, transfer categories.
  // Expenses: flip sign so actuals are positive (spend is stored as negative cents).
  // Income:   keep sign as-is (deposits are positive).
  const rows = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.type,
      c.monthly_budget_cents,
      c.sort_order,
      COALESCE(SUM(
        CASE
          WHEN t.reviewed = 1 AND t.reimbursable = 'none' THEN
            CASE c.type
              WHEN 'expense' THEN -t.amount_cents
              WHEN 'income'  THEN  t.amount_cents
              ELSE 0
            END
          ELSE 0
        END
      ), 0) AS actual_cents
    FROM categories c
    LEFT JOIN transactions t
      ON  t.category_id = c.id
      AND strftime('%Y-%m', t.date) = ?
    WHERE c.active = 1
    GROUP BY c.id
    ORDER BY c.sort_order
  `).all([monthStr]);

  // Count unreviewed transactions this month (their spend isn't in the totals yet)
  const { n: unreviewedCount } = db.prepare(`
    SELECT count(*) AS n FROM transactions
    WHERE reviewed = 0 AND strftime('%Y-%m', date) = ?
  `).get([monthStr]);

  // Enrich each row with variance and % used, then split by type
  function enrich(r) {
    // For expenses: positive variance = under budget (good)
    // For income:   positive variance = earned more than budgeted (good)
    const variance_cents = r.type === 'expense'
      ? r.monthly_budget_cents - r.actual_cents
      : r.actual_cents - r.monthly_budget_cents;

    const pct = r.monthly_budget_cents > 0
      ? Math.round(r.actual_cents / r.monthly_budget_cents * 100)
      : null;

    return { ...r, variance_cents, pct };
  }

  const income   = rows.filter(r => r.type === 'income').map(enrich);
  const expenses = rows.filter(r => r.type === 'expense').map(enrich);

  // Section totals
  const totalExpenseBudget = expenses.reduce((s, r) => s + r.monthly_budget_cents, 0);
  const totalExpenseActual = expenses.reduce((s, r) => s + r.actual_cents, 0);
  const totalIncomeBudget  = income.reduce((s, r) => s + r.monthly_budget_cents, 0);
  const totalIncomeActual  = income.reduce((s, r) => s + r.actual_cents, 0);

  const netBudget = totalIncomeBudget  - totalExpenseBudget;
  const netActual = totalIncomeActual  - totalExpenseActual;

  res.render('budget.njk', {
    monthLabel,
    income,
    expenses,
    totalExpenseBudget,
    totalExpenseActual,
    totalIncomeBudget,
    totalIncomeActual,
    netBudget,
    netActual,
    unreviewedCount,
    activePage: 'budget',
  });
});

module.exports = router;
