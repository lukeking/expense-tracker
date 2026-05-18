import * as fs from 'fs';
import type { PaymentMethod } from '../types';
import { BEIZHU_RULES, SUBCATEGORY_REMAP, TAG_CORRECTIONS } from './legacy-csv-config';

export interface ParsedLegacyRow {
  transaction_at: string;
  transaction_type: 'expense' | 'refund';
  amount: number;
  note: string;
  items: { name: string; amount: number; tags: string[] }[];
  tags: string[];
  payment_method: PaymentMethod;
  source: 'legacy_migration';
  is_matched: false;
  _dedup_key: string;
  _raw_line: number;
}

export interface ParseStats {
  total: number;
  skipped99: number;
  expenses: number;
  income: number;
  parseFailures: number;
  nonTWD: number;
  unmappedCategories: string[];
  unmappedAccounts: string[];
}

export function makeStats(): ParseStats {
  return {
    total: 0,
    skipped99: 0,
    expenses: 0,
    income: 0,
    parseFailures: 0,
    nonTWD: 0,
    unmappedCategories: [],
    unmappedAccounts: [],
  };
}

// NaggingMoney 分類 → tag prefix (kept in original Chinese to match user's mental model)
// Note: '店' is intentionally excluded — handled separately by resolveStoreRow()
const CATEGORY_MAP: Record<string, string> = {
  '食': '食',
  '行': '行',
  '他': '其他',
  '醫': '醫',
  '住': '住',
  '衣': '衣',
  '樂': '樂',
  '育': '育',
};

// 備註 values seen on 店-category rows → real consuming category
const STORE_BEIZHU_CATEGORY: Record<string, string> = {
  早餐: '食', 午餐: '食', 晚餐: '食', 宵夜: '食', 下午茶: '食',
  零食: '食', 飲料: '食', 咖啡: '食', 冰品: '食', 牛奶: '食',
  瓶裝水: '食', 點心: '食', 水果: '食', 燕麥: '食', 泡麵: '食',
  蛋: '食', 食材: '食', 茶葉蛋: '食', 美式: '食', 鮮乳: '食',
  豆腐: '食', 養樂多: '食', 桶裝水: '食', 補給: '食', 冰塊: '食',
  日用品: '其他', 口罩: '醫',
  文具: '其他', 影印: '其他', 列印: '其他',
  電池: '其他',
};

function mapStoreCategoryFromBeizhu(beizhu: string): string {
  if (STORE_BEIZHU_CATEGORY[beizhu]) return STORE_BEIZHU_CATEGORY[beizhu];
  if (beizhu.includes('成藥') || beizhu.includes('藥')) return '醫';
  if (/早餐|午餐|晚餐|飯|麵|麵包|點心|食|飲|咖啡|茶|水/.test(beizhu)) return '食';
  // Default: most 店 purchases are food/convenience
  return '食';
}

// For 店-category rows: derive real category from 備註; store name → plain tag
function resolveStoreRow(
  subcategory: string,
  description: string,
  rawItem: string,
  beiZhu: string
): { categoryTag: string; storeTag: string; resolvedNote: string } {
  let realSubcat: string;
  let realCategory: string;
  let storeTag: string;

  if (beiZhu) {
    // 備註 = what was bought; item field = store name
    realSubcat = beiZhu;
    realCategory = mapStoreCategoryFromBeizhu(beiZhu);
    storeTag = description !== rawItem ? description : subcategory;
  } else if (subcategory !== description) {
    // Item has ) separator: before ) = meal type, after ) = store name
    realSubcat = subcategory;
    realCategory = mapStoreCategoryFromBeizhu(subcategory);
    storeTag = description;
  } else {
    // No 備註, no ) — store name only, no context
    realSubcat = '其他';
    realCategory = '食';
    storeTag = rawItem;
  }

  return {
    categoryTag: `${realCategory}:${realSubcat}`,
    storeTag,
    resolvedNote: realSubcat !== '其他' ? realSubcat : description || rawItem,
  };
}

// -- beiZhu disambiguation rules (GROUP D + annotated GROUP E) --
// If a rule exists: push rule.tag as tag (if set), override noteText with rule.note (if set).
// If no rule: push beiZhu verbatim as a plain tag (default).
// Empty rule {} suppresses tag creation without overriding the note.

export interface BeizhuRule {
  tag?: string;
  note?: string;
  items?: Array<{ name: string; amount: number }>;
}

// -- Subcategory normalisation --
// Strip trailing " NT" (NaggingMoney naming artifact) then apply semantic remap.

function normalizeSubcategory(raw: string): string {
  const stripped = raw.replace(/ NT$/, '').trim();
  return SUBCATEGORY_REMAP[stripped] ?? stripped;
}

// Parse beiZhu values that contain multiple named amounts into transaction_items.
// Returns null when beiZhu doesn't match a known multi-item pattern.
export function parseBeiZhuItems(
  beiZhu: string,
): Array<{ name: string; amount: number }> | null {
  // Laundry: [床單 ]洗N 烘N
  const laundry = beiZhu.match(/^(床單\s+)?洗\s*(\d+)\s+烘\s*(\d+)$/);
  if (laundry) {
    const pfx = laundry[1] ? '床單' : '';
    return [
      { name: pfx + '洗衣', amount: parseInt(laundry[2]) },
      { name: pfx + '烘衣', amount: parseInt(laundry[3]) },
    ];
  }

  // General: 2+ space-separated segments each of the form "text+digits" (no space between name and amount)
  // e.g. "機油350 後輪1450" or "擴鼻器290 漢服244"
  const segs = beiZhu.trim().split(/\s+/);
  if (segs.length >= 2) {
    const parsed = segs.map((seg) => {
      const m = seg.match(/^([^\d]+)(\d+)$/);
      return m ? { name: m[1], amount: parseInt(m[2], 10) } : null;
    });
    if (parsed.every(Boolean)) {
      return parsed as Array<{ name: string; amount: number }>;
    }
  }

  return null;
}

const PAYMENT_MAP: Record<string, PaymentMethod> = {
  '現金': 'cash',
  '信用卡': 'credit_card',
  '悠遊卡': 'easy_card',
  '銀行': 'bank_account',
};

// -- Parsers --

export function parseDateToISO(dateStr: string): string | null {
  const match = dateStr.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}:\d{2})$/);
  if (!match) return null;
  const time = match[2].padStart(8, '0');
  return `${match[1]}T${time}+08:00`;
}

export function parseAmount(amountStr: string): number | null {
  const stripped = amountStr.trim().replace(/^NT\$?/i, '').trim();
  const num = Number(stripped);
  if (!isNaN(num) && isFinite(num) && stripped !== '') return Math.round(num);
  return null;
}

export function parseItemField(item: string): { subcategory: string; description: string } {
  const parenIdx = item.indexOf(')');
  if (parenIdx > 0) {
    return {
      subcategory: item.slice(0, parenIdx).trim(),
      description: item.slice(parenIdx + 1).trim(),
    };
  }
  return { subcategory: item.trim(), description: item.trim() };
}

export function mapPaymentMethod(account: string, stats: ParseStats): PaymentMethod {
  const trimmed = account.trim();
  if (!trimmed) return 'cash';
  const mapped = PAYMENT_MAP[trimmed];
  if (mapped) return mapped;
  if (!stats.unmappedAccounts.includes(trimmed)) stats.unmappedAccounts.push(trimmed);
  return 'cash';
}

export function buildDedupKey(amount: number, transactionAt: string, note: string): string {
  return `${amount}|${transactionAt}|${note}`;
}

// -- CSV line splitter (handles quoted fields) --

export function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// -- Row parser --

const EXPECTED_HEADERS = ['日期', '類型', '支出帳戶', '收入帳戶', '分類', '項目', '金額', '貨幣', '發票號碼', '備註', '標籤'];

export function validateHeaders(headers: string[]): boolean {
  return EXPECTED_HEADERS.every((h, i) => headers[i] === h);
}

export function parseRow(cols: string[], lineNum: number, stats: ParseStats): ParsedLegacyRow | null {
  stats.total++;

  const type = cols[1]?.trim() ?? '';

  // Skip daily balance markers
  if (type === '99') {
    stats.skipped99++;
    stats.total--; // type-99 rows don't count toward parsed total
    return null;
  }

  let txType: 'expense' | 'refund';
  if (type === '支出') {
    txType = 'expense';
  } else if (type === '收入') {
    txType = 'refund';
  } else {
    stats.parseFailures++;
    return null;
  }

  const transactionAt = parseDateToISO(cols[0] ?? '');
  if (!transactionAt) {
    stats.parseFailures++;
    return null;
  }

  const amount = parseAmount(cols[6] ?? '');
  if (amount === null || amount <= 0) {
    stats.parseFailures++;
    return null;
  }

  const currency = cols[7]?.trim() ?? '';
  if (currency && currency !== 'TWD') {
    stats.nonTWD++;
  }

  const category = cols[4]?.trim() ?? '';
  const rawItem = cols[5]?.trim() ?? '';
  const { subcategory: rawSubcat, description: rawDesc } = parseItemField(rawItem);
  const subcategory = normalizeSubcategory(rawSubcat);
  const description = rawDesc.replace(/ NT$/, '').trim();
  const beiZhu = cols[9]?.trim() ?? '';

  let tags: string[];
  let noteText: string;

  if (category === '店') {
    // 店 rows: reclassify from 備註; store name becomes plain tag (不再保留店分類)
    const { categoryTag, storeTag, resolvedNote } = resolveStoreRow(subcategory, description, rawItem, beiZhu);
    tags = [categoryTag];
    if (storeTag) tags.push(storeTag);
    noteText = resolvedNote;
  } else {
    const categoryPrefix = CATEGORY_MAP[category];
    if (category && !categoryPrefix) {
      if (!stats.unmappedCategories.includes(category)) stats.unmappedCategories.push(category);
    }
    const prefix = categoryPrefix ?? '其他';
    tags = [`${prefix}:${subcategory}`];
    noteText = description || rawItem;
    if (beiZhu) {
      const rule = BEIZHU_RULES[beiZhu];
      if (rule) {
        if (rule.tag) {
          // tag with ':' overrides the category:sub tag (reclassify misfiled category)
          if (rule.tag.includes(':')) tags[0] = rule.tag;
          else tags.push(rule.tag);
        }
        if (rule.note !== undefined) noteText = rule.note;
      } else if (/^\d+$/.test(beiZhu)) {
        // Pure-numeric beiZhu (e.g. parking dates like "0421", "20230103") — append to note, not tag
        noteText = noteText ? `${noteText} ${beiZhu}` : beiZhu;
      } else if (beiZhu.includes('→') || beiZhu.includes('↔')) {
        // Transit route (e.g. "亞東醫院→善導寺", "板橋↔台東") — store as note, not tag
        noteText = beiZhu;
      } else {
        tags.push(beiZhu);
      }
    }
  }

  // Fix misclassified category:sub tags
  tags = tags.flatMap((t) => TAG_CORRECTIONS[t] ?? [t]);

  // Payment method from account field
  const account = (txType === 'expense' ? cols[2] : cols[3]) ?? '';
  const paymentMethod = mapPaymentMethod(account, stats);

  if (txType === 'expense') {
    stats.expenses++;
  } else {
    stats.income++;
  }

  const dedupKey = buildDedupKey(amount, transactionAt, noteText);
  const categoryTag = tags.find((t) => t.includes(':')) ?? '';
  const itemTags = categoryTag ? [categoryTag] : [];

  const beiZhuRuleItems = beiZhu ? BEIZHU_RULES[beiZhu]?.items : undefined;
  const parsedItems = !beiZhuRuleItems && beiZhu ? parseBeiZhuItems(beiZhu) : null;
  const itemList = beiZhuRuleItems ?? parsedItems;
  const items = itemList
    ? itemList.map((it) => ({ name: it.name, amount: it.amount, tags: itemTags }))
    : [{ name: noteText, amount, tags: itemTags }];

  return {
    transaction_at: transactionAt,
    transaction_type: txType,
    amount,
    note: noteText,
    items,
    tags,
    payment_method: paymentMethod,
    source: 'legacy_migration',
    is_matched: false,
    _dedup_key: dedupKey,
    _raw_line: lineNum,
  };
}

// -- File reader --

export interface ReadResult {
  rows: ParsedLegacyRow[];
  stats: ParseStats;
}

export function readCSVFile(filePath: string): ReadResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (lines.length < 2) return { rows: [], stats: makeStats() };

  const headers = splitCSVLine(lines[0]);
  if (!validateHeaders(headers)) {
    throw new Error(
      `Unexpected CSV headers. Expected NaggingMoney format.\nGot: ${headers.join(', ')}`
    );
  }

  const stats = makeStats();
  const rows: ParsedLegacyRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 8) {
      stats.parseFailures++;
      continue;
    }
    const row = parseRow(cols, i + 1, stats);
    if (row) rows.push(row);
  }

  return { rows, stats };
}

// -- Raw row reader for 備註 analysis --

export interface RawLegacyRow {
  lineNum: number;
  type: string;
  category: string;
  item: string;
  beizhu: string;
}

export function readRawRows(filePath: string): RawLegacyRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  const result: RawLegacyRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 10) continue;
    const type = cols[1]?.trim() ?? '';
    if (type === '99') continue;
    const beizhu = cols[9]?.trim() ?? '';
    if (!beizhu) continue;
    result.push({
      lineNum: i + 1,
      type,
      category: cols[4]?.trim() ?? '',
      item: cols[5]?.trim() ?? '',
      beizhu,
    });
  }

  return result;
}
