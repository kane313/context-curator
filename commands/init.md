---
description: 从 PRD + 源码 + 历史会话初始化项目上下文资产（薄 CLAUDE.md 或 Codex 下的 AGENTS.md + docs/context/），只新增不覆盖
argument-hint: "[PRD路径] [--dry-run] [--sessions N]"
---

用 context-init skill 初始化当前项目的上下文资产。

参数：$ARGUMENTS

- 第一个不以 `--` 开头的参数是 PRD 路径；没给就问一次，用户说没有就跳过 PRD
- `--dry-run` → 只打印将写入的内容，不写盘
- `--sessions N` → 精读的会话数上限，默认 10

严格遵守 skill 的三条铁律：不覆盖任何已有文件、无出处不写、事实进 docs/context/ 规则才进 CLAUDE.md（Codex 下规则进 AGENTS.md，CLAUDE.md 只放一行指针）。
