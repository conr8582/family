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

// Moves dollars carved out of ATM withdrawals (atm_splits) from the ATM
// category into whichever category they actually turned out to be — e.g.
// $20 of a $100 withdrawal spent on a haircut becomes Shopping. Mutates
// and returns `rows` (every category, pre-filter, so a category that had
// zero regular activity but picked up a split still gets found).
function applyAtmSplits(rows, dateFilterSql, dateValue) {
  const atmRow = rows.find(r => r.name === 'ATM');
  if (!atmRow) return rows;

  const { total: reduction } = db.prepare(`
    SELECT COALESCE(SUM(s.amount_cents), 0) AS total
    FROM atm_splits s
    JOIN transactions t ON t.id = s.transaction_id
    WHERE t.reviewed = 1 AND ${dateFilterSql}
  `).get([dateValue]);
  atmRow.actual_cents -= reduction;

  const additions = db.prepare(`
    SELECT s.category_id, SUM(s.amount_cents) AS total
    FROM atm_splits s
    JOIN transactions t ON t.id = s.transaction_id
    WHERE t.reviewed = 1 AND ${dateFilterSql}
    GROUP BY s.category_id
  `).all([dateValue]);

  for (const a of additions) {
    const target = rows.find(r => r.id === a.category_id);
    if (target) target.actual_cents += a.total;
  }

  return rows;
}

// Nets down both sides of an income-offset allocation — an expense that got
// partially covered by an incoming payment shrinks in its own category, and
// the income transaction only counts whatever wasn't allocated away (e.g. a
// friend Venmos $50 toward a $100 dinner: Dining Out nets to $50, and only
// the untouched part of the Venmo, if any, counts as income). Mutates and
// returns `rows`.
function applyIncomeOffsets(rows, dateFilterSql, dateValue) {
  const expenseSide = db.prepare(`
    SELECT t.category_id, SUM(o.amount_cents) AS total
    FROM income_offsets o
    JOIN transactions t ON t.id = o.expense_transaction_id
    WHERE t.reviewed = 1 AND ${dateFilterSql}
    GROUP BY t.category_id
  `).all([dateValue]);

  const incomeSide = db.prepare(`
    SELECT t.category_id, SUM(o.amount_cents) AS total
    FROM income_offsets o
    JOIN transactions t ON t.id = o.income_transaction_id
    WHERE t.reviewed = 1 AND ${dateFilterSql}
    GROUP BY t.category_id
  `).all([dateValue]);

  for (const r of [...expenseSide, ...incomeSide]) {
    const target = rows.find(row => row.id === r.category_id);
    if (target) target.actual_cents -= r.total;
  }

  return rows;
}

function splitAndTotal(rows) {
  // ATM stays selectable in the category picker (so new withdrawals can
  // still be tagged) but drops off the budget table once it's fully
  // itemized to $0 for the period — unlike other active categories, which
  // always show even at $0 so you can track progress through the month.
  const visible = rows.filter(r => (r.active === 1 && r.name !== 'ATM') || r.actual_cents !== 0);
  const income   = visible.filter(r => r.type === 'income').map(enrich);
  const expenses = visible.filter(r => r.type === 'expense').map(enrich);

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
    // No HAVING here — ATM splits can credit a category that had zero regular
    // activity, so every category is fetched and filtered after applyAtmSplits.
    const rows = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.type,
        c.active,
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
      ORDER BY c.sort_order
    `).all([monthsElapsed, yearStr]);

    applyAtmSplits(rows, "strftime('%Y', t.date) = ?", yearStr);
    applyIncomeOffsets(rows, "strftime('%Y', t.date) = ?", yearStr);

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
      c.active,
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
    ORDER BY c.sort_order
  `).all([monthStr]);

  applyAtmSplits(rows, "strftime('%Y-%m', t.date) = ?", monthStr);
  applyIncomeOffsets(rows, "strftime('%Y-%m', t.date) = ?", monthStr);

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

  const categoryId = parseInt(req.params.categoryId, 10);

  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.category_id = ?
      AND t.reviewed = 1
      AND t.reimbursable = 'none'
      AND ${dateFilter}
    ORDER BY t.date DESC
  `).all([categoryId, dateValue]);

  // If this is the ATM category, net out whatever's been itemized elsewhere,
  // and fold in transactions from OTHER categories that had cash carved out
  // into this one via an ATM split.
  const atmCategory = db.prepare("SELECT id FROM categories WHERE name = 'ATM'").get([]);
  if (atmCategory && categoryId === atmCategory.id) {
    for (const r of rows) {
      const { total } = db.prepare(
        'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM atm_splits WHERE transaction_id = ?'
      ).get([r.id]);
      r.amount_cents = r.amount_cents < 0 ? r.amount_cents + total : r.amount_cents - total;
    }
  }
  if (atmCategory) {
    const credited = db.prepare(`
      SELECT s.id, t.date, t.description, s.amount_cents, a.name AS account_name
      FROM atm_splits s
      JOIN transactions t ON t.id = s.transaction_id
      JOIN accounts a ON a.id = t.account_id
      WHERE s.category_id = ?
        AND t.reviewed = 1
        AND ${dateFilter}
    `).all([categoryId, dateValue]);
    for (const c of credited) {
      rows.push({
        id: `split-${c.id}`,
        date: c.date,
        description: `${c.description} (itemized from ATM)`,
        amount_cents: -c.amount_cents,
        account_name: c.account_name,
      });
    }
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  // Net out income-offset allocations on either side — an expense that got
  // partially covered by an incoming payment shows its reduced amount, and
  // an income transaction shows only whatever wasn't allocated away.
  for (const r of rows) {
    if (typeof r.id !== 'number') continue; // skip synthetic ATM-split rows
    if (r.amount_cents < 0) {
      const { total } = db.prepare(
        'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM income_offsets WHERE expense_transaction_id = ?'
      ).get([r.id]);
      r.amount_cents += total;
    } else if (r.amount_cents > 0) {
      const { total } = db.prepare(
        'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM income_offsets WHERE income_transaction_id = ?'
      ).get([r.id]);
      r.amount_cents -= total;
    }
  }

  res.json(rows);
});

module.exports = router;
