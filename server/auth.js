const bcrypt = require('bcryptjs');
const session = require('express-session');

function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === 'dev-secret-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be set to a random value in production.');
    }
  }
  return session({
    secret: secret || 'dev-only',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  });
}

// Middleware: redirect unauthenticated requests to /login
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

// POST /login handler
async function handleLogin(req, res) {
  const { username, password } = req.body;
  const expectedUser = process.env.APP_USERNAME;
  const expectedHash = process.env.APP_PASSWORD_HASH;

  if (!expectedUser || !expectedHash) {
    return res.render('login.njk', {
      error: 'Server is not configured (APP_USERNAME / APP_PASSWORD_HASH missing).',
    });
  }

  const usernameMatch = username === expectedUser;
  // Always run bcrypt compare to prevent timing attacks on username
  const passwordMatch = await bcrypt.compare(password || '', expectedHash);

  if (usernameMatch && passwordMatch) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect('/');
  }

  res.render('login.njk', { error: 'Incorrect username or password.' });
}

// POST /logout handler
function handleLogout(req, res) {
  req.session.destroy(() => res.redirect('/login'));
}

module.exports = { sessionMiddleware, requireAuth, handleLogin, handleLogout };
