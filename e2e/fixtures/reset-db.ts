import pg from 'pg';
import { BASELINE_TRANSACTIONS } from './baseline';

// Standard local Supabase Postgres connection (non-secret local default).
const CONN =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Transactional tables cleared before each test. `categories` is reference data
// (seeded once by `supabase db reset`) and is intentionally preserved.
const TRANSACTIONAL_TABLES = [
  'transaction_edit_history',
  'transaction_adjustments',
  'transaction_items',
  'transactions',
];

// Reset the DB to the identical seed baseline: truncate transactional tables, then
// re-insert the baseline transactions + their items. Order-independent per test.
export async function resetDb(): Promise<void> {
  const client = new pg.Client({ connectionString: CONN });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE ${TRANSACTIONAL_TABLES.join(', ')} RESTART IDENTITY CASCADE`
    );
    for (const tx of BASELINE_TRANSACTIONS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO transactions (amount, transaction_type, payment_method, tags, note, transaction_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tx.amount, tx.transaction_type, tx.payment_method, tx.tags, tx.note, tx.transaction_at]
      );
      const txId = rows[0].id;
      let sortOrder = 0;
      for (const item of tx.items) {
        await client.query(
          `INSERT INTO transaction_items (transaction_id, name, amount, tags, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [txId, item.name, item.amount, item.tags, sortOrder++]
        );
      }
    }
  } finally {
    await client.end();
  }
}
