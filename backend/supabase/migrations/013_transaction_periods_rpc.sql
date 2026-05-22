-- Returns one row per calendar month that has expense/fee transactions
-- in the given range. Used by the PWA "全部" history lazy-loader.
CREATE OR REPLACE FUNCTION get_transaction_periods(p_start timestamptz, p_end timestamptz)
RETURNS TABLE(period text, from_date text, to_date text, tx_count bigint, total numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    to_char(date_trunc('month', transaction_at), 'YYYY/MM')                                    AS period,
    to_char(date_trunc('month', transaction_at), 'YYYY-MM-DD')                                 AS from_date,
    to_char(date_trunc('month', transaction_at) + INTERVAL '1 month - 1 day', 'YYYY-MM-DD')   AS to_date,
    COUNT(*)::bigint                                                                            AS tx_count,
    SUM(amount)::numeric                                                                        AS total
  FROM transactions
  WHERE transaction_at >= p_start
    AND transaction_at < p_end
    AND transaction_type IN ('expense', 'fee')
  GROUP BY date_trunc('month', transaction_at)
  ORDER BY date_trunc('month', transaction_at) DESC;
$$;
