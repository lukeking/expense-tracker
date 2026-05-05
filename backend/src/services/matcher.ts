import type { Env } from '../types';
import { getSupabaseClient } from '../db/client';
import {
  getUnmatchedTransactions,
  findMatchCandidates,
  matchTransaction,
  insertPendingMatch,
} from '../db/queries';
import {
  patchTransactionMatchedMessage,
  sendAmbiguousMatchAlert,
} from './discord-notify';

export async function runMatchingAlgorithm(env: Env): Promise<void> {
  const supabase = getSupabaseClient(env);
  const unmatched = await getUnmatchedTransactions(supabase);

  for (const transaction of unmatched) {
    const candidates = await findMatchCandidates(
      supabase,
      transaction.amount,
      transaction.transaction_at
    );

    if (candidates.length === 1) {
      await matchTransaction(supabase, transaction.id, candidates[0].id);
      if (transaction.discord_message_id) {
        await patchTransactionMatchedMessage(env, transaction, candidates[0]);
      }
    } else if (candidates.length > 1) {
      const messageId = await sendAmbiguousMatchAlert(env, transaction, candidates);
      await insertPendingMatch(
        supabase,
        transaction.id,
        candidates.map((r) => r.id),
        messageId ?? undefined
      );
    }
    // 0 candidates: remain unmatched, retry on next sync
  }
}
