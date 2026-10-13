#!/bin/sh
set -eu
DB=speak_kit
if [ "$DB" = "flow" ]; then
  echo "refusing flow" >&2
  exit 1
fi
unset DB_FLOW_URL
psql -d postgres -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname = '$DB'" >/dev/null
n=0
for f in $(ls "$(dirname "$0")/../sql/postgres/"*.sql | sort); do
  echo "APPLY $(basename "$f")"
  psql -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -f "$f"
  n=$((n + 1))
done
echo "APPLIED $n"
psql -d "$DB" -tAc "SELECT current_database()"
