require('dotenv').config();
const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const { runSync, scheduleDailySync } = require('./sync');
const { sessionMiddleware, requireAuth, handleLogin, handleLogout } = require('./auth');
const gmail = require('./gmail');
const filters = require('./filters');
const reviewRouter = require('./routes/review');
const budgetRouter = require('./routes/budget');
const reimbursementsRouter = require('./routes/reimbursements');
const { lookupTransaction } = require('./lookup');

const app = express();
const PORT = process.env.PORT || 3000;

// Template engine
const nunjucksEnv = nunjucks.configure(path.join(__dirname, '../views'), {
  autoescape: true,
  express: app,
  watch: process.env.NODE_ENV === 'development',
});
nunjucksEnv.addFilter('formatDate',      filters.formatDate);
nunjucksEnv.addFilter('formatCents',     filters.formatCents);
nunjucksEnv.addFilter('formatCentsPlain',filters.formatCentsPlain);
nunjucksEnv.addFilter('formatVariance',  filters.formatVariance);
nunjucksEnv.addFilter('shortAccount',    filters.shortAccount);
nunjucksEnv.addFilter('min',             filters.minFilter);
app.set('view engine', 'njk');

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Static assets
app.use(express.static(path.join(__dirname, '../public')));

// Trust Fly.io's proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);

// Sessions
app.use(sessionMiddleware());

// ── Unauthenticated routes ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/login',  (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.render('login.njk');
});
app.post('/login',  handleLogin);
app.post('/logout', handleLogout);

// ── Auth wall — everything below requires a valid session ─────────────────────
app.use(requireAuth);

app.post('/api/sync', async (req, res) => {
  try {
    const result = await runSync();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[/api/sync]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Gmail OAuth setup — connect once to enable Amazon transaction enrichment
app.get('/setup/gmail', (req, res) => {
  if (!gmail.isConfigured()) {
    return res.status(400).send(
      'Gmail not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to .env.'
    );
  }
  res.redirect(gmail.getAuthUrl());
});

app.get('/setup/gmail/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Gmail auth error: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code.');
  try {
    await gmail.exchangeCode(code);
    res.send(
      '<p>Gmail connected. Amazon transactions will have item details pulled into notes during the next sync.</p>' +
      '<p><a href="/">Return to app</a></p>'
    );
  } catch (err) {
    console.error('[/setup/gmail/callback]', err.message);
    res.status(500).send(`Failed to connect Gmail: ${err.message}`);
  }
});

app.post('/api/transactions/:id/lookup', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  try {
    const result = await lookupTransaction(id);
    if (result === null) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ result });
  } catch (err) {
    console.error('[/api/transactions/:id/lookup]', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

app.use('/', reviewRouter);
app.use('/', budgetRouter);
app.use('/', reimbursementsRouter);

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server running on http://localhost:${PORT}`);
  scheduleDailySync();
});
