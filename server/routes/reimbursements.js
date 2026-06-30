const express = require('express');
const db = require('../../db/client');
const { extractNavanTransactions } = require('../navan');

const router = express.Router();

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get([key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run([key, value]);
}

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

router.get('/reimbursements', (req, res) => {
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

  const reportUploaded = !!getSetting(`navan_upload_${monthStr}`);

  const txns = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount_cents, t.navan_status, a.name AS account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.reimbursable = 'reimbursable'
      AND strftime('%Y-%m', t.date) = ?
    ORDER BY t.date DESC, t.id DESC
  `).all([monthStr]).map(t => ({
    ...t,
    date_display: shortDate(t.date),
    amount_display: (Math.abs(t.amount_cents) / 100).toFixed(2),
  }));

  const reimbursed  = txns.filter(t => t.navan_status === 'reimbursed');
  const pending     = txns.filter(t => t.navan_status === 'pending');
  const manual      = txns.filter(t => t.navan_status === 'manual');
  const unconfirmed = txns.filter(t => !t.navan_status);

  res.render('reimbursements.njk', {
    monthStr, monthLabel, prevMonth, nextMonth, isCurrentMonth,
    reportUploaded, reimbursed, pending, manual, unconfirmed,
    total: txns.length,
    confirmed: reimbursed.length + manual.length,
    activePage: 'reimbursements',
  });
});

// ── POST /api/reimbursements/upload — process Navan screenshot ────────────────
router.post('/api/reimbursements/upload', async (req, res) => {
  const { imageData, month } = req.body;
  if (!imageData || !month) return res.status(400).json({ error: 'Missing imageData or month' });
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const navanTxns = await extractNavanTransactions(imageData);

    // All reimbursable txns for the month that aren't manually confirmed
    const dbTxns = db.prepare(`
      SELECT id, ABS(amount_cents) AS amount_abs
      FROM transactions
      WHERE reimbursable = 'reimbursable'
        AND strftime('%Y-%m', date) = ?
        AND navan_status IS NOT 'manual'
    `).all([month]);

    // Greedy match by amount — handles duplicate amounts correctly
    const matched = new Set();
    const updates = [];

    for (const navanTx of navanTxns) {
      const amountCents = Math.round(navanTx.amount * 100);
      const dbMatch = dbTxns.find(t => t.amount_abs === amountCents && !matched.has(t.id));
      if (dbMatch) {
        matched.add(dbMatch.id);
        updates.push([navanTx.status === 'Reimbursed' ? 'reimbursed' : 'pending', dbMatch.id]);
      }
    }

    const updateStmt = db.prepare('UPDATE transactions SET navan_status = ? WHERE id = ?');
    for (const [status, id] of updates) updateStmt.run([status, id]);

    setSetting(`navan_upload_${month}`, '1');
    res.json({ ok: true, navanCount: navanTxns.length, matched: updates.length });
  } catch (err) {
    console.error('[/api/reimbursements/upload]', err.message);
    res.status(500).json({ error: 'Failed to process screenshot' });
  }
});

// ── POST /api/reimbursements/:id/confirm — manually confirm ──────────────────
router.post('/api/reimbursements/:id/confirm', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = db.prepare(
    "UPDATE transactions SET navan_status = 'manual' WHERE id = ? AND reimbursable = 'reimbursable'"
  ).run([id]);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── POST /api/reimbursements/:id/unconfirm — reset to unconfirmed ─────────────
router.post('/api/reimbursements/:id/unconfirm', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = db.prepare(
    'UPDATE transactions SET navan_status = NULL WHERE id = ? AND reimbursable = \'reimbursable\''
  ).run([id]);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
