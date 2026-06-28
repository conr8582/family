const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/client');

let _client = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

async function lookupTransaction(id) {
  const tx = db.prepare(
    'SELECT description, amount_cents, date, notes_auto FROM transactions WHERE id = ?'
  ).get([id]);

  if (!tx) return null;
  if (tx.notes_auto) return tx.notes_auto;

  const absAmount = (Math.abs(tx.amount_cents) / 100).toFixed(2);
  const direction = tx.amount_cents < 0 ? 'charge' : 'credit';

  const response = await client().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 200,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Bank transaction: "${tx.description}" — $${absAmount} ${direction} on ${tx.date}. What merchant or service is this? Reply in one concise sentence.`,
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  const result = textBlock?.text?.trim() || 'Unable to identify this merchant.';

  db.prepare('UPDATE transactions SET notes_auto = ? WHERE id = ?').run([result, id]);
  return result;
}

module.exports = { lookupTransaction };
