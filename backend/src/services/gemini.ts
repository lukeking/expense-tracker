import type { GeminiParseResult, Env } from '../types';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const SYSTEM_PROMPT = `You are a Taiwanese expense parser. Given a free-text expense description, extract the total amount and individual items.

Return ONLY valid JSON in this exact format:
{
  "amount": <number>,
  "items": [{"name": "<string>", "amount": <number or null>}],
  "tags": ["<string>"]
}

Rules:
- amount is the total NTD (no decimals)
- items is a list of what was purchased
- tags should be inferred categories like "food", "transport", "entertainment", "shopping"
- If no items are listed, items = []
- If tags cannot be determined, tags = []`;

const RAW_TEXT_SYSTEM_PROMPT = `You are a Taiwanese expense parser. Given a raw expense entry typed by a user, extract the total amount, items purchased, payment method keywords, and tags.

Return ONLY valid JSON in this exact format:
{
  "amount": <number>,
  "items": [{"name": "<string>", "amount": <number or null>}],
  "tags": ["<string>"]
}

Rules:
- amount is the total NTD integer (no decimals). Return 0 if no amount is detectable.
- items is a list of what was purchased
- tags should be inferred categories like "food", "transport", "entertainment", "shopping"
- If no items are listed, items = []
- If tags cannot be determined, tags = []
- The first token is usually the amount (e.g. "250 星巴克 拿鐵" → amount: 250)`;

export async function parseRawExpenseText(
  env: Env,
  rawText: string
): Promise<GeminiParseResult> {
  const response = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${RAW_TEXT_SYSTEM_PROMPT}\n\nExpense entry: ${rawText}` }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as Partial<GeminiParseResult>;

  return {
    amount: parsed.amount ?? 0,
    items: parsed.items ?? [],
    tags: parsed.tags ?? [],
  };
}

export async function parseExpenseText(
  env: Env,
  amount: number,
  description: string
): Promise<GeminiParseResult> {
  const prompt = `Amount: ${amount} NTD\nDescription: ${description}`;

  const response = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as Partial<GeminiParseResult>;

  return {
    amount: parsed.amount ?? amount,
    items: parsed.items ?? [],
    tags: parsed.tags ?? [],
  };
}
