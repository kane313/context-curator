---
name: context-curator
description: Use when the user wants to consolidate knowledge from past sessions into project context assets — triggers on "沉淀一下", "整理上下文", "更新 CLAUDE.md", "整理 memory", "把这次的经验记下来", "curate context", or when starting work on an unfamiliar project that has session history worth mining. Extracts knowledge from session transcripts, AI memory and code, then proposes evidence-backed edits to CLAUDE.md / memory / docs / skills — never writes without per-item confirmation.
---

# 上下文资产沉淀

把会话里产生的知识提取出来，变成项目上下文资产的改动建议，逐条确认后落地。

## 铁律

1. **没有确认就不写。** 每条建议都要用户明确说 y 才落地。一条都没批准就一个字都不改。
2. **没有证据就不提。** 每条建议必须指向具体会话文件 + 行号 + 用户原话。这是挡住凭空编造项目规则的主要闸门。
3. **拒绝过的不再提。** 落地前先查拒绝指纹。

## 三种模式

唤起时先判断用哪种：

| 模式 | 何时用 | 数据源 |
|---|---|---|
| **结算**（默认） | 用户说「沉淀一下」「整理上下文」 | `queue.jsonl` 里 `status=pending` 的会话 |
| **全量** | 首次接手老项目、用户说「把历史都扫一遍」 | 该项目全部 `*.jsonl` + 现有 memory + 代码 |
| **当下** | 用户说「把刚才这个记下来」 | 当前正在进行的会话 |

## 执行步骤

### 第 0 步：确定本 skill 的目录

后面的命令都要调用本 skill 自带的脚本，先确定它们在哪。本 skill 可能装在几种位置之一（Claude 插件缓存 / `~/.claude/skills/` / Codex 的 `~/.agents/skills/` / `<CODEX_HOME>/skills/` / Codex 插件缓存），所以不要写死路径。

加载本 skill 时，运行环境通常会告诉你它的 base directory（形如 `Base directory for this skill: /some/path/skills/context-curator`）——那就是 `$CCH`。若环境没告知，用这条命令探测：

```bash
CCH=$(node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const h=os.homedir(),hit=[];
const cx=process.env.CODEX_HOME||path.join(h,".codex");
const push=p=>{try{if(p&&fs.existsSync(path.join(p,"lib","scan.js")))hit.push(p)}catch{}};
push(process.env.CLAUDE_PLUGIN_ROOT&&path.join(process.env.CLAUDE_PLUGIN_ROOT,"skills","context-curator"));
push(path.join(h,".claude","skills","context-curator"));
push(path.join(cx,"skills","context-curator"));
push(path.join(h,".agents","skills","context-curator"));
const walk=(d,depth)=>{if(depth>4)return;let es=[];try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return}
  for(const e of es){if(!e.isDirectory())continue;const q=path.join(d,e.name);
    push(path.join(q,"skills","context-curator"));walk(q,depth+1)}};
walk(path.join(h,".claude","plugins","cache"),0);
walk(path.join(cx,"plugins","cache"),0);
console.log(hit[0]||"")')
```

探测不到就告诉用户 skill 安装不完整，然后停止。

### 第 1 步：定位项目目录

Claude Code 把项目目录名里所有非字母数字字符都换成 `-`（下划线也不例外）。项目定位、slug 推导、找不到时按会话记录里的 `cwd` 字段反查——这套逻辑已经封装进 `lib/paths.js`，跑这一条命令，输出即 `$CC`：

```bash
node -e 'const p=require(process.argv[1]+"/lib/paths"); const d=p.findProjectDir(process.cwd()); console.log(d?p.curatorDir(d):"")' "$CCH"
```

输出为空表示 `findProjectDir` 返回了 `null`——这个项目从没跑过 Claude Code 会话，没有会话记录可供沉淀。此时告诉用户「这个项目还没有会话记录可供沉淀」，然后停止。**不要**为了有产出去编造知识——这跟前面的三条铁律是一回事。

输出非空时，把它记作 `$CC`（下文命令里出现的 `$CC` 就是这个路径）；`$CC` 去掉末尾的 `context-curator` 就是 `$PROJ`（该项目的会话目录，全量模式要用）。继续第 2 步。

### 第 2 步：取线索

**结算模式：**
```bash
node -e 'const fs=require("fs"),path=require("path");const q=path.join(process.argv[1],"queue.jsonl");const rows=fs.readFileSync(q,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);rows.filter(r=>r.status==="pending").sort((a,b)=>b.score-a.score).forEach(r=>console.log(JSON.stringify(r)))' $CC
```

**全量模式：**
```bash
node "$CCH"/bin/harvest.js $PROJ
```

**当下模式：** 直接回顾当前对话，跳到第 3 步。

若结果为空，告诉用户「队列里没有待沉淀的线索」并停止。不要为了有产出而硬编。

### 第 3 步：精读

线索里的 `hits` 只是正则命中，**不是结论**。必须回原文确认。

会话数 > 3 时，派子 agent 分批精读，每个 agent 拿 2-3 个会话，只返回结构化候选知识，主会话不读原始 jsonl。

给子 agent 的指令要点：
- 读 `hits[].line` 附近的上下文，判断这条是不是真的值得沉淀
- 返回 `{类型, 内容, 证据:{文件, 行号, 原话}}`
- **明确告诉它宁缺毋滥**：不确定的丢掉

### 第 4 步：判断该不该沉淀

丢弃这些：
- 读代码就知道的事实（结构、函数签名）
- git 历史里已有的记录
- 只对当次对话有意义的临时上下文
- 已经写在现有资产里的内容（改走「合并」而非「新增」）

### 第 5 步：路由

| 目标 | 收什么 |
|---|---|
| `CLAUDE.md` | 约束 AI 怎么干活的规则、禁令、必须遵守的项目约定 |
| `memory/*.md` | 用户偏好与反馈（`user`/`feedback`）、项目状态与目标（`project`）、外部资源（`reference`）。沿用现有 frontmatter 格式，并在 `MEMORY.md` 加一行索引 |
| `docs/` | 项目事实性知识：架构、接入方式、踩坑的原理与解法 |
| `.claude/skills/` 或 `commands/` | 反复出现的多步操作流程 |

**判不准就归 `docs/`。** 宁可放宽也不塞进 `CLAUDE.md` —— 那里每一行都是每次会话都要付的成本。

### 第 6 步：比对现有资产

读进现有四类资产，把候选知识分成四类建议：

- **新增** —— 现有资产里没有
- **纠错** —— 与现有条目矛盾，必须附冲突证据
- **合并** —— 与现有条目重复，或多条 memory 说的是一回事
- **瘦身重组** —— `CLAUDE.md` 超过 200 行时提示把事实性内容下沉 `docs/`；内容放错层时建议挪位

全量模式额外做一项：把现有条目的关键词拿去粗筛所有历史会话，若从未出现过（没被遵守、没被提及、没被违反），建议删除或下沉。结算模式数据量不足，不做这个判断。

### 第 7 步：逐条确认

落地前先过滤已拒绝的：

```bash
FP=$(node "$CCH"/bin/state.js fingerprint "<目标文件>" "<类型>" "<要点>")
node "$CCH"/bin/state.js is-rejected $CC "$FP" && echo "已拒绝过，跳过"
```

每条这样呈现，一次一条：

```
[纠错] CLAUDE.md:42
  现有：所有页面用 Provider 管理状态
  证据：会话 1c966b53 第 331 行，你说"这个项目已经全换 Riverpod 了"
  拟改：所有页面用 Riverpod 管理状态
  ⬆ 全局候选（其他 Flutter 项目可能同样适用，本次只改本项目）
  → y 采纳 / n 拒绝 / e 改措辞
```

跨项目知识标 `⬆ 全局候选`，但**落地只动当前项目资产**。是否提升到 `~/.claude/CLAUDE.md` 由用户自己决定，不要代劳。

### 第 8 步：落地与收尾

- 只写用户回 y 的
- 用户回 n：`node "$CCH"/bin/state.js reject $CC "$FP" "<目标文件>" "<要点>"`
- 处理完一个会话：`node "$CCH"/bin/state.js done $CC "<session_id>"`
- 最后报一句：采纳几条、拒绝几条、分别落到哪些文件

## 反模式

- ❌ 为了显得有产出，把「用户问了个问题」也当成知识沉淀
- ❌ 建议里写「根据之前的讨论」却给不出行号
- ❌ 一次性甩出 20 条建议让用户批量确认
- ❌ 用户拒绝后反复换个说法再提一遍
- ❌ 往 `CLAUDE.md` 塞项目事实（那是 `docs/` 的活）
