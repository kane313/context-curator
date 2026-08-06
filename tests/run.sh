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

printf '\n[Task2] 真人输入提取\n'
SCAN="$SKILL_DIR/scripts/scan.jq"

out=$(jq -s -c -f "$SCAN" "$FIXTURES/new-format.jsonl")
assert_eq "2" "$(echo "$out" | jq -r '.human_count')" "新格式：只认 origin.kind=human，得 2 条"
assert_contains "$out" "Riverpod" "新格式：抓到纠正原文"
assert_eq "false" "$(echo "$out" | jq -r 'tostring | test("子agent")')" "新格式：排除 sidechain（未泄漏到最终输出，Task3 起 .human 不再对外暴露，改为整体输出校验）"
assert_eq "false" "$(echo "$out" | jq -r 'tostring | test("command-name")')" "新格式：排除命令注入（未泄漏到最终输出，Task3 起 .human 不再对外暴露，改为整体输出校验）"

out=$(jq -s -c -f "$SCAN" "$FIXTURES/old-format.jsonl")
assert_eq "1" "$(echo "$out" | jq -r '.human_count')" "老格式：回退排除法，得 1 条"
assert_contains "$out" "analyze" "老格式：抓到约定原文"

out=$(jq -s -c -f "$SCAN" "$FIXTURES/noise-only.jsonl")
assert_eq "0" "$(echo "$out" | jq -r '.human_count')" "纯流程会话：真人输入为 0"

printf '\n[Task3] 信号打分\n'

out=$(jq -s -c -f "$SCAN" "$FIXTURES/new-format.jsonl")
assert_eq "5" "$(echo "$out" | jq -r '.breakdown.correction // 0')" "命中 correction 得 5 分"
assert_eq "5" "$(echo "$out" | jq -r '.breakdown.memory_intent // 0')" "命中 memory_intent 得 5 分"
assert_eq "1" "$(echo "$out" | jq -r '.breakdown.asset_edit // 0')" "asset_edit 权重仅 1"
assert_eq "false" "$(echo "$out" | jq -r '[.hits[].snippet] | any(test("^继续$"))')" "「继续」被判为噪声不计分"

out=$(jq -s -c -f "$SCAN" "$FIXTURES/noise-only.jsonl")
assert_eq "0" "$(echo "$out" | jq -r '.score')" "纯流程会话得 0 分（human_count=0）"

# 封顶：构造一条命中 correction 5 次的会话，应封在 5×3=15，而非 5×5=25
tmpf="$TMP/cap.jsonl"; : > "$tmpf"
for i in 1 2 3 4 5; do
  printf '{"type":"user","isSidechain":false,"origin":{"kind":"human"},"message":{"role":"user","content":"这里不对啊"}}\n' >> "$tmpf"
done
assert_eq "15" "$(jq -s -c -f "$SCAN" "$tmpf" | jq -r '.breakdown.correction')" "同类信号封顶 3 次（5×3=15）"
assert_eq "16" "$(jq -s -c -f "$SCAN" "$tmpf" | jq -r '.score')" "总分 = 1 基础分 + 15"

printf '\n通过 %d，失败 %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
