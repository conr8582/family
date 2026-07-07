const express = require('express');
const db = require('../../db/client');

const router = express.Router();

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Enrich a category row with variance and % used, shared by month + year views.
function enrich(r) {
  // For expenses: positive variance = under budget (good)
  // For income:   positive variance = earned more than budgeted (good)
  const variance_cents = r.type === 'expense'
    ? r.budget_cents - r.actual_cents
    : r.actual_cents - r.budget_cents;

  const pct = r.budget_cents > 0
    ? Math.round(r.actual_cents / r.budget_cents * 100)
    : null;

  return { ...r, variance_cents, pct };
}

function splitAndTotal(rows) {
  const income   = rows.filter(r => r.type === 'income').map(enrich);
  const expenses = rows.filter(r => r.type === 'expense').map(enrich);

  const totalExpenseBudget = expenses.reduce((s, r) => s + r.budget_cents, 0);
  const totalExpenseActual = expenses.reduce((s, r) => s + r.actual_cents, 0);
  const totalIncomeBudget  = income.reduce((s, r) => s + r.budget_cents, 0);
  const totalIncomeActual  = income.reduce((s, r) => s + r.actual_cents, 0);

  return {
    income, expenses,
    totalExpenseBudget, totalExpenseActual,
    totalIncomeBudget, totalIncomeActual,
    netBudget: totalIncomeBudget - totalExpenseBudget,
    netActual: totalIncomeActual - totalExpenseActual,
  };
}

router.get('/budget', (req, res) => {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const nowYear = now.getFullYear();

  const view = req.query.view === 'year' ? 'year' : 'month';

  if (view === 'year') {
    const yearParam = parseInt(req.query.year, 10);
    const yearNum = (yearParam && /^\d{4}$/.test(String(yearParam))) ? yearParam : nowYear;
    const yearStr = String(yearNum);
    const isCurrentYear = yearNum === nowYear;

    // Budget is prorated "to date" — full 12 months for a past year, but only
    // through the current month for the year in progress (otherwise every
    // category looks wildly under budget for a year that's only partway done).
    const monthsElapsed = isCurrentYear ? now.getMonth() + 1 : 12;

    // Per-category actuals summed across the whole year; budget prorated to date.
    const rows = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.type,
        c.monthly_budget_cents * ? AS budget_cents,
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
        AND strftime('%Y', t.date) = ?
      GROUP BY c.id
      HAVING c.active = 1 OR actual_cents <> 0
      ORDER BY c.sort_order
    `).all([monthsElapsed, yearStr]);

    const { n: unreviewedCount } = isCurrentYear ? db.prepare(`
      SELECT count(*) AS n FROM transactions
      WHERE reviewed = 0 AND strftime('%Y-%m', date) = ?
    `).get([nowStr]) : { n: 0 };

    return res.render('budget.njk', {
      view,
      yearStr, yearNum,
      prevYear: yearNum - 1,
      nextYear: yearNum + 1,
      isCurrentYear,
      periodLabel: yearStr,
      monthsElapsed,
      monthsElapsedLabel: MONTH_NAMES[monthsElapsed - 1],
      unreviewedCount,
      ...splitAndTotal(rows),
      activePage: 'budget',
    });
  }

  // ── Month view ──────────────────────────────────────────────────────────────
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

  // Months selectable in the dropdown: Jan through Dec for past years,
  // Jan through the current month for the current year.
  const lastSelectableMonth = (y === nowYear) ? now.getMonth() + 1 : 12;
  const monthOptions = [];
  for (let i = 1; i <= lastSelectableMonth; i++) {
    monthOptions.push({ value: `${y}-${String(i).padStart(2, '0')}`, label: `${MONTH_NAMES[i - 1]} ${y}` });
  }

  // Per-category actuals for the selected month.
  // Excludes: unreviewed, reimbursable/reimbursement transactions, transfer categories.
  // Expenses: flip sign so actuals are positive (spend is stored as negative cents).
  // Income:   keep sign as-is (deposits are positive).
  const rows = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.type,
      c.monthly_budget_cents AS budget_cents,
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

  res.render('budget.njk', {
    view,
    monthLabel,
    monthStr,
    monthOptions,
    prevMonth,
    nextMonth,
    isCurrentMonth,
    periodLabel: monthLabel,
    unreviewedCount,
    ...splitAndTotal(rows),
    activePage: 'budget',
  });
});

// ── GET /api/budget/:categoryId/transactions ──────────────────────────────────
router.get('/api/budget/:categoryId/transactions', (req, res) => {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let dateFilter, dateValue;
  if (req.query.view === 'year') {
    const yearParam = parseInt(req.query.year, 10);
    dateValue = (yearParam && /^\d{4}$/.test(String(yearParam))) ? String(yearParam) : String(now.getFullYear());
    dateFilter = "strftime('%Y', t.date) = ?";
  } else {
    const monthParam = req.query.month;
    dateValue = (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) ? monthParam : nowStr;
    dateFilter = "strftime('%Y-%m', t.date) = ?";
  }

  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.category_id = ?
      AND t.reviewed = 1
      AND t.reimbursable = 'none'
      AND ${dateFilter}
    ORDER BY t.date DESC
  `).all([parseInt(req.params.categoryId), dateValue]);

  res.json(rows);
});

module.exports = router;
