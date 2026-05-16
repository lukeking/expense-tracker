-- 006_add_service_role_grants.sql
-- Explicit grants required for Supabase Data API access.
-- Supabase is removing implicit public schema grants (new projects May 30,
-- all projects Oct 30, 2026). Since this app only accesses Supabase via
-- the service_role key, only service_role grants are needed.

grant select, insert, update, delete on public.receipts        to service_role;
grant select, insert, update, delete on public.transactions     to service_role;
grant select, insert, update, delete on public.budget_settings  to service_role;
grant select, insert, update, delete on public.pending_matches  to service_role;
grant select, insert, update, delete on public.import_runs      to service_role;
grant select, insert, update, delete on public.invoices         to service_role;
