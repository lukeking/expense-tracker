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

function matchPayment(token: string): PaymentMethod | null {
  const lower = token.toLowerCase();
  for (const { keywords, method } of PAYMENT_KEYWORDS) {
    if (keywords.some((k) => k.toLowerCase() === lower)) return method;
  }
  return null;
}

function parseLineItem(token: string): { name: string; amount: number } | null {
  const words = token.split(/\s+/);
  if (words.length < 2) return null;
  const lastWord = words[words.length - 1];
  const num = Number(lastWord);
  if (!isNaN(num) && isFinite(num) && lastWord.trim() !== '') {
    return { name: words.slice(0, -1).join(' '), amount: num };
  }
  return null;
}

export function parseDescription(description: string, totalAmount: number): ParsedDescription {
  const tokens = description.split(',').map((t) => t.trim()).filter(Boolean);

  let paymentMethod: PaymentMethod | null = null;
  let categoryTag: string | null = null;
  const extraCategoryTags: string[] = [];
  const plainTags: string[] = [];
  const items: { name: string; amount: number }[] = [];
  const noteParts: string[] = [];
  const warnings: string[] = [];

  for (const token of tokens) {
    if (token.startsWith('#')) {
      const tagBody = token.slice(1);
      if (tagBody.includes(':')) {
        if (categoryTag === null) {
          categoryTag = tagBody;
        } else {
          extraCategoryTags.push(tagBody);
        }
      } else {
        plainTags.push(tagBody);
      }
      continue;
    }

    const pm = matchPayment(token);
    if (pm !== null) {
      paymentMethod = pm;
      continue;
    }

    const lineItem = parseLineItem(token);
    if (lineItem !== null) {
      items.push(lineItem);
      continue;
    }

    noteParts.push(token);
  }

  if (extraCategoryTags.length > 0) {
    warnings.push(`⚠️ 僅使用第一個分類標籤 #${categoryTag}，其餘忽略`);
  }

  if (items.length > 0) {
    const itemTotal = items.reduce((sum, i) => sum + i.amount, 0);
    if (itemTotal !== totalAmount) {
      const diff = Math.abs(totalAmount - itemTotal);
      warnings.push(`⚠️ 項目合計 NT$${itemTotal} ≠ 總金額 NT$${totalAmount}，差額 NT$${diff} 未歸類`);
    }
  }

  return {
    paymentMethod,
    categoryTag,
    plainTags,
    items,
    note: noteParts.join(' '),
    warnings,
  };
}
