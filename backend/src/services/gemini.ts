import type { GeminiParseResult, Env } from '../types';

const GEMINI_URL = (modelName: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

const COMMON_PROMPT_RESPONSE_FORMAT = `
Return ONLY valid JSON following this schema:
{
  "type": "object",
  "properties": {
    "amount": { "type": "number" },
    "payment_method": {
      "type": "string",
      "enum": ["cash", "credit_card", "prepaid_wallet", "easy_card", "bank_account"]
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "amount": { "type": ["number", "null"] }
        },
        "required": ["name"],
        "additionalProperties": false
      }
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["amount", "payment_method", "items", "tags"],
  "additionalProperties": false
}
`;

const DISCORD_PROMPT_RULES = `
Rules:
- amount is the total NTD (no decimals)
- payment_method: always return "cash" (payment method is provided as a separate Discord option)
- items is a list of what was purchased, if amount comes along with item, bind them together into one element in items
- If there is only one item in list, the 'items.amount' should to the same with total amount
- Extract all words with a leading '#' as tags by removing the '#' prefix. no missing nor duplicate tags allowed.
- If tags cannot be determined, tags = []
- If no items are listed, items = []
`;

const ANDROID_PROMPT_RULES = `
Rules:
- amount is the total NTD (no decimals)
- payment_method mapping:
  - 信用卡 -> credit_card
  - 現金 -> cash
  - 悠遊卡 -> easy_card
  - 行動支付 (e.g. Line Pay, Google Pay) -> prepaid_wallet
  - 銀行轉帳 -> bank_account
- items is a list of what was purchased, if amount comes along with item, bind them together into one element in items
- If there is only one item in list, the 'items.amount' should to the same with total amount
- A token is a line item ONLY if its last whitespace-separated word is a number. Freeform text tokens without a trailing numeric word MUST NOT be extracted as line items.
- Extract all words with a leading '#' as tags by removing the '#' prefix. Preserve any ':' characters within the tag (e.g. '#食:午餐' -> '食:午餐'). No missing nor duplicate tags allowed.
- If tags cannot be determined, tags = []
- If no items are listed, items = []
`;

const SYSTEM_PROMPT = `You are a Taiwanese expense parser. Given a free-text expense description, extract the total amount and individual items.
${COMMON_PROMPT_RESPONSE_FORMAT}

${DISCORD_PROMPT_RULES}
`;

const RAW_TEXT_SYSTEM_PROMPT = `You are a Taiwanese expense parser. Given a raw expense entry typed by a user, extract the total amount, items purchased, payment method keywords, and tags.
${COMMON_PROMPT_RESPONSE_FORMAT}

${ANDROID_PROMPT_RULES}
- The first token is usually the total amount (e.g. "250 星巴克 拿鐵" → amount: 250)
`;

export async function parseRawExpenseText(
  env: Env,
  rawText: string
): Promise<GeminiParseResult> {
  const response = await fetch(`${GEMINI_URL(env.GEMINI_MODEL_NAME)}?key=${env.GEMINI_API_KEY}`, {
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
    payment_method: parsed.payment_method ?? 'cash',
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

  const response = await fetch(`${GEMINI_URL(env.GEMINI_MODEL_NAME)}?key=${env.GEMINI_API_KEY}`, {
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
    payment_method: parsed.payment_method ?? 'cash',
    items: parsed.items ?? [],
    tags: parsed.tags ?? [],
  };
}
