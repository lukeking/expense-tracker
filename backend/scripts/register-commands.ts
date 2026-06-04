#!/usr/bin/env tsx
/**
 * Registers Discord slash commands via the REST API.
 * Usage: DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npx tsx scripts/register-commands.ts
 */
import dotenv from 'dotenv';

dotenv.config();

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APPLICATION_ID || !BOT_TOKEN) {
  console.error('Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN env vars');
  process.exit(1);
}

const commands = [
  {
    name: 'expense',
    description: '記錄一筆支出',
    options: [
      {
        name: 'amount',
        description: '金額 (NTD)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
      {
        name: 'tags',
        description: '商店或分類標籤，例：#麥當勞 或 #食:午餐 或 #麥當勞,#食:午餐',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'description',
        description: '項目明細，例：大麥克 200,可樂 50 或 #食:午餐 便當 120',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'note',
        description: '備註（自由文字）',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'payment_method',
        description: '付款方式（預設：現金）',
        type: 3, // STRING
        required: false,
        choices: [
          { name: '現金', value: 'cash' },
          { name: '信用卡', value: 'credit_card' },
          { name: '悠遊卡', value: 'easy_card' },
          { name: '銀行轉帳', value: 'bank_account' },
          { name: '行動支付', value: 'prepaid_wallet' },
        ],
      },
    ],
  },
  {
    name: 'budget',
    description: '設定每月預算金額',
    options: [
      {
        name: 'amount',
        description: '月預算金額 (NTD)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
    ],
  },
  {
    name: 'summary',
    description: '查看支出分類圓餅圖',
    options: [
      {
        name: 'period',
        description: '時間區間',
        type: 3, // STRING
        required: false,
        choices: [
          { name: '本月', value: 'month' },
          { name: '上個月', value: 'last-month' },
          { name: '近3個月', value: '3months' },
          { name: '近半年', value: 'half-year' },
          { name: '近一年', value: 'year' },
          { name: '全部', value: 'all' },
        ],
      },
    ],
  },
  {
    name: 'fee',
    description: '記錄外幣交易服務費，連結至原始消費',
    options: [
      {
        name: 'amount',
        description: '服務費金額 (NTD)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
      {
        name: 'description',
        description: '費用名稱（預設：國外交易服務費）',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'parent',
        description: '原始消費關鍵字，用於搜尋母交易（例：Airbnb）',
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: 'refund',
    description: '記錄退款或出差請領，連結至原始消費',
    options: [
      {
        name: 'amount',
        description: '退款金額 (NTD)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
      {
        name: 'description',
        description: '退款說明（預設：退款）',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'parent',
        description: '原始消費關鍵字，用於搜尋母交易（例：高鐵）',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'payment_method',
        description: '退款方式（預設：cash）',
        type: 3, // STRING
        required: false,
        choices: [
          { name: '現金 (cash)', value: 'cash' },
          { name: '信用卡 (credit_card)', value: 'credit_card' },
        ],
      },
    ],
  },
  {
    name: 'amend',
    description: '修正交易金額（例如：外幣結算後的實際金額）',
    options: [
      {
        name: 'amount',
        description: '修正後的金額 (NTD)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
      {
        name: 'parent',
        description: '要修正的交易關鍵字（例：Google）',
        type: 3, // STRING
        required: false,
      },
    ],
  },
];

async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to register commands: ${res.status} ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log('Registered commands:', JSON.stringify(data, null, 2));
}

registerCommands();
