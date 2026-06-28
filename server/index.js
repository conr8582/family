require('dotenv').config();
const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const { runSync, scheduleDailySync } = require('./sync');
const { sessionMiddleware, requireAuth, handleLogin, handleLogout } = require('./auth');
const filters = require('./filters');
const reviewRouter = require('./routes/review');
const budgetRouter = require('./routes/budget');

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

app.use('/', reviewRouter);
app.use('/', budgetRouter);

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server running on http://localhost:${PORT}`);
  scheduleDailySync();
});
