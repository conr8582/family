const db = require('../db/client');

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get([key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run([key, value]);
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function isAuthorized() {
  return !!getSetting('gmail_refresh_token');
}

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  storeTokens(await res.json());
}

function storeTokens(data) {
  if (data.refresh_token) setSetting('gmail_refresh_token', data.refresh_token);
  setSetting('gmail_access_token', data.access_token);
  const expiry = Date.now() + (data.expires_in - 60) * 1000;
  setSetting('gmail_token_expiry', expiry.toString());
}

async function getAccessToken() {
  const expiry = parseInt(getSetting('gmail_token_expiry') || '0', 10);
  if (Date.now() < expiry) return getSetting('gmail_access_token');

  const refreshToken = getSetting('gmail_refresh_token');
  if (!refreshToken) throw new Error('Gmail not authorized — visit /setup/gmail to connect');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  storeTokens(data);
  return data.access_token;
}

async function gmailGet(path, params = {}) {
  const token = await getAccessToken();
  const url = new URL(`${GMAIL_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API error (${res.status}): ${await res.text()}`);
  return res.json();
}

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Walk MIME parts looking for text/plain, fall back to stripped HTML
function getBodyText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }
  for (const part of payload.parts || []) {
    const text = getBodyText(part);
    if (text) return text;
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64(payload.body.data).replace(/<[^>]+>/g, ' ');
  }
  return '';
}

// Find the order total charged to the card in the email body
function extractOrderTotal(text) {
  const patterns = [
    /order\s+total[:\s]+\$?([\d,]+\.\d{2})/i,
    /charged\s+to[^$\n]{0,40}\$\s*([\d,]+\.\d{2})/i,
    /amount\s+charged[:\s]+\$?([\d,]+\.\d{2})/i,
    /shipment\s+total[:\s]+\$?([\d,]+\.\d{2})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
  }
  return null;
}

// Pull items from Amazon email subject lines
function extractItemsFromSubject(subject) {
  // "Your Amazon.com order of [items] has shipped."
  const m1 = subject.match(/Your Amazon\.com order of (.+?) has shipped/i);
  if (m1) return m1[1].trim();

  // "Your Amazon.com order of [items]" (order confirmation)
  const m2 = subject.match(/Your Amazon\.com order of (.+)/i);
  if (m2) return m2[1].replace(/[.\s]+$/, '').trim();

  return null;
}

function gmailDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// Returns a string of item names for the transaction, or null if not found.
async function findAmazonItems(txDate, amountCents) {
  if (!isConfigured() || !isAuthorized()) return null;

  const absAmount = Math.abs(amountCents) / 100;

  // Amazon emails typically arrive 1-3 days before the card posts. Search a wide window.
  const date = new Date(txDate + 'T12:00:00Z');
  const afterDate = new Date(date.getTime() - 5 * 24 * 60 * 60 * 1000);
  const beforeDate = new Date(date.getTime() + 3 * 24 * 60 * 60 * 1000);

  const query = [
    'from:(shipment-tracking@amazon.com OR auto-confirm@amazon.com OR order-update@amazon.com)',
    `after:${gmailDate(afterDate)}`,
    `before:${gmailDate(beforeDate)}`,
  ].join(' ');

  const list = await gmailGet('/users/me/messages', { q: query, maxResults: '20' });
  if (!list.messages?.length) return null;

  // Match by amount — within 5% or $1, whichever is larger
  const tolerance = Math.max(absAmount * 0.05, 1.00);
  let bestItems = null;
  let bestDiff = Infinity;

  for (const ref of list.messages) {
    try {
      const msg = await gmailGet(`/users/me/messages/${ref.id}`, { format: 'full' });
      const headers = msg.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const bodyText = getBodyText(msg.payload);
      const emailAmount = extractOrderTotal(bodyText);

      if (emailAmount === null) continue;

      const diff = Math.abs(emailAmount - absAmount);
      if (diff <= tolerance && diff < bestDiff) {
        const items = extractItemsFromSubject(subject);
        if (items) {
          bestDiff = diff;
          bestItems = items;
        }
      }
    } catch (err) {
      console.warn(`[gmail] Skipping message ${ref.id}:`, err.message);
    }
  }

  return bestItems;
}

module.exports = { isConfigured, isAuthorized, getAuthUrl, exchangeCode, findAmazonItems };
