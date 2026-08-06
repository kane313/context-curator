#!/usr/bin/env bash
# context-curator —— SessionEnd hook 入口。
# 铁律：零 token、零资产写入、任何路径都 exit 0，绝不干扰会话结束。
set -u

JQ=/usr/bin/jq
[ -x "$JQ" ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN_JQ="$SCRIPT_DIR/scan.jq"
[ -f "$SCAN_JQ" ] || exit 0

payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0

# 解析 hook 输入；不是合法 JSON 就直接退出
transcript="$(printf '%s' "$payload" | "$JQ" -r '.transcript_path // empty' 2>/dev/null)" || exit 0
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

session_id="$(printf '%s' "$payload" | "$JQ" -r '.session_id // empty' 2>/dev/null)"
cwd="$(printf '%s' "$payload" | "$JQ" -r '.cwd // empty' 2>/dev/null)"
reason="$(printf '%s' "$payload" | "$JQ" -r '.reason // "other"' 2>/dev/null)"
[ -n "$session_id" ] || exit 0

# transcript 的父目录就是 ~/.claude/projects/<slug>/，无需自己拼 slug
proj_dir="$(dirname "$transcript")"
out_dir="$proj_dir/context-curator"
queue="$out_dir/queue.jsonl"
mkdir -p "$out_dir" 2>/dev/null || exit 0

# 幂等：同一 session 已入队则跳过
if [ -f "$queue" ] && "$JQ" -e --arg s "$session_id" 'select(.session_id == $s)' "$queue" >/dev/null 2>&1; then
  exit 0
fi

result="$("$JQ" -s -c -f "$SCAN_JQ" "$transcript" 2>/dev/null)" || exit 0
[ -n "$result" ] || exit 0

score="$(printf '%s' "$result" | "$JQ" -r '.score // 0' 2>/dev/null)"
# 零分不入队：纯流程会话没有沉淀价值
[ "${score:-0}" -gt 0 ] 2>/dev/null || exit 0

printf '%s' "$result" | "$JQ" -c \
  --arg sid "$session_id" --arg path "$transcript" --arg cwd "$cwd" \
  --arg reason "$reason" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{session_id:$sid, path:$path, cwd:$cwd, ended_at:$ts, reason:$reason,
    score:.score, human_count:.human_count, breakdown:.breakdown,
    hits:.hits, status:"pending"}' >> "$queue" 2>/dev/null

exit 0
