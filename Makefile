.PHONY: setup dev build start test db data-check data-sync cloud-db cloud-data cloud-deploy

# 依存を入れ、DB の形を当て、教材を入れる（何度流しても同じ結果になる）
setup:
	npm install
	sh scripts/db-apply.sh speak_kit
	npm run data:sync -- --apply

# 開発サーバー（コードを直しながら使う。出力先は .next）
dev:
	npm run dev

# 本番ビルド（出力先は .next-build。開発サーバーを動かしたままでも流せる）
build:
	npm run build

# 本番ビルドで起動する（毎日使うとき。先に make build）
start:
	npm run start

# テスト（毎回作り直す speak_kit_test に向けて流す）
test:
	npm test

# DB の形（sql/migrations）を speak_kit に当てる
db:
	sh scripts/db-apply.sh speak_kit

data-check:
	npm run data:check

data-sync:
	npm run data:sync

# クラウド（Supabase 東京 + Vercel）。DB の形を当てる / 教材の差分を見る（反映は sh scripts/cloud.sh data --apply）/ 本番へデプロイ
cloud-db:
	sh scripts/cloud.sh db

cloud-data:
	sh scripts/cloud.sh data

cloud-deploy:
	sh scripts/cloud.sh deploy
