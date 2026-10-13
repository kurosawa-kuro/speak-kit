#!/bin/sh
# クラウド（Supabase 東京 + Vercel）への反映。パスワードは env/secret.yaml から読み、表示しない。
# 使い方: sh scripts/cloud.sh db | data | deploy
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
unset DB_FLOW_URL
REF=uhcfeyzwczepyjnqgwoq
POOLER=aws-0-ap-northeast-1.pooler.supabase.com

secret() {
  node -e "const y=require('yaml');process.stdout.write(String(y.parse(require('fs').readFileSync('env/secret.yaml','utf8'))['$1']))"
}

case "${1:-}" in
  db)
    # DB の形は、セッションモード（5432）で当てる
    PGPASSWORD="$(secret supabaseDbPassword)" sh scripts/db-apply.sh "postgresql://postgres.$REF@$POOLER:5432/postgres?sslmode=require"
    ;;
  data)
    # 教材は、アプリと同じトランザクションモード（6543）で入れる。追加の引数（--apply）はそのまま渡す
    shift
    SPEAK_KIT_DATABASE_KIND=supabase \
    SPEAK_KIT_DATABASE_URL="postgresql://postgres.$REF:$(secret supabaseDbPassword)@$POOLER:6543/postgres" \
      node src/cli/data.mjs sync "$@"
    ;;
  deploy)
    npx -y vercel deploy --prod --yes
    ;;
  *)
    echo "使い方: sh scripts/cloud.sh db | data [--apply] | deploy" >&2
    exit 1
    ;;
esac
