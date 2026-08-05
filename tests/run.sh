#!/usr/bin/env bash
# context-curator 测试入口。纯 shell 断言，不依赖 bats。
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES="$SKILL_DIR/tests/fixtures"
TMP="$SKILL_DIR/tests/tmp"
rm -rf "$TMP"; mkdir -p "$TMP"

PASS=0; FAIL=0

assert_eq() {
  local expected="$1" actual="$2" name="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS+1)); printf '  ✅ %s\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '  ❌ %s\n     期望: %s\n     实际: %s\n' "$name" "$expected" "$actual"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" name="$3"
  case "$haystack" in
    *"$needle"*) PASS=$((PASS+1)); printf '  ✅ %s\n' "$name" ;;
    *) FAIL=$((FAIL+1)); printf '  ❌ %s\n     期望包含: %s\n     实际: %s\n' "$name" "$needle" "$haystack" ;;
  esac
}

# ===== 用例从这里开始追加 =====

printf '\n通过 %d，失败 %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
