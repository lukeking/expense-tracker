-- ─── 017: v_transactions_full ────────────────────────────────────────────────
-- Read-only view: one row per transaction with items and adjustments as JSON arrays.
-- Correlated subqueries avoid cross-product fan-out from dual LEFT JOINs.

CREATE OR REPLACE VIEW v_transactions_full AS
SELECT
  t.id,
  t.amount,
  t.transaction_type,
  t.payment_method,
  t.tags,
  t.note,
  t.transaction_at,
  t.created_at,
  t.updated_at,
  t.parent_transaction_id,
  t.source,

  -- Items: ordered by sort_order; empty → []
  COALESCE(
    (SELECT json_agg(
       jsonb_build_object(
         'id',               ti.id,
         'name',             ti.name,
         'amount',           ti.amount,
         'effective_amount', ti.effective_amount,
         'tags',             ti.tags,
         'sort_order',       ti.sort_order
       ) ORDER BY ti.sort_order
     )
     FROM transaction_items ti
     WHERE ti.transaction_id = t.id
    ), '[]'::json
  ) AS items,

  -- Adjustments: ordered by created_at; empty → []
  COALESCE(
    (SELECT json_agg(
       jsonb_build_object(
         'id',          ta.id,
         'kind',        ta.kind,
         'amount',      ta.amount,
         'note',        ta.note,
         'basis',       ta.basis,
         'basis_value', ta.basis_value,
         'source',      ta.source
       ) ORDER BY ta.created_at
     )
     FROM transaction_adjustments ta
     WHERE ta.transaction_id = t.id
    ), '[]'::json
  ) AS adjustments

FROM transactions t;
