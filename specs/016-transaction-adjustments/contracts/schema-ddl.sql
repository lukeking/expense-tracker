-- =============================================================================
-- Spec 016: Transaction Adjustments — Schema DDL Contract
-- Migration: backend/supabase/migrations/015_transaction_adjustments.sql
-- =============================================================================

-- 1. New table: transaction_adjustments
CREATE TABLE IF NOT EXISTS transaction_adjustments (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID         NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  kind           TEXT         NOT NULL CHECK (kind IN ('fee', 'refund', 'discount')),
  amount         INTEGER      NOT NULL CHECK (amount > 0),
  transaction_at TIMESTAMPTZ  NOT NULL,
  basis          TEXT         NULL,
  basis_value    INTEGER      NULL,
  note           TEXT         NULL,
  source         TEXT         NOT NULL DEFAULT 'manual',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_adjustments_transaction_id
  ON transaction_adjustments (transaction_id);

-- 2. Add effective_amount column to transaction_items
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS effective_amount INTEGER NULL;

-- 3. Backfill: all existing items get effective_amount = amount (no-adjustment baseline)
UPDATE transaction_items
SET effective_amount = amount
WHERE effective_amount IS NULL AND amount IS NOT NULL;

-- =============================================================================
-- Migration: backend/supabase/migrations/016_summary_rpc_v2.sql
-- Replaces get_category_totals + get_subcategory_totals to use effective_amount
-- =============================================================================

CREATE OR REPLACE FUNCTION get_category_totals(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE(category text, total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tx AS (
    SELECT id, amount
    FROM transactions
    WHERE transaction_type IN ('expense', 'fee')
      AND transaction_at >= p_start
      AND transaction_at < p_end
  ),
  item_cat AS (
    SELECT
      ti.transaction_id,
      ti.effective_amount AS amount,
      (
        SELECT split_part(t, ':', 1)
        FROM unnest(ti.tags) AS t
        WHERE t LIKE '%:%'
        LIMIT 1
      ) AS cat
    FROM transaction_items ti
    WHERE ti.effective_amount IS NOT NULL
      AND ti.transaction_id IN (SELECT id FROM tx)
  ),
  named AS (
    SELECT cat AS category, SUM(amount)::bigint AS total
    FROM item_cat
    WHERE cat IS NOT NULL
    GROUP BY cat
  ),
  cat_sum_per_tx AS (
    SELECT transaction_id, SUM(amount) AS cat_sum
    FROM item_cat
    WHERE cat IS NOT NULL
    GROUP BY transaction_id
  ),
  remainder AS (
    SELECT
      '其他'::text AS category,
      SUM(tx.amount - COALESCE(cs.cat_sum, 0))::bigint AS total
    FROM tx
    LEFT JOIN cat_sum_per_tx cs ON cs.transaction_id = tx.id
    WHERE tx.amount - COALESCE(cs.cat_sum, 0) > 0
  )
  SELECT category, total FROM named    WHERE total > 0
  UNION ALL
  SELECT category, total FROM remainder WHERE total > 0
$$;

CREATE OR REPLACE FUNCTION get_subcategory_totals(
  p_start    timestamptz,
  p_end      timestamptz,
  p_category text
)
RETURNS TABLE(subcategory text, total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tx AS (
    SELECT id, amount
    FROM transactions
    WHERE transaction_type IN ('expense', 'fee')
      AND transaction_at >= p_start
      AND transaction_at < p_end
  ),
  item_sub AS (
    SELECT
      ti.transaction_id,
      ti.effective_amount AS amount,
      (
        SELECT split_part(t, ':', 2)
        FROM unnest(ti.tags) AS t
        WHERE t LIKE (p_category || ':%')
        LIMIT 1
      ) AS subcat,
      EXISTS (
        SELECT 1 FROM unnest(ti.tags) AS t WHERE t LIKE '%:%'
      ) AS has_any_cat
    FROM transaction_items ti
    WHERE ti.effective_amount IS NOT NULL
      AND ti.transaction_id IN (SELECT id FROM tx)
  ),
  per_tx AS (
    SELECT
      transaction_id,
      SUM(amount) FILTER (WHERE subcat IS NOT NULL) AS matched_sum,
      SUM(amount) FILTER (WHERE has_any_cat)         AS all_cat_sum
    FROM item_sub
    GROUP BY transaction_id
  ),
  named AS (
    SELECT
      COALESCE(NULLIF(subcat, ''), '其他') AS subcategory,
      SUM(amount)::bigint AS total
    FROM item_sub
    WHERE subcat IS NOT NULL
    GROUP BY COALESCE(NULLIF(subcat, ''), '其他')
  ),
  remainder AS (
    SELECT
      '其他'::text AS subcategory,
      SUM(
        CASE
          WHEN p_category = '其他'
            THEN tx.amount - COALESCE(pt.all_cat_sum, 0)
          WHEN COALESCE(pt.matched_sum, 0) > 0
            THEN tx.amount - pt.matched_sum
          ELSE 0
        END
      )::bigint AS total
    FROM tx
    LEFT JOIN per_tx pt ON pt.transaction_id = tx.id
    WHERE (
      CASE
        WHEN p_category = '其他'
          THEN tx.amount - COALESCE(pt.all_cat_sum, 0)
        WHEN COALESCE(pt.matched_sum, 0) > 0
          THEN tx.amount - pt.matched_sum
        ELSE 0
      END
    ) > 0
  )
  SELECT subcategory, total FROM named    WHERE total > 0
  UNION ALL
  SELECT subcategory, total FROM remainder WHERE total > 0
$$;
