# context-curator 会话粗筛。零 token、纯本地。
# 输入：jq -s 后的整条会话记录数组
# 用法：jq -s -c -f scan.jq <会话.jsonl>

# 取出一条记录里的人类可读文本
def human_text:
  .message.content
  | if type == "string" then .
    elif type == "array" then (map(select(.type == "text") | .text) | join("\n"))
    else "" end;

# 老格式（无 origin 字段）的回退排除法。
# 已验证：在新格式会话上，本判据与 origin.kind=="human" 结果完全等价。
def is_injected:
  test("^(<local-command-|<command-name>|<command-message>|<system-reminder>|Caveat:|Base directory for this skill:|\\[Request interrupted|\\*\\*用中文对话)");

. as $all
# 整份会话里只要出现过 origin 字段，就认定是新格式，走精确判据
| (any($all[]; .type == "user" and (.origin | type) == "object")) as $new_format
| [ to_entries[]
    | select(.value.type == "user" and (.value.isSidechain // false) == false)
    | if $new_format then select(.value.origin.kind == "human") else . end
    | {line: (.key + 1), text: (.value | human_text)}
    | select(.text != "" and (.text | test("^\\s*$") | not))
    | if $new_format then . else select(.text | is_injected | not) end
  ] as $human
| {human_count: ($human | length), human: $human}
