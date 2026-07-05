const express = require('express');
const db = require('../../db/client');

const router = express.Router();

router.get('/budget', (req, res) => {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const monthParam = req.query.month;
  const monthStr = (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) ? monthParam : nowStr;

  const [y, m] = monthStr.split('-').map(Number);
  const monthLabel = new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const prevDate = new Date(Date.UTC(y, m - 2, 1));
  const nextDate = new Date(Date.UTC(y, m,     1));
  const prevMonth = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const nextMonth = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const isCurrentMonth = monthStr === nowStr;

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
    GROUP BY c.id
    HAVING c.active = 1 OR actual_cents <> 0
    ORDER BY c.sort_order
  `).all([monthStr]);

  // Only show unreviewed banner on the current month
  const { n: unreviewedCount } = isCurrentMonth ? db.prepare(`
    SELECT count(*) AS n FROM transactions
    WHERE reviewed = 0 AND strftime('%Y-%m', date) = ?
  `).get([monthStr]) : { n: 0 };

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
    monthStr,
    prevMonth,
    nextMonth,
    isCurrentMonth,
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

// ── GET /api/budget/:categoryId/transactions ──────────────────────────────────
router.get('/api/budget/:categoryId/transactions', (req, res) => {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthParam = req.query.month;
  const monthStr = (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) ? monthParam : nowStr;

  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.category_id = ?
      AND t.reviewed = 1
      AND t.reimbursable = 'none'
      AND strftime('%Y-%m', t.date) = ?
    ORDER BY t.date DESC
  `).all([parseInt(req.params.categoryId), monthStr]);

  res.json(rows);
});

module.exports = router;
