#!/usr/bin/env bash
# context-curator —— 批量粗筛。供 SKILL.md 的全量模式调用。
# 用法：harvest.sh <项目会话目录> [--min-score N]
set -u

JQ=/usr/bin/jq
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN_JQ="$SCRIPT_DIR/scan.jq"

dir="${1:-}"
min_score=1
[ "${2:-}" = "--min-score" ] && min_score="${3:-1}"

[ -x "$JQ" ] || exit 0
[ -f "$SCAN_JQ" ] || exit 0
[ -n "$dir" ] && [ -d "$dir" ] || exit 0

for f in "$dir"/*.jsonl; do
  [ -f "$f" ] || continue
  sid="$(basename "$f" .jsonl)"
  "$JQ" -s -c -f "$SCAN_JQ" "$f" 2>/dev/null \
    | "$JQ" -c --arg sid "$sid" --arg path "$f" --argjson min "$min_score" \
        'select(.score >= $min)
         | {session_id:$sid, path:$path, score, human_count, breakdown, hits}' 2>/dev/null
done | "$JQ" -s -c 'sort_by(-.score) | .[]' 2>/dev/null

exit 0
