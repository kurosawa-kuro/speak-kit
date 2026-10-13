#!/bin/sh
# テスト用の speak_kit_test を空から作り直す。本物の speak_kit には触らない。
set -eu
DB=speak_kit_test
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
unset DB_FLOW_URL
export PGOPTIONS="--client-min-messages=warning"

psql -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB"

psql -q -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_control_api') THEN
    CREATE ROLE job_control_api NOLOGIN;
  END IF;
END
$$;
CREATE TABLE public.flow_schema_migrations (
  domain text NOT NULL,
  version bigint NOT NULL,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_build text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, version)
);
SQL

n=0
for f in $(ls "$ROOT/sql/postgres/"*.sql | sort); do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -f "$f" >/dev/null
  n=$((n + 1))
done

SPEAK_KIT_DATABASE_URL="postgresql://kurosawa@localhost:5432/$DB" node "$ROOT/src/cli/data.mjs" sync --apply --catalog-only >/dev/null
echo "reset $DB: $n schema files + data/ applied"
