const express = require('express');
const db = require('../../db/client');

const router = express.Router();

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function toDollar(cents) {
  return (Math.abs(cents) / 100).toFixed(2);
}

const linkedQuery = db.prepare(`
  SELECT t.id, t.date, t.description, t.amount_cents, a.name AS account_name
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  WHERE t.linked_reimbursement_id = ?
  ORDER BY t.date DESC, t.id DESC
`);

function buildPayment(p) {
  const linked = linkedQuery.all([p.id]).map(e => ({
    ...e,
    date_display: shortDate(e.date),
    amount_display: toDollar(e.amount_cents),
  }));

  const payment_cents = Math.abs(p.amount_cents);
  const linked_cents  = linked.reduce((sum, e) => sum + Math.abs(e.amount_cents), 0);
  const delta_cents   = payment_cents - linked_cents;

  let delta_type, delta_display;
  if (delta_cents === 0) {
    delta_type    = 'settled';
    delta_display = null;
  } else if (delta_cents > 0) {
    delta_type    = 'surplus';  // payment exceeds linked expenses
    delta_display = (delta_cents / 100).toFixed(2);
  } else {
    delta_type    = 'owed';     // expenses exceed payment — under-reimbursed
    delta_display = (Math.abs(delta_cents) / 100).toFixed(2);
  }

  return {
    ...p,
    date_display: shortDate(p.date),
    amount_display: toDollar(p.amount_cents),
    linked,
    payment_cents,
    linked_cents,
    delta_cents,
    delta_type,
    delta_display,
  };
}

function renderReimbursements(req, res, view) {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthParam = req.query.month;
  const monthStr = (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) ? monthParam : nowStr;

  const [y, m] = monthStr.split('-').map(Number);
  const monthLabel = new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const prevDate = new Date(Date.UTC(y, m - 2, 1));
  const nextDate = new Date(Date.UTC(y, m, 1));
  const prevMonth = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const nextMonth = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const isCurrentMonth = monthStr === nowStr;

  // Payments received in the selected month — Thumbtack and Navan only
  const paymentRows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, t.reimb_closed, a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.reimbursable = 'reimbursement'
      AND strftime('%Y-%m', t.date) = ?
      AND (t.description LIKE '%THUMBTACK%' OR t.description LIKE '%NAVAN%')
      AND t.reimb_closed = ?
    ORDER BY t.date DESC, t.id DESC
  `).all([monthStr, view === 'closed' ? 1 : 0]);

  const payments = paymentRows.map(buildPayment);

  const openCount = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions t
    WHERE t.reimbursable = 'reimbursement'
      AND strftime('%Y-%m', t.date) = ?
      AND (t.description LIKE '%THUMBTACK%' OR t.description LIKE '%NAVAN%')
      AND t.reimb_closed = 0
  `).get([monthStr]).n;

  const closedCount = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions t
    WHERE t.reimbursable = 'reimbursement'
      AND strftime('%Y-%m', t.date) = ?
      AND (t.description LIKE '%THUMBTACK%' OR t.description LIKE '%NAVAN%')
      AND t.reimb_closed = 1
  `).get([monthStr]).n;

  // All unlinked reimbursable expenses (all months) — only needed on the open view
  const unlinked = view === 'closed' ? [] : db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.reimbursable = 'reimbursable'
      AND t.linked_reimbursement_id IS NULL
    ORDER BY t.date DESC, t.id DESC
  `).all([]).map(e => {
    const ageMs = Date.now() - new Date(e.date).getTime();
    return {
      ...e,
      date_display: shortDate(e.date),
      amount_display: toDollar(e.amount_cents),
      is_old: ageMs > 30 * 24 * 60 * 60 * 1000,
    };
  });

  res.render('reimbursements.njk', {
    monthStr, monthLabel, prevMonth, nextMonth, isCurrentMonth,
    payments, unlinked, view, openCount, closedCount,
    activePage: 'reimbursements',
  });
}

router.get('/reimbursements', (req, res) => renderReimbursements(req, res, 'open'));
router.get('/reimbursements/closed', (req, res) => renderReimbursements(req, res, 'closed'));

// ── POST /api/reimbursements/link — attach an expense to a payment ────────────
router.post('/api/reimbursements/link', (req, res) => {
  const expenseId = parseInt(req.body.expenseId, 10);
  const paymentId = parseInt(req.body.paymentId, 10);
  if (!Number.isFinite(expenseId) || !Number.isFinite(paymentId)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  const payment = db.prepare("SELECT id FROM transactions WHERE id = ? AND reimbursable = 'reimbursement'").get([paymentId]);
  if (!payment) return res.status(400).json({ error: 'Payment not found' });

  const expense = db.prepare("SELECT id FROM transactions WHERE id = ? AND reimbursable = 'reimbursable'").get([expenseId]);
  if (!expense) return res.status(400).json({ error: 'Expense not found' });

  db.prepare('UPDATE transactions SET linked_reimbursement_id = ? WHERE id = ?').run([paymentId, expenseId]);
  res.json({ ok: true });
});

// ── POST /api/reimbursements/unlink/:expenseId — detach expense from payment ──
router.post('/api/reimbursements/unlink/:expenseId', (req, res) => {
  const id = parseInt(req.params.expenseId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const result = db.prepare(
    "UPDATE transactions SET linked_reimbursement_id = NULL WHERE id = ? AND reimbursable = 'reimbursable'"
  ).run([id]);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── POST /api/reimbursements/close/:paymentId — close out a reimbursement ─────
router.post('/api/reimbursements/close/:paymentId', (req, res) => {
  const id = parseInt(req.params.paymentId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const result = db.prepare(
    "UPDATE transactions SET reimb_closed = 1 WHERE id = ? AND reimbursable = 'reimbursement'"
  ).run([id]);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── POST /api/reimbursements/reopen/:paymentId — reopen a closed reimbursement ─
router.post('/api/reimbursements/reopen/:paymentId', (req, res) => {
  const id = parseInt(req.params.paymentId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const result = db.prepare(
    "UPDATE transactions SET reimb_closed = 0 WHERE id = ? AND reimbursable = 'reimbursement'"
  ).run([id]);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
