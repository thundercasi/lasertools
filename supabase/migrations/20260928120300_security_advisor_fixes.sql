/*
# Security advisor follow-ups

- Functions get EXECUTE for PUBLIC by default, so anon could still reach
  every SECURITY DEFINER function through /rest/v1/rpc. Remove PUBLIC/anon
  execute on everything in `public` and grant it to `authenticated` only
  (the functions that matter already check is_admin()/is_staff() inside).
- pg_net belongs in the `extensions` schema, not `public`.
- Pin search_path on compute_plan_next_due.
*/

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM public, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM public;

-- Internal-only helpers stay closed to API callers.
REVOKE EXECUTE ON FUNCTION public.recompute_part_stock(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_payment_status(text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_plan_last_done(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_portal_notifications() FROM authenticated;

ALTER FUNCTION public.compute_plan_next_due() SET search_path = public;

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
