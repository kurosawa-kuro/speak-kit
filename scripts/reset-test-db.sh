#!/bin/sh
# テスト用の speak_kit_test を空から作り直す。本物の speak_kit には触らない。
set -eu
DB=speak_kit_test
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
unset DB_FLOW_URL
export PGOPTIONS="--client-min-messages=warning"

psql -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB"
sh "$ROOT/scripts/db-apply.sh" "$DB" >/dev/null

SPEAK_KIT_DATABASE_URL="postgresql://kurosawa@localhost:5432/$DB" node "$ROOT/src/cli/data.mjs" sync --apply >/dev/null
echo "reset $DB: schema + data/ applied"
