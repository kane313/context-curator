#!/usr/bin/env bash
# context-curator —— 队列状态与拒绝指纹管理。
# 拒绝指纹是关键设计：没有它，全量模式会把你拒过的建议反复推给你。
set -u

JQ=/usr/bin/jq
cmd="${1:-}"

_state_file() { printf '%s/state.json' "$1"; }

_ensure_state() {
  local f; f="$(_state_file "$1")"
  mkdir -p "$1" 2>/dev/null
  [ -f "$f" ] || printf '{"last_scanned_at":null,"rejected":[]}\n' > "$f"
  printf '%s' "$f"
}

case "$cmd" in
  fingerprint)
    # 目标文件 + 建议类型 + 内容要点 → 稳定指纹
    printf 'sha1:%s' "$(printf '%s\x1f%s\x1f%s' "${2:-}" "${3:-}" "${4:-}" \
      | shasum -a 1 | cut -d' ' -f1)"
    ;;
  reject)
    dir="${2:-}"; fp="${3:-}"; target="${4:-}"; gist="${5:-}"
    f="$(_ensure_state "$dir")"
    tmp="$f.tmp"
    "$JQ" --arg fp "$fp" --arg t "$target" --arg g "$gist" \
          --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      'if ([.rejected[].fingerprint] | index($fp)) then .
       else .rejected += [{fingerprint:$fp, target:$t, gist:$g, rejected_at:$ts}] end' \
      "$f" > "$tmp" && mv "$tmp" "$f"
    ;;
  is-rejected)
    dir="${2:-}"; fp="${3:-}"
    f="$(_state_file "$dir")"
    [ -f "$f" ] || exit 1
    "$JQ" -e --arg fp "$fp" '[.rejected[].fingerprint] | index($fp) != null' "$f" >/dev/null 2>&1
    ;;
  done)
    dir="${2:-}"; sid="${3:-}"
    q="$dir/queue.jsonl"
    [ -f "$q" ] || exit 0
    tmp="$q.tmp"
    "$JQ" -c --arg s "$sid" 'if .session_id == $s then .status = "done" else . end' "$q" > "$tmp" && mv "$tmp" "$q"
    f="$(_ensure_state "$dir")"
    tmp2="$f.tmp"
    "$JQ" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.last_scanned_at = $ts' "$f" > "$tmp2" && mv "$tmp2" "$f"
    ;;
  *)
    printf '用法: state.sh {fingerprint|reject|is-rejected|done} ...\n' >&2
    exit 2
    ;;
esac
