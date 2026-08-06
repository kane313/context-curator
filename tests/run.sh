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
assert_eq "false" "$(echo "$out" | jq -r '[.human[].text] | any(test("子agent"))')" "新格式：排除 sidechain"
assert_eq "false" "$(echo "$out" | jq -r '[.human[].text] | any(test("command-name"))')" "新格式：排除命令注入"

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
assert_eq "3" "$(echo "$out" | jq -r '.breakdown.interrupt // 0')" "array 形态的用户打断被正确识别，得 3 分"
assert_eq "2" "$(echo "$out" | jq -r '.human_count')" "打断记录无 origin，不计入 human_count（仍为 2）"

out=$(jq -s -c -f "$SCAN" "$FIXTURES/noise-only.jsonl")
assert_eq "0" "$(echo "$out" | jq -r '.score')" "纯流程会话得 0 分（human_count=0）"

# 封顶：构造一条命中 correction 5 次的会话，应封在 5×3=15，而非 5×5=25
tmpf="$TMP/cap.jsonl"; : > "$tmpf"
for i in 1 2 3 4 5; do
  printf '{"type":"user","isSidechain":false,"origin":{"kind":"human"},"message":{"role":"user","content":"这里不对啊"}}\n' >> "$tmpf"
done
assert_eq "15" "$(jq -s -c -f "$SCAN" "$tmpf" | jq -r '.breakdown.correction')" "同类信号封顶 3 次（5×3=15）"
assert_eq "16" "$(jq -s -c -f "$SCAN" "$tmpf" | jq -r '.score')" "总分 = 1 基础分 + 15"

printf '\n[Task4] hook 入口脚本\n'
HOOK="$SKILL_DIR/scripts/scan-session.sh"

# 准备一个模拟的项目目录，transcript 放在其中
mkdir -p "$TMP/proj"
cp "$FIXTURES/new-format.jsonl" "$TMP/proj/sess-1.jsonl"
QUEUE="$TMP/proj/context-curator/queue.jsonl"

payload='{"session_id":"sess-1","transcript_path":"'"$TMP"'/proj/sess-1.jsonl","cwd":"/p","hook_event_name":"SessionEnd","reason":"clear"}'
echo "$payload" | bash "$HOOK"
assert_eq "1" "$(wc -l < "$QUEUE" | tr -d ' ')" "有信号的会话入队 1 行"
assert_eq "sess-1" "$(jq -r '.session_id' "$QUEUE")" "记录 session_id"
assert_eq "pending" "$(jq -r '.status' "$QUEUE")" "初始状态 pending"
assert_eq "true" "$(jq -r '.score > 0' "$QUEUE")" "分数为正"

# 幂等：同一 session 重复触发不应重复入队
echo "$payload" | bash "$HOOK"
assert_eq "1" "$(wc -l < "$QUEUE" | tr -d ' ')" "同一 session 重复触发不重复入队"

# 零分会话不入队
cp "$FIXTURES/noise-only.jsonl" "$TMP/proj/sess-2.jsonl"
echo '{"session_id":"sess-2","transcript_path":"'"$TMP"'/proj/sess-2.jsonl","cwd":"/p","reason":"clear"}' | bash "$HOOK"
assert_eq "1" "$(wc -l < "$QUEUE" | tr -d ' ')" "零分的纯流程会话不入队"

# 容错：各种坏输入都必须 exit 0 且不产生垃圾
echo 'this is not json' | bash "$HOOK"; assert_eq "0" "$?" "非 JSON 输入也返回 0"
echo '{"session_id":"x","transcript_path":"/nope/missing.jsonl"}' | bash "$HOOK"; assert_eq "0" "$?" "transcript 不存在也返回 0"
echo '{}' | bash "$HOOK"; assert_eq "0" "$?" "空对象也返回 0"
assert_eq "1" "$(wc -l < "$QUEUE" | tr -d ' ')" "坏输入不污染队列"

printf '\n[Task6] 批量粗筛\n'
HARVEST="$SKILL_DIR/scripts/harvest.sh"

mkdir -p "$TMP/batch"
cp "$FIXTURES/new-format.jsonl" "$TMP/batch/aaa.jsonl"
cp "$FIXTURES/old-format.jsonl" "$TMP/batch/bbb.jsonl"
cp "$FIXTURES/noise-only.jsonl" "$TMP/batch/ccc.jsonl"

out=$(bash "$HARVEST" "$TMP/batch")
assert_eq "2" "$(echo "$out" | grep -c .)" "只输出有信号的 2 个会话"
assert_eq "aaa" "$(echo "$out" | head -1 | jq -r '.session_id')" "按分数降序，aaa 在前"
assert_eq "false" "$(echo "$out" | jq -s -r '[.[].session_id] | any(. == "ccc")')" "零分会话不输出"

out=$(bash "$HARVEST" "$TMP/batch" --min-score 100)
assert_eq "0" "$(echo "$out" | grep -c . || true)" "--min-score 过滤生效"

out=$(bash "$HARVEST" "/nonexistent/dir" 2>/dev/null; echo "rc=$?")
assert_contains "$out" "rc=0" "目录不存在也返回 0"

printf '\n[Task7] 状态与拒绝指纹\n'
STATE="$SKILL_DIR/scripts/state.sh"
mkdir -p "$TMP/st"

fp1=$(bash "$STATE" fingerprint "CLAUDE.md" "纠错" "改用 Riverpod")
fp2=$(bash "$STATE" fingerprint "CLAUDE.md" "纠错" "改用 Riverpod")
fp3=$(bash "$STATE" fingerprint "CLAUDE.md" "纠错" "改用 Provider")
assert_eq "$fp1" "$fp2" "同输入指纹稳定"
assert_eq "false" "$([ "$fp1" = "$fp3" ] && echo true || echo false)" "不同内容指纹不同"
assert_contains "$fp1" "sha1:" "指纹带 sha1: 前缀"

bash "$STATE" is-rejected "$TMP/st" "$fp1"
assert_eq "1" "$?" "未拒绝过时返回 1"

bash "$STATE" reject "$TMP/st" "$fp1" "CLAUDE.md" "改用 Riverpod"
bash "$STATE" is-rejected "$TMP/st" "$fp1"
assert_eq "0" "$?" "拒绝后返回 0"

bash "$STATE" reject "$TMP/st" "$fp1" "CLAUDE.md" "改用 Riverpod"
assert_eq "1" "$(jq '.rejected | length' "$TMP/st/state.json")" "重复拒绝不重复记录"

# done 子命令
printf '{"session_id":"s1","status":"pending"}\n{"session_id":"s2","status":"pending"}\n' > "$TMP/st/queue.jsonl"
bash "$STATE" done "$TMP/st" "s1"
assert_eq "done" "$(jq -r 'select(.session_id=="s1") | .status' "$TMP/st/queue.jsonl")" "s1 标记为 done"
assert_eq "pending" "$(jq -r 'select(.session_id=="s2") | .status' "$TMP/st/queue.jsonl")" "s2 保持 pending"

printf '\n通过 %d，失败 %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
