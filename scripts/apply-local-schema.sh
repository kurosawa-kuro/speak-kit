#!/bin/sh
# 本物の speak_kit に、まだ当てていない sql/migrations/ を当てる。教材は npm run data:sync -- --apply で入れる。
set -eu
exec sh "$(dirname "$0")/db-apply.sh" speak_kit
