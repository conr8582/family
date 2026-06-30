const Anthropic = require('@anthropic-ai/sdk');

let _client = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

async function extractNavanTransactions(imageData) {
  const mediaTypeMatch = imageData.match(/^data:([^;]+);base64,/);
  const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : 'image/png';
  const base64Data = imageData.replace(/^data:[^;]+;base64,/, '');

  const response = await client().messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data },
        },
        {
          type: 'text',
          text: `Extract all expense transactions from this Navan screenshot.
Return ONLY a JSON array, no other text. Each item: {"merchant":"...","amount":12.34,"status":"Reimbursed"}
Status must be exactly one of: "Reimbursed", "Submitted", "Under Review", "Rejected".
Return [] if no transactions are visible.`,
        },
      ],
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '[]';
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

module.exports = { extractNavanTransactions };
