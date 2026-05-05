#!/usr/bin/env tsx
/**
 * Registers Discord slash commands via the REST API.
 * Usage: DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npx tsx scripts/register-commands.ts
 */

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APPLICATION_ID || !BOT_TOKEN) {
  console.error('Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN env vars');
  process.exit(1);
}

const commands = [
  {
    name: 'expense',
    description: '記錄一筆現金支出',
    options: [
      {
        name: 'amount',
        description: '金額 (NTD)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
      {
        name: 'description',
        description: '消費說明，例如：燙青菜 牛肉麵',
        type: 3, // STRING
        required: true,
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
    description: '查看月度支出摘要',
    options: [
      {
        name: 'month',
        description: '查詢月份，格式：YYYY-MM（預設當月）',
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
