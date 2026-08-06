# context-curator

把会话里产生的知识沉淀到项目上下文资产（`CLAUDE.md` / memory / `docs/` / 项目级 skills）。

## 工作方式

- **会话结束**：`SessionEnd` hook 跑 `scan-session.sh`，纯 shell + jq，零 token、不写任何资产文件，只把高信号线索追加到 `queue.jsonl`
- **你主动唤起**（`/curate` 或说「沉淀一下」）：读队列 → 派子 agent 精读 → 比对现有资产 → 逐条确认 → 只写你批准的

## 文件

```
scripts/scan.jq          提取真人输入 + 信号打分（hook 与 harvest 共用）
scripts/scan-session.sh  SessionEnd hook 入口
scripts/harvest.sh       批量粗筛，供全量模式用
scripts/state.sh         队列状态与拒绝指纹
SKILL.md                 主体流程
tests/run.sh             测试套件
```

数据落在 `~/.claude/projects/<项目slug>/context-curator/`：
- `queue.jsonl` —— 线索队列
- `state.json` —— 水位线与拒绝指纹

## 设计要点

- **纯流程会话不入队**：只打了个斜杠命令、没真人打字的会话得 0 分。实测占历史会话 42%
- **同类信号封顶 3 次**：否则 AI 自己写 20 次 docs 的会话会霸榜
- **新旧两种会话格式**：新格式用 `origin.kind=="human"`，老格式（无该字段）回退正则排除法
- **拒绝指纹**：拒过的建议不再出现，否则全量模式第二次跑就废了
- **项目 slug 推导规则**：路径里所有非字母数字字符都换成 `-`，下划线也不例外。例如 `flutter_plant` → `flutter-plant`，`/flutter-project/pet` → `/flutter-project-pet`。这确保对所有项目类型都能正确生成队列文件路径，避免 `flutter_center`、`client_harness` 这类项目找不到队列文件而整个 skill 失效。

## 排障

| 现象 | 检查 |
|---|---|
| 队列一直是空的 | `jq -e '.hooks.SessionEnd' ~/.claude/settings.json`；再手动跑一次 hook 看输出 |
| 会话结束卡顿 | 实测 1.7MB 会话仅 0.03s。若卡顿，先确认 `timeout: 5` 是否配上 |
| 想临时关掉 | 从 `settings.json` 删掉 `SessionEnd` 段即可，队列文件不受影响 |

## 依赖

`jq`（macOS 自带 `/usr/bin/jq`）。缺失时所有脚本静默退出 0，不影响会话。
