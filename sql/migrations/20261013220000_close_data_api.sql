-- Supabase の Data API（anon / authenticated）から、当てた記録の表を読めないようにする。
-- アプリは表の持ち主で直接つなぐので、RLS の規則が無くても読み書きできる。
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.schema_migrations FROM anon, authenticated;
  END IF;
END
$$;
