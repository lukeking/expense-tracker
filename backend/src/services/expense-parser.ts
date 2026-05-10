import type { PaymentMethod } from '../types';

export interface ParsedDescription {
  paymentMethod: PaymentMethod | null;
  categoryTag: string | null;
  plainTags: string[];
  items: { name: string; amount: number }[];
  note: string;
  warnings: string[];
}

const PAYMENT_KEYWORDS: { keywords: string[]; method: PaymentMethod }[] = [
  { keywords: ['現金', 'cash'], method: 'cash' },
  { keywords: ['信用卡', 'credit card', 'credit_card'], method: 'credit_card' },
  { keywords: ['悠遊卡', 'easy card', 'easy_card'], method: 'easy_card' },
  { keywords: ['行動支付', 'line pay', 'google pay', 'apple pay', 'prepaid_wallet'], method: 'prepaid_wallet' },
  { keywords: ['銀行轉帳', 'bank transfer', 'bank_account'], method: 'bank_account' },
];

function matchPaymentKeyword(token: string): PaymentMethod | null {
  const lower = token.toLowerCase().trim();
  for (const { keywords, method } of PAYMENT_KEYWORDS) {
    if (keywords.some((k) => k.toLowerCase() === lower)) return method;
  }
  return null;
}

export function parseDescription(description: string, totalAmount: number): ParsedDescription {
  const result: ParsedDescription = {
    paymentMethod: null,
    categoryTag: null,
    plainTags: [],
    items: [],
    note: '',
    warnings: [],
  };

  if (!description.trim()) return result;

  const tokens = description.split(',').map((t) => t.trim()).filter(Boolean);
  const noteFragments: string[] = [];
  let extraCategoryCount = 0;

  for (const token of tokens) {
    // Rule 1: starts with '#' and contains ':' → category tag (first only)
    if (token.startsWith('#') && token.includes(':')) {
      const tag = token.slice(1);
      if (result.categoryTag === null) {
        result.categoryTag = tag;
      } else {
        extraCategoryCount++;
      }
      continue;
    }

    // Rule 2: starts with '#', no ':' → plain tag
    if (token.startsWith('#')) {
      result.plainTags.push(token.slice(1));
      continue;
    }

    // Rule 3: exact payment keyword match (case-insensitive)
    const pm = matchPaymentKeyword(token);
    if (pm !== null) {
      result.paymentMethod = pm;
      continue;
    }

    // Rule 4: last whitespace-separated word is numeric → line item
    const parts = token.split(/\s+/);
    const lastWord = parts[parts.length - 1];
    if (parts.length >= 2 && /^\d+(\.\d+)?$/.test(lastWord)) {
      const itemAmount = Number(lastWord);
      const itemName = parts.slice(0, -1).join(' ');
      result.items.push({ name: itemName, amount: itemAmount });
      continue;
    }

    // Rule 5: everything else → note
    noteFragments.push(token);
  }

  result.note = noteFragments.join(' ');

  if (extraCategoryCount > 0) {
    result.warnings.push(`⚠️ 僅使用第一個分類標籤 #${result.categoryTag}，其餘忽略`);
  }

  if (result.items.length > 0) {
    const itemSum = result.items.reduce((sum, item) => sum + item.amount, 0);
    if (itemSum !== totalAmount) {
      const diff = Math.abs(totalAmount - itemSum);
      result.warnings.push(`⚠️ 項目合計 NT$${itemSum} ≠ 總金額 NT$${totalAmount}，差額 NT$${diff} 未歸類`);
    }
  }

  return result;
}
