import type { RawInvoiceRow, ParsedInvoice, InvoiceItem } from '../types';

export class RowLimitError extends Error {
  constructor(public readonly actual: number) {
    super(`CSV contains ${actual} invoices — maximum per import is 1,000. Split by date range and re-upload.`);
    this.name = 'RowLimitError';
  }
}

const EXPECTED_HEADERS = [
  '載具自訂名稱', '發票日期', '發票號碼', '發票金額', '發票狀態', '折讓',
  '賣方統一編號', '賣方名稱', '賣方地址', '買方統編',
  '消費明細_數量', '消費明細_單價', '消費明細_金額', '消費明細_品名',
];

export function decodeCSVBuffer(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    return new TextDecoder('big5').decode(buffer);
  }
}

export function parseROCDate(raw: string): Date {
  const s = raw.trim();
  if (/^\d{8}$/.test(s)) {
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  }
  const parts = s.split('/');
  if (parts.length !== 3) throw new Error(`Invalid date: ${raw}`);
  const [rocYear, month, day] = parts.map(Number);
  return new Date(Date.UTC(rocYear + 1911, month - 1, day));
}

export function validateHeaders(headers: string[]): boolean {
  return EXPECTED_HEADERS.every((h) => headers.includes(h));
}

export function parseCSVRows(csv: string): { rows: RawInvoiceRow[]; parseFailedCount: number } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '' && l.includes(','));
  if (lines.length < 2) return { rows: [], parseFailedCount: 0 };

  const headers = lines[0].split(',');
  if (!validateHeaders(headers)) {
    throw new Error('Invalid CSV headers: not a government e-invoice export');
  }

  let parseFailedCount = 0;
  const rows: RawInvoiceRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = splitCSVLine(lines[i]);
      if (values.length < headers.length) {
        parseFailedCount++;
        continue;
      }
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
      rows.push(row as unknown as RawInvoiceRow);
    } catch {
      parseFailedCount++;
    }
  }

  return { rows, parseFailedCount };
}

function splitCSVLine(line: string): string[] {
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

export function groupInvoices(rows: RawInvoiceRow[]): {
  invoices: ParsedInvoice[];
  skippedVoidedCount: number;
  skippedZeroCount: number;
} {
  // First pass: group rows by invoice number preserving order
  const rowGroups = new Map<string, RawInvoiceRow[]>();
  for (const row of rows) {
    const invoiceNumber = row['發票號碼'].trim();
    if (!invoiceNumber) continue;
    if (!rowGroups.has(invoiceNumber)) rowGroups.set(invoiceNumber, []);
    rowGroups.get(invoiceNumber)!.push(row);
  }

  const invoices: ParsedInvoice[] = [];
  let skippedVoidedCount = 0;
  let skippedZeroCount = 0;

  for (const [invoiceNumber, group] of rowGroups) {
    const firstRow = group[0];

    if (firstRow['發票狀態'].trim() === '已作廢') {
      skippedVoidedCount++;
      continue;
    }

    // Sum all row amounts to get true gross and inline discount amounts
    let grossAmount = 0;
    let inlineDiscount = 0;
    const items: InvoiceItem[] = [];

    for (const row of group) {
      const rowAmount = Number(row['發票金額']) || 0;
      if (rowAmount > 0) {
        grossAmount += rowAmount;
      } else if (rowAmount < 0) {
        inlineDiscount += Math.abs(rowAmount);
      }

      const itemName = row['消費明細_品名'].trim();
      const itemAmount = Number(row['消費明細_金額']) || 0;
      if (itemName && itemAmount > 0) {
        items.push({
          name: itemName,
          quantity: Number(row['消費明細_數量']) || 1,
          unit_price: Number(row['消費明細_單價']) || 0,
          amount: itemAmount,
        });
      }
    }

    // Combine inline discounts with any formal allowance from 折讓 column
    const formalAllowance = Number(firstRow['折讓']) || 0;
    const allowance = formalAllowance + inlineDiscount;
    const netAmount = grossAmount - allowance;

    if (netAmount === 0) {
      skippedZeroCount++;
      continue;
    }

    let invoiceDate: Date;
    try {
      invoiceDate = parseROCDate(firstRow['發票日期']);
    } catch {
      continue;
    }

    invoices.push({
      invoice_number: invoiceNumber,
      seller_name: firstRow['賣方名稱'].trim(),
      seller_tax_id: firstRow['賣方統一編號'].trim(),
      invoice_date: invoiceDate,
      gross_amount: grossAmount,
      allowance,
      net_amount: netAmount,
      invoice_status: 'active',
      items,
    });
  }

  if (invoices.length > 1000) throw new RowLimitError(invoices.length);
  return { invoices, skippedVoidedCount, skippedZeroCount };
}
