#!/bin/sh
# 提交前的关卡：说人话和引用检查都过了，才同步统计、提交、推送。
#
#   sh tools/commit.sh "提交说明"
#
# 别把检查和 git commit 用分号串在一行里：分号不管前一步成没成功，
# 2026-10-03 因此两次带着不合格的说人话提交过。这里用 set -e，任何一步失败就停。
set -e
cd "$(dirname "$0")/.."
[ -n "$1" ] || { echo '用法：sh tools/commit.sh "提交说明"'; exit 1; }
node tools/check-plain.mjs
node tools/check-refs.mjs --check
node tools/sync-stats.mjs >/dev/null
git add -A
git commit -q -m "$1"
git push -q
git log --oneline -1
