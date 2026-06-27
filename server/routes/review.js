const express = require('express');
const db = require('../../db/client');

const router = express.Router();

// Shared helper — queries categories for the combobox
function getCategories() {
  const categories = db.prepare(
    'SELECT id, name, type FROM categories WHERE active = 1 ORDER BY sort_order'
  ).all([]);
  return {
    flat: categories,
    byType: {
      expense:  categories.filter(c => c.type === 'expense'),
      income:   categories.filter(c => c.type === 'income'),
      transfer: categories.filter(c => c.type === 'transfer'),
    },
  };
}

// Shared helper — groups a flat transaction list by date
function groupByDate(txList) {
  const groups = [];
  for (const tx of txList) {
    if (!groups.length || groups[groups.length - 1].date !== tx.date) {
      groups.push({ date: tx.date, transactions: [] });
    }
    groups[groups.length - 1].transactions.push(tx);
  }
  return groups;
}

// ── GET / — review screen (unreviewed transactions) ───────────────────────────
router.get('/', (req, res) => {
  const rawTx = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents,
           t.category_id, t.reimbursable, t.notes,
           a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.reviewed = 0
    ORDER BY t.date DESC, t.id DESC
  `).all([]);

  const { flat, byType } = getCategories();

  res.render('review.njk', {
    groups: groupByDate(rawTx),
    total: rawTx.length,
    categories: byType,
    categoriesFlat: flat,
    activePage: 'review',
  });
});

// ── GET /filed — filed transactions (reviewed = 1) ────────────────────────────
router.get('/filed', (req, res) => {
  const rawTx = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents,
           t.category_id, t.reimbursable, t.notes,
           a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.reviewed = 1
    ORDER BY t.date DESC, t.id DESC
  `).all([]);

  const { flat, byType } = getCategories();

  res.render('filed.njk', {
    groups: groupByDate(rawTx),
    total: rawTx.length,
    categories: byType,
    categoriesFlat: flat,
    activePage: 'filed',
  });
});

// ── POST /api/transactions/:id — save (used by both review Done + filed Save) ─
router.post('/api/transactions/:id', (req, res) => {
  const { id } = req.params;
  const { category_id, reimbursable, notes, amount } = req.body;

  const validReimbursable = ['none', 'reimbursable', 'reimbursement'];
  const reimb = validReimbursable.includes(reimbursable) ? reimbursable : 'none';
  const catId = category_id ? parseInt(category_id, 10) : null;

  const amountCents = amount !== undefined && amount !== '' && !isNaN(parseFloat(amount))
    ? Math.round(parseFloat(amount) * 100)
    : null;

  const result = db.prepare(`
    UPDATE transactions
    SET category_id  = ?,
        reimbursable = ?,
        notes        = ?,
        reviewed     = 1
        ${amountCents !== null ? ', amount_cents = ?' : ''}
    WHERE id = ?
  `).run(amountCents !== null
    ? [catId, reimb, notes || null, amountCents, parseInt(id, 10)]
    : [catId, reimb, notes || null, parseInt(id, 10)]);

  if (result.changes === 0) {
    return res.status(404).json({ ok: false, error: 'Transaction not found.' });
  }
  res.json({ ok: true });
});

// ── POST /api/transactions/:id/reopen — move back to review queue ──────────────
router.post('/api/transactions/:id/reopen', (req, res) => {
  const result = db.prepare(
    'UPDATE transactions SET reviewed = 0 WHERE id = ?'
  ).run([parseInt(req.params.id, 10)]);

  if (result.changes === 0) {
    return res.status(404).json({ ok: false, error: 'Transaction not found.' });
  }
  res.json({ ok: true });
});

module.exports = router;
