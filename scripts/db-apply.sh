#!/bin/sh
# sql/migrations/ の SQL を、まだ当てていないものだけ名前順に当てる。
# 当てた記録（名前とチェックサム）は public.schema_migrations に残す。当て済みのファイルが書き換わっていたら止まる。
# 使い方: sh scripts/db-apply.sh <DB 名>   （speak_kit / speak_kit_test / speak_kit_next など speak_kit で始まる名前だけ）
set -eu
DB="${1:?DB 名を指定してください}"
case "$DB" in
  speak_kit*) ;;
  *) echo "speak_kit で始まらない DB には当てません: $DB" >&2; exit 1 ;;
esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
unset DB_FLOW_URL
export PGOPTIONS="--client-min-messages=warning"

psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)"

n=0
for f in $(ls "$ROOT/sql/migrations/"*.sql | sort); do
  name="$(basename "$f")"
  sum="$(shasum -a 256 "$f" | cut -d' ' -f1)"
  applied="$(psql -d "$DB" -tA -v ON_ERROR_STOP=1 -c "SELECT checksum FROM public.schema_migrations WHERE name = '$name'")"
  if [ -n "$applied" ]; then
    if [ "$applied" != "$sum" ]; then
      echo "当て済みの $name が書き換わっています。当て済みのファイルは直さず、新しいファイルを足してください" >&2
      exit 1
    fi
    continue
  fi
  { cat "$f"; printf "\nINSERT INTO public.schema_migrations (name, checksum) VALUES ('%s', '%s');\n" "$name" "$sum"; } \
    | psql -q -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -f - >/dev/null
  echo "applied $name"
  n=$((n + 1))
done
echo "$DB: $n file(s) applied"
