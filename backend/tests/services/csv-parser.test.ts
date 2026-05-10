import { describe, it, expect } from 'vitest';
import {
  decodeCSVBuffer,
  parseROCDate,
  validateHeaders,
  parseCSVRows,
  groupInvoices,
  RowLimitError,
} from '../../src/services/csv-parser';

const VALID_HEADERS =
  '載具自訂名稱,發票日期,發票號碼,發票金額,發票狀態,折讓,賣方統一編號,賣方名稱,賣方地址,買方統編,消費明細_數量,消費明細_單價,消費明細_金額,消費明細_品名';

function makeRow(overrides: Record<string, string> = {}): string {
  const defaults: Record<string, string> = {
    '載具自訂名稱': '/手機條碼',
    '發票日期': '114/04/18',
    '發票號碼': 'AB-12345678',
    '發票金額': '180',
    '發票狀態': '正常',
    '折讓': '0',
    '賣方統一編號': '12345678',
    '賣方名稱': '全家便利商店股份有限公司',
    '賣方地址': '台北市',
    '買方統編': '',
    '消費明細_數量': '',
    '消費明細_單價': '',
    '消費明細_金額': '',
    '消費明細_品名': '',
    ...overrides,
  };
  return Object.values(defaults).join(',');
}

function makeCSV(dataRows: string[]): string {
  return [VALID_HEADERS, ...dataRows].join('\n');
}

describe('decodeCSVBuffer', () => {
  it('decodes valid UTF-8 buffer', () => {
    const text = '載具自訂名稱,發票號碼';
    const buf = new TextEncoder().encode(text).buffer as ArrayBuffer;
    expect(decodeCSVBuffer(buf)).toBe(text);
  });

  it('falls back to big5 when UTF-8 strict decode fails', () => {
    // Create a buffer with an invalid UTF-8 byte sequence
    const invalidUtf8 = new Uint8Array([0x80, 0x81]).buffer;
    // Should not throw; returns decoded string (may be garbled but no crash)
    expect(() => decodeCSVBuffer(invalidUtf8)).not.toThrow();
  });
});

describe('parseROCDate', () => {
  it('converts 114/04/18 to 2025-04-18', () => {
    const d = parseROCDate('114/04/18');
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(3); // April is month 3 (0-indexed)
    expect(d.getUTCDate()).toBe(18);
  });

  it('converts 113/01/01 to 2024-01-01', () => {
    const d = parseROCDate('113/01/01');
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(1);
  });

  it('throws on malformed date', () => {
    expect(() => parseROCDate('invalid')).toThrow();
  });
});

describe('validateHeaders', () => {
  it('returns true for correct government CSV headers', () => {
    const headers = VALID_HEADERS.split(',');
    expect(validateHeaders(headers)).toBe(true);
  });

  it('returns false when required header is missing', () => {
    const headers = ['發票日期', '發票號碼']; // incomplete
    expect(validateHeaders(headers)).toBe(false);
  });
});

describe('parseCSVRows', () => {
  it('parses a single valid row', () => {
    const csv = makeCSV([makeRow()]);
    const { rows, parseFailedCount } = parseCSVRows(csv);
    expect(rows).toHaveLength(1);
    expect(parseFailedCount).toBe(0);
    expect(rows[0]['發票號碼']).toBe('AB-12345678');
  });

  it('throws when headers are wrong', () => {
    const csv = 'wrong,headers\ndata,row';
    expect(() => parseCSVRows(csv)).toThrow('Invalid CSV headers');
  });

  it('skips malformed rows and increments parseFailedCount', () => {
    // A row with too few columns
    const csv = makeCSV([makeRow(), 'too,few']);
    const { rows, parseFailedCount } = parseCSVRows(csv);
    expect(rows).toHaveLength(1);
    expect(parseFailedCount).toBe(1);
  });

  it('returns empty for CSV with only headers', () => {
    const { rows } = parseCSVRows(VALID_HEADERS);
    expect(rows).toHaveLength(0);
  });
});

describe('groupInvoices', () => {
  it('groups multiple rows for the same invoice number into one invoice with items', () => {
    const row1 = makeRow({ '消費明細_品名': '牛肉麵', '消費明細_金額': '120', '消費明細_數量': '1', '消費明細_單價': '120' });
    const row2 = makeRow({ '消費明細_品名': '珍珠奶茶', '消費明細_金額': '60', '消費明細_數量': '1', '消費明細_單價': '60' });
    const { rows } = parseCSVRows(makeCSV([row1, row2]));
    const { invoices } = groupInvoices(rows);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].items).toHaveLength(2);
    expect(invoices[0].items[0].name).toBe('牛肉麵');
    expect(invoices[0].items[1].name).toBe('珍珠奶茶');
  });

  it('filters out voided invoices and increments skippedVoidedCount', () => {
    const row = makeRow({ '發票狀態': '已作廢' });
    const { rows } = parseCSVRows(makeCSV([row]));
    const { invoices, skippedVoidedCount } = groupInvoices(rows);
    expect(invoices).toHaveLength(0);
    expect(skippedVoidedCount).toBe(1);
  });

  it('filters out zero net-amount invoices and increments skippedZeroCount', () => {
    const row = makeRow({ '發票金額': '0', '折讓': '0' });
    const { rows } = parseCSVRows(makeCSV([row]));
    const { invoices, skippedZeroCount } = groupInvoices(rows);
    expect(invoices).toHaveLength(0);
    expect(skippedZeroCount).toBe(1);
  });

  it('uses net amount = gross - allowance', () => {
    const row = makeRow({ '發票金額': '200', '折讓': '50' });
    const { rows } = parseCSVRows(makeCSV([row]));
    const { invoices } = groupInvoices(rows);
    expect(invoices[0].net_amount).toBe(150);
    expect(invoices[0].gross_amount).toBe(200);
    expect(invoices[0].allowance).toBe(50);
  });

  it('handles two distinct invoice numbers as separate invoices', () => {
    const row1 = makeRow({ '發票號碼': 'AA-00000001' });
    const row2 = makeRow({ '發票號碼': 'BB-00000002' });
    const { rows } = parseCSVRows(makeCSV([row1, row2]));
    const { invoices } = groupInvoices(rows);
    expect(invoices).toHaveLength(2);
  });

  it('throws RowLimitError when grouped invoices exceed 1,000', () => {
    // Generate 1,001 unique invoice numbers
    const dataRows = Array.from({ length: 1001 }, (_, i) =>
      makeRow({ '發票號碼': `XX-${String(i + 1).padStart(8, '0')}` })
    );
    const { rows } = parseCSVRows(makeCSV(dataRows));
    expect(() => groupInvoices(rows)).toThrow(RowLimitError);
    expect(() => groupInvoices(rows)).toThrow('1001');
  });

  it('does not throw RowLimitError for exactly 1,000 invoices', () => {
    const dataRows = Array.from({ length: 1000 }, (_, i) =>
      makeRow({ '發票號碼': `YY-${String(i + 1).padStart(8, '0')}` })
    );
    const { rows } = parseCSVRows(makeCSV(dataRows));
    expect(() => groupInvoices(rows)).not.toThrow();
    const { invoices } = groupInvoices(rows);
    expect(invoices).toHaveLength(1000);
  });

  it('processes only the valid replacement when both a voided and active invoice for the same purchase appear', () => {
    // Merchant voided original invoice and issued a replacement with a new number
    const voidedRow = makeRow({ '發票號碼': 'CC-00000001', '發票狀態': '已作廢', '賣方名稱': '統一超商' });
    const validRow = makeRow({ '發票號碼': 'CC-00000002', '發票狀態': '正常', '賣方名稱': '統一超商' });
    const { rows } = parseCSVRows(makeCSV([voidedRow, validRow]));
    const { invoices, skippedVoidedCount } = groupInvoices(rows);

    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoice_number).toBe('CC-00000002');
    expect(skippedVoidedCount).toBe(1);
  });
});
