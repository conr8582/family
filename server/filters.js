// Nunjucks custom filters

// "2026-06-27" → "Friday, June 27"
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// 205 cents → "$2.05" or "-$2.05"
function formatCents(cents) {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${dollars}` : `+$${dollars}`;
}

// "Chase Sapphire Reserve (1138)" → "···1138"
// Falls back to first word if no parens
function shortAccount(name) {
  const match = name.match(/\((\d+)\)$/);
  if (match) return `···${match[1]}`;
  return name.split(' ')[0];
}

// Plain dollar amount without +/- prefix (for actuals and budgets in tables)
function formatCentsPlain(cents) {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${dollars}` : `$${dollars}`;
}

// Variance: show as "+$X.XX" (green/neutral) or "-$X.XX" (red, handled by CSS class)
function formatVariance(cents) {
  if (cents === 0) return '—';
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${dollars}` : `+$${dollars}`;
}

// Nunjucks min filter: {{ [a, b] | min }}
function minFilter(arr) {
  return Math.min(...arr);
}

module.exports = { formatDate, formatCents, formatCentsPlain, formatVariance, shortAccount, minFilter };
