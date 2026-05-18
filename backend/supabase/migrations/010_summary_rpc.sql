-- Aggregate expense totals by top-level category for a time period.
-- Avoids fetching all rows to the Worker; runs entirely in PostgreSQL.
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
      ti.amount,
      (
        SELECT split_part(t, ':', 1)
        FROM unnest(ti.tags) AS t
        WHERE t LIKE '%:%'
        LIMIT 1
      ) AS cat
    FROM transaction_items ti
    WHERE ti.amount IS NOT NULL
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

-- Aggregate expense totals by subcategory for one category and time period.
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
      ti.amount,
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
    WHERE ti.amount IS NOT NULL
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
  -- For 其他: remainder = tx.amount − sum(ALL categorised items)
  -- For others: only transactions with ≥1 item in this category contribute a remainder
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
