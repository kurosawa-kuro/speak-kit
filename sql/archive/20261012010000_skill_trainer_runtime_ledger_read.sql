-- Restricted runtimes only read the shared release ledger. Qualifying it as
-- public.flow_schema_migrations in code and granting SELECT here keeps schema
-- compatibility checks independent from each role's locked-down search_path.
GRANT SELECT ON TABLE public.flow_schema_migrations TO job_control_api;
