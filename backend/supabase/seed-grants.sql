-- Local E2E only. Cloud Supabase auto-grants new public tables to service_role via
-- default privileges; the local `supabase db reset` does not, so tables created by
-- migrations without an explicit GRANT (transaction_items, transaction_adjustments,
-- transaction_edit_history, …) are inaccessible to the service-role key the backend uses.
-- This blanket grant brings the local DB in line with cloud behavior.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
