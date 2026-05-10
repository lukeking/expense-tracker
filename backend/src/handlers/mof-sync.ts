import type { Env, ReceiptItem } from '../types';
import { getSupabaseClient } from '../db/client';
import { upsertReceipts } from '../db/queries';
import { runMatchingAlgorithm } from '../services/matcher';
import { sendDiscordAlert } from '../services/discord-notify';

interface MofInvoiceDetail {
  rowNum: number;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

interface MofInvoice {
  invNum: string;
  sellerName: string;
  sellerBan: string;
  invDate: string;
  amount: string;
  details: MofInvoiceDetail[];
}

interface MofResponse {
  code: number;
  msg: string;
  details?: MofInvoice[];
}

function rocDateToCE(rocDate: string): string {
  // "112/05/04" → "2023-05-04"
  const [year, month, day] = rocDate.split('/');
  return `${parseInt(year) + 1911}-${month}-${day}`;
}

function getYesterdayTaiwanDate(): string {
  // Taiwan is UTC+8
  const now = new Date();
  const taiwanNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const yesterday = new Date(taiwanNow.getTime() - 24 * 60 * 60 * 1000);
  const y = yesterday.getUTCFullYear();
  const m = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(yesterday.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

export async function fetchMofInvoices(env: Env, date: string): Promise<MofInvoice[]> {
  const params = new URLSearchParams({
    version: '0.5',
    type: 'B2',
    carrierId2: encodeURIComponent(env.MOF_CARRIER_ID),
    cardEncrypt: env.MOF_VERIFICATION_CODE,
    appID: env.MOF_API_KEY,
    action: 'carrierInvChk',
    startDate: date,
    endDate: date,
    onlyWinningInv: 'N',
  });

  const url = `https://einvoice.nat.gov.tw/PB2CAPIVAN/CarrierInvChk?${params}`;
  const resp = await fetch(url);
  const data = (await resp.json()) as MofResponse;

  if (data.code === 404) return [];
  if (data.code === 401) {
    await sendDiscordAlert(env, '⚠️ 財政部 API 認證失敗，請重新設定驗證碼。');
    throw new Error('MOF API auth failure');
  }
  if (data.code === 429 || data.code >= 500) {
    console.error(`MOF API error: ${data.code} ${data.msg}`);
    return [];
  }
  if (data.code !== 200) {
    console.error(`MOF API unexpected code: ${data.code} ${data.msg}`);
    return [];
  }

  return data.details ?? [];
}

export async function handleMofSync(env: Env): Promise<void> {
  const supabase = getSupabaseClient(env);
  const date = getYesterdayTaiwanDate();

  const invoices = await fetchMofInvoices(env, date);

  const receipts = invoices.map((inv) => ({
    invoice_number: inv.invNum,
    random_code: '',
    seller_name: inv.sellerName,
    seller_tax_id: inv.sellerBan,
    total_amount: parseInt(inv.amount),
    items: inv.details.map(
      (d): ReceiptItem => ({
        name: d.description,
        count: parseFloat(d.quantity),
        unit_price: parseInt(d.unitPrice),
        amount: parseInt(d.amount),
      })
    ),
    invoice_date: rocDateToCE(inv.invDate),
    carrier_type: 'mobile_barcode',
    raw_data: inv,
  }));

  await upsertReceipts(supabase, receipts);
  await runMatchingAlgorithm(env);
}
