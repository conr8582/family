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

// Finds the most recent reviewed transaction with the same description,
// amount, and account — used to carry a recurring charge's category/note
// forward (e.g. the same Apple subscription line item billed next month).
const matchPriorReviewed = db.prepare(`
  SELECT category_id, notes, date
  FROM transactions
  WHERE description = ?
    AND amount_cents = ?
    AND account_id = ?
    AND reviewed = 1
    AND category_id IS NOT NULL
    AND id != ?
  ORDER BY date DESC, id DESC
  LIMIT 1
`);

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── GET / — review screen (unreviewed transactions) ───────────────────────────
router.get('/', (req, res) => {
  const rawTx = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents,
           t.category_id, t.reimbursable, t.notes,
           t.account_id, a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.reviewed = 0
    ORDER BY t.date DESC, t.id DESC
  `).all([]).map(tx => {
    if (tx.category_id) return tx; // already tagged — nothing to suggest
    const match = matchPriorReviewed.get([tx.description, tx.amount_cents, tx.account_id, tx.id]);
    if (!match) return tx;
    return {
      ...tx,
      suggested_category_id: match.category_id,
      suggested_notes: match.notes,
      suggested_date_display: shortDate(match.date),
    };
  });

  const { flat, byType } = getCategories();

  // Navan reminder: show banner on last 2 days of month if report not yet uploaded
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const nearEndOfMonth = now.getDate() >= lastDay - 1;
  const navanUploaded = !!db.prepare('SELECT 1 FROM settings WHERE key = ?').get([`navan_upload_${thisMonth}`]);
  const showNavanReminder = nearEndOfMonth && !navanUploaded;
  const reminderMonth = now.toLocaleDateString('en-US', { month: 'long' });

  res.render('review.njk', {
    groups: groupByDate(rawTx),
    total: rawTx.length,
    categories: byType,
    categoriesFlat: flat,
    showNavanReminder,
    reminderMonth,
    activePage: 'review',
  });
});

// Splits already recorded against an ATM withdrawal, most recent first.
const getSplitsForTx = db.prepare(`
  SELECT s.id, s.category_id, s.amount_cents, s.notes, c.name AS category_name
  FROM atm_splits s
  JOIN categories c ON c.id = s.category_id
  WHERE s.transaction_id = ?
  ORDER BY s.created_at DESC, s.id DESC
`);

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

  const atmCategory = db.prepare("SELECT id FROM categories WHERE name = 'ATM'").get([]);

  const rawTxWithSplits = rawTx.map(tx => {
    if (!atmCategory || tx.category_id !== atmCategory.id) return tx;
    const splits = getSplitsForTx.all([tx.id]);
    const splitTotal = splits.reduce((s, r) => s + r.amount_cents, 0);
    return {
      ...tx,
      is_atm: true,
      splits,
      remaining_cents: Math.abs(tx.amount_cents) - splitTotal,
    };
  });

  const { flat, byType } = getCategories();

  res.render('filed.njk', {
    groups: groupByDate(rawTxWithSplits),
    total: rawTx.length,
    categories: byType,
    categoriesFlat: flat,
    activePage: 'filed',
  });
});

// ── POST /api/atm-splits — carve part of an ATM withdrawal into another category ─
router.post('/api/atm-splits', (req, res) => {
  const transactionId = parseInt(req.body.transactionId, 10);
  const categoryId = parseInt(req.body.categoryId, 10);
  const amount = parseFloat(req.body.amount);
  const notes = (req.body.notes || '').trim() || null;

  if (!Number.isFinite(transactionId) || !Number.isFinite(categoryId) || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const amountCents = Math.round(amount * 100);

  const txn = db.prepare(`
    SELECT t.id, t.amount_cents, c.name AS category_name
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.id = ?
  `).get([transactionId]);

  if (!txn || txn.category_name !== 'ATM') {
    return res.status(400).json({ error: 'Not an ATM transaction' });
  }

  const targetCategory = db.prepare('SELECT name FROM categories WHERE id = ?').get([categoryId]);
  if (!targetCategory || targetCategory.name === 'ATM') {
    return res.status(400).json({ error: 'Pick a category other than ATM' });
  }

  const { total: splitTotal } = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM atm_splits WHERE transaction_id = ?'
  ).get([transactionId]);

  const remaining = Math.abs(txn.amount_cents) - splitTotal;
  if (amountCents > remaining) {
    return res.status(400).json({ error: `Only $${(remaining / 100).toFixed(2)} left to itemize` });
  }

  db.prepare(`
    INSERT INTO atm_splits (transaction_id, category_id, amount_cents, notes)
    VALUES (?, ?, ?, ?)
  `).run([transactionId, categoryId, amountCents, notes]);

  res.json({ ok: true, remaining_cents: remaining - amountCents });
});

// ── POST /api/atm-splits/:id/delete — undo an itemized carve-out ───────────────
router.post('/api/atm-splits/:id/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const split = db.prepare('SELECT transaction_id, amount_cents FROM atm_splits WHERE id = ?').get([id]);
  if (!split) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM atm_splits WHERE id = ?').run([id]);

  const txn = db.prepare('SELECT amount_cents FROM transactions WHERE id = ?').get([split.transaction_id]);
  const { total: splitTotal } = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM atm_splits WHERE transaction_id = ?'
  ).get([split.transaction_id]);

  res.json({ ok: true, remaining_cents: Math.abs(txn.amount_cents) - splitTotal });
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
