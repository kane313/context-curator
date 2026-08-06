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

# 纯推进指令，无沉淀价值。实测「继续」「跑 home」「整理一下」占真人输入的三成。
def is_noise:
  (length < 6) and test("继续|下一步|跑|整理|好的|嗯|(?i)^ok$");

# 正则经真实会话校准：能命中「…不就好了」「不要再修了。。。」
# 「为什么build了那么久没有一行代码的产出？」「…是不是就会永远都是default？」
def patterns: [
  {type:"correction",    w:5, re:"不对|不是这样|错了|应该是|别这样|别再|不要再|不用|重来|我说的是|你搞错了|搞反了|不就好了|不就行了|(?i)\\bno,\\s|(?i)\\bwrong\\b"},
  {type:"complaint",     w:5, re:"为什么.{0,12}(没有|还没|还是|又|不)|怎么还|怎么又|？？|。。。|居然|竟然"},
  {type:"convention",    w:5, re:"必须|禁止|不许|规范|我们项目|我习惯|一律|统一用|用这个|就用"},
  {type:"memory_intent", w:5, re:"记住|以后|下次|每次|别忘了|(?i)\\bremember\\b"},
  {type:"pitfall",       w:3, re:"报错|失败|崩了|Exception|build failed|编译不过|不生效|没反应"},
  {type:"decision",      w:3, re:"决定|方案定了|确定用|直接按|就按"},
  {type:"doubt",         w:2, re:"是不是|会不会|难道|确定吗"}
];

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
# 文本类信号
| [ $human[]
    | select(.text | is_noise | not)
    | . as $h | patterns[] | . as $p
    | select($h.text | test($p.re))
    | {type: $p.type, w: $p.w, line: $h.line,
       snippet: ($h.text | .[0:100] | gsub("\n"; " "))} ] as $text_hits
# 用户打断：AI 走偏的强信号。实测 32% 的会话出现过
| [ to_entries[]
    | select(.value.type == "user")
    | select((.value | human_text)
             | test("^\\[Request interrupted"))
    | {type: "interrupt", w: 3, line: (.key + 1), snippet: "用户打断了执行"} ] as $intr
# 资产改动：权重仅 1，因为绝大多数是 AI 自己写文档
| [ to_entries[]
    | .key as $k
    | select(.value.type == "assistant")
    | (.value.message.content | if type == "array" then .[] else empty end)
    | select(.type == "tool_use" and (.name == "Edit" or .name == "Write"))
    | select((.input.file_path // "") | test("CLAUDE\\.md|/docs/"))
    | {type: "asset_edit", w: 1, line: ($k + 1),
       snippet: ("改动资产: " + (.input.file_path // ""))} ] as $asset
| ($text_hits + $intr + $asset) as $hits
| ($hits | group_by(.type) | map({type: .[0].type, w: .[0].w, n: length})) as $by
# human_count 为 0 的纯流程会话直接判 0，不入队
| (if ($human | length) == 0 then 0
   else 1 + ([ $by[] | .w * (if .n > 3 then 3 else .n end) ] | add // 0)
   end) as $score
| {score: $score,
   human_count: ($human | length),
   breakdown: ([ $by[] | {(.type): (.w * (if .n > 3 then 3 else .n end))} ] | add // {}),
   hits: [ $hits[] | del(.w) ],
   human: $human}
